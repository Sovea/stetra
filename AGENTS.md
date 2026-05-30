# AGENTS.md

## Project Background

`resonant-code` is an AI coding governance/runtime layer for code changes.

Its job is not to build a repository wiki, a general knowledge base, or another agent wrapper full of static rules. Its job is to help coding agents generate, modify, and review code in a way that is:

- aligned with contextual engineering best practice instead of generic best practice
- aligned with project-level principles and durable local decisions
- aware of current repository reality without blindly inheriting it
- stable, explainable, reviewable, and reusable across tasks

The core problem this project addresses is the gap between:

- code that is merely plausible
- code that a developer or team actually wants to adopt and keep

Common failure modes this project tries to reduce:

- overengineering
- unnecessary rewrites
- poor fit with local repository structure and conventions
- generic or style-less output
- poor proportionality to the task
- review output with too much noise and weak judgment
- weak decision transparency before and during code generation


## Design Philosophy

The product philosophy is contract-first deterministic governance.

resonant-code should let capable host agents contribute judgment, interpretation, and semantic matching, but only through explicit Runtime/RCCL-owned contracts. Host agents may propose; Runtime and RCCL validate, normalize, adjudicate, trace, and write bounded feedback.

The important distinction is:

- Host agents provide assistive structured artifacts.
- Runtime/RCCL own the schema, allowed IDs, validation rules, merge policy, verification gates, diagnostics, and feedback writes.
- Skills orchestrate the lifecycle but must not become alternative policy engines.
- Developers inspect structural outputs, not raw prompt improvisation.

The long-term target is not merely more AI. The target is more useful host-agent capability with stable boundaries: the host agent can help more completely, while deterministic systems remain accountable for every decision that affects guidance.

## AI Contract Layer Design Rationale

The contract-first approach addresses three limitations of pure deterministic heuristics:

1. Engineering heuristics have an accuracy ceiling (lexical token matching cannot detect cross-concept semantic relations)
2. Signal quality requires contextual judgment (risk level, compatibility requirements, and migration phase are not derivable from syntax alone)
3. Abstract semantic capability is needed for relating prescriptive rules to observational reality (a directive about "composition over inheritance" and an observation about "heavy inheritance in services/" require semantic understanding to connect)

The AI Contract Layer injects host-agent semantic capability into the deterministic pipeline in a structured, validated, traceable way.

### Design Tradeoffs Against Alternatives

| Approach | Tradeoff |
|----------|----------|
| Pure text skills (prompt concatenation) | No quality gates, no intermediate validation, no feedback accumulation |
| Direct LLM API calls inside Runtime | Loses host agent's conversation context, task understanding, and tool capabilities (file reading, code search) |
| Unstructured host output (free-form text back to runtime) | Cannot be deterministically validated, normalized, or adjudicated |

The contract approach is chosen because it:

- Preserves runtime decision authority (validation, adjudication, and feedback remain deterministic)
- Utilizes the host agent's full capabilities (its understanding of the current task context, its access to the codebase via tools, its semantic reasoning)
- Produces auditable, cacheable, accumulable artifacts (proposals are inspectable, diagnostics are traceable, lockfile signals compound across tasks)

### How Contracts Extend Beyond Heuristics

The deterministic runtime provides a baseline through structural matching (`semanticKeysOverlap`, `categoryRelated`, trait inference). This baseline catches obvious relations but misses nuanced ones.

Contracts upgrade signal quality without abandoning determinism:

- `task-model` contract: host provides evidence-backed field-level understanding of operation, risk, scope, context, alternatives, and uncertainties that keyword extraction cannot reliably infer
- `semantic-governance-graph` contract: host proposes evidence-backed directive/observation/task/feedback edges with relation, impact, execution intent, and review priority, replacing separate relation and shortlist tracks
- `adherence-evidence` contract: host reports evidence-backed followed/ignored/partial/unverified verdicts after implementation, so uncovered directives are recorded as unverified instead of optimistically followed
- `governance-evolution-proposal` contract: host may propose review-only playbook or RCCL evolution from repeated evidence signals, but Runtime/RCCL never auto-write those proposals as authoritative truth

In every case, the host's proposal passes through deterministic adjudication (scope gates, verification gates, lifecycle gates, confidence thresholds) before influencing the compiled output. The contract is the structured injection channel; adjudication is the quality guarantee.

### Relationship Between Deterministic Core and Contract Layer

These two layers are complementary:

- Deterministic Core defines the decision space (what execution modes exist, what adjudication rules apply, what feedback signals are valid)
- AI Contract Layer fills the decision space with higher-quality signals (semantic relations that heuristics miss, contextual interpretations that keywords cannot capture)

Without the Deterministic Core, host output would be unvalidated prose. Without the AI Contract Layer, the system is limited to the accuracy ceiling of lexical matching and hardcoded trait tables.

## Core Architecture

The product is organized around five cooperating parts:

1. Built-in playbook
2. Local project augment
3. RCCL (Repository Context Calibration Layer)
4. Runtime
5. Lockfile feedback loop

The implementation is governed by a four-layer execution architecture:

1. Deterministic Core
   - Runtime and RCCL compile, verify, merge, adjudicate, trace, and write bounded feedback.
   - This layer owns all authoritative decisions.
2. AI Contract Layer
   - Runtime/RCCL expose typed contracts, schemas, allowed IDs, artifact expectations, validation, normalization, and diagnostics.
   - This layer is the only valid way for host-agent output to enter deterministic processing.
3. Internal Skill / Host-Agent Workflow Layer
   - Internal skill code performs orchestration, filesystem IO, session writing, and host handoff sequencing.
   - It may load artifacts and call Runtime/RCCL APIs, but it must not reconstruct playbook, semantic merge, or verification policy.
4. Public Skill Layer
   - Public commands remain stable and thin.
   - They parse user flags, call internal workflows, and print compatible JSON output.

The system is designed so that:

- `init` prepares local prescriptive guidance
- `calibrate-repo-context` prepares verified repository observation signals
- Runtime compiles all relevant inputs into a task-level change decision packet
- `code`, `review`, and similar skills are runtime consumers, not alternative rule engines
- host-agent artifacts are accepted only through Runtime/RCCL-owned contracts
- runtime feedback is written back into a lockfile quality loop

Runtime is not the final artifact.
Runtime is the deterministic compile-and-decision mechanism.
Its task-level artifact is a change decision packet whose primary views are:

- `EGO` (Effective Guidance Object) for the agent
- `Decision Trace` for developers and debugging

This framing matters: the system is not trying to hand an agent a pile of text rules. It is trying to compile the right decision context for a specific change before implementation begins.


## Host-Agent Contract Lifecycle

Host-agent capability should be used through a full contract fulfillment lifecycle:

1. Runtime or RCCL issues a contract.
2. The host agent may fulfill the contract by writing a structured artifact.
3. Runtime or RCCL loads the artifact through a deterministic parser.
4. The artifact is validated and normalized against Runtime/RCCL-owned expectations.
5. Invalid, malformed, low-confidence, unsupported, or out-of-policy entries are rejected, downgraded, or marked unused with structured diagnostics.
6. Accepted entries are still only proposals; deterministic Runtime/RCCL adjudication remains authoritative.
7. Decision Trace, session records, and output JSON expose bounded diagnostics about what was provided, accepted, rejected, downgraded, or unused.
8. Feedback writes remain bounded enums/counts/flags and must not persist raw host prose as authoritative truth.

Supported contract families include:

- agent capability profiles
- task models
- semantic governance graphs
- adherence evidence
- governance evolution proposals
- RCCL observation generation, refresh, counterexample, and semantic-equivalence proposals

Host artifacts should be treated as assistive inputs, not policy. A valid artifact can influence deterministic compilation; it cannot bypass deterministic compilation.

## Playbook Compiler Runtime - Target Design

The target Runtime is a deterministic governance runtime for AI-driven code changes.
It compiles prescriptive guidance, verified repository observations, task intent, context profile, host proposal diagnostics, and feedback signals into a task-level change decision packet.

Prescriptive signals and observational signals must remain hard-separated in the data model:

- Playbook is prescriptive
- RCCL is observational

The runtime should produce controlled tension between them instead of letting an LLM improvise trade-offs ad hoc.
This separation is a core governance constraint, not an implementation detail.

### Layered Playbook Layout

Playbook is organized conceptually by physical layers. In the current implementation, built-in playbook files live under `plugins/resonant-code/playbook/`, and project-local prescriptive guidance is written to `.resonant-code/playbook/local-augment.yaml`.

Target layered layout:

```text
.playbook/
  core.yaml
  languages/
  frameworks/
  domains/
  local-augment.yaml
```

Target layer priority:

`core > languages > frameworks > domains > local`

`weight` only fine-tunes within the same layer.
It must never let a `should` outrank a `must`, and must never cross layer priority.

### Directive Model

Each directive is the atomic compile unit.
The design assumptions for directives are:

- globally stable `id`
- explicit `type`
- explicit `scope`
- explicit `prescription`
- explicit `weight`
- rationale and exceptions are first-class
- examples are mandatory for taste grounding

Important invariants:

- directive `id` must be globally unique and stable
- `prescription` is an enum and is a hard contract
- `weight` is a discrete tier, not a free numeric score
- examples are an array and must support multiple scenarios
- directives should not contain internal condition branching

### RCCL Design

RCCL is not a wiki and not a full summary.
It only stores observation signals that materially affect code generation, code modification, or review quality.

Each observation must contain:

- stable `id`
- `category`
- `scope`
- `pattern`
- `confidence`
- `adherence_quality`
- non-empty `evidence`
- runtime-owned `verification`

Verification is a hard requirement for trust.
LLM self-confidence alone is not trusted.

RCCL prepare may emit a host-agent observation-generation contract, but RCCL commit remains the deterministic parser, consolidation, verification, and write boundary.

### RCCL Verify Gate

Verify Gate is static and must not call an LLM.
It checks:

- file existence
- valid line range
- snippet similarity against the actual source

Expected disposition behavior:

- fully verified observations stay trusted
- partially verified observations keep reduced confidence
- failed or unverifiable observations are demoted to ambient

Demotion is preferred over hard deletion because the pattern may still be real outside sampled evidence.

### Runtime Pipeline

The target pipeline is:

1. `Intent Parse`
2. `Layer Filter`
3. `RCCL Verify Gate`
4. `Semantic Merge`
5. `EGO Assembly`

Pipeline expectations:

- Runtime owns parsing and merge logic
- Runtime owns contract validation and proposal normalization
- skills must not manually interpret raw playbook YAML as a substitute
- skills must not manually reconstruct semantic merge policy
- the final output must be deterministic enough to diff and reason about

### Intent Parse

Target `TaskIntent` fields:

- `operation`
- `target_layer`
- `tech_stack`
- optional `target_file`
- optional `tags`

Longer-term, task intent should compose with a small, explicit context profile so the runtime can compile contextual best practice instead of generic advice. Typical dimensions include:

- `project_stage`
- `change_type`
- `optimization_target`
- `hard_constraints`
- `allowed_tradeoffs`
- `avoid`

The long-term design allows LLM-based structured parse with caching.
If implemented with heuristics first, keep the contract stable so it can be upgraded later.

### Semantic Merge

Target merge rules:

- local override beats built-in for the same semantic directive
- verified RCCL can reinforce a directive
- verified RCCL can create tension when repository reality conflicts with the directive
- demoted RCCL can only contribute ambient context
- anti-pattern observations can suppress patterns

In the full design, semantic conflict detection should use embeddings instead of category-only matching.

### Execution Modes

RCCL does not compete on the same score axis as directives.
It determines how rules should be executed in this repository context.

Target execution modes:

- `enforce`
- `deviation-noted`
- `ambient`
- `suppress`

`deviation-noted` is especially important:
it means "follow the rule for new work, but account for the current repository reality at interfaces and compatibility boundaries."

### Change Decision Packet

The runtime should produce a task-level change decision packet.
That packet is the primary artifact for a single change and should make it possible to understand what the runtime decided before implementation proceeds.

Its core views are:

- `EGO` for the agent-facing executable guidance
- `Decision Trace` for the developer-facing explanation and audit trail

Longer-term, the packet may also explicitly carry task context, activated guidance, repository tensions, and review focus points, but the current architectural minimum is EGO plus Decision Trace.

### EGO Output

The target agent-facing compiled object contains:

- `must_follow`
- `avoid`
- `context_tensions`
- `ambient`

This output should be structural and stable, not ad hoc prompt text.

### Decision Trace

Decision Trace is a first-class output, not optional debugging sugar.
It should record:

- which layers were applied or skipped
- RCCL verification outcomes
- merge or suppression outcomes
- final EGO section counts and budget behavior

### Lockfile and Quality Flywheel

The project explicitly wants a first-version quality loop.

Runtime should write execution quality to a lockfile. In the current implementation that file is:

`.resonant-code/playbook.lock.yaml`

The conceptual role remains the same as the earlier `.playbook.lock.yaml` framing.

The lockfile should track:

- followed count
- ignored count
- follow rate
- trend
- breakdown by task type
- last seen

This is not optional decoration. It is the feedback side of the governance loop: task-time change decisions should leave behind quality signals that help evolve playbook guidance over time instead of forcing the same human corrections to repeat forever.

## Current Roadmap Model

The intended user flow is:

1. Run `init`
2. Run `calibrate-repo-context`
3. During a concrete coding/review task, Runtime compiles a change decision packet from:
   - built-in playbook
   - local augment
   - RCCL
   - task intent
4. Agent consumes the compiled `EGO`
5. Developers can inspect the `Decision Trace`
6. Runtime writes feedback to the lockfile

At a product level:

- `init` creates local prescriptive guidance
- `calibrate-repo-context` creates observational guidance with verify gate
- Runtime is invoked at task time as the decision compiler
- `code` / `review` are runtime consumers, not alternative rule engines
- lockfile feedback closes the loop between execution and future guidance quality

## Runtime Implementation Guidance

Runtime should be treated as a plugin-level subsystem, not as one more skill script.

Preferred structure:

```text
plugins/resonant-code/runtime/
  src/
  dist/
```

Recommended engineering rules:

- implement Runtime in TypeScript
- compile it to runnable ESM output
- expose a narrow public API
- keep skills thin
- do not let skills import Runtime internals directly

Desired public entrypoints:

- `compile(input)`
- `evaluateGuidance(input)`

Skills should call Runtime, not reimplement any part of the pipeline themselves.

## Current Implementation Status

The repository currently includes:

- built-in playbook files under `plugins/resonant-code/playbook/`
- `init` skill writing `.resonant-code/playbook/local-augment.yaml`
- `calibrate-repo-context` skill writing `.resonant-code/rccl.yaml`
- static RCCL verify gate in the calibration flow
- a first-pass TypeScript Runtime under `plugins/resonant-code/runtime/`

Current runtime state:

- TypeScript source lives in `plugins/resonant-code/runtime/src/`
- build output lives in `plugins/resonant-code/runtime/dist/`
- build currently uses `tsdown` to emit the Runtime ESM dist under `runtime/dist/`
- Runtime exposes compile and lockfile feedback entrypoints

Current first-pass Runtime covers:

- type models
- deterministic intent parse
- built-in/local/RCCL loading
- RCCL verification consumption
- basic layer filtering
- deterministic EGO assembly
- decision trace generation
- lockfile feedback writing
- interpretation provenance in the compiled packet
- runtime exports for `compile`, `resolveTask`, and `evaluateGuidance`

Current skill/runtime behavior that already exists:

- `code` supports `prepare-interpretation`, `prepare`, and `complete`
- task modeling can use host-agent `task-model` artifacts, with deterministic fields marked as defaulted fallback
- task models are written under `.resonant-code/context/task-models/code/`
- semantic governance graphs are written under `.resonant-code/context/semantic-governance-graphs/code/`
- adherence evidence is written under `.resonant-code/context/adherence-evidence/code/`
- runtime sessions are written under `.resonant-code/context/runtime-sessions/code/`
- calibration emits report, slice-plan, candidate, and consolidation artifacts under `.resonant-code/context/` only when debug artifacts are explicitly enabled
- `init` updates `.gitignore` to ignore `.resonant-code/context/cache/`

Current limitations that should be understood before extending:

- deterministic intent parse remains fallback/recall; `task-model` is the primary host-agent semantic channel for task understanding
- semantic merge still uses structural recall internally, but host semantic judgment enters through `semantic-governance-graph`
- cache keys exist, but full cache storage and invalidation are not complete
- layer filtering and merge should continue moving toward the full target design above
- RCCL v2 contracts include evidence refs, counterexamples, and semantic equivalence proposals, but final consolidation and demotion remain static verification boundaries
- adherence feedback now requires `adherence-evidence`; uncovered directives are recorded as `unverified` and do not update follow rate

These limitations are contract-layer maturation gaps, not architecture changes.
Each gap above corresponds to a contract lifecycle that needs implementation (issue → fulfill → validate → adjudicate → trace → feedback).
Do not treat them as the intended final design.

## Non-Negotiable Quality Constraints

When evolving this project, do not regress to these anti-patterns:

- raw prompt concatenation instead of compiled structural guidance
- skill-specific manual parsing of playbook data
- trusting raw RCCL without verification or disposition handling
- omitting Decision Trace
- treating lockfile or quality feedback as optional decoration

The long-term success condition is not "Runtime exists".
It is:

- Runtime is deterministic enough to inspect
- Runtime is useful enough that multiple skills can rely on it
- Runtime keeps improving through verified repository context and quality feedback
