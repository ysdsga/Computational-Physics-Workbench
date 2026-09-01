import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStopHook } from '../.codex/hooks/workbench-monitor-stop.mjs';
import { nextJobCheck, normalizeJobMonitorPolicy } from '../server/services/monitorPolicy.js';
import { canConcludeUncertainSubmissionWasNotAccepted } from '../server/services/submissionReconciliation.js';
import fs from 'node:fs';

test('Stop Hook allows idle or monitored work and blocks an unattended active Run once', () => {
  assert.deepEqual(decideStopHook({}, { ok: true, unattendedRuns: [] }), { continue: true });
  const blocked = decideStopHook({}, { ok: false, unattendedRuns: [{ run_id: 'run-1' }] });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /Scheduled Task/);
  const secondPass = decideStopHook({ stop_hook_active: true }, { ok: false, unattendedRuns: [{ run_id: 'run-1' }] });
  assert.equal(secondPass.continue, true);
  assert.match(secondPass.systemMessage, /run-1/);
  const cleanup = decideStopHook({}, { ok: false, unattendedRuns: [], cleanupRequired: [{ run_id: 'run-terminal' }] });
  assert.equal(cleanup.decision, 'block');
  assert.match(cleanup.reason, /monitor close/);
});

test('Stop Hook fails open when Workbench is unavailable', () => {
  const result = decideStopHook({}, null, 'connection refused');
  assert.equal(result.continue, true);
  assert.match(result.systemMessage, /workbench doctor/i);
});

test('monitor timing follows the Agent-selected policy without busy polling', () => {
  const base = '2026-08-16T00:00:00.000Z';
  const policy = normalizeJobMonitorPolicy({ expectedRunMinutes: 240, firstCheckAfterMinutes: 20, runningCheckEveryMinutes: 45, pendingCheckEveryMinutes: 90, rationale: 'test policy' }, 480);
  assert.equal(nextJobCheck('PEND', 0, base, policy), '2026-08-16T00:20:00.000Z');
  assert.equal(nextJobCheck('PEND', 1, base, policy), '2026-08-16T01:30:00.000Z');
  assert.equal(nextJobCheck('RUN', 4, base, policy), '2026-08-16T00:45:00.000Z');
  assert.equal(nextJobCheck('DONE', 1, base, policy), null);
  assert.equal(nextJobCheck('submission_uncertain', 0, base, policy), base);
  assert.equal(nextJobCheck('submission_uncertain', 1, base, policy), '2026-08-16T00:01:00.000Z');
});

test('uncertain submission needs two empty reconciliations and a safety grace before it can be classified as not submitted', () => {
  const observedAt = '2026-08-16T00:10:00.000Z';
  const base = {
    status: 'submission_uncertain',
    job_id: null,
    created_at: '2026-08-16T00:00:00.000Z',
    submit_stderr: 'SSH_TIMEOUT: OpenSSH operation timed out',
    last_observation_json: JSON.stringify({ candidates: [], observedAt: '2026-08-16T00:08:00.000Z' }),
  };
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted(base, [], observedAt), true);
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted({ ...base, created_at: '2026-08-16T00:09:00.000Z' }, [], observedAt), false);
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted({ ...base, last_observation_json: JSON.stringify({ candidates: ['700'], observedAt: '2026-08-16T00:08:00.000Z' }) }, [], observedAt), false);
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted(base, ['700'], observedAt), false);
});

test('explicit scheduler no-match closes an old uncertain submission even when the original stderr was only a login banner', () => {
  const observedAt = '2026-08-16T00:10:00.000Z';
  const base = {
    status: 'submission_uncertain',
    job_id: null,
    created_at: '2026-08-16T00:00:00.000Z',
    submit_stderr: 'Welcome to the secure server. Unauthorized access is strictly prohibited',
    last_observation_json: JSON.stringify({ candidates: [], raw: 'No matching job found\n', observedAt: '2026-08-16T00:08:00.000Z' }),
  };
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted(base, [], observedAt), true);
  assert.equal(canConcludeUncertainSubmissionWasNotAccepted({ ...base, last_observation_json: JSON.stringify({ candidates: [], raw: '', observedAt: '2026-08-16T00:08:00.000Z' }) }, [], observedAt), false);
});

test('repo Stop Hook has a Windows command override and stays synchronous', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../.codex/hooks.json', import.meta.url), 'utf8'));
  const hook = config.hooks.Stop[0].hooks[0];
  assert.match(hook.command, /git rev-parse --show-toplevel/);
  assert.match(hook.commandWindows, /git rev-parse --show-toplevel/);
  assert.equal(hook.async, undefined);
});
