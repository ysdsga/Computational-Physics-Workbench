#!/usr/bin/env node
import fs from 'node:fs';

const EXIT = { ok: 0, usage: 2, api: 3, blocked: 4, transport: 5 };

function parse(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags[rawKey] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags[rawKey] = argv[++index];
    else flags[rawKey] = true;
  }
  return { positionals, flags };
}

const { positionals, flags } = parse(process.argv.slice(2));
const baseUrl = String(process.env.WORKBENCH_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

function usage(message, exitCode = EXIT.usage) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`workbench — DFT+DMFT Agent research environment V1\n\nCommands:\n  doctor\n  context --task <id>\n  run start --task <id> --plan <id> [--idempotency-key <key>]\n  run show --run <id>\n  run revise --run <id> --plan-file <path> --contract-file <path> --context-version <id> --reason <text>\n  run terminate --run <id> --reason <text>\n  event append --run <id> --category <fact|inference|decision> --type <name> --actor <agent|researcher|system> [--payload-file <json>]\n  review request --run <id> --gate <name> --question <text>\n  review list [--run <id>]\n  review decide --request <id> --decision <approve|reject|supplement|terminate> [--comment <text>]\n  policy list [--scope-type <type>] [--scope-id <id>]\n  policy create --scope-type <type> [--scope-id <id>] --file <json> [--activate]\n  policy activate --policy <id>\n  contract show|initialize --plan <id>\n  contract update --plan <id> --file <yaml> [--expected-plan-sha <sha>]\n  remote inspect|upload|download|submit-smoke|status|logs|cancel|reconcile ...\n\nJSON is the default output. Use --pretty for indented JSON.\n`);
  process.exit(exitCode);
}

function required(name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) usage(`Missing --${name}`);
  return value;
}

function readText(name) { return fs.readFileSync(required(name), 'utf8'); }
function readJson(name) { return JSON.parse(readText(name)); }

async function request(method, pathname, body) {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const wrapped = new Error(`Cannot reach Workbench at ${baseUrl}: ${error.message}`);
    wrapped.exitCode = EXIT.transport;
    throw wrapped;
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) {
    const error = new Error(payload.error ?? `HTTP ${response.status}`);
    error.payload = payload;
    error.exitCode = ['RUN_NOT_STARTED', 'TASK_ROOT_UNRESOLVED', 'CONTRACT_MISSING', 'PLAN_CONTRACT_DRIFT'].includes(payload.code) ? EXIT.blocked : EXIT.api;
    throw error;
  }
  return { payload, status: response.status };
}

async function main() {
  const [group, action] = positionals;
  if (!group && (flags.help || flags.h)) usage(undefined, EXIT.ok);
  if (!group) usage();
  if (group === 'doctor') {
    const started = Date.now();
    const result = await request('GET', '/api/projects');
    return { ok: true, baseUrl, latencyMs: Date.now() - started, projectCount: Array.isArray(result.payload) ? result.payload.length : null };
  }
  if (group === 'context') {
    const result = (await request('GET', `/api/agent/v1/context/tasks/${encodeURIComponent(required('task'))}`)).payload;
    if (Array.isArray(result.blockers) && result.blockers.length && flags['allow-blocked'] !== true) {
      const error = new Error('Context contains blockers'); error.payload = result; error.exitCode = EXIT.blocked; throw error;
    }
    return result;
  }
  if (group === 'run') {
    if (action === 'start') return (await request('POST', '/api/agent/v1/runs', { taskId: required('task'), researchPlanId: required('plan'), idempotencyKey: flags['idempotency-key'] })).payload;
    if (action === 'show') return (await request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}`)).payload;
    if (action === 'revise') {
      const result = await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/revise`, { planContent: readText('plan-file'), contractContent: readText('contract-file'), expectedContextVersionId: required('context-version'), reason: required('reason'), idempotencyKey: flags['idempotency-key'] });
      if (result.status === 202) { const error = new Error('Revision requires review'); error.payload = result.payload; error.exitCode = EXIT.blocked; throw error; }
      return result.payload;
    }
    if (action === 'terminate') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/terminate`, { reason: required('reason') })).payload;
  }
  if (group === 'event' && action === 'append') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/events`, { category: required('category'), eventType: required('type'), actorType: required('actor'), payload: flags['payload-file'] ? readJson('payload-file') : {}, idempotencyKey: flags['idempotency-key'] })).payload;
  if (group === 'review') {
    if (action === 'list') return (await request('GET', `/api/agent/v1/reviews${flags.run ? `?runId=${encodeURIComponent(flags.run)}` : ''}`)).payload;
    if (action === 'request') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/reviews`, { gateType: required('gate'), question: required('question'), idempotencyKey: flags['idempotency-key'] })).payload;
    if (action === 'decide') return (await request('POST', `/api/agent/v1/reviews/${encodeURIComponent(required('request'))}/decisions`, { decision: required('decision'), comment: flags.comment ?? '' })).payload;
  }
  if (group === 'policy') {
    if (action === 'list') {
      const query = new URLSearchParams();
      if (flags['scope-type']) query.set('scopeType', flags['scope-type']);
      if (flags['scope-id']) query.set('scopeId', flags['scope-id']);
      return (await request('GET', `/api/agent/v1/policies${query.size ? `?${query}` : ''}`)).payload;
    }
    if (action === 'create') return (await request('POST', '/api/agent/v1/policies', { scopeType: required('scope-type'), scopeId: flags['scope-id'] ?? null, policy: readJson('file'), activate: flags.activate === true })).payload;
    if (action === 'activate') return (await request('POST', `/api/agent/v1/policies/${encodeURIComponent(required('policy'))}/activate`, {})).payload;
  }
  if (group === 'contract') {
    const plan = encodeURIComponent(required('plan'));
    if (action === 'show') return (await request('GET', `/api/research-plans/${plan}/contract`)).payload;
    if (action === 'initialize') return (await request('POST', `/api/research-plans/${plan}/contract/initialize`, { overwrite: flags.overwrite === true })).payload;
    if (action === 'update') return (await request('PUT', `/api/research-plans/${plan}/contract`, { content: readText('file'), expectedPlanSha256: flags['expected-plan-sha'] })).payload;
  }
  if (group === 'remote') {
    if (['inspect', 'upload', 'download', 'submit-smoke'].includes(action)) {
      const task = encodeURIComponent(required('task'));
      if (action === 'inspect') return (await request('POST', `/api/agent/v1/remote/tasks/${task}/inspect`, { host: required('host'), remoteRoot: required('remote-root') })).payload;
      if (action === 'upload') return (await request('POST', `/api/agent/v1/remote/tasks/${task}/upload`, { host: required('host'), remoteRoot: required('remote-root'), localPath: required('local-path'), remotePath: required('remote-path'), overwrite: flags.overwrite === true })).payload;
      if (action === 'download') return (await request('POST', `/api/agent/v1/remote/tasks/${task}/download`, { host: required('host'), remoteRoot: required('remote-root'), localPath: required('local-path'), remotePath: required('remote-path'), overwrite: flags.overwrite === true })).payload;
      if (action === 'submit-smoke') {
        const result = (await request('POST', `/api/agent/v1/remote/tasks/${task}/submit-smoke`, { host: required('host'), remoteRoot: required('remote-root'), queue: flags.queue, confirmed: flags.confirm === true, idempotencyKey: required('idempotency-key') })).payload;
        if (result.status === 'submission_uncertain') { const error = new Error('Submission is uncertain'); error.payload = result; error.exitCode = EXIT.blocked; throw error; }
        return result;
      }
    }
    if (['status', 'logs', 'cancel', 'reconcile'].includes(action)) return (await request('POST', `/api/agent/v1/remote/jobs/${encodeURIComponent(required('job'))}/${action}`, {})).payload;
  }
  usage(`Unknown command: ${positionals.join(' ')}`);
}

try {
  const output = await main();
  process.stdout.write(`${JSON.stringify(output, null, flags.pretty ? 2 : 0)}\n`);
} catch (error) {
  const payload = error.payload ?? { error: error.message };
  process.stderr.write(`${JSON.stringify(payload, null, flags.pretty ? 2 : 0)}\n`);
  process.exit(error.exitCode ?? EXIT.api);
}
