// js/bulletin-upload.js
import { getStorage, ref, uploadBytesResumable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Firebase config'i import et
let storage = null;
let isInitialized = false;

// Firebase'i initialize et
async function initializeFirebase() {
  if (isInitialized) return storage;
  
  try {
    console.log('🔥 Firebase initialize ediliyor...');
    
    // Firebase config modülünü import et
    const firebaseModule = await import('../firebase-config.js');
    
    // Storage'ı app instance ile initialize et
    storage = getStorage(firebaseModule.app);
    isInitialized = true;
    
    console.log('✅ Firebase başarıyla initialize edildi');
    return storage;
    
  } catch (error) {
    console.error('❌ Firebase initialize hatası:', error);
    throw error;
  }
}

// DOM ready olana kadar bekle
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📄 DOM yüklendi, Firebase initialize ediliyor...');
  
  try {
    await initializeFirebase();
    setupUploadEvents();
  } catch (error) {
    console.error('❌ Firebase yükleme hatası:', error);
    
    // Hata mesajını göster
    const uploadStatus = document.getElementById("uploadStatusTrademark");
    if (uploadStatus) {
      uploadStatus.textContent = "Firebase yükleme hatası: " + error.message;
      uploadStatus.style.color = "red";
    }
  }
});

function setupUploadEvents() {
  console.log('🎯 Upload event listeners kuruluyor...');
  
  // Alanları tekrar seç (DOM hazır olduğundan emin olmak için)
  const dropArea = document.getElementById("dropAreaTrademark");
  const fileInput = document.getElementById("bulletinFileTrademark");
  const form = document.getElementById("bulletinUploadFormTrademark");
  const selectedFileName = document.getElementById("selectedFileNameTrademark");
  const uploadStatus = document.getElementById("uploadStatusTrademark");
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");

  let selectedFile = null;

  if (!dropArea || !fileInput || !form) {
    console.error('❌ Gerekli DOM elementleri bulunamadı');
    return;
  }

  console.log('✅ DOM elementleri bulundu, event listeners ekleniyor...');

  // Sürükle bırak olayları
  dropArea.addEventListener("click", () => {
    console.log('📁 Drop area tıklandı');
    fileInput.click();
  });

  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.style.border = "2px dashed #1e3c72";
  });

  dropArea.addEventListener("dragleave", () => {
    dropArea.style.border = "2px dashed #ccc";
  });
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.style.border = "2px dashed #ccc";

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    selectedFile = files[0];
    console.log('📦 Dosya drop edildi:', selectedFile.name, selectedFile.type, selectedFile.size);

    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      if (uploadStatus) {
        uploadStatus.textContent = "⚠️ Sadece .zip dosyaları kabul edilir!";
        uploadStatus.style.color = "orange";
      }
      selectedFile = null;
      return;
    }

    // Yeşil yazı güncellemesi
    if (uploadStatus) {
      uploadStatus.textContent = "✅ Dosya seçildi: " + selectedFile.name;
      uploadStatus.style.color = "green";
    }
    if (selectedFileName) {
      selectedFileName.textContent = selectedFile.name;
    }

    // **YENİ EKLENDİ** → input'a da dosyayı yaz, change eventini tetikle
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

  fileInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      selectedFile = files[0];
      console.log('📁 Dosya seçildi:', selectedFile.name, selectedFile.type, selectedFile.size);
      
      if (selectedFileName) {
        selectedFileName.textContent = selectedFile.name;
      }
      
      // Dosya tipini kontrol et
      if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
        if (uploadStatus) {
          uploadStatus.textContent = "⚠️ Sadece .zip dosyaları kabul edilir!";
          uploadStatus.style.color = "orange";
        }
        selectedFile = null;
        return;
      }
      
      // Başarılı seçim mesajı
      if (uploadStatus) {
        uploadStatus.textContent = "✅ Dosya seçildi: " + selectedFile.name;
        uploadStatus.style.color = "green";
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log('🚀 Form submit edildi');

    if (!selectedFile) {
      console.log('❌ Dosya seçilmemiş');
      if (uploadStatus) {
        uploadStatus.textContent = "Lütfen bir dosya seçin.";
        uploadStatus.style.color = "red";
      }
      return;
    }

    // Dosya boyutu kontrolü (500MB limit)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (selectedFile.size > maxSize) {
      if (uploadStatus) {
        uploadStatus.textContent = "❌ Dosya çok büyük! Maksimum 500MB olmalı.";
        uploadStatus.style.color = "red";
      }
      return;
    }

    try {
      console.log('📤 Upload başlatılıyor...');
      console.log('📁 Dosya detayları:', {
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type
      });

      // Firebase'in hazır olduğundan emin ol
      if (!storage) {
        console.log('🔄 Firebase yeniden initialize ediliyor...');
        storage = await initializeFirebase();
      }

      if (uploadStatus) {
        uploadStatus.textContent = "Yükleniyor...";
        uploadStatus.style.color = "#333";
      }
      
      if (progressContainer) {
        progressContainer.style.display = "block";
      }
      
      if (progressBar) {
        progressBar.style.width = "0%";
        progressBar.textContent = "0%";
        progressBar.style.background = "#1e3c72"; // Reset renk
      }

      // Storage path oluştur
      const timestamp = Date.now();
      const storagePath = `bulletins/${timestamp}_${selectedFile.name}`;
      console.log('📍 Storage path:', storagePath);

      // Storage referansı oluştur
      const fileRef = ref(storage, storagePath);
      console.log('📎 Storage referansı oluşturuldu');

      // Upload task başlat
      const uploadTask = uploadBytesResumable(fileRef, selectedFile);
      console.log('🚀 Upload task başlatıldı');

      // Upload progress takibi
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          const percent = Math.round(progress);
          
          console.log(`📊 Upload progress: ${percent}% (${snapshot.bytesTransferred}/${snapshot.totalBytes})`);
          
          if (uploadStatus) {
            uploadStatus.textContent = `Yükleniyor: %${percent}`;
          }
          
          if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.textContent = `${percent}%`;
          }
        },
        (error) => {
          console.error("❌ Upload hatası:", error);
          console.error("❌ Error code:", error.code);
          console.error("❌ Error message:", error.message);
          
          if (uploadStatus) {
            uploadStatus.textContent = "Hata: " + error.message;
            uploadStatus.style.color = "red";
          }
          
          if (progressBar) {
            progressBar.style.background = "crimson";
            progressBar.textContent = "HATA";
          }
        },
        () => {
          console.log("✅ Upload tamamlandı!");
          console.log("📍 Dosya yolu:", storagePath);
          
          if (uploadStatus) {
            uploadStatus.textContent = "✅ Yükleme tamamlandı! İşlem başlatıldı.";
            uploadStatus.style.color = "green";
          }
          
          if (progressBar) {
            progressBar.style.width = "100%";
            progressBar.textContent = "100%";
          }
          
          // Formu temizle
          selectedFile = null;
          if (selectedFileName) {
            selectedFileName.textContent = "";
          }
          if (fileInput) {
            fileInput.value = "";
          }
          
          // 3 saniye sonra progress bar'ı gizle
          setTimeout(() => {
            if (progressContainer) {
              progressContainer.style.display = "none";
            }
            if (uploadStatus) {
              uploadStatus.textContent = "";
            }
          }, 3000);
        }
      );

    } catch (error) {
      console.error("❌ Upload başlatma hatası:", error);
      
      if (uploadStatus) {
        uploadStatus.textContent = "Hata: " + error.message;
        uploadStatus.style.color = "red";
      }
      
      if (progressBar) {
        progressBar.style.background = "crimson";
        progressBar.textContent = "HATA";
      }
    }
  });

  console.log('✅ Event listeners başarıyla kuruldu');
}

// Export for debugging
window.bulletinUploadDebug = {
  initializeFirebase,
  setupUploadEvents,
  getStorage: () => storage,
  isInitialized: () => isInitialized
};