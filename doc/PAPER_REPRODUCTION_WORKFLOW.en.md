# Physics Literature Reproduction Workflow

English | [中文](物理文献复现工作流.md)

## Purpose

Physics literature reproduction is a general core workflow for papers on analytical theory, numerical models, and real-material calculations. It does not treat a successful program exit as reproduction of a paper's conclusions. It organizes the work around four objects:

1. Target claims that can be located in the paper.
2. Conditions that permit a fair comparison.
3. An evidence chain from sources and parameters through execution to verdicts.
4. Conclusions the researcher ultimately permits the project to report publicly.

Paper-specific models, parameters, tolerances, software, and run matrices belong in the Research Plan and Working Plan, rather than being fixed in the generic workflow template.

This guide corresponds to the stable workflow ID `physics-literature-reproduction`. The current [built-in template](../src/data/workflows.ts) has 8 stages and 27 steps, including 3 optional steps for different methodological tracks. At runtime, templates in the database are authoritative, and existing tasks use their own workflow snapshots. Documentation and built-in defaults do not automatically overwrite user changes. The English interface translates only display fields that still match the built-in source text; it preserves IDs, task snapshots, commands, and researcher-authored content.

## Two independent reproduction dimensions

Reproduction depth and independence must not be collapsed into a single ranking.

Choose the reproduction depth:

- **Runnability:** check whether the author's artifacts or methodological entry point run in a recorded environment.
- **Core mechanism:** reconstruct the essential derivation, algorithm, or calculation chain that determines the result.
- **Key claims:** reproduce a predefined selection of equations, figures, tables, trends, phase boundaries, or mechanistic conclusions.
- **Complete results:** reproduce the full result set within the agreed scope of the paper.
- **Future baseline:** after reproducing the key claims, freeze the artifacts as a comparison baseline for new research.

Choose the independence mode separately:

- **Rerun author artifacts:** use the author's code, data, or scripts.
- **Independent reconstruction:** rederive or reimplement the work from the paper and methodological sources.
- **Cross-validation of both routes:** retain both the rerun and independent reconstruction, and compare key intermediate quantities.

For example, “key claims + rerun author code” and “key claims + independent reconstruction” provide different strengths of evidence and cannot substitute for each other.

## Eight-stage core workflow

| Stage (stable ID) | Core question | Main completion evidence |
|---|---|---|
| Scope and criteria (`scope`) | Which paper version, why reproduce it, to what depth, and what may be claimed? | Paper identity, reproduction scope, completion criteria, and claim boundaries |
| Claim decomposition (`claims`) | Which equations, figures, tables, trends, or mechanisms will be tested? | Claim ledger, dependency map, and methodological tracks |
| Resources and provenance (`resources`) | Are key sources, parameters, and information gaps traceable? | Resource manifest, hashes, parameter provenance, and ambiguity ledger |
| Executable specification (`specification`) | How can the paper become an unambiguous, executable plan with clear acceptance criteria? | Observable definitions, track specifications, and a claim–run–evidence matrix |
| Minimal end-to-end pilot (`pilot`) | Are the environment, postprocessing, and a minimal claim path trustworthy? | Environment lock, pipeline tests, and pilot report |
| Full reproduction (`reproduction`) | Was the frozen protocol followed and the complete history preserved? | Run manifest, raw-results index, and deviation/retry records |
| Comparison and validation (`validation`) | Are results correct, independent, and comparable, and what explains discrepancies? | Physical checks, independent validation, comparability audit, and verdicts per claim |
| Packaging and conclusions (`release`) | Can others audit and rerun the work, and do the conclusions stay within the evidence? | Evidence index, reproduction package, report, and researcher review |

The three methodological specification steps are optional branches, but a task should select at least one applicable branch. Mixed papers may require several:

- **Analytical theory (`repro-spec-theory`):** assumptions, lemmas, equations, approximation orders, regularization, analytic continuation, controlled limits, and independent derivations.
- **Numerical models (`repro-spec-model`):** model, lattice and boundaries, algorithm, system sizes and scans, randomness, error estimation, and finite-size or truncation treatment.
- **Real materials (`repro-spec-material`):** structure, electronic-structure method, pseudopotentials or basis, exchange-correlation treatment, k/q meshes, low-energy subspace, interactions and double counting, solver, and postprocessing.

Selecting at least one applicable branch is a Research Plan and acceptance responsibility; the current `optional` flags do not automatically enforce this rule. Record the selected branches and the claims they support, and explain why other branches do not apply. Do not execute every branch without justification. Output filenames in the template describe suggested evidence artifacts. Marking a step complete neither generates those files nor proves that its evidence is valid.

## Minimum claim-ledger fields

The recommended minimum fields in `claim_ledger.csv` are:

```text
claim_id, paper_location, claim_type, statement, conditions,
target_observable, paper_value_or_pattern, acceptance_rule,
required_evidence, excluded_evidence, status
```

Use `equation`, `figure`, `table`, `scaling`, `phase_boundary`, `trend`, `mechanism`, or a task-defined value for `claim_type`. Split a figure containing several physical claims into separate claims. When several figures share upstream data, explicitly connect them in the dependency map.

## Parameter provenance and ambiguity

For each choice in `parameter_provenance.csv`, record a provenance category:

- `explicit`: stated in the paper or supplementary material.
- `derived`: unambiguously derivable from the paper.
- `code`: extracted from the author's code or configuration.
- `cited`: obtained from another source explicitly cited by the paper.
- `inferred`: inferred from context.
- `chosen`: selected specifically for this reproduction.

The last two categories require a rationale and a sensitivity-risk assessment. If a critical ambiguity could change a target conclusion, raise it at a researcher decision point or reduce the reproduction scope. Do not conceal it through post-hoc parameter tuning.

## Source and validation evidence boundaries

During resource collection, follow the project's [literature-research protocol](../skills/literature-research/SKILL.md) to verify the paper, supplements, errata, author code, and data. Preserve versions or commits, licenses, access dates, and file hashes. Do not conflate a preprint, published version, and later revision. Distinguish full-text verification, abstract-only support, metadata-only discovery, inference, and unavailable sources. Secondary accounts or search snippets cannot replace key primary evidence. If missing information could change a central claim, keep that claim provisional and record the affected claims and next step.

When the analytical track needs computational assistance, follow the [theory-derivation protocol](../skills/theory-derivation/SKILL.md). Retain a readable derivation, assumptions, inputs, outputs, and tool versions, and independently check key conclusions when feasible. Distinguish analytical results, computer-assisted derivations, numerical evidence, and unverified conjectures. Success at finitely many sample points is not a general proof.

The pilot may use synthetic data, known limits, or hand-worked examples to test unit conversion, statistics, plotting, and postprocessing. A mock scheduler, API fixture, passing test, or successful program exit establishes only the software behavior actually tested. It does not establish live-cluster availability, DFT/DMFT physical correctness, or reproduction of a paper's claims. Reports must distinguish checks that actually passed, failed, were not run, or were blocked by missing cluster access, accounts, resources, or sources. Quick convergence plots after an ordinary calculation do not replace formal acceptance checks required by the frozen reproduction protocol.

Before comparing results, audit versions, methods, parameters, units, finite-size effects, convergence, random and systematic errors, digitization errors, and postprocessing definitions. Retain all iteration or scan histories, raw results, and failed checks, rather than only favorable intervals or final figures. If independent validation is unavailable, explicitly describe evidence dependence and remaining risks.

## Verdicts for individual claims

- **Reproduced:** the predefined comparable conditions and acceptance rules are satisfied.
- **Partially reproduced:** some evidence holds, but there are explicit gaps in values, scope, uncertainty, or the mechanism's argument.
- **Not reproduced:** under comparable conditions, the predefined acceptance rules are not satisfied.
- **Inconclusive due to insufficient conditions:** sources, parameters, data, or methodological conditions do not permit a fair verdict.

A task or job marked “completed” describes execution status; it does not automatically establish any of these scientific verdicts. Matching trends, matching values, and support for a mechanism are different evidence levels. Visual resemblance between curves or a single fit cannot establish a mechanistic claim.

## Recommended Research Plan contents

1. Paper identity, reproduction motivation, and relationship to the current research.
2. Reproduction depth, independence mode, and explicit inclusions and exclusions.
3. Target claim ledger and priorities.
4. Methodological specifications, parameter provenance, and unresolved ambiguities.
5. Claim–run–evidence matrix, tolerances, controls, and repetition strategy.
6. Resource and software boundaries, HPC budget, researcher decision points, and protected paths.
7. Failure, scope-reduction, and termination rules.
8. Permissible levels of publicly reported conclusions and completion evidence.

New ideas, additional parameter scans, and scientific extensions beyond the paper should enter separate follow-up tasks. This prevents post-hoc scope expansion from contaminating the original reproduction verdicts.

## Execution, corrections, and release

For real research tasks, follow the [workbench-agent protocol](../skills/workbench-agent/SKILL.md) and [project guide](../AGENTS.en.md). Before first execution, explain the scientific commitments, resources, researcher decision points, and completion evidence in the Research Plan, core Workflow, and Task Spec within the Codex conversation. Show the exact Confirmed Envelope and its hash and obtain explicit confirmation. Web pages support observation and ordinary metadata management; they are not authorization, submission, cancellation, or reconciliation entry points.

After confirmation, proceed autonomously and revise the Working Plan inside the Envelope without per-command or per-Action approvals. Record ordinary commands, connections, transfers, and temporary diagnostics as Events. Record scientific milestones requiring durable provenance—such as formal submission/cancellation, multi-run batches, and evidence validation—as Actions. Do not add workflow nodes for every attempt. Follow the same Agent protocol for remote submissions, monitoring, and cleanup after terminal jobs. An uncertain submission response requires reconciliation using the recorded job identity; never resubmit to discover what happened.

Corrections after freezing the reproduction protocol must record their reason, impact, and version. Changes that expand scientific commitments, methods/software, resources, permissions, or protected paths require a researcher pending item and renewed Envelope confirmation. For corrections within the boundary, perform the smallest necessary recomputation and explicitly mark affected artifacts `valid`, `suspect`, `invalid`, or `superseded`. Never silently overwrite provenance. Connection, environment, and transfer failures do not consume the scientific retry budget. A replacement for a failed scientific calculation must explicitly bind `retry_of_action_id` and respect `maxAutomaticRetries`.

The release package should include auditable derivations or code, environment records, input and source manifests, a machine-readable run matrix, raw and processed results, minimal rerun commands, and a README. If licensing or size prevents bundling a resource, retain retrieval instructions, hashes, and limitations. The report must cite valid evidence per claim, distinguish success, partial success, non-reproduction, and inconclusive results, and explain discrepancies and open questions. The researcher must review and confirm conclusions that may be reported publicly. The Agent cannot turn execution completion or its own inference into a recorded researcher conclusion.
