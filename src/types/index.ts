// === Core Types for DFT+DMFT Workbench ===

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface WorkflowStage {
  id: string;
  name: string;
  color: string;
  colorBg: string;
  colorBorder: string;
  description: string;
}

export interface WorkflowStep {
  id: string;
  stageId: string;
  order: number;
  name: string;
  description: string;
  commands?: string[];
  lsfScript?: string; // default LSF submission script template
  inputFiles?: string[];
  outputFiles?: string[];
  tips?: string;
  optional?: boolean;
  substeps?: WorkflowSubStep[];
}

export interface WorkflowSubStep {
  id: string;
  name: string;
  description: string;
  commands?: string[];
  files?: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
  steps: WorkflowStep[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  material: string;
  working_dir: string;
  hpc_config?: string; // JSON string of HpcConfig
  status?: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  task_count?: number;
}

export interface Task {
  id: string;
  project_id: string;
  name: string;
  description: string;
  workflow_id: string;
  workflow: WorkflowTemplate;
  task_root_rel: string | null;
  task_root_unresolved?: boolean;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  progress?: StepProgress[];
}

export interface StepFile {
  id: string;
  step_progress_id: string;
  file_path: string;
  file_name: string;
  description: string;
  is_remote?: number; // deprecated, kept for backward compat
  created_at: string;
}

export interface StepProgress {
  id: string;
  task_id: string;
  step_id: string;
  status: StepStatus;
  notes: string;
  commands?: string[]; // user-edited commands (overrides template)
  lsf_script?: string; // user-edited LSF script (overrides template)
  updated_at: string;
  files?: StepFile[];
}

export interface Experience {
  id: string;
  title: string;
  content: string;
  tags: string; // JSON array stored as string
  related_project_id: string | null;
  related_task_id: string | null;
  related_step_id: string | null;
  created_at: string;
  updated_at: string;
}

// === Research Plans ===

export type ResearchPlanStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface ResearchPlan {
  id: string;
  file_name: string;
  title: string;
  project_id: string | null;
  linked_task_ids: string; // JSON array of task IDs
  status: ResearchPlanStatus;
  tags: string; // JSON array
  created_at: string;
  updated_at: string;
  missing?: boolean; // file deleted on disk but row remains
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  relativePath: string;
}

export interface HpcConfig {
  host: string;       // e.g. 'login.shanghai-super.com'
  user: string;       // username
  remotePath: string; // remote working directory prefix
  moduleQE: string;   // module load command for Quantum ESPRESSO
  moduleWannier: string;   // module load command for Wannier90
  moduleTRIQS: string;     // module load command for TRIQS
  nprocs: string;     // default number of processors
}

// === Agent research environment V1 ===

export interface ResearchContract {
  schemaVersion: 1;
  approvedPlan: { path: string; sha256: string };
  objectives: string[];
  requiredStages: string[];
  boundaries: {
    allowedSoftwareStacks: string[];
    allowedMethods: string[];
    parameterBounds: Record<string, { min?: number; max?: number; values?: string[] }>;
  };
  humanGates: string[];
  completion: { requiredEvidence: string[] };
  resourceBudget: {
    maxCoresPerJob: number;
    maxWallMinutes: number;
    maxConcurrentJobs: number;
    maxAutomaticRetries: number;
  };
}

export interface AgentPolicyDocument {
  schemaVersion: 1;
  remoteEnabled: boolean;
  smokeAuthorized: boolean;
  allowedOperations: string[];
  allowedHosts: string[];
  allowedMethods: string[];
  localRoot?: string;
  remoteRoot?: string;
  limits: ResearchContract['resourceBudget'];
  protectedPaths: string[];
  humanGates: string[];
}

export interface AgentPolicy {
  id: string;
  scope_type: 'system' | 'project' | 'task';
  scope_id: string | null;
  scope_key: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  policy: AgentPolicyDocument;
  sha256: string;
  created_at: string;
  activated_at: string | null;
}

export interface ResearchRun {
  id: string;
  task_id: string;
  research_plan_id: string;
  status: 'active' | 'waiting_review' | 'completed' | 'terminated';
  current_context_version_id: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
}

export interface RunContextVersion {
  id: string;
  run_id: string;
  version: number;
  plan_sha256: string;
  contract_sha256: string;
  workflow_sha256: string;
  policy_sha256: string;
  adopted_reason: string;
  created_at: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
  context_version_id: string | null;
  sequence: number;
  category: 'fact' | 'inference' | 'decision' | 'conclusion';
  event_type: string;
  actor_type: 'agent' | 'researcher' | 'system';
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  occurred_at: string;
}

export interface ReviewRequest {
  id: string;
  run_id: string;
  context_version_id: string;
  status: 'open' | 'decided' | 'superseded';
  gate_type: string;
  question: string;
  options: unknown[];
  recommendation: Record<string, unknown>;
  evidence: unknown[];
  proposal: Record<string, unknown> | null;
  idempotency_key: string | null;
  created_at: string;
  decided_at: string | null;
  decision?: ReviewDecision;
}

export interface ReviewDecision {
  id: string;
  request_id: string;
  decision: 'approve' | 'reject' | 'supplement' | 'terminate';
  comment: string;
  actor: string;
  created_at: string;
}

export interface RemoteJob {
  id: string;
  run_id: string;
  context_version_id: string;
  action_token: string;
  host: string;
  remote_root: string;
  remote_workdir: string;
  job_id: string | null;
  job_name: string;
  status: string;
  last_observation: Record<string, unknown>;
  submitted_at: string | null;
  reconciled_at: string | null;
  created_at: string;
}

export interface RemoteCapabilityReport {
  host: string;
  remoteRoot: string;
  reachable: boolean;
  canonicalRemoteRoot?: string;
  commands: Record<string, { available: boolean; path?: string }>;
  scheduler?: string;
  observedAt: string;
  error?: { code: string; message: string };
}

export interface AgentContextV1 {
  schemaVersion: 1;
  project: Project;
  task: Task;
  taskRoot: { relative: string | null; absolute: string | null; resolved: boolean };
  run: ResearchRun | null;
  contextVersion: RunContextVersion | null;
  research: {
    planId: string | null;
    currentPlanSha256: string | null;
    adoptedPlanSha256: string | null;
    currentContractSha256: string | null;
    adoptedContractSha256: string | null;
    drift: boolean;
  };
  workflow: WorkflowTemplate | null;
  effectivePolicy: AgentPolicyDocument | null;
  policySources: Array<{ id: string; scope_type: string; version: number; sha256: string }>;
  remoteCapability: RemoteCapabilityReport | null;
  recentJobs: RemoteJob[];
  pendingReviews: ReviewRequest[];
  eventCursor: number;
  evidenceIndex: Array<{ eventId: string; eventType: string; occurredAt: string }>;
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}
