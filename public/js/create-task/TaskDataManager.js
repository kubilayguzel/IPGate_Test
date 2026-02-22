import { ipRecordsService, personService, taskService, transactionTypeService, commonService, supabase } from '../../supabase-config.js';

export class TaskDataManager {
    constructor() {
        this.bulletinDataCache = {};
    }

    // --- BAŞLANGIÇ VERİLERİNİ ÇEKME ---
    async loadInitialData() {
        try {
            const [ipRecords, persons, users, transactionTypes, countries] = await Promise.all([
                this.fetchAllIpRecords(),
                personService.getPersons(),
                taskService.getAllUsers(),
                transactionTypeService.getTransactionTypes(),
                this.getCountries()
            ]);

            return {
                allIpRecords: this._normalizeData(ipRecords),
                allPersons: this._normalizeData(persons),
                allUsers: this._normalizeData(users),
                allTransactionTypes: this._normalizeData(transactionTypes),
                allCountries: countries // Doğrudan normalize edilmiş geliyor
            };
        } catch (error) {
            console.error("Veri yükleme hatası:", error);
            throw error;
        }
    }

    async fetchAllIpRecords() {
        try {
            return await ipRecordsService.getRecords();
        } catch (e) {
            console.error("IP Records fetch error:", e);
            return [];
        }
    }

    async getCountries() {
        try {
            const res = await commonService.getCountries();
            return res.success ? res.data : [];
        } catch (error) {
            console.error("Ülke listesi hatası:", error);
            return [];
        }
    }

    async getCities() {
        try {
            console.log('🔍 getCities() çağrıldı');
            const { data, error } = await supabase.from('common_data').select('data').eq('id', 'cities_TR').single();
            
            if (data && data.data && data.data.list) {
                const rawList = data.data.list;
                console.log(`✅ cities_TR dokümanından ${rawList.length} şehir çekildi`);
                
                if (rawList.length > 0 && typeof rawList[0] === 'string') {
                    return rawList.map(cityName => ({ name: cityName }));
                }
                return rawList;
            }
            return [];
        } catch (error) {
            console.error("❌ getCities hatası:", error);
            return [];
        }
    }

    // --- ARAMA İŞLEMLERİ ---
    async searchBulletinRecords(term) {
        if (!term || term.length < 2) return [];
        
        try {
            // Supabase ilike ile büyük/küçük harf duyarsız arama
            const { data, error } = await supabase
                .from('bulletin_records')
                .select('*')
                .or(`brand_name.ilike.%${term}%,application_number.ilike.%${term}%`)
                .limit(50);

            if (error) throw error;
            return data;
        } catch (err) {
            console.error('Bulletin arama hatası:', err);
            return [];
        }
    }

    async searchSuits(searchText, allowedTypeIds = []) {
        if (!searchText || searchText.length < 2) return [];

        try {
            let query = supabase.from('suits').select('*');

            // JSON içinden de arama yapabilmek için kapsamlı bir OR sorgusu
            query = query.or(`file_no.ilike.%${searchText}%,court_name.ilike.%${searchText}%,plaintiff.ilike.%${searchText}%,defendant.ilike.%${searchText}%`);

            const { data, error } = await query.limit(50);
            if (error) throw error;

            return data.map(doc => {
                const details = doc.details || {};
                return {
                    id: doc.id,
                    ...doc,
                    displayFileNumber: doc.file_no || details.caseNo || doc.fileNumber || '-', 
                    displayCourt: doc.court_name || details.court || doc.court || 'Mahkeme Yok',
                    displayClient: doc.plaintiff || details.client?.name || doc.client || '-', 
                    opposingParty: doc.defendant || details.opposingParty || doc.opposingParty || '-',
                    _source: 'suit' 
                };
            });
        } catch (error) {
            console.error('Dava arama hatası:', error);
            return [];
        }
    }

    async fetchAndStoreBulletinData(bulletinId) {
        if (!bulletinId) return null;
        if (this.bulletinDataCache[bulletinId]) return this.bulletinDataCache[bulletinId];

        try {
            const { data, error } = await supabase.from('trademark_bulletins').select('*').eq('id', bulletinId).single();
            if (error || !data) return null;

            const cacheObj = {
                id: data.id,
                bulletinNo: data.bulletin_no,
                bulletinDate: data.bulletin_date,
                type: data.type
            };
            this.bulletinDataCache[bulletinId] = cacheObj;
            return cacheObj;
        } catch (e) {
            console.error('Bulletin fetch error:', e);
            return null;
        }
    }

    async getAssignmentRule(taskTypeId) {
        if (!taskTypeId) return null;
        try {
            // Eski 'taskAssignments' yapısı yerine şimdilik common_data kullanılıyor
            const { data, error } = await supabase.from('common_data').select('data').eq('id', `task_rule_${taskTypeId}`).single();
            return data ? data.data : null;
        } catch (e) {
            console.error('Assignment rule error:', e);
            return null;
        }
    }

    // --- DOSYA VE RESİM İŞLEMLERİ (Supabase Storage) ---
    async uploadFileToStorage(file, path) {
        if (!file) return null;
        try {
            // URL dostu temiz dosya adı oluştur
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const fullPath = `${Date.now()}_${cleanFileName}`;

            const { error } = await supabase.storage.from('task_documents').upload(fullPath, file);
            if (error) throw error;
            
            const { data } = supabase.storage.from('task_documents').getPublicUrl(fullPath);
            return data.publicUrl;
        } catch (error) {
            console.error("Dosya yükleme hatası:", error);
            return null;
        }
    }

    async resolveImageUrl(path) {
        if (!path) return '';
        if (typeof path === 'string' && path.startsWith('http')) return path;
        const { data } = supabase.storage.from('task_documents').getPublicUrl(path);
        return data ? data.publicUrl : '';
    }

    _normalizeData(result) {
        if (!result) return [];
        return Array.isArray(result.data) ? result.data :
               Array.isArray(result.items) ? result.items :
               (Array.isArray(result) ? result : []);
    }

    // --- TRANSAKSİYONLARI ÇEKME ---
    async getRecordTransactions(recordId, collectionName = 'ipRecords') {
        if (!recordId) return { success: false, message: 'Kayıt ID yok.' };

        console.log(`[TaskDataManager] ${recordId} için transactions çekiliyor...`);

        try {
            // SQL'de transactions tablosu her ikisi için de (dava ve marka) tek bir yerdedir.
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('ip_record_id', recordId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mappedData = data.map(t => ({
                id: t.id,
                ...t.details,
                type: String(t.transaction_type_id || (t.details && t.details.type) || ''),
                creationDate: t.created_at
            }));

            return { success: true, data: mappedData };

        } catch (error) {
            console.error("[TaskDataManager] Transaksiyonlar çekilemedi:", error);
            return { success: false, error: error };
        }
    }
}