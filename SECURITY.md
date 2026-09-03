# Security Policy

## Supported versions

Until the first stable release, security fixes are applied to the latest code on `main`. Older development snapshots are not supported.

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, private HPC information, or path-escape details in a public issue.

Use GitHub's private vulnerability reporting for this repository. Include:

- the affected version or commit;
- a minimal reproduction or proof of concept;
- the expected and observed behavior;
- the likely impact;
- any suggested mitigation, if known.

If private vulnerability reporting is unavailable, open a public issue containing no sensitive technical details and ask the maintainer for a private reporting channel.

## Scope priorities

High-priority reports include:

- access outside a Project or Task filesystem boundary;
- unintended execution of shell, SSH, SFTP, LSF, or Agent actions;
- credential or private-key exposure;
- authorization bypass around a Confirmed Envelope;
- corruption or disclosure of SQLite research records;
- unsafe handling of untrusted calculation files or command output.

Reports about scientific correctness are also valuable, but should normally use the regular issue tracker unless exploiting the behavior would create a security impact.
