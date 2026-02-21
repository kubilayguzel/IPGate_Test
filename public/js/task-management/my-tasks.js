// public/js/task-management/my-tasks.js

import { authService, taskService, ipRecordsService, accrualService, personService, transactionTypeService, db } from '../../firebase-config.js';
import { showNotification, TASK_STATUS_MAP,formatToTRDate } from '../../utils.js';
import { loadSharedLayout } from '../layout-loader.js';
import Pagination from '../pagination.js'; 
import { TaskDetailManager } from '../components/TaskDetailManager.js';
import { AccrualFormManager } from '../components/AccrualFormManager.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


document.addEventListener('DOMContentLoaded', async () => {
    await loadSharedLayout({ activeMenuLink: 'my-tasks.html' });

    class MyTasksModule {
        constructor() {
            this.currentUser = null;
            this.storage = getStorage();

            this.allTasks = [];
            this.allIpRecords = [];
			// Hızlı join için Map (id -> ipRecord)
            this.allPersons = [];
            this.allUsers = []; // Kullanıcı listesi eklendi (Atamalar için)
            this.allAccruals = [];
            this.allTransactionTypes = [];

            this.processedData = [];
            this.filteredData = [];
            this.activeTab = 'active';

            // Varsayılan Sıralama: Oluşturulma Tarihi (Yeniden eskiye)
            this.sortState = { key: 'createdAtObj', direction: 'desc' };

            this.pagination = null;
            this.currentTaskForAccrual = null;

            this.taskDetailManager = null;
            
            // İki farklı form yöneticisi kullanıyoruz:
            this.accrualFormManager = null; // Ek Tahakkuk için
            this.completeTaskFormManager = null; // Tahakkuk İşini Tamamlamak için
            this.statusDisplayMap = TASK_STATUS_MAP;
            this.selectedTaskIds = new Set();
            this.tasksToAssign = [];
        }

        init() {
            this.taskDetailManager = new TaskDetailManager('modalBody');
            
            // 1. Ek Tahakkuk Formu Yöneticisi
            this.accrualFormManager = new AccrualFormManager('createMyTaskAccrualFormContainer', 'myTaskAcc');
            
            // 2. [YENİ] Tahakkuk Tamamlama Formu Yöneticisi
            this.completeTaskFormManager = new AccrualFormManager('completeAccrualFormContainer', 'comp');
            
            this.initializePagination();

            authService.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    await this.loadAllData();
                    this.setupEventListeners();
                    this.populateStatusFilterDropdown();
                } else {
                    window.location.href = 'index.html';
                }
            });
            // YENİ SEKMELERDE YAPILAN DÜZENLEMELERİ CANLI YAKALA
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
                // 1. Sadece görevleri çek
                const tasksResult = await taskService.getTasksForUser(this.currentUser.uid);
                this.allTasks = tasksResult.success ? tasksResult.data.filter(t => t.status !== 'awaiting_client_approval') : [];

                // 2. Sabit sözlükleri (Kişiler, Tipler, Kullanıcılar) çek (Eğer zaten çekilmediyse)
                // DİKKAT: Tahakkukları ve IP kayıtlarını buradan sildik!
                const fetchPromises = [];
                if (this.allPersons.length === 0) fetchPromises.push(personService.getPersons());
                if (this.allTransactionTypes.length === 0) fetchPromises.push(transactionTypeService.getTransactionTypes());
                if (this.allUsers.length === 0) fetchPromises.push(taskService.getAllUsers());

                const results = await Promise.all(fetchPromises);
                
                // Sonuçları dizilere ata (Eğer yeni çekildiyse)
                if (this.allPersons.length === 0) this.allPersons = results[0]?.success ? results[0].data : [];
                if (this.allTransactionTypes.length === 0) this.allTransactionTypes = results[1]?.success ? results[1].data : [];
                if (this.allUsers.length === 0) this.allUsers = results[2]?.success ? results[2].data : [];

                this.buildMaps(); // allIpRecords şu an boş, map temizlenecek
                
                // Form yöneticilerini güncelle
                this.accrualFormManager.allPersons = this.allPersons;
                this.accrualFormManager.render();
                if (this.completeTaskFormManager) {
                    this.completeTaskFormManager.allPersons = this.allPersons;
                    this.completeTaskFormManager.render();
                }

                // 3. Tabloyu "Yükleniyor..." durumlarıyla anında çiz!
                this.processData();

                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();

            } catch (error) {
                console.error(error);
                if (typeof showNotification === 'function') showNotification('Hata: ' + error.message, 'error');
                if (window.SimpleLoadingController) window.SimpleLoadingController.hide();
            }
        }
        buildMaps() {
        }

        processData(preservePage = false) {
        const safeDate = (val) => {
            if (!val) return null;
            try {
                if (typeof val.toDate === 'function') return val.toDate();
                if (val.seconds) return new Date(val.seconds * 1000);
                return new Date(val);
            } catch { return null; }
        };

        this.processedData = this.allTasks.map(task => {
            // 🔥 YENİ ALANLAR
            const appNo = task.iprecordApplicationNo || "-";
            const recordTitleDisplay = task.iprecordTitle || task.relatedIpRecordTitle || "-";
            const applicantName = task.iprecordApplicantName || "-";
            
            const transactionType = this.allTransactionTypes.find(t => t.id === task.taskType);
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

        // --- SIRALAMA (SORTING) FONKSİYONLARI ---
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
                    const numA = parseFloat(valA.replace(/[^0-9]/g, ''));
                    const numB = parseFloat(valB.replace(/[^0-9]/g, ''));
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

        // my-tasks.js içindeki handleSearch metodunu bununla değiştirin:

        handleSearch(query, preservePage = false) {
            const statusFilter = document.getElementById('statusFilter').value;
            const lowerQuery = (query || '').toLowerCase();

            // Aktif Kullanıcı Bilgileri
            const currentUserId = this.currentUser.uid;
            const currentUserEmail = this.currentUser.email;

            this.filteredData = this.processedData.filter(item => {
                // 1. Arama Metni Filtresi
                const matchesSearch = !lowerQuery || item.searchString.includes(lowerQuery);
                
                // 2. Dropdown Statü Filtresi
                const matchesStatusFilter = (statusFilter === 'all' || item.status === statusFilter);

                // 3. TAB FİLTRESİ
                let matchesTab = false;
                // Aktif kabul edilen statüler: Açık, Devam Ediyor, Beklemede
                const activeStatuses = ['open', 'in-progress', 'pending']; 

                if (this.activeTab === 'active') {
                    // Aktif İşler sekmesi: Sadece belirlenen 3 statü
                    matchesTab = activeStatuses.includes(item.status);
                } else {
                    // Biten/Kapatılan İşler sekmesi: Aktif statüler dışındaki her şey
                    matchesTab = !activeStatuses.includes(item.status);
                }

                // [DÜZELTME] Kullanıcı Filtresi Güncellendi
                // Artık assignedTo_uid alanını da kontrol ediyor.
                const assigneeId = item.assignedTo?.id || item.assignedTo;
                
                const isMyTask = (assigneeId === currentUserId) || 
                                 (item.assignedTo_uid === currentUserId) || // <-- EKLENEN KRİTİK SATIR
                                 (item.assignedToEmail === currentUserEmail) ||
                                 (item.assignedTo_email === currentUserEmail);

                return matchesSearch && matchesStatusFilter && matchesTab && isMyTask;
            });

            this.sortData();

            if (this.pagination) {
                // ESKİ: this.pagination.reset();
                if (!preservePage) { // YENİ
                    this.pagination.reset();
                }
                this.pagination.update(this.filteredData.length);
            }

            this.renderTasks();
            // this.enrichVisiblePage(); <-- BUNU SİLİN (Sonsuz döngü önlemi)
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
                    const updateData = { assignedTo_uid: uid, assignedTo_email: user.email };
                    const historyEntry = { 
                        action: `İş yeniden atandı: ${task.assignedTo_email || 'Atanmamış'} -> ${user.email}`, 
                        timestamp: new Date().toISOString(), 
                        userEmail: this.currentUser.email 
                    };
                    
                    let history = task.history ? [...task.history] : [];
                    history.push(historyEntry);
                    updateData.history = history;

                    return taskService.updateTask(task.id, updateData);
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
            // 👇 TAB DEĞİŞTİRME OLAYLARI 👇
            document.querySelectorAll('#taskTabs .nav-link').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    // Görsel Güncelleme (Active sınıfını değiştir)
                    document.querySelectorAll('#taskTabs .nav-link').forEach(t => {
                        t.classList.remove('active');
                        t.style.color = '#6c757d'; // Pasif renk
                    });
                    e.target.classList.add('active');
                    e.target.style.color = '#495057'; // Aktif renk

                    // Mantıksal Güncelleme
                    this.activeTab = e.target.dataset.tab;
                    
                    // Mevcut arama kriteriyle listeyi yenile
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
                    // 1. Tıklanan işi bul
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    // 2. İş tipi "Marka Başvurusu" (ID: 2) ise Özet Modalı aç
                    if (task && String(task.taskType) === '2') {
                        this.taskDetailManager.showApplicationSummary(task);
                    } 
                    // 3. Değilse standart Detay Modalı aç (Eski yöntem)
                    else {
                        this.showTaskDetailModal(taskId);
                    }
                } 
                else if (btn.classList.contains('edit-btn') || btn.dataset.action === 'edit') {
                    // [DÜZELTİLDİ] Görev tipine göre yönlendirme
                    const task = this.allTasks.find(t => t.id === taskId);
                    
                    // İş tipi '53' (Tahakkuk Oluşturma) ise merkezi modalı aç
                    if (task && (String(task.taskType) === '53' || task.taskType === 'accrual_creation')) {
                        console.log('💰 Tahakkuk düzenleme modalı açılıyor:', taskId);
                        this.openCompleteAccrualModal(taskId);
                    } else {
                        // Diğer tüm işler için standart güncelleme sayfasına git
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

            // [YENİ] Tahakkuk Tamamlama Modalı Butonları
            document.getElementById('cancelCompleteAccrualBtn')?.addEventListener('click', () => closeModal('completeAccrualTaskModal'));
            document.getElementById('submitCompleteAccrualBtn')?.addEventListener('click', () => this.handleCompleteAccrualSubmission());
            // Modal İptal/Kaydet ve Toplu Ata Butonu Dinleyicileri (setupEventListeners sonuna)
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
                // 🔥 YENİ: Dropdown İşlem Menüsü
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
                    <td>${task.assignedAtText}</td>
                    <td><span class="status-badge ${statusClass}">${task.statusText}</span></td>
                    <td class="text-center" style="overflow:visible;">
                        ${actionMenuHtml}
                    </td>
                `;
                tableBody.appendChild(row);
            });

            this.updateSortIcons();
            this.attachCheckboxListeners(); // YENİ: Dinleyicileri ekle
            if (window.$) $('.dropdown-toggle').dropdown();

            if (window.DeadlineHighlighter) {
                setTimeout(() => window.DeadlineHighlighter.refresh('islerim'), 50);
            }
        }

        populateStatusFilterDropdown() {
            const select = document.getElementById('statusFilter');
            if(!select) return;
            select.innerHTML = '<option value="all">Tümü</option>';

            // Manuel liste yerine TASK_STATUS_MAP üzerinden dönün:
            Object.entries(this.statusDisplayMap).forEach(([value, text]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                select.appendChild(opt);
            });
        }

        async showTaskDetailModal(taskId) { // <--- async eklendi
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task || !this.taskDetailManager) return;

            const modal = document.getElementById('taskDetailModal');
            const title = document.getElementById('modalTaskTitle');
            
            modal.classList.add('show');
            title.textContent = 'Yükleniyor...';
            this.taskDetailManager.showLoading();

            try {
                // SADECE BU İŞE AİT TAHAKKUKLARI DİNAMİK OLARAK ÇEK
                const { query, collection, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
                const qAccruals = query(collection(db, 'accruals'), where('taskId', '==', String(task.id)));
                const accSnap = await getDocs(qAccruals);
                const relatedAccruals = accSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // 🔥 YENİ: Detay açıldığında anlık portföy çekimi
                let ipRecord = null;
                if (task.relatedIpRecordId) {
                    try {
                        const ipSnap = await getDoc(doc(db, 'ipRecords', String(task.relatedIpRecordId)));
                        if (ipSnap.exists()) {
                            ipRecord = { id: ipSnap.id, ...ipSnap.data() };
                        } else {
                            const suitSnap = await getDoc(doc(db, 'suits', String(task.relatedIpRecordId)));
                            if (suitSnap.exists()) ipRecord = { id: suitSnap.id, ...suitSnap.data() };
                        }
                    } catch(e) { console.warn("Kayıt detayı çekilemedi:", e); }
                }
                const transactionType = this.allTransactionTypes.find(t => String(t.id) === String(task.taskType));
                const assignedUser = task.assignedTo_email ? { email: task.assignedTo_email, displayName: task.assignedTo_email } : null;

                title.textContent = `İş Detayı (${task.id})`;
                this.taskDetailManager.render(task, {
                    ipRecord, transactionType, assignedUser, accruals: relatedAccruals
                });
            } catch (e) {
                console.error("Detay yüklenemedi:", e);
                this.taskDetailManager.showError('Hata oluştu.');
            }
        }

        async showCreateAccrualModal(taskId) {
            this.currentTaskForAccrual = this.allTasks.find(t => t.id === taskId);
            if (!this.currentTaskForAccrual) return;
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
                
                // 🔥 ÇÖZÜM: Veritabanından Çek
                if (!parent) {
                    try {
                        const parentSnap = await getDoc(doc(db, 'tasks', String(parentId)));
                        if (parentSnap.exists()) parent = parentSnap.data();
                    } catch (e) { console.warn('Parent fetch error:', e); }
                }
                epatsDoc = getEpats(parent);
            }
            
            this.accrualFormManager.showEpatsDoc(epatsDoc);
            document.getElementById('createMyTaskAccrualModal').classList.add('show');
        }

        async handleSaveNewAccrual() { 
        if (!this.currentTaskForAccrual) return;

        // ✅ çift submit engeli (buton id'niz farklıysa düzenleyin)
        const btn = document.getElementById('saveNewAccrualBtn') || document.getElementById('submitNewAccrualBtn');
        if (btn) btn.disabled = true;

        const result = this.createTaskFormManager.getData();
        if (!result.success) { 
            showNotification(result.error, 'error'); 
            if (btn) btn.disabled = false;
            return; 
        }

        const formData = result.data;

        let loader = window.showSimpleLoading ? window.showSimpleLoading('Tahakkuk Kaydediliyor') : null;

        // ✅ FileList'i DB'ye yazmıyoruz; upload sonrası metadata yazıyoruz
        const { files, ...formDataNoFiles } = formData;

        let uploadedFiles = [];
        if (files && files.length > 0) {
            try {
                const file = files[0];
                const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                const url = await getDownloadURL(snapshot.ref);

                uploadedFiles.push({ 
                    name: file.name, 
                    url, 
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

        // ✅ En geniş payload: formDataNoFiles bazlı
        // Not: taskId / taskTitle ve status/remainingAmount gibi sistem alanlarını biz belirliyoruz.
        const newAccrual = {
            taskId: this.currentTaskForAccrual.id,
            taskTitle: this.currentTaskForAccrual.title,

            ...formDataNoFiles,

            // ✅ normalize: boş string -> null
            tpeInvoiceNo: formDataNoFiles.tpeInvoiceNo?.trim() || null,
            evrekaInvoiceNo: formDataNoFiles.evrekaInvoiceNo?.trim() || null,

            // ✅ currency: formdan gelmiyorsa TRY fallback (istersen kaldır)
            totalAmountCurrency: formDataNoFiles.totalAmountCurrency || 'TRY',

            // ✅ kalan tutar ilk oluşturma anında total ile başlar
            remainingAmount: formDataNoFiles.totalAmount,

            status: 'unpaid',
            createdAt: new Date().toISOString(),

            files: uploadedFiles
        };

        try {
            const res = await accrualService.addAccrual(newAccrual);
            if (loader) loader.hide();

            if (res.success) { 
                showNotification('Ek tahakkuk başarıyla oluşturuldu!', 'success'); 
                this.closeModal('createTaskAccrualModal'); 
                await this.loadAllData(); 
            } else { 
                showNotification('Hata: ' + res.error, 'error'); 
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
                    return (t.details && t.details.epatsDocument) || t.epatsDocument || null;
                };

                let epatsDoc = getEpats(task);
                const parentId = task.relatedTaskId || task.associatedTaskId || task.triggeringTaskId;

                if (!epatsDoc && parentId) {
                    let parent = this.allTasks.find(t => String(t.id) === String(parentId));
                    
                    // 🔥 ÇÖZÜM: Veritabanından Çek
                    if (!parent) {
                        try {
                            const parentSnap = await getDoc(doc(db, 'tasks', String(parentId)));
                            if (parentSnap.exists()) {
                                parent = parentSnap.data();
                            }
                        } catch (e) { console.warn('Parent task fetch error:', e); }
                    }
                    epatsDoc = getEpats(parent);
                }
                
                this.completeTaskFormManager.showEpatsDoc(epatsDoc);
                
                const targetAccrualId = task.details?.targetAccrualId;
                if (targetAccrualId) {
                    try {
                        const accRef = doc(db, 'accruals', String(targetAccrualId));
                        const accSnap = await getDoc(accRef);
                        if (accSnap.exists()) {
                            this.completeTaskFormManager.setData(accSnap.data());
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

            // ✅ çift submit engeli
            const btn = document.getElementById('submitCompleteAccrualBtn');
            if (btn) btn.disabled = true;

            const result = this.completeTaskFormManager.getData();
            if (!result.success) {
                showNotification(result.error, 'error');
                if (btn) btn.disabled = false;
                return;
            }

            const formData = result.data;
            const { files, ...formDataNoFiles } = formData; // FileList DB'ye gitmesin

            let loader = window.showSimpleLoading ? window.showSimpleLoading('İşlem Tamamlanıyor') : null;

            // Dosya upload
            let uploadedFiles = [];
            if (files && files.length > 0) {
                try {
                    const file = files[0];
                    const storageRef = ref(this.storage, `accruals/foreign_invoices/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const url = await getDownloadURL(snapshot.ref);
                    uploadedFiles.push({
                        name: file.name,
                        url,
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

            // ✅ En geniş payload: AccrualFormManager çıktısını baz al
            const basePayload = {
                taskId: task.relatedTaskId || taskId,
                taskTitle: cleanTitle,
                ...formDataNoFiles,

                // normalize: boş string yerine null
                tpeInvoiceNo: formDataNoFiles.tpeInvoiceNo?.trim() || null,
                evrekaInvoiceNo: formDataNoFiles.evrekaInvoiceNo?.trim() || null
            };

            const targetAccrualId = task.details?.targetAccrualId;

            try {
                // 1) UPDATE yolu: targetAccrualId varsa yeni tahakkuk açma!
                if (targetAccrualId) {
                    const accRef = doc(db, 'accruals', String(targetAccrualId));
                    const accSnap = await getDoc(accRef);
                    if (!accSnap.exists()) throw new Error('Güncellenecek tahakkuk bulunamadı.');

                    const existing = accSnap.data();
                    const mergedFiles = uploadedFiles.length > 0
                        ? [ ...(existing.files || []), ...uploadedFiles ]
                        : (existing.files || []);

                    // remainingAmount’ı güvenli güncelle (eski remainingAmount = eski totalAmount ise yeni total’a eşitle)
                    let remainingAmountUpdate = {};
                    try {
                        const sameRemaining =
                            JSON.stringify(existing.remainingAmount || null) === JSON.stringify(existing.totalAmount || null);
                        if (sameRemaining) remainingAmountUpdate = { remainingAmount: basePayload.totalAmount };
                    } catch (_) {}

                    const updates = {
                        ...basePayload,
                        files: mergedFiles,
                        ...remainingAmountUpdate
                        // createdAt/createdBy/status gibi alanları bilerek set etmiyoruz
                    };

                    const updRes = await accrualService.updateAccrual(String(targetAccrualId), updates);
                    if (!updRes.success) throw new Error(updRes.error);

                } else {
                    // 2) ADD yolu: targetAccrualId yoksa yeni tahakkuk oluştur
                    const newAccrual = {
                        ...basePayload,
                        status: 'unpaid',
                        remainingAmount: basePayload.totalAmount,
                        files: uploadedFiles
                    };

                    const addRes = await accrualService.addAccrual(newAccrual);
                    if (!addRes.success) throw new Error(addRes.error);

                    // ✅ yeni oluşan tahakkuk id’sini task.details.targetAccrualId olarak yaz
                    await taskService.updateTask(taskId, {
                        details: { ...(task.details || {}), targetAccrualId: addRes.data.id }
                    });
                }

                // Görevi kapat
                const updateData = {
                    status: 'completed',
                    updatedAt: new Date().toISOString(),
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
            
            // Modallar kapanırken formları sıfırla
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