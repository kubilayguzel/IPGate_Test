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

  // --- 🔥 YENİ: Otomatik ID Üretici (Firebase id'leri gibi) ---
  function generateUUID() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
      });
  }

  // --- SQL Parse Yardımcıları ---
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
      updateProgress(0, "ZIP dosyası tarayıcıda açılıyor (Bu işlem bilgisayar hızınıza göre biraz sürebilir)...");

      // 1. Tarayıcıda ZIP dosyasını belleğe al
      const zip = await JSZip.loadAsync(selectedFile);
      
      let bulletinNo = "Unknown";
      let bulletinDate = "Unknown";
      let sqlContent = "";
      const imageFiles = [];

      updateProgress(5, "Dosyalar taranıyor...");

      // 2. ZIP içindeki dosyaları sınıflandır
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

      // 3. SQL Dosyasını Parse Et
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
              recordsMap.set(appNo, { application_no: appNo, bulletin_no: bulletinNo, holders: [] });
          }
          const record = recordsMap.get(appNo);

          if (table === "TRADEMARK") {
              record.application_date = rawValues[1];
              record.mark_name = rawValues[4] || rawValues[5];
              record.nice_classes = rawValues[6];
          } else if (table === "HOLDER") {
              const holderName = rawValues[2];
              if (holderName) record.holders.push(holderName);
          }
      }

      // Veritabanı Kayıtlarını Hazırla
      const finalRecords = [];
      recordsMap.forEach((r) => {
          if (r.mark_name) {
              const safeAppNo = r.application_no.replace(/\//g, '_').replace(/-/g, '_');
              const imgMatch = imageFiles.find(img => img.name.includes(safeAppNo));
              let image_path = null;
              if (imgMatch) {
                  image_path = `bulletins/trademark_${bulletinNo}_images/${imgMatch.name.split('/').pop()}`;
              }

              finalRecords.push({
                  id: generateUUID(), // 🔥 HATA ÇÖZÜMÜ: Otomatik Benzersiz ID atandı
                  application_no: r.application_no,
                  bulletin_no: r.bulletin_no,
                  mark_name: r.mark_name,
                  application_date: r.application_date,
                  nice_classes: r.nice_classes,
                  holders: r.holders.join(', '),
                  image_path: image_path
              });
          }
      });

      // Ana Bülteni Ekle (Hata vermemesi için önce ID'si var mı diye kontrol et)
      let bulletinDbId = generateUUID();
      const { data: existingB } = await supabase.from('trademark_bulletins').select('id').eq('bulletin_no', bulletinNo).limit(1);
      if (existingB && existingB.length > 0) {
          bulletinDbId = existingB[0].id;
      }
      await supabase.from('trademark_bulletins').upsert({ id: bulletinDbId, bulletin_no: bulletinNo, bulletin_date: bulletinDate });

      // 4. Verileri Supabase'e Yaz (1000'li Parçalar)
      updateProgress(15, `Veritabanına ${finalRecords.length} marka aktarılıyor...`);
      for (let i = 0; i < finalRecords.length; i += 1000) {
          const chunk = finalRecords.slice(i, i + 1000);
          const { error } = await supabase.from('trademark_bulletin_records').upsert(chunk);
          if (error) {
              console.error("Veritabanı yazma hatası:", error);
              throw error; // Döngüyü durdur
          }
          
          let pct = 15 + Math.floor((i / finalRecords.length) * 15);
          updateProgress(pct, `Metin Verileri Kaydediliyor: ${Math.min(i + 1000, finalRecords.length)} / ${finalRecords.length}`);
      }

      // --- HATA TOLERANSLI YÜKLEME FONKSİYONU ---
      // Bağlantı koparsa pes etmez, 3 kere tekrar dener!
      async function uploadImageWithRetry(destPath, imgData, contentType, retries = 3) {
          for (let i = 0; i < retries; i++) {
              const { data, error } = await supabase.storage.from('brand_images').upload(destPath, imgData, {
                  contentType: contentType,
                  upsert: true
              });
              
              if (!error) return data; // Başarılıysa hemen dön
              
              // Hata aldıysa ve son deneme değilse biraz bekle ve tekrar dene
              if (i < retries - 1) {
                  console.warn(`⏳ Bağlantı koptu, tekrar deneniyor (${i+1}/3): ${destPath}`);
                  await new Promise(res => setTimeout(res, 1000 * (i + 1))); // 1sn, 2sn bekle
              } else {
                  throw error; // 3 denemede de olmazsa hatayı fırlat
              }
          }
      }

      // 5. Görselleri Storage'a Yükle (Dengeli ve Güvenli Paketler)
      const CHUNK_SIZE = 60; // Ağınızı boğmamak için en stabil sayı 30'dur.
      for (let i = 0; i < imageFiles.length; i += CHUNK_SIZE) {
          const chunk = imageFiles.slice(i, i + CHUNK_SIZE);
          
          await Promise.all(chunk.map(async (entry) => {
              const imgData = await entry.async("blob");
              const imgName = entry.name.split('/').pop() || "unknown.jpg";
              const destPath = `bulletins/trademark_${bulletinNo}_images/${imgName}`;
              const contentType = imgName.endsWith('.png') ? 'image/png' : 'image/jpeg';
              
              // Normal upload yerine, yenilmez (retry) fonksiyonumuzu kullanıyoruz!
              await uploadImageWithRetry(destPath, imgData, contentType);
          }));
          
          let pct = 30 + Math.floor((i / imageFiles.length) * 70);
          updateProgress(pct, `Görseller Yükleniyor ve Doğrulanıyor: ${Math.min(i + CHUNK_SIZE, imageFiles.length)} / ${imageFiles.length}`);
      }

      updateProgress(100, "🎉 İşlem Başarıyla Tamamlandı! Tablo yenileniyor...", "green");
      
      // Formu Temizle ve Tabloyu Yenile
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