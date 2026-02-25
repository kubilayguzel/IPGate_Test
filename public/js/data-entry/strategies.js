// js/data-entry/strategies.js

import { FormTemplates } from './form-templates.js';
import { getSelectedNiceClasses } from '../nice-classification.js';
import { STATUSES } from '../../utils.js';

// 🔥 Veritabanı ve Storage için Supabase
import { supabase } from '../../supabase-config.js';

const getVal = (id) => document.getElementById(id)?.value?.trim() || null;

const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
};

class BaseStrategy {
    render(container) { container.innerHTML = ''; }
    validate(data) { return null; }
}

export class TrademarkStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getTrademarkForm();
        const stSel = document.getElementById('trademarkStatus');
        if (stSel) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES.trademark
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            if (!isEditMode) stSel.value = '';
        }
    }

    collectData(context) {
        const origin = getVal('originSelect');
        const brandText = getVal('brandExampleText');
        
        let goodsAndServicesByClass = [];
        try {
            const rawNiceClasses = getSelectedNiceClasses();
            if (Array.isArray(rawNiceClasses)) {
                goodsAndServicesByClass = rawNiceClasses.reduce((acc, item) => {
                    const match = item.match(/^\((\d+)(?:-\d+)?\)\s*([\s\S]*)$/);
                    if (match) {
                        const classNo = parseInt(match[1]);
                        const rawText = match[2].trim();
                        let classObj = acc.find(obj => obj.classNo === classNo);
                        if (!classObj) {
                            classObj = { classNo, items: [] };
                            acc.push(classObj);
                        }
                        if (rawText) {
                            const lines = rawText.split(/[\n]/).map(l => l.trim()).filter(Boolean);
                            lines.forEach(line => {
                                const cleanLine = line.replace(/^\)+|\)+$/g, '').trim(); 
                                if (cleanLine && !classObj.items.includes(cleanLine)) classObj.items.push(cleanLine);
                            });
                        }
                    }
                    return acc;
                }, []).sort((a, b) => a.classNo - b.classNo);
            }
        } catch (e) { console.warn('Nice classes hatası:', e); }

        const isInternational = (origin === 'WIPO' || origin === 'ARIPO');
        const bulletinNo = getVal('bulletinNo');
        const bulletinDate = getVal('bulletinDate');
        const bulletins = (bulletinNo || bulletinDate) ? [{ bulletinNo, bulletinDate: formatDate(bulletinDate) }] : [];

        return {
            ipType: 'trademark', type: 'trademark', portfoyStatus: 'active',
            recordOwnerType: getVal('recordOwnerType') || 'self',
            title: brandText, brandText: brandText,
            applicationDate: formatDate(getVal('applicationDate')),
            registrationDate: formatDate(getVal('registrationDate')),
            renewalDate: formatDate(getVal('renewalDate')),
            applicationNumber: getVal('applicationNumber'),
            registrationNumber: !isInternational ? getVal('registrationNumber') : null,
            internationalRegNumber: isInternational ? getVal('registrationNumber') : null, 
            description: getVal('brandDescription'),
            status: getVal('trademarkStatus'),
            brandType: getVal('brandType'),
            brandCategory: getVal('brandCategory'),
            bulletins: bulletins,
            origin: origin,
            applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [],
            goodsAndServicesByClass: goodsAndServicesByClass,
            brandImageUrl: context.uploadedBrandImage
        };
    }

    validate(data, context) {
        if (!data.brandText) return 'Marka adı (Metni) zorunludur.';
        if (!data.applicants || data.applicants.length === 0) return 'En az bir başvuru sahibi seçmelisiniz.';
        if ((data.origin === 'WIPO' || data.origin === 'ARIPO')) {
            if (!data.internationalRegNumber) return `${data.origin} için IR Numarası (Tescil No alanında) zorunludur.`;
            if (!context.selectedCountries || context.selectedCountries.length === 0) return 'En az bir ülke seçmelisiniz.';
        }
        if (!data.goodsAndServicesByClass || data.goodsAndServicesByClass.length === 0) return 'En az bir mal/hizmet sınıfı seçmelisiniz.';
        return null;
    }
}

export class PatentStrategy extends BaseStrategy {
    render(container) { container.innerHTML = FormTemplates.getPatentForm(); }
    collectData(context) {
        const title = getVal('patentTitle');
        return {
            ipType: 'patent', type: 'patent', portfoyStatus: 'active', title: title,
            applicationNumber: getVal('patentApplicationNumber'), description: getVal('patentDescription'), status: 'başvuru',
            origin: getVal('originSelect'), applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [], details: { patentInfo: { patentTitle: title, description: getVal('patentDescription') } }
        };
    }
    validate(data) { if (!data.title) return 'Patent başlığı zorunludur.'; return null; }
}

export class DesignStrategy extends BaseStrategy {
    render(container) { container.innerHTML = FormTemplates.getDesignForm(); }
    collectData(context) {
        const title = getVal('designTitle');
        return {
            ipType: 'design', type: 'design', portfoyStatus: 'active', title: title,
            applicationNumber: getVal('designApplicationNumber'), description: getVal('designDescription'), status: 'başvuru',
            origin: getVal('originSelect'), applicants: context.selectedApplicants.map(p => ({ id: p.id, email: p.email || null })),
            priorities: context.priorities || [], details: { designInfo: { designTitle: title, description: getVal('designDescription') } }
        };
    }
    validate(data) { if (!data.title) return 'Tasarım başlığı zorunludur.'; return null; }
}

export class SuitStrategy extends BaseStrategy {
    render(container) { container.innerHTML = '<div id="suitSpecificFieldsContainer"></div>'; }
    
    renderSpecificFields(taskName) { 
        return FormTemplates.getClientSection() + FormTemplates.getSubjectAssetSection() + FormTemplates.getSuitFields(taskName); 
    }

    validate(data) {
        if (!data.client) return 'Müvekkil seçimi zorunludur.';
        if (!data.clientRole) return 'Müvekkil rolü seçimi zorunludur.';
        if (!data.transactionTypeId) return 'İş Tipi (Dava Türü) seçilmelidir.';
        if (!data.suitDetails.court && !document.getElementById('customCourtInput')?.value) return 'Mahkeme seçimi zorunludur.';
        if (!data.suitDetails.caseNo) return 'Esas No zorunludur.';
        if (!data.suitDetails.openingDate) return 'Dava Tarihi zorunludur.';

        const PARENT_SUIT_IDS = ['49', '54', '55', '56', '57', '58']; 
        if (!PARENT_SUIT_IDS.includes(String(data.transactionTypeId))) {
            return `HATA: Manuel girişten sadece ana dava dosyası oluşturulabilir. Ara işlemler için İş Yönetimi'ni kullanın.`;
        }
        return null;
    }

    collectData(context) {
        const specificTaskType = context.suitSpecificTaskType;
        const clientPerson = context.suitClientPerson;
        const clientRole = getVal('clientRole');
        
        let finalCourt = getVal('suitCourt');
        if (finalCourt === 'other' || finalCourt === 'Diğer (Manuel Giriş)') finalCourt = document.getElementById('customCourtInput')?.value?.trim();

        let simplifiedAsset = null;
        if (context.suitSubjectAsset) {
            simplifiedAsset = { id: context.suitSubjectAsset.id, type: context.suitSubjectAsset._source === 'suit' ? 'suit' : 'ipRecord', title: context.suitSubjectAsset.title || context.suitSubjectAsset.markName || context.suitSubjectAsset.displayTitle };
        }

        const caseNo = getVal('suitCaseNo');
        let suitTitle = simplifiedAsset?.title || caseNo || specificTaskType?.alias || specificTaskType?.name || 'Yeni Dava';

        return {
            ipType: 'suit', type: 'suit', portfoyStatus: 'active', title: suitTitle,
            origin: getVal('originSelect') || 'TURKEY_NATIONAL', country: getVal('countrySelect'),
            client: clientPerson ? { id: clientPerson.id, name: clientPerson.name, role: clientRole } : null,
            clientRole: clientRole,
            transactionTypeId: specificTaskType?.id || null,
            suitType: specificTaskType?.alias || specificTaskType?.name || 'Dava İşlemi',
            transactionTypeName: specificTaskType?.alias || specificTaskType?.name || 'Dava İşlemi',
            suitDetails: {
                court: finalCourt, description: getVal('suitDescription'), opposingParty: getVal('opposingParty'),
                opposingCounsel: getVal('opposingCounsel'), caseNo: caseNo, openingDate: formatDate(getVal('suitOpeningDate')), suitStatus: getVal('suitStatusSelect') || 'filed'
            },
            subjectAsset: simplifiedAsset, createdAt: new Date().toISOString()
        };
    }

    async save(data) {
        try {
            console.log('💾 Dava manuel kaydı başlatılıyor (Supabase SQL & Storage)...', data);

            // 1. DOKÜMAN YÜKLEME (SUPABASE STORAGE)
            const fileInput = document.getElementById('suitDocument');
            let uploadedDocs = [];

            if (fileInput && fileInput.files.length > 0) {
                console.log(`📤 ${fileInput.files.length} belge Supabase Storage'a yükleniyor...`);
                
                for (const file of fileInput.files) {
                    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const storagePath = `${Date.now()}_${cleanFileName}`;
                    
                    try {
                        const { error } = await supabase.storage.from('suit_documents').upload(storagePath, file);
                        if (error) throw error;
                        
                        const { data: urlData } = supabase.storage.from('suit_documents').getPublicUrl(storagePath);
                        
                        uploadedDocs.push({
                            name: file.name,
                            url: urlData.publicUrl,
                            type: file.type || 'document',
                            uploadedAt: new Date().toISOString(),
                            uploadedBy: 'manual_entry'
                        });
                    } catch (uplErr) {
                        console.error(`❌ Dosya yükleme hatası (${file.name}):`, uplErr);
                    }
                }
            }
            
            data.documents = uploadedDocs;
            const txName = data.transactionTypeName;
            delete data.transactionTypeName; 

            // 2. SUITS KOLEKSİYONUNA KAYIT (SUPABASE SQL)
            const suitRow = {
                file_no: data.suitDetails?.caseNo,
                court_name: data.suitDetails?.court,
                plaintiff: data.clientRole === 'davaci' ? data.client?.name : data.suitDetails?.opposingParty,
                defendant: data.clientRole === 'davali' ? data.client?.name : data.suitDetails?.opposingParty,
                subject: data.title,
                status: data.suitDetails?.suitStatus,
                details: data, 
                created_at: new Date().toISOString()
            };

            const { data: newSuit, error: suitError } = await supabase.from('suits').insert(suitRow).select('id').single();
            if (suitError) throw new Error("Dava kaydedilirken hata oluştu: " + suitError.message);
            const newSuitId = newSuit.id;

            // 3. İLK TRANSACTION (SUPABASE SQL)
            // 🔥 DÜZELTME: transactions tablosunda details sütunu olmadığı için, veriler doğru sütunlara (task_id vb.) aktarıldı
            const initialTransaction = {
                ip_record_id: newSuitId, 
                transaction_type_id: data.transactionTypeId,
                description: "Dava Açıldı",
                transaction_hierarchy: 'parent',
                task_id: 'manual_entry', 
                created_at: data.suitDetails.openingDate || new Date().toISOString()
            };

            await supabase.from('transactions').insert(initialTransaction);
            console.log('✅ Dava ve Transaction başarıyla oluşturuldu.');

            return newSuitId;

        } catch (error) {
            console.error('Dava Kayıt Hatası:', error);
            throw error;
        }
    }
}