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
  category?: 'submit_template' | 'input_template' | 'workflow' | 'param_choice' | 'troubleshooting' | string;
  status?: 'manual' | 'candidate' | 'confirmed';
  applicable_scope?: string;
  source_run_id?: string | null;
  source_artifact_ids?: string;
  source_kind?: 'researcher' | 'codex' | 'imported';
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

// === Essential Codex research runtime V3 ===

export type ExecutableCapability =
  | 'local.process'
  | 'remote.inspect'
  | 'remote.task-root.create'
  | 'files.upload'
  | 'files.download'
  | 'job.submit'
  | 'job.cancel';

export interface ResourceLimits {
  maxCoresPerJob: number;
  maxWallMinutes: number;
  maxConcurrentJobs: number;
  maxAutomaticRetries: number;
}

export interface ConfirmedEnvelope {
  schemaVersion: 1;
  coreStageIds: string[];
  scientificCommitments: string[];
  allowedCapabilities: ExecutableCapability[];
  allowedMethods: string[];
  allowedSoftwareStacks: string[];
  hpcProfileId: string | null;
  resourceLimits: ResourceLimits;
  protectedRelativePaths: string[];
  completionEvidence: string[];
  researcherGates: string[];
  explorationReviewRequired?: boolean;
  autonomy: {
    allowWorkingPlanEdits: true;
    allowRetriesWithinLimits: true;
    allowOwnJobCancellation: true;
  };
}

export interface ExplorationReview {
  status: 'continue' | 'passed';
  summary: string;
  unresolvedHighValueItems: string[];
}

export interface StageReflectionIdea {
  idea: string;
  significance: string;
  disposition: 'explore' | 'falsified' | 'deferred' | 'follow_up';
  reason: string;
}

export interface StageReflection {
  stageId: string;
  summary: string;
  established: string[];
  uncertainties: string[];
  ideas: StageReflectionIdea[];
  decision: 'proceed' | 'stay' | 'loop';
  targetStageId: string | null;
  nextActions: Array<Record<string, unknown>>;
}

export interface WorkingPlan extends Record<string, unknown> {
  currentStageId?: string | null;
  summary?: string;
  nextActions?: Array<Record<string, unknown>>;
  directoryLayout?: Record<string, unknown>;
  explorationReview?: ExplorationReview;
}

export interface TaskSpec {
  schemaVersion: 1;
  objective: string;
  confirmedEnvelope: ConfirmedEnvelope;
  workingPlan: WorkingPlan;
}

export interface ResearchRun {
  id: string;
  task_id: string;
  research_plan_id: string;
  status: 'draft' | 'active' | 'waiting_researcher' | 'completed' | 'terminated';
  objective: string;
  confirmed_envelope: ConfirmedEnvelope;
  confirmed_envelope_sha256: string;
  working_plan: WorkingPlan;
  working_plan_sha256: string;
  envelope_revision: number;
  envelope_confirmed_at: string | null;
  envelope_confirmation_summary: string;
  current_stage_id: string | null;
  idempotency_key: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
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

export interface StageReflectionResult {
  reflection: RunEvent;
  run: ResearchRun;
}

export interface StageReflectionSummary {
  eventId: string;
  sequence: number;
  stageId: string;
  decision: StageReflection['decision'];
  targetStageId: string | null;
  summary: string;
  occurredAt: string;
}

export type RunActionStatus =
  | 'ready'
  | 'executing'
  | 'waiting_remote'
  | 'waiting_codex'
  | 'waiting_researcher'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface RunAction {
  id: string;
  run_id: string;
  stage_id: string;
  step_id: string | null;
  parent_action_id: string | null;
  retry_of_action_id: string | null;
  retry_attempt: number;
  action_type: string;
  status: RunActionStatus;
  executor: 'codex';
  spec: Record<string, unknown>;
  spec_sha256: string;
  idempotency_key: string;
  conversation_ref: string | null;
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
  action_id: string;
  remote_job_id: string | null;
  stage_id: string;
  location: 'local' | 'remote';
  path: string;
  size_bytes: number;
  sha256: string;
  category: string;
  validity: 'valid' | 'suspect' | 'invalid' | 'superseded';
  superseded_by_id: string | null;
  metadata: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceCheck {
  id: string;
  run_id: string;
  action_id: string;
  artifact_id: string | null;
  stage_id: string;
  validator_name: string;
  validator_version: string;
  status: 'pass' | 'warn' | 'fail';
  result: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
}

export interface PendingItem {
  id: string;
  run_id: string;
  stage_id: string | null;
  action_id: string | null;
  remote_job_id: string | null;
  audience: 'codex' | 'researcher';
  kind: string;
  status: 'open' | 'resolved' | 'dismissed';
  title: string;
  detail: Record<string, unknown>;
  resolution: Record<string, unknown>;
  idempotency_key: string | null;
  source: string;
  conversation_ref: string | null;
  created_at: string;
  resolved_at: string | null;
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

export interface RemoteJob {
  id: string;
  run_id: string;
  action_id: string;
  stage_id: string;
  action_token: string;
  idempotency_key: string;
  profile_id: string;
  host: string;
  remote_workdir: string;
  scheduler: string;
  job_id: string | null;
  job_name: string;
  status: string;
  submission_spec: Record<string, unknown>;
  script_sha256: string | null;
  resources: Record<string, unknown>;
  last_observation: Record<string, unknown>;
  submit_stdout: string;
  submit_stderr: string;
  submitted_at: string | null;
  reconciled_at: string | null;
  next_check_at: string | null;
  last_progress_at: string | null;
  queue_reason: string;
  poll_count: number;
  terminal_at: string | null;
  created_at: string;
}

export interface RunMonitor {
  run_id: string;
  status: 'required' | 'scheduled' | 'paused' | 'complete';
  automation_ref: string | null;
  cadence_minutes: number | null;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
  active_job_count?: number;
  due_job_count?: number;
  recommended_cadence_minutes?: number | null;
  heartbeat_fresh?: boolean;
  heartbeat_lease_expires_at?: string | null;
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

export interface AgentContext {
  schemaVersion: 4;
  project: Project;
  task: Task;
  taskRoot: { relative: string | null; absolute: string | null; resolved: boolean };
  run: ResearchRun | null;
  research: {
    planId: string | null;
    planTitle: string | null;
    planStatus: ResearchPlanStatus | null;
    planMissing: boolean;
  };
  workflow: WorkflowTemplate | null;
  remoteCapability: RemoteCapabilityReport | null;
  recentActions: RunAction[];
  recentJobs: RemoteJob[];
  monitor: RunMonitor | null;
  recentArtifacts: RunArtifact[];
  recentEvidenceChecks: EvidenceCheck[];
  pendingItems: PendingItem[];
  eventCursor: number;
  latestStageReflections: StageReflectionSummary[];
  evidenceIndex: Array<{ eventId: string; eventType: string; occurredAt: string }>;
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}
