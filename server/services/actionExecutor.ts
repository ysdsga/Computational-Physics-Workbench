import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import type { RunAction } from '../../src/types/index.js';
import {
  AgentCoreError,
  createReview,
  effectivePolicy,
  hashJson,
  now,
} from './agentCore.js';
import {
  createAction,
  getAction,
  getActionForExecution,
  registerArtifact,
  registerEvidenceCheck,
  transitionAction,
} from './agentActions.js';
import { resolveWithinRoot } from './pathSafety.js';
import {
  authorizeRemoteOperation,
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

const EXECUTION_SCHEMA_VERSION = 1;
const MAX_LOCAL_TIMEOUT_MS = 10 * 60_000;
const MAX_LOCAL_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 50_000;
const MAX_REMOTE_INPUT_FILES = 10_000;
const activeExecutions = new Set<string>();

export const EXECUTABLE_CAPABILITIES = [
  'local.process',
  'remote.inspect',
  'remote.task-root.create',
  'files.upload',
  'files.download',
  'job.submit',
  'job.cancel',
] as const;

type ExecutableCapability = typeof EXECUTABLE_CAPABILITIES[number];

interface FileDescriptor {
  path: string;
  size: number;
  sha256: string;
}

interface InputSnapshot {
  roots: string[];
  files: FileDescriptor[];
  sha256: string;
}

interface RemoteInputBinding {
  localPath: string;
  remotePath: string;
  size: number;
  sha256: string;
}

interface BaseManifest {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  capability: ExecutableCapability;
  taskId: string;
  contextVersionId: string;
  stepId: string;
  receipt: { path: string };
  executionPreview: {
    transport: 'local' | 'ssh' | 'sftp';
    commands: string[];
    note: string;
  };
}

interface LocalProcessManifest extends BaseManifest {
  capability: 'local.process';
  process: {
    executable: string;
    scriptPath: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
  };
  inputSnapshot: InputSnapshot;
  evidence: {
    validatorName: string;
    validatorVersion: string;
    expectedExitCodes: number[];
    stdoutIncludes: string[];
  };
}

interface RemoteManifest extends BaseManifest {
  capability: Exclude<ExecutableCapability, 'local.process'>;
  remote: { host: string; root: string };
  transfer?: {
    localPath: string;
    remotePath: string;
    overwrite: boolean;
    localFile?: FileDescriptor;
  };
  submission?: {
    method: string;
    softwareStack: string;
    remoteWorkdir: string;
    remoteScriptPath: string;
    script: FileDescriptor;
    remoteInputs: RemoteInputBinding[];
    inputSnapshot: InputSnapshot;
    resources: ReturnType<typeof parseLsfResources>;
  };
  targetJob?: {
    remoteJobId: string;
    schedulerJobId: string;
    submitActionId: string | null;
  };
}

type ExecutionManifest = LocalProcessManifest | RemoteManifest;

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimited: boolean;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} is required`);
  }
  return value.trim();
}

function safeKey(value: unknown): string {
  const key = requiredText(value, 'idempotencyKey');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) {
    throw new AgentCoreError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey must use 1-120 letters, digits, dot, underscore or hyphen');
  }
  return key;
}

function safeRelative(value: unknown, label: string, allowRoot = false): string {
  const raw = requiredText(value, label).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (allowRoot && (raw === '' || raw === '.')) return '.';
  if (
    !raw
    || raw.includes('\0')
    || raw.includes('\r')
    || raw.includes('\n')
    || path.win32.isAbsolute(raw)
    || path.posix.isAbsolute(raw)
  ) throw new AgentCoreError(400, 'EXECUTION_PATH_INVALID', `${label} must be a safe Task-relative path`);
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new AgentCoreError(400, 'EXECUTION_PATH_INVALID', `${label} contains traversal, dot or empty segments`);
  }
  return parts.join('/');
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', `${label} must be an array of strings`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new AgentCoreError(400, 'EXECUTION_LIMIT_INVALID', `${label} must be a positive integer not greater than ${maximum}`);
  }
  return number;
}

function displayShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function displayRemotePath(root: string, relative: string): string {
  return `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
}

function fileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function posixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function describeFile(taskRoot: string, filePath: string): FileDescriptor {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new AgentCoreError(400, 'EXECUTION_INPUT_NOT_FILE', `${posixRelative(taskRoot, filePath)} is not a file`);
  return { path: posixRelative(taskRoot, filePath), size: stat.size, sha256: fileSha256(filePath) };
}

function walkInput(taskRoot: string, target: string, files: FileDescriptor[]): void {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    files.push(describeFile(taskRoot, target));
    if (files.length > MAX_SNAPSHOT_FILES) throw new AgentCoreError(413, 'EXECUTION_INPUT_LIMIT', `Manifest input snapshot exceeds ${MAX_SNAPSHOT_FILES} files`);
    return;
  }
  if (!stat.isDirectory()) throw new AgentCoreError(400, 'EXECUTION_INPUT_TYPE_INVALID', `${posixRelative(taskRoot, target)} is not a file or directory`);
  for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = posixRelative(taskRoot, path.join(target, entry.name));
    const child = resolveWithinRoot(taskRoot, childRelative, { mustExist: true, allowRoot: false, label: 'manifest input' });
    walkInput(taskRoot, child, files);
  }
}

function snapshotInputs(taskRoot: string, roots: string[]): InputSnapshot {
  const normalizedRoots = [...new Set(roots.map(item => safeRelative(item, 'inputPaths item')))].sort();
  const files: FileDescriptor[] = [];
  for (const relative of normalizedRoots) {
    const target = resolveWithinRoot(taskRoot, relative, { mustExist: true, allowRoot: false, label: 'manifest input' });
    walkInput(taskRoot, target, files);
  }
  const uniqueFiles = [...new Map(files.map(item => [item.path, item])).values()].sort((left, right) => left.path.localeCompare(right.path));
  return { roots: normalizedRoots, files: uniqueFiles, sha256: hashJson(uniqueFiles) };
}

function taskForRun(runId: string) {
  const row = db.prepare(`
    SELECT research_runs.task_id, research_runs.current_context_version_id,
           research_runs.status AS run_status, tasks.project_id, tasks.task_root_rel,
           projects.working_dir
    FROM research_runs
    JOIN tasks ON tasks.id = research_runs.task_id
    JOIN projects ON projects.id = tasks.project_id
    WHERE research_runs.id = ?
  `).get(runId) as {
    task_id: string;
    current_context_version_id: string | null;
    run_status: string;
    project_id: string;
    task_root_rel: string | null;
    working_dir: string;
  } | undefined;
  if (!row) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (!row.current_context_version_id) throw new AgentCoreError(409, 'CONTEXT_REQUIRED', 'Run has no current context');
  if (!row.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
  const taskRoot = resolveWithinRoot(row.working_dir, normalizeTaskRootRel(row.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  return { ...row, taskRoot };
}

function assertCapability(value: unknown): ExecutableCapability {
  const capability = requiredText(value, 'capability') as ExecutableCapability;
  if (!EXECUTABLE_CAPABILITIES.includes(capability)) {
    throw new AgentCoreError(400, 'EXECUTION_CAPABILITY_INVALID', `capability must be one of: ${EXECUTABLE_CAPABILITIES.join(', ')}`);
  }
  return capability;
}

function assertLocalPolicy(task: ReturnType<typeof taskForRun>): void {
  const { effective } = effectivePolicy(task.project_id, task.task_id);
  const context = db.prepare('SELECT policy_sha256 FROM run_context_versions WHERE id = ?').get(task.current_context_version_id) as { policy_sha256: string } | undefined;
  if (!context || context.policy_sha256 !== hashJson(effective)) {
    throw new AgentCoreError(409, 'POLICY_CONTEXT_DRIFT', 'Effective policy must match the adopted run context');
  }
  if (!effective.allowedOperations.includes('local.process')) {
    throw new AgentCoreError(403, 'LOCAL_PROCESS_POLICY_DENIED', 'Effective policy does not allow local.process');
  }
}

function allowedLocalExecutables(): Set<string> {
  const configured = process.env.WORKBENCH_LOCAL_EXECUTABLES ?? 'python,python3';
  return new Set(configured.split(',').map(item => item.trim()).filter(Boolean));
}

function assertExecutableAllowed(executable: string): void {
  if (!/^[A-Za-z0-9._+-]+$/.test(executable)) {
    throw new AgentCoreError(400, 'LOCAL_EXECUTABLE_INVALID', 'Local executable must be a simple command name without a path');
  }
  if (!allowedLocalExecutables().has(executable)) {
    throw new AgentCoreError(403, 'LOCAL_EXECUTABLE_DENIED', `Local executable ${executable} is not in WORKBENCH_LOCAL_EXECUTABLES`);
  }
}

function receiptPath(spec: Record<string, unknown>, idempotencyKey: string): string {
  return safeRelative(spec.receiptPath ?? `.workbench/evidence/${idempotencyKey}.json`, 'receiptPath');
}

function buildLocalManifest(runId: string, contextVersionId: string, stepId: string, spec: Record<string, unknown>, idempotencyKey: string): LocalProcessManifest {
  const task = taskForRun(runId);
  assertLocalPolicy(task);
  const executable = requiredText(spec.executable, 'executable');
  assertExecutableAllowed(executable);
  const scriptPath = safeRelative(spec.scriptPath, 'scriptPath');
  const script = resolveWithinRoot(task.taskRoot, scriptPath, { mustExist: true, allowRoot: false, label: 'local process script' });
  if (!fs.statSync(script).isFile()) throw new AgentCoreError(400, 'LOCAL_SCRIPT_NOT_FILE', 'scriptPath must reference a file');
  const cwd = safeRelative(spec.cwd ?? '.', 'cwd', true);
  resolveWithinRoot(task.taskRoot, cwd, { mustExist: true, allowRoot: true, label: 'local process cwd' });
  const args = stringArray(spec.args, 'args');
  if (args.some(item => item.includes('\0') || item.includes('\r') || item.includes('\n'))) {
    throw new AgentCoreError(400, 'LOCAL_ARGUMENT_INVALID', 'Local process arguments must not contain NUL or line breaks');
  }
  const inputPaths = [...new Set([scriptPath, ...stringArray(spec.inputPaths, 'inputPaths')])];
  const expectedExitCodes = spec.expectedExitCodes === undefined ? [0] : (() => {
    if (!Array.isArray(spec.expectedExitCodes) || spec.expectedExitCodes.length === 0 || spec.expectedExitCodes.some(item => !Number.isSafeInteger(item))) {
      throw new AgentCoreError(400, 'LOCAL_SUCCESS_CRITERIA_INVALID', 'expectedExitCodes must be a non-empty integer array');
    }
    return [...new Set(spec.expectedExitCodes as number[])].sort((left, right) => left - right);
  })();
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    capability: 'local.process',
    taskId: task.task_id,
    contextVersionId,
    stepId,
    process: {
      executable,
      scriptPath,
      args,
      cwd,
      timeoutMs: positiveInteger(spec.timeoutMs, 60_000, MAX_LOCAL_TIMEOUT_MS, 'timeoutMs'),
      maxOutputBytes: positiveInteger(spec.maxOutputBytes, 1024 * 1024, MAX_LOCAL_OUTPUT_BYTES, 'maxOutputBytes'),
    },
    inputSnapshot: snapshotInputs(task.taskRoot, inputPaths),
    receipt: { path: receiptPath(spec, idempotencyKey) },
    executionPreview: {
      transport: 'local',
      commands: [`[shell=false] ${[executable, scriptPath, ...args].map(displayShellQuote).join(' ')}`],
      note: '授权后的本地进程预览；路径相对于任务根目录，实际执行不经过 shell。',
    },
    evidence: {
      validatorName: requiredText(spec.validatorName ?? 'local-process', 'validatorName'),
      validatorVersion: requiredText(spec.validatorVersion ?? '1', 'validatorVersion'),
      expectedExitCodes,
      stdoutIncludes: stringArray(spec.stdoutIncludes, 'stdoutIncludes'),
    },
  };
}

function buildRemoteManifest(runId: string, contextVersionId: string, stepId: string, capability: RemoteManifest['capability'], spec: Record<string, unknown>, idempotencyKey: string): RemoteManifest {
  const task = taskForRun(runId);
  if (capability === 'job.cancel') {
    const remoteJobId = requiredText(spec.remoteJobId, 'remoteJobId');
    const job = db.prepare('SELECT run_id, action_id, host, remote_root, job_id FROM remote_jobs WHERE id = ?').get(remoteJobId) as {
      run_id: string; action_id: string | null; host: string; remote_root: string; job_id: string | null;
    } | undefined;
    if (!job) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
    if (job.run_id !== runId) throw new AgentCoreError(409, 'REMOTE_JOB_RUN_MISMATCH', 'Remote job belongs to a different run');
    if (!job.job_id) throw new AgentCoreError(409, 'REMOTE_JOB_ID_MISSING', 'Remote job does not have a scheduler job ID');
    authorizeRemoteOperation(task.task_id, job.host, job.remote_root, 'job.cancel', false, false);
    return {
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      capability,
      taskId: task.task_id,
      contextVersionId,
      stepId,
      remote: { host: job.host, root: job.remote_root },
      targetJob: { remoteJobId, schedulerJobId: job.job_id, submitActionId: job.action_id },
      receipt: { path: receiptPath(spec, idempotencyKey) },
      executionPreview: {
        transport: 'ssh',
        commands: [`ssh ${job.host} ${displayShellQuote(`bkill ${job.job_id}`)}`],
        note: '将请求取消这一条已登记的调度器作业；不是通用远程终端。',
      },
    };
  }

  const host = requiredText(spec.host, 'host');
  const remoteRoot = requiredText(spec.remoteRoot, 'remoteRoot');
  const access = authorizeRemoteOperation(task.task_id, host, remoteRoot, capability, false, false);
  const manifest: RemoteManifest = {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    capability,
    taskId: task.task_id,
    contextVersionId,
    stepId,
    remote: { host: access.host, root: access.remoteRoot },
    receipt: { path: receiptPath(spec, idempotencyKey) },
    executionPreview: {
      transport: 'ssh',
      commands: [`ssh ${access.host} ${displayShellQuote(`inspect approved root ${access.remoteRoot}`)}`],
      note: '只读检查远程根目录及 LSF 命令可用性。',
    },
  };
  if (capability === 'files.upload') {
    const localPath = safeRelative(spec.localPath, 'localPath');
    const local = resolveWithinRoot(task.taskRoot, localPath, { mustExist: true, allowRoot: false, label: 'upload source' });
    manifest.transfer = {
      localPath,
      remotePath: safeRelative(spec.remotePath, 'remotePath'),
      overwrite: spec.overwrite === true,
      localFile: describeFile(task.taskRoot, local),
    };
    manifest.executionPreview = {
      transport: 'sftp',
      commands: [`sftp ${access.host}: put ${displayShellQuote(localPath)} ${displayShellQuote(displayRemotePath(access.remoteRoot, manifest.transfer.remotePath))}`],
      note: '上传单个已哈希的任务内文件；执行前还会验证远端父路径没有逃逸。',
    };
  } else if (capability === 'remote.task-root.create') {
    manifest.executionPreview = {
      transport: 'ssh',
      commands: [`ssh ${access.host} ${displayShellQuote(`mkdir exact registered Task root ${access.binding.taskWriteRoot} under ${access.binding.projectRoot}`)}`],
      note: '只创建当前 Task 已登记的直接子目录；项目根必须已存在，已有同名目录时只校验边界。',
    };
  } else if (capability === 'files.download') {
    manifest.transfer = {
      localPath: safeRelative(spec.localPath, 'localPath'),
      remotePath: safeRelative(spec.remotePath, 'remotePath'),
      overwrite: spec.overwrite === true,
    };
    manifest.executionPreview = {
      transport: 'sftp',
      commands: [`sftp ${access.host}: get ${displayShellQuote(displayRemotePath(access.remoteRoot, manifest.transfer.remotePath))} ${displayShellQuote(manifest.transfer.localPath)}`],
      note: '下载到任务根目录内的临时文件，成功后原子改名并登记为本地证据。',
    };
  } else if (capability === 'job.submit') {
    const method = requiredText(spec.method, 'method');
    const softwareStack = requiredText(spec.softwareStack, 'softwareStack');
    if (!access.policy.allowedMethods.includes(method) || !access.contract.boundaries.allowedMethods.includes(method)) {
      throw new AgentCoreError(403, 'REMOTE_METHOD_DENIED', 'Submission method is outside the adopted contract or effective policy');
    }
    if (!access.contract.boundaries.allowedSoftwareStacks.includes(softwareStack)) {
      throw new AgentCoreError(403, 'REMOTE_SOFTWARE_STACK_DENIED', 'Submission softwareStack is outside the adopted contract');
    }
    const localScriptPath = safeRelative(spec.localScriptPath, 'localScriptPath');
    const scriptPath = resolveWithinRoot(task.taskRoot, localScriptPath, { mustExist: true, allowRoot: false, label: 'LSF script' });
    const script = describeFile(task.taskRoot, scriptPath);
    if (spec.remoteInputs !== undefined && !Array.isArray(spec.remoteInputs)) {
      throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', 'remoteInputs must be an array of { localPath, remotePath } objects');
    }
    const remoteInputs = (spec.remoteInputs ?? []).map((value, index) => {
      const binding = objectValue(value, `remoteInputs[${index}]`);
      const localPath = safeRelative(binding.localPath, `remoteInputs[${index}].localPath`);
      const remotePath = safeRelative(binding.remotePath, `remoteInputs[${index}].remotePath`);
      const local = resolveWithinRoot(task.taskRoot, localPath, { mustExist: true, allowRoot: false, label: 'remote input source' });
      const descriptor = describeFile(task.taskRoot, local);
      return { localPath, remotePath, size: descriptor.size, sha256: descriptor.sha256 };
    });
    if (remoteInputs.length > MAX_REMOTE_INPUT_FILES) {
      throw new AgentCoreError(413, 'EXECUTION_INPUT_LIMIT', `remoteInputs exceeds ${MAX_REMOTE_INPUT_FILES} files`);
    }
    if (new Set(remoteInputs.map(item => item.remotePath)).size !== remoteInputs.length) {
      throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', 'remoteInputs remotePath values must be unique');
    }
    const remoteScriptPath = safeRelative(spec.remoteScriptPath ?? localScriptPath, 'remoteScriptPath');
    if (remoteInputs.some(item => item.remotePath === remoteScriptPath)) {
      throw new AgentCoreError(400, 'EXECUTION_SPEC_INVALID', 'remoteInputs must not reuse remoteScriptPath');
    }
    manifest.submission = {
      method,
      softwareStack,
      remoteWorkdir: safeRelative(spec.remoteWorkdir, 'remoteWorkdir'),
      remoteScriptPath,
      script,
      remoteInputs,
      inputSnapshot: snapshotInputs(task.taskRoot, [localScriptPath, ...remoteInputs.map(item => item.localPath)]),
      resources: parseLsfResources(fs.readFileSync(scriptPath, 'utf8')),
    };
    const remoteWorkdir = displayRemotePath(access.remoteRoot, manifest.submission.remoteWorkdir);
    const boundFiles = [
      { path: manifest.submission.remoteScriptPath, sha256: manifest.submission.script.sha256 },
      ...manifest.submission.remoteInputs.map(item => ({ path: item.remotePath, sha256: item.sha256 })),
    ];
    manifest.executionPreview = {
      transport: 'ssh',
      commands: [
        `ssh ${access.host} ${displayShellQuote(`cd ${remoteWorkdir} && verify sha256 for ${boundFiles.map(item => `${item.path}=${item.sha256}`).join(', ')}`)}`,
        `ssh ${access.host} ${displayShellQuote(`cd ${remoteWorkdir} && bsub -J <generated-action-token> < ${manifest.submission.remoteScriptPath}`)}`,
      ],
      note: '先逐文件核对 manifest 中的哈希，再以唯一 action token 生成作业名并提交一次；响应不确定时只对账，不重提。',
    };
  }
  return manifest;
}

export function proposeExecutableAction(runId: string, input: {
  contextVersionId: unknown;
  stepId: unknown;
  capability: unknown;
  spec: unknown;
  idempotencyKey: unknown;
  conversationRef?: unknown;
}) {
  const contextVersionId = requiredText(input.contextVersionId, 'contextVersionId');
  const stepId = requiredText(input.stepId, 'stepId');
  const capability = assertCapability(input.capability);
  const spec = objectValue(input.spec, 'spec');
  const idempotencyKey = safeKey(input.idempotencyKey);
  const manifest = capability === 'local.process'
    ? buildLocalManifest(runId, contextVersionId, stepId, spec, idempotencyKey)
    : buildRemoteManifest(runId, contextVersionId, stepId, capability, spec, idempotencyKey);
  return createAction(runId, {
    contextVersionId,
    stepId,
    actionType: capability,
    manifest,
    idempotencyKey,
    conversationRef: input.conversationRef,
  });
}

function parseManifest(action: RunAction): ExecutionManifest {
  const manifest = action.manifest as unknown as ExecutionManifest;
  if (
    manifest?.schemaVersion !== EXECUTION_SCHEMA_VERSION
    || !EXECUTABLE_CAPABILITIES.includes(manifest.capability)
    || manifest.taskId !== taskForRun(action.run_id).task_id
    || manifest.contextVersionId !== action.context_version_id
    || manifest.stepId !== action.step_id
    || action.action_type !== manifest.capability
  ) throw new AgentCoreError(409, 'EXECUTION_MANIFEST_INVALID', 'Action is not bound to a supported generic execution manifest');
  return manifest;
}

function sameDescriptor(current: FileDescriptor, expected: FileDescriptor): boolean {
  return current.path === expected.path && current.size === expected.size && current.sha256 === expected.sha256;
}

function assertSnapshotCurrent(taskRoot: string, snapshot: InputSnapshot): void {
  const current = snapshotInputs(taskRoot, snapshot.roots);
  if (current.sha256 !== snapshot.sha256) {
    throw new AgentCoreError(409, 'EXECUTION_INPUT_DRIFT', 'Manifest input snapshot changed after authorization', {
      authorizedSha256: snapshot.sha256,
      currentSha256: current.sha256,
    });
  }
}

function runLocalProcess(manifest: LocalProcessManifest, taskRoot: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    assertExecutableAllowed(manifest.process.executable);
    const script = resolveWithinRoot(taskRoot, manifest.process.scriptPath, { mustExist: true, allowRoot: false, label: 'local process script' });
    const cwd = resolveWithinRoot(taskRoot, manifest.process.cwd, { mustExist: true, allowRoot: true, label: 'local process cwd' });
    const child = spawn(manifest.process.executable, [script, ...manifest.process.args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputLimited = false;
    const collect = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > manifest.process.maxOutputBytes) {
        outputLimited = true;
        child.kill();
      }
      return next.slice(0, manifest.process.maxOutputBytes);
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, manifest.process.timeoutMs);
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', error => { clearTimeout(timer); reject(new AgentCoreError(502, 'LOCAL_PROCESS_UNAVAILABLE', error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, outputLimited });
    });
  });
}

function writeReceipt(taskRoot: string, relativePath: string, value: Record<string, unknown>): void {
  const target = resolveWithinRoot(taskRoot, relativePath, { allowRoot: false, label: 'execution receipt' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function loadOrWriteReceipt(taskRoot: string, action: RunAction, manifest: ExecutionManifest, payload: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const target = resolveWithinRoot(taskRoot, manifest.receipt.path, { allowRoot: false, label: 'execution receipt' });
  if (fs.existsSync(target)) {
    const saved = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
    if (saved.actionId !== action.id || saved.manifestSha256 !== action.manifest_sha256) {
      throw new AgentCoreError(409, 'EXECUTION_RECEIPT_CONFLICT', 'Existing receipt belongs to a different action or manifest');
    }
    return Promise.resolve(saved);
  }
  return payload().then(result => {
    const receipt = {
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      actionId: action.id,
      manifestSha256: action.manifest_sha256,
      capability: manifest.capability,
      observedAt: now(),
      ...result,
    };
    writeReceipt(taskRoot, manifest.receipt.path, receipt);
    return receipt;
  });
}

function registerReceipt(action: RunAction, manifest: ExecutionManifest, receipt: Record<string, unknown>, status: 'pass' | 'fail') {
  const artifact = registerArtifact(action.id, {
    location: 'local',
    path: manifest.receipt.path,
    category: 'execution_receipt',
    idempotencyKey: 'execution-receipt',
    metadata: { capability: manifest.capability },
  });
  const evidence = registerEvidenceCheck(action.id, {
    artifactId: artifact.id,
    validatorName: manifest.capability === 'local.process' ? manifest.evidence.validatorName : manifest.capability,
    validatorVersion: manifest.capability === 'local.process' ? manifest.evidence.validatorVersion : '1',
    status,
    result: receipt,
    idempotencyKey: 'execution-evidence',
  });
  return { artifact, evidence };
}

function createFailureReview(action: RunAction, capability: string, error: Record<string, unknown>, artifactId?: string, evidenceCheckId?: string): void {
  createReview(action.run_id, {
    gateType: 'execution_failed',
    question: `${capability} 未通过。请在 Codex 对话中检查证据并决定修订 manifest、补充环境或终止。`,
    recommendation: { action: 'inspect_evidence_then_propose_new_manifest', artifactId },
    evidence: [{ artifactId, evidenceCheckId, ...error }],
    proposal: { failedActionId: action.id, capability },
    idempotencyKey: `execution-failed:${action.id}`,
    source: 'codex',
    conversationRef: action.conversation_ref,
  });
}

async function executeLocal(action: RunAction, manifest: LocalProcessManifest) {
  const task = taskForRun(action.run_id);
  assertLocalPolicy(task);
  if (process.env.WORKBENCH_LOCAL_EXEC_ENABLED !== '1') {
    throw new AgentCoreError(403, 'LOCAL_EXEC_ENV_DISABLED', 'Set WORKBENCH_LOCAL_EXEC_ENABLED=1 to enable authorized local process execution');
  }
  if (isProtectedRelativePath(manifest.receipt.path, effectivePolicy(task.project_id, task.task_id).effective.protectedPaths)) {
    throw new AgentCoreError(403, 'PROTECTED_PATH', 'Policy forbids writing the execution receipt path');
  }
  assertSnapshotCurrent(task.taskRoot, manifest.inputSnapshot);
  let current = action;
  if (current.status === 'authorized') current = transitionAction(current.id, { status: 'executing' });
  const receipt = await loadOrWriteReceipt(task.taskRoot, current, manifest, async () => {
    const processResult = await runLocalProcess(manifest, task.taskRoot);
    return { process: processResult };
  });
  const result = objectValue(receipt.process, 'receipt.process') as unknown as ProcessResult;
  const passed = manifest.evidence.expectedExitCodes.includes(result.exitCode)
    && !result.timedOut
    && !result.outputLimited
    && manifest.evidence.stdoutIncludes.every(token => result.stdout.includes(token));
  const { artifact, evidence } = registerReceipt(current, manifest, receipt, passed ? 'pass' : 'fail');
  if (passed) {
    transitionAction(current.id, { status: 'succeeded', result: { artifactId: artifact.id, evidenceCheckId: evidence.id } });
  } else {
    const error = { code: 'LOCAL_PROCESS_FAILED', exitCode: result.exitCode, timedOut: result.timedOut, outputLimited: result.outputLimited };
    transitionAction(current.id, { status: 'failed', error });
    createFailureReview(current, manifest.capability, error, artifact.id, evidence.id);
  }
  return getAction(current.id);
}

async function executeRemote(action: RunAction, manifest: RemoteManifest) {
  const task = taskForRun(action.run_id);
  if (manifest.transfer?.localFile) {
    const local = resolveWithinRoot(task.taskRoot, manifest.transfer.localPath, { mustExist: true, allowRoot: false, label: 'upload source' });
    if (!sameDescriptor(describeFile(task.taskRoot, local), manifest.transfer.localFile)) {
      throw new AgentCoreError(409, 'EXECUTION_INPUT_DRIFT', 'Upload source changed after manifest authorization');
    }
  }
  if (manifest.submission) assertSnapshotCurrent(task.taskRoot, manifest.submission.inputSnapshot);
  let current = action;
  if (current.status === 'authorized') current = transitionAction(current.id, { status: 'executing' });
  try {
    if (manifest.capability === 'job.submit') {
      const submission = manifest.submission!;
      const job = await submitAuthorizedLsfAction(current, {
        taskId: manifest.taskId,
        host: manifest.remote.host,
        remoteRoot: manifest.remote.root,
        remoteWorkdir: submission.remoteWorkdir,
        remoteScriptPath: submission.remoteScriptPath,
        scriptSha256: submission.script.sha256,
        remoteInputs: submission.remoteInputs,
        resources: submission.resources,
      });
      if (job.status === 'submission_uncertain') {
        transitionAction(current.id, { status: 'waiting_user', result: { remoteJobId: job.id, status: job.status } });
      } else if (job.status === 'preparation_failed') {
        transitionAction(current.id, { status: 'failed', error: { code: 'REMOTE_PREPARATION_FAILED', remoteJobId: job.id } });
      } else {
        transitionAction(current.id, { status: 'waiting_remote', result: { remoteJobId: job.id, jobId: job.job_id, status: job.status } });
      }
      return getAction(current.id);
    }

    const receipt = await loadOrWriteReceipt(task.taskRoot, current, manifest, async () => {
      let result: Record<string, unknown>;
      if (manifest.capability === 'remote.inspect') {
        const report = await inspectRemote(manifest.taskId, manifest.remote.host, manifest.remote.root);
        const missingCommands = Object.entries(report.commands).filter(([, item]) => !item.available).map(([name]) => name);
        result = { ...report, missingCommands };
      } else if (manifest.capability === 'remote.task-root.create') {
        result = await createRemoteTaskRoot(manifest.taskId, {
          host: manifest.remote.host,
          remoteRoot: manifest.remote.root,
        });
      } else if (manifest.capability === 'files.upload') {
        result = await upload(manifest.taskId, {
          host: manifest.remote.host,
          remoteRoot: manifest.remote.root,
          localPath: manifest.transfer!.localPath,
          remotePath: manifest.transfer!.remotePath,
          overwrite: manifest.transfer!.overwrite,
        });
      } else if (manifest.capability === 'files.download') {
        result = await download(manifest.taskId, {
          host: manifest.remote.host,
          remoteRoot: manifest.remote.root,
          localPath: manifest.transfer!.localPath,
          remotePath: manifest.transfer!.remotePath,
          overwrite: manifest.transfer!.overwrite,
        });
      } else {
        result = await cancelJob(manifest.targetJob!.remoteJobId) as unknown as Record<string, unknown>;
      }
      return { result };
    });
    const remoteResult = objectValue(receipt.result, 'receipt.result');
    const passed = manifest.capability !== 'remote.inspect'
      || (Array.isArray(remoteResult.missingCommands) && remoteResult.missingCommands.length === 0 && Boolean(remoteResult.scheduler));
    const { artifact, evidence } = registerReceipt(current, manifest, receipt, passed ? 'pass' : 'fail');
    if (manifest.capability === 'files.download') {
      registerArtifact(current.id, {
        location: 'local',
        path: manifest.transfer!.localPath,
        category: 'remote_download',
        idempotencyKey: 'downloaded-file',
        metadata: { host: manifest.remote.host, remotePath: manifest.transfer!.remotePath },
      });
    }
    if (passed) {
      transitionAction(current.id, { status: 'succeeded', result: { artifactId: artifact.id, evidenceCheckId: evidence.id } });
    } else {
      const error = { code: 'REMOTE_CAPABILITY_INCOMPLETE', artifactId: artifact.id };
      transitionAction(current.id, { status: 'failed', error });
      createFailureReview(current, manifest.capability, error, artifact.id, evidence.id);
    }
    return getAction(current.id);
  } catch (error) {
    const latest = getAction(current.id) as RunAction;
    if (latest.status === 'executing') {
      const item = error as AgentCoreError;
      const failure = { code: item.code ?? 'EXECUTION_FAILED', message: item.message };
      transitionAction(current.id, { status: 'failed', error: failure });
      createFailureReview(current, manifest.capability, failure);
    }
    throw error;
  }
}

export async function executeAction(actionId: string) {
  if (activeExecutions.has(actionId)) {
    throw new AgentCoreError(409, 'EXECUTION_IN_PROGRESS', 'This action is already executing in the current Workbench process');
  }
  activeExecutions.add(actionId);
  try {
    const action = getActionForExecution(actionId, ['authorized', 'executing']);
    const manifest = parseManifest(action);
    const task = taskForRun(action.run_id);
    if (action.status === 'executing' && !['job.submit', 'remote.inspect'].includes(manifest.capability)) {
      const receipt = resolveWithinRoot(task.taskRoot, manifest.receipt.path, { allowRoot: false, label: 'execution receipt' });
      if (!fs.existsSync(receipt)) {
        const error = { code: 'EXECUTION_RECOVERY_UNCERTAIN', capability: manifest.capability };
        transitionAction(action.id, { status: 'waiting_user', result: error });
        createReview(action.run_id, {
          gateType: 'execution_recovery_uncertain',
          question: `${manifest.capability} 在服务中断前已进入 executing，但没有可验证 receipt。为避免重复副作用，Codex 不会自动重跑。`,
          recommendation: { action: 'inspect_external_state_then_propose_new_manifest' },
          evidence: [error],
          proposal: { uncertainActionId: action.id, capability: manifest.capability },
          idempotencyKey: `execution-recovery-uncertain:${action.id}`,
          source: 'codex',
          conversationRef: action.conversation_ref,
        });
        throw new AgentCoreError(409, 'EXECUTION_RECOVERY_UNCERTAIN', 'Execution outcome is uncertain; inspect evidence and resolve the Codex review before proposing a replacement action');
      }
    }
    return manifest.capability === 'local.process'
      ? executeLocal(action, manifest)
      : executeRemote(action, manifest);
  } finally {
    activeExecutions.delete(actionId);
  }
}

export function describeExecutionContract() {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    capabilities: EXECUTABLE_CAPABILITIES,
    specs: {
      'local.process': {
        required: ['executable', 'scriptPath'],
        optional: ['args', 'cwd', 'inputPaths', 'timeoutMs', 'maxOutputBytes', 'expectedExitCodes', 'stdoutIncludes', 'validatorName', 'validatorVersion', 'receiptPath'],
        semantics: 'Run one allowlisted executable without a shell against an immutable Task-relative script/input snapshot.',
      },
      'remote.inspect': {
        required: ['host', 'remoteRoot'],
        optional: ['receiptPath'],
        semantics: 'Inspect the approved remote root and required scheduler commands.',
      },
      'remote.task-root.create': {
        required: ['host', 'remoteRoot'],
        optional: ['receiptPath'],
        semantics: 'Create or verify exactly the registered Task write root as one direct child of the existing project root.',
      },
      'files.upload': {
        required: ['host', 'remoteRoot', 'localPath', 'remotePath'],
        optional: ['overwrite', 'receiptPath'],
        semantics: 'Transfer one immutable Task-relative local file into the approved remote root.',
      },
      'files.download': {
        required: ['host', 'remoteRoot', 'localPath', 'remotePath'],
        optional: ['overwrite', 'receiptPath'],
        semantics: 'Transfer one remote file from the approved root into the Task root.',
      },
      'job.submit': {
        required: ['host', 'remoteRoot', 'method', 'softwareStack', 'remoteWorkdir', 'localScriptPath'],
        optional: ['remoteScriptPath', 'remoteInputs', 'receiptPath'],
        semantics: 'Submit one previously transferred LSF script after verifying its hash, every declared remote input hash and the authorized resources.',
      },
      'job.cancel': {
        required: ['remoteJobId'],
        optional: ['receiptPath'],
        semantics: 'Cancel one scheduler job already recorded for the same research run.',
      },
    },
    binding: {
      required: ['runId', 'contextVersionId', 'stepId', 'capability', 'spec', 'idempotencyKey'],
      immutable: ['contextVersionId', 'stepId', 'capability', 'manifestSha256', 'inputHashes', 'paths', 'resources'],
      authorization: 'Exact manifest hash must be explicitly confirmed in the Codex conversation before execution.',
    },
    local: {
      environmentSwitch: 'WORKBENCH_LOCAL_EXEC_ENABLED=1',
      executableAllowlist: [...allowedLocalExecutables()].sort(),
      shell: false,
      maxTimeoutMs: MAX_LOCAL_TIMEOUT_MS,
      maxOutputBytes: MAX_LOCAL_OUTPUT_BYTES,
    },
    remote: {
      environmentSwitch: 'WORKBENCH_REMOTE_ENABLED=1',
      lsfEnvironmentSwitch: 'WORKBENCH_ALLOW_REMOTE_LSF=1',
      policyBound: true,
    },
  };
}
