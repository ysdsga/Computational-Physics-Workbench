import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'workbench.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ensure research-plans directory exists (new markdown-file based module)
const PLANS_DIR = path.join(__dirname, '..', 'research-plans');
if (!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    material TEXT DEFAULT '',
    working_dir TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    workflow_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS step_progress (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, step_id)
  );

  CREATE TABLE IF NOT EXISTS step_files (
    id TEXT PRIMARY KEY,
    step_progress_id TEXT NOT NULL REFERENCES step_progress(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_remote INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS experiences (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    related_project_id TEXT,
    related_task_id TEXT,
    related_step_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  -- research_plans v2 (2026-07-28): markdown-file based, lightweight metadata
  -- Old v1 with goal/background/methodology/etc. columns is dropped and rebuilt
  DROP TABLE IF EXISTS research_plans;
  CREATE TABLE research_plans (
    id              TEXT PRIMARY KEY,
    file_name       TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    project_id      TEXT,
    linked_task_ids TEXT DEFAULT '[]',
    status          TEXT DEFAULT 'draft',
    tags            TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
`);

// Migrations: add columns to existing tables (safe for fresh and existing DBs)
try {
  db.exec(`ALTER TABLE step_progress ADD COLUMN commands TEXT DEFAULT NULL`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE step_progress ADD COLUMN lsf_script TEXT DEFAULT NULL`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE projects ADD COLUMN hpc_config TEXT DEFAULT NULL`);
} catch { /* column already exists */ }

// research_plans v2 (2026-07-28):
//   Now markdown-file based. The actual content lives in `research-plans/*.md`,
//   and this table only stores lightweight metadata (file_name, title,
//   project_id, linked_task_ids, status, tags).
//   The v1 table (with goal/background/methodology/action_steps/etc.) is
//   dropped and rebuilt above. On startup, the listing route scans the
//   research-plans/ dir and auto-inserts metadata for any *.md without a row.
//   `version` column removed; file mtime is the source of truth for edits.

export default db;
