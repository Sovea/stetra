# Architecture

This document describes the architecture implemented by the initial version of
protocol `cognitive-adoption`, schema `1`. Future product hypotheses remain in
[Product direction](product-direction.md); they are not current Runtime facts,
authority, or effectiveness evidence.

## Product boundary

Stetra is the cognition and adoption control layer for delegated production
coding. It keeps one inspectable engineering thread from an exact developer
event, through Agent interpretation and implementation, to Runtime observations,
a decision-oriented handoff, and an exact Human adoption decision.

It is not a coding agent, automated approver, project manager, general workflow
engine, repository wiki, transcript store, or cross-task memory system. Core and
CLI never call an LLM; the Host Agent owns semantic reasoning and repository work.

The task-scoped kernel remains three cores:

1. **Semantic Contract** — what the change is intended and authorized to mean.
2. **Fact Spine** — what the workflow actually observed.
3. **Cognitive Handoff** — what the change means, what remains unknown, and where
   direct review has adoption value.

An exact Human Decision closes the task. Decision Continuity across tasks is not
implemented.

## Fixed lifecycle and closed recovery paths

```text
prepare
  -> Agent implementation
  -> collect
  -> diagnose every non-passing Definition
       -> implementation repair -> successor Attempt -> recollect
       -> verification revision -> successor Attempt -> recollect
       -> independent challenge
       -> exact Human resolution
       -> handoff with unresolved evidence
  -> independent challenge required by contract or collected mutation
  -> Cognitive Handoff
  -> Human Decision
       -> accepted / rejected / deferred
       -> correction-requested -> exact Human resolution
                               -> successor correction Attempt
```

`change explain` is on-demand inspection. A timeout retry is same-Attempt
operational recovery. The macro lifecycle is fixed; the initial protocol does not add a
general workflow graph or Runtime-selected mode.

Every state-changing Host route now has an executable successor. In particular,
`resolve-evidence-decision` returns an exact `change resolve` command, and a
correction decision no longer strands the task.

## Authority partitions

| Actor | Owns | Does not own |
|---|---|---|
| Developer | Exact requests, corrections, long-lived tradeoffs, exceptions, and adoption | Runtime observations or Agent investigation |
| Agent | Interpretation, repository investigation, reversible engineering judgment, implementation, diagnosis, falsification, challenge conclusions, handoff, and recommendation | Developer authority or machine facts |
| Runtime | Identity, exact references, baselines, immutable verification definitions, actual changes, ordered attempts, bounded logs, timing, currency, and deterministic structural policy | Product meaning, semantic truth, engineering cause, or adoption |
| Trusted Host integration | Actual tool configuration and fresh-context attestation that it controls | Semantic truth or Human authority |

Storage and labels cannot move information across partitions. Runtime validates
that conclusions do not exceed declared evidence results; it does not determine
whether a test really proves a natural-language statement.

## Semantic Contract and falsifiable evidence

Prepare accepts:

- one Host-generated `prepareRequestId` that identifies an exact submission
  across transport retries;
- one exact `developerEvent`, separate from Agent interpretation;
- desired outcome, constraints, non-goals, and focus paths;
- optional exact repository-evidence windows;
- zero or more material or adoption-critical Conditions;
- explicit Host policy requirements;
- bounded repair count;
- argv checks or a concrete no-command rationale.

Routine work may have no Condition. Once a Condition exists, it must contain at
least one **Falsifiable Evidence Obligation**. Each Obligation states:

- the bounded sub-conclusion it is intended to support;
- the plausible failure hypothesis that must be actively considered;
- one or more exact evidence strategies:
  - Runtime Check through logical Verifier identity;
  - repository inspection through exact Repository Evidence;
  - independent Challenge with `required` or `fact-triggered` policy;
  - direct Human review.

Every Obligation conclusion includes a falsification attempt, exact supporting
evidence, exact counter-evidence, and `supported`, `partial`, `contradicted`, or
`unknown` status. A Condition cannot be `supported` unless all its Obligations
are `supported`. This is a structural evidence ceiling, not semantic proof.

Adoption-critical Conditions must declare independent Challenge or direct Human
review, and they always receive consequence-directed Review Map coverage.

No Condition, policy, route, or assurance requirement is inferred from keywords,
filenames, path count, diff size, dependency count, error text, or a scalar
complexity, confidence, trust, risk, or readiness score.

Prepare request identity is also never inferred from Contract equality. Under
the worktree lease, the first successful submission binds its request ID to the
exact input fingerprint and published task. Replaying that ID with identical
input returns the current projection of the same task without running baseline
checks or writing an event. Reusing it with different input is rejected; an
explicitly different request ID always creates a distinct task.

The task storage ID is deterministically derived from the explicit
`prepareRequestId`. The lease remains the normal serialization boundary, while
the deterministic destination is a second uniqueness invariant: even if two
transport attempts overlap, they cannot publish two task directories for one
request. A concurrent loser replays the exact published task after verifying
the input fingerprint.

## Identity model

The initial protocol separates three identities:

```text
semanticContractId
verificationPlanId
effectiveContractId = fingerprint(semanticContractId, verificationPlanId)
```

A logical Verifier has a stable `verifierId` derived from its explicit key. Each
immutable executable definition has a content-bound `definitionId`, revision
number, and optional `supersedesDefinitionId`. Check Attempts and Fact Bundles
bind the exact Definition, never merely the logical key.

This separation permits verification correction without pretending task meaning
changed, while retaining every fact under the identity that produced it.

## Fact Spine

### Baseline and collection

Prepare executes only Definitions whose baseline object explicitly selects
`task-start`, explains why before/after comparison changes an Obligation, and
names those Obligation keys. The post-check worktree becomes the implementation
baseline; baseline-check side effects remain visible.

Collect executes every current immutable argv Definition without a shell and
records:

- complete baseline-to-current change and representable patch;
- pre-check and post-check worktrees;
- check-induced changes;
- ordered Attempts with `startedAt`, `durationMs`, timeout budget, structured
  termination (`exit`, `signal`, `timeout`, or `spawn-error`), an outcome
  fingerprint, full-stream digests, and bounded logs;
- command-definition and acceptance-surface mutations;
- non-secret execution-environment observations;
- mechanical baseline/current relations.

`passed` is a fact about one command, not a semantic conclusion. `failed`,
non-timeout `unavailable`, and timeout remain distinct.

### Evidence disposition

Every current non-passing Definition is diagnosed exactly once. Agent input
binds the exact `definitionId`, cause, diagnosis, falsification attempt, expected
different observation, any bounded implementation edits, a proposed next route,
and the rationale for that route.

Runtime validates route compatibility against only those explicit values:

| Explicit input | Route |
|---|---|
| material semantic impact | exact Human resolution |
| implementation cause | repair successor or handoff |
| implementation cause with exhausted budget | handoff with Attention |
| environment or verification cause | immutable Verification Revision or handoff |
| unknown cause | independent Challenge, handoff, or exact Human resolution |

A repair route may include additional environment or verification entries when
at least one entry explicitly identifies a bounded implementation cause. Only
the implementation entries authorize edits; every check is recollected and the
other failures remain visible. This closes the common mixed-result path without
guessing cause from output.

Runtime never reads error prose to guess a cause.

Only the current Attempt's Evidence Disposition participates in current
handoff validation and Attention derivation. Earlier dispositions remain
immutable lineage in the Decision Packet, but cannot be revalidated against a
later Verification Plan or reopen a resolved current route.

## Immutable Verification Revision

`change revise-verification` compiles a new Verification Plan while preserving
the Semantic Contract. Two explicit kinds exist:

- `execution-rebinding`: only argv may change; logical Verifier set, rationale,
  baseline semantics, and declared verifier surfaces must be identical;
- `verification-plan`: a broader evidence-plan change.

Both record an Agent equivalence claim and produce `verification-revised`
Attention. Core mechanically requires exact Human authorization when a revision
removes a Verifier, changes task-start baseline to unknown, or removes a declared
command/acceptance surface. Obligations cannot lose a Verifier they still consume.

Old Contracts, Definitions, Attempts, facts, and decisions are never overwritten.
A revision creates a successor Attempt under a new `effectiveContractId`. When
the original baseline cannot honestly execute the new Definition, the new
Baseline Fact is `unknown-after-revision`; Runtime never runs the revised check
in the modified worktree and calls that the original baseline.

## Independent Challenge and Host provenance

Challenge is required when an Obligation declares `required`, or when a
`fact-triggered` Obligation consumes a logical Verifier whose declared
acceptance surface changed. Criticality does not suppress this self-verification
risk.

Challenge input names Obligation IDs and uses structured supporting and counter
evidence with exact references. CLI derives Condition IDs and generates the
Challenge ID. Agent JSON cannot supply independence, implementer context,
challenger context, or attestation identity.

A trusted native Adapter or Evaluator may inject `host-attested` independence.
The current generated Markdown adapters are thin skills and therefore receive
no automatic independent Challenge action. They project the unresolved failure
hypothesis directly into Handoff as a concrete Human review obligation. A
manually recorded thin-context Challenge remains `unverified`, never fake
enforcement. Missing, adverse, or unverified Challenge caps related conclusions;
`supported` is rejected when required Challenge evidence is absent. Recording a
Challenge satisfies the lifecycle's challenge action; it does not repeatedly
route back to Challenge merely because the outcome or independence is adverse.
The thin-Host direct-review projection is preserved after diagnosis and Human
resolution as well as immediately after collection; no later route may silently
restore a trusted-Challenge requirement.

Host tool policy is a separate partition from Runtime execution environment:

```text
Host policy requirement
  -> Host capability/configuration
  -> Host enforcement attestation
```

Thin skills record `instruction-only`. Only a programmatic trusted provider may
record `enforced`; required unverified policy pauses prepare for an exact Human
resolution. Preferred gaps remain visible during adoption review.

## Task-specific Authoring Projection

Every input-requiring Host Action can carry a transient `authoringPacket` with:

- current task/revision/contract/Attempt/fact bindings;
- the exact Human Event beside a separately labeled Agent interpretation of
  outcome, constraints, non-goals, and focus;
- a directly fillable input draft;
- field requirements that name the exact draft path, accepted enum values or
  object variants, and whether the choice belongs to Agent judgment or Human
  decision;
- only the current stage's necessary Condition, Obligation, Definition,
  changed-file, Challenge, repository-evidence, or Attention references;
- outstanding structural obligations.

Packets cover diagnosis, Verification Revision, Challenge, handoff, decision,
and Human resolution. CLI generates boilerplate artifact, Human Event, Challenge,
Handoff, Review Question, and Decision IDs.

The containing Host Action declares an `inputBinding`: serialize the completed
draft as JSON and attach it to the exact command's stdin in one non-interactive
process. This prevents an interactive transport failure from being confused
with invalid protocol input. It changes no authority and is not persisted.

Authoring Packets are derived output. They are not persisted, do not create a
mode or lifecycle state, and cannot hide adoption-changing information. Exact
canonical artifacts remain available through `change explain`. Field
requirements share the CLI input-schema constants; they do not recommend a
semantic value or provide a second validation schema.

JSON presentation places `hostAction` first. `change explain --section action`
regenerates the current action and draft without writing lifecycle state, so a
Host never needs to probe a write command with `{}` merely to recover its input
shape.

## Cognitive Handoff and Human decision

The Agent supplies:

- decision-oriented summary;
- exactly one conclusion per Evidence Obligation;
- exactly one bounded conclusion per Condition;
- important system effects;
- residual unknowns and next actions;
- consequence-directed review questions;
- recommendation distinct from adoption.

Runtime first checks worktree currency, then evaluates evidence references,
Obligation/Condition ceilings, Challenge outcomes, Host policy provenance, and
Review Map coverage. It derives consolidated Attention groups rather than one
item per changed file.

`handoff-ready` means ready for Human review, never adopted. Acceptance with
Attention must explicitly name an exception for every current Attention item.
`correction-requested` persists the original Handoff and Decision, pauses for an
exact Human Resolution, then creates a lineage-linked correction Attempt.

The returned Decision Packet is a normalized view rather than an embedding of
the full Contract, Fact Bundle, Challenge list, Handoff, Evaluation, and a
second review tree. It contains the compact Semantic Contract, one condition and
Obligation view, system meaning, current Runtime fact summary and log
references, evidence-judgment summaries, Review Questions, and full Attention
exactly once. Canonical detail remains available through named `change explain`
sections.

## State and persistence

Task state lives under `.stetra/tasks/<taskId>/`. `events.jsonl` is append-only;
`task.json` is a rebuildable projection. Prepare and Collect hold one
project-worktree lease only while observing or executing against the shared
worktree. The lease records PID and process-start identity and is reclaimed only
after the owner is confirmed dead; elapsed time alone never authorizes
recovery. Prepare publishes a complete staged task by atomic rename. Collect
stages logs, patch, and facts outside the task, then uses expected revision and
a short task commit lock to publish artifacts and append its event. No external
check runs while the task commit lock is held.

```text
contracts/<revision>.json
contracts/<revision>.plan.json
contracts/<revision>.baseline.json
contracts/<revision>.baseline-verification.json
verification-revisions/<revisionId>.json
attempts/<attemptId>/attempt.json
attempts/<attemptId>/facts/<factCollectionId>.json
attempts/<attemptId>/evidence-disposition.json
attempts/<attemptId>/checks/...
attempts/<attemptId>/change-<revision>.patch
challenges/<challengeId>.json
handoffs/<handoffId>.json
handoffs/<handoffId>.evaluation.json
decisions/<decisionId>.json
decisions/<decisionId>.evaluation.json
resolutions/<resolutionId>.json
events.jsonl
task.json
```

As the initial persisted schema, it has no translator, alias, dual read/write,
or migration state.

## Package and API boundary

```text
Generated Host adapter -> CLI -> Core
```

- `@sovea/stetra-core` owns deterministic authority validation, contract and
  revision compilation, fact binding, Challenge obligations, handoff evaluation,
  Attention, and Human-decision binding. Its root runtime values remain exactly
  `compileDelegation` and `evaluateHandoff`.
- `@sovea/stetra` owns commands, IO validation, task sequencing, Git/check
  collection, persistence, trusted Host-attestation injection, transient
  authoring projection, packet assembly, presentation, and generated workflows.

There is no third package, global memory, cloud service, or provider SDK.

## Complexity movement in the initial MVP

Removed:

- Agent-authored downstream boilerplate IDs;
- Agent-authored `host-attested` Challenge provenance;
- parallel Condition-level evidence strategy and Challenge policy structures;
- the immutable-check dead end that forced an unrelated new task;
- prose-only Human-resolution and correction routes;
- duplicated CLI Challenge-trigger implementations.

Added:

- Evidence Obligation and Obligation Conclusion artifacts inside existing
  Contract/Handoff boundaries;
- separated semantic, verification, and effective identities;
- immutable Verification Definition lineage and revision artifacts;
- exact Human Resolution artifacts and successor correction Attempts;
- Host policy evaluations with explicit provenance;
- transient task-specific Authoring Packets;
- explicit Prepare request identity and exact-input replay binding;
- authoritative Check timing facts.

The new persistent fields change compilation, collection, recovery, challenge,
handoff, or adoption decisions directly. No cross-task state was introduced.

The final MVP convergence removes the single-valued
`expectedObservation: passed` input boilerplate and avoids thin-Host Challenge
artifacts that cannot have independent provenance. It adds no persistent state:
Prepare uses a deterministic task destination derived from existing request
identity, mixed-cause repair changes only route validation, and the full
baseline moved behind a named inspection section while normal Prepare output
uses a compact summary.
