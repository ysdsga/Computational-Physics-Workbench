import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('v7 adds the exploration review to the stored template without rewriting existing Task snapshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workflow-v7-'));
  const dbPath = path.join(tempRoot, 'migration.db');
  const seed = new Database(dbPath);
  const oldWorkflow = {
    stages: [{ id: 'interpretation', name: '解释与预测' }],
    steps: [{ id: 'existing-custom-step', stageId: 'interpretation', order: 1, name: '保留的自定义步骤' }],
    customSetting: 'preserve-me',
  };
  const oldSnapshot = { id: 'theoretical-research', name: '旧任务快照', description: '', ...oldWorkflow };
  seed.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', material TEXT DEFAULT '',
      working_dir TEXT DEFAULT '', status TEXT DEFAULT 'active', hpc_config TEXT DEFAULT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT DEFAULT '', workflow_id TEXT NOT NULL,
      workflow_snapshot TEXT DEFAULT NULL, task_root_rel TEXT DEFAULT NULL, status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE workflow_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  seed.prepare('INSERT INTO projects (id, name, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('project-existing', 'Existing', tempRoot, now, now);
  seed.prepare(`INSERT INTO tasks (id, project_id, name, workflow_id, workflow_snapshot, task_root_rel, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'task-existing', 'project-existing', 'Existing theory task', 'theoretical-research', JSON.stringify(oldSnapshot), 'existing-task', now, now,
  );
  seed.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('theoretical-research', '理论研究', 'customized', JSON.stringify(oldWorkflow), now);
  seed.pragma('user_version = 6');
  seed.close();

  process.env.WORKBENCH_DB_PATH = dbPath;
  const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  try {
    assert.equal(dbModule.default.pragma('user_version', { simple: true }), 7);
    const row = dbModule.default.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string };
    const migrated = JSON.parse(row.data) as typeof oldWorkflow;
    assert.equal(migrated.customSetting, 'preserve-me');
    assert.ok(migrated.steps.some(step => step.id === 'existing-custom-step'));
    assert.equal(migrated.steps.filter(step => step.id === 'theory-interpretation-04').length, 1);

    const taskRow = dbModule.default.prepare('SELECT workflow_snapshot FROM tasks WHERE id = ?')
      .get('task-existing') as { workflow_snapshot: string };
    assert.deepEqual(JSON.parse(taskRow.workflow_snapshot), oldSnapshot, 'existing Task workflow snapshots must remain immutable');
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-exploration-v7.db')));
  } finally {
    dbModule.closeDb();
    delete process.env.WORKBENCH_DB_PATH;
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
  }
});
