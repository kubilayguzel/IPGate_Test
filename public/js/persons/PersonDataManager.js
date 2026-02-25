import { personService, commonService, supabase } from '../../supabase-config.js';

export class PersonDataManager {
    async fetchPersons() { return await personService.getPersons(); }
    
    async getCountries() {
        const res = await commonService.getCountries();
        return res.success ? res.data : [];
    }

    async getProvinces(countryCode) {
        if (!/^(TR|TUR)$/i.test(countryCode)) return [];
        try {
            const { data, error } = await supabase.from('common').select('data').in('id', ['provinces_TR', 'cities_TR', 'turkey_provinces']);
            if (data && data.length > 0) {
                for(const row of data) {
                    if(row.data.list) return row.data.list;
                    if(row.data.provinces) return row.data.provinces;
                }
            }
            return [];
        } catch (e) {
            console.error("İller çekilirken hata:", e);
            return [];
        }
    }

    async getRelatedPersons(personId) {
        return await personService.getRelatedPersons(personId);
    }

    async uploadDocument(file) {
        try {
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `person_documents/${Date.now()}_${cleanFileName}`;

            const { data, error } = await supabase.storage
                .from('person_documents')
                .upload(path, file, { cacheControl: '3600', upsert: false });

            if (error) throw error;

            const { data: urlData } = supabase.storage
                .from('person_documents')
                .getPublicUrl(path);

            return urlData.publicUrl;
        } catch (error) {
            console.error("Doküman yüklenirken hata:", error);
            throw error;
        }
    }

    // 🔥 YENİ: Storage'dan Dosya Silme İşlemi
    async deleteDocument(url) {
        if (!url) return;
        try {
            // Public URL'den dosyanın Bucket içindeki tam yolunu (path) çıkarıyoruz
            const bucketStr = '/object/public/person_documents/';
            const idx = url.indexOf(bucketStr);
            if (idx !== -1) {
                const filePath = decodeURIComponent(url.substring(idx + bucketStr.length));
                const { error } = await supabase.storage.from('person_documents').remove([filePath]);
                
                if (error) {
                    console.error("Storage dosya silme hatası:", error);
                } else {
                    console.log("Dosya Storage'dan başarıyla silindi:", filePath);
                }
            }
        } catch (e) {
            console.error("Dosya silme işleminde hata:", e);
        }
    }
}