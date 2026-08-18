import db from '../db.js';
import type { RunMonitor } from '../../src/types/index.js';
import { AgentCoreError, appendEvent, getRun, now } from './agentCore.js';
import {
  heartbeatLeaseForMonitor,
  nextJobCheck,
  normalizeJobMonitorPolicy,
  recommendedCadenceForStatus,
  TERMINAL_JOB_STATUSES,
  type JobMonitorPolicy,
} from './monitorPolicy.js';

export { nextJobCheck, TERMINAL_JOB_STATUSES } from './monitorPolicy.js';

type AutomationState = 'active' | 'paused' | 'missing' | 'deleted';

function activeJobCount(runId: string): number {
  const rows = db.prepare('SELECT status FROM remote_jobs WHERE run_id = ?').all(runId) as Array<{ status: string }>;
  return rows.filter(row => !TERMINAL_JOB_STATUSES.has(row.status.toLowerCase())).length;
}

function dueJobCount(runId: string, timestamp = now()): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM remote_jobs
    WHERE run_id = ? AND next_check_at IS NOT NULL AND next_check_at <= ?
      AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')`).get(runId, timestamp) as { count: number }).count);
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function policyForJob(row: { submission_spec_json?: string; resources_json?: string }): JobMonitorPolicy {
  const submission = parseJson(row.submission_spec_json);
  const resources = parseJson(row.resources_json);
  return normalizeJobMonitorPolicy(submission.monitoring, Number(resources.wallMinutes ?? 60));
}

function recommendedCadenceMinutes(runId: string): number | null {
  const rows = db.prepare(`SELECT status, submission_spec_json, resources_json FROM remote_jobs
    WHERE run_id = ? AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')`).all(runId) as Array<{ status: string; submission_spec_json: string; resources_json: string }>;
  const policies = rows.map(row => ({ row, policy: policyForJob(row) }));
  const values = policies.map(({ row, policy }) => recommendedCadenceForStatus(row.status, policy)).filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : null;
}

export function serializeMonitor(row: any): RunMonitor {
  return {
    ...row,
    active_job_count: activeJobCount(row.run_id),
    due_job_count: dueJobCount(row.run_id),
    recommended_cadence_minutes: recommendedCadenceMinutes(row.run_id),
    ...heartbeatLeaseForMonitor(row),
  } as RunMonitor;
}

export function getRunMonitor(runId: string): RunMonitor | null {
  getRun(runId);
  const row = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId);
  return row ? serializeMonitor(row) : null;
}

export function getMonitorAutomationDirective(runId: string) {
  const monitor = getRunMonitor(runId);
  if (!monitor) throw new AgentCoreError(404, 'MONITOR_NOT_FOUND', 'Run monitor not found');
  const cadence = monitor.recommended_cadence_minutes ?? monitor.cadence_minutes ?? 1;
  if ((monitor.active_job_count ?? 0) === 0) {
    return monitor.automation_ref
      ? { action: 'delete', automationRef: monitor.automation_ref, reason: 'all_jobs_terminal', acknowledgeWith: `workbench monitor close --run ${runId} --automation-ref ${monitor.automation_ref} --automation-state deleted` }
      : { action: 'none', reason: 'all_jobs_terminal_and_closed' };
  }
  if (!monitor.automation_ref) return { action: 'create', recommendedCadenceMinutes: cadence, nextCheckAt: monitor.next_check_at, reason: 'active_jobs_without_automation' };
  if (monitor.status !== 'scheduled' || monitor.heartbeat_fresh === false) return { action: 'resume', automationRef: monitor.automation_ref, recommendedCadenceMinutes: cadence, nextCheckAt: monitor.next_check_at, reason: monitor.status !== 'scheduled' ? 'automation_not_confirmed_active' : 'heartbeat_lease_stale' };
  if (monitor.cadence_minutes !== cadence) return { action: 'update', automationRef: monitor.automation_ref, recommendedCadenceMinutes: cadence, nextCheckAt: monitor.next_check_at, reason: 'job_scale_or_status_changed' };
  return { action: 'keep', automationRef: monitor.automation_ref, recommendedCadenceMinutes: cadence, nextCheckAt: monitor.next_check_at, reason: 'automation_active_and_current' };
}

export function ensureRunMonitorRequired(runId: string, nextCheckAt: string): RunMonitor {
  const timestamp = now();
  const existing = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!existing) {
    db.prepare(`INSERT INTO run_monitors (run_id, status, next_check_at, created_at, updated_at)
      VALUES (?, 'required', ?, ?, ?)`).run(runId, nextCheckAt, timestamp, timestamp);
  } else {
    const status = existing.status === 'complete' ? 'required' : existing.status;
    const earliest = !existing.next_check_at || nextCheckAt < existing.next_check_at ? nextCheckAt : existing.next_check_at;
    db.prepare('UPDATE run_monitors SET status = ?, next_check_at = ?, updated_at = ? WHERE run_id = ?')
      .run(status, earliest, timestamp, runId);
  }
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

function normalizeAutomationState(value: unknown): AutomationState {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!['active', 'paused', 'missing', 'deleted'].includes(state)) throw new AgentCoreError(400, 'MONITOR_AUTOMATION_STATE_INVALID', 'automationState must be active, paused, missing or deleted');
  return state as AutomationState;
}

function normalizeCadence(value: unknown): number {
  const cadenceMinutes = Number(value);
  if (!Number.isSafeInteger(cadenceMinutes) || cadenceMinutes < 1 || cadenceMinutes > 1440) throw new AgentCoreError(400, 'MONITOR_CADENCE_INVALID', 'cadenceMinutes must be an integer from 1 to 1440');
  return cadenceMinutes;
}

export function syncRunMonitorAutomation(runId: string, automationRefInput: unknown, automationStateInput: unknown, cadenceInput?: unknown): RunMonitor {
  getRun(runId);
  const automationRef = typeof automationRefInput === 'string' ? automationRefInput.trim() : '';
  if (!automationRef) throw new AgentCoreError(400, 'MONITOR_AUTOMATION_REF_REQUIRED', 'automationRef is required');
  const automationState = normalizeAutomationState(automationStateInput);
  if (automationState === 'deleted') throw new AgentCoreError(409, 'MONITOR_CLOSE_REQUIRED', 'Use monitor close after the automation has been deleted');
  const current = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!current) throw new AgentCoreError(409, 'MONITOR_NOT_REQUIRED', 'A monitor is created only after this Run has a recorded remote Job');
  if (current.automation_ref && current.automation_ref !== automationRef && ['scheduled', 'complete'].includes(current.status)) throw new AgentCoreError(409, 'MONITOR_ALREADY_ATTACHED', 'This Run already references a different Scheduled Task automation');
  const active = activeJobCount(runId);
  const timestamp = now();
  if (automationState === 'active') {
    if (active === 0) throw new AgentCoreError(409, 'MONITOR_NO_ACTIVE_JOBS', 'Do not activate an empty automation after all remote Jobs are terminal');
    const cadenceMinutes = normalizeCadence(cadenceInput);
    db.prepare("UPDATE run_monitors SET status = 'scheduled', automation_ref = ?, cadence_minutes = ?, updated_at = ? WHERE run_id = ?")
      .run(automationRef, cadenceMinutes, timestamp, runId);
  } else {
    const reference = automationState === 'missing' ? null : automationRef;
    db.prepare('UPDATE run_monitors SET status = ?, automation_ref = ?, cadence_minutes = NULL, updated_at = ? WHERE run_id = ?')
      .run(active === 0 ? 'complete' : 'required', reference, timestamp, runId);
  }
  appendEvent(runId, { category: 'fact', eventType: 'monitor.automation_observed', actorType: 'system', payload: { automationRef, automationState, cadenceMinutes: automationState === 'active' ? Number(cadenceInput) : null }, idempotencyKey: `monitor-automation:${automationRef}:${automationState}:${timestamp}` });
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function attachRunMonitor(runId: string, automationRefInput: unknown, cadenceInput: unknown, automationStateInput: unknown): RunMonitor {
  if (normalizeAutomationState(automationStateInput) !== 'active') throw new AgentCoreError(409, 'MONITOR_AUTOMATION_NOT_ACTIVE', 'The Codex automation must be ACTIVE before it can be attached');
  return syncRunMonitorAutomation(runId, automationRefInput, 'active', cadenceInput);
}

export function pauseRunMonitor(runId: string, automationRefInput: unknown, automationStateInput: unknown): RunMonitor {
  if (normalizeAutomationState(automationStateInput) !== 'paused') throw new AgentCoreError(409, 'MONITOR_AUTOMATION_NOT_PAUSED', 'Pause the Codex automation first, then report automationState=paused');
  return syncRunMonitorAutomation(runId, automationRefInput, 'paused');
}

export function closeRunMonitor(runId: string, automationRefInput: unknown, automationStateInput: unknown): RunMonitor {
  const automationRef = typeof automationRefInput === 'string' ? automationRefInput.trim() : '';
  const automationState = normalizeAutomationState(automationStateInput);
  if (!automationRef) throw new AgentCoreError(400, 'MONITOR_AUTOMATION_REF_REQUIRED', 'automationRef is required');
  if (!['deleted', 'missing'].includes(automationState)) throw new AgentCoreError(409, 'MONITOR_AUTOMATION_STILL_PRESENT', 'Delete the Codex automation before closing the Workbench monitor');
  const current = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!current) throw new AgentCoreError(404, 'MONITOR_NOT_FOUND', 'Run monitor not found');
  if (activeJobCount(runId) > 0) throw new AgentCoreError(409, 'MONITOR_ACTIVE_JOBS_REMAIN', 'Cannot close monitoring while remote Jobs are active');
  if (current.automation_ref !== automationRef) throw new AgentCoreError(409, 'MONITOR_AUTOMATION_REF_MISMATCH', 'Automation reference does not match the pending cleanup target');
  const timestamp = now();
  db.prepare("UPDATE run_monitors SET status = 'complete', automation_ref = NULL, cadence_minutes = NULL, next_check_at = NULL, updated_at = ? WHERE run_id = ?").run(timestamp, runId);
  appendEvent(runId, { category: 'fact', eventType: 'monitor.automation_deleted', actorType: 'system', payload: { automationRef, automationState }, idempotencyKey: `monitor-closed:${automationRef}` });
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function scheduleNewJob(runId: string, jobId: string, status: string, timestamp = now()): void {
  const row = db.prepare('SELECT submission_spec_json, resources_json FROM remote_jobs WHERE id = ?').get(jobId) as any;
  const nextCheckAt = nextJobCheck(status, 0, timestamp, policyForJob(row ?? {}));
  db.prepare('UPDATE remote_jobs SET next_check_at = ?, last_progress_at = ?, terminal_at = ? WHERE id = ?')
    .run(nextCheckAt, timestamp, nextCheckAt ? null : timestamp, jobId);
  if (nextCheckAt) ensureRunMonitorRequired(runId, nextCheckAt);
  else refreshRunMonitor(runId);
}

export function recordJobObservation(jobId: string, previousStatus: string, status: string, queueReason: string, observedAt: string): void {
  const row = db.prepare('SELECT run_id, poll_count, last_progress_at, submission_spec_json, resources_json FROM remote_jobs WHERE id = ?').get(jobId) as any;
  if (!row) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
  const changed = previousStatus.toLowerCase() !== status.toLowerCase();
  const pollCount = changed ? 1 : Number(row.poll_count ?? 0) + 1;
  const nextCheckAt = nextJobCheck(status, pollCount, observedAt, policyForJob(row));
  db.prepare('UPDATE remote_jobs SET next_check_at = ?, last_progress_at = ?, queue_reason = ?, poll_count = ?, terminal_at = ? WHERE id = ?')
    .run(nextCheckAt, changed || !row.last_progress_at ? observedAt : row.last_progress_at, queueReason, pollCount, nextCheckAt ? null : observedAt, jobId);
  refreshRunMonitor(row.run_id);
}

export function recordMonitorFailure(jobId: string, detail: Record<string, unknown>): void {
  const row = db.prepare('SELECT run_id, last_observation_json, submission_spec_json, resources_json FROM remote_jobs WHERE id = ?').get(jobId) as any;
  if (!row) return;
  const previous = parseJson(row.last_observation_json);
  const timestamp = now();
  const retryMinutes = policyForJob(row).runningCheckEveryMinutes;
  const nextCheckAt = new Date(new Date(timestamp).getTime() + retryMinutes * 60_000).toISOString();
  db.prepare('UPDATE remote_jobs SET last_observation_json = ?, next_check_at = ? WHERE id = ?')
    .run(JSON.stringify({ ...previous, monitorError: detail, observedAt: timestamp }), nextCheckAt, jobId);
  ensureRunMonitorRequired(row.run_id, nextCheckAt);
}

export function refreshRunMonitor(runId: string): RunMonitor | null {
  const current = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!current) return null;
  const active = activeJobCount(runId);
  const next = (db.prepare(`SELECT MIN(next_check_at) AS value FROM remote_jobs
    WHERE run_id = ? AND next_check_at IS NOT NULL
      AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')`).get(runId) as { value: string | null }).value;
  const status = active === 0 ? 'complete' : current.status === 'complete' ? 'required' : current.status;
  db.prepare('UPDATE run_monitors SET status = ?, next_check_at = ?, updated_at = ? WHERE run_id = ?')
    .run(status, next, now(), runId);
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function monitorGuard() {
  const activeJobs = db.prepare(`SELECT r.id AS run_id, r.task_id, COUNT(j.id) AS active_job_count,
      m.status AS monitor_status, m.automation_ref, m.cadence_minutes, m.next_check_at, m.updated_at
    FROM research_runs r
    JOIN remote_jobs j ON j.run_id = r.id
    LEFT JOIN run_monitors m ON m.run_id = r.id
    WHERE lower(j.status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')
    GROUP BY r.id, r.task_id, m.status, m.automation_ref, m.cadence_minutes, m.next_check_at, m.updated_at`).all() as any[];
  const enriched = activeJobs.map(item => ({ ...item, ...(item.updated_at ? heartbeatLeaseForMonitor({ status: item.monitor_status, ...item }) : { heartbeat_fresh: false, heartbeat_lease_expires_at: null }) }));
  const unattended = enriched.filter(item => item.monitor_status !== 'scheduled' || !item.automation_ref || item.heartbeat_fresh === false);
  const cleanupRequired = db.prepare(`SELECT m.run_id, r.task_id, m.automation_ref, m.status AS monitor_status
    FROM run_monitors m JOIN research_runs r ON r.id = m.run_id
    WHERE m.status = 'complete' AND m.automation_ref IS NOT NULL`).all();
  return { ok: unattended.length === 0 && cleanupRequired.length === 0, activeRuns: enriched, unattendedRuns: unattended, cleanupRequired };
}
