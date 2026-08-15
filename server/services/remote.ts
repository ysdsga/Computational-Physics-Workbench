import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import db from '../db.js';
import type { AgentPolicyDocument, RemoteCapabilityReport, RemoteJob, ResearchContract } from '../../src/types/index.js';
import { AgentCoreError, appendEvent, createReview, effectivePolicy, hashJson, newId, normalizeRemoteRoot, now, parseContract, stableJson } from './agentCore.js';
import { isPathInside, resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

const MAX_OUTPUT = 1024 * 1024;
const SSH_TIMEOUT_MS = 20_000;

interface ProcessResult { code: number; stdout: string; stderr: string }

function runProcess(command: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<ProcessResult> {
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

interface RemoteAccess {
  task: any;
  run: any;
  policy: AgentPolicyDocument;
  contract: ResearchContract;
  host: string;
  remoteRoot: string;
  taskRoot: string;
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

function authorize(taskId: string, hostInput: unknown, rootInput: unknown, operation: string, smoke = false): RemoteAccess {
  if (process.env.WORKBENCH_REMOTE_ENABLED !== '1') throw new AgentCoreError(403, 'REMOTE_ENV_DISABLED', 'Set WORKBENCH_REMOTE_ENABLED=1 to enable remote actions');
  const task = db.prepare(`SELECT tasks.*, projects.working_dir FROM tasks JOIN projects ON projects.id = tasks.project_id WHERE tasks.id = ?`).get(taskId) as any;
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
  const remoteRoot = normalizeRemoteRoot(String(rootInput ?? ''));
  if (!effective.remoteRoot || (remoteRoot !== effective.remoteRoot && !(effective.remoteRoot === '/' ? remoteRoot.startsWith('/') : remoteRoot.startsWith(`${effective.remoteRoot}/`)))) throw new AgentCoreError(403, 'REMOTE_ROOT_DENIED', 'Remote root is outside the effective policy');
  if (smoke) {
    if (process.env.WORKBENCH_ALLOW_REMOTE_SMOKE !== '1') throw new AgentCoreError(403, 'REMOTE_SMOKE_ENV_DISABLED', 'Set WORKBENCH_ALLOW_REMOTE_SMOKE=1 to enable smoke submission');
    if (!effective.smokeAuthorized) throw new AgentCoreError(403, 'REMOTE_SMOKE_POLICY_DENIED', 'Effective policy does not authorize smoke submission');
  }
  const taskRoot = resolveWithinRoot(task.working_dir, normalizeTaskRootRel(task.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  if (effective.localRoot && !isPathInside(path.resolve(effective.localRoot), path.resolve(taskRoot))) {
    throw new AgentCoreError(403, 'LOCAL_ROOT_DENIED', 'Task root is outside the effective local policy root');
  }
  return { task, run, policy: effective, contract: parseContract(adoptedContext.contract_content), host, remoteRoot, taskRoot };
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
  const access = authorize(taskId, hostInput, rootInput, 'remote.inspect');
  const commands = ['lsid', 'bsub', 'bjobs', 'bhist', 'bpeek', 'bkill'];
  const script = `set -eu; test -d ${shellQuote(access.remoteRoot)}; cd ${shellQuote(access.remoteRoot)}; printf 'ROOT=%s\\n' "$(pwd -P)"; ${commands.map(name => `printf '${name}='; command -v ${name} || true`).join('; ')}; lsid 2>/dev/null || true`;
  let result: ProcessResult;
  try {
    result = await runProcess('ssh', sshArgs(access.host, script));
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

async function prepareRemoteParent(host: string, remoteRoot: string, targetPath: string, create: boolean): Promise<void> {
  const parent = targetPath.slice(0, targetPath.lastIndexOf('/')) || '/';
  const script = `set -eu; root=$(cd ${shellQuote(remoteRoot)} && pwd -P); target=${shellQuote(parent)}; probe="$target"; while [ ! -e "$probe" ]; do next=\${probe%/*}; [ "$next" != "$probe" ] || exit 74; probe="$next"; done; actual=$(cd "$probe" && pwd -P); case "$actual" in "$root"|"$root"/*) ;; *) exit 73;; esac; ${create ? 'mkdir -p -- "$target"' : 'test -d "$target"'}; final=$(cd "$target" && pwd -P); case "$final" in "$root"|"$root"/*) ;; *) exit 73;; esac`;
  const result = await runProcess('ssh', sshArgs(host, script));
  if (result.code === 73) throw new AgentCoreError(403, 'REMOTE_PATH_ESCAPE', 'Remote path resolves outside the approved root');
  if (result.code !== 0) explainSshFailure(result);
}

export async function upload(taskId: string, input: any) {
  const access = authorize(taskId, input.host, input.remoteRoot, 'files.upload');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { mustExist: true, allowRoot: false, label: 'local upload path' });
  if (!fs.statSync(local).isFile()) throw new AgentCoreError(400, 'UPLOAD_FILE_REQUIRED', 'Upload source must be a file');
  if (fs.statSync(local).size > 10 * 1024 * 1024) throw new AgentCoreError(413, 'UPLOAD_TOO_LARGE', 'V1 upload limit is 10 MB');
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  if (input.overwrite === true && isProtectedRelativePath(input.remotePath, access.policy.protectedPaths)) {
    throw new AgentCoreError(403, 'PROTECTED_PATH', 'Policy forbids overwriting this remote path');
  }
  if (!input.overwrite && await existsRemote(access.host, remote)) throw new AgentCoreError(409, 'REMOTE_FILE_EXISTS', 'Remote target exists; overwrite is disabled');
  await prepareRemoteParent(access.host, access.remoteRoot, remote, true);
  const result = await runProcess('sftp', sftpArgs(access.host), { input: `put ${sftpQuote(local)} ${sftpQuote(remote)}\n` });
  if (result.code !== 0) explainSshFailure(result);
  const payload = { host: access.host, localPath: input.localPath, remotePath: input.remotePath, size: fs.statSync(local).size };
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.file_uploaded', actorType: 'system', payload });
  return payload;
}

export async function download(taskId: string, input: any) {
  const access = authorize(taskId, input.host, input.remoteRoot, 'files.download');
  const local = resolveWithinRoot(access.taskRoot, input.localPath, { allowRoot: false, label: 'local download path' });
  const remote = remoteRelative(access.remoteRoot, input.remotePath);
  await prepareRemoteParent(access.host, access.remoteRoot, remote, false);
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

function serializeJob(row: any): RemoteJob { return { ...row, last_observation: JSON.parse(row.last_observation_json) }; }

function parseJobId(output: string): string | null { return output.match(/Job\s+<([0-9]+)>/i)?.[1] ?? null; }

export async function submitSmoke(taskId: string, input: any) {
  const access = authorize(taskId, input.host, input.remoteRoot, 'job.submit_smoke', true);
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw new AgentCoreError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  if (input.queue && !/^[a-zA-Z0-9._-]+$/.test(input.queue)) throw new AgentCoreError(400, 'LSF_QUEUE_INVALID', 'Queue name contains unsupported characters');
  const existing = db.prepare('SELECT * FROM remote_jobs WHERE run_id = ? AND idempotency_key = ?').get(access.run.id, input.idempotencyKey) as any;
  if (existing) return serializeJob(existing);
  if (input.confirmed !== true) throw new AgentCoreError(403, 'REMOTE_SMOKE_CONFIRMATION_REQUIRED', 'The first smoke submission requires explicit UI/CLI confirmation');
  if (!smokeBudgetAllowsOneCoreMinute(access.policy, access.contract)) {
    throw new AgentCoreError(403, 'REMOTE_SMOKE_BUDGET_DENIED', 'The adopted contract or policy budget is below the fixed 1-core/1-minute smoke requirement');
  }
  const concurrentLimit = Math.min(access.policy.limits.maxConcurrentJobs, access.contract.resourceBudget.maxConcurrentJobs);
  const openJobs = (db.prepare(`SELECT COUNT(*) AS count FROM remote_jobs WHERE run_id = ? AND lower(status) NOT IN ('done', 'exit', 'zombi', 'unkwn', 'preparation_failed')`).get(access.run.id) as { count: number }).count;
  if (openJobs >= concurrentLimit) throw new AgentCoreError(409, 'REMOTE_CONCURRENCY_LIMIT', 'The adopted contract or policy concurrent-job limit has been reached');
  const token = crypto.randomBytes(12).toString('hex');
  const jobName = `wb-smoke-${token.slice(0, 10)}`;
  const remoteWorkdir = remoteRelative(access.remoteRoot, `.workbench-smoke/${token}`);
  const id = newId('rjob'); const ts = now();
  db.prepare(`INSERT INTO remote_jobs (id, run_id, context_version_id, action_token, idempotency_key, host, remote_root, remote_workdir, job_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)`)
    .run(id, access.run.id, access.run.current_context_version_id, token, input.idempotencyKey, access.host, access.remoteRoot, remoteWorkdir, jobName, ts);
  const queueLine = input.queue ? `#BSUB -q ${input.queue}\n` : '';
  const script = `#!/bin/sh\n#BSUB -J ${jobName}\n#BSUB -n 1\n#BSUB -W 00:01\n#BSUB -oo smoke.%J.out\n#BSUB -eo smoke.%J.err\n${queueLine}set -eu\nprintf 'WORKBENCH_TOKEN=%s\\n' '${token}'\nhostname\ndate -u '+%Y-%m-%dT%H:%M:%SZ'\n`;
  try {
    await prepareRemoteParent(access.host, access.remoteRoot, `${remoteWorkdir}/smoke.lsf`, true);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-smoke-'));
    const tempFile = path.join(tempDir, 'smoke.lsf');
    fs.writeFileSync(tempFile, script, 'utf8');
    try {
      const put = await runProcess('sftp', sftpArgs(access.host), { input: `put ${sftpQuote(tempFile)} ${sftpQuote(`${remoteWorkdir}/smoke.lsf`)}\n` });
      if (put.code !== 0) explainSshFailure(put);
    } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
  } catch (error) {
    db.prepare("UPDATE remote_jobs SET status = 'preparation_failed', submit_stderr = ?, reconciled_at = ? WHERE id = ?").run((error as Error).message, now(), id);
    appendEvent(access.run.id, { category: 'fact', eventType: 'remote.smoke_preparation_failed', actorType: 'system', payload: { remoteJobId: id, code: (error as AgentCoreError).code ?? 'REMOTE_PREPARATION_FAILED', message: (error as Error).message } });
    throw error;
  }
  let submit: ProcessResult;
  try {
    submit = await runProcess('ssh', sshArgs(access.host, `cd ${shellQuote(remoteWorkdir)} && bsub < smoke.lsf`));
  } catch (error) {
    const item = error as AgentCoreError;
    db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', submit_stderr = ?, reconciled_at = ? WHERE id = ?").run(`${item.code ?? 'SSH_FAILED'}: ${item.message}`, now(), id);
    createReview(access.run.id, { gateType: 'remote_submission_uncertain', question: 'LSF 提交响应不确定，需人工确认唯一作业后再继续。', recommendation: { action: 'reconcile_by_token', token }, evidence: [{ code: item.code ?? 'SSH_FAILED', message: item.message, jobName }], proposal: { remoteJobId: id }, idempotencyKey: `remote-submission-uncertain:${id}` });
    return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
  }
  const jobId = parseJobId(`${submit.stdout}\n${submit.stderr}`);
  if (submit.code !== 0 || !jobId) {
    db.prepare("UPDATE remote_jobs SET status = 'submission_uncertain', submit_stdout = ?, submit_stderr = ?, reconciled_at = ? WHERE id = ?").run(submit.stdout, submit.stderr, now(), id);
    createReview(access.run.id, { gateType: 'remote_submission_uncertain', question: 'LSF 提交响应不确定，需人工确认唯一作业后再继续。', recommendation: { action: 'reconcile_by_token', token }, evidence: [{ stdout: submit.stdout, stderr: submit.stderr, jobName }], proposal: { remoteJobId: id }, idempotencyKey: `remote-submission-uncertain:${id}` });
    return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
  }
  db.prepare("UPDATE remote_jobs SET job_id = ?, status = 'submitted', submit_stdout = ?, submit_stderr = ?, submitted_at = ? WHERE id = ?").run(jobId, submit.stdout, submit.stderr, now(), id);
  appendEvent(access.run.id, { category: 'fact', eventType: 'remote.smoke_submitted', actorType: 'system', payload: { remoteJobId: id, jobId, jobName, token, remoteWorkdir } });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
}

function loadJob(id: string): any {
  const row = db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id) as any;
  if (!row) throw new AgentCoreError(404, 'REMOTE_JOB_NOT_FOUND', 'Remote job not found');
  return row;
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
  appendEvent(row.run_id, { category: 'fact', eventType: 'remote.job_reconciled', actorType: 'system', payload: { remoteJobId: row.id, ...observation } });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(row.id));
}

function authorizeRecordedJob(row: any, operation: string) {
  const taskId = (db.prepare('SELECT task_id FROM research_runs WHERE id = ?').get(row.run_id) as any)?.task_id;
  return authorize(taskId, row.host, row.remote_root, operation);
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
  appendEvent(row.run_id, { category: 'decision', eventType: 'remote.job_cancel_requested', actorType: 'researcher', payload: { remoteJobId: id, jobId: row.job_id } });
  return serializeJob(db.prepare('SELECT * FROM remote_jobs WHERE id = ?').get(id));
}
