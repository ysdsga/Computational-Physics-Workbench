/**
 * smoke.test.ts — 启动冒烟 + 核心行为保持测试
 *
 * 目标：在**临时数据库 + 临时研究方案目录**上验证应用真实行为，
 * 绝不触碰真实用户数据（data/workbench.db、research-plans/）。
 *
 * 运行：npx tsx --test tests/smoke.test.ts
 * 依赖：仅 Node 内置 node:test + 项目已有 tsx（零新增依赖）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------
// 临时环境：数据库 + 研究方案目录（必须先于 server/index 的 import）
// ---------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-smoke-'));
const tmpPlans = path.join(tmpRoot, 'research-plans');
process.env.WORKBENCH_DB_PATH = path.join(tmpRoot, 'test.db');
process.env.WORKBENCH_PLANS_DIR = tmpPlans;
process.env.WORKBENCH_PORT = '0'; // 0 = 系统分配随机端口

let server: Server | undefined;
let base = '';

before(async () => {
  // GLOBAL_PLANS_DIR in researchPlans.ts resolves against cwd — point it at tmp
  process.chdir(tmpRoot);
  const { createApp } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.ts')).href);
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
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
test('research plan create + content round-trip', async () => {
  const create = await fetch(`${base}/api/research-plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Smoke Plan',
      content: '# Smoke Plan\n\nBaseline content.',
    }),
  });
  assert.equal(create.status, 201);
  const plan = (await create.json()) as { id: string; file_name: string; title: string };
  assert.ok(plan.id);
  assert.equal(plan.title, 'Smoke Plan');
  assert.ok(plan.file_name.endsWith('.md'));

  // md file actually written to the temp plans dir
  assert.ok(fs.existsSync(path.join(tmpPlans, plan.file_name)), 'md file should exist in temp dir');

  // read content back
  const content = await fetch(`${base}/api/research-plans/${plan.id}/content`);
  assert.equal(content.status, 200);
  const body = (await content.json()) as { content: string };
  assert.match(body.content, /Baseline content/);

  // cleanup: delete plan (file + metadata)
  const del = await fetch(`${base}/api/research-plans/${plan.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(tmpPlans, plan.file_name)), 'md file should be removed');
});
