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
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi (TAM SUPABASE UYUMU).');
        
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, uploadedFiles,
            accrualData, isFreeTransaction 
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
                else if (selectedIpRecord.client && selectedIpRecord.client.name) ipAppName = selectedIpRecord.client.name;
            } else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                if (selectedApplicants && selectedApplicants.length > 0) ipAppName = selectedApplicants[0].name || "-";
            }

            // 🔥 1. KULLANICIYI DOĞRU EŞLEŞTİRME (FK Hatasını Engeller)
            const session = await authService.getCurrentSession();
            const currentUserEmail = session?.user?.email;
            const dbUser = state.allUsers.find(u => u.email === currentUserEmail);
            const userNameOrEmail = dbUser?.display_name || dbUser?.name || currentUserEmail || 'Sistem';

            // 🔥 2. SÜTUN İSİMLERİ SUPABASE İLE %100 EŞLEŞTİRİLDİ
            let taskData = {
                task_type_id: String(selectedTaskType.id),
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assigned_to: assignedUser ? assignedUser.id : null,
                status: 'open',
                ip_record_id: selectedIpRecord ? selectedIpRecord.id : null,
                
                details: {
                    assigned_to_email: assignedUser ? assignedUser.email : null,
                    ip_record_title: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brand_name) : taskTitle,
                    iprecord_application_no: ipAppNo,
                    iprecord_title: ipTitle,
                    iprecord_applicant_name: ipAppName,
                    documents: [],
                    history: [{
                        action: "Görev oluşturuldu",
                        timestamp: new Date().toISOString(),
                        userEmail: userNameOrEmail
                    }]
                }
            };

            // 🔥 3. TARİH KONTROLÜ (Boşsa set etme, doluysa formatla)
            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate && manualDueDate.trim() !== '') {
                let parsedDate;
                if (manualDueDate.includes('.')) {
                    const parts = manualDueDate.split('.');
                    parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`); // TR Format
                } else {
                    parsedDate = new Date(manualDueDate);
                }
                
                if (!isNaN(parsedDate.getTime())) {
                    taskData.official_due_date = parsedDate.toISOString();
                    taskData.operational_due_date = parsedDate.toISOString();
                }
            }

            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                if (selectedApplicants && selectedApplicants.length > 0) {
                    taskData.task_owner_id = String(selectedApplicants[0].id);
                    taskData.details.related_party_name = selectedApplicants[0].name;
                }
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

            // GÖREVİ VERİTABANINA YAZ
            const taskResult = await taskService.addTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);
            const newTaskId = taskResult.data.id;

            // Dava İşlemleri
            if (selectedTaskType.ipType === 'suit' || String(selectedTaskType.id) === '49') {
                await this._handleSuitCreation(state, taskData, newTaskId);
            }

            // 🔥 4. İŞLEM OLUŞTUR VE TASK'A BAĞLA
            if (taskData.ip_record_id) {
                const txId = await this._addTransactionToPortfolio(taskData.ip_record_id, selectedTaskType, newTaskId, state, taskData.details.documents);
                if (txId) {
                    // Task tablosundaki transaction_id'yi güncelle
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
        } catch (e) { return path; }
    }

    async _createRecordFromBulletin(bulletinRecord) {
        try {
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
                createdAt: new Date().toISOString()
            };

            const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
            return result.success ? result.id : null;
        } catch (error) { return null; }
    }

    async _handleAccrualLogic(taskId, taskTitle, taskType, state, accrualData, isFree) {
        if (isFree) return; 

        const hasValidAccrualData = accrualData && ((Array.isArray(accrualData.officialFee) && accrualData.officialFee.length > 0) || accrualData.officialFee?.amount > 0 || accrualData.serviceFee?.amount > 0);

        if (hasValidAccrualData) {
            const finalAccrual = {
                task_id: String(taskId), task_title: taskTitle, official_fee: accrualData.officialFee || [], service_fee: accrualData.serviceFee || [],   
                total_amount: accrualData.totalAmount || [], remaining_amount: accrualData.totalAmount || [], vat_rate: Number(accrualData.vatRate) || 20,
                apply_vat_to_official_fee: Boolean(accrualData.applyVatToOfficialFee), status: 'unpaid', tp_invoice_party_id: accrualData.tpInvoiceParty?.id || null,
                service_invoice_party_id: accrualData.serviceInvoiceParty?.id || null, is_foreign_transaction: Boolean(accrualData.isForeignTransaction), files: accrualData.files || [], 
                created_at: new Date().toISOString()
            };
            await accrualService.addAccrual(finalAccrual);
            return; 
        }

        let assignedUid = null, assignedEmail = "Atanmamış";
        try {
            const rule = await this.dataManager.getAssignmentRule("53");
            if (rule && rule.assigneeIds && rule.assigneeIds.length > 0) {
                const user = state.allUsers.find(u => u.id === rule.assigneeIds[0]);
                if (user) { assignedUid = user.id; assignedEmail = user.email; }
            }
        } catch (e) { }

        const accrualTaskData = {
            task_type_id: "53",
            title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `Finansal kaydı oluşturun.`,
            priority: 'high',
            status: 'open',
            assigned_to: assignedUid,
            ip_record_id: state.selectedIpRecord ? state.selectedIpRecord.id : null,
            details: { assigned_to_email: assignedEmail }
        };
        await taskService.addTask(accrualTaskData);
    }

    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                const rawDate = ipRecord.renewal_date || ipRecord.renewalDate || ipRecord.registration_date || ipRecord.application_date;
                let baseDate = rawDate ? new Date(rawDate) : new Date();
                if (isNaN(baseDate.getTime())) baseDate = new Date();
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
        if (RELATED_PARTY_REQUIRED.has(tIdStr) && relatedParties && relatedParties.length) {
            taskData.details.related_party_id = relatedParties[0].id;
            taskData.details.related_party_name = relatedParties[0].name;
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
            brandImageUrl = await this.dataManager.uploadFileToStorage(uploadedFiles[0].file || uploadedFiles[0], `brand-images/${Date.now()}_img`);
        }
        
        let origin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
        let originCountry = 'TR'; 
        if (origin === 'Yurtdışı Ulusal' || origin === 'FOREIGN_NATIONAL') { origin = 'FOREIGN_NATIONAL'; originCountry = document.getElementById('countrySelect')?.value || ''; }

        const newRecordData = {
            title: document.getElementById('brandExampleText')?.value?.trim() || taskData.title,
            brandText: document.getElementById('brandExampleText')?.value?.trim(),
            type: 'trademark',
            recordOwnerType: 'self',
            portfoyStatus: 'active',
            status: 'filed',
            applicationDate: new Date().toISOString().split('T')[0],
            brandType: document.getElementById('brandType')?.value || '',
            brandCategory: document.getElementById('brandCategory')?.value || '',
            nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.value !== '', 
            brandImageUrl: brandImageUrl,
            origin: origin,
            countryCode: originCountry,
            applicants: selectedApplicants.map(p => ({ id: p.id }))
        };

        const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
        return result.success ? result.id : null;
    }
    
    async _handleSuitCreation(state, taskData, taskId) {
        if (!['49', '54', '55', '56', '57', '58'].includes(String(state.selectedTaskType.id))) return; 
        const client = state.selectedRelatedParties && state.selectedRelatedParties.length > 0 ? state.selectedRelatedParties[0] : null;
        const courtSelect = document.getElementById('courtName');
        const customInput = document.getElementById('customCourtInput');
        const finalCourtName = courtSelect?.value === 'other' ? customInput?.value.trim() : courtSelect?.value;

        const suitRow = {
            id: this.generateUUID(),
            file_no: document.getElementById('suitCaseNo')?.value || null,
            court_name: finalCourtName,
            plaintiff: document.getElementById('clientRole')?.value === 'davaci' ? client?.name : document.getElementById('opposingParty')?.value,
            defendant: document.getElementById('clientRole')?.value === 'davali' ? client?.name : document.getElementById('opposingParty')?.value,
            subject: taskData.title,
            status: 'continue',
            title: taskData.title,
            transaction_type_id: state.selectedTaskType.id,
            suit_type: state.selectedTaskType.alias || state.selectedTaskType.name,
            client_id: client ? client.id : null,
            related_task_id: taskId,
            created_at: new Date().toISOString()
        };
        const { data: newSuit } = await supabase.from('suits').insert(suitRow).select('id').single();
        if(newSuit) await this._addTransactionToPortfolio(newSuit.id, state.selectedTaskType, taskId, state, taskData.details.documents);
    }

    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        let hierarchy = 'parent', parentId = null;
        if (['8', '21', '37'].includes(String(taskType.id)) && this.selectedParentTransactionId) { hierarchy = 'child'; parentId = this.selectedParentTransactionId; }

        // 🔥 KULLANICI DOĞRULAMASI (FK HATASI BURADA ÇÖZÜLDÜ)
        const session = await authService.getCurrentSession();
        const dbUser = state.allUsers.find(u => u.email === session?.user?.email);

        const transactionData = {
            id: this.generateUUID(), 
            ip_record_id: String(recordId),
            transaction_type_id: String(taskType.id),
            description: `${taskType.name} işlemi.`,
            transaction_hierarchy: hierarchy,
            parent_id: parentId,
            task_id: String(taskId),
            user_id: dbUser ? dbUser.id : null, // Geçerli ID
            user_email: session?.user?.email || null,
            user_name: dbUser ? (dbUser.display_name || dbUser.name) : null,
            transaction_date: new Date().toISOString()
        };

        try {
            const { data: newTx, error: txError } = await supabase.from('transactions').insert(transactionData).select('id').single();
            if (txError) throw txError;

            if (taskDocuments.length > 0) {
                const docInserts = taskDocuments.map(d => ({
                    transaction_id: newTx.id, document_name: d.name, document_url: d.url, document_type: 'other'
                }));
                await supabase.from('transaction_documents').insert(docInserts);
            }
            return newTx.id; 
        } catch (error) { return null; }
    }
}