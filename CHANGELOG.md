# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- A claim-driven physics-literature-reproduction workflow for analytical theory, model numerics, and materials calculations.
- Project-local skills for Workbench execution, literature research, and theory derivation under `skills/`.
- A first-run tutorial, usage guide, and remote-compute guide covering Project/Task setup, Research Plans, confirmed execution boundaries, workflow co-design, Codex Goal mode, OpenSSH/LSF setup, bounded file transfer, and the execution ledger.

### Changed

- Renamed the project and repository references to Computational Physics Workbench.
- Refined model-DMFT validation into complete-iteration review, final self-energy/Green-function checks, and anomaly-triggered extended diagnostics.
- Made bundled scientific skills portable by removing author-specific tool paths and treating optional external tools as environment-dependent.

### Removed

- Withheld two unvalidated specialized DFT+DMFT templates from the public built-in workflow registry.

## [0.1.1] - 2026-09-07

### Fixed

- Fresh source checkouts create the ignored runtime database directory automatically on first start.
- The test suite no longer requires a prebuilt `dist/index.html`, and isolated HPC configuration tests use a disposable database.

## [0.1.0] - 2026-09-07

Initial public research preview.

### Added

- Local-first project, task, workflow, evidence, experience, and HPC management.
- Confirmed Task Specs with agent-maintained Working Plans.
- Traceable Run, Action, Job, Artifact, Evidence, reflection, and decision records.
- Built-in DFT+DMFT, model-DMFT, and general theoretical-research workflows.
- Focused DFT+DMFT result checks that plot complete iteration histories and final self-energy/Green-function data before escalating diagnostics.
- Bounded OpenSSH/SFTP and LSF execution with submission reconciliation and job monitoring.
- Interactive workflow and system-architecture visualizations.
- Workflow-template inspection, patch, reset, and per-task snapshot reset commands in the CLI.
- Apache-2.0 licensing, software citation metadata, contribution guidance, security policy, issue templates, and CI.

### Security and reliability

- Filesystem access is restricted to normalized Project and Task boundaries.
- User databases, credentials, research inputs, and calculation outputs are excluded from Git.
- Remote job state mutations are serialized to prevent stale concurrent observations from overwriting terminal states.
- Unsupported scheduler configurations fail closed; the reference release supports IBM LSF only.
- Production and development dependencies have zero known vulnerabilities according to `npm audit` at release preparation time.

### Known limitations

- Installation requires a source checkout and Node.js; there is no packaged installer yet.
- The validated reference path is Codex, OpenSSH/SFTP, and IBM LSF; other agent clients and schedulers require adapters.
- The project is an early research preview; APIs, schemas, and workflow conventions may evolve.
