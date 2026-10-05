# Usage guide: planning, research records and long-running work

English | [中文](USAGE_GUIDE.md)

Start with [first use](GETTING_STARTED.en.md). The application separates scientific intent, stable workflow structure and the current execution strategy.

| Record | Purpose | Example |
| --- | --- | --- |
| Research Plan | Scientific question, assumptions, methods, comparisons and uncertainty | U/J choices, convergence design, candidate mechanism |
| Core Workflow | Necessary scientific stages, software conversions and decisive checks | Model, solve, validate, interpret |
| Confirmed Envelope | Researcher-confirmed commitments and execution limits | Capabilities, software, resource limits, protected paths |
| Working Plan | Agent-maintained strategy inside the Envelope | Directory layout, next calculations, diagnostics |
| Event | Append-only fact, inference or decision | Transfer completed, command failed, boundary confirmed |
| Action | Durable scientific milestone with immutable spec and provenance | Submission, scientific retry, scan batch, evidence validation |
| Job | Scheduler instance associated with an Action | An LSF Job; an Action can have zero, one or many Jobs |
| Artifact / Evidence | Output and its validation | Result file/hash, convergence or derivation check |
| Pending item | Unresolved issue with an owner | Agent debugging or a researcher boundary decision |

Research Plan + core Workflow inform the Task Spec. Its Envelope constrains a Run; the Working Plan evolves within it. The timeline records what happened, while the workflow records what scientific stages must be covered. Pure local analysis or theoretical work does not require a remote Job.

## Revising a plan without losing provenance

Reordering work, changing Task-local directories or choosing a smaller diagnostic normally changes the Working Plan. Changing scientific commitments, methods/software, resource or permission limits, protected paths, completion evidence or researcher gates changes the Envelope and requires renewed confirmation. An Action is not a per-command permission ticket.

Ordinary connection/authentication/transfer failures are Events and do not consume scientific retry budgets. Replacing a failed scientific calculation creates a new Action with `--retry-of`; never overwrite the failed spec, branch retry chains or exceed `maxAutomaticRetries`. Mark affected artifacts `suspect`, `invalid` or `superseded`, retain their provenance and recompute only what is affected.

`submission_uncertain` means reconcile the existing Job's unique recorded identity. It never means try another submission. Candidate experience is a scoped troubleshooting clue, not proof or a researcher conclusion.

## Designing a workflow

The UI edits existing templates and individual Task workflows; it has no blank-template creation button. For a first experiment, create a Task from the closest template and review a proposed Task-level edit before using it. This preserves other Tasks and global templates. Tasks with Run history should be archived instead of deleted.

Use a prompt such as:

```text
Design a core Workbench workflow for <scientific objective>. Read the current
Workflow types and closest template first. Propose scope, necessary stages,
completion conditions, steps, inputs, outputs and decisive checks. Explain
what belongs in the Research Plan, Working Plan or Event/Action instead.
Identify missing checks that could lead to a false conclusion and whether a
new template is justified rather than a Task snapshot edit. Do not hardcode
materials, Task IDs, local paths or unexplained physics parameters. Do not
turn SSH, transfers, polling, scan points or retries into workflow nodes.
```

After a Task-level design has worked, contributors can add a generic template with unique IDs to `src/data/workflows.ts` and the public `WORKFLOWS` registry. Update locale presentation, structural tests and documentation; verify it with disposable data, lint and build. Do not edit SQLite to distribute a new template. Keep claims about scope and scientific validation proportional to actual evidence.

## Theoretical and literature research

The [literature skill](../skills/literature-research/SKILL.md) maps claims to primary sources, identifies closest prior work and records access limitations. A snippet or abstract cannot silently become full-text evidence, and missing papers keep relevant novelty claims provisional.

The [derivation skill](../skills/theory-derivation/SKILL.md) keeps assumptions, conventions and human-readable reasoning explicit, discovers installed tools, and seeks independent checks for central claims. Distinguish analytic proof, computer-assisted derivation, numerical evidence and conjecture. No WSL distribution, notebook kernel or licensed algebra system is assumed.

For reviewed theoretical Runs, the Envelope's `scientificGoal` preserves the original question, criteria and accepted answer types across routes. Use stage reflections (`stay`, `loop`, `proceed`) and the task research map to learn from failed hypotheses without narrowing the goal to whatever result is currently available. Closing a route is not answering the original question. See the [theoretical research protocol](../skills/workbench-agent/references/theoretical-research.md).

## Long-running work and recovery

An agent host may provide a long-running conversation mode, but host features do not expand filesystem, network or Envelope authorization. Frame a persistent instruction with an outcome, constraints and evidence:

```text
Advance Task <task-id> until its original completion evidence is satisfied
inside the confirmed Envelope, or a specific researcher decision is required.
Follow AGENTS.md and workbench-agent. Never access SQLite directly, escape
Task roots, resubmit uncertain Jobs or equate files/exit codes with an answer.
Keep artifacts and retry lineage traceable. Preserve partial evidence and
record any real blocker; do not label an unanswered question complete.
```

Three separate mechanisms matter: the conversation pursues the objective; Workbench `scientificGoal` preserves the scientific contract; a current-chat heartbeat wakes the agent for remote Jobs. WebUI and Express do not replace that heartbeat.

Only create a heartbeat after the first nonterminal remote Job exists, and use one per Run. The Agent selects each Job's estimate, first check and RUN/PEND intervals from its actual scale and history. Follow `monitor directive`, verify the real automation is ACTIVE, then attach its returned reference and actual cadence. Workbench `next_check_at` decides whether a wake-up contacts HPC. If the host cannot support the requested cadence or lifecycle, record that limitation and resolve monitoring before treating it as active.

When every Job is terminal and no continuation Job is created, delete the automation and record `monitor close` after deletion succeeds. Do not invent success when a host only supports pausing. Read the [monitoring protocol](../skills/workbench-agent/references/monitoring.md).

After interruptions, run `doctor` and compact `context` before continuing. Avoid two conversations writing the same Task root, Run or remote directory. Use independent Tasks for independent goals. Pending items with `audience=codex` are for the agent to resolve; `audience=researcher` marks a substantive decision.

For DFT+DMFT, the default post-iteration review plots convergence and observables over all iterations (emphasizing the last 5–10), plus final self-energy and impurity/local Green functions. Report preliminary trends and limits. More extensive audits require an observed anomaly, explicit request or formal acceptance need; a quick plot is not statistical convergence proof.

Next: [remote configuration](REMOTE_COMPUTE.en.md), [Task and Run model](TASKS.en.md), [architecture](ARCHITECTURE.en.md), [test boundaries](../TESTING.en.md).
