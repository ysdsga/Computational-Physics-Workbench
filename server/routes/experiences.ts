import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { AgentCoreError, appendEvent, now, stableJson } from '../services/agentCore.js';

const router = Router();

// List experiences
router.get('/', (req, res) => {
  const { projectId, taskId, search } = req.query;
  let query = `SELECT experiences.*,
    projects.name AS related_project_name,
    tasks.name AS related_task_name,
    EXISTS(SELECT 1 FROM experience_promotions WHERE experience_id = experiences.id) AS promoted
    FROM experiences
    LEFT JOIN projects ON projects.id = experiences.related_project_id
    LEFT JOIN tasks ON tasks.id = experiences.related_task_id
    WHERE 1=1`;
  const params: string[] = [];

  if (projectId) { query += ' AND experiences.related_project_id = ?'; params.push(projectId as string); }
  if (taskId) { query += ' AND experiences.related_task_id = ?'; params.push(taskId as string); }
  if (search) {
    query += ' AND (experiences.title LIKE ? OR experiences.content LIKE ? OR experiences.tags LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  query += ' ORDER BY experiences.updated_at DESC';

  const experiences = db.prepare(query).all(...params);
  res.json(experiences);
});

// Agent-only candidate memory capture. Verified scientific conclusions continue
// to use the evidence-bound promotion endpoint instead.
router.post('/codex-capture', (req, res) => {
  const { runId, stepId, title, content, tags, idempotencyKey, conversationRef } = req.body ?? {};
  if (![runId, title, content, idempotencyKey].every(value => typeof value === 'string' && value.trim())) {
    throw new AgentCoreError(400, 'EXPERIENCE_INPUT_REQUIRED', 'runId, title, content and idempotencyKey are required');
  }
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(idempotencyKey)) {
    throw new AgentCoreError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey must use 1-120 letters, digits, dot, underscore or hyphen');
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string'))) {
    throw new AgentCoreError(400, 'EXPERIENCE_TAGS_INVALID', 'tags must be an array of strings');
  }
  const run = db.prepare(`
    SELECT research_runs.id, research_runs.task_id, research_runs.current_context_version_id,
           tasks.project_id, run_context_versions.workflow_json
    FROM research_runs
    JOIN tasks ON tasks.id = research_runs.task_id
    LEFT JOIN run_context_versions ON run_context_versions.id = research_runs.current_context_version_id
    WHERE research_runs.id = ?
  `).get(runId) as { id: string; task_id: string; current_context_version_id: string | null; project_id: string; workflow_json: string | null } | undefined;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (!run.current_context_version_id || !run.workflow_json) throw new AgentCoreError(409, 'CONTEXT_REQUIRED', 'Run has no adopted context');
  const normalizedStepId = typeof stepId === 'string' && stepId.trim() ? stepId.trim() : null;
  if (normalizedStepId) {
    const workflow = JSON.parse(run.workflow_json) as { steps?: Array<{ id: string }> };
    if (!workflow.steps?.some(step => step.id === normalizedStepId)) {
      throw new AgentCoreError(400, 'WORKFLOW_STEP_UNKNOWN', `Step ${normalizedStepId} is not present in the adopted workflow`);
    }
  }
  const normalizedTags = [...new Set([
    ...(tags ?? []).map((tag: string) => tag.trim()).filter(Boolean),
    'codex-captured',
    'candidate-experience',
  ])].sort();
  const id = `exp-codex-${crypto.createHash('sha256').update(`${runId}:${idempotencyKey}`).digest('hex').slice(0, 24)}`;
  const record = {
    title: title.trim(),
    content: content.trim(),
    tags: stableJson(normalizedTags),
    related_project_id: run.project_id,
    related_task_id: run.task_id,
    related_step_id: normalizedStepId,
  };
  const existing = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as any;
  if (existing) {
    if (
      existing.title !== record.title || existing.content !== record.content || existing.tags !== record.tags
      || existing.related_project_id !== record.related_project_id || existing.related_task_id !== record.related_task_id
      || existing.related_step_id !== record.related_step_id
    ) throw new AgentCoreError(409, 'EXPERIENCE_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to different experience content');
    return res.json({ ...existing, promoted: 0 });
  }
  const timestamp = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO experiences (id, title, content, tags, related_project_id, related_task_id, related_step_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, record.title, record.content, record.tags, record.related_project_id, record.related_task_id, record.related_step_id, timestamp, timestamp);
    appendEvent(runId, {
      category: 'inference',
      eventType: 'experience.captured',
      actorType: 'agent',
      payload: { experienceId: id, stepId: normalizedStepId, tags: normalizedTags, status: 'candidate' },
      idempotencyKey: `experience-captured:${idempotencyKey}`,
      source: 'codex',
      conversationRef: typeof conversationRef === 'string' ? conversationRef : null,
      contextVersionId: run.current_context_version_id,
    });
  })();
  res.status(201).json({ ...db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as object, promoted: 0 });
});

router.get('/:id/provenance', (req, res) => {
  const promotion = db.prepare('SELECT * FROM experience_promotions WHERE experience_id = ?').get(req.params.id) as any;
  if (!promotion) return res.status(404).json({ error: 'Promoted experience provenance not found', code: 'EXPERIENCE_PROVENANCE_NOT_FOUND' });
  const artifacts = db.prepare('SELECT * FROM experience_promotion_artifacts WHERE experience_id = ? ORDER BY artifact_id').all(req.params.id);
  res.json({ ...promotion, artifacts });
});

// Get single experience
router.get('/:id', (req, res) => {
  const exp = db.prepare('SELECT experiences.*, EXISTS(SELECT 1 FROM experience_promotions WHERE experience_id = experiences.id) AS promoted FROM experiences WHERE experiences.id = ?').get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experience not found' });
  res.json(exp);
});

// Create experience
router.post('/', (req, res) => {
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
router.put('/:id', (req, res) => {
  if (db.prepare('SELECT 1 FROM experience_promotions WHERE experience_id = ?').get(req.params.id)) {
    return res.status(409).json({ error: 'Evidence-bound promoted experiences are immutable', code: 'PROMOTED_EXPERIENCE_IMMUTABLE' });
  }
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
  if (db.prepare('SELECT 1 FROM experience_promotions WHERE experience_id = ?').get(req.params.id)) {
    return res.status(409).json({ error: 'Evidence-bound promoted experiences are immutable', code: 'PROMOTED_EXPERIENCE_IMMUTABLE' });
  }
  const result = db.prepare('DELETE FROM experiences WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Experience not found' });
  res.json({ success: true });
});

export default router;
