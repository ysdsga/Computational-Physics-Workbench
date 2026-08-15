import { Router } from 'express';
import fs from 'fs';
import db from '../db.js';
import { getWorkflowFromDB } from './workflows.js';
import type { WorkflowTemplate } from '../../src/types/index.js';
import { PathBoundaryError, resolveWithinRoot } from '../services/pathSafety.js';
import { allocateTaskRoot, ensureTaskStageFolders, normalizeTaskRootRel, sanitizeTaskFolderName } from '../services/taskRoots.js';

const router = Router({ mergeParams: true });

interface TaskRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  workflow_id: string;
  workflow_snapshot: string | null;
  task_root_rel: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function readWorkflowSnapshot(row: TaskRow): WorkflowTemplate | undefined {
  if (row.workflow_snapshot) {
    try {
      const workflow = JSON.parse(row.workflow_snapshot) as WorkflowTemplate;
      if (Array.isArray(workflow.stages) && Array.isArray(workflow.steps)) return workflow;
    } catch {
      // Fall through and repair malformed legacy data from its source template.
    }
  }

  const workflow = getWorkflowFromDB(row.workflow_id);
  if (workflow) {
    db.prepare('UPDATE tasks SET workflow_snapshot = ? WHERE id = ?')
      .run(JSON.stringify(workflow), row.id);
  }
  return workflow;
}

function serializeTask(row: TaskRow) {
  const { workflow_snapshot: _snapshot, ...task } = row;
  return { ...task, task_root_unresolved: !row.task_root_rel, workflow: readWorkflowSnapshot(row) };
}

function backfillTaskWorkflowSnapshots(): void {
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE workflow_snapshot IS NULL OR workflow_snapshot = ''`,
  ).all() as TaskRow[];
  for (const row of rows) readWorkflowSnapshot(row);
}

function validateWorkflow(workflow: WorkflowTemplate): string | null {
  if (!workflow.name?.trim()) return 'Workflow name is required';
  if (!Array.isArray(workflow.stages)) return 'stages array is required';
  if (!Array.isArray(workflow.steps)) return 'steps array is required';

  const stageIds = new Set<string>();
  for (const stage of workflow.stages) {
    if (!stage.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stage.id)) {
      return `Invalid stage ID: ${stage.id || '(empty)'}`;
    }
    if (stageIds.has(stage.id)) return `Duplicate stage ID: ${stage.id}`;
    stageIds.add(stage.id);
  }

  const stepIds = new Set<string>();
  for (const step of workflow.steps) {
    if (!step.id?.trim()) return 'Step ID is required';
    if (stepIds.has(step.id)) return `Duplicate step ID: ${step.id}`;
    if (!stageIds.has(step.stageId)) return `Unknown stage for step ${step.id}: ${step.stageId}`;
    stepIds.add(step.id);
  }
  return null;
}

// Create task folder structure under project working_dir.
// Existing folders are retained; task workflow edits only add missing stage folders.
function createTaskFolders(workingDir: string, taskRootRel: string, workflow: WorkflowTemplate): void {
  if (!workingDir) return;
  ensureTaskStageFolders(workingDir, taskRootRel, workflow.stages.map(stage => stage.id));
}

function backfillTaskRoots(): void {
  const rows = db.prepare(`
    SELECT tasks.id, tasks.project_id, tasks.name, tasks.task_root_rel, projects.working_dir
    FROM tasks JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.task_root_rel IS NULL OR tasks.task_root_rel = ''
  `).all() as { id: string; project_id: string; name: string; task_root_rel: string | null; working_dir: string }[];
  const claimed = new Set(
    (db.prepare("SELECT project_id, task_root_rel FROM tasks WHERE task_root_rel IS NOT NULL AND task_root_rel <> ''").all() as { project_id: string; task_root_rel: string }[])
      .map(item => `${item.project_id}\0${item.task_root_rel.toLocaleLowerCase()}`),
  );
  const update = db.prepare('UPDATE tasks SET task_root_rel = ? WHERE id = ?');
  for (const row of rows) {
    if (!row.working_dir || !fs.existsSync(row.working_dir)) continue;
    const candidate = sanitizeTaskFolderName(row.name);
    const claimKey = `${row.project_id}\0${candidate.toLocaleLowerCase()}`;
    if (claimed.has(claimKey)) continue;
    try {
      const full = resolveWithinRoot(row.working_dir, candidate, { mustExist: true, label: 'legacy task root' });
      if (!fs.statSync(full).isDirectory()) continue;
      update.run(candidate, row.id);
      claimed.add(claimKey);
    } catch {
      // Leave unresolved: Agent actions must fail closed until the user chooses a root.
    }
  }
}

// One-time compatibility migration for tasks created before workflow snapshots existed.
// Their current source template becomes the starting point for an independent workflow.
backfillTaskWorkflowSnapshots();
backfillTaskRoots();

// List tasks for a project
router.get('/', (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as TaskRow[];
  res.json(rows.map(serializeTask));
});

// Get single task with progress
router.get('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const progress = db.prepare('SELECT * FROM step_progress WHERE task_id = ?').all(taskId);
  res.json({ ...serializeTask(task), progress });
});

// Create task under a project
router.post('/', (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const { name, description, workflow_id, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!workflow_id) return res.status(400).json({ error: 'Workflow ID is required' });

  const project = db.prepare('SELECT id, working_dir FROM projects WHERE id = ?').get(projectId) as { id: string; working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const workflow = getWorkflowFromDB(workflow_id);
  if (!workflow) return res.status(400).json({ error: 'Workflow not found' });
  const workflowError = validateWorkflow(workflow);
  if (workflowError) return res.status(400).json({ error: workflowError });

  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const claimedRoots = (db.prepare(
    "SELECT task_root_rel FROM tasks WHERE project_id = ? AND task_root_rel IS NOT NULL AND task_root_rel <> ''",
  ).all(projectId) as { task_root_rel: string }[]).map(item => item.task_root_rel);
  const taskRootRel = allocateTaskRoot(project.working_dir, name, id, claimedRoots);

  db.prepare(`INSERT INTO tasks (id, project_id, name, description, workflow_id, workflow_snapshot, task_root_rel, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, projectId, name, description || '', workflow_id, JSON.stringify(workflow), taskRootRel, status || 'active', now, now,
  );

  // Auto-create folder structure under working_dir
  if (project.working_dir) {
    try {
      createTaskFolders(project.working_dir, taskRootRel, workflow);
    } catch (err) {
      // Folder creation failure should not block task creation
      console.error(`[Task] Failed to create folders: ${(err as Error).message}`);
    }
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  res.status(201).json(serializeTask(task));
});

// Replace only this task's workflow snapshot. The source template is untouched.
router.put('/:taskId/workflow', (req, res) => {
  const { taskId } = req.params;
  const task = db.prepare(`
    SELECT tasks.*, projects.working_dir
    FROM tasks
    JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.id = ?
  `).get(taskId) as (TaskRow & { working_dir: string }) | undefined;
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const workflow: WorkflowTemplate = {
    id: task.workflow_id,
    name: req.body.name,
    description: req.body.description ?? '',
    stages: req.body.stages,
    steps: req.body.steps,
  };
  const workflowError = validateWorkflow(workflow);
  if (workflowError) return res.status(400).json({ error: workflowError });

  const now = new Date().toISOString();
  db.prepare('UPDATE tasks SET workflow_snapshot = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(workflow), now, taskId);

  if (task.working_dir) {
    try {
      if (task.task_root_rel) createTaskFolders(task.working_dir, task.task_root_rel, workflow);
    } catch (err) {
      // Keep workflow edits usable even when a project directory is temporarily unavailable.
      console.error(`[Task] Failed to create workflow stage folders: ${(err as Error).message}`);
    }
  }

  res.json(workflow);
});

// Resolve an old task's stable root without moving existing scientific data.
router.put('/:taskId/root', (req, res) => {
  const { taskId } = req.params;
  const { task_root_rel, create } = req.body ?? {};
  const task = db.prepare(`
    SELECT tasks.*, projects.working_dir
    FROM tasks JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.id = ?
  `).get(taskId) as (TaskRow & { working_dir: string }) | undefined;
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.working_dir) return res.status(400).json({ error: 'Project has no working directory', code: 'WORKING_DIR_REQUIRED' });
  if (task.task_root_rel) return res.status(409).json({ error: 'Task root is already resolved and cannot be changed', code: 'TASK_ROOT_ALREADY_RESOLVED' });
  try {
    const normalizedRoot = normalizeTaskRootRel(task_root_rel);
    const target = resolveWithinRoot(task.working_dir, normalizedRoot, { allowRoot: false, label: 'task root' });
    if (create === true) fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return res.status(400).json({ error: 'Task root does not exist', code: 'TASK_ROOT_NOT_FOUND' });
    }
    const conflict = db.prepare(
      'SELECT id FROM tasks WHERE project_id = ? AND task_root_rel = ? COLLATE NOCASE AND id <> ?',
    ).get(task.project_id, normalizedRoot, taskId);
    if (conflict) return res.status(409).json({ error: 'Task root is already assigned', code: 'TASK_ROOT_CONFLICT' });
    db.prepare('UPDATE tasks SET task_root_rel = ?, updated_at = ? WHERE id = ?')
      .run(normalizedRoot, new Date().toISOString(), taskId);
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
    res.json(serializeTask(updated));
  } catch (err) {
    if (err instanceof PathBoundaryError) return res.status(403).json({ error: err.message, code: 'PATH_OUTSIDE_ROOT' });
    throw err;
  }
});

// Update task
router.put('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { name, description, status } = req.body;
  const now = new Date().toISOString();

  const result = db.prepare(`UPDATE tasks SET
    name = COALESCE(?, name),
    description = COALESCE(?, description),
    status = COALESCE(?, status),
    updated_at = ?
    WHERE id = ?`).run(name ?? null, description ?? null, status ?? null, now, taskId);

  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow;
  res.json(serializeTask(task));
});

// Delete task (cascade deletes progress and files)
router.delete('/:taskId', (req, res) => {
  const { taskId } = req.params;
  if (db.prepare('SELECT 1 FROM research_runs WHERE task_id = ? LIMIT 1').get(taskId)) {
    return res.status(409).json({ error: 'Task has research runs and can only be archived', code: 'RUN_HISTORY_PROTECTED' });
  }
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

export default router;
