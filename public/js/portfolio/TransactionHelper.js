import { supabase } from '../../supabase-config.js';

export class TransactionHelper {
    static _taskCache = new Map();        
    static _taskPromiseCache = new Map(); 

    static async getTaskData(taskId) {
        if (!taskId) return null;
        if (this._taskCache.has(taskId)) return this._taskCache.get(taskId);
        if (this._taskPromiseCache.has(taskId)) return this._taskPromiseCache.get(taskId);

        const p = (async () => {
            try {
                const { data, error } = await supabase.from('tasks').select('*').eq('id', String(taskId)).single();
                if (error || !data) {
                    this._taskCache.set(taskId, null);
                    return null;
                }
                this._taskCache.set(taskId, data);
                return data;
            } catch (e) {
                this._taskCache.set(taskId, null);
                return null;
            } finally {
                this._taskPromiseCache.delete(taskId);
            }
        })();

        this._taskPromiseCache.set(taskId, p);
        return p;
    }

    static getDirectDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        const addDoc = (d) => {
            const url = d.fileUrl || d.url || d.path || d.downloadURL;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({ name: d.fileName || d.name || 'Belge', url, type: d.type || 'document', source: 'direct' });
            }
        };

        if (Array.isArray(transaction.documents)) transaction.documents.forEach(addDoc);
        if (transaction.relatedPdfUrl) addDoc({ name: 'Resmi Yazı', url: transaction.relatedPdfUrl, type: 'official' });
        if (transaction.oppositionPetitionFileUrl) addDoc({ name: 'İtiraz Dilekçesi', url: transaction.oppositionPetitionFileUrl, type: 'petition' });
        if (transaction.oppositionEpatsPetitionFileUrl) addDoc({ name: 'Karşı ePATS Dilekçesi', url: transaction.oppositionEpatsPetitionFileUrl, type: 'epats' });

        return docs;
    }

    static async getTaskDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();
        let taskData = null;
        
        // 1. Transaction içinde Task ID varsa
        const taskId = transaction.task_id || transaction.triggeringTaskId || transaction.triggering_task_id || (transaction.details && transaction.details.triggeringTaskId);
        
        if (taskId) {
            taskData = await this.getTaskData(taskId);
        } 
        // 2. Task tablosu içinde Transaction ID'si yazıyorsa (Ters Bağlantı)
        else if (transaction.id) {
            try {
                const { data } = await supabase.from('tasks').select('*').eq('transaction_id', transaction.id).limit(1);
                if (data && data.length > 0) taskData = data[0];
            } catch(e) {}
        }

        if (!taskData) return docs;

        const addDoc = (d) => {
            if (!d) return;
            const url = d.url || d.downloadURL || d.fileUrl || d.path; 
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({ name: d.name || d.fileName || 'Belge', url, type: d.type || 'document', source: 'task' });
            }
        };
        
        // Gönderdiğiniz JSONB formatını yakala
        let taskDocs = taskData.documents;
        if (typeof taskDocs === 'string') {
            try { taskDocs = JSON.parse(taskDocs); } catch(e) { taskDocs = []; }
        }

        if (Array.isArray(taskDocs)) {
            taskDocs.forEach(d => addDoc(d));
        }

        if (taskData.epats_doc_url || taskData.epats_doc_download_url) {
            addDoc({ name: taskData.epats_doc_name || 'ePats Belgesi', url: taskData.epats_doc_url || taskData.epats_doc_download_url, type: 'epats' });
        }

        if (taskData.details) {
            if (taskData.details.epatsDocument) addDoc(taskData.details.epatsDocument);
            if (Array.isArray(taskData.details.documents)) taskData.details.documents.forEach(d => addDoc(d));
        }

        return docs;
    }

    static async getDocuments(transaction) {
        const directDocs = this.getDirectDocuments(transaction);
        const taskDocs = await this.getTaskDocuments(transaction);
        return [...directDocs, ...taskDocs];
    }

    static organizeTransactions(transactions) {
        const parents = transactions.filter(t => t.transactionHierarchy === 'parent' || !t.parentId);
        const childrenMap = {};

        transactions.forEach(t => {
            if (t.parentId) {
                if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                childrenMap[t.parentId].push(t);
            }
        });

        const sortByDate = (a, b) => new Date(a.timestamp || a.date || a.created_at || 0) - new Date(b.timestamp || b.date || b.created_at || 0);
        parents.sort(sortByDate);
        Object.values(childrenMap).forEach(list => list.sort(sortByDate));

        return { parents, childrenMap };
    }
}