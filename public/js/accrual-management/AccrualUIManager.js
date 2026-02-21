// public/js/accrual-management/AccrualUIManager.js

import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

export class AccrualUIManager {
    constructor() {
        // DOM Elementleri
        this.tableBody = document.getElementById('accrualsTableBody');
        this.foreignTableBody = document.getElementById('foreignTableBody');
        this.noRecordsMessage = document.getElementById('noRecordsMessage');
        this.bulkActions = document.getElementById('bulkActions');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        
        // Modal Elementleri
        this.editModal = document.getElementById('editAccrualModal');
        this.viewModal = document.getElementById('viewAccrualDetailModal');
        this.paymentModal = document.getElementById('markPaidModal');
        this.taskDetailModal = document.getElementById('taskDetailModal');

        // Alt Bileşenler (Managers)
        this.editFormManager = null;
        this.taskDetailManager = new TaskDetailManager('modalBody');

        // Veri Saklama (Görüntüleme işlemleri için)
        this.currentData = [];

        // Event Dinleyicilerini Başlat
        this._bindInternalEvents();
    }

    /**
     * Tablo içi butonlara tıklama olaylarını dinler.
     */
    _bindInternalEvents() {
        const handleTableClick = (e) => {
            // 1. Görüntüle Butonu
            const viewBtn = e.target.closest('.view-btn');
            if (viewBtn) {
                e.preventDefault();
                const id = viewBtn.dataset.id;
                const item = this.currentData.find(x => String(x.id) === String(id));
                if (item) this.showViewDetailModal(item);
                return;
            }

            // 2. Düzenle Butonu (Custom Event fırlatır veya main.js yakalar)
            const editBtn = e.target.closest('.edit-btn');
            if (editBtn && !editBtn.classList.contains('disabled')) {
                // Main.js'in dinlemesi için global event fırlatıyoruz (Yedek mekanizma)
                const id = editBtn.dataset.id;
                document.dispatchEvent(new CustomEvent('accrual-edit-request', { detail: { id } }));
                return;
            }

            // 3. Sil Butonu
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn) {
                 const id = deleteBtn.dataset.id;
                 document.dispatchEvent(new CustomEvent('accrual-delete-request', { detail: { id } }));
                 return;
            }
        };

        if (this.tableBody) this.tableBody.addEventListener('click', handleTableClick);
        if (this.foreignTableBody) this.foreignTableBody.addEventListener('click', handleTableClick);
    }

    /**
     * Tabloyu çizer.
     */
    renderTable(data, lookups, activeTab = 'main') {
        // Veriyi sakla (Modal açarken kullanacağız)
        this.currentData = data || [];

        const { tasks, transactionTypes, ipRecords, selectedIds } = lookups;
        const targetBody = activeTab === 'foreign' ? this.foreignTableBody : this.tableBody;
        
        if (targetBody) targetBody.innerHTML = '';
        if (!data || data.length === 0) {
            if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'block';
            return;
        }
        if (this.noRecordsMessage) this.noRecordsMessage.style.display = 'none';

        const rowsHtml = data.map((acc, index) => {
            const isSelected = selectedIds.has(acc.id);
            let sTxt = 'Bilinmiyor', sCls = 'badge-secondary';
            if (acc.status === 'paid') { sTxt = 'Ödendi'; sCls = 'status-paid'; }
            else if (acc.status === 'unpaid') { sTxt = 'Ödenmedi'; sCls = 'status-unpaid'; }
            else if (acc.status === 'partially_paid') { sTxt = 'K.Ödendi'; sCls = 'status-partially-paid'; }

            const dateStr = acc.createdAt ? new Date(acc.createdAt).toLocaleDateString('tr-TR') : '-';
            
            // 🔥 YENİ: Tür Rozeti Renk Ayarlamaları
            const accType = acc.type || 'Hizmet';
            let typeBadgeClass = 'badge-primary'; // Hizmet (Mavi)
            if (accType === 'Masraf') typeBadgeClass = 'badge-warning text-dark';
            else if (accType === 'Kur Farkı') typeBadgeClass = 'badge-info';
            else if (accType === 'Resmi Ücret Farkı') typeBadgeClass = 'badge-danger';
            else if (accType === 'SWIFT Maliyeti') typeBadgeClass = 'badge-secondary';
            else if (accType === 'Diğer') typeBadgeClass = 'badge-dark';
            const typeHtml = `<span class="badge ${typeBadgeClass}">${accType}</span>`;

            let taskDisplay = '-', relatedFileDisplay = '-', fieldDisplay = '-', fullSubject = '-';
            const task = tasks[String(acc.taskId)];
            
            if (task) {
                const typeObj = transactionTypes.find(t => t.id === task.taskType);
                taskDisplay = typeObj ? (typeObj.alias || typeObj.name) : (task.title || '-');
                
                if (activeTab === 'main' && task.relatedIpRecordId) {
                    const ipRec = ipRecords.find(r => r.id === task.relatedIpRecordId);
                    if (ipRec) {
                        relatedFileDisplay = ipRec.applicationNumber || ipRec.applicationNo || 'Dosya';
                        fullSubject = ipRec.markName || ipRec.title || ipRec.name || '-';
                    }
                }

            if (typeObj && typeObj.ipType) {
                    const ipTypeMap = { 'trademark': 'Marka', 'patent': 'Patent', 'design': 'Tasarım', 'suit': 'Dava' };
                    fieldDisplay = ipTypeMap[typeObj.ipType] || typeObj.ipType.toUpperCase();
                }
            } else { 
                taskDisplay = acc.taskTitle || '-'; 
                // 🔥 YENİ: Serbest Tahakkuk (işe bağlı değilse) veritabanındaki konuyu al
                fullSubject = acc.subject || '-';
            }

            // Kısaltmalar
            let shortSubject = fullSubject.length > 18 ? fullSubject.substring(0, 18) + '..' : fullSubject;
            const subjectHtml = `<span title="${fullSubject}" style="cursor:help;">${shortSubject}</span>`;

            let fullPartyName = '-';
            if (acc.officialFee?.amount > 0 && acc.tpInvoiceParty) fullPartyName = acc.tpInvoiceParty.name || 'Türk Patent';
            else if (acc.serviceFee?.amount > 0 && acc.serviceInvoiceParty) fullPartyName = acc.serviceInvoiceParty.name || '-';

            let shortPartyName = fullPartyName.length > 18 ? fullPartyName.substring(0, 18) + '..' : fullPartyName;
            const partyHtml = `<span title="${fullPartyName}" style="cursor:help;">${shortPartyName}</span>`;

            const tfn = acc.tpeInvoiceNo || '-';
            const efn = acc.evrekaInvoiceNo || '-';
            const officialStr = acc.officialFee ? this._formatMoney(acc.officialFee.amount, acc.officialFee.currency) : '-';

            // Menü Yapılandırması
            const isEditDisabled = acc.status === 'paid';
            
            // Düzenle butonu için sınıflar (Yazı olmadığı için btn-light kullanıyoruz)
            const editBtnClass = isEditDisabled 
                ? 'btn btn-sm btn-light text-muted disabled' 
                : 'btn btn-sm btn-light text-warning edit-btn action-btn';
            
            const editBtnStyle = isEditDisabled ? 'cursor: not-allowed; opacity: 0.5;' : 'cursor: pointer;';
            const editTitle = isEditDisabled ? 'Ödenmiş kayıt düzenlenemez' : 'Düzenle';

            // GÜNCELLENDİ: Dropdown içinde sadece ikonlar var
            const actionMenuHtml = `
                <div class="dropdown">
                    <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-ellipsis-v" style="pointer-events: none;"></i>
                    </button>
                    
                    <div class="dropdown-menu dropdown-menu-right shadow-sm border-0 p-2" style="min-width: auto;">
                        <div class="d-flex justify-content-center align-items-center" style="gap: 5px;">
                            
                            <button class="btn btn-sm btn-light text-primary view-btn action-btn" data-id="${acc.id}" title="Görüntüle">
                                <i class="fas fa-eye" style="pointer-events: none;"></i>
                            </button>

                            <button class="${editBtnClass}" data-id="${acc.id}" style="${editBtnStyle}" title="${editTitle}">
                                <i class="fas fa-edit" style="pointer-events: none;"></i>
                            </button>

                            <button class="btn btn-sm btn-light text-danger delete-btn action-btn" data-id="${acc.id}" title="Sil">
                                <i class="fas fa-trash-alt" style="pointer-events: none;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            if (activeTab === 'main') {
                const serviceStr = acc.serviceFee ? this._formatMoney(acc.serviceFee.amount, acc.serviceFee.currency) : '-';
                
                let remainingHtml = '-';
                const rem = acc.remainingAmount !== undefined ? acc.remainingAmount : acc.totalAmount;
                const isFullyPaid = (Array.isArray(rem)) 
                    ? rem.length === 0 || rem.every(r => parseFloat(r.amount) <= 0.01)
                    : parseFloat(rem) <= 0.01;

                if (!isFullyPaid) remainingHtml = `<span>${this._formatMoney(rem, acc.totalAmountCurrency)}</span>`;

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSelected ? 'checked' : ''}></td>
                    <td>${acc.id}</td>
                    <td>${dateStr}</td>
                    <td>${typeHtml}</td> <td><span class="badge badge-info">${fieldDisplay}</span></td>
                    <td><span class="status-badge ${sCls}">${sTxt}</span></td>
                    <td>${relatedFileDisplay}</td>
                    <td><span class="font-weight-bold text-secondary">${subjectHtml}</span></td>
                    <td><a href="#" class="task-detail-link" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td>${partyHtml}</td>
                    <td><span class="text-muted font-weight-bold">${tfn}</span></td>
                    <td><span class="text-muted font-weight-bold">${efn}</span></td>
                    <td>${officialStr}</td>
                    <td>${serviceStr}</td>
                    <td>${this._formatMoney(acc.totalAmount, acc.totalAmountCurrency)}</td>
                    <td>${remainingHtml}</td>
                    <td class="text-center">${actionMenuHtml}</td>
                </tr>`;
            } else {
                // Yurt Dışı Tablosu
                let paymentParty = acc.serviceInvoiceParty?.name || '-';
                const fStatus = acc.foreignStatus || 'unpaid';
                let sTxt = 'Ödenmedi', sCls = 'danger';
                if (fStatus === 'paid') { sTxt = 'Ödendi'; sCls = 'success'; }
                else if (fStatus === 'partially_paid') { sTxt = 'Kısmen'; sCls = 'warning'; }
                
                let remainingHtml = '-';
                let foreignRem = acc.foreignRemainingAmount;
                if (foreignRem === undefined) {
                    if (fStatus !== 'paid') foreignRem = [{ amount: acc.officialFee?.amount || 0, currency: acc.officialFee?.currency || 'EUR' }];
                    else foreignRem = []; 
                }
                const isFullyPaid = (Array.isArray(foreignRem)) 
                    ? foreignRem.length === 0 || foreignRem.every(r => parseFloat(r.amount) <= 0.01)
                    : parseFloat(foreignRem) <= 0.01;

                if (!isFullyPaid) {
                    remainingHtml = `<span class="text-danger">${this._formatMoney(foreignRem, acc.officialFee?.currency || 'EUR')}</span>`;
                } else {
                    remainingHtml = `<span class="text-success">Tamamlandı</span>`;
                }

                let documentHtml = '-';
                if (acc.files && acc.files.length > 0) {
                    const lastFile = acc.files[acc.files.length - 1];
                    const link = lastFile.url || lastFile.content;
                    documentHtml = `<a href="${link}" target="_blank" class="text-secondary" title="${lastFile.name}"><i class="fas fa-file-contract fa-lg hover-primary"></i></a>`;
                }

                return `
                <tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${acc.id}" ${isSelected ? 'checked' : ''}></td>
                    <td>${acc.id}</td>
                    <td><span class="badge badge-${sCls}">${sTxt}</span></td>
                    <td><a href="#" class="task-detail-link" data-task-id="${acc.taskId}">${taskDisplay}</a></td>
                    <td>${paymentParty}</td>
                    <td>${officialStr}</td>
                    <td>${remainingHtml}</td>
                    <td>${documentHtml}</td>
                </tr>`;
            }
        }).join('');

        if (targetBody) targetBody.innerHTML = rowsHtml;
        this.updateBulkActionsVisibility(selectedIds.size > 0);
    }

    /**
     * Düzenle Modalını Açar (Bu metod Main.js tarafından veya event ile tetiklenir)
     */
    initEditModal(accrual, personList, epatsDocument = null) {
        if (!accrual) return;

        if (!this.editFormManager) {
            this.editFormManager = new AccrualFormManager('editAccrualFormContainer', 'edit', personList);
            this.editFormManager.render();
        } else {
            this.editFormManager.persons = personList;
            this.editFormManager.render(); 
        }

        document.getElementById('editAccrualId').value = accrual.id;
        document.getElementById('editAccrualTaskTitleDisplay').value = accrual.taskTitle || '';
        
        this.editFormManager.reset();
        this.editFormManager.setData(accrual);
        
        if (epatsDocument) {
            this.editFormManager.showEpatsDoc(epatsDocument);
        }

        this.editModal.classList.add('show');
    }

    /**
     * Detay Modalını Açar (Artık dahili olarak da çağrılabilir)
     */
    showViewDetailModal(accrual) {
        if (!accrual) return;

        const body = this.viewModal.querySelector('.modal-body-content');
        const title = document.getElementById('viewAccrualTitle');
        if(title) title.textContent = `Tahakkuk Detayı (#${accrual.id})`;

        const dFmt = (d) => { try { return d ? new Date(d).toLocaleDateString('tr-TR') : '-'; } catch{return '-'} };
        
        let statusText = 'Bilinmiyor', statusColor = '#6c757d';
        if(accrual.status === 'paid') { statusText = 'Ödendi'; statusColor = '#28a745'; }
        else if(accrual.status === 'unpaid') { statusText = 'Ödenmedi'; statusColor = '#dc3545'; }
        else if(accrual.status === 'partially_paid') { statusText = 'Kısmen Ödendi'; statusColor = '#ffc107'; }

        // Dosyalar HTML
        let filesHtml = '';
        if (accrual.files && accrual.files.length > 0) {
            filesHtml = accrual.files.map(f => {
                const url = f.content || f.url;
                return `
                <div class="col-md-6 mb-2">
                    <div class="p-2 border rounded d-flex align-items-center bg-white shadow-sm h-100">
                        <i class="fas fa-file-alt text-secondary fa-2x mr-3 ml-1"></i>
                        <div style="flex-grow:1; overflow:hidden;">
                            <div class="text-truncate font-weight-bold small" title="${f.name}">${f.name}</div>
                            <div class="text-muted small" style="font-size:0.75rem;">${f.documentDesignation || 'Belge'}</div>
                        </div>
                        <a href="${url}" target="_blank" class="btn btn-sm btn-light ml-2 border"><i class="fas fa-download"></i></a>
                    </div>
                </div>`;
            }).join('');
        } else {
            filesHtml = '<div class="col-12 text-center text-muted font-italic p-3">Ekli dosya bulunmamaktadır.</div>';
        }

        // --- YENİ ALANLARIN DETAYDA GÖSTERİMİ ---
        const tfn = accrual.tpeInvoiceNo || '-';
        const efn = accrual.evrekaInvoiceNo || '-';

        body.innerHTML = `
            <div class="container-fluid p-0">
                <div class="row mb-3 align-items-stretch">
                    <div class="col-md-5">
                         <div class="p-2 bg-light border rounded h-100">
                            <label class="small text-muted mb-0 font-weight-bold">İLGİLİ İŞ</label>
                            <div class="text-dark">${accrual.taskTitle || '-'} <small class="text-muted">(${accrual.taskId || ''})</small></div>
                         </div>
                    </div>
                    <div class="col-md-3">
                        <div class="p-2 bg-light border rounded text-center h-100">
                            <label class="small text-muted mb-0 font-weight-bold">TÜR</label>
                            <div class="font-weight-bold text-primary">${(accrual.type || 'Hizmet').toUpperCase()}</div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="p-2 bg-light border rounded text-center h-100">
                            <label class="small text-muted mb-0 font-weight-bold">DURUM</label>
                            <div class="font-weight-bold" style="color:${statusColor}">${statusText.toUpperCase()}</div>
                        </div>
                    </div>
                </div>

                <div class="row mb-3">
                    <div class="col-6">
                        <div class="p-2 border rounded">
                            <label class="small text-muted mb-0 font-weight-bold">TPE Fatura No</label>
                            <div class="text-dark font-weight-bold">${tfn}</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="p-2 border rounded">
                            <label class="small text-muted mb-0 font-weight-bold">EVREKA Fatura No</label>
                            <div class="text-dark font-weight-bold">${efn}</div>
                        </div>
                    </div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-coins mr-2"></i>Finansal Özet</h6>
                <div class="row mb-4">
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3">
                                <label class="small text-muted mb-1">Toplam Tutar</label>
                                <div class="h5 mb-0 text-primary">${this._formatMoney(accrual.totalAmount, accrual.totalAmountCurrency)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 mb-3">
                        <div class="card h-100 border-0 bg-light">
                            <div class="card-body p-3 text-right">
                                <label class="small text-muted mb-1">Kalan Tutar</label>
                                <div class="h5 mb-0 text-danger">${this._formatMoney(accrual.remainingAmount, accrual.totalAmountCurrency)}</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row text-muted small mb-3">
                    <div class="col-6"><strong>Oluşturulma:</strong> ${dFmt(accrual.createdAt)}</div>
                    <div class="col-6 text-right"><strong>Ödeme Tarihi:</strong> ${dFmt(accrual.paymentDate)}</div>
                </div>

                <h6 class="border-bottom pb-2 mb-3 text-primary"><i class="fas fa-folder-open mr-2"></i>Dosyalar & Belgeler</h6>
                <div class="row">${filesHtml}</div>
            </div>
        `;
        this.viewModal.classList.add('show');
    }

    showPaymentModal(selectedAccrualsList, activeTab = 'main') {
        document.getElementById('paidAccrualCount').textContent = selectedAccrualsList.length;
        
        // 🔥 HATA ÇÖZÜMÜ: valueAsDate yerine text formatında tarih atıyoruz ve DatePicker'ı güncelliyoruz.
        const dateInput = document.getElementById('paymentDate');
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        
        dateInput.value = `${dd}.${mm}.${yyyy}`; // Metin kutusuna yaz
        if (dateInput._flatpickr) {
            dateInput._flatpickr.setDate(today, true); // Varsa görsel takvimi de güncelle
        }

        document.getElementById('paymentReceiptFileList').innerHTML = '';

        const localArea = document.getElementById('detailedPaymentInputs');
        const foreignArea = document.getElementById('foreignPaymentInputs');

        if(localArea) localArea.style.display = 'none';
        if(foreignArea) foreignArea.style.display = 'none';

        if (selectedAccrualsList.length === 1) {
            const acc = selectedAccrualsList[0];

            if (activeTab === 'foreign') {
                if(foreignArea) foreignArea.style.display = 'block';

                const offAmt = acc.officialFee?.amount || 0;
                const offCurr = acc.officialFee?.currency || 'EUR';
                
                document.getElementById('foreignTotalBadge').textContent = `${this._formatMoney(offAmt, offCurr)}`;
                document.querySelectorAll('.foreign-currency-label').forEach(el => el.textContent = offCurr);

                document.getElementById('manualForeignOfficial').value = acc.foreignPaidOfficialAmount || 0;
                document.getElementById('manualForeignService').value = acc.foreignPaidServiceAmount || 0;

                const payFullCb = document.getElementById('payFullForeign');
                const splitInputs = document.getElementById('foreignSplitInputs');
                
                if(payFullCb) payFullCb.checked = true;
                if(splitInputs) splitInputs.style.display = 'none';
            }
            else {
                if(localArea) localArea.style.display = 'block';

                const offAmt = acc.officialFee?.amount || 0;
                const offCurr = acc.officialFee?.currency || 'TRY';
                document.getElementById('officialFeeBadge').textContent = `${offAmt} ${offCurr}`;
                document.getElementById('manualOfficialCurrencyLabel').textContent = offCurr;
                document.getElementById('manualOfficialAmount').value = acc.paidOfficialAmount || 0;

                const srvAmt = acc.serviceFee?.amount || 0;
                const srvCurr = acc.serviceFee?.currency || 'TRY';
                document.getElementById('serviceFeeBadge').textContent = `${srvAmt} ${srvCurr}`;
                document.getElementById('manualServiceCurrencyLabel').textContent = srvCurr;
                document.getElementById('manualServiceAmount').value = acc.paidServiceAmount || 0;

                document.getElementById('payFullOfficial').checked = true;
                document.getElementById('officialAmountInputContainer').style.display = 'none';
                document.getElementById('payFullService').checked = true;
                document.getElementById('serviceAmountInputContainer').style.display = 'none';
            }
        }
        
        this.paymentModal.classList.add('show');
    }

    showTaskDetailLoading() {
        this.taskDetailModal.classList.add('show');
        document.getElementById('modalTaskTitle').textContent = 'Yükleniyor...';
        this.taskDetailManager.showLoading();
    }
    
    updateTaskDetailContent(task, extraData) {
        document.getElementById('modalTaskTitle').textContent = `İş Detayı (${task.id})`;
        this.taskDetailManager.render(task, extraData);
    }

    updateTaskDetailError(msg) {
        this.taskDetailManager.showError(msg);
    }

    updateBulkActionsVisibility(isVisible) {
        if(this.bulkActions) this.bulkActions.style.display = isVisible ? 'flex' : 'none';
    }

    toggleLoading(show) {
        // 🔥 Merkezi loading (SimpleLoadingController) varsa onu da kullan
        if (window.SimpleLoadingController && typeof window.SimpleLoadingController.show === 'function') {
            if (show) {
                window.SimpleLoadingController.show({ text: 'Veriler Yükleniyor...' });
            } else {
                window.SimpleLoadingController.hide();
            }
        }
        
        // Yerel indicator varsa onu da gizle/göster
        if(this.loadingIndicator) this.loadingIndicator.style.display = show ? 'block' : 'none';
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    _formatMoney(val, curr) {
        if (Array.isArray(val)) {
            if (val.length === 0) return '0 ' + (curr || 'TRY');
            return val.map(item => {
                const num = parseFloat(item.amount) || 0;
                return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)} ${item.currency}`;
            }).join(' + ');
        }
        const num = parseFloat(val) || 0;
        return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)} ${curr || 'TRY'}`;
    }

    getEditFormData() {
        return this.editFormManager ? this.editFormManager.getData() : { success: false, error: 'Form yüklenmedi' };
    }
}