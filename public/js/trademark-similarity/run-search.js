// public/js/trademark-similarity/run-search.js
import { supabase } from '../../supabase-config.js'; // Kendi dizininize göre yolu kontrol edin

console.log(">>> run-search.js modülü yüklendi (Supabase & Realtime Versiyon) <<<");

export async function runTrademarkSearch(monitoredMarks, selectedBulletinId, onProgress) {
  try {
    console.log('🚀 Supabase Edge Function çağrılıyor...');

    // 1. İşlemi Başlat (Edge Function)
    const { data, error } = await supabase.functions.invoke('perform-trademark-similarity-search', {
      body: { monitoredMarks, selectedBulletinId, async: true }
    });

    if (error) throw error;
    if (!data || !data.success || !data.jobId) throw new Error('Job başlatılamadı');

    const jobId = data.jobId;
    const EXPECTED_WORKER_COUNT = data.workerCount || 10; 
    
    console.log(`✅ Job başlatıldı: ${jobId} (Beklenen Worker: ${EXPECTED_WORKER_COUNT})`);

    // 2. Takip Etme Mantığı (Supabase Realtime)
    return new Promise((resolve, reject) => {
      let mainState = { status: 'queued', currentResults: 0 };
      let workersState = {}; 
      let isJobFinished = false;
      let safetyTimeout;

      const cleanup = () => {
        if (safetyTimeout) clearTimeout(safetyTimeout);
        supabase.removeAllChannels(); // Realtime dinleyicileri kapat
      };

      const resetSafetyTimeout = () => {
          if (safetyTimeout) clearTimeout(safetyTimeout);
          safetyTimeout = setTimeout(() => {
              if (!isJobFinished) {
                  cleanup();
                  reject(new Error('İşlem zaman aşımına uğradı (Uzun süre işlem yapılmadı)'));
              }
          }, 30 * 60 * 1000); 
      };

      resetSafetyTimeout();

      // --- BİTİŞ KONTROLÜ ---
      const checkCompletion = async () => {
          if (isJobFinished) return;
          const workerKeys = Object.keys(workersState);
          
          if (workerKeys.length < EXPECTED_WORKER_COUNT) return;
          const allCompleted = workerKeys.every(key => workersState[key].status === 'completed');

          if (allCompleted) {
              isJobFinished = true;
              console.log(`✅ Tüm workerlar tamamlandı. İndirme başlıyor...`);
              
              if (onProgress) onProgress({ status: 'finalizing', message: 'Son veriler yazılıyor...' });
              await new Promise(r => setTimeout(r, 4000));
              cleanup(); 

              try {
                const finalCount = mainState.currentResults || 0;
                
                // Batch (Parçalı) İndirme
                const allResults = await getAllResultsInBatches(jobId, (downloadedCount) => {
                     if (onProgress) {
                         onProgress({
                            status: 'downloading',
                            progress: 100,
                            currentResults: finalCount,
                            message: `Veriler alınıyor... ${downloadedCount} / ${finalCount}`
                         });
                     }
                });
                
                console.log(`📥 ${allResults.length} adet sonuç başarıyla indirildi.`);
                resolve(allResults);
              } catch (err) { reject(new Error("Sonuçlar çekilemedi: " + err.message)); }
          }
      };

      // --- SUPABASE REALTIME KANALI ---
      const jobChannel = supabase.channel(`job-${jobId}`);

      // Ana tabloyu dinle
      jobChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'search_progress', filter: `id=eq.${jobId}` }, (payload) => {
        mainState.status = payload.new.status || mainState.status;
        mainState.currentResults = payload.new.current_results || 0; 
        if (mainState.status === 'error') { cleanup(); reject(new Error(payload.new.error_message || 'Arama hatası')); }
        updateGlobalProgress(); 
      });

      // Worker tablosunu dinle
      jobChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'search_progress_workers', filter: `job_id=eq.${jobId}` }, (payload) => {
        resetSafetyTimeout();
        workersState[payload.new.id] = payload.new;
        updateGlobalProgress();
        checkCompletion(); 
      });

      jobChannel.subscribe();

      function updateGlobalProgress() {
          if (isJobFinished) return;
          const workerKeys = Object.keys(workersState);
          let sumProgress = 0;
          workerKeys.forEach(key => { sumProgress += (workersState[key].progress || 0); });
          const globalProgress = Math.floor(sumProgress / EXPECTED_WORKER_COUNT);

          if (onProgress) {
              onProgress({
                  status: mainState.status === 'queued' ? 'processing' : mainState.status,
                  progress: globalProgress,
                  currentResults: mainState.currentResults,
                  message: null
              });
          }
      }
    });
  } catch (error) { throw error; }
}

// Büyük veriyi (70.000+) tarayıcıyı dondurmadan Supabase'den indirmek için
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

            allData = allData.concat(data);
            lastId = data[data.length - 1].id;
            
            if (onBatchLoaded) onBatchLoaded(allData.length);
            if (data.length < BATCH_SIZE) keepFetching = false;
        } catch (error) { throw error; }
    }
    return allData;
}