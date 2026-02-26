// public/js/bulletin-search.js
import { supabase } from "../supabase-config.js";
import { loadSharedLayout } from "../js/layout-loader.js";

console.log("✅ bulletin-search.js yüklendi (Supabase Uyumlu)!");

loadSharedLayout({ activeMenuLink: "bulletin-search.html" });

document.getElementById("searchButton").addEventListener("click", async () => {
  const type = document.getElementById("bulletinType").value;
  const bulletinNo = document.getElementById("bulletinNo").value.trim();

  if (!bulletinNo) {
    alert("Lütfen bülten numarası girin.");
    return;
  }

  const recordsContainer = document.getElementById("recordsContainer");
  recordsContainer.innerHTML = "<p>Aranıyor...</p>";

  try {
    // 1. Bültenin varlığını kontrol et
    const { data: bulletinData, error: bulletinError } = await supabase
      .from("trademark_bulletins")
      .select("*")
      .eq("bulletin_no", bulletinNo)
      .limit(1);

    if (bulletinError || !bulletinData || bulletinData.length === 0) {
      recordsContainer.innerHTML = "<p>Belirtilen kriterlerde bülten bulunamadı. Lütfen önce bülteni yükleyin.</p>";
      return;
    }

    // 2. Bültene ait kayıtları (Markaları) getir
    // 🔥 DÜZELTME: Limit eklenmediğinde Supabase 1000'de keser veya sayfa donar. Limit 5000'e çekildi.
    const { data: records, error: recordsError } = await supabase
      .from("trademark_bulletin_records")
      .select("*")
      .eq("bulletin_no", bulletinNo)
      .limit(5000); 

    if (recordsError || !records || records.length === 0) {
      recordsContainer.innerHTML = "<p>Bu bültene ait kayıt bulunamadı.</p>";
      return;
    }

    let html = `
      <div class="tasks-container">
      <table class="tasks-table">
        <thead>
          <tr>
            <th>Başvuru No</th>
            <th>Marka Örneği</th>
            <th>Marka Adı</th>
            <th>Hak Sahibi / Vekil</th>
            <th>Başvuru Tarihi</th>
            <th>Sınıflar</th>
          </tr>
        </thead>
        <tbody>`;

    for (const r of records) {
      let imageUrl = "";
      if (r.image_path) {
        // Supabase Storage'dan Public URL al
        const { data } = supabase.storage.from("brand_images").getPublicUrl(r.image_path);
        imageUrl = data.publicUrl || "";
      }

      html += `
        <tr>
          <td>${r.application_no || "-"}</td>
          <td>${imageUrl ? `<img src="${imageUrl}" loading="lazy" class="marka-image" style="max-height: 60px; object-fit: contain;">` : "-"}</td>
          <td>${r.mark_name || "-"}</td>
          <td>${r.holders || "-"}</td>
          <td>${r.application_date || "-"}</td>
          <td>${r.nice_classes || "-"}</td>
        </tr>`;
    }

    html += "</tbody></table></div>";
    recordsContainer.innerHTML = html;

  } catch (err) {
    console.error("Sorgulama hatası:", err);
    recordsContainer.innerHTML = "<p>Bir hata oluştu. Konsolu kontrol edin.</p>";
  }
});