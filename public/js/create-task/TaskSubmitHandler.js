import { showNotification } from '../../utils.js';
import { TaskValidator } from './TaskValidator.js';
import { authService, taskService, accrualService, ipRecordsService, supabase } from '../../supabase-config.js';
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js'; 
import { addMonthsToDate, findNextWorkingDay, isWeekend, isHoliday, TURKEY_HOLIDAYS } from '../../utils.js';

export class TaskSubmitHandler {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.validator = new TaskValidator();
        this.selectedParentTransactionId = null;
    }

    setupValidationListeners() {
        const form = document.getElementById('createTaskForm');
        if (form) {
            form.addEventListener('input', () => {
                const isValid = this.validator.validateForm();
                const submitBtn = document.getElementById('submitTaskBtn');
                if (submitBtn) submitBtn.disabled = !isValid;
            });
        }
    }

    generateUUID() {
        return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);
    }

    async handleFormSubmit(e, state) {
        e.preventDefault();
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi (Tam Supabase Uyumlu).');
        
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, uploadedFiles, accrualData, isFreeTransaction 
        } = state;

        if (!selectedTaskType) { alert('Geçerli bir işlem tipi seçmediniz.'); return; }

        const submitBtn = document.getElementById('saveTaskBtn') || document.getElementById('submitTaskBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const assignedTo = document.getElementById('assignedTo')?.value;
            const assignedUser = state.allUsers.find(u => u.id === assignedTo);
            
            let taskTitle = document.getElementById('taskTitle')?.value;
            let taskDesc = document.getElementById('taskDescription')?.value;

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const brandText = document.getElementById('brandExampleText')?.value;
                taskTitle = brandText ? `${brandText} Marka Başvurusu` : selectedTaskType.alias;
                taskDesc = taskDesc || `'${brandText || 'Yeni'}' markası için başvuru işlemi.`;
            } else {
                const recordTitle = selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brand_name || selectedIpRecord.markName) : '';
                taskTitle = taskTitle || (recordTitle ? `${recordTitle} ${selectedTaskType.alias || selectedTaskType.name}` : (selectedTaskType.alias || selectedTaskType.name));
                if (!taskDesc) taskDesc = `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
            }

            let ipAppNo = "-", ipTitle = "-", ipAppName = "-";
            if (selectedIpRecord) {
                ipAppNo = selectedIpRecord.application_number || selectedIpRecord.applicationNo || "-";
                ipTitle = selectedIpRecord.title || selectedIpRecord.brand_name || "-";
                if (Array.isArray(selectedIpRecord.applicants) && selectedIpRecord.applicants.length > 0) ipAppName = selectedIpRecord.applicants[0].name || "-";
                else if (selectedIpRecord.client?.name) ipAppName = selectedIpRecord.client.name;
            } else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                if (selectedApplicants && selectedApplicants.length > 0) ipAppName = selectedApplicants[0].name || "-";
            }

            // 🔥 ÇÖZÜM 1: Supabase tablosu ile %100 birebir isimlendirme
            let taskData = {
                task_type_id: String(selectedTaskType.id),
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assigned_to: assignedUser ? assignedUser.id : null,
                status: 'open',
                ip_record_id: selectedIpRecord ? selectedIpRecord.id : null,
                
                // Tabloda olmayan ekstra veriler details içine (JSONB)
                details: {
                    assigned_to_email: assignedUser ? assignedUser.email : null,
                    ip_record_title: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brand_name) : taskTitle,
                    iprecord_application_no: ipAppNo,
                    iprecord_title: ipTitle,
                    iprecord_applicant_name: ipAppName,
                    documents: [],
                    history: []
                }
            };

            const session = await authService.getCurrentSession();
            const currentUser = session ? session.user : null;
            const userNameOrEmail = currentUser?.email || currentUser?.user_metadata?.display_name || 'Sistem';

            taskData.details.history.push({
                action: "Görev oluşturuldu", timestamp: new Date().toISOString(), userEmail: userNameOrEmail
            });

            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                taskData.official_due_date = new Date(manualDueDate).toISOString();
                taskData.operational_due_date = new Date(manualDueDate).toISOString();
            }

            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark' && selectedApplicants.length > 0) {
                taskData.task_owner_id = String(selectedApplicants[0].id);
                taskData.details.related_party_name = selectedApplicants[0].name;
            }
            
            const isRawBulletinRecord = selectedIpRecord && (selectedIpRecord.source === 'bulletin' || selectedIpRecord._source === 'bulletin') && !selectedIpRecord.portfolio_status;
            if (isRawBulletinRecord) {
                const newRealRecordId = await this._createRecordFromBulletin(selectedIpRecord);
                if (newRealRecordId) {
                    taskData.ip_record_id = newRealRecordId;
                    state.selectedIpRecord.id = newRealRecordId;
                }
            }

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.ip_record_id = newRecordId;
            }

            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

            if (uploadedFiles && uploadedFiles.length > 0) {
                const docs = [];
                for (const fileObj of uploadedFiles) {
                    const file = fileObj.file || fileObj;
                    const docId = this.generateUUID();
                    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    let storagePath = fileObj.isEpats ? `epats_documents/${Date.now()}_${docId}_${cleanFileName}` : `task_documents/${Date.now()}_${docId}_${cleanFileName}`;

                    const url = await this.dataManager.uploadFileToStorage(file, storagePath);
                    if (url) {
                        docs.push({ id: docId, name: file.name, url: url, storagePath: storagePath, type: fileObj.isEpats ? 'epats_document' : 'standard_document' });
                        if (fileObj.isEpats) {
                            taskData.details.epats_doc_url = url;
                            taskData.details.epats_doc_name = file.name;
                        }
                    }
                }
                taskData.details.documents = docs; 
            }

            // GÖREVİ YAZ
            const taskResult = await taskService.addTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);
            const newTaskId = taskResult.data.id;

            // GÖREV EVRAKLARINI YAZ
            if (taskData.details.documents.length > 0) {
                const docsToInsert = taskData.details.documents.map(d => ({
                    task_id: newTaskId, document_name: d.name, document_url: d.url, document_type: d.type
                }));
                await supabase.from('task_documents').insert(docsToInsert);
            }

            if (selectedTaskType.ipType === 'suit' || String(selectedTaskType.id) === '49') {
                await this._handleSuitCreation(state, taskData, newTaskId);
            }

            // 🔥 ÇÖZÜM 2: Transaction oluştur ve ID'sini Görev'e (Task) geri bağla!
            if (taskData.ip_record_id) {
                const txId = await this._addTransactionToPortfolio(taskData.ip_record_id, selectedTaskType, newTaskId, state, taskData.details.documents);
                if (txId) {
                    await supabase.from('tasks').update({ transaction_id: txId }).eq('id', newTaskId);
                }
            }

            await this._handleAccrualLogic(newTaskId, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            showNotification('İş başarıyla oluşturuldu!', 'success');
            setTimeout(() => { window.location.href = 'task-management.html'; }, 1500);

        } catch (error) {
            console.error('Submit Hatası:', error);
            showNotification('İşlem sırasında hata: ' + error.message, 'error');
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    async _resolveImageUrl(path) {
        if (!path) return null;
        if (/^https?:\/\//i.test(path)) return path;
        try {
            const { data } = supabase.storage.from('brand_images').getPublicUrl(path);
            return data ? data.publicUrl : path;
        } catch (e) {
            return path;
        }
    }

    async _createRecordFromBulletin(bulletinRecord) {
        try {
            const now = new Date().toISOString();
            const rawImageSource = bulletinRecord.imagePath || bulletinRecord.imageUrl || bulletinRecord.image || bulletinRecord.brandImageUrl || null;
            const brandImageUrl = await this._resolveImageUrl(rawImageSource);

            let ownerStr = 'Bilinmeyen Sahip';
            if (Array.isArray(bulletinRecord.holders) && bulletinRecord.holders.length > 0) {
                ownerStr = bulletinRecord.holders.map(h => typeof h === 'object' ? (h.name || h.holderName || h.title) : h).join(', ');
            } else if (bulletinRecord.holder || bulletinRecord.applicantName) {
                ownerStr = bulletinRecord.holder || bulletinRecord.applicantName;
            }

            const newRecordData = {
                title: bulletinRecord.markName || bulletinRecord.title || `Başvuru No: ${bulletinRecord.applicationNo}`,
                type: 'trademark',
                portfoyStatus: 'active',
                status: 'published_in_bulletin', 
                recordOwnerType: 'third_party',
                applicationNumber: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null,
                applicationDate: bulletinRecord.applicationDate || bulletinRecord.adDate || null,
                brandText: bulletinRecord.markName || null,
                brandImageUrl: brandImageUrl,
                description: `Bülten Sahibi: ${ownerStr}`, 
                createdFrom: 'bulletin_record', 
                createdAt: now,
                updatedAt: now
            };

            const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
            if (result.success) return result.id;
            throw new Error(result.error);
        } catch (error) {
            console.error("❌ _createRecordFromBulletin Hatası:", error);
            throw error; 
        }
    }

    async _handleAccrualLogic(taskId, taskTitle, taskType, state, accrualData, isFree) {
        if (isFree) return; 

        const hasValidAccrualData = accrualData && (
            (Array.isArray(accrualData.officialFee) && accrualData.officialFee.length > 0) || 
            (Array.isArray(accrualData.serviceFee) && accrualData.serviceFee.length > 0) ||
            accrualData.officialFee?.amount > 0 || 
            accrualData.serviceFee?.amount > 0
        );

        if (hasValidAccrualData) {
            const finalAccrual = {
                task_id: String(taskId),
                task_title: taskTitle,
                official_fee: accrualData.officialFee || [], 
                service_fee: accrualData.serviceFee || [],   
                total_amount: accrualData.totalAmount || [], 
                remaining_amount: accrualData.totalAmount || [], 
                vat_rate: Number(accrualData.vatRate) || 20,
                apply_vat_to_official_fee: Boolean(accrualData.applyVatToOfficialFee),
                status: 'unpaid',
                tp_invoice_party_id: accrualData.tpInvoiceParty?.id || null,
                tp_invoice_party_name: accrualData.tpInvoiceParty?.name || null,
                service_invoice_party_id: accrualData.serviceInvoiceParty?.id || null,
                service_invoice_party_name: accrualData.serviceInvoiceParty?.name || null,
                is_foreign_transaction: Boolean(accrualData.isForeignTransaction),
                files: accrualData.files || [], 
                created_at: new Date().toISOString()
            };

            const accrualResult = await accrualService.addAccrual(finalAccrual);
            if (!accrualResult.success) {
                showNotification('İş oluşturuldu ancak tahakkuk kaydedilemedi: ' + accrualResult.error, 'error');
            }
            return; 
        }

        let assignedUid = null; 
        let assignedEmail = "Atanmamış";

        try {
            const rule = await this.dataManager.getAssignmentRule("53");
            if (rule && rule.assigneeIds && rule.assigneeIds.length > 0) {
                const targetUid = rule.assigneeIds[0];
                const user = state.allUsers.find(u => u.id === targetUid);
                if (user) {
                    assignedUid = user.id;
                    assignedEmail = user.email;
                }
            }
        } catch (e) { }

        let accAppNo = "-", accTitle = taskTitle, accAppName = "-";
        if (state.selectedIpRecord) {
            const sip = state.selectedIpRecord;
            accAppNo = sip.application_number || sip.applicationNo || sip.appNo || sip.caseNo || "-";
            accTitle = sip.title || sip.brand_name || sip.markName || taskTitle;
            if (Array.isArray(sip.applicants) && sip.applicants.length > 0) {
                accAppName = sip.applicants[0].name || "-";
            } else if (sip.client && sip.client.name) {
                accAppName = sip.client.name;
            }
        }

        const accrualTaskData = {
            task_type_id: "53", // 🔥 task_type_id oldu
            title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk girilmedi. Lütfen finansal kaydı oluşturun.`,
            priority: 'high',
            status: 'open',
            assigned_to: assignedUid, // 🔥 assigned_to oldu
            ip_record_id: state.selectedIpRecord ? state.selectedIpRecord.id : null,
            details: {
                assigned_to_email: assignedEmail,
                iprecord_application_no: accAppNo,
                iprecord_title: accTitle,
                iprecord_applicant_name: accAppName
            }
        };

        await taskService.addTask(accrualTaskData);
    }

    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                let baseDate = null;
                const rawDate = ipRecord.renewal_date || ipRecord.registration_date || ipRecord.application_date;
                if (rawDate) baseDate = new Date(rawDate);
                if (!baseDate || isNaN(baseDate.getTime())) baseDate = new Date();
                if (baseDate < new Date()) baseDate.setFullYear(baseDate.getFullYear() + 10);

                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official);
                operational.setDate(operational.getDate() - 3);

                taskData.official_due_date = official.toISOString();
                taskData.operational_due_date = operational.toISOString();
            }
        } catch (e) { }
    }

    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty, ipRecord) {
        const tIdStr = String(taskType.id);
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            if (relatedParties && relatedParties.length) {
                taskData.details.related_party_id = relatedParties[0].id;
                taskData.details.related_party_name = relatedParties[0].name;
            }
        } 
        if (['7', '19', '20'].includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.details.opponent_id = opponent.id;
                taskData.details.opponent_name = opponent.name;
            }
        }
    }

    async _handleTrademarkApplication(state, taskData) {
        const { selectedApplicants, priorities, uploadedFiles } = state;
        
        let brandImageUrl = null;
        if (uploadedFiles.length > 0) {
            const fileObj = uploadedFiles[0];
            const file = fileObj.file || fileObj;
            const path = `brand-images/${Date.now()}_${file.name}`;
            try {
                brandImageUrl = await this.dataManager.uploadFileToStorage(file, path);
            } catch (e) { }
        }

        const brandType = document.getElementById('brandType')?.value || '';
        const brandCategory = document.getElementById('brandCategory')?.value || '';
        const visualDescription = document.getElementById('brandExampleText')?.value?.trim() || ''; 
        const nonLatin = document.getElementById('nonLatinAlphabet')?.value || '';
        
        let cleanBrandName = visualDescription;
        if (!cleanBrandName && taskData.title) {
                cleanBrandName = taskData.title.replace(/ Marka Başvurusu$/i, '').trim();
        }

        let origin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
        let originCountry = 'TR'; 
        if (origin === 'Yurtdışı Ulusal' || origin === 'FOREIGN_NATIONAL') {
            origin = 'FOREIGN_NATIONAL';
            originCountry = document.getElementById('countrySelect')?.value || '';
        }

        let goodsAndServicesByClass = [];
        try {
            const rawNiceClasses = getSelectedNiceClasses();
            if (Array.isArray(rawNiceClasses)) {
                goodsAndServicesByClass = rawNiceClasses.reduce((acc, item) => {
                    const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                    if (match) {
                        const classNo = parseInt(match[1]);
                        const rawText = match[2].trim();
                        let classObj = acc.find(obj => obj.classNo === classNo);
                        if (!classObj) {
                            classObj = { classNo, items: [] };
                            acc.push(classObj);
                        }
                        if (rawText) {
                            const lines = rawText.split(/[\n]/).map(l => l.trim()).filter(Boolean);
                            lines.forEach(line => {
                                const cleanLine = line.replace(/^\)+|\)+$/g, '').trim(); 
                                if (cleanLine && !classObj.items.includes(cleanLine)) {
                                    classObj.items.push(cleanLine);
                                }
                            });
                        }
                    }
                    return acc;
                }, []).sort((a, b) => a.classNo - b.classNo);
            }
        } catch (e) { }

        const applicantsData = selectedApplicants.map(p => ({ id: p.id }));

        const newRecordData = {
            title: cleanBrandName,
            brandText: cleanBrandName,
            type: 'trademark',
            recordOwnerType: 'self',
            portfoyStatus: 'active',
            status: 'filed',
            applicationDate: new Date().toISOString().split('T')[0],
            renewalDate: (() => {
                const d = new Date();
                d.setFullYear(d.getFullYear() + 10);
                return d.toISOString().split('T')[0];
            })(),
            brandType: brandType,
            brandCategory: brandCategory,
            nonLatinAlphabet: nonLatin !== '', 
            brandImageUrl: brandImageUrl,
            origin: origin,
            countryCode: originCountry,
            createdFrom: 'task_creation',
            
            applicants: applicantsData,
            goodsAndServicesByClass: goodsAndServicesByClass,
            priorities: priorities || []
        };

        const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
        return result.success ? result.id : null;
    }
    
    async _handleSuitCreation(state, taskData, taskId) {
        const { selectedTaskType, selectedIpRecord, selectedRelatedParties } = state;
        const PARENT_SUIT_IDS = ['49', '54', '55', '56', '57', '58']; 
        const isParentCreation = PARENT_SUIT_IDS.includes(String(selectedTaskType.id));

        if (!isParentCreation) return; 

        try {
            const client = selectedRelatedParties && selectedRelatedParties.length > 0 ? selectedRelatedParties[0] : null;
            
            const courtSelect = document.getElementById('courtName');
            const customInput = document.getElementById('customCourtInput');
            let finalCourtName = '';

            if (courtSelect) {
                if (courtSelect.value === 'other' && customInput) finalCourtName = customInput.value.trim();
                else finalCourtName = courtSelect.value;
            }

            let suitTitle = taskData.title; 
            if (selectedIpRecord) {
                suitTitle = selectedIpRecord.title || selectedIpRecord.brand_name || selectedIpRecord.markName;
            }

            const suitRow = {
                id: this.generateUUID(),
                file_no: document.getElementById('suitCaseNo')?.value || null,
                court_name: finalCourtName,
                plaintiff: document.getElementById('clientRole')?.value === 'davaci' ? client?.name : document.getElementById('opposingParty')?.value,
                defendant: document.getElementById('clientRole')?.value === 'davali' ? client?.name : document.getElementById('opposingParty')?.value,
                subject: suitTitle,
                status: 'continue',
                
                title: suitTitle,
                transaction_type_id: selectedTaskType.id,
                suit_type: selectedTaskType.alias || selectedTaskType.name,
                client_role: document.getElementById('clientRole')?.value || '',
                client_id: client ? client.id : null,
                client_name: client ? client.name : null,
                description: document.getElementById('suitDescription')?.value || '',
                opposing_party: document.getElementById('opposingParty')?.value || '',
                opposing_counsel: document.getElementById('opposingCounsel')?.value || '',
                opening_date: document.getElementById('suitOpeningDate')?.value || new Date().toISOString(),
                origin: document.getElementById('originSelect')?.value || 'TURKEY',
                related_task_id: taskId,
                created_at: new Date().toISOString()
            };

            const { data: newSuit, error: suitError } = await supabase.from('suits').insert(suitRow).select('id').single();
            if (suitError) throw new Error("Dava kaydedilirken hata oluştu: " + suitError.message);
            
            await this._addTransactionToPortfolio(newSuit.id, selectedTaskType, taskId, state, taskData.documents);

        } catch (error) { 
            console.error('Suit oluşturma hatası:', error); 
        }
    }

    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        let hierarchy = 'parent';
        let parentId = null;
        
        if (['8', '21', '37'].includes(String(taskType.id)) && this.selectedParentTransactionId) {
            hierarchy = 'child'; parentId = this.selectedParentTransactionId;
        }

        const session = await authService.getCurrentSession();
        const currentUser = session ? session.user : null;

        const transactionData = {
            id: this.generateUUID(), 
            ip_record_id: String(recordId),
            transaction_type_id: String(taskType.id),
            description: `${taskType.name} işlemi.`,
            transaction_hierarchy: hierarchy,
            parent_id: parentId,
            task_id: String(taskId),
            user_id: currentUser?.id || null,
            user_email: currentUser?.email || null,
            user_name: currentUser?.user_metadata?.display_name || null,
            transaction_date: new Date().toISOString(),
            created_at: new Date().toISOString()
        };

        try {
            const { data: newTx, error: txError } = await supabase.from('transactions').insert(transactionData).select('id').single();
            if (txError) throw txError;

            if (taskDocuments && taskDocuments.length > 0) {
                const docInserts = taskDocuments.map(d => ({
                    transaction_id: newTx.id, document_name: d.name, document_url: d.url,
                    document_type: d.type === 'epats_document' ? 'application/pdf' : 'other',
                    document_designation: 'Görev Evrakı'
                }));
                await supabase.from('transaction_documents').insert(docInserts);
            }
            return newTx.id; // 🔥 ÖNEMLİ: ID Geri Dönüyor
        } catch (error) {
            console.error(`Transaction ekleme hatası:`, error);
            return null;
        }
    }
}