// js/templates/form-templates.js
import {COURTS_LIST } from '../../utils.js';

export const FormTemplates = {
    getTrademarkForm: () => `
        <div class="form-section">
            <ul class="nav nav-tabs" id="portfolioTabs" role="tablist">
                <li class="nav-item">
                    <a class="nav-link active" id="brand-info-tab" data-toggle="tab" href="#brand-info" role="tab"><i class="fas fa-tag mr-1"></i>Marka Bilgileri</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="applicants-tab" data-toggle="tab" href="#applicants" role="tab"><i class="fas fa-users mr-1"></i>Başvuru Sahipleri</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="priority-tab" data-toggle="tab" href="#priority" role="tab"><i class="fas fa-star mr-1"></i>Rüçhan</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" id="goods-services-tab" data-toggle="tab" href="#goods-services" role="tab"><i class="fas fa-list-ul mr-1"></i>Mal ve Hizmetler</a>
                </li>
            </ul>
            
            <div class="tab-content tab-content-card" id="portfolioTabContent">
                <div class="tab-pane fade show active" id="brand-info" role="tabpanel">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="brandExampleText" class="form-label">Marka Metni</label>
                            <input type="text" id="brandExampleText" class="form-input" placeholder="Marka adını girin">
                        </div>
                        <div id="applicationNumberWrapper" class="form-group">
                            <label id="applicationNumberLabel" for="applicationNumber" class="form-label">Başvuru Numarası</label>
                            <input type="text" id="applicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                        </div>
                        <div class="form-group">
                            <label for="applicationDate" class="form-label">Başvuru Tarihi</label>
                            <input type="text" id="applicationDate" class="form-input" placeholder="gg.aa.yyyy" data-datepicker>
                        </div>
                        <div id="registrationNumberWrapper" class="form-group">
                            <label id="registrationNumberLabel" for="registrationNumber" class="form-label">Tescil Numarası</label>
                            <input type="text" id="registrationNumber" class="form-input" placeholder="Tescil numarasını girin">
                        </div>
                        <div class="form-group">
                            <label for="registrationDate" class="form-label">Tescil Tarihi</label>
                            <input type="text" id="registrationDate" class="form-input" placeholder="gg.aa.yyyy" data-datepicker>
                        </div>
                        <div class="form-group">
                            <label for="renewalDate" class="form-label">Yenileme Tarihi</label>
                            <input type="text" id="renewalDate" class="form-input" placeholder="gg.aa.yyyy" data-datepicker>
                        </div>
                        <div class="form-group">
                            <label for="trademarkStatus" class="form-label">Durum</label>
                            <select id="trademarkStatus" class="form-select"></select>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="bulletinNo" class="form-label">Bülten No</label>
                                <input id="bulletinNo" type="text" class="form-input" placeholder="Örn. 1">
                            </div>
                            <div class="form-group col-md-6">
                                <label for="bulletinDate" class="form-label">Bülten Tarihi</label>
                                <input id="bulletinDate" type="text" class="form-input" placeholder="gg.aa.yyyy" data-datepicker>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="brandType" class="form-label">Marka Tipi</label>
                            <select id="brandType" class="form-select">
                                <option value="Şekil + Kelime" selected>Şekil + Kelime</option>
                                <option value="Kelime">Kelime</option>
                                <option value="Şekil">Şekil</option>
                                <option value="Üç Boyutlu">Üç Boyutlu</option>
                                <option value="Renk">Renk</option>
                                <option value="Ses">Ses</option>
                                <option value="Hareket">Hareket</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="brandCategory" class="form-label">Marka Türü</label>
                            <select id="brandCategory" class="form-select">
                                <option value="Ticaret/Hizmet Markası" selected>Ticaret/Hizmet Markası</option>
                                <option value="Garanti Markası">Garanti Markası</option>
                                <option value="Ortak Marka">Ortak Marka</option>
                            </select>
                        </div>
                        <div class="form-group full-width">
                            <label for="brandDescription" class="form-label">Marka Açıklaması</label>
                            <textarea id="brandDescription" class="form-textarea" rows="3" placeholder="Marka hakkında açıklama girin"></textarea>
                        </div>
                        <div class="form-group full-width">
                            <label class="form-label">Marka Görseli</label>
                            <div class="brand-upload-frame">
                                <input type="file" id="brandExample" accept="image/*" style="display: none;">
                                <div id="brandExampleUploadArea" class="upload-area">
                                    <i class="fas fa-cloud-upload-alt fa-2x text-muted"></i>
                                    <p class="mt-2 mb-0">Dosya seçmek için tıklayın veya sürükleyip bırakın</p>
                                    <small class="text-muted">PNG, JPG, JPEG dosyaları kabul edilir</small>
                                </div>
                                <div id="brandExamplePreviewContainer" style="display: none;" class="text-center mt-3">
                                    <img id="brandExamplePreview" src="" alt="Marka Örneği" style="max-width: 200px; max-height: 200px; border: 1px solid #ddd; border-radius: 8px;">
                                    <br>
                                    <button type="button" id="removeBrandExampleBtn" class="btn btn-danger btn-sm mt-2">
                                        <i class="fas fa-trash"></i> Kaldır
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="applicants" role="tabpanel">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5>Başvuru Sahipleri</h5>
                        <button type="button" class="btn-add-person btn-small" id="addApplicantBtn">
                            <i class="fas fa-plus"></i> Yeni Kişi Ekle
                        </button>
                    </div>
                    <div class="form-group">
                        <label for="applicantSearch" class="form-label">Başvuru Sahibi Ara</label>
                        <div class="search-input-wrapper">
                            <input type="text" id="applicantSearch" class="search-input" placeholder="İsim veya e-mail ile ara...">
                            <div id="applicantSearchResults" class="search-results-list" style="display: none;"></div>
                        </div>
                    </div>
                    <div id="selectedApplicantsContainer" class="selected-items-container">
                        <div class="empty-state text-center py-4">
                            <i class="fas fa-users fa-2x text-muted mb-2"></i>
                            <p class="text-muted">Henüz başvuru sahibi seçilmedi</p>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="priority" role="tabpanel">
                    <div class="form-section">
                        <h3 class="section-title">Rüçhan Bilgileri</h3>
                        <p class="text-muted mb-3">Birden fazla rüçhan hakkı ekleyebilirsiniz.</p>
                        
                        <div class="form-group row">
                            <label for="priorityType" class="col-sm-3 col-form-label">Rüçhan Tipi</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="priorityType">
                                    <option value="başvuru" selected>Başvuru</option>
                                    <option value="sergi">Sergi</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityDate" class="col-sm-3 col-form-label" id="priorityDateLabel">Rüçhan Tarihi</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="priorityDate" placeholder="gg.aa.yyyy" data-datepicker>
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityCountry" class="col-sm-3 col-form-label">Rüçhan Ülkesi</label>
                            <div class="col-sm-9">
                                <select class="form-control" id="priorityCountry">
                                    <option value="">Seçiniz...</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group row">
                            <label for="priorityNumber" class="col-sm-3 col-form-label">Rüçhan Numarası</label>
                            <div class="col-sm-9">
                                <input type="text" class="form-control" id="priorityNumber" placeholder="Örn: 2023/12345">
                            </div>
                        </div>
                        
                        <div class="form-group full-width text-right mt-3">
                            <button type="button" id="addPriorityBtn" class="btn btn-secondary">
                                <i class="fas fa-plus mr-1"></i> Rüçhan Ekle
                            </button>
                        </div>
                        <hr class="my-4">
                        <div class="form-group full-width">
                            <label class="form-label">Eklenen Rüçhan Hakları</label>
                            <div id="addedPrioritiesList" class="selected-items-list">
                                <div class="empty-state text-center py-4">
                                    <i class="fas fa-info-circle fa-2x text-muted mb-2"></i>
                                    <p class="text-muted">Henüz rüçhan bilgisi eklenmedi.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="tab-pane fade" id="goods-services" role="tabpanel">
                    <div class="nice-classification-container">
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
    `,
    getPatentForm: () => `
        <div class="form-section">
            <h3 class="section-title">Patent Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="patentTitle" class="form-label">Patent Başlığı</label>
                    <input type="text" id="patentTitle" class="form-input" placeholder="Patent başlığını girin">
                </div>
                <div class="form-group">
                    <label for="patentApplicationNumber" class="form-label">Başvuru Numarası</label>
                    <input type="text" id="patentApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                </div>
                <div class="form-group full-width">
                    <label for="patentDescription" class="form-label">Patent Açıklaması</label>
                    <textarea id="patentDescription" class="form-textarea" rows="4" placeholder="Patent hakkında detaylı açıklama girin"></textarea>
                </div>
            </div>
        </div>
    `,
    getDesignForm: () => `
        <div class="form-section">
            <h3 class="section-title">Tasarım Bilgileri</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label for="designTitle" class="form-label">Tasarım Başlığı</label>
                    <input type="text" id="designTitle" class="form-input" placeholder="Tasarım başlığını girin">
                </div>
                <div class="form-group">
                    <label for="designApplicationNumber" class="form-label">Başvuru Numarası</label>
                    <input type="text" id="designApplicationNumber" class="form-input" placeholder="Başvuru numarasını girin">
                </div>
                <div class="form-group full-width">
                    <label for="designDescription" class="form-label">Tasarım Açıklaması</label>
                    <textarea id="designDescription" class="form-textarea" rows="4" placeholder="Tasarım hakkında detaylı açıklama girin"></textarea>
                </div>
            </div>
        </div>
    `,

    getSuitFields: (taskName) => {
        // Mahkeme Seçenekleri
        const courtOptions = COURTS_LIST.map(group => `
            <optgroup label="${group.label}">
                ${group.options.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('')}
            </optgroup>
        `).join('');

        return `
        <div class="card mb-4">
            <div class="card-header bg-white border-bottom">
                <h5 class="mb-0 text-dark">3. Dava Detayları</h5>
            </div>
            <div class="card-body">
                <div class="form-grid">
                    
                    <div class="form-group full-width">
                        <label for="suitCourt" class="form-label">Mahkeme</label>
                        <select id="suitCourt" name="suitCourt" class="form-select" required>
                            <option value="">Seçiniz...</option>
                            ${courtOptions}
                        </select>
                        <input type="text" id="customCourtInput" class="form-control mt-2" placeholder="Mahkeme adını yazınız..." style="display:none;">
                    </div>

                    <div class="form-group">
                        <label for="opposingParty" class="form-label">Karşı Taraf</label>
                        <input type="text" id="opposingParty" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="opposingCounsel" class="form-label">Karşı Taraf Vekili</label>
                        <input type="text" id="opposingCounsel" class="form-input">
                    </div>

                    <div class="form-group">
                        <label for="suitStatusSelect" class="form-label">Dava Durumu</label>
                        <select id="suitStatusSelect" class="form-select" required>
                            <option value="">Seçiniz...</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="suitCaseNo" class="form-label">Esas No</label>
                        <input type="text" class="form-control" id="suitCaseNo">
                    </div>

                    <div class="form-group">
                        <label for="suitOpeningDate" class="form-label">Dava Tarihi (Açılış)</label>
                        <input type="text" class="form-control" id="suitOpeningDate" placeholder="gg.aa.yyyy" data-datepicker required
                    </div>

                    <div class="form-group full-width mt-3">
                        <label class="form-label text-dark" style="font-weight:600;"><i class="fas fa-paperclip mr-2"></i>Dava Evrakları</label>
                        <div class="custom-file">
                            <input type="file" class="custom-file-input" id="suitDocument" multiple>
                            <label class="custom-file-label" for="suitDocument">Dosya Seçiniz...</label>
                        </div>
                        <small class="text-muted d-block mt-1">Dava dilekçesi, tensip zaptı vb. evrakları buraya yükleyebilirsiniz.</small>
                    </div>

                </div>
            </div>
        </div>`;
    },

    getClientSection: () => `
        <div class="card mb-4" id="clientSection">
            <div class="card-header bg-white border-bottom">
                <h5 class="mb-0 text-dark">1. Müvekkil Bilgileri</h5>
            </div>
            <div class="card-body">
                <div class="form-grid">
                    <div class="form-group">
                        <label for="clientRole" class="form-label">Müvekkil Rolü</label>
                        <select id="clientRole" name="clientRole" class="form-select" required>
                            <option value="">Seçiniz...</option>
                            <option value="davaci">Davacı (Plaintiff)</option>
                            <option value="davali">Davalı (Defendant)</option>
                        </select>
                    </div>
                    <div class="form-group"></div>
                </div>
                
                <div class="form-group full-width mt-3">
                    <label for="suitClientSearch" class="form-label">Müvekkil Ara</label>
                    <div class="d-flex" style="gap:10px; align-items:flex-start;">
                        <div class="search-input-wrapper" style="flex:1; position:relative;">
                            <input type="text" id="suitClientSearch" class="form-input" placeholder="Müvekkil adı, e-posta..." autocomplete="off">
                            <div id="suitClientSearchResults" class="search-results-list" style="display:none;"></div> 
                        </div>
                        <button type="button" id="addNewPersonBtn" class="btn-small btn-add-person"><span>&#x2795;</span> Yeni Kişi</button>
                    </div>
                </div>

                <div id="selectedSuitClient" class="mt-3 p-3 border rounded bg-light d-none align-items-center justify-content-between">
                    <div>
                        <span class="text-muted mr-2">Seçilen:</span>
                        <span id="selectedSuitClientName" class="font-weight-bold text-primary"></span>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="clearSuitClient">
                        <i class="fas fa-times mr-1"></i>Kaldır
                    </button>
                </div>
            </div>
        </div>
    `,

    getSubjectAssetSection: () => `
        <div class="card mb-4" id="subjectAssetSection">
            <div class="card-header bg-white border-bottom">
                <h5 class="mb-0 text-dark">2. Dava Konusu (Portföy Varlığı)</h5>
            </div>
            <div class="card-body">
                <div class="form-group full-width">
                    <label for="subjectAssetSearch" class="form-label">Portföyden Varlık Ara</label>
                    <div class="search-input-wrapper" style="position:relative;">
                        <input type="text" id="subjectAssetSearch" class="form-input" placeholder="Başlık, numara, tip..." autocomplete="off">
                        <div id="subjectAssetSearchResults" class="search-results-list" style="display:none;"></div> 
                    </div>
                </div>
                <div id="selectedSubjectAsset" class="mt-3 p-3 border rounded bg-light d-none align-items-center justify-content-between">
                    <div>
                        <span class="text-muted mr-2">Seçilen:</span>
                        <span id="selectedSubjectAssetName" class="font-weight-bold text-primary"></span>
                        <small class="text-muted ml-2">(<span id="selectedSubjectAssetType"></span> - <span id="selectedSubjectAssetNumber"></span>)</small>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="clearSubjectAsset">
                        <i class="fas fa-times mr-1"></i>Kaldır
                    </button>
                </div>
            </div>
        </div>
    `
}; 