// supabase/functions/send-indexing-notification/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apiKey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { recordId, childTypeId, tebligTarihi, sonItirazTarihi, pdfId } = await req.json();

    // --- JSON PARSER (HAYAT KURTARAN DÜZELTME) ---
    const parseJson = (val: any) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
        return val || {};
    };
    const parseArr = (val: any) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
        return Array.isArray(val) ? val : [];
    };

    // 1. IP Kaydı
    const { data: record } = await supabaseClient.from('ip_records').select('*').eq('id', recordId).single();
    if (!record) throw new Error("IP Kaydı bulunamadı.");
    const recDetails = parseJson(record.details);
    const applicants = parseArr(record.applicants);
    const currentCategory = (record.record_type || record.recordType || 'marka').toLowerCase();

    // 2. Şablon Tespiti
    let targetTemplateId = `tmpl_${childTypeId}_document`;
    const { data: rule } = await supabaseClient.from('template_rules').select('*').eq('id', `rule_doc_index_${childTypeId}`).maybeSingle();
    if (rule) targetTemplateId = rule.template_id || rule.templateId || targetTemplateId;

    const { data: template } = await supabaseClient.from('mail_templates').select('*').eq('id', targetTemplateId).single();
    if (!template) throw new Error(`Şablon bulunamadı: ${targetTemplateId}`);
    const tmplDetails = parseJson(template.details);

    // 3. Alıcılar ve CC
    let ownerIds: string[] = [];
    const { data: ownerRels1 } = await supabaseClient.from('ip_record_persons').select('*').eq('ip_record_id', recordId);
    if (ownerRels1) ownerRels1.forEach((o:any) => { if (o.person_id) ownerIds.push(o.person_id) });

    applicants.forEach((a: any) => { if (a.id) ownerIds.push(a.id); else if (a.personId) ownerIds.push(a.personId); });

    let toList: string[] = [];
    let ccList: string[] = [];

    // Global CC'leri al (evreka_mail_settings tablosu)
    const { data: globalSettings } = await supabaseClient.from('evreka_mail_settings').select('*').eq('id', 'default').maybeSingle();
    if (globalSettings) {
        const gsDetails = parseJson(globalSettings.details);
        const defaultCcs = globalSettings.cc_emails || globalSettings.ccEmails || gsDetails.cc_emails || [];
        if (Array.isArray(defaultCcs)) ccList.push(...defaultCcs);
        else if (typeof defaultCcs === 'string') ccList.push(...defaultCcs.split(','));
    }

    if (ownerIds.length > 0) {
        const { data: rels } = await supabaseClient.from('persons_related').select('*').in('person_id', ownerIds);
        if (rels) {
            for (const rel of rels) {
                if ((rel.category || '').toLowerCase() === currentCategory || (rel.category || '').toLowerCase() === 'all') {
                    const rId = rel.related_person_id || rel.relatedPersonId;
                    if (rId) {
                        const { data: pData } = await supabaseClient.from('persons').select('*').eq('id', rId).maybeSingle();
                        if (pData) {
                            const pDetails = parseJson(pData.details);
                            const pEmail = pData.email || pData.contactEmail || pDetails.email;
                            if (pEmail) {
                                if (rel.is_notification_recipient) toList.push(pEmail);
                                if (rel.is_cc_recipient) ccList.push(pEmail);
                            }
                        }
                    }
                }
            }
        }
    }

    const fallbackEmail = record.contactEmail || recDetails.contactEmail || recDetails.clientEmail;
    if (toList.length === 0 && fallbackEmail) toList.push(fallbackEmail);

    // 4. Şablon Değişkenleri
    let finalBody = template.body || tmplDetails.body || "";
    let finalSubject = template.subject || tmplDetails.subject || "";

    const formatDateTR = (dStr: string) => {
        try { const d = new Date(dStr); return isNaN(d.getTime()) ? (dStr||'-') : d.toLocaleDateString('tr-TR'); } 
        catch { return dStr || '-'; }
    };

    const placeholders: Record<string, string> = { 
      '{{markName}}': record.title || record.markName || recDetails.markName || '-', 
      '{{applicationNo}}': record.application_number || record.applicationNumber || recDetails.applicationNo || '-',
      '{{clientName}}': record.applicantName || recDetails.clientName || recDetails.applicantName || 'Sayın İlgili',
      '{{bulletinNo}}': record.bulletinNo || recDetails.bulletinNo || '-',
      '{{date}}': new Date().toLocaleDateString('tr-TR'),
      '{{teblig_tarihi}}': formatDateTR(tebligTarihi),
      '{{son_itiraz_tarihi}}': formatDateTR(sonItirazTarihi),
      '{{transactionDate}}': formatDateTR(tebligTarihi),
      '{{objection_deadline}}': formatDateTR(sonItirazTarihi),
      '{{docType}}': 'Resmi Yazı',
      '{{markImageUrl}}': record.brandImageUrl || recDetails.brandImageUrl || 'https://via.placeholder.com/150?text=Gorsel+Yok'
    };

    Object.entries(placeholders).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(k, 'g'), String(v));
      finalSubject = finalSubject.replace(new RegExp(k, 'g'), String(v));
    });

    const uniqueTo = [...new Set(toList)];
    const uniqueCc = [...new Set(ccList)];

    // 5. Kayıt (Yeni düz kolon yapısına göre)
    const insertObject = {
      id: crypto.randomUUID(),
      ip_record_id: recordId,
      subject: finalSubject,
      body: finalBody,
      recipient: uniqueTo.join(','),
      cc_list: uniqueCc.join(','),
      source_document_id: pdfId,
      child_type_id: String(childTypeId),
      template_id: targetTemplateId,
      status: uniqueTo.length === 0 ? 'missing_info' : 'pending',
      created_at: new Date().toISOString(),
      missing_fields: uniqueTo.length === 0 ? ['recipients'] : [],
      details: { tebligTarihi, sonItirazTarihi } // Geriye dönük uyumluluk
    };

    await supabaseClient.from('mail_notifications').insert(insertObject);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});