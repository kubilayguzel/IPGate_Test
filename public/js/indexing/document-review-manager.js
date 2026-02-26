// public/js/indexing/document-review-manager.js

import { 
    authService, 
    ipRecordsService, 
    transactionTypeService, 
    taskService,
    supabase 
} from '../../supabase-config.js';

import { 
    showNotification, 
    debounce, 
    addMonthsToDate, 
    findNextWorkingDay, 
    isWeekend, 
    isHoliday, 
    TURKEY_HOLIDAYS,
    generateUUID,
    formatToTRDate
} from '../../utils.js';
import '../simple-loading.js';

const UNINDEXED_PDFS_COLLECTION = 'unindexed_pdfs';
const STORAGE_BUCKET = 'task_documents'; // Supabase Ortak Bucket
const SELCAN_UID = 'dqk6yRN7Kwgf6HIJldLt9Uz77RU2'; 
const SELCAN_EMAIL = 'selcanakoglu@evrekapatent.com';

export class DocumentReviewManager {
    constructor() {
        this.pdfId = new URLSearchParams(window.location.search).get('pdfId');
        const params = new URLSearchParams(window.location.search);
        this.prefillRecordId = params.get('recordId');     // seçili kayıt
        this.prefillQuery = params.get('q');               // kayıt ara
        this.prefillDeliveryDate = params.get('deliveryDate'); // tebliğ tarihi (yyyy-MM-dd)
        this.currentUser = null;
        this.pdfData = null;
        this.matchedRecord = null;
        this.analysisResult = null;
        this.currentTransactions = []; 
        this.allTransactionTypes = []; 
        this.countryMap = new Map();
        this.init();
    }

    toYMD(raw) {
        if (!raw) return '';
        let d = raw;

        if (typeof d === 'string') {
            if (d.includes('T')) d = d.split('T')[0]; 
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            
            const parts = d.split(/[\.\/]/);
            if (parts.length === 3) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }

        if (d && typeof d.toDate === 'function') d = d.toDate();
        else if (d && d.seconds) d = new Date(d.seconds * 1000);

        if (!(d instanceof Date)) d = new Date(d);
        if (isNaN(d.getTime())) return '';

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    async init() {
        const params = new URLSearchParams(window.location.search);
        this.pdfId = params.get('pdfId');
        this.prefillRecordId = params.get('recordId');
        this.prefillQuery = params.get('q');
        this.prefillDeliveryDate = params.get('deliveryDate');

        this.matchedRecord = null;
        this.pdfData = null;
        this.currentTransactions = [];
        this.analysisResult = null;

        const searchInput = document.getElementById('manualSearchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.removeAttribute('data-temp');
        }

        if (!this.pdfId) {
            console.error("PDF ID bulunamadı.");
            return;
        }

        this.currentUser = authService.getCurrentUser();
        this.setupEventListeners();
        if (window.EvrekaDatePicker) window.EvrekaDatePicker.refresh();
        await this.loadCountriesOnly();
        await this.loadTransactionTypes();
        await this.loadData();
    }

    async loadCountriesOnly() {
        try {
            const { data, error } = await supabase.from('common').select('data').eq('id', 'countries').single();
            if (!error && data && data.data && data.data.list) {
                data.data.list.forEach(c => this.countryMap.set(c.code, c.name));
            }
        } catch (e) { console.error("Ülke listesi yüklenemedi:", e); }
    }

    async loadTransactionTypes() {
        try {
            const result = await transactionTypeService.getTransactionTypes();
            if (result.success) this.allTransactionTypes = result.data;
        } catch (error) { console.error('İşlem tipleri yüklenemedi:', error); }
    }

    async extractTextFromPDF(url) {
        try {
            if (!window.pdfjsLib) {
                console.warn('PDF.js kütüphanesi bulunamadı.');
                return null;
            }

            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

            const loadingTask = pdfjsLib.getDocument(url);
            const pdf = await loadingTask.promise;
            let fullText = '';

            const maxPages = Math.min(pdf.numPages, 3);
            for (let i = 1; i <= maxPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + ' ';
            }

            return fullText;
        } catch (error) {
            console.error('PDF metin okuma hatası:', error);
            return null;
        }
    }

    findRegistrationDate(text) {
        if (!text) return null;
        const regex = /(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})\s+tarihinde\s+tescil\s+edilmiştir/i;
        const match = text.match(regex);
        if (match && match[1]) return match[1]; 
        return null;
    }

    findRegistrationNumber(text) {
        if (!text) return null;
        const regex = /No\s*[:.]?\s*(\d{4}[\s\d]+)/i;
        const match = text.match(regex);
        if (match && match[1]) return match[1].trim(); 
        return null;
    }

    setupEventListeners() {
        const saveBtn = document.getElementById('saveTransactionBtn');
        if (saveBtn) {
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            newSaveBtn.addEventListener('click', (e) => { e.preventDefault(); this.handleSave(); });
        }

        const searchInput = document.getElementById('manualSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => this.handleManualSearch(e.target.value), 300));
            document.addEventListener('click', (e) => {
                const searchResults = document.getElementById('manualSearchResults');
                if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                    searchResults.style.display = 'none';
                }
            });
        }

        const parentSelect = document.getElementById('parentTransactionSelect');
        if (parentSelect) parentSelect.addEventListener('change', () => this.updateChildTransactionOptions());

        const childSelect = document.getElementById('detectedType');
        const dateInput = document.getElementById('detectedDate');
        
        if (childSelect) {
            childSelect.addEventListener('change', () => {
                this.checkSpecialFields();      
                this.updateCalculatedDeadline(); 
            });
        }
        
        if (dateInput) {
            dateInput.addEventListener('change', () => {
                this.updateCalculatedDeadline(); 
            });
        }

        this._setupPdfDropzone('oppositionPetitionDropzone', 'oppositionPetitionFile', 'oppositionPetitionFileName');
        this._setupPdfDropzone('oppositionEpatsDropzone', 'oppositionEpatsPetitionFile', 'oppositionEpatsFileName');
    }

    _setupPdfDropzone(dropzoneId, inputId, filenameLabelId) {
        const dz = document.getElementById(dropzoneId);
        const input = document.getElementById(inputId);
        const fileLabel = document.getElementById(filenameLabelId);
        if (!dz || !input) return;

        const setFilename = (name) => {
            if (fileLabel) fileLabel.textContent = name || 'Dosya seçilmedi';
        };

        dz.addEventListener('click', () => input.click());
        dz.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });

        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            setFilename(f ? f.name : 'Dosya seçilmedi');
        });

        const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };

        ['dragenter', 'dragover'].forEach(evt => dz.addEventListener(evt, (e) => { prevent(e); dz.classList.add('drag-over'); }));
        ['dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, (e) => { prevent(e); dz.classList.remove('drag-over'); }));

        dz.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files;
            if (!files || !files.length) return;
            const file = files[0];
            if (files.length > 1) showNotification('Birden fazla dosya bırakıldı. İlk dosya seçildi.', 'warning');
            
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                showNotification('Lütfen sadece PDF dosyası yükleyin.', 'error');
                return;
            }
            try {
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
            } catch (err) {}
            setFilename(file.name);
        });
    }

    updateCalculatedDeadline() {
        const dateVal = document.getElementById('detectedDate').value;
        const typeId = document.getElementById('detectedType').value;
        const displayInput = document.getElementById('calculatedDeadlineDisplay');
        
        if (!dateVal || !typeId || !displayInput) {
            if(displayInput) displayInput.value = "";
            return;
        }

        const typeObj = this.allTransactionTypes.find(t => String(t.id) === String(typeId));
        if (!typeObj || typeObj.duePeriod === undefined) {
            displayInput.value = "Süre tanımlanmamış";
            return;
        }

        const deliveryDate = new Date(dateVal);
        let duePeriod = Number(typeObj.duePeriod || 0);
        
        let officialDate = addMonthsToDate(deliveryDate, duePeriod);
        officialDate = findNextWorkingDay(officialDate, TURKEY_HOLIDAYS);
        
        displayInput.value = officialDate.toLocaleDateString('tr-TR');
    }

    async loadData() {
        if (window.SimpleLoadingController && typeof window.SimpleLoadingController.show === 'function') {
            window.SimpleLoadingController.show({ text: 'PDF yükleniyor', subtext: 'Belge hazırlanıyor, lütfen bekleyin...' });
        }

        try {
            // 🔥 SUPABASE SORGUSU
            const { data: docSnap, error } = await supabase.from(UNINDEXED_PDFS_COLLECTION).select('*').eq('id', String(this.pdfId)).single();
            if (error || !docSnap) throw new Error('PDF kaydı bulunamadı.');
            
            this.pdfData = { 
                id: docSnap.id, 
                ...docSnap,
                fileName: docSnap.file_name,
                fileUrl: docSnap.download_url,
                matchedRecordId: docSnap.matched_record_id,
                tebligTarihi: docSnap.teblig_tarihi || docSnap.tebligTarihi 
            };
            console.log("📄 PDF Verisi Yüklendi:", this.pdfData);

            if (this.pdfData.fileUrl || this.pdfData.downloadURL) {
                const pdfUrl = this.pdfData.fileUrl || this.pdfData.downloadURL;
                this.extractTextFromPDF(pdfUrl).then(text => {
                    if (text) {
                        const regNo = this.findRegistrationNumber(text);
                        if (regNo) {
                            this.extractedRegNo = regNo;
                            const regNoInput = document.getElementById('registry-registration-no');
                            if (regNoInput && regNoInput.offsetParent !== null) {
                                regNoInput.value = regNo;
                                regNoInput.dispatchEvent(new Event('input'));
                            }
                        }

                        const regDate = this.findRegistrationDate(text);
                        if (regDate) {
                            this.extractedRegDate = regDate;
                            const regDateInput = document.getElementById('registry-registration-date');
                            if (regDateInput && regDateInput.offsetParent !== null) { 
                                regDateInput.value = regDate;
                                if(regDateInput._flatpickr) regDateInput._flatpickr.setDate(regDate, true);
                                showNotification(`Tescil tarihi ve numarası belgeden okundu.`, 'info');
                            }
                        }
                    }
                });
            } 

            const dateInput = document.getElementById('detectedDate');
            if (dateInput) {
                const ymd = this.prefillDeliveryDate || this.toYMD(this.pdfData.tebligTarihi);
                if (ymd) {
                    dateInput.value = ymd;
                    if (dateInput._flatpickr) dateInput._flatpickr.setDate(ymd, true);
                } else {
                    dateInput.value = '';
                    if (dateInput._flatpickr) dateInput._flatpickr.clear();
                }
            }

            const searchInput = document.getElementById('manualSearchInput');
            if (searchInput && this.prefillQuery) {
                searchInput.value = this.prefillQuery;
                await this.handleManualSearch(this.prefillQuery);
            }

            const pdfViewerEl = document.getElementById('pdfViewer');
            if (pdfViewerEl) {
                const onLoaded = () => {
                    if (window.SimpleLoadingController && typeof window.SimpleLoadingController.hide === 'function') {
                        window.SimpleLoadingController.hide();
                    }
                    pdfViewerEl.removeEventListener('load', onLoaded);
                };
                pdfViewerEl.addEventListener('load', onLoaded);

                const pdfUrl = this.pdfData.fileUrl || this.pdfData.downloadURL;
                if (pdfUrl) pdfViewerEl.src = pdfUrl;
                else {
                    if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
                }
            } else {
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            }
     
            if (this.prefillRecordId) {
                await this.selectRecord(this.prefillRecordId);
            } else if (this.pdfData.matchedRecordId) {
                await this.selectRecord(this.pdfData.matchedRecordId);
            } else {
                this.renderHeader();
            }

            if (this.pdfData.status === 'indexed') {
                showNotification('⚠️ DİKKAT: Bu belge daha önce indekslenmiş!', 'warning');
            }

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            showNotification('Veri yükleme hatası: ' + error.message, 'error');
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    async selectRecord(recordId) {
        try {
            const result = await ipRecordsService.getRecordById(recordId);
            if (result.success) {
                this.matchedRecord = result.data;

                const manualSearchInput = document.getElementById('manualSearchInput');
                if (manualSearchInput) {
                    manualSearchInput.value = this.matchedRecord.applicationNumber || this.matchedRecord.applicationNo || '';
                }

                let namesList = [];
                const rawApps = this.matchedRecord.applicants || this.matchedRecord.owners || [];
                
                for (const app of rawApps) {
                    if (typeof app === 'string') {
                        namesList.push(app);
                    } else if (app && typeof app === 'object') {
                        if (app.name || app.applicantName) {
                            namesList.push(app.name || app.applicantName);
                        } else if (app.id) {
                            try {
                                const { data: pData } = await supabase.from('persons').select('*').eq('id', String(app.id)).single();
                                if (pData) namesList.push(pData.name || pData.company_name || pData.details?.companyName || '-');
                            } catch (e) { console.error("Kişi bilgisi sorgulanırken hata:", e); }
                        }
                    }
                }
                
                this.matchedRecord.resolvedNames = namesList.length > 0 ? namesList.join(', ') : '-';
                this.renderHeader(); 
                await this.loadParentTransactions(recordId);
                showNotification('Kayıt seçildi: ' + this.matchedRecord.title, 'success');

                document.dispatchEvent(new CustomEvent('record-selected', { detail: { recordId: recordId } }));
            }
        } catch (error) { console.error('Kayıt seçim hatası:', error); }
    }

    async loadParentTransactions(recordId) {
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (!parentSelect) return;
        
        parentSelect.innerHTML = '<option value="">Yükleniyor...</option>';
        
        try {
            const transactionsResult = await ipRecordsService.getRecordTransactions(recordId);
            this.currentTransactions = transactionsResult.success ? transactionsResult.data : [];
            
            parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçiniz --</option>';
            
            if (this.currentTransactions.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = "(Kayıtlı işlem geçmişi yok)";
                opt.disabled = true;
                parentSelect.appendChild(opt);
                return;
            }

            const resolveDate = (item) => {
                try {
                    if (item.timestamp) return new Date(item.timestamp);
                    if (item.creationDate) return new Date(item.creationDate);
                    if (item.created_at) return new Date(item.created_at);
                    if (item.createdAt) return new Date(item.createdAt);
                } catch (e) { return null; }
                return null;
            };

            const parentTransactions = this.currentTransactions
                .filter(t => t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
                .sort((a, b) => {
                    const dateA = resolveDate(a);
                    const dateB = resolveDate(b);
                    return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0); 
                });

            for (const t of parentTransactions) {
                const typeObj = this.allTransactionTypes.find(type => String(type.id) === String(t.type));
                let label = typeObj ? (typeObj.alias || typeObj.name) : (t.description || 'İşlem');
                
                const typeIdStr = String(t.type);
                if (typeIdStr === '20' || typeIdStr === '19' || t.oppositionOwner) {
                    let opponentName = null;

                    if (t.oppositionOwner) {
                        opponentName = t.oppositionOwner;
                    } else if (t.taskId || t.triggeringTaskId) {
                        const targetTaskId = t.taskId || t.triggeringTaskId;
                        try {
                            const taskResult = await taskService.getTaskById(targetTaskId);
                            if (taskResult.success && taskResult.data) {
                                const taskOwner = taskResult.data.taskOwner;
                                const ownerId = Array.isArray(taskOwner) ? taskOwner[0] : taskOwner;
                                
                                if (ownerId) {
                                    const { data: pData } = await supabase.from('persons').select('*').eq('id', String(ownerId)).single();
                                    if (pData) opponentName = pData.name || pData.company_name || null;
                                }
                            }
                        } catch (err) {}
                    }
                    if (opponentName) label += ` [İtiraz Eden: ${opponentName}]`;
                }

                const dateObj = resolveDate(t);
                const dateStr = formatToTRDate(dateObj);
                
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${label} (${dateStr})`;
                parentSelect.appendChild(opt);
            }
        } catch (error) {
            console.error('Transaction yükleme hatası:', error);
            parentSelect.innerHTML = '<option value="">Hata: İşlemler yüklenemedi</option>';
        }
    }

    updateChildTransactionOptions() {
        const parentSelect = document.getElementById('parentTransactionSelect');
        const childSelect = document.getElementById('detectedType');
        const selectedParentTxId = parentSelect.value;
        
        childSelect.innerHTML = '<option value="">-- İşlem Türü Seçiniz --</option>';
        childSelect.disabled = true;
        
        if (!selectedParentTxId) return;
        
        const selectedParentTx = this.currentTransactions.find(t => String(t.id) === String(selectedParentTxId));
        const parentTypeId = selectedParentTx?.type;
        
        const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(parentTypeId));
        
        if (!parentTypeObj || !parentTypeObj.indexFile) {
            console.warn('Bu ana işlem için tanımlı alt işlem bulunamadı.');
            return;
        }
        
        const allowedChildIds = Array.isArray(parentTypeObj.indexFile) ? parentTypeObj.indexFile.map(String) : [];
        const allowedChildTypes = this.allTransactionTypes
            .filter(t => allowedChildIds.includes(String(t.id)))
            .sort((a, b) => (a.order || 999) - (b.order || 999));
            
        allowedChildTypes.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type.id;
            opt.textContent = type.alias || type.name;
            childSelect.appendChild(opt);
        });
        
        childSelect.disabled = false;
        
        if (this.analysisResult && this.analysisResult.detectedType && typeof this.autoSelectChildType === 'function') {
            this.autoSelectChildType(childSelect);
        }
    }

    checkSpecialFields() {
        const childSelect = document.getElementById('detectedType');
        const parentSelect = document.getElementById('parentTransactionSelect');
        if (!childSelect || !parentSelect) return;

        const childTypeId = String(childSelect.value);
        const parentTxId = String(parentSelect.value);

        const oppositionSection = document.getElementById('oppositionSection');
        if (oppositionSection) {
            oppositionSection.style.display = (childTypeId === '27') ? 'block' : 'none';
        }

        const registrationSection = document.getElementById('registry-editor-section'); 
        if (registrationSection) {
            let showRegistration = false;
            
            const selectedOption = childSelect.options[childSelect.selectedIndex];
            const childText = selectedOption ? selectedOption.text.toLowerCase() : '';

            if (childTypeId === '45' || childText.includes('tescil belgesi')) {
                showRegistration = true;
            } else if (childTypeId === '40') {
                if (this.currentTransactions && parentTxId) {
                    const parentTx = this.currentTransactions.find(t => String(t.id) === parentTxId);
                    if (parentTx) {
                        const parentType = String(parentTx.type);
                        if (parentType === '6' || parentType === '17') showRegistration = true;
                    }
                }
            }
            
            registrationSection.style.display = showRegistration ? 'block' : 'none';
            
            const savePortfolioBtn = document.getElementById('save-portfolio-btn'); 
            const indexBtn = document.getElementById('saveTransactionBtn'); 

            if (showRegistration) {
                if (this.extractedRegNo) {
                    const regNoInput = document.getElementById('registry-registration-no');
                    if (regNoInput && !regNoInput.value) {
                        regNoInput.value = this.extractedRegNo;
                        regNoInput.dispatchEvent(new Event('input'));
                    }
                }
                if (this.extractedRegDate) {
                    const regDateInput = document.getElementById('registry-registration-date');
                    if (regDateInput && !regDateInput.value) {
                        regDateInput.value = this.extractedRegDate;
                        if (regDateInput._flatpickr) regDateInput._flatpickr.setDate(this.extractedRegDate, true);
                    }
                }
                
                const statusSelect = document.getElementById('registry-status') || document.getElementById('status');
                if (statusSelect) {
                    statusSelect.value = 'registered'; 
                    if (statusSelect.selectedIndex === -1) {
                        for (let i = 0; i < statusSelect.options.length; i++) {
                            if (statusSelect.options[i].text.toLowerCase().includes('tescilli')) {
                                statusSelect.selectedIndex = i;
                                break;
                            }
                        }
                    }
                    statusSelect.dispatchEvent(new Event('change'));
                }

                if (savePortfolioBtn && indexBtn) {
                    savePortfolioBtn.style.display = 'none'; 
                    indexBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Kaydet ve İndeksle';
                    indexBtn.classList.remove('btn-primary');
                    indexBtn.classList.add('btn-success');
                }
            } else {
                if (savePortfolioBtn && indexBtn) {
                    savePortfolioBtn.style.display = 'inline-block'; 
                    indexBtn.innerHTML = '<i class="fas fa-check mr-2"></i>İndeksle';
                    indexBtn.classList.remove('btn-success');
                    indexBtn.classList.add('btn-primary');
                }
            }
        }
    }

    // 🔥 YENİ: İŞLEM KAYDETME YARDIMCISI (Eksik Metod eklendi)
    async _addTransaction(recordId, txData) {
        const txId = generateUUID();
        const payload = {
            id: txId,
            ip_record_id: recordId,
            transaction_type_id: String(txData.type),
            transaction_hierarchy: txData.transactionHierarchy || 'parent',
            parent_id: txData.parentId || null,
            description: txData.description || '',
            note: txData.notes || null,
            transaction_date: txData.date || txData.timestamp || new Date().toISOString(),
            user_id: txData.userId || this.currentUser?.uid,
            user_email: txData.userEmail || this.currentUser?.email,
            user_name: txData.userName || this.currentUser?.displayName || 'Kullanıcı',
            created_at: new Date().toISOString()
        };
        
        const { error } = await supabase.from('transactions').insert(payload);
        if (error) return { success: false, error: error.message };

        if (txData.documents && txData.documents.length > 0) {
            const docInserts = txData.documents.map(d => ({
                transaction_id: txId,
                document_name: d.name,
                document_url: d.url || d.downloadURL,
                document_type: d.type || 'application/pdf',
                document_designation: d.documentDesignation || 'Evrak',
                uploaded_at: d.uploadedAt || new Date().toISOString()
            }));
            await supabase.from('transaction_documents').insert(docInserts);
        }
        return { success: true, id: txId };
    }

    async handleSave() {
        if (!this.matchedRecord) { alert('Lütfen önce bir kayıt ile eşleştirin.'); return; }
        const parentTxId = document.getElementById('parentTransactionSelect').value;
        const childTypeId = document.getElementById('detectedType').value;
        const deliveryDateStr = document.getElementById('detectedDate').value;
        const notes = document.getElementById('transactionNotes').value;

        if (!parentTxId || !childTypeId || !deliveryDateStr) {
            showNotification('Lütfen tüm zorunlu alanları doldurun.', 'error');
            return;
        }

        try {
            const childSelect = document.getElementById('detectedType');
            const selectedText = childSelect?.options?.[childSelect.selectedIndex]?.text || '';
            const typeText = String(selectedText).toLowerCase();
            const parentTx = this.currentTransactions?.find(t => String(t.id) === String(parentTxId));
            const parentTypeId = String(parentTx?.type || '');

            const isRegistryIndexing =
                String(childTypeId) === '45' ||
                typeText.includes('tescil belgesi') ||
                (String(childTypeId) === '40' && (parentTypeId === '6' || parentTypeId === '17'));

            if (isRegistryIndexing) {
                const regNoEl = document.getElementById('registry-registration-no');
                const regDateEl = document.getElementById('registry-registration-date');
                const regNo = String(regNoEl?.value || '').trim();
                const regDate = String(regDateEl?.value || '').trim();

                if (!regNo || !regDate) {
                    showNotification('Tescil Belgesi için Tescil No ve Tarih zorunludur.', 'error');
                    if (!regNo && regNoEl) regNoEl.focus();
                    else if (!regDate && regDateEl) regDateEl.focus();
                    return;
                }
            }
        } catch (e) {}

        const regSection = document.getElementById('registry-editor-section');
        if (regSection && regSection.style.display !== 'none' && this.matchedRecord) {
            try {
                const regNoVal = document.getElementById('registry-registration-no')?.value;
                const regDateVal = document.getElementById('registry-registration-date')?.value;
                const statusVal = document.getElementById('registry-status')?.value || document.getElementById('status')?.value;

                const updates = {};
                if (regNoVal) updates.registrationNumber = regNoVal;
                if (regDateVal) updates.registrationDate = regDateVal;
                if (statusVal) updates.status = statusVal;

                if (Object.keys(updates).length > 0) {
                    await supabase.from('ip_records').update({ details: { ...this.matchedRecord.details, ...updates } }).eq('id', this.matchedRecord.id);
                    showNotification('Kayıt bilgileri güncellendi.', 'success');
                }
            } catch (err) {
                console.error("Kayıt güncelleme hatası:", err);
                showNotification('Veriler güncellenirken hata oluştu ancak indeksleme devam ediyor.', 'warning');
            }
        }

        const saveBtn = document.getElementById('saveTransactionBtn');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> İşleniyor...';

        try {
            const childTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(childTypeId));
            const parentTx = this.currentTransactions.find(t => String(t.id) === String(parentTxId));
            const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(parentTx?.type));

            let newParentTxId = null;
            let oppositionFileUrl = null;
            let oppositionFileName = null;
            let oppositionEpatsFileUrl = null;
            let oppositionEpatsFileName = null;

            if (String(childTypeId) === '27') { 
                const ownerInput = document.getElementById('oppositionOwnerInput').value;
                const fileInput = document.getElementById('oppositionPetitionFile').files[0];
                const epatsFileInput = document.getElementById('oppositionEpatsPetitionFile')?.files?.[0] || null;
                if (!ownerInput || !fileInput) throw new Error('İtiraz Sahibi ve PDF zorunludur.');

                // Supabase Storage Upload
                const storagePath = `task_documents/${this.matchedRecord.id}/${Date.now()}_${fileInput.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
                const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, fileInput);
                if (upErr) throw upErr;
                const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
                oppositionFileUrl = urlData.publicUrl;
                oppositionFileName = fileInput.name;

                if (epatsFileInput) {
                    const epatsPath = `task_documents/${this.matchedRecord.id}/${Date.now()}_${epatsFileInput.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
                    await supabase.storage.from(STORAGE_BUCKET).upload(epatsPath, epatsFileInput);
                    const { data: epatsUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(epatsPath);
                    oppositionEpatsFileUrl = epatsUrlData.publicUrl;
                    oppositionEpatsFileName = epatsFileInput.name;
                }

                let newParentTypeId = '20'; 
                let newParentDesc = 'Yayına İtiraz (Otomatik)';
                const parentAlias = parentTypeObj?.alias || parentTypeObj?.name || '';
                if (parentAlias.includes('İtiraz') || String(parentTypeObj?.id) === '20') {
                    newParentTypeId = '19'; 
                    newParentDesc = 'Yayına İtirazın Yeniden İncelenmesi (Otomatik)';
                }

                const newParentData = {
                    type: newParentTypeId,
                    description: newParentDesc,
                    transactionHierarchy: 'parent',
                    oppositionOwner: ownerInput,
                    documents: [{
                        name: oppositionFileName,
                        url: oppositionFileUrl,
                        documentDesignation: 'İtiraz Dilekçesi'
                    }],
                    timestamp: new Date().toISOString()
                };
                
                const newParentResult = await this._addTransaction(this.matchedRecord.id, newParentData);
                if (newParentResult.success) newParentTxId = newParentResult.id;
            }

            const finalParentId = newParentTxId || parentTxId;

            // 🔥 GÜNCELLENMİŞ TAŞIMA KODU (Yol Temizleyici Eklendi)
            let finalPdfUrl = this.pdfData.fileUrl || this.pdfData.download_url;
            let finalPdfPath = this.pdfData.file_path || (this.pdfData.details && this.pdfData.details.file_path) || finalPdfUrl;

            if (finalPdfPath && !finalPdfPath.includes('indexed_pdfs/')) {
                let sourcePath = finalPdfPath;
                
                // Eğer yol tam bir URL ise (http ile başlıyorsa) sadece kovanın (bucket) içindeki kısmı ayıklayalım
                if (sourcePath.startsWith('http')) {
                    const urlParts = sourcePath.split('/unindexed_pdfs/');
                    if (urlParts.length > 1) {
                        sourcePath = urlParts[1]; 
                    }
                }
                
                // Olası fazladan klasör isimlerini temizle
                sourcePath = sourcePath.replace('task_documents/', '').replace('unindexed_pdfs/', '');
                
                const cleanName = (this.pdfData.fileName || 'evrak.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const targetPath = `indexed_pdfs/${this.matchedRecord.id}/${Date.now()}_${cleanName}`;
                
                const { error: moveError } = await supabase.storage.from(STORAGE_BUCKET).move(sourcePath, targetPath);
                
                if (!moveError) {
                    finalPdfPath = targetPath;
                    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(targetPath);
                    finalPdfUrl = urlData.publicUrl;
                    console.log("✅ Dosya başarıyla 'indexed_pdfs' klasörüne taşındı.");
                } else {
                    console.warn("⚠️ Dosya taşınamadı:", moveError.message);
                }
            }

            const transactionData = {
                type: childTypeId,
                transactionHierarchy: 'child',
                parentId: finalParentId,
                description: childTypeObj.alias || childTypeObj.name,
                date: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : new Date().toISOString(),
                documents: [{
                    name: this.pdfData.fileName || 'Resmi Yazı.pdf',
                    url: finalPdfUrl,
                    documentDesignation: 'Resmi Yazı'
                }]
            };

            const txResult = await this._addTransaction(this.matchedRecord.id, transactionData);
            const childTransactionId = txResult.id;

            // İş Tetikleme (Task)
            let shouldTriggerTask = false;
            const recordType = (this.matchedRecord.recordOwnerType === 'self') ? 'Portföy' : '3. Taraf';
            
            const pTypeIdStr = String(parentTx?.type || ''); 
            const childTypeIdStr = String(childTypeId);
            
            const taskTriggerMatrix = {
                "20": { "Portföy": ["50", "51"], "3. Taraf": ["51", "52"] },
                "19": { "Portföy": ["32", "33", "34", "35"], "3. Taraf": ["31", "32", "35", "36"] }
            };
            let skipFallback = false;

            if (taskTriggerMatrix[pTypeIdStr]) {
                const allGovernedChildren = [
                    ...(taskTriggerMatrix[pTypeIdStr]["Portföy"] || []),
                    ...(taskTriggerMatrix[pTypeIdStr]["3. Taraf"] || [])
                ];

                if (allGovernedChildren.includes(childTypeIdStr)) {
                    skipFallback = true; 
                    if (taskTriggerMatrix[pTypeIdStr][recordType] && taskTriggerMatrix[pTypeIdStr][recordType].includes(childTypeIdStr)) {
                        shouldTriggerTask = true;
                    }
                }
            }

            if (!shouldTriggerTask && !skipFallback) {
                if (childTypeObj.taskTriggered) shouldTriggerTask = true;
            }

            if (shouldTriggerTask) {
                const deliveryDate = new Date(deliveryDateStr);
                let duePeriod = Number(childTypeObj.duePeriod || 0);
                
                let officialDueDate = addMonthsToDate(deliveryDate, duePeriod);
                officialDueDate = findNextWorkingDay(officialDueDate, TURKEY_HOLIDAYS);
                let taskDueDate = new Date(officialDueDate);
                taskDueDate.setDate(taskDueDate.getDate() - 3);
                while (isWeekend(taskDueDate) || isHoliday(taskDueDate, TURKEY_HOLIDAYS)) {
                    taskDueDate.setDate(taskDueDate.getDate() - 1);
                }

                let assignedUser = { uid: SELCAN_UID, email: SELCAN_EMAIL };
                let relatedPartyData = null;
                let taskOwner = []; 

                if (this.matchedRecord.recordOwnerType === 'self') {
                    if (Array.isArray(this.matchedRecord.applicants) && this.matchedRecord.applicants.length > 0) {
                        taskOwner = this.matchedRecord.applicants.map(app => String(app.id || app.personId)).filter(Boolean);
                        const app = this.matchedRecord.applicants[0];
                        if (app && (app.id || app.personId)) {
                            relatedPartyData = { id: app.id || app.personId, name: app.name || 'İsimsiz' };
                        }
                    }
                } 
                else if (this.matchedRecord.recordOwnerType === 'third_party') {
                    const triggeringTaskId = parentTx?.triggeringTaskId || parentTx?.taskId;
                    if (triggeringTaskId) {
                        try {
                            const prevTaskResult = await taskService.getTaskById(triggeringTaskId);
                            if (prevTaskResult.success && prevTaskResult.data) {
                                const prevTask = prevTaskResult.data;
                                if (prevTask.taskOwner) taskOwner = Array.isArray(prevTask.taskOwner) ? prevTask.taskOwner : [prevTask.taskOwner];
                                if (prevTask.details && prevTask.details.relatedParty) relatedPartyData = prevTask.details.relatedParty;
                            }
                        } catch (e) {}
                    }

                    if ((!taskOwner || taskOwner.length === 0) && this.matchedRecord.client) {
                        const clientId = this.matchedRecord.client.id || this.matchedRecord.client.personId;
                        if (clientId) {
                            taskOwner = [String(clientId)];
                            relatedPartyData = { id: clientId, name: this.matchedRecord.client.name || 'Müvekkil' };
                        }
                    }
                }

                let tasksToCreate = [];
                if (childTypeObj.taskTriggered) tasksToCreate.push(String(childTypeObj.taskTriggered));

                let fetchedPersonName = null;
                if (taskOwner && taskOwner.length > 0) {
                    try {
                        const { data: personData } = await supabase.from('persons').select('*').eq('id', String(taskOwner[0])).single();
                        if (personData) {
                            if (personData.is_evaluation_required === true && !tasksToCreate.includes("66")) {
                                tasksToCreate.push("66");
                            }
                            fetchedPersonName = personData.name || personData.company_name || null;
                        }
                    } catch (e) {}
                }

                let ipAppNo = this.matchedRecord.applicationNumber || this.matchedRecord.applicationNo || "-";
                let ipTitle = this.matchedRecord.title || this.matchedRecord.markName || "-";
                let ipAppName = "-";

                const isSelfPortfolio = (this.matchedRecord.recordOwnerType === 'self');

                if (!isSelfPortfolio) {
                    if (fetchedPersonName) {
                        ipAppName = fetchedPersonName;
                        if (relatedPartyData) relatedPartyData.name = fetchedPersonName;
                    }
                    else if (relatedPartyData && relatedPartyData.name) ipAppName = relatedPartyData.name;
                    else if (parentTx && parentTx.oppositionOwner) ipAppName = parentTx.oppositionOwner;
                    else if (this.matchedRecord.client && this.matchedRecord.client.name) ipAppName = this.matchedRecord.client.name;
                    else ipAppName = "Müvekkil (Belirtilmemiş)";
                } else {
                    ipAppName = this.matchedRecord.resolvedNames || "-";
                    if (ipAppName === "-" || !ipAppName) {
                        if (Array.isArray(this.matchedRecord.applicants) && this.matchedRecord.applicants.length > 0) {
                            ipAppName = this.matchedRecord.applicants[0].name || "-";
                        } else if (this.matchedRecord.client && this.matchedRecord.client.name) {
                            ipAppName = this.matchedRecord.client.name;
                        }
                    }
                }

                for (const tType of tasksToCreate) {
                    let taskDesc = notes || `Otomatik oluşturulan görev.`;
                    let taskStatus = 'awaiting_client_approval';
                    let currentAssignedUser = { uid: SELCAN_UID, email: SELCAN_EMAIL }; 

                    if (String(tType) === "66") {
                        taskDesc = "Müvekkil değerlendirme ayarı açık olduğu için ek olarak tetiklendi.";
                        taskStatus = 'open'; 
                        
                        try {
                            const { data: assignmentRule } = await supabase.from('task_assignments').select('assignee_ids').eq('id', '66').single();
                            if (assignmentRule && assignmentRule.assignee_ids && assignmentRule.assignee_ids.length > 0) {
                                const targetUid = assignmentRule.assignee_ids[0]; 
                                const { data: userData } = await supabase.from('users').select('email').eq('id', targetUid).single();
                                currentAssignedUser = { uid: targetUid, email: userData ? userData.email : 'bilinmiyor@evreka.com' };
                            }
                        } catch (err) {}
                    }

                    const taskData = {
                        title: `${childTypeObj.alias || childTypeObj.name} - ${this.matchedRecord.title}`,
                        description: taskDesc,
                        taskType: tType, 
                        relatedRecordId: this.matchedRecord.id,
                        relatedIpRecordId: this.matchedRecord.id,
                        relatedIpRecordTitle: this.matchedRecord.title,
                        iprecordApplicationNo: ipAppNo,
                        iprecordTitle: ipTitle,
                        iprecordApplicantName: ipAppName,
                        transactionId: childTransactionId, 
                        triggeringTransactionType: childTypeId,
                        deliveryDate: deliveryDateStr,
                        dueDate: taskDueDate.toISOString(),
                        officialDueDate: officialDueDate.toISOString(),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        status: taskStatus, 
                        priority: 'medium',
                        assignedTo_uid: currentAssignedUser.uid, 
                        assignedTo_email: currentAssignedUser.email, 
                        createdBy: { uid: this.currentUser.uid, email: this.currentUser.email },
                        taskOwner: taskOwner.length > 0 ? taskOwner : null,
                        details: { relatedParty: relatedPartyData },
                        history: [{ action: 'İndeksleme işlemi ile otomatik oluşturuldu.', timestamp: new Date().toISOString(), userEmail: this.currentUser.email }]
                    };

                    const taskResult = await taskService.createTask(taskData);
                    
                    if (taskResult.success) {
                        const createdTaskId = taskResult.id;
                        
                        const { data: cTx } = await supabase.from('transactions').select('details').eq('id', childTransactionId).single();
                        await supabase.from('transactions').update({ details: { ...(cTx?.details || {}), taskId: String(createdTaskId) } }).eq('id', childTransactionId);

                        const triggeredTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(tType));
                        const triggeredTypeName = triggeredTypeObj ? (triggeredTypeObj.alias || triggeredTypeObj.name) : 'Otomatik İşlem';
                        const targetHierarchy = triggeredTypeObj?.hierarchy || 'child'; 

                        const triggeredTransactionData = {
                            type: tType,
                            description: `${triggeredTypeName} (Otomatik)`,
                            transactionHierarchy: targetHierarchy,
                            taskId: String(createdTaskId),
                            timestamp: new Date().toISOString()
                        };
                        if (targetHierarchy === 'child') triggeredTransactionData.parentId = finalParentId;
                        await this._addTransaction(this.matchedRecord.id, triggeredTransactionData);
                    }
                }
            }

            if (finalParentId && childTypeId) {
                try {
                    const { data: pTx } = await supabase.from('transactions').select('details').eq('id', finalParentId).single();
                    await supabase.from('transactions').update({ 
                        details: { ...(pTx?.details || {}), requestResult: childTypeId, requestResultUpdatedAt: new Date().toISOString() } 
                    }).eq('id', finalParentId);
                } catch (err) {}
            }

            // PDF durumunu Indexed yap
            await supabase.from(UNINDEXED_PDFS_COLLECTION).update({
                status: 'indexed',
                download_url: finalPdfUrl, 
                details: {
                    ...(this.pdfData.details || {}),
                    file_path: finalPdfPath, 
                    indexed_at: new Date().toISOString(),
                    final_transaction_id: childTransactionId,
                    matched_record_id: this.matchedRecord.id
                }
            }).eq('id', String(this.pdfId));

            // --- MÜVEKKİL BİLDİRİMİNİ TETİKLE ---
            try {
                const tebligTarihiStr = document.getElementById('detectedDate').value; 
                const sonItirazTarihiStr = document.getElementById('calculatedDeadlineDisplay')?.value || '';

                await supabase.functions.invoke('send-indexing-notification', {
                    body: {
                        recordId: this.matchedRecord.id, 
                        childTypeId: childTypeId,
                        tebligTarihi: tebligTarihiStr,
                        sonItirazTarihi: sonItirazTarihiStr,
                        pdfId: this.pdfId 
                    }
                });
            } catch (notifyErr) {}
            
            showNotification('İşlem başarıyla tamamlandı!', 'success');
            setTimeout(() => window.location.href = 'bulk-indexing-page.html', 1500);

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
            saveBtn.disabled = false;
        }
    }

    renderHeader() {
        if (document.getElementById('fileNameDisplay')) {
            document.getElementById('fileNameDisplay').textContent = this.pdfData?.fileName || 'Dosya yükleniyor...';
        }
        
        const matchInfoEl = document.getElementById('matchInfoDisplay');
        if (!matchInfoEl) return;

        if (this.matchedRecord) {
            const imgUrl = this.matchedRecord.brandImageUrl || this.matchedRecord.trademarkImage || this.matchedRecord.publicImageUrl || './img/no-image.png';
            const applicantNames = this.matchedRecord.resolvedNames || '-';

            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center">
                    <div class="mr-3 border rounded bg-white p-1 shadow-sm" style="width: 70px; height: 70px; overflow: hidden;">
                        <img src="${imgUrl}" class="img-fluid w-100 h-100" style="object-fit: contain;" onerror="this.src='./img/no-image.png'">
                    </div>
                    <div class="flex-grow-1 overflow-hidden">
                        <h6 class="mb-1 text-primary font-weight-bold text-truncate" title="${this.matchedRecord.title}">
                            ${this.matchedRecord.title}
                        </h6>
                        <div class="d-flex small text-dark mb-1">
                            <span class="mr-3"><strong>No:</strong> ${this.matchedRecord.applicationNumber || '-'}</span>
                        </div>
                        <div class="small text-muted text-truncate" title="${applicantNames}">
                            <i class="fas fa-user-tie mr-1"></i>${applicantNames}
                        </div>
                    </div>
                    <div class="ml-2">
                        <span class="badge badge-success badge-pill px-3 py-2"><i class="fas fa-check mr-1"></i>Bağlandı</span>
                    </div>
                </div>`;
        } else {
            matchInfoEl.innerHTML = `
                <div class="d-flex align-items-center justify-content-center h-100 py-3">
                    <div class="text-warning font-weight-bold"><i class="fas fa-exclamation-circle mr-2"></i>Eşleşen Kayıt Bulunmuyor</div>
                </div>`;
        }
    }

    // 🔥 DÜZELTME: Doğrudan veritabanı araması
    async handleManualSearch(query) {
        const container = document.getElementById('manualSearchResults');
        if (!query || query.length < 3) { container.style.display = 'none'; return; }
        
        const { data } = await supabase.from('ip_records').select('*')
            .or(`title.ilike.%${query}%,brand_name.ilike.%${query}%,application_number.ilike.%${query}%`)
            .limit(10);
            
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="p-2 text-muted italic">Sonuç bulunamadı.</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = data.map(r => {
            const countryName = this.countryMap.get(r.country_code || r.country) || r.country_code || r.country || '-';
            const detailText = `${r.application_number || r.wipo_ir || '-'} • ${r.origin || 'WIPO'} • ${countryName}`;
            
            return `
                <div class="search-result-item p-2 border-bottom" style="cursor:pointer" data-id="${r.id}">
                    <div class="font-weight-bold text-primary" style="font-size:0.9rem;">${r.title || r.brand_name || '(İsimsiz)'}</div>
                    <div class="small text-muted" style="font-size:0.75rem;">${detailText}</div>
                </div>`;
        }).join('');
            
        container.querySelectorAll('.search-result-item').forEach(el => {
            el.onclick = () => {
                const selected = data.find(rec => rec.id === el.dataset.id);
                if (selected) this.selectRecordWithHierarchy(selected);
                container.style.display = 'none';
            };
        });
        container.style.display = 'block';
    }

    async selectRecordWithHierarchy(record) {
        if (!record) return;

        const origin = (record.origin || '').toUpperCase();
        const hierarchy = (record.transactionHierarchy || record.transaction_hierarchy || 'parent').toLowerCase();
        const isInternational = ['WIPO', 'ARIPO', 'WO', 'AP'].some(o => origin.includes(o));
        const isParent = hierarchy === 'parent';

        if (isInternational && isParent) {
            if (window.SimpleLoadingController) window.SimpleLoadingController.show({ text: 'Alt dosyalar ve ulusal kayıtlar aranıyor...' });
            
            try {
                const parentId = record.id;
                const parentIR = String(record.internationalRegNumber || record.wipo_ir || '').replace(/\D/g, '');
                
                const { data: childrenData } = await supabase.from('ip_records')
                                        .select('*')
                                        .eq('transaction_hierarchy', 'child');

                const children = (childrenData || []).filter(child => {
                    const cDetails = child.details || {};
                    const childIR = String(child.wipo_ir || cDetails.wipoIR || cDetails.internationalRegNumber || '').replace(/\D/g, '');
                    return (child.parent_id === parentId || cDetails.parentId === parentId) || (parentIR !== "" && childIR === parentIR);
                });

                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();

                if (children.length > 0) {
                    this._openWipoSelectionModal(record, children);
                    return;
                }
            } catch (err) {
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            }
        }
        await this.selectRecord(record.id);
    }

    _openWipoSelectionModal(parent, children) {
        const listEl = document.getElementById('wipoSelectionList');
        if (!listEl) return;

        listEl.innerHTML = '';
        [parent, ...children].forEach(rec => {
            const isParent = rec.id === parent.id;
            const recDetails = rec.details || rec;
            const country = isParent ? 'Uluslararası' : (this.countryMap.get(rec.country_code || rec.country || recDetails.country) || rec.country_code || rec.country || recDetails.country || '-');
            
            const item = document.createElement('button');
            item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center mb-2 border rounded shadow-sm";
            item.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="fas ${isParent ? 'fa-globe-americas text-primary' : 'fa-flag text-danger'} fa-lg mr-3"></i>
                    <div>
                        <div class="font-weight-bold">${rec.title || rec.brand_name || recDetails.title}</div>
                        <div class="small text-muted">${rec.wipo_ir || recDetails.wipoIR || recDetails.internationalRegNumber || '-'} • ${rec.origin || recDetails.origin} • ${country}</div>
                    </div>
                </div>
                <span class="badge ${isParent ? 'badge-primary' : 'badge-light border'} px-2 py-1">${isParent ? 'ANA KAYIT' : 'ULUSAL'}</span>
            `;
            item.onclick = () => {
                this.selectRecord(rec.id);
                if (typeof $ !== 'undefined') $('#wipoSelectionModal').modal('hide');
            };
            listEl.appendChild(item);
        });
        if (typeof $ !== 'undefined') $('#wipoSelectionModal').modal('show');
    }
}

export async function resolveApprovalStateAssignee() { return { uid: null, email: null }; }

document.addEventListener('DOMContentLoaded', () => { new DocumentReviewManager(); });