# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased

Initial public research preview.

### Added

- Local-first project, task, workflow, evidence, experience, and HPC management.
- Confirmed Task Specs with agent-maintained Working Plans.
- Traceable Run, Action, Job, Artifact, Evidence, reflection, and decision records.
- Built-in DFT+DMFT, model-DMFT, and general theoretical-research workflows.
- Bounded OpenSSH/SFTP and LSF execution with submission reconciliation and job monitoring.
- Interactive workflow and system-architecture visualizations.
- Apache-2.0 licensing, software citation metadata, contribution guidance, security policy, issue templates, and CI.

### Security and reliability

- Filesystem access is restricted to normalized Project and Task boundaries.
- User databases, credentials, research inputs, and calculation outputs are excluded from Git.
- Remote job state mutations are serialized to prevent stale concurrent observations from overwriting terminal states.
- Production and development dependencies have zero known vulnerabilities according to `npm audit` at release preparation time.

### Known limitations

- Installation requires a source checkout and Node.js; there is no packaged installer yet.
- Remote execution currently targets OpenSSH/SFTP and LSF.
- The project is an early research preview; APIs, schemas, and workflow conventions may evolve.
