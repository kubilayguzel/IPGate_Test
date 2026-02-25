// public/js/bulletin-upload.js
import { supabase } from '../supabase-config.js';

document.addEventListener('DOMContentLoaded', () => {
  console.log('📄 DOM yüklendi, Supabase Upload başlatılıyor...');
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
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) return uploadStatus && (uploadStatus.textContent = "Lütfen bir dosya seçin.");
    
    if (selectedFile.size > 500 * 1024 * 1024) {
      return uploadStatus && (uploadStatus.textContent = "❌ Dosya çok büyük! (Maks 500MB)");
    }

    try {
      if (uploadStatus) { uploadStatus.textContent = "ZIP Dosyası Supabase'e Yükleniyor... Lütfen bekleyin."; uploadStatus.style.color = "#333"; }
      if (progressContainer) progressContainer.style.display = "block";
      if (progressBar) { progressBar.style.width = "50%"; progressBar.textContent = "Yükleniyor..."; progressBar.style.background = "#1e3c72"; }

      const timestamp = Date.now();
      const storagePath = `${timestamp}_${selectedFile.name}`;

      // 1. Supabase Storage'a Yükle (bulletins adlı bucket oluşturduğunuzdan emin olun)
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('bulletins')
        .upload(storagePath, selectedFile, { upsert: false });

      if (uploadError) throw uploadError;

      if (progressBar) { progressBar.style.width = "100%"; progressBar.textContent = "100%"; }
      if (uploadStatus) { uploadStatus.textContent = "✅ Yükleme tamamlandı! Bülten sunucuda işleniyor (Bu işlem 3-5 dk sürebilir)..."; uploadStatus.style.color = "green"; }

      // 2. Edge Function'ı Tetikle (İşlemeye başla)
      const { data: procData, error: procError } = await supabase.functions.invoke('process-bulletin', {
        body: { filePath: storagePath }
      });

      if (procError) throw procError;

      if (uploadStatus) { uploadStatus.textContent = `🎉 Bülten başarıyla işlendi! (Veritabanına eklendi)`; }
      
      // Formu Temizle
      selectedFile = null;
      if (selectedFileName) selectedFileName.textContent = "";
      if (fileInput) fileInput.value = "";
      
    } catch (error) {
      console.error("Upload hatası:", error);
      if (uploadStatus) { uploadStatus.textContent = "Hata: " + error.message; uploadStatus.style.color = "red"; }
      if (progressBar) { progressBar.style.background = "crimson"; progressBar.textContent = "HATA"; }
    }
  });
}