# Theory-derivation tool routing

Use this reference only after `theory-derivation` has triggered. It records the reusable local entry points and the decision rules for choosing a backend.

## Execution entry points

Discover the tools available on the current Codex host before choosing a backend. Prefer the project's declared environment or an existing reproducible environment; do not assume WSL, Conda, Mathematica, or a particular filesystem layout is present.

Useful read-only discovery commands include `python --version`, `python -m pip show <package>`, `command -v <tool>` on POSIX systems, and `Get-Command <tool>` in PowerShell. Record the actual executable and version used in the task evidence.

When a task already defines an environment runner such as `conda run`, `micromamba run`, a container command, a module-loaded HPC shell, or a project script, use that stable non-interactive entry point. Do not install or replace scientific software unless the researcher explicitly authorizes the environment change.

On Windows/WSL combinations, convert paths explicitly and prefer a saved script or notebook over deeply nested cross-shell quoting. Treat Mathematica and other licensed systems as optional backends; use them only when they are installed and licensed in the current environment.

## Route by mathematical task

| Task | Primary choice | Escalation or independent check | Important cautions |
|---|---|---|---|
| Transparent symbolic algebra, differentiation, series, elementary integrals, equation manipulation | SymPy | Mathematica or direct substitution/high-precision sampling | Declare symbol assumptions; inspect unevaluated conditions and piecewise results. |
| Difficult symbolic integrals, special functions, differential equations, aggressive simplification | Mathematica | SymPy, mpmath, or controlled limits | Track `$Assumptions`, branches, conditions, and Mathematica 11.1 compatibility. |
| Exact rings, fields, polynomials, algebraic numbers, number theory | SageMath / python-flint | Mathematica or independent exact substitution | Prefer exact rationals and algebraic objects over floating-point coercion. |
| Abstract groups, representations, character tables, cosets, finite-group enumeration | GAP through SageMath or standalone GAP | Hand checks for generators/relations and low-order cases | Record group presentation, representation basis, and convention for characters. |
| Crystallographic space-group operations | spglib, then Sage/GAP for abstract structure | Explicit operation multiplication and symmetry action on the model | Distinguish crystal operations from the magnetic group and antiunitary extensions. |
| Linear algebra, spectra, roots, quadrature, optimization, ODEs | NumPy/SciPy | mpmath high precision, exact limits, or Mathematica | Report truncation, discretization, conditioning, tolerances, and convergence. |
| Complex analysis, analytic continuation, poles, residues, branch cuts | SymPy or Mathematica for symbolic work; mpmath for contour/precision checks | Residue/contour calculation in a second representation and convergence tests | State the sheet, contour orientation, (i0^+\) prescription, and excluded singularities. |
| Fermionic creation/annihilation algebra, normal ordering, second quantization | OpenFermion | Hand calculation for a small operator string or matrix representation | Declare orbital ordering, anticommutation conventions, and coefficient type. |
| Finite Hilbert-space quantum dynamics, master equations, small exact diagonalization | QuTiP with NumPy/SciPy | Symmetry blocks, conservation checks, or an independent matrix construction | State basis ordering, truncation, solver tolerance, and open-system convention. |
| Logical constraints, discrete case splits, finite enumeration, consistency of assumptions | Z3 | Direct enumeration or constructive proof | Z3 does not prove general continuous analytic claims unless they are faithfully encoded in a supported theory. |
| Graph structure, dependency graphs, diagram topology, derivation maps | NetworkX; Graphviz for rendering | Manual inspection of small graphs | A graph visualization is explanatory evidence, not a physical derivation. |
| Reproducible exploration and teaching derivations | Jupyter kernel `Python (theory_derivation_env, WSL)` | Export the decisive calculation to a small script for regression checking | Keep notebook execution order clean and record environment versions. |

## Physics-specific routing

- **Symmetry classification:** use Sage/GAP for finite groups and representations; use spglib for crystallographic operations. Verify the representation acts on the stated basis and leaves the Hamiltonian or action invariant.
- **Perturbation and asymptotics:** derive the ordering and small parameter analytically; use SymPy/Mathematica for coefficients and mpmath/NumPy for the domain where the truncation is accurate.
- **Green functions and response poles:** use symbolic tools for denominator structure and residues, then scan roots at higher precision. Check causality, conjugation relations, spectral signs, and movement under controlled parameter changes.
- **Operator and many-body algebra:** use OpenFermion for finite fermionic strings and QuTiP for explicit finite matrices. Preserve spin/orbital/site ordering and do not extrapolate finite truncations without an argument.
- **Feynman-diagram work:** no dedicated Cadabra, FORM, QGRAF, or pySecDec backend is currently guaranteed. Use installed tools for small algebraic and numerical checks, but identify the missing specialized capability instead of pretending a full diagram-generation or multiloop-reduction workflow is available.
- **Computer-assisted theorem checks:** encode only the part the backend can represent faithfully. State which implication was checked and which analytic steps remain outside the solver.

## Minimum verification record

For each claim that depends materially on a tool, preserve:

1. the exact assumptions, domain, basis, conventions, and target identity or observable;
2. the executable script/notebook or concise backend input;
3. tool and version information sufficient to reproduce the result;
4. the decisive output rather than an unfiltered full log;
5. at least one independent check for a central claim when feasible;
6. a short statement of what the computation establishes and what it does not.

Useful independent checks include substitution back into the defining equation, exact low-dimensional cases, weak/strong-coupling limits, symmetry transformations, sum rules, high-precision sampling away from singular sets, and comparison between two algebraically independent representations.
