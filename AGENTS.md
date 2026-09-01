# AGENTS.md

## Repository purpose

Stetra is an engineering harness for coding agents. It keeps the engineering
thread intact when implementation is delegated, so the developer can understand
the actual system change, inspect its evidence boundary, and make the adoption
decision.

It is not a coding agent, planner, repository wiki, transcript store, prompt
library, general workflow engine, or automatic approver.

Read `docs/architecture.md` before changing product boundaries, authority,
persistence, lifecycle, public APIs, or Host integration. Read
`docs/change-workflow.md` before changing CLI protocol or task behavior. Keep
current implementation, planned architecture, and measured product evidence
explicitly separate.

## Product kernel

The current task-scoped kernel is:

1. **Semantic Contract** — what the change is intended and authorized to mean.
2. **Fact Spine** — what Stetra observed before and after implementation.
3. **Cognitive Handoff** — what the actual change means, what remains unknown,
   and where direct review matters.

Proportional Assurance derives exact obligations from declared consequence,
assurance dimensions, collected facts, Host limitations, and Human choices. Do
not add scalar trust, readiness, confidence, or complexity scores. Do not infer
assurance from keywords, paths, dependencies, diff size, or file counts.

Decision Continuity is not implemented. Do not add cross-task memory,
preferences, adoption history, or another lifecycle without a concrete
decision-changing consumer and evidence that it beats a simpler workflow.

## Authority boundary

- Developers own exact requests and corrections, outcomes, constraints,
  non-goals, long-lived choices, exceptions, external effects, and adoption.
- Agents own investigation, interpretation, design, implementation, diagnosis,
  repair, falsification, recommendation, and Handoff semantics.
- Runtime owns identities, ordering, frozen definitions, baselines, actual
  changes, Check Attempts, bounded logs, currency, and deterministic structural
  policy.
- A trusted Host may attest only capabilities it actually controls. The current
  generated Codex and Claude adapters are thin and instruction-only.

Human Events, Agent judgment, Runtime facts, and Host capability cannot be
relabelled as one another. Runtime validates references and structural ceilings;
it does not decide natural-language truth. A Human exception cannot erase a
contradictory fact, and green checks cannot become adoption.

## Current lifecycle

```text
prepare -> Agent implementation -> collect -> Agent handoff -> Human decision
```

Evidence may cause bounded delivery repair, Verification Revision, exact Human
Resolution, recollection, or direct review. `change explain` is on-demand
inspection, not a mandatory successful-path stage.

Every stage returns a structured `hostAction`. Input-bearing actions reserve one
task-owned Draft and companion Guide. The Agent authors only stage-specific
semantic content; CLI binds canonical IDs, fingerprints, task state, and exact
references. Do not reintroduce prose-only routing, full canonical protocol
authoring, or hand-written partial schema rules.

Independent Challenge is a declarative evidence strategy. Current thin adapters
cannot prove a fresh context, so required Challenge evidence remains unavailable,
caps the related conclusion, and becomes direct review. Do not add a Challenge
command, Challenger profile, provider subprocess, Agent-authored context
attestation, or persisted Challenge artifact.

Provider Hooks preserve continuity and guard final responses, but the workflow
must remain usable without Hooks through the portable owned-input path. Hooks do
not create authority or task state.

## Prepare and Collect

Prepare receives exact Human Events, basis-bearing task meaning, explicit
assurance, optional exact repository evidence, Host-policy requirements, and
explicit Check commands or a concrete no-command rationale. It captures the
complete dirty/untracked baseline, freezes checks, and creates a task only after
compilation and baseline observation succeed.

Collect executes every frozen argv without a shell and records the complete
baseline-to-current change. Preserve file operations, modes, digests,
representable patches, binary markers, exact Check Attempts, full-stream
digests, bounded logs, execution inputs, and verifier-surface mutations.

Timeout is an operational budget, not semantic identity. Retry is allowed only
after an actual timeout, with a larger bounded budget, while preserving every
earlier attempt. Direct Host execution is Agent evidence and never replaces a
Runtime Check Attempt.

## Handoff and decision

Handoff is authored only from current collected facts. It includes the actual
behavior and mechanism, preserved invariants, failure/recovery behavior,
important effects, material tradeoffs, bounded Condition and Obligation
findings, falsification, evidence coverage, residual unknowns, Review Decisions,
and an Agent recommendation.

Runtime prevents conclusions and recommendations from exceeding declared
evidence. Failed or unavailable checks, changed verifier surfaces,
unrepresentable changes, missing independent evidence, Host-policy gaps, and
unknowns add Attention; they never weaken the Contract or become semantic
truth. Any edit after collection makes facts stale.

The Developer Decision Brief is concise and decision-first. It keeps Runtime
facts, Agent judgment, and Human authority separate and preserves every
adoption-changing issue. Adoption remains an exact later Human Event. Decide
never commits, merges, publishes, deploys, or creates cross-task policy.

## Package and persistence boundaries

```text
Generated Host Adapter -> CLI -> Core
```

- `packages/core/` publishes `@sovea/stetra-core`.
- `packages/cli/` publishes `@sovea/stetra`.
- Core exposes exactly two runtime values: `compileDelegation` and
  `evaluateHandoff`.
- Core does not run Git/commands, format CLI output, know Host files, or call an
  LLM.
- CLI owns IO validation, sequencing, Git/Check collection, project generation,
  authoring projection, packet assembly, and presentation.

Core and CLI versions move together and currently use the initial `0.0.1`
identity. Persisted protocol/schema uses the initial `cognitive-adoption` / `1`
shape. Unsupported shapes fail strictly; do not add migration, aliases,
translators, or dual read/write paths.

Task state lives only under `.stetra/tasks/<taskId>/`. Events are append-only;
projections are rebuildable. A task owns its Contract, baseline, Attempts,
facts, dispositions, revisions, Handoff, resolutions, decision, patch, and
non-empty bounded logs. Retention removes only whole completed tasks.

Project initialization owns its manifest, generated files, JSON Hook fragments,
and marked blocks. Plan writes before mutation, protect owner-modified content,
and never silently overwrite or delete unknown owner data.

## Engineering rules

- Use TypeScript for Core and CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Keep protocol state deterministic and diffable; timestamps belong only in
  lifecycle records.
- Preserve unrelated user changes in a dirty worktree.
- Use `rg`, `apply_patch`, safe repository-relative paths, and argv execution
  without a shell.
- Do not call an LLM from Core or CLI.
- Do not infer semantic importance from filenames, token overlap, dependencies,
  or path counts.
- Do not add persistent state without a concrete compile, collection, recovery,
  review, or adoption decision it changes.
- Keep `dist/` generated, ignored, deterministic, and out of source review.
- Keep exact schemas in TypeScript and generated examples; avoid copying full
  schemas into prose.

## Verification

Run:

```sh
corepack pnpm verify
corepack pnpm audit --audit-level high
```

Tests must cover changed observable behavior, including failure and recovery
paths. Distribution changes must test isolated Core and paired Core/CLI package
archives.

Deterministic tests prove consistency and distributability, not product
effectiveness. Claims about adoption cost or preserved developer cognition
require protocol-conformant paired evidence under
`evaluation/paired-agent/PROTOCOL.md` and an explicit product-owner conclusion.
