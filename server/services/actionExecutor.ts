import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import type { ExecutableCapability, RunAction } from '../../src/types/index.js';
import { activeRun, AgentCoreError, createPendingItem, runtimeTask } from './agentCore.js';
import { createAction, getActionForExecution, registerArtifact, registerEvidenceCheck, transitionAction } from './agentActions.js';
import { normalizeHpcConfig, resolveRemoteTaskBinding } from './hpcConfig.js';
import { normalizeJobMonitorPolicy, type JobMonitorPolicy } from './monitorPolicy.js';
import { resolveWithinRoot } from './pathSafety.js';
import {
  cancelJob,
  createRemoteTaskRoot,
  download,
  inspectRemote,
  isProtectedRelativePath,
  parseLsfResources,
  submitAuthorizedLsfAction,
  upload,
} from './remote.js';
import { normalizeTaskRootRel } from './taskRoots.js';

const MAX_LOCAL_TIMEOUT_MS = 10 * 60_000;
const MAX_LOCAL_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 50_000;
const activeExecutions = new Set<string>();

export const EXECUTABLE_CAPABILITIES = [
  'local.process', 'remote.inspect', 'remote.task-root.create',
  'files.upload', 'files.download', 'job.submit', 'job.cancel',
] as const satisfies readonly ExecutableCapability[];

interface FileDescriptor { path: string; size: number; sha256: string }
interface InputSnapshot { roots: string[]; files: FileDescriptor[]; sha256: string }
interface ProcessResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean; outputLimited: boolean }

interface ExecutionSpec extends Record<string, unknown> {
  schemaVersion: 2;
  capability: ExecutableCapability;
  taskId: string;
  stageId: string;
  receipt: { path: string };
  executionPreview: { transport: 'local' | 'ssh' | 'sftp'; commands: string[]; note: string };
  process?: { executable: string; scriptPath: string; args: string[]; cwd: string; timeoutMs: number; maxOutputBytes: number };
  evidence?: { validatorName: string; validatorVersion: string; expectedExitCodes: number[]; stdoutIncludes: string[] };
  inputSnapshot?: InputSnapshot;
  remote?: { host: string; root: string };
  transfer?: { localPath: string; remotePath: string; overwrite: boolean; localFile?: FileDescriptor };
  submission?: {
    method: string; softwareStack: string; remoteWorkdir: string; remoteScriptPath: string;
    script: FileDescriptor; remoteInputs: Array<{ localPath: string; remotePath: string; size: number; sha256: string }>;
    inputSnapshot: InputSnapshot; resources: ReturnType<typeof parseLsfResources>; monitoring: JobMonitorPolicy; submissionKey: string;
  };
  targetJob?: { remoteJobId: string; schedulerJobId: string };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} must be a JSON object`);
  return value as Record<string, unknown>;
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} is required`);
  return value.trim();
}
function safeKey(value: unknown): string {
  const key = requiredText(value, 'idempotencyKey');
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(key)) throw new AgentCoreError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey contains unsupported characters');
  return key;
}
function safeRelative(value: unknown, label: string, allowRoot = false): string {
  const raw = requiredText(value, label).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (allowRoot && raw === '.') return '.';
  if (!raw || raw.includes('\0') || raw.includes('\r') || raw.includes('\n') || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw) || raw.split('/').some(item => !item || item === '.' || item === '..')) throw new AgentCoreError(400, 'EXECUTION_PATH_INVALID', `${label} must stay inside the Task root`);
  return raw;
}
function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} must be an array of strings`);
  return value.map(item => item.trim()).filter(Boolean);
}
function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) throw new AgentCoreError(400, 'EXECUTION_LIMIT_INVALID', `${label} must be a positive integer not greater than ${maximum}`);
  return parsed;
}
function displayQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function fileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256'); const descriptor = fs.openSync(filePath, 'r'); const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let read = 0; do { read = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (read) hash.update(buffer.subarray(0, read)); } while (read); }
  finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function describeFile(taskRoot: string, filePath: string): FileDescriptor {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new AgentCoreError(400, 'EXECUTION_INPUT_NOT_FILE', 'Expected a regular input file');
  return { path: path.relative(taskRoot, filePath).replace(/\\/g, '/'), size: stat.size, sha256: fileSha256(filePath) };
}
function snapshotInputs(taskRoot: string, roots: string[]): InputSnapshot {
  const files: FileDescriptor[] = [];
  const visit = (target: string) => {
    const stat = fs.statSync(target);
    if (stat.isSymbolicLink()) throw new AgentCoreError(400, 'EXECUTION_INPUT_SYMLINK', 'Input snapshots do not follow symbolic links');
    if (stat.isFile()) { files.push(describeFile(taskRoot, target)); return; }
    if (!stat.isDirectory()) throw new AgentCoreError(400, 'EXECUTION_INPUT_INVALID', 'Input snapshot supports files and directories only');
    for (const name of fs.readdirSync(target).sort()) {
      if (files.length >= MAX_SNAPSHOT_FILES) throw new AgentCoreError(413, 'EXECUTION_INPUT_LIMIT', `Input snapshot exceeds ${MAX_SNAPSHOT_FILES} files`);
      visit(path.join(target, name));
    }
  };
  const normalizedRoots = [...new Set(roots.map(item => safeRelative(item, 'inputPaths[]', true)))].sort();
  for (const relative of normalizedRoots) visit(resolveWithinRoot(taskRoot, relative, { mustExist: true, allowRoot: relative === '.', label: 'input snapshot' }));
  files.sort((left, right) => left.path.localeCompare(right.path));
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
  return { roots: normalizedRoots, files, sha256 };
}
function sameFile(left: FileDescriptor, right: FileDescriptor) { return left.path === right.path && left.size === right.size && left.sha256 === right.sha256; }
function assertSnapshotCurrent(taskRoot: string, snapshot: InputSnapshot) {
  const current = snapshotInputs(taskRoot, snapshot.roots);
  if (current.sha256 !== snapshot.sha256) throw new AgentCoreError(409, 'EXECUTION_INPUT_DRIFT', 'Action inputs changed after the Action was recorded', { expected: snapshot.sha256, current: current.sha256 });
}

function runTask(runId: string) {
  const run = activeRun(runId); const task = runtimeTask(run.task_id);
  if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
  const taskRoot = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  return { run, task, taskRoot };
}

function allowedLocalExecutables(): Set<string> {
  return new Set((process.env.WORKBENCH_LOCAL_EXECUTABLES ?? 'python,python3').split(',').map(item => item.trim()).filter(Boolean));
}
function assertExecutableAllowed(value: string) {
  if (value.includes('/') || value.includes('\\') || !allowedLocalExecutables().has(value)) throw new AgentCoreError(403, 'LOCAL_EXECUTABLE_DENIED', `${value} is not in WORKBENCH_LOCAL_EXECUTABLES`);
}
function receiptPath(spec: Record<string, unknown>, key: string): string { return safeRelative(spec.receiptPath ?? `.workbench/receipts/${key}.json`, 'receiptPath'); }

function bindingForRun(runId: string) {
  const { run, task } = runTask(runId);
  const profileId = run.confirmed_envelope.hpcProfileId;
  if (!profileId) throw new AgentCoreError(409, 'TASK_SPEC_HPC_REQUIRED', 'Remote Action requires an HPC profile in the confirmed Envelope');
  const config = normalizeHpcConfig(task.hpc_config);
  const profile = config.profiles?.find(item => item.id === profileId);
  if (!profile) throw new AgentCoreError(409, 'HPC_PROFILE_NOT_REGISTERED', 'Confirmed HPC profile is no longer registered');
  return resolveRemoteTaskBinding(task.hpc_config, task.id, profile.sshAlias);
}

function buildLocalSpec(runId: string, stageId: string, spec: Record<string, unknown>, key: string): ExecutionSpec {
  const { task, taskRoot } = runTask(runId);
  const executable = requiredText(spec.executable, 'executable'); assertExecutableAllowed(executable);
  const scriptPath = safeRelative(spec.scriptPath, 'scriptPath');
  resolveWithinRoot(taskRoot, scriptPath, { mustExist: true, allowRoot: false, label: 'local script' });
  const cwd = safeRelative(spec.cwd ?? '.', 'cwd', true);
  resolveWithinRoot(taskRoot, cwd, { mustExist: true, allowRoot: true, label: 'local cwd' });
  const args = stringArray(spec.args, 'args');
  const inputPaths = stringArray(spec.inputPaths ?? [scriptPath], 'inputPaths');
  const expectedExitCodes = spec.expectedExitCodes === undefined ? [0] : (Array.isArray(spec.expectedExitCodes) ? spec.expectedExitCodes.map(Number) : []);
  if (!expectedExitCodes.length || expectedExitCodes.some(item => !Number.isSafeInteger(item))) throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', 'expectedExitCodes must contain integers');
  return {
    schemaVersion: 2, capability: 'local.process', taskId: task.id, stageId,
    process: { executable, scriptPath, args, cwd, timeoutMs: positiveInteger(spec.timeoutMs, 60_000, MAX_LOCAL_TIMEOUT_MS, 'timeoutMs'), maxOutputBytes: positiveInteger(spec.maxOutputBytes, 1024 * 1024, MAX_LOCAL_OUTPUT_BYTES, 'maxOutputBytes') },
    inputSnapshot: snapshotInputs(taskRoot, inputPaths), receipt: { path: receiptPath(spec, key) },
    evidence: { validatorName: requiredText(spec.validatorName ?? 'local-process', 'validatorName'), validatorVersion: requiredText(spec.validatorVersion ?? '1', 'validatorVersion'), expectedExitCodes, stdoutIncludes: stringArray(spec.stdoutIncludes, 'stdoutIncludes') },
    executionPreview: { transport: 'local', commands: [`[shell=false] ${[executable, scriptPath, ...args].map(displayQuote).join(' ')}`], note: 'Codex 在 Task 根内运行已记录脚本；输入哈希变化时生成新 Action。' },
  };
}

function buildRemoteSpec(runId: string, stageId: string, capability: Exclude<ExecutableCapability, 'local.process'>, spec: Record<string, unknown>, key: string): ExecutionSpec {
  const { run, task, taskRoot } = runTask(runId);
  if (capability === 'job.cancel') {
    const remoteJobId = requiredText(spec.remoteJobId, 'remoteJobId');
    const job = db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(remoteJobId) as any;
    if (!job) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
    if (job.run_id !== runId) throw new AgentCoreError(409, 'REMOTE_JOB_RUN_MISMATCH', 'Only a job owned by this Run may be cancelled');
    if (!job.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job has no scheduler ID');
    return { schemaVersion: 2, capability, taskId: task.id, stageId, targetJob: { remoteJobId, schedulerJobId: job.job_id }, receipt: { path: receiptPath(spec, key) }, executionPreview: { transport: 'ssh', commands: [`ssh ${job.host} ${displayQuote(`bkill ${job.job_id}`)}`], note: '只取消当前 Run 自己创建且已被替代或确认错误的作业。' } };
  }
  const binding = bindingForRun(runId);
  const readFromUserRoot = capability === 'files.download' && spec.sourceRoot === 'user';
  const remoteRoot = readFromUserRoot ? binding.userReadRoot : binding.taskWriteRoot;
  const base: ExecutionSpec = { schemaVersion: 2, capability, taskId: task.id, stageId, remote: { host: binding.host, root: remoteRoot }, receipt: { path: receiptPath(spec, key) }, executionPreview: { transport: 'ssh', commands: [`ssh ${binding.host} ${displayQuote(`inspect ${remoteRoot}`)}`], note: '远程位置从 Task Spec 采用的连接和 Task 目录映射派生。' } };
  if (capability === 'remote.task-root.create') base.executionPreview = { transport: 'ssh', commands: [`ssh ${binding.host} ${displayQuote(`mkdir ${binding.taskWriteRoot}`)}`], note: '只创建登记在项目根下的这一条 Task 目录。' };
  if (capability === 'files.upload') {
    const localPath = safeRelative(spec.localPath, 'localPath'); const remotePath = safeRelative(spec.remotePath, 'remotePath');
    const local = resolveWithinRoot(taskRoot, localPath, { mustExist: true, allowRoot: false, label: 'upload source' });
    base.transfer = { localPath, remotePath, overwrite: spec.overwrite === true, localFile: describeFile(taskRoot, local) };
    base.executionPreview = { transport: 'sftp', commands: [`put ${displayQuote(localPath)} ${displayQuote(`${binding.taskWriteRoot}/${remotePath}`)}`], note: '上传一个带输入哈希的 Task 内文件。' };
  }
  if (capability === 'files.download') {
    const localPath = safeRelative(spec.localPath, 'localPath'); const remotePath = safeRelative(spec.remotePath, 'remotePath');
    base.transfer = { localPath, remotePath, overwrite: spec.overwrite === true };
    base.executionPreview = { transport: 'sftp', commands: [`get ${displayQuote(`${remoteRoot}/${remotePath}`)} ${displayQuote(localPath)}`], note: '下载到 Task 根后登记为 Artifact；用户根范围只读。' };
  }
  if (capability === 'job.submit') {
    const method = requiredText(spec.method, 'method'); const softwareStack = requiredText(spec.softwareStack, 'softwareStack');
    if (!run.confirmed_envelope.allowedMethods.includes(method)) throw new AgentCoreError(403, 'REMOTE_METHOD_DENIED', 'Method is outside the confirmed Envelope');
    if (!run.confirmed_envelope.allowedSoftwareStacks.includes(softwareStack)) throw new AgentCoreError(403, 'REMOTE_SOFTWARE_STACK_DENIED', 'Software stack is outside the confirmed Envelope');
    const localScriptPath = safeRelative(spec.localScriptPath, 'localScriptPath');
    const localScript = resolveWithinRoot(taskRoot, localScriptPath, { mustExist: true, allowRoot: false, label: 'LSF script' });
    const script = describeFile(taskRoot, localScript);
    if (spec.remoteInputs !== undefined && !Array.isArray(spec.remoteInputs)) throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', 'remoteInputs must be an array');
    const remoteInputs = (spec.remoteInputs ?? []).map((value, index) => {
      const item = objectValue(value, `remoteInputs[${index}]`); const localPath = safeRelative(item.localPath, `remoteInputs[${index}].localPath`); const remotePath = safeRelative(item.remotePath, `remoteInputs[${index}].remotePath`);
      const descriptor = describeFile(taskRoot, resolveWithinRoot(taskRoot, localPath, { mustExist: true, allowRoot: false, label: 'remote input' }));
      return { localPath, remotePath, size: descriptor.size, sha256: descriptor.sha256 };
    });
    const remoteScriptPath = safeRelative(spec.remoteScriptPath ?? path.basename(localScriptPath), 'remoteScriptPath');
    const remoteWorkdir = safeRelative(spec.remoteWorkdir, 'remoteWorkdir');
    const snapshot = snapshotInputs(taskRoot, [localScriptPath, ...remoteInputs.map(item => item.localPath)]);
    const resources = parseLsfResources(fs.readFileSync(localScript, 'utf8'));
    const monitoring = normalizeJobMonitorPolicy(spec.monitoring, resources.wallMinutes);
    base.submission = { method, softwareStack, remoteWorkdir, remoteScriptPath, script, remoteInputs, inputSnapshot: snapshot, resources, monitoring, submissionKey: safeKey(spec.submissionKey ?? key) };
    base.executionPreview = { transport: 'ssh', commands: [`cd ${displayQuote(`${binding.taskWriteRoot}/${remoteWorkdir}`)} && verify input hashes`, `bsub -J <workbench-token> < ${displayQuote(remoteScriptPath)}`, 'bjobs <returned-id> # post-submit sanity'], note: '每次提交先落库再调用 bsub；响应不确定时只按唯一作业名对账，绝不重提。' };
  }
  return base;
}

export function proposeExecutableAction(runId: string, input: { stageId?: unknown; stepId?: unknown; parentActionId?: unknown; retryOfActionId?: unknown; capability?: unknown; spec?: unknown; idempotencyKey?: unknown; conversationRef?: unknown }) {
  const run = activeRun(runId);
  const stageId = requiredText(input.stageId ?? run.current_stage_id, 'stageId');
  const capability = requiredText(input.capability, 'capability') as ExecutableCapability;
  if (!EXECUTABLE_CAPABILITIES.includes(capability)) throw new AgentCoreError(400, 'EXECUTION_CAPABILITY_INVALID', 'Unsupported executable capability');
  if (!run.confirmed_envelope.allowedCapabilities.includes(capability)) throw new AgentCoreError(403, 'EXECUTION_CAPABILITY_DENIED', 'Capability is outside the confirmed Envelope');
  const key = safeKey(input.idempotencyKey); const raw = objectValue(input.spec, 'spec');
  const executionSpec = capability === 'local.process' ? buildLocalSpec(runId, stageId, raw, key) : buildRemoteSpec(runId, stageId, capability, raw, key);
  return createAction(runId, { stageId, stepId: input.stepId, parentActionId: input.parentActionId, retryOfActionId: input.retryOfActionId, actionType: capability, spec: executionSpec, idempotencyKey: key, conversationRef: input.conversationRef });
}

function parseExecutionSpec(action: RunAction): ExecutionSpec {
  const spec = action.spec as ExecutionSpec;
  const task = runTask(action.run_id).task;
  if (spec.schemaVersion !== 2 || !EXECUTABLE_CAPABILITIES.includes(spec.capability) || spec.capability !== action.action_type || spec.taskId !== task.id || spec.stageId !== action.stage_id) throw new AgentCoreError(409, 'EXECUTION_SPEC_INVALID', 'Action is not bound to a valid Workbench execution spec');
  return spec;
}

function runLocalProcess(spec: ExecutionSpec, taskRoot: string): Promise<ProcessResult> {
  const processSpec = spec.process!; assertExecutableAllowed(processSpec.executable);
  const script = resolveWithinRoot(taskRoot, processSpec.scriptPath, { mustExist: true, allowRoot: false, label: 'local script' });
  const cwd = resolveWithinRoot(taskRoot, processSpec.cwd, { mustExist: true, allowRoot: true, label: 'local cwd' });
  return new Promise((resolve, reject) => {
    const child = spawn(processSpec.executable, [script, ...processSpec.args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false; let outputLimited = false;
    const collect = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > processSpec.maxOutputBytes) { outputLimited = true; child.kill(); }
      return next.slice(0, processSpec.maxOutputBytes);
    };
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); }); child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, processSpec.timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(new AgentCoreError(502, 'LOCAL_PROCESS_FAILED', error.message)); });
    child.on('close', code => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, outputLimited }); });
  });
}

async function withReceipt(taskRoot: string, action: RunAction, spec: ExecutionSpec, payload: () => Promise<Record<string, unknown>>) {
  const target = resolveWithinRoot(taskRoot, spec.receipt.path, { allowRoot: false, label: 'execution receipt' });
  if (fs.existsSync(target)) {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
    if (saved.actionId !== action.id || saved.specSha256 !== action.spec_sha256) throw new AgentCoreError(409, 'EXECUTION_RECEIPT_CONFLICT', 'Existing receipt belongs to a different Action');
    return saved;
  }
  const result = { schemaVersion: 2, actionId: action.id, specSha256: action.spec_sha256, capability: spec.capability, completedAt: new Date().toISOString(), result: await payload() };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, target);
  return result;
}

function registerReceipt(action: RunAction, spec: ExecutionSpec, receipt: Record<string, unknown>, status: 'pass' | 'warn' | 'fail') {
  const artifact = registerArtifact(action.id, { location: 'local', path: spec.receipt.path, category: 'execution-receipt', idempotencyKey: 'execution-receipt', metadata: { capability: spec.capability } });
  const evidence = registerEvidenceCheck(action.id, { artifactId: artifact.id, validatorName: spec.evidence?.validatorName ?? spec.capability, validatorVersion: spec.evidence?.validatorVersion ?? '2', status, result: receipt, idempotencyKey: 'execution-receipt-check' });
  return { artifact, evidence };
}

function codexFailure(action: RunAction, code: string, message: string, extra: Record<string, unknown> = {}) {
  createPendingItem(action.run_id, { stageId: action.stage_id, actionId: action.id, audience: 'codex', kind: 'action_failure', title: `${action.action_type} 需要 Codex 诊断`, detail: { code, message, ...extra, blocksRun: false }, idempotencyKey: `action-failure:${action.id}:${code}`, source: 'workbench', conversationRef: action.conversation_ref });
}

async function executeLocal(action: RunAction, spec: ExecutionSpec) {
  if (process.env.WORKBENCH_LOCAL_EXEC_ENABLED !== '1') throw new AgentCoreError(403, 'LOCAL_EXEC_ENV_DISABLED', 'Set WORKBENCH_LOCAL_EXEC_ENABLED=1 to enable local process execution');
  const { run, taskRoot } = runTask(action.run_id);
  if (isProtectedRelativePath(spec.receipt.path, run.confirmed_envelope.protectedRelativePaths)) throw new AgentCoreError(403, 'PROTECTED_PATH', 'Receipt path is protected by the Task Spec');
  assertSnapshotCurrent(taskRoot, spec.inputSnapshot!);
  const current = transitionAction(action.id, { status: 'executing' });
  const receipt = await withReceipt(taskRoot, current, spec, async () => ({ process: await runLocalProcess(spec, taskRoot) }));
  const result = (receipt.result as { process: ProcessResult }).process;
  const passed = spec.evidence!.expectedExitCodes.includes(result.exitCode) && !result.timedOut && !result.outputLimited && spec.evidence!.stdoutIncludes.every(token => result.stdout.includes(token));
  const registered = registerReceipt(current, spec, receipt, passed ? 'pass' : 'fail');
  if (!passed) { codexFailure(current, 'LOCAL_VALIDATION_FAILED', 'Local validator did not meet its evidence conditions', { artifactId: registered.artifact.id, evidenceId: registered.evidence.id }); return transitionAction(current.id, { status: 'waiting_codex', error: { code: 'LOCAL_VALIDATION_FAILED' } }); }
  return transitionAction(current.id, { status: 'succeeded', result: { artifactId: registered.artifact.id, evidenceId: registered.evidence.id } });
}

async function executeRemote(action: RunAction, spec: ExecutionSpec) {
  const { task, taskRoot } = runTask(action.run_id);
  if (spec.transfer?.localFile) {
    const current = describeFile(taskRoot, resolveWithinRoot(taskRoot, spec.transfer.localPath, { mustExist: true, allowRoot: false, label: 'upload source' }));
    if (!sameFile(current, spec.transfer.localFile)) throw new AgentCoreError(409, 'EXECUTION_INPUT_DRIFT', 'Upload source changed after Action creation');
  }
  if (spec.submission) assertSnapshotCurrent(taskRoot, spec.submission.inputSnapshot);
  const current = transitionAction(action.id, { status: 'executing' });
  if (spec.capability === 'job.submit') {
    const submission = spec.submission!;
    const job = await submitAuthorizedLsfAction(current, { taskId: task.id, host: spec.remote!.host, remoteRoot: spec.remote!.root, remoteWorkdir: submission.remoteWorkdir, remoteScriptPath: submission.remoteScriptPath, scriptSha256: submission.script.sha256, remoteInputs: submission.remoteInputs.map(item => ({ remotePath: item.remotePath, sha256: item.sha256 })), resources: submission.resources, monitoring: submission.monitoring, idempotencyKey: submission.submissionKey });
    return transitionAction(current.id, { status: ['submission_uncertain', 'preparation_failed'].includes(job.status) ? 'waiting_codex' : 'waiting_remote', result: { remoteJobId: job.id, schedulerJobId: job.job_id, status: job.status } });
  }
  const receipt = await withReceipt(taskRoot, current, spec, async () => {
    if (spec.capability === 'remote.inspect') return { remote: await inspectRemote(task.id, spec.remote!.host, spec.remote!.root) };
    if (spec.capability === 'remote.task-root.create') return { remote: await createRemoteTaskRoot(task.id, { host: spec.remote!.host, remoteRoot: spec.remote!.root }) };
    if (spec.capability === 'files.upload') return { remote: await upload(task.id, { host: spec.remote!.host, remoteRoot: spec.remote!.root, ...spec.transfer! }) };
    if (spec.capability === 'files.download') return { remote: await download(task.id, { host: spec.remote!.host, remoteRoot: spec.remote!.root, ...spec.transfer! }) };
    if (spec.capability === 'job.cancel') return { remote: await cancelJob(spec.targetJob!.remoteJobId) };
    throw new AgentCoreError(400, 'EXECUTION_CAPABILITY_INVALID', 'Unsupported remote capability');
  });
  const registered = registerReceipt(current, spec, receipt, 'pass');
  if (spec.capability === 'files.download') registerArtifact(current.id, { location: 'local', path: spec.transfer!.localPath, category: 'downloaded-evidence', idempotencyKey: 'downloaded-file', metadata: { remotePath: spec.transfer!.remotePath, host: spec.remote!.host } });
  return transitionAction(current.id, { status: 'succeeded', result: { artifactId: registered.artifact.id, evidenceId: registered.evidence.id } });
}

export async function executeAction(actionId: string) {
  if (activeExecutions.has(actionId)) throw new AgentCoreError(409, 'ACTION_ALREADY_EXECUTING', 'Action is already executing in this Workbench process');
  const action = getActionForExecution(actionId, ['ready', 'executing']);
  const spec = parseExecutionSpec(action);
  if (action.status === 'executing') {
    const { taskRoot } = runTask(action.run_id);
    const receipt = resolveWithinRoot(taskRoot, spec.receipt.path, { allowRoot: false, label: 'execution receipt' });
    if (!fs.existsSync(receipt)) {
      transitionAction(action.id, { status: 'waiting_codex', error: { code: 'EXECUTION_RECOVERY_UNCERTAIN' } });
      codexFailure(action, 'EXECUTION_RECOVERY_UNCERTAIN', 'Workbench restarted after execution began but before a receipt was recorded; inspect external state before retrying');
      return getActionForExecution(action.id, ['waiting_codex']);
    }
  }
  activeExecutions.add(actionId);
  try { return spec.capability === 'local.process' ? await executeLocal(action, spec) : await executeRemote(action, spec); }
  catch (error) {
    const item = error as AgentCoreError;
    const current = db.prepare('SELECT status FROM run_actions WHERE id = ?').get(action.id) as { status: string } | undefined;
    if (current && ['executing', 'waiting_remote'].includes(current.status)) transitionAction(action.id, { status: 'waiting_codex', error: { code: item.code ?? 'ACTION_EXECUTION_FAILED', message: item.message } });
    codexFailure(action, item.code ?? 'ACTION_EXECUTION_FAILED', item.message);
    throw error;
  } finally { activeExecutions.delete(actionId); }
}

export function describeExecutionContract() {
  return {
    schemaVersion: 4,
    model: 'One researcher confirmation opens a bounded Task session. Routine local work and remote shell/transfer operations execute directly and append events; Actions are durable scientific milestones, not micro-operation permission tokens.',
    capabilities: [...EXECUTABLE_CAPABILITIES],
    binding: ['runId', 'stageId', 'capability', 'specSha256', 'inputHashes', 'paths', 'resources'],
    routineRemoteSession: { commandFreedom: 'arbitrary shell inside the selected registered root', automaticLog: 'run_events', createsAction: false, schedulerMutation: 'dedicated recorded Job path only' },
    recovery: 'Routine transport/configuration failures are logged and do not consume the scientific retry budget. Submission rows exist before bsub; uncertain responses are reconciled by unique job name and never resubmitted. Active Jobs require one persisted current-chat monitor.',
    local: { environmentSwitch: 'WORKBENCH_LOCAL_EXEC_ENABLED=1', executableAllowlist: [...allowedLocalExecutables()].sort(), shell: false, maxTimeoutMs: MAX_LOCAL_TIMEOUT_MS, maxOutputBytes: MAX_LOCAL_OUTPUT_BYTES },
    remote: { enabledByDefault: true, emergencyDisableSwitch: 'WORKBENCH_REMOTE_DISABLED=1', submissionDisableSwitch: 'WORKBENCH_REMOTE_SUBMIT_DISABLED=1', boundarySource: 'confirmed Envelope + registered Task binding' },
  };
}
