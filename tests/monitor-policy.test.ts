import assert from 'node:assert/strict';
import test from 'node:test';
import { nextJobCheck, normalizeJobMonitorPolicy, recommendedCadenceForStatus } from '../server/services/monitorPolicy.js';

test('Agent-selected monitoring distinguishes short and long Jobs', () => {
  const short = normalizeJobMonitorPolicy({
    expectedRunMinutes: 3,
    firstCheckAfterMinutes: 2,
    runningCheckEveryMinutes: 1,
    pendingCheckEveryMinutes: 2,
    rationale: 'small diagnostic',
  }, 10);
  const long = normalizeJobMonitorPolicy({
    expectedRunMinutes: 1800,
    firstCheckAfterMinutes: 90,
    runningCheckEveryMinutes: 120,
    pendingCheckEveryMinutes: 240,
    rationale: 'large production calculation',
  }, 2880);

  const startedAt = '2026-08-17T00:00:00.000Z';
  assert.equal(nextJobCheck('run', 0, startedAt, short), '2026-08-17T00:02:00.000Z');
  assert.equal(nextJobCheck('run', 1, startedAt, short), '2026-08-17T00:01:00.000Z');
  assert.equal(nextJobCheck('run', 0, startedAt, long), '2026-08-17T01:30:00.000Z');
  assert.equal(nextJobCheck('pend', 1, startedAt, long), '2026-08-17T04:00:00.000Z');
  assert.equal(recommendedCadenceForStatus('run', short), 1);
  assert.equal(recommendedCadenceForStatus('pend', long), 240);
});

test('legacy Job monitoring derives bounded cadence from wall-time', () => {
  const short = normalizeJobMonitorPolicy(undefined, 6);
  const long = normalizeJobMonitorPolicy(undefined, 2880);
  assert.equal(short.source, 'derived');
  assert.equal(long.source, 'derived');
  assert.ok(short.firstCheckAfterMinutes < long.firstCheckAfterMinutes);
  assert.ok(short.runningCheckEveryMinutes < long.runningCheckEveryMinutes);
  assert.ok(long.runningCheckEveryMinutes <= 120);
});
