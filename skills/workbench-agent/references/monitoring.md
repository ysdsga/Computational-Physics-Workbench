# Long-job monitoring protocol

Use one current-chat heartbeat Scheduled Task per Research Run, created only after a recorded nonterminal remote Job exists. The Workbench ledger owns durable state; the Scheduled Task only wakes Codex; the Stop Hook only checks that the wake-up exists.

## Adaptive checks

- `submission_uncertain`: due immediately; reconcile by unique recorded job name and never resubmit.
- `PEND`: check after roughly 10 minutes, then 30 minutes, then 60 minutes while unchanged. Preserve the scheduler queue reason.
- `RUN`: check about every 15 minutes. Use logs only when a progress/failure decision needs them.
- `DONE`: register/download evidence as needed, validate it, update the Working Plan, and continue the next Action.
- `EXIT`, `ZOMBI`, `UNKWN`: inspect logs, record fact versus inference, resolve or update the Codex pending item, and create the smallest corrected Action with `--retry-of <failed-action-id>`. Never exceed `maxAutomaticRetries`.
- All Jobs terminal: Workbench sets the monitor to `complete`; pause/remove the Scheduled Task.

The heartbeat cadence controls how often Codex wakes. `next_check_at` controls whether the wake-up actually contacts HPC, so an unchanged long queue does not cause wasteful remote polling.

## Scheduled Task prompt template

Adapt IDs, but keep the behavior:

```text
Use $workbench-agent to continue monitoring Workbench Research Run <run-id> for Task <task-id> in this current Codex task. Run workbench doctor and recover context, then run workbench monitor tick --run <run-id>. Never resubmit an uncertain Job. If no Job is due and nothing changed, stay concise. If a Job changed, autonomously handle DONE/EXIT inside the confirmed Envelope, including evidence and retry lineage. Ask the researcher only for a material scientific or boundary decision. When every Job is terminal and no continuation Job is created, mark/preserve the completed monitor state and pause this Scheduled Task.
```

Prefer updating an existing matching automation over creating another. After creation/update, attach the actual returned reference through the CLI. Do not guess an automation ID.
