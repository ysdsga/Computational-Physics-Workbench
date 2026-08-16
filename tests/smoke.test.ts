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
const pythonExecutable = spawnSync('python', ['--version'], { windowsHide: true }).status === 0 ? 'python' : 'python3';
process.env.WORKBENCH_LOCAL_EXEC_ENABLED = '1';
process.env.WORKBENCH_LOCAL_EXECUTABLES = pythonExecutable;
process.env.WORKBENCH_REMOTE_ENABLED = '1';
process.env.WORKBENCH_ALLOW_REMOTE_LSF = '1';
process.env.WORKBENCH_REMOTE_TEST_MODE = '1';

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

test('workbench CLI configures and reads validated HPC metadata', async () => {
  const workingDir = path.join(tmpRoot, 'cli-hpc-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'cli-hpc-project', working_dir: workingDir }),
  });
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json() as { id: string };
  const configPath = path.join(tmpRoot, 'cli-hpc-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 2,
    defaultProfileId: 'cluster',
    profiles: [{
      id: 'cluster',
      name: 'Test cluster',
      sshAlias: 'test-cluster',
      scheduler: 'LSF',
      userRoot: '/remote/home/tester',
      projectRoot: '/remote/home/tester/pj001_test',
    }],
    taskBindings: [],
  }));

  const configured = await runCli(['hpc', 'configure', '--project', project.id, '--file', configPath]);
  assert.equal(configured.code, 0, configured.stderr);
  const configuredOutput = JSON.parse(configured.stdout) as { projectId: string; config: { profiles: Array<{ sshAlias: string }> } };
  assert.equal(configuredOutput.projectId, project.id);
  assert.equal(configuredOutput.config.profiles[0]?.sshAlias, 'test-cluster');

  const shown = await runCli(['hpc', 'show', '--project', project.id]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout), configuredOutput);
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
  const decision = await fetch(`${base}/api/agent/v1/reviews/${revisionResult.request.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', comment: 'scientifically justified', source: 'codex_conversation' }) });
  assert.equal(decision.status, 201);
  const doubleDecision = await fetch(`${base}/api/agent/v1/reviews/${revisionResult.request.id}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', source: 'codex_conversation' }) });
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

test('Codex actions bind immutable manifests to workflow steps and persist artifacts and evidence', async () => {
  const workingDir = path.join(tmpRoot, 'agent-v2-actions');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'agent-v2-actions', working_dir: workingDir }),
  });
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json() as { id: string };
  const taskResponse = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'bounded-action-task', workflow_id: 'dft-dmft-oneshot' }),
  });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json() as { id: string; task_root_rel: string; workflow: { steps: { id: string }[] } };
  const stepId = task.workflow.steps[0].id;
  const planResponse = await fetch(`${base}/api/research-plans`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Action Contract Plan', project_id: project.id, content: '# Action Contract Plan' }),
  });
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json() as { id: string };
  assert.equal((await fetch(`${base}/api/research-plans/${plan.id}/contract/initialize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status, 201);
  const runResponse = await fetch(`${base}/api/agent/v1/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'action-run-once' }),
  });
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json() as { id: string; current_context_version_id: string };
  const manifest = { command: 'validate_prepared_files', inputs: ['input.in'], resources: { cores: 1 } };
  const proposalBody = {
    contextVersionId: run.current_context_version_id,
    stepId,
    actionType: 'local.validator',
    manifest,
    idempotencyKey: 'validator-action-once',
    conversationRef: 'codex-task:test-actions',
  };

  const proposedResponse = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposalBody),
  });
  assert.equal(proposedResponse.status, 201);
  const proposed = await proposedResponse.json() as { id: string; status: string; manifest_sha256: string };
  assert.equal(proposed.status, 'proposed');
  assert.match(proposed.manifest_sha256, /^[a-f0-9]{64}$/);

  const repeatedProposal = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposalBody),
  });
  assert.equal((await repeatedProposal.json() as { id: string }).id, proposed.id);
  const conflictingProposal = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...proposalBody, manifest: { ...manifest, command: 'different' } }),
  });
  assert.equal(conflictingProposal.status, 409);
  assert.equal((await conflictingProposal.json() as { code: string }).code, 'ACTION_IDEMPOTENCY_CONFLICT');

  const staleProposal = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...proposalBody, contextVersionId: 'ctx-stale', idempotencyKey: 'stale-action' }),
  });
  assert.equal(staleProposal.status, 409);
  assert.equal((await staleProposal.json() as { code: string }).code, 'STALE_CONTEXT');
  const unknownStep = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...proposalBody, stepId: 'unknown-step', idempotencyKey: 'unknown-step-action' }),
  });
  assert.equal(unknownStep.status, 400);

  const prematureExecution = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'executing' }),
  });
  assert.equal(prematureExecution.status, 409);
  assert.equal((await prematureExecution.json() as { code: string }).code, 'ACTION_TRANSITION_INVALID');
  const wrongSource = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: proposed.manifest_sha256, authorizationSummary: 'confirmed', source: 'web' }),
  });
  assert.equal(wrongSource.status, 400);
  const wrongManifest = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: '0'.repeat(64), authorizationSummary: 'confirmed', source: 'codex_conversation' }),
  });
  assert.equal(wrongManifest.status, 409);

  const authorizationBody = {
    expectedContextVersionId: run.current_context_version_id,
    expectedManifestSha256: proposed.manifest_sha256,
    authorizationSummary: '研究者确认执行该不可变 validator manifest。',
    source: 'codex_conversation',
    conversationRef: 'codex-task:test-actions',
  };
  const authorization = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorizationBody),
  });
  assert.equal(authorization.status, 200);
  const authorized = await authorization.json() as { status: string; authorization_sha256: string };
  assert.equal(authorized.status, 'authorized');
  assert.match(authorized.authorization_sha256, /^[a-f0-9]{64}$/);
  const repeatedAuthorization = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorizationBody),
  });
  assert.equal(repeatedAuthorization.status, 200);
  const changedAuthorization = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...authorizationBody, authorizationSummary: 'different summary' }),
  });
  assert.equal(changedAuthorization.status, 409);
  assert.equal((await changedAuthorization.json() as { code: string }).code, 'ACTION_AUTHORIZATION_CONFLICT');

  const executing = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'executing' }),
  });
  assert.equal(executing.status, 200);

  const artifactRelativePath = 'validator-output.json';
  const artifactContent = '{"ok":true}\n';
  fs.writeFileSync(path.join(workingDir, task.task_root_rel, artifactRelativePath), artifactContent, 'utf8');
  const artifactBody = { location: 'local', path: artifactRelativePath, category: 'validation_report', idempotencyKey: 'artifact-once', metadata: { format: 'json' } };
  const artifactResponse = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(artifactBody),
  });
  assert.equal(artifactResponse.status, 201);
  const artifact = await artifactResponse.json() as { id: string; size_bytes: number; sha256: string; path: string };
  assert.equal(artifact.size_bytes, Buffer.byteLength(artifactContent));
  assert.equal(artifact.path, artifactRelativePath);
  assert.equal(artifact.sha256, crypto.createHash('sha256').update(artifactContent).digest('hex'));
  const repeatedArtifact = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(artifactBody),
  });
  assert.equal((await repeatedArtifact.json() as { id: string }).id, artifact.id);
  const escapedArtifact = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...artifactBody, path: '../outside.txt', idempotencyKey: 'artifact-escape' }),
  });
  assert.equal(escapedArtifact.status, 400);

  const evidenceBody = { artifactId: artifact.id, validatorName: 'prepared-files', validatorVersion: '1.0.0', status: 'pass', result: { checks: 4, failures: 0 }, idempotencyKey: 'evidence-once' };
  const evidenceResponse = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/evidence-checks`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evidenceBody),
  });
  assert.equal(evidenceResponse.status, 201);
  const evidence = await evidenceResponse.json() as { id: string; status: string };
  assert.equal(evidence.status, 'pass');
  const repeatedEvidence = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/evidence-checks`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evidenceBody),
  });
  assert.equal((await repeatedEvidence.json() as { id: string }).id, evidence.id);
  const conflictingEvidence = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/evidence-checks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...evidenceBody, result: { checks: 4, failures: 1 } }),
  });
  assert.equal(conflictingEvidence.status, 409);

  for (const transition of [
    { status: 'waiting_remote', result: { submitted: true } },
    { status: 'executing', result: { reconciled: true } },
    { status: 'succeeded', result: { evidenceCheckId: evidence.id } },
  ]) {
    const response = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/status`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(transition),
    });
    assert.equal(response.status, 200);
  }
  const terminalRewrite = await fetch(`${base}/api/agent/v1/actions/${proposed.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'failed' }),
  });
  assert.equal(terminalRewrite.status, 409);

  const actionDetail = await fetch(`${base}/api/agent/v1/actions/${proposed.id}`).then(response => response.json()) as { status: string; artifacts: unknown[]; evidenceChecks: unknown[] };
  assert.equal(actionDetail.status, 'succeeded');
  assert.equal(actionDetail.artifacts.length, 1);
  assert.equal(actionDetail.evidenceChecks.length, 1);
  const context = await fetch(`${base}/api/agent/v1/context/tasks/${task.id}`).then(response => response.json()) as { recentActions: unknown[]; recentArtifacts: unknown[]; recentEvidenceChecks: unknown[] };
  assert.equal(context.recentActions.length, 1);
  assert.equal(context.recentArtifacts.length, 1);
  assert.equal(context.recentEvidenceChecks.length, 1);

  const cliPlanShow = await runCli(['plan', 'show', '--plan', plan.id]);
  assert.equal(cliPlanShow.code, 0, cliPlanShow.stderr);
  const cliPlan = JSON.parse(cliPlanShow.stdout) as { content: string; sha256: string };
  assert.match(cliPlan.sha256, /^[a-f0-9]{64}$/);
  const planFile = path.join(tmpRoot, 'cli-plan.md');
  fs.writeFileSync(planFile, cliPlan.content, 'utf8');
  const cliPlanUpdate = await runCli(['plan', 'update', '--plan', plan.id, '--file', planFile, '--expected-sha', cliPlan.sha256]);
  assert.equal(cliPlanUpdate.code, 0, cliPlanUpdate.stderr);
  const stalePlanUpdate = await runCli(['plan', 'update', '--plan', plan.id, '--file', planFile, '--expected-sha', '0'.repeat(64)]);
  assert.equal(stalePlanUpdate.code, 3);
  assert.equal((JSON.parse(stalePlanUpdate.stderr) as { code: string }).code, 'STALE_PLAN');

  const cliWorkflowShow = await runCli(['workflow', 'show', '--task', task.id]);
  assert.equal(cliWorkflowShow.code, 0, cliWorkflowShow.stderr);
  const cliWorkflow = JSON.parse(cliWorkflowShow.stdout) as { sha256: string } & Record<string, unknown>;
  assert.match(cliWorkflow.sha256, /^[a-f0-9]{64}$/);
  const workflowFile = path.join(tmpRoot, 'cli-workflow.json');
  fs.writeFileSync(workflowFile, JSON.stringify(cliWorkflow), 'utf8');
  const cliWorkflowUpdate = await runCli(['workflow', 'update', '--task', task.id, '--file', workflowFile, '--expected-sha', cliWorkflow.sha256]);
  assert.equal(cliWorkflowUpdate.code, 0, cliWorkflowUpdate.stderr);
  const staleWorkflowUpdate = await runCli(['workflow', 'update', '--task', task.id, '--file', workflowFile, '--expected-sha', '0'.repeat(64)]);
  assert.equal(staleWorkflowUpdate.code, 3);
  assert.equal((JSON.parse(staleWorkflowUpdate.stderr) as { code: string }).code, 'STALE_WORKFLOW');

  const manifestFile = path.join(tmpRoot, 'cli-manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ command: 'preflight' }), 'utf8');
  const cliProposal = await runCli(['action', 'propose', '--run', run.id, '--context-version', run.current_context_version_id, '--step', stepId, '--type', 'local.preflight', '--manifest-file', manifestFile, '--idempotency-key', 'cli-action-once', '--conversation-ref', 'codex-task:test-cli']);
  assert.equal(cliProposal.code, 0, cliProposal.stderr);
  const cliAction = JSON.parse(cliProposal.stdout) as { id: string; manifest_sha256: string };
  const cliAuthorization = await runCli(['action', 'authorize', '--action', cliAction.id, '--context-version', run.current_context_version_id, '--manifest-sha', cliAction.manifest_sha256, '--summary', '研究者确认 CLI manifest', '--conversation-ref', 'codex-task:test-cli']);
  assert.equal(cliAuthorization.code, 0, cliAuthorization.stderr);
  const cliBlockedTransition = await runCli(['action', 'status', '--action', cliAction.id, '--status', 'succeeded']);
  assert.equal(cliBlockedTransition.code, 4);
  assert.equal((JSON.parse(cliBlockedTransition.stderr) as { code: string }).code, 'ACTION_TRANSITION_INVALID');
  const cliList = await runCli(['action', 'list', '--run', run.id]);
  assert.equal(cliList.code, 0, cliList.stderr);
  assert.equal((JSON.parse(cliList.stdout) as unknown[]).length, 2);

  fs.writeFileSync(planFile, `${cliPlan.content}\nChanged outside the adopted context.\n`, 'utf8');
  const driftPlanUpdate = await runCli(['plan', 'update', '--plan', plan.id, '--file', planFile, '--expected-sha', cliPlan.sha256]);
  assert.equal(driftPlanUpdate.code, 0, driftPlanUpdate.stderr);
  const blockedByDrift = await runCli(['action', 'propose', '--run', run.id, '--context-version', run.current_context_version_id, '--step', stepId, '--type', 'local.preflight', '--manifest-file', manifestFile, '--idempotency-key', 'after-source-drift']);
  assert.equal(blockedByDrift.code, 4);
  assert.equal((JSON.parse(blockedByDrift.stderr) as { code: string }).code, 'CONTEXT_DRIFT');
});

test('researcher conclusions and promoted experiences stay evidence-bound and Codex-sourced', async () => {
  const workingDir = path.join(tmpRoot, 'conclusion-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const project = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Conclusion fixture', working_dir: workingDir }),
  }).then(response => response.json()) as { id: string };
  const task = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Conclusion route', workflow_id: 'qe-w90-triqs-spontaneous-magnetic-oneshot' }),
  }).then(response => response.json()) as { id: string; task_root_rel: string };
  const taskRoot = path.join(workingDir, task.task_root_rel);
  const evidencePath = path.join(taskRoot, 'check', 'conclusion-evidence.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const evidenceContent = '{"validator":"fixture","status":"pass"}\n';
  fs.writeFileSync(evidencePath, evidenceContent, 'utf8');
  const plan = await fetch(`${base}/api/research-plans`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Conclusion Plan', project_id: project.id, content: '# Conclusion Plan' }),
  }).then(response => response.json()) as { id: string };
  assert.equal((await fetch(`${base}/api/research-plans/${plan.id}/contract/initialize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 201);
  const run = await fetch(`${base}/api/agent/v1/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'conclusion-run' }),
  }).then(response => response.json()) as { id: string; current_context_version_id: string };
  const action = await fetch(`${base}/api/agent/v1/runs/${run.id}/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contextVersionId: run.current_context_version_id, stepId: 'qenm-check-01', actionType: 'fixture.validation', manifest: { schemaVersion: 1, output: 'check/conclusion-evidence.json' }, idempotencyKey: 'conclusion-action' }),
  }).then(response => response.json()) as { id: string; manifest_sha256: string };
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${action.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: action.manifest_sha256, authorizationSummary: '研究者确认 fixture validator', source: 'codex_conversation' }),
  })).status, 200);
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${action.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'executing' }) })).status, 200);
  const artifact = await fetch(`${base}/api/agent/v1/actions/${action.id}/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: 'local', path: 'check/conclusion-evidence.json', category: 'validation_report', idempotencyKey: 'conclusion-evidence' }),
  }).then(response => response.json()) as { id: string; sha256: string };
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${action.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'succeeded' }) })).status, 200);

  const genericConclusion = await fetch(`${base}/api/agent/v1/runs/${run.id}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: 'conclusion', eventType: 'bypass', actorType: 'researcher' }),
  });
  assert.equal(genericConclusion.status, 400);
  assert.equal((await genericConclusion.json() as { code: string }).code, 'CONCLUSION_ENDPOINT_REQUIRED');
  const noConversationSource = await fetch(`${base}/api/agent/v1/runs/${run.id}/conclusions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: 'fixture conclusion', artifactIds: [artifact.id], idempotencyKey: 'conclusion-one' }),
  });
  assert.equal(noConversationSource.status, 400);

  const conclusionResult = await runCli(['conclusion', 'record', '--run', run.id, '--summary', '研究者确认 fixture 证据通过', '--artifacts', artifact.id, '--idempotency-key', 'conclusion-one', '--conversation-ref', 'codex-task:conclusion-test']);
  assert.equal(conclusionResult.code, 0, conclusionResult.stderr);
  const conclusion = JSON.parse(conclusionResult.stdout) as { id: string; category: string; payload: { conclusionSha256: string } };
  assert.equal(conclusion.category, 'conclusion');
  assert.match(conclusion.payload.conclusionSha256, /^[a-f0-9]{64}$/);

  const experienceContentFile = path.join(tmpRoot, 'promoted-experience.md');
  fs.writeFileSync(experienceContentFile, '由研究者确认的 fixture 经验。\n', 'utf8');
  fs.writeFileSync(evidencePath, `${evidenceContent.trimEnd()} changed\n`, 'utf8');
  const driftedPromotion = await runCli(['experience', 'promote', '--run', run.id, '--conclusion', conclusion.id, '--artifacts', artifact.id, '--title', 'Fixture evidence lesson', '--content-file', experienceContentFile, '--idempotency-key', 'promotion-one']);
  assert.equal(driftedPromotion.code, 3);
  assert.equal((JSON.parse(driftedPromotion.stderr) as { code: string }).code, 'EVIDENCE_SOURCE_DRIFT');
  fs.writeFileSync(evidencePath, evidenceContent, 'utf8');
  const promotion = await runCli(['experience', 'promote', '--run', run.id, '--conclusion', conclusion.id, '--artifacts', artifact.id, '--title', 'Fixture evidence lesson', '--content-file', experienceContentFile, '--tags', 'fixture,validated', '--idempotency-key', 'promotion-one', '--conversation-ref', 'codex-task:conclusion-test']);
  assert.equal(promotion.code, 0, promotion.stderr);
  const promoted = JSON.parse(promotion.stdout) as { id: string; promoted: number };
  assert.equal(promoted.promoted, 1);
  const repeated = await runCli(['experience', 'promote', '--run', run.id, '--conclusion', conclusion.id, '--artifacts', artifact.id, '--title', 'Fixture evidence lesson', '--content-file', experienceContentFile, '--tags', 'fixture,validated', '--idempotency-key', 'promotion-one', '--conversation-ref', 'codex-task:conclusion-test']);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal((JSON.parse(repeated.stdout) as { id: string }).id, promoted.id);
  const conflictingPromotion = await runCli(['experience', 'promote', '--run', run.id, '--conclusion', conclusion.id, '--artifacts', artifact.id, '--title', 'Different lesson', '--content-file', experienceContentFile, '--tags', 'fixture,validated', '--idempotency-key', 'promotion-one', '--conversation-ref', 'codex-task:conclusion-test']);
  assert.equal(conflictingPromotion.code, 3);
  assert.equal((JSON.parse(conflictingPromotion.stderr) as { code: string }).code, 'EXPERIENCE_PROMOTION_IDEMPOTENCY_CONFLICT');
  assert.equal((await fetch(`${base}/api/experiences/${promoted.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'mutated' }) })).status, 409);
  assert.equal((await fetch(`${base}/api/experiences/${promoted.id}`, { method: 'DELETE' })).status, 409);
  const provenance = await fetch(`${base}/api/experiences/${promoted.id}/provenance`).then(response => response.json()) as { run_id: string; artifacts: { artifact_sha256: string }[] };
  assert.equal(provenance.run_id, run.id);
  assert.equal(provenance.artifacts[0].artifact_sha256, artifact.sha256);

  const library = await fetch(`${base}/api/agent/v1/evidence-library?projectId=${project.id}&taskId=${task.id}&location=local`).then(response => response.json()) as Array<{ id: string; project_name: string; task_id: string; local_available: boolean; checks: unknown[] }>;
  const indexedArtifact = library.find(item => item.id === artifact.id);
  assert.ok(indexedArtifact);
  assert.equal(indexedArtifact.task_id, task.id);
  assert.equal(indexedArtifact.local_available, true);

  const candidateFile = path.join(tmpRoot, 'candidate-experience.md');
  fs.writeFileSync(candidateFile, '条件：fixture validator。现象：输出哈希漂移。处理：重新生成 manifest 后再验证。适用边界：仅相同 validator 版本。\n', 'utf8');
  const captured = await runCli(['experience', 'capture', '--run', run.id, '--step', 'qenm-check-01', '--title', 'Fixture validator hash drift', '--content-file', candidateFile, '--tags', 'fixture,hash-drift', '--idempotency-key', 'candidate-one', '--conversation-ref', 'codex-task:conclusion-test']);
  assert.equal(captured.code, 0, captured.stderr);
  const candidate = JSON.parse(captured.stdout) as { id: string; tags: string };
  assert.match(candidate.id, /^exp-codex-/);
  assert.ok((JSON.parse(candidate.tags) as string[]).includes('codex-captured'));
  const repeatedCapture = await runCli(['experience', 'capture', '--run', run.id, '--step', 'qenm-check-01', '--title', 'Fixture validator hash drift', '--content-file', candidateFile, '--tags', 'fixture,hash-drift', '--idempotency-key', 'candidate-one']);
  assert.equal(repeatedCapture.code, 0, repeatedCapture.stderr);
  assert.equal((JSON.parse(repeatedCapture.stdout) as { id: string }).id, candidate.id);
  const searchExperience = await runCli(['experience', 'search', '--task', task.id, '--query', 'hash drift']);
  assert.equal(searchExperience.code, 0, searchExperience.stderr);
  assert.ok((JSON.parse(searchExperience.stdout) as Array<{ id: string }>).some(item => item.id === candidate.id));
});

test('generic executor runs different materials and workflows without product adapters', async () => {
  const executionContract = await fetch(`${base}/api/agent/v1/execution-contract`).then(response => response.json()) as { capabilities: string[] };
  assert.deepEqual(executionContract.capabilities, ['local.process', 'remote.inspect', 'remote.task-root.create', 'files.upload', 'files.download', 'job.submit', 'job.cancel']);
  assert.doesNotMatch(JSON.stringify(executionContract), /cacro3|material|qe|wien/i);

  const createFixture = async (fixture: { material: string; workflowId: string; stepId: string; token: string }) => {
    const workingDir = path.join(tmpRoot, `generic-${fixture.material}`);
    fs.mkdirSync(workingDir, { recursive: true });
    const project = await fetch(`${base}/api/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${fixture.material} project`, material: fixture.material, working_dir: workingDir }),
    }).then(response => response.json()) as { id: string };
    const task = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${fixture.material} validation`, workflow_id: fixture.workflowId }),
    }).then(response => response.json()) as { id: string; task_root_rel: string };
    const taskRoot = path.join(workingDir, task.task_root_rel);
    fs.mkdirSync(path.join(taskRoot, 'check'), { recursive: true });
    fs.mkdirSync(path.join(taskRoot, 'inputs'), { recursive: true });
    fs.writeFileSync(path.join(taskRoot, 'check', 'validate.py'), `print(${JSON.stringify(fixture.token)})\n`, 'utf8');
    fs.writeFileSync(path.join(taskRoot, 'check', 'fail.py'), "import sys\nprint('fixture failed', file=sys.stderr)\nsys.exit(2)\n", 'utf8');
    fs.writeFileSync(path.join(taskRoot, 'inputs', 'parameters.json'), JSON.stringify({ material: fixture.material }), 'utf8');
    const plan = await fetch(`${base}/api/research-plans`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${fixture.material} plan`, project_id: project.id, content: `# ${fixture.material} plan` }),
    }).then(response => response.json()) as { id: string };
    assert.equal((await fetch(`${base}/api/research-plans/${plan.id}/contract/initialize`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status, 201);
    const run = await fetch(`${base}/api/agent/v1/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: `${fixture.material}-run` }),
    }).then(response => response.json()) as { id: string; current_context_version_id: string };
    return { ...fixture, taskRoot, run };
  };

  const fixtures = [
    await createFixture({ material: 'Material-A', workflowId: 'qe-w90-triqs-spontaneous-magnetic-oneshot', stepId: 'qenm-prep-03', token: 'A_READY' }),
    await createFixture({ material: 'Material-B', workflowId: 'wien2k-dmftproj-triqs-oneshot', stepId: 'wien-prep-02', token: 'B_READY' }),
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const specFile = path.join(tmpRoot, `${fixture.material}-spec.json`);
    fs.writeFileSync(specFile, JSON.stringify({
      executable: pythonExecutable,
      scriptPath: 'check/validate.py',
      inputPaths: ['inputs'],
      stdoutIncludes: [fixture.token],
      validatorName: `${fixture.material}-validator`,
    }), 'utf8');
    const proposal = await runCli([
      'action', 'prepare', '--run', fixture.run.id, '--context-version', fixture.run.current_context_version_id,
      '--step', fixture.stepId, '--capability', 'local.process', '--spec-file', specFile,
      '--idempotency-key', `${fixture.material}-validate`, '--conversation-ref', `codex-task:${fixture.material}`,
    ]);
    assert.equal(proposal.code, 0, proposal.stderr);
    const action = JSON.parse(proposal.stdout) as {
      id: string; status: string; manifest_sha256: string;
      manifest: { capability: string; inputSnapshot: { sha256: string }; receipt: { path: string } };
    };
    assert.equal(action.status, 'proposed');
    assert.equal(action.manifest.capability, 'local.process');
    assert.equal(Object.hasOwn(action.manifest, 'adapter'), false);
    assert.match(action.manifest.inputSnapshot.sha256, /^[a-f0-9]{64}$/);
    const premature = await runCli(['action', 'execute', '--action', action.id]);
    assert.equal(premature.code, 4);
    assert.equal((JSON.parse(premature.stderr) as { code: string }).code, 'ACTION_NOT_AUTHORIZED');
    const authorization = await runCli([
      'action', 'authorize', '--action', action.id, '--context-version', fixture.run.current_context_version_id,
      '--manifest-sha', action.manifest_sha256, '--summary', `研究者确认 ${fixture.material} 通用 manifest`,
      '--conversation-ref', `codex-task:${fixture.material}`,
    ]);
    assert.equal(authorization.code, 0, authorization.stderr);

    const inputPath = path.join(fixture.taskRoot, 'inputs', 'parameters.json');
    const authorizedInput = fs.readFileSync(inputPath, 'utf8');
    if (index === 0) {
      fs.writeFileSync(inputPath, `${authorizedInput}\n`, 'utf8');
      const drift = await fetch(`${base}/api/agent/v1/actions/${action.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(drift.status, 409);
      assert.equal((await drift.json() as { code: string }).code, 'EXECUTION_INPUT_DRIFT');
      fs.writeFileSync(inputPath, authorizedInput, 'utf8');
    }

    const execution = await runCli(['action', 'execute', '--action', action.id]);
    assert.equal(execution.code, 0, execution.stderr);
    const completed = JSON.parse(execution.stdout) as { status: string; artifacts: { path: string }[]; evidenceChecks: { status: string }[] };
    assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
    assert.equal(completed.evidenceChecks[0].status, 'pass');
    assert.ok(fs.existsSync(path.join(fixture.taskRoot, action.manifest.receipt.path)));
  }

  const recoveryFixture = fixtures[1];
  const recoverySpec = path.join(tmpRoot, 'generic-recovery-spec.json');
  fs.writeFileSync(recoverySpec, JSON.stringify({ executable: pythonExecutable, scriptPath: 'check/validate.py', validatorName: 'generic-recovery' }), 'utf8');
  const recoveryProposal = await runCli([
    'action', 'prepare', '--run', recoveryFixture.run.id, '--context-version', recoveryFixture.run.current_context_version_id,
    '--step', recoveryFixture.stepId, '--capability', 'local.process', '--spec-file', recoverySpec,
    '--idempotency-key', 'generic-recovery',
  ]);
  const recoveryAction = JSON.parse(recoveryProposal.stdout) as { id: string; manifest_sha256: string };
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${recoveryAction.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedContextVersionId: recoveryFixture.run.current_context_version_id, expectedManifestSha256: recoveryAction.manifest_sha256, authorizationSummary: '研究者确认恢复门禁测试', source: 'codex_conversation' }),
  })).status, 200);
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${recoveryAction.id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'executing' }),
  })).status, 200);
  const uncertainRecovery = await fetch(`${base}/api/agent/v1/actions/${recoveryAction.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(uncertainRecovery.status, 409);
  assert.equal((await uncertainRecovery.json() as { code: string }).code, 'EXECUTION_RECOVERY_UNCERTAIN');
  const recoveryReviews = await fetch(`${base}/api/agent/v1/reviews?runId=${recoveryFixture.run.id}`).then(response => response.json()) as { gate_type: string; status: string }[];
  assert.ok(recoveryReviews.some(review => review.gate_type === 'execution_recovery_uncertain' && review.status === 'open'));

  const failingFixture = fixtures[0];
  const failureSpec = path.join(tmpRoot, 'generic-failure-spec.json');
  fs.writeFileSync(failureSpec, JSON.stringify({ executable: pythonExecutable, scriptPath: 'check/fail.py', validatorName: 'generic-failure' }), 'utf8');
  const failureProposal = await runCli([
    'action', 'prepare', '--run', failingFixture.run.id, '--context-version', failingFixture.run.current_context_version_id,
    '--step', failingFixture.stepId, '--capability', 'local.process', '--spec-file', failureSpec,
    '--idempotency-key', 'generic-failure',
  ]);
  const failingAction = JSON.parse(failureProposal.stdout) as { id: string; manifest_sha256: string };
  assert.equal((await fetch(`${base}/api/agent/v1/actions/${failingAction.id}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedContextVersionId: failingFixture.run.current_context_version_id, expectedManifestSha256: failingAction.manifest_sha256, authorizationSummary: '研究者确认失败分支测试', source: 'codex_conversation' }),
  })).status, 200);
  const failed = await fetch(`${base}/api/agent/v1/actions/${failingAction.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json()) as { status: string; evidenceChecks: { status: string }[] };
  assert.equal(failed.status, 'failed');
  assert.equal(failed.evidenceChecks[0].status, 'fail');
  const reviews = await fetch(`${base}/api/agent/v1/reviews?runId=${failingFixture.run.id}`).then(response => response.json()) as { gate_type: string; status: string }[];
  assert.ok(reviews.some(review => review.gate_type === 'execution_failed' && review.status === 'open'));
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

test('LSF capability and resource parsers recognize the bounded remote contract', async () => {
  const { isProtectedRelativePath, parseLsfResources, parseLsfScheduler, smokeBudgetAllowsOneCoreMinute } = await import('../server/services/remote.js');
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
  assert.deepEqual(parseLsfResources('#BSUB -q snode\n#BSUB -n 64\n#BSUB -W 04:00\n'), { queue: 'snode', cores: 64, wallMinutes: 240 });
  assert.throws(() => parseLsfResources('#BSUB -n 64\n'), (error: { code?: string }) => error.code === 'LSF_RESOURCES_INCOMPLETE');
});

test('authorized generic LSF submission is single-shot and uncertain responses reconcile without resubmission', async () => {
  const userReadRoot = '/pilot/user';
  const projectRoot = '/pilot/user/project-remote';
  const taskWriteRoot = '/pilot/user/project-remote/tk001-generic';
  const systemRemotePolicy = {
    schemaVersion: 1, remoteEnabled: true, smokeAuthorized: false,
    allowedOperations: ['context', 'event.append', 'review.request', 'remote.inspect', 'remote.task-root.create', 'files.upload', 'files.download', 'job.submit', 'job.status', 'job.logs', 'job.reconcile', 'job.cancel'],
    allowedHosts: ['pilot'], allowedMethods: ['qe-scf'],
    remoteReadRoot: userReadRoot, remoteProjectRoot: userReadRoot, remoteWriteRoot: userReadRoot,
    limits: { maxCoresPerJob: 64, maxWallMinutes: 240, maxConcurrentJobs: 2, maxAutomaticRetries: 0 },
    protectedPaths: ['results'], humanGates: ['final_interpretation'],
  };
  assert.equal((await fetch(`${base}/api/agent/v1/policies`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeType: 'system', policy: systemRemotePolicy, activate: true }),
  })).status, 201);

  const workingDir = path.join(tmpRoot, 'generic-remote-project');
  fs.mkdirSync(workingDir, { recursive: true });
  const project = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Remote material fixture', material: 'Material-Remote', working_dir: workingDir }),
  }).then(response => response.json()) as { id: string };
  const task = await fetch(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Generic remote route', workflow_id: 'qe-w90-triqs-spontaneous-magnetic-oneshot' }),
  }).then(response => response.json()) as { id: string; task_root_rel: string };
  const hpcConfig = {
    schemaVersion: 2,
    profiles: [{ id: 'pilot-profile', name: 'Pilot cluster', sshAlias: 'pilot', userRoot: userReadRoot, projectRoot, scheduler: 'LSF', notes: '' }],
    defaultProfileId: 'pilot-profile',
    taskBindings: [{ taskId: task.id, profileId: 'pilot-profile', taskRootRel: 'tk001-generic' }],
  };
  assert.equal((await fetch(`${base}/api/projects/${project.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hpc_config: JSON.stringify(hpcConfig) }),
  })).status, 200);
  assert.equal((await fetch(`${base}/api/agent/v1/remote/tasks/${task.id}/inspect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: 'pilot', remoteRoot: userReadRoot }),
  })).status, 404);
  const taskRemotePolicy = {
    ...systemRemotePolicy,
    remoteReadRoot: userReadRoot,
    remoteProjectRoot: projectRoot,
    remoteWriteRoot: taskWriteRoot,
  };
  assert.equal((await fetch(`${base}/api/agent/v1/policies`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeType: 'task', scopeId: task.id, policy: taskRemotePolicy, activate: true }),
  })).status, 201);

  const taskRoot = path.join(workingDir, task.task_root_rel);
  fs.mkdirSync(path.join(taskRoot, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(taskRoot, 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -J fixture\n#BSUB -q snode\n#BSUB -n 64\n#BSUB -W 04:00\necho fixture\n', 'utf8');
  fs.writeFileSync(path.join(taskRoot, 'inputs', 'model.dat'), 'fixture input\n', 'utf8');
  const plan = await fetch(`${base}/api/research-plans`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Generic remote plan', project_id: project.id, content: '# Remote Plan' }),
  }).then(response => response.json()) as { id: string };
  assert.equal((await fetch(`${base}/api/research-plans/${plan.id}/contract/initialize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 201);
  const currentContract = await fetch(`${base}/api/research-plans/${plan.id}/contract`).then(response => response.json()) as { contract: any; planSha256: string };
  const scientificContract = {
    ...currentContract.contract,
    boundaries: { ...currentContract.contract.boundaries, allowedSoftwareStacks: ['qe'], allowedMethods: ['qe-scf'] },
    resourceBudget: { maxCoresPerJob: 64, maxWallMinutes: 240, maxConcurrentJobs: 2, maxAutomaticRetries: 0 },
  };
  assert.equal((await fetch(`${base}/api/research-plans/${plan.id}/contract`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: stringifyYaml(scientificContract), expectedPlanSha256: currentContract.planSha256 }),
  })).status, 200);
  const run = await fetch(`${base}/api/agent/v1/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'remote-run' }),
  }).then(response => response.json()) as { id: string; current_context_version_id: string };

  const { setRemoteProcessRunnerForTests } = await import('../server/services/remote.js');
  let bsubCalls = 0;
  let uncertainJobName = '';
  setRemoteProcessRunnerForTests(async (command, args) => {
    assert.equal(command, 'ssh');
    const remoteCommand = args.at(-1) ?? '';
    if (remoteCommand.includes('mkdir -- "$target"')) {
      return { code: 0, stdout: `PROJECT_ROOT=${projectRoot}\nTASK_ROOT=${taskWriteRoot}\nCREATED=1\n`, stderr: '' };
    }
    if (remoteCommand.includes('sha256sum')) {
      assert.match(remoteCommand, /jobs\/run\.lsf/);
      assert.match(remoteCommand, /inputs\/model\.dat/);
      return { code: 0, stdout: 'VERIFIED_FILES=2\n', stderr: '' };
    }
    if (remoteCommand.includes('bsub -J')) {
      bsubCalls += 1;
      return bsubCalls === 1
        ? { code: 0, stdout: 'Job <4242> is submitted to queue <snode>.\n', stderr: '' }
        : { code: 255, stdout: '', stderr: 'connection closed after request\n' };
    }
    if (remoteCommand.includes('bjobs -a -J')) return { code: 0, stdout: `5252 RUN ${uncertainJobName}\n`, stderr: '' };
    if (remoteCommand.includes('bjobs -noheader -o stat')) return { code: 0, stdout: 'DONE\n', stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected fixture command: ${remoteCommand}` };
  });
  try {
    const taskRootActionResponse = await fetch(`${base}/api/agent/v1/runs/${run.id}/executable-actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contextVersionId: run.current_context_version_id,
        stepId: 'qenm-prep-02',
        capability: 'remote.task-root.create',
        spec: { host: 'pilot', remoteRoot: taskWriteRoot },
        idempotencyKey: 'create-remote-task-root',
        conversationRef: 'codex-task:remote-test',
      }),
    });
    assert.equal(taskRootActionResponse.status, 201);
    const taskRootAction = await taskRootActionResponse.json() as { id: string; manifest_sha256: string; manifest: { remote: { root: string }; executionPreview: { commands: string[] } } };
    assert.equal(taskRootAction.manifest.remote.root, taskWriteRoot);
    assert.match(taskRootAction.manifest.executionPreview.commands[0], /tk001-generic/);
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${taskRootAction.id}/authorize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: taskRootAction.manifest_sha256, authorizationSummary: '研究者确认创建精确远程 Task 根 fixture', source: 'codex_conversation' }),
    })).status, 200);
    const taskRootCreated = await fetch(`${base}/api/agent/v1/actions/${taskRootAction.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json()) as { status: string };
    assert.equal(taskRootCreated.status, 'succeeded');

    const readProposal = await fetch(`${base}/api/agent/v1/runs/${run.id}/executable-actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextVersionId: run.current_context_version_id, stepId: 'qenm-prep-02', capability: 'files.download', spec: { host: 'pilot', remoteRoot: userReadRoot, remotePath: 'shared/reference.dat', localPath: 'inputs/reference.dat' }, idempotencyKey: 'read-user-root' }),
    });
    assert.equal(readProposal.status, 201);
    const escapedRead = await fetch(`${base}/api/agent/v1/runs/${run.id}/executable-actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextVersionId: run.current_context_version_id, stepId: 'qenm-prep-02', capability: 'files.download', spec: { host: 'pilot', remoteRoot: '/pilot/other-user', remotePath: 'reference.dat', localPath: 'inputs/outside.dat' }, idempotencyKey: 'read-outside-user-root' }),
    });
    assert.equal(escapedRead.status, 403);
    assert.equal((await escapedRead.json() as { code: string }).code, 'REMOTE_READ_ROOT_DENIED');
    const escapedWrite = await fetch(`${base}/api/agent/v1/runs/${run.id}/executable-actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextVersionId: run.current_context_version_id, stepId: 'qenm-prep-02', capability: 'files.upload', spec: { host: 'pilot', remoteRoot: projectRoot, remotePath: 'other-task/input.dat', localPath: 'inputs/model.dat' }, idempotencyKey: 'write-project-root' }),
    });
    assert.equal(escapedWrite.status, 403);
    assert.equal((await escapedWrite.json() as { code: string }).code, 'REMOTE_WRITE_ROOT_DENIED');

    const propose = async (key: string) => fetch(`${base}/api/agent/v1/runs/${run.id}/executable-actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contextVersionId: run.current_context_version_id,
        stepId: 'qenm-dft-02',
        capability: 'job.submit',
        spec: {
          host: 'pilot',
          remoteRoot: taskWriteRoot,
          method: 'qe-scf',
          softwareStack: 'qe',
          remoteWorkdir: 'material-remote',
          localScriptPath: 'jobs/run.lsf',
          remoteScriptPath: 'jobs/run.lsf',
          remoteInputs: [{ localPath: 'inputs/model.dat', remotePath: 'inputs/model.dat' }],
        },
        idempotencyKey: key,
        conversationRef: 'codex-task:remote-test',
      }),
    }).then(response => response.json()) as Promise<{ id: string; manifest_sha256: string; manifest: { submission: { resources: { cores: number; wallMinutes: number } } } }>;
    const first = await propose('scientific-submit-one');
    assert.deepEqual(first.manifest.submission.resources, { queue: 'snode', cores: 64, wallMinutes: 240 });
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${first.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 409);
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${first.id}/authorize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: first.manifest_sha256, authorizationSummary: '研究者确认 64 核 4 小时 SCF fixture', source: 'codex_conversation' }),
    })).status, 200);
    const submitted = await fetch(`${base}/api/agent/v1/actions/${first.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json()) as { status: string; remoteJob: { id: string; job_id: string } };
    assert.equal(submitted.status, 'waiting_remote');
    assert.equal(submitted.remoteJob.job_id, '4242');
    assert.equal((await fetch(`${base}/api/agent/v1/remote/jobs/${submitted.remoteJob.id}/cancel`, { method: 'POST' })).status, 404);
    const observed = await fetch(`${base}/api/agent/v1/remote/jobs/${submitted.remoteJob.id}/status`, { method: 'POST' }).then(response => response.json()) as { status: string };
    assert.equal(observed.status, 'done');
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${first.id}`).then(response => response.json()) as { status: string }).status, 'succeeded');

    const uncertain = await propose('scientific-submit-uncertain');
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${uncertain.id}/authorize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedContextVersionId: run.current_context_version_id, expectedManifestSha256: uncertain.manifest_sha256, authorizationSummary: '研究者确认第二个 SCF fixture', source: 'codex_conversation' }),
    })).status, 200);
    const uncertainAction = await fetch(`${base}/api/agent/v1/actions/${uncertain.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json()) as { status: string; remoteJob: { id: string; job_name: string; status: string } };
    assert.equal(uncertainAction.status, 'waiting_user');
    assert.equal(uncertainAction.remoteJob.status, 'submission_uncertain');
    assert.match(uncertainAction.remoteJob.job_name, /^wb-action-/);
    assert.doesNotMatch(uncertainAction.remoteJob.job_name, /material|qe|scf/i);
    uncertainJobName = uncertainAction.remoteJob.job_name;
    const reconciled = await fetch(`${base}/api/agent/v1/remote/jobs/${uncertainAction.remoteJob.id}/reconcile`, { method: 'POST' }).then(response => response.json()) as { job_id: string; status: string };
    assert.equal(reconciled.job_id, '5252');
    assert.equal(reconciled.status, 'done');
    assert.equal((await fetch(`${base}/api/agent/v1/actions/${uncertain.id}`).then(response => response.json()) as { status: string }).status, 'succeeded');
    assert.equal(bsubCalls, 2);
  } finally {
    setRemoteProcessRunnerForTests(null);
  }
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
  const remoteJobColumns = verifyDb.prepare('PRAGMA table_info(remote_jobs)').all() as { name: string }[];
  const v2Tables = new Set((verifyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(item => item.name));
  const userVersion = verifyDb.pragma('user_version', { simple: true }) as number;
  verifyDb.close();

  assert.equal(row?.project_id, 'proj-existing');
  assert.match(schema.sql.replace(/\s+/g, ''), /UNIQUE\(project_id,file_name\)/i);
  assert.equal(userVersion, 4);
  assert.ok(reviewColumns.some(column => column.name === 'idempotency_key'));
  assert.ok(reviewColumns.some(column => column.name === 'source'));
  assert.ok(remoteJobColumns.some(column => column.name === 'action_id'));
  assert.ok(remoteJobColumns.some(column => column.name === 'execution_manifest_sha256'));
  assert.ok(v2Tables.has('run_actions'));
  assert.ok(v2Tables.has('run_artifacts'));
  assert.ok(v2Tables.has('evidence_checks'));
  assert.ok(v2Tables.has('experience_promotions'));
  assert.ok(v2Tables.has('experience_promotion_artifacts'));
  assert.ok(
    fs.existsSync(path.join(tmpRoot, 'migration.before-research-plans-v3.db')),
    'migration should create a database backup',
  );
  assert.ok(
    fs.existsSync(path.join(tmpRoot, 'migration.before-agent-v1.db')),
    'Agent V1 migration should create a one-time consistency backup',
  );
  const v1BackupPath = path.join(tmpRoot, 'migration.before-workbench-v2.db');
  assert.ok(fs.existsSync(v1BackupPath), 'Workbench V2 migration should preserve the V1 schema first');

  const v1UpgradePath = path.join(tmpRoot, 'migration-from-v1.db');
  fs.copyFileSync(v1BackupPath, v1UpgradePath);
  const v1UpgradeScript = `
    process.env.WORKBENCH_DB_PATH = ${JSON.stringify(v1UpgradePath)};
    const { closeDb } = await import(${JSON.stringify(dbModuleUrl)});
    closeDb();
  `;
  const upgradedFromV1 = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', v1UpgradeScript],
    { cwd: ROOT, encoding: 'utf-8' },
  );
  assert.equal(upgradedFromV1.status, 0, upgradedFromV1.stderr);
  const verifyV1Upgrade = new Database(v1UpgradePath, { readonly: true });
  assert.equal(verifyV1Upgrade.pragma('user_version', { simple: true }), 4);
  assert.equal(verifyV1Upgrade.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(verifyV1Upgrade.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_actions'").get());
  verifyV1Upgrade.close();
});
