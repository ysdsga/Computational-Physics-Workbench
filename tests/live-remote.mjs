const mode = process.argv[2];
const baseUrl = (process.env.WORKBENCH_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const taskId = process.env.WORKBENCH_TEST_TASK_ID;
const host = process.env.WORKBENCH_TEST_SSH_HOST;
const remoteRoot = process.env.WORKBENCH_TEST_REMOTE_ROOT;

if (!taskId || !host || !remoteRoot) {
  process.stdout.write('SKIP: set WORKBENCH_TEST_TASK_ID, WORKBENCH_TEST_SSH_HOST and WORKBENCH_TEST_REMOTE_ROOT for real pilot verification.\n');
  process.exit(0);
}

async function call(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(result)}`);
  return result;
}

if (mode === 'inspect') {
  const result = await call(`/api/agent/v1/remote/tasks/${encodeURIComponent(taskId)}/inspect`, { host, remoteRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (mode === 'smoke') {
  if (process.env.WORKBENCH_LIVE_SMOKE_CONFIRM !== '1') throw new Error('Set WORKBENCH_LIVE_SMOKE_CONFIRM=1 for the explicitly authorized real smoke job.');
  const result = await call(`/api/agent/v1/remote/tasks/${encodeURIComponent(taskId)}/submit-smoke`, { host, remoteRoot, queue: process.env.WORKBENCH_TEST_LSF_QUEUE || undefined, confirmed: true, idempotencyKey: process.env.WORKBENCH_TEST_IDEMPOTENCY_KEY ?? `live-smoke-${new Date().toISOString().slice(0, 10)}` });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  throw new Error('Expected inspect or smoke mode');
}
