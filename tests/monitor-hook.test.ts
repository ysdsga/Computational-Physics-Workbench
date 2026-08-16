import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStopHook } from '../.codex/hooks/workbench-monitor-stop.mjs';
import { nextJobCheck } from '../server/services/monitorPolicy.js';
import fs from 'node:fs';

test('Stop Hook allows idle or monitored work and blocks an unattended active Run once', () => {
  assert.deepEqual(decideStopHook({}, { ok: true, unattendedRuns: [] }), { continue: true });
  const blocked = decideStopHook({}, { ok: false, unattendedRuns: [{ run_id: 'run-1' }] });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /Scheduled Task/);
  const secondPass = decideStopHook({ stop_hook_active: true }, { ok: false, unattendedRuns: [{ run_id: 'run-1' }] });
  assert.equal(secondPass.continue, true);
  assert.match(secondPass.systemMessage, /run-1/);
});

test('Stop Hook fails open when Workbench is unavailable', () => {
  const result = decideStopHook({}, null, 'connection refused');
  assert.equal(result.continue, true);
  assert.match(result.systemMessage, /workbench doctor/i);
});

test('monitor timing backs off PEND and checks RUN without busy polling', () => {
  const base = '2026-08-16T00:00:00.000Z';
  assert.equal(nextJobCheck('PEND', 0, base), '2026-08-16T00:10:00.000Z');
  assert.equal(nextJobCheck('PEND', 1, base), '2026-08-16T00:30:00.000Z');
  assert.equal(nextJobCheck('PEND', 3, base), '2026-08-16T01:00:00.000Z');
  assert.equal(nextJobCheck('RUN', 4, base), '2026-08-16T00:15:00.000Z');
  assert.equal(nextJobCheck('DONE', 1, base), null);
  assert.equal(nextJobCheck('submission_uncertain', 1, base), base);
});

test('repo Stop Hook has a Windows command override and stays synchronous', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../.codex/hooks.json', import.meta.url), 'utf8'));
  const hook = config.hooks.Stop[0].hooks[0];
  assert.match(hook.command, /git rev-parse --show-toplevel/);
  assert.match(hook.commandWindows, /git rev-parse --show-toplevel/);
  assert.equal(hook.async, undefined);
});
