# AGENTS.md

## What this repository builds

`resonant-code` is a change-adoption harness for production coding agents. It
lets an agent own the local implementation loop while keeping task meaning,
observed facts, and the adoption decision separately inspectable.

The product objective is to reduce the total cost from a developer request to
a confidently adopted change without weakening the developer's system
understanding or decision quality. It is not a coding agent, repository wiki,
planning framework, prompt library, transcript store, or automated approver.

Read `docs/architecture.md` before changing product boundaries, lifecycle,
authority, persistence, public APIs, or host interaction. Read
`docs/change-workflow.md` before changing CLI protocol or task-run behavior.
Describe current implementation separately from future architecture and from
measured product evidence.

## Product kernel

The architecture is three task cores and one longitudinal loop:

1. **Semantic Contract** — what one change is intended and authorized to mean.
2. **Fact Spine** — what the workflow observed before and after implementation.
3. **Cognitive Handoff** — what the actual change means, what remains unknown,
   and where direct review has the highest value.
4. **Decision Continuity** — how adopted decisions and observed outcomes may
   reduce repeated semantic work in later tasks.

The current MVP implements one task-scoped loop across the first three cores.
Decision Continuity is not implemented. Do not add adoption history, durable
decision records, preference learning, a delegation frontier, a global memory
store, or another cross-task lifecycle without a concrete consumer and evidence
that it improves a real decision over a simpler workflow.

Proportional Assurance is the deterministic policy joining the three current
cores. The lifecycle remains fixed while explicit handoff obligations vary by
adoption consequence and assurance dimension. `routine`, `standard`, and
`critical` are derived presentation labels, not trust or complexity scores.
The executable policy is the exact basis-bearing requirements in the Semantic
Contract plus fact-triggered and host-disclosed escalation. Do not add a fourth
core, a general workflow engine, or repository heuristics for this behavior.

Every persistent field or state must answer:

1. Which compile, collection, review, recovery, adoption, or future activation
   decision can it change?
2. Can the developer inspect that decision and its authority or evidence?
3. Can its value be tested against a simpler baseline?

Remove it when those questions have no concrete answer.

## Responsibility boundary

- Developers own desired outcomes, constraints, non-goals, long-lived
  tradeoffs, exceptions, and adoption.
- Coding agents own repository investigation, interpretation, recommendation,
  local reversible engineering judgment, implementation, diagnosis, repair,
  falsification, and handoff claims.
- The runtime owns only facts collected by the workflow: baselines, frozen
  semantic check definitions, actual changes, ordered check attempts and their
  execution budgets, output integrity, and related reproducible observations.

The harness binds provenance, facts, ordering, and presentation; it is not a
fourth authority. A developer decision cannot erase a contradictory collected
fact. A fact cannot decide product meaning. Agent prose cannot become a
developer decision or machine fact through a label.

Exact developer messages and decisions use `HumanEvent`. Structured outcomes,
constraints, focus, consequence, assurance dimensions, and recommendations
remain agent interpretations with exact event or evidence bases. The runtime
validates identity and references, not whether the interpretation is
semantically faithful.

A concrete task authorizes necessary local, reversible inspection, edits,
checks, documentation, and safe repair within the compiled task meaning. Ask
only when necessary information is missing, a material long-lived choice or
semantic drift remains, an exact exception or verification relaxation is
needed, or an external or irreversible effect is proposed. Consolidate such
questions.

## Change lifecycle

The normal path is:

```text
prepare -> agent implementation -> collect -> agent handoff -> finalize
```

`change explain` is on-demand inspection, not a mandatory successful-path
stage.

### Prepare

The host supplies exact developer events, basis-bearing semantic values,
an explicit assurance-dimension list, optional exact repository evidence, and
explicit verification commands or a concrete no-command rationale. Each
declared dimension has material or adoption-critical criticality, an adoption
rationale, and an exact event or evidence basis. The host resolves
repository-discoverable details before asking the developer.

Consequence means the adoption impact of a wrong change or explanation, not
implementation effort. Low consequence with no dimension compiles to routine;
medium requires at least one dimension; high requires at least one
adoption-critical dimension. A critical dimension raises the profile. Runtime
must reject missing or duplicate requirements and return the exact compiled
Assurance Plan for inspection.

Focus paths guide investigation and review; they are not write permissions or
a prediction of final changed files. The runtime does not infer task meaning,
verification commands, or semantic importance from keywords, path counts,
dependencies, or framework filename lists.

Only `delegation-compiled` creates a run. Authority, unresolved-decision, and
verification results write nothing. Prepare captures the complete dirty and
non-ignored untracked baseline, freezes checks, keeps synthetic Git objects in
the task run, and rejects a transient input file inside the worktree. Executable
preflight checks only the top-level command and does not claim nested runtime
dependencies are available.

### Collect

Collect executes every frozen argv definition without a shell and records the
complete baseline-to-current change. Timeout is an operational attempt budget,
not part of Semantic Contract or check identity. A normal collection uses the
CLI-owned default or an explicit collect-time budget and replaces prior
attempts. A same-run timeout retry may append only after the latest attempt
actually timed out and only with a larger budget; it must preserve every prior
attempt. Preserve file operations, kinds, modes, digests, representable patch
content, binary markers, exact check attempts, full-stream digests, bounded
logs, and command-definition or acceptance-surface mutations.

The host cannot supply changed files, check outcomes, patch facts, attempt
history, or collection identity. A passing latest attempt is a machine fact
about that command, not proof of a semantic conclusion. A timed-out attempt, a
non-timeout unavailable command, and a completed failing command remain
distinct. Direct Host execution cannot replace a frozen Runtime attempt.

### Handoff and finalize

The host writes the Cognitive Handoff only after inspecting the complete
collected change. It supplies a system-meaning update, applicable material
claims, residual unknowns, a consequence-directed Review Map, and optional
material alternatives.

Claims use one basis: `repository-evidence`, `agent-judgment`,
`human-decision`, or `unverified`. Runtime-collected facts remain a separately generated
surface. Every adoption-critical agent, repository-evidence, or unverified
claim includes a concrete failure hypothesis and falsification attempt.
Contradicted, partial, and unverified conclusions remain visible.

Routine work with no compiled requirement may use empty claim and Review Map
arrays. Every compiled dimension requires a matching claim. Every
adoption-critical requirement requires an adoption-critical claim, and every
adoption-critical Agent, repository-evidence, or unverified claim requires
falsification. Every adoption-critical claim requires must-read or unresolved
Review Map coverage even when supported. Failed or unavailable checks, changed
verifier surfaces, unrepresentable changes, and residual unknowns may only add
obligations; they never lower the fixed contract, fact, currency, or authority
invariants.

Attention and the Review Map have different jobs. Attention states why evidence
is insufficient, its adoption impact, exact references, and a concrete next
action. The Review Map orders direct inspection by consequence; do not create
one item per changed file.

Finalize checks worktree currency before evaluating handoff input. Any edit
after collection returns `facts-stale` and requires collection again.
`handoff-ready` means ready for developer review, never adopted.

Generated adapters relay the CLI-owned `presentationMarkdown` unchanged.
Additional host investigation stays explicitly labeled as agent evidence.

## Package and API boundary

The dependency direction is:

```text
Generated host adapter -> CLI -> Core
```

The workspace has two publishable packages:

- `packages/core/` -> `@sovea/resonant-code-core`
- `packages/cli/` -> `@sovea/resonant-code`

Do not create another package without an independent consumer, public API,
version, and release need.

Core owns deterministic authority validation, Semantic Contract compilation,
fact schemas and binding, and Cognitive Handoff evaluation. Its root exposes
exactly two runtime values: `compileDelegation` and `evaluateHandoff`.

CLI owns commands, validation at the IO boundary, task-run sequencing, Git and
check collection, patch materialization, project initialization, generated
adapters, and presentation. Core does not run Git or commands, format CLI
output, know host-specific files, or call an LLM. CLI and adapters do not decide
semantic truth or invent facts.

Core and CLI versions move together. The CLI archive pins the exact matching
Core version after `workspace:*` is rewritten during pack. Unsupported protocol
or schema shapes fail with actionable errors; do not add translators, aliases,
dual-read, or dual-write paths unless explicitly requested.

The source repository does not ship installed `.codex`, `.codex-plugin`,
`.claude-plugin`, or repository-native `skills/` entrypoints. Project
initialization generates host workflows in the target repository.

## Persistence and project ownership

Task state lives only under `.resonant-code/runs/<runId>/`. One run owns its
contract, baseline, facts, handoff, evaluation, optional patch, and non-empty
bounded check logs. It is never authoritative state for another task.

The run states are `prepared`, `facts-collected`, and `completed`. Retention may
remove only whole completed runs; prepared and facts-collected runs remain
recoverable. Persisted stdout and stderr are each capped at 1 MiB while their
digests cover the complete stream.

Project initialization owns its manifest, generated host files, and marked
blocks in `AGENTS.md`, `CLAUDE.md`, and `.gitignore`. It plans writes before
mutation, protects owner-modified generated content, and never silently
deletes, translates, or overwrites unknown owner data.

## Engineering rules

- Use TypeScript for Core and CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Keep content-derived output deterministic and diffable. Timestamps belong
  only in lifecycle records.
- Preserve unrelated user changes in a dirty worktree.
- Use `rg` for search and `apply_patch` for source edits.
- Use safe repository-relative paths and argv process execution without a
  shell.
- Do not rank repository files or infer semantic meaning from token overlap,
  filenames, dependencies, or path counts.
- Do not infer assurance from keywords, diff size, file count, dependency
  count, or a scalar complexity, confidence, trust, or readiness score.
- Do not call an LLM from Core or CLI. The host agent already owns semantic
  reasoning and repository tools.
- Record package and protocol identity in runs, never absolute installation
  paths.
- Keep `dist/` generated, ignored, deterministic, and out of source review.
- Keep exact schemas in TypeScript and generated adapter examples; avoid
  duplicating full schemas across prose documents.
- Do not add scalar trust, readiness, or confidence scores.

## Verification and evidence

Run the technical gate before handoff:

```sh
corepack pnpm verify
```

CI also runs:

```sh
corepack pnpm audit --audit-level high
```

Tests must cover the observable behavior changed by the work, including failure
and recovery paths where material. Distribution changes must exercise isolated
Core and paired Core/CLI package archives. Architecture changes must report
complexity removed and added, persistent-state movement, and user-visible
behavior rather than only test results.

Proportional-assurance changes must cover routine zero-claim handoff, explicit
standard and critical dimension coverage, critical review, fact-triggered
routine escalation, deterministic plan identity, stale-fact priority, and
same-run monotonic timeout recovery without hiding earlier attempts.

Passing deterministic tests establishes internal consistency and
distributability, not product effectiveness. Claims about lower adoption cost
or preserved developer cognition require paired results under
`evaluation/paired-agent/PROTOCOL.md` and an explicit scoped product-owner
conclusion. Keep effectiveness `unverified` while committed evidence does not
meet that contract.

Do not regress to host-supplied machine facts, handoff claims written before
actual fact collection, facts presented as semantic truth, checks presented as
adoption, blanket review noise, focus paths treated as permissions, generated
memory treated as developer decisions, heuristic assurance downgrade, or
persistent state without a concrete decision-changing consumer.
