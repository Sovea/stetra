# AGENTS.md

## Product boundary

`resonant-code` is an AI coding change harness. It exists to make task-specific engineering guidance stable, inspectable, evidence-aware, and reusable across host agents.

It is not a repository wiki, a general agent framework, or a collection of static prompt rules. Its differentiator is a small deterministic kernel around the part text-only workflows cannot reliably own: activating project policy, qualifying repository observations, budgeting delivered guidance, collecting machine facts, and evaluating the actual change.

## Product thesis

The target is code a developer or team wants to adopt and keep, not merely plausible output. The primary failure modes are disproportionate changes, generic advice, poor repository fit, weak compatibility judgment, noisy review, and unverifiable claims that guidance was followed.

Use host-agent judgment for task understanding and semantic relations. Admit that judgment through narrow structured inputs. Do not create multi-stage artifacts merely because a typed contract can be defined.

Every persistent field or lifecycle stage must answer at least one of these questions:

1. Can it change a compile or evaluation decision?
2. Can a developer inspect the decision it changed?
3. Can its benefit be tested against a simpler baseline?

If not, remove it.

## Architecture

The execution loop has five parts:

1. Playbook — prescriptive built-in, repository-committed team, and
   user-scoped personal directives.
2. RCCL — observational repository context with separate evidence, semantic-confidence, and review signals.
3. Runtime — the deterministic `compileChange` / `evaluateChange` hard kernel.
4. CLI — the distributable deterministic control plane for assets, project
   initialization, IO, lifecycle sequencing, machine-fact collection, and
   presentation.
5. Host adapters — generated thin Codex/Claude skills that preserve native host
   judgment and invoke the CLI's stable JSON protocol.

The workspace has exactly two publishable packages:

- `packages/core/` → `@sovea/resonant-code-core`
- `packages/cli/` → `@sovea/resonant-code`

Runtime, RCCL, and Playbook sources are separate modules inside Core. Workflow,
machine-fact collection, project initialization, and generated Host Adapters
are modules inside CLI. Do not create another package without an independent
consumer, public API, version, and release need.

### Public Core API

The Core root exposes exactly two value entrypoints:

- `compileChange(input)`
- `evaluateChange(input)`

RCCL lifecycle operations are exported only from
`@sovea/resonant-code-core/rccl`. Do not expose task helpers, parsers, merge
functions or CLI workflow APIs from
`packages/core/src/index.ts`.

### Compile boundary

`compileChange` accepts a canonical task context, the team Playbook, an
optional personal overlay, optional bounded directive/observation relation
proposals, and optional task/team verification proposals. It owns:

- structural task validation, mechanical path/technology normalization, and
  explicit semantic-alignment gates
- Playbook loading, validation, local override, scope selection, and explicit
  authority ordering
- symmetric target/directive scope overlap and canonical lowercase technology
  IDs; directory targets are intended scope roots, not predicted changed files
- task-relevant RCCL evidence re-verification
- semantic relation validation and execution-mode adjudication
- compact EGO budgets and Decision Trace
- verification-plan generation
- inspectable activation and attention-only attestation plans

Standard tasks compile directly. Do not reintroduce mandatory task-model, semantic-graph, capability-profile, cache, or evolution-proposal round trips.

Guidance budgeting is hard product behavior:

- no per-section item limits
- one configurable UTF-8 byte ceiling, 6 KB by default
- the ceiling applies to normative agent-facing guidance, not source,
  verification, evidence, or Decision Trace metadata
- required, avoid, and unresolved-tension guidance is never silently omitted
- optional omissions require an explicit host selection and rationale
- overflow returns an actionable result instead of truncating guidance

Only delivered guidance IDs may be evaluated later.

Verification proposals contain an explicit check ID, rationale, and source
(`team-default` or `host-task`). Runtime merges them with checks required by
delivered guidance. It does not discover commands or silently discard a
selected definition; the CLI freezes and executes every definition in the
selected team-default or task configuration.

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

### Evaluation boundary

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

Before writing attestations, the Host workflow must inspect the complete actual
diff and try to falsify each required, avoid, and tension claim. Contradictory
or insufficient evidence must produce a repair, `violated`, `partial`, or
`unverified`, never a confirmatory `satisfied` assertion.

Unverified required, avoid, or tension guidance produces
`needs-attention`; a requested but unapproved exception produces
`exception-required`. Hard required/avoid violations reject the evaluation.
An exact check that cannot start or finish is `unavailable` and needs
attention; a completed non-zero check is `failed` and rejects the evaluation.
Unverified optional `consider` guidance remains informational and must not
force an attention state or completion retry. Runtime, not the adapter, identifies the
required/avoid/tension items that need attestations.

Runtime persistence is task-scoped. A runnable prepare creates exactly one
`.resonant-code/runs/<runId>/` directory containing `run.json` and the Host
evaluation input. Completion stores its check logs and evaluation inside that
same run and must not duplicate the full current worktree snapshot.
Alignment, guidance-overflow, and verification-required outcomes create no run.
Cleanup may remove only whole completed runs; prepared runs remain untouched.
Persisted check stdout/stderr is capped at 1 MiB per stream; the digest covers
the complete stream and truncation remains explicit in the collected facts. An
empty stream creates neither a log file nor an output reference.
Do not add a global feedback ledger, aggregate store, or policy-proposal
lifecycle until it has a concrete compile/evaluation consumer and measurable
benefit over inspecting task runs.

Do not infer product effectiveness from passing deterministic tests. A claim
that the harness reduces correction cost or improves adoption requires
completed paired-agent results under `evaluation/paired-agent/PROTOCOL.md`;
the machine-validated ledger may explicitly leave that claim unverified for the
technical MVP.

### CLI and host-adapter boundary

CLI may parse flags, orchestrate prepare/complete steps, read and write
artifacts, and present Core results. It depends on the exact same published
Core version. Core ships the built-in Playbook assets, so installed workflows
never depend on a source-checkout path.

Generated host adapters contain workflow instructions only. They invoke CLI
JSON commands and use host judgment for task semantics, exact evidence-window
selection, relation proposals, implementation, and attestations. They must not
parse Playbook data to make policy decisions, rank directives, adjudicate
relations, decide execution modes, or invent evaluation facts. The source
repository does not ship `.claude-plugin`,
`.codex-plugin`, `.codex`, or repository-native `skills/` entrypoints.
Before prepare, the Host owns a transient semantic alignment step. It resolves
repository-discoverable details itself and asks one consolidated question only
when materially different choices change the goal, public behavior,
compatibility, architectural ownership, irreversible migration strategy, or
another long-lived tradeoff. Confirmed decisions use the existing task,
constraint, avoid, target, and uncertainty inputs; do not persist a separate
design artifact.

Task targets focus policy activation and are not file write permissions. The
Host may change necessary adjacent implementation, tests, types, and
documentation while the aligned semantic contract remains intact. Re-align
only when the discovered work changes that contract.

The normal code lifecycle is:

1. Host aligns material design choices, encodes the semantic task contract,
   and selects an explicit task verification configuration
2. `resonant-code change prepare --json` → compile compact task guidance
3. Host implements the aligned change and challenges the complete actual diff
4. `resonant-code change complete --json` → collect actual change/check facts,
   evaluate attestations, and complete the task run

## Data separation

Keep these concepts distinct:

- Playbook says what should be done.
- RCCL says what repository reality appears to be.
- Host relation proposals say how a specific observation relates to an active directive.
- Runtime decides what is delivered and how it executes.
- Evaluation says what the actual change evidence supports.

Do not collapse them into one score, one prose prompt, or one “verified truth” flag.

## Engineering rules

- Use TypeScript for Core and new CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Keep output deterministic enough to diff; timestamps may appear only in lifecycle records.
- Reject unsupported schema versions with actionable errors. The project is a prototype; do not add compatibility adapters unless explicitly requested.
- Preserve existing user changes in a dirty worktree.
- Use `rg` for search and `apply_patch` for edits.
- Keep task runtime state under `.resonant-code/runs/<runId>/`; do not use one
  run as an authoritative cache for another task.
- Keep project adapter ownership in `.resonant-code/manifest.json`. Never
  overwrite Team Playbook, RCCL, checks, or owner-modified generated
  adapter content as an upgrade.
- Project initialization is the sole owner of generated host files and marked
  blocks in `AGENTS.md`, `CLAUDE.md`, and `.gitignore`; Bootstrap must not
  mutate those paths.
- Bootstrap may enumerate available Playbook layers, but the host selects
  concrete repository evidence. Do not maintain framework filename lists,
  rank candidate files, or cap the repository evidence visible to the host.
- Bootstrap prepare returns its prompt and schema without persisting debug or
  candidate artifacts in the project.
- CLI runs record CLI/Core package identity, not an absolute installation
  path.
- Core and CLI versions move together. CLI package archives must pin Core to
  the exact matching version after `workspace:*` is rewritten during pack.
- `dist/` is generated by build/prepack, ignored by Git, and never reviewed as
  source. Both public npm archives contain their own `dist/`.
- Avoid direct LLM API calls from Runtime. The host agent already has task context and repository tools.

## Verification

Run the full gate before handoff:

```sh
corepack pnpm verify
```

Tests must cover the behavior that justifies the harness:

- task and scope activation
- canonical technology IDs, directory/exact scope overlap, and activation
  diagnostics
- local directive precedence
- byte-ceiling overflow, explicit delivery selection, and delivered-ID
  boundaries
- current versus stale RCCL evidence
- exact RCCL prepare-contract evidence and independent approval provenance
- accepted, rejected, and downgraded semantic relations
- Host-owned task semantics, alignment gates, and unified exception behavior
- evaluation against actual diff/check evidence
- attention-only attestations and optional informational guidance
- verification-required no-write behavior and task-run isolation
- isolated Core npm-tarball API smoke behavior
- paired Core/CLI npm-tarball installation and binary smoke behavior
- paired-evaluation protocol and claim/ledger consistency

When changing architecture, report complexity movement and observable behavior, not only passing tests.

## Non-negotiable regressions

Do not regress to raw prompt concatenation, skill-local policy engines, trusting an RCCL semantic claim because its snippet matched, evaluating directives the agent never received, omitting Decision Trace, or introducing persistent lifecycle data without a decision-changing or inspectable consumer.
