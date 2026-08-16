import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import type { ConfirmedEnvelope, RemoteCapabilityReport, RemoteJob, RunAction } from '../../src/types/index.js';
import { activeRun, AgentCoreError, appendEvent, createPendingItem, getRun, newId, normalizeRemoteRoot, now, runtimeTask, stableJson } from './agentCore.js';
import { transitionAction } from './agentActions.js';
import { isRemotePathWithin, resolveRemoteTaskBinding, type ResolvedRemoteTaskBinding } from './hpcConfig.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';
import { recordJobObservation, scheduleNewJob } from './monitorStore.js';

const MAX_OUTPUT = 1024 * 1024;
const SSH_TIMEOUT_MS = 20_000;

interface ProcessResult { code: number; stdout: string; stderr: string }
export type RemoteProcessRunner = (command: string, args: string[], options: { input?: string; timeoutMs?: number }) => Promise<ProcessResult>;
let remoteProcessRunnerForTests: RemoteProcessRunner | null = null;

export function setRemoteProcessRunnerForTests(runner: RemoteProcessRunner | null): void {
  if (process.env.WORKBENCH_REMOTE_TEST_MODE !== '1') throw new AgentCoreError(403, 'REMOTE_TEST_MODE_DISABLED', 'Remote process injection is available only in explicit test mode');
  remoteProcessRunnerForTests = runner;
}

function runProcess(command: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<ProcessResult> {
  if (remoteProcessRunnerForTests) return remoteProcessRunnerForTests(command, args, options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let limited = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? SSH_TIMEOUT_MS);
    const collect = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT) { limited = true; child.kill(); }
      return next.slice(0, MAX_OUTPUT);
    };
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', error => { clearTimeout(timer); reject(new AgentCoreError(502, 'OPENSSH_UNAVAILABLE', error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (limited) return reject(new AgentCoreError(502, 'REMOTE_OUTPUT_LIMIT', 'Remote command exceeded the output limit'));
      if (timedOut) return reject(new AgentCoreError(502, 'SSH_TIMEOUT', 'OpenSSH operation timed out'));
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}

function validateHost(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) throw new AgentCoreError(400, 'REMOTE_HOST_INVALID', 'Host must be a registered OpenSSH alias');
  return value;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function sshArgs(host: string, command: string): string[] { return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', host, command]; }
function sftpArgs(host: string): string[] { return ['-q', '-b', '-', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', host]; }
function sftpQuote(value: string): string {
  if (value.includes('\r') || value.includes('\n') || value.includes('\0') || value.includes('"')) throw new AgentCoreError(400, 'SFTP_PATH_INVALID', 'SFTP path contains unsupported characters');
  return `"${value}"`;
}

function remoteRelative(root: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\r') || relative.includes('\n') || relative.includes('\0')) throw new AgentCoreError(400, 'REMOTE_PATH_INVALID', 'Remote path must be relative');
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new AgentCoreError(400, 'REMOTE_PATH_INVALID', 'Remote path contains traversal');
  return `${normalizeRemoteRoot(root).replace(/\/$/, '')}/${parts.join('/')}`;
}

function explainFailure(result: ProcessResult): never {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (/host key verification failed/i.test(text)) throw new AgentCoreError(502, 'SSH_HOST_KEY_FAILED', text);
  if (/permission denied/i.test(text)) throw new AgentCoreError(502, 'SSH_PERMISSION_DENIED', text);
  throw new AgentCoreError(502, 'REMOTE_COMMAND_FAILED', text || `Remote command exited ${result.code}`);
}

function operationCapability(operation: string): ConfirmedEnvelope['allowedCapabilities'][number] {
  if (['job.status', 'job.logs', 'job.reconcile'].includes(operation)) return 'remote.inspect';
  if (operation === 'job.cancel') return 'job.cancel';
  if (['remote.inspect', 'remote.task-root.create', 'files.upload', 'files.download', 'job.submit'].includes(operation)) return operation as ConfirmedEnvelope['allowedCapabilities'][number];
  throw new AgentCoreError(400, 'REMOTE_OPERATION_UNKNOWN', `Unsupported remote operation: ${operation}`);
}

export interface RemoteAccess {
  task: ReturnType<typeof runtimeTask>;
  run: ReturnType<typeof activeRun>;
  envelope: ConfirmedEnvelope;
  host: string;
  remoteRoot: string;
  taskRoot: string;
  binding: ResolvedRemoteTaskBinding;
}

export function isProtectedRelativePath(relativePath: unknown, protectedPaths: string[]): boolean {
  if (typeof relativePath !== 'string') return false;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return protectedPaths.some(item => normalized === item || normalized.startsWith(`${item}/`));
}

export function smokeBudgetAllowsOneCoreMinute(boundary: { limits?: { maxCoresPerJob: number; maxWallMinutes: number }; resourceLimits?: { maxCoresPerJob: number; maxWallMinutes: number } }, second?: { resourceBudget: { maxCoresPerJob: number; maxWallMinutes: number } }): boolean {
  const first = boundary.resourceLimits ?? boundary.limits;
  return Boolean(first && first.maxCoresPerJob >= 1 && first.maxWallMinutes >= 1 && (!second || (second.resourceBudget.maxCoresPerJob >= 1 && second.resourceBudget.maxWallMinutes >= 1)));
}

export function authorizeRemoteOperation(taskId: string, hostInput: unknown, rootInput: unknown, operation: string, smoke = false, requireEnvironment = true): RemoteAccess {
  if (requireEnvironment && process.env.WORKBENCH_REMOTE_ENABLED !== '1') throw new AgentCoreError(403, 'REMOTE_ENV_DISABLED', 'Set WORKBENCH_REMOTE_ENABLED=1 to enable remote actions');
  const task = runtimeTask(taskId);
  if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
  const run = activeRun((db.prepare("SELECT id FROM research_runs WHERE task_id = ? AND status IN ('active','waiting_researcher') ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string } | undefined)?.id ?? '');
  const envelope = run.confirmed_envelope;
  const capability = operationCapability(operation);
  if (!envelope.allowedCapabilities.includes(capability)) throw new AgentCoreError(403, 'REMOTE_OPERATION_DENIED', `Task Spec does not allow ${capability}`);
  if (!envelope.hpcProfileId) throw new AgentCoreError(409, 'TASK_SPEC_HPC_REQUIRED', 'Task Spec has no HPC profile');
  const host = validateHost(hostInput);
  const binding = resolveRemoteTaskBinding(task.hpc_config, taskId, host);
  if (binding.profileId !== envelope.hpcProfileId) throw new AgentCoreError(409, 'HPC_PROFILE_ENVELOPE_MISMATCH', 'Registered connection does not match the confirmed Task Spec');
  const remoteRoot = normalizeRemoteRoot(String(rootInput ?? ''));
  const readOperation = ['remote.inspect', 'files.download', 'job.status', 'job.logs', 'job.reconcile'].includes(operation);
  if (readOperation) {
    if (!isRemotePathWithin(remoteRoot, binding.userReadRoot)) throw new AgentCoreError(403, 'REMOTE_READ_ROOT_DENIED', 'Read operation is outside the registered user root');
  } else if (remoteRoot !== binding.taskWriteRoot) throw new AgentCoreError(403, 'REMOTE_WRITE_ROOT_DENIED', 'Write and scheduler operations must use the registered Task root');
  if (smoke && process.env.WORKBENCH_ALLOW_REMOTE_SMOKE !== '1') throw new AgentCoreError(403, 'REMOTE_SMOKE_ENV_DISABLED', 'Set WORKBENCH_ALLOW_REMOTE_SMOKE=1 to enable smoke submission');
  const taskRoot = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  return { task, run, envelope, host, remoteRoot, taskRoot, binding };
}

export async function createRemoteTaskRoot(taskId: string, input: { host: unknown; remoteRoot: unknown }) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'remote.task-root.create');
  const command = [
    'set -eu',
    `user_root=$(cd ${shellQuote(access.binding.userReadRoot)} && pwd -P)`,
    `project_root=$(cd ${shellQuote(access.binding.projectRoot)} && pwd -P)`,
    'case "$project_root" in "$user_root"/*) ;; *) exit 73;; esac',
    `target=${shellQuote(access.binding.taskWriteRoot)}`,
    'created=0', 'if [ -e "$target" ]; then test -d "$target"; else mkdir -- "$target"; created=1; fi',
    'task_root=$(cd "$target" && pwd -P)', 'test "${task_root%/*}" = "$project_root"',
    'printf "PROJECT_ROOT=%s\\nTASK_ROOT=%s\\nCREATED=%s\\n" "$project_root" "$task_root" "$created"',
  ].join('; ');
  const result = await runProcess('ssh', sshArgs(access.host, command));
  if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Remote Task root resolved outside its project root');
  if (result.code !== 0) explainFailure(result);
  const payload = { host: access.host, taskRoot: access.binding.taskWriteRoot, created: /CREATED=1/.test(result.stdout) };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.task_root_ready', actorType: 'system', payload });
  return payload;
}

export function parseLsfScheduler(lines: string[]): string | undefined { return lines.some(line => /(^|\/)bsub(?:\.exe)?$/i.test(line.trim())) ? 'lsf' : undefined; }

export async function inspectRemote(taskId: string, hostInput: unknown, rootInput: unknown): Promise<RemoteCapabilityReport> {
  const access = authorizeRemoteOperation(taskId, hostInput, rootInput, 'remote.inspect');
  const commands = ['ssh', 'sftp', 'bsub', 'bjobs', 'bpeek', 'bkill', 'sha256sum'];
  const result = await runProcess('ssh', sshArgs(access.host, `set -eu; root=$(cd ${shellQuote(access.remoteRoot)} && pwd -P); printf 'ROOT=%s\\n' "$root"; for cmd in ${commands.map(shellQuote).join(' ')}; do p=$(command -v "$cmd" 2>/dev/null || true); printf 'CMD=%s|%s\\n' "$cmd" "$p"; done`));
  if (result.code !== 0) explainFailure(result);
  const report: RemoteCapabilityReport = { host: access.host, remoteRoot: access.remoteRoot, reachable: true, canonicalRemoteRoot: result.stdout.match(/^ROOT=(.*)$/m)?.[1], commands: {}, observedAt: now() };
  for (const command of commands) {
    const found = result.stdout.match(new RegExp(`^CMD=${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|(.*)$`, 'm'))?.[1] ?? '';
    report.commands[command] = found ? { available: true, path: found } : { available: false };
  }
  report.scheduler = report.commands.bsub.available ? 'lsf' : undefined;
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.inspected', actorType: 'system', payload: report as unknown as Record<string, unknown> });
  return report;
}

async function existsRemote(host: string, target: string): Promise<boolean> {
  const result = await runProcess('ssh', sshArgs(host, `test -e ${shellQuote(target)}`));
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  explainFailure(result);
}

async function validateRemoteParent(host: string, boundary: string, target: string, create: boolean): Promise<void> {
  const parent = target.slice(0, target.lastIndexOf('/')) || '/';
  const result = await runProcess('ssh', sshArgs(host, `set -eu; root=$(cd ${shellQuote(boundary)} && pwd -P); target=${shellQuote(parent)}; probe="$target"; while [ ! -e "$probe" ]; do next=\${probe%/*}; [ "$next" != "$probe" ] || exit 74; probe="$next"; done; actual=$(cd "$probe" && pwd -P); case "$actual" in "$root"|"$root"/*) ;; *) exit 73;; esac; ${create ? 'mkdir -p -- "$target"' : 'test -d "$target"'}`));
  if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Remote path resolves outside the approved root');
  if (result.code !== 0) explainFailure(result);
}

export async function upload(taskId: string, input: { host: unknown; remoteRoot: unknown; localPath: unknown; remotePath: unknown; overwrite?: boolean }) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'files.upload');
  if (typeof input.localPath !== 'string') throw new AgentCoreError(400, 'LOCAL_PATH_INVALID', 'localPath must be Task-relative');
  if (isProtectedRelativePath(input.localPath, access.envelope.protectedRelativePaths) || isProtectedRelativePath(input.remotePath, access.envelope.protectedRelativePaths)) throw new AgentCoreError(403, 'PROTECTED_PATH', 'Task Spec protects this path from overwrite');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { mustExist: true, allowRoot: false, label: 'upload source' });
  if (!fs.statSync(local).isFile()) throw new AgentCoreError(400, 'UPLOAD_FILE_REQUIRED', 'Upload source must be a file');
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  await validateRemoteParent(access.host, access.remoteRoot, remote, true);
  if (!input.overwrite && await existsRemote(access.host, remote)) throw new AgentCoreError(409, 'REMOTE_FILE_EXISTS', 'Remote target exists; overwrite is disabled');
  const result = await runProcess('sftp', sftpArgs(access.host), { input: `put ${sftpQuote(local)} ${sftpQuote(remote)}\n` });
  if (result.code !== 0) explainFailure(result);
  const payload = { host: access.host, localPath: String(input.localPath), remotePath: String(input.remotePath), size: fs.statSync(local).size };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.file_uploaded', actorType: 'system', payload });
  return payload;
}

export async function download(taskId: string, input: { host: unknown; remoteRoot: unknown; localPath: unknown; remotePath: unknown; overwrite?: boolean }) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'files.download');
  if (typeof input.localPath !== 'string') throw new AgentCoreError(400, 'LOCAL_PATH_INVALID', 'localPath must be Task-relative');
  if (isProtectedRelativePath(input.localPath, access.envelope.protectedRelativePaths)) throw new AgentCoreError(403, 'PROTECTED_PATH', 'Task Spec protects this local path from overwrite');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { allowRoot: false, label: 'download target' });
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  await validateRemoteParent(access.host, access.binding.userReadRoot, remote, false);
  if (!input.overwrite && fs.existsSync(local)) throw new AgentCoreError(409, 'LOCAL_FILE_EXISTS', 'Local target exists; overwrite is disabled');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const temporary = `${local}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const result = await runProcess('sftp', sftpArgs(access.host), { input: `get ${sftpQuote(remote)} ${sftpQuote(temporary)}\n` });
    if (result.code !== 0) explainFailure(result);
    fs.renameSync(temporary, local);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  const payload = { host: access.host, localPath: String(input.localPath), remotePath: String(input.remotePath), size: fs.statSync(local).size };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.file_downloaded', actorType: 'system', payload });
  return payload;
}

export interface LsfResources { queue: string | null; cores: number; wallMinutes: number }
export function parseLsfResources(script: string): LsfResources {
  const queue = script.match(/^\s*#BSUB\s+-q\s+([^\s#]+)\s*$/mi)?.[1] ?? null;
  const coresText = script.match(/^\s*#BSUB\s+-n\s+(\d+)\s*$/mi)?.[1];
  const wall = script.match(/^\s*#BSUB\s+-W\s+(\d+):(\d{2})\s*$/mi);
  if (!coresText || !wall) throw new AgentCoreError(400, 'LSF_RESOURCES_INCOMPLETE', 'LSF script must declare #BSUB -n and #BSUB -W HH:MM');
  const cores = Number(coresText); const hours = Number(wall[1]); const minutes = Number(wall[2]);
  if (!Number.isSafeInteger(cores) || cores <= 0 || minutes >= 60) throw new AgentCoreError(400, 'LSF_RESOURCES_INVALID', 'Invalid LSF resources');
  return { queue, cores, wallMinutes: hours * 60 + minutes };
}

export interface LsfActionSubmission {
  taskId: string; host: string; remoteRoot: string; remoteWorkdir: string; remoteScriptPath: string;
  scriptSha256: string; remoteInputs: Array<{ remotePath: string; sha256: string }>;
  resources: LsfResources; idempotencyKey?: string;
}

function serializeJob(row: any): RemoteJob {
  const { submission_spec_json, resources_json, last_observation_json, ...rest } = row;
  return { ...rest, submission_spec: JSON.parse(submission_spec_json), resources: JSON.parse(resources_json), last_observation: JSON.parse(last_observation_json) } as RemoteJob;
}

function parseJobId(output: string): string | null { return output.match(/Job\s+<([0-9]+)>/i)?.[1] ?? null; }
function loadJob(id: string): any {
  const row = db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id);
  if (!row) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
  return row;
}

function markSubmissionUncertain(action: RunAction, jobId: string, detail: Record<string, unknown>) {
  const observedAt = now();
  db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', last_observation_json = ?, reconciled_at = ? WHERE id = ?").run(stableJson({ ...detail, observedAt }), observedAt, jobId);
  scheduleNewJob(action.run_id, jobId, 'submission_uncertain', observedAt);
  createPendingItem(action.run_id, { stageId: action.stage_id, actionId: action.id, remoteJobId: jobId, audience: 'codex', kind: 'submission_uncertain', title: '远程提交响应不确定，必须先按唯一作业名对账', detail: { ...detail, blocksRun: false, recovery: 'reconcile_by_job_name_never_resubmit' }, idempotencyKey: `submission-uncertain:${jobId}`, source: 'workbench' });
}

export async function submitAuthorizedLsfAction(action: RunAction, input: LsfActionSubmission): Promise<RemoteJob> {
  if (process.env.WORKBENCH_ALLOW_REMOTE_LSF !== '1') throw new AgentCoreError(403, 'REMOTE_LSF_ENV_DISABLED', 'Set WORKBENCH_ALLOW_REMOTE_LSF=1 to enable scientific LSF submission');
  const access = authorizeRemoteOperation(input.taskId, input.host, input.remoteRoot, 'job.submit');
  if (access.run.id !== action.run_id || action.stage_id !== access.run.current_stage_id && !access.envelope.coreStageIds.includes(action.stage_id)) throw new AgentCoreError(409, 'REMOTE_ACTION_RUN_MISMATCH', 'Action is outside the active Run');
  if (input.resources.cores > access.envelope.resourceLimits.maxCoresPerJob) throw new AgentCoreError(403, 'REMOTE_CORES_DENIED', 'LSF cores exceed the confirmed Task Spec');
  if (input.resources.wallMinutes > access.envelope.resourceLimits.maxWallMinutes) throw new AgentCoreError(403, 'REMOTE_WALLTIME_DENIED', 'LSF walltime exceeds the confirmed Task Spec');
  const openJobs = (db.prepare("SELECT COUNT(*) count FROM remote_jobs WHERE run_id = ? AND lower(status) NOT IN ('done','exit','zombi','unkwn','preparation_failed','cancelled')").get(action.run_id) as { count: number }).count;
  if (openJobs >= access.envelope.resourceLimits.maxConcurrentJobs) throw new AgentCoreError(409, 'REMOTE_CONCURRENCY_LIMIT', 'Confirmed concurrent-job limit reached');
  const idempotencyKey = input.idempotencyKey?.trim() || `submit:${action.id}:${input.scriptSha256}:${input.remoteWorkdir}`;
  const existing = db.prepare('SELECT * FROM remote_jobs WHERE run_id = ? AND idempotency_key = ?').get(action.run_id, idempotencyKey) as any;
  if (existing) return serializeJob(existing);
  const remoteWorkdir = remoteRelative(access.remoteRoot, input.remoteWorkdir);
  remoteRelative(remoteWorkdir, input.remoteScriptPath);
  input.remoteInputs.forEach(item => remoteRelative(remoteWorkdir, item.remotePath));
  const token = crypto.createHash('sha256').update(`workbench:${action.run_id}:${idempotencyKey}`).digest('hex').slice(0, 24);
  const jobName = `wb-${token.slice(0, 12)}`;
  const id = newId('rjob');
  db.prepare(`INSERT INTO remote_jobs (
    id, run_id, action_id, stage_id, action_token, idempotency_key, profile_id, host,
    remote_workdir, scheduler, job_name, status, submission_spec_json, script_sha256,
    resources_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lsf', ?, 'prepared', ?, ?, ?, ?)`)
    .run(id, action.run_id, action.id, action.stage_id, token, idempotencyKey, access.binding.profileId, access.host, remoteWorkdir, jobName, stableJson(input), input.scriptSha256, stableJson(input.resources), now());
  const guard = `task_root=$(cd ${shellQuote(access.binding.taskWriteRoot)} && pwd -P); work_root=$(cd ${shellQuote(remoteWorkdir)} && pwd -P); case "$work_root" in "$task_root"|"$task_root"/*) ;; *) exit 73;; esac`;
  try {
    const bound = [{ remotePath: input.remoteScriptPath, sha256: input.scriptSha256 }, ...input.remoteInputs];
    const checks = bound.map((item, index) => `test -f ${shellQuote(item.remotePath)}; h${index}=$(sha256sum -- ${shellQuote(item.remotePath)}); h${index}=\${h${index}%% *}; test "$h${index}" = ${shellQuote(item.sha256)}`).join('; ');
    const verified = await runProcess('ssh', sshArgs(access.host, `set -eu; ${guard}; cd "$work_root"; command -v sha256sum >/dev/null; ${checks}`));
    if (verified.code !== 0) explainFailure(verified);
  } catch (error) {
    const item = error as AgentCoreError;
    db.prepare("UPDATE remote_jobs SET status = 'preparation_failed', submit_stderr = ?, reconciled_at = ? WHERE id = ?").run(`${item.code ?? 'FAILED'}: ${item.message}`, now(), id);
    scheduleNewJob(action.run_id, id, 'preparation_failed');
    throw error;
  }
  let submitted: ProcessResult;
  try { submitted = await runProcess('ssh', sshArgs(access.host, `set -eu; ${guard}; cd "$work_root"; bsub -J ${shellQuote(jobName)} < ${shellQuote(input.remoteScriptPath)}`)); }
  catch (error) {
    markSubmissionUncertain(action, id, { code: (error as AgentCoreError).code ?? 'SSH_FAILED', message: (error as Error).message, jobName });
    return serializeJob(loadJob(id));
  }
  const schedulerJobId = parseJobId(`${submitted.stdout}\n${submitted.stderr}`);
  db.prepare('UPDATE remote_jobs SET submit_stdout = ?, submit_stderr = ? WHERE id = ?').run(submitted.stdout, submitted.stderr, id);
  if (submitted.code !== 0 || !schedulerJobId) {
    markSubmissionUncertain(action, id, { jobName, stdout: submitted.stdout, stderr: submitted.stderr });
    return serializeJob(loadJob(id));
  }
  const sanity = await runProcess('ssh', sshArgs(access.host, `bjobs -a ${shellQuote(schedulerJobId)} -noheader -o 'jobid stat job_name'`));
  const fields = sanity.stdout.trim().split(/\s+/);
  if (sanity.code !== 0 || fields[0] !== schedulerJobId || fields[2] !== jobName) {
    db.prepare('UPDATE remote_jobs SET job_id = ? WHERE id = ?').run(schedulerJobId, id);
    markSubmissionUncertain(action, id, { jobName, schedulerJobId, sanityStdout: sanity.stdout, sanityStderr: sanity.stderr });
    return serializeJob(loadJob(id));
  }
  const observedAt = now();
  const schedulerStatus = fields[1].toLowerCase();
  db.prepare('UPDATE remote_jobs SET job_id = ?, status = ?, submitted_at = ?, reconciled_at = ?, last_observation_json = ? WHERE id = ?')
    .run(schedulerJobId, schedulerStatus, observedAt, observedAt, stableJson({ source: 'post-submit-sanity', jobId: schedulerJobId, status: fields[1], jobName, observedAt }), id);
  scheduleNewJob(action.run_id, id, schedulerStatus, observedAt);
  appendEvent(action.run_id, { category: 'fact', eventType: 'remote.job_submitted', actorType: 'system', payload: { remoteJobId: id, actionId: action.id, jobId: schedulerJobId, jobName, remoteWorkdir, resources: input.resources } });
  return serializeJob(loadJob(id));
}

function recordedJobAccess(row: any, operation: string) {
  const run = getRun(row.run_id);
  const task = runtimeTask(run.task_id);
  const binding = resolveRemoteTaskBinding(task.hpc_config, task.id, row.host);
  return authorizeRemoteOperation(task.id, row.host, binding.taskWriteRoot, operation);
}

function schedulerObservation(output: string) {
  const fields = output.trim().split(/\s+/);
  return { jobId: fields[0] || null, status: (fields[1] || 'UNKWN').toUpperCase(), jobName: fields[2] || null };
}

function queueReasonFromLongOutput(output: string): string {
  const normalized = output.replace(/\r/g, '').trim();
  if (!normalized) return '';
  const marker = normalized.match(/PENDING REASONS?:\s*([\s\S]*?)(?:\n\s*\n|$)/i)?.[1];
  const candidate = (marker ?? normalized).split('\n').map(line => line.trim()).filter(Boolean).join(' ');
  return candidate.slice(0, 1000);
}

async function observeJob(row: any) {
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job has no scheduler job ID');
  let source = 'bjobs'; let result = await runProcess('ssh', sshArgs(row.host, `bjobs -a ${shellQuote(row.job_id)} -noheader -o 'jobid stat job_name'`));
  if (result.code !== 0 || !result.stdout.trim()) { source = 'bhist'; result = await runProcess('ssh', sshArgs(row.host, `bhist -a ${shellQuote(row.job_id)} -noheader -o 'jobid stat job_name'`)); }
  if (result.code !== 0 || !result.stdout.trim()) explainFailure(result);
  const parsed = schedulerObservation(result.stdout);
  const observedAt = now();
  let queueReason = '';
  if (parsed.status === 'PEND') {
    const detail = await runProcess('ssh', sshArgs(row.host, `bjobs -l ${shellQuote(row.job_id)}`));
    if (detail.code === 0) queueReason = queueReasonFromLongOutput(detail.stdout);
  }
  const observation = { source, ...parsed, raw: result.stdout, queueReason, observedAt };
  db.prepare('UPDATE remote_jobs SET status = ?, last_observation_json = ?, reconciled_at = ? WHERE id = ?').run(parsed.status.toLowerCase(), stableJson(observation), observedAt, row.id);
  recordJobObservation(row.id, row.status, parsed.status, queueReason, observedAt);
  const action = db.prepare('SELECT status, stage_id FROM run_actions WHERE id = ?').get(row.action_id) as { status: string; stage_id: string } | undefined;
  if (action && !['succeeded', 'failed', 'cancelled'].includes(action.status)) {
    if (parsed.status === 'DONE') transitionAction(row.action_id, { status: 'succeeded', result: { remoteJobId: row.id, schedulerStatus: parsed.status } });
    else if (['EXIT', 'ZOMBI', 'UNKWN'].includes(parsed.status)) {
      transitionAction(row.action_id, { status: 'waiting_codex', error: { code: 'REMOTE_JOB_FAILED', remoteJobId: row.id, schedulerStatus: parsed.status } });
      createPendingItem(row.run_id, { stageId: action.stage_id, actionId: row.action_id, remoteJobId: row.id, audience: 'codex', kind: 'remote_job_failed', title: '远程作业失败，等待 Codex 诊断和边界内重试', detail: { schedulerStatus: parsed.status, blocksRun: false }, idempotencyKey: `remote-job-failed:${row.id}`, source: 'workbench' });
    } else if (action.status === 'waiting_codex') {
      transitionAction(row.action_id, { status: 'executing', result: { remoteJobId: row.id, reconciled: true } });
      transitionAction(row.action_id, { status: 'waiting_remote', result: { remoteJobId: row.id, schedulerStatus: parsed.status } });
    } else if (action.status === 'executing') transitionAction(row.action_id, { status: 'waiting_remote', result: { remoteJobId: row.id, schedulerStatus: parsed.status } });
  }
  appendEvent(row.run_id, { category: 'fact', eventType: 'remote.job_reconciled', actorType: 'system', payload: { remoteJobId: row.id, ...observation } });
  return serializeJob(loadJob(row.id));
}

async function identifyUncertainJob(row: any) {
  const query = async (command: 'bjobs' | 'bhist') => runProcess('ssh', sshArgs(row.host, `${command} -a -J ${shellQuote(row.job_name)} -noheader -o 'jobid stat job_name'`));
  let result = await query('bjobs'); if (result.code !== 0 || !result.stdout.trim()) result = await query('bhist');
  const matches = result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts.length >= 3 && parts[2] === row.job_name && /^\d+$/.test(parts[0]));
  const ids = [...new Set(matches.map(parts => parts[0]))];
  if (ids.length === 1) {
    db.prepare("UPDATE remote_jobs SET job_id = ?, status = 'recovered', reconciled_at = ? WHERE id = ?").run(ids[0], now(), row.id);
    return observeJob(loadJob(row.id));
  }
  db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', last_observation_json = ?, reconciled_at = ? WHERE id = ?").run(stableJson({ candidates: ids, raw: result.stdout, observedAt: now() }), now(), row.id);
  return serializeJob(loadJob(row.id));
}

export async function jobStatus(id: string) { const row = loadJob(id); recordedJobAccess(row, 'job.status'); return observeJob(row); }
export async function reconcileJob(id: string) { const row = loadJob(id); recordedJobAccess(row, 'job.reconcile'); return row.job_id ? observeJob(row) : identifyUncertainJob(row); }

export async function jobLogs(id: string) {
  const row = loadJob(id); recordedJobAccess(row, 'job.logs');
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job has no scheduler job ID');
  const result = await runProcess('ssh', sshArgs(row.host, `bpeek ${shellQuote(row.job_id)}`));
  if (result.code !== 0) explainFailure(result);
  return { remoteJobId: id, jobId: row.job_id, source: 'bpeek', stdout: result.stdout, stderr: result.stderr, observedAt: now() };
}

export async function cancelJob(id: string) {
  const row = loadJob(id); const access = recordedJobAccess(row, 'job.cancel');
  if (access.run.id !== row.run_id) throw new AgentCoreError(409, 'REMOTE_JOB_NOT_CURRENT_RUN', 'Only jobs owned by the current Run may be cancelled');
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job has no scheduler job ID');
  const result = await runProcess('ssh', sshArgs(row.host, `bkill ${shellQuote(row.job_id)}`));
  if (result.code !== 0) explainFailure(result);
  db.prepare("UPDATE remote_jobs SET status = 'cancel_requested', reconciled_at = ? WHERE id = ?").run(now(), id);
  scheduleNewJob(row.run_id, id, 'cancel_requested');
  const action = db.prepare('SELECT status FROM run_actions WHERE id = ?').get(row.action_id) as { status: string } | undefined;
  if (action && ['executing', 'waiting_remote', 'waiting_codex'].includes(action.status)) transitionAction(row.action_id, { status: 'cancelled', result: { remoteJobId: id, jobId: row.job_id, cancelRequested: true } });
  appendEvent(row.run_id, { category: 'decision', eventType: 'remote.job_cancel_requested', actorType: 'agent', payload: { remoteJobId: id, jobId: row.job_id, reason: 'Codex determined the current-Run job was wrong or replaced within confirmed autonomy' } });
  return serializeJob(loadJob(id));
}
