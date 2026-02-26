// public/js/accrual-management/AccrualDataManager.js

import { 
    authService, taskService, personService, 
    transactionTypeService, supabase, ipRecordsService 
} from '../../supabase-config.js';

const generateUUID = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).substr(2, 16);

export class AccrualDataManager {
    constructor() {
        this.allAccruals = [];
        this.allTasks = {};         
        this.allIpRecords = [];     
        this.ipRecordsMap = {};     
        this.allPersons = [];
        this.allUsers = [];
        this.allTransactionTypes = [];
        this.processedData = [];
    }

    // 🔥 DÜZELTME: Storage Bucket adını gelen yola göre dinamik seçer
    async uploadFileToStorage(file, path) {
        if (!file) return null;
        try {
            const bucketName = path.includes('task_documents') ? 'task_documents' : 'accruals';
            const cleanPath = path.replace('accruals/', ''); // Çift klasörlemeyi önlemek için

            const { error } = await supabase.storage.from(bucketName).upload(cleanPath, file);
            if (error) throw error;
            const { data } = supabase.storage.from(bucketName).getPublicUrl(cleanPath);
            return data.publicUrl;
        } catch (err) {
            console.error("Dosya yükleme hatası:", err);
            return null;
        }
    }

    async fetchAllData() {
        try {
            console.log("📥 Veri çekme işlemi başladı...");

            const accPromise = supabase.from('accruals').select('*').limit(10000).order('created_at', { ascending: false });

            const [accRes, usersRes, typesRes] = await Promise.all([
                accPromise,
                taskService.getAllUsers(),
                transactionTypeService.getTransactionTypes()
            ]);

            // 🔥 DÜZELTME: Sadece details değil, Supabase'in KENDİ NATIVE KOLONLARINI da haritalıyoruz!
            this.allAccruals = accRes.data ? accRes.data.map(row => {
                const d = row.details || {};
                return {
                    ...d,
                    id: String(row.id),
                    taskId: row.task_id || d.taskId,
                    taskTitle: row.task_title || d.taskTitle,
                    type: row.type || d.type,
                    status: row.status || d.status,
                    createdAt: row.created_at ? new Date(row.created_at) : new Date(0),
                    updatedAt: row.updated_at || d.updatedAt,
                    isForeignTransaction: row.is_foreign_transaction ?? d.isForeignTransaction ?? false,
                    tpeInvoiceNo: row.tpe_invoice_no || d.tpeInvoiceNo,
                    evrekaInvoiceNo: row.evreka_invoice_no || d.evrekaInvoiceNo,
                    files: row.files || d.files || [],
                    
                    // Native Finansal Kolonlar
                    officialFee: row.official_fee || d.officialFee || null,
                    serviceFee: row.service_fee || d.serviceFee || null,
                    totalAmount: row.total_amount || d.totalAmount || [],
                    remainingAmount: row.remaining_amount || d.remainingAmount || [],
                    vatRate: row.vat_rate || d.vatRate || 20,
                    applyVatToOfficialFee: row.apply_vat_to_official_fee ?? d.applyVatToOfficialFee ?? false,
                    paidOfficialAmount: row.paid_official_amount || d.paidOfficialAmount || 0,
                    paidServiceAmount: row.paid_service_amount || d.paidServiceAmount || 0,
                    paymentDate: row.payment_date || d.paymentDate || null,
                    
                    // Native Taraf Kolonları
                    tpInvoiceParty: row.tp_invoice_party_id ? { id: row.tp_invoice_party_id, name: row.tp_invoice_party_name } : d.tpInvoiceParty,
                    serviceInvoiceParty: row.service_invoice_party_id ? { id: row.service_invoice_party_id, name: row.service_invoice_party_name } : d.serviceInvoiceParty,
                };
            }) : [];

            this.allUsers = usersRes?.success ? (usersRes.data || []) : [];
            
            this.allTransactionTypes = typesRes?.success ? (typesRes.data || []).map(t => ({
                ...t,
                ipType: t.ip_type || t.details?.ipType || t.ipType,
                isTopLevelSelectable: t.is_top_level_selectable ?? t.details?.isTopLevelSelectable ?? t.isTopLevelSelectable
            })) : [];

            if (!this.allPersons || this.allPersons.length === 0) this.allPersons = []; 

            await this._fetchTasksInBatches();
            await this._fetchIpRecordsInBatches();

            this._buildSearchStrings();
            this.processedData = [...this.allAccruals];
            
            console.log(`✅ Yüklenen: ${this.allAccruals.length} Tahakkuk, ${Object.keys(this.allTasks).length} İş, ${this.allIpRecords.length} Dosya.`);
            return true;

        } catch (error) {
            console.error("❌ Veri yükleme hatası:", error);
            throw error;
        }
    }

    async _fetchTasksInBatches() {
        const rawIds = this.allAccruals.map(a => a.taskId);
        const validIds = [...new Set(rawIds.filter(id => id && id !== 'null' && id !== 'undefined'))];
        this.allTasks = {}; 
        
        if (validIds.length === 0) return;

        const { data, error } = await supabase.from('tasks').select('*').in('id', validIds);
        if (error) throw new Error("Görevler çekilemedi: " + error.message);

        data.forEach(row => {
            const d = row.details || {};
            const epats = row.epats_document || d.epatsDocument || (d.details && d.details.epatsDocument) || null;

            this.allTasks[String(row.id)] = {
                id: String(row.id),
                title: String(row.title || d.title || 'İsimsiz İş'),
                taskType: String(row.task_type || d.taskType || ''),
                relatedIpRecordId: row.ip_record_id ? String(row.ip_record_id) : null,
                assignedTo_uid: row.assigned_to_user_id ? String(row.assigned_to_user_id) : null,
                epatsDocument: epats
            };
        });
    }

    async _fetchIpRecordsInBatches() {
        const rawIds = Object.values(this.allTasks).map(t => t.relatedIpRecordId);
        const validIds = [...new Set(rawIds.filter(id => id && id !== 'null' && id !== 'undefined'))];
        this.allIpRecords = [];
        this.ipRecordsMap = {};

        if (validIds.length === 0) return;

        const [ipRes, suitRes] = await Promise.all([
            supabase.from('ip_records').select('*').in('id', validIds),
            supabase.from('suits').select('*').in('id', validIds)
        ]);

        const mapRecords = (rows, type) => {
            if (!rows) return;
            rows.forEach(row => {
                const d = row.details || {};
                const item = {
                    id: String(row.id),
                    applicationNumber: String(row.application_number || row.file_no || d.applicationNumber || d.caseNo || '-'),
                    markName: String(row.brand_name || row.court_name || d.markName || d.title || d.court || '-')
                };
                this.allIpRecords.push(item);
                this.ipRecordsMap[item.id] = item;
            });
        };

        mapRecords(ipRes.data, 'ip');
        mapRecords(suitRes.data, 'suit');
    }

    _buildSearchStrings() {
        this.allAccruals.forEach(acc => {
            let searchTerms = [
                acc.id,
                acc.status === 'paid' ? 'ödendi' : (acc.status === 'unpaid' ? 'ödenmedi' : 'kısmen'),
                acc.tpInvoiceParty?.name,
                acc.serviceInvoiceParty?.name,
                acc.officialFee?.amount,
                acc.totalAmount
            ];

            const task = this.allTasks[String(acc.taskId)];
            if (task) {
                searchTerms.push(task.title); 
                const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                if(typeObj) searchTerms.push(typeObj.alias || typeObj.name);

                if (task.relatedIpRecordId) {
                    const ipRec = this.ipRecordsMap[task.relatedIpRecordId]; 
                    if(ipRec) searchTerms.push(ipRec.applicationNumber);
                }
            } else {
                searchTerms.push(acc.taskTitle);
            }

            acc.searchString = searchTerms.filter(Boolean).join(' ').toLowerCase();
        });
    }

    filterAndSort(criteria, sort) {
        const { tab, filters } = criteria;
        if (!this.allAccruals || this.allAccruals.length === 0) return [];

        let data = this.allAccruals;

        if (tab === 'foreign') {
            data = data.filter(item => item.isForeignTransaction === true);
        }

        if (filters) {
            if (filters.startDate) {
                const start = new Date(filters.startDate).getTime();
                data = data.filter(item => { const itemDate = item.createdAt ? new Date(item.createdAt).getTime() : 0; return itemDate >= start; });
            }
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999); 
                const endTime = end.getTime();
                data = data.filter(item => { const itemDate = item.createdAt ? new Date(item.createdAt).getTime() : 0; return itemDate <= endTime; });
            }
            if (filters.status && filters.status !== 'all') {
                if (tab === 'foreign') data = data.filter(item => (item.foreignStatus || 'unpaid') === filters.status);
                else data = data.filter(item => item.status === filters.status);
            }
            if (filters.field) {
                const searchVal = filters.field.toLowerCase();
                data = data.filter(item => {
                    const task = this.allTasks[String(item.taskId)];
                    const typeObj = task ? this.allTransactionTypes.find(t => t.id === task.taskType) : null;
                    let itemField = '';
                    if (typeObj && typeObj.ipType) {
                        const ipTypeMap = { 'trademark': 'Marka', 'patent': 'Patent', 'design': 'Tasarım', 'suit': 'Dava' };
                        itemField = ipTypeMap[typeObj.ipType] || typeObj.ipType;
                    }
                    return itemField.toLowerCase().includes(searchVal);
                });
            }
            if (filters.party) {
                const searchVal = filters.party.toLowerCase();
                data = data.filter(item => {
                    const p1 = (item.paymentParty || '').toLowerCase();
                    const p2 = (item.tpInvoiceParty?.name || '').toLowerCase();
                    const p3 = (item.serviceInvoiceParty?.name || '').toLowerCase();
                    return p1.includes(searchVal) || p2.includes(searchVal) || p3.includes(searchVal);
                });
            }
            if (filters.fileNo) {
                const searchVal = filters.fileNo.toLowerCase();
                data = data.filter(item => {
                    const task = this.allTasks[String(item.taskId)];
                    if (task && task.relatedIpRecordId) {
                        const ipRec = this.ipRecordsMap[task.relatedIpRecordId];
                        const appNo = ipRec ? (ipRec.applicationNumber || ipRec.applicationNo || '') : '';
                        return appNo.toLowerCase().includes(searchVal);
                    }
                    return false;
                });
            }
            if (filters.subject) {
                const searchVal = filters.subject.toLowerCase();
                data = data.filter(item => {
                    const task = this.allTasks[String(item.taskId)];
                    if (task && task.relatedIpRecordId) {
                        const ipRec = this.ipRecordsMap[task.relatedIpRecordId];
                        const subject = ipRec ? (ipRec.markName || ipRec.title || ipRec.name || '') : '';
                        return subject.toLowerCase().includes(searchVal);
                    }
                    return false;
                });
            }
            if (filters.task) {
                const searchVal = filters.task.toLowerCase();
                data = data.filter(item => {
                    const task = this.allTasks[String(item.taskId)];
                    if (task) {
                        const typeObj = this.allTransactionTypes.find(t => t.id === task.taskType);
                        const taskName = typeObj ? (typeObj.alias || typeObj.name) : (task.title || '');
                        return taskName.toLowerCase().includes(searchVal);
                    }
                    return (item.taskTitle || '').toLowerCase().includes(searchVal);
                });
            }
        }

        if (sort && sort.column) {
            data.sort((a, b) => {
                let valA = a[sort.column]; let valB = b[sort.column];
                if (sort.column === 'taskTitle') { valA = a.taskTitle || ''; valB = b.taskTitle || ''; } 
                else if (sort.column === 'subject') { valA = String(valA || ''); valB = String(valB || ''); }

                if (valA < valB) return sort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }

    async getFreshTaskDetail(taskId) {
        if (!taskId) return null;
        try {
            const { data, error } = await supabase.from('tasks').select('*').eq('id', String(taskId)).single();
            
            if (data && !error) {
                const d = data.details || {};
                let epats = data.epats_document || d.epatsDocument || (d.details && d.details.epatsDocument) || null;
                
                if (typeof epats === 'string') {
                    try { epats = JSON.parse(epats); } catch(e) {}
                }

                const task = { 
                    ...data, 
                    id: String(data.id),
                    taskType: String(data.task_type || d.taskType || ''),
                    relatedIpRecordId: String(data.ip_record_id || d.relatedIpRecordId || ''),
                    assignedTo_uid: String(data.assigned_to_user_id || d.assignedTo_uid || ''),
                    title: String(data.title || d.title || ''),
                    epatsDocument: epats
                };
                
                this.allTasks[String(taskId)] = task; 
                return task;
            }
            return this.allTasks[String(taskId)] || null;
        } catch (e) { return null; }
    }

    // 🔥 DÜZELTME: Ödemeler alındığında asıl/native sütunları güncelleyen yapı kuruldu
    async _updateAccrualDb(id, updates) {
        const { data: curr } = await supabase.from('accruals').select('details').eq('id', id).maybeSingle();
        const newDetails = { ...(curr?.details || {}), ...updates };
        
        const payload = {
            details: newDetails,
            updated_at: new Date().toISOString()
        };

        // Önemli verileri KESİNLİKLE ana sütunlara (native columns) da yazıyoruz
        if (updates.status) payload.status = updates.status;
        if (updates.foreignStatus) payload.status = updates.foreignStatus; 
        if (updates.paymentDate || updates.foreignPaymentDate) payload.payment_date = updates.paymentDate || updates.foreignPaymentDate;
        
        if (updates.remainingAmount !== undefined) payload.remaining_amount = updates.remainingAmount;
        if (updates.paidOfficialAmount !== undefined) payload.paid_official_amount = updates.paidOfficialAmount;
        if (updates.paidServiceAmount !== undefined) payload.paid_service_amount = updates.paidServiceAmount;
        if (updates.files) payload.files = updates.files;

        const { error } = await supabase.from('accruals').update(payload).eq('id', id);
        if (error) throw error;
    }

    async createFreestyleAccrual(formData, fileToUpload) {
        let newFiles = [];
        if (fileToUpload) {
            const cleanFileName = fileToUpload.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `accruals/foreign_invoices/${Date.now()}_${cleanFileName}`;
            const url = await this.uploadFileToStorage(fileToUpload, path);
            newFiles.push({ name: fileToUpload.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
        }

        const vatMultiplier = 1 + (formData.vatRate / 100);
        const targetOff = formData.applyVatToOfficialFee ? formData.officialFee.amount * vatMultiplier : formData.officialFee.amount;
        const targetSrv = formData.serviceFee.amount * vatMultiplier;

        const remMap = {};
        if (targetOff > 0.01) remMap[formData.officialFee.currency] = (remMap[formData.officialFee.currency] || 0) + targetOff;
        if (targetSrv > 0.01) remMap[formData.serviceFee.currency] = (remMap[formData.serviceFee.currency] || 0) + targetSrv;

        const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({ amount: amt, currency: curr }));

        let newStatus = 'unpaid';
        if (newRemainingAmount.length === 0) newStatus = 'paid';

        const accrualData = {
            ...formData, id: generateUUID(), taskId: null, taskTitle: 'Serbest Tahakkuk',
            status: newStatus, remainingAmount: newRemainingAmount, files: newFiles, createdAt: new Date().toISOString()
        };

        const { error } = await supabase.from('accruals').insert({
            id: accrualData.id, task_id: null, type: accrualData.type || 'Hizmet', 
            status: newStatus, created_at: accrualData.createdAt, 
            files: newFiles, 
            details: accrualData
        });

        if (error) throw error;
        await this.fetchAllData(); 
    }

    async updateAccrual(accrualId, formData, fileToUpload) {
        const currentAccrual = this.allAccruals.find(a => a.id === accrualId);
        if (!currentAccrual) throw new Error("Tahakkuk bulunamadı.");

        let newFiles = [];
        if (fileToUpload) {
            const cleanFileName = fileToUpload.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `accruals/foreign_invoices/${Date.now()}_${cleanFileName}`;
            const url = await this.uploadFileToStorage(fileToUpload, path);
            newFiles.push({ name: fileToUpload.name, url, type: 'foreign_invoice', documentDesignation: 'Yurtdışı Fatura/Debit', uploadedAt: new Date().toISOString() });
        }
        const finalFiles = [...(currentAccrual.files || []), ...newFiles];

        const vatMultiplier = 1 + (formData.vatRate / 100);
        const targetOff = formData.applyVatToOfficialFee ? formData.officialFee.amount * vatMultiplier : formData.officialFee.amount;
        const targetSrv = formData.serviceFee.amount * vatMultiplier;

        const paidOff = currentAccrual.paidOfficialAmount || 0;
        const paidSrv = currentAccrual.paidServiceAmount || 0;

        const remOff = Math.max(0, targetOff - paidOff);
        const remSrv = Math.max(0, targetSrv - paidSrv);

        const remMap = {};
        if (remOff > 0.01) remMap[formData.officialFee.currency] = (remMap[formData.officialFee.currency] || 0) + remOff;
        if (remSrv > 0.01) remMap[formData.serviceFee.currency] = (remMap[formData.serviceFee.currency] || 0) + remSrv;

        const newRemainingAmount = Object.entries(remMap).map(([curr, amt]) => ({ amount: amt, currency: curr }));

        let newStatus = 'unpaid';
        if (newRemainingAmount.length === 0) newStatus = 'paid';
        else if (paidOff > 0 || paidSrv > 0) newStatus = 'partially_paid';

        const updates = { ...formData, remainingAmount: newRemainingAmount, status: newStatus, files: finalFiles };
        await this._updateAccrualDb(accrualId, updates);
        await this.fetchAllData(); 
    }

    async savePayment(selectedIds, paymentData) {
        const { date, receiptFiles, singlePaymentDetails } = paymentData;
        const ids = Array.from(selectedIds);

        let uploadedFileRecords = [];
        if (receiptFiles && receiptFiles.length > 0) {
            const uploadPromises = receiptFiles.map(async (fileObj) => {
                if (!fileObj.file) return fileObj;
                try {
                    const cleanFileName = fileObj.file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const path = `accruals/receipts/${Date.now()}_${cleanFileName}`;
                    const downloadURL = await this.uploadFileToStorage(fileObj.file, path);
                    return { name: fileObj.name, url: downloadURL, type: fileObj.type || 'application/pdf', uploadedAt: new Date().toISOString() };
                } catch (error) { console.error("Dosya yükleme hatası:", error); return null; }
            });
            const results = await Promise.all(uploadPromises);
            uploadedFileRecords = results.filter(f => f !== null);
        }

        const promises = ids.map(async (id) => {
            const acc = this.allAccruals.find(a => a.id === id);
            if (!acc) return;

            let updates = { files: [...(acc.files || []), ...uploadedFileRecords] };

            if (ids.length === 1 && singlePaymentDetails && singlePaymentDetails.isForeignMode) {
                updates.foreignPaymentDate = date;
                const inputOfficial = parseFloat(singlePaymentDetails.manualOfficial) || 0;
                const inputService = parseFloat(singlePaymentDetails.manualService) || 0;
                const totalPaidOut = inputOfficial + inputService;
                const targetDebt = acc.officialFee?.amount || 0;
                const currency = acc.officialFee?.currency || 'EUR';

                updates.foreignPaidOfficialAmount = inputOfficial;
                updates.foreignPaidServiceAmount = inputService;

                const remainingDebt = Math.max(0, targetDebt - totalPaidOut);
                updates.foreignRemainingAmount = [{ amount: remainingDebt, currency: currency }];

                if (remainingDebt <= 0.01) updates.foreignStatus = 'paid';
                else if (totalPaidOut > 0) updates.foreignStatus = 'partially_paid';
                else updates.foreignStatus = 'unpaid';
            } 
            else if (ids.length === 1 && singlePaymentDetails) {
                updates.paymentDate = date;
                const { payFullOfficial, payFullService, manualOfficial, manualService } = singlePaymentDetails;
                const vatMultiplier = 1 + ((acc.vatRate || 0) / 100);

                const offTarget = acc.applyVatToOfficialFee ? (acc.officialFee?.amount || 0) * vatMultiplier : (acc.officialFee?.amount || 0);
                const newPaidOff = payFullOfficial ? offTarget : (parseFloat(manualOfficial) || 0);

                const srvTarget = (acc.serviceFee?.amount || 0) * vatMultiplier;
                const newPaidSrv = payFullService ? srvTarget : (parseFloat(manualService) || 0);

                updates.paidOfficialAmount = newPaidOff;
                updates.paidServiceAmount = newPaidSrv;

                const remOff = Math.max(0, offTarget - newPaidOff);
                const remSrv = Math.max(0, srvTarget - newPaidSrv);

                const remMap = {};
                if (remOff > 0.01) remMap[acc.officialFee?.currency || 'TRY'] = (remMap[acc.officialFee?.currency] || 0) + remOff;
                if (remSrv > 0.01) remMap[acc.serviceFee?.currency || 'TRY'] = (remMap[acc.serviceFee?.currency] || 0) + remSrv;
                updates.remainingAmount = Object.entries(remMap).map(([c, a]) => ({ amount: a, currency: c }));

                if (updates.remainingAmount.length === 0) updates.status = 'paid';
                else if (newPaidOff > 0 || newPaidSrv > 0) updates.status = 'partially_paid';
                else updates.status = 'unpaid';
            }
            else {
                updates.status = 'paid';
                updates.remainingAmount = [];
                const vatMultiplier = 1 + ((acc.vatRate || 0) / 100);
                updates.paidOfficialAmount = acc.applyVatToOfficialFee ? (acc.officialFee?.amount || 0) * vatMultiplier : (acc.officialFee?.amount || 0);
                updates.paidServiceAmount = (acc.serviceFee?.amount || 0) * vatMultiplier;
                updates.paymentDate = date;
            }
            return this._updateAccrualDb(id, updates);
        });

        await Promise.all(promises);
        await this.fetchAllData();
    }

    async batchUpdateStatus(selectedIds, newStatus) {
        const ids = Array.from(selectedIds);
        const promises = ids.map(async (id) => {
            const acc = this.allAccruals.find(a => a.id === id);
            if (!acc) return;
            const updates = { status: newStatus };
            if (newStatus === 'unpaid') {
                updates.paymentDate = null;
                updates.paidOfficialAmount = 0;
                updates.paidServiceAmount = 0;
                updates.remainingAmount = acc.totalAmount; 
            }
            return this._updateAccrualDb(id, updates);
        });

        await Promise.all(promises);
        await this.fetchAllData();
    }

    async deleteAccrual(id) {
        await supabase.from('accruals').delete().eq('id', id);
        await this.fetchAllData();
    }
}