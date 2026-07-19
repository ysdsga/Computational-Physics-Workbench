import type { Project, Task, StepProgress, StepFile, Experience, FileEntry, WorkflowTemplate, TaskSpec, ExecutionEvidence } from '../types';

const BASE = '/api';

function reportApiError(message: string) {
  window.dispatchEvent(new CustomEvent('workbench:api-error', { detail: { message } }));
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (error) {
    const message = `无法连接工作台服务：${(error as Error).message}`;
    reportApiError(message);
    throw new Error(message);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message = err.error || `HTTP ${res.status}`;
    reportApiError(message);
    throw new Error(message);
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
  delete: (id: string) => api<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

// === Step Progress ===
export const progressApi = {
  list: (taskId: string) => api<StepProgress[]>(`/tasks/${taskId}/progress`),
  upsert: (taskId: string, stepId: string, data: { status?: string; notes?: string; commands?: string[]; lsf_script?: string }) =>
    api<StepProgress>(`/tasks/${taskId}/progress/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// === Task Specs and execution audit ===
export const taskSpecsApi = {
  list: (taskId: string) => api<TaskSpec[]>(`/tasks/${taskId}/task-specs`),
  create: (taskId: string, data: {
    step_id: string;
    title: string;
    command: string;
    execution_payload?: string;
    remote_workdir?: string;
    dependencies?: string[];
    step_dependencies?: string[];
    input_files?: string[];
    expected_outputs?: string[];
    preconditions?: string[];
    scientific_checks?: string[];
    success_criteria?: string[];
    approval_points?: string[];
    failure_handling?: string[];
    failure_policy?: 'stop' | 'manual-review';
    timeout_seconds?: number;
  }) => api<TaskSpec>(`/tasks/${taskId}/task-specs`, { method: 'POST', body: JSON.stringify(data) }),
  update: (specId: string, data: Partial<{
    title: string;
    command: string;
    execution_payload: string;
    remote_workdir: string;
    dependencies: string[];
    step_dependencies: string[];
    input_files: string[];
    expected_outputs: string[];
    preconditions: string[];
    scientific_checks: string[];
    success_criteria: string[];
    approval_points: string[];
    failure_handling: string[];
    failure_policy: 'stop' | 'manual-review';
    timeout_seconds: number;
  }>) => api<TaskSpec>(`/task-specs/${specId}`, { method: 'PUT', body: JSON.stringify(data) }),
  check: (specId: string) => api<TaskSpec>(`/task-specs/${specId}/check`, { method: 'POST', body: '{}' }),
  approve: (specId: string, decision: 'approved' | 'rejected', note?: string) =>
    api<TaskSpec>(`/task-specs/${specId}/approvals`, {
      method: 'POST',
      body: JSON.stringify({ decision, actor: 'user', note }),
    }),
  startRun: (specId: string) => api<TaskSpec>(`/task-specs/${specId}/runs`, { method: 'POST', body: '{}' }),
  finishRun: (runId: string, data: {
    status: 'completed' | 'failed' | 'unknown';
    exit_code?: number | null;
    output_summary?: string;
    evidence?: ExecutionEvidence[];
    error_message?: string;
    scheduler_job?: { scheduler: 'lsf'; job_id: string };
  }) => api<TaskSpec>(`/task-specs/runs/${runId}`, { method: 'PUT', body: JSON.stringify(data) }),
  verify: (specId: string, data: {
    decision: 'completed' | 'failed' | 'blocked';
    note?: string;
    evidence?: ExecutionEvidence[];
  }) => api<TaskSpec>(`/task-specs/${specId}/verify`, { method: 'POST', body: JSON.stringify(data) }),
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
  list: (params?: { projectId?: string; taskId?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.taskId) qs.set('taskId', params.taskId);
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return api<Experience[]>(`/experiences${q ? `?${q}` : ''}`);
  },
  create: (data: { title: string; content: string; tags?: string[]; related_project_id?: string; related_task_id?: string; related_step_id?: string; source_task_spec_id?: string }) =>
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
