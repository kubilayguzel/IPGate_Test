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
            name: personData.name, person_type: personData.type, tckn: personData.tckn || null, tax_no: personData.taxNo || null,
            tpe_no: personData.tpeNo || null, email: personData.email || null, phone: personData.phone || null,
            address: personData.address || null, country_code: personData.countryCode || null, province: personData.province || null,
            is_evaluation_required: personData.is_evaluation_required || false, documents: personData.documents || [],
            details: personData, updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('persons').update(payload).eq('id', id);
        if (error) return { success: false, error: error.message };
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
                await supabase.from('persons_related').delete().in('id', toDelete);
            }
            // 2. Güncellenecekler
            if (loaded && loaded.length > 0) {
                for (const r of loaded) {
                    if (r.id) {
                        const { id, ...updateData } = r;
                        await supabase.from('persons_related').update(updateData).eq('id', id);
                    }
                }
            }
            // 3. Yeni Eklenecekler
            if (draft && draft.length > 0) {
                const inserts = draft.map(d => ({
                    person_id: personId, name: d.name, email: d.email, phone: d.phone,
                    responsible: d.responsible || {}, notify: d.notify || {}
                }));
                await supabase.from('persons_related').insert(inserts);
            }
            return { success: true };
        } catch(e) {
            console.error("Related persons save error:", e);
            return { success: false };
        }
    }
};

// 2. İŞLEM TİPLERİ (TRANSACTION TYPES) SERVİSİ
export const transactionTypeService = {
    async getTransactionTypes() {
        const { data, error } = await supabase.from('transaction_types').select('id, name, alias, ip_type');
        if (error) return { success: false, data: [] };
        
        // Arayüzün beklediği format
        const mappedData = data.map(t => ({
            id: t.id,
            name: t.name,
            alias: t.alias,
            applicableToMainType: t.ip_type ? [t.ip_type] : [],
            code: t.id // Eğer eski sistem code arıyorsa diye fallback
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
// A) Tüm Portföyü Getir (Sınırsız IndexedDB + 1 Dakika TTL Önbellekli Versiyon)
    async getRecords(forceRefresh = false) {
        const CACHE_KEY = 'ip_records_cache';
        const TTL_MS = 1 * 60 * 1000; // 1 Dakika (Milisaniye)

        // 1. SINIRSIZ CACHE VE SÜRE KONTROLÜ
        if (!forceRefresh) {
            const cachedObj = await localCache.get(CACHE_KEY);
            if (cachedObj && cachedObj.timestamp && cachedObj.data) {
                const isExpired = (Date.now() - cachedObj.timestamp) > TTL_MS;
                
                if (!isExpired) {
                    console.log("⚡ Veriler 0 saniyede IndexedDB'den geldi (Güncel).");
                    return { success: true, data: cachedObj.data, from: 'cache' };
                }
                console.log("⏳ 1 Dakikalık süre dolmuş, Supabase'den taze veri çekiliyor...");
            }
        } else {
            console.log("🔄 Kullanıcı manuel yenileme başlattı!");
        }

        console.log("☁️ Veriler Supabase'den çekiliyor...");
        const { data, error } = await supabase
            .from('ip_records')
            .select(`
                id, application_number, application_date, registration_number, registration_date, renewal_date, 
                brand_name, ip_type, official_status, portfolio_status, origin, country_code, nice_classes, 
                wipo_ir, transaction_hierarchy, brand_image_url, created_at, updated_at,
                recordOwnerType:details->>recordOwnerType,
                applicantsJson:details->applicants,
                bulletinNo:details->>bulletinNo,
                bulletinDate:details->>bulletinDate,
                brandInfo:details->brandInfo,
                bulletins:details->bulletins,
                ownerName:details->>ownerName,
                applicantName:details->>applicantName,
                ip_record_persons ( role, persons ( id, name, person_type ) )
            `)
            .limit(10000)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Markalar çekilemedi:", error);
            return { success: false, data: [] };
        }

        const mappedData = data.map(record => {
            let applicantsArray = record.ip_record_persons
                ? record.ip_record_persons.filter(rel => rel.role === 'applicant' && rel.persons).map(rel => ({
                    id: rel.persons.id, name: rel.persons.name, personType: rel.persons.person_type
                })) : [];

            if (applicantsArray.length === 0 && Array.isArray(record.applicantsJson)) applicantsArray = record.applicantsJson;

            return {
                id: record.id, applicationNumber: record.application_number, applicationDate: record.application_date,
                registrationNumber: record.registration_number, registrationDate: record.registration_date, renewalDate: record.renewal_date,
                title: record.brand_name, brandText: record.brand_name, type: record.ip_type, status: record.official_status,
                recordStatus: record.portfolio_status, portfoyStatus: record.portfolio_status, origin: record.origin, country: record.country_code,
                niceClasses: record.nice_classes || [], wipoIR: record.wipo_ir, aripoIR: record.wipo_ir, transactionHierarchy: record.transaction_hierarchy,
                brandImageUrl: record.brand_image_url, trademarkImage: record.brand_image_url, applicants: applicantsArray,
                recordOwnerType: record.recordOwnerType || 'self', 
                details: {
                    recordOwnerType: record.recordOwnerType, bulletinNo: record.bulletinNo, bulletinDate: record.bulletinDate,
                    brandInfo: record.brandInfo, bulletins: record.bulletins, ownerName: record.ownerName, applicantName: record.applicantName
                },                
                createdAt: record.created_at, updatedAt: record.updated_at
            };
        });

        // 3. SONUCU SINIRSIZ ÖNBELLEĞE "ZAMAN DAMGASI" İLE YAZ
        await localCache.set(CACHE_KEY, { timestamp: Date.now(), data: mappedData });

        return { success: true, data: mappedData, from: 'server' };
    },

    // B) Tek bir markanın detaylarını çeker (Burada * kalmalı çünkü tüm detaylar lazım)
    async getRecordById(id) {
        const { data: record, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_persons ( role, persons ( id, name, person_type, address ) )
            `)
            .eq('id', id)
            .single();

        if (error) return { success: false, error: error.message };

        let detailsObj = record.details || {};
        let applicantsArray = record.ip_record_persons
            ? record.ip_record_persons
                .filter(rel => rel.role === 'applicant' && rel.persons)
                .map(rel => ({
                    id: rel.persons.id, name: rel.persons.name, personType: rel.persons.person_type
                }))
            : [];

        if (applicantsArray.length === 0 && Array.isArray(detailsObj.applicants)) applicantsArray = detailsObj.applicants;

        const mappedData = {
            ...detailsObj, 
            id: record.id, applicationNumber: record.application_number, applicationDate: record.application_date,
            registrationNumber: record.registration_number, registrationDate: record.registration_date, renewalDate: record.renewal_date,
            title: record.brand_name || detailsObj.title, brandText: record.brand_name || detailsObj.brandText,
            type: record.ip_type || detailsObj.type, status: record.official_status || detailsObj.status,
            portfoyStatus: record.portfolio_status || detailsObj.portfoyStatus, origin: record.origin || detailsObj.origin,
            country: record.country_code || detailsObj.country, wipoIR: record.wipo_ir || detailsObj.wipoIR,
            brandImageUrl: record.brand_image_url || detailsObj.brandImageUrl, niceClasses: record.nice_classes || detailsObj.niceClasses || [],
            goodsAndServicesByClass: record.goods_and_services || detailsObj.goodsAndServicesByClass || [],
            applicants: applicantsArray, createdAt: record.created_at, updatedAt: record.updated_at
        };

        return { success: true, data: mappedData };
    },

    // C) İşlem Geçmişini Çeker
    async getTransactionsForRecord(recordId) {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('ip_record_id', recordId)
            .order('created_at', { ascending: true });

        if (error) return { success: false, error: error.message };

        const mappedTransactions = data.map(tx => ({
            id: tx.id, type: tx.transaction_type_id || (tx.details && tx.details.type), timestamp: tx.created_at,
            date: tx.created_at, transactionHierarchy: tx.transaction_hierarchy, parentId: tx.parent_id, ...tx.details 
        }));
        return { success: true, transactions: mappedTransactions };
    },

    async getRecordsByType(type) {
        const result = await this.getRecords();
        if(result.success) result.data = result.data.filter(r => r.type === type);
        return result;
    },

    // D) SİLME İŞLEMİ (Cache Temizliği Güncellendi)
    async deleteParentWithChildren(id) {
        const { error } = await supabase.from('ip_records').delete().eq('id', id);
        if (error) return { success: false, error: error.message };
        await localCache.remove('ip_records_cache'); 
        return { success: true };
    },

    // E) GÜNCELLEME İŞLEMİ (Cache Temizliği Güncellendi)
    async updateRecord(id, data) {
        try {
            const updateData = {
                brand_name: data.title || data.brandText || null, application_number: data.applicationNumber || null, application_date: data.applicationDate || null,
                registration_number: data.registrationNumber || data.internationalRegNumber || null, registration_date: data.registrationDate || null,
                renewal_date: data.renewalDate || null, brand_type: data.brandType || null, brand_category: data.brandCategory || null,
                ip_type: data.ipType || data.type || null, origin: data.origin || null, portfolio_status: data.portfoyStatus || data.recordStatus || null,
                official_status: data.status || null, nice_classes: data.niceClasses ? data.niceClasses.map(Number).filter(n => !isNaN(n)) : [],
                goods_and_services: data.goodsAndServicesByClass || null, wipo_ir: data.wipoIR || data.aripoIR || data.internationalRegNumber || null,
                country_code: data.country || null, brand_image_url: data.brandImageUrl || null, updated_at: new Date().toISOString(), details: data 
            };

            Object.keys(updateData).forEach(key => { if (updateData[key] === undefined) delete updateData[key]; });

            const { error: updateError } = await supabase.from('ip_records').update(updateData).eq('id', id);
            if (updateError) throw updateError;

            if (data.applicants && Array.isArray(data.applicants)) {
                await supabase.from('ip_record_persons').delete().eq('ip_record_id', id).eq('role', 'applicant');
                if (data.applicants.length > 0) {
                    const personsToInsert = data.applicants.map(app => ({ ip_record_id: id, person_id: app.id, role: 'applicant' }));
                    await supabase.from('ip_record_persons').insert(personsToInsert);
                }
            }

            await localCache.remove('ip_records_cache'); 
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    },

    // F) YENİ KAYIT EKLEME (Cache Temizliği Güncellendi)
    async createRecordFromDataEntry(data) {
        try {
            const insertData = {
                brand_name: data.title || data.brandText || null, application_number: data.applicationNumber || null, application_date: data.applicationDate || null,
                registration_number: data.registrationNumber || data.internationalRegNumber || null, registration_date: data.registrationDate || null, renewal_date: data.renewalDate || null,
                brand_type: data.brandType || null, brand_category: data.brandCategory || null, ip_type: data.ipType || data.type || null, origin: data.origin || null,
                portfolio_status: data.portfoyStatus || data.status || 'active', official_status: data.status || null,
                nice_classes: data.niceClasses ? data.niceClasses.map(Number).filter(n => !isNaN(n)) : [], goods_and_services: data.goodsAndServicesByClass || null,
                wipo_ir: data.wipoIR || data.aripoIR || data.internationalRegNumber || null, country_code: data.country || null, parent_id: data.parentId || null,
                transaction_hierarchy: data.transactionHierarchy || 'parent', brand_image_url: data.brandImageUrl || null, details: data
            };

            Object.keys(insertData).forEach(key => { if (insertData[key] === undefined) delete insertData[key]; });

            const { data: newRecord, error: insertError } = await supabase.from('ip_records').insert(insertData).select('id').single();
            if (insertError) throw insertError;

            if (data.applicants && Array.isArray(data.applicants) && data.applicants.length > 0) {
                const personsToInsert = data.applicants.map(app => ({ ip_record_id: newRecord.id, person_id: app.id, role: 'applicant' }));
                await supabase.from('ip_record_persons').insert(personsToInsert);
            }

            await localCache.remove('ip_records_cache'); 
            return { success: true, id: newRecord.id };
        } catch (error) { return { success: false, error: error.message }; }
    },

    // G) İŞLEM (TRANSACTION) EKLEME 
    async addTransactionToRecord(recordId, txData) {
        try {
            const insertData = {
                ip_record_id: recordId, transaction_type_id: txData.transactionTypeId || txData.type, description: txData.description || 'Yeni İşlem',
                transaction_hierarchy: txData.transactionHierarchy || 'parent', parent_id: txData.parentId || null, details: txData, created_at: new Date().toISOString()
            };
            const { data, error } = await supabase.from('transactions').insert(insertData).select('id').single();
            if (error) throw error;
            return { success: true, id: data.id };
        } catch (error) { return { success: false, error: error.message }; }
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

    // 5. Görev Ekleme
    async addTask(taskData) {
        try {
            const payload = {
                title: taskData.title,
                description: taskData.description || null,
                task_type: String(taskData.taskType),
                status: taskData.status || 'open',
                priority: taskData.priority || 'normal',
                due_date: taskData.dueDate || null,
                official_due_date: taskData.officialDueDate || null,
                operational_due_date: taskData.operationalDueDate || null,
                assigned_to_user_id: taskData.assignedTo_uid || null,
                ip_record_id: taskData.relatedIpRecordId ? String(taskData.relatedIpRecordId) : null,
                transaction_id: taskData.transactionId ? String(taskData.transactionId) : null,
                epats_document: taskData.epatsDocument || null, 
                history: taskData.history || [],
                details: taskData 
            };
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            const { data, error } = await supabase.from('tasks').insert(payload).select('id').single();
            if (error) throw error;
            return { success: true, data: { id: data.id } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // 6. Görev Güncelleme
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
                assigned_to_user_id: updateData.assignedTo_uid || updateData.assigned_to_user_id,
                ip_record_id: updateData.relatedIpRecordId ? String(updateData.relatedIpRecordId) : undefined,
                transaction_id: updateData.transactionId ? String(updateData.transactionId) : undefined,
                history: updateData.history,
                updated_at: new Date().toISOString(),
                details: updateData
            };
            Object.keys(payload).forEach(key => { if (payload[key] === undefined) delete payload[key]; });
            const { error } = await supabase.from('tasks').update(payload).eq('id', String(taskId));
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
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