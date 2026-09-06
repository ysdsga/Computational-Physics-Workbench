import type { HpcConfig, HpcProfile, HpcTaskBinding } from '../../src/types/index.js';
import { AgentCoreError, normalizeRemoteRoot } from './agentCore.js';

const SAFE_ID = /^[A-Za-z0-9._-]{1,160}$/;
const SAFE_HOST = /^[A-Za-z0-9._-]+$/;
const SUPPORTED_SCHEDULER = 'LSF';

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentCoreError(400, 'HPC_CONFIG_INVALID', `${label} is required`);
  }
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTaskRootRel(value: unknown): string {
  const relative = requiredText(value, 'taskBindings[].taskRootRel').replace(/\\/g, '/').replace(/\/+$/, '');
  if (
    relative.startsWith('/')
    || relative.includes('/')
    || relative === '.'
    || relative === '..'
    || relative.includes('\0')
    || relative.includes('\r')
    || relative.includes('\n')
  ) {
    throw new AgentCoreError(400, 'HPC_TASK_ROOT_INVALID', 'Remote Task root must be one safe directory name directly below the project root');
  }
  return relative;
}

export function isRemotePathWithin(child: string, parent: string): boolean {
  const normalizedChild = normalizeRemoteRoot(child);
  const normalizedParent = normalizeRemoteRoot(parent);
  return normalizedChild === normalizedParent
    || (normalizedParent === '/' ? normalizedChild.startsWith('/') : normalizedChild.startsWith(`${normalizedParent}/`));
}

export function joinRemoteRoot(parent: string, relative: string): string {
  return normalizeRemoteRoot(`${normalizeRemoteRoot(parent).replace(/\/$/, '')}/${normalizeTaskRootRel(relative)}`);
}

function normalizeProfile(value: unknown): HpcProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCoreError(400, 'HPC_CONFIG_INVALID', 'profiles[] must be an object');
  }
  const input = value as Record<string, unknown>;
  const id = requiredText(input.id, 'profiles[].id');
  if (!SAFE_ID.test(id)) throw new AgentCoreError(400, 'HPC_PROFILE_ID_INVALID', 'HPC profile id contains unsupported characters');
  const sshAlias = requiredText(input.sshAlias, 'profiles[].sshAlias');
  if (!SAFE_HOST.test(sshAlias)) throw new AgentCoreError(400, 'HPC_SSH_ALIAS_INVALID', 'OpenSSH alias must contain only letters, digits, dot, underscore or hyphen');
  const scheduler = (optionalText(input.scheduler) || SUPPORTED_SCHEDULER).toUpperCase();
  if (scheduler !== SUPPORTED_SCHEDULER) {
    throw new AgentCoreError(400, 'HPC_SCHEDULER_UNSUPPORTED', 'This research preview supports IBM LSF only; Slurm and PBS adapters are not implemented yet');
  }

  const rawUserRoot = optionalText(input.userRoot);
  const rawProjectRoot = optionalText(input.projectRoot);
  const rawLegacyRoot = optionalText(input.remoteRoot);
  if ((rawUserRoot && !rawProjectRoot) || (!rawUserRoot && rawProjectRoot)) {
    throw new AgentCoreError(400, 'HPC_DIRECTORY_BOUNDARY_INCOMPLETE', 'userRoot and projectRoot must be configured together');
  }
  if (!rawUserRoot && !rawLegacyRoot) {
    throw new AgentCoreError(400, 'HPC_DIRECTORY_BOUNDARY_REQUIRED', 'A user/project directory boundary is required');
  }

  const profile: HpcProfile = {
    id,
    name: requiredText(input.name, 'profiles[].name'),
    sshAlias,
    scheduler,
    notes: optionalText(input.notes),
  };
  if (rawUserRoot && rawProjectRoot) {
    const userRoot = normalizeRemoteRoot(rawUserRoot);
    const projectRoot = normalizeRemoteRoot(rawProjectRoot);
    if (projectRoot === userRoot || !isRemotePathWithin(projectRoot, userRoot)) {
      throw new AgentCoreError(400, 'HPC_PROJECT_ROOT_OUTSIDE_USER_ROOT', 'projectRoot must be a child of userRoot');
    }
    profile.userRoot = userRoot;
    profile.projectRoot = projectRoot;
  } else {
    profile.remoteRoot = normalizeRemoteRoot(rawLegacyRoot);
  }
  return profile;
}

function normalizeBinding(value: unknown): HpcTaskBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentCoreError(400, 'HPC_CONFIG_INVALID', 'taskBindings[] must be an object');
  }
  const input = value as Record<string, unknown>;
  const taskId = requiredText(input.taskId, 'taskBindings[].taskId');
  const profileId = requiredText(input.profileId, 'taskBindings[].profileId');
  if (!SAFE_ID.test(taskId) || !SAFE_ID.test(profileId)) {
    throw new AgentCoreError(400, 'HPC_TASK_BINDING_ID_INVALID', 'Task and profile ids contain unsupported characters');
  }
  return { taskId, profileId, taskRootRel: normalizeTaskRootRel(input.taskRootRel) };
}

export function normalizeHpcConfig(input: unknown, allowedTaskIds?: Set<string>): HpcConfig {
  if (input === null || input === undefined || input === '') return { schemaVersion: 2, profiles: [], taskBindings: [] };
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch { throw new AgentCoreError(400, 'HPC_CONFIG_INVALID_JSON', 'hpc_config must be valid JSON'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentCoreError(400, 'HPC_CONFIG_INVALID', 'hpc_config must be an object');
  }
  const raw = parsed as Record<string, unknown>;
  let profileInputs = Array.isArray(raw.profiles) ? raw.profiles : [];
  if (profileInputs.length === 0 && (optionalText(raw.host) || optionalText(raw.remotePath))) {
    const host = optionalText(raw.host);
    profileInputs = [{
      id: 'legacy-default',
      name: '原有配置',
      sshAlias: host,
      remoteRoot: raw.remotePath,
      scheduler: 'LSF',
      notes: `${optionalText(raw.user) ? `原用户名：${optionalText(raw.user)}。` : ''}旧版单根目录配置；需要登记用户根和项目根后才能用于新的远程任务。`,
    }];
  }
  const profiles = profileInputs.map(normalizeProfile);
  const profileIds = new Set<string>();
  const aliases = new Set<string>();
  for (const profile of profiles) {
    if (profileIds.has(profile.id)) throw new AgentCoreError(400, 'HPC_PROFILE_DUPLICATE', `Duplicate HPC profile id: ${profile.id}`);
    if (aliases.has(profile.sshAlias)) throw new AgentCoreError(400, 'HPC_SSH_ALIAS_DUPLICATE', `Duplicate OpenSSH alias: ${profile.sshAlias}`);
    profileIds.add(profile.id);
    aliases.add(profile.sshAlias);
  }

  const bindings = (Array.isArray(raw.taskBindings) ? raw.taskBindings : []).map(normalizeBinding);
  const bindingKeys = new Set<string>();
  const roots = new Set<string>();
  for (const binding of bindings) {
    if (allowedTaskIds && !allowedTaskIds.has(binding.taskId)) {
      throw new AgentCoreError(400, 'HPC_TASK_BINDING_PROJECT_MISMATCH', `Task ${binding.taskId} does not belong to this project`);
    }
    const profile = profiles.find(item => item.id === binding.profileId);
    if (!profile) throw new AgentCoreError(400, 'HPC_TASK_BINDING_PROFILE_MISSING', `Unknown HPC profile: ${binding.profileId}`);
    if (!profile.userRoot || !profile.projectRoot) {
      throw new AgentCoreError(400, 'HPC_TASK_BINDING_LEGACY_PROFILE', 'Task bindings require a profile with separate userRoot and projectRoot');
    }
    const key = `${binding.profileId}\0${binding.taskId}`;
    if (bindingKeys.has(key)) throw new AgentCoreError(400, 'HPC_TASK_BINDING_DUPLICATE', 'A Task may have only one directory binding per HPC profile');
    bindingKeys.add(key);
    const rootKey = `${binding.profileId}\0${joinRemoteRoot(profile.projectRoot, binding.taskRootRel).toLocaleLowerCase()}`;
    if (roots.has(rootKey)) throw new AgentCoreError(400, 'HPC_TASK_ROOT_CONFLICT', 'Two Tasks cannot share the same remote write root');
    roots.add(rootKey);
  }

  const defaultProfileId = optionalText(raw.defaultProfileId) || profiles[0]?.id;
  if (defaultProfileId && !profileIds.has(defaultProfileId)) {
    throw new AgentCoreError(400, 'HPC_DEFAULT_PROFILE_MISSING', 'defaultProfileId does not reference an existing profile');
  }
  return {
    schemaVersion: 2,
    profiles,
    ...(defaultProfileId ? { defaultProfileId } : {}),
    taskBindings: bindings,
  };
}

export interface ResolvedRemoteTaskBinding {
  profileId: string;
  profileName: string;
  host: string;
  scheduler: string;
  userReadRoot: string;
  projectRoot: string;
  taskRootRel: string;
  taskWriteRoot: string;
}

export function resolveRemoteTaskBinding(configInput: unknown, taskId: string, host: string): ResolvedRemoteTaskBinding {
  const config = normalizeHpcConfig(configInput);
  const profile = config.profiles?.find(item => item.sshAlias === host);
  if (!profile) throw new AgentCoreError(403, 'HPC_PROFILE_NOT_REGISTERED', 'This OpenSSH alias is not registered for the project');
  if (!profile.userRoot || !profile.projectRoot) {
    throw new AgentCoreError(409, 'HPC_PROFILE_BOUNDARY_INCOMPLETE', 'The HPC profile must register separate user and project roots');
  }
  const binding = config.taskBindings?.find(item => item.taskId === taskId && item.profileId === profile.id);
  if (!binding) throw new AgentCoreError(409, 'REMOTE_TASK_BINDING_REQUIRED', 'The Task has no remote directory binding for this HPC profile');
  return {
    profileId: profile.id,
    profileName: profile.name,
    host: profile.sshAlias,
    scheduler: profile.scheduler,
    userReadRoot: profile.userRoot,
    projectRoot: profile.projectRoot,
    taskRootRel: binding.taskRootRel,
    taskWriteRoot: joinRemoteRoot(profile.projectRoot, binding.taskRootRel),
  };
}
