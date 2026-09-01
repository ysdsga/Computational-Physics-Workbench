import crypto from 'crypto';
import fs from 'fs';
import db from '../db.js';
import type { EvidenceCheck, RunAction, RunActionStatus, RunArtifact } from '../../src/types/index.js';
import {
  activeRun,
  AgentCoreError,
  appendEvent,
  assertStageInRun,
  hashJson,
  getRun,
  newId,
  now,
  runtimeTask,
  stableJson,
} from './agentCore.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

function recordObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentCoreError(400, 'ACTION_INPUT_INVALID', `${field} must be an object`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError(400, 'ACTION_INPUT_INVALID', `${field} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function serializeAction(row: any): RunAction {
  const { spec_json, result_json, error_json, ...rest } = row;
  return { ...rest, spec: JSON.parse(spec_json), result: JSON.parse(result_json), error: JSON.parse(error_json) } as RunAction;
}

function serializeArtifact(row: any): RunArtifact {
  const { metadata_json, ...rest } = row;
  return { ...rest, metadata: JSON.parse(metadata_json) } as RunArtifact;
}

function serializeEvidence(row: any): EvidenceCheck {
  const { result_json, ...rest } = row;
  return { ...rest, result: JSON.parse(result_json) } as EvidenceCheck;
}

function actionRow(actionId: string): any {
  const row = db.prepare('SELECT * FROM run_actions WHERE id = ?').get(actionId);
  if (!row) throw new AgentCoreError(404, 'ACTION_NOT_FOUND', 'Action not found');
  return row;
}

function retryConsumesScientificBudget(actionType: string, actionId: string): boolean {
  if (actionType !== 'job.submit') return true;
  const jobs = db.prepare('SELECT job_id, status FROM remote_jobs WHERE action_id = ?').all(actionId) as Array<{ job_id: string | null; status: string }>;
  return !(jobs.length > 0 && jobs.every(job => !job.job_id && job.status === 'preparation_failed'));
}

function stageBlocked(runId: string, stageId: string): boolean {
  const rows = db.prepare("SELECT stage_id, detail_json FROM pending_items WHERE run_id = ? AND audience = 'researcher' AND status = 'open'").all(runId) as Array<{ stage_id: string | null; detail_json: string }>;
  return rows.some(row => {
    try {
      const detail = JSON.parse(row.detail_json);
      return detail.blocksRun === true && (!row.stage_id || row.stage_id === stageId);
    } catch { return true; }
  });
}

export function createAction(runId: string, input: {
  stageId: unknown;
  stepId?: unknown;
  parentActionId?: unknown;
  retryOfActionId?: unknown;
  actionType: unknown;
  spec: unknown;
  idempotencyKey: unknown;
  conversationRef?: unknown;
}) {
  const run = activeRun(runId);
  const stageId = requiredText(input.stageId, 'stageId');
  assertStageInRun(run, stageId);
  if (stageBlocked(runId, stageId)) throw new AgentCoreError(409, 'STAGE_WAITING_RESEARCHER', 'This stage is paused by a material researcher pending item');
  const actionType = requiredText(input.actionType, 'actionType');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const spec = recordObject(input.spec, 'spec');
  const existing = db.prepare('SELECT * FROM run_actions WHERE run_id = ? AND idempotency_key = ?').get(runId, idempotencyKey) as any;
  if (existing) {
    const serialized = serializeAction(existing);
    if (serialized.stage_id !== stageId || serialized.action_type !== actionType || serialized.spec_sha256 !== hashJson(spec) || serialized.retry_of_action_id !== optionalText(input.retryOfActionId)) {
      throw new AgentCoreError(409, 'ACTION_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different Action');
    }
    return serialized;
  }
  const parentActionId = optionalText(input.parentActionId);
  if (parentActionId) {
    const parent = actionRow(parentActionId);
    if (parent.run_id !== runId) throw new AgentCoreError(409, 'ACTION_PARENT_RUN_MISMATCH', 'Parent Action belongs to a different Run');
  }
  const retryOfActionId = optionalText(input.retryOfActionId);
  let retryAttempt = 0;
  if (retryOfActionId) {
    const previous = actionRow(retryOfActionId);
    if (previous.run_id !== runId || previous.stage_id !== stageId || previous.action_type !== actionType) {
      throw new AgentCoreError(409, 'ACTION_RETRY_MISMATCH', 'Retry source must belong to the same Run, stage and Action type');
    }
    if (!['waiting_codex', 'failed', 'cancelled'].includes(previous.status)) {
      throw new AgentCoreError(409, 'ACTION_RETRY_SOURCE_NOT_FAILED', 'Retry source must be waiting for Codex diagnosis, failed, or cancelled as an invalid/replaced Action');
    }
    if (db.prepare('SELECT 1 FROM run_actions WHERE retry_of_action_id = ?').get(retryOfActionId)) {
      throw new AgentCoreError(409, 'ACTION_RETRY_ALREADY_CREATED', 'This Action already has a retry successor');
    }
    retryAttempt = Number(previous.retry_attempt ?? 0) + (retryConsumesScientificBudget(actionType, retryOfActionId) ? 1 : 0);
    if (retryAttempt > run.confirmed_envelope.resourceLimits.maxAutomaticRetries) {
      throw new AgentCoreError(409, 'ACTION_RETRY_LIMIT_REACHED', 'Confirmed automatic retry limit reached', {
        retryAttempt,
        maxAutomaticRetries: run.confirmed_envelope.resourceLimits.maxAutomaticRetries,
      });
    }
  }
  const stepId = optionalText(input.stepId);
  if (stepId) {
    const task = runtimeTask(run.task_id);
    const step = task.workflow.steps.find(item => item.id === stepId);
    if (!step || step.stageId !== stageId) throw new AgentCoreError(409, 'ACTION_STEP_STAGE_MISMATCH', 'Workflow step does not belong to this Action stage');
  }
  const id = newId('action');
  const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO run_actions (
      id, run_id, stage_id, step_id, parent_action_id, retry_of_action_id, retry_attempt, action_type, status, executor,
      spec_json, spec_sha256, idempotency_key, conversation_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'codex', ?, ?, ?, ?, ?, ?)`)
      .run(id, runId, stageId, stepId, parentActionId, retryOfActionId, retryAttempt, actionType, stableJson(spec), hashJson(spec), idempotencyKey, optionalText(input.conversationRef), ts, ts);
    appendEvent(runId, {
      category: 'fact', eventType: 'action.created', actorType: 'agent',
      payload: { actionId: id, stageId, stepId, actionType, retryOfActionId, retryAttempt, specSha256: hashJson(spec) },
      idempotencyKey: `action-created:${idempotencyKey}`,
      conversationRef: optionalText(input.conversationRef),
    });
  })();
  return serializeAction(actionRow(id));
}

const TRANSITIONS: Record<RunActionStatus, RunActionStatus[]> = {
  ready: ['executing', 'cancelled'],
  executing: ['waiting_remote', 'waiting_codex', 'waiting_researcher', 'succeeded', 'failed', 'cancelled'],
  waiting_remote: ['executing', 'waiting_codex', 'succeeded', 'failed', 'cancelled'],
  waiting_codex: ['executing', 'waiting_researcher', 'succeeded', 'failed', 'cancelled'],
  waiting_researcher: ['executing', 'failed', 'cancelled'],
  succeeded: [], failed: [], cancelled: [],
};

export function transitionAction(actionId: string, input: { status: unknown; result?: unknown; error?: unknown }) {
  const row = actionRow(actionId);
  const status = requiredText(input.status, 'status') as RunActionStatus;
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, status)) throw new AgentCoreError(400, 'ACTION_STATUS_INVALID', 'Invalid Action status');
  if (row.status === status) return serializeAction(row);
  if (!TRANSITIONS[row.status as RunActionStatus].includes(status)) {
    throw new AgentCoreError(409, 'ACTION_TRANSITION_INVALID', `Cannot change Action from ${row.status} to ${status}`);
  }
  const ts = now();
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(status);
  db.transaction(() => {
    db.prepare(`UPDATE run_actions SET status = ?, result_json = ?, error_json = ?,
      started_at = CASE WHEN ? = 'executing' AND started_at IS NULL THEN ? ELSE started_at END,
      finished_at = CASE WHEN ? THEN ? ELSE finished_at END, updated_at = ? WHERE id = ?`)
      .run(status, stableJson(input.result ?? JSON.parse(row.result_json)), stableJson(input.error ?? JSON.parse(row.error_json)), status, ts, terminal ? 1 : 0, ts, ts, actionId);
    appendEvent(row.run_id, {
      category: 'fact', eventType: `action.${status}`, actorType: 'system',
      payload: { actionId, stageId: row.stage_id, actionType: row.action_type },
    });
  })();
  return serializeAction(actionRow(actionId));
}

export function getAction(actionId: string) {
  const action = serializeAction(actionRow(actionId));
  return {
    ...action,
    artifacts: listArtifacts(action.run_id).filter(item => item.action_id === actionId),
    evidenceChecks: listEvidenceChecks(action.run_id).filter(item => item.action_id === actionId),
    remoteJobs: (db.prepare('SELECT * FROM remote_jobs WHERE action_id = ? ORDER BY created_at').all(actionId) as any[]).map(row => ({
      ...row,
      submission_spec: JSON.parse(row.submission_spec_json),
      resources: JSON.parse(row.resources_json),
      last_observation: JSON.parse(row.last_observation_json),
    })),
  };
}

function listLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new AgentCoreError(400, 'LIST_LIMIT_INVALID', 'limit must be a positive integer');
  return limit;
}

export function listActions(runId: string, limit?: number): RunAction[] {
  getRun(runId);
  const normalized = listLimit(limit);
  const sql = `SELECT * FROM run_actions WHERE run_id = ? ORDER BY created_at DESC${normalized === undefined ? '' : ' LIMIT ?'}`;
  const rows = normalized === undefined ? db.prepare(sql).all(runId) : db.prepare(sql).all(runId, normalized);
  return (rows as any[]).map(serializeAction);
}

export function getActionForExecution(actionId: string, statuses: RunActionStatus[] = ['ready']): RunAction {
  const action = serializeAction(actionRow(actionId));
  const run = activeRun(action.run_id);
  assertStageInRun(run, action.stage_id);
  if (!statuses.includes(action.status)) throw new AgentCoreError(409, 'ACTION_NOT_EXECUTABLE', `Action status ${action.status} is not executable`);
  if (stageBlocked(action.run_id, action.stage_id)) throw new AgentCoreError(409, 'STAGE_WAITING_RESEARCHER', 'Action stage is paused by a researcher pending item');
  return action;
}

export function registerArtifact(actionId: string, input: {
  location: unknown; path: unknown; category: unknown; idempotencyKey: unknown;
  remoteJobId?: unknown; sizeBytes?: unknown; sha256?: unknown; metadata?: unknown;
  validity?: unknown; supersededById?: unknown;
}) {
  const action = serializeAction(actionRow(actionId));
  const location = requiredText(input.location, 'location');
  if (!['local', 'remote'].includes(location)) throw new AgentCoreError(400, 'ARTIFACT_LOCATION_INVALID', 'location must be local or remote');
  const referencePath = requiredText(input.path, 'path').replace(/\\/g, '/');
  const category = requiredText(input.category, 'category');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const validity = requiredText(input.validity ?? 'valid', 'validity');
  if (!['valid', 'suspect', 'invalid', 'superseded'].includes(validity)) throw new AgentCoreError(400, 'ARTIFACT_VALIDITY_INVALID', 'Invalid Artifact validity');
  const existing = db.prepare('SELECT * FROM run_artifacts WHERE action_id = ? AND idempotency_key = ?').get(actionId, idempotencyKey) as any;
  if (existing) {
    const item = serializeArtifact(existing);
    if (item.location !== location || item.path !== referencePath || item.category !== category) throw new AgentCoreError(409, 'ARTIFACT_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to another Artifact');
    return item;
  }
  let sizeBytes: number;
  let digest: string;
  const remoteJobId = optionalText(input.remoteJobId);
  if (location === 'local') {
    const run = activeRun(action.run_id);
    const task = runtimeTask(run.task_id);
    if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
    const taskRoot = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
    const target = resolveWithinRoot(taskRoot, referencePath, { mustExist: true, allowRoot: false, label: 'artifact' });
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new AgentCoreError(400, 'ARTIFACT_NOT_FILE', 'Local Artifact must reference a file');
    sizeBytes = stat.size;
    digest = fileSha256(target);
  } else {
    if (!remoteJobId) throw new AgentCoreError(400, 'REMOTE_ARTIFACT_JOB_REQUIRED', 'Remote Artifact must reference a recorded Job');
    const job = db.prepare('SELECT run_id, action_id FROM remote_jobs WHERE id = ?').get(remoteJobId) as any;
    if (!job || job.run_id !== action.run_id || job.action_id !== actionId) throw new AgentCoreError(409, 'REMOTE_ARTIFACT_JOB_MISMATCH', 'Remote Artifact Job must belong to this Action and Run');
    sizeBytes = Number(input.sizeBytes);
    digest = requiredText(input.sha256, 'sha256').toLowerCase();
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(digest)) throw new AgentCoreError(400, 'REMOTE_ARTIFACT_METADATA_INVALID', 'Remote Artifact requires verified size and SHA-256');
  }
  const supersededById = optionalText(input.supersededById);
  if (supersededById && !db.prepare('SELECT 1 FROM run_artifacts WHERE id = ? AND run_id = ?').get(supersededById, action.run_id)) throw new AgentCoreError(409, 'ARTIFACT_SUPERSEDED_MISMATCH', 'Replacement Artifact belongs to another Run');
  const id = newId('artifact');
  const ts = now();
  db.prepare(`INSERT INTO run_artifacts (
    id, run_id, action_id, remote_job_id, stage_id, location, path, size_bytes,
    sha256, category, validity, superseded_by_id, metadata_json, idempotency_key, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, action.run_id, actionId, remoteJobId, action.stage_id, location, referencePath, sizeBytes, digest, category, validity, supersededById, stableJson(input.metadata ?? {}), idempotencyKey, ts, ts);
  return serializeArtifact(db.prepare('SELECT * FROM run_artifacts WHERE id = ?').get(id));
}

export function updateArtifactValidity(artifactId: string, input: { validity: unknown; supersededById?: unknown; reason: unknown }) {
  const row = db.prepare('SELECT * FROM run_artifacts WHERE id = ?').get(artifactId) as any;
  if (!row) throw new AgentCoreError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found');
  const validity = requiredText(input.validity, 'validity');
  if (!['valid', 'suspect', 'invalid', 'superseded'].includes(validity)) throw new AgentCoreError(400, 'ARTIFACT_VALIDITY_INVALID', 'Invalid Artifact validity');
  const supersededById = optionalText(input.supersededById);
  if (validity === 'superseded' && !supersededById) throw new AgentCoreError(400, 'ARTIFACT_REPLACEMENT_REQUIRED', 'superseded Artifact requires supersededById');
  if (supersededById && !db.prepare('SELECT 1 FROM run_artifacts WHERE id = ? AND run_id = ?').get(supersededById, row.run_id)) throw new AgentCoreError(409, 'ARTIFACT_SUPERSEDED_MISMATCH', 'Replacement Artifact belongs to another Run');
  const reason = requiredText(input.reason, 'reason');
  const ts = now();
  db.transaction(() => {
    db.prepare('UPDATE run_artifacts SET validity = ?, superseded_by_id = ?, updated_at = ? WHERE id = ?').run(validity, supersededById, ts, artifactId);
    appendEvent(row.run_id, { category: 'inference', eventType: 'artifact.validity_changed', actorType: 'agent', payload: { artifactId, from: row.validity, to: validity, supersededById, reason } });
  })();
  return serializeArtifact(db.prepare('SELECT * FROM run_artifacts WHERE id = ?').get(artifactId));
}

export function listArtifacts(runId: string, limit?: number): RunArtifact[] {
  getRun(runId);
  const normalized = listLimit(limit);
  const sql = `SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at DESC${normalized === undefined ? '' : ' LIMIT ?'}`;
  const rows = normalized === undefined ? db.prepare(sql).all(runId) : db.prepare(sql).all(runId, normalized);
  return (rows as any[]).map(serializeArtifact);
}

export function registerEvidenceCheck(actionId: string, input: {
  artifactId?: unknown; validatorName: unknown; validatorVersion: unknown;
  status: unknown; result: unknown; idempotencyKey: unknown;
}) {
  const action = serializeAction(actionRow(actionId));
  const validatorName = requiredText(input.validatorName, 'validatorName');
  const validatorVersion = requiredText(input.validatorVersion, 'validatorVersion');
  const status = requiredText(input.status, 'status');
  if (!['pass', 'warn', 'fail'].includes(status)) throw new AgentCoreError(400, 'EVIDENCE_STATUS_INVALID', 'status must be pass, warn or fail');
  const result = recordObject(input.result, 'result');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const artifactId = optionalText(input.artifactId);
  if (artifactId && !db.prepare('SELECT 1 FROM run_artifacts WHERE id = ? AND run_id = ? AND action_id = ?').get(artifactId, action.run_id, actionId)) throw new AgentCoreError(409, 'EVIDENCE_ARTIFACT_MISMATCH', 'Evidence Artifact does not belong to this Action');
  const existing = db.prepare('SELECT * FROM evidence_checks WHERE action_id = ? AND idempotency_key = ?').get(actionId, idempotencyKey) as any;
  if (existing) {
    const item = serializeEvidence(existing);
    if (item.validator_name !== validatorName || item.status !== status || hashJson(item.result) !== hashJson(result)) throw new AgentCoreError(409, 'EVIDENCE_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to another evidence result');
    return item;
  }
  const id = newId('evidence');
  db.prepare(`INSERT INTO evidence_checks (
    id, run_id, action_id, artifact_id, stage_id, validator_name, validator_version,
    status, result_json, idempotency_key, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, action.run_id, actionId, artifactId, action.stage_id, validatorName, validatorVersion, status, stableJson(result), idempotencyKey, now());
  return serializeEvidence(db.prepare('SELECT * FROM evidence_checks WHERE id = ?').get(id));
}

export function listEvidenceChecks(runId: string, limit?: number): EvidenceCheck[] {
  getRun(runId);
  const normalized = listLimit(limit);
  const sql = `SELECT * FROM evidence_checks WHERE run_id = ? ORDER BY created_at DESC${normalized === undefined ? '' : ' LIMIT ?'}`;
  const rows = normalized === undefined ? db.prepare(sql).all(runId) : db.prepare(sql).all(runId, normalized);
  return (rows as any[]).map(serializeEvidence);
}

export function listEvidenceLibrary(filters: { projectId?: string; taskId?: string; location?: string; checkStatus?: string; validity?: string; search?: string } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.projectId) { conditions.push('tasks.project_id = ?'); params.push(filters.projectId); }
  if (filters.taskId) { conditions.push('research_runs.task_id = ?'); params.push(filters.taskId); }
  if (filters.location) { conditions.push('run_artifacts.location = ?'); params.push(filters.location); }
  if (filters.validity) { conditions.push('run_artifacts.validity = ?'); params.push(filters.validity); }
  if (filters.search) { conditions.push('(run_artifacts.path LIKE ? OR run_artifacts.category LIKE ?)'); params.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.checkStatus) {
    if (!['pass', 'warn', 'fail', 'unchecked'].includes(filters.checkStatus)) throw new AgentCoreError(400, 'EVIDENCE_STATUS_INVALID', 'checkStatus must be pass, warn, fail or unchecked');
    if (filters.checkStatus === 'unchecked') {
      conditions.push('NOT EXISTS (SELECT 1 FROM evidence_checks ec WHERE ec.artifact_id = run_artifacts.id)');
    } else {
      conditions.push('EXISTS (SELECT 1 FROM evidence_checks ec WHERE ec.artifact_id = run_artifacts.id AND ec.status = ?)');
      params.push(filters.checkStatus);
    }
  }
  const rows = db.prepare(`SELECT run_artifacts.*, projects.id project_id, projects.name project_name,
      tasks.id task_id, tasks.name task_name, research_runs.status run_status,
      run_actions.action_type, remote_jobs.status job_status
    FROM run_artifacts
    JOIN research_runs ON research_runs.id = run_artifacts.run_id
    JOIN tasks ON tasks.id = research_runs.task_id
    JOIN projects ON projects.id = tasks.project_id
    JOIN run_actions ON run_actions.id = run_artifacts.action_id
    LEFT JOIN remote_jobs ON remote_jobs.id = run_artifacts.remote_job_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY run_artifacts.created_at DESC`).all(...params) as any[];
  const checks = db.prepare('SELECT * FROM evidence_checks WHERE artifact_id = ? ORDER BY created_at DESC');
  return rows.map(row => {
    const task = runtimeTask(row.task_id);
    let localAvailable: boolean | null = null;
    if (row.location === 'local' && task.task_root_rel) {
      try {
        const root = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { allowRoot: false, label: 'task root' });
        localAvailable = fs.existsSync(resolveWithinRoot(root, row.path, { allowRoot: false, label: 'artifact' }));
      } catch { localAvailable = false; }
    }
    return { ...serializeArtifact(row), project_id: row.project_id, project_name: row.project_name, task_id: row.task_id, task_name: row.task_name, run_status: row.run_status, action_type: row.action_type, job_status: row.job_status, local_available: localAvailable, checks: (checks.all(row.id) as any[]).map(serializeEvidence) };
  });
}
