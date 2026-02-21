// public/js/indexing/epats-ui-manager.js

import { PersonDataManager } from '../persons/PersonDataManager.js';
import { PortfolioDataManager } from '../portfolio/PortfolioDataManager.js';
import { ipRecordsService } from '../../firebase-config.js';
import { showNotification } from '../../utils.js';
// DÜZELTME: 'export default' olduğu için süslü parantez kaldırıldı
import Pagination from '../pagination.js';

export class EpatsUiManager {
    constructor() {
        this.personData = new PersonDataManager();
        this.portfolioData = new PortfolioDataManager();
        this.filteredRecords = [];
        this.selectedRecordIds = new Set();
        this.pagination = null;
        
        // Eklenti İletişim ID'si (Manifest.json'daki ID ile aynı olmalı)
        // Desteklenen Eklenti ID'leri (Hangi eklenti yüklüyse o çalışır)
        this.extensionIds = [
            "hffjgcfcelfemkmgocpjjphfmjlhpdnb", // 1. ID (Mevcut)
            "poikphboglooldcjgmgakjnmibghbdbf"  // 2. ID (Yeni)
        ];

        this.init();
    }

    async init() {
        console.log('EpatsUiManager başlatılıyor...');
        await this.loadClients();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Eksik Belgeleri Listele Butonu
        const fetchBtn = document.getElementById('btnFetchMissingDocs');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', () => this.findMissingDocuments());
        }

        // Transferi Başlat Butonu
        const startBtn = document.getElementById('btnStartEpatsTransfer');
        if (startBtn) {
            startBtn.addEventListener('click', () => this.startTransfer());
        }

        // Tümünü Seç Checkbox
        const selectAll = document.getElementById('selectAllEpats');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        }
    }

    async loadClients() {
        const select = document.getElementById('epatsClientSelect');
        if (!select) return;

        try {
            const response = await this.personData.fetchPersons();
            if (response.success && Array.isArray(response.data)) {
                // İsme göre sırala
                const clients = response.data.sort((a, b) => a.name.localeCompare(b.name));
                
                select.innerHTML = '<option value="">Müvekkil Seçiniz...</option>' + 
                    clients.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            }
        } catch (error) {
            console.error('Müvekkil listesi hatası:', error);
            showNotification('Müvekkil listesi yüklenemedi.', 'error');
        }
    }

    async findMissingDocuments() {
        const clientId = document.getElementById('epatsClientSelect').value;
        const ipType = document.getElementById('epatsIpTypeSelect').value;
        const docType = document.getElementById('epatsDocTypeSelect').value; // örn: "tescil_belgesi"

        if (!clientId) {
            showNotification('Lütfen bir müvekkil seçiniz.', 'warning');
            return;
        }

        const btn = document.getElementById('btnFetchMissingDocs');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Taranıyor...';

        try {
            // 1. Portföyü Yükle
            await this.portfolioData.loadInitialData();
            
            // 2. Temel Filtreleme (Sahip + Tür + Status)
            const candidates = this.portfolioData.allRecords.filter(r => {
                const isClientMatch = r.applicants && r.applicants.some(app => app.id === clientId);
                const isTypeMatch = r.type === ipType;
                // Status kontrolü: registered, tescilli vb.
                const isRegistered = r.status && ['registered', 'tescilli'].includes(r.status.toLowerCase());
                
                return isClientMatch && isTypeMatch && isRegistered;
            });

            console.log(`${candidates.length} adet aday kayıt bulundu. Detaylı tarama yapılıyor...`);

            // 3. Detaylı Tarama (Transaction Kontrolü)
            const missingDocs = [];
            
            // Paralel sorgu limiti
            const chunkSize = 10;
            for (let i = 0; i < candidates.length; i += chunkSize) {
                const chunk = candidates.slice(i, i + chunkSize);
                const results = await Promise.all(chunk.map(async (record) => {
                    const txResult = await ipRecordsService.getTransactionsForRecord(record.id);
                    if (txResult.success) {
                        const hasDocument = txResult.transactions.some(t => {
                            return t.type === docType || 
                                   (t.description && t.description.toLowerCase().includes('tescil belgesi'));
                        });

                        if (!hasDocument) return record; // Belge yoksa listeye ekle
                    }
                    return null;
                }));
                
                missingDocs.push(...results.filter(r => r !== null));
            }

            this.filteredRecords = missingDocs;
            this.renderTable();
            
            if (missingDocs.length === 0) {
                showNotification('Eksik belgesi olan kayıt bulunamadı.', 'success');
            } else {
                showNotification(`${missingDocs.length} adet eksik belgeli kayıt bulundu.`, 'info');
                document.getElementById('epatsResultsSection').style.display = 'block';
            }

        } catch (error) {
            console.error('Tarama hatası:', error);
            showNotification('Tarama sırasında hata oluştu: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-search mr-2"></i>Eksik Belgeleri Listele';
        }
    }

    renderTable() {
        if (this.pagination) {
            // Veriyi güncelle ve sayfayı yenile
            this.pagination.update(this.filteredRecords.length);
            // Sayfa değişim callback'i otomatik tetiklenmez, manuel render gerekebilir
            // Ancak Pagination sınıfı update içinde render çağırmalıdır.
            // Bizim Pagination.js yapımızda update metodu render'ı çağırıyor.
            // Fakat veriyi "getCurrentPageData" ile almamız lazım onPageChange içinde.
            
            // Basitçe yeniden başlatmak daha güvenli:
            this.pagination.destroy(); 
        }

        // Yeni pagination başlat
        this.pagination = new Pagination({
            containerId: 'epatsPagination',
            itemsPerPage: 10,
            showItemsPerPageSelector: true, // <--- TRUE yapın veya bu satırı silin
            onPageChange: (currentPage, itemsPerPage) => {
                // Sayfalanmış veriyi hesapla
                const start = (currentPage - 1) * itemsPerPage;
                const end = start + itemsPerPage;
                const pageItems = this.filteredRecords.slice(start, end);
                this.renderTableRows(pageItems);
            },
            strings: {
                noResults: 'Kayıt yok',
                itemsInfo: 'Toplam {total} kayıt'
                // Diğer metinler (İlk, Son vb.) artık Pagination.js'teki varsayılanlardan gelecek
            }
        });
        
        // İlk render için manuel güncelleme
        this.pagination.update(this.filteredRecords.length);
        // İlk sayfayı göster
        const initialItems = this.filteredRecords.slice(0, 10);
        this.renderTableRows(initialItems);
    }

    renderTableRows(items) {
        const tbody = document.getElementById('epatsResultsBody');
        if (!tbody) return;

        tbody.innerHTML = items.map(r => `
            <tr>
                <td class="text-center">
                    <input type="checkbox" class="epats-row-check" 
                           value="${r.id}" 
                           data-appno="${r.applicationNumber}"
                           ${this.selectedRecordIds.has(r.id) ? 'checked' : ''}
                           onchange="window.epatsUiManager.handleCheck(this)">
                </td>
                <td><span style="font-family:monospace; font-weight:bold;">${r.applicationNumber}</span></td>
                <td>${r.title || '-'}</td>
                <td><span class="badge badge-success">Tescilli</span></td>
            </tr>
        `).join('');
    }

    handleCheck(checkbox) {
        if (checkbox.checked) {
            this.selectedRecordIds.add(checkbox.value);
        } else {
            this.selectedRecordIds.delete(checkbox.value);
        }
        this.updateActionButtons();
    }

    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.epats-row-check');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            if (checked) this.selectedRecordIds.add(cb.value);
            else this.selectedRecordIds.delete(cb.value);
        });
        this.updateActionButtons();
    }

    updateActionButtons() {
        const btn = document.getElementById('btnStartEpatsTransfer');
        const countSpan = document.getElementById('selectedEpatsCount');
        
        if (btn) btn.disabled = this.selectedRecordIds.size === 0;
        if (countSpan) countSpan.textContent = this.selectedRecordIds.size;
    }

    startTransfer() {
        const queue = [];
        this.selectedRecordIds.forEach(id => {
            const record = this.filteredRecords.find(r => r.id === id);
            if (record) {
                queue.push({
                    appNo: record.applicationNumber,
                    ipId: record.id,
                    docType: document.getElementById('epatsDocTypeSelect').value
                });
            }
        });

        if (queue.length === 0) return;

        // --- 🚀 YENİ: ORTAMA GÖRE URL BELİRLEME ---
        // Mevcut projenin ID'sini Firebase servisinden alalım
        // Eğer firebaseServices global değilse, import ettiğiniz yerden alabilirsiniz.
        // Genelde firebase.app().options.projectId ile de erişilebilir.
        
        // Manuel Kontrol (Otomatik yapmak yerine garanti olsun diye domain kontrolü de yapabiliriz)
        const isProduction = window.location.hostname === "ipgate.evrekagroup.com";
        
        let targetUploadUrl = "";

        if (isProduction) {
            // CANLI PROJE (ipgate-31bd2)
            // Bölge (europe-west1) farklıysa lütfen düzeltin
            targetUploadUrl = "https://europe-west1-ipgate-31bd2.cloudfunctions.net/saveEpatsDocument";
        } else {
            // TEST PROJESİ (ip-manager-production-aab4b)
            targetUploadUrl = "https://europe-west1-ip-manager-production-aab4b.cloudfunctions.net/saveEpatsDocument";
        }

        console.log("Hedef Fonksiyon URL:", targetUploadUrl);
        // ------------------------------------------

        // 1. Yöntem: Window Message
        window.postMessage({
            type: "EPATS_QUEUE_START",
            data: queue,
            uploadUrl: targetUploadUrl // <--- ADRESİ EKLENTİYE GÖNDERİYORUZ
        }, "*");

        // 2. Yöntem: Chrome Extension API (Çoklu ID Desteği)
                if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
                    this.extensionIds.forEach(extId => {
                        try {
                            // Her iki ID'ye de mesaj atıyoruz.
                            chrome.runtime.sendMessage(extId, {
                                action: "START_QUEUE",
                                queue: queue,
                                uploadUrl: targetUploadUrl
                            }, (response) => {
                                // Eğer eklenti yüklü değilse Chrome hata üretir.
                                // lastError kontrolü yaparak bu hatayı sessizce yutuyoruz.
                                if (chrome.runtime.lastError) {
                                    // console.log(`ID ${extId} bulunamadı.`); // Debug için açılabilir
                                }
                            });
                        } catch (e) {
                            console.log(`Extension mesaj hatası (${extId}):`, e);
                        }
                    });
                }

        showNotification(`${queue.length} adet işlem eklentiye gönderildi. EPATS açılıyor...`, 'success');
        
        this.selectedRecordIds.clear();
        this.updateActionButtons();
        document.querySelectorAll('.epats-row-check').forEach(cb => cb.checked = false);
    }
}