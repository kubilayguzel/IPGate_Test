import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// TODO: Kendi URL ve Anon Key'inizi buraya girin
const supabaseUrl = 'https://guicrctynauzxhyfpdfe.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1aWNyY3R5bmF1enhoeWZwZGZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDQ3MjcsImV4cCI6MjA4NzI4MDcyN30.Zp1ZoXfsz6y6UcZtOAWlIWY2USjJ8x-0iogtizX0EkQ';

export const supabase = createClient(supabaseUrl, supabaseKey);
console.log('🚀 Supabase Motoru Başarıyla Çalıştı!');

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

            // Şimdilik test amaçlı rolü user atıyoruz. İleride 'users' tablosundan çekeceğiz.
            const userData = { 
                uid: data.user.id, 
                email: data.user.email, 
                displayName: data.user.user_metadata?.display_name || '', 
                role: 'user', 
                isSuperAdmin: false 
            };
            localStorage.setItem('currentUser', JSON.stringify(userData));
            
            return { success: true, user: userData, message: "Giriş başarılı!" };
        } catch (error) {
            console.error("Giriş hatası:", error);
            return { success: false, error: "Hatalı e-posta veya şifre: " + error.message };
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
        const { data, error } = await supabase.from('persons').select('id, name, person_type').order('name', { ascending: true });
        if (error) {
            console.error("Kişiler çekilemedi:", error);
            return { success: false, error: error.message };
        }
        return { success: true, data: data };
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
        const { data, error } = await supabase.from('common_data').select('data').eq('id', 'countries').single();
        if (error || !data) return { success: false, data: [] };
        // Veriyi JSONB olarak kaydetmiştik, aynen çıkarıyoruz
        return { success: true, data: data.data.list || [] };
    }
};

// 4. PORTFÖY (IP RECORDS) SERVİSİ
export const ipRecordsService = {
    // A) Tüm Portföyü Getir
    async getRecords() {
        const { data, error } = await supabase
            .from('ip_records')
            .select(`
                *,
                ip_record_persons (
                    role,
                    persons ( id, name, person_type )
                )
            `)
            .limit(10000) // 🔥 YENİ: 1000 satır sınırını kaldırıp 10.000'e çıkarıyoruz
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Markalar çekilemedi:", error);
            return { success: false, data: [] };
        }

        const mappedData = data.map(record => {
            const applicantsArray = record.ip_record_persons
                ? record.ip_record_persons
                    .filter(rel => rel.role === 'applicant' && rel.persons)
                    .map(rel => ({
                        id: rel.persons.id,
                        name: rel.persons.name,
                        personType: rel.persons.person_type
                    }))
                : [];

            return {
                id: record.id,
                applicationNumber: record.application_number,
                applicationDate: record.application_date,
                registrationNumber: record.registration_number,
                registrationDate: record.registration_date,
                renewalDate: record.renewal_date,
                title: record.brand_name,
                brandText: record.brand_name,
                type: record.ip_type,
                status: record.official_status,
                recordStatus: record.portfolio_status,
                portfoyStatus: record.portfolio_status, 
                origin: record.origin,
                country: record.country_code,
                niceClasses: record.nice_classes || [],
                wipoIR: record.wipo_ir,
                aripoIR: record.wipo_ir, 
                transactionHierarchy: record.transaction_hierarchy,
                brandImageUrl: record.brand_image_url,
                trademarkImage: record.brand_image_url,
                goodsAndServicesByClass: record.goods_and_services,
                applicants: applicantsArray,
                
                // 🔥 YENİ: Arayüzün filtreleme için şiddetle ihtiyaç duyduğu alan:
                recordOwnerType: record.record_owner_type, 
                
                createdAt: record.created_at,
                updatedAt: record.updated_at
            };
        });

        return { success: true, data: mappedData, from: 'server' };
    },

    // B) Sadece Belirli Türdeki (Örn: trademark) Kayıtları Getir
    async getRecordsByType(type) {
        // Aslında backend'de filtreleme yapabiliriz ama hızlı geçiş için
        // tümünü çekip filtrelemek (mevcut FastCache mimarinize uygun) daha güvenli:
        const result = await this.getRecords();
        if(result.success) {
            result.data = result.data.filter(r => r.type === type);
        }
        return result;
    },

    // C) Kayıt Silme
    async deleteParentWithChildren(id) {
        // ON DELETE CASCADE kullandığımız için parent'ı silince tüm her şey otomatik silinecek!
        const { error } = await supabase.from('ip_records').delete().eq('id', id);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // D) Durum Güncelleme
    async updateRecord(id, updates) {
        const payload = { updated_at: new Date().toISOString() };
        if (updates.portfoyStatus) payload.portfolio_status = updates.portfoyStatus;
        if (updates.recordStatus) payload.portfolio_status = updates.recordStatus;

        const { error } = await supabase.from('ip_records').update(payload).eq('id', id);
        if (error) return { success: false, error: error.message };
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
            ...r.details 
        }));

        return { 
            success: true, 
            parents: formatData(parents || []), 
            children: formatData(children || []) 
        };
    }
};