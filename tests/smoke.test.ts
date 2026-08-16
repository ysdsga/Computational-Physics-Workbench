/**
 * Essential Workbench V3 behavior tests.
 * All writes use a disposable database and project directory.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-essential-v3-'));
process.env.WORKBENCH_DB_PATH = path.join(tmpRoot, 'test.db');
process.env.WORKBENCH_PORT = '0';
const python = spawnSync('python', ['--version'], { windowsHide: true }).status === 0 ? 'python' : 'python3';
process.env.WORKBENCH_LOCAL_EXEC_ENABLED = '1';
process.env.WORKBENCH_LOCAL_EXECUTABLES = python;
process.env.WORKBENCH_REMOTE_ENABLED = '1';
process.env.WORKBENCH_ALLOW_REMOTE_LSF = '1';
process.env.WORKBENCH_REMOTE_TEST_MODE = '1';

let server: Server | undefined;
let base = '';

async function api(pathname: string, options?: RequestInit) {
  const response = await fetch(`${base}${pathname}`, { headers: { 'content-type': 'application/json' }, ...options });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'workbench.js'), ...args], { cwd: ROOT, env: { ...process.env, WORKBENCH_URL: base }, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  process.chdir(tmpRoot);
  const module = await import(pathToFileURL(path.join(ROOT, 'server', 'index.ts')).href);
  server = module.server;
  if (!server.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  const { closeDb } = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  closeDb();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* Windows may retain a transient handle. */ }
});

test('server, schema v5 and CLI doctor start on disposable state', async () => {
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  const doctor = await runCli(['doctor']);
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).runtimeSchemaVersion, 2);
  const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  assert.equal(dbModule.default.pragma('user_version', { simple: true }), 5);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'test.before-essential-v3.db')));
});

interface Fixture {
  project: any; task: any; plan: any; taskRoot: string; stages: string[]; envelope: any; spec: any;
}

async function createFixture(name: string): Promise<Fixture> {
  const workingDir = path.join(tmpRoot, name); fs.mkdirSync(workingDir, { recursive: true });
  const projectResult = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, material: name, working_dir: workingDir }) });
  assert.equal(projectResult.response.status, 201); const project = projectResult.payload as any;
  const taskResult = await api(`/api/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify({ name: `${name}-task`, workflow_id: 'qe-w90-triqs-spontaneous-magnetic-oneshot' }) });
  assert.equal(taskResult.response.status, 201); const task = taskResult.payload as any;
  const taskRoot = path.join(workingDir, task.task_root_rel);
  const stages = task.workflow.stages.map((item: any) => item.id) as string[];
  assert.ok(fs.statSync(taskRoot).isDirectory());
  for (const stage of stages) assert.equal(fs.existsSync(path.join(taskRoot, stage)), false, 'Workbench must not impose stage directories');
  const hpcConfig = {
    schemaVersion: 2, defaultProfileId: 'test-lsf',
    profiles: [{ id: 'test-lsf', name: 'Test LSF', sshAlias: 'test-lsf', scheduler: 'LSF', userRoot: '/home/tester', projectRoot: `/home/tester/${name}` }],
    taskBindings: [{ taskId: task.id, profileId: 'test-lsf', taskRootRel: `tk_${name}` }],
  };
  const configured = await api(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ hpc_config: JSON.stringify(hpcConfig) }) });
  assert.equal(configured.response.status, 200);
  const planResult = await api('/api/research-plans', { method: 'POST', body: JSON.stringify({ title: `${name} research`, project_id: project.id, linked_task_ids: [task.id] }) });
  assert.equal(planResult.response.status, 201); const plan = planResult.payload as any;
  const envelope = {
    schemaVersion: 1,
    coreStageIds: stages,
    scientificCommitments: ['Use a nonmagnetic one-electron Hamiltonian and permit spontaneous spin symmetry breaking only in DMFT'],
    allowedCapabilities: ['local.process', 'remote.inspect', 'remote.task-root.create', 'files.upload', 'files.download', 'job.submit', 'job.cancel'],
    allowedMethods: ['oneshot-dft-dmft'], allowedSoftwareStacks: ['QE+Wannier90+TRIQS'], hpcProfileId: 'test-lsf',
    resourceLimits: { maxCoresPerJob: 64, maxWallMinutes: 240, maxConcurrentJobs: 2, maxAutomaticRetries: 2 },
    protectedRelativePaths: ['published'], completionEvidence: ['validated DFT, Wannier and DMFT outputs'],
    researcherGates: ['scientific conclusion'],
    autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
  };
  const spec = { schemaVersion: 1, objective: `Reproduce ${name} through the confirmed route`, confirmedEnvelope: envelope, workingPlan: { currentStageId: stages[0], summary: 'Prepare inputs', directoryLayout: { note: 'Codex chooses the tree' } } };
  return { project: configured.payload, task, plan, taskRoot, stages, envelope, spec };
}

test('Task Spec gets one confirmation while Working Plan and Actions remain autonomous', async () => {
  const fixture = await createFixture('fixture-a');
  const draftResult = await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-a-run' }) });
  assert.equal(draftResult.response.status, 201); const draft = draftResult.payload as any;
  assert.equal(draft.status, 'draft'); assert.match(draft.confirmed_envelope_sha256, /^[a-f0-9]{64}$/);

  const contextBefore = await api(`/api/agent/v1/context/tasks/${fixture.task.id}`);
  assert.ok((contextBefore.payload as any).blockers.some((item: any) => item.code === 'ENVELOPE_NOT_CONFIRMED'));
  const premature = await api(`/api/agent/v1/runs/${draft.id}/actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[0], actionType: 'planning.note', spec: { note: 'too early' }, idempotencyKey: 'early' }) });
  assert.equal(premature.response.status, 409);

  const badConfirmation = await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'clicked in Web', source: 'web' }) });
  assert.equal(badConfirmation.response.status, 400);
  const confirmedResult = await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'Researcher confirmed this exact Envelope in Codex.', source: 'codex_conversation', conversationRef: 'codex-task:test' }) });
  assert.equal(confirmedResult.response.status, 200); assert.equal((confirmedResult.payload as any).status, 'active');

  const nextPlan = { currentStageId: fixture.stages[0], summary: 'Codex selected a task-local tree and first validator', directoryLayout: { inputs: 'work/inputs', evidence: 'analysis/evidence' } };
  const planResult = await api(`/api/agent/v1/runs/${draft.id}/working-plan`, { method: 'PUT', body: JSON.stringify({ workingPlan: nextPlan, reason: 'Initial autonomous decomposition', idempotencyKey: 'working-plan-1' }) });
  assert.equal(planResult.response.status, 200); assert.equal((planResult.payload as any).envelope_revision, 1); assert.equal((planResult.payload as any).working_plan.summary, nextPlan.summary);

  const actionResult = await api(`/api/agent/v1/runs/${draft.id}/actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[0], actionType: 'planning.note', spec: { next: 'prepare inputs' }, idempotencyKey: 'note-1' }) });
  assert.equal(actionResult.response.status, 201); assert.equal((actionResult.payload as any).status, 'ready'); assert.match((actionResult.payload as any).spec_sha256, /^[a-f0-9]{64}$/);
});

test('generic local Action records receipts, evidence, corrections and candidate experience without material adapters', async () => {
  const fixture = await createFixture('fixture-b');
  const specFile = path.join(tmpRoot, 'fixture-b-task-spec.json'); fs.writeFileSync(specFile, JSON.stringify(fixture.spec));
  const drafted = await runCli(['run', 'draft', '--task', fixture.task.id, '--plan', fixture.plan.id, '--task-spec-file', specFile, '--idempotency-key', 'fixture-b-run']);
  assert.equal(drafted.code, 0, drafted.stderr); const run = JSON.parse(drafted.stdout);
  const confirmed = await runCli(['run', 'confirm', '--run', run.id, '--summary', 'Researcher confirmed exact Envelope', '--conversation-ref', 'codex-task:local']);
  assert.equal(confirmed.code, 0, confirmed.stderr);

  fs.mkdirSync(path.join(fixture.taskRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'work', 'validate.py'), "print('VALIDATED')\n");
  const actionSpecPath = path.join(tmpRoot, 'local-action.json');
  fs.writeFileSync(actionSpecPath, JSON.stringify({ executable: python, scriptPath: 'work/validate.py', inputPaths: ['work/validate.py'], validatorName: 'fixture-validator', stdoutIncludes: ['VALIDATED'] }));
  const prepared = await runCli(['action', 'prepare', '--run', run.id, '--stage', fixture.stages[0], '--capability', 'local.process', '--spec-file', actionSpecPath, '--idempotency-key', 'validate-once']);
  assert.equal(prepared.code, 0, prepared.stderr); const action = JSON.parse(prepared.stdout);
  assert.equal(action.status, 'ready'); assert.equal(action.spec.capability, 'local.process');
  const executed = await runCli(['action', 'execute', '--action', action.id]);
  assert.equal(executed.code, 0, executed.stderr); assert.equal(JSON.parse(executed.stdout).status, 'succeeded');
  const details = await api(`/api/agent/v1/actions/${action.id}`); const actionDetails = details.payload as any;
  assert.equal(actionDetails.artifacts.length, 1); assert.equal(actionDetails.evidenceChecks[0].status, 'pass');

  const corrected = await api(`/api/agent/v1/artifacts/${actionDetails.artifacts[0].id}/validity`, { method: 'POST', body: JSON.stringify({ validity: 'suspect', reason: 'Upstream scientific choice is being rechecked' }) });
  assert.equal(corrected.response.status, 200); assert.equal((corrected.payload as any).validity, 'suspect');

  const lesson = path.join(tmpRoot, 'lesson.md'); fs.writeFileSync(lesson, 'Condition: same validator. Symptom: missing marker. Response: inspect stdout and input snapshot. Boundary: validator v1 only.');
  const captured = await runCli(['experience', 'capture', '--run', run.id, '--stage', fixture.stages[0], '--title', 'Validator marker diagnosis', '--content-file', lesson, '--applicable-scope', 'Same validator version and execution environment', '--artifacts', actionDetails.artifacts[0].id, '--idempotency-key', 'lesson-1']);
  assert.equal(captured.code, 0, captured.stderr); assert.equal(JSON.parse(captured.stdout).status, 'candidate');
});

test('researcher pending items block only their stage and enable explicit Envelope correction', async () => {
  const fixture = await createFixture('fixture-c');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-c-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  const pendingResult = await api(`/api/agent/v1/runs/${draft.id}/pending-items`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[0], audience: 'researcher', kind: 'scientific_boundary_change', title: 'Need to expand completion evidence', detail: { blocksRun: true, proposedDifference: 'Add spectral validation' }, idempotencyKey: 'boundary-change' }) });
  assert.equal(pendingResult.response.status, 201); const pending = pendingResult.payload as any;
  const blocked = await api(`/api/agent/v1/runs/${draft.id}/actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[0], actionType: 'planning.note', spec: {}, idempotencyKey: 'blocked-stage' }) });
  assert.equal(blocked.response.status, 409); assert.equal((blocked.payload as any).code, 'STAGE_WAITING_RESEARCHER');
  const unaffected = await api(`/api/agent/v1/runs/${draft.id}/actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[1], actionType: 'planning.note', spec: { safe: true }, idempotencyKey: 'unaffected-stage' }) });
  assert.equal(unaffected.response.status, 201);
  const revisedEnvelope = { ...fixture.envelope, completionEvidence: [...fixture.envelope.completionEvidence, 'validated local spectral plot'] };
  const revised = await api(`/api/agent/v1/runs/${draft.id}/envelope-revisions`, { method: 'POST', body: JSON.stringify({ confirmedEnvelope: revisedEnvelope, pendingItemId: pending.id, summary: 'Researcher confirmed additional evidence', source: 'codex_conversation', conversationRef: 'codex-task:correction' }) });
  assert.equal(revised.response.status, 200); assert.equal((revised.payload as any).envelope_revision, 2); assert.equal((revised.payload as any).status, 'active');
});

test('LSF submission is recorded before bsub, sanity checked, and uncertain responses reconcile without resubmission', async () => {
  const fixture = await createFixture('fixture-remote');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-remote-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  fs.mkdirSync(path.join(fixture.taskRoot, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -q snode\n#BSUB -n 4\n#BSUB -W 00:10\necho run\n');

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  let bsubCount = 0; let failNextSubmit = false; let currentName = ''; let nextJobId = 700;
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    const remoteCommand = args.at(-1) ?? '';
    if (command === 'ssh' && remoteCommand.includes('bsub -J')) {
      bsubCount += 1; currentName = remoteCommand.match(/-J\s+'([^']+)'/)?.[1] ?? '';
      if (failNextSubmit) { failNextSubmit = false; throw new Error('simulated lost SSH response'); }
      nextJobId += 1; return { code: 0, stdout: `Job <${nextJobId}> is submitted.\n`, stderr: '' };
    }
    if (command === 'ssh' && remoteCommand.includes('bjobs -a -J')) return { code: 0, stdout: `${nextJobId + 1} RUN ${currentName}\n`, stderr: '' };
    if (command === 'ssh' && remoteCommand.includes("bjobs -a '") && remoteCommand.includes('-noheader')) return { code: 0, stdout: `${nextJobId} RUN ${currentName}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });

  const createSubmission = async (key: string) => {
    const result = await api(`/api/agent/v1/runs/${draft.id}/executable-actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[1], capability: 'job.submit', spec: { method: 'oneshot-dft-dmft', softwareStack: 'QE+Wannier90+TRIQS', remoteWorkdir: `jobs/${key}`, localScriptPath: 'jobs/run.lsf', remoteScriptPath: 'run.lsf', submissionKey: key }, idempotencyKey: `action-${key}` }) });
    assert.equal(result.response.status, 201); return result.payload as any;
  };
  const first = await createSubmission('submit-a');
  const firstExecute = await api(`/api/agent/v1/actions/${first.id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(firstExecute.response.status, 200); assert.equal((firstExecute.payload as any).status, 'waiting_remote'); assert.equal(bsubCount, 1);

  failNextSubmit = true;
  const uncertainAction = await createSubmission('submit-b');
  const uncertain = await api(`/api/agent/v1/actions/${uncertainAction.id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(uncertain.response.status, 200); assert.equal((uncertain.payload as any).status, 'waiting_codex'); assert.equal(bsubCount, 2);
  const context = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  const uncertainJob = context.recentJobs.find((item: any) => item.action_id === uncertainAction.id);
  assert.equal(uncertainJob.status, 'submission_uncertain');
  assert.ok(context.pendingItems.some((item: any) => item.audience === 'codex' && item.kind === 'submission_uncertain'));
  const reconciled = await api(`/api/agent/v1/remote/jobs/${uncertainJob.id}/reconcile`, { method: 'POST', body: '{}' });
  assert.equal(reconciled.response.status, 200); assert.equal(bsubCount, 2, 'reconciliation must never call bsub again');
  remoteModule.setRemoteProcessRunnerForTests(null);
});

test('execution product surface contains no material-specific route', () => {
  const surface = ['server/services/actionExecutor.ts', 'server/services/remote.ts', 'server/routes/agent.ts', 'bin/workbench.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(surface, /cacro3|v2o3|submit-scf|10_scf/i);
});
