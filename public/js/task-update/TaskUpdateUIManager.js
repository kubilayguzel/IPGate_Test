import { formatFileSize, TASK_STATUSES } from '../../utils.js';

export class TaskUpdateUIManager {
    constructor() {
        this.elements = {
            title: document.getElementById('taskTitle'),
            desc: document.getElementById('taskDescription'),
            priority: document.getElementById('taskPriority'),
            status: document.getElementById('taskStatus'),
            taskIdDisplay: document.getElementById('taskIdDisplay'),
            assignedDisplay: document.getElementById('assignedToDisplay'),
            dueDate: document.getElementById('taskDueDate'),
            deliveryDate: document.getElementById('deliveryDate'),
            
            filesContainer: document.getElementById('fileListContainer'),
            epatsContainer: document.getElementById('epatsFileListContainer'), // EPATS listesi
            accrualsContainer: document.getElementById('accrualsContainer'),
            
            ipSearch: document.getElementById('relatedIpRecordSearch'),
            ipResults: document.getElementById('relatedIpRecordSearchResults'),
            ipDisplay: document.getElementById('selectedIpRecordDisplay'),
            
            partySearch: document.getElementById('relatedPartySearch'),
            partyResults: document.getElementById('relatedPartySearchResults'),
            partyDisplay: document.getElementById('selectedRelatedPartyDisplay')
        };
    }

    fillForm(task, users) {
        this.elements.title.value = task.title || '';
        this.elements.desc.value = task.description || '';
        this.elements.priority.value = task.priority || 'medium';
        this.elements.dueDate.value = this.formatDateForInput(task.dueDate);
        this.elements.deliveryDate.value = this.formatDateForInput(task.deliveryDate);
        
        const typeParts = (task.taskType || '').split('_');
        const main = typeParts[0] || '';
        const sub = typeParts.slice(1).join(' ');
        this.elements.taskIdDisplay.value = task.id ? `#${task.id}` : '-';

        const user = users.find(u => u.id === task.assignedTo_uid);
        this.elements.assignedDisplay.value = user ? (user.displayName || user.email) : 'Atanmamış';

        this.populateStatusDropdown(task.status);
    }

    populateStatusDropdown(currentStatus) {
        this.elements.status.innerHTML = '';
        TASK_STATUSES.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.value;
            opt.textContent = s.text;
            if (s.value === currentStatus) opt.selected = true;
            this.elements.status.appendChild(opt);
        });
    }

    renderDocuments(docs) {
        // 1. Diziyi ikiye ayır: EPATS olanlar ve Diğerleri
        const epatsDoc = docs.find(d => d.type === 'epats_document');
        const standardDocs = docs.filter(d => d.type !== 'epats_document');

        // 2. Normal belgeleri aşağıdaki genel listeye bas
        const container = this.elements.filesContainer;
        if (!standardDocs || standardDocs.length === 0) {
            container.innerHTML = '<p class="text-center text-muted p-3">Belge yok.</p>';
        } else {
            container.innerHTML = standardDocs.map(d => this._createFileItemHtml(d, false)).join('');
        }

        // 3. EPATS belgesini yukarıdaki Resmi Kurum Evrakı alanına bas
        this.renderEpatsDocument(epatsDoc || null);
    }

    renderEpatsDocument(doc) {
        const container = this.elements.epatsContainer;
        const noInput = document.getElementById('turkpatentEvrakNo');
        const dateInput = document.getElementById('epatsDocumentDate');

        // Form alanlarını doldur
        if (doc) {
            // Eğer doc içinde kayıtlı veri varsa onu kullan, yoksa inputtakini koru
            if (doc.turkpatentEvrakNo) noInput.value = doc.turkpatentEvrakNo;
            
            if (doc.documentDate) {
                const formattedDate = this.formatDateForInput(doc.documentDate);
                dateInput.value = formattedDate;
                
                // 🔥 ÇÖZÜM: Date Picker (Flatpickr) Görselini Güncelleme
                if (dateInput._flatpickr) {
                    dateInput._flatpickr.setDate(formattedDate, true);
                }
            }
        } else {
            // Belge yoksa inputları temizle
            if (noInput) noInput.value = '';
            if (dateInput) {
                dateInput.value = '';
                if (dateInput._flatpickr) dateInput._flatpickr.clear();
            }
            container.innerHTML = '';
            return;
        }

        // Görseli oluştur (file-item stili)
        container.innerHTML = this._createFileItemHtml(doc, true);
    }

    // Ortak HTML Oluşturucu (Kod tekrarını önler)
    _createFileItemHtml(d, isEpats) {
        const removeBtnId = isEpats ? 'id="removeEpatsFileBtn"' : `data-id="${d.id}"`;
        const removeClass = isEpats ? 'btn-danger' : 'btn-outline-danger btn-remove-file';
        const iconColor = isEpats ? '#d63384' : '#e74c3c'; // EPATS için pembe, normal için kırmızı
        const subText = isEpats ? '<span class="badge badge-info ml-2">EPATS</span>' : '';

        return `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-file-pdf file-icon" style="color: ${iconColor};"></i>
                    <div class="file-details">
                        <div class="d-flex align-items-center">
                            <a href="${d.downloadURL || d.url}" target="_blank" class="file-name">${d.name}</a>
                            ${subText}
                        </div>
                        <span class="file-size">${formatFileSize(d.size)}</span>
                    </div>
                </div>
                <div class="file-actions">
                    <a href="${d.downloadURL || d.url}" target="_blank" class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-download"></i>
                    </a>
                    <button type="button" class="btn btn-sm ${removeClass}" ${removeBtnId}>
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    renderSelectedIpRecord(record) {
        const display = this.elements.ipDisplay;
        if (!record) {
            display.style.display = 'none';
            this.elements.ipSearch.value = '';
            return;
        }
        display.innerHTML = `
            <div>
                <strong>${record.title}</strong>
                <br><small>Başvuru: <span id="displayAppNumber">${record.applicationNumber || '-'}</span></small>
            </div>
            <button type="button" class="btn btn-sm text-danger" id="removeIpRecordBtn">&times;</button>
        `;
        display.style.display = 'flex';
        this.elements.ipSearch.value = '';
        this.elements.ipResults.style.display = 'none';
    }

    renderSelectedPerson(person) {
        const display = this.elements.partyDisplay;
        if (!person) {
            display.style.display = 'none';
            this.elements.partySearch.value = '';
            return;
        }
        display.innerHTML = `
            <div>
                <strong>${person.name}</strong>
                <br><small>${person.email || '-'}</small>
            </div>
            <button type="button" class="btn btn-sm text-danger" id="removeRelatedPartyBtn">&times;</button>
        `;
        display.style.display = 'flex';
        this.elements.partySearch.value = '';
        this.elements.partyResults.style.display = 'none';
    }
    
// --- BAŞVURU MODALI (SADE TASARIM) ---
    ensureApplicationDataModal() {
        if (document.getElementById('applicationDataModal')) return;

        const modalHtml = `
        <div class="modal fade" id="applicationDataModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static" data-keyboard="false">
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content shadow-sm">
                    
                    <div class="modal-header bg-light text-dark border-bottom">
                        <h5 class="modal-title font-weight-bold">
                            <i class="fas fa-file-contract mr-2"></i>Başvuru Bilgileri
                        </h5>
                    </div>

                    <div class="modal-body p-4">
                        <div class="alert alert-secondary border-0 mb-4" style="font-size: 0.9em;">
                            <i class="fas fa-info-circle mr-1"></i>
                            Yüklenen evrak bir başvuru işlemidir. Lütfen ilgili varlığın (Marka/Patent) başvuru bilgilerini güncelleyiniz.
                        </div>

                        <div class="form-group">
                            <label class="font-weight-bold mb-1">Başvuru Numarası</label>
                            <input type="text" id="modalAppNumber" class="form-control" placeholder="Örn: 2025/12345">
                            <small class="text-muted">Bu bilgi Marka/Patent kartına işlenecektir.</small>
                        </div>

                        <div class="form-group mb-0">
                            <label class="font-weight-bold mb-1">Başvuru Tarihi</label>
                            <input type="date" id="modalAppDate" class="form-control">
                        </div>
                    </div>

                    <div class="modal-footer bg-light border-top">
                        <button type="button" class="btn btn-primary px-4" id="btnSaveApplicationData">
                            <i class="fas fa-check mr-2"></i>Kaydet ve Kapat
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    formatDateForInput(date) {
        if (!date) return '';
        try {
            const d = (typeof date === 'object' && date.toDate) ? date.toDate() : new Date(date);
            if (isNaN(d.getTime())) return '';
            return d.toISOString().split('T')[0];
        } catch { return ''; }
    }

    ensureRenewalDataModal() {
    if (document.getElementById('renewalDataModal')) return;

    const modalHtml = `
    <div class="modal fade" id="renewalDataModal" tabindex="-1" role="dialog" aria-hidden="true" data-backdrop="static" data-keyboard="false">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content shadow-sm">
                <div class="modal-header bg-light text-dark border-bottom">
                    <h5 class="modal-title font-weight-bold">
                        <i class="fas fa-redo mr-2"></i>Yenileme Bilgileri
                    </h5>
                </div>
                <div class="modal-body p-4">
                    <div id="renewalWarningArea" class="alert alert-warning border-0 mb-4" style="display: none; font-size: 0.9em;">
                        <i class="fas fa-exclamation-triangle mr-1"></i>
                        <span id="renewalWarningText"></span>
                    </div>
                    <div class="form-group mb-0">
                        <label class="font-weight-bold mb-1">Yeni Koruma (Yenileme) Tarihi</label>
                        <input type="date" id="modalRenewalDate" class="form-control">
                        <small class="text-muted d-block mt-1">Yenileme işlemi sonrası geçerli olacak yeni koruma tarihini giriniz.</small>
                    </div>
                </div>
                <div class="modal-footer bg-light border-top">
                    <button type="button" class="btn btn-primary px-4" id="btnSaveRenewalData">
                        <i class="fas fa-check mr-2"></i>Kaydet ve Kapat
                    </button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

renderApplicationSummaryModalContent(task, masterPersons = []) {
    const container = document.getElementById('applicationSummaryContent');
    if (!container) return;

    const d = task.details || {}; 

    // 1. Verileri Hazırla
    const brandName = d.brandName || d.brandExampleText || '-'; 
    const brandType = d.brandType || '-';
    const brandCategory = d.brandCategory || '-';
    const nonLatin = d.nonLatinAlphabet || '-';

    // Menşe
    let origin = d.originSelect || 'Türkiye';
    if (d.originSelect === 'Yurtdışı Ulusal' && d.countrySelect) {
        origin += ` (${d.countrySelect})`;
    }

    // Sınıflar (Nice Classes)
    let classHtml = '<span class="text-muted">Seçim Yok</span>';
    if (d.niceClasses && Array.isArray(d.niceClasses) && d.niceClasses.length > 0) {
        const listItems = d.niceClasses.map(c => {
            const val = typeof c === 'object' ? `(${c.classNo}) ${c.description || ''}` : c;
            return `<div class="border-bottom py-2 pl-2 bg-white mb-1 rounded small">${val}</div>`;
        }).join('');
        classHtml = `<div style="max-height: 200px; overflow-y: auto; background:#f8f9fa; padding:5px; border-radius:4px;">${listItems}</div>`;
    }
    if (d.customClassDefinition) {
        classHtml += `<div class="mt-2 p-2 alert alert-warning small"><strong>Özel Tanım:</strong> ${d.customClassDefinition}</div>`;
    }

    // Başvuru Sahipleri
    let applicantsHtml = '<span class="text-danger">Seçilmedi</span>';
    if (d.selectedApplicants && d.selectedApplicants.length > 0) {
        applicantsHtml = d.selectedApplicants.map(a => 
            `<span class="badge badge-light border text-dark p-2 mr-1 mb-1"><i class="fas fa-user mr-1"></i>${a.name || a.applicantName}</span>`
        ).join(' ');
    }

    // Rüçhanlar
    let priorityHtml = '<span class="text-muted">Yok</span>';
    if (d.priorities && d.priorities.length > 0) {
        priorityHtml = '<ul class="list-group list-group-flush small">' + 
            d.priorities.map(p => 
                `<li class="list-group-item bg-transparent pl-0 py-1">
                    <strong>${p.type || 'Rüçhan'}:</strong> ${p.country} - ${p.number} 
                    <span class="badge badge-secondary ml-1">${p.date}</span>
                </li>`
            ).join('') + 
            '</ul>';
    }

    // Marka Görseli
    let imageHtml = '<div class="text-muted small font-italic">Görsel bulunamadı</div>';
    if (task.documents && task.documents.length > 0) {
        const imgDoc = task.documents.find(doc => doc.name.match(/\.(jpg|jpeg|png|gif)$/i));
        if (imgDoc) {
            imageHtml = `
                <div class="text-center p-2 border rounded bg-white">
                    <img src="${imgDoc.downloadURL || imgDoc.url}" class="img-fluid" style="max-height: 180px; object-fit: contain;">
                    <div class="mt-1 small text-muted">${imgDoc.name}</div>
                    <a href="${imgDoc.downloadURL || imgDoc.url}" target="_blank" class="btn btn-xs btn-outline-primary mt-1">İndir / Büyüt</a>
                </div>`;
        }
    }

    // 2. HTML Şablonu
    const html = `
        <div class="row">
            <div class="col-lg-8">
                <div class="card shadow-sm mb-3 border-0">
                    <div class="card-body p-0">
                        <table class="table table-bordered table-striped mb-0 small">
                            <tbody>
                                <tr>
                                    <th style="width: 30%;" class="bg-white text-dark">Marka Adı / İbare</th>
                                    <td class="text-primary font-weight-bold lead">${brandName}</td>
                                </tr>
                                <tr><th class="bg-white">Marka Tipi / Türü</th><td>${brandType} / ${brandCategory}</td></tr>
                                ${nonLatin !== '-' ? `<tr><th class="bg-white">Latin Dışı Harf</th><td>${nonLatin}</td></tr>` : ''}
                                <tr><th class="bg-white">Menşe</th><td>${origin}</td></tr>
                                <tr><th class="bg-white align-middle">Başvuru Sahipleri</th><td class="align-middle">${applicantsHtml}</td></tr>
                                <tr><th class="bg-white align-top">Mal/Hizmet Sınıfları</th><td>${classHtml}</td></tr>
                                <tr><th class="bg-white align-top">Rüçhan Bilgileri</th><td>${priorityHtml}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="card shadow-sm border-0">
                    <div class="card-header bg-white font-weight-bold text-center small py-2">Marka Örneği</div>
                    <div class="card-body bg-light text-center p-3">
                        ${imageHtml}
                    </div>
                </div>

                <div class="alert alert-info mt-3 small border-0 shadow-sm">
                    <i class="fas fa-info-circle mr-1"></i>
                    <strong>Uzman Notu:</strong><br>
                    Bu veriler iş oluşturulurken girilmiştir. Lütfen EPATS girişini bu verilere göre yapınız.
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}
}