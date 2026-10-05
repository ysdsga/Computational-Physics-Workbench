# Remote compute: connection, transfer and agent collaboration

English | [中文](REMOTE_COMPUTE.md)

The supported reference path is local OpenSSH/SFTP with IBM LSF. Slurm and PBS are rejected; changing a scheduler name does not provide an adapter. Workbench stores connection metadata and Task directory bindings, not passwords, private keys or one-time codes. The current Codex conversation operates through the CLI; WebUI observes recorded state.

## Local service configuration

Set environment variables in the shell that starts the relevant process. Restart that process after changes. The application does not automatically load a `.env` file.

| Variable / setting | Default | Purpose |
| --- | --- | --- |
| `WORKBENCH_DB_PATH` | `data/workbench.db` in the checkout | SQLite path; use an absolute disposable path for experiments/tests |
| `WORKBENCH_HOST` | `127.0.0.1` | Server bind address |
| `WORKBENCH_PORT` | `3001` | Backend port; tests may use `0` for an allocated port |
| `WORKBENCH_URL` | `http://127.0.0.1:3001` | CLI service URL; set this in the CLI shell for another port |
| `WORKBENCH_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Complete comma-separated browser-origin allowlist; replaces defaults; backend/custom ports are not added automatically |
| `WORKBENCH_LANG` | `en` for CLI/server messages | `en` or `zh-CN`; CLI `--lang` overrides the environment |
| browser `workbench.locale` | Browser language, then English fallback | Browser language selection, independent of CLI settings |
| `WORKBENCH_REMOTE_DISABLED=1` | Unset | Disable remote execution |
| `WORKBENCH_REMOTE_SUBMIT_DISABLED=1` | Unset | Disable remote submissions |
| `WORKBENCH_LOCAL_EXEC_ENABLED=1` | Unset | Opt in to executor `local.process` capability; does not replace Envelope confirmation |
| `WORKBENCH_LOCAL_EXECUTABLES` | `python,python3` | Allowed executable names for `local.process` |

CLI JSON field names, IDs, hashes and status codes stay stable across languages. `--lang` sends `Accept-Language` for generated service prose; existing research data stays unchanged. Direct API clients without a supported language preference retain the existing Chinese generated defaults. Many technical errors and all CLI help remain English. Action responses expose localized explanatory text at top-level `executionPreview`; the raw `action.spec.executionPreview` remains in its recorded language to preserve the immutable spec and hash.

Changing `WORKBENCH_PORT` does not automatically change the Vite proxy target. For a custom-port demonstration, build and use the backend's production page and set `WORKBENCH_URL` to match.

`Origin is not allowed by Workbench` is a browser-origin configuration failure, not an SSH/account/file permission error. The unchanged default allows only the two development origins above. A built page on port 3001 (or another backend port) can load while browser writes with that Origin are rejected. For a disposable local preview, set only its exact origin in that terminal before starting the server, for example `$env:WORKBENCH_ALLOWED_ORIGINS='http://127.0.0.1:3001'` in PowerShell. This replaces, rather than extends, defaults and lasts for that shell and its child processes; close the terminal afterwards. Do not change global/production settings to follow a preview example. Match protocol, hostname and port exactly; do not allow arbitrary public origins. CLI does not send a browser Origin, but still enforces all Task/Envelope boundaries.

## 1. Prepare an SSH connection

Give the agent the login address or existing SSH alias, username, authentication type (key/password/MFA/jump host), remote user root, project root and Workbench Project/Task. Do not paste credentials. A useful request is:

```text
Help configure this LSF cluster for Workbench Task <task-id>.
SSH alias/login: <value>; username: <value>; authentication type: <type>;
user root: <absolute remote path>; project root: <absolute remote path>.
Inspect existing OpenSSH configuration without overwriting it. Show any
proposed alias changes first. Let me verify the first host key and complete
password/MFA myself. After read-only connection checks, register the profile
and Task binding with workbench hpc configure. Draft the remote Envelope
with resource limits for my confirmation before uploads or job changes.
```

For manual diagnosis, use `Get-Command ssh,sftp` in PowerShell or `command -v ssh sftp` in a POSIX shell. A minimal user-owned SSH config entry is:

```sshconfig
Host my-lsf
  HostName login.example.edu
  User your_username
  IdentityFile ~/.ssh/id_ed25519_hpc
  IdentitiesOnly yes
```

Use an existing key and your center's instructions; do not overwrite configuration or generate credentials casually. Add `ProxyJump` only when required. First connect in your own terminal with `ssh my-lsf` and verify the fingerprint against the center's published value. Workbench uses strict host-key checking and noninteractive authentication; it does not accept unknown keys or prompt for MFA. Establish suitable authentication using your center's supported method first.

## 2. Register boundaries and confirm capabilities

The agent can use `hpc configure`, or you can edit connection metadata on the HPC page. A profile stores a display name, OpenSSH alias, user read root, project root, LSF scheduler and nonsecret notes. A Task binding stores a single safe directory name beneath the project root.

| Remote level | Example | Boundary |
| --- | --- | --- |
| User root | `/home/researcher` | Maximum read/download scope |
| Project root | `/home/researcher/project-a` | Read-only Project scope; must be inside user root |
| Task root | `/home/researcher/project-a/task-001` | Sole write/upload/job root; a direct child of project root |

User and project roots must already exist. Task names cannot contain separators, `..` or newlines, and different Tasks cannot share a write root. Shared pseudopotential or software directories are not Task write roots. Registration records a boundary; it does not authorize execution.

The Envelope must explicitly authorize required capabilities: `remote.inspect`, `remote.task-root.create`, `files.upload`, `files.download`, `job.submit` and/or `job.cancel`. Bind the correct HPC profile and specify per-job cores/wall-time, concurrency, automatic scientific retries and protected paths. Confirm the exact normalized Envelope hash in the conversation before execution.

## 3. Execute and transfer inside the Task boundary

These are agent examples with placeholders, not commands to run before confirmation:

```shell
workbench remote session --task <task-id>
workbench remote init --task <task-id>
workbench remote exec --task <task-id> --scope task --access read --command "pwd"
workbench remote upload --task <task-id> --local inputs/model.in --remote inputs/model.in
workbench remote download --task <task-id> --remote results/output.dat --local results/output.dat
```

Local transfer paths are Task-relative; remote paths are relative to the selected registered root. Parent directories may be created within boundaries. Existing targets are refused unless an explicitly justified `--overwrite` is used. Downloads may select `--scope user` or `--scope project` for shared read-only inputs. Remote writes use only `--scope task --access write`.

Routine commands and transfers append Events and do not need Actions. They cannot bypass Job tracking by running `bsub`, `bkill`, `qsub`, `qdel`, `sbatch` or `scancel`; submission/cancellation uses dedicated Actions. If the transport wrapper breaks, direct SSH/SFTP diagnosis is allowed only within the same confirmed boundary and must be recorded; it does not authorize direct scheduler changes.

## 4. Submit, monitor and reconcile

LSF scripts must declare `#BSUB -n` and `#BSUB -W HH:MM` within the confirmed limits. The agent reads `execution contract`, prepares an immutable Action and executes it through the CLI. Each submission includes estimated duration, first check, RUN/PEND intervals and a rationale tailored to the task.

After the first nonterminal Job, the agent follows `monitor directive`, creates/reuses one heartbeat for this Run in the current conversation, verifies ACTIVE state and attaches its actual reference/cadence. Workbench owns durable due times; host scheduling wakes the agent. Check the host's scheduling limits before relying on a cadence. Unsupported scheduling or deletion must be reported, never claimed to work. When all Jobs finish and no continuation is created, delete the heartbeat and record successful `monitor close`.

An uncertain submission can only be reconciled by its existing recorded name/ID. Never resubmit to test whether the first request succeeded. Scientific replacement Actions preserve `--retry-of` and the Envelope's retry budget. See [monitoring](../skills/workbench-agent/references/monitoring.md).

## Troubleshooting

| Symptom | Check / next action |
| --- | --- |
| `Cannot reach Workbench` / CLI exit 5 | Start the service and check `WORKBENCH_URL`, host and port before more remote work |
| `Origin is not allowed by Workbench` | Exact browser URL and complete `WORKBENCH_ALLOWED_ORIGINS`; restart server |
| Host-key verification failure | Verify/register the correct fingerprint personally; do not disable checking |
| Authentication failure | Test the same alias in the same user environment and establish supported noninteractive authentication |
| Profile/binding mismatch | Compare Task, profile, roots and confirmed Envelope |
| Path escape / protected path | Check relative paths, symlinks and protection; do not bypass the boundary |
| File exists | Decide whether replacement is scientifically justified before overwrite |
| Unsupported scheduler | Use LSF; other adapters are not implemented |
| Submission uncertain | Reconcile the existing identity, never blindly retry |
| CLI exit 4 | Read Context/pending items; a recorded boundary or condition blocks the operation |
| No Web submit/cancel/transfer button | Give the concrete request to the Codex agent; this is the intended execution boundary |

Never use the CLI or direct SSH to bypass an unconfirmed Envelope, unauthorized capability, protected path or resource limit. Return to [first use](GETTING_STARTED.en.md) or [usage](USAGE_GUIDE.en.md).
