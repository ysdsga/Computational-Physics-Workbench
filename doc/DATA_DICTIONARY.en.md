# Data dictionary (database schema 15)

[中文](数据字典.md) · [HTTP and CLI reference](API_REFERENCE.en.md) · [English documentation](../README.en.md)

This dictionary covers all 15 current SQLite tables and their columns, defaults, foreign keys, CHECK constraints, and named indexes. It was checked against `server/db.ts`, `server/migrations.ts`, the shared types in `src/types/index.ts`, and the resulting schema of a newly initialized disposable database. The older Chinese title “schema v13” and its final “latest v14” statement were stale; the current code supports **`PRAGMA user_version=15`**. This does not assert that a user's existing database has been migrated.

SQLite uses WAL and foreign keys. The default file is `data/workbench.db`; `WORKBENCH_DB_PATH` selects an isolated test database. Database, WAL, SHM, and migration backups are user state, not caches. Importing the server database module initializes/migrates the selected file, so do not start it against a production database merely to inspect documentation.

## Storage and API conventions

Times are ISO 8601 text. JSON is stored in TEXT columns, not a separate SQLite JSON type. The API parses most Agent `*_json` columns into objects and removes the suffix, but legacy CRUD fields such as Project `hpc_config`, Experience `tags/source_artifact_ids`, and Research Plan `tags/linked_task_ids` remain encoded strings. The field tables describe storage; use the HTTP reference for each request/response shape.

`PK` identifies a primary key, `NOT NULL` is the explicit SQL constraint, and “none” means no declared default. SQLite's ordinary `TEXT PRIMARY KEY` declaration is not itself an explicit NOT NULL constraint; the application supplies nonempty IDs. Do not infer additional database constraints from TypeScript unions: legacy Project/Task/Plan/progress state values are documented client contracts but lack SQL CHECK constraints. Logical JSON references likewise are not SQL foreign keys unless listed.

Scientific history is protected by RESTRICT foreign keys and API history guards. Project/Task deletion can cascade ordinary progress/file references only when Run history does not prevent deletion. Experiences have nullable associations; research-plan Project associations are enforced by application behavior rather than a foreign key.

## Table overview

| Table | Role |
|---|---|
| `projects` | Material/research system and local/HPC configuration |
| `tasks` | Stable Task boundary and independent workflow snapshot |
| `workflow_templates` | Editable templates copied when Tasks are created |
| `step_progress` | Core-step status, notes, command and LSF text |
| `step_files` | Step-attached file-path references |
| `research_plans` | Metadata for Project-local Markdown research plans |
| `experiences` | Reusable memory with applicability and provenance |
| `research_runs` | Run identity and Task Spec |
| `run_events` | Append-only attributed research timeline |
| `run_actions` | Stage milestones, immutable execution specs, retries |
| `remote_jobs` | Recorded scheduler submissions and observations |
| `run_monitors` | One external monitoring-automation binding per Run |
| `run_artifacts` | File identity, provenance, and validity |
| `evidence_checks` | Structured validator results |
| `pending_items` | Operational or researcher attention queue |

## projects

Root entity for a material or research system. Shared-client statuses are `active | archived`; SQL does not CHECK this enum. Deletion is rejected by the API when a Task has Run history. HPC configuration is metadata, not an execution authorization.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `name` | TEXT | NOT NULL; default none | Human-readable name; user-authored values are preserved. |
| `description` | TEXT | default `''` | Human-readable description. |
| `material` | TEXT | default `''` | Material or research-system label. |
| `working_dir` | TEXT | default `''` | Local Project working directory; root for its files and Task directories. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |
| `hpc_config` | TEXT | default `NULL` | JSON-encoded HPC configuration; see the schema 2 contract below. |
| `status` | TEXT | NOT NULL; default `'active'` | Lifecycle state; supported values and enforcement are listed below. |

## tasks

Belongs to a Project. Supported client states are `active | paused | completed | archived`; SQL does not CHECK them. Creating a Task copies its Workflow and creates only a stable Task root. Codex chooses any Stage subdirectory layout. Root uniqueness and path safety are service checks, not a SQL unique index. Existing roots cannot be rebound through the root API. Unresolved legacy roots block execution.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `project_id` | TEXT | NOT NULL; default none; FK `projects.id`, DELETE CASCADE | Owning Project ID. |
| `name` | TEXT | NOT NULL; default none | Human-readable name; user-authored values are preserved. |
| `description` | TEXT | default `''` | Human-readable description. |
| `workflow_id` | TEXT | NOT NULL; default none | Source Workflow template identifier. |
| `workflow_snapshot` | TEXT | default `NULL` | Full independent Workflow JSON for this Task; serialized as workflow. |
| `status` | TEXT | default `'active'` | Lifecycle state; supported values and enforcement are listed below. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |
| `task_root_rel` | TEXT | default `NULL` | Stable Task root relative to the Project directory; null means unresolved. |

## workflow_templates

Editable source templates. `data` contains `stages` and `steps`; `id,name,description` are stored separately. Creating a Task copies a complete snapshot. Template edits/reset do not rewrite existing Task snapshots. Read routes seed missing built-ins; historical compatibility code may backfill missing Task snapshots on startup.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `name` | TEXT | NOT NULL; default none | Human-readable name; user-authored values are preserved. |
| `description` | TEXT | default `''` | Human-readable description. |
| `data` | TEXT | NOT NULL; default `'{}'` | Workflow JSON object containing stages and steps. |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |

## step_progress

One row per `(task_id, step_id)`. Client states are `pending | in_progress | completed | skipped`; SQL does not CHECK them. Notes, commands, and scripts are stored user content, not permission or automatic execution. Task detail exposes raw progress rows; dedicated progress endpoints parse `commands` and the list endpoint adds file references.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `task_id` | TEXT | NOT NULL; default none; FK `tasks.id`, DELETE CASCADE | Owning Task ID. |
| `step_id` | TEXT | NOT NULL; default none | Workflow step identifier; a logical reference, not a SQL foreign key. |
| `status` | TEXT | default `'pending'` | Lifecycle state; supported values and enforcement are listed below. |
| `notes` | TEXT | default `''` | User notes. |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |
| `commands` | TEXT | default `NULL` | JSON-encoded user command array; parsed in progress endpoints. |
| `lsf_script` | TEXT | default `NULL` | User-edited LSF script text; storing it does not execute it. |

Additional SQL constraints: `UNIQUE(task_id, step_id)`.

## step_files

A lightweight path reference attached to progress. Adding/deleting a reference does not upload, download, or remove the scientific file. `is_remote` is retained only for compatibility; full remote provenance belongs to `run_artifacts` and `remote_jobs`.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `step_progress_id` | TEXT | NOT NULL; default none; FK `step_progress.id`, DELETE CASCADE | Progress row owning this file reference. |
| `file_path` | TEXT | NOT NULL; default none | File-path reference; file contents are not stored here. |
| `file_name` | TEXT | NOT NULL; default none | File name (Research Plans store the Project-relative Markdown name). |
| `description` | TEXT | default `''` | Human-readable description. |
| `is_remote` | INTEGER | default `0` | Deprecated compatibility flag, default 0; not new remote evidence provenance. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |

## research_plans

Searchable metadata for Markdown inside the owning Project working directory. Supported client states are `draft | active | completed | archived`; SQL does not CHECK them. `project_id` is nullable only to preserve old unassigned records; current APIs require an existing configured Project and exclude unassigned plans from lists. There is no SQL foreign key on `project_id`. `(project_id,file_name)` is unique, not `file_name` globally. Lists discover Project-root Markdown and add metadata. Run history blocks deletion; content and its SHA-256 are read from disk.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `file_name` | TEXT | NOT NULL; default none | File name (Research Plans store the Project-relative Markdown name). |
| `title` | TEXT | NOT NULL; default none | Human-readable title. |
| `project_id` | TEXT | default none | Owning Project ID. |
| `linked_task_ids` | TEXT | default `'[]'` | JSON-encoded Task ID array; no array-element foreign keys. |
| `status` | TEXT | default `'draft'` | Lifecycle state; supported values and enforcement are listed below. |
| `tags` | TEXT | default `'[]'` | JSON-encoded string array; returned as a JSON string in metadata responses. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |

Additional SQL constraints: `UNIQUE(project_id, file_name)`.

## experiences

Reusable manual/candidate/confirmed memory with applicability and provenance, distinct from evidence. Routes validate `status` as `manual | candidate | confirmed`; SQL does not CHECK it. Categories include submit_template, input_template, workflow, param_choice, and troubleshooting but are extensible. Source kinds conventionally use researcher, codex, or imported. Codex capture is idempotent by a deterministic ID derived from Run and key, creates a candidate, and verifies Artifact membership in that Run. It does not establish a researcher conclusion.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `title` | TEXT | NOT NULL; default none | Human-readable title. |
| `content` | TEXT | NOT NULL; default none | Experience text; Research Plan content instead lives in Markdown on disk. |
| `tags` | TEXT | default `'[]'` | JSON-encoded string array; returned as a JSON string in metadata responses. |
| `related_project_id` | TEXT | default none | Optional Project association; no SQL foreign key. |
| `related_task_id` | TEXT | default none | Optional Task association; no SQL foreign key. |
| `related_step_id` | TEXT | default none | Optional workflow-step association; Codex capture currently records stageId here. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |
| `category` | TEXT | NOT NULL; default `'workflow'` | Record category; Event categories are constrained separately below. |
| `status` | TEXT | NOT NULL; default `'manual'` | Lifecycle state; supported values and enforcement are listed below. |
| `applicable_scope` | TEXT | NOT NULL; default `''` | Conditions under which the Experience applies, including limits on extrapolation. |
| `source_run_id` | TEXT | default none; FK `research_runs.id`, DELETE SET NULL | Source Run for Experience provenance. |
| `source_artifact_ids` | TEXT | NOT NULL; default `'[]'` | JSON-encoded Artifact ID array; the array has no SQL foreign keys. |
| `source_kind` | TEXT | NOT NULL; default `'researcher'` | Experience provenance kind, conventionally researcher, codex, or imported. |

## research_runs

Owns the Task Spec: a confirmed scientific/execution Envelope and a mutable Working Plan. Only one `draft | active | waiting_researcher` Run is allowed per Task. Envelope revision starts at zero and becomes one on confirmation. API serialization derives `confirmed_envelope_sha256`, `working_plan_sha256`, and, when present, `scientific_goal_sha256`; these are not columns. Confirmation stores a decision summary and optional Event conversation reference, not a full conversation.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `task_id` | TEXT | NOT NULL; default none; FK `tasks.id`, DELETE RESTRICT | Owning Task ID. |
| `research_plan_id` | TEXT | NOT NULL; default none; FK `research_plans.id`, DELETE RESTRICT | Research Plan associated with this Run. |
| `status` | TEXT | NOT NULL; default none | Lifecycle state; supported values and enforcement are listed below. |
| `objective` | TEXT | NOT NULL; default none | Task Spec objective. |
| `confirmed_envelope_json` | TEXT | NOT NULL; default none | Canonical confirmed scientific/execution boundary; parsed as confirmed_envelope. |
| `working_plan_json` | TEXT | NOT NULL; default `'{}'` | Mutable Working Plan JSON; parsed as working_plan. |
| `envelope_revision` | INTEGER | NOT NULL; default `0` | 0 while draft, 1 on first confirmation; increments on material revisions. |
| `envelope_confirmed_at` | TEXT | default none | Most recent Envelope confirmation timestamp. |
| `envelope_confirmation_summary` | TEXT | NOT NULL; default `''` | Decision summary, not a full chat transcript. |
| `current_stage_id` | TEXT | default none | Current core Stage from the Working Plan. |
| `idempotency_key` | TEXT | NOT NULL; default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `started_at` | TEXT | default none | Execution/start timestamp; null before starting. |
| `ended_at` | TEXT | default none | Run completion/termination timestamp. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |

Additional SQL constraints: `CHECK(status IN ('draft', 'active', 'waiting_researcher', 'completed', 'terminated'))`; `CHECK(envelope_revision >= 0)`; `UNIQUE(task_id, idempotency_key)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE UNIQUE INDEX idx_research_runs_one_open_per_task ON research_runs(task_id) WHERE status IN ('draft', 'active', 'waiting_researcher');
```

## run_events

Append-only fact/inference/decision/conclusion timeline with increasing sequence within each Run. No update/delete HTTP endpoint exists. A conclusion requires researcher attribution and `source=codex_conversation`. The generic append endpoint refuses `stage.reflection`: use the dedicated endpoint so the Event and Working Plan transition are atomic. Reflection history is retained across later changes.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `sequence` | INTEGER | NOT NULL; default none | Monotonically increasing Event sequence within the Run. |
| `category` | TEXT | NOT NULL; default none | Record category; Event categories are constrained separately below. |
| `event_type` | TEXT | NOT NULL; default none | Event discriminator, such as stage.reflection or action.succeeded. |
| `actor_type` | TEXT | NOT NULL; default none | Agent, researcher, or system attribution. |
| `payload_json` | TEXT | NOT NULL; default `'{}'` | Event payload object; parsed as payload. |
| `idempotency_key` | TEXT | default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `source` | TEXT | NOT NULL; default `'workbench'` | Recorded source, such as workbench, codex, or codex_conversation. |
| `conversation_ref` | TEXT | default none | Optional external conversation/task reference, not chat content. |
| `occurred_at` | TEXT | NOT NULL; default none | Event occurrence timestamp. |

Additional SQL constraints: `CHECK(category IN ('fact', 'inference', 'decision', 'conclusion'))`; `CHECK(actor_type IN ('agent', 'researcher', 'system'))`; `UNIQUE(run_id, sequence)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE UNIQUE INDEX idx_run_events_idempotency ON run_events(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_run_events_timeline ON run_events(run_id, sequence);
```

## run_actions

Codex milestones and executable Actions belonging to a core Stage. Confirmed Runs create Actions directly as `ready`; retired proposed/authorized states and authorization-summary columns are absent. Specification and hash are immutable. Parent and retry references must be consistent with the Run, and retries with the Stage/type; a previous Action may have only one retry successor. Retry limits come from the Envelope. The localized top-level API `executionPreview` is a display copy, never part of a changed spec or hash.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `stage_id` | TEXT | NOT NULL; default none | Core Stage identity; services validate against the Task Workflow and Envelope. |
| `step_id` | TEXT | default none | Workflow step identifier; a logical reference, not a SQL foreign key. |
| `parent_action_id` | TEXT | default none; FK `run_actions.id`, DELETE RESTRICT | Optional parent Action for a decomposition relationship. |
| `action_type` | TEXT | NOT NULL; default none | Executable capability or user-recorded milestone Action type. |
| `status` | TEXT | NOT NULL; default none | Lifecycle state; supported values and enforcement are listed below. |
| `executor` | TEXT | NOT NULL; default `'codex'` | Fixed execution owner: codex. |
| `spec_json` | TEXT | NOT NULL; default none | Immutable Action specification JSON; parsed as spec. |
| `spec_sha256` | TEXT | NOT NULL; default none | SHA-256 of the canonical Action specification JSON. |
| `idempotency_key` | TEXT | NOT NULL; default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `conversation_ref` | TEXT | default none | Optional external conversation/task reference, not chat content. |
| `started_at` | TEXT | default none | Execution/start timestamp; null before starting. |
| `finished_at` | TEXT | default none | Action terminal-state timestamp. |
| `result_json` | TEXT | NOT NULL; default `'{}'` | Structured result JSON; parsed as result. |
| `error_json` | TEXT | NOT NULL; default `'{}'` | Structured error JSON; parsed as error. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |
| `retry_of_action_id` | TEXT | default none; FK `run_actions.id`, DELETE RESTRICT | Previous Action in a linear retry chain. |
| `retry_attempt` | INTEGER | NOT NULL; default `0` | Service-computed scientific retry count; 0 for an original attempt. |

Additional SQL constraints: `CHECK(status IN ( 'ready', 'executing', 'waiting_remote', 'waiting_codex', 'waiting_researcher', 'succeeded', 'failed', 'cancelled' ))`; `CHECK(executor = 'codex')`; `CHECK(retry_attempt >= 0)`; `UNIQUE(run_id, idempotency_key)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE INDEX idx_run_actions_timeline ON run_actions(run_id, created_at DESC);
CREATE INDEX idx_run_actions_stage ON run_actions(run_id, stage_id, created_at DESC);
CREATE UNIQUE INDEX idx_run_actions_retry ON run_actions(retry_of_action_id) WHERE retry_of_action_id IS NOT NULL;
```

## remote_jobs

Every Job belongs to a Run, originating Action, and Stage. This identity requirement applies to remote_jobs, not run_monitors. One Action may have multiple Jobs with distinct keys; the SQL key scope is the Run. Insert `prepared` before submission; uncertain responses use `submission_uncertain` and require identity reconciliation. Scheduler rejection can use `preparation_failed`; accepted scheduler observations and `cancel_requested` are also recorded. Job status is intentionally not a SQL enum. Terminal states recognized by monitor policy are done, exit, zombi, unkwn, preparation_failed, and cancelled (case-insensitive). These are recorded observations, not live browser connections to HPC.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `action_id` | TEXT | NOT NULL; default none; FK `run_actions.id`, DELETE RESTRICT | Originating Action ID. |
| `stage_id` | TEXT | NOT NULL; default none | Core Stage identity; services validate against the Task Workflow and Envelope. |
| `action_token` | TEXT | NOT NULL; default none | Globally unique Workbench submission token. |
| `idempotency_key` | TEXT | NOT NULL; default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `profile_id` | TEXT | NOT NULL; default none | Adopted HPC profile identifier. |
| `host` | TEXT | NOT NULL; default none | Registered OpenSSH alias used for this Job. |
| `remote_workdir` | TEXT | NOT NULL; default none | Recorded remote working directory. |
| `scheduler` | TEXT | NOT NULL; default `'lsf'` | Scheduler name; current implementation supports LSF. |
| `job_id` | TEXT | default none | Scheduler-returned Job ID; null before acceptance or while uncertain. |
| `job_name` | TEXT | NOT NULL; default none | Unique scheduler-facing name used for reconciliation. |
| `status` | TEXT | NOT NULL; default none | Lifecycle state; supported values and enforcement are listed below. |
| `submission_spec_json` | TEXT | NOT NULL; default `'{}'` | Recorded submission/monitoring specification; parsed as submission_spec. |
| `script_sha256` | TEXT | default none | Submission-script content digest. |
| `resources_json` | TEXT | NOT NULL; default `'{}'` | Resource request JSON; parsed as resources. |
| `last_observation_json` | TEXT | NOT NULL; default `'{}'` | Most recent scheduler observation; parsed as last_observation. |
| `submit_stdout` | TEXT | NOT NULL; default `''` | Recorded submission standard output. |
| `submit_stderr` | TEXT | NOT NULL; default `''` | Recorded submission standard error. |
| `submitted_at` | TEXT | default none | Submission timestamp. |
| `reconciled_at` | TEXT | default none | Most recent reconciliation timestamp. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `next_check_at` | TEXT | default `NULL` | Next due check; for a monitor, earliest due time among active Jobs. |
| `last_progress_at` | TEXT | default `NULL` | Latest observed Job progress timestamp. |
| `queue_reason` | TEXT | NOT NULL; default `''` | Latest queue-wait reason. |
| `poll_count` | INTEGER | NOT NULL; default `0` | Recorded number of Job polls. |
| `terminal_at` | TEXT | default `NULL` | Time the Job was observed terminal. |

Additional SQL constraints: `CHECK(poll_count >= 0)`; `UNIQUE(run_id, idempotency_key)`; `UNIQUE(action_token)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE UNIQUE INDEX idx_remote_jobs_scheduler_id ON remote_jobs(host, scheduler, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_remote_jobs_run ON remote_jobs(run_id, created_at DESC);
CREATE INDEX idx_remote_jobs_stage ON remote_jobs(run_id, stage_id, created_at DESC);
CREATE INDEX idx_remote_jobs_due ON remote_jobs(run_id, next_check_at) WHERE next_check_at IS NOT NULL;
```

## run_monitors

Exactly one optional row per Run, keyed by `run_id`; there are no `action_id` or `stage_id` columns. Tracks the current external automation reference, observed state, wake-up cadence, and earliest due Job. Workbench does not itself create/delete external Scheduled Tasks. The API validates cadence as an integer from 1 to 1440; SQL only enforces positive/non-null cadence. A provider may impose a larger minimum interval. Serialized derived fields are `active_job_count`, `due_job_count`, `recommended_cadence_minutes`, `heartbeat_fresh`, and `heartbeat_lease_expires_at`; none is stored here.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `run_id` | TEXT | PK; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `status` | TEXT | NOT NULL; default none | Lifecycle state; supported values and enforcement are listed below. |
| `automation_ref` | TEXT | default none | Actual external Scheduled Task/automation reference. |
| `cadence_minutes` | INTEGER | default none | Reported external wake-up cadence in minutes; not a Job polling override. |
| `next_check_at` | TEXT | default none | Next due check; for a monitor, earliest due time among active Jobs. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |

Additional SQL constraints: `CHECK(status IN ('required', 'scheduled', 'paused', 'complete'))`; `CHECK(cadence_minutes IS NULL OR cadence_minutes > 0)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE INDEX idx_run_monitors_status ON run_monitors(status, next_check_at);
```

## run_artifacts

File evidence attached to an Action and Stage. Local registration resolves the Task-relative file and computes size/hash. Remote registration requires the same Action's recorded Job, a safe remote reference, size, and SHA-256. Categories are descriptive and extensible (for example receipt, downloaded-evidence, scientific-output). `superseded` requires a replacement through the API, and the replacement must belong to the same Run. Old evidence is explicitly marked, not silently replaced.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `action_id` | TEXT | NOT NULL; default none; FK `run_actions.id`, DELETE RESTRICT | Originating Action ID. |
| `remote_job_id` | TEXT | default none; FK `remote_jobs.id`, DELETE RESTRICT | Optional recorded remote Job association; required by remote Artifact registration. |
| `stage_id` | TEXT | NOT NULL; default none | Core Stage identity; services validate against the Task Workflow and Envelope. |
| `location` | TEXT | NOT NULL; default none | Artifact location: local or remote. |
| `path` | TEXT | NOT NULL; default none | Artifact file reference; local paths are Task-relative. |
| `size_bytes` | INTEGER | NOT NULL; default none | Recorded file size, nonnegative. |
| `sha256` | TEXT | NOT NULL; default none | Recorded file content digest. |
| `category` | TEXT | NOT NULL; default none | Record category; Event categories are constrained separately below. |
| `validity` | TEXT | NOT NULL; default `'valid'` | Artifact scientific/provenance validity state. |
| `superseded_by_id` | TEXT | default none; FK `run_artifacts.id`, DELETE RESTRICT | Replacement Artifact ID when superseded. |
| `metadata_json` | TEXT | NOT NULL; default `'{}'` | Additional Artifact metadata; parsed as metadata. |
| `idempotency_key` | TEXT | NOT NULL; default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `updated_at` | TEXT | NOT NULL; default none | Most recent recorded update timestamp (ISO 8601 text). |

Additional SQL constraints: `CHECK(location IN ('local', 'remote'))`; `CHECK(size_bytes >= 0)`; `CHECK(validity IN ('valid', 'suspect', 'invalid', 'superseded'))`; `UNIQUE(action_id, idempotency_key)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE INDEX idx_run_artifacts_run ON run_artifacts(run_id, created_at DESC);
CREATE INDEX idx_run_artifacts_stage ON run_artifacts(run_id, stage_id, created_at DESC);
```

## evidence_checks

Structured validator name/version and `pass | warn | fail` result for an Action, optionally an Artifact of that same Action. This is evidence bookkeeping, not a researcher conclusion or proof that a DFT/DMFT model is physically correct. Artifact membership and idempotency-content checks are performed by services.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `action_id` | TEXT | NOT NULL; default none; FK `run_actions.id`, DELETE RESTRICT | Originating Action ID. |
| `artifact_id` | TEXT | default none; FK `run_artifacts.id`, DELETE RESTRICT | Optional Artifact checked by this validator record. |
| `stage_id` | TEXT | NOT NULL; default none | Core Stage identity; services validate against the Task Workflow and Envelope. |
| `validator_name` | TEXT | NOT NULL; default none | Validator identity. |
| `validator_version` | TEXT | NOT NULL; default none | Validator implementation/version label. |
| `status` | TEXT | NOT NULL; default none | Lifecycle state; supported values and enforcement are listed below. |
| `result_json` | TEXT | NOT NULL; default none | Structured result JSON; parsed as result. |
| `idempotency_key` | TEXT | NOT NULL; default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |

Additional SQL constraints: `CHECK(status IN ('pass', 'warn', 'fail'))`; `UNIQUE(action_id, idempotency_key)`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE INDEX idx_evidence_checks_run ON evidence_checks(run_id, created_at DESC);
CREATE INDEX idx_evidence_checks_stage ON evidence_checks(run_id, stage_id, created_at DESC);
```

## pending_items

Unified Codex/researcher attention queue. Operational diagnosis uses audience codex; material scientific decisions or Envelope expansion use researcher. An open researcher item with `detail.blocksRun=true` creates a block; a Stage reference scopes Action blocking to that Stage, while a null Stage is Run-wide. Researcher resolution requires `source=codex_conversation`, or a confirmed Envelope revision. Status is open, resolved, or dismissed. Source and resolution summaries are retained.

| Column | SQLite type | Constraints / default | Meaning |
|---|---|---|---|
| `id` | TEXT | PK; default none | Stable record identifier supplied by the application. |
| `run_id` | TEXT | NOT NULL; default none; FK `research_runs.id`, DELETE RESTRICT | Owning Run ID; the monitor uses this as its primary key. |
| `stage_id` | TEXT | default none | Core Stage identity; services validate against the Task Workflow and Envelope. |
| `action_id` | TEXT | default none; FK `run_actions.id`, DELETE RESTRICT | Originating Action ID. |
| `remote_job_id` | TEXT | default none; FK `remote_jobs.id`, DELETE RESTRICT | Optional recorded remote Job association; required by remote Artifact registration. |
| `audience` | TEXT | NOT NULL; default none | Queue audience: codex or researcher. |
| `kind` | TEXT | NOT NULL; default none | Pending-item discriminator, such as submission_uncertain. |
| `status` | TEXT | NOT NULL; default `'open'` | Lifecycle state; supported values and enforcement are listed below. |
| `title` | TEXT | NOT NULL; default none | Human-readable title. |
| `detail_json` | TEXT | NOT NULL; default `'{}'` | Structured issue detail, including optional blocksRun; parsed as detail. |
| `resolution_json` | TEXT | NOT NULL; default `'{}'` | Structured resolution; parsed as resolution. |
| `idempotency_key` | TEXT | default none | Caller-supplied repeat identity; uniqueness scope is table-specific. |
| `source` | TEXT | NOT NULL; default `'workbench'` | Recorded source, such as workbench, codex, or codex_conversation. |
| `conversation_ref` | TEXT | default none | Optional external conversation/task reference, not chat content. |
| `created_at` | TEXT | NOT NULL; default none | Creation timestamp (ISO 8601 text). |
| `resolved_at` | TEXT | default none | Resolution/dismissal timestamp. |

Additional SQL constraints: `CHECK(audience IN ('codex', 'researcher'))`; `CHECK(status IN ('open', 'resolved', 'dismissed'))`.

Named indexes (primary/inline UNIQUE indexes are implicit):

```sql
CREATE UNIQUE INDEX idx_pending_items_idempotency ON pending_items(run_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pending_items_queue ON pending_items(audience, status, created_at DESC);
```

## Workflow and HPC JSON

`WorkflowTemplate` contains `id`, `name`, `description`, `stages`, and `steps`. Each Stage contains `id,name,description,color,colorBg,colorBorder`. Each Step contains `id,stageId,order,name,description`; optional fields are `commands:string[]`, `lsfScript`, `inputFiles:string[]`, `outputFiles:string[]`, `tips`, `optional`, and `substeps`. A substep contains `id,name,description` plus optional `commands:string[]` and `files:string[]`. Node IDs and executable text are stable data; language selection changes display copies of known built-in prose without renaming IDs or rewriting user-authored snapshots.

HPC configuration schema 2 contains `profiles`, optional `defaultProfileId`, and `taskBindings`. Profiles contain `id,name,sshAlias,scheduler,notes`, with `userRoot` and `projectRoot` for current bindings. `projectRoot` must be a child of `userRoot`; `userRoot` is read-only by policy, while write operations use the Task boundary. Each binding is `{taskId,profileId,taskRootRel}`, with a stable single-segment Task folder directly below the remote Project root. Profile IDs and aliases must be unique. Current scheduler support is IBM LSF; Slurm/PBS adapters are not implemented.

Legacy single-profile fields (`host,user,remotePath,moduleQE,moduleWannier,moduleTRIQS,nprocs`) remain readable. A legacy single `remoteRoot` profile must be upgraded with separate user/project roots before new Task bindings can use it. These configuration records describe boundaries; the confirmed Envelope adopts a profile for execution.

## Confirmed Envelope and Working Plan

Task Spec schema 1 is `{schemaVersion:1,objective,confirmedEnvelope,workingPlan}`. The normalized Envelope contains:

```json
{
  "schemaVersion": 1,
  "coreStageIds": ["stage-id"],
  "scientificCommitments": ["State the scientific commitment"],
  "allowedCapabilities": ["local.process"],
  "allowedMethods": ["State the adopted method"],
  "allowedSoftwareStacks": ["State the adopted software stack"],
  "hpcProfileId": null,
  "resourceLimits": {
    "maxCoresPerJob": 1,
    "maxWallMinutes": 10,
    "maxConcurrentJobs": 1,
    "maxAutomaticRetries": 1
  },
  "protectedRelativePaths": [],
  "completionEvidence": ["State the required evidence"],
  "researcherGates": [],
  "explorationReviewRequired": false,
  "autonomy": {
    "allowWorkingPlanEdits": true,
    "allowRetriesWithinLimits": true,
    "allowOwnJobCancellation": true
  }
}
```

This structural example is not permission to execute a scientific calculation. Capabilities are `local.process`, `remote.inspect`, `remote.task-root.create`, `files.upload`, `files.download`, `job.submit`, and `job.cancel`. Resource fields constrain cores, wall time, concurrent Jobs, and automatic scientific retries. Core Stage IDs must belong to the Task Workflow. Initial confirmation and material revisions require an explicit decision in the Codex conversation; neither stored JSON nor the Web UI can supply that decision on its own.

Working Plan is extensible JSON with `currentStageId`, `summary`, `nextActions:object[]`, `directoryLayout`, optional `explorationReview`, and optional `goalAssessment`. It can change autonomously within the confirmed Envelope. Goal-aware theoretical Runs use the dedicated reflection endpoint to change stage, assessment, or exploration verdict; a general Working Plan update cannot fabricate those transitions.

`explorationReviewRequired` defaults to true for newly drafted `theoretical-research` Runs and false for other workflows. Its completion condition includes:

```json
{
  "explorationReview": {
    "status": "passed",
    "summary": "High-value questions have been resolved or falsified with evidence",
    "unresolvedHighValueItems": []
  }
}
```

`continue` requires at least one unresolved high-value item and another Working Plan iteration. `passed` requires an empty unresolved list. Ideas with disposition `explore`, `deferred`, or `follow_up` remain unresolved; only `resolved` or `falsified` with evidence references close an idea. All required core Stages must have a currently valid `proceed` reflection. A later `stay` or `loop` invalidates closure at its target and downstream stages, requiring renewed research and `proceed`. Historical Runs missing the new contract retain their earlier behavior; no retrospective rewrite of their conclusions is implied.

## Scientific goals, reflections, and cross-Run memory

The v14 research-loop contract uses JSON and Events rather than adding goal columns. New theory Runs with exploration review declare:

| JSON record | Fields |
|---|---|
| `scientificGoal` | `question`, `successCriteria:string[]`, `insufficientOutcomes:string[]`, `acceptedAnswerTypes` |
| `scientificGoalChange` | `previousGoalSha256`, `reason` |
| `goalAssessment` | `goalSha256`, `status:unanswered\|partial\|answered`, `answer`, `answerType`, `criteria`, `remainingGaps:string[]` |
| Each assessment criterion | `criterion`, `satisfied:boolean`, `explanation`, `evidenceRefs:string[]` |
| `routeSearch` | `directions`, `learned`, `nextQuestions:string[]` |
| Each search direction | `axis:longitudinal\|horizontal\|failure_driven\|independent`, `question`, `rationale` |
| Stage reflection | `stageId`, `summary`, `established:string[]`, `uncertainties:string[]`, `ideas`, `decision:proceed\|stay\|loop`, `targetStageId:string\|null`, `nextActions:object[]`; optional/conditionally required `routeSearch`, `goalAssessment` |
| Each idea | `idea`, `significance`, `disposition:explore\|resolved\|falsified\|deferred\|follow_up`, `reason`, `evidenceRefs:string[]`; route-aware contracts also use stable `id`, `parentIdeaIds`, `learning`, `nextQuestion` |

Accepted answer types are `explanation`, `prediction`, `no_go`, `conditional`, and `diagnostic`. `conditional` or `diagnostic` is a sufficient final answer only if the original goal explicitly accepted it; diagnostic work cannot silently replace a requested mechanism explanation. Marking a goal answered requires the agreed answer type, every original criterion, valid supporting evidence, and no remaining gaps. A goal change within or across Runs must cite the prior goal hash and a reason, then receive a new Envelope confirmation. Working Plan cannot rewrite the question.

Reflection is an append-only `stage.reflection` Event, recorded atomically with its Working Plan transition. It retains established results, uncertainties, ideas, evidence, decisions, return targets, and next Actions. A Stage may have any number of reflections; later records do not erase earlier discoveries. The reflection endpoint itself does not edit Research Plan Markdown. `stay/loop` preserve unfinished research; closed candidate routes alone do not prove that the original scientific goal is answered.

Before reflecting, actively consider counterexamples, competing mechanisms, controlled limits, and testable predictions that might change, extend, or overturn the central claim. The workflow imposes no quota of ideas or search axes and must not manufacture ideas to satisfy a process. If nothing valuable emerges, briefly record the directions actually considered. Closing a route preserves what was learned and its failure or applicability boundary; deferred/follow-up labels alone do not close a high-value question.

The Task-level `ResearchMap` is derived from eligible confirmed Run histories and contains `scientificGoal`, `goalSha256`, `goalRunId`, `routes`, and `searches`. Routes include Run/Stage/Event IDs, parent relationships, and `historyEventIds`; searches retain Run/Stage/Event provenance and the search record. Runs carrying `run.archived_invalid` are excluded. Compact CLI context reports a summary; `workbench research-map show --task <id>` retrieves the complete map.

Completion rechecks evidence: Task-local referenced files must exist; Artifact/Evidence IDs must belong to the same Task and remain valid; local Artifact contents must match the recorded hash. These checks enforce consistency of records and evidence, not the correctness of a derivation or the novelty of a physical result. Unfinished work should remain paused/awaiting communication or terminated with its gaps recorded, never falsely marked completed.

## Action transitions and monitor semantics

| Current Action state | Allowed next states |
|---|---|
| `ready` | `executing`, `cancelled` |
| `executing` | `waiting_remote`, `waiting_codex`, `waiting_researcher`, `succeeded`, `failed`, `cancelled` |
| `waiting_remote` | `executing`, `waiting_codex`, `succeeded`, `failed`, `cancelled` |
| `waiting_codex` | `executing`, `waiting_researcher`, `succeeded`, `failed`, `cancelled` |
| `waiting_researcher` | `executing`, `failed`, `cancelled` |
| `succeeded`, `failed`, `cancelled` | No further transition; recording the same state is idempotent. |

A scientific retry is a new linked Action, not a reset of a terminal Action. Submission responses with uncertain acceptance require reconciliation by the unique Job name. Pre-acceptance scheduler rejection can be operational recovery rather than a consumed scientific retry; the service classifies this from recorded Jobs. Routine remote session operations record Events without creating milestone Actions.

Monitor states are `required`, `scheduled`, `paused`, and `complete`. A fresh heartbeat must be attached to the actual current-task external automation. Missing/paused/stale automation with active Jobs blocks the Stop Hook; terminal Jobs with an undeleted automation also require cleanup. Delete externally first, confirm success, then acknowledge with monitor close. The next check is Job-specific; the external wake-up cadence is not a fixed universal polling policy. The browser displays recorded state and does not independently poll HPC.

## Derived API records

These values are derived or serialized views, not new database tables:

- Task responses parse `workflow_snapshot` to `workflow` and provide `workflow_sha256` and `task_root_unresolved`.
- Run responses parse Envelope/Working Plan JSON and compute their hashes and optional scientific-goal hash.
- Action responses parse `spec`, `result`, and `error`; optional top-level `executionPreview` is localized for display while the canonical spec stays unchanged.
- Artifact/Evidence/Event/Pending responses parse `metadata`, `result`, `payload`, `detail`, or `resolution`. Remote Jobs parse `submission_spec`, `resources`, and `last_observation`.
- `EvidenceLibraryItem` adds Project/Task identity and names, `run_status`, `action_type`, optional `job_status`, `local_available`, and `checks` to an Artifact.
- `AgentContext` schema 4 contains `project,task,taskRoot,run,research,workflow,remoteCapability,recentActions,recentJobs,monitor,recentArtifacts,recentEvidenceChecks,pendingItems,eventCursor,latestStageReflections,evidenceIndex,blockers`, plus optional `researchMap`. Task root reports relative/absolute/resolved values. Blockers contain `code,message,details?`. A context read uses recorded evidence and does not establish a live HPC connection.

## Migration and backup history

`server/db.ts` initializes legacy base tables, adds compatibility columns, and calls `runMigrations`. The current terminal version is 15. The numbers below identify database migration checkpoints; they are independent of HTTP schema 4, HPC schema 2, and Envelope/Task Spec schema 1.

| Version / transition | Backup suffix and change |
|---|---|
| Early Agent schema (v1/v2) | `*.before-agent-v1.db`; initial Agent policy/context/review history schema. |
| Workbench v2 (v3) | `*.before-workbench-v2.db`; Action/Artifact/evidence support. Legacy globally unique Research Plan names have a separate `*.before-research-plans-v3.db` compatibility backup before conversion to Project-scoped uniqueness. |
| Experience provenance (v4) | Adds reusable-memory category, status, applicability and source fields; no separately named v4 backup helper. |
| Essential Workbench (v5) | `*.before-essential-v3.db`; Envelope/Working Plan, pending queue, current Action model, and protected history. Historical runtime data requires the migration's safeguards; this is not a license to discard history. |
| Job monitoring (v6) | `*.before-job-monitor-v6.db`; Job timing/observation fields, retry lineage, and Run monitors. |
| Theory exploration (v7) | `*.before-theoretical-exploration-v7.db`; theoretical exploration template update. |
| Stage reflections (v8) | `*.before-theoretical-stage-reflection-v8.db`; global theory template reflection steps. |
| Idea closure (v9) | `*.before-theoretical-idea-closure-v9.db`; only still-matching old built-in reflection descriptions. |
| Active exploration (v10) | `*.before-theoretical-active-exploration-v10.db`; only still-matching old built-in reflection prompts. |
| Model DMFT solver (v11) | `*.before-model-dmft-solver-step-v11.db`; add solver-design step only to the matching legacy model-DMFT template. |
| Theory tool verification (v12) | `*.before-theoretical-tool-verification-v12.db`; matching built-in derivation/cross-check descriptions. |
| Literature coverage (v13) | `*.before-theoretical-literature-coverage-v13.db`; matching literature, novelty-audit, and reflection descriptions/outputs. |
| Theory research loop (v14) | `*.before-theoretical-research-loop-v14.db`; built-in research map, scientific goal, route search, and reflection contract; no new Stages. |
| Model DMFT validation (v15) | `*.before-model-dmft-validation-v15.db`; update matching old validation Stage/step descriptions from current built-ins. |

Backups are conditional on the migration, existing template/state, and file-backed database; an already existing backup is not overwritten. Later template migrations preserve user edits by matching known built-in content. They do not rewrite existing Task snapshots, Research Plan Markdown, or Run history. Separate startup compatibility backfills can populate an absent Task snapshot or bind a discoverable legacy Task root; that is different from overwriting an existing snapshot.

Production migration is a separate authorized operation. Back up and then verify table counts, foreign keys, Task/Plan/Experience content, and Agent context. Documentation verification used only a disposable database under the isolated checkout; it did not migrate a user's research database.
