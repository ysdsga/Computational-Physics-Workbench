// === Core Types for DFT+DMFT Workbench ===

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'archived';
export type TaskSpecStatus = 'draft' | 'awaiting_approval' | 'ready' | 'executing' | 'monitoring' | 'verifying' | 'completed' | 'failed' | 'unknown' | 'blocked';
export type CommandRiskClass = 'unclassified' | 'read-only' | 'submit' | 'mutating' | 'submit+mutating' | 'blocked';

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
  dependsOn?: string[];
  preconditions?: string[];
  scientificChecks?: string[];
  successCriteria?: string[];
  failureHandling?: string[];
  approvalPoints?: string[];
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
  status: TaskStatus;
  folder_name: string;
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
  source_task_spec_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  relativePath: string;
}

export interface HpcConfig {
  host: string;       // legacy SSH field; retained for existing saved configs
  user: string;       // legacy SSH field; retained for existing saved configs
  remotePath: string; // remote working directory prefix
  moduleQE: string;   // module load command for Quantum ESPRESSO
  moduleWannier: string;   // module load command for Wannier90
  moduleTRIQS: string;     // module load command for TRIQS
  nprocs: string;     // default number of processors
  connectionMode?: 'web-terminal';
  portalWindowTitle?: string;
}

export interface ExecutionEvidence {
  kind: string;
  summary: string;
  source?: string;
}

export interface ApprovalEvent {
  id: string;
  task_spec_id: string;
  decision: 'approved' | 'rejected';
  command_hash: string;
  actor: string;
  note: string;
  created_at: string;
}

export interface CommandRun {
  id: string;
  task_spec_id: string;
  attempt_no: number;
  status: 'executing' | 'completed' | 'failed' | 'unknown';
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  output_summary: string;
  evidence: ExecutionEvidence[];
  error_message: string;
  verification_note: string;
  command_hash: string;
  task_spec_snapshot: {
    title?: string;
    step_id?: string;
    command?: string;
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
    failure_policy?: string;
    timeout_seconds?: number;
  };
}

export interface SchedulerPollEvent {
  id: string;
  scheduler_job_id: string;
  command: string;
  status: 'executing' | 'completed' | 'failed' | 'unknown';
  scheduler_state: string;
  raw_summary: string;
  remote_exit_code: number | null;
  error_message: string;
  started_at: string;
  finished_at: string | null;
}

export interface SchedulerLogEvent {
  id: string;
  scheduler_job_id: string;
  relative_path: string;
  line_count: number;
  command: string;
  status: 'executing' | 'completed' | 'failed' | 'unknown';
  output_summary: string;
  remote_exit_code: number | null;
  error_message: string;
  started_at: string;
  finished_at: string | null;
}

export interface SchedulerJob {
  id: string;
  task_spec_id: string;
  scheduler: 'lsf';
  job_id: string;
  status: string;
  submitted_at: string;
  last_polled_at: string | null;
  next_poll_after: string | null;
  last_log_read_at: string | null;
  next_log_read_after: string | null;
  latest_summary: string;
  error_message: string;
  polls: SchedulerPollEvent[];
  log_reads: SchedulerLogEvent[];
}

export interface TaskSpec {
  id: string;
  task_id: string;
  step_id: string;
  title: string;
  remote_workdir: string;
  command: string;
  execution_payload: string;
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
  risk_class: CommandRiskClass;
  approval_required: boolean;
  command_hash: string;
  status: TaskSpecStatus;
  blocked_reasons: string[];
  approvals: ApprovalEvent[];
  runs: CommandRun[];
  scheduler_jobs: SchedulerJob[];
  experiences: Experience[];
  created_at: string;
  updated_at: string;
}
