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

// 🔥 HATA 3 ÇÖZÜMÜ: Sınıf dışında bağımsız bir UUID üretici fonksiyon oluşturduk
const generateUUID = () => {
    return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);
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
    validate() {
        return {
            title: getVal('trademarkTitle'),
            brandType: getVal('brandType'),
            brandCategory: getVal('brandCategory'),
            brandText: getVal('brandText'),
            nonLatinAlphabet: document.getElementById('nonLatinAlphabet')?.checked || false,
            status: getVal('trademarkStatus'),
            applicationNumber: getVal('trademarkApplicationNumber'),
            applicationDate: formatDate(getVal('trademarkApplicationDate')),
            registrationNumber: getVal('trademarkRegistrationNumber'),
            registrationDate: formatDate(getVal('trademarkRegistrationDate')),
            renewalDate: formatDate(getVal('trademarkRenewalDate')),
            description: getVal('trademarkDescription')
        };
    }
}

export class PatentStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getPatentForm();
        const stSel = document.getElementById('patentStatus');
        if (stSel) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES.patent
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            if (!isEditMode) stSel.value = '';
        }
    }
    validate() {
        return {
            title: getVal('patentTitle'),
            status: getVal('patentStatus'),
            applicationNumber: getVal('patentApplicationNumber'),
            applicationDate: formatDate(getVal('patentApplicationDate')),
            registrationNumber: getVal('patentRegistrationNumber'),
            registrationDate: formatDate(getVal('patentRegistrationDate')),
            description: getVal('patentDescription')
        };
    }
}

export class DesignStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getDesignForm();
        const stSel = document.getElementById('designStatus');
        if (stSel) {
            const emptyOpt = '<option value="">Durum Seçiniz...</option>';
            const statusOptions = STATUSES.design
                .map(s => `<option value="${s.value}">${s.text}</option>`)
                .join('');
            stSel.innerHTML = emptyOpt + statusOptions;
            if (!isEditMode) stSel.value = '';
        }
    }
    validate() {
        return {
            title: getVal('designTitle'),
            status: getVal('designStatus'),
            applicationNumber: getVal('designApplicationNumber'),
            applicationDate: formatDate(getVal('designApplicationDate')),
            registrationNumber: getVal('designRegistrationNumber'),
            registrationDate: formatDate(getVal('designRegistrationDate')),
            description: getVal('designDescription')
        };
    }
}

export class SuitStrategy extends BaseStrategy {
    render(container, isEditMode = false) {
        container.innerHTML = FormTemplates.getSuitForm();
    }
    
    validate() {
        const clientRole = getVal('clientRole');
        const courtName = getVal('courtName');
        const customCourt = getVal('customCourtInput');
        const suitType = getVal('suitType');

        if (!clientRole) return { error: 'Lütfen müvekkil rolünü (Davacı/Davalı) seçiniz.' };
        if (!courtName) return { error: 'Lütfen mahkeme bilgisini giriniz.' };
        if (courtName === 'other' && !customCourt) return { error: 'Lütfen diğer mahkeme adını giriniz.' };
        if (!suitType) return { error: 'Lütfen dava türünü seçiniz.' };

        return {
            title: getVal('suitTitle'),
            description: getVal('suitDescription'),
            clientRole: clientRole,
            transactionTypeId: suitType,
            suitDetails: {
                caseNo: getVal('suitCaseNo'),
                courtName: courtName,
                customCourt: customCourt,
                suitType: suitType,
                opposingParty: getVal('opposingParty'),
                opposingCounsel: getVal('opposingCounsel'),
                openingDate: formatDate(getVal('suitOpeningDate')),
                suitStatus: getVal('suitStatus')
            }
        };
    }

    async save(data) {
        try {
            // 🔥 HATA 1 ÇÖZÜMÜ: 'details: data' silindi, tüm veriler düz kolonlara eşlendi.
            const suitRow = {
                id: generateUUID(),
                file_no: data.suitDetails?.caseNo || null,
                court_name: data.suitDetails?.courtName === 'other' ? data.suitDetails?.customCourt : data.suitDetails?.courtName,
                plaintiff: data.clientRole === 'davaci' ? data.client?.name : data.suitDetails?.opposingParty,
                defendant: data.clientRole === 'davali' ? data.client?.name : data.suitDetails?.opposingParty,
                subject: data.title,
                status: data.suitDetails?.suitStatus || 'continue',
                title: data.title,
                transaction_type_id: data.transactionTypeId,
                suit_type: data.suitDetails?.suitType || 'Dava',
                client_role: data.clientRole || '',
                client_id: data.client?.id || null,
                client_name: data.client?.name || null,
                description: data.description || '',
                opposing_party: data.suitDetails?.opposingParty || '',
                opposing_counsel: data.suitDetails?.opposingCounsel || '',
                opening_date: data.suitDetails?.openingDate ? new Date(data.suitDetails.openingDate).toISOString() : new Date().toISOString(),
                created_at: new Date().toISOString()
            };

            const { data: newSuit, error: suitError } = await supabase.from('suits').insert(suitRow).select('id').single();
            if (suitError) throw new Error("Dava kaydedilirken hata oluştu: " + suitError.message);
            const newSuitId = newSuit.id;

            // 🔥 HATA 2 ÇÖZÜMÜ: task_id null yapılarak Foreign Key patlaması önlendi!
            const initialTransaction = {
                ip_record_id: newSuitId, 
                transaction_type_id: data.transactionTypeId,
                description: "Dava Açıldı",
                transaction_hierarchy: 'parent',
                task_id: null, 
                created_at: data.suitDetails?.openingDate ? new Date(data.suitDetails.openingDate).toISOString() : new Date().toISOString()
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