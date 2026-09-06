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
delete process.env.WORKBENCH_REMOTE_ENABLED;
delete process.env.WORKBENCH_ALLOW_REMOTE_LSF;
delete process.env.WORKBENCH_REMOTE_DISABLED;
delete process.env.WORKBENCH_REMOTE_SUBMIT_DISABLED;
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

test('server, schema v14 and CLI doctor start on disposable state', async () => {
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  const doctor = await runCli(['doctor']);
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).runtimeSchemaVersion, 4);
  const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  assert.equal(dbModule.default.pragma('user_version', { simple: true }), 14);
  assert.ok(fs.existsSync(path.join(tmpRoot, 'test.before-essential-v3.db')));
  assert.ok(fs.existsSync(path.join(tmpRoot, 'test.before-job-monitor-v6.db')));
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

test('workflow template CLI can patch and reset templates and task snapshots', async () => {
  const workflowId = 'qe-w90-triqs-spontaneous-magnetic-oneshot';
  const shown = await runCli(['workflow', 'template-show', '--workflow', workflowId]);
  assert.equal(shown.code, 0, shown.stderr);
  const originalTemplate = JSON.parse(shown.stdout);
  const firstStage = originalTemplate.stages[0];

  const patchPath = path.join(tmpRoot, 'workflow-patch.json');
  fs.writeFileSync(patchPath, JSON.stringify({
    stageUpdates: [{ id: firstStage.id, changes: { description: 'Temporary CLI test description' } }],
  }));
  const patched = await runCli(['workflow', 'template-patch', '--workflow', workflowId, '--file', patchPath]);
  assert.equal(patched.code, 0, patched.stderr);
  assert.equal(JSON.parse(patched.stdout).stages[0].description, 'Temporary CLI test description');

  const fixture = await createFixture('workflow-cli');
  const taskBefore = await api(`/api/projects/${fixture.project.id}/tasks/${fixture.task.id}`);
  assert.equal(taskBefore.response.status, 200);
  const taskWorkflow = (taskBefore.payload as any).workflow;
  taskWorkflow.stages[0].description = 'Task-only temporary description';
  const taskUpdate = await api(`/api/projects/${fixture.project.id}/tasks/${fixture.task.id}/workflow`, {
    method: 'PUT',
    body: JSON.stringify({ ...taskWorkflow, expectedWorkflowSha256: (taskBefore.payload as any).workflow_sha256 }),
  });
  assert.equal(taskUpdate.response.status, 200);

  const taskReset = await runCli([
    'workflow', 'reset-task', '--task', fixture.task.id,
    '--expected-sha', (taskUpdate.payload as any).sha256,
  ]);
  assert.equal(taskReset.code, 0, taskReset.stderr);
  assert.equal(JSON.parse(taskReset.stdout).stages[0].description, 'Temporary CLI test description');

  const reset = await runCli(['workflow', 'template-reset', '--workflow', workflowId]);
  assert.equal(reset.code, 0, reset.stderr);
  assert.equal(JSON.parse(reset.stdout).stages[0].description, firstStage.description);
});

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

test('legacy theoretical Runs retain their confirmed exploration contract without retroactive goal requirements', async () => {
  const workingDir = path.join(tmpRoot, 'theory-exploration');
  fs.mkdirSync(workingDir, { recursive: true });
  const projectResult = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Theory exploration', working_dir: workingDir }),
  });
  assert.equal(projectResult.response.status, 201);
  const project = projectResult.payload as any;
  const taskResult = await api(`/api/projects/${project.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Theory task', workflow_id: 'theoretical-research' }),
  });
  assert.equal(taskResult.response.status, 201);
  const task = taskResult.payload as any;
  assert.ok(task.workflow.steps.some((step: any) => step.id === 'theory-interpretation-04'));
  const planResult = await api('/api/research-plans', {
    method: 'POST',
    body: JSON.stringify({ title: 'Theory exploration plan', project_id: project.id, linked_task_ids: [task.id] }),
  });
  assert.equal(planResult.response.status, 201);
  const plan = planResult.payload as any;
  const stages = task.workflow.stages.map((stage: any) => stage.id);
  const taskSpec = {
    schemaVersion: 1,
    objective: 'Resolve a theoretical question and its strongest generative follow-up',
    confirmedEnvelope: {
      schemaVersion: 1,
      coreStageIds: stages,
      scientificCommitments: ['Test the central claim and material high-value alternatives'],
      allowedCapabilities: ['local.process'],
      allowedMethods: ['analytic-derivation'],
      allowedSoftwareStacks: [],
      hpcProfileId: null,
      resourceLimits: { maxCoresPerJob: 1, maxWallMinutes: 10, maxConcurrentJobs: 1, maxAutomaticRetries: 0 },
      protectedRelativePaths: [],
      completionEvidence: ['exploration review and final argument'],
      scientificGoal: { question: 'Original question', successCriteria: ['Answer it'], insufficientOutcomes: ['Only a checklist'], acceptedAnswerTypes: ['explanation'] },
      researcherGates: [],
      autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
    },
    workingPlan: { currentStageId: 'question', summary: 'Start from the central question' },
  };
  const draftResult = await api('/api/agent/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ taskId: task.id, researchPlanId: plan.id, taskSpec, idempotencyKey: 'theory-exploration-run' }),
  });
  assert.equal(draftResult.response.status, 201);
  const draft = draftResult.payload as any;
  assert.equal(draft.confirmed_envelope.explorationReviewRequired, true, 'new theoretical Runs default to an enabled review');
  // Emulate a pre-upgrade persisted Envelope in this disposable database only.
  const legacyEnvelope = { ...draft.confirmed_envelope };
  delete legacyEnvelope.scientificGoal;
  const legacyDb = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  legacyDb.default.prepare('UPDATE research_runs SET confirmed_envelope_json = ? WHERE id = ?').run(JSON.stringify(legacyEnvelope), draft.id);
  const confirmed = await api(`/api/agent/v1/runs/${draft.id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }),
  });
  assert.equal(confirmed.response.status, 200);

  const forgedReflection = await api(`/api/agent/v1/runs/${draft.id}/events`, {
    method: 'POST',
    body: JSON.stringify({
      category: 'decision',
      eventType: 'stage.reflection',
      actorType: 'agent',
      payload: { stageId: 'question', decision: 'proceed' },
    }),
  });
  assert.equal(forgedReflection.response.status, 409);
  assert.equal((forgedReflection.payload as any).code, 'STAGE_REFLECTION_ENDPOINT_REQUIRED');

  const missingReview = await api(`/api/agent/v1/runs/${draft.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ summary: 'premature', source: 'codex_conversation' }),
  });
  assert.equal(missingReview.response.status, 409);
  assert.equal((missingReview.payload as any).code, 'STAGE_REFLECTIONS_REQUIRED');

  const reflection = (stageId: string, body: Record<string, unknown>, key: string) => api(`/api/agent/v1/runs/${draft.id}/stage-reflections`, {
    method: 'POST',
    body: JSON.stringify({
      stageId,
      summary: `${stageId} reflection`,
      established: [`${stageId} result`],
      uncertainties: [],
      ideas: [],
      decision: 'proceed',
      nextActions: stageId === 'release' ? [] : [{ objective: `continue after ${stageId}` }],
      ...body,
      idempotencyKey: key,
    }),
  });

  const staying = await reflection('question', {
    summary: 'The question still has one unresolved discriminator',
    established: ['The target observable is fixed'],
    uncertainties: ['The decisive comparison has not yet been stated'],
    decision: 'stay',
    targetStageId: 'question',
    nextActions: [{ objective: 'State the decisive comparison' }],
  }, 'question-stay');
  assert.equal(staying.response.status, 201);
  assert.equal((staying.payload as any).run.current_stage_id, 'question');

  for (const stageId of ['question', 'context', 'model', 'baseline', 'derivation']) {
    const result = await reflection(stageId, {}, `initial-${stageId}`);
    assert.equal(result.response.status, 201);
  }
  const looping = await reflection('validation', {
    summary: 'A dynamic/static ambiguity requires the model to be revisited',
    established: ['The first derivation is internally consistent'],
    uncertainties: ['The strongest static alternative is not yet excluded'],
    ideas: [{
      idea: 'Can the result be reproduced by the strongest static alternative mechanism?',
      significance: 'It could overturn the claim of a genuinely dynamic effect',
      disposition: 'explore',
      reason: 'This is the earliest decisive discriminator',
      evidenceRefs: [],
    }, {
      idea: 'Does the derived scaling survive the controlled limit?',
      significance: 'It could materially extend or restrict the central prediction',
      disposition: 'explore',
      reason: 'The controlled limit is the cleanest test of the proposed scaling',
      evidenceRefs: [],
    }],
    decision: 'loop',
    targetStageId: 'model',
    nextActions: [{ objective: 'Build and test the matched static control' }],
  }, 'validation-loop-model');
  assert.equal(looping.response.status, 201);
  assert.equal((looping.payload as any).run.current_stage_id, 'model');
  assert.equal((looping.payload as any).run.working_plan.explorationReview.status, 'continue');
  assert.equal((looping.payload as any).run.working_plan.explorationReview.unresolvedHighValueItems.length, 2);

  const continuingCompletion = await api(`/api/agent/v1/runs/${draft.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ summary: 'still premature', source: 'codex_conversation' }),
  });
  assert.equal(continuingCompletion.response.status, 409);
  assert.equal((continuingCompletion.payload as any).code, 'STAGE_REFLECTIONS_REQUIRED');

  const revisedModel = await reflection('model', {
    summary: 'The matched static control is now explicit',
  }, 'revised-model');
  assert.equal(revisedModel.response.status, 201);
  for (const stageId of ['baseline', 'derivation', 'validation']) {
    const result = await reflection(stageId, {}, `revised-${stageId}`);
    assert.equal(result.response.status, 201);
  }
  const omittedIdea = await reflection('interpretation', {}, 'interpretation-omits-open-idea');
  assert.equal(omittedIdea.response.status, 409);
  assert.equal((omittedIdea.payload as any).code, 'EXPLORATION_REVIEW_UNRESOLVED');
  const deferredIdea = await reflection('interpretation', {
    ideas: [{
      idea: 'Can the result be reproduced by the strongest static alternative mechanism?',
      significance: 'It could overturn the claim of a genuinely dynamic effect',
      disposition: 'deferred',
      reason: 'A later study could run a broader parameter scan',
      evidenceRefs: [],
    }],
  }, 'interpretation-defers-open-idea');
  assert.equal(deferredIdea.response.status, 409);
  assert.equal((deferredIdea.payload as any).code, 'EXPLORATION_REVIEW_UNRESOLVED');
  const followUpIdea = await reflection('interpretation', {
    ideas: [{
      idea: 'Can the result be reproduced by the strongest static alternative mechanism?',
      significance: 'It could overturn the claim of a genuinely dynamic effect',
      disposition: 'follow_up',
      reason: 'The Agent proposes a later follow-up task',
      evidenceRefs: [],
    }],
  }, 'interpretation-transfers-open-idea');
  assert.equal(followUpIdea.response.status, 409);
  assert.equal((followUpIdea.payload as any).code, 'EXPLORATION_REVIEW_UNRESOLVED');
  const unsupportedClosure = await reflection('interpretation', {
    ideas: [{
      idea: 'Can the result be reproduced by the strongest static alternative mechanism?',
      significance: 'It could overturn the claim of a genuinely dynamic effect',
      disposition: 'falsified',
      reason: 'The Agent asserts that the alternative fails',
      evidenceRefs: [],
    }],
  }, 'interpretation-unsupported-closure');
  assert.equal(unsupportedClosure.response.status, 400);
  assert.equal((unsupportedClosure.payload as any).code, 'STAGE_REFLECTION_CLOSURE_EVIDENCE_REQUIRED');
  const resolvedIdea = await reflection('interpretation', {
    ideas: [{
      idea: 'Can the result be reproduced by the strongest static alternative mechanism?',
      significance: 'It could overturn the claim of a genuinely dynamic effect',
      disposition: 'falsified',
      reason: 'The matched control fails the derived frequency discriminator',
      evidenceRefs: ['analysis/static_control.md#frequency-discriminator'],
    }, {
      idea: 'Does the derived scaling survive the controlled limit?',
      significance: 'It could materially extend or restrict the central prediction',
      disposition: 'resolved',
      reason: 'The controlled-limit derivation establishes the scaling domain',
      evidenceRefs: ['analysis/controlled_limit.md#scaling-domain'],
    }],
  }, 'interpretation-resolves-open-idea');
  assert.equal(resolvedIdea.response.status, 201);
  const released = await reflection('release', {}, 'revised-release');
  assert.equal(released.response.status, 201);

  const events = await api(`/api/agent/v1/runs/${draft.id}/events`);
  const reflections = (events.payload as any[]).filter(event => event.event_type === 'stage.reflection');
  assert.equal(reflections.length, 13);
  assert.equal(reflections.filter(event => event.payload.stageId === 'question').length, 2, 'stay permits another reflection in the same stage');
  assert.equal(reflections.filter(event => event.payload.stageId === 'model').length, 2, 'a stage may accumulate multiple reflections after a loop');
  assert.equal(reflections.filter(event => event.payload.stageId === 'validation').length, 2, 'reflection history is append-only rather than one-per-stage');
  assert.ok(reflections.some(event => event.payload.ideas.some((idea: any) => idea.disposition === 'explore')));
  assert.ok(reflections.some(event => event.payload.ideas.some((idea: any) => idea.disposition === 'falsified')));
  assert.ok(reflections.some(event => event.payload.ideas.some((idea: any) => idea.disposition === 'resolved')));
  assert.ok(reflections.flatMap(event => event.payload.ideas).filter((idea: any) => ['resolved', 'falsified'].includes(idea.disposition)).every((idea: any) => idea.evidenceRefs.length > 0));

  const context = await api(`/api/agent/v1/context/tasks/${task.id}`);
  assert.equal((context.payload as any).schemaVersion, 4);
  assert.equal((context.payload as any).latestStageReflections.length, stages.length);
  assert.equal((context.payload as any).latestStageReflections.find((item: any) => item.stageId === 'validation').decision, 'proceed');

  const idempotentReplay = await reflection('question', {}, 'initial-question');
  assert.equal(idempotentReplay.response.status, 201);
  assert.equal((idempotentReplay.payload as any).run.current_stage_id, null, 'an idempotent retry must not replay the stage transition');

  const completed = await api(`/api/agent/v1/runs/${draft.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ summary: 'review passed', source: 'codex_conversation' }),
  });
  assert.equal(completed.response.status, 200);
  assert.equal((completed.payload as any).status, 'completed');

  const completedContext = await api(`/api/agent/v1/context/tasks/${task.id}`);
  assert.equal(completedContext.response.status, 200);
  assert.equal((completedContext.payload as any).run.id, draft.id);
  assert.equal((completedContext.payload as any).run.status, 'completed');
  assert.ok(!(completedContext.payload as any).blockers.some((item: any) => item.code === 'RUN_NOT_STARTED'));
});

test('theoretical exploration completion guard is explicitly opt-out and does not become global', async () => {
  const workingDir = path.join(tmpRoot, 'theory-exploration-opt-out');
  fs.mkdirSync(workingDir, { recursive: true });
  const project = (await api('/api/projects', {
    method: 'POST', body: JSON.stringify({ name: 'Theory opt-out', working_dir: workingDir }),
  })).payload as any;
  const task = (await api(`/api/projects/${project.id}/tasks`, {
    method: 'POST', body: JSON.stringify({ name: 'Theory opt-out task', workflow_id: 'theoretical-research' }),
  })).payload as any;
  const plan = (await api('/api/research-plans', {
    method: 'POST', body: JSON.stringify({ title: 'Theory opt-out plan', project_id: project.id, linked_task_ids: [task.id] }),
  })).payload as any;
  const stages = task.workflow.stages.map((stage: any) => stage.id);
  const draft = (await api('/api/agent/v1/runs', {
    method: 'POST',
    body: JSON.stringify({
      taskId: task.id,
      researchPlanId: plan.id,
      idempotencyKey: 'theory-opt-out-run',
      taskSpec: {
        schemaVersion: 1,
        objective: 'Compatibility fixture',
        confirmedEnvelope: {
          schemaVersion: 1,
          coreStageIds: stages,
          scientificCommitments: [],
          allowedCapabilities: ['local.process'],
          allowedMethods: [],
          allowedSoftwareStacks: [],
          hpcProfileId: null,
          resourceLimits: { maxCoresPerJob: 1, maxWallMinutes: 10, maxConcurrentJobs: 1, maxAutomaticRetries: 0 },
          protectedRelativePaths: [],
          completionEvidence: ['compatibility evidence'],
          researcherGates: [],
          explorationReviewRequired: false,
          autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
        },
        workingPlan: { currentStageId: stages[0], summary: 'Compatibility plan' },
      },
    }),
  })).payload as any;
  assert.equal(draft.confirmed_envelope.explorationReviewRequired, false);
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, {
    method: 'POST', body: JSON.stringify({ summary: 'confirmed opt-out', source: 'codex_conversation' }),
  });
  const completed = await api(`/api/agent/v1/runs/${draft.id}/complete`, {
    method: 'POST', body: JSON.stringify({ summary: 'opt-out compatibility', source: 'codex_conversation' }),
  });
  assert.equal(completed.response.status, 200);
});

test('Agent ledger reads complete histories while explicit API limits remain opt-in', async () => {
  const fixture = await createFixture('fixture-unbounded-ledger');
  const draftResult = await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({
    taskId: fixture.task.id,
    researchPlanId: fixture.plan.id,
    taskSpec: fixture.spec,
    idempotencyKey: 'fixture-unbounded-ledger-run',
  }) });
  assert.equal(draftResult.response.status, 201);
  const run = draftResult.payload as any;
  const confirmed = await api(`/api/agent/v1/runs/${run.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  assert.equal(confirmed.response.status, 200);

  const actionsModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'agentActions.ts')).href);
  const createdActions: any[] = [];
  for (let index = 0; index < 105; index += 1) {
    createdActions.push(actionsModule.createAction(run.id, {
      stageId: fixture.stages[0],
      actionType: 'ledger.fixture',
      spec: { index },
      idempotencyKey: `ledger-action-${index}`,
    }));
  }
  for (let index = 0; index < 105; index += 1) {
    actionsModule.registerEvidenceCheck(createdActions[0].id, {
      validatorName: `ledger-validator-${index}`,
      validatorVersion: '1',
      status: 'pass',
      result: { index },
      idempotencyKey: `ledger-evidence-${index}`,
    });
  }

  const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
  const insertJob = dbModule.default.prepare(`INSERT INTO remote_jobs (
    id, run_id, action_id, stage_id, action_token, idempotency_key, profile_id,
    host, remote_workdir, scheduler, job_id, job_name, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lsf', ?, ?, 'done', ?)`);
  const createdAt = new Date().toISOString();
  dbModule.default.transaction(() => {
    for (let index = 0; index < 105; index += 1) {
      insertJob.run(
        `ledger-job-${index}`, run.id, createdActions[0].id, fixture.stages[0],
        `ledger-token-${index}`, `ledger-job-key-${index}`, 'test-lsf', 'test-lsf',
        `/home/tester/ledger/${index}`, `ledger-scheduler-${index}`, `ledger-job-name-${index}`, createdAt,
      );
    }
  })();

  const contextResult = await api(`/api/agent/v1/context/tasks/${fixture.task.id}`);
  assert.equal(contextResult.response.status, 200);
  const context = contextResult.payload as any;
  assert.equal(context.recentActions.length, 105);
  assert.equal(context.recentJobs.length, 105);
  assert.equal(context.recentEvidenceChecks.length, 105);

  const events = await api(`/api/agent/v1/runs/${run.id}/events`);
  assert.equal(events.response.status, 200);
  assert.ok((events.payload as any[]).length > 100);
  const actions = await api(`/api/agent/v1/runs/${run.id}/actions`);
  assert.equal((actions.payload as any[]).length, 105);
  const evidence = await api(`/api/agent/v1/runs/${run.id}/evidence-checks`);
  assert.equal((evidence.payload as any[]).length, 105);

  const limited = await api(`/api/agent/v1/runs/${run.id}/actions?limit=7`);
  assert.equal(limited.response.status, 200);
  assert.equal((limited.payload as any[]).length, 7);
});

test('confirmed Task session runs routine remote commands with automatic logs and no Actions', async () => {
  const fixture = await createFixture('fixture-session');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-session-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  let observedRemoteCommand = '';
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    assert.equal(command, 'ssh');
    observedRemoteCommand = args.at(-1) ?? '';
    return { code: observedRemoteCommand.includes('false') ? 9 : 0, stdout: 'session-ok\n', stderr: observedRemoteCommand.includes('false') ? 'expected failure\n' : '' };
  });

  const session = await runCli(['remote', 'session', '--task', fixture.task.id]);
  assert.equal(session.code, 0, session.stderr);
  assert.equal(JSON.parse(session.stdout).routineOperationsCreateActions, false);

  const executed = await runCli(['remote', 'exec', '--task', fixture.task.id, '--access', 'write', '--scope', 'task', '--cwd', '.', '--command', 'mkdir -p work && pwd']);
  assert.equal(executed.code, 0, executed.stderr);
  assert.equal(JSON.parse(executed.stdout).ok, true);
  assert.match(observedRemoteCommand, /WORKBENCH_TASK_ROOT/);
  assert.match(observedRemoteCommand, /mkdir -p work/);

  const failed = await runCli(['remote', 'exec', '--task', fixture.task.id, '--command', 'false']);
  assert.equal(failed.code, 0, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).ok, false);

  const actions = await api(`/api/agent/v1/runs/${draft.id}/actions`);
  assert.equal((actions.payload as any[]).length, 0, 'routine commands must not create Action permission records');
  const events = await api(`/api/agent/v1/runs/${draft.id}/events`);
  assert.ok((events.payload as any[]).some(item => item.event_type === 'remote.command_completed'));
  assert.ok((events.payload as any[]).some(item => item.event_type === 'remote.command_failed'));

  const schedulerBypass = await runCli(['remote', 'exec', '--task', fixture.task.id, '--access', 'write', '--command', 'bsub < run.lsf']);
  assert.equal(schedulerBypass.code, 3);
  assert.equal(JSON.parse(schedulerBypass.stderr).code, 'REMOTE_SCHEDULER_MUTATION_REQUIRES_JOB_API');

  const context = await runCli(['context', '--task', fixture.task.id, '--allow-blocked']);
  assert.equal(context.code, 0, context.stderr);
  const compact = JSON.parse(context.stdout);
  assert.equal(compact.view, 'compact');
  assert.equal(compact.run.envelopeSha256, draft.confirmed_envelope_sha256);
  assert.equal(compact.run.confirmed_envelope, undefined);
  assert.ok(Array.isArray(compact.workflow.stages));
  assert.equal(compact.workflow.stages[0].steps, undefined);
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
  delete process.env.WORKBENCH_LOCAL_EXEC_ENABLED;
  const disabled = await api(`/api/agent/v1/actions/${action.id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(disabled.response.status, 403); assert.equal((disabled.payload as any).code, 'LOCAL_EXEC_ENV_DISABLED');
  const stillReady = await api(`/api/agent/v1/actions/${action.id}`);
  assert.equal((stillReady.payload as any).status, 'ready');
  process.env.WORKBENCH_LOCAL_EXEC_ENABLED = '1';
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

test('retry lineage is single-chain and the confirmed retry budget is enforced', async () => {
  const fixture = await createFixture('fixture-retry');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-retry-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  const create = async (key: string, retryOfActionId?: string) => api(`/api/agent/v1/runs/${draft.id}/actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[0], actionType: 'diagnostic', spec: { attempt: key }, idempotencyKey: key, retryOfActionId }) });
  const failForRetry = async (actionId: string) => {
    await api(`/api/agent/v1/actions/${actionId}/status`, { method: 'POST', body: JSON.stringify({ status: 'executing' }) });
    await api(`/api/agent/v1/actions/${actionId}/status`, { method: 'POST', body: JSON.stringify({ status: 'waiting_codex', error: { diagnosed: true } }) });
  };
  const original = (await create('retry-0')).payload as any; await failForRetry(original.id);
  const retry1 = await create('retry-1', original.id); assert.equal(retry1.response.status, 201); assert.equal((retry1.payload as any).retry_attempt, 1); await failForRetry((retry1.payload as any).id);
  const branch = await create('retry-branch', original.id); assert.equal(branch.response.status, 409); assert.equal((branch.payload as any).code, 'ACTION_RETRY_ALREADY_CREATED');
  const retry2 = await create('retry-2', (retry1.payload as any).id); assert.equal(retry2.response.status, 201); assert.equal((retry2.payload as any).retry_attempt, 2); await failForRetry((retry2.payload as any).id);
  const retry3 = await create('retry-3', (retry2.payload as any).id); assert.equal(retry3.response.status, 409); assert.equal((retry3.payload as any).code, 'ACTION_RETRY_LIMIT_REACHED');

  const cancelled = (await create('retry-cancelled-0')).payload as any;
  await api(`/api/agent/v1/actions/${cancelled.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'cancelled', result: { reason: 'Known-invalid Action was stopped before replacement' } }) });
  const cancelledRetry = await create('retry-cancelled-1', cancelled.id);
  assert.equal(cancelledRetry.response.status, 201);
  assert.equal((cancelledRetry.payload as any).retry_attempt, 1);
});

test('LSF submission is recorded before bsub, sanity checked, and uncertain responses reconcile without resubmission', async () => {
  const fixture = await createFixture('fixture-remote');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-remote-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  fs.mkdirSync(path.join(fixture.taskRoot, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -q snode\n#BSUB -n 4\n#BSUB -W 00:10\necho run\n');

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  let bsubCount = 0; let failNextSubmit = false; let currentName = ''; let nextJobId = 700; let schedulerStatus = 'RUN';
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    const remoteCommand = args.at(-1) ?? '';
    if (command === 'ssh' && remoteCommand.includes('bsub -J')) {
      bsubCount += 1; currentName = remoteCommand.match(/-J\s+'([^']+)'/)?.[1] ?? '';
      if (failNextSubmit) { failNextSubmit = false; throw new Error('simulated lost SSH response'); }
      nextJobId += 1; return { code: 0, stdout: `Job <${nextJobId}> is submitted.\n`, stderr: '' };
    }
    if (command === 'ssh' && remoteCommand.includes("bjobs -a -noheader -o 'jobid stat job_name' -J")) return { code: 0, stdout: `${nextJobId + 1} ${schedulerStatus} ${currentName}\n`, stderr: '' };
    if (command === 'ssh' && remoteCommand.includes("bjobs -a -noheader -o 'jobid stat job_name'") && !remoteCommand.includes(' -J ')) return { code: 0, stdout: `${nextJobId} ${schedulerStatus} ${currentName}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });

  const createSubmission = async (key: string) => {
    const result = await api(`/api/agent/v1/runs/${draft.id}/executable-actions`, { method: 'POST', body: JSON.stringify({ stageId: fixture.stages[1], capability: 'job.submit', spec: { method: 'oneshot-dft-dmft', softwareStack: 'QE+Wannier90+TRIQS', remoteWorkdir: `jobs/${key}`, localScriptPath: 'jobs/run.lsf', remoteScriptPath: 'run.lsf', submissionKey: key }, idempotencyKey: `action-${key}` }) });
    assert.equal(result.response.status, 201); return result.payload as any;
  };
  const first = await createSubmission('submit-a');
  const firstExecute = await api(`/api/agent/v1/actions/${first.id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(firstExecute.response.status, 200); assert.equal((firstExecute.payload as any).status, 'waiting_remote'); assert.equal(bsubCount, 1);
  const guardBefore = await api('/api/agent/v1/monitor/guard');
  assert.equal((guardBefore.payload as any).ok, false);
  const inactiveAttach = await api(`/api/agent/v1/runs/${draft.id}/monitor/attach`, { method: 'POST', body: JSON.stringify({ automationRef: 'automation:test-current-chat', automationState: 'paused', cadenceMinutes: 10 }) });
  assert.equal(inactiveAttach.response.status, 409, 'a paused automation ID must not satisfy the monitor guard');
  const attached = await api(`/api/agent/v1/runs/${draft.id}/monitor/attach`, { method: 'POST', body: JSON.stringify({ automationRef: 'automation:test-current-chat', automationState: 'active', cadenceMinutes: 10 }) });
  assert.equal(attached.response.status, 200); assert.equal((attached.payload as any).status, 'scheduled');
  assert.equal((attached.payload as any).heartbeat_fresh, true);
  const guardAfter = await api('/api/agent/v1/monitor/guard');
  assert.equal((guardAfter.payload as any).ok, true);

  failNextSubmit = true;
  const uncertainAction = await createSubmission('submit-b');
  const uncertain = await api(`/api/agent/v1/actions/${uncertainAction.id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(uncertain.response.status, 200); assert.equal((uncertain.payload as any).status, 'waiting_codex'); assert.equal(bsubCount, 2);
  const context = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  const uncertainJob = context.recentJobs.find((item: any) => item.action_id === uncertainAction.id);
  assert.equal(uncertainJob.status, 'submission_uncertain');
  assert.ok(context.pendingItems.some((item: any) => item.audience === 'codex' && item.kind === 'submission_uncertain'));
  const ticked = await api(`/api/agent/v1/runs/${draft.id}/monitor/tick`, { method: 'POST', body: '{}' });
  assert.equal(ticked.response.status, 200); assert.equal((ticked.payload as any).checkedJobs, 1); assert.equal(bsubCount, 2, 'monitor tick must never call bsub again');
  const contextAfter = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  assert.equal(contextAfter.monitor.status, 'scheduled');
  assert.equal(contextAfter.monitor.recommended_cadence_minutes, 2);
  assert.equal(contextAfter.monitor.heartbeat_fresh, true);
  assert.equal(contextAfter.recentJobs.find((item: any) => item.id === uncertainJob.id).status, 'run');

  schedulerStatus = 'DONE';
  const activeJobs = contextAfter.recentJobs.filter((item: any) => item.status === 'run');
  for (const job of activeJobs) {
    const terminal = await api(`/api/agent/v1/remote/jobs/${job.id}/reconcile`, { method: 'POST', body: '{}' });
    assert.equal(terminal.response.status, 200);
    assert.equal((terminal.payload as any).status, 'done');
  }
  const terminalMonitor = (await api(`/api/agent/v1/runs/${draft.id}/monitor`)).payload as any;
  assert.equal(terminalMonitor.status, 'complete');
  assert.equal(terminalMonitor.automation_ref, 'automation:test-current-chat', 'automation remains bound until deletion is acknowledged');
  const terminalDirective = (await api(`/api/agent/v1/runs/${draft.id}/monitor/directive`)).payload as any;
  assert.equal(terminalDirective.action, 'delete');
  const guardNeedsCleanup = (await api('/api/agent/v1/monitor/guard')).payload as any;
  assert.equal(guardNeedsCleanup.ok, false);
  assert.equal(guardNeedsCleanup.cleanupRequired.length, 1);
  const contextNeedsCleanup = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  assert.ok(contextNeedsCleanup.blockers.some((item: any) => item.code === 'MONITOR_AUTOMATION_CLEANUP_REQUIRED'));
  const prematureClose = await api(`/api/agent/v1/runs/${draft.id}/monitor/close`, { method: 'POST', body: JSON.stringify({ automationRef: 'automation:test-current-chat', automationState: 'active' }) });
  assert.equal(prematureClose.response.status, 409);
  const closed = await api(`/api/agent/v1/runs/${draft.id}/monitor/close`, { method: 'POST', body: JSON.stringify({ automationRef: 'automation:test-current-chat', automationState: 'deleted' }) });
  assert.equal(closed.response.status, 200);
  assert.equal((closed.payload as any).automation_ref, null);
  assert.equal((closed.payload as any).status, 'complete');
  const contextClosed = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  assert.ok(!contextClosed.blockers.some((item: any) => item.code === 'MONITOR_AUTOMATION_CLEANUP_REQUIRED'));
  assert.equal(((await api('/api/agent/v1/monitor/guard')).payload as any).ok, true);
  remoteModule.setRemoteProcessRunnerForTests(null);
});

test('an explicit pre-scheduler rejection is traceable but does not consume the scientific retry budget', async () => {
  const fixture = await createFixture('fixture-esub-reject');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-esub-reject-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  fs.mkdirSync(path.join(fixture.taskRoot, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -q snode\n#BSUB -n 4\n#BSUB -W 00:10\necho run\n');

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    const remoteCommand = args.at(-1) ?? '';
    if (command === 'ssh' && remoteCommand.includes('bsub -J')) return { code: 1, stdout: 'Submiting job\n', stderr: 'Request aborted by esub. Job not submitted.\n' };
    return { code: 0, stdout: '', stderr: '' };
  });

  const createSubmission = (key: string, retryOfActionId?: string) => api(`/api/agent/v1/runs/${draft.id}/executable-actions`, { method: 'POST', body: JSON.stringify({
    stageId: fixture.stages[1], capability: 'job.submit',
    spec: { method: 'oneshot-dft-dmft', softwareStack: 'QE+Wannier90+TRIQS', remoteWorkdir: `jobs/${key}`, localScriptPath: 'jobs/run.lsf', remoteScriptPath: 'run.lsf', submissionKey: key },
    idempotencyKey: `action-${key}`, retryOfActionId,
  }) });
  const rejectedAction = await createSubmission('rejected');
  assert.equal(rejectedAction.response.status, 201);
  const rejected = await api(`/api/agent/v1/actions/${(rejectedAction.payload as any).id}/execute`, { method: 'POST', body: '{}' });
  assert.equal(rejected.response.status, 200);
  assert.equal((rejected.payload as any).status, 'waiting_codex');
  const context = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
  const rejectedJob = context.recentJobs.find((item: any) => item.action_id === (rejectedAction.payload as any).id);
  assert.equal(rejectedJob.status, 'preparation_failed');
  assert.equal(rejectedJob.job_id, null);
  assert.ok(context.pendingItems.some((item: any) => item.kind === 'submission_rejected'));

  const retry = await createSubmission('corrected', (rejectedAction.payload as any).id);
  assert.equal(retry.response.status, 201);
  assert.equal((retry.payload as any).retry_attempt, 0);
  remoteModule.setRemoteProcessRunnerForTests(null);
});

test('pre-scheduler input verification identifies the missing bound path and omits a known login banner', async () => {
  const fixture = await createFixture('fixture-bound-input-missing');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-bound-input-missing-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  fs.mkdirSync(path.join(fixture.taskRoot, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -q snode\n#BSUB -n 4\n#BSUB -W 00:10\necho run\n');
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'input.toml'), 'value = 1\n');

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    const remoteCommand = args.at(-1) ?? '';
    if (command === 'ssh' && remoteCommand.includes('WORKBENCH_BOUND_INPUT_MISSING')) {
      return {
        code: 76,
        stdout: '',
        stderr: 'Welcome to the secure server.\nUnauthorized access is strictly prohibited\nWORKBENCH_BOUND_INPUT_MISSING path=input.toml\n',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  try {
    const action = await api(`/api/agent/v1/runs/${draft.id}/executable-actions`, { method: 'POST', body: JSON.stringify({
      stageId: fixture.stages[1], capability: 'job.submit',
      spec: {
        method: 'oneshot-dft-dmft', softwareStack: 'QE+Wannier90+TRIQS', remoteWorkdir: 'jobs',
        localScriptPath: 'jobs/run.lsf', remoteScriptPath: 'run.lsf',
        remoteInputs: [{ localPath: 'jobs/input.toml', remotePath: 'input.toml' }], submissionKey: 'missing-bound-input',
      },
      idempotencyKey: 'action-missing-bound-input',
    }) });
    assert.equal(action.response.status, 201);
    const executed = await api(`/api/agent/v1/actions/${(action.payload as any).id}/execute`, { method: 'POST', body: '{}' });
    assert.equal(executed.response.status, 502);
    assert.equal((executed.payload as any).code, 'REMOTE_COMMAND_FAILED');
    assert.match((executed.payload as any).error, /WORKBENCH_BOUND_INPUT_MISSING path=input\.toml/);
    assert.doesNotMatch((executed.payload as any).error, /Unauthorized access/);
    const context = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
    const job = context.recentJobs.find((item: any) => item.action_id === (action.payload as any).id);
    assert.equal(job.status, 'preparation_failed');
    assert.equal(job.job_id, null);
  } finally {
    remoteModule.setRemoteProcessRunnerForTests(null);
  }
});

test('concurrent observations for one remote Job cannot overwrite a newer terminal state', async () => {
  const fixture = await createFixture('fixture-remote-observation-race');
  const draft = (await api('/api/agent/v1/runs', { method: 'POST', body: JSON.stringify({ taskId: fixture.task.id, researchPlanId: fixture.plan.id, taskSpec: fixture.spec, idempotencyKey: 'fixture-remote-observation-race-run' }) })).payload as any;
  await api(`/api/agent/v1/runs/${draft.id}/confirm`, { method: 'POST', body: JSON.stringify({ summary: 'confirmed', source: 'codex_conversation' }) });
  fs.mkdirSync(path.join(fixture.taskRoot, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(fixture.taskRoot, 'jobs', 'run.lsf'), '#!/bin/sh\n#BSUB -q snode\n#BSUB -n 4\n#BSUB -W 00:10\necho run\n');

  const remoteModule = await import(pathToFileURL(path.join(ROOT, 'server', 'services', 'remote.ts')).href);
  let jobName = '';
  let raceEnabled = false;
  let observationCount = 0;
  let activeObservations = 0;
  let maxActiveObservations = 0;
  remoteModule.setRemoteProcessRunnerForTests(async (command: string, args: string[]) => {
    const remoteCommand = args.at(-1) ?? '';
    if (command === 'ssh' && remoteCommand.includes('bsub -J')) {
      jobName = remoteCommand.match(/-J\s+'([^']+)'/)?.[1] ?? '';
      return { code: 0, stdout: 'Job <880> is submitted.\n', stderr: '' };
    }
    if (command === 'ssh' && remoteCommand.includes("bjobs -a -noheader -o 'jobid stat job_name'") && !remoteCommand.includes(' -J ')) {
      if (!raceEnabled) return { code: 0, stdout: `880 RUN ${jobName}\n`, stderr: '' };
      const index = ++observationCount;
      activeObservations += 1;
      maxActiveObservations = Math.max(maxActiveObservations, activeObservations);
      await new Promise(resolve => setTimeout(resolve, index === 1 ? 50 : 5));
      activeObservations -= 1;
      return { code: 0, stdout: `880 ${index === 1 ? 'RUN' : 'DONE'} ${jobName}\n`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  try {
    const actionResult = await api(`/api/agent/v1/runs/${draft.id}/executable-actions`, { method: 'POST', body: JSON.stringify({
      stageId: fixture.stages[1], capability: 'job.submit',
      spec: { method: 'oneshot-dft-dmft', softwareStack: 'QE+Wannier90+TRIQS', remoteWorkdir: 'jobs/race', localScriptPath: 'jobs/run.lsf', remoteScriptPath: 'run.lsf', submissionKey: 'race' },
      idempotencyKey: 'action-race',
    }) });
    assert.equal(actionResult.response.status, 201);
    const executed = await api(`/api/agent/v1/actions/${(actionResult.payload as any).id}/execute`, { method: 'POST', body: '{}' });
    assert.equal(executed.response.status, 200);
    const context = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
    const job = context.recentJobs.find((item: any) => item.action_id === (actionResult.payload as any).id);
    assert.equal(job.status, 'run');

    raceEnabled = true;
    await Promise.all([
      api(`/api/agent/v1/remote/jobs/${job.id}/status`, { method: 'POST', body: '{}' }),
      api(`/api/agent/v1/remote/jobs/${job.id}/reconcile`, { method: 'POST', body: '{}' }),
    ]);

    const dbModule = await import(pathToFileURL(path.join(ROOT, 'server', 'db.ts')).href);
    dbModule.default.prepare('UPDATE remote_jobs SET next_check_at = ?, terminal_at = NULL WHERE id = ?')
      .run('2099-01-01T00:00:00.000Z', job.id);
    const observationsBeforeTerminalRead = observationCount;
    const normalizedTerminal = await api(`/api/agent/v1/remote/jobs/${job.id}/status`, { method: 'POST', body: '{}' });
    assert.equal(normalizedTerminal.response.status, 200);
    assert.equal((normalizedTerminal.payload as any).status, 'done');
    assert.equal((normalizedTerminal.payload as any).next_check_at, null);
    assert.ok((normalizedTerminal.payload as any).terminal_at);
    assert.equal(observationCount, observationsBeforeTerminalRead, 'terminal status reads must not query the scheduler again');

    const finalContext = (await api(`/api/agent/v1/context/tasks/${fixture.task.id}`)).payload as any;
    const finalJob = finalContext.recentJobs.find((item: any) => item.id === job.id);
    assert.equal(maxActiveObservations, 1, 'the same Job must have only one scheduler observation in flight');
    assert.equal(finalJob.status, 'done', 'a stale RUN observation must never overwrite DONE');
  } finally {
    remoteModule.setRemoteProcessRunnerForTests(null);
  }
});

test('execution product surface contains no material-specific route', () => {
  const surface = ['server/services/actionExecutor.ts', 'server/services/remote.ts', 'server/routes/agent.ts', 'bin/workbench.js']
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(surface, /cacro3|v2o3|submit-scf|10_scf/i);
});
