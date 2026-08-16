import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import db from '../db.js';
import type {
  AgentContextV1,
  AgentPolicy,
  AgentPolicyDocument,
  ResearchContract,
  ResearchRun,
  ReviewRequest,
  RunContextVersion,
  RunEvent,
  Task,
  WorkflowTemplate,
} from '../../src/types/index.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

export class AgentCoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashJson(value: unknown): string {
  return sha256(stableJson(value));
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AgentCoreError(400, 'CONTRACT_INVALID', `${field} must be an array of strings`);
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))].sort();
}

function protectedPathList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new AgentCoreError(400, 'POLICY_INVALID', 'protectedPaths must be an array of relative paths');
  }
  const normalized = (value as string[]).map(item => item.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, ''));
  if (normalized.some(item => !item || item.startsWith('/') || /^[a-zA-Z]:/.test(item) || item.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new AgentCoreError(400, 'POLICY_INVALID', 'protectedPaths must contain normalized relative paths without traversal');
  }
  return [...new Set(normalized)].sort();
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AgentCoreError(400, 'CONTRACT_INVALID', `${field} must be a positive number`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AgentCoreError(400, 'CONTRACT_INVALID', `${field} must be a non-negative number`);
  }
  return value;
}

export function validateContract(input: unknown): ResearchContract {
  if (!input || typeof input !== 'object') throw new AgentCoreError(400, 'CONTRACT_INVALID', 'Contract must be an object');
  const value = input as Record<string, any>;
  if (value.schemaVersion !== 1) throw new AgentCoreError(400, 'CONTRACT_INVALID', 'schemaVersion must be 1');
  if (!value.approvedPlan || typeof value.approvedPlan.path !== 'string' || !/^[a-f0-9]{64}$/i.test(value.approvedPlan.sha256 ?? '')) {
    throw new AgentCoreError(400, 'CONTRACT_INVALID', 'approvedPlan path and SHA-256 are required');
  }
  const bounds: Record<string, { min?: number; max?: number; values?: string[] }> = {};
  if (!value.boundaries?.parameterBounds || typeof value.boundaries.parameterBounds !== 'object') {
    throw new AgentCoreError(400, 'CONTRACT_INVALID', 'boundaries.parameterBounds must be an object');
  }
  for (const [name, raw] of Object.entries(value.boundaries.parameterBounds as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') throw new AgentCoreError(400, 'CONTRACT_INVALID', `Invalid parameter bound: ${name}`);
    const bound: { min?: number; max?: number; values?: string[] } = {};
    if (raw.min !== undefined) {
      if (typeof raw.min !== 'number' || !Number.isFinite(raw.min)) throw new AgentCoreError(400, 'CONTRACT_INVALID', `${name}.min must be numeric`);
      bound.min = raw.min;
    }
    if (raw.max !== undefined) {
      if (typeof raw.max !== 'number' || !Number.isFinite(raw.max)) throw new AgentCoreError(400, 'CONTRACT_INVALID', `${name}.max must be numeric`);
      bound.max = raw.max;
    }
    if (bound.min !== undefined && bound.max !== undefined && bound.min > bound.max) {
      throw new AgentCoreError(400, 'CONTRACT_INVALID', `${name}.min cannot exceed max`);
    }
    if (raw.values !== undefined) bound.values = stringList(raw.values, `${name}.values`);
    bounds[name] = bound;
  }
  const budget = value.resourceBudget ?? {};
  return {
    schemaVersion: 1,
    approvedPlan: { path: value.approvedPlan.path, sha256: value.approvedPlan.sha256.toLowerCase() },
    objectives: stringList(value.objectives, 'objectives'),
    requiredStages: stringList(value.requiredStages, 'requiredStages'),
    boundaries: {
      allowedSoftwareStacks: stringList(value.boundaries?.allowedSoftwareStacks, 'boundaries.allowedSoftwareStacks'),
      allowedMethods: stringList(value.boundaries?.allowedMethods, 'boundaries.allowedMethods'),
      parameterBounds: bounds,
    },
    humanGates: stringList(value.humanGates, 'humanGates'),
    completion: { requiredEvidence: stringList(value.completion?.requiredEvidence, 'completion.requiredEvidence') },
    resourceBudget: {
      maxCoresPerJob: positiveNumber(budget.maxCoresPerJob, 'resourceBudget.maxCoresPerJob'),
      maxWallMinutes: positiveNumber(budget.maxWallMinutes, 'resourceBudget.maxWallMinutes'),
      maxConcurrentJobs: positiveNumber(budget.maxConcurrentJobs, 'resourceBudget.maxConcurrentJobs'),
      maxAutomaticRetries: nonNegativeNumber(budget.maxAutomaticRetries, 'resourceBudget.maxAutomaticRetries'),
    },
  };
}

export function parseContract(content: string): ResearchContract {
  try {
    return validateContract(parseYaml(content));
  } catch (error) {
    if (error instanceof AgentCoreError) throw error;
    throw new AgentCoreError(400, 'CONTRACT_INVALID', (error as Error).message);
  }
}

export function contractPath(projectRoot: string, researchPlanId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(researchPlanId)) throw new AgentCoreError(400, 'CONTRACT_PATH_INVALID', 'Invalid research plan id');
  return resolveWithinRoot(projectRoot, `.workbench/contracts/${researchPlanId}.yaml`, { label: 'contract path' });
}

export function readPlanAndContract(researchPlanId: string) {
  const row = db.prepare(`
    SELECT rp.*, p.working_dir FROM research_plans rp
    JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?
  `).get(researchPlanId) as { file_name: string; project_id: string; working_dir: string } | undefined;
  if (!row) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  if (!row.working_dir) throw new AgentCoreError(409, 'WORKING_DIR_REQUIRED', 'Project working directory is not configured');
  const planFile = resolveWithinRoot(row.working_dir, row.file_name, { mustExist: true, label: 'research plan' });
  const planContent = fs.readFileSync(planFile, 'utf8');
  const contractFile = contractPath(row.working_dir, researchPlanId);
  if (!fs.existsSync(contractFile)) throw new AgentCoreError(409, 'CONTRACT_MISSING', 'Research contract does not exist');
  const contractContent = fs.readFileSync(contractFile, 'utf8');
  const contract = parseContract(contractContent);
  if (contract.approvedPlan.path !== row.file_name) {
    throw new AgentCoreError(409, 'PLAN_PATH_MISMATCH', 'Research contract points to a different research plan source path');
  }
  const planHash = sha256(planContent);
  if (contract.approvedPlan.sha256 !== planHash) {
    throw new AgentCoreError(409, 'PLAN_CONTRACT_DRIFT', 'Research plan hash does not match the contract', {
      planSha256: planHash,
      contractPlanSha256: contract.approvedPlan.sha256,
    });
  }
  return { ...row, planFile, planContent, planHash, contractFile, contractContent, contract, contractHash: hashJson(contract) };
}

export function initializeContract(researchPlanId: string, overwrite = false) {
  const row = db.prepare(`SELECT rp.file_name, p.working_dir FROM research_plans rp JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?`)
    .get(researchPlanId) as { file_name: string; working_dir: string } | undefined;
  if (!row) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  const planFile = resolveWithinRoot(row.working_dir, row.file_name, { mustExist: true, label: 'research plan' });
  const planContent = fs.readFileSync(planFile, 'utf8');
  const target = contractPath(row.working_dir, researchPlanId);
  if (fs.existsSync(target) && !overwrite) throw new AgentCoreError(409, 'CONTRACT_EXISTS', 'Research contract already exists');
  const contract: ResearchContract = {
    schemaVersion: 1,
    approvedPlan: { path: row.file_name, sha256: sha256(planContent) },
    objectives: [],
    requiredStages: [],
    boundaries: { allowedSoftwareStacks: [], allowedMethods: [], parameterBounds: {} },
    humanGates: ['final_interpretation'],
    completion: { requiredEvidence: ['inputs', 'software_versions', 'job_records', 'validation_report'] },
    resourceBudget: { maxCoresPerJob: 1, maxWallMinutes: 1, maxConcurrentJobs: 1, maxAutomaticRetries: 1 },
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, stringifyYaml(contract), { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  return { path: path.relative(row.working_dir, target), content: stringifyYaml(contract), contract, sha256: hashJson(contract) };
}

export function writeContract(researchPlanId: string, content: string, expectedPlanSha256?: string) {
  const row = db.prepare(`SELECT rp.file_name, p.working_dir FROM research_plans rp JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?`)
    .get(researchPlanId) as { file_name: string; working_dir: string } | undefined;
  if (!row) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  const planFile = resolveWithinRoot(row.working_dir, row.file_name, { mustExist: true, label: 'research plan' });
  const planHash = sha256(fs.readFileSync(planFile, 'utf8'));
  if (expectedPlanSha256 && expectedPlanSha256 !== planHash) throw new AgentCoreError(409, 'STALE_PLAN', 'Research plan changed since the contract was edited');
  const contract = parseContract(content);
  if (contract.approvedPlan.path !== row.file_name || contract.approvedPlan.sha256 !== planHash) {
    throw new AgentCoreError(409, 'PLAN_CONTRACT_DRIFT', 'Contract must bind the current research plan path and hash', { planSha256: planHash });
  }
  const target = contractPath(row.working_dir, researchPlanId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, stringifyYaml(contract), 'utf8');
  fs.renameSync(temp, target);
  return { path: path.relative(row.working_dir, target), content: stringifyYaml(contract), contract, sha256: hashJson(contract) };
}

function subset(child: string[], parent: string[]): boolean {
  return child.every(value => parent.includes(value));
}

export function contractIsSameOrStricter(next: ResearchContract, current: ResearchContract): { ok: boolean; expansions: string[] } {
  const expansions: string[] = [];
  if (next.approvedPlan.path !== current.approvedPlan.path) expansions.push('approved_plan_path');
  if (stableJson(next.objectives) !== stableJson(current.objectives)) expansions.push('objectives_changed');
  if (!subset(current.requiredStages, next.requiredStages)) expansions.push('required_stages_removed');
  if (!subset(current.completion.requiredEvidence, next.completion.requiredEvidence)) expansions.push('required_evidence_removed');
  if (!subset(next.boundaries.allowedSoftwareStacks, current.boundaries.allowedSoftwareStacks)) expansions.push('software_stacks');
  if (!subset(next.boundaries.allowedMethods, current.boundaries.allowedMethods)) expansions.push('methods');
  if (!subset(current.humanGates, next.humanGates)) expansions.push('human_gates_removed');
  for (const name of Object.keys(current.boundaries.parameterBounds)) {
    if (!Object.prototype.hasOwnProperty.call(next.boundaries.parameterBounds, name)) expansions.push(`parameter:${name}:removed`);
  }
  for (const [name, bound] of Object.entries(next.boundaries.parameterBounds)) {
    const before = current.boundaries.parameterBounds[name];
    if (!before) { expansions.push(`parameter:${name}`); continue; }
    if (before.min !== undefined && (bound.min === undefined || bound.min < before.min)) expansions.push(`parameter:${name}:min`);
    if (before.max !== undefined && (bound.max === undefined || bound.max > before.max)) expansions.push(`parameter:${name}:max`);
    if (before.values && (!bound.values || !subset(bound.values, before.values))) expansions.push(`parameter:${name}:values`);
  }
  const keys = Object.keys(next.resourceBudget) as Array<keyof ResearchContract['resourceBudget']>;
  for (const key of keys) if (next.resourceBudget[key] > current.resourceBudget[key]) expansions.push(`budget:${key}`);
  return { ok: expansions.length === 0, expansions };
}

const SYSTEM_DEFAULT: AgentPolicyDocument = {
  schemaVersion: 1,
  remoteEnabled: false,
  smokeAuthorized: false,
  allowedOperations: ['context', 'event.append', 'review.request', 'local.process'],
  allowedHosts: [],
  allowedMethods: [],
  limits: { maxCoresPerJob: 1, maxWallMinutes: 1, maxConcurrentJobs: 1, maxAutomaticRetries: 1 },
  protectedPaths: [],
  humanGates: ['final_interpretation'],
};

export function validatePolicy(input: unknown): AgentPolicyDocument {
  if (!input || typeof input !== 'object') throw new AgentCoreError(400, 'POLICY_INVALID', 'Policy must be an object');
  const value = input as Record<string, any>;
  if (value.schemaVersion !== 1) throw new AgentCoreError(400, 'POLICY_INVALID', 'schemaVersion must be 1');
  const limits = value.limits ?? {};
  const legacyRemoteRoot = typeof value.remoteRoot === 'string' && value.remoteRoot.trim() ? normalizeRemoteRoot(value.remoteRoot) : undefined;
  const remoteReadRoot = typeof value.remoteReadRoot === 'string' && value.remoteReadRoot.trim() ? normalizeRemoteRoot(value.remoteReadRoot) : undefined;
  const remoteProjectRoot = typeof value.remoteProjectRoot === 'string' && value.remoteProjectRoot.trim() ? normalizeRemoteRoot(value.remoteProjectRoot) : undefined;
  const remoteWriteRoot = typeof value.remoteWriteRoot === 'string' && value.remoteWriteRoot.trim() ? normalizeRemoteRoot(value.remoteWriteRoot) : undefined;
  const usesSplitBoundary = Boolean(remoteReadRoot || remoteProjectRoot || remoteWriteRoot);
  if (legacyRemoteRoot && usesSplitBoundary) throw new AgentCoreError(400, 'POLICY_INVALID', 'remoteRoot cannot be combined with split remote read/project/write roots');
  if (usesSplitBoundary && (!remoteReadRoot || !remoteProjectRoot || !remoteWriteRoot)) {
    throw new AgentCoreError(400, 'POLICY_INVALID', 'remoteReadRoot, remoteProjectRoot and remoteWriteRoot must be configured together');
  }
  if (remoteReadRoot && remoteProjectRoot && remoteWriteRoot) {
    if (!remoteChild(remoteProjectRoot, remoteReadRoot)) throw new AgentCoreError(400, 'POLICY_INVALID', 'remoteProjectRoot must remain inside remoteReadRoot');
    if (!remoteChild(remoteWriteRoot, remoteProjectRoot)) throw new AgentCoreError(400, 'POLICY_INVALID', 'remoteWriteRoot must remain inside remoteProjectRoot');
  }
  return {
    schemaVersion: 1,
    remoteEnabled: value.remoteEnabled === true,
    smokeAuthorized: value.smokeAuthorized === true,
    allowedOperations: stringList(value.allowedOperations, 'allowedOperations'),
    allowedHosts: stringList(value.allowedHosts, 'allowedHosts'),
    allowedMethods: stringList(value.allowedMethods, 'allowedMethods'),
    ...(typeof value.localRoot === 'string' && value.localRoot.trim() ? { localRoot: path.resolve(value.localRoot) } : {}),
    ...(legacyRemoteRoot ? { remoteRoot: legacyRemoteRoot } : {}),
    ...(remoteReadRoot ? { remoteReadRoot } : {}),
    ...(remoteProjectRoot ? { remoteProjectRoot } : {}),
    ...(remoteWriteRoot ? { remoteWriteRoot } : {}),
    limits: {
      maxCoresPerJob: positiveNumber(limits.maxCoresPerJob, 'limits.maxCoresPerJob'),
      maxWallMinutes: positiveNumber(limits.maxWallMinutes, 'limits.maxWallMinutes'),
      maxConcurrentJobs: positiveNumber(limits.maxConcurrentJobs, 'limits.maxConcurrentJobs'),
      maxAutomaticRetries: nonNegativeNumber(limits.maxAutomaticRetries, 'limits.maxAutomaticRetries'),
    },
    protectedPaths: protectedPathList(value.protectedPaths),
    humanGates: stringList(value.humanGates, 'humanGates'),
  };
}

export function normalizeRemoteRoot(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/') || normalized.includes('\r') || normalized.includes('\n') || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new AgentCoreError(400, 'REMOTE_ROOT_INVALID', 'Remote root must be an absolute POSIX path without traversal');
  }
  return normalized;
}

function localChild(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function remoteChild(child: string, parent: string): boolean {
  const c = normalizeRemoteRoot(child); const p = normalizeRemoteRoot(parent);
  return c === p || (p === '/' ? c.startsWith('/') : c.startsWith(`${p}/`));
}

export function policyRemoteRoots(policy: AgentPolicyDocument): {
  readRoot?: string;
  projectRoot?: string;
  writeRoot?: string;
  legacy: boolean;
} {
  if (policy.remoteRoot) {
    return { readRoot: policy.remoteRoot, projectRoot: policy.remoteRoot, writeRoot: policy.remoteRoot, legacy: true };
  }
  return {
    readRoot: policy.remoteReadRoot,
    projectRoot: policy.remoteProjectRoot,
    writeRoot: policy.remoteWriteRoot,
    legacy: false,
  };
}

function intersect(left: string[], right: string[]): string[] {
  return left.filter(value => right.includes(value)).sort();
}

export function tightenPolicy(parent: AgentPolicyDocument, child: AgentPolicyDocument): AgentPolicyDocument {
  if (child.remoteEnabled && !parent.remoteEnabled) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy cannot enable remote access');
  if (child.smokeAuthorized && !parent.smokeAuthorized) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy cannot authorize smoke submission');
  if (!subset(child.allowedOperations, parent.allowedOperations)) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy expands allowed operations');
  if (!subset(child.allowedHosts, parent.allowedHosts)) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy expands allowed hosts');
  if (!subset(child.allowedMethods, parent.allowedMethods)) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy expands allowed methods');
  if (parent.localRoot && (!child.localRoot || !localChild(child.localRoot, parent.localRoot))) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower local root must remain inside its parent');
  const parentRoots = policyRemoteRoots(parent);
  const childRoots = policyRemoteRoots(child);
  if (parentRoots.readRoot && (!childRoots.readRoot || !remoteChild(childRoots.readRoot, parentRoots.readRoot))) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower remote read root must remain inside its parent');
  if (parentRoots.projectRoot && (!childRoots.projectRoot || !remoteChild(childRoots.projectRoot, parentRoots.projectRoot))) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower remote project root must remain inside its parent');
  if (parentRoots.writeRoot && (!childRoots.writeRoot || !remoteChild(childRoots.writeRoot, parentRoots.writeRoot))) throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower remote write root must remain inside its parent');
  for (const key of Object.keys(parent.limits) as Array<keyof AgentPolicyDocument['limits']>) {
    if (child.limits[key] > parent.limits[key]) throw new AgentCoreError(409, 'POLICY_EXPANSION', `Lower policy expands ${key}`);
  }
  if (!subset(parent.protectedPaths, child.protectedPaths) || !subset(parent.humanGates, child.humanGates)) {
    throw new AgentCoreError(409, 'POLICY_EXPANSION', 'Lower policy removes a protection or human gate');
  }
  return {
    ...child,
    allowedOperations: intersect(parent.allowedOperations, child.allowedOperations),
    allowedHosts: intersect(parent.allowedHosts, child.allowedHosts),
    allowedMethods: intersect(parent.allowedMethods, child.allowedMethods),
    protectedPaths: [...new Set([...parent.protectedPaths, ...child.protectedPaths])].sort(),
    humanGates: [...new Set([...parent.humanGates, ...child.humanGates])].sort(),
  };
}

function policyRow(row: any): AgentPolicy {
  return { ...row, policy: JSON.parse(row.policy_json) };
}

export function effectivePolicy(projectId: string, taskId: string) {
  const rows = db.prepare(`SELECT * FROM agent_policies WHERE status = 'active' AND (
    (scope_type = 'system' AND scope_key = 'system') OR
    (scope_type = 'project' AND scope_id = ?) OR
    (scope_type = 'task' AND scope_id = ?)
  ) ORDER BY CASE scope_type WHEN 'system' THEN 0 WHEN 'project' THEN 1 ELSE 2 END`).all(projectId, taskId) as any[];
  let effective = SYSTEM_DEFAULT;
  const sources: AgentPolicy[] = [];
  for (const raw of rows) {
    const row = policyRow(raw);
    effective = row.scope_type === 'system'
      ? validatePolicy(row.policy)
      : tightenPolicy(effective, validatePolicy(row.policy));
    sources.push(row);
  }
  return { effective, sources };
}

export function createPolicy(scopeType: 'system' | 'project' | 'task', scopeId: string | null, input: unknown, activate: boolean) {
  const policy = validatePolicy(input);
  const scopeKey = scopeType === 'system' ? 'system' : scopeId;
  if (!scopeKey) throw new AgentCoreError(400, 'SCOPE_ID_REQUIRED', 'scope_id is required');
  if (scopeType === 'project' && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(scopeId)) throw new AgentCoreError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (scopeType === 'task' && !db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(scopeId)) throw new AgentCoreError(404, 'TASK_NOT_FOUND', 'Task not found');
  let parent = SYSTEM_DEFAULT;
  if (scopeType !== 'system') {
    const projectId = scopeType === 'task'
      ? (db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(scopeId) as any)?.project_id
      : null;
    const parentRows = scopeType === 'task'
      ? db.prepare(`SELECT * FROM agent_policies WHERE status = 'active' AND (scope_type = 'system' OR (scope_type = 'project' AND scope_id = ?)) ORDER BY CASE scope_type WHEN 'system' THEN 0 ELSE 1 END`).all(projectId) as any[]
      : db.prepare("SELECT * FROM agent_policies WHERE status = 'active' AND scope_type = 'system'").all() as any[];
    for (const row of parentRows) {
      const candidate = validatePolicy(JSON.parse(row.policy_json));
      parent = row.scope_type === 'system' ? candidate : tightenPolicy(parent, candidate);
    }
  }
  if (scopeType !== 'system') tightenPolicy(parent, policy);
  const version = ((db.prepare('SELECT MAX(version) AS version FROM agent_policies WHERE scope_type = ? AND scope_key = ?').get(scopeType, scopeKey) as any)?.version ?? 0) + 1;
  const id = newId('policy'); const ts = now();
  db.transaction(() => {
    if (activate) db.prepare("UPDATE agent_policies SET status = 'retired' WHERE scope_type = ? AND scope_key = ? AND status = 'active'").run(scopeType, scopeKey);
    db.prepare(`INSERT INTO agent_policies (id, scope_type, scope_id, scope_key, version, status, policy_json, sha256, created_at, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, scopeType, scopeId, scopeKey, version, activate ? 'active' : 'draft', stableJson(policy), hashJson(policy), ts, activate ? ts : null);
  })();
  return policyRow(db.prepare('SELECT * FROM agent_policies WHERE id = ?').get(id));
}

export function activatePolicy(id: string) {
  const row = db.prepare('SELECT * FROM agent_policies WHERE id = ?').get(id) as any;
  if (!row) throw new AgentCoreError(404, 'POLICY_NOT_FOUND', 'Policy not found');
  if (row.scope_type !== 'system') {
    let parent = SYSTEM_DEFAULT;
    const projectId = row.scope_type === 'task'
      ? (db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(row.scope_id) as any)?.project_id
      : row.scope_id;
    const parents = row.scope_type === 'task'
      ? db.prepare(`SELECT * FROM agent_policies WHERE status = 'active' AND (scope_type = 'system' OR (scope_type = 'project' AND scope_id = ?)) ORDER BY CASE scope_type WHEN 'system' THEN 0 ELSE 1 END`).all(projectId) as any[]
      : db.prepare("SELECT * FROM agent_policies WHERE status = 'active' AND scope_type = 'system'").all() as any[];
    for (const parentRow of parents) parent = parentRow.scope_type === 'system' ? validatePolicy(JSON.parse(parentRow.policy_json)) : tightenPolicy(parent, validatePolicy(JSON.parse(parentRow.policy_json)));
    tightenPolicy(parent, validatePolicy(JSON.parse(row.policy_json)));
  }
  db.transaction(() => {
    db.prepare("UPDATE agent_policies SET status = 'retired' WHERE scope_type = ? AND scope_key = ? AND status = 'active'").run(row.scope_type, row.scope_key);
    db.prepare("UPDATE agent_policies SET status = 'active', activated_at = ? WHERE id = ?").run(now(), id);
  })();
  return policyRow(db.prepare('SELECT * FROM agent_policies WHERE id = ?').get(id));
}

function serializeEvent(row: any): RunEvent { return { ...row, payload: JSON.parse(row.payload_json) }; }
function serializeReview(row: any): ReviewRequest {
  const review = {
    ...row,
    options: JSON.parse(row.options_json),
    recommendation: JSON.parse(row.recommendation_json),
    evidence: JSON.parse(row.evidence_json),
    proposal: row.proposal_json ? JSON.parse(row.proposal_json) : null,
  };
  if (row.decision_id) {
    review.decision = {
      id: row.decision_id,
      request_id: row.id,
      decision: row.decision_value,
      comment: row.decision_comment,
      actor: row.decision_actor,
      source: row.decision_source,
      conversation_ref: row.decision_conversation_ref,
      decision_sha256: row.decision_sha256,
      created_at: row.decision_created_at,
    };
  }
  return review;
}

export function appendEvent(runId: string, input: { category: RunEvent['category']; eventType: string; actorType: RunEvent['actor_type']; payload?: Record<string, unknown>; idempotencyKey?: string; contextVersionId?: string | null; source?: string; conversationRef?: string | null }) {
  if (!['fact', 'inference', 'decision', 'conclusion'].includes(input.category)) throw new AgentCoreError(400, 'EVENT_INVALID', 'Invalid event category');
  if (input.category === 'conclusion' && input.actorType !== 'researcher') throw new AgentCoreError(403, 'CONCLUSION_REQUIRES_RESEARCHER', 'Only a researcher can record a final conclusion');
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (input.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey);
    if (existing) return serializeEvent(existing);
  }
  const sequence = ((db.prepare('SELECT MAX(sequence) AS sequence FROM run_events WHERE run_id = ?').get(runId) as any)?.sequence ?? 0) + 1;
  const id = newId('event');
  db.prepare(`INSERT INTO run_events (id, run_id, context_version_id, sequence, category, event_type, actor_type, payload_json, idempotency_key, source, conversation_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, runId, input.contextVersionId === undefined ? run.current_context_version_id : input.contextVersionId, sequence, input.category, input.eventType, input.actorType, stableJson(input.payload ?? {}), input.idempotencyKey ?? null, input.source ?? 'workbench', input.conversationRef ?? null, now());
  return serializeEvent(db.prepare('SELECT * FROM run_events WHERE id = ?').get(id));
}

function createContextVersion(runId: string, snapshot: ReturnType<typeof readPlanAndContract>, workflow: WorkflowTemplate, policy: AgentPolicyDocument, reason: string) {
  const version = ((db.prepare('SELECT MAX(version) AS version FROM run_context_versions WHERE run_id = ?').get(runId) as any)?.version ?? 0) + 1;
  const id = newId('ctx'); const ts = now();
  db.prepare(`INSERT INTO run_context_versions (id, run_id, version, plan_content, plan_sha256, contract_content, contract_sha256, workflow_json, workflow_sha256, effective_policy_json, policy_sha256, adopted_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, runId, version, snapshot.planContent, snapshot.planHash, stringifyYaml(snapshot.contract), snapshot.contractHash, stableJson(workflow), hashJson(workflow), stableJson(policy), hashJson(policy), reason, ts);
  db.prepare('UPDATE research_runs SET current_context_version_id = ?, status = ?, updated_at = ? WHERE id = ?').run(id, 'active', ts, runId);
  return db.prepare('SELECT id, run_id, version, plan_sha256, contract_sha256, workflow_sha256, policy_sha256, adopted_reason, created_at FROM run_context_versions WHERE id = ?').get(id) as RunContextVersion;
}

export function startRun(taskId: string, researchPlanId: string, idempotencyKey?: string) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) throw new AgentCoreError(404, 'TASK_NOT_FOUND', 'Task not found');
  if (!task.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root must be resolved before starting a run');
  const plan = db.prepare('SELECT project_id FROM research_plans WHERE id = ?').get(researchPlanId) as any;
  if (!plan) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  if (plan.project_id !== task.project_id) throw new AgentCoreError(409, 'PLAN_PROJECT_MISMATCH', 'Research plan and task belong to different projects');
  const open = db.prepare("SELECT * FROM research_runs WHERE task_id = ? AND status IN ('active','waiting_review')").get(taskId) as any;
  if (open) return open as ResearchRun;
  const snapshot = readPlanAndContract(researchPlanId);
  const workflow = JSON.parse(task.workflow_snapshot) as WorkflowTemplate;
  const { effective } = effectivePolicy(task.project_id, taskId);
  const runId = newId('run'); const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO research_runs (id, task_id, research_plan_id, status, started_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`)
      .run(runId, taskId, researchPlanId, ts, ts);
    const context = createContextVersion(runId, snapshot, workflow, effective, 'initial approved context');
    appendEvent(runId, { category: 'decision', eventType: 'run.started', actorType: 'researcher', payload: { researchPlanId }, idempotencyKey, contextVersionId: context.id });
  })();
  return db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as ResearchRun;
}

export function terminateRun(runId: string, reason: string) {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  const ts = now();
  db.transaction(() => {
    db.prepare("UPDATE research_runs SET status = 'terminated', ended_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'run.terminated', actorType: 'researcher', payload: { reason } });
  })();
  return db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as ResearchRun;
}

export function adoptCurrentPolicy(runId: string, reason: string) {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(run.task_id) as any;
  const current = db.prepare('SELECT * FROM run_context_versions WHERE id = ?').get(run.current_context_version_id) as any;
  if (!current) throw new AgentCoreError(409, 'CONTEXT_REQUIRED', 'Run has no current context');
  const { effective } = effectivePolicy(task.project_id, task.id);
  const nextHash = hashJson(effective);
  if (current.policy_sha256 === nextHash) return db.prepare('SELECT id, run_id, version, plan_sha256, contract_sha256, workflow_sha256, policy_sha256, adopted_reason, created_at FROM run_context_versions WHERE id = ?').get(current.id) as RunContextVersion;
  const version = ((db.prepare('SELECT MAX(version) AS version FROM run_context_versions WHERE run_id = ?').get(runId) as any)?.version ?? 0) + 1;
  const id = newId('ctx'); const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO run_context_versions (id, run_id, version, plan_content, plan_sha256, contract_content, contract_sha256, workflow_json, workflow_sha256, effective_policy_json, policy_sha256, adopted_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, runId, version, current.plan_content, current.plan_sha256, current.contract_content, current.contract_sha256, current.workflow_json, current.workflow_sha256, stableJson(effective), nextHash, reason, ts);
    db.prepare('UPDATE research_runs SET current_context_version_id = ?, updated_at = ? WHERE id = ?').run(id, ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'policy.adopted', actorType: 'researcher', payload: { previousPolicySha256: current.policy_sha256, policySha256: nextHash, reason }, contextVersionId: id });
  })();
  return db.prepare('SELECT id, run_id, version, plan_sha256, contract_sha256, workflow_sha256, policy_sha256, adopted_reason, created_at FROM run_context_versions WHERE id = ?').get(id) as RunContextVersion;
}

function replaceFileAtomically(target: string, content: string): void {
  const temp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  try { fs.renameSync(temp, target); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function replaceResearchSources(planFile: string, contractFile: string, planContent: string, contractContent: string): () => void {
  const previousPlan = fs.readFileSync(planFile, 'utf8');
  const previousContract = fs.readFileSync(contractFile, 'utf8');
  const restore = () => {
    replaceFileAtomically(planFile, previousPlan);
    replaceFileAtomically(contractFile, previousContract);
  };
  try {
    replaceFileAtomically(planFile, planContent);
    replaceFileAtomically(contractFile, contractContent);
  } catch (error) {
    try { restore(); }
    catch (rollbackError) {
      throw new AgentCoreError(500, 'SOURCE_ROLLBACK_FAILED', 'Research sources could not be restored after a partial write', {
        writeError: (error as Error).message,
        rollbackError: (rollbackError as Error).message,
      });
    }
    throw error;
  }
  return restore;
}

export function reviseRun(runId: string, input: { planContent: string; contractContent: string; expectedContextVersionId: string; reason: string; idempotencyKey?: string }) {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (run.current_context_version_id !== input.expectedContextVersionId) throw new AgentCoreError(409, 'STALE_CONTEXT', 'Run context changed before revision was applied');
  if (input.idempotencyKey) {
    const review = db.prepare('SELECT * FROM review_requests WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey) as any;
    if (review) return { status: 'review_required', request: serializeReview(review) };
    const prior = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey) as any;
    if (prior) return { status: 'duplicate', event: serializeEvent(prior) };
  }
  const currentRow = db.prepare('SELECT * FROM run_context_versions WHERE id = ?').get(run.current_context_version_id) as any;
  const currentContract = parseContract(currentRow.contract_content);
  const nextContract = parseContract(input.contractContent);
  const nextPlanHash = sha256(input.planContent);
  if (nextContract.approvedPlan.sha256 !== nextPlanHash) throw new AgentCoreError(409, 'PLAN_CONTRACT_DRIFT', 'Candidate contract does not bind candidate plan');
  const planMeta = db.prepare(`SELECT rp.file_name, p.working_dir FROM research_plans rp JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?`).get(run.research_plan_id) as any;
  if (nextContract.approvedPlan.path !== planMeta.file_name) throw new AgentCoreError(409, 'PLAN_PATH_MISMATCH', 'Candidate contract must keep the research plan source path');
  const comparison = contractIsSameOrStricter(nextContract, currentContract);
  if (!comparison.ok) {
    const request = createReview(runId, {
      gateType: 'research_boundary_expansion',
      question: '候选研究方案扩大了当前科学边界或资源预算，是否批准？',
      options: ['approve', 'reject', 'supplement'],
      recommendation: { action: 'review_expansions', expansions: comparison.expansions },
      evidence: [{ currentContextVersionId: run.current_context_version_id }],
      proposal: { ...input, expansions: comparison.expansions },
      idempotencyKey: input.idempotencyKey,
    });
    return { status: 'review_required', request };
  }
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(run.task_id) as any;
  const planFile = resolveWithinRoot(planMeta.working_dir, planMeta.file_name, { mustExist: true, label: 'research plan' });
  const contractFile = contractPath(planMeta.working_dir, run.research_plan_id);
  if (sha256(fs.readFileSync(planFile, 'utf8')) !== currentRow.plan_sha256) throw new AgentCoreError(409, 'SOURCE_DRIFT', 'Research plan changed outside this run; refresh before revising');
  const rollbackSources = replaceResearchSources(planFile, contractFile, input.planContent, stringifyYaml(nextContract));
  let context!: RunContextVersion;
  try {
    const snapshot = readPlanAndContract(run.research_plan_id);
    const { effective } = effectivePolicy(task.project_id, task.id);
    db.transaction(() => {
      context = createContextVersion(runId, snapshot, JSON.parse(task.workflow_snapshot), effective, input.reason);
      appendEvent(runId, { category: 'decision', eventType: 'revision.auto_adopted', actorType: 'agent', payload: { reason: input.reason }, idempotencyKey: input.idempotencyKey, contextVersionId: context.id });
    })();
  } catch (error) {
    try { rollbackSources(); }
    catch (rollbackError) {
      throw new AgentCoreError(500, 'SOURCE_ROLLBACK_FAILED', 'Research sources changed but the context transaction failed and rollback was unsuccessful', {
        transactionError: (error as Error).message,
        rollbackError: (rollbackError as Error).message,
      });
    }
    throw error;
  }
  return { status: 'adopted', contextVersion: context };
}

export function createReview(runId: string, input: { gateType: string; question: string; options?: unknown[]; recommendation?: Record<string, unknown>; evidence?: unknown[]; proposal?: Record<string, unknown> | null; idempotencyKey?: string; source?: string; conversationRef?: string | null }) {
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (!run.current_context_version_id) throw new AgentCoreError(409, 'CONTEXT_REQUIRED', 'Run has no context version');
  if (input.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM review_requests WHERE run_id = ? AND idempotency_key = ?').get(runId, input.idempotencyKey);
    if (existing) return serializeReview(existing);
  }
  const id = newId('review'); const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO review_requests (id, run_id, context_version_id, status, gate_type, question, options_json, recommendation_json, evidence_json, proposal_json, idempotency_key, source, conversation_ref, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, runId, run.current_context_version_id, input.gateType, input.question, stableJson(input.options ?? []), stableJson(input.recommendation ?? {}), stableJson(input.evidence ?? []), input.proposal ? stableJson(input.proposal) : null, input.idempotencyKey ?? null, input.source ?? 'workbench', input.conversationRef ?? null, ts);
    db.prepare("UPDATE research_runs SET status = 'waiting_review', updated_at = ? WHERE id = ?").run(ts, runId);
    appendEvent(runId, { category: 'decision', eventType: 'review.requested', actorType: 'agent', payload: { requestId: id, gateType: input.gateType }, idempotencyKey: input.idempotencyKey, source: input.source, conversationRef: input.conversationRef });
  })();
  return serializeReview(db.prepare('SELECT * FROM review_requests WHERE id = ?').get(id));
}

export function decideReview(requestId: string, decision: 'approve' | 'reject' | 'supplement' | 'terminate', comment: string, metadata: { source?: string; conversationRef?: string | null } = {}) {
  if (metadata.source !== 'codex_conversation') {
    throw new AgentCoreError(400, 'DECISION_SOURCE_INVALID', 'Researcher review decisions must originate from an explicit Codex conversation decision');
  }
  const request = db.prepare('SELECT * FROM review_requests WHERE id = ?').get(requestId) as any;
  if (!request) throw new AgentCoreError(404, 'REVIEW_NOT_FOUND', 'Review request not found');
  if (request.status !== 'open') throw new AgentCoreError(409, 'REVIEW_ALREADY_DECIDED', 'Review request is no longer open');
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(request.run_id) as any;
  if (run.current_context_version_id !== request.context_version_id) throw new AgentCoreError(409, 'STALE_REVIEW', 'Review request belongs to an older context version');
  const id = newId('decision'); const ts = now();
  const source = 'codex_conversation';
  const conversationRef = metadata.conversationRef?.trim() || null;
  const decisionSha256 = sha256(stableJson({ requestId, decision, comment, source, conversationRef }));
  let approvedContext: RunContextVersion | null = null;
  let rollbackSources: (() => void) | null = null;
  let approvedSnapshot: ReturnType<typeof readPlanAndContract> | null = null;
  let approvedTask: any = null;
  let approvedReason = '';
  if (decision === 'approve' && request.gate_type === 'research_boundary_expansion' && request.proposal_json) {
    const proposal = JSON.parse(request.proposal_json) as { planContent: string; contractContent: string; reason: string };
    const nextContract = parseContract(proposal.contractContent);
    if (nextContract.approvedPlan.sha256 !== sha256(proposal.planContent)) throw new AgentCoreError(409, 'PLAN_CONTRACT_DRIFT', 'Approved proposal no longer has a matching plan and contract');
    const currentRow = db.prepare('SELECT * FROM run_context_versions WHERE id = ?').get(request.context_version_id) as any;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(run.task_id) as any;
    const planMeta = db.prepare(`SELECT rp.file_name, p.working_dir FROM research_plans rp JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?`).get(run.research_plan_id) as any;
    const planFile = resolveWithinRoot(planMeta.working_dir, planMeta.file_name, { mustExist: true, label: 'research plan' });
    if (sha256(fs.readFileSync(planFile, 'utf8')) !== currentRow.plan_sha256) throw new AgentCoreError(409, 'SOURCE_DRIFT', 'Research plan changed since the review request was created');
    const contractFile = contractPath(planMeta.working_dir, run.research_plan_id);
    if (nextContract.approvedPlan.path !== planMeta.file_name) throw new AgentCoreError(409, 'PLAN_PATH_MISMATCH', 'Approved contract must keep the research plan source path');
    rollbackSources = replaceResearchSources(planFile, contractFile, proposal.planContent, stringifyYaml(nextContract));
    try { approvedSnapshot = readPlanAndContract(run.research_plan_id); }
    catch (error) {
      try { rollbackSources(); rollbackSources = null; }
      catch (rollbackError) {
        throw new AgentCoreError(500, 'SOURCE_ROLLBACK_FAILED', 'Approved research sources could not be restored after validation failed', {
          validationError: (error as Error).message,
          rollbackError: (rollbackError as Error).message,
        });
      }
      throw error;
    }
    approvedTask = task;
    approvedReason = `researcher approved: ${proposal.reason}`;
  }
  try {
    db.transaction(() => {
      const freshRequest = db.prepare('SELECT status, context_version_id FROM review_requests WHERE id = ?').get(requestId) as any;
      const freshRun = db.prepare('SELECT current_context_version_id FROM research_runs WHERE id = ?').get(run.id) as any;
      if (freshRequest?.status !== 'open') throw new AgentCoreError(409, 'REVIEW_ALREADY_DECIDED', 'Review request is no longer open');
      if (freshRun?.current_context_version_id !== freshRequest.context_version_id) throw new AgentCoreError(409, 'STALE_REVIEW', 'Review request belongs to an older context version');
      if (approvedSnapshot && approvedTask) {
        approvedContext = createContextVersion(run.id, approvedSnapshot, JSON.parse(approvedTask.workflow_snapshot), effectivePolicy(approvedTask.project_id, approvedTask.id).effective, approvedReason);
      }
      db.prepare(`INSERT INTO review_decisions (id, request_id, decision, comment, actor, source, conversation_ref, decision_sha256, created_at) VALUES (?, ?, ?, ?, 'researcher', ?, ?, ?, ?)`)
        .run(id, requestId, decision, comment, source, conversationRef, decisionSha256, ts);
      db.prepare("UPDATE review_requests SET status = 'decided', decided_at = ? WHERE id = ?").run(ts, requestId);
      if (decision === 'terminate') db.prepare("UPDATE research_runs SET status = 'terminated', ended_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, run.id);
      else db.prepare("UPDATE research_runs SET status = 'active', updated_at = ? WHERE id = ?").run(ts, run.id);
      appendEvent(run.id, { category: 'decision', eventType: `review.${decision}`, actorType: 'researcher', payload: { requestId, comment, approvedContextVersionId: approvedContext?.id ?? null, decisionSha256 }, source, conversationRef });
    })();
  } catch (error) {
    if (rollbackSources) {
      try { rollbackSources(); }
      catch (rollbackError) {
        throw new AgentCoreError(500, 'SOURCE_ROLLBACK_FAILED', 'Review decision failed after source replacement and rollback was unsuccessful', {
          decisionError: (error as Error).message,
          rollbackError: (rollbackError as Error).message,
        });
      }
    }
    throw error;
  }
  return db.prepare('SELECT * FROM review_decisions WHERE id = ?').get(id);
}

function currentHashes(run: any) {
  try { const current = readPlanAndContract(run.research_plan_id); return { plan: current.planHash, contract: current.contractHash }; }
  catch { return { plan: null, contract: null }; }
}

export function buildAgentContext(taskId: string): AgentContextV1 {
  const row = db.prepare(`SELECT tasks.*, projects.name project_name, projects.description project_description, projects.material, projects.working_dir, projects.hpc_config, projects.status project_status, projects.created_at project_created_at, projects.updated_at project_updated_at FROM tasks JOIN projects ON projects.id = tasks.project_id WHERE tasks.id = ?`).get(taskId) as any;
  if (!row) throw new AgentCoreError(404, 'TASK_NOT_FOUND', 'Task not found');
  const run = db.prepare("SELECT * FROM research_runs WHERE task_id = ? AND status IN ('active','waiting_review') ORDER BY started_at DESC LIMIT 1").get(taskId) as any ?? null;
  const context = run?.current_context_version_id ? db.prepare('SELECT id, run_id, version, plan_sha256, contract_sha256, workflow_sha256, policy_sha256, adopted_reason, created_at FROM run_context_versions WHERE id = ?').get(run.current_context_version_id) as RunContextVersion : null;
  const blockers: AgentContextV1['blockers'] = [];
  let taskRootAbsolute: string | null = null;
  if (!row.task_root_rel) blockers.push({ code: 'TASK_ROOT_UNRESOLVED', message: 'Task root has not been resolved' });
  else try { taskRootAbsolute = resolveWithinRoot(row.working_dir, normalizeTaskRootRel(row.task_root_rel), { allowRoot: false, label: 'task root' }); }
    catch (error) { blockers.push({ code: 'TASK_ROOT_INVALID', message: (error as Error).message }); }
  try {
    const hpcConfig = row.hpc_config ? JSON.parse(row.hpc_config) as { profiles?: unknown[]; taskBindings?: Array<{ taskId?: string }> } : null;
    if (!hpcConfig?.profiles?.length) blockers.push({ code: 'HPC_CONNECTION_NOT_REGISTERED', message: 'Project has no registered HPC connection metadata' });
    else if (!hpcConfig.taskBindings?.some(binding => binding.taskId === taskId)) blockers.push({ code: 'REMOTE_TASK_BINDING_REQUIRED', message: 'Task has no registered remote directory binding' });
  } catch {
    blockers.push({ code: 'HPC_CONFIG_INVALID', message: 'Project HPC connection metadata is invalid' });
  }
  if (!run) blockers.push({ code: 'RUN_NOT_STARTED', message: 'No active research run exists for this task' });
  const hashes = run ? currentHashes(run) : { plan: null, contract: null };
  if (run && (!hashes.plan || !hashes.contract)) blockers.push({ code: 'CONTRACT_INVALID_OR_MISSING', message: 'Current research plan contract cannot be validated' });
  if (context && (hashes.plan !== context.plan_sha256 || hashes.contract !== context.contract_sha256)) blockers.push({ code: 'SOURCE_DRIFT', message: 'Plan or contract differs from the adopted run context' });
  if (context && row.workflow_snapshot) {
    try {
      if (hashJson(JSON.parse(row.workflow_snapshot)) !== context.workflow_sha256) blockers.push({ code: 'WORKFLOW_CONTEXT_DRIFT', message: 'Task workflow differs from the workflow adopted by this run' });
    } catch {
      blockers.push({ code: 'WORKFLOW_SNAPSHOT_INVALID', message: 'Task workflow snapshot is invalid' });
    }
  }
  const policy = effectivePolicy(row.project_id, taskId);
  if (context && context.policy_sha256 !== hashJson(policy.effective)) blockers.push({ code: 'POLICY_CONTEXT_DRIFT', message: 'Active policy differs from the policy adopted by this run; adopt it before remote actions' });
  if (!policy.effective.remoteEnabled) blockers.push({ code: 'REMOTE_DISABLED_BY_POLICY', message: 'Effective policy does not allow remote actions' });
  const pending = run ? (db.prepare("SELECT * FROM review_requests WHERE run_id = ? AND status = 'open' ORDER BY created_at").all(run.id) as any[]).map(serializeReview) : [];
  const actions = run ? (db.prepare('SELECT * FROM run_actions WHERE run_id = ? ORDER BY created_at DESC LIMIT 50').all(run.id) as any[]).map(({ manifest_json, result_json, error_json, ...action }) => ({
    ...action,
    manifest: JSON.parse(manifest_json),
    result: JSON.parse(result_json),
    error: JSON.parse(error_json),
  })) : [];
  const jobs = run ? db.prepare('SELECT * FROM remote_jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 20').all(run.id).map((job: any) => ({
    ...job,
    execution_manifest: JSON.parse(job.execution_manifest_json),
    resources: JSON.parse(job.resources_json),
    last_observation: JSON.parse(job.last_observation_json),
  })) as any : [];
  const artifacts = run ? (db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at DESC LIMIT 50').all(run.id) as any[]).map(({ metadata_json, ...artifact }) => ({
    ...artifact,
    metadata: JSON.parse(metadata_json),
  })) : [];
  const evidenceChecks = run ? (db.prepare('SELECT * FROM evidence_checks WHERE run_id = ? ORDER BY created_at DESC LIMIT 50').all(run.id) as any[]).map(({ result_json, ...check }) => ({
    ...check,
    result: JSON.parse(result_json),
  })) : [];
  const eventCursor = run ? ((db.prepare('SELECT MAX(sequence) AS sequence FROM run_events WHERE run_id = ?').get(run.id) as any)?.sequence ?? 0) : 0;
  const evidence = run ? (db.prepare("SELECT id, event_type, occurred_at FROM run_events WHERE run_id = ? AND category = 'fact' ORDER BY sequence DESC LIMIT 20").all(run.id) as any[]).map(item => ({ eventId: item.id, eventType: item.event_type, occurredAt: item.occurred_at })) : [];
  const capabilityEvent = run ? db.prepare("SELECT payload_json FROM run_events WHERE run_id = ? AND event_type = 'remote.capability_inspected' ORDER BY sequence DESC LIMIT 1").get(run.id) as any : null;
  const workflow = row.workflow_snapshot ? JSON.parse(row.workflow_snapshot) : null;
  const project = { id: row.project_id, name: row.project_name, description: row.project_description, material: row.material, working_dir: row.working_dir, hpc_config: row.hpc_config, status: row.project_status, created_at: row.project_created_at, updated_at: row.project_updated_at };
  const task = { id: row.id, project_id: row.project_id, name: row.name, description: row.description, workflow_id: row.workflow_id, workflow, task_root_rel: row.task_root_rel, task_root_unresolved: !row.task_root_rel, status: row.status, created_at: row.created_at, updated_at: row.updated_at } as Task;
  return {
    schemaVersion: 1, project, task, taskRoot: { relative: row.task_root_rel, absolute: taskRootAbsolute, resolved: Boolean(taskRootAbsolute) },
    run, contextVersion: context,
    research: { planId: run?.research_plan_id ?? null, currentPlanSha256: hashes.plan, adoptedPlanSha256: context?.plan_sha256 ?? null, currentContractSha256: hashes.contract, adoptedContractSha256: context?.contract_sha256 ?? null, drift: Boolean(context && (hashes.plan !== context.plan_sha256 || hashes.contract !== context.contract_sha256)) },
    workflow, effectivePolicy: policy.effective, policySources: policy.sources.map(item => ({ id: item.id, scope_type: item.scope_type, version: item.version, sha256: item.sha256 })),
    remoteCapability: capabilityEvent ? JSON.parse(capabilityEvent.payload_json) : null,
    recentActions: actions,
    recentJobs: jobs,
    recentArtifacts: artifacts,
    recentEvidenceChecks: evidenceChecks,
    pendingReviews: pending,
    eventCursor,
    evidenceIndex: evidence,
    blockers,
  };
}

export function listEvents(runId: string, after = 0, limit = 100) {
  return (db.prepare('SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?').all(runId, after, Math.min(Math.max(limit, 1), 500)) as any[]).map(serializeEvent);
}

export function listReviews(filters: { runId?: string; projectId?: string; taskId?: string; status?: string } = {}) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.runId) { conditions.push('rr.run_id = ?'); params.push(filters.runId); }
  if (filters.projectId) { conditions.push('t.project_id = ?'); params.push(filters.projectId); }
  if (filters.taskId) { conditions.push('r.task_id = ?'); params.push(filters.taskId); }
  if (filters.status) {
    if (!['open', 'decided', 'superseded'].includes(filters.status)) throw new AgentCoreError(400, 'REVIEW_STATUS_INVALID', 'status must be open, decided or superseded');
    conditions.push('rr.status = ?'); params.push(filters.status);
  }
  const rows = db.prepare(`
    SELECT rr.*, r.task_id, r.status AS run_status,
           t.project_id, t.name AS task_name, p.name AS project_name,
           rd.id AS decision_id, rd.decision AS decision_value,
           rd.comment AS decision_comment, rd.actor AS decision_actor,
           rd.source AS decision_source, rd.conversation_ref AS decision_conversation_ref,
           rd.decision_sha256, rd.created_at AS decision_created_at
    FROM review_requests rr
    JOIN research_runs r ON r.id = rr.run_id
    JOIN tasks t ON t.id = r.task_id
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN review_decisions rd ON rd.request_id = rr.id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY CASE rr.status WHEN 'open' THEN 0 ELSE 1 END, rr.created_at DESC
  `).all(...params);
  return (rows as any[]).map(serializeReview);
}
