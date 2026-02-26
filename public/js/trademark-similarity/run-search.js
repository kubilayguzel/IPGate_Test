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
                    // 🔥 DÜZELTME 1: Kolon adları veritabanı şemanıza göre güncellendi
                    .select('status, current_results, total_records, error_message')
                    // 🔥 DÜZELTME 2: 'job_id' yerine 'id' kolonu arandı
                    .eq('id', jobId)
                    .single();

                if (error) throw error;

                if (data.status === 'processing') {
                    // 🔥 DÜZELTME 3: Gelen veriler yeni kolon adlarından okundu
                    onProgress({ status: 'processing', processed: data.current_results, total: data.total_records });
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

async function fetchResults(jobId, onProgress) {
    let allResults = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('search_progress_results')
            .select('*')
            .eq('job_id', jobId)
            // 🔥 DÜZELTME: 'created_at' yerine 'id' kolonuna göre sıralama yapıyoruz
            .order('id', { ascending: true }) 
            .range(offset, offset + limit - 1);

        if (error) {
            console.error("Sonuçları çekerken hata:", error);
            throw error;
        }

        if (data && data.length > 0) {
            allResults = allResults.concat(data);
            offset += limit;
        } else {
            hasMore = false;
        }
    }

    return allResults;
}