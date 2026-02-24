// public/js/task-management/main.js

import { authService, taskService, ipRecordsService, personService, transactionTypeService, supabase } from '../../supabase-config.js';
import { showNotification, TASK_STATUS_MAP } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';

// Modüller
import Pagination from '../pagination.js'; 
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { TaskDetailManager } from '../components/TaskDetailManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Ortak Layout Yüklemesi
    await loadSharedLayout({ activeMenuLink: 'task-management.html' });

    class TaskManagementModule {
        constructor() {
            this.currentUser = null;

            // Veri Havuzları (Arrays)
            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = [];
            this.allTransactionTypes = [];
            this.allAccruals = [];

            // --- PERFORMANS HARİTALARI (MAPS) ---
            this.usersMap = new Map();
            this.transactionTypesMap = new Map();

            // İşlenmiş ve Filtrelenmiş Veriler
            this.processedData = []; 
            this.filteredData = [];

            // Sıralama ve Sayfalama Durumu
            this.sortState = { key: 'id', direction: 'desc' }; // Varsayılan: En yeni ID en üstte
            this.pagination = null;

            // Seçili İşlem Durumları
            this.selectedTaskForAssignment = null;
            this.currentTaskForAccrual = null;
            this.selectedTaskIds = new Set(); 
            this.tasksToAssign = []; 

            // Component Yöneticileri
            this.createTaskFormManager = null;
            this.completeTaskFormManager = null;
            this.taskDetailManager = null;

            this.activeMainTab = 'active'; 
            this.activeSubTab = 'active';  

            this.statusDisplayMap = TASK_STATUS_MAP || {
                'open': 'Açık', 'in-progress': 'Devam Ediyor', 'completed': 'Tamamlandı',
                'pending': 'Beklemede', 'cancelled': 'İptal Edildi', 'on-hold': 'Askıda',
                'awaiting-approval': 'Onay Bekliyor', 'awaiting_client_approval': 'Müvekkil Onayı Bekliyor',
                'client_approval_opened': 'Müvekkil Onayı - Açıldı', 'client_approval_closed': 'Müvekkil Onayı - Kapatıldı',
                'client_no_response_closed': 'Müvekkil Cevaplamadı - Kapatıldı'
            };
        }

        init() {
            this.setupStaticEventListeners();
            this.initializePagination();

            // Supabase Auth
            authService.isSupabaseAvailable = true;
            const user = authService.getCurrentUser();
            if (user) {
                this.currentUser = user;
                this.loadAllData();
            } else {
                window.location.href = 'index.html';
            }

            // Sekmeler arası canlı yenileme
            window.addEventListener('storage', async (e) => {
                if (e.key === 'crossTabUpdatedTaskId' && e.newValue) {
                    await this.loadAllData();
                    localStorage.removeItem('crossTabUpdatedTaskId');
                }
            });
        }

        initializePagination() {
            if (typeof Pagination === 'undefined') {
                console.error("Pagination sınıfı yüklenemedi.");
                return;
            }
            this.pagination = new Pagination({
                containerId: 'paginationContainer',
                itemsPerPage: 10,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: async () => {
                    this.renderTable();
                }
            });
        }

        async loadAllData() {
            let loader = null;
            if (window.showSimpleLoading) {
                loader = window.showSimpleLoading('İş Listesi Yükleniyor', 'Lütfen bekleyiniz...');
            } else {
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'block';
            }

            try {
                // 1. Görevleri çek
                const tasksResult = await taskService.getTasksForUser(this.currentUser.uid);
                this.allTasks = tasksResult.success ? tasksResult.data : [];

                // 2. Sabit sözlükleri çek
                const fetchPromises = [];
                if (this.allPersons.length === 0) fetchPromises.push(personService.getPersons());
                if (this.allUsers.length === 0) fetchPromises.push(taskService.getAllUsers());
                if (this.allTransactionTypes.length === 0) fetchPromises.push(transactionTypeService.getTransactionTypes());

                const results = await Promise.all(fetchPromises);
                
                let resIndex = 0;
                if (this.allPersons.length === 0) this.allPersons = results[resIndex++]?.success ? results[resIndex-1].data : [];
                if (this.allUsers.length === 0) this.allUsers = results[resIndex++]?.success ? results[resIndex-1].data : [];
                if (this.allTransactionTypes.length === 0) this.allTransactionTypes = results[resIndex++]?.success ? results[resIndex-1].data : [];

                this.buildMaps();
                this.initForms();

                // 3. Tabloyu çiz
                this.processData();
                if (this.pagination) {
                    this.pagination.update(this.filteredData.length);
                }
                this.renderTable();

                if (loader) loader.hide();
                const oldLoader = document.getElementById('loadingIndicator');
                if(oldLoader) oldLoader.style.display = 'none';

            } catch (error) {
                console.error(error);
                if (loader) loader.hide(); 
                showNotification('Veriler yüklenirken hata oluştu: ' + error.message, 'error');
            }
        }

        buildMaps() {
            this.usersMap.clear();
            this.allUsers.forEach(u => {
                if(u.id) this.usersMap.set(u.id, u);
            });

            this.transactionTypesMap.clear();
            this.allTransactionTypes.forEach(t => {
                if(t.id) this.transactionTypesMap.set(t.id, t);
            });
        }

        initForms() {
            this.createTaskFormManager = new AccrualFormManager('createTaskAccrualFormContainer', 'createTask', this.allPersons);
            this.createTaskFormManager.render();

            this.completeTaskFormManager = new AccrualFormManager('completeAccrualFormContainer', 'comp', this.allPersons);
            this.completeTaskFormManager.render();
            
            this.taskDetailManager = new TaskDetailManager('modalBody');
        }

        processData(preservePage = false) {
            const parseDate = (d) => {
                if (!d) return null;
                const parsed = new Date(d);
                if (isNaN(parsed.getTime())) return null; // 🔥 YENİ: Tarih geçersizse çökmesini engeller
                return parsed; 
            };

            this.processedData = this.allTasks.map(task => {
                const details = task.details || {};
                const appNo = task.iprecordApplicationNo || details.iprecordApplicationNo || "-";
                const recordTitle = task.iprecordTitle || details.iprecordTitle || task.relatedIpRecordTitle || "-";
                const applicantName = task.iprecordApplicantName || details.iprecordApplicantName || "-";

                const transactionTypeObj = this.transactionTypesMap.get(task.taskType || task.task_type);
                const taskTypeDisplay = transactionTypeObj ? (transactionTypeObj.alias || transactionTypeObj.name) : (task.taskType || 'Bilinmiyor');

                const assignedUser = this.usersMap.get(task.assignedTo_uid || task.assigned_to_user_id);
                const assignedToDisplay = assignedUser ? (assignedUser.displayName || assignedUser.email) : 'Atanmamış';

                const operationalDueObj = parseDate(task.dueDate || task.due_date || task.operationalDueDate || task.operational_due_date); 
                const operationalDueDisplay = operationalDueObj ? operationalDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';
                const officialDueObj = parseDate(task.officialDueDate || task.official_due_date); 
                const officialDueDisplay = officialDueObj ? officialDueObj.toLocaleDateString('tr-TR') : 'Belirtilmemiş';

                const statusText = this.statusDisplayMap[task.status] || task.status;
                
                const searchString = `${task.id} ${task.title || ''} ${appNo} ${recordTitle} ${applicantName} ${taskTypeDisplay} ${assignedToDisplay} ${statusText}`.toLowerCase();

                return {
                    ...task,
                    appNo,
                    recordTitle,
                    applicantName,
                    relatedRecord: appNo,
                    taskTypeDisplay,
                    assignedToDisplay,
                    operationalDueDisplay,
                    officialDueDisplay,
                    operationalDueObj,
                    officialDueObj,
                    statusText,
                    searchString
                };
            });

            const currentQuery = document.getElementById('searchInput')?.value || '';
            this.handleSearch(currentQuery, preservePage);
        }

        handleSearch(query, preservePage = false) {
            const searchInput = document.getElementById('searchInput');
            const searchValue = (query !== undefined ? query : (searchInput?.value || '')).toLowerCase();

            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !searchValue || item.searchString.includes(searchValue);
                let matchesTab = false;
                
                const isFinished = ['completed', 'cancelled', 'client_approval_closed', 'client_no_response_closed'].includes(item.status);
                const isAccrualTask = String(item.taskType) === '53';

                if (this.activeMainTab === 'active') {
                    matchesTab = !isAccrualTask && !isFinished;
                } else if (this.activeMainTab === 'completed') {
                    matchesTab = !isAccrualTask && isFinished;
                } else if (this.activeMainTab === 'accrual') {
                    if (isAccrualTask) {
                        matchesTab = this.activeSubTab === 'active' ? !isFinished : isFinished;
                    }
                }

                return matchesSearch && matchesTab;
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
                let valA = a[key] || '';
                let valB = b[key] || '';

                if (valA instanceof Date && valB instanceof Date) return (valA - valB) * multiplier;
                if (valA instanceof Date) return -1 * multiplier; 
                if (valB instanceof Date) return 1 * multiplier;

                if (key === 'id') {
                    const numA = parseFloat(String(valA).replace(/[^0-9]/g, ''));
                    const numB = parseFloat(String(valB).replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * multiplier;
                }

                return String(valA).localeCompare(String(valB), 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#tasksTableHeaderRow th[data-sort]').forEach(th => {
                const icon = th.querySelector('i');
                if(!icon) return;
                
                icon.className = 'fas fa-sort';
                icon.style.opacity = '0.3';
                
                if (th.dataset.sort === this.sortState.key) {
                    icon.className = this.sortState.direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                    icon.style.opacity = '1';
                }
            });
        }

        renderTable() {
            const tbody = document.getElementById('tasksTableBody');
            const noRecordsMsg = document.getElementById('noTasksMessage');
            
            if (!tbody) return;
            tbody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if (noRecordsMsg) noRecordsMsg.style.display = 'block';
                return;
            } else {
                if (noRecordsMsg) noRecordsMsg.style.display = 'none';
            }

            let currentData = this.pagination ? this.pagination.getCurrentPageData(this.filteredData) : this.filteredData;
            let html = '';

            currentData.forEach(task => {
                const safeStatus = (task.status || '').toString();
                const statusClass = `status-${safeStatus.replace(/ /g, '_').toLowerCase()}`;
                const safePriority = (task.priority || 'normal').toString();
                const priorityClass = `priority-${safePriority.toLowerCase()}`;

                html += `
                    <tr>
                        <td><input type="checkbox" class="task-checkbox" value="${task.id}" ${this.selectedTaskIds.has(task.id) ? 'checked' : ''}></td>
                        <td>${task.id}</td>
                        <td>
                            <div class="font-weight-bold text-primary">${task.appNo}</div>
                            <div class="small text-dark">${task.recordTitle}</div>
                            <div class="small text-muted" style="font-size: 0.8em;">${task.applicantName}</div>
                        </td>
                        <td>${task.taskTypeDisplay}</td>
                        <td><span class="priority-badge ${priorityClass}">${safePriority}</span></td>
                        <td>${task.assignedToDisplay}</td>
                        <td data-field="operationalDue" data-date="${task.operationalDueObj ? task.operationalDueObj.toISOString() : ''}">${task.operationalDueDisplay}</td>
                        <td data-field="officialDue" data-date="${task.officialDueObj ? task.officialDueObj.toISOString() : ''}">${task.officialDueDisplay}</td>
                        <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                        <td class="text-center" style="overflow:visible;">${this.getActionButtonsHtml(task)}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;

            this.updateSortIcons();
            this.attachCheckboxListeners(); 
            if (window.$) $('.dropdown-toggle').dropdown();

            if (window.DeadlineHighlighter && typeof window.DeadlineHighlighter.refresh === 'function') {
                setTimeout(() => window.DeadlineHighlighter.refresh('taskManagement'), 50);
            }
        }

        attachCheckboxListeners() {
            const selectAllCb = document.getElementById('selectAllTasks');
            const rowCbs = document.querySelectorAll('.task-checkbox');

            if (selectAllCb) {
                const newSelectAll = selectAllCb.cloneNode(true);
                selectAllCb.parentNode.replaceChild(newSelectAll, selectAllCb);
                newSelectAll.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    rowCbs.forEach(cb => {
                        cb.checked = isChecked;
                        if (isChecked) this.selectedTaskIds.add(cb.value);
                        else this.selectedTaskIds.delete(cb.value);
                    });
                    this.updateBatchAssignButton();
                });
            }

            rowCbs.forEach(cb => {
                cb.addEventListener('change', (e) => {
                    if (e.target.checked) this.selectedTaskIds.add(e.target.value);
                    else this.selectedTaskIds.delete(e.target.value);
                    if (selectAllCb) selectAllCb.checked = Array.from(rowCbs).every(c => c.checked);
                    this.updateBatchAssignButton();
                });
            });
        }

        updateBatchAssignButton() {
            const btn = document.getElementById('batchAssignBtn');
            const countSpan = document.getElementById('selectedTaskCount');
            if (!btn || !countSpan) return;

            if (this.selectedTaskIds.size > 0) {
                countSpan.textContent = this.selectedTaskIds.size;
                btn.style.display = 'inline-block';
            } else {
                btn.style.display = 'none';
            }
        }

        getActionButtonsHtml(task) {
            const safeStatus = (task.status || '').toString();
            const isCompleted = safeStatus === 'completed';
            const isAccrualTask = (String(task.taskType) === '53' || task.taskType === 'accrual_creation');
            const hideModificationButtons = isAccrualTask && isCompleted;

            let buttonsHtml = `<button class="btn btn-sm btn-light text-primary view-btn action-btn" data-id="${task.id}" title="Görüntüle"><i class="fas fa-eye" style="pointer-events: none;"></i></button>`;

            if (!hideModificationButtons) {
                buttonsHtml += `
                    <button class="btn btn-sm btn-light text-warning edit-btn action-btn" data-id="${task.id}" title="Düzenle"><i class="fas fa-edit" style="pointer-events: none;"></i></button>
                    <button class="btn btn-sm btn-light text-danger delete-btn action-btn" data-id="${task.id}" title="Sil"><i class="fas fa-trash-alt" style="pointer-events: none;"></i></button>
                `;
            }

            if (safeStatus !== 'cancelled' && !hideModificationButtons) {
                buttonsHtml += `<button class="btn btn-sm btn-light text-info assign-btn action-btn" data-id="${task.id}" title="Başkasına Ata"><i class="fas fa-user-plus" style="pointer-events: none;"></i></button>`;
            }

            if (!isAccrualTask) {
                buttonsHtml += `<button class="btn btn-sm btn-light text-success add-accrual-btn action-btn" data-id="${task.id}" title="Ek Tahakkuk Ekle"><i class="fas fa-file-invoice-dollar" style="pointer-events: none;"></i></button>`;
            }

            return `
            <div class="dropdown">
                <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                    <i class="fas fa-ellipsis-v" style="pointer-events: none;"></i>
                </button>
                <div class="dropdown-menu dropdown-menu-right shadow-sm border-0 p-2" style="min-width: auto;">
                    <div class="d-flex justify-content-center align-items-center" style="gap: 5px;">
                        ${buttonsHtml}
                    </div>
                </div>
            </div>
            `;
        }

        setupStaticEventListeners() {
            const mainTabs = document.querySelectorAll('#mainTaskTabs .nav-link');
            const subTabContainer = document.getElementById('accrualSubTabsContainer');

            mainTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    mainTabs.forEach(t => { t.classList.remove('active'); t.style.color = '#6c757d'; });
                    e.currentTarget.classList.add('active');
                    e.currentTarget.style.color = '#495057';
                    this.activeMainTab = e.currentTarget.dataset.tab;
                    if (this.activeMainTab === 'accrual') subTabContainer.style.display = 'block';
                    else subTabContainer.style.display = 'none';
                    this.handleSearch();
                });
            });

            const subTabs = document.querySelectorAll('#accrualSubTabs .nav-link');
            subTabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    subTabs.forEach(t => t.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.activeSubTab = e.currentTarget.dataset.subtab;
                    this.handleSearch();
                });
            });

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    if (this.searchTimeout) clearTimeout(this.searchTimeout);
                    this.searchTimeout = setTimeout(() => { this.handleSearch(e.target.value); }, 300);
                });
            }

            const statusFilter = document.getElementById('statusFilter');
            if (statusFilter) {
                statusFilter.addEventListener('change', () => {
                    const currentSearchValue = document.getElementById('searchInput')?.value || '';
                    this.handleSearch(currentSearchValue);
                });
            }
            
            const headers = document.querySelectorAll('#tasksTableHeaderRow th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => { this.handleSort(th.dataset.sort); });
            });

            const tbody = document.getElementById('tasksTableBody');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const btn = e.target.closest('.action-btn');
                    if (!btn) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const taskId = btn.dataset.id;
                    
                    if (btn.classList.contains('edit-btn')) {
                        const task = this.allTasks.find(t => t.id === taskId);
                        if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                            this.openCompleteAccrualModal(taskId);
                        } else {
                            window.location.href = `task-update.html?id=${taskId}`;
                        }
                    } else if (btn.classList.contains('delete-btn')) {
                        this.deleteTask(taskId);
                    } else if (btn.classList.contains('view-btn')) {
                        this.showTaskDetailModal(taskId);
                    } else if (btn.classList.contains('assign-btn')) {
                        this.openAssignTaskModal(taskId);
                    } else if (btn.classList.contains('add-accrual-btn')) {
                        this.showCreateTaskAccrualModal(taskId);
                    }
                });
            }

            document.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const modal = e.target.closest('.modal');
                    if (modal) this.closeModal(modal.id);
                });
            });

            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());
            document.getElementById('cancelCreateTaskAccrualBtn')?.addEventListener('click', () => this.closeModal('createTaskAccrualModal'));
            document.getElementById('saveNewAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => this.closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
            document.getElementById('batchAssignBtn')?.addEventListener('click', () => this.openAssignTaskModal());
            document.getElementById('btnExportSelected')?.addEventListener('click', (e) => { e.preventDefault(); this.exportToExcel('selected'); });
            document.getElementById('btnExportAll')?.addEventListener('click', (e) => { e.preventDefault(); this.exportToExcel('all'); });      
        }

        // --- İŞLEMLER ---
        async showTaskDetailModal(taskId) {
            const modalElement = document.getElementById('taskDetailModal');
            const modalTitle = document.getElementById('modalTaskTitle');
            if (!modalElement || !this.taskDetailManager) return;

            modalElement.classList.add('show');
            modalTitle.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            try {
                // Taze Veri Çekimi
                const { data: taskSnap, error: taskErr } = await supabase.from('tasks').select('*').eq('id', String(taskId)).single();
                if (taskErr || !taskSnap) {
                    this.taskDetailManager.showError('Bu iş kaydı bulunamadı.');
                    return;
                }
                const task = { id: taskSnap.id, ...(taskSnap.details || {}), ...taskSnap };
                modalTitle.textContent = `İş Detayı (${task.id})`;

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
                    } catch(e) {}
                }
                
                const transactionType = this.transactionTypesMap.get(task.taskType || task.task_type);
                const assignedUser = this.usersMap.get(task.assignedTo_uid || task.assigned_to_user_id);
                
                const { data: accData } = await supabase.from('accruals').select('*').eq('task_id', String(task.id));
                const relatedAccruals = accData ? accData.map(d => ({ id: d.id, ...d.details, ...d })) : [];

                this.taskDetailManager.render(task, { ipRecord, transactionType, assignedUser, accruals: relatedAccruals });

            } catch (error) {
                console.error(error);
                this.taskDetailManager.showError('Hata: ' + error.message);
            }
        }

        openAssignTaskModal(taskId = null) {
            this.tasksToAssign = [];
            if (taskId) {
                const t = this.allTasks.find(task => task.id === String(taskId));
                if(t) this.tasksToAssign.push(t);
            } else {
                this.tasksToAssign = this.allTasks.filter(t => this.selectedTaskIds.has(String(t.id)));
            }

            if (this.tasksToAssign.length === 0) { 
                showNotification('Atanacak iş bulunamadı veya seçilmedi.', 'error'); return; 
            }

            const select = document.getElementById('newAssignedTo');
            if (select) {
                select.innerHTML = '<option value="">Seçiniz...</option>';
                this.allUsers.forEach(user => {
                    const opt = document.createElement('option');
                    opt.value = user.id;
                    opt.textContent = user.displayName || user.email;
                    if (this.tasksToAssign.length === 1 && (user.id === this.tasksToAssign[0].assignedTo_uid || user.id === this.tasksToAssign[0].assigned_to_user_id)) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });
            }
            document.getElementById('assignTaskModal').classList.add('show');
        }

        async saveNewAssignment() {
            const uid = document.getElementById('newAssignedTo')?.value;
            if (!uid) { showNotification('Lütfen kullanıcı seçin.', 'warning'); return; }
            
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Atama Yapılıyor') : null;
            const user = this.usersMap.get(uid);

            try {
                const assignPromises = this.tasksToAssign.map(task => {
                    const assignedEmail = task.assignedTo_email || task.assignedToEmail || 'Atanmamış';
                    const historyEntry = { 
                        action: `İş yeniden atandı: ${assignedEmail} -> ${user.email}`, 
                        timestamp: new Date().toISOString(), 
                        userEmail: this.currentUser.email 
                    };
                    let history = task.history ? [...task.history] : [];
                    history.push(historyEntry);

                    return taskService.updateTask(task.id, {
                        ...task,
                        assignedTo_uid: uid, 
                        assignedToEmail: user.email,
                        history: history 
                    });
                });

                await Promise.all(assignPromises); 
                
                if (loader) loader.hide();
                showNotification(`${this.tasksToAssign.length} adet iş başarıyla atandı!`, 'success'); 
                
                this.selectedTaskIds.clear(); 
                this.updateBatchAssignButton();
                this.closeModal('assignTaskModal'); 
                
                const selectAllCb = document.getElementById('selectAllTasks');
                if(selectAllCb) selectAllCb.checked = false;

                await this.loadAllData(); 
            } catch (e) { 
                if (loader) loader.hide();
                console.error(e);
                showNotification('Atama sırasında hata oluştu.', 'error'); 
            }
        }

        async deleteTask(taskId) {
            // Şimdilik sadece uyarı veriyoruz çünkü task silme methodu taskService içinde eklenmediyse diye
            if (confirm('Bu görevi silmek istediğinize emin misiniz?')) {
                let loader = window.showSimpleLoading ? window.showSimpleLoading('Siliniyor') : null;
                try {
                    const { error } = await supabase.from('tasks').delete().eq('id', String(taskId));
                    if(error) throw error;
                    if (loader) loader.hide();
                    showNotification('Silindi.', 'success'); 
                    await this.loadAllData(); 
                } catch(e) {
                    if (loader) loader.hide();
                    showNotification('Hata: ' + e.message, 'error'); 
                }
            }
        }

        async showCreateTaskAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) { showNotification('İş bulunamadı.', 'error'); return; }
            
            document.getElementById('createTaskAccrualTaskTitleDisplay').value = `${this.currentTaskForAccrual.title} (${this.currentTaskForAccrual.id})`;
            
            if(this.createTaskFormManager) {
                this.createTaskFormManager.reset();

                const getEpats = (t) => {
                    if (!t) return null;
                    if (t.details && Array.isArray(t.details.documents)) return t.details.documents.find(d => d.type === 'epats_document');
                    if (Array.isArray(t.documents)) return t.documents.find(d => d.type === 'epats_document');
                    return (t.details && t.details.epatsDocument) || t.epatsDocument || t.epats_document || null;
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
                this.createTaskFormManager.showEpatsDoc(epatsDoc);
            }
            document.getElementById('createTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() { 
            if (!this.currentTaskForAccrual) return;

            const btn = document.getElementById('saveNewAccrualBtn');
            if (btn) btn.disabled = true;

            const result = this.createTaskFormManager.getData();
            if (!result.success) { 
                showNotification(result.error, 'error'); 
                if (btn) btn.disabled = false;
                return; 
            }

            const formData = result.data;
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Tahakkuk Kaydediliyor') : null;
            const { files, ...formDataNoFiles } = formData;

            let uploadedFiles = [];
            if (files && files.length > 0) {
                try {
                    const file = files[0];
                    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const path = `accruals/foreign_invoices/${Date.now()}_${cleanName}`;
                    
                    const { error: upErr } = await supabase.storage.from('task_documents').upload(path, file);
                    if (upErr) throw upErr;

                    const { data: urlData } = supabase.storage.from('task_documents').getPublicUrl(path);

                    uploadedFiles.push({ 
                        name: file.name, 
                        url: urlData.publicUrl, 
                        type: 'foreign_invoice', 
                        documentDesignation: 'Yurtdışı Fatura/Debit', 
                        uploadedAt: new Date().toISOString() 
                    });
                } catch(err) { 
                    if (loader) loader.hide(); 
                    showNotification("Dosya yüklenemedi.", "error"); 
                    if (btn) btn.disabled = false;
                    return; 
                }
            }

            const newAccrual = {
                task_id: this.currentTaskForAccrual.id,
                status: 'unpaid',
                created_at: new Date().toISOString(),
                evreka_invoice_no: formDataNoFiles.evrekaInvoiceNo?.trim() || null,
                tpe_invoice_no: formDataNoFiles.tpeInvoiceNo?.trim() || null,
                details: {
                    taskTitle: this.currentTaskForAccrual.title,
                    ...formDataNoFiles,
                    totalAmountCurrency: formDataNoFiles.totalAmountCurrency || 'TRY',
                    remainingAmount: formDataNoFiles.totalAmount,
                    files: uploadedFiles
                }
            };

            try {
                const { error: addErr } = await supabase.from('accruals').insert(newAccrual);
                if (loader) loader.hide();

                if (!addErr) { 
                    showNotification('Ek tahakkuk başarıyla oluşturuldu!', 'success'); 
                    this.closeModal('createTaskAccrualModal'); 
                    await this.loadAllData(); 
                } else { 
                    showNotification('Hata: ' + addErr.message, 'error'); 
                }
            } catch (e) {
                if (loader) loader.hide();
                showNotification('Hata: ' + (e?.message || e), 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async openCompleteAccrualModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            document.getElementById('targetTaskIdForCompletion').value = taskId;

            if(this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
                const getEpats = (t) => {
                    if (!t) return null;
                    if (t.details && Array.isArray(t.details.documents)) return t.details.documents.find(d => d.type === 'epats_document');
                    if (Array.isArray(t.documents)) return t.documents.find(d => d.type === 'epats_document');
                    return (t.details && t.details.epatsDocument) || t.epatsDocument || t.epats_document || null;
                };

                let epatsDoc = getEpats(task);
                const parentId = task.relatedTaskId || task.associatedTaskId || task.triggeringTaskId;
                
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
                
                this.completeTaskFormManager.showEpatsDoc(epatsDoc);

                const targetAccrualId = task.details?.targetAccrualId;
                if (targetAccrualId) {
                    try {
                        const { data: accSnap } = await supabase.from('accruals').select('*').eq('id', String(targetAccrualId)).single();
                        if (accSnap) {
                            this.completeTaskFormManager.setData({ ...accSnap.details, ...accSnap });
                        }
                    } catch (e) {}
                }
            }
            document.getElementById('completeAccrualTaskModal').classList.add('show');
        }

        async handleCompleteAccrualSubmission() {
            const taskId = document.getElementById('targetTaskIdForCompletion')?.value;
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) return;

            const btn = document.getElementById('submitCompleteAccrualBtn');
            if (btn) btn.disabled = true;

            const result = this.completeTaskFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                if (btn) btn.disabled = false;
                return;
            }

            const formData = result.data;
            const { files, ...formDataNoFiles } = formData; 

            let loader = window.showSimpleLoading ? window.showSimpleLoading('İşlem Tamamlanıyor') : null;

            let uploadedFiles = [];
            if (files && files.length > 0) {
                try {
                    const file = files[0];
                    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const path = `accruals/foreign_invoices/${Date.now()}_${cleanName}`;
                    
                    const { error: upErr } = await supabase.storage.from('task_documents').upload(path, file);
                    if (upErr) throw upErr;

                    const { data: urlData } = supabase.storage.from('task_documents').getPublicUrl(path);

                    uploadedFiles.push({
                        name: file.name,
                        url: urlData.publicUrl,
                        type: 'foreign_invoice',
                        documentDesignation: 'Yurtdışı Fatura/Debit',
                        uploadedAt: new Date().toISOString()
                    });
                } catch (err) {
                    if (loader) loader.hide();
                    showNotification("Dosya yükleme hatası.", "error");
                    if (btn) btn.disabled = false;
                    return;
                }
            }

            const cleanTitle = task.title ? task.title.replace('Tahakkuk Oluşturma: ', '') : 'Tahakkuk';

            const basePayload = {
                task_id: task.relatedTaskId || taskId,
                evreka_invoice_no: formDataNoFiles.evrekaInvoiceNo?.trim() || null,
                tpe_invoice_no: formDataNoFiles.tpeInvoiceNo?.trim() || null,
                details: {
                    taskTitle: cleanTitle,
                    ...formDataNoFiles
                }
            };

            const targetAccrualId = task.details?.targetAccrualId;

            try {
                if (targetAccrualId) {
                    const { data: existing, error: fetchErr } = await supabase.from('accruals').select('*').eq('id', String(targetAccrualId)).single();
                    if (fetchErr || !existing) throw new Error('Güncellenecek tahakkuk bulunamadı.');

                    const existingDetails = existing.details || {};
                    const mergedFiles = uploadedFiles.length > 0 ? [ ...(existingDetails.files || []), ...uploadedFiles ] : (existingDetails.files || []);

                    let remainingAmountUpdate = {};
                    try {
                        if (JSON.stringify(existingDetails.remainingAmount || null) === JSON.stringify(existingDetails.totalAmount || null)) {
                            remainingAmountUpdate = { remainingAmount: basePayload.details.totalAmount };
                        }
                    } catch (_) {}

                    const updates = {
                        ...basePayload,
                        details: {
                            ...existingDetails,
                            ...basePayload.details,
                            files: mergedFiles,
                            ...remainingAmountUpdate
                        }
                    };

                    const { error: updErr } = await supabase.from('accruals').update(updates).eq('id', String(targetAccrualId));
                    if (updErr) throw new Error(updErr.message);

                } else {
                    const newAccrual = { ...basePayload, status: 'unpaid' };
                    newAccrual.details.remainingAmount = basePayload.details.totalAmount;
                    newAccrual.details.files = uploadedFiles;

                    const { data: addRes, error: addErr } = await supabase.from('accruals').insert(newAccrual).select('id').single();
                    if (addErr) throw new Error(addErr.message);

                    await taskService.updateTask(taskId, {
                        ...task,
                        details: { ...(task.details || {}), targetAccrualId: addRes.id }
                    });
                }

                const updateData = {
                    ...task,
                    status: 'completed',
                    history: [
                        ...(task.history || []),
                        {
                            action: targetAccrualId ? 'Tahakkuk güncellenerek görev tamamlandı.' : 'Tahakkuk oluşturularak görev tamamlandı.',
                            timestamp: new Date().toISOString(),
                            userEmail: this.currentUser.email
                        }
                    ]
                };

                const taskResult = await taskService.updateTask(taskId, updateData);
                if (!taskResult.success) throw new Error('Görev güncellenemedi.');

                if (loader) loader.hide();
                showNotification(targetAccrualId ? 'Tahakkuk güncellendi ve görev tamamlandı.' : 'Tahakkuk oluşturuldu ve görev tamamlandı.', 'success');
                this.closeModal('completeAccrualTaskModal');
                await this.loadAllData();

            } catch (e) {
                if (loader) loader.hide();
                showNotification('Hata: ' + e.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async exportToExcel(mode) {
            let dataToExport = [];
            if (mode === 'selected') {
                if (this.selectedTaskIds.size === 0) { showNotification('Lütfen iş seçiniz.', 'warning'); return; }
                dataToExport = this.processedData.filter(item => this.selectedTaskIds.has(String(item.id)));
            } else {
                dataToExport = [...this.filteredData];
            }

            if (dataToExport.length === 0) { showNotification('Aktarılacak veri yok.', 'warning'); return; }

            let loader = window.showSimpleLoading ? window.showSimpleLoading('Excel Hazırlanıyor') : null;

            try {
                const loadScript = (src) => {
                    return new Promise((resolve, reject) => {
                        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                        const script = document.createElement('script');
                        script.src = src; script.onload = resolve; script.onerror = reject;
                        document.head.appendChild(script);
                    });
                };

                if (!window.ExcelJS) await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js');
                if (!window.saveAs) await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js');

                const workbook = new window.ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('İş Listesi');

                worksheet.columns = [
                    { header: 'İş No', key: 'id', width: 15 },
                    { header: 'İlgili Kayıt', key: 'relatedRecord', width: 30 },
                    { header: 'İş Tipi', key: 'taskTypeDisplay', width: 25 },
                    { header: 'Konu', key: 'title', width: 40 },
                    { header: 'Öncelik', key: 'priority', width: 12 },
                    { header: 'Atanan', key: 'assignedToDisplay', width: 25 },
                    { header: 'Operasyonel Son Tarih', key: 'operationalDueDisplay', width: 20 },
                    { header: 'Resmi Son Tarih', key: 'officialDueDisplay', width: 20 },
                    { header: 'Durum', key: 'statusText', width: 20 }
                ];

                const headerRow = worksheet.getRow(1);
                headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
                headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

                dataToExport.forEach(task => {
                    worksheet.addRow({
                        id: task.id,
                        relatedRecord: task.appNo,
                        taskTypeDisplay: task.taskTypeDisplay,
                        title: task.title || '-',
                        priority: task.priority,
                        assignedToDisplay: task.assignedToDisplay,
                        operationalDueDisplay: task.operationalDueDisplay,
                        officialDueDisplay: task.officialDueDisplay,
                        statusText: task.statusText
                    });
                });

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                window.saveAs(blob, `Is_Yonetimi_${new Date().toISOString().slice(0, 10)}.xlsx`);
                showNotification('Excel oluşturuldu.', 'success');
            } catch (error) {
                console.error(error);
                showNotification('Excel oluşturulamadı.', 'error');
            } finally {
                if (loader) loader.hide();
            }
        }

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            if(modalId === 'createTaskAccrualModal' && this.createTaskFormManager) this.createTaskFormManager.reset();
            if(modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) this.completeTaskFormManager.reset();
        }
    }

    new TaskManagementModule().init();
});