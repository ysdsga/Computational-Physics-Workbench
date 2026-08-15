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

const router = Router();

router.get('/context/tasks/:taskId', (req, res) => res.json(buildAgentContext(req.params.taskId)));

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
  const { category, eventType, actorType, payload, idempotencyKey, contextVersionId } = req.body ?? {};
  if (!category || !eventType || !actorType) return res.status(400).json({ error: 'category, eventType and actorType are required', code: 'INPUT_REQUIRED' });
  res.status(201).json(appendEvent(req.params.runId, { category, eventType, actorType, payload, idempotencyKey, contextVersionId }));
});

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

router.get('/reviews', (req, res) => res.json(listReviews(req.query.runId ? String(req.query.runId) : undefined)));

router.post('/runs/:runId/reviews', (req, res) => {
  const { gateType, question, options, recommendation, evidence, proposal, idempotencyKey } = req.body ?? {};
  if (!gateType || !question) return res.status(400).json({ error: 'gateType and question are required', code: 'INPUT_REQUIRED' });
  res.status(201).json(createReview(req.params.runId, { gateType, question, options, recommendation, evidence, proposal, idempotencyKey }));
});

router.post('/reviews/:requestId/decisions', (req, res) => {
  const { decision, comment } = req.body ?? {};
  if (!['approve', 'reject', 'supplement', 'terminate'].includes(decision)) return res.status(400).json({ error: 'Invalid decision', code: 'DECISION_INVALID' });
  res.status(201).json(decideReview(req.params.requestId, decision, String(comment ?? '')));
});

export function agentErrorHandler(error: unknown, _req: unknown, res: any, next: (error?: unknown) => void) {
  if (error instanceof AgentCoreError) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
  next(error);
}

export default router;
