import db from '../db.js';
import type { RunMonitor } from '../../src/types/index.js';
import { AgentCoreError, getRun, now } from './agentCore.js';
import { nextJobCheck, TERMINAL_JOB_STATUSES } from './monitorPolicy.js';

export { nextJobCheck, TERMINAL_JOB_STATUSES } from './monitorPolicy.js';

function activeJobCount(runId: string): number {
  const rows = db.prepare('SELECT status FROM remote_jobs WHERE run_id = ?').all(runId) as Array<{ status: string }>;
  return rows.filter(row => !TERMINAL_JOB_STATUSES.has(row.status.toLowerCase())).length;
}

function dueJobCount(runId: string, timestamp = now()): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM remote_jobs
    WHERE run_id = ? AND next_check_at IS NOT NULL AND next_check_at <= ?
      AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')`).get(runId, timestamp) as { count: number }).count);
}

export function serializeMonitor(row: any): RunMonitor {
  return {
    ...row,
    active_job_count: activeJobCount(row.run_id),
    due_job_count: dueJobCount(row.run_id),
  } as RunMonitor;
}

export function getRunMonitor(runId: string): RunMonitor | null {
  getRun(runId);
  const row = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId);
  return row ? serializeMonitor(row) : null;
}

export function ensureRunMonitorRequired(runId: string, nextCheckAt: string): RunMonitor {
  const timestamp = now();
  const existing = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!existing) {
    db.prepare(`INSERT INTO run_monitors (run_id, status, next_check_at, created_at, updated_at)
      VALUES (?, 'required', ?, ?, ?)`).run(runId, nextCheckAt, timestamp, timestamp);
  } else {
    const status = existing.status === 'complete' ? 'required' : existing.status;
    const automationRef = existing.status === 'complete' ? null : existing.automation_ref;
    const cadence = existing.status === 'complete' ? null : existing.cadence_minutes;
    const earliest = !existing.next_check_at || nextCheckAt < existing.next_check_at ? nextCheckAt : existing.next_check_at;
    db.prepare(`UPDATE run_monitors SET status = ?, automation_ref = ?, cadence_minutes = ?, next_check_at = ?, updated_at = ? WHERE run_id = ?`)
      .run(status, automationRef, cadence, earliest, timestamp, runId);
  }
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function attachRunMonitor(runId: string, automationRefInput: unknown, cadenceInput: unknown): RunMonitor {
  getRun(runId);
  const automationRef = typeof automationRefInput === 'string' ? automationRefInput.trim() : '';
  const cadenceMinutes = Number(cadenceInput);
  if (!automationRef) throw new AgentCoreError(400, 'MONITOR_AUTOMATION_REF_REQUIRED', 'automationRef is required');
  if (!Number.isSafeInteger(cadenceMinutes) || cadenceMinutes < 1 || cadenceMinutes > 1440) throw new AgentCoreError(400, 'MONITOR_CADENCE_INVALID', 'cadenceMinutes must be an integer from 1 to 1440');
  const current = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!current) throw new AgentCoreError(409, 'MONITOR_NOT_REQUIRED', 'A monitor is created only after this Run has a recorded remote Job');
  if (activeJobCount(runId) === 0) throw new AgentCoreError(409, 'MONITOR_NO_ACTIVE_JOBS', 'Do not attach an empty Scheduled Task after all remote Jobs are terminal');
  if (current.automation_ref && current.automation_ref !== automationRef && current.status === 'scheduled') throw new AgentCoreError(409, 'MONITOR_ALREADY_ATTACHED', 'This Run already has a different Scheduled Task monitor');
  const timestamp = now();
  db.prepare("UPDATE run_monitors SET status = 'scheduled', automation_ref = ?, cadence_minutes = ?, updated_at = ? WHERE run_id = ?")
    .run(automationRef, cadenceMinutes, timestamp, runId);
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function pauseRunMonitor(runId: string): RunMonitor {
  const current = db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId) as any;
  if (!current) throw new AgentCoreError(404, 'MONITOR_NOT_FOUND', 'Run monitor not found');
  db.prepare("UPDATE run_monitors SET status = 'paused', updated_at = ? WHERE run_id = ?").run(now(), runId);
  return serializeMonitor(db.prepare('SELECT * FROM run_monitors WHERE run_id = ?').get(runId));
}

export function scheduleNewJob(runId: string, jobId: string, status: string, timestamp = now()): void {
  const nextCheckAt = nextJobCheck(status, 0, timestamp);
  db.prepare('UPDATE remote_jobs SET next_check_at = ?, last_progress_at = ?, terminal_at = ? WHERE id = ?')
    .run(nextCheckAt, timestamp, nextCheckAt ? null : timestamp, jobId);
  if (nextCheckAt) ensureRunMonitorRequired(runId, nextCheckAt);
  else refreshRunMonitor(runId);
}

export function recordJobObservation(jobId: string, previousStatus: string, status: string, queueReason: string, observedAt: string): void {
  const row = db.prepare('SELECT run_id, poll_count, last_progress_at FROM remote_jobs WHERE id = ?').get(jobId) as any;
  if (!row) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
  const changed = previousStatus.toLowerCase() !== status.toLowerCase();
  const pollCount = changed ? 1 : Number(row.poll_count ?? 0) + 1;
  const nextCheckAt = nextJobCheck(status, pollCount, observedAt);
  db.prepare(`UPDATE remote_jobs SET next_check_at = ?, last_progress_at = ?, queue_reason = ?, poll_count = ?, terminal_at = ? WHERE id = ?`)
    .run(nextCheckAt, changed || !row.last_progress_at ? observedAt : row.last_progress_at, queueReason, pollCount, nextCheckAt ? null : observedAt, jobId);
  refreshRunMonitor(row.run_id);
}

export function recordMonitorFailure(jobId: string, detail: Record<string, unknown>): void {
  const row = db.prepare('SELECT run_id, last_observation_json FROM remote_jobs WHERE id = ?').get(jobId) as any;
  if (!row) return;
  let previous: Record<string, unknown> = {};
  try { previous = JSON.parse(row.last_observation_json); } catch { /* keep the new failure */ }
  const timestamp = now();
  const nextCheckAt = new Date(new Date(timestamp).getTime() + 10 * 60_000).toISOString();
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
      m.status AS monitor_status, m.automation_ref, m.next_check_at
    FROM research_runs r
    JOIN remote_jobs j ON j.run_id = r.id
    LEFT JOIN run_monitors m ON m.run_id = r.id
    WHERE lower(j.status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')
    GROUP BY r.id, r.task_id, m.status, m.automation_ref, m.next_check_at`).all() as any[];
  const unattended = activeJobs.filter(item => item.monitor_status !== 'scheduled' || !item.automation_ref);
  return { ok: unattended.length === 0, activeRuns: activeJobs, unattendedRuns: unattended };
}
