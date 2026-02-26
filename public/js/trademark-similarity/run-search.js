// public/js/trademark-similarity/run-search.js
import { supabase } from '../../supabase-config.js'; 

console.log(">>> run-search.js modülü yüklendi (Supabase & Offset Paging Versiyon) <<<");

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
    try {
        console.log("🚀 Supabase Edge Function tetikleniyor...", { monitoredMarks: monitoredMarks.length, selectedBulletinId });

        // Edge Function tetikleme
        const { data, error } = await supabase.functions.invoke('perform-trademark-similarity-search', {
            body: { 
                monitoredMarks: monitoredMarks, 
                selectedBulletinId: selectedBulletinId 
            }
        });

        if (error) {
            console.error("❌ Edge Function Hatası:", error);
            throw error;
        }

        const jobId = data.jobId;
        console.log("✅ İş başlatıldı, Job ID:", jobId);

        // Durum takibi döngüsü (Poling)
        return await monitorSearchProgress(jobId, onProgress);

    } catch (err) {
        console.error("Arama başlatma hatası:", err);
        throw err;
    }
}

async function monitorSearchProgress(jobId, onProgress) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                // search_progress tablosundan durumu kontrol et
                const { data, error } = await supabase
                    .from('search_progress')
                    .select('status, processed_count, total_count, error_message')
                    .eq('job_id', jobId)
                    .single();

                if (error) throw error;

                if (data.status === 'processing') {
                    onProgress({ status: 'processing', processed: data.processed_count, total: data.total_count });
                } 
                else if (data.status === 'completed') {
                    clearInterval(interval);
                    onProgress({ status: 'fetching_results' });
                    const results = await fetchResults(jobId, onProgress);
                    resolve(results);
                } 
                else if (data.status === 'failed') {
                    clearInterval(interval);
                    reject(new Error(data.error_message || "Arama işlemi başarısız oldu."));
                }
            } catch (err) {
                clearInterval(interval);
                reject(err);
            }
        }, 3000); // 3 saniyede bir kontrol et
    });
}

// 🔥 DÜZELTME: UUID'ler için çok daha güvenli olan OFFSET Paging yapısı kuruldu.
async function fetchResults(jobId, onProgress) {
    let allData = [];
    const BATCH_SIZE = 1000; 
    let keepFetching = true;
    let offset = 0; 

    while (keepFetching) {
        try {
            const { data, error } = await supabase
                .from('search_progress_results')
                .select('*')
                .eq('job_id', jobId)
                .range(offset, offset + BATCH_SIZE - 1)
                .order('created_at', { ascending: true }); // Kayma olmaması için sıralama

            if (error) throw error;
            if (!data || data.length === 0) { keepFetching = false; break; }

            // DB'den gelen snake_case veriyi, UI'ın beklediği camelCase formata çeviriyoruz
            const mappedData = data.map(r => ({
                id: r.id,
                objectID: r.id, // Eski uyumluluk için
                monitoredTrademarkId: r.monitored_trademark_id,
                markName: r.mark_name,
                applicationNo: r.application_no,
                niceClasses: r.nice_classes,
                similarityScore: r.similarity_score,
                holders: r.holders,
                imagePath: r.image_path
            }));

            allData = allData.concat(mappedData);
            offset += BATCH_SIZE;

            // Eğer gelen veri BATCH_SIZE'dan küçükse daha fazla veri kalmamıştır
            if (data.length < BATCH_SIZE) { 
                keepFetching = false; 
            }
            
        } catch (err) {
            console.error("Sonuçları çekerken hata:", err);
            throw err;
        }
    }
    return allData;
}