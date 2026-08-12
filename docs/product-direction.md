# Product direction

This document records Stetra's long-term product positioning, target design,
and evidence-gated evolution. It is a decision frame for future product work,
not a description of already implemented behavior and not blanket
authorization to add every mechanism named here.

The current product kernel is defined in [Architecture](architecture.md), and
the executable protocol is defined in [Change workflow](change-workflow.md).
Where this document describes a larger system, the difference is intentional:
it states the target product boundary and the sequence of hypotheses that must
earn their way into that kernel.

## Positioning

Stetra is a **cognition-preserving adaptive delegation harness for production
coding**.

It should reduce the total cost from developer intent to a high-quality change
that the developer can confidently adopt, while preserving the developer's
first-class understanding of the system and the quality of their engineering
decisions.

The initial MVP is a task-scoped cognition and adoption loop. It combines
authority partitioning, falsifiable Evidence Obligations, selective baseline
facts, explicit post-collection judgment, immutable Attempt and Verification
Definition lineage, fact-triggered Challenge, task-specific Authoring Packets,
Host-attested execution boundaries, a layered handoff, and exact task-scoped
Human decisions and resolutions. That implementation remains narrower than the
long-term product boundary.

Relative to execution Hosts, Stetra is the cognition-preserving delivery and
assurance control plane. It owns the domain-specific delegation control system
without becoming a general coding agent or general Agent Runtime.

## Objective and success contract

The product aims to lower the combined cost of:

- alignment, clarification, and semantic recovery;
- repository investigation and implementation;
- Agent coordination and execution recovery;
- verification and independent challenge;
- developer review and cognition recovery;
- correction and rework;
- expected downstream failure.

It must improve three coequal outcome surfaces:

| Outcome | Question |
|---|---|
| Delivery outcome | Did the Agent produce a more correct, complete, repository-fitting implementation? |
| Adoption efficiency | Can the developer reach a sound adoption decision with less active time and interruption? |
| Cognition preservation | Does the developer still understand the changed behavior, invariants, ownership, control flow, and failure entry points? |

The success contract is conjunctive:

```text
implementation outcome is non-inferior or better
AND Human adoption cost is lower
AND developer cognition is non-inferior
AND adoption authority remains Human
AND evidence provenance remains inspectable
```

A directional North Star is the number of production changes confidently
adopted per active developer hour under those non-degradation constraints.
This is not a Runtime score. Formal evaluation must preserve the raw outcome,
cost, cognition, assurance, and adoption measurements rather than compressing
them into one trust, readiness, confidence, or productivity scalar.

Faster review with worse implementations is failure. Correct code that leaves
the developer unable to explain the system change is failure. A rigorous
handoff that raises total work without improving a real decision is also
failure.

## Durable principles

The present kernel contributes four durable principles:

1. **Authority remains partitioned.** Human decisions, Agent judgment, and
   Runtime facts cannot be relabeled as one another.
2. **Facts remain machine-bound and freshness-bound.** Actual changes, checks,
   attempts, and collection identity come from the workflow that observed
   them, and later edits invalidate dependent conclusions.
3. **Semantic claims expose their evidence boundary.** Material conclusions
   preserve supporting evidence, counterevidence, falsification, and unknowns.
4. **Human adoption remains a separate decision.** Evidence readiness never
   becomes automatic approval.

The initial MVP adds six equally important principles:

5. **Non-passing evidence is judged before it is acted on.** A failed command
   is not itself a diagnosis or authorization to edit code.
6. **Falsifiable Evidence Obligations bound conclusions.** Runtime enforces
   declared coverage and contradiction limits without pretending to prove
   natural-language semantics.
7. **Authoring and handoff minimize ceremony without collapsing authority.**
   Runtime generates boilerplate identities; the developer event remains exact,
   and decision information is layered before raw facts.
8. **Human adoption, correction, and rejection remain exact task-scoped
   authority.** Cross-task activation is deferred until it has an explicit
   Human-authorized consumer and measured benefit.
9. **Verification can be revised without rewriting history.** Semantic,
   verification, and effective identities remain separate; exact Definitions
   supersede rather than overwrite one another.
10. **Host enforcement is attested at the Host boundary.** Thin instructions
    cannot self-promote into enforced policy or independent context provenance.

## Product boundary and Host relationship

Stetra should own:

- delegation semantics and material-fork handling;
- acceptance criteria and their evidence strategies;
- a bounded delivery-plan contract and next-action semantics;
- progress, failure classification, repair, and escalation control;
- repository and execution facts;
- assurance, independent challenge, and evidence coverage;
- cognitive handoff and Human decision capture;
- explicitly scoped activation of adopted decisions and observed outcomes.

The Host can provide:

- the model and context window;
- repository, editor, shell, and tool execution;
- fresh sessions, subagents, or worktrees when available;
- low-level streaming, cancellation, and interaction surfaces.

Stetra does not need to reimplement a model provider, terminal coding agent,
ReAct tool loop, TUI or web chat, generic project manager, broad repository
memory, or worktree fleet scheduler. Codex, Claude Code, Pi, GSD, Trellis, and
similar systems can be execution Hosts behind capability adapters.

The workspace should retain its two-package boundary unless a genuinely
independent consumer and release need emerge. Core remains deterministic and
LLM-free; Host agents retain semantic reasoning. New planning or ledger types
do not by themselves justify another package or another public root API.

## Target architecture: two planes, three graphs, one ledger

```text
+----------------------------------------------------------+
| Host surfaces: Codex / Claude / Pi / GSD / Trellis       |
+---------------------------+------------------------------+
                            | capability adapter
                            v
+----------------------------------------------------------+
| Stetra                                                   |
|                                                          |
| Adaptive Delivery Plane                                  |
|   repository intelligence | acceptance planning         |
|   delivery-plan compiler  | bounded loop controller     |
|                                                          |
| Deterministic Assurance and Decision Plane               |
|   authority and contract  | fact and evidence runtime   |
|   assurance evaluation    | cognitive handoff           |
|   Human adoption boundary                                |
|                                                          |
| Append-only task and run ledger                          |
+----------------------+-------------------+---------------+
                       |                   |
                       v                   v
                repository/checks     Human review
                       |                   |
                       +---------+---------+
                                 v
                         Decision Continuity
```

### Adaptive Delivery Plane

The adaptive plane may:

- investigate the repository and form hypotheses;
- propose acceptance criteria and a Delivery Plan;
- select and invoke controlled execution nodes through a Host;
- revise a local strategy from observed facts;
- diagnose failure and request retry, repair, replan, or escalation;
- initiate a fresh-context challenge.

It may not change an exact Human Event, silently alter compiled task meaning,
lower an Assurance Requirement, invent Runtime facts, erase contrary evidence,
or claim that the Human adopted a result.

Strategy remains Agent judgment. Runtime validates shape, declared authority,
effects, budgets, gates, identity, and transitions; it does not decide the best
engineering design.

### Deterministic Assurance and Decision Plane

The deterministic plane should:

- compile and freeze authority-bearing semantics;
- validate that a Delivery Plan stays within the contract and effect boundary;
- bind typed execution events and artifacts;
- collect repository, check, and environment facts;
- evaluate evidence coverage and structural contradictions;
- produce Attention and readiness for handoff;
- preserve exact Human adoption events and decisions without making them.

It does not implement the change, decide semantic truth, choose long-lived
tradeoffs, or promote an Agent conclusion into a fact.

### Append-only task and run ledger

The initial persistence model is an append-only, task-scoped event ledger with
derived projections. It preserves immutable attempts and allows safe
crash recovery, optimistic concurrency, replay, and lineage without making one
run authoritative for another task.

Illustrative events include:

```text
task-created
human-event-recorded
contract-compiled
baseline-captured
delivery-plan-proposed
delivery-plan-validated
node-started
node-completed
check-attempt-recorded
facts-collected
repair-requested
claim-challenged
handoff-evaluated
correction-requested
adoption-recorded
outcome-observed
```

This vocabulary is staged. The MVP adds only events required by task recovery,
attempt lineage, handoff, and the exact current-task decision. Outcome events
and cross-task activation do not enter the product until P4 has a
Human-authorized consumer and supporting evidence.

Each event needs an identity, prior revision, actor partition, referenced input
and output artifacts, relevant worktree and environment identity, and a
timestamp. A current-state document may remain as a projection for efficient
CLI reads; it must not become a second authority.

This ledger is not a global memory store. Cross-task activation belongs only
to Decision Continuity and requires separate Human-authorized evidence.

## Fixed macro lifecycle, dynamic micro workflow

Stetra should retain a stable governance lifecycle:

```text
Align
  -> Compile Semantic and Acceptance Contract
  -> Compile Delivery Plan
  -> Execute / Observe / Repair
  -> Assure
  -> Cognitive Handoff
  -> Human Decision
  -> Outcome Observation
```

Only the task-local delivery section should dynamically compile to a chain,
conditional chain, bounded loop, or justified DAG:

```text
fixed governance lifecycle + dynamic task-local delivery graph
```

This keeps authority, evidence, adoption, and replay boundaries stable while
allowing execution strategy to respond to repository state and failure.
Dynamicity is not permission to skip lifecycle obligations or let the Agent
choose a cheaper assurance path.

The default remains the smallest useful strategy:

```text
simple task             -> short single-Agent chain
result-dependent task   -> conditional chain and bounded loop
demonstrably separable  -> task-local DAG
```

## Three graphs with distinct authority

The graphs are logical typed relationships. They need not share one storage
engine and do not imply a graph database.

### Delivery Graph

The Delivery Graph is task-scoped, short-lived, and revisioned as Agent
strategy. It answers:

- which action depends on which result;
- which read-only investigations can run independently;
- which writes require isolation or ordered integration;
- where failure should retry, repair, replan, or escalate;
- which gate and budget permits a node to advance.

Declared read and write sets are scheduling and conflict-detection inputs, not
permissions, proof of semantic scope, or a prediction of the final changed
files. Actual collected changes remain authoritative.

### Evidence Graph

The Evidence Graph is attempt- or run-scoped and append-only. It connects:

```text
Human Event
  -> Agent Interpretation
  -> Semantic or Acceptance Requirement
  -> Delivery Node
  -> Changed File / Check Attempt / Observation
  -> Material Claim and Counterevidence
  -> Review Surface
```

It answers where a conclusion came from, which facts support or contradict it,
and which review action can prevent which adoption error. Stable IDs and typed
JSON relationships are sufficient initially.

### Decision Graph

The Decision Graph is longitudinal and Human-authorized. It connects scoped
decisions to the exact adoption, correction, rejection, revert, incident, or
superseding event that gives them authority or changes their validity.

It should be built last. Repeated Agent behavior, generated summaries, passing
checks, or apparent consensus cannot create a decision edge or a delegation
frontier.

## First-class domain objects

The current `SemanticContract`, `FactBundle`, and `CognitiveHandoff` remain the
foundation. The target design adds only objects with concrete execution,
recovery, assurance, review, or activation consumers.

### Acceptance Contract

A verification command is not an acceptance criterion. An Acceptance Contract
should state, for each material or adoption-critical criterion:

- the behavior, invariant, compatibility, ownership, failure-recovery,
  operational, or other adoption-relevant statement;
- its exact Human Event or repository-evidence basis;
- its criticality and adoption rationale;
- the evidence strategy, such as a deterministic check, static analysis,
  runtime probe, independent review, or direct Human inspection;
- the verifier, claim, and review surfaces that consume it.

Passing one verifier can support a criterion without becoming semantic proof.
An unavailable or insufficient verifier remains an explicit evidence gap.

### Delivery Plan IR

The first Delivery Plan should be a declarative intermediate representation,
not arbitrary Agent-generated JavaScript. A plan needs:

- contract and plan identity;
- `chain`, `conditional-chain`, or later `dag` strategy;
- typed nodes such as investigate, design, implement, verify, challenge, and
  synthesize;
- dependencies and typed outputs with concrete consumers;
- declared effects: read-only, local-write, or external-effect;
- Host capability and isolation needs;
- gates and execution budgets;
- maximum attempts and explicit retry, repair, replan, or escalate routes.

Runtime plan validation should detect incompatible parallel writes,
unauthorized external effects, missing consumers, unenforced budgets, missing
critical evidence paths, and any attempt to lower the compiled assurance
contract. A Host Adapter may compile the validated IR to its native workflow,
but the Host-specific script is not the authority source.

### Execution Environment Manifest

Current facts are locally observed and content-bound, not fully reproducible or
externally attested. A bounded environment manifest should bind checks to the
relevant execution context, including where applicable:

- resolved executable identity and version;
- operating system and architecture;
- language and package-manager toolchains;
- lockfile and installed-dependency identity;
- container or image identity;
- explicitly relevant environment-variable names and safe digests.

It must never persist raw secrets or claim that an omitted environment input
cannot matter. Remote attestation is not an initial requirement.

### Host Capability Manifest

Each Adapter should declare the capabilities on which a plan may rely, such as
fresh contexts, subagents, worktree isolation, cancellation, structured
outputs, parallel reads, and external-effect approval. The planner must degrade
to a valid smaller strategy when the Host lacks an optional capability.

### Task and attempt lineage

Completed, rejected, and superseded fact packages remain immutable. A new
repair or Human correction creates a successor attempt linked by explicit
task, parent-attempt, superseded-run, and correction-event identities.

Lineage must answer which request caused which repair, how many correction
rounds occurred, which evidence changed, and which exact attempt the Human
eventually reviewed. It does not permit a later attempt to rewrite an earlier
fact.

### Separate delivery, evidence, and decision states

The initial MVP keeps three state dimensions distinct:

```text
Delivery:  waiting-for-implementation | implementing | repairing
           implementation-complete | exhausted

Evidence:  not-collected | awaiting-evidence-judgment | incomplete | needs-attention
           facts-stale | handoff-ready

Decision:  pending | correction-requested | accepted | rejected | deferred | aborted
```

For example, implementation can be complete while assurance needs attention
and adoption remains pending. No combined `done` state should hide those
differences.

## Bounded feedback loops

The delivery plane should add four loops before it adds a general graph
scheduler.

### Investigation Loop

```text
open question -> hypothesis -> repository probe -> evidence update
              -> sufficient | another probe | material fork
```

The Agent resolves repository-discoverable questions and sends only a material
Human-owned choice back for a decision.

### Implementation Repair Loop

```text
patch -> collect facts -> classify failure -> diagnose -> repair -> recollect
```

It requires enforced attempt and resource budgets, preserved attempts, an
explicit Agent cause judgment, and explicit replan or Human escalation. A
repeated mechanical observation may inform diagnosis but cannot establish
cause or automatically authorize repair. A retry is not a repair, and a
material semantic change is not a retry.

### Independent Challenge Loop

```text
critical claim -> fresh-context falsification attempt
               -> supported | partial | contradicted | unknown
```

The challenger derives its conclusion from named source and evidence rather
than inheriting the implementer's summary. Its output remains Agent judgment
with independent provenance, never a Runtime fact.

### Review Completion Loop

```text
assurance obligations -> coverage analysis -> missing evidence or review
                      -> collect, challenge, inspect, or disclose unknown
```

Assurance obligations are the union of:

```text
explicit semantic requirements
UNION mechanically observed Runtime hazards
UNION disclosed evidence gaps
```

Runtime hazards may arise from exact collected conditions such as a declared
verifier-surface mutation, unavailable check, or unrepresentable change. They
may add evidence obligations but cannot infer Human consequence from keywords,
filenames, dependency counts, path counts, or a score. Repository meaning and
operational hazard remain basis-bearing Agent interpretations.

## Fact-consistent runtime foundation

Adaptive delivery should not be built on ambiguous concurrent or environmental
facts. The following foundations precede broad orchestration.

### Transactional collection and concurrency

Atomic file replacement is not a run-level transaction. Current Prepare and
Collect use one project-worktree lease while observing the shared worktree,
staged artifacts, expected revision, and a short task commit lock. Lease
recovery is based on confirmed process death and process-start identity, never
elapsed age. Conflicting writers are rejected rather than silently overwriting
a newer projection.

A collection transaction should conceptually:

```text
acquire project-worktree lease
  -> capture implementation snapshot
  -> run checks under declared write policy
  -> capture post-check snapshot
  -> classify check-induced mutations
  -> stage complete artifacts
  -> acquire short task commit lock and compare revision
  -> publish artifacts and append event
  -> release task lock and project-worktree lease
```

The repository should not remain globally locked between Agent actions.

### Baseline and current observation

The Git worktree baseline is not a baseline check result. When a before/current
comparison changes adoption, checks should have a traceable prior observation:

- a suitable trusted recent CI result;
- a task-start baseline attempt;
- or an explicit unavailable/unknown baseline.

Baseline execution remains selective and driven by explicit acceptance needs
rather than run for every routine command. Facts keep baseline status, current
status, their mechanical relation, and environment identity distinct. Runtime
does not label the relation a regression or infer its cause. The initial protocol supports
task-start, unknown, and an honest unknown-after-revision observation; trusted
CI remains a later source because the current Host boundary cannot attest it as
a Runtime-observed fact.

### Check side effects

Checks may generate snapshots, format files, repair code, or race with another
writer. Stetra should capture pre-check and post-check state and classify any
mutation against a declared check write policy. Check-generated changes remain
visible facts; classification must not erase them or let direct Host execution
replace a frozen Runtime attempt.

### Canonical persisted schemas and identity

Core should remain the canonical owner of protocol schemas, normalization,
fingerprints, fact binding, and deterministic transition validation. CLI owns
IO, Git, command execution, and storage but should not duplicate identity
rules. Persisted artifacts need complete validation before adaptive execution
or crash recovery relies on them.

This architectural cleanup should happen inside the existing Core and CLI
packages. A new package needs an independent consumer and release boundary.

### Low-friction authoring

The canonical protocol may remain explicit while routine interaction becomes
smaller. A Host may derive a draft contract and handoff from the exact
conversation, repository evidence, and collected facts, while preserving the
original Human Events and every basis. Only material semantic forks,
adoption-changing unknowns, exceptions, or external effects should interrupt
the developer.

Task-specific Authoring Packets should expose exact current identities and the
accepted values or object variants for every unfilled structural choice. They
must not preselect Agent conclusions or Human decisions, and they remain
transient rather than becoming another persisted workflow layer.

They should also place the exact developer event beside the explicitly labeled
Agent interpretation, and tell the Host exactly how to bind the completed draft
to one non-interactive command invocation. Transport boilerplate must not force
an Agent to rediscover schema details or lose the developer's exact wording.

Low friction cannot mean Runtime inference of semantic importance, hidden
facts, automatic adoption, or a weaker evidence boundary.

## Current task-scoped MVP boundary

The initial MVP implements one task-scoped path:

```text
prepare -> Host implementation -> collect -> evidence judgment when needed
        -> optional repair or challenge -> handoff -> Human decide
```

It includes:

- exact-input Prepare replay through an explicit Host request identity, without
  semantic deduplication or repeated baseline execution;
- one exact developer event separated from Host-authored task meaning;
- readable, evidence-directed Adoption Conditions;
- a generated fixed lifecycle with a bounded repair budget;
- selective task-start or unknown check baselines and mechanical comparisons;
- complete baseline-to-current Git change collection;
- immutable implementation Attempts and same-Attempt monotonic timeout recovery;
- check-side-effect and bounded environment observations;
- fact-bound Agent diagnosis before any non-timeout failure route;
- fresh-context challenge for explicit requirements and fact-triggered
  Obligations whose declared verifier acceptance surface changed;
- compact fact-bound Cognitive Handoff, review questions, consolidated Attention,
  and a transient decision/condition/fact presentation;
- an exact current-task Human decision with explicit exception coverage;
- dynamic Host instruction projection over a fixed lifecycle;
- task-specific semantic context, prefilled drafts, exact structural choices,
  and one-shot stdin bindings for input-bearing Host actions;
- one task-scoped event source, derived projection, short write lock, and
  revision-checked mutation.

It does **not** implement:

- a general delivery graph or parallel writer scheduler;
- broad repository intelligence or ownership inference;
- remote environment attestation;
- multi-task or organization memory;
- outcome observation after the task decision;
- cross-task Decision Continuity or automatic policy activation.

The deterministic implementation establishes protocol consistency and
distributability only. The first historical-replay pilot is recorded as
inconclusive: proxy review exposed two treatment defects and one treatment win,
but Human blind review, timing evidence, and a preregistered repair/recollection
pair are absent. Product effectiveness remains `unverified` until a qualifying
paired evaluation and scoped product-owner conclusion exist.

## Architectural change accounting

The current design removes Host-authored identity boilerplate, unevaluated Delivery Plan
step fields, direct failure-to-repair routing, a public repair command, and
duplicated handoff claim/review structures. It added one selective baseline
artifact, one optional evidence-disposition artifact per diagnosed Attempt,
mechanical check comparisons, fact-triggered challenge relationships, and a
transient three-layer decision view.

Each added value changes a collection, diagnosis, repair, challenge, handoff,
review, or adoption decision and is inspectable. No cross-task state, global
memory, general scheduler, or additional package was added. Detailed current
accounting is in [Architecture](architecture.md).

The target direction may add real complexity only when an executable consumer
and measured advantage exist: richer Acceptance and Delivery Plan contracts,
bounded conditional execution, capability identity, and eventually three graph
views with different authority and lifetime. Capability adapters should reuse
Host runtimes instead of creating another coding-agent platform.

Persistent state moves in stages. The current task ledger groups immutable
Attempts for one developer request and remains isolated from every other task.
Cross-task Decision Records arrive only in P4 and never share authority with
Runtime observations or Agent summaries.

## Relationship to adjacent harnesses

Mature harnesses already own valuable execution concerns such as project work,
sessions, milestone or task planning, repository-local specifications,
worktree isolation, auto modes, repair and resume, and multi-provider or UI
surfaces.

Stetra overlaps with them at delivery control but uses different first-class
objects:

| System role | Typical first-class objects |
|---|---|
| General execution harness | project work, session, milestone, task, workspace memory, auto-mode state |
| Current Stetra | exact Human authority, Semantic Contract, selective baseline and Fact Bundle, Agent evidence disposition, condition conclusions, layered handoff |
| Target Stetra | current objects plus richer Acceptance Contract, conditional Delivery Plan, bounded loops, and scoped Decision Continuity |

The preferred ecosystem split is:

```text
Codex / Claude / Pi / GSD / Trellis = execution Hosts
Stetra = cognition-preserving delivery and assurance control plane
```

Stetra should integrate before it duplicates general runtime capabilities.
Host-specific dynamic scripts, task formats, and subagent mechanisms are
Adapter backends, not canonical Stetra authority.

## Evidence-gated iteration strategy

The direction is a sequence of testable hypotheses, not a feature checklist.

### P0: prove the shipped task-scoped cognition and adoption loop

P0 evaluates the initial task loop. It covers:

- at least the protocol-required paired trials, task diversity, blinded review,
  adverse results, and scoped product-owner conclusion;
- short-lived run lease, revision/CAS, deterministic conflict handling, and
  crash recovery;
- selective baseline observations and mechanical comparison;
- Execution Environment Manifest and check-side-effect classification;
- complete persisted schemas with canonical Core identity rules;
- the smallest append-only task ledger and projection that support recovery,
  Attempt and Verification Definition lineage, and exact current-task Human
  decisions and resolutions;
- a routine single front door that reduces authoring ceremony without
  weakening the canonical contract;
- Evidence Obligations before Condition conclusions, evidence judgment before
  repair, changed-verifier fact-triggered Challenge, and Host attestation.

The first frozen three-pair pilot is useful product evidence but not a completed
effectiveness evaluation. It exposed false confidence from self-authored
verifiers and waste from treating environment failures as repair, directly
motivating the current initial design. The next P0 evaluation must establish
whether the loop
lowers review and adoption cost or mostly adds protocol overhead. If it is not
useful, remove ceremony before adding orchestration.

### P1: improve the minimum Delivery Loop

Add only improvements that earn their cost in the shipped loop:

- richer evidence strategies and selective trusted baseline inputs;
- conditional Agent strategy inside the fixed task lifecycle;
- better Agent-facing diagnosis and evidence comparison without automatic
  cause inference;
- additional Host capability adapters;
- improved low-friction authoring and review presentation.

Evaluate this phase as an ablation sequence:

```text
ordinary coding Agent
initial task loop
initial task loop with individual capabilities removed
```

The comparison should reveal which capability changes implementation,
adoption, and cognition outcomes rather than merely increasing prompts, Agent
calls, or tokens.

### P2: add repository intelligence and evidence-directed assurance

Add task-scoped repository maps, ownership and control-flow investigation,
test-surface discovery, verifier dependency tracing, richer assurance
strategies, a layered review workspace, and external executor adapters.

Keep semantic criticality, operational hazard, and epistemic uncertainty
separate. Runtime facts may add obligations; repository intelligence must not
infer task consequence or semantic importance from keywords, filenames,
dependency counts, or a scalar risk score.

### P3: introduce a conditional Delivery Graph

Add a DAG only after P1 and P2 show that a single chain degrades on identifiable
task classes and that fan-out benefits exceed coordination cost. Introduce it
in this order:

1. fresh-context verifier;
2. parallel read-only investigation;
3. layered fan-in with completeness checks;
4. isolated parallel writes and an explicit integration node;
5. broader multi-Agent scheduling only if still justified.

The graph needs typed dependencies, read/write conflict checks, fan-in
completeness, node and resource budgets, and end-to-end artifact/evidence
traceability. Simple tasks should still compile to one node or a short chain.

### P4: add outcome observation and Decision Continuity

Only after task-level value is demonstrated should Stetra extend the existing
exact current-task decision with later merge, revert, incident, or post-deploy
correction observations and Human-authorized cross-task Decision Records.

A Decision Record needs a statement, scope, authorizing Human Event, rationale,
alternatives, validity, supersession, supporting attempts, and observed
outcomes. Future activation must show why a record applies and whether it is
stale. Outcome evidence may propose a policy adjustment but cannot silently
modify authority or a delegation frontier.

### P5: team and external systems

Only after local task-level value is established should the product consider
PR and CI integration, GitHub review feedback, remote workers, signed Fact
Bundles, team policy, shared Decision Continuity, server mode, retention and
export, or organization analytics.

## Package and module evolution

Keep the two publishable packages and make internal responsibilities narrower.
A likely direction is:

```text
Core
  authority | contract | acceptance | delivery-plan
  assurance | evidence | handoff | decisions | protocol

CLI
  application orchestration
  ports for run store, Git, checks, Host, and Agent execution
  infrastructure adapters
  host-action and review presentation
```

This is module ownership, not a package plan. Split a publishable package only
when a non-CLI consumer, independent Adapter lifecycle, or different runtime
and security boundary creates a real release need.

## Evaluation and product evidence

Formal evaluation should retain raw measures in these categories:

| Category | Evidence |
|---|---|
| Implementation | acceptance checks, review defects, escaped defects, revert, incident |
| Delivery | completion, repair attempts, correction rounds, blocked or exhausted outcome |
| Human cost | active review time, clarification count, interruption count |
| Agent cost | wall time, tokens, Agent calls, check time |
| Cognition | correct understanding of behavior, invariants, ownership, and failure entry |
| Assurance | evidence coverage, contradiction detection, challenge and Review Map usefulness |
| Continuity | applicable-decision precision and stale-decision activation |
| Adoption | accept, needs-correction, reject, or defer |

Every result should preserve repository, Agent, Host, task type, reviewer,
starting state, and protocol scope. Inconclusive and adverse results remain in
the record. Deterministic tests establish consistency and distributability;
they do not establish delivery quality, adoption efficiency, or cognition.

## Complexity gates and anti-goals

Every persistent field, event, graph edge, lifecycle state, or node type must
answer:

1. Which alignment, execution, recovery, assurance, review, adoption, or future
   activation decision can it change?
2. Can the developer inspect that decision and distinguish its authority and
   evidence?
3. Can its value be measured against a simpler baseline?

Do not build, without an evidenced Stetra-specific consumer:

- a general LLM provider SDK or terminal coding agent;
- an arbitrary JavaScript workflow runtime;
- a graph database or universal task DAG;
- a scalar risk, trust, readiness, cognition, or productivity score;
- automatic adoption or silent authority expansion;
- broad project memory, a worktree fleet platform, or a cloud dashboard;
- another package or compatibility layer.

The intended evolution is:

```text
Semantic Assurance Kernel
  -> Fact-consistent Run Runtime
  -> Bounded Delivery Loops
  -> Independent Challenge
  -> Conditional Delivery Graph
  -> Human Adoption Closure
  -> Decision Continuity
```

That path turns the current rigorous but narrow assurance protocol into a
production delegation harness that improves Agent delivery while preserving
developer cognition and final decision authority.
