#!/usr/bin/env node
import fs from 'node:fs';

const EXIT = { ok: 0, usage: 2, api: 3, blocked: 4, transport: 5 };

function parse(argv) {
  const positionals = []; const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const [key, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags[key] = argv[++index];
    else flags[key] = true;
  }
  return { positionals, flags };
}

const { positionals, flags } = parse(process.argv.slice(2));
const baseUrl = String(process.env.WORKBENCH_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

function usage(message, code = EXIT.usage) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`workbench — Codex-driven DFT+DMFT research environment\n\nCommands:
  doctor
  context --task <id> [--allow-blocked] [--pretty]
  hpc show --project <id>
  hpc configure --project <id> --file <json>
  plan list [--project <id>] [--task <id>] [--status <status>] [--query <text>]
  plan show --plan <id>
  plan update --plan <id> --file <markdown> --expected-sha <sha>
  plan metadata --plan <id> --file <json>
  workflow show --task <id>
  workflow update --task <id> --file <json> --expected-sha <sha>

  run draft --task <id> --plan <id> --task-spec-file <json> --idempotency-key <key>
  run show --run <id>
  run confirm --run <id> --summary <text> [--conversation-ref <ref>]
  run working-plan --run <id> --file <json> --reason <text> --idempotency-key <key>
  run revise-envelope --run <id> --file <json> --pending <id> --summary <text> [--conversation-ref <ref>]
  run complete --run <id> --summary <text> [--conversation-ref <ref>]
  run terminate --run <id> --reason <text>

  execution contract
  action prepare --run <id> --stage <id> [--step <id>] --capability <name> --spec-file <json> --idempotency-key <key> [--parent <action-id>] [--retry-of <action-id>] [--conversation-ref <ref>]
  action record --run <id> --stage <id> [--step <id>] --type <name> --spec-file <json> --idempotency-key <key> [--parent <action-id>] [--retry-of <action-id>]
  action execute --action <id>
  action show --action <id>
  action list --run <id>
  action status --action <id> --status <status> [--result-file <json>] [--error-file <json>]

  pending list [--run <id>] [--project <id>] [--task <id>] [--audience <codex|researcher>] [--status <status>]
  pending create --run <id> --audience <codex|researcher> --kind <name> --title <text> --detail-file <json> --idempotency-key <key> [--stage <id>] [--action <id>] [--job <id>]
  pending resolve --item <id> [--status <resolved|dismissed>] [--resolution-file <json>] [--conversation-ref <ref>]
  artifact register --action <id> --location <local|remote> --path <relative> --category <name> --idempotency-key <key> [--job <id>] [--size <bytes>] [--sha256 <sha>]
  artifact validity --artifact <id> --validity <valid|suspect|invalid|superseded> --reason <text> [--superseded-by <id>]
  artifact list --run <id>
  evidence check --action <id> --validator <name> --validator-version <version> --status <pass|warn|fail> --result-file <json> --idempotency-key <key> [--artifact <id>]
  evidence list --run <id>
  event append --run <id> --category <fact|inference|decision|conclusion> --type <name> --actor <agent|researcher|system> [--payload-file <json>] [--conversation-ref <ref>]

  experience search [--query <text>] [--project <id>] [--task <id>] [--status <manual|candidate|confirmed>]
  experience capture --run <id> [--stage <id>] --title <text> --content-file <path> --applicable-scope <text> --idempotency-key <key> [--category <name>] [--artifacts <id,id>] [--tags <tag,tag>]
  remote status|logs|reconcile --job <remote-job-id>
  monitor guard
  monitor show|tick|pause --run <id>
  monitor attach --run <id> --automation-ref <id> --cadence-minutes <minutes>

JSON is the default output. Web pages are observation/metadata surfaces and never authorize or launch Agent work.\n`);
  process.exit(code);
}

function required(name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) usage(`Missing --${name}`);
  return value;
}
function readText(name) { return fs.readFileSync(required(name), 'utf8'); }
function readJson(name) { return JSON.parse(readText(name)); }
function csvOptional(name) { return typeof flags[name] === 'string' ? flags[name].split(',').map(item => item.trim()).filter(Boolean) : []; }

const BLOCKED_CODES = new Set([
  'RUN_NOT_STARTED', 'RUN_NOT_ACTIVE', 'RUN_NOT_CONFIRMED', 'RUN_WAITING_RESEARCHER',
  'TASK_ROOT_UNRESOLVED', 'STAGE_WAITING_RESEARCHER', 'ACTION_NOT_EXECUTABLE',
  'EXECUTION_INPUT_DRIFT', 'EXECUTION_RECEIPT_CONFLICT', 'EXECUTION_RECOVERY_UNCERTAIN',
  'REMOTE_SUBMISSION_UNCERTAIN', 'REMOTE_CONCURRENCY_LIMIT', 'ACTION_RETRY_LIMIT_REACHED', 'ACTIVE_REMOTE_JOBS',
]);

async function request(method, pathname, body) {
  let response;
  try { response = await fetch(`${baseUrl}${pathname}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (error) { const item = new Error(`Cannot reach Workbench at ${baseUrl}: ${error.message}`); item.exitCode = EXIT.transport; throw item; }
  const text = await response.text();
  let payload; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok) { const item = new Error(payload.error ?? `HTTP ${response.status}`); item.payload = payload; item.exitCode = BLOCKED_CODES.has(payload.code) ? EXIT.blocked : EXIT.api; throw item; }
  return payload;
}

function queryPath(base, values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (typeof value === 'string' && value) query.set(key, value);
  return `${base}${query.size ? `?${query}` : ''}`;
}

async function main() {
  const [group, action] = positionals;
  if (!group && (flags.help || flags.h)) usage(undefined, EXIT.ok);
  if (!group) usage();
  if (group === 'doctor') {
    const started = Date.now(); const projects = await request('GET', '/api/projects'); const execution = await request('GET', '/api/agent/v1/execution-contract');
    return { ok: true, baseUrl, latencyMs: Date.now() - started, projectCount: projects.length, runtimeSchemaVersion: execution.schemaVersion };
  }
  if (group === 'context') {
    const result = await request('GET', `/api/agent/v1/context/tasks/${encodeURIComponent(required('task'))}`);
    if (Array.isArray(result.blockers) && result.blockers.length && flags['allow-blocked'] !== true) { const item = new Error('Context contains blockers'); item.payload = result; item.exitCode = EXIT.blocked; throw item; }
    return result;
  }
  if (group === 'hpc') {
    const project = encodeURIComponent(required('project'));
    if (action === 'show') { const result = await request('GET', `/api/projects/${project}`); return { projectId: result.id, projectName: result.name, config: result.hpc_config ? JSON.parse(result.hpc_config) : null }; }
    if (action === 'configure') { const result = await request('PUT', `/api/projects/${project}`, { hpc_config: JSON.stringify(readJson('file')) }); return { projectId: result.id, projectName: result.name, config: result.hpc_config ? JSON.parse(result.hpc_config) : null }; }
  }
  if (group === 'plan') {
    if (action === 'list') return request('GET', queryPath('/api/research-plans', { projectId: flags.project, taskId: flags.task, status: flags.status, search: flags.query }));
    const plan = encodeURIComponent(required('plan'));
    if (action === 'show') return { ...await request('GET', `/api/research-plans/${plan}`), ...await request('GET', `/api/research-plans/${plan}/content`) };
    if (action === 'update') return request('PUT', `/api/research-plans/${plan}/content`, { content: readText('file'), expectedSha256: required('expected-sha') });
    if (action === 'metadata') return request('PUT', `/api/research-plans/${plan}`, readJson('file'));
  }
  if (group === 'workflow') {
    const task = encodeURIComponent(required('task'));
    if (action === 'show') { const result = await request('GET', `/api/tasks/${task}`); return { ...result.workflow, sha256: result.workflow_sha256 }; }
    if (action === 'update') return request('PUT', `/api/tasks/${task}/workflow`, { ...readJson('file'), expectedWorkflowSha256: required('expected-sha') });
  }
  if (group === 'execution' && action === 'contract') return request('GET', '/api/agent/v1/execution-contract');
  if (group === 'run') {
    const run = action === 'draft' ? null : encodeURIComponent(required('run'));
    if (action === 'draft') return request('POST', '/api/agent/v1/runs', { taskId: required('task'), researchPlanId: required('plan'), taskSpec: readJson('task-spec-file'), idempotencyKey: required('idempotency-key') });
    if (action === 'show') return request('GET', `/api/agent/v1/runs/${run}`);
    if (action === 'confirm') return request('POST', `/api/agent/v1/runs/${run}/confirm`, { summary: required('summary'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] });
    if (action === 'working-plan') return request('PUT', `/api/agent/v1/runs/${run}/working-plan`, { workingPlan: readJson('file'), reason: required('reason'), idempotencyKey: required('idempotency-key') });
    if (action === 'revise-envelope') return request('POST', `/api/agent/v1/runs/${run}/envelope-revisions`, { confirmedEnvelope: readJson('file'), pendingItemId: required('pending'), summary: required('summary'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] });
    if (action === 'complete') return request('POST', `/api/agent/v1/runs/${run}/complete`, { summary: required('summary'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] });
    if (action === 'terminate') return request('POST', `/api/agent/v1/runs/${run}/terminate`, { reason: required('reason') });
  }
  if (group === 'action') {
    if (action === 'prepare') return request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/executable-actions`, { stageId: required('stage'), stepId: flags.step, parentActionId: flags.parent, retryOfActionId: flags['retry-of'], capability: required('capability'), spec: readJson('spec-file'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] });
    if (action === 'record') return request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/actions`, { stageId: required('stage'), stepId: flags.step, parentActionId: flags.parent, retryOfActionId: flags['retry-of'], actionType: required('type'), spec: readJson('spec-file'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] });
    if (action === 'execute') return request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/execute`, {});
    if (action === 'show') return request('GET', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}`);
    if (action === 'list') return request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/actions`);
    if (action === 'status') return request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/status`, { status: required('status'), result: flags['result-file'] ? readJson('result-file') : undefined, error: flags['error-file'] ? readJson('error-file') : undefined });
  }
  if (group === 'pending') {
    if (action === 'list') return request('GET', queryPath('/api/agent/v1/pending-items', { runId: flags.run, projectId: flags.project, taskId: flags.task, audience: flags.audience, status: flags.status }));
    if (action === 'create') return request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/pending-items`, { stageId: flags.stage, actionId: flags.action, remoteJobId: flags.job, audience: required('audience'), kind: required('kind'), title: required('title'), detail: readJson('detail-file'), idempotencyKey: required('idempotency-key'), source: 'codex', conversationRef: flags['conversation-ref'] });
    if (action === 'resolve') return request('POST', `/api/agent/v1/pending-items/${encodeURIComponent(required('item'))}/resolve`, { status: flags.status ?? 'resolved', resolution: flags['resolution-file'] ? readJson('resolution-file') : {}, source: 'codex_conversation', conversationRef: flags['conversation-ref'] });
  }
  if (group === 'artifact') {
    if (action === 'register') return request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/artifacts`, { location: required('location'), path: required('path'), category: required('category'), idempotencyKey: required('idempotency-key'), remoteJobId: flags.job, sizeBytes: flags.size === undefined ? undefined : Number(flags.size), sha256: flags.sha256, metadata: flags['metadata-file'] ? readJson('metadata-file') : undefined });
    if (action === 'validity') return request('POST', `/api/agent/v1/artifacts/${encodeURIComponent(required('artifact'))}/validity`, { validity: required('validity'), reason: required('reason'), supersededById: flags['superseded-by'] });
    if (action === 'list') return request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/artifacts`);
  }
  if (group === 'evidence') {
    if (action === 'check') return request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/evidence-checks`, { artifactId: flags.artifact, validatorName: required('validator'), validatorVersion: required('validator-version'), status: required('status'), result: readJson('result-file'), idempotencyKey: required('idempotency-key') });
    if (action === 'list') return request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/evidence-checks`);
  }
  if (group === 'event' && action === 'append') return request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/events`, { category: required('category'), eventType: required('type'), actorType: required('actor'), payload: flags['payload-file'] ? readJson('payload-file') : {}, idempotencyKey: flags['idempotency-key'], source: 'codex_conversation', conversationRef: flags['conversation-ref'] });
  if (group === 'experience' && action === 'search') return request('GET', queryPath('/api/experiences', { search: flags.query, projectId: flags.project, taskId: flags.task, status: flags.status }));
  if (group === 'experience' && action === 'capture') return request('POST', '/api/experiences/codex-capture', { runId: required('run'), stageId: flags.stage, title: required('title'), content: readText('content-file'), tags: csvOptional('tags'), category: flags.category, applicableScope: required('applicable-scope'), sourceArtifactIds: csvOptional('artifacts'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] });
  if (group === 'remote' && ['status', 'logs', 'reconcile'].includes(action)) return request('POST', `/api/agent/v1/remote/jobs/${encodeURIComponent(required('job'))}/${action}`, {});
  if (group === 'monitor') {
    if (action === 'guard') return request('GET', '/api/agent/v1/monitor/guard');
    const run = encodeURIComponent(required('run'));
    if (action === 'show') return request('GET', `/api/agent/v1/runs/${run}/monitor`);
    if (action === 'tick') return request('POST', `/api/agent/v1/runs/${run}/monitor/tick`, {});
    if (action === 'pause') return request('POST', `/api/agent/v1/runs/${run}/monitor/pause`, {});
    if (action === 'attach') return request('POST', `/api/agent/v1/runs/${run}/monitor/attach`, { automationRef: required('automation-ref'), cadenceMinutes: Number(required('cadence-minutes')) });
  }
  usage(`Unknown command: ${positionals.join(' ')}`);
}

try { const output = await main(); process.stdout.write(`${JSON.stringify(output, null, flags.pretty ? 2 : 0)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify(error.payload ?? { error: error.message }, null, flags.pretty ? 2 : 0)}\n`); process.exit(error.exitCode ?? EXIT.api); }
