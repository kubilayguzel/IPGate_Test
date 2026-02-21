// public/js/accrual-management/main.js

import { authService } from '../../firebase-config.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { showNotification } from '../../utils.js';

// Modüller
import { AccrualDataManager } from './AccrualDataManager.js';
import { AccrualUIManager } from './AccrualUIManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'accruals.html' });

    class AccrualsController {
        constructor() {
            // Modülleri Başlat
            this.dataManager = new AccrualDataManager();
            this.uiManager = new AccrualUIManager();
            this.freestyleFormManager = null;
            // Durum (State) Yönetimi
            this.state = {
                activeTab: 'main',       // 'main' | 'foreign'
                
                filters: {
                    startDate: '',
                    endDate: '',
                    status: 'all',
                    field: '',
                    party: '',
                    fileNo: '',
                    subject: '',
                    task: ''
                },

                sort: { column: 'createdAt', direction: 'desc' },
                selectedIds: new Set(),
                itemsPerPage: 50 
            };

            this.pagination = null;
            this.uploadedPaymentReceipts = []; 
            this.filterDebounceTimer = null; 
        }

        async init() {
            this.initPagination();
            this.setupEventListeners();

            // İlk Yükleme
            await this.loadData();
        }

        initPagination() {
            if (typeof Pagination === 'undefined') { console.error("Pagination kütüphanesi eksik."); return; }
            this.pagination = new Pagination({
                containerId: 'paginationControls', 
                itemsPerPage: this.state.itemsPerPage,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: () => this.renderPage() 
            });
        }

        async loadData() {
            this.uiManager.toggleLoading(true);
            try {
                await this.dataManager.fetchAllData();
                this.renderPage();
            } catch (error) {
                showNotification('Veriler yüklenirken hata oluştu.', 'error');
            } finally {
                this.uiManager.toggleLoading(false);
            }
        }

        /**
         * Verileri filtreler, sıralar ve sayfayı yeniden çizer.
         */
        renderPage() {
            // 1. Veriyi Filtrele ve Sırala (DataManager)
            const criteria = { 
                tab: this.state.activeTab, 
                filters: this.state.filters 
            };
            
            const allFilteredData = this.dataManager.filterAndSort(criteria, this.state.sort);

            // 2. Pagination Güncelle
            if (this.pagination) this.pagination.update(allFilteredData.length);
            const pageData = this.pagination ? this.pagination.getCurrentPageData(allFilteredData) : allFilteredData;

            // 3. Referans Verilerini Hazırla (Lookup)
            const lookups = {
                tasks: this.dataManager.allTasks,
                transactionTypes: this.dataManager.allTransactionTypes,
                ipRecords: this.dataManager.allIpRecords,
                ipRecordsMap: this.dataManager.ipRecordsMap,
                selectedIds: this.state.selectedIds
            };

            // 4. Tabloyu Çiz (UIManager)
            this.uiManager.renderTable(pageData, lookups, this.state.activeTab);
            this.uiManager.updateTaskDetailError(''); 
        }

        /**
         * Excel'e Aktar (GELİŞTİRİLMİŞ VERSİYON)
         */
        async exportToExcel(type) {
            // 1. Veriyi Hazırla
            const criteria = { 
                tab: this.state.activeTab, 
                filters: this.state.filters 
            };
            
            // Excel için veriyi her zaman TARİHE GÖRE (Eskiden Yeniye) sıralıyoruz ki aylık gruplama düzgün çalışsın
            let allFilteredData = this.dataManager.filterAndSort(criteria, { column: 'createdAt', direction: 'asc' });

            let dataToExport = [];

            if (type === 'selected') {
                if (this.state.selectedIds.size === 0) {
                    showNotification('Lütfen en az bir kayıt seçiniz.', 'warning');
                    return;
                }
                dataToExport = allFilteredData.filter(item => this.state.selectedIds.has(item.id));
            } else {
                dataToExport = [...allFilteredData];
            }

            if (dataToExport.length === 0) {
                showNotification('Aktarılacak veri bulunamadı.', 'warning');
                return;
            }

            this.uiManager.toggleLoading(true);

            try {
                // 2. Kütüphaneleri Dinamik Yükle
                const loadScript = (src) => {
                    return new Promise((resolve, reject) => {
                        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                        const script = document.createElement('script');
                        script.src = src;
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                };

                if (!window.ExcelJS) await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js');
                if (!window.saveAs) await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');

                // 3. Excel Oluştur
                const ExcelJS = window.ExcelJS;
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Tahakkuklar');

                // 4. Kolon Tanımları (İSTENEN SIRALAMA VE DETAYLAR)
                // ID, Tarih, Durum, Alan, Dosya, Konu, İş, Taraf, TFN, EFN, Resmi, ResmiPB, Hizmet, HizmetPB, KDV%, KDV, KDVPB, Toplam, ToplamPB, Kalan, KalanPB
                
                worksheet.columns = [
                    { header: 'ID', key: 'id', width: 10 },
                    { header: 'Oluşturma Tarihi', key: 'createdAt', width: 15 },
                    { header: 'Tür', key: 'type', width: 15 }, // 🔥 YENİ EKLENDİ
                    { header: 'Durum', key: 'status', width: 15 },
                    { header: 'Alan', key: 'field', width: 15 },
                    { header: 'İlgili Dosya', key: 'fileNo', width: 20 },
                    { header: 'Konu', key: 'subject', width: 30 },
                    { header: 'İlgili İş', key: 'taskTitle', width: 30 },
                    { header: 'Taraf', key: 'party', width: 25 },
                    { header: 'TPE Fatura No', key: 'tpeInvoiceNo', width: 15 }, // TFN
                    { header: 'Evreka Fatura No', key: 'evrekaInvoiceNo', width: 15 }, // EFN
                    
                    // Ücret Detayları ve Para Birimleri
                    { header: 'Resmi Ücret', key: 'officialFee', width: 15 },
                    { header: 'R.Ü. PB', key: 'officialFeeCurr', width: 8 },
                    
                    { header: 'Hizmet Ücreti', key: 'serviceFee', width: 15 },
                    { header: 'H.Ü. PB', key: 'serviceFeeCurr', width: 8 },
                    
                    { header: 'KDV Oranı (%)', key: 'vatRate', width: 12 },
                    { header: 'KDV Tutarı', key: 'vatAmount', width: 15 },
                    { header: 'KDV PB', key: 'vatCurr', width: 8 },
                    
                    { header: 'Toplam Tutar', key: 'totalAmount', width: 15 },
                    { header: 'Toplam PB', key: 'totalAmountCurr', width: 8 },
                    
                    { header: 'Kalan Tutar', key: 'remainingAmount', width: 15 },
                    { header: 'Kalan PB', key: 'remainingAmountCurr', width: 8 }
                ];

                // 5. Header Stili
                const headerRow = worksheet.getRow(1);
                headerRow.eachCell((cell) => {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF1E3C72' }
                    };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                });

                // --- TOPLAM HESAPLAMA YARDIMCILARI ---
                // Farklı para birimlerini ayrı ayrı toplamak için yapı
                const createAccumulator = () => ({}); // { "TRY": { official: 0, service: 0, vat: 0, total: 0, remaining: 0 }, "USD": ... }
                
                const addToAccumulator = (acc, currency, type, amount) => {
                    const curr = currency || 'TRY';
                    if (!acc[curr]) acc[curr] = { official: 0, service: 0, vat: 0, total: 0, remaining: 0 };
                    acc[curr][type] += (parseFloat(amount) || 0);
                };

                let monthlyAccumulator = createAccumulator();
                let grandAccumulator = createAccumulator();
                
                let currentMonthKey = null; // YYYY-MM formatında

                // 6. Veri Satırlarını İşle
                for (let i = 0; i < dataToExport.length; i++) {
                    const acc = dataToExport[i];
                    
                    // Tarih ve Ay Kontrolü
                    const dateObj = acc.createdAt instanceof Date ? acc.createdAt : new Date(acc.createdAt || 0);
                    const rowMonthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                    const formattedDate = dateObj.toLocaleDateString('tr-TR');

                    // AY DEĞİŞİMİNDE ARA TOPLAM EKLE
                    if (currentMonthKey && currentMonthKey !== rowMonthKey) {
                        this.addTotalRow(worksheet, `Ara Toplam (${currentMonthKey})`, monthlyAccumulator);
                        monthlyAccumulator = createAccumulator(); // Sıfırla
                    }
                    currentMonthKey = rowMonthKey;

                    // İlişkili Verileri Çek
                    const task = this.dataManager.allTasks[String(acc.taskId)];
                    const typeObj = task ? this.dataManager.allTransactionTypes.find(t => t.id === task.taskType) : null;
                    const ipRec = task?.relatedIpRecordId ? this.dataManager.ipRecordsMap[task.relatedIpRecordId] : null;

                    // Alan Hesapla
                    let fieldText = '-';
                    if (typeObj?.ipType) fieldText = { 'trademark': 'Marka', 'patent': 'Patent', 'design': 'Tasarım', 'suit': 'Dava' }[typeObj.ipType] || typeObj.ipType;

                    // Taraf Bul
                    const partyName = acc.paymentParty || (acc.tpInvoiceParty?.name) || (acc.serviceInvoiceParty?.name) || '-';

                    // Ücretleri Hazırla
                    const officialAmt = acc.officialFee?.amount || 0;
                    const officialCurr = acc.officialFee?.currency || 'TRY';
                    
                    const serviceAmt = acc.serviceFee?.amount || 0;
                    const serviceCurr = acc.serviceFee?.currency || 'TRY';
                    
                    const vatRate = acc.vatRate || 0;
                    
                    // KDV Hesabı: (Hizmet + (Eğer seçiliyse Resmi)) * Oran
                    const baseForVat = serviceAmt + (acc.applyVatToOfficialFee ? officialAmt : 0);
                    const vatAmt = baseForVat * (vatRate / 100);
                    const vatCurr = serviceCurr; // KDV genellikle hizmet faturası ile aynıdır

                    // Toplam Tutar (Veritabanından veya hesapla)
                    let totalAmt = 0;
                    let totalCurr = 'TRY';
                    if (Array.isArray(acc.totalAmount) && acc.totalAmount.length > 0) {
                        totalAmt = acc.totalAmount[0].amount;
                        totalCurr = acc.totalAmount[0].currency;
                    } else {
                        totalAmt = officialAmt + serviceAmt + vatAmt;
                        totalCurr = officialCurr; // Basitleştirme
                    }

                    // Kalan Tutar
                    let remAmt = 0;
                    let remCurr = totalCurr;
                    if (Array.isArray(acc.remainingAmount) && acc.remainingAmount.length > 0) {
                        remAmt = acc.remainingAmount[0].amount;
                        remCurr = acc.remainingAmount[0].currency;
                    } else {
                        // Eğer array boşsa ama status unpaid ise toplam tutardır
                        if (acc.status === 'unpaid') remAmt = totalAmt;
                    }

                    // Satırı Ekle
                    const row = worksheet.addRow({
                        id: acc.id,
                        createdAt: formattedDate,
                        type: acc.type || 'Hizmet', 
                        status: acc.status === 'paid' ? 'Ödendi' : (acc.status === 'unpaid' ? 'Ödenmedi' : 'Kısmen'),
                        field: fieldText,
                        fileNo: ipRec ? (ipRec.applicationNumber || ipRec.applicationNo || '-') : '-',
                        // 🔥 DÜZELTME: Normal dosya yoksa serbest tahakkuk konusunu (acc.subject) yazdır
                        subject: ipRec ? (ipRec.markName || ipRec.title || ipRec.name || '-') : (acc.subject || '-'),
                        taskTitle: typeObj ? (typeObj.alias || typeObj.name) : (acc.taskTitle || '-'),
                        party: partyName,
                        tpeInvoiceNo: acc.tpeInvoiceNo || '',
                        evrekaInvoiceNo: acc.evrekaInvoiceNo || '',
                        
                        officialFee: officialAmt,
                        officialFeeCurr: officialCurr,
                        serviceFee: serviceAmt,
                        serviceFeeCurr: serviceCurr,
                        vatRate: vatRate,
                        vatAmount: vatAmt,
                        vatCurr: vatCurr,
                        totalAmount: totalAmt,
                        totalAmountCurr: totalCurr,
                        remainingAmount: remAmt,
                        remainingAmountCurr: remCurr
                    });

                    // Toplamlara Ekle (Her para birimi için ayrı)
                    addToAccumulator(monthlyAccumulator, officialCurr, 'official', officialAmt);
                    addToAccumulator(monthlyAccumulator, serviceCurr, 'service', serviceAmt);
                    addToAccumulator(monthlyAccumulator, vatCurr, 'vat', vatAmt);
                    addToAccumulator(monthlyAccumulator, totalCurr, 'total', totalAmt);
                    addToAccumulator(monthlyAccumulator, remCurr, 'remaining', remAmt);
                    
                    addToAccumulator(grandAccumulator, officialCurr, 'official', officialAmt);
                    addToAccumulator(grandAccumulator, serviceCurr, 'service', serviceAmt);
                    addToAccumulator(grandAccumulator, vatCurr, 'vat', vatAmt);
                    addToAccumulator(grandAccumulator, totalCurr, 'total', totalAmt);
                    addToAccumulator(grandAccumulator, remCurr, 'remaining', remAmt);
                }

                // SON ARA TOPLAM VE GENEL TOPLAM
                if (currentMonthKey) {
                    this.addTotalRow(worksheet, `Ara Toplam (${currentMonthKey})`, monthlyAccumulator);
                }
                
                // Boş satır
                worksheet.addRow([]);
                
                // Genel Toplam
                this.addTotalRow(worksheet, 'GENEL TOPLAM', grandAccumulator, true);

                // 7. Dosyayı Kaydet
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const fileName = `Tahakkuk_Listesi_${new Date().toISOString().slice(0,10)}.xlsx`;
                window.saveAs(blob, fileName);

                showNotification(`${dataToExport.length} kayıt başarıyla aktarıldı!`, 'success');

            } catch (error) {
                console.error('Excel export hatası:', error);
                showNotification('Excel oluşturulurken hata oluştu: ' + error.message, 'error');
            } finally {
                this.uiManager.toggleLoading(false);
            }
        }

        /**
         * Toplam Satırı Ekleyen Yardımcı Fonksiyon
         */
        addTotalRow(worksheet, label, accumulator, isGrandTotal = false) {
            // Her para birimi için bir satır oluşturabiliriz veya tek satırda birleştirebiliriz.
            // Okunabilirlik için her para birimini ayrı satırda yazalım (Varsa).
            const currencies = Object.keys(accumulator);
            
            if (currencies.length === 0) return;

            currencies.forEach(curr => {
                const data = accumulator[curr];
                const row = worksheet.addRow({
                    taskTitle: `${label} (${curr})`, // Etiketi 'İlgili İş' kolonuna yazıyoruz ki ortada görünsün
                    
                    officialFee: data.official,
                    officialFeeCurr: curr,
                    serviceFee: data.service,
                    serviceFeeCurr: curr,
                    vatAmount: data.vat,
                    vatCurr: curr,
                    totalAmount: data.total,
                    totalAmountCurr: curr,
                    remainingAmount: data.remaining,
                    remainingAmountCurr: curr
                });

                // Stil
                row.font = { bold: true, color: isGrandTotal ? { argb: 'FFFF0000' } : undefined }; // Genel toplam kırmızı
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: isGrandTotal ? 'FFFFE0E0' : 'FFEEEEEE' } // Arkaplan
                };
            });
        }


        setupEventListeners() {
            // --- 1. FİLTRELER ---
            const filterInputs = [
                'filterStartDate', 'filterEndDate', 'filterStatus', 'filterField',
                'filterParty', 'filterFileNo', 'filterSubject', 'filterTask'
            ];

            const handleFilterChange = () => {
                this.state.filters.startDate = document.getElementById('filterStartDate').value;
                this.state.filters.endDate = document.getElementById('filterEndDate').value;
                this.state.filters.status = document.getElementById('filterStatus').value;
                this.state.filters.field = document.getElementById('filterField').value;
                this.state.filters.party = document.getElementById('filterParty').value.trim();
                this.state.filters.fileNo = document.getElementById('filterFileNo').value.trim();
                this.state.filters.subject = document.getElementById('filterSubject').value.trim();
                this.state.filters.task = document.getElementById('filterTask').value.trim();

                this.renderPage();
            };

            const debouncedFilter = () => {
                clearTimeout(this.filterDebounceTimer);
                this.filterDebounceTimer = setTimeout(handleFilterChange, 300);
            };

            filterInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const eventType = (el.type === 'date' || el.tagName === 'SELECT') ? 'change' : 'input';
                    el.addEventListener(eventType, debouncedFilter);
                }
            });

            const btnClear = document.getElementById('btnClearFilters');
            if (btnClear) {
                btnClear.addEventListener('click', () => {
                    filterInputs.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            if(el.tagName === 'SELECT') el.value = (id === 'filterStatus' ? 'all' : '');
                            else el.value = '';
                        }
                    });
                    this.state.filters = {
                        startDate: '', endDate: '', status: 'all', field: '',
                        party: '', fileNo: '', subject: '', task: ''
                    };
                    this.renderPage();
                });
            }

            // --- 2. TAB DEĞİŞİMİ ---
            $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
                const target = $(e.target).attr("href");
                this.state.activeTab = target === '#content-foreign' ? 'foreign' : 'main';
                this.renderPage();
            });

            // --- 3. SIRALAMA ---
            document.querySelectorAll('th[data-sort]').forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    const column = th.dataset.sort;
                    if (this.state.sort.column === column) {
                        this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.state.sort = { column: column, direction: 'asc' };
                    }
                    
                    document.querySelectorAll('.sort-icon').forEach(i => i.className = 'fas fa-sort sort-icon text-muted');
                    const icon = th.querySelector('i');
                    if(icon) icon.className = `fas fa-sort-${this.state.sort.direction === 'asc' ? 'up' : 'down'} sort-icon`;

                    this.renderPage();
                });
            });

            // --- 4. SEÇİM İŞLEMLERİ ---
            const toggleSelection = (checked, id) => {
                 if(checked) this.state.selectedIds.add(id); else this.state.selectedIds.delete(id);
                 this.uiManager.updateBulkActionsVisibility(this.state.selectedIds.size > 0);
            };

            const selectAll = (checked) => {
                 document.querySelectorAll('.row-checkbox').forEach(cb => {
                     cb.checked = checked;
                     toggleSelection(checked, cb.dataset.id);
                 });
            };

            const cbMain = document.getElementById('selectAllCheckbox');
            if(cbMain) cbMain.addEventListener('change', e => selectAll(e.target.checked));
            
            const cbForeign = document.getElementById('selectAllCheckboxForeign');
            if(cbForeign) cbForeign.addEventListener('change', e => selectAll(e.target.checked));

            [this.uiManager.tableBody, this.uiManager.foreignTableBody].forEach(body => {
                if(!body) return;
                body.addEventListener('change', e => {
                    if (e.target.classList.contains('row-checkbox')) {
                        toggleSelection(e.target.checked, e.target.dataset.id);
                    }
                });
            });

            // --- 5. ÖDEME MODALI UI ETKİLEŞİMLERİ ---
            const payFullOfficial = document.getElementById('payFullOfficial');
            const officialInputContainer = document.getElementById('officialAmountInputContainer');
            if (payFullOfficial && officialInputContainer) {
                payFullOfficial.addEventListener('change', (e) => {
                    officialInputContainer.style.display = e.target.checked ? 'none' : 'block';
                });
            }

            const payFullService = document.getElementById('payFullService');
            const serviceInputContainer = document.getElementById('serviceAmountInputContainer');
            if (payFullService && serviceInputContainer) {
                payFullService.addEventListener('change', (e) => {
                    serviceInputContainer.style.display = e.target.checked ? 'none' : 'block';
                });
            }

            const payFullForeign = document.getElementById('payFullForeign');
            const foreignSplitInputs = document.getElementById('foreignSplitInputs');
            if (payFullForeign && foreignSplitInputs) {
                payFullForeign.addEventListener('change', (e) => {
                    foreignSplitInputs.style.display = e.target.checked ? 'none' : 'block'; 
                });
            }

            // --- 6. AKSİYON BUTONLARI ---
            const handleActionClick = async (e) => {
                const btn = e.target.closest('.action-btn');
                const link = e.target.closest('.task-detail-link');

                if (link) {
                    e.preventDefault();
                    this.openTaskDetail(link.dataset.taskId);
                    return;
                }

                if (!btn) return;
                e.preventDefault();
                const id = btn.dataset.id;

                if (btn.classList.contains('view-btn')) {
                    const acc = this.dataManager.allAccruals.find(a => a.id === id);
                    this.uiManager.showViewDetailModal(acc);
                }
                else if (btn.classList.contains('edit-btn')) {
                    this.uiManager.toggleLoading(true);
                    const acc = this.dataManager.allAccruals.find(a => a.id === id);
                    const task = await this.dataManager.getFreshTaskDetail(acc.taskId);
                    let epatsDoc = null;
                    if(task && task.details?.epatsDocument) epatsDoc = task.details.epatsDocument;
                    this.uiManager.initEditModal(acc, this.dataManager.allPersons, epatsDoc);
                    this.uiManager.toggleLoading(false);
                }
                else if (btn.classList.contains('delete-btn')) {
                    if (confirm('Bu tahakkuku silmek istediğinize emin misiniz?')) {
                        this.uiManager.toggleLoading(true);
                        await this.dataManager.deleteAccrual(id);
                        this.renderPage();
                        this.uiManager.toggleLoading(false);
                        showNotification('Silindi', 'success');
                    }
                }
            };

            if(this.uiManager.tableBody) this.uiManager.tableBody.addEventListener('click', handleActionClick);
            if(this.uiManager.foreignTableBody) this.uiManager.foreignTableBody.addEventListener('click', handleActionClick);

            // --- 7. MODAL VE DİĞER BUTONLAR ---
            
            // Toplu İşlemler - Ödendi İşaretle
            document.getElementById('bulkMarkPaidBtn').addEventListener('click', () => {
                const selected = Array.from(this.state.selectedIds).map(id => this.dataManager.allAccruals.find(a => a.id === id)).filter(Boolean);
                this.uploadedPaymentReceipts = []; 
                this.uiManager.showPaymentModal(selected, this.state.activeTab); 
            });

            // Toplu İşlemler - Ödenmedi Yap
            const btnUnpaid = document.getElementById('bulkMarkUnpaidBtn');
            if (btnUnpaid) {
                btnUnpaid.addEventListener('click', async () => {
                    if (this.state.selectedIds.size === 0) return;

                    if (confirm(`${this.state.selectedIds.size} adet kaydı "Ödenmedi" durumuna getirmek istiyor musunuz? Mevcut ödeme bilgileri silinecektir.`)) {
                        this.uiManager.toggleLoading(true);
                        try {
                            await this.dataManager.batchUpdateStatus(this.state.selectedIds, 'unpaid');
                            this.state.selectedIds.clear(); 
                            this.renderPage(); 
                            showNotification('Kayıtlar "Ödenmedi" olarak güncellendi.', 'success');
                        } catch (e) {
                            console.error(e);
                            showNotification('Hata: ' + e.message, 'error');
                        } finally {
                            this.uiManager.toggleLoading(false);
                        }
                    }
                });
            }

             // Kaydet Butonları
            document.getElementById('saveAccrualChangesBtn').addEventListener('click', async () => {
                const formResult = this.uiManager.getEditFormData();
                if (!formResult.success) { showNotification(formResult.error, 'error'); return; }
                this.uiManager.toggleLoading(true);
                try {
                    await this.dataManager.updateAccrual(document.getElementById('editAccrualId').value, formResult.data, (formResult.data.files||[])[0]);
                    this.uiManager.closeModal('editAccrualModal');
                    this.renderPage();
                    showNotification('Güncellendi', 'success');
                } catch (e) { showNotification(e.message, 'error'); } 
                finally { this.uiManager.toggleLoading(false); }
            });

            document.getElementById('confirmMarkPaidBtn').addEventListener('click', async () => {
                const date = document.getElementById('paymentDate').value;
                if(!date) { showNotification('Tarih seçiniz', 'error'); return; }

                let singleDetails = null;
                if (this.state.selectedIds.size === 1) {
                     if (this.state.activeTab === 'foreign') {
                        const isFull = document.getElementById('payFullForeign').checked;
                        singleDetails = { isForeignMode: true, payFullOfficial: isFull, payFullService: isFull, 
                                          manualOfficial: document.getElementById('manualForeignOfficial').value, 
                                          manualService: document.getElementById('manualForeignService').value };
                     } else {
                        singleDetails = { isForeignMode: false, payFullOfficial: document.getElementById('payFullOfficial').checked,
                                          payFullService: document.getElementById('payFullService').checked,
                                          manualOfficial: document.getElementById('manualOfficialAmount').value,
                                          manualService: document.getElementById('manualServiceAmount').value };
                     }
                }

                this.uiManager.toggleLoading(true);
                try {
                    await this.dataManager.savePayment(this.state.selectedIds, { date, receiptFiles: this.uploadedPaymentReceipts, singlePaymentDetails: singleDetails });
                    this.uiManager.closeModal('markPaidModal');
                    this.state.selectedIds.clear();
                    this.renderPage();
                    showNotification('Ödeme işlendi', 'success');
                } catch(e) { showNotification(e.message, 'error'); }
                finally { this.uiManager.toggleLoading(false); }
            });

            // Modal Kapatma
            document.querySelectorAll('.close-modal-btn, #cancelEditAccrualBtn, #cancelMarkPaidBtn').forEach(b => {
                b.addEventListener('click', e => this.uiManager.closeModal(e.target.closest('.modal').id));
            });

             // Excel Export
             const btnExportSelected = document.getElementById('btnExportSelectedAccruals');
             if(btnExportSelected) btnExportSelected.addEventListener('click', () => this.exportToExcel('selected'));
             
             const btnExportAll = document.getElementById('btnExportAllAccruals');
             if(btnExportAll) btnExportAll.addEventListener('click', () => this.exportToExcel('all'));

             // Dosya Yükleme (Dekont)
             const area = document.getElementById('paymentReceiptFileUploadArea');
             if(area) {
                 area.addEventListener('click', () => document.getElementById('paymentReceiptFile').click());
                 document.getElementById('paymentReceiptFile').addEventListener('change', e => {
                     Array.from(e.target.files).forEach(f => this.uploadedPaymentReceipts.push({id: Date.now().toString(), name: f.name, type: f.type, file: f}));
                     document.getElementById('paymentReceiptFileList').innerHTML = this.uploadedPaymentReceipts.map(f => `<div class="small">${f.name} (Hazır)</div>`).join('');
                 });
             }

             // --- 8. SERBEST TAHAKKUK (FREESTYLE) İŞLEMLERİ ---
            const btnFreestyle = document.getElementById('btnCreateFreestyleAccrual');
            const modalFreestyle = document.getElementById('freestyleAccrualModal');
            
            if (btnFreestyle && modalFreestyle) {
                // Modalı Aç
                btnFreestyle.addEventListener('click', async () => {
                    this.uiManager.toggleLoading(true);
                    try {
                        // Kişi listesi daha önce yüklenmediyse yükle
                        if (!this.dataManager.allPersons || this.dataManager.allPersons.length === 0) {
                            const personModule = await import('../../firebase-config.js');
                            const res = await personModule.personService.getPersons();
                            this.dataManager.allPersons = res.success ? res.data : [];
                        }

                        // Form Manager'ı başlat (Freestyle Modunda)
                        if (!this.freestyleFormManager) {
                            // options: { isFreestyle: true } gönderiyoruz
                            this.freestyleFormManager = new (await import('../components/AccrualFormManager.js')).AccrualFormManager(
                                'freestyleAccrualFormContainer', 
                                'freestyle', 
                                this.dataManager.allPersons, 
                                { isFreestyle: true }
                            );
                            this.freestyleFormManager.render();
                        } else {
                            this.freestyleFormManager.allPersons = this.dataManager.allPersons;
                        }

                        this.freestyleFormManager.reset();
                        modalFreestyle.classList.add('show');
                    } catch (error) {
                        console.error(error);
                        showNotification('Form yüklenirken hata oluştu.', 'error');
                    } finally {
                        this.uiManager.toggleLoading(false);
                    }
                });

                // Kapatma Butonu
                document.getElementById('cancelFreestyleAccrualBtn').addEventListener('click', () => {
                    modalFreestyle.classList.remove('show');
                });
                document.getElementById('closeFreestyleAccrualModal').addEventListener('click', () => {
                    modalFreestyle.classList.remove('show');
                });

                // Kaydetme Butonu
                document.getElementById('saveFreestyleAccrualBtn').addEventListener('click', async () => {
                    const formResult = this.freestyleFormManager.getData();
                    if (!formResult.success) {
                        showNotification(formResult.error, 'error');
                        return;
                    }

                    this.uiManager.toggleLoading(true);
                    try {
                        // Yeni Serbest Tahakkuku Veritabanına Kaydet
                        const newAccrualData = formResult.data;
                        const fileToUpload = (newAccrualData.files || [])[0];
                        
                        // Dosya yükleme (varsa) DataManager üzerinden halledeceğiz
                        await this.dataManager.createFreestyleAccrual(newAccrualData, fileToUpload);
                        
                        modalFreestyle.classList.remove('show');
                        this.renderPage(); // Tabloyu yenile
                        showNotification('Serbest tahakkuk başarıyla oluşturuldu!', 'success');
                    } catch (e) {
                        console.error(e);
                        showNotification('Tahakkuk kaydedilemedi: ' + e.message, 'error');
                    } finally {
                        this.uiManager.toggleLoading(false);
                    }
                });
            }
        }

        async openTaskDetail(taskId) {
            this.uiManager.taskDetailModal.classList.add('show');
            document.getElementById('modalTaskTitle').textContent = 'Yükleniyor...';
            this.uiManager.taskDetailManager.showLoading();
            try {
                const task = await this.dataManager.getFreshTaskDetail(taskId);
                if(!task) throw new Error("İş bulunamadı");
                
                const ipRecord = task.relatedIpRecordId ? this.dataManager.ipRecordsMap[task.relatedIpRecordId] : null;
                const transactionType = this.dataManager.allTransactionTypes.find(t => t.id === task.taskType);
                const assignedUser = this.dataManager.allUsers.find(u => u.id === task.assignedTo_uid);
                const relatedAccruals = this.dataManager.allAccruals.filter(acc => String(acc.taskId) === String(task.id));

                this.uiManager.taskDetailManager.render(task, { ipRecord, transactionType, assignedUser, accruals: relatedAccruals });
            } catch(e) {
                this.uiManager.taskDetailManager.showError('İş detayı yüklenemedi.');
            }
        }
    }

    new AccrualsController().init();
});