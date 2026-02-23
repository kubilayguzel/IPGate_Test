// public/js/persons/PersonDataManager.js
import { personService, commonService, supabase } from '../../supabase-config.js';

export class PersonDataManager {
    async fetchPersons() { return await personService.getPersons(); }
    
    async getCountries() {
        const res = await commonService.getCountries();
        return res.success ? res.data : [];
    }

    async getProvinces(countryCode) {
        if (!/^(TR|TUR)$/i.test(countryCode)) return [];
        // Türkiye illerini Supabase common_data'dan çekiyoruz
        const { data, error } = await supabase.from('common').select('data').in('id', ['provinces_TR', 'cities_TR', 'turkey_provinces']);
        if (data && data.length > 0) {
            for(const row of data) {
                if(row.data.list) return row.data.list;
                if(row.data.provinces) return row.data.provinces;
            }
        }
        return [];
    }

    async getRelatedPersons(personId) {
        return await personService.getRelatedPersons(personId);
    }

    // 🚀 DOSYA YÜKLEME: Artık %100 Supabase Storage kullanıyor!
    async uploadDocument(file) {
        try {
            // Dosya adındaki boşluk ve Türkçe karakterleri temizleyelim ki URL sorun çıkarmasın
            const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `${Date.now()}_${cleanFileName}`;

            // 1. Supabase Storage'a Yükle
            const { data, error } = await supabase.storage
                .from('person_documents')
                .upload(path, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) {
                console.error("Supabase Storage Yükleme Hatası:", error);
                throw error;
            }

            // 2. Yüklenen dosyanın Public (Açık) URL'ini al
            const { data: urlData } = supabase.storage
                .from('person_documents')
                .getPublicUrl(path);

            return urlData.publicUrl;

        } catch (error) {
            console.error("Doküman yüklenirken hata oluştu:", error);
            throw error;
        }
    }
}