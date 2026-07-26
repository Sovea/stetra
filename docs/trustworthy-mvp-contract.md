# Trustworthy MVP Governance Contract

This document fixes the product decisions for the trustworthy MVP. Runtime and
RCCL behavior must be testable against these contracts; implementations must not
replace them with relevance scores, layer weights, token-overlap decisions, or
other structural guesses about semantic importance.

## Product outcome

The harness exists to help a demanding developer obtain changes that are more
likely to be adopted without correction:

- the implementation follows explicit team and personal taste;
- the change surface remains proportionate to the task;
- repository boundaries are considered without being mistaken for policy;
- the final report distinguishes machine-collected facts from host semantic
  attestations.

Product effectiveness is evaluated against the same coding agent working from
repository instructions alone. The paired evaluation records blind preference,
correction rounds, out-of-scope files, unnecessary abstraction, task duration,
and harness overhead.

## Authority and applicability

Long-lived guidance has two project-facing layers:

1. A repository-committed team Playbook is the shared baseline.
2. A user-scoped personal overlay may add preferences and examples but may not
   silently weaken a team obligation or prohibition.

Personal additions are `should`-level preferences, conventions, or architecture
guidance with `personal-` IDs. Personal overlays cannot extend built-in layers,
override, suppress, weight-rank, create hard constraints/anti-patterns, or
revive team-suppressed guidance. Base and overlay contributors remain visible
in Decision Trace.

Explicit task constraints apply to the current task. Built-in Playbook guidance
is the fallback baseline. Team changes to built-ins require explicit
`supersedes` or `suppresses` references. Structurally conflicting personal
operations are rejected; semantic contradictions remain jointly inspectable as
team and personal guidance and require host judgment. Numeric ranking never
decides them.

Scope matching and declared task/language layers determine structural
eligibility. Runtime delivers every eligible obligation and prohibition.
Optional semantic selection is a bounded host proposal containing active IDs
and a rationale; Runtime validates it but does not invent it.

Host relation proposals contain an explicit relation, rationale, and exact
evidence references. Numeric self-confidence is not accepted: an arbitrary
score neither proves the relation nor adds an independent assurance source.
Task-field provenance records whether a value was explicit, host-provided,
deterministic, or defaulted without decorative confidence decimals.

## Guidance budget

There are no per-section item limits.

The execution packet has one UTF-8 byte ceiling. It contains compact
implementation instructions and verification requirements. Full rationale,
source details, examples, evidence, and activation history remain available in
the Decision Trace.

Runtime must never silently remove:

- required guidance;
- prohibited guidance;
- unresolved tensions.

If the mandatory packet exceeds the byte ceiling, compilation returns an
actionable overflow result. If optional guidance causes overflow, the host may
submit an explicit selection. The selection and its rationale become part of
the Decision Trace and Decision ID.

## Repository observations

RCCL is observational, never prescriptive by itself.

- Generated, low/medium-confidence, partial, stale, or broken observations are
  ambient at most.
- A proposal cannot mark itself reviewed.
- Review is a separate user action bound to the observation content
  fingerprint.
- Evidence must come from the exact prepare contract that the proposal names.
- Token or snippet similarity proves evidence currency only.
- An RCCL anti-pattern does not become a hard prohibition. Durable
  prohibitions belong in the Playbook.

Only current, high-confidence, reviewed observations connected by an accepted
host semantic relation may change directive execution.

## Decision identity

Decision identity is content-derived and environment-independent.

- Timestamps, absolute installation paths, and Git locations do not affect the
  Decision ID.
- Every semantic field that changes delivered guidance, verification, an
  accepted relation, or an explicit delivery selection does affect the ID.
- Identical semantic input produces the same ID across repeated compilation and
  installation directories.

## Completion assurance

Completion has two explicit assurance sources.

Machine facts are collected by the workflow:

- task-baseline-to-current changed files and operations;
- patch or patch digest where available;
- configured check command, exit code, and output digest.

Host attestations cover semantic judgments:

- repository fit;
- behavior and compatibility preservation;
- clarity, proportionality, and policy satisfaction.

Runtime validates that attestations reference collected facts. It does not call
host prose independently verified. A result cannot be accepted when machine
facts are absent or merely host-declared.

## Feedback

Feedback records only evidence-backed satisfied, violated, and approved
exception outcomes. Runtime maintains bounded aggregates by guidance ID.
Aggregates contain counts, evidence kinds, timestamps, and content
fingerprints, not host explanations. They report facts and never apply a
promotion, retirement, or exception threshold.

Feedback never mutates team or personal policy automatically. It can support an
inspectable change proposal, which is written only after explicit user approval
bound to the current aggregate fingerprint. A written proposal remains marked
unapplied; changing a Playbook source is a separate review and edit.

## Release evidence

The release gate includes:

- deterministic identity tests;
- authority, overlay, overflow, and no-silent-omission tests;
- RCCL evidence-contract and approval tests;
- dirty-worktree and machine-fact completion tests;
- feedback idempotency and aggregation tests;
- isolated built-package smoke behavior;
- a paired agent-evaluation protocol and machine-validated result ledger.

The technical MVP may ship with the ledger explicitly marked `not-run` and the
effectiveness claim marked `unverified`. Any claim that the harness measurably
improves adoption, scope, or correction cost requires completed paired results;
the release gate rejects such a claim when the ledger is incomplete.
