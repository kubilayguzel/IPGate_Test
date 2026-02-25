// supabase/functions/create-objection-task/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TURKEY_HOLIDAYS = ["01-01", "04-23", "05-01", "05-19", "07-15", "08-30", "10-29"];
function isWeekend(date: Date) { return date.getDay() === 0 || date.getDay() === 6; }
function isHoliday(date: Date) { const mm = String(date.getMonth() + 1).padStart(2, '0'); const dd = String(date.getDate()).padStart(2, '0'); return TURKEY_HOLIDAYS.includes(`${mm}-${dd}`); }
function findNextWorkingDay(date: Date) { let t = new Date(date); let i = 0; while ((isWeekend(t) || isHoliday(t)) && i < 30) { t.setDate(t.getDate() + 1); i++; } return t; }

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { monitoredMarkId, similarMark, similarMarkName, bulletinNo, callerEmail, bulletinRecordData } = await req.json();

        if (!monitoredMarkId || !similarMark || !bulletinNo) {
            throw new Error('Eksik parametre.');
        }

        const hitMarkName = similarMarkName || similarMark?.markName || 'Bilinmeyen Marka';

        // 1. 🔥 ŞEMA UYUMLU: Bülten Kaydını Ekle (bulletin_id sütunu yok, sadece bulletin_no kullanıyoruz)
        const newBulletinRecordId = crypto.randomUUID();
        if (bulletinRecordData) {
            const safeHolders = Array.isArray(bulletinRecordData.holders) ? bulletinRecordData.holders.map((h:any) => h.name || h.holderName || h).join(', ') : String(bulletinRecordData.holders || '');
            const safeNiceClasses = Array.isArray(bulletinRecordData.niceClasses) ? bulletinRecordData.niceClasses.join(', ') : String(bulletinRecordData.niceClasses || '');
            
            await supabase.from('trademark_bulletin_records').insert({
                id: newBulletinRecordId,
                bulletin_no: String(bulletinNo),
                mark_name: String(hitMarkName),
                application_no: String(similarMark?.applicationNo || ''),
                application_date: bulletinRecordData.applicationDate || null,
                image_path: bulletinRecordData.imagePath || null,
                nice_classes: safeNiceClasses,
                holders: safeHolders
            });
        }

        // 2. 🔥 ŞEMA UYUMLU: 3. Taraf Portföy Kaydını (Rakip Marka) Ekliyoruz
        const thirdPartyIpRecordId = crypto.randomUUID();
        await supabase.from('ip_records').insert({
            id: thirdPartyIpRecordId,
            brand_name: hitMarkName,
            application_number: String(similarMark?.applicationNo || ''),
            ip_type: 'trademark',
            origin: 'TÜRKPATENT',
            portfolio_status: 'third_party',
            official_status: 'Yayımda',
            brand_image_url: bulletinRecordData?.imagePath || null,
            details: {
                source: 'similarity_search',
                niceClasses: similarMark?.niceClasses || [],
                bulletinNo: bulletinNo
            }
        });

        // 3. ŞEMA UYUMLU: İzlenen Markayı ve Müşteriyi Bul (client_id ve ip_record_id kullanılarak)
        const { data: monitoredData } = await supabase.from('monitoring_trademarks').select('*').eq('id', monitoredMarkId).single();
        const relatedIpRecordId = monitoredData?.ip_record_id || null;
        let clientName = monitoredData?.owner_name || 'İzlenen Marka Sahibi';
        
        let clientId = null;
        let ipAppNo = monitoredData?.application_no || "-";
        let ipTitle = monitoredData?.mark_name || "-";

        if (relatedIpRecordId) {
            const { data: ipData } = await supabase.from('ip_records').select('*').eq('id', relatedIpRecordId).single();
            if (ipData) {
                clientId = ipData.details?.clientId || ipData.details?.client_id || null;
                ipAppNo = ipData.application_number || ipAppNo;
                ipTitle = ipData.brand_name || ipTitle;

                if (clientId) {
                    const { data: pData } = await supabase.from('persons').select('name').eq('id', clientId).single();
                    if (pData) clientName = pData.name || clientName;
                }
            }
        }

        // 4. Son Tarih Hesaplama
        let officialDueDate = null;
        const { data: bulletinData } = await supabase.from('trademark_bulletins').select('bulletin_date').eq('bulletin_no', bulletinNo).single();
        if (bulletinData?.bulletin_date) {
            const pts = bulletinData.bulletin_date.split(/[./-]/);
            if (pts.length === 3) {
                let bDate = pts[0].length === 4 ? new Date(parseInt(pts[0]), parseInt(pts[1]) - 1, parseInt(pts[2])) : new Date(parseInt(pts[2]), parseInt(pts[1]) - 1, parseInt(pts[0]));
                bDate.setMonth(bDate.getMonth() + 2);
                officialDueDate = findNextWorkingDay(bDate);
            }
        }

        // 5. ŞEMA UYUMLU: Görevi (Task) Oluştur 
        let newTaskId = `task_${Date.now()}`;
        try {
            const { data: countData } = await supabase.from('counters').select('last_id').eq('id', 'tasks').single();
            const nextId = (countData?.last_id || 0) + 1;
            await supabase.from('counters').upsert({ id: 'tasks', last_id: nextId });
            newTaskId = String(nextId);
        } catch(e) {}

        await supabase.from('tasks').insert({
            id: newTaskId, 
            task_type: '20', 
            status: 'awaiting_client_approval', 
            priority: 'medium',
            related_ip_record_id: relatedIpRecordId, 
            client_id: clientId,
            title: `Yayına İtiraz: ${hitMarkName} (Bülten No: ${bulletinNo})`,
            description: `${ipTitle} için bültende benzer bulunan ${hitMarkName} markasına itiraz işi.`,
            due_date: officialDueDate?.toISOString() || null,
            iprecord_application_no: ipAppNo, 
            iprecord_title: ipTitle, 
            iprecord_applicant_name: clientName,
            details: { objectionTarget: hitMarkName, targetAppNo: similarMark?.applicationNo, bulletinNo, monitoredMarkId, similarityScore: similarMark?.similarityScore || 0 }
        });

        // 6. ŞEMA UYUMLU: Transaction Kaydı (İtiraz Edildi)
        await supabase.from('transactions').insert({
            id: crypto.randomUUID(),
            ip_record_id: thirdPartyIpRecordId,
            transaction_type_id: '20',
            description: 'Yayına İtiraz Edildi',
            transaction_hierarchy: 'parent',
            details: { taskId: newTaskId, oppositionOwner: clientName }
        });

        // Fonksiyon sorunsuz bitiyor ve Arayüze geri dönüyor
        return new Response(JSON.stringify({ 
            success: true, 
            taskId: newTaskId,
            bulletinRecordId: newBulletinRecordId
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Task Oluşturma Hatası:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }
});