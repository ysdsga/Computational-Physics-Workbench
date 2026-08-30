import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import TheoryResearchPanel from '../src/components/TheoryResearchPanel';
import type { ResearchMap } from '../src/types';

// The root test tsconfig uses classic JSX while Vite uses the automatic runtime.
Object.assign(globalThis, { React });

test('theory panel keeps partial goals and failed learning visible, including legacy caveat', () => {
  const map: ResearchMap = { scientificGoal: { question: 'Original physical question', successCriteria: ['Derive the mechanism'], insufficientOutcomes: ['Only diagnostics'], acceptedAnswerTypes: ['explanation'] }, goalSha256: 'hash', goalRunId: 'run-1', routes: [{ id: 'failed-route', idea: 'A scalar mechanism', significance: 'Mechanism test', disposition: 'falsified', reason: 'Symmetry forbids the response', evidenceRefs: ['proof.md'], learning: 'Only the scalar limit is excluded', nextQuestion: 'Try an orbital-resolved model', runId: 'run-1', stageId: 'model', eventId: 'event-1', historyEventIds: ['event-1'] }], searches: [] };
  const html = renderToStaticMarkup(createElement(TheoryResearchPanel, { map, assessment: { goalSha256: 'hash', status: 'partial', answer: 'Only a necessary condition', answerType: 'conditional', criteria: [], remainingGaps: ['Missing causal source'] } }));
  assert.match(html, /Original physical question/);
  assert.match(html, /目标未达成/);
  assert.match(html, /Missing causal source/);
  assert.match(html, /Only the scalar limit is excluded/);
  assert.match(html, /Try an orbital-resolved model/);
  assert.match(renderToStaticMarkup(createElement(TheoryResearchPanel, { map: { ...map, scientificGoal: null } })), /历史 completed 状态不代表/);
});
