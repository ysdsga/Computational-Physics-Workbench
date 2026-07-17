import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeTaskFolderName } from './taskFolders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DFT_DMFT_DB_PATH
  ? path.resolve(process.env.DFT_DMFT_DB_PATH)
  : path.join(__dirname, '..', 'data', 'workbench.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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
    hpc_config TEXT DEFAULT NULL,
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
    folder_name TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS step_progress (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    commands TEXT DEFAULT NULL,
    lsf_script TEXT DEFAULT NULL,
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

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

function hasColumn(table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(item => item.name === column);
}

const migrations = [
  { version: 1, name: 'step progress commands', run: () => {
    if (!hasColumn('step_progress', 'commands')) db.exec('ALTER TABLE step_progress ADD COLUMN commands TEXT DEFAULT NULL');
  } },
  { version: 2, name: 'step progress lsf script', run: () => {
    if (!hasColumn('step_progress', 'lsf_script')) db.exec('ALTER TABLE step_progress ADD COLUMN lsf_script TEXT DEFAULT NULL');
  } },
  { version: 3, name: 'project hpc config', run: () => {
    if (!hasColumn('projects', 'hpc_config')) db.exec('ALTER TABLE projects ADD COLUMN hpc_config TEXT DEFAULT NULL');
  } },
  { version: 4, name: 'stable task folder name', run: () => {
    if (!hasColumn('tasks', 'folder_name')) db.exec("ALTER TABLE tasks ADD COLUMN folder_name TEXT DEFAULT ''");
    const tasks = db.prepare("SELECT id, name FROM tasks WHERE folder_name IS NULL OR folder_name = ''").all() as { id: string; name: string }[];
    const update = db.prepare('UPDATE tasks SET folder_name = ? WHERE id = ?');
    for (const task of tasks) update.run(sanitizeTaskFolderName(task.name), task.id);
  } },
];

const applyMigration = db.transaction((migration: typeof migrations[number]) => {
  migration.run();
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(migration.version, migration.name, new Date().toISOString());
});

for (const migration of migrations) {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
  if (!applied) applyMigration(migration);
}

export default db;
