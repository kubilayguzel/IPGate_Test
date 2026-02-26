// public/js/trademark-similarity-search.js

import { supabase, taskService } from '../supabase-config.js'; // 🔥 taskService import edildi
import { runTrademarkSearch } from './trademark-similarity/run-search.js';
import Pagination from './pagination.js';
import { loadSharedLayout } from './layout-loader.js';
import { showNotification } from '../utils.js';
const SimpleLoading = window.SimpleLoadingController;

console.log("### trademark-similarity-search.js yüklendi (100% Supabase) ###");

// --- 1. GLOBAL DEĞİŞKENLER ---
let allSimilarResults = [];
let monitoringTrademarks = [];
let filteredMonitoringTrademarks = [];
let allPersons = [];
const taskTriggeredStatus = new Map();
const notificationStatus = new Map();
let pagination;
let monitoringPagination;
let selectedMonitoredTrademarkId = null;
let similarityFilter = 'all';
let manualSelectedFile = null;

const RELATED_CLASSES_MAP = {
    "29": ["30", "31", "43"], "30": ["29", "31", "43"], "31": ["29", "30", "43"],
    "32": ["33"], "33": ["32"], "43": ["29", "30", "31"],
    "1": ["5"], "3": ["5", "44"], "5": ["1", "3", "10", "44"],
    "10": ["5", "44"], "44": ["3", "5", "10"],
    "18": ["25"], "23": ["24", "25"], "24": ["20", "23", "25", "27", "35"],
    "25": ["18", "23", "24", "26"], "26": ["25"],
    "9": ["28", "38", "41", "42"], "28": ["9", "41"], "38": ["9"],
    "41": ["9", "16", "28", "42"], "42": ["9", "41"], "16": ["41"],
    "7": ["37"], "11": ["21", "37"], "12": ["37", "39"],
    "37": ["7", "11", "12", "19", "36"], "39": ["12", "36"],
    "6": ["19", "20"], "19": ["6", "35", "37"], "20": ["6", "21", "24", "27", "35"],
    "21": ["11", "20"], "27": ["20", "24", "35"], "35": ["19", "20", "24", "27", "36"],
    "36": ["35", "37", "39"]
};
const TSS_RESUME_KEY = 'TSS_LAST_STATE_V1';
const MANUAL_COLLECTION_ID = 'GLOBAL_MANUAL_RECORDS';
let tpSearchResultData = null;
let cachedGroupedData = null; 
const _storageUrlCache = new Map(); 

// --- 2. YARDIMCI FONKSİYONLAR ---
const tssLoadState = () => { try { return JSON.parse(localStorage.getItem(TSS_RESUME_KEY) || '{}'); } catch { return {}; } };
const tssSaveState = (partial) => { try { const prev = tssLoadState(); localStorage.setItem(TSS_RESUME_KEY, JSON.stringify({ ...prev, ...partial, updatedAt: new Date().toISOString() })); } catch (e) {} };
const tssClearState = () => { try { localStorage.removeItem(TSS_RESUME_KEY); } catch (e) {} };

const tssBuildStateFromUI = (extra = {}) => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    return { bulletinValue: bulletinSelect?.value || '', bulletinText: bulletinSelect?.options?.[bulletinSelect.selectedIndex]?.text || '', ...extra };
};

const tssShowResumeBannerIfAny = () => {
    const state = tssLoadState();
    if (!state?.bulletinValue) return;
    let bar = document.getElementById('tssResumeBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'tssResumeBar';
        bar.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;background:#1e3c72;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.2);display:flex;gap:8px;align-items:center;font-size:14px;';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `<span>“${state.bulletinText || 'Seçili bülten'}” → Sayfa ${state.page || 1}</span><button id="tssResumeBtn" style="background:#fff;color:#1e3c72;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Devam Et</button><button id="tssClearBtn" style="background:#ff5a5f;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer">Sıfırla</button>`;
    document.getElementById('tssClearBtn').onclick = () => { tssClearState(); bar.remove(); };
    document.getElementById('tssResumeBtn').onclick = () => {
        const targetPage = tssLoadState().page || 1;
        window.__tssPendingResumeForBulletin = targetPage;
        const sel = document.getElementById('bulletinSelect');
        if (sel) { sel.value = tssLoadState().bulletinValue; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        const startBtn = document.getElementById('startSearchBtn') || document.getElementById('researchBtn');
        if (startBtn) {
            startBtn.click();
            let tries = 0;
            const iv = setInterval(() => {
                tries++;
                const loadingIndicator = document.getElementById('loadingIndicator');
                if (loadingIndicator && loadingIndicator.style.display === 'none' && allSimilarResults.length > 0 && pagination) {
                    clearInterval(iv);
                    if (pagination.goToPage(targetPage)) { bar.style.background = '#28a745'; bar.firstElementChild.textContent = `Devam edildi: Sayfa ${targetPage}`; setTimeout(() => bar.remove(), 2000); window.__tssPendingResumeForBulletin = null; }
                } else if (tries > 300) { clearInterval(iv); window.__tssPendingResumeForBulletin = null; }
            }, 100);
        }
    };
};

window.addEventListener('beforeunload', () => tssSaveState(tssBuildStateFromUI({
    page: pagination?.getCurrentPage ? pagination.getCurrentPage() : undefined,
    itemsPerPage: pagination?.getItemsPerPage ? pagination.getItemsPerPage() : undefined,
    totalResults: Array.isArray(allSimilarResults) ? allSimilarResults.length : 0
})));

const debounce = (func, delay) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), delay); }; };

const _appNoImgCache = new Map();
const _normalizeImageSrc = (u) => {
    if (!u || typeof u !== 'string') return '';
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (/^[A-Za-z0-9+/=]+$/.test(u.slice(0, 100))) return 'data:image/png;base64,' + u;
    // Eğer sadece dosya yoluysa Supabase Public URL döndür
    const { data } = supabase.storage.from('brand_images').getPublicUrl(u);
    return data.publicUrl;
};

const _getBrandImageByAppNo = async (appNo) => {
    if (!appNo || appNo === '-') return '';
    if (_storageUrlCache.has(appNo)) return _storageUrlCache.get(appNo);

    // Boşlukları temizle ve güvenli arama formatına getir
    const safeAppNo = appNo.toString().trim().replace(/\s+/g, '%');

    try {
        // 1. Önce bülten kayıtlarında ara (Sadece resmi olanları getir)
        const { data: bRec } = await supabase
            .from('trademark_bulletin_records')
            .select('image_path')
            .ilike('application_no', `%${safeAppNo}%`)
            .not('image_path', 'is', null)
            .limit(1);

        if (bRec && bRec.length > 0 && bRec[0].image_path) {
            const url = _normalizeImageSrc(bRec[0].image_path);
            _storageUrlCache.set(appNo, url);
            return url;
        }

        // 2. Bulamazsa Portföyde ara
        // 🔥 KRİTİK DÜZELTME: Tabloda olmayan 'details' kolonu sorgudan çıkartıldı (400 Bad Request hatasını çözer)
        const { data: ipRec, error: ipErr } = await supabase
            .from('ip_records')
            .select('brand_image_url') 
            .ilike('application_number', `%${safeAppNo}%`) 
            .limit(1);
            
        if (ipErr) throw ipErr;

        if (ipRec && ipRec.length > 0) {
            const foundImage = ipRec[0].brand_image_url;
            if (foundImage) {
                const url = _normalizeImageSrc(foundImage);
                _storageUrlCache.set(appNo, url);
                return url;
            }
        }
    } catch (err) {
        console.warn("Görsel aranırken hata oluştu (AppNo: " + appNo + "):", err.message || err);
    }

    _storageUrlCache.set(appNo, '');
    return '';
};

const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
            const container = entry.target;
            const hitData = JSON.parse(container.dataset.hitData);
            observer.unobserve(container);
            try {
                let imgUrl = hitData.brandImageUrl || '';
                if (!imgUrl && hitData.imagePath) imgUrl = _normalizeImageSrc(hitData.imagePath);
                if (!imgUrl && hitData.applicationNo) imgUrl = await _getBrandImageByAppNo(hitData.applicationNo);
                
                if (imgUrl) container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><img src="${imgUrl}" loading="lazy" alt="Marka" class="trademark-image-thumbnail-large"></div>`;
                else container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder">-</div></div>`;
            } catch (err) { container.innerHTML = `<div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder">?</div></div>`; }
        }
    });
}, { rootMargin: '100px 0px', threshold: 0.01 });

const _ipCache = new Map();
const _getIp = async (recordId) => {
    if (!recordId) return null;
    if (_ipCache.has(recordId)) return _ipCache.get(recordId);
    
    try {
        // .single() yerine .limit(1) kullanarak 406 hatasından kaçınıyoruz
        const { data, error } = await supabase
            .from('ip_records')
            .select('*')
            .eq('id', recordId)
            .limit(1);

        if (error || !data || data.length === 0) {
            console.warn(`⚠️ IP kaydı bulunamadı: ${recordId}`);
            return null;
        }

        const record = data[0];

        // JSON parse işlemlerini güvenli hale getiriyoruz
        try { 
            record.applicants = typeof record.applicants === 'string' ? JSON.parse(record.applicants) : (record.applicants || []); 
        } catch(e) { record.applicants = []; }
        
        try { 
            record.details = typeof record.details === 'string' ? JSON.parse(record.details) : (record.details || {}); 
        } catch(e) { record.details = {}; }

        _ipCache.set(recordId, record);
        return record;
    } catch (err) {
        console.error("❌ _getIp kritik hata:", err);
        _ipCache.set(recordId, null);
        return null;
    }
};

const _pickName = (ip, tm) => ip?.mark_name || ip?.title || ip?.brandText || tm?.title || tm?.markName || tm?.brandText || '-';
const _pickImg = (ip, tm) => ip?.brand_image_url || ip?.image_path || tm?.brandImageUrl || tm?.imagePath || tm?.details?.brandInfo?.brandImage || '';
const _pickAppNo = (ip, tm) => ip?.application_number || ip?.applicationNo || tm?.applicationNumber || tm?.applicationNo || '-';
const _pickAppDate = (ip, tm) => { const v = ip?.application_date || ip?.applicationDate || tm?.applicationDate; return v ? new Date(v).toLocaleDateString('tr-TR') : '-'; };

const getTotalCountForMonitoredId = (id) => id ? allSimilarResults.reduce((acc, r) => acc + (r.monitoredTrademarkId === id ? 1 : 0), 0) : 0;

const _getOwnerKey = (ip, tm, persons = []) => {
    // 1. Sahibin adını bul
    let name = ip?.owner_name || tm?.ownerName;
    if (!name && ip?.applicants?.length > 0) name = ip.applicants[0].name || ip.applicants[0].companyName;
    if (!name || name === '-') name = 'Bilinmeyen Sahip';

    // 2. 🔥 HATA DÜZELTMESİ: ID olarak Marka ID'si yerine Sahip ismi üzerinden bir ID (Slug) üretiyoruz.
    // Eğer veritabanınızda gerçek bir client_id varsa onu kullanır, yoksa isme göre gruplar.
    const nameSlug = name.toLowerCase().replace(/[^a-z0-9]/gi, '').substring(0, 20);
    const id = ip?.client_id || tm?.client_id || `owner_${nameSlug}`;

    return { key: id, id, name };
};

const _pickOwners = (ip, tm, persons = []) => ip?.owner_name || tm?.ownerName || '-';

const _uniqNice = (obj) => {
    const set = new Set();
    const classes = obj?.nice_classes || obj?.niceClasses || obj?.niceClass || '';
    if (typeof classes === 'string') classes.split(/[,\s]+/).forEach(n => n && set.add(n));
    else if (Array.isArray(classes)) classes.forEach(n => set.add(String(n)));
    return Array.from(set).sort((a, b) => Number(a) - Number(b)).join(', ');
};

const getNiceClassNumbers = (item) => Array.from(new Set(String(item?.niceClasses || item?.nice_classes || '').split(/[,\s]+/).filter(Boolean)));
const normalizeNiceList = (input) => Array.isArray(input) ? input.map(String) : String(input || '').split(/[^\d]+/).filter(Boolean).map(p => String(parseInt(p, 10))).filter(p => !isNaN(p) && ((Number(p) >= 1 && Number(p) <= 45) || Number(p) === 99));

// --- 3. EVENT LISTENERS ---
const attachMonitoringAccordionListeners = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (!tbody || tbody._accordionSetup) return;
    tbody._accordionSetup = true;
    tbody.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn, button, a')) return;
        const row = e.target.closest('.owner-row');
        if (!row) return;
        const targetId = row.dataset.target || '#' + row.getAttribute('aria-controls');
        const contentRow = document.querySelector(targetId);
        if (!contentRow) return;
        const isExpanded = row.getAttribute('aria-expanded') === 'true';
        contentRow.style.display = isExpanded ? 'none' : 'table-row';
        row.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
        const icon = row.querySelector('.toggle-icon');
        if (icon) { icon.classList.toggle('fa-chevron-up', !isExpanded); icon.classList.toggle('fa-chevron-down', isExpanded); }
    });
};

const attachGenerateReportListener = () => {
    document.querySelectorAll('.generate-report-btn').forEach(btn => { btn.removeEventListener('click', handleOwnerReportGeneration); btn.addEventListener('click', handleOwnerReportGeneration); });
    document.querySelectorAll('.generate-report-and-notify-btn').forEach(btn => { btn.removeEventListener('click', handleOwnerReportAndNotifyGeneration); btn.addEventListener('click', handleOwnerReportAndNotifyGeneration); });
};

const attachEventListeners = () => {
    const resultsTableBody = document.getElementById('resultsTableBody');
    if (!resultsTableBody) return;
    resultsTableBody.querySelectorAll('.action-btn').forEach(btn => btn.addEventListener('click', handleSimilarityToggle));
    resultsTableBody.querySelectorAll('.bs-select').forEach(select => select.addEventListener('change', handleBsChange));
    resultsTableBody.querySelectorAll('.note-cell').forEach(cell => cell.addEventListener('click', () => handleNoteCellClick(cell)));
};

// --- 4. DATA LOADER ---
const refreshTriggeredStatus = async (bulletinNo) => {
    try {
        taskTriggeredStatus.clear();
        if (!bulletinNo) return;
        
        // 🔥 SUPABASE YAMASI: tasks tablosunda doğrudan JSONB veya ana kolonlardan arama yapılır
        const { data: tasks } = await supabase.from('tasks')
            .select('id, bulletin_no, client_id, details')
            .eq('task_type', '66')
            .in('status', ['open', 'awaiting_client_approval']);
            
        if (!tasks || tasks.length === 0) return;
        
        tasks.forEach(t => {
            let detailsObj = t.details || {};
            // JSON string gelirse parse et
            if (typeof detailsObj === 'string') {
                try { detailsObj = JSON.parse(detailsObj); } catch(e){}
            }
            
            const taskBulletin = t.bulletin_no || detailsObj.bulletinNo || '';
            const clientId = t.client_id || detailsObj.relatedParty?.id || '';
            
            if (String(taskBulletin) === String(bulletinNo) && clientId) {
                taskTriggeredStatus.set(String(clientId), 'Evet');
            }
        });
    } catch (e) { 
        console.error("Görev durumu kontrol hatası:", e); 
    }
};

// --- 5. RENDER FUNCTIONS ---
const renderMonitoringList = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (!filteredMonitoringTrademarks.length) { tbody.innerHTML = '<tr><td colspan="6" class="no-records">Filtreye uygun izlenecek marka bulunamadı.</td></tr>'; return; }

    if (!cachedGroupedData) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-3"><i class="fas fa-spinner fa-spin"></i> Veriler işleniyor...</td></tr>';
        const grouped = {};
    for (const tm of filteredMonitoringTrademarks) {
            const ip = tm.ipRecord || null;
            const ownerInfo = tm.ownerInfo; // 🚀 HESAPLAMAK YERİNE DOĞRUDAN HAZIRI ALIYOR
            const nices = _uniqNice(ip || tm);
            const ownerKey = ownerInfo.key;
            if (!grouped[ownerKey]) grouped[ownerKey] = { ownerName: ownerInfo.name, ownerId: ownerInfo.id, trademarks: [], allNiceClasses: new Set() };
            if(nices) nices.split(', ').forEach(n => grouped[ownerKey].allNiceClasses.add(n));
            grouped[ownerKey].trademarks.push({ tm, ip, ownerInfo });
        }
        cachedGroupedData = grouped;
    }

    const groupedByOwner = cachedGroupedData;
    tbody._currentGroupedData = groupedByOwner;
    const sortedOwnerKeys = Object.keys(groupedByOwner).sort((a, b) => groupedByOwner[a].ownerName.localeCompare(groupedByOwner[b].ownerName));
    const itemsPerPage = monitoringPagination ? monitoringPagination.getItemsPerPage() : 5;
    const currentPage = monitoringPagination ? monitoringPagination.getCurrentPage() : 1;
    const paginatedOwnerKeys = sortedOwnerKeys.slice((currentPage - 1) * itemsPerPage, ((currentPage - 1) * itemsPerPage) + itemsPerPage);

    let allRowsHtml = [];
    for (const ownerKey of paginatedOwnerKeys) {
        const group = groupedByOwner[ownerKey];
        const groupUid = `owner-group-${group.ownerId}-${ownerKey.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;
        const isTriggered = taskTriggeredStatus.get(group.ownerId) === 'Evet';
        
        allRowsHtml.push(`
        <tr class="owner-row" data-toggle="collapse" data-target="#${groupUid}" aria-expanded="false" aria-controls="${groupUid}">
            <td><i class="fas fa-chevron-down toggle-icon"></i></td>
            <td>${group.ownerName}</td>
            <td>${group.trademarks.length}</td>
            <td><span class="task-triggered-status trigger-status-badge ${isTriggered ? 'trigger-yes' : 'trigger-ready'}" data-owner-id="${group.ownerId}">${isTriggered ? 'Evet' : 'Hazır'}</span></td>
            <td><span class="notification-status-badge initial-status" data-owner-id="${group.ownerId}">Gönderilmedi</span></td>
            <td>
                <div class="action-btn-group">
                    <button class="action-btn btn-success generate-report-and-notify-btn" data-owner-id="${group.ownerId}" data-owner-name="${group.ownerName}" title="Rapor + Bildir"><i class="fas fa-paper-plane"></i></button>
                    <button class="action-btn btn-primary generate-report-btn" data-owner-id="${group.ownerId}" data-owner-name="${group.ownerName}" title="Rapor İndir"><i class="fas fa-file-pdf"></i></button>
                </div>
            </td>
        </tr>`);
        allRowsHtml.push(`
            <tr id="${groupUid}" class="accordion-content-row" style="display: none;">
                <td colspan="6"><div class="nested-content-container" data-loaded="false" data-owner-key="${ownerKey}"><div class="p-3 text-muted text-center"><i class="fas fa-spinner fa-spin"></i> Veriler hazırlanıyor...</div></div></td>
            </tr>`);
    }
    
    tbody.innerHTML = allRowsHtml.join('');
    attachGenerateReportListener();
    attachLazyLoadListeners();
};

const attachLazyLoadListeners = () => {
    const tbody = document.getElementById('monitoringListBody');
    if (tbody._lazyLoadAttached) return;
    tbody._lazyLoadAttached = true;
    tbody.addEventListener('click', (e) => {
        const currentGroupedData = tbody._currentGroupedData || {};
        if (e.target.closest('.action-btn, button, a')) return;
        const headerRow = e.target.closest('.owner-row');
        if (!headerRow) return;
        const targetId = headerRow.dataset.target || '#' + headerRow.getAttribute('aria-controls');
        const contentRow = document.querySelector(targetId);
        if (!contentRow) return;
        const isExpanded = headerRow.getAttribute('aria-expanded') === 'true';
        contentRow.style.display = isExpanded ? 'none' : 'table-row';
        headerRow.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
        const icon = headerRow.querySelector('.toggle-icon');
        if (icon) { icon.classList.toggle('fa-chevron-up', !isExpanded); icon.classList.toggle('fa-chevron-down', isExpanded); }

        if (!isExpanded) {
            const container = contentRow.querySelector('.nested-content-container');
            if (container && container.dataset.loaded === 'false') {
                const group = currentGroupedData[container.dataset.ownerKey];
                if (group && group.trademarks) {
                    container.innerHTML = `<table class="table table-sm nested-table"><thead><tr><th></th><th class="col-nest-img">Görsel</th><th class="col-nest-name">Marka Adı</th><th class="col-nest-appno">Başvuru No</th><th class="col-nest-nice">Nice Sınıfı</th><th class="col-nest-date">B. Tarihi</th></tr></thead><tbody>
                            ${group.trademarks.map(({ tm, ip }) => {
                            const [name, rawImg, appNo, nices, date] = [_pickName(ip, tm), _pickImg(ip, tm), _pickAppNo(ip, tm), _uniqNice(ip || tm), _pickAppDate(ip, tm)];
                            const img = _normalizeImageSrc(rawImg); // 🔥 DÜZELTME: Link formata çevrildi
                            
                            return `<tr class="trademark-detail-row"><td class="td-nested-toggle"></td><td class="td-nested-img">${img ? `<div class="tm-img-box tm-img-box-sm"><img class="trademark-image-thumbnail-large" src="${img}" loading="lazy" alt="Marka"></div>` : `<div class="tm-img-box tm-img-box-sm tm-placeholder left-panel-lazy-img" data-appno="${appNo}">-</div>`}</td><td class="td-nested-name"><strong>${name}</strong></td><td class="td-nested-appno">${appNo}</td><td class="td-nested-nice">${nices || '-'}</td><td class="td-nested-date">${date}</td></tr>`;
                        }).join('')}</tbody></table>`;
                    container.dataset.loaded = 'true';

                    // 🔥 DÜZELTME: Sol paneldeki eksik resimleri arka planda Supabase'den çek
                    setTimeout(() => {
                        container.querySelectorAll('.left-panel-lazy-img').forEach(async (el) => {
                            const appNo = el.dataset.appno;
                            if (appNo && appNo !== '-') {
                                try {
                                    const fetchedUrl = await _getBrandImageByAppNo(appNo);
                                    if (fetchedUrl) {
                                        el.parentElement.innerHTML = `<div class="tm-img-box tm-img-box-sm"><img class="trademark-image-thumbnail-large" src="${fetchedUrl}" loading="lazy" alt="Marka"></div>`;
                                    }
                                } catch (e) {}
                            }
                        });
                    }, 50);
                }
            }
        }
    });
};

const createResultRow = (hit, rowIndex) => {
    const holders = Array.isArray(hit.holders) ? hit.holders.map(h => h.name || h.id || h).filter(Boolean).join(', ') : (hit.holders || '');
    const monitoredTrademark = monitoringTrademarks.find(tm => tm.id === (hit.monitoredTrademarkId || hit.monitoredMarkId)) || {};
    const resultClasses = normalizeNiceList(hit.niceClasses);
    let goodsAndServicesClasses = normalizeNiceList(getNiceClassNumbers(monitoredTrademark));
    if (goodsAndServicesClasses.length === 0) goodsAndServicesClasses = normalizeNiceList(monitoredTrademark?.niceClasses || _uniqNice(monitoredTrademark));
    
    const greenSet = new Set(goodsAndServicesClasses);
    const orangeSet = new Set(normalizeNiceList(monitoredTrademark?.niceClassSearch || []));
    const blueSet = new Set();
    greenSet.forEach(c => { if (RELATED_CLASSES_MAP[c]) RELATED_CLASSES_MAP[c].forEach(rel => blueSet.add(rel)); });
    greenSet.forEach(c => { orangeSet.delete(c); blueSet.delete(c); });
    orangeSet.forEach(c => blueSet.delete(c));

    const niceClassHtml = [...new Set(resultClasses)].map(cls => {
        let colorCat = 'gray';
        if (greenSet.has(cls)) colorCat = 'green'; else if (orangeSet.has(cls)) colorCat = 'orange'; else if (blueSet.has(cls)) colorCat = 'blue';
        let style = "background-color: #e9ecef; color: #495057; border: 1px solid #ced4da;";
        if (colorCat === 'green') style = "background-color: #28a745; color: white; border: 1px solid #28a745;"; 
        else if (colorCat === 'orange') style = "background-color: #fd7e14; color: white; border: 1px solid #fd7e14;"; 
        else if (colorCat === 'blue') style = "background-color: #0dcaf0; color: white; border: 1px solid #0dcaf0;"; 
        return `<span class="nice-class-badge" style="border-radius: 4px; padding: 3px 7px; margin-right: 4px; font-weight: 600; font-size: 0.85em; display: inline-block; ${style}">${cls}</span>`;
    }).join('');

    const row = document.createElement('tr');
    const minimalHitData = JSON.stringify({ imagePath: hit.imagePath, brandImageUrl: hit.brandImageUrl, applicationNo: hit.applicationNo });

    row.innerHTML = `
        <td>${rowIndex}</td>
        <td><button class="action-btn ${hit.isSimilar ? 'similar' : 'not-similar'}" data-result-id="${hit.id || hit.applicationNo}" data-monitored-trademark-id="${hit.monitoredTrademarkId}">${hit.isSimilar ? 'Benzer' : 'Benzemez'}</button></td>
        <td class="trademark-image-cell lazy-load-container" data-hit-data='${minimalHitData}'><div class="tm-img-box tm-img-box-lg"><div class="tm-placeholder"><i class="fas fa-spinner fa-spin text-muted"></i></div></div></td>
        <td><strong>${hit.markName || '-'}</strong></td>
        <td>${holders}</td>
        <td>${niceClassHtml}</td>
        <td>${hit.applicationNo ? `<a href="#" class="tp-appno-link" onclick="event.preventDefault(); window.queryApplicationNumberWithExtension('${hit.applicationNo}');">${hit.applicationNo}</a>` : '-'}</td>
        <td>${hit.similarityScore ? `${(hit.similarityScore * 100).toFixed(0)}%` : '-'}</td>
        <td><select class="bs-select" data-result-id="${hit.id || hit.applicationNo}"><option value="">B.Ş</option>${['%0', '%20', '%30', '%40', '%45', '%50', '%55', '%60', '%70', '%80'].map(val => `<option value="${val}" ${hit.bs === val ? 'selected' : ''}>${val}</option>`).join('')}</select></td>
        <td class="note-cell" data-result-id="${hit.id || hit.applicationNo}"><div class="note-cell-content"><span class="note-icon">📝</span>${hit.note ? `<span class="note-text">${hit.note}</span>` : `<span class="note-placeholder">Not ekle</span>`}</div></td>
    `;
    const imgContainer = row.querySelector('.lazy-load-container');
    if (imgContainer) imageObserver.observe(imgContainer);
    return row;
};

const renderCurrentPageOfResults = () => {
    const resultsTableBody = document.getElementById('resultsTableBody');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    if (!pagination || !resultsTableBody) return;
    
    resultsTableBody.innerHTML = '';
    const visibleMonitoredIds = new Set(filteredMonitoringTrademarks.map(tm => tm.id));
    let filteredResults = allSimilarResults.filter(r => visibleMonitoredIds.has(r.monitoredTrademarkId));
    if (selectedMonitoredTrademarkId) filteredResults = filteredResults.filter(r => r.monitoredTrademarkId === selectedMonitoredTrademarkId);
    if (similarityFilter === 'similar') filteredResults = filteredResults.filter(r => r.isSimilar === true);
    else if (similarityFilter === 'not-similar') filteredResults = filteredResults.filter(r => r.isSimilar !== true);

    updateFilterInfo(filteredResults.length);
    pagination.update(filteredResults.length);
    const currentPageData = pagination.getCurrentPageData(filteredResults);

    if (currentPageData.length === 0) {
        if (noRecordsMessage) { noRecordsMessage.textContent = 'Arama sonucu bulunamadı.'; noRecordsMessage.style.display = 'block'; }
        return;
    }
    if (noRecordsMessage) noRecordsMessage.style.display = 'none';

    const groupMap = {}; const groups = [];
    currentPageData.forEach(hit => {
        const key = hit.monitoredTrademarkId || 'unknown';
        if (groupMap[key] === undefined) { groupMap[key] = groups.length; groups.push({ key: key, results: [] }); }
        groups[groupMap[key]].results.push(hit);
    });

    let globalRowIndex = pagination.getStartIndex();
    groups.forEach(group => {
        const tmMeta = monitoringTrademarks.find(t => String(t.id) === String(group.key));
        if (!tmMeta) {
            const header = document.createElement('tr'); header.className = 'group-header';
            header.innerHTML = `<td colspan="10"><div class="group-title"><span><strong>${group.results[0]?.monitoredTrademark || 'Bilinmeyen'}</strong> sonuçları (${group.results.length})</span></div></td>`;
            resultsTableBody.appendChild(header);
            group.results.forEach(hit => { globalRowIndex++; resultsTableBody.appendChild(createResultRow(hit, globalRowIndex)); });
            return;
        }

        const [headerName, rawHeaderImg, appNo] = [_pickName(null, tmMeta), _pickImg(null, tmMeta), _pickAppNo(null, tmMeta)];
        const headerImg = _normalizeImageSrc(rawHeaderImg); // 🔥 DÜZELTME: Link formata çevrildi
        const modalData = { id: tmMeta.id, ipRecordId: tmMeta.ipRecordId, markName: headerName, applicationNumber: appNo, owner: tmMeta.ownerName, niceClasses: getNiceClassNumbers(tmMeta), brandImageUrl: headerImg, brandTextSearch: tmMeta.brandTextSearch || [], niceClassSearch: tmMeta.niceClassSearch || [] };
        const imageHtml = headerImg ? `<div class="group-trademark-image"><div class="tm-img-box tm-img-box-sm"><img src="${headerImg}" class="group-header-img"></div></div>` : `<div class="group-trademark-image" data-header-appno="${appNo}"><div class="tm-img-box tm-img-box-sm tm-placeholder">?</div></div>`;
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.className = 'group-header';
        groupHeaderRow.dataset.markData = JSON.stringify(modalData);
        groupHeaderRow.innerHTML = `<td colspan="10"><div class="group-title">${imageHtml}<span><a href="#" class="edit-criteria-link" data-tmid="${tmMeta.id}"><strong>${headerName}</strong></a> <small style="color:#666;">— ${tmMeta.ownerName || '-'}</small> — bulunan sonuçlar (${getTotalCountForMonitoredId(group.key)} adet)</span></div></td>`;
        
        resultsTableBody.appendChild(groupHeaderRow);
        group.results.forEach(hit => { globalRowIndex++; resultsTableBody.appendChild(createResultRow(hit, globalRowIndex)); });
    });

    setTimeout(() => {
        document.querySelectorAll('.group-trademark-image[data-header-appno]').forEach(async (container) => {
            const appNo = container.dataset.headerAppno;
            if (appNo && appNo !== '-') {
                try { const imgUrl = await _getBrandImageByAppNo(appNo); if (imgUrl) { container.innerHTML = `<div class="tm-img-box tm-img-box-sm"><img src="${imgUrl}" class="group-header-img"></div>`; container.removeAttribute('data-header-appno'); } } catch (e) {}
            }
        });
    }, 100);
    attachEventListeners();
};

const updateFilterInfo = (resultCount) => {
    const info = document.getElementById('selectedTrademarkInfo');
    const filteredResultCount = document.getElementById('filteredResultCount');
    if (filteredResultCount) filteredResultCount.textContent = resultCount;
    if (selectedMonitoredTrademarkId && info) {
        const tm = monitoringTrademarks.find(tm => tm.id === selectedMonitoredTrademarkId);
        document.getElementById('selectedTrademarkName').textContent = `"${tm?.title || tm?.markName || 'Bilinmeyen'}"`;
        info.style.display = 'flex';
    } else if (info) info.style.display = 'none';
};

const initializePagination = () => { if (!pagination) pagination = new Pagination({ containerId: 'paginationContainer', itemsPerPage: 10, onPageChange: (page, itemsPerPage) => { renderCurrentPageOfResults(); tssSaveState(tssBuildStateFromUI({ page, itemsPerPage, totalResults: allSimilarResults.length })); } }); };
const initializeMonitoringPagination = () => { if (!monitoringPagination) monitoringPagination = new Pagination({ containerId: 'monitoringPaginationContainer', itemsPerPage: 5, onPageChange: () => renderMonitoringList() }); };
const updateMonitoringCount = () => {
    // Döngüye girmek yerine hazır gruplanmış verinin sayısını alıyoruz
    const ownerCount = cachedGroupedData ? Object.keys(cachedGroupedData).length : 0;
    document.getElementById('monitoringCount').textContent = `${ownerCount} Sahip (${filteredMonitoringTrademarks.length} Marka)`;
};

const updateOwnerBasedPagination = () => {
    const ownerCount = cachedGroupedData ? Object.keys(cachedGroupedData).length : 0;
    monitoringPagination.update(ownerCount);
    monitoringPagination.reset();
};

const applyMonitoringListFilters = () => {
    const [ownerFilter, niceFilter, brandFilter] = [
        document.getElementById('ownerSearch')?.value || '', 
        document.getElementById('niceClassSearch')?.value || '', 
        document.getElementById('brandNameSearch')?.value || ''
    ].map(s => s.toLowerCase().trim());
    
    filteredMonitoringTrademarks = monitoringTrademarks.filter(data => {
        // 🚀 Her seferinde .toLowerCase() hesaplamak yerine peşin hesaplanmış özellikleri kullanır (0 milisaniye)
        return (!ownerFilter || data._searchOwner.includes(ownerFilter)) && 
               (!niceFilter || data._searchNice.includes(niceFilter)) && 
               (!brandFilter || data._searchBrand.includes(brandFilter));
    });
    
    cachedGroupedData = null; 
    renderMonitoringList(); 
    updateMonitoringCount(); 
    updateOwnerBasedPagination(); 
    
    // 🔥 AĞIR DB SORGUSU YAPAN FONKSİYON SİLİNDİ. Sadece butonların disable/enable durumunu UI üzerinden çözüyoruz.
    const startSearchBtn = document.getElementById('startSearchBtn');
    const btnGenerateReport = document.getElementById('btnGenerateReportAndNotifyGlobal');
    if (filteredMonitoringTrademarks.length === 0) {
        if (startSearchBtn) startSearchBtn.disabled = true;
        if (btnGenerateReport) btnGenerateReport.disabled = true;
    } else {
        const bulletinSelect = document.getElementById('bulletinSelect');
        if (bulletinSelect?.value && startSearchBtn && allSimilarResults.length === 0) {
            const hasOriginal = bulletinSelect.options[bulletinSelect.selectedIndex]?.dataset?.hasOriginalBulletin === 'true';
            startSearchBtn.disabled = !hasOriginal;
        }
    }
    
    if (pagination) { pagination.goToPage(1); renderCurrentPageOfResults(); }
};

const loadInitialData = async () => {
    await loadSharedLayout({ activeMenuLink: 'trademark-similarity-search.html' });
    
    const { data: personsResult } = await supabase.from('persons').select('*');
    if (personsResult) allPersons = personsResult;
    
    await loadBulletinOptions();

    const { data: monitoringData } = await supabase.from('monitoring_trademarks').select('*');

    const ensureArray = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
        return [val];
    };

    if (monitoringData) {
        monitoringTrademarks = monitoringData.map(d => {
            const tmData = {
                id: d.id, title: d.mark_name, markName: d.mark_name, applicationNo: d.application_no, 
                applicationNumber: d.application_no, ipRecordId: d.ip_record_id, ownerName: d.owner_name,
                brandTextSearch: ensureArray(d.brand_text_search), niceClassSearch: ensureArray(d.nice_class_search),
                niceClasses: ensureArray(d.nice_classes), imagePath: d.image_path, 
                applicants: d.owner_name ? [{ name: d.owner_name }] : []
            };
            
            let ownerName = d.owner_name && d.owner_name.trim() !== '' && d.owner_name !== '-' ? d.owner_name : 'Bilinmeyen Sahip';
            let ownerId = d.ip_record_id || `owner_${ownerName.toLowerCase().replace(/[^a-z0-9]/gi, '').substring(0, 20)}`;
            tmData.ownerInfo = { key: ownerId, id: ownerId, name: ownerName };
            
            // 🔥 SÜPER HIZLANDIRICI: Filtre aramaları için her şeyi en baştan hesapla ve küçük harfle kaydet
            tmData._searchOwner = ownerName.toLowerCase();
            tmData._searchNice = _uniqNice(tmData).toLowerCase();
            tmData._searchBrand = (tmData.title || tmData.markName || '').toLowerCase();
            
            return tmData;
        });
    }

    filteredMonitoringTrademarks = [...monitoringTrademarks];
    initializeMonitoringPagination(); 
    cachedGroupedData = null; 
    renderMonitoringList(); 
    updateMonitoringCount(); 
    updateOwnerBasedPagination();
    
    const bs = document.getElementById('bulletinSelect');
    if (bs?.value) { 
        const bNo = String(bs.value).split('_')[0]; 
        if (bNo) { await refreshTriggeredStatus(bNo); renderMonitoringList(); } 
    }
};

const loadBulletinOptions = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    bulletinSelect.innerHTML = '<option value="">Bülten seçin...</option>';
    
    const { data: registeredData } = await supabase.from('trademark_bulletins').select('*').order('bulletin_no', { ascending: false });
    // Eski tablo yerine arama geçmişinden (search_progress) tamamlanmışları çekiyoruz
    const { data: cacheData } = await supabase.from('search_progress').select('bulletin_id').eq('status', 'completed');
    
    const allBulletins = new Map();
    
    if (registeredData) {
        registeredData.forEach(data => {
            const bulletinKey = `${data.bulletin_no}_${(data.bulletin_date || '').replace(/\D/g, '')}`;
            allBulletins.set(bulletinKey, { bulletinNo: data.bulletin_no, bulletinKey, hasOriginalBulletin: true, displayName: `${data.bulletin_no} - ${data.bulletin_date || ''} (Kayıtlı)` });
        });
    }
    
    if (cacheData) {
        cacheData.forEach(rec => {
            if(!rec.bulletin_id || String(rec.bulletin_id).includes('GLOBAL')) return;

            const parts = String(rec.bulletin_id).split('_');
            const normalizedKey = `${parts[0]}_${(parts[1] || '').replace(/\D/g, '')}`;
            
            if (!allBulletins.has(normalizedKey)) {
                allBulletins.set(normalizedKey, { 
                    bulletinNo: parts[0], 
                    bulletinKey: normalizedKey, 
                    hasOriginalBulletin: false, 
                    displayName: `${parts[0]} (Bellek)` 
                });
            }
        });
    }

    Array.from(allBulletins.values()).sort((a, b) => parseInt(b.bulletinNo || 0) - parseInt(a.bulletinNo || 0)).forEach(bulletin => {
        const option = document.createElement('option');
        option.value = bulletin.bulletinKey; option.dataset.hasOriginalBulletin = bulletin.hasOriginalBulletin; option.textContent = bulletin.displayName;
        bulletinSelect.appendChild(option);
    });
};

const formatCacheData = (r) => ({
    id: r.id, objectID: r.id, applicationNo: r.similar_application_no, markName: r.similar_mark_name,
    monitoredTrademarkId: r.monitored_trademark_id, niceClasses: r.nice_classes, similarityScore: parseFloat(r.similarity_score || 0),
    isSimilar: r.is_similar, holders: r.holders, note: r.note, bs: r.bs_value, imagePath: r.image_path, source: 'cache'
});

const loadDataFromCache = async (bulletinKey) => {
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    
    try {
        const { count, error: countErr } = await supabase
            .from('monitoring_trademark_records')
            .select('*', { count: 'exact', head: true })
            .eq('bulletin_id', bulletinKey);

        if (countErr) throw countErr;

        let cachedResults = [];

        if (count > 0) {
            const limit = 20000;
            const fetchPromises = [];
            
            for (let offset = 0; offset < count; offset += limit) {
                fetchPromises.push(
                    supabase.from('monitoring_trademark_records')
                    .select('*')
                    .eq('bulletin_id', bulletinKey)
                    .range(offset, offset + limit - 1)
                );
            }

            const responses = await Promise.all(fetchPromises);
            
            responses.forEach(res => {
                if (res.data && res.data.length > 0) {
                    const mappedData = res.data.map(item => ({
                        id: item.id,
                        objectID: item.id,
                        monitoredTrademarkId: item.monitored_trademark_id,
                        markName: item.similar_mark_name,
                        applicationNo: item.similar_application_no,
                        niceClasses: item.nice_classes,
                        similarityScore: item.similarity_score,
                        holders: item.holders,
                        imagePath: item.image_path,
                        bulletinId: item.bulletin_id,
                        
                        // 🔥 İŞTE SORUNUN ÇÖZÜMÜ BURASI:
                        // Veritabanındaki 'is_similar' değerini alıp arayüze 'isSimilar' olarak öğretiyoruz.
                        // Eğer değer false değilse (true veya undefined ise) her zaman "Benzer" (true) kabul et!
                        isSimilar: item.is_similar === true, 
                        
                        bs: item.bs_value || '', 
                        note: item.note || '',   
                        source: 'cache'
                    }));
                    cachedResults = cachedResults.concat(mappedData);
                }
            });
        }

        allSimilarResults = cachedResults;
        
        if (infoMessageContainer) {
            infoMessageContainer.innerHTML = cachedResults.length > 0 
                ? `<div class="info-message success">Önbellekten ${cachedResults.length} benzer sonuç ışık hızında yüklendi.</div>` 
                : '';
        }
        
        if (noRecordsMessage) {
            noRecordsMessage.style.display = cachedResults.length > 0 ? 'none' : 'block';
        }
        
        await groupAndSortResults();
        
        if (pagination) pagination.update(allSimilarResults.length);
        renderCurrentPageOfResults();
        
    } catch (error) {
        console.error("Önbellekten veri yüklenirken hata:", error);
    }
};

const checkCacheAndToggleButtonStates = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const infoMessageContainer = document.getElementById('infoMessageContainer');

    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) {
        if (startSearchBtn) startSearchBtn.disabled = true;
        if (researchBtn) researchBtn.disabled = true;
        if (infoMessageContainer) infoMessageContainer.innerHTML = '';
        if (btnGenerateReportAndNotifyGlobal) btnGenerateReportAndNotifyGlobal.disabled = true;
        return;
    }

    if (SimpleLoading) {
        SimpleLoading.show({
            text: 'Bülten Sorgulanıyor',
            subtext: 'Önbellekteki veriler kontrol ediliyor...'
        });
    }

    try {
        const selectedOption = bulletinSelect.options[bulletinSelect.selectedIndex];
        const hasOriginalBulletin = selectedOption?.dataset?.hasOriginalBulletin === 'true';
        
        // Supabase Kalıcı Tabloda bu bültene ait kayıt var mı diye sadece 1 kayıt çekerek kontrol et
        const { data, error } = await supabase
            .from('monitoring_trademark_records')
            .select('id')
            .eq('bulletin_id', bulletinKey)
            .limit(1);

        const hasCache = data && data.length > 0;

        if (hasCache) {
            await loadDataFromCache(bulletinKey);
            
            if (startSearchBtn) startSearchBtn.disabled = true;
            if (researchBtn) researchBtn.disabled = !hasOriginalBulletin;
            if (btnGenerateReportAndNotifyGlobal) btnGenerateReportAndNotifyGlobal.disabled = allSimilarResults.length === 0;
            
            const messageType = hasOriginalBulletin ? 'success' : 'warning';
            const messageText = hasOriginalBulletin ? 
                'Bu bülten sistemde kayıtlı. Önbellekten sonuçlar yüklendi.' : 
                'Bu bülten sistemde kayıtlı değil. Sadece eski arama sonuçları gösterilmektedir.';
            
            if (infoMessageContainer) infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
        } else {
            if (startSearchBtn) startSearchBtn.disabled = !hasOriginalBulletin;
            if (researchBtn) researchBtn.disabled = true;
            if (btnGenerateReportAndNotifyGlobal) btnGenerateReportAndNotifyGlobal.disabled = true;
            
            const messageType = hasOriginalBulletin ? 'info' : 'error';
            const messageText = hasOriginalBulletin ? 
                'Önbellekte veri bulunamadı. "Arama Başlat" butonuna tıklayarak arama yapabilirsiniz.' : 
                'Bu bülten sistemde kayıtlı değil ve arama sonucu da bulunamadı.';
                
            if (infoMessageContainer) infoMessageContainer.innerHTML = `<div class="info-message ${messageType}"><strong>Bilgi:</strong> ${messageText}</div>`;
            
            allSimilarResults = [];
            if (pagination) pagination.update(0);
            renderCurrentPageOfResults();
        }
    } catch (error) {
        console.error('Cache check error:', error);
        if (infoMessageContainer) infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> Bülten bilgileri kontrol edilirken bir hata oluştu.</div>`;
    } finally {
        if (SimpleLoading) SimpleLoading.hide();
    }
};

const performSearch = async () => {
    const bulletinSelect = document.getElementById('bulletinSelect');
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const btnGenerateReportAndNotifyGlobal = document.getElementById('btnGenerateReportAndNotifyGlobal');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const infoMessageContainer = document.getElementById('infoMessageContainer');
    const resultsTableBody = document.getElementById('resultsTableBody');

    const bulletinKey = bulletinSelect.value;
    if (!bulletinKey || filteredMonitoringTrademarks.length === 0) return;
    
    SimpleLoading.show('Arama başlatılıyor...', 'Lütfen bekleyin...');

    setTimeout(() => {
        const loadingContent = document.querySelector('.simple-loading-content');
        if (loadingContent) {
            loadingContent.style.top = '80px';
            loadingContent.style.right = '20px';
            loadingContent.style.left = 'auto';
            loadingContent.style.transform = 'none';
        }
    }, 100);

    if (noRecordsMessage) noRecordsMessage.style.display = 'none';
    infoMessageContainer.innerHTML = '';
    resultsTableBody.innerHTML = '';
    allSimilarResults = [];
    
    const monitoredMarksPayload = filteredMonitoringTrademarks.map(tm => {
        // 🔥 DÜZELTME: applicationDate'i ipRecord'dan çek ve Edge Function için ISO formatına çevir
        let appDate = tm.ipRecord?.applicationDate || tm.applicationDate || null;
        let formattedDate = null;
        
        if (appDate) {
            if (typeof appDate === 'object' && typeof appDate.toDate === 'function') {
                formattedDate = appDate.toDate().toISOString(); // Firestore Timestamp -> String
            } else if (appDate instanceof Date) {
                formattedDate = appDate.toISOString(); // JS Date -> String
            } else {
                formattedDate = String(appDate); // Zaten String ise
            }
        }

        return {
            id: tm.id,
            markName: (tm.title || tm.markName || '').trim() || 'BELİRSİZ_MARKA',
            searchMarkName: tm.searchMarkName || '', 
            brandTextSearch: tm.brandTextSearch || [], 
            niceClassSearch: tm.niceClassSearch || [],
            goodsAndServicesByClass: tm.goodsAndServicesByClass || [],
            applicationDate: formattedDate // <--- KRİTİK EKSİK BURASIYDI, EKLENDİ
        };
    });

    try {
        const onProgress = (pd) => {
            if (pd.status === 'downloading') {
                 SimpleLoading.update(
                    `Sonuçlar İndiriliyor...`, 
                    `Alınan Kayıt: ${pd.message.split('...')[1] || ''}`
                );
            } else {
                SimpleLoading.update(
                    `Bülten Taranıyor... %${pd.progress || 0}`, 
                    `Tespit Edilen Benzerlik: ${pd.currentResults || 0} adet`
                );
            }
        };

        const resultsFromCF = await runTrademarkSearch(monitoredMarksPayload, bulletinKey, onProgress);
        
        if (resultsFromCF?.length > 0) {
            const processedResults = resultsFromCF.map(hit => ({ ...hit,
                source: 'new',
                isSimilar: false, // 🔥 YENİ EKLENEN SATIR: Yeni aramalarda gelen sonuçların hepsi "Benzemez" butonuna sahip olur.
                monitoredTrademark: filteredMonitoringTrademarks.find(tm => tm.id === hit.monitoredTrademarkId)?.title || hit.markName
            }));

            resultsFromCF.length = 0; 

            const groupedResults = processedResults.reduce((acc, r) => {
                const key = r.monitoredTrademarkId;
                (acc[key] = acc[key] || []).push(r);
                return acc;
            }, {});

            allSimilarResults = processedResults;

            const entries = Object.entries(groupedResults);
            const SAVE_BATCH_SIZE = 25; 
            const DELAY_MS = 1000;
            
            SimpleLoading.updateText('Sonuçlar Kaydediliyor...', `0 / ${entries.length} marka grubu`);

            for (let i = 0; i < entries.length; i += SAVE_BATCH_SIZE) {
                const chunk = entries.slice(i, i + SAVE_BATCH_SIZE);
                
                await Promise.all(chunk.map(async ([monitoredTrademarkId, results]) => {
                     try {
                        await searchRecordService.saveRecord(bulletinKey, monitoredTrademarkId, {
                            results,
                            searchDate: new Date().toISOString()
                        });
                     } catch (saveErr) {
                         console.warn(`Kayıt uyarısı (${monitoredTrademarkId}):`, saveErr);
                     }
                }));

                await new Promise(r => setTimeout(r, DELAY_MS));

                SimpleLoading.updateText(
                    'Sonuçlar Kaydediliyor...', 
                    `${Math.min(i + SAVE_BATCH_SIZE, entries.length)} / ${entries.length} marka grubu`
                );
            }
        }
    } catch (error) {
        console.error("Arama hatası:", error);
        infoMessageContainer.innerHTML = `<div class="info-message error"><strong>Hata:</strong> ${error.message}</div>`;
    } finally {
        SimpleLoading.hide();
        await groupAndSortResults();
        
        if (allSimilarResults.length > 0) {
            infoMessageContainer.innerHTML = `<div class="info-message success">Toplam ${allSimilarResults.length} benzer sonuç bulundu.</div>`;
            startSearchBtn.disabled = true;
            researchBtn.disabled = false;
            btnGenerateReportAndNotifyGlobal.disabled = false;
            if (noRecordsMessage) noRecordsMessage.style.display = 'none';
        } else {
            if (noRecordsMessage) {
                noRecordsMessage.textContent = 'Arama sonucu bulunamadı.';
                noRecordsMessage.style.display = 'block';
            }
            startSearchBtn.disabled = false;
            researchBtn.disabled = true;
            btnGenerateReportAndNotifyGlobal.disabled = true;
        }
        
        if (pagination) pagination.update(allSimilarResults.length);
        renderCurrentPageOfResults();
    }
};

const performResearch = async () => {
    const bulletinKey = document.getElementById('bulletinSelect').value;
    if (!bulletinKey) return;
    SimpleLoading.show('Hazırlanıyor...', 'Önbellek temizleniyor...');
    await supabase.from('search_results_cache').delete().eq('bulletin_key', bulletinKey);
    await performSearch();
};

const groupAndSortResults = async () => {
    if (!allSimilarResults || allSimilarResults.length === 0) return;
    const uniqueMap = new Map();
    allSimilarResults.forEach(result => {
        const uniqueKey = `${result.monitoredTrademarkId}_${result.applicationNo || result.objectID || 'unknown'}`;
        if (!uniqueMap.has(uniqueKey)) uniqueMap.set(uniqueKey, { ...result });
        else {
            const existing = uniqueMap.get(uniqueKey);
            if ((result.similarityScore || 0) > (existing.similarityScore || 0)) existing.similarityScore = result.similarityScore;
            const c1 = String(existing.niceClasses || '').split(/[,\s]+/).filter(Boolean);
            const c2 = String(result.niceClasses || '').split(/[,\s]+/).filter(Boolean);
            existing.niceClasses = [...new Set([...c1, ...c2])].join(', ');
        }
    });
    allSimilarResults = Array.from(uniqueMap.values());
    const groupedByTrademark = allSimilarResults.reduce((acc, result) => {
        const id = String(result.monitoredTrademarkId || 'unknown'); 
        if (!acc[id]) acc[id] = []; acc[id].push(result); return acc;
    }, {});
    const sortDataMap = new Map();
    Object.keys(groupedByTrademark).forEach(id => {
        const tm = monitoringTrademarks.find(t => String(t.id) === String(id));
        sortDataMap.set(id, { ownerName: tm ? (_getOwnerKey(tm.ipRecord || null, tm, allPersons).name.toLowerCase()) : 'zzzzzzzz', markName: (tm?.title || tm?.markName || '').toLowerCase() });
    });
    const sortedIds = Object.keys(groupedByTrademark).sort((idA, idB) => {
        const dA = sortDataMap.get(idA); const dB = sortDataMap.get(idB);
        const ownerComp = dA.ownerName.localeCompare(dB.ownerName, 'tr-TR');
        return ownerComp !== 0 ? ownerComp : dA.markName.localeCompare(dB.markName, 'tr-TR');
    });
    allSimilarResults = sortedIds.flatMap(id => groupedByTrademark[id].sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0)));
};

const handleSimilarityToggle = async (event) => {
    const btn = event.target;
    const { resultId } = btn.dataset;
    
    const currentHit = allSimilarResults.find(r => r.objectID === resultId || r.id === resultId);
    if (!currentHit) return;

    // 🔥 DÜZELTME 2: Ağ isteği bitene kadar butonu pasife al (Çift tıklama koruması)
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        // Eğer false ise true, true/undefined ise false yap
        const newStatus = currentHit.isSimilar === false ? true : false;
        
        const { error } = await supabase
            .from('monitoring_trademark_records')
            .update({ is_similar: newStatus })
            .eq('id', resultId);
        
        if (!error) {
            // Arayüz verisini güncelle
            currentHit.isSimilar = newStatus;
            
            // Butonun görüntüsünü yenile
            btn.textContent = newStatus ? 'Benzer' : 'Benzemez';
            btn.className = `action-btn ${newStatus ? 'similar' : 'not-similar'}`;
        } else {
            console.error("Güncelleme hatası:", error);
            showNotification('Durum güncellenemedi', 'error');
            // Hata olursa eski haline döndür
            btn.textContent = currentHit.isSimilar ? 'Benzer' : 'Benzemez';
        }
    } finally {
        // Butonu tekrar aktifleştir
        btn.disabled = false;
        btn.style.opacity = '1';
    }
};

const handleBsChange = async (event) => {
    const { resultId } = event.target.dataset;
    // 🔥 Eski tablo adı düzeltildi
    await supabase.from('monitoring_trademark_records').update({ bs_value: event.target.value }).eq('id', resultId);
};

const handleNoteCellClick = (cell) => {
    const { resultId } = cell.dataset;
    const currentNote = cell.querySelector('.note-text')?.textContent || '';
    const modal = document.getElementById('noteModal');
    const noteInput = document.getElementById('noteInputModal');
    noteInput.value = currentNote;
    
    document.getElementById('saveNoteBtn').onclick = async () => {
        // 🔥 Eski tablo adı düzeltildi
        const { error } = await supabase.from('monitoring_trademark_records').update({ note: noteInput.value }).eq('id', resultId);
        if (!error) {
            const hit = allSimilarResults.find(r => r.objectID === resultId || r.id === resultId);
            if (hit) hit.note = noteInput.value;
            cell.querySelector('.note-cell-content').innerHTML = `<span class="note-icon">📝</span><span class="${noteInput.value ? 'note-text' : 'note-placeholder'}">${noteInput.value || 'Not ekle'}</span>`;
            modal.classList.remove('show');
        } else { alert('Hata oluştu'); }
    };
    
    modal.classList.add('show');
    noteInput.focus();
};

// ============================================================================
// RAPOR OLUŞTURMA VE GÖREV TETİKLEME (SUPABASE YAMASI BURADA)
// ============================================================================

const buildReportData = async (results) => {
    const reportData = [];
    
    for (const r of results) {
        const monitoredTm = monitoringTrademarks.find(mt => mt.id === r.monitoredTrademarkId) || {};
        let ipData = null;
        let bulletinDateValue = "-";

        // 1. İlişkili IP Kaydını Çek (Supabase'den)
        const appNoToSearch = monitoredTm.applicationNumber || monitoredTm.applicationNo;
        if (appNoToSearch) {
            const { data: ipSnap } = await supabase.from('ip_records').select('*').eq('application_number', appNoToSearch).limit(1).single();
            if (ipSnap) ipData = ipSnap;
        }
        if (!ipData && (monitoredTm.ipRecordId || monitoredTm.sourceRecordId)) {
            const { data: ipDoc } = await supabase.from('ip_records').select('*').eq('id', monitoredTm.ipRecordId || monitoredTm.sourceRecordId).single();
            if (ipDoc) ipData = ipDoc;
        }

        // 1.5. Bültendeki Markanın (Hit) Tam Bilgisini Çek
        let hitHolders = r.holders || [];
        if (!hitHolders || hitHolders.length === 0) {
            const hitDocId = r.objectID || r.id; 
            if (hitDocId) {
                const { data: hitDoc } = await supabase.from('trademark_bulletin_records').select('holders').eq('id', hitDocId).single();
                if (hitDoc) hitHolders = hitDoc.holders || [];
            } else if (r.applicationNo) {
                const { data: hitSnap } = await supabase.from('trademark_bulletin_records').select('holders').eq('application_no', r.applicationNo).limit(1).single();
                if (hitSnap) hitHolders = hitSnap.holders || [];
            }
        }

        // 2. Bülten Tarihi
        if (r.bulletinId) {
            const parts = String(r.bulletinId).split('_');
            if (parts.length > 1 && parts[1].length >= 8) bulletinDateValue = parts[1].replace(/(\d{2})(\d{2})(\d{4})/, '$1.$2.$3');
            else bulletinDateValue = r.bulletinDate || "-";
        } else { bulletinDateValue = r.bulletinDate || "-"; }

        // 3. Sahip Bilgisi
        let ownerNameStr = "-";
        if (ipData?.applicants && typeof ipData.applicants === 'string') try { ipData.applicants = JSON.parse(ipData.applicants); } catch(e){}
        if (ipData?.applicants && Array.isArray(ipData.applicants) && ipData.applicants.length > 0) {
            ownerNameStr = ipData.applicants.map(a => a.name || a.companyName || a.id).join(", ");
        } else {
            ownerNameStr = _pickOwners(ipData, monitoredTm, allPersons) || monitoredTm?.ownerName || "-";
        }
        const monitoredClientId = _getOwnerKey(ipData, monitoredTm, allPersons).id;

        // 4. Diğer Bilgiler
        const monitoredName = ipData?.title || ipData?.mark_name || monitoredTm?.title || monitoredTm?.markName || "Marka Adı Yok";
        const monitoredImg = _normalizeImageSrc(monitoredTm?.imagePath || ipData?.image_path || '');
        const monitoredAppNo = ipData?.application_number || monitoredTm?.applicationNo || "-";
        const monitoredAppDate = _pickAppDate(ipData, monitoredTm);
        const monitoredClasses = _uniqNice(ipData || monitoredTm).split(', ');

        let hitOwnerStr = "-";
        if (Array.isArray(hitHolders) && hitHolders.length > 0) hitOwnerStr = hitHolders.map(h => h.name || h.holderName || h.id || h).filter(Boolean).join(', ');
        else if (typeof hitHolders === 'string' && hitHolders.trim() !== '') hitOwnerStr = hitHolders;

        reportData.push({
            monitoredMark: {
                clientId: monitoredClientId, name: monitoredName, markName: monitoredName, imagePath: monitoredImg,
                ownerName: ownerNameStr, applicationNo: monitoredAppNo, applicationDate: monitoredAppDate, niceClasses: monitoredClasses
            },
            similarMark: {
                name: r.markName, markName: r.markName, imagePath: _normalizeImageSrc(r.imagePath || ''), niceClasses: r.niceClasses || [],
                applicationNo: r.applicationNo || "-", applicationDate: r.applicationDate || "-", bulletinDate: bulletinDateValue,
                similarity: r.similarityScore, holders: hitHolders, ownerName: hitOwnerStr || "-", bs: r.bs || null, note: r.note || null
            }
        });
    }
    
    return reportData;
};
    

const createObjectionTasks = async (results, bulletinNo, ownerId = null) => {
    let createdTaskCount = 0;
    const { data: { session } } = await supabase.auth.getSession();
    const callerEmail = session?.user?.email || 'anonim@evreka.com';

    for (const r of results) {
        try {
            // Görevi oluştur (Supabase Edge Function)
            console.log(`⏳ ${r.markName} için itiraz görevi tetikleniyor...`);
            const { data: taskResponse, error: invokeError } = await supabase.functions.invoke('create-objection-task', {
                body: {
                    monitoredMarkId: r.monitoredTrademarkId,
                    similarMark: { applicationNo: r.applicationNo, markName: r.markName, niceClasses: r.niceClasses, similarityScore: r.similarityScore },
                    similarMarkName: r.markName, bulletinNo, callerEmail,
                    bulletinRecordData: {
                        bulletinId: r.bulletinId, bulletinNo: bulletinNo, markName: r.markName, applicationNo: r.applicationNo,
                        applicationDate: r.applicationDate, imagePath: r.imagePath, niceClasses: r.niceClasses, holders: r.holders || []
                    }
                }
            });

            if (invokeError) {
                console.error("❌ Fonksiyon Çalışma Hatası:", invokeError);
            } else if (!taskResponse?.success) {
                console.error("❌ Görev Oluşturulamadı:", taskResponse?.error);
            } else {
                console.log(`✅ Görev Başarıyla Oluştu: ${taskResponse.taskId}`);
                createdTaskCount++;
            }
        } catch (e) { console.error("❌ Beklenmeyen Hata:", e); }
    }
    return createdTaskCount;
};

const handleReportGeneration = async (event, options = {}) => {
    event.stopPropagation();
    const btn = event.currentTarget;
    const { ownerId, ownerName, createTasks = false, isGlobal = false } = options;
    
    const bulletinKey = document.getElementById('bulletinSelect')?.value;
    if (!bulletinKey) { showNotification('Lütfen bülten seçin.', 'error'); return; }
    const bulletinNo = String(bulletinKey).split('_')[0];

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> İşleniyor...';

        let filteredResults;
        if (isGlobal) {
            filteredResults = allSimilarResults.filter(r => r.isSimilar === true && r?.monitoredTrademarkId && r?.applicationNo && r?.markName);
        } else {
            const ownerMonitoredIds = [];
            for (const tm of monitoringTrademarks) {
                const ip = await _getIp(tm.ipRecordId || tm.sourceRecordId || tm.id);
                if (_getOwnerKey(ip, tm, allPersons).id === ownerId) ownerMonitoredIds.push(tm.id);
            }
            filteredResults = allSimilarResults.filter(r => ownerMonitoredIds.includes(r.monitoredTrademarkId) && r.isSimilar === true);
        }

        if (filteredResults.length === 0) {
            showNotification(isGlobal ? 'Benzer sonuç bulunamadı.' : `${ownerName} için benzer sonuç bulunamadı.`, 'warning'); return;
        }

        let createdTaskCount = 0;
        if (createTasks) createdTaskCount = await createObjectionTasks(filteredResults, bulletinNo, ownerId);

        const reportData = await buildReportData(filteredResults);

        // Supabase Edge Function çağrısı
        const { data: response, error } = await supabase.functions.invoke('generate-similarity-report', { 
            body: { results: reportData, bulletinNo: bulletinNo, isGlobalRequest: isGlobal }
        });

        if (error) throw error;

        if (response?.success) {
            const message = createTasks ? `Rapor oluşturuldu. ${createdTaskCount > 0 ? `Oluşturulan itiraz görevi: ${createdTaskCount} adet.` : ''}` : 'Rapor oluşturuldu.';
            showNotification(message, 'success');

            const blob = new Blob([Uint8Array.from(atob(response.file), c => c.charCodeAt(0))], { type: 'application/zip' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const safeDownloadName = (ownerName || 'Rapor').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 25);
            link.download = isGlobal ? `Toplu_Rapor.zip` : `${safeDownloadName}_Rapor.zip`;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);

            // 🔥 SUPABASE GÖREV YAMASI BAŞLANGICI
            if (createTasks) {
                for (const tmData of reportData) {
                    try {
                        const targetRecordId = filteredResults.find(r => r.monitoredTrademarkId)?.monitoredTrademarkId || null;
                        
                        // Önce Mail Taslağını Kaydet
                        const { data: mailData, error: mailError } = await supabase.from('mail_notifications').insert({
                            id: crypto.randomUUID(), 
                            record_id: targetRecordId,
                            subject: `Marka Bülten Benzerlik Bildirimi - ${tmData.monitoredMark?.name}`,
                            body: "Müvekkil raporu başarıyla oluşturuldu.",
                            status: "draft",
                            created_at: new Date().toISOString()
                        }).select('id').single();

                        if (mailError) throw mailError;

                        // type: 66 "Değerlendirme İşlemi" (Mail onayı) için task oluşturuyoruz
                        const taskPayload = {
                            title: `Bülten Benzerlik Bildirimi - ${tmData.monitoredMark?.name}`,
                            description: `Bülten İtiraz Süreci için benzerlik raporu hazırlandı. Taslak maili inceleyip müvekkile gönderiniz.`,
                            task_type: "66", 
                            status: "open",
                            priority: "high",
                            ip_record_id: targetRecordId,
                            iprecord_title: tmData.monitoredMark?.name,
                            mail_notification_id: mailData.id,
                            bulletin_no: bulletinNo,
                            assigned_to_user_id: "dqk6yRN7Kwgf6HIJldLt9Uz77RU2", // Selcan Hanım
                            assigned_to_email: "selcanakoglu@evrekapatent.com"
                        };

                        // `taskService.createTask` doğrudan SQL Sayaçları ve UUID ile uğraşır
                        await taskService.createTask(taskPayload);

                    } catch (e) { console.error("Görev oluşturma hatası:", e); }
                }

                await refreshTriggeredStatus(bulletinNo);
                await new Promise(resolve => setTimeout(resolve, 150));
                await renderMonitoringList();
            }
            // 🔥 SUPABASE GÖREV YAMASI BİTİŞİ
            
        } else {
            showNotification('Rapor oluşturma hatası.', 'error');
        }
    } catch (err) {
        showNotification('Kritik hata oluştu!', 'error');
    } finally {
        SimpleLoading.hide();
        btn.disabled = false;
        btn.innerHTML = createTasks ? '<i class="fas fa-paper-plane"></i> Rapor + Bildir' : '<i class="fas fa-file-pdf"></i> Rapor';
    }
};

const handleOwnerReportGeneration = async (event) => { const btn = event.currentTarget; await handleReportGeneration(event, { ownerId: btn.dataset.ownerId, ownerName: btn.dataset.ownerName, createTasks: false, isGlobal: false }); };
const handleOwnerReportAndNotifyGeneration = async (event) => { const btn = event.currentTarget; await handleReportGeneration(event, { ownerId: btn.dataset.ownerId, ownerName: btn.dataset.ownerName, createTasks: true, isGlobal: false }); };
const handleGlobalReportAndNotifyGeneration = async (event) => { await handleReportGeneration(event, { createTasks: true, isGlobal: true }); };

const addGlobalOptionToBulletinSelect = () => {
    const select = document.getElementById('bulletinSelect');
    if (!select || select.querySelector('option[value="' + MANUAL_COLLECTION_ID + '"]')) return;
    const opt = document.createElement('option');
    opt.value = MANUAL_COLLECTION_ID; opt.textContent = "🌍 YURTDIŞI / SERBEST KAYITLAR (Tümü)"; opt.style.fontWeight = "bold"; opt.style.color = "#d63384";
    if (select.options[0]) select.options[0].insertAdjacentElement('afterend', opt); else select.appendChild(opt);
};

const openManualEntryModal = () => {
    $('#addManualResultModal').modal('show');
    document.getElementById('manualTargetSearchInput').value = ''; document.getElementById('manualTargetId').value = '';
    document.getElementById('manualTargetSearchResults').style.display = 'none'; document.getElementById('manualTargetSelectedInfo').style.display = 'none';
    document.getElementById('tpSourceForm').style.display = 'block'; document.getElementById('manualSourceForm').style.display = 'none';
    document.getElementById('btnSaveManualResult').disabled = true; tpSearchResultData = null;
    const niceGrid = document.getElementById('manualNiceGrid'); niceGrid.innerHTML = '';
    for (let i = 1; i <= 45; i++) {
        const div = document.createElement('div'); div.className = 'nice-class-box-item'; div.textContent = i; div.dataset.classNo = i;
        div.onclick = function() { this.classList.toggle('selected'); }; niceGrid.appendChild(div);
    }
};

const updateManualFormUI = (selectedValue) => {
    document.getElementById('tpSourceForm').style.display = selectedValue === 'tp' ? 'block' : 'none';
    document.getElementById('manualSourceForm').style.display = selectedValue === 'manual' ? 'block' : 'none';
    document.getElementById('btnSaveManualResult').disabled = selectedValue === 'tp' ? !tpSearchResultData : false;
};

const queryTpRecordForManualAdd = async () => {
    const bNo = document.getElementById('tpSearchBulletinNo').value.trim();
    const appNo = document.getElementById('tpSearchAppNo').value.trim();
    if (!bNo || !appNo) return showNotification('Lütfen Kaynak Bülten No ve Başvuru No giriniz.', 'warning');
    
    SimpleLoading.show('Sorgulanıyor...', 'Veritabanında aranıyor...');
    try {
        const { data, error } = await supabase
            .from('trademark_bulletin_records')
            .select('*')
            .eq('bulletin_no', bNo)
            .ilike('application_no', `%${appNo}%`); 

        if (error) throw error;

        if (!data || data.length === 0) {
            SimpleLoading.hide(); 
            showNotification('Kayıt bulunamadı. Numaraları kontrol edin.', 'error');
            document.getElementById('tpPreviewCard').style.display = 'none'; 
            document.getElementById('btnSaveManualResult').disabled = true; 
            tpSearchResultData = null; 
            return;
        }

        const record = data[0];

        tpSearchResultData = { 
            id: record.id, 
            markName: record.mark_name, 
            applicationNo: record.application_no, 
            niceClasses: record.nice_classes, 
            holders: record.holders, 
            imagePath: record.image_path 
        };
        
        document.getElementById('tpPreviewName').textContent = record.mark_name || '-';
        document.getElementById('tpPreviewAppNo').textContent = record.application_no || '-';
        document.getElementById('tpPreviewClasses').textContent = record.nice_classes || '-';
        document.getElementById('tpPreviewOwner').textContent = record.holders || '-';
        document.getElementById('tpPreviewImg').src = record.image_path ? _normalizeImageSrc(record.image_path) : '/img/placeholder.png';
        
        document.getElementById('tpPreviewCard').style.display = 'block'; 
        document.getElementById('btnSaveManualResult').disabled = false;

    } catch (error) { 
        console.error("Manuel sorgu hatası:", error);
        showNotification('Hata oluştu.', 'error'); 
    } finally { 
        SimpleLoading.hide(); 
    }
};

const saveManualResultEntry = async () => {
    const monitoredId = document.getElementById('manualTargetId').value;
    if (!monitoredId) return showNotification('İzlenen marka seçiniz.', 'warning');
    
    const sourceType = document.querySelector('input[name="manualSourceType"]:checked').value;
    const currentBulletinVal = document.getElementById('bulletinSelect').value || MANUAL_COLLECTION_ID;
    const bulletinNoVal = currentBulletinVal.split('_')[0] || 'GLOBAL';
    
    // 🔥 Sütun isimleri Supabase veritabanındakiyle %100 eşleştirildi
    let resultPayload = { 
        bulletin_id: currentBulletinVal,
        bulletin_no: bulletinNoVal,
        monitored_trademark_id: monitoredId, 
        is_similar: true, 
        similarity_score: 1.0,
        positional_exact_match_score: 1.0,
        source: 'manual',
        is_earlier: false
    };

    if (sourceType === 'tp') {
        if (!tpSearchResultData) return;
        
        let flatHolders = tpSearchResultData.holders;
        if (Array.isArray(flatHolders)) {
            flatHolders = flatHolders.map(h => h.name || h.holderName || h).join(', ');
        } else {
            flatHolders = String(flatHolders || '');
        }

        resultPayload = { 
            ...resultPayload, 
            similar_mark_name: tpSearchResultData.markName, 
            similar_application_no: tpSearchResultData.applicationNo, 
            holders: flatHolders, 
            nice_classes: tpSearchResultData.niceClasses, 
            image_path: tpSearchResultData.imagePath 
        };
    } else {
        let uploadedImageUrl = null;
        if (manualSelectedFile) {
            SimpleLoading.updateText('Görsel Yükleniyor...', 'Lütfen bekleyiniz.');
            const fileName = `manual/${Date.now()}_${manualSelectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
            const { data, error } = await supabase.storage.from('brand_images').upload(fileName, manualSelectedFile);
            if (!error && data) uploadedImageUrl = data.path;
        }

        resultPayload = { 
            ...resultPayload, 
            similar_mark_name: document.getElementById('manMarkName').value, 
            similar_application_no: document.getElementById('manAppNo').value, 
            holders: document.getElementById('manOwner').value, 
            nice_classes: Array.from(document.querySelectorAll('.nice-class-box-item.selected')).map(el => el.dataset.classNo).join(', '), 
            image_path: uploadedImageUrl 
        };
    }

    SimpleLoading.show('Kaydediliyor...', 'Sonuç ekleniyor...');
    
    // 🔥 Eski tablo adı düzeltildi ve eklenen data geri alındı
    const { data: insertedData, error } = await supabase.from('monitoring_trademark_records').insert([resultPayload]).select();
    
    SimpleLoading.hide();
    
    if (!error) {
        showNotification('Kayıt başarıyla eklendi.', 'success');
        $('#addManualResultModal').modal('hide');
        
        // 🔥 Manuel eklenen kaydı ANINDA arayüze (tabloya) yansıtıyoruz
        if (insertedData && insertedData.length > 0) {
            const newItem = insertedData[0];
            allSimilarResults.push({
                id: newItem.id,
                objectID: newItem.id,
                monitoredTrademarkId: newItem.monitored_trademark_id,
                markName: newItem.similar_mark_name,
                applicationNo: newItem.similar_application_no,
                niceClasses: newItem.nice_classes,
                similarityScore: newItem.similarity_score,
                holders: newItem.holders,
                imagePath: newItem.image_path,
                bulletinId: newItem.bulletin_id,
                isSimilar: true,
                source: 'manual'
            });

            await groupAndSortResults();
            if (pagination) pagination.update(allSimilarResults.length);
            renderCurrentPageOfResults();
        }
    } else { 
        console.error("Manuel kayıt hatası:", error);
        showNotification('Kayıt eklenemedi: ' + error.message, 'error'); 
    }
};

const setupManualTargetSearch = () => {
    const input = document.getElementById('manualTargetSearchInput');
    const resultsContainer = document.getElementById('manualTargetSearchResults');
    if (!input || !resultsContainer) return;
    input.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (term.length === 0) { resultsContainer.style.display = 'none'; return; }
        const matches = monitoringTrademarks.filter(tm => (tm.title || '').toLowerCase().includes(term) || (tm.applicationNo || '').toLowerCase().includes(term)).slice(0, 10);
        resultsContainer.innerHTML = matches.map(tm => `<a href="#" class="list-group-item list-group-item-action" onclick="event.preventDefault(); document.getElementById('manualTargetSearchInput').value='${tm.title || tm.markName}'; document.getElementById('manualTargetId').value='${tm.id}'; document.getElementById('manualTargetSearchResults').style.display='none';"><div class="d-flex w-100 justify-content-between"><h6 class="mb-1">${tm.title || tm.markName}</h6><small>${tm.applicationNo}</small></div></a>`).join('');
        resultsContainer.style.display = matches.length ? 'block' : 'none';
    });
};

const setupDragAndDrop = () => {
    const fileInput = document.getElementById('manualImgInput');
    const previewImg = document.getElementById('manualImgPreview');
    if (!fileInput) return;
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            manualSelectedFile = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => { previewImg.src = ev.target.result; document.getElementById('manualImgPreviewContainer').style.display = 'block'; };
            reader.readAsDataURL(manualSelectedFile);
        }
    });
    document.getElementById('removeManualImgBtn')?.addEventListener('click', () => { manualSelectedFile = null; fileInput.value = ''; previewImg.src = ''; document.getElementById('manualImgPreviewContainer').style.display = 'none'; });
};

async function openEditCriteriaModal(markData) {
    document.getElementById('modalTrademarkName').textContent = markData.markName || '-';
    document.getElementById('modalApplicationNo').textContent = markData.applicationNumber || '-';
    document.getElementById('modalOwner').textContent = markData.owner || '-';
    document.getElementById('modalNiceClass').textContent = Array.isArray(markData.niceClasses) ? markData.niceClasses.join(', ') : '-';
    document.getElementById('modalTrademarkImage').src = _normalizeImageSrc(markData.brandImageUrl || '');
    document.getElementById('editCriteriaModal').dataset.markId = markData.id;

    populateList(document.getElementById('brandTextSearchList'), markData.brandTextSearch || [], [markData.markName].filter(Boolean));
    const niceContainer = document.getElementById('niceClassSelectionContainer'); niceContainer.innerHTML = '';
    for (let i = 1; i <= 45; i++) { const b = document.createElement('div'); b.className = 'nice-class-box'; b.textContent = i; b.dataset.classNo = i; niceContainer.appendChild(b); }
    populateNiceClassBoxes(markData.niceClassSearch || [], markData.niceClasses.map(String));
    $('#editCriteriaModal').modal('show');
}

function setupEditCriteriaModal() {
    const addBtn = document.getElementById('addBrandTextBtn'); const input = document.getElementById('brandTextSearchInput'); const list = document.getElementById('brandTextSearchList');
    addBtn?.addEventListener('click', () => { if (input.value.trim()) { addListItem(list, input.value.trim()); input.value = ''; } });
    document.getElementById('niceClassSelectionContainer')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('nice-class-box')) {
            if (e.target.classList.contains('permanent-item')) return showNotification('Kaldırılamaz.', 'warning');
            e.target.classList.toggle('selected');
            if (e.target.classList.contains('selected')) addListItem(document.getElementById('niceClassSearchList'), e.target.dataset.classNo);
            else { const items = document.getElementById('niceClassSearchList').querySelectorAll('li'); items.forEach(i => { if(i.querySelector('.list-item-text').textContent === e.target.dataset.classNo) i.remove(); }); }
        }
    });
    document.querySelectorAll('.list-group').forEach(list => {
        list.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li && e.target.classList.contains('remove-item')) {
                if (li.classList.contains('permanent-item')) return;
                const txt = li.querySelector('.list-item-text').textContent; li.remove();
                if (list.id === 'niceClassSearchList') document.querySelector(`.nice-class-box[data-class-no="${txt}"]`)?.classList.remove('selected');
            }
        });
    });
    document.getElementById('saveCriteriaBtn')?.addEventListener('click', async () => {
        const modal = document.getElementById('editCriteriaModal');
        const brandTextArray = Array.from(modal.querySelector('#brandTextSearchList').querySelectorAll('.list-item-text')).map(el => el.textContent);
        const niceClassArray = Array.from(modal.querySelector('#niceClassSearchList').querySelectorAll('.list-item-text')).map(el => parseInt(el.textContent));
        const markId = modal.dataset.markId;

        // 1. Veritabanını Güncelle
        const { error } = await supabase.from('monitoring_trademarks').update({ 
            brand_text_search: brandTextArray.join(', '), 
            nice_class_search: niceClassArray.join(', ') 
        }).eq('id', markId);
        
        if (!error) { 
            showNotification('İzleme kriterleri güncellendi.', 'success'); 
            $('#editCriteriaModal').modal('hide'); 
            
            // 🔥 TUTUCU CACHE YIKICI: Veritabanından tüm markaları baştan çekmek (loadInitialData) YERİNE, 
            // sadece anlık bellekteki markayı bulup nokta atışı güncelliyoruz!
            const tmIndex = monitoringTrademarks.findIndex(t => String(t.id) === String(markId));
            if (tmIndex !== -1) {
                monitoringTrademarks[tmIndex].brandTextSearch = brandTextArray;
                monitoringTrademarks[tmIndex].niceClassSearch = niceClassArray;
                // Arama indeksini anında tazele
                monitoringTrademarks[tmIndex]._searchNice = _uniqNice(monitoringTrademarks[tmIndex]).toLowerCase();
            }
            
            // Ekranı yeni verilere göre ışık hızında tekrar çiz
            applyMonitoringListFilters(); 
            
        } else {
            showNotification('Hata oluştu', 'error');
        }
    });
}

function populateNiceClassBoxes(selectedClasses, permanentClasses = []) {
    document.querySelectorAll('.nice-class-box').forEach(b => { b.classList.remove('selected', 'permanent-item'); });
    const all = new Set([...selectedClasses.map(String), ...permanentClasses.map(String)]);
    populateList(document.getElementById('niceClassSearchList'), [], permanentClasses.map(String));
    all.forEach(cls => {
        const box = document.querySelector(`.nice-class-box[data-class-no="${cls}"]`);
        if (box) { box.classList.add('selected'); if (permanentClasses.includes(cls)) box.classList.add('permanent-item'); addListItem(document.getElementById('niceClassSearchList'), cls, permanentClasses.includes(cls)); }
    });
}

function addListItem(listElement, text, isPermanent = false) {
    const existing = Array.from(listElement.querySelectorAll('.list-item-text')).map(el => el.textContent);
    if (existing.includes(text)) return;
    const li = document.createElement('li'); li.className = `list-group-item d-flex justify-content-between align-items-center ${isPermanent ? 'permanent-item' : ''}`;
    li.innerHTML = `<span class="list-item-text">${text}</span><button type="button" class="btn btn-sm btn-danger remove-item">&times;</button>`;
    listElement.appendChild(li);
}

function populateList(listElement, items, permanentItems = []) {
    listElement.innerHTML = '';
    const all = new Set([...items.map(String), ...permanentItems.map(String)]);
    all.forEach(item => addListItem(listElement, item, permanentItems.includes(item)));
}

window.queryApplicationNumberWithExtension = (applicationNo) => {
    const appNo = (applicationNo || '').toString().trim();
    if (!appNo) return;
    window.open(`https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(appNo)}`, '_blank');
};

// --- 8. MAIN ENTRY (DOM Loaded) ---
document.addEventListener('DOMContentLoaded', async () => {
    const startSearchBtn = document.getElementById('startSearchBtn');
    const researchBtn = document.getElementById('researchBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const bulletinSelect = document.getElementById('bulletinSelect');
    
    initializePagination();
    await loadInitialData();
    tssShowResumeBannerIfAny();

    startSearchBtn?.addEventListener('click', performSearch);
    researchBtn?.addEventListener('click', performResearch);
    bulletinSelect?.addEventListener('change', checkCacheAndToggleButtonStates);
    
    clearFiltersBtn?.addEventListener('click', () => {
        ['ownerSearch', 'niceClassSearch', 'brandNameSearch'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = ''; });
        bulletinSelect.selectedIndex = 0; applyMonitoringListFilters(); showNotification('Filtreler temizlendi.', 'info');
    });

    ['ownerSearch', 'niceClassSearch', 'brandNameSearch'].forEach(id => { document.getElementById(id)?.addEventListener('input', debounce(applyMonitoringListFilters, 400)); });

    document.getElementById('btnGenerateReportAndNotifyGlobal')?.addEventListener('click', handleGlobalReportAndNotifyGeneration);
    document.getElementById('openManualEntryBtn')?.addEventListener('click', openManualEntryModal);
    document.querySelectorAll('.btn-group-toggle label.btn').forEach(l => l.addEventListener('click', function() { setTimeout(() => updateManualFormUI(this.querySelector('input').value), 50); }));
    document.getElementById('btnQueryTpRecord')?.addEventListener('click', queryTpRecordForManualAdd);
    document.getElementById('btnSaveManualResult')?.addEventListener('click', saveManualResultEntry);

    document.getElementById('resultsTableBody')?.addEventListener('click', (e) => { 
        const editButton = e.target.closest('.edit-criteria-link'); 
        if (editButton) { e.preventDefault(); const row = editButton.closest('tr.group-header'); if (row?.dataset.markData) openEditCriteriaModal(JSON.parse(row.dataset.markData)); } 
    });

    document.getElementById('similarityFilterSelect')?.addEventListener('change', (e) => { similarityFilter = e.target.value; renderCurrentPageOfResults(); });
    document.getElementById('clearTrademarkFilterBtn')?.addEventListener('click', () => { selectedMonitoredTrademarkId = null; renderCurrentPageOfResults(); });

    setupEditCriteriaModal(); setupManualTargetSearch(); setupDragAndDrop(); setTimeout(addGlobalOptionToBulletinSelect, 1000);
});