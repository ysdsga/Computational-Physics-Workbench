import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import type {
  AgentContext,
  ConfirmedEnvelope,
  ExecutableCapability,
  PendingItem,
  ResearchRun,
  RunEvent,
  Task,
  TaskSpec,
  WorkingPlan,
  WorkflowTemplate,
} from '../../src/types/index.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';
import { AgentCoreError } from './agentError.js';
import {
  heartbeatLeaseForMonitor,
  normalizeJobMonitorPolicy,
  recommendedCadenceForStatus,
  TERMINAL_JOB_STATUSES,
} from './monitorPolicy.js';

export { AgentCoreError } from './agentError.js';

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashJson(value: unknown): string {
  return sha256(stableJson(value));
}

export function normalizeRemoteRoot(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/') || normalized.includes('\r') || normalized.includes('\n') || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new AgentCoreError(400, 'REMOTE_ROOT_INVALID', 'Remote root must be an absolute POSIX path without traversal');
  }
  return normalized;
}

export const RUNTIME_CAPABILITIES = [
  'local.process',
  'remote.inspect',
  'remote.task-root.create',
  'files.upload',
  'files.download',
  'job.submit',
  'job.cancel',
] as const satisfies readonly ExecutableCapability[];

const REMOTE_CAPABILITIES = new Set<ExecutableCapability>(RUNTIME_CAPABILITIES.filter(item => item !== 'local.process'));

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', `${label} is required`);
  }
  return value.trim();
}

function orderedStringList(value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', `${label} must be an array of strings`);
  }
  const result = [...new Set(value.map(item => item.trim()).filter(Boolean))];
  if (!allowEmpty && result.length === 0) throw new AgentCoreError(400, 'TASK_SPEC_INVALID', `${label} must not be empty`);
  return result;
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', `${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return parsed;
}

function protectedPathList(value: unknown): string[] {
  const items = orderedStringList(value ?? [], 'confirmedEnvelope.protectedRelativePaths');
  return items.map(item => {
    const normalized = item.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized.startsWith('/') || path.win32.isAbsolute(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'protectedRelativePaths must stay inside the Task root');
    }
    return normalized;
  });
}

interface RuntimeTaskRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  workflow_id: string;
  workflow_snapshot: string | null;
  task_root_rel: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  project_name: string;
  project_description: string;
  material: string;
  working_dir: string;
  hpc_config: string | null;
  project_status: string;
  project_created_at: string;
  project_updated_at: string;
}

export function runtimeTask(taskId: string): RuntimeTaskRow & { workflow: WorkflowTemplate } {
  const row = db.prepare(`
    SELECT tasks.*, projects.name project_name, projects.description project_description,
           projects.material, projects.working_dir, projects.hpc_config,
           projects.status project_status, projects.created_at project_created_at,
           projects.updated_at project_updated_at
    FROM tasks JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.id = ?
  `).get(taskId) as RuntimeTaskRow | undefined;
  if (!row) throw new AgentCoreError(404, 'TASK_NOT_FOUND', 'Task not found');
  let workflow: WorkflowTemplate;
  try { workflow = JSON.parse(row.workflow_snapshot ?? '') as WorkflowTemplate; }
  catch { throw new AgentCoreError(409, 'WORKFLOW_SNAPSHOT_INVALID', 'Task workflow snapshot is missing or invalid'); }
  if (!Array.isArray(workflow.stages) || !Array.isArray(workflow.steps)) {
    throw new AgentCoreError(409, 'WORKFLOW_SNAPSHOT_INVALID', 'Task workflow snapshot is missing stages or steps');
  }
  return { ...row, workflow };
}

function assertPlanForTask(task: RuntimeTaskRow, researchPlanId: string) {
  const plan = db.prepare('SELECT * FROM research_plans WHERE id = ?').get(researchPlanId) as any;
  if (!plan) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  if (plan.project_id !== task.project_id) {
    throw new AgentCoreError(409, 'RESEARCH_PLAN_PROJECT_MISMATCH', 'Research plan and Task must belong to the same project');
  }
  return plan;
}

function assertHpcBinding(task: RuntimeTaskRow, profileId: string): void {
  let config: any;
  try { config = JSON.parse(task.hpc_config ?? '{}'); }
  catch { throw new AgentCoreError(409, 'HPC_CONFIG_INVALID', 'Project HPC metadata is invalid JSON'); }
  const profile = Array.isArray(config.profiles) ? config.profiles.find((item: any) => item?.id === profileId) : null;
  if (!profile) throw new AgentCoreError(409, 'HPC_PROFILE_NOT_REGISTERED', 'Task Spec references an unknown HPC profile');
  const binding = Array.isArray(config.taskBindings)
    ? config.taskBindings.find((item: any) => item?.taskId === task.id && item?.profileId === profileId)
    : null;
  if (!binding) throw new AgentCoreError(409, 'REMOTE_TASK_BINDING_REQUIRED', 'Task Spec remote capabilities require a registered Task directory binding');
}

export function validateEnvelope(input: unknown, task: ReturnType<typeof runtimeTask>): ConfirmedEnvelope {
  const value = objectValue(input, 'confirmedEnvelope');
  if (value.schemaVersion !== 1) throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'confirmedEnvelope.schemaVersion must be 1');
  const coreStageIds = orderedStringList(value.coreStageIds, 'confirmedEnvelope.coreStageIds', false);
  const workflowStageIds = new Set(task.workflow.stages.map(stage => stage.id));
  const unknownStages = coreStageIds.filter(stageId => !workflowStageIds.has(stageId));
  if (unknownStages.length) throw new AgentCoreError(409, 'TASK_SPEC_STAGE_UNKNOWN', 'Task Spec contains stages outside the Task workflow', { unknownStages });
  const allowedCapabilities = orderedStringList(value.allowedCapabilities, 'confirmedEnvelope.allowedCapabilities', false) as ExecutableCapability[];
  const invalidCapabilities = allowedCapabilities.filter(item => !RUNTIME_CAPABILITIES.includes(item));
  if (invalidCapabilities.length) throw new AgentCoreError(400, 'TASK_SPEC_CAPABILITY_INVALID', 'Task Spec contains unsupported capabilities', { invalidCapabilities });
  const hpcProfileId = value.hpcProfileId === null || value.hpcProfileId === undefined || value.hpcProfileId === ''
    ? null
    : requiredText(value.hpcProfileId, 'confirmedEnvelope.hpcProfileId');
  if (allowedCapabilities.some(item => REMOTE_CAPABILITIES.has(item))) {
    if (!hpcProfileId) throw new AgentCoreError(400, 'TASK_SPEC_HPC_REQUIRED', 'Remote capabilities require hpcProfileId');
    assertHpcBinding(task, hpcProfileId);
  }
  if (value.explorationReviewRequired !== undefined && typeof value.explorationReviewRequired !== 'boolean') {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'confirmedEnvelope.explorationReviewRequired must be a boolean');
  }
  const limits = objectValue(value.resourceLimits, 'confirmedEnvelope.resourceLimits');
  return {
    schemaVersion: 1,
    coreStageIds,
    scientificCommitments: orderedStringList(value.scientificCommitments ?? [], 'confirmedEnvelope.scientificCommitments'),
    allowedCapabilities,
    allowedMethods: orderedStringList(value.allowedMethods ?? [], 'confirmedEnvelope.allowedMethods'),
    allowedSoftwareStacks: orderedStringList(value.allowedSoftwareStacks ?? [], 'confirmedEnvelope.allowedSoftwareStacks'),
    hpcProfileId,
    resourceLimits: {
      maxCoresPerJob: positiveInteger(limits.maxCoresPerJob, 'resourceLimits.maxCoresPerJob'),
      maxWallMinutes: positiveInteger(limits.maxWallMinutes, 'resourceLimits.maxWallMinutes'),
      maxConcurrentJobs: positiveInteger(limits.maxConcurrentJobs, 'resourceLimits.maxConcurrentJobs'),
      maxAutomaticRetries: positiveInteger(limits.maxAutomaticRetries, 'resourceLimits.maxAutomaticRetries', true),
    },
    protectedRelativePaths: protectedPathList(value.protectedRelativePaths),
    completionEvidence: orderedStringList(value.completionEvidence, 'confirmedEnvelope.completionEvidence', false),
    researcherGates: orderedStringList(value.researcherGates ?? [], 'confirmedEnvelope.researcherGates'),
    explorationReviewRequired: value.explorationReviewRequired ?? task.workflow_id === 'theoretical-research',
    autonomy: { allowWorkingPlanEdits: true, allowRetriesWithinLimits: true, allowOwnJobCancellation: true },
  };
}

export function validateWorkingPlan(input: unknown, envelope: ConfirmedEnvelope): WorkingPlan {
  const value = objectValue(input ?? {}, 'workingPlan');
  const currentStageId = value.currentStageId === null || value.currentStageId === undefined || value.currentStageId === ''
    ? null
    : requiredText(value.currentStageId, 'workingPlan.currentStageId');
  if (currentStageId && !envelope.coreStageIds.includes(currentStageId)) {
    throw new AgentCoreError(409, 'WORKING_PLAN_STAGE_OUTSIDE_ENVELOPE', 'Working Plan current stage is outside the confirmed core workflow');
  }
  if (value.summary !== undefined && typeof value.summary !== 'string') throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'workingPlan.summary must be a string');
  if (value.nextActions !== undefined && (!Array.isArray(value.nextActions) || value.nextActions.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
    throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'workingPlan.nextActions must be an array of objects');
  }
  let explorationReview: WorkingPlan['explorationReview'];
  if (value.explorationReview !== undefined) {
    const review = objectValue(value.explorationReview, 'workingPlan.explorationReview');
    if (review.status !== 'continue' && review.status !== 'passed') {
      throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'workingPlan.explorationReview.status must be continue or passed');
    }
    const unresolvedHighValueItems = orderedStringList(
      review.unresolvedHighValueItems ?? [],
      'workingPlan.explorationReview.unresolvedHighValueItems',
    );
    if (review.status === 'continue' && unresolvedHighValueItems.length === 0) {
      throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'A continuing exploration review must name at least one unresolved high-value item');
    }
    if (review.status === 'passed' && unresolvedHighValueItems.length > 0) {
      throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'A passed exploration review cannot retain unresolved high-value items');
    }
    explorationReview = {
      status: review.status,
      summary: requiredText(review.summary, 'workingPlan.explorationReview.summary'),
      unresolvedHighValueItems,
    };
  }
  if (Buffer.byteLength(stableJson(value), 'utf8') > 512 * 1024) throw new AgentCoreError(413, 'WORKING_PLAN_TOO_LARGE', 'Working Plan exceeds 512 KiB');
  return { ...value, currentStageId, ...(explorationReview ? { explorationReview } : {}) } as WorkingPlan;
}

export function validateTaskSpec(input: unknown, task: ReturnType<typeof runtimeTask>): TaskSpec {
  const value = objectValue(input, 'taskSpec');
  if (value.schemaVersion !== 1) throw new AgentCoreError(400, 'TASK_SPEC_INVALID', 'taskSpec.schemaVersion must be 1');
  const confirmedEnvelope = validateEnvelope(value.confirmedEnvelope, task);
  return {
    schemaVersion: 1,
    objective: requiredText(value.objective, 'taskSpec.objective'),
    confirmedEnvelope,
    workingPlan: validateWorkingPlan(value.workingPlan ?? {}, confirmedEnvelope),
  };
}

export function serializeRun(row: any): ResearchRun {
  const { confirmed_envelope_json, working_plan_json, ...rest } = row;
  return {
    ...rest,
    confirmed_envelope: JSON.parse(confirmed_envelope_json),
    confirmed_envelope_sha256: sha256(confirmed_envelope_json),
    working_plan: JSON.parse(working_plan_json),
    working_plan_sha256: sha256(working_plan_json),
  } as ResearchRun;
}

function runRow(runId: string): any {
  const row = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId);
  if (!row) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  return row;
}

export function getRun(runId: string): ResearchRun { return serializeRun(runRow(runId)); }

export function activeRun(runId: string): ResearchRun {
  const run = getRun(runId);
  if (!['active', 'waiting_researcher'].includes(run.status)) throw new AgentCoreError(409, 'RUN_NOT_ACTIVE', 'Run must have a confirmed envelope before execution');
  return run;
}

export function assertStageInRun(run: ResearchRun, stageId: string): void {
  if (!run.confirmed_envelope.coreStageIds.includes(stageId)) throw new AgentCoreError(409, 'ACTION_STAGE_OUTSIDE_ENVELOPE', 'Action stage is outside the confirmed workflow envelope');
  if (!runtimeTask(run.task_id).workflow.stages.some(stage => stage.id === stageId)) throw new AgentCoreError(409, 'ACTION_STAGE_REMOVED', 'Action stage no longer exists in the current Task workflow');
}

function serializeEvent(row: any): RunEvent {
  const { payload_json, ...rest } = row;
  return { ...rest, payload: JSON.parse(payload_json) } as RunEvent;
}

export function appendEvent(runId: string, input: {
  category: RunEvent['category']; eventType: string; actorType: RunEvent['actor_type'];
  payload?: Record<string, unknown>; idempotencyKey?: string; source?: string; conversationRef?: string | null;
}) {
  runRow(runId);
  if (input.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey);
    if (existing) return serializeEvent(existing);
  }
  if (input.category === 'conclusion' && (input.actorType !== 'researcher' || input.source !== 'codex_conversation')) {
    throw new AgentCoreError(400, 'CONCLUSION_SOURCE_INVALID', 'Scientific conclusions require an explicit researcher decision in the Codex conversation');
  }
  const sequence = Number((db.prepare('SELECT MAX(sequence) AS value FROM run_events WHERE run_id = ?').get(runId) as any)?.value ?? 0) + 1;
  const id = newId('event');
  db.prepare(`INSERT INTO run_events (id, run_id, sequence, category, event_type, actor_type, payload_json, idempotency_key, source, conversation_ref, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, runId, sequence, input.category, requiredText(input.eventType, 'eventType'), input.actorType,
    stableJson(input.payload ?? {}), input.idempotencyKey ?? null, input.source ?? 'workbench', input.conversationRef?.trim() || null, now(),
  );
  return serializeEvent(db.prepare('SELECT * FROM run_events WHERE id = ?').get(id));
}

export function createRunDraft(taskId: string, researchPlanId: string, taskSpecInput: unknown, idempotencyKey: string) {
  const key = requiredText(idempotencyKey, 'idempotencyKey');
  const task = runtimeTask(taskId);
  assertPlanForTask(task, researchPlanId);
  const existing = db.prepare('SELECT * FROM research_runs WHERE task_id = ? AND idempotency_key = ?').get(taskId, key);
  if (existing) return serializeRun(existing);
  const open = db.prepare("SELECT id FROM research_runs WHERE task_id = ? AND status IN ('draft','active','waiting_researcher')").get(taskId) as any;
  if (open) throw new AgentCoreError(409, 'RUN_ALREADY_OPEN', 'Task already has an open research run', { runId: open.id });
  const spec = validateTaskSpec(taskSpecInput, task);
  const id = newId('run');
  const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO research_runs (id, task_id, research_plan_id, status, objective, confirmed_envelope_json, working_plan_json, envelope_revision, current_stage_id, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, ?, ?)`).run(
      id, taskId, researchPlanId, spec.objective, stableJson(spec.confirmedEnvelope), stableJson(spec.workingPlan), spec.workingPlan.currentStageId ?? null, key, ts, ts,
    );
    appendEvent(id, { category: 'decision', eventType: 'run.drafted', actorType: 'agent', payload: { objective: spec.objective, coreStageIds: spec.confirmedEnvelope.coreStageIds }, idempotencyKey: `run-drafted:${key}` });
  })();
  return getRun(id);
}

export function confirmRun(runId: string, input: { summary: unknown; source?: unknown; conversationRef?: unknown }) {
  if (input.source !== 'codex_conversation') throw new AgentCoreError(400, 'CONFIRMATION_SOURCE_INVALID', 'Run confirmation must originate from an explicit Codex conversation decision');
  const summary = requiredText(input.summary, 'summary');
  const row = runRow(runId);
  if (row.status !== 'draft') {
    if (row.envelope_confirmed_at && row.envelope_confirmation_summary === summary) return serializeRun(row);
    throw new AgentCoreError(409, 'RUN_ALREADY_CONFIRMED', 'Run envelope is already confirmed');
  }
  const task = runtimeTask(row.task_id);
  if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root must be resolved before confirming a Run');
  const envelope = JSON.parse(row.confirmed_envelope_json) as ConfirmedEnvelope;
  if (envelope.hpcProfileId) assertHpcBinding(task, envelope.hpcProfileId);
  const ts = now();
  db.transaction(() => {
    db.prepare("UPDATE research_runs SET status = 'active', envelope_revision = 1, envelope_confirmed_at = ?, envelope_confirmation_summary = ?, started_at = ?, updated_at = ? WHERE id = ?")
      .run(ts, summary, ts, ts, runId);
    appendEvent(runId, {
      category: 'decision', eventType: 'envelope.confirmed', actorType: 'researcher', payload: { revision: 1, summary, envelopeSha256: sha256(row.confirmed_envelope_json) }, source: 'codex_conversation',
      conversationRef: typeof input.conversationRef === 'string' ? input.conversationRef : null, idempotencyKey: 'envelope-confirmed:1',
    });
  })();
  return getRun(runId);
}

export function updateWorkingPlan(runId: string, input: { workingPlan: unknown; reason: unknown; idempotencyKey: unknown }) {
  const run = activeRun(runId);
  const key = requiredText(input.idempotencyKey, 'idempotencyKey');
  if (db.prepare('SELECT 1 FROM run_events WHERE run_id = ? AND idempotency_key = ?').get(runId, `working-plan:${key}`)) return getRun(runId);
  const workingPlan = validateWorkingPlan(input.workingPlan, run.confirmed_envelope);
  const reason = requiredText(input.reason, 'reason');
  const ts = now();
  db.transaction(() => {
    db.prepare('UPDATE research_runs SET working_plan_json = ?, current_stage_id = ?, updated_at = ? WHERE id = ?')
      .run(stableJson(workingPlan), workingPlan.currentStageId ?? null, ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'working_plan.updated', actorType: 'agent', payload: { reason, currentStageId: workingPlan.currentStageId ?? null }, idempotencyKey: `working-plan:${key}` });
  })();
  return getRun(runId);
}

function serializePending(row: any): PendingItem {
  const { detail_json, resolution_json, ...rest } = row;
  return { ...rest, detail: JSON.parse(detail_json), resolution: JSON.parse(resolution_json) } as PendingItem;
}

export function createPendingItem(runId: string, input: {
  audience: 'codex' | 'researcher'; kind: unknown; title: unknown; detail?: Record<string, unknown>;
  stageId?: string | null; actionId?: string | null; remoteJobId?: string | null; idempotencyKey?: string | null;
  source?: string; conversationRef?: string | null;
}) {
  const run = activeRun(runId);
  if (!['codex', 'researcher'].includes(input.audience)) throw new AgentCoreError(400, 'PENDING_AUDIENCE_INVALID', 'audience must be codex or researcher');
  if (input.stageId) assertStageInRun(run, input.stageId);
  if (input.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM pending_items WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey);
    if (existing) return serializePending(existing);
  }
  const id = newId('pending');
  const detail = input.detail ?? {};
  const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO pending_items (id, run_id, stage_id, action_id, remote_job_id, audience, kind, status, title, detail_json, idempotency_key, source, conversation_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`).run(
      id, runId, input.stageId ?? null, input.actionId ?? null, input.remoteJobId ?? null, input.audience,
      requiredText(input.kind, 'kind'), requiredText(input.title, 'title'), stableJson(detail), input.idempotencyKey ?? null,
      input.source ?? 'workbench', input.conversationRef ?? null, ts,
    );
    if (input.audience === 'researcher' && detail.blocksRun === true) db.prepare("UPDATE research_runs SET status = 'waiting_researcher', updated_at = ? WHERE id = ?").run(ts, runId);
    appendEvent(runId, {
      category: 'decision', eventType: 'pending.created', actorType: 'agent', payload: { pendingItemId: id, audience: input.audience, kind: input.kind, stageId: input.stageId ?? null },
      idempotencyKey: input.idempotencyKey ? `pending-event:${input.idempotencyKey}` : undefined, source: input.source, conversationRef: input.conversationRef,
    });
  })();
  return serializePending(db.prepare('SELECT * FROM pending_items WHERE id = ?').get(id));
}

function hasBlockingResearcherItem(runId: string): boolean {
  const rows = db.prepare("SELECT detail_json FROM pending_items WHERE run_id = ? AND audience = 'researcher' AND status = 'open'").all(runId) as Array<{ detail_json: string }>;
  return rows.some(row => { try { return JSON.parse(row.detail_json).blocksRun === true; } catch { return true; } });
}

export function resolvePendingItem(itemId: string, input: { status?: 'resolved' | 'dismissed'; resolution?: Record<string, unknown>; source?: string; conversationRef?: string | null }) {
  const row = db.prepare('SELECT * FROM pending_items WHERE id = ?').get(itemId) as any;
  if (!row) throw new AgentCoreError(404, 'PENDING_ITEM_NOT_FOUND', 'Pending item not found');
  if (row.status !== 'open') throw new AgentCoreError(409, 'PENDING_ITEM_CLOSED', 'Pending item is already closed');
  if (row.audience === 'researcher' && input.source !== 'codex_conversation') throw new AgentCoreError(400, 'PENDING_RESOLUTION_SOURCE_INVALID', 'Researcher items require an explicit Codex conversation decision');
  const status = input.status ?? 'resolved';
  if (!['resolved', 'dismissed'].includes(status)) throw new AgentCoreError(400, 'PENDING_STATUS_INVALID', 'status must be resolved or dismissed');
  const ts = now();
  db.transaction(() => {
    db.prepare('UPDATE pending_items SET status = ?, resolution_json = ?, source = ?, conversation_ref = ?, resolved_at = ? WHERE id = ?')
      .run(status, stableJson(input.resolution ?? {}), input.source ?? 'workbench', input.conversationRef ?? null, ts, itemId);
    if (!hasBlockingResearcherItem(row.run_id)) db.prepare("UPDATE research_runs SET status = 'active', updated_at = ? WHERE id = ? AND status = 'waiting_researcher'").run(ts, row.run_id);
    appendEvent(row.run_id, {
      category: 'decision', eventType: `pending.${status}`, actorType: row.audience === 'researcher' ? 'researcher' : 'agent',
      payload: { pendingItemId: itemId, resolution: input.resolution ?? {} }, source: input.source, conversationRef: input.conversationRef,
    });
  })();
  return serializePending(db.prepare('SELECT * FROM pending_items WHERE id = ?').get(itemId));
}

export function reviseEnvelope(runId: string, input: { confirmedEnvelope: unknown; pendingItemId: unknown; summary: unknown; source?: unknown; conversationRef?: unknown }) {
  if (input.source !== 'codex_conversation') throw new AgentCoreError(400, 'CONFIRMATION_SOURCE_INVALID', 'Envelope revisions require an explicit researcher decision in Codex');
  const run = activeRun(runId);
  const pendingItemId = requiredText(input.pendingItemId, 'pendingItemId');
  const pending = db.prepare("SELECT * FROM pending_items WHERE id = ? AND run_id = ? AND audience = 'researcher' AND status = 'open'").get(pendingItemId, runId);
  if (!pending) throw new AgentCoreError(409, 'ENVELOPE_PENDING_ITEM_REQUIRED', 'Envelope revision must resolve an open researcher pending item for this Run');
  const envelope = validateEnvelope(input.confirmedEnvelope, runtimeTask(run.task_id));
  const workingPlan = validateWorkingPlan(run.working_plan, envelope);
  const summary = requiredText(input.summary, 'summary');
  const revision = run.envelope_revision + 1;
  const ts = now();
  db.transaction(() => {
    db.prepare("UPDATE research_runs SET confirmed_envelope_json = ?, working_plan_json = ?, current_stage_id = ?, envelope_revision = ?, envelope_confirmed_at = ?, envelope_confirmation_summary = ?, status = 'active', updated_at = ? WHERE id = ?")
      .run(stableJson(envelope), stableJson(workingPlan), workingPlan.currentStageId ?? null, revision, ts, summary, ts, runId);
    db.prepare("UPDATE pending_items SET status = 'resolved', resolution_json = ?, source = 'codex_conversation', conversation_ref = ?, resolved_at = ? WHERE id = ?")
      .run(stableJson({ envelopeRevision: revision, summary }), typeof input.conversationRef === 'string' ? input.conversationRef : null, ts, pendingItemId);
    appendEvent(runId, {
      category: 'decision', eventType: 'envelope.revised', actorType: 'researcher', payload: { revision, summary, pendingItemId }, source: 'codex_conversation',
      conversationRef: typeof input.conversationRef === 'string' ? input.conversationRef : null, idempotencyKey: `envelope-revised:${revision}`,
    });
  })();
  return getRun(runId);
}

export function terminateRun(runId: string, reason: string) {
  const run = getRun(runId);
  if (['completed', 'terminated'].includes(run.status)) return run;
  const ts = now();
  db.transaction(() => {
    db.prepare("UPDATE research_runs SET status = 'terminated', ended_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'run.terminated', actorType: 'researcher', payload: { reason } });
  })();
  return getRun(runId);
}

export function completeRun(runId: string, summary: string, source: string, conversationRef?: string | null) {
  if (source !== 'codex_conversation') throw new AgentCoreError(400, 'COMPLETION_SOURCE_INVALID', 'Run completion requires researcher confirmation in Codex');
  const run = activeRun(runId);
  const task = runtimeTask(run.task_id);
  if (task.workflow_id === 'theoretical-research' && run.confirmed_envelope.explorationReviewRequired === true) {
    const review = run.working_plan.explorationReview;
    if (!review || review.status !== 'passed' || review.unresolvedHighValueItems.length > 0) {
      throw new AgentCoreError(
        409,
        'EXPLORATION_REVIEW_REQUIRED',
        'Complete the theoretical research exploration review before completing the Run',
        { workflowId: task.workflow_id, requiredStatus: 'passed' },
      );
    }
  }
  if (db.prepare("SELECT 1 FROM pending_items WHERE run_id = ? AND audience = 'researcher' AND status = 'open' LIMIT 1").get(runId)) throw new AgentCoreError(409, 'PENDING_RESEARCHER_ITEMS', 'Resolve researcher pending items before completing the Run');
  if (db.prepare("SELECT 1 FROM remote_jobs WHERE run_id = ? AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled') LIMIT 1").get(runId)) throw new AgentCoreError(409, 'ACTIVE_REMOTE_JOBS', 'All recorded remote Jobs must reach a terminal state before completing the Run');
  const ts = now();
  db.transaction(() => {
    db.prepare("UPDATE research_runs SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'run.completed', actorType: 'researcher', payload: { summary }, source, conversationRef });
  })();
  return getRun(run.id);
}

export function listEvents(runId: string, after = 0, limit?: number) {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new AgentCoreError(400, 'LIST_LIMIT_INVALID', 'limit must be a positive integer');
  const sql = `SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence${limit === undefined ? '' : ' LIMIT ?'}`;
  const rows = limit === undefined ? db.prepare(sql).all(runId, after) : db.prepare(sql).all(runId, after, limit);
  return (rows as any[]).map(serializeEvent);
}

export function listPendingItems(filters: { runId?: string; projectId?: string; taskId?: string; audience?: string; status?: string } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.runId) { conditions.push('pi.run_id = ?'); params.push(filters.runId); }
  if (filters.projectId) { conditions.push('t.project_id = ?'); params.push(filters.projectId); }
  if (filters.taskId) { conditions.push('r.task_id = ?'); params.push(filters.taskId); }
  if (filters.audience) {
    if (!['codex', 'researcher'].includes(filters.audience)) throw new AgentCoreError(400, 'PENDING_AUDIENCE_INVALID', 'Invalid audience');
    conditions.push('pi.audience = ?'); params.push(filters.audience);
  }
  if (filters.status) {
    if (!['open', 'resolved', 'dismissed'].includes(filters.status)) throw new AgentCoreError(400, 'PENDING_STATUS_INVALID', 'Invalid pending status');
    conditions.push('pi.status = ?'); params.push(filters.status);
  }
  const rows = db.prepare(`SELECT pi.*, r.task_id, r.status AS run_status, t.project_id, t.name AS task_name, p.name AS project_name
    FROM pending_items pi JOIN research_runs r ON r.id = pi.run_id JOIN tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY CASE pi.status WHEN 'open' THEN 0 ELSE 1 END, pi.created_at DESC`).all(...params) as any[];
  return rows.map(serializePending);
}

export function buildAgentContext(taskId: string): AgentContext {
  const row = runtimeTask(taskId);
  const current = db.prepare("SELECT * FROM research_runs WHERE task_id = ? AND status IN ('draft','active','waiting_researcher') ORDER BY created_at DESC LIMIT 1").get(taskId) as any;
  const run = current ? serializeRun(current) : null;
  const blockers: AgentContext['blockers'] = [];
  let taskRootAbsolute: string | null = null;
  if (!row.task_root_rel) blockers.push({ code: 'TASK_ROOT_UNRESOLVED', message: 'Task root has not been resolved' });
  else try { taskRootAbsolute = resolveWithinRoot(row.working_dir, normalizeTaskRootRel(row.task_root_rel), { allowRoot: false, label: 'task root' }); }
    catch (error) { blockers.push({ code: 'TASK_ROOT_INVALID', message: (error as Error).message }); }
  if (!run) blockers.push({ code: 'RUN_NOT_STARTED', message: 'No open research run exists for this Task' });
  else if (run.status === 'draft') blockers.push({ code: 'ENVELOPE_NOT_CONFIRMED', message: 'Task Spec envelope is awaiting the one-time researcher confirmation' });
  const pending = run ? listPendingItems({ runId: run.id, status: 'open' }) : [];
  if (pending.some(item => item.audience === 'researcher' && item.detail.blocksRun === true)) blockers.push({ code: 'RESEARCHER_INPUT_REQUIRED', message: 'A material correction or boundary change is waiting for researcher input' });
  const actions = run ? (db.prepare('SELECT * FROM run_actions WHERE run_id = ? ORDER BY created_at DESC').all(run.id) as any[])
    .map(({ spec_json, result_json, error_json, ...action }) => ({ ...action, spec: JSON.parse(spec_json), result: JSON.parse(result_json), error: JSON.parse(error_json) })) : [];
  const jobs = run ? (db.prepare('SELECT * FROM remote_jobs WHERE run_id = ? ORDER BY created_at DESC').all(run.id) as any[])
    .map(({ submission_spec_json, resources_json, last_observation_json, ...job }) => ({ ...job, submission_spec: JSON.parse(submission_spec_json), resources: JSON.parse(resources_json), last_observation: JSON.parse(last_observation_json) })) : [];
  if (jobs.some(job => job.status === 'submission_uncertain')) blockers.push({ code: 'SUBMISSION_UNCERTAIN', message: 'A recorded submission has an uncertain response and must be reconciled before another submission' });
  const monitorRow = run ? db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(run.id) as any : null;
  const activeJobs = jobs.filter(job => !TERMINAL_JOB_STATUSES.has(String(job.status).toLowerCase()));
  const activeJobCount = activeJobs.length;
  const dueJobCount = activeJobs.filter(job => job.next_check_at && job.next_check_at <= now()).length;
  const recommendedCadences = activeJobs.map(job => {
    const policy = normalizeJobMonitorPolicy(job.submission_spec?.monitoring, Number(job.resources?.wallMinutes ?? 60));
    return recommendedCadenceForStatus(String(job.status), policy);
  }).filter((value): value is number => value !== null);
  const monitor = monitorRow ? {
    ...monitorRow,
    active_job_count: activeJobCount,
    due_job_count: dueJobCount,
    recommended_cadence_minutes: recommendedCadences.length ? Math.min(...recommendedCadences) : null,
    ...heartbeatLeaseForMonitor(monitorRow),
  } : null;
  if (activeJobCount > 0 && (!monitor || monitor.status !== 'scheduled' || !monitor.automation_ref || monitor.heartbeat_fresh === false)) {
    blockers.push({ code: 'ACTIVE_JOBS_UNMONITORED', message: 'Active remote Jobs require a verified ACTIVE Scheduled Task monitor with a fresh heartbeat lease before Codex stops' });
  }
  if (activeJobCount === 0 && monitor?.automation_ref) {
    blockers.push({ code: 'MONITOR_AUTOMATION_CLEANUP_REQUIRED', message: 'All remote Jobs are terminal; delete the bound Scheduled Task automation and acknowledge monitor closure' });
  }
  const artifacts = run ? (db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at DESC').all(run.id) as any[])
    .map(({ metadata_json, ...artifact }) => ({ ...artifact, metadata: JSON.parse(metadata_json) })) : [];
  const evidenceChecks = run ? (db.prepare('SELECT * FROM evidence_checks WHERE run_id = ? ORDER BY created_at DESC').all(run.id) as any[])
    .map(({ result_json, ...check }) => ({ ...check, result: JSON.parse(result_json) })) : [];
  const eventCursor = run ? Number((db.prepare('SELECT MAX(sequence) AS value FROM run_events WHERE run_id = ?').get(run.id) as any)?.value ?? 0) : 0;
  const evidenceIndex = run ? (db.prepare("SELECT id, event_type, occurred_at FROM run_events WHERE run_id = ? AND category = 'fact' ORDER BY sequence DESC LIMIT 20").all(run.id) as any[])
    .map(item => ({ eventId: item.id, eventType: item.event_type, occurredAt: item.occurred_at })) : [];
  const capabilityEvent = run ? db.prepare("SELECT payload_json FROM run_events WHERE run_id = ? AND event_type = 'remote.capability_inspected' ORDER BY sequence DESC LIMIT 1").get(run.id) as any : null;
  const plan = run ? db.prepare('SELECT * FROM research_plans WHERE id = ?').get(run.research_plan_id) as any : null;
  let planMissing = false;
  if (plan) {
    try { planMissing = !fs.existsSync(resolveWithinRoot(row.working_dir, plan.file_name, { label: 'research plan' })); }
    catch { planMissing = true; }
  }
  const project = { id: row.project_id, name: row.project_name, description: row.project_description, material: row.material, working_dir: row.working_dir, hpc_config: row.hpc_config ?? undefined, status: row.project_status as 'active' | 'archived', created_at: row.project_created_at, updated_at: row.project_updated_at };
  const task = { id: row.id, project_id: row.project_id, name: row.name, description: row.description, workflow_id: row.workflow_id, workflow: row.workflow, task_root_rel: row.task_root_rel, task_root_unresolved: !row.task_root_rel, status: row.status, created_at: row.created_at, updated_at: row.updated_at } as Task;
  return {
    schemaVersion: 3, project, task, taskRoot: { relative: row.task_root_rel, absolute: taskRootAbsolute, resolved: Boolean(taskRootAbsolute) }, run,
    research: { planId: plan?.id ?? null, planTitle: plan?.title ?? null, planStatus: plan?.status ?? null, planMissing }, workflow: row.workflow,
    remoteCapability: capabilityEvent ? JSON.parse(capabilityEvent.payload_json) : null, recentActions: actions, recentJobs: jobs, monitor,
    recentArtifacts: artifacts, recentEvidenceChecks: evidenceChecks, pendingItems: pending, eventCursor, evidenceIndex, blockers,
  };
}
