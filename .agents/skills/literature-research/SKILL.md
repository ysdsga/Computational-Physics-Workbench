---
name: literature-research
description: Systematically research scholarly literature, map evidence and competing explanations, identify the closest prior work, and audit scientific novelty. Use for 文献调研、研究现状、相关工作、创新性检查、最近邻文献、引文追踪、理论或实验约束综述; do not use for casual recommendations or a single known-paper summary.
---

# Literature Research

Aim for **decision-complete coverage**, not an impossible claim that every paper has been found. The result must be sufficient to constrain the scientific problem, expose competing explanations, and justify or revise each proposed novelty claim.

## Workflow

1. Convert the research question into explicit claims and decisions: what mechanism, observable, model or material class, method, regime, and novelty assertion must the literature establish?
2. Read [references/coverage-protocol.md](references/coverage-protocol.md). Build terminology and search axes before concluding that a result is absent from the literature.
3. Use more than one independent discovery route: direct concept searches, backward and forward citation chasing, author or research-line tracing, and searches for competing mechanisms or negative results.
4. Prefer original papers and authoritative primary records. Use reviews as maps, then verify decisive claims against the cited primary work.
5. Record claim-level evidence in a literature matrix. Distinguish full-text verification, abstract-only support, metadata-only discovery, inference, and inaccessible sources.
6. For every proposed central contribution, identify the strongest closest prior work and classify the relation as `known`, `partial`, `new`, or `conflict`. Do not label a contribution novel without this comparison.
7. Stop only when the semantic saturation criteria in the reference are met. Record the directions searched even when they yielded no new category of evidence.
8. Reopen the audit whenever the model, mechanism, central conclusion, or claimed scope materially changes. A novelty assessment is tied to the actual final claim, not merely the initial idea.

## Unavailable literature

When a relevant full text is non-open-access or publisher-restricted, invoke `$instsci` for the retrieval attempt when available. Do not pause the rest of the research while one paper is unavailable. Continue with independent sources and add the DOI, required evidence, attempted route, and scientific impact to the pending-literature record.

Never silently promote a search snippet, citation context, or abstract into full-text evidence. If the unavailable paper could overturn a central novelty claim, keep that claim provisional until the paper is verified or equivalent independent evidence resolves it.

## Deliverables

Adapt filenames to the research task, but preserve these logical artifacts:

- a literature evidence matrix linking papers to claims, methods, systems, support or conflict, access level, and limitations;
- a closest-prior-work and novelty audit for every central contribution;
- a constraints summary separating established facts, live disputes, and unresolved gaps;
- a pending-literature list for unavailable or insufficiently verified sources;
- a concise coverage note explaining why the search is saturated enough for the current decision.
