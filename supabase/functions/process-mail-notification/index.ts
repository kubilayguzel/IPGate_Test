// supabase/functions/process-mail-notification/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from "npm:nodemailer" // 🔥 KRİTİK DEĞİŞİKLİK: esm.sh yerine npm: kullandık

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apiKey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { notificationId, mode } = await req.json();
    if (!notificationId) throw new Error("Bildirim ID'si eksik.");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: notification, error: fetchErr } = await supabaseClient
      .from('mail_notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (fetchErr || !notification) throw new Error("Bildirim bulunamadı.");

    const toList = notification.recipient ? notification.recipient.split(',').map((e:string) => e.trim()).filter(Boolean) : [];
    const ccList = notification.details?.cc_list || [];

    if (toList.length === 0) throw new Error("Kime (To) alanı boş olamaz.");

    let finalSubject = notification.subject || "";
    if (mode === 'reminder' && !finalSubject.includes('HATIRLATMA:')) {
        finalSubject = `HATIRLATMA: ${finalSubject}`;
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: Deno.env.get('SMTP_USER'),
        pass: Deno.env.get('SMTP_PASS'),
      },
    });

    console.log(`📤 Mail gönderiliyor... Alıcı: ${toList.join(',')}`);

    const info = await transporter.sendMail({
      from: '"Evreka Patent" <info@evrekagroup.com>',
      to: [...new Set(toList)].join(','),
      cc: [...new Set(ccList)].join(','),
      subject: finalSubject,
      html: notification.body,
    });

    console.log(`✅ Mail başarıyla iletildi! MessageID: ${info.messageId}`);

    const updatePayload: any = { 
        status: 'sent', 
        sent_at: new Date().toISOString()
    };

    if (mode === 'reminder') {
        updatePayload.details = { ...notification.details, lastReminderAt: new Date().toISOString() };
    }

    await supabaseClient
      .from('mail_notifications')
      .update(updatePayload)
      .eq('id', notificationId);

    return new Response(JSON.stringify({ success: true, messageId: info.messageId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error("❌ Gönderim Hatası:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});