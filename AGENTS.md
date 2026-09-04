# AGENTS.md

## Repository purpose

Stetra is a Human-authoritative engineering harness for Agent-authored coding
changes. It keeps exact developer direction, Runtime-observed facts, Agent
judgment, developer understanding, and Human adoption connected throughout one
admitted task.

It is installed into Codex, Claude Code, Pi, Trellis, and similar execution
Hosts as a project layer. It is not a Coding Agent, chat entry point, planner,
repository wiki, transcript store, prompt library, general workflow engine,
multi-Agent orchestrator, or automatic approver.

Read `docs/architecture.md` before changing product boundaries, authority,
persistence, lifecycle, public APIs, or Host integration. Read
`docs/change-workflow.md` before changing CLI protocol or task behavior. Keep
implemented behavior, planned architecture, and measured product evidence
explicitly separate.

## Product kernel

One admitted task contains:

1. **Semantic Contract** — exact Human request, compact Agent interpretation,
   and frozen verification boundary.
2. **Fact Spine** — Runtime-observed baseline, actual change, Check Attempts,
   bounded logs, verifier mutations, and fact currency.
3. **Cognitive Handoff** — actual behavior, mechanism, material invariants,
   failure paths, effects, tradeoffs, unknowns, review focus, and Agent
   recommendation.
4. **Human Decision** — explicit adoption authority bound to the current facts
   and Handoff.

The developer and Agent see `Align -> Work -> Decide`. Internal state and
identity are Runtime concerns, not an Agent protocol.

## Admission and proportionality

Stetra creates state only for an admitted coding task. Non-coding conversation
and declined work create no task and capture no prompt. Admission comes from an
exact Human choice or project policy. Runtime must not infer it from keywords,
paths, dependencies, diff size, or file count.

Routine is the default. It requires no Conditions, Evidence Obligations,
structured diagnosis, baseline checks, Host-policy claims, or Review Decision
graph. Consequential assurance is enabled only by an exact Human choice or
explicit project policy and adds bounded Adoption Concerns with concrete
evidence consumers.

Do not add scalar trust, readiness, confidence, complexity, risk, productivity,
or quality scores. Do not restore nested obligation graphs, Independent
Challenge, or broad Host attestation without measured evidence that a simpler
concern cannot support a real decision.

Decision Continuity is not implemented. Do not add cross-task memory,
preferences, adoption history, or another lifecycle without a concrete
decision-changing consumer and evidence that it beats a simpler workflow.

## Authority boundary

- Developers own exact requests and corrections, outcomes, constraints,
  non-goals, long-lived choices, exceptions, external effects, admission, and
  adoption.
- Agents own interpretation, investigation, design, implementation, diagnosis,
  repair, falsification, Handoff semantics, review focus, and recommendation.
- Runtime owns identities, ordering, frozen definitions, baselines, actual
  changes, Check Attempts, bounded logs, currency, persistence, and
  deterministic structural policy.
- A trusted Host may attest only capabilities and event identity it actually
  controls.

Human Events, Agent judgment, Runtime facts, and Host capability cannot be
relabelled as one another. Runtime validates references and structural ceilings;
it does not decide natural-language truth. A Human exception cannot erase a
contradictory fact, and green checks cannot become adoption.

## Workflow

The routine task path is:

```text
task begin -> Agent implementation -> task collect -> task handoff
-> Human decision
```

The Agent may call `task inspect` on demand. Failed checks return ordinary
engineering evidence and the Agent repairs through its normal Host loop. An
edit after collection makes facts stale. A correction request creates a
successor Attempt while preserving prior facts, Handoff, and decision.

The primary Agent surface must remain small. Do not reintroduce `hostAction`,
owned Draft/Guide transport, full canonical protocol authoring, mandatory
Diagnosis, prose-parsed routing, or hand-written partial schema rules.

Provider Hooks may inject the current phase and request one bounded continuation
before an unfinished task stops. Repeated unchanged state becomes a warning and
permits stop. Hooks do not create authority or task state, and the portable
workflow remains usable without them.

## Begin and collect

Begin receives one exact Human Event, a compact Agent interpretation, explicit
routine or consequential assurance, and exact Check argv, a named project
profile, or a concrete no-command rationale. It captures the complete dirty and
non-ignored untracked Git baseline and publishes the task only after compilation
and baseline observation succeed. Routine Begin does not execute checks.

Collect executes every frozen argv without a shell and records the complete
baseline-to-current change. Preserve file operations, modes, digests,
representable patches, binary markers, exact Check Attempts, full-stream
digests, bounded logs, execution inputs, check-induced changes, and declared
verifier-surface mutations.

Timeout is an operational budget, not semantic identity. Retry is allowed only
after an actual timeout, with a larger bounded budget, while preserving the
earlier Attempt. Direct Host execution is Agent evidence and never replaces a
Runtime Check Attempt.

## Handoff and decision

Handoff is authored only from current collected facts. Routine Handoff requires
actual behavior, mechanism, and recommendation; invariants, failure/recovery,
effects, tradeoffs, unknowns, and review focus are optional and included only
when material.

Runtime adds mechanical Attention for non-passing checks, changed verifier
surfaces, check-induced or unrepresentable changes, stale facts, unknowns, and
declared concern gaps. It prevents concern conclusions and recommendations from
exceeding declared evidence without deciding semantic truth.

The Developer Decision Brief is concise and decision-first. It keeps Runtime
facts, Agent judgment, and Human authority separate. Adoption remains an exact
later Human Event. Decision never commits, merges, publishes, deploys, or
creates cross-task policy.

## Package and persistence boundaries

```text
Generated Host Adapter -> CLI Runtime -> Core
```

- `packages/core/` publishes `@sovea/stetra-core`.
- `packages/cli/` publishes `@sovea/stetra`.
- Core exposes exactly `compileDelegation` and `evaluateHandoff` as runtime
  values.
- Core does not read repositories, execute commands, format CLI output, know
  Host files, or call an LLM.
- CLI owns IO validation, sequencing, Git/Check collection, storage,
  presentation, project initialization, and Host continuity.

Core and CLI versions move together and use `cognitive-adoption` schema `2`.
Schema `1` is unsupported; do not add migration, aliases, translators, or dual
read/write paths without real user data that requires them.

Task state lives only under `.stetra/tasks/<taskId>/`. Persist admitted Human
requests and explicit corrections or decisions, compiled Contract and baseline,
non-duplicate Fact Collections, Check Attempts and non-empty logs, Handoffs, and
Human Decisions. Do not persist Agent transcripts, ordinary Hook events,
Drafts, Guides, or data without an alignment, recovery, review, or adoption
consumer.

Project initialization owns its manifest, generated files, JSON Hook fragments,
and marked blocks. Plan writes before mutation, protect owner-modified content,
and never silently overwrite or delete unknown owner data.

## Engineering rules

- Use TypeScript for Core and CLI control-plane logic.
- Prefer narrow modules and explicit input/output types.
- Keep protocol state deterministic and diffable; timestamps belong only in
  lifecycle events.
- Preserve unrelated user changes in a dirty worktree.
- Use `rg`, `apply_patch`, safe repository-relative paths, and argv execution
  without a shell.
- Do not call an LLM from Core or CLI.
- Do not infer semantic importance from filenames, token overlap,
  dependencies, paths, or counts.
- Do not add persistent state without a concrete alignment, collection,
  recovery, review, or adoption decision it changes.
- Keep `dist/` generated, ignored, deterministic, and out of source review.
- Keep exact schemas in TypeScript; generated examples may illustrate them but
  prose does not duplicate field validation.

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
