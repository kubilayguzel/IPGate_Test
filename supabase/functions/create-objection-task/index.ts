// supabase/functions/create-objection-task/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Basit Hafta Sonu Kontrolü (Firebase kodunuzdaki mantık)
function isWeekend(date: Date) {
    const day = date.getDay();
    return day === 0 || day === 6; // Pazar(0) veya Cumartesi(6)
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // Tablolara tam erişim için Service Role
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { monitoredMarkId, similarMark, similarMarkName, bulletinNo, callerEmail, bulletinRecordData } = await req.json();

        if (!monitoredMarkId || !similarMark || !bulletinNo) {
            throw new Error("Eksik parametre: monitoredMarkId, similarMark veya bulletinNo gereklidir.");
        }

        console.log(`🚀 İtiraz İşi Oluşturuluyor: Hit=${similarMarkName}, MonitoredId=${monitoredMarkId}`);

        // 1. İZLENEN MARKA, PORTFÖY VE MÜVEKKİL BİLGİSİNİ TEK SORGUDAN ÇEK
        const { data: monitoredData, error: monErr } = await supabase
            .from('monitoring_trademarks')
            .select(`
                *,
                ip_records (
                    id, application_number, mark_name, title, client_id, applicants,
                    persons ( id, name, company_name, email, phone )
                )
            `)
            .eq('id', monitoredMarkId)
            .single();

        if (monErr || !monitoredData) throw new Error("İzlenen marka bulunamadı.");

        const ipRecord = monitoredData.ip_records || {};
        const clientInfo = ipRecord.persons || {};
        const clientId = ipRecord.client_id || monitoredData.client_id || null;
        
        let ipAppName = clientInfo.name || clientInfo.company_name || "-";
        if (ipAppName === "-" && ipRecord.applicants && ipRecord.applicants.length > 0) {
            ipAppName = ipRecord.applicants[0].name || "-";
        }

        const ipTitle = ipRecord.title || ipRecord.mark_name || monitoredData.mark_name || "-";
        const ipAppNo = ipRecord.application_number || monitoredData.application_no || "-";

        // 2. GÖREV ATAMASI (Tip 20 için "task_assignments" tablosundan yetkiliyi bul)
        let assignedUid = null;
        let assignedEmail = callerEmail || null;

        const { data: assignData } = await supabase.from('task_assignments').select('assignee_ids').eq('task_type', '20').single();
        if (assignData && assignData.assignee_ids && assignData.assignee_ids.length > 0) {
            assignedUid = assignData.assignee_ids[0];
            const { data: userData } = await supabase.from('users').select('email').eq('id', assignedUid).single();
            if (userData) assignedEmail = userData.email;
        }

        // 3. TARİH HESAPLAMA (Bülten Tarihi + 2 Ay + Hafta sonu atlama)
        let officialDueDate = null;
        let dueDateDetails = null;
        
        const { data: bulletinData } = await supabase.from('trademark_bulletins').select('bulletin_date').eq('bulletin_no', bulletinNo).single();
        
        if (bulletinData && bulletinData.bulletin_date) {
            const bDate = new Date(bulletinData.bulletin_date);
            if (!isNaN(bDate.getTime())) {
                const rawDue = new Date(bDate);
                rawDue.setMonth(rawDue.getMonth() + 2); // 2 Ay Ekle
                
                // Hafta sonu atlama
                let adjustedDue = new Date(rawDue);
                let iter = 0;
                while (isWeekend(adjustedDue) && iter < 10) {
                    adjustedDue.setDate(adjustedDue.getDate() + 1);
                    iter++;
                }

                officialDueDate = adjustedDue.toISOString();
                dueDateDetails = {
                    bulletinDate: bDate.toISOString().split('T')[0],
                    periodMonths: 2,
                    originalCalculatedDate: rawDue.toISOString().split('T')[0],
                    finalOfficialDueDate: adjustedDue.toISOString().split('T')[0]
                };
            }
        }

        // 🔥 4. COUNTERS TABLOSUNDAN GÜVENLİ ID ALIMI
        // RPC'mizi çağırıp çakışmasız, sıralı ID'mizi alıyoruz.
        let taskId = crypto.randomUUID(); // Fallback
        const { data: nextId, error: rpcErr } = await supabase.rpc('get_next_task_id_from_counters');
        if (!rpcErr && nextId) {
            taskId = nextId; // Örn: "1054"
        } else {
            console.error("⚠️ Sayaçtan ID alınamadı, UUID kullanılacak:", rpcErr);
        }

        // 5. GÖREVİ (TASK) HAZIRLA VE KAYDET
        const hitMarkName = similarMarkName || similarMark.markName || 'Bilinmeyen Marka';
        
        const taskPayload = {
            id: taskId,
            task_type: '20',
            status: 'awaiting_client_approval', // Müvekkil onayı bekliyor
            priority: 'medium',
            related_ip_record_id: ipRecord.id || null,
            related_ip_record_title: ipTitle,
            client_id: clientId,
            client_email: clientInfo.email || null,
            assigned_to_user_id: assignedUid,
            assigned_to_email: assignedEmail,
            title: `Yayına İtiraz: ${hitMarkName} (Bülten No: ${bulletinNo})`,
            description: `${ipTitle} markamız için bültende benzer bulunan "${hitMarkName}" markasına itiraz işi.`,
            iprecord_application_no: ipAppNo,
            iprecord_title: ipTitle,
            iprecord_applicant_name: ipAppName,
            due_date: officialDueDate,
            official_due_date: officialDueDate,
            details: {
                objectionTarget: hitMarkName,
                targetAppNo: similarMark.applicationNo || '',
                targetNiceClasses: similarMark.niceClasses || [],
                bulletinNo: bulletinNo,
                monitoredMarkId: monitoredMarkId,
                similarityScore: similarMark.similarityScore || 0,
                relatedParty: {
                    id: clientId,
                    name: ipAppName,
                    email: clientInfo.email || null
                },
                officialDueDateDetails: dueDateDetails
            },
            source: 'similarity_search',
            created_by: callerEmail || 'system'
        };

        const { error: taskErr } = await supabase.from('tasks').insert(taskPayload);
        if (taskErr) throw taskErr;

        // 6. BÜLTEN KAYDINI YARAT (Opsiyonel)
        if (bulletinRecordData) {
            await supabase.from('trademark_bulletin_records').insert({
                bulletin_no: bulletinNo,
                bulletin_id: bulletinRecordData.bulletinId,
                mark_name: hitMarkName,
                application_no: bulletinRecordData.applicationNo,
                application_date: bulletinRecordData.applicationDate,
                image_path: bulletinRecordData.imagePath,
                nice_classes: Array.isArray(bulletinRecordData.niceClasses) ? bulletinRecordData.niceClasses.join(', ') : bulletinRecordData.niceClasses,
                holders: Array.isArray(bulletinRecordData.holders) ? bulletinRecordData.holders.join(', ') : bulletinRecordData.holders,
                source: 'similarity_search'
            });
        }

        return new Response(JSON.stringify({ success: true, taskId: taskId, message: "İtiraz işi başarıyla oluşturuldu." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("❌ İtiraz İşi Oluşturma Hatası:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }
});