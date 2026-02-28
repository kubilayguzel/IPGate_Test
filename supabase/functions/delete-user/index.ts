import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS kontrolü (Tarayıcıların önden gönderdiği OPTIONS isteğine yanıt)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. İstek gövdesinden silinecek kullanıcının ID'sini al
    const { userId } = await req.json()
    if (!userId) {
      throw new Error("Silinecek kullanıcı ID'si (userId) eksik.")
    }

    // 2. Supabase Admin İstemcisini (Service Role Key ile) oluştur. 
    // Bu anahtar her türlü yetkiye (bypass RLS) sahiptir, bu yüzden sadece Edge Function'da kullanılır.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 3. İsteği Yapan Kişinin (Adminin) Yetkisini Kontrol Et
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: requestingUser }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !requestingUser) {
      throw new Error("Yetkisiz erişim: Oturum bulunamadı.")
    }

    // İsteği yapan kişinin public.users tablosundaki rolüne bak (Superadmin mi?)
    const { data: adminProfile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', requestingUser.id)
      .single()

    if (!adminProfile || adminProfile.role !== 'superadmin') {
      throw new Error("Yetkisiz işlem: Bu işlemi sadece Süper Admin yapabilir.")
    }

    // 4. KULLANICIYI SİL (Supabase Auth üzerinden tamamen kaldırır)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    
    if (deleteError) {
      throw deleteError
    }

    // (Opsiyonel) Eğer public.users tablosunda CASCADE ayarı yoksa, public.users'dan da silelim
    await supabaseAdmin.from('users').delete().eq('id', userId)

    // Başarılı yanıt dön
    return new Response(
      JSON.stringify({ success: true, message: "Kullanıcı başarıyla silindi." }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})