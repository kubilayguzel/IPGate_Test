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
        
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi (Supabase, Kesin Taraf Ataması).');
        
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, uploadedFiles,
            accrualData, isFreeTransaction 
        } = state;

        if (!selectedTaskType) {
            alert('Geçerli bir işlem tipi seçmediniz.');
            return;
        }

        const submitBtn = document.getElementById('saveTaskBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            const assignedTo = document.getElementById('assignedTo')?.value;
            const assignedUser = state.allUsers.find(u => u.id === assignedTo);
            
            let taskTitle = document.getElementById('taskTitle')?.value;
            let taskDesc = document.getElementById('taskDescription')?.value;

            // 1. Başlık ve Açıklama Belirleme
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const brandText = document.getElementById('brandExampleText')?.value;
                taskTitle = brandText ? `${brandText} Marka Başvurusu` : selectedTaskType.alias;
                taskDesc = taskDesc || `'${brandText || 'Yeni'}' markası için başvuru işlemi.`;
            } else {
                const recordTitle = selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brand_name || selectedIpRecord.markName) : '';
                taskTitle = taskTitle || (recordTitle ? `${recordTitle} ${selectedTaskType.alias || selectedTaskType.name}` : (selectedTaskType.alias || selectedTaskType.name));
                
                if (!taskDesc) {
                    if (String(selectedTaskType.id) === '22') {
                        taskDesc = `${recordTitle} adlı markanın yenileme süreci için müvekkil onayı bekleniyor.`;
                    } else {
                        taskDesc = `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
                    }
                }
            }

            // 2. İlgili Varlık Verilerini Çıkarma
            let ipAppNo = "-";
            let ipTitle = "-";
            let ipAppName = "-";

            if (selectedIpRecord) {
                ipAppNo = selectedIpRecord.application_number || selectedIpRecord.applicationNo || selectedIpRecord.appNo || selectedIpRecord.caseNo || "-";
                ipTitle = selectedIpRecord.title || selectedIpRecord.brand_name || selectedIpRecord.markName || "-";
                
                if (Array.isArray(selectedIpRecord.applicants) && selectedIpRecord.applicants.length > 0) {
                    ipAppName = selectedIpRecord.applicants[0].name || "-";
                } else if (selectedIpRecord.client && selectedIpRecord.client.name) {
                    ipAppName = selectedIpRecord.client.name;
                }
            } else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                
                if (selectedApplicants && selectedApplicants.length > 0) {
                    ipAppName = selectedApplicants[0].name || "-";
                }
            }

            // 3. Temel Task Verisi (Supabase Formatında)
            let taskData = {
                task_type: String(selectedTaskType.id),
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assigned_to_uid: assignedUser ? assignedUser.id : null,
                assigned_to_email: assignedUser ? assignedUser.email : null,
                status: 'open',
                related_ip_record_id: selectedIpRecord ? selectedIpRecord.id : null,
                related_ip_record_title: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.brand_name || selectedIpRecord.markName) : taskTitle,
                
                iprecord_application_no: ipAppNo,
                iprecord_title: ipTitle,
                iprecord_applicant_name: ipAppName,

                documents: [],
                history: []
            };

            // 4. Geçmiş Logu
            const currentUser = authService.getCurrentUser();
            taskData.history.push({
                action: "Görev oluşturuldu",
                timestamp: new Date().toISOString(),
                userEmail: currentUser?.email || currentUser?.displayName || 'Bilinmiyor'
            });

            // 5. Tarih Atamaları
            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                taskData.due_date = new Date(manualDueDate).toISOString();
                taskData.official_due_date = new Date(manualDueDate).toISOString();
                taskData.operational_due_date = new Date(manualDueDate).toISOString();
            }

            // 6. 🔥 KESİN TARAF (OWNER) ATAMASI (Güçlendirildi)
            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);

            // Başvuru işlemiyse taskOwner'ı ekstradan formdan alarak doldur
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                if (selectedApplicants && selectedApplicants.length > 0) {
                    taskData.task_owner = selectedApplicants.map(p => String(p.id));
                    taskData.related_party_id = String(selectedApplicants[0].id);
                    taskData.related_party_name = selectedApplicants[0].name;
                }
            }
            
            // 7. Bülten - Kayıt Oluşturma Bağlantısı
            if (selectedIpRecord && (selectedIpRecord.source === 'bulletin' || selectedIpRecord._source === 'bulletin' || !selectedIpRecord.record_owner_type)) {
                const newRealRecordId = await this._createRecordFromBulletin(selectedIpRecord);
                if (newRealRecordId) {
                    taskData.related_ip_record_id = newRealRecordId;
                    state.selectedIpRecord.id = newRealRecordId;
                    state.selectedIpRecord.source = 'created_from_bulletin'; 
                    state.selectedIpRecord._source = 'ipRecord'; 
                }
            }

            // 8. Marka Başvurusu Veritabanı Kaydı
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.related_ip_record_id = newRecordId;
            }

            // Tarih Hesaplamaları (Otomasyon)
            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

            // 9. Dosya (Doküman) Yükleme İşlemleri
            if (uploadedFiles && uploadedFiles.length > 0) {
                const docs = [];
                for (const fileObj of uploadedFiles) {
                    const file = fileObj.file || fileObj;
                    const docId = this.generateUUID();
                    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    
                    let storagePath = fileObj.isEpats 
                        ? `epats_documents/${Date.now()}_${docId}_${cleanFileName}`
                        : `task_documents/${Date.now()}_${docId}_${cleanFileName}`;

                    const url = await this.dataManager.uploadFileToStorage(file, storagePath);

                    if (url) {
                        const docData = {
                            id: docId,
                            name: file.name,
                            url: url,
                            storagePath: storagePath,
                            type: fileObj.isEpats ? 'epats_document' : 'standard_document'
                        };
                        
                        if (fileObj.isEpats) {
                            taskData.epats_doc_url = url;
                            taskData.epats_doc_name = file.name;
                            taskData.epats_doc_evrak_no = document.getElementById('turkpatentEvrakNo')?.value || null;
                            taskData.epats_doc_date = document.getElementById('epatsDocumentDate')?.value || null;
                        }
                        docs.push(docData);
                    }
                }
                taskData.documents = docs;
            }

            // 10. GÖREVİ VERİTABANINA YAZ
            const taskResult = await taskService.addTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            // 11. Dava (Suit) ve Transaction (Geçmiş Logu) İşlemleri
            if (selectedTaskType.ipType === 'suit' || String(selectedTaskType.id) === '49') {
                await this._handleSuitCreation(state, taskData, taskResult.data.id);
            }

            if (taskData.related_ip_record_id) {
                await this._addTransactionToPortfolio(
                    taskData.related_ip_record_id, 
                    selectedTaskType, 
                    taskResult.data.id, 
                    state, 
                    taskData.documents
                );
            }

            // 12. Tahakkuk (Accrual) Oluşturma
            await this._handleAccrualLogic(taskResult.data.id, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            showNotification('İş başarıyla oluşturuldu!', 'success');
            setTimeout(() => {
                window.location.href = 'task-management.html';
            }, 1500);

        } catch (error) {
            console.error('Submit Hatası:', error);
            showNotification('İşlem sırasında hata oluştu: ' + error.message, 'error');
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
        } catch (error) { throw error; }
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
                showNotification('İş oluşturuldu ancak tahakkuk kaydedilemedi.', 'error');
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
            task_type: "53",
            title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `"${taskTitle}" işi için finansal kayıt oluşturulması gerekiyor.`,
            priority: 'high',
            status: 'pending',
            assigned_to_uid: assignedUid,
            assigned_to_email: assignedEmail,
            related_ip_record_id: state.selectedIpRecord ? state.selectedIpRecord.id : null,
            related_ip_record_title: state.selectedIpRecord ? (state.selectedIpRecord.title || state.selectedIpRecord.brand_name || state.selectedIpRecord.markName) : taskTitle,
            iprecord_application_no: accAppNo,
            iprecord_title: accTitle,
            iprecord_applicant_name: accAppName
        };

        await taskService.addTask(accrualTaskData);
    }

    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                let baseDate = null;
                const rawDate = ipRecord.renewal_date || ipRecord.renewalDate || ipRecord.registration_date || ipRecord.application_date;
                if (rawDate) {
                    if (typeof rawDate === 'string') baseDate = new Date(rawDate);
                    else baseDate = rawDate;
                }
                if (!baseDate || isNaN(baseDate.getTime())) baseDate = new Date();
                if (baseDate < new Date()) baseDate.setFullYear(baseDate.getFullYear() + 10);

                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official);
                operational.setDate(operational.getDate() - 3);
                while (isWeekend(operational) || isHoliday(operational, TURKEY_HOLIDAYS)) operational.setDate(operational.getDate() - 1);

                taskData.official_due_date = official.toISOString();
                taskData.operational_due_date = operational.toISOString();
                taskData.due_date = operational.toISOString();
            }
            const isOpposition = ['20', 'trademark_publication_objection'].includes(String(taskType.id));
            if (isOpposition && ipRecord && ipRecord.source === 'bulletin' && ipRecord.bulletinId) {
                const bulletinData = await this.dataManager.fetchAndStoreBulletinData(ipRecord.bulletinId);
                if (bulletinData && bulletinData.bulletinDate) {
                    const [dd, mm, yyyy] = bulletinData.bulletinDate.split('/');
                    const bDate = new Date(parseInt(yyyy), parseInt(mm)-1, parseInt(dd));
                    const officialDate = addMonthsToDate(bDate, 2);
                    const adjustedOfficial = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
                    const operationalDate = new Date(adjustedOfficial);
                    operationalDate.setDate(operationalDate.getDate() - 3);
                    while (isWeekend(operationalDate) || isHoliday(operationalDate, TURKEY_HOLIDAYS)) {
                        operationalDate.setDate(operationalDate.getDate() - 1);
                    }
                    taskData.due_date = operationalDate.toISOString(); 
                    taskData.official_due_date = adjustedOfficial.toISOString();
                    taskData.operational_due_date = operationalDate.toISOString();
                    taskData.bulletin_no = bulletinData.bulletinNo;
                    taskData.bulletin_date = bulletinData.bulletinDate;
                }
            }
        } catch (e) { }
    }

    // 🔥 GÜÇLENDİRİLMİŞ TARAF (OWNER) ATAMA MERKEZİ
    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty, ipRecord) {
        const tIdStr = String(taskType.id);

        // 1. Formdan özel olarak bir "İlgili Taraf" seçilmişse onu kullan
        if (relatedParties && relatedParties.length > 0) {
            taskData.task_owner = relatedParties.map(p => String(p.id)).filter(Boolean);
            taskData.related_party_id = String(relatedParties[0].id);
            taskData.related_party_name = relatedParties[0].name;
        } 
        else if (singleParty) {
            taskData.task_owner = [String(singleParty.id)];
            taskData.related_party_id = String(singleParty.id);
            taskData.related_party_name = singleParty.name;
        }
        // 2. Formdan seçilmemişse, BAĞLI OLDUĞU IP RECORD'UN (Markanın) Sahibini kopyala
        else if (ipRecord) {
            let primaryApplicant = null;
            
            if (Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                primaryApplicant = ipRecord.applicants[0];
                taskData.task_owner = ipRecord.applicants.map(a => String(a.id || a)).filter(Boolean);
            } else if (ipRecord.client) {
                primaryApplicant = ipRecord.client;
                taskData.task_owner = [String(ipRecord.client.id || ipRecord.client)];
            }

            if (primaryApplicant) {
                taskData.related_party_id = String(primaryApplicant.id || primaryApplicant);
                taskData.related_party_name = primaryApplicant.name || primaryApplicant.applicantName || "Bilinmeyen Taraf";
            }
        }

        // 3. İtiraz işlemleri için Opponent (Karşı Taraf) ataması
        const objectionIds = ['7', '19', '20'];
        if (objectionIds.includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.opponent_id = String(opponent.id);
                taskData.opponent_name = opponent.name;
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
            try { brandImageUrl = await this.dataManager.uploadFileToStorage(file, path); } catch (e) { }
        }

        const brandType = document.getElementById('brandType')?.value || '';
        const brandCategory = document.getElementById('brandCategory')?.value || '';
        const visualDescription = document.getElementById('brandExampleText')?.value?.trim() || ''; 
        const nonLatin = document.getElementById('nonLatinAlphabet')?.value || '';
        
        let cleanBrandName = visualDescription;
        if (!cleanBrandName && taskData.title) cleanBrandName = taskData.title.replace(/ Marka Başvurusu$/i, '').trim();

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
                                if (cleanLine && !classObj.items.includes(cleanLine)) classObj.items.push(cleanLine);
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

        } catch (error) { console.error('Suit oluşturma hatası:', error); }
    }

    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        let hierarchy = 'parent';
        let parentId = null;
        const tId = String(taskType.id);
        const needsParent = ['8', '21', '37'].includes(tId);

        if (needsParent && this.selectedParentTransactionId) {
            hierarchy = 'child';
            parentId = this.selectedParentTransactionId;
        }

        const currentUser = authService.getCurrentUser();

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
            user_name: currentUser?.displayName || null,
            transaction_date: new Date().toISOString(),
            created_at: new Date().toISOString()
        };

        try {
            const { data: newTx, error: txError } = await supabase.from('transactions').insert(transactionData).select('id').single();
            if (txError) throw txError;

            if (taskDocuments && taskDocuments.length > 0) {
                const docInserts = taskDocuments.map(d => ({
                    transaction_id: newTx.id,
                    document_name: d.name,
                    document_url: d.url,
                    document_type: d.type === 'epats_document' ? 'application/pdf' : 'other',
                    document_designation: 'Görev Evrakı',
                    uploaded_at: new Date().toISOString()
                }));
                await supabase.from('transaction_documents').insert(docInserts);
            }
        } catch (error) { console.error(`Transaction ekleme hatası:`, error); }
    }
}