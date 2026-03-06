import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const payload = await req.json();
    const { type, record, old_record } = payload;

    // Sadece UPDATE işlemlerini dinle
    if (type !== 'UPDATE' || !record || !old_record) {
      return new Response("İşlem UPDATE değil, atlandı.", { status: 200 });
    }

    // ==========================================
    // SENARYO TESPİTİ
    // ==========================================
    const becameCompleted = old_record.status !== 'completed' && record.status === 'completed';
    const wasAwaiting = ['awaiting_client_approval', 'awaiting-approval'].includes(old_record.status);
    const clientApproved = wasAwaiting && record.status === 'open';
    const clientClosed = wasAwaiting && ['client_approval_closed', 'client_no_response_closed'].includes(record.status);

    // Eğer ilgilendiğimiz 3 durumdan hiçbiri değilse çık
    if (!becameCompleted && !clientApproved && !clientClosed) {
        return new Response("Mail atılacak bir statü değişimi yok.", { status: 200 });
    }

    const taskTypeId = String(record.task_type_id || '');
    
    // Tahakkuk (53) ve Değerlendirme (66) işleri tamamlandığında mail ATILMAZ
    if (becameCompleted && ['53', '66'].includes(taskTypeId)) {
        return new Response(`TaskType ${taskTypeId} tamamlanma maili gerektirmez.`, { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ==========================================
    // ORTAK VERİLERİ (IP RECORD & MÜŞTERİ) ÇEK
    // ==========================================
    let ipRecordData: any = null;
    let applicants: any[] = [];
    if (record.ip_record_id) {
        const { data: ipData } = await supabaseAdmin.from('ip_records')
            .select(`*, ip_record_trademark_details(brand_name), ip_record_applicants(person_id, persons(name))`)
            .eq('id', record.ip_record_id)
            .single();
        
        if (ipData) {
            ipRecordData = ipData;
            applicants = ipData.ip_record_applicants || [];
        }
    }

    const brandName = ipRecordData?.ip_record_trademark_details?.[0]?.brand_name || record.details?.iprecordTitle || "-";
    const appNo = ipRecordData?.application_number || record.details?.iprecordApplicationNo || "-";

    // Alıcıları (Recipients) Belirleme Fonksiyonu
    async function getRecipients(personIds: string[], processType: string = 'trademark') {
        const to: string[] = [];
        const cc: string[] = [];
        if (!personIds || personIds.length === 0) return { to, cc };

        const { data: prData } = await supabaseAdmin.from('persons_related')
            .select('*')
            .in('person_id', personIds)
            .eq('resp_trademark', true);

        if (prData) {
            for (const pr of prData) {
                if (pr.email) {
                    if (pr.notify_trademark_to) to.push(pr.email);
                    if (pr.notify_trademark_cc) cc.push(pr.email);
                    if (!pr.notify_trademark_to && !pr.notify_trademark_cc) to.push(pr.email); 
                }
            }
        }
        return { 
            to: [...new Set(to)].filter(Boolean), 
            cc: [...new Set(cc)].filter(Boolean) 
        };
    }

    // =========================================================================
    // SENARYO 1: İŞ TAMAMLANDI
    // =========================================================================
    if (becameCompleted) {
        console.log(`✅ [Senaryo 1] Görev tamamlandı. Kapanış maili taslağı hazırlanıyor...`);

        let templateId = null;
        const { data: ruleData } = await supabaseAdmin.from('template_rules')
            .select('template_id')
            .eq('source_type', 'task_completion_epats')
            .eq('task_type', taskTypeId)
            .maybeSingle();
        
        if (ruleData) templateId = ruleData.template_id;

        let subject = "İşleminiz Tamamlandı";
        let body = "İlgili görev tamamlanmıştır.";
        let hasTemplate = false;

        if (templateId) {
            const { data: tmplData } = await supabaseAdmin.from('mail_templates').select('*').eq('id', templateId).maybeSingle();
            if (tmplData) {
                hasTemplate = true;
                subject = tmplData.mail_subject || tmplData.subject || subject;
                
                const recordOwnerType = ipRecordData?.record_owner_type || 'self';
                
                if (templateId === 'tmpl_50_document') {
                    if (recordOwnerType === 'third_party' && tmplData.body2) body = tmplData.body2;
                    else if (recordOwnerType === 'self' && tmplData.body1) body = tmplData.body1;
                    else body = tmplData.body || body;
                } else {
                    body = tmplData.body || body;
                }

                const params: any = {
                    "{{applicationNo}}": appNo,
                    "{{markName}}": brandName,
                    "{{is_basligi}}": record.title || "",
                    "{{relatedIpRecordTitle}}": brandName
                };
                
                for (const [k, v] of Object.entries(params)) {
                    subject = subject.replace(new RegExp(k, 'g'), String(v));
                    body = body.replace(new RegExp(k, 'g'), String(v));
                }
            }
        }

        const targetIds = record.task_owner_id ? [record.task_owner_id] : applicants.map(a => a.person_id);
        let { to, cc } = await getRecipients(targetIds);

        const missingFields = [];
        if (to.length === 0 && cc.length === 0) missingFields.push("recipients");
        if (!hasTemplate) missingFields.push("template");

        const status = missingFields.length > 0 ? "missing_info" : "awaiting_client_approval";

        const { data: insertedDoc, error: insertError } = await supabaseAdmin.from('mail_notifications').insert({
            id: crypto.randomUUID(),
            associated_task_id: record.id,
            related_ip_record_id: record.ip_record_id,
            to_list: to,
            cc_list: cc,
            subject: subject,
            body: body,
            status: status,
            missing_fields: missingFields,
            is_draft: true,
            mode: "draft",
            notification_type: "marka",
            template_id: templateId,
            source: "task_completion"
        }).select();

        if (insertError) console.error("❌ [Senaryo 1] Kayıt Hatası:", insertError.message);
        else console.log("🚀 [Senaryo 1] Kayıt Başarılı! ID:", insertedDoc?.[0]?.id);
    }

    // =========================================================================
    // SENARYO 2: MÜŞTERİ ONAYLADI (clientApproved)
    // =========================================================================
    if (clientApproved) {
        console.log(`📧 [Senaryo 2] Müvekkil onayladı. 'Talimatınız Alındı' maili hazırlanıyor...`);

        const { data: tmplData } = await supabaseAdmin.from('mail_templates')
            .select('*').eq('id', 'tmpl_clientInstruction_1').maybeSingle();
        
        let subject = tmplData?.subject || "{{relatedIpRecordTitle}} - Talimatınız Alındı";
        let body = tmplData?.body || "<p>Talimatınız alınmıştır, işlem başlatılıyor.</p>";

        subject = subject.replace(/{{relatedIpRecordTitle}}/g, brandName);
        body = body.replace(/{{relatedIpRecordTitle}}/g, brandName);

        const threadKey = `${record.ip_record_id}_${taskTypeId}`;
        const { data: threadData } = await supabaseAdmin.from('mail_threads').select('root_subject').eq('id', threadKey).maybeSingle();
        
        if (threadData && threadData.root_subject) {
            const innerSubjectHtml = `<div style="background-color: #f8f9fa; border-left: 4px solid #1a73e8; padding: 15px; margin: 0 0 20px 0; font-family: Arial, sans-serif; color: #333; font-size: 14px;"><strong style="color: #1a73e8;">KONU:</strong> ${subject}</div>`;
            subject = threadData.root_subject;
            if (body.toLowerCase().includes("<body")) {
                body = body.replace(/<body[^>]*>/i, (match) => match + innerSubjectHtml);
            } else {
                body = innerSubjectHtml + body;
            }
        }

        let targetIds = [];
        if (ipRecordData?.record_owner_type === 'third_party') {
            targetIds = [record.task_owner_id].filter(Boolean);
        } else {
            targetIds = applicants.map(a => a.person_id);
        }
        
        let { to, cc } = await getRecipients(targetIds);

        const missingFields = [];
        if (to.length === 0 && cc.length === 0) missingFields.push("recipients");

        const status = missingFields.length > 0 ? "missing_info" : "pending";

        const { data: insertedDoc, error: insertError } = await supabaseAdmin.from('mail_notifications').insert({
            id: crypto.randomUUID(),
            associated_task_id: record.id,
            related_ip_record_id: record.ip_record_id,
            to_list: to,
            cc_list: cc,
            subject: subject,
            body: body,
            status: status,
            missing_fields: missingFields,
            notification_type: "general_notification",
            source: "auto_instruction_response",
            is_draft: false 
        }).select();

        if (insertError) console.error("❌ [Senaryo 2] Kayıt Hatası:", insertError.message);
        else console.log("🚀 [Senaryo 2] Kayıt Başarılı! ID:", insertedDoc?.[0]?.id);
    }

    // =========================================================================
    // SENARYO 3: MÜŞTERİ REDDETTİ / DOSYA KAPANDI (clientClosed)
    // =========================================================================
    if (clientClosed) {
        console.log(`📧 [Senaryo 3] Dosya kapatıldı. 'Dosya Kapatıldı' maili hazırlanıyor...`);

        const { data: tmplData } = await supabaseAdmin.from('mail_templates')
            .select('*').eq('id', 'tmpl_clientInstruction_2').maybeSingle();
        
        let subject = tmplData?.subject || "{{relatedIpRecordTitle}} - Dosya Kapatıldı";
        let body = tmplData?.body || "<p>Talimatınız üzerine dosya kapatılmıştır.</p>";

        subject = subject.replace(/{{relatedIpRecordTitle}}/g, brandName);
        body = body.replace(/{{relatedIpRecordTitle}}/g, brandName);

        const threadKey = `${record.ip_record_id}_${taskTypeId}`;
        const { data: threadData } = await supabaseAdmin.from('mail_threads').select('root_subject').eq('id', threadKey).maybeSingle();
        
        if (threadData && threadData.root_subject) {
            const innerSubjectHtml = `<div style="background-color: #f8f9fa; border-left: 4px solid #1a73e8; padding: 15px; margin: 0 0 20px 0; font-family: Arial, sans-serif; color: #333; font-size: 14px;"><strong style="color: #1a73e8;">KONU:</strong> ${subject}</div>`;
            subject = threadData.root_subject;
            if (body.toLowerCase().includes("<body")) {
                body = body.replace(/<body[^>]*>/i, (match) => match + innerSubjectHtml);
            } else {
                body = innerSubjectHtml + body;
            }
        }

        let targetIds = [];
        if (ipRecordData?.record_owner_type === 'third_party') {
            targetIds = [record.task_owner_id].filter(Boolean);
        } else {
            targetIds = applicants.map(a => a.person_id);
        }
        
        let { to, cc } = await getRecipients(targetIds);

        const missingFields = [];
        if (to.length === 0 && cc.length === 0) missingFields.push("recipients");

        const status = missingFields.length > 0 ? "missing_info" : "pending";

        const { data: insertedDoc, error: insertError } = await supabaseAdmin.from('mail_notifications').insert({
            id: crypto.randomUUID(),
            associated_task_id: record.id,
            related_ip_record_id: record.ip_record_id,
            to_list: to,
            cc_list: cc,
            subject: subject,
            body: body,
            status: status,
            missing_fields: missingFields,
            notification_type: "general_notification",
            source: "auto_instruction_response",
            is_draft: false 
        }).select();

        if (insertError) console.error("❌ [Senaryo 3] Kayıt Hatası:", insertError.message);
        else console.log("🚀 [Senaryo 3] Kayıt Başarılı! ID:", insertedDoc?.[0]?.id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error("❌ Kritik Edge Function Hatası:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});