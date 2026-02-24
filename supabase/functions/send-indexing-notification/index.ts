// supabase/functions/send-indexing-notification/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apiKey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  console.log("🚀 BİLDİRİM TASLAĞI OLUŞTURMA İŞLEMİ BAŞLATILDI");

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Parametreleri Al
    const { recordId, childTypeId } = await req.json();
    console.log(`📦 Gelen Veri -> Kayıt ID: ${recordId}, İşlem Tipi ID: ${childTypeId}`);

    // 2. IP Kaydını Çek
    const { data: record, error: recErr } = await supabaseClient.from('ip_records').select('*').eq('id', recordId).single();
    if (recErr || !record) throw new Error("IP Kaydı bulunamadı.");
    const currentCategory = (record.record_type || 'marka').toLowerCase();

    // 3. Şablon Kuralını Bul (CSV Dosyanızdaki Yapıya Göre Uyarlandı)
    // Örn: childTypeId 43 ise -> rule_doc_index_43 olarak aranır
    const expectedRuleId = `rule_doc_index_${childTypeId}`;
    console.log(`🔍 Kural aranıyor: ${expectedRuleId}`);

    const { data: rule } = await supabaseClient
      .from('template_rules')
      .select('template_id')
      .eq('id', expectedRuleId)
      .eq('is_active', true)
      .maybeSingle();

    // Eğer kural eşleşmezse doğrudan şablon adını tahmin et (Fallback)
    const targetTemplateId = rule?.template_id || `tmpl_${childTypeId}_document`;
    console.log(`📌 Eşleşen Şablon ID: ${targetTemplateId}`);

    // 4. Şablonu Çek
    const { data: template, error: tmplErr } = await supabaseClient
      .from('mail_templates')
      .select('*')
      .eq('id', targetTemplateId)
      .single();

    if (tmplErr || !template) throw new Error(`Şablon bulunamadı: ${targetTemplateId}`);

    // 5. Dinamik Alıcı Tespiti
    const { data: owners } = await supabaseClient.from('ip_record_persons').select('person_id').eq('ip_record_id', recordId);
    const ownerIds = owners?.map(o => o.person_id) || [];
    
    let toList: string[] = [];
    let ccList: string[] = [];

    const { data: globalSettings } = await supabaseClient.from('evreka_mail_settings').select('cc_emails').eq('id', 'default').single();
    if (globalSettings?.cc_emails) ccList = [...globalSettings.cc_emails];

    if (ownerIds.length > 0) {
      const { data: related } = await supabaseClient
        .from('persons_related')
        .select('related_person_id, category, is_notification_recipient, is_cc_recipient')
        .in('person_id', ownerIds);

      if (related) {
        for (const rel of related) {
          const relCat = rel.category?.toLowerCase();
          if (relCat === currentCategory || relCat === 'all') {
            const { data: pData } = await supabaseClient.from('persons').select('email').eq('id', rel.related_person_id).single();
            if (pData?.email) {
              if (rel.is_notification_recipient) toList.push(pData.email);
              if (rel.is_cc_recipient) ccList.push(pData.email);
            }
          }
        }
      }
    }

    // Alıcı yoksa fallback (Kayıttaki mail adresi)
    if (toList.length === 0 && record.details?.contactEmail) {
      toList.push(record.details.contactEmail);
    }
    const recipientStr = [...new Set(toList)].join(',');

    // 6. İçerik Hazırlama (Placeholder Değişimi)
    let finalBody = template.body || "";
    let finalSubject = template.subject || "";
    
    const placeholders: Record<string, string> = { 
      '{{markName}}': record.title || '-', 
      '{{applicationNo}}': record.application_number || '-',
      '{{clientName}}': record.details?.clientName || record.details?.applicantName || 'Sayın Müvekkilimiz',
      '{{bulletinNo}}': record.details?.bulletinNo || '-',
      '{{date}}': new Date().toLocaleDateString('tr-TR')
    };

    Object.entries(placeholders).forEach(([k, v]) => {
      const regex = new RegExp(k, 'g');
      finalBody = finalBody.replace(regex, v);
      finalSubject = finalSubject.replace(regex, v);
    });

    // 7. TASLAK OLUŞTURMA (mail_notifications'a Insert)
    const insertObject = {
      id: crypto.randomUUID(), // 🔥 KRİTİK GÜNCELLEME: ID boş hatasını önler
      ip_record_id: recordId,
      subject: finalSubject,
      body: finalBody,
      recipient: recipientStr,
      status: 'pending',
      created_at: new Date().toISOString(),
      details: { 
        child_type_id: childTypeId, 
        cc_list: [...new Set(ccList)],
        template_id: targetTemplateId,
        source: 'supabase_indexing' 
      }
    };

    const { data: finalData, error: insErr } = await supabaseClient
      .from('mail_notifications')
      .insert(insertObject)
      .select();

    if (insErr) {
      console.error("❌ INSERT HATASI:", insErr.message);
      throw insErr;
    }

    console.log("✅ BİLDİRİM TASLAĞI BAŞARIYLA OLUŞTURULDU ID:", finalData[0].id);

    return new Response(JSON.stringify({ success: true, id: finalData[0].id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error("🔴 HATA:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});