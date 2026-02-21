// public/js/components/TaskDetailManager.js
import { getFirestore, doc, getDoc, updateDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { formatToTRDate } from "../../utils.js";

const db = getFirestore();

export class TaskDetailManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        
        this.statusDisplayMap = {
            'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
            'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
            'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
            'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
            'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
        };
    }

    showLoading() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="d-flex flex-column align-items-center justify-content-center py-5">
                <div class="spinner-border text-primary mb-3" role="status"></div>
                <h6 class="text-muted font-weight-normal">Yükleniyor...</h6>
            </div>`;
    }

    showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="alert alert-light border-danger text-danger d-flex align-items-center m-3 shadow-sm" role="alert">
                <i class="fas fa-exclamation-circle mr-3 fa-lg"></i>
                <div>${message}</div>
            </div>`;
    }

    async render(task, options = {}) {
        if (!this.container) return;
        if (!task) { this.showError('İş kaydı bulunamadı.'); return; }

        this.showLoading();

        try {
            // --- ID 66: DEĞERLENDİRME İŞİ KONTROLÜ ---
            if (String(task.taskType) === '66') {
                await this._renderEvaluationEditor(task);
                return;
            }

            let { ipRecord, transactionType, assignedUser, accruals = [] } = options;

            // 1. ADIM: IP RECORD'U GARANTİLE
            if (!ipRecord && task.relatedIpRecordId) {
                try {
                    const ipDoc = await getDoc(doc(db, "ipRecords", task.relatedIpRecordId));
                    if (ipDoc.exists()) {
                        ipRecord = { id: ipDoc.id, ...ipDoc.data() };
                    }
                } catch (e) { console.warn("IP Record fetch error:", e); }
            }

            // 2. ADIM: MÜVEKKİL / İLGİLİ TARAF İSMİNİ ÇÖZÜMLE
            let relatedPartyTxt = '-';
            console.log("🔍 İlgili taraf çözümleme başlıyor...");

            // A) Task Details - relatedParties (çoğul, name zaten dolu)
            if (task.details && Array.isArray(task.details.relatedParties) && task.details.relatedParties.length > 0) {
                console.log("A aşaması - task.details.relatedParties var:", task.details.relatedParties);
                const manualNames = task.details.relatedParties
                    .map(p => (typeof p === 'object' ? (p.name || p.companyName) : p))
                    .filter(Boolean);
                console.log("A aşaması - manualNames:", manualNames);
                if (manualNames.length > 0) {
                    relatedPartyTxt = manualNames.join(', ');
                    console.log("✅ A aşamasından bulundu:", relatedPartyTxt);
                }
            }


            // B) IP Record -> Applicants -> Persons Tablosu
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && ipRecord && Array.isArray(ipRecord.applicants) && ipRecord.applicants.length > 0) {
                console.log("B aşaması başladı - ipRecord.applicants:", ipRecord.applicants);
                const applicantPromises = ipRecord.applicants.map(async (app) => {
                    if (app.name && app.name.trim() !== '') return app.name;
                    if (app.id) {
                        try {
                            const personSnap = await getDoc(doc(db, "persons", app.id));
                            if (personSnap.exists()) {
                                const pData = personSnap.data();
                                return pData.name || pData.companyName || null;
                            }
                        } catch (err) {}
                    }
                    return null;
                });
                const resolvedNames = await Promise.all(applicantPromises);
                const validNames = resolvedNames.filter(Boolean);
                console.log("B aşaması - validNames:", validNames);
                if (validNames.length > 0) {
                    relatedPartyTxt = validNames.join(', ');
                    console.log("✅ B aşamasından bulundu:", relatedPartyTxt);
                }
            } else {
                console.log("B aşaması atlandı - relatedPartyTxt:", relatedPartyTxt, "ipRecord var mı:", !!ipRecord);
            }

            // C) Task Owner -> Persons Tablosu (relatedParties yoksa)
            if ((!relatedPartyTxt || relatedPartyTxt === '-') && task.taskOwner) {
                console.log("✅ C aşaması başladı - taskOwner:", task.taskOwner);
                try {
                    // taskOwner array veya string olabilir
                    const ownerIds = Array.isArray(task.taskOwner) ? task.taskOwner : [task.taskOwner];
                    console.log("ownerIds:", ownerIds);
                    const ownerPromises = ownerIds.map(async (ownerId) => {
                        if (!ownerId) return null;
                        console.log("Owner ID sorgulanıyor:", ownerId);
                        try {
                            const ownerSnap = await getDoc(doc(db, "persons", ownerId));
                            if (ownerSnap.exists()) {
                                const ownerData = ownerSnap.data();
                                console.log("Owner bulundu:", ownerData);
                                return ownerData.name || ownerData.companyName || null;
                            } else {
                                console.log("Owner bulunamadı:", ownerId);
                            }
                        } catch (err) {
                            console.error("Owner fetch hatası:", err);
                        }
                        return null;
                    });
                    const ownerNames = await Promise.all(ownerPromises);
                    console.log("ownerNames:", ownerNames);
                    const validOwnerNames = ownerNames.filter(Boolean);
                    console.log("validOwnerNames:", validOwnerNames);
                    if (validOwnerNames.length > 0) {
                        relatedPartyTxt = validOwnerNames.join(', ');
                        console.log("✅ C aşamasından bulundu:", relatedPartyTxt);
                    }
                } catch (err) {
                    console.warn("Task owner fetch error:", err);
                }
            } else {
                console.log("C aşaması atlandı - relatedPartyTxt:", relatedPartyTxt, "taskOwner var mı:", !!task.taskOwner);
            }
            console.log("🎯 Final relatedPartyTxt:", relatedPartyTxt);

            // --- Veri Formatlama ---
            const assignedName = assignedUser ? (assignedUser.displayName || assignedUser.email) : (task.assignedTo_email || 'Atanmamış');
            const relatedRecordTxt = ipRecord ? (ipRecord.applicationNumber || ipRecord.title) : 'İlgili kayıt bulunamadı';
            const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : (task.taskType || '-');
            const statusText = this.statusDisplayMap[task.status] || task.status;

            // --- CSS STYLES (SADE & KURUMSAL) ---
            const styles = {
                container: `font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #333; background-color: #f8f9fa; padding: 20px;`,
                
                // Kart: Beyaz, çok hafif gölge, gri kenarlık
                card: `
                    background: #fff;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                    margin-bottom: 20px;
                    overflow: hidden;
                `,
                
                // Başlık: Temiz, koyu gri zemin değil, sadece alt çizgi
                cardHeader: `
                    padding: 15px 20px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    align-items: center;
                    font-size: 0.95rem;
                    font-weight: 700;
                    color: #1e3c72; /* Kurumsal Lacivert */
                    background-color: #fff;
                `,

                cardBody: `padding: 20px;`,
                
                // Etiket
                label: `
                    display: block;
                    font-size: 0.75rem;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: #8898aa;
                    margin-bottom: 6px;
                    letter-spacing: 0.5px;
                `,
                
                // Değer Kutusu
                valueBox: `
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 6px;
                    padding: 12px 16px;
                    font-size: 0.95rem;
                    font-weight: 500;
                    color: #2d3748;
                    display: flex;
                    align-items: center;
                    min-height: 45px;
                `
            };

            const accrualsHtml = this._generateAccrualsHtml(accruals);
            const docsContent = this._generateDocsHtml(task);

            const html = `
            <div style="${styles.container}">
                
                <div style="${styles.card} padding: 20px; display: flex; justify-content: space-between; align-items: center; border-top: 4px solid #1e3c72;">
                    <div>
                        <h5 class="mb-1" style="font-weight: 700; color: #2d3748;">${task.title || 'Başlıksız Görev'}</h5>
                        <div class="text-muted small">
                            <span class="mr-3"><i class="fas fa-hashtag mr-1"></i>${task.id}</span>
                            <span><i class="far fa-clock mr-1"></i>${this._formatDate(task.createdAt)}</span>
                        </div>
                    </div>
                    <span class="badge badge-pill px-3 py-2" style="font-size: 0.85rem; background-color: #1e3c72; color: #fff;">
                        ${statusText}
                    </span>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-star mr-2 text-warning"></i> TEMEL BİLGİLER
                    </div>
                    <div style="${styles.cardBody}">
                        
                        <div class="mb-4">
                            <label style="${styles.label}">İLGİLİ TARAF / MÜVEKKİL</label>
                            <div style="${styles.valueBox} border-left: 4px solid #1e3c72;">
                                 <i class="fas fa-user-tie text-primary mr-3 fa-lg" style="color: #1e3c72 !important;"></i>
                                 <span style="font-size: 1.1rem; font-weight: 600;">${relatedPartyTxt}</span>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">İLGİLİ VARLIK (DOSYA)</label>
                            <div style="${styles.valueBox}">
                                 <i class="fas fa-folder text-muted mr-3"></i>
                                 <span style="font-size: 1rem; font-weight: 500;">${relatedRecordTxt}</span>
                            </div>
                        </div>

                    </div>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-list-alt mr-2 text-muted"></i> GÖREV DETAYLARI
                    </div>
                    <div style="${styles.cardBody}">
                        <div class="row">
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">İŞ TİPİ</label>
                                <div style="${styles.valueBox}">${taskTypeDisplay}</div>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">ATANAN KİŞİ</label>
                                <div style="${styles.valueBox}">
                                    <i class="fas fa-user-circle text-muted mr-2"></i>${assignedName}
                                </div>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label style="${styles.label}">RESMİ BİTİŞ</label>
                                <div style="${styles.valueBox}">
                                    <i class="far fa-calendar-alt text-muted mr-2"></i>
                                    <span class="${task.officialDueDate ? 'text-danger font-weight-bold' : 'text-muted'}">
                                        ${this._formatDate(task.officialDueDate)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label style="${styles.label}">AÇIKLAMA</label>
                            <div style="${styles.valueBox} height: auto; align-items: flex-start; min-height: 60px; white-space: pre-wrap; line-height: 1.6; color: #525f7f;">${task.description || 'Açıklama girilmemiş.'}</div>
                        </div>
                    </div>
                </div>

                <div style="${styles.card}">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-paperclip mr-2 text-muted"></i> BELGELER
                    </div>
                    <div style="${styles.cardBody}">
                        ${docsContent}
                    </div>
                </div>

                <div style="${styles.card} margin-bottom: 0;">
                    <div style="${styles.cardHeader}">
                        <i class="fas fa-coins mr-2 text-muted"></i> TAHAKKUKLAR
                    </div>
                    <div style="${styles.cardBody}">
                        ${accrualsHtml}
                    </div>
                </div>

            </div>`;

            this.container.innerHTML = html;

        } catch (error) {
            console.error("Render hatası:", error);
            this.showError("Detaylar yüklenirken bir hata oluştu: " + error.message);
        }
    }

    // =========================================================================
    //  ID 66: GÖRSEL MAİL DEĞERLENDİRME EDİTÖRÜ (Düzeltildi)
    // =========================================================================
    async _renderEvaluationEditor(task) {
        this.showLoading();
        try {
            const mailSnap = await getDoc(doc(db, "mail_notifications", task.mail_notification_id));
            if (!mailSnap.exists()) throw new Error("İlişkili mail taslağı bulunamadı.");
            const mail = mailSnap.data();

            // --- EK DOSYALARI HAZIRLA (Aynen Korundu) ---
            const attachments = [];
            if (mail.epatsAttachment && (mail.epatsAttachment.downloadURL || mail.epatsAttachment.url)) {
                attachments.push({ name: mail.epatsAttachment.fileName || 'EPATS Belgesi.pdf', url: mail.epatsAttachment.downloadURL || mail.epatsAttachment.url, icon: 'fa-file-pdf', color: 'text-danger', label: 'RESMİ EPATS BELGESİ' });
            }
            if (mail.supplementaryAttachment && (mail.supplementaryAttachment.downloadURL || mail.supplementaryAttachment.url)) {
                attachments.push({ name: mail.supplementaryAttachment.fileName || 'Ek Belge', url: mail.supplementaryAttachment.downloadURL || mail.supplementaryAttachment.url, icon: 'fa-paperclip', color: 'text-primary', label: 'EK DOSYA' });
            }
            if (mail.files && Array.isArray(mail.files)) {
                mail.files.forEach(f => {
                    const fUrl = f.url || f.downloadURL;
                    const isDuplicate = attachments.some(existing => existing.url === fUrl);
                    if (fUrl && !isDuplicate) {
                        attachments.push({ name: f.name || f.fileName || 'Dosya', url: fUrl, icon: 'fa-file-alt', color: 'text-secondary', label: 'EKLENTİ' });
                    }
                });
            }

            let attachmentsHtml = '';
            if (attachments.length > 0) {
                const filesList = attachments.map(file => `
                    <div class="col-md-6 mb-3">
                        <div class="d-flex align-items-center justify-content-between p-3 rounded bg-white border h-100">
                            <div class="d-flex align-items-center overflow-hidden">
                                <i class="fas ${file.icon} ${file.color} fa-2x mr-3"></i>
                                <div class="text-truncate">
                                    <small class="text-muted font-weight-bold d-block" style="font-size: 0.65rem;">${file.label}</small>
                                    <span class="text-dark font-weight-bold text-truncate d-block" style="max-width: 180px; font-size:0.9rem;" title="${file.name}">${file.name}</span>
                                </div>
                            </div>
                            <a href="${file.url}" target="_blank" class="btn btn-sm btn-light border ml-2"><i class="fas fa-external-link-alt text-muted"></i></a>
                        </div>
                    </div>`).join('');
                attachmentsHtml = `<div class="mb-4"><label class="d-block small font-weight-bold text-muted text-uppercase mb-2">EKLİ DOSYALAR</label><div class="p-3 bg-light border rounded"><div class="row">${filesList}</div></div></div>`;
            } else {
                attachmentsHtml = `<div class="alert alert-light border text-muted small mb-4"><i class="fas fa-info-circle mr-2"></i>Ekli dosya yok.</div>`;
            }

            // --- HTML ÇIKTISI (YENİ BUTONLAR İLE) ---
            this.container.innerHTML = `
                <div class="card shadow-sm border-0">
                    <div class="card-header bg-white border-bottom py-3">
                        <div class="d-flex justify-content-between align-items-center">
                            <h5 class="mb-0 text-dark font-weight-bold"><i class="fas fa-edit mr-2 text-primary"></i>Değerlendirme Editörü</h5>
                            <span class="badge badge-light border">ID: ${task.id}</span>
                        </div>
                    </div>
                    <div class="card-body bg-white p-4">
                        ${attachmentsHtml}

                        <div class="mb-4">
                            <label class="d-block small font-weight-bold text-muted text-uppercase mb-2">KONU</label>
                            <input type="text" class="form-control font-weight-bold text-dark" value="${mail.subject}" readonly style="background-color: #f8f9fa;">
                        </div>

                        <div class="mb-4">
                             <label class="d-block small font-weight-bold text-muted text-uppercase mb-2">İÇERİK DÜZENLEME</label>
                             <div id="eval-body-editor" contenteditable="true" class="form-control p-3" style="min-height: 400px; height: auto; border: 1px solid #ced4da; line-height: 1.6;">${mail.body}</div>
                        </div>

                        <div class="d-flex justify-content-end pt-3 border-top">
                            <button id="btn-save-draft" class="btn btn-secondary px-4 mr-2 shadow-sm">
                                <i class="fas fa-save mr-2"></i>Kaydet (Taslak)
                            </button>
                            <button id="btn-submit-final" class="btn btn-success px-4 font-weight-bold shadow-sm">
                                <i class="fas fa-check-circle mr-2"></i>Kaydet ve İşi Bitir
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            // İki ayrı butona ayrı event listener ekliyoruz
            document.getElementById('btn-save-draft').onclick = () => this._saveEvaluationDraft(task);
            document.getElementById('btn-submit-final').onclick = () => this._submitEvaluationFinal(task);
        
        } catch (e) { 
            console.error("Evaluation render error:", e);
            this.showError("Hata: " + e.message); 
        }
    }

    // SADECE KAYDET (Taslak olarak kalır, sayfa yenilenmez)
    async _saveEvaluationDraft(task) {
        const newBody = document.getElementById('eval-body-editor').innerHTML;
        const btn = document.getElementById('btn-save-draft');
        const originalText = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Kaydediliyor...';

            // Sadece Mail Notification'ı güncelle, statüleri değiştirme
            await updateDoc(doc(db, "mail_notifications", task.mail_notification_id), {
                body: newBody,
                updatedAt: Timestamp.now()
            });

            // Kullanıcıya bildirim ver (Toast veya Alert yerine buton üzerinde gösterim daha şık)
            btn.innerHTML = '<i class="fas fa-check mr-2"></i>Kaydedildi';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-info');

            // 2 saniye sonra butonu eski haline getir
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                btn.classList.remove('btn-info');
                btn.classList.add('btn-secondary');
            }, 2000);

        } catch (e) {
            alert("Kaydetme hatası: " + e.message);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    // KAYDET VE BİTİR (İşi tamamlar, sayfayı yeniler)
    async _submitEvaluationFinal(task) {
        const newBody = document.getElementById('eval-body-editor').innerHTML;
        const btn = document.getElementById('btn-submit-final');
        
        if (!confirm("İşi tamamlayıp taslağı onaya göndermek üzeresiniz. Emin misiniz?")) return;

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>İşleniyor...';

            // 1. Mail bildirimini onaya gönder statüsüne çek
            await updateDoc(doc(db, "mail_notifications", task.mail_notification_id), {
                body: newBody,
                status: "awaiting_client_approval", // Onay bekliyor statüsü
                updatedAt: Timestamp.now()
            });

            // 2. Task'ı tamamlandı yap
            await updateDoc(doc(db, "tasks", task.id), {
                status: "completed",
                updatedAt: Timestamp.now()
            });

            alert("İşlem başarıyla tamamlandı. Mail onaya sunuldu.");
            window.location.reload(); // Listeyi yenilemek için sayfayı tazele

        } catch (e) {
            alert("Güncelleme hatası: " + e.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Kaydet ve İşi Bitir';
        }
    }

    // =========================================================================
    //  YARDIMCI METODLAR (SADE)
    // =========================================================================
    _generateDocsHtml(task) {
        let items = [];
        const epatsDoc = task.details?.epatsDocument;
        const epatsUrl = epatsDoc?.downloadURL || epatsDoc?.url;

        if (epatsDoc && epatsUrl) {
            items.push(`
                <a href="${epatsUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border" style="border-left: 3px solid #d63384 !important;">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-file-pdf text-danger fa-lg mr-3"></i>
                        <div class="text-truncate">
                            <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">EPATS Belgesi</span>
                            <span class="d-block text-muted small text-truncate">${epatsDoc.name}</span>
                        </div>
                    </div>
                    <i class="fas fa-external-link-alt text-muted small"></i>
                </a>
            `);
        }

        let allFiles = [];
        const addFiles = (source) => {
            if (!source) return;
            if (Array.isArray(source)) allFiles.push(...source);
            else if (typeof source === 'object') allFiles.push(...Object.values(source));
        };
        if (task.details) { addFiles(task.details.documents); addFiles(task.details.files); }
        addFiles(task.files); addFiles(task.documents);

        const seenUrls = new Set();
        if (epatsUrl) seenUrls.add(epatsUrl);

        allFiles.forEach(file => {
            const fUrl = file.downloadURL || file.url || file.content;
            if (fUrl && !seenUrls.has(fUrl)) {
                seenUrls.add(fUrl);
                items.push(`
                    <a href="${fUrl}" target="_blank" class="d-flex align-items-center justify-content-between p-3 mb-2 rounded text-decoration-none bg-white border">
                        <div class="d-flex align-items-center overflow-hidden">
                            <i class="fas fa-paperclip text-muted fa-lg mr-3"></i>
                            <div class="text-truncate" style="max-width: 250px;">
                                <span class="d-block text-dark font-weight-bold" style="font-size: 0.9rem;">Dosya</span>
                                <small class="text-muted text-truncate d-block">${file.name || 'Adsız'}</small>
                            </div>
                        </div>
                        <i class="fas fa-download text-muted small"></i>
                    </a>
                `);
            }
        });

        return items.length ? items.join('') : `<div class="text-muted small font-italic p-2">Ekli belge bulunmuyor.</div>`;
    }

    _generateAccrualsHtml(accruals) {
        if (!accruals || accruals.length === 0) return `<div class="text-muted small font-italic p-2">Bağlı tahakkuk bulunmuyor.</div>`;
        return accruals.map(acc => {
            let statusColor = '#f39c12'; // Default warning
            let statusText = 'Ödenmedi';
            
            if(acc.status === 'paid') { statusColor = '#27ae60'; statusText = 'Ödendi'; }
            else if(acc.status === 'cancelled') { statusColor = '#95a5a6'; statusText = 'İptal'; }

            return `
            <div class="d-flex justify-content-between align-items-center p-3 mb-2 rounded bg-white border">
                <div class="d-flex align-items-center">
                    <span class="badge badge-light border mr-3">#${acc.id}</span>
                    <span class="font-weight-bold text-dark" style="font-size: 0.95rem;">${this._formatCurrency(acc.totalAmount, acc.totalAmountCurrency)}</span>
                </div>
                <div class="text-right">
                    <span class="badge badge-pill text-white" style="background-color: ${statusColor}; font-size: 0.75rem;">${statusText}</span>
                    <div class="text-muted small mt-1">${this._formatDate(acc.createdAt)}</div>
                </div>
            </div>`;
        }).join('');
    }

    _formatDate(dateVal) {
        return formatToTRDate(dateVal); // utils'deki fonksiyonu kullanır
    }

    _formatCurrency(amount, currency) {
        if (Array.isArray(amount)) return amount.map(i => `${i.amount} ${i.currency}`).join(', ');
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: currency || 'TRY' }).format(amount || 0);
    }

    /**
     * Marka Başvuru Özetini Gösteren Metot
     */
    showApplicationSummary(task) {
        const container = document.getElementById('applicationSummaryContent');
        const goToBtn = document.getElementById('btnGoToTaskUpdate');
        
        // "İşe Git" butonunun linkini ayarla
        if (goToBtn) {
            goToBtn.href = `task-update.html?id=${task.id}`;
        }

        if (!container) return;

        const d = task.details || {}; 

        // --- VERİLERİ HAZIRLA ---
        const brandName = d.brandName || d.brandExampleText || '-'; 
        const brandType = d.brandType || '-';
        const brandCategory = d.brandCategory || '-';
        const nonLatin = d.nonLatinAlphabet || '-';
        
        let origin = d.originSelect || 'Türkiye';
        if (d.originSelect === 'Yurtdışı Ulusal' && d.countrySelect) {
            origin += ` (${d.countrySelect})`;
        }

        // Sınıflar (Liste Görünümü)
        let classHtml = '<span class="text-muted font-italic">Seçim Yok</span>';
        if (d.niceClasses && Array.isArray(d.niceClasses) && d.niceClasses.length > 0) {
            const listItems = d.niceClasses.map(c => {
                const val = typeof c === 'object' ? `(${c.classNo}) ${c.description || ''}` : c;
                return `<div class="border-bottom py-2 pl-2 mb-1 small"><i class="fas fa-layer-group text-info mr-2"></i>${val}</div>`;
            }).join('');
            classHtml = `<div class="bg-light rounded p-2" style="max-height: 250px; overflow-y: auto;">${listItems}</div>`;
        }
        if (d.customClassDefinition) {
            classHtml += `<div class="mt-2 p-2 alert alert-warning small border-warning"><i class="fas fa-exclamation-circle mr-1"></i><strong>Özel Tanım:</strong> ${d.customClassDefinition}</div>`;
        }

        // Başvuru Sahipleri (Etiket Görünümü)
        let applicantsHtml = '<span class="text-muted font-italic">Seçilmedi</span>';
        if (d.selectedApplicants && d.selectedApplicants.length > 0) {
            applicantsHtml = d.selectedApplicants.map(a => 
                `<span class="badge badge-light border text-dark p-2 mr-1 mb-1" style="font-size: 0.9em;"><i class="fas fa-user mr-1 text-secondary"></i>${a.name || a.applicantName}</span>`
            ).join(' ');
        }

        // Rüçhanlar
        let priorityHtml = '<span class="text-muted font-italic">Yok</span>';
        if (d.priorities && d.priorities.length > 0) {
            priorityHtml = '<ul class="list-group list-group-flush small border rounded">' + 
                d.priorities.map(p => 
                    `<li class="list-group-item bg-transparent pl-3 py-2">
                        <strong>${p.type || 'Rüçhan'}:</strong> ${p.country} - ${p.number} 
                        <span class="badge badge-info ml-2">${p.date}</span>
                    </li>`
                ).join('') + 
                '</ul>';
        }

        // Görsel Alanı
        let imageHtml = `
            <div class="text-center py-5 text-muted bg-light rounded border border-light">
                <i class="fas fa-image fa-3x mb-2 text-secondary"></i><br>Görsel Yok
            </div>`;
            
        if (task.documents && task.documents.length > 0) {
            const imgDoc = task.documents.find(doc => doc.name.match(/\.(jpg|jpeg|png|gif)$/i));
            if (imgDoc) {
                imageHtml = `
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-white text-center font-weight-bold small text-muted">MARKA ÖRNEĞİ</div>
                        <div class="card-body p-2 text-center bg-light">
                            <img src="${imgDoc.downloadURL || imgDoc.url}" class="img-fluid rounded shadow-sm" style="max-height: 300px; object-fit: contain;">
                        </div>
                        <div class="card-footer bg-white text-center">
                            <a href="${imgDoc.downloadURL || imgDoc.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                                <i class="fas fa-search-plus mr-1"></i>Büyüt / İndir
                            </a>
                        </div>
                    </div>`;
            }
        }

        // --- HTML ŞABLONU (GRID YAPISI) ---
        const html = `
            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm border-0 h-100">
                        <div class="card-body p-0">
                            <table class="table table-bordered mb-0">
                                <tbody>
                                    <tr>
                                        <th style="width: 25%;" class="bg-light align-middle text-dark">Marka Adı / İbare</th>
                                        <td class="align-middle text-primary font-weight-bold lead p-3">${brandName}</td>
                                    </tr>
                                    <tr><th class="bg-light align-middle">Marka Tipi / Türü</th><td class="align-middle">${brandType} / ${brandCategory}</td></tr>
                                    ${nonLatin !== '-' ? `<tr><th class="bg-light align-middle">Latin Dışı Harf</th><td class="align-middle">${nonLatin}</td></tr>` : ''}
                                    <tr><th class="bg-light align-middle">Menşe</th><td class="align-middle">${origin}</td></tr>
                                    <tr><th class="bg-light align-middle">Başvuru Sahipleri</th><td class="align-middle">${applicantsHtml}</td></tr>
                                    <tr><th class="bg-light align-top pt-3">Mal/Hizmet Sınıfları</th><td class="p-3">${classHtml}</td></tr>
                                    <tr><th class="bg-light align-top pt-3">Rüçhan Bilgileri</th><td class="p-3">${priorityHtml}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="col-lg-4">
                    ${imageHtml}
                    
                    <div class="alert alert-info mt-3 shadow-sm border-info" style="font-size: 0.9em;">
                        <div class="d-flex">
                            <i class="fas fa-info-circle fa-2x mr-3 mt-1"></i>
                            <div>
                                <strong>Bilgi:</strong><br>
                                Bu pencere sadece başvuru verilerini özetler. İşle ilgili notlar ve diğer dosyalar için "İşe Git" butonunu kullanabilirsiniz.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;

        // Modalı Aç (jQuery ile)
        if (window.$) {
            $('#applicationSummaryModal').modal('show');
        }
    }
}