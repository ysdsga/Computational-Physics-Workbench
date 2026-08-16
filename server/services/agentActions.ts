import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import type {
  EvidenceCheck,
  EvidenceLibraryItem,
  RunAction,
  RunActionStatus,
  RunArtifact,
  WorkflowTemplate,
} from '../../src/types/index.js';
import {
  AgentCoreError,
  appendEvent,
  effectivePolicy,
  hashJson,
  newId,
  now,
  readPlanAndContract,
  sha256,
  stableJson,
} from './agentCore.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

const ACTION_STATUSES: RunActionStatus[] = [
  'proposed',
  'authorized',
  'executing',
  'waiting_remote',
  'waiting_user',
  'succeeded',
  'failed',
  'cancelled',
];

const TERMINAL_ACTION_STATUSES = new Set<RunActionStatus>(['succeeded', 'failed', 'cancelled']);

const ACTION_TRANSITIONS: Record<RunActionStatus, RunActionStatus[]> = {
  proposed: ['cancelled'],
  authorized: ['executing', 'cancelled'],
  executing: ['waiting_remote', 'waiting_user', 'succeeded', 'failed', 'cancelled'],
  waiting_remote: ['executing', 'succeeded', 'failed', 'cancelled'],
  waiting_user: ['executing', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

function recordObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCoreError(400, 'ACTION_INPUT_INVALID', `${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentCoreError(400, 'ACTION_INPUT_INVALID', `${field} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeReferencePath(value: unknown): string {
  const raw = requiredText(value, 'path').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (
    raw.includes('\0')
    || raw.includes('\r')
    || raw.includes('\n')
    || path.win32.isAbsolute(raw)
    || path.posix.isAbsolute(raw)
  ) {
    throw new AgentCoreError(400, 'ARTIFACT_PATH_INVALID', 'Artifact path must be a safe relative path');
  }
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new AgentCoreError(400, 'ARTIFACT_PATH_INVALID', 'Artifact path contains traversal or empty segments');
  }
  return parts.join('/');
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function serializeAction(row: any): RunAction {
  const { manifest_json, result_json, error_json, ...rest } = row;
  return {
    ...rest,
    manifest: JSON.parse(manifest_json),
    result: JSON.parse(result_json),
    error: JSON.parse(error_json),
  } as RunAction;
}

function serializeArtifact(row: any): RunArtifact {
  const { metadata_json, ...rest } = row;
  return { ...rest, metadata: JSON.parse(metadata_json) } as RunArtifact;
}

function serializeEvidenceCheck(row: any): EvidenceCheck {
  const { result_json, ...rest } = row;
  return { ...rest, result: JSON.parse(result_json) } as EvidenceCheck;
}

function getRun(runId: string): any {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  return run;
}

function getActionRow(actionId: string): any {
  const action = db.prepare('SELECT * FROM run_actions WHERE id = ?').get(actionId) as any;
  if (!action) throw new AgentCoreError(404, 'ACTION_NOT_FOUND', 'Action not found');
  return action;
}

function assertCurrentContext(run: any, contextVersionId: string): any {
  if (run.current_context_version_id !== contextVersionId) {
    throw new AgentCoreError(409, 'STALE_CONTEXT', 'Run context changed before the action could be recorded', {
      expectedContextVersionId: contextVersionId,
      currentContextVersionId: run.current_context_version_id,
    });
  }
  const context = db.prepare('SELECT * FROM run_context_versions WHERE id = ? AND run_id = ?')
    .get(contextVersionId, run.id) as any;
  if (!context) throw new AgentCoreError(409, 'CONTEXT_RUN_MISMATCH', 'Context version does not belong to this run');
  return context;
}

function assertWorkflowStep(context: any, stepId: string): void {
  let workflow: WorkflowTemplate;
  try {
    workflow = JSON.parse(context.workflow_json) as WorkflowTemplate;
  } catch {
    throw new AgentCoreError(409, 'WORKFLOW_SNAPSHOT_INVALID', 'Adopted workflow snapshot is invalid');
  }
  if (!Array.isArray(workflow.steps) || !workflow.steps.some(step => step.id === stepId)) {
    throw new AgentCoreError(400, 'WORKFLOW_STEP_UNKNOWN', `Step ${stepId} is not present in the adopted workflow`);
  }
}

function assertContextSourcesCurrent(run: any, context: any): void {
  const task = db.prepare('SELECT project_id, workflow_snapshot FROM tasks WHERE id = ?').get(run.task_id) as
    | { project_id: string; workflow_snapshot: string | null }
    | undefined;
  if (!task?.workflow_snapshot) throw new AgentCoreError(409, 'WORKFLOW_SNAPSHOT_INVALID', 'Task workflow snapshot is missing');
  let snapshot: ReturnType<typeof readPlanAndContract>;
  try { snapshot = readPlanAndContract(run.research_plan_id); }
  catch (error) {
    throw new AgentCoreError(409, 'CONTEXT_DRIFT', 'Research plan or contract no longer matches the adopted action context', {
      sourceCode: error instanceof AgentCoreError ? error.code : 'RESEARCH_SOURCE_INVALID',
    });
  }
  let workflow: unknown;
  try { workflow = JSON.parse(task.workflow_snapshot); }
  catch { throw new AgentCoreError(409, 'WORKFLOW_SNAPSHOT_INVALID', 'Task workflow snapshot is invalid'); }
  const policy = effectivePolicy(task.project_id, run.task_id).effective;
  const drift = {
    plan: snapshot.planHash !== context.plan_sha256,
    contract: snapshot.contractHash !== context.contract_sha256,
    workflow: hashJson(workflow) !== context.workflow_sha256,
    policy: hashJson(policy) !== context.policy_sha256,
  };
  if (Object.values(drift).some(Boolean)) {
    throw new AgentCoreError(409, 'CONTEXT_DRIFT', 'Plan, contract, workflow or policy differs from the adopted action context', drift);
  }
}

function assertRunAcceptsNewAction(run: any): void {
  if (run.status === 'waiting_review') {
    throw new AgentCoreError(409, 'RUN_WAITING_REVIEW', 'Resolve the pending Codex conversation review before proposing another action');
  }
  if (run.status !== 'active') {
    throw new AgentCoreError(409, 'RUN_NOT_ACTIVE', `Run status ${run.status} does not accept new actions`);
  }
}

export function createAction(runId: string, input: {
  contextVersionId: unknown;
  stepId: unknown;
  actionType: unknown;
  manifest: unknown;
  idempotencyKey: unknown;
  conversationRef?: unknown;
}) {
  const run = getRun(runId);
  assertRunAcceptsNewAction(run);
  const contextVersionId = requiredText(input.contextVersionId, 'contextVersionId');
  const context = assertCurrentContext(run, contextVersionId);
  assertContextSourcesCurrent(run, context);
  const stepId = requiredText(input.stepId, 'stepId');
  assertWorkflowStep(context, stepId);
  const actionType = requiredText(input.actionType, 'actionType');
  const manifest = recordObject(input.manifest, 'manifest');
  const manifestSha256 = hashJson(manifest);
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const conversationRef = optionalText(input.conversationRef);

  const existing = db.prepare('SELECT * FROM run_actions WHERE run_id = ? AND idempotency_key = ?')
    .get(runId, idempotencyKey) as any;
  if (existing) {
    if (
      existing.context_version_id !== contextVersionId
      || existing.step_id !== stepId
      || existing.action_type !== actionType
      || existing.manifest_sha256 !== manifestSha256
    ) {
      throw new AgentCoreError(409, 'ACTION_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different action');
    }
    return serializeAction(existing);
  }

  const id = newId('action');
  const timestamp = now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO run_actions (
        id, run_id, context_version_id, step_id, action_type, status, executor,
        manifest_json, manifest_sha256, idempotency_key, conversation_ref,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'proposed', 'codex', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      runId,
      contextVersionId,
      stepId,
      actionType,
      stableJson(manifest),
      manifestSha256,
      idempotencyKey,
      conversationRef,
      timestamp,
      timestamp,
    );
    appendEvent(runId, {
      category: 'inference',
      eventType: 'action.proposed',
      actorType: 'agent',
      source: 'codex_conversation',
      conversationRef,
      contextVersionId,
      payload: { actionId: id, stepId, actionType, manifestSha256 },
    });
  })();
  return serializeAction(db.prepare('SELECT * FROM run_actions WHERE id = ?').get(id));
}

export function authorizeAction(actionId: string, input: {
  expectedContextVersionId: unknown;
  expectedManifestSha256: unknown;
  authorizationSummary: unknown;
  source: unknown;
  conversationRef?: unknown;
}) {
  const action = getActionRow(actionId);
  if (input.source !== 'codex_conversation') {
    throw new AgentCoreError(400, 'AUTHORIZATION_SOURCE_INVALID', 'Action authorization must originate from a Codex project conversation');
  }
  const expectedContextVersionId = requiredText(input.expectedContextVersionId, 'expectedContextVersionId');
  if (expectedContextVersionId !== action.context_version_id) {
    throw new AgentCoreError(409, 'ACTION_CONTEXT_MISMATCH', 'Authorization references a different action context');
  }
  const expectedManifestSha256 = requiredText(input.expectedManifestSha256, 'expectedManifestSha256').toLowerCase();
  if (expectedManifestSha256 !== action.manifest_sha256) {
    throw new AgentCoreError(409, 'ACTION_MANIFEST_MISMATCH', 'Authorization does not match the immutable execution manifest');
  }
  const authorizationSummary = requiredText(input.authorizationSummary, 'authorizationSummary');
  const conversationRef = optionalText(input.conversationRef) ?? action.conversation_ref;
  const authorizationSha256 = sha256(stableJson({
    authorizationSummary,
    contextVersionId: expectedContextVersionId,
    manifestSha256: expectedManifestSha256,
    source: 'codex_conversation',
    conversationRef,
  }));
  if (action.status === 'authorized') {
    if (action.authorization_sha256 !== authorizationSha256) {
      throw new AgentCoreError(409, 'ACTION_AUTHORIZATION_CONFLICT', 'Action is already bound to a different authorization summary');
    }
    return serializeAction(action);
  }
  if (action.status !== 'proposed') {
    throw new AgentCoreError(409, 'ACTION_NOT_PROPOSED', `Action status ${action.status} cannot be authorized`);
  }
  const run = getRun(action.run_id);
  assertRunAcceptsNewAction(run);
  const context = assertCurrentContext(run, expectedContextVersionId);
  assertContextSourcesCurrent(run, context);
  const timestamp = now();
  db.transaction(() => {
    const result = db.prepare(`
      UPDATE run_actions
      SET status = 'authorized', conversation_ref = ?, authorization_summary = ?,
          authorization_sha256 = ?, authorized_at = ?, updated_at = ?
      WHERE id = ? AND status = 'proposed'
    `).run(conversationRef, authorizationSummary, authorizationSha256, timestamp, timestamp, actionId);
    if (result.changes !== 1) throw new AgentCoreError(409, 'ACTION_NOT_PROPOSED', 'Action is no longer proposed');
    appendEvent(action.run_id, {
      category: 'decision',
      eventType: 'action.authorized',
      actorType: 'researcher',
      source: 'codex_conversation',
      conversationRef,
      contextVersionId: action.context_version_id,
      payload: { actionId, manifestSha256: action.manifest_sha256, authorizationSummary, authorizationSha256 },
    });
  })();
  return serializeAction(db.prepare('SELECT * FROM run_actions WHERE id = ?').get(actionId));
}

export function transitionAction(actionId: string, input: {
  status: unknown;
  result?: unknown;
  error?: unknown;
}) {
  const action = getActionRow(actionId);
  const status = requiredText(input.status, 'status') as RunActionStatus;
  if (!ACTION_STATUSES.includes(status)) throw new AgentCoreError(400, 'ACTION_STATUS_INVALID', `Unknown action status: ${status}`);
  if (action.status === status) return serializeAction(action);
  if (!ACTION_TRANSITIONS[action.status as RunActionStatus].includes(status)) {
    throw new AgentCoreError(409, 'ACTION_TRANSITION_INVALID', `Cannot transition action from ${action.status} to ${status}`);
  }
  const result = input.result === undefined ? JSON.parse(action.result_json) : recordObject(input.result, 'result');
  const error = input.error === undefined ? JSON.parse(action.error_json) : recordObject(input.error, 'error');
  const timestamp = now();
  const startedAt = status === 'executing' && !action.started_at ? timestamp : action.started_at;
  const finishedAt = TERMINAL_ACTION_STATUSES.has(status) ? timestamp : null;
  db.transaction(() => {
    const updated = db.prepare(`
      UPDATE run_actions
      SET status = ?, result_json = ?, error_json = ?, started_at = ?, finished_at = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(status, stableJson(result), stableJson(error), startedAt, finishedAt, timestamp, actionId, action.status);
    if (updated.changes !== 1) throw new AgentCoreError(409, 'ACTION_TRANSITION_RACE', 'Action status changed concurrently');
    appendEvent(action.run_id, {
      category: status === 'failed' ? 'fact' : 'decision',
      eventType: `action.${status}`,
      actorType: 'agent',
      source: 'codex',
      conversationRef: action.conversation_ref,
      contextVersionId: action.context_version_id,
      payload: { actionId, stepId: action.step_id, actionType: action.action_type, result, error },
    });
  })();
  return serializeAction(db.prepare('SELECT * FROM run_actions WHERE id = ?').get(actionId));
}

export function listActions(runId: string, limit = 100): RunAction[] {
  getRun(runId);
  return (db.prepare('SELECT * FROM run_actions WHERE run_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(runId, Math.min(Math.max(limit, 1), 500)) as any[]).map(serializeAction);
}

export function getAction(actionId: string) {
  const action = serializeAction(getActionRow(actionId));
  const artifacts = (db.prepare('SELECT * FROM run_artifacts WHERE action_id = ? ORDER BY created_at')
    .all(actionId) as any[]).map(serializeArtifact);
  const evidenceChecks = (db.prepare('SELECT * FROM evidence_checks WHERE action_id = ? ORDER BY created_at')
    .all(actionId) as any[]).map(serializeEvidenceCheck);
  const remoteJob = db.prepare('SELECT * FROM remote_jobs WHERE action_id = ?').get(actionId) as any;
  return {
    ...action,
    artifacts,
    evidenceChecks,
    remoteJob: remoteJob ? {
      ...remoteJob,
      execution_manifest: JSON.parse(remoteJob.execution_manifest_json),
      resources: JSON.parse(remoteJob.resources_json),
      last_observation: JSON.parse(remoteJob.last_observation_json),
    } : null,
  };
}

export function getActionForExecution(actionId: string, allowedStatuses: RunActionStatus[] = ['authorized']): RunAction {
  const action = getActionRow(actionId);
  if (!allowedStatuses.includes(action.status)) {
    throw new AgentCoreError(409, 'ACTION_NOT_AUTHORIZED', `Action status ${action.status} cannot execute`);
  }
  const run = getRun(action.run_id);
  assertRunAcceptsNewAction(run);
  const context = assertCurrentContext(run, action.context_version_id);
  assertContextSourcesCurrent(run, context);
  return serializeAction(action);
}

export function getAuthorizedActionForExecution(actionId: string): RunAction {
  return getActionForExecution(actionId, ['authorized']);
}

export function registerArtifact(actionId: string, input: {
  location: unknown;
  path: unknown;
  category: unknown;
  idempotencyKey: unknown;
  remoteJobId?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
  metadata?: unknown;
}) {
  const action = getActionRow(actionId);
  const location = requiredText(input.location, 'location');
  if (!['local', 'remote'].includes(location)) throw new AgentCoreError(400, 'ARTIFACT_LOCATION_INVALID', 'location must be local or remote');
  const referencePath = normalizeReferencePath(input.path);
  const category = requiredText(input.category, 'category');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const metadata = input.metadata === undefined ? {} : recordObject(input.metadata, 'metadata');
  const remoteJobId = optionalText(input.remoteJobId);
  let sizeBytes: number;
  let artifactSha256: string;

  if (location === 'local') {
    const root = db.prepare(`
      SELECT projects.working_dir, tasks.task_root_rel
      FROM research_runs
      JOIN tasks ON tasks.id = research_runs.task_id
      JOIN projects ON projects.id = tasks.project_id
      WHERE research_runs.id = ?
    `).get(action.run_id) as { working_dir: string; task_root_rel: string | null } | undefined;
    if (!root?.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
    const taskRoot = resolveWithinRoot(root.working_dir, normalizeTaskRootRel(root.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
    const fullPath = resolveWithinRoot(taskRoot, referencePath, { mustExist: true, allowRoot: false, label: 'artifact path' });
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) throw new AgentCoreError(400, 'ARTIFACT_NOT_FILE', 'Local artifact must reference a file');
    sizeBytes = stat.size;
    artifactSha256 = sha256File(fullPath);
    if (input.sizeBytes !== undefined && input.sizeBytes !== sizeBytes) throw new AgentCoreError(409, 'ARTIFACT_SIZE_MISMATCH', 'Local artifact size does not match the observed file');
    if (input.sha256 !== undefined && String(input.sha256).toLowerCase() !== artifactSha256) throw new AgentCoreError(409, 'ARTIFACT_HASH_MISMATCH', 'Local artifact hash does not match the observed file');
  } else {
    if (!remoteJobId) throw new AgentCoreError(400, 'REMOTE_JOB_REQUIRED', 'Remote artifacts must reference a remote job');
    if (!Number.isSafeInteger(input.sizeBytes) || Number(input.sizeBytes) < 0) throw new AgentCoreError(400, 'ARTIFACT_SIZE_INVALID', 'Remote artifact sizeBytes must be a non-negative integer');
    sizeBytes = Number(input.sizeBytes);
    artifactSha256 = String(input.sha256 ?? '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(artifactSha256)) throw new AgentCoreError(400, 'ARTIFACT_HASH_INVALID', 'Remote artifact sha256 is required');
  }

  if (remoteJobId) {
    const job = db.prepare('SELECT run_id FROM remote_jobs WHERE id = ?').get(remoteJobId) as { run_id: string } | undefined;
    if (!job) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
    if (job.run_id !== action.run_id) throw new AgentCoreError(409, 'ARTIFACT_JOB_RUN_MISMATCH', 'Remote job belongs to a different run');
  }

  const existing = db.prepare('SELECT * FROM run_artifacts WHERE action_id = ? AND idempotency_key = ?')
    .get(actionId, idempotencyKey) as any;
  if (existing) {
    if (
      existing.location !== location
      || existing.path !== referencePath
      || existing.category !== category
      || existing.remote_job_id !== remoteJobId
      || existing.size_bytes !== sizeBytes
      || existing.sha256 !== artifactSha256
      || existing.metadata_json !== stableJson(metadata)
    ) throw new AgentCoreError(409, 'ARTIFACT_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different artifact');
    return serializeArtifact(existing);
  }

  const id = newId('artifact');
  const timestamp = now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO run_artifacts (
        id, run_id, context_version_id, action_id, remote_job_id, step_id,
        location, path, size_bytes, sha256, category, metadata_json,
        idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      action.run_id,
      action.context_version_id,
      actionId,
      remoteJobId,
      action.step_id,
      location,
      referencePath,
      sizeBytes,
      artifactSha256,
      category,
      stableJson(metadata),
      idempotencyKey,
      timestamp,
    );
    appendEvent(action.run_id, {
      category: 'fact',
      eventType: 'artifact.registered',
      actorType: 'agent',
      source: 'codex',
      conversationRef: action.conversation_ref,
      contextVersionId: action.context_version_id,
      payload: { artifactId: id, actionId, stepId: action.step_id, location, path: referencePath, sizeBytes, sha256: artifactSha256, category },
    });
  })();
  return serializeArtifact(db.prepare('SELECT * FROM run_artifacts WHERE id = ?').get(id));
}

export function listArtifacts(runId: string, limit = 100): RunArtifact[] {
  getRun(runId);
  return (db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(runId, Math.min(Math.max(limit, 1), 500)) as any[]).map(serializeArtifact);
}

export function listEvidenceLibrary(filters: {
  projectId?: string;
  taskId?: string;
  location?: string;
  checkStatus?: string;
  search?: string;
} = {}): EvidenceLibraryItem[] {
  if (filters.location && !['local', 'remote'].includes(filters.location)) {
    throw new AgentCoreError(400, 'ARTIFACT_LOCATION_INVALID', 'location must be local or remote');
  }
  if (filters.checkStatus && !['pass', 'warn', 'fail', 'unchecked'].includes(filters.checkStatus)) {
    throw new AgentCoreError(400, 'EVIDENCE_STATUS_INVALID', 'checkStatus must be pass, warn, fail or unchecked');
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.projectId) { conditions.push('projects.id = ?'); params.push(filters.projectId); }
  if (filters.taskId) { conditions.push('tasks.id = ?'); params.push(filters.taskId); }
  if (filters.location) { conditions.push('run_artifacts.location = ?'); params.push(filters.location); }
  if (filters.checkStatus === 'unchecked') {
    conditions.push('NOT EXISTS (SELECT 1 FROM evidence_checks WHERE evidence_checks.artifact_id = run_artifacts.id)');
  } else if (filters.checkStatus) {
    conditions.push('EXISTS (SELECT 1 FROM evidence_checks WHERE evidence_checks.artifact_id = run_artifacts.id AND evidence_checks.status = ?)');
    params.push(filters.checkStatus);
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push('(run_artifacts.path LIKE ? OR run_artifacts.category LIKE ? OR projects.name LIKE ? OR tasks.name LIKE ?)');
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = db.prepare(`
    SELECT
      run_artifacts.*,
      projects.id AS project_id,
      projects.name AS project_name,
      projects.working_dir,
      tasks.id AS task_id,
      tasks.name AS task_name,
      tasks.task_root_rel,
      research_runs.status AS run_status,
      run_actions.action_type,
      remote_jobs.status AS job_status
    FROM run_artifacts
    JOIN research_runs ON research_runs.id = run_artifacts.run_id
    JOIN tasks ON tasks.id = research_runs.task_id
    JOIN projects ON projects.id = tasks.project_id
    JOIN run_actions ON run_actions.id = run_artifacts.action_id
    LEFT JOIN remote_jobs ON remote_jobs.id = run_artifacts.remote_job_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY run_artifacts.created_at DESC
    LIMIT 500
  `).all(...params) as any[];

  const checksStatement = db.prepare('SELECT * FROM evidence_checks WHERE artifact_id = ? ORDER BY created_at DESC');
  return rows.map(row => {
    const {
      metadata_json,
      working_dir,
      task_root_rel,
      ...artifact
    } = row;
    let localAvailable: boolean | null = null;
    if (row.location === 'local') {
      try {
        if (!task_root_rel) throw new Error('Task root is unresolved');
        const taskRoot = resolveWithinRoot(working_dir, normalizeTaskRootRel(task_root_rel), {
          mustExist: true,
          allowRoot: false,
          label: 'task root',
        });
        const fullPath = resolveWithinRoot(taskRoot, row.path, {
          mustExist: false,
          allowRoot: false,
          label: 'artifact path',
        });
        localAvailable = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
      } catch {
        localAvailable = false;
      }
    }
    return {
      ...artifact,
      metadata: JSON.parse(metadata_json),
      local_available: localAvailable,
      checks: (checksStatement.all(row.id) as any[]).map(serializeEvidenceCheck),
    } as EvidenceLibraryItem;
  });
}

export function registerEvidenceCheck(actionId: string, input: {
  artifactId?: unknown;
  validatorName: unknown;
  validatorVersion: unknown;
  status: unknown;
  result: unknown;
  idempotencyKey: unknown;
}) {
  const action = getActionRow(actionId);
  const artifactId = optionalText(input.artifactId);
  if (artifactId) {
    const artifact = db.prepare('SELECT run_id, step_id FROM run_artifacts WHERE id = ?').get(artifactId) as { run_id: string; step_id: string } | undefined;
    if (!artifact) throw new AgentCoreError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found');
    if (artifact.run_id !== action.run_id || artifact.step_id !== action.step_id) {
      throw new AgentCoreError(409, 'EVIDENCE_ARTIFACT_MISMATCH', 'Evidence artifact belongs to a different run or workflow step');
    }
  }
  const validatorName = requiredText(input.validatorName, 'validatorName');
  const validatorVersion = requiredText(input.validatorVersion, 'validatorVersion');
  const status = requiredText(input.status, 'status');
  if (!['pass', 'warn', 'fail'].includes(status)) throw new AgentCoreError(400, 'EVIDENCE_STATUS_INVALID', 'Evidence status must be pass, warn or fail');
  const result = recordObject(input.result, 'result');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');

  const existing = db.prepare('SELECT * FROM evidence_checks WHERE action_id = ? AND idempotency_key = ?')
    .get(actionId, idempotencyKey) as any;
  if (existing) {
    if (
      existing.artifact_id !== artifactId
      || existing.validator_name !== validatorName
      || existing.validator_version !== validatorVersion
      || existing.status !== status
      || existing.result_json !== stableJson(result)
    ) throw new AgentCoreError(409, 'EVIDENCE_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different evidence result');
    return serializeEvidenceCheck(existing);
  }

  const id = newId('evidence');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO evidence_checks (
        id, run_id, context_version_id, action_id, artifact_id, step_id,
        validator_name, validator_version, status, result_json,
        idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      action.run_id,
      action.context_version_id,
      actionId,
      artifactId,
      action.step_id,
      validatorName,
      validatorVersion,
      status,
      stableJson(result),
      idempotencyKey,
      now(),
    );
    appendEvent(action.run_id, {
      category: 'fact',
      eventType: 'evidence.checked',
      actorType: 'agent',
      source: 'codex',
      conversationRef: action.conversation_ref,
      contextVersionId: action.context_version_id,
      payload: { evidenceCheckId: id, actionId, artifactId, stepId: action.step_id, validatorName, validatorVersion, status },
    });
  })();
  return serializeEvidenceCheck(db.prepare('SELECT * FROM evidence_checks WHERE id = ?').get(id));
}

export function listEvidenceChecks(runId: string, limit = 100): EvidenceCheck[] {
  getRun(runId);
  return (db.prepare('SELECT * FROM evidence_checks WHERE run_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(runId, Math.min(Math.max(limit, 1), 500)) as any[]).map(serializeEvidenceCheck);
}
