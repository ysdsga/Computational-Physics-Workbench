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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';

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

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'workbench.js'), ...args], {
      cwd: ROOT, env: { ...process.env, WORKBENCH_URL: base }, windowsHide: true,
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

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

test('workbench CLI uses the HTTP API and returns machine-readable output', async () => {
  const result = await runCli(['doctor']);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { ok: boolean; baseUrl: string; projectCount: number };
  assert.equal(output.ok, true); assert.equal(output.baseUrl, base); assert.equal(typeof output.projectCount, 'number');
});

test('new one-shot software-stack templates are seeded and create their stage folders', async () => {
  const expectedTemplates: Record<string, { stages: string[]; requiredSteps: string[] }> = {
    'qe-w90-triqs-spontaneous-magnetic-oneshot': {
      stages: ['prep', 'dft_nm', 'wannier_nm', 'dmft', 'check'],
      requiredSteps: ['qenm-dft-02', 'qenm-wan-04', 'qenm-dmft-02', 'qenm-dmft-05', 'qenm-check-01'],
    },
    'wien2k-dmftproj-triqs-oneshot': {
      stages: ['prep', 'wien', 'projector', 'dmft', 'check'],
      requiredSteps: ['wien-dft-03', 'wien-proj-03', 'wien-dmft-01', 'wien-dmft-03', 'wien-check-01'],
    },
  };

  const workflowsResponse = await fetch(`${base}/api/workflows/all/full`);
  assert.equal(workflowsResponse.status, 200);
  const workflows = (await workflowsResponse.json()) as {
    id: string;
    stages: { id: string }[];
    steps: { id: string; stageId: string }[];
  }[];
  assert.ok(!workflows.some(item => item.id === 'qe-w90-triqs-magnetic-oneshot'));
  for (const [workflowId, expected] of Object.entries(expectedTemplates)) {
    const workflow = workflows.find(item => item.id === workflowId);
    assert.ok(workflow, `${workflowId} should be seeded`);
    assert.deepEqual(workflow.stages.map(stage => stage.id), expected.stages);
    assert.equal(new Set(workflow.steps.map(step => step.id)).size, workflow.steps.length);
    assert.ok(workflow.steps.every(step => expected.stages.includes(step.stageId)));
    assert.ok(workflow.steps.length <= 20, `${workflowId} should remain a concise workflow skeleton`);
    for (const stepId of expected.requiredSteps) {
      assert.ok(workflow.steps.some(step => step.id === stepId), `${workflowId} should include ${stepId}`);
    }
  }

  const workingDir = path.join(tmpRoot, 'workflow-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'workflow-project', working_dir: workingDir }),
  });
  assert.equal(projectResponse.status, 201);
  const project = (await projectResponse.json()) as { id: string };

  let taskNumber = 0;
  for (const [workflowId, expected] of Object.entries(expectedTemplates)) {
    taskNumber += 1;
    const taskName = `stack-${taskNumber}`;
    const taskResponse = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: taskName, workflow_id: workflowId }),
    });
    assert.equal(taskResponse.status, 201);
    for (const stageId of expected.stages) {
      assert.ok(
        fs.existsSync(path.join(workingDir, taskName, stageId)),
        `${workflowId} should create ${stageId}`,
      );
    }
  }
});

test('each task keeps and edits an independent workflow snapshot', async () => {
  const workflowId = 'task-snapshot-test';
  const sourceWorkflow = {
    name: '任务快照测试模板',
    description: 'source template',
    stages: [{
      id: 'source-stage',
      name: '来源阶段',
      color: '#3b82f6',
      colorBg: 'rgba(59,130,246,0.12)',
      colorBorder: 'rgba(59,130,246,0.4)',
      description: '',
    }],
    steps: [{
      id: 'source-step',
      stageId: 'source-stage',
      order: 1,
      name: '来源步骤',
      description: '',
    }],
  };
  const saveSource = await fetch(`${base}/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sourceWorkflow),
  });
  assert.equal(saveSource.status, 200);

  const workingDir = path.join(tmpRoot, 'task-snapshot-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'task-snapshot-project', working_dir: workingDir }),
  });
  assert.equal(projectResponse.status, 201);
  const project = (await projectResponse.json()) as { id: string };

  const taskResponse = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'independent-task', workflow_id: workflowId }),
  });
  assert.equal(taskResponse.status, 201);
  const createdTask = (await taskResponse.json()) as {
    id: string;
    workflow: { stages: { id: string }[]; steps: { id: string }[] };
  };
  assert.deepEqual(createdTask.workflow.steps.map(step => step.id), ['source-step']);

  // Simulate an existing pre-snapshot task and verify the compatibility backfill.
  const migrationDb = new Database(process.env.WORKBENCH_DB_PATH!);
  migrationDb.prepare('UPDATE tasks SET workflow_snapshot = NULL WHERE id = ?').run(createdTask.id);
  migrationDb.close();
  const migratedResponse = await fetch(`${base}/api/tasks/${createdTask.id}`);
  assert.equal(migratedResponse.status, 200);
  const migratedTask = (await migratedResponse.json()) as typeof createdTask;
  assert.deepEqual(migratedTask.workflow.steps.map(step => step.id), ['source-step']);

  const changeTemplate = await fetch(`${base}/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...sourceWorkflow,
      steps: [...sourceWorkflow.steps, {
        id: 'template-only-step',
        stageId: 'source-stage',
        order: 2,
        name: '只属于后来模板的步骤',
        description: '',
      }],
    }),
  });
  assert.equal(changeTemplate.status, 200);

  const unchangedTaskResponse = await fetch(`${base}/api/tasks/${createdTask.id}`);
  const unchangedTask = (await unchangedTaskResponse.json()) as typeof createdTask;
  assert.deepEqual(unchangedTask.workflow.steps.map(step => step.id), ['source-step']);

  const taskWorkflow = {
    id: workflowId,
    ...sourceWorkflow,
    stages: [...sourceWorkflow.stages, {
      id: 'task-stage',
      name: '任务新增阶段',
      color: '#22c55e',
      colorBg: 'rgba(34,197,94,0.12)',
      colorBorder: 'rgba(34,197,94,0.4)',
      description: '',
    }],
    steps: [...sourceWorkflow.steps, {
      id: 'task-only-step',
      stageId: 'task-stage',
      order: 1,
      name: '只属于任务的步骤',
      description: '',
    }],
  };
  const updateTaskWorkflow = await fetch(`${base}/api/tasks/${createdTask.id}/workflow`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(taskWorkflow),
  });
  assert.equal(updateTaskWorkflow.status, 200);
  assert.ok(fs.existsSync(path.join(workingDir, 'independent-task', 'task-stage')));

  const [finalTaskResponse, finalTemplateResponse] = await Promise.all([
    fetch(`${base}/api/tasks/${createdTask.id}`),
    fetch(`${base}/api/workflows/${workflowId}`),
  ]);
  const finalTask = (await finalTaskResponse.json()) as typeof createdTask;
  const finalTemplate = (await finalTemplateResponse.json()) as typeof createdTask.workflow;
  assert.ok(finalTask.workflow.steps.some(step => step.id === 'task-only-step'));
  assert.ok(!finalTask.workflow.steps.some(step => step.id === 'template-only-step'));
  assert.ok(finalTemplate.steps.some(step => step.id === 'template-only-step'));
  assert.ok(!finalTemplate.steps.some(step => step.id === 'task-only-step'));
});

test('workflow preview exposes a selector for every built-in template', async () => {
  const React = await import('react');
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const [{ renderToStaticMarkup }, { MemoryRouter }, { WorkflowProvider }, { default: WorkflowPage }] = await Promise.all([
    import('react-dom/server'),
    import('react-router-dom'),
    import(pathToFileURL(path.join(ROOT, 'src', 'contexts', 'WorkflowContext.tsx')).href),
    import(pathToFileURL(path.join(ROOT, 'src', 'pages', 'WorkflowPage.tsx')).href),
  ]);

  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(WorkflowProvider, null, React.createElement(WorkflowPage)),
    ),
  );

  assert.match(html, /aria-label="预览工作流模板"/);
  assert.doesNotMatch(html, /qe-w90-triqs-magnetic-oneshot/);
  for (const workflowId of [
    'dft-dmft-oneshot',
    'qe-w90-triqs-spontaneous-magnetic-oneshot',
    'wien2k-dmftproj-triqs-oneshot',
  ]) {
    assert.match(html, new RegExp(`value="${workflowId}"`));
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

test('Agent V1 freezes context, keeps an append-only ledger, and routes expansions through review', async () => {
  const workingDir = path.join(tmpRoot, 'agent-v1-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'agent-v1', working_dir: workingDir }) });
  const project = await projectResponse.json() as { id: string };
  const taskResponse = await fetch(`${base}/api/projects/${project.id}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'stable-task', workflow_id: 'dft-dmft-oneshot' }) });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json() as { id: string; task_root_rel: string };
  const planResponse = await fetch(`${base}/api/research-plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Agent Plan', project_id: project.id, content: '# Agent Plan\n\nInitial.' }) });
  const plan = await planResponse.json() as { id: string };
  const initialize = await fetch(`${base}/api/research-plans/${plan.id}/contract/initialize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(initialize.status, 201);
  const runResponse = await fetch(`${base}/api/agent/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'start-once' }) });
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json() as { id: string; current_context_version_id: string };
  const repeated = await fetch(`${base}/api/agent/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'start-once' }) });
  assert.equal((await repeated.json() as { id: string }).id, run.id);

  const contextResponse = await fetch(`${base}/api/agent/v1/context/tasks/${task.id}`);
  const context = await contextResponse.json() as { schemaVersion: number; taskRoot: { relative: string; resolved: boolean }; contextVersion: { id: string; version: number }; eventCursor: number };
  assert.equal(context.schemaVersion, 1); assert.equal(context.taskRoot.relative, task.task_root_rel); assert.equal(context.taskRoot.resolved, true); assert.equal(context.contextVersion.version, 1); assert.equal(context.eventCursor, 1);

  const eventBody = { category: 'fact', eventType: 'test.observed', actorType: 'agent', payload: { value: 1 }, idempotencyKey: 'fact-once' };
  const firstEvent = await fetch(`${base}/api/agent/v1/runs/${run.id}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(eventBody) });
  const secondEvent = await fetch(`${base}/api/agent/v1/runs/${run.id}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(eventBody) });
  assert.equal((await firstEvent.json() as { id: string }).id, (await secondEvent.json() as { id: string }).id);

  const contractResponse = await fetch(`${base}/api/research-plans/${plan.id}/contract`);
  const current = await contractResponse.json() as { contract: any };
  const candidatePlan = '# Agent Plan\n\nExpanded method.';
  const candidateContract = { ...current.contract, approvedPlan: { ...current.contract.approvedPlan, sha256: crypto.createHash('sha256').update(candidatePlan).digest('hex') }, boundaries: { ...current.contract.boundaries, allowedMethods: ['new-method'] } };
  const revise = await fetch(`${base}/api/agent/v1/runs/${run.id}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planContent: candidatePlan, contractContent: stringifyYaml(candidateContract), expectedContextVersionId: context.contextVersion.id, reason: 'method correction', idempotencyKey: 'revision-one' }) });
  assert.equal(revise.status, 202);
  const revisionResult = await revise.json() as { request: { id: string } };
  const decision = await fetch(`${base}/api/agent/v1/reviews/${revisionResult.request.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', comment: 'scientifically justified' }) });
  assert.equal(decision.status, 201);
  const doubleDecision = await fetch(`${base}/api/agent/v1/reviews/${revisionResult.request.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) });
  assert.equal(doubleDecision.status, 409);
  const adoptedContext = await fetch(`${base}/api/agent/v1/context/tasks/${task.id}`).then(response => response.json()) as { contextVersion: { id: string; version: number }; research: { drift: boolean } };
  assert.equal(adoptedContext.contextVersion.version, 2); assert.equal(adoptedContext.research.drift, false);

  const adoptedContract = await fetch(`${base}/api/research-plans/${plan.id}/contract`).then(response => response.json()) as { contract: any };
  const evidenceReducedPlan = '# Agent Plan\n\nEvidence reduction proposal.';
  const evidenceReducedContract = {
    ...adoptedContract.contract,
    approvedPlan: { ...adoptedContract.contract.approvedPlan, sha256: crypto.createHash('sha256').update(evidenceReducedPlan).digest('hex') },
    completion: { requiredEvidence: adoptedContract.contract.completion.requiredEvidence.slice(1) },
  };
  const repeatedRevisionBody = JSON.stringify({ planContent: evidenceReducedPlan, contractContent: stringifyYaml(evidenceReducedContract), expectedContextVersionId: adoptedContext.contextVersion.id, reason: 'remove evidence obligation', idempotencyKey: 'revision-review-once' });
  const firstReviewRevision = await fetch(`${base}/api/agent/v1/runs/${run.id}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: repeatedRevisionBody });
  const secondReviewRevision = await fetch(`${base}/api/agent/v1/runs/${run.id}/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: repeatedRevisionBody });
  assert.equal(firstReviewRevision.status, 202); assert.equal(secondReviewRevision.status, 202);
  const firstReviewResult = await firstReviewRevision.json() as { request: { id: string; idempotency_key: string } };
  const secondReviewResult = await secondReviewRevision.json() as { request: { id: string; idempotency_key: string } };
  assert.equal(firstReviewResult.request.id, secondReviewResult.request.id);
  assert.equal(firstReviewResult.request.idempotency_key, 'revision-review-once');

  const deleteTask = await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE' });
  const deletePlan = await fetch(`${base}/api/research-plans/${plan.id}`, { method: 'DELETE' });
  const deleteProject = await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE' });
  assert.equal(deleteTask.status, 409); assert.equal(deletePlan.status, 409); assert.equal(deleteProject.status, 409);
});

test('policy activation rejects lower-scope privilege expansion', async () => {
  const policy = { schemaVersion: 1, remoteEnabled: true, smokeAuthorized: true, allowedOperations: ['context', 'event.append', 'review.request', 'remote.inspect', 'job.submit_smoke'], allowedHosts: ['pilot', 'backup'], allowedMethods: ['baseline'], remoteRoot: '/pilot/root', limits: { maxCoresPerJob: 4, maxWallMinutes: 30, maxConcurrentJobs: 2, maxAutomaticRetries: 2 }, protectedPaths: ['results'], humanGates: ['final_interpretation'] };
  const system = await fetch(`${base}/api/agent/v1/policies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scopeType: 'system', policy, activate: true }) });
  assert.equal(system.status, 201);
  const project = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'policy-project' }) }).then(response => response.json()) as { id: string };
  const inherited = await fetch(`${base}/api/agent/v1/policies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scopeType: 'project', scopeId: project.id, policy: { ...policy, allowedHosts: ['pilot'] }, activate: true }) });
  assert.equal(inherited.status, 201);
  const replacement = await fetch(`${base}/api/agent/v1/policies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scopeType: 'project', scopeId: project.id, policy: { ...policy, allowedHosts: ['backup'] }, activate: true }) });
  assert.equal(replacement.status, 201);
  const expanded = await fetch(`${base}/api/agent/v1/policies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scopeType: 'project', scopeId: project.id, policy: { ...policy, allowedHosts: ['pilot', 'unapproved'] }, activate: true }) });
  assert.equal(expanded.status, 409);
});

test('contract strictness rejects removed parameter bounds, stages, evidence and changed objectives', async () => {
  const { contractIsSameOrStricter } = await import('../server/services/agentCore.js');
  const current = {
    schemaVersion: 1 as const, approvedPlan: { path: 'plan.md', sha256: '0'.repeat(64) }, objectives: ['baseline'], requiredStages: ['dft'],
    boundaries: { allowedSoftwareStacks: ['qe'], allowedMethods: ['baseline'], parameterBounds: { U: { min: 3, max: 5 } } },
    humanGates: ['final_interpretation'], completion: { requiredEvidence: ['inputs', 'validation'] },
    resourceBudget: { maxCoresPerJob: 4, maxWallMinutes: 30, maxConcurrentJobs: 1, maxAutomaticRetries: 1 },
  };
  const next = { ...current, objectives: ['changed'], requiredStages: [], boundaries: { ...current.boundaries, parameterBounds: {} }, completion: { requiredEvidence: ['inputs'] } };
  const result = contractIsSameOrStricter(next, current);
  assert.equal(result.ok, false);
  assert.ok(result.expansions.includes('objectives_changed'));
  assert.ok(result.expansions.includes('required_stages_removed'));
  assert.ok(result.expansions.includes('required_evidence_removed'));
  assert.ok(result.expansions.includes('parameter:U:removed'));
});

test('LSF capability parser recognizes the real Spectrum LSF banner', async () => {
  const { isProtectedRelativePath, parseLsfScheduler, smokeBudgetAllowsOneCoreMinute } = await import('../server/services/remote.js');
  const banner = 'IBM Spectrum LSF Standard 10.1.0.8, May 10 2019';
  assert.equal(parseLsfScheduler([banner]), banner);
  assert.equal(isProtectedRelativePath('results/final.h5', ['results']), true);
  assert.equal(isProtectedRelativePath('results-old/final.h5', ['results']), false);
  const contract = {
    schemaVersion: 1 as const, approvedPlan: { path: 'plan.md', sha256: '0'.repeat(64) }, objectives: [], requiredStages: [],
    boundaries: { allowedSoftwareStacks: [], allowedMethods: [], parameterBounds: {} }, humanGates: [], completion: { requiredEvidence: [] },
    resourceBudget: { maxCoresPerJob: 1, maxWallMinutes: 1, maxConcurrentJobs: 1, maxAutomaticRetries: 0 },
  };
  const policy = { schemaVersion: 1 as const, remoteEnabled: true, smokeAuthorized: true, allowedOperations: [], allowedHosts: [], allowedMethods: [], limits: { ...contract.resourceBudget }, protectedPaths: ['results'], humanGates: [] };
  assert.equal(smokeBudgetAllowsOneCoreMinute(policy, contract), true);
  assert.equal(smokeBudgetAllowsOneCoreMinute({ ...policy, limits: { ...policy.limits, maxWallMinutes: 0.5 } }, contract), false);
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
  const repeatedMigration = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { cwd: ROOT, encoding: 'utf-8' },
  );
  assert.equal(repeatedMigration.status, 0, repeatedMigration.stderr);

  const verifyDb = new Database(migrationDbPath, { readonly: true });
  const row = verifyDb.prepare('SELECT id, project_id FROM research_plans WHERE id = ?').get('rp-existing') as
    | { id: string; project_id: string }
    | undefined;
  const schema = verifyDb.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'research_plans'",
  ).get() as { sql: string };
  const reviewColumns = verifyDb.prepare('PRAGMA table_info(review_requests)').all() as { name: string }[];
  const userVersion = verifyDb.pragma('user_version', { simple: true }) as number;
  verifyDb.close();

  assert.equal(row?.project_id, 'proj-existing');
  assert.match(schema.sql.replace(/\s+/g, ''), /UNIQUE\(project_id,file_name\)/i);
  assert.equal(userVersion, 2);
  assert.ok(reviewColumns.some(column => column.name === 'idempotency_key'));
  assert.ok(
    fs.existsSync(path.join(tmpRoot, 'migration.before-research-plans-v3.db')),
    'migration should create a database backup',
  );
  assert.ok(
    fs.existsSync(path.join(tmpRoot, 'migration.before-agent-v1.db')),
    'Agent V1 migration should create a one-time consistency backup',
  );
});
