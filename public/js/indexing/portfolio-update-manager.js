// public/js/indexing/portfolio-update-manager.js

import { supabase, ipRecordsService } from '../../supabase-config.js';
import { showNotification, STATUSES } from '../../utils.js';
import { getSelectedNiceClasses, setSelectedNiceClasses } from '../nice-classification.js';

export class PortfolioUpdateManager {
    constructor() {
        this.state = {
            selectedRecordId: null,
            recordData: null,
            currentTransactions: [],
            niceClasses: [],
            goodsAndServicesMap: {},
            bulletins: []
        };

        this.elements = this.cacheElements();
        this.init();
        this._lastAutofillKey = null;
    }

    cacheElements() {
        const $ = (id) => document.getElementById(id);
        return {
            searchInput: $('recordSearchInput'),
            searchResults: $('searchResultsContainer'),
            selectedDisplay: $('selectedRecordDisplay'),
            childTransactionType: $('detectedType') || $('childTransactionType'),
            parentTransactionSelect: $('parentTransactionSelect'),
            detailsContainer: $('record-details-wrapper'),
            registryEditorSection: $('registry-editor-section'),
            regNoInput: $('registry-registration-no'),
            regDateInput: $('registry-registration-date'),
            statusSelect: $('registry-status'),
            saveBtn: $('save-portfolio-btn')
        };
    }

    init() {
        if (!this.elements.detailsContainer) return;
        this.setupEventListeners();
        this.populateStatusDropdown();
    }

    populateStatusDropdown() {
        const select = this.elements.statusSelect;
        if (!select) return;
        select.innerHTML = '<option value="">-- Durum Seçin --</option>';
        const statuses = STATUSES.trademark || [];
        statuses.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.value; opt.textContent = s.text;
            select.appendChild(opt);
        });
    }

    setupEventListeners() {
        // DocumentReviewManager veya BulkUploadManager'dan gelen seçimi dinle
        document.addEventListener('record-selected', (e) => {
            if (e.detail && e.detail.recordId) {
                this.handleExternalRecordSelection(e.detail.recordId);
            }
        });

        if (this.elements.saveBtn) {
            this.elements.saveBtn.addEventListener('click', () => this.handleSave());
        }

        if (this.elements.childTransactionType) {
            this.elements.childTransactionType.addEventListener('change', () => this.checkVisibility());
        }
    }

    async handleExternalRecordSelection(recordId) {
        if (!recordId) return;
        try {
            // 🔥 DÜZELTME: Portföyden kaydın "Sınıflar (Classes)" dahil en detaylı halini çekiyoruz
            const result = await ipRecordsService.getRecordById(recordId);
            if (result.success && result.data) {
                this.selectRecord(result.data);
            }
        } catch (e) {
            console.error('Kayıt detayları alınamadı:', e);
        }
    }

    async selectRecord(record) {
        if (!record) return;

        this.state.selectedRecordId = record.id;
        this.state.recordData = record;

        // Tescil bilgilerini inputlara bas
        const regNoEl = this.elements.regNoInput;
        const regDateEl = this.elements.regDateInput;
        const statusEl = this.elements.statusSelect;

        if (regNoEl) regNoEl.value = record.registrationNumber || record.registrationNo || '';
        if (regDateEl) {
            regDateEl.value = record.registrationDate || '';
            if (regDateEl._flatpickr && record.registrationDate) {
                regDateEl._flatpickr.setDate(record.registrationDate, false);
            }
        }
        if (statusEl) {
            statusEl.value = record.status || record.portfolio_status || '';
        }

        // Sınıfları (Nice Classes) ve Eşyaları Doldur
        let loadedClasses = record.niceClasses || [];
        if (typeof loadedClasses === 'string') {
            try { loadedClasses = JSON.parse(loadedClasses); } catch(e) { loadedClasses = []; }
        }
        
        let loadedGS = record.goodsAndServicesByClass || [];
        if (typeof loadedGS === 'string') {
            try { loadedGS = JSON.parse(loadedGS); } catch(e) { loadedGS = []; }
        }

        this.state.niceClasses = loadedClasses;
        this.state.goodsAndServicesMap = {};
        
        loadedGS.forEach(g => {
            if (g && g.classNo) this.state.goodsAndServicesMap[g.classNo] = g.items || [];
        });

        this.state.bulletins = record.bulletins || [];
        this.checkVisibility();

        // Nice Classification Modal'ına (UI) verileri gönder
        setTimeout(() => {
            if (typeof setSelectedNiceClasses === 'function') {
                const formatted = loadedClasses.map(c => {
                    const items = this.state.goodsAndServicesMap[c] || [];
                    const itemsStr = items.join('\n');
                    return `(${c}) ${itemsStr}`;
                });
                setSelectedNiceClasses(formatted);
            }
        }, 300);
    }

    checkVisibility() {
        const childVal = this.elements.childTransactionType ? String(this.elements.childTransactionType.value) : '';
        const childSelect = this.elements.childTransactionType;
        const selectedOption = childSelect && childSelect.selectedIndex > -1 ? childSelect.options[childSelect.selectedIndex] : null;
        const childText = selectedOption ? selectedOption.text.toLowerCase() : '';

        let isVisible = false;
        
        // İşlem adı "Tescil Belgesi" içeriyorsa veya tipi 45 ise Tescil formunu göster
        if (childVal === '45' || childText.includes('tescil belgesi')) {
            isVisible = true;
        } else if (childVal === '40') {
            isVisible = true; 
        }

        if (this.elements.registryEditorSection) {
            this.elements.registryEditorSection.style.display = isVisible ? 'block' : 'none';
        }
    }

    async handleSave() {
        if (!this.state.selectedRecordId) {
            showNotification('Lütfen önce bir kayıt seçin.', 'warning');
            return;
        }

        const regNo = this.elements.regNoInput ? this.elements.regNoInput.value.trim() : '';
        const regDate = this.elements.regDateInput ? this.elements.regDateInput.value : '';
        const statusVal = this.elements.statusSelect ? this.elements.statusSelect.value : '';

        let rawNiceClasses = [];
        if (typeof getSelectedNiceClasses === 'function') {
            rawNiceClasses = getSelectedNiceClasses() || [];
        }

        let niceClasses = [];
        let goodsAndServicesByClass = [];

        // Ekranda seçilen/yazılan sınıfları parçala (Regex ile "(35) eşyalar..." ayrıştırılır)
        rawNiceClasses.forEach(item => {
            const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
            if (match) {
                const classNo = parseInt(match[1]);
                const rawText = match[2].trim();
                
                if (!niceClasses.includes(classNo)) niceClasses.push(classNo);
                
                let classObj = goodsAndServicesByClass.find(obj => obj.classNo === classNo);
                if (!classObj) {
                    classObj = { classNo, items: [] };
                    goodsAndServicesByClass.push(classObj);
                }
                
                if (rawText) {
                    const lines = rawText.split(/[\n]/).map(l => l.trim()).filter(Boolean);
                    lines.forEach(line => {
                        const cleanLine = line.replace(/^\)+|\)+$/g, '').trim(); 
                        if (cleanLine && !classObj.items.includes(cleanLine)) {
                            classObj.items.push(cleanLine);
                        }
                    });
                }
            }
        });

        // 🔥 Butonu "Yükleniyor" durumuna getir
        const saveBtn = this.elements.saveBtn;
        let originalContent = '';
        if (saveBtn) {
            originalContent = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Kaydediliyor...';
        }

        try {
            const updates = {
                registrationNumber: regNo || null,
                registrationDate: regDate || null,
                status: statusVal || null,
                niceClasses: niceClasses.sort((a, b) => Number(a) - Number(b)),
                goodsAndServicesByClass: goodsAndServicesByClass.sort((a, b) => a.classNo - b.classNo),
                bulletins: this.state.bulletins || []
            };

            Object.keys(updates).forEach(key => {
                if (updates[key] === undefined) delete updates[key];
            });

            // 🔥 Supabase ipRecordsService ile tek hamlede SQL UPDATE yapıyoruz
            // Eşyalar otomatik olarak ip_record_classes tablosuna dağıtılacaktır.
            const result = await ipRecordsService.updateRecord(this.state.selectedRecordId, updates);
            
            if (!result.success) throw new Error(result.error);
            showNotification('Tescil bilgileri ve eşya listesi başarıyla güncellendi.', 'success');

        } catch (error) {
            console.error('Kaydetme hatası:', error);
            showNotification('Kaydetme sırasında hata oluştu: ' + error.message, 'error');
        } finally {
            // Butonu eski haline döndür
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalContent || '<i class="fas fa-save mr-2"></i>Portföyü Güncelle';
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('recordSearchInput') || document.getElementById('detectedType')) {
        window.portfolioUpdateManager = new PortfolioUpdateManager();
    }
});