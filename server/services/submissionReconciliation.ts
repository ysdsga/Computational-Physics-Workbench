const UNCERTAIN_NO_MATCH_GRACE_MS = 5 * 60_000;
const UNCERTAIN_NO_MATCH_CONFIRMATION_MS = 60_000;

function jsonObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string' || !input.trim()) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function canConcludeUncertainSubmissionWasNotAccepted(row: Record<string, unknown>, candidateIds: string[], observedAtInput: string): boolean {
  if (candidateIds.length > 0 || row.job_id || String(row.status ?? '').toLowerCase() !== 'submission_uncertain') return false;
  const observedAt = new Date(observedAtInput).getTime();
  const createdAt = new Date(String(row.created_at ?? '')).getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(createdAt) || observedAt - createdAt < UNCERTAIN_NO_MATCH_GRACE_MS) return false;
  const previous = jsonObject(row.last_observation_json);
  const previousCandidates = Array.isArray(previous.candidates) ? previous.candidates : null;
  const previousObservedAt = new Date(String(previous.observedAt ?? '')).getTime();
  if (!previousCandidates || previousCandidates.length > 0 || !Number.isFinite(previousObservedAt) || observedAt - previousObservedAt < UNCERTAIN_NO_MATCH_CONFIRMATION_MS) return false;
  const previousSchedulerExplicitlyReportedNoMatch = /no\s+matching\s+job\s+found/i.test(String(previous.raw ?? ''));
  const transportDetail = `${String(row.submit_stderr ?? '')}\n${String(previous.code ?? '')}\n${String(previous.message ?? '')}`;
  return previousSchedulerExplicitlyReportedNoMatch || /(?:SSH_TIMEOUT|OPENSSH|timed?\s*out|connection|broken\s+pipe)/i.test(transportDetail);
}

export function uncertainNoMatchGraceMinutes(): number {
  return UNCERTAIN_NO_MATCH_GRACE_MS / 60_000;
}

export function reconciliationObservation(input: unknown): Record<string, unknown> {
  return jsonObject(input);
}
