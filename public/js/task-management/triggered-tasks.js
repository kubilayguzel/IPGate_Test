// public/js/task-management/triggered-tasks.js

// 🔥 DÜZELTME: 'functions' importu kaldırıldı. Sadece Supabase servisleri var.
import { authService, taskService, accrualService, personService, transactionTypeService, supabase } from '../../supabase-config.js';
import { showNotification, TASK_STATUS_MAP, formatToTRDate } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

// --- ORTAK MODÜLLER ---
import Pagination from '../pagination.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'triggered-tasks.html' });

    class TriggeredTasksModule {
        constructor() {
            this.currentUser = null;
            
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allTransactionTypes = [];

            this.processedData = [];
            this.filteredData = [];
            this.sortState = { key: 'officialDueObj', direction: 'asc' };
            this.pagination = null;

            this.currentTaskForAccrual = null;
            this.currentTaskForStatusChange = null;

            this.taskDetailManager = null;
            this.accrualFormManager = null;
            this.statusDisplayMap = TASK_STATUS_MAP;
            this.triggeredTaskStatuses = ['awaiting_client_approval'];
        }

        init() {
            this.initializePagination();
            this.setupStaticEventListeners();

            this.taskDetailManager = new TaskDetailManager('modalBody');
            this.accrualFormManager = new AccrualFormManager('accrualFormContainer', 'triggeredAccrual');

            // Supabase Auth
            authService.isSupabaseAvailable = true;
            const user = authService.getCurrentUser();
            if (user) {
                this.currentUser = user;
                this.loadAllData();
            } else {
                window.location.href = 'index.html';
            }
        }

        initializePagination() {
            if (typeof Pagination !== 'undefined') {
                this.pagination = new Pagination({
                    containerId: 'paginationContainer',
                    itemsPerPage: 10,
                    itemsPerPageOptions: [10, 25, 50, 100],
                    onPageChange: async () => {
                        this.renderTable();
                    }
                });
            }
        }

        async loadAllData() {
            const loader = document.getElementById('loadingIndicator');
            if (loader) loader.style.display = 'block';

            try {
                // Supabase'deki rol/yetki kontrolü
                const isSuper = this.currentUser?.isSuperAdmin || this.currentUser?.role === 'super_admin';
                const targetStatus = 'awaiting_client_approval';

                const [tasksResult, transTypesResult, personsResult] = await Promise.all([
                    taskService.getTasksByStatus(targetStatus, isSuper ? null : this.currentUser.uid),
                    transactionTypeService.getTransactionTypes(),
                    personService.getPersons() // Accrual form için gerekli
                ]);

                this.allTasks = tasksResult.success ? tasksResult.data : [];
                this.allTransactionTypes = transTypesResult.success ? transTypesResult.data : [];
                this.allPersons = personsResult.success ? personsResult.data : [];

                // Accrual Form'a kişileri aktar
                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();

                this.processData(); 

                if (loader) loader.style.display = 'none';

            } catch (error) {
                console.error("Yükleme Hatası:", error);
                if (loader) loader.style.display = 'none';
            }
        }

        processData(preservePage = false) {
            const transTypeMap = new Map();
            this.allTransactionTypes.forEach(t => transTypeMap.set(String(t.id), t));

            const relevantTasks = this.allTasks.filter(task => this.triggeredTaskStatuses.includes(task.status));

            this.processedData = relevantTasks.map(task => {
                const applicationNumber = task.iprecordApplicationNo || task.details?.iprecordApplicationNo || "-";
                const relatedRecordTitle = task.iprecordTitle || task.details?.iprecordTitle || task.relatedIpRecordTitle || "-";
                const applicantName = task.iprecordApplicantName || task.details?.iprecordApplicantName || "-";

                const transactionTypeObj = transTypeMap.get(String(task.taskType || task.task_type));
                const taskTypeDisplayName = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                const parseDate = (d) => {
                    if (!d) return null;
                    return new Date(d);
                };

                const operationalDueObj = parseDate(task.dueDate || task.due_date || task.operationalDueDate); 
                const officialDueObj = parseDate(task.officialDueDate || task.official_due_date);
                const statusText = this.statusDisplayMap[task.status] || task.status;
                const searchString = `${task.id} ${applicationNumber} ${relatedRecordTitle} ${applicantName} ${taskTypeDisplayName} ${statusText}`.toLowerCase();

                return {
                    ...task,
                    applicationNumber,
                    relatedRecordTitle,
                    applicantName,
                    taskTypeDisplayName,
                    operationalDueObj,
                    officialDueObj,
                    statusText,
                    searchString
                };
            });

            const currentQuery = document.getElementById('taskSearchInput')?.value || document.getElementById('searchInput')?.value || '';
            this.handleSearch(currentQuery, preservePage); 
        }

        handleSearch(query, preservePage = false) {
            const statusFilter = document.getElementById('statusFilter')?.value || 'all';
            const lowerQuery = query ? query.toLowerCase() : '';

            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                const matchesStatus = (statusFilter === 'all' || item.status === statusFilter);
                return matchesSearch && matchesStatus;
            });

            this.sortData();
            
            if (this.pagination) {
                if (!preservePage) this.pagination.reset();
                this.pagination.update(this.filteredData.length);
            }
            this.renderTable();
        }

        handleSort(key) {
            if (this.sortState.key === key) {
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortState.key = key;
                this.sortState.direction = 'asc';
            }
            this.sortData();
            this.renderTable();
        }

        sortData() {
            const { key, direction } = this.sortState;
            const multiplier = direction === 'asc' ? 1 : -1;

            this.filteredData.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                const isEmptyA = (valA === null || valA === undefined || valA === '');
                const isEmptyB = (valB === null || valB === undefined || valB === '');

                if (isEmptyA && isEmptyB) return 0;
                if (isEmptyA) return -1;
                if (isEmptyB) return 1;

                if (valA instanceof Date && valB instanceof Date) return (valA - valB) * multiplier;

                if (key === 'id') {
                    const numA = parseInt(String(valA), 10);
                    const numB = parseInt(String(valB), 10);
                    if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * multiplier;
                }

                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
            });
            
            this.updateSortIcons();
        }

        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if (icon) {
                    icon.className = 'fas fa-sort';
                    icon.style.opacity = '0.3';
                    if (th.dataset.sort === this.sortState.key) {
                        icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                        icon.style.opacity = '1';
                    }
                }
            });
        }

        renderTable() {
            const tbody = document.getElementById('myTasksTableBody');
            const noRecordsMsg = document.getElementById('noTasksMessage');
            if(!tbody) return;
            
            tbody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if(noRecordsMsg) noRecordsMsg.style.display = 'block';
                return;
            }
            if(noRecordsMsg) noRecordsMsg.style.display = 'none';

            let currentData = this.pagination ? this.pagination.getCurrentPageData(this.filteredData) : this.filteredData;

            currentData.forEach(task => {
                const row = document.createElement('tr');
                const safeStatus = task.status || '';
                const statusClass = `status-${safeStatus.replace(/ /g, '_').toLowerCase()}`;
                
                const opDate = formatToTRDate(task.operationalDueObj);
                const offDate = formatToTRDate(task.officialDueObj);

                const opISO = task.operationalDueObj ? task.operationalDueObj.toISOString().slice(0,10) : '';
                const offISO = task.officialDueObj ? task.officialDueObj.toISOString().slice(0,10) : '';

                const actionMenuHtml = `
                    <div class="dropdown">
                        <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-ellipsis-v" style="pointer-events: none;"></i>
                        </button>
                        
                        <div class="dropdown-menu dropdown-menu-right shadow-sm border-0 p-2" style="min-width: auto;">
                            <div class="d-flex justify-content-center align-items-center" style="gap: 5px;">
                                <button class="btn btn-sm btn-light text-primary view-btn action-btn" data-id="${task.id}" title="Detay Görüntüle">
                                    <i class="fas fa-eye" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-warning edit-btn action-btn" data-id="${task.id}" title="Düzenle">
                                    <i class="fas fa-edit" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-success add-accrual-btn action-btn" data-id="${task.id}" title="Ek Tahakkuk Ekle">
                                    <i class="fas fa-file-invoice-dollar" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-info change-status-btn action-btn" data-id="${task.id}" title="Durum Değiştir">
                                    <i class="fas fa-exchange-alt" style="pointer-events: none;"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

                row.innerHTML = `
                    <td>${task.id}</td>
                    <td>${task.applicationNumber}</td>
                    <td>${task.relatedRecordTitle}</td>
                    <td>${task.applicantName}</td>
                    <td>${task.taskTypeDisplayName}</td>
                    <td data-field="operationalDue" data-date="${opISO}">${opDate}</td>
                    <td data-field="officialDue" data-date="${offISO}">${offDate}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td class="text-center" style="overflow:visible;">${actionMenuHtml}</td>
                `;
                tbody.appendChild(row);
            });

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('triggeredTasks'), 50);
            }
            if(window.$) $('.dropdown-toggle').dropdown();
        }

        async showTaskDetail(taskId) { 
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            let ipRecord = null;
            const recId = task.relatedIpRecordId || task.ip_record_id;
            if (recId) {
                try {
                    const { data: ipSnap } = await supabase.from('ip_records').select('*').eq('id', String(recId)).single();
                    if (ipSnap) {
                        ipRecord = { id: ipSnap.id, ...ipSnap.details, ...ipSnap };
                    } else {
                        const { data: suitSnap } = await supabase.from('suits').select('*').eq('id', String(recId)).single();
                        if (suitSnap) ipRecord = { id: suitSnap.id, ...suitSnap.details, ...suitSnap };
                    }
                } catch(e) { console.warn("Kayıt detayı çekilemedi:", e); }
            }

            const transactionType = this.allTransactionTypes.find(t => String(t.id) === String(task.taskType || task.task_type));
            const assignedUser = task.assignedTo_email ? { email: task.assignedTo_email } : null;
            
            // Tahakkukları çek
            const { data: relatedAccruals } = await supabase.from('accruals').select('*').eq('task_id', String(task.id));

            title.textContent = `İş Detayı (${task.id})`;
            
            this.taskDetailManager.render(task, {
                ipRecord, transactionType, assignedUser, accruals: relatedAccruals || []
            });
        }

        async showAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;

            document.getElementById('accrualTaskTitleDisplay').value = this.currentTaskForAccrual.title;
            this.accrualFormManager.reset();
            
            const getEpats = (t) => {
                if (!t) return null;
                if (t.details && Array.isArray(t.details.documents)) return t.details.documents.find(d => d.type === 'epats_document');
                if (Array.isArray(t.documents)) return t.documents.find(d => d.type === 'epats_document');
                return (t.details && t.details.epatsDocument) || t.epatsDocument || null;
            };

            let epatsDoc = getEpats(this.currentTaskForAccrual);
            const parentId = this.currentTaskForAccrual.relatedTaskId || this.currentTaskForAccrual.associatedTaskId || this.currentTaskForAccrual.triggeringTaskId;
            
            if (!epatsDoc && parentId) {
                let parent = this.allTasks.find(t => String(t.id) === String(parentId));
                if (!parent) {
                    try {
                        const { data: parentSnap } = await supabase.from('tasks').select('*').eq('id', String(parentId)).single();
                        if (parentSnap) parent = { ...parentSnap.details, ...parentSnap };
                    } catch (e) {}
                }
                epatsDoc = getEpats(parent);
            }
            
            this.accrualFormManager.showEpatsDoc(epatsDoc);
            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveAccrual() {
            if (!this.currentTaskForAccrual) return;

            const result = this.accrualFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                return;
            }
            const formData = result.data;
            const { files, ...formDataNoFiles } = formData;

            const newAccrual = {
                task_id: this.currentTaskForAccrual.id,
                status: 'unpaid',
                created_at: new Date().toISOString(),
                details: {
                    taskTitle: this.currentTaskForAccrual.title,
                    ...formDataNoFiles,
                    remainingAmount: formDataNoFiles.totalAmount
                }
            };

            try {
                const { error } = await accrualService.addAccrual(newAccrual);
                if (!error) {
                    showNotification('Tahakkuk oluşturuldu.', 'success');
                    this.closeModal('createMyTaskAccrualModal');
                    await this.loadAllData();
                } else {
                    showNotification('Hata: ' + error.message, 'error');
                }
            } catch(e) { showNotification('Hata oluştu.', 'error'); }
        }
        
        showStatusChangeModal(taskId) {
            this.currentTaskForStatusChange = this.allTasks.find(t => t.id === taskId);
            if(!this.currentTaskForStatusChange) return;
            
            document.getElementById('changeStatusModalTaskTitleDisplay').textContent = this.currentTaskForStatusChange.title;
            document.getElementById('newTriggeredTaskStatus').value = this.currentTaskForStatusChange.status;
            
            document.getElementById('changeTriggeredTaskStatusModal').classList.add('show');
        }

        async handleUpdateStatus() {
            if (!this.currentTaskForStatusChange) return;
            
            let newStatus = document.getElementById('newTriggeredTaskStatus').value;
            
            if (newStatus === 'client_approval_opened') {
                console.log('🔄 Statü "Müvekkil Onayı - Açıldı" seçildi, otomasyon için "Açık" (open) olarak gönderiliyor.');
                newStatus = 'open';
            }

            try {
                const newHistoryEntry = {
                    action: `Durum değiştirildi: ${newStatus} (Müvekkil Onayı ile)`,
                    timestamp: new Date().toISOString(),
                    userEmail: this.currentUser.email
                };

                const currentHistory = this.currentTaskForStatusChange.history || [];

                await taskService.updateTask(this.currentTaskForStatusChange.id, {
                    ...this.currentTaskForStatusChange, // Mevcut veriyi koru
                    status: newStatus,
                    history: [...currentHistory, newHistoryEntry]
                });
                
                showNotification('Durum güncellendi ve işleme alındı.', 'success');
                this.closeModal('changeTriggeredTaskStatusModal');
                await this.loadAllData();
            } catch (e) {
                showNotification('Hata: ' + e.message, 'error');
            }
        }

        setupStaticEventListeners() {
            document.getElementById('searchInput')?.addEventListener('input', (e) => this.handleSearch(e.target.value));
            document.getElementById('statusFilter')?.addEventListener('change', (e) => {
                const query = document.getElementById('searchInput')?.value || '';
                this.handleSearch(query);
            });

            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                th.addEventListener('click', () => this.handleSort(th.dataset.sort));
            });

            document.getElementById('myTasksTableBody')?.addEventListener('click', (e) => {
                const btn = e.target.closest('.action-btn');
                if (!btn) return;
                const taskId = btn.dataset.id;

                if (btn.classList.contains('view-btn')) this.showTaskDetail(taskId);
                else if (btn.classList.contains('edit-btn')) window.location.href = `task-update.html?id=${taskId}`;
                else if (btn.classList.contains('add-accrual-btn')) this.showAccrualModal(taskId);
                else if (btn.classList.contains('change-status-btn')) this.showStatusChangeModal(taskId);
            });

            const closeModal = (id) => this.closeModal(id);
            document.getElementById('closeTaskDetailModal')?.addEventListener('click', () => closeModal('taskDetailModal'));
            document.getElementById('closeMyTaskAccrualModal')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('saveNewMyTaskAccrualBtn')?.addEventListener('click', () => this.handleSaveAccrual());

            document.getElementById('closeChangeTriggeredTaskStatusModal')?.addEventListener('click', () => closeModal('changeTriggeredTaskStatusModal'));
            document.getElementById('cancelChangeTriggeredTaskStatusBtn')?.addEventListener('click', () => closeModal('changeTriggeredTaskStatusModal'));
            document.getElementById('saveChangeTriggeredTaskStatusBtn')?.addEventListener('click', () => this.handleUpdateStatus());

            // 🔥 DÜZELTME: Firebase Cloud Function yerini Supabase Edge uyarısına bıraktı.
            document.getElementById('manualRenewalTriggerBtn')?.addEventListener('click', async () => {
                showNotification('Yenileme otomasyonu Supabase sistemine aktarılmaktadır. Kısa süre içinde aktif olacaktır.', 'info');
            });
        }

        closeModal(modalId) {
            document.getElementById(modalId)?.classList.remove('show');
            if (modalId === 'createMyTaskAccrualModal' && this.accrualFormManager) {
                this.accrualFormManager.reset();
            }
        }
    }

    new TriggeredTasksModule().init();
});