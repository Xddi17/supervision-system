/**
 * 督办管理系统 - 后端服务
 * Node.js + Express + MySQL
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

// ─── 配置 ───────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const BCRYPT_ROUNDS = 10;

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'supervision_db',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+08:00'
};

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'Admin123!',
  name: '系统管理员'
};

// ─── 初始化 ──────────────────────────────────────────
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
let pool; // MySQL 连接池

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// multer 配置
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── 工具函数 ─────────────────────────────────────────
function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 把 Excel 序列值 / 各种日期字符串 转换为 YYYY-MM-DD
 */
function parseExcelDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d{4,6}$/.test(String(value).trim())) {
    const num = Number(value);
    if (num > 30000 && num < 100000) {
      const epoch = new Date(1900, 0, 1);
      epoch.setDate(epoch.getDate() + num - 2);
      const y = epoch.getFullYear();
      const m = String(epoch.getMonth() + 1).padStart(2, '0');
      const d = String(epoch.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const text = String(value).trim();
  const d = new Date(text);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const match = text.match(/(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return null;
}

// ─── 数据库初始化 ──────────────────────────────────────
async function initDatabase() {
  pool = mysql.createPool(DB_CONFIG);
  const conn = await pool.getConnection();
  console.log('MySQL 连接成功');
  conn.release();

  const [admins] = await pool.execute('SELECT id FROM users WHERE username = ?', [DEFAULT_ADMIN.username]);
  if (admins.length === 0) {
    const hash = await bcrypt.hash(DEFAULT_ADMIN.password, BCRYPT_ROUNDS);
    await pool.execute(
      'INSERT INTO users (username, password_hash, name, role, status, approved_at) VALUES (?, ?, ?, ?, ?, ?)',
      [DEFAULT_ADMIN.username, hash, DEFAULT_ADMIN.name, 'admin', 'approved', now()]
    );
    console.log(`默认管理员已创建: ${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
  }
}

// ─── 认证中间件 ──────────────────────────────────────
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: '未登录或登录已过期。' });

  try {
    const [sessions] = await pool.execute('SELECT user_id FROM sessions WHERE token = ?', [token]);
    if (sessions.length === 0) return res.status(401).json({ message: '会话无效，请重新登录。' });

    const userId = sessions[0].user_id;
    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.status(401).json({ message: '用户不存在。' });

    const user = users[0];
    if (user.status !== 'approved') return res.status(403).json({ message: '账号未通过审核或已停用。' });

    const [perms] = await pool.execute('SELECT unit_name FROM user_unit_permissions WHERE user_id = ?', [userId]);
    user.unitPermissions = perms.map(p => p.unit_name);

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('认证错误:', err);
    res.status(500).json({ message: '服务器内部错误。' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '需要管理员权限。' });
  next();
}

function safeUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, phone: u.phone || '',
    unit: u.unit || '', role: u.role, status: u.status,
    created_at: u.created_at, approved_at: u.approved_at,
    unitPermissions: u.unitPermissions || []
  };
}

async function getVisibleUnits(user) {
  if (user.role === 'admin') return null;
  return user.unitPermissions || [];
}

async function logAction(userId, username, action, targetType, targetId, detail) {
  try {
    await pool.execute(
      'INSERT INTO operation_logs (user_id, username, action, target_type, target_id, detail, created_at) VALUES (?,?,?,?,?,?,?)',
      [userId, username, action, targetType, targetId, detail, now()]
    );
  } catch (e) {
    console.error('写日志失败:', e.message);
  }
}

// ═══════════════════════════════════════════════════════
//  认证接口
// ═══════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const unit = String(req.body.unit || '').trim();
    if (!name || !username || !password || !unit) {
      return res.status(400).json({ message: '姓名、用户名、密码、单位不能为空。' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: '密码不能少于6位。' });
    }
    const [existing] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(400).json({ message: '该用户名已存在。' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.execute(
      'INSERT INTO users (username, password_hash, name, unit, role, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [username, hash, name, unit, 'user', 'pending', now()]
    );
    res.json({ message: '注册成功，请等待管理员审核。' });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ message: '服务器内部错误。' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(400).json({ message: '用户名或密码错误。' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ message: '用户名或密码错误。' });

    if (user.status === 'pending') return res.status(403).json({ message: '账号等待管理员审核中。' });
    if (user.status === 'rejected') return res.status(403).json({ message: '账号未通过审核，请联系管理员。' });
    if (user.status === 'disabled') return res.status(403).json({ message: '账号已停用，请联系管理员。' });

    await pool.execute('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    const token = generateToken();
    await pool.execute('INSERT INTO sessions (user_id, token, created_at) VALUES (?,?,?)', [user.id, token, now()]);

    const [perms] = await pool.execute('SELECT unit_name FROM user_unit_permissions WHERE user_id = ?', [user.id]);
    user.unitPermissions = perms.map(p => p.unit_name);

    await logAction(user.id, user.username, '登录', 'user', user.id, '');
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ message: '服务器内部错误。' });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  await pool.execute('DELETE FROM sessions WHERE token = ?', [req.token]);
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const oldPassword = String(req.body.oldPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!oldPassword || !newPassword) return res.status(400).json({ message: '请填写旧密码和新密码。' });
    if (newPassword.length < 6) return res.status(400).json({ message: '新密码不能少于6位。' });

    const match = await bcrypt.compare(oldPassword, req.user.password_hash);
    if (!match) return res.status(400).json({ message: '旧密码错误。' });

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
    res.json({ ok: true, message: '密码修改成功。' });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  单位名单管理
// ═══════════════════════════════════════════════════════

app.get('/api/units', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM units ORDER BY sort_order, id');
    res.json({ units: rows });
  } catch (err) {
    res.status(500).json({ message: '查询失败。' });
  }
});

app.post('/api/units', authenticate, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: '单位名称不能为空。' });
    const [existing] = await pool.execute('SELECT id FROM units WHERE name = ?', [name]);
    if (existing.length > 0) return res.status(400).json({ message: '该单位已存在。' });
    const sortOrder = Number(req.body.sort_order) || 0;
    const [result] = await pool.execute('INSERT INTO units (name, sort_order) VALUES (?,?)', [name, sortOrder]);
    await logAction(req.user.id, req.user.username, '新增单位', 'unit', result.insertId, name);
    res.json({ id: result.insertId, name, sort_order: sortOrder });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

app.put('/api/units/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const sortOrder = Number(req.body.sort_order) || 0;
    if (!name) return res.status(400).json({ message: '单位名称不能为空。' });
    await pool.execute('UPDATE units SET name=?, sort_order=? WHERE id=?', [name, sortOrder, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

app.delete('/api/units/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM units WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '删除失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  用户管理（管理员）
// ═══════════════════════════════════════════════════════

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT * FROM users ORDER BY created_at DESC');
    for (const u of users) {
      const [perms] = await pool.execute('SELECT unit_name FROM user_unit_permissions WHERE user_id = ?', [u.id]);
      u.unitPermissions = perms.map(p => p.unit_name);
    }
    res.json({ users: users.map(safeUser) });
  } catch (err) {
    res.status(500).json({ message: '查询失败。' });
  }
});

app.get('/api/admin/pending-users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE status = ? ORDER BY created_at DESC', ['pending']);
    res.json({ users: users.map(safeUser) });
  } catch (err) {
    res.status(500).json({ message: '查询失败。' });
  }
});

app.post('/api/admin/users/:userId/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const status = String(req.body.status || '').trim();
    const unitPermissions = Array.isArray(req.body.unitPermissions) ? req.body.unitPermissions : [];

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: '审核状态不合法。' });
    }
    if (status === 'approved' && unitPermissions.length === 0) {
      return res.status(400).json({ message: '审核通过时必须至少选择一个单位权限。' });
    }

    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.status(404).json({ message: '用户不存在。' });

    await pool.execute('UPDATE users SET status=?, approved_at=?, approved_by=? WHERE id=?',
      [status, status === 'approved' ? now() : null, req.user.id, userId]);

    if (status === 'approved') {
      await pool.execute('DELETE FROM user_unit_permissions WHERE user_id = ?', [userId]);
      for (const unitName of unitPermissions) {
        await pool.execute(
          'INSERT INTO user_unit_permissions (user_id, unit_name, granted_at, granted_by) VALUES (?,?,?,?)',
          [userId, unitName, now(), req.user.id]
        );
      }
    }

    await logAction(req.user.id, req.user.username, status === 'approved' ? '审核通过' : '审核拒绝', 'user', userId,
      `单位权限: ${unitPermissions.join(', ')}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('审核失败:', err);
    res.status(500).json({ message: '操作失败。' });
  }
});

app.post('/api/admin/users/:userId/permissions', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const unitPermissions = Array.isArray(req.body.unitPermissions) ? req.body.unitPermissions : [];
    await pool.execute('DELETE FROM user_unit_permissions WHERE user_id = ?', [userId]);
    for (const unitName of unitPermissions) {
      await pool.execute(
        'INSERT INTO user_unit_permissions (user_id, unit_name, granted_at, granted_by) VALUES (?,?,?,?)',
        [userId, unitName, now(), req.user.id]
      );
    }
    await logAction(req.user.id, req.user.username, '修改权限', 'user', userId, `新权限: ${unitPermissions.join(', ')}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

app.post('/api/admin/users/:userId/reset-password', authenticate, requireAdmin, async (req, res) => {
  try {
    const newPassword = String(req.body.password || '').trim();
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: '新密码不能少于6位。' });
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.userId]);
    await logAction(req.user.id, req.user.username, '重置密码', 'user', req.params.userId, '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

app.post('/api/admin/users/:userId/toggle-status', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.params.userId]);
    if (users.length === 0) return res.status(404).json({ message: '用户不存在。' });
    const user = users[0];
    if (user.role === 'admin') return res.status(400).json({ message: '不能停用管理员账号。' });
    const newStatus = user.status === 'disabled' ? 'approved' : 'disabled';
    await pool.execute('UPDATE users SET status=? WHERE id=?', [newStatus, user.id]);
    if (newStatus === 'disabled') {
      await pool.execute('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    }
    await logAction(req.user.id, req.user.username, newStatus === 'disabled' ? '停用账号' : '启用账号', 'user', user.id, '');
    res.json({ ok: true, newStatus });
  } catch (err) {
    res.status(500).json({ message: '操作失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  督办任务 CRUD
// ═══════════════════════════════════════════════════════

app.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const visibleUnits = await getVisibleUnits(req.user);
    let sql = 'SELECT * FROM supervision_tasks';
    const params = [];
    const whereParts = [];

    if (visibleUnits !== null) {
      if (visibleUnits.length === 0) return res.json({ tasks: [] });
      whereParts.push(`responsible_unit IN (${visibleUnits.map(() => '?').join(',')})`);
      params.push(...visibleUnits);
    }

    const { status, unit, keyword, deadline_from, deadline_to } = req.query;
    if (status) { whereParts.push('completion_status = ?'); params.push(status); }
    if (unit && (visibleUnits === null || visibleUnits.includes(unit))) {
      whereParts.push('responsible_unit = ?'); params.push(unit);
    }
    if (keyword) {
      whereParts.push('(task_content LIKE ? OR task_no LIKE ? OR lead_leader LIKE ? OR responsible_person LIKE ?)');
      const kw = `%${keyword}%`; params.push(kw, kw, kw, kw);
    }
    if (deadline_from) { whereParts.push('deadline >= ?'); params.push(deadline_from); }
    if (deadline_to) { whereParts.push('deadline <= ?'); params.push(deadline_to); }

    if (whereParts.length > 0) sql += ' WHERE ' + whereParts.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const [tasks] = await pool.execute(sql, params);

    if (tasks.length > 0) {
      const taskIds = tasks.map(t => t.id);
      const [attachments] = await pool.execute(
        `SELECT id, task_id, file_name, stored_name, file_size, mime_type, uploaded_at FROM task_attachments WHERE task_id IN (${taskIds.map(() => '?').join(',')})`,
        taskIds
      );
      const attachmentMap = {};
      for (const att of attachments) {
        if (!attachmentMap[att.task_id]) attachmentMap[att.task_id] = [];
        attachmentMap[att.task_id].push(att);
      }
      for (const t of tasks) { t.attachments = attachmentMap[t.id] || []; }
    }

    res.json({ tasks });
  } catch (err) {
    console.error('查询任务失败:', err);
    res.status(500).json({ message: '查询失败。' });
  }
});

app.post('/api/tasks', authenticate, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const [result] = await pool.execute(
      `INSERT INTO supervision_tasks
        (task_no, responsible_unit, task_content, lead_leader, responsible_person, deadline, progress, completion_status, blockers, coordination, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String(b.task_no || '').trim(), String(b.responsible_unit || '').trim(),
        String(b.task_content || '').trim(), String(b.lead_leader || '').trim(),
        String(b.responsible_person || '').trim(), parseExcelDate(b.deadline),
        String(b.progress || '').trim(), String(b.completion_status || '推进中').trim(),
        String(b.blockers || '').trim(), String(b.coordination || '').trim(),
        req.user.name, now(), now()
      ]
    );
    await logAction(req.user.id, req.user.username, '新增任务', 'task', result.insertId, b.task_content || '');
    const [rows] = await pool.execute('SELECT * FROM supervision_tasks WHERE id = ?', [result.insertId]);
    rows[0].attachments = [];
    res.json({ task: rows[0] });
  } catch (err) {
    console.error('新增任务失败:', err);
    res.status(500).json({ message: '操作失败。' });
  }
});

app.put('/api/tasks/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    await pool.execute(
      `UPDATE supervision_tasks SET
        task_no=?, responsible_unit=?, task_content=?, lead_leader=?, responsible_person=?,
        deadline=?, progress=?, completion_status=?, blockers=?, coordination=?, updated_by=?, updated_at=?
       WHERE id=?`,
      [
        String(b.task_no || '').trim(), String(b.responsible_unit || '').trim(),
        String(b.task_content || '').trim(), String(b.lead_leader || '').trim(),
        String(b.responsible_person || '').trim(), parseExcelDate(b.deadline),
        String(b.progress || '').trim(), String(b.completion_status || '推进中').trim(),
        String(b.blockers || '').trim(), String(b.coordination || '').trim(),
        req.user.name, now(), req.params.id
      ]
    );
    await logAction(req.user.id, req.user.username, '编辑任务', 'task', req.params.id, '');
    res.json({ ok: true });
  } catch (err) {
    console.error('编辑任务失败:', err);
    res.status(500).json({ message: '操作失败。' });
  }
});

app.put('/api/tasks/:id/progress', authenticate, async (req, res) => {
  try {
    const [tasks] = await pool.execute('SELECT * FROM supervision_tasks WHERE id = ?', [req.params.id]);
    if (tasks.length === 0) return res.status(404).json({ message: '任务不存在。' });
    const task = tasks[0];

    if (req.user.role !== 'admin') {
      const visibleUnits = req.user.unitPermissions || [];
      if (!visibleUnits.includes(task.responsible_unit)) {
        return res.status(403).json({ message: '没有权限操作此任务。' });
      }
    }

    const fields = {};
    if (req.body.progress !== undefined) fields.progress = String(req.body.progress).trim();
    if (req.body.completion_status !== undefined) fields.completion_status = String(req.body.completion_status).trim();
    if (req.body.blockers !== undefined) fields.blockers = String(req.body.blockers).trim();
    if (req.body.coordination !== undefined) fields.coordination = String(req.body.coordination).trim();

    const setClauses = Object.keys(fields).map(k => `${k}=?`);
    setClauses.push('updated_by=?', 'updated_at=?');
    const values = [...Object.values(fields), req.user.name, now(), req.params.id];

    await pool.execute(`UPDATE supervision_tasks SET ${setClauses.join(',')} WHERE id=?`, values);
    await logAction(req.user.id, req.user.username, '更新进度', 'task', req.params.id, '');
    res.json({ ok: true });
  } catch (err) {
    console.error('更新进度失败:', err);
    res.status(500).json({ message: '操作失败。' });
  }
});

app.delete('/api/tasks/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [attachments] = await pool.execute('SELECT file_path FROM task_attachments WHERE task_id = ?', [req.params.id]);
    for (const att of attachments) {
      try { fs.unlinkSync(att.file_path); } catch (e) { /* ignore */ }
    }
    await pool.execute('DELETE FROM supervision_tasks WHERE id = ?', [req.params.id]);
    await logAction(req.user.id, req.user.username, '删除任务', 'task', req.params.id, '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '删除失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  附件管理
// ═══════════════════════════════════════════════════════

app.post('/api/tasks/:taskId/attachments', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const [tasks] = await pool.execute('SELECT * FROM supervision_tasks WHERE id = ?', [taskId]);
    if (tasks.length === 0) return res.status(404).json({ message: '任务不存在。' });

    if (req.user.role !== 'admin') {
      const visibleUnits = req.user.unitPermissions || [];
      if (!visibleUnits.includes(tasks[0].responsible_unit)) {
        return res.status(403).json({ message: '没有权限操作此任务的附件。' });
      }
    }

    const results = [];
    for (const file of (req.files || [])) {
      const [result] = await pool.execute(
        'INSERT INTO task_attachments (task_id, file_name, stored_name, file_path, file_size, mime_type, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?)',
        [taskId, file.originalname, file.filename, file.path, file.size, file.mimetype, req.user.id, now()]
      );
      results.push({
        id: result.insertId, task_id: Number(taskId),
        file_name: file.originalname, stored_name: file.filename,
        file_size: file.size, mime_type: file.mimetype
      });
    }

    await logAction(req.user.id, req.user.username, '上传附件', 'attachment', taskId, `${results.length}个文件`);
    await pool.execute('UPDATE supervision_tasks SET updated_by=?, updated_at=? WHERE id=?', [req.user.name, now(), taskId]);

    res.json({ attachments: results });
  } catch (err) {
    console.error('上传附件失败:', err);
    res.status(500).json({ message: '上传失败。' });
  }
});

app.get('/api/attachments/:id/download', authenticate, async (req, res) => {
  try {
    const [atts] = await pool.execute('SELECT * FROM task_attachments WHERE id = ?', [req.params.id]);
    if (atts.length === 0) return res.status(404).json({ message: '附件不存在。' });

    const att = atts[0];
    if (req.user.role !== 'admin') {
      const [tasks] = await pool.execute('SELECT responsible_unit FROM supervision_tasks WHERE id = ?', [att.task_id]);
      if (tasks.length > 0) {
        const visibleUnits = req.user.unitPermissions || [];
        if (!visibleUnits.includes(tasks[0].responsible_unit)) {
          return res.status(403).json({ message: '没有权限下载此附件。' });
        }
      }
    }

    if (!fs.existsSync(att.file_path)) return res.status(404).json({ message: '文件不存在。' });
    res.download(att.file_path, att.file_name);
  } catch (err) {
    res.status(500).json({ message: '下载失败。' });
  }
});

app.delete('/api/attachments/:id', authenticate, async (req, res) => {
  try {
    const [atts] = await pool.execute('SELECT * FROM task_attachments WHERE id = ?', [req.params.id]);
    if (atts.length === 0) return res.status(404).json({ message: '附件不存在。' });
    const att = atts[0];

    if (req.user.role !== 'admin') {
      const [tasks] = await pool.execute('SELECT responsible_unit FROM supervision_tasks WHERE id = ?', [att.task_id]);
      if (tasks.length > 0) {
        const visibleUnits = req.user.unitPermissions || [];
        if (!visibleUnits.includes(tasks[0].responsible_unit)) {
          return res.status(403).json({ message: '没有权限删除此附件。' });
        }
      }
    }

    try { fs.unlinkSync(att.file_path); } catch (e) { /* ignore */ }
    await pool.execute('DELETE FROM task_attachments WHERE id = ?', [att.id]);
    await logAction(req.user.id, req.user.username, '删除附件', 'attachment', att.task_id, att.file_name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '删除失败。' });
  }
});

app.put('/api/attachments/:id', authenticate, upload.single('file'), async (req, res) => {
  try {
    const [atts] = await pool.execute('SELECT * FROM task_attachments WHERE id = ?', [req.params.id]);
    if (atts.length === 0) return res.status(404).json({ message: '附件不存在。' });
    if (!req.file) return res.status(400).json({ message: '请上传替换文件。' });
    const att = atts[0];

    if (req.user.role !== 'admin') {
      const [tasks] = await pool.execute('SELECT responsible_unit FROM supervision_tasks WHERE id = ?', [att.task_id]);
      if (tasks.length > 0) {
        const visibleUnits = req.user.unitPermissions || [];
        if (!visibleUnits.includes(tasks[0].responsible_unit)) {
          return res.status(403).json({ message: '没有权限替换此附件。' });
        }
      }
    }

    try { fs.unlinkSync(att.file_path); } catch (e) { /* ignore */ }

    await pool.execute(
      'UPDATE task_attachments SET file_name=?, stored_name=?, file_path=?, file_size=?, mime_type=?, uploaded_by=?, uploaded_at=? WHERE id=?',
      [req.file.originalname, req.file.filename, req.file.path, req.file.size, req.file.mimetype, req.user.id, now(), att.id]
    );
    await logAction(req.user.id, req.user.username, '替换附件', 'attachment', att.task_id, att.file_name + ' -> ' + req.file.originalname);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: '替换失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  Excel 导入 / 导出
// ═══════════════════════════════════════════════════════

app.post('/api/tasks/import', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 Excel 文件。' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(allRows.length, 10); i++) {
      const row = allRows[i].map(c => String(c).trim());
      if (row.some(c => c === '编号' || c === '责任主体' || c === '工作任务')) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      return res.status(400).json({ message: '未找到有效表头（需包含"编号"或"责任主体"列）。' });
    }

    const headers = allRows[headerRowIndex].map(c => String(c).trim());
    const colMap = {};
    const fieldMapping = {
      '编号': 'task_no', '责任主体': 'responsible_unit', '工作任务': 'task_content',
      '牵头领导': 'lead_leader', '责任人': 'responsible_person', '要求完成日期': 'deadline'
    };
    for (let i = 0; i < headers.length; i++) {
      if (fieldMapping[headers[i]]) colMap[fieldMapping[headers[i]]] = i;
    }

    const [batchResult] = await pool.execute(
      'INSERT INTO import_batches (file_name, total_rows, imported_by, imported_at) VALUES (?,?,?,?)',
      [req.file.originalname, 0, req.user.id, now()]
    );
    const batchId = batchResult.insertId;

    const dataRows = allRows.slice(headerRowIndex + 1).filter(row => row.some(c => String(c).trim() !== ''));
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        const getValue = (field) => colMap[field] !== undefined ? String(row[colMap[field]] || '').trim() : '';
        const taskNo = getValue('task_no');
        const responsibleUnit = getValue('responsible_unit');
        const taskContent = getValue('task_content');
        const leadLeader = getValue('lead_leader');
        const responsiblePerson = getValue('responsible_person');
        const deadline = parseExcelDate(colMap['deadline'] !== undefined ? row[colMap['deadline']] : '');

        if (!taskContent && !responsibleUnit) {
          await pool.execute(
            'INSERT INTO import_rows (batch_id, `row_number`, status, error_msg, raw_data) VALUES (?,?,?,?,?)',
            [batchId, headerRowIndex + 2 + i, 'fail', '空行', JSON.stringify(row)]
          );
          failCount++;
          continue;
        }

        await pool.execute(
          `INSERT INTO supervision_tasks
            (task_no, responsible_unit, task_content, lead_leader, responsible_person, deadline, completion_status, updated_by, import_batch_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [taskNo, responsibleUnit, taskContent, leadLeader, responsiblePerson, deadline, '推进中', req.user.name, batchId, now(), now()]
        );
        await pool.execute(
          'INSERT INTO import_rows (batch_id, `row_number`, status, raw_data) VALUES (?,?,?,?)',
          [batchId, headerRowIndex + 2 + i, 'success', JSON.stringify(row)]
        );
        successCount++;
      } catch (rowErr) {
        await pool.execute(
          'INSERT INTO import_rows (batch_id, `row_number`, status, error_msg, raw_data) VALUES (?,?,?,?,?)',
          [batchId, headerRowIndex + 2 + i, 'fail', rowErr.message, JSON.stringify(row)]
        );
        failCount++;
      }
    }

    await pool.execute(
      'UPDATE import_batches SET total_rows=?, success_rows=?, fail_rows=? WHERE id=?',
      [successCount + failCount, successCount, failCount, batchId]
    );

    await logAction(req.user.id, req.user.username, 'Excel导入', 'import', batchId,
      `文件: ${req.file.originalname}, 成功: ${successCount}, 失败: ${failCount}`);

    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json({ batchId, total: successCount + failCount, success: successCount, fail: failCount });
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ message: '导入失败: ' + err.message });
  }
});

app.get('/api/tasks/export', authenticate, async (req, res) => {
  try {
    const visibleUnits = await getVisibleUnits(req.user);
    let sql = 'SELECT * FROM supervision_tasks';
    const params = [];

    if (visibleUnits !== null) {
      if (visibleUnits.length === 0) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([['编号', '责任主体', '工作任务', '牵头领导', '责任人', '要求完成日期', '进度情况', '是否完成']]);
        XLSX.utils.book_append_sheet(wb, ws, '督办台账');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="supervision_export.xlsx"');
        return res.send(buffer);
      }
      sql += ` WHERE responsible_unit IN (${visibleUnits.map(() => '?').join(',')})`;
      params.push(...visibleUnits);
    }
    sql += ' ORDER BY task_no, created_at';

    const [tasks] = await pool.execute(sql, params);

    const data = [['编号', '责任主体', '工作任务', '牵头领导', '责任人', '要求完成日期', '进度情况', '是否完成', '遇到堵点', '需要领导协调解决的事项']];
    for (const t of tasks) {
      data.push([
        t.task_no, t.responsible_unit, t.task_content, t.lead_leader, t.responsible_person,
        t.deadline ? String(t.deadline).slice(0, 10) : '', t.progress || '', t.completion_status,
        t.blockers || '', t.coordination || ''
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 8 }, { wch: 20 }, { wch: 50 }, { wch: 12 }, { wch: 12 },
      { wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 30 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, '督办台账');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="supervision_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ message: '导出失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  统计接口
// ═══════════════════════════════════════════════════════
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const visibleUnits = await getVisibleUnits(req.user);
    let whereClause = '';
    const params = [];

    if (visibleUnits !== null) {
      if (visibleUnits.length === 0) {
        return res.json({ total: 0, completed: 0, inProgress: 0, overdue: 0, byUnit: [], byStatus: [] });
      }
      whereClause = ` WHERE responsible_unit IN (${visibleUnits.map(() => '?').join(',')})`;
      params.push(...visibleUnits);
    }

    const [totalRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}`, params);
    const [completedRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} completion_status = '已完成'`, params);
    const [inProgressRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} completion_status = '推进中'`, params);
    const [overdueRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} deadline < CURDATE() AND completion_status != '已完成'`, params);

    const [byUnit] = await pool.execute(
      `SELECT responsible_unit as unit, COUNT(*) as total,
        SUM(CASE WHEN completion_status='已完成' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN completion_status='已超期' THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN completion_status='推进中' THEN 1 ELSE 0 END) as \`inProgress\`,
        SUM(CASE WHEN completion_status='已终止' THEN 1 ELSE 0 END) as \`terminated\`
       FROM supervision_tasks${whereClause} GROUP BY responsible_unit ORDER BY total DESC`,
      params
    );

    const [byStatus] = await pool.execute(
      `SELECT completion_status as status, COUNT(*) as cnt FROM supervision_tasks${whereClause} GROUP BY completion_status`,
      params
    );

    res.json({
      total: totalRows[0].cnt, completed: completedRows[0].cnt,
      inProgress: inProgressRows[0].cnt, overdue: overdueRows[0].cnt,
      byUnit, byStatus
    });
  } catch (err) {
    console.error('统计查询失败:', err);
    res.status(500).json({ message: '查询失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  操作日志
// ═══════════════════════════════════════════════════════
app.get('/api/logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const [rows] = await pool.execute(
      'SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [String(limit), String(offset)]
    );
    const [countRows] = await pool.execute('SELECT COUNT(*) as cnt FROM operation_logs');
    res.json({ logs: rows, total: countRows[0].cnt });
  } catch (err) {
    res.status(500).json({ message: '查询失败。' });
  }
});

// ═══════════════════════════════════════════════════════
//  工作台概览
// ═══════════════════════════════════════════════════════
app.get('/api/dashboard', authenticate, async (req, res) => {
  try {
    const visibleUnits = await getVisibleUnits(req.user);
    let whereClause = '';
    const params = [];

    if (visibleUnits !== null) {
      if (visibleUnits.length === 0) {
        return res.json({ taskTotal: 0, taskCompleted: 0, taskInProgress: 0, taskOverdue: 0, pendingUsers: 0, recentTasks: [] });
      }
      whereClause = ` WHERE responsible_unit IN (${visibleUnits.map(() => '?').join(',')})`;
      params.push(...visibleUnits);
    }

    const [totalRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}`, params);
    const [completedRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} completion_status = '已完成'`, params);
    const [inProgressRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} completion_status = '推进中'`, params);
    const [overdueRows] = await pool.execute(`SELECT COUNT(*) as cnt FROM supervision_tasks${whereClause}${whereClause ? ' AND' : ' WHERE'} deadline < CURDATE() AND completion_status != '已完成'`, params);

    let pendingUsers = 0;
    if (req.user.role === 'admin') {
      const [pu] = await pool.execute("SELECT COUNT(*) as cnt FROM users WHERE status = 'pending'");
      pendingUsers = pu[0].cnt;
    }

    const [recentTasks] = await pool.execute(
      `SELECT id, task_no, responsible_unit, task_content, completion_status, deadline, updated_at FROM supervision_tasks${whereClause} ORDER BY updated_at DESC LIMIT 5`,
      params
    );

    res.json({
      taskTotal: totalRows[0].cnt, taskCompleted: completedRows[0].cnt,
      taskInProgress: inProgressRows[0].cnt, taskOverdue: overdueRows[0].cnt,
      pendingUsers, recentTasks
    });
  } catch (err) {
    console.error('仪表盘查询失败:', err);
    res.status(500).json({ message: '查询失败。' });
  }
});

// ─── 导入批次查询 ──────────────────────────────────────
app.get('/api/import-batches', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT b.*, u.username as imported_by_name FROM import_batches b LEFT JOIN users u ON b.imported_by = u.id ORDER BY b.imported_at DESC LIMIT 50'
    );
    res.json({ batches: rows });
  } catch (err) {
    res.status(500).json({ message: '查询失败。' });
  }
});

// ─── SPA fallback ─────────────────────────────────────
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 启动 ─────────────────────────────────────────────
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`督办管理系统已启动: http://0.0.0.0:${PORT}`);
      console.log(`默认管理员: ${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

start();
