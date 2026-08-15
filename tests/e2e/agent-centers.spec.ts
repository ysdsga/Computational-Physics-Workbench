import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-playwright-'));
let server: Server;

test.beforeAll(async () => {
  process.env.WORKBENCH_DB_PATH = path.join(tempRoot, 'e2e.db');
  process.env.WORKBENCH_HOST = '127.0.0.1';
  process.env.WORKBENCH_PORT = '5173';
  const module = await import('../../server/index.ts');
  server = module.server;
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  const { closeDb } = await import('../../server/db.ts');
  closeDb();
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('Agent run and review centers expose recoverable empty states', async ({ page }) => {
  await page.goto('/#/agent-runs');
  await expect(page.getByRole('heading', { name: 'Agent 运行中心' })).toBeVisible();
  await expect(page.getByText('SSH / LSF Pilot')).toBeVisible();
  await page.getByRole('link', { name: '评价中心' }).click();
  await expect(page.getByRole('heading', { name: '评价中心' })).toBeVisible();
  await expect(page.getByText('当前没有等待评价的事项。')).toBeVisible();
  await page.getByRole('link', { name: '研究方案' }).click();
  await expect(page.getByRole('heading', { name: '研究方案', exact: true })).toBeVisible();
});

test('researcher can initialize a contract, activate a task policy, start a run and decide a review', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'ui-agent-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await request.post('/api/projects', { data: { name: 'UI Agent Project', working_dir: workingDir } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as { id: string };
  const taskResponse = await request.post(`/api/projects/${project.id}/tasks`, { data: { name: 'UI Agent Task', workflow_id: 'dft-dmft-oneshot' } });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as { id: string };
  const planResponse = await request.post('/api/research-plans', { data: { title: 'UI Agent Plan', project_id: project.id, content: '# UI Agent Plan\n\nBaseline.' } });
  expect(planResponse.ok()).toBeTruthy();

  await page.goto('/#/agent-runs');
  await expect(page.getByRole('option', { name: 'UI Agent Project' })).toBeAttached();
  await page.getByLabel('项目').selectOption(project.id);
  await expect(page.getByRole('option', { name: 'UI Agent Task' })).toBeAttached();
  await page.getByRole('button', { name: '加载 / 初始化' }).click();
  await expect(page.getByText('已生成最小合同，请审阅后保存')).toBeVisible();
  await page.getByRole('button', { name: '创建版本并激活' }).click();
  await expect(page.getByText('task 策略已激活，将在启动运行时冻结')).toBeVisible();
  await page.getByRole('button', { name: '启动研究运行' }).click();
  await expect(page.getByText('active', { exact: true })).toBeVisible();

  const contextResponse = await request.get(`/api/agent/v1/context/tasks/${task.id}`);
  const context = await contextResponse.json() as { run: { id: string } };
  const reviewResponse = await request.post(`/api/agent/v1/runs/${context.run.id}/reviews`, {
    data: { gateType: 'ui_acceptance', question: '是否批准 UI 验收继续？', recommendation: { action: 'approve' }, evidence: [{ source: 'e2e' }], idempotencyKey: 'ui-review-once' },
  });
  expect(reviewResponse.status()).toBe(201);

  await page.goto('/#/reviews');
  await expect(page.getByText('是否批准 UI 验收继续？')).toBeVisible();
  await page.getByPlaceholder('评价意见或补充要求').fill('UI E2E approved');
  await page.getByRole('button', { name: '批准', exact: true }).click();
  await expect(page.getByText('评价决定已绑定证据快照并写入账本')).toBeVisible();
  await expect(page.getByText('当前没有等待评价的事项。')).toBeVisible();
});
