import { ipRecordsService, transactionTypeService, personService, commonService, suitService, transactionService } from '../../supabase-config.js';
import { STATUSES } from '../../utils.js';

export class PortfolioDataManager {
    constructor() {
        this.allRecords = [];
        this.objectionRows = [];
        this.litigationRows = [];
        
        // --- PERFORMANS İÇİN HARİTALAR (MAPS) ---
        // O(1) erişim hızı sağlar, binlerce kayıtta döngüye girmeyi engeller.
        this.transactionTypesMap = new Map();
        this.personsMap = new Map(); 
        this.statusMap = new Map();  
        
        this.allCountries = [];  
        this.taskCache = new Map(); 
        this.wipoGroups = { parents: new Map(), children: new Map() };

        // Durumları Haritala
        this._buildStatusMap();
        this.countriesMap = new Map();
    }

    // --- YENİ: Tarayıcıyı Dondurmayan Veri İşleme Motoru ---
    async _processInChunks(array, processor, chunkSize = 500) {
        const result = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            const chunk = array.slice(i, i + chunkSize);
            result.push(...chunk.map(processor));
            // Ana iş parçacığına (UI) nefes aldır, donmayı engelle
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return result;
    }

    // --- YENİ: Ortak Haritalama (Mapping) Fonksiyonu ---
    async _mapRawToProcessed(rawData) {
        return await this._processInChunks(rawData, record => ({
            ...record,
            applicationDateTs: this._parseDate(record.applicationDate),
            formattedApplicantName: this._resolveApplicantName(record),
            formattedApplicationDate: this._fmtDate(record.applicationDate),
            formattedNiceClasses: this._formatNiceClasses(record),
            statusText: this._resolveStatusText(record),
            formattedCountryName: this.getCountryName(record.country)
        }), 500);
    }

    async loadInitialData({ deferPersons = true } = {}) {
        // 🔥 Persons'ı ilk boyamayı bloklamasın diye opsiyonel yapıyoruz
        await Promise.all([
            this.loadTransactionTypes(),
            this.loadCountries()
        ]);

        // persons’ı boyamadan sonra yükle
        if (deferPersons) {
            this.loadPersons().then(() => {
            // persons gelince formattedApplicantName’leri güncellemek istersen:
            this.allRecords = this.allRecords.map(r => ({
                ...r,
                formattedApplicantName: this._resolveApplicantName(r)
            }));
            }).catch(() => {});
        } else {
            await this.loadPersons();
        }

        return this.allRecords;
        }


    // --- LOOKUPS ---
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
        // Artık doğrudan Supabase'den çekiyoruz, önbellek hamallığı yok!
        const result = await personService.getPersons();
        if (result.success) {
            this.personsMap.clear();
            (result.data || []).forEach(p => { if(p.id) this.personsMap.set(p.id, p); });
        }
    }

    async loadCountries() {
        try {
            // YENİ: Firebase db.doc yerine doğrudan servisimizi çağırıyoruz
            const result = await commonService.getCountries();
            if (result.success) {
                this.allCountries = result.data;
                this.countriesMap = new Map(this.allCountries.map(c => [c.code, c.name]));
            } else {
                this.allCountries = [];
                this.countriesMap = new Map();
            }
        } catch (e) {
            console.error("Ülke listesi hatası:", e);
            this.allCountries = [];
            this.countriesMap = new Map();
        }
    }


    // Durum listesini Map'e çevirir (HIZ OPTİMİZASYONU)
    _buildStatusMap() {
        this.statusMap.clear();
        for (const type in STATUSES) {
            if (Array.isArray(STATUSES[type])) {
                STATUSES[type].forEach(s => {
                    // Her durumu map'e ekle. Örn: 'filed' -> 'Başvuru Yapıldı'
                    this.statusMap.set(s.value, s.text);
                });
            }
        }
    }

    async loadRecords({ type = null } = {}) {
        // Supabase o kadar hızlı ki, önbelleğe bakmadan direkt çekiyoruz
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
        // NOT: Supabase Realtime geçişinde burası doldurulacak.
        // Şimdilik sayfayı kırmamak için sadece bir kez veriyi çekip gönderiyoruz.
        console.warn("⚠️ Realtime (Canlı Dinleme) Supabase geçişi için askıya alındı.");
        this.loadRecords({ type }).then(records => {
            if (onDataReceived) onDataReceived(records);
        });
        
        // Unsubscribe (Durdurma) fonksiyonu döner
        return () => { console.log("Dinleme durduruldu."); };
    }

    // OPTİMİZE EDİLDİ: Artık .find() yerine .get() kullanıyor
    _resolveApplicantName(record) {
        if (Array.isArray(record.applicants) && record.applicants.length > 0) {
            return record.applicants.map(app => {
                if (app.id) {
                    // Map üzerinden O(1) erişim (Anında bulur)
                    const person = this.personsMap.get(app.id);
                    if (person) return person.name;
                }
                return app.name || '';
            }).filter(Boolean).join(', ');
        }
        return record.applicantName || '-';
    }

    // OPTİMİZE EDİLDİ: Artık döngü yerine Map kullanıyor
    _resolveStatusText(record) {
        const rawStatus = record.status;
        if (!rawStatus) return '-';
        
        // Önce Map'ten bak (Hızlı)
        if (this.statusMap.has(rawStatus)) {
            return this.statusMap.get(rawStatus);
        }
        
        return rawStatus;
    }

    getRecordById(id) {
        return this.allRecords.find(r => r.id === id);
    }

    // --- WIPO MANTIĞI ---
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
        // Artık sadece RAM'deki listeleri sıfırlamamız yeterli
        this.objectionRows = [];
        this.litigationRows = [];
        console.log("🧹 Sayfa verileri sıfırlandı, yeniden çekilecek.");
    }

    async loadLitigationData() {
        try {
            // YENİ: Firebase collection('suits') yerine servisimizi çağırıyoruz
            const result = await suitService.getSuits();
            if (result.success) {
                this.litigationRows = result.data;
                // Eski arayüzünüzün beklediği sıralama
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


// --- OBJECTIONS: PREFETCH (Supabase Versiyonu) ---
    prefetchObjectionData() {
        // Supabase tarafında iki sorguyu aynı anda yapan servisimizi çağırıyoruz.
        // Arayüzü dondurmamak için Promise (Söz) olarak dönüyoruz.
        return transactionService.getObjectionData();
    }

    async buildObjectionRows(prefetchPromise = null, forceRefresh = false) {
        // Eğer zaten sayfadayken hesapladıysak tekrar hesaplama (RAM'den ver)
        if (!forceRefresh && this.objectionRows.length > 0) return this.objectionRows;

        console.time('⏱️ buildObjectionRows (Supabase)');
        try {
            const result = await (prefetchPromise || this.prefetchObjectionData());
            
            if (!result || !result.success || result.parents.length === 0) {
                this.objectionRows = [];
                return [];
            }

            const parentIds = new Set();
            const parents = result.parents.map(p => {
                parentIds.add(p.id);
                return p;
            });

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
            console.timeEnd('⏱️ buildObjectionRows (Supabase)');
            
            return this.objectionRows;

        } catch (error) {
            console.error("İtirazlar yüklenirken hata:", error);
            return [];
        }
    }

    // Geriye uyumluluk için loadObjectionRows'u da forceRefresh destekleyecek şekilde güncelliyoruz
    async loadObjectionRows(forceRefresh = false) {
        return this.buildObjectionRows(null, forceRefresh);
    }

    _createObjectionRowDataFast(record, tx, typeInfo, isParent, hasChildren, parentId = null) {
        let docs = [];
        
        // 1. TEK GERÇEKLİK KAYNAĞI: documents dizisi
        if (Array.isArray(tx.documents)) {
            docs = tx.documents.map(d => ({
                fileName: d.name || d.fileName || 'Belge',
                // YENİ: Supabase ve Firebase'den gelen tüm olası link yolları eklendi
                fileUrl: d.fileUrl || d.url || d.downloadURL || d.path || d.link,
                type: d.type || 'standard'
            }));
        }

        // ESKİ (LEGACY) KAYITLARA DESTEK
        if (tx.relatedPdfUrl && !docs.some(d => d.type === 'official_document')) docs.push({ fileName: 'Resmi Yazı', fileUrl: tx.relatedPdfUrl, type: 'official_document' });
        if (tx.oppositionEpatsPetitionFileUrl && !docs.some(d => d.type === 'epats_document')) docs.push({ fileName: 'ePATS İtiraz Evrakı', fileUrl: tx.oppositionEpatsPetitionFileUrl, type: 'epats_document' });
        if (!isParent && tx.oppositionPetitionFileUrl && !docs.some(d => d.type === 'opposition_petition')) docs.push({ fileName: 'İtiraz Dilekçesi', fileUrl: tx.oppositionPetitionFileUrl, type: 'opposition_petition' });
       
        // Supabase DB yapısına göre Kendi Markamız Mı Kontrolü
        const isOwnRecord = !(
            record.portfoyStatus === 'third_party' || record.portfoyStatus === 'published_in_bulletin' ||
            record.recordStatus === 'third_party' || record.recordStatus === 'published_in_bulletin' ||
            record.status === 'third_party' || record.status === 'published_in_bulletin'
        );
        if (isOwnRecord && String(tx.type) === '20') {
            docs = docs.filter(d => d.type === 'epats_document');
        } else if (isParent) {
            docs = docs.filter(d => d.type !== 'opposition_petition');
        }

        // Karşı Taraf Çözümleme (Eksik ihtimaller eklendi)
        let opponentText = '-';
        if (tx.opponent) opponentText = tx.opponent; // YENİ: Doğrudan opponent alanı varsa al
        else if (tx.oppositionOwner) opponentText = tx.oppositionOwner;
        else if (tx.objectionOwners && tx.objectionOwners.length > 0) opponentText = tx.objectionOwners.map(o => o.name).join(', ');
        else if (tx.taskOwner) {
            if (Array.isArray(tx.taskOwner) && tx.taskOwner.length > 0) {
                opponentText = tx.taskOwner.map(owner => {
                    if (typeof owner === 'object' && owner.name) return owner.name;
                    const person = this.personsMap.get(typeof owner === 'object' ? owner.id : String(owner));
                    return person ? person.name : (typeof owner === 'object' ? owner.id : String(owner));
                }).filter(Boolean).join(', ');
            } else if (typeof tx.taskOwner === 'string') {
                const person = this.personsMap.get(tx.taskOwner);
                opponentText = person ? person.name : tx.taskOwner;
            }
        } 
        
        if (opponentText === '-' && tx.details?.relatedParty?.name) {
            opponentText = tx.details.relatedParty.name;
        }

        return {
            id: tx.id,
            recordId: record.id,
            parentId: parentId,
            isChild: !isParent,
            hasChildren: hasChildren,
            isOwnRecord: isOwnRecord, 
            
            // YENİ: Arayüzün filtreleme (Pasifleri gizle) yapabilmesi için markanın durumunu iletiyoruz
            portfoyStatus: record.portfoyStatus,
            recordStatus: record.recordStatus,
            
            title: record.title || record.brandText || '',
            transactionTypeName: typeInfo?.alias || typeInfo?.name || `İşlem ${tx.type}`,
            applicationNumber: record.applicationNumber || '-',
            applicantName: record.formattedApplicantName || '-',
            opponent: opponentText || '-',
            bulletinNo: tx.bulletinNo || record.details?.brandInfo?.opposedMarkBulletinNo || '-',
            bulletinDate: this._fmtDate(record.details?.brandInfo?.opposedMarkBulletinDate || tx.bulletinDate),
            epatsDate: this._fmtDate(docs.find(d => d.type === 'epats_document')?.documentDate || tx.epatsDocument?.documentDate),
            statusText: this._formatObjectionStatus(tx.requestResult),
            timestamp: tx.timestamp,
            documents: docs
        };
    }

    /**
     * İzleme modülü (Monitoring) için veriyi hazırlar.
     * @param {Object} record - Seçili kayıt objesi
     */
    prepareMonitoringData(record) {
        if (!record) return null;

        // 1. Başvuru sahibini belirle
        let ownerName = record.formattedApplicantName || '';
        if (!ownerName) {
            if (Array.isArray(record.applicants) && record.applicants.length > 0) {
                const app = record.applicants[0];
                ownerName = (typeof app === 'object') ? (app.name || app.companyName || '') : app;
            } else if (record.ownerName) {
                ownerName = record.ownerName;
            }
        }

        // 2. Sınıf Mantığını Kur (1-34 varsa 35 ekle mantığı)
        let originalClasses = [];
        if (record.niceClasses && Array.isArray(record.niceClasses)) {
            originalClasses = [...record.niceClasses];
        }
        if (record.goodsAndServicesByClass && Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(g => {
                if (g.classNo) originalClasses.push(g.classNo);
            });
        }
        
        // Tekrar edenleri temizle ve sırala
        let distinctClasses = [...new Set(originalClasses.map(c => parseInt(c)).filter(n => !isNaN(n)))];
        distinctClasses.sort((a, b) => a - b);

        // Arama için 35. sınıf mantığı (Varsa ekle)
        let searchClasses = [...distinctClasses];
        const hasGoodsClass = searchClasses.some(c => c >= 1 && c <= 34);
        if (hasGoodsClass && !searchClasses.includes(35)) {
            searchClasses.push(35);
            searchClasses.sort((a, b) => a - b);
        }

        // Görsel URL'sini belirle
        // Not: Firebase Storage URL'i veya dış kaynak URL'i olabilir.
        const imgUrl = record.brandImageUrl || record.trademarkImage || null;

        const now = new Date().toISOString();

        // 3. Veritabanı şemasına (Schema) tam uygun obje
        return {
            id: record.id,                   
            relatedRecordId: record.id,      
            
            // İstenen Alan: markName
            markName: record.title || record.brandText || '',
            
            // İstenen Alan: applicationNumber
            applicationNumber: record.applicationNumber || '',
            
            // İstenen Alan: status (Kaydın gerçek durumu: registered, application vb.)
            status: record.status || 'unknown',
            
            // İstenen Alan: image (URL String)
            image: imgUrl, 
            
            // İstenen Alan: ownerName
            ownerName: ownerName,
            
            // İstenen Alan: source
            source: 'portfolio',
            
            // Ekstra gerekli alanlar (Sorgulama ve Arayüz için)
            niceClasses: distinctClasses,       
            niceClassSearch: searchClasses,
            
            // Zaman damgaları
            createdAt: now,
            updatedAt: now
        };
    }

    // --- ACTIONS ---
    async deleteRecord(id) { return await ipRecordsService.deleteParentWithChildren(id); }

    async toggleRecordsStatus(ids) {
        const records = ids.map(id => this.getRecordById(id)).filter(Boolean);
        if(!records.length) return;
        
        // Toggle (aç/kapa) mantığını kaldırıp, sadece 'inactive' (pasif) yapıyoruz
        await Promise.all(records.map(r => 
            ipRecordsService.updateRecord(r.id, { portfoyStatus: 'inactive' })
        ));
    }

    // --- EXPORT ---
    async exportToExcel(data, ExcelJS, saveAs) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Portföy');
        worksheet.columns = [
            { header: 'Başvuru No', key: 'appNo', width: 25 },
            { header: 'Başlık/Marka', key: 'title', width: 40 },
            { header: 'Tür', key: 'type', width: 15 },
            { header: 'Durum', key: 'status', width: 20 },
            { header: 'Başvuru Tarihi', key: 'date', width: 15 },
            { header: 'Başvuru Sahibi', key: 'applicant', width: 40 }
        ];
        data.forEach(r => {
            worksheet.addRow({
                appNo: r.applicationNumber || '-',
                title: r.title || r.brandText || '-',
                type: r.type || '-',
                status: r.status || '-',
                date: this._fmtDate(r.applicationDate),
                applicant: r.formattedApplicantName || '-'
            });
        });
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, `portfoy_export_${new Date().toISOString().slice(0,10)}.xlsx`);
    }

    async exportToPdf(data, html2pdf) {
        const content = document.createElement('div');
        content.innerHTML = `
            <h2 style="text-align:center; font-family:sans-serif;">Portföy Listesi</h2>
            <table border="1" style="width:100%; border-collapse:collapse; font-size:10px; font-family:sans-serif;">
                <thead>
                    <tr style="background:#eee;">
                        <th style="padding:4px;">No</th><th style="padding:4px;">Başlık</th><th style="padding:4px;">Tür</th><th style="padding:4px;">Durum</th><th style="padding:4px;">Sahibi</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(r => `<tr><td style="padding:4px;">${r.applicationNumber||'-'}</td><td style="padding:4px;">${r.title||'-'}</td><td style="padding:4px;">${r.type||'-'}</td><td style="padding:4px;">${r.status||'-'}</td><td style="padding:4px;">${r.formattedApplicantName||'-'}</td></tr>`).join('')}
                </tbody>
            </table>`;
        html2pdf().set({ margin: 10, filename: 'portfoy_listesi.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(content).save();
    }

    // --- HELPERS ---
    _formatObjectionStatus(code) {
        if (!code) return 'Karar Bekleniyor';
        const typeInfo = this.transactionTypesMap.get(String(code));
        return typeInfo ? (typeInfo.alias || typeInfo.name) : 'Karar Bekleniyor';
    }

    _formatNiceClasses(record) {
        const classes = new Set();
        if (Array.isArray(record.niceClasses)) {
            record.niceClasses.forEach(c => classes.add(parseInt(c)));
        }
        if (Array.isArray(record.goodsAndServicesByClass)) {
            record.goodsAndServicesByClass.forEach(item => {
                if (item.classNo) classes.add(parseInt(item.classNo));
            });
        }
        if (classes.size === 0) return '-';
        return Array.from(classes).sort((a, b) => a - b).map(c => c < 10 ? `0${c}` : c).join(', ');
    }

    _fmtDate(val) {
        try {
            if(!val) return '-';
            let d;
            // 1. Eski Firebase Timestamp JSON formatı ise ({"_seconds": ...})
            if (typeof val === 'object' && val._seconds) {
                d = new Date(val._seconds * 1000);
            } 
            // 2. Normal Date veya ISO Metin ise
            else {
                d = val.toDate ? val.toDate() : new Date(val);
            }
            
            if(isNaN(d.getTime())) return '-';
            return d.toLocaleDateString('tr-TR');
        } catch { return '-'; }
    }

    _parseDate(val) {
        if (!val || val === '-') return 0;
        if (val instanceof Date) return val.getTime();

        // Eski Firebase Timestamp JSON formatını yakala
        if (typeof val === 'object' && val._seconds) {
            return val._seconds * 1000;
        }

        if (val && typeof val.toDate === 'function') {
            return val.toDate().getTime();
        }

        if (typeof val !== 'string') return 0;

        if (val.includes('.')) {
            const parts = val.split('.');
            if (parts.length === 3) {
                return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
            }
        }

        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? 0 : parsed;
    }

    getCountryName(code) {
    return this.countriesMap.get(code) || code || '-';
    }


    // --- FILTERS ---
    filterRecords(typeFilter, searchTerm, columnFilters = {}, subTab = null) {
        let sourceData = [];

        if (typeFilter === 'litigation') {
            // Davalar sekmesinde pasifleri gizle
            sourceData = this.litigationRows.filter(r => r.portfoyStatus !== 'inactive' && r.recordStatus !== 'pasif');
        } else if (typeFilter === 'objections') {
            // İtirazlar sekmesinde pasifleri gizle
            sourceData = this.objectionRows.filter(r => r.portfoyStatus !== 'inactive' && r.recordStatus !== 'pasif');
        } else {
            // ANA LİSTE FİLTRESİ
            sourceData = this.allRecords.filter(r => {
                // 1. Üçüncü Şahıs / Bülten ve Pasif Markaları Dinamik Yakalama
                // Veritabanında ayrı bir sütun olmadığı için durumu (status) kontrol ediyoruz.
                const isThirdPartyOrBulletin = 
                    r.portfoyStatus === 'third_party' || r.portfoyStatus === 'published_in_bulletin' ||
                    r.recordStatus === 'third_party' || r.recordStatus === 'published_in_bulletin' ||
                    r.status === 'third_party' || r.status === 'published_in_bulletin';
                
                const isInactive = r.portfoyStatus === 'inactive' || r.recordStatus === 'pasif' || r.status === 'inactive';

                // Eğer pasifse veya bize ait değilse anında listenden at!
                if (isInactive || isThirdPartyOrBulletin) return false;

                // 2. Temel Kontroller (WIPO alt kayıtlarını gizle)
                if ((r.origin === 'WIPO' || r.origin === 'ARIPO') && r.transactionHierarchy === 'child') return false;
                
                // 3. SEKME KONTROLLERİ
                if (typeFilter === 'all') return true;
                
                if (typeFilter === 'trademark') {
                    if (r.type !== 'trademark') return false;

                    // Alt Sekme (SubTab) Kontrolü
                    if (subTab === 'turkpatent') {
                        return r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.country === 'TR');
                    } 
                    if (subTab === 'foreign') {
                        const isTP = r.origin === 'TÜRKPATENT' || r.origin === 'TR' || (!r.origin && r.country === 'TR');
                        return !isTP;
                    }
                    return true;
                }

                // Diğer türler
                return r.type === typeFilter;
            });
        }

        return sourceData.filter(item => {
            // 1. GENEL ARAMA KUTUSU KONTROLÜ
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                
                if (typeFilter === 'objections') {
                    // Önce Ana İşlemde (Parent) ara
                    const matchParent = (
                        (item.transactionTypeName && item.transactionTypeName.toLowerCase().includes(s)) ||
                        (item.title && item.title.toLowerCase().includes(s)) ||
                        (item.opponent && item.opponent.toLowerCase().includes(s)) ||
                        (item.bulletinNo && item.bulletinNo.toString().includes(s)) ||
                        (item.applicantName && item.applicantName.toLowerCase().includes(s)) ||
                        (item.applicationNumber && item.applicationNumber.toString().includes(s)) ||
                        (item.statusText && item.statusText.toLowerCase().includes(s))
                    );
                    
                    // Sonra içine gömdüğümüz Alt İşlemlerde (Child) ara
                    let matchChild = false;
                    if (item.children && item.children.length > 0) {
                        matchChild = item.children.some(c => 
                            (c.transactionTypeName && c.transactionTypeName.toLowerCase().includes(s)) ||
                            (c.statusText && c.statusText.toLowerCase().includes(s)) ||
                            (c.opponent && c.opponent.toLowerCase().includes(s))
                        );
                    }
                    
                    // Eğer ne anada ne de çocukta kelime yoksa, bu satırı direkt ele!
                    if (!matchParent && !matchChild) return false;
                    
                } else {
                    const searchStr = Object.values(item).join(' ').toLowerCase();
                    if (!searchStr.includes(s)) return false;
                }
            }
            
            // 2. SÜTUN (KOLON) FİLTRELERİ KONTROLÜ
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
        // 🔥 YENİ: localeCompare yerine modern ve ultra hızlı sıralama motoru
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
                if (column === 'applicationDate') {
                    const aTs = a.applicationDateTs || 0;
                    const bTs = b.applicationDateTs || 0;
                    return direction === 'asc' ? aTs - bTs : bTs - aTs;
                }
                valA = this._parseDate(valA);
                valB = this._parseDate(valB);
                return direction === 'asc' ? valA - valB : valB - valA;
            }
            
            // YENİ HIZLI KARŞILAŞTIRMA
            const strA = String(valA);
            const strB = String(valB);
            const comparison = collator.compare(strA, strB);
            
            return direction === 'asc' ? comparison : -comparison;
        });
    }
}