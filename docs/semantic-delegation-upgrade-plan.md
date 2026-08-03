# Semantic Delegation Upgrade Plan

- **Status:** Active migration plan
- **Target direction:**
  [`cognitive-semantic-delegation.md`](./cognitive-semantic-delegation.md)
- **Current implementation contract:**
  [`trustworthy-mvp-contract.md`](./trustworthy-mvp-contract.md)

## Purpose

This document tracks how the current trustworthy MVP moves toward the accepted
cognitive-synchronized semantic delegation direction.

It is intentionally more changeable than the target-direction document. It may
be reordered as implementation evidence arrives. It must not silently alter an
accepted product principle or present target behavior as already implemented.

## Migration rules

- Each increment must produce a user-observable improvement or enable a
  directly testable next increment.
- Prefer a narrow end-to-end slice over a broad new schema with no active
  consumer.
- Preserve current behavior until its replacement is implemented, tested, and
  explicitly documented as superseding it.
- Do not retain a current lifecycle merely to avoid a prototype breaking
  change.
- Do not create cross-task persistence before an exact compile, presentation,
  or evaluation consumer exists.

## Current baseline

The repository currently provides:

- a three-authority collaboration contract;
- Playbook activation and guidance delivery;
- reviewed RCCL observations and Host relation proposals;
- per-value task source labels declared through the Host input;
- deterministic `compileChange` and `evaluateChange` entrypoints;
- task-scoped worktree baselines, actual diff facts, frozen checks, and logs;
- Agent attestations, human-approved exceptions, and attributed evaluation
  bases;
- generated thin Host adapters and a CLI-first lifecycle.

## Capability movement

### Preserve as foundations

- Human, Runtime, and Agent authority separation.
- Standing authorization for necessary local reversible work.
- Actual worktree and check fact collection.
- Task-scoped runs and evidence integrity.
- Repository evidence currency being distinct from semantic truth.
- Explicit basis attribution and human adoption remaining separate from
  evidence readiness.

### Reshape

- Host-declared task provenance into authority-bound events.
- Prepare output from broad prescriptive guidance toward the smallest useful
  semantic envelope and exact activated human decisions.
- Completion output from blanket guidance attestation toward semantic delta,
  residual unknowns, and a risk-directed review map.
- `ready-for-adoption` presentation so it cannot read as a semantic green
  light or human acceptance.
- Repository observations into either transient revalidated evidence or
  durable human-owned semantic decisions.
- Persistent personal preference from generated guidance into explicit
  confirmed preference or an identifiable Agent hypothesis.

### Demote or remove unless separately justified

- Generic built-in guidance that a capable Host already recovers from the task
  and repository.
- Broad RCCL observation storage without a decision-changing consumer.
- Durable per-task semantic relation proposal lifecycles.
- Mandatory causal challenges for every delivered item regardless of risk.
- Attestation volume as a proxy for assurance.
- Any overall semantic readiness claim inferred from Host prose.
- Generated memory, aggregate feedback, or trust scores without a concrete
  decision-changing consumer.

## Migration sequence

The sequence below records current intent, not an irreversible implementation
commitment. A phase may be split when that produces a smaller observable slice.

### Phase 0 — Record and activate the accepted direction

**Outcome:** Future architecture work can distinguish the current contract,
accepted target direction, and active migration sequence.

**Work:**

- Add the accepted target-direction document.
- Add this separate migration plan.
- Route relevant Agent work to both documents from `AGENTS.md`.
- Mark the trustworthy MVP contract as current-state behavior during migration.

**Exit evidence:** The documents are mutually linked, contain no claim that
target behavior is already implemented, and repository instructions require
explicit treatment of conflicts.

### Phase 1 — Authority-bound semantic input

**User-visible outcome:** The handoff can prove which material meanings were
stated or confirmed by a human and which were interpreted by the Agent.

**Candidate work:**

- Bind human statements and confirmations to actual interaction events rather
  than accepting a Host-authored source enum as sufficient authority.
- Represent Agent interpretation separately from the authoritative source.
- Keep the semantic envelope minimal and allow ordinary tasks to compile
  without a generated design artifact.
- Preserve exact scope and supersession semantics for confirmed decisions.

**Exit evidence:** A Host cannot label an invented value as human-owned; a
routine task still proceeds without additional user ceremony; authority
provenance is visible in the decision surface.

### Phase 2 — Actual-change semantic delta

**User-visible outcome:** Completion explains how the implemented change alters
the developer's system model rather than reporting only files, checks, and
guidance verdicts.

**Candidate work:**

- Define the smallest Host semantic-delta input that can reference actual
  changed files, checks, repository evidence, human decisions, and concrete
  semantic explanations.
- Report material behavior, invariants, ownership, data/control flow,
  compatibility, migration, failure/recovery, operations, and non-changes only
  when applicable.
- Attribute every conclusion to Runtime fact, repository evidence, Agent
  judgment, human decision, or unverified.
- Preserve bidirectional trace from decision to code/evidence and from changed
  code to reason/authority.

**Exit evidence:** The delta cannot be completed before actual diff collection;
unsupported claims remain identifiable; a developer can inspect the exact
evidence behind each material statement.

### Phase 3 — Residual unknowns and risk-directed review map

**User-visible outcome:** The developer sees where attention is valuable and
what the current evidence cannot establish.

**Candidate work:**

- Replace blanket per-guidance challenge ceremony with risk-directed
  falsification of adoption-critical claims.
- Identify material semantic-change locations, judgment-heavy regions,
  verification changes, and weakly checked failure mechanisms.
- Separate must-read, useful-to-sample, mechanically covered, and unresolved
  review surfaces.
- Expose verifier mutation and distinguish Agent-authored tests from stronger
  independent acceptance evidence.

**Exit evidence:** Optional low-risk claims do not create review noise;
material contradictions and unknowns cannot be hidden by a positive overall
status; every review recommendation explains its consequence.

### Phase 4 — Human adoption and correction events

**User-visible outcome:** Evidence readiness, human understanding, and actual
adoption are no longer conflated.

**Candidate work:**

- Record explicit adopted, corrected, rejected, reverted, and incident-linked
  outcomes with actor and scope.
- Let a human correct the canonical semantic interpretation without rewriting
  Runtime facts.
- Use adoption and correction as the only source for durable semantic learning.
- Keep ordinary task runs task-scoped and avoid a generic feedback ledger.

**Exit evidence:** Runtime and Agent terminal states cannot claim human
acceptance; a later task can distinguish a previously proposed interpretation
from one the developer actually adopted.

### Phase 5 — Late-bound semantic forks

**User-visible outcome:** The Agent investigates and proceeds autonomously
unless multiple viable solutions still differ on a human-owned long-lived
value.

**Candidate work:**

- Admit a narrow Host proposal containing exact facts, options, consequences,
  recommendation, and unknowns.
- Validate authority and evidence references without asking Runtime to
  adjudicate semantic quality.
- Ask one consolidated decision question at the latest safe point.
- Detect semantic drift during implementation and route only material drift
  back through the same decision boundary.

**Exit evidence:** Repository-recoverable facts and local reversible choices do
not interrupt the user; a material compatibility, ownership, migration, or
other long-lived tradeoff cannot be silently selected by the Agent.

### Phase 6 — Decision continuity and activation receipts

**User-visible outcome:** Confirmed repository-specific decisions reduce later
repetition while remaining exact, inspectable, scoped, and revocable.

**Candidate work:**

- Persist only decisions with a concrete future activation consumer.
- Store fork, alternatives, selected meaning, rationale, evidence, actor,
  scope, supersession, and adoption outcome.
- Revalidate supporting repository evidence where applicable.
- Show exactly which decisions were delivered to the Host and how they changed
  execution or review.
- Keep repeated preference patterns as Agent hypotheses until confirmed.

**Exit evidence:** A related later task receives an exact activation receipt
for a previously resolved semantic question; conflict or staleness narrows
activation rather than silently applying it.

### Phase 7 — Delegation frontier

**User-visible outcome:** The developer can delegate more categories of
implementation with fewer low-value interruptions while preserving
understanding, correction ability, and adoption authority.

**Candidate work:**

- Derive an inspectable frontier from scoped decisions, reversibility,
  verification, adoption, correction, reversion, and incident outcomes.
- Never collapse the frontier into a scalar trust score.
- Present why a decision class is autonomous, attention-worthy, or outside the
  current delegation envelope.
- Narrow the frontier automatically when its supporting evidence becomes
  stale or adverse outcomes appear; widening still respects human semantic
  authority.

**Exit evidence:** Every widened or narrowed delegation boundary has an
inspectable basis, adverse outcomes narrow it, and no frontier state transfers
semantic authority away from the human.

## Upgrade decision template

Every architecture increment should report:

1. **Accepted capability advanced** — the exact target section it serves.
2. **Observable behavior** — what a developer experiences differently.
3. **Authority and evidence** — what independent source it adds beyond Host
   inference.
4. **Independent value** — why the Host cannot self-authoritatively recreate
   the same decision input.
5. **Complexity movement** — lifecycle and persistent concepts added, removed,
   or narrowed.
6. **Removal condition** — when the mechanism would no longer belong in the
   hard kernel.

An increment that cannot answer these questions should remain an exploration,
not enter the hard kernel.

## Open implementation questions

The accepted direction does not yet decide:

- exact public API and CLI names for semantic delta, adoption, and forks;
- whether authority events are embedded in task runs or referenced through a
  separate narrowly scoped store;
- the minimum semantic-delta schema that remains useful across task types;
- how Host adapters bind human interaction events across different platforms;
- when independent verification is required and how project defaults express
  it;
- how team authority roles integrate with repository ownership systems;
- how to update developer understanding without turning every task into a
  comprehensive design artifact;
- the exact point at which current Playbook, RCCL, relation, and attestation
  surfaces are removed from the public workflow.

These are implementation or product decisions to resolve with repository
investigation, vertical slices, and evidence. They are not silently settled by
this plan.
