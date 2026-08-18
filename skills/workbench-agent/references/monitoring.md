# Long-job monitoring protocol

Use one current-chat heartbeat Scheduled Task per Research Run, created only after a recorded nonterminal remote Job exists. The Workbench ledger owns durable state; the Scheduled Task only wakes Codex; the Stop Hook only checks that the wake-up exists.

## Agent-selected adaptive checks

- Every `job.submit` spec carries the Agent's estimate and cadence: expected run minutes, first check delay, RUN interval, PEND interval, and rationale. Judge these from the actual calculation, prior timings, stage and resources. A two-minute diagnostic and a two-day production calculation must not share a global cadence.
- `submission_uncertain`: due immediately; reconcile by unique recorded job name and never resubmit.
- `PEND`: use the submitted PEND interval and preserve the scheduler queue reason.
- `RUN`: use the submitted RUN interval. Use logs only when a progress/failure decision needs them.
- `DONE`: register/download evidence as needed, validate it, update the Working Plan, and continue the next Action.
- `EXIT`, `ZOMBI`, `UNKWN`: inspect logs, record fact versus inference, resolve or update the Codex pending item, and create the smallest corrected Action with `--retry-of <failed-action-id>`. Never exceed `maxAutomaticRetries`.
- All Jobs terminal: Workbench sets the monitor to `complete` but retains the automation reference as pending cleanup. Delete the Codex automation, then acknowledge deletion with `monitor close`; only then is the lifecycle closed.

The heartbeat cadence controls how often Codex wakes. `next_check_at` controls whether the wake-up actually contacts HPC. `monitor directive` recommends the cadence from current Jobs and tells Codex whether to create, resume, update, keep, or delete the automation. A heartbeat lease detects a stored-but-no-longer-running automation.

## Scheduled Task prompt template

Adapt IDs, but keep the behavior:

```text
Use $workbench-agent to continue monitoring Workbench Research Run <run-id> for Task <task-id> in this current Codex task. Run workbench doctor and recover context, then run workbench monitor tick --run <run-id>. Never resubmit an uncertain Job. If no Job is due and nothing changed, stay concise. If a Job changed, autonomously handle DONE/EXIT inside the confirmed Envelope, including evidence and retry lineage. Follow the returned automation directive, including cadence updates. Ask the researcher only for a material scientific or boundary decision. When every Job is terminal and no continuation Job is created, delete this Scheduled Task through the Codex automation API, confirm deletion, and run workbench monitor close with the deleted automation reference.
```

Prefer updating an existing matching automation over creating another. After creation/update, verify it is ACTIVE and attach the actual returned reference and cadence through the CLI. Do not guess an automation ID or treat a persisted ID as proof of liveness.
