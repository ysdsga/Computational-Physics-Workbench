import { Router } from 'express';
import db from '../db.js';

const router = Router({ mergeParams: true });

// Get all step progress for a task
router.get('/', (req, res) => {
  const { taskId } = req.params as { taskId: string };
  const progress = db.prepare(`
    SELECT sp.*, GROUP_CONCAT(
      json_object('id', sf.id, 'file_path', sf.file_path, 'file_name', sf.file_name,
                   'description', sf.description, 'created_at', sf.created_at)
    ) as files_json
    FROM step_progress sp
    LEFT JOIN step_files sf ON sf.step_progress_id = sp.id
    WHERE sp.task_id = ?
    GROUP BY sp.id
  `).all(taskId);

  // Parse the files_json field and commands field
  const result = (progress as any[]).map(p => ({
    ...p,
    files: p.files_json ? JSON.parse(`[${p.files_json}]`) : [],
    files_json: undefined,
    commands: p.commands ? JSON.parse(p.commands) : undefined,
  }));

  res.json(result);
});

// Upsert step progress (status + notes + commands + lsf_script)
router.put('/:stepId', (req, res) => {
  const { taskId, stepId } = req.params as { taskId: string; stepId: string };
  const { status, notes, commands, lsf_script } = req.body;
  const now = new Date().toISOString();

  // Serialize commands array to JSON string
  const commandsJson = commands !== undefined ? JSON.stringify(commands) : undefined;

  // Check if exists
  const existing = db.prepare('SELECT id FROM step_progress WHERE task_id = ? AND step_id = ?').get(taskId, stepId);

  if (existing) {
    db.prepare(`UPDATE step_progress SET
      status = COALESCE(?, status),
      notes = COALESCE(?, notes),
      commands = COALESCE(?, commands),
      lsf_script = COALESCE(?, lsf_script),
      updated_at = ?
      WHERE task_id = ? AND step_id = ?`).run(status ?? null, notes ?? null, commandsJson ?? null, lsf_script ?? null, now, taskId, stepId);
  } else {
    const id = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO step_progress (id, task_id, step_id, status, notes, commands, lsf_script, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, taskId, stepId, status || 'pending', notes || '', commandsJson, lsf_script, now);
  }

  const updated = db.prepare('SELECT * FROM step_progress WHERE task_id = ? AND step_id = ?').get(taskId, stepId) as any;
  if (updated && updated.commands) {
    updated.commands = JSON.parse(updated.commands);
  }
  res.json(updated);
});

// Get files for a specific step
router.get('/:stepId/files', (req, res) => {
  const { taskId, stepId } = req.params as { taskId: string; stepId: string };
  const sp = db.prepare('SELECT id FROM step_progress WHERE task_id = ? AND step_id = ?').get(taskId, stepId);
  if (!sp) return res.json([]);

  const files = db.prepare('SELECT * FROM step_files WHERE step_progress_id = ? ORDER BY created_at DESC').all((sp as any).id);
  res.json(files);
});

// Add a file to a step
router.post('/:stepId/files', (req, res) => {
  const { taskId, stepId } = req.params as { taskId: string; stepId: string };
  const { file_path, file_name, description } = req.body;
  if (!file_path || !file_name) return res.status(400).json({ error: 'file_path and file_name are required' });

  // Get or create step_progress
  let sp = db.prepare('SELECT id FROM step_progress WHERE task_id = ? AND step_id = ?').get(taskId, stepId) as { id: string } | undefined;
  if (!sp) {
    const spId = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO step_progress (id, task_id, step_id, status, notes, updated_at)
      VALUES (?, ?, ?, 'pending', '', ?)`).run(spId, taskId, stepId, now);
    sp = { id: spId };
  }

  const id = `sf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO step_files (id, step_progress_id, file_path, file_name, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, sp.id, file_path, file_name, description || '', now);

  const file = db.prepare('SELECT * FROM step_files WHERE id = ?').get(id);
  res.status(201).json(file);
});

export default router;
