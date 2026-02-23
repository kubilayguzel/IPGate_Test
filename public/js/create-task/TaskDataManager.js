import { ipRecordsService, personService, taskService, transactionTypeService, supabase, commonService } from '../../supabase-config.js';

export class TaskDataManager {
    constructor() {
        this.bulletinDataCache = {};
    }

    async loadInitialData() {
        try {
            const [ipRecords, persons, users, transactionTypes, countries] = await Promise.all([
                this.fetchAllIpRecords(),
                personService.getPersons(),
                taskService.getAllUsers(),
                transactionTypeService.getTransactionTypes(),
                this.getCountries()
            ]);

            // 🔥 ÇÖZÜM BURASI: SQL'den gelen alt_tireli verileri JS'nin beklediği camelCase formata çeviriyoruz.
            // Bu sayede arayüzdeki "Diğer Marka İşlemleri" listesi tıkır tıkır dolacaktır.
            let formattedTransactionTypes = this._normalizeData(transactionTypes).map(t => ({
                ...t,
                ipType: t.ip_type || t.ipType,
                isTopLevelSelectable: t.is_top_level_selectable ?? t.isTopLevelSelectable ?? true,
                applicableToMainType: t.applicable_to_main_type || t.applicableToMainType || []
            }));

            return {
                allIpRecords: this._normalizeData(ipRecords),
                allPersons: this._normalizeData(persons),
                allUsers: this._normalizeData(users),
                allTransactionTypes: formattedTransactionTypes, // Düzenlenmiş listeyi gönderdik
                allCountries: this._normalizeData(countries)
            };
        } catch (error) {
            console.error("Veri yükleme hatası:", error);
            throw error;
        }
    }

    async fetchAllIpRecords() {
        try {
            return await ipRecordsService.getRecords();
        } catch (e) { return []; }
    }

    async getCountries() {
        try {
            const res = await commonService.getCountries();
            return res.success ? res.data : [];
        } catch (error) { return []; }
    }

    async getCities() {
        try {
            const { data, error } = await supabase.from('common').select('data').eq('id', 'cities_TR').single();
            if (data && data.data && data.data.list) {
                const rawList = data.data.list;
                if (rawList.length > 0 && typeof rawList[0] === 'string') {
                    return rawList.map(cityName => ({ name: cityName }));
                }
                return rawList;
            }
            return [];
        } catch (error) { return []; }
    }

    async searchBulletinRecords(term) {
        if (!term || term.length < 2) return [];
        try {
            const { data, error } = await supabase.from('bulletin_records').select('*').or(`brand_name.ilike.%${term}%,application_number.ilike.%${term}%`).limit(50);
            if (error) throw error;
            return data.map(d => ({
                id: d.id,
                ...d,
                markName: d.brand_name,
                applicationNo: d.application_number
            }));
        } catch (err) { return []; }
    }

    async searchSuits(searchText, allowedTypeIds = []) {
        if (!searchText || searchText.length < 2) return [];

        try {
            let query = supabase.from('suits').select('*');
            query = query.or(`file_no.ilike.%${searchText}%,court_name.ilike.%${searchText}%,plaintiff.ilike.%${searchText}%,defendant.ilike.%${searchText}%`);

            const { data, error } = await query.limit(50);
            if (error) throw error;

            return data.map(doc => {
                const details = doc.details || {};
                
                let validMatch = true;
                if (allowedTypeIds && allowedTypeIds.length > 0 && allowedTypeIds.length <= 10) {
                    if (!allowedTypeIds.includes(String(details.transactionTypeId))) validMatch = false;
                }
                
                if(!validMatch) return null;

                return {
                    id: doc.id,
                    ...doc,
                    ...details,
                    displayFileNumber: doc.file_no || details.caseNo || doc.fileNumber || '-', 
                    displayCourt: doc.court_name || details.court || doc.court || 'Mahkeme Yok',
                    displayClient: doc.plaintiff || details.client?.name || doc.client || '-', 
                    opposingParty: doc.defendant || details.opposingParty || doc.opposingParty || '-',
                    _source: 'suit' 
                };
            }).filter(Boolean);
        } catch (error) { return []; }
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
        } catch (e) { return null; }
    }

    async getAssignmentRule(taskTypeId) {
        if (!taskTypeId) return null;
        try {
            // Artık common_data yerine doğrudan kendi tablosuna (task_assignments) gidiyoruz
            const { data, error } = await supabase
                .from('task_assignments')
                .select('*')
                .eq('id', String(taskTypeId))
                .single();
                
            if (error || !data) return null;

            // Arayüzün (main.js) beklediği camelCase formata çevirerek döndürüyoruz
            return {
                transactionTypeId: data.id,
                assignmentType: data.assignment_type,
                assigneeIds: data.assignee_ids,
                allowManualOverride: data.allow_manual_override
            };
        } catch (e) {
            console.error('Assignment rule error:', e);
            return null;
        }
    }

    async uploadFileToStorage(file, path) {
        if (!file || !path) return null;
        try {
            // TaskSubmitHandler'da path zaten zaman damgasıyla geliyor, direkt kullanıyoruz
            const { error } = await supabase.storage.from('task_documents').upload(path, file);
            if (error) throw error;
            
            const { data } = supabase.storage.from('task_documents').getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            console.error("Dosya yükleme hatası:", error);
            return null;
        }
    }

    async resolveImageUrl(path) {
        if (!path) return '';
        if (typeof path === 'string' && path.startsWith('http')) return path;
        try {
            const { data } = supabase.storage.from('brand_images').getPublicUrl(path);
            return data ? data.publicUrl : '';
        } catch { return ''; }
    }

    _normalizeData(result) {
        if (!result) return [];
        return Array.isArray(result.data) ? result.data :
               Array.isArray(result.items) ? result.items :
               (Array.isArray(result) ? result : []);
    }

    async getRecordTransactions(recordId, collectionName = 'ipRecords') {
        if (!recordId) return { success: false, message: 'Kayıt ID yok.' };
        try {
            const { data, error } = await supabase.from('transactions').select('*').eq('ip_record_id', String(recordId)).order('created_at', { ascending: false });
            if (error) throw error;

            const mappedData = data.map(t => ({
                id: t.id,
                ...t.details,
                type: String(t.transaction_type_id || t.details?.type || '') 
            }));

            return { success: true, data: mappedData };
        } catch (error) { return { success: false, error: error }; }
    }
}