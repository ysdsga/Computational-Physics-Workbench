import { Router } from 'express';
import path from 'path';
import db from '../db.js';
import { HttpError } from '../errors.js';
import {
  classifyCommand,
  combineCommandRisks,
  hashTaskSpec,
  MAX_EXECUTION_PAYLOAD_LENGTH,
} from '../executionPolicy.js';
import {
  approvalCreateSchema,
  commandRunFinishSchema,
  taskSpecCreateSchema,
  taskSpecUpdateSchema,
  taskSpecVerifySchema,
  validateBody,
} from '../validation.js';
import { getWorkflowFromDB } from './workflows.js';

const router = Router({ mergeParams: true });

type JsonValue = string[]
  | Array<{ kind: string; summary: string; source?: string }>
  | Record<string, string | number | string[]>;

interface TaskSpecRow {
  id: string;
  task_id: string;
  step_id: string;
  title: string;
  remote_workdir: string;
  command: string;
  execution_payload: string;
  dependencies: string;
  step_dependencies: string;
  input_files: string;
  expected_outputs: string;
  preconditions: string;
  scientific_checks: string;
  success_criteria: string;
  approval_points: string;
  failure_handling: string;
  failure_policy: string;
  timeout_seconds: number;
  risk_class: string;
  approval_required: number;
  command_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CommandRunRow {
  id: string;
  task_spec_id: string;
  attempt_no: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  output_summary: string;
  evidence: string;
  error_message: string;
  verification_note: string;
  command_hash: string;
  task_spec_snapshot: string;
}

interface SchedulerJobRow {
  id: string;
  task_spec_id: string;
  scheduler: string;
  job_id: string;
  status: string;
  submitted_at: string;
  last_polled_at: string | null;
  next_poll_after: string | null;
  last_log_read_at: string | null;
  next_log_read_after: string | null;
  latest_summary: string;
  error_message: string;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJson<T extends JsonValue>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function getTaskSpec(id: string): TaskSpecRow {
  const row = db.prepare('SELECT * FROM task_specs WHERE id = ?').get(id) as TaskSpecRow | undefined;
  if (!row) throw new HttpError(404, 'Task Spec not found');
  return row;
}

function toHashable(row: TaskSpecRow) {
  return {
    command: row.command,
    execution_payload: row.execution_payload,
    remote_workdir: row.remote_workdir,
    dependencies: parseJson<string[]>(row.dependencies, []),
    step_dependencies: parseJson<string[]>(row.step_dependencies, []),
    input_files: parseJson<string[]>(row.input_files, []),
    expected_outputs: parseJson<string[]>(row.expected_outputs, []),
    preconditions: parseJson<string[]>(row.preconditions, []),
    scientific_checks: parseJson<string[]>(row.scientific_checks, []),
    success_criteria: parseJson<string[]>(row.success_criteria, []),
    approval_points: parseJson<string[]>(row.approval_points, []),
    failure_handling: parseJson<string[]>(row.failure_handling, []),
    failure_policy: row.failure_policy,
    timeout_seconds: row.timeout_seconds,
  };
}

function classifyTaskSpec(row: TaskSpecRow) {
  const commandRisk = classifyCommand(row.command);
  if (!row.execution_payload.trim()) return commandRisk;
  const quotedWorkdir = `'${row.remote_workdir.replace(/'/g, `'"'"'`)}'`;
  const approvedCwdDirectives = new Set([
    `cd ${row.remote_workdir}`,
    `cd -- ${row.remote_workdir}`,
    `cd ${quotedWorkdir}`,
    `cd -- ${quotedWorkdir}`,
  ]);
  const payloadForReview = row.execution_payload
    .split(/\r?\n/)
    .filter(line => !approvedCwdDirectives.has(line.trim()))
    .join('\n');
  if (!payloadForReview.trim()) return commandRisk;
  return combineCommandRisks(
    commandRisk,
    classifyCommand(payloadForReview, MAX_EXECUTION_PAYLOAD_LENGTH),
  );
}

function serializeRun(row: CommandRunRow) {
  return {
    ...row,
    evidence: parseJson<Array<{ kind: string; summary: string; source?: string }>>(row.evidence, []),
    task_spec_snapshot: parseJson<Record<string, string | number | string[]>>(row.task_spec_snapshot, {}),
  };
}

function serializeSchedulerJob(row: SchedulerJobRow) {
  const polls = db.prepare(`
    SELECT * FROM scheduler_poll_events WHERE scheduler_job_id = ? ORDER BY started_at ASC
  `).all(row.id);
  const logReads = db.prepare(`
    SELECT * FROM scheduler_log_events WHERE scheduler_job_id = ? ORDER BY started_at ASC
  `).all(row.id);
  return { ...row, polls, log_reads: logReads };
}

function serializeSpec(row: TaskSpecRow) {
  const approvals = db.prepare('SELECT * FROM approval_events WHERE task_spec_id = ? ORDER BY created_at ASC')
    .all(row.id);
  const runs = (db.prepare('SELECT * FROM command_runs WHERE task_spec_id = ? ORDER BY attempt_no ASC')
    .all(row.id) as CommandRunRow[]).map(serializeRun);
  const schedulerJobs = (db.prepare('SELECT * FROM scheduler_jobs WHERE task_spec_id = ? ORDER BY submitted_at ASC')
    .all(row.id) as SchedulerJobRow[]).map(serializeSchedulerJob);
  const experiences = db.prepare(`
    SELECT * FROM experiences WHERE source_task_spec_id = ? ORDER BY updated_at DESC
  `).all(row.id);
  const risk = classifyTaskSpec(row);

  return {
    ...row,
    dependencies: parseJson<string[]>(row.dependencies, []),
    step_dependencies: parseJson<string[]>(row.step_dependencies, []),
    input_files: parseJson<string[]>(row.input_files, []),
    expected_outputs: parseJson<string[]>(row.expected_outputs, []),
    preconditions: parseJson<string[]>(row.preconditions, []),
    scientific_checks: parseJson<string[]>(row.scientific_checks, []),
    success_criteria: parseJson<string[]>(row.success_criteria, []),
    approval_points: parseJson<string[]>(row.approval_points, []),
    failure_handling: parseJson<string[]>(row.failure_handling, []),
    approval_required: Boolean(row.approval_required),
    blocked_reasons: risk.blockedReasons,
    approvals,
    runs,
    scheduler_jobs: schedulerJobs,
    experiences,
  };
}

function taskContext(taskId: string, stepId: string) {
  const task = db.prepare(`
    SELECT t.id, t.workflow_id, t.folder_name, p.hpc_config
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.id = ?
  `).get(taskId) as { id: string; workflow_id: string; folder_name: string; hpc_config: string | null } | undefined;
  if (!task) throw new HttpError(404, 'Task not found');

  const workflow = getWorkflowFromDB(task.workflow_id);
  const step = workflow?.steps.find(item => item.id === stepId);
  if (!step) throw new HttpError(400, 'Step does not belong to the task workflow');

  let config: { remotePath?: string } = {};
  try {
    config = task.hpc_config ? JSON.parse(task.hpc_config) : {};
  } catch {
    throw new HttpError(400, 'Project HPC configuration is invalid JSON');
  }
  if (!config.remotePath) throw new HttpError(400, 'Configure the project remote working directory first');

  const remoteRoot = normalizeAbsoluteRemotePath(config.remotePath);
  const taskRoot = path.posix.join(remoteRoot, task.folder_name);
  const defaultWorkdir = path.posix.join(taskRoot, step.stageId);
  return { taskRoot, defaultWorkdir, workflow, step };
}

function normalizeAbsoluteRemotePath(value: string): string {
  const hasControlCharacter = Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
  if (hasControlCharacter || value.includes('\\')) {
    throw new HttpError(400, 'Remote working directory must be a printable POSIX path');
  }
  if (!path.posix.isAbsolute(value)) throw new HttpError(400, 'Remote working directory must be an absolute POSIX path');
  return path.posix.normalize(value);
}

function ensureWithinRemoteTaskRoot(taskRoot: string, candidateValue: string): string {
  const candidate = normalizeAbsoluteRemotePath(candidateValue);
  const relative = path.posix.relative(taskRoot, candidate);
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new HttpError(403, 'Remote working directory must stay inside the task directory');
  }
  return candidate;
}

function validateDependencies(taskId: string, specId: string | null, dependencies: string[]): void {
  const unique = new Set(dependencies);
  if (unique.size !== dependencies.length) throw new HttpError(400, 'Task Spec dependencies must be unique');
  if (specId && unique.has(specId)) throw new HttpError(400, 'Task Spec cannot depend on itself');
  for (const dependencyId of unique) {
    const dependency = db.prepare('SELECT task_id FROM task_specs WHERE id = ?').get(dependencyId) as { task_id: string } | undefined;
    if (!dependency || dependency.task_id !== taskId) {
      throw new HttpError(400, `Unknown dependency in this task: ${dependencyId}`);
    }
  }
}

function validateStepDependencies(taskId: string, ownStepId: string, stepDependencies: string[]): void {
  const unique = new Set(stepDependencies);
  if (unique.size !== stepDependencies.length) throw new HttpError(400, 'Workflow step dependencies must be unique');
  if (unique.has(ownStepId)) throw new HttpError(400, 'A workflow step cannot depend on itself');
  const task = db.prepare('SELECT workflow_id FROM tasks WHERE id = ?').get(taskId) as { workflow_id: string } | undefined;
  const workflow = task ? getWorkflowFromDB(task.workflow_id) : undefined;
  const validStepIds = new Set(workflow?.steps.map(step => step.id) ?? []);
  for (const stepId of unique) {
    if (!validStepIds.has(stepId)) throw new HttpError(400, `Unknown workflow step dependency: ${stepId}`);
  }
}

function findUnfinishedStepDependency(taskId: string, stepDependencies: string[]): string | undefined {
  return stepDependencies.find(stepId => {
    const progress = db.prepare(`
      SELECT status FROM step_progress WHERE task_id = ? AND step_id = ?
    `).get(taskId, stepId) as { status: string } | undefined;
    if (progress?.status === 'completed' || progress?.status === 'skipped') return false;
    const completedSpec = db.prepare(`
      SELECT id FROM task_specs WHERE task_id = ? AND step_id = ? AND status = 'completed' LIMIT 1
    `).get(taskId, stepId);
    return !completedSpec;
  });
}

router.get('/', (req, res) => {
  const taskId = String((req.params as Record<string, string | undefined>).taskId ?? '');
  if (!taskId) throw new HttpError(400, 'Task ID is required');
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new HttpError(404, 'Task not found');
  const rows = db.prepare('SELECT * FROM task_specs WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as TaskSpecRow[];
  res.json(rows.map(serializeSpec));
});

router.post('/', validateBody(taskSpecCreateSchema), (req, res) => {
  const taskId = String((req.params as Record<string, string | undefined>).taskId ?? '');
  if (!taskId) throw new HttpError(400, 'Task ID is required');
  const data = req.body;
  const context = taskContext(taskId, data.step_id);
  const remoteWorkdir = ensureWithinRemoteTaskRoot(context.taskRoot, data.remote_workdir ?? context.defaultWorkdir);
  const dependencies = data.dependencies ?? [];
  const stepDependencies = data.step_dependencies ?? context.step.dependsOn ?? [];
  validateDependencies(taskId, null, dependencies);
  validateStepDependencies(taskId, data.step_id, stepDependencies);

  const id = makeId('spec');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO task_specs (
      id, task_id, step_id, title, remote_workdir, command, execution_payload, dependencies,
      step_dependencies, input_files, expected_outputs, preconditions, scientific_checks,
      success_criteria, approval_points, failure_handling, failure_policy, timeout_seconds,
      risk_class, approval_required, command_hash, status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'unclassified', 1, '', 'draft', ?, ?
    )
  `).run(
    id,
    taskId,
    data.step_id,
    data.title,
    remoteWorkdir,
    data.command,
    data.execution_payload ?? '',
    JSON.stringify(dependencies),
    JSON.stringify(stepDependencies),
    JSON.stringify(data.input_files ?? context.step.inputFiles ?? []),
    JSON.stringify(data.expected_outputs ?? context.step.outputFiles ?? []),
    JSON.stringify(data.preconditions ?? context.step.preconditions ?? []),
    JSON.stringify(data.scientific_checks ?? context.step.scientificChecks ?? []),
    JSON.stringify(data.success_criteria ?? context.step.successCriteria ?? []),
    JSON.stringify(data.approval_points ?? context.step.approvalPoints ?? []),
    JSON.stringify(data.failure_handling ?? context.step.failureHandling ?? []),
    data.failure_policy ?? 'stop',
    data.timeout_seconds ?? 30,
    now,
    now,
  );
  res.status(201).json(serializeSpec(getTaskSpec(id)));
});

router.get('/:specId', (req, res) => {
  res.json(serializeSpec(getTaskSpec(String(req.params.specId))));
});

router.put('/:specId', validateBody(taskSpecUpdateSchema), (req, res) => {
  const current = getTaskSpec(String(req.params.specId));
  if (['executing', 'monitoring', 'verifying', 'completed'].includes(current.status)) {
    throw new HttpError(409, `Cannot edit a Task Spec while it is ${current.status}`);
  }
  const data = req.body;
  const context = taskContext(current.task_id, current.step_id);
  const remoteWorkdir = ensureWithinRemoteTaskRoot(context.taskRoot, data.remote_workdir ?? current.remote_workdir);
  const dependencies = data.dependencies ?? parseJson<string[]>(current.dependencies, []);
  const stepDependencies = data.step_dependencies ?? parseJson<string[]>(current.step_dependencies, []);
  validateDependencies(current.task_id, current.id, dependencies);
  validateStepDependencies(current.task_id, current.step_id, stepDependencies);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE task_specs SET
      title = ?, remote_workdir = ?, command = ?, execution_payload = ?, dependencies = ?, step_dependencies = ?,
      input_files = ?, expected_outputs = ?, preconditions = ?, scientific_checks = ?,
      success_criteria = ?, approval_points = ?, failure_handling = ?,
      failure_policy = ?, timeout_seconds = ?, risk_class = 'unclassified',
      approval_required = 1, command_hash = '', status = 'draft', updated_at = ?
    WHERE id = ?
  `).run(
    data.title ?? current.title,
    remoteWorkdir,
    data.command ?? current.command,
    data.execution_payload ?? current.execution_payload,
    JSON.stringify(dependencies),
    JSON.stringify(stepDependencies),
    JSON.stringify(data.input_files ?? parseJson<string[]>(current.input_files, [])),
    JSON.stringify(data.expected_outputs ?? parseJson<string[]>(current.expected_outputs, [])),
    JSON.stringify(data.preconditions ?? parseJson<string[]>(current.preconditions, [])),
    JSON.stringify(data.scientific_checks ?? parseJson<string[]>(current.scientific_checks, [])),
    JSON.stringify(data.success_criteria ?? parseJson<string[]>(current.success_criteria, [])),
    JSON.stringify(data.approval_points ?? parseJson<string[]>(current.approval_points, [])),
    JSON.stringify(data.failure_handling ?? parseJson<string[]>(current.failure_handling, [])),
    data.failure_policy ?? current.failure_policy,
    data.timeout_seconds ?? current.timeout_seconds,
    now,
    current.id,
  );
  res.json(serializeSpec(getTaskSpec(current.id)));
});

router.post('/:specId/check', (req, res) => {
  const current = getTaskSpec(String(req.params.specId));
  if (current.status === 'executing') throw new HttpError(409, 'Cannot check a Task Spec while it is executing');
  const dependencies = parseJson<string[]>(current.dependencies, []);
  const stepDependencies = parseJson<string[]>(current.step_dependencies, []);
  validateDependencies(current.task_id, current.id, dependencies);
  validateStepDependencies(current.task_id, current.step_id, stepDependencies);
  const unfinishedDependency = dependencies.find(id => getTaskSpec(id).status !== 'completed');
  if (unfinishedDependency) throw new HttpError(409, `Dependency is not completed: ${unfinishedDependency}`);
  const unfinishedStep = findUnfinishedStepDependency(current.task_id, stepDependencies);
  if (unfinishedStep) throw new HttpError(409, `Workflow step dependency is not completed: ${unfinishedStep}`);

  const risk = classifyTaskSpec(current);
  const commandHash = hashTaskSpec(toHashable(current));
  const hasScientificApprovalPoint = parseJson<string[]>(current.approval_points, []).length > 0;
  const approvalRequired = (risk.riskClass !== 'read-only' && risk.riskClass !== 'blocked') || hasScientificApprovalPoint;
  const status = risk.riskClass === 'blocked' ? 'blocked' : approvalRequired ? 'awaiting_approval' : 'ready';
  db.prepare(`
    UPDATE task_specs SET risk_class = ?, approval_required = ?, command_hash = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(risk.riskClass, approvalRequired ? 1 : 0, commandHash, status, new Date().toISOString(), current.id);
  res.json(serializeSpec(getTaskSpec(current.id)));
});

router.post('/:specId/approvals', validateBody(approvalCreateSchema), (req, res) => {
  const current = getTaskSpec(String(req.params.specId));
  if (current.status !== 'awaiting_approval') throw new HttpError(409, 'Task Spec is not awaiting approval');
  const liveHash = hashTaskSpec(toHashable(current));
  if (!current.command_hash || current.command_hash !== liveHash) {
    throw new HttpError(409, 'Task Spec changed after checking; check it again before approval');
  }

  const eventId = makeId('approval');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO approval_events (id, task_spec_id, decision, command_hash, actor, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    current.id,
    req.body.decision,
    current.command_hash,
    req.body.actor ?? 'user',
    req.body.note ?? '',
    now,
  );
  const nextStatus = req.body.decision === 'approved' ? 'ready' : 'blocked';
  db.prepare('UPDATE task_specs SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, current.id);
  res.status(201).json(serializeSpec(getTaskSpec(current.id)));
});

router.post('/:specId/runs', (req, res) => {
  const current = getTaskSpec(String(req.params.specId));
  if (current.status !== 'ready') throw new HttpError(409, 'Task Spec is not ready to execute');
  const liveHash = hashTaskSpec(toHashable(current));
  if (!current.command_hash || current.command_hash !== liveHash) {
    throw new HttpError(409, 'Task Spec changed after checking; check it again before execution');
  }
  if (current.approval_required) {
    const approval = db.prepare(`
      SELECT id FROM approval_events
      WHERE task_spec_id = ? AND decision = 'approved' AND command_hash = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(current.id, current.command_hash);
    if (!approval) throw new HttpError(409, 'Current Task Spec content has not been approved');
  }
  const activeRun = db.prepare("SELECT id FROM command_runs WHERE task_spec_id = ? AND status = 'executing'").get(current.id);
  if (activeRun) throw new HttpError(409, 'A command run is already executing');

  const attempt = (db.prepare('SELECT COALESCE(MAX(attempt_no), 0) AS value FROM command_runs WHERE task_spec_id = ?')
    .get(current.id) as { value: number }).value + 1;
  const runId = makeId('run');
  const now = new Date().toISOString();
  const snapshot = {
    title: current.title,
    step_id: current.step_id,
    ...toHashable(current),
  };
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO command_runs (
        id, task_spec_id, attempt_no, status, started_at, command_hash, task_spec_snapshot
      ) VALUES (?, ?, ?, 'executing', ?, ?, ?)
    `).run(runId, current.id, attempt, now, current.command_hash, JSON.stringify(snapshot));
    db.prepare("UPDATE task_specs SET status = 'executing', updated_at = ? WHERE id = ?").run(now, current.id);
  });
  transaction();
  res.status(201).json(serializeSpec(getTaskSpec(current.id)));
});

router.put('/runs/:runId', validateBody(commandRunFinishSchema), (req, res) => {
  const run = db.prepare('SELECT * FROM command_runs WHERE id = ?').get(String(req.params.runId)) as CommandRunRow | undefined;
  if (!run) throw new HttpError(404, 'Command run not found');
  if (run.status !== 'executing') throw new HttpError(409, 'Command run is already finalized');
  if (req.body.status === 'completed' && req.body.exit_code !== 0) {
    throw new HttpError(400, 'A completed command run must report exit_code 0');
  }
  const spec = getTaskSpec(run.task_spec_id);
  const risk = classifyTaskSpec(spec);
  const isSubmission = risk.requiresSubmitApproval;
  if (req.body.scheduler_job && req.body.status !== 'completed') {
    throw new HttpError(400, 'A scheduler job can only be registered for a completed submission command');
  }
  if (req.body.scheduler_job && !isSubmission) {
    throw new HttpError(400, 'This Task Spec is not classified as a scheduler submission');
  }
  if (req.body.status === 'completed' && isSubmission && !req.body.scheduler_job) {
    throw new HttpError(400, 'A completed scheduler submission must report the accepted job ID');
  }

  const now = new Date().toISOString();
  const runStatus = req.body.status === 'completed' ? 'completed' : req.body.status;
  const specStatus = req.body.status === 'completed'
    ? req.body.scheduler_job ? 'monitoring' : 'verifying'
    : req.body.status;
  const schedulerJobRecordId = req.body.scheduler_job ? makeId('sched') : null;
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE command_runs SET status = ?, finished_at = ?, exit_code = ?, output_summary = ?,
        evidence = ?, error_message = ? WHERE id = ?
    `).run(
      runStatus,
      now,
      req.body.exit_code ?? null,
      req.body.output_summary ?? '',
      JSON.stringify(req.body.evidence ?? []),
      req.body.error_message ?? '',
      run.id,
    );
    if (req.body.scheduler_job && schedulerJobRecordId) {
      db.prepare(`
        INSERT INTO scheduler_jobs (
          id, task_spec_id, scheduler, job_id, status, submitted_at, latest_summary
        ) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)
      `).run(
        schedulerJobRecordId,
        run.task_spec_id,
        req.body.scheduler_job.scheduler,
        req.body.scheduler_job.job_id,
        now,
        req.body.output_summary ?? '',
      );
    }
    db.prepare('UPDATE task_specs SET status = ?, updated_at = ? WHERE id = ?').run(specStatus, now, run.task_spec_id);
  });
  transaction();
  res.json(serializeSpec(getTaskSpec(run.task_spec_id)));
});

router.post('/:specId/verify', validateBody(taskSpecVerifySchema), (req, res) => {
  const current = getTaskSpec(String(req.params.specId));
  if (current.status !== 'verifying') throw new HttpError(409, 'Task Spec is not awaiting verification');
  const run = db.prepare(`
    SELECT * FROM command_runs WHERE task_spec_id = ? ORDER BY attempt_no DESC LIMIT 1
  `).get(current.id) as CommandRunRow | undefined;
  if (!run || run.status !== 'completed') throw new HttpError(409, 'No completed command run is available for verification');

  const evidence = req.body.evidence ?? parseJson<Array<{ kind: string; summary: string; source?: string }>>(run.evidence, []);
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare('UPDATE command_runs SET evidence = ?, verification_note = ? WHERE id = ?')
      .run(JSON.stringify(evidence), req.body.note ?? '', run.id);
    db.prepare('UPDATE task_specs SET status = ?, updated_at = ? WHERE id = ?')
      .run(req.body.decision, now, current.id);
  });
  transaction();
  res.json(serializeSpec(getTaskSpec(current.id)));
});

export default router;
