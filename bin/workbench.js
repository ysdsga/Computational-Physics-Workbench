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
  process.stderr.write(`workbench — Codex-driven DFT+DMFT research environment\n\nCommands:\n  doctor\n  context --task <id>\n  execution contract\n  run start --task <id> --plan <id> [--idempotency-key <key>]\n  run show --run <id>\n  run revise --run <id> --plan-file <path> --contract-file <path> --context-version <id> --reason <text>\n  run terminate --run <id> --reason <text>\n  action prepare --run <id> --context-version <id> --step <id> --capability <name> --spec-file <json> --idempotency-key <key> [--conversation-ref <ref>]\n  action propose --run <id> --context-version <id> --step <id> --type <name> --manifest-file <json> --idempotency-key <key> [--conversation-ref <ref>]\n  action authorize --action <id> --context-version <id> --manifest-sha <sha> --summary <text> [--conversation-ref <ref>]\n  action execute --action <id>\n  action show --action <id>\n  action list --run <id>\n  action status --action <id> --status <status> [--result-file <json>] [--error-file <json>]\n  artifact register --action <id> --location <local|remote> --path <relative> --category <name> --idempotency-key <key> [--job <id>] [--size <bytes>] [--sha256 <sha>] [--metadata-file <json>]\n  artifact list --run <id>\n  evidence check --action <id> --validator <name> --validator-version <version> --status <pass|warn|fail> --result-file <json> --idempotency-key <key> [--artifact <id>]\n  evidence list --run <id>\n  event append --run <id> --category <fact|inference|decision> --type <name> --actor <agent|researcher|system> [--payload-file <json>]\n  conclusion record --run <id> --summary <text> --artifacts <id,id> --idempotency-key <key> [--conversation-ref <ref>]\n  experience promote --run <id> --conclusion <event-id> --artifacts <id,id> --title <text> --content-file <path> --idempotency-key <key> [--tags <tag,tag>] [--conversation-ref <ref>]\n  review request --run <id> --gate <name> --question <text>\n  review list [--run <id>]\n  review decide --request <id> --decision <approve|reject|supplement|terminate> [--comment <text>] [--conversation-ref <ref>]\n  plan show --plan <id>\n  plan update --plan <id> --file <markdown> --expected-sha <sha>\n  workflow show --task <id>\n  workflow update --task <id> --file <json> --expected-sha <sha>\n  policy list [--scope-type <type>] [--scope-id <id>]\n  policy create --scope-type <type> [--scope-id <id>] --file <json> [--activate]\n  policy activate --policy <id>\n  contract show|initialize --plan <id>\n  contract update --plan <id> --file <yaml> [--expected-plan-sha <sha>]\n  remote status|logs|reconcile --job <remote-job-id>\n\nJSON is the default output. Use --pretty for indented JSON.\n`);
  process.stderr.write(`Additional experience commands:\n  experience search [--query <text>] [--project <id>] [--task <id>]\n  experience capture --run <id> [--step <id>] --title <text> --content-file <path> --idempotency-key <key> [--tags <tag,tag>] [--conversation-ref <ref>]\n`);
  process.stderr.write('Additional HPC metadata commands:\n  hpc show --project <id>\n  hpc configure --project <id> --file <json>\n');
  process.exit(exitCode);
}

function required(name) {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) usage(`Missing --${name}`);
  return value;
}

function readText(name) { return fs.readFileSync(required(name), 'utf8'); }
function readJson(name) { return JSON.parse(readText(name)); }
function csv(name) { return required(name).split(',').map(value => value.trim()).filter(Boolean); }

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
    error.exitCode = [
      'RUN_NOT_STARTED', 'RUN_NOT_ACTIVE', 'RUN_WAITING_REVIEW', 'TASK_ROOT_UNRESOLVED',
      'CONTRACT_MISSING', 'PLAN_CONTRACT_DRIFT', 'STALE_CONTEXT', 'ACTION_CONTEXT_MISMATCH',
      'CONTEXT_DRIFT', 'WORKFLOW_CONTEXT_DRIFT', 'ACTION_MANIFEST_MISMATCH',
      'ACTION_TRANSITION_INVALID', 'ACTION_NOT_AUTHORIZED', 'REMOTE_SUBMISSION_UNCERTAIN',
      'EXECUTION_INPUT_DRIFT', 'EXECUTION_RECEIPT_CONFLICT', 'POLICY_CONTEXT_DRIFT',
      'EXECUTION_IN_PROGRESS', 'EXECUTION_RECOVERY_UNCERTAIN',
    ].includes(payload.code) ? EXIT.blocked : EXIT.api;
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
  if (group === 'hpc') {
    const project = encodeURIComponent(required('project'));
    if (action === 'show') {
      const result = (await request('GET', '/api/projects/' + project)).payload;
      return {
        projectId: result.id,
        projectName: result.name,
        config: result.hpc_config ? JSON.parse(result.hpc_config) : null,
      };
    }
    if (action === 'configure') {
      const result = (await request('PUT', '/api/projects/' + project, {
        hpc_config: JSON.stringify(readJson('file')),
      })).payload;
      return {
        projectId: result.id,
        projectName: result.name,
        config: result.hpc_config ? JSON.parse(result.hpc_config) : null,
      };
    }
  }
  if (group === 'execution' && action === 'contract') return (await request('GET', '/api/agent/v1/execution-contract')).payload;
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
  if (group === 'action') {
    if (action === 'prepare') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/executable-actions`, { contextVersionId: required('context-version'), stepId: required('step'), capability: required('capability'), spec: readJson('spec-file'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] })).payload;
    if (action === 'propose') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/actions`, { contextVersionId: required('context-version'), stepId: required('step'), actionType: required('type'), manifest: readJson('manifest-file'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] })).payload;
    if (action === 'authorize') return (await request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/authorize`, { expectedContextVersionId: required('context-version'), expectedManifestSha256: required('manifest-sha'), authorizationSummary: required('summary'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
    if (action === 'show') return (await request('GET', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}`)).payload;
    if (action === 'list') return (await request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/actions`)).payload;
    if (action === 'execute') return (await request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/execute`, {})).payload;
    if (action === 'status') return (await request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/status`, { status: required('status'), result: flags['result-file'] ? readJson('result-file') : undefined, error: flags['error-file'] ? readJson('error-file') : undefined })).payload;
  }
  if (group === 'artifact') {
    if (action === 'register') return (await request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/artifacts`, { location: required('location'), path: required('path'), category: required('category'), idempotencyKey: required('idempotency-key'), remoteJobId: flags.job, sizeBytes: flags.size === undefined ? undefined : Number(flags.size), sha256: flags.sha256, metadata: flags['metadata-file'] ? readJson('metadata-file') : undefined })).payload;
    if (action === 'list') return (await request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/artifacts`)).payload;
  }
  if (group === 'evidence') {
    if (action === 'check') return (await request('POST', `/api/agent/v1/actions/${encodeURIComponent(required('action'))}/evidence-checks`, { artifactId: flags.artifact, validatorName: required('validator'), validatorVersion: required('validator-version'), status: required('status'), result: readJson('result-file'), idempotencyKey: required('idempotency-key') })).payload;
    if (action === 'list') return (await request('GET', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/evidence-checks`)).payload;
  }
  if (group === 'event' && action === 'append') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/events`, { category: required('category'), eventType: required('type'), actorType: required('actor'), payload: flags['payload-file'] ? readJson('payload-file') : {}, idempotencyKey: flags['idempotency-key'], source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
  if (group === 'conclusion' && action === 'record') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/conclusions`, { summary: required('summary'), artifactIds: csv('artifacts'), idempotencyKey: required('idempotency-key'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
  if (group === 'experience' && action === 'search') {
    const query = new URLSearchParams();
    if (typeof flags.query === 'string') query.set('search', flags.query);
    if (typeof flags.project === 'string') query.set('projectId', flags.project);
    if (typeof flags.task === 'string') query.set('taskId', flags.task);
    return (await request('GET', `/api/experiences${query.size ? `?${query}` : ''}`)).payload;
  }
  if (group === 'experience' && action === 'capture') return (await request('POST', '/api/experiences/codex-capture', { runId: required('run'), stepId: flags.step, title: required('title'), content: readText('content-file'), tags: typeof flags.tags === 'string' ? flags.tags.split(',').map(value => value.trim()).filter(Boolean) : [], idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] })).payload;
  if (group === 'experience' && action === 'promote') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/experience-promotions`, { conclusionEventId: required('conclusion'), artifactIds: csv('artifacts'), title: required('title'), content: readText('content-file'), tags: typeof flags.tags === 'string' ? flags.tags.split(',').map(value => value.trim()).filter(Boolean) : [], idempotencyKey: required('idempotency-key'), source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
  if (group === 'review') {
    if (action === 'list') return (await request('GET', `/api/agent/v1/reviews${flags.run ? `?runId=${encodeURIComponent(flags.run)}` : ''}`)).payload;
    if (action === 'request') return (await request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/reviews`, { gateType: required('gate'), question: required('question'), idempotencyKey: flags['idempotency-key'], source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
    if (action === 'decide') return (await request('POST', `/api/agent/v1/reviews/${encodeURIComponent(required('request'))}/decisions`, { decision: required('decision'), comment: flags.comment ?? '', source: 'codex_conversation', conversationRef: flags['conversation-ref'] })).payload;
  }
  if (group === 'plan') {
    const plan = encodeURIComponent(required('plan'));
    if (action === 'show') {
      const [metadata, content] = await Promise.all([request('GET', `/api/research-plans/${plan}`), request('GET', `/api/research-plans/${plan}/content`)]);
      return { ...metadata.payload, ...content.payload };
    }
    if (action === 'update') return (await request('PUT', `/api/research-plans/${plan}/content`, { content: readText('file'), expectedSha256: required('expected-sha') })).payload;
  }
  if (group === 'workflow') {
    const task = encodeURIComponent(required('task'));
    if (action === 'show') {
      const taskResult = (await request('GET', `/api/tasks/${task}`)).payload;
      return { ...taskResult.workflow, sha256: taskResult.workflow_sha256 };
    }
    if (action === 'update') return (await request('PUT', `/api/tasks/${task}/workflow`, { ...readJson('file'), expectedWorkflowSha256: required('expected-sha') })).payload;
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
  if (group === 'remote' && ['status', 'logs', 'reconcile'].includes(action)) {
    return (await request('POST', `/api/agent/v1/remote/jobs/${encodeURIComponent(required('job'))}/${action}`, {})).payload;
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
