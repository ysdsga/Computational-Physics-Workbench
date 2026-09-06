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
  context --task <id> [--allow-blocked] [--full] [--pretty]
  research-map show --task <id> [--pretty]
  hpc show --project <id>
  hpc configure --project <id> --file <json>
  plan list [--project <id>] [--task <id>] [--status <status>] [--query <text>]
  plan show --plan <id>
  plan update --plan <id> --file <markdown> --expected-sha <sha>
  plan metadata --plan <id> --file <json>
  workflow show --task <id>
  workflow update --task <id> --file <json> --expected-sha <sha>
  workflow template-show --workflow <id>
  workflow template-patch --workflow <id> --file <json>
  workflow template-reset --workflow <id>
  workflow reset-task --task <id> --expected-sha <sha>

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
  reflection record --run <id> --stage <id> --file <json> --idempotency-key <key> [--conversation-ref <ref>]

  experience search [--query <text>] [--project <id>] [--task <id>] [--status <manual|candidate|confirmed>]
  experience capture --run <id> [--stage <id>] --title <text> --content-file <path> --applicable-scope <text> --idempotency-key <key> [--category <name>] [--artifacts <id,id>] [--tags <tag,tag>]
  remote session|init --task <id>
  remote exec --task <id> (--command <text>|--command-file <path>) [--access <read|write>] [--scope <user|project|task>] [--cwd <relative>] [--timeout-seconds <n>]
  remote upload --task <id> --local <task-relative> --remote <task-relative> [--overwrite]
  remote download --task <id> --remote <relative> --local <task-relative> [--scope <user|project|task>] [--overwrite]
  remote status|logs|reconcile --job <remote-job-id>
  monitor guard
  monitor show|tick|directive --run <id>
  monitor attach --run <id> --automation-ref <id> --automation-state active --cadence-minutes <minutes>
  monitor sync --run <id> --automation-ref <id> --automation-state <active|paused|missing> [--cadence-minutes <minutes>]
  monitor pause --run <id> --automation-ref <id> --automation-state paused
  monitor close --run <id> --automation-ref <id> --automation-state <deleted|missing>

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

function applyWorkflowPatch(workflow, patch) {
  const stages = workflow.stages.map(stage => {
    const update = (patch.stageUpdates ?? []).find(item => item.id === stage.id);
    return update ? { ...stage, ...update.changes, id: stage.id } : stage;
  });
  const steps = workflow.steps.map(step => {
    const update = (patch.stepUpdates ?? []).find(item => item.id === step.id);
    return update ? { ...step, ...update.changes, id: step.id } : step;
  });
  for (const update of patch.stageUpdates ?? []) if (!stages.some(stage => stage.id === update.id)) usage(`Workflow stage not found: ${update.id}`);
  for (const update of patch.stepUpdates ?? []) if (!steps.some(step => step.id === update.id)) usage(`Workflow step not found: ${update.id}`);
  for (const step of patch.addSteps ?? []) {
    if (steps.some(item => item.id === step.id)) usage(`Workflow step already exists: ${step.id}`);
    steps.push(step);
  }
  return { ...workflow, stages, steps };
}

const BLOCKED_CODES = new Set([
  'RUN_NOT_STARTED', 'RUN_NOT_ACTIVE', 'RUN_NOT_CONFIRMED', 'RUN_WAITING_RESEARCHER',
  'TASK_ROOT_UNRESOLVED', 'STAGE_WAITING_RESEARCHER', 'ACTION_NOT_EXECUTABLE',
  'EXECUTION_INPUT_DRIFT', 'EXECUTION_RECEIPT_CONFLICT', 'EXECUTION_RECOVERY_UNCERTAIN',
  'REMOTE_SUBMISSION_UNCERTAIN', 'REMOTE_CONCURRENCY_LIMIT', 'ACTION_RETRY_LIMIT_REACHED', 'ACTIVE_REMOTE_JOBS',
  'STAGE_REFLECTIONS_REQUIRED', 'EXPLORATION_REVIEW_REQUIRED', 'EXPLORATION_REVIEW_UNRESOLVED',
  'SCIENTIFIC_GOAL_REQUIRED', 'SCIENTIFIC_GOAL_NOT_ANSWERED', 'SCIENTIFIC_GOAL_ASSESSMENT_REQUIRED',
  'SCIENTIFIC_ANSWER_TYPE_INSUFFICIENT', 'RESEARCH_ROUTE_SEARCH_REQUIRED', 'RESEARCH_ROUTE_REQUIRED',
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

function compactContext(context) {
  const actions = Array.isArray(context.recentActions) ? context.recentActions : [];
  const jobs = Array.isArray(context.recentJobs) ? context.recentJobs : [];
  const activeJobs = jobs.filter(item => !['done', 'exit', 'zombi', 'unkwn', 'preparation_failed', 'cancelled'].includes(String(item.status).toLowerCase()));
  const recentTerminalJobs = jobs.filter(item => !activeJobs.includes(item)).slice(0, 5);
  const run = context.run ? {
    id: context.run.id,
    status: context.run.status,
    currentStageId: context.run.current_stage_id,
    researchPlanId: context.run.research_plan_id,
    envelopeRevision: context.run.envelope_revision,
    envelopeSha256: context.run.confirmed_envelope_sha256,
    scientificGoal: context.run.confirmed_envelope?.scientificGoal,
    scientificGoalSha256: context.run.scientific_goal_sha256,
    workingPlan: {
      currentStageId: context.run.working_plan?.currentStageId,
      summary: context.run.working_plan?.summary,
      nextActions: context.run.working_plan?.nextActions,
      explorationReview: context.run.working_plan?.explorationReview,
      goalAssessment: context.run.working_plan?.goalAssessment,
    },
    boundary: {
      hpcProfileId: context.run.confirmed_envelope?.hpcProfileId,
      coreStageIds: context.run.confirmed_envelope?.coreStageIds,
      resourceLimits: context.run.confirmed_envelope?.resourceLimits,
      protectedRelativePaths: context.run.confirmed_envelope?.protectedRelativePaths,
    },
  } : null;
  return {
    schemaVersion: context.schemaVersion,
    view: 'compact',
    project: context.project ? { id: context.project.id, name: context.project.name, material: context.project.material, workingDir: context.project.working_dir } : null,
    task: context.task ? { id: context.task.id, name: context.task.name, status: context.task.status, workflowId: context.task.workflow_id, taskRootRel: context.task.task_root_rel } : null,
    taskRoot: context.taskRoot,
    run,
    research: context.research,
    workflow: context.workflow ? { id: context.workflow.id, name: context.workflow.name, stages: context.workflow.stages?.map(stage => ({ id: stage.id, name: stage.name })) } : null,
    operations: {
      activeOrWaitingActions: actions.filter(item => !['succeeded', 'failed', 'cancelled'].includes(item.status)).map(item => ({ id: item.id, stageId: item.stage_id, type: item.action_type, status: item.status, retryAttempt: item.retry_attempt })),
      recentActions: actions.slice(0, 5).map(item => ({ id: item.id, stageId: item.stage_id, type: item.action_type, status: item.status, retryAttempt: item.retry_attempt })),
      jobs: [...activeJobs, ...recentTerminalJobs].map(item => ({ id: item.id, jobId: item.job_id, stageId: item.stage_id, status: item.status, host: item.host, remoteWorkdir: item.remote_workdir, nextCheckAt: item.next_check_at })),
      counts: { actions: actions.length, jobs: jobs.length, artifacts: context.recentArtifacts?.length ?? 0, evidenceChecks: context.recentEvidenceChecks?.length ?? 0 },
    },
    monitor: context.monitor,
    pendingItems: context.pendingItems,
    latestStageReflections: context.latestStageReflections,
    ...(context.researchMap ? { researchMap: {
      goalSha256: context.researchMap.goalSha256,
      routeCount: context.researchMap.routes.length,
      closedRouteCount: context.researchMap.routes.filter(item => ['resolved', 'falsified'].includes(item.disposition)).length,
      latestSearch: context.researchMap.searches.at(-1),
      readMore: `workbench research-map show --task ${context.task.id}`,
    } } : {}),
    eventCursor: context.eventCursor,
    blockers: context.blockers,
  };
}

function commandInput() {
  if (typeof flags.command === 'string' && flags.command.trim()) return flags.command;
  if (typeof flags['command-file'] === 'string') return fs.readFileSync(flags['command-file'], 'utf8');
  usage('Missing --command or --command-file');
}

async function main() {
  const [group, action] = positionals;
  if (!group && (flags.help || flags.h)) usage(undefined, EXIT.ok);
  if (!group) usage();
  if (group === 'doctor') {
    const started = Date.now(); const projects = await request('GET', '/api/projects'); const execution = await request('GET', '/api/agent/v1/execution-contract');
    return { ok: true, baseUrl, latencyMs: Date.now() - started, projectCount: projects.length, runtimeSchemaVersion: execution.schemaVersion };
  }
  if (group === 'research-map' && action === 'show') return request('GET', `/api/agent/v1/tasks/${encodeURIComponent(required('task'))}/research-map`);
  if (group === 'context') {
    const result = await request('GET', `/api/agent/v1/context/tasks/${encodeURIComponent(required('task'))}`);
    if (Array.isArray(result.blockers) && result.blockers.length && flags['allow-blocked'] !== true) { const item = new Error('Context contains blockers'); item.payload = result; item.exitCode = EXIT.blocked; throw item; }
    return flags.full === true ? result : compactContext(result);
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
    if (action === 'template-show') return request('GET', `/api/workflows/${encodeURIComponent(required('workflow'))}`);
    if (action === 'template-patch') {
      const workflow = encodeURIComponent(required('workflow'));
      const current = await request('GET', `/api/workflows/${workflow}`);
      return request('PUT', `/api/workflows/${workflow}`, applyWorkflowPatch(current, readJson('file')));
    }
    if (action === 'template-reset') return request('POST', `/api/workflows/${encodeURIComponent(required('workflow'))}/reset`, {});
    const task = encodeURIComponent(required('task'));
    if (action === 'show') { const result = await request('GET', `/api/tasks/${task}`); return { ...result.workflow, sha256: result.workflow_sha256 }; }
    if (action === 'update') return request('PUT', `/api/tasks/${task}/workflow`, { ...readJson('file'), expectedWorkflowSha256: required('expected-sha') });
    if (action === 'reset-task') {
      const current = await request('GET', `/api/tasks/${task}`);
      const template = await request('GET', `/api/workflows/${encodeURIComponent(current.workflow_id)}`);
      return request('PUT', `/api/tasks/${task}/workflow`, { ...template, expectedWorkflowSha256: required('expected-sha') });
    }
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
  if (group === 'reflection' && action === 'record') return request('POST', `/api/agent/v1/runs/${encodeURIComponent(required('run'))}/stage-reflections`, { ...readJson('file'), stageId: required('stage'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] });
  if (group === 'experience' && action === 'search') return request('GET', queryPath('/api/experiences', { search: flags.query, projectId: flags.project, taskId: flags.task, status: flags.status }));
  if (group === 'experience' && action === 'capture') return request('POST', '/api/experiences/codex-capture', { runId: required('run'), stageId: flags.stage, title: required('title'), content: readText('content-file'), tags: csvOptional('tags'), category: flags.category, applicableScope: required('applicable-scope'), sourceArtifactIds: csvOptional('artifacts'), idempotencyKey: required('idempotency-key'), conversationRef: flags['conversation-ref'] });
  if (group === 'remote') {
    if (['session', 'init', 'exec', 'upload', 'download'].includes(action)) {
      const task = encodeURIComponent(required('task'));
      if (action === 'session') return request('GET', `/api/agent/v1/remote/tasks/${task}/session`);
      if (action === 'init') return request('POST', `/api/agent/v1/remote/tasks/${task}/init`, {});
      if (action === 'exec') return request('POST', `/api/agent/v1/remote/tasks/${task}/exec`, { command: commandInput(), access: flags.access, scope: flags.scope, cwd: flags.cwd, timeoutSeconds: flags['timeout-seconds'] === undefined ? undefined : Number(flags['timeout-seconds']) });
      if (action === 'upload') return request('POST', `/api/agent/v1/remote/tasks/${task}/upload`, { localPath: required('local'), remotePath: required('remote'), overwrite: flags.overwrite === true });
      if (action === 'download') return request('POST', `/api/agent/v1/remote/tasks/${task}/download`, { remotePath: required('remote'), localPath: required('local'), scope: flags.scope, overwrite: flags.overwrite === true });
    }
    if (['status', 'logs', 'reconcile'].includes(action)) return request('POST', `/api/agent/v1/remote/jobs/${encodeURIComponent(required('job'))}/${action}`, {});
  }
  if (group === 'monitor') {
    if (action === 'guard') return request('GET', '/api/agent/v1/monitor/guard');
    const run = encodeURIComponent(required('run'));
    if (action === 'show') return request('GET', `/api/agent/v1/runs/${run}/monitor`);
    if (action === 'directive') return request('GET', `/api/agent/v1/runs/${run}/monitor/directive`);
    if (action === 'tick') return request('POST', `/api/agent/v1/runs/${run}/monitor/tick`, {});
    if (action === 'attach') return request('POST', `/api/agent/v1/runs/${run}/monitor/attach`, { automationRef: required('automation-ref'), automationState: required('automation-state'), cadenceMinutes: Number(required('cadence-minutes')) });
    if (action === 'sync') return request('POST', `/api/agent/v1/runs/${run}/monitor/automation`, { automationRef: required('automation-ref'), automationState: required('automation-state'), cadenceMinutes: flags['cadence-minutes'] === undefined ? undefined : Number(flags['cadence-minutes']) });
    if (action === 'pause') return request('POST', `/api/agent/v1/runs/${run}/monitor/pause`, { automationRef: required('automation-ref'), automationState: required('automation-state') });
    if (action === 'close') return request('POST', `/api/agent/v1/runs/${run}/monitor/close`, { automationRef: required('automation-ref'), automationState: required('automation-state') });
  }
  usage(`Unknown command: ${positionals.join(' ')}`);
}

try { const output = await main(); process.stdout.write(`${JSON.stringify(output, null, flags.pretty ? 2 : 0)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify(error.payload ?? { error: error.message }, null, flags.pretty ? 2 : 0)}\n`); process.exit(error.exitCode ?? EXIT.api); }
