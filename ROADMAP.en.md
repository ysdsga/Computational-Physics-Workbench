# Roadmap

English | [中文](ROADMAP.md)

> From a usable Codex + LSF research prototype toward reliable, scientifically informed, extensible infrastructure for computational and theoretical physics collaboration.

This is a statement of direction, not a release-date commitment. Priorities follow the cost of failures in real research: first prevent abandoned tasks and lost conclusions, then expand clients, compute platforms and physics methods.

The items below describe future improvements, not an absence of all related functionality. Task path boundaries, Run monitors/heartbeats, experience search and candidate capture, theoretical stage reflections, Research Plan metadata editing, and English/Chinese user entry points already exist. The roadmap distinguishes those foundations from work still to be done.

## P0 · Keep research progressing reliably

- **Long-running tasks that continue:** a Job ending does not mean the Task is finished. Improve Working Plan recovery, excessive queue-wait checks, heartbeat lifecycle and exceptional-state reconciliation so that research does not quietly stop when a Job closes.
- **Safe isolation:** detect and handle unclean working directories. Separate research execution environments from Workbench source-development environments so a research Agent does not accidentally modify the product backend.
- **Reliable startup and access:** `node bin/workbench.js` already avoids a global PATH dependency. Default CORS permits only localhost/127.0.0.1 development origins on port 5173; production pages require an explicit `WORKBENCH_ALLOWED_ORIGINS` list, which replaces the defaults. Improve the optional `workbench` command's PATH/environment-refresh experience and self-diagnostics, and clearly explain origin-configuration errors. Changes to the default-origin policy remain subject to separate review and are not a completed feature of this adaptation.
- **Parallel work and scale:** validate directory, Job, monitor and ledger isolation across parallel Tasks/Runs. Add pagination, incremental loading and performance baselines for large Event, Artifact and Evidence collections.

## P0 · Build durable scientific memory

- **Scientific claim ledger:** introduce Claims as explicit domain records that directly connect physical claims, supporting/opposing evidence, Artifacts, Runs, applicable conditions and current validity. Important results should not remain buried in reports and timelines.
- **Experience feedback loop:** actively retrieve applicable experience before planning or diagnosis, form candidates after validation, and handle duplication, conflicts, invalidation and scope so the same failures do not keep recurring.
- **Maintainable knowledge foundation:** build authoritative knowledge and judgment-criteria collections with provenance, updates and auditability. Keep external facts, Agent inferences and researcher conclusions distinct.

## P1 · Make the reference path extensible

- **Compute-device and scheduler adapters:** retain the multiple-device/profile and Task-binding model, extract a stable interface from the LSF implementation, then support Slurm, PBS and other schedulers through the same contract. Publish a compatibility matrix backed by real tests.
- **Agent-client adapters:** use Codex as the reference implementation and add skills, hooks, long-job wake-ups, permissions and recovery tests for clients such as Claude Code, WorkBuddy and DeepSeek Harness. Being able to call the API does not establish official compatibility.
- **File-based workflow cards:** move beyond registering templates in source code toward startup discovery of `workflows/*.json|yaml`, with schema validation, version migration, ID-conflict handling and failure isolation. A community contributor should be able to add a usable workflow file.
- **Explicit capabilities:** represent theoretical derivation, symbolic computation, literature retrieval and advanced physics toolkits as Task Spec capabilities instead of relying on undeclared Agent-environment abilities.

## P2 · Extend scientific reasoning and physics capabilities

- **Stronger theoretical research loops:** the current theoretical workflow and `literature-research` skill already require closest-prior-work and literature-coverage review. Make those gates more visible and better connected to the research question, and add a time-bounded, pausable deep-exploration mode with reflection records rather than unbounded thinking time.
- **Specialist tool environments:** provide discoverable, reproducible, on-demand configurations for symbolic algebra, group theory, tensor networks, numerical integration and other tools, recording versions and applicability boundaries.
- **More many-body methods:** add workflows such as DMFT vertex calculations and cluster DMFT after validation on real cases. Parameters, approximations and physical judgments continue to belong in the Research Plan, not in executor code.
- **Research Plan experience:** improve discoverability of the existing metadata-editing and small Markdown-revision entry points. Show cross-Run lineage, Envelope revisions and their effects on conclusion validity more clearly.

## Contributions we especially welcome

- Minimal reproducible cases of interrupted research, lost experience, parallel-write conflicts or slow handling of large datasets.
- Contracts and end-to-end tests for new scheduler or Agent adapters.
- Claim–Evidence data models, scientific-memory retrieval and conflict-resolution designs.
- Material-independent computational/theoretical physics workflow cards validated in real research.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a feature. Small, complete and reversible contributions with failure reproductions and validation evidence receive priority.
