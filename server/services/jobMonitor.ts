import db from '../db.js';
import { AgentCoreError, getRun, now } from './agentCore.js';
import { reconcileJob } from './remote.js';
import { getRunMonitor, recordMonitorFailure, refreshRunMonitor, TERMINAL_JOB_STATUSES } from './monitorStore.js';

export async function tickRunMonitor(runId: string) {
  getRun(runId);
  const monitor = getRunMonitor(runId);
  if (!monitor) throw new AgentCoreError(404, 'MONITOR_NOT_FOUND', 'Run monitor not found');
  const timestamp = now();
  const due = (db.prepare(`SELECT id, status FROM remote_jobs
    WHERE run_id = ? AND next_check_at IS NOT NULL AND next_check_at <= ?
      AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')
    ORDER BY next_check_at, created_at`).all(runId, timestamp) as Array<{ id: string; status: string }>);
  const results: Array<Record<string, unknown>> = [];
  for (const item of due) {
    try {
      const job = await reconcileJob(item.id);
      results.push({ remoteJobId: item.id, previousStatus: item.status, status: job.status, changed: item.status !== job.status, nextCheckAt: job.next_check_at });
    } catch (error) {
      const problem = error as Error & { code?: string };
      recordMonitorFailure(item.id, { code: problem.code ?? 'MONITOR_CHECK_FAILED', message: problem.message });
      results.push({ remoteJobId: item.id, previousStatus: item.status, error: { code: problem.code ?? 'MONITOR_CHECK_FAILED', message: problem.message } });
    }
  }
  const updated = refreshRunMonitor(runId);
  const activeJobs = (db.prepare('SELECT status FROM remote_jobs WHERE run_id = ?').all(runId) as Array<{ status: string }>)
    .filter(item => !TERMINAL_JOB_STATUSES.has(item.status.toLowerCase())).length;
  return { runId, checkedAt: timestamp, checkedJobs: due.length, activeJobs, stateChanges: results, monitor: updated };
}
