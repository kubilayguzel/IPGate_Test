// public/js/etebs-module.js

import { firebaseServices, authService, ipRecordsService } from '../firebase-config.js';
import { ref, getDownloadURL, uploadBytes, getStorage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { collection, query, where, getDocs, addDoc, orderBy, limit, doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
// --- Modüller ---
import { RecordMatcher } from './indexing/record-matcher.js';
import Pagination from './pagination.js';

// Notification Helper
function showNotification(message, type = 'info') {
    if (window.showNotification) window.showNotification(message, type);
    else console.log(`[${type}] ${message}`);
}

export class ETEBSManager {
    constructor() {
        this.currentMode = 'etebs'; // 'etebs' | 'upload'
        this.matcher = new RecordMatcher(); 
        
        // Veri Havuzları
        this.matchedDocs = [];
        this.unmatchedDocs = [];
        this.indexedDocs = [];

        // Pagination Referansları
        this.paginations = { matched: null, unmatched: null, indexed: null };

        // Başlat
        this.init();
    }

    async init() {
        // 1. Badge'i güncelle
        await this.updateMainBadgeCount();

        // 3. Event Listener'ları kur
        this.bindEvents();

   }

    // ============================================================
    // 0. GERİYE DÖNÜK UYUMLULUK (HTML ile Uyum)
    // ============================================================
    
    /**
     * HTML dosyasındaki eski çağrıları karşılamak için köprü fonksiyon.
     * fetchNotifications(true, false) şeklindeki çağrıları yeni yapıya yönlendirir.
     */
    async fetchNotifications(isSilent = false, triggerServerSync = false) {
        // Eğer sunucu tetiklenmesi isteniyorsa (eski butona basıldıysa)
        if (triggerServerSync) {
            await this.triggerServerSync();
        }
        
        // Yeni veri yükleme fonksiyonunu çağır (isSilent -> isBackgroundRefresh)
        await this.loadAndProcessDocuments(isSilent);
    }

    // ============================================================
    // 1. BADGE YÖNETİMİ
    // ============================================================
    
    async updateMainBadgeCount() {
        try {
            // Sadece 'pending' olanları say
            const q = query(
                collection(firebaseServices.db, 'unindexed_pdfs'),
                where('status', '==', 'pending')
            );
            
            const snapshot = await getDocs(q);
            const count = snapshot.size;

            // UI Güncelle
            const badge = document.querySelector('.tab-badge') || document.getElementById('totalBadge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        } catch (error) {
            console.warn('Badge güncelleme hatası:', error);
        }
    }

    // ============================================================
    // 2. SUNUCU SENKRONİZASYONU (SYNC)
    // ============================================================

    async triggerServerSync() {
        const input = document.getElementById('etebsTokenInput');
        const token = input ? input.value.trim() : null;
        const user = authService.auth.currentUser;

        if (!token || !user) throw new Error('Token eksik.');

        // 🔥 DÜZELTME: Token'ı tarayıcı hafızasına (localStorage) kaydetme kodunu sildik.

        try {
            const hostname = window.location.hostname;
            const isTestEnv = (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("ip-manager-production-aab4b"));
            const projectId = isTestEnv ? "ip-manager-production-aab4b" : "ipgate-31bd2";
            const region = 'europe-west1';
            const functionUrl = `https://${region}-${projectId}.cloudfunctions.net/etebsProxyV2`;

            console.log(`🚀 Sync Başlatılıyor... (${isTestEnv ? 'TEST' : 'PROD'})`);

            // 🔥 DÜZELTME: `await fetch` ile sunucunun belgeleri indirip birleştirmesini bekliyoruz
            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'CHECK_LIST_ONLY',
                    token: token,
                    userId: user.uid
                })
            });

            if (!response.ok) {
                throw new Error(`Sunucu Hatası: ${response.status}`);
            }
            
            const result = await response.json();
            return result; // İşlem sonucunu döndür

        } catch (e) {
            console.warn("Sync hatası:", e);
            throw e;
        }
    }

    // ============================================================
    // 3. VERİ ÇEKME VE EŞLEŞTİRME (CORE LOGIC)
    // ============================================================

    async handleFetchButton() {
        const input = document.getElementById('etebsTokenInput');
        const token = input ? input.value.trim() : null;

        if (!token) {
            showNotification('Lütfen geçerli bir ETEBS Token giriniz.', 'warning');
            return;
        }

        // --- 🚀 LOADER BAŞLAT ---
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show({
                text: 'Evraklar İndiriliyor',
                subtext: 'TÜRKPATENT ile bağlantı kuruldu. Yeni tebligatlar çekilip işleniyor, bu işlem evrak sayısına göre 1-2 dakika sürebilir. Lütfen sayfadan ayrılmayın...'
            });
        }

        // Tarayıcıya loader'ı çizmesi için kısa bir süre tanıyalım
        await new Promise(r => setTimeout(r, 200));

        try {
            // 🔥 DÜZELTME: İşlem BİTENE KADAR kodu burada bekletir (Loader dönmeye devam eder)
            const result = await this.triggerServerSync();

            // İşlem başarılı bittiyse token kutusunu temizle
            if (input) input.value = '';

            if (result && result.success) {
                if (window.SimpleLoadingController) {
                    window.SimpleLoadingController.showSuccess('Tüm evraklar başarıyla indirildi ve işlendi.');
                }

                // --- 🔥 SAYFAYI YENİLEMEK YERİNE ANINDA GÜNCELLE ---
                setTimeout(() => {
                    // Sayfayı baştan yüklemek yerine sadece evrak listesini çeken fonksiyonu tetikleyelim
                    this.loadAndProcessDocuments(false); 
                }, 1500);
            } else {
                throw new Error(result?.error || 'Sunucu işlemi tamamlayamadı.');
            }

        } catch (error) {
            console.error("Sorgu hatası:", error);
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            showNotification('Evraklar çekilirken hata oluştu: ' + error.message, 'error');
        }
    }

    async loadAndProcessDocuments(isBackgroundRefresh = false) {
        if (!isBackgroundRefresh && window.SimpleLoadingController) {
            window.SimpleLoadingController.show({ 
                text: 'Evraklar taranıyor...', 
                subtext: 'Veriler kontrol ediliyor...' 
            });
        }

        try {
            const db = firebaseServices.db;
            const colRef = collection(db, 'unindexed_pdfs');

            // 1. SADECE Bekleyenleri (Pending) Çekiyoruz. İndekslenenleri BURADA ÇEKMİYORUZ!
            const qPending = query(colRef, where('status', '==', 'pending'), limit(150));
            const snapPending = await getDocs(qPending);

            this.matchedDocs = [];
            this.unmatchedDocs = [];

            // 2. Eşleşmemiş Evrak Var mı Kontrolü
            let needsMatching = false;
            snapPending.forEach(docSnap => {
                if (docSnap.data().matched !== true) {
                    needsMatching = true;
                }
            });

            // 3. EĞER Eşleşmemiş Evrak Varsa, SADECE O ZAMAN Tüm Portföyü Çek! (EN BÜYÜK HIZLANDIRICI)
            const portfolioMap = new Map();
            if (needsMatching) {
                if (!isBackgroundRefresh && window.SimpleLoadingController) {
                    window.SimpleLoadingController.updateText('Portföy Taranıyor', 'Yeni evraklar için veritabanı inceleniyor...');
                }
                const recordsResult = await ipRecordsService.getAllRecords({ source: 'server' });
                const portfolioRecords = recordsResult.success ? recordsResult.data : [];
                
                portfolioRecords.forEach(record => {
                    [record.applicationNumber, record.applicationNo, record.wipoIR, record.aripoIR]
                        .filter(Boolean)
                        .forEach(num => {
                            const normalized = this.matcher._normalize(num);
                            if (normalized) portfolioMap.set(normalized, record);
                        });
                });
            }

            // 4. Verileri İşle ve Veritabanını Güncelle
            const updatePromises = [];

            snapPending.forEach(docSnap => {
                const data = docSnap.data();
                const docObj = this._normalizeDocData(docSnap.id, data);
                
                if (data.matched === true && data.matchedRecordId) {
                    // Zaten veritabanında eşleşmiş, hesaplama yapma, listeye ekle geç.
                    docObj.matched = true;
                    docObj.matchedRecordId = data.matchedRecordId;
                    docObj.matchedRecordDisplay = data.matchedRecordDisplay || 'Eşleşen Kayıt';
                    docObj.recordOwnerType = data.recordOwnerType || 'self';
                    this.matchedDocs.push(docObj);
                } else {
                    // Eşleşmemiş, Map'te ara
                    const rawSearchKey = docObj.dosyaNo || docObj.applicationNo || docObj.extractedAppNumber || docObj.evrakNo;
                    const searchKey = this.matcher._normalize(rawSearchKey);
                    const match = searchKey ? portfolioMap.get(searchKey) : null;

                    if (match) {
                        docObj.matched = true;
                        docObj.matchedRecordId = match.id;
                        docObj.matchedRecordDisplay = this.matcher.getDisplayLabel(match);
                        docObj.recordOwnerType = match.recordOwnerType || 'self';
                        this.matchedDocs.push(docObj);

                        // 🔥 EŞLEŞMEYİ VERİTABANINA YAZ Kİ BİR SONRAKİ SAYFA AÇILIŞINDA YORMASIN
                        const docRef = doc(db, 'unindexed_pdfs', docSnap.id);
                        updatePromises.push(updateDoc(docRef, {
                            matched: true,
                            matchedRecordId: match.id,
                            matchedRecordDisplay: docObj.matchedRecordDisplay,
                            recordOwnerType: docObj.recordOwnerType
                        }));

                    } else {
                        docObj.matched = false;
                        this.unmatchedDocs.push(docObj);
                    }
                }
            });

            // Veritabanı güncellemelerini arka planda yap (Kullanıcıyı bekletmez)
            if (updatePromises.length > 0) {
                Promise.all(updatePromises).catch(err => console.error("DB Match güncelleme hatası:", err));
            }

            this.renderAllTabs();
            this.updateMainBadgeCount(); 

            if (!isBackgroundRefresh) {
                showNotification(`${this.matchedDocs.length} eşleşen, ${this.unmatchedDocs.length} bekleyen evrak listelendi.`, 'success');
            }

        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            if (!isBackgroundRefresh) showNotification('Evrak listesi alınamadı.', 'error');
        } finally {
            if (!isBackgroundRefresh && window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    _normalizeDocData(id, data) {
        return {
            id: id,
            ...data,
            uploadedAt: this._toDate(data.uploadedAt),
            belgeTarihi: this._toDate(data.belgeTarihi || data.uploadedAt),
            tebligTarihi: this._toDate(data.tebligTarihi) // <--- BU SATIR EKLENDİ
        };
    }

    _toDate(timestamp) {
        if (!timestamp) return null;
        if (typeof timestamp.toDate === 'function') return timestamp.toDate();
        if (timestamp instanceof Date) return timestamp;
        const d = new Date(timestamp);
        return isNaN(d.getTime()) ? null : d;
    }

    // ============================================================
    // 4. UI RENDER VE PAGINATION
    // ============================================================

    renderAllTabs() {
        this._updateTabBadge('matchedTabBadge', this.matchedDocs.length);
        this._updateTabBadge('unmatchedTabBadge', this.unmatchedDocs.length);
        
        // İndekslenen sekmesine tıklandığında yükleneceği için varsayılan olarak ... göster
        const indexedBadge = document.getElementById('indexedTabBadge');
        if (indexedBadge && (!this.indexedDocs || this.indexedDocs.length === 0)) {
            indexedBadge.textContent = '...';
        }

        const sortFn = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);

        this.setupPagination('matched', this.matchedDocs.sort(sortFn), 'matchedNotificationsList');
        this.setupPagination('unmatched', this.unmatchedDocs.sort(sortFn), 'unmatchedNotificationsList');

        this._autoSwitchTab();
    }

    _updateTabBadge(id, count) {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    }

    _autoSwitchTab() {
        const activeBtn = document.querySelector('.notification-tab-btn.active');
        if (!activeBtn) return;

        const currentTarget = activeBtn.getAttribute('data-target');
        
        if (currentTarget === 'matched-notifications-tab' && this.matchedDocs.length === 0 && this.unmatchedDocs.length > 0) {
            this.switchNotificationsTab('unmatched-notifications-tab');
        } else if (currentTarget === 'unmatched-notifications-tab' && this.unmatchedDocs.length === 0 && this.matchedDocs.length > 0) {
            this.switchNotificationsTab('matched-notifications-tab');
        }
    }

    setupPagination(type, dataList, containerId) {
        const paginationId = `${type}Pagination`;
        
        if (this.paginations[type]) { /* Opsiyonel temizlik */ }

        this.paginations[type] = new Pagination({
            containerId: paginationId,
            itemsPerPage: 10,
            showItemsPerPageSelector: true,
            onPageChange: (currentPage, itemsPerPage) => {
                const start = (currentPage - 1) * itemsPerPage;
                const pageItems = dataList.slice(start, start + itemsPerPage);
                this.renderListItems(containerId, pageItems, type);
            }
        });

        this.paginations[type].update(dataList.length);
        this.renderListItems(containerId, dataList.slice(0, 10), type);
    }

    renderListItems(containerId, items, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding:20px; text-align:center; color:#999;">
                <i class="fas fa-folder-open fa-2x mb-2"></i><br>Kayıt bulunamadı
            </div>`;
            return;
        }

        container.innerHTML = items.map(item => this._createItemHTML(item, type)).join('');

        container.querySelectorAll('.notification-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this._handleItemAction(e, items));
        });
    }

    _createItemHTML(doc, type) {
        const dateStr = doc.uploadedAt ? doc.uploadedAt.toLocaleDateString('tr-TR') : '-';
        const isManual = (doc.source === 'manual' || doc.source === 'MANUEL');
        
        const sourceBadge = isManual 
            ? '<span class="badge badge-warning text-white mr-2" style="font-size:0.7em;">MANUEL</span>' 
            : '<span class="badge badge-info mr-2" style="font-size:0.7em;">ETEBS</span>';

        let statusHtml = '';
        let actionBtn = '';

        if (type === 'matched') {
            statusHtml = `<span class="text-success font-weight-bold"><i class="fas fa-link"></i> ${doc.matchedRecordDisplay || 'Eşleşti'}</span>`;
            actionBtn = `<button class="btn btn-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="İndeksle">
                            <i class="fas fa-edit"></i>
                         </button>`;
        } else if (type === 'unmatched') {
            statusHtml = `<span class="text-danger"><i class="fas fa-times"></i> Eşleşmedi</span>`;
            actionBtn = `<button class="btn btn-outline-primary btn-sm notification-action-btn" data-action="index" data-id="${doc.id}" title="Manuel İndeksle">
                            <i class="fas fa-edit"></i>
                         </button>`;
        } else {
            statusHtml = `<span class="text-muted"><i class="fas fa-check-double"></i> İndekslendi</span>`;
            actionBtn = `<button class="btn btn-light btn-sm" disabled style="opacity:0.5"><i class="fas fa-check"></i></button>`;
        }

        return `
            <div class="pdf-list-item ${type} p-3 mb-2 bg-white rounded border shadow-sm" style="border-left: 4px solid ${type==='matched'?'#28a745':type==='unmatched'?'#dc3545':'#6c757d'} !important;">
                <div class="d-flex align-items-center w-100">
                    <div class="pdf-icon mr-3">
                        <i class="fas fa-file-pdf fa-2x text-danger"></i>
                    </div>
                    <div style="flex:1">
                        <div class="mb-1 d-flex align-items-center">
                            ${sourceBadge} 
                            <strong class="text-dark">${doc.fileName || doc.belgeAciklamasi || 'İsimsiz Belge'}</strong>
                        </div>
                        <div class="small text-muted">
                            <i class="far fa-calendar-alt"></i> ${dateStr} • 
                            <strong>Evrak No:</strong> ${doc.evrakNo || '-'} • 
                            <strong>Dosya:</strong> ${doc.dosyaNo || '-'}
                        </div>
                        <div class="small mt-1">${statusHtml}</div>
                    </div>
                    <div class="ml-2 d-flex flex-column align-items-end">
                        <button class="btn btn-success btn-sm notification-action-btn mb-1" data-action="show" data-id="${doc.id}" title="Görüntüle">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${actionBtn}
                    </div>
                </div>
            </div>
        `;
    }

    _handleItemAction(e, items) {
        const btn = e.target.closest('.notification-action-btn');
        if (!btn) return;
        e.stopPropagation();

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const doc = items.find(i => i.id === id);

        if (!doc) return;

        if (action === 'show') {
            if (doc.fileUrl) window.open(doc.fileUrl, '_blank');
            else showNotification('Dosya URL\'i bulunamadı', 'error');
        } else if (action === 'index') {
            const q = doc.dosyaNo || doc.evrakNo || '';
            const recordId = doc.matchedRecordId || '';
            
            // KESİNLİKLE sadece tebligTarihi kullanılacak, belgeTarihi'ne bakılmayacak
            const targetDate = doc.tebligTarihi;
            let dateStr = '';
            
            if (targetDate) {
                // Saat dilimi kaymasını önlemek için güvenli formatlama:
                const yyyy = targetDate.getFullYear();
                const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
                const dd = String(targetDate.getDate()).padStart(2, '0');
                dateStr = `${yyyy}-${mm}-${dd}`;
            }
            
            window.location.href = `indexing-detail.html?pdfId=${encodeURIComponent(doc.id)}&q=${encodeURIComponent(q)}&recordId=${encodeURIComponent(recordId)}&deliveryDate=${encodeURIComponent(dateStr)}`;
        }
    }

    // ============================================================
    // 5. TAB, MOD VE UPLOAD YÖNETİMİ
    // ============================================================

    bindEvents() {
        const fetchBtn = document.getElementById('fetchNotificationsBtn');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleFetchButton();
            });
        }

        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchNotificationsTab(btn.getAttribute('data-target'));
            });
        });

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchMode(e.target.dataset.mode);
            });
        });
    }

    switchNotificationsTab(targetId) {
        document.querySelectorAll('.notification-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
        });
        document.querySelectorAll('.notification-tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === targetId);
        });

        // 🔥 İndekslenenler sekmesine tıklanırsa veriyi ÇEK (Lazy Load)
        if (targetId === 'indexed-notifications-tab') {
            this.loadIndexedDocuments();
        }
    }

    async loadIndexedDocuments() {
        // Zaten çekildiyse tekrar çekerek sunucuyu yorma
        if (this.indexedDocs && this.indexedDocs.length > 0) return;

        const container = document.getElementById('indexedNotificationsList');
        if (container) container.innerHTML = '<div class="text-center p-4 text-muted"><i class="fas fa-spinner fa-spin fa-2x mb-3"></i><br>İndekslenmiş evraklar getiriliyor...</div>';

        try {
            const colRef = collection(firebaseServices.db, 'unindexed_pdfs');
            const qIndexed = query(colRef, where('status', '==', 'indexed'), orderBy('uploadedAt', 'desc'), limit(50));
            const snapIndexed = await getDocs(qIndexed);

            this.indexedDocs = [];
            snapIndexed.forEach(docSnap => {
                this.indexedDocs.push(this._normalizeDocData(docSnap.id, docSnap.data()));
            });

            this._updateTabBadge('indexedTabBadge', this.indexedDocs.length);
            
            const sortFn = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);
            this.setupPagination('indexed', this.indexedDocs.sort(sortFn), 'indexedNotificationsList');

        } catch (error) {
            console.error('İndekslenen evraklar çekilemedi:', error);
            if (container) container.innerHTML = '<div class="text-center p-3 text-danger">Veriler alınırken hata oluştu.</div>';
        }
    }

    switchMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        const etebsContent = document.getElementById('etebs-content');
        const uploadContent = document.getElementById('upload-content');

        if(etebsContent) etebsContent.style.display = mode === 'etebs' ? 'block' : 'none';
        if(uploadContent) uploadContent.style.display = mode === 'upload' ? 'block' : 'none';
    }

}

// Global Erişim
window.ETEBSManager = ETEBSManager;