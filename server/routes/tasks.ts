import { Router } from 'express';
import db from '../db.js';
import { getWorkflowFromDB } from './workflows.js';
import { createTaskFolders, sanitizeTaskFolderName } from '../taskFolders.js';
import { taskCreateSchema, taskUpdateSchema, validateBody } from '../validation.js';

const router = Router({ mergeParams: true });

// List tasks for a project
router.get('/', (req, res) => {
  const projectId = String((req.params as Record<string, string | undefined>).projectId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId);
  res.json(tasks);
});

// Get single task with progress
router.get('/:taskId', (req, res) => {
  const taskId = String(req.params.taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const progress = db.prepare('SELECT * FROM step_progress WHERE task_id = ?').all(taskId);
  res.json({ ...task as object, progress });
});

// Create task under a project
router.post('/', validateBody(taskCreateSchema), (req, res) => {
  const projectId = String((req.params as Record<string, string | undefined>).projectId);
  const { name, description, workflow_id, status } = req.body;
  const workflow = getWorkflowFromDB(workflow_id);
  if (!workflow) return res.status(400).json({ error: 'Unknown workflow ID' });

  const project = db.prepare('SELECT id, working_dir FROM projects WHERE id = ?').get(projectId) as { id: string; working_dir: string } | undefined;
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const folderName = sanitizeTaskFolderName(name);

  const folderConflict = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND folder_name = ?').get(projectId, folderName);
  if (folderConflict) return res.status(409).json({ error: 'A task already uses this working folder name' });

  if (project.working_dir) {
    try {
      createTaskFolders(project.working_dir, folderName, workflow);
    } catch (err) {
      return res.status(500).json({ error: `Failed to create task folders: ${(err as Error).message}` });
    }
  }

  db.prepare(`INSERT INTO tasks (id, project_id, name, description, workflow_id, status, folder_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, name, description || '', workflow_id, status || 'active', folderName, now, now);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(task);
});

// Update task
router.put('/:taskId', validateBody(taskUpdateSchema), (req, res) => {
  const taskId = String(req.params.taskId);
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
  const taskId = String(req.params.taskId);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

export default router;
