# Testing the application

English | [中文](TESTING.md)

Tests verify application behavior, execution boundaries and provenance using disposable databases and research directories. They do not establish real DFT+DMFT correctness or live-cluster compatibility.

## Local checks

Use Node.js 22.12+ and the committed npm lockfile:

```shell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
node docs/examples/oscillator-check.mjs
```

`npm test` uses Node's test runner with `tsx`. `typecheck` covers frontend and backend; `build` runs type checking again and builds `dist/`. Browser tests serve the built `dist/`, so build before running them. The default browser is Playwright Chromium; `WORKBENCH_BROWSER_CHANNEL=msedge` selects an installed Edge instead. Ensure the chosen browser is available; installing Playwright Chromium with `npx playwright install chromium` is an explicit environment change and download, not part of these checks. The E2E fixtures start their own server with a temporary database. Keep their configured port (5173) free and do not point them at an existing research server.

Tests inject `WORKBENCH_DB_PATH`, use temporary project roots and close database/server handles. Never reset a user's `data/workbench.db`, research working directory or remote Task to make a test pass. Development server imports can start a listener: set the temporary database and host/port before importing the server module.

## Coverage and limits

- API startup, metadata CRUD, workflow seeding/snapshots, Task roots and Research Plan ownership/files.
- Canonical path boundaries, traversal, same-prefix siblings and symlink escapes.
- Task Specs, normalized Envelope confirmation, Working Plan updates, Events, pending items, stage reflections and history preservation.
- Immutable Actions, input hashes, receipts, artifact validity, evidence, retry lineage and budgets.
- Generic executor/remote transport behavior, uncertain-submission reconciliation and no material-specific execution branches.
- Monitor requirements, adaptive Job timing, heartbeat leases, lifecycle directives and Stop Hook behavior.
- Browser empty states, metadata forms, review surfaces and no Agent execution writes from WebUI.
- Language selection, English/Chinese presentation and preservation of identifiers/authored content where covered by locale regressions.

Review the actual tests and test output for exact coverage/counts; this file is not a claim that a given run passed. Existing platform-dependent tests may skip (for example where symlink permissions are unavailable). Report skips, failures and unavailable browser/cluster checks separately. A native dependency install failure is a setup failure, not a passed application check. The oscillator example only checks a finite-difference trend at one point.

## Manual English and Chinese acceptance

GitHub CI runs the locked install, lint, frontend/backend type checks, unit/API tests, production build, and Chromium browser regression on Ubuntu/Node 22. Browser checks run against disposable local services; they do not use a research database or cluster credentials.

Use the [disposable local walkthrough](docs/examples/local-first-run.en.md). Verify language selection survives refresh; create and inspect a Project, Task and Research Plan; open templates, files, evidence, experience, Agent Runs, pending items and HPC metadata pages; trigger a required-field error; switch languages and ensure saved names/content remain unchanged. No start/confirm/submit/cancel/reconcile controls should appear on Agent review pages.

Run `node bin/workbench.js --help`, `doctor --lang en --pretty` and `doctor --lang zh-CN --pretty` against the disposable service. CLI help and many technical errors are English; language choice selects generated service prose without changing JSON field names/status codes. Exit codes are `0` success, `2` usage, `3` API failure, `4` recorded boundary/pending blocker and `5` transport failure. Use `context --allow-blocked` to inspect a blocker; do not bypass it.

## Optional live capability pilot

Live testing is not part of `npm test`. It requires an actual reachable LSF account, researcher-verified host key/authentication, registered profile/Task root, adopted Research Plan, and explicitly confirmed Envelope. The agent must follow [workbench-agent](skills/workbench-agent/SKILL.md) and prepare a task-specific capability spec based on `execution contract`.

In PowerShell, preparation uses:

```powershell
$env:WORKBENCH_TEST_RUN_ID='<confirmed run ID>'
$env:WORKBENCH_TEST_STAGE_ID='<workflow stage ID>'
$env:WORKBENCH_TEST_CAPABILITY='remote.inspect'
$env:WORKBENCH_TEST_SPEC_FILE='<absolute path to reviewed JSON spec>'
npm run test:remote:prepare
```

`prepare` records a ready immutable Action and input snapshot; it does not execute it. If required environment values are missing, it prints `SKIP` and exits successfully: this is a skipped pilot, not a live pass. Executing a reviewed prepared Action additionally requires:

```powershell
$env:WORKBENCH_TEST_ACTION_ID='<prepared action ID>'
$env:WORKBENCH_LIVE_ACTION_EXECUTE='1'
npm run test:remote:execute
```

Do not run this block without the confirmed boundary and real environment. The executor rechecks capability, paths, inputs and resources. A first nonterminal Job requires a verified active current-chat heartbeat; terminal cleanup must delete it and acknowledge closure. Separate real SSH/SFTP, actual scheduler submission, solver execution and scientific validation in the report: success at one layer does not imply the others.
