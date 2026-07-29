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

The intended outcome is broader safe delegation without surrendering human
understanding or control. Humans remain the semantic authority, Runtime is the
authority for collected machine facts, and the Host Agent's interpretation and
attestations remain explicitly labeled judgment.

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
Task-field provenance records each value as human-stated, human-confirmed,
agent-inferred, repository-derived, or mechanically deterministic, without
decorative confidence decimals. Agent inference is not itself a reason to
interrupt; an explicitly unresolved material decision is.

## Guidance budget

There are no per-section item limits.

The agent-facing execution view has one UTF-8 byte ceiling. It contains IDs,
compact implementation instructions, prohibitions, execution modes, applicable
exceptions, selected execution examples, and tensions. Verification plans,
source details, full rationale/examples, evidence, and activation history remain
available in the full decision and Decision Trace without consuming the
agent-facing attention budget.

Runtime must never silently remove:

- required guidance;
- prohibited guidance;
- unresolved tensions.

If the mandatory packet exceeds the byte ceiling, compilation returns an
actionable overflow result. If optional guidance causes overflow, the host may
submit an explicit selection. The selection and its rationale become part of
the Decision Trace and Decision ID. Runtime reports agent-facing delivery bytes,
full structured-guidance bytes, and full decision-packet bytes separately.

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

Completion keeps three authorities distinct.

Machine facts are collected by the workflow:

- task-baseline-to-current changed files and operations;
- patch or patch digest where available;
- configured check command, exit code, and output digest.

A selected command that cannot start or finish is an `unavailable` machine
fact and yields `needs-attention`; a completed non-zero command is `failed` and
rejects evaluation. This distinction comes from process facts, not task text or
a risk heuristic.

Host attestations cover semantic judgments:

- repository fit;
- behavior and compatibility preservation;
- clarity, proportionality, and policy satisfaction.

Approved exceptions record a human decision about an exact guidance ID and
reason. They do not turn the underlying rule into a machine-proven success.

Before prepare, the Host resolves repository-discoverable details and performs
a transient semantic alignment only for material choices about the goal,
public behavior, compatibility, architectural ownership, irreversible
migration strategy, or another long-lived tradeoff. Confirmed decisions are
encoded in existing task inputs with their provenance; there is no separate
persisted design brief. A concrete task authorizes local, reversible
inspection, implementation, checks, and repair inside that contract without
per-action permission prompts.

`compileChange` returns an attention-only attestation plan for delivered
required, avoid, and tension guidance, including the exact evidence field
shapes. Passing command requirements come from workflow facts; the Host does
not declare check outcomes. Optional `consider` guidance may be attested when
material, but an unverified optional item is recorded as information rather
than unresolved acceptance work.

Runtime validates that attestations reference collected facts. It does not call
host prose independently verified. Every guidance result identifies its basis
as `runtime-fact`, `agent-attested`, `human-approved`, or `unverified`.
Machine facts that are absent or merely host-declared cannot support a
`ready-for-adoption` result.

Immediately before attestation, the Host inspects the complete actual diff and
seeks counterevidence for every attention item. A `satisfied` verdict is invalid
workflow behavior when any changed file contradicts the claim or the available
evidence is insufficient. Runtime does not reproduce this semantic review with
token matching or another heuristic policy engine.

Task targets focus activation and review; they are not file permissions.
Necessary adjacent implementation, test, type, and documentation changes are
valid when they preserve the aligned semantic contract. Completion separately
shows files inside and outside declared targets; an outside-target file
requires explanation, not automatic rejection.

`ready-for-adoption` means the selected facts and evidence are ready for human
review. Runtime and the Agent do not accept the change on the developer's
behalf.

## Activation assurance

The Host explicitly supplies change type, risk, scope, and at least one target
after semantic alignment. Runtime validates these fields but does not infer
them from task keywords, path counts, or filenames.

Task targets are normalized repository-relative scope roots. Directive
activation uses deterministic scope overlap, so a directory target activates
applicable glob and exact descendant scopes without requiring the Host to guess
the final changed files. Technology IDs are canonicalized by casing and may be
derived mechanically from an exact file extension; no dependency,
filename-ranking, or token-overlap heuristic activates policy.

Decision Trace records normalized targets and technology provenance, active
built-in/team/personal contributors, and team/personal directives that were
inactive because their scopes did not overlap.

Selected verification is explicit rather than inferred. Each team-default or
Host-task definition supplies an ID and rationale to Runtime, which merges it
with delivered-guidance requirements. The CLI executes every definition in the
selected configuration. A missing policy-required definition returns
`verification-required`; no configured-but-unused state or filename heuristic
decides execution.

## Runtime persistence

Runtime state is task-scoped, not a repository-global history database.

- Alignment, guidance-overflow, and verification-required outcomes write
  nothing.
- A runnable prepare creates one `.resonant-code/runs/<runId>/` directory with
  the decision, worktree baseline, and an empty Host evaluation input.
- Completion stores check logs and the resulting evaluation in that same run.
  It does not duplicate the full current worktree snapshot. Each persisted
  check stream is capped at 1 MiB; the output digest still covers the complete
  stream and the result records whether either log was truncated. An empty
  stream creates neither a placeholder log nor an output reference.
- Prepared runs are never removed automatically. Retention cleanup applies
  only to whole completed-run directories, so logs cannot become orphaned.
- The initial release does not persist cross-task feedback events, aggregates,
  or policy proposals. Such a store must first demonstrate a concrete compile
  or evaluation consumer and measurable benefit over inspecting task runs.

## Release evidence

The release gate includes:

- deterministic identity tests;
- authority, overlay, overflow, and no-silent-omission tests;
- directory/exact scope overlap, canonical technology, and activation-trace
  tests;
- RCCL evidence-contract and approval tests;
- dirty-worktree and machine-fact completion tests;
- verification-required no-write and task-run isolation tests;
- attention-only attestation and optional-information tests;
- isolated built-package smoke behavior;
- a paired agent-evaluation protocol and machine-validated result ledger.

The technical MVP may ship with the ledger explicitly marked `not-run` and the
effectiveness claim marked `unverified`. Any claim that the harness measurably
improves adoption, scope, or correction cost requires completed paired results;
the release gate rejects such a claim when the ledger is incomplete.
