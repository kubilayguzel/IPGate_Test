// public/js/bulletin-upload.js
import { supabase } from '../supabase-config.js';

document.addEventListener('DOMContentLoaded', () => {
  setupUploadEvents();
});

function setupUploadEvents() {
  const dropArea = document.getElementById("dropAreaTrademark");
  const fileInput = document.getElementById("bulletinFileTrademark");
  const form = document.getElementById("bulletinUploadFormTrademark");
  const selectedFileName = document.getElementById("selectedFileNameTrademark");
  const uploadStatus = document.getElementById("uploadStatusTrademark");
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");

  let selectedFile = null;

  if (!dropArea || !fileInput || !form) return;

  dropArea.addEventListener("click", () => fileInput.click());
  dropArea.addEventListener("dragover", (e) => { e.preventDefault(); dropArea.style.border = "2px dashed #1e3c72"; });
  dropArea.addEventListener("dragleave", () => { dropArea.style.border = "2px dashed #ccc"; });
  
  dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.style.border = "2px dashed #ccc";
    if (e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) handleFileSelection(e.target.files[0]);
  });

  function handleFileSelection(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      if (uploadStatus) { uploadStatus.textContent = "⚠️ Sadece .zip dosyaları kabul edilir!"; uploadStatus.style.color = "orange"; }
      selectedFile = null;
      return;
    }
    selectedFile = file;
    if (uploadStatus) { uploadStatus.textContent = "✅ Dosya seçildi: " + selectedFile.name; uploadStatus.style.color = "green"; }
    if (selectedFileName) selectedFileName.textContent = selectedFile.name;
  }

  function updateProgress(percent, text, color = "#1e3c72") {
    if(progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;
        progressBar.style.background = color;
    }
    if(uploadStatus) {
        uploadStatus.textContent = text;
        uploadStatus.style.color = color === "crimson" ? "red" : "#333";
    }
  }

  // --- SQL Parse Yardımcıları ---
  function formatDateForSupabase(dateStr) {
      if (!dateStr) return null;
      const s = String(dateStr).trim();
      const match = s.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
      if (match) {
          return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      }
      return s; 
  }

  function parseValuesFromRaw(raw) {
      const values = [];
      let current = "";
      let inString = false;
      let i = 0;
      while (i < raw.length) {
          const char = raw[i];
          if (char === "'") {
              if (inString && raw[i + 1] === "'") { current += "'"; i += 2; continue; }
              else { inString = !inString; }
          } else if (char === "," && !inString) {
              values.push(decodeValue(current.trim())); current = ""; i++; continue;
          } else { current += char; }
          i++;
      }
      if (current.trim()) values.push(decodeValue(current.trim()));
      return values;
  }

  function decodeValue(str) {
      if (!str || str === "") return null;
      str = str.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
      return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, g1) => String.fromCharCode(parseInt(g1, 16)));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) return uploadStatus && (uploadStatus.textContent = "Lütfen bir dosya seçin.");
    
    try {
      if (progressContainer) progressContainer.style.display = "block";
      updateProgress(0, "ZIP dosyası tarayıcıda açılıyor...");

      const zip = await JSZip.loadAsync(selectedFile);
      
      let bulletinNo = "Unknown";
      let bulletinDate = "Unknown";
      let sqlContent = "";
      const imageFiles = [];

      updateProgress(5, "Dosyalar taranıyor...");

      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const lowerName = filename.toLowerCase();
        
        if (lowerName.includes("bulletin.inf") || lowerName.includes("bulletin.txt")) {
            const content = await zipEntry.async("string");
            const bNoMatch = content.match(/NO\s*=\s*(.*)/);
            const bDateMatch = content.match(/DATE\s*=\s*(.*)/);
            if (bNoMatch) bulletinNo = bNoMatch[1].trim();
            if (bDateMatch) bulletinDate = bDateMatch[1].trim();
        } else if (lowerName.includes("tmbulletin.log")) {
            sqlContent = await zipEntry.async("string");
        } else if (lowerName.includes("images/")) {
            imageFiles.push(zipEntry);
        }
      }

      if (!sqlContent) throw new Error("ZIP içinde SQL verisi (tmbulletin.log) bulunamadı!");

      updateProgress(10, `Bülten No: ${bulletinNo} | Veriler Çözümleniyor...`);

      const recordsMap = new Map();
      let startIndex = 0;

      while (startIndex < sqlContent.length) {
          let endIndex = sqlContent.indexOf('\n', startIndex);
          if (endIndex === -1) endIndex = sqlContent.length;
          
          const line = sqlContent.substring(startIndex, endIndex).trim();
          startIndex = endIndex + 1;

          if (!line.startsWith('INSERT INTO')) continue;
          const match = line.match(/INSERT INTO (\w+) VALUES\s*\((.*)\)/i);
          if (!match) continue;

          const table = match[1].toUpperCase();
          const rawValues = parseValuesFromRaw(match[2]);
          if (!rawValues || rawValues.length === 0) continue;

          const appNo = rawValues[0];
          if (!recordsMap.has(appNo)) {
              recordsMap.set(appNo, { application_no: appNo, bulletin_no: bulletinNo, holders: [], goodsObjects: [] });
          }
          const record = recordsMap.get(appNo);

          if (table === "TRADEMARK") {
              record.application_date = formatDateForSupabase(rawValues[1]);
              record.mark_name = rawValues[4] || rawValues[5];
              record.nice_classes = rawValues[6];
          } else if (table === "HOLDER") {
              const holderName = rawValues[2];
              if (holderName) record.holders.push(holderName);
          } else if (table === "GOODS") {
              // 🔥 DÜZELTME BURADA: Sınıf Numarası (Class No) için doğru indeks (2) seçildi!
              let classNo = "";
              let classText = "";

              if (rawValues.length >= 4) {
                  // İdeal Format: ['2025/123', '1', '35', 'Reklamcılık...']
                  classNo = rawValues[2] ? String(rawValues[2]).trim() : '';
                  classText = rawValues[3] ? String(rawValues[3]).trim() : '';
              } else if (rawValues.length === 3) {
                  // Olası Eksik Format
                  classNo = rawValues[1] ? String(rawValues[1]).trim() : '';
                  classText = rawValues[2] ? String(rawValues[2]).trim() : '';
              } else {
                  // Kurtarma (Fallback)
                  classText = rawValues.reduce((a, b) => (b && b.length > a.length) ? b : a, "");
              }

              if (classText && classText !== "") {
                  record.goodsObjects.push({
                      classNo: classNo,
                      classText: classText
                  });
              }
          }
      }

      const finalRecords = [];
      const finalGoods = [];
      
      // 🔥 YENİ DB: Ana bülten ID'sini önceden belirliyoruz ki alt tablolara (records) bağlayabilelim
      const bulletinDbId = `bulletin_main_${bulletinNo}`;

      recordsMap.forEach((r) => {
          if (r.mark_name) {
              const safeAppNo = r.application_no.replace(/\//g, '_').replace(/-/g, '_');
              const imgMatch = imageFiles.find(img => img.name.includes(safeAppNo));
              let image_url = null; // Kolon adı image_url oldu
              if (imgMatch) {
                  image_url = `bulletins/trademark_${bulletinNo}_images/${imgMatch.name.split('/').pop()}`;
              }

              const deterministicId = `bull_${bulletinNo}_app_${safeAppNo}`;

              // 🔥 YENİ DB: Kolon isimleri ve tipleri şemaya göre (ARRAY, JSONB) düzeltildi
              finalRecords.push({
                  id: deterministicId, 
                  bulletin_id: bulletinDbId, // bulletin_no yerine foreign key
                  application_number: r.application_no, // application_no -> application_number
                  brand_name: r.mark_name, // mark_name -> brand_name
                  application_date: r.application_date,
                  // String olan sınıfları DB'deki text[] (ARRAY) formatına çeviriyoruz
                  nice_classes: r.nice_classes ? r.nice_classes.split(/[,\s]+/).filter(Boolean) : [], 
                  // Sahipleri virgüllü string yerine doğrudan Dizi olarak veriyoruz (DB JSONB bekliyor)
                  holders: r.holders, 
                  image_url: image_url, // image_path -> image_url
                  source: 'turkpatent',
                  created_at: new Date().toISOString()
              });

              r.goodsObjects.forEach((g, idx) => {
                  finalGoods.push({
                      id: `${deterministicId}_class_${g.classNo}_${idx}`, 
                      bulletin_record_id: deterministicId, // İlişkisel bağ: application_no yerine record ID'si
                      class_number: parseInt(g.classNo, 10) || null, // DB Integer bekliyor
                      class_text: g.classText,
                      created_at: new Date().toISOString()
                  });
              });
          }
      });

      // Ana bülten kaydını oluşturma (Aynı kalıyor)
        const { error: bulletinError } = await supabase.from('trademark_bulletins').upsert({ 
          id: bulletinDbId, 
          bulletin_no: bulletinNo, 
          bulletin_date: formatDateForSupabase(bulletinDate),
          created_at: new Date().toISOString()
      }, { onConflict: 'id' });
      
      if (bulletinError) {
          throw new Error("Ana bülten kaydı oluşturulamadı: " + bulletinError.message);
      }

      updateProgress(15, `Veritabanına ${finalRecords.length} marka aktarılıyor...`);
      for (let i = 0; i < finalRecords.length; i += 1000) {
          const chunk = finalRecords.slice(i, i + 1000);
          const { error } = await supabase.from('trademark_bulletin_records').upsert(chunk);
          if (error) throw error;
          let pct = 15 + Math.floor((i / finalRecords.length) * 15);
          updateProgress(pct, `Markalar Kaydediliyor: ${Math.min(i + 1000, finalRecords.length)} / ${finalRecords.length}`);
      }

      if (finalGoods.length > 0) {
          updateProgress(25, `Veritabanına ${finalGoods.length} eşya listesi aktarılıyor...`);
          for (let i = 0; i < finalGoods.length; i += 1000) {
              const chunk = finalGoods.slice(i, i + 1000);
              const { error } = await supabase.from('trademark_bulletin_goods').upsert(chunk);
              if (error) console.error("Goods (Eşya) veritabanı yazma hatası:", error);
          }
      }

      async function uploadImageWithRetrySafe(destPath, imgData, contentType, retries = 3) {
          for (let i = 0; i < retries; i++) {
              try {
                  const { data, error } = await supabase.storage.from('brand_images').upload(destPath, imgData, {
                      contentType: contentType,
                      upsert: true 
                  });
                  if (!error) return true; 
                  await new Promise(res => setTimeout(res, 500 * (i + 1))); 
              } catch (err) {
                  await new Promise(res => setTimeout(res, 500 * (i + 1))); 
              }
          }
          return false; 
      }

      updateProgress(35, "Görseller Storage'a aktarılıyor. (Lütfen sekmeyi kapatmayın)...");
      const CHUNK_SIZE = 40; 
      let uploadedCount = 0;

      for (let i = 0; i < imageFiles.length; i += CHUNK_SIZE) {
          const chunk = imageFiles.slice(i, i + CHUNK_SIZE);
          
          await Promise.all(chunk.map(async (entry) => {
              try {
                  const imgData = await entry.async("blob");
                  const imgName = entry.name.split('/').pop() || "unknown.jpg";
                  const destPath = `bulletins/trademark_${bulletinNo}_images/${imgName}`;
                  const contentType = imgName.endsWith('.png') ? 'image/png' : 'image/jpeg';
                  
                  await uploadImageWithRetrySafe(destPath, imgData, contentType);
              } catch (blobErr) {}
          }));
          
          uploadedCount += chunk.length;
          let pct = 35 + Math.floor((uploadedCount / imageFiles.length) * 65);
          updateProgress(pct, `Görseller Yükleniyor: ${Math.min(uploadedCount, imageFiles.length)} / ${imageFiles.length}`);
      }

      updateProgress(100, "🎉 İşlem Başarıyla Tamamlandı! Tablo yenileniyor...", "green");
      
      selectedFile = null;
      if (selectedFileName) selectedFileName.textContent = "";
      if (fileInput) fileInput.value = "";
      setTimeout(() => location.reload(), 2000);

    } catch (err) {
      console.error("İşlem Hatası:", err);
      updateProgress(100, "❌ Hata: " + err.message, "crimson");
    }
  });
}