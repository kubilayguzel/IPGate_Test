// public/js/turkpatent-mapper.js

import { supabase } from './supabase-config.js';

function normalizeText(v) { return (v || '').toString().replace(/\s+/g, ' ').trim().toLowerCase(); }
function parseDDMMYYYYToISO(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = (s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
function formatDate(dateStr) { return parseDDMMYYYYToISO(dateStr); }
function uniq(arr) { return Array.from(new Set(arr)); }

export function mapStatusToUtils(turkpatentStatus) {
  if (!turkpatentStatus) return null;
  if (/GEÇERSİZ/i.test(turkpatentStatus.toString().trim())) return 'rejected';
  return null;
}

async function uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc) {
  const imageUrl = brandImageDataUrl || imageSrc;
  if (!imageUrl || !applicationNumber) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
    const fileName = `${applicationNumber}_${Date.now()}.${ext}`;

    const { data, error } = await supabase.storage.from('brand_images').upload(`brand-examples/${fileName}`, blob, {
      contentType: blob.type || 'image/jpeg',
      cacheControl: '31536000'
    });

    if (error || !data) return null;
    const { data: publicUrlData } = supabase.storage.from('brand_images').getPublicUrl(data.path);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error('Görsel upload hatası:', error);
    return null;
  }
}

function parseNiceClasses(niceClassesStr) {
  if (!niceClassesStr) return [];
  return uniq(niceClassesStr.toString().split(/[,;\s]+/).map(n => parseInt(String(n).trim(), 10)).filter(n => !Number.isNaN(n) && n > 0 && n <= 45));
}

function createBulletins(details, transactions) {
  const out = [];
  const get = (k) => details?.[k] ?? null;
  const bNo = get('Bülten Numarası') || get('Bülten No') || get('Marka İlan Bülten No') || null;
  const bDate = get('Bülten Tarihi') || get('Yayım Tarihi') || get('Marka İlan Bülten Tarihi') || null;

  if (bNo || bDate) out.push({ bulletin_no: bNo, bulletin_date: formatDate(bDate) });

  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      const m = (tx?.description || '').match(/(?:bülten|bulletin)\s*(?:no|numarası)?\s*[:\-]?\s*([0-9/]+)/i);
      if (m) out.push({ bulletin_no: m[1], bulletin_date: formatDate(tx?.date) || null });
    }
  }

  const uniqueMap = new Map();
  for (const b of out) {
    const key = `${b.bulletin_no || ''}_${b.bulletin_date || ''}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, b);
  }
  return Array.from(uniqueMap.values());
}

function createGoodsAndServicesByClass(inputGSC, niceClassesStr, details) {
  if (Array.isArray(inputGSC) && inputGSC.length > 0) {
    const groupedByClass = new Map();
    inputGSC.forEach(entry => {
      const classNo = Number(entry.classNo);
      let items = Array.isArray(entry.items) ? entry.items : [entry.items];
      if (!groupedByClass.has(classNo)) groupedByClass.set(classNo, []);
      groupedByClass.get(classNo).push(...items.flatMap(item => typeof item === 'string' ? item.split(/[\n.]/).map(s => s.trim()).filter(Boolean) : []));
    });
    return Array.from(groupedByClass.entries()).map(([classNo, items]) => ({ classNo, items: [...new Set(items)] })).sort((a, b) => a.classNo - b.classNo);
  }

  const niceNums = parseNiceClasses(niceClassesStr) || parseNiceClasses(details?.['Nice Sınıfları']);
  if (!Array.isArray(niceNums) || niceNums.length === 0) return [];
  return niceNums.map(classNo => ({ classNo, items: [] }));
}

function createOldTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];
  return transactions.map(tx => ({
    date: formatDate(tx?.date),
    description: tx?.description || tx?.action || null,
    note: tx?.note || null,
    source: 'turkpatent_scrape',
    createdAt: new Date().toISOString()
  }));
}

export async function mapTurkpatentToIPRecord(turkpatentData, selectedApplicants = []) {
  const { applicationNumber, brandName, applicationDate, registrationNumber, status, niceClasses, brandImageDataUrl, imageSrc, details = {}, goodsAndServicesByClass, transactions: rootTransactions } = turkpatentData || {};
  const transactions = (Array.isArray(rootTransactions) && rootTransactions.length > 0) ? rootTransactions : (details.transactions || []);
  const brandImageUrl = await uploadBrandImage(applicationNumber, brandImageDataUrl, imageSrc);

  let registrationDate = turkpatentData.registrationDate ? formatDate(turkpatentData.registrationDate) : formatDate(details?.['Tescil Tarihi']);
  if (!registrationDate && Array.isArray(transactions)) {
    const regTx = transactions.find(tx => (tx?.description || tx?.action || '').toUpperCase().includes('TESCİL EDİLDİ'));
    if (regTx?.date) registrationDate = formatDate(regTx.date);
  }

  let calculatedRenewalDate = null;
  const topLevelRenewal = turkpatentData?.renewalDate || details?.['Yenileme Tarihi'];
  if (topLevelRenewal) {
    const d = new Date(formatDate(topLevelRenewal) || topLevelRenewal);
    if (!isNaN(d.getTime())) calculatedRenewalDate = d.toISOString().split('T')[0];
  } else if (registrationDate || applicationDate) {
    const baseDate = new Date(registrationDate || formatDate(applicationDate) || applicationDate);
    if (!isNaN(baseDate.getTime())) { baseDate.setFullYear(baseDate.getFullYear() + 10); calculatedRenewalDate = baseDate.toISOString().split('T')[0]; }
  }

  let turkpatentStatusText = details?.['Durumu'] || status;
  let finalStatus = mapStatusToUtils(turkpatentStatusText); 

  if (!finalStatus && registrationDate && calculatedRenewalDate) {
    const graceEnd = new Date(calculatedRenewalDate); graceEnd.setMonth(graceEnd.getMonth() + 6); 
    if (new Date() < graceEnd) finalStatus = 'registered'; 
  }
  if (!finalStatus) finalStatus = 'filed';

  return {
    title: brandName || 'Başlıksız Marka',
    type: 'trademark',
    portfolio_status: 'active',
    origin: 'TÜRKPATENT',
    status: finalStatus,
    recordOwnerType: 'self',
    application_number: applicationNumber || null,
    application_date: formatDate(applicationDate),
    registration_number: registrationNumber || details?.['Tescil Numarası'] || null,
    registration_date: registrationDate,
    renewal_date: calculatedRenewalDate,
    brand_name: brandName || '',
    brand_image_url: brandImageUrl,
    details: {
        description: details?.['Açıklama'] || null,
        brandType: details?.['Marka Türü'] || 'Şekil + Kelime',
        brandCategory: details?.['Marka Kategorisi'] || 'Ticaret/Hizmet Markası',
        bulletins: createBulletins(details, transactions),
        goodsAndServicesByClass: createGoodsAndServicesByClass(goodsAndServicesByClass, niceClasses, details),
        applicants: Array.isArray(selectedApplicants) ? selectedApplicants.map(a => ({ id: a.id, email: a.email || null })) : [],
        oldTransactions: createOldTransactions(transactions)
    }
  };
}

export async function mapTurkpatentResultsToIPRecords(turkpatentResults, selectedApplicants) {
  if (!Array.isArray(turkpatentResults)) return [];
  const out = [];
  for (let i = 0; i < turkpatentResults.length; i++) {
    try {
      const rec = await mapTurkpatentToIPRecord(turkpatentResults[i], selectedApplicants);
      rec.id = `turkpatent_${Date.now()}_${i}`;
      out.push(rec);
    } catch (e) { console.error(`Kayıt ${i} mapping hatası:`, e); }
  }
  return out; 
}