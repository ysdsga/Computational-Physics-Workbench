import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default: <project root>/data/workbench.db
// Overridable via WORKBENCH_DB_PATH so tests can point at a throwaway DB
// (keeps the real user database untouched).
const DB_PATH = process.env.WORKBENCH_DB_PATH
  ? path.resolve(process.env.WORKBENCH_DB_PATH)
  : path.join(__dirname, '..', 'data', 'workbench.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    workflow_snapshot TEXT DEFAULT NULL,
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

  -- Research plan content lives in each project's working_dir.
  -- This table stores only searchable metadata and associations.
  CREATE TABLE IF NOT EXISTS research_plans (
    id              TEXT PRIMARY KEY,
    file_name       TEXT NOT NULL,
    title           TEXT NOT NULL,
    project_id      TEXT,
    linked_task_ids TEXT DEFAULT '[]',
    status          TEXT DEFAULT 'draft',
    tags            TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(project_id, file_name)
  );
`);

// Older v2 databases made file_name globally unique and were also rebuilt on
// every startup. Convert that constraint once, preserving every metadata row.
// project_id remains nullable only so an old unassigned row is never discarded;
// the API no longer creates or exposes unassigned plans.
const researchPlansTable = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'research_plans'",
).get() as { sql: string } | undefined;
const normalizedResearchPlansSql = researchPlansTable?.sql.replace(/\s+/g, '').toLowerCase() ?? '';
if (!normalizedResearchPlansSql.includes('unique(project_id,file_name)')) {
  const columns = db.prepare('PRAGMA table_info(research_plans)').all() as { name: string }[];
  const columnNames = new Set(columns.map(column => column.name));
  const requiredColumns = [
    'id', 'file_name', 'title', 'project_id', 'linked_task_ids',
    'status', 'tags', 'created_at', 'updated_at',
  ];
  if (!requiredColumns.every(column => columnNames.has(column))) {
    throw new Error('Unsupported legacy research_plans schema; database was left unchanged');
  }

  const backupPath = path.join(
    path.dirname(DB_PATH),
    `${path.basename(DB_PATH, path.extname(DB_PATH))}.before-research-plans-v3.db`,
  );
  if (!fs.existsSync(backupPath)) {
    const escapedBackupPath = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedBackupPath}'`);
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE research_plans_project_scoped (
        id              TEXT PRIMARY KEY,
        file_name       TEXT NOT NULL,
        title           TEXT NOT NULL,
        project_id      TEXT,
        linked_task_ids TEXT DEFAULT '[]',
        status          TEXT DEFAULT 'draft',
        tags            TEXT DEFAULT '[]',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(project_id, file_name)
      );
      INSERT INTO research_plans_project_scoped
        (id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at)
      SELECT id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at
      FROM research_plans;
      DROP TABLE research_plans;
      ALTER TABLE research_plans_project_scoped RENAME TO research_plans;
    `);
  })();
}

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
try {
  db.exec(`ALTER TABLE tasks ADD COLUMN workflow_snapshot TEXT DEFAULT NULL`);
} catch { /* column already exists */ }

export default db;

/** Close the DB connection (used by tests to release file handles on Windows). */
export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
