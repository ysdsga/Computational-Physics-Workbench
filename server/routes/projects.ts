import { Router } from 'express';
import db from '../db.js';

const router = Router();

// List all projects
router.get('/', (_req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  res.json(projects);
});

// Get single project with task count
router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(req.params.id) as { count: number };
  res.json({ ...project as object, task_count: taskCount.count });
});

// Create project
router.post('/', (req, res) => {
  const { name, description, material, working_dir } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO projects (id, name, description, material, working_dir, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, name, description || '', material || '', working_dir || '', now, now);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

// Update project
router.put('/:id', (req, res) => {
  const { name, description, material, working_dir, hpc_config } = req.body;
  const now = new Date().toISOString();

  const result = db.prepare(`UPDATE projects SET
    name = COALESCE(?, name),
    description = COALESCE(?, description),
    material = COALESCE(?, material),
    working_dir = COALESCE(?, working_dir),
    hpc_config = COALESCE(?, hpc_config),
    updated_at = ?
    WHERE id = ?`).run(name ?? null, description ?? null, material ?? null, working_dir ?? null, hpc_config ?? null, now, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(project);
});

// Delete project (cascade deletes tasks, progress, files)
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  res.json({ success: true });
});

export default router;
