---
name: theory-derivation
description: Assist theoretical-physics derivations with symbolic algebra, group theory, complex analysis, operator algebra, constraint solving, and numerical cross-checks. Use for 理论推导、公式验证、群论、复变函数、算符代数、费曼图相关代数或可计算的理论一致性检查; do not use for routine DFT/DMFT production calculations without a derivation task.
---

# Theory Derivation

Use computational tools as assistants to a transparent theoretical argument. Choose the smallest backend that materially improves the derivation or its verification; do not run every available tool by default.

## Workflow

1. State the mathematical object, assumptions, parameter domain, conventions, and the claim to derive or test before encoding it.
2. Read [references/tool-routing.md](references/tool-routing.md) and select a primary backend from the task type. Use the documented WSL environment as the default execution entry.
3. Keep the human-readable derivation primary. Preserve the equations and reasoning needed to understand why the result follows; a computer output alone is not a proof.
4. For a conclusion that materially supports the research claim, perform at least one independent check when feasible: another backend, an alternative representation, an exact or controlled limit, a high-precision numerical spot check, or direct substitution.
5. Save reusable inputs and outputs as evidence when working inside a research task: source script or notebook, relevant output, assumptions, tool/version information, and an interpretation of what was and was not established.

## Result labels

Distinguish these explicitly:

- **Analytic result:** the argument is available independently of the software.
- **Computer-assisted derivation:** a symbolic or exact computation is an essential step; preserve its input and independently test critical transformations.
- **Numerical evidence:** finite samples or approximations support the claim but do not prove it outside the tested domain.
- **Unverified conjecture:** the proposed statement has not passed an adequate check.

Never present successful simplification at sample points as a general identity. Track branch choices, regularity assumptions, convergence domains, regulator prescriptions, basis conventions, and numerical tolerances whenever they affect the result.

If the preferred backend is unavailable, continue with a suitable installed alternative when that does not change the scientific claim. Record the limitation; do not install, update, or replace environments unless the user has authorized that environment change.
