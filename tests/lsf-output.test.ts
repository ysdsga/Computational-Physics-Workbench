import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormattedSchedulerObservation, parseHistoryJobMatches, parseLegacyBhistObservation } from '../server/services/lsfOutput.js';

test('parses formatted bjobs output', () => {
  assert.deepEqual(parseFormattedSchedulerObservation('27778945 RUN wb-ecb2b0bf2fcd\n'), {
    jobId: '27778945', status: 'RUN', jobName: 'wb-ecb2b0bf2fcd',
  });
});

test('parses terminal state from legacy bhist long output', () => {
  const done = 'Job <27778945>, Job Name <wb-ecb2b0bf2fcd>, User <user>\nSun Aug 16 22:02:32 2026: Done successfully.';
  assert.deepEqual(parseLegacyBhistObservation(done), {
    jobId: '27778945', status: 'DONE', jobName: 'wb-ecb2b0bf2fcd',
  });
  const exited = 'Job <42>, Job Name <wb-failed>, User <user>\nExited with exit code 1.';
  assert.equal(parseLegacyBhistObservation(exited).status, 'EXIT');
});

test('finds unique job ids in legacy bhist summary output', () => {
  const summary = [
    'JOBID USER JOB_NAME PEND PSUSP RUN USUSP SSUSP UNKWN TOTAL',
    '27778945 user wb-ecb2b0bf2fcd 1 0 1362 0 0 0 1363',
    '27778946 user another-job 1 0 20 0 0 0 21',
  ].join('\n');
  assert.deepEqual(parseHistoryJobMatches(summary, 'wb-ecb2b0bf2fcd'), ['27778945']);
});
