// supabase/functions/perform-trademark-similarity-search/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// --- CORS AYARLARI (Preflight hatalarını çözer) ---
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- YARDIMCI FONKSİYONLAR VE ALGORİTMALAR ---
const RELATED_CLASSES_MAP: Record<string, string[]> = {
    "29": ["30", "31", "43"], "30": ["29", "31", "43"], "31": ["29", "30", "43"],
    "32": ["33"], "33": ["32"], "43": ["29", "30", "31"],
    "1": ["5"], "3": ["5", "44"], "5": ["1", "3", "10", "44"],
    "10": ["5", "44"], "44": ["3", "5", "10"],
    "18": ["25"], "23": ["24", "25"], "24": ["20", "23", "25", "27", "35"],
    "25": ["18", "23", "24", "26"], "26": ["25"],
    "9": ["28", "38", "41", "42"], "28": ["9", "41"], "38": ["9"],
    "41": ["9", "16", "28", "42"], "42": ["9", "41"], "16": ["41"],
    "7": ["37"], "11": ["21", "37"], "12": ["37", "39"],
    "37": ["7", "11", "12", "19", "36"], "39": ["12", "36"],
    "6": ["19", "20"], "19": ["6", "35", "37"], "20": ["6", "21", "24", "27", "35"],
    "21": ["11", "20"], "27": ["20", "24", "35"], "35": ["19", "20", "24", "27", "36"],
    "36": ["35", "37", "39"]
};

const GENERIC_WORDS = [
    'ltd', 'şti', 'aş', 'anonim', 'şirketi', 'şirket', 'limited', 'inc', 'corp', 'co', 'company', 'group', 'grup',
    'sanayi', 'ticaret', 'turizm', 'tekstil', 'gıda', 'inşaat', 'danışmanlık', 'hizmet', 'hizmetleri', 'bilişim', 'teknoloji',
    'mühendislik', 'üretim', 'imalat', 'tasarım', 'dizayn', 'grafik', 'web', 'yazılım', 'donanım', 'elektronik', 'makina',
    'ürün', 'products', 'services', 'çözüm', 'sistem', 'malzeme', 'ekipman', 'cihaz', 'araç', 'yedek', 'parça', 'aksesuar',
    'meşhur', 'ünlü', 'tarihi', 'geleneksel', 'klasik', 'yeni', 'taze', 'özel', 'premium', 'lüks', 'kalite', 'uygun',
    'türkiye', 'uluslararası', 'emlak', 'konut', 'ticari', 'ofis', 'plaza', 'alışveriş', 'rezidans', 'daire',
    'dijital', 'internet', 'mobil', 'ağ', 'sunucu', 'platform', 'sosyal', 'medya',
    'yemek', 'restoran', 'cafe', 'kahve', 'çay', 'fırın', 'ekmek', 'pasta', 'börek', 'pizza', 'burger', 'kebap', 'döner', 
    'et', 'tavuk', 'sebze', 'meyve', 'süt', 'peynir', 'yoğurt', 'dondurma', 'şeker', 'bal', 'organik', 'doğal',
    've', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü', 'sadece', 'tek', 'en', 'çok', 'az', 'yeni', 'eski'
];

function removeTurkishSuffixes(word: string) {
    if (!word) return '';
    if (word.endsWith('ler') || word.endsWith('lar')) return word.substring(0, word.length - 3);
    if (word.endsWith('si') || word.endsWith('sı') || word.endsWith('sü') || word.endsWith('su')) return word.substring(0, word.length - 2);
    if (word.length > 2 && ['i', 'ı', 'u', 'ü'].includes(word[word.length - 1])) return word.substring(0, word.length - 1);
    return word;
}

function cleanMarkName(name: string, removeGenericWords = true) {
    if (!name) return '';
    let cleaned = name.toLowerCase().replace(/[^a-z0-9ğüşöçı\s]/g, '').replace(/\s+/g, ' ').trim();
    if (removeGenericWords) {
        cleaned = cleaned.split(' ').filter(word => {
            const stemmedWord = removeTurkishSuffixes(word);
            return !GENERIC_WORDS.includes(stemmedWord) && !GENERIC_WORDS.includes(word);
        }).join(' ');
    }
    return cleaned.trim();
}

const visualMap: Record<string, string[]> = {
    "a": ["e", "o"], "b": ["d", "p"], "c": ["ç", "s"], "ç": ["c", "s"], "d": ["b", "p"], "e": ["a", "o"], "f": ["t"],
    "g": ["ğ", "q"], "ğ": ["g", "q"], "h": ["n"], "i": ["l", "j", "ı"], "ı": ["i"], "j": ["i", "y"], "k": ["q", "x"],
    "l": ["i", "1"], "m": ["n"], "n": ["m", "r"], "o": ["a", "0", "ö"], "ö": ["o"], "p": ["b", "q"], "q": ["g", "k"],
    "r": ["n"], "s": ["ş", "c", "z"], "ş": ["s", "z"], "t": ["f"], "u": ["ü", "v"], "ü": ["u", "v"], "v": ["u", "ü", "w"],
    "w": ["v"], "x": ["ks"], "y": ["j"], "z": ["s", "ş"], "0": ["o"], "1": ["l", "i"], "ks": ["x"], "Q": ["O","0"],
    "O": ["Q", "0"], "I": ["l", "1"], "L": ["I", "1"], "Z": ["2"], "S": ["5"], "B": ["8"], "D": ["O"]
};

function visualMismatchPenalty(a: string, b: string) {
    if (!a || !b) return 5; 
    const lenDiff = Math.abs(a.length - b.length);
    const minLen = Math.min(a.length, b.length);
    let penalty = lenDiff * 0.5;
    for (let i = 0; i < minLen; i++) {
        const ca = a[i].toLowerCase();
        const cb = b[i].toLowerCase();
        if (ca !== cb) {
            if (visualMap[ca] && visualMap[ca].includes(cb)) penalty += 0.25;
            else penalty += 1.0;
        }
    }
    return penalty;
}

function normalizeString(str: string) {
    if (!str) return "";
    return str.toLowerCase().replace(/[^a-z0-9ğüşöçı]/g, '').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/ı/g, 'i');
}

function levenshteinSimilarity(a: string, b: string) {
    if (!a || !b) return 0;
    const lenA = a.length, lenB = b.length;
    const matrix = Array.from({ length: lenB + 1 }, (_, i) => [i]);
    for (let j = 0; j <= lenA; j++) matrix[0][j] = j;
    for (let i = 1; i <= lenB; i++) {
        for (let j = 1; j <= lenA; j++) {
            const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j - 1] + cost, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    const maxLen = Math.max(lenA, lenB);
    return maxLen === 0 ? 1 : (1 - matrix[lenB][lenA] / maxLen);
}

function calculateSimilarityScoreInternal(hitMarkName: string, searchMarkName: string) {
    const isSearchMultiWord = searchMarkName.trim().split(/\s+/).length > 1;
    const isHitMultiWord = (hitMarkName || '').trim().split(/\s+/).length > 1;
    const cleanedSearchName = cleanMarkName(searchMarkName || '', isSearchMultiWord);
    const cleanedHitName = cleanMarkName(hitMarkName || '', isHitMultiWord);
    
    if (!cleanedSearchName || !cleanedHitName) return { finalScore: 0.0, positionalExactMatchScore: 0.0 }; 
    if (cleanedSearchName === cleanedHitName) return { finalScore: 1.0, positionalExactMatchScore: 1.0 }; 

    const levenshteinScore = levenshteinSimilarity(cleanedSearchName, cleanedHitName);
    
    const maxWordScore = (() => {
        const words1 = cleanedSearchName.split(' ').filter(w => w.length > 0);
        const words2 = cleanedHitName.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 && words2.length === 0) return 1.0;
        if (words1.length === 0 || words2.length === 0) return 0.0;
        let maxSim = 0.0;
        for (const w1 of words1) {
            for (const w2 of words2) {
                const sim = levenshteinSimilarity(w1, w2);
                if (sim > maxSim) maxSim = sim;
            }
        }
        return maxSim;
    })();

    const visualPenalty = visualMismatchPenalty(cleanedSearchName, cleanedHitName);
    const maxPossibleVisualPenalty = Math.max(cleanedSearchName.length, cleanedHitName.length) * 1.0;
    const visualScore = maxPossibleVisualPenalty === 0 ? 1.0 : (1.0 - (visualPenalty / maxPossibleVisualPenalty));

    const positionalExactMatchScore = (() => {
        const len = Math.min(cleanedSearchName.length, cleanedHitName.length, 3);
        if (len === 0) return 0.0;
        for (let i = 0; i < len; i++) {
            if (cleanedSearchName[i] !== cleanedHitName[i]) return 0.0;          
        }
        return 1.0; 
    })();

    const finalScore = (levenshteinScore * 0.40) + (maxWordScore * 0.40) + (visualScore * 0.20);
    return { finalScore: Math.max(0.0, Math.min(1.0, finalScore)), positionalExactMatchScore }; 
}

// --- ANA FONKSİYON ---
serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Service Role, RLS'yi atlar
    );

    const body = await req.json();

    // =========================================================================
    // WORKER MODE (Arka Plan İşçisi - Kendi kendini çağırır)
    // =========================================================================
    if (body.action === 'worker') {
        const { jobId, monitoredMarks, bulletinNo, workerId, totalBulletinRecords } = body;
        
        // Edge Function zaman aşımını önlemek için asenkron çalıştırıyoruz
        EdgeRuntime.waitUntil((async () => {
            try {
                // Hazırlık: İzlenen Markaların Sınıf Havuzlarını Çıkar
                const preparedMarks = monitoredMarks.map((mark: any) => {
                    const primaryName = (mark.searchMarkName || mark.markName || '').trim();
                    const alternatives = Array.isArray(mark.brandTextSearch) ? mark.brandTextSearch : [];
                    const searchTerms = [primaryName, ...alternatives].filter(t => t && t.trim().length > 0).map(term => ({ term, cleanedSearchName: cleanMarkName(term, term.trim().split(/\s+/).length > 1) }));
                    
                    const classesRaw = Array.isArray(mark.niceClassSearch) && mark.niceClassSearch.length > 0 ? mark.niceClassSearch : (Array.isArray(mark.niceClasses) ? mark.niceClasses : []);
                    const orangeSet = new Set(classesRaw.map((c: any) => String(c).replace(/\D/g, '')).filter(Boolean));
                    const blueSet = new Set();
                    orangeSet.forEach((c: any) => { if (RELATED_CLASSES_MAP[c]) RELATED_CLASSES_MAP[c].forEach(rel => blueSet.add(rel)); });
                    
                    return { ...mark, searchTerms, orangeSet, blueSet };
                });

                const BATCH_SIZE = 1000;
                let lastId = '0';
                let processedCount = 0;
                let keepFetching = true;

                while (keepFetching) {
                    // 1. Bülten Kayıtlarını Veritabanından Çek (1000'erli sayfalar)
                    const { data: hits, error } = await supabase
                        .from('trademark_bulletin_records')
                        .select('id, application_no, mark_name, nice_classes, holders, image_path')
                        .eq('bulletin_no', bulletinNo)
                        .order('id')
                        .gt('id', lastId)
                        .limit(BATCH_SIZE);

                    if (error) throw error;
                    if (!hits || hits.length === 0) break;

                    lastId = hits[hits.length - 1].id;
                    let pendingResults: any[] = [];

                    // 2. Çekilen her bir bülten kaydını (hit), izlenen markalarla karşılaştır
                    for (const hit of hits) {
                        const hitClasses = typeof hit.nice_classes === 'string' ? hit.nice_classes.split(/[^\d]+/).map(c => String(c).replace(/\D/g, '')).filter(Boolean) : [];
                        const cleanedHitName = cleanMarkName(hit.mark_name || '');

                        for (const mark of preparedMarks) {
                            for (const searchItem of mark.searchTerms) {
                                let isExactPrefixSuffix = searchItem.cleanedSearchName.length >= 3 && cleanedHitName.includes(searchItem.cleanedSearchName);
                                let hasPoolMatch = hitClasses.some((hc: any) => mark.orangeSet.has(hc) || mark.blueSet.has(hc));

                                if (!hasPoolMatch && !isExactPrefixSuffix) continue;

                                const { finalScore, positionalExactMatchScore } = calculateSimilarityScoreInternal(hit.mark_name, searchItem.term);

                                if (finalScore < 0.5 && positionalExactMatchScore < 0.5 && !isExactPrefixSuffix) continue;

                                pendingResults.push({
                                    job_id: jobId,
                                    monitored_trademark_id: mark.id,
                                    mark_name: hit.mark_name,
                                    application_no: hit.application_no,
                                    nice_classes: hit.nice_classes,
                                    similarity_score: finalScore,
                                    holders: hit.holders,
                                    image_path: hit.image_path
                                });
                            }
                        }
                    }

                    processedCount += hits.length;

                    // 3. Bulunan Benzerlikleri Sonuç Tablosuna Yaz
                    if (pendingResults.length > 0) {
                        await supabase.from('search_progress_results').insert(pendingResults);
                        
                        // Ana Sayacı Güncelle (Frontend animasyonu için)
                        const { data: jobData } = await supabase.from('search_progress').select('current_results').eq('id', jobId).single();
                        if (jobData) {
                            await supabase.from('search_progress').update({ current_results: jobData.current_results + pendingResults.length }).eq('id', jobId);
                        }
                    }

                    const progress = Math.min(100, Math.floor((processedCount / totalBulletinRecords) * 100));
                    await supabase.from('search_progress_workers').update({ progress }).eq('id', workerId);
                }

                await supabase.from('search_progress_workers').update({ status: 'completed', progress: 100 }).eq('id', workerId);

                // Tüm işçiler bittiyse Ana İşi tamamlandı olarak işaretle
                const { data: workers } = await supabase.from('search_progress_workers').select('status').eq('job_id', jobId);
                if (workers && workers.every((w: any) => w.status === 'completed')) {
                    await supabase.from('search_progress').update({ status: 'completed' }).eq('id', jobId);
                }

            } catch (error) {
                console.error("Worker error:", error);
                await supabase.from('search_progress_workers').update({ status: 'error' }).eq('id', workerId);
                await supabase.from('search_progress').update({ status: 'error', error_message: error.message }).eq('id', jobId);
            }
        })());
        
        return new Response(JSON.stringify({ success: true, message: 'Worker Started' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // =========================================================================
    // MAIN MODE (İşi Başlatan İstek)
    // =========================================================================
    const { monitoredMarks, selectedBulletinId } = body;
    if (!monitoredMarks || !selectedBulletinId) throw new Error("Eksik parametreler.");

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const bulletinNo = selectedBulletinId.split('_')[0];
    const WORKER_COUNT = 3; 

    // Bültenin toplam kayıt sayısını bul (ilerleme çubuğu için)
    const { count } = await supabase.from('trademark_bulletin_records').select('*', { count: 'exact', head: true }).eq('bulletin_no', bulletinNo);
    const totalBulletinRecords = count || 1;

    // Ana işi veritabanına yaz
    await supabase.from('search_progress').insert({ id: jobId, status: 'queued', current_results: 0, total_records: monitoredMarks.length });

    const batchSize = Math.ceil(monitoredMarks.length / WORKER_COUNT);
    const workerPromises = [];

    // Worker'ları kendi URL'ine istek atarak tetikle (arka plan işlemi başlat)
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = i * batchSize;
      const end = start + batchSize;
      const chunk = monitoredMarks.slice(start, end);
      if (chunk.length === 0) continue;

      const workerId = `${jobId}_w${i + 1}`;
      
      await supabase.from('search_progress_workers').insert({ id: workerId, job_id: jobId, status: 'processing', progress: 0 });

      // Kendini asenkron olarak tetikle (Fire and Forget)
      workerPromises.push(
        fetch(req.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
            body: JSON.stringify({ action: 'worker', jobId, monitoredMarks: chunk, bulletinNo, workerId, totalBulletinRecords })
        }).catch(err => console.error("Worker başlatılamadı:", err))
      );
    }

    await Promise.all(workerPromises);
    await supabase.from('search_progress').update({ status: 'processing' }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, jobId, workerCount: workerPromises.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});