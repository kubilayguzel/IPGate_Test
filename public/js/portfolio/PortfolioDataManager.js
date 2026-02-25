import { ipRecordsService, transactionTypeService, personService, commonService, suitService, transactionService } from '../../supabase-config.js';
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

    async _processInChunks(array, processor, chunkSize = 500) {
        const result = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            const chunk = array.slice(i, i + chunkSize);
            result.push(...chunk.map(processor));
            await new Promise(resolve => setTimeout(resolve, 0)); 
        }
        return result;
    }

    async _mapRawToProcessed(rawData) {
        return await this._processInChunks(rawData, record => ({
            ...record,
            applicationDateTs: this._parseDate(record.applicationDate),
            formattedApplicantName: this._resolveApplicantName(record),
            formattedApplicationDate: this._fmtDate(record.applicationDate),
            formattedNiceClasses: this._formatNiceClasses(record),
            statusText: this._resolveStatusText(record),
            formattedCountryName: this.getCountryName(record.country || record.countryCode)
        }), 500);
    }

    async loadInitialData() {
        // 🔥 GÜNCELLEME: Kişiler (persons) listesi yüklenmeden eşleştirmeye (mapping) geçmesine asla izin vermiyoruz!
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
        return record.applicantName || record.ownerName || '-';
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

    prefetchObjectionData() {
        return transactionService.getObjectionData();
    }

    async buildObjectionRows(prefetchPromise = null, forceRefresh = false) {
        if (!forceRefresh && this.objectionRows.length > 0) return this.objectionRows;

        try {
            const result = await (prefetchPromise || this.prefetchObjectionData());
            
            if (!result || !result.success || result.parents.length === 0) {
                this.objectionRows = [];
                return [];
            }

            const parentIds = new Set();
            const parents = result.parents.map(p => { parentIds.add(p.id); return p; });

            const childrenMap = {};
            result.children.forEach(child => {
                if (child.parentId && parentIds.has(child.parentId)) {
                    if (!childrenMap[child.parentId]) childrenMap[child.parentId] = [];
                    childrenMap[child.parentId].push(child);
                }
            });

            const recordsMap = new Map(this.allRecords.map(r => [r.id, r]));
            
            const localRows = await this._processInChunks(parents, (parent) => {
                let record = recordsMap.get(parent.recordId);
                if (!record) { record = { id: parent.recordId, isMissing: true }; }

                const children = childrenMap[parent.id] || [];
                const typeInfo = this.transactionTypesMap.get(String(parent.type));

                const parentRow = this._createObjectionRowDataFast(record, parent, typeInfo, true, children.length > 0);
                parentRow.children = [];

                for (const child of children) {
                    const childTypeInfo = this.transactionTypesMap.get(String(child.type));
                    parentRow.children.push(this._createObjectionRowDataFast(record, child, childTypeInfo, false, false, parent.id));
                }
                
                parentRow.children.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
                return parentRow;
            }, 100); 

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
        if (Array.isArray(tx.documents)) {
            docs = tx.documents.map(d => ({
                fileName: d.name || d.fileName || 'Belge',
                fileUrl: d.fileUrl || d.url || d.downloadURL || d.path || d.link,
                type: d.type || 'standard'
            }));
        }

        if (tx.relatedPdfUrl && !docs.some(d => d.type === 'official_document')) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionEpatsPetitionFileUrl && !docs.some(d => d.type === 'epats_document')) docs.push({ fileName: 'ePATS İtiraz Evrakı', fileUrl: tx.oppositionEpatsPetitionFileUrl, type: 'epats_document' });
        if (!isParent && tx.oppositionPetitionFileUrl && !docs.some(d => d.type === 'opposition_petition')) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
       
        const isOwnRecord = !(
            record.portfoyStatus === 'third_party' || record.portfoyStatus === 'published_in_bulletin' ||
            record.recordOwnerType === 'third_party'
        );
        
        if (isOwnRecord && String(tx.type) === '20') docs = docs.filter(d => d.type === 'epats_document');
        else if (isParent) docs = docs.filter(d => d.type !== 'opposition_petition');

        let opponentText = tx.opponent || tx.oppositionOwner || '-';
        
        return {
            id: tx.id,
            recordId: record.id,
            parentId: parentId,
            isChild: !isParent,
            hasChildren: hasChildren,
            isOwnRecord: isOwnRecord, 
            portfoyStatus: record.portfoyStatus || record.portfolio_status,
            recordStatus: record.recordStatus,
            title: record.title || record.brandText || '',
            transactionTypeName: typeInfo?.alias || typeInfo?.name || `İşlem ${tx.type}`,
            applicationNumber: record.applicationNumber || '-',
            applicantName: record.formattedApplicantName || '-',
            opponent: opponentText,
            bulletinNo: tx.bulletinNo || record.bulletinNo || '-',
            bulletinDate: this._fmtDate(tx.bulletinDate || record.bulletinDate),
            epatsDate: this._fmtDate(docs.find(d => d.type === 'epats_document')?.documentDate || tx.epatsDocument?.documentDate),
            statusText: this._formatObjectionStatus(tx.requestResult),
            timestamp: tx.timestamp || tx.created_at,
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
        const classes = new Set();
        let nc = record.niceClasses;
        
        // 🔥 GÜNCELLEME: String (Metin) gelen JSON veya virgüllü dizileri çözümlüyoruz
        if (typeof nc === 'string') {
            try { nc = JSON.parse(nc); } catch(e) { nc = nc.split(',').map(x => x.trim()); }
        }

        if (Array.isArray(nc)) {
            nc.forEach(c => {
                const parsed = parseInt(c);
                if (!isNaN(parsed)) classes.add(parsed);
            });
        }

        if (Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(item => {
                if (item.classNo) {
                    const parsed = parseInt(item.classNo);
                    if (!isNaN(parsed)) classes.add(parsed);
                }
            });
        }

        if (classes.size === 0) return '-';
        return Array.from(classes).sort((a, b) => a - b).map(c => c < 10 ? `0${c}` : c).join(', ');
    }

    _fmtDate(val) {
        if(!val) return '-';
        try {
            let d = typeof val === 'object' && val._seconds ? new Date(val._seconds * 1000) : new Date(val);
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }

    _parseDate(val) {
        if (!val || val === '-') return 0;
        if (val instanceof Date) return val.getTime();
        if (typeof val === 'object' && val._seconds) return val._seconds * 1000;
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
                // 🔥 GÜNCELLEME: recordOwnerType'ı kesin olarak kontrol et ve "third_party" (Karşı Taraf) olanları SİL!
                if (r.recordOwnerType === 'third_party') return false;

                const isThirdPartyOrBulletin = ['third_party', 'published_in_bulletin'].includes(r.portfoyStatus || r.status);
                const isInactive = ['inactive', 'pasif'].includes(r.portfoyStatus || r.status);
                
                if (isInactive || isThirdPartyOrBulletin) return false;
                if ((r.origin === 'WIPO' || r.origin === 'ARIPO') && r.transactionHierarchy === 'child') return false;
                
                if (typeFilter === 'all') return true;
                if (typeFilter === 'trademark') {
                    if (r.type !== 'trademark') return false;
                    const isTP = ['TÜRKPATENT', 'TR'].includes(r.origin) || r.country === 'TR';
                    if (subTab === 'turkpatent') return isTP;
                    if (subTab === 'foreign') return !isTP;
                    return true;
                }
                return r.type === typeFilter;
            });
        }

        return sourceData.filter(item => {
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                const searchStr = Object.values(item).join(' ').toLowerCase();
                if (!searchStr.includes(s)) return false;
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
}