import { taskService, ipRecordsService, personService, transactionTypeService, supabase } from '../../supabase-config.js';

export class TaskUpdateDataManager {
    
    // --- GENEL VERİ ÇEKME ---
    async loadAllInitialData() {
        const [ipRecords, persons, users, transactionTypes] = await Promise.all([
            ipRecordsService.getRecords(),
            personService.getPersons(),
            taskService.getAllUsers(),
            transactionTypeService.getTransactionTypes()
        ]);
        
        return {
            ipRecords: ipRecords.data || [],
            persons: persons.data || [],
            users: users.data || [],
            transactionTypes: transactionTypes.data || []
        };
    }

    // --- TASK İŞLEMLERİ ---
    async getTaskById(taskId) {
        const result = await taskService.getTaskById(taskId);
        if (!result.success) throw new Error(result.error);
        return result.data;
    }

    async updateTask(taskId, data) {
        return await taskService.updateTask(taskId, data);
    }

    // --- TAHAKKUK İŞLEMLERİ ---
    async getAccrualsByTaskId(taskId) {
        // Accruals tablosuna bağlandı
        const { data, error } = await supabase.from('accruals').select('*').eq('task_id', String(taskId));
        if (error) {
            console.error("Tahakkuk çekme hatası:", error);
            return [];
        }
        return data;
    }
    
    async saveAccrual(data, isUpdate = false) {
        // Bu kısmı Accrual modülünü geçirdiğimizde kendi servisine bağlayacağız, şimdilik geçici SQL yazıyoruz
        if (isUpdate) {
            const { error } = await supabase.from('accruals').update(data).eq('id', data.id);
            return { success: !error, error };
        } else {
            const { data: newAcc, error } = await supabase.from('accruals').insert(data).select('id').single();
            return { success: !error, data: newAcc, error };
        }
    }

    // --- DOSYA İŞLEMLERİ (Supabase Storage) ---
    async uploadFile(file, path) {
        // Path (dosya yolu) artık main.js'den tam olarak zaman damgasıyla geliyor.
        const { error } = await supabase.storage.from('task_documents').upload(path, file);
        if (error) throw error;
        
        const { data } = supabase.storage.from('task_documents').getPublicUrl(path);
        return data.publicUrl;
    }

    async deleteFileFromStorage(path) {
        if (!path) return;
        
        try {
            // Eğer dosya eski Firebase sisteminden kalmaysa Supabase'de silmeye çalışma
            if (path.includes('firebasestorage')) {
                console.warn('Firebase dosyası Storage üzerinden silinemez, sadece veritabanından kaldırılacak.');
                return;
            }

            let filePath = path;
            if (path.includes('/storage/v1/object/public/task_documents/')) {
                filePath = path.split('/storage/v1/object/public/task_documents/')[1];
            }
            
            const decodedPath = decodeURIComponent(filePath);
            const { error } = await supabase.storage.from('task_documents').remove([decodedPath]);
            
            if (error) throw error;
            console.log('✅ Dosya Supabase Storage\'dan başarıyla fiziksel olarak silindi:', decodedPath);
        } catch (error) {
            console.error('Dosya silme hatası:', error);
        }
    }

    // --- ARAMA İŞLEMLERİ ---
    searchIpRecords(allRecords, query) {
        if (!query || query.length < 3) return [];
        const lower = query.toLowerCase();
        return allRecords.filter(r => 
            (r.title || '').toLowerCase().includes(lower) || 
            (r.applicationNumber || '').toLowerCase().includes(lower)
        );
    }

    searchPersons(allPersons, query) {
        if (!query || query.length < 2) return [];
        const lower = query.toLowerCase();
        return allPersons.filter(p => 
            (p.name || '').toLowerCase().includes(lower) || 
            (p.email || '').toLowerCase().includes(lower)
        );
    }

    // --- IP RECORD GÜNCELLEME ---
    async updateIpRecord(recordId, data) {
        return await ipRecordsService.updateRecord(recordId, data);
    }

    async fetchBulletinData(bulletinId) {
        return null;
    }

    // --- TRANSACTION GÜNCELLEME ---
    async updateTransaction(recordId, transactionId, data) {
        const { error } = await supabase.from('transactions').update({ details: data }).eq('id', transactionId);
        return !error;
    }

    async findTransactionIdByTaskId(recordId, taskId) {
        console.log(`🔎 [DataManager] Transaction Aranıyor... Record: ${recordId}, Task: ${taskId}`);

        try {
            // JSONB 'details' içindeki taskId key'ine bakarak bulma (Güçlü Supabase Özelliği)
            const { data, error } = await supabase
                .from('transactions')
                .select('id')
                .eq('ip_record_id', recordId)
                .eq('details->>taskId', String(taskId))
                .limit(1);

            if (data && data.length > 0) {
                console.log(`   ✅ [DataManager] BULUNDU! Transaction ID: ${data[0].id}`);
                return data[0].id;
            }
            
            console.warn("   ❌ [DataManager] Transaction bulunamadı.");
            return null;

        } catch (error) {
            console.error("   🔥 [DataManager] Transaction arama hatası:", error);
            return null;
        }
    }
}