import { Router } from 'express';
import {
  AgentCoreError,
  appendEvent,
  buildAgentContext,
  completeRun,
  confirmRun,
  createPendingItem,
  createRunDraft,
  getRun,
  listEvents,
  listPendingItems,
  resolvePendingItem,
  reviseEnvelope,
  terminateRun,
  updateWorkingPlan,
} from '../services/agentCore.js';
import {
  createAction,
  getAction,
  listActions,
  listArtifacts,
  listEvidenceChecks,
  listEvidenceLibrary,
  registerArtifact,
  registerEvidenceCheck,
  transitionAction,
  updateArtifactValidity,
} from '../services/agentActions.js';
import { describeExecutionContract, executeAction, proposeExecutableAction } from '../services/actionExecutor.js';
import { tickRunMonitor } from '../services/jobMonitor.js';
import { attachRunMonitor, getRunMonitor, monitorGuard, pauseRunMonitor } from '../services/monitorStore.js';

const router = Router();

router.get('/context/tasks/:taskId', (req, res) => res.json(buildAgentContext(req.params.taskId)));
router.get('/execution-contract', (_req, res) => res.json(describeExecutionContract()));
router.get('/monitor/guard', (_req, res) => res.json(monitorGuard()));
router.get('/runs/:runId', (req, res) => res.json(getRun(req.params.runId)));
router.get('/runs/:runId/monitor', (req, res) => res.json(getRunMonitor(req.params.runId)));
router.post('/runs/:runId/monitor/attach', (req, res) => res.json(attachRunMonitor(req.params.runId, req.body?.automationRef, req.body?.cadenceMinutes)));
router.post('/runs/:runId/monitor/pause', (req, res) => res.json(pauseRunMonitor(req.params.runId)));
router.post('/runs/:runId/monitor/tick', async (req, res) => res.json(await tickRunMonitor(req.params.runId)));

router.post('/runs', (req, res) => {
  const { taskId, researchPlanId, taskSpec, idempotencyKey } = req.body ?? {};
  if (!taskId || !researchPlanId || !taskSpec || !idempotencyKey) {
    return res.status(400).json({ error: 'taskId, researchPlanId, taskSpec and idempotencyKey are required', code: 'INPUT_REQUIRED' });
  }
  res.status(201).json(createRunDraft(String(taskId), String(researchPlanId), taskSpec, String(idempotencyKey)));
});

router.post('/runs/:runId/confirm', (req, res) => res.json(confirmRun(req.params.runId, req.body ?? {})));
router.put('/runs/:runId/working-plan', (req, res) => res.json(updateWorkingPlan(req.params.runId, req.body ?? {})));
router.post('/runs/:runId/envelope-revisions', (req, res) => res.json(reviseEnvelope(req.params.runId, req.body ?? {})));
router.post('/runs/:runId/terminate', (req, res) => res.json(terminateRun(req.params.runId, String(req.body?.reason ?? ''))));
router.post('/runs/:runId/complete', (req, res) => res.json(completeRun(
  req.params.runId,
  String(req.body?.summary ?? ''),
  String(req.body?.source ?? ''),
  req.body?.conversationRef ? String(req.body.conversationRef) : null,
)));

router.get('/runs/:runId/events', (req, res) => {
  res.json(listEvents(req.params.runId, Number(req.query.after ?? 0), Number(req.query.limit ?? 100)));
});
router.post('/runs/:runId/events', (req, res) => {
  const { category, eventType, actorType, payload, idempotencyKey, source, conversationRef } = req.body ?? {};
  if (!category || !eventType || !actorType) return res.status(400).json({ error: 'category, eventType and actorType are required', code: 'INPUT_REQUIRED' });
  res.status(201).json(appendEvent(req.params.runId, { category, eventType, actorType, payload, idempotencyKey, source, conversationRef }));
});

router.get('/pending-items', (req, res) => res.json(listPendingItems({
  runId: req.query.runId ? String(req.query.runId) : undefined,
  projectId: req.query.projectId ? String(req.query.projectId) : undefined,
  taskId: req.query.taskId ? String(req.query.taskId) : undefined,
  audience: req.query.audience ? String(req.query.audience) : undefined,
  status: req.query.status ? String(req.query.status) : undefined,
})));
router.get('/runs/:runId/pending-items', (req, res) => res.json(listPendingItems({ runId: req.params.runId })));
router.post('/runs/:runId/pending-items', (req, res) => res.status(201).json(createPendingItem(req.params.runId, req.body ?? {})));
router.post('/pending-items/:itemId/resolve', (req, res) => res.json(resolvePendingItem(req.params.itemId, req.body ?? {})));

router.get('/runs/:runId/actions', (req, res) => res.json(listActions(req.params.runId, Number(req.query.limit ?? 100))));
router.post('/runs/:runId/actions', (req, res) => res.status(201).json(createAction(req.params.runId, req.body ?? {})));
router.post('/runs/:runId/executable-actions', (req, res) => res.status(201).json(proposeExecutableAction(req.params.runId, req.body ?? {})));
router.get('/actions/:actionId', (req, res) => res.json(getAction(req.params.actionId)));
router.post('/actions/:actionId/status', (req, res) => res.json(transitionAction(req.params.actionId, req.body ?? {})));
router.post('/actions/:actionId/execute', async (req, res) => res.json(await executeAction(req.params.actionId)));

router.get('/runs/:runId/artifacts', (req, res) => res.json(listArtifacts(req.params.runId, Number(req.query.limit ?? 100))));
router.post('/actions/:actionId/artifacts', (req, res) => res.status(201).json(registerArtifact(req.params.actionId, req.body ?? {})));
router.post('/artifacts/:artifactId/validity', (req, res) => res.json(updateArtifactValidity(req.params.artifactId, req.body ?? {})));
router.get('/runs/:runId/evidence-checks', (req, res) => res.json(listEvidenceChecks(req.params.runId, Number(req.query.limit ?? 100))));
router.post('/actions/:actionId/evidence-checks', (req, res) => res.status(201).json(registerEvidenceCheck(req.params.actionId, req.body ?? {})));
router.get('/evidence-library', (req, res) => res.json(listEvidenceLibrary({
  projectId: req.query.projectId ? String(req.query.projectId) : undefined,
  taskId: req.query.taskId ? String(req.query.taskId) : undefined,
  location: req.query.location ? String(req.query.location) : undefined,
  checkStatus: req.query.checkStatus ? String(req.query.checkStatus) : undefined,
  validity: req.query.validity ? String(req.query.validity) : undefined,
  search: req.query.search ? String(req.query.search) : undefined,
})));

export function agentErrorHandler(error: unknown, _req: unknown, res: any, next: (error?: unknown) => void) {
  if (error instanceof AgentCoreError) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
  next(error);
}

export default router;
