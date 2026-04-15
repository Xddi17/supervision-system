-- 督办管理系统 数据库初始化脚本
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS supervision_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE supervision_db;

-- ========== 单位名单 ==========
CREATE TABLE IF NOT EXISTS units (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL UNIQUE,
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ========== 用户 ==========
CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  name           VARCHAR(100) NOT NULL,
  phone          VARCHAR(50) DEFAULT '',
  unit           VARCHAR(200) DEFAULT '' COMMENT '注册时填写的所属单位',
  role           ENUM('admin','user') DEFAULT 'user',
  status         ENUM('pending','approved','rejected','disabled') DEFAULT 'pending',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at    DATETIME DEFAULT NULL,
  approved_by    INT DEFAULT NULL
) ENGINE=InnoDB;

-- ========== 用户单位权限（多对多） ==========
CREATE TABLE IF NOT EXISTS user_unit_permissions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  unit_name   VARCHAR(200) NOT NULL,
  granted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  granted_by  INT DEFAULT NULL,
  UNIQUE KEY uq_user_unit (user_id, unit_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ========== 会话 ==========
CREATE TABLE IF NOT EXISTS sessions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token       VARCHAR(255) NOT NULL UNIQUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ========== 督办任务 ==========
CREATE TABLE IF NOT EXISTS supervision_tasks (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  task_no             VARCHAR(50) DEFAULT '' COMMENT '编号',
  responsible_unit    VARCHAR(200) DEFAULT '' COMMENT '责任主体',
  task_content        TEXT COMMENT '工作任务',
  lead_leader         VARCHAR(100) DEFAULT '' COMMENT '牵头领导',
  responsible_person  VARCHAR(100) DEFAULT '' COMMENT '责任人',
  deadline            DATE DEFAULT NULL COMMENT '要求完成日期',
  progress            TEXT COMMENT '进度情况',
  completion_status   VARCHAR(50) DEFAULT '推进中' COMMENT '是否完成',
  blockers            TEXT COMMENT '遇到堵点',
  coordination        TEXT COMMENT '需要领导协调解决的事项',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by          VARCHAR(100) DEFAULT '',
  import_batch_id     INT DEFAULT NULL
) ENGINE=InnoDB;

-- ========== 证明材料附件 ==========
CREATE TABLE IF NOT EXISTS task_attachments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  task_id      INT NOT NULL,
  file_name    VARCHAR(500) NOT NULL COMMENT '原始文件名',
  stored_name  VARCHAR(500) NOT NULL COMMENT '存储文件名',
  file_path    VARCHAR(1000) NOT NULL,
  file_size    BIGINT DEFAULT 0,
  mime_type    VARCHAR(200) DEFAULT '',
  uploaded_by  INT NOT NULL,
  uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES supervision_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ========== Excel 导入批次 ==========
CREATE TABLE IF NOT EXISTS import_batches (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  file_name      VARCHAR(500) DEFAULT '',
  total_rows     INT DEFAULT 0,
  success_rows   INT DEFAULT 0,
  fail_rows      INT DEFAULT 0,
  imported_by    INT NOT NULL,
  imported_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (imported_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ========== 导入明细 ==========
CREATE TABLE IF NOT EXISTS import_rows (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  batch_id    INT NOT NULL,
  `row_number`  INT DEFAULT 0,
  status      ENUM('success','fail') DEFAULT 'success',
  error_msg   VARCHAR(500) DEFAULT '',
  raw_data    JSON,
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ========== 操作日志 ==========
CREATE TABLE IF NOT EXISTS operation_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT DEFAULT NULL,
  username    VARCHAR(100) DEFAULT '',
  action      VARCHAR(100) NOT NULL COMMENT '操作类型',
  target_type VARCHAR(50) DEFAULT '' COMMENT '操作对象类型: task/attachment/user/import',
  target_id   INT DEFAULT NULL,
  detail      TEXT COMMENT '操作详情',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ========== 默认管理员 ==========
-- 密码将由 Node.js 应用层在首次启动时创建（scrypt 哈希）
-- 这里不硬编码密码

-- ========== 索引 ==========
CREATE INDEX idx_tasks_unit ON supervision_tasks(responsible_unit);
CREATE INDEX idx_tasks_status ON supervision_tasks(completion_status);
CREATE INDEX idx_tasks_deadline ON supervision_tasks(deadline);
CREATE INDEX idx_attachments_task ON task_attachments(task_id);
CREATE INDEX idx_logs_created ON operation_logs(created_at);
CREATE INDEX idx_logs_action ON operation_logs(action);
