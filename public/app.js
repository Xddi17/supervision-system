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

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
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

    // 同步偏好（折叠开关）
    if (S.user && S.user.preferences) {
      const t = $('#toggle-fold-notified');
      if (t) t.checked = S.user.preferences.foldNotified !== false;
      applyHiddenColumnsFromPrefs();
    }

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
    loadDashboardFeed();
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
      // "最近更新的任务" 板块已下线，不再渲染
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Tasks ──────────────────────────────────────────
  async function loadTasks() {
    try {
      const params = new URLSearchParams();
      const kwVal = $('#filter-keyword').value.trim();
      if (kwVal) params.set('keyword', kwVal);

      const data = await api('GET', '/api/tasks?' + params.toString());
      S.tasks = data.tasks || [];

      renderTaskTable();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── 列头筛选 / 排序 状态 ─────────────────────────────
  // S.colFilters: { columnKey: Set<string> }, 仅显示这些值
  // S.colSort:    { col: 'deadline', dir: 'asc'|'desc' } 当前排序
  // S.dateRange:  { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } 完成日期专用
  if (!S.colFilters) S.colFilters = {};
  if (!S.colSort) S.colSort = { col: '', dir: '' };
  if (!S.dateRange) S.dateRange = { from: '', to: '' };

  function getDisplayedTasks() {
    let arr = S.tasks.slice();
    // 默认隐藏「已完成」（除非用户在列设置里勾了"显示已完成"）
    if (!getShowCompleted()) {
      arr = arr.filter(t => normalizeStatusFront(t.completion_status) !== '已完成');
    }
    // 列值筛选
    Object.entries(S.colFilters).forEach(([col, set]) => {
      if (!set || set.size === 0) return;
      arr = arr.filter(t => {
        const v = col === 'deadline' ? formatDate(t[col]) : (t[col] == null ? '' : String(t[col]));
        return set.has(v);
      });
    });
    // 完成日期区间
    if (S.dateRange.from || S.dateRange.to) {
      arr = arr.filter(t => {
        const d = formatDate(t.deadline);
        if (!d) return false;
        if (S.dateRange.from && d < S.dateRange.from) return false;
        if (S.dateRange.to && d > S.dateRange.to) return false;
        return true;
      });
    }
    // 排序
    if (S.colSort.col) {
      const { col, dir } = S.colSort;
      const sign = dir === 'desc' ? -1 : 1;
      arr.sort((a, b) => {
        const va = a[col] == null ? '' : String(a[col]);
        const vb = b[col] == null ? '' : String(b[col]);
        if (col === 'deadline') return sign * (va.localeCompare(vb));
        return sign * va.localeCompare(vb, 'zh');
      });
    }
    return arr;
  }

  function renderTaskTable() {
    const isAdmin = S.user && S.user.role === 'admin';
    const tbody = $('#task-tbody');
    const colCount = 13; // 序号 + 11 数据列 + 操作

    const displayed = getDisplayedTasks();
    S.displayedTasks = displayed;

    if (displayed.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state"><p>暂无督办任务</p></td></tr>`;
      $('#task-count').textContent = '0';
      updateColFilterButtons();
      return;
    }

    tbody.innerHTML = displayed.map((t, idx) => {
      const attCount = (t.attachments || []).length;
      const lockCls = isAdmin ? 'editable-cell' : 'locked-cell';
      return `<tr data-task-id="${t.id}">
        <td class="col-index text-center">${idx + 1}</td>
        <td class="${lockCls}" data-field="responsible_unit">${esc(t.responsible_unit)}</td>
        <td class="${lockCls}" data-field="task_category">${esc(t.task_category || '')}</td>
        <td class="${lockCls}" data-field="task_content" style="text-align:left;white-space:pre-wrap;">${esc(t.task_content)}</td>
        <td class="${lockCls}" data-field="lead_leader">${esc(t.lead_leader)}</td>
        <td class="${lockCls}" data-field="responsible_person">${esc(t.responsible_person)}</td>
        <td class="${lockCls}" data-field="deadline">${formatDate(t.deadline)}</td>
        <td class="editable-cell" data-field="progress" style="white-space:pre-wrap;">${esc(t.progress) || ''}</td>
        <td class="editable-cell text-center" data-field="completion_status">${statusBadge(t.completion_status)}</td>
        <td class="text-center" data-field="attach">
          <button class="btn btn-sm btn-outline" onclick="APP.openAttach(${t.id})">${attCount > 0 ? attCount + ' 个文件' : '上传'}</button>
        </td>
        <td class="editable-cell" data-field="blockers" style="white-space:pre-wrap;">${esc(t.blockers) || ''}</td>
        <td class="editable-cell" data-field="coordination" style="white-space:pre-wrap;">${esc(t.coordination) || ''}</td>
        <td class="text-center">
          ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="APP.deleteTask(${t.id})">删除</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    // Bind inline editing
    $$('#task-tbody td.editable-cell').forEach(td => {
      td.addEventListener('click', function () {
        if (td.classList.contains('editing')) return;
        startInlineEdit(td);
      });
    });

    $('#task-count').textContent = displayed.length;
    updateColFilterButtons();
    applyHiddenColumnsFromPrefs();
  }

  function updateColFilterButtons() {
    $$('#task-table .col-filter-btn').forEach(btn => {
      const col = btn.dataset.col;
      const has = (S.colFilters[col] && S.colFilters[col].size > 0) ||
                  (S.colSort.col === col) ||
                  (col === 'deadline' && (S.dateRange.from || S.dateRange.to));
      btn.classList.toggle('active', !!has);
    });
  }

  // ─── 列头筛选弹层 ───────────────────────────────────
  let cfpCurrentCol = '';
  function bindColFilters() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.col-filter-btn');
      if (btn) {
        e.stopPropagation();
        openColFilter(btn);
        return;
      }
      const pop = $('#col-filter-popover');
      if (pop && !pop.classList.contains('hidden') && !pop.contains(e.target)) {
        pop.classList.add('hidden');
      }
    });

    const pop = $('#col-filter-popover');
    pop.addEventListener('click', e => e.stopPropagation());
    pop.querySelectorAll('.cfp-sort button').forEach(b => {
      b.addEventListener('click', () => {
        const dir = b.dataset.sort;
        S.colSort = dir ? { col: cfpCurrentCol, dir } : { col: '', dir: '' };
        renderTaskTable();
        // 高亮按钮状态
        pop.querySelectorAll('.cfp-sort button').forEach(x => x.classList.toggle('active', x.dataset.sort === dir && dir !== ''));
      });
    });
    $('#cfp-search').addEventListener('input', () => renderCfpValues($('#cfp-search').value));
    $('#cfp-clear').addEventListener('click', () => {
      delete S.colFilters[cfpCurrentCol];
      if (cfpCurrentCol === 'deadline') S.dateRange = { from: '', to: '' };
      pop.classList.add('hidden');
      renderTaskTable();
    });
    $('#cfp-apply').addEventListener('click', () => {
      const checked = [...pop.querySelectorAll('.cfp-values input[type=checkbox]:checked')].map(x => x.value);
      if (checked.length === 0) {
        delete S.colFilters[cfpCurrentCol];
      } else {
        S.colFilters[cfpCurrentCol] = new Set(checked);
      }
      if (cfpCurrentCol === 'deadline') {
        S.dateRange = { from: $('#cfp-date-from').value, to: $('#cfp-date-to').value };
      }
      pop.classList.add('hidden');
      renderTaskTable();
    });
  }

  function openColFilter(btn) {
    const col = btn.dataset.col;
    cfpCurrentCol = col;
    const pop = $('#col-filter-popover');
    // 定位
    const rect = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 280, rect.left + window.scrollX)) + 'px';
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';

    // 排序按钮高亮
    pop.querySelectorAll('.cfp-sort button').forEach(x => {
      x.classList.toggle('active', S.colSort.col === col && S.colSort.dir === x.dataset.sort && x.dataset.sort !== '');
    });

    // 日期区间专属
    const dateSec = pop.querySelector('.cfp-date');
    if (col === 'deadline') {
      dateSec.classList.remove('hidden');
      $('#cfp-date-from').value = S.dateRange.from || '';
      $('#cfp-date-to').value = S.dateRange.to || '';
    } else {
      dateSec.classList.add('hidden');
    }

    $('#cfp-search').value = '';
    renderCfpValues('');
    pop.classList.remove('hidden');
  }

  function renderCfpValues(filterText) {
    const col = cfpCurrentCol;
    const wrap = $('#cfp-values');
    const seen = new Set();
    (S.tasks || []).forEach(t => {
      const v = col === 'deadline' ? formatDate(t[col]) : (t[col] == null ? '' : String(t[col]));
      seen.add(v);
    });
    let values = [...seen].sort((a, b) => a.localeCompare(b, 'zh'));
    if (filterText) {
      const ft = filterText.toLowerCase();
      values = values.filter(v => v.toLowerCase().includes(ft));
    }
    const active = S.colFilters[col] || new Set();
    wrap.innerHTML = values.map(v => {
      const checked = active.size === 0 ? false : active.has(v);
      const display = v === '' ? '<em>(空)</em>' : esc(v);
      return `<label><input type="checkbox" value="${esc(v)}" ${checked ? 'checked' : ''}>${display}</label>`;
    }).join('') || '<p class="text-muted" style="padding:8px;">无可选值</p>';
  }

  // ─── Inline edit helpers ────────────────────────────
  // Fields that use the admin full-update API (PUT /api/tasks/:id)
  const ADMIN_FIELDS = ['responsible_unit', 'task_category', 'task_content', 'lead_leader', 'responsible_person', 'deadline'];
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

      let finishCalled = false;
      const finish = () => {
        if (finishCalled) return;
        finishCalled = true;
        const newVal = sel.value;
        if (newVal !== (task.completion_status || '推进中')) {
          saveInlineField(taskId, field, newVal, td);
        } else {
          cancelInlineEdit(td, task);
        }
      };
      sel.addEventListener('change', finish);
      sel.addEventListener('blur', finish);
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
      // short text input (responsible_unit, task_category, lead_leader, responsible_person)
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'inline-input';
      inp.value = task[field] || '';
      if (field === 'task_category') {
        inp.setAttribute('list', 'task-category-options');
        refreshCategoryDatalist();
      }
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
        const body = { [field]: value };
        await api('PUT', '/api/tasks/' + taskId, body);
      } else {
        const body = { [field]: value };
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
    $('#task-category').value = isEdit ? task.task_category || '' : '';
    refreshCategoryDatalist();
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
      task_category: $('#task-category').value.trim(),
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

  async function refreshCategoryDatalist() {
    try {
      const data = await api('GET', '/api/task-categories');
      const dl = $('#task-category-options');
      if (!dl) return;
      const fromTasks = [...new Set((S.tasks || []).map(t => t.task_category).filter(Boolean))];
      const all = [...new Set([...(data.categories || []), ...fromTasks])].sort();
      dl.innerHTML = all.map(c => `<option value="${esc(c)}"></option>`).join('');
    } catch (e) { /* ignore */ }
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
  // 动态创建多个图表，统一管理，重渲染时全部销毁
  let statsCharts = [];
  function destroyStatsCharts() {
    statsCharts.forEach(c => { try { c.destroy(); } catch (e) {} });
    statsCharts = [];
  }

  // 状态枚举颜色
  const STATUS_COLORS = {
    '已完成': '#22c55e', '推进中': '#3b82f6', '临期': '#f59e0b',
    '超期': '#ef4444', '终止': '#9ca3af',
  };
  const STATUS_CHART_ORDER = ['已完成', '推进中', '终止', '临期', '超期'];
  const STATUS_FOCUS_ORDER = ['终止', '临期', '超期'];
  // 类别调色板
  const CAT_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6', '#f97316', '#6366f1', '#a855f7'];

  function normalizeStatusFront(s) {
    const v = String(s || '').trim();
    if (v === '已超期') return '超期';
    if (v === '已终止') return '终止';
    if (v === '预完成') return '已完成';
    return v || '推进中';
  }

  // 给定一组任务，返回 [{status, count, color}]
  function aggregateStatus(tasks) {
    const order = ['已完成', '推进中', '临期', '超期', '终止'];
    const map = new Map();
    tasks.forEach(t => {
      const s = normalizeStatusFront(t.completion_status);
      map.set(s, (map.get(s) || 0) + 1);
    });
    return order.filter(s => map.has(s)).map(s => ({ status: s, count: map.get(s), color: STATUS_COLORS[s] || '#6b7280' }));
  }

  // 给定一组任务，返回每个任务类别下各状态数量
  function aggregateCategory(tasks) {
    const map = new Map();
    tasks.forEach(t => {
      const c = (t.task_category || '').trim() || '未分类';
      if (!map.has(c)) map.set(c, { total: 0, completed: 0, statuses: {} });
      const o = map.get(c);
      o.total++;
      const ns = normalizeStatusFront(t.completion_status);
      o.statuses[ns] = (o.statuses[ns] || 0) + 1;
      if (ns === '已完成') o.completed++;
    });
    return [...map.entries()]
      .map(([cat, v]) => ({ cat, total: v.total, completed: v.completed, statuses: v.statuses }))
      .filter(c => c.total > 0)
      .sort((a, b) => (b.completed / b.total) - (a.completed / a.total));
  }

  function groupTasksByCategory(tasks) {
    const map = new Map();
    tasks.forEach(t => {
      const cat = (t.task_category || '').trim() || '未分类';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(t);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  }

  function renderStatusDoughnut(canvas, tasks) {
    const agg = aggregateStatus(tasks);
    if (agg.length === 0) return null;
    const ch = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: agg.map(a => a.status),
        datasets: [{ data: agg.map(a => a.count), backgroundColor: agg.map(a => a.color), borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { left: 115, right: 115, top: 34, bottom: 18 } },
        cutout: '52%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const tot = agg.reduce((s, a) => s + a.count, 0);
                return `${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / tot * 100)}%)`;
              }
            }
          }
        }
      },
      plugins: [doughnutLabelPlugin]
    });
    statsCharts.push(ch);
    return ch;
  }

  function renderCategoryBar(canvas, tasks) {
    const cats = aggregateCategory(tasks);
    if (cats.length === 0) return null;
    // 布局参数：同类别柱紧贴；类别之间固定空槽；两侧留对称边距槽位
    const GAP_SLOTS = 3;            // 不同任务类别之间的空白槽位数量
    const SIDE_PAD_SLOTS = 3;       // 整体两侧对称留白槽位数量
    const barItems = [];
    const groups = [];
    for (let p = 0; p < SIDE_PAD_SLOTS; p++) barItems.push({ spacer: true });
    cats.forEach((c, ci) => {
      if (ci > 0) {
        for (let g = 0; g < GAP_SLOTS; g++) barItems.push({ spacer: true });
      }
      const start = barItems.length;
      STATUS_CHART_ORDER.forEach(status => {
        const count = Number(c.statuses[status] || 0);
        if (!count) return;
        barItems.push({ cat: c.cat, status, count, completed: c.completed, total: c.total, rate: Math.round(c.completed / c.total * 100) });
      });
      if (barItems.length > start) groups.push({ cat: c.cat, start, end: barItems.length - 1, completed: c.completed, total: c.total, rate: Math.round(c.completed / c.total * 100) });
    });
    for (let p = 0; p < SIDE_PAD_SLOTS; p++) barItems.push({ spacer: true });
    const ch = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: barItems.map(item => item.spacer ? '' : item.status),
        datasets: [{
          label: '完成情况',
          data: barItems.map(item => item.spacer ? null : item.count),
          backgroundColor: barItems.map(item => item.spacer ? 'rgba(0,0,0,0)' : (STATUS_COLORS[item.status] || '#6b7280')),
          borderRadius: 4,
          borderSkipped: false,
          categoryPercentage: 1.0,
          barPercentage: 1.0,
          maxBarThickness: 34,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24, bottom: 8 } },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              minRotation: 0,
              font: { size: 11 },
              callback: (value, index) => {
                const g = groups.find(group => index >= group.start && index <= group.end);
                if (!g) return '';
                return index === Math.floor((g.start + g.end) / 2) ? g.cat : '';
              }
            }
          },
          y: {
            beginAtZero: true,
            grace: '20%',
            ticks: { precision: 0 },
            grid: { color: 'rgba(148, 163, 184, .18)' }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              boxWidth: 12,
              font: { size: 11 },
              generateLabels: () => STATUS_CHART_ORDER.map((status, index) => ({
                text: status,
                fillStyle: STATUS_COLORS[status],
                strokeStyle: STATUS_COLORS[status],
                lineWidth: 0,
                hidden: false,
                datasetIndex: 0,
                index,
              }))
            },
            onClick: null
          },
          tooltip: {
            filter: ctx => !!barItems[ctx.dataIndex] && !barItems[ctx.dataIndex].spacer,
            callbacks: {
              label: ctx => {
                const item = barItems[ctx.dataIndex];
                if (!item || item.spacer) return '';
                return `${item.cat} - ${item.status}: ${item.count}，完成率${item.rate}%`;
              }
            }
          }
        }
      },
      plugins: [makeCategoryBarLabelPlugin(groups)]
    });
    statsCharts.push(ch);
    return ch;
  }

  function renderUnitTaskDetails(tasks, opts) {
    opts = opts || {};
    const withNotify = !!opts.withNotify; // 是否在末列追加"已通报"按钮
    const notifiedSet = opts.notifiedSet || new Set();
    const fold = !!opts.fold;
    const focusTasks = tasks.filter(t => STATUS_FOCUS_ORDER.includes(normalizeStatusFront(t.completion_status)));
    if (!focusTasks.length) return '<div class="stats-unit-details empty">暂无终止、临期、超期任务</div>';
    return `<div class="stats-unit-details">
      ${groupTasksByCategory(focusTasks).map(([cat, catTasks]) => `
        <div class="stats-category-group">
          <div class="stats-category-title">${esc(cat)}（${catTasks.length}项）</div>
          <div class="stats-task-table-wrap">
            <table class="stats-mini-table">
              <thead><tr>
                <th style="min-width:80px;">完成情况</th>
                <th style="min-width:180px;">工作任务</th>
                <th style="min-width:70px;">牵头领导</th>
                <th style="min-width:70px;">责任人</th>
                <th style="min-width:90px;">完成日期</th>
                <th style="min-width:160px;">进度情况</th>
                <th style="min-width:140px;">遇到堵点</th>
                <th style="min-width:140px;">需领导协调事项</th>
                ${withNotify ? '<th style="min-width:96px;">操作</th>' : ''}
              </tr></thead>
              <tbody>${catTasks.map(t => {
                const isNotified = notifiedSet.has(t.id);
                const trCls = withNotify ? ((isNotified ? 'notified' : '') + (isNotified && fold ? ' folded' : '')) : '';
                const notifyTd = withNotify
                  ? `<td class="actions" style="text-align:right;white-space:nowrap;">${
                      isNotified
                        ? `<button class="btn btn-sm btn-outline" onclick="APP.unnotifyTask(${t.id})">取消通报</button>`
                        : `<button class="btn btn-sm btn-primary" onclick="APP.notifyTask(${t.id})">已通报</button>`
                    }</td>`
                  : '';
                return `<tr data-task-id="${t.id}" class="${trCls}">
                  <td>${statusBadge(normalizeStatusFront(t.completion_status))}</td>
                  <td style="white-space:pre-wrap;text-align:left;">${esc(t.task_content)}</td>
                  <td>${esc(t.lead_leader)}</td>
                  <td>${esc(t.responsible_person)}</td>
                  <td>${formatDate(t.deadline)}</td>
                  <td style="white-space:pre-wrap;text-align:left;">${esc(t.progress) || ''}</td>
                  <td style="white-space:pre-wrap;text-align:left;">${esc(t.blockers) || ''}</td>
                  <td style="white-space:pre-wrap;text-align:left;">${esc(t.coordination) || ''}</td>
                  ${notifyTd}
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>`).join('')}
    </div>`;
  }

  // ─── Chart.js 常驻数字标签插件 ─────────────────────────
  // 1) 饼图外侧标签 + 引导线：显示"名称 数量 (xx%)"
  const doughnutLabelPlugin = {
    id: 'doughnutLabel',
    afterDatasetsDraw(chart) {
      const { ctx, data, chartArea } = chart;
      const ds = data.datasets[0];
      if (!ds) return;
      const meta = chart.getDatasetMeta(0);
      const total = ds.data.reduce((a, b) => a + Number(b || 0), 0);
      if (total === 0) return;

      ctx.save();
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'middle';

      // 收集左右两侧标签，按 y 排序后做防重叠调整
      const items = [];
      meta.data.forEach((arc, i) => {
        const v = Number(ds.data[i] || 0);
        if (!v) return;
        const pct = Math.round(v / total * 100);
        const props = arc.getProps(['x', 'y', 'startAngle', 'endAngle', 'outerRadius'], true);
        const angle = (props.startAngle + props.endAngle) / 2;
        const r = props.outerRadius;
        const sx = props.x + Math.cos(angle) * r;
        const sy = props.y + Math.sin(angle) * r;
        const ex = props.x + Math.cos(angle) * (r + 16);
        const ey = props.y + Math.sin(angle) * (r + 16);
        const right = Math.cos(angle) >= 0;
        const tx = right ? chartArea.right - 8 : chartArea.left + 8;
        items.push({
          i, sx, sy, ex, ey, tx, ty: ey, right,
          color: ds.backgroundColor[i] || '#666',
          text: `${data.labels[i]} ${v} (${pct}%)`,
        });
      });

      // 防重叠：左右各自按 y 排序，强制每行至少 16px
      const minGap = 22;
      ['left', 'right'].forEach(side => {
        const list = items.filter(it => (side === 'right') === it.right).sort((a, b) => a.ty - b.ty);
        for (let k = 1; k < list.length; k++) {
          if (list[k].ty - list[k - 1].ty < minGap) {
            list[k].ty = list[k - 1].ty + minGap;
          }
        }
        const topLimit = chartArea.top + 20;
        const bottomLimit = chartArea.bottom - 20;
        if (list.length && list[list.length - 1].ty > bottomLimit) {
          const shift = list[list.length - 1].ty - bottomLimit;
          list.forEach(it => { it.ty -= shift; });
        }
        if (list.length && list[0].ty < topLimit) {
          const shift = topLimit - list[0].ty;
          list.forEach(it => { it.ty += shift; });
        }
      });

      // 绘制引导线 + 标签
      items.forEach(it => {
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(it.sx, it.sy);
        ctx.lineTo(it.ex, it.ey);
        ctx.lineTo(it.tx, it.ty);
        ctx.stroke();

        ctx.fillStyle = '#374151';
        ctx.textAlign = it.right ? 'left' : 'right';
        ctx.fillText(it.text, it.tx + (it.right ? 2 : -2), it.ty);
      });
      ctx.restore();
    }
  };

  // 2) 任务类别紧凑柱：仅显示非零柱，分组顶部居中显示完成率
  function makeCategoryBarLabelPlugin(groups) {
    return {
      id: 'categoryBarLabel',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '600 11px sans-serif';
        ctx.textAlign = 'center';
        // 每根柱顶显示数量
        meta.data.forEach((bar, i) => {
          const v = Number(chart.data.datasets[0].data[i] || 0);
          if (!v) return;
          const { x, y } = bar.getProps(['x', 'y'], true);
          ctx.fillStyle = '#475569';
          ctx.textBaseline = 'bottom';
          ctx.fillText(String(v), x, y - 6);
        });

        ctx.fillStyle = '#111827';
        ctx.font = '700 12px sans-serif';
        groups.forEach(group => {
          const first = meta.data[group.start];
          const last = meta.data[group.end];
          if (!first || !last) return;
          const firstProps = first.getProps(['x'], true);
          const lastProps = last.getProps(['x'], true);
          const topY = meta.data.slice(group.start, group.end + 1).reduce((min, bar) => {
            const { y } = bar.getProps(['y'], true);
            return Math.min(min, y);
          }, chartArea.bottom);
          const x = (firstProps.x + lastProps.x) / 2;
          const y = Math.max(chartArea.top + 12, topY - 38);
          ctx.textBaseline = 'bottom';
          ctx.fillText(`完成率${group.rate}%`, x, y);
        });
        ctx.restore();
      }
    };
  }

  async function loadStats() {
    try {
      destroyStatsCharts();
      // Fetch tasks + units + 当前用户已通报集合
      const [taskData, unitData, notifData] = await Promise.all([
        api('GET', '/api/tasks'),
        api('GET', '/api/units'),
        api('GET', '/api/me/notified-ids').catch(() => ({ ids: [] })),
      ]);
      const allTasks = taskData.tasks || [];
      const allUnits = unitData.units || []; // 已按 sort_order, id 排序
      S.notifiedIds = new Set(notifData.ids || []);

      // ─── 顶部 6 张数字卡片 ─────────────────────────
      const total = allTasks.length;
      const cntCompleted   = allTasks.filter(t => normalizeStatusFront(t.completion_status) === '已完成').length;
      const cntInProgress  = allTasks.filter(t => normalizeStatusFront(t.completion_status) === '推进中').length;
      const cntApproaching = allTasks.filter(t => normalizeStatusFront(t.completion_status) === '临期').length;
      const cntOverdue     = allTasks.filter(t => normalizeStatusFront(t.completion_status) === '超期').length;
      const rate = total > 0 ? ((cntCompleted / total) * 100).toFixed(1) : '0.0';

      $('#stats-overview').innerHTML = `
        <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">任务总数</div></div>
        <div class="stat-card success"><div class="stat-value">${cntCompleted}</div><div class="stat-label">已完成</div></div>
        <div class="stat-card info"><div class="stat-value">${rate}%</div><div class="stat-label">完成率</div></div>
        <div class="stat-card warning"><div class="stat-value">${cntInProgress}</div><div class="stat-label">推进中</div></div>
        <div class="stat-card danger"><div class="stat-value">${cntOverdue}</div><div class="stat-label">超期</div></div>
        <div class="stat-card" style="border-left-color:#f59e0b;"><div class="stat-value" style="color:#f59e0b;">${cntApproaching}</div><div class="stat-label">临期</div></div>
      `;

      // 取出"任务实际涉及到的单位"按 sort_order 排序；没在 units 表里的放最后（按名称）
      const unitsWithTasks = (() => {
        const presentNames = new Set(allTasks.map(t => t.responsible_unit).filter(Boolean));
        const ordered = allUnits.filter(u => presentNames.has(u.name)).map(u => u.name);
        const remaining = [...presentNames].filter(n => !ordered.includes(n)).sort((a, b) => a.localeCompare(b, 'zh'));
        return [...ordered, ...remaining];
      })();

      // 缓存供两个 tab 复用
      S.statsCache = { allTasks, unitsWithTasks };

      // 非管理员：隐藏 tab 栏，强制走 byunit 视图
      const tabNav = $('#stats-tab-nav');
      if (tabNav) tabNav.classList.toggle('hidden', !isAdminUser());
      if (!isAdminUser()) S.statsTab = 'byunit';

      // 真正切换面板（修复：以前没切，导致非管理员还看到空的 overall 面板）
      $('#stats-tab-overall').classList.toggle('active', S.statsTab === 'overall');
      $('#stats-tab-byunit').classList.toggle('active', S.statsTab === 'byunit');
      $$('#stats-tab-nav .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === S.statsTab));

      // 根据当前激活的 tab 渲染
      if (S.statsTab === 'byunit') renderStatsByUnit();
      else renderStatsOverall();

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

  // ═══════════════════════════════════════════════════
  //  列隐藏（按账号持久化）+ 已完成行的显示开关
  // ═══════════════════════════════════════════════════
  const HIDEABLE_COLUMNS = [
    { key: 'responsible_unit', label: '责任主体' },
    { key: 'task_category',    label: '任务类别' },
    { key: 'task_content',     label: '工作任务' },
    { key: 'lead_leader',      label: '牵头领导' },
    { key: 'responsible_person', label: '责任人' },
    { key: 'deadline',         label: '完成日期' },
    { key: 'progress',         label: '进度情况' },
    { key: 'completion_status', label: '完成情况' },
    { key: 'attach',           label: '证明材料' },
    { key: 'blockers',         label: '遇到堵点' },
    { key: 'coordination',     label: '需领导协调事项' },
  ];

  function getHiddenColumns() {
    return (S.user && S.user.preferences && Array.isArray(S.user.preferences.hiddenColumns))
      ? S.user.preferences.hiddenColumns
      : [];
  }

  function getShowCompleted() {
    return !!(S.user && S.user.preferences && S.user.preferences.showCompleted === true);
  }

  function applyHiddenColumnsFromPrefs() {
    const hidden = new Set(getHiddenColumns());
    // 表头
    $$('#task-table thead th').forEach(th => {
      const col = th.getAttribute('data-col') || (th.classList.contains('col-attach') ? 'attach' : null);
      if (!col) return;
      th.classList.toggle('col-hidden', hidden.has(col));
    });
    // 表体（包括"上传"按钮列，通过 data-field=attach 标记）
    $$('#task-tbody td[data-field]').forEach(td => {
      const f = td.getAttribute('data-field');
      td.classList.toggle('col-hidden', hidden.has(f));
    });
  }

  function openColSettings() {
    const hidden = new Set(getHiddenColumns());
    const showCompleted = getShowCompleted();
    const list = $('#col-settings-list');
    const columnHtml = HIDEABLE_COLUMNS.map(c => {
      const checked = hidden.has(c.key) ? '' : 'checked';
      return `<label><input type="checkbox" data-kind="col" value="${c.key}" ${checked}> ${esc(c.label)}</label>`;
    }).join('');
    list.innerHTML = `
      <div style="grid-column: 1 / -1; font-size:12px; color: var(--gray-500); margin-bottom:2px;">显示列：</div>
      ${columnHtml}
      <div style="grid-column: 1 / -1; font-size:12px; color: var(--gray-500); margin: 6px 0 2px;">行筛选：</div>
      <label style="grid-column: 1 / -1;">
        <input type="checkbox" data-kind="show-completed" ${showCompleted ? 'checked' : ''}>
        显示「已完成」的任务（默认隐藏）
      </label>
    `;
    openModal('modal-col-settings');
  }

  async function saveColSettings() {
    const allKeys = HIDEABLE_COLUMNS.map(c => c.key);
    const visibleCols = $$('#col-settings-list input[data-kind="col"]:checked').map(cb => cb.value);
    const hidden = allKeys.filter(k => !visibleCols.includes(k));
    const showCompletedBox = $('#col-settings-list input[data-kind="show-completed"]');
    const showCompleted = !!(showCompletedBox && showCompletedBox.checked);
    try {
      const data = await api('PUT', '/api/me/preferences', { hiddenColumns: hidden, showCompleted });
      if (S.user) S.user.preferences = data.preferences;
      // 打开"显示已完成"时，连带清掉"完成情况"列的旧筛选，避免双重过滤遮住已完成
      if (showCompleted && S.colFilters && S.colFilters.completion_status) {
        delete S.colFilters.completion_status;
      }
      applyHiddenColumnsFromPrefs();
      renderTaskTable();
      closeModal('modal-col-settings');
      toast('列设置已保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════
  //  工作台：角色化 feed
  //   - 主管理员：近 15 天各单位更新条数
  //   - 普通用户：近 1 个月内下发的事项
  // ═══════════════════════════════════════════════════
  async function loadDashboardFeed() {
    const box = $('#dash-feed');
    if (!box) return;
    box.innerHTML = '<p class="text-muted text-center" style="padding:12px;">加载中…</p>';
    const isAdmin = isAdminUser();
    try {
      const data = await api('GET', '/api/dashboard/feed');
      // 视图依据：前端的 S.user.role；items 用后端返回的（缺则空数组）
      if (isAdmin) {
        $('#dash-feed-title').textContent = '近 15 天各单位更新条数';
        renderAdminFeed(data.items || []);
      } else {
        $('#dash-feed-title').textContent = '近 1 个月下发的事项';
        renderUserFeed(data.items || []);
      }
    } catch (err) {
      box.innerHTML = `<p class="text-center" style="padding:12px;color:#dc2626;">加载失败: ${esc(err.message)}<br><small>提示：服务端可能未重启或接口路径异常</small></p>`;
    }
  }

  function renderAdminFeed(rows) {
    const box = $('#dash-feed');
    if (!rows.length) {
      box.innerHTML = '<p class="text-muted text-center" style="padding:12px;">近 15 天暂无单位更新</p>';
      return;
    }
    box.innerHTML = `
      <table class="unit-issue-table">
        <thead><tr>
          <th style="min-width:60px;">排名</th>
          <th>单位</th>
          <th style="min-width:120px;text-align:right;">更新条数</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${esc(r.unit || '未分配')}</td>
              <td style="text-align:right;font-weight:600;">${r.cnt}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderUserFeed(rows) {
    const box = $('#dash-feed');
    if (!rows.length) {
      box.innerHTML = '<p class="text-muted text-center" style="padding:12px;">近 1 个月暂无新下发事项</p>';
      return;
    }
    box.innerHTML = `
      <table class="unit-issue-table">
        <thead><tr>
          <th style="min-width:96px;">下发时间</th>
          <th style="min-width:120px;">责任主体</th>
          <th>工作任务</th>
          <th style="min-width:80px;">责任人</th>
          <th style="min-width:96px;">完成日期</th>
          <th style="min-width:80px;">状态</th>
        </tr></thead>
        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${formatDate(t.created_at)}</td>
              <td>${esc(t.responsible_unit)}</td>
              <td style="white-space:pre-wrap;">${esc(t.task_content)}</td>
              <td>${esc(t.responsible_person)}</td>
              <td>${formatDate(t.deadline)}</td>
              <td>${statusBadge(t.completion_status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ═══════════════════════════════════════════════════
  //  已通报（标记 / 取消）+ 折叠开关（已挪到统计页）
  // ═══════════════════════════════════════════════════
  async function notifyTask(taskId) {
    try {
      await api('POST', '/api/me/notified/' + taskId);
      // 刷新所在的统计 overall 视图
      await loadStats();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function unnotifyTask(taskId) {
    try {
      await api('DELETE', '/api/me/notified/' + taskId);
      await loadStats();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function setFoldNotifiedPref(checked) {
    if (S.user) {
      if (!S.user.preferences) S.user.preferences = {};
      S.user.preferences.foldNotified = checked;
    }
    try {
      await api('PUT', '/api/me/preferences', { foldNotified: checked });
    } catch (err) { /* 静默 */ }
    // 即时更新统计页里的折叠
    $$('#stats-overall-charts tr.notified').forEach(tr => tr.classList.toggle('folded', checked));
  }

  // ═══════════════════════════════════════════════════
  //  统计页 Tab + 各单位按钮式
  // ═══════════════════════════════════════════════════
  S.statsTab = 'overall';
  S.statsCache = null; // { allTasks, unitsWithTasks }

  function switchStatsTab(tab) {
    // 非管理员只允许 byunit 视图（不显示 tab 栏）
    if (!isAdminUser()) tab = 'byunit';
    S.statsTab = tab;
    $$('#stats-tab-nav .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#stats-tab-overall').classList.toggle('active', tab === 'overall');
    $('#stats-tab-byunit').classList.toggle('active', tab === 'byunit');
    if (tab === 'overall') renderStatsOverall();
    else renderStatsByUnit();
  }

  function isAdminUser() {
    return !!(S.user && S.user.role === 'admin');
  }

  function renderStatsOverall() {
    if (!S.statsCache) return;
    const { allTasks } = S.statsCache;
    const target = $('#stats-overall-charts');
    const fold = !!($('#toggle-fold-notified') && $('#toggle-fold-notified').checked);
    const notifiedSet = S.notifiedIds || new Set();
    target.innerHTML = `
      <div class="stats-unit-block">
        <div class="unit-title">总览</div>
        <div class="chart-row">
          <div class="chart-card"><h4>完成状态分布</h4><canvas id="ov-chart-status"></canvas></div>
          <div class="chart-card"><h4>各任务类别完成情况</h4><canvas id="ov-chart-category"></canvas></div>
        </div>
        <div class="unit-title" style="margin-top:18px;">全部 临期 / 超期 / 终止 事项</div>
        ${renderUnitTaskDetails(allTasks, { withNotify: true, notifiedSet, fold })}
      </div>`;
    renderStatusDoughnut($('#ov-chart-status'), allTasks);
    renderCategoryBar($('#ov-chart-category'), allTasks);
  }

  function renderStatsByUnit() {
    if (!S.statsCache) return;
    const { allTasks, unitsWithTasks } = S.statsCache;
    const bar = $('#stats-unit-buttons');
    bar.innerHTML = unitsWithTasks.map((u, i) =>
      `<button class="unit-btn${i === 0 ? ' active' : ''}" data-unit="${esc(u)}">${esc(u)}</button>`
    ).join('') || '<span class="text-muted">暂无单位任务数据</span>';
    bar.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderUnitStatsBlock(btn.dataset.unit, allTasks);
      });
    });
    if (unitsWithTasks.length > 0) {
      renderUnitStatsBlock(unitsWithTasks[0], allTasks);
    } else {
      $('#stats-unit-content').innerHTML = '';
    }
  }

  function renderUnitStatsBlock(unit, allTasks) {
    const unitTasks = allTasks.filter(t => t.responsible_unit === unit);
    const target = $('#stats-unit-content');
    target.innerHTML = `
      <div class="stats-unit-block">
        <div class="unit-title">${esc(unit)}</div>
        <div class="chart-row">
          <div class="chart-card"><h4>完成状态分布</h4><canvas id="u-chart-status"></canvas></div>
          <div class="chart-card"><h4>各任务类别完成情况</h4><canvas id="u-chart-category"></canvas></div>
        </div>
        ${renderUnitTaskDetails(unitTasks)}
      </div>`;
    renderStatusDoughnut($('#u-chart-status'), unitTasks);
    renderCategoryBar($('#u-chart-category'), unitTasks);
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
    $('#btn-filter-reset').addEventListener('click', () => {
      $('#filter-keyword').value = '';
      S.colFilters = {};
      S.colSort = { col: '', dir: '' };
      S.dateRange = { from: '', to: '' };
      loadTasks();
    });
    // 关键词输入即时筛选
    $('#filter-keyword').addEventListener('input', debounce(loadTasks, 300));
    $('#filter-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') loadTasks(); });

    // 列头筛选弹层
    bindColFilters();

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
    $$('#stats-tab-nav .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchStatsTab(btn.dataset.tab));
    });

    // 列设置
    $('#btn-col-settings').addEventListener('click', openColSettings);
    $('#btn-save-col-settings').addEventListener('click', saveColSettings);

    // 工作台单位事项
    $('#btn-refresh-issues').addEventListener('click', loadDashboardUnitIssues);
    $('#toggle-fold-notified').addEventListener('change', e => setFoldNotifiedPref(e.target.checked));

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
    notifyTask,
    unnotifyTask,
  };

  // ─── Init ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    tryAutoLogin();
  });

})();
