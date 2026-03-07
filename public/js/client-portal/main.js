// public/js/client-portal/main.js

import { supabase } from '../../supabase-config.js';
import { AuthManager } from './AuthManager.js';
import { PortfolioManager } from './PortfolioManager.js';
import { TaskManager } from './TaskManager.js';
import { InvoiceManager } from './InvoiceManager.js';
import { ContractManager } from './ContractManager.js';
import { RenderHelper } from './RenderHelper.js';
import Pagination from '../pagination.js';

class ClientPortalController {
    constructor() {
        // Yöneticiler (Managers)
        this.authManager = new AuthManager();
        this.portfolioManager = new PortfolioManager();
        this.taskManager = new TaskManager();
        this.invoiceManager = new InvoiceManager();
        this.contractManager = new ContractManager();
        this.renderHelper = new RenderHelper(this.state);

        // Merkezi Veri Havuzu (Global State)
        this.state = {
            selectedClientId: 'ALL',
            linkedClients: [],
            countries: new Map(),
            transactionTypes: new Map(),
            
            // Ham Veriler
            portfolios: [],
            suits: [],
            tasks: [],
            invoices: [],
            contracts: [],
            
            // Filtrelenmiş Veriler
            filteredPortfolios: [],
            filteredSuits: [],
            filteredTasks: [],
            filteredInvoices: [],
            filteredContracts: [],

            // Sayfalama Objeleri
            paginations: {
                portfolio: null,
                suit: null,
                task: null,
                invoice: null,
                contract: null,
                objection: null
            },

            // Kolon Filtreleri
            activeColumnFilters: {}
        };

        // Dışa açılması gereken HTML içi inline fonksiyonları bağla
        this.exposeGlobalFunctions();
    }

    // ==========================================
    // 1. BAŞLATMA (INIT) VE YETKİLENDİRME
    // ==========================================
    async init() {
        if (window.SimpleLoadingController) {
            window.SimpleLoadingController.show('Portal Hazırlanıyor', 'Verileriniz güvenle getiriliyor...');
        }

        const isAuth = await this.authManager.initSession();
        if (!isAuth) {
            window.location.href = 'index.html';
            return;
        }

        // Temel sözlükleri (Ülkeler, İşlem Tipleri) çek
        await this.loadDictionaries();

        // Kullanıcı ve Müşteri Bilgilerini Çek
        const user = this.authManager.user;
        document.getElementById('userName').textContent = user.user_metadata?.display_name || user.email;
        document.getElementById('welcomeUserName').textContent = user.user_metadata?.display_name || user.email;
        document.getElementById('userAvatar').textContent = (user.user_metadata?.display_name || user.email || 'U').charAt(0).toUpperCase();

        const clients = await this.authManager.getLinkedClients();
        this.state.linkedClients = clients;

        this.renderClientSelector();

        // Tema ve Event Listener'ları kur
        this.initTheme();
        this.setupEventListeners();

        // Seçili müşteriye göre tüm verileri yükle
        await this.loadAllData();
    }

    async loadDictionaries() {
        try {
            // Ülkeler
            const { data: countryData } = await supabase.from('common').select('data').eq('id', 'countries').single();
            if (countryData && countryData.data && Array.isArray(countryData.data.list)) {
                countryData.data.list.forEach(c => this.state.countries.set(c.code, c.name));
            }
            
            // İşlem Tipleri
            const { data: txData } = await supabase.from('transaction_types').select('*');
            if (txData) {
                txData.forEach(t => this.state.transactionTypes.set(String(t.id), t));
            }
        } catch (e) {
            console.warn("Sözlükler yüklenemedi:", e);
        }
    }

    renderClientSelector() {
        const clients = this.state.linkedClients;
        if (clients.length <= 1) return;

        const dropdownMenu = document.getElementById('clientDropdownMenu');
        dropdownMenu.innerHTML = `<a class="dropdown-item" href="#" onclick="window.switchClient('ALL')"><strong>Tümü</strong></a><div class="dropdown-divider"></div>`;
        
        clients.forEach(c => {
            dropdownMenu.innerHTML += `<a class="dropdown-item" href="#" onclick="window.switchClient('${c.id}')">${c.name}</a>`;
        });
        
        document.getElementById('clientSelectorContainer').style.display = 'block';

        const savedClient = sessionStorage.getItem('selectedClientSession');
        if (!savedClient) {
            const modalList = document.getElementById('clientSelectionList');
            modalList.innerHTML = `<button type="button" class="list-group-item list-group-item-action font-weight-bold" onclick="window.switchClient('ALL', true)">Tüm Müşterileri Göster</button>`;
            clients.forEach(c => {
                modalList.innerHTML += `<button type="button" class="list-group-item list-group-item-action" onclick="window.switchClient('${c.id}', true)">${c.name}</button>`;
            });
            $('#clientSelectionModal').modal('show');
        } else {
            this.state.selectedClientId = savedClient;
            this.updateClientNameDisplay();
        }
    }

    updateClientNameDisplay() {
        let nameText = 'Tüm Müşteriler';
        if (this.state.selectedClientId !== 'ALL') {
            const client = this.state.linkedClients.find(c => c.id === this.state.selectedClientId);
            if (client) nameText = client.name;
        }
        document.getElementById('currentClientName').textContent = nameText;
    }

    // ==========================================
    // 2. VERİ YÜKLEME VE FİLTRELEME
    // ==========================================
    async loadAllData() {
        if (window.SimpleLoadingController && !document.getElementById('simple-loading-overlay')) {
            window.SimpleLoadingController.show('Veriler Yükleniyor', 'Analizler hazırlanıyor...');
        }

        try {
            // Hedef müşteri listesini belirle
            let targetIds = [];
            if (this.state.selectedClientId === 'ALL') {
                targetIds = this.state.linkedClients.map(c => c.id);
            } else {
                targetIds = [this.state.selectedClientId];
            }

            if (targetIds.length === 0) {
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
                return; // Bağlı firma yoksa boş döner
            }

            // Tüm verileri paralel olarak (Aynı anda) çek!
            const [portfolios, suits, tasks, invoices, contracts] = await Promise.all([
                this.portfolioManager.getPortfolios(targetIds),
                this.portfolioManager.getSuits(targetIds),
                // TaskManager'a portföy ID'lerini de veriyoruz ki markaya ait işleri bulsun
                this.portfolioManager.getPortfolios(targetIds).then(p => this.taskManager.getTasks(targetIds, p.map(x => x.id))),
                this.invoiceManager.getInvoices(targetIds),
                this.contractManager.getContracts(targetIds)
            ]);

            // Ham verileri state'e kaydet
            this.state.portfolios = portfolios;
            this.state.suits = suits;
            this.state.tasks = tasks;
            this.state.invoices = invoices;
            this.state.contracts = contracts;

            // Filtreleri uygula ve ekrana çiz
            this.applyAllFilters();
            this.updateDashboardCounts();

        } catch (error) {
            console.error("Veri yükleme hatası:", error);
        } finally {
            if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
        }
    }

    applyAllFilters() {
        this.filterPortfolios();
        this.filterTasks();
        this.filterInvoices();
        this.filterContracts();
        this.filterSuits();
        this.prepareAndRenderObjections();
    }

    updateDashboardCounts() {
        document.getElementById('dashPortfolio').textContent = this.state.portfolios.length;
        
        let pendingTasks = 0;
        let unpaidInvoices = 0;

        this.state.tasks.forEach(t => {
            if (t.status === 'awaiting_client_approval' || t.status === 'pending') pendingTasks++;
        });

        this.state.invoices.forEach(i => {
            if (i.status === 'unpaid') unpaidInvoices++;
        });

        document.getElementById('dashPendingApprovals').textContent = pendingTasks;
        document.getElementById('dashUnpaidInvoices').textContent = unpaidInvoices;

        // İç sekmelerdeki sayaçlar
        document.getElementById('taskCount-marka-total').textContent = pendingTasks;
        document.getElementById('taskCount-pending-approval').textContent = pendingTasks;
    }

    // ==========================================
    // 3. RENDER (EKRANA ÇİZME) FONKSİYONLARI
    // ==========================================
    
    // PORTFÖY FİLTRELEME VE RENDER
    filterPortfolios() {
        const searchVal = (document.getElementById('portfolioSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('portfolioDurumFilter')?.value || 'TÜMÜ';
        const menseVal = document.getElementById('menseFilter')?.value || 'TÜRKPATENT';

        let filtered = this.state.portfolios.filter(item => {
            if (item.transactionHierarchy === 'child') return false;

            // Menşe
            const originRaw = (item.origin || 'TÜRKPATENT').toUpperCase();
            const isTurk = originRaw.includes('TURK');
            if (menseVal === 'TÜRKPATENT' && !isTurk) return false;
            if (menseVal === 'YURTDISI' && isTurk) return false;

            // Metin Arama
            if (searchVal) {
                const searchable = `${item.title} ${item.applicationNumber} ${item.registrationNumber}`.toLowerCase();
                if (!searchable.includes(searchVal)) return false;
            }

            // Durum
            if (statusVal !== 'TÜMÜ') {
                if (!(item.status || '').toLowerCase().includes(statusVal.toLowerCase())) return false;
            }

            return true;
        });

        this.state.filteredPortfolios = filtered;

        // Pagination
        if (!this.state.paginations.portfolio) {
            this.state.paginations.portfolio = new Pagination({
                itemsPerPage: 10,
                containerId: 'markaPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderPortfolioTable(this.state.filteredPortfolios.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.portfolio.update(filtered.length);
        this.renderPortfolioTable(filtered.slice(0, 10), 0);
    }

    // DAVA FİLTRELEME VE RENDER
    filterSuits() {
        // İleride arama kutusu eklenirse buraya eklenebilir
        this.state.filteredSuits = this.state.suits;
        
        if (!this.state.paginations.suit) {
            this.state.paginations.suit = new Pagination({
                itemsPerPage: 10,
                containerId: 'davaPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderHelper.renderDavaTable(this.state.filteredSuits.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.suit.update(this.state.filteredSuits.length);
        this.renderHelper.renderDavaTable(this.state.filteredSuits.slice(0, 10), 0);
    }

    // İTİRAZ (OBJECTION) VERİSİ HAZIRLAMA VE RENDER
    async prepareAndRenderObjections() {
        const REQUEST_RESULT_STATUS = {
            '24': 'Eksiklik Bildirimi', '28': 'Kabul', '29': 'Kısmi Kabul', '30': 'Ret',
            '31': 'B.S - Kabul', '32': 'B.S - Kısmi Kabul','33': 'B.S - Ret',
            '34': 'İ.S - Kabul', '35': 'İ.S - Kısmi Kabul','36': 'İ.S - Ret',
            '50': 'Kabul', '51': 'Kısmi Kabul', '52': 'Ret'
        };

        const PARENT_TYPES = ['7', '19', '20'];
        
        // İtiraz görevlerini ayır
        const objectionTasks = this.state.tasks.filter(t => PARENT_TYPES.includes(String(t.taskType)));
        
        if (objectionTasks.length === 0) {
            this.renderHelper.renderObjectionTable([]);
            return;
        }

        // İlgili markaların ID'lerini topla
        const ipRecordIds = [...new Set(objectionTasks.map(t => t.relatedIpRecordId).filter(Boolean))];
        
        // Supabase'den bu markaların "TÜM İŞLEMLERİNİ" (transactions) tek seferde çek
        const { data: transactionsData } = await supabase
            .from('transactions')
            .select('*, transaction_documents(*)')
            .in('ip_record_id', ipRecordIds);

        const allTransactions = transactionsData || [];
        const rows = [];

        objectionTasks.forEach(task => {
            const ipRecord = this.state.portfolios.find(p => p.id === task.relatedIpRecordId) || {};
            const taskTxs = allTransactions.filter(tx => tx.ip_record_id === task.relatedIpRecordId);
            
            // Parent Transaction Bul
            let parentTx = task.details?.triggeringTransactionId 
                ? taskTxs.find(tx => String(tx.id) === String(task.details.triggeringTransactionId))
                : taskTxs.filter(tx => String(tx.transaction_type_id) === String(task.taskType)).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

            if (!parentTx) {
                parentTx = { id: 'virt-'+task.id, transaction_type_id: task.taskType, created_at: task.createdAt, isVirtual: true };
            }

            // Statü Rengi ve Metni
            let computedStatus = 'Karar Bekleniyor';
            let badgeColor = 'secondary';
            const rr = parentTx.request_result;
            
            if (rr && REQUEST_RESULT_STATUS[String(rr)]) {
                computedStatus = REQUEST_RESULT_STATUS[String(rr)];
                if (computedStatus.includes('Ret')) badgeColor = 'danger';
                else if (computedStatus.includes('Kabul')) badgeColor = 'success';
                else badgeColor = 'info';
            } else if ((task.status || '').includes('awaiting')) {
                computedStatus = 'Onay Bekliyor';
                badgeColor = 'warning';
            }

            // Alt işlemleri bul
            const children = parentTx.isVirtual ? [] : taskTxs.filter(tx => tx.transaction_hierarchy === 'child' && tx.parent_id === parentTx.id);

            // Dökümanlar
            const parentDocs = parentTx.transaction_documents || [];

            rows.push({
                id: task.id,
                recordId: task.relatedIpRecordId,
                origin: ipRecord.origin,
                brandImageUrl: ipRecord.brandImageUrl,
                title: ipRecord.title || task.recordTitle,
                transactionTypeName: task.taskTypeDisplay,
                applicationNumber: ipRecord.applicationNumber,
                applicantName: task.details?.applicantName || 'Müvekkil',
                bulletinDate: task.details?.brandInfo?.opposedMarkBulletinDate,
                bulletinNo: task.details?.brandInfo?.opposedMarkBulletinNo,
                epatsDate: parentTx.created_at,
                statusText: computedStatus,
                statusBadge: badgeColor,
                allParentDocs: parentDocs,
                childrenData: children
            });
        });

        this.state.filteredObjections = rows;

        // Sayfalama
        if (!this.state.paginations.objection) {
            this.state.paginations.objection = new Pagination({
                itemsPerPage: 10,
                containerId: 'davaItirazPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderHelper.renderObjectionTable(this.state.filteredObjections.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.objection.update(rows.length);
        this.renderHelper.renderObjectionTable(rows.slice(0, 10), 0);
    }

    renderPortfolioTable(dataSlice, startIndex) {
        const tbody = document.querySelector('#marka-list tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Kayıt bulunamadı.</td></tr>`;
            return;
        }

        dataSlice.forEach((item, index) => {
            const actualIndex = startIndex + index;
            const row = document.createElement('tr');
            
            const originRaw = (item.origin || 'TÜRKPATENT').toUpperCase();
            const originDisplay = originRaw.includes('TURK') ? 'TÜRKPATENT' : (item.country || 'Yurtdışı');
            
            const childRecords = this.state.portfolios.filter(p => p.parentId === item.id);
            const isInternational = childRecords.length > 0;

            const imgHtml = item.brandImageUrl ? `<img src="${item.brandImageUrl}" class="brand-thumb">` : '-';
            const appDate = this.formatDate(item.applicationDate);
            const renDate = this.formatDate(item.renewalDate);

            // Durum Rengi
            let badgeClass = 'secondary';
            const st = (item.status || '').toLowerCase();
            if (st.includes('tescil') || st.includes('registered')) badgeClass = 'success';
            else if (st.includes('başvuru') || st.includes('filed')) badgeClass = 'primary';
            else if (st.includes('red') || st.includes('rejected')) badgeClass = 'danger';
            else if (st.includes('itiraz')) badgeClass = 'warning';

            row.innerHTML = `
                <td>${isInternational ? '<i class="fas fa-chevron-right mr-2"></i>' : ''}${actualIndex + 1}</td>
                <td class="col-origin">${originDisplay}</td>
                <td class="col-sample text-center">${imgHtml}</td>
                <td><a href="#" class="portfolio-detail-link" data-item-id="${item.id}">${item.title}</a></td>
                <td>${item.applicationNumber}</td>
                <td>${item.registrationNumber}</td>
                <td>${appDate}</td>
                <td>${renDate}</td> 
                <td><span class="badge badge-${badgeClass}">${item.status || 'Bilinmiyor'}</span></td>
                <td>${item.classes}</td>
            `;

            if (isInternational) {
                row.classList.add('accordion-header-row');
                row.setAttribute('data-toggle', 'collapse');
                row.setAttribute('data-target', `#accordion-yurtdisi-${item.id}`);
            }

            tbody.appendChild(row);

            // Child satırlar
            if (isInternational) {
                const detailRow = document.createElement('tr');
                const childHtml = childRecords.map((child, cIdx) => {
                    const childAppDate = this.formatDate(child.applicationDate);
                    const childCountry = this.state.countries.get(child.country) || child.country || 'Bilinmiyor';
                    return `<tr>
                        <td>${actualIndex+1}.${cIdx+1}</td>
                        <td>${childCountry}</td>
                        <td>${child.applicationNumber}</td>
                        <td>${childAppDate}</td>
                        <td>${this.formatDate(child.renewalDate)}</td>
                        <td><span class="badge badge-secondary">${child.status || 'Bilinmiyor'}</span></td>
                        <td>${child.classes}</td>
                    </tr>`;
                }).join('');

                detailRow.innerHTML = `
                <td colspan="10" class="p-0">
                    <div class="collapse" id="accordion-yurtdisi-${item.id}">
                        <table class="table mb-0 accordion-table bg-light">
                            <thead><tr><th>#</th><th>Ülke</th><th>Başvuru No</th><th>Başvuru T.</th><th>Yenileme T.</th><th>Durum</th><th>Sınıflar</th></tr></thead>
                            <tbody>${childHtml}</tbody>
                        </table>
                    </div>
                </td>`;
                tbody.appendChild(detailRow);
            }
        });
    }

    // FATURA FİLTRELEME VE RENDER
    filterInvoices() {
        const searchVal = (document.getElementById('invoiceSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('invoiceDurumFilter')?.value || 'TÜMÜ';

        let filtered = this.state.invoices.filter(inv => {
            if (searchVal) {
                const s = `${inv.invoiceNo} ${inv.taskTitle} ${inv.applicationNumber}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }
            if (statusVal !== 'TÜMÜ' && inv.status !== statusVal) return false;
            return true;
        });

        this.state.filteredInvoices = filtered;

        if (!this.state.paginations.invoice) {
            this.state.paginations.invoice = new Pagination({
                itemsPerPage: 10, containerId: 'invoices-pagination-container',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderInvoicesTable(this.state.filteredInvoices.slice(start, start + perPage));
                }
            });
        }
        
        this.state.paginations.invoice.update(filtered.length);
        this.renderInvoicesTable(filtered.slice(0, 10));
    }

    renderInvoicesTable(dataSlice) {
        const tbody = document.querySelector('#invoices table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Kayıt bulunamadı.</td></tr>`;
            return;
        }

        dataSlice.forEach(inv => {
            let statusText = inv.status;
            let badgeClass = 'secondary';
            if (inv.status === 'paid') { statusText = 'Ödendi'; badgeClass = 'success'; }
            else if (inv.status === 'unpaid') { statusText = 'Ödenmedi'; badgeClass = 'danger'; }
            else if (inv.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; badgeClass = 'warning'; }

            const formatArr = (arr) => {
                if (!arr || arr.length === 0) return '0 TRY';
                return arr.map(x => `${x.amount} ${x.currency}`).join(' + ');
            };

            const row = `<tr>
                <td class="font-weight-bold">${inv.invoiceNo}</td>
                <td>#${inv.taskId}</td>
                <td>${inv.applicationNumber}</td>
                <td>${this.formatDate(inv.createdAt)}</td>
                <td>${inv.taskTitle}</td>
                <td>${inv.officialFee.amount} ${inv.officialFee.currency}</td>
                <td>${inv.serviceFee.amount} ${inv.serviceFee.currency}</td>
                <td class="font-weight-bold text-primary">${formatArr(inv.totalAmount)}</td>
                <td><span class="badge badge-${badgeClass}">${statusText}</span></td>
                <td><button class="btn btn-sm btn-outline-primary"><i class="fas fa-download"></i></button></td>
            </tr>`;
            tbody.innerHTML += row;
        });
    }

    // VEKALET FİLTRELEME VE RENDER
    filterContracts() {
        const searchVal = (document.getElementById('contractsSearchText')?.value || '').toLowerCase().trim();
        
        let filtered = this.state.contracts.filter(doc => {
            if (searchVal) {
                const s = `${doc.type} ${doc.countryName} ${doc.ownerName}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }
            return true;
        });

        this.state.filteredContracts = filtered;

        if (!this.state.paginations.contract) {
            this.state.paginations.contract = new Pagination({
                itemsPerPage: 10, containerId: 'contractsPagination',
                onPageChange: (page, perPage) => {
                    const start = (page - 1) * perPage;
                    this.renderContractsTable(this.state.filteredContracts.slice(start, start + perPage), start);
                }
            });
        }
        
        this.state.paginations.contract.update(filtered.length);
        this.renderContractsTable(filtered.slice(0, 10), 0);
    }

    renderContractsTable(dataSlice, startIndex) {
        const tbody = document.getElementById('contractsTableBody');
        const noMsg = document.getElementById('noContractsMessage');
        tbody.innerHTML = '';

        if (dataSlice.length === 0) {
            noMsg.style.display = 'block';
            return;
        }
        noMsg.style.display = 'none';

        dataSlice.forEach((doc, index) => {
            const btn = doc.url ? `<a href="${doc.url}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="fas fa-eye"></i> İncele</a>` : `<span class="badge badge-secondary">Dosya Yok</span>`;
            tbody.innerHTML += `
                <tr>
                    <td>${startIndex + index + 1}</td>
                    <td class="font-weight-bold text-primary"><i class="fas fa-file-alt mr-2 text-muted"></i>${doc.type}</td>
                    <td>${doc.countryName || '-'}</td>
                    <td>${this.formatDate(doc.validityDate)}</td>
                    <td class="text-center">${btn}</td>
                </tr>
            `;
        });
    }

    // İŞLERİM (TASKS) FİLTRELEME
    filterTasks() {
        const searchVal = (document.getElementById('taskSearchText')?.value || '').toLowerCase().trim();
        const statusVal = document.getElementById('taskStatusFilter')?.value || 'TÜMÜ';
        
        // Aktif alt sekme tipini bul
        const activeSubCard = document.querySelector('.detail-card-link.active-list-type');
        const taskTypeFilter = activeSubCard ? activeSubCard.dataset.taskType : 'pending-approval';

        let filtered = this.state.tasks.filter(t => {
            // Durum
            if (statusVal !== 'TÜMÜ' && t.status !== statusVal) return false;
            
            // Metin Arama
            if (searchVal) {
                const s = `${t.title} ${t.appNo} ${t.recordTitle}`.toLowerCase();
                if (!s.includes(searchVal)) return false;
            }

            // Kategori (Onay Bekleyen vs)
            const isDava = String(t.taskType) === '49' || (t.title || '').toLowerCase().includes('dava');
            if (taskTypeFilter === 'pending-approval') {
                return !isDava && t.status === 'awaiting_client_approval';
            } else if (taskTypeFilter === 'completed-tasks') {
                return !isDava && t.status !== 'awaiting_client_approval';
            }
            // Dava sekmeleri vb. eklenebilir...
            
            return true;
        });

        this.state.filteredTasks = filtered;

        const container = document.getElementById('task-list-container');
        if (filtered.length === 0) {
            container.innerHTML = '<div class="text-center text-muted p-4">Aranan kriterlere uygun iş bulunamadı.</div>';
            return;
        }

        // Basit Render
        let html = '<div class="row">';
        filtered.slice(0, 20).forEach((t, i) => { // Performans için max 20 çiz
            let badgeClass = t.status === 'awaiting_client_approval' ? 'warning' : 'success';
            let statusText = t.status === 'awaiting_client_approval' ? 'Onay Bekliyor' : 'Tamamlandı';

            let buttons = `<button class="btn btn-info btn-sm task-detail-btn" data-id="${t.id}"><i class="fas fa-eye"></i> İncele</button>`;
            if (t.status === 'awaiting_client_approval') {
                buttons = `
                    <button class="btn btn-success btn-sm task-action-btn mr-1" data-action="approve" data-id="${t.id}"><i class="fas fa-check"></i> Onayla</button>
                    <button class="btn btn-danger btn-sm task-action-btn mr-1" data-action="reject" data-id="${t.id}"><i class="fas fa-times"></i> Reddet</button>
                    ${buttons}
                `;
            }

            html += `
            <div class="col-12 mb-3">
                <div class="task-card border-left-${badgeClass} shadow-sm bg-white p-3 rounded" style="border-left-width: 5px;">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="font-weight-bold mb-1 text-primary">#${t.id} - ${t.taskTypeDisplay}</h6>
                            <div class="small text-muted"><i class="fas fa-cube mr-1"></i>${t.recordTitle} (${t.appNo})</div>
                            <span class="badge badge-${badgeClass} mt-2">${statusText}</span>
                        </div>
                        <div class="text-right">
                            <div class="small text-muted mb-2"><i class="far fa-clock"></i> Son Tarih: <b>${this.formatDate(t.dueDate)}</b></div>
                            ${buttons}
                        </div>
                    </div>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }


    // ==========================================
    // 4. OLAY DİNLEYİCİLERİ (EVENT LISTENERS)
    // ==========================================
    setupEventListeners() {
        document.getElementById('logoutBtn').addEventListener('click', () => {
            supabase.auth.signOut().then(() => window.location.href = 'index.html');
        });

        // Tab Değişimleri
        $('a[data-toggle="tab"]').on('shown.bs.tab', (e) => {
            const target = $(e.target).attr("href");
            if (target === '#reports') this.renderReports();
        });

        // Portföy Filtreleri
        $('#menseFilter, #portfolioDurumFilter').on('change', () => this.filterPortfolios());
        $('#portfolioSearchText').on('keyup', () => this.filterPortfolios());

        // Fatura Filtreleri
        $('#invoiceDurumFilter').on('change', () => this.filterInvoices());
        $('#invoiceSearchText').on('keyup', () => this.filterInvoices());

        // Vekalet Filtresi
        $('#contractsSearchText').on('keyup', () => this.filterContracts());

        // İşlerim (Task) Navigasyonu
        $('.task-card-link').click((e) => {
            const el = e.currentTarget;
            $('.task-card-link').removeClass('active-task-area');
            el.classList.add('active-task-area');
            
            $('#task-detail-cards').slideUp();
            $('#dava-task-detail-cards').slideUp();
            $('#task-list-filters').slideUp();
            $('#task-list-container').html('');

            const area = el.dataset.targetArea;
            if(area === 'marka-tasks') $('#task-detail-cards').slideDown();
            else if(area === 'dava-tasks') $('#dava-task-detail-cards').slideDown();
        });

        $('.detail-card-link').click((e) => {
            const el = e.currentTarget;
            $('.detail-card-link').removeClass('active-list-type');
            el.classList.add('active-list-type');
            $('#task-list-filters').slideDown();
            this.filterTasks();
        });

        // Görev Aksiyonları (Onay/Ret)
        $(document).on('click', '.task-action-btn', async (e) => {
            const btn = e.currentTarget;
            const taskId = btn.dataset.id;
            const action = btn.dataset.action;

            if (action === 'approve' && confirm('Bu işi onaylamak istiyor musunuz?')) {
                try {
                    await supabase.from('tasks').update({ status: 'open' }).eq('id', taskId);
                    alert('İş onaylandı.');
                    await this.loadAllData(); // Ekranı yenile
                } catch(err) {}
            } else if (action === 'reject') {
                const reason = prompt('Lütfen ret sebebini yazınız:');
                if (reason) {
                    try {
                        await supabase.from('tasks').update({ status: 'müvekkil onayı - kapatıldı', rejection_reason: reason }).eq('id', taskId);
                        alert('İş reddedildi.');
                        await this.loadAllData();
                    } catch(err) {}
                }
            }
        });

        // Portföy Detay Modal Açma
        $(document).on('click', '.portfolio-detail-link', async (e) => {
            e.preventDefault();
            const itemId = e.currentTarget.dataset.itemId;
            const item = this.state.portfolios.find(p => p.id === itemId);
            if (!item) return;

            document.getElementById('portfolioDetailModalLabel').textContent = item.title;
            document.getElementById('modal-img').src = item.brandImageUrl || 'https://placehold.co/150x150?text=Yok';
            document.getElementById('modal-details-card').innerHTML = `<p><strong>Tür:</strong> ${item.type}</p><p><strong>Başvuru No:</strong> ${item.applicationNumber}</p><p><strong>Sınıflar:</strong> ${item.classes}</p>`;
            document.getElementById('modal-dates-card').innerHTML = `<p><strong>Başvuru:</strong> ${this.formatDate(item.applicationDate)}</p><p><strong>Yenileme:</strong> ${this.formatDate(item.renewalDate)}</p><span class="badge badge-primary">${item.status}</span>`;
            
            // İşlemleri Çek
            document.querySelector('#modal-islemler tbody').innerHTML = '<tr><td colspan="4">Yükleniyor...</td></tr>';
            $('#portfolioDetailModal').modal('show');
            
            const { data: txs } = await supabase.from('transactions').select('*, transaction_types(alias)').eq('ip_record_id', item.id).order('created_at', { ascending: false });
            
            let txHtml = '';
            if (txs && txs.length > 0) {
                txs.forEach((tx, i) => {
                    const txName = tx.transaction_types?.alias || tx.description || 'İşlem';
                    txHtml += `<tr><td>${i+1}</td><td>${txName}</td><td>${this.formatDate(tx.created_at)}</td><td>-</td></tr>`;
                });
            } else {
                txHtml = '<tr><td colspan="4">İşlem bulunamadı.</td></tr>';
            }
            document.querySelector('#modal-islemler tbody').innerHTML = txHtml;
        });
    }

    // ==========================================
    // 5. RAPORLAR VE GRAFİKLER
    // ==========================================
    renderReports() {
        // Eski koddaki initReports içeriğinin modernleştirilmiş hali
        const portfolios = this.state.portfolios;
        
        document.getElementById('rep-total-assets').textContent = portfolios.length;
        
        let typeCounts = { 'Marka': 0, 'Patent': 0, 'Tasarım': 0 };
        portfolios.forEach(p => {
            if (p.type.includes('patent')) typeCounts['Patent']++;
            else if (p.type.includes('design')) typeCounts['Tasarım']++;
            else typeCounts['Marka']++;
        });

        // Basit Donut Chart
        if (window.ApexCharts) {
            const el = document.querySelector("#chart-portfolio-dist");
            el.innerHTML = "";
            new ApexCharts(el, {
                series: Object.values(typeCounts),
                labels: Object.keys(typeCounts),
                chart: { type: 'donut', height: 260 },
                colors: ['#4e73df', '#1cc88a', '#36b9cc'],
                legend: { position: 'bottom' }
            }).render();
        }
    }


    // ==========================================
    // YARDIMCI FONKSİYONLAR
    // ==========================================
    formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
        } catch { return '-'; }
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.classList.add(savedTheme + '-mode');
        document.getElementById('themeSwitch').checked = (savedTheme === 'dark');
        
        document.getElementById('themeSwitch').addEventListener('change', (e) => {
            const isDark = e.target.checked;
            document.body.classList.remove('light-mode', 'dark-mode');
            document.body.classList.add(isDark ? 'dark-mode' : 'light-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // HTML İçinden Çağrılan Inline JS Fonksiyonlarını Window'a Bağla
    exposeGlobalFunctions() {
        window.switchClient = (clientId, fromModal = false) => {
            if (fromModal) $('#clientSelectionModal').modal('hide');
            this.state.selectedClientId = clientId;
            sessionStorage.setItem('selectedClientSession', clientId);
            this.updateClientNameDisplay();
            this.loadAllData(); // Verileri baştan çek
        };

        window.initReports = () => this.renderReports();
        
        window.exportActiveTable = (type) => {
            alert("Export özelliği Supabase yapısı için hazırlanıyor.");
        };
        
        window.triggerTpQuery = (appNo) => {
            const cleanAppNo = String(appNo).replace(/[^a-zA-Z0-9/]/g, '');
            window.open(`https://portal.turkpatent.gov.tr/anonim/arastirma/marka/sonuc?dosyaNo=${encodeURIComponent(cleanAppNo)}`, '_blank');
        };
    }
}

// Sistemi Başlat
document.addEventListener('DOMContentLoaded', () => {
    const portal = new ClientPortalController();
    portal.init();
});