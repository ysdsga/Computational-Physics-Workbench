import { Router } from 'express';
import db from '../db.js';
import { WORKFLOWS as BUILTIN_WORKFLOWS } from '../../src/data/workflows.js';
import type { WorkflowTemplate } from '../../src/types/index.js';

const router = Router();

// Seed workflow_templates table from built-in defaults if empty
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM workflow_templates').get() as { c: number };
  if (count.c === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const wf of BUILTIN_WORKFLOWS) {
      const data = JSON.stringify({ stages: wf.stages, steps: wf.steps });
      insert.run(wf.id, wf.name, wf.description, data, now);
    }
    console.log(`[Workflows] Seeded ${BUILTIN_WORKFLOWS.length} built-in workflow templates`);
  }
}

// Get full workflow template from DB, fall back to built-in
export function getWorkflowFromDB(workflowId: string): WorkflowTemplate | undefined {
  seedIfEmpty();
  const row = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(workflowId) as
    | { id: string; name: string; description: string; data: string }
    | undefined;
  if (row) {
    const parsed = JSON.parse(row.data) as { stages: WorkflowTemplate['stages']; steps: WorkflowTemplate['steps'] };
    return { id: row.id, name: row.name, description: row.description, stages: parsed.stages, steps: parsed.steps };
  }
  // Fallback to built-in
  return BUILTIN_WORKFLOWS.find(w => w.id === workflowId);
}

// List all workflow templates (metadata only — for dropdowns)
router.get('/', (_req, res) => {
  seedIfEmpty();
  const rows = db.prepare('SELECT id, name, description FROM workflow_templates ORDER BY id').all() as
    { id: string; name: string; description: string }[];
  res.json(rows);
});

// Get ALL full workflow templates (with stages + steps — for frontend context)
router.get('/all/full', (_req, res) => {
  seedIfEmpty();
  const rows = db.prepare('SELECT * FROM workflow_templates ORDER BY id').all() as
    { id: string; name: string; description: string; data: string }[];
  const result = rows.map(row => {
    const parsed = JSON.parse(row.data) as { stages: WorkflowTemplate['stages']; steps: WorkflowTemplate['steps'] };
    return { id: row.id, name: row.name, description: row.description, stages: parsed.stages, steps: parsed.steps };
  });
  res.json(result);
});

// Get full workflow template (with stages + steps)
router.get('/:id', (req, res) => {
  const wf = getWorkflowFromDB(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  res.json(wf);
});

// Save full workflow template (stages + steps)
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, stages, steps } = req.body;

  if (!stages || !Array.isArray(stages)) return res.status(400).json({ error: 'stages array is required' });
  if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'steps array is required' });

  const existing = db.prepare('SELECT id FROM workflow_templates WHERE id = ?').get(id);
  const now = new Date().toISOString();
  const data = JSON.stringify({ stages, steps });

  if (existing) {
    db.prepare('UPDATE workflow_templates SET name = COALESCE(?, name), description = COALESCE(?, description), data = ?, updated_at = ? WHERE id = ?')
      .run(name ?? null, description ?? null, data, now, id);
  } else {
    db.prepare('INSERT INTO workflow_templates (id, name, description, data, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name ?? 'Untitled', description ?? '', data, now);
  }

  const wf = getWorkflowFromDB(id);
  res.json(wf);
});

// Reset workflow template to built-in default
router.post('/:id/reset', (req, res) => {
  const { id } = req.params;
  const builtin = BUILTIN_WORKFLOWS.find(w => w.id === id);
  if (!builtin) return res.status(404).json({ error: 'No built-in template for this workflow ID' });

  const now = new Date().toISOString();
  const data = JSON.stringify({ stages: builtin.stages, steps: builtin.steps });
  db.prepare('UPDATE workflow_templates SET name = ?, description = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(builtin.name, builtin.description, data, now, id);

  res.json(getWorkflowFromDB(id));
});

export default router;
