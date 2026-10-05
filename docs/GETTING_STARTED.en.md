# First use: from a Project to a controlled Research Run

English | [中文](GETTING_STARTED.md)

Workbench is a local research ledger and review application. You discuss the science and confirm execution boundaries in a Codex conversation; the agent plans and executes through the project skill and CLI. Start with a small local task before configuring a real cluster. A runnable [local-only walkthrough](examples/local-first-run.en.md) is available without an account or HPC connection.

## 1. Install and start

Install Node.js **22.12 or later** and npm. From a source checkout:

```shell
node --version
npm ci
npm run dev:full
```

Open the URL printed by Vite, normally <http://127.0.0.1:5173>. Keep this terminal running; stop with Ctrl+C. `npm ci` installs the exact committed lockfile into this checkout. `better-sqlite3` is a native dependency: if installation reports a native build error, retain the error and check your Node/platform compatibility before changing environments.

For a production-style local launch:

```shell
npm run build
npm start
```

Open <http://127.0.0.1:3001>. The unchanged default browser-origin allowlist contains only localhost/127.0.0.1 on Vite port 5173: the built page can load, but browser writes from port 3001 require explicit configuration. Prefer the development command above for first use, or follow the [disposable local preview](examples/local-first-run.en.md), which opts in to one exact loopback origin only for its process. Rebuild after frontend changes. See [configuration and troubleshooting](REMOTE_COMPUTE.en.md#local-service-configuration) for database, host, port and CLI settings. Keep the default loopback binding for local use.

Use the sidebar language selector for English or 简体中文. The selection is stored in this browser under `workbench.locale`; without a valid saved selection, the first `navigator.languages` entry is used, with `navigator.language` as a compatibility fallback if that entry is unavailable. Chinese browser locales select Simplified Chinese; other or unavailable locales select English. Switching languages changes presentation, not your research text, identifiers or recorded evidence. Existing authored Chinese notes and customized workflow content remain in their original language.

## 2. Open the repository in Codex

Use this repository as the Codex project's main folder so it can discover `AGENTS.md`, [AGENTS.en.md](../AGENTS.en.md), project hooks and [skills](../skills). Add your dedicated research working directory to the project if it is outside the checkout. Do not grant an entire disk or home directory simply for convenience.

A **Codex project** is the set of folders available to the agent. A **Workbench Project** is a research topic with its own `working_dir`. A **Codex conversation** is where you work with the agent; a **Workbench Task** is a traceable scientific objective with a workflow snapshot and stable Task root. Usually one conversation advances one Task or clearly identified stage.

No global CLI installation is needed:

```shell
node bin/workbench.js --help
node bin/workbench.js doctor --lang en --pretty
```

The service must be running for `doctor`. Throughout the guides, replace `workbench` with `node bin/workbench.js` when using the CLI from the repository root without a global command.

## 3. Create a Project and Task

In the Projects page, create a Project with a name, optional material/system and description, and a dedicated absolute working-directory path. This is a filesystem boundary, not just a label; do not use the application source directory as the research directory.

Open that Project and create a Task with a specific objective and the nearest workflow template: One-shot DFT+DMFT, model DMFT (TRIQS), theoretical research or physics literature reproduction. Creation copies the full template into the Task. Later global template edits do not alter existing Tasks; editing a Task workflow affects only that Task.

Only a stable Task root is created. The agent designs its subdirectories later. The Task ID appears after `#/task/` in the browser address.

## 4. Write and link a Research Plan

Open Research Plans, select the Project, create or import a Markdown plan, link it to the Task in its metadata, then save the content. Describe the science, not a list of shell commands:

```markdown
# Research question

## Goal and success criteria
What physical question must be answered? What would still be insufficient?

## Assumptions and scope
Known facts, hypotheses, approximations and applicable regimes.

## Methods and comparisons
Candidate methods/software, controls, convergence and uncertainty design.

## Inputs and provenance
Sources of structures, model parameters, data and literature.

## Resources and risks
Local/HPC estimates, failure modes and alternatives.

## Researcher gates
Scientific choices that require my decision.

## Completion evidence
Files, figures, numerical checks or derivations that support the answer.
```

For theoretical work also state accepted answer types: explanation, prediction, no-go result, or explicitly agreed conditional/diagnostic result. A diagnostic checklist must not silently replace the original scientific question.

## 5. Ask Codex to draft the Run

Copy this into the project conversation and replace the Task ID:

```text
Read AGENTS.md, AGENTS.en.md and skills/workbench-agent/SKILL.md.
Take over Workbench Task <task-id> and respond in English. Run doctor and
compact context; read its linked Research Plan and workflow. Do not execute
research calculations yet. Explain the goal, assumptions, core stages and
completion evidence; identify scientific choices I still need to make.
Draft the Task Spec and show the exact normalized Confirmed Envelope,
resource limits and SHA-256. Wait for my explicit confirmation.
```

A draft Run is not authorization. Before confirming, inspect the scientific commitments, methods/software, capabilities, HPC profile if any, per-job cores and wall-time, concurrency/retry limits, protected paths, researcher gates and completion evidence. You can then say:

```text
I confirm this Run's Envelope with SHA-256 <full hash>.
Proceed autonomously inside this boundary. If scientific commitments,
methods/software, resources, permissions, protected paths or completion
evidence need to change, show me the difference before proceeding.
```

Confirmation applies once to the precise Envelope. The agent can then diagnose, reorganize its Working Plan and execute inside that boundary without per-command approvals. A genuine boundary change requires a revised Envelope and researcher decision.

## 6. Observe, recover and finish

The Task workflow shows scientific stages; Agent Runs shows Task Spec, Actions, Jobs and Events; pending items distinguish agent troubleshooting from researcher decisions; Evidence shows artifacts, hashes, validity and validators. HPC shows registered boundaries and recorded state. Run authorization, submission, cancellation and reconciliation happen in the Codex conversation through the CLI.

After an interruption, use:

```text
Recover Workbench Task <task-id> using skills/workbench-agent/SKILL.md.
Run doctor and compact context; inspect the current Run, Envelope hash,
Working Plan, pending items and active/uncertain Jobs. Continue within the
confirmed boundary. Do not rely on chat memory or resubmit uncertain Jobs.
```

Full Codex transcripts are not stored in Git or Workbench by default. Workbench records necessary summaries, hashes, times and optional conversation references. Runtime SQLite data lives in ignored `data/` unless configured elsewhere. A conversation becomes a repository file only when explicitly saved and added to Git.

Before accepting completion, check that evidence supports the original question, source files are locatable, failures/retries retain provenance, and any remote heartbeat has been deleted and closed after all Jobs finish. A mock, file existence or zero process exit code does not establish physical correctness.

Next: [usage guide](USAGE_GUIDE.en.md), [remote compute](REMOTE_COMPUTE.en.md), [testing](../TESTING.en.md).
