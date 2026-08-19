import { AgentCoreError } from './agentError.js';

export const TERMINAL_JOB_STATUSES = new Set([
  'done', 'exit', 'zombi', 'unkwn', 'preparation_failed', 'cancelled',
]);

export interface JobMonitorPolicy {
  expectedRunMinutes: number;
  firstCheckAfterMinutes: number;
  runningCheckEveryMinutes: number;
  pendingCheckEveryMinutes: number;
  rationale: string;
  source: 'agent' | 'derived';
}

export interface MonitorHeartbeatRow {
  status: string;
  automation_ref?: string | null;
  cadence_minutes?: number | null;
  updated_at: string;
}

const MAX_MONITOR_MINUTES = 7 * 24 * 60;

function positiveInteger(value: unknown, fallback: number, maximum = MAX_MONITOR_MINUTES): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function derivedPolicy(wallMinutesInput: number): JobMonitorPolicy {
  const wallMinutes = positiveInteger(wallMinutesInput, 60, MAX_MONITOR_MINUTES);
  const expectedRunMinutes = Math.max(1, Math.ceil(wallMinutes / 2));
  return {
    expectedRunMinutes,
    firstCheckAfterMinutes: Math.max(1, Math.min(120, Math.ceil(expectedRunMinutes / 3))),
    runningCheckEveryMinutes: Math.max(1, Math.min(120, Math.ceil(expectedRunMinutes / 4))),
    pendingCheckEveryMinutes: Math.max(2, Math.min(180, Math.ceil(expectedRunMinutes / 2))),
    rationale: 'Derived from the submitted wall-time because the Agent did not provide an estimate.',
    source: 'derived',
  };
}

export function normalizeJobMonitorPolicy(input: unknown, wallMinutes: number): JobMonitorPolicy {
  const fallback = derivedPolicy(wallMinutes);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const value = input as Record<string, unknown>;
  const requiredInteger = (key: string, maximum = MAX_MONITOR_MINUTES) => {
    const parsed = Number(value[key]);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new AgentCoreError(400, 'MONITOR_POLICY_INVALID', `${key} must be a positive integer not greater than ${maximum}`);
    return parsed;
  };
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new AgentCoreError(400, 'MONITOR_POLICY_INVALID', 'monitoring.rationale is required');
  return {
    expectedRunMinutes: requiredInteger('expectedRunMinutes'),
    firstCheckAfterMinutes: requiredInteger('firstCheckAfterMinutes', 1440),
    runningCheckEveryMinutes: requiredInteger('runningCheckEveryMinutes', 1440),
    pendingCheckEveryMinutes: requiredInteger('pendingCheckEveryMinutes', 1440),
    rationale: value.rationale.trim(),
    source: 'agent',
  };
}

function afterMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString();
}

export function recommendedCadenceForStatus(statusInput: string, policy: JobMonitorPolicy): number | null {
  const status = statusInput.toLowerCase();
  if (TERMINAL_JOB_STATUSES.has(status)) return null;
  if (status === 'submission_uncertain' || status === 'prepared' || status === 'recovered') return 1;
  if (status === 'pend') return policy.pendingCheckEveryMinutes;
  return policy.runningCheckEveryMinutes;
}

export function heartbeatLeaseForMonitor(row: MonitorHeartbeatRow, currentMs = Date.now()) {
  if (row.status !== 'scheduled' || !row.automation_ref || !row.cadence_minutes) {
    return { heartbeat_fresh: false, heartbeat_lease_expires_at: null };
  }
  const updated = new Date(row.updated_at).getTime();
  const leaseMinutes = Math.max(15, Number(row.cadence_minutes) * 3);
  const expires = new Date(updated + leaseMinutes * 60_000);
  return {
    heartbeat_fresh: Number.isFinite(updated) && expires.getTime() >= currentMs,
    heartbeat_lease_expires_at: Number.isFinite(updated) ? expires.toISOString() : null,
  };
}

export function nextJobCheck(statusInput: string, pollCount: number, timestamp: string, policy = derivedPolicy(60)): string | null {
  const status = statusInput.toLowerCase();
  if (TERMINAL_JOB_STATUSES.has(status)) return null;
  if (status === 'submission_uncertain') return pollCount <= 0 ? timestamp : afterMinutes(timestamp, 1);
  if (status === 'prepared' || status === 'recovered') return timestamp;
  if (pollCount <= 0) return afterMinutes(timestamp, policy.firstCheckAfterMinutes);
  if (status === 'pend') return afterMinutes(timestamp, policy.pendingCheckEveryMinutes);
  return afterMinutes(timestamp, policy.runningCheckEveryMinutes);
}
