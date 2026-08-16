export const TERMINAL_JOB_STATUSES = new Set([
  'done', 'exit', 'zombi', 'unkwn', 'preparation_failed', 'cancelled',
]);

function afterMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString();
}

export function nextJobCheck(statusInput: string, pollCount: number, timestamp: string): string | null {
  const status = statusInput.toLowerCase();
  if (TERMINAL_JOB_STATUSES.has(status)) return null;
  if (status === 'submission_uncertain' || status === 'prepared' || status === 'recovered') return timestamp;
  if (status === 'pend') return afterMinutes(timestamp, pollCount <= 0 ? 10 : pollCount <= 2 ? 30 : 60);
  if (status === 'run') return afterMinutes(timestamp, 15);
  return afterMinutes(timestamp, 15);
}
