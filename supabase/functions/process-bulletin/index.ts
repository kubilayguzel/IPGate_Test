// supabase/functions/process-bulletin/index.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { filePath } = await req.json();
    if (!filePath) throw new Error("filePath parametresi eksik.");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`📥 ZIP indiriliyor: ${filePath}`);
    
    // 1. ZIP Dosyasını Storage'dan İndir
    const { data: fileData, error: downloadError } = await supabase.storage.from('bulletins').download(filePath);
    if (downloadError) throw downloadError;

    const zipBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(zipBuffer);

    let bulletinNo = "Unknown";
    let bulletinDate = "Unknown";
    let sqlContent = "";
    const imageFiles: { name: string, data: Uint8Array }[] = [];

    // 2. ZIP İçeriğini Oku
    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      
      const lowerName = filename.toLowerCase();
      
      if (lowerName.includes("bulletin.inf") || lowerName.includes("bulletin")) {
         const content = await zipEntry.async("string");
         bulletinNo = (content.match(/NO\s*=\s*(.*)/) || [])[1]?.trim() || "Unknown";
         bulletinDate = (content.match(/DATE\s*=\s*(.*)/) || [])[1]?.trim() || "Unknown";
      } 
      else if (lowerName.includes("tmbulletin.log")) {
         sqlContent = await zipEntry.async("string");
      }
      else if (lowerName.includes("images/")) {
         const imgData = await zipEntry.async("uint8array");
         imageFiles.push({ name: filename.split('/').pop() || filename, data: imgData });
      }
    }

    if (!sqlContent) throw new Error("tmbulletin.log dosyası ZIP içinde bulunamadı.");

    console.log(`📋 Bülten Bilgisi: No: ${bulletinNo}, Tarih: ${bulletinDate}, Görsel Sayısı: ${imageFiles.length}`);

    // 3. Ana Bülten Kaydını Tabloya Ekle
    const { data: bulletinRow, error: bulletinInsertErr } = await supabase.from('trademark_bulletins').insert({
        bulletin_no: bulletinNo,
        bulletin_date: bulletinDate
    }).select().single();
    
    if (bulletinInsertErr) throw bulletinInsertErr;

    // 4. Görselleri Storage'a Yükle (trademarks bucket'ına)
    console.log("🖼️ Görseller yükleniyor...");
    const imagePathMap: Record<string, string> = {};
    
    for (const img of imageFiles) {
        const destPath = `bulletins/trademark_${bulletinNo}_images/${img.name}`;
        await supabase.storage.from('brand_images').upload(destPath, img.data, {
            contentType: img.name.endsWith('.png') ? 'image/png' : 'image/jpeg',
            upsert: true
        });
        
        // 2025_032492.jpg formatından başvuru no'yu bul (2025/032492)
        const match = img.name.match(/^(\d{4})[_\-]?(\d{5,})/);
        if (match) {
            const appNo = `${match[1]}/${match[2]}`;
            imagePathMap[appNo] = destPath;
        }
    }

    // 5. SQL Parser ve DB Kaydı
    console.log("💾 Veriler parse edilip veritabanına yazılıyor...");
    const recordsMap: Record<string, any> = {};
    const lines = sqlContent.split('\n');

    for (const line of lines) {
        if (!line.trim().startsWith('INSERT INTO')) continue;
        const match = line.match(/INSERT INTO (\w+) VALUES\s*\((.*)\)/i);
        if (!match) continue;

        const table = match[1].toUpperCase();
        // Basit split ile SQL değerlerini ayırma
        const rawValues = match[2].split("','").map(v => v.replace(/^'|'$/g, '').trim());
        if (rawValues.length === 0) continue;

        const appNo = rawValues[0];
        if (!recordsMap[appNo]) recordsMap[appNo] = { application_no: appNo, bulletin_no: bulletinNo, holders: '' };

        if (table === "TRADEMARK") {
            recordsMap[appNo].application_date = rawValues[1];
            recordsMap[appNo].mark_name = rawValues[4] || rawValues[5];
            recordsMap[appNo].nice_classes = rawValues[6];
        } else if (table === "HOLDER") {
            const holderName = rawValues[2];
            recordsMap[appNo].holders = recordsMap[appNo].holders ? `${recordsMap[appNo].holders}, ${holderName}` : holderName;
        }
    }

    // Objeyi diziye çevirip image_path'leri eşleştir
    const finalRecords = Object.values(recordsMap).map((r: any) => ({
        ...r,
        image_path: imagePathMap[r.application_no] || null
    })).filter(r => r.mark_name); // Marka adı olmayanları atla

    // Supabase'e Toplu Yazım (1000'er 1000'er)
    for (let i = 0; i < finalRecords.length; i += 1000) {
        const chunk = finalRecords.slice(i, i + 1000);
        await supabase.from('trademark_bulletin_records').insert(chunk);
    }

    console.log(`✅ İşlem tamamlandı! Toplam ${finalRecords.length} marka işlendi.`);

    return new Response(JSON.stringify({ success: true, message: "Bülten başarıyla işlendi", records: finalRecords.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("Hata:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});