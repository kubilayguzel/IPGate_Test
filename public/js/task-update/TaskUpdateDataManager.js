// public/js/task-update/TaskUpdateDataManager.js

import { taskService, ipRecordsService, personService, accrualService, transactionTypeService, storage, db } from '../../firebase-config.js';
import { ref, uploadBytes, deleteObject, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
// 👇 GÜNCELLEME 1: Eksik importlar eklendi (collection, query, where, getDocs)
import { doc, updateDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

    // --- DOSYA İŞLEMLERİ ---
    async uploadFile(file, path) {
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
    }

    async deleteFileFromStorage(path) {
        if (!path) return; // Path yoksa işlem yapma
        
        // URL encoded karakterleri çöz (Örn: %20 -> Boşluk)
        const decodedPath = decodeURIComponent(path);
        const storageRef = ref(storage, decodedPath);
        
        try {
            await deleteObject(storageRef);
            console.log('Dosya Storage\'dan silindi:', decodedPath);
        } catch (error) {
            if (error.code === 'storage/object-not-found') {
                console.warn('Dosya Storage\'da bulunamadı, veritabanı temizleniyor...', decodedPath);
                return; 
            }
            console.error('Dosya silme hatası:', error);
            throw error;
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

    // --- BÜLTEN DETAY ÇEKME ---
    async fetchBulletinData(bulletinId) {
        console.warn('Bulletin data fetch not implemented completely');
        return null;
    }

    // --- TRANSACTION GÜNCELLEME ---
    async updateTransaction(recordId, transactionId, data) {
        const txRef = doc(db, 'ipRecords', recordId, 'transactions', transactionId);
        return await updateDoc(txRef, data);
    }

    async findTransactionIdByTaskId(recordId, taskId) {
        console.log(`🔎 [DataManager] Transaction Aranıyor... Record: ${recordId}, Task: ${taskId}`);

        try {
            // 1. SADECE YENİ MANTIK: ipRecords koleksiyonunda doğrudan 'taskId' ile ara
            let q = query(
                collection(db, 'ipRecords', recordId, 'transactions'),
                where('taskId', '==', String(taskId))
            );
            let snapshot = await getDocs(q);

            if (!snapshot.empty) {
                const foundId = snapshot.docs[0].id;
                console.log(`   ✅ [DataManager] BULUNDU! Transaction ID: ${foundId}`);
                return foundId;
            }
            
            // 2. BULUNAMAZSA: 'suits' (Dava) koleksiyonuna bak
            console.log(`   ⚠️ ipRecords içinde bulunamadı, 'suits'e bakılıyor...`);
            let qSuit = query(
                collection(db, 'suits', recordId, 'transactions'),
                where('taskId', '==', String(taskId))
            );
            let snapshotSuit = await getDocs(qSuit);

            if (!snapshotSuit.empty) {
                const foundId = snapshotSuit.docs[0].id;
                console.log(`   ✅ [DataManager] BULUNDU! (Dava) Transaction ID: ${foundId}`);
                return foundId;
            }
            
            console.warn("   ❌ [DataManager] Transaction bulunamadı.");
            return null;

        } catch (error) {
            console.error("   🔥 [DataManager] Transaction arama hatası:", error);
            return null;
        }
    }
}