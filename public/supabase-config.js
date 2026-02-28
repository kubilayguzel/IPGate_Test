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
        
        // YENİ ŞEMA: person_type yerine type, tax_no yerine taxNo (UI camelCase bekliyor)
        const mappedData = data.map(p => ({
            id: p.id, 
            name: p.name, 
            type: p.type, 
            tckn: p.tckn, 
            taxOffice: p.tax_office,
            taxNo: p.tax_no, 
            tpeNo: p.tpe_no,
            email: p.email, 
            phone: p.phone, 
            address: p.address, 
            countryCode: p.country_code, 
            province: p.province,
            is_evaluation_required: p.is_evaluation_required
            // NOT: 'documents' ve 'details' yeni şemada kaldırıldığı için çıkarıldı.
        }));
        return { success: true, data: mappedData };
    },

    async getPersonById(id) {
        // 🔥 YENİ DB YAPISI: İlişkili person_documents tablosundaki vekaletnameleri de (JOIN ile) çekiyoruz
        const { data, error } = await supabase
            .from('persons')
            .select(`
                *,
                person_documents (*)
            `)
            .eq('id', id)
            .single();
            
        if (error) return { success: false, error: error.message };
        
        // Arayüzün (UI) beklediği formata çeviriyoruz
        const mappedDocuments = (data.person_documents || []).map(doc => ({
            id: doc.id,
            fileName: doc.file_name,
            documentType: doc.document_type,
            url: doc.url,
            countryCode: doc.country_code,
            validityDate: doc.validity_date
        }));

        const mappedData = {
            id: data.id, 
            name: data.name, 
            type: data.type, 
            tckn: data.tckn, 
            birthDate: data.birth_date,
            taxOffice: data.tax_office,
            taxNo: data.tax_no, 
            tpeNo: data.tpe_no,
            email: data.email, 
            phone: data.phone, 
            address: data.address, 
            countryCode: data.country_code, 
            province: data.province,
            is_evaluation_required: data.is_evaluation_required,
            documents: mappedDocuments // 🔥 Belgeleri arayüze iletiyoruz
        };
        return { success: true, data: mappedData };
    },

    async addPerson(personData) {
        // 🔥 YENİ: Ön yüzden (Modal'dan) bir ID gelirse onu kullan, gelmezse yeni üret
        const newPersonId = personData.id || crypto.randomUUID(); 
        
        const payload = {
            id: newPersonId, 
            name: personData.name, 
            type: personData.type, 
            tckn: personData.tckn || null, 
            birth_date: personData.birthDate || null,
            tax_office: personData.taxOffice || null,
            tax_no: personData.taxNo || null,
            tpe_no: personData.tpeNo || null, 
            email: personData.email || null, 
            phone: personData.phone || null,
            address: personData.address || null, 
            country_code: personData.countryCode || null, 
            province: personData.province || null,
            is_evaluation_required: personData.is_evaluation_required || false
        };

        // 1. Önce Kişiyi Kaydet
        const { data, error } = await supabase.from('persons').insert(payload).select('id').single();
        if (error) return { success: false, error: error.message };

        // 2. Belgeleri `person_documents` tablosuna kaydet
        if (personData.documents && personData.documents.length > 0) {
            const docsPayload = personData.documents.map(doc => ({
                person_id: newPersonId,
                file_name: doc.fileName || doc.name || 'Belge',
                document_type: doc.documentType || doc.type || 'vekaletname',
                url: doc.url,
                country_code: doc.countryCode || null,
                validity_date: doc.validityDate || null
            }));
            
            await supabase.from('person_documents').insert(docsPayload);
        }

        return { success: true, data: { id: newPersonId } };
    },

    async updatePerson(id, personData) {
        const payload = {
            name: personData.name, 
            type: personData.type, 
            tckn: personData.tckn || null, 
            birth_date: personData.birthDate || null,
            tax_office: personData.taxOffice || null,
            tax_no: personData.taxNo || null,
            tpe_no: personData.tpeNo || null, 
            email: personData.email || null, 
            phone: personData.phone || null,
            address: personData.address || null, 
            country_code: personData.countryCode || null, 
            province: personData.province || null, 
            is_evaluation_required: personData.is_evaluation_required || false,
            updated_at: new Date().toISOString()
        };
        
        Object.keys(payload).forEach(key => { 
            if (payload[key] === undefined || payload[key] === '') payload[key] = null; 
        });

        // 1. Kişiyi Güncelle
        const { error } = await supabase.from('persons').update(payload).eq('id', id);
        if (error) {
            console.error("🔴 SUPABASE UPDATE HATASI:", error);
            alert("Kayıt Başarısız: " + error.message);
            return { success: false, error: error.message };
        }

        // 🔥 YENİ DB YAPISI: Belgeleri `person_documents` tablosuna güncelle
        if (personData.documents) {
            // Önce bu kişiye ait eski belgeleri siliyoruz, sonra formdan gelen güncel listeyi yazıyoruz (Senkronizasyon)
            await supabase.from('person_documents').delete().eq('person_id', id);
            
            if (personData.documents.length > 0) {
                const docsPayload = personData.documents.map(doc => ({
                    person_id: id,
                    file_name: doc.fileName || doc.name || 'Belge',
                    document_type: doc.documentType || doc.type || 'vekaletname',
                    url: doc.url,
                    country_code: doc.countryCode || null,
                    validity_date: doc.validityDate || null
                }));
                
                await supabase.from('person_documents').insert(docsPayload);
            }
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
                    id: crypto.randomUUID(),
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

// ==========================================
// 4. PORTFÖY (IP RECORDS) SERVİSİ
// ==========================================
export const ipRecordsService = {
    
    // A) Tüm Portföyü Getir (Listeleme İçin) - SON VE TEMİZ VERSİYON
    async getRecords(forceRefresh = false) {
        const CACHE_KEY = 'ip_records_cache';
        const TTL_MS = 30 * 60 * 1000; // 30 Dakika Önbellek

        // Önbellek kontrolü aktif
        if (!forceRefresh && window.localCache) {
            const cachedObj = await window.localCache.get(CACHE_KEY);
            if (cachedObj && cachedObj.timestamp && cachedObj.data) {
                if ((Date.now() - cachedObj.timestamp) < TTL_MS) {
                    return { success: true, data: cachedObj.data, from: 'cache' };
                }
            }
        }

        const { data, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_trademark_details (*),
                ip_record_applicants ( persons ( id, name, type ) ),
                ip_record_classes ( class_no )
            `)
            .limit(20000)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Kayıtlar çekilemedi:", error);
            return { success: false, data: [] };
        }

        const mappedData = data.map(record => {
            let applicantsArray = record.ip_record_applicants
                ? record.ip_record_applicants.filter(rel => rel.persons).map(rel => ({
                    id: rel.persons.id, name: rel.persons.name, personType: rel.persons.type
                })) : [];

            let classesArray = record.ip_record_classes 
                ? record.ip_record_classes.map(c => parseInt(c.class_no)).filter(n => !isNaN(n)) 
                : [];

            let tmDetails = record.ip_record_trademark_details || {};
            if (Array.isArray(tmDetails)) {
                tmDetails = tmDetails.length > 0 ? tmDetails[0] : {};
            }

            let imageUrl = tmDetails.brand_image_url;
            if (!imageUrl || imageUrl.trim() === '') {
                imageUrl = `https://guicrctynauzxhyfpdfe.supabase.co/storage/v1/object/public/brand_images/${record.id}/logo.png`;
            }

            return {
                id: record.id, 
                type: record.ip_type, 
                origin: record.origin, 
                status: record.status,
                portfoyStatus: record.portfolio_status,
                recordOwnerType: record.record_owner_type,
                applicationNumber: record.application_number, 
                applicationDate: record.application_date,
                registrationNumber: record.registration_number, 
                registrationDate: record.registration_date, 
                renewalDate: record.renewal_date,
                country: record.country_code,
                wipoIR: record.wipo_ir, 
                aripoIR: record.aripo_ir, 
                transactionHierarchy: record.transaction_hierarchy,
                parentId: record.parent_id,
                
                title: tmDetails.brand_name || record.title || '', 
                brandText: tmDetails.brand_name || record.title || '', 
                brandType: tmDetails.brand_type || '',
                brandCategory: tmDetails.brand_category || '',
                brandImageUrl: imageUrl, 
                trademarkImage: imageUrl, 
                description: tmDetails.description || '',

                niceClasses: classesArray,
                applicants: applicantsArray,
                applicantName: applicantsArray.map(a => a.name).join(', ') || '-',
                
                createdAt: record.created_at, 
                updatedAt: record.updated_at
            };
        });

        // Veriyi tekrar önbelleğe yazıyoruz
        if (window.localCache) await window.localCache.set(CACHE_KEY, { timestamp: Date.now(), data: mappedData });
        return { success: true, data: mappedData, from: 'server' };
    },

    // B) Tek Bir Kaydı Çeker (Detay Sayfası İçin)
    async getRecordById(id) {
        const { data: record, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_trademark_details (*),
                ip_record_applicants ( persons ( id, name, type, address, email ) ),
                ip_record_classes ( class_no, items ),
                ip_record_priorities (*),
                ip_record_bulletins (*)
            `)
            .eq('id', id)
            .single();

        if (error) return { success: false, error: error.message };

        // 🔥 Orijinal tablo adıyla veriyi okuyoruz
        let tmDetails = record.ip_record_trademark_details || {};
        if (Array.isArray(tmDetails)) {
            tmDetails = tmDetails.length > 0 ? tmDetails[0] : {};
        }

        const applicantsArray = record.ip_record_applicants
            ? record.ip_record_applicants.filter(rel => rel.persons).map(rel => ({
                id: rel.persons.id, 
                name: rel.persons.name, 
                email: rel.persons.email,
                address: rel.persons.address // 🔥 ÇÖZÜM 1: Adres alanını objeye ekledik
            })) : [];

        const gsbc = record.ip_record_classes ? record.ip_record_classes.map(c => ({
            classNo: c.class_no, items: c.items || []
        })) : [];

        const priorities = record.ip_record_priorities ? record.ip_record_priorities.map(p => ({
            id: p.id, country: p.priority_country, date: p.priority_date, number: p.priority_number
        })) : [];

        const bulletins = record.ip_record_bulletins ? record.ip_record_bulletins.map(b => ({
            id: b.id, bulletinNo: b.bulletin_no, bulletinDate: b.bulletin_date
        })) : [];

        let imageUrl = tmDetails.brand_image_url;
        if (!imageUrl || imageUrl.trim() === '') {
            imageUrl = `https://guicrctynauzxhyfpdfe.supabase.co/storage/v1/object/public/brand_images/${record.id}/logo.png`;
        }

        const mappedData = {
            id: record.id, 
            ipType: record.ip_type,
            type: record.ip_type,
            origin: record.origin,
            status: record.status,
            portfoyStatus: record.portfolio_status,
            recordOwnerType: record.record_owner_type,
            applicationNumber: record.application_number, 
            applicationDate: record.application_date,
            registrationNumber: record.registration_number, 
            registrationDate: record.registration_date, 
            renewalDate: record.renewal_date,
            country: record.country_code,
            countryCode: record.country_code,
            wipoIR: record.wipo_ir,
            aripoIR: record.aripo_ir,
            transactionHierarchy: record.transaction_hierarchy,
            parentId: record.parent_id,

            title: tmDetails.brand_name || record.title || '',
            brandText: tmDetails.brand_name || record.title || '',
            brandType: tmDetails.brand_type || '',
            brandCategory: tmDetails.brand_category || '',
            brandImageUrl: imageUrl,
            trademarkImage: imageUrl,
            description: tmDetails.description || '',

            niceClasses: gsbc.map(g => parseInt(g.classNo)),
            goodsAndServicesByClass: gsbc, 
            applicants: applicantsArray, 
            priorities: priorities,
            bulletins: bulletins,

            createdAt: record.created_at, 
            updatedAt: record.updated_at
        };

        return { success: true, data: mappedData };
    },

    // C) Yeni Kayıt Ekle (Tablolara Bölüştürerek Yazar)
    async createRecordFromDataEntry(data) {
        const newRecordId = data.id || crypto.randomUUID();

        // 1. ANA TABLO (ip_records)
        const dbPayload = {
            id: newRecordId,
            ip_type: data.ipType || data.type || 'trademark',
            origin: data.origin || null,
            portfolio_status: data.portfoyStatus || 'active',
            status: data.status || null,
            record_owner_type: data.recordOwnerType || 'self',
            application_number: data.applicationNumber || null,
            application_date: data.applicationDate || null,
            registration_number: data.registrationNumber || null,
            registration_date: data.registrationDate || null,
            renewal_date: data.renewalDate || null,
            country_code: data.country || data.countryCode || null,
            wipo_ir: data.wipoIR || null,
            aripo_ir: data.aripoIR || null,
            parent_id: data.parentId || null,
            transaction_hierarchy: data.transactionHierarchy || 'parent',
            created_from: data.createdFrom || 'data_entry'
        };

        Object.keys(dbPayload).forEach(k => dbPayload[k] === undefined && delete dbPayload[k]);

        const { error: mainError } = await supabase.from('ip_records').insert(dbPayload);
        if (mainError) return { success: false, error: mainError.message };

        // 2. MARKA DETAYLARI (ip_record_trademark_details)
        if (dbPayload.ip_type === 'trademark') {
            const tmPayload = {
                ip_record_id: newRecordId,
                brand_name: data.title || data.brandText || null,
                brand_type: data.brandType || null,
                brand_category: data.brandCategory || null,
                brand_image_url: data.brandImageUrl || null,
                description: data.description || null
            };
            Object.keys(tmPayload).forEach(k => tmPayload[k] === undefined && delete tmPayload[k]);
            await supabase.from('ip_record_trademark_details').insert(tmPayload);
        }

        // 3. BAŞVURU SAHİPLERİ (ip_record_applicants)
        if (data.applicants && Array.isArray(data.applicants) && data.applicants.length > 0) {
            const appRows = data.applicants.map((app, i) => ({ 
                ip_record_id: newRecordId, person_id: app.id, order_index: i 
            }));
            await supabase.from('ip_record_applicants').insert(appRows);
        }

        // 4. SINIFLAR VE EŞYALAR (ip_record_classes)
        if (data.goodsAndServicesByClass && Array.isArray(data.goodsAndServicesByClass)) {
            const classRows = data.goodsAndServicesByClass.map(c => ({ 
                ip_record_id: newRecordId, class_no: parseInt(c.classNo), items: Array.isArray(c.items) ? c.items : [] 
            }));
            if(classRows.length > 0) await supabase.from('ip_record_classes').insert(classRows);
        }

        // 5. RÜÇHANLAR (ip_record_priorities)
        if (data.priorities && Array.isArray(data.priorities) && data.priorities.length > 0) {
            const priorityRows = data.priorities.map(p => ({
                ip_record_id: newRecordId, priority_country: p.country, priority_date: p.date, priority_number: p.number
            }));
            await supabase.from('ip_record_priorities').insert(priorityRows);
        }

        if (window.localCache) await window.localCache.remove(CACHE_KEY);
        return { success: true, id: newRecordId };
    },

    // D) Mevcut Kaydı Güncelle
    async updateRecord(id, updateData) {
        // 1. ANA TABLO GÜNCELLEMESİ
        const dbPayload = {};
        
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
        if (updateData.wipoIR !== undefined) dbPayload.wipo_ir = updateData.wipoIR;
        if (updateData.aripoIR !== undefined) dbPayload.aripo_ir = updateData.aripoIR;
        if (updateData.country !== undefined || updateData.countryCode !== undefined) dbPayload.country_code = updateData.country || updateData.countryCode;
        
        dbPayload.updated_at = new Date().toISOString();
        Object.keys(dbPayload).forEach(k => dbPayload[k] === undefined && delete dbPayload[k]);

        if (Object.keys(dbPayload).length > 1) { 
            const { error } = await supabase.from('ip_records').update(dbPayload).eq('id', id);
            if (error) return { success: false, error: error.message };
        }

        // 2. MARKA DETAYLARI GÜNCELLEMESİ
        const isTrademark = updateData.ipType === 'trademark' || updateData.type === 'trademark' || (updateData.title !== undefined);
        if (isTrademark) {
            const tmPayload = { ip_record_id: id };
            if (updateData.title !== undefined || updateData.brandText !== undefined) tmPayload.brand_name = updateData.title || updateData.brandText;
            if (updateData.brandType !== undefined) tmPayload.brand_type = updateData.brandType;
            if (updateData.brandCategory !== undefined) tmPayload.brand_category = updateData.brandCategory;
            if (updateData.brandImageUrl !== undefined) tmPayload.brand_image_url = updateData.brandImageUrl;
            if (updateData.description !== undefined) tmPayload.description = updateData.description;

            Object.keys(tmPayload).forEach(k => tmPayload[k] === undefined && delete tmPayload[k]);

            if (Object.keys(tmPayload).length > 1) {
                await supabase.from('ip_record_trademark_details').upsert(tmPayload, { onConflict: 'ip_record_id' });
            }
        }

        // 3. BAŞVURU SAHİPLERİNİ YENİDEN YAZ
        if (updateData.applicants && Array.isArray(updateData.applicants)) {
            await supabase.from('ip_record_applicants').delete().eq('ip_record_id', id);
            if (updateData.applicants.length > 0) {
                const appRows = updateData.applicants.map((app, i) => ({ ip_record_id: id, person_id: app.id, order_index: i }));
                await supabase.from('ip_record_applicants').insert(appRows);
            }
        }

        // 4. SINIFLARI YENİDEN YAZ
        if (updateData.goodsAndServicesByClass && Array.isArray(updateData.goodsAndServicesByClass)) {
            await supabase.from('ip_record_classes').delete().eq('ip_record_id', id);
            if (updateData.goodsAndServicesByClass.length > 0) {
                const classRows = updateData.goodsAndServicesByClass.map(c => ({ ip_record_id: id, class_no: parseInt(c.classNo), items: Array.isArray(c.items) ? c.items : [] }));
                await supabase.from('ip_record_classes').insert(classRows);
            }
        }

        // 5. RÜÇHANLARI YENİDEN YAZ
        if (updateData.priorities && Array.isArray(updateData.priorities)) {
            await supabase.from('ip_record_priorities').delete().eq('ip_record_id', id);
            if (updateData.priorities.length > 0) {
                const priorityRows = updateData.priorities.map(p => ({ ip_record_id: id, priority_country: p.country, priority_date: p.date, priority_number: p.number }));
                await supabase.from('ip_record_priorities').insert(priorityRows);
            }
        }

        if (window.localCache) await window.localCache.remove(CACHE_KEY);
        return { success: true };
    },

    // İşlem Geçmişi 
    async getRecordTransactions(recordId) {
        if (!recordId) return { success: false, message: 'Kayıt ID yok.' };
        try {
            // 🔥 ÇÖZÜM 2: Bağlantıları en sade haliyle (tasks ve transaction_documents) çekiyoruz
            const { data, error } = await supabase
                .from('transactions')
                .select(`*, transaction_documents(*), tasks(*)`)
                .eq('ip_record_id', String(recordId))
                .order('created_at', { ascending: false });

            if (error) {
                console.error("İşlem geçmişi SQL hatası:", error);
                throw error;
            }
            if (!data) return { success: true, data: [] };

            const mappedData = data.map(t => {
                const dateVal = t.transaction_date || t.created_at;
                const taskObj = t.tasks ? (Array.isArray(t.tasks) ? t.tasks[0] : t.tasks) : null;
                
                return {
                    ...t, 
                    id: t.id, 
                    type: String(t.transaction_type_id || ''), 
                    transactionHierarchy: t.transaction_hierarchy || 'parent', 
                    parentId: t.parent_id || null, 
                    timestamp: dateVal, 
                    date: dateVal,
                    userEmail: t.user_email || t.user_name || 'Sistem',
                    transaction_documents: t.transaction_documents || [], 
                    task_data: taskObj
                };
            });
            return { success: true, data: mappedData };
        } catch (error) {
            console.error("İşlem geçmişi çekme hatası:", error);
            return { success: false, error: error.message };
        }
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
        const { error: childrenError } = await supabase.from('ip_records').delete().eq('parent_id', parentId);
        if (childrenError) return { success: false, error: childrenError.message };
        const { error } = await supabase.from('ip_records').delete().eq('id', parentId);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },
    
    // YENİ İŞLEM (TRANSACTION) EKLEME KÖPRÜSÜ
    async addTransactionToRecord(recordId, txData) {
        const payload = {
            ip_record_id: recordId,
            transaction_type_id: txData.type || txData.transactionTypeId,
            description: txData.description,
            transaction_hierarchy: txData.transactionHierarchy || 'parent',
            parent_id: txData.parentId || null,
            transaction_date: new Date().toISOString()
        };
        const { error } = await supabase.from('transactions').insert(payload);
        if (error) throw error;
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

// ==========================================
// 10. MERKEZİ MAİL ALICISI HESAPLAMA SERVİSİ
// ==========================================

// 🔥 MERKEZİ MAİL ALICISI HESAPLAMA SERVİSİ (DETAYLI LOGLAMALI VERSİYON)
export const mailService = {
    async resolveMailRecipients(ipRecordId, taskType, clientId = null) {
        console.log(`\n======================================================`);
        console.log(`[MAIL SERVICE] 🚀 BAŞLIYOR...`);
        console.log(`[MAIL SERVICE] Gelen Parametreler -> ipRecordId: ${ipRecordId}, taskType: ${taskType}, clientId: ${clientId}`);
        
        let toList = [];
        let ccList = [];
        let targetPersonIds = [];

        try {
            // 1. Kayıt Tipi ve Sahiplik Bilgisini Al
            const { data: ipRecord, error: ipErr } = await supabase
                .from('ip_records')
                .select('record_owner_type, ip_type')
                .eq('id', ipRecordId)
                .maybeSingle();

            if (ipErr) console.error(`[MAIL SERVICE] ❌ ip_records sorgu hatası:`, ipErr);

            if (!ipRecord) {
                console.warn(`[MAIL SERVICE] ⚠️ IP Record veritabanında bulunamadı! ID: ${ipRecordId}`);
                console.log(`======================================================\n`);
                return { to: [], cc: [] };
            }

            const ipType = ipRecord.ip_type || 'trademark';
            const isThirdParty = ipRecord.record_owner_type === 'third_party';
            console.log(`[MAIL SERVICE] 📋 Dosya Bilgisi -> ipType: ${ipType}, isThirdParty: ${isThirdParty}`);

            // 2. Hedef Kişileri Belirle
            if (clientId) {
                targetPersonIds.push(clientId);
                console.log(`[MAIL SERVICE] 🎯 Arayüzden doğrudan clientId geldi, listeye eklendi: ${clientId}`);
            }

            // Eğer 3. taraf değilse ve clientId gelmediyse asıl başvuru sahiplerini bul
            if (!isThirdParty && targetPersonIds.length === 0) {
                console.log(`[MAIL SERVICE] 🔍 Kendi dosyamız (Self). Başvuru sahipleri (applicants) aranıyor...`);
                const { data: applicants, error: appErr } = await supabase
                    .from('ip_record_applicants')
                    .select('person_id')
                    .eq('ip_record_id', ipRecordId);
                
                if (appErr) console.error(`[MAIL SERVICE] ❌ ip_record_applicants sorgu hatası:`, appErr);
                
                if (applicants && applicants.length > 0) {
                    applicants.forEach(app => targetPersonIds.push(app.person_id));
                    console.log(`[MAIL SERVICE] ✅ Başvuru sahipleri bulundu:`, targetPersonIds);
                } else {
                    console.warn(`[MAIL SERVICE] ⚠️ Bu dosyanın ip_record_applicants tablosunda hiçbir sahibi yok!`);
                }
            } else if (isThirdParty && targetPersonIds.length === 0) {
                console.warn(`[MAIL SERVICE] ⚠️ Bu dosya 3. taraf (Rakip) ama görev sahibi (clientId) iletilmedi! Kime atacağımızı bilemiyoruz.`);
            }

            // 3. Persons Related (Müvekkil İlgili Kişileri) Ayarlarına Bak
            if (targetPersonIds.length > 0) {
                console.log(`[MAIL SERVICE] 🕵️ persons_related tablosunda şu ID'ler aranıyor:`, targetPersonIds);
                
                const { data: relatedPersons, error: relErr } = await supabase
                    .from('persons_related')
                    .select('*')
                    .in('person_id', targetPersonIds);

                if (relErr) console.error(`[MAIL SERVICE] ❌ persons_related sorgu hatası:`, relErr);

                if (relatedPersons && relatedPersons.length > 0) {
                    console.log(`[MAIL SERVICE] ✅ ${relatedPersons.length} adet yetkili kişi (ilgili) bulundu. Filtreleme başlıyor...`);
                    
                    relatedPersons.forEach(related => {
                        const email = related.email ? related.email.trim().toLowerCase() : null;
                        if (!email) {
                            console.log(`[MAIL SERVICE] ⏭️ İlgili kişinin (ID: ${related.id}) email adresi boş, atlanıyor.`);
                            return;
                        }

                        let isResponsible = false, notifyTo = false, notifyCc = false;

                        if (ipType === 'trademark') {
                            isResponsible = related.resp_trademark;
                            notifyTo = related.notify_trademark_to;
                            notifyCc = related.notify_trademark_cc;
                        } else if (ipType === 'patent') {
                            isResponsible = related.resp_patent;
                            notifyTo = related.notify_patent_to;
                            notifyCc = related.notify_patent_cc;
                        } else if (ipType === 'design') {
                            isResponsible = related.resp_design;
                            notifyTo = related.notify_design_to;
                            notifyCc = related.notify_design_cc;
                        }

                        console.log(`[MAIL SERVICE] ⚙️ Değerlendirme -> Email: ${email} | Sorumlu mu? ${isResponsible} | TO izni var mı? ${notifyTo} | CC izni var mı? ${notifyCc}`);

                        if (isResponsible) {
                            if (notifyTo) toList.push(email);
                            if (notifyCc) ccList.push(email);
                        }
                    });
                } else {
                    console.warn(`[MAIL SERVICE] ⚠️ persons_related tablosunda bu person_id'ler için hiçbir yetkili tanımlı değil!`);
                }
            } else {
                console.warn(`[MAIL SERVICE] ⚠️ targetPersonIds listesi boş, müvekkil tarafına mail atılamayacak.`);
            }

            // 4. Evreka İçi CC (Ekip Üyeleri) Listesini Al
            console.log(`[MAIL SERVICE] 🏢 Evreka içi CC (evreka_mail_cc_list) kontrolü yapılıyor. Aranacak TaskType: ${taskType}`);
            const { data: internalCcs, error: ccErr } = await supabase
                .from('evreka_mail_cc_list')
                .select('email, transaction_types');

            if (ccErr) console.error(`[MAIL SERVICE] ❌ evreka_mail_cc_list sorgu hatası:`, ccErr);

            if (internalCcs && internalCcs.length > 0) {
                internalCcs.forEach(internal => {
                    if (internal.email) {
                        const types = internal.transaction_types || [];
                        if (types.includes('All') || types.includes(String(taskType)) || types.includes(Number(taskType))) {
                            console.log(`[MAIL SERVICE] ➕ İç ekip üyesi CC'ye eklendi: ${internal.email}`);
                            ccList.push(internal.email.trim().toLowerCase());
                        }
                    }
                });
            } else {
                console.log(`[MAIL SERVICE] ℹ️ evreka_mail_cc_list tablosunda hiç kimse bulunamadı.`);
            }

            // 5. Temizlik (Tekrarları sil, TO'da olanı CC'den çıkar)
            toList = [...new Set(toList)].filter(Boolean);
            ccList = [...new Set(ccList)].filter(Boolean);
            ccList = ccList.filter(email => !toList.includes(email));

            console.log(`[MAIL SERVICE] 🎉 FİNAL LİSTE => TO:`, toList, `| CC:`, ccList);
            console.log(`======================================================\n`);
            
            return { to: toList, cc: ccList };
        } catch (error) {
            console.error(`[MAIL SERVICE] ❌ KRİTİK HATA:`, error);
            console.log(`======================================================\n`);
            return { to: [], cc: [] };
        }
    }
};

// ==========================================
// YENİ: MERKEZİ STORAGE (DOSYA YÜKLEME) SERVİSİ
// ==========================================
export const storageService = {
    // path formatı: 'persons/KISI_ID/belge.pdf' veya 'tasks/TASK_ID/evrak.pdf'
    async uploadFile(bucketName, path, file) {
        try {
            const { data, error } = await supabase.storage
                .from(bucketName)
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: true // Aynı isimde dosya varsa üzerine yazar
                });

            if (error) throw error;

            // Yüklenen dosyanın public URL'ini al
            const { data: urlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(path);

            return { success: true, url: urlData.publicUrl };
        } catch (error) {
            console.error(`[STORAGE] Dosya yükleme hatası (${path}):`, error);
            return { success: false, error: error.message };
        }
    }
};