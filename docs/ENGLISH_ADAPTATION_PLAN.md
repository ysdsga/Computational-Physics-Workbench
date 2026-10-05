# English-user adaptation: code-based review plan

Baseline: `6f5ec0cf7d67c2c3876ac6c3326dc9374ed4db47` (2026-10-04 review).
Initial work took place only in a fresh isolated clone on the local
`english-user-adaptation` branch, with no remote writes authorized at that stage.
On 2026-10-05 the researcher authorized a final independent review, a PR, and
merge after successful checks. That later phase uses an isolated publication
branch and preserves the original local checkout and global settings. The
original restrictions and delivery plan below describe the initial review phase.

## Findings verified before implementation

- Both `README.md` and `README.en.md` already exist; this is not a README translation task.
- React pages and components contain Chinese interface labels, validation,
  descriptions and confirmations. There is no language selector; the HTML language
  and date formatter are fixed to Chinese.
- The CLI help and most API errors are already English. Remaining server-owned
  explanatory text and startup diagnostics need an explicit language policy.
- Four built-in workflows contain extensive Chinese scientific guidance. Their
  IDs, commands and saved database definitions are application contracts.
- The English README links to Chinese-only onboarding, usage and remote-compute
  guides. Literature/theory skills and several references already use English.
- The Workbench agent skill is already complete and English. Its recovery,
  confirmation, execution and monitoring protocol must be preserved; language
  routing and English project instructions need clearer entry points.
- Tests use temporary databases and project roots. Existing browser tests assume
  Chinese and hard-code Microsoft Edge. npm scripts provide lint, frontend/backend
  type checking, Node tests, build and Playwright tests.

## Implementation

1. Add browser-language detection, a persistent English/Chinese selector, HTML
   language updates, request language and locale-sensitive dates.
2. Translate application-owned interface text without translating researcher
   names, notes, plans, evidence, filenames, identifiers or commands.
3. Add a non-mutating English projection of exact built-in workflow prose. Keep
   database values authoritative and customized fields verbatim; editors save raw
   data and do not write translated projections automatically.
4. Complete English installation/configuration, CLI, local research and remote
   research documentation, plus a portable agent protocol. Retain Chinese entry
   points and the existing one-confirmed-envelope safety model.
5. Cover language selection, fallback, persistence, scientific-content preservation,
   CLI/API behavior and both browser journeys with meaningful regression tests.

## Acceptance and evidence

Run baseline and changed-tree lint, typecheck, Node tests and build; run the legacy
Chinese browser suite plus English flows. Record exact results, existing warnings,
environment failures, skipped live-remote checks, and any remaining limitations.
Only application behavior can be validated locally: temporary fixtures and mocked
remote operations are not evidence of physical correctness or live cluster support.

Deliver a local commit, reviewable patch, file-level change summary, test logs and
instructions for inspecting the isolated copy. The researcher decides whether to
merge after review.

## Follow-up acceptance scope (2026-10-04)

Complete English counterparts for the current design decisions, HTTP/CLI API
inventory, actual database schema, paper-reproduction workflow and roadmap.
Check facts against routes, migrations and shared types; correct matching Chinese
references when stale. Preserve historical plans and old releases. Make the
CONTRIBUTING welcome bilingual and explain that editor fields accept English or
Chinese while previews never overwrite stored research text.

Remove the interim CORS default-origin expansion from the delivered code. Preserve
the baseline default and explicit replacement semantics; use the existing exact
origin environment setting only for disposable preview processes. Record the
production-page issue as a separate proposal requiring review. Deliver one final
baseline-parent commit on `english-user-adaptation-final`, so the patch does not
carry an intermediate access-policy expansion. Retain the working history only
inside the isolated clone. Do not retry the unavailable Library upload route.
