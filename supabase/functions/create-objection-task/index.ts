import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isWeekend(date: Date) { return date.getDay() === 0 || date.getDay() === 6; }

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; 
        const supabase = createClient(supabaseUrl, supabaseKey);

        const body = await req.json();
        const { monitoredMarkId, thirdPartyIpRecordId, similarMark, similarMarkName, bulletinNo, callerEmail, bulletinRecordData } = body;

        if (!monitoredMarkId || !similarMark || !bulletinNo) throw new Error("Eksik parametre.");

        const cleanMonitoredId = String(monitoredMarkId).trim();

        // 1. İzlenen Markayı Çek
        const { data: monitoredDataArr } = await supabase.from('monitoring_trademarks').select('*').eq('id', cleanMonitoredId).limit(1);
        const monitoredData = monitoredDataArr?.[0] || {};

        let ipRecord: any = {};
        const { data: ipDataArr } = await supabase.from('ip_records').select('*').eq('id', cleanMonitoredId).limit(1);
        if (ipDataArr && ipDataArr.length > 0) ipRecord = ipDataArr[0];

        // 2. Kendi Müvekkilimizi (Client) Bul
        let clientId = ipRecord.client_id || null;
        if (clientId && String(clientId).startsWith('owner_')) clientId = null;

        let ipAppName = "-";
        if (clientId) {
            const { data: personDataArr } = await supabase.from('persons').select('name, company_name').eq('id', clientId).limit(1);
            if (personDataArr && personDataArr.length > 0) {
                ipAppName = personDataArr[0].name || personDataArr[0].company_name || "-";
            }
        }

        const ipTitle = ipRecord.title || ipRecord.mark_name || monitoredData.mark_name || "-";
        const ipAppNo = ipRecord.application_number || monitoredData.application_no || "-";

        // 3. ATAMA KONTROLÜ (Tip 20 Ataması)
        let assignedUid = null;
        let assignedEmail = callerEmail || null;
        const { data: assignDataArr } = await supabase.from('task_assignments').select('assignee_ids').eq('task_type', '20').limit(1);
        if (assignDataArr && assignDataArr.length > 0 && assignDataArr[0].assignee_ids?.length > 0) {
            assignedUid = assignDataArr[0].assignee_ids[0];
            const { data: userDataArr } = await supabase.from('users').select('email').eq('id', assignedUid).limit(1);
            if (userDataArr && userDataArr.length > 0) assignedEmail = userDataArr[0].email;
        }

        // 4. TARİH HESAPLAMA
        let officialDueDate = null;
        const { data: bulletinDataArr } = await supabase.from('trademark_bulletins').select('bulletin_date').eq('bulletin_no', String(bulletinNo).trim()).limit(1);
        if (bulletinDataArr && bulletinDataArr.length > 0 && bulletinDataArr[0].bulletin_date) {
            const bDate = new Date(bulletinDataArr[0].bulletin_date);
            if (!isNaN(bDate.getTime())) {
                const rawDue = new Date(bDate);
                rawDue.setMonth(rawDue.getMonth() + 2);
                let iter = 0;
                while (isWeekend(rawDue) && iter < 10) { rawDue.setDate(rawDue.getDate() + 1); iter++; }
                officialDueDate = rawDue.toISOString();
            }
        }

        // 🔥 5. GÖREV ID ALIMI (RPC OLMADAN, DOĞRUDAN SAYAÇ OKUMA/YAZMA)
        let taskId = crypto.randomUUID(); 
        try {
            const { data: counterData } = await supabase.from('counters').select('count').eq('id', 'tasks').maybeSingle();
            
            let nextCount = 1000; // Varsayılan başlangıç
            if (counterData && typeof counterData.count === 'number') {
                nextCount = counterData.count + 1;
                await supabase.from('counters').update({ count: nextCount }).eq('id', 'tasks');
            } else {
                await supabase.from('counters').insert({ id: 'tasks', count: nextCount });
            }
            taskId = String(nextCount); // Örn: "1054"
        } catch (e) {
            console.error("Sayaç okuma hatası:", e);
        }

        const hitMarkName = similarMarkName || similarMark.markName || 'Bilinmeyen Marka';
        
        // 🔥 6. RAKİP MARKAYA (THIRD PARTY) TRANSACTION EKLENMESİ
        let createdTransactionId = null;
        if (thirdPartyIpRecordId) {
            const txPayload = {
                ip_record_id: thirdPartyIpRecordId, // Rakibin portföy kaydı
                type: '20', // Yayına İtiraz
                designation: 'Yayına İtiraz',
                description: 'Yayına İtiraz',
                transaction_hierarchy: 'parent',
                task_id: taskId,
                opposition_owner: ipAppName, // Bizim müvekkilimizin adı
                user_email: callerEmail || 'system@evreka.com',
                user_id: assignedUid,
                timestamp: new Date().toISOString()
            };
            const { data: txData } = await supabase.from('transactions').insert(txPayload).select('id').single();
            if (txData) createdTransactionId = txData.id;
        }

        // 7. TASK KAYDI
        const taskPayload = {
            id: taskId,
            task_type: '20',
            status: 'awaiting_client_approval',
            priority: 'medium',
            related_ip_record_id: ipRecord.id || null, 
            related_ip_record_title: ipTitle,
            client_id: clientId,
            transaction_id: createdTransactionId, // Rakip işlemle bağlandı
            assigned_to_uid: assignedUid, 
            assigned_to_email: assignedEmail,
            created_by_email: callerEmail || 'system',
            title: `Yayına İtiraz: ${hitMarkName} (Bülten No: ${bulletinNo})`,
            description: `"${ipTitle}" markamız için bültende benzer bulunan "${hitMarkName}" markasına itiraz işi.`,
            iprecord_application_no: ipAppNo,
            iprecord_title: ipTitle,
            iprecord_applicant_name: ipAppName,
            due_date: officialDueDate,
            official_due_date: officialDueDate,
            target_app_no: similarMark.applicationNo || null,
            target_nice_classes: Array.isArray(similarMark.niceClasses) ? similarMark.niceClasses : [],
            bulletin_no: String(bulletinNo),
            similarity_score: similarMark.similarityScore || 0,
            related_party_id: clientId,
            related_party_name: ipAppName
        };

        const { error: taskErr } = await supabase.from('tasks').insert(taskPayload);
        if (taskErr) throw new Error(`Task kayıt hatası: ${taskErr.message}`);

        return new Response(JSON.stringify({ success: true, taskId: taskId, message: "İtiraz işi başarıyla oluşturuldu." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }
});