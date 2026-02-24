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

    // 1. IP Kaydını Çek
    const { data: record } = await supabaseClient.from('ip_records').select('*').eq('id', recordId).single();
    if (!record) throw new Error("IP Kaydı bulunamadı.");
    const currentCategory = (record.record_type || record.recordType || 'marka').toLowerCase();

    // 2. Şablonu Bul
    let targetTemplateId = `tmpl_${childTypeId}_document`;
    const expectedRuleId = `rule_doc_index_${childTypeId}`;
    const { data: rule } = await supabaseClient.from('template_rules').select('*').eq('id', expectedRuleId).maybeSingle();
    if (rule) targetTemplateId = rule.template_id || rule.templateId || targetTemplateId;

    const { data: template } = await supabaseClient.from('mail_templates').select('*').eq('id', targetTemplateId).single();
    if (!template) throw new Error(`Şablon bulunamadı: ${targetTemplateId}`);

    // 3. Alıcıları (To ve CC) Tespit Et
    let ownerIds: string[] = [];
    const { data: ownerRels1 } = await supabaseClient.from('ip_record_persons').select('person_id').eq('ip_record_id', recordId);
    if (ownerRels1) ownerRels1.forEach((o:any) => { if (o.person_id) ownerIds.push(o.person_id) });

    const { data: ownerRels2 } = await supabaseClient.from('ip_record_persons').select('personId').eq('ipRecordId', recordId);
    if (ownerRels2) ownerRels2.forEach((o:any) => { if (o.personId) ownerIds.push(o.personId) });

    if (Array.isArray(record.applicants)) {
        record.applicants.forEach((a: any) => { if (a.id) ownerIds.push(a.id); else if (a.personId) ownerIds.push(a.personId); });
    }

    let toList: string[] = [];
    let ccList: string[] = [];

    // Global CC'ler
    const { data: globalSettings } = await supabaseClient.from('evreka_cc_list').select('*').limit(1).maybeSingle();
    if (globalSettings) {
        const defaultCcs = globalSettings.cc_emails || globalSettings.ccEmails || globalSettings.emails || [];
        if (Array.isArray(defaultCcs)) ccList.push(...defaultCcs);
        else if (typeof defaultCcs === 'string') ccList.push(...defaultCcs.split(','));
    }

    // Müvekkil Bağlantıları
    if (ownerIds.length > 0) {
        const { data: rels } = await supabaseClient.from('persons_related').select('*').in('person_id', ownerIds);
        if (rels) {
            for (const rel of rels) {
                const relCat = (rel.category || '').toLowerCase();
                if (relCat === currentCategory || relCat === 'all') {
                    const rId = rel.related_person_id || rel.relatedPersonId;
                    if (rId) {
                        const { data: pData } = await supabaseClient.from('persons').select('*').eq('id', rId).maybeSingle();
                        if (pData) {
                            const pEmail = pData.email || pData.contactEmail || pData.contact_email;
                            if (pEmail) {
                                if (rel.is_notification_recipient || rel.isNotificationRecipient) toList.push(pEmail);
                                if (rel.is_cc_recipient || rel.isCcRecipient) ccList.push(pEmail);
                            }
                        }
                    }
                }
            }
        }
    }

    const fallbackEmail = record.contactEmail || record.contact_email || record.details?.contactEmail;
    if (toList.length === 0 && fallbackEmail) toList.push(fallbackEmail);

    // 4. Metin Değişkenleri
    const formatDateTR = (dateStr: string) => {
        if (!dateStr) return '-';
        try { const d = new Date(dateStr); return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('tr-TR'); } 
        catch { return dateStr; }
    };

    let finalBody = template.body || template.details?.body || "";
    let finalSubject = template.subject || template.details?.subject || "";

    const placeholders: Record<string, string> = { 
      '{{markName}}': record.title || record.markName || '-', 
      '{{applicationNo}}': record.application_number || record.applicationNumber || '-',
      '{{clientName}}': record.applicantName || 'Sayın İlgili',
      '{{bulletinNo}}': record.bulletinNo || record.bulletin_no || '-',
      '{{date}}': new Date().toLocaleDateString('tr-TR'),
      '{{teblig_tarihi}}': formatDateTR(tebligTarihi),
      '{{son_itiraz_tarihi}}': formatDateTR(sonItirazTarihi),
      '{{transactionDate}}': formatDateTR(tebligTarihi),
      '{{objection_deadline}}': formatDateTR(sonItirazTarihi),
      '{{docType}}': 'Resmi Yazı',
      '{{markImageUrl}}': record.brandImageUrl || record.brand_image_url || 'https://via.placeholder.com/150?text=Gorsel+Yok'
    };

    Object.entries(placeholders).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(k, 'g'), String(v));
      finalSubject = finalSubject.replace(new RegExp(k, 'g'), String(v));
    });

    const uniqueTo = [...new Set(toList)];
    const uniqueCc = [...new Set(ccList)];
    const isMissing = uniqueTo.length === 0;

    // 🔥 DÜZELTME: SQL yorum satırları (--) kaldırılıp JS yorum satırlarına (//) çevrildi
    const insertObject = {
      id: crypto.randomUUID(),
      ip_record_id: recordId,
      subject: finalSubject,
      body: finalBody,
      recipient: uniqueTo.join(','),        // Kime (Virgüllü string)
      cc_list: uniqueCc.join(','),          // Yeni eklediğimiz düz kolon
      source_document_id: pdfId,            // Yeni eklediğimiz düz kolon
      child_type_id: String(childTypeId),   // Yeni eklediğimiz düz kolon
      template_id: targetTemplateId,        // Yeni eklediğimiz düz kolon
      status: isMissing ? 'missing_info' : 'pending',
      created_at: new Date().toISOString(),
      missing_fields: isMissing ? ['recipients'] : [] // Array kolon
    };

    const { error: insErr } = await supabaseClient.from('mail_notifications').insert(insertObject);
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error: any) {
    console.error("🔴 HATA:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});