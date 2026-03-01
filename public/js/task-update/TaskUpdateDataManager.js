// public/js/task-update/TaskUpdateDataManager.js

import { taskService, ipRecordsService, personService, accrualService, transactionTypeService, supabase } from '../../supabase-config.js';

export class TaskUpdateDataManager {
    
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

    async getTaskById(taskId) {
        const result = await taskService.getTaskById(taskId);
        if (!result.success) throw new Error(result.error);
        return result.data;
    }

    async updateTask(taskId, data) {
        return await taskService.updateTask(taskId, data);
    }

    async getAccrualsByTaskId(taskId) {
        const result = await accrualService.getAccrualsByTaskId(taskId);
        return result.success ? result.data : [];
    }
    
    async saveAccrual(data, isUpdate = false) {
        if (isUpdate) {
            return await accrualService.updateAccrual(data.id, data);
        } else {
            return await accrualService.addAccrual(data);
        }
    }

    // 🔥 Firebase Storage yerine Supabase Storage (Düzeltilmiş Yapı)
    async uploadFile(file, path) {
        // Hedef kova her zaman 'documents'
        const { error } = await supabase.storage.from('documents').upload(path, file);
        if (error) throw error;
        const { data } = supabase.storage.from('documents').getPublicUrl(path);
        return data.publicUrl;
    }

    async deleteFileFromStorage(path) {
        if (!path) return;
        let cleanPath = decodeURIComponent(path);
        
        // Eğer path 'documents/' ile başlıyorsa bunu temizle (from('documents') zaten oraya bakıyor)
        if (cleanPath.startsWith('documents/')) {
            cleanPath = cleanPath.replace('documents/', '');
        }
        
        try {
            await supabase.storage.from('documents').remove([cleanPath]);
            console.log('Dosya Storage\'dan silindi:', cleanPath);
        } catch (error) {
            console.warn('Dosya silme hatası:', error);
        }
    }

    searchIpRecords(allRecords, query) {
        if (!query || query.length < 3) return [];
        const lower = query.toLowerCase();
        return allRecords.filter(r => {
            // Şemaya uygun alanları ara
            const title = (r.title || r.brandName || r.brand_name || '').toLowerCase();
            const appNo = (r.applicationNumber || r.application_number || '').toLowerCase();
            return title.includes(lower) || appNo.includes(lower);
        });
    }

    searchPersons(allPersons, query) {
        if (!query || query.length < 2) return [];
        const lower = query.toLowerCase();
        return allPersons.filter(p => 
            (p.name || '').toLowerCase().includes(lower) || 
            (p.email || '').toLowerCase().includes(lower)
        );
    }

    async updateIpRecord(recordId, data) {
        return await ipRecordsService.updateRecord(recordId, data);
    }

    async findTransactionIdByTaskId(recordId, taskId) {
        try {
            // Şemaya göre alanlar: ip_record_id, task_id
            const { data } = await supabase.from('transactions').select('id').eq('task_id', String(taskId)).maybeSingle();
            return data ? data.id : null;
        } catch (error) {
            return null;
        }
    }

    async updateTransaction(recordId, transactionId, data) {
        try {
            const { error } = await supabase.from('transactions').update(data).eq('id', transactionId);
            if (error) throw error;
            return true;
        } catch(err) {
            console.error("Transaction update error:", err);
            return false;
        }
    }
}