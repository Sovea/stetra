# AGENTS.md

## What this repository builds

Stetra is a cognition-preserving adaptive delegation harness for production
coding. It connects exact developer intent, Agent delivery, Runtime-collected
facts, a decision-oriented Cognitive Handoff, and the Human adoption decision
without weakening developer understanding or engineering judgment.

It is not a coding agent, automated approver, generic project manager, prompt
library, repository wiki, transcript store, broad memory system, worktree fleet,
or universal workflow engine.

Read `docs/architecture.md` before changing product positioning, lifecycle,
authority, persistence, public APIs, Host interaction, or long-term boundaries.
That document contains both implemented and planned architecture; planned
capabilities are not implementation authorization. Read
`docs/change-workflow.md` before changing the current CLI protocol or task
behavior. Always distinguish current implementation, target architecture, and
measured product evidence.

## Product architecture

The target design is two planes, three logical graphs, and one append-only
ledger:

- **Adaptive Delivery Plane** — Agent-owned investigation, delivery strategy,
  bounded loops, and eventually justified conditional or parallel execution.
- **Deterministic Assurance and Decision Plane** — authority, contracts, facts,
  evidence ceilings, handoff, and Human decision boundaries.
- **Delivery Graph** — task-local Agent strategy; planned beyond the current
  fixed lifecycle.
- **Evidence Graph** — task- and Attempt-scoped provenance from Human Event to
  evidence, conclusion, and review surface; its core relationships exist now.
- **Decision Graph** — longitudinal Human-authorized decisions and outcomes;
  not implemented.
- **Append-only ledger** — immutable task artifacts and rebuildable projections;
  implemented only at current-task scope.

The three task cores are:

1. **Semantic Contract** — what one change is intended and authorized to mean.
2. **Fact Spine** — what the workflow actually observed.
3. **Cognitive Handoff** — what the change means, what remains unknown, and
   where direct review has adoption value.

Decision Continuity is the planned longitudinal loop. Do not add cross-task
memory, Decision Records, preference learning, delegation frontiers, outcome
activation, or team policy until task-level value is demonstrated and an exact
Human-authorized consumer exists.

Dynamic Host Projection is a transient instruction layer over the stable
kernel. It may reduce reading and authoring cost through exact commands,
task-specific drafts, references, and field requirements. It must not persist a
mode, add lifecycle state, select semantic values, hide adoption-changing
information, or become authority.

## Product success and complexity gates

The product succeeds only when implementation outcome is non-inferior or
better, Human adoption cost is lower, developer cognition is non-inferior,
Human authority is preserved, and evidence provenance remains inspectable.
Technical consistency is not product effectiveness.

Every persistent field, event, graph edge, lifecycle state, or node type must
answer:

1. Which alignment, execution, recovery, assurance, review, adoption, or future
   activation decision can it change?
2. Can the developer inspect that decision and distinguish its authority and
   evidence?
3. Can its value be measured against a simpler baseline?

Remove or defer it when those questions have no concrete answer. Do not add a
general DAG, graph database, provider SDK, cloud service, scalar trust or risk
score, broad repository memory, another package, or compatibility layer merely
because the target architecture names a possible future consumer.

## Responsibility and authority

- Developers own exact requests and corrections, desired outcomes, constraints,
  non-goals, long-lived choices, exceptions, and adoption.
- Coding Agents own interpretation, repository investigation, recommendation,
  reversible engineering judgment, delivery strategy, implementation,
  diagnosis, falsification, repair, challenge conclusions, and handoff.
- Runtime owns identity, references, ordering, baselines, immutable
  Verification Definitions, actual changes, ordered Check Attempts and budgets,
  bounded logs, timing, environment observations, fact currency, and
  deterministic structural policy.
- Trusted Host integrations own only tool configuration, isolation, context
  identity, and external-effect controls they actually enforce.

Storage and labels cannot change authority. A Human exception cannot erase a
contradictory fact. A fact cannot decide product meaning. Agent prose cannot
become Human authority or Runtime fact through a field name.

Exact developer messages and decisions use Human Events. Structured task
meaning, Conditions, engineering cause, and recommendations remain Agent
interpretations with exact event or repository-evidence bases. Runtime validates
identity and references, not semantic faithfulness.

A concrete task authorizes necessary local, reversible inspection, edits,
checks, documentation, and safe repair inside compiled task meaning. Ask when a
material Human-owned choice remains, task meaning must change, an exact
exception or verification relaxation is required, or an external or
irreversible effect is proposed.

## Current task lifecycle

The implemented `cognitive-adoption` schema `1` uses:

```text
prepare -> Agent implementation -> collect
        -> diagnose non-passing evidence
        -> bounded repair / verification revision / Challenge or direct review
        -> exact Human resolution when needed
        -> Cognitive Handoff -> exact Human Decision
```

`change explain` is on-demand inspection. A timeout retry is same-Attempt
operational recovery, not diagnosis or implementation repair. Every
state-changing Host route must have an executable successor; do not introduce a
prose-only recovery dead end.

The current Delivery Plan persists only the fixed lifecycle and repair budget.
Do not add plan questions, arbitrary nodes, reads, writes, expected outputs,
generic consumers, or failure prose without an implemented consumer and
evidence that the extra structure improves a real task.

## Prepare and Semantic Contract

Prepare accepts one explicit `prepareRequestId`, one exact developer event,
separate Agent-authored task meaning, optional exact repository-evidence
windows, zero or more Conditions, Host policy requirements, a bounded repair
count, and explicit checks or a concrete no-command rationale.

Routine work may have no Condition. Every declared Condition has a material or
adoption-critical consequence, adoption rationale, exact basis, and at least
one Falsifiable Evidence Obligation. Every Obligation states a bounded
sub-conclusion, a plausible failure hypothesis, and exact Runtime-check,
repository-inspection, independent-Challenge, or direct-Human-review strategy.
Adoption-critical Conditions require independent Challenge or direct Human
review.

Runtime generates canonical Human Event, Condition, Obligation, Verifier,
Definition, Contract, Verification Plan, and effective identities. Focus paths
guide investigation and review; they are not permissions or predictions of
final changed files.

Prepare runs only explicitly selected task-start checks whose comparison changes
an exact Obligation. It captures their side effects and freezes the post-check
worktree as the implementation baseline. Unknown baselines do not run.
Transient input files inside the worktree are rejected.

Prepare identity is explicit, not heuristic. Replaying one request ID with
identical input returns the existing task without rerunning baseline work.
Different input under the same ID is rejected; a distinct ID creates a distinct
task. Do not deduplicate by semantic similarity.

## Collect and Fact Spine

Collect executes every current immutable argv Definition without a shell and
records the complete baseline-to-current change.

Preserve file operations, kinds, modes, digests, representable patch content,
binary markers, pre-check and post-check worktrees, check-induced changes,
exact Check Attempts, structured termination, timeout budgets, full-stream
digests, bounded logs, Definition and verifier-surface mutations, bounded
environment observations, mechanical baseline/current relations, and fact
currency.

A passing command is a machine fact about one exact Definition, not semantic
truth or adoption. Completed failure, non-timeout unavailability, timeout,
signal termination, and spawn failure remain distinct. Direct Host execution
cannot replace a frozen Runtime Attempt.

A timeout retry may append only after the latest Attempt timed out, with an
unchanged worktree and a larger budget. It preserves all earlier Attempts.

Prepare and Collect hold a project-worktree lease only while observing or
executing against the shared worktree. The lease is recovered only after the
owner process is confirmed dead through process identity; elapsed time alone
never authorizes eviction. Artifacts are staged before a short revision-checked
task commit. No external check runs while the task commit lock is held.

## Evidence judgment, repair, and Verification Revision

Every current non-passing Definition requires one Agent-authored Evidence
Disposition with exact Definition identity, `implementation`, `environment`,
`verification`, or `unknown` cause, diagnosis, falsification attempt, expected
different observation, and explicit proposed route.

Runtime validates identity, coverage, budgets, and route compatibility. It must
not infer cause, semantic importance, consequence, or assurance from output
text, keywords, filenames, token overlap, path count, diff size, dependency
count, or scalar scores.

Only explicit bounded implementation cause within the current meaning and
remaining repair budget authorizes a repair successor Attempt. Environment and
verification causes may revise verification or hand off. Unknown cause may
Challenge, hand off, or ask the developer. Material semantic impact requires
exact Human resolution. Mixed failures may repair the explicit implementation
cause while other entries remain visible and are recollected.

Verification Revision preserves the Semantic Contract while producing a new
Verification Plan and effective identity. Logical Verifier identity remains
stable; exact executable Definitions receive content-bound identities and
lineage. Removing or weakening verification requires exact Human authority.
Old Contracts, Definitions, Attempts, facts, and decisions are never
overwritten. If the original baseline cannot be honestly reconstructed, its
status remains unknown.

## Challenge and Host provenance

Challenge is required when an Obligation declares `required`, or when a
`fact-triggered` Obligation consumes a Verifier whose declared acceptance
surface changed. Criticality does not suppress this self-verification risk.

Challenge input uses exact Obligation and evidence references. Supporting and
counter evidence remain structured. Agent input cannot supply Challenge ID,
independence, implementer context, challenger context, or attestation identity.

A programmatic Host or Evaluator may attest a fresh independent context only
when it controls that boundary. Generated Markdown Adapters are thin skills and
cannot do so. Thin Hosts route the unresolved failure hypothesis into direct
Human review; a manually submitted thin-context Challenge remains unverified.
Missing, adverse, or unverified Challenge evidence caps related conclusions.

Host policy requirement, Host capability, and enforcement attestation remain
separate. Thin instructions are `instruction-only`; only a trusted provider may
record `enforced`. Required unenforced policy pauses for exact Human resolution.

## Cognitive Handoff and Human decision

The Host writes Handoff only after inspecting complete current facts. The Agent
supplies a system-meaning summary, exactly one conclusion per Evidence
Obligation and Condition, important effects, residual unknowns, consequence-
directed Review Questions, and a recommendation distinct from adoption.

Each Obligation conclusion includes exact evidence, counterevidence,
falsification attempt, and supported, partial, contradicted, or unknown status.
A Condition cannot be supported beyond its Obligation results. Runtime validates
coverage and ceilings, not natural-language truth.

Stale worktree facts stop evaluation before malformed Handoff content is
considered. Attention consolidates cause-specific evidence and integrity gaps.
Review Questions order direct inspection by adoption consequence. Do not create
one generic review item per changed file.

`handoff-ready` means ready for Human review, never adopted. Human decisions are
accepted, correction-requested, rejected, or deferred and remain bound to the
exact Attempt, Fact Bundle, and Handoff. Acceptance with Attention requires an
exact exception for every current item. Decide does not commit, merge, publish,
deploy, or activate cross-task policy.

Correction and material mid-task choices use exact Human Resolution. A
correction creates a lineage-linked successor Attempt while preserving the
prior Handoff, Decision, facts, and events. Abort remains an explicit decision
state.

## Dynamic Host Projection

Every input-bearing Host Action may provide a transient Authoring Packet with:

- current task, revision, Contract, Attempt, and facts bindings;
- exact Human Event beside separately labeled Agent interpretation;
- a directly fillable draft;
- stage-specific canonical references;
- structural field requirements and outstanding obligations;
- an exact one-shot stdin command binding.

CLI generates boilerplate identities. Projection is derived output: it is not
persisted, does not add a mode, cannot recommend a semantic choice, and cannot
hide an adoption-changing fact. Canonical detail remains available through
`change explain`.

## State and persistence

```text
Delivery: waiting-for-implementation | implementing | repairing
          implementation-complete | exhausted
Evidence: not-collected | awaiting-evidence-judgment | incomplete
          needs-attention | facts-stale | handoff-ready
Decision: pending | correction-requested | accepted | rejected | deferred
          aborted
```

Task state lives only under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only source and `task.json` is a rebuildable projection. One task owns
its Contracts, baselines, Verification Revisions, Attempts, Fact Bundles,
Evidence Dispositions, Challenges, Handoffs, Resolutions, Decisions, logs, and
patches. It is never authoritative for another task.

The initial persisted schema has no translator, alias, dual read/write, or
migration path. Do not add one unless explicitly requested.

## Package and API boundary

```text
Generated Host Adapter -> CLI -> Core
```

The workspace has two version-locked publishable packages:

- `packages/core/` -> `@sovea/stetra-core`
- `packages/cli/` -> `@sovea/stetra`

Core owns deterministic authority validation, Semantic Contract and
Verification Revision compilation, fact schemas and binding, evidence ceilings,
Handoff evaluation, Attention, and Human-decision binding. Its root exposes
exactly `compileDelegation` and `evaluateHandoff` as runtime values.

CLI owns commands, IO validation, task sequencing, Git and check collection,
persistence, Host-attestation injection, transient Authoring Projection,
project initialization, packet assembly, presentation, and generated workflows.
Core does not run Git or commands, format CLI output, know Host files, or call an
LLM. CLI and Adapters do not decide semantic truth or invent facts.

Do not create another package or public root operation without an independent
consumer, version, release boundary, and measured reason that the current two
operations are insufficient.

## Engineering rules

- Use TypeScript for Core and CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Use `rg` for search and `apply_patch` for source edits.
- Preserve unrelated user changes in dirty worktrees.
- Use safe repository-relative paths and argv process execution without a
  shell.
- Keep identity, facts, status, references, and packets deterministic and
  diffable. Timestamps belong only in lifecycle records.
- Never infer meaning, importance, cause, consequence, assurance, ownership, or
  risk from token overlap, keywords, filenames, path counts, diff size,
  dependencies, or scalar scores.
- Do not call an LLM from Core or CLI. Never persist raw secrets.
- Keep `dist/` generated, ignored, deterministic, and out of source review.
- Keep exact schemas in TypeScript and generated Adapter examples; do not
  duplicate full protocol schemas in prose.
- Do not add scalar trust, readiness, confidence, cognition, risk, or
  productivity scores.

## Verification and evidence

Run the technical gate before handoff:

```sh
corepack pnpm verify
```

CI also runs:

```sh
corepack pnpm audit --audit-level high
```

Tests cover observable success, failure and recovery paths, selective
baselines, exact check termination, diagnosis routes, mixed failures, repair and
correction lineage, Verification Revision, fact-triggered Challenge, thin-Host
direct review, Host policy resolution, stale facts, Attention exceptions,
packages, and generated Adapters.

Passing deterministic tests establishes consistency and distributability, not
product effectiveness. Claims about lower adoption cost or preserved developer
cognition require paired results under `evaluation/paired-agent/PROTOCOL.md`
and an explicit scoped product-owner conclusion. The retained historical pilot
is inconclusive and effectiveness remains `unverified`.
