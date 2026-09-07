import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-hpc-config-'));
process.env.WORKBENCH_DB_PATH = path.join(tempRoot, 'test.db');
const { normalizeHpcConfig } = await import('../server/services/hpcConfig.js');

after(async () => {
  const { closeDb } = await import('../server/db.js');
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

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
