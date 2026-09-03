# Contributing to DFT+DMFT Workbench

感谢你愿意参与建设。这个项目正在从 DFT+DMFT 工作台发展为一个面向计算物理与理论物理的 Agent 协作研究系统：Agent 负责计划和执行，研究者负责科学承诺、关键判断与证据审阅。

The project welcomes focused contributions that improve reproducibility, scientific traceability, agent safety, workflow portability, documentation, and support for additional physics methods.

## Before opening a pull request

- Search existing issues and pull requests to avoid duplicate work.
- For a substantial feature or architectural change, open a discussion issue first. A prototype is welcome, but maintainers cannot promise that every large proposal will be merged.
- Never include real credentials, private keys, HPC host details, unpublished research data, user databases, or calculation outputs.
- Do not silently choose or "correct" scientific parameters. State the physical basis, assumptions, applicable scope, and evidence for changes that affect scientific results.

## Development workflow

1. Fork the repository and create a short-lived branch from `main`.
2. Keep each pull request focused on one coherent change.
3. Add or update the smallest useful regression test.
4. Update user-facing or architectural documentation when behavior changes.
5. Run the checks below before requesting review.

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Tests must use disposable databases and temporary directories. They must never reset or write to a contributor's real `data/` or `repository/` directories.

## Pull request expectations

A useful pull request explains:

- the problem and why it matters;
- the chosen design and important alternatives;
- how the change was verified;
- any scientific assumptions, compatibility risks, migrations, or remaining limitations.

Small documentation fixes can be submitted directly. Maintainers may ask that an oversized pull request be split before review.

## Licensing contributions

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project is provided under the Apache License 2.0, without additional terms or conditions, as described in Section 5 of the license.

## Maintenance expectations

This is an early-stage, volunteer-maintained research project. There is no guaranteed response or merge time. Maintainers may close inactive issues or pull requests when they no longer have enough information to act; contributors are welcome to reopen the discussion with a reproducible case or a smaller proposal.
