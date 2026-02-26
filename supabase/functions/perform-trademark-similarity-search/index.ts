// supabase/functions/perform-trademark-similarity-search/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- YARDIMCI FONKSİYONLAR ---
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

const v0 = new Int32Array(512);
const v1 = new Int32Array(512);

function levenshteinSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    const lenA = a.length, lenB = b.length;
    if (lenA === 0 || lenB === 0) return 0.0;
    if (lenB >= 512) return 0.0; 

    for (let i = 0; i <= lenB; i++) v0[i] = i;

    for (let i = 0; i < lenA; i++) {
        v1[0] = i + 1;
        for (let j = 0; j < lenB; j++) {
            const cost = a[i] === b[j] ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }
        for (let j = 0; j <= lenB; j++) v0[j] = v1[j];
    }
    return 1 - (v1[lenB] / Math.max(lenA, lenB));
}

function calculateSimilarityScoreInternal(cleanedHitName: string, cleanedSearchName: string) {
    if (!cleanedSearchName || !cleanedHitName) return { finalScore: 0.0, positionalExactMatchScore: 0.0 }; 
    if (cleanedSearchName === cleanedHitName) return { finalScore: 1.0, positionalExactMatchScore: 1.0 }; 

    const levenshteinScore = levenshteinSimilarity(cleanedSearchName, cleanedHitName);
    
    const words1 = cleanedSearchName.split(' ').filter(w => w.length > 0);
    const words2 = cleanedHitName.split(' ').filter(w => w.length > 0);
    let maxWordScore = 0.0;

    if (words1.length === 0 && words2.length === 0) {
        maxWordScore = 1.0;
    } else if (words1.length > 0 && words2.length > 0) {
        for (const w1 of words1) {
            for (const w2 of words2) {
                const sim = levenshteinSimilarity(w1, w2);
                if (sim > maxWordScore) maxWordScore = sim;
            }
        }
    }

    const visualPenalty = visualMismatchPenalty(cleanedSearchName, cleanedHitName);
    const maxPossibleVisualPenalty = Math.max(cleanedSearchName.length, cleanedHitName.length) * 1.0;
    const visualScore = maxPossibleVisualPenalty === 0 ? 1.0 : (1.0 - (visualPenalty / maxPossibleVisualPenalty));

    let positionalExactMatchScore = 0.0;
    const len = Math.min(cleanedSearchName.length, cleanedHitName.length, 3);
    if (len > 0) {
        let match = true;
        for (let i = 0; i < len; i++) {
            if (cleanedSearchName[i] !== cleanedHitName[i]) { match = false; break; }          
        }
        if (match) positionalExactMatchScore = 1.0;
    }

    const finalScore = (levenshteinScore * 0.40) + (maxWordScore * 0.40) + (visualScore * 0.20);
    return { finalScore: Math.max(0.0, Math.min(1.0, finalScore)), positionalExactMatchScore }; 
}

// --- ANA YÖNLENDİRİCİ FONKSİYON ---
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        const body = await req.json();

        // =========================================================================
        // PARALEL WORKER MODU (İşçiler)
        // =========================================================================
        if (body.action === 'worker') {
            const { jobId, workerId, monitoredMarks, selectedBulletinId, lastId, processedCount, totalBulletinRecords } = body;
            const bulletinNo = selectedBulletinId.split('_')[0];
            const BATCH_SIZE = 500; // Bülten kayıtlarını 500'er 500'er çekeriz

            // 1. Markaları Hazırla
            const preparedMarks = monitoredMarks.map((mark: any) => {
                const primaryName = (mark.searchMarkName || mark.markName || '').trim();
                const alternatives = Array.isArray(mark.brandTextSearch) ? mark.brandTextSearch : [];
                const searchTerms = [primaryName, ...alternatives]
                    .filter(t => t && t.trim().length > 0)
                    .map(term => ({ term, cleanedSearchName: cleanMarkName(term, term.trim().split(/\s+/).length > 1) }));
                
                const classesRaw = Array.isArray(mark.niceClassSearch) && mark.niceClassSearch.length > 0 ? mark.niceClassSearch : (Array.isArray(mark.niceClasses) ? mark.niceClasses : []);
                const orangeSet = new Set(classesRaw.map((c: any) => String(c).replace(/\D/g, '')).filter(Boolean));
                const blueSet = new Set();
                orangeSet.forEach((c: any) => { if (RELATED_CLASSES_MAP[c]) RELATED_CLASSES_MAP[c].forEach(rel => blueSet.add(rel)); });
                
                return { ...mark, searchTerms, orangeSet, blueSet };
            });

            // 2. Bültenden Sıradaki Kaydı Çek
            const { data: hits, error } = await supabase
                .from('trademark_bulletin_records')
                .select('id, application_no, application_date, mark_name, nice_classes, holders, image_path')
                .eq('bulletin_no', bulletinNo)
                .order('id')
                .gt('id', lastId)
                .limit(BATCH_SIZE);

            if (error) throw error;

            // 3. EĞER BÜLTEN KAYDI BİTTİYSE: İŞÇİ TAMAMLANDI
            if (!hits || hits.length === 0) {
                await supabase.from('search_progress_workers').update({ status: 'completed' }).eq('id', `${jobId}_w${workerId}`);
                
                const { data: activeWorkers } = await supabase.from('search_progress_workers').select('id').eq('job_id', jobId).eq('status', 'processing');
                
                if (!activeWorkers || activeWorkers.length === 0) {
                    await supabase.from('search_progress').update({ status: 'completed' }).eq('id', jobId);
                    console.log(`🎉 TÜM İŞÇİLER BİTİRDİ! Ana Job ${jobId} tamamlandı.`);
                }
                
                return new Response(JSON.stringify({ success: true, finished: true }), { headers: corsHeaders });
            }

            let newLastId = hits[hits.length - 1].id;
            let actualProcessedCount = 0;
            const uiResults = [];
            const permanentRecords = []; // 🔥 KALICI TABLO EKLENDİ

            // 4. KRONOMETRE
            const startTime = Date.now();
            const CPU_TIME_LIMIT = 1500; // 1.5 Saniyede kes

            for (let i = 0; i < hits.length; i++) {
                if (Date.now() - startTime > CPU_TIME_LIMIT) {
                    newLastId = i > 0 ? hits[i - 1].id : hits[0].id; // 🔥 Güvenli Çıkış
                    break;
                }

                actualProcessedCount++;
                const hit = hits[i];
                const hitClasses = typeof hit.nice_classes === 'string' ? hit.nice_classes.split(/[^\d]+/).map(c => String(c).replace(/\D/g, '')).filter(Boolean) : [];
                const cleanedHitName = cleanMarkName(hit.mark_name || ''); 

                for (const mark of preparedMarks) {
                    let hasPoolMatch = false;
                    const classColors: Record<string, string> = {};

                    hitClasses.forEach((hc: string) => {
                        if (mark.orangeSet.has(hc)) { classColors[hc] = 'orange'; hasPoolMatch = true; }
                        else if (mark.blueSet.has(hc)) { classColors[hc] = 'gray'; hasPoolMatch = true; }
                    });

                    for (const searchItem of mark.searchTerms) {
                        let isExactPrefixSuffix = searchItem.cleanedSearchName.length >= 3 && cleanedHitName.includes(searchItem.cleanedSearchName);

                        if (!hasPoolMatch && !isExactPrefixSuffix) continue;

                        const { finalScore, positionalExactMatchScore } = calculateSimilarityScoreInternal(cleanedHitName, searchItem.cleanedSearchName);

                        if (finalScore < 0.5 && positionalExactMatchScore < 0.5 && !isExactPrefixSuffix) continue;

                        // Arayüz İçin
                        uiResults.push({
                            job_id: jobId, monitored_trademark_id: mark.id, mark_name: hit.mark_name,
                            application_no: hit.application_no, nice_classes: hit.nice_classes, similarity_score: finalScore,
                            holders: hit.holders, image_path: hit.image_path
                        });

                        // 🔥 Kalıcı Tablo İçin (Bunu silmiştim, geri eklendi)
                        let holdersData = hit.holders;
                        if (typeof holdersData === 'string') { holdersData = holdersData.split(',').map((h: string) => h.trim()); }

                        permanentRecords.push({
                            application_date: hit.application_date || '', application_no: hit.application_no,
                            bulletin_id: selectedBulletinId, class_colors: classColors, holders: holdersData || [],
                            image_path: hit.image_path || '', is_earlier: false, mark_name: hit.mark_name,
                            matched_term: searchItem.term, monitored_mark_id: mark.id,
                            monitored_trademark: mark.markName || mark.title || '', monitored_trademark_id: mark.id,
                            nice_classes: hit.nice_classes || '', positional_exact_match_score: positionalExactMatchScore,
                            similarity_score: finalScore, source: 'new'
                        });

                        break;
                    }
                }
            }

            // 5. BULUNANLARI YAZ
            if (uiResults.length > 0) {
                await supabase.from('search_progress_results').insert(uiResults);
                await supabase.from('monitoring_trademark_records').insert(permanentRecords); // 🔥 Kalıcı kayıt yapıldı
                
                const { data: jobData } = await supabase.from('search_progress').select('current_results').eq('id', jobId).single();
                await supabase.from('search_progress').update({ current_results: (jobData?.current_results || 0) + uiResults.length }).eq('id', jobId);
            }

            // 6. İLERLEME YÜZDESİNİ HESAPLA (UI İçin)
            const newProcessedCount = processedCount + actualProcessedCount;
            const progressPercent = Math.min(100, Math.floor((newProcessedCount / totalBulletinRecords) * 100));
            await supabase.from('search_progress_workers').upsert({ id: `${jobId}_w${workerId}`, job_id: jobId, status: 'processing', progress: progressPercent });

            // 7. ZİNCİRE DEVAM ET
            EdgeRuntime.waitUntil(
                supabase.functions.invoke('perform-trademark-similarity-search', {
                    body: { action: 'worker', jobId, workerId, monitoredMarks, selectedBulletinId, lastId: newLastId, processedCount: newProcessedCount, totalBulletinRecords },
                    headers: { Authorization: `Bearer ${supabaseKey}` }
                })
            );

            return new Response(JSON.stringify({ success: true, workerId }), { headers: corsHeaders });
        }

        // =========================================================================
        // BAŞLANGIÇ MODU (Arayüzden gelen ilk istek)
        // =========================================================================
        const { monitoredMarks, selectedBulletinId } = body;
        if (!monitoredMarks || !selectedBulletinId) throw new Error("Eksik parametre.");

        const jobId = `job_${Date.now()}`;
        const bulletinNo = selectedBulletinId.split('_')[0];
        
        // Bültenin toplam kaydını bul (Yüzde hesabı için)
        const { count } = await supabase.from('trademark_bulletin_records').select('*', { count: 'exact', head: true }).eq('bulletin_no', bulletinNo);
        const totalRecords = count || 1;

        await supabase.from('search_progress').insert({ id: jobId, status: 'processing', current_results: 0, total_records: totalRecords });
        
        // MARKALARI 10 EŞİT PARÇAYA BÖL
        const WORKER_COUNT = 10;
        const chunkSize = Math.ceil(monitoredMarks.length / WORKER_COUNT);
        
        const workerRecords = [];
        for (let i = 0; i < WORKER_COUNT; i++) {
            const chunk = monitoredMarks.slice(i * chunkSize, (i + 1) * chunkSize);
            if (chunk.length === 0) continue;
            
            const workerId = i + 1;
            workerRecords.push({ id: `${jobId}_w${workerId}`, job_id: jobId, status: 'processing', progress: 0 });

            EdgeRuntime.waitUntil(
                supabase.functions.invoke('perform-trademark-similarity-search', {
                    body: { action: 'worker', jobId, workerId, monitoredMarks: chunk, selectedBulletinId, lastId: '0', processedCount: 0, totalBulletinRecords: totalRecords },
                    headers: { Authorization: `Bearer ${supabaseKey}` }
                })
            );
        }

        await supabase.from('search_progress_workers').insert(workerRecords);

        console.log(`🚀 Paralel Arama Tetiklendi: ${jobId} (${workerRecords.length} İşçi Başladı)`);

        return new Response(JSON.stringify({ success: true, jobId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});