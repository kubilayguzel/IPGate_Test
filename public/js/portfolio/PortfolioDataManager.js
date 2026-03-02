import { ipRecordsService, transactionTypeService, personService, commonService, suitService, transactionService, supabase } from '../../supabase-config.js';
import { STATUSES } from '../../utils.js';

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = [];
        this.litigationRows = [];
        
        this.transactionTypesMap = new Map();
        this.personsMap = new Map(); 
        this.statusMap = new Map();  
        this.countriesMap = new Map();
        
        this.allCountries = [];  
        this.wipoGroups = { parents: new Map(), children: new Map() };

        this._buildStatusMap();
    }

    async _mapRawToProcessed(rawData) {
        // 🔥 HIZ OPTİMİZASYONU: Array.map ve Object Spread (...) operatörü yerine
        // döngü kullanarak mevcut objeleri güncelliyoruz. Bu sayede RAM şişmez, tarayıcı kilitlenmez.
        for (let i = 0; i < rawData.length; i++) {
            const record = rawData[i];
            record.applicationDateTs = this._parseDate(record.applicationDate);
            record.formattedApplicantName = this._resolveApplicantName(record);
            record.formattedApplicationDate = this._fmtDate(record.applicationDate);
            record.formattedNiceClasses = this._formatNiceClasses(record);
            record.statusText = this._resolveStatusText(record);
            record.formattedCountryName = this.getCountryName(record.country || record.countryCode);
            
            // 🔥 ARAMA OPTİMİZASYONU: Arama barında kullanılacak metni sadece bir kez birleştiriyoruz.
            record.searchString = `${record.title || ''} ${record.brandText || ''} ${record.applicationNumber || ''} ${record.formattedApplicantName || ''} ${record.formattedCountryName || ''} ${record.statusText || ''} ${record.formattedNiceClasses || ''} ${record.registrationNumber || ''}`.toLowerCase();
        }
        return rawData;
    }

    async loadInitialData() {
        await Promise.all([
            this.loadTransactionTypes(),
            this.loadCountries(),
            this.loadPersons()
        ]);
        return this.allRecords;
    }

    async loadTransactionTypes() {
        const result = await transactionTypeService.getTransactionTypes();
        if (result.success) {
            result.data.forEach(type => {
                this.transactionTypesMap.set(String(type.id), type);
                if (type.code) this.transactionTypesMap.set(String(type.code), type);
            });
        }
    }

    async loadPersons() {
        const result = await personService.getPersons();
        if (result.success) {
            this.personsMap.clear();
            (result.data || []).forEach(p => { if(p.id) this.personsMap.set(p.id, p); });
        }
    }

    async loadCountries() {
        try {
            const result = await commonService.getCountries();
            if (result.success) {
                this.allCountries = result.data;
                this.countriesMap = new Map(this.allCountries.map(c => [c.code, c.name]));
            }
        } catch (e) {
            console.error("Ülke listesi hatası:", e);
        }
    }

    _buildStatusMap() {
        this.statusMap.clear();
        for (const type in STATUSES) {
            if (Array.isArray(STATUSES[type])) {
                STATUSES[type].forEach(s => {
                    this.statusMap.set(s.value, s.text);
                });
            }
        }
    }

    async loadRecords({ type = null } = {}) {
        if (this.allRecords && this.allRecords.length > 0) {
            return this.allRecords;
        }

        const result = type 
            ? await ipRecordsService.getRecordsByType(type) 
            : await ipRecordsService.getRecords();            
        
        if (result.success) {
            const rawData = Array.isArray(result.data) ? result.data : [];
            this.allRecords = await this._mapRawToProcessed(rawData);
            this._buildWipoGroups();
        }
        return this.allRecords;
    }

    startListening(onDataReceived, { type = null } = {}) {
        this.loadRecords({ type }).then(records => {
            if (onDataReceived) onDataReceived(records);
        });
        return () => {}; 
    }

    _resolveApplicantName(record) {
        if (Array.isArray(record.applicants) && record.applicants.length > 0) {
            const names = record.applicants.map(app => {
                const personId = typeof app === 'object' ? app.id : app;
                if (personId && this.personsMap.has(personId)) {
                    return this.personsMap.get(personId).name;
                }
                return typeof app === 'object' ? (app.name || app.companyName || '') : '';
            }).filter(Boolean);
            
            if (names.length > 0) return names.join(', ');
        }
        return record.applicantName || '-';
    }

    _resolveStatusText(record) {
        const rawStatus = record.status;
        if (!rawStatus) return '-';
        if (this.statusMap.has(rawStatus)) return this.statusMap.get(rawStatus);
        return rawStatus;
    }

    getRecordById(id) {
        return this.allRecords.find(r => r.id === id);
    }

    _buildWipoGroups() {
        this.wipoGroups = { parents: new Map(), children: new Map() };
        this.allRecords.forEach(r => {
            if (r.origin === 'WIPO' || r.origin === 'ARIPO') {
                const irNo = r.wipoIR || r.aripoIR;
                if (!irNo) return;
                if (r.transactionHierarchy === 'parent') {
                    this.wipoGroups.parents.set(irNo, r);
                } else if (r.transactionHierarchy === 'child') {
                    if (!this.wipoGroups.children.has(irNo)) this.wipoGroups.children.set(irNo, []);
                    this.wipoGroups.children.get(irNo).push(r);
                }
            }
        });
    }

    getWipoChildren(irNo) {
        return this.wipoGroups.children.get(irNo) || [];
    }

    clearCache() {
        this.allRecords = []; // 🔥 EKLENDİ: Tüm cache'i sıfırlamak için
        this.objectionRows = [];
        this.litigationRows = [];
    }

    async loadLitigationData() {
        try {
            const result = await suitService.getSuits();
            if (result.success) {
                this.litigationRows = result.data;
                this.litigationRows.sort((a, b) => this._parseDate(b.openedDate) - this._parseDate(a.openedDate));
            } else {
                this.litigationRows = [];
            }
            return this.litigationRows;
        } catch (e) {
            console.error("Davalar hatası:", e);
            return [];
        }
    }

// İşlemleri (transactions) çekerken, ona bağlı olan Görevi (tasks) ve o göreve bağlı olan Evrakları (task_documents) da tek sorguda çekiyoruz!
    prefetchObjectionData() {
        const PARENT_TYPES = ['7', '19', '20'];
        const querySelect = '*, transaction_documents(*), tasks(*, task_documents(*))';
        
        return {
            parentPromise: supabase.from('transactions').select(querySelect).in('transaction_type_id', PARENT_TYPES).limit(10000),
            childPromise: supabase.from('transactions').select(querySelect).eq('transaction_hierarchy', 'child').limit(10000)
        };
    }

    // 2. DÜZELTME: Gelen ham veriyi String ID'lerle asıl portföy verisine (allRecords) hatasız bağlıyoruz.
    async buildObjectionRows(prefetchPromise = null, forceRefresh = false) {
        if (!forceRefresh && this.objectionRows.length > 0) return this.objectionRows;

        try {
            const prefetch = prefetchPromise || this.prefetchObjectionData();
            const [parentRes, childRes] = await Promise.all([prefetch.parentPromise, prefetch.childPromise]);
            
            const parentsData = parentRes.data || [];
            const childrenData = childRes.data || [];

            if (parentsData.length === 0) {
                this.objectionRows = [];
                return [];
            }

            const parentIds = new Set();
            const parents = parentsData.map(p => { 
                parentIds.add(String(p.id)); 
                return p; 
            });

            const childrenMap = {};
            childrenData.forEach(child => {
                const pId = String(child.parent_id);
                if (pId && parentIds.has(pId)) {
                    if (!childrenMap[pId]) childrenMap[pId] = [];
                    childrenMap[pId].push(child);
                }
            });

            // Başvuru Sahibi eşleşme hatasını önlemek için tüm ID'leri String'e çeviriyoruz
            const recordsMap = new Map(this.allRecords.map(r => [String(r.id), r]));
            
            const localRows = await this._mapRawToProcessed(parents.map(parent => {
                const recId = String(parent.ip_record_id);
                let record = recordsMap.get(recId) || { id: recId, isMissing: true };
                
                const children = childrenMap[String(parent.id)] || [];
                const typeInfo = this.transactionTypesMap.get(String(parent.transaction_type_id));

                const parentRow = this._createObjectionRowDataFast(record, parent, typeInfo, true, children.length > 0);
                parentRow.children = [];

                for (const child of children) {
                    const childTypeInfo = this.transactionTypesMap.get(String(child.transaction_type_id));
                    parentRow.children.push(this._createObjectionRowDataFast(record, child, childTypeInfo, false, false, parent.id));
                }
                
                parentRow.children.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
                return parentRow;
            }));

            this.objectionRows = localRows.filter(Boolean);
            return this.objectionRows;

        } catch (error) {
            console.error("İtirazlar yüklenirken hata:", error);
            return [];
        }
    }

    async loadObjectionRows(forceRefresh = false) {
        return this.buildObjectionRows(null, forceRefresh);
    }

    _createObjectionRowDataFast(record, tx, typeInfo, isParent, hasChildren, parentId = null) {
        let docs = [];
        const seenUrls = new Set();
        
        // Evrak eklerken mükerrer (aynı dosyayı 2 kere gösterme) olmasını engelleyen yardımcı fonksiyon
        const addDoc = (d) => {
            if (!d) return;
            const url = d.document_url || d.url || d.fileUrl || d.downloadURL || d.path;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    fileName: d.document_name || d.name || d.document_designation || 'Belge',
                    fileUrl: url,
                    type: d.document_type || d.type || d.document_designation || 'standard'
                });
            }
        };

        // A. İşlemin kendi evrakları (transaction_documents)
        if (Array.isArray(tx.transaction_documents)) {
            tx.transaction_documents.forEach(addDoc);
        }

        // B. İşleme bağlı GÖREVİN evrakları (tasks & task_documents)
        // Supabase ilişkili tabloyu dizi veya obje olarak dönebilir, güvenli okuyoruz
        const taskData = Array.isArray(tx.tasks) ? tx.tasks[0] : tx.tasks; 
        if (taskData) {
            // Task'ın SQL tablosundaki evrakları
            if (Array.isArray(taskData.task_documents)) {
                taskData.task_documents.forEach(addDoc);
            }
            // Task'ın Details (JSONB) içindeki eski evrakları
            if (taskData.details && Array.isArray(taskData.details.documents)) {
                taskData.details.documents.forEach(addDoc);
            }
            // Task'ın içine gömülü ePATS belgesi
            if (taskData.details && taskData.details.epatsDocument) {
                addDoc(taskData.details.epatsDocument);
            }
        }

        // C. Eski Legacy İşlem Detaylarındaki (JSONB) PDF'ler
        const details = tx.details || {};
        if (details.relatedPdfUrl) addDoc({ name: 'Resmi Yazı', url: details.relatedPdfUrl, type: 'official_document' });
        if (details.oppositionEpatsPetitionFileUrl) addDoc({ name: 'ePATS İtiraz Evrakı', url: details.oppositionEpatsPetitionFileUrl, type: 'epats_document' });
        if (!isParent && details.oppositionPetitionFileUrl) addDoc({ name: 'İtiraz Dilekçesi', url: details.oppositionPetitionFileUrl, type: 'opposition_petition' });

        const isOwnRecord = !(
            record.portfoyStatus === 'third_party' || record.portfoyStatus === 'published_in_bulletin' ||
            record.recordOwnerType === 'third_party'
        );
        
        if (isOwnRecord && String(tx.transaction_type_id) === '20') docs = docs.filter(d => d.type === 'epats_document');
        else if (isParent) docs = docs.filter(d => d.type !== 'opposition_petition');

        // Karşı Tarafı Çözümle
        let opponentText = tx.opposition_owner || '-';
        if (opponentText === '-' && details.oppositionOwner) opponentText = details.oppositionOwner;
        if (opponentText === '-' && record.opponent) opponentText = record.opponent;
        if (opponentText === '-' && record.recordOwnerType === 'third_party') opponentText = record.formattedApplicantName;

        // Bülten Bilgilerini Çözümle
        let bNo = '-';
        let bDate = '-';
        if (Array.isArray(record.bulletins) && record.bulletins.length > 0) {
            bNo = record.bulletins[0].bulletinNo || record.bulletins[0].bulletin_no || '-';
            bDate = record.bulletins[0].bulletinDate || record.bulletins[0].bulletin_date || '-';
        } else if (record.bulletinNo || details.bulletinNo) {
            bNo = record.bulletinNo || details.bulletinNo;
            bDate = record.bulletinDate || details.bulletinDate;
        }

        // ePATS İşlem Tarihini Çözümle
        const epatsDoc = docs.find(d => d.type === 'epats_document' || (d.fileName && d.fileName.toLowerCase().includes('epats')));
        let eDate = tx.transaction_date || tx.created_at;
        if (epatsDoc && epatsDoc.documentDate) eDate = epatsDoc.documentDate;
        else if (details.epatsDocument && details.epatsDocument.documentDate) eDate = details.epatsDocument.documentDate;

        return {
            id: tx.id,
            recordId: record.id,
            parentId: parentId,
            isChild: !isParent,
            hasChildren: hasChildren,
            isOwnRecord: isOwnRecord, 
            portfoyStatus: record.portfoyStatus || record.portfolio_status,
            recordStatus: record.status,
            title: record.title || record.brandText || record.brand_name || '-',
            transactionTypeName: typeInfo?.alias || typeInfo?.name || `İşlem ${tx.transaction_type_id}`,
            applicationNumber: record.applicationNumber || record.application_number || '-',
            applicantName: record.formattedApplicantName || record.applicantName || '-',
            opponent: opponentText,
            bulletinNo: bNo,
            bulletinDate: this._fmtDate(bDate),
            epatsDate: this._fmtDate(eDate),
            statusText: this._resolveStatusText(record) || '-', 
            timestamp: tx.created_at || tx.transaction_date,
            documents: docs
        };
    }

    async deleteRecord(id) { 
        return await ipRecordsService.deleteParentWithChildren(id); 
    }

    async toggleRecordsStatus(ids) {
        const records = ids.map(id => this.getRecordById(id)).filter(Boolean);
        if(!records.length) return;
        await Promise.all(records.map(r => 
            ipRecordsService.updateRecord(r.id, { portfoyStatus: 'inactive' })
        ));
    }

    _formatObjectionStatus(code) {
        if (!code) return 'Karar Bekleniyor';
        const typeInfo = this.transactionTypesMap.get(String(code));
        return typeInfo ? (typeInfo.alias || typeInfo.name) : 'Karar Bekleniyor';
    }

    _formatNiceClasses(record) {
        if (Array.isArray(record.niceClasses) && record.niceClasses.length > 0) {
            return record.niceClasses.sort((a,b) => a-b).map(c => c < 10 ? `0${c}` : c).join(', ');
        }
        return '-';
    }

    _fmtDate(val) {
        if(!val) return '-';
        try {
            // 🔥 YENİ: Firebase kalıntısını sildik. Doğrudan standart tarih çevirimi
            let d = new Date(val);
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }

    _parseDate(val) {
        if (!val || val === '-') return 0;
        if (val instanceof Date) return val.getTime();
        if (typeof val === 'string' && val.includes('.')) {
            const parts = val.split('.');
            if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        }
        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? 0 : parsed;
    }

    getCountryName(code) {
        return this.countriesMap.get(code) || code || '-';
    }

    filterRecords(typeFilter, searchTerm, columnFilters = {}, subTab = null) {
        let sourceData = [];

        if (typeFilter === 'litigation') {
            sourceData = this.litigationRows.filter(r => r.portfoyStatus !== 'inactive' && r.recordStatus !== 'pasif');
        } else if (typeFilter === 'objections') {
            sourceData = this.objectionRows.filter(r => r.portfoyStatus !== 'inactive' && r.recordStatus !== 'pasif');
        } else {
            sourceData = this.allRecords.filter(r => {
                if (r.portfoyStatus === 'inactive' || r.recordStatus === 'pasif') return false;
                if ((r.origin === 'WIPO' || r.origin === 'ARIPO') && r.transactionHierarchy === 'child') return false;
                if (typeFilter === 'all') return r.recordOwnerType !== 'third_party';
                
                if (typeFilter === 'trademark') {
                    if (r.type !== 'trademark' || r.recordOwnerType === 'third_party') return false;
                    if (subTab === 'turkpatent') return r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.countryCode === 'TR');
                    if (subTab === 'foreign') return !(r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.countryCode === 'TR'));
                    return true;
                }
                return r.type === typeFilter;
            });
        }

        return sourceData.filter(item => {
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                if (typeFilter === 'objections') {
                    const matchParent = ((item.transactionTypeName || '').toLowerCase().includes(s) || (item.title || '').toLowerCase().includes(s) || (item.opponent || '').toLowerCase().includes(s) || String(item.bulletinNo || '').includes(s) || (item.applicantName || '').toLowerCase().includes(s) || String(item.applicationNumber || '').includes(s) || (item.statusText || '').toLowerCase().includes(s));
                    let matchChild = false;
                    if (item.children && item.children.length > 0) {
                        matchChild = item.children.some(c => (c.transactionTypeName || '').toLowerCase().includes(s) || (c.statusText || '').toLowerCase().includes(s) || (c.opponent || '').toLowerCase().includes(s));
                    }
                    if (!matchParent && !matchChild) return false;
                } else if (typeFilter === 'litigation') {
                     const searchStr = `${item.title || ''} ${item.suitType || ''} ${item.caseNo || ''} ${item.court || ''} ${item.client?.name || ''} ${item.opposingParty || ''} ${item.statusText || ''}`.toLowerCase();
                     if (!searchStr.includes(s)) return false;
                } else {
                    // 🔥 HIZ OPTİMİZASYONU: Object.values(...).join(' ') kullanmak yerine hazır searchString'de ara
                    if (!item.searchString || !item.searchString.includes(s)) return false;
                }
            }
            
            for (const [key, val] of Object.entries(columnFilters)) {
                if (!val) continue;
                let filterVal = val.toLowerCase();
                let itemVal = String(item[key] || '').toLowerCase();
                
                if (key === 'formattedApplicationDate' && val.includes('-')) {
                    const parts = val.split('-'); 
                    if (parts.length === 3) filterVal = `${parts[2]}.${parts[1]}.${parts[0]}`;
                }
                if (!itemVal.includes(filterVal)) return false;
            }
            return true;
        });
    }

    sortRecords(data, column, direction) {
        const collator = new Intl.Collator('tr-TR', { sensitivity: 'base' });
        return [...data].sort((a, b) => {
            let valA = column === 'country' ? (a.formattedCountryName || a[column]) : a[column];
            let valB = column === 'country' ? (b.formattedCountryName || b[column]) : b[column];
                   
            const isEmptyA = (valA === null || valA === undefined || valA === '');
            const isEmptyB = (valB === null || valB === undefined || valB === '');
            
            if (isEmptyA && isEmptyB) return 0;
            if (isEmptyA) return direction === 'asc' ? 1 : -1;
            if (isEmptyB) return direction === 'asc' ? -1 : 1;
            
            if (String(column).toLowerCase().includes('date') || String(column).toLowerCase().includes('tarih')) {
                valA = this._parseDate(valA);
                valB = this._parseDate(valB);
                return direction === 'asc' ? valA - valB : valB - valA;
            }
            return direction === 'asc' ? collator.compare(String(valA), String(valB)) : -collator.compare(String(valA), String(valB));
        });
    }

    // İzlemeye Ekleme için veri hazırlayıcı (SQL Şemasına Uyumlu)
    prepareMonitoringData(record) {
        return {
            ip_record_id: record.id,
            mark_name: record.title || record.brandText || 'İsimsiz Marka',
            // 🔥 search_mark_name satırı tamamen kaldırıldı
            application_number: record.applicationNumber || '-',
            owner_name: record.applicantName || '-',
            nice_classes: record.niceClasses || [],
            image_path: record.brandImageUrl || null
        };
    }
}