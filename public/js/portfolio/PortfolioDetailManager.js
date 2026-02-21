// public/js/portfolio/PortfolioDetailManager.js
import { TransactionHelper } from './TransactionHelper.js';
import { loadSharedLayout } from '../layout-loader.js';
import { ipRecordsService, transactionTypeService, db, storage, waitForAuthUser, redirectOnLogout } from '../../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { STATUSES } from '../../utils.js';
import '../simple-loading.js';

export class PortfolioDetailManager {
    constructor() {
        this.recordId = new URLSearchParams(location.search).get('id');
        this.currentRecord = null;
        this.transactionTypesMap = new Map();
        this.countriesMap = new Map();
        
        // SimpleLoading Panelini Singleton üzerinden yakala
        this.loader = window.SimpleLoadingController || (window.SimpleLoading ? new window.SimpleLoading() : null);

        this.initElements();
        this.init();
    }

    initElements() {
        this.elements = {
            heroTitle: document.getElementById('heroTitle'),
            brandImage: document.getElementById('brandImage'),
            heroCard: document.getElementById('heroCard'),
            heroKv: document.getElementById('heroKv'),
            goodsContainer: document.getElementById('goodsContainer'),
            txAccordion: document.getElementById('txAccordion'),
            docsTbody: document.getElementById('documentsTbody'),
            addDocForm: document.getElementById('addDocForm'),
            applicantName: document.getElementById('applicantName'),
            applicantAddress: document.getElementById('applicantAddress'),
            tpQueryBtn: document.getElementById('tpQueryBtn'),
            loadingStatic: document.getElementById('loading'), // "Yükleniyor..." yazan div
            detailRoot: document.getElementById('detail-root')
        };
    }

    async init() {
        try {
            // Önce statik loading yazısını gizle ve profesyonel loader'ı aç
            this.toggleLoading(true);
            
            await waitForAuthUser(); 

            // HIZLI YÜKLEME: Kayıt, Ülkeler ve İşlem Tiplerini paralel çek
            const [recordSnap, countriesSnap, txTypesRes] = await Promise.all([
                getDoc(doc(db, "ipRecords", this.recordId)),
                getDoc(doc(db, 'common', 'countries')),
                transactionTypeService.getTransactionTypes().catch(() => ({ success: false, data: [] }))
            ]);

            if (!recordSnap.exists()) throw new Error("Kayıt bulunamadı.");

            // Ülke ve İşlem Tipi haritalarını doldur
            if (countriesSnap.exists()) {
                countriesSnap.data().list?.forEach(c => this.countriesMap.set(String(c.id || c.code), c.name));
            }
            if (txTypesRes.success && Array.isArray(txTypesRes.data)) {
                txTypesRes.data.forEach(t => {
                    this.transactionTypesMap.set(String(t.id), t.alias || t.name);
                    if (t.code) this.transactionTypesMap.set(String(t.code), t.alias || t.name);
                });
            }

            this.currentRecord = { id: recordSnap.id, ...recordSnap.data() };
            
            // Tüm render işlemlerini başlat
            await this.renderAll();

            if (typeof loadSharedLayout === 'function') loadSharedLayout();
            this.setupEventListeners();
            redirectOnLogout();

        } catch (e) {
            console.error("❌ Başlatma hatası:", e);
            this.showError(e.message);
        } finally {
            this.toggleLoading(false);
        }
    }

    async renderAll() {
        this.renderHero();
        this.renderGoodsList();
        this.renderDocuments();
        
        // "Ağır işleri" artık arka planda değil, paralel olarak ancak loading ekranı 
        // kapanmadan BİTMESİNİ BEKLEYEREK çalıştırıyoruz.
        await Promise.all([
            this.renderApplicants(),
            this.renderTransactions()
        ]);
    }

    renderHero() {
        const r = this.currentRecord;
        if (!r) return;

        this.elements.heroTitle.textContent = r.trademarkName || r.brandText || r.title || '-';
        
        // Marka örneği olmasa da kart her zaman görünür (İstediğiniz güncelleme)
        if (this.elements.heroCard) {
            this.elements.heroCard.classList.remove('d-none');
            this.elements.heroCard.style.display = 'flex';
        }

        const imgSrc = r.brandImageUrl || r.brandImage || r.details?.brandInfo?.brandImage;
        const imgWrap = this.elements.brandImage?.closest('.hero-img-wrap');
        if (imgSrc && this.elements.brandImage) {
            this.elements.brandImage.src = imgSrc;
            if (imgWrap) imgWrap.style.display = 'block';
        } else {
            if (imgWrap) imgWrap.style.display = 'none'; // Görsel yoksa alanı kapat, bilgiler genişlesin
        }

        const isTP = this.checkIfTurkPatentOrigin(r);
        const countryName = this.countriesMap.get(String(r.country)) || r.country || '-';
        const regNo = r.registrationNumber || r.internationalRegNumber || r.wipoIrNumber || '-';

        // Sınıf metni
        const gsbc = r.goodsAndServicesByClass;
        let classList = Array.isArray(gsbc) ? gsbc : (gsbc ? Object.values(gsbc) : []);
        let classesStr = classList.length > 0 ? classList.map(c => c.classNo).join(', ') : (r.classes || '-');

        if (this.elements.heroKv) {
            this.elements.heroKv.innerHTML = `
                <div class="kv-item"><div class="label">Başvuru No</div><div class="value">${r.applicationNumber || '-'}</div></div>
                <div class="kv-item"><div class="label">Tescil No</div><div class="value">${regNo}</div></div>
                <div class="kv-item"><div class="label">Durum</div><div class="value">${this.getStatusText(r.type, r.status)}</div></div>
                <div class="kv-item"><div class="label">Başvuru Tarihi</div><div class="value">${this.formatDate(r.applicationDate)}</div></div>
                <div class="kv-item"><div class="label">Tescil Tarihi</div><div class="value">${this.formatDate(r.registrationDate)}</div></div>
                <div class="kv-item"><div class="label">Yenileme Tarihi</div><div class="value">${this.formatDate(r.renewalDate)}</div></div>
                
                ${(!isTP) ? `
                    <div style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; border-top: 1px solid #eee; padding-top: 10px; margin-top: 5px;">
                        <div class="kv-item" style="border:none; padding:0;"><div class="label">Ülke</div><div class="value">${countryName}</div></div>
                        <div class="kv-item" style="border:none; padding:0;"><div class="label">Orijin</div><div class="value">${r.origin || '-'}</div></div>
                    </div>` : ''}

                <div class="kv-item" style="grid-column: 1 / -1; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e0e0e0;">
                    <div class="label" style="margin-bottom: 4px;">Sınıflar (Nice)</div>
                    <div class="value text-primary" style="font-weight: 700;">${classesStr}</div>
                </div>
            `;
        }

        if (this.elements.tpQueryBtn) {
            this.elements.tpQueryBtn.style.display = isTP ? 'inline-block' : 'none';
        }
    }

    renderGoodsList() {
        const container = this.elements.goodsContainer;
        if (!container) return;
        const gsbc = this.currentRecord.goodsAndServicesByClass;
        let arr = Array.isArray(gsbc) ? gsbc : (gsbc ? Object.values(gsbc) : []);
        if (arr.length === 0) { container.innerHTML = '<div class="text-muted p-3">Eşya listesi yok.</div>'; return; }

        container.innerHTML = arr.sort((a,b) => Number(a.classNo) - Number(b.classNo)).map(entry => {
            const listHtml = this.formatNiceClassContent(entry.classNo, entry.items || [entry.goodsText]);
            return `
                <div class="goods-group border rounded p-3 mb-2 bg-white">
                    <div class="font-weight-bold text-primary mb-2">Nice ${entry.classNo}</div>
                    <ul class="pl-3 mb-0 goods-items">${listHtml}</ul>
                </div>`
        }).join('');
    }

    formatNiceClassContent(classNo, items) {
        if (!items || !items.length) return '';
        if (String(classNo) === '35') {
            let html = '', isIndentedSection = false;
            const triggerPhrase = "satın alması için", startPhrase = "müşterilerin malları";
            items.forEach(t => {
                const text = String(t || ''), lowerText = text.toLowerCase();
                if (!isIndentedSection && lowerText.includes(startPhrase) && lowerText.includes(triggerPhrase)) {
                    const match = text.match(new RegExp(`(${triggerPhrase})`, 'i'));
                    if (match) {
                        const splitIndex = match.index + match[1].length;
                        html += `<li class="font-weight-bold list-unstyled mt-2" style="list-style:none;">${text.substring(0, splitIndex)}</li>`;
                        if (text.substring(splitIndex).trim()) html += `<li class="ml-4" style="list-style-type:circle;">${text.substring(splitIndex)}</li>`;
                        isIndentedSection = true; return;
                    }
                }
                html += isIndentedSection ? `<li class="ml-4" style="list-style-type:circle;">${text}</li>` : `<li>${text}</li>`;
            });
            return html;
        }
        return items.map(item => `<li>${item}</li>`).join('');
    }

    async renderTransactions() {
        const accordion = this.elements.txAccordion;
        if (!accordion) return;

        const res = await ipRecordsService.getTransactionsForRecord(this.recordId);
        const transactions = res.success ? res.transactions : [];

        if (transactions.length === 0) {
            accordion.innerHTML = '<div class="p-3 text-muted">İşlem geçmişi bulunamadı.</div>';
            return;
        }

        const { parents, childrenMap } = TransactionHelper.organizeTransactions(transactions);
        const enrichQueue = [];

        accordion.innerHTML = parents.map(parent => {
            const typeName = this.transactionTypesMap.get(String(parent.type)) || `İşlem ${parent.type}`;
            const children = childrenMap[parent.id] || [];
            const pId = this.safeDomId(`txdocs-${parent.id}`);

            // Direkt PDF'leri bul
            const pDirectDocs = TransactionHelper.getDirectDocuments(parent);
            const pIcons = pDirectDocs.map((d, i) => this.createDocIcon(d, i === 0)).join(' ');

            let pDocsHtml = pIcons || '';
            if (parent.triggeringTaskId) {
                pDocsHtml += `<span class="tx-docs-loading text-muted small ml-2"><i class="fas fa-spinner fa-spin"></i> PDF'ler...</span>`;
                enrichQueue.push({ tx: parent, containerId: pId, hasAnyDirect: pDirectDocs.length > 0 });
            }

            const childrenHtml = children.length === 0 ? '' : `
                <div class="accordion-transaction-children" style="display:none;">
                    ${children.map(child => {
                        const cTypeName = this.transactionTypesMap.get(String(child.type)) || `İşlem ${child.type}`;
                        const cId = this.safeDomId(`txdocs-${child.id}`);
                        const cDirectDocs = TransactionHelper.getDirectDocuments(child);
                        const cIcons = cDirectDocs.map((d, i) => this.createDocIcon(d, i === 0)).join(' ');
                        
                        let cDocsHtml = cIcons || '';
                        if (child.triggeringTaskId) {
                            cDocsHtml += `<span class="tx-docs-loading text-muted small ml-2"><i class="fas fa-spinner fa-spin"></i> PDF'ler...</span>`;
                            enrichQueue.push({ tx: child, containerId: cId, hasAnyDirect: cDirectDocs.length > 0 });
                        }

                        return `
                        <div class="child-transaction-item d-flex justify-content-between align-items-center p-2 border-top bg-light ml-4" style="border-left: 3px solid #f39c12;">
                            <div><small class="text-muted">↳ ${cTypeName}</small><span class="text-muted ml-2 small">${this.formatDate(child.timestamp || child.date, true)}</span></div>
                            <div id="${cId}">${cDocsHtml || '-'}</div>
                        </div>`;
                    }).join('')}
                </div>`;

            return `
                <div class="accordion-transaction-item border-bottom">
                    <div class="accordion-transaction-header d-flex justify-content-between align-items-center p-3" style="cursor:pointer; background: #fff;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-chevron-right mr-2 text-muted transition-icon ${children.length ? 'has-child-indicator' : ''}"></i>
                            <div class="d-flex flex-column">
                                <span class="font-weight-bold" data-tx-type="${parent.type}">${typeName}</span>
                                <small class="text-muted">${this.formatDate(parent.timestamp || parent.date, true)}</small>
                            </div>
                        </div>
                        <div class="d-flex align-items-center" id="${pId}">
                            ${pDocsHtml || '-'}
                            ${children.length ? `<span class="badge badge-light border ml-2">${children.length} alt</span>` : ''}
                        </div>
                    </div>
                    ${childrenHtml}
                </div>`;
        }).join('');

        this.setupAccordionEvents();
        this.populateTaskDocsAsync(enrichQueue).catch(e => console.warn(e));
    }

    safeDomId(raw) { return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_'); }

    async populateTaskDocsAsync(queue) {
        if (!queue.length) return;
        const worker = async (item) => {
            const { tx, containerId, hasAnyDirect } = item;
            const container = document.getElementById(containerId);
            if (!container) return;
            const taskDocs = await TransactionHelper.getTaskDocuments(tx);
            container.querySelector('.tx-docs-loading')?.remove();
            if (!taskDocs || taskDocs.length === 0) {
                if (!hasAnyDirect && container.innerText.trim() === '') container.innerHTML = '<span class="text-muted small">-</span>';
                return;
            }
            const existing = new Set(Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href')));
            const icons = taskDocs.filter(d => d?.url && !existing.has(d.url)).map((d, i) => this.createDocIcon(d, i === 0 && existing.size === 0)).join(' ');
            if (icons) container.insertAdjacentHTML('beforeend', icons);
        };
        for (const item of queue) { await worker(item); }
    }

    createDocIcon(doc, isFirst) {
        const color = (doc.source === 'task') ? 'text-info' : 'text-danger'; 
        return `<a href="${doc.url}" target="_blank" class="mx-1 ${color}" title="${doc.name || 'Belge'}"><i class="fas fa-file-pdf fa-lg"></i></a>`;
    }

    toggleLoading(show) {
        if (show) {
            if (this.elements.loadingStatic) this.elements.loadingStatic.style.display = 'none'; 
            if (this.elements.detailRoot) this.elements.detailRoot.classList.add('d-none');
            if (this.loader) this.loader.show({ text: 'Yükleniyor', subtext: 'Kayıt detayları hazırlanıyor...' });
        } else {
            if (this.loader) this.loader.hide();
            if (this.elements.detailRoot) this.elements.detailRoot.classList.remove('d-none');
        }
    }

    // --- DİĞER METOTLAR (Orijinal ile aynı) ---
    async renderApplicants() {
        const r = this.currentRecord;
        if (!this.elements.applicantName) return;
        let names = [], addresses = [];
        if (Array.isArray(r.applicants) && r.applicants.length > 0) {
            const resolved = await Promise.all(r.applicants.map(async (app) => {
                const pId = typeof app === 'string' ? app : app.id;
                if (!pId) return { name: app.name || '-' };
                try {
                    const snap = await getDoc(doc(db, 'persons', pId));
                    return snap.exists() ? { name: snap.data().name, address: snap.data().address } : { name: app.name || '-' };
                } catch { return { name: app.name || '-' }; }
            }));
            names = resolved.map(a => a.name); addresses = resolved.map(a => a.address).filter(Boolean);
        } else {
            names = [r.applicantName || r.clientName || '-']; addresses = [r.applicantAddress || '-'];
        }
        this.elements.applicantName.innerHTML = names.join('<br>');
        if (this.elements.applicantAddress) this.elements.applicantAddress.innerHTML = addresses.join('<br>') || '-';
    }

    renderDocuments() {
        const docs = this.currentRecord.documents || [];
        if (this.elements.docsTbody) {
            this.elements.docsTbody.innerHTML = docs.length ? docs.map(d => `
                <tr><td>${d.name}</td><td>${d.documentDesignation || '-'}</td><td>${this.formatDate(d.uploadedAt)}</td>
                <td class="text-right"><i class="fas fa-eye text-primary cursor-pointer" onclick="window.open('${d.url}','_blank')"></i></td></tr>`).join('') : '<tr><td colspan="4" class="text-center">Belge yok.</td></tr>';
        }
    }

    setupAccordionEvents() {
        this.elements.txAccordion.querySelectorAll('.accordion-transaction-header').forEach(header => {
            header.onclick = (e) => {
                if (e.target.closest('a')) return;
                const container = header.parentElement.querySelector('.accordion-transaction-children');
                const icon = header.querySelector('.transition-icon');
                if (container) {
                    const isVisible = container.style.display !== 'none';
                    container.style.display = isVisible ? 'none' : 'block';
                    if (icon) icon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
                }
            };
        });
    }

    formatDate(d, withTime = false) {
        if (!d) return '-';
        try {
            const dateObj = d.toDate ? d.toDate() : new Date(d);
            return dateObj.toLocaleDateString('tr-TR', withTime ? { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'} : {});
        } catch { return String(d); }
    }

    getStatusText(type, status) {
        const list = STATUSES[type] || [];
        const found = list.find(s => s.value === status);
        return found ? found.text : status;
    }

    checkIfTurkPatentOrigin(rec) {
        const c = [rec?.origin, rec?.source].map(s => (s||'').toUpperCase());
        return c.some(s => s.includes('TURKPATENT') || s.includes('TÜRKPATENT'));
    }

    setupEventListeners() {
        this.elements.tpQueryBtn?.addEventListener('click', () => {
             const appNo = this.currentRecord.applicationNumber;
             if(window.triggerTpQuery) window.triggerTpQuery(appNo);
             else window.open(`https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`, '_blank');
        });
    }

    showError(msg) {
        if (this.loader) this.loader.hide();
        if (this.elements.loadingStatic) {
            this.elements.loadingStatic.style.display = 'block';
            this.elements.loadingStatic.innerHTML = `<div class="alert alert-danger m-3">${msg}</div>`;
        }
    }
}

window.manager = new PortfolioDetailManager();