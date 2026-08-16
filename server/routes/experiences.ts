import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { AgentCoreError, appendEvent, now, runtimeTask, stableJson } from '../services/agentCore.js';

const router = Router();
const STATUSES = new Set(['manual', 'candidate', 'confirmed']);

function normalizedTags(value: unknown): string {
  if (value === undefined) return '[]';
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new AgentCoreError(400, 'EXPERIENCE_TAGS_INVALID', 'tags must be an array of strings');
  return stableJson([...new Set(value.map(item => item.trim()).filter(Boolean))].sort());
}

function normalizedArtifactIds(value: unknown): string {
  if (value === undefined) return '[]';
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new AgentCoreError(400, 'EXPERIENCE_ARTIFACTS_INVALID', 'source_artifact_ids must be an array of strings');
  return stableJson([...new Set(value.map(item => item.trim()).filter(Boolean))].sort());
}

router.get('/', (req, res) => {
  const conditions: string[] = [];
  const params: string[] = [];
  if (req.query.projectId) { conditions.push('experiences.related_project_id = ?'); params.push(String(req.query.projectId)); }
  if (req.query.taskId) { conditions.push('experiences.related_task_id = ?'); params.push(String(req.query.taskId)); }
  if (req.query.status) { conditions.push('experiences.status = ?'); params.push(String(req.query.status)); }
  if (req.query.search) {
    conditions.push('(experiences.title LIKE ? OR experiences.content LIKE ? OR experiences.tags LIKE ? OR experiences.applicable_scope LIKE ?)');
    const search = `%${String(req.query.search)}%`; params.push(search, search, search, search);
  }
  res.json(db.prepare(`SELECT experiences.*, projects.name related_project_name, tasks.name related_task_name
    FROM experiences
    LEFT JOIN projects ON projects.id = experiences.related_project_id
    LEFT JOIN tasks ON tasks.id = experiences.related_task_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY experiences.updated_at DESC`).all(...params));
});

router.post('/codex-capture', (req, res) => {
  const { runId, stageId, title, content, tags, category, applicableScope, sourceArtifactIds, idempotencyKey, conversationRef } = req.body ?? {};
  if (![runId, title, content, idempotencyKey].every(value => typeof value === 'string' && value.trim())) throw new AgentCoreError(400, 'EXPERIENCE_INPUT_REQUIRED', 'runId, title, content and idempotencyKey are required');
  const run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  const task = runtimeTask(run.task_id);
  const normalizedStage = typeof stageId === 'string' && stageId.trim() ? stageId.trim() : null;
  if (normalizedStage && !task.workflow.stages.some(item => item.id === normalizedStage)) throw new AgentCoreError(400, 'WORKFLOW_STAGE_UNKNOWN', 'Experience stage is not present in the Task workflow');
  const artifactJson = normalizedArtifactIds(sourceArtifactIds);
  const artifactIds = JSON.parse(artifactJson) as string[];
  if (artifactIds.some(id => !db.prepare('SELECT 1 FROM run_artifacts WHERE id = ? AND run_id = ?').get(id, runId))) throw new AgentCoreError(409, 'EXPERIENCE_ARTIFACT_MISMATCH', 'A source Artifact belongs to another Run');
  const id = `exp-codex-${crypto.createHash('sha256').update(`${runId}:${idempotencyKey}`).digest('hex').slice(0, 24)}`;
  const record = {
    title: title.trim(), content: content.trim(), tags: normalizedTags(tags), category: String(category ?? 'troubleshooting').trim() || 'troubleshooting',
    applicableScope: String(applicableScope ?? '').trim(), sourceArtifactIds: artifactJson,
  };
  const existing = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id) as any;
  if (existing) {
    if (existing.title !== record.title || existing.content !== record.content || existing.tags !== record.tags || existing.applicable_scope !== record.applicableScope || existing.source_artifact_ids !== record.sourceArtifactIds) throw new AgentCoreError(409, 'EXPERIENCE_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to different experience content');
    return res.json(existing);
  }
  const ts = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO experiences (
      id, title, content, tags, related_project_id, related_task_id, related_step_id,
      category, status, applicable_scope, source_run_id, source_artifact_ids, source_kind,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, 'codex', ?, ?)`)
      .run(id, record.title, record.content, record.tags, task.project_id, task.id, normalizedStage, record.category, record.applicableScope, runId, record.sourceArtifactIds, ts, ts);
    appendEvent(runId, { category: 'inference', eventType: 'experience.captured', actorType: 'agent', payload: { experienceId: id, stageId: normalizedStage, status: 'candidate' }, idempotencyKey: `experience-captured:${idempotencyKey}`, source: 'codex', conversationRef: typeof conversationRef === 'string' ? conversationRef : null });
  })();
  res.status(201).json(db.prepare('SELECT * FROM experiences WHERE id = ?').get(id));
});

router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM experiences WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Experience not found' });
  res.json(item);
});

router.post('/', (req, res) => {
  const { title, content, tags, related_project_id, related_task_id, related_step_id, category, status, applicable_scope, source_run_id, source_artifact_ids, source_kind } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Title and content are required' });
  const normalizedStatus = String(status ?? 'manual');
  if (!STATUSES.has(normalizedStatus)) throw new AgentCoreError(400, 'EXPERIENCE_STATUS_INVALID', 'Invalid Experience status');
  const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = now();
  db.prepare(`INSERT INTO experiences (
    id, title, content, tags, related_project_id, related_task_id, related_step_id,
    category, status, applicable_scope, source_run_id, source_artifact_ids, source_kind, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, title.trim(), content.trim(), normalizedTags(tags), related_project_id || null, related_task_id || null, related_step_id || null, String(category ?? 'workflow'), normalizedStatus, String(applicable_scope ?? ''), source_run_id || null, normalizedArtifactIds(source_artifact_ids), String(source_kind ?? 'researcher'), ts, ts);
  res.status(201).json(db.prepare('SELECT * FROM experiences WHERE id = ?').get(id));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM experiences WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Experience not found' });
  const nextStatus = req.body?.status === undefined ? existing.status : String(req.body.status);
  if (!STATUSES.has(nextStatus)) throw new AgentCoreError(400, 'EXPERIENCE_STATUS_INVALID', 'Invalid Experience status');
  db.prepare(`UPDATE experiences SET title = ?, content = ?, tags = ?, related_project_id = ?, related_task_id = ?, related_step_id = ?,
    category = ?, status = ?, applicable_scope = ?, updated_at = ? WHERE id = ?`).run(
    req.body?.title ?? existing.title, req.body?.content ?? existing.content,
    req.body?.tags === undefined ? existing.tags : normalizedTags(req.body.tags),
    req.body?.related_project_id ?? existing.related_project_id, req.body?.related_task_id ?? existing.related_task_id,
    req.body?.related_step_id ?? existing.related_step_id, req.body?.category ?? existing.category,
    nextStatus, req.body?.applicable_scope ?? existing.applicable_scope, now(), req.params.id,
  );
  res.json(db.prepare('SELECT * FROM experiences WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM experiences WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Experience not found' });
  res.json({ success: true });
});

export default router;
