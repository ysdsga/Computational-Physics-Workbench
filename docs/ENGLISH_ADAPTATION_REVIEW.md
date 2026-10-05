# English-user adaptation acceptance review

Reviewed on 2026-10-05 against baseline `6f5ec0cf7d67c2c3876ac6c3326dc9374ed4db47`.
The implementation plan is recorded in [ENGLISH_ADAPTATION_PLAN.md](ENGLISH_ADAPTATION_PLAN.md).

## Findings and implementation

The repository already had English and Chinese README introductions, English CLI help, and mostly English agent skill protocols. The actual gaps were the application interface, built-in workflow explanations, current operational documentation, and some application-generated descriptions. Existing Chinese entry points remain available.

| User journey | Implemented behavior and review evidence |
| --- | --- |
| Installation and startup | Documents Node.js 22.12+, locked npm installation, local CLI use, production build, health checks, and configuration. Dependency versions are unchanged. |
| Browser language | Explicit selection takes precedence over browser preferences. The first `navigator.languages` entry is used when available; otherwise `navigator.language` is used. Chinese variants select Simplified Chinese; other languages select English. Detection does not use IP location. Storage failures retain session selection; other tabs receive preference changes. |
| Navigation and operations | Application text across ten pages and seven components supports English and Chinese, including errors, empty states, confirmations, dates, and file/remote configuration views. Deferred application messages update on language changes. |
| Four scientific workflows | English display covers One-shot DFT+DMFT, model DMFT, theoretical research, and physics-paper reproduction: 27 stages, 94 steps, and 10 substeps. Scientific identifiers, topology, commands, and input/output references are preserved. |
| Editable and scientific data | Localization requires both a stable built-in identifier and matching original field text. Custom names, descriptions, notes, Markdown, commands, and persisted templates remain unchanged. The template editor exposes original editable fields and an explicitly read-only English preview. |
| Legacy HPC configuration | Application-generated legacy names and notes follow the current language. Source-object tracking distinguishes synthesized copy from authored profiles, even when their identifiers and text match. Open editing drafts remain intact and language changes issue no write requests. |
| CLI and API | Supports `--lang en\|zh-CN`, `WORKBENCH_LANG`, and request language. CLI help retains its stderr contract. Localized execution previews are separate from canonical action specifications and their hashes. |
| Agent workflows | English project guidance and three portable skills preserve researcher confirmation, access boundaries, monitoring, recovery, and evidence requirements. Machine-specific kernel/WSL assumptions were removed. |
| Current documentation | English onboarding, operations, remote computing, architecture, Task/Run, testing, decisions, roadmap, API reference, schema dictionary, and paper-reproduction guidance are linked from the English entry points. Source comparison checks cover 84 API method/path pairs and all 187 columns across 15 schema tables. |
| Chinese compatibility | Chinese navigation, workflow display, guides, preference selection, and authored content remain supported. English sessions do not rewrite Chinese research records. |

## Access and scientific boundaries

The CORS implementation and default allowlist are exactly the baseline: `http://localhost:5173` and `http://127.0.0.1:5173`. Explicit environment configuration retains its existing replacement semantics. Production deployments requiring an additional browser origin must configure that exact origin as documented; this change does not broaden the default policy.

Database schema/migrations, raw workflow seeds, and path-safety implementation remain unchanged. Language selection does not authorize commands, grant remote access, alter action hashes, change retry budgets, or change scientific parameters. The browser Agent view remains an observation interface.

## Verification

Final local verification uses an isolated Windows checkout, Node.js 22.14.0, npm 10.9.2, disposable databases, and Playwright Chromium. Test temporary directories and browser files are confined to the checkout. No real research database or cluster was used.

- Lint, frontend/backend type checking, and production build are required final gates. The ten existing lint warnings are tracked separately from failures.
- Unit/API/CLI regression covers locale resolution, request isolation, canonical specifications, workflow fidelity, paths, and existing execution boundaries.
- Browser regression covers primary routes, English and Chinese selection, missing/empty browser language lists, cross-tab synchronization, unavailable storage, four workflows, editable content, failure messages, and the legacy HPC distinction described above.
- An additional independent browser review checked all 94 template steps and 94 task steps, eight editor previews, and bilingual editor notices, with no unexpected Chinese application copy or unhandled page errors in the checked English views.
- English documentation was checked for local link targets and fences, skill metadata/contracts, API coverage, and current schema coverage. A local production server and real CLI HTTP connection were exercised using disposable records.
- Two independent AI reviewers inspected implementation and user journeys. One found the legacy HPC copy issue; its source fix and regression test were reviewed. These are AI review records, not an independent human approval.
- CI runs locked installation, lint, type checks, unit tests, production build, and Chromium browser regression on Linux. Final CI and configured automatic-review results must be checked on the actual PR head before merge; local results alone do not establish that status.

Exact final command results and independent review evidence are recorded in the pull request and isolated local delivery evidence rather than inferred from source inspection.

## Limits and acceptance checks

Windows local unit tests intentionally skip the existing non-CI symlink escape case. Linux CI provides a separate execution of that test; a skip is never counted as a pass. Some filesystem and request failures are deliberately simulated in browser regression. Those checks demonstrate interface behavior and preservation, not physical correctness.

No actual DFT/DMFT calculation, licensed scientific executable, HPC login, scheduler submission, or cluster transfer was attempted. The local numerical example is illustrative and does not validate research results. Historical progress/release notes, image labels embedded in existing Chinese diagrams, and user-authored scientific prose are retained; current English guides provide the supported English route through the application.

For manual acceptance, follow [GETTING_STARTED.en.md](GETTING_STARTED.en.md), open each workflow in English, switch to Chinese and back while editing a disposable record, inspect a read-only template preview, and exercise the CLI diagnostics. Follow [TESTING.en.md](../TESTING.en.md) for repeatable tests. Use disposable records and configure only explicitly intended origins and filesystem roots.
