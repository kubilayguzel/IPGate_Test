// supabase/functions/perform-trademark-similarity-search/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Basit Levenshtein Benzerlik Skoru (Performans için optimize edildi)
function calculateSim(s1: string, s2: string): number {
    s1 = s1.toLowerCase().trim();
    s2 = s2.toLowerCase().trim();
    if (s1 === s2) return 1.0;
    const len1 = s1.length, len2 = s2.length;
    const matrix = Array.from({ length: len2 + 1 }, (_, i) => [i]);
    for (let j = 0; j <= len1; j++) matrix[0][j] = j;
    for (let i = 1; i <= len2; i++) {
        for (let j = 1; j <= len1; j++) {
            const cost = s2[i - 1] === s1[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return 1 - (matrix[len2][len1] / Math.max(len1, len2));
}

// 🚀 ASIL İŞİ YAPAN DAHİLİ WORKER FONKSİYONU
async function startInternalWorker(supabase: any, jobId: string, monitoredMarks: any[], bulletinNo: string) {
    console.log(`👷 Worker Başladı: Job=${jobId}, Bülten=${bulletinNo}`);
    
    try {
        const { count } = await supabase.from('trademark_bulletin_records').select('*', { count: 'exact', head: true }).eq('bulletin_no', bulletinNo);
        const totalBulletinRecords = count || 1;

        // İzlenen markaların sınıflarını hazırla (Performans için Map/Set kullanımı)
        const preparedMarks = monitoredMarks.map(m => {
            const classesRaw = Array.isArray(m.niceClassSearch) && m.niceClassSearch.length > 0 ? m.niceClassSearch : (Array.isArray(m.niceClasses) ? m.niceClasses : []);
            const orangeSet = new Set(classesRaw.map((c: any) => String(c).replace(/\D/g, '')));
            const blueSet = new Set();
            orangeSet.forEach((c: any) => { if (RELATED_CLASSES_MAP[c]) RELATED_CLASSES_MAP[c].forEach(rel => blueSet.add(rel)); });
            return { ...m, orangeSet, blueSet };
        });

        let lastId = '0';
        let processedCount = 0;

        // Sayfalama (Pagination) ile tüm bülten kayıtlarını tara
        while (true) {
            const { data: hits, error } = await supabase
                .from('trademark_bulletin_records')
                .select('id, application_no, mark_name, nice_classes, holders, image_path')
                .eq('bulletin_no', bulletinNo)
                .order('id')
                .gt('id', lastId)
                .limit(1000);

            if (error) throw error;
            if (!hits || hits.length === 0) break;

            lastId = hits[hits.length - 1].id;
            const resultsToInsert = [];

            for (const hit of hits) {
                const hitClasses = String(hit.nice_classes || '').split(/[^\d]+/).filter(Boolean);
                
                for (const mark of preparedMarks) {
                    // Sınıf çakışması kontrolü
                    const hasClassMatch = hitClasses.some(hc => mark.orangeSet.has(hc) || mark.blueSet.has(hc));
                    if (!hasClassMatch) continue;

                    const score = calculateSim(hit.mark_name || '', mark.markName || mark.title || '');
                    
                    if (score >= 0.5) {
                        resultsToInsert.push({
                            job_id: jobId,
                            monitored_trademark_id: mark.id,
                            mark_name: hit.mark_name,
                            application_no: hit.application_no,
                            nice_classes: hit.nice_classes,
                            similarity_score: score,
                            holders: hit.holders,
                            image_path: hit.image_path
                        });
                    }
                }
            }

            // Bulunanları toplu yaz ve sayacı güncelle
            if (resultsToInsert.length > 0) {
                await supabase.from('search_progress_results').insert(resultsToInsert);
                const { data: jobData } = await supabase.from('search_progress').select('current_results').eq('id', jobId).single();
                await supabase.from('search_progress').update({ current_results: (jobData?.current_results || 0) + resultsToInsert.length }).eq('id', jobId);
            }

            processedCount += hits.length;
            const progressPercent = Math.min(100, Math.floor((processedCount / totalBulletinRecords) * 100));
            
            // search_progress_workers tablosunu güncelle (Tek bir ana worker gibi davranıyoruz)
            await supabase.from('search_progress_workers').upsert({ id: `${jobId}_main`, job_id: jobId, status: 'processing', progress: progressPercent });
        }

        await supabase.from('search_progress_workers').update({ status: 'completed', progress: 100 }).eq('id', `${jobId}_main`);
        await supabase.from('search_progress').update({ status: 'completed' }).eq('id', jobId);
        console.log(`✅ Job ${jobId} başarıyla tamamlandı.`);

    } catch (err) {
        console.error(`❌ Worker Hatası (Job ${jobId}):`, err);
        await supabase.from('search_progress').update({ status: 'error', error_message: err.message }).eq('id', jobId);
    }
}

serve(async (req) => {
    // CORS Preflight
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const body = await req.json();

        // Worker Mode çağrısını artık dahili yapacağımız için action === 'worker' kısmını sildik
        const { monitoredMarks, selectedBulletinId } = body;
        const jobId = `job_${Date.now()}`;
        const bulletinNo = selectedBulletinId.split('_')[0];

        // 1. İşi veritabanına kaydet
        await supabase.from('search_progress').insert({ 
            id: jobId, 
            status: 'started', 
            current_results: 0, 
            total_records: monitoredMarks.length 
        });

        // 2. 🚀 KRİTİK: Arka plan işlemini başlat
        // waitUntil sayesinde Deno, tarayıcıya yanıtı dönse bile bu fonksiyonu öldürmez.
        EdgeRuntime.waitUntil(startInternalWorker(supabase, jobId, monitoredMarks, bulletinNo));

        console.log(`🚀 Arama Tetiklendi: ${jobId}`);

        return new Response(JSON.stringify({ success: true, jobId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});