import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// TODO: Kendi URL ve Anon Key'inizi buraya girin
const supabaseUrl = 'https://guicrctynauzxhyfpdfe.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1aWNyY3R5bmF1enhoeWZwZGZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDQ3MjcsImV4cCI6MjA4NzI4MDcyN30.Zp1ZoXfsz6y6UcZtOAWlIWY2USjJ8x-0iogtizX0EkQ';

export const supabase = createClient(supabaseUrl, supabaseKey);
console.log('🚀 Supabase Motoru Başarıyla Çalıştı!');

// --- YENİ: Sınırsız Önbellek (IndexedDB) Motoru ---
export const localCache = {
    async get(key) {
        return new Promise((resolve) => {
            const req = indexedDB.open('IPGateDB', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('store');
            req.onsuccess = (e) => {
                try {
                    const db = e.target.result;
                    const tx = db.transaction('store', 'readonly');
                    const req2 = tx.objectStore('store').get(key);
                    req2.onsuccess = () => resolve(req2.result ? JSON.parse(req2.result) : null);
                    req2.onerror = () => resolve(null);
                } catch(err) { resolve(null); }
            };
            req.onerror = () => resolve(null);
        });
    },
    async set(key, value) {
        return new Promise((resolve) => {
            const req = indexedDB.open('IPGateDB', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('store');
            req.onsuccess = (e) => {
                try {
                    const db = e.target.result;
                    const tx = db.transaction('store', 'readwrite');
                    tx.objectStore('store').put(JSON.stringify(value), key);
                    tx.oncomplete = () => resolve(true);
                } catch(err) { resolve(false); }
            };
        });
    },
    async remove(key) {
        return new Promise((resolve) => {
            const req = indexedDB.open('IPGateDB', 1);
            req.onsuccess = (e) => {
                try {
                    const db = e.target.result;
                    const tx = db.transaction('store', 'readwrite');
                    tx.objectStore('store').delete(key);
                    tx.oncomplete = () => resolve(true);
                } catch(err) { resolve(false); }
            };
        });
    }
};

// MOTORU GLOBAL HALE GETİREN SATIR (Parantezlerin DIŞINDA olmalı)
window.localCache = localCache;

// --- YENİ: SUPABASE AUTH SERVICE ---
export const authService = {
    // Supabase bağlantı durumunu kontrol etmek için
    isSupabaseAvailable: true, 

    async signIn(email, password) {
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });
            if (error) throw error;

            // 🌟 YENİ: Gerçek 'users' tablosundan rol ve yetkileri çekiyoruz
            let profileData = { role: 'user', is_super_admin: false, display_name: '' };
            const { data: profile } = await supabase.from('users').select('*').eq('email', data.user.email).single();
            
            if (profile) {
                profileData = profile;
            }

            const userData = { 
                uid: data.user.id, 
                email: data.user.email, 
                displayName: profileData.display_name || data.user.user_metadata?.display_name || '', 
                role: profileData.role, 
                isSuperAdmin: profileData.is_super_admin 
            };
            
            localStorage.setItem('currentUser', JSON.stringify(userData));
            
            return { success: true, user: userData, message: "Giriş başarılı!" };
        } catch (error) {
            console.error("Giriş hatası:", error);
            return { success: false, error: "Hatalı e-posta veya şifre." };
        }
    },

    async signUp(email, password, displayName, initialRole = 'belirsiz') {
        try {
            // Supabase'de displayName gibi ekstra veriler 'user_metadata' içine yazılır
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        display_name: displayName,
                        role: initialRole
                    }
                }
            });
            if (error) throw error;
            return { success: true, message: "Kayıt başarılı! E-postanızı doğrulayın." };
        } catch (error) {
            console.error("Kayıt hatası:", error);
            return { success: false, error: error.message };
        }
    },

    async signOut() {
        await supabase.auth.signOut();
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    },

    async resetPassword(email) {
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email);
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    getCurrentUser() {
        const localData = localStorage.getItem('currentUser');
        return localData ? JSON.parse(localData) : null;
    }
};

// ==========================================
// YÖNLENDİRME VE OTURUM BEKLEME YARDIMCILARI
// ==========================================

export async function waitForAuthUser({ requireAuth = true, redirectTo = 'index.html', graceMs = 0 } = {}) {
    const user = authService.getCurrentUser();
    
    if (requireAuth && !user) {
        console.warn("Kullanıcı oturumu bulunamadı, logine dönülüyor...");
        window.location.href = redirectTo;
        return null;
    }
    return user;
}

export function redirectOnLogout(redirectTo = 'index.html', graceMs = 0) {
    window.addEventListener('storage', (e) => {
        if (e.key === 'currentUser' && !e.newValue) {
            window.location.href = redirectTo;
        }
    });
}

// ==========================================
// PORTFÖY VE ORTAK MODÜL SERVİSLERİ
// ==========================================

// 1. KİŞİLER (PERSONS) SERVİSİ
export const personService = {
    async getPersons() {
        const { data, error } = await supabase.from('persons').select('*').order('name', { ascending: true });
        if (error) {
            console.error("Kişiler çekilemedi:", error);
            return { success: false, error: error.message };
        }
        
        // SQL formatını Arayüzün beklediği CamelCase formata çevir
        const mappedData = data.map(p => ({
            id: p.id, name: p.name, type: p.person_type, tckn: p.tckn, taxNo: p.tax_no, tpeNo: p.tpe_no,
            email: p.email, phone: p.phone, address: p.address, countryCode: p.country_code, province: p.province,
            is_evaluation_required: p.is_evaluation_required, documents: p.documents || [],
            ...p.details // Geri kalan her şey (JSONB)
        }));
        return { success: true, data: mappedData };
    },

    async getPersonById(id) {
        const { data, error } = await supabase.from('persons').select('*').eq('id', id).single();
        if (error) return { success: false, error: error.message };
        const mappedData = {
            id: data.id, name: data.name, type: data.person_type, tckn: data.tckn, taxNo: data.tax_no, tpeNo: data.tpe_no,
            email: data.email, phone: data.phone, address: data.address, countryCode: data.country_code, province: data.province,
            is_evaluation_required: data.is_evaluation_required, documents: data.documents || [], ...data.details
        };
        return { success: true, data: mappedData };
    },

    async addPerson(personData) {
        const payload = {
            name: personData.name, person_type: personData.type, tckn: personData.tckn || null, tax_no: personData.taxNo || null,
            tpe_no: personData.tpeNo || null, email: personData.email || null, phone: personData.phone || null,
            address: personData.address || null, country_code: personData.countryCode || null, province: personData.province || null,
            is_evaluation_required: personData.is_evaluation_required || false, documents: personData.documents || [], details: personData
        };
        const { data, error } = await supabase.from('persons').insert(payload).select('id').single();
        if (error) return { success: false, error: error.message };
        return { success: true, data: { id: data.id } };
    },

    async updatePerson(id, personData) {
        const payload = {
            name: personData.name, 
            type: personData.type, 
            tckn: personData.tckn || null, 
            birth_date: personData.birthDate || null,
            tax_no: personData.taxNo || null,
            tpe_no: personData.tpeNo || null, 
            email: personData.email || null, 
            phone: personData.phone || null,
            address: personData.address || null, 
            country_code: personData.countryCode || null, 
            country_name: personData.countryName || null,
            province: personData.province || null, 
            is_evaluation_required: personData.is_evaluation_required || false,
            documents: personData.documents || [],
            updated_at: new Date().toISOString()
        };
        
        // Boş string ('') gelen verileri veritabanı format hatası vermesin diye null yapıyoruz
        Object.keys(payload).forEach(key => { 
            if (payload[key] === undefined || payload[key] === '') {
                payload[key] = null; 
            }
        });

        console.log("🟢 SUPABASE'E GÖNDERİLEN UPDATE PAKETİ:", payload);

        // Update işlemini yap ve sonucunu (select ile) geri döndür ki hatayı görelim
        const { data, error } = await supabase.from('persons').update(payload).eq('id', id).select();
        
        if (error) {
            console.error("🔴 SUPABASE UPDATE HATASI:", error);
            // Hatayı fırlatarak arayüzün sahte başarılı mesajı vermesini engelliyoruz
            alert("Kayıt Başarısız: " + error.message);
            return { success: false, error: error.message };
        }
        
        return { success: true };
    },

    async deletePerson(id) {
        const { error } = await supabase.from('persons').delete().eq('id', id);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // --- İLGİLİ KİŞİLER (RELATED PERSONS & TO/CC) SERVİSİ ---
    async getRelatedPersons(personId) {
        const { data, error } = await supabase.from('persons_related').select('*').eq('person_id', personId);
        if (error) return [];
        return data; 
    },

    async saveRelatedPersons(personId, draft, loaded, toDelete) {
        try {
            // 1. Silinecekler
            if (toDelete && toDelete.length > 0) {
                const { error } = await supabase.from('persons_related').delete().in('id', toDelete);
                if (error) throw error;
            }
            
            // 2. Güncellenecekler
            if (loaded && loaded.length > 0) {
                for (const r of loaded) {
                    if (r.id) {
                        // Veritabanı ID'si ve Person_ID'sini ayırıp kalanları güncelliyoruz
                        const { id, person_id, created_at, ...updateData } = r;
                        Object.keys(updateData).forEach(key => { 
                            if (updateData[key] === undefined || updateData[key] === '') updateData[key] = null; 
                        });
                        const { error } = await supabase.from('persons_related').update(updateData).eq('id', id);
                        if (error) throw error;
                    }
                }
            }
            
            // 3. Yeni Eklenecekler
            if (draft && draft.length > 0) {
                const inserts = draft.map(d => ({
                    id: crypto.randomUUID(), // 🔥 YENİ: ID'yi manuel olarak üretiyoruz
                    person_id: personId, 
                    name: d.name || null, 
                    email: d.email || null, 
                    phone: d.phone || null,
                    resp_trademark: d.resp_trademark || false, 
                    resp_patent: d.resp_patent || false, 
                    resp_design: d.resp_design || false, 
                    resp_litigation: d.resp_litigation || false, 
                    resp_finance: d.resp_finance || false,
                    notify_trademark_to: d.notify_trademark_to || false, 
                    notify_trademark_cc: d.notify_trademark_cc || false,
                    notify_patent_to: d.notify_patent_to || false, 
                    notify_patent_cc: d.notify_patent_cc || false,
                    notify_design_to: d.notify_design_to || false, 
                    notify_design_cc: d.notify_design_cc || false,
                    notify_finance_to: d.notify_finance_to || false, 
                    notify_finance_cc: d.notify_finance_cc || false
                }));
                const { error } = await supabase.from('persons_related').insert(inserts);
                if (error) throw error;
            }
            return { success: true };
        } catch(e) {
            console.error("🔴 RELATED PERSONS KAYIT HATASI:", e);
            return { success: false, error: e.message };
        }
    }
};

// 2. İŞLEM TİPLERİ (TRANSACTION TYPES) SERVİSİ
export const transactionTypeService = {
    async getTransactionTypes() {
        const { data, error } = await supabase.from('transaction_types').select('*');
        if (error) return { success: false, data: [] };
        
        const mappedData = data.map(t => ({
            id: t.id,
            name: t.name,
            alias: t.alias,
            
            // 🔥 KRİTİK DÜZELTME: Arayüzün formu açabilmesi için ipType verisini ekledik
            ipType: t.ip_type, 
            ip_type: t.ip_type, 
            
            // Veritabanındaki dizi tipini (array) arayüze uygun formata taşıyoruz
            applicableToMainType: t.applicable_to_main_type || (t.ip_type ? [t.ip_type] : []),
            hierarchy: t.hierarchy,
            isTopLevelSelectable: t.is_top_level_selectable,
            code: t.id, 
            ...t.details 
        }));
        return { success: true, data: mappedData };
    }
};

// 3. ORTAK (COMMON) VERİLER SERVİSİ
export const commonService = {
    async getCountries() {
        const { data, error } = await supabase.from('common').select('data').eq('id', 'countries').single();
        if (error || !data) return { success: false, data: [] };
        // Veriyi JSONB olarak kaydetmiştik, aynen çıkarıyoruz
        return { success: true, data: data.data.list || [] };
    }
};

// 4. PORTFÖY (IP RECORDS) SERVİSİ
export const ipRecordsService = {
    // A) Tüm Portföyü Getir
    async getRecords(forceRefresh = false) {
        const CACHE_KEY = 'ip_records_cache';
        const TTL_MS = 30 * 60 * 1000; // 30 Dakika Önbellek

        if (!forceRefresh) {
            const cachedObj = await localCache.get(CACHE_KEY);
            if (cachedObj && cachedObj.timestamp && cachedObj.data) {
                if ((Date.now() - cachedObj.timestamp) < TTL_MS) {
                    return { success: true, data: cachedObj.data, from: 'cache' };
                }
            }
        }

        // 🔥 DÜZELTME VE HIZLANDIRMA: 
        // 10.000 satır için devasa 'items' (eşya metinlerini) ÇEKMİYORUZ. Sadece class_no alıyoruz.
        const { data, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_applicants ( persons ( id, name, type ) ),
                ip_record_classes ( class_no )
            `)
            .limit(10000)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Markalar çekilemedi:", error);
            return { success: false, data: [] };
        }

        const mappedData = data.map(record => {
            let applicantsArray = record.ip_record_applicants
                ? record.ip_record_applicants.filter(rel => rel.persons).map(rel => ({
                    id: rel.persons.id, name: rel.persons.name, personType: rel.persons.type
                })) : [];

            let detailsObj = record.details || {};
            if (applicantsArray.length === 0 && Array.isArray(detailsObj.applicants)) applicantsArray = detailsObj.applicants;

            let classesArray = [];
            if (record.ip_record_classes && record.ip_record_classes.length > 0) {
                classesArray = record.ip_record_classes.map(c => parseInt(c.class_no)).filter(n => !isNaN(n));
            }
            if (classesArray.length === 0 && record.nice_classes) {
                let nc = record.nice_classes;
                if (typeof nc === 'string') {
                    try { nc = JSON.parse(nc); } catch(e) { nc = nc.split(',').map(x => x.trim()); }
                }
                classesArray = Array.isArray(nc) ? nc.map(x=>parseInt(x)).filter(n=>!isNaN(n)) : [];
            }

            return {
                id: record.id, 
                applicationNumber: record.application_number || detailsObj.applicationNumber, 
                applicationDate: record.application_date || detailsObj.applicationDate,
                registrationNumber: record.registration_number || detailsObj.registrationNumber, 
                registrationDate: record.registration_date || detailsObj.registrationDate, 
                renewalDate: record.renewal_date || detailsObj.renewalDate,
                title: record.title || record.brand_name || detailsObj.title || detailsObj.brandText, 
                brandText: record.title || record.brand_name || detailsObj.title || detailsObj.brandText, 
                type: record.type || record.ip_type || detailsObj.type, 
                status: record.status || record.official_status || detailsObj.status,
                recordStatus: record.portfolio_status || detailsObj.portfoyStatus, 
                portfoyStatus: record.portfolio_status || detailsObj.portfoyStatus, 
                origin: record.origin || detailsObj.origin, 
                country: record.country_code || record.country || detailsObj.country,
                niceClasses: classesArray,
                wipoIR: record.wipo_ir || detailsObj.wipoIR, 
                aripoIR: record.aripo_ir || detailsObj.aripoIR, 
                transactionHierarchy: record.transaction_hierarchy || detailsObj.transactionHierarchy,
                brandImageUrl: record.brand_image_url || detailsObj.brandImageUrl, 
                trademarkImage: record.brand_image_url || detailsObj.brandImageUrl, 
                applicants: applicantsArray,
                applicantName: record.applicant_name || record.owner_name || detailsObj.applicantName || detailsObj.ownerName,
                recordOwnerType: record.record_owner_type || detailsObj.recordOwnerType || 'self', 
                details: detailsObj,                
                createdAt: record.created_at, 
                updatedAt: record.updated_at
            };
        });

        await localCache.set(CACHE_KEY, { timestamp: Date.now(), data: mappedData });
        return { success: true, data: mappedData, from: 'server' };
    },

    // B) Tek Bir Markayı Çeker (DETAY SAYFASI İÇİN - BURADA 'items' ÇEKİLİR)
    async getRecordById(id) {
        const { data: record, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_applicants ( persons ( id, name, type, address ) ),
                ip_record_classes ( class_no, items )
            `)
            .eq('id', id)
            .single();

        if (error) return { success: false, error: error.message };

        let detailsObj = record.details || {};
        
        let applicantsArray = record.ip_record_applicants
            ? record.ip_record_applicants.filter(rel => rel.persons).map(rel => ({
                id: rel.persons.id, name: rel.persons.name, personType: rel.persons.type, address: rel.persons.address
            })) : [];
        if (applicantsArray.length === 0 && Array.isArray(detailsObj.applicants)) applicantsArray = detailsObj.applicants;

        let gsbc = [];
        if (record.ip_record_classes && record.ip_record_classes.length > 0) {
            gsbc = record.ip_record_classes.map(c => {
                let itemsArray = c.items || [];
                if (typeof itemsArray === 'string') {
                    try { itemsArray = JSON.parse(itemsArray); } catch(e) { itemsArray = [itemsArray]; }
                }
                if (!Array.isArray(itemsArray)) itemsArray = [itemsArray];
                return { classNo: c.class_no, items: itemsArray };
            });
        } else if (detailsObj.goodsAndServicesByClass) {
            gsbc = detailsObj.goodsAndServicesByClass;
        }

        let classesArray = gsbc.map(g => g.classNo);
        if (classesArray.length === 0) {
            let nc = record.nice_classes || detailsObj.niceClasses;
            if (typeof nc === 'string') {
                try { nc = JSON.parse(nc); } catch(e) { nc = nc.split(',').map(x => x.trim()); }
            }
            classesArray = Array.isArray(nc) ? nc.map(x=>parseInt(x)).filter(n=>!isNaN(n)) : [];
        }

        const mappedData = {
            ...detailsObj, 
            id: record.id, 
            applicationNumber: record.application_number || detailsObj.applicationNumber, 
            applicationDate: record.application_date || detailsObj.applicationDate,
            registrationNumber: record.registration_number || detailsObj.registrationNumber, 
            registrationDate: record.registration_date || detailsObj.registrationDate, 
            renewalDate: record.renewal_date || detailsObj.renewalDate,
            title: record.title || record.brand_name || detailsObj.title || detailsObj.brandText, 
            brandText: record.title || record.brand_name || detailsObj.title || detailsObj.brandText, 
            type: record.type || record.ip_type || detailsObj.type, 
            status: record.status || record.official_status || detailsObj.status,
            portfoyStatus: record.portfolio_status || detailsObj.portfoyStatus, 
            origin: record.origin || detailsObj.origin,
            country: record.country_code || record.country || detailsObj.country, 
            wipoIR: record.wipo_ir || detailsObj.wipoIR,
            brandImageUrl: record.brand_image_url || detailsObj.brandImageUrl, 
            
            niceClasses: classesArray,
            goodsAndServicesByClass: gsbc, 
            
            applicants: applicantsArray, 
            applicantName: record.applicant_name || record.owner_name || detailsObj.applicantName || detailsObj.ownerName,

            createdAt: record.created_at, 
            updatedAt: record.updated_at
        };

        return { success: true, data: mappedData };
    },

    // C) İşlem Geçmişini Çeker (Transaction_documents ve Tasks ile İlişkilendirilmiş)
    async getRecordTransactions(recordId) {
        // 1. İşlemleri çek
        const { data: transactions, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('ip_record_id', recordId)
            .order('created_at', { ascending: true });

        if (error) return { success: false, error: error.message };
        if (!transactions || transactions.length === 0) return { success: true, data: [] };

        const txIds = transactions.map(t => t.id);
        const taskIds = transactions.map(t => t.task_id).filter(Boolean);

        // 2. İŞLEM EVRAKLARINI (transaction_documents) ÇEK
        let txDocs = [];
        try {
            const { data } = await supabase.from('transaction_documents').select('*').in('transaction_id', txIds);
            if (data) txDocs = data;
        } catch(e) {}

        // 3. İŞLEMLERE BAĞLI GÖREVLERİ (tasks) ÇEK
        let tasksData = [];
        try {
            // Hem transaction_id ile hem de task_id ile bağlı olan görevleri bul
            const res1 = await supabase.from('tasks').select('*').in('transaction_id', txIds);
            const res2 = taskIds.length > 0 ? await supabase.from('tasks').select('*').in('id', taskIds) : { data: [] };
            tasksData = [...(res1.data || []), ...(res2.data || [])];
        } catch(e) {}

        // 4. VERİLERİ BİRLEŞTİR (Relational Mapping)
        const mappedTransactions = transactions.map(tx => {
            const d = tx.details || {};
            
            // Bu işleme ait belgeleri ve görevleri eşleştir
            const docs = txDocs.filter(td => td.transaction_id === tx.id);
            const task = tasksData.find(t => t.transaction_id === tx.id || t.id === tx.task_id);

            return {
                ...d, // Eski JSON esnekliğini koru
                ...tx, // Veritabanındaki tüm sütunları dahil et
                id: tx.id, 
                type: tx.transaction_type_id || d.type, 
                timestamp: tx.created_at || d.timestamp,
                date: tx.created_at || d.date, 
                transactionHierarchy: tx.transaction_hierarchy || d.transactionHierarchy, 
                parentId: tx.parent_id || d.parentId,
                task_id: tx.task_id || d.triggeringTaskId,
                
                // 🔥 KUSURSUZ İLİŞKİ: Belgeler ve Görevler artık doğrudan işlem objesinde!
                transaction_documents: docs,
                task_data: task || null
            };
        });
        
        return { success: true, data: mappedTransactions };
    },
    async getTransactionsForRecord(recordId) {
        const res = await this.getRecordTransactions(recordId);
        return { success: res.success, transactions: res.data, error: res.error };
    },

    async getRecordsByType(typeFilter) {
        const res = await this.getRecords();
        if(!res.success) return res;
        return { success: true, data: res.data.filter(r => r.type === typeFilter) };
    },
    
    async deleteParentWithChildren(parentId) {
        const { error: childrenError } = await supabase.from('ip_records').delete().eq('details->>parentId', parentId);
        if (childrenError) return { success: false, error: childrenError.message };
        const { error } = await supabase.from('ip_records').delete().eq('id', parentId);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // 1. Yeni Kayıt Ekle (Veritabanı Röntgene Tam Uyumlu)
    async createRecordFromDataEntry(data) {
        // 🔥 YENİ: Firebase formatında (20 karakter) rastgele ID üretici
        const generatePushId = () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let autoId = '';
            for (let i = 0; i < 20; i++) {
                autoId += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return autoId;
        };

        // Eğer dışarıdan ID gönderilmediyse yeni bir tane üret
        const newRecordId = data.id || generatePushId();

        // A) Ana Tablo (Sadece veritabanında var olan sütunlar)
        const dbPayload = {
            id: newRecordId, // 🔴 HATAYI ÇÖZEN SATIR: Artık boş (null) gitmeyecek!
            title: data.title || data.brandText,
            brand_name: data.title || data.brandText,
            brand_text: data.title || data.brandText,
            brand_type: data.brandType,
            brand_category: data.brandCategory,
            ip_type: data.ipType || data.type || 'trademark',
            origin: data.origin,
            portfolio_status: data.portfoyStatus || 'active',
            status: data.status || 'filed',
            record_owner_type: data.recordOwnerType || 'self',
            application_number: data.applicationNumber || null,
            application_date: data.applicationDate || null,
            registration_number: data.registrationNumber || null,
            registration_date: data.registrationDate || null,
            renewal_date: data.renewalDate || null,
            brand_image_url: data.brandImageUrl || null,
            description: data.description || null,
            wipo_ir: data.wipoIR || null,
            aripo_ir: data.aripoIR || null,
            country_code: data.country || data.countryCode || null,
            parent_id: data.parentId || null,
            transaction_hierarchy: data.transactionHierarchy || 'parent',
            created_from: data.createdFrom || 'data_entry',
            created_at: data.createdAt || new Date().toISOString(),
            updated_at: data.updatedAt || new Date().toISOString()
        };

        // Tanımsız (undefined) verileri temizle ki Supabase itiraz etmesin
        Object.keys(dbPayload).forEach(k => dbPayload[k] === undefined && delete dbPayload[k]);

        const { data: inserted, error } = await supabase.from('ip_records').insert(dbPayload).select('id').single();
        if (error) return { success: false, error: error.message };
        const newId = inserted.id;

        // B) Başvuru Sahipleri (ip_record_applicants)
        if (data.applicants && Array.isArray(data.applicants) && data.applicants.length > 0) {
            const appRows = data.applicants.map((app, i) => ({ 
                ip_record_id: newId, 
                person_id: app.id, 
                order_index: i 
            }));
            await supabase.from('ip_record_applicants').insert(appRows);
        }

        // C) Sınıflar ve Eşyalar (ip_record_classes)
        if (data.goodsAndServicesByClass && Array.isArray(data.goodsAndServicesByClass) && data.goodsAndServicesByClass.length > 0) {
            const classRows = data.goodsAndServicesByClass.map(c => ({ 
                ip_record_id: newId, 
                class_no: String(c.classNo), 
                items: Array.isArray(c.items) ? c.items : [] 
            }));
            await supabase.from('ip_record_classes').insert(classRows);
        }

        // D) Bültenler (ip_record_bulletins)
        if (data.bulletins && Array.isArray(data.bulletins) && data.bulletins.length > 0) {
            const bulletinRows = data.bulletins.map(b => ({
                ip_record_id: newId,
                bulletin_no: b.bulletinNo || null,
                bulletin_date: b.bulletinDate || null
            }));
            await supabase.from('ip_record_bulletins').insert(bulletinRows);
        }

        // E) Rüçhanlar (ip_record_priorities)
        if (data.priorities && Array.isArray(data.priorities) && data.priorities.length > 0) {
            const priorityRows = data.priorities.map(p => ({
                ip_record_id: newId,
                type: p.type || null,
                date: p.date || null,
                country: p.country || null,
                number: p.number || null
            }));
            try { await supabase.from('ip_record_priorities').insert(priorityRows); } 
            catch (e) { console.warn("Rüçhan eklenemedi:", e); }
        }

        if (window.localCache) await localCache.remove('ip_records_cache');
        return { success: true, id: newId };
    },

    // 2. Mevcut Kaydı Güncelle (Veritabanı Röntgene Tam Uyumlu)
    async updateRecord(id, updateData) {
        const dbPayload = {};
        
        if (updateData.title !== undefined || updateData.brandText !== undefined) {
            dbPayload.title = updateData.title || updateData.brandText;
            dbPayload.brand_name = updateData.title || updateData.brandText;
            dbPayload.brand_text = updateData.title || updateData.brandText;
        }
        if (updateData.brandType !== undefined) dbPayload.brand_type = updateData.brandType;
        if (updateData.brandCategory !== undefined) dbPayload.brand_category = updateData.brandCategory;
        if (updateData.ipType !== undefined || updateData.type !== undefined) dbPayload.ip_type = updateData.ipType || updateData.type;
        if (updateData.origin !== undefined) dbPayload.origin = updateData.origin;
        if (updateData.portfoyStatus !== undefined) dbPayload.portfolio_status = updateData.portfoyStatus;
        if (updateData.status !== undefined) dbPayload.status = updateData.status;
        if (updateData.recordOwnerType !== undefined) dbPayload.record_owner_type = updateData.recordOwnerType;
        if (updateData.applicationNumber !== undefined) dbPayload.application_number = updateData.applicationNumber;
        if (updateData.applicationDate !== undefined) dbPayload.application_date = updateData.applicationDate;
        if (updateData.registrationNumber !== undefined) dbPayload.registration_number = updateData.registrationNumber;
        if (updateData.registrationDate !== undefined) dbPayload.registration_date = updateData.registrationDate;
        if (updateData.renewalDate !== undefined) dbPayload.renewal_date = updateData.renewalDate;
        if (updateData.brandImageUrl !== undefined) dbPayload.brand_image_url = updateData.brandImageUrl;
        if (updateData.description !== undefined) dbPayload.description = updateData.description;
        if (updateData.wipoIR !== undefined) dbPayload.wipo_ir = updateData.wipoIR;
        if (updateData.aripoIR !== undefined) dbPayload.aripo_ir = updateData.aripoIR;
        if (updateData.country !== undefined || updateData.countryCode !== undefined) dbPayload.country_code = updateData.country || updateData.countryCode;
        
        dbPayload.updated_at = new Date().toISOString();

        Object.keys(dbPayload).forEach(k => dbPayload[k] === undefined && delete dbPayload[k]);

        const { error } = await supabase.from('ip_records').update(dbPayload).eq('id', id);
        if (error) return { success: false, error: error.message };

        // B) Başvuru Sahiplerini Güncelle (ip_record_applicants)
        if (updateData.applicants && Array.isArray(updateData.applicants)) {
            await supabase.from('ip_record_applicants').delete().eq('ip_record_id', id);
            if (updateData.applicants.length > 0) {
                const appRows = updateData.applicants.map((app, i) => ({ 
                    ip_record_id: id, 
                    person_id: app.id, 
                    order_index: i 
                }));
                await supabase.from('ip_record_applicants').insert(appRows);
            }
        }

        // C) Sınıfları Güncelle (ip_record_classes)
        if (updateData.goodsAndServicesByClass && Array.isArray(updateData.goodsAndServicesByClass)) {
            await supabase.from('ip_record_classes').delete().eq('ip_record_id', id);
            if (updateData.goodsAndServicesByClass.length > 0) {
                const classRows = updateData.goodsAndServicesByClass.map(c => ({ 
                    ip_record_id: id, 
                    class_no: String(c.classNo), 
                    items: Array.isArray(c.items) ? c.items : [] 
                }));
                await supabase.from('ip_record_classes').insert(classRows);
            }
        }

        // D) Bültenleri Güncelle (ip_record_bulletins)
        if (updateData.bulletins && Array.isArray(updateData.bulletins)) {
            await supabase.from('ip_record_bulletins').delete().eq('ip_record_id', id);
            if (updateData.bulletins.length > 0) {
                const bulletinRows = updateData.bulletins.map(b => ({ 
                    ip_record_id: id, 
                    bulletin_no: b.bulletinNo || null, 
                    bulletin_date: b.bulletinDate || null 
                }));
                await supabase.from('ip_record_bulletins').insert(bulletinRows);
            }
        }

        // E) Rüçhanları Güncelle (ip_record_priorities)
        if (updateData.priorities && Array.isArray(updateData.priorities)) {
            try {
                await supabase.from('ip_record_priorities').delete().eq('ip_record_id', id);
                if (updateData.priorities.length > 0) {
                    const priorityRows = updateData.priorities.map(p => ({ 
                        ip_record_id: id, 
                        type: p.type || null, 
                        date: p.date || null, 
                        country: p.country || null, 
                        number: p.number || null 
                    }));
                    await supabase.from('ip_record_priorities').insert(priorityRows);
                }
            } catch(e) { console.warn("Rüçhan güncellenemedi:", e); }
        }

        if (window.localCache) await localCache.remove('ip_records_cache');
        return { success: true };
    }
};

// 5. İZLEME (MONITORING) SERVİSİ
export const monitoringService = {
    async addMonitoringItem(recordData) {
        // Ön yüzden gelen veriyi Supabase 'details' JSON alanına gömüyoruz
        const payload = {
            id: recordData.id,
            ip_record_id: recordData.relatedRecordId || recordData.id,
            search_mark_name: recordData.markName || 'İsimsiz İzleme',
            details: recordData,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('monitoring_trademarks').upsert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    }
};

// 6. DAVA (LITIGATION) SERVİSİ
export const suitService = {
    async getSuits() {
        const { data, error } = await supabase.from('suits').select('*').order('created_at', { ascending: false });
        if (error) {
            console.error("Davalar çekilemedi:", error);
            return { success: false, data: [] };
        }
        
        const mappedData = data.map(s => ({
            id: s.id,
            ...s.details, // Esnek json verilerini dışarı aç
            type: 'litigation',
            status: s.status,
            suitType: s.details?.suitType || '-',
            caseNo: s.file_no || '-',
            court: s.court_name || '-',
            client: { name: s.details?.client?.name || '-' },
            opposingParty: s.defendant || s.details?.opposingParty || '-',
            openedDate: s.created_at
        }));

        return { success: true, data: mappedData };
    }
};

// ==========================================
// 7. İŞLEMLER (TRANSACTIONS) SERVİSİ
// ==========================================

export const transactionService = {
    async getObjectionData() {
        const PARENT_TYPES = ['7', '19', '20'];
        
        // 1. Ana İtirazları (Parent) Çek
        const { data: parents, error: parentError } = await supabase
            .from('transactions')
            .select('*')
            .in('transaction_type_id', PARENT_TYPES) // Sütun adını düzelttik
            .limit(10000); // 🔥 YENİ: Sınırı kaldırdık
            
        if (parentError) return { success: false, error: parentError.message };

        // 2. İtirazlara bağlı Alt İşlemleri (Child) Çek
        const { data: children, error: childError } = await supabase
            .from('transactions')
            .select('*')
            .eq('transaction_hierarchy', 'child')
            .limit(10000); // 🔥 YENİ: Sınırı kaldırdık

        const formatData = (rows) => rows.map(r => ({
            id: r.id,
            recordId: r.ip_record_id,
            parentId: r.parent_id || (r.details && r.details.parentId) || null,
            type: r.transaction_type_id || (r.details && r.details.type), // Doğru sütundan oku
            transactionHierarchy: r.transaction_hierarchy,
            timestamp: r.created_at,
            ...r.details 
        }));

        return { 
            success: true, 
            parents: formatData(parents || []), 
            children: formatData(children || []) 
        };
    }
};

// ==========================================
// 8. GÖREV (TASK) SERVİSİ
// ==========================================
export const taskService = {
    async getAllUsers() {
        const { data, error } = await supabase.from('users').select('id, email, display_name');
        if (error) return { success: false, data: [] };
        return { success: true, data: data.map(u => ({ id: u.id, email: u.email, displayName: u.display_name || u.email })) };
    },

    // 🔥 GÜÇLENDİRİLMİŞ HARİTALAMA (Hata Toleranslı)
    async _enrichTasksWithRelations(tasks) {
        const recordIds = [...new Set(tasks.map(t => t.related_ip_record_id || t.ip_record_id).filter(id => id && id.trim() !== ''))];
        let recordsMap = {};

        if (recordIds.length > 0) {
            // ÖNCE DENEME: İlişkisel verileri çekmeye çalış
            const { data: resIpData, error: resIpError } = await supabase.from('ip_records').select(`
                id, application_number, brand_name, title, 
                ip_record_applicants(persons(name))
            `).in('id', recordIds);

            if (resIpError) {
                console.warn("⚠️ IP Record JOIN Hatası (Sahip bilgisi çekilemedi):", resIpError.message);
                // PATLARSA: Sadece düz kolonları çek (Program çökmesin)
                const fallbackIp = await supabase.from('ip_records').select('id, application_number, brand_name, title').in('id', recordIds);
                if(fallbackIp.data) {
                    fallbackIp.data.forEach(ip => {
                        recordsMap[ip.id] = { appNo: ip.application_number || "-", title: ip.brand_name || ip.title || "-", applicant: "-" };
                    });
                }
            } else if (resIpData) {
                resIpData.forEach(ip => {
                    let applicantTxt = "-";
                    if (ip.ip_record_applicants && ip.ip_record_applicants.length > 0) {
                        applicantTxt = ip.ip_record_applicants.map(a => a.persons?.name).filter(Boolean).join(', ');
                    }
                    recordsMap[ip.id] = { appNo: ip.application_number || "-", title: ip.brand_name || ip.title || "-", applicant: applicantTxt };
                });
            }
            
            const foundIpIds = Object.keys(recordsMap);
            const missingIds = recordIds.filter(id => !foundIpIds.includes(id));
            
            if (missingIds.length > 0) {
                const { data: resSuitData } = await supabase.from('suits').select('id, file_no, court_name, plaintiff, client_name').in('id', missingIds);
                if (resSuitData) {
                    resSuitData.forEach(s => {
                        recordsMap[s.id] = { appNo: s.file_no || "-", title: s.court_name || "-", applicant: s.client_name || s.plaintiff || "-" };
                    });
                }
            }
        }

        return tasks.map(t => {
            const relation = recordsMap[t.related_ip_record_id || t.ip_record_id] || {};
            
            // UI'ın beklentisi olan format (camelCase) ve Fallback'ler
            const fallbackAppNo = t.iprecord_application_no || t.target_app_no || "-";
            const fallbackTitle = t.iprecord_title || t.related_ip_record_title || "-";
            const fallbackApplicant = t.related_party_name || t.iprecord_applicant_name || "-";

            return {
                ...t, 
                id: String(t.id),
                title: t.title,
                description: t.description,
                taskType: String(t.task_type),
                status: t.status,
                priority: t.priority,
                dueDate: t.due_date,
                officialDueDate: t.official_due_date,
                operationalDueDate: t.operational_due_date,
                deliveryDate: t.delivery_date,
                assignedTo_uid: t.assigned_to_uid || t.assigned_to_user_id,
                assignedTo_email: t.assigned_to_email,
                relatedIpRecordId: t.related_ip_record_id || t.ip_record_id,
                relatedIpRecordTitle: t.related_ip_record_title,
                relatedPartyId: t.related_party_id,
                relatedPartyName: t.related_party_name,
                transactionId: t.transaction_id,
                opponentId: t.opponent_id,
                history: t.history || [],
                documents: t.documents || [], 
                createdAt: t.created_at,
                updatedAt: t.updated_at,
                
                // Tablolarda Gözükecek Final Veriler
                iprecordApplicationNo: relation.appNo && relation.appNo !== "-" ? relation.appNo : fallbackAppNo,
                iprecordTitle: relation.title && relation.title !== "-" ? relation.title : fallbackTitle,
                
                // 🔥 KESİN ÇÖZÜM: İlişkiden gelmiyorsa, kendi içindeki yedek veriyi (fallback) göster!
                iprecordApplicantName: relation.applicant && relation.applicant !== "-" ? relation.applicant : fallbackApplicant
            };
        });
    },

    async getTasksForUser(uid) {
        const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
        if (error) return { success: false, error: error.message };
        return { success: true, data: await this._enrichTasksWithRelations(data) };
    },

    async getTasksByStatus(status, uid = null) {
        let query = supabase.from('tasks').select('*').eq('status', status).order('created_at', { ascending: false });
        if (uid) query = query.eq('assigned_to_uid', uid);
        const { data, error } = await query;
        if (error) return { success: false, error: error.message };
        return { success: true, data: await this._enrichTasksWithRelations(data) };
    },

    async getTaskById(taskId) {
        const { data, error } = await supabase.from('tasks').select('*').eq('id', String(taskId)).single();
        if (error) return { success: false, error: error.message };
        const enrichedData = await this._enrichTasksWithRelations([data]);
        return { success: true, data: enrichedData[0] };
    },

    async addTask(taskData) {
        try {
            const nextId = await this._getNextTaskId(taskData.task_type || taskData.taskType);
            const payload = {
                id: nextId, 
                title: taskData.title,
                description: taskData.description || null,
                task_type: String(taskData.task_type || taskData.taskType),
                status: taskData.status || 'open',
                priority: taskData.priority || 'normal',
                due_date: taskData.due_date || taskData.dueDate || null,
                official_due_date: taskData.official_due_date || taskData.officialDueDate || null,
                operational_due_date: taskData.operational_due_date || taskData.operationalDueDate || null,
                assigned_to_uid: taskData.assigned_to_uid || taskData.assignedTo_uid || null,
                related_ip_record_id: taskData.related_ip_record_id || taskData.relatedIpRecordId ? String(taskData.related_ip_record_id || taskData.relatedIpRecordId) : null,
                related_party_id: taskData.related_party_id || taskData.relatedPartyId || null,
                related_party_name: taskData.related_party_name || taskData.relatedPartyName || null,
                transaction_id: taskData.transaction_id || taskData.transactionId ? String(taskData.transaction_id || taskData.transactionId) : null,
                documents: taskData.documents || [],
                epats_doc_name: taskData.epats_doc_name || taskData.epatsDocument?.name || null,
                epats_doc_url: taskData.epats_doc_url || taskData.epatsDocument?.url || null,
                target_app_no: taskData.target_app_no || taskData.targetAppNo || null,
                
                // 🔥 KAYIP ALANLAR BURAYA EKLENDİ
                task_owner: taskData.task_owner || taskData.taskOwner || null, 
                history: taskData.history || [], 
                bulletin_no: taskData.bulletin_no || taskData.bulletinNo || null,
                bulletin_date: taskData.bulletin_date || taskData.bulletinDate || null,
                iprecord_application_no: taskData.iprecord_application_no || taskData.iprecordApplicationNo || null,
                iprecord_title: taskData.iprecord_title || taskData.iprecordTitle || null,
                iprecord_applicant_name: taskData.iprecord_applicant_name || taskData.iprecordApplicantName || null
            };
            
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            const { data, error } = await supabase.from('tasks').insert(payload).select('id').single();
            if (error) throw error;
            return { success: true, data: { id: data.id } };
        } catch (error) { return { success: false, error: error.message }; }
    },
    
    async createTask(taskData) { return await this.addTask(taskData); },

    async updateTask(taskId, updateData) {
        try {
            const payload = {
                title: updateData.title,
                description: updateData.description,
                task_type: updateData.taskType ? String(updateData.taskType) : undefined,
                status: updateData.status,
                priority: updateData.priority,
                due_date: updateData.dueDate || updateData.due_date,
                official_due_date: updateData.officialDueDate || updateData.official_due_date,
                operational_due_date: updateData.operationalDueDate || updateData.operational_due_date,
                assigned_to_uid: updateData.assignedTo_uid || updateData.assigned_to_uid,
                related_ip_record_id: updateData.relatedIpRecordId ? String(updateData.relatedIpRecordId) : undefined,
                transaction_id: updateData.transactionId ? String(updateData.transactionId) : undefined,
                related_party_id: updateData.relatedPartyId ? String(updateData.relatedPartyId) : undefined,
                documents: updateData.documents, 
                updated_at: new Date().toISOString()
            };
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            const { error } = await supabase.from('tasks').update(payload).eq('id', String(taskId));
            if (error) throw error;
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    },

    async _getNextTaskId(taskType) {
        try {
            const isAccrualTask = String(taskType) === '53';
            const counterId = isAccrualTask ? 'tasks_accruals' : 'tasks';
            const prefix = isAccrualTask ? 'T-' : '';

            const { data: counterData } = await supabase.from('counters').select('last_id').eq('id', counterId).single();

            let nextNum = (counterData?.last_id || 0) + 1;
            let isFree = false;
            let finalId = '';
            
            while (!isFree) {
                finalId = `${prefix}${nextNum}`; 
                const { data: existingTask } = await supabase.from('tasks').select('id').eq('id', finalId).maybeSingle(); 
                if (!existingTask) isFree = true; else nextNum++; 
            }

            await supabase.from('counters').upsert({ id: counterId, last_id: nextNum }, { onConflict: 'id' });
            return finalId;
        } catch (e) {
            const fallbackId = String(Date.now()).slice(-6); 
            return String(taskType) === '53' ? `T-${fallbackId}` : fallbackId;
        }
    }
};

// ==========================================
// 9. TAHAKKUK (ACCRUAL) SERVİSİ
// ==========================================
export const accrualService = {
    
    async _getNextAccrualId() {
        try {
            const counterId = 'accruals'; 
            const { data: counterData } = await supabase.from('counters').select('last_id').eq('id', counterId).single();

            let nextNum = (counterData?.last_id || 0) + 1;
            let isFree = false;
            let finalId = '';
            
            while (!isFree) {
                finalId = String(nextNum); 
                const { data: existingAccrual } = await supabase.from('accruals').select('id').eq('id', finalId).maybeSingle(); 
                if (!existingAccrual) isFree = true;
                else nextNum++; 
            }

            await supabase.from('counters').upsert({ id: counterId, last_id: nextNum }, { onConflict: 'id' });
            return finalId;
        } catch (e) {
            return String(Date.now()).slice(-6); 
        }
    },

    async addAccrual(accrualData) {
        try {
            const nextId = await this._getNextAccrualId();
            
            // 🔴 Burada details GÖNDERİLMİYOR, accrualData zaten düzleştirilmiş
            const payload = { ...accrualData, id: nextId };

            const { data, error } = await supabase.from('accruals').insert(payload).select('id').single();
            if (error) throw error;
            return { success: true, data: { id: data.id } };
        } catch (error) {
            console.error("Accrual add error:", error);
            return { success: false, error: error.message };
        }
    },

    async updateAccrual(id, updateData) {
        try {
            const payload = { ...updateData };
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });

            const { error } = await supabase.from('accruals').update(payload).eq('id', String(id));
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error("Accrual update error:", error);
            return { success: false, error: error.message };
        }
    },

    async getAccrualsByTaskId(taskId) {
        try {
            const { data, error } = await supabase.from('accruals').select('*').eq('task_id', String(taskId));
            if (error) throw error;
            
            // 🔴 UI'ın beklediği CamelCase haritalamayı yapıyoruz (Dövizler JSONB'den gelecek)
            const mappedData = data.map(acc => ({
                id: acc.id,
                taskId: acc.task_id,
                taskTitle: acc.task_title,
                officialFee: acc.official_fee, 
                serviceFee: acc.service_fee,   
                totalAmount: acc.total_amount, 
                remainingAmount: acc.remaining_amount, 
                vatRate: acc.vat_rate,
                applyVatToOfficialFee: acc.apply_vat_to_official_fee,
                status: acc.status,
                tpInvoiceParty: acc.tp_invoice_party_id ? { id: acc.tp_invoice_party_id, name: acc.tp_invoice_party_name } : null,
                serviceInvoiceParty: acc.service_invoice_party_id ? { id: acc.service_invoice_party_id, name: acc.service_invoice_party_name } : null,
                isForeignTransaction: acc.is_foreign_transaction,
                files: acc.files || [],
                createdAt: acc.created_at,
                updatedAt: acc.updated_at
            }));
            
            return { success: true, data: mappedData };
        } catch (error) {
            console.error("Accrual fetch error:", error);
            return { success: false, error: error.message, data: [] };
        }
    }
};