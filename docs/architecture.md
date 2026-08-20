# Architecture

This document is the authoritative long-term product positioning and top-level
design for Stetra. It describes both the target system and the implemented
initial slice. A planned capability is a bounded hypothesis, not current
behavior and not authorization to implement it without a concrete consumer and
supporting evidence.

The executable behavior of the current CLI is defined separately in
[Change workflow](change-workflow.md). When this document and the executable
workflow differ, the workflow describes what exists today while this document
defines the direction and constraints within which it may evolve.

## Product positioning

Stetra is a **cognition-preserving adaptive delegation harness for production
coding**.

It reduces the total cost from developer intent to a high-quality change that a
developer can confidently adopt, while preserving the developer's first-class
understanding of the system and the quality of their engineering judgment.

Relative to Codex, Claude Code, Pi, GSD, Trellis, and similar execution Hosts,
Stetra is the domain-specific delivery, assurance, and adoption control layer.
The Host supplies models, context, repository tools, shell execution, sessions,
subagents, worktrees, cancellation, and interaction surfaces. Stetra keeps the
engineering thread intact across those capabilities without becoming another
coding agent or a general Agent Runtime.

The product addresses three coequal outcome surfaces:

| Outcome | Decision question |
|---|---|
| Delivery outcome | Did delegation produce a correct, complete, repository-fitting implementation? |
| Adoption efficiency | Can the developer reach a sound adoption decision with less active time, interruption, and semantic recovery? |
| Cognition preservation | Can the developer still explain the changed behavior, invariants, ownership, control flow, and failure entry points? |

The success contract is conjunctive:

```text
implementation outcome is non-inferior or better
AND Human adoption cost is lower
AND developer cognition is non-inferior
AND adoption authority remains Human
AND evidence provenance remains inspectable
```

Faster review with a worse implementation is failure. Correct code that leaves
the developer unable to understand the system change is failure. A rigorous
handoff that increases total work without improving a real decision is also
failure.

A useful directional North Star is production changes confidently adopted per
active developer hour under those non-degradation constraints. It is not a
Runtime score. Evaluation must retain raw implementation, cost, cognition,
assurance, and adoption observations rather than collapsing them into one
trust, readiness, confidence, risk, or productivity scalar.

## Durable principles

1. **Authority remains partitioned.** Human authority, Agent judgment, Runtime
   facts, and Host attestation cannot be relabeled as one another.
2. **Facts remain observation-bound and freshness-bound.** Actual changes,
   checks, attempts, and environment observations come from the workflow that
   collected them; later edits invalidate dependent conclusions.
3. **Semantic claims expose their evidence boundary.** Material conclusions
   retain support, counterevidence, falsification, and unknowns.
4. **Non-passing evidence is judged before it is acted on.** A failed command
   is not a diagnosis and does not authorize an implementation edit.
5. **Conclusions cannot exceed declared evidence obligations.** Runtime can
   enforce coverage and contradiction ceilings without claiming natural-language
   truth.
6. **Verification evolves without rewriting history.** Definitions, attempts,
   facts, revisions, and decisions supersede rather than overwrite one another.
7. **The smallest adequate workflow is the default.** Additional investigation,
   challenge, branching, parallelism, and persistence must change a concrete
   decision enough to justify their cost.
8. **Authoring convenience cannot collapse provenance.** Generated identities
   and drafts may remove ceremony, but exact Human events, Agent interpretation,
   Runtime facts, and Human decisions remain separate.
9. **Host capabilities are useful only with honest provenance.** Thin
   instructions cannot self-promote into enforced policy, tool isolation, or an
   independent context.
10. **Human adoption remains an explicit decision.** Evidence readiness,
    passing checks, repeated Agent behavior, or apparent consensus never become
    automatic approval or durable policy.

## Product boundary and anti-goals

Stetra should own:

- exact delegation semantics and material-fork handling;
- acceptance conditions and falsifiable evidence strategies;
- bounded delivery-plan contracts and next-action semantics;
- progress, failure classification, repair, revision, and escalation control;
- repository, verification, execution, and environment facts;
- assurance coverage, independent challenge, and direct-review obligations;
- cognitive handoff and exact Human adoption decisions;
- eventually, explicitly scoped activation of adopted decisions and observed
  outcomes.

Execution Hosts may own:

- model selection, context windows, and reasoning settings;
- repository, editor, shell, and general tool access;
- fresh sessions, subagents, worktrees, and provider-native scheduling;
- streaming, cancellation, interaction, and external-effect approval surfaces.

Stetra does not aim to become:

- a model-provider SDK, terminal coding agent, ReAct loop, TUI, or web chat;
- a generic project manager, arbitrary JavaScript workflow engine, or universal
  DAG scheduler;
- a repository wiki, transcript archive, broad project-memory system, graph
  database, or worktree fleet platform;
- an automated approver or scalar trust, readiness, cognition, risk, or
  productivity scorer;
- a cloud service, organization analytics system, or additional package without
  a demonstrated independent consumer and release boundary.

## Target architecture: two planes, three graphs, one ledger

```text
+----------------------------------------------------------+
| Execution Hosts: Codex / Claude / Pi / GSD / Trellis     |
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

The Adaptive Delivery Plane owns task-local Agent strategy. It may:

- investigate the repository and form bounded hypotheses;
- propose acceptance criteria and a Delivery Plan;
- select controlled execution nodes through a Host;
- revise local strategy from collected facts;
- diagnose failure and request retry, repair, replan, challenge, or escalation;
- use Host capabilities such as fresh contexts or isolated worktrees when their
  availability and enforcement are known.

It may not alter an exact Human Event, silently change compiled task meaning,
lower an evidence obligation, invent Runtime facts, erase adverse evidence, or
claim that a Human adopted a result.

Strategy remains Agent judgment. Runtime may validate structure, declared
authority, effects, budgets, gates, identity, and transitions; it does not
choose the best engineering design or infer semantic importance from repository
shape.

### Deterministic Assurance and Decision Plane

The Deterministic Assurance and Decision Plane owns inspectable boundaries. It
may:

- compile and freeze authority-bearing semantics;
- validate that a Delivery Plan stays inside the contract and effect boundary;
- bind typed lifecycle events and immutable artifacts;
- collect repository, check, and bounded environment facts;
- enforce evidence coverage and structural contradiction ceilings;
- produce Attention and direct-review obligations;
- preserve exact Human resolutions and adoption decisions.

It does not implement the change, decide semantic truth, choose long-lived
tradeoffs, infer engineering cause from output, or promote an Agent conclusion
into a fact.

### Append-only task and run ledger

The ledger preserves the ordered engineering thread. It holds task-local
events, immutable artifacts, Attempt lineage, Verification Definition lineage,
Human decisions, and derived projections. It enables recovery, optimistic
concurrency, replay, and inspection without making one task authoritative for
another.

Illustrative long-term events include:

```text
task-created
human-event-recorded
contract-compiled
baseline-captured
delivery-plan-validated
node-started
node-completed
check-attempt-recorded
facts-collected
evidence-diagnosed
claim-challenged
handoff-evaluated
correction-requested
adoption-recorded
outcome-observed
```

Only events with an implemented decision-changing consumer belong in a schema.
The current-state document is a rebuildable projection for efficient reads, not
a second authority. The ledger is not a global memory store; cross-task use
requires the separately authorized Decision Continuity boundary.

## Authority partitions

| Actor | Owns | Does not own |
|---|---|---|
| Developer | Exact requests, corrections, desired outcomes, constraints, non-goals, long-lived tradeoffs, exceptions, and adoption | Runtime observations or Agent investigation |
| Agent | Interpretation, repository investigation, recommendation, reversible engineering judgment, delivery strategy, implementation, diagnosis, falsification, challenge conclusions, and handoff | Developer authority or machine facts |
| Runtime | Identity, references, ordering, immutable definitions, baselines, actual changes, check attempts, bounded logs, timing, currency, and deterministic structural policy | Product meaning, semantic truth, engineering cause, or adoption |
| Trusted Host integration | Tool configuration, isolation, fresh-context identity, and external-effect controls that it actually enforces | Semantic truth or Human authority |

Storage, labels, signatures, and generated prose cannot move information across
these partitions. A Human exception cannot erase a contradictory fact. A fact
cannot decide product meaning. Agent prose cannot become a Human decision or
Runtime observation through a field name.

Exact developer messages and decisions use Human Events. Structured desired
outcomes, Conditions, tradeoff interpretations, and recommendations remain
Agent interpretations with exact event or repository-evidence bases. Runtime
validates identity and references, not whether an interpretation is faithful.

## Fixed macro lifecycle, adaptive task-local delivery

The long-term governance lifecycle remains stable:

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

Only task-local delivery may adapt into a chain, conditional chain, bounded
loop, or justified DAG:

```text
fixed governance lifecycle + adaptive task-local delivery graph
```

This keeps authority, evidence, adoption, and replay boundaries stable while
allowing execution strategy to respond to repository state and failures.
Adaptive delivery is not permission to skip lifecycle obligations or choose a
cheaper assurance path.

The default remains the smallest useful strategy:

```text
simple task             -> short single-Agent chain
result-dependent task   -> conditional chain and bounded loop
demonstrably separable  -> task-local DAG
```

The implemented initial slice uses one fixed task lifecycle with bounded repair,
verification revision, challenge or direct review, Human resolution, handoff,
and decision. The conditional Delivery Graph and outcome-observation stage are
planned, not implemented.

## Three graphs with distinct authority and lifetime

These graphs are logical typed relationships. They do not require one storage
engine and do not imply a graph database.

### Delivery Graph

The Delivery Graph is task-scoped, short-lived, and revisioned as Agent
strategy. It answers:

- which action depends on which result;
- which read-only investigations can run independently;
- which writes require isolation or ordered integration;
- where failure retries, repairs, replans, or escalates;
- which gate, budget, and Host capability permits a node to advance.

Declared read and write sets are scheduling and conflict-detection inputs. They
are not permissions, semantic scope, or predictions of final changed files.
Runtime-collected changes remain authoritative.

The initial implementation persists only a fixed lifecycle and bounded repair
budget. Conditional chains and DAG scheduling must earn their complexity on
task classes where a simpler chain measurably fails.

### Evidence Graph

The Evidence Graph is Attempt- and run-scoped and append-only. It connects:

```text
Human Event
  -> Agent Interpretation
  -> Semantic or Acceptance Requirement
  -> Evidence Obligation
  -> Delivery Action
  -> Changed File / Check Attempt / Observation
  -> Conclusion and Counterevidence
  -> Review Surface
```

It answers where a conclusion came from, which facts support or contradict it,
what was tried to falsify it, and which review action can prevent which adoption
error. Stable IDs and typed JSON relationships are sufficient; no generic graph
store is required.

The initial implementation already realizes the core of this graph through
Conditions, Evidence Obligations, Verifiers, immutable Attempts, Fact Bundles,
Challenges, Handoff conclusions, and Review Questions.

### Decision Graph

The Decision Graph is longitudinal and Human-authorized. It connects scoped
decisions to the exact adoption, correction, rejection, revert, incident,
outcome, supersession, or invalidation event that gives them authority or
changes their validity.

It is built last. Repeated Agent behavior, generated summaries, passing checks,
or apparent consensus cannot create a decision edge, policy, preference, or
delegation frontier. Decision Continuity is not implemented in the initial
product.

## First-class domain objects

### Human Event and Agent Interpretation

A Human Event preserves exact developer content, provider identity, and event
identity. Agent Interpretation holds structured task meaning—desired outcome,
constraints, non-goals, focus, Conditions, and rationale—beside its exact basis.
The two remain physically separate.

### Semantic Contract

The Semantic Contract defines what one change is intended and authorized to
mean. It binds task meaning, Conditions, Host policy requirements, verification
strategy, and delivery bounds without pretending that a command or plan proves
the requested semantics.

Routine work may have no material Condition. Once a Condition exists, it needs
an adoption rationale, basis, criticality, and falsifiable Evidence Obligations.

### Acceptance Contract and Evidence Obligations

A verification command is not an acceptance criterion. The target Acceptance
Contract states, for every material or adoption-critical criterion:

- the bounded behavior, invariant, compatibility, ownership, operational, or
  failure-recovery statement;
- its exact Human Event or repository-evidence basis;
- its adoption consequence and rationale;
- the plausible wrong implementation that matters;
- its Runtime checks, repository inspection, independent Challenge, or direct
  Human-review strategy;
- the claim and review surfaces that consume the result.

The initial implementation represents this through Adoption Conditions and
Falsifiable Evidence Obligations inside the Semantic Contract. Every Obligation
states what must be supported and freezes a discriminating design: a plausible
failure, a concrete scenario, the observation supporting the bounded
conclusion, and the observation contradicting it. It also names the evidence
strategies to attempt. Challenge and Handoff separately record the action taken
and the result actually observed. Handoff concludes Obligations before
Conditions.

An Evidence Obligation is independently concludable. If one observation can
support part of a statement while another adoption-relevant part remains
unknown, those parts are separate Obligations. In particular, current
implementation behavior and persistent verifier protection are separate when
either can independently change adoption. The Agent declares that boundary;
Runtime does not infer it from filenames, test text, or other repository
signals.

Runtime may enforce:

```text
contradicted obligation -> condition cannot be supported
partial or unknown obligation -> condition cannot be unqualified support
missing required challenge -> related conclusion cannot be supported
supported challenge with counter-evidence -> invalid challenge document
```

It cannot determine whether a test truly proves a natural-language statement.
The obligation is an inspectable Agent commitment to evidence coverage, not a
semantic theorem.

### Delivery Plan IR

The target Delivery Plan is declarative intermediate representation, not
arbitrary Agent-authored JavaScript. It should include:

- contract and plan identity;
- `chain`, `conditional-chain`, or later `dag` strategy;
- typed investigate, design, implement, verify, challenge, integrate, and
  synthesize nodes;
- dependencies and typed outputs with concrete consumers;
- declared effects: read-only, local-write, or external-effect;
- Host capability and isolation requirements;
- gates, execution budgets, maximum Attempts, and explicit retry, repair,
  replan, or escalate routes.

Runtime plan validation should detect incompatible parallel writes,
unauthorized external effects, missing consumers, unenforced budgets, missing
critical evidence paths, and attempts to lower compiled assurance.

The current Delivery Plan intentionally contains only the fixed lifecycle and
repair budget. It must not accumulate speculative fields before a consumer and
measured benefit exist.

### Fact Spine

The Fact Spine records what the workflow actually observed, not what an actor
believes it means. It includes:

- complete baseline-to-current file operations and representable patch content;
- pre-check and post-check worktrees and check-induced changes;
- immutable Verification Definitions and ordered Check Attempts;
- explicit preparation/assertion boundaries and declared local execution-input
  snapshots, including named ignored generated surfaces;
- timeout budgets, structured termination, bounded logs, and complete-stream
  digests;
- declared command-definition and verifier-surface mutations, using explicit
  exact-file or repository-tree selectors and concrete matched files;
- mechanical baseline/current relations and explicit evidence concerns derived
  from those observations;
- bounded, non-secret execution-environment observations;
- fact currency against the current worktree and contract identity.

A passing command is one observation about one exact Definition. It is never a
semantic conclusion or an adoption decision. Completed failure, non-timeout
unavailability, timeout, signal, and spawn failure remain distinct.

Challenge evidence also preserves an explicit provenance boundary: a
Runtime-recorded fact, Agent-reported repository inspection, Agent-reported
Challenger execution, or an unexecuted reasoned counterexample. A label cannot
promote Agent observation into Runtime fact.

### Execution Environment Manifest

The long-term bounded Environment Manifest should bind relevant verification to:

- resolved executable identity and version;
- operating system and architecture;
- language and package-manager toolchains;
- lockfile and installed-dependency identity;
- container or image identity where applicable;
- explicitly relevant environment-variable names and safe digests.

It must never persist raw secrets or claim that an omitted input cannot matter.
The initial implementation records bounded local observations; full dependency,
container, and external attestation are planned.

### Host Capability and Enforcement Attestation

Each Adapter should disclose capabilities on which delivery may rely, such as
fresh contexts, subagents, worktree isolation, cancellation, structured output,
parallel reads, network controls, and external-effect approval.

Requirements, capabilities, and actual enforcement remain separate:

```text
Host policy requirement
  -> Host capability/configuration
  -> Host enforcement attestation
```

A thin Markdown Adapter can provide instructions only. It cannot attest that
Web search was disabled or that a Challenge used an independent context. Only a
programmatic Host integration or Evaluator that controls the relevant boundary
may record enforcement. Missing capability must degrade to a valid smaller
strategy or a visible Human decision, never a fabricated guarantee.

The initial Host boundary exposes one deliberately narrow lifecycle binder for
Independent Challenge. Runtime derives a task- and fact-bound execution request;
Runtime also projects one bounded Challenge Execution Packet containing one
separate case for every outstanding Evidence Obligation and only each case's
explicit evidence relations. One Fact Collection therefore starts one named
read-only Challenger context rather than one context per Obligation. The Host
observes that Challenger's start and stop, binds the packet and exact Round
output, and verifies the single-use receipt when recording all results
atomically. Generated Codex and Claude profiles constrain the role and treat the
packet as self-contained, but those files alone do not confer attestation. This
binder is not a subagent scheduler, generic role registry, transcript store, or
parallel execution graph.

### Attempt and Verification lineage

Completed, rejected, and superseded artifacts remain immutable. Implementation
repair, verification revision, and Human correction create successor Attempts
linked to exact prior Attempts, Contracts, Definitions, facts, and decisions.

The identity model separates:

```text
semanticContractId
verificationPlanId
effectiveContractId = fingerprint(semanticContractId, verificationPlanId)
```

A logical Verifier has stable identity; each executable Definition has content-
bound identity and revision lineage. Verification can change without pretending
task meaning changed. A relaxed plan cannot erase the facts produced by its
predecessor.

### Cognitive Handoff

The Cognitive Handoff is a decision surface, not a transcript or generated
summary archive. It communicates:

- what the actual system change means;
- one Agent-authored evidence-bounded finding per Obligation and Condition;
- one separately derived Runtime assurance-fulfillment view for every declared
  evidence strategy;
- important system effects;
- residual unknowns and next actions;
- consequence-directed Review Questions;
- an Agent recommendation distinct from Human adoption.

Agent finding and assurance fulfillment answer different questions. A finding
states what the Agent concludes from evidence. Fulfillment states whether the
declared process boundary was mechanically satisfied, remains pending, was
unavailable, or was not triggered. A missing or unverified independent
Challenge therefore remains a separate assurance gap rather than silently
downgrading an otherwise bounded Agent finding. It still blocks Agent
acceptance advice and directs Human review. An adverse Challenge constrains the
finding because it is counterevidence, not merely a missing process step.

Attention and the Review Map have different roles. Attention identifies
structural evidence or integrity gaps with exact references. Review Questions
direct scarce Human attention to the inspections most likely to prevent an
adoption error. Neither should create one generic item per changed file.

### Human Resolution, Decision, and Decision Continuity

Human Resolution closes material mid-task choices such as semantic impact,
verification relaxation, Host-policy gaps, or correction continuation. Human
Decision records accepted, correction-requested, rejected, or deferred for the
exact Handoff and facts. Acceptance with Attention needs an explicit exception
for each current item.

Decision Continuity is the planned longitudinal loop. It may later connect a
scoped Human decision to merge, revert, incident, post-deploy correction,
outcome, supersession, and future applicability. A durable Decision Record
would need statement, scope, authorizing Human Event, rationale, alternatives,
validity, supersession, supporting Attempts, and observed outcomes.

Outcome evidence may propose a future policy or default, but cannot silently
create one. The initial implementation records only the exact current-task
decision; it does not observe downstream outcomes or activate cross-task state.

## Separate delivery, evidence, and decision state

These dimensions remain independent:

```text
Delivery:  waiting-for-implementation | implementing | repairing
           implementation-complete | exhausted

Evidence:  not-collected | awaiting-evidence-judgment | incomplete
           needs-attention | facts-stale | handoff-ready

Decision:  pending | correction-requested | accepted | rejected
           deferred | aborted
```

Implementation may be complete while evidence needs attention and adoption is
pending. No single `done`, trust, or readiness score may hide those distinctions.

## Bounded feedback loops

Bounded loops precede a general graph scheduler.

### Investigation Loop

```text
open question -> hypothesis -> repository probe -> evidence update
              -> sufficient | another probe | material Human fork
```

The Agent resolves repository-discoverable questions and interrupts the
developer only for material Human-owned choices.

### Implementation Repair Loop

```text
patch -> collect facts -> classify failure -> diagnose -> repair -> recollect
```

It needs bounded Attempts, preserved lineage, explicit Agent cause judgment,
and an escalation route. Retry is not repair. Repeated failure does not prove
implementation cause. Material semantic change is not a retry.

### Independent Challenge Loop

```text
critical claim -> fresh-context falsification attempt
               -> supported | partial | contradicted | unknown
```

The Challenger derives its conclusion from named evidence rather than inheriting
the implementer's summary. Its output remains Agent judgment with independently
attested provenance. Without a trusted context boundary, the workflow exposes a
direct Human review obligation instead of manufacturing independence.

Challenge and Handoff also carry an explicit Agent-authored evidence-coverage
assessment. A declared gap mechanically caps the related conclusion and remains
visible in review. Runtime does not infer missing verification from repository
shape, filenames, dependencies, command names, or test text.

### Review Completion Loop

```text
evidence obligations -> coverage analysis -> missing evidence or review
                     -> collect, challenge, inspect, or disclose unknown
```

Review obligations are the union of:

```text
explicit semantic requirements
UNION mechanically observed Runtime hazards
UNION disclosed evidence gaps
```

Runtime hazards may add obligations, but cannot infer Human consequence from
keywords, filenames, dependency counts, path counts, diff size, error prose, or
a scalar score.

## Transactional collection, concurrency, and recovery

Adaptive delivery cannot rest on ambiguous concurrent facts. Prepare and
Collect conceptually use:

```text
acquire project-worktree lease
  -> capture relevant worktree state
  -> execute exact Definitions
  -> capture post-check state
  -> stage complete artifacts
  -> acquire short task commit lock
  -> compare expected revision
  -> publish artifacts and append event
  -> release task lock and worktree lease
```

External checks do not run while the task commit lock is held. A lease is
reclaimed only after the owning process is confirmed dead using process identity;
elapsed time alone never authorizes eviction. Conflicting writers fail rather
than silently overwriting a newer projection.

Prepare request identity is explicit. Replaying one request with identical
input returns the same task without rerunning baseline work. Reusing it with
different input is rejected; a distinct request identity creates a distinct
task. Semantic similarity is never used as a deduplication heuristic.

Collect is also idempotent when the current Attempt already has facts and the
worktree fingerprint remains exact. The Runtime returns those facts and the
current action without rerunning checks or writing state. A changed worktree,
explicit full refresh, or valid monotonic timeout retry is required for another
observation. Time, command names, repository shape, and output text do not
participate in this decision.

## Baseline, verification revision, and evidence judgment

The Git worktree baseline is not a baseline test result. A task-start check runs
only when the before/current comparison changes an exact Evidence Obligation.
Its definition freezes the expected baseline and current statuses. Runtime
records the actual mechanical relation and escalates an expectation mismatch;
it does not infer whether a different result is a semantic regression.
Otherwise the baseline is honestly unknown.

After collection, every current non-passing Definition, every declared
baseline-expectation mismatch, and every adverse Challenge receives explicit
Agent diagnosis. Runtime records them as distinct mechanical concerns; it does
not collapse them into an engineering cause:

```text
implementation -> bounded repair or handoff
environment    -> verification revision, handoff, or Human decision
verification   -> verification revision, handoff, or Human decision
unknown        -> Challenge, handoff, or Human decision
semantic drift -> exact Human resolution
```

A baseline-expectation mismatch cannot be routed directly to production repair.
It first requires an Agent judgment about the environment, baseline, or frozen
verification meaning. This prevents a faulty expectation from masquerading as
a production defect while preserving the exact observation for review.

Runtime validates explicit route compatibility and coverage. It does not parse
output text to guess cause. When a revised Definition cannot honestly run
against the original baseline, the observation remains unknown; the current
modified worktree is never mislabeled as the original baseline.

## Dynamic Host Projection

Dynamic Host Projection is the transient instruction layer over the stable
kernel. Each lifecycle state may return a structured `hostAction` containing an
exact command, the smallest necessary generated reference, and a task-specific
Authoring Packet.

An input-bearing Authoring Packet may include:

- current task, Contract, Attempt, Fact Bundle, and revision bindings;
- the exact Human Event beside separately labeled Agent interpretation;
- a directly fillable draft;
- canonical reference catalogs;
- structural field requirements and outstanding obligations;
- a one-shot stdin binding for the exact command.

Projection reduces reading, identity copying, and schema-error cost. It does not
persist a mode, create lifecycle state, choose semantic values, hide an
adoption-changing condition, or become authority. Canonical artifacts remain
available through on-demand inspection.

Independent Challenge uses a narrower projection rather than the generic
Authoring Packet. Its Challenge Execution Packet keeps all changed files
compactly visible and creates one case per outstanding Obligation. Each case
contains only its target Condition, exact Human-event basis, explicitly
referenced Repository Evidence and Checks, and Runtime-recorded mutations for
those Check definitions; all cases share the current Patch reference. This
selection follows exact graph edges and path identities only;
it does not rank repository content or infer relevance. The request and Host
receipt bind the exact packet fingerprint, so context reduction cannot silently
change the challenged evidence boundary.

At the Handoff boundary, Dynamic Host Projection also derives an ephemeral
Developer Decision Brief from the canonical Decision Packet. It is the Host's
required delivery surface: separate delivery/evidence/recommendation/adoption
states; explicitly labelled Agent interpretations of intended and actual
system meaning; Agent-authored condition and Challenge conclusions with exact
counter-evidence; structurally aggregated decision issues;
consequence-directed review questions; explicitly labelled Runtime
observations; and the pending Human decision. Attention is aggregated only by
its exact protocol group and required resolution, never by repository or text
heuristics, while all canonical IDs and references remain in the JSON surface.
The primary Human rendering can therefore omit machine IDs without weakening
traceability. The brief adds no artifact or authority. The projected
decision command is explicitly a continuation that requires a new exact Human
Event; Handoff presentation and Human decision recording cannot collapse into
one Host turn.

The CLI also provides a read-only final-response guard. Given an exact task ID,
it checks fact currency and projects whether the Host must continue the
workflow, present the current Developer Decision Brief, or report an already
recorded Human decision. A Host may provide the fingerprint of an exact Action
it still holds; the guard can then report that the Action is unchanged without
repeating its Packet. A mismatch always returns the complete current Action.
On-demand inspection defaults to an artifact index and expands only a named
canonical section. Schema-invalid Agent input may return an ephemeral
correction packet containing the submitted-input fingerprint, exact structural
issues, and bounded issue-local previews, but never the full document; this
writes no task state and adds no repair lifecycle. These
projections reduce repeated context without weakening identity or currency.

The guard closes the final delivery boundary without a new lifecycle state or
persisted mode. Generated Markdown adapters can instruct the guard but cannot
claim enforcement. A native Host integration may bind the same deterministic
guard to a real before-final-response hook; Stetra does not invent a general
hook engine or infer the active task from repository state.

## Persistence model

Current task state lives under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only source and `task.json` is a rebuildable projection. Immutable
artifacts are partitioned by Contract revision, Attempt, Fact Bundle,
Verification Revision, Challenge, Handoff, Resolution, and Decision.

Long-term persistence follows these rules:

- one task cannot make its state authoritative for another;
- facts remain bound to the exact Contract, Definition, Attempt, environment,
  and worktree that produced them;
- supersession never deletes adverse or contradictory history;
- timestamps record lifecycle occurrence, not deterministic identity;
- retention removes only units whose decision and recovery consumers permit it;
- cross-task Decision Records, when implemented, remain Human-authorized and
  separate from Runtime observations and Agent summaries.

## Package and API boundary

```text
Generated Host Adapter -> CLI -> Core
```

- `@sovea/stetra-core` owns deterministic authority validation, Semantic and
  Acceptance Contract compilation, fact schemas and binding, evidence ceilings,
  handoff evaluation, Attention, and Human-decision binding.
- `@sovea/stetra` owns commands, IO validation, task sequencing, Git and check
  collection, storage, Host-attestation injection, transient projection,
  project initialization, presentation, generated workflows, and the narrow
  `@sovea/stetra/host` programmatic integration boundary.
- Host Agents own semantic reasoning and repository engineering. Core and CLI
  never call an LLM.

The current Core root exposes exactly `compileDelegation` and
`evaluateHandoff` as runtime values. Target planning, graph, or ledger types do
not justify another public root API or publishable package by themselves.

## Implemented initial slice

The current `cognitive-adoption` schema `1` implements one task-scoped loop:

```text
prepare -> Agent implementation -> collect
        -> diagnose mechanical evidence concerns
        -> bounded repair / verification revision / Challenge or direct review
        -> exact Human resolution when needed
        -> Cognitive Handoff -> exact Human Decision
```

It includes:

- exact Human Events separated from Agent interpretation;
- material decision forks consolidated before a Task exists and resolved only
  by later exact Human Events;
- Semantic Contracts, Conditions, and Falsifiable Evidence Obligations;
- explicit Host policy requirements and honest instruction/enforcement
  provenance;
- immutable semantic, verification, and effective Contract identities;
- selective task-start baselines and complete Git change collection;
- ordered Check Attempts, bounded logs, timing, and environment observations;
- fact-bound diagnosis before repair;
- bounded repair, timeout retry, Verification Revision, and correction lineage;
- fact-triggered Challenge where a trusted Host can attest independence, and
  direct Human review where it cannot; adverse Challenge evidence returns to
  bounded diagnosis while immutable prior Challenge history remains visible;
- task-specific Authoring Packets, bounded Challenge Execution Packets, and
  executable Host actions;
- evidence-bounded Cognitive Handoff, Attention, Review Questions, and exact
  current-task Human decisions, including rejection of Agent acceptance advice
  that exceeds current evidence;
- a published programmatic Host facade for attestation injection and the
  read-only final-response guard; native vendor hooks remain Host integrations,
  not a Runtime claim;
- append-only task events, rebuildable projection, staged publication,
  revision checks, and process-identity-based lease recovery.

It does not implement:

- a conditional Delivery Graph or parallel writer scheduler;
- broad repository intelligence, ownership inference, or control-flow maps;
- full dependency, container, remote-worker, or CI attestation;
- outcome observation after the task decision;
- cross-task Decision Continuity, preference learning, or policy activation;
- team memory, server mode, PR automation, organization analytics, or automatic
  adoption.

## Evidence-gated evolution

Target capabilities enter the implementation only after the preceding simpler
loop is usable and the next capability has a concrete consumer.

### Prove and simplify the task-scoped loop

- pass black-box usability using only packed packages and generated Adapters;
- run protocol-complete paired evaluations with blinded Human review and timing;
- include adverse results and at least one real repair/recollection path;
- remove ceremony that does not improve implementation, adoption, or cognition.

### Improve bounded delivery and evidence

- richer evidence strategies and trusted baseline inputs;
- stronger task-local repository and verifier-surface investigation;
- better diagnosis and comparison without automatic cause inference;
- additional programmatic Host capability and attestation adapters;
- lower-friction authoring and review presentation.

### Add repository intelligence

- task-scoped ownership and control-flow maps;
- test-surface and verifier-dependency discovery;
- richer assurance strategies and layered review workspaces;
- external executor ports with exact provenance.

Repository intelligence may propose interpretations or evidence paths; it may
not infer task consequence or assurance from filenames, token overlap,
dependency count, path count, or a scalar score.

### Add conditional delivery only when justified

Introduce orchestration in this order:

1. trusted fresh-context verifier;
2. parallel read-only investigation;
3. layered fan-in with completeness checks;
4. isolated parallel writes and an explicit integration node;
5. broader multi-Agent scheduling only if still necessary.

A DAG is justified only when identifiable task classes degrade under a simple
chain and measured fan-out benefit exceeds coordination cost.

### Add Decision Continuity last

Only after task-level value is demonstrated should Stetra observe later merge,
revert, incident, or post-deploy outcomes and introduce scoped, Human-authorized
Decision Records. Team policy, shared continuity, remote workers, server mode,
retention/export, and organization features come later still.

## Product evidence

Technical verification establishes internal consistency and distributability,
not product effectiveness. Formal evaluation retains raw measures for:

| Category | Evidence |
|---|---|
| Implementation | acceptance checks, review defects, escaped defects, revert, incident |
| Delivery | completion, repair Attempts, correction rounds, blocked or exhausted outcome |
| Human cost | active review time, clarification count, interruption count |
| Agent cost | wall time, tokens, Agent calls, check and protocol time |
| Cognition | correct understanding of behavior, invariants, ownership, and failure entry points |
| Assurance | coverage, contradiction detection, Challenge and Review Map usefulness |
| Continuity | applicable-decision precision and stale-decision activation, once implemented |
| Adoption | accept, needs-correction, reject, or defer |

Every result preserves repository, Agent, Host, task type, reviewer, starting
state, and protocol scope. Inconclusive and adverse results remain visible. The
retained historical pilot is inconclusive; product effectiveness remains
`unverified` until paired evidence satisfies
[`evaluation/paired-agent/PROTOCOL.md`](../evaluation/paired-agent/PROTOCOL.md)
and a Human product owner accepts a scoped conclusion.

## Complexity gates

Every persistent field, event, graph edge, lifecycle state, node type, and Host
capability must answer:

1. Which alignment, execution, recovery, assurance, review, adoption, or future
   activation decision can it change?
2. Can the developer inspect that decision and distinguish its authority and
   evidence?
3. Can its value be measured against a simpler baseline?

Remove or defer it when those questions have no concrete answer. Planned
architecture is a constrained hypothesis space, not a feature checklist.
