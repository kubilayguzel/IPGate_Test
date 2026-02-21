// Firebase imports for image upload
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { app } from '../firebase-config.js';

// Initialize Firebase Storage
const storage = getStorage(app);

/**
 * Normalize helpers
 */
function normalizeText(v) {
  return (v || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseDDMMYYYYToISO(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
  const m = (s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function formatDate(dateStr) {
  return parseDDMMYYYYToISO(dateStr);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/**
 * Transactions'tan durum türetme: öncelik sırası -> rejected > registered > pending > null
 */
function deriveStatusFromTransactions(transactions) {
  if (!Array.isArray(transactions)) return null;
  const txt = transactions.map(t => (t?.description || '') + ' ' + (t?.note || '')).join(' ').toLowerCase();
  if (!txt) return null;
  if (/(geçersiz|başvuru\/tescil\s*geçersiz|iptal|hükümsüz|red|redded)/i.test(txt)) return 'rejected';
  if (/tescil edildi|tescil\b/i.test(txt) && !/(iptal|hükümsüz|geçersiz)/i.test(txt)) return 'registered';
  if (/başvuru|yayın/i.test(txt)) return 'pending';
  return null;
}

/**
 * TÜRKPATENT durumu mapping
 */
export function mapStatusToUtils(turkpatentStatus) {
  if (!turkpatentStatus) return null;
  const s = turkpatentStatus.toString().trim();
  
  // Sadece geçersiz durumu kontrol et
  if (/GEÇERSİZ/i.test(s)) {
    return 'rejected';
  }
  return null;
}

/**
 * Görseli Firebase Storage'a yükler
 */
async function uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc) {
  const imageUrl = brandImageDataUrl || imageSrc;
  if (!imageUrl || !applicationNumber) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
    const fileName = `${applicationNumber}_${Date.now()}.${ext}`;

    const storageRef = ref(storage, `brand-examples/${fileName}`);
    const snapshot = await uploadBytes(storageRef, blob, {
      contentType: blob.type || 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable'
    });

    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    console.error('Görsel upload hatası:', error);
    return null;
  }
}

/**
 * Nice sınıflarını string'ten parse eder
 */
function parseNiceClasses(niceClassesStr) {
  if (!niceClassesStr) return [];
  const nums = niceClassesStr
    .toString()
    .split(/[,;\s]+/)
    .map(n => parseInt(String(n).trim(), 10))
    .filter(n => !Number.isNaN(n) && n > 0 && n <= 45);
  return uniq(nums);
}

/**
 * Bülten bilgilerini üretir (Hem Details hem Transactions'dan)
 */
function createBulletins(details, transactions) {
  const out = [];

  const get = (k) => details?.[k] ?? null;
  
  // 1. Details alanından kontrol
  const bNo =
    get('Bülten Numarası') || get('Bülten No') || get('Bülten') ||
    get('Bulletin Number') || get('Bulletin No') || 
    get('Marka İlan Bülten No') || null;
    
  const bDate =
    get('Bülten Tarihi') || get('Yayım Tarihi') ||
    get('Bulletin Date') || 
    get('Marka İlan Bülten Tarihi') || null;

  if (bNo || bDate) {
    out.push({
      bulletinNo: bNo || null,
      bulletinDate: formatDate(bDate)
    });
  }

  // 2. Transactions içinden Regex ile yakalama
  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      const desc = normalizeText(tx?.description);
      // Örnek: "Marka İlan Bülten No: 400" veya "Bülten No: 2024/34"
      const m = (tx?.description || '').match(/(?:bülten|bulletin)\s*(?:no|numarası)?\s*[:\-]?\s*([0-9/]+)/i);
      if (m) {
        out.push({
          bulletinNo: m[1],
          bulletinDate: formatDate(tx?.date) || null
        });
      }
    }
  }

  // Aynı numaraları tekille
  const uniqueMap = new Map();
  for (const b of out) {
    // Key: No + Date
    const key = `${b.bulletinNo || ''}_${b.bulletinDate || ''}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, b);
    }
  }
  return Array.from(uniqueMap.values());
}

/**
 * goodsAndServicesByClass üretimi
 */
function createGoodsAndServicesByClass(inputGSC, niceClassesStr, details) {
  // 1. Modal/Scraper'dan gelen hazır yapı varsa kullan (En güveniliri)
  if (Array.isArray(inputGSC) && inputGSC.length > 0) {
    const groupedByClass = new Map();
    
    inputGSC.forEach(entry => {
      const classNo = Number(entry.classNo);
      // Items string de gelebilir array de. Array yapalım.
      let items = [];
      if (Array.isArray(entry.items)) {
        items = entry.items;
      } else if (typeof entry.items === 'string') {
        items = [entry.items];
      }

      if (!groupedByClass.has(classNo)) {
        groupedByClass.set(classNo, []);
      }
      
      // Items içindeki maddeleri temizle ve ekle
      const splitItems = items.flatMap(item => item.split(/[\n.]/).map(s => s.trim()).filter(Boolean));
      groupedByClass.get(classNo).push(...splitItems);
    });
    
    return Array.from(groupedByClass.entries())
      .map(([classNo, items]) => ({
        classNo,
        items: [...new Set(items)] // Tekrar edenleri temizle
      }))
      .sort((a, b) => a.classNo - b.classNo);
  }

  // 2. Alternatif: Details ve String parse etme
  const niceNums =
    parseNiceClasses(niceClassesStr) ||
    parseNiceClasses(details?.['Nice Sınıfları']);

  const goodsText =
    details?.['Mal/Hizmet Listesi'] ||
    details?.['Mal ve Hizmetler'] ||
    details?.['Mal ve Hizmetler Listesi'] ||
    details?.['Eşya Listesi'] ||
    '';

  if (!Array.isArray(niceNums) || niceNums.length === 0) {
    return [];
  }
  
  // Metin yoksa boş döndür
  if (!goodsText) {
    return niceNums.map(classNo => ({ classNo, items: [] }));
  }

  // Metin var ama sınıf ayrımı yapılamıyorsa boş items dön
  return niceNums.map(classNo => ({
    classNo,
    items: [] 
  }));
}

/**
 * oldTransactions formatlama
 */
function createOldTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  return transactions.map(tx => ({
    date: formatDate(tx?.date),
    description: tx?.description || tx?.action || null, // 'action' alanı da kontrol ediliyor
    note: tx?.note || null,
    source: 'turkpatent_scrape',
    createdAt: new Date().toISOString()
  }));
}

/**
 * ANA MAPPING FONKSİYONU
 */
export async function mapTurkpatentToIPRecord(turkpatentData, selectedApplicants = []) {
  const {
    order,
    applicationNumber,
    brandName,
    ownerName,
    applicationDate,
    registrationNumber,
    status,
    niceClasses,
    brandImageDataUrl,
    imageSrc,
    details = {},
    goodsAndServicesByClass,
    transactions: rootTransactions // Ana objeden gelen transactions
  } = turkpatentData || {};

  // Transactions hem root'ta hem details içinde olabilir. Birleştirip sağlam alalım.
  const transactions = (Array.isArray(rootTransactions) && rootTransactions.length > 0) 
    ? rootTransactions 
    : (details.transactions || []);

  // Görsel Upload
  const brandImageUrl = await uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc);

  // ---------------------------------------------------------
  // ADIM 1: TESCİL TARİHİNİ BUL (GÜÇLENDİRİLMİŞ)
  // ---------------------------------------------------------
  let registrationDate = null;
  
  // 1. Ana objede var mı? (Bazı scrape yöntemlerinde root'a yazılır)
  if (turkpatentData.registrationDate) {
    registrationDate = formatDate(turkpatentData.registrationDate);
  }
  
  // 2. Details içinde var mı?
  if (!registrationDate && details?.['Tescil Tarihi']) {
    registrationDate = formatDate(details['Tescil Tarihi']);
  }
  
  // 3. Transactions içinde var mı?
  if (!registrationDate && Array.isArray(transactions)) {
    const registrationTx = transactions.find(tx => 
      (tx?.description || tx?.action || '').toUpperCase().includes('TESCİL EDİLDİ')
    );
    if (registrationTx?.date) {
      registrationDate = formatDate(registrationTx.date);
    }
  }

  // ---------------------------------------------------------
  // ADIM 2: YENİLEME TARİHİNİ HESAPLA
  // ---------------------------------------------------------
  let calculatedRenewalDate = null;
  
  // (A) Doğrudan veri varsa
  try {
    const topLevelRenewal = turkpatentData?.renewalDate || details?.['Yenileme Tarihi'] || details?.['Renewal Date'];
    if (topLevelRenewal) {
      const d = new Date(formatDate(topLevelRenewal) || topLevelRenewal);
      if (!isNaN(d.getTime())) calculatedRenewalDate = d.toISOString().split('T')[0];
    }
  } catch (e) { console.warn('renewalDate parse error:', e); }

  // (B) Yoksa Koruma Tarihi + 10 Yıl
  if (!calculatedRenewalDate && details?.['Koruma Tarihi']) {
    const kd = formatDate(details['Koruma Tarihi']);
    if (kd) {
      const d = new Date(kd);
      if (!isNaN(d.getTime())) {
        d.setFullYear(d.getFullYear() + 10);
        calculatedRenewalDate = d.toISOString().split('T')[0];
      }
    }
  }

  // (C) Yoksa Tescil Tarihi + 10 Yıl
  if (!calculatedRenewalDate && registrationDate) {
    const d = new Date(registrationDate);
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + 10);
      calculatedRenewalDate = d.toISOString().split('T')[0];
    }
  }

  // (D) Yoksa Başvuru Tarihi + 10 Yıl
  if (!calculatedRenewalDate && applicationDate) {
    const ad = new Date(formatDate(applicationDate) || applicationDate);
    if (!isNaN(ad.getTime())) {
      ad.setFullYear(ad.getFullYear() + 10);
      calculatedRenewalDate = ad.toISOString().split('T')[0]; // Düzeltildi: 'd' yerine 'ad'
    }
  }

  // ---------------------------------------------------------
  // ADIM 3: STATÜ BELİRLEME
  // ---------------------------------------------------------
  let turkpatentStatusText = details?.['Durumu'] || details?.['Status'] || details?.['Durum'] || status;

  // Transaction'dan statü tahmini
  if (!turkpatentStatusText && Array.isArray(transactions) && transactions.length > 0) {
    const lastTransaction = transactions[transactions.length - 1];
    const desc = (lastTransaction?.description || lastTransaction?.action || '').toUpperCase();
    if (desc.includes('BAŞVURU/TESCİL GEÇERSİZ') || desc.includes('GEÇERSİZ')) {
      turkpatentStatusText = 'MARKA BAŞVURUSU/TESCİLİ GEÇERSİZ';
    }
  }

  // A) Geçersiz/Red durumu
  let finalStatus = mapStatusToUtils(turkpatentStatusText); 

  // B) Tescilli durumu
  if (!finalStatus && registrationDate && calculatedRenewalDate) {
    const renewalDateObj = new Date(calculatedRenewalDate);
    const gracePeriodEnd = new Date(renewalDateObj);
    gracePeriodEnd.setMonth(gracePeriodEnd.getMonth() + 6); 
    
    const today = new Date();
    if (today < gracePeriodEnd) {
      finalStatus = 'registered'; 
    }
  }

  // C) Varsayılan: Başvuru
  if (!finalStatus) {
    finalStatus = 'filed';
  }

  // ---------------------------------------------------------
  // ADIM 4: KAYIT OBJESİNİ OLUŞTUR
  // ---------------------------------------------------------
  
  const ipRecord = {
    // Temel kimlik
    title: brandName || 'Başlıksız Marka',
    type: 'trademark',
    portfoyStatus: 'active',
    origin: 'TÜRKPATENT',

    // Durum
    status: finalStatus,
    recordOwnerType: 'self',

    // Başvuru/Tescil
    applicationNumber: applicationNumber || null,
    applicationDate: formatDate(applicationDate),
    registrationNumber: registrationNumber || details?.['Tescil Numarası'] || null,
    registrationDate: registrationDate,
    
    // Yenileme Tarihi
    renewalDate: calculatedRenewalDate,

    // Marka bilgileri
    brandText: brandName || '',
    brandImageUrl: brandImageUrl,
    description: details?.['Açıklama'] || null,
    brandType: details?.['Marka Türü'] || 'Şekil + Kelime',
    brandCategory: details?.['Marka Kategorisi'] || 'Ticaret/Hizmet Markası',
    nonLatinAlphabet: details?.['Latin Olmayan Alfabe'] || null,

    // Sınıflar ve MH listesi (İyileştirilmiş)
    goodsAndServicesByClass: createGoodsAndServicesByClass(
      goodsAndServicesByClass,
      niceClasses,
      details
    ),

    // Bültenler (Düzeltildi: Artık createBulletins kullanılıyor)
    bulletins: createBulletins(details, transactions),

    // Rüçhan (varsa)
    priorities: (() => {
      const p = [];
      const pd = details?.['Öncelik Tarihi'];
      const pn = details?.['Öncelik Numarası'];
      const pc = details?.['Öncelik Ülkesi'];
      if (pd || pn) {
        p.push({
          priorityDate: formatDate(pd),
          priorityNumber: pn || null,
          priorityCountry: pc || null
        });
      }
      return p;
    })(),

    // Başvuru sahipleri
    applicants: Array.isArray(selectedApplicants)
      ? selectedApplicants.map(a => ({ id: a.id, email: a.email || null }))
      : [],

    // İşlem geçmişi (Düzeltildi: transactions kaynağı birleştirildi)
    oldTransactions: (() => {
        console.log('[MAPPER] İşlem geçmişi dönüştürülüyor. Gelen veri:', transactions);
        const mappedTx = createOldTransactions(transactions);
        console.log('[MAPPER] Dönüştürülen işlemler:', mappedTx);
        return mappedTx;
    })(),


    // Diğer
    consentRequest: null,
    coverLetterRequest: null,

    // Zaman damgaları
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return ipRecord;
}

/**
 * Liste mapper
 */
export async function mapTurkpatentResultsToIPRecords(turkpatentResults, selectedApplicants) {
  if (!Array.isArray(turkpatentResults)) {
    console.error('turkpatentResults array olmalı');
    return [];
  }
  const out = [];
  for (let i = 0; i < turkpatentResults.length; i++) {
    const row = turkpatentResults[i];
    try {
      const rec = await mapTurkpatentToIPRecord(row, selectedApplicants);
      rec.tempId = `turkpatent_${Date.now()}_${i}`;
      out.push(rec);
    } catch (e) {
      console.error(`Kayıt ${i} mapping hatası:`, e);
    }
  }
  return out; 
}