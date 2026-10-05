# Key design decisions

English | [中文](DECISIONS.md)

This document records currently effective decisions. Historical V1/V2 plans remain in `docs/plans/`; their Contract, layered Policy, immutable Context and per-Action authorization models were superseded by V3.

## 1. Codex is the Agent; Web is the review surface

Research discussion, planning, execution and correction take place in the project's Codex conversation. WebUI displays and filters records and manages ordinary metadata; it does not start, authorize, submit, cancel or reconcile Agent work. Real tasks use the `workbench-agent` skill. The `workbench` CLI provides state, boundaries, automatic logs and scheduler consistency, rather than approval for each command.

## 2. A Task is not a Job

The model is `Project → complex Task → Research Run → Stage → routine Event / milestone Action → Job`. Ordinary commands produce Events; a smaller set of scientific milestones uses Actions. An Action can have zero, one or many Jobs. Every Job is bound to its originating Action, Run and Stage.

## 3. Workflows retain the necessary scientific structure

A Workflow contains indispensable scientific/software stages, important conversions, checkpoints and completion evidence. Connections, transfers, diagnostics and temporary commands are Events. Scientific retries, scans and submission batches can be milestone Actions; they do not turn research execution into a rigid workflow node for every attempt.

## 4. Task Spec replaces Contract, Policy and parallel control files

A Task Spec has two parts:

- **Confirmed Envelope:** objective-critical scientific commitments, permitted capabilities/methods/software, HPC profile, resources, protected paths, completion evidence and researcher gates.
- **Working Plan:** current stage, directory layout, next Actions, diagnostics and retry strategy.

The database is the sole machine source for the Task Spec; CLI and Web render it. The current model no longer maintains `.workbench/contracts`, layered `agent_policies` or `run_context_versions`.

## 5. Confirm the Envelope once

Before first execution, Codex presents the Research Plan, Core Workflow, exact Envelope and hash to the researcher and obtains one explicit confirmation. Codex then plans and executes autonomously inside the Envelope without per-Action confirmation.

Expanding scientific commitments, methods/software, resources, permissions, protected paths or completion evidence requires a researcher Pending Item, an explanation of the impact and confirmation of the revised Envelope. Ordinary Working Plan changes do not require researcher approval.

## 6. Plans and workflows can be corrected; evidence cannot be silently rewritten

First determine the affected scope when an omission or error is found. Codex can revise and perform the smallest recomputation inside the boundary; changes outside it require discussion. Retain old Artifacts and mark them `valid | suspect | invalid | superseded`. Express replacements through provenance; never overwrite history to fabricate continuity.

## 7. Separate Codex pending items from researcher pending items

Environment problems, failure diagnosis, recovery, plotting and in-boundary correction go to `codex`. Materials-science choices, Envelope changes and ambiguous conclusions go to `researcher`. Scope a blocker to the affected Stage whenever possible. A researcher item with `detail.blocksRun=true` and no Stage blocks Actions in every Stage; a Stage-specific blocker should not freeze unrelated stages' Actions.

## 8. Codex chooses the directory layout inside a Task

Workbench fixes the Project working root and Task write root; it does not automatically create Stage directories. Codex may design a directory tree inside the Task for complex work. The HPC user root is read-only; uploads, directory creation and Job working directories are restricted to the bound Task write root.

## 9. The product does not register material-specific adapters

Executors provide material-independent capabilities and boundary validation. Material names, Task IDs, fixed steps, script paths, U/J, projection windows, meshes and solver parameters belong in project data or an individual Codex-generated Action spec. Adding a material or software route does not require changes to product execution code.

## 10. Task sessions handle routine execution; Actions record scientific milestones

After Envelope confirmation, `remote exec/upload/download` derives host/root automatically, operates within the registered boundary and appends Events without creating Actions. Direct local work also needs no Action. Scientific milestones such as submission/cancellation, multi-Job batches or evidence validation retain normalized specs, SHA-256, Stage and idempotency keys; capabilities with execution inputs also retain the relevant input snapshots. An Action records provenance, not permission for each small operation.

## 11. Remote submission must be recoverable

The Job row is recorded as `prepared` before `bsub`; its name derives from a stable token. After `bsub` returns a valid ID, the scheduler ID/name is checked immediately. A timeout, lost response or failed verification that leaves submission uncertain becomes `submission_uncertain` and creates a Codex pending item. Reconcile by the unique Job name; never resubmit while its state is uncertain. Pre-submission preparation failures and explicit scheduler rejection use `preparation_failed`; evidence that a Job was not accepted must be distinguished from an uncertain submission.

## 12. Separate evidence from experience

Evidence consists of Project/Task outputs that the researcher or Codex needs to inspect, download, process or plot; it stores file references, hashes, validity and validators. Experience records reusable conditions, symptoms, remedies and applicability boundaries. Codex captures a `candidate`, not a scientific conclusion; confirmed experience still retains its source Run/Artifact.

## 13. Schema v5 migration fails closed

The v5 migration first creates a backup, then checks the v4 runtime-control tables it would replace. Only if all are empty may it replace the old Policy/Context/Review/Promotion and other runtime tables, preserving Project/Task/Plan/Workflow/Experience. If any old runtime-control table contains records, startup is refused until an explicit conversion is designed. One earlier installation having no Run history does not imply that another user's database is empty.

## 14. What the current safety boundary means

Workbench enforces Task roots, HPC bindings, capabilities, resources, input hashes, idempotency and recovery rules at its own entry points. If the Unix account has broader permissions, operating-system isolation remains the responsibility of cluster ACLs, separate accounts or containers. Workbench does not replace system permissions.

## 15. Scheduled Tasks wake the Agent; the Stop Hook checks obligations

A long Job cannot depend on a single Codex turn staying alive. Codex should choose each Job's check policy from the actual calculation scale and retain it in the Action spec; older specs without a policy have a wall-time-derived fallback. Workbench computes the next due time and recommended heartbeat cadence. Each Run with nonterminal Jobs binds one heartbeat in the current conversation; it may be recorded as `scheduled` only after the Codex automation interface confirms ACTIVE status. A heartbeat lease detects attachments that have paused or stopped checking in.

After the final Job becomes terminal, Workbench returns a delete directive and retains the automation reference. Closure requires Codex to delete the automation and acknowledge it with `monitor close`. The Stop Hook checks missing, expired and pending-cleanup states; it does not poll, execute work or create a second Agent. If the same Hook has already fired, it warns rather than repeatedly blocking. If the service is unavailable, the Hook fails open and advises running `doctor` before the next research action.

## 16. Automatic retries require lineage and a budget

Replacing a failed scientific Job creates a new immutable Action rather than overwriting the failed one. It must carry `retry_of_action_id`, and each Action has at most one retry successor. The service computes `retry_attempt` and rejects attempts beyond the Envelope's `maxAutomaticRetries`. Connection, authentication, timeout, directory, inspection and transfer failures are operational Events and do not consume that scientific budget. `submission_uncertain` only permits reconciliation.

## 17. Theoretical research uses append-only stage reflections

Every core theoretical stage includes recording, reflection and a next-step decision; a Stage can have any number of reflections. `proceed` advances, `stay` continues the current Stage, and `loop` returns to the earliest Stage affected by a finding. Downstream completion must be re-established after a loop. Ideas and their dispositions remain in append-only `stage.reflection` Events, while the Working Plan retains the current position and next Actions. This prevents important questions or new ideas from silently disappearing; it does not automatically edit the separate Research Plan.
