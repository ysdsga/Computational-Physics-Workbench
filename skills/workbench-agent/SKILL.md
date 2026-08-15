---
name: workbench-agent
description: Operate DFT+DMFT Workbench research runs through the bounded local `workbench` CLI. Use for retrieving task context, starting or inspecting runs, recording facts and inferences, requesting human review, managing versioned policies and contracts, or performing explicitly enabled SSH/LSF pilot actions without reading SQLite or constructing arbitrary remote commands.
---

# Workbench Agent

Use the repository's `workbench` command as the sole machine entry point. Run `workbench doctor` first and `workbench context --task <id>` before choosing an action.

## Operating loop

1. Read context and honor every item in `blockers`.
2. Reconcile recorded remote work before proposing another submission.
3. Act only through a named CLI verb and within the effective policy.
4. Record observed output as `fact`; record diagnosis as `inference`; record choices as `decision`.
5. Never record `conclusion` as Agent—the researcher owns final scientific conclusions.
6. Request review when a method, parameter range, resource budget, permission, or protected result would be expanded or overwritten.

## Safe commands

Use `workbench --help` for the current command surface. Common operations:

```text
workbench context --task <id> --pretty
workbench run start --task <id> --plan <id> --idempotency-key <key>
workbench event append --run <id> --category fact --type <name> --actor agent
workbench review request --run <id> --gate <gate> --question <text>
workbench remote inspect --task <id> --host <alias> --remote-root </root>
workbench remote reconcile --job <remote-job-id>
```

Always provide an idempotency key for a submission or revision. Treat exit code 4 as a blocker/review state, not a transport failure. Do not retry `submission_uncertain`; reconcile it.

Remote operations additionally require server environment switches, an active task policy, a pre-confirmed OpenSSH host key, and an approved remote root. Never bypass these checks with `ssh`, direct SQLite access, or arbitrary shell commands.
