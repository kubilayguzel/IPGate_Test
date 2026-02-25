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
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi (Strict Relational).');
        
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, uploadedFiles, accrualData, isFreeTransaction 
        } = state;

        if (!selectedTaskType) return alert('Geçerli bir işlem tipi seçmediniz.');

        const submitBtn = document.getElementById('saveTaskBtn');
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
                const recordTitle = selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : '';
                taskTitle = taskTitle || (recordTitle ? `${recordTitle} ${selectedTaskType.alias || selectedTaskType.name}` : (selectedTaskType.alias || selectedTaskType.name));
                
                if (!taskDesc) {
                    if (String(selectedTaskType.id) === '22') taskDesc = `${recordTitle} adlı markanın yenileme süreci için müvekkil onayı bekleniyor.`;
                    else taskDesc = `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
                }
            }

            let ipAppNo = "-", ipTitle = "-", ipAppName = "-";
            if (selectedIpRecord) {
                ipAppNo = selectedIpRecord.applicationNumber || selectedIpRecord.applicationNo || selectedIpRecord.appNo || selectedIpRecord.caseNo || "-";
                ipTitle = selectedIpRecord.title || selectedIpRecord.markName || selectedIpRecord.brandText || "-";
                if (Array.isArray(selectedIpRecord.applicants) && selectedIpRecord.applicants.length > 0) ipAppName = selectedIpRecord.applicants[0].name || "-";
                else if (selectedIpRecord.client && selectedIpRecord.client.name) ipAppName = selectedIpRecord.client.name;
                else if (Array.isArray(selectedIpRecord.holders) && selectedIpRecord.holders.length > 0) ipAppName = selectedIpRecord.holders[0].name || selectedIpRecord.holders[0].holderName || selectedIpRecord.holders[0] || "-";
                else if (selectedIpRecord.holder || selectedIpRecord.applicantName) ipAppName = selectedIpRecord.holder || selectedIpRecord.applicantName;
            } else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                if (selectedApplicants && selectedApplicants.length > 0) ipAppName = selectedApplicants[0].name || "-";
            }

            let taskData = {
                taskType: String(selectedTaskType.id),
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'normal',
                assignedTo_uid: assignedUser ? assignedUser.id : null,
                assignedTo_email: assignedUser ? assignedUser.email : null,
                status: 'open',
                relatedIpRecordId: selectedIpRecord ? selectedIpRecord.id : null,
                relatedIpRecordTitle: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : taskTitle,
                iprecordApplicationNo: ipAppNo,
                iprecordTitle: ipTitle,
                iprecordApplicantName: ipAppName,
                documents: [], 
                history: []
            };

            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                taskData.dueDate = new Date(manualDueDate).toISOString();
                taskData.officialDueDate = new Date(manualDueDate).toISOString();
                taskData.operationalDueDate = new Date(manualDueDate).toISOString();
            }

            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                if (selectedApplicants && selectedApplicants.length > 0) taskData.taskOwner = selectedApplicants.map(p => String(p.id));
            }
            
            if (selectedIpRecord && (selectedIpRecord.source === 'bulletin' || selectedIpRecord._source === 'bulletin' || !selectedIpRecord.recordOwnerType)) {
                const newRealRecordId = await this._createRecordFromBulletin(selectedIpRecord);
                if (newRealRecordId) {
                    taskData.relatedIpRecordId = newRealRecordId;
                    state.selectedIpRecord.id = newRealRecordId;
                    state.selectedIpRecord.source = 'created_from_bulletin'; 
                    state.selectedIpRecord._source = 'ipRecord'; 
                }
            }

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.relatedIpRecordId = newRecordId;
            }

            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

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
                            id: docId, name: file.name, url: url, downloadURL: url,
                            storagePath: storagePath, size: file.size, uploadedAt: new Date().toISOString()
                        };
                        if (fileObj.isEpats) {
                            docData.type = 'epats_document';
                            docData.turkpatentEvrakNo = document.getElementById('turkpatentEvrakNo')?.value || null;
                            docData.documentDate = document.getElementById('epatsDocumentDate')?.value || null;
                            taskData.epatsDocument = docData; 
                        } else {
                            docData.type = 'standard_document';
                        }
                        docs.push(docData);
                    }
                }
                taskData.documents = docs;
            }

            const currentUser = authService.getCurrentUser();
            taskData.history.push({ action: "Görev oluşturuldu", timestamp: new Date().toISOString(), userEmail: currentUser?.email || 'Bilinmiyor' });

            const taskResult = await taskService.addTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            if (selectedTaskType.ipType === 'suit' || String(selectedTaskType.id) === '49') {
                await this._handleSuitCreation(state, taskData, taskResult.data.id);
            }

            if (taskData.relatedIpRecordId) {
                await this._addTransactionToPortfolio(taskData.relatedIpRecordId, selectedTaskType, taskResult.data.id, state, taskData.documents);
            }

            await this._handleAccrualLogic(taskResult.data.id, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            showNotification('İş başarıyla oluşturuldu!', 'success');
            setTimeout(() => { window.location.href = 'task-management.html'; }, 1500);

        } catch (error) {
            console.error('Submit Hatası:', error);
            showNotification('İşlem sırasında hata oluştu: ' + error.message, 'error');
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    async _resolveImageUrl(path) {
        if (!path) return null;
        if (/^https?:\/\//i.test(path)) return path;
        try { const { data } = supabase.storage.from('brand_images').getPublicUrl(path); return data ? data.publicUrl : path; } catch (e) { return path; }
    }

    async _createRecordFromBulletin(bulletinRecord) {
        try {
            const now = new Date().toISOString();
            let niceClasses = [];
            if (bulletinRecord.niceClasses) {
                if (Array.isArray(bulletinRecord.niceClasses)) niceClasses = bulletinRecord.niceClasses;
                else if (typeof bulletinRecord.niceClasses === 'string') {
                    niceClasses = bulletinRecord.niceClasses.split(/[,/]/).map(s => s.trim()).map(Number).filter(n => !isNaN(n) && n > 0);
                }
            } else if (bulletinRecord.classNumbers && Array.isArray(bulletinRecord.classNumbers)) {
                 niceClasses = bulletinRecord.classNumbers;
            }

            const goodsAndServices = niceClasses.map(classNum => ({
                classNo: classNum, items: [`Sınıf ${classNum} - Bulletin kaydından alınan`]
            }));

            let applicants = [];
            if (Array.isArray(bulletinRecord.holders) && bulletinRecord.holders.length > 0) {
                applicants = bulletinRecord.holders.map(holder => ({ id: this.generateUUID(), name: holder.name || holder.holderName || holder.title || holder }));
            } else {
                applicants = [{ id: this.generateUUID(), name: bulletinRecord.holder || bulletinRecord.applicantName || 'Bilinmeyen Sahip' }];
            }

            const appDate = bulletinRecord.applicationDate || bulletinRecord.adDate || null;
            const rawImageSource = bulletinRecord.imagePath || bulletinRecord.imageUrl || bulletinRecord.image || bulletinRecord.brandImageUrl || bulletinRecord.publicImageUrl || null;
            const brandImageUrl = await this._resolveImageUrl(rawImageSource);

            const newRecordData = {
                title: bulletinRecord.markName || bulletinRecord.title || `Başvuru No: ${bulletinRecord.applicationNo}`,
                type: 'trademark', portfoyStatus: 'active', status: 'published_in_bulletin', recordOwnerType: 'third_party',
                applicationNumber: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null,
                applicationDate: appDate, brandText: bulletinRecord.markName || null, brandImageUrl: brandImageUrl,
                description: `Yayına itiraz işi oluşturulurken otomatik açılan 3.taraf kaydı.`,
                applicants: applicants, priorities: [], goodsAndServicesByClass: goodsAndServices,
                createdFrom: 'bulletin_record'
            };

            // 🔥 DÜZELTME 1: Yeni tam ilişkisel fonksiyon çağrıldı (eski createRecord silindi)
            const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
            if (result.success) return result.id;
            throw new Error(result.error);
        } catch (error) { throw error; }
    }

    async _handleAccrualLogic(taskId, taskTitle, taskType, state, accrualData, isFree) {
        if (isFree) return; 
        const hasValidAccrualData = accrualData && ((accrualData.officialFee?.amount > 0) || (accrualData.serviceFee?.amount > 0));

        if (hasValidAccrualData) {
            let uploadedFileMetadata = [];
            if (accrualData.files && accrualData.files.length > 0) {
                const filesArray = Array.from(accrualData.files); 
                for (const file of filesArray) {
                    const path = `accrual-docs/${Date.now()}_${file.name}`;
                    try {
                        const url = await this.dataManager.uploadFileToStorage(file, path);
                        uploadedFileMetadata.push({ name: file.name, url: url, storagePath: path, type: file.type, id: Date.now().toString() });
                    } catch (uploadErr) { }
                }
            }
            const finalAccrual = {
                taskId: String(taskId), taskTitle: taskTitle, officialFee: accrualData.officialFee, serviceFee: accrualData.serviceFee,
                vatRate: accrualData.vatRate, applyVatToOfficialFee: accrualData.applyVatToOfficialFee, totalAmount: accrualData.totalAmount, 
                totalAmountCurrency: accrualData.totalAmountCurrency || 'TRY', remainingAmount: accrualData.totalAmount, status: 'unpaid',
                tpInvoiceParty: accrualData.tpInvoiceParty, serviceInvoiceParty: accrualData.serviceInvoiceParty, isForeignTransaction: accrualData.isForeignTransaction,
                createdAt: new Date().toISOString(), files: uploadedFileMetadata 
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
            taskType: "53", title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk girilmedi. Lütfen finansal kaydı oluşturun.`,
            priority: 'high', status: 'pending', assignedTo_uid: assignedUid, assignedTo_email: assignedEmail,
            relatedTaskId: String(taskId), relatedIpRecordId: state.selectedIpRecord ? state.selectedIpRecord.id : null,
            relatedIpRecordTitle: state.selectedIpRecord ? (state.selectedIpRecord.title || state.selectedIpRecord.markName) : taskTitle,
            history: [{ action: "Otomatik Tahakkuk Görevi açıldı", timestamp: new Date().toISOString(), userEmail: 'Sistem' }]
        };
        await taskService.addTask(accrualTaskData);
    }

    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                let baseDate = ipRecord.renewalDate || ipRecord.registrationDate || ipRecord.applicationDate ? new Date(ipRecord.renewalDate || ipRecord.registrationDate || ipRecord.applicationDate) : new Date();
                if (baseDate < new Date()) baseDate.setFullYear(baseDate.getFullYear() + 10);
                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official); operational.setDate(operational.getDate() - 3);
                while (isWeekend(operational) || isHoliday(operational, TURKEY_HOLIDAYS)) operational.setDate(operational.getDate() - 1);
                taskData.officialDueDate = official.toISOString(); taskData.operationalDueDate = operational.toISOString(); taskData.dueDate = operational.toISOString();
            }
            const isOpposition = ['20', 'trademark_publication_objection'].includes(String(taskType.id));
            if (isOpposition && ipRecord && ipRecord.source === 'bulletin' && ipRecord.bulletinId) {
                const bulletinData = await this.dataManager.fetchAndStoreBulletinData(ipRecord.bulletinId);
                if (bulletinData && bulletinData.bulletinDate) {
                    const [dd, mm, yyyy] = bulletinData.bulletinDate.split('/');
                    const bDate = new Date(parseInt(yyyy), parseInt(mm)-1, parseInt(dd));
                    const officialDate = addMonthsToDate(bDate, 2);
                    const adjustedOfficial = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
                    const operationalDate = new Date(adjustedOfficial); operationalDate.setDate(operationalDate.getDate() - 3);
                    while (isWeekend(operationalDate) || isHoliday(operationalDate, TURKEY_HOLIDAYS)) operationalDate.setDate(operationalDate.getDate() - 1);
                    taskData.dueDate = operationalDate.toISOString(); taskData.officialDueDate = adjustedOfficial.toISOString(); taskData.operationalDueDate = operationalDate.toISOString();
                    taskData.bulletinNo = bulletinData.bulletinNo;
                }
            }
        } catch (e) { }
    }

    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty, ipRecord) {
        const tIdStr = String(taskType.id);
        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            if (relatedParties && relatedParties.length) {
                taskData.taskOwner = relatedParties.map(p => String(p.id));
                taskData.relatedPartyId = relatedParties[0].id;
                taskData.relatedPartyName = relatedParties[0].name;
            }
        } else {
            if (ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) taskData.taskOwner = ipRecord.applicants.map(a => String(a.id)).filter(Boolean);
        }
        if (['7', '19', '20'].includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) { taskData.opponentId = opponent.id; taskData.opponentName = opponent.name; }
        }
    }

    async _handleTrademarkApplication(state, taskData) {
        const { selectedApplicants, priorities, uploadedFiles } = state;
        let brandImageUrl = null;
        if (uploadedFiles.length > 0) {
            const fileObj = uploadedFiles[0];
            try { brandImageUrl = await this.dataManager.uploadFileToStorage(fileObj.file || fileObj, `brand-images/${Date.now()}_${(fileObj.file || fileObj).name}`); } catch (e) { }
        }

        const cleanBrandName = document.getElementById('brandExampleText')?.value?.trim() || taskData.title.replace(/ Marka Başvurusu$/i, '').trim();
        let origin = document.getElementById('originSelect')?.value || 'TÜRKPATENT';
        let originCountry = 'TR'; 
        if (origin === 'Yurtdışı Ulusal' || origin === 'FOREIGN_NATIONAL') { origin = 'FOREIGN_NATIONAL'; originCountry = document.getElementById('countrySelect')?.value || ''; }

        let goodsAndServicesByClass = [];
        try {
            const rawNiceClasses = getSelectedNiceClasses();
            if (Array.isArray(rawNiceClasses)) {
                goodsAndServicesByClass = rawNiceClasses.reduce((acc, item) => {
                    const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                    if (match) {
                        let classObj = acc.find(obj => obj.classNo === parseInt(match[1]));
                        if (!classObj) { classObj = { classNo: parseInt(match[1]), items: [] }; acc.push(classObj); }
                        if (match[2].trim()) match[2].trim().split(/[\n]/).forEach(l => { if (l.trim() && !classObj.items.includes(l.trim())) classObj.items.push(l.trim()); });
                    }
                    return acc;
                }, []).sort((a, b) => a.classNo - b.classNo);
            }
        } catch (e) { }

        const newRecordData = {
            title: cleanBrandName, brandText: cleanBrandName, type: 'trademark', recordOwnerType: 'self', portfoyStatus: 'active', status: 'filed',
            applicationDate: new Date().toISOString().split('T')[0], applicationNumber: null, registrationDate: null, registrationNumber: null,
            renewalDate: (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 10); return d.toISOString().split('T')[0]; })(),
            brandType: document.getElementById('brandType')?.value || '', brandCategory: document.getElementById('brandCategory')?.value || '',
            nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.value || '', brandImageUrl: brandImageUrl, goodsAndServicesByClass: goodsAndServicesByClass,
            applicants: selectedApplicants.map(p => ({ id: p.id, name: p.name })), priorities: priorities || [], origin: origin, countryCode: originCountry, createdFrom: 'task_creation'
        };

        // 🔥 DÜZELTME 2: Eski createRecord silindi, tam ilişkisel fonksiyon çağrıldı!
        const result = await ipRecordsService.createRecordFromDataEntry(newRecordData);
        return result.success ? result.id : null;
    }
    
    async _handleSuitCreation(state, taskData, taskId) {
        if (!['49', '54', '55', '56', '57', '58'].includes(String(state.selectedTaskType.id))) return; 

        try {
            const client = state.selectedRelatedParties && state.selectedRelatedParties.length > 0 ? state.selectedRelatedParties[0] : null;
            const courtSelect = document.getElementById('courtName');
            const customInput = document.getElementById('customCourtInput');
            const finalCourtName = courtSelect?.value === 'other' ? customInput?.value.trim() : courtSelect?.value;

            const suitRow = {
                file_no: document.getElementById('suitCaseNo')?.value || null,
                court_name: finalCourtName,
                plaintiff: document.getElementById('clientRole')?.value === 'davaci' ? client?.name : document.getElementById('opposingParty')?.value,
                defendant: document.getElementById('clientRole')?.value === 'davali' ? client?.name : document.getElementById('opposingParty')?.value,
                subject: taskData.title,
                status: 'continue',
                created_at: new Date().toISOString()
            };

            const { data: newSuit, error: suitError } = await supabase.from('suits').insert(suitRow).select('id').single();
            if (suitError) throw suitError;
            
            // 🔥 DÜZELTME 3: Dava açılış işleminde id sağlandı!
            await supabase.from('transactions').insert({
                id: this.generateUUID(), // <--- EKLENEN SATIR
                ip_record_id: newSuit.id,
                transaction_type_id: state.selectedTaskType.id,
                description: 'Dava Açıldı',
                transaction_hierarchy: 'parent',
                task_id: String(taskId),
                created_at: new Date().toISOString()
            });
        } catch (error) { console.error('Suit oluşturma hatası:', error); }
    }

    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        let hierarchy = 'parent';
        let parentId = null;
        
        if (['8', '21', '37'].includes(String(taskType.id)) && this.selectedParentTransactionId) {
            hierarchy = 'child';
            parentId = this.selectedParentTransactionId;
        }

        // 🔥 DÜZELTME 4: id sağlandı!
        const transactionData = {
            id: this.generateUUID(), // <--- EKLENEN SATIR
            ip_record_id: String(recordId),
            transaction_type_id: String(taskType.id),
            description: `${taskType.name} işlemi.`,
            transaction_hierarchy: hierarchy,
            parent_id: parentId,
            task_id: String(taskId),
            created_at: new Date().toISOString()
        };
        // ... (kodun devamı aynı kalıyor)

        try {
            const { data: tx, error: txError } = await supabase.from('transactions').insert(transactionData).select('id').single();
            if (txError) throw txError;
            
            // 🔥 DÜZELTME 5: İşleme yüklenen dosyalar JSON olarak değil, gerçek TABLO (transaction_documents) olarak yazılıyor!
            if (taskDocuments && taskDocuments.length > 0) {
                const docRows = taskDocuments.map(d => ({
                    transaction_id: tx.id,
                    document_name: d.name,
                    document_url: d.url || d.downloadURL,
                    document_type: d.type,
                    uploaded_at: d.uploadedAt || new Date().toISOString()
                }));
                await supabase.from('transaction_documents').insert(docRows);
            }
        } catch (error) { console.error(`Transaction ekleme hatası:`, error); }
    }
}