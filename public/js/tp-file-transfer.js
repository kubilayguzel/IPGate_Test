// =============================
// TÜRKPATENT Dosya Aktarım Modülü - TEMİZ VERSİYON
// =============================

// --- DOM Helper Fonksiyonlar ---
function _el(id) { return document.getElementById(id); }
function _showBlock(el) { if(!el) return; el.classList.remove('hide'); el.style.display=''; }
function _hideBlock(el) { if(!el) return; el.classList.add('hide'); }

function fmtDateToTR(isoOrDDMMYYYY) {
  if(!isoOrDDMMYYYY) return '';
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(isoOrDDMMYYYY)) return isoOrDDMMYYYY;
  const m = String(isoOrDDMMYYYY).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(isoOrDDMMYYYY);
}

// Tarih parse yardımcı fonksiyonu - dosyanın en üstüne ekleyin
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // DD.MM.YYYY formatı
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  // Diğer formatları dene
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// --- Firebase Imports ---
import { app, personService, ipRecordsService, transactionTypeService } from '../firebase-config.js';
import { loadSharedLayout} from './layout-loader.js';
import { PersonModalManager } from './components/PersonModalManager.js';
import { mapTurkpatentResultsToIPRecords, mapTurkpatentToIPRecord} from './turkpatent-mapper.js';
import { showNotification } from '../utils.js';

// --- DOM Elements ---
const basvuruNoInput = _el('basvuruNoInput');
const sahipNoInput = _el('ownerIdInput');
const loadingEl = _el('loading');
const singleResultContainer = _el('singleResultContainer');
const singleResultInner = _el('singleResultInner');
const cancelBtn = _el('cancelBtn');

// Kişi yönetimi elementleri
const relatedPartySearchInput = _el('relatedPartySearchInput');
const relatedPartySearchResults = _el('relatedPartySearchResults');
const addNewPersonBtn = _el('addNewPersonBtn');
const relatedPartyList = _el('relatedPartyList');
const relatedPartyCount = _el('relatedPartyCount');

// --- Global State ---
let allPersons = [];
let selectedRelatedParties = [];
let currentOwnerResults = []; // CSV export için
let personModalManager = null;

// --- Extension ID ---
const EXTENSION_ID = 'kemjjkdjhijodjmmfpmlnhhnfaojndgn';

// ===============================
// INITIALIZATION
// ===============================

async function init() {
  try {
    const personsResult = await personService.getPersons();
    allPersons = Array.isArray(personsResult.data) ? personsResult.data : [];
    console.log(`[INIT] ${allPersons.length} kişi yüklendi.`);
    personModalManager = new PersonModalManager();

    setupEventListeners();
    setupExtensionMessageListener();
    setupRadioButtons();
  } catch (error) {
    console.error("Veri yüklenirken hata oluştu:", error);
    showNotification("Gerekli veriler yüklenemedi.", "danger");
  }
}

// ===============================
// EVENT LISTENERS
// ===============================

function setupEventListeners() {
  // HER İKİ ALANDA DA TEK SORGULA BUTONU
  document.addEventListener('click', (e) => {
    if (e.target.id === 'queryBtn' || e.target.id === 'bulkQueryBtn') {
      e.preventDefault();
      handleQuery();
    }
  });
  
  // Portföye kaydet butonu
  document.addEventListener('click', (e) => {
    if (e.target.id === 'savePortfolioBtn') {
      e.preventDefault();
      handleSaveToPortfolio();
    }
  });
  
  // İptal butonu
  cancelBtn?.addEventListener('click', () => history.back());
  
  // Kişi arama
  let searchTimer;
  relatedPartySearchInput?.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimer);
    if (query.length < 2) {
      relatedPartySearchResults.innerHTML = '';
      _hideBlock(relatedPartySearchResults);
      return;
    }
    searchTimer = setTimeout(() => searchPersons(query), 250);
  });
  
  // Arama sonuçlarına tıklama
  relatedPartySearchResults?.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    const personId = item.dataset.id;
    const person = allPersons.find(p => p.id === personId);
    if (person) {
      addRelatedParty(person);
      relatedPartySearchInput.value = '';
      _hideBlock(relatedPartySearchResults);
    }
  });
  
  // Yeni kişi ekleme (Merkezi Modal)
  addNewPersonBtn?.addEventListener('click', () => {
    if (personModalManager) {
      personModalManager.open(null, (newPerson) => {
        if (newPerson) {
          allPersons.push(newPerson); // Listeye ekle
          addRelatedParty(newPerson); // Seçili yap
        }
      });
    }
  });
  
  // Kişi silme
  relatedPartyList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-selected-item-btn');
    if (btn) removeRelatedParty(btn.dataset.id);
  });

  console.log('[DEBUG] Event listeners kuruldu');
}

async function handleSaveToPortfolio() {
  const checkedBoxes = document.querySelectorAll('.record-checkbox:checked');
  
  if (checkedBoxes.length === 0) {
    showNotification('Kaydetmek için en az bir kayıt seçin.', 'warning');
    return;
  }
  
  const selectedIndexes = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.index));
  const selectedRecords = selectedIndexes.map(index => currentOwnerResults[index]).filter(Boolean);
  
  if (selectedRecords.length === 0) {
    showNotification('Seçili kayıtlar bulunamadı.', 'warning');
    return;
  }
  
  // Seçili kişilerden sahip/başvuran bilgilerini hazırla
  const relatedParties = selectedRelatedParties.map(person => ({
    id: person.id,
    name: person.name,
    email: person.email || null
  }));
  
  const saveLoading = window.showLoadingWithCancel(
    'Portföye kaydediliyor',
    'Kayıtlar portföye aktarılıyor...',
    () => {
      console.log('Kaydetme işlemi iptal edildi');
    }
  );
  
  try {
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const record of selectedRecords) {
      try {
      const mappedRecord = await mapTurkpatentToIPRecord(record, relatedParties);        
        if (!mappedRecord) {
          console.warn('Kayıt haritalandırılamadı:', record);
          errorCount++;
          continue;
        }
        
        // Kayıt oluştur
        const result = await ipRecordsService.createRecordFromDataEntry(mappedRecord);
        
        if (result.success) {
          console.log('✅ Portföy kaydı oluşturuldu:', result.id);
       
        // Self kayıtlar için başvuru transaction'ı oluştur
        if (mappedRecord.recordOwnerType === 'self') {
            try {
              const TRANSACTION_TYPE_IDS = { trademark: '2', patent: '5', design: '8' };
              const txTypeId = TRANSACTION_TYPE_IDS[mappedRecord.type] || '2';
              
              // Başvuru transaction'ı oluştur
              const transactionData = {
                type: String(txTypeId),
                description: 'Başvuru',
                timestamp: mappedRecord.applicationDate || new Date(),
                transactionHierarchy: 'parent'
              };
              
              const txResult = await ipRecordsService.addTransactionToRecord(result.id, transactionData);
              if (txResult.success) {
                console.log('✅ Başvuru transaction\'ı oluşturuldu:', result.id);
              }
            } catch (txError) {
              console.error('❌ Transaction oluşturma hatası:', txError);
            }
          }
          successCount++;
        } else if (result.isDuplicate) {
          console.log('⚠️ Kayıt zaten mevcut:', mappedRecord.applicationNumber);
          skippedCount++;
        } else {
          console.error('❌ Kayıt oluşturulamadı:', result.error);
          errorCount++;
        }
        
      } catch (error) {
        console.error('Kayıt işlenirken hata:', error);
        errorCount++;
      }
    }
 
    // Sonuç mesajı
    let message = `${successCount} kayıt başarıyla portföye eklendi. `;
    if (skippedCount > 0) message += `${skippedCount} kayıt zaten mevcut olduğu için atlandı. `;
    if (errorCount > 0) message += `${errorCount} kayıtta hata oluştu. `;
    
    if (errorCount === 0) {
      saveLoading.showSuccess(message.trim());
      showNotification(message.trim(), 'success');

      // 🔥 --- TEMİZLEME İŞLEMLERİ (BURAYI EKLEYİN) --- 🔥
      
      // 1. Hafızadaki Listeleri Sıfırla
      currentOwnerResults = [];
      if (window.batchResults) window.batchResults = [];

      // 2. Tabloyu ve Sonuç Alanını Gizle/Temizle
      if (singleResultInner) singleResultInner.innerHTML = '';
      _hideBlock(singleResultContainer);

      // 3. Input Alanlarını Temizle
      if (basvuruNoInput) basvuruNoInput.value = '';
      if (sahipNoInput) sahipNoInput.value = '';

      // 4. (Opsiyonel) Seçili "İlgili Taraf" Listesini Temizle
      // Eğer taraf seçimlerinin de sıfırlanmasını istiyorsanız bu satırları açın:
      // selectedRelatedParties = [];
      // renderSelectedRelatedParties();

      // 5. Buton Durumunu Güncelle
      updateSaveButton();

      // -----------------------------------------------------

    } else {
      saveLoading.showError(message.trim());
      showNotification(message.trim(), 'warning');
      // Hata varsa tabloyu temizlemiyoruz ki kullanıcı hatalı kayıtları görebilsin/tekrar deneyebilsin.
    }
    
  } catch (error) {
    console.error('Portföye kaydetme hatası:', error);
    saveLoading.showError('Kaydetme işlemi sırasında hata oluştu: ' + error.message);
    showNotification('Kaydetme işlemi sırasında hata oluştu: ' + error.message, 'danger');
  }
}
// ===============================
// RADIO BUTTON YÖNETİMİ
// ===============================

function setupRadioButtons() {
  const singleRadio = _el('singleTransfer');
  const ownerRadio = _el('bulkByOwner');
  const singleFields = _el('singleFields');
  const ownerFields = _el('bulkFields');
  
  function toggleFields() {
    if (singleRadio?.checked) {
      _showBlock(singleFields);
      _hideBlock(ownerFields);
      console.log('[DEBUG] Başvuru numarası alanı aktif');
    } else if (ownerRadio?.checked) {
      _hideBlock(singleFields);
      _showBlock(ownerFields);
      console.log('[DEBUG] Sahip numarası alanı aktif');
    }
    // Sonuçları temizle
    _hideBlock(singleResultContainer);
    if (singleResultInner) singleResultInner.innerHTML = '';
  }
  
  singleRadio?.addEventListener('change', toggleFields);
  ownerRadio?.addEventListener('change', toggleFields);
  
  // Initial state
  toggleFields();
}

// ===============================
// ANA SORGULAMA FONKSİYONU
// ===============================

async function handleQuery() {
  // Hangi alan dolu?
  const basvuruNo = (basvuruNoInput?.value || '').trim();
  const sahipNo = (sahipNoInput?.value || '').trim();
  
  console.log('[DEBUG] handleQuery çağrıldı:', { basvuruNo, sahipNo });
  
  if (basvuruNo && !sahipNo) {
    // BAŞVURU NUMARASI VAR
    await queryByApplicationNumber(basvuruNo);
    
  } else if (sahipNo && !basvuruNo) {
    // SAHİP NUMARASI VAR - Simple Loading ile
    let loading = window.showLoadingWithCancel(
      'TÜRKPATENT sorgulanıyor',
      'Sahip numarası ile kayıtlar araştırılıyor...',
      () => {
        console.log('[DEBUG] Sorgu iptal edildi');
        if (window.currentLoading) {
          window.currentLoading = null;
        }
      }
    );

    console.log('[DEBUG] Sahip numarası eklentiye yönlendiriliyor:', sahipNo);
    
    window.searchedOwnerNumber = sahipNo;
    const url = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(sahipNo)}&query_type=sahip&source=${encodeURIComponent(window.location.origin)}`;
    console.log('[DEBUG] TÜRKPATENT URL açılıyor:', url);
    
    const newWindow = window.open(url, '_blank');
    if (!newWindow) {
      loading.showError('Pop-up engellendi. Tarayıcı ayarlarından pop-up\'ları açın.');
      return;
    }

    // Loading referansını global'e kaydet
    window.currentLoading = loading;
    
  } else if (basvuruNo && sahipNo) {
    // İKİSİ DE DOLU
    showNotification('Lütfen sadece bir alan doldurun.', 'warning');
    
  } else {
    // İKİSİ DE BOŞ
    showNotification('Başvuru numarası veya sahip numarası girin.', 'warning');
  }
}

// ===============================
// BAŞVURU NUMARASI SORGULAMA
// ===============================

// ===============================
// BAŞVURU NUMARASI SORGULAMA (OPTS - TEKİL DOSYA)
// ===============================

async function queryByApplicationNumber(basvuruNo) {
  console.log('[DEBUG] Tekil sorgu başlatılıyor (OPTS):', basvuruNo);

  try {
    _showBlock(loadingEl);
    _hideBlock(singleResultContainer);

    // Eklentinin otomatik çalışmasını engelleyebilecek bayrakları temizle
    window.skipScrapeTrademark = false;

    // Hedef URL (Sizin belirttiğiniz opts adresi)
    // #bn= parametresi eklentinin dosya numarasını tanımasını sağlar
    const targetUrl = `https://opts.turkpatent.gov.tr/trademark#bn=${encodeURIComponent(basvuruNo)}`;

    console.log('[DEBUG] Hedef sayfa açılıyor:', targetUrl);

    // 1. Pencereyi Doğrudan Aç (Mesaj göndermeyi deneme, direkt aç)
    const newWindow = window.open(targetUrl, '_blank');

    if (newWindow) {
     showNotification('TÜRKPATENT sayfası açıldı. Veri bekleniyor...', 'info');
      
      // 2. Güvenlik ve Timeout Kontrolü
      // Eklentiden 45 saniye içinde cevap gelmezse loading'i kapat
      setTimeout(() => {
        // Eğer sonuç alanı hala gizliyse (yani veri gelmediyse)
        if (!singleResultContainer.style.display || singleResultContainer.classList.contains('hide')) {
           console.warn('[TIMEOUT] Veri gelmedi veya işlem uzun sürdü.');
           // İsterseniz burada kullanıcıya uyarı verebilirsiniz, şimdilik sessiz bırakıyoruz
           // _hideBlock(loadingEl); 
        }
      }, 45000);

    } else {
      _hideBlock(loadingEl);
     showNotification('Pop-up engellendi. Lütfen tarayıcı izinlerini kontrol edin.', 'danger');
    }

  } catch (err) {
    _hideBlock(loadingEl);
    console.error('[DEBUG] Sorgu hatası:', err);
   showNotification('İşlem hatası: ' + (err?.message || err), 'danger');
  }
}

// Eklentiden sonuç bekle (polling)
function startPollingForOptsResult(basvuruNo, loading) {
  let pollCount = 0;
  const maxPolls = 60; // 500ms * 60 = 30 saniye
  
  console.log('[Poll] Polling başlatıldı:', basvuruNo);
  
  // Eğer hali hazırda bir polling varsa temizle (Çakışmayı önler)
  if (window.currentPolling) {
    clearInterval(window.currentPolling);
  }
  
  const pollInterval = setInterval(() => {
    pollCount++;
    
    // Eklentiye sonuç hazır mı diye sor
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(
        EXTENSION_ID, // Yukarıdaki merkezi ID'yi kullanır
        { type: 'GET_RESULT', applicationNumber: basvuruNo },
        (response) => {
          // Polling sırasında eklenti meşgul olabilir, hata varsa sadece logla
          if (chrome.runtime.lastError) {
            console.log('[Poll] Eklenti şu an cevap vermiyor (Meşgul olabilir)');
            return;
          }
          
          // Eklenti veriyi hazırladıysa (READY)
          if (response && response.status === 'READY' && response.data) {
            console.log('[Poll] ✅ Sonuç başarıyla alındı!', response);
            
            clearInterval(pollInterval);
            window.currentPolling = null;
            
            // Yükleme ekranını kapat
            if (loading && loading.hide) loading.hide();
            
            // Gelen mesaj tipine göre işle (Başarı veya Hata)
            if (response.messageType === 'VERI_GELDI_OPTS') {
              handleOptsSuccess(response.data);
            } else if (response.messageType === 'HATA_OPTS') {
              handleOptsError(response.data);
            }
          }
        }
      );
    }
    
    // Zaman Aşımı (Timeout) Kontrolü
    if (pollCount >= maxPolls) {
      clearInterval(pollInterval);
      window.currentPolling = null;
      console.log('[Poll] ❌ Zaman aşımı: Eklentiden veri gelmedi');
      
      if (loading && loading.showError) {
        loading.showError('Sorgulama zaman aşımına uğradı. Lütfen tekrar deneyin.');
      } else {
        // showNotification fonksiyonunu kullanıyoruz (Önceki adımda yaptığımız)
        showNotification('Sorgulama zaman aşımına uğradı.', 'danger');
      }
      
      _hideBlock(loadingEl);
      window.skipScrapeTrademark = false;
    }
  }, 500);
  
  // Polling referansını global'e kaydet (iptal edilebilmesi için)
  window.currentPolling = pollInterval;
}

// OPTS başarı durumu
function handleOptsSuccess(data) {
  console.log('[OPTS] Veri işleniyor:', data);
  
  try {
    // Loading'i kapat
    if (window.currentLoading) {
      window.currentLoading.hide?.();
      window.currentLoading = null;
    }
    _hideBlock(loadingEl);
    
    // Veriyi göster (ilk kayıt)
    const record = Array.isArray(data) ? data[0] : data;
    renderSingleResult(record);
    _showBlock(singleResultContainer);
    
    showNotification('✅ TÜRKPATENT verisi alındı!', 'success');
    window.skipScrapeTrademark = false;
    
  } catch (error) {
    console.error('[OPTS] İşleme hatası:', error);
    showNotification('Veri işlenirken hata oluştu', 'danger');
    _hideBlock(loadingEl);
    window.skipScrapeTrademark = false;
  }
}

// OPTS hata durumu
function handleOptsError(error) {
  console.error('[OPTS] Hata:', error);
  
  if (window.currentLoading) {
    window.currentLoading.showError?.(error.message || 'Sorgu başarısız');
  }
  _hideBlock(loadingEl);
  
  showNotification(`Hata: ${error.message || 'Bilinmeyen hata'}`, 'danger');
  window.skipScrapeTrademark = false;
}

// ===============================
// SAHİP NUMARASI SORGULAMA
// ===============================

async function queryByOwnerNumber(sahipNo) {
  console.log('[DEBUG] Sahip numarası eklentiye yönlendiriliyor:', sahipNo);
  
  try {
    _showBlock(loadingEl);
    _hideBlock(singleResultContainer);
    
    window.searchedOwnerNumber = sahipNo;
    // TÜRKPATENT sayfasını aç
    const turkPatentUrl = `https://www.turkpatent.gov.tr/arastirma-yap?form=trademark&auto_query=${encodeURIComponent(sahipNo)}&query_type=sahip&source=${encodeURIComponent(window.location.origin)}`;
    
    console.log('[DEBUG] TÜRKPATENT URL açılıyor:', turkPatentUrl);
    
    // Yeni sekme aç
    const newWindow = window.open(turkPatentUrl, '_blank');
    
    if (newWindow) {
      showNotification('TÜRKPATENT sayfası açıldı. Eklenti çalışacak ve sonuçları gönderecek.', 'info');
      
      // Timeout
      setTimeout(() => {
        _hideBlock(loadingEl);
      }, 45000);
      
    } else {
      _hideBlock(loadingEl);
      showNotification('Pop-up engellendi. Tarayıcı ayarlarından pop-up\'ları açın.', 'danger');
    }

  } catch (err) {
    _hideBlock(loadingEl);
    console.error('[DEBUG] Sahip numarası sorgulama hatası:', err);
    showNotification('İşlem hatası: ' + (err.message || err), 'danger');
  }
}

// ===============================
// OTOMATİK SAHİP EŞLEŞTİRME
// ===============================

function autoMatchOwnerByTpeNo(searchedTpeNo) {
  console.log('[DEBUG] 🔍 Otomatik sahip eşleştirme başladı:', searchedTpeNo);
  console.log('[DEBUG] allPersons sayısı:', allPersons?.length || 0);
  console.log('[DEBUG] selectedRelatedParties mevcut:', selectedRelatedParties?.length || 0);
  
  if (!searchedTpeNo) {
    console.log('[DEBUG] ❌ Sahip no boş');
    return;
  }
  
  if (!allPersons?.length) {
    console.log('[DEBUG] ❌ Kişi listesi boş veya yüklenmemiş');
    showNotification('Kişi listesi henüz yüklenmemiş. Lütfen bekleyin.', 'warning');
    return;
  }
  
  console.log('[DEBUG] Kişi listesindeki TPE No\'lar:', allPersons.map(p => ({
    name: p.name,
    tpeNo: p.tpeNo,
    type: typeof p.tpeNo
  })));
  
  // TPE No ile eşleşen kişi ara
  const matchedPerson = allPersons.find(person => {
    const personTpeNo = String(person.tpeNo || '').trim();
    const searchTpeNo = String(searchedTpeNo || window.searchedOwnerNumber || '').trim();
    
    console.log(`[DEBUG] Karşılaştırma: "${personTpeNo}" === "${searchTpeNo}"`);
    
    return personTpeNo && searchTpeNo && personTpeNo === searchTpeNo;
  });
  
  console.log('[DEBUG] Eşleşen kişi:', matchedPerson || 'Bulunamadı');
  
  if (matchedPerson) {
    console.log('[DEBUG] ✅ Eşleşen kişi bulundu:', matchedPerson.name, 'TPE No:', matchedPerson.tpeNo);
    
    const alreadyAdded = selectedRelatedParties.find(p => p.id === matchedPerson.id);
    
    if (!alreadyAdded) {
      selectedRelatedParties.push({
        id: matchedPerson.id,
        name: matchedPerson.name,
        email: matchedPerson.email || '',
        phone: matchedPerson.phone || '',
        tpeNo: matchedPerson.tpeNo || ''
      });
      
      renderSelectedRelatedParties();
      showNotification(`✅ ${matchedPerson.name} otomatik olarak sahip listesine eklendi`, 'success');
      console.log('[DEBUG] ✅ Kişi sahip listesine eklendi');
    } else {
      console.log('[DEBUG] ⚠️ Kişi zaten listede mevcut');
      showNotification(`${matchedPerson.name} zaten sahip listesinde`, 'info');
    }
  } else {
    console.log('[DEBUG] ❌ Bu TPE No ile eşleşen kişi bulunamadı');
  }
}

// ===============================
// EKLENTİ MESAJ DİNLEYİCİSİ
// ===============================


// === Auto add owner helper ===
function tryAutoAddOwner(searchedTpeNo) {
  try {
    if (!Array.isArray(allPersons) || !allPersons.length) {
      console.log('[DEBUG] ❌ Kişi listesi boş veya yüklenmemiş');
      showNotification('Kişi listesi henüz yüklenmemiş. Lütfen bekleyin.', 'warning');
      return;
    }
    const searchTpeNo = String(searchedTpeNo || window.searchedOwnerNumber || '').trim();
    console.log('[DEBUG] AutoAddOwner - aranan TPE No:', searchTpeNo);
    const matchedPerson = allPersons.find(p => String(p.tpeNo || '').trim() === searchTpeNo);
    console.log('[DEBUG] AutoAddOwner - eşleşen kişi:', matchedPerson || 'Bulunamadı');
    if (matchedPerson) {
      const already = selectedRelatedParties.find(x => x.id === matchedPerson.id);
      if (!already) {
        selectedRelatedParties.push({
          id: matchedPerson.id,
          name: matchedPerson.name,
          email: matchedPerson.email || '',
          phone: matchedPerson.phone || '',
          tpeNo: matchedPerson.tpeNo || ''
        });
        renderSelectedRelatedParties();
        showNotification(`✅ ${matchedPerson.name} otomatik olarak sahip listesine eklendi`, 'success');
      } else {
        showNotification(`${matchedPerson.name} zaten sahip listesinde`, 'info');
      }
    }
  } catch (err) {
    console.warn('tryAutoAddOwner error:', err);
  }
}

function setupExtensionMessageListener() {
  console.log('[DEBUG] Eklenti mesaj dinleyicisi kuruluyor...');
  
  // Global batch state - temizle
  window.batchResults = [];
  window.batchProgress = null;
  
  window.addEventListener('message', (event) => {
    const allowedOrigins = [
      window.location.origin,
      'https://www.turkpatent.gov.tr',
      'https://turkpatent.gov.tr',
      'https://opts.turkpatent.gov.tr'
    ];
    
    if (!allowedOrigins.includes(event.origin)) return;
    
    // İki source'u da kabul et (geriye uyumluluk)
    const validSources = ['tp-extension-sahip', 'tp-sorgu-eklentisi-2'];
    const isValidSource = event.data && validSources.includes(event.data.source);
    
    if (isValidSource) {
      console.log('[DEBUG] Eklenti mesajı alındı:', event.data);
      
      if (event.data.type === 'SORGU_BASLADI') {
        console.log('[DEBUG] Eklenti sorguyu başlattı');
        if (window.currentLoading) {
          window.currentLoading.updateText('Sorgu çalıştırılıyor', 'Sonuçlar yükleniyor...');
        }
        showNotification('TÜRKPATENT sayfasında sorgu başladı...', 'info');
      }
      
      else if (event.data.type === 'BATCH_VERI_GELDI_KISI') {
        window.isProgressiveMode = true; // progressive mode aktif
        // YENİ: Progressive batch loading
        const { batch, batchNumber, totalBatches, processedCount, totalCount, isComplete } = event.data.data;
        
        console.log(`[DEBUG] Batch ${batchNumber}/${totalBatches} alındı: ${batch.length} kayıt`);
        
        // Duplicate kontrolü ile batch'i ekle
        batch.forEach(item => {
          const exists = window.batchResults.some(existing => 
            existing.applicationNumber && 
            existing.applicationNumber === item.applicationNumber
          );
          if (!exists) {
            window.batchResults.push(item);
          }
        });
        
        // Loading güncelle
        if (window.currentLoading) {
          const progress = Math.round((processedCount / totalCount) * 100);
          window.currentLoading.updateText(
            `Veriler işleniyor (${progress}%)`,
            `${processedCount}/${totalCount} kayıt işlendi - Batch ${batchNumber}/${totalBatches}`
          );
        }
        
        // İlk batch geldiğinde tabloyu başlat, sonrakiler için append
        /* Progressive batch: always re-render full list to avoid missing rows */
        renderOwnerResults(window.batchResults);
        try { setupCheckboxListeners(); updateSaveButton(); } catch (e) { console.warn('listeners refresh failed', e); }
        
        showNotification(`Batch ${batchNumber}/${totalBatches} yüklendi`, 'info');
        
        // Son batch ise complete olarak işaretle
        if (isComplete) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('message', {
              detail: {
                origin: event.origin,
                data: {
                  source: 'tp-extension-sahip',
                  type: 'VERI_GELDI_KISI_COMPLETE',
                  data: { totalProcessed: window.batchResults.length }
                }
              }
            }));
          }, 500);
        }
      }
      
      else if (event.data.type === 'VERI_GELDI_KISI_COMPLETE') {
        // Tüm process tamamlandı - SADECE EVENT LISTENERS GÜNCELLE
        console.log('[DEBUG] Tüm batch işlemi tamamlandı');
        
        if (window.currentLoading) {
          window.currentLoading.showSuccess(`${window.batchResults.length} kayıt başarıyla yüklendi!`);
          window.currentLoading = null;
        }
        
        showNotification(`Tüm veriler yüklendi: ${window.batchResults.length} kayıt`, 'success');
        
        // SADECE event listeners'ı güncelle, tekrar render etme
        currentOwnerResults = window.batchResults;
        setupCheckboxListeners();
        updateSaveButton();
      }
      
      else if (event.data.type === 'VERI_GELDI_KISI') {
        // Eğer progressive mod aktifse, legacy mesajı yok say
        if (window.isProgressiveMode) { console.log('[DEBUG] Legacy VERI_GELDI_KISI progressive modda yok sayıldı'); return; }
        // Eski format - geriye uyumluluk - TEK RENDER
        _hideBlock(loadingEl);
        const data = event.data.data || [];
        
        if (window.currentLoading) {
          window.currentLoading.updateText('Veriler işleniyor', 'Sonuçlar hazırlanıyor...');
        }
        
        if (!data.length) {
          if (window.currentLoading) {
            window.currentLoading.showError('Bu sahip numarası için sonuç bulunamadı.');
            window.currentLoading = null;
          }
          showNotification('Bu sahip numarası için sonuç bulunamadı.', 'warning');
        } else {
          // TEK SEFER RENDER - başka render çağrısı YOK
          renderOwnerResults(data);
          
          try { if (window.searchedOwnerNumber) { tryAutoAddOwner(window.searchedOwnerNumber); } } catch (e) { console.warn('Owner autofill failed:', e); }
          if (window.currentLoading) {
            window.currentLoading.showSuccess(`${data.length} kayıt başarıyla alındı!`);
            window.currentLoading = null;
          }
          showNotification(`${data.length} kayıt başarıyla alındı.`, 'success');
        }
      } 
      
      else if (event.data.type === 'HATA_KISI') {
        _hideBlock(loadingEl);
        const errorMsg = event.data.data?.message || 'Bilinmeyen Hata';
        
        if (window.currentLoading) {
          window.currentLoading.showError('Eklenti hatası: ' + errorMsg);
          window.currentLoading = null;
        }
        showNotification('Eklenti hatası: ' + errorMsg, 'danger');
        
        // Batch state'i temizle
        window.batchResults = [];
      }
      
      else if (event.data.type === 'VERI_GELDI_BASVURU') {
        _hideBlock(loadingEl);
        window.skipScrapeTrademark = false;
        const data = event.data.data;
        
        // DEBUG: Veri yapısını kontrol et
        console.log('[DEBUG] VERI_GELDI_BASVURU - data yapısı:', data);
        if (data && data.length > 0) {
          console.log('[DEBUG] data[0] yapısı:', data[0]);
          console.log('[DEBUG] data[0] keys:', Object.keys(data[0]));
        }

        if (!data || !data.length) {
          if (window.currentLoading) {
            window.currentLoading.showError('Bu başvuru numarası için sonuç bulunamadı.');
            window.currentLoading = null;
          }
          showNotification('Bu başvuru numarası için sonuç bulunamadı.', 'warning');
        } else {
          // Başvuru numarası verilerini zenginleştir
          const enrichedData = data.map(item => {
            // renewalDate hesapla
            let renewalDate = null;
            
            // Koruma tarihi varsa + 10 yıl
            if (item.details && item.details['Koruma Tarihi']) {
              const korumaDateStr = item.details['Koruma Tarihi'];
              const korumaDate = parseDate(korumaDateStr); // DD.MM.YYYY -> Date
              if (korumaDate) {
                const renewal = new Date(korumaDate);
                renewal.setFullYear(renewal.getFullYear() + 10);
                renewalDate = renewal.toISOString().split('T')[0]; // YYYY-MM-DD format
              }
            }
            
            // Tescil tarihi varsa + 10 yıl (koruma tarihi yoksa)
            if (!renewalDate && item.registrationDate) {
              const regDate = new Date(item.registrationDate);
              if (!isNaN(regDate.getTime())) {
                const renewal = new Date(regDate);
                renewal.setFullYear(renewal.getFullYear() + 10);
                renewalDate = renewal.toISOString().split('T')[0];
              }
            }
            
            return {
              ...item,
              renewalDate: renewalDate
            };
          });
          
          // Tek sonuç için renderSingleResult kullan
          renderSingleResult(enrichedData[0]);
          
          if (window.currentLoading) {
            window.currentLoading.showSuccess('Başvuru numarası sonucu başarıyla alındı!');
            window.currentLoading = null;
          }
          showNotification('Başvuru numarası sonucu başarıyla alındı.', 'success');
        }
      } 
      
      else if (event.data.type === 'HATA_BASVURU') {
        _hideBlock(loadingEl);
        window.skipScrapeTrademark = false;
        const errorMsg = event.data.data?.message || 'Başvuru numarası sorgulama hatası';
        
        if (window.currentLoading) {
          window.currentLoading.showError(errorMsg);
          window.currentLoading = null;
        }
        showNotification(errorMsg, 'danger');
      }

      else if (event.data.type === 'VERI_GELDI_OPTS') {
        console.log('[DEBUG] OPTS verisi işleniyor...');
        const data = event.data.data;
        handleOptsSuccess(data);
      }
    }
  });
  
  console.log('[DEBUG] ✅ Eklenti mesaj dinleyicisi kuruldu.');
}

// Yardımcı fonksiyon - tablo sayacını güncelle
function updateTableRowCount() {
  const bulkMeta = document.getElementById('bulkMeta');
  if (bulkMeta && currentOwnerResults?.length) {
    bulkMeta.textContent = `(${currentOwnerResults.length} kayıt)`;
  }
}

// ===============================
// RENDER FONKSİYONLARI
// ===============================

function renderSingleResult(payload) {
  console.log('[DEBUG] renderSingleResult çağrıldı, payload:', payload);
  
  // Payload normalize et
  let d;
  if (payload.data && typeof payload.data === 'object') {
    d = payload.data;
  } else {
    d = payload;
  }
  
  console.log('[DEBUG] renderSingleResult - parsed d:', d);
  
  // Tek sonucu da tablo formatında göster
  renderOwnerResults([d]);
  
  // Sonuç container'ı göster
  _showBlock(singleResultContainer);
  _hideBlock(loadingEl);
}

function renderOwnerResults(items) {
  if (!items?.length) return;
  
  // 👇👇👇 [DEBUG LOGLAMA BAŞLANGICI] 👇👇👇
  console.log('🛑 [DEBUG ANALİZİ] 🛑');
  try {
      const firstItem = items[0];
      
      // 1. Vekil verisi gelmiş mi?
      console.log('👉 [1] Backend\'den Gelen Vekil Verisi:', 
          firstItem.attorneyName ? `"${firstItem.attorneyName}"` : 
          firstItem.agentInfo ? `"${firstItem.agentInfo}"` : '(BOŞ/UNDEFINED)');
      
      // 2. Ham veri (varsa) ne durumda?
      if (firstItem._debugRaw) {
          console.log('👉 [2] Satırın Ham İçeriği (Colon Ayracı: | ):');
          console.log(firstItem._debugRaw);
          console.log('💡 İPUCU: Ham içerikte vekil adı görüyorsanız ancak [1]\'de (BOŞ) yazıyorsa, backend tarafındaki kolon indeksi (get(8)) yanlıştır.');
      } else {
          console.log('👉 [2] Ham veri (_debugRaw) bulunamadı. Backend güncellemesi deploy edilmemiş olabilir.');
      }
  } catch (err) {
      console.error('Debug sırasında hata:', err);
  }
  // 👆👆👆 [DEBUG LOGLAMA BİTİŞİ] 👆👆👆

  console.log('🔄 renderOwnerResults başladı:', items.length, 'kayıt');
  const startTime = performance.now();
  
  // Sahip bilgisini hızlıca bul
  const ownerRecord = items.find(item => item.ownerName?.trim());
  const ownerInfo = ownerRecord ? ` - Sahip: ${ownerRecord.ownerName}` : '';

  // Fragment kullanarak hızlı DOM oluşturma
  const container = document.createElement('div');
  container.className = 'section-card';
  
  // Header kısmı
  const header = document.createElement('div');
  header.className = 'results-header d-flex justify-content-between align-items-center mb-3';
  header.innerHTML = `
    <div><strong>${items.length} sonuç bulundu${ownerInfo}</strong> <small class="text-muted" id="bulkMeta"></small></div>
    <div>
      <button id="exportCsvBtn" class="btn btn-outline-primary btn-sm"><i class="fas fa-file-csv mr-1"></i> CSV Dışa Aktar</button>
    </div>
  `;
  
  // Tablo wrapper
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-responsive';
  
  // Tablo ve header
  const table = document.createElement('table');
  table.className = 'table table-hover table-striped tp-results-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th><input type="checkbox" id="selectAllRecords" checked></th>
        <th>Görsel</th>
        <th>Başvuru Numarası</th>
        <th>Marka Adı</th>
        <th>Başvuru Tarihi</th>
        <th>Tescil No</th>
        <th>Durumu</th>
        <th>Nice Sınıfları</th>
        <th>Vekil</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  
  // Array.map ile hızlı row oluşturma
  const rows = items.map((item, i) => {
    const imgSrc = item.brandImageDataUrl || item.brandImageUrl || item.imageSrc;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${i}" checked></td>
      <td>${imgSrc ? `<img src="${imgSrc}" alt="" style="height:56px;max-width:120px;border:1px solid #eee;border-radius:6px;" />` : ''}</td>
      <td>${item.applicationNumber || ''}</td>
      <td>${item.brandName || ''}</td>
      <td>${fmtDateToTR(item.applicationDate || '')}</td>
      <td>${item.registrationNumber || ''}</td>
      <td>${item.status || ''}</td>
      <td>${item.niceClasses || ''}</td>
      <td style="font-size: 0.9em; color: #666;">${item.attorneyName || item.agentInfo || '-'}</td>
    `;
    
    return row;
  });
  
  // Batch DOM insertion (DocumentFragment kullan)
  const fragment = document.createDocumentFragment();
  rows.forEach(row => fragment.appendChild(row));
  tbody.appendChild(fragment);
  
  // Assembly
  tableWrapper.appendChild(table);
  container.appendChild(header);
  container.appendChild(tableWrapper);
  
  // Global değişkene kaydet
  currentOwnerResults = items;

  // Single DOM manipulation
  singleResultInner.innerHTML = '';
  singleResultInner.appendChild(container);
  _showBlock(singleResultContainer);
  
  const endTime = performance.now();
  console.log(`✅ renderOwnerResults tamamlandı: ${(endTime - startTime).toFixed(2)}ms`);
  
  // ✅ SONUÇLAR RENDER EDİLDİKTEN SONRA SAHİP EŞLEŞTİRME
  if (window.searchedOwnerNumber) {
    console.log('[DEBUG] UI hazır, şimdi sahip eşleştirme yapılıyor...');
    setTimeout(() => {
      autoMatchOwnerByTpeNo(window.searchedOwnerNumber);
      window.searchedOwnerNumber = null; // Temizle
    }, 100); // UI'ın tam yüklenmesi için kısa bekleme
  }
  
  // Event listeners - requestAnimationFrame ile asenkron yap
  requestAnimationFrame(() => {
    setupCheckboxListeners();
    updateSaveButton();
    
    // CSV export event listener
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportOwnerResultsCSV);
    }
  });
}

function setupCheckboxListeners() {
  const selectAll = document.getElementById('selectAllRecords');
  const checkboxes = document.querySelectorAll('.record-checkbox');
  
  if (!selectAll || !checkboxes.length) return;
  
  // Event delegation kullan (daha performanslı)
  const handleChange = (e) => {
    if (e.target.id === 'selectAllRecords') {
      const checked = e.target.checked;
      checkboxes.forEach(cb => cb.checked = checked);
    } else if (e.target.classList.contains('record-checkbox')) {
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      const noneChecked = Array.from(checkboxes).every(c => !c.checked);
      
      selectAll.checked = allChecked;
      selectAll.indeterminate = !allChecked && !noneChecked;
    }
    
    updateSaveButton();
  };
  
  // Single event listener
  document.addEventListener('change', handleChange);
}

function updateSaveButton() {
  const saveBtn = document.getElementById('savePortfolioBtn');
  if (!saveBtn) return;
  
  const checkedCount = document.querySelectorAll('.record-checkbox:checked').length;
  saveBtn.disabled = checkedCount === 0;
}


// CSV Export fonksiyonu
function exportOwnerResultsCSV() {
  if (!currentOwnerResults?.length) {
    showNotification('Dışa aktarılacak veri yok.', 'warning');
    return;
  }
  
  // Worker kullanmadan hızlı CSV oluşturma
  const headers = ['Sıra','Başvuru Numarası','Marka Adı','Marka Sahibi','Başvuru Tarihi','Tescil No','Durumu','Nice Sınıfları','Görsel'];
  
  // Array.map ile hızlı dönüşüm
  const csvContent = [
    headers.join(','),
    ...currentOwnerResults.map((x, i) => [
      i+1,
      x.applicationNumber || '',
      x.brandName || '',
      x.ownerName || '',
      fmtDateToTR(x.applicationDate || ''),
      x.registrationNumber || '',
      x.status || '',
      x.niceClasses || '',
      (x.brandImageDataUrl || x.brandImageUrl || x.imageSrc) ? 'VAR' : ''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
  ].join('\n');
  
  // Blob ve download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turkpatent_sahip_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showNotification('CSV dosyası indirildi.', 'success');
}

// ===============================
// KİŞİ YÖNETİMİ FONKSİYONLARI
// ===============================

function searchPersons(searchQuery) {
  if (!searchQuery || searchQuery.length < 2) return;
  
  const filtered = allPersons.filter(person => {
    const name = (person.name || '').toLowerCase();
    const tpeNo = (person.tpeNo || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || tpeNo.includes(query);
  }).slice(0, 10);

  if (!filtered.length) {
    relatedPartySearchResults.innerHTML = '<div class="search-result-item">Sonuç bulunamadı</div>';
  } else {
    relatedPartySearchResults.innerHTML = filtered.map(person => 
      `<div class="search-result-item" data-id="${person.id}">
        <strong>${person.name}</strong>
        ${person.tpeNo ? `<br><small class="text-muted">TPE No: ${person.tpeNo}</small>` : ''}
      </div>`
    ).join('');
  }
  
  _showBlock(relatedPartySearchResults);
}

function addRelatedParty(person) {
  if (selectedRelatedParties.find(p => p.id === person.id)) {
    showNotification('Bu kişi zaten eklenmiş.', 'warning');
    return;
  }
  selectedRelatedParties.push(person);
  renderSelectedRelatedParties();
}

function removeRelatedParty(personId) {
  selectedRelatedParties = selectedRelatedParties.filter(p => p.id !== personId);
  renderSelectedRelatedParties();
}

function renderSelectedRelatedParties() {
  const list = _el('relatedPartyList');
  const countEl = _el('relatedPartyCount');

  if (!list) return;

  if (selectedRelatedParties.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <i class="fas fa-user-friends fa-3x text-muted mb-3"></i>
      <p class="text-muted">Henüz taraf eklenmedi.</p>
    </div>`;
  } else {
    list.innerHTML = selectedRelatedParties.map(p =>
      `<div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
        <span>${p.name} <small class="text-muted">TPE No: ${p.tpeNo || ''}</small></span>
        <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${p.id}">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>`
    ).join('');
  }

  if (countEl) countEl.textContent = selectedRelatedParties.length;
}

// EKLE: tp-file-transfer.js'e
function appendBatchToTable(batchItems) {
  const tbody = document.querySelector('.tp-results-table tbody');
  if (!tbody) return;
  
  const startIndex = window.batchResults.length - batchItems.length;
  
  const fragment = document.createDocumentFragment();
  
  batchItems.forEach((item, localIdx) => {
    const globalIdx = startIndex + localIdx;
    const imgSrc = item.brandImageDataUrl || item.brandImageUrl || item.imageSrc;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="record-checkbox" data-index="${globalIdx}" checked></td>
      <td>${imgSrc ? `<img src="${imgSrc}" alt="" style="height:56px;max-width:120px;border:1px solid #eee;border-radius:6px;" />` : ''}</td>
      <td>${item.applicationNumber || ''}</td>
      <td>${item.brandName || ''}</td>
      <td>${fmtDateToTR(item.applicationDate || '')}</td>
      <td>${item.registrationNumber || ''}</td>
      <td>${item.status || ''}</td>
      <td>${item.niceClasses || ''}</td>
      <td>${item.attorneyName || item.agentInfo || ''}</td>
    `;
    
    fragment.appendChild(row);
  });
  
  tbody.appendChild(fragment);
  
  // Sonuç sayısını güncelle
  const resultsHeader = document.querySelector('.results-header strong');
  if (resultsHeader) {
    resultsHeader.textContent = `${window.batchResults.length} sonuç bulundu`;
  }
}

// ===============================
// SAYFA YÜKLENDİĞİNDE BAŞLAT
// ===============================

document.addEventListener('DOMContentLoaded', () => {
  loadSharedLayout();
  init();
});
