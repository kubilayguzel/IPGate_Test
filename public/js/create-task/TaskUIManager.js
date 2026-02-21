import { TASK_IDS, RELATED_PARTY_REQUIRED, PARTY_LABEL_BY_ID, asId } from './TaskConstants.js';
import { getSelectedNiceClasses } from '../nice-classification.js';
import { COURTS_LIST } from '../../utils.js';

export class TaskUIManager {
    constructor() {
        this.container = document.getElementById('conditionalFieldsContainer');
    }

    clearContainer() {
        if (this.container) this.container.innerHTML = '';
    }

    // --- 1. MARKA BAŞVURU FORMU ---
    renderTrademarkApplicationForm() {
        if (!this.container) return;
        this.container.innerHTML = `
        <div class="section-card">
            <h3 class="section-title">Marka Başvuru Bilgileri</h3>
             <div class="card-body">
                <ul class="nav nav-tabs" id="myTaskTabs" role="tablist">
                    <li class="nav-item"><a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info">Marka Bilgileri</a></li>
                    <li class="nav-item"><a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services">Mal/Hizmet Seçimi</a></li>
                    <li class="nav-item"><a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants">Başvuru Sahibi</a></li>
                    <li class="nav-item"><a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority">Rüçhan</a></li>
                    <li class="nav-item"><a class="nav-link" id="accrual-tab" data-toggle="tab" href="#accrual">Tahakkuk/Diğer</a></li>
                    <li class="nav-item"><a class="nav-link" id="summary-tab" data-toggle="tab" href="#summary">Özet</a></li>
                </ul>
                <div class="tab-content mt-3 tab-content-card" id="myTaskTabContent">
                    ${this._getBrandInfoTabHtml()}
                    ${this._getGoodsServicesTabHtml()}
                    ${this._getApplicantsTabHtml()}
                    ${this._getPriorityTabHtml()}
                    ${this._getAccrualTabHtml()}
                    <div class="tab-pane fade" id="summary" role="tabpanel"><div id="summaryContent" class="form-section"></div></div>
                </div>
            </div>
            <div id="formActionsContainer" class="form-actions"></div>
        </div>`;
    }

// --- 2. DİĞER İŞLEMLER (BASE FORM) ---

    renderBaseForm(taskTypeName, taskTypeId, isLawsuitTask, allTransactionTypes) { 
        if (!this.container) return;

        const taskIdStr = asId(taskTypeId);
        const needsRelatedParty = RELATED_PARTY_REQUIRED.has(taskIdStr);
        const partyLabel = PARTY_LABEL_BY_ID[taskIdStr] || 'İlgili Taraf';

        let contentHtml = '';
        contentHtml += this._getAssetSearchHtml();

        if (isLawsuitTask) {
            contentHtml += this._getLawsuitClientHtml();
            contentHtml += this._getLawsuitDetailsHtml(taskTypeId, allTransactionTypes);
            contentHtml += this._getLawsuitOpponentHtml();
        } else if (needsRelatedParty) {
            contentHtml += this._getGenericRelatedPartyHtml(partyLabel);
        }

        contentHtml += this._getAccrualCardHtml();
        contentHtml += this._getJobDetailsHtml();
        contentHtml += this._getFormActionsHtml();

        this.container.innerHTML = contentHtml;
    }

    renderOtherTaskForm(taskType) {
        if (!this.container) return;
        const typeId = String(taskType.id);
        let customFields = '';

        // ORTAK: Sahip Arama HTML
        const ownerSearchHtml = `
            <div class="form-group mt-3 border-top pt-3">
                <label class="form-label font-weight-bold">İşlem Yapılacak Sahip (Müvekkil)</label>
                <div class="position-relative">
                    <div class="d-flex" style="gap:10px;">
                        <input type="text" id="ownerSearchInput" class="form-input" placeholder="Kişi veya Firma ara...">
                        <button type="button" id="addNewOwnerBtn" class="btn-small btn-add-person" title="Yeni Kişi Ekle">+</button>
                    </div>
                    <div id="ownerSearchResults" class="search-results-list" style="display:none;"></div>
                </div>
                <div class="mt-2">
                    <label class="form-label" style="font-size: 0.85rem; color: #666;">Seçilen Sahipler</label>
                    <div id="selectedOwnerListContainer" class="selected-items-list">
                        <div class="empty-state"><small class="text-muted">Henüz sahip seçilmedi.</small></div>
                    </div>
                </div>
            </div>`;

        // ID 79: Unvan Değişikliği
        if (typeId === '79') {
            customFields = `
                <div class="form-group">
                    <label class="form-label font-weight-bold">Yeni Unvan</label>
                    <input type="text" id="newTitleInput" class="form-input" placeholder="Yeni unvanı giriniz...">
                </div>
                ${ownerSearchHtml}`;
        }
        // ID 80: Nevi Değişikliği
        else if (typeId === '80') {
            customFields = `
                <div class="form-group">
                    <label class="form-label font-weight-bold">Yeni Nevi (Tür)</label>
                    <input type="text" id="newTypeInput" class="form-input" placeholder="Örn: A.Ş., Ltd. Şti...">
                </div>
                <div class="form-group mt-3">
                    <label class="form-label font-weight-bold">Vergi Numarası</label>
                    <input type="text" id="taxNumberInput" class="form-input" placeholder="Vergi numarasını giriniz..." maxlength="11">
                </div>
                ${ownerSearchHtml}`;
        }
        // ---> ID 82: Adres Değişikliği (Ülke ve Şehir Select Yapısı) <---
        else if (typeId === '82') {
            customFields = `
                <div class="form-group">
                    <label class="form-label font-weight-bold">Açık Adres</label>
                    <textarea id="newAddressText" class="form-control" rows="3" placeholder="Mahalle, Cadde, Sokak, Kapı No vb..."></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group col-md-6">
                        <label class="form-label font-weight-bold">Ülke</label>
                        <select id="newAddressCountry" class="form-control">
                            <option value="">Seçiniz...</option>
                        </select>
                    </div>
                    <div class="form-group col-md-6">
                        <label class="form-label font-weight-bold">İl / Şehir</label>
                        <select id="newAddressCity" class="form-control" disabled>
                            <option value="">Önce Ülke Seçiniz...</option>
                        </select>
                    </div>
                </div>
                ${ownerSearchHtml}`;
        }
        // ID 81: Araştırma
        else if (typeId === '81') {
            customFields = `
                <div class="form-group">
                    <label class="form-label font-weight-bold">Araştırılacak Marka/Kelime</label>
                    <input type="text" id="searchKeywordInput" class="form-input" placeholder="Araştırma yapılacak ibare...">
                </div>
                <div class="form-group">
                    <label class="form-label font-weight-bold">Sınıflar (Opsiyonel)</label>
                    <input type="text" id="searchClassesInput" class="form-input" placeholder="Örn: 05, 35 (Virgülle ayırın)">
                </div>`;
        }

        this.container.innerHTML = `
        <div class="section-card">
            <h3 class="section-title">${taskType.name || 'İşlem Detayları'}</h3>
            <div class="card-body">
                <div id="assetSearchContainer">
                    ${this._getAssetSearchHtml()}
                </div>
                
                <div class="mt-4 p-3 bg-light border rounded">
                    <h5 class="text-primary mb-3"><i class="fas fa-pen-nib mr-2"></i>Değişiklik / İşlem Bilgileri</h5>
                    ${customFields}
                </div>

                <div class="mt-4">${this._getAccrualCardHtml(false)}</div>
                <div class="mt-4">${this._getJobDetailsHtml(false)}</div>
                ${this._getFormActionsHtml()}
            </div>
        </div>`;
    }

    // 2. YENİ METOT EKLEYİN (Class içine)
    renderSelectedOwners(owners) {
        const container = document.getElementById('selectedOwnerListContainer');
        if (!container) return;

        if (!owners || owners.length === 0) {
            container.innerHTML = `<div class="empty-state"><small class="text-muted">Henüz sahip seçilmedi.</small></div>`;
            return;
        }

        container.innerHTML = owners.map(p => `
            <div class="selected-item p-2 border rounded mb-2 d-flex justify-content-between align-items-center bg-white">
                <div>
                    <i class="fas fa-user-tag mr-2 text-info"></i>
                    <span class="font-weight-bold">${p.name}</span>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger border-0 remove-owner-btn" data-id="${p.id}" title="Kaldır">
                    <i class="fas fa-times"></i>
                </button>
            </div>`).join('');
    }

    // --- HTML TEMPLATE HELPERS ---

    _getBrandInfoTabHtml() {
        return `
        <div class="tab-pane fade show active" id="brand-info" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Marka Bilgileri</h3>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Tipi</label>
                    <div class="col-sm-9">
                        <select class="form-control" id="brandType">
                            <option value="Sadece Kelime">Sadece Kelime</option>
                            <option value="Sadece Şekil">Sadece Şekil</option>
                            <option value="Şekil + Kelime" selected>Şekil + Kelime</option>
                            <option value="Ses">Ses</option>
                            <option value="Hareket">Hareket</option>
                            <option value="Renk">Renk</option>
                            <option value="Üç Boyutlu">Üç Boyutlu</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Türü</label>
                    <div class="col-sm-9">
                        <select class="form-control" id="brandCategory">
                            <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                            <option value="Garanti Markası">Garanti Markası</option>
                            <option value="Ortak Marka">Ortak Marka</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Örneği</label>
                    <div class="col-sm-9">
                        <div id="brand-example-drop-zone" class="file-upload-wrapper brand-upload-frame">
                            <input type="file" id="brandExample" accept="image/*" style="display:none;">
                            <div class="file-upload-button">
                                <div class="upload-icon" style="font-size: 2.5em; color: #1e3c72;">🖼️</div>
                                <div style="font-weight: 500;">Marka örneğini buraya sürükleyin veya seçmek için tıklayın</div>
                            </div>
                            <div class="file-upload-info">İstenen format: 591x591px, 300 DPI, JPEG.</div>
                        </div>
                        <div id="brandExamplePreviewContainer" class="mt-3 text-center" style="display:none;">
                            <img id="brandExamplePreview" src="#" style="max-width:200px; max-height:200px; border:1px solid #ddd; padding:5px; border-radius:8px;">
                            <button id="removeBrandExampleBtn" type="button" class="btn btn-sm btn-danger mt-2">Kaldır</button>
                        </div>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Marka Örneği Yazılı İfadesi</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="brandExampleText"></div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Latin Alfabesi Dışı Harf Var Mı?</label>
                    <div class="col-sm-9"><input type="text" class="form-control" id="nonLatinAlphabet"></div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Önyazı Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="coverLetterRequest" value="var"><label class="form-check-label">Var</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="coverLetterRequest" value="yok" checked><label class="form-check-label">Yok</label></div>
                    </div>
                </div>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Muvafakat Talebi</label>
                    <div class="col-sm-9">
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="consentRequest" value="var"><label class="form-check-label">Var</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="consentRequest" value="yok" checked><label class="form-check-label">Yok</label></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    _getGoodsServicesTabHtml() {
        return `
        <div class="tab-pane fade" id="goods-services" role="tabpanel">
            <div class="nice-classification-container mt-3">
                <div class="row">
                    <div class="col-12">
                        <div class="classification-panel mb-3">
                            <div class="panel-header">
                                <h5 class="mb-0"><i class="fas fa-list-ul mr-2"></i>Nice Classification - Mal ve Hizmet Sınıfları</h5>
                                <small class="text-white-50">1-45 arası sınıflardan seçim yapın</small>
                            </div>
                            <div class="search-section">
                                <div class="input-group">
                                    <input type="text" class="form-control" id="niceClassSearch" placeholder="🔍 Sınıf numarası veya açıklama ara...">
                                    <div class="input-group-append">
                                        <button class="btn btn-outline-secondary" type="button" id="clearSearchBtn">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="scrollable-list" id="niceClassificationList" style="max-height: 500px; overflow-y: auto; padding: 0;">
                                <div class="text-center py-5">
                                    <div class="spinner-border text-secondary"></div>
                                    <div class="mt-2 text-muted">Veriler yükleniyor...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <div class="selected-classes-panel">
                            <div class="panel-header">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <h5 class="mb-0"><i class="fas fa-check-circle mr-2"></i>Seçilen Sınıflar</h5>
                                        <small class="text-white-50">Toplam: <span id="selectedClassCount">0</span></small>
                                    </div>
                                    <button type="button" class="btn btn-outline-light btn-sm" id="clearAllClassesBtn" style="display: none;" title="Tüm seçimleri temizle">
                                        <i class="fas fa-trash"></i> Temizle
                                    </button>
                                </div>
                            </div>
                            <div class="scrollable-list" id="selectedNiceClasses" style="max-height: 400px; overflow-y: auto; padding: 15px;">
                                <div class="empty-state text-center py-4">
                                    <i class="fas fa-clipboard-list fa-2x text-muted mb-2"></i>
                                    <p class="text-muted">Henüz sınıf seçilmedi</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="mt-3 p-3 bg-white border rounded">
                            <label class="form-label font-weight-bold"><i class="fas fa-edit mr-2"></i>Özel Tanım</label>
                            <textarea class="form-control" id="customClassInput" rows="3" placeholder="Listede olmayan özel bir mal/hizmet tanımı ekleyin..." maxlength="50000"></textarea>
                            <div class="d-flex justify-content-between align-items-center mt-2">
                                <small class="text-muted"><span id="customClassCharCount">0</span> / 50,000 karakter</small>
                                <button type="button" class="btn btn-secondary btn-sm" id="addCustomClassBtn">
                                    <i class="fas fa-plus mr-1"></i> Özel Tanım Ekle
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    }

    _getApplicantsTabHtml() {
        return `
        <div class="tab-pane fade" id="applicants" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Başvuru Sahibi Bilgileri</h3>
                <div class="form-group full-width">
                    <label class="form-label">Başvuru Sahibi Ara</label>
                    <div class="position-relative">
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="applicantSearchInput" class="form-input" placeholder="Ara...">
                            <button type="button" id="addNewApplicantBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                        </div>
                        <div id="applicantSearchResults" class="search-results-list"></div>
                    </div>
                </div>
                <div class="form-group full-width mt-4">
                    <label class="form-label">Seçilen Başvuru Sahipleri</label>
                    <div id="selectedApplicantsList" class="selected-items-list"><div class="empty-state"><p class="text-muted">Seçim yok.</p></div></div>
                </div>
            </div>
        </div>`;
    }

    _getPriorityTabHtml() {
        return `
        <div class="tab-pane fade" id="priority" role="tabpanel">
            <div class="form-section">
                <h3 class="section-title">Rüçhan Bilgileri</h3>
                <div class="form-group row">
                    <label class="col-sm-3 col-form-label">Rüçhan Tipi</label>
                    <div class="col-sm-9"><select class="form-control" id="priorityType"><option value="başvuru">Başvuru</option><option value="sergi">Sergi</option></select></div>
                </div>
                <div class="form-group row"><label class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label><div class="col-sm-9"><input type="text" class="form-control" id="priorityDate data-datepicker placeholder="gg.aa.yyyy""></div></div>
                <div class="form-group row"><label class="col-sm-3 col-form-label">Rüçhan Ülkesi</label><div class="col-sm-9"><select class="form-control" id="priorityCountry"><option value="">Seçiniz...</option></select></div></div>
                <div class="form-group row"><label class="col-sm-3 col-form-label">Rüçhan Numarası</label><div class="col-sm-9"><input type="text" class="form-control" id="priorityNumber"></div></div>
                <div class="form-group full-width text-right mt-3"><button type="button" id="addPriorityBtn" class="btn btn-secondary"><i class="fas fa-plus mr-1"></i> Ekle</button></div>
                <hr class="my-4">
                <div class="form-group full-width"><label class="form-label">Eklenen Rüçhanlar</label><div id="addedPrioritiesList" class="selected-items-list"></div></div>
            </div>
        </div>`;
    }

    _getAccrualTabHtml() {
        return `<div class="tab-pane fade" id="accrual" role="tabpanel">${this._getAccrualCardHtml(true)}${this._getJobDetailsHtml(true)}</div>`;
    }

    // --- BASE FORM ---
    _getAssetSearchHtml() {
        return `
        <div class="section-card" id="card-asset">
            <h3 class="section-title">2. İşleme Konu Varlık</h3>
            <div class="form-group full-width">
                <label class="form-label">Portföyden Ara</label>
                <div class="position-relative">
                    <input type="text" id="ipRecordSearch" class="form-input" placeholder="Başlık, dosya no...">
                    <div id="ipRecordSearchResults" style="position:absolute; top:100%; left:0; right:0; z-index:1000; background:#fff; border:1px solid #ddd; display:none; max-height:260px; overflow:auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"></div>
                </div>
                
                <div id="selectedIpRecordContainer" class="mt-3" style="display:none;">
                    <div class="d-flex justify-content-between align-items-center p-3 border rounded bg-white shadow-sm">
                        <div class="d-flex align-items-center">
                            <div class="mr-3">
                                <img id="selectedIpRecordImage" src="" alt="Marka" 
                                     style="width: 60px; height: 60px; object-fit: contain; border: 1px solid #eee; border-radius: 4px; display:none; background-color: #fff;">
                                <div id="selectedIpRecordPlaceholder" 
                                     style="width: 60px; height: 60px; background-color: #f8f9fa; border: 1px solid #eee; border-radius: 4px; display:flex; align-items:center; justify-content:center; color:#adb5bd;">
                                    <i class="fas fa-image" style="font-size: 24px;"></i>
                                </div>
                            </div>
                            
                            <div>
                                <h5 class="mb-1 font-weight-bold" id="selectedIpRecordLabel" style="font-size: 1rem; color: #2c3e50;"></h5>
                                <div class="text-muted small">
                                    Başvuru No: <strong id="selectedIpRecordNumber" style="color: #333;"></strong>
                                </div>
                            </div>
                        </div>

                        <button type="button" class="btn btn-danger btn-sm d-flex align-items-center justify-content-center" 
                                id="clearSelectedIpRecord" title="Kaldır" 
                                style="width: 32px; height: 32px; border-radius: 4px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <div id="wipoAripoParentContainer" class="form-group full-width mt-4" style="display:none;">
                <label class="form-label">Eklenen Ülkeler <span class="badge badge-light" id="wipoAripoChildCount">0</span></label>
                <div id="wipoAripoChildList" class="selected-items-list"></div>
            </div>
        </div>`;
    }

    _getLawsuitClientHtml() {
        return `
        <div class="section-card" id="clientSection">
            <h3 class="section-title">3. Müvekkil Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Rol</label><select id="clientRole" class="form-select"><option value="davaci">Davacı</option><option value="davali">Davalı</option></select></div>
            </div>
            <div class="form-group full-width mt-3">
                <label class="form-label">Müvekkil Ara</label>
                <div class="position-relative">
                    <div class="d-flex" style="gap:10px;">
                        <input type="text" id="personSearchInput" class="form-input">
                        <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">+</button>
                    </div>
                    <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
                </div>
            </div>
            <div class="form-group full-width mt-2"><label class="form-label">Seçilen Müvekkil</label><div id="relatedPartyList" class="selected-items-list"></div></div>
        </div>`;
    }

    // Parametre olarak taskTypeId alacak şekilde güncellendi

    _getLawsuitDetailsHtml(taskTypeId, allTransactionTypes) {
            const isYargitayTask = String(taskTypeId) === '60';
            
            // Mahkeme listesini oluştur
            const courtOptions = COURTS_LIST.map(group => `
                <optgroup label="${group.label}">
                    ${group.options.map(opt => 
                        `<option value="${opt.value}" ${opt.value === 'Yargıtay' && isYargitayTask ? 'selected' : ''}>${opt.text}</option>`
                    ).join('')}
                </optgroup>
            `).join('');

            return `
            <div class="section-card">
                <h3 class="section-title">4. Dava Bilgileri</h3>
                <div class="form-grid">
                    
                    <div class="form-group full-width">
                        <label class="form-label">Mahkeme</label>
                        <select id="courtName" class="form-select">
                            <option value="">Seçiniz...</option>
                            ${courtOptions}
                        </select>
                        <input type="text" id="customCourtInput" class="form-input mt-2" 
                            placeholder="Mahkeme adını tam olarak yazınız..." 
                            style="display:none; border-color: #3498db;">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Dava Tarihi (Açılış)</label>
                        <input type="text" id="suitOpeningDate" class="form-input" placeholder="gg.aa.yyyy" data-datepicker>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Esas No</label>
                        <input type="text" id="suitCaseNo" class="form-input" placeholder="Henüz yoksa boş bırakın">
                    </div>

                    <div class="form-group full-width">
                        <label class="form-label" style="font-weight:600;">
                            <i class="fas fa-paperclip mr-2"></i>Dava Evrakları (PDF)
                        </label>
                        <div class="custom-file">
                            <input type="file" class="custom-file-input" id="suitDocument" multiple accept=".pdf">
                            <label class="custom-file-label" for="suitDocument" style="justify-content: flex-start;">Dosya Seçiniz...</label>
                        </div>
                        <small class="text-muted mt-1">Dava dilekçesi vb. evrakları buradan yükleyebilirsiniz.</small>
                        
                        <div id="suitDocumentList" class="mt-3"></div>
                    </div>

                </div>
            </div>`;
    }

    _getLawsuitOpponentHtml() {
        return `
        <div class="section-card">
            <h3 class="section-title">5. Karşı Taraf</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Karşı Taraf</label><input type="text" id="opposingParty" class="form-input"></div>
                <div class="form-group"><label class="form-label">Vekili</label><input type="text" id="opposingCounsel" class="form-input"></div>
            </div>
        </div>`;
    }

    _getGenericRelatedPartyHtml(label) {
        return `
        <div class="section-card" id="relatedPartySection">
            <h3 class="section-title">3. ${label}</h3>
            <div class="form-group full-width">
                <label class="form-label">Kişi Ara</label>
                <div class="position-relative">
                    <div class="d-flex" style="gap:10px;">
                        <input type="text" id="personSearchInput" class="form-input">
                        <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person">+</button>
                    </div>
                    <div id="personSearchResults" class="search-results-list" style="display:none;"></div>
                </div>
            </div>
            <div class="form-group full-width mt-2"><label class="form-label">Seçilenler <span id="relatedPartyCount" class="badge badge-light">0</span></label><div id="relatedPartyList" class="selected-items-list"></div></div>
        </div>`;
    }

    _getAccrualCardHtml(isTab = false) {
        const cls = isTab ? 'form-section' : 'section-card';
        // 'accrualToggleWrapper' -> Açılıp kapanan dış kutu
        // 'createTaskAccrualContainer' -> AccrualFormManager'ın içini dolduracağı yer
        
        return `
        <div class="${cls}">
            <h3 class="section-title">Tahakkuk / Finansal Bilgiler</h3>
            
            <div class="accrual-controls mb-4 p-3 bg-light border rounded">
                <div class="d-flex align-items-center justify-content-between flex-wrap">
                    <div class="form-check mr-3">
                        <input class="form-check-input" type="checkbox" id="isFreeTransaction">
                        <label class="form-check-label font-weight-bold user-select-none" for="isFreeTransaction" style="cursor:pointer;">
                            Ücretsiz İşlem (Tahakkuk Oluşmayacak)
                        </label>
                    </div>

                    <button type="button" id="toggleAccrualFormBtn" class="btn btn-outline-primary btn-sm">
                        <i class="fas fa-chevron-down mr-1"></i> Tahakkuk Formu Aç
                    </button>
                </div>
                <small class="text-muted mt-2 d-block">
                    <i class="fas fa-info-circle"></i> Not: Formu açmazsanız veya "Ücretsiz" seçmezseniz, otomatik olarak "Tahakkuk Oluşturma" görevi atanacaktır.
                </small>
            </div>

            <div id="accrualToggleWrapper" style="display:none; border: 1px solid #e1e8ed; border-radius: 10px; padding: 15px; margin-top: 15px;">
                <div id="createTaskAccrualContainer"></div>
            </div>
        </div>`;
    }

    _getJobDetailsHtml(isTab = false) {
        const cls = isTab ? 'form-section' : 'section-card';
        return `
        <div class="${cls}">
            <h3 class="section-title">İş Detayları</h3>
            <div class="form-grid">
                <div class="form-group"><label class="form-label">Öncelik</label><select id="taskPriority" class="form-select"><option value="medium">Orta</option><option value="high">Yüksek</option></select></div>
                <div class="form-group"><label class="form-label">Atanacak</label><select id="assignedTo" class="form-select"><option value="">Seçiniz...</option></select></div>
                <div class="form-group full-width"><label class="form-label">Son Tarih</label><input type="text" id="taskDueDate" class="form-input placeholder="gg.aa.yyyy" data-datepicker"></div>
            </div>
        </div>`;
    }

    _getFormActionsHtml() {
        return `<div class="form-actions"><button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>Kaydet</button></div>`;
    }

    // Seçilen dosyaları listeleyen fonksiyon
    renderUploadedFiles(files) {
        const container = document.getElementById('suitDocumentList');
        const label = document.querySelector('.custom-file-label[for="suitDocument"]');
        
        // Label'ı güncelle (Örn: 3 dosya seçildi)
        if (label) {
            const count = files.length;
            label.textContent = count > 0 ? `${count} dosya seçildi` : 'Dosya Seçiniz...';
        }

        if (!container) return;

        if (!files || files.length === 0) {
            container.innerHTML = '';
            return;
        }

        // Listeyi oluştur
        container.innerHTML = files.map((file, index) => `
            <div class="d-flex justify-content-between align-items-center p-2 mb-2 border rounded bg-white shadow-sm">
                <div class="d-flex align-items-center overflow-hidden">
                    <i class="fas fa-file-pdf text-danger mr-3" style="font-size: 1.2rem;"></i>
                    <div style="overflow: hidden;">
                        <div class="text-truncate font-weight-bold text-dark" title="${file.name}">${file.name}</div>
                        <small class="text-muted">${(file.size / 1024 / 1024).toFixed(2)} MB</small>
                    </div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger border-0 remove-file-btn" data-index="${index}" title="Listeden Kaldır">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    // --- EKSİK OLAN FONKSİYONLAR EKLENDİ ---

    // 1. Seçilen Başvuru Sahiplerini Listeleme
    renderSelectedApplicants(applicants) {
        const container = document.getElementById('selectedApplicantsList');
        if (!container) return;
        if (!applicants || applicants.length === 0) {
            container.innerHTML = `<div class="empty-state"><p class="text-muted">Seçim yok.</p></div>`;
            return;
        }
        container.innerHTML = applicants.map(p => `
            <div class="selected-item d-flex justify-content-between align-items-center p-2 mb-2 border rounded">
                <span>${p.name}</span>
                <button type="button" class="btn btn-sm btn-danger remove-selected-item-btn" data-id="${p.id}"><i class="fas fa-trash-alt"></i></button>
            </div>`).join('');
    }

    // 2. Seçilen İlgili Tarafları Listeleme
    renderSelectedRelatedParties(parties) {
        const list = document.getElementById('relatedPartyList');
        const countEl = document.getElementById('relatedPartyCount');
        if (!list) return;
        if (!parties || parties.length === 0) {
            list.innerHTML = `<div class="empty-state"><p class="text-muted">Seçim yok.</p></div>`;
        } else {
            list.innerHTML = parties.map(p => `
                <div class="selected-item p-2 border rounded mb-2 d-flex justify-content-between">
                    <span>${p.name}</span>
                    <button class="btn btn-sm btn-danger remove-party" data-id="${p.id}">X</button>
                </div>`).join('');
        }
        if (countEl) countEl.textContent = parties ? parties.length : 0;
    }

    // 3. Rüçhan Listeleme
    renderPriorities(priorities) {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;
        if (!priorities || priorities.length === 0) {
            container.innerHTML = `<div class="empty-state"><p class="text-muted">Yok.</p></div>`;
            return;
        }
        container.innerHTML = priorities.map(p => `
            <div class="selected-item d-flex justify-content-between p-2 mb-2 border rounded">
                <span>${p.type} - ${p.country} - ${p.number}</span>
                <button class="btn btn-sm btn-danger remove-priority-btn" data-id="${p.id}">X</button>
            </div>`).join('');
    }

    // 4. WIPO Child Listeleme
    renderWipoAripoChildRecords(children) {
        const container = document.getElementById('wipoAripoChildList');
        const badge = document.getElementById('wipoAripoChildCount');
        const parent = document.getElementById('wipoAripoParentContainer');
        if (!container) return;
        
        if (!children || children.length === 0) {
            if(parent) parent.style.display = 'none';
            container.innerHTML = '';
            if(badge) badge.textContent = '0';
            return;
        }
        if(parent) parent.style.display = 'block';
        if(badge) badge.textContent = children.length;
        
        container.innerHTML = children.map(c => `
            <div class="selected-item d-flex justify-content-between mb-2">
                <span>${c.country} - ${c.applicationNumber||'-'}</span>
                <button class="btn btn-sm btn-danger remove-wipo-child-btn" data-id="${c.id}">X</button>
            </div>`).join('');
    }

// 5. Özet Sekmesi (GÜNCELLENMİŞ VERSİYON)
    renderSummaryTab(state) {
        const container = document.getElementById('summaryContent');
        if (!container) return;
        
        // --- 1. DOM ve State'den Güncel Verileri Çek ---
        
        // Marka Bilgileri
        const brandName = document.getElementById('brandExampleText')?.value || '-';
        const brandType = document.getElementById('brandType')?.value || '-';
        const brandCategory = document.getElementById('brandCategory')?.value || '-';
        const nonLatin = document.getElementById('nonLatinAlphabet')?.value || '-';
        
        // Atama ve İşlem Bilgileri
        const assignedToId = document.getElementById('assignedTo')?.value;
        const assignedUser = state.allUsers.find(u => u.id === assignedToId);
        const taskType = state.selectedTaskType?.alias || state.selectedTaskType?.name || '-';
        
        // Menşe (Detaylı)
        let origin = document.getElementById('originSelect')?.value || '-';
        if (origin === 'Yurtdışı Ulusal') {
            const countrySelect = document.getElementById('countrySelect');
            const countryName = countrySelect.options[countrySelect.selectedIndex]?.text;
            origin += ` (${countryName})`;
        }

        // Listeler (Sınıflar, Kişiler, Rüçhanlar)
        const classes = typeof getSelectedNiceClasses === 'function' ? getSelectedNiceClasses() : [];
        const classHtml = classes.length > 0 
            ? `<div style="max-height: 150px; overflow-y: auto;">${classes.map(c => `<div class="border-bottom py-1">${c}</div>`).join('')}</div>`
            : '<span class="text-danger">Seçim Yok</span>';

        const applicants = state.selectedApplicants && state.selectedApplicants.length > 0
            ? state.selectedApplicants.map(a => a.name).join(', ')
            : '<span class="text-danger">Seçilmedi</span>';

        let priorityHtml = 'Yok';
        if (state.priorities && state.priorities.length > 0) {
            priorityHtml = '<ul class="pl-3 mb-0">' + 
                state.priorities.map(p => `<li><strong>${p.type}:</strong> ${p.country} - ${p.number} (${p.date})</li>`).join('') + 
                '</ul>';
        }

        // --- 2. GÖRSEL VE İNDİRME ALANI ---
        let imageSection = '';
        
        if (state.uploadedFiles && state.uploadedFiles.length > 0) {
            const file = state.uploadedFiles[0];
            // Tarayıcı hafızasında geçici bir URL oluşturuyoruz (Blob URL)
            const imgUrl = URL.createObjectURL(file);
            
            imageSection = `
                <div class="card shadow-sm">
                    <div class="card-header bg-light text-center">
                        <h6 class="mb-0 text-dark">Marka Örneği</h6>
                    </div>
                    <div class="card-body text-center p-3">
                        <div style="background-color: #f8f9fa; border: 1px dashed #ccc; display: inline-block; padding: 5px; border-radius: 4px;">
                            <img src="${imgUrl}" alt="Marka" class="img-fluid" style="max-height: 250px; object-fit: contain;">
                        </div>
                        <div class="mt-3">
                            <p class="text-muted small mb-2">${file.name} (${(file.size/1024).toFixed(1)} KB)</p>
                            <a href="${imgUrl}" download="${file.name}" class="btn btn-sm btn-primary btn-block">
                                <i class="fas fa-download mr-2"></i>Görseli İndir
                            </a>
                        </div>
                    </div>
                </div>
            `;
        } else {
            imageSection = `
                <div class="alert alert-warning text-center">
                    <i class="fas fa-image fa-2x mb-2"></i><br>
                    Marka görseli yüklenmedi.
                </div>
            `;
        }

        // --- 3. HTML ŞABLONU (GRID YAPISI) ---
        const html = `
            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm mb-3">
                        <div class="card-header bg-white border-bottom">
                            <h5 class="mb-0 text-primary"><i class="fas fa-info-circle mr-2"></i>Başvuru Özeti</h5>
                        </div>
                        <div class="card-body p-0">
                            <table class="table table-striped table-hover mb-0">
                                <tbody>
                                    <tr>
                                        <th style="width: 30%;" class="pl-4">Marka Adı</th>
                                        <td class="text-primary font-weight-bold" style="font-size: 1.1em;">${brandName}</td>
                                    </tr>
                                    <tr><th class="pl-4">İşlem Tipi</th><td>${taskType}</td></tr>
                                    <tr><th class="pl-4">Marka Tipi / Türü</th><td>${brandType} / ${brandCategory}</td></tr>
                                    ${nonLatin !== '-' ? `<tr><th class="pl-4">Latin Dışı Karakter</th><td>${nonLatin}</td></tr>` : ''}
                                    <tr><th class="pl-4">Menşe</th><td>${origin}</td></tr>
                                    <tr><th class="pl-4">Atanan Uzman</th><td>${assignedUser?.displayName || assignedUser?.email || '<span class="text-danger">Seçilmedi</span>'}</td></tr>
                                    <tr><th class="pl-4">Başvuru Sahipleri</th><td>${applicants}</td></tr>
                                    <tr><th class="pl-4">Nice Sınıfları (${classes.length})</th><td>${classHtml}</td></tr>
                                    <tr><th class="pl-4">Rüçhan Bilgileri</th><td>${priorityHtml}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="col-lg-4">
                    ${imageSection}
                    
                    <div class="mt-3 p-3 bg-light rounded border text-muted small">
                        <i class="fas fa-check-double mr-1"></i>
                        Lütfen yukarıdaki bilgileri kontrol ediniz. "İş Oluştur ve Kaydet" butonuna bastığınızda işlem başlatılacaktır.
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }

    // 6. Parent Seçim Modalı (Withdrawal için)
    showParentSelectionModal(transactions, title) {
        console.log('🔄 Modal açılıyor...', { transactions, title });
        
        const modal = document.getElementById('selectParentModal');
        const list = document.getElementById('parentListContainer');
        const modalTitle = document.getElementById('selectParentModalLabel');
        
        if (!modal || !list) return;

        // 1. Modalı body'ye taşı (Z-Index sorunu için)
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }

        // 2. Boyut Ayarı
        const dialog = modal.querySelector('.modal-dialog');
        if (dialog) {
            dialog.classList.add('modal-lg'); 
            dialog.style.maxWidth = '800px';
        }
        
        // 3. Z-Index
        modal.style.zIndex = '1055'; 

        if(modalTitle) modalTitle.textContent = title || 'İşlem Seçimi';
        
        // Listeyi Temizle
        list.innerHTML = '';
        
        transactions.forEach(tx => {
            const li = document.createElement('li');
            li.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3';
            li.style.cursor = 'pointer';
            
            // --- TARİH HESAPLAMA (GÜÇLENDİRİLMİŞ) ---
            let dateDisplay = '-';
            // Hem creationDate hem timestamp alanlarını kontrol et
            const rawDate = tx.creationDate || tx.timestamp; 
            
            if (rawDate) {
                try {
                    // Firebase Timestamp objesi mi? (.toDate fonksiyonu var mı?)
                    if (rawDate.toDate && typeof rawDate.toDate === 'function') {
                        dateDisplay = rawDate.toDate().toLocaleDateString('tr-TR');
                    } 
                    // String veya Date objesi mi?
                    else {
                        const d = new Date(rawDate);
                        if (!isNaN(d)) {
                            dateDisplay = d.toLocaleDateString('tr-TR');
                        }
                    }
                } catch (e) { 
                    console.warn('Tarih formatlanamadı:', rawDate); 
                }
            }
            
            // --- HTML İÇERİĞİ (SADELEŞTİRİLMİŞ) ---
            // Tekrar eden açıklama satırı kaldırıldı. Sadece Tip ve Tarih var.
            li.innerHTML = `
                <div>
                    <h6 class="mb-0 font-weight-bold text-dark" style="font-size: 1.1rem;">
                        ${tx.transactionTypeName || tx.type || 'İşlem'}
                    </h6>
                    <small class="text-muted" style="font-size: 0.8rem;">Ref: ${tx.id.substring(0,6)}...</small>
                </div>
                
                <div class="text-right">
                    <span class="badge badge-primary p-2 px-3" style="font-size: 0.95rem; border-radius: 6px;">
                        <i class="far fa-calendar-alt mr-1"></i> ${dateDisplay}
                    </span>
                    <i class="fas fa-chevron-right text-muted ml-3"></i>
                </div>
            `;
            
            // Tıklama Olayı
            li.onclick = () => {
                const evt = new CustomEvent('parentTransactionSelected', { detail: { id: tx.id } });
                document.dispatchEvent(evt);
            };
            
            list.appendChild(li);
        });
        
        // 4. Modalı Aç
        if (window.$) {
            $(modal).modal({ backdrop: 'static', keyboard: false });
            $(modal).modal('show');
            // Backdrop ayarı
            setTimeout(() => {
                const backdrops = document.querySelectorAll('.modal-backdrop');
                backdrops.forEach(bd => {
                    bd.style.zIndex = '1050';
                    document.body.appendChild(bd);
                });
            }, 100);
        } else {
            modal.style.display = 'block';
            modal.classList.add('show');
            document.body.classList.add('modal-open');
        }
    }

    hideParentSelectionModal() {
        const modal = document.getElementById('selectParentModal');
        
        if (window.$) {
            $(modal).modal('hide');
        } else {
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('show');
            }
            document.body.classList.remove('modal-open');
            
            const backdrop = document.getElementById('custom-backdrop');
            if (backdrop) backdrop.remove();
        }
    }

    /**
     * Arama sonuçlarını (Dava veya Marka/Patent) ekrana basar
     * @param {Array} items - Bulunan kayıtlar
     * @param {Function} onSelect - Seçim yapıldığında çalışacak callback
     * @param {string} sourceType - 'suits', 'ipRecords', 'bulletin' vb.
     */
    renderAssetSearchResults(items, onSelect, sourceType = 'ipRecords') {
        const container = document.getElementById('ipRecordSearchResults'); 
        if (!container) return;

        if (!items || items.length === 0) {
            container.innerHTML = '<div class="p-2 text-muted">Sonuç bulunamadı.</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = items.map(item => {
            let badge = '';
            let title = '';
            let subTitle = '';
            let extraInfo = '';

            // --- A) DAVA KARTI (GÜNCELLENDİ) ---
            if (sourceType === 'suits' || item._source === 'suit') {
                badge = '<span class="badge badge-primary float-right" style="font-size: 10px;">Dava</span>';
                title = item.displayCourt || 'Mahkeme Bilgisi Yok';
                
                // Dosya No
                subTitle = `Dosya: <strong class="text-dark">${item.displayFileNumber}</strong>`;
                
                // Müvekkil ve Karşı Taraf Bilgisi (YENİ)
                if (item.displayClient) {
                    extraInfo += `<div class="text-muted small mt-1"><i class="fas fa-user-tie mr-1"></i>Müvekkil: ${item.displayClient}</div>`;
                }
                if (item.opposingParty && item.opposingParty !== '-') {
                    extraInfo += `<div class="text-muted small"><i class="fas fa-user-shield mr-1"></i>Karşı: ${item.opposingParty}</div>`;
                }
            } 
            // --- B) MARKA/PATENT KARTI ---
            else {
                // ... (Burası aynı kalıyor)
                const isThirdParty = String(item.recordOwnerType || '').toLowerCase() === 'third_party';
                badge = (item._source === 'bulletin' || isThirdParty) 
                    ? '<span class="badge badge-warning float-right">Bülten</span>' 
                    : '<span class="badge badge-info float-right">Portföy</span>';
                title = item.title || item.markName || '-';
                subTitle = item.applicationNumber || item.applicationNo || '-';
            }

            return `
            <div class="search-result-item p-3 border-bottom" style="cursor:pointer;" data-id="${item.id}" data-source="${item._source}">
                ${badge}
                <div class="font-weight-bold text-primary" style="font-size: 1.05rem;">${title}</div>
                <div class="mt-1">${subTitle}</div>
                ${extraInfo}
            </div>
            `;
        }).join('');
        
        container.style.display = 'block';

        // ... (Event listener kısmı aynı) ...
        container.querySelectorAll('.search-result-item').forEach(el => {
            el.addEventListener('click', () => {
                const record = items.find(i => i.id === el.dataset.id);
                onSelect(record, el.dataset.source);
                container.style.display = 'none';
            });
        });
    }
    
    // --- GENEL ---
    updateButtonsAndTabs(isLastTab) {
        const container = document.getElementById('formActionsContainer');
        if (container) {
            container.innerHTML = !isLastTab ?
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="button" id="nextTabBtn" class="btn btn-primary">İlerle</button>` :
                `<button type="button" id="cancelBtn" class="btn btn-secondary">İptal</button><button type="submit" id="saveTaskBtn" class="btn btn-primary" disabled>İşi Oluştur ve Kaydet</button>`;
        }
    }

    // Eksik olan populateDropdown metodu
    populateDropdown(elementId, items, valueKey, textKey, defaultText = 'Seçiniz...') {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.innerHTML = `<option value="">${defaultText}</option>`;
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item[valueKey];
            option.textContent = item[textKey];
            el.appendChild(option);
        });
        el.disabled = false;
    }

    // Yeni Metod: Arama başlığını ve placeholder'ı değiştirir
    updateAssetSearchLabel(sourceType) {
        const label = document.querySelector('#card-asset .section-title'); // "2. İşleme Konu Varlık" başlığı
        const input = document.getElementById('ipRecordSearch');
        const searchLabel = document.querySelector('#card-asset label.form-label'); // "Portföyden Ara" yazısı

        if (sourceType === 'suits') {
            if (label) label.textContent = '2. İşleme Konu Dava';
            if (searchLabel) searchLabel.textContent = 'Dava Dosyası Ara';
            if (input) input.placeholder = 'Dosya no, mahkeme adı...';
        } else {
            // Varsayılan
            if (label) label.textContent = '2. İşleme Konu Varlık';
            if (searchLabel) searchLabel.textContent = 'Portföyden Ara';
            if (input) input.placeholder = 'Marka adı, başvuru no...';
        }
    }

    // --- DAVA BİLGİLERİNİ DOLDURMA VE KİLİTLEME ---
    fillAndLockLawsuitFields(suit) {
        const details = suit.suitDetails || {};
        const client = suit.client || {};
        const clientName = client.name || suit.clientName || ''; // Obje veya string desteği

        // 1. MAHKEME ALANI
        const courtSelect = document.getElementById('courtName');
        const customInput = document.getElementById('customCourtInput');
        const courtVal = details.court || suit.court || '';

        if (courtSelect) {
            // Önce listede var mı diye bak
            let optionFound = false;
            for (let i = 0; i < courtSelect.options.length; i++) {
                if (courtSelect.options[i].value === courtVal) {
                    courtSelect.selectedIndex = i;
                    optionFound = true;
                    break;
                }
            }

            // Listede yoksa "Diğer" moduna geç
            if (!optionFound && courtVal) {
                courtSelect.value = 'other';
                if (customInput) {
                    customInput.style.display = 'block';
                    customInput.value = courtVal;
                    customInput.disabled = true; // Kilitle
                }
            } else if (customInput) {
                customInput.style.display = 'none';
                customInput.value = '';
            }
            courtSelect.disabled = true; // Select'i Kilitle
        }

        // 2. METİN ALANLARI (Konu, Karşı Taraf vb.)
        const fields = {
            'subjectOfLawsuit': details.description || '',
            'opposingParty': details.opposingParty || suit.opposingParty || '',
            'opposingCounsel': details.opposingCounsel || '',
            'clientRole': suit.clientRole || ''
        };

        for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                el.disabled = true; // Kilitle
            }
        }

        // 3. MÜVEKKİL ALANI (Özel İşlem)
        // Mevcut arama kutusunu gizle, seçili listesine ekle ve silme butonunu koyma
        const searchInput = document.getElementById('personSearchInput');
        const addBtn = document.getElementById('addNewPersonBtn');
        const listDiv = document.getElementById('relatedPartyList'); // veya client list ID'si

        if (searchInput) {
            searchInput.value = '';
            searchInput.disabled = true;
            searchInput.placeholder = 'Dava dosyasından otomatik çekildi...';
        }
        if (addBtn) addBtn.disabled = true;

        if (listDiv && clientName) {
            // Silme butonu olmayan statik bir kart oluştur
            listDiv.innerHTML = `
                <div class="selected-item p-2 border rounded mb-2 d-flex justify-content-between align-items-center bg-light">
                    <div>
                        <i class="fas fa-user-lock mr-2 text-muted"></i>
                        <strong>${clientName}</strong>
                    </div>
                    <span class="badge badge-secondary">Dava Müvekkili</span>
                </div>`;
        }
    }

    // --- KİLİTLERİ AÇMA VE TEMİZLEME (Seçim iptal edilirse) ---
    unlockAndClearLawsuitFields() {
        // 1. Mahkeme
        const courtSelect = document.getElementById('courtName');
        const customInput = document.getElementById('customCourtInput');
        
        if (courtSelect) {
            courtSelect.disabled = false;
            courtSelect.value = '';
        }
        if (customInput) {
            customInput.value = '';
            customInput.disabled = false;
            customInput.style.display = 'none';
        }

        // 2. Metin Alanları
        const ids = ['subjectOfLawsuit', 'opposingParty', 'opposingCounsel', 'clientRole'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                el.disabled = false;
            }
        });

        // 3. Müvekkil Alanı
        const searchInput = document.getElementById('personSearchInput');
        const addBtn = document.getElementById('addNewPersonBtn');
        const listDiv = document.getElementById('relatedPartyList');

        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = '';
        }
        if (addBtn) addBtn.disabled = false;
        if (listDiv) listDiv.innerHTML = ''; // Listeyi temizle
    }
}