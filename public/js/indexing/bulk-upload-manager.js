// public/js/indexing/bulk-upload-manager.js

import { 
    authService, 
    ipRecordsService, 
    transactionTypeService,
    supabase 
} from '../../supabase-config.js';

import { showNotification, debounce } from '../../utils.js';
import { FilenameParser } from './filename-parser.js';
import { RecordMatcher } from './record-matcher.js';

const INCOMING_DOCS_COLLECTION = 'incoming_documents';
const STORAGE_BUCKET = 'documents';

const generateUUID = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);

export class BulkIndexingModule {
    constructor() {
        this.uploadedFiles = [];
        this.currentUser = null;
        
        this.activeTab = 'manual-indexing-pane'; 
        this.activeFileTab = 'all-files-pane';
        this.unsubscribe = null;
        
        this.allRecords = [];
        this.allTransactionTypes = [];
        this.uploadedFilesMap = new Map(); 
        this.selectedRecordManual = null;
        this.currentRecordTransactions = []; 

        this._manualSearchSeq = 0;
        this._isDataLoaded = false;
        this._isLoadingData = false;

        if (typeof window !== 'undefined') {
            window.indexingModule = this;
        }

        this.parser = new FilenameParser();
        this.matcher = new RecordMatcher();

        this.init();
    }

    async init() {
        try {
            // 🔥 ÇÖZÜM: Supabase Asenkron Oturum Kontrolü
            const session = await authService.getCurrentSession();
            this.currentUser = session?.user || null;
            if (!this.currentUser) {
                console.warn("Kullanıcı oturumu bulunamadı, indeksleme durduruldu.");
                return;
            }

            this.setupEventListeners();
            this.setupRealtimeListener(); 
        } catch (error) {
            console.error('Init hatası:', error);
        }
    }

    async loadAllData() {
        try {
            console.log('⏳ Portföy ve işlem tipleri yükleniyor...');
            
            const [recordsResult, transactionTypesResult] = await Promise.all([
                ipRecordsService.getRecords(), 
                transactionTypeService.getTransactionTypes()
            ]);

            let recordsArray = [];
            if (recordsResult) {
                if (Array.isArray(recordsResult.data)) recordsArray = recordsResult.data;
                else if (Array.isArray(recordsResult.items)) recordsArray = recordsResult.items;
                else if (Array.isArray(recordsResult)) recordsArray = recordsResult;
            }

            this.allRecords = recordsArray;
            this._isDataLoaded = true; 

            if (this.allRecords.length > 0) {
                console.log(`📊 ${this.allRecords.length} adet portföy kaydı eşleşme için hazır.`);
            } else {
                console.info('ℹ️ Portföy şu an boş. Aramalar doğrudan bülten üzerinden yapılacak.');
            }

            if (transactionTypesResult && transactionTypesResult.success) {
                this.allTransactionTypes = transactionTypesResult.data || [];
            }

        } catch (error) {
            console.error('loadAllData hatası:', error);
            showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            this._isDataLoaded = true; 
            throw error; 
        }
    }

    setupEventListeners() {
        this.setupBulkUploadListeners();
        this.setupMainTabListeners();

        const saveManualTransactionBtn = document.getElementById('saveManualTransactionBtn');
        if (saveManualTransactionBtn) {
            saveManualTransactionBtn.addEventListener('click', () => this.handleManualTransactionSubmit());
        }
        
        const manualTransactionType = document.getElementById('specificManualTransactionType');
        if (manualTransactionType) {
            manualTransactionType.addEventListener('change', () => {
                this.updateManualChildOptions();
                this.checkFormCompleteness();
            });
        }

        const manualChildType = document.getElementById('manualChildTransactionType');
        if (manualChildType) {
            manualChildType.addEventListener('change', () => {
                this.updateManualParentOptions();
                this.checkFormCompleteness();
            });
        }

        const manualParentSelect = document.getElementById('manualExistingParentSelect');
        if (manualParentSelect) {
            manualParentSelect.addEventListener('change', () => this.checkFormCompleteness());
        }
                 
        this.setupManualTransactionListeners();
        this.setupCommonFormListeners();
    }

    setupBulkUploadListeners() {
        const uploadButton = document.getElementById('bulkFilesButton');
        const fileInput = document.getElementById('bulkFiles');

        if (uploadButton && fileInput) {
            uploadButton.addEventListener('click', () => fileInput.click());
            uploadButton.addEventListener('dragover', (e) => this.handleDragOver(e));
            uploadButton.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            uploadButton.addEventListener('drop', (e) => this.handleDrop(e));
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.notification-tab-btn') || e.target.closest('.file-tab-btn');
            if (tabBtn) {
                const targetPane = tabBtn.getAttribute('data-target');
                if (targetPane) this.switchFileTab(targetPane, tabBtn);
            }
        });
    }

    setupMainTabListeners() {
        const tabBtns = document.querySelectorAll('.tab-navigation .nav-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.getAttribute('data-tab');
                this.activateTab(tabId);
            });
        });
    }

    setupManualTransactionListeners() {
        const recordSearchInput = document.getElementById('recordSearchInputManual');
        const recordSearchContainer = document.getElementById('searchResultsContainerManual');
        const clearSelectedBtn = document.getElementById('clearSelectedRecordManual');
        
        if (recordSearchInput) {
            recordSearchInput.addEventListener('focus', () => {
                if (!this._isDataLoaded && !this._isLoadingData) {
                    this._isLoadingData = true;
                    this.loadAllData().finally(() => { this._isLoadingData = false; });
                }
            }, { once: true });

            recordSearchInput.addEventListener(
                'input',
                debounce((e) => this.searchRecords(e.target.value, 'manual'), 100)
            );
            recordSearchInput.addEventListener('blur', () => {
                setTimeout(() => { if (recordSearchContainer) recordSearchContainer.style.display = 'none'; }, 200);
            });
        }

        if (clearSelectedBtn) {
            clearSelectedBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearSelectedRecordManual();
            });
        }

        const filesManual = document.getElementById('filesManual');
        const filesManualButton = document.getElementById('filesManualButton');
        
        if (filesManual) {
            filesManual.addEventListener('change', (e) => {
                this.handleFileChange(e, 'manual-indexing-pane');
                const info = document.getElementById('filesManualInfo');
                if (info) info.textContent = `${e.target.files.length} dosya seçildi.`;
            });
        }

        if (filesManualButton) {
            filesManualButton.addEventListener('click', () => filesManual?.click());
            filesManualButton.addEventListener('dragover', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#1e3c72';
                filesManualButton.style.backgroundColor = '#f0f7ff';
            });
            filesManualButton.addEventListener('dragleave', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#cbd5e1';
                filesManualButton.style.backgroundColor = '#fff';
            });
            filesManualButton.addEventListener('drop', (e) => {
                e.preventDefault();
                filesManualButton.style.borderColor = '#cbd5e1';
                filesManualButton.style.backgroundColor = '#fff';
                
                if(e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    if(filesManual) {
                        filesManual.files = e.dataTransfer.files;
                        const event = new Event('change');
                        filesManual.dispatchEvent(event);
                    }
                }
            });
        }
    }

    setupCommonFormListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.remove-uploaded-file')) {
                const btn = e.target.closest('.remove-uploaded-file');
                const fileId = btn.dataset.fileId;
                const tabKey = btn.dataset.tabKey;
                
                let files = this.uploadedFilesMap.get(tabKey) || [];
                this.uploadedFilesMap.set(tabKey, files.filter(f => f.id !== fileId));
                
                this.renderUploadedFilesList(tabKey);
                this.checkFormCompleteness();
            }
        });
    }

    activateTab(tabName) {
        this.activeTab = tabName;
        this.checkFormCompleteness();

        if (tabName === 'etebs-notifications-pane') {
            if (window.etebsManager) {
                window.etebsManager.loadAndProcessDocuments(false);
            }
        }
    }

    async searchRecords(queryText, tabContext) {
        const containerId = 'searchResultsContainerManual';
        const container = document.getElementById(containerId);
        if (!container) return;

        const rawQuery = (queryText || '').trim();
        if (rawQuery.length < 3) {
            container.style.display = 'none';
            return;
        }

        if (!this._isDataLoaded) {
            container.innerHTML = '<div style="padding:10px; color:#e67e22;"><i class="fas fa-spinner fa-spin"></i> Veriler hazırlanıyor... Lütfen bekleyin.</div>';
            container.style.display = 'block';
            
            if (!this._isLoadingData) {
                this._isLoadingData = true;
                await this.loadAllData();
                this._isLoadingData = false;
            } else {
                setTimeout(() => this.searchRecords(queryText, tabContext), 500);
                return;
            }
        }

        const seq = ++this._manualSearchSeq;
        const lowerQuery = rawQuery.toLowerCase();
        
        let filteredPortfolio = this.allRecords.filter(r => {
            const title = (r.title || r.markName || '').toLowerCase();
            const appNo = String(r.applicationNumber || r.applicationNo || r.wipoIR || r.aripoIR || '').toLowerCase();
            return title.includes(lowerQuery) || appNo.includes(lowerQuery);
        }).map(r => ({ ...r, _isPortfolio: true }));

        // 🔥 SUPABASE BÜLTEN ARAMASI 
        let filteredBulletins = [];
        try {
            const { data: bData, error } = await supabase
                .from('bulletin_records')
                .select('*')
                .or(`brand_name.ilike.%${rawQuery}%,application_number.ilike.%${rawQuery}%`)
                .limit(15);
            
            if (!error && bData) {
                bData.forEach(data => {
                    const safeAppNo = String(data.application_number || '').replace(/[\s\/]/g, '');
                    const alreadyInPortfolio = filteredPortfolio.some(p => {
                        const pNo = String(p.applicationNumber || p.applicationNo || '').replace(/[\s\/]/g, '');
                        return pNo === safeAppNo;
                    });

                    if (!alreadyInPortfolio) {
                        filteredBulletins.push({ 
                            id: data.id, 
                            markName: data.brand_name,
                            applicationNo: data.application_number,
                            applicationDate: data.application_date,
                            niceClasses: data.nice_classes,
                            imagePath: data.image_path,
                            _isBulletin: true 
                        });
                    }
                });
            }
        } catch (err) {
            console.warn("Bülten araması hatası:", err);
        }

        if (seq !== this._manualSearchSeq) return; 

        const finalResults = [...filteredPortfolio.slice(0, 15), ...filteredBulletins];

        container.innerHTML = '';
        container.style.display = 'block';
        
        if (finalResults.length === 0) {
            container.innerHTML = '<div style="padding:10px; color:#666;">Kayıt bulunamadı.</div>';
            return;
        }

        finalResults.forEach(record => {
            const item = document.createElement('div');
            item.className = "search-result-item";
            item.style.cssText = `display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #eee; cursor: pointer; transition: background 0.1s;`;
            item.onmouseenter = () => item.style.backgroundColor = '#f0f7ff';
            item.onmouseleave = () => item.style.backgroundColor = 'white';

            const title = record.markName || record.title || record.brandName || '(İsimsiz)';
            const appNo = record.applicationNo || record.applicationNumber || record.wipoIR || record.aripoIR || '-';
            
            const badge = record._isBulletin 
                ? '<span class="badge badge-warning mr-2" style="font-size: 0.7em;">BÜLTEN</span>' 
                : '<span class="badge badge-primary mr-2" style="font-size: 0.7em;">PORTFÖY</span>';

            item.innerHTML = `
                <div class="result-img-wrapper" style="width: 45px; height: 45px; margin-right: 12px; flex-shrink: 0; display:flex; align-items:center; justify-content:center; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px;">
                    <i class="fas fa-image text-muted"></i>
                </div>
                <div style="flex-grow: 1; min-width: 0;">
                    <div style="font-weight: 600; color: #1e3c72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${badge}${this._highlightText(title, rawQuery)}
                    </div>
                    <div style="font-size: 0.85em; color: #666;">${this._highlightText(appNo, rawQuery)}</div>
                </div>
            `;

            item.addEventListener('click', () => {
                this.selectRecord(record);
                container.style.display = 'none';
            });

            this._loadResultImage(record, item.querySelector('.result-img-wrapper'));
            container.appendChild(item);
        });
    }

    _highlightText(text, query) {
        if (!text) return '';
        if (!query) return text;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span style="background-color:#fff3cd; color:#333;">$1</span>');
    }

    async _loadResultImage(record, wrapperEl) {
        try {
            const url = await this._resolveRecordImageUrl(record);
            if (url) {
                wrapperEl.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:contain; border-radius:3px;">`;
                wrapperEl.style.backgroundColor = 'white';
            }
        } catch (e) {}
    }

    async _resolveRecordImageUrl(record) {
        const potentialPath = record.imagePath || record.brandImageUrl || record.image || record.logo || record.imageUrl;
        if (!potentialPath) return null;

        if (typeof potentialPath === 'string' && (potentialPath.startsWith('http') || potentialPath.startsWith('data:'))) {
            return potentialPath;
        }

        try {
            const { data } = supabase.storage.from('brand_images').getPublicUrl(potentialPath);
            return data ? data.publicUrl : null;
        } catch (e) {
            return null;
        }
    }

    selectRecord(record) {
        this.selectedRecordManual = record;
        const inputElement = document.getElementById('recordSearchInputManual');
        if (inputElement) inputElement.value = ''; 

        this.renderSelectedRecordCardManual(record);
        this.populateManualTransactionTypeSelect();
        
        this.currentRecordTransactions = [];
        ipRecordsService.getRecordTransactions(record.id).then(res => {
            if(res.success) this.currentRecordTransactions = res.data || [];
        });
        this.checkFormCompleteness();
    }

    async renderSelectedRecordCardManual(record) {
        const emptyEl = document.getElementById('selectedRecordEmptyManual');
        const containerEl = document.getElementById('selectedRecordContainerManual');
        const labelEl = document.getElementById('selectedRecordLabelManual');
        const numberEl = document.getElementById('selectedRecordNumberManual');
        const imgEl = document.getElementById('selectedRecordImageManual');
        const phEl = document.getElementById('selectedRecordPlaceholderManual');

        if (emptyEl) emptyEl.style.display = 'none';
        if (containerEl) containerEl.style.display = 'block';

        const title = record.title || record.markName || record.name || '(İsimsiz)';
        const appNo = record.applicationNumber || record.applicationNo || record.wipoIR || record.aripoIR || record.dosyaNo || record.fileNo || '-';

        if (labelEl) labelEl.textContent = title;
        if (numberEl) numberEl.textContent = appNo;

        if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
        if (phEl) {
            phEl.style.display = 'flex';
            phEl.innerHTML = '<i class="fas fa-image" style="font-size: 24px;"></i>';
        }

        try {
            const imageUrl = await this._resolveRecordImageUrl(record);
            if (imageUrl && imgEl) {
                imgEl.src = imageUrl;
                imgEl.style.display = 'block';
                if (phEl) phEl.style.display = 'none';
            }
        } catch (err) {}
    }

    clearSelectedRecordManual() {
        this.selectedRecordManual = null;

        const emptyEl = document.getElementById('selectedRecordEmptyManual');
        const containerEl = document.getElementById('selectedRecordContainerManual');
        const labelEl = document.getElementById('selectedRecordLabelManual');
        const numberEl = document.getElementById('selectedRecordNumberManual');
        const imgEl = document.getElementById('selectedRecordImageManual');
        const phEl = document.getElementById('selectedRecordPlaceholderManual');

        if (containerEl) containerEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';

        if (labelEl) labelEl.textContent = '';
        if (numberEl) numberEl.textContent = '';
        if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
        if (phEl) {
            phEl.style.display = 'flex';
            phEl.innerHTML = '<i class="fas fa-image" style="font-size: 24px;"></i>';
        }
        this.checkFormCompleteness();
    }

    populateManualTransactionTypeSelect() {
        const select = document.getElementById('specificManualTransactionType');
        if (!select) return;

        select.innerHTML = '<option value="" disabled selected>İşlem türü seçin...</option>';
        const parentTypes = this.allTransactionTypes.filter(type => type.hierarchy === 'parent' || !type.hierarchy);
        
        parentTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.alias || type.name;
            select.appendChild(option);
        });
    }

    updateManualChildOptions() {
        const parentTypeSelect = document.getElementById('specificManualTransactionType');
        const childTypeSelect = document.getElementById('manualChildTransactionType');
        const parentContainer = document.getElementById('manualParentSelectContainer');

        if (!parentTypeSelect || !childTypeSelect) return;

        childTypeSelect.innerHTML = '<option value="">-- Sadece Ana İşlem Oluştur --</option>';
        childTypeSelect.disabled = true;
        if(parentContainer) parentContainer.style.display = 'none';

        const selectedParentTypeId = parentTypeSelect.value;
        if (!selectedParentTypeId) return;

        const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(selectedParentTypeId));
        if (!parentTypeObj || !parentTypeObj.indexFile) return; 

        const allowedChildIds = Array.isArray(parentTypeObj.indexFile) ? parentTypeObj.indexFile.map(String) : [];
        const allowedChildTypes = this.allTransactionTypes
            .filter(t => allowedChildIds.includes(String(t.id)))
            .sort((a, b) => (a.order || 999) - (b.order || 999));

        if (allowedChildTypes.length > 0) {
            allowedChildTypes.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type.id;
                opt.textContent = type.alias || type.name;
                childTypeSelect.appendChild(opt);
            });
            childTypeSelect.disabled = false;
        }
    }

    updateManualParentOptions() {
        const parentTypeSelect = document.getElementById('specificManualTransactionType');
        const childTypeSelect = document.getElementById('manualChildTransactionType');
        const parentContainer = document.getElementById('manualParentSelectContainer');
        const parentSelect = document.getElementById('manualExistingParentSelect');

        if (!parentContainer || !parentSelect) return;

        const childTypeId = childTypeSelect.value;
        const parentTypeId = parentTypeSelect.value;

        if (!childTypeId) {
            parentContainer.style.display = 'none';
            parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçin --</option>';
            return;
        }

        parentContainer.style.display = 'block';
        parentSelect.innerHTML = '<option value="">-- Ana İşlem Seçin --</option>';

        const existingParents = this.currentRecordTransactions.filter(t => 
            String(t.type) === String(parentTypeId) && 
            (t.transactionHierarchy === 'parent' || !t.transactionHierarchy)
        );

        if (existingParents.length === 0) {
            const opt = document.createElement('option');
            opt.value = "CREATE_NEW";
            opt.textContent = "⚠️ Mevcut İşlem Yok - Önce Yeni Ana İşlem Yaratıp Bağla";
            parentSelect.appendChild(opt);
            parentSelect.value = "CREATE_NEW";
        } else {
            existingParents.sort((a,b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                const dateStr = t.timestamp ? new Date(t.timestamp).toLocaleDateString('tr-TR') : 'Tarihsiz';
                opt.textContent = `${t.description || 'İşlem'} (${dateStr})`;
                parentSelect.appendChild(opt);
            });
            if (existingParents.length === 1) {
                parentSelect.value = existingParents[0].id;
            }
        }
    }

    handleFileChange(event, tabKey) {
        const fileInput = event.target;
        const files = Array.from(fileInput.files);
        
        if (!this.uploadedFilesMap.has(tabKey)) {
            this.uploadedFilesMap.set(tabKey, []);
        }
        
        const currentFiles = this.uploadedFilesMap.get(tabKey);
        
        files.forEach(file => {
            currentFiles.push({
                id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                fileObject: file,
                documentDesignation: '' 
            });
        });
        
        this.renderUploadedFilesList(tabKey);
        this.checkFormCompleteness();
    }

    renderUploadedFilesList(tabKey) {
        const containerId = 'fileListManual';
        const container = document.getElementById(containerId);
        if (!container) return;

        const files = this.uploadedFilesMap.get(tabKey) || [];
        
        if (files.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="file-item-name">
                    <i class="fas fa-file-pdf text-danger mr-2"></i>
                    ${file.fileObject.name}
                </div>
                <div class="file-item-controls">
                    <button type="button" class="remove-uploaded-file" 
                            data-file-id="${file.id}" data-tab-key="${tabKey}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    checkFormCompleteness() {
        if (this.activeTab === 'manual-indexing-pane') {
            const parentType = document.getElementById('specificManualTransactionType')?.value;
            const childType = document.getElementById('manualChildTransactionType')?.value;
            const existingParent = document.getElementById('manualExistingParentSelect')?.value;

            let canSubmit = this.selectedRecordManual !== null && parentType && parentType !== "";

            if (childType && !existingParent) {
                canSubmit = false;
            }
            
            const saveManualBtn = document.getElementById('saveManualTransactionBtn');
            if (saveManualBtn) {
                saveManualBtn.disabled = !canSubmit;
                saveManualBtn.style.opacity = canSubmit ? '1' : '0.6';
            }
        }
    }

    // 🔥 YENİ: İŞLEM KAYDETME YARDIMCISI
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

    // --- MANUEL İŞLEM KAYDETME (SUPABASE ENTEGRE) ---
    async handleManualTransactionSubmit() {
        const parentTypeId = document.getElementById('specificManualTransactionType')?.value;
        const childTypeId = document.getElementById('manualChildTransactionType')?.value;
        const existingParentId = document.getElementById('manualExistingParentSelect')?.value;
        const deliveryDateStr = document.getElementById('manualTransactionDeliveryDate')?.value;
        const notes = document.getElementById('manualTransactionNotes')?.value;
        
        if (!this.selectedRecordManual || !parentTypeId) {
            showNotification('Lütfen işlem türü ve kayıt seçiniz.', 'warning');
            return;
        }

        const submitBtn = document.getElementById('saveManualTransactionBtn');
        if(submitBtn) submitBtn.disabled = true;
        showNotification('Dosyalar yükleniyor ve işlem kaydediliyor...', 'info');

        try {
            // 🔥 BÜLTEN SEÇİLDİYSE PORTFÖYE KAYDET
            if (this.selectedRecordManual._isBulletin) {
                showNotification('Bülten kaydı 3. Taraf olarak portföye ekleniyor...', 'info');
                
                let applicants = [];
                const ownerName = this.selectedRecordManual.applicantName || this.selectedRecordManual.owner || this.selectedRecordManual.applicant;
                if (ownerName) applicants.push({ name: ownerName, id: 'temp_' + Date.now() });

                const newRecordData = {
                    title: this.selectedRecordManual.markName || this.selectedRecordManual.title || 'İsimsiz Marka',
                    applicationNumber: this.selectedRecordManual.applicationNo || this.selectedRecordManual.applicationNumber || '',
                    niceClasses: this.selectedRecordManual.classes || this.selectedRecordManual.niceClasses || [],
                    recordOwnerType: 'third_party',
                    origin: 'TÜRKPATENT',
                    status: 'published',
                    applicationDate: this.selectedRecordManual.applicationDate || '',
                    brandImageUrl: this.selectedRecordManual.imagePath || this.selectedRecordManual.imageUrl || null,
                    applicants: applicants,
                    details: { bulletinNo: this.selectedRecordManual.bulletinNo || '' },
                    createdAt: new Date().toISOString()
                };
                
                const recRes = await ipRecordsService.createRecordFromDataEntry(newRecordData);
                if (!recRes.success) throw new Error("Bülten portföye eklenemedi.");
                const newRecordId = recRes.id;

                // "Marka Başvurusu" kök işlemini bağla
                const rootTxData = {
                    type: "2", 
                    transactionHierarchy: 'parent',
                    description: 'Başvuru',
                    date: this.selectedRecordManual.applicationDate || new Date().toISOString(),
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser.id,
                    userName: this.currentUser.displayName || this.currentUser.email || 'Kullanıcı',
                    userEmail: this.currentUser.email
                };
                await this._addTransaction(newRecordId, rootTxData);

                this.selectedRecordManual.id = newRecordId;
                this.selectedRecordManual._isBulletin = false; 
                this.allRecords.push({ id: newRecordId, ...newRecordData });
            }

            // 1. PDF YÜKLEME (SUPABASE STORAGE)
            const filesToUpload = this.uploadedFilesMap.get('manual-indexing-pane') || [];
            const uploadedDocuments = [];

            if (filesToUpload.length > 0) {
                for (const fileItem of filesToUpload) {
                    const file = fileItem.fileObject;
                    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const storagePath = `incoming_documents/${this.currentUser.id}/${Date.now()}_${cleanName}`;                    
                    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file);
                    if (upErr) throw upErr;
                    
                    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

                    uploadedDocuments.push({
                        id: generateUUID(),
                        name: file.name,
                        type: file.type || 'application/pdf',
                        downloadURL: urlData.publicUrl,
                        url: urlData.publicUrl,
                        uploadedAt: new Date().toISOString(),
                        documentDesignation: fileItem.documentDesignation || 'Resmi Yazı'
                    });
                }
            }

            // 2. HİYERARŞİ TESPİTİ VE İTİRAZ İŞ KURALI
            let finalParentId = null;
            const isChild = !!childTypeId;

            if (isChild && String(childTypeId) === '27' && (String(parentTypeId) === '2' || String(parentTypeId) === '6')) {
                showNotification('İtiraz işlemi için "Yayına İtiraz" kök işlemi otomatik oluşturuluyor...', 'info');
                
                const parent20Obj = this.allTransactionTypes.find(t => String(t.id) === '20');
                const newParentData = {
                    type: '20',
                    transactionHierarchy: 'parent',
                    description: parent20Obj ? (parent20Obj.alias || parent20Obj.name) : 'Yayına İtiraz (Otomatik)',
                    timestamp: new Date().toISOString(),
                    userId: this.currentUser.id,
                    userEmail: this.currentUser.email
                };
                
                const pResult = await this._addTransaction(this.selectedRecordManual.id, newParentData);
                if (pResult.success) finalParentId = pResult.id;
            } 
            else {
                if (isChild && existingParentId === "CREATE_NEW") {
                    const parentTypeObj = this.allTransactionTypes.find(t => String(t.id) === String(parentTypeId));
                    const newParentData = {
                        type: parentTypeId,
                        transactionHierarchy: 'parent',
                        description: parentTypeObj ? (parentTypeObj.alias || parentTypeObj.name) : 'Ana İşlem',
                        timestamp: new Date().toISOString(),
                        userId: this.currentUser.id,
                        userEmail: this.currentUser.email
                    };
                    const pResult = await this._addTransaction(this.selectedRecordManual.id, newParentData);
                    if (pResult.success) finalParentId = pResult.id;
                } else if (isChild && existingParentId) {
                    finalParentId = existingParentId;
                }
            }
            
            // 3. PAYLOAD YAPISI VE KAYIT
            const targetTypeId = isChild ? childTypeId : parentTypeId;
            const typeObj = this.allTransactionTypes.find(t => String(t.id) === String(targetTypeId));

            const transactionData = {
                type: targetTypeId,
                transactionHierarchy: isChild ? 'child' : 'parent',
                date: deliveryDateStr ? new Date(deliveryDateStr).toISOString() : null,
                description: typeObj ? (typeObj.alias || typeObj.name) : (notes || ''),
                notes: notes || '',
                timestamp: new Date().toISOString(),
                documents: uploadedDocuments,
                userId: this.currentUser.id,
                userName: this.currentUser.displayName || this.currentUser.email || 'Kullanıcı',
                userEmail: this.currentUser.email
            };

            if (isChild && finalParentId) {
                transactionData.parentId = finalParentId;
            }

            const result = await this._addTransaction(this.selectedRecordManual.id, transactionData);

            if (!result.success) throw new Error(result.error || 'İşlem oluşturulamadı');
            
            showNotification('İşlem başarıyla kaydedildi!', 'success');
            
            this.resetForm();
            if (document.getElementById('manualParentSelectContainer')) {
                document.getElementById('manualParentSelectContainer').style.display = 'none';
            }
            if (document.getElementById('manualChildTransactionType')) {
                document.getElementById('manualChildTransactionType').disabled = true;
                document.getElementById('manualChildTransactionType').innerHTML = '<option value="">-- Sadece Ana İşlem Oluştur --</option>';
            }

        } catch (error) {
            console.error('Manuel işlem hatası:', error);
            showNotification('Hata: ' + error.message, 'error');
        } finally {
            if(submitBtn) {
                submitBtn.disabled = false;
                this.checkFormCompleteness();
            }
        }
    }

    resetForm() {
        const inputs = ['recordSearchInputManual', 'manualTransactionDeliveryDate', 'manualTransactionNotes', 'filesManual'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const select = document.getElementById('specificManualTransactionType');
        if (select) select.selectedIndex = 0;

        this.clearSelectedRecordManual();
        this.uploadedFilesMap.set('manual-indexing-pane', []);
        this.renderUploadedFilesList('manual-indexing-pane');
        this.checkFormCompleteness();
    }

    // --- ETEBS / BULK YÜKLEME METODLARI ---
    handleDragOver(e) { e.preventDefault(); }
    handleDragLeave(e) { e.preventDefault(); }
    handleDrop(e) {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(file => file.type === 'application/pdf');
        if (files.length > 0) this.processFiles(files);
    }
    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    async processFiles(files) {
        if (this.allRecords.length === 0) await this.loadAllData();
        
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show({
                text: 'Dosyalar Yükleniyor',
                subtext: `${files.length} adet PDF hazırlanıyor, lütfen beklemeye devam edin...`
            });
        }
        await new Promise(resolve => setTimeout(resolve, 250));

        try {
            for (const file of files) {
                if (window.SimpleLoadingController) {
                    window.SimpleLoadingController.updateText('Dosyalar Yükleniyor', `${file.name} aktarılıyor...`);
                }
                await this.uploadFileToSupabase(file);
            }
            
            if (window.SimpleLoadingController) {
                window.SimpleLoadingController.showSuccess(`${files.length} dosya başarıyla yüklendi.`);
            }

            setTimeout(() => {
                window.location.href = 'bulk-indexing-page.html?tab=bulk';
            }, 1500);

        } catch (error) {
            console.error("Yükleme hatası:", error);
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            showNotification('Yükleme sırasında bir hata oluştu.', 'error');
        }
    }

    // 🔥 SUPABASE İÇİN YENİDEN YAZILAN DOSYA YÜKLEME METODU
    async uploadFileToSupabase(file) {
        if (file._isProcessing) return;
        file._isProcessing = true;

        try {
            const id = generateUUID();
            const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const storagePath = `incoming_documents/${this.currentUser.id}/${Date.now()}_${cleanName}`;            
            // Storage'a Yükle
            const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file);
            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
            const downloadURL = urlData.publicUrl;

            const extractedAppNumber = this.parser.extractApplicationNumber(file.name);
            let matchedRecordId = null;
            let matchedRecordDisplay = null;
            let recordOwnerType = 'self';

            if (extractedAppNumber) {
                const matchResult = this.matcher.findMatch(extractedAppNumber, this.allRecords);
                if (matchResult) {
                    matchedRecordId = matchResult.record.id;
                    matchedRecordDisplay = this.matcher.getDisplayLabel(matchResult.record) + ` - ${matchResult.record.title}`;
                    recordOwnerType = matchResult.record.recordOwnerType || 'self';
                }
            }
            
        const pdfData = {
                id: id,
                file_name: file.name,
                file_url: downloadURL,
                file_path: storagePath,
                document_source: 'manual',
                status: 'pending',
                application_number: extractedAppNumber || null,
                ip_record_id: matchedRecordId || null,
                user_id: this.currentUser.id, // .uid yerine .id
                created_at: new Date().toISOString()
            };
            
            const { error: dbError } = await supabase.from(INCOMING_DOCS_COLLECTION).insert(pdfData);
            if (dbError) throw dbError;

            return pdfData;
        } catch (error) { 
            console.error(error); 
            throw error;
        }
    }

    setupRealtimeListener() {
        if (!this.currentUser) return;
        console.log("📡 Supabase PDF dinleyicisi kuruluyor...");

        const fetchFiles = async () => {
            console.log("📥 Supabase'den dosyalar çekiliyor...");
            const { data, error } = await supabase
                .from(INCOMING_DOCS_COLLECTION)
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error("❌ PDF'ler çekilemedi! Supabase Hatası:", error);
                return;
            }
            
            console.log(`✅ Supabase'den toplam ${data ? data.length : 0} adet dosya çekildi.`, data);
            this.processFetchedFiles(data || []);
        };

        fetchFiles(); 

        this.unsubscribe = supabase.channel('incoming_documents_changes') // İsim temizlendi
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: INCOMING_DOCS_COLLECTION, 
                filter: `user_id=eq.${this.currentUser.id}` 
            }, () => {
                fetchFiles();
            })
            .subscribe();
    }

    processFetchedFiles(data) {
        if (!this.allRecords || this.allRecords.length === 0) {
            console.warn("⚠️ Portföy kayıtları henüz yüklenmedi. Eşleşme denemesi atlanıyor.");
        }

        const files = data.map(doc => {
            let fileObj = {
                id: doc.id,
                fileName: doc.file_name,
                fileUrl: doc.file_url,
                filePath: doc.file_path,
                dosyaNo: doc.application_number,
                applicationNo: doc.application_number,
                extractedAppNumber: doc.application_number,
                matchedRecordId: doc.ip_record_id,
                status: doc.status,
                source: doc.document_source,
                uploadedAt: doc.created_at ? new Date(doc.created_at) : new Date()
            };

            const searchKey = fileObj.dosyaNo || fileObj.applicationNo;

            if (searchKey && this.allRecords.length > 0 && !fileObj.matchedRecordId) {
                const matchResult = this.matcher.findMatch(searchKey, this.allRecords);
                if (matchResult) {
                    fileObj.matchedRecordId = matchResult.record.id;
                    
                    // 🔥 Yeni şemada doğrudan ip_record_id güncelleniyor
                    supabase.from(INCOMING_DOCS_COLLECTION).update({
                        ip_record_id: fileObj.matchedRecordId
                    }).eq('id', fileObj.id).then();
                }
            }
            return fileObj;
        });

        this.uploadedFiles = files;
        this.updateUI();
    }

    updateUI() {
        const allFiles = this.uploadedFiles.filter(f => f.status !== 'removed');
        const pendingFiles = allFiles.filter(f => f.status === 'pending');
        const matchedFiles = pendingFiles.filter(f => f.matchedRecordId || f.autoMatched);
        const unmatchedFiles = pendingFiles.filter(f => !f.matchedRecordId && !f.autoMatched);
        const indexedFiles = allFiles.filter(f => f.status === 'indexed');

        this.setBadge('matchedTabBadge', matchedFiles.length);
        this.setBadge('unmatchedTabBadge', unmatchedFiles.length);
        this.setBadge('indexedTabBadge', indexedFiles.length); 
    }

    setBadge(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }

    renderFileList(containerId, files) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (files.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Liste boş</div>';
            return;
        }

        container.innerHTML = files.map(file => `
            <div class="pdf-list-item ${file.matchedRecordId ? 'matched' : 'unmatched'}">
                <div style="display:flex; align-items:center;">
                    <div class="pdf-icon"><i class="fas fa-file-pdf"></i></div>
                    <div class="pdf-details">
                        <div class="pdf-name">${file.fileName}</div>
                        <div class="pdf-meta">
                            ${file.extractedAppNumber ? `No: ${file.extractedAppNumber}` : 'No Bulunamadı'}
                        </div>
                    </div>
                </div>
                <div class="pdf-actions">
                <button class="btn btn-light btn-sm pdf-action-btn" title="Görüntüle"
                        onclick="window.open('${file.fileUrl}', '_blank')">
                    <i class="fas fa-eye"></i>
                </button>

                ${file.status === 'pending' ? `
                    <button class="btn btn-light btn-sm pdf-action-btn" 
                            title="İndeksle"
                            onclick="window.location.href='indexing-detail.html?pdfId=${file.id}'">
                        <i class="fas fa-check"></i>
                    </button>
                ` : ''}

                <button class="btn btn-light btn-sm pdf-action-btn pdf-action-danger" title="Sil"
                        onclick="window.indexingModule.deleteFilePermanently('${file.id}')">
                    <i class="fas fa-trash"></i>
                </button>
                </div>
            </div>
        `).join('');
    }

    switchFileTab(targetPane, clickedBtn) {
        document.querySelectorAll('.notification-tab-btn, .file-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        if (clickedBtn) {
            clickedBtn.classList.add('active');
        } else {
            const btn = document.querySelector(`[data-target="${targetPane}"]`);
            if (btn) btn.classList.add('active');
        }

        document.querySelectorAll('.notification-tab-pane, .file-tab-pane').forEach(pane => {
            pane.classList.remove('active');
            pane.style.display = 'none'; 
        });
        
        const activePane = document.getElementById(targetPane);
        if(activePane) {
            activePane.classList.add('active');
            activePane.style.display = 'block'; 
        }
    }

    async deleteFilePermanently(fileId) {
        if (!confirm('Dosyayı silmek istiyor musunuz?')) return;
        try {
            const fileToDelete = this.uploadedFiles.find(f => f.id === fileId);
            if (!fileToDelete) return;

            if (fileToDelete.filePath) {
                try {
                    await supabase.storage.from(STORAGE_BUCKET).remove([fileToDelete.filePath]);
                } catch (e) { console.warn('Storage silme hatası:', e); }
            }
            
            const { error } = await supabase.from(INCOMING_DOCS_COLLECTION).delete().eq('id', fileId);
            if (error) throw error;
            
            showNotification('Dosya silindi.', 'success');
        } catch (error) {
            showNotification('Silme hatası.', 'error');
        }
    }
}