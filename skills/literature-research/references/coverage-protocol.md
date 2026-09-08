# Coverage and evidence protocol

Use this protocol for substantial literature reviews and novelty checks. Scale the breadth to the scientific risk: a paper-level novelty claim needs stronger coverage than background for a toy calculation.

## 1. Define the claim space

Write the central claims before searching. For each claim, record:

- phenomenon or observable;
- proposed mechanism;
- theoretical model or material/system class;
- method and approximation level;
- parameter, energy, temperature, frequency, or dimensional regime;
- type of contribution: existence, mechanism, derivation, scaling, prediction, or interpretation.

Generate vocabulary along independent axes rather than relying on one preferred term:

- current term, historical term, synonyms, spelling variants, and neighboring-community terminology;
- observable-first, mechanism-first, model-first, method-first, and material-first formulations;
- positive, negative, null-result, failure, controversy, alternative-mechanism, and critique terms.

## 2. Discovery routes

Use the smallest set of routes that establishes coverage, but do not rely on a single query family.

1. **Anchor map:** recent reviews, landmark papers, and authoritative overview sources establish terminology and major research lines.
2. **Direct nearest-work search:** search combinations that reproduce the actual proposed claim, including its mechanism, method, system, and regime.
3. **Backward chaining:** inspect the references supporting the closest paper's central mechanism and method.
4. **Forward chaining:** identify later papers that extend, contradict, reinterpret, or apply the closest paper.
5. **Competing explanations:** search for alternative mechanisms, negative results, limitations, comments, replies, and benchmark failures.
6. **Research-line tracing:** inspect the main author groups and vocabulary changes when a concept may have been studied under another name.
7. **Recency pass:** verify that no recent primary work supersedes the novelty statement.

For every network operation, use the browsing and retrieval tools available on the current Codex host and follow their safety rules. If `$web-access` is installed, use it as the preferred browser workflow. Prefer original journal or preprint pages, DOI records, authors' manuscripts, and primary repositories over aggregators. Feedly-style recommendation streams may support current awareness but cannot establish completeness by themselves.

## 3. Retrieval and verification

Verify bibliographic identity before using a paper: title, authors, year, venue, DOI or stable identifier, and version when relevant.

Label access and evidence level explicitly:

- `full_text`: decisive passage, equation, method, or figure inspected;
- `abstract_only`: useful for discovery or a limited high-level claim, not detailed mechanism attribution;
- `metadata_only`: identity known but scientific content not verified;
- `citation_context`: another author describes the work; treat as indirect evidence;
- `unavailable`: the needed content could not yet be inspected.

For non-open-access or subscription material, invoke `$instsci` and follow its visible-browser and institutional-access rules. If retrieval needs researcher login or the route fails, continue the remaining review and record the item rather than stopping the whole run.

## 4. Evidence matrix

Maintain one row per paper-claim relation, not merely one row per paper. Recommended fields:

| Field | Meaning |
|---|---|
| citation / DOI | Stable identity |
| target claim | The current research claim being assessed |
| paper claim | What the source actually establishes |
| system and regime | Material/model, dimension, parameters, temperature/frequency domain |
| method | Analytic, numerical, experimental, approximation, or data source |
| relation | `supports`, `limits`, `contradicts`, `alternative`, or `background` |
| evidence level | Full text, abstract only, metadata, citation context, unavailable |
| decisive location | Section, equation, figure, appendix, or concise evidence pointer |
| limitations | Assumptions and reasons it may not transfer to the present claim |

Keep fact, source-supported interpretation, and the researcher's inference separate.

## 5. Closest-prior-work audit

For each central proposed contribution, compare the strongest prior work along the same axes: object, mechanism, method, regime, observable, and conclusion.

Assign one status:

- `known`: the substantive claim is already established;
- `partial`: important ingredients exist, but a clearly stated dimension remains unestablished;
- `new`: no closer verified work was found after saturation, and the exact increment is stated narrowly;
- `conflict`: credible prior evidence challenges the proposed claim or its assumptions.

Record why the nearest work does not already imply the proposed result. Differences in notation, material name, numerical value, or presentation are not automatically scientific novelty.

## 6. Longitudinal-horizontal synthesis

Use this lens after the evidence matrix and closest-prior-work audit when the task must explain how a scientific field developed, why competing routes differ, or how past choices constrain the current frontier. It is a synthesis layer, not a substitute for source discovery or an extra search quota.

### Longitudinal axis: scientific evolution

Trace only developments that change the scientific claim or available capability:

1. **Origin:** what unresolved observation, theoretical inconsistency, or technical need produced the research direction; identify the initiating papers and key contributors.
2. **Turning points:** which theoretical, numerical, experimental, or instrumental advances changed the accepted picture; include important failures, null results, disputes, and abandoned routes.
3. **Path dependence:** which early assumptions, model choices, observables, approximations, or technical limitations became durable capabilities, conventions, blind spots, or burdens.

Build a concise evidence-linked timeline when this axis matters. Separate the dated event, its source-supported consequence, and the researcher's inference about its later influence.

### Horizontal axis: comparable scientific routes

Choose comparators because they are close along the dimensions relevant to the present claim, not merely because they are famous. Comparators may be competing theories, methods, models, material classes, experimental probes, or interpretations.

1. Explain why each comparator is scientifically diagnostic.
2. Compare all selected routes on the same dimensions: degrees of freedom, symmetry, mechanism, method, approximation, regime, observable, evidence quality, predictive power, and limitations.
3. Explain with evidence why a route was adopted, retained, modified, abandoned, or superseded. Do not replace scientific reasons with popularity or citation counts.

### Joint synthesis

Combine the axes to assess:

- how historically accumulated assumptions and capabilities constrain present conclusions;
- which plausible research directions remain open under the verified evidence;
- for each direction, the prerequisite, discriminating calculation or experiment, expected signature, and evidence that would warn against or falsify it.

Do not force a fixed number of future paths. Distinguish source-supported projection from researcher inference, state the literature cutoff date, and keep unresolved conflicts or unavailable decisive sources visible. Use a timeline, comparison table, or long narrative only when it improves the scientific decision; do not impose a fixed report length.

## 7. Semantic saturation

Coverage is sufficient for the current decision only when all of the following hold:

- every central claim has a verified closest-prior-work entry;
- landmark, recent, and credible competing or limiting evidence have been considered;
- backward and forward chasing of the nearest papers no longer reveals a new mechanism, research line, or closer predecessor;
- independent query formulations mostly return already represented categories rather than new categories of evidence;
- decisive novelty claims do not depend silently on abstract-only or inaccessible evidence;
- unavailable relevant papers are listed with their DOI, missing evidence, attempted route, and possible impact;
- the remaining uncertainty is stated and does not exceed the confidence of the conclusion.

Saturation is semantic, not a paper-count quota. Do not manufacture searches to hit a number, and do not claim exhaustive coverage.

## 8. Reopen conditions

Repeat the nearest-work and competing-evidence audit when any of these changes materially:

- the central mechanism or claimed causal chain;
- the model, dimensionality, symmetry class, or material scope;
- the method or approximation level that defines the contribution;
- the observable, scaling law, collective mode, or experimental prediction;
- a new idea produced during derivation or reflection.

When a new paper changes a premise, update the research claim and return to the earliest affected stage rather than appending an isolated citation at release time.
