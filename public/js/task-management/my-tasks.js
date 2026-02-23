// public/js/task-management/my-tasks.js

import { authService, taskService, ipRecordsService, personService, transactionTypeService, supabase } from '../../supabase-config.js';
import { showNotification, TASK_STATUS_MAP, formatToTRDate } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'my-tasks.html' });

    class MyTasksModule {
        constructor() {
            this.currentUser = null;

            this.allTasks = [];
            this.allIpRecords = [];
            this.allPersons = [];
            this.allUsers = []; 
            this.allAccruals = [];
            this.allTransactionTypes = [];

            this.processedData = [];
            this.filteredData = [];
            this.activeTab = 'active';

            this.sortState = { key: 'createdAtObj', direction: 'desc' };

            this.pagination = null;
            this.currentTaskForAccrual = null;

            this.taskDetailManager = null;
            
            this.accrualFormManager = null; 
            this.completeTaskFormManager = null; 
            this.statusDisplayMap = TASK_STATUS_MAP;
            this.selectedTaskIds = new Set();
            this.tasksToAssign = [];
        }

        init() {
            this.taskDetailManager = new TaskDetailManager('modalBody');
            this.accrualFormManager = new AccrualFormManager('createMyTaskAccrualFormContainer', 'myTaskAcc');
            this.completeTaskFormManager = new AccrualFormManager('completeAccrualFormContainer', 'comp');
            
            this.initializePagination();

            // Supabase Auth Dinleyicisi
            authService.isSupabaseAvailable = true; // Flag varsa diye
            const user = authService.getCurrentUser();
            if (user) {
                this.currentUser = user;
                this.loadAllData().then(() => {
                    this.setupEventListeners();
                    this.populateStatusFilterDropdown();
                });
            } else {
                window.location.href = 'index.html';
            }

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
                containerId: 'paginationControls',
                itemsPerPage: 10,
                itemsPerPageOptions: [10, 25, 50, 100],
                onPageChange: async () => {
                    this.renderTasks();
                }
            });
        }

        async loadAllData() {
            if (window.SimpleLoadingController) {
                window.SimpleLoadingController.show({
                    text: 'İşleriniz Hazırlanıyor',
                    subtext: 'Verileriniz optimize ediliyor, lütfen bekleyiniz...'
                });
            }
            const loader = document.getElementById('loadingIndicator');
            if(loader) loader.style.display = 'none';

            try {
                // Supabase Service üzerinden çekiyoruz
                const tasksResult = await taskService.getTasksForUser(this.currentUser.uid);
                this.allTasks = tasksResult.success ? tasksResult.data.filter(t => t.status !== 'awaiting_client_approval') : [];

                const fetchPromises = [];
                if (this.allPersons.length === 0) fetchPromises.push(personService.getPersons());
                if (this.allTransactionTypes.length === 0) fetchPromises.push(transactionTypeService.getTransactionTypes());
                if (this.allUsers.length === 0) fetchPromises.push(taskService.getAllUsers());

                const results = await Promise.all(fetchPromises);
                
                if (this.allPersons.length === 0) this.allPersons = results[0]?.success ? results[0].data : [];
                if (this.allTransactionTypes.length === 0) this.allTransactionTypes = results[1]?.success ? results[1].data : [];
                if (this.allUsers.length === 0) this.allUsers = results[2]?.success ? results[2].data : [];

                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();
                if (this.completeTaskFormManager) {
                    this.completeTaskFormManager.allPersons = this.allPersons;
                    this.completeTaskFormManager.render();
                }

                this.processData();

                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();

            } catch (error) {
                console.error(error);
                if (typeof showNotification === 'function') showNotification('Hata: ' + error.message, 'error');
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            }
        }

        processData(preservePage = false) {
            const safeDate = (val) => {
                if (!val) return null;
                try {
                    return new Date(val);
                } catch { return null; }
            };

            this.processedData = this.allTasks.map(task => {
                const appNo = task.iprecordApplicationNo || task.details?.iprecordApplicationNo || "-";
                const recordTitleDisplay = task.iprecordTitle || task.details?.iprecordTitle || task.relatedIpRecordTitle || "-";
                const applicantName = task.iprecordApplicantName || task.details?.iprecordApplicantName || "-";
                
                const transactionType = this.allTransactionTypes.find(t => String(t.id) === String(task.taskType));
                const taskTypeDisplay = transactionType ? (transactionType.alias || transactionType.name) : 'Bilinmiyor';
                const statusText = this.statusDisplayMap[task.status] || task.status;

                const searchString = `${task.id} ${task.title || ''} ${appNo} ${recordTitleDisplay} ${applicantName} ${taskTypeDisplay} ${statusText}`.toLowerCase();

                return {
                    ...task,
                    appNo,
                    recordTitleDisplay,
                    applicantName,
                    relatedRecordDisplay: appNo,
                    taskTypeDisplay,
                    statusText,
                    searchString,
                    dueDateObj: safeDate(task.dueDate),
                    officialDueObj: safeDate(task.officialDueDate),
                    createdAtObj: safeDate(task.createdAt)
                };
            });

            const currentQuery = document.getElementById('taskSearchInput')?.value || '';
            this.handleSearch(currentQuery, preservePage);
        }

        handleSort(key) {
            if (this.sortState.key === key) {
                this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortState.key = key;
                this.sortState.direction = 'asc';
            }
            this.sortData();
            this.renderTasks();
        }

        sortData() {
            const { key, direction } = this.sortState;
            const multiplier = direction === 'asc' ? 1 : -1;

            this.filteredData.sort((a, b) => {
                let valA = a[key];
                let valB = b[key];

                if (valA == null) valA = '';
                if (valB == null) valB = '';

                if (valA instanceof Date && valB instanceof Date) {
                    return (valA - valB) * multiplier;
                }
                if (valA instanceof Date) return -1 * multiplier; 
                if (valB instanceof Date) return 1 * multiplier;

                if (key === 'id') {
                    const numA = parseFloat(valA.toString().replace(/[^0-9]/g, ''));
                    const numB = parseFloat(valB.toString().replace(/[^0-9]/g, ''));
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return (numA - numB) * multiplier;
                    }
                }

                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
                return valA.localeCompare(valB, 'tr') * multiplier;
            });
        }

        updateSortIcons() {
            document.querySelectorAll('#myTasksTable thead th[data-sort]').forEach(th => {
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

        handleSearch(query, preservePage = false) {
            const statusFilter = document.getElementById('statusFilter').value;
            const lowerQuery = (query || '').toLowerCase();

            const currentUserId = this.currentUser.uid;
            const currentUserEmail = this.currentUser.email;

            this.filteredData = this.processedData.filter(item => {
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                const matchesStatusFilter = (statusFilter === 'all' || item.status === statusFilter);

                let matchesTab = false;
                const activeStatuses = ['open', 'in-progress', 'pending']; 

                if (this.activeTab === 'active') {
                    matchesTab = activeStatuses.includes(item.status);
                } else {
                    matchesTab = !activeStatuses.includes(item.status);
                }

                const assigneeId = item.assignedTo?.id || item.assignedTo_uid || item.assignedTo;
                
                const isMyTask = (assigneeId === currentUserId) || 
                                 (item.assignedToEmail === currentUserEmail) ||
                                 (item.assignedTo_email === currentUserEmail);

                return matchesSearch && matchesStatusFilter && matchesTab && isMyTask;
            });

            this.sortData();

            if (this.pagination) {
                if (!preservePage) {
                    this.pagination.reset();
                }
                this.pagination.update(this.filteredData.length);
            }

            this.renderTasks();
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

        openAssignTaskModal(taskId = null) {
            this.tasksToAssign = [];
            if (taskId) {
                const t = this.allTasks.find(task => task.id === String(taskId));
                if(t) this.tasksToAssign.push(t);
            } else {
                this.tasksToAssign = this.allTasks.filter(t => this.selectedTaskIds.has(String(t.id)));
            }

            if (this.tasksToAssign.length === 0) { 
                showNotification('Atanacak iş bulunamadı veya seçilmedi.', 'error'); 
                return; 
            }

            const select = document.getElementById('newAssignedTo');
            if (select) {
                select.innerHTML = '<option value="">Seçiniz...</option>';
                this.allUsers.forEach(user => {
                    const opt = document.createElement('option');
                    opt.value = user.id;
                    opt.textContent = user.displayName || user.email;
                    if (this.tasksToAssign.length === 1 && user.id === this.tasksToAssign[0].assignedTo_uid) {
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
            const user = this.allUsers.find(u => u.id === uid);

            try {
                const assignPromises = this.tasksToAssign.map(task => {
                    const historyEntry = { 
                        action: `İş yeniden atandı: ${task.assignedTo_email || 'Atanmamış'} -> ${user.email}`, 
                        timestamp: new Date().toISOString(), 
                        userEmail: this.currentUser.email 
                    };
                    
                    let history = task.history ? [...task.history] : [];
                    history.push(historyEntry);

                    return taskService.updateTask(task.id, {
                        ...task, // Diğer tüm veriler korunur
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

        setupEventListeners() {
            document.querySelectorAll('#taskTabs .nav-link').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    document.querySelectorAll('#taskTabs .nav-link').forEach(t => {
                        t.classList.remove('active');
                        t.style.color = '#6c757d'; 
                    });
                    e.target.classList.add('active');
                    e.target.style.color = '#495057';

                    this.activeTab = e.target.dataset.tab;
                    const currentQuery = document.getElementById('taskSearchInput').value;
                    this.handleSearch(currentQuery);
                });
            });

            document.getElementById('taskSearchInput').addEventListener('input', (e) => this.handleSearch(e.target.value));
            document.getElementById('statusFilter').addEventListener('change', () => {
                const query = document.getElementById('taskSearchInput').value;
                this.handleSearch(query);
            });
            
            const headers = document.querySelectorAll('#myTasksTable thead th[data-sort]');
            headers.forEach(th => {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.handleSort(th.dataset.sort);
                });
            });

            document.getElementById('myTasksTableBody').addEventListener('click', (e) => {
                const btn = e.target.closest('.action-btn');
                if (!btn) return;
                e.preventDefault();
                const taskId = btn.dataset.id;
                
                if (btn.classList.contains('view-btn') || btn.dataset.action === 'view') {
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    if (task && String(task.taskType) === '2') {
                        this.taskDetailManager.showApplicationSummary(task);
                    } else {
                        this.showTaskDetailModal(taskId);
                    }
                } 
                else if (btn.classList.contains('edit-btn') || btn.dataset.action === 'edit') {
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                        console.log('💰 Tahakkuk düzenleme modalı açılıyor:', taskId);
                        this.openCompleteAccrualModal(taskId);
                    } else {
                        window.location.href = `task-update.html?id=${taskId}`;
                    }
                }
                else if (btn.classList.contains('assign-btn')) {
                    this.openAssignTaskModal(taskId);
                }
                else if (btn.classList.contains('add-accrual-btn')) {
                    this.showCreateAccrualModal(taskId);
                }
            });

            const closeModal = (id) => this.closeModal(id);
            
            document.getElementById('closeTaskDetailModal')?.addEventListener('click', () => closeModal('taskDetailModal'));
            document.getElementById('closeMyTaskAccrualModal')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('cancelCreateMyTaskAccrualBtn')?.addEventListener('click', () => closeModal('createMyTaskAccrualModal'));
            document.getElementById('saveNewMyTaskAccrualBtn')?.addEventListener('click', () => this.handleSaveNewAccrual());

            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
            document.getElementById('batchAssignBtn')?.addEventListener('click', () => this.openAssignTaskModal());
            document.getElementById('cancelAssignmentBtn')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('closeAssignTaskModal')?.addEventListener('click', () => this.closeModal('assignTaskModal'));
            document.getElementById('saveNewAssignmentBtn')?.addEventListener('click', () => this.saveNewAssignment());
        }

        renderTasks() {
            const tableBody = document.getElementById('myTasksTableBody');
            const noTasksMessage = document.getElementById('noTasksMessage');
            tableBody.innerHTML = '';

            if (this.filteredData.length === 0) {
                if(noTasksMessage) noTasksMessage.style.display = 'block';
                return;
            }
            if(noTasksMessage) noTasksMessage.style.display = 'none';

            let displayData = this.filteredData;
            if (this.pagination) {
                displayData = this.pagination.getCurrentPageData(this.filteredData);
            }

            displayData.forEach(task => {
                const statusClass = `status-${(task.status || '').replace(/ /g, '_').toLowerCase()}`;
                const priorityClass = `priority-${(task.priority || 'normal').toLowerCase()}`;

                const dueDateISO = task.dueDateObj ? task.dueDateObj.toISOString().slice(0,10) : '';
                const officialDueISO = task.officialDueObj ? task.officialDueObj.toISOString().slice(0,10) : '';
                
                const actionMenuHtml = `
                    <div class="dropdown">
                        <button class="btn btn-sm btn-light text-secondary rounded-circle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-ellipsis-v" style="pointer-events: none;"></i>
                        </button>
                        
                        <div class="dropdown-menu dropdown-menu-right shadow-sm border-0 p-2" style="min-width: auto;">
                            <div class="d-flex justify-content-center align-items-center" style="gap: 5px;">
                                <button class="btn btn-sm btn-light text-primary view-btn action-btn" data-id="${task.id}" data-action="view" title="Görüntüle">
                                    <i class="fas fa-eye" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-warning edit-btn action-btn" data-id="${task.id}" data-action="edit" title="Düzenle">
                                    <i class="fas fa-edit" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-info assign-btn action-btn" data-id="${task.id}" title="Başkasına Ata">
                                    <i class="fas fa-user-plus" style="pointer-events: none;"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-success add-accrual-btn action-btn" data-id="${task.id}" title="Ek Tahakkuk Ekle">
                                    <i class="fas fa-file-invoice-dollar" style="pointer-events: none;"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><input type="checkbox" class="task-checkbox" value="${task.id}" ${this.selectedTaskIds.has(task.id) ? 'checked' : ''}></td>
                    <td>${task.id}</td>
                    <td>
                        <div class="font-weight-bold text-primary">${task.appNo}</div>
                        <div class="small text-dark">${task.recordTitleDisplay}</div>
                        <div class="small text-muted" style="font-size: 0.8em;">${task.applicantName}</div>
                    </td>
                    <td>${task.taskTypeDisplay}</td>
                    <td><span class="priority-badge ${priorityClass}">${task.priority}</span></td>
                    <td data-field="operationalDue" data-date="${dueDateISO}">
                        ${formatToTRDate(task.dueDateObj)} 
                    </td>
                    <td data-field="officialDue" data-date="${officialDueISO}">
                        ${formatToTRDate(task.officialDueObj)}
                    </td>
                    <td>${formatToTRDate(task.createdAtObj)}</td>
                    <td>${task.assignedTo_email || '-'}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td class="text-center" style="overflow:visible;">
                        ${actionMenuHtml}
                    </td>
                `;
                tableBody.appendChild(row);
            });

            this.updateSortIcons();
            this.attachCheckboxListeners();
            if (window.$) $('.dropdown-toggle').dropdown();

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('islerim'), 50);
            }
        }

        populateStatusFilterDropdown() {
            const select = document.getElementById('statusFilter');
            if(!select) return;
            select.innerHTML = '<option value="all">Tümü</option>';

            Object.entries(this.statusDisplayMap).forEach(([value, text]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                select.appendChild(opt);
            });
        }

        async showTaskDetailModal(taskId) {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task || !this.taskDetailManager) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            try {
                // Supabase Tahakkuk Çekimi
                const { data: relatedAccruals } = await supabase
                    .from('accruals')
                    .select('*')
                    .eq('task_id', String(task.id));

                let ipRecord = null;
                if (task.relatedIpRecordId) {
                    try {
                        const { data: ipData } = await supabase.from('ip_records').select('*').eq('id', task.relatedIpRecordId).single();
                        if (ipData) {
                            ipRecord = { id: ipData.id, ...ipData.details, ...ipData };
                        } else {
                            const { data: suitData } = await supabase.from('suits').select('*').eq('id', task.relatedIpRecordId).single();
                            if (suitData) ipRecord = { id: suitData.id, ...suitData.details, ...suitData };
                        }
                    } catch(e) { console.warn("Kayıt detayı çekilemedi:", e); }
                }
                const transactionType = this.allTransactionTypes.find(t => String(t.id) === String(task.taskType));
                const assignedUser = task.assignedTo_email ? { email: task.assignedTo_email, displayName: task.assignedTo_email } : null;

                title.textContent = `İş Detayı (${task.id})`;
                this.taskDetailManager.render(task, {
                    ipRecord, transactionType, assignedUser, accruals: relatedAccruals || []
                });
            } catch (e) {
                console.error("Detay yüklenemedi:", e);
                this.taskDetailManager.showError('Hata oluştu.');
            }
        }

        async showCreateAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;
            
            if (this.accrualFormManager) this.accrualFormManager.reset();
            
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
                    } catch (e) { console.warn('Parent fetch error:', e); }
                }
                epatsDoc = getEpats(parent);
            }
            
            this.accrualFormManager.showEpatsDoc(epatsDoc);
            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() { 
            if (!this.currentTaskForAccrual) return;

            const btn = document.getElementById('saveNewMyTaskAccrualBtn') || document.getElementById('submitNewAccrualBtn');
            if (btn) btn.disabled = true;

            const result = this.accrualFormManager.getData();
            if (!result.success) { 
                showNotification(result.error, 'error'); 
                if (btn) btn.disabled = false;
                return; 
            }

            const formData = result.data;
            let loader = window.showSimpleLoading ? window.showSimpleLoading('Tahakkuk Kaydediliyor') : null;

            const { files, ...formDataNoFiles } = formData;
            let uploadedFiles = [];
            
            // Supabase Storage Upload
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

            // Supabase Veritabanı Kayıt Formatı
            const newAccrual = {
                task_id: this.currentTaskForAccrual.id,
                status: 'unpaid',
                created_at: new Date().toISOString(),
                evreka_invoice_no: formDataNoFiles.evrekaInvoiceNo?.trim() || null,
                tpe_invoice_no: formDataNoFiles.tpeInvoiceNo?.trim() || null,
                files: uploadedFiles, // 🔥 YENİ KÖPRÜ: Dosyaları Supabase'in ana 'files' sütununa yaz!
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
                    this.closeModal('createMyTaskAccrualModal'); 
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

            const taskIdInput = document.getElementById('targetTaskIdForCompletion');
            if(taskIdInput) taskIdInput.value = taskId;

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
                        } catch (e) { console.warn('Parent task fetch error:', e); }
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
                    } catch (e) {
                        console.warn('Target accrual fetch error:', e);
                    }
                }
            }

            const modal = document.getElementById('completeAccrualTaskModal');
            if(modal) modal.classList.add('show');
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
                    const mergedFiles = uploadedFiles.length > 0
                        ? [ ...(existingDetails.files || []), ...uploadedFiles ]
                        : (existingDetails.files || []);

                    let remainingAmountUpdate = {};
                    try {
                        const sameRemaining = JSON.stringify(existingDetails.remainingAmount || null) === JSON.stringify(existingDetails.totalAmount || null);
                        if (sameRemaining) remainingAmountUpdate = { remainingAmount: basePayload.details.totalAmount };
                    } catch (_) {}

                    const updates = {
                        ...basePayload,
                        files: mergedFiles,
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
                    const newAccrual = { 
                        ...basePayload, 
                        status: 'unpaid',
                        files: uploadedFiles // 🔥 YENİ KÖPRÜ: Yeni tahakkukta ana sütuna yaz!
                    };
                    newAccrual.details.remainingAmount = basePayload.details.totalAmount;
                    newAccrual.details.files = uploadedFiles;

                    const { data: addRes, error: addErr } = await supabase.from('accruals').insert(newAccrual).select('id').single();
                    if (addErr) throw new Error(addErr.message);

                    // Tahakkuk ID'sini Task Details'e yaz
                    await taskService.updateTask(taskId, {
                        ...task,
                        details: { ...(task.details || {}), targetAccrualId: addRes.id }
                    });
                }

                // Görevi kapat
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

        closeModal(modalId) {
            const m = document.getElementById(modalId);
            if(m) m.classList.remove('show');
            
            if (modalId === 'createMyTaskAccrualModal' && this.accrualFormManager) {
                this.accrualFormManager.reset();
                this.currentTaskForAccrual = null;
            }
            if (modalId === 'completeAccrualTaskModal' && this.completeTaskFormManager) {
                this.completeTaskFormManager.reset();
            }
        }
    }

    new MyTasksModule().init();

    if (window.DeadlineHighlighter) {
        window.DeadlineHighlighter.init();
        window.DeadlineHighlighter.registerList('islerim', {
            container: '#myTasksTable',
            rowSelector: 'tbody tr',
            dateFields: [
                { name: 'operationalDue', selector: '[data-field="operationalDue"]' },
                { name: 'officialDue',    selector: '[data-field="officialDue"]' }
            ],
            strategy: 'earliest',
            applyTo: 'row',
            showLegend: true
        });
    }
});