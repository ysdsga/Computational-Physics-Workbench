import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { negotiateLanguage } from '../server/services/language.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-language-'));
process.env.WORKBENCH_DB_PATH = path.join(temporary, 'language.db');
process.env.WORKBENCH_PORT = '0';
process.env.WORKBENCH_LANG = 'en';
process.env.WORKBENCH_LOCAL_EXEC_ENABLED = '1';
process.env.WORKBENCH_LOCAL_EXECUTABLES = 'node';
process.env.WORKBENCH_REMOTE_DISABLED = '1';
let server: Server;
let base: string;

before(async () => {
  const app = await import('../server/index.js');
  server = app.server;
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  const { closeDb } = await import('../server/db.js');
  closeDb();
  fs.rmSync(temporary, { recursive: true, force: true });
});

async function api(endpoint: string, method = 'GET', body?: unknown, language?: string) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(language ? { 'Accept-Language': language } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}

function cli(args: string[], language?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, WORKBENCH_URL: base };
    if (language === undefined) delete env.WORKBENCH_LANG;
    else env.WORKBENCH_LANG = language;
    const child = spawn(process.execPath, [path.join(root, 'bin/workbench.js'), ...args], {
      windowsHide: true,
      env,
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('language preferences respect quality, supported variants and the legacy API default', () => {
  assert.equal(negotiateLanguage(undefined), 'zh-CN');
  assert.equal(negotiateLanguage('fr, en-US;q=0.8, zh-CN;q=0.3'), 'en');
  assert.equal(negotiateLanguage('en;q=0, zh-CN;q=1'), 'zh-CN');
  assert.equal(negotiateLanguage('en;q=bad'), 'zh-CN');
  assert.equal(negotiateLanguage('zh-TW, en'), 'zh-CN');
  assert.equal(negotiateLanguage('fr', 'en'), 'en');
});

test('help works without a server and invalid language fails before a request', async () => {
  for (const args of [['--help'], ['-h'], ['help'], ['action', 'prepare', '--help']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'bin/workbench.js'), ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /WORKBENCH_LANG/);
    assert.equal(result.stdout, '');
  }
  const result = await cli(['doctor', '--lang', 'fr']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Language must be en or zh-CN/);
});

test('concurrent API requests localize generated HPC text and preserve researcher content', async () => {
  const projects = await Promise.all(['en', 'zh-CN', undefined].map(async language => {
    const project = await api('/api/projects', 'POST', { name: '研究名称 / Research name', description: '保留原始研究记录' }, language);
    return api(`/api/projects/${project.id}`, 'PUT', { hpc_config: { host: 'test-cluster', user: 'researcher', remotePath: '/home/researcher' } }, language);
  }));
  assert.equal(JSON.parse(projects[0].hpc_config).profiles[0].name, 'Legacy configuration');
  assert.match(JSON.parse(projects[0].hpc_config).profiles[0].notes, /separate user and project roots/);
  for (const project of projects.slice(1)) assert.equal(JSON.parse(project.hpc_config).profiles[0].name, '原有配置');
  for (const project of projects) {
    assert.equal(project.name, '研究名称 / Research name');
    assert.equal(project.description, '保留原始研究记录');
  }
  const custom = { schemaVersion: 2, defaultProfileId: 'custom', profiles: [{ id: 'custom', name: '原有配置', notes: '用户自定义说明', sshAlias: 'cluster', scheduler: 'LSF', userRoot: '/home/user', projectRoot: '/home/user/project' }], taskBindings: [] };
  const updated = await api(`/api/projects/${projects[0].id}`, 'PUT', { hpc_config: custom }, 'en');
  assert.deepEqual(JSON.parse(updated.hpc_config), custom);
});

test('CLI language flag overrides the environment and does not rewrite stored names', async () => {
  const project = await api('/api/projects', 'POST', { name: '保持中文' });
  const configuration = path.join(temporary, 'legacy.json');
  fs.writeFileSync(configuration, JSON.stringify({ host: 'cluster', remotePath: '/home/user' }));
  const args = ['hpc', 'configure', '--project', project.id, '--file', configuration];
  const english = await cli([...args, '--lang', 'en'], 'zh-CN');
  assert.equal(english.code, 0, english.stderr);
  assert.equal(JSON.parse(english.stdout).config.profiles[0].name, 'Legacy configuration');
  assert.equal(JSON.parse(english.stdout).projectName, '保持中文');
  const chinese = await cli(args, 'zh-CN');
  assert.equal(chinese.code, 0, chinese.stderr);
  assert.equal(JSON.parse(chinese.stdout).config.profiles[0].name, '原有配置');
  const defaultLanguage = await cli(args);
  assert.equal(defaultLanguage.code, 0, defaultLanguage.stderr);
  assert.equal(JSON.parse(defaultLanguage.stdout).config.profiles[0].name, 'Legacy configuration');
});

test('localized Action previews retain immutable hashes on cross-language retries', async () => {
  const projectDir = path.join(temporary, 'project');
  fs.mkdirSync(projectDir);
  const project = await api('/api/projects', 'POST', { name: 'preview', working_dir: projectDir });
  const task = await api(`/api/projects/${project.id}/tasks`, 'POST', { name: 'preview', workflow_id: 'dft-dmft-oneshot' });
  const plan = await api('/api/research-plans', 'POST', { title: 'Preview test', project_id: project.id, linked_task_ids: [task.id] });
  const stages = task.workflow.stages.map((stage: { id: string }) => stage.id);
  const envelope = {
    schemaVersion: 1, coreStageIds: stages, scientificCommitments: ['Test metadata only'],
    allowedCapabilities: ['local.process'], allowedMethods: ['test'], allowedSoftwareStacks: ['node'],
    resourceLimits: { maxCoresPerJob: 1, maxWallMinutes: 1, maxConcurrentJobs: 1, maxAutomaticRetries: 0 },
    protectedRelativePaths: [], completionEvidence: ['metadata checks'], researcherGates: ['scientific conclusion'],
    autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
  };
  const run = await api('/api/agent/v1/runs', 'POST', {
    taskId: task.id, researchPlanId: plan.id, idempotencyKey: 'preview-run',
    taskSpec: { schemaVersion: 1, objective: 'Test preview localization', confirmedEnvelope: envelope, workingPlan: { currentStageId: stages[0], summary: 'Prepare metadata' } },
  });
  await api(`/api/agent/v1/runs/${run.id}/confirm`, 'POST', { summary: 'Confirm disposable metadata test', source: 'codex_conversation' });
  fs.writeFileSync(path.join(projectDir, task.task_root_rel, 'preview.js'), 'console.log("test");\n');
  const input = { stageId: stages[0], capability: 'local.process', spec: { executable: 'node', scriptPath: 'preview.js' }, idempotencyKey: 'preview-action' };
  const endpoint = `/api/agent/v1/runs/${run.id}/executable-actions`;
  const english = await api(endpoint, 'POST', input, 'en');
  assert.match(english.executionPreview.note, /^Codex runs/);
  assert.match(english.spec.executionPreview.note, /Task 根内/);
  const retry = await api(endpoint, 'POST', input, 'zh-CN');
  assert.equal(retry.id, english.id);
  assert.equal(retry.spec_sha256, english.spec_sha256);
  assert.deepEqual(retry.spec, english.spec);
  assert.match(retry.executionPreview.note, /Task 根内/);
  const shown = await api(`/api/agent/v1/actions/${english.id}`, 'GET', undefined, 'en');
  assert.equal(shown.spec_sha256, english.spec_sha256);
  assert.deepEqual(shown.spec, english.spec);
  assert.match(shown.executionPreview.note, /^Codex runs/);
  const chinese = await api(endpoint, 'POST', { ...input, idempotencyKey: 'preview-chinese' }, 'zh-CN');
  assert.match(chinese.spec.executionPreview.note, /Task 根内/);
  for (const language of ['en', 'zh-CN']) {
    const context = await api(`/api/agent/v1/context/tasks/${task.id}`, 'GET', undefined, language);
    const action = context.recentActions.find((item: { id: string }) => item.id === english.id);
    assert.deepEqual(action.spec, english.spec);
    assert.equal(action.spec_sha256, english.spec_sha256);
    assert.match(action.executionPreview.note, language === 'en' ? /^Codex runs/ : /Task 根内/);
  }
  const fullContext = await cli(['context', '--task', task.id, '--full', '--allow-blocked']);
  assert.equal(fullContext.code, 0, fullContext.stderr);
  const cliAction = JSON.parse(fullContext.stdout).recentActions.find((item: { id: string }) => item.id === english.id);
  assert.match(cliAction.executionPreview.note, /^Codex runs/);
  assert.deepEqual(cliAction.spec, english.spec);
  for (const note of ['constructor', 'toString', '__proto__']) {
    const custom = await api(`/api/agent/v1/runs/${run.id}/actions`, 'POST', {
      stageId: stages[0], actionType: 'scientific.test', idempotencyKey: `custom-preview-${note}`,
      spec: { executionPreview: { transport: 'local', commands: [], note } },
    }, 'en');
    assert.equal(custom.executionPreview.note, note);
    assert.equal(custom.spec.executionPreview.note, note);
  }
  const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' }, body: JSON.stringify({ ...input, spec: { ...input.spec, args: ['changed'] } }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ACTION_IDEMPOTENCY_CONFLICT');
});

test('language adaptation preserves baseline CORS defaults and exact explicit replacement', async () => {
  const { createApp } = await import('../server/index.js');
  const previousPort = process.env.WORKBENCH_PORT;
  const previousOrigins = process.env.WORKBENCH_ALLOWED_ORIGINS;
  for (const configuration of [
    { port: undefined, explicit: undefined, allowed: ['http://localhost:5173', 'http://127.0.0.1:5173'], denied: ['http://localhost:3001', 'http://127.0.0.1:3001', 'https://untrusted.example'] },
    { port: '', explicit: undefined, allowed: ['http://localhost:5173'], denied: ['http://localhost:3001'] },
    { port: '4321', explicit: undefined, allowed: ['http://localhost:5173'], denied: ['http://localhost:4321', 'http://127.0.0.1:4321'] },
    { port: '3311', explicit: 'http://127.0.0.1:3311', allowed: ['http://127.0.0.1:3311'], denied: ['http://localhost:3311', 'http://localhost:5173'] },
    { port: '3001', explicit: '', allowed: [], denied: ['http://localhost:5173', 'http://127.0.0.1:3001'] },
    { port: '3001', explicit: 'https://workbench.example', allowed: ['https://workbench.example'], denied: ['http://localhost:3001', 'http://localhost:5173'] },
  ]) {
    let corsServer: Server | undefined;
    try {
      if (configuration.port === undefined) delete process.env.WORKBENCH_PORT;
      else process.env.WORKBENCH_PORT = configuration.port;
      if (configuration.explicit === undefined) delete process.env.WORKBENCH_ALLOWED_ORIGINS;
      else process.env.WORKBENCH_ALLOWED_ORIGINS = configuration.explicit;
      corsServer = createApp().listen(0, '127.0.0.1');
      await new Promise<void>(resolve => corsServer!.once('listening', resolve));
      const url = `http://127.0.0.1:${(corsServer.address() as { port: number }).port}/api/projects`;
      for (const origin of configuration.allowed) {
        const headers = { Origin: origin, 'Content-Type': 'application/json' };
        const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name: 'CORS test' }) });
        assert.equal(created.status, 201, origin);
        assert.equal(created.headers.get('Access-Control-Allow-Origin'), origin);
        const project = await created.json();
        const updated = await fetch(`${url}/${project.id}`, { method: 'PUT', headers, body: JSON.stringify({ name: 'Updated' }) });
        assert.equal(updated.status, 200);
        assert.equal((await updated.json()).name, 'Updated');
        const read = await fetch(`${url}/${project.id}`, { headers });
        assert.equal((await read.json()).name, 'Updated');
        assert.equal((await fetch(`${url}/${project.id}`, { method: 'DELETE', headers })).status, 200);
      }
      for (const origin of configuration.denied) {
        const denied = await fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Must not create' }) });
        assert.equal(denied.status, 403, origin);
        assert.equal((await denied.json()).code, 'CORS_DENIED');
      }
    } finally {
      if (corsServer) await new Promise<void>(resolve => corsServer!.close(() => resolve()));
      if (previousPort === undefined) delete process.env.WORKBENCH_PORT;
      else process.env.WORKBENCH_PORT = previousPort;
      if (previousOrigins === undefined) delete process.env.WORKBENCH_ALLOWED_ORIGINS;
      else process.env.WORKBENCH_ALLOWED_ORIGINS = previousOrigins;
    }
  }
});
