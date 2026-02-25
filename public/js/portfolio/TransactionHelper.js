// public/js/portfolio/TransactionHelper.js
export class TransactionHelper {
    
    // İşlemle (Transaction) Doğrudan İlişkili Evrakları Okur
    static getDirectDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();

        const addDoc = (d, source = 'direct') => {
            if (!d) return;
            // Veritabanınızın yapısına tam uygun URL yakalama (document_url eklendi)
            const url = d.document_url || d.file_url || d.url || d.fileUrl || d.downloadURL || d.path;
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({ 
                    name: d.document_name || d.file_name || d.name || d.fileName || 'Belge', 
                    url, 
                    type: d.document_type || d.type || 'document', 
                    source 
                });
            }
        };

        // 1. ASIL HEDEF: 'transaction_documents' tablosundan gelen belgeler
        if (Array.isArray(transaction.transaction_documents)) {
            transaction.transaction_documents.forEach(td => addDoc(td, 'direct'));
        }

        // 2. Yedek (JSON/Legacy) belgeler
        if (Array.isArray(transaction.documents)) {
            transaction.documents.forEach(d => addDoc(d, 'direct'));
        }

        // 3. Statik linkler
        if (transaction.relatedPdfUrl || transaction.related_pdf_url) addDoc({ name: 'Resmi Yazı', url: transaction.relatedPdfUrl || transaction.related_pdf_url, type: 'official' }, 'direct');
        if (transaction.oppositionPetitionFileUrl || transaction.opposition_petition_file_url) addDoc({ name: 'İtiraz Dilekçesi', url: transaction.oppositionPetitionFileUrl || transaction.opposition_petition_file_url, type: 'petition' }, 'direct');
        if (transaction.oppositionEpatsPetitionFileUrl || transaction.opposition_epats_petition_file_url) addDoc({ name: 'Karşı ePATS Dilekçesi', url: transaction.oppositionEpatsPetitionFileUrl || transaction.opposition_epats_petition_file_url, type: 'epats' }, 'direct');

        return docs;
    }

    // Görev (Task) JSONB'si İçindeki Resim/PDF'leri Okur
    static async getTaskDocuments(transaction) {
        const docs = [];
        const seenUrls = new Set();
        
        // İşleme bağlanmış görev verisini al (Yepyeni Relational Yapı)
        const taskData = transaction.task_data;
        if (!taskData) return docs;

        const addDoc = (d, source = 'task') => {
            if (!d) return;
            const url = d.url || d.downloadURL || d.fileUrl || d.path; 
            if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                docs.push({ name: d.name || d.fileName || 'Belge', url, type: d.type || 'document', source });
            }
        };

        // Gönderdiğiniz örnekteki JSONB formatını diziye çevir
        let taskDocs = taskData.documents;
        if (typeof taskDocs === 'string') {
            try { taskDocs = JSON.parse(taskDocs); } catch(e) { taskDocs = []; }
        }

        // 1. Resim (JPG) ve PDF'leri (Gönderdiğiniz JSON formatı) Ekle
        if (Array.isArray(taskDocs)) {
            taskDocs.forEach(d => addDoc(d, 'task'));
        }

        // 2. Yassı ePATS Belgesi
        if (taskData.epats_doc_url || taskData.epats_doc_download_url) {
            addDoc({ 
                name: taskData.epats_doc_name || 'ePats Belgesi', 
                url: taskData.epats_doc_url || taskData.epats_doc_download_url, 
                type: 'epats' 
            }, 'task');
        }

        // 3. Legacy (Eski) Detail JSON Yedekleri
        if (taskData.details) {
            if (taskData.details.epatsDocument) addDoc(taskData.details.epatsDocument, 'task');
            if (Array.isArray(taskData.details.documents)) taskData.details.documents.forEach(d => addDoc(d, 'task'));
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

        // Tarih sıralaması
        const sortByDate = (a, b) => new Date(a.timestamp || a.date || a.created_at || 0) - new Date(b.timestamp || b.date || b.created_at || 0);
        parents.sort(sortByDate);
        Object.values(childrenMap).forEach(list => list.sort(sortByDate));

        return { parents, childrenMap };
    }
}