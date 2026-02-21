// public/js/persons/PersonDataManager.js
import { db, storage, personService } from '../../firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, deleteDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

export class PersonDataManager {
    async fetchPersons() { return await personService.getPersons(); }
    
    async getCountries() {
        const snap = await getDoc(doc(db, 'common', 'countries'));
        return snap.exists() ? (snap.data().list || snap.data().countries || []) : [];
    }

    async getProvinces(countryCode) {
        if (!/^(TR|TUR)$/i.test(countryCode)) return [];
        for (const docId of ['provinces_TR', 'cities_TR', 'turkey_provinces']) {
            const snap = await getDoc(doc(db, 'common', docId));
            if (snap.exists()) return snap.data().list || snap.data().provinces || [];
        }
        return [];
    }

    async getRelatedPersons(personId) {
        const q = query(collection(db, 'personsRelated'), where('personId', '==', personId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async uploadDocument(file) {
        const path = `person_documents/${Date.now()}_${file.name}`;
        const sRef = ref(storage, path);
        await uploadBytes(sRef, file);
        return await getDownloadURL(sRef);
    }
}