import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import { getWorkflowFromDB } from './workflows.js';

const router = Router({ mergeParams: true });

// Sanitize folder name: replace invalid chars with _
function sanitizeFolderName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_').trim() || 'unnamed';
}

// Create task folder structure under project working_dir
function createTaskFolders(workingDir: string, taskName: string, workflowId: string): string | null {
  if (!workingDir) return null;
  const workflow = getWorkflowFromDB(workflowId);
  if (!workflow) return null;

  const taskFolder = sanitizeFolderName(taskName);
  const taskBasePath = path.join(workingDir, taskFolder);

  // Create stage folders only (no step subfolders — user prefers simpler structure)
  for (const stage of workflow.stages) {
    const stagePath = path.join(taskBasePath, stage.id);
    fs.mkdirSync(stagePath, { recursive: true });
  }

  return taskFolder;
}

// List tasks for a project
router.get('/', (req, res) => {
  const { projectId } = req.params;
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId);
  res.json(tasks);
});

// Get single task with progress
router.get('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const progress = db.prepare('SELECT * FROM step_progress WHERE task_id = ?').all(taskId);
  res.json({ ...task as object, progress });
});

// Create task under a project
router.post('/', (req, res) => {
  const { projectId } = req.params;
  const { name, description, workflow_id, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!workflow_id) return res.status(400).json({ error: 'Workflow ID is required' });

  const project = db.prepare('SELECT id, working_dir FROM projects WHERE id = ?').get(projectId) as { id: string; working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tasks (id, project_id, name, description, workflow_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, description || '', workflow_id, status || 'active', now, now);

  // Auto-create folder structure under working_dir
  if (project.working_dir) {
    try {
      createTaskFolders(project.working_dir, name, workflow_id);
    } catch (err) {
      // Folder creation failure should not block task creation
      console.error(`[Task] Failed to create folders: ${(err as Error).message}`);
    }
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(task);
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
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  res.json(task);
});

// Delete task (cascade deletes progress and files)
router.delete('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

export default router;
