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

    const { recordId, childTypeId, transactionId, tebligTarihi, sonItirazTarihi, pdfId, toList, ccList } = await req.json();

    if (!recordId) throw new Error("recordId eksik!");

    const { data: record, error: recError } = await supabaseAdmin
        .from('ip_records')
        .select('*, details:ip_record_trademark_details(brand_name, brand_image_url)')
        .eq('id', recordId)
        .single();

    if (recError || !record) throw new Error("IP Kaydı bulunamadı.");

    let brandName = '-';
    const detailsObj = Array.isArray(record.details) ? record.details[0] : record.details;
    if (detailsObj && detailsObj.brand_name) brandName = detailsObj.brand_name;
    else if (record.title) brandName = record.title;

    const brandImageUrl = (detailsObj && detailsObj.brand_image_url) ? detailsObj.brand_image_url : 'https://via.placeholder.com/150?text=Gorsel+Yok';

    let taskTypeName = String(childTypeId);
    const { data: ttData } = await supabaseAdmin.from('transaction_types').select('name, alias').eq('id', childTypeId).maybeSingle();
    if (ttData) taskTypeName = ttData.alias || ttData.name || taskTypeName;

    let targetTemplateId = `tmpl_${childTypeId}_document`;
    const { data: rule } = await supabaseAdmin.from('template_rules').select('template_id').eq('id', `rule_doc_index_${childTypeId}`).maybeSingle();
    if (rule && rule.template_id) targetTemplateId = rule.template_id;

    const { data: template } = await supabaseAdmin.from('mail_templates').select('*').eq('id', targetTemplateId).maybeSingle();
    
    let finalBody = template?.body || template?.body1 || `<p>Yeni evrak tebliğ edilmiştir. Evrak tipi: ${taskTypeName}</p>`;
    let finalSubject = template?.subject || template?.mail_subject || `Evreka IP: Yeni Evrak Bildirimi (${brandName})`;

    const formatDateTR = (dStr: string) => {
        if (!dStr) return '-';
        try { const d = new Date(dStr); return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('tr-TR'); } catch { return dStr; }
    };

    // 🔥 TARİH FORMATINI (DD.MM.YYYY) SUNUCU İÇİN (YYYY-MM-DD) ÇEVİRME
    let parsedObjectionDeadline = null;
    if (sonItirazTarihi && typeof sonItirazTarihi === 'string') {
        const parts = sonItirazTarihi.split(/[.\/]/);
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            const isoString = `${year}-${month}-${day}T12:00:00Z`;
            parsedObjectionDeadline = new Date(isoString).toISOString();
        } else {
            const d = new Date(sonItirazTarihi);
            if (!isNaN(d.getTime())) parsedObjectionDeadline = d.toISOString();
        }
    }

    const placeholders: Record<string, string> = { 
      '{{markName}}': brandName, 
      '{{applicationNo}}': record.application_number || '-',
      '{{clientName}}': "Sayın İlgili", 
      '{{date}}': new Date().toLocaleDateString('tr-TR'),
      '{{teblig_tarihi}}': formatDateTR(tebligTarihi),
      '{{son_itiraz_tarihi}}': formatDateTR(sonItirazTarihi),
      '{{transactionDate}}': formatDateTR(tebligTarihi),
      '{{objection_deadline}}': formatDateTR(sonItirazTarihi),
      '{{docType}}': taskTypeName,
      '{{markImageUrl}}': brandImageUrl
    };

    Object.entries(placeholders).forEach(([k, v]) => {
      finalBody = finalBody.replace(new RegExp(k, 'g'), String(v));
      finalSubject = finalSubject.replace(new RegExp(k, 'g'), String(v));
    });

    const uniqueTo = toList || [];
    const uniqueCc = ccList || [];

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
      objection_deadline: parsedObjectionDeadline, // 🔥 Düzeltilmiş format
      source: 'indexing_automation' 
    };

    const { error: insertError } = await supabaseAdmin.from('mail_notifications').insert(insertObject);
    if (insertError) throw new Error("Mail kaydı oluşturulamadı: " + insertError.message);

    return new Response(JSON.stringify({ success: true, toCount: uniqueTo.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error("🔥 Mail bildirim Edge Function hatası:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});