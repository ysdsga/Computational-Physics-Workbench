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
  await expect(page.getByText('Codex 对话负责规划和执行', { exact: false })).toBeVisible();
  await expect(page.getByText('不提供启动、授权、提交、取消或对账按钮', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '待沟通事项' }).click();
  await expect(page.getByRole('heading', { name: '待沟通事项' })).toBeVisible();
  await expect(page.getByText('当前筛选下没有待沟通事项。')).toBeVisible();
  await page.getByRole('link', { name: '研究方案' }).click();
  await expect(page.getByRole('heading', { name: '研究方案', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '超算管理' }).click();
  await expect(page.getByRole('heading', { name: '超算管理' })).toBeVisible();
  await expect(page.getByText('实际动作由 Codex 在已确认 Task Spec 边界内完成', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '证据库' }).click();
  await expect(page.getByRole('heading', { name: '证据库' })).toBeVisible();
  await page.getByRole('link', { name: '经验库' }).click();
  await expect(page.getByRole('heading', { name: '经验库' })).toBeVisible();
  await expect(page.getByRole('link', { name: /超算提交|评价中心|证据与经验/ })).toHaveCount(0);
  await page.getByRole('link', { name: '工作流' }).click();
  await expect(page.getByText('工作流只保留核心骨架', { exact: false })).toBeVisible();
});

test('project task form validates input, reports API failures and creates a task', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'ui-task-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await request.post('/api/projects', { data: { name: 'UI Task Project', working_dir: workingDir } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as { id: string };

  await page.goto(`/#/project/${project.id}`);
  await page.getByRole('button', { name: '新建任务' }).click();
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByRole('alert')).toHaveText('请输入任务名称。');

  let rejectNextCreate = true;
  await page.route(`**/api/projects/${project.id}/tasks`, async route => {
    if (route.request().method() === 'POST' && rejectNextCreate) {
      rejectNextCreate = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模拟创建失败' }) });
      return;
    }
    await route.continue();
  });

  await page.getByPlaceholder('例如：V2O3 顺磁性 one-shot DMFT').fill('UI Created Task');
  await page.getByLabel('工作流模板').selectOption('theoretical-research');
  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByRole('alert')).toHaveText('创建失败：模拟创建失败');

  await page.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByRole('heading', { name: '新建任务' })).toHaveCount(0);
  await expect(page.getByText('UI Created Task')).toBeVisible();

  const tasksResponse = await request.get(`/api/projects/${project.id}/tasks`);
  expect(tasksResponse.ok()).toBeTruthy();
  const tasks = await tasksResponse.json() as Array<{ name: string; task_root_rel: string; workflow_id: string }>;
  expect(tasks).toHaveLength(1);
  expect(tasks[0].name).toBe('UI Created Task');
  expect(tasks[0].workflow_id).toBe('theoretical-research');
  expect(fs.statSync(path.join(workingDir, tasks[0].task_root_rel)).isDirectory()).toBeTruthy();
});

test('Web observes a confirmed Task Spec and pending item without issuing Agent writes', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'ui-agent-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await request.post('/api/projects', { data: { name: 'UI Agent Project', working_dir: workingDir } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as { id: string };
  const taskResponse = await request.post(`/api/projects/${project.id}/tasks`, { data: { name: 'UI Agent Task', workflow_id: 'dft-dmft-oneshot' } });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as { id: string; workflow: { stages: Array<{ id: string }> } };
  const planResponse = await request.post('/api/research-plans', { data: { title: 'UI Agent Plan', project_id: project.id, content: '# UI Agent Plan\n\nBaseline.' } });
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json() as { id: string };
  const stageIds = task.workflow.stages.map(stage => stage.id);
  const runResponse = await request.post('/api/agent/v1/runs', {
    data: {
      taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'ui-readonly-run',
      taskSpec: {
        schemaVersion: 1, objective: 'UI observation fixture',
        confirmedEnvelope: {
          schemaVersion: 1, coreStageIds: stageIds, scientificCommitments: ['fixture'],
          allowedCapabilities: ['local.process'], allowedMethods: [], allowedSoftwareStacks: [], hpcProfileId: null,
          resourceLimits: { maxCoresPerJob: 1, maxWallMinutes: 10, maxConcurrentJobs: 1, maxAutomaticRetries: 1 },
          protectedRelativePaths: [], completionEvidence: ['fixture evidence'], researcherGates: [],
          autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
        },
        workingPlan: { currentStageId: stageIds[0], summary: 'fixture plan' },
      },
    },
  });
  expect(runResponse.status()).toBe(201);
  const run = await runResponse.json() as { id: string };
  expect((await request.post(`/api/agent/v1/runs/${run.id}/confirm`, { data: { summary: 'fixture confirmed', source: 'codex_conversation' } })).ok()).toBeTruthy();
  const reviewResponse = await request.post(`/api/agent/v1/runs/${run.id}/pending-items`, {
    data: {
      stageId: stageIds[0], audience: 'researcher', kind: 'ui_acceptance',
      title: '是否确认 UI 验收结论？', detail: { blocksRun: true, source: 'e2e-fixture' },
      idempotencyKey: 'ui-pending-once', source: 'codex',
    },
  });
  expect(reviewResponse.status()).toBe(201);
  const filteredReviews = await request.get(`/api/agent/v1/pending-items?projectId=${project.id}&taskId=${task.id}&status=open`);
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
  await expect(page.getByText('waiting_researcher', { exact: true })).toBeVisible();
  await expect(page.getByText('待沟通').locator('..').getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '读取最新记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: /启动|批准|提交|取消|对账/ })).toHaveCount(0);
  await expect(page.getByLabel('科学里程碑记录列表')).toHaveCSS('overflow-y', 'auto');
  await expect(page.getByLabel('远程作业记录列表')).toHaveCSS('overflow-y', 'auto');
  await expect(page.getByLabel('证据检查记录列表')).toHaveCSS('overflow-y', 'auto');
  await expect(page.getByLabel('执行时间线记录列表')).toHaveCSS('overflow-y', 'auto');

  await page.goto('/#/reviews');
  await expect(page.getByText('是否确认 UI 验收结论？')).toBeVisible();
  await expect(page.getByText('等待在 Codex 对话中讨论并确认。')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /批准|驳回|补充|终止/ })).toHaveCount(0);
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByText('是否确认 UI 验收结论？')).toBeVisible();
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
  await expect(page.getByText('该任务尚无已确认 Task Spec', { exact: false })).toBeVisible();
  expect(agentWrites).toEqual([]);
});
