// public/js/portfolio/TransactionHelper.js
import { db } from '../../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export class TransactionHelper {

    // Basit in-memory cache (sayfa ömrü boyunca)
    static _taskCache = new Map();        // taskId -> taskData | null
    static _taskPromiseCache = new Map(); // taskId -> Promise<taskData|null>

    /**
     * Task dokümanları için tekilleştirilmiş fetch (aynı taskId tekrar istenirse cache kullanır).
     */
    static async getTaskData(taskId) {
        if (!taskId) return null;
        if (this._taskCache.has(taskId)) return this._taskCache.get(taskId);
        if (this._taskPromiseCache.has(taskId)) return this._taskPromiseCache.get(taskId);

        const p = (async () => {
            try {
                const taskRef = doc(db, 'tasks', taskId);
                const taskSnap = await getDoc(taskRef);
                const data = taskSnap.exists() ? taskSnap.data() : null;
                this._taskCache.set(taskId, data);
                return data;
            } catch (e) {
                console.warn(`Task belge çekme hatası (ID: ${taskId}):`, e);
                this._taskCache.set(taskId, null);
                return null;
            } finally {
                this._taskPromiseCache.delete(taskId);
            }
        })();

        this._taskPromiseCache.set(taskId, p);
        return p;
    }

    /**
     * Transaction üzerindeki (task'a gitmeden) direkt belgeleri normalize eder.
     */
    static getDirectDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        const addDoc = (d) => {
            const url = d.fileUrl || d.url || d.path || d.downloadURL;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    name: d.fileName || d.name || 'Belge',
                    url,
                    type: d.type || 'document',
                    source: 'direct'
                });
            }
        };

        if (Array.isArray(transaction.documents)) {
            transaction.documents.forEach(addDoc);
        }

        if (transaction.relatedPdfUrl) {
            addDoc({ name: 'Resmi Yazı', url: transaction.relatedPdfUrl, type: 'official' });
        }
        if (transaction.oppositionPetitionFileUrl) {
            addDoc({ name: 'İtiraz Dilekçesi', url: transaction.oppositionPetitionFileUrl, type: 'petition' });
        }
        if (transaction.oppositionEpatsPetitionFileUrl) {
            addDoc({ name: 'Karşı ePATS Dilekçesi', url: transaction.oppositionEpatsPetitionFileUrl, type: 'epats' });
        }

        return docs;
    }

    /**
     * Sadece task üzerinden gelen belgeleri getirir (cache'li).
     */
    static async getTaskDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        const addDoc = (d) => {
            const url = d.fileUrl || d.url || d.path || d.downloadURL;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    name: d.fileName || d.name || 'Belge',
                    url,
                    type: d.type || 'document',
                    source: 'task'
                });
            }
        };

        if (!transaction.triggeringTaskId) return docs;
        const taskData = await this.getTaskData(transaction.triggeringTaskId);
        if (!taskData) return docs;

        if (taskData.details?.epatsDocument?.downloadURL) {
            addDoc({
                name: taskData.details.epatsDocument.name || 'ePats Belgesi',
                url: taskData.details.epatsDocument.downloadURL,
                type: 'epats'
            });
        }
        if (Array.isArray(taskData.documents)) {
            taskData.documents.forEach(d => addDoc(d));
        }
        return docs;
    }
    
    /**
     * Bir transaction için tüm ilişkili belgeleri (Kendi belgeleri + Task belgeleri) toplar.
     * @param {Object} transaction - İşlem verisi
     * @returns {Promise<Array>} - Normalize edilmiş belge listesi
     */
    static async getDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        // Belge ekleme yardımcısı (Duplicate önler)
        const addDoc = (d, source) => {
            const url = d.fileUrl || d.url || d.path || d.downloadURL;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({
                    name: d.fileName || d.name || 'Belge',
                    url: url,
                    type: d.type || 'document',
                    source: source // 'direct' veya 'task' (renk ayrımı için)
                });
            }
        };

        // 1. Transaction üzerindeki direkt belgeler (Öncelikli)
        if (Array.isArray(transaction.documents)) {
            transaction.documents.forEach(d => addDoc(d, 'direct'));
        }
        
        // Özel alanlardaki belgeler
        if (transaction.relatedPdfUrl) {
            addDoc({ name: 'Resmi Yazı', url: transaction.relatedPdfUrl, type: 'official' }, 'direct');
        }
        if (transaction.oppositionPetitionFileUrl) {
            addDoc({ name: 'İtiraz Dilekçesi', url: transaction.oppositionPetitionFileUrl, type: 'petition' }, 'direct');
        }
        if (transaction.oppositionEpatsPetitionFileUrl) {
            addDoc({ name: 'Karşı ePATS Dilekçesi', url: transaction.oppositionEpatsPetitionFileUrl, type: 'epats' }, 'direct');
        }

        // 2. Task (Görev) üzerindeki belgeler (Fallback)
        // Eğer transaction bir Task tarafından tetiklendiyse (triggeringTaskId)
        if (transaction.triggeringTaskId) {
            const taskData = await this.getTaskData(transaction.triggeringTaskId);
            if (taskData) {
                // ePats Belgesi
                if (taskData.details?.epatsDocument?.downloadURL) {
                    addDoc({
                        name: taskData.details.epatsDocument.name || 'ePats Belgesi',
                        url: taskData.details.epatsDocument.downloadURL,
                        type: 'epats'
                    }, 'task');
                }

                // Task Documents Array
                if (Array.isArray(taskData.documents)) {
                    taskData.documents.forEach(d => addDoc(d, 'task'));
                }
            }
        }

        return docs;
    }

    /**
     * Parent-Child ilişkisini kurar ve sıralar.
     */
    static organizeTransactions(transactions) {
        const parents = transactions.filter(t => t.transactionHierarchy === 'parent' || !t.parentId);
        const childrenMap = {};

        transactions.forEach(t => {
            if (t.parentId) {
                if (!childrenMap[t.parentId]) childrenMap[t.parentId] = [];
                childrenMap[t.parentId].push(t);
            }
        });

        // Tarihe göre sırala
        const sortByDate = (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
        parents.sort(sortByDate);
        Object.values(childrenMap).forEach(list => list.sort(sortByDate));

        return { parents, childrenMap };
    }
}