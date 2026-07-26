# AGENTS.md

## Product boundary

`resonant-code` is an AI coding change harness. It exists to make task-specific engineering guidance stable, inspectable, evidence-aware, and reusable across host agents.

It is not a repository wiki, a general agent framework, or a collection of static prompt rules. Its differentiator is a small deterministic kernel around the part text-only workflows cannot reliably own: activating project policy, qualifying repository observations, budgeting delivered guidance, evaluating the actual change, and recording bounded feedback.

## Product thesis

The target is code a developer or team wants to adopt and keep, not merely plausible output. The primary failure modes are disproportionate changes, generic advice, poor repository fit, weak compatibility judgment, noisy review, and unverifiable claims that guidance was followed.

Use host-agent judgment for task understanding and semantic relations. Admit that judgment through narrow structured inputs. Do not create multi-stage artifacts merely because a typed contract can be defined.

Every persistent field or lifecycle stage must answer at least one of these questions:

1. Can it change a compile or evaluation decision?
2. Can a developer inspect the decision it changed?
3. Can its benefit be tested against a simpler baseline?

If not, remove it.

## Architecture

The execution loop has four parts:

1. Playbook — prescriptive built-in, repository-committed team, and
   user-scoped personal directives.
2. RCCL — observational repository context with separate evidence, semantic-confidence, and review signals.
3. Runtime — the deterministic `compileChange` / `evaluateChange` hard kernel.
4. Skills — thin host workflows for IO, lifecycle sequencing, and presentation.

Runtime source lives under `runtime/src/`; RCCL source lives under `rccl/src/`. Build output is ESM under each package's `dist/` directory.

### Public Runtime API

Runtime exposes exactly two value entrypoints:

- `compileChange(input)`
- `evaluateChange(input)`

Do not expose task helpers, parsers, merge functions, feedback helpers, or skill-specific workflow APIs from `runtime/src/index.ts`.

### Compile boundary

`compileChange` accepts a canonical task context, the team Playbook, an
optional personal overlay, and optional bounded directive/observation relation
proposals. It owns:

- deterministic task normalization and strict-mode interpretation gates
- Playbook loading, validation, local override, scope selection, and explicit
  authority ordering
- task-relevant RCCL evidence re-verification
- semantic relation validation and execution-mode adjudication
- compact EGO budgets and Decision Trace
- verification-plan generation

Standard tasks compile directly. Do not reintroduce mandatory task-model, semantic-graph, capability-profile, cache, or evolution-proposal round trips.

Guidance budgeting is hard product behavior:

- no per-section item limits
- one configurable UTF-8 byte ceiling, 6 KB by default
- required, avoid, and unresolved-tension guidance is never silently omitted
- optional omissions require an explicit host selection and rationale
- overflow returns an actionable result instead of truncating guidance

Only delivered guidance IDs may be evaluated later.

The team Playbook is the shared authority. A personal overlay may add only
`should`-level preferences, conventions, architecture guidance, and examples.
It may not extend layers, override, suppress, weight-rank, create constraints or
anti-patterns, or revive team-suppressed guidance. Runtime surfaces both base
and overlay contributors in Decision Trace.

### RCCL boundary

RCCL stores observations only when omitting one could cause a different and worse code or review decision. Each observation requires:

- stable ID, category, scope, and statement
- one or more affected decision dimensions
- explicit decision impact
- semantic confidence and review status
- non-empty exact source evidence
- RCCL-owned evidence verification and lifecycle state

Evidence verification checks safe repository-relative paths, file existence, line ranges, and snippet similarity. It proves evidence currency, not semantic truth or representativeness.

Calibration never ranks repository files or guesses meaningful syntax windows.
The host selects exact file/line windows, and proposals may reference only the
window IDs in that prepare contract. A proposal cannot mark itself reviewed.
Approval is a separate action with reviewer, timestamp, and content-fingerprint
provenance; changing observation content invalidates approval.

Only a task-relevant observation with current fully matched evidence, high semantic confidence, reviewed status, and an accepted host semantic relation may change directive execution. Partial, stale, broken, low-confidence, or unreviewed observations are ambient at most. Token overlap may not create a relation, conflict, enforcement, or delivery decision.

Relation proposals use explicit IDs, relation kind, rationale, and exact
evidence references. Do not accept numeric host self-confidence or use a
numeric threshold to adjudicate semantic relations. Task provenance records
source categories without decorative confidence scores.

### Evaluation and feedback boundary

`evaluateChange` evaluates workflow-collected changed-file/check facts, host
attestations, and approved exceptions. It infers file operation after
implementation; preflight does not guess it.

The normal workflow owns machine facts. `prepare` snapshots the Git worktree,
including pre-existing dirty and non-ignored untracked files. `complete` runs
the exact check definitions captured at prepare and compares the current
worktree to that baseline. Host artifacts may supply semantic attestations and
exceptions only; they may not supply changed files or check outcomes.

Attestation evidence must be structurally tied to collected facts:

- diff/file evidence names a supplied changed file
- check evidence names a supplied passing check
- semantic evidence contains a concrete explanation

Strict mode requires an exception for unverified required guidance or unresolved tensions. Hard required/avoid violations reject the evaluation.

Feedback is Runtime-owned and bounded. Record only evidence-backed satisfied,
violated, and approved-exception outcomes. Maintain fact-only aggregates by
guidance ID; never count unverified output as followed or persist raw host
explanations in aggregates. No count or rate may automatically mutate policy.
An inspectable change proposal requires explicit approval bound to the current
aggregate fingerprint and remains unapplied until a separate policy edit.

Do not infer product effectiveness from passing deterministic tests. A claim
that the harness reduces correction cost or improves adoption requires
completed paired-agent results under `evaluation/paired-agent/PROTOCOL.md`;
the machine-validated ledger may explicitly leave that claim unverified for the
technical MVP.

### Skill boundary

Skills may parse CLI flags, orchestrate prepare/complete steps, read and write artifacts, and present Runtime/RCCL results. Skills must not parse Playbook data to make policy decisions, rank directives, adjudicate relations, decide execution modes, or independently determine feedback eligibility.

The normal code lifecycle is:

1. `prepare` → compile compact task guidance
2. host implements the change
3. `complete` → collect actual change/check facts, evaluate attestations, and
   write bounded feedback

## Data separation

Keep these concepts distinct:

- Playbook says what should be done.
- RCCL says what repository reality appears to be.
- Host relation proposals say how a specific observation relates to an active directive.
- Runtime decides what is delivered and how it executes.
- Evaluation says what the actual change evidence supports.

Do not collapse them into one score, one prose prompt, or one “verified truth” flag.

## Engineering rules

- Use TypeScript for Runtime and RCCL core logic.
- Prefer narrow modules and explicit input/output types.
- Keep output deterministic enough to diff; timestamps may appear only in lifecycle or feedback records.
- Reject unsupported schema versions with actionable errors. The project is a prototype; do not add compatibility adapters unless explicitly requested.
- Preserve existing user changes in a dirty worktree.
- Use `rg` for search and `apply_patch` for edits.
- Keep generated sessions under `.resonant-code/context/`; do not use them as authoritative task-time cache reads.
- Avoid direct LLM API calls from Runtime. The host agent already has task context and repository tools.

## Verification

Run the full gate before handoff:

```sh
corepack pnpm verify
```

Tests must cover the behavior that justifies the harness:

- task and scope activation
- local directive precedence
- byte-ceiling overflow, explicit delivery selection, and delivered-ID
  boundaries
- current versus stale RCCL evidence
- exact RCCL prepare-contract evidence and independent approval provenance
- accepted, rejected, and downgraded semantic relations
- strict interpretation and exception gates
- evaluation against actual diff/check evidence
- feedback idempotency
- isolated built-package smoke behavior
- paired-evaluation protocol and claim/ledger consistency

When changing architecture, report complexity movement and observable behavior, not only passing tests.

## Non-negotiable regressions

Do not regress to raw prompt concatenation, skill-local policy engines, trusting an RCCL semantic claim because its snippet matched, evaluating directives the agent never received, omitting Decision Trace, or treating feedback as decoration.
