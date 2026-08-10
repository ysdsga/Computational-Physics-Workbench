import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { getWorkflowFromDB } from './workflows.js';
import type { WorkflowTemplate } from '../../src/types/index.js';

const router = Router({ mergeParams: true });

// Sanitize folder name: replace invalid chars with _
function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'unnamed';
}

interface TaskRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  workflow_id: string;
  workflow_snapshot: string | null;
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
  return { ...task, workflow: readWorkflowSnapshot(row) };
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
function createTaskFolders(workingDir: string, taskName: string, workflow: WorkflowTemplate): string | null {
  if (!workingDir) return null;

  const taskFolder = sanitizeFolderName(taskName);
  const taskBasePath = path.join(workingDir, taskFolder);

  // Create stage folders only (no step subfolders — user prefers simpler structure)
  for (const stage of workflow.stages) {
    const stagePath = path.join(taskBasePath, stage.id);
    fs.mkdirSync(stagePath, { recursive: true });
  }

  return taskFolder;
}

// One-time compatibility migration for tasks created before workflow snapshots existed.
// Their current source template becomes the starting point for an independent workflow.
backfillTaskWorkflowSnapshots();

// List tasks for a project
router.get('/', (req, res) => {
  const { projectId } = req.params;
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
  const { projectId } = req.params;
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

  db.prepare(`INSERT INTO tasks (id, project_id, name, description, workflow_id, workflow_snapshot, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, projectId, name, description || '', workflow_id, JSON.stringify(workflow), status || 'active', now, now,
  );

  // Auto-create folder structure under working_dir
  if (project.working_dir) {
    try {
      createTaskFolders(project.working_dir, name, workflow);
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
      createTaskFolders(task.working_dir, task.name, workflow);
    } catch (err) {
      // Keep workflow edits usable even when a project directory is temporarily unavailable.
      console.error(`[Task] Failed to create workflow stage folders: ${(err as Error).message}`);
    }
  }

  res.json(workflow);
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
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

export default router;
