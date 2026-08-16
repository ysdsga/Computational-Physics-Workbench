import { Router } from 'express';
import db from '../db.js';
import {
  activatePolicy,
  adoptCurrentPolicy,
  AgentCoreError,
  appendEvent,
  buildAgentContext,
  createPolicy,
  createReview,
  decideReview,
  listEvents,
  listReviews,
  reviseRun,
  startRun,
  terminateRun,
} from '../services/agentCore.js';
import {
  authorizeAction,
  createAction,
  getAction,
  listActions,
  listArtifacts,
  listEvidenceChecks,
  registerArtifact,
  registerEvidenceCheck,
  transitionAction,
  listEvidenceLibrary,
} from '../services/agentActions.js';
import { describeExecutionContract, executeAction, proposeExecutableAction } from '../services/actionExecutor.js';
import { promoteConclusionToExperience, recordResearcherConclusion } from '../services/experiencePromotion.js';

const router = Router();

router.get('/context/tasks/:taskId', (req, res) => res.json(buildAgentContext(req.params.taskId)));
router.get('/execution-contract', (_req, res) => res.json(describeExecutionContract()));

router.get('/runs/:runId', (req, res) => {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found', code: 'RUN_NOT_FOUND' });
  res.json(run);
});

router.post('/runs', (req, res) => {
  const { taskId, researchPlanId, idempotencyKey } = req.body ?? {};
  if (!taskId || !researchPlanId) return res.status(400).json({ error: 'taskId and researchPlanId are required', code: 'INPUT_REQUIRED' });
  res.status(201).json(startRun(taskId, researchPlanId, idempotencyKey));
});

router.post('/runs/:runId/revise', (req, res) => {
  const result = reviseRun(req.params.runId, req.body ?? {});
  res.status(result.status === 'review_required' ? 202 : 200).json(result);
});

router.post('/runs/:runId/terminate', (req, res) => res.json(terminateRun(req.params.runId, String(req.body?.reason ?? ''))));
router.post('/runs/:runId/adopt-policy', (req, res) => res.json(adoptCurrentPolicy(req.params.runId, String(req.body?.reason ?? 'researcher adopted active policy'))));

router.get('/runs/:runId/events', (req, res) => {
  res.json(listEvents(req.params.runId, Number(req.query.after ?? 0), Number(req.query.limit ?? 100)));
});

router.post('/runs/:runId/events', (req, res) => {
  const { category, eventType, actorType, payload, idempotencyKey, contextVersionId, source, conversationRef } = req.body ?? {};
  if (!category || !eventType || !actorType) return res.status(400).json({ error: 'category, eventType and actorType are required', code: 'INPUT_REQUIRED' });
  if (category === 'conclusion') return res.status(400).json({ error: 'Use the evidence-bound conclusion endpoint', code: 'CONCLUSION_ENDPOINT_REQUIRED' });
  res.status(201).json(appendEvent(req.params.runId, { category, eventType, actorType, payload, idempotencyKey, contextVersionId, source, conversationRef }));
});

router.post('/runs/:runId/conclusions', (req, res) => {
  res.status(201).json(recordResearcherConclusion(req.params.runId, req.body ?? {}));
});

router.post('/runs/:runId/experience-promotions', (req, res) => {
  res.status(201).json(promoteConclusionToExperience(req.params.runId, req.body ?? {}));
});

router.get('/runs/:runId/actions', (req, res) => {
  res.json(listActions(req.params.runId, Number(req.query.limit ?? 100)));
});

router.post('/runs/:runId/actions', (req, res) => {
  const { contextVersionId, stepId, actionType, manifest, idempotencyKey, conversationRef } = req.body ?? {};
  res.status(201).json(createAction(req.params.runId, { contextVersionId, stepId, actionType, manifest, idempotencyKey, conversationRef }));
});

router.post('/runs/:runId/executable-actions', (req, res) => {
  const { contextVersionId, stepId, capability, spec, idempotencyKey, conversationRef } = req.body ?? {};
  res.status(201).json(proposeExecutableAction(req.params.runId, {
    contextVersionId, stepId, capability, spec, idempotencyKey, conversationRef,
  }));
});

router.get('/actions/:actionId', (req, res) => res.json(getAction(req.params.actionId)));

router.post('/actions/:actionId/authorize', (req, res) => {
  const { expectedContextVersionId, expectedManifestSha256, authorizationSummary, source, conversationRef } = req.body ?? {};
  res.json(authorizeAction(req.params.actionId, { expectedContextVersionId, expectedManifestSha256, authorizationSummary, source, conversationRef }));
});

router.post('/actions/:actionId/status', (req, res) => {
  const { status, result, error } = req.body ?? {};
  res.json(transitionAction(req.params.actionId, { status, result, error }));
});

router.get('/runs/:runId/artifacts', (req, res) => {
  res.json(listArtifacts(req.params.runId, Number(req.query.limit ?? 100)));
});

router.post('/actions/:actionId/artifacts', (req, res) => {
  const { location, path, category, idempotencyKey, remoteJobId, sizeBytes, sha256, metadata } = req.body ?? {};
  res.status(201).json(registerArtifact(req.params.actionId, { location, path, category, idempotencyKey, remoteJobId, sizeBytes, sha256, metadata }));
});

router.get('/runs/:runId/evidence-checks', (req, res) => {
  res.json(listEvidenceChecks(req.params.runId, Number(req.query.limit ?? 100)));
});

router.post('/actions/:actionId/evidence-checks', (req, res) => {
  const { artifactId, validatorName, validatorVersion, status, result, idempotencyKey } = req.body ?? {};
  res.status(201).json(registerEvidenceCheck(req.params.actionId, { artifactId, validatorName, validatorVersion, status, result, idempotencyKey }));
});

router.post('/actions/:actionId/execute', async (req, res) => res.json(await executeAction(req.params.actionId)));

router.get('/policies', (req, res) => {
  const conditions: string[] = []; const params: string[] = [];
  if (req.query.scopeType) { conditions.push('scope_type = ?'); params.push(String(req.query.scopeType)); }
  if (req.query.scopeId) { conditions.push('scope_id = ?'); params.push(String(req.query.scopeId)); }
  const sql = `SELECT * FROM agent_policies${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...params) as any[];
  res.json(rows.map(({ policy_json, ...row }) => ({ ...row, policy: JSON.parse(policy_json) })));
});

router.post('/policies', (req, res) => {
  const { scopeType, scopeId, policy, activate } = req.body ?? {};
  if (!['system', 'project', 'task'].includes(scopeType)) return res.status(400).json({ error: 'Invalid scopeType', code: 'POLICY_SCOPE_INVALID' });
  res.status(201).json(createPolicy(scopeType, scopeId ?? null, policy, activate === true));
});

router.post('/policies/:policyId/activate', (req, res) => res.json(activatePolicy(req.params.policyId)));

router.get('/reviews', (req, res) => res.json(listReviews({
  runId: req.query.runId ? String(req.query.runId) : undefined,
  projectId: req.query.projectId ? String(req.query.projectId) : undefined,
  taskId: req.query.taskId ? String(req.query.taskId) : undefined,
  status: req.query.status ? String(req.query.status) : undefined,
})));

router.get('/evidence-library', (req, res) => res.json(listEvidenceLibrary({
  projectId: req.query.projectId ? String(req.query.projectId) : undefined,
  taskId: req.query.taskId ? String(req.query.taskId) : undefined,
  location: req.query.location ? String(req.query.location) : undefined,
  checkStatus: req.query.checkStatus ? String(req.query.checkStatus) : undefined,
  search: req.query.search ? String(req.query.search) : undefined,
})));

router.post('/runs/:runId/reviews', (req, res) => {
  const { gateType, question, options, recommendation, evidence, proposal, idempotencyKey, source, conversationRef } = req.body ?? {};
  if (!gateType || !question) return res.status(400).json({ error: 'gateType and question are required', code: 'INPUT_REQUIRED' });
  res.status(201).json(createReview(req.params.runId, { gateType, question, options, recommendation, evidence, proposal, idempotencyKey, source, conversationRef }));
});

router.post('/reviews/:requestId/decisions', (req, res) => {
  const { decision, comment, source, conversationRef } = req.body ?? {};
  if (!['approve', 'reject', 'supplement', 'terminate'].includes(decision)) return res.status(400).json({ error: 'Invalid decision', code: 'DECISION_INVALID' });
  res.status(201).json(decideReview(req.params.requestId, decision, String(comment ?? ''), { source, conversationRef }));
});

export function agentErrorHandler(error: unknown, _req: unknown, res: any, next: (error?: unknown) => void) {
  if (error instanceof AgentCoreError) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
  next(error);
}

export default router;
