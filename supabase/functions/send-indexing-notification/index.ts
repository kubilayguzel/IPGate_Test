// supabase/functions/send-indexing-notification/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apiKey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  console.log("🚀 Fonksiyon tetiklendi...");

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = await req.json();
    console.log("📦 Gelen Payload:", JSON.stringify(payload));
    
    const { recordId, childTypeId } = payload;

    // 1. IP Kaydını Çek
    console.log(`🔍 IP Kaydı aranıyor ID: ${recordId}`);
    const { data: record, error: recErr } = await supabaseClient
      .from('ip_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (recErr) {
      console.error("❌ ip_records Hatası:", recErr.message);
      throw new Error(`IP Kaydı çekilemedi: ${recErr.message}`);
    }
    console.log("✅ IP Kaydı Bulundu:", record.title);

    const currentCategory = (record.record_type || 'marka').toLowerCase();
    console.log(`📂 Kayıt Kategorisi: ${currentCategory}`);

    // 2. Şablon Kuralını Bul
    console.log(`📏 Şablon kuralı aranıyor. Tip: ${childTypeId}`);
    const { data: rule, error: ruleErr } = await supabaseClient
      .from('template_rules')
      .select('template_id')
      .eq('template_id', String(childTypeId))
      .eq('is_active', true)
      .maybeSingle();

    if (ruleErr) console.warn("⚠️ template_rules Sorgu Hatası:", ruleErr.message);
    
    const finalTemplateId = rule?.template_id || String(childTypeId);
    console.log(`📝 Seçilen Şablon ID: ${finalTemplateId}`);

    // 3. Şablonu Çek
    const { data: template, error: tmplErr } = await supabaseClient
      .from('mail_templates')
      .select('*')
      .eq('id', finalTemplateId)
      .single();

    if (tmplErr) {
      console.error("❌ mail_templates Hatası:", tmplErr.message);
      throw new Error(`Şablon bulunamadı: ${finalTemplateId}`);
    }
    console.log("✅ Şablon Çekildi:", template.subject);

    // 4. Alıcı Tespiti (Loglu Sorgular)
    console.log(`👥 Paydaşlar (Owners) aranıyor...`);
    const { data: owners, error: ownerErr } = await supabaseClient
      .from('ip_record_persons')
      .select('person_id')
      .eq('ip_record_id', recordId);

    if (ownerErr) console.error("❌ ip_record_persons Hatası:", ownerErr.message);
    
    const ownerIds = owners?.map(o => o.person_id) || [];
    console.log(`🆔 Bulunan Owner ID'leri: [${ownerIds.join(', ')}]`);

    let toList: string[] = [];
    let ccList: string[] = [];

    if (ownerIds.length > 0) {
      console.log(`🔗 persons_related üzerinden alıcılar sorgulanıyor...`);
      const { data: relatedPersons, error: relErr } = await supabaseClient
        .from('persons_related')
        .select(`
          related_person_id, 
          is_notification_recipient, 
          is_cc_recipient, 
          category
        `)
        .in('person_id', ownerIds);

      if (relErr) console.error("❌ persons_related Hatası:", relErr.message);

      if (relatedPersons && relatedPersons.length > 0) {
        console.log(`📊 Toplam ${relatedPersons.length} adet ilişki bulundu. Filtreleniyor...`);
        for (const rel of relatedPersons) {
          const relCategory = rel.category?.toLowerCase();
          if (relCategory === currentCategory || relCategory === 'all') {
            const { data: pData } = await supabaseClient.from('persons').select('email').eq('id', rel.related_person_id).single();
            if (pData?.email) {
              if (rel.is_notification_recipient) {
                console.log(`📬 Alıcı Eklendi: ${pData.email}`);
                toList.push(pData.email);
              }
              if (rel.is_cc_recipient) {
                console.log(`📧 CC Eklendi: ${pData.email}`);
                ccList.push(pData.email);
              }
            }
          }
        }
      } else {
        console.warn("⚠️ persons_related tablosunda eşleşme bulunamadı.");
      }
    }

    // Fallback
    if (toList.length === 0 && record.details?.contactEmail) {
      console.log(`🔄 Dinamik alıcı yok, kayıttaki mail kullanılıyor: ${record.details.contactEmail}`);
      toList.push(record.details.contactEmail);
    }

    // 5. Veritabanına Yazma Öncesi Hazırlık
    let finalBody = template.body || "";
    const replacements = {
      '{{markName}}': record.title || '-',
      '{{applicationNo}}': record.application_number || '-'
    };

    Object.entries(replacements).forEach(([key, value]) => {
      finalBody = finalBody.replace(new RegExp(key, 'g'), String(value));
    });

    console.log(`💾 mail_notifications tablosuna yazılıyor...`);
    const insertData = {
      ip_record_id: recordId,
      subject: template.subject,
      recipient: [...new Set(toList)].join(','),
      status: 'pending',
      details: {
        body: finalBody, // Body kolonu yoksa detaylara gömelim
        child_type_id: childTypeId,
        cc_list: [...new Set(ccList)]
      }
    };

    const { data: insData, error: insErr } = await supabaseClient
      .from('mail_notifications')
      .insert(insertData)
      .select();

    if (insErr) {
      console.error("❌ INSERT HATASI:", insErr.message, "Detay:", insErr.details);
      throw insErr;
    }

    console.log("✅ BİLDİRİM BAŞARIYLA OLUŞTURULDU ID:", insData[0]?.id);

    return new Response(JSON.stringify({ success: true, id: insData[0]?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error("🔴 KRİTİK HATA:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
})