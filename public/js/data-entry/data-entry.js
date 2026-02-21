// js/data-entry/data-entry.js

// 1. Üst Modüller
import { initializeNiceClassification, getSelectedNiceClasses, setSelectedNiceClasses } from '../nice-classification.js';
import { loadSharedLayout} from '../layout-loader.js';
import { PersonModalManager } from '../components/PersonModalManager.js';

// 2. Servisler ve Konfigürasyonlar
import { personService, ipRecordsService, storage, auth, transactionTypeService } from '../../firebase-config.js';
import { STATUSES, ORIGIN_TYPES } from '../../utils.js';

// 3. Yerel Modüller
import { FormTemplates } from './form-templates.js';
import { TrademarkStrategy, PatentStrategy, DesignStrategy, SuitStrategy } from './strategies.js';

// 4. Firebase SDK
import { ref, uploadBytes, deleteObject, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { collection, doc, getDoc, getDocs, getFirestore, query, where , updateDoc,  addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; 

// Yardımcı: URL'den dosya yolu ayrıştırma
function __pathFromDownloadURL(url) {
  try {
    const m = String(url).match(/\/o\/(.+?)\?/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (e) { return null; }
}

class DataEntryModule {
    
    constructor() {
        // DOM Elementleri
        this.ipTypeSelect = document.getElementById('ipTypeSelect');
        this.dynamicFormContainer = document.getElementById('dynamicFormContainer');
        this.saveBtn = document.getElementById('savePortfolioBtn');
        this.recordOwnerTypeSelect = document.getElementById('recordOwnerType');
        
        // State Değişkenleri
        this.currentIpType = null;
        this.editingRecordId = null;
        this.uploadedBrandImage = null;
        this.isNiceInitialized = false;
        this.currentTransactionHierarchy = 'parent'; // Varsayılan
        
        // Veri Listeleri
        this.allPersons = [];
        this.allCountries = [];
        this.allTransactionTypes = []; 
        this.selectedApplicants = [];
        this.priorities = [];
        this.selectedCountries = [];
        
        // Dava (Suit) State
        this.suitClientPerson = null;
        this.suitSpecificTaskType = null;
        this.suitSubjectAsset = null;

        this.authService = auth;
        this.personModal = new PersonModalManager();
        
        // Stratejiler
        this.strategies = {
            'trademark': new TrademarkStrategy(),
            'patent': new PatentStrategy(),
            'design': new DesignStrategy(),
            'suit': new SuitStrategy()
        };
    }

    // ============================================================
    // 1. BAŞLATMA VE YÜKLEME (INIT & LOAD)
    // ============================================================

    async init() {
        this.setupChildPropagationModal && this.setupChildPropagationModal();
        console.log('🚀 Data Entry Module başlatılıyor...');
        
        try {
            await this.loadAllData();
            
            // Varsayılan ayarlar
            this.currentIpType = this.ipTypeSelect.value || 'trademark';
            this.populateOriginDropdown('originSelect', 'TÜRKPATENT', this.currentIpType);
            this.handleOriginChange(document.getElementById('originSelect').value);

            this.setupEventListeners();
            this.setupModalCloseButtons();

            // Düzenleme modu kontrolü
            await this.loadRecordForEditing();

        } catch (error) {
            console.error('Data Entry Module init hatası:', error);
        }
    }

    async loadAllData() {
        try {
            const [personsResult, countriesResult, transactionTypesResult] = await Promise.all([
                personService.getPersons(),
                this.getCountries(),
                this.getTaskTypes(),
            ]);
            
            this.allPersons = personsResult.success ? personsResult.data : [];
            this.allCountries = countriesResult; 
            
            console.log('📊 Veriler yüklendi:', { 
                persons: this.allPersons.length, 
                countries: this.allCountries.length, 
                tasks: this.allTransactionTypes.length 
            });
        } catch (error) {
            console.error('Veriler yüklenirken hata:', error);
            this.allPersons = []; this.allCountries = []; this.allTransactionTypes = [];
        }
    }

    async loadRecordForEditing() {
        const urlParams = new URLSearchParams(window.location.search);
        this.editingRecordId = urlParams.get('id');
        const formTitle = document.getElementById('formTitle');
        
        if (this.editingRecordId) {
            if (formTitle) formTitle.textContent = 'Kayıt Düzenle';
            try {
                const recordResult = await ipRecordsService.getRecordById(this.editingRecordId);
                if (recordResult.success) {
                    this.populateFormFields(recordResult.data);
                }
            } catch (error) {
                console.error('Kayıt yükleme hatası:', error);
            }
        } else {
            if (formTitle) formTitle.textContent = 'Yeni Kayıt Ekle';
            this.currentIpType = this.ipTypeSelect.value;
            this.handleIPTypeChange(this.currentIpType);
        }
    }

    // ============================================================
    // 2. EVENT LISTENER & UI HANDLERS
    // ============================================================

    setupEventListeners() {
        if (this.ipTypeSelect) {
            this.ipTypeSelect.addEventListener('change', (e) => this.handleIPTypeChange(e.target.value));
        }
        
        const originSelect = document.getElementById('originSelect');
        if(originSelect){
            originSelect.addEventListener('change', (e) => this.handleOriginChange(e.target.value));
        }
        
        const specificTaskType = document.getElementById('specificTaskType');
        if (specificTaskType) {
            specificTaskType.addEventListener('change', (e) => this.handleSpecificTaskTypeChange(e));
        }

        if (this.saveBtn) {
            this.saveBtn.addEventListener('click', () => this.handleSavePortfolio());
        }
        
        if (this.recordOwnerTypeSelect) {
            this.recordOwnerTypeSelect.addEventListener('change', () => this.updateSaveButtonState());
        }
        // Mahkeme "Diğer" seçimi için global dinleyici
        document.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'suitCourt') {
                const customInput = document.getElementById('customCourtInput');
                if (customInput) {
                    if (e.target.value === 'other') {
                        customInput.style.display = 'block';
                        customInput.required = true;
                        customInput.focus();
                    } else {
                        customInput.style.display = 'none';
                        customInput.value = '';
                        customInput.required = false;
                    }
                }
            }
            
            // 2. DOSYA YÜKLEME GÖRSEL GÜNCELLEMESİ (YENİ EKLENEN KISIM)
            // Kullanıcı dosya seçtiğinde "Dosya Seçiniz..." yazısı dosya ismiyle değişir.
            if (e.target && e.target.id === 'suitDocument') {
                const label = e.target.nextElementSibling; // custom-file-label etiketi
                const files = e.target.files;
                
                if (label) {
                    if (files && files.length > 0) {
                        // Tek dosya ise ismini, çoklu ise sayısını yaz
                        if (files.length === 1) {
                            label.textContent = files[0].name;
                            label.classList.add('text-primary'); // Seçildiğini belli etmek için renk verelim
                            label.style.fontWeight = 'bold';
                        } else {
                            label.textContent = `${files.length} dosya seçildi`;
                            label.classList.add('text-primary');
                            label.style.fontWeight = 'bold';
                        }
                    } else {
                        // Seçim iptal edilirse eski haline dön
                        label.textContent = 'Dosya Seçiniz...';
                        label.classList.remove('text-primary');
                        label.style.fontWeight = 'normal';
                    }
                }
            }
        });

    }

    handleIPTypeChange(ipType) {
        console.log('📋 IP türü değişti:', ipType);
        this.currentIpType = ipType;
        
        const isSuit = ipType === 'suit';
        const ownerCard = document.getElementById('ownerCard');
        const specificTaskTypeWrapper = document.getElementById('specificTaskTypeWrapper');
        const originSelectWrapper = document.getElementById('originSelectWrapper');
        const suitSpecificFieldsCard = document.getElementById('suitSpecificFieldsCard'); // Bu bizim ana kutumuz
        const dynamicFormContainer = document.getElementById('dynamicFormContainer');
        const clientSection = document.querySelector('.card[id="clientSection"]'); 
        
        // Temizlik
        dynamicFormContainer.innerHTML = '';
        if (clientSection) clientSection.remove();
        document.getElementById('countrySelectionContainer').style.display = 'none';

        if (ownerCard) ownerCard.style.display = isSuit ? 'none' : 'block';

        if (isSuit) {
            specificTaskTypeWrapper.style.display = 'block';
            originSelectWrapper.style.display = 'block';
            
            if (suitSpecificFieldsCard) {
                // --- KRİTİK DÜZELTME BAŞLANGICI ---
                // HTML'den gelen 'card', 'card-body', 'p-3' gibi sınıfları siliyoruz.
                // Böylece "çift çerçeve" ve "girinti" sorunu ortadan kalkıyor.
                suitSpecificFieldsCard.className = ''; 
                suitSpecificFieldsCard.style.display = 'block';
                suitSpecificFieldsCard.innerHTML = ''; // İçini tamamen temizle
                // --- KRİTİK DÜZELTME BİTİŞİ ---
            }

            this.renderSuitClientSection(); 
            this.populateOriginDropdown('originSelect', 'TURKEY_NATIONAL', ipType); 
            this.populateSpecificTaskTypeDropdown(ipType);
            
        } else {
            // Marka/Patent Seçimi
            specificTaskTypeWrapper.style.display = 'none';
            originSelectWrapper.style.display = 'block'; 
            if(suitSpecificFieldsCard) suitSpecificFieldsCard.style.display = 'none';

            dynamicFormContainer.style.display = 'block';
            switch(ipType) {
                case 'trademark': this.renderTrademarkForm(); break;
                case 'patent': this.renderPatentForm(); break;
                case 'design': this.renderDesignForm(); break;
            }

            this.populateOriginDropdown('originSelect', 'TÜRKPATENT', ipType);
            this.handleOriginChange(document.getElementById('originSelect')?.value);
        }
        this.updateSaveButtonState();
    }

    handleOriginChange(originType) {
        this.updateRegistrationInputUI(originType);
        const countrySelectionContainer = document.getElementById('countrySelectionContainer');
        const singleSelectWrapper = document.getElementById('singleCountrySelectWrapper');
        const multiSelectWrapper = document.getElementById('multiCountrySelectWrapper');
        const title = document.getElementById('countrySelectionTitle');

        if (!countrySelectionContainer) return;

        const ipType = document.getElementById('ipTypeSelect')?.value;
        const isLawsuit = ipType === 'suit';

        this.selectedCountries = [];
        countrySelectionContainer.style.display = 'none';
        singleSelectWrapper.style.display = 'none';
        multiSelectWrapper.style.display = 'none';

        if (isLawsuit && originType === 'FOREIGN_NATIONAL') {
            title.textContent = 'Menşe Ülke Seçimi (Dava)';
            countrySelectionContainer.style.display = 'block';
            singleSelectWrapper.style.display = 'block';
            this.populateCountriesDropdown('countrySelect');
        } 
        else if (originType === 'Yurtdışı Ulusal' && ipType !== 'suit') {
            title.textContent = 'Menşe Ülke Seçimi';
            countrySelectionContainer.style.display = 'block';
            singleSelectWrapper.style.display = 'block';
            this.populateCountriesDropdown('countrySelect');
        } 
        else if ((originType === 'WIPO' || originType === 'ARIPO') && ipType !== 'suit') {
            title.textContent = `Seçim Yapılacak Ülkeler (${originType})`;
            countrySelectionContainer.style.display = 'block';
            multiSelectWrapper.style.display = 'block';
            this.setupMultiCountrySelect();
        }
    }

    updateRegistrationInputUI(origin) {
        const regLabel = document.getElementById('registrationNumberLabel');
        const regInput = document.getElementById('registrationNumber');
        
        if (!regLabel || !regInput) return;

        if (origin === 'WIPO') {
            regLabel.textContent = 'WIPO IR Numarası';
            regInput.placeholder = 'WIPO IR Numarasını girin...';
        } else if (origin === 'ARIPO') {
            regLabel.textContent = 'ARIPO IR Numarası';
            regInput.placeholder = 'ARIPO IR Numarasını girin...';
        } else {
            // Varsayılan (TÜRKPATENT vb.)
            regLabel.textContent = 'Tescil Numarası';
            regInput.placeholder = 'Tescil numarasını girin';
        }
    }

    handleSpecificTaskTypeChange(e) {
        const taskTypeId = e.target.value;
        this.suitSpecificTaskType = this.allTransactionTypes.find(t => t.id === taskTypeId);
        
        // Artık alt container aramıyoruz, direkt ana kutuya basacağız
        const container = document.getElementById('suitSpecificFieldsCard');

        if (this.suitSpecificTaskType && container) {
            // Formu direkt ana kutunun içine basıyoruz
            container.innerHTML = this.renderSuitFields(this.suitSpecificTaskType.alias || this.suitSpecificTaskType.name);
            
            this.setupSuitPersonSearchSelectors(); 
            this.setupDynamicFormListeners(); 
            this._populateSuitStatusDropdown(); 
        } else if (container) {
            container.innerHTML = '';
        }
        this.updateSaveButtonState();
    }

    // ============================================================
    // 3. FORM RENDER & LOGIC
    // ============================================================

    renderTrademarkForm() {
        this.dynamicFormContainer.innerHTML = FormTemplates.getTrademarkForm();
        this._populateStatusDropdown('trademark');
        this.setupDynamicFormListeners();
        this.setupBrandExampleUploader();
        this.setupClearClassesButton();
        this.populateCountriesDropdown('priorityCountry');
        this.updateSaveButtonState();
    }

    renderPatentForm() {
        this.dynamicFormContainer.innerHTML = FormTemplates.getPatentForm();
        this.populateCountriesDropdown('priorityCountry');
        this.updateSaveButtonState();
    }

    renderDesignForm() {
        this.dynamicFormContainer.innerHTML = FormTemplates.getDesignForm();
        this.populateCountriesDropdown('priorityCountry');
        this.updateSaveButtonState();
    }

    renderSuitFields(taskName) {
        return FormTemplates.getSuitFields(taskName);
    }

    _populateSuitStatusDropdown() {
        const el = document.getElementById('suitStatusSelect');
        // STATUSES.litigation listesini utils.js'ten kullanıyoruz
        const list = STATUSES.litigation || []; 
        
        if (el) {
            el.innerHTML = '<option value="">Seçiniz...</option>' + 
                list.map(s => `<option value="${s.value}">${s.text}</option>`).join('');
        }
    }

    _populateStatusDropdown(type) {
        const stSel = document.getElementById(`${type}Status`);
        if (stSel && STATUSES[type]) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES[type]
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            if (!this.editingRecordId) stSel.value = '';
        }
    }

    setupDynamicFormListeners() {
        // Tab Listenerları
        const tabLinks = document.querySelectorAll('#portfolioTabs a[data-toggle="tab"]');
        tabLinks.forEach(tabLink => {
            tabLink.addEventListener('shown.bs.tab', (e) => this.handleTabChange(e.target.getAttribute('href')));
            tabLink.addEventListener('click', (e) => {
                setTimeout(() => this.handleTabChange(e.target.getAttribute('href')), 200);
            });
        });

        // Kişi Arama ve Ekleme
        const applicantSearch = document.getElementById('applicantSearch');
        if (applicantSearch) applicantSearch.addEventListener('input', (e) => this.searchPersons(e.target.value, 'applicant'));
        
        const addApplicantBtn = document.getElementById('addApplicantBtn');
        if (addApplicantBtn) {
            addApplicantBtn.addEventListener('click', () => {
                // Yeni merkezi modalı aç
                this.personModal.open(null, (newPerson) => {
                    this.allPersons.push(newPerson);
                    this.addSelectedPerson(newPerson, 'applicant');
                });
            });
        }

        // Rüçhan İşlemleri
        const addPriorityBtn = document.getElementById('addPriorityBtn');
        if (addPriorityBtn) addPriorityBtn.addEventListener('click', () => this.addPriority());
        
        const priorityType = document.getElementById('priorityType');
        if (priorityType) priorityType.addEventListener('change', (e) => this.handlePriorityTypeChange(e.target.value));

        const addedPrioritiesList = document.getElementById('addedPrioritiesList');
        if (addedPrioritiesList) {
            addedPrioritiesList.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.remove-priority-btn');
                if (removeBtn) this.removePriority(removeBtn.dataset.id);
            });
        }

        // Form değişikliklerini izle
        this.dynamicFormContainer.addEventListener('input', () => this.updateSaveButtonState());
        
        // Datepickerları başlat
        this.initializeDatePickers();
    }

    initializeDatePickers() {
    // Merkezi date-picker'ı tetikle:
    if (window.EvrekaDatePicker) {
        window.EvrekaDatePicker.refresh(this.dynamicFormContainer);
    }
}

    // ============================================================
    // 4. KAYDETME & WIPO/ARIPO MANTIĞI (CORE)
    // ============================================================
    async handleSavePortfolio() {
        const ipType = this.ipTypeSelect.value;
        const strategy = this.strategies[ipType];

        if (!strategy) {
            alert('Geçersiz IP Türü');
            return;
        }

        // 1. Veriyi Topla
        const recordData = strategy.collectData(this);
        // --- NİCE VERİLERİNİ MERKEZİ EDİTÖRDEN ÇEK VE FORMATLA ---
        if (this.currentIpType === 'trademark') {
            const selectedNiceData = getSelectedNiceClasses(); 
            const tempMap = {};

            selectedNiceData.forEach(str => {
                const match = str.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                if (match) {
                    const classNo = match[1];
                    const content = match[2];
                    if (!tempMap[classNo]) tempMap[classNo] = [];
                    // Metni satırlara böl, temizle ve boş olmayanları ekle
                    const lines = content.split('\n').map(l => l.trim()).filter(l => l !== '');
                    tempMap[classNo].push(...lines);
                }
            });

            // Firestore formatına (classNo ve items) dönüştür
            recordData.goodsAndServicesByClass = Object.entries(tempMap).map(([num, items]) => ({
                classNo: Number(num),
                items: [...new Set(items)] // Tekrar edenleri temizle
            })).sort((a, b) => a.classNo - b.classNo);
            
            // niceClasses listesini güncelle (örn: ["1", "5", "35"])

            recordData.niceClasses = Object.keys(tempMap).sort((a, b) => Number(a) - Number(b));
        }

        // 🔥 YENİ: Başvuru sahiplerinin (applicants) ID'lerini düz bir diziye çevir (Silme/Ekleme burada otomatik algılanır)
        if (recordData.applicants && Array.isArray(recordData.applicants)) {
            recordData.applicantIds = recordData.applicants.map(app => app.id).filter(Boolean);
        } else {
            recordData.applicantIds = [];
        }

        // 2. Validasyon
        const error = strategy.validate(recordData, this);
        if (error) {
            alert(error);
            return;
        }

        // 3. Ortak Alanları Ekle
        recordData.recordOwnerType = this.recordOwnerTypeSelect.value;
        
        // Yeni kayıt ise createdAt ekle
        if (!this.editingRecordId) {
            recordData.createdAt = new Date().toISOString(); 
        }
        // Her güncellemede updatedAt yenile
        recordData.updatedAt = new Date().toISOString(); 

        try {
            this.saveBtn.disabled = true;
            this.saveBtn.textContent = 'İşleniyor...';

            // ============================================================
            // 🚀 KRİTİK DÜZELTME: STRATEJİYE ÖZEL KAYIT KONTROLÜ
            // ============================================================
            // Eğer stratejinin (örn: SuitStrategy) kendine ait bir 'save' metodu varsa,
            // tüm kayıt işlemini (dosya yükleme, transaction vb.) ona devret.
            if (strategy.save) {
                if (this.editingRecordId) {
                    recordData.id = this.editingRecordId;
                }
                
                await strategy.save(recordData);
                alert(this.editingRecordId ? 'Kayıt güncellendi.' : 'Dava kaydı ve işlem geçmişi başarıyla oluşturuldu.');
                
                // 🔥 YENİ UX: Portföy sekmesine güncellendiğini haber ver
                if (this.editingRecordId) localStorage.setItem('crossTabUpdatedRecordId', this.editingRecordId);
                
                // Eğer yeni sekmede açıldıysa kapat, değilse yönlendir
                if (window.opener) { window.close(); } else { window.location.href = 'portfolio.html'; }
                return; 
            }
            // ============================================================


            // ... (Aşağıdaki kodlar SADECE Marka/Patent/Tasarım için çalışmaya devam eder) ...

            // 🖼️ DOSYA YÜKLEME (Sadece Marka ve Dosya Seçiliyse)
            if (ipType === 'trademark') {
                if (this.uploadedBrandImage instanceof File) {
                    console.log('📤 Resim Storage\'a yükleniyor...');
                    this.saveBtn.textContent = 'Resim Yükleniyor...';
                    
                    const fileName = `${Date.now()}_${this.uploadedBrandImage.name}`;
                    const storagePath = `brand-images/${fileName}`;
                    
                    const downloadURL = await this.uploadFileToStorage(this.uploadedBrandImage, storagePath);
                    
                    if (downloadURL) {
                        recordData.brandImageUrl = downloadURL;
                        console.log('✅ Resim yüklendi, URL:', downloadURL);
                    } else {
                        throw new Error("Resim yüklenemedi.");
                    }
                } else if (typeof this.uploadedBrandImage === 'string') {
                    // Mevcut URL'i koru
                    recordData.brandImageUrl = this.uploadedBrandImage;
                }
            }

            this.saveBtn.textContent = 'Kaydediliyor...';

            // 🔄 KAYIT İŞLEMİ (Marka/Patent/Tasarım)
            if (this.editingRecordId) {
                // --- GÜNCELLEME (UPDATE) MODU ---
                console.log('✏️ Güncelleme modu, ID:', this.editingRecordId);

                if (recordData.origin === 'WIPO') {
                    recordData.wipoIR = recordData.internationalRegNumber || recordData.registrationNumber;
                } else if (recordData.origin === 'ARIPO') {
                    recordData.aripoIR = recordData.internationalRegNumber || recordData.registrationNumber;
                }

                // WIPO/ARIPO Kontrolü: Parent'ın ülke listesini güncelle
                if ((recordData.origin === 'WIPO' || recordData.origin === 'ARIPO') && this.currentTransactionHierarchy === 'parent') {
                    if (this.selectedCountries && this.selectedCountries.length > 0) {
                        recordData.countries = this.selectedCountries.map(c => c.code);
                    }
                }

                // 1. Mevcut Kaydı Güncelle
                const result = await ipRecordsService.updateRecord(this.editingRecordId, recordData);
                
                if (!result.success) {
                    throw new Error(result.error || 'Güncelleme başarısız.');
                }
                
                // 2. WIPO/ARIPO Child Senkronizasyonu
                if ((recordData.origin === 'WIPO' || recordData.origin === 'ARIPO') && this.currentTransactionHierarchy === 'parent') {
                    await this.syncAndCreateMissingChildren(this.editingRecordId, recordData);
                    await this.propagateUpdatesToChildren(this.editingRecordId, recordData);
                }

                alert('Kayıt başarıyla güncellendi.');
                sessionStorage.setItem('updatedRecordId', this.editingRecordId);
                localStorage.setItem('crossTabUpdatedRecordId', this.editingRecordId); // 🔥 Portföy sekmesine haber ver

            } else {
                console.log('➕ Yeni kayıt modu (Marka/Patent)...');
                await this.saveIpRecordWithStrategy(recordData); 
            }

            // 🔥 YENİ UX: Başarılı ise sekmeyi kapat
            if (window.opener) {
                window.close();
            } else {
                window.location.href = 'portfolio.html';
            }

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            
            if (error.message && error.message.includes('duplikasyon')) {
                alert('HATA: Bu kayıt zaten mevcut (Aynı numara ile).');
            } else {
                alert('Bir hata oluştu: ' + error.message);
            }
        } finally {
            if (this.saveBtn) {
                this.saveBtn.disabled = false;
                this.saveBtn.textContent = 'Kaydet';
            }
        }
    }

    async saveIpRecordWithStrategy(data) {
        const isInternational = (data.origin === 'WIPO' || data.origin === 'ARIPO');
        const hasCountries = this.selectedCountries && this.selectedCountries.length > 0;

        console.log('🌍 Kayıt Modu:', { origin: data.origin, isInt: isInternational });

        if (isInternational && hasCountries) {
            // --- SENARYO A: Parent + Child Kayıt ---
            const parentData = { ...data, transactionHierarchy: 'parent', countries: this.selectedCountries.map(c => c.code) };
            
            // Temizlik
            delete parentData.wipoIR; delete parentData.aripoIR;
            const irNumber = data.internationalRegNumber || data.registrationNumber;
            if (data.origin === 'WIPO') parentData.wipoIR = irNumber;
            else if (data.origin === 'ARIPO') parentData.aripoIR = irNumber;

            // Parent Oluştur
            const parentRes = await ipRecordsService.createRecordFromDataEntry(parentData);
            if (!parentRes.success) throw new Error(parentRes.error);
            const parentId = parentRes.id;

            // Child Döngüsü
            const promises = this.selectedCountries.map(async (country) => {
                try {
                    const childData = { ...data };
                    // Gereksizleri Sil
                    ['applicationNumber', 'registrationNumber', 'internationalRegNumber', 'countries', 'wipoIR', 'aripoIR'].forEach(k => delete childData[k]);
                    
                    // Child Verisi
                    childData.transactionHierarchy = 'child';
                    childData.parentId = parentId;
                    childData.country = country.code;
                    childData.createdFrom = 'wipo_child_generation';
                    if (parentData.wipoIR) childData.wipoIR = parentData.wipoIR;
                    if (parentData.aripoIR) childData.aripoIR = parentData.aripoIR;

                    const res = await ipRecordsService.createRecordFromDataEntry(childData);
                    if(res.success) {
                        await this.addTransactionForNewRecord(res.id, data.ipType, 'parent');
                    }
                } catch (e) { console.error('Child hata:', e); }
            });

            await Promise.all(promises);
            await this.addTransactionForNewRecord(parentId, data.ipType, 'parent');

        } else {
            // --- SENARYO B: Tekil Kayıt ---
            if (['TÜRKPATENT', 'Yurtdışı Ulusal', 'TURKEY_NATIONAL'].includes(data.origin)) {
                 delete data.wipoIR; delete data.aripoIR; delete data.internationalRegNumber;
            }
            if (data.origin === 'Yurtdışı Ulusal' && !data.country) {
                const cSelect = document.getElementById('countrySelect');
                if (cSelect) data.country = cSelect.value;
            }

            const res = await ipRecordsService.createRecordFromDataEntry(data);
            if (!res.success) throw new Error(res.error);
            await this.addTransactionForNewRecord(res.id, data.ipType, 'parent');
        }
    }

    // ✅ YENİ FONKSİYON: Parent güncellendiğinde yeni eklenen ülkeleri yaratır
    async syncAndCreateMissingChildren(parentId, parentData) {
        try {
            console.log('🔄 Child Senkronizasyonu Başladı. ParentID:', parentId);
            const db = getFirestore();
            
            const q = query(
                collection(db, 'ipRecords'),
                where('parentId', '==', parentId)
            );
            
            const querySnapshot = await getDocs(q);
            const existingCountryCodes = [];

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                if (data.transactionHierarchy === 'child' && data.country) {
                    existingCountryCodes.push(String(data.country).trim());
                }
            });

            console.log('🔎 Veritabanında Bulunan Child Ülkeler:', existingCountryCodes);
            console.log('📝 Formdaki Seçili Ülkeler:', this.selectedCountries.map(c => c.code));

            // 2. ADIM: Sadece LİSTEDE OLMAYAN yeni ülkeleri belirle
            const countriesToCreate = this.selectedCountries.filter(c => {
                const formCountryCode = String(c.code).trim();
                return !existingCountryCodes.includes(formCountryCode);
            });

            if (countriesToCreate.length === 0) {
                console.log('✅ Yeni eklenecek ülke yok. Mevcut kayıtlar korunuyor.');
                return; // Fonksiyondan çık
            }

            console.log('🚀 Oluşturulacak Yeni Ülkeler:', countriesToCreate.map(c => c.code));

            // 3. ADIM: Eksik Olanları Yarat
            const promises = countriesToCreate.map(async (country) => {
                try {
                    const childData = { ...parentData };

                    delete childData.applicationNumber; 
                    delete childData.registrationNumber; 
                    delete childData.internationalRegNumber; 
                    delete childData.countries; 
                    delete childData.wipoIR;
                    delete childData.aripoIR;
                    delete childData.id; 

                    // ✅ CHILD VERİSİ
                    childData.transactionHierarchy = 'child';
                    childData.parentId = parentId;
                    childData.country = country.code;
                    childData.createdFrom = 'wipo_update_sync'; 

                    // IR Numaralarını ayarla
                    const irNumber = parentData.internationalRegNumber || parentData.registrationNumber;
                    if (parentData.origin === 'WIPO') childData.wipoIR = irNumber;
                    else if (parentData.origin === 'ARIPO') childData.aripoIR = irNumber;

                    console.log(`➡️ Yeni Child Kaydı Oluşturuluyor: ${country.code}`);

                    const res = await ipRecordsService.createRecordFromDataEntry(childData);
                    
                    if (res.success) {
                        await this.addTransactionForNewRecord(res.id, parentData.ipType, 'parent');
                    }
                } catch (err) {
                    console.error(`❌ Child oluşturma hatası (${country.code}):`, err);
                }
            });

            await Promise.all(promises);
            console.log('🏁 Senkronizasyon işlemi tamamlandı.');

        } catch (error) {
            console.error('❌ Senkronizasyon ana hatası:', error);
        }
    }

    // Parent'taki değişiklikleri Child'lara aktarır
    async propagateUpdatesToChildren(parentId, parentData) {
        console.log('🔄 Child Güncelleme (Propagation) başlatılıyor...');
        try {
            const db = getFirestore();
            
            const q = query(
                collection(db, 'ipRecords'),
                where('parentId', '==', parentId),
                where('transactionHierarchy', '==', 'child')
            );
            
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                console.log('⚠️ Güncellenecek child kayıt bulunamadı.');
                return;
            }

            const updates = {
                title: parentData.title || parentData.brandText || null,
                brandText: parentData.brandText || null,
                description: parentData.description || null,
                status: parentData.status || null,
                
                applicationDate: parentData.applicationDate || null,
                registrationDate: parentData.registrationDate || null,
                renewalDate: parentData.renewalDate || null,
                
                brandImageUrl: parentData.brandImageUrl || null,
                
                applicants: parentData.applicants,
                applicantIds: parentData.applicantIds || [], // 🔥 YENİ: Alt kayıtlara da senkronize et
                goodsAndServicesByClass: parentData.goodsAndServicesByClass,
                
                updatedAt: new Date().toISOString()
            };

            const irNumber = parentData.internationalRegNumber || parentData.registrationNumber;
            if (parentData.origin === 'WIPO') updates.wipoIR = irNumber || null;
            if (parentData.origin === 'ARIPO') updates.aripoIR = irNumber || null;

            Object.keys(updates).forEach(key => {
                if (updates[key] === undefined) delete updates[key];
            });

            const updatePromises = snapshot.docs.map(doc => updateDoc(doc.ref, updates));
            
            await Promise.all(updatePromises);
            console.log(`✅ ${updatePromises.length} adet child kayıt başarıyla güncellendi.`);

        } catch (error) {
            console.error('❌ Child güncelleme hatası:', error);
        }
    }

    async addTransactionForNewRecord(recordId, ipType, hierarchy = 'parent') {
        const TX_IDS = { trademark: '2', patent: '5', design: '8' };
        const txTypeId = TX_IDS[ipType] || '2';
        
        const description = hierarchy === 'child' ? 'Ülke başvurusu işlemi.' : 'Başvuru işlemi.';

        try {
            await ipRecordsService.addTransactionToRecord(String(recordId), {
                type: String(txTypeId),
                transactionTypeId: String(txTypeId),
                description: description,
                transactionHierarchy: hierarchy 
            });
            console.log(`✅ Transaction eklendi (${hierarchy}): ${recordId}`);
        } catch (error) {
            console.error(`❌ Transaction hatası:`, error);
        }
    }

    // ============================================================
    // 5. YARDIMCI FONKSİYONLAR
    // ============================================================

    populateOriginDropdown(dropdownId, selectedValue = 'TÜRKPATENT', ipType) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        
        let filteredOrigins = ORIGIN_TYPES;
        if (ipType === 'suit') {
            filteredOrigins = ORIGIN_TYPES.filter(o => o.value === 'TÜRKPATENT' || o.value === 'Yurtdışı Ulusal')
                .map(o => o.value === 'TÜRKPATENT' ? { value: 'TURKEY_NATIONAL', text: 'TÜRKİYE' } : { value: 'FOREIGN_NATIONAL', text: 'Yurtdışı' });
            selectedValue = selectedValue === 'TÜRKPATENT' ? 'TURKEY_NATIONAL' : selectedValue;
        }

        dropdown.innerHTML = '<option value="">Seçiniz...</option>';
        filteredOrigins.forEach(origin => {
            const option = document.createElement('option');
            option.value = origin.value;
            option.textContent = origin.text;
            if (origin.value === selectedValue) option.selected = true;
            dropdown.appendChild(option);
        });
        dropdown.dispatchEvent(new Event('change'));
    }

    async getCountries() {
        try {
            const db = getFirestore();
            const docSnap = await getDoc(doc(db, 'common', 'countries'));
            return docSnap.exists() ? (docSnap.data().list || []) : [];
        } catch (error) {
            console.error("Ülke listesi hatası:", error);
            return [];
        }
    }

    populateCountriesDropdown(dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;
        dropdown.innerHTML = this.allCountries.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
    }

    async getTaskTypes() {
        try {
            const r = await transactionTypeService.getTransactionTypes();
            const list = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []); 
            this.allTransactionTypes = list;
            return list;
        } catch (error) { return []; }
    }

    populateSpecificTaskTypeDropdown(mainType) {
        const dropdown = document.getElementById('specificTaskType');
        if (!dropdown || !this.allTransactionTypes) return;
        dropdown.innerHTML = '<option value="">Seçiniz...</option>';
        const filtered = this.allTransactionTypes.filter(t => t.ipType === mainType && t.hierarchy === 'parent')
            .sort((a, b) => (a.order || 999) - (b.order || 999));
        filtered.forEach(t => dropdown.innerHTML += `<option value="${t.id}">${t.alias || t.name}</option>`);
    }

    // ---------------- PERSON SEARCH & MODAL ----------------
    searchPersons(searchTerm, type) {
        const resultsContainer = document.getElementById(`${type}SearchResults`);
        if (!resultsContainer || searchTerm.length < 2) { if(resultsContainer) resultsContainer.style.display = 'none'; return; }

        const filtered = this.allPersons.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        if (filtered.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results-message">Sonuç bulunamadı</div>';
        } else {
            resultsContainer.innerHTML = filtered.map(p => 
                `<div class="search-result-item" data-person-id="${p.id}"><strong>${p.name}</strong></div>`
            ).join('');
            
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const person = this.allPersons.find(p => p.id === item.dataset.personId);
                    if (person) {
                        if(type === 'applicant') this.addSelectedPerson(person, type);
                        else if(type === 'suitClient') this.selectSuitClient(person);
                        
                        document.getElementById(`${type}Search`).value = '';
                        resultsContainer.style.display = 'none';
                    }
                });
            });
        }
        resultsContainer.style.display = 'block';
    }

    selectSuitClient(person) {
        this.suitClientPerson = person;
        const displayDiv = document.getElementById('selectedSuitClient');
        const searchInput = document.getElementById('suitClientSearch'); // Wrapper yerine input

        if (person) {
            document.getElementById('selectedSuitClientName').textContent = person.name;
            
            // Görünür yap (d-none sınıfını kaldır, d-flex ekle)
            if (displayDiv) {
                displayDiv.classList.remove('d-none');
                displayDiv.classList.add('d-flex');
                displayDiv.style.display = 'flex'; // Garanti olsun
            }
            
            // Arama kutusunu gizle
            if (searchInput) {
                // Inputun bulunduğu wrapper'ı gizle ki "+" butonu kalsın veya komple satırı gizle
                // Biz sadece inputu gizliyoruz
                searchInput.style.display = 'none';
            }
        }
        this.updateSaveButtonState();
    }

    addSelectedPerson(person, type) {
        if (type === 'applicant') {
            if (this.selectedApplicants.find(p => p.id === person.id)) return alert('Zaten seçili');
            this.selectedApplicants.push(person);
            this.renderSelectedApplicants();
        }
        this.updateSaveButtonState();
    }

    renderSelectedApplicants() {
        const container = document.getElementById('selectedApplicantsContainer');
        if (!container) return;
        if (this.selectedApplicants.length === 0) {
            container.innerHTML = '<div class="empty-state text-center py-4"><p class="text-muted">Seçim yok</p></div>';
        } else {
            container.innerHTML = this.selectedApplicants.map(p => 
                `<div class="selected-item"><span>${p.name}</span><button type="button" class="remove-selected-item-btn" data-person-id="${p.id}">&times;</button></div>`
            ).join('');
            container.querySelectorAll('.remove-selected-item-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.selectedApplicants = this.selectedApplicants.filter(p => p.id !== btn.dataset.personId);
                    this.renderSelectedApplicants();
                    this.updateSaveButtonState();
                });
            });
        }
    }

    setupModalCloseButtons() {
        const cancelBtn = document.getElementById('cancelPersonBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideAddPersonModal());
        const saveBtn = document.getElementById('savePersonBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveNewPerson());
    }

    hideAddPersonModal() {
        document.getElementById('personModal')?.classList.remove('show');
        document.body.classList.remove('modal-open');
    }

    // ---------------- MULTI COUNTRY SELECT ----------------
    setupMultiCountrySelect() {
        const input = document.getElementById('countriesMultiSelectInput');
        const resultsContainer = document.getElementById('countriesMultiSelectResults');
        const selectedList = document.getElementById('selectedCountriesList');
        
        this.renderSelectedCountries();
        
        input.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            if (query.length < 2) { resultsContainer.style.display = 'none'; return; }
            const filtered = this.allCountries.filter(c => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query));
            resultsContainer.innerHTML = filtered.map(c => `<div class="search-result-item" data-code="${c.code}" data-name="${c.name}">${c.name} (${c.code})</div>`).join('');
            resultsContainer.style.display = filtered.length ? 'block' : 'none';
        };

        resultsContainer.onclick = (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) {
                const code = item.dataset.code;
                if (!this.selectedCountries.find(c => c.code === code)) {
                    this.selectedCountries.push({ code, name: item.dataset.name });
                    this.renderSelectedCountries();
                    this.updateSaveButtonState();
                }
                input.value = ''; resultsContainer.style.display = 'none';
            }
        };

        selectedList.onclick = (e) => {
            const btn = e.target.closest('.remove-selected-item-btn');
            if (btn) {
                this.selectedCountries = this.selectedCountries.filter(c => c.code !== btn.dataset.code);
                this.renderSelectedCountries();
                this.updateSaveButtonState();
            }
        };
    }

    renderSelectedCountries() {
        const list = document.getElementById('selectedCountriesList');
        const badge = document.getElementById('selectedCountriesCount');
        if (!list || !badge) return;

        badge.textContent = this.selectedCountries.length;
        if (this.selectedCountries.length === 0) list.innerHTML = '<div class="empty-state"><p>Henüz ülke eklenmedi.</p></div>';
        else list.innerHTML = this.selectedCountries.map(c => 
            `<div class="selected-item d-flex justify-content-between"><span>${c.name} (${c.code})</span><button class="remove-selected-item-btn" data-code="${c.code}">&times;</button></div>`
        ).join('');
    }

    // ---------------- UPLOAD & FILES ----------------
    async uploadFileToStorage(file, path) {
        if (!file || !path) return null;
        try {
            const res = await uploadBytes(ref(storage, path), file);
            return await getDownloadURL(res.ref);
        } catch (error) { console.error("Upload hatası:", error); return null; }
    }

    setupBrandExampleUploader() {
        const area = document.getElementById('brandExampleUploadArea');
        const input = document.getElementById('brandExample');
        if (!area || !input) return;

        area.onclick = () => input.click();
        input.onchange = (e) => { if (e.target.files.length) this.handleBrandExampleFile(e.target.files[0]); };
        
        const removeBtn = document.getElementById('removeBrandExampleBtn');
        if (removeBtn) {
            removeBtn.onclick = () => {
                this.uploadedBrandImage = null;
                document.getElementById('brandExamplePreviewContainer').style.display = 'none';
                document.getElementById('brandExamplePreview').src = '';
                input.value = '';
                this.updateSaveButtonState();
            };
        }
    }

    handleBrandExampleFile(file) {
        if (!file.type.startsWith('image/')) return alert('Sadece resim dosyası seçiniz.');
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('brandExamplePreview').src = e.target.result;
            document.getElementById('brandExamplePreviewContainer').style.display = 'block';
            this.uploadedBrandImage = file;
            this.updateSaveButtonState();
        };
        reader.readAsDataURL(file);
    }

    // ---------------- DİĞER (NICE, PRIORITY, SUIT) ----------------
    handleTabChange(targetTab) {
        if (targetTab === '#goods-services' && !this.isNiceInitialized) {
            this.isNiceInitialized = true;
            initializeNiceClassification().then(() => {
                this.setupClearClassesButton();
                if (this.storedNiceClasses) setSelectedNiceClasses(this.storedNiceClasses);
            });
        }
    }

    setupClearClassesButton() {
        const btn = document.getElementById('clearAllClassesBtn');
        if (btn) btn.onclick = () => {
            if (confirm('Emin misiniz?')) window.clearAllSelectedClasses && window.clearAllSelectedClasses();
        };
    }

    renderSuitClientSection() {
        const card = document.getElementById('suitSpecificFieldsCard');
        if (!card) return;
        card.insertAdjacentHTML('beforebegin', FormTemplates.getClientSection());
        this.renderSuitSubjectAssetSection();
        
        document.getElementById('addNewPersonBtn')?.addEventListener('click', () => {
            // Yeni merkezi modalı aç
            this.personModal.open(null, (newPerson) => {
                this.allPersons.push(newPerson);
                this.selectSuitClient(newPerson);
            });
        });
        
        this.setupSuitPersonSearchSelectors();
    }
    
    setupSuitPersonSearchSelectors() {
        const input = document.getElementById('suitClientSearch');
        const results = document.getElementById('suitClientSearchResults');
        const clearBtn = document.getElementById('clearSuitClient');
        
        if (input) input.oninput = (e) => this.searchPersons(e.target.value, 'suitClient');
        if (clearBtn) clearBtn.onclick = () => {
            this.suitClientPerson = null;
            document.getElementById('selectedSuitClient').style.display = 'none';
            input.style.display = 'block'; input.value = '';
            this.updateSaveButtonState();
        };
    }

    renderSuitSubjectAssetSection() {
        const card = document.getElementById('suitSpecificFieldsCard');
        if (card) {
            card.insertAdjacentHTML('beforebegin', FormTemplates.getSubjectAssetSection());
            this.setupSuitSubjectAssetSearchSelectors();
        }
    }

    setupSuitSubjectAssetSearchSelectors() {
        const input = document.getElementById('subjectAssetSearch');
        const results = document.getElementById('subjectAssetSearchResults');
        const clearBtn = document.getElementById('clearSubjectAsset');
        const displayDiv = document.getElementById('selectedSubjectAsset'); // Seçilen alan divi
        let debounceTimer;

        if (input) {
            input.addEventListener('input', (e) => {
                const term = e.target.value.trim().toLowerCase();
                clearTimeout(debounceTimer);

                if (term.length < 2) {
                    if (results) results.style.display = 'none';
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    try {
                        const db = getFirestore();
                        
                        // 1. SORGU: Portföy (Marka/Patent)
                        const ipRef = collection(db, 'ipRecords');
                        const qIp = query(ipRef, where('portfoyStatus', '==', 'active'));

                        // 2. SORGU: Davalar (Suits)
                        const suitsRef = collection(db, 'suits');
                        const qSuits = query(suitsRef, where('suitStatus', '!=', 'closed'));

                        const [ipSnapshot, suitSnapshot] = await Promise.all([
                            getDocs(qIp),
                            getDocs(qSuits)
                        ]);

                        let matches = [];

                        // A) Marka/Patent Sonuçları
                        ipSnapshot.forEach(doc => {
                            const d = doc.data();
                            const title = (d.title || d.markName || '').toLowerCase();
                            const appNo = (d.applicationNumber || '').toLowerCase();
                            
                            if (title.includes(term) || appNo.includes(term)) {
                                matches.push({ 
                                    id: doc.id, 
                                    ...d, 
                                    _source: 'ipRecord', 
                                    displayType: 'Marka/Patent',
                                    displayTitle: d.title || d.markName,
                                    displayNumber: d.applicationNumber
                                });
                            }
                        });

                        // B) Dava Sonuçları (DETAYLANDIRILDI)
                        suitSnapshot.forEach(doc => {
                            const d = doc.data();
                            const title = (d.title || '').toLowerCase();
                            const court = (d.suitDetails?.court || '').toLowerCase();
                            const caseNo = (d.suitDetails?.caseNo || '').toLowerCase();
                            const partiesStr = (d.opposingParty || '').toLowerCase();

                            // Arama: Başlık, Mahkeme, Dosya No veya Karşı Taraf içinde
                            if (title.includes(term) || court.includes(term) || caseNo.includes(term) || partiesStr.includes(term)) {
                                
                                // Müvekkil adını bul (client objesi veya displayClient stringi)
                                const clientName = d.client?.name || d.displayClient || 'Belirsiz';
                                const opponentName = d.opposingParty || '-';

                                matches.push({ 
                                    id: doc.id, 
                                    ...d,
                                    title: d.suitDetails?.court || d.title, 
                                    applicationNumber: d.suitDetails?.caseNo || '-', 
                                    _source: 'suit',
                                    displayType: 'Dava Dosyası',
                                    displayTitle: d.suitDetails?.court || d.title,
                                    displayNumber: d.suitDetails?.caseNo,
                                    // Ekstra Bilgiler
                                    extraInfo: `<div class="d-flex justify-content-between mt-1" style="font-size:0.85em; color:#666;">
                                        <span><i class="fas fa-user mr-1"></i>${clientName}</span>
                                        <span><i class="fas fa-user-shield mr-1"></i>${opponentName}</span>
                                    </div>`
                                });
                            }
                        });

                        // Sonuçları Göster
                        if (results) {
                            if (matches.length === 0) {
                                results.innerHTML = '<div class="p-2 text-muted">Sonuç bulunamadı.</div>';
                            } else {
                                results.innerHTML = matches.slice(0, 10).map(rec => {
                                    const badgeClass = rec._source === 'suit' ? 'badge-primary' : 'badge-success';
                                    const icon = rec._source === 'suit' ? '<i class="fas fa-gavel mr-1"></i>' : '<i class="fas fa-certificate mr-1"></i>';
                                    
                                    return `
                                    <div class="search-result-item p-2 border-bottom" style="cursor:pointer;" data-id="${rec.id}" data-source="${rec._source}">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <span class="font-weight-bold text-dark">${rec.displayTitle || '-'}</span>
                                            <span class="badge ${badgeClass}" style="font-size:10px;">${icon}${rec.displayType}</span>
                                        </div>
                                        <div class="small text-muted">
                                            ${rec.displayNumber || 'No Yok'} 
                                            ${rec._source === 'suit' ? '' : `(${rec.type || 'Bilinmiyor'})`}
                                        </div>
                                        ${rec.extraInfo || ''}
                                    </div>
                                    `;
                                }).join('');

                                // Tıklama Olayı
                                results.querySelectorAll('.search-result-item').forEach(item => {
                                    item.addEventListener('click', () => {
                                        const selectedId = item.dataset.id;
                                        const selectedRecord = matches.find(m => m.id === selectedId);
                                        this.selectSuitSubjectAsset(selectedRecord);
                                        results.style.display = 'none';
                                        input.value = '';
                                    });
                                });
                            }
                            results.style.display = 'block';
                        }

                    } catch (err) {
                        console.error('Arama hatası:', err);
                    }
                }, 300);
            });
        }

        if (clearBtn) {
            clearBtn.onclick = () => {
                this.suitSubjectAsset = null;
                // Seçilen alanını gizle, inputu göster
                if(displayDiv) {
                    displayDiv.classList.remove('d-flex');
                    displayDiv.classList.add('d-none');
                }
                
                if(input) {
                    input.style.display = 'block'; 
                    input.value = '';
                    input.focus();
                }
                
                this.updateSaveButtonState();
            };
        }
    }

    // Seçilen Varlığı UI'a Yansıtma Yardımcısı
    selectSuitSubjectAsset(asset) {
        this.suitSubjectAsset = asset;
        const displayDiv = document.getElementById('selectedSubjectAsset');
        const input = document.getElementById('subjectAssetSearch');

        if (asset) {
            document.getElementById('selectedSubjectAssetName').textContent = asset.displayTitle || asset.title || asset.markName;
            document.getElementById('selectedSubjectAssetType').textContent = asset.displayType || asset.type;
            document.getElementById('selectedSubjectAssetNumber').textContent = asset.displayNumber || asset.applicationNumber || '-';

            // Görünür yap
            if (displayDiv) {
                displayDiv.classList.remove('d-none');
                displayDiv.classList.add('d-flex');
                displayDiv.style.display = 'flex'; // Garanti olsun
            }
            
            // Inputu gizle
            if (input) input.style.display = 'none';
        }

        this.updateSaveButtonState();
    }

    addPriority() {
        const type = document.getElementById('priorityType')?.value;
        const date = document.getElementById('priorityDate')?.value;
        const country = document.getElementById('priorityCountry')?.value;
        const num = document.getElementById('priorityNumber')?.value;

        if (!date || !country || !num) return alert('Eksik bilgi.');
        this.priorities.push({ id: Date.now().toString(), type, date, country, number: num });
        this.renderPriorities();
        
        ['priorityDate', 'priorityCountry', 'priorityNumber'].forEach(id => document.getElementById(id).value = '');
    }

    removePriority(id) {
        this.priorities = this.priorities.filter(p => p.id !== id);
        this.renderPriorities();
    }

    renderPriorities() {
        const container = document.getElementById('addedPrioritiesList');
        if (!container) return;
        container.innerHTML = this.priorities.length ? this.priorities.map(p => `
            <div class="selected-item p-2 mb-2 border rounded d-flex justify-content-between">
               <span>${p.type} | ${p.date} | ${p.country} | ${p.number}</span>
               <button class="btn btn-sm btn-danger remove-priority-btn" data-id="${p.id}"><i class="fas fa-trash-alt"></i></button>
            </div>`).join('') : '<div class="empty-state text-center py-4">Rüçhan yok</div>';
    }

    updateSaveButtonState() {
        const ipType = this.ipTypeSelect?.value;
        let isComplete = false;
        
        if (ipType === 'trademark') {
            const txt = document.getElementById('brandExampleText')?.value;
            const hasApp = this.selectedApplicants.length > 0;
            const origin = document.getElementById('originSelect')?.value;
            const isInt = (origin === 'WIPO' || origin === 'ARIPO');
            isComplete = txt && hasApp && (!isInt || this.selectedCountries.length > 0);
        } else if (ipType === 'suit') {
            isComplete = !!this.suitClientPerson && !!this.suitSpecificTaskType;
        } else {
            isComplete = !!document.getElementById(`${ipType}Title`)?.value;
        }
        
        if (this.saveBtn) this.saveBtn.disabled = !isComplete;
    }

    // ============================================================
    // 6. POPULATE FIELDS (EDIT MODE)
    // ============================================================
    populateFormFields(recordData) {
        if (!recordData) return;
        console.log('🔄 Edit Modu: Veriler dolduruluyor...');

        // 🔥 Hiyerarşiyi Kaydet (Düzeltmenin kalbi burası)
        this.currentTransactionHierarchy = recordData.transactionHierarchy || 'parent';

        const ipType = recordData.type || recordData.ipType || 'trademark';
        this.ipTypeSelect.value = ipType;
        this.handleIPTypeChange(ipType);
        
        if (this.recordOwnerTypeSelect) this.recordOwnerTypeSelect.value = recordData.recordOwnerType || 'self';

        setTimeout(() => {
                const titleEl = document.getElementById('formTitle');
                if(titleEl) titleEl.textContent = 'Kayıt Düzenle';

                const setVal = (id, val) => { 
                    const el = document.getElementById(id); 
                    if(el) {
                        el.value = val || ''; 
                        
                        // 🔥 TARİH (DATEPICKER) KÖKTEN ÇÖZÜMÜ
                        // Eğer bu inputa bir DatePicker (Flatpickr) bağlıysa,
                        // görsel arayüzün de güncellenmesi için özel komut gönder.
                        if (el._flatpickr) {
                            if (val) {
                                el._flatpickr.setDate(val, true); // true parametresi görsel altInput'u günceller
                            } else {
                                el._flatpickr.clear(); // Veri yoksa takvimi de temizle
                            }
                        }
                    } 
                };
                
            setVal('applicationNumber', recordData.applicationNumber);
            setVal('registrationNumber', recordData.registrationNumber || recordData.wipoIR || recordData.aripoIR);
            setVal('applicationDate', recordData.applicationDate);
            setVal('registrationDate', recordData.registrationDate);
            setVal('renewalDate', recordData.renewalDate);
            
            const originSelect = document.getElementById('originSelect');
            if (originSelect && recordData.origin) {
                this.populateOriginDropdown('originSelect', recordData.origin, ipType);
                this.updateRegistrationInputUI(recordData.origin);
                
                // Child Kayıt Kontrolü (Read-Only Ülke)
                if ((recordData.origin === 'WIPO' || recordData.origin === 'ARIPO') && recordData.transactionHierarchy === 'child') {
                    this.selectedCountries = recordData.country 
                        ? [{code: recordData.country, name: recordData.country}] 
                        : [];
                    this.renderSelectedCountries();
                    const container = document.getElementById('multiCountrySelectWrapper');
                    if(container) {
                        container.style.display = 'block';
                        document.getElementById('countriesMultiSelectInput').style.display = 'none';
                        document.getElementById('countrySelectionTitle').textContent = 'Ülke (Değiştirilemez)';
                    }
                } 
                // Parent Kayıt (WIPO)
                else if (['WIPO', 'ARIPO'].includes(recordData.origin)) {
                    this.handleOriginChange(recordData.origin);
                    if (Array.isArray(recordData.countries)) {
                        this.selectedCountries = recordData.countries.map(c => ({code: c, name: c}));
                        this.renderSelectedCountries();
                    }
                }
                // Ulusal
                else if (recordData.origin === 'Yurtdışı Ulusal') {
                    this.handleOriginChange(recordData.origin);
                    setTimeout(() => setVal('countrySelect', recordData.country), 100);
                }
            }

            if (ipType === 'trademark') {
                setVal('brandType', recordData.brandType);
                setVal('brandCategory', recordData.brandCategory);
                setVal('brandExampleText', recordData.title || recordData.brandText);
                setVal('brandDescription', recordData.description);
                setVal('trademarkStatus', recordData.status);
                
                if (recordData.brandImageUrl) {
                    this.uploadedBrandImage = recordData.brandImageUrl;
                    document.getElementById('brandExamplePreview').src = recordData.brandImageUrl;
                    document.getElementById('brandExamplePreviewContainer').style.display = 'block';
                }

                if (recordData.goodsAndServicesByClass && typeof setSelectedNiceClasses === 'function') {
                     const formatted = recordData.goodsAndServicesByClass.map(g => `(${g.classNo}-1) ${g.items ? g.items.join('\n') : ''}`);
                     this.storedNiceClasses = formatted;
                     setSelectedNiceClasses(formatted);
                }
            }
            else {
                setVal(`${ipType}Title`, recordData.title);
                setVal(`${ipType}ApplicationNumber`, recordData.applicationNumber);
                setVal(`${ipType}Description`, recordData.description);
            }

            if (recordData.applicants && recordData.applicants.length > 0) {
                this.selectedApplicants = recordData.applicants.map(applicant => {
                    const personFromList = this.allPersons.find(p => p.id === applicant.id);
                    return {
                        id: applicant.id,
                        name: applicant.name || (personFromList ? personFromList.name : 'İsimsiz Kişi'),
                        email: applicant.email || (personFromList ? personFromList.email : '')
                    };
                });
                this.renderSelectedApplicants();
            }
            if (recordData.priorities) {
                this.priorities = recordData.priorities;
                this.renderPriorities();
            }

            if (this.ipTypeSelect) this.ipTypeSelect.disabled = true;
            if (originSelect) originSelect.disabled = true;

            this.updateSaveButtonState();

        }, 500);
    }
}

export default DataEntryModule;

document.addEventListener('DOMContentLoaded', () => {
  loadSharedLayout({ activeMenuLink: 'data-entry.html' }).catch(console.error);
  let started = false;
  const boot = () => {
    if (started) return; started = true;
    new DataEntryModule().init();
  };

  const current = auth.currentUser;
  if (current) boot();
  onAuthStateChanged(auth, (user) => { if (user) boot(); else window.location.replace('index.html'); });
});