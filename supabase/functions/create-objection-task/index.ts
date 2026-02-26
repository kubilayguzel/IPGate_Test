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
        const { monitoredMarkId, similarMark, similarMarkName, bulletinNo, callerEmail, bulletinRecordData } = body;

        if (!monitoredMarkId || !similarMark || !bulletinNo) throw new Error("Eksik parametre.");

        const cleanMonitoredId = String(monitoredMarkId).trim();

        // 1. İzlenen Markayı Çek
        const { data: monitoredDataArr, error: monErr } = await supabase.from('monitoring_trademarks').select('*').eq('id', cleanMonitoredId).limit(1);
        if (monErr || !monitoredDataArr || monitoredDataArr.length === 0) throw new Error(`İzlenen marka bulunamadı.`);
        const monitoredData = monitoredDataArr[0];

        // 🔥 2. KURAL: monitoring_trademarks ID'si = ip_records ID'sidir. Gidip doğrudan çekiyoruz!
        let ipRecord: any = {};
        const { data: ipDataArr } = await supabase.from('ip_records').select('*').eq('id', cleanMonitoredId).limit(1);
        if (ipDataArr && ipDataArr.length > 0) {
            ipRecord = ipDataArr[0];
        } else if (monitoredData.ip_record_id) {
            // İhtiyaten bir de eski ip_record_id kolonuna bakarız
            const { data: ipDataFallback } = await supabase.from('ip_records').select('*').eq('id', String(monitoredData.ip_record_id).trim()).limit(1);
            if (ipDataFallback && ipDataFallback.length > 0) ipRecord = ipDataFallback[0];
        }

        // 🔥 3. Gerçek Client ID'yi ip_records'dan bul (Sahte owner_ ID'leri eliyoruz)
        let clientId = ipRecord.client_id || null;
        if (!clientId && ipRecord.applicants) {
            let apps = ipRecord.applicants;
            if (typeof apps === 'string') { try { apps = JSON.parse(apps); } catch(e){} }
            if (Array.isArray(apps) && apps.length > 0 && apps[0].id) {
                clientId = apps[0].id;
            }
        }

        if (clientId && String(clientId).startsWith('owner_')) clientId = null; // Sahteyse null yap

        // 4. Persons tablosunda teyit et (409 Conflict önlemi)
        let clientInfo: any = {};
        if (clientId) {
            const { data: personDataArr } = await supabase.from('persons').select('*').eq('id', String(clientId).trim()).limit(1);
            if (personDataArr && personDataArr.length > 0) {
                clientInfo = personDataArr[0];
            } else {
                clientId = null; // Veritabanında yoksa sil ki hata verdirmesin
            }
        }

        let ipAppName = clientInfo.name || clientInfo.company_name || "-";
        if (ipAppName === "-" && ipRecord.applicants) {
            let applicants = ipRecord.applicants;
            if (typeof applicants === 'string') { try { applicants = JSON.parse(applicants); } catch(e){} }
            if (Array.isArray(applicants) && applicants.length > 0) ipAppName = applicants[0].name || "-";
        }

        const ipTitle = ipRecord.title || ipRecord.mark_name || monitoredData.mark_name || "-";
        const ipAppNo = ipRecord.application_number || monitoredData.application_no || "-";

        // 5. ATAMA KONTROLÜ
        let assignedUid = null;
        let assignedEmail = callerEmail || null;
        const { data: assignDataArr } = await supabase.from('task_assignments').select('assignee_ids').eq('task_type', '20').limit(1);
        if (assignDataArr && assignDataArr.length > 0 && assignDataArr[0].assignee_ids?.length > 0) {
            assignedUid = assignDataArr[0].assignee_ids[0];
            const { data: userDataArr } = await supabase.from('users').select('email').eq('id', assignedUid).limit(1);
            if (userDataArr && userDataArr.length > 0) assignedEmail = userDataArr[0].email;
        }

        // 6. TARİH HESAPLAMA
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

        // 7. GÖREV ID ALIMI (Counter)
        let taskId = crypto.randomUUID();
        const { data: nextId, error: rpcErr } = await supabase.rpc('get_next_task_id_from_counters');
        if (nextId) taskId = nextId;

        const hitMarkName = similarMarkName || similarMark.markName || 'Bilinmeyen Marka';
        
        // 🔥 8. EKSİK OLAN TRANSACTION KAYDI (İtiraz işi için portföy geçmişi)
        let createdTransactionId = null;
        if (ipRecord.id) {
            const txPayload = {
                ip_record_id: ipRecord.id,
                type: '20', // Yayına İtiraz Tipi
                designation: 'Yayına İtiraz',
                description: `Bülten benzerlik araması sonucu "${hitMarkName}" markasına itiraz oluşturuldu.`,
                transaction_hierarchy: 'parent',
                task_id: String(taskId),
                user_email: callerEmail || 'system@evreka.com',
                user_id: assignedUid,
                timestamp: new Date().toISOString()
            };
            const { data: txData, error: txError } = await supabase.from('transactions').insert(txPayload).select('id').single();
            if (txData) createdTransactionId = txData.id;
        }

        // 9. TASK KAYDI (Transaction ile bağlandı)
        const taskPayload = {
            id: taskId,
            task_type: '20',
            status: 'awaiting_client_approval',
            priority: 'medium',
            related_ip_record_id: ipRecord.id || null,
            related_ip_record_title: ipTitle,
            client_id: clientId,
            transaction_id: createdTransactionId, // İşlem ile bağla
            assigned_to_uid: assignedUid, 
            assigned_to_email: assignedEmail,
            created_by_email: callerEmail || 'system',
            title: `Yayına İtiraz: ${hitMarkName} (Bülten No: ${bulletinNo})`,
            description: `${ipTitle} markamız için bültende benzer bulunan "${hitMarkName}" markasına itiraz işi.`,
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

        // 10. BÜLTEN KAYDI
        if (bulletinRecordData) {
            await supabase.from('trademark_bulletin_records').insert({
                bulletin_no: bulletinNo,
                bulletin_id: bulletinRecordData.bulletinId,
                mark_name: hitMarkName,
                application_no: bulletinRecordData.applicationNo,
                application_date: bulletinRecordData.applicationDate,
                image_path: bulletinRecordData.imagePath,
                source: 'similarity_search'
            });
        }

        return new Response(JSON.stringify({ success: true, taskId: taskId, message: "İtiraz işi başarıyla oluşturuldu." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

    } catch (error: any) {
        console.error("❌ Edge Function Çöktü:", error.message);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }
});