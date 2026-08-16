import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const runId = process.env.WORKBENCH_TEST_RUN_ID;
const contextVersionId = process.env.WORKBENCH_TEST_CONTEXT_VERSION_ID;
const stepId = process.env.WORKBENCH_TEST_STEP_ID;

function run(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin', 'workbench.js'), ...args, '--pretty'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `workbench exited with ${result.status}`);
  process.stdout.write(result.stdout);
}

if (mode === 'prepare') {
  const specFile = process.env.WORKBENCH_TEST_SPEC_FILE;
  const capability = process.env.WORKBENCH_TEST_CAPABILITY;
  if (!runId || !contextVersionId || !stepId || !specFile || !capability) {
    process.stdout.write('SKIP: set WORKBENCH_TEST_RUN_ID, WORKBENCH_TEST_CONTEXT_VERSION_ID, WORKBENCH_TEST_STEP_ID, WORKBENCH_TEST_CAPABILITY and WORKBENCH_TEST_SPEC_FILE.\n');
    process.exit(0);
  }
  run([
    'action', 'prepare', '--run', runId, '--context-version', contextVersionId,
    '--step', stepId, '--capability', capability, '--spec-file', specFile,
    '--idempotency-key', process.env.WORKBENCH_TEST_IDEMPOTENCY_KEY ?? `live-${Date.now()}`,
    '--conversation-ref', process.env.WORKBENCH_TEST_CONVERSATION_REF ?? 'codex-task:live-verification',
  ]);
} else if (mode === 'execute') {
  const actionId = process.env.WORKBENCH_TEST_ACTION_ID;
  const manifestSha256 = process.env.WORKBENCH_TEST_MANIFEST_SHA256;
  const summary = process.env.WORKBENCH_TEST_AUTHORIZATION_SUMMARY;
  if (process.env.WORKBENCH_LIVE_ACTION_CONFIRM !== '1') {
    throw new Error('Set WORKBENCH_LIVE_ACTION_CONFIRM=1 only after the researcher confirms the exact manifest.');
  }
  if (!actionId || !contextVersionId || !manifestSha256 || !summary) {
    throw new Error('Execution requires WORKBENCH_TEST_ACTION_ID, WORKBENCH_TEST_CONTEXT_VERSION_ID, WORKBENCH_TEST_MANIFEST_SHA256 and WORKBENCH_TEST_AUTHORIZATION_SUMMARY.');
  }
  run([
    'action', 'authorize', '--action', actionId, '--context-version', contextVersionId,
    '--manifest-sha', manifestSha256, '--summary', summary,
    '--conversation-ref', process.env.WORKBENCH_TEST_CONVERSATION_REF ?? 'codex-task:live-verification',
  ]);
  run(['action', 'execute', '--action', actionId]);
} else {
  throw new Error('Expected prepare or execute mode');
}
