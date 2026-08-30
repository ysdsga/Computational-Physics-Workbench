import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-theory-goal-'));
process.env.WORKBENCH_DB_PATH = path.join(temp, 'test.db');
process.env.WORKBENCH_PORT = '0';
let server: Server;
let base: string;
async function api(url: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() as any };
}
before(async () => {
  server = (await import(pathToFileURL(path.join(ROOT, 'server/index.ts')).href)).server;
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  (await import(pathToFileURL(path.join(ROOT, 'server/db.ts')).href)).closeDb();
  fs.rmSync(temp, { recursive: true, force: true });
});

const goal = { question: 'Which interaction generates the new response?', successCriteria: ['Derive the response from the interaction', 'Distinguish the nearest competing explanation'], insufficientOutcomes: ['Assume the response or only diagnose its existence'], acceptedAnswerTypes: ['explanation', 'prediction', 'no_go'] };
const search = { directions: [{ axis: 'failure_driven', question: 'Which assumption suppressed the response?', rationale: 'Use the failure to choose a different controlled limit' }], learned: 'The scalar approximation removes the channel distinction', nextQuestions: ['Does an orbital-resolved limit retain it?'] };
async function fixture(name: string) {
  const work = path.join(temp, name); fs.mkdirSync(work);
  const project = (await api('/api/projects', { name, working_dir: work })).data;
  const task = (await api(`/api/projects/${project.id}/tasks`, { name, workflow_id: 'theoretical-research' })).data;
  const plan = (await api('/api/research-plans', { title: name, project_id: project.id, linked_task_ids: [task.id] })).data;
  const spec = { schemaVersion: 1, objective: 'Explore one candidate without redefining the original goal', confirmedEnvelope: {
    schemaVersion: 1, coreStageIds: task.workflow.stages.map((item: any) => item.id), scientificGoal: goal,
    allowedCapabilities: ['local.process'], resourceLimits: { maxCoresPerJob: 1, maxWallMinutes: 10, maxConcurrentJobs: 1, maxAutomaticRetries: 0 }, protectedRelativePaths: [], completionEvidence: ['A derived mechanism'],
  }, workingPlan: { currentStageId: 'question', summary: 'Recover the scientific question and prior failures' } };
  const taskRoot = path.join(work, task.task_root_rel);
  fs.writeFileSync(path.join(taskRoot, 'argument.md'), 'A fixture derivation and a discriminating negative control.');
  return { task, plan, spec, taskRoot, draft: (input = spec, key = name) => api('/api/agent/v1/runs', { taskId: task.id, researchPlanId: plan.id, taskSpec: input, idempotencyKey: key }) };
}

test('route generation, conditional results, failed-route memory and original-goal completion form an outer loop', async () => {
  const f = await fixture('outer-loop');
  const missing = structuredClone(f.spec); delete (missing.confirmedEnvelope as any).scientificGoal;
  assert.equal((await f.draft(missing, 'missing')).data.code, 'SCIENTIFIC_GOAL_REQUIRED');
  const drafted = await f.draft(); assert.equal(drafted.status, 201);
  const run = drafted.data;
  assert.match(run.scientific_goal_sha256, /^[a-f0-9]{64}$/);
  assert.equal((await api(`/api/agent/v1/runs/${run.id}/confirm`, { summary: 'Researcher confirmed the exact goal and boundary', source: 'codex_conversation' })).status, 200);
  let sequence = 0;
  const reflection = (stageId: string, data: any = {}, key?: string) => api(`/api/agent/v1/runs/${run.id}/stage-reflections`, {
    stageId, summary: 'Learn from the physical result', established: [], uncertainties: [], ideas: [], decision: 'proceed', nextActions: stageId === 'release' ? [] : [{ objective: 'Continue the physical investigation' }], ...data, idempotencyKey: key ?? `r-${++sequence}`,
  });
  const assessment = (status = 'answered', answerType = 'explanation') => ({ goalSha256: run.scientific_goal_sha256, status, answer: 'The controlled channel mechanism answers the original question', answerType, criteria: goal.successCriteria.map(criterion => ({ criterion, satisfied: status === 'answered', explanation: 'Derived rather than assumed', evidenceRefs: ['argument.md'] })), remainingGaps: status === 'answered' ? [] : ['The dynamical source is still assumed'] });
  const route = { id: 'scalar-route', idea: 'Can a scalar approximation generate the response?', significance: 'Separates a candidate mechanism', disposition: 'explore', reason: 'Test the simplest limit', evidenceRefs: [] };
  assert.equal((await reflection('question')).status, 201);
  assert.equal((await reflection('context')).data.code, 'RESEARCH_ROUTE_SEARCH_REQUIRED');
  assert.equal((await reflection('context', { routeSearch: search })).data.code, 'RESEARCH_ROUTE_REQUIRED');
  assert.equal((await reflection('context', { routeSearch: search, decision: 'stay', uncertainties: ['No candidate survives yet'] })).status, 201, 'no idea initiates further route search');
  assert.equal((await reflection('context', { routeSearch: search, ideas: [route] })).status, 201);
  for (const stage of ['model', 'baseline', 'derivation', 'validation']) assert.equal((await reflection(stage)).status, 201);
  const failed = { ...route, disposition: 'falsified', reason: 'A scalar self energy removes the relevant channel', learning: 'Excludes only the scalar route, not orbital-resolved mechanisms', nextQuestion: 'Which orbital distinction survives?', evidenceRefs: ['argument.md'] };
  assert.equal((await reflection('interpretation', { ideas: [{ ...failed, learning: undefined }] })).data.code, 'RESEARCH_ROUTE_LEARNING_REQUIRED');
  assert.equal((await reflection('interpretation', { ideas: [{ ...failed, evidenceRefs: ['evidence-invented'] }] })).data.code, 'RESEARCH_EVIDENCE_INVALID');
  assert.equal((await reflection('interpretation', { ideas: [failed] })).data.code, 'SCIENTIFIC_GOAL_ASSESSMENT_REQUIRED');
  assert.equal((await reflection('interpretation', { ideas: [failed], goalAssessment: assessment('partial', 'conditional') })).data.code, 'SCIENTIFIC_GOAL_NOT_ANSWERED');
  assert.equal((await reflection('interpretation', { ideas: [failed], goalAssessment: assessment('answered', 'diagnostic') })).data.code, 'SCIENTIFIC_ANSWER_TYPE_INSUFFICIENT');
  const wrongGoal = assessment(); wrongGoal.goalSha256 = '0'.repeat(64);
  assert.equal((await reflection('interpretation', { ideas: [failed], goalAssessment: wrongGoal })).data.code, 'SCIENTIFIC_GOAL_MISMATCH');
  const droppedCriterion = assessment(); droppedCriterion.criteria.pop();
  assert.equal((await reflection('interpretation', { ideas: [failed], goalAssessment: droppedCriterion })).data.code, 'SCIENTIFIC_GOAL_CRITERIA_MISMATCH');
  assert.equal((await reflection('interpretation', { ideas: [failed], goalAssessment: assessment('partial', 'conditional'), decision: 'loop', targetStageId: 'context' })).status, 201);
  let context = (await api(`/api/agent/v1/context/tasks/${f.task.id}`)).data;
  assert.equal(context.run.working_plan.explorationReview.status, 'continue');
  assert.equal(context.researchMap.routes[0].disposition, 'falsified');
  assert.match(context.researchMap.routes[0].learning, /only the scalar/);
  assert.equal((await api(`/api/agent/v1/runs/${run.id}/working-plan`, { workingPlan: { ...context.run.working_plan, currentStageId: null, goalAssessment: assessment(), explorationReview: { status: 'passed', summary: 'cleared', unresolvedHighValueItems: [] } }, reason: 'forged shortcut', idempotencyKey: 'shortcut' }, 'PUT')).data.code, 'GOAL_ASSESSMENT_REFLECTION_REQUIRED');
  const child = { ...route, id: 'orbital-route', parentIdeaIds: ['scalar-route'], idea: 'Does the orbital-resolved limit generate it?' };
  assert.equal((await reflection('context', { routeSearch: search, ideas: [{ ...child, id: route.id }] })).data.code, 'RESEARCH_ROUTE_REDEFINED');
  assert.equal((await reflection('context', { routeSearch: search, ideas: [{ ...child, parentIdeaIds: ['missing'] }] })).data.code, 'RESEARCH_ROUTE_PARENT_INVALID');
  assert.equal((await reflection('context', { routeSearch: search, ideas: [child] })).status, 201);
  for (const stage of ['model', 'baseline', 'derivation', 'validation']) assert.equal((await reflection(stage)).status, 201);
  const resolved = { ...child, disposition: 'resolved', learning: 'The orbital distinction survives and generates a response absent in the scalar limit', evidenceRefs: ['argument.md'] };
  assert.equal((await reflection('interpretation', { ideas: [resolved], goalAssessment: assessment() })).status, 201);
  assert.equal((await reflection('release')).data.code, 'SCIENTIFIC_GOAL_ASSESSMENT_REQUIRED');
  assert.equal((await reflection('release', { goalAssessment: assessment() })).status, 201);
  fs.renameSync(path.join(f.taskRoot, 'argument.md'), path.join(f.taskRoot, 'argument.saved.md'));
  assert.equal((await api(`/api/agent/v1/runs/${run.id}/complete`, { summary: 'complete', source: 'codex_conversation' })).data.code, 'RESEARCH_EVIDENCE_INVALID');
  fs.renameSync(path.join(f.taskRoot, 'argument.saved.md'), path.join(f.taskRoot, 'argument.md'));
  assert.equal((await api(`/api/agent/v1/runs/${run.id}/complete`, { summary: 'answered the original question', source: 'codex_conversation' })).status, 200);
  const changed = structuredClone(f.spec); changed.confirmedEnvelope.scientificGoal.question = 'Only write a diagnostic';
  assert.equal((await f.draft(changed, 'silently-narrowed')).status, 409);
  const next = await f.draft(f.spec, 'same-goal-next-run'); assert.equal(next.status, 201);
  context = (await api(`/api/agent/v1/context/tasks/${f.task.id}`)).data;
  assert.equal(context.researchMap.routes.length, 2, 'closed and failed routes survive a new Run');
  assert.equal(context.researchMap.routes.find((item: any) => item.id === child.id).parentIdeaIds[0], route.id);
  assert.equal(context.researchMap.searches.length, 3);
  const history = (await api(`/api/agent/v1/runs/${run.id}/events`)).data;
  assert.ok(history.filter((event: any) => event.event_type === 'stage.reflection').flatMap((event: any) => event.payload.ideas).some((idea: any) => idea.disposition === 'explore'));
  assert.equal((await api(`/api/agent/v1/tasks/${f.task.id}/research-map`)).data.goalSha256, run.scientific_goal_sha256);
  const cli = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'bin/workbench.js'), 'research-map', 'show', '--task', f.task.id], { env: { ...process.env, WORKBENCH_URL: base }, windowsHide: true });
    let output = ''; proc.stdout.on('data', chunk => { output += chunk; }); proc.on('error', reject); proc.on('close', code => resolve({ code, output }));
  });
  assert.equal(cli.code, 0); assert.equal(JSON.parse(cli.output).routes.length, 2);
});

test('explicit goal revision is visible, conditional-theorem goals remain legitimate, and invalid Runs are excluded', async () => {
  const f = await fixture('goal-revision');
  const first = (await f.draft()).data;
  await api(`/api/agent/v1/runs/${first.id}/confirm`, { summary: 'confirmed', source: 'codex_conversation' });
  await api(`/api/agent/v1/runs/${first.id}/terminate`, { reason: 'Fixture ends a partial exploration without claiming success' });
  const revised = structuredClone(f.spec);
  revised.confirmedEnvelope.scientificGoal = { ...goal, question: 'Establish a conditional theorem', acceptedAnswerTypes: ['conditional'] };
  (revised.confirmedEnvelope as any).scientificGoalChange = { previousGoalSha256: first.scientific_goal_sha256, reason: 'Researcher explicitly chose a theorem goal instead of a mechanism claim' };
  const next = await f.draft(revised, 'explicit-revision'); assert.equal(next.status, 201);
  assert.match(next.data.confirmed_envelope.scientificGoalChange.reason, /explicitly/);
  await api(`/api/agent/v1/runs/${next.data.id}/confirm`, { summary: 'Researcher explicitly confirmed changed goal', source: 'codex_conversation' });
  const theory = await import(pathToFileURL(path.join(ROOT, 'server/services/theoryResearch.ts')).href);
  assert.equal(theory.validateGoalAssessment({ goalSha256: next.data.scientific_goal_sha256, status: 'answered', answer: 'A conditional theorem under the agreed assumptions', answerType: 'conditional', criteria: goal.successCriteria.map(criterion => ({ criterion, satisfied: true, explanation: 'A theorem proof', evidenceRefs: ['argument.md'] })), remainingGaps: [] }, revised.confirmedEnvelope.scientificGoal).status, 'answered');
  assert.throws(() => theory.validateGoalAssessment({ goalSha256: next.data.scientific_goal_sha256, status: 'answered', answer: 'gap remains', answerType: 'conditional', criteria: goal.successCriteria.map(criterion => ({ criterion, satisfied: true, explanation: 'test', evidenceRefs: ['argument.md'] })), remainingGaps: ['unproved antecedent'] }, revised.confirmedEnvelope.scientificGoal), /remaining causal gaps/);
  await api(`/api/agent/v1/runs/${next.data.id}/events`, { category: 'decision', eventType: 'run.archived_invalid', actorType: 'researcher', payload: { reason: 'invalid fixture' }, source: 'codex_conversation' });
  assert.equal((await api(`/api/agent/v1/tasks/${f.task.id}/research-map`)).data.goalSha256, first.scientific_goal_sha256);
});
