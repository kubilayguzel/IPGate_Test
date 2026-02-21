import { taskService, ipRecordsService, accrualService, db, authService } from '../../firebase-config.js';
import { doc, getDoc, updateDoc, collection, addDoc, setDoc, runTransaction, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { TASK_IDS, RELATED_PARTY_REQUIRED, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js'; 
import { addMonthsToDate, findNextWorkingDay, isWeekend, isHoliday, TURKEY_HOLIDAYS } from '../../utils.js';
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class TaskSubmitHandler {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.selectedParentTransactionId = null;
    }

    // --- ANA GÖNDERİM FONKSİYONU (GÜNCELLENMİŞ) ---
    async handleFormSubmit(e, state) {
        e.preventDefault();
        
        console.log('🚀 [DEBUG] handleFormSubmit tetiklendi.');
        
        // State referansını alıyoruz
        const { 
            selectedTaskType, selectedIpRecord, selectedRelatedParties, selectedRelatedParty,
            selectedApplicants, priorities, selectedCountries, uploadedFiles,
            accrualData, isFreeTransaction 
        } = state;

        if (!selectedTaskType) {
            alert('Geçerli bir işlem tipi seçmediniz.');
            return;
        }

        const submitBtn = document.getElementById('saveTaskBtn');
        if (submitBtn) submitBtn.disabled = true;

        try {
            // 1. Temel Veriler
            const assignedTo = document.getElementById('assignedTo')?.value;
            const assignedUser = state.allUsers.find(u => u.id === assignedTo);
            
            let taskTitle = document.getElementById('taskTitle')?.value;
            let taskDesc = document.getElementById('taskDescription')?.value;

            // Marka Başvurusu Özel Başlık
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

            // 🔥 ADIM 3: Yeni eklenecek denormalize alanların hesaplanması (Bülten, Dava ve Yeni Başvuru uyumlu)
            let ipAppNo = "-";
            let ipTitle = "-";
            let ipAppName = "-";

            if (selectedIpRecord) {
                // Başvuru Numarası Çözümleme
                ipAppNo = selectedIpRecord.applicationNumber || selectedIpRecord.applicationNo || selectedIpRecord.appNo || selectedIpRecord.caseNo || "-";
                
                // Başlık/Marka Adı Çözümleme
                ipTitle = selectedIpRecord.title || selectedIpRecord.markName || selectedIpRecord.brandText || "-";
                
                // Kişi (Müvekkil/Sahip) Çözümleme
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
                // Yeni Marka Başvurusu durumu (İşlem anında ipRecord henüz oluşmadıysa UI'dan çekiyoruz)
                ipTitle = document.getElementById('brandExampleText')?.value || taskTitle || "-";
                if (selectedApplicants && selectedApplicants.length > 0) {
                    ipAppName = selectedApplicants[0].name || "-";
                }
            }

            // Temel Task Objesini Oluşturma
            let taskData = {
                taskType: selectedTaskType.id,
                title: taskTitle,
                description: taskDesc,
                priority: document.getElementById('taskPriority')?.value || 'medium',
                assignedTo_uid: assignedUser ? assignedUser.id : null,
                assignedTo_email: assignedUser ? assignedUser.email : null,
                status: 'open',
                relatedIpRecordId: selectedIpRecord ? selectedIpRecord.id : null,
                relatedIpRecordTitle: selectedIpRecord ? (selectedIpRecord.title || selectedIpRecord.markName) : taskTitle,
                
                // 🔥 YENİ EKLENEN DENORMALIZE ALANLAR
                iprecordApplicationNo: ipAppNo,
                iprecordTitle: ipTitle,
                iprecordApplicantName: ipAppName,
                // =====================================

                details: {},
                documents: [], 
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            };

            const manualDueDate = document.getElementById('taskDueDate')?.value;
            if (manualDueDate) {
                taskData.dueDate = Timestamp.fromDate(new Date(manualDueDate));
            }

            // 2. İlgili Taraflar
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
            
            // 2.5. Bülten Kaydı Dönüştürme
            if (selectedIpRecord && (selectedIpRecord.source === 'bulletin' || selectedIpRecord._source === 'bulletin' || !selectedIpRecord.recordOwnerType)) {
                console.log('📢 Bülten kaydı tespit edildi, ipRecords\'a dönüştürülüyor...');
                const newRealRecordId = await this._createRecordFromBulletin(selectedIpRecord);
                if (newRealRecordId) {
                    console.log('✅ Yeni IP Record oluşturuldu ID:', newRealRecordId);
                    taskData.relatedIpRecordId = newRealRecordId;
                    state.selectedIpRecord.id = newRealRecordId;
                    state.selectedIpRecord.source = 'created_from_bulletin'; 
                    state.selectedIpRecord._source = 'ipRecord'; 
                }
            }

            // 3. Marka Başvurusu Kaydı
            if (selectedTaskType.alias === 'Başvuru' && selectedTaskType.ipType === 'trademark') {
                const newRecordId = await this._handleTrademarkApplication(state, taskData);
                if (!newRecordId) throw new Error("Marka kaydı oluşturulamadı.");
                taskData.relatedIpRecordId = newRecordId;
            }

            // 4. Tarih Hesaplama
            await this._calculateTaskDates(taskData, selectedTaskType, selectedIpRecord);

            // 4.5. DOSYA YÜKLEME İŞLEMİ (DÜZELTİLDİ: IF KALDIRILDI)
            // Artık işlem tipi ne olursa olsun (Marka Başvurusu dahil) yüklenen dosyalar işlenir.
            console.log('📂 [DEBUG] Dosya yükleme işlemi başlatılıyor...');
            
            if (uploadedFiles && uploadedFiles.length > 0) {
                console.log(`📤 [DEBUG] ${uploadedFiles.length} adet dosya yükleniyor...`);
                const docs = [];
                for (const file of uploadedFiles) {
                    const path = `task-documents/${Date.now()}_${file.name}`;
                    try {
                        const url = await this.dataManager.uploadFileToStorage(file, path);
                        console.log('✅ [DEBUG] Dosya Yüklendi:', file.name, url);
                        docs.push({
                            name: file.name,
                            url: url,
                            type: file.type,
                            uploadedAt: new Date().toISOString()
                        });
                    } catch (err) {
                        console.error('Dosya yüklenirken hata:', err);
                    }
                }
                taskData.documents = docs;
            } else {
                console.log('ℹ️ [DEBUG] Yüklenecek dosya bulunamadı.');
            }

            // 5. Task Oluştur
            console.log('📤 Task oluşturuluyor:', taskData);
            const taskResult = await taskService.createTask(taskData);
            if (!taskResult.success) throw new Error(taskResult.error);

            // 6. Dava Kaydı
            if (selectedTaskType.ipType === 'suit' || selectedTaskType.id === '49') {
                await this._handleSuitCreation(state, taskData, taskResult.id);
            }

            // 7. Transaksiyon Ekleme
            if (taskData.relatedIpRecordId) {
                console.log('🚀 [DEBUG] Transaction ekleniyor. Dokümanlar:', taskData.documents);
                await this._addTransactionToPortfolio(
                    taskData.relatedIpRecordId, 
                    selectedTaskType, 
                    taskResult.id, 
                    state, 
                    taskData.documents // Dokümanları buraya gönderiyoruz
                );
            }

            // 8. Tahakkuk
            await this._handleAccrualLogic(taskResult.id, taskData.title, selectedTaskType, state, accrualData, isFreeTransaction);

            alert('İş başarıyla oluşturuldu!');
            window.location.href = 'task-management.html';

        } catch (error) {
            console.error('Submit Hatası:', error);
            alert('İşlem sırasında hata oluştu: ' + error.message);
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    // ============================================================
    // YARDIMCI METOTLAR
    // ============================================================
    async _resolveImageUrl(path) {
        if (!path) return null;
        if (/^https?:\/\//i.test(path)) return path;

        try {
            const storage = getStorage();
            const url = await getDownloadURL(ref(storage, String(path)));
            return url;
        } catch (e) {
            console.warn('⚠️ getDownloadURL başarısız, path olduğu gibi bırakılıyor:', e);
            // Public mirror fallback (isteğe bağlı, create-portfolio dosyasındaki gibi)
            return `https://kubilayguzel.github.io/EVREKA_IP/public/${String(path).replace(/^\/+/, '')}`;
        }
    }

    /**
     * GÜVENLİ VERSİYON: Bülten kaydını (Third Party) gerçek IP Record'a dönüştürür.
     * UI hatalarını önlemek için boş array ve default değerler titizlikle atanır.
     */
    async _createRecordFromBulletin(bulletinRecord) {
        try {
            const now = new Date().toISOString();

            // 1. Sınıf Bilgilerini Parse Et (Number Array)
            let niceClasses = [];
            if (bulletinRecord.niceClasses) {
                if (Array.isArray(bulletinRecord.niceClasses)) {
                    niceClasses = bulletinRecord.niceClasses;
                } else if (typeof bulletinRecord.niceClasses === 'string') {
                    niceClasses = bulletinRecord.niceClasses
                        .split(/[,/]/)
                        .map(s => s.trim())
                        .map(Number)
                        .filter(n => !isNaN(n) && n > 0);
                }
            } else if (bulletinRecord.classNumbers && Array.isArray(bulletinRecord.classNumbers)) {
                 // create-portfolio dosyasındaki gibi classNumbers alanına da bak
                 niceClasses = bulletinRecord.classNumbers;
            }

            // 2. Sınıfları Detaylı Obje Dizisine Çevir (create-portfolio uyumu)
            const goodsAndServices = niceClasses.map(classNum => ({
                niceClass: classNum.toString(),
                description: `Sınıf ${classNum} - Bulletin kaydından alınan`,
                status: 'active'
            }));

            // 3. Sahip Bilgisini Formatla (create-portfolio uyumu: ID üretmeli)
            let applicants = [];
            if (Array.isArray(bulletinRecord.holders) && bulletinRecord.holders.length > 0) {
                applicants = bulletinRecord.holders.map(holder => ({
                    id: `bulletin_holder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: holder.name || holder.holderName || holder.title || holder,
                    address: holder.address || holder.addressText || null,
                    country: holder.country || holder.countryCode || null,
                }));
            } else {
                // Eğer holders dizisi yoksa tekil alandan üret
                const holderName = bulletinRecord.holder || bulletinRecord.applicantName || 'Bilinmeyen Sahip';
                applicants = [{
                    id: `bulletin_holder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: holderName,
                    address: bulletinRecord.address || '',
                    country: '',
                    role: 'owner'
                }];
            }

            // 4. Tarih Formatlama
            const appDate = bulletinRecord.applicationDate || bulletinRecord.adDate || null;

            // 5. Görsel Yolu (Tüm varyasyonları kontrol et ve URL'i çözümle)
            const rawImageSource = bulletinRecord.imagePath || 
                                   bulletinRecord.imageUrl || 
                                   bulletinRecord.image || 
                                   bulletinRecord.brandImageUrl || 
                                   bulletinRecord.publicImageUrl || 
                                   null;

            // URL çözümleme (Storage path -> Download URL)
            const brandImageUrl = await this._resolveImageUrl(rawImageSource);
            
            // Eğer kaynak bir http linki değilse (yani storage path ise) imagePath olarak sakla
            const imagePath = (rawImageSource && !/^https?:\/\//i.test(rawImageSource)) ? rawImageSource : null;

            // 6. Veri Objesini Oluştur (Referans dosya ile birebir aynı yapı)
            const newRecordData = {
                // -- Temel Bilgiler --
                title: bulletinRecord.markName || bulletinRecord.title || `Başvuru No: ${bulletinRecord.applicationNo}`,
                type: 'trademark',
                portfoyStatus: 'active',
                status: 'published_in_bulletin', // ✅ Referans dosyadaki statü
                recordOwnerType: 'third_party',

                // -- Başvuru/Tescil --
                applicationNumber: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null,
                applicationNo: bulletinRecord.applicationNo || bulletinRecord.applicationNumber || null, // ✅ İkisi de olsun
                applicationDate: appDate,
                registrationNumber: null,
                registrationDate: null,
                renewalDate: null,

                // -- Marka --
                brandText: bulletinRecord.markName || null,
                markName: bulletinRecord.markName || null, // ✅ Referans dosyadaki tekrar
                brandImageUrl: brandImageUrl,
                imagePath: imagePath,
                description: `Yayına itiraz işi oluşturulurken otomatik açılan 3.taraf kaydı.`,

                // -- İlişkiler --
                applicants: applicants,
                priorities: [],
                goodsAndServices: goodsAndServices, // ✅ Detaylı sınıf yapısı
                niceClasses: niceClasses, // ✅ Basit liste (UI için gerekebilir)

                // -- Detaylar (Referans dosya yapısı) --
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

                // -- Sistem --
                source: 'task_creation',
                createdFrom: 'bulletin_record', // ✅ Referans dosyadaki etiket
                createdBy: 'task_ui_automation',
                createdAt: now,
                updatedAt: now
            };

            // Firestore'a kaydet
            const result = await ipRecordsService.createRecord(newRecordData);
            
            if (result.success) {
                console.log(`✅ Bülten kaydı (create-portfolio uyumlu) oluşturuldu. ID: ${result.id}`);
                return result.id;
            } else {
                console.error("❌ Bülten kaydı dönüştürme hatası:", result.error);
                throw new Error("Seçilen bülten kaydı portföye eklenemedi: " + result.error);
            }
        } catch (error) {
            console.error("❌ _createRecordFromBulletin Genel Hatası:", error);
            throw error; 
        }
    }

    /**
     * TAHAKKUK MANTIĞI
     */
    async _handleAccrualLogic(taskId, taskTitle, taskType, state, accrualData, isFree) {
        // SENARYO 1: Ücretsiz İşlem
        if (isFree) {
            console.log('🆓 "Ücretsiz İşlem" seçildi. Tahakkuk atlanıyor.');
            return; 
        }

        // SENARYO 2: Anlık Tahakkuk (Veri Dolu)
        const hasValidAccrualData = accrualData && (
            (accrualData.officialFee?.amount > 0) || 
            (accrualData.serviceFee?.amount > 0)
        );

        if (hasValidAccrualData) {
            console.log('💰 Veri girildiği için anlık tahakkuk oluşturuluyor...');
            
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
                    } catch (uploadErr) {
                        console.error('Dosya yükleme hatası:', uploadErr);
                    }
                }
            }

            const finalAccrual = {
                taskId: taskId,
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
                console.error('❌ Tahakkuk ekleme hatası:', accrualResult.error);
                alert('İş oluşturuldu ancak tahakkuk kaydedilemedi: ' + accrualResult.error);
            }
            return; 
        }

        // SENARYO 3: Ertelenmiş Tahakkuk
        console.log('⏳ Tahakkuk verisi girilmedi. Özel ID (T-XX) ile görev açılıyor...');

        let assignedUid = "dqk6yRN7Kwgf6HIJldLt9Uz77RU2"; 
        let assignedEmail = "selcanakoglu@evrekapatent.com";

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
        } catch (e) { console.warn('Atama kuralı hatası (Task 53)', e); }

        try {
            const counterRef = doc(db, 'counters', 'tasks_accruals');

            await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentCount = counterDoc.exists() ? (counterDoc.data().count || 0) : 0;
                const newCount = currentCount + 1;
                const newCustomId = `T-${newCount}`;

                transaction.set(counterRef, { count: newCount }, { merge: true });

                // 🔥 ADIM 3: Tahakkuk alt görevi için de aynı alanları çıkarıyoruz
                let accAppNo = "-";
                let accTitle = taskTitle;
                let accAppName = "-";

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
                    id: newCustomId, 
                    taskType: "53",
                    title: `Tahakkuk Oluşturma: ${taskTitle}`,
                    description: `"${taskTitle}" işi oluşturuldu ancak tahakkuk girilmedi. Lütfen finansal kaydı oluşturun.`,
                    priority: 'high',
                    status: 'pending',
                    assignedTo_uid: assignedUid,
                    assignedTo_email: assignedEmail,
                    relatedTaskId: taskId, 
                    relatedIpRecordId: state.selectedIpRecord ? state.selectedIpRecord.id : null,
                    relatedIpRecordTitle: state.selectedIpRecord ? (state.selectedIpRecord.title || state.selectedIpRecord.markName) : taskTitle,
                    
                    // 🔥 YENİ EKLENEN ALANLAR
                    iprecordApplicationNo: accAppNo,
                    iprecordTitle: accTitle,
                    iprecordApplicantName: accAppName,

                    details: {
                        source: 'automatic_accrual_assignment',
                        originalTaskType: taskType.alias || taskType.name
                    },
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now()
                };

                const newTaskRef = doc(db, 'tasks', newCustomId);
                transaction.set(newTaskRef, accrualTaskData);
            });
            console.log('✅ Tahakkuk görevi özel ID ile oluşturuldu.');

        } catch (e) {
            console.error('❌ Özel ID oluşturma hatası:', e);
            alert('Tahakkuk görevi oluşturulurken bir hata meydana geldi.');
        }
    }

    // A) TARİH HESAPLAMA
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

                taskData.officialDueDate = Timestamp.fromDate(official);
                taskData.operationalDueDate = Timestamp.fromDate(operational);
                taskData.dueDate = Timestamp.fromDate(operational);
                taskData.officialDueDateDetails = {
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
                    taskData.dueDate = Timestamp.fromDate(operationalDate); 
                    taskData.officialDueDate = Timestamp.fromDate(adjustedOfficial);
                    taskData.operationalDueDate = Timestamp.fromDate(operationalDate);
                    taskData.details.bulletinNo = bulletinData.bulletinNo;
                    taskData.details.bulletinDate = bulletinData.bulletinDate;
                }
            }
        } catch (e) { console.warn('Tarih hesaplama hatası:', e); }
    }

    // B) TARAFLAR VE İŞ SAHİBİ (TASK OWNER) BELİRLEME
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
                taskData.opponent = { id: opponent.id, name: opponent.name, email: opponent.email };
                taskData.details.opponent = taskData.opponent;
            }
        }
    }

    // C) MARKA BAŞVURUSU
    async _handleTrademarkApplication(state, taskData) {
        const { selectedApplicants, priorities, uploadedFiles, selectedTaskType } = state;
        
        let brandImageUrl = null;
        if (uploadedFiles.length > 0) {
            const file = uploadedFiles[0];
            const path = `brand-images/${Date.now()}_${file.name}`;
            try {
                brandImageUrl = await this.dataManager.uploadFileToStorage(file, path);
            } catch (e) { console.error('Görsel yükleme hatası:', e); }
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
        } catch (e) { console.warn('Nice classes parsing hatası:', e); }

        const recordOwnerType = 'self'; 

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
            recordOwnerType: recordOwnerType,
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
            createdViaTaskId: taskData.id || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const result = await ipRecordsService.createRecord(newRecordData);
        return result.success ? result.id : null;
    }
    
    // D) DAVA KAYDI
    async _handleSuitCreation(state, taskData, taskId) {
        const { selectedTaskType, selectedIpRecord, selectedRelatedParties } = state;
        const PARENT_SUIT_IDS = ['49', '54', '55', '56', '57', '58']; 
        const isParentCreation = PARENT_SUIT_IDS.includes(String(selectedTaskType.id));

        if (!isParentCreation) {
            console.log('ℹ️ Bu bir alt işlem (Child), yeni dava kartı oluşturulmuyor.');
            return; 
        }

        try {
            const client = selectedRelatedParties && selectedRelatedParties.length > 0 ? selectedRelatedParties[0] : null;
            
            const courtSelect = document.getElementById('courtName');
            const customInput = document.getElementById('customCourtInput');
            let finalCourtName = '';

            if (courtSelect) {
                if (courtSelect.value === 'other' && customInput) {
                    finalCourtName = customInput.value.trim();
                } else {
                    finalCourtName = courtSelect.value;
                }
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

            const newSuitData = {
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
                createdAt: new Date().toISOString(),
                relatedTaskId: taskId
            };

            const suitsRef = collection(db, 'suits');
            const suitDocRef = await addDoc(suitsRef, newSuitData);
            const newSuitId = suitDocRef.id;

            console.log('✅ Yeni Dava Kartı Oluşturuldu ID:', newSuitId);
            
            const initialTransaction = {
                type: selectedTaskType.id,
                description: 'Dava Açıldı',
                transactionHierarchy: 'parent',
                taskId: String(taskId), // 🔥 SADECE taskId
                createdAt: Timestamp.now(),
                creationDate: new Date().toISOString()
            };

            const transactionsRef = collection(db, 'suits', newSuitId, 'transactions');
            await addDoc(transactionsRef, initialTransaction);

        } catch (error) { 
            console.error('Suit oluşturma hatası:', error); 
            alert('Dava kartı oluşturulurken hata meydana geldi: ' + error.message);
        }
    }


    // E) PORTFOLYO GEÇMİŞİ
    async _addTransactionToPortfolio(recordId, taskType, taskId, state, taskDocuments = []) {
        console.log('📥 [DEBUG] _addTransactionToPortfolio içine girildi. taskDocuments:', taskDocuments);
        let hierarchy = 'parent';
        let extraData = {};
        const tId = String(taskType.id);
        
        // 🔥 DÜZELTME: '37' (İtiraza Ek Belge) işlemi de eklendi
        const needsParent = ['8', '21', '37'].includes(tId);

        if (needsParent) {
            if (this.selectedParentTransactionId) {
                hierarchy = 'child';
                extraData.parentId = this.selectedParentTransactionId;
            }
        }

        // Doküman formatını hazırla (Hem 'url' hem 'downloadURL' ekliyoruz, garanti olsun)
        const formattedDocs = (taskDocuments || []).map(d => ({
            name: d.name,
            url: d.url,
            downloadURL: d.url, // Portföy detay sayfası genelde bunu bekler
            type: d.type,
            uploadedAt: d.uploadedAt
        }));

        const transactionData = {
            type: taskType.id,
            description: `${taskType.name} işlemi.`,
            transactionHierarchy: hierarchy,
            taskId: String(taskId), // 🔥 SADECE taskId
            createdAt: Timestamp.now(), 
            timestamp: new Date().toISOString(),
            documents: formattedDocs, 
            ...extraData
        };

        const isSuit = state.selectedIpRecord && state.selectedIpRecord._source === 'suit';
        const collectionName = isSuit ? 'suits' : 'ipRecords';

        try {
            const transactionsRef = collection(db, collectionName, recordId, 'transactions');
            await addDoc(transactionsRef, transactionData);
            console.log(`✅ Transaction eklendi (Dosyalı): ${collectionName}/${recordId}/transactions`);
        } catch (error) {
            console.error(`Transaction ekleme hatası (${collectionName}):`, error);
        }
    }

    // F) OTOMASYON
    async _handleOppositionAutomation(taskId, taskType, ipRecord) {
        if (window.portfolioByOppositionCreator && typeof window.portfolioByOppositionCreator.handleTransactionCreated === 'function') {
            try {
                const result = await window.portfolioByOppositionCreator.handleTransactionCreated({
                    id: taskId,
                    specificTaskType: taskType.id,
                    selectedIpRecord: ipRecord
                });
                if (result?.success) console.log('Otomasyon sonucu:', result);
            } catch (e) { console.warn('Otomasyon hatası:', e); }
        }
    }
}