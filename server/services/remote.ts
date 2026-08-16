import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../db.js';
import type { AgentPolicyDocument, RemoteCapabilityReport, RemoteJob, ResearchContract, RunAction } from '../../src/types/index.js';
import { AgentCoreError, appendEvent, createReview, effectivePolicy, hashJson, newId, normalizeRemoteRoot, now, parseContract, policyRemoteRoots, stableJson } from './agentCore.js';
import { transitionAction } from './agentActions.js';
import { isRemotePathWithin, resolveRemoteTaskBinding, type ResolvedRemoteTaskBinding } from './hpcConfig.js';
import { isPathInside, resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

const MAX_OUTPUT = 1024 * 1024;
const SSH_TIMEOUT_MS = 20_000;

interface ProcessResult { code: number; stdout: string; stderr: string }
export type RemoteProcessRunner = (command: string, args: string[], options: { input?: string; timeoutMs?: number }) => Promise<ProcessResult>;
let remoteProcessRunnerForTests: RemoteProcessRunner | null = null;

export function setRemoteProcessRunnerForTests(runner: RemoteProcessRunner | null): void {
  if (process.env.WORKBENCH_REMOTE_TEST_MODE !== '1') {
    throw new AgentCoreError(403, 'REMOTE_TEST_MODE_DISABLED', 'Remote process injection is available only in explicit test mode');
  }
  remoteProcessRunnerForTests = runner;
}

function runProcess(command: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<ProcessResult> {
  if (remoteProcessRunnerForTests) return remoteProcessRunnerForTests(command, args, options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let killedForLimit = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? SSH_TIMEOUT_MS);
    const collect = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT) { killedForLimit = true; child.kill(); }
      return next.slice(0, MAX_OUTPUT);
    };
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', error => { clearTimeout(timer); reject(new AgentCoreError(502, 'OPENSSH_UNAVAILABLE', error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (killedForLimit) return reject(new AgentCoreError(502, 'REMOTE_OUTPUT_LIMIT', 'Remote command exceeded the output limit'));
      if (timedOut) return reject(new AgentCoreError(502, 'SSH_TIMEOUT', `OpenSSH operation exceeded ${options.timeoutMs ?? SSH_TIMEOUT_MS} ms`));
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.end(options.input); else child.stdin.end();
  });
}

function validateHost(host: unknown): string {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(host)) throw new AgentCoreError(400, 'REMOTE_HOST_INVALID', 'Host must be an OpenSSH alias or hostname');
  return host;
}

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

function remoteRelative(root: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\r') || relative.includes('\n') || relative.includes('\0')) throw new AgentCoreError(400, 'REMOTE_PATH_INVALID', 'Remote path must be relative');
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new AgentCoreError(400, 'REMOTE_PATH_INVALID', 'Remote path contains traversal');
  return `${normalizeRemoteRoot(root).replace(/\/$/, '')}/${parts.join('/')}`;
}

function sshArgs(host: string, command: string): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', host, command];
}

function sftpArgs(host: string): string[] {
  return ['-q', '-b', '-', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', host];
}

function sftpQuote(value: string): string {
  if (value.includes('\r') || value.includes('\n') || value.includes('\0') || value.includes('"')) throw new AgentCoreError(400, 'SFTP_PATH_INVALID', 'SFTP path contains unsupported characters');
  return `"${value}"`;
}

export interface RemoteAccess {
  task: any;
  run: any;
  policy: AgentPolicyDocument;
  contract: ResearchContract;
  host: string;
  remoteRoot: string;
  taskRoot: string;
  binding: ResolvedRemoteTaskBinding;
}

export function isProtectedRelativePath(relativePath: unknown, protectedPaths: string[]): boolean {
  if (typeof relativePath !== 'string') return false;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return protectedPaths.some(protectedPath => normalized === protectedPath || normalized.startsWith(`${protectedPath}/`));
}

export function smokeBudgetAllowsOneCoreMinute(policy: AgentPolicyDocument, contract: ResearchContract): boolean {
  return policy.limits.maxCoresPerJob >= 1
    && policy.limits.maxWallMinutes >= 1
    && contract.resourceBudget.maxCoresPerJob >= 1
    && contract.resourceBudget.maxWallMinutes >= 1;
}

export function authorizeRemoteOperation(taskId: string, hostInput: unknown, rootInput: unknown, operation: string, smoke = false, requireEnvironment = true): RemoteAccess {
  if (requireEnvironment && process.env.WORKBENCH_REMOTE_ENABLED !== '1') throw new AgentCoreError(403, 'REMOTE_ENV_DISABLED', 'Set WORKBENCH_REMOTE_ENABLED=1 to enable remote actions');
  const task = db.prepare(`SELECT tasks.*, projects.working_dir, projects.hpc_config FROM tasks JOIN projects ON projects.id = tasks.project_id WHERE tasks.id = ?`).get(taskId) as any;
  if (!task) throw new AgentCoreError(404, 'TASK_NOT_FOUND', 'Task not found');
  if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
  const run = db.prepare("SELECT * FROM research_runs WHERE task_id = ? AND status IN ('active','waiting_review') ORDER BY started_at DESC LIMIT 1").get(taskId) as any;
  if (!run) throw new AgentCoreError(409, 'RUN_NOT_STARTED', 'An active run is required');
  const { effective, sources } = effectivePolicy(task.project_id, taskId);
  if (!sources.some(source => source.scope_type === 'task' && source.status === 'active')) throw new AgentCoreError(403, 'TASK_POLICY_REQUIRED', 'An active task policy is required for remote actions');
  if (!effective.remoteEnabled) throw new AgentCoreError(403, 'REMOTE_POLICY_DISABLED', 'Effective policy disables remote actions');
  const adoptedContext = db.prepare('SELECT policy_sha256, contract_content FROM run_context_versions WHERE id = ?').get(run.current_context_version_id) as { policy_sha256: string; contract_content: string } | undefined;
  if (!adoptedContext || adoptedContext.policy_sha256 !== hashJson(effective)) throw new AgentCoreError(409, 'POLICY_CONTEXT_DRIFT', 'Active policy must be explicitly adopted into a new run context before remote actions');
  if (!effective.allowedOperations.includes(operation)) throw new AgentCoreError(403, 'REMOTE_OPERATION_DENIED', `Policy does not allow ${operation}`);
  const host = validateHost(hostInput);
  if (!effective.allowedHosts.includes(host)) throw new AgentCoreError(403, 'REMOTE_HOST_DENIED', 'Host is outside the effective policy');
  const binding = resolveRemoteTaskBinding(task.hpc_config, taskId, host);
  const policyRoots = policyRemoteRoots(effective);
  if (policyRoots.legacy || !policyRoots.readRoot || !policyRoots.projectRoot || !policyRoots.writeRoot) {
    throw new AgentCoreError(409, 'REMOTE_SPLIT_BOUNDARY_REQUIRED', 'Remote actions require separate read, project and Task write roots in the effective policy');
  }
  if (
    policyRoots.readRoot !== binding.userReadRoot
    || policyRoots.projectRoot !== binding.projectRoot
    || policyRoots.writeRoot !== binding.taskWriteRoot
  ) {
    throw new AgentCoreError(409, 'REMOTE_BOUNDARY_CONFIG_DRIFT', 'Effective policy roots do not match the registered project and Task directory binding');
  }
  const remoteRoot = normalizeRemoteRoot(String(rootInput ?? ''));
  const readOperation = operation === 'remote.inspect' || operation === 'files.download';
  if (readOperation) {
    if (!isRemotePathWithin(remoteRoot, binding.userReadRoot)) throw new AgentCoreError(403, 'REMOTE_READ_ROOT_DENIED', 'Read operation is outside the registered user read root');
  } else if (remoteRoot !== binding.taskWriteRoot) {
    throw new AgentCoreError(403, 'REMOTE_WRITE_ROOT_DENIED', 'Write and scheduler operations must use the registered Task write root');
  }
  if (smoke) {
    if (process.env.WORKBENCH_ALLOW_REMOTE_SMOKE !== '1') throw new AgentCoreError(403, 'REMOTE_SMOKE_ENV_DISABLED', 'Set WORKBENCH_ALLOW_REMOTE_SMOKE=1 to enable smoke submission');
    if (!effective.smokeAuthorized) throw new AgentCoreError(403, 'REMOTE_SMOKE_POLICY_DENIED', 'Effective policy does not authorize smoke submission');
  }
  const taskRoot = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  if (effective.localRoot && !isPathInside(path.resolve(effective.localRoot), path.resolve(taskRoot))) {
    throw new AgentCoreError(403, 'LOCAL_ROOT_DENIED', 'Task root is outside the effective local policy root');
  }
  return { task, run, policy: effective, contract: parseContract(adoptedContext.contract_content), host, remoteRoot, taskRoot, binding };
}

export async function createRemoteTaskRoot(taskId: string, input: { host: unknown; remoteRoot: unknown }) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'remote.task-root.create');
  const script = [
    'set -eu',
    `read_root=$(cd ${shellQuote(access.binding.userReadRoot)} && pwd -P)`,
    `project_root=$(cd ${shellQuote(access.binding.projectRoot)} && pwd -P)`,
    'case "$project_root" in "$read_root"/*) ;; *) exit 73;; esac',
    `target=${shellQuote(access.binding.taskWriteRoot)}`,
    'created=0',
    'if [ -e "$target" ]; then test -d "$target"; else mkdir -- "$target"; created=1; fi',
    'task_root=$(cd "$target" && pwd -P)',
    'case "$task_root" in "$project_root"/*) ;; *) exit 73;; esac',
    'test "${task_root%/*}" = "$project_root"',
    'printf "PROJECT_ROOT=%s\\nTASK_ROOT=%s\\nCREATED=%s\\n" "$project_root" "$task_root" "$created"',
  ].join('; ');
  const result = await runProcess('ssh', sshArgs(access.host, script));
  if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Configured remote Task root resolves outside the project root');
  if (result.code !== 0) explainSshFailure(result);
  const lines = result.stdout.split(/\r?\n/);
  const payload = {
    host: access.host,
    projectRoot: lines.find(line => line.startsWith('PROJECT_ROOT='))?.slice(13) ?? access.binding.projectRoot,
    taskRoot: lines.find(line => line.startsWith('TASK_ROOT='))?.slice(10) ?? access.binding.taskWriteRoot,
    created: lines.find(line => line.startsWith('CREATED='))?.slice(8) === '1',
  };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.task_root_ready', actorType: 'system', payload });
  return payload;
}

function explainSshFailure(result: ProcessResult): never {
  const text = `${result.stderr}\n${result.stdout}`;
  const code = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text) ? 'SSH_HOST_KEY_FAILED'
    : /Permission denied/i.test(text) ? 'SSH_AUTH_FAILED'
      : /timed out|Connection timeout/i.test(text) ? 'SSH_TIMEOUT'
        : 'SSH_COMMAND_FAILED';
  throw new AgentCoreError(502, code, text.trim() || `OpenSSH exited with code ${result.code}`);
}

export function parseLsfScheduler(lines: string[]): string | undefined {
  return lines.find(line => /\b(?:Platform|Spectrum) LSF\b/i.test(line))?.trim();
}

export async function inspectRemote(taskId: string, hostInput: unknown, rootInput: unknown): Promise<RemoteCapabilityReport> {
  const access = authorizeRemoteOperation(taskId, hostInput, rootInput, 'remote.inspect');
  const commands = ['lsid', 'bsub', 'bjobs', 'bhist', 'bpeek', 'bkill'];
  const script = `set -eu; read_root=$(cd ${shellQuote(access.binding.userReadRoot)} && pwd -P); root=$(cd ${shellQuote(access.remoteRoot)} && pwd -P); case "$root" in "$read_root"|"$read_root"/*) ;; *) exit 73;; esac; cd "$root"; printf 'ROOT=%s\\n' "$root"; ${commands.map(name => `printf '${name}='; command -v ${name} || true`).join('; ')}; lsid 2>/dev/null || true`;
  let result: ProcessResult;
  try {
    result = await runProcess('ssh', sshArgs(access.host, script));
    if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Remote inspection root resolves outside the registered user read root');
    if (result.code !== 0) explainSshFailure(result);
  } catch (error) {
    const item = error as AgentCoreError;
    appendEvent(access.run.id, { category: 'fact', eventType: 'remote.capability_failed', actorType: 'system', payload: { host: access.host, remoteRoot: access.remoteRoot, code: item.code ?? 'SSH_FAILED', message: item.message } });
    throw error;
  }
  const lines = result.stdout.split(/\r?\n/);
  const paths: RemoteCapabilityReport['commands'] = {};
  for (const name of commands) {
    const line = lines.find(item => item.startsWith(`${name}=`)); const commandPath = line?.slice(name.length + 1).trim();
    paths[name] = commandPath ? { available: true, path: commandPath } : { available: false };
  }
  const report: RemoteCapabilityReport = { host: access.host, remoteRoot: access.remoteRoot, reachable: true, canonicalRemoteRoot: lines.find(line => line.startsWith('ROOT='))?.slice(5), commands: paths, scheduler: parseLsfScheduler(lines), observedAt: now() };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.capability_inspected', actorType: 'system', payload: report as unknown as Record<string, unknown> });
  return report;
}

async function existsRemote(host: string, remotePath: string): Promise<boolean> {
  const result = await runProcess('ssh', sshArgs(host, `test -e ${shellQuote(remotePath)}`));
  return result.code === 0;
}

async function prepareRemoteParent(host: string, remoteRoot: string, targetPath: string, create: boolean, scopeRoot: string, directRoot = false): Promise<void> {
  const parent = targetPath.slice(0, targetPath.lastIndexOf('/')) || '/';
  const directCheck = directRoot ? 'test "${root%/*}" = "$scope"' : ':';
  const script = `set -eu; scope=$(cd ${shellQuote(scopeRoot)} && pwd -P); root=$(cd ${shellQuote(remoteRoot)} && pwd -P); case "$root" in "$scope"|"$scope"/*) ;; *) exit 73;; esac; ${directCheck}; target=${shellQuote(parent)}; probe="$target"; while [ ! -e "$probe" ]; do next=\${probe%/*}; [ "$next" != "$probe" ] || exit 74; probe="$next"; done; actual=$(cd "$probe" && pwd -P); case "$actual" in "$root"|"$root"/*) ;; *) exit 73;; esac; ${create ? 'mkdir -p -- "$target"' : 'test -d "$target"'}; final=$(cd "$target" && pwd -P); case "$final" in "$root"|"$root"/*) ;; *) exit 73;; esac`;
  const result = await runProcess('ssh', sshArgs(host, script));
  if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Remote path resolves outside the approved root');
  if (result.code !== 0) explainSshFailure(result);
}

export async function upload(taskId: string, input: any) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'files.upload');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { mustExist: true, allowRoot: false, label: 'local upload path' });
  if (!fs.statSync(local).isFile()) throw new AgentCoreError(400, 'UPLOAD_FILE_REQUIRED', 'Upload source must be a file');
  if (fs.statSync(local).size > 10 * 1024 * 1024) throw new AgentCoreError(413, 'UPLOAD_TOO_LARGE', 'V1 upload limit is 10 MB');
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  if (input.overwrite === true && isProtectedRelativePath(input.remotePath, access.policy.protectedPaths)) {
    throw new AgentCoreError(403, 'PROTECTED_PATH', 'Policy forbids overwriting this remote path');
  }
  await prepareRemoteParent(access.host, access.remoteRoot, remote, true, access.binding.projectRoot, true);
  if (!input.overwrite && await existsRemote(access.host, remote)) throw new AgentCoreError(409, 'REMOTE_FILE_EXISTS', 'Remote target exists; overwrite is disabled');
  const result = await runProcess('sftp', sftpArgs(access.host), { input: `put ${sftpQuote(local)} ${sftpQuote(remote)}\n` });
  if (result.code !== 0) explainSshFailure(result);
  const payload = { host: access.host, localPath: input.localPath, remotePath: input.remotePath, size: fs.statSync(local).size };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.file_uploaded', actorType: 'system', payload });
  return payload;
}

export async function download(taskId: string, input: any) {
  const access = authorizeRemoteOperation(taskId, input.host, input.remoteRoot, 'files.download');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { allowRoot: false, label: 'local download path' });
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  await prepareRemoteParent(access.host, access.remoteRoot, remote, false, access.binding.userReadRoot);
  if (input.overwrite === true && isProtectedRelativePath(input.localPath, access.policy.protectedPaths)) {
    throw new AgentCoreError(403, 'PROTECTED_PATH', 'Policy forbids overwriting this local path');
  }
  if (!input.overwrite && fs.existsSync(local)) throw new AgentCoreError(409, 'LOCAL_FILE_EXISTS', 'Local target exists; overwrite is disabled');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const temp = `${local}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const result = await runProcess('sftp', sftpArgs(access.host), { input: `get ${sftpQuote(remote)} ${sftpQuote(temp)}\n` });
    if (result.code !== 0) explainSshFailure(result);
    fs.renameSync(temp, local);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  const payload = { host: access.host, localPath: input.localPath, remotePath: input.remotePath, size: fs.statSync(local).size };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.file_downloaded', actorType: 'system', payload });
  return payload;
}

function serializeJob(row: any): RemoteJob {
  return {
    ...row,
    execution_manifest: JSON.parse(row.execution_manifest_json),
    resources: JSON.parse(row.resources_json),
    last_observation: JSON.parse(row.last_observation_json),
  };
}

function parseJobId(output: string): string | null { return output.match(/Job\s+<([0-9]+)>/i)?.[1] ?? null; }

export interface LsfResources {
  queue: string | null;
  cores: number;
  wallMinutes: number;
}

export function parseLsfResources(script: string): LsfResources {
  const queue = script.match(/^\s*#BSUB\s+-q\s+([^\s#]+)\s*$/mi)?.[1] ?? null;
  const coresText = script.match(/^\s*#BSUB\s+-n\s+(\d+)\s*$/mi)?.[1];
  const wall = script.match(/^\s*#BSUB\s+-W\s+(\d+):(\d{2})\s*$/mi);
  if (!coresText || !wall) {
    throw new AgentCoreError(400, 'LSF_RESOURCES_INCOMPLETE', 'LSF script must declare #BSUB -n and #BSUB -W HH:MM');
  }
  const cores = Number(coresText);
  const hours = Number(wall[1]);
  const minutes = Number(wall[2]);
  if (!Number.isSafeInteger(cores) || cores <= 0 || minutes >= 60) {
    throw new AgentCoreError(400, 'LSF_RESOURCES_INVALID', 'LSF cores and walltime must be positive and use HH:MM');
  }
  return { queue, cores, wallMinutes: hours * 60 + minutes };
}

function assertScientificBudget(access: RemoteAccess, resources: LsfResources): void {
  if (resources.cores > access.policy.limits.maxCoresPerJob || resources.cores > access.contract.resourceBudget.maxCoresPerJob) {
    throw new AgentCoreError(403, 'REMOTE_CORES_DENIED', 'LSF cores exceed the adopted contract or effective policy');
  }
  if (resources.wallMinutes > access.policy.limits.maxWallMinutes || resources.wallMinutes > access.contract.resourceBudget.maxWallMinutes) {
    throw new AgentCoreError(403, 'REMOTE_WALLTIME_DENIED', 'LSF walltime exceeds the adopted contract or effective policy');
  }
}

function taskWorkdirGuard(access: RemoteAccess, remoteWorkdir: string): string {
  return `project_root=$(cd ${shellQuote(access.binding.projectRoot)} && pwd -P); task_root=$(cd ${shellQuote(access.binding.taskWriteRoot)} && pwd -P); case "$task_root" in "$project_root"/*) ;; *) exit 73;; esac; test "\${task_root%/*}" = "$project_root"; work_root=$(cd ${shellQuote(remoteWorkdir)} && pwd -P); case "$work_root" in "$task_root"|"$task_root"/*) ;; *) exit 73;; esac`;
}

export interface LsfActionSubmission {
  taskId: string;
  host: string;
  remoteRoot: string;
  remoteWorkdir: string;
  remoteScriptPath: string;
  scriptSha256: string;
  remoteInputs: Array<{ remotePath: string; sha256: string }>;
  resources: LsfResources;
}

/**
 * Submit the exact LSF script bound to an already-authorized Codex action.
 * The job row is inserted before bsub and one action can own only one job, so
 * a lost response is reconciled and never retried as a second submission.
 */
export async function submitAuthorizedLsfAction(action: RunAction, input: LsfActionSubmission): Promise<RemoteJob> {
  if (process.env.WORKBENCH_ALLOW_REMOTE_LSF !== '1') {
    throw new AgentCoreError(403, 'REMOTE_LSF_ENV_DISABLED', 'Set WORKBENCH_ALLOW_REMOTE_LSF=1 to enable authorized scientific LSF submission');
  }
  const access = authorizeRemoteOperation(input.taskId, input.host, input.remoteRoot, 'job.submit');
  if (access.run.id !== action.run_id || access.run.current_context_version_id !== action.context_version_id) {
    throw new AgentCoreError(409, 'REMOTE_ACTION_CONTEXT_MISMATCH', 'Remote access does not belong to the authorized action context');
  }
  assertScientificBudget(access, input.resources);
  const concurrentLimit = Math.min(access.policy.limits.maxConcurrentJobs, access.contract.resourceBudget.maxConcurrentJobs);
  const existing = db.prepare('SELECT * FROM remote_jobs WHERE action_id = ?').get(action.id) as any;
  if (existing) return serializeJob(existing);
  const openJobs = (db.prepare(`SELECT COUNT(*) AS count FROM remote_jobs WHERE run_id = ? AND lower(status) NOT IN ('done', 'exit', 'zombi', 'unkwn', 'preparation_failed')`).get(action.run_id) as { count: number }).count;
  if (openJobs >= concurrentLimit) throw new AgentCoreError(409, 'REMOTE_CONCURRENCY_LIMIT', 'The adopted contract or policy concurrent-job limit has been reached');

  const token = crypto.createHash('sha256').update(`workbench-lsf:${action.id}`).digest('hex').slice(0, 24);
  const jobName = `wb-action-${token.slice(0, 10)}`;
  const remoteWorkdir = remoteRelative(access.remoteRoot, input.remoteWorkdir);
  const workdirGuard = taskWorkdirGuard(access, remoteWorkdir);
  remoteRelative(remoteWorkdir, input.remoteScriptPath); // validate the bound script path before any job row is created
  for (const item of input.remoteInputs) remoteRelative(remoteWorkdir, item.remotePath);
  const id = newId('rjob');
  const timestamp = now();
  db.prepare(`
    INSERT INTO remote_jobs (
      id, run_id, context_version_id, action_id, step_id, action_token,
      idempotency_key, host, remote_root, remote_workdir, job_name, status,
      execution_manifest_json, execution_manifest_sha256, script_sha256,
      resources_json, resources_sha256, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?)
  `).run(
    id, action.run_id, action.context_version_id, action.id, action.step_id, token,
    action.idempotency_key, access.host, access.remoteRoot, remoteWorkdir, jobName,
    stableJson(action.manifest), action.manifest_sha256, input.scriptSha256,
    stableJson(input.resources), hashJson(input.resources), timestamp,
  );

  const failPreparation = (error: unknown) => {
    const item = error as AgentCoreError;
    db.prepare("UPDATE remote_jobs SET status = 'preparation_failed', submit_stderr = ?, reconciled_at = ? WHERE id = ?")
      .run(`${item.code ?? 'REMOTE_PREPARATION_FAILED'}: ${item.message}`, now(), id);
    appendEvent(action.run_id, {
      category: 'fact', eventType: 'remote.scientific_preparation_failed', actorType: 'system',
      payload: { remoteJobId: id, actionId: action.id, code: item.code ?? 'REMOTE_PREPARATION_FAILED', message: item.message },
    });
  };

  try {
    const boundFiles = [
      { remotePath: input.remoteScriptPath, sha256: input.scriptSha256 },
      ...input.remoteInputs,
    ];
    const checks = boundFiles.map((item, index) => `test -f ${shellQuote(item.remotePath)}; actual_${index}=$(sha256sum -- ${shellQuote(item.remotePath)}); actual_${index}=\${actual_${index}%% *}; test "$actual_${index}" = ${shellQuote(item.sha256)}`).join('; ');
    const verify = await runProcess('ssh', sshArgs(access.host, `set -eu; ${workdirGuard}; cd "$work_root"; command -v sha256sum >/dev/null; ${checks}; printf 'VERIFIED_FILES=%s\\n' '${boundFiles.length}'`));
    if (verify.code !== 0) explainSshFailure(verify);
  } catch (error) {
    failPreparation(error);
    throw error;
  }

  let submit: ProcessResult;
  try {
    submit = await runProcess('ssh', sshArgs(access.host, `set -eu; ${workdirGuard}; cd "$work_root"; bsub -J ${shellQuote(jobName)} < ${shellQuote(input.remoteScriptPath)}`));
  } catch (error) {
    const item = error as AgentCoreError;
    db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', submit_stderr = ?, reconciled_at = ? WHERE id = ?")
      .run(`${item.code ?? 'SSH_FAILED'}: ${item.message}`, now(), id);
    createReview(action.run_id, {
      gateType: 'remote_submission_uncertain',
      question: '科学 LSF 提交响应不确定。Codex 必须按唯一 job name 对账，不得重提。',
      recommendation: { action: 'reconcile_by_job_name', jobName },
      evidence: [{ code: item.code ?? 'SSH_FAILED', message: item.message, jobName }],
      proposal: { remoteJobId: id, actionId: action.id },
      idempotencyKey: `remote-submission-uncertain:${id}`,
      source: 'codex',
      conversationRef: action.conversation_ref,
    });
    return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
  }
  const schedulerJobId = parseJobId(`${submit.stdout}\n${submit.stderr}`);
  if (submit.code !== 0 || !schedulerJobId) {
    db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', submit_stdout = ?, submit_stderr = ?, reconciled_at = ? WHERE id = ?")
      .run(submit.stdout, submit.stderr, now(), id);
    createReview(action.run_id, {
      gateType: 'remote_submission_uncertain',
      question: '科学 LSF 提交没有返回可确认的唯一 job ID。Codex 必须对账，不得重提。',
      recommendation: { action: 'reconcile_by_job_name', jobName },
      evidence: [{ stdout: submit.stdout, stderr: submit.stderr, jobName }],
      proposal: { remoteJobId: id, actionId: action.id },
      idempotencyKey: `remote-submission-uncertain:${id}`,
      source: 'codex',
      conversationRef: action.conversation_ref,
    });
    return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
  }
  db.prepare("UPDATE remote_jobs SET job_id = ?, status = 'submitted', submit_stdout = ?, submit_stderr = ?, submitted_at = ? WHERE id = ?")
    .run(schedulerJobId, submit.stdout, submit.stderr, now(), id);
  appendEvent(action.run_id, {
    category: 'fact', eventType: 'remote.scientific_submitted', actorType: 'system',
    payload: { remoteJobId: id, actionId: action.id, jobId: schedulerJobId, jobName, token, remoteWorkdir, scriptSha256: input.scriptSha256, resources: input.resources },
  });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
}

function loadJob(id: string): any {
  const row = db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id) as any;
  if (!row) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
  return row;
}

function syncLinkedAction(row: any, schedulerStatus: string): void {
  if (!row.action_id) return;
  const action = db.prepare('SELECT status FROM run_actions WHERE id = ?').get(row.action_id) as { status: string } | undefined;
  if (!action || ['succeeded', 'failed', 'cancelled'].includes(action.status)) return;
  if (action.status === 'waiting_user') {
    transitionAction(row.action_id, { status: 'executing', result: { remoteJobId: row.id, reconciled: true } });
    if (!['DONE', 'EXIT', 'ZOMBI', 'UNKWN'].includes(schedulerStatus)) {
      transitionAction(row.action_id, { status: 'waiting_remote', result: { remoteJobId: row.id, schedulerStatus } });
    }
  }
  if (schedulerStatus === 'DONE') {
    transitionAction(row.action_id, { status: 'succeeded', result: { remoteJobId: row.id, schedulerStatus } });
  } else if (['EXIT', 'ZOMBI', 'UNKWN'].includes(schedulerStatus)) {
    transitionAction(row.action_id, { status: 'failed', error: { code: 'REMOTE_JOB_FAILED', remoteJobId: row.id, schedulerStatus } });
  } else if (action.status === 'executing') {
    transitionAction(row.action_id, { status: 'waiting_remote', result: { remoteJobId: row.id, schedulerStatus } });
  }
}

async function observeJob(row: any) {
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job does not have a scheduler job ID');
  const active = await runProcess('ssh', sshArgs(row.host, `bjobs -noheader -o stat ${row.job_id}`));
  let source = 'bjobs'; let raw = active.stdout.trim();
  if (active.code !== 0 || !raw) {
    const history = await runProcess('ssh', sshArgs(row.host, `bhist -n 1 -noheader -o stat ${row.job_id}`));
    if (history.code !== 0) explainSshFailure(history);
    source = 'bhist'; raw = history.stdout.trim();
  }
  const schedulerStatus = raw.split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN';
  const terminal = ['DONE', 'EXIT', 'ZOMBI', 'UNKWN'].includes(schedulerStatus);
  const observation = { source, schedulerStatus, raw, observedAt: now() };
  db.prepare('UPDATE remote_jobs SET status = ?, last_observation_json = ?, reconciled_at = ? WHERE id = ?').run(terminal ? schedulerStatus.toLowerCase() : schedulerStatus.toLowerCase(), stableJson(observation), observation.observedAt, row.id);
  syncLinkedAction(row, schedulerStatus);
  appendEvent(row.run_id, { category: 'fact', eventType: 'remote.job_reconciled', actorType: 'system', payload: { remoteJobId: row.id, ...observation } });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(row.id));
}

function authorizeRecordedJob(row: any, operation: string) {
  const taskId = (db.prepare('SELECT task_id FROM research_runs WHERE id = ?').get(row.run_id) as any)?.task_id;
  return authorizeRemoteOperation(taskId, row.host, row.remote_root, operation);
}

async function identifyUncertainJob(row: any) {
  authorizeRecordedJob(row, 'job.reconcile');
  const query = async (command: 'bjobs' | 'bhist') => runProcess('ssh', sshArgs(row.host, `${command} -a -J ${shellQuote(row.job_name)} -noheader -o 'jobid stat job_name'`));
  let result = await query('bjobs');
  if (result.code !== 0 || !result.stdout.trim()) result = await query('bhist');
  const matches = result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts.length >= 3 && parts[2] === row.job_name && /^\d+$/.test(parts[0]));
  const unique = [...new Set(matches.map(parts => parts[0]))];
  if (unique.length === 1) {
    db.prepare("UPDATE remote_jobs SET job_id = ?, status = 'recovered', last_observation_json = ?, reconciled_at = ? WHERE id = ?")
      .run(unique[0], stableJson({ source: 'job-name-reconciliation', raw: result.stdout, observedAt: now() }), now(), row.id);
    appendEvent(row.run_id, { category: 'fact', eventType: 'remote.submission_recovered', actorType: 'system', payload: { remoteJobId: row.id, jobId: unique[0], actionToken: row.action_token } });
    return observeJob(loadJob(row.id));
  }
  if (unique.length > 1) createReview(row.run_id, { gateType: 'remote_submission_ambiguous', question: '发现多个同名 LSF 作业，无法安全自动选择。', evidence: [{ jobName: row.job_name, candidates: unique }], recommendation: { action: 'manual_identification' }, proposal: { remoteJobId: row.id }, idempotencyKey: `remote-submission-ambiguous:${row.id}` });
  db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', last_observation_json = ?, reconciled_at = ? WHERE id = ?").run(stableJson({ source: 'job-name-reconciliation', candidates: unique, raw: result.stdout, observedAt: now() }), now(), row.id);
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(row.id));
}

export async function jobStatus(id: string) { const row = loadJob(id); authorizeRecordedJob(row, 'job.status'); return observeJob(row); }
export async function reconcileJob(id: string) { const row = loadJob(id); return row.job_id ? (authorizeRecordedJob(row, 'job.reconcile'), observeJob(row)) : identifyUncertainJob(row); }

export async function jobLogs(id: string) {
  const row = loadJob(id);
  authorizeRecordedJob(row, 'job.logs');
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job does not have a scheduler job ID');
  let source = 'bpeek';
  let result = await runProcess('ssh', sshArgs(row.host, `bpeek ${row.job_id}`));
  if (result.code !== 0) {
    source = 'output-files';
    result = await runProcess('ssh', sshArgs(row.host, `cd ${shellQuote(row.remote_workdir)} && { test ! -f ${shellQuote(`smoke.${row.job_id}.out`)} || tail -c 524288 -- ${shellQuote(`smoke.${row.job_id}.out`)}; } && { test ! -f ${shellQuote(`smoke.${row.job_id}.err`)} || tail -c 524288 -- ${shellQuote(`smoke.${row.job_id}.err`)} >&2; }`));
    if (result.code !== 0) explainSshFailure(result);
  }
  return { remoteJobId: id, jobId: row.job_id, source, stdout: result.stdout, stderr: result.stderr, observedAt: now() };
}

export async function cancelJob(id: string) {
  const row = loadJob(id);
  const access = authorizeRecordedJob(row, 'job.cancel');
  if (access.run.id !== row.run_id) throw new AgentCoreError(409, 'REMOTE_JOB_NOT_CURRENT_RUN', 'Only jobs recorded by the current run can be cancelled');
  if (!row.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job does not have a scheduler job ID');
  const result = await runProcess('ssh', sshArgs(row.host, `bkill ${row.job_id}`));
  if (result.code !== 0) explainSshFailure(result);
  db.prepare("UPDATE remote_jobs SET status = 'cancel_requested', reconciled_at = ? WHERE id = ?").run(now(), id);
  if (row.action_id) {
    const linked = db.prepare('SELECT status FROM run_actions WHERE id = ?').get(row.action_id) as { status: string } | undefined;
    if (linked && ['executing', 'waiting_remote', 'waiting_user'].includes(linked.status)) {
      transitionAction(row.action_id, { status: 'cancelled', result: { remoteJobId: id, jobId: row.job_id, cancelRequested: true } });
    }
  }
  appendEvent(row.run_id, { category: 'decision', eventType: 'remote.job_cancel_requested', actorType: 'researcher', payload: { remoteJobId: id, jobId: row.job_id } });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
}
