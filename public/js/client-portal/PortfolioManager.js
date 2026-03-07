// public/js/client-portal/PortfolioManager.js
import { supabase } from '../../supabase-config.js';

export class PortfolioManager {
    // 1. Portföyü (Marka, Patent, Tasarım) Çek
    async getPortfolios(clientIds) {
        if (!clientIds || clientIds.length === 0) return [];

        try {
            // !inner komutu, sadece bu applicant_id'ye sahip kayıtları getirmesini sağlar
            const { data, error } = await supabase
                .from('ip_records')
                .select(`
                    *,
                    ip_record_trademark_details (brand_name, brand_image_url),
                    ip_record_classes (class_no),
                    ip_record_applicants!inner (person_id)
                `)
                .in('ip_record_applicants.person_id', clientIds)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Arayüzün (UI) beklediği CamelCase formata çeviriyoruz
            return data.map(item => {
                const tmDetails = item.ip_record_trademark_details?.[0] || {};
                const classes = item.ip_record_classes ? item.ip_record_classes.map(c => c.class_no).join(', ') : '-';
                
                return {
                    id: item.id,
                    type: item.ip_type,
                    origin: item.origin || 'TÜRKPATENT',
                    country: item.country_code,
                    title: tmDetails.brand_name || '-',
                    brandImageUrl: tmDetails.brand_image_url || '',
                    applicationNumber: item.application_number || '-',
                    registrationNumber: item.registration_number || item.wipo_ir || item.aripo_ir || '-',
                    applicationDate: item.application_date,
                    renewalDate: item.renewal_date,
                    status: item.status,
                    classes: classes,
                    transactionHierarchy: item.transaction_hierarchy,
                    parentId: item.parent_id,
                    // HTML tarafındaki arama/filtreleme mantığı için
                    applicants: item.ip_record_applicants.map(app => ({ id: app.person_id }))
                };
            });
        } catch (error) {
            console.error("Portföy çekilirken hata:", error);
            return [];
        }
    }

    // 2. Davaları (Suits) Çek
    async getSuits(clientIds) {
        if (!clientIds || clientIds.length === 0) return [];

        try {
            const { data, error } = await supabase
                .from('suits')
                .select('*')
                .in('client_id', clientIds)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return data.map(suit => ({
                id: String(suit.id),
                caseNo: suit.file_no || '-',
                title: suit.title || 'Dava',
                court: suit.court_name || '-',
                opposingParty: suit.defendant || suit.plaintiff || '-',
                openingDate: suit.created_at,
                suitStatus: suit.status || 'Devam Ediyor',
                client: { id: suit.client_id }
            }));
        } catch (error) {
            console.error("Davalar çekilirken hata:", error);
            return [];
        }
    }
}