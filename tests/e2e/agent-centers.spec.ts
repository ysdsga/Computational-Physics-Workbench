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
  await expect(page.getByRole('heading', { name: 'Agent 运行记录' })).toBeVisible();
  await expect(page.getByText('Codex 对话是研究 Agent', { exact: false })).toBeVisible();
  await expect(page.getByText('页面不会启动、批准、提交、取消或对账。', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '待沟通事项' }).click();
  await expect(page.getByRole('heading', { name: '待沟通事项' })).toBeVisible();
  await expect(page.getByText('当前筛选下没有沟通事项。')).toBeVisible();
  await page.getByRole('link', { name: '研究方案' }).click();
  await expect(page.getByRole('heading', { name: '研究方案', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '超算管理' }).click();
  await expect(page.getByRole('heading', { name: '超算管理' })).toBeVisible();
  await expect(page.getByText('不直接创建目录、上传、下载、提交或取消', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '证据库' }).click();
  await expect(page.getByRole('heading', { name: '证据库' })).toBeVisible();
  await page.getByRole('link', { name: '经验库' }).click();
  await expect(page.getByRole('heading', { name: '经验库' })).toBeVisible();
  await expect(page.getByRole('link', { name: /超算提交|评价中心|证据与经验/ })).toHaveCount(0);
  await page.getByRole('link', { name: '工作流' }).click();
  await expect(page.getByText('工作流只保留核心骨架', { exact: false })).toBeVisible();
});

test('Web observes a Codex run and review without issuing Agent writes', async ({ page, request }) => {
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
  const plan = await planResponse.json() as { id: string };
  const contractResponse = await request.post(`/api/research-plans/${plan.id}/contract/initialize`, { data: {} });
  expect(contractResponse.status()).toBe(201);
  const runResponse = await request.post('/api/agent/v1/runs', {
    data: { taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'ui-readonly-run' },
  });
  expect(runResponse.status()).toBe(201);
  const run = await runResponse.json() as { id: string };
  const reviewResponse = await request.post(`/api/agent/v1/runs/${run.id}/reviews`, {
    data: {
      gateType: 'ui_acceptance',
      question: '是否批准 UI 验收继续？',
      recommendation: { action: 'discuss_in_codex' },
      evidence: [{ source: 'e2e-fixture' }],
      idempotencyKey: 'ui-review-once',
      source: 'codex_conversation',
    },
  });
  expect(reviewResponse.status()).toBe(201);
  const filteredReviews = await request.get(`/api/agent/v1/reviews?projectId=${project.id}&taskId=${task.id}&status=open`);
  expect(filteredReviews.ok()).toBeTruthy();
  const filteredItems = await filteredReviews.json() as Array<{ project_id: string; task_id: string; project_name: string; task_name: string }>;
  expect(filteredItems).toHaveLength(1);
  expect(filteredItems[0]).toMatchObject({ project_id: project.id, task_id: task.id, project_name: 'UI Agent Project', task_name: 'UI Agent Task' });

  const agentWrites: string[] = [];
  page.on('request', outgoing => {
    if (outgoing.url().includes('/api/agent/') && outgoing.method() !== 'GET') {
      agentWrites.push(`${outgoing.method()} ${outgoing.url()}`);
    }
  });

  await page.goto('/#/agent-runs');
  await expect(page.getByRole('option', { name: 'UI Agent Project' })).toBeAttached();
  await page.getByLabel('项目').selectOption(project.id);
  await expect(page.getByRole('option', { name: 'UI Agent Task' })).toBeAttached();
  await page.getByLabel('任务').selectOption(task.id);
  await expect(page.getByText('waiting_review', { exact: true })).toBeVisible();
  await expect(page.getByText('Open reviews').locator('..').getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '读取最新记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: /启动|批准|提交|取消|对账/ })).toHaveCount(0);

  await page.goto('/#/reviews');
  await expect(page.getByText('是否批准 UI 验收继续？')).toBeVisible();
  await expect(page.getByText('等待 Codex 对话处理')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /批准|驳回|补充|终止/ })).toHaveCount(0);
  await page.getByRole('button', { name: '读取记录' }).click();
  await expect(page.getByText('是否批准 UI 验收继续？')).toBeVisible();
  expect(agentWrites).toEqual([]);
});

test('supercomputer view records user, project and Task roots without remote execution', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'ui-hpc-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const project = await request.post('/api/projects', { data: { name: 'UI HPC Project', working_dir: workingDir } }).then(response => response.json()) as { id: string };
  const task = await request.post(`/api/projects/${project.id}/tasks`, { data: { name: 'UI HPC Task', workflow_id: 'dft-dmft-oneshot' } }).then(response => response.json()) as { id: string };
  const agentWrites: string[] = [];
  page.on('request', outgoing => {
    if (outgoing.url().includes('/api/agent/') && outgoing.method() !== 'GET') agentWrites.push(`${outgoing.method()} ${outgoing.url()}`);
  });

  await page.goto('/#/supercomputers');
  await page.getByLabel('项目').selectOption(project.id);
  await page.getByLabel('用于查看有效边界与运行记录的任务').selectOption(task.id);
  await expect(page.getByText('当前项目尚未登记超算连接。')).toBeVisible();
  await page.getByRole('button', { name: '新增' }).click();
  await page.getByLabel('显示名称').fill('Pilot LSF');
  await page.getByLabel('OpenSSH 别名').fill('pilot');
  await page.getByLabel('用户只读根').fill('/public/home/tester');
  await page.getByLabel('远程项目根').fill('/public/home/tester/pj001_fixture');
  await page.getByLabel('调度器').fill('LSF');
  await page.getByRole('button', { name: '保存连接元数据' }).click();
  await expect(page.getByText('/public/home/tester/pj001_fixture').first()).toBeVisible();
  await page.getByLabel('任务目录名').fill('tk001_fixture');
  await page.getByRole('button', { name: '保存映射' }).click();
  await expect(page.getByText('/public/home/tester/pj001_fixture/tk001_fixture')).toBeVisible();
  await expect(page.getByText('该任务尚无可用有效策略', { exact: false })).toBeVisible();
  expect(agentWrites).toEqual([]);
});
