# Architecture

This document is the authoritative long-term product positioning and top-level
design for Stetra. It describes the target system and identifies the implemented
initial slice. A planned capability is a bounded hypothesis, not current
behavior or authorization to implement it without a concrete consumer and
supporting evidence.

The executable CLI behavior is defined separately in
[Change workflow](change-workflow.md). When the documents differ, the workflow
describes what exists today while this document constrains how it may evolve.

## Product positioning

Stetra is an **engineering control harness for delegated coding changes**.

It keeps developer intent, Runtime-observed engineering reality, Agent
judgment, developer understanding, and Human adoption connected throughout one
change. Its objective is to reduce the total cost from request to confident
adoption without weakening implementation outcomes, system understanding, or
engineering judgment.

Relative to Codex, Claude Code, Pi, Trellis, GSD, and similar execution Hosts,
Stetra is the task-scoped semantic, evidence, cognition, and adoption control
layer. The Host supplies models, repository tools, shell execution, sessions,
subagents, worktrees, cancellation, and interaction surfaces. Stetra does not
plan or schedule the Host's coding loop.

The product protects five first-class developer rights:

| Right | Product obligation |
|---|---|
| Direction | Preserve exact developer authority and expose material semantic forks. |
| Visibility | Present actual repository and verification facts independently of Agent prose. |
| Intervention | Return control when continuing requires a Human-owned choice. |
| Understanding | Reconstruct the actual behavior, mechanism, invariants, ownership, and failure paths. |
| Adoption | Keep completion, evidence, recommendation, and Human acceptance separate. |

The success contract is conjunctive:

```text
implementation outcome is non-inferior or better
AND Human adoption cost is lower
AND developer cognition is non-inferior
AND adoption authority remains Human
AND evidence provenance remains inspectable
```

These are evaluation constraints, not responsibilities that authorize Stetra
to become another implementation harness. Faster review with worse code is
failure. Correct code that the developer cannot understand is failure. A
rigorous packet that increases work without improving a decision is also
failure.

## Product kernel

The architecture has three task cores and one Human-owned control loop.

### Semantic Contract

The Semantic Contract records what one delegated change is intended and
authorized to mean. It separates exact Human Events from Agent interpretation,
captures material conditions and evidence obligations, freezes verification,
and identifies choices that cannot be made by repository investigation alone.

It protects direction. It is not a generated implementation plan.

### Fact Spine

The Fact Spine records what the workflow actually observed: baselines, actual
file operations, immutable verification definitions, ordered check attempts,
bounded logs, verifier changes, environment observations, and fact currency.

It protects visibility. A fact does not decide product meaning, and a passing
command is not a semantic conclusion.

### Cognitive Handoff

The Cognitive Handoff reconstructs the actual system change from current facts
and Agent investigation. It communicates behavior, mechanism, invariants,
failure behavior, important effects, material tradeoffs, evidence-bounded
claims, residual unknowns, and consequence-directed Review Decisions.

It protects understanding. It is neither a transcript nor a polished
completion story.

### Engineering control loop

The fixed loop connects the three cores to explicit Human authority:

```text
Developer direction
  -> Semantic Contract
  -> Agent execution through its normal Host
  -> Fact Spine
  -> evidence-directed investigation, correction, or Human fork
  -> Cognitive Handoff
  -> Human adoption decision
```

Evidence may drive a bounded successor Attempt, verification revision, or
recollection, but the Host and Agent still own execution. Stetra preserves and
routes the reason; it does not choose the engineering implementation.

Longitudinal Decision Continuity is outside the current kernel. It may be
considered only after the task-scoped loop proves value and a concrete future
decision consumes the retained state.

## Durable principles

1. **Authority remains partitioned.** Human authority, Agent judgment, Runtime
   facts, and Host attestation cannot be relabeled as one another.
2. **Facts remain observation-bound and freshness-bound.** Later edits
   invalidate conclusions that depend on earlier observations.
3. **Claims expose their evidence boundary.** Material conclusions retain
   support, counterevidence, falsification, and unknowns.
4. **Non-passing evidence is judged before action.** A failed command is not a
   diagnosis and does not authorize a production edit.
5. **Conclusions cannot exceed declared evidence.** Runtime may enforce
   coverage and contradiction ceilings without claiming natural-language
   truth.
6. **History is superseded, not rewritten.** Definitions, Attempts, facts,
   corrections, and decisions remain inspectable.
7. **The smallest adequate workflow is the default.** Ceremony must be caused
   by an explicit semantic requirement, fact, evidence gap, Host limitation, or
   Human-owned choice.
8. **Authoring convenience cannot collapse provenance.** Machine-generated
   identities and bindings remove ceremony without promoting Agent prose into
   facts or authority.
9. **Host capabilities require honest provenance.** Instructions cannot become
   tool enforcement, isolation, or independent-context attestation through a
   label.
10. **Human adoption remains explicit.** Completion, green checks, Agent
    consensus, or apparent readiness never become automatic approval.

## Responsibility boundary

| Actor | Owns | Does not own |
|---|---|---|
| Developer | Exact requests and corrections, desired outcomes, constraints, non-goals, long-lived tradeoffs, exceptions, external or irreversible effects, and adoption | Runtime observations or Agent investigation |
| Agent | Interpretation, repository investigation, design, local reversible engineering judgment, implementation, diagnosis, falsification, correction, recommendation, and Handoff semantics | Developer authority, machine facts, or adoption |
| Runtime | Identity, references, ordering, immutable definitions, baselines, actual changes, check attempts, bounded logs, currency, and deterministic structural policy | Product meaning, semantic truth, engineering cause, implementation strategy, or adoption |
| Trusted Host integration | Tool configuration, isolation, fresh-context identity, and external-effect controls it actually enforces | Semantic truth or Human authority |

Storage, labels, signatures, and generated prose cannot move information across
these partitions. A Human exception cannot erase a contradictory fact. A fact
cannot decide product meaning. Agent prose cannot become a Human decision or a
Runtime observation through a field name.

Exact developer messages and decisions use Human Events. Structured outcomes,
constraints, Conditions, tradeoff interpretations, actual-change models, and
recommendations remain Agent interpretations with exact bases. Runtime validates
identity and references, not whether an interpretation is faithful or true.

## Product boundary and anti-goals

Stetra owns:

- exact task semantics and material-fork handling;
- falsifiable evidence obligations and frozen verification boundaries;
- Runtime-collected repository, verification, execution, and bounded
  environment facts;
- structural evidence coverage, contradiction ceilings, and correction
  lineage;
- Cognitive Handoff, Review Decisions, and exact Human adoption;
- thin, provider-neutral Host interaction with honest capability provenance.

Execution Hosts own:

- model selection, reasoning settings, and context windows;
- repository investigation, planning, and implementation strategy;
- shell, editor, and general tool access;
- sessions, subagents, worktrees, scheduling, streaming, and cancellation;
- provider-native external-effect approval surfaces.

Stetra does not aim to become:

- a Coding Agent, ReAct loop, TUI, web chat, model-provider SDK, or model router;
- an Adaptive Delivery Plane, generic planner, task decomposer, execution
  scheduler, or universal DAG engine;
- a replacement for Trellis, GSD, or provider-native orchestration;
- a generic code-review bot, architecture generator, or prompt library;
- a repository wiki, transcript archive, specification warehouse, broad
  project-memory system, or graph database;
- a heuristic quality system or scalar trust, readiness, cognition, risk, or
  productivity scorer;
- an automated approver, cloud analytics service, or worktree fleet platform.

Stetra may influence Agent execution only through a concrete task boundary,
fact, evidence gap, correction, or Human decision. It does not own a Delivery
Graph, general Plan IR, repository-intelligence plane, or multi-Agent
orchestration roadmap.

## Fixed task lifecycle

The task-scoped governance lifecycle remains fixed:

```text
Align and compile
  -> Agent implementation
  -> Collect facts
  -> Diagnose and converge when required
  -> Cognitive Handoff
  -> Human Decision
```

The implemented command path is:

```text
prepare -> Agent implementation -> collect -> handoff -> decide
                                      |
                                      +-> diagnose -> local repair /
                                                       verification revision /
                                                       direct review /
                                                       Human resolution
```

`change explain` is on-demand inspection, not a mandatory successful-path
stage. Independent Challenge is an optional evidence strategy, never a
mandatory lifecycle stage or Stetra-owned Agent role.

The developer should not watch every Agent action. Control returns only when
continuing would require a Human-owned choice or when the decision surface is
ready. Repository-discoverable details, local reversible design choices, and
authorized corrections remain Agent work.

## Semantic Contract

### Human Event and Agent Interpretation

A Human Event preserves exact developer content, provider identity, and event
identity. Agent Interpretation holds a bounded task meaning beside its exact
basis. The two remain physically separate.

The Agent interpretation includes desired outcome, constraints, non-goals,
focus, and any material decision fork. Another planning framework may conduct
the conversation and submit its resolved interpretation once. Stetra does not
run a duplicate generic clarification dialogue.

### Assurance and Evidence Obligations

Routine work explicitly declares why no material Condition is needed.
Conditioned work defines one or more material or adoption-critical Conditions.
Each Condition has independently concludable Evidence Obligations containing:

```text
bounded statement
plausible failure hypothesis
concrete scenario
supporting observation
contradicting observation
explicit evidence strategies
```

An Obligation is an inspectable Agent commitment to evidence coverage, not a
semantic theorem. Runtime can enforce that a conclusion does not exceed
declared findings and adverse evidence. It cannot determine whether a test
truly proves natural-language meaning.

Evidence strategies are exact Runtime Checks, bounded Repository Evidence, or
an independently attested Challenge. Direct Human review is a consequence of
missing, unavailable, unverified, or adverse evidence; it is not evidence that
makes a path complete.

### Verification and execution budget

Every Check freezes ordered preparation commands, one assertion command,
explicit execution inputs, baseline policy, verifier selectors, and a bounded
execution policy. Commands are argv-only and run without a shell.

Timeout is an operational Attempt budget, not Check identity or semantic
authority. Baseline comparison runs only when it changes a named Evidence
Obligation. Otherwise baseline test status remains honestly unknown.

Focus paths guide investigation and review. They are not write permissions or
a prediction of changed files.

## Fact Spine

The Fact Spine records observations, not beliefs:

- complete baseline-to-current file operations and representable patch;
- pre-check, post-check, and check-induced changes;
- immutable logical Verifiers and exact Definition revisions;
- ordered preparation and assertion Attempts;
- timeout budgets, termination, durations, bounded logs, and full-stream
  digests;
- declared verifier-surface mutations and exact matched paths;
- mechanical baseline/current relations and evidence concerns;
- bounded non-secret environment observations;
- fact currency against the current worktree and effective Contract.

Passing, completed failure, timeout, signal, spawn failure, and unavailable
execution remain distinct. Direct Host execution may contribute Agent evidence,
but it cannot replace a frozen Runtime Check Attempt.

### Attempt and Verification lineage

Completed and superseded artifacts remain immutable. Local correction,
verification revision, and Human correction create successor Attempts linked to
their prior Contract, Definitions, facts, and decisions.

Identity separates:

```text
semanticContractId
verificationPlanId
effectiveContractId = fingerprint(semanticContractId, verificationPlanId)
```

A logical Verifier has stable identity; executable Definition identity is
content-bound. Verification can evolve without pretending task meaning changed,
and a relaxed plan cannot erase facts from its predecessor.

### Evidence judgment and convergence

Every current non-passing Definition and declared baseline-expectation mismatch
receives explicit Agent diagnosis. Runtime keeps these as
mechanical concerns and never parses output prose to infer cause.

Agent judgment may route a concern to:

```text
repository implementation -> bounded local correction
execution definition       -> verification revision
semantic uncertainty       -> independent Challenge when available
bounded evidence gap       -> Cognitive Handoff and direct review
semantic drift             -> exact Human resolution
```

Runtime validates facts, coverage, authority, effect declarations, budgets,
and transition prerequisites. It does not choose the engineering route from
filenames, command names, dependencies, diff size, or error text.

## Cognitive Handoff

The Handoff is authored only against complete current facts. Its actual-change
model states:

```text
actual behavior
implementation mechanism
preserved invariants
failure and recovery behavior
important effects
material tradeoffs
```

It concludes every declared Evidence Obligation and Condition, records
falsification and counterevidence, preserves residual unknowns, and provides a
small set of shared consequence-directed Review Decisions. Each Review Decision
states one question, why it changes adoption, the next action, and exact
evidence.

Runtime-collected facts and Agent-authored findings remain separate surfaces.
A missing evidence path can cap recommendation and require direct review without
pretending it semantically contradicts the implementation.

The transient Developer Decision Brief is the primary Human surface. It leads
with delivery, evidence, recommendation, and adoption state, then communicates:

- actual behavior and core implementation mechanism;
- preserved invariants and failure behavior when material;
- exact baseline-to-current verification changes;
- bounded findings and evidence-path gaps;
- residual unknowns and the few inspections that can change adoption;
- the Agent recommendation and pending Human choice.

Opaque IDs, full logs, patches, and history stay in exact on-demand detail.

## Human Resolution and Decision

Human Resolution closes a material mid-task choice such as semantic impact,
verification relaxation, an exception, a Host-policy gap, or correction
continuation. Multiple pending requirements caused by one exact Human choice
should be presented and resolved as one decision surface while retaining their
individual identities.

Human Decision records `accepted`, `correction-requested`, `rejected`, or
`deferred` for the exact current Handoff and facts. Acceptance with unresolved
Attention names the accepted exceptions. Decision recording never commits,
merges, publishes, deploys, or creates cross-task policy.

## Host integration

### Integration shape

The dependency direction remains:

```text
Generated Host Adapter -> CLI -> Core
```

The portable baseline is a thin generated Adapter plus the CLI. Provider-native
Hooks may preserve task continuity and guard the final response, but the core
workflow must remain usable without them. MCP, a daemon, a provider SDK, or a
Stetra-owned Agent loop is not required.

A future Host capability enters through a narrow provider-neutral boundary only
when a real Adapter controls and attests it. Codex, Claude, Pi, or another Host
maps its native events and capabilities to that boundary without changing Core
or the task lifecycle.

### Semantic authoring boundary

The Agent must not act as a client for Stetra's canonical persistence protocol.
It authors only stage-specific semantic payloads. CLI compiles them into the
complete canonical artifact.

Agent-authored content includes:

- task interpretation and material forks;
- Conditions, failure hypotheses, and evidence intent;
- diagnosis, falsification, and proposed engineering route;
- actual-change model, bounded findings, unknowns, review questions, and
  recommendation;
- interpretations of later exact Human Events.

CLI-owned structure includes:

- artifact IDs and fingerprints;
- Task, Contract, revision, Attempt, and Fact Collection bindings;
- canonical Condition, Obligation, Verifier, Definition, Check Attempt,
  Attention, and Review Decision references;
- current Host capability disclosure and evidence-path state;
- fixed fields, ordering, identity conversion, currency checks, and final
  canonical assembly.

The authoring shape is intentionally smaller than the persisted artifact:

```text
compact semantic payload
  -> deterministic validation and binding
  -> canonical strong-protocol artifact
```

This compiler performs exact mapping, not semantic inference. It may use only
current task state, exact readable keys, schema constraints, Host disclosure,
and explicit Agent selections. It must not rank files, interpret prose, infer
importance, or guess equivalence.

### Dynamic Host Projection

Every lifecycle state derives one structured `hostAction` with an action kind,
exact argv command when executable, final-response guard, and the smallest
current semantic authoring surface.

An input-bearing action provides one Stetra-owned Draft and a compact companion
Guide. The Draft prebinds machine-owned structure and leaves only semantic
fields open. The Guide contains:

- the current semantic context needed for the action;
- readable exact keys and available evidence selectors;
- unresolved obligations and current fact summaries;
- the exact command for a task-specific schema mechanically generated from the
  canonical validation source when the Draft and bounded correction are
  insufficient;
- exact detail commands for information deliberately kept out of the default
  context.

The full schema is not duplicated into every Guide. There is no separately
maintained hand-written partial schema. Canonical schema and artifacts remain
available on demand.

At most one authoring generation for one Task stage and current fact binding is
valid. A successful submission, recollection, revision, correction, or stage
transition deterministically invalidates every older Draft and Guide for that
Task. Inbox transport is never task state or authority.

Routine responses expose mechanically bounded fact summaries and exact detail
selectors. In particular, the Agent receives existing baseline/current Check
status and log selectors before deciding whether any direct Host execution is
useful. Runtime facts are not hidden behind a requirement to rerun commands.

### Host capability disclosure

One Host Capability Snapshot describes the current integration boundary for the
session or exact task binding. Individual policy requirements retain distinct
identity, but requirements sharing one unavailable capability and one exact
Human authority boundary are presented through one resolution surface.

Requirements, capabilities, and enforcement remain separate:

```text
Host policy requirement
  -> Host capability snapshot
  -> Host enforcement attestation
```

A thin Skill reports an instruction-only boundary. It cannot
attest that network, search, or subagents were disabled or that a fresh context
existed. Missing capability becomes a visible evidence gap or exact Human
choice, never a fabricated guarantee.

### Independent Challenge

Independent Challenge is an evidence strategy, not a claim that Stetra owns a
subagent. The current protocol has no Challenge-result input. A future result
could enter only through a Host boundary that can bind a genuinely distinct
context to the exact task and source snapshot.

Without that boundary, required Challenge remains missing, caps the related
recommendation, and becomes a concrete direct-review obligation. Generated
thin Codex and Claude adapters do not simulate independence with Agent-authored
context strings.

### Final-response continuity

The CLI provides a read-only final-response guard that checks task state and
fact currency before the Host replies. It returns the exact current action, the
Developer Decision Brief, or the recorded Human decision.

Provider Hooks may call the same guard for one exact bound Host session. They
store only routing identity and delivered action fingerprints. They do not
store prompts or transcripts, scan for recent tasks, infer semantic meaning,
attest tool enforcement, or create adoption authority.

Presenting a current Developer Decision Brief is a valid end to the Agent's
turn, not unfinished implementation work. A Hook may surface the exact pending
Human choice, but it must not force another Agent turn or invoke an interactive
input mechanism: only a later developer message supplies adoption authority.

## Persistence and transactions

Task state lives under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only lifecycle source and `task.json` a rebuildable projection. Immutable
artifacts are partitioned by Contract revision, Attempt, Fact Bundle,
Verification Revision, Handoff, Resolution, and Decision.

Persistence follows these rules:

- one task cannot make its state authoritative for another;
- facts remain bound to the exact Contract, Definition, Attempt, environment,
  and worktree that produced them;
- supersession never deletes adverse or contradictory history;
- timestamps record lifecycle occurrence, not deterministic identity;
- transient Host transport never becomes task state;
- cross-task state requires a separately justified Human-authorized consumer.

Prepare and Collect use project-worktree leases and short task commit locks.
External checks never run while the task commit lock is held. A lease is
reclaimed only after the owning process is confirmed dead; elapsed time alone
does not authorize eviction. Conflicting writers fail rather than overwrite a
newer projection.

Prepare and Collect are idempotent only through exact request, task, revision,
and worktree identity. Semantic similarity, elapsed time, command names,
repository shape, and output prose never participate in identity or reuse.

## Package and API boundary

The workspace has two publishable packages:

- `@sovea/stetra-core` owns deterministic authority validation, Semantic
  Contract compilation, fact schemas and binding, evidence ceilings, Handoff
  evaluation, Attention, and Human-decision binding.
- `@sovea/stetra` owns commands, IO validation, task sequencing, Git and check
  collection, storage, semantic-input compilation, transient projection,
  presentation, project initialization, and Host continuity Hooks.

Core and CLI never call an LLM. The Host Agent owns semantic reasoning and
repository engineering. Core continues to expose exactly
`compileDelegation` and `evaluateHandoff` as root runtime values unless an
independent consumer proves another public boundary is necessary.

## Implemented initial slice

The current `cognitive-adoption` schema `1` implements one task-scoped loop:

```text
prepare -> Agent implementation -> collect
        -> diagnose / bounded correction / verification revision / direct review
        -> Human resolution when needed
        -> Cognitive Handoff -> Human Decision
```

It already includes:

- exact Human Events separated from Agent interpretation;
- explicit routine or conditioned assurance, Conditions, and Falsifiable
  Evidence Obligations;
- frozen semantic, verification, and effective Contract identities;
- complete Git change collection, selective baselines, ordered Check Attempts,
  bounded logs, and fact currency;
- fact-bound diagnosis, bounded correction, timeout retry, Verification
  Revision, and correction lineage;
- honest instruction-only Host policy provenance and missing-Challenge review;
- actual-change model, Cognitive Handoff, Attention, Review Decisions, and
  exact current-task Human decisions;
- generated Codex and Claude thin adapters, task-specific authoring transport,
  final-response guard, and bounded continuity Hooks;
- append-only task events, rebuildable projection, staged publication, revision
  checks, and process-identity-based lease recovery.

The current implementation keeps full validation schemas on demand, groups
required Host-policy gaps into one Human resolution surface, derives task-start
baseline bindings from exact Check strategies, exposes baseline/current facts
and detail selectors in Handoff authoring, and invalidates obsolete task-owned
inbox generations on every transition. Prepare uses a request-bound semantic
payload, Verification Revision expands explicit keyed deltas, and Handoff fixes
task-specific Condition and Obligation properties while deriving canonical
Review Decision reverse references. Further semantic-input compilation may
remove only structure that CLI can bind exactly; it must not replace schema
complexity with prose parsing or hand-written field rules.

It does not implement and should not currently pursue:

- task decomposition, a Delivery Graph, Plan IR, or writer scheduler;
- broad repository intelligence or ownership inference;
- Stetra-owned subagents or multi-Agent orchestration;
- full dependency, container, remote-worker, or CI attestation;
- outcome observation, cross-task Decision Continuity, preference learning, or
  policy activation;
- team memory, server mode, PR automation, organization analytics, or automatic
  adoption.

## Evidence-gated evolution

### First: prove and simplify the task-scoped loop

- make the Agent author semantic payloads rather than canonical protocol;
- eliminate schema correction on fixed black-box regression tasks;
- remove duplicate Human resolutions, redundant verification, and stale Host
  transport;
- make the Developer Decision Brief preserve system understanding, evidence
  boundaries, and adoption state with low reading cost;
- compare against a strong Markdown Skill using Codex and Claude.

### Next: prove evidence-directed convergence

- demonstrate that a concrete adverse fact or evidence gap drives a useful
  correction, new observation, or Human decision;
- retain implementation outcome and developer cognition while reducing active
  adoption cost;
- add a trusted Host capability only for a measured consumer.

### Later: consider longitudinal continuity

Only after task-level value is demonstrated may Stetra evaluate scoped outcome
observation and Human-authorized Decision Continuity. Repeated Agent behavior,
generated summaries, passing checks, or apparent consensus cannot create policy.

## Product evidence and complexity gate

Technical verification establishes internal consistency and distributability,
not product effectiveness. Evaluation retains raw implementation, convergence,
Human cost, Agent cost, cognition, evidence integrity, and adoption
observations. Inconclusive and adverse results remain visible.

The decisive baseline is a strong Markdown Skill. Product effectiveness remains
`unverified` until paired evidence satisfies
[`evaluation/paired-agent/PROTOCOL.md`](../evaluation/paired-agent/PROTOCOL.md)
and a Human product owner accepts a scoped conclusion.

Every persistent field, event, lifecycle state, Host capability, and authoring
requirement must answer:

1. Which alignment, evidence, recovery, review, or adoption decision can it
   change?
2. Can the developer inspect that decision and distinguish its authority and
   evidence?
3. Can its value be measured against a simpler baseline?

Remove or defer it when those questions have no concrete answer.
