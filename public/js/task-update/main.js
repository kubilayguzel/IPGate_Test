import { authService, supabase } from '../../supabase-config.js';
import { loadSharedLayout, ensurePersonModal } from '../layout-loader.js';
import { showNotification } from '../../utils.js';

import * as pdfjsLibProxy from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/+esm';
const pdfjsLib = pdfjsLibProxy.GlobalWorkerOptions ? pdfjsLibProxy : pdfjsLibProxy.default;

if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
}

import { TaskUpdateDataManager } from './TaskUpdateDataManager.js';
import { TaskUpdateUIManager } from './TaskUpdateUIManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

class TaskUpdateController {
    constructor() {
        this.dataManager = new TaskUpdateDataManager();
        this.uiManager = new TaskUpdateUIManager();
        this.accrualManager = null; 
        this.taskId = null;
        this.taskData = null;
        this.masterData = {}; 
        this.currentDocuments = [];
        this.uploadedEpatsFile = null;
        this.statusBeforeEpatsUpload = null;
        this.tempApplicationData = null; 
        this.selectedIpRecordId = null;
        this.selectedPersonId = null;
        this.tempRenewalData = null;
    }

    async init() {
        await loadSharedLayout();
        ensurePersonModal();

        this.uiManager.ensureApplicationDataModal();
        this.setupApplicationModalEvents();

        this.taskId = new URLSearchParams(window.location.search).get('id');
        if (!this.taskId) return window.location.href = 'task-management.html';

        // 🔥 Yeni Supabase Oturum Kontrolü
        const session = await authService.getCurrentSession();
        if (!session) return window.location.href = 'index.html';
        
        try {
            this.masterData = await this.dataManager.loadAllInitialData();
            await this.refreshTaskData();
            this.setupEvents();
            this.setupAccrualModal();
        } catch (e) {
            console.error('Başlatma hatası:', e);
            alert('Sayfa yüklenemedi: ' + e.message);
        }

        this.uiManager.ensureRenewalDataModal();
        this.setupRenewalModalEvents();
    }

    generateUUID() {
        return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);
    }

    async extractEpatsInfoFromFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument(arrayBuffer);
            const pdf = await loadingTask.promise;

            let fullText = '';
            const maxPages = Math.min(pdf.numPages, 2);
            for (let i = 1; i <= maxPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const strings = content.items.map(item => item.str);
                fullText += strings.join(' ') + '\n';
            }

            const normalizedText = fullText.replace(/\s+/g, ' '); 

            let evrakNo = null;
            const evrakNoRegex = /(?<!İtirazın\s)Evrak\s+(?:No|Numarası)[\s:.\-,"']*([a-zA-Z0-9\-]+)/i;
            const evrakNoMatch = normalizedText.match(evrakNoRegex);
            if (evrakNoMatch) evrakNo = evrakNoMatch[1].trim().replace(/-$/, '');

            let documentDate = null;
            const dateRegex = /(?:Tarih|Evrak\s+Tarihi)[\s:.\-,"']*(\d{1,2}[./]\d{1,2}[./]\d{4})/i;
            const dateMatch = normalizedText.match(dateRegex);
            if (dateMatch) documentDate = this.parseDate(dateMatch[1]);

            return { evrakNo, documentDate };
        } catch (e) { return null; }
    }

    parseDate(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.replace(/\//g, '.').split('.');
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        return null;
    }

    async refreshTaskData() {
        this.taskData = await this.dataManager.getTaskById(this.taskId);
        this.currentDocuments = this.taskData.documents || [];

        this.selectedIpRecordId = this.taskData.relatedIpRecordId || this.taskData.related_ip_record_id || null;
        
        // 🔥 İlgili Taraf Çözümlemesi (JSONB, String veya Objelerden Ayıklama)
        let ownerId = this.taskData.relatedPartyId || this.taskData.related_party_id || this.taskData.opponentId || this.taskData.opponent_id;
        
        if (!ownerId) {
            let owners = this.taskData.task_owner || this.taskData.taskOwner;
            if (typeof owners === 'string') {
                try { owners = JSON.parse(owners); } catch (e) {}
            }
            if (Array.isArray(owners) && owners.length > 0) ownerId = owners[0];
        }
        this.selectedPersonId = ownerId || null;

        this.uiManager.fillForm(this.taskData, this.masterData.users);
        this.uiManager.renderDocuments(this.currentDocuments);
        this.renderAccruals();
        
        if (this.selectedIpRecordId) {
            let rec = this.masterData.ipRecords.find(r => String(r.id) === String(this.selectedIpRecordId));
            if (!rec) {
                // Veritabanında silinmişse bile UI boş kalmasın
                rec = { 
                    id: this.selectedIpRecordId, 
                    title: this.taskData.iprecordTitle || this.taskData.relatedIpRecordTitle || 'Kayıtlı Olmayan Varlık', 
                    applicationNumber: this.taskData.iprecordApplicationNo 
                };
            }
            this.uiManager.renderSelectedIpRecord(rec);
        }
        
        if (this.selectedPersonId) {
            let p = this.masterData.persons.find(x => String(x.id) === String(this.selectedPersonId));
            if (!p) {
                // Veritabanında silinmişse veya çekilememişse yedek isimleri kullan
                p = { 
                    id: this.selectedPersonId, 
                    name: this.taskData.relatedPartyName || this.taskData.related_party_name || this.taskData.opponentName || this.taskData.opponent_name || this.taskData.iprecordApplicantName || 'Kayıtlı Olmayan Taraf'
                };
            }
            this.uiManager.renderSelectedPerson(p);
        }

        this.statusBeforeEpatsUpload = this.taskData.status_before_epats_upload || null;
        this.lockFieldsIfApplicationTask();
    }

    lockFieldsIfApplicationTask() {
        const lockedTypes = ['2'];
        if (lockedTypes.includes(String(this.taskData.taskType))) {
            const ipSearchInput = document.getElementById('relatedIpRecordSearch');
            const ipRemoveBtn = document.querySelector('#selectedIpRecordDisplay #removeIpRecordBtn');
            if (ipSearchInput) { ipSearchInput.disabled = true; ipSearchInput.style.backgroundColor = "#e9ecef"; }
            if (ipRemoveBtn) ipRemoveBtn.style.display = 'none'; 
            
            const partySearchInput = document.getElementById('relatedPartySearch');
            const partyRemoveBtn = document.querySelector('#selectedRelatedPartyDisplay #removeRelatedPartyBtn');
            if (partySearchInput) { partySearchInput.disabled = true; partySearchInput.style.backgroundColor = "#e9ecef"; }
            if (partyRemoveBtn) partyRemoveBtn.style.display = 'none';
        }
    }
    
    setupEvents() {
        document.getElementById('saveTaskChangesBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.saveTaskChanges();
        });

        document.getElementById('cancelEditBtn').addEventListener('click', () => window.location.href = 'task-management.html');

        document.getElementById('fileUploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.uploadDocuments(e.target.files));
        document.getElementById('fileListContainer').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-file');
            if (btn) this.removeDocument(btn.dataset.id);
        });

        document.getElementById('epatsFileUploadArea').addEventListener('click', () => document.getElementById('epatsFileInput').click());
        document.getElementById('epatsFileInput').addEventListener('change', (e) => this.uploadEpatsDocument(e.target.files[0]));

        const epatsDropZone = document.getElementById('epatsFileUploadArea');
        if (epatsDropZone) {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => epatsDropZone.addEventListener(evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); }));
            epatsDropZone.addEventListener('drop', (ev) => {
                const files = ev.dataTransfer?.files;
                if (!files || !files.length) return;
                this.uploadEpatsDocument(files[0]);
            });
        }

        document.getElementById('epatsFileListContainer').addEventListener('click', (e) => {
            if (e.target.closest('#removeEpatsFileBtn')) this.removeEpatsDocument();
        });

        document.getElementById('relatedIpRecordSearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchIpRecords(this.masterData.ipRecords, e.target.value);
            this.renderSearchResults(results, 'ipRecord');
        });
        document.getElementById('relatedPartySearch').addEventListener('input', (e) => {
            const results = this.dataManager.searchPersons(this.masterData.persons, e.target.value);
            this.renderSearchResults(results, 'person');
        });

        document.getElementById('selectedIpRecordDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeIpRecordBtn')) {
                this.selectedIpRecordId = null; 
                this.uiManager.renderSelectedIpRecord(null);
            }
        });
        document.getElementById('selectedRelatedPartyDisplay').addEventListener('click', (e) => {
            if(e.target.closest('#removeRelatedPartyBtn')) {
                this.selectedPersonId = null; 
                this.uiManager.renderSelectedPerson(null);
            }
        });
    }

    setupApplicationModalEvents() {
        const btn = document.getElementById('btnSaveApplicationData');
        if(btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                const appNo = document.getElementById('modalAppNumber').value;
                const appDate = document.getElementById('modalAppDate').value;
                if(!appNo || !appDate) return alert('Lütfen Başvuru Numarası ve Tarihi alanlarını doldurunuz.'); 
                this.tempApplicationData = { appNo, appDate };
                if(window.$) $('#applicationDataModal').modal('hide');
            };
        }
    }

    setupRenewalModalEvents() {
        const btn = document.getElementById('btnSaveRenewalData');
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                const newDate = document.getElementById('modalRenewalDate').value;
                if (!newDate) return showNotification('Lütfen yeni koruma tarihini giriniz.', 'warning');
                this.tempRenewalData = newDate;
                if (window.$) $('#renewalDataModal').modal('hide');
            };
        }
    }

    handleRenewalLogic() {
        const record = this.masterData.ipRecords.find(r => String(r.id) === String(this.selectedIpRecordId));
        if (!record) return;
        if ((record.origin || '').toUpperCase() === 'TÜRKPATENT' && record.renewalDate) {
            const nextRenewalDate = new Date(record.renewalDate);
            nextRenewalDate.setFullYear(nextRenewalDate.getFullYear() + 10);
            document.getElementById('modalRenewalDate').value = nextRenewalDate.toISOString().split('T')[0];
        }
        if (window.$) $('#renewalDataModal').modal({ backdrop: 'static', keyboard: false, show: true });
    }
    
    renderSearchResults(items, type) {
        const container = type === 'ipRecord' ? this.uiManager.elements.ipResults : this.uiManager.elements.partyResults;
        container.innerHTML = '';
        if (items.length === 0) return container.style.display = 'none';
        items.slice(0, 10).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = type === 'ipRecord' ? (item.title || item.brandName) : item.name;
            div.onclick = () => {
                if (type === 'ipRecord') {
                    this.selectedIpRecordId = item.id;
                    this.uiManager.renderSelectedIpRecord(item);
                } else {
                    this.selectedPersonId = item.id;
                    this.uiManager.renderSelectedPerson(item);
                }
                container.style.display = 'none';
            };
            container.appendChild(div);
        });
        container.style.display = 'block';
    }

    async uploadDocuments(files) {
        if (!files.length) return;
        for (const file of files) {
            const id = this.generateUUID();
            
            // 🔥 ÇÖZÜM: Dosya adındaki boşluk ve Türkçe/özel karakterleri temizle
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `tasks/${this.taskId}/${id}_${cleanFileName}`;
            
            try {
                const url = await this.dataManager.uploadFile(file, path);
                this.currentDocuments.push({
                    id, 
                    name: file.name, // Orijinal adı UI'da göstermek için tutuyoruz
                    url, 
                    storagePath: path, 
                    size: file.size, 
                    uploadedAt: new Date().toISOString()
                });
            } catch (e) { console.error(e); }
        }
        this.uiManager.renderDocuments(this.currentDocuments);
        await this.dataManager.updateTask(this.taskId, { documents: this.currentDocuments });
    }

    async removeDocument(id) {
        if (!confirm('Silmek istediğinize emin misiniz?')) return;
        const doc = this.currentDocuments.find(d => d.id === id);
        if (doc && doc.storagePath) await this.dataManager.deleteFileFromStorage(doc.storagePath);
        this.currentDocuments = this.currentDocuments.filter(d => d.id !== id);
        this.uiManager.renderDocuments(this.currentDocuments);
        await this.dataManager.updateTask(this.taskId, { documents: this.currentDocuments });
    }

    async uploadEpatsDocument(file) {
        if (!file) return;
        
        const existingEpats = this.currentDocuments.find(d => d.type === 'epats_document');
        if (!existingEpats) {
            this.statusBeforeEpatsUpload = document.getElementById('taskStatus').value;
        }

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            showNotification('PDF taranıyor, evrak bilgileri okunuyor...', 'info');
            
            this.extractEpatsInfoFromFile(file).then(info => {
                if (info) {
                    const noInput = document.getElementById('turkpatentEvrakNo');
                    const dateInput = document.getElementById('epatsDocumentDate');

                    let msg = [];
                    if (info.evrakNo && noInput && !noInput.value) {
                        noInput.value = info.evrakNo;
                        msg.push('Evrak No');
                    }
                    if (info.documentDate && dateInput && !dateInput.value) {
                        dateInput.value = info.documentDate;
                        if (dateInput._flatpickr) {
                            dateInput._flatpickr.setDate(info.documentDate, true);
                        }
                        msg.push('Tarih');
                    }

                    if (msg.length > 0) {
                        showNotification(`✅ PDF'ten otomatik dolduruldu: ${msg.join(', ')}`, 'success');
                    }
                }
            });
        }

        const id = this.generateUUID();
        
        // 🔥 ÇÖZÜM: Dosya adındaki boşluk ve Türkçe/özel karakterleri temizle
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const path = `tasks/${this.taskId}/epats_${id}_${cleanFileName}`;
        
        try {
            const url = await this.dataManager.uploadFile(file, path);
            const epatsDoc = {
                id, 
                name: file.name, // Arayüzde düzgün görünmesi için orijinal isim kalır
                url, 
                downloadURL: url, 
                storagePath: path, 
                size: file.size,
                uploadedAt: new Date().toISOString(), 
                type: 'epats_document'
            };

            this.currentDocuments = this.currentDocuments.filter(d => d.type !== 'epats_document');
            this.currentDocuments.push(epatsDoc);

            this.uiManager.renderDocuments(this.currentDocuments);

            const statusSelect = document.getElementById('taskStatus');
            if(statusSelect) statusSelect.value = 'completed'; 

            const taskType = String(this.taskData.taskType);
            if (taskType === '22') this.handleRenewalLogic();
            if (this.isApplicationTask(taskType) && typeof $ !== 'undefined') {
                this.uiManager.ensureApplicationDataModal();
                setTimeout(() => $('#applicationDataModal').modal({ backdrop: 'static', keyboard: false, show: true }), 100);
            }
        } catch (e) {
            showNotification('Dosya yüklenirken hata oluştu: ' + e.message, 'error');
        }
    }
    
    async removeEpatsDocument() {
        if (!confirm('EPATS evrakı silinecek. Emin misiniz?')) return;
        const epatsDoc = this.currentDocuments.find(d => d.type === 'epats_document');
        if (epatsDoc?.storagePath) {
            try { await this.dataManager.deleteFileFromStorage(epatsDoc.storagePath); } catch (e) { }
        }
        this.currentDocuments = this.currentDocuments.filter(d => d.type !== 'epats_document');
        document.getElementById('taskStatus').value = 'open';
        this.uiManager.renderDocuments(this.currentDocuments);
    }

    isApplicationTask(taskType) { return ['2'].includes(String(taskType)); }

    setupAccrualModal() {
        this.accrualManager = new AccrualFormManager('accrualFormContainer', 'taskUpdate', this.masterData.persons);
        this.accrualManager.render();
        
        document.getElementById('addAccrualBtn').onclick = (e) => { e.preventDefault(); this.openAccrualModal(); };

        document.getElementById('accrualsContainer').addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-accrual-btn')) {
                e.preventDefault();
                this.openAccrualModal(e.target.dataset.id);
            }
        });

        document.getElementById('saveAccrualBtn').onclick = async () => {
            const result = this.accrualManager.getData();
            if (result.success) {
                const data = result.data;
                data.taskId = this.taskId;
                const modalEl = document.getElementById('accrualModal');
                if (modalEl.dataset.editingId) data.id = modalEl.dataset.editingId;

                try {
                    await this.dataManager.saveAccrual(data, !!modalEl.dataset.editingId);
                    $('#accrualModal').modal('hide');
                    this.renderAccruals();
                    showNotification('Tahakkuk kaydedildi.', 'success');
                } catch (error) { alert('Kaydetme hatası: ' + error.message); }
            } else alert(result.error);
        };
    }

    openAccrualModal(accId = null) {
        const modalEl = document.getElementById('accrualModal');
        this.accrualManager.render(); 
        if (accId) {
            modalEl.dataset.editingId = accId;
            document.querySelector('#accrualModal .modal-title').textContent = 'Tahakkuk Düzenle';
            this.dataManager.getAccrualsByTaskId(this.taskId).then(accruals => {
                const acc = accruals.find(a => a.id === accId);
                if (acc) this.accrualManager.setData(acc);
            });
        } else {
            delete modalEl.dataset.editingId;
            document.querySelector('#accrualModal .modal-title').textContent = 'Yeni Tahakkuk Ekle';
        }
        if (window.$) $('#accrualModal').modal('show');
    }

    // 🔥 YENİ: JSONB objelerini veya dizilerini okuyup düzgün metne çeviren formatlayıcı
    formatCurrency(amountData) {
        if (!amountData) return '0 TRY';
        
        // Eğer dizi (array) olarak gelirse (Örn: birden çok döviz)
        if (Array.isArray(amountData)) {
            if (amountData.length === 0) return '0 TRY';
            return amountData.map(x => `${x.amount || 0} ${x.currency || 'TRY'}`).join(' + ');
        }
        
        // Eğer obje olarak gelirse
        if (typeof amountData === 'object') {
            return `${amountData.amount || 0} ${amountData.currency || 'TRY'}`;
        }
        
        // Sadece düz sayı ise
        return `${amountData} TRY`;
    }

    // 🔥 GÜNCELLENDİ: formatCurrency kullanılarak ekrana basılıyor
    async renderAccruals() {
        const accruals = await this.dataManager.getAccrualsByTaskId(this.taskId);
        const container = document.getElementById('accrualsContainer');
        
        if (!accruals || accruals.length === 0) {
            container.innerHTML = `<div class="text-center p-3 text-muted border rounded bg-light"><i class="fas fa-receipt mr-2"></i>Kayıt bulunamadı.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="row w-100 m-0">
                ${accruals.map(a => {
                    // Objeyi güvenle formatla
                    const amountStr = this.formatCurrency(a.totalAmount || a.total_amount);
                    
                    // Duruma göre renk belirle
                    let statusColor = '#f39c12'; 
                    let statusText = 'Ödenmedi';
                    if(a.status === 'paid') { statusColor = '#27ae60'; statusText = 'Ödendi'; }
                    else if(a.status === 'cancelled') { statusColor = '#95a5a6'; statusText = 'İptal'; }

                    return `
                    <div class="col-12 mb-3 px-0">
                        <div class="card shadow-sm border-light w-100 h-100">
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <h5 class="mb-0 font-weight-bold text-dark">${amountStr}</h5>
                                    <span class="badge badge-pill text-white" style="background-color: ${statusColor}; font-size: 0.8rem;">${statusText}</span>
                                </div>
                                <div class="text-right">
                                    <button class="btn btn-sm btn-outline-primary edit-accrual-btn" data-id="${a.id}">
                                        <i class="fas fa-pen mr-1"></i>Düzenle
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
    }

    async saveTaskChanges() {
        const epatsDocIndex = this.currentDocuments.findIndex(d => d.type === 'epats_document');
        if (epatsDocIndex !== -1) {
            const evrakNo = document.getElementById('turkpatentEvrakNo').value;
            const evrakDate = document.getElementById('epatsDocumentDate').value;
            if (!evrakNo || !evrakDate) return showNotification('Lütfen EPATS evrak bilgilerini (No ve Tarih) doldurunuz.', 'warning');
            this.currentDocuments[epatsDocIndex].turkpatentEvrakNo = evrakNo;
            this.currentDocuments[epatsDocIndex].documentDate = evrakDate;
        }

        // Kullanıcı bilgisini profilden de alacak şekilde güvenli hale getirelim
        let userEmail = 'Bilinmiyor';
        try {
            const session = await authService.getCurrentSession();
            if (session) {
                const { data: profile } = await supabase.from('users').select('email').eq('id', session.user.id).single();
                userEmail = profile?.email || session.user.email;
            }
        } catch(e) {}

        const newHistoryEntry = {
            action: "Görev güncellendi",
            timestamp: new Date().toISOString(),
            userEmail: userEmail
        };
        const history = this.taskData.history ? [...this.taskData.history] : [];
        history.push(newHistoryEntry);

        const officialDateVal = document.getElementById('taskDueDate').value;
        const operationalDateVal = document.getElementById('deliveryDate').value;

        // 🔥 Supabase _enrichTasksWithRelations ve updateTask için doğru isimlendirmelerle veriyi yolluyoruz
        const updateData = {
            status: document.getElementById('taskStatus').value,
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDescription').value,
            priority: document.getElementById('taskPriority').value,
            relatedIpRecordId: this.selectedIpRecordId, // updateTask fonksiyonu bunu yakalar
            relatedPartyId: this.selectedPersonId,      // updateTask fonksiyonu bunu yakalar
            documents: this.currentDocuments,
            history: history,
            officialDueDate: officialDateVal ? new Date(officialDateVal).toISOString() : null,
            dueDate: operationalDateVal ? new Date(operationalDateVal).toISOString() : null,
            operationalDueDate: operationalDateVal ? new Date(operationalDateVal).toISOString() : null
        };

        const res = await this.dataManager.updateTask(this.taskId, updateData);
        
        if (res.success) {
            if (this.selectedIpRecordId) {
                try {
                    let transId = this.taskData.transactionId || await this.dataManager.findTransactionIdByTaskId(this.selectedIpRecordId, this.taskId);
                    // Dökümanlar zaten task_documents tablosuna kaydedildiği için transactions tablosuna gönderilmez.
                    if (transId) await this.dataManager.updateTransaction(this.selectedIpRecordId, transId, { updated_at: new Date().toISOString() });
                } catch (err) { console.error("Senkronizasyon hatası:", err); }
            }
            
            showNotification('Değişiklikler başarıyla kaydedildi.', 'success');
            localStorage.setItem('crossTabUpdatedTaskId', this.taskId);
            setTimeout(() => { window.location.href = 'task-management.html'; }, 1000); 
        } else {
            showNotification('Hata: ' + res.error, 'error');
        }
    }
}

new TaskUpdateController().init();