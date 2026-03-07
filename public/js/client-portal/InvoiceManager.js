// public/js/client-portal/data/InvoiceManager.js
import { supabase } from '../../supabase-config.js';

export class InvoiceManager {
    async getInvoices(clientIds) {
        if (!clientIds || clientIds.length === 0) return [];

        try {
            // Sadece bu müvekkile kesilmiş faturaları (service_invoice_party_id) getir ve bağlı olduğu işin detaylarını JOIN yap
            const { data, error } = await supabase
                .from('accruals')
                .select(`
                    *,
                    tasks (
                        title,
                        ip_records ( application_number, ip_record_trademark_details(brand_name) )
                    )
                `)
                .in('service_invoice_party_id', clientIds)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return data.map(acc => {
                const task = acc.tasks || {};
                const ipRecord = task.ip_records || {};
                const tmDetails = ipRecord.ip_record_trademark_details?.[0] || {};

                return {
                    id: acc.id,
                    invoiceNo: acc.evreka_invoice_no || acc.tpe_invoice_no || acc.id.substring(0, 8).toUpperCase(),
                    taskId: acc.task_id,
                    taskTitle: task.title || acc.accrual_type || 'Hizmet Bedeli',
                    applicationNumber: ipRecord.application_number || '-',
                    brandName: tmDetails.brand_name || '-',
                    createdAt: acc.created_at,
                    status: acc.status,
                    
                    // Ücretler ve JSONB dizileri
                    officialFee: { amount: acc.official_fee_amount, currency: acc.official_fee_currency },
                    serviceFee: { amount: acc.service_fee_amount, currency: acc.service_fee_currency },
                    totalAmount: acc.total_amount, // Supabase otomatik JSONB parse eder
                    remainingAmount: acc.remaining_amount, 
                    
                    serviceInvoicePartyId: acc.service_invoice_party_id
                };
            });
        } catch (error) {
            console.error("Faturalar çekilirken hata:", error);
            return [];
        }
    }
}