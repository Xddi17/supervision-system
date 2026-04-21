/**
 * 督办管理系统 - 前端应用
 * 单页应用，全部通过 /api/* 接口获取数据
 */
(function () {
  'use strict';

  // ─── 全局状态 ───────────────────────────────────────
  const S = {
    token: localStorage.getItem('sv_token') || '',
    user: null,
    tasks: [],
    units: [],       // 标准单位名单
    allUsers: [],
    pendingUsers: [],
    logsPage: 0,
    logsTotal: 0,
  };

  const PAGE_SIZE_LOGS = 50;

  // ─── DOM refs ───────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  const loginPage    = $('#login-page');
  const registerPage = $('#register-page');
  const mainApp      = $('#main-app');

  // ─── API helpers ────────────────────────────────────
  function headers(extra) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (S.token) h['Authorization'] = 'Bearer ' + S.token;
    return h;
  }

  async function api(method, url, body) {
    const opts = { method, headers: headers() };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || '请求失败';
      if (res.status === 401) { logout(); throw new Error(msg); }
      throw new Error(msg);
    }
    return data;
  }

  async function apiUpload(url, formData, method = 'POST') {
    const h = {};
    if (S.token) h['Authorization'] = 'Bearer ' + S.token;
    const res = await fetch(url, { method, headers: h, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '上传失败');
    return data;
  }

  // ─── Toast ──────────────────────────────────────────
  function toast(msg, type = '') {
    const c = $('#toast-container');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.remove(); }, 3500);
  }

  // ─── Modal helpers ──────────────────────────────────

  // ─── Mobile sidebar ────────────────────────────────
  function toggleMobileSidebar() {
    const sb = $('#sidebar');
    const ov = $('#sidebar-overlay');
    sb.classList.toggle('open');
    ov.classList.toggle('open');
  }
  function closeMobileSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('open');
  }

  // ─── Modal helpers (cont) ─────────────────────────
  function openModal(id) { $('#' + id).classList.add('open'); }
  function closeModal(id) { $('#' + id).classList.remove('open'); }

  // close on backdrop click
  $$('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov) {
        if (ov._forceMode) { toast('请先修改密码', 'error'); return; }
        closeModal(ov.id);
      }
    });
  });
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = $('#' + btn.dataset.close);
      if (modal && modal._forceMode) { toast('请先修改密码', 'error'); return; }
      closeModal(btn.dataset.close);
    });
  });

  // ─── HTML escape ────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function statusBadge(status) {
    const map = {
      '已完成': 'badge-success',
      '预完成': 'badge-success-light',
      '推进中': 'badge-warning',
      '临期': 'badge-orange',
      '超期': 'badge-danger',
      '终止': 'badge-gray',
      // 兼容旧数据
      '已超期': 'badge-danger',
      '已终止': 'badge-gray',
    };
    return `<span class="badge ${map[status] || 'badge-gray'}">${esc(status || '推进中')}</span>`;
  }

  function formatDate(d) {
    if (!d) return '';
    return String(d).slice(0, 10);
  }

  function formatTime(d) {
    if (!d) return '';
    return String(d).replace('T', ' ').slice(0, 16);
  }

  // ─── Auth flow ──────────────────────────────────────
  function showLogin() {
    loginPage.classList.remove('hidden');
    registerPage.classList.add('hidden');
    mainApp.classList.add('hidden');
  }

  function showRegister() {
    loginPage.classList.add('hidden');
    registerPage.classList.remove('hidden');
    mainApp.classList.add('hidden');
  }

  function showMain() {
    loginPage.classList.add('hidden');
    registerPage.classList.add('hidden');
    mainApp.classList.remove('hidden');
    $('#topbar-user').textContent = S.user.name || S.user.username;

    // admin-only visibility
    const isAdmin = S.user.role === 'admin';
    $$('.admin-only').forEach(el => {
      if (isAdmin) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });

    navigateTo('dashboard');
  }

  async function tryAutoLogin() {
    if (!S.token) return showLogin();
    try {
      const data = await api('GET', '/api/auth/me');
      S.user = data.user;
      showMain();
      if (S.user.forcePasswordChange) {
        toast('您需要修改默认密码后才能继续使用系统', 'error');
        setTimeout(() => openForceChangePwd(), 300);
      }
    } catch {
      S.token = '';
      localStorage.removeItem('sv_token');
      showLogin();
    }
  }

  async function login(username, password) {
    const data = await api('POST', '/api/auth/login', { username, password });
    S.token = data.token;
    S.user = data.user;
    localStorage.setItem('sv_token', S.token);

    // 强制改密检查
    if (S.user.forcePasswordChange) {
      showMain();
      toast('您需要修改默认密码后才能继续使用系统', 'error');
      setTimeout(() => {
        openForceChangePwd();
      }, 300);
    } else {
      showMain();
      toast('登录成功', 'success');
    }
  }

  function logout() {
    api('POST', '/api/auth/logout').catch(() => {});
    S.token = '';
    S.user = null;
    localStorage.removeItem('sv_token');
    showLogin();
  }

  // ─── Navigation ─────────────────────────────────────
  function navigateTo(page) {
    $$('.page').forEach(p => p.classList.remove('active'));
    $$('.sidebar .nav-item').forEach(n => n.classList.remove('active'));

    const target = $('#page-' + page);
    if (target) target.classList.add('active');

    const navItem = $(`.sidebar .nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // load data
    switch (page) {
      case 'dashboard': loadDashboard(); break;
      case 'tasks':     loadTasks(); break;
      case 'stats':     loadStats(); break;
      case 'users':     loadUsers(); break;
      case 'units':     loadUnits(); break;
      case 'logs':      S.logsPage = 0; loadLogs(); break;
    }
  }

  // ─── Dashboard ──────────────────────────────────────
  async function loadDashboard() {
    try {
      const data = await api('GET', '/api/dashboard');
      const grid = $('#dash-stats');
      grid.innerHTML = `
        <div class="stat-card"><div class="stat-value">${data.taskTotal}</div><div class="stat-label">任务总数</div></div>
        <div class="stat-card success"><div class="stat-value">${data.taskCompleted}</div><div class="stat-label">已完成</div></div>
        <div class="stat-card warning"><div class="stat-value">${data.taskInProgress}</div><div class="stat-label">推进中</div></div>
        <div class="stat-card danger"><div class="stat-value">${data.taskOverdue}</div><div class="stat-label">已超期</div></div>
        ${S.user.role === 'admin' ? `<div class="stat-card info"><div class="stat-value">${data.pendingUsers}</div><div class="stat-label">待审核用户</div></div>` : ''}
      `;
      const list = $('#dash-recent');
      if (!data.recentTasks || data.recentTasks.length === 0) {
        list.innerHTML = '<li class="empty-state"><p>暂无任务数据</p></li>';
      } else {
        list.innerHTML = data.recentTasks.map(t => `
          <li>
            <div class="task-info">
              <div class="task-title">${esc(t.task_no ? '[' + t.task_no + '] ' : '')}${esc(t.task_content)}</div>
              <div class="task-meta">${esc(t.responsible_unit)} | ${formatTime(t.updated_at)}</div>
            </div>
            ${statusBadge(t.completion_status)}
          </li>`).join('');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Tasks ──────────────────────────────────────────
  async function loadTasks() {
    try {
      const params = new URLSearchParams();
      const unitVal = $('#filter-unit').value;
      const statusVal = $('#filter-status').value;
      const kwVal = $('#filter-keyword').value.trim();
      if (unitVal) params.set('unit', unitVal);
      if (statusVal) params.set('status', statusVal);
      if (kwVal) params.set('keyword', kwVal);

      const data = await api('GET', '/api/tasks?' + params.toString());
      S.tasks = data.tasks || [];

      // populate filter unit dropdown
      populateFilterUnits();
      renderTaskTable();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function populateFilterUnits() {
    const sel = $('#filter-unit');
    const current = sel.value;
    const units = [...new Set(S.tasks.map(t => t.responsible_unit).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">全部</option>' + units.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    sel.value = current;
  }

  function renderTaskTable() {
    const isAdmin = S.user && S.user.role === 'admin';
    const tbody = $('#task-tbody');
    const colCount = 11; // 10 data columns + 1 operations column

    if (S.tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state"><p>暂无督办任务</p></td></tr>`;
      $('#task-count').textContent = '0';
      return;
    }

    tbody.innerHTML = S.tasks.map(t => {
      const attCount = (t.attachments || []).length;
      // Admin: all fields are editable-cell; Normal user: top fields locked, bottom fields editable
      const lockCls = isAdmin ? 'editable-cell' : 'locked-cell';
      return `<tr data-task-id="${t.id}">
        <td class="${lockCls}" data-field="responsible_unit">${esc(t.responsible_unit)}</td>
        <td class="${lockCls}" data-field="task_content" style="text-align:left;white-space:pre-wrap;">${esc(t.task_content)}</td>
        <td class="${lockCls}" data-field="lead_leader">${esc(t.lead_leader)}</td>
        <td class="${lockCls}" data-field="responsible_person">${esc(t.responsible_person)}</td>
        <td class="${lockCls}" data-field="deadline">${formatDate(t.deadline)}</td>
        <td class="editable-cell" data-field="progress" style="white-space:pre-wrap;">${esc(t.progress) || ''}</td>
        <td class="editable-cell text-center" data-field="completion_status">${statusBadge(t.completion_status)}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline" onclick="APP.openAttach(${t.id})">${attCount > 0 ? attCount + ' 个文件' : '上传'}</button>
        </td>
        <td class="editable-cell" data-field="blockers" style="white-space:pre-wrap;">${esc(t.blockers) || ''}</td>
        <td class="editable-cell" data-field="coordination" style="white-space:pre-wrap;">${esc(t.coordination) || ''}</td>
        <td class="text-center">
          ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="APP.deleteTask(${t.id})">删除</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    // Bind inline editing: click on editable-cell to enter edit mode
    $$('#task-tbody td.editable-cell').forEach(td => {
      td.addEventListener('click', function () {
        if (td.classList.contains('editing')) return;
        startInlineEdit(td);
      });
    });

    $('#task-count').textContent = S.tasks.length;
  }

  // ─── Inline edit helpers ────────────────────────────
  // Fields that use the admin full-update API (PUT /api/tasks/:id)
  const ADMIN_FIELDS = ['responsible_unit', 'task_content', 'lead_leader', 'responsible_person', 'deadline'];
  // Fields that use the progress API (PUT /api/tasks/:id/progress)
  const PROGRESS_FIELDS = ['progress', 'completion_status', 'blockers', 'coordination'];

  function startInlineEdit(td) {
    const field = td.dataset.field;
    const tr = td.closest('tr');
    const taskId = Number(tr.dataset.taskId);
    const task = S.tasks.find(x => x.id === taskId);
    if (!task) return;

    td.classList.add('editing');

    if (field === 'completion_status') {
      // render a <select>
      const sel = document.createElement('select');
      sel.className = 'inline-input';
      ['推进中', '临期', '超期', '终止', '预完成', '已完成'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if ((task.completion_status || '推进中') === opt) o.selected = true;
        sel.appendChild(o);
      });
      td.textContent = '';
      td.appendChild(sel);
      sel.focus();

      const finish = () => {
        const newVal = sel.value;
        if (newVal !== (task.completion_status || '推进中')) {
          saveInlineField(taskId, field, newVal, td);
        } else {
          cancelInlineEdit(td, task);
        }
      };
      sel.addEventListener('blur', finish);
      sel.addEventListener('change', finish);
    } else if (field === 'deadline') {
      // render a date input
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.className = 'inline-input';
      inp.value = task.deadline ? formatDate(task.deadline) : '';
      td.textContent = '';
      td.appendChild(inp);
      inp.focus();

      inp.addEventListener('blur', () => {
        const newVal = inp.value;
        const oldVal = task.deadline ? formatDate(task.deadline) : '';
        if (newVal !== oldVal) {
          saveInlineField(taskId, field, newVal || null, td);
        } else {
          cancelInlineEdit(td, task);
        }
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') cancelInlineEdit(td, task);
      });
    } else if (field === 'task_content' || field === 'progress' || field === 'blockers' || field === 'coordination') {
      // render a <textarea> for long text
      const ta = document.createElement('textarea');
      ta.className = 'inline-input';
      ta.value = task[field] || '';
      ta.rows = field === 'task_content' ? 4 : 3;
      td.textContent = '';
      td.appendChild(ta);
      ta.focus();

      ta.addEventListener('blur', () => {
        const newVal = ta.value.trim();
        if (newVal !== (task[field] || '')) {
          saveInlineField(taskId, field, newVal, td);
        } else {
          cancelInlineEdit(td, task);
        }
      });
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ta.blur();
        if (e.key === 'Escape') cancelInlineEdit(td, task);
      });
    } else {
      // short text input (responsible_unit, lead_leader, responsible_person)
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'inline-input';
      inp.value = task[field] || '';
      td.textContent = '';
      td.appendChild(inp);
      inp.focus();
      inp.select();

      inp.addEventListener('blur', () => {
        const newVal = inp.value.trim();
        if (newVal !== (task[field] || '')) {
          saveInlineField(taskId, field, newVal, td);
        } else {
          cancelInlineEdit(td, task);
        }
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') inp.blur();
        if (e.key === 'Escape') cancelInlineEdit(td, task);
      });
    }
  }

  function cancelInlineEdit(td, task) {
    const field = td.dataset.field;
    td.classList.remove('editing');
    if (field === 'completion_status') {
      td.innerHTML = statusBadge(task.completion_status);
    } else if (field === 'deadline') {
      td.textContent = task.deadline ? formatDate(task.deadline) : '';
    } else {
      const val = task[field];
      td.innerHTML = val ? esc(val) : '';
    }
  }

  async function saveInlineField(taskId, field, value, td) {
    try {
      const task = S.tasks.find(x => x.id === taskId);

      if (ADMIN_FIELDS.includes(field)) {
        // Use full task update API (admin only)
        const body = {
          task_no: task.task_no || '',
          responsible_unit: field === 'responsible_unit' ? value : (task.responsible_unit || ''),
          task_content: field === 'task_content' ? value : (task.task_content || ''),
          lead_leader: field === 'lead_leader' ? value : (task.lead_leader || ''),
          responsible_person: field === 'responsible_person' ? value : (task.responsible_person || ''),
          deadline: field === 'deadline' ? value : (task.deadline ? formatDate(task.deadline) : null),
          progress: task.progress || '',
          completion_status: task.completion_status || '推进中',
          blockers: task.blockers || '',
          coordination: task.coordination || '',
        };
        await api('PUT', '/api/tasks/' + taskId, body);
      } else {
        // Use progress update API (all users)
        const body = {
          progress: field === 'progress' ? value : (task.progress || ''),
          completion_status: field === 'completion_status' ? value : (task.completion_status || '推进中'),
          blockers: field === 'blockers' ? value : (task.blockers || ''),
          coordination: field === 'coordination' ? value : (task.coordination || ''),
        };
        await api('PUT', '/api/tasks/' + taskId + '/progress', body);
      }

      // Update local state
      task[field] = value;

      td.classList.remove('editing');
      if (field === 'completion_status') {
        td.innerHTML = statusBadge(value);
      } else if (field === 'deadline') {
        td.textContent = value ? formatDate(value) : '';
      } else {
        td.innerHTML = value ? esc(value) : '';
      }

      showSaveIndicator(td);
    } catch (err) {
      toast('保存失败: ' + err.message, 'error');
      const task = S.tasks.find(x => x.id === taskId);
      if (task) cancelInlineEdit(td, task);
    }
  }

  function showSaveIndicator(td) {
    const indicator = document.createElement('span');
    indicator.className = 'save-indicator visible';
    indicator.textContent = '✓ 已保存';
    td.style.position = 'relative';
    td.appendChild(indicator);
    setTimeout(() => { indicator.remove(); }, 1500);
  }

  // ─── Task CRUD ──────────────────────────────────────
  function openTaskModal(task) {
    const isEdit = !!task;
    $('#modal-task-title').textContent = isEdit ? '编辑任务' : '新增任务';
    $('#task-edit-id').value = isEdit ? task.id : '';
    $('#task-no').value = isEdit ? task.task_no || '' : '';
    $('#task-unit').value = isEdit ? task.responsible_unit || '' : '';
    $('#task-content').value = isEdit ? task.task_content || '' : '';
    $('#task-leader').value = isEdit ? task.lead_leader || '' : '';
    $('#task-person').value = isEdit ? task.responsible_person || '' : '';
    $('#task-deadline').value = isEdit && task.deadline ? formatDate(task.deadline) : '';
    $('#task-progress').value = isEdit ? task.progress || '' : '';
    $('#task-status').value = isEdit ? task.completion_status || '推进中' : '推进中';
    $('#task-blockers').value = isEdit ? task.blockers || '' : '';
    $('#task-coordination').value = isEdit ? task.coordination || '' : '';
    openModal('modal-task');
  }

  async function saveTask() {
    const id = $('#task-edit-id').value;
    const body = {
      task_no: $('#task-no').value.trim(),
      responsible_unit: $('#task-unit').value.trim(),
      task_content: $('#task-content').value.trim(),
      lead_leader: $('#task-leader').value.trim(),
      responsible_person: $('#task-person').value.trim(),
      deadline: $('#task-deadline').value || null,
      progress: $('#task-progress').value.trim(),
      completion_status: $('#task-status').value,
      blockers: $('#task-blockers').value.trim(),
      coordination: $('#task-coordination').value.trim(),
    };
    if (!body.task_content) { toast('工作任务不能为空', 'error'); return; }

    try {
      if (id) {
        await api('PUT', '/api/tasks/' + id, body);
        toast('任务已更新', 'success');
      } else {
        await api('POST', '/api/tasks', body);
        toast('任务已创建', 'success');
      }
      closeModal('modal-task');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteTask(id) {
    if (!confirm('确定要删除这条任务吗？删除后不可恢复。')) return;
    try {
      await api('DELETE', '/api/tasks/' + id);
      toast('任务已删除', 'success');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function editTask(id) {
    const t = S.tasks.find(x => x.id === id);
    if (t) openTaskModal(t);
  }

  // ─── Progress update ───────────────────────────────
  function openProgressModal(id) {
    const t = S.tasks.find(x => x.id === id);
    if (!t) return;
    $('#progress-task-id').value = t.id;
    $('#progress-text').value = t.progress || '';
    $('#progress-status').value = t.completion_status || '推进中';
    $('#progress-blockers').value = t.blockers || '';
    $('#progress-coord').value = t.coordination || '';
    openModal('modal-progress');
  }

  async function saveProgress() {
    const id = $('#progress-task-id').value;
    try {
      await api('PUT', '/api/tasks/' + id + '/progress', {
        progress: $('#progress-text').value.trim(),
        completion_status: $('#progress-status').value,
        blockers: $('#progress-blockers').value.trim(),
        coordination: $('#progress-coord').value.trim(),
      });
      toast('进度已更新', 'success');
      closeModal('modal-progress');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Attachments ────────────────────────────────────
  async function openAttach(taskId) {
    $('#attach-task-id').value = taskId;
    openModal('modal-attach');
    await refreshAttachList(taskId);
  }

  async function refreshAttachList(taskId) {
    const t = S.tasks.find(x => x.id === Number(taskId));
    const atts = t ? (t.attachments || []) : [];
    const list = $('#attach-list');
    if (atts.length === 0) {
      list.innerHTML = '<p class="text-muted">暂无附件</p>';
    } else {
      list.innerHTML = atts.map(a => `
        <div class="att-item">
          <a href="/api/attachments/${a.id}/download" target="_blank">${esc(a.file_name)}</a>
          <span class="text-muted">(${(a.file_size / 1024).toFixed(1)} KB)</span>
          <div class="att-actions">
            <button class="btn btn-sm btn-danger" onclick="APP.deleteAttach(${a.id}, ${taskId})">删除</button>
          </div>
        </div>`).join('');
    }
  }

  async function uploadAttachments(taskId, files) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      await apiUpload('/api/tasks/' + taskId + '/attachments', fd);
      toast('上传成功', 'success');
      // reload task data and refresh list
      await loadTasks();
      await refreshAttachList(taskId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteAttach(attId, taskId) {
    if (!confirm('确定删除此附件？')) return;
    try {
      await api('DELETE', '/api/attachments/' + attId);
      toast('附件已删除', 'success');
      await loadTasks();
      await refreshAttachList(taskId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Excel import/export ────────────────────────────
  function openImportModal() {
    $('#import-file-input').value = '';
    $('#import-result').classList.add('hidden');
    $('#btn-do-import').disabled = true;
    openModal('modal-import');
  }

  async function doImport() {
    const input = $('#import-file-input');
    if (!input.files || !input.files[0]) { toast('请先选择文件', 'error'); return; }
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      $('#btn-do-import').disabled = true;
      $('#btn-do-import').textContent = '导入中...';
      const data = await apiUpload('/api/tasks/import', fd);
      const result = $('#import-result');
      result.classList.remove('hidden');
      result.innerHTML = `
        <div class="card" style="background:var(--gray-50);">
          <div class="card-body">
            <p><strong>导入完成</strong></p>
            <p>总计: ${data.total} 条 | 成功: <span class="text-success">${data.success}</span> 条 | 失败: <span class="text-danger">${data.fail}</span> 条</p>
          </div>
        </div>`;
      toast('导入完成', 'success');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      $('#btn-do-import').disabled = false;
      $('#btn-do-import').textContent = '开始导入';
    }
  }

  async function exportExcel() {
    try {
      const h = {};
      if (S.token) h['Authorization'] = 'Bearer ' + S.token;
      const res = await fetch('/api/tasks/export', { headers: h });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || '导出失败'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '督办台账_' + new Date().toISOString().slice(0, 10) + '.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      toast('导出成功', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function generateReport() {
    try {
      toast('正在生成报告...', '');
      const h = {};
      if (S.token) h['Authorization'] = 'Bearer ' + S.token;
      const res = await fetch('/api/tasks/report', { headers: h });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || '生成失败'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '督办事项情况通报_' + new Date().toISOString().slice(0, 10) + '.docx';
      a.click();
      URL.revokeObjectURL(url);
      toast('报告已生成', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Stats ──────────────────────────────────────────
  let chartStatus, chartUnitStatus;

  async function loadStats() {
    try {
      // Fetch stats and all tasks in parallel
      const [data, taskData] = await Promise.all([
        api('GET', '/api/stats'),
        api('GET', '/api/tasks')
      ]);
      const total = data.total || 0;
      const rate = total > 0 ? ((data.completed / total) * 100).toFixed(1) : '0.0';

      $('#stats-overview').innerHTML = `
        <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">任务总数</div></div>
        <div class="stat-card success"><div class="stat-value">${data.completed}</div><div class="stat-label">已完成</div></div>
        <div class="stat-card warning"><div class="stat-value">${data.inProgress}</div><div class="stat-label">推进中</div></div>
        <div class="stat-card danger"><div class="stat-value">${data.overdue}</div><div class="stat-label">超期</div></div>
        <div class="stat-card info"><div class="stat-value">${rate}%</div><div class="stat-label">完成率</div></div>
      `;

      // Status chart
      const byStatus = data.byStatus || [];
      const statusOrder = ['已完成', '推进中', '临期', '超期', '终止', '已超期', '已终止'];
      const statusMap = new Map();
      byStatus.forEach(r => {
        const key = r.status === '预完成' ? '已完成' : r.status;
        statusMap.set(key, (statusMap.get(key) || 0) + Number(r.cnt || 0));
      });
      const statusLabels = statusOrder.filter(status => statusMap.has(status));
      const statusData = statusLabels.map(status => statusMap.get(status));
      const statusColors = statusLabels.map(s => ({
        '已完成': '#22c55e', '推进中': '#3b82f6', '临期': '#f59e0b',
        '超期': '#ef4444', '终止': '#9ca3af',
        '已超期': '#ef4444', '已终止': '#9ca3af'
      }[s] || '#6b7280'));

      if (chartStatus) chartStatus.destroy();
      chartStatus = new Chart($('#chart-status').getContext('2d'), {
        type: 'doughnut',
        data: { labels: statusLabels, datasets: [{ data: statusData, backgroundColor: statusColors, borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      });

      // Unit completion rate chart - count all tasks per unit
      const allTasks = taskData.tasks || [];
      const today = new Date(); today.setHours(0,0,0,0);

      // Build per-unit stats: all tasks
      const unitMap = {};
      allTasks.forEach(t => {
        const unit = t.responsible_unit;
        if (!unit) return;
        if (!unitMap[unit]) unitMap[unit] = { total: 0, completed: 0 };
        unitMap[unit].total++;
        if (t.completion_status === '已完成' || t.completion_status === '预完成') unitMap[unit].completed++;
      });

      const unitEntries = Object.entries(unitMap).filter(([, v]) => v.total > 0);
      unitEntries.sort((a, b) => {
        const rateA = a[1].total > 0 ? a[1].completed / a[1].total : 0;
        const rateB = b[1].total > 0 ? b[1].completed / b[1].total : 0;
        return rateB - rateA;
      });

      const unitLabels = unitEntries.map(([u]) => u);
      const unitRates = unitEntries.map(([, v]) => v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0);
      const unitCompleted = unitEntries.map(([, v]) => v.completed);
      const unitPending = unitEntries.map(([, v]) => v.total - v.completed);
      const unitTotals = unitEntries.map(([, v]) => v.total);
      const unitLabelWithRate = unitEntries.map(([u], idx) => `${u} (${unitRates[idx]}%)`);

      if (chartUnitStatus) chartUnitStatus.destroy();
      chartUnitStatus = new Chart($('#chart-unit-status').getContext('2d'), {
        type: 'bar',
        data: {
          labels: unitLabelWithRate,
          datasets: [{
            label: '已完成',
            data: unitCompleted,
            backgroundColor: '#22c55e',
            borderWidth: 0,
            borderRadius: 4,
          }, {
            label: '未完成',
            data: unitPending,
            backgroundColor: '#3b82f6',
            borderWidth: 0,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { stacked: true },
            y: { beginAtZero: true, stacked: true }
          },
          plugins: {
            legend: { display: true, position: 'bottom' },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  const idx = ctx.dataIndex;
                  if (ctx.dataset.label === '已完成') {
                    return `已完成: ${unitCompleted[idx]}，完成率: ${unitRates[idx]}%`;
                  }
                  return `未完成: ${unitPending[idx]}`;
                }
              }
            }
          }
        }
      });

      // Render tasks grouped by status - approaching, overdue and terminated
      const groups = {
        approaching: allTasks.filter(t => t.completion_status === '临期'),
        overdue: allTasks.filter(t => t.completion_status === '超期' || t.completion_status === '已超期'),
        terminated: allTasks.filter(t => t.completion_status === '终止' || t.completion_status === '已终止'),
      };

      Object.entries(groups).forEach(([key, tasks]) => {
        $(`#stats-cnt-${key}`).textContent = tasks.length;
        const list = $(`#stats-list-${key}`);
        if (tasks.length === 0) {
          list.innerHTML = '<p class="text-muted" style="padding:16px;text-align:center;">暂无任务</p>';
        } else {
          list.innerHTML = `<table class="stats-mini-table">
            <thead><tr>
              <th style="min-width:80px;">责任主体</th>
              <th style="min-width:160px;">工作任务</th>
              <th style="min-width:70px;">牵头领导</th>
              <th style="min-width:70px;">责任人</th>
              <th style="min-width:90px;">完成日期</th>
              <th style="min-width:200px;">进度情况</th>
              <th style="min-width:160px;">遇到堵点</th>
              <th style="min-width:160px;">需领导协调事项</th>
            </tr></thead>
            <tbody>${tasks.map(t => `<tr>
              <td>${esc(t.responsible_unit)}</td>
              <td style="white-space:pre-wrap;text-align:left;">${esc(t.task_content)}</td>
              <td>${esc(t.lead_leader)}</td>
              <td>${esc(t.responsible_person)}</td>
              <td>${formatDate(t.deadline)}</td>
              <td style="white-space:pre-wrap;text-align:left;">${esc(t.progress) || ''}</td>
              <td style="white-space:pre-wrap;text-align:left;">${esc(t.blockers) || ''}</td>
              <td style="white-space:pre-wrap;text-align:left;">${esc(t.coordination) || ''}</td>
            </tr>`).join('')}</tbody>
          </table>`;
        }
      });

      // Bind toggle collapse
      $$('.stats-section-header').forEach(header => {
        header.onclick = () => {
          const listId = header.dataset.toggle;
          const list = $('#' + listId);
          const icon = header.querySelector('.toggle-icon');
          if (list.classList.contains('collapsed')) {
            list.classList.remove('collapsed');
            icon.innerHTML = '&#9660;';
          } else {
            list.classList.add('collapsed');
            icon.innerHTML = '&#9654;';
          }
        };
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Users ──────────────────────────────────────────
  async function loadUnitsData() {
    try {
      const data = await api('GET', '/api/units');
      S.units = data.units || [];
    } catch { S.units = []; }
  }

  async function loadUsers() {
    await loadUnitsData();
    try {
      const data = await api('GET', '/api/admin/users');
      S.allUsers = data.users || [];
      S.pendingUsers = S.allUsers.filter(u => u.status === 'pending');
      renderPendingUsers();
      renderAllUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderPendingUsers() {
    $('#pending-count').textContent = S.pendingUsers.length;
    const list = $('#pending-list');
    if (S.pendingUsers.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="padding:20px;">暂无待审核用户</p>';
      return;
    }
    list.innerHTML = S.pendingUsers.map(u => `
      <div class="approval-card">
        <div class="info">
          <h4>${esc(u.name)} (${esc(u.username)})</h4>
          <p>单位: ${esc(u.unit)}</p>
          <p>注册时间: ${formatTime(u.created_at)}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-success" onclick="APP.openApprove(${u.id})">审核</button>
        </div>
      </div>`).join('');
  }

  function renderAllUsers() {
    const tbody = $('#users-tbody');
    tbody.innerHTML = S.allUsers.map(u => {
      const roleCls = u.role === 'admin' ? 'role-admin' : 'role-user';
      const statusCls = 'status-' + u.status;
      const statusText = { approved: '正常', pending: '待审核', disabled: '已停用', rejected: '已拒绝' }[u.status] || u.status;
      return `<tr>
        <td>${u.id}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.unit)}</td>
        <td><span class="role-badge ${roleCls}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
        <td><span class="status-tag ${statusCls}">${statusText}</span></td>
        <td>${(u.unitPermissions || []).map(n => `<span class="badge badge-primary" style="margin:1px;">${esc(n)}</span>`).join(' ') || '<span class="text-muted">-</span>'}</td>
        <td>${formatTime(u.created_at)}</td>
        <td>
          ${u.role !== 'admin' ? `
            <button class="btn btn-sm btn-outline" onclick="APP.openPerms(${u.id})">权限</button>
            <button class="btn btn-sm btn-outline" onclick="APP.openResetPwd(${u.id})">重置密码</button>
            ${u.status === 'approved' ? `<button class="btn btn-sm btn-warning" onclick="APP.toggleUser(${u.id})">停用</button>` : ''}
            ${u.status === 'disabled' ? `<button class="btn btn-sm btn-success" onclick="APP.toggleUser(${u.id})">启用</button>` : ''}
          ` : '<span class="text-muted">-</span>'}
        </td>
      </tr>`;
    }).join('');
  }

  // Approve
  function openApprove(userId) {
    const u = S.allUsers.find(x => x.id === userId);
    if (!u) return;
    $('#approve-user-id').value = userId;
    $('#approve-user-info').innerHTML = `<strong>${esc(u.name)}</strong> (${esc(u.username)}) - 单位: ${esc(u.unit)}`;
    renderUnitCheckboxList('approve-unit-list', []);
    openModal('modal-approve');
  }

  function renderUnitCheckboxList(containerId, selected) {
    const c = $('#' + containerId);
    c.innerHTML = S.units.map(u => {
      const checked = selected.includes(u.name) ? 'checked' : '';
      return `<label><input type="checkbox" value="${esc(u.name)}" ${checked}> ${esc(u.name)}</label>`;
    }).join('');
    if (S.units.length === 0) {
      c.innerHTML = '<p class="text-muted" style="padding:8px;">暂无单位，请先在"单位管理"中添加</p>';
    }
  }

  function getCheckedUnits(containerId) {
    return $$('#' + containerId + ' input[type="checkbox"]:checked').map(cb => cb.value);
  }

  async function approveUser() {
    const userId = $('#approve-user-id').value;
    const units = getCheckedUnits('approve-unit-list');
    if (units.length === 0) { toast('请至少选择一个单位权限', 'error'); return; }
    try {
      await api('POST', '/api/admin/users/' + userId + '/approve', { status: 'approved', unitPermissions: units });
      toast('已审核通过', 'success');
      closeModal('modal-approve');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function rejectUser() {
    const userId = $('#approve-user-id').value;
    if (!confirm('确定拒绝此用户？')) return;
    try {
      await api('POST', '/api/admin/users/' + userId + '/approve', { status: 'rejected', unitPermissions: [] });
      toast('已拒绝', 'success');
      closeModal('modal-approve');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Permissions
  function openPerms(userId) {
    const u = S.allUsers.find(x => x.id === userId);
    if (!u) return;
    $('#perms-user-id').value = userId;
    $('#perms-user-info').innerHTML = `<strong>${esc(u.name)}</strong> (${esc(u.username)})`;
    renderUnitCheckboxList('perms-unit-list', u.unitPermissions || []);
    openModal('modal-perms');
  }

  async function savePerms() {
    const userId = $('#perms-user-id').value;
    const units = getCheckedUnits('perms-unit-list');
    try {
      await api('POST', '/api/admin/users/' + userId + '/permissions', { unitPermissions: units });
      toast('权限已更新', 'success');
      closeModal('modal-perms');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Reset password
  function openResetPwd(userId) {
    const u = S.allUsers.find(x => x.id === userId);
    if (!u) return;
    $('#reset-pwd-user-id').value = userId;
    $('#reset-pwd-info').innerHTML = `为 <strong>${esc(u.name)}</strong> (${esc(u.username)}) 重置密码`;
    $('#reset-pwd-value').value = '';
    openModal('modal-reset-pwd');
  }

  async function doResetPwd() {
    const userId = $('#reset-pwd-user-id').value;
    const pwd = $('#reset-pwd-value').value;
    if (!pwd || pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
      toast('密码至少8位，且必须包含字母和数字', 'error'); return;
    }
    try {
      await api('POST', '/api/admin/users/' + userId + '/reset-password', { password: pwd });
      toast('密码已重置', 'success');
      closeModal('modal-reset-pwd');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Toggle status
  async function toggleUser(userId) {
    const u = S.allUsers.find(x => x.id === userId);
    if (!u) return;
    const action = u.status === 'disabled' ? '启用' : '停用';
    if (!confirm(`确定${action}用户 "${u.name}" 吗？`)) return;
    try {
      await api('POST', '/api/admin/users/' + userId + '/toggle-status');
      toast(`用户已${action}`, 'success');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Units management ──────────────────────────────
  async function loadUnits() {
    try {
      const data = await api('GET', '/api/units');
      S.units = data.units || [];
      renderUnitsTable();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderUnitsTable() {
    const tbody = $('#units-tbody');
    if (S.units.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">暂无单位</td></tr>';
      return;
    }
    tbody.innerHTML = S.units.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${esc(u.name)}</td>
        <td>${u.sort_order || 0}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="APP.editUnit(${u.id})">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="APP.deleteUnit(${u.id})">删除</button>
        </td>
      </tr>`).join('');
  }

  function openUnitModal(unit) {
    const isEdit = !!unit;
    $('#modal-unit-title').textContent = isEdit ? '编辑单位' : '新增单位';
    $('#unit-edit-id').value = isEdit ? unit.id : '';
    $('#unit-name').value = isEdit ? unit.name : '';
    $('#unit-sort').value = isEdit ? (unit.sort_order || 0) : 0;
    openModal('modal-unit');
  }

  async function saveUnit() {
    const id = $('#unit-edit-id').value;
    const name = $('#unit-name').value.trim();
    const sort_order = parseInt($('#unit-sort').value) || 0;
    if (!name) { toast('单位名称不能为空', 'error'); return; }
    try {
      if (id) {
        await api('PUT', '/api/units/' + id, { name, sort_order });
        toast('单位已更新', 'success');
      } else {
        await api('POST', '/api/units', { name, sort_order });
        toast('单位已创建', 'success');
      }
      closeModal('modal-unit');
      loadUnits();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function editUnit(id) {
    const u = S.units.find(x => x.id === id);
    if (u) openUnitModal(u);
  }

  async function deleteUnit(id) {
    if (!confirm('确定删除此单位？')) return;
    try {
      await api('DELETE', '/api/units/' + id);
      toast('单位已删除', 'success');
      loadUnits();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Logs ───────────────────────────────────────────
  async function loadLogs() {
    try {
      const offset = S.logsPage * PAGE_SIZE_LOGS;
      const data = await api('GET', '/api/logs?limit=' + PAGE_SIZE_LOGS + '&offset=' + offset);
      S.logsTotal = data.total || 0;
      const logs = data.logs || [];

      const tbody = $('#logs-tbody');
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">暂无日志</td></tr>';
      } else {
        tbody.innerHTML = logs.map(l => `<tr>
          <td>${formatTime(l.created_at)}</td>
          <td>${esc(l.username)}</td>
          <td>${esc(l.action)}</td>
          <td>${esc(l.target_type)}</td>
          <td>${l.target_id}</td>
          <td>${esc(l.detail)}</td>
        </tr>`).join('');
      }

      const totalPages = Math.ceil(S.logsTotal / PAGE_SIZE_LOGS);
      $('#logs-info').textContent = `第 ${S.logsPage + 1} / ${totalPages || 1} 页，共 ${S.logsTotal} 条`;
      $('#btn-logs-prev').disabled = S.logsPage <= 0;
      $('#btn-logs-next').disabled = offset + PAGE_SIZE_LOGS >= S.logsTotal;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Force Change Password ──────────────────────────
  function openForceChangePwd() {
    $('#pwd-old').value = '';
    $('#pwd-new').value = '';
    $('#pwd-new2').value = '';
    openModal('modal-pwd');
    // 阻止关闭：移除backdrop点击关闭和关闭按钮
    const overlay = $('#modal-pwd');
    overlay._forceMode = true;
  }

  // ─── Change Password ───────────────────────────────
  async function changePwd() {
    const oldPwd = $('#pwd-old').value;
    const newPwd = $('#pwd-new').value;
    const newPwd2 = $('#pwd-new2').value;
    if (!oldPwd || !newPwd) { toast('请填写旧密码和新密码', 'error'); return; }
    if (newPwd.length < 8 || !/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
      toast('新密码至少8位，且必须包含字母和数字', 'error'); return;
    }
    if (newPwd !== newPwd2) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await api('POST', '/api/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd });
      S.user.forcePasswordChange = false;
      const overlay = $('#modal-pwd');
      overlay._forceMode = false;
      toast('密码修改成功', 'success');
      closeModal('modal-pwd');
      $('#pwd-old').value = '';
      $('#pwd-new').value = '';
      $('#pwd-new2').value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Event bindings ─────────────────────────────────
  function bindEvents() {
    // Auth
    $('#login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#login-btn');
      btn.disabled = true; btn.textContent = '登录中...';
      try {
        await login($('#login-username').value.trim(), $('#login-password').value);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = '登 录';
      }
    });

    $('#register-form').addEventListener('submit', async e => {
      e.preventDefault();
      const pwd = $('#reg-password').value;
      const pwd2 = $('#reg-password2').value;
      if (pwd !== pwd2) { toast('两次密码不一致', 'error'); return; }
      if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
        toast('密码至少8位，且必须包含字母和数字', 'error'); return;
      }
      try {
        await api('POST', '/api/auth/register', {
          name: $('#reg-name').value.trim(),
          username: $('#reg-username').value.trim(),
          password: pwd,
          unit: $('#reg-unit').value.trim(),
        });
        toast('注册成功，请等待管理员审核', 'success');
        showLogin();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('#show-register-btn').addEventListener('click', showRegister);
    $('#show-login-btn').addEventListener('click', showLogin);
    $('#btn-logout').addEventListener('click', logout);

    // Navigation
    $$('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', () => {
        navigateTo(item.dataset.page);
        // Close sidebar on mobile after navigation
        closeMobileSidebar();
      });
    });

    // Mobile sidebar toggle
    $('#btn-hamburger').addEventListener('click', toggleMobileSidebar);
    $('#sidebar-overlay').addEventListener('click', closeMobileSidebar);

    // Tasks
    $('#btn-add-task').addEventListener('click', () => openTaskModal(null));
    $('#btn-save-task').addEventListener('click', saveTask);
    $('#btn-filter').addEventListener('click', loadTasks);
    $('#btn-filter-reset').addEventListener('click', () => {
      $('#filter-unit').value = '';
      $('#filter-status').value = '';
      $('#filter-keyword').value = '';
      loadTasks();
    });
    // Allow enter key in keyword to trigger filter
    $('#filter-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') loadTasks(); });

    // Progress
    $('#btn-save-progress').addEventListener('click', saveProgress);

    // Attachments
    const attachArea = $('#attach-upload-area');
    attachArea.addEventListener('click', () => $('#attach-file-input').click());
    attachArea.addEventListener('dragover', e => { e.preventDefault(); attachArea.style.borderColor = 'var(--primary)'; });
    attachArea.addEventListener('dragleave', () => { attachArea.style.borderColor = ''; });
    attachArea.addEventListener('drop', e => {
      e.preventDefault();
      attachArea.style.borderColor = '';
      const taskId = $('#attach-task-id').value;
      uploadAttachments(taskId, e.dataTransfer.files);
    });
    $('#attach-file-input').addEventListener('change', e => {
      const taskId = $('#attach-task-id').value;
      uploadAttachments(taskId, e.target.files);
      e.target.value = '';
    });

    // Excel
    $('#btn-import-excel').addEventListener('click', openImportModal);
    const importArea = $('#import-upload-area');
    importArea.addEventListener('click', () => $('#import-file-input').click());
    $('#import-file-input').addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) {
        $('#btn-do-import').disabled = false;
      }
    });
    $('#btn-do-import').addEventListener('click', doImport);
    $('#btn-export-excel').addEventListener('click', exportExcel);
    $('#btn-generate-report').addEventListener('click', generateReport);

    // Stats
    $('#btn-refresh-stats').addEventListener('click', loadStats);

    // Users
    $('#btn-approve-user').addEventListener('click', approveUser);
    $('#btn-reject-user').addEventListener('click', rejectUser);
    $('#btn-save-perms').addEventListener('click', savePerms);
    $('#btn-do-reset-pwd').addEventListener('click', doResetPwd);

    // Units
    $('#btn-add-unit').addEventListener('click', () => openUnitModal(null));
    $('#btn-save-unit').addEventListener('click', saveUnit);

    // Logs pagination
    $('#btn-logs-prev').addEventListener('click', () => { if (S.logsPage > 0) { S.logsPage--; loadLogs(); } });
    $('#btn-logs-next').addEventListener('click', () => {
      if ((S.logsPage + 1) * PAGE_SIZE_LOGS < S.logsTotal) { S.logsPage++; loadLogs(); }
    });

    // Change password
    $('#btn-change-pwd').addEventListener('click', () => {
      $('#pwd-old').value = ''; $('#pwd-new').value = ''; $('#pwd-new2').value = '';
      openModal('modal-pwd');
    });
    $('#btn-save-pwd').addEventListener('click', changePwd);
  }

  // ─── Expose to inline onclick ──────────────────────
  window.APP = {
    deleteTask,
    updateProgress: openProgressModal,
    openAttach,
    deleteAttach,
    openApprove,
    openPerms,
    openResetPwd: openResetPwd,
    toggleUser,
    editUnit,
    deleteUnit,
  };

  // ─── Init ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    tryAutoLogin();
  });

})();
