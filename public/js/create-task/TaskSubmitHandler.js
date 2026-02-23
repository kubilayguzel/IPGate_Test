import { showNotification } from '../../utils.js';
import { TaskValidator } from './TaskValidator.js';
// 🔥 YENİ: Supabase'e bağlı servisler
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

    // Klasik Firebase UUID üreticisi yerine Native JS UUID
    generateUUID() {
        return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);
    }

    async handleFormSubmit(e, state) {
        e.preventDefault();
        
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi (Supabase).');
        
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

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const brandText = document.getElementById('brandExampleText')?.value;
                taskTitle = brandText ? `${brandText} Marka Başvurusu` : selectedTaskType.alias;
                taskDesc = taskDesc || `'${brandText || 'Yeni'}' markası için başvuru işlemi.`;
            } else {
                const recordTitle = selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : '';
                taskTitle = taskTitle || (recordTitle ? `${recordTitle} ${selectedTaskType.alias || selectedTaskType.name}` : (selectedTaskType.alias || selectedTaskType.name));
                
                if (!taskDesc) {
                    if (String(selectedTaskType.id) === '22') {
                        taskDesc = `${recordTitle} adlı markanın yenileme süreci için müvekkil onayı bekleniyor.`;
                    } else {
                        taskDesc = `${selectedTaskType.alias || selectedTaskType.name} işlemi.`;
                    }
                }
            }

            let ipAppNo = "-";
            let ipTitle = "-";
            let ipAppName = "-";

            if (selectedIpRecord) {
                ipAppNo = selectedIpRecord.applicationNumber || selectedIpRecord.applicationNo || selectedIpRecord.appNo || selectedIpRecord.caseNo || "-";
                ipTitle = selectedIpRecord.title || selectedIpRecord.markName || selectedIpRecord.brandText || "-";
                
                if (Array.isArray(selectedIpRecord.applicants) && selectedIpRecord.applicants.length > 0) {
                    ipAppName = selectedIpRecord.applicants[0].name || "-";
                } else if (selectedIpRecord.client && selectedIpRecord.client.name) {
                    ipAppName = selectedIpRecord.client.name;
                } else if (Array.isArray(selectedIpRecord.holders) && selectedIpRecord.holders.length > 0) {
                    ipAppName = selectedIpRecord.holders[0].name || selectedIpRecord.holders[0].holderName || selectedIpRecord.holders[0] || "-";
                } else if (selectedIpRecord.holder || selectedIpRecord.applicantName) {
                    ipAppName = selectedIpRecord.holder || selectedIpRecord.applicantName;
                }
            } else if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                if (selectedApplicants && selectedApplicants.length > 0) {
                    ipAppName = selectedApplicants[0].name || "-";
                }
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

                details: {},
                documents: [], 
                history: []
            };

            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                // ISO String format (Supabase TIMESTAMP uyumlu)
                taskData.dueDate = new Date(manualDueDate).toISOString();
                taskData.officialDueDate = new Date(manualDueDate).toISOString();
                taskData.operationalDueDate = new Date(manualDueDate).toISOString();
            }

            this._enrichTaskWithParties(taskData, selectedTaskType, selectedRelatedParties, selectedRelatedParty, selectedIpRecord);

            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                if (selectedApplicants && selectedApplicants.length > 0) {
                    taskData.taskOwner = selectedApplicants.map(p => String(p.id));
                    taskData.details.applicants = selectedApplicants.map(p => ({
                        id: p.id,
                        name: p.name,
                        email: p.email
                    }));
                    if (!taskData.details.relatedParties) {
                         taskData.details.relatedParties = taskData.details.applicants;
                    }
                }
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
                    // fileObj direkt File olabilir (Örn: Drag-drop marka logosu)
                    const file = fileObj.file || fileObj;
                    const docId = this.generateUUID();
                    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    
                    let storagePath = '';
                    if (fileObj.isEpats) {
                        storagePath = `epats_documents/${Date.now()}_${docId}_${cleanFileName}`;
                    } else {
                        storagePath = `task_documents/${Date.now()}_${docId}_${cleanFileName}`;
                    }

                    const url = await this.dataManager.uploadFileToStorage(file, storagePath);

                    if (url) {
                        const docData = {
                            id: docId,
                            name: file.name,
                            url: url,
                            downloadURL: url,
                            storagePath: storagePath,
                            size: file.size,
                            uploadedAt: new Date().toISOString()
                        };

                        if (fileObj.isEpats) {
                            docData.type = 'epats_document';
                            docData.turkpatentEvrakNo = document.getElementById('turkpatentEvrakNo')?.value || null;
                            docData.documentDate = document.getElementById('epatsDocumentDate')?.value || null;
                        } else {
                            docData.type = 'standard_document';
                        }
                        docs.push(docData);
                    }
                }
                taskData.documents = docs;
            }

            const currentUser = authService.getCurrentUser();
            taskData.history.push({
                action: "Görev oluşturuldu",
                timestamp: new Date().toISOString(),
                userEmail: currentUser?.email || 'Bilinmiyor'
            });

            // TASK OLUŞTUR (Supabase service)
            const taskResult = await taskService.addTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            if (selectedTaskType.ipType === 'suit' || String(selectedTaskType.id) === '49') {
                await this._handleSuitCreation(state, taskData, taskResult.data.id);
            }

            if (taskData.relatedIpRecordId) {
                await this._addTransactionToPortfolio(
                    taskData.relatedIpRecordId, 
                    selectedTaskType, 
                    taskResult.data.id, 
                    state, 
                    taskData.documents
                );
            }

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
        } catch (e) {
            return path;
        }
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
                niceClass: classNum.toString(),
                description: `Sınıf ${classNum} - Bulletin kaydından alınan`,
                status: 'active'
            }));

            let applicants = [];
            if (Array.isArray(bulletinRecord.holders) && bulletinRecord.holders.length > 0) {
                applicants = bulletinRecord.holders.map(holder => ({
                    id: this.generateUUID(),
                    name: holder.name || holder.holderName || holder.title || holder,
                    address: holder.address || holder.addressText || null,
                    country: holder.country || holder.countryCode || null,
                }));
            } else {
                const holderName = bulletinRecord.holder || bulletinRecord.applicantName || 'Bilinmeyen Sahip';
                applicants = [{
                    id: this.generateUUID(),
                    name: holderName,
                    address: bulletinRecord.address || '',
                    country: '',
                    role: 'owner'
                }];
            }

            const appDate = bulletinRecord.applicationDate || bulletinRecord.adDate || null;
            const rawImageSource = bulletinRecord.imagePath || bulletinRecord.imageUrl || bulletinRecord.image || bulletinRecord.brandImageUrl || bulletinRecord.publicImageUrl || null;
            const brandImageUrl = await this._resolveImageUrl(rawImageSource);
            const imagePath = (rawImageSource && !/^https?:\/\//i.test(rawImageSource)) ? rawImageSource : null;

            const newRecordData = {
                title: bulletinRecord.markName || bulletinRecord.title || `Başvuru No: ${bulletinRecord.applicationNo}`,
                type: 'trademark',
                portfoyStatus: 'active',
                status: 'published_in_bulletin', 
                recordOwnerType: 'third_party',
                applicationNumber: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null,
                applicationNo: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null, 
                applicationDate: appDate,
                registrationNumber: null,
                registrationDate: null,
                renewalDate: null,
                brandText: bulletinRecord.markName || null,
                markName: bulletinRecord.markName || null, 
                brandImageUrl: brandImageUrl,
                imagePath: imagePath,
                description: `Yayına itiraz işi oluşturulurken otomatik açılan 3.taraf kaydı.`,
                applicants: applicants,
                priorities: [],
                goodsAndServices: goodsAndServices, 
                niceClasses: niceClasses, 
                details: {
                    sourceBulletinRecordId: bulletinRecord.id || null,
                    originalBulletinRecordId: null,
                    brandInfo: {
                        brandType: bulletinRecord.markType || null,
                        brandCategory: null,
                        brandExampleText: bulletinRecord.markName || null,
                        nonLatinAlphabet: null,
                        brandImage: brandImageUrl,
                        goodsAndServices: goodsAndServices,
                        opposedMarkBulletinNo: bulletinRecord.bulletinNo || null,
                        opposedMarkBulletinDate: bulletinRecord.bulletinDate || null
                    }
                },
                source: 'task_creation',
                createdFrom: 'bulletin_record', 
                createdBy: 'task_ui_automation',
                createdAt: now,
                updatedAt: now
            };

            const result = await ipRecordsService.createRecord(newRecordData);
            if (result.success) return result.id;
            throw new Error(result.error);
        } catch (error) {
            console.error("❌ _createRecordFromBulletin Hatası:", error);
            throw error; 
        }
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
                        uploadedFileMetadata.push({
                            name: file.name,
                            url: url,
                            storagePath: path,
                            type: file.type,
                            id: Date.now().toString() 
                        });
                    } catch (uploadErr) { }
                }
            }

            const finalAccrual = {
                taskId: String(taskId),
                taskTitle: taskTitle,
                officialFee: accrualData.officialFee,
                serviceFee: accrualData.serviceFee,
                vatRate: accrualData.vatRate,
                applyVatToOfficialFee: accrualData.applyVatToOfficialFee,
                totalAmount: accrualData.totalAmount, 
                totalAmountCurrency: accrualData.totalAmountCurrency || 'TRY',
                remainingAmount: accrualData.totalAmount, 
                status: 'unpaid',
                tpInvoiceParty: accrualData.tpInvoiceParty,
                serviceInvoiceParty: accrualData.serviceInvoiceParty,
                isForeignTransaction: accrualData.isForeignTransaction,
                createdAt: new Date().toISOString(),
                files: uploadedFileMetadata 
            };

            const accrualResult = await accrualService.addAccrual(finalAccrual);
            if (!accrualResult.success) {
                showNotification('İş oluşturuldu ancak tahakkuk kaydedilemedi: ' + accrualResult.error, 'error');
            }
            return; 
        }

        // Ertelenmiş Tahakkuk - Yeni bir task oluştur
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
            accAppNo = sip.applicationNumber || sip.applicationNo || sip.appNo || sip.caseNo || "-";
            accTitle = sip.title || sip.markName || sip.brandText || taskTitle;
            if (Array.isArray(sip.applicants) && sip.applicants.length > 0) {
                accAppName = sip.applicants[0].name || "-";
            } else if (sip.client && sip.client.name) {
                accAppName = sip.client.name;
            }
        }

        const accrualTaskData = {
            taskType: "53",
            title: `Tahakkuk Oluşturma: ${taskTitle}`,
            description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk girilmedi. Lütfen finansal kaydı oluşturun.`,
            priority: 'high',
            status: 'pending',
            assignedTo_uid: assignedUid,
            assignedTo_email: assignedEmail,
            relatedTaskId: String(taskId), 
            relatedIpRecordId: state.selectedIpRecord ? state.selectedIpRecord.id : null,
            relatedIpRecordTitle: state.selectedIpRecord ? (state.selectedIpRecord.title || state.selectedIpRecord.markName) : taskTitle,
            
            iprecordApplicationNo: accAppNo,
            iprecordTitle: accTitle,
            iprecordApplicantName: accAppName,

            details: {
                source: 'automatic_accrual_assignment',
                originalTaskType: taskType.alias || taskType.name
            },
            history: [{
                action: "Otomatik Tahakkuk Görevi açıldı",
                timestamp: new Date().toISOString(),
                userEmail: 'Sistem'
            }]
        };

        await taskService.addTask(accrualTaskData);
    }

    async _calculateTaskDates(taskData, taskType, ipRecord) {
        try {
            const isRenewal = String(taskType.id) === '22' || /yenileme/i.test(taskType.name);
            if (isRenewal && ipRecord) {
                let baseDate = null;
                const rawDate = ipRecord.renewalDate || ipRecord.registrationDate || ipRecord.applicationDate;
                if (rawDate) {
                    if (rawDate.toDate) baseDate = rawDate.toDate();
                    else if (typeof rawDate === 'string') baseDate = new Date(rawDate);
                    else baseDate = rawDate;
                }
                if (!baseDate || isNaN(baseDate.getTime())) baseDate = new Date();
                if (baseDate < new Date()) baseDate.setFullYear(baseDate.getFullYear() + 10);

                const official = findNextWorkingDay(baseDate, TURKEY_HOLIDAYS);
                const operational = new Date(official);
                operational.setDate(operational.getDate() - 3);
                while (isWeekend(operational) || isHoliday(operational, TURKEY_HOLIDAYS)) operational.setDate(operational.getDate() - 1);

                taskData.officialDueDate = official.toISOString();
                taskData.operationalDueDate = operational.toISOString();
                taskData.dueDate = operational.toISOString();
                taskData.details.officialDueDateDetails = {
                    finalOfficialDueDate: official.toISOString().split('T')[0],
                    renewalDate: baseDate.toISOString().split('T')[0],
                    adjustments: []
                };
                const dateStr = baseDate.toLocaleDateString('tr-TR');
                if (taskData.description && !taskData.description.includes('Yenileme tarihi:')) {
                    const separator = taskData.description.endsWith('.') ? ' ' : '. ';
                    taskData.description += `${separator}Yenileme tarihi: ${dateStr}.`;
                }
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
                    taskData.dueDate = operationalDate.toISOString(); 
                    taskData.officialDueDate = adjustedOfficial.toISOString();
                    taskData.operationalDueDate = operationalDate.toISOString();
                    taskData.details.bulletinNo = bulletinData.bulletinNo;
                    taskData.details.bulletinDate = bulletinData.bulletinDate;
                }
            }
        } catch (e) { }
    }

    _enrichTaskWithParties(taskData, taskType, relatedParties, singleParty, ipRecord) {
        const tIdStr = String(taskType.id);

        if (RELATED_PARTY_REQUIRED.has(tIdStr)) {
            const owners = (Array.isArray(relatedParties) ? relatedParties : []).map(p => String(p.id)).filter(Boolean);
            if (owners.length) taskData.taskOwner = owners;
            
            if (relatedParties && relatedParties.length) {
                taskData.details.relatedParties = relatedParties.map(p => ({ id: p.id, name: p.name, email: p.email }));
            }
        } 
        else {
            if (ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                taskData.taskOwner = ipRecord.applicants.map(a => String(a.id)).filter(Boolean);
            }
        }

        const objectionIds = ['7', '19', '20'];
        if (objectionIds.includes(tIdStr)) {
            const opponent = (relatedParties && relatedParties.length) ? relatedParties[0] : singleParty;
            if (opponent) {
                taskData.opponentId = opponent.id;
                taskData.details.opponent = { id: opponent.id, name: opponent.name, email: opponent.email };
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
        let niceClassesSimple = [];

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
                niceClassesSimple = goodsAndServicesByClass.map(g => g.classNo);
            }
        } catch (e) { }

        const applicantsData = selectedApplicants.map(p => ({
            id: p.id,
            name: p.name,
            address: p.address || '',
            country: p.country || '',
            role: 'applicant'
        }));

        const newRecordData = {
            title: cleanBrandName,
            brandText: cleanBrandName,
            type: 'trademark',
            recordOwnerType: 'self',
            portfoyStatus: 'active',
            status: 'filed',
            applicationDate: new Date().toISOString().split('T')[0],
            applicationNumber: null,
            registrationDate: null,
            registrationNumber: null,
            renewalDate: (() => {
                const d = new Date();
                d.setFullYear(d.getFullYear() + 10);
                return d.toISOString().split('T')[0];
            })(),
            brandType: brandType,
            brandCategory: brandCategory,
            description: null,
            nonLatinAlphabet: nonLatin,
            brandImageUrl: brandImageUrl,
            niceClasses: niceClassesSimple,
            goodsAndServicesByClass: goodsAndServicesByClass,
            applicants: applicantsData,
            priorities: priorities || [],
            origin: origin,
            countryCode: originCountry,
            source: 'task_creation',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await ipRecordsService.createRecord(newRecordData);
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

            let subjectAssetData = null;
            if (selectedIpRecord) {
                subjectAssetData = {
                    id: selectedIpRecord.id,
                    type: selectedIpRecord._source === 'suit' ? 'suit' : 'ipRecord'
                };
            }

            let suitTitle = taskData.title; 

            if (selectedIpRecord) {
                if (selectedIpRecord._source === 'suit') {
                    suitTitle = selectedIpRecord.suitDetails?.caseNo || 
                                selectedIpRecord.fileNumber || 
                                selectedIpRecord.displayFileNumber || 
                                selectedIpRecord.caseNo ||
                                selectedIpRecord.title; 
                } else {
                    suitTitle = selectedIpRecord.title || selectedIpRecord.markName;
                }
            }

            const suitRow = {
                file_no: document.getElementById('suitCaseNo')?.value || null,
                court_name: finalCourtName,
                plaintiff: document.getElementById('clientRole')?.value === 'davaci' ? client?.name : document.getElementById('opposingParty')?.value,
                defendant: document.getElementById('clientRole')?.value === 'davali' ? client?.name : document.getElementById('opposingParty')?.value,
                subject: suitTitle,
                status: 'continue',
                details: {
                    title: suitTitle,
                    transactionTypeId: selectedTaskType.id,
                    suitType: selectedTaskType.alias || selectedTaskType.name,
                    documents: taskData.documents || [],
                    suitDetails: {
                        court: finalCourtName,
                        description: document.getElementById('suitDescription')?.value || '',
                        opposingParty: document.getElementById('opposingParty')?.value || '',
                        opposingCounsel: document.getElementById('opposingCounsel')?.value || '',
                        openingDate: document.getElementById('suitOpeningDate')?.value || new Date().toISOString(),
                        caseNo: document.getElementById('suitCaseNo')?.value || '' 
                    },
                    clientRole: document.getElementById('clientRole')?.value || '',
                    client: client ? { id: client.id, name: client.name, email: client.email } : null,
                    subjectAsset: subjectAssetData,
                    suitStatus: 'continue',
                    portfolioStatus: 'active',
                    origin: document.getElementById('originSelect')?.value || 'TURKEY',
                    relatedTaskId: taskId
                },
                created_at: new Date().toISOString()
            };

            const { data: newSuit, error: suitError } = await supabase.from('suits').insert(suitRow).select('id').single();
            if (suitError) throw new Error("Dava kaydedilirken hata oluştu: " + suitError.message);
            const newSuitId = newSuit.id;
            
            await supabase.from('transactions').insert({
                ip_record_id: newSuitId,
                transaction_type_id: selectedTaskType.id,
                description: 'Dava Açıldı',
                transaction_hierarchy: 'parent',
                details: {
                    taskId: String(taskId),
                    creationDate: new Date().toISOString()
                },
                created_at: new Date().toISOString()
            });

        } catch (error) { 
            console.error('Suit oluşturma hatası:', error); 
        }
    }

    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        let hierarchy = 'parent';
        let extraData = {};
        const tId = String(taskType.id);
        
        const needsParent = ['8', '21', '37'].includes(tId);

        if (needsParent) {
            if (this.selectedParentTransactionId) {
                hierarchy = 'child';
                extraData.parentId = this.selectedParentTransactionId;
            }
        }

        const formattedDocs = (taskDocuments || []).map(d => ({
            name: d.name,
            url: d.url,
            downloadURL: d.url,
            type: d.type,
            uploadedAt: d.uploadedAt
        }));

        const isSuit = state.selectedIpRecord && state.selectedIpRecord._source === 'suit';
        const collectionName = isSuit ? 'suits' : 'ip_records'; // Sadece log için

        const transactionData = {
            ip_record_id: String(recordId),
            transaction_type_id: String(taskType.id),
            description: `${taskType.name} işlemi.`,
            transaction_hierarchy: hierarchy,
            details: {
                taskId: String(taskId),
                documents: formattedDocs, 
                ...extraData
            },
            created_at: new Date().toISOString()
        };

        try {
            await supabase.from('transactions').insert(transactionData);
        } catch (error) {
            console.error(`Transaction ekleme hatası (${collectionName}):`, error);
        }
    }
}