/**
 * smoke.test.ts — 启动冒烟 + 核心行为保持测试
 *
 * 目标：在**临时数据库 + 临时项目目录**上验证应用真实行为，
 * 绝不触碰真实用户数据（data/workbench.db、项目 working_dir）。
 *
 * 运行：npx tsx --test tests/smoke.test.ts
 * 依赖：仅 Node 内置 node:test + 项目已有 tsx（零新增依赖）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------
// 临时环境：数据库 + 项目目录（必须先于 server/index 的 import）
// ---------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-smoke-'));
process.env.WORKBENCH_DB_PATH = path.join(tmpRoot, 'test.db');
process.env.WORKBENCH_PORT = '0'; // 0 = 系统分配随机端口

let server: Server | undefined;
let base = '';

before(async () => {
  process.chdir(tmpRoot);
  const serverModule = await import(pathToFileURL(path.join(ROOT, 'server', 'index.ts')).href);
  server = serverModule.server;
  if (!server.listening) {
    await new Promise<void>((resolve) => server!.once('listening', resolve));
  }
  const addr = server!.address();
  base = `http://127.0.0.1:${(addr as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  // Release the sqlite file handle so the temp dir can be removed on Windows
  const { closeDb } = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  closeDb();
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------
// 1. 启动冒烟：服务器能起、根页面可达
// ---------------------------------------------------------------
test('server starts and SPA root responds', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html/i);
});

// ---------------------------------------------------------------
// 2. 核心接口可达
// ---------------------------------------------------------------
test('core API endpoints respond', async () => {
  for (const ep of ['/api/projects', '/api/tasks', '/api/workflows', '/api/research-plans']) {
    const res = await fetch(`${base}${ep}`);
    assert.equal(res.status, 200, `${ep} should return 200, got ${res.status}`);
  }
});

// ---------------------------------------------------------------
// 3. 行为保持：项目创建 → 读取 → 更新 → 删除（关键数据可保存/读取）
// ---------------------------------------------------------------
test('project CRUD round-trip preserves data', async () => {
  // create
  const create = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'smoke-project',
      description: 'behavioral baseline',
      material: 'V2O3',
    }),
  });
  assert.equal(create.status, 201);
  const proj = (await create.json()) as { id: string; name: string; material: string };
  assert.ok(proj.id);
  assert.equal(proj.name, 'smoke-project');
  assert.equal(proj.material, 'V2O3');

  // read back
  const read = await fetch(`${base}/api/projects/${proj.id}`);
  assert.equal(read.status, 200);
  const got = (await read.json()) as { name: string; material: string; task_count: number };
  assert.equal(got.name, 'smoke-project');
  assert.equal(got.material, 'V2O3');
  assert.equal(got.task_count, 0);

  // update
  const upd = await fetch(`${base}/api/projects/${proj.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'updated description' }),
  });
  assert.equal(upd.status, 200);
  const updJson = (await upd.json()) as { description: string };
  assert.equal(updJson.description, 'updated description');

  // delete
  const del = await fetch(`${base}/api/projects/${proj.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const delJson = (await del.json()) as { success: boolean };
  assert.equal(delJson.success, true);

  // gone
  const gone = await fetch(`${base}/api/projects/${proj.id}`);
  assert.equal(gone.status, 404);
});

// ---------------------------------------------------------------
// 4. 行为保持：研究方案创建（写 md 文件 + 元数据）→ 读取内容
// ---------------------------------------------------------------
test('research plans require a project and stay in that project working directory', async () => {
  const createProject = async (name: string, workingDir: string) => {
    fs.mkdirSync(workingDir, { recursive: true });
    const response = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, working_dir: workingDir }),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as { id: string };
  };

  const missingProject = await fetch(`${base}/api/research-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'No Project' }),
  });
  assert.equal(missingProject.status, 400);

  const projectDirA = path.join(tmpRoot, 'project-a');
  const projectDirB = path.join(tmpRoot, 'project-b');
  const projectA = await createProject('project-a', projectDirA);
  const projectB = await createProject('project-b', projectDirB);

  const create = await fetch(`${base}/api/research-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke Plan',
      content: '# Smoke Plan\n\nBaseline content.',
      project_id: projectA.id,
    }),
  });
  assert.equal(create.status, 201);
  const plan = (await create.json()) as { id: string; file_name: string; title: string };
  assert.ok(plan.id);
  assert.equal(plan.title, 'Smoke Plan');
  assert.ok(plan.file_name.endsWith('.md'));

  assert.ok(fs.existsSync(path.join(projectDirA, plan.file_name)), 'md file should exist in project A');
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'research-plans')), 'legacy global plans dir must not be created');

  // The same file name is valid in a different project directory.
  const createInProjectB = await fetch(`${base}/api/research-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Smoke Plan', project_id: projectB.id }),
  });
  assert.equal(createInProjectB.status, 201);
  const planB = (await createInProjectB.json()) as { id: string; file_name: string };
  assert.equal(planB.file_name, plan.file_name);
  assert.ok(fs.existsSync(path.join(projectDirB, planB.file_name)), 'md file should exist in project B');

  const movePlan = await fetch(`${base}/api/research-plans/${plan.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectB.id }),
  });
  assert.equal(movePlan.status, 400);
  assert.ok(fs.existsSync(path.join(projectDirA, plan.file_name)), 'rejected move must keep the original file');

  const imported = await fetch(`${base}/api/research-plans/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '# Imported Plan',
      fileName: 'imported.md',
      project_id: projectA.id,
    }),
  });
  assert.equal(imported.status, 201);
  const importedPlan = (await imported.json()) as { id: string; file_name: string };
  assert.ok(fs.existsSync(path.join(projectDirA, importedPlan.file_name)), 'import must target project A');

  // read content back
  const content = await fetch(`${base}/api/research-plans/${plan.id}/content`);
  assert.equal(content.status, 200);
  const body = (await content.json()) as { content: string };
  assert.match(body.content, /Baseline content/);

  // cleanup: delete plan (file + metadata)
  const del = await fetch(`${base}/api/research-plans/${plan.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(projectDirA, plan.file_name)), 'project A md file should be removed');

  const delB = await fetch(`${base}/api/research-plans/${planB.id}`, { method: 'DELETE' });
  assert.equal(delB.status, 200);
  assert.ok(!fs.existsSync(path.join(projectDirB, planB.file_name)), 'project B md file should be removed');

  const delImported = await fetch(`${base}/api/research-plans/${importedPlan.id}`, { method: 'DELETE' });
  assert.equal(delImported.status, 200);
  assert.ok(!fs.existsSync(path.join(projectDirA, importedPlan.file_name)), 'imported md file should be removed');
});

test('research plan listing survives an unavailable project working directory', async () => {
  const workingDir = path.join(tmpRoot, 'temporarily-unavailable-project');
  fs.mkdirSync(workingDir, { recursive: true });

  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'temporarily-unavailable-project', working_dir: workingDir }),
  });
  assert.equal(projectResponse.status, 201);
  const project = (await projectResponse.json()) as { id: string };

  const planResponse = await fetch(`${base}/api/research-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unavailable Directory Plan',
      content: '# Unavailable Directory Plan',
      project_id: project.id,
    }),
  });
  assert.equal(planResponse.status, 201);
  const plan = (await planResponse.json()) as { id: string };

  fs.rmSync(workingDir, { recursive: true, force: true });

  const listResponse = await fetch(`${base}/api/research-plans`);
  assert.equal(listResponse.status, 200);
  const plans = (await listResponse.json()) as { id: string; missing?: boolean }[];
  const listedPlan = plans.find(item => item.id === plan.id);
  assert.ok(listedPlan, 'plan metadata should remain visible while its project directory is unavailable');
  assert.equal(listedPlan.missing, true);
});

test('research plan metadata survives project-scoped schema migration', () => {
  const migrationDbPath = path.join(tmpRoot, 'migration.db');
  const legacyDb = new Database(migrationDbPath);
  legacyDb.exec(`
    CREATE TABLE research_plans (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      project_id TEXT,
      linked_task_ids TEXT DEFAULT '[]',
      status TEXT DEFAULT 'draft',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO research_plans
      (id, file_name, title, project_id, linked_task_ids, status, tags, created_at, updated_at)
    VALUES ('rp-existing', 'plan.md', 'Existing', 'proj-existing', '[]', 'draft', '[]', 'now', 'now');
  `);
  legacyDb.close();

  const dbModuleUrl = pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href;
  const script = `
    process.env.WORKBENCH_DB_PATH = ${JSON.stringify(migrationDbPath)};
    const { closeDb } = await import(${JSON.stringify(dbModuleUrl)});
    closeDb();
  `;
  const migrated = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { cwd: ROOT, encoding: 'utf-8' },
  );
  assert.equal(migrated.status, 0, migrated.stderr);

  const verifyDb = new Database(migrationDbPath, { readonly: true });
  const row = verifyDb.prepare('SELECT id, project_id FROM research_plans WHERE id = ?').get('rp-existing') as
    | { id: string; project_id: string }
    | undefined;
  const schema = verifyDb.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'research_plans'",
  ).get() as { sql: string };
  verifyDb.close();

  assert.equal(row?.project_id, 'proj-existing');
  assert.match(schema.sql.replace(/\s+/g, ''), /UNIQUE\(project_id,file_name\)/i);
  assert.ok(
    fs.existsSync(path.join(tmpRoot, 'migration.before-research-plans-v3.db')),
    'migration should create a database backup',
  );
});
