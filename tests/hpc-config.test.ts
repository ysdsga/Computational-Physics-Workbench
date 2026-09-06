import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHpcConfig } from '../server/services/hpcConfig.js';

function profile(scheduler: string) {
  return {
    schemaVersion: 2,
    profiles: [{
      id: 'cluster',
      name: 'Research cluster',
      sshAlias: 'research-cluster',
      userRoot: '/home/researcher',
      projectRoot: '/home/researcher/project',
      scheduler,
    }],
    taskBindings: [],
  };
}

test('normalizes the supported LSF scheduler name', () => {
  const config = normalizeHpcConfig(profile('lsf'));
  assert.equal(config.profiles?.[0]?.scheduler, 'LSF');
});

test('rejects scheduler names without an implemented adapter', () => {
  assert.throws(
    () => normalizeHpcConfig(profile('Slurm')),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'HPC_SCHEDULER_UNSUPPORTED');
      return true;
    },
  );
});
