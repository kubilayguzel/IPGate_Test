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
        // 🔥 YENİ: Sadece isimleri değil, 'details' içindeki tüm kuralları (*) çekiyoruz
        const { data, error } = await supabase.from('transaction_types').select('*');
        if (error) return { success: false, data: [] };
        
        // Arayüzün beklediği format (details içindeki indexFile, duePeriod vb. dışarı çıkarılıyor)
        const mappedData = data.map(t => ({
            id: t.id,
            name: t.name,
            alias: t.alias,
            applicableToMainType: t.ip_type ? [t.ip_type] : [],
            hierarchy: t.hierarchy,
            isTopLevelSelectable: t.is_top_level_selectable,
            code: t.id, // Eğer eski sistem code arıyorsa diye fallback
            ...t.details // 🔥 KRİTİK NOKTA: Alt işlemleri belirleyen indexFile kuralı burada açılıyor
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
        // A) Ana Tablo (Sadece veritabanında var olan sütunlar)
        const dbPayload = {
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
    // 1. Kullanıcıları Çekme (Atama Listesi İçin)
    async getAllUsers() {
        const { data, error } = await supabase.from('users').select('id, email, display_name');
        if (error) return { success: false, data: [] };
        
        const mappedUsers = data.map(u => ({
            id: u.id,
            email: u.email,
            displayName: u.display_name || u.email
        }));
        return { success: true, data: mappedUsers };
    },

    // --- YENİ: AKILLI İLİŞKİ BİRLEŞTİRİCİ (SMART ENRICHER) - KESİN ÇÖZÜM ---
    async _enrichTasksWithRelations(tasks) {
        const recordIds = [...new Set(tasks.map(t => t.ip_record_id).filter(id => id && id.trim() !== ''))];
        let recordsMap = {};
        
        let ipData = [];
        let suitData = [];

        if (recordIds.length > 0) {
            const resIp = await supabase.from('ip_records').select('id, application_number, brand_name, details').in('id', recordIds);
            if (resIp.data) ipData = resIp.data;
            
            const foundIpIds = ipData.map(ip => ip.id);
            const missingIds = recordIds.filter(id => !foundIpIds.includes(id));
            
            if (missingIds.length > 0) {
                const resSuit = await supabase.from('suits').select('id, file_no, court_name, plaintiff, details').in('id', missingIds);
                if (resSuit.data) suitData = resSuit.data;
            }
        }

        let personIdsToFetch = new Set();
        
        ipData.forEach(ip => {
            const applicants = ip.details?.applicants || [];
            if (Array.isArray(applicants)) {
                applicants.forEach(app => {
                    if (app && typeof app === 'object' && app.id && (!app.name || app.name.trim() === '')) {
                        personIdsToFetch.add(app.id);
                    }
                });
            }
        });

        let personsMap = {};
        if (personIdsToFetch.size > 0) {
            const { data: persons } = await supabase.from('persons').select('id, name').in('id', Array.from(personIdsToFetch));
            if (persons) {
                persons.forEach(p => personsMap[p.id] = p.name);
            }
        }

        ipData.forEach(ip => {
            const d = ip.details || {};
            let finalApplicants = [];

            if (Array.isArray(d.applicants) && d.applicants.length > 0) {
                d.applicants.forEach(app => {
                    if (typeof app === 'object') {
                        if (app.name && app.name.trim() !== '') finalApplicants.push(app.name);
                        else if (app.id && personsMap[app.id]) finalApplicants.push(personsMap[app.id]);
                    } else if (typeof app === 'string') {
                        finalApplicants.push(app);
                    }
                });
            } else if (d.applicantName) {
                finalApplicants.push(d.applicantName);
            } else if (d.ownerName) {
                finalApplicants.push(d.ownerName);
            }

            recordsMap[ip.id] = {
                appNo: ip.application_number || d.applicationNumber || "-",
                title: ip.brand_name || d.brandName || d.brandExampleText || "-",
                applicant: finalApplicants.length > 0 ? finalApplicants.join(', ') : "-"
            };
        });

        suitData.forEach(s => {
            const d = s.details || {};
            let applicantTxt = s.plaintiff || d.client?.name || d.plaintiff || "-";
            
            recordsMap[s.id] = {
                appNo: s.file_no || d.caseNo || d.fileNumber || "-",
                title: s.court_name || d.court || "-",
                applicant: applicantTxt
            };
        });

        return tasks.map(t => {
            const relation = recordsMap[t.ip_record_id] || {};
            const details = t.details || {};
            
            let taskFallbackApplicant = details.iprecordApplicantName || "-";
            if ((!taskFallbackApplicant || taskFallbackApplicant === "-") && Array.isArray(details.relatedParties) && details.relatedParties.length > 0) {
                taskFallbackApplicant = details.relatedParties.map(p => typeof p === 'object' ? (p.name || p.companyName) : p).filter(Boolean).join(', ');
            }

            // 🔥 KRİTİK DÜZELTME: SQL'deki alt tireli verileri JS'nin beklediği CamelCase formata geri çeviriyoruz!
            return {
                id: t.id,
                title: t.title,
                description: t.description,
                taskType: t.task_type,
                status: t.status,
                priority: t.priority,
                dueDate: t.due_date,
                officialDueDate: t.official_due_date,
                operationalDueDate: t.operational_due_date,
                deliveryDate: t.delivery_date,
                assignedTo_uid: t.assigned_to_user_id,
                relatedIpRecordId: t.ip_record_id,
                transactionId: t.transaction_id,
                opponentId: t.opponent_id,
                history: t.history || [],
                createdAt: t.created_at,
                updatedAt: t.updated_at,
                ...details,
                assignedTo_email: details.assignedTo_email || details.assignedToEmail || null,
                
                iprecordApplicationNo: relation.appNo && relation.appNo !== "-" ? relation.appNo : (details.iprecordApplicationNo || "-"),
                iprecordTitle: relation.title && relation.title !== "-" ? relation.title : (details.iprecordTitle || details.relatedIpRecordTitle || "-"),
                iprecordApplicantName: relation.applicant && relation.applicant !== "-" ? relation.applicant : taskFallbackApplicant
            };
        });
    },

    // 2. Tüm Görevleri Çekme (Akıllı Birleştirici Kullanır)
    async getTasksForUser(uid) {
        const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
        if (error) return { success: false, error: error.message };
        
        const enrichedData = await this._enrichTasksWithRelations(data);
        return { success: true, data: enrichedData };
    },

    // 3. Tetiklenen Görevler İçin (Akıllı Birleştirici Kullanır)
    async getTasksByStatus(status, uid = null) {
        let query = supabase.from('tasks').select('*').eq('status', status).order('created_at', { ascending: false });
        if (uid) query = query.eq('assigned_to_user_id', uid);

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };

        const enrichedData = await this._enrichTasksWithRelations(data);
        return { success: true, data: enrichedData };
    },

    // 4. Tekil Görev Detayı (Akıllı Birleştirici Kullanır)
    async getTaskById(taskId) {
        const { data, error } = await supabase.from('tasks').select('*').eq('id', String(taskId)).single();
        if (error) return { success: false, error: error.message };

        const enrichedData = await this._enrichTasksWithRelations([data]);
        return { success: true, data: enrichedData[0] };
    },

    // 5. Görev Ekleme (Foreign Key Alanları Düzeltildi)
    async addTask(taskData) {
        try {
            const nextId = await this._getNextTaskId();

            const payload = {
                id: nextId, 
                title: taskData.title,
                description: taskData.description || null,
                task_type: String(taskData.taskType),
                status: taskData.status || 'open',
                priority: taskData.priority || 'normal',
                due_date: taskData.dueDate || null,
                official_due_date: taskData.officialDueDate || null,
                operational_due_date: taskData.operationalDueDate || null,
                assigned_to_uid: taskData.assignedTo_uid || null, // DÜZELTİLDİ
                related_ip_record_id: taskData.relatedIpRecordId ? String(taskData.relatedIpRecordId) : null, // DÜZELTİLDİ
                transaction_id: taskData.transactionId ? String(taskData.transactionId) : null,
                epats_doc_name: taskData.epatsDocument?.name || null, // Yassılaştırma
                epats_doc_url: taskData.epatsDocument?.url || null,
                target_app_no: taskData.targetAppNo || null,
                bulletin_no: taskData.bulletinNo || null
            };
            
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            
            const { data, error } = await supabase.from('tasks').insert(payload).select('id').single();
            if (error) throw error;
            return { success: true, data: { id: data.id } };
        } catch (error) {
            console.error("Task add error:", error);
            return { success: false, error: error.message };
        }
    },
    async createTask(taskData) {
        return await this.addTask(taskData);
    },

    // 6. Görev Güncelleme (Foreign Key Alanları Düzeltildi)
    async updateTask(taskId, updateData) {
        try {
            const payload = {
                title: updateData.title,
                description: updateData.description,
                task_type: updateData.taskType ? String(updateData.taskType) : undefined,
                status: updateData.status,
                priority: updateData.priority,
                due_date: updateData.dueDate,
                official_due_date: updateData.officialDueDate,
                operational_due_date: updateData.operationalDueDate,
                assigned_to_uid: updateData.assignedTo_uid, // DÜZELTİLDİ
                related_ip_record_id: updateData.relatedIpRecordId ? String(updateData.relatedIpRecordId) : undefined, // DÜZELTİLDİ
                transaction_id: updateData.transactionId ? String(updateData.transactionId) : undefined,
                updated_at: new Date().toISOString()
            };
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            const { error } = await supabase.from('tasks').update(payload).eq('id', String(taskId));
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // --- SAYAÇTAN YENİ ID ALMA (SADECE lastId KULLANIR) ---
    async _getNextTaskId() {
        try {
            // 1. counters tablosundan 'tasks' için 'lastId' değerini çek
            const { data: counterData, error: fetchError } = await supabase
                .from('counters')
                .select('lastId') // 🔥 Doğru sütun adı: lastId
                .eq('id', 'tasks')
                .single();

            // Eğer tabloda henüz hiç görev sayacı yoksa (veya lastId boşsa) sıfır kabul edip 1'den başla
            let nextNum = (counterData?.lastId || 0) + 1;

            // 2. 🔥 ÇAKIŞMA ÖNLEYİCİ DÖNGÜ (Her ihtimale karşı bu numara gerçekten boş mu kontrolü)
            let isFree = false;
            while (!isFree) {
                const { data: existingTask } = await supabase
                    .from('tasks')
                    .select('id')
                    .eq('id', String(nextNum))
                    .single();
                    
                if (!existingTask) {
                    isFree = true; // Boş numarayı bulduk!
                } else {
                    nextNum++; // Eğer veritabanında bu numara varsa, 1 artırıp tekrar dene
                }
            }

            // 3. Bulunan ve garanti olan yeni numarayı counters tablosundaki lastId alanına yaz
            await supabase
                .from('counters')
                .upsert({ id: 'tasks', lastId: nextNum }, { onConflict: 'id' });

            return String(nextNum);
        } catch (e) {
            console.error("Sayaç oluşturma hatası:", e);
            // Sunucu/Bağlantı hatası anında uygulamanın çökmemesi için can yeleği (Zaman damgası)
            return String(Date.now()).slice(-6); 
        }
    },
};

// ==========================================
// 9. TAHAKKUK (ACCRUAL) SERVİSİ
// ==========================================
export const accrualService = {
    
    // 1. Yeni Tahakkuk Ekleme
    async addAccrual(accrualData) {
        try {
            // Ana SQL sütunlarına gidecek veriler ve esnek JSONB (details) verileri
            const payload = {
                task_id: String(accrualData.taskId || accrualData.task_id || ''),
                status: accrualData.status || 'unpaid',
                evreka_invoice_no: accrualData.evrekaInvoiceNo || accrualData.evreka_invoice_no || null,
                tpe_invoice_no: accrualData.tpeInvoiceNo || accrualData.tpe_invoice_no || null,
                created_at: accrualData.createdAt || accrualData.created_at || new Date().toISOString(),
                details: accrualData.details || accrualData // Geri kalan her şey (Tutar, dosyalar vb.)
            };

            const { data, error } = await supabase.from('accruals').insert(payload).select('id').single();
            if (error) throw error;
            return { success: true, data: { id: data.id } };
        } catch (error) {
            console.error("Accrual add error:", error);
            return { success: false, error: error.message };
        }
    },

    // 2. Tahakkuk Güncelleme
    async updateAccrual(id, updateData) {
        try {
            const payload = {
                task_id: updateData.taskId ? String(updateData.taskId) : undefined,
                status: updateData.status,
                evreka_invoice_no: updateData.evrekaInvoiceNo || updateData.evreka_invoice_no,
                tpe_invoice_no: updateData.tpeInvoiceNo || updateData.tpe_invoice_no,
                updated_at: new Date().toISOString(),
                details: updateData.details || updateData
            };

            // SQL'de hata vermemesi için undefined olanları sil
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });

            const { error } = await supabase.from('accruals').update(payload).eq('id', String(id));
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error("Accrual update error:", error);
            return { success: false, error: error.message };
        }
    },

    // 3. Göreve Ait Tahakkukları Getirme
    async getAccrualsByTaskId(taskId) {
        try {
            const { data, error } = await supabase.from('accruals').select('*').eq('task_id', String(taskId));
            if (error) throw error;
            
            const mappedData = data.map(acc => ({
                id: acc.id,
                ...acc.details, // Esnek verileri dışa çıkarıyoruz
                ...acc
            }));
            return { success: true, data: mappedData };
        } catch (error) {
            console.error("Accrual fetch error:", error);
            return { success: false, error: error.message, data: [] };
        }
    }
};