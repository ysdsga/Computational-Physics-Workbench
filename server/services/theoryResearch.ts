import crypto from 'node:crypto';
import fs from 'node:fs';
import db from '../db.js';
import type { GoalAssessment, ResearchMap, ResearchRouteSearch, ScientificGoal, StageReflection, StageReflectionIdea } from '../../src/types/index.js';
import { AgentCoreError } from './agentError.js';
import { resolveWithinRoot } from './pathSafety.js';

const answerTypes = ['explanation', 'prediction', 'no_go', 'conditional', 'diagnostic'];
function fail(code: string, message: string): never { throw new AgentCoreError(409, code, message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('THEORY_RESEARCH_INVALID', `${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail('THEORY_RESEARCH_INVALID', `${label} is required`);
  return value.trim();
}
function strings(value: unknown, label: string, required = false): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) fail('THEORY_RESEARCH_INVALID', `${label} must be an array of nonempty strings`);
  const result = [...new Set(value.map(item => item.trim()))];
  if (required && !result.length) fail('THEORY_RESEARCH_INVALID', `${label} must not be empty`);
  return result;
}

export function validateScientificGoal(value: unknown): ScientificGoal {
  const goal = object(value, 'scientificGoal');
  const accepted = strings(goal.acceptedAnswerTypes, 'acceptedAnswerTypes', true);
  if (accepted.some(item => !answerTypes.includes(item))) fail('THEORY_RESEARCH_INVALID', 'Unknown acceptedAnswerTypes');
  return {
    question: text(goal.question, 'scientificGoal.question'),
    successCriteria: strings(goal.successCriteria, 'successCriteria', true),
    insufficientOutcomes: strings(goal.insufficientOutcomes, 'insufficientOutcomes', true),
    acceptedAnswerTypes: accepted as ScientificGoal['acceptedAnswerTypes'],
  };
}

export function scientificGoalHash(goal: ScientificGoal): string {
  // Fixed field order also works for envelopes deserialized from canonical JSON.
  return crypto.createHash('sha256').update(JSON.stringify(validateScientificGoal(goal))).digest('hex');
}

export function validateRouteSearch(value: unknown): ResearchRouteSearch {
  const search = object(value, 'routeSearch');
  if (!Array.isArray(search.directions) || !search.directions.length) fail('RESEARCH_ROUTE_SEARCH_REQUIRED', 'Record the directions actually explored, even when no candidate survived');
  return {
    directions: search.directions.map(item => {
      const direction = object(item, 'direction');
      if (!['longitudinal', 'horizontal', 'failure_driven', 'independent'].includes(String(direction.axis))) fail('THEORY_RESEARCH_INVALID', 'Unknown exploration axis');
      return { axis: direction.axis as ResearchRouteSearch['directions'][number]['axis'], question: text(direction.question, 'direction.question'), rationale: text(direction.rationale, 'direction.rationale') };
    }),
    learned: text(search.learned, 'routeSearch.learned'),
    nextQuestions: strings(search.nextQuestions ?? [], 'routeSearch.nextQuestions'),
  };
}

export function validateGoalAssessment(value: unknown, goal: ScientificGoal): GoalAssessment {
  const review = object(value, 'goalAssessment');
  if (review.goalSha256 !== scientificGoalHash(goal)) fail('SCIENTIFIC_GOAL_MISMATCH', 'Assess the confirmed scientific goal, not a substituted question');
  if (!['unanswered', 'partial', 'answered'].includes(String(review.status))) fail('THEORY_RESEARCH_INVALID', 'Unknown goal assessment status');
  if (!answerTypes.includes(String(review.answerType))) fail('THEORY_RESEARCH_INVALID', 'Unknown answerType');
  if (!Array.isArray(review.criteria)) fail('THEORY_RESEARCH_INVALID', 'goalAssessment.criteria must be an array');
  const criteria = review.criteria.map(item => {
    const criterion = object(item, 'criterion');
    if (typeof criterion.satisfied !== 'boolean') fail('THEORY_RESEARCH_INVALID', 'criterion.satisfied must be boolean');
    return { criterion: text(criterion.criterion, 'criterion'), satisfied: criterion.satisfied, explanation: text(criterion.explanation, 'criterion.explanation'), evidenceRefs: strings(criterion.evidenceRefs ?? [], 'criterion.evidenceRefs') };
  });
  if (criteria.length !== goal.successCriteria.length || new Set(criteria.map(item => item.criterion)).size !== criteria.length || criteria.some(item => !goal.successCriteria.includes(item.criterion))) {
    fail('SCIENTIFIC_GOAL_CRITERIA_MISMATCH', 'Address every original success criterion exactly once');
  }
  const remainingGaps = strings(review.remainingGaps ?? [], 'remainingGaps');
  if (review.status === 'answered') {
    if (!goal.acceptedAnswerTypes.includes(review.answerType as GoalAssessment['answerType'])) fail('SCIENTIFIC_ANSWER_TYPE_INSUFFICIENT', 'A conditional or diagnostic result cannot replace the confirmed kind of scientific answer');
    if (remainingGaps.length || criteria.some(item => !item.satisfied || !item.evidenceRefs.length)) fail('SCIENTIFIC_GOAL_NOT_ANSWERED', 'An answered goal requires all original criteria, evidence and no remaining causal gaps');
  } else if (!remainingGaps.length) fail('SCIENTIFIC_GOAL_GAP_REQUIRED', 'Name what still separates the partial work from the original scientific goal');
  return { goalSha256: review.goalSha256 as string, status: review.status as GoalAssessment['status'], answer: text(review.answer, 'answer'), answerType: review.answerType as GoalAssessment['answerType'], criteria, remainingGaps };
}

/** Task-wide, append-only event provenance; closed routes remain visible across Runs. */
export function buildResearchMap(taskId: string): ResearchMap {
  const runs = db.prepare(`SELECT r.* FROM research_runs r WHERE r.task_id = ? AND r.envelope_confirmed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.event_type = 'run.archived_invalid') ORDER BY r.created_at, r.id`).all(taskId) as Array<{ id: string; confirmed_envelope_json: string }>;
  const result: ResearchMap = { scientificGoal: null, goalSha256: null, goalRunId: null, routes: [], searches: [] };
  const routes = new Map<string, ResearchMap['routes'][number]>();
  for (const run of runs) {
    const envelope = JSON.parse(run.confirmed_envelope_json);
    if (envelope.scientificGoal) {
      result.scientificGoal = validateScientificGoal(envelope.scientificGoal);
      result.goalSha256 = scientificGoalHash(result.scientificGoal);
      result.goalRunId = run.id;
    }
    const events = db.prepare("SELECT id, payload_json FROM run_events WHERE run_id = ? AND event_type = 'stage.reflection' ORDER BY sequence").all(run.id) as Array<{ id: string; payload_json: string }>;
    for (const event of events) {
      const reflection = JSON.parse(event.payload_json) as StageReflection;
      if (reflection.routeSearch) result.searches.push({ runId: run.id, eventId: event.id, stageId: reflection.stageId, search: reflection.routeSearch });
      for (const idea of reflection.ideas ?? []) {
        const id = idea.id || `legacy:${idea.idea.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
        const previous = routes.get(id);
        routes.set(id, { ...previous, ...idea, id, runId: run.id, eventId: event.id, stageId: reflection.stageId, historyEventIds: [...(previous?.historyEventIds ?? []), event.id] });
      }
    }
  }
  result.routes = [...routes.values()];
  return result;
}

export function validateGoalContinuity(taskId: string, goal: ScientificGoal, change: unknown, previous?: ScientificGoal): { previousGoalSha256: string; reason: string } | undefined {
  const prior = previous ?? buildResearchMap(taskId).scientificGoal;
  if (!prior || scientificGoalHash(prior) === scientificGoalHash(goal)) return undefined;
  const revision = object(change, 'scientificGoalChange (an explicit researcher-confirmed goal revision is required)');
  if (revision.previousGoalSha256 !== scientificGoalHash(prior)) fail('SCIENTIFIC_GOAL_MISMATCH', 'Goal revision must cite the previous confirmed goal hash');
  return { previousGoalSha256: revision.previousGoalSha256 as string, reason: text(revision.reason, 'scientificGoalChange.reason') };
}

export function validateRouteMemory(ideas: StageReflectionIdea[], map: ResearchMap): void {
  const known = new Map(map.routes.map(item => [item.id, item]));
  const ids = new Set<string>();
  for (const idea of ideas) {
    if (!idea.id || ids.has(idea.id)) fail('RESEARCH_ROUTE_ID_REQUIRED', 'Every route needs a unique stable id; reuse it when revising that route');
    ids.add(idea.id);
    const previous = known.get(idea.id);
    if (previous && previous.idea !== idea.idea) fail('RESEARCH_ROUTE_REDEFINED', 'Do not replace a route question in place; create a child route with parentIdeaIds');
    for (const parent of idea.parentIdeaIds ?? []) if (parent === idea.id || !known.has(parent)) fail('RESEARCH_ROUTE_PARENT_INVALID', 'A child route must reference an earlier recorded route');
    if (['resolved', 'falsified'].includes(idea.disposition) && !idea.learning?.trim()) fail('RESEARCH_ROUTE_LEARNING_REQUIRED', 'Closing a route must preserve what was learned and the failure/validity boundary');
    known.set(idea.id, { ...idea, id: idea.id, runId: '', eventId: '', stageId: '', historyEventIds: [] });
  }
}

export function assertResearchEvidence(refs: string[], taskId: string, taskRoot: string): void {
  for (const original of refs) {
    const ref = original.split('#')[0];
    if (ref.startsWith('evidence-')) {
      const row = db.prepare(`SELECT e.status, a.validity, a.path, a.location, a.sha256, e.artifact_id FROM evidence_checks e
        JOIN research_runs r ON r.id = e.run_id LEFT JOIN run_artifacts a ON a.id = e.artifact_id
        WHERE e.id = ? AND r.task_id = ? AND NOT EXISTS (SELECT 1 FROM run_events x WHERE x.run_id = r.id AND x.event_type = 'run.archived_invalid')`).get(ref, taskId) as any;
      if (!row || row.status !== 'pass' || (row.artifact_id && row.validity !== 'valid')) fail('RESEARCH_EVIDENCE_INVALID', `Missing, failed, invalid or foreign evidence: ${original}`);
      if (row.artifact_id) assertArtifactFile(row, taskRoot, original);
    } else if (ref.startsWith('artifact-')) {
      const row = db.prepare(`SELECT a.* FROM run_artifacts a JOIN research_runs r ON r.id = a.run_id WHERE a.id = ? AND r.task_id = ?
        AND NOT EXISTS (SELECT 1 FROM run_events x WHERE x.run_id = r.id AND x.event_type = 'run.archived_invalid')`).get(ref, taskId) as any;
      if (!row || row.validity !== 'valid') fail('RESEARCH_EVIDENCE_INVALID', `Missing, invalid or foreign artifact: ${original}`);
      assertArtifactFile(row, taskRoot, original);
    } else {
      const resolved = resolveWithinRoot(taskRoot, ref, { allowRoot: false, label: 'research evidence' });
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail('RESEARCH_EVIDENCE_INVALID', `Evidence file does not exist: ${original}`);
    }
  }
}

function assertArtifactFile(artifact: { location: string; path: string; sha256: string }, taskRoot: string, ref: string): void {
  if (artifact.location !== 'local') return;
  const resolved = resolveWithinRoot(taskRoot, artifact.path, { allowRoot: false, label: 'research artifact' });
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile() || crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex').toLowerCase() !== artifact.sha256.toLowerCase()) {
    fail('RESEARCH_EVIDENCE_INVALID', `Research artifact is missing or changed: ${ref}`);
  }
}
