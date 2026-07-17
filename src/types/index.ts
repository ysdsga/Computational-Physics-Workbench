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
  host: string;       // e.g. 'login.shanghai-super.com'
  user: string;       // username
  remotePath: string; // remote working directory prefix
  moduleQE: string;   // module load command for Quantum ESPRESSO
  moduleWannier: string;   // module load command for Wannier90
  moduleTRIQS: string;     // module load command for TRIQS
  nprocs: string;     // default number of processors
}
