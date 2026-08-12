# AGENTS.md

## What this repository builds

Stetra is the cognition and adoption control layer for delegated production
coding. It closes one task-scoped loop from an exact developer request, through
Agent implementation and Runtime facts, to an exact developer adoption
decision without weakening developer understanding or decision authority.

It is not a coding agent, project manager, prompt library, repository memory,
worktree fleet, general workflow engine, or automated approver.

Read `docs/architecture.md` before changing product boundaries, lifecycle,
authority, persistence, public APIs, or Host interaction. Read
`docs/change-workflow.md` before changing CLI protocol or task behavior.
Describe current implementation separately from future architecture and from
measured product evidence.

## Product kernel

The initial version of protocol `cognitive-adoption`, schema `1`, has one fixed
task lifecycle:

```text
prepare -> implement -> collect -> diagnose non-passing evidence
        -> optional repair or challenge -> handoff -> decide
```

`change explain` is on-demand inspection. Timeout retry is a same-Attempt
operational recovery. It is not diagnosis or repair.

The first-class objects are the exact developer event, Semantic Contract,
Adoption Conditions, minimal Delivery Plan, baseline verification, immutable
Attempts and Runtime facts, Agent evidence disposition, independent Challenge,
Cognitive Handoff, consolidated Attention, and exact Human Decision.

Do not add a general task graph, parallel writer scheduler, cross-task memory,
preference learning, automatic policy activation, provider SDK, cloud service,
or another lifecycle without a concrete consumer and measured advantage over
the task-scoped loop.

## Responsibility and authority

- Developers own exact requests and corrections, desired outcomes,
  constraints, non-goals, long-lived choices, exceptions, and adoption.
- Coding Agents own interpretation, investigation, implementation, evidence
  diagnosis, repair, challenge conclusions, recommendation, and handoff.
- Runtime owns identity, ordering, baselines, frozen checks, actual changes,
  ordered attempts and budgets, environment observations, fact currency, and
  deterministic transition validation.

Storage does not change authority. Agent prose cannot become a machine fact or
developer decision through a label. Passing checks support but do not decide
semantic truth or adoption. A developer exception cannot erase a contradictory
fact.

The exact request lives only in `developerEvent`. Host directions and Agent
interpretation stay physically separate. Structured meanings and conditions
remain Agent interpretations with exact event or evidence bases. Runtime
validates identity and references, not semantic faithfulness.

A concrete task authorizes necessary local reversible inspection, edits,
checks, documentation, and safe repair within compiled task meaning. Ask only
when material intent remains ambiguous, task meaning must change, an exact
exception or verification relaxation is needed, or an external or irreversible
effect is proposed.

## Prepare

The Host supplies compact task meaning, zero or more basis-bearing Adoption
Conditions, a bounded repair count, and explicit checks or a concrete
no-command rationale. Runtime generates canonical event, evidence, condition,
check, plan, and contract identities.

Routine work may have no conditions. Each material condition states what must
be true, why it changes adoption, its material or adoption-critical consequence,
and exact check/challenge/Human-review relationships.

The Delivery Plan persists only a fixed lifecycle and repair budget. Do not add
plan questions, reads, writes, expected outputs, generic consumers, or failure
prose without a concrete enforced consumer.

Only successful compile creates a task. Prepare captures the complete dirty and
non-ignored untracked worktree, executes only checks explicitly marked
`task-start`, records their side effects, freezes the post-check worktree as the
implementation baseline, and creates Attempt 1. `unknown` baselines do not run.
Transient input files inside the worktree are rejected.

## Collect and evidence judgment

Collect obtains a short task lock, verifies expected revision, executes every
frozen argv command without a shell, and appends immutable facts to the current
Attempt.

Preserve file operations, kinds, modes, digests, patch content, binary markers,
exact attempts, full-stream digests, bounded logs, baseline/current mechanical
relations, verifier-surface mutations, environment observations, check-induced
changes, and fact currency.

A timeout budget is operational. Only a latest timed-out check may retry with a
larger budget on an unchanged worktree. Completed failure and non-timeout
unavailability remain distinct.

Every current non-passing check requires one Agent-authored evidence
disposition: `implementation`, `environment`, `verification`, or `unknown`,
with diagnosis and falsification attempt. Runtime validates current coverage
and explicit contract relationships. It must not infer cause or consequence
from error strings, keywords, filenames, path counts, diff size, dependencies,
or a scalar score.

Only explicit implementation cause with no semantic drift and remaining budget
creates a successor Attempt. Environment, verifier, unknown, material semantic,
and exhausted routes preserve the diagnosis and go to challenge, handoff, or
Human decision as defined in `docs/architecture.md`. Exhaustion does not block
handoff.

## Challenge, handoff, and decide

Challenge is required by an explicit condition policy or when an
adoption-critical condition consumes a check whose declared acceptance surface
changed in the collected patch. Include every material condition sharing that
exact changed check. Do not use repository heuristics for this trigger.

Challenge output remains Agent judgment and records named sources, failure
hypothesis, falsification attempt, counterevidence, result, and context
identity. Partial, contradicted, unknown, missing, or unverifiably independent
challenge remains visible and cannot support a conclusion marked supported.

The Host writes handoff only after inspecting complete current facts. It
supplies a decision summary, one conclusion per condition, important system
effects, residual unknowns, consequence-directed review questions, and Agent
recommendation. Critical conclusions require a concrete failure hypothesis and
falsification attempt.

Runtime facts remain a separate packet partition. Attention is consolidated by
verification, change integrity, condition, and delivery, with exact codes and
references. A post-collection edit returns `facts-stale` before semantic
evaluation.

The decision packet is presented in three layers: decision summary, condition
details, then raw fact drill-down. `handoff-ready` means ready for Human
decision, never adopted. `needs-attention` can be accepted only with exact
Human exceptions for every current Attention item.

Decision actions are `accepted`, `correction-requested`, `rejected`, and
`deferred`. Preserve exact developer text and bind the decision to the exact
Attempt, collection, and handoff. Acceptance performs no commit, merge,
publication, deployment, or cross-task activation.

## State and persistence

```text
Delivery: waiting-for-implementation | implementing | repairing
          implementation-complete | exhausted
Evidence: not-collected | awaiting-evidence-judgment | incomplete
          needs-attention | facts-stale | handoff-ready
Decision: pending | correction-requested | accepted | rejected | deferred
```

Task state lives only under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only source; `task.json` is a derived revisioned projection. Baseline
verification and evidence dispositions are immutable decision-changing
artifacts. Each mutation uses an expected revision and short expiring lock.

As the initial persisted schema, it has no translator, alias, dual read, dual
write, or migration path. Do not add one unless explicitly requested.

## Package and API boundary

```text
Generated Host adapter -> CLI -> Core
```

The workspace has two publishable packages:

- `packages/core/` -> `@sovea/stetra-core`
- `packages/cli/` -> `@sovea/stetra`

Core owns deterministic authority, contract, identity, fact binding, challenge
obligations, handoff, Attention, and decision policy. Its root exposes exactly
two runtime values: `compileDelegation` and `evaluateHandoff`.

CLI owns commands, boundary validation, task sequencing and storage, Git/check
collection, evidence-diagnosis routing, locks, adapters, packet assembly, and
terse presentation. Core does not run Git or commands, format CLI output, know
Host files, or call an LLM. CLI and adapters do not decide semantic truth or
invent facts.

Do not create another package without an independent consumer, public API,
version, and release need. Core and CLI versions move together.

## Engineering rules

- Use TypeScript for Core and CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Use `rg` for search and `apply_patch` for source edits.
- Preserve unrelated user changes.
- Use safe repository-relative paths and argv execution without a shell.
- Keep facts, status, authority, references, and packets deterministic and
  diffable. Timestamps belong only in lifecycle records.
- Do not rank repository files or infer meaning, importance, risk, assurance,
  cause, or consequence from token overlap, keywords, filenames, path counts,
  diff size, dependencies, or scalar scores.
- Do not call an LLM from Core or CLI. Never persist raw secrets.
- Keep `dist/` generated, ignored, deterministic, and out of source review.
- Keep exact schemas in TypeScript and generated examples rather than prose.
- Do not add scalar trust, readiness, confidence, cognition, or productivity
  scores.

Every persistent field must answer which compile, collection, diagnosis,
repair, challenge, handoff, review, or adoption decision it changes. Remove it
when it has no concrete inspectable consumer.

## Verification and evidence

Run the technical gate before handoff:

```sh
corepack pnpm verify
```

CI also runs:

```sh
corepack pnpm audit --audit-level high
```

Tests cover observable success, failure, task-start baseline, timeout recovery,
diagnosis routes, repair lineage and exhaustion, fact-triggered challenge,
stale facts, Attention exceptions, packages, and Host adapters.

Passing deterministic tests establishes consistency and distributability, not
product effectiveness. Claims about lower adoption cost or preserved developer
cognition require paired results under `evaluation/paired-agent/PROTOCOL.md`
and an explicit scoped product-owner conclusion. The August 2026 pilot is
inconclusive and effectiveness remains `unverified`.
