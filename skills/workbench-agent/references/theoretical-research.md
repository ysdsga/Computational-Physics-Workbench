# Theoretical research: keep the question, learn from routes

The stable target is the scientific question, not the current candidate mechanism. Retain the eight core stages. Use the context stage to generate routes even when none is obvious; use model/baseline to simplify or rebuild the physical argument; derivation/validation produces information; interpretation compares that information with the original question. A failed route, a known mechanism or a conditional result returns to this loop rather than automatically to release.

## Goal in the confirmed Envelope

New `theoretical-research` drafts with `explorationReviewRequired: true` require:

```json
{
  "scientificGoal": {
    "question": "The original scientific question, not this round's checklist",
    "successCriteria": ["A concrete scientific answer the research must establish"],
    "insufficientOutcomes": ["A diagnostic or conditional statement that leaves the central mechanism assumed"],
    "acceptedAnswerTypes": ["explanation", "prediction", "no_go"]
  }
}
```

Allowed answer types also include `conditional` and `diagnostic` when these really are the researcher's objective. Do not add them to make existing work pass. A new draft inherits the same task goal. To revise it, include `scientificGoalChange: {previousGoalSha256, reason}` and explicitly show that difference with the new Envelope for confirmation. Existing confirmed Runs without this field retain their old contract; never retroactively rewrite their hashes or claim they passed the new standard.

## Persistent map and route learning

`workbench research-map show --task <id>` returns the confirmed goal, routes (including closed and failed ones), parent links, searches and source Run/event IDs across valid Runs. Historical raw reflections remain append-only. Invalid archived Runs do not supply scientific evidence. This map is memory, not proof of novelty.

Extend a reflection's `ideas` with a stable `id`. Preserve the question when updating its disposition. A genuinely different hypothesis gets a new id and `parentIdeaIds` referring to the route it grew from. Include `learning` when closing any route: which assumption failed, what was excluded and what was not. Use `nextQuestion` when the result suggests a follow-up; do not fabricate one for a decisive negative result.

At the context stage, record `routeSearch`:

```json
{
  "routeSearch": {
    "directions": [{"axis": "failure_driven", "question": "What prevented the previous mechanism?", "rationale": "Why resolving this could advance the original question"}],
    "learned": "What the actual investigation taught us, including unsuccessful searches",
    "nextQuestions": ["The question to pursue next"]
  }
}
```

Axes are `longitudinal`, `horizontal`, `failure_driven`, `independent`; no required counts or mandatory checklist of all axes. No surviving route means `stay` and further search, not `proceed` with an empty list. Searching need not mean browsing again: a new limit, physical analogy, model transformation or discriminating derivation may be the useful work. Record why the attempt differs from failed predecessors.

## Original-goal assessment, separate from route closure

At interpretation and final release, include:

```json
{
  "goalAssessment": {
    "goalSha256": "scientific_goal_sha256 returned with the Run",
    "status": "partial",
    "answer": "What is established so far",
    "answerType": "conditional",
    "criteria": [{"criterion": "Exact original success criterion", "satisfied": false, "explanation": "Which causal premise still has to be derived", "evidenceRefs": ["artifact-or-evidence-id"]}],
    "remainingGaps": ["The unresolved premise"]
  }
}
```

Statuses are `unanswered`, `partial`, `answered`. Repeat every original criterion exactly once. `answered` needs all criteria satisfied, existing task evidence, an accepted answer type, and no remaining central gaps. Evidence references may be task-local files (with optional fragments), registered valid artifacts, or passing evidence checks. Their existence/validity is checked; the Agent remains responsible for whether they actually support the claim. Software does not certify scientific truth or publication quality.

Use `reflection record` for assessments and stage transitions; ordinary Working Plan edits cannot overwrite these decisions. An `unanswered` or `partial` interpretation must `stay` or `loop`. Choose the earliest affected stage. Continue inside the existing Envelope without asking per-loop permission. At genuine resource or authorization limits, preserve partial work and use the existing researcher-pending mechanism rather than claiming completion. Absence of ideas is not such a limit.
