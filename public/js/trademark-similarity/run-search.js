// public/js/trademark-similarity/run-search.js
import { supabase } from '../../supabase-config.js'; // Kendi dizininize göre yolu kontrol edin

console.log(">>> run-search.js modülü yüklendi (Supabase & Realtime Versiyon) <<<");

// public/js/trademark-similarity/run-search.js

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
    try {
        console.log("🚀 Supabase Edge Function tetikleniyor...", { monitoredMarks: monitoredMarks.length, selectedBulletinId });

        // 🔥 GÜNCELLEME: İsteği 'functions.invoke' ile atıyoruz
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
            // search_progress tablosundan durumu kontrol et
            const { data, error } = await supabase
                .from('search_progress')
                .select('*')
                .eq('id', jobId)
                .single();

            if (error) {
                console.error("İlerleme okuma hatası:", error);
                return;
            }

            if (data) {
                const progress = Math.floor((data.current_results / data.total_records) * 100) || 0;
                
                if (onProgress) {
                    onProgress({
                        progress: progress,
                        currentResults: data.current_results
                    });
                }

                if (data.status === 'completed') {
                    clearInterval(interval);
                    // Tüm sonuçları search_progress_results tablosundan çek
                    const results = await getAllResults(jobId);
                    resolve(results);
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    reject(new Error(data.error_message || "Arama sırasında hata oluştu."));
                }
            }
        }, 3000); // 3 saniyede bir kontrol et
    });
}

async function getAllResults(jobId) {
    const { data, error } = await supabase
        .from('search_progress_results')
        .select('*')
        .eq('job_id', jobId);
    
    if (error) throw error;
    
    // UI'ın beklediği formata (camelCase) çevir
    return data.map(r => ({
        id: r.id,
        monitoredTrademarkId: r.monitored_trademark_id,
        markName: r.mark_name,
        applicationNo: r.application_no,
        niceClasses: r.nice_classes,
        similarityScore: r.similarity_score,
        holders: r.holders,
        imagePath: r.image_path,
        isSimilar: false // Arama motorundan gelenler varsayılan benzerdir
    }));
}

async function getAllResultsInBatches(jobId, onBatchLoaded) {
    let allData = [];
    const BATCH_SIZE = 2000; 
    let keepFetching = true;
    let lastId = '00000000-0000-0000-0000-000000000000'; // UUID cursor

    while (keepFetching) {
        try {
            const { data, error } = await supabase
                .from('search_progress_results')
                .select('*')
                .eq('job_id', jobId)
                .gt('id', lastId)
                .order('id', { ascending: true })
                .limit(BATCH_SIZE);

            if (error) throw error;
            if (!data || data.length === 0) { keepFetching = false; break; }

            // 🚀 DB'den gelen snake_case veriyi, UI'ın beklediği camelCase formata çeviriyoruz!
            const mappedData = data.map(r => ({
                id: r.id,
                objectID: r.id, // Eski Firebase uyumluluğu için
                monitoredTrademarkId: r.monitored_trademark_id,
                markName: r.mark_name,
                applicationNo: r.application_no,
                niceClasses: r.nice_classes,
                similarityScore: r.similarity_score,
                holders: r.holders,
                imagePath: r.image_path
            }));

            allData = allData.concat(mappedData);
            lastId = data[data.length - 1].id;
            
            if (onBatchLoaded) onBatchLoaded(allData.length);
            if (data.length < BATCH_SIZE) keepFetching = false;
        } catch (error) { throw error; }
    }
    return allData;
}