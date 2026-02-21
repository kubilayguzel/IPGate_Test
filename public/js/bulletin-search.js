import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db } from "../firebase-config.js";
import { loadSharedLayout } from "../js/layout-loader.js";

console.log("✅ bulletin-search.js yüklendi!");

// Sayfa açılışında layout yükle
loadSharedLayout({ activeMenuLink: "bulletin-search.html" });

document.getElementById("searchButton").addEventListener("click", async () => {
  const type = document.getElementById("bulletinType").value;
  const bulletinNo = document.getElementById("bulletinNo").value.trim();

  console.log("Sorgu başladı:", { type, bulletinNo });

  if (!bulletinNo) {
    alert("Lütfen bülten numarası girin.");
    return;
  }

  const recordsContainer = document.getElementById("recordsContainer");
  recordsContainer.innerHTML = "<p>Aranıyor...</p>";

  try {
    // trademarkBulletins koleksiyonundan belgeyi bul
    const bulletinQuery = query(
      collection(db, "trademarkBulletins"),
      where("type", "==", type.toLowerCase()),
      where("bulletinNo", "==", bulletinNo)
    );

    const bulletinSnapshot = await getDocs(bulletinQuery);

    if (bulletinSnapshot.empty) {
      recordsContainer.innerHTML = "<p>Belirtilen kriterlerde bülten bulunamadı.</p>";
      return;
    }

    const bulletinId = bulletinSnapshot.docs[0].id;

    // trademarkRecords koleksiyonundan bültene ait kayıtları getir
    const recordsQuery = query(
      collection(db, "trademarkRecords"),
      where("bulletinId", "==", bulletinId)
    );

    const recordsSnapshot = await getDocs(recordsQuery);

    if (recordsSnapshot.empty) {
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
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>`;

    const storage = getStorage();
    for (const doc of recordsSnapshot.docs) {
      const r = doc.data();
      let imageUrl = "";
      if (r.imagePath) {
        try {
          const fileRef = ref(storage, r.imagePath);
          imageUrl = await getDownloadURL(fileRef);
        } catch (err) {
          console.warn("Görsel URL alınamadı:", err);
        }
      }

      html += `
        <tr>
          <td>${r.applicationNo || "-"}</td>
          <td>${imageUrl ? `<img src="${imageUrl}" class="marka-image">` : "-"}</td>
          <td>${r.markName || "-"}</td>
          <td>${(r.attorneys?.[0] || "-")}</td>
          <td>${r.applicationDate || "-"}</td>
          <td>${r.niceClasses || "-"}</td>
          <td><button class="action-btn" onclick='showGoods(${JSON.stringify(r.goods || [])})'>Eşyalar</button></td>
        </tr>`;
    }

    html += "</tbody></table></div>";
    recordsContainer.innerHTML = html;

  } catch (err) {
    console.error("Sorgulama hatası:", err);
    recordsContainer.innerHTML = "<p>Bir hata oluştu. Konsolu kontrol edin.</p>";
  }
});

// Modal açma fonksiyonu
window.showGoods = (goods) => {
  const modal = document.getElementById("goodsModal");
  const list = document.getElementById("goodsList");
  list.innerHTML = goods.length
    ? goods.map(g => `<li>${g}</li>`).join("")
    : "<li>Tanımlı eşya yok.</li>";
  modal.style.display = "flex";
};

document.getElementById("closeGoodsModal").addEventListener("click", () => {
  document.getElementById("goodsModal").style.display = "none";
});
