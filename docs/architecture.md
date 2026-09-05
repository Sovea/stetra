# Architecture

This document is the authoritative product boundary and target design for
Stetra schema `2`. Current executable behavior is defined in
[Change workflow](change-workflow.md). Measured product evidence is separate
from both documents.

## Product positioning

Stetra is a **Human-authoritative engineering harness for Agent-authored coding
changes**. It keeps the engineering thread between developer direction, the
actual repository change, verification evidence, Agent judgment, and Human
adoption intact.

Codex, Claude Code, Pi, Trellis, and similar systems remain the interaction and
execution Hosts. They own models, conversation, investigation, planning,
implementation, tools, sessions, subagents, worktrees, cancellation, and
streaming. Stetra is installed into those Hosts as a project layer; it does not
replace their entry point or run another Agent loop.

Stetra protects five developer rights:

| Right | Product obligation |
|---|---|
| Direction | Preserve exact developer authority and explicit corrections. |
| Visibility | Present actual repository and verification facts independently of Agent prose. |
| Intervention | Return control when continuing requires a Human-owned choice. |
| Understanding | Reconstruct behavior, mechanism, invariants, effects, and failure paths. |
| Adoption | Keep completion, evidence, recommendation, and Human acceptance separate. |

The product succeeds only when implementation outcomes remain non-inferior,
developer adoption cost falls, developer understanding remains non-inferior,
evidence provenance stays inspectable, and adoption authority remains Human.

## Product kernel

One admitted coding task contains three task cores and one Human control loop:

1. **Semantic Contract** — the exact Human request beside a compact Agent
   interpretation and frozen verification boundary.
2. **Fact Spine** — Runtime-observed baseline, current change, Check Attempts,
   bounded logs, verifier mutations, and fact currency.
3. **Cognitive Handoff** — the Agent's current explanation of actual behavior,
   mechanism, invariants, failure paths, effects, tradeoffs, unknowns, review
   focus, and recommendation.
4. **Human Decision** — explicit acceptance, correction, rejection, or deferral
   bound to one exact Handoff and Fact Collection.

These cores serve one problem: turn an Agent implementation into an engineering
change the developer can understand, challenge, and responsibly adopt.

## Visible workflow and internal control

The developer and Agent see three ordinary engineering phases:

```text
Align -> Work -> Decide
```

The Runtime may use more internal transitions, identities, and immutable
artifacts, but those are not an Agent protocol.

```text
No Task
  -> admitted Task + baseline
  -> Agent works through its normal Host
  -> current Fact Collection
  -> Cognitive Handoff
  -> Human Decision
```

Check failure returns ordinary engineering evidence to the Agent and leaves the
task in Work. An edit after collection makes the facts stale. A correction
request creates a successor Attempt. These mechanics do not require a separate
diagnosis or resolution document on the routine path.

## Task admission

Stetra is installed for the project but creates state only for an admitted
coding task. Non-coding conversation and declined tasks create no task, capture
no prompt, run no check, and have no visible lifecycle.

Admission is explicit policy, never a Runtime risk inference:

- `explicit` — only a direct developer request starts a managed task;
- `ask` — the Agent offers one concise task-admission choice for a coding task;
- `required` — project policy requires coding tasks to be managed.

The Agent may interpret whether a request is a coding task. Runtime must not
infer assurance or admission from keywords, paths, dependencies, diff size,
file count, or a scalar score.

## Proportional assurance

### Routine

Routine is the default and contains only:

```text
exact request -> compact interpretation -> baseline -> implementation
-> current diff and checks -> compact Handoff -> Human Decision
```

Routine tasks do not require Conditions, Evidence Obligations, structured
diagnosis, baseline checks, Host-policy claims, or Review Decision graphs.

### Consequential

Consequential assurance is enabled only by an exact Human choice or explicit
project policy. It adds bounded Adoption Concerns describing the statement,
adoption impact, concrete evidence requirements, and optional falsification
design. Runtime may prevent a concern finding from exceeding the declared
evidence path, but it cannot decide natural-language truth.

More elaborate obligation graphs, independent challenge, or Host attestation
may return only after a measured consumer proves that a simpler concern is
insufficient.

## Authority boundary

| Actor | Owns | Does not own |
|---|---|---|
| Developer | Exact requests and corrections, desired outcomes, constraints, non-goals, long-lived choices, exceptions, external effects, task admission, and adoption | Runtime observations or Agent investigation |
| Agent | Interpretation, investigation, design, implementation, diagnosis, repair, falsification, Handoff semantics, review focus, and recommendation | Developer authority, machine facts, or adoption |
| Runtime | Identity, ordering, frozen definitions, baseline, actual changes, Check Attempts, bounded logs, currency, persistence, and deterministic structural policy | Product meaning, engineering cause, implementation strategy, or adoption |
| Trusted Host | Only capabilities and event identity it actually controls | Semantic truth or Human authority |

Human Events, Agent judgment, Runtime facts, and Host attestation cannot be
relabelled as one another. Green checks are observations, not adoption. A Human
exception does not erase contradictory evidence.

## Host integration

The dependency direction is:

```text
Generated Host Adapter -> CLI Runtime -> Core
```

The Adapter is a provider-specific bridge, not a second product entry point. It
may install compact Skills and lifecycle Hooks, inject the current task phase,
capture exact Host events where supported, and provide one bounded continuation
before a Host stops an admitted unfinished task.

Provider-neutral directives are deliberately small:

```text
noop | inject-context | continue-once | present
```

A repeated unchanged Stop condition becomes a visible warning and permits the
Host to stop. Hooks preserve continuity; they do not create task authority,
semantic truth, or adoption.

The portable fallback remains usable without Hooks. It exposes ordinary task
operations rather than an owned Draft/Guide transport or canonical persistence
schema. Current thin adapters cannot attest prompt identity, so schema `2`
marks relayed Human text as `unattested-input`; it preserves and presents the
exact submitted bytes without upgrading their provenance.

## Agent-facing surface

The Agent understands the engineering workflow, not Stetra's internal data
model. The primary operations are:

```text
task begin | task collect | task handoff | task inspect
```

Task amendment, verification revision, and Human decision are conditional
operations. The Agent does not orchestrate Host Actions, reserve Drafts, bind
fingerprints, construct canonical references, or operate Runtime recovery
states.

Native adapters may expose typed tools. The CLI accepts the same compact inputs
through stdin or an external file. Core and CLI never call an LLM.
Each authoring command exposes `--input-schema` without a repository or task.
The schema is generated from the actual CLI input validator and examples are
validated by that same definition. Runtime reference and evidence validation
still applies when an input is submitted.

## Fact Spine

Runtime preserves only facts with an alignment, recovery, review, or adoption
consumer:

- complete dirty and non-ignored untracked Git baseline;
- actual file operations, modes, digests, representable patches, and binary or
  unrepresentable markers;
- immutable Check definitions and ordered Attempts;
- timeout, signal, spawn failure, exit status, durations, full-stream digests,
  and bounded logs;
- pre-check, post-check, and check-induced worktree changes;
- declared verifier-surface mutations;
- declared execution-input snapshots needed for currency;
- platform, architecture, and resolved top-level executables;
- current-worktree currency.

Checks run without a shell after implementation. Schema `2` does not execute
baseline checks; the pre-change Git snapshot establishes the actual-change
boundary, not a claim about pre-existing behavior.

Currency covers the worktree and declared local execution inputs. It does not
attest external service availability. A non-timeout failure can be explicitly
reobserved once per unchanged worktree and declared inputs in a delivery
Attempt. Refresh reruns all frozen checks with their existing budgets, retains
the preceding collection, and records the Agent-authored reason separately
from the observed outcome. It cannot be used while a current Check is timed
out; the existing bounded timeout-retry path applies first.

Stetra does not persist Agent transcripts, every tool call, ordinary Hook
events, repeated identical collections, prompt caches, or data without a
decision-changing consumer.

## Handoff and decision

The default Handoff is a compact Agent-authored actual-change model. Optional
fields stay optional; the Agent does not fill empty arrays to satisfy ceremony.
Runtime adds mechanical Attention for current non-passing verification,
verifier changes, check-induced changes, unrepresentable changes, stale facts,
and declared concern gaps.

The Developer Decision Brief leads with four separate states:

```text
delivery | evidence | Agent recommendation | Human adoption
```

It then presents the intended and actual behavior, mechanism, material
invariants and failure paths, verification results, bounded unknowns, review
focus, and the exact pending Human choice. Raw logs, patches, IDs, and history
remain available through bounded inspection.
The same current-fact projection is used by Handoff, inspection, and Host
continuity. It includes exact task corrections in order, resolves review
references into changed paths and Check keys, and labels declared verification
coverage. A stale stored Handoff remains historical evidence and is not
presented as a current Decision Brief. A recorded Human decision remains bound
to its original facts when the worktree later changes.

## Persistence

Task state lives only below `.stetra/tasks/<taskId>/`. Canonical artifacts are
immutable and task projection is rebuildable from ordered key events.

Persist only:

- admitted Human request and explicit corrections or decisions;
- compiled Contract and baseline;
- Attempts, Fact Collections, patches, and non-empty bounded logs;
- Handoffs and Human Decisions.

Do not persist Drafts, Guides, Agent transcripts, ordinary context injection,
or unchanged duplicate facts. A generated Human view may be rebuilt from
canonical artifacts and is not authority.

Host session bindings under `.stetra/host-sessions/` store opaque session and
task identities only. During an admitted Begin they may retain the pending task
ID and compiled Contract fingerprint to recover publication followed by a
failed binding write. The task-directory rename is the publication point.
Hooks can recover this exact association without scanning for a recent task or
creating a task. Completed sessions may bind the next admitted task; an open
task cannot be silently replaced. This is operational session recovery, not
cross-task decision memory.

Schema `2` has no schema `1` translator, dual read/write path, or migration.
The pre-release Git history is sufficient archival access until real user data
proves a migration consumer.

## Package and API boundary

The workspace has two publishable packages:

- `@sovea/stetra-core` owns deterministic authority validation, Contract
  compilation, Fact validation, evidence ceilings, Handoff evaluation, and
  Decision binding.
- `@sovea/stetra` owns CLI IO, task sequencing, Git and Check collection,
  storage, presentation, project initialization, and Host adapters.

Core exposes exactly `compileDelegation` and `evaluateHandoff` as runtime
values. It does not read repositories, execute commands, know Host files,
format terminal output, or call an LLM.

## Anti-goals

Stetra is not:

- a Coding Agent, model router, ReAct loop, chat UI, or model SDK;
- a generic planner, task decomposer, scheduler, or multi-Agent orchestrator;
- a replacement for Trellis or provider-native implementation workflows;
- a repository wiki, prompt library, specification warehouse, transcript
  store, or broad project-memory system;
- a scalar trust, risk, readiness, confidence, complexity, or quality scorer;
- an automatic approver, deployment tool, PR bot, or cloud analytics service.

## Evolution and evidence gate

Evolution order is fixed by evidence, not feature completeness:

1. Prove the routine black-box path with packed packages and generated
   Codex/Claude adapters.
2. Prove that Runtime facts or a Cognitive Handoff improve a real review or
   adoption decision over a strong Markdown Skill and Trellis finish flow.
3. Add only the recovery and consequential-assurance mechanisms consumed by an
   observed failure mode.
4. Add another Host capability only after the provider-neutral port has a
   measured consumer.
5. Consider cross-task Decision Continuity last.

Every persistent field, event, lifecycle state, Host capability, and authoring
requirement must answer:

1. Which alignment, recovery, review, or adoption decision can it change?
2. Can the developer inspect that decision and distinguish authority from
   evidence?
3. Does it beat a simpler workflow in measured use?

Remove or defer it when the answer is not concrete.
