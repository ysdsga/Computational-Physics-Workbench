# Tasks, workflows and Research Runs

English | [中文](TASKS.md)

A Task is a scientific objective within a Project; it is not an individual scheduler Job.

```text
Project
  Task
    Research Plan + independent core Workflow
    Research Run
      Task Spec: Confirmed Envelope + Working Plan
      Stage
        routine Events
        milestone Actions
          zero / one / many Jobs
          Artifacts and Evidence
```

## Task roots and workflow snapshots

Task creation stores `workflow_id`, copies the template into `workflow_snapshot` and assigns `task_root_rel`. Only the Task root is created. Renaming a Task does not move it or rename the resolved root; API changes cannot silently move research data. Legacy roots are backfilled only when an unambiguous existing directory can be resolved. Otherwise `task_root_unresolved: true` blocks execution until an explicit root binding is supplied through the supported API.

Global template edits affect future Tasks. Task workflow edits affect only that snapshot. Keep workflow nodes limited to scientific stages, software conversions, key checks and completion evidence. Ordinary diagnostics/transfers belong in Events; scan/retry batches can be Actions without growing the workflow graph.

## Runs and authorization

A Task has at most one open Run (`draft`, `active` or `waiting_researcher`). Draft validation checks Project/Research Plan ownership, core stages, valid capabilities, positive resource limits and any required HPC profile/Task binding.

The Envelope records scientific commitments, permitted methods/software/capabilities, HPC profile, per-job/concurrency/retry limits, protected Task-relative paths, completion evidence, researcher gates and in-boundary agent autonomy. The researcher confirms the exact normalized SHA-256 once in the Codex conversation; the ledger stores a summary, timestamp and optional conversation reference. A Web Task, draft or plan is not execution authorization.

The Working Plan stores the current stage, layout, next Actions and diagnostic strategy. In-boundary updates append decision Events and idempotency keys without changing the Envelope revision. Changes to scientific commitments or execution limits require a researcher pending item and revised confirmation.

Theoretical workflows use stage reflections: `stay` continues the stage, `loop` returns to the earliest affected stage and invalidates downstream closure, and `proceed` closes/advances. Preserve the original `scientificGoal` and explicit idea lifecycle; an unfinished high-value route cannot be hidden by omitting it from later records. See [theoretical research requirements](../skills/workbench-agent/references/theoretical-research.md).

## Actions, Jobs and evidence

Generic executable capabilities are `local.process`, `remote.inspect`, `remote.task-root.create`, `files.upload`, `files.download`, `job.submit` and `job.cancel`. Read `workbench execution contract` for current schemas before preparing a spec. Routine remote session commands/transfers need no Action and still append Events.

An Action binds a Run, stage, optional step, action type, immutable spec, SHA-256 and idempotency key; it may reference a parent or retry source. Scientific retries use a single `retry_of_action_id` chain and server-computed `retry_attempt`, bounded by `maxAutomaticRetries`. New inputs require a new Action, not an overwritten spec.

Actions begin `ready`, pass through `executing` and possibly `waiting_remote`, `waiting_codex` or `waiting_researcher`, and terminate as `succeeded`, `failed` or `cancelled` according to the allowed transition graph. Jobs retain their Run, stage and originating Action. Uncertain scheduler responses only permit reconciliation, not resubmission.

Artifacts are `valid`, `suspect`, `invalid` or `superseded`; retain old files and `superseded_by_id` provenance after corrections. Evidence records the validator/version, pass/warn/fail result and limitations. These bookkeeping checks do not certify scientific truth.

## Monitoring and pending items

The first nonterminal remote Job requires one Run monitor. `required` means an automation needs creation/recovery; `scheduled` records a verified active attachment; `complete` with `automation_ref` still present means automation deletion must be acknowledged. Tick checks due Jobs and returns lifecycle directives without resubmitting. After deletion succeeds, `monitor close` clears the reference. See [monitoring protocol](../skills/workbench-agent/references/monitoring.md).

`audience=codex` covers in-boundary troubleshooting and recovery. `audience=researcher` covers scientific or boundary decisions. `detail.blocksRun=true` can be stage-specific, allowing unrelated stages to proceed where permitted.

Remote user/project roots are read-only scopes; Task write roots are direct child directories of project roots and constrain uploads, creation and Job working directories. The Web edits metadata and observes records, but does not submit, cancel, confirm or reconcile.

Projects, Tasks and Research Plans with Run history cannot be physically deleted; archive them. Events have no update/delete interface. Tests use disposable databases and directories. See the detailed English [data dictionary](../doc/DATA_DICTIONARY.en.md) and [API inventory](../doc/API_REFERENCE.en.md), each linked to its Chinese counterpart. Read the CLI execution contract for executable spec schemas.
