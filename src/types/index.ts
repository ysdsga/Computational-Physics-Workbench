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
  workflow_sha256?: string | null;
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
  related_project_name?: string | null;
  related_task_name?: string | null;
  promoted?: number;
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
  schemaVersion?: 2;
  profiles?: HpcProfile[];
  defaultProfileId?: string;
  taskBindings?: HpcTaskBinding[];
  // Legacy single-profile fields are retained only for reading existing data.
  host?: string;
  user?: string;
  remotePath?: string;
  moduleQE?: string;
  moduleWannier?: string;
  moduleTRIQS?: string;
  nprocs?: string;
}

export interface HpcProfile {
  id: string;
  name: string;
  sshAlias: string;
  /** Read-only boundary for this account, normally the remote user home. */
  userRoot?: string;
  /** Project directory below userRoot. Task directories are direct children. */
  projectRoot?: string;
  /** Legacy V1 root. Kept only so existing metadata remains readable. */
  remoteRoot?: string;
  scheduler: string;
  notes: string;
}

export interface HpcTaskBinding {
  taskId: string;
  profileId: string;
  /** Stable, single-segment directory name directly below the remote project root. */
  taskRootRel: string;
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
  /** Read operations may target this root or one of its descendants. */
  remoteReadRoot?: string;
  /** Existing project directory under remoteReadRoot. */
  remoteProjectRoot?: string;
  /** The only remote Task tree where writes and submitted jobs are allowed. */
  remoteWriteRoot?: string;
  /** Legacy single-root boundary. New policies should use the three fields above. */
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
  source: string;
  conversation_ref: string | null;
  occurred_at: string;
}

export type RunActionStatus =
  | 'proposed'
  | 'authorized'
  | 'executing'
  | 'waiting_remote'
  | 'waiting_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface RunAction {
  id: string;
  run_id: string;
  context_version_id: string;
  step_id: string;
  action_type: string;
  status: RunActionStatus;
  executor: 'codex';
  manifest: Record<string, unknown>;
  manifest_sha256: string;
  idempotency_key: string;
  conversation_ref: string | null;
  authorization_summary: string | null;
  authorization_sha256: string | null;
  authorized_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown>;
  error: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RunArtifact {
  id: string;
  run_id: string;
  context_version_id: string;
  action_id: string;
  remote_job_id: string | null;
  step_id: string;
  location: 'local' | 'remote';
  path: string;
  size_bytes: number;
  sha256: string;
  category: string;
  metadata: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
}

export interface EvidenceCheck {
  id: string;
  run_id: string;
  context_version_id: string;
  action_id: string;
  artifact_id: string | null;
  step_id: string;
  validator_name: string;
  validator_version: string;
  status: 'pass' | 'warn' | 'fail';
  result: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
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
  source: string;
  conversation_ref: string | null;
  created_at: string;
  decided_at: string | null;
  decision?: ReviewDecision;
  project_id?: string;
  project_name?: string;
  task_id?: string;
  task_name?: string;
  run_status?: string;
}

export interface EvidenceLibraryItem extends RunArtifact {
  project_id: string;
  project_name: string;
  task_id: string;
  task_name: string;
  run_status: string;
  action_type: string;
  job_status: string | null;
  local_available: boolean | null;
  checks: EvidenceCheck[];
}

export interface ReviewDecision {
  id: string;
  request_id: string;
  decision: 'approve' | 'reject' | 'supplement' | 'terminate';
  comment: string;
  actor: string;
  source: string;
  conversation_ref: string | null;
  decision_sha256: string | null;
  created_at: string;
}

export interface RemoteJob {
  id: string;
  run_id: string;
  context_version_id: string;
  action_id: string | null;
  step_id: string | null;
  action_token: string;
  host: string;
  remote_root: string;
  remote_workdir: string;
  job_id: string | null;
  job_name: string;
  status: string;
  execution_manifest: Record<string, unknown>;
  execution_manifest_sha256: string | null;
  script_sha256: string | null;
  resources: Record<string, unknown>;
  resources_sha256: string | null;
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
  recentActions: RunAction[];
  recentJobs: RemoteJob[];
  recentArtifacts: RunArtifact[];
  recentEvidenceChecks: EvidenceCheck[];
  pendingReviews: ReviewRequest[];
  eventCursor: number;
  evidenceIndex: Array<{ eventId: string; eventType: string; occurredAt: string }>;
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}
