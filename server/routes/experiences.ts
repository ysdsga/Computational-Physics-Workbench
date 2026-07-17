import { Router } from 'express';
import db from '../db.js';
import { experienceCreateSchema, experienceUpdateSchema, validateBody } from '../validation.js';

const router = Router();

// List experiences
router.get('/', (req, res) => {
  const { projectId, taskId, search } = req.query;
  let query = 'SELECT * FROM experiences WHERE 1=1';
  const params: string[] = [];

  if (projectId) { query += ' AND related_project_id = ?'; params.push(projectId as string); }
  if (taskId) { query += ' AND related_task_id = ?'; params.push(taskId as string); }
  if (search) {
    query += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  query += ' ORDER BY updated_at DESC';

  const experiences = db.prepare(query).all(...params);
  res.json(experiences);
});

// Get single experience
router.get('/:id', (req, res) => {
  const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experience not found' });
  res.json(exp);
});

// Create experience
router.post('/', validateBody(experienceCreateSchema), (req, res) => {
  const { title, content, tags, related_project_id, related_task_id, related_step_id } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

  const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(tags || []);

  db.prepare(`INSERT INTO experiences (id, title, content, tags, related_project_id, related_task_id, related_step_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title, content, tagsJson,
    related_project_id || null, related_task_id || null, related_step_id || null,
    now, now
  );

  const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id);
  res.status(201).json(exp);
});

// Update experience
router.put('/:id', validateBody(experienceUpdateSchema), (req, res) => {
  const { title, content, tags, related_project_id, related_task_id, related_step_id } = req.body;
  const now = new Date().toISOString();

  const result = db.prepare(`UPDATE experiences SET
    title = COALESCE(?, title),
    content = COALESCE(?, content),
    tags = COALESCE(?, tags),
    related_project_id = COALESCE(?, related_project_id),
    related_task_id = COALESCE(?, related_task_id),
    related_step_id = COALESCE(?, related_step_id),
    updated_at = ?
    WHERE id = ?`).run(
    title ?? null, content ?? null,
    tags ? JSON.stringify(tags) : null,
    related_project_id ?? null, related_task_id ?? null, related_step_id ?? null,
    now, req.params.id
  );

  if (result.changes === 0) return res.status(404).json({ error: 'Experience not found' });
  const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(req.params.id);
  res.json(exp);
});

// Delete experience
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM experiences WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Experience not found' });
  res.json({ success: true });
});

export default router;
