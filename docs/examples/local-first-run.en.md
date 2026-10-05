# Local-only onboarding example

[English first-use guide](../GETTING_STARTED.en.md) | [中文入门](../GETTING_STARTED.md)

This example uses Node.js and a disposable database. It does not contact a cluster, create an automation or require research accounts. The numerical illustration is a finite-difference check for a harmonic oscillator, not a DFT+DMFT calculation.

## Check the local numerical example

From the repository root:

```shell
node docs/examples/oscillator-check.mjs
```

It prints JSON without creating files. `passed: true` means that halving the finite-difference spacing reduces the tested residual by approximately four at one chosen time, consistent with second-order truncation. It does not prove general numerical stability or validate a physical solver.

## Start a disposable Workbench

After `npm ci` and `npm run build`, choose a free port (this example uses 3101). In PowerShell:

```powershell
$demoRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('cpw-demo-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $demoRoot | Out-Null
$env:WORKBENCH_DB_PATH = Join-Path $demoRoot 'workbench.db'
$env:WORKBENCH_PORT = '3101'
$env:WORKBENCH_ALLOWED_ORIGINS = 'http://127.0.0.1:3101'
$env:WORKBENCH_REMOTE_DISABLED = '1'
Write-Host ('Disposable directory: ' + $demoRoot)
npm start
```

In a POSIX shell:

```sh
demo_root=$(mktemp -d)
printf 'Disposable directory: %s\n' "$demo_root"
WORKBENCH_DB_PATH="$demo_root/workbench.db" WORKBENCH_PORT=3101 \
WORKBENCH_ALLOWED_ORIGINS=http://127.0.0.1:3101 WORKBENCH_REMOTE_DISABLED=1 npm start
```

Open <http://127.0.0.1:3101> and select English. In a second terminal in the checkout, verify the service:

```powershell
$env:WORKBENCH_URL = 'http://127.0.0.1:3101'
node bin/workbench.js doctor --lang en --pretty
```

POSIX equivalent:

```sh
WORKBENCH_URL=http://127.0.0.1:3101 node bin/workbench.js doctor --lang en --pretty
```

Create a Project named `Local oscillator demo` using a new dedicated `research` subdirectory of the printed disposable directory as its absolute working directory. Create a theoretical-research Task and a linked Research Plan. A suitable goal is: derive the harmonic-oscillator solution under stated initial conditions and explain the observed finite-difference order; success requires the derivation, reproducible script and limitations. Explicitly exclude a claim about real-material physics.

Follow the [draft and confirmation steps](../GETTING_STARTED.en.md#5-ask-codex-to-draft-the-run). Ask the agent for a local-only Envelope, no remote capabilities and no scheduled heartbeat. The agent must derive the actual Task Spec from the execution contract; a ready-made JSON fixture is not researcher authorization. After confirmation it may copy the example into the Task root, execute it there and record its output/evidence alongside the derivation.

Switch between English and Chinese and refresh. The selected UI language should persist; your English Project name, plan and evidence should remain unchanged. Review the Task, Research Plans, Agent Runs, pending items and Evidence pages. No Run/job execution buttons should appear in the review UI.

Stop the server with Ctrl+C when finished. Close the demo terminals to discard their process-local environment settings. Retain the printed temporary directory until you have reviewed it; this walkthrough does not automatically delete directories or alter the default database.
