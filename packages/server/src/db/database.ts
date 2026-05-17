import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

const MAF_HOME = process.env.MAF_HOME || path.join(os.homedir(), '.meta-agent-framework');
const DB_PATH = process.env.DB_PATH || path.join(MAF_HOME, 'data', 'meta-agent.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables(db);
  }
  return db;
}

function initTables(db: Database.Database): void {
  db.exec(`
    -- Agent 注册表
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      host_user TEXT NOT NULL DEFAULT '',
      client_endpoint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      last_heartbeat TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      capabilities TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'subagent',
      runtime TEXT NOT NULL DEFAULT 'opencode',
      skills TEXT NOT NULL DEFAULT '[]',
      mcps TEXT NOT NULL DEFAULT '[]',
      client_version TEXT NOT NULL DEFAULT '',
      plugin_hash TEXT NOT NULL DEFAULT '',
      daemon_port INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL,
      UNIQUE(user_id, host_user, agent_name)
    );

    

    -- 任务表
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'custom',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_agent_id TEXT,
      assigned_agent_name TEXT,
      assigned_user TEXT,
      result TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    -- Feedback 记录表
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      token_input INTEGER NOT NULL DEFAULT 0,
      token_output INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      score REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    -- Proposal 提议表（Client → Server 逆向通道）
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL DEFAULT '',
      suggested_fix TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '[]',
      source_path TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      review_comment TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_task ON feedback(task_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_agent ON proposals(from_agent);
    CREATE INDEX IF NOT EXISTS idx_proposals_type ON proposals(type);
  `);

  // 兼容旧数据库：自动迁移缺失列
  migrateColumns(db);
}

function migrateColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('agents')").all() as { name: string }[];
  const colNames = new Set(columns.map(c => c.name));

  const migrations: [string, string][] = [
    ['runtime',        "ALTER TABLE agents ADD COLUMN runtime TEXT NOT NULL DEFAULT 'opencode'"],
    ['skills',         "ALTER TABLE agents ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'"],
    ['mcps',           "ALTER TABLE agents ADD COLUMN mcps TEXT NOT NULL DEFAULT '[]'"],
    ['client_version', "ALTER TABLE agents ADD COLUMN client_version TEXT NOT NULL DEFAULT ''"],
    ['plugin_hash',    "ALTER TABLE agents ADD COLUMN plugin_hash TEXT NOT NULL DEFAULT ''"],
    ['daemon_port',    "ALTER TABLE agents ADD COLUMN daemon_port INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) {
      db.exec(sql);
      console.log(`[DB] Migration: added ${col} column to agents table`);
    }
  }

  // feishu_user → user_id 重命名迁移（v0.5.0）
  if (colNames.has('feishu_user') && !colNames.has('user_id')) {
    db.exec("ALTER TABLE agents RENAME COLUMN feishu_user TO user_id");
    console.log('[DB] Migration: renamed feishu_user → user_id in agents table');

    // feedback 表
    const fbCols = db.prepare("PRAGMA table_info('feedback')").all() as { name: string }[];
    if (fbCols.some(c => c.name === 'feishu_user')) {
      db.exec("ALTER TABLE feedback RENAME COLUMN feishu_user TO user_id");
      console.log('[DB] Migration: renamed feishu_user → user_id in feedback table');
    }

    // proposals 表
    const prCols = db.prepare("PRAGMA table_info('proposals')").all() as { name: string }[];
    if (prCols.some(c => c.name === 'feishu_user')) {
      db.exec("ALTER TABLE proposals RENAME COLUMN feishu_user TO user_id");
      console.log('[DB] Migration: renamed feishu_user → user_id in proposals table');
    }
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
