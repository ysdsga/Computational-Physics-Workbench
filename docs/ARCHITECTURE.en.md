# Architecture

English | [中文](ARCHITECTURE.md)

The agent is the current Codex conversation. The Express API, SQLite ledger and browser application provide boundaries, records and review. Workbench does not run a background scientific agent in the server.

```text
Researcher <-> Codex conversation <--- current-chat heartbeat
                    |
          workbench-agent skill
                    |
              workbench CLI
                    | HTTP
              Workbench API ---- OpenSSH/SFTP + LSF
                    |
              SQLite ledger
                    |
        Web review and ordinary metadata editing
```

Research Plans describe the science; core workflows describe necessary stages; Task Specs separate the researcher-confirmed Envelope from the agent-maintained Working Plan. `research_runs` is the machine source for Task Specs; the CLI and Web render the same records.

## Implementation map

| Location | Responsibility |
| --- | --- |
| `server/migrations.ts` | Repeatable migrations and pre-migration backups |
| `server/services/agentCore.ts` | Task Spec validation, Runs, confirmation/revisions, Working Plans, reflections, pending items, Events and Context |
| `server/services/agentActions.ts` | Actions, artifact validity, evidence and queries |
| `server/services/actionExecutor.ts` | Generic capabilities, immutable specs, input snapshots, receipts and recovery |
| `server/services/hpcConfig.ts` | Profiles, Task bindings and derived read/write roots |
| `server/services/remote.ts` | Bounded SSH/SFTP sessions, Events, submission identity and reconciliation |
| `server/services/jobMonitor.ts`, `monitorStore.ts`, `monitorPolicy.ts` | Due checks, monitor records, automation directives, heartbeat lease and guard |
| `server/routes/` | HTTP contracts; Agent writes are used through the CLI |
| `src/api/client.ts` | Browser API access |
| `src/data/workflows.ts` | Built-in defaults, initial seed and reset source |
| `src/contexts/WorkflowContext.tsx` | Runtime workflow loading and persistence |
| `src/types/index.ts` | Shared domain types |

Executors stay material-independent. Material names, Task IDs, solver paths and physical parameters belong in research data and generated specs, not product branches.

## Files and provenance

A Project owns `working_dir`. Task creation copies a workflow into `tasks.workflow_snapshot` and creates only its stable root; the Working Plan determines subdirectories. Later template edits do not rewrite existing snapshots. Workflow-node deletion does not delete research files. Resolved path checks reject traversal, absolute-path misuse, same-prefix siblings and symlink escapes.

Confirmed remote sessions derive the host and user/project read roots and Task write root. Ordinary commands/transfers append Events. Scientific milestone Actions keep immutable normalized specs, hashes, idempotency keys and input snapshots. Execution rechecks capabilities, stage, methods/software, Task/HPC binding, paths, protections, resources and input hashes.

LSF submission inserts a Job record before `bsub`, then checks returned ID/name with the scheduler. Missing or conflicting responses become `submission_uncertain`; recovery queries the unique existing identity with `bjobs`/`bhist`, never by resubmitting. External scheduler/filesystem state remains authoritative; the ledger records observations and recovery identity.

Each Job carries agent-selected timing estimates and intervals. One Run monitor derives the required wake-up cadence; a host automation wakes the conversation. `next_check_at` controls actual cluster checks. The Stop Hook checks monitor obligations, including stale leases and pending automation deletion, but neither the hook nor WebUI executes scientific recovery autonomously.

## Language and stored content

The browser stores its explicit choice as `workbench.locale` (`en` or `zh-CN`). Priority is the current page's manual selection, then a valid saved choice, then `navigator.languages[0]`; if that entry is missing or empty, `navigator.language` is used. A case-insensitive `zh` prefix selects Simplified Chinese (including `zh-TW` and `zh-HK`); other or unavailable browser languages fall back to English. Later entries in the language list do not override the first. No IP/geolocation or operating-system region lookup is performed. Storage failures leave manual switching usable for the current page, and same-origin storage events synchronize other tabs. CLI `--lang`/`WORKBENCH_LANG` selects request language independently. Labels and generated explanatory text can change language; database IDs, scientific notation, user-authored notes, raw Event history and immutable Action specs retain their recorded meaning and bytes.

Action responses may carry a localized top-level `executionPreview`. Use this presentation field for explanatory UI prose; `action.spec.executionPreview` remains part of the original immutable spec. Translating it in storage would change provenance and hashes. API clients without a supported language preference retain compatible generated defaults.

## Deployment and data boundaries

The default server binds to loopback. See [configuration](REMOTE_COMPUTE.en.md#local-service-configuration) for allowed origins, custom ports and emergency remote-disable settings. SSH uses strict host keys and noninteractive authentication; credentials are not stored in Workbench.

Current technical references: [design decisions](DECISIONS.en.md), [API inventory](../doc/API_REFERENCE.en.md), [database dictionary](../doc/DATA_DICTIONARY.en.md), [paper reproduction workflow](../doc/PAPER_REPRODUCTION_WORKFLOW.en.md), and [roadmap](../ROADMAP.en.md). Each has a Chinese counterpart. Historical plans and old release notes remain historical records.

Stop an old server and assess backups before migrating real data. Test with `WORKBENCH_DB_PATH` and temporary project roots. Projects, Tasks and Plans referenced by Run history are archived rather than physically deleted; Event history is append-only. See [Task model](TASKS.en.md) and [testing](../TESTING.en.md).
