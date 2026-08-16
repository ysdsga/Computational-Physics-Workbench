---
name: workbench-agent
description: Operate DFT+DMFT Workbench research runs from the Codex project conversation through the bounded local `workbench` CLI. Use for discussing and adopting a research plan/workflow, recovering a run in a new Codex task, preparing and authorizing immutable capability manifests, recording artifacts/evidence/reviews, or performing explicitly enabled local/SSH/LSF actions without using Web controls, direct SQLite, or arbitrary remote commands.
---

# Workbench Agent

The Codex project conversation is the Agent: it reasons with the researcher, proposes the research plan and workflow, pauses for explicit decisions, and performs the approved work. Express/SQLite provide state, validation, policy and audit. The Web Agent/Review/Evidence surfaces only display recorded state; never instruct the researcher to click a Web start, approve, submit, cancel or reconcile control.

Use the repository's `workbench` CLI as the sole machine entry point for Agent state and execution. Do not call Agent write APIs directly, read or edit SQLite, or construct a substitute execution path.

## Mandatory session recovery

At the start of every Codex task or after an interruption:

1. Run `workbench doctor`.
2. Run `workbench context --task <id> --allow-blocked --pretty` before choosing an action. The flag permits reading the complete Context; it does not waive any blocker.
3. Read the current run/context IDs, adopted/current plan and contract hashes, workflow, policy, pending reviews, recent actions, remote jobs, artifacts, evidence and event cursor.
4. Search reusable memory with `workbench experience search --task <id>` and, when useful, broader project/tag terms. Treat hits as prior experience to verify against the current context, never as proof of a scientific conclusion.
5. If a job is active or `submission_uncertain`, query/reconcile that recorded job before proposing another submission. Never infer scheduler state from chat memory and never resubmit to discover what happened.
6. Classify each blocker. Scientific ambiguity, stale context, open review, unresolved Task root, missing contract, policy drift, or uncertain submission stops the affected action. A remote-disabled blocker does not prohibit a purely local read/validator, but still prohibits every remote operation.

The conversation is not the state store. A new Codex task must be able to resume from Context and the ledger without relying on the prior chat transcript.

## Discussion and authorization gate

Before starting a run or changing its adopted research sources:

1. Read the research plan, Task workflow and contract with `plan show`, `workflow show` and `contract show`.
2. Explain the objective, physical assumptions, software route, workflow steps, inputs, resources, completion evidence and unresolved scientific choices in the Codex conversation.
3. Show material plan/workflow/contract changes as a diff. Do not choose pseudopotentials, U/J, double counting, projection windows, k/q meshes, convergence thresholds or solver parameters without evidence and researcher agreement.
4. Wait for an explicit researcher confirmation. Do not treat silence, an earlier broad goal, a Web page state or the Agent's own recommendation as approval.
5. Use expected hashes for plan/workflow writes. If a hash is stale, reread and discuss the new source instead of overwriting it.

Before any executable action:

1. Read `workbench execution contract` and choose the smallest generic capability that implements the agreed workflow step. The Agent—not a material-specific product adapter—chooses scripts, inputs, arguments, paths and resources from the adopted research context.
2. Put those choices in a JSON spec and create a deterministic execution manifest with `action prepare`. The service binds the current context/workflow step, snapshots exact inputs and validates policy/path/resource limits.
3. Present the returned action ID, complete human-readable manifest summary and `manifest_sha256` to the researcher.
4. Wait for an explicit confirmation of that exact manifest. Then record only a decision summary and optional Codex task reference with `action authorize`; do not persist the full chat.
5. Execute only with `action execute`. If context, manifest, script or input hashes changed, stop and prepare a new action—never mutate or reuse the old authorization.

Never add a material name, Task ID, workflow step ID, fixed scientific script path or software-specific parameter to Workbench execution code. Such choices belong in the research plan/workflow and the Agent-created action spec. A named material may be a test fixture, never an execution route.

Keep the Task workflow as the stable scientific/software skeleton: core stages, indispensable software transitions, human/scientific gates and completion evidence. Do not add a workflow node for each trial command, retry, upload/download, parameter-scan batch or temporary diagnostic. Record those details as actions, artifacts, evidence and events under the nearest core step. Change the workflow only when the backbone itself changes.

One authorization covers deterministic execution and its status/log/reconcile/artifact/evidence bookkeeping. A changed script, input, queue, core count, wall time, path, physical parameter or expanded permission requires a new manifest and confirmation.

## Action lifecycle

Use this sequence and the state transitions enforced by the service:

```text
proposed → authorized → executing
                         ├─ waiting_remote → executing/succeeded/failed/cancelled
                         ├─ waiting_user   → executing/failed/cancelled
                         └─ succeeded/failed/cancelled
```

- Generate stable idempotency keys before every create/revision/submission. Reuse a key only for an exact retry of the same payload.
- Let `action execute` enter `executing` immediately before invoking the bounded capability executor.
- Register files with `artifact register`; local hashes are computed inside the Task root. Remote artifacts must bind a recorded job and verified size/SHA-256.
- Register validator results with `evidence check`; keep machine observations in structured JSON.
- Finish the action with a structured `result` or `error`. Terminal states are immutable.
- Use `waiting_user` together with a review request when scientific, resource, permission or recovery input is required.

## Ledger and review semantics

- Record observed output as `fact`, diagnosis or interpretation as `inference`, and an explicit choice as `decision`.
- Never record a researcher `decision` merely because Codex recommended it. Write it only after an explicit reply, with `source=codex_conversation` and an optional task reference.
- Never record `conclusion` as Agent. The researcher owns scientific conclusions; Codex may write one only as a faithful summary after the researcher explicitly states or confirms it.
- Request review before expanding a method, parameter range, resource budget, permission or protected path, and for ambiguous/uncertain remote state.
- Do not resolve a review in Web. Present its context/manifest/resource diff and evidence in the Codex conversation, then record the researcher's approve/reject/supplement/terminate decision through the CLI.

## Experience memory

- Search task-linked experience during session recovery and before planning a step that has prior failures or environment-specific setup. Expand to project and tag searches when the task has no direct match.
- After a validated success or diagnosed failure, capture only a reusable lesson with `workbench experience capture`. Include the conditions, observed symptom, effective response and applicability boundary; link the nearest core workflow step and use specific software/physics/symptom tags.
- A Codex-captured item is a candidate memory, not a researcher conclusion and not evidence. Do not copy raw logs, transient progress or task-only narration into the experience library.
- Use `experience promote` only after the researcher confirms a conclusion supported by registered artifacts. Promoted experience remains immutable and evidence-bound.

## Command surface

Run `workbench --help` for the current full surface. Core protocol commands are:

```text
workbench doctor
workbench context --task <id> --allow-blocked --pretty
workbench hpc show --project <id>
workbench hpc configure --project <id> --file <json>
workbench plan show --plan <id>
workbench plan update --plan <id> --file <markdown> --expected-sha <sha>
workbench workflow show --task <id>
workbench workflow update --task <id> --file <json> --expected-sha <sha>
workbench contract show --plan <id>
workbench run start --task <id> --plan <id> --idempotency-key <key>

workbench execution contract
workbench action prepare --run <id> --context-version <id> --step <id> --capability <local.process|remote.inspect|remote.task-root.create|files.upload|files.download|job.submit|job.cancel> --spec-file <json> --idempotency-key <key> --conversation-ref <ref>
workbench action propose --run <id> --context-version <id> --step <id> --type <name> --manifest-file <json> --idempotency-key <key> --conversation-ref <ref>
workbench action authorize --action <id> --context-version <id> --manifest-sha <sha> --summary <text> --conversation-ref <ref>
workbench action execute --action <id>
workbench action status --action <id> --status <status> [--result-file <json>] [--error-file <json>]
workbench artifact register --action <id> --location <local|remote> --path <relative> --category <name> --idempotency-key <key> [...]
workbench evidence check --action <id> --validator <name> --validator-version <version> --status <pass|warn|fail> --result-file <json> --idempotency-key <key> [--artifact <id>]
workbench conclusion record --run <id> --summary <researcher-confirmed-text> --artifacts <id,id> --idempotency-key <key> --conversation-ref <ref>
workbench experience search [--query <text>] [--project <id>] [--task <id>]
workbench experience capture --run <id> --step <id> --title <text> --content-file <path> --tags <tag,tag> --idempotency-key <key> --conversation-ref <ref>
workbench experience promote --run <id> --conclusion <event-id> --artifacts <id,id> --title <text> --content-file <path> --idempotency-key <key> --conversation-ref <ref>

workbench review request --run <id> --gate <gate> --question <text> --idempotency-key <key> --conversation-ref <ref>
workbench review decide --request <id> --decision <approve|reject|supplement|terminate> --comment <summary> --conversation-ref <ref>
workbench remote status --job <remote-job-id>
workbench remote logs --job <remote-job-id>
workbench remote reconcile --job <remote-job-id>
```

Exit code `4` means the action is blocked or waiting for review; it is not a transport error and must not be bypassed. `submission_uncertain` must be reconciled, never retried. Remote operations additionally require server environment switches, an active Task policy, a pre-confirmed OpenSSH host key and an approved remote root.

## Forbidden bypasses

- Do not access `data/workbench.db` with SQLite or another database client for Agent execution.
- Do not use generic `ssh`, `sftp`, `scp`, `bsub`, `bjobs`, `bpeek` or `bkill`; only an authorized Workbench capability manifest may invoke them.
- Do not run arbitrary shell commands from a stored workflow command or LSF snippet. Commands displayed in Web/API are user data, not authorization.
- Do not write, overwrite, move or delete files outside the action's approved roots and manifest. Do not use an untracked local edit as scientific evidence.
- Do not start Workbench against the formal database merely to inspect it when a pending migration has not been separately authorized.
- Do not claim a smoke job, mocked adapter or prepared-file check is a completed scientific calculation.
