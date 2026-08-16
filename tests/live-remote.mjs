import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

function run(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin', 'workbench.js'), ...args, '--pretty'], { cwd: root, env: process.env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `workbench exited with ${result.status}`);
  process.stdout.write(result.stdout);
}

if (mode === 'prepare') {
  const runId = process.env.WORKBENCH_TEST_RUN_ID;
  const stageId = process.env.WORKBENCH_TEST_STAGE_ID;
  const specFile = process.env.WORKBENCH_TEST_SPEC_FILE;
  const capability = process.env.WORKBENCH_TEST_CAPABILITY;
  if (!runId || !stageId || !specFile || !capability) {
    process.stdout.write('SKIP: set WORKBENCH_TEST_RUN_ID, WORKBENCH_TEST_STAGE_ID, WORKBENCH_TEST_CAPABILITY and WORKBENCH_TEST_SPEC_FILE.\n');
    process.exit(0);
  }
  run(['action', 'prepare', '--run', runId, '--stage', stageId, '--capability', capability, '--spec-file', specFile, '--idempotency-key', process.env.WORKBENCH_TEST_IDEMPOTENCY_KEY ?? `live-${Date.now()}`, '--conversation-ref', process.env.WORKBENCH_TEST_CONVERSATION_REF ?? 'codex-task:live-verification']);
} else if (mode === 'execute') {
  const actionId = process.env.WORKBENCH_TEST_ACTION_ID;
  if (process.env.WORKBENCH_LIVE_ACTION_EXECUTE !== '1') throw new Error('Set WORKBENCH_LIVE_ACTION_EXECUTE=1 only after confirming the Run Envelope and reviewing this prepared Action.');
  if (!actionId) throw new Error('Execution requires WORKBENCH_TEST_ACTION_ID.');
  run(['action', 'execute', '--action', actionId]);
} else {
  throw new Error('Expected prepare or execute mode');
}
