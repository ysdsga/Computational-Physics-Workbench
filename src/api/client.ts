import type { Project, Task, StepProgress, StepFile, Experience, FileEntry, WorkflowTemplate, ResearchPlan, ResearchPlanStatus, AgentContext, PendingItem, RunEvent, RunAction, RunArtifact, EvidenceCheck, EvidenceLibraryItem, RemoteJob, ResearchRun, TaskSpec, WorkingPlan, ConfirmedEnvelope } from '../types';

const BASE = '/api';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `HTTP ${res.status}`) as Error & { code?: string; status?: number; details?: object };
    error.code = err.code;
    error.status = res.status;
    error.details = err.details;
    throw error;
  }
  return res.json();
}

// === Projects ===
export const projectsApi = {
  list: () => api<Project[]>('/projects'),
  get: (id: string) => api<Project>(`/projects/${id}`),
  create: (data: Partial<Project>) => api<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Project>) => api<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => api<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
};

// === Tasks ===
export const tasksApi = {
  list: (projectId: string) => api<Task[]>(`/projects/${projectId}/tasks`),
  get: (id: string) => api<Task>(`/tasks/${id}`),
  create: (projectId: string, data: Partial<Task>) => api<Task>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Task>) => api<Task>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateWorkflow: (id: string, workflow: WorkflowTemplate) =>
    api<WorkflowTemplate>(`/tasks/${id}/workflow`, { method: 'PUT', body: JSON.stringify(workflow) }),
  resolveRoot: (id: string, taskRootRel: string, create = false) =>
    api<Task>(`/tasks/${id}/root`, { method: 'PUT', body: JSON.stringify({ task_root_rel: taskRootRel, create }) }),
  delete: (id: string) => api<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

// === Step Progress ===
export const progressApi = {
  list: (taskId: string) => api<StepProgress[]>(`/tasks/${taskId}/progress`),
  upsert: (taskId: string, stepId: string, data: { status?: string; notes?: string; commands?: string[]; lsf_script?: string }) =>
    api<StepProgress>(`/tasks/${taskId}/progress/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// === Step Files ===
export const stepFilesApi = {
  list: (taskId: string, stepId: string) => api<StepFile[]>(`/tasks/${taskId}/progress/${stepId}/files`),
  add: (taskId: string, stepId: string, data: { file_path: string; file_name: string; description?: string }) =>
    api<StepFile>(`/tasks/${taskId}/progress/${stepId}/files`, { method: 'POST', body: JSON.stringify(data) }),
  remove: (fileId: string) => api<{ success: boolean }>(`/step-files/${fileId}`, { method: 'DELETE' }),
};

// === Files (File Repository) ===
export const filesApi = {
  browse: (projectId: string, subPath?: string) =>
    api<{ entries: FileEntry[]; currentPath: string; exists: boolean }>(`/projects/${projectId}/files${subPath ? `?path=${encodeURIComponent(subPath)}` : ''}`),
  mkdir: (projectId: string, subPath: string, name: string) =>
    api<{ success: boolean; path: string }>(`/projects/${projectId}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: subPath, name }) }),
  read: (projectId: string, filePath: string) =>
    api<{ content: string; name: string; size: number }>(`/projects/${projectId}/files/read?path=${encodeURIComponent(filePath)}`),
};

// === Experiences ===
export const experiencesApi = {
  list: (params?: { projectId?: string; taskId?: string; status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.taskId) qs.set('taskId', params.taskId);
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return api<Experience[]>(`/experiences${q ? `?${q}` : ''}`);
  },
  create: (data: { title: string; content: string; tags?: string[]; related_project_id?: string; related_task_id?: string; related_step_id?: string; category?: string; status?: string; applicable_scope?: string; source_run_id?: string; source_artifact_ids?: string[]; source_kind?: string }) =>
    api<Experience>('/experiences', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ title: string; content: string; tags: string[]; related_project_id: string; related_task_id: string; related_step_id: string }>) =>
    api<Experience>(`/experiences/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => api<{ success: boolean }>(`/experiences/${id}`, { method: 'DELETE' }),
};

// === Workflows ===
export const workflowsApi = {
  list: () => api<{ id: string; name: string; description: string }[]>('/workflows'),
  listFull: () => api<WorkflowTemplate[]>('/workflows/all/full'),
  getFull: (id: string) => api<WorkflowTemplate>(`/workflows/${id}`),
  save: (id: string, data: { name?: string; description?: string; stages: WorkflowTemplate['stages']; steps: WorkflowTemplate['steps'] }) =>
    api<WorkflowTemplate>(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  reset: (id: string) => api<WorkflowTemplate>(`/workflows/${id}/reset`, { method: 'POST' }),
};

// === Research Plans ===
export interface ResearchPlanInput {
  title?: string;
  content?: string;
  linked_task_ids?: string[];
  status?: ResearchPlanStatus;
  tags?: string[];
}

export interface ResearchPlanCreateInput extends ResearchPlanInput {
  title: string;
  project_id: string;
}

export interface ResearchPlanImportInput {
  sourcePath?: string;
  fileName?: string;
  content?: string;
  project_id: string;
}

export const researchPlansApi = {
  list: (params?: { projectId?: string; taskId?: string; status?: ResearchPlanStatus; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.taskId) qs.set('taskId', params.taskId);
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return api<ResearchPlan[]>(`/research-plans${q ? `?${q}` : ''}`);
  },
  get: (id: string) => api<ResearchPlan>(`/research-plans/${id}`),
  getContent: (id: string) =>
    api<{ content: string; size: number; modified: string; sha256: string }>(`/research-plans/${id}/content`),
  saveContent: (id: string, content: string, expectedSha256?: string) =>
    api<{ success: boolean; updated_at: string; sha256: string }>(`/research-plans/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content, expectedSha256 }),
    }),
  create: (data: ResearchPlanCreateInput) =>
    api<ResearchPlan>('/research-plans', { method: 'POST', body: JSON.stringify(data) }),
  import: (data: ResearchPlanImportInput) =>
    api<ResearchPlan>('/research-plans/import', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ResearchPlanInput>) =>
    api<ResearchPlan>(`/research-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string, opts?: { deleteFile?: boolean }) =>
    api<{ success: boolean }>(
      `/research-plans/${id}${opts?.deleteFile === false ? '?deleteFile=false' : ''}`,
      { method: 'DELETE' },
    ),
};

export const agentApi = {
  context: (taskId: string) => api<AgentContext>(`/agent/v1/context/tasks/${taskId}`),
  run: (runId: string) => api<ResearchRun>(`/agent/v1/runs/${runId}`),
  createRun: (data: { taskId: string; researchPlanId: string; taskSpec: TaskSpec; idempotencyKey: string }) =>
    api<ResearchRun>('/agent/v1/runs', { method: 'POST', body: JSON.stringify(data) }),
  confirmRun: (runId: string, summary: string, conversationRef?: string) =>
    api<ResearchRun>(`/agent/v1/runs/${runId}/confirm`, { method: 'POST', body: JSON.stringify({ summary, source: 'codex_conversation', conversationRef }) }),
  updateWorkingPlan: (runId: string, workingPlan: WorkingPlan, reason: string, idempotencyKey: string) =>
    api<ResearchRun>(`/agent/v1/runs/${runId}/working-plan`, { method: 'PUT', body: JSON.stringify({ workingPlan, reason, idempotencyKey }) }),
  reviseEnvelope: (runId: string, confirmedEnvelope: ConfirmedEnvelope, pendingItemId: string, summary: string, conversationRef?: string) =>
    api<ResearchRun>(`/agent/v1/runs/${runId}/envelope-revisions`, { method: 'POST', body: JSON.stringify({ confirmedEnvelope, pendingItemId, summary, source: 'codex_conversation', conversationRef }) }),
  events: (runId: string, after = 0) => api<RunEvent[]>(`/agent/v1/runs/${runId}/events?after=${after}`),
  actions: (runId: string) => api<RunAction[]>(`/agent/v1/runs/${runId}/actions`),
  action: (actionId: string) => api<RunAction & { artifacts: RunArtifact[]; evidenceChecks: EvidenceCheck[]; remoteJob: RemoteJob | null }>(`/agent/v1/actions/${actionId}`),
  artifacts: (runId: string) => api<RunArtifact[]>(`/agent/v1/runs/${runId}/artifacts`),
  evidenceChecks: (runId: string) => api<EvidenceCheck[]>(`/agent/v1/runs/${runId}/evidence-checks`),
  pendingItems: (filters?: { runId?: string; projectId?: string; taskId?: string; audience?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (filters?.runId) qs.set('runId', filters.runId);
    if (filters?.projectId) qs.set('projectId', filters.projectId);
    if (filters?.taskId) qs.set('taskId', filters.taskId);
    if (filters?.audience) qs.set('audience', filters.audience);
    if (filters?.status) qs.set('status', filters.status);
    return api<PendingItem[]>(`/agent/v1/pending-items${qs.size ? `?${qs}` : ''}`);
  },
  evidenceLibrary: (filters?: { projectId?: string; taskId?: string; location?: string; checkStatus?: string; validity?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (filters?.projectId) qs.set('projectId', filters.projectId);
    if (filters?.taskId) qs.set('taskId', filters.taskId);
    if (filters?.location) qs.set('location', filters.location);
    if (filters?.checkStatus) qs.set('checkStatus', filters.checkStatus);
    if (filters?.validity) qs.set('validity', filters.validity);
    if (filters?.search) qs.set('search', filters.search);
    return api<EvidenceLibraryItem[]>(`/agent/v1/evidence-library${qs.size ? `?${qs}` : ''}`);
  },
};
