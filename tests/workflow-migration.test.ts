import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../server/migrations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('v8 through v10 add stage reflections without rewriting existing Task snapshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workflow-v7-'));
  const dbPath = path.join(tempRoot, 'migration.db');
  const seed = new Database(dbPath);
  const oldWorkflow = {
    stages: [
      { id: 'question', name: '问题定义' },
      { id: 'context', name: '文献与约束' },
      { id: 'model', name: '模型与假设' },
      { id: 'baseline', name: '基准极限' },
      { id: 'derivation', name: '核心推导' },
      { id: 'validation', name: '一致性验证' },
      { id: 'interpretation', name: '解释与预测' },
      { id: 'release', name: '成果封装' },
    ],
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
  seed.pragma('user_version = 7');
  seed.close();

  process.env.WORKBENCH_DB_PATH = dbPath;
  const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  try {
    assert.equal(dbModule.default.pragma('user_version', { simple: true }), 10);
    const row = dbModule.default.prepare('SELECT data FROM workflow_templates WHERE id = ?')
      .get('theoretical-research') as { data: string };
    const migrated = JSON.parse(row.data) as typeof oldWorkflow;
    assert.equal(migrated.customSetting, 'preserve-me');
    assert.ok(migrated.steps.some(step => step.id === 'existing-custom-step'));
    assert.equal(migrated.steps.filter(step => step.id.endsWith('-reflection') || step.id === 'theory-interpretation-04').length, 8);

    const taskRow = dbModule.default.prepare('SELECT workflow_snapshot FROM tasks WHERE id = ?')
      .get('task-existing') as { workflow_snapshot: string };
    assert.deepEqual(JSON.parse(taskRow.workflow_snapshot), oldSnapshot, 'existing Task workflow snapshots must remain immutable');
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-stage-reflection-v8.db')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-idea-closure-v9.db')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-active-exploration-v10.db')));
  } finally {
    dbModule.closeDb();
    delete process.env.WORKBENCH_DB_PATH;
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
  }
});

test('v7 through v10 template migrations preserve intentionally removed theoretical stages', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workflow-custom-'));
  const dbPath = path.join(tempRoot, 'migration.db');
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE workflow_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
  `);
  const customWorkflow = {
    stages: [{ id: 'question', name: '问题定义' }],
    steps: [{ id: 'custom-question', stageId: 'question', order: 1, name: '自定义问题步骤' }],
  };
  seed.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('theoretical-research', '理论研究', 'customized', JSON.stringify(customWorkflow), new Date().toISOString());
  seed.pragma('user_version = 6');
  try {
    runMigrations(seed, dbPath);
    assert.equal(seed.pragma('user_version', { simple: true }), 10);
    const row = seed.prepare('SELECT data FROM workflow_templates WHERE id = ?').get('theoretical-research') as { data: string };
    const migrated = JSON.parse(row.data);
    assert.deepEqual(migrated.stages, customWorkflow.stages);
    assert.ok(migrated.steps.some((step: { id: string }) => step.id === 'custom-question'));
    assert.ok(migrated.steps.some((step: { id: string }) => step.id === 'theory-question-reflection'));
    assert.ok(!migrated.steps.some((step: { stageId: string }) => step.stageId !== 'question'));
  } finally {
    seed.close();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
  }
});

test('v9 and v10 update only unchanged built-in reflection descriptions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workflow-v8-'));
  const dbPath = path.join(tempRoot, 'migration.db');
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE workflow_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
  `);
  const previousReflectionDescription = '记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出探索、证伪、暂缓或转后续任务的处置。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。';
  const previousInterpretationDescription = '完成本阶段记录与全局探索充分性审查。检查是否仍有可能改变、扩展或推翻中心结论的高价值问题或新想法；若有则回到最早受影响阶段，若无则把探索审查标记为通过并进入成果封装。';
  const customizedDescription = '研究者保留的自定义反思规则';
  const workflow = {
    stages: [{ id: 'question', name: '问题定义' }, { id: 'model', name: '模型与假设' }, { id: 'interpretation', name: '解释与预测' }],
    steps: [
      { id: 'theory-question-reflection', stageId: 'question', name: '记录、反思与下一步判断', description: previousReflectionDescription },
      { id: 'theory-model-reflection', stageId: 'model', name: '记录、反思与下一步判断', description: customizedDescription },
      { id: 'theory-interpretation-04', stageId: 'interpretation', name: '记录、反思与探索充分性审查', description: previousInterpretationDescription },
    ],
  };
  seed.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('theoretical-research', '理论研究', 'customized', JSON.stringify(workflow), new Date().toISOString());
  seed.pragma('user_version = 8');
  try {
    runMigrations(seed, dbPath);
    assert.equal(seed.pragma('user_version', { simple: true }), 10);
    const row = seed.prepare('SELECT data FROM workflow_templates WHERE id = ?').get('theoretical-research') as { data: string };
    const migrated = JSON.parse(row.data) as typeof workflow;
    assert.match(migrated.steps.find(step => step.id === 'theory-question-reflection')?.description ?? '', /只有在引用证据/);
    assert.match(migrated.steps.find(step => step.id === 'theory-question-reflection')?.description ?? '', /不为凑数制造想法/);
    assert.match(migrated.steps.find(step => step.id === 'theory-interpretation-04')?.description ?? '', /暂缓或转后续任务不能解除阻塞/);
    assert.equal(migrated.steps.find(step => step.id === 'theory-model-reflection')?.description, customizedDescription);
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-idea-closure-v9.db')));
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-active-exploration-v10.db')));
  } finally {
    seed.close();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
  }
});

test('v10 adds active exploration prompts without overwriting customized reflection text', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workflow-v9-'));
  const dbPath = path.join(tempRoot, 'migration.db');
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE workflow_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
    );
  `);
  const previousReflectionDescription = '记录本阶段已经确定的结果、仍存的不确定性以及新出现的关键问题或启发性想法，并逐项给出处置。高价值想法只有在引用证据并标记为已解决或已证伪后才闭合；暂缓或转后续任务仍保持未决。根据影响范围继续前进、停留修正，或回到最早受影响的核心阶段；完整记录追加到 Run 时间线，回流目标和下一步写入 Working Plan。';
  const previousInterpretationDescription = '完成本阶段记录与全局探索充分性审查。检查是否仍有可能改变、扩展或推翻中心结论的高价值问题或新想法；暂缓或转后续任务不能解除阻塞，只有引用证据的已解决或已证伪结论才能闭合。仍有未决项则回到最早受影响阶段，否则把探索审查标记为通过并进入成果封装。';
  const customizedDescription = '保留这一条研究者自定义提示';
  const workflow = {
    steps: [
      { id: 'theory-question-reflection', name: '记录、反思与下一步判断', description: previousReflectionDescription },
      { id: 'theory-model-reflection', name: '记录、反思与下一步判断', description: customizedDescription },
      { id: 'theory-interpretation-04', name: '记录、反思与探索充分性审查', description: previousInterpretationDescription },
    ],
  };
  seed.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('theoretical-research', '理论研究', 'customized', JSON.stringify(workflow), new Date().toISOString());
  seed.pragma('user_version = 9');
  try {
    runMigrations(seed, dbPath);
    assert.equal(seed.pragma('user_version', { simple: true }), 10);
    const row = seed.prepare('SELECT data FROM workflow_templates WHERE id = ?').get('theoretical-research') as { data: string };
    const migrated = JSON.parse(row.data) as typeof workflow;
    assert.match(migrated.steps.find(step => step.id === 'theory-question-reflection')?.description ?? '', /反例、竞争机制、可控极限和可检验预测/);
    assert.match(migrated.steps.find(step => step.id === 'theory-interpretation-04')?.description ?? '', /不设数量指标，不为凑数制造想法/);
    assert.equal(migrated.steps.find(step => step.id === 'theory-model-reflection')?.description, customizedDescription);
    assert.ok(fs.existsSync(path.join(tempRoot, 'migration.before-theoretical-active-exploration-v10.db')));
  } finally {
    seed.close();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
  }
});
