# HTTP and CLI API reference

[中文](接口清单.md) · [Data dictionary](DATA_DICTIONARY.en.md) · [English documentation](../README.en.md)

This reference covers the current routers in `server/routes/`, their services, `server/index.ts`, and `bin/workbench.js`. The default API root is `http://127.0.0.1:3001/api`. Agent HTTP writes are the implementation behind the local `workbench` CLI. The Web UI observes Agent execution and edits ordinary metadata; it does not authorize, submit, cancel, or complete Agent work.

## Conventions and boundaries

- Send JSON request bodies with `Content-Type: application/json`. The server's JSON body limit is 10 MB. Keys are case-sensitive: ordinary CRUD commonly uses `snake_case`; Agent commands commonly accept `camelCase` and serialize persisted records in `snake_case`.
- IDs below are path parameters, not literal strings. URL-encode IDs and query values. Lists return arrays unless a response shape is stated explicitly. Most successful requests return 200; creation routes return 201, including many idempotent Agent creation calls that return an existing record.
- `Accept-Language: en` or `zh-CN` selects supported generated prose. Unsupported or absent language preferences preserve the legacy Chinese generated-prose default. Existing errors, identifiers, enum values, user content, and historical records are not translated wholesale.
- Actions expose an optional top-level `executionPreview` for localized display. `spec.executionPreview`, `spec_sha256`, and the canonical execution inputs remain unchanged. Action detail, Action lists, and full Agent context include the display copy. Compact CLI context intentionally omits executable specifications and previews.
- Task-local paths resolve within the Task root; file-browser paths resolve within the Project working directory. The service checks canonical paths, traversal, and symlink escapes for guarded file operations. Step-file records are references, not uploaded file contents.
- Read [configuration and deployment guidance](../docs/GETTING_STARTED.en.md) before changing the listener or origin policy. An origin allowlist is a browser boundary, not authentication or an operating-system sandbox. Routine remote command wrappers record commands and check the declared scope, but do not sandbox arbitrary shell programs.
- Workbench checks record consistency, execution boundaries, and evidence references. An accepted request or a passing validator is not proof of physical correctness, novelty, or publishability.

## Projects and Tasks

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/api/projects` | None | Project rows, newest update first. |
| POST | `/api/projects` | Required `name`; optional `description`, `material`, `working_dir` | 201 Project. HPC configuration is updated separately. |
| GET | `/api/projects/:id` | None | Project plus `task_count`. |
| PUT | `/api/projects/:id` | Optional `name`, `description`, `material`, `working_dir`, `hpc_config`, `status` | Updated Project; HPC JSON is normalized and bindings must name Tasks in this Project. |
| DELETE | `/api/projects/:id` | None | `{success:true}`; 409 `RUN_HISTORY_PROTECTED` if any Task has Run history. Archive metadata instead. |
| GET | `/api/projects/:projectId/tasks` | None | This Project's Tasks with serialized workflows. |
| POST | `/api/projects/:projectId/tasks` | Required `name`, `workflow_id`; optional `description`, `status` | 201 Task with an independent workflow snapshot and stable Task root. |
| GET | `/api/tasks/:taskId` | None | Task, parsed `workflow`, `workflow_sha256`, and progress. |
| PUT | `/api/tasks/:taskId` | Optional `name`, `description`, `status` | Updated Task metadata. |
| DELETE | `/api/tasks/:taskId` | None | `{success:true}`; Run history prevents deletion with 409 `RUN_HISTORY_PROTECTED`. |
| PUT | `/api/tasks/:taskId/workflow` | `name`, `stages`, `steps`; optional `description`, `expectedWorkflowSha256` | Replace this Task's snapshot, retaining its workflow ID. Returns workflow plus `sha256`; stale supplied hash gives 409 `STALE_WORKFLOW`. |
| PUT | `/api/tasks/:taskId/root` | `task_root_rel`; optional `create:true` | Resolve a legacy unresolved root. Existing roots cannot be rebound; the target must be a directory, unique within the Project, and inside the Project working root. |

Task creation creates only the Task root, never Stage subdirectories. A directory-creation failure is logged and does not roll back Task metadata; inspect the returned context before execution. Renaming a Task does not rename its root. Workflow replacement changes a snapshot, not the source template or the already confirmed scientific boundary.

The Tasks router is mounted at both `/api/tasks` and `/api/projects/:projectId/tasks`. Its collection GET/POST handlers require the parent `projectId`; use the nested collection paths above, not bare `/api/tasks`, for listing/creation. There is no implemented all-Projects Task-list contract. The same router exposes nested `/:taskId` routes under `/api/projects/:projectId/tasks`; the implementation looks up the Task by its ID, so the URL prefix itself is not an ownership or authentication check.

## Local files and step progress

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/api/projects/:projectId/files` | Optional query `path` relative to Project root | `{entries,currentPath,exists}`. Entries contain `name,isDirectory,size,modified,relativePath`; directories sort first. A missing directory returns `exists:false`. |
| GET | `/api/projects/:projectId/files/read` | Required query `path` | `{content,name,size}`; UTF-8 read, file size at most 1 MB. |
| POST | `/api/projects/:projectId/files/mkdir` | Required `name`; optional parent `path` | 201 `{success:true,path}` with Project-relative resulting path. |
| GET | `/api/tasks/:taskId/progress` | None | Progress rows with parsed `commands` and associated `files`. |
| PUT | `/api/tasks/:taskId/progress/:stepId` | Optional `status`, `notes`, `commands`, `lsf_script` | Upsert one step's progress. Commands and LSF text are stored data; this does not execute them. |
| GET | `/api/tasks/:taskId/progress/:stepId/files` | None | File-reference rows, or `[]` if no progress row exists. |
| POST | `/api/tasks/:taskId/progress/:stepId/files` | Required `file_path`, `file_name`; optional `description` | 201 file reference; creates a pending progress row if necessary. Does not copy the file. |
| DELETE | `/api/step-files/:fileId` | None | Remove only the reference; `{success:true}` or 404. |

Step statuses used by the shared client are `pending`, `in_progress`, `completed`, and `skipped`. Legacy CRUD routes do not enforce every TypeScript union at runtime; consumers should still send the documented values.

## Workflow templates

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/api/workflows` | None | Template metadata: `id,name,description`. |
| GET | `/api/workflows/all/full` | None | All templates including `stages` and `steps`. |
| GET | `/api/workflows/:id` | None | Full template. |
| PUT | `/api/workflows/:id` | Required arrays `stages`, `steps`; optional `name`, `description` | Save or create a template. Existing Task snapshots are independent. |
| POST | `/api/workflows/:id/reset` | Empty JSON | Reset a known built-in template; 404 for an ID without a built-in definition. |

Read routes seed missing built-in templates without replacing edited templates. A workflow contains `id,name,description,stages,steps`; its node fields and storage are described in the [data dictionary](DATA_DICTIONARY.en.md#workflow-and-hpc-json). Reading workflows is therefore not guaranteed to be a database-write-free operation on an unseeded database.

## Research Plans

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/api/research-plans` | Optional query `projectId`, `taskId`, `status`, `search` | Metadata list with `missing`; scans Project-root Markdown files and inserts missing metadata. |
| POST | `/api/research-plans` | Required `title`, `project_id`; optional `content`, `status`, `tags`, `linked_task_ids` | 201 metadata; creates Markdown in an existing Project working directory. Default content is a heading. |
| POST | `/api/research-plans/import` | Required `project_id` and either `sourcePath` or `content`; optional `fileName` | 201 metadata. `sourcePath` copies a local source file; `content` writes text. Adds `.md` and a timestamp on name collision. Source files are limited to 10 MB. |
| GET | `/api/research-plans/:id` | None | Metadata plus `missing`. |
| PUT | `/api/research-plans/:id` | Optional `title`, `linked_task_ids`, `status`, `tags`; unchanged `project_id` allowed | Updated metadata. Changing the owning Project is rejected. |
| DELETE | `/api/research-plans/:id` | Query `deleteFile=false` to retain Markdown | `{success:true}`; default also attempts disk-file deletion. Run history blocks deletion with 409. |
| GET | `/api/research-plans/:id/content` | None | `{content,size,modified,sha256}`; at most 10 MB; missing file gives 404. |
| PUT | `/api/research-plans/:id/content` | Required `content`; optional `expectedSha256` | Atomic temporary-file/rename save; `{success:true,updated_at,sha256}`. A mismatched supplied hash gives 409 `STALE_PLAN`. |

Plan content lives on disk, not in SQLite. `tags` and `linked_task_ids` are arrays on input but JSON-encoded strings in metadata responses. Use `expectedSha256` when editing content concurrently; omitting it omits the stale-write check. The retired root-level `research-plans/` directory is ignored. Local `sourcePath` import intentionally accepts a source outside the Project; its destination is confined to the Project working root. Deleting metadata with `deleteFile=false` leaves a Markdown file that a later list/scan can rediscover.

## Experiences

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/api/experiences` | Optional query `projectId`, `taskId`, `status`, `search` | Experience rows with related Project/Task names; searches title, content, tags, and applicability. |
| POST | `/api/experiences` | Required `title`, `content`; optional `tags`, `related_project_id`, `related_task_id`, `related_step_id`, `category`, `status`, `applicable_scope`, `source_run_id`, `source_artifact_ids`, `source_kind` | 201 manual record by default. |
| GET | `/api/experiences/:id` | None | One Experience. |
| PUT | `/api/experiences/:id` | Optional title/content/tags/related IDs/category/status/applicability | Update editable fields. Source provenance fields are not revised by this route. |
| DELETE | `/api/experiences/:id` | None | `{success:true}` or 404. |
| POST | `/api/experiences/codex-capture` | Required `runId`, `title`, `content`, `idempotencyKey`; optional `stageId`, `tags`, `category`, `applicableScope`, `sourceArtifactIds`, `conversationRef` | Capture a `candidate` with `source_kind=codex` and append an inference Event; 201 new, 200 repeated. |

Statuses are `manual`, `candidate`, `confirmed`. Tags and Artifact IDs must be string arrays; the API normalizes and stores them as JSON strings. Capture Artifact IDs must belong to the source Run. The CLI requires `--applicable-scope` even though the HTTP capture route permits it to be omitted. Experiences are reusable research memory, not evidence or researcher conclusions.

## Agent context and Runs

All paths in the remaining HTTP tables have prefix **`/api/agent/v1`**.

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/context/tasks/:taskId` | None | `AgentContext` schema 4. Prefers an open Run; otherwise returns the latest historical Run. Includes boundaries, monitor, latest reflections, and blockers. |
| GET | `/tasks/:taskId/research-map` | None | Theoretical Task's cross-Run goal, routes, and search history; 409 `RESEARCH_MAP_NOT_APPLICABLE` for other workflows. |
| GET | `/execution-contract` | None | Schema 4 execution/session contract, capabilities, and recovery rules. |
| POST | `/runs` | `taskId`, `researchPlanId`, `taskSpec`, `idempotencyKey` | 201 draft Run. |
| GET | `/runs/:runId` | None | Run with parsed Envelope/Working Plan and their SHA-256 values. |
| POST | `/runs/:runId/confirm` | `summary`, `source:"codex_conversation"`; optional `conversationRef` | Confirm the Envelope after an explicit researcher decision in Codex. |
| PUT | `/runs/:runId/working-plan` | `workingPlan`, `reason`, `idempotencyKey` | Replace the mutable Working Plan within its confirmed boundary. |
| POST | `/runs/:runId/stage-reflections` | Reflection payload below plus `idempotencyKey`; optional `conversationRef` | 201 `{reflection,run}`; append an Event and transition the Working Plan in one transaction. |
| POST | `/runs/:runId/envelope-revisions` | `confirmedEnvelope`, `pendingItemId`, `summary`, `source:"codex_conversation"`; optional `conversationRef` | Resolve an open researcher item for this Run and confirm the revised Envelope. |
| POST | `/runs/:runId/complete` | `summary`, `source:"codex_conversation"`; optional `conversationRef` | Complete only after required closure checks; this is not automatically a researcher conclusion. |
| POST | `/runs/:runId/terminate` | `reason` | Terminate a Run subject to active-job and history protections. |
| GET | `/runs/:runId/events` | Optional query `after` sequence, positive integer `limit` | Events with `sequence > after`, ascending. Without `limit`, returns all matching events. |
| POST | `/runs/:runId/events` | `category`, `eventType`, `actorType`; optional `payload`, `idempotencyKey`, `source`, `conversationRef` | 201 append-only Event. `stage.reflection` must use the dedicated reflection endpoint. |

Draft request structure (the empty objects below indicate where complete validated records belong, not a runnable scientific specification):

```json
{
  "taskId": "task-id",
  "researchPlanId": "plan-id",
  "taskSpec": {
    "schemaVersion": 1,
    "objective": "State the research objective",
    "confirmedEnvelope": {},
    "workingPlan": {}
  },
  "idempotencyKey": "stable-key"
}
```

The [data dictionary](DATA_DICTIONARY.en.md#confirmed-envelope-and-working-plan) specifies Envelope, Working Plan, scientific goal, and reflection fields. Run statuses are `draft`, `active`, `waiting_researcher`, `completed`, and `terminated`. At most one draft/active/waiting Run exists per Task. Web state, broad historical intent, or silence cannot substitute for confirmation in the Codex conversation.

### Theoretical research and reflection contract

A reflection accepts `stageId`, `summary`, `established:string[]`, `uncertainties:string[]`, `ideas:StageReflectionIdea[]`, `decision:proceed|stay|loop`, `targetStageId`, and `nextActions:object[]`; `routeSearch` and `goalAssessment` are optional at the type level and conditionally required by the scientific-goal contract. The stage must be the current Working Plan stage. This endpoint currently applies only to `theoretical-research`.

New theoretical Runs with `explorationReviewRequired` must declare `scientificGoal`: the original question, success criteria, insufficient outcomes, and accepted answer types. Ordinary Working Plan updates cannot rewrite the goal or forge reflection-driven transitions. A goal change requires `scientificGoalChange.previousGoalSha256` and `reason`, followed by a confirmed Envelope revision.

For Runs with that contract, literature/map stages require actual `routeSearch`; interpretation/packaging stages require `goalAssessment`. Routes retain stable `ideas[].id`, `parentIdeaIds`, `learning`, and `nextQuestion`. With no candidate route, stay in map exploration; with an unanswered goal, use `stay` or `loop` instead of declaring completion merely because the route list is closed. Historical Runs without the new goal contract retain their existing rules. Cross-Run maps omit `run.archived_invalid` histories.

Representative refusal codes are `SCIENTIFIC_GOAL_REQUIRED`, `SCIENTIFIC_GOAL_MISMATCH`, `SCIENTIFIC_GOAL_NOT_ANSWERED`, `SCIENTIFIC_ANSWER_TYPE_INSUFFICIENT`, `RESEARCH_ROUTE_SEARCH_REQUIRED`, `RESEARCH_ROUTE_LEARNING_REQUIRED`, and `RESEARCH_EVIDENCE_INVALID`. These checks validate recorded commitments and evidence references; the Agent and researcher still assess the physics.

## Pending items

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/pending-items` | Optional query `runId`, `projectId`, `taskId`, `audience`, `status` | Filtered queue with Project/Task context. |
| GET | `/runs/:runId/pending-items` | None | Run queue including closed items. |
| POST | `/runs/:runId/pending-items` | `audience`, `kind`, `title`; optional `detail`, `stageId`, `actionId`, `remoteJobId`, `idempotencyKey`, `source`, `conversationRef` | 201 pending item. |
| POST | `/pending-items/:itemId/resolve` | Optional `status` (default `resolved`), `resolution`, `source`, `conversationRef` | Close an open item as `resolved` or `dismissed`. Researcher items require `source:"codex_conversation"`. |

`audience=codex` covers operations and recovery; `audience=researcher` covers material scientific decisions or boundary expansion. `detail.blocksRun:true` on a researcher item creates a block. A stage-specific item blocks that Stage's Actions; a Run-level item applies across stages. Creating/resolving the relevant researcher items updates waiting/active Run state. A free-form user-authored title or detail is preserved.

## Actions, Artifacts, and evidence

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/runs/:runId/actions` | Optional positive integer `limit` | Action list, newest first. |
| POST | `/runs/:runId/actions` | `stageId`, `actionType`, `spec`, `idempotencyKey`; optional `stepId`, `parentActionId`, `retryOfActionId`, `conversationRef` | 201 recorded custom/non-executing Action. |
| POST | `/runs/:runId/executable-actions` | `capability`, `spec`, `idempotencyKey`; `stageId` or current stage; optional `stepId`, `parentActionId`, `retryOfActionId`, `conversationRef` | 201 `ready` Action with a canonical executable spec and input snapshot where applicable. |
| GET | `/actions/:actionId` | None | Action plus its Artifacts, evidence checks, and Jobs. |
| POST | `/actions/:actionId/execute` | Empty JSON | Execute within the confirmed Envelope; recorded receipts support recovery. |
| POST | `/actions/:actionId/status` | `status`; optional `result`, `error` | State-machine-constrained transition. |
| GET | `/runs/:runId/artifacts` | Optional positive integer `limit` | Run Artifact list. |
| POST | `/actions/:actionId/artifacts` | `location`, `path`, `category`, `idempotencyKey`; optional `remoteJobId`, `sizeBytes`, `sha256`, `metadata`, `validity`, `supersededById` | 201 Artifact; local size/hash are measured, remote registration requires recorded provenance and supplied identity. |
| POST | `/artifacts/:artifactId/validity` | `validity`, `reason`; optional `supersededById` | `valid`, `suspect`, `invalid`, or `superseded`; supersession needs a replacement Artifact in the same Run. |
| GET | `/runs/:runId/evidence-checks` | Optional positive integer `limit` | Validator records. |
| POST | `/actions/:actionId/evidence-checks` | `validatorName`, `validatorVersion`, `status`, `result`, `idempotencyKey`; optional `artifactId` | 201 validator record; status `pass\|warn\|fail`; Artifact, if given, must belong to the same Action. |
| GET | `/evidence-library` | Optional query `projectId`, `taskId`, `location`, `checkStatus`, `validity`, `search` | Artifact-centered evidence with Project/Task names, job status, local availability, and checks. |

Capabilities are `local.process`, `remote.inspect`, `remote.task-root.create`, `files.upload`, `files.download`, `job.submit`, and `job.cancel`. Host and remote Task root derive from the confirmed HPC profile and Task binding. There is no per-Action authorization endpoint. See [execution and remote operation guidance](../docs/REMOTE_COMPUTE.en.md) for remote setup and operation; the authoritative capability contract is returned by `/execution-contract`.

Every retry names `retryOfActionId`, remains in the same Run/Stage/type, and follows one linear chain within `maxAutomaticRetries`. Scheduler rejection before acceptance does not necessarily consume a scientific retry. A `submission_uncertain` Job must be reconciled, never blindly resubmitted. Stable Action idempotency keys are bound to immutable specs; changing language changes display prose only.

## Remote Task sessions and observations

These routes can contact the configured HPC system. The HTTP method does not itself imply that an operation is harmless: monitoring and reconciliation may update recorded state.

| Method | Path | Request / query | Result and behavior |
|---|---|---|---|
| GET | `/remote/tasks/:taskId/session` | None | Confirmed `runId,envelopeSha256,host,scheduler,roots` (`userRead,projectRead,taskWrite`), session model and `routineOperationsCreateActions:false`. |
| POST | `/remote/tasks/:taskId/init` | Empty JSON | Idempotently create registered Task write root and append an Event, without creating an Action. |
| POST | `/remote/tasks/:taskId/exec` | `command`; optional `access` (default `read`), `scope` (default `task`), `cwd`, `timeoutSeconds` (default 60, range 1–3600) | Execute in the declared registered scope, append a fact Event, and return command/output/exit metadata. |
| POST | `/remote/tasks/:taskId/upload` | `localPath`, `remotePath`; optional `overwrite` | Upload between local and remote Task roots and append an Event. |
| POST | `/remote/tasks/:taskId/download` | `remotePath`, `localPath`; optional `scope` (default `task`), `overwrite` | Download from registered `user\|project\|task` scope to the local Task root and append an Event. |
| POST | `/remote/jobs/:jobId/status` | Empty JSON | Inspect an already recorded Job and update its observation. |
| POST | `/remote/jobs/:jobId/logs` | Empty JSON | Return available Job log output. |
| POST | `/remote/jobs/:jobId/reconcile` | Empty JSON | Reconcile recorded identity, especially uncertain submissions. |

Routine directories, commands, uploads, and downloads belong to the confirmed Task session and do not require milestone Actions. `exec` supports `read|write` and `user|project|task`, but write mode accepts only Task scope. It rejects direct `bsub`, `bkill`, `qsub`, `qdel`, `sbatch`, and `scancel`; scheduler submission/cancellation must use the recorded Job/Action path with identity, idempotency, and reconciliation. This declared access policy does not make arbitrary shell commands an OS-enforced read-only sandbox.

## Run monitoring

| Method | Path | Request | Result and behavior |
|---|---|---|---|
| GET | `/monitor/guard` | None | Detect absent/stale heartbeats for active Jobs and terminal automations still needing deletion acknowledgement. |
| GET | `/runs/:runId/monitor` | None | Monitor or `null`, including suggested cadence and heartbeat lease. |
| GET | `/runs/:runId/monitor/directive` | None | Structured `create\|resume\|update\|keep\|delete\|none` directive, reason, and relevant automation/cadence/next-check fields. |
| POST | `/runs/:runId/monitor/attach` | `automationRef`, `automationState:"active"`, `cadenceMinutes` | Attach only after the external automation is actually ACTIVE. |
| POST | `/runs/:runId/monitor/automation` | `automationRef`, `automationState`; `cadenceMinutes` when active | Synchronize observed `active\|paused\|missing`; use close for deleted state. |
| POST | `/runs/:runId/monitor/tick` | Empty JSON | Reconcile only Jobs whose `next_check_at` is due; return `runId,checkedAt,checkedJobs,activeJobs,stateChanges,monitor,automation`. |
| POST | `/runs/:runId/monitor/pause` | `automationRef`, `automationState:"paused"` | Acknowledge successful external pause; active Jobs remain subject to guard. |
| POST | `/runs/:runId/monitor/close` | `automationRef`, `automationState:"deleted"` or `"missing"` | Close only after no active Jobs remain and the external automation is removed. |

Workbench stores automation references and observations; these routes do not create/delete an external Scheduled Task themselves. `cadenceMinutes` is an integer from 1 to 1440 at this API boundary; the selected automation provider may impose a stricter minimum interval. Never claim a provider accepted a cadence without checking its actual response. Each Job's own policy and `next_check_at` decide whether a wake-up contacts HPC.

## CLI mapping

Run `node bin/workbench.js --help` from a checkout, or `workbench --help` where the binary is installed. Help is written to stderr and exits successfully; `--help`/`-h` also work after a command. Regular results are JSON on stdout, with `--pretty` for indentation. `WORKBENCH_URL` defaults to `http://127.0.0.1:3001`. `--lang en|zh-CN` overrides `WORKBENCH_LANG`; the CLI default is `en`.

| CLI command group | HTTP operation / purpose |
|---|---|
| `doctor` | GET Projects and execution contract; reports connectivity, latency, count, schema version. |
| `context --task <id> [--allow-blocked] [--full]` | GET Task context; compact by default. Without `--allow-blocked`, recorded blockers give exit 4. |
| `research-map show --task <id>` | GET complete theoretical research map. |
| `hpc show\|configure --project <id>` | Read Project HPC configuration or PUT configuration from `--file`. |
| `plan list\|show\|update\|metadata` | Search/read Research Plans, edit Markdown with `--expected-sha`, or change metadata JSON. |
| `workflow show\|update\|reset-task` | Read/update Task snapshots; mutations require `--expected-sha`. |
| `workflow template-show\|template-patch\|template-reset` | Read, patch, or reset source templates. Patch JSON uses `stageUpdates`, `stepUpdates`, `addSteps`. |
| `execution contract` | GET execution contract. |
| `run draft\|show\|confirm\|working-plan\|revise-envelope\|complete\|terminate` | Run lifecycle. Draft takes `--task-spec-file`; revisions take `--file`, `--pending`, `--summary`. |
| `action prepare\|record\|execute\|show\|list\|status` | Executable or custom Action lifecycle; prepare/record take `--spec-file` and `--idempotency-key`. |
| `pending list\|create\|resolve` | Attention queue, `--detail-file` and `--resolution-file` for structured content. |
| `artifact register\|validity\|list` | File provenance and validity. |
| `evidence check\|list` | Validator results from `--result-file`. |
| `event append` | Append category/type/actor and optional `--payload-file`. |
| `reflection record` | Dedicated theory reflection from `--file`. |
| `experience search\|capture` | Memory retrieval and candidate capture from `--content-file`. |
| `remote session\|init\|exec\|upload\|download --task <id>` | Registered remote session. Exec accepts `--command` or `--command-file`. |
| `remote status\|logs\|reconcile --job <id>` | Recorded Job observations. |
| `monitor guard\|show\|directive\|attach\|sync\|tick\|pause\|close` | Monitor lifecycle; `sync` maps to HTTP `/monitor/automation`. |

The CLI supplies `source=codex_conversation` where its command represents a researcher decision. This records the claimed source; the Agent must actually obtain the required decision. Full option names are in `--help`, including Stage/Action/Job references and idempotency keys. Prefer JSON files for structured payloads so shell quoting does not alter scientific text.

| Exit code | Meaning |
|---|---|
| `0` | Success, including help. |
| `2` | Usage/argument error. |
| `3` | API rejection or other command failure. |
| `4` | A recognized recorded-state/boundary blocker, or a blocked context without `--allow-blocked`. |
| `5` | Unable to reach the Workbench service. |

## Errors and safety contracts

Agent errors are `{error,code,details?}`. Older CRUD routes may return `{error}` without a code. Path violations commonly use 403 `PATH_OUTSIDE_ROOT`; stale hashes, boundary/state conflicts, and protected history commonly use 409; missing records use 404; invalid input commonly uses 400. Do not assume every error or unknown API path has the same JSON envelope. CLI exit 4 uses an explicit set of blocker codes, not every HTTP 409.

HPC aliases must be registered; remote writes must stay within the Task write boundary; resources must fit the Envelope. The service binds to loopback by default. `WORKBENCH_REMOTE_DISABLED=1` disables remote operations; `WORKBENCH_REMOTE_SUBMIT_DISABLED=1` specifically disables submission. Do not bypass recorded submission/cancellation channels, edit SQLite directly to simulate authorization, or treat a UI indicator as permission.

This reference includes the previously omitted individual progress/file-reference routes, step-file deletion, and the monitor `none` directive, and explains the Tasks router's dual mounting without inventing an all-Task list. Database schema version 15, HTTP context schema 4, and Task Spec/Envelope schema 1 are separate version numbers.
