// supabase/functions/send-indexing-notification/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { recordId, childTypeId, transactionId, tebligTarihi, sonItirazTarihi, pdfId } = await req.json();

    if (!recordId) throw new Error("recordId eksik!");

    const { data: record, error: recError } = await supabaseAdmin
        .from('ip_records')
        .select(`
            *,
            details:ip_record_trademark_details(brand_name, brand_image_url),
            applicants:ip_record_applicants(persons(id, name, email))
        `)
        .eq('id', recordId)
        .single();

    if (recError || !record) throw new Error("IP Kaydı bulunamadı: " + (recError?.message || ''));

    const ipType = (record.ip_type || 'trademark').toLowerCase();
    
    // 🔥 ÇÖZÜM 1: Marka Adı (Subject'teki "-" sorunu)
    let brandName = '-';
    if (record.details && record.details.length > 0 && record.details[0].brand_name) {
        brandName = record.details[0].brand_name;
    } else if (record.title) {
        brandName = record.title;
    }

    const brandImageUrl = (record.details && record.details.length > 0 && record.details[0].brand_image_url) 
                          ? record.details[0].brand_image_url : 'https://via.placeholder.com/150?text=Gorsel+Yok';
    
    // 🔥 ÇÖZÜM 4: Müvekkil İz Sürme Mantığı
    let clientName = 'Sayın İlgili';
    let fallbackEmail = null;
    let ownerIds: string[] = [];

    // SENARYO A: Kendi Markamız (Self) -> Başvuru sahiplerini al
    if (record.record_owner_type === 'self' && record.applicants && record.applicants.length > 0) {
        const firstApp = record.applicants[0].persons;
        if (firstApp) {
            clientName = firstApp.name || clientName;
            fallbackEmail = firstApp.email;
        }
        record.applicants.forEach((app: any) => {
            if (app.persons && app.persons.id) ownerIds.push(app.persons.id);
        });
    } 
    // SENARYO B: Rakip Marka (Third Party) -> Transaction üzerinden Task Owner'a (Müvekkile) ulaş
    else if (transactionId) {
        const { data: txData } = await supabaseAdmin.from('transactions').select('task_id, parent_id').eq('id', transactionId).single();
        let targetTaskId = txData?.task_id;
        
        if (!targetTaskId && txData?.parent_id) {
            const { data: pTx } = await supabaseAdmin.from('transactions').select('task_id').eq('id', txData.parent_id).single();
            targetTaskId = pTx?.task_id;
        }

        if (targetTaskId) {
            const { data: taskData } = await supabaseAdmin.from('tasks').select('task_owner_id, details').eq('id', targetTaskId).single();
            if (taskData?.task_owner_id) {
                const { data: cData } = await supabaseAdmin.from('persons').select('id, name, email').eq('id', taskData.task_owner_id).single();
                if (cData) {
                    clientName = cData.name || clientName;
                    fallbackEmail = cData.email;
                    ownerIds.push(cData.id);
                }
            } else if (taskData?.details?.related_party_name) {
                clientName = taskData.details.related_party_name;
            }
        }
    }

    // İşlem Türü İsmini Bul
    let taskTypeName = String(childTypeId);
    const { data: ttData } = await supabaseAdmin.from('transaction_types').select('name, alias').eq('id', childTypeId).maybeSingle();
    if (ttData) {
        taskTypeName = ttData.alias || ttData.name || taskTypeName;
    }

    let targetTemplateId = `tmpl_${childTypeId}_document`;
    const { data: rule } = await supabaseAdmin.from('template_rules').select('*').eq('id', `rule_doc_index_${childTypeId}`).maybeSingle();
    if (rule && rule.template_id) targetTemplateId = rule.template_id;

    const { data: template } = await supabaseAdmin.from('mail_templates').select('*').eq('id', targetTemplateId).maybeSingle();
    
    let finalBody = template?.body || template?.body1 || `<p>Yeni evrak tebliğ edilmiştir. Evrak tipi: ${taskTypeName}</p>`;
    let finalSubject = template?.subject || template?.mail_subject || `Evreka IP: Yeni Evrak Bildirimi (${record.application_number || ''})`;

    let toList: string[] = [];
    let ccList: string[] = [];

    if (ownerIds.length > 0) {
        const { data: rels } = await supabaseAdmin.from('persons_related').select('*').in('person_id', ownerIds);
        
        if (rels && rels.length > 0) {
            rels.forEach((rel: any) => {
                const email = (rel.email || '').trim().toLowerCase();
                if (!email) return;

                let isResponsible = false, notifyTo = false, notifyCc = false;

                if (ipType === 'trademark') {
                    isResponsible = rel.resp_trademark;
                    notifyTo = rel.notify_trademark_to;
                    notifyCc = rel.notify_trademark_cc;
                } else if (ipType === 'patent') {
                    isResponsible = rel.resp_patent;
                    notifyTo = rel.notify_patent_to;
                    notifyCc = rel.notify_patent_cc;
                } else if (ipType === 'design') {
                    isResponsible = rel.resp_design;
                    notifyTo = rel.notify_design_to;
                    notifyCc = rel.notify_design_cc;
                }

                if (isResponsible) {
                    if (notifyTo) toList.push(email);
                    if (notifyCc) ccList.push(email);
                }
            });
        }
    }

    if (toList.length === 0 && fallbackEmail) {
        toList.push(fallbackEmail);
    }

    const { data: globalCcs } = await supabaseAdmin.from('evreka_mail_cc_list').select('email, transaction_types');
    if (globalCcs && globalCcs.length > 0) {
        globalCcs.forEach((ccRow: any) => {
            if (ccRow.email) {
                const types = ccRow.transaction_types || [];
                if (types.includes('All') || types.includes(String(childTypeId)) || types.includes(Number(childTypeId))) {
                    ccList.push(ccRow.email.trim().toLowerCase());
                }
            }
        });
    }

    const uniqueTo = [...new Set(toList)].filter(Boolean);
    let uniqueCc = [...new Set(ccList)].filter(Boolean);
    uniqueCc = uniqueCc.filter(e => !uniqueTo.includes(e)); 

    const formatDateTR = (dStr: string) => {
        if (!dStr) return '-';
        try { const d = new Date(dStr); return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('tr-TR'); } 
        catch { return dStr; }
    };

    const placeholders: Record<string, string> = { 
      '{{markName}}': brandName, 
      '{{applicationNo}}': record.application_number || '-',
      '{{clientName}}': clientName,
      '{{date}}': new Date().toLocaleDateString('tr-TR'),
      '{{teblig_tarihi}}': formatDateTR(tebligTarihi),
      '{{son_itiraz_tarihi}}': formatDateTR(sonItirazTarihi),
      '{{transactionDate}}': formatDateTR(tebligTarihi),
      '{{objection_deadline}}': formatDateTR(sonItirazTarihi),
      '{{docType}}': taskTypeName, // 🔥 ÇÖZÜM 2: İşlem ismi şablona gönderiliyor
      '{{markImageUrl}}': brandImageUrl
    };

    Object.entries(placeholders).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(k, 'g'), String(v));
      finalSubject = finalSubject.replace(new RegExp(k, 'g'), String(v));
    });

    const insertObject = {
      id: crypto.randomUUID(),
      related_ip_record_id: recordId,
      subject: finalSubject,
      body: finalBody,
      to_list: uniqueTo,  
      cc_list: uniqueCc,  
      source_document_id: pdfId,
      associated_transaction_id: transactionId || null, 
      template_id: targetTemplateId,
      status: uniqueTo.length === 0 ? 'missing_info' : 'pending',
      is_draft: uniqueTo.length === 0, 
      created_at: new Date().toISOString(),
      missing_fields: uniqueTo.length === 0 ? ['to_list'] : [],
      objection_deadline: sonItirazTarihi || null,
      source: 'indexing_automation' 
    };

    const { error: insertError } = await supabaseAdmin.from('mail_notifications').insert(insertObject);
    
    if (insertError) {
        throw new Error("Mail kaydı oluşturulamadı: " + insertError.message);
    }

    return new Response(JSON.stringify({ 
        success: true, 
        message: "Mail başarıyla kuyruğa alındı.",
        toCount: uniqueTo.length, 
        ccCount: uniqueCc.length 
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error("🔥 Mail bildirim Edge Function hatası:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});