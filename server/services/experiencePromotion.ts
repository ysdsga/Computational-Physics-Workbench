import db from '../db.js';
import crypto from 'crypto';
import fs from 'fs';
import { AgentCoreError, appendEvent, newId, now, sha256, stableJson } from './agentCore.js';
import { resolveWithinRoot } from './pathSafety.js';
import { normalizeTaskRootRel } from './taskRoots.js';

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError(400, 'INPUT_REQUIRED', `${label} is required`);
  return value.trim();
}

function artifactIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new AgentCoreError(400, 'EVIDENCE_ARTIFACTS_REQUIRED', 'At least one evidence artifact ID is required');
  }
  return [...new Set(value.map(item => String(item).trim()))].sort();
}

function assertCodexConversation(source: unknown): void {
  if (source !== 'codex_conversation') {
    throw new AgentCoreError(400, 'RESEARCHER_SOURCE_INVALID', 'Researcher conclusions and promotions must originate from an explicit Codex conversation decision');
  }
}

function runRow(runId: string) {
  const run = db.prepare(`
    SELECT research_runs.*, tasks.project_id
    FROM research_runs JOIN tasks ON tasks.id = research_runs.task_id
    WHERE research_runs.id = ?
  `).get(runId) as any;
  if (!run) throw new AgentCoreError(404, 'RUN_NOT_FOUND', 'Run not found');
  if (!run.current_context_version_id) throw new AgentCoreError(409, 'CONTEXT_REQUIRED', 'Run has no current context');
  return run;
}

function assertNoOpenReview(runId: string, runStatus: string): void {
  if (runStatus === 'waiting_review' || db.prepare("SELECT 1 FROM review_requests WHERE run_id = ? AND status = 'open' LIMIT 1").get(runId)) {
    throw new AgentCoreError(409, 'OPEN_REVIEW_BLOCKS_CONCLUSION', 'Resolve open Codex conversation reviews before recording or promoting a researcher conclusion');
  }
}

function loadArtifacts(runId: string, ids: string[]) {
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT * FROM run_artifacts WHERE id IN (${placeholders}) ORDER BY id`).all(...ids) as any[];
  if (rows.length !== ids.length) throw new AgentCoreError(404, 'EVIDENCE_ARTIFACT_NOT_FOUND', 'One or more evidence artifacts do not exist');
  if (rows.some(item => item.run_id !== runId)) throw new AgentCoreError(409, 'EVIDENCE_RUN_MISMATCH', 'Evidence artifacts must belong to the conclusion run');
  return rows;
}

function fileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function assertArtifactSourcesCurrent(runId: string, artifacts: any[]): void {
  if (artifacts.some(item => item.location !== 'local')) {
    throw new AgentCoreError(409, 'LOCAL_EVIDENCE_REQUIRED', 'Researcher conclusions require locally recovered evidence whose content hash can be rechecked');
  }
  const root = db.prepare(`
    SELECT projects.working_dir, tasks.task_root_rel
    FROM research_runs JOIN tasks ON tasks.id = research_runs.task_id
    JOIN projects ON projects.id = tasks.project_id
    WHERE research_runs.id = ?
  `).get(runId) as { working_dir: string; task_root_rel: string | null } | undefined;
  if (!root?.task_root_rel) throw new AgentCoreError(409, 'TASK_ROOT_UNRESOLVED', 'Task root is unresolved');
  const taskRoot = resolveWithinRoot(root.working_dir, normalizeTaskRootRel(root.task_root_rel), { mustExist: true, allowRoot: false, label: 'task root' });
  for (const artifact of artifacts) {
    const fullPath = resolveWithinRoot(taskRoot, artifact.path, { mustExist: true, allowRoot: false, label: 'conclusion evidence' });
    if (!fs.statSync(fullPath).isFile() || fileSha256(fullPath) !== artifact.sha256) {
      throw new AgentCoreError(409, 'EVIDENCE_SOURCE_DRIFT', `Evidence source changed after registration: ${artifact.path}`);
    }
  }
}

export function recordResearcherConclusion(runId: string, input: {
  summary: unknown;
  artifactIds: unknown;
  idempotencyKey: unknown;
  source: unknown;
  conversationRef?: unknown;
}) {
  assertCodexConversation(input.source);
  const run = runRow(runId);
  assertNoOpenReview(runId, run.status);
  const summary = requiredText(input.summary, 'summary');
  const ids = artifactIds(input.artifactIds);
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const conversationRef = typeof input.conversationRef === 'string' && input.conversationRef.trim() ? input.conversationRef.trim() : null;
  const artifacts = loadArtifacts(runId, ids);
  if (artifacts.some(item => item.context_version_id !== run.current_context_version_id)) {
    throw new AgentCoreError(409, 'EVIDENCE_CONTEXT_MISMATCH', 'Researcher conclusions require evidence from the current adopted context');
  }
  assertArtifactSourcesCurrent(runId, artifacts);
  const evidence = artifacts.map(item => ({ artifactId: item.id, actionId: item.action_id, stepId: item.step_id, sha256: item.sha256 }));
  const conclusionSha256 = sha256(stableJson({ runId, contextVersionId: run.current_context_version_id, summary, evidence, conversationRef }));
  const existing = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND idempotency_key = ?').get(runId, idempotencyKey) as any;
  if (existing) {
    const payload = JSON.parse(existing.payload_json);
    if (existing.category !== 'conclusion' || payload.conclusionSha256 !== conclusionSha256) {
      throw new AgentCoreError(409, 'CONCLUSION_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different event');
    }
    return { ...existing, payload };
  }
  return appendEvent(runId, {
    category: 'conclusion',
    eventType: 'researcher.conclusion_recorded',
    actorType: 'researcher',
    contextVersionId: run.current_context_version_id,
    payload: { summary, evidence, conclusionSha256 },
    idempotencyKey,
    source: 'codex_conversation',
    conversationRef,
  });
}

export function promoteConclusionToExperience(runId: string, input: {
  conclusionEventId: unknown;
  artifactIds: unknown;
  title: unknown;
  content: unknown;
  tags?: unknown;
  idempotencyKey: unknown;
  source: unknown;
  conversationRef?: unknown;
}) {
  assertCodexConversation(input.source);
  const run = runRow(runId);
  assertNoOpenReview(runId, run.status);
  const conclusionEventId = requiredText(input.conclusionEventId, 'conclusionEventId');
  const ids = artifactIds(input.artifactIds);
  const title = requiredText(input.title, 'title');
  const content = requiredText(input.content, 'content');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const conversationRef = typeof input.conversationRef === 'string' && input.conversationRef.trim() ? input.conversationRef.trim() : null;
  const tags = Array.isArray(input.tags) ? input.tags.map(item => String(item).trim()).filter(Boolean) : [];

  const event = db.prepare('SELECT * FROM run_events WHERE id = ?').get(conclusionEventId) as any;
  if (!event || event.run_id !== runId || event.category !== 'conclusion' || event.actor_type !== 'researcher' || event.source !== 'codex_conversation') {
    throw new AgentCoreError(409, 'RESEARCHER_CONCLUSION_REQUIRED', 'Promotion requires a researcher conclusion from the same run and Codex conversation');
  }
  if (event.context_version_id !== run.current_context_version_id) {
    throw new AgentCoreError(409, 'STALE_CONCLUSION', 'Conclusion belongs to an older context and cannot be promoted');
  }
  const conclusionPayload = JSON.parse(event.payload_json) as { evidence?: Array<{ artifactId: string; sha256: string }> };
  const boundEvidence = new Map((conclusionPayload.evidence ?? []).map(item => [item.artifactId, item.sha256]));
  const artifacts = loadArtifacts(runId, ids);
  if (artifacts.some(item => item.context_version_id !== run.current_context_version_id)) {
    throw new AgentCoreError(409, 'EVIDENCE_CONTEXT_MISMATCH', 'Experience promotion requires evidence from the current adopted context');
  }
  assertArtifactSourcesCurrent(runId, artifacts);
  for (const artifact of artifacts) {
    if (boundEvidence.get(artifact.id) !== artifact.sha256) {
      throw new AgentCoreError(409, 'CONCLUSION_EVIDENCE_MISMATCH', 'Promotion artifact is not hash-bound to the researcher conclusion');
    }
  }
  const stepIds = [...new Set(artifacts.map(item => item.step_id))];
  const promotionSummarySha256 = sha256(stableJson({ runId, contextVersionId: run.current_context_version_id, conclusionEventId, title, content, tags, evidence: artifacts.map(item => ({ id: item.id, sha256: item.sha256 })), conversationRef }));
  const existing = db.prepare(`
    SELECT experiences.*, experience_promotions.promotion_summary_sha256, 1 promoted
    FROM experience_promotions JOIN experiences ON experiences.id = experience_promotions.experience_id
    WHERE experience_promotions.run_id = ? AND experience_promotions.idempotency_key = ?
  `).get(runId, idempotencyKey) as any;
  if (existing) {
    if (existing.promotion_summary_sha256 !== promotionSummarySha256) {
      throw new AgentCoreError(409, 'EXPERIENCE_PROMOTION_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to a different Experience promotion');
    }
    return existing;
  }
  const experienceId = newId('exp');
  const timestamp = now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO experiences (
        id, title, content, tags, related_project_id, related_task_id,
        related_step_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(experienceId, title, content, JSON.stringify(tags), run.project_id, run.task_id, stepIds.length === 1 ? stepIds[0] : null, timestamp, timestamp);
    db.prepare(`
      INSERT INTO experience_promotions (
        experience_id, run_id, context_version_id, conclusion_event_id,
        idempotency_key, promotion_summary_sha256, conversation_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(experienceId, runId, run.current_context_version_id, conclusionEventId, idempotencyKey, promotionSummarySha256, conversationRef, timestamp);
    const insertArtifact = db.prepare('INSERT INTO experience_promotion_artifacts (experience_id, artifact_id, action_id, artifact_sha256) VALUES (?, ?, ?, ?)');
    for (const artifact of artifacts) insertArtifact.run(experienceId, artifact.id, artifact.action_id, artifact.sha256);
    appendEvent(runId, {
      category: 'decision', eventType: 'experience.promoted', actorType: 'researcher',
      payload: { experienceId, conclusionEventId, artifactIds: ids, promotionSummarySha256 },
      source: 'codex_conversation', conversationRef,
    });
  })();
  return db.prepare('SELECT experiences.*, 1 promoted FROM experiences WHERE id = ?').get(experienceId);
}
