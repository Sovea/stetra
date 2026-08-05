# Change workflow

This document describes the current `semantic-delegation` protocol implemented
by `@sovea/resonant-code`. It is a reference for developers integrating the CLI
and for contributors changing lifecycle behavior.

The normal coding path is:

```text
prepare -> agent implementation -> collect -> agent handoff -> finalize
```

`change explain` is an inspection command used only when the compact stage
output is insufficient.

Every stage result includes a structured `hostAction` instead of a prose
next-step field. Its shape is deliberately small:

```json
{
  "kind": "implement-and-collect",
  "reference": "routine",
  "reason": "why this is the next bounded action",
  "command": {"argv": ["resonant-code", "change", "collect", ".", "--run", "<run-id>", "--json"]}
}
```

`command` is absent when the next action is a Human decision or review rather
than a CLI operation. `reference` is `routine`, `assurance`, `recovery`, or
`null`. It is an idempotent ensure-loaded instruction: read the named page when
it is absent from the current Host context, but do not reread an unchanged page
already loaded for the task. A fresh or resumed context reads it again. The
reference does not add a run mode, state, or semantic decision.

## Project setup

`resonant-code init` generates a thin workflow for Codex, Claude Code, or both.
The generated files invoke the JSON CLI protocol and instruct the host agent;
they do not contain a second policy or evaluation engine.

The generated skill progressively discloses four reference pages:

- `change.md` for alignment and prepare;
- `routine.md` for a Runtime-selected routine implementation and minimal
  handoff;
- `assurance.md` for standard/critical claims, challenge, and review coverage;
- `recovery.md` for timeout, unavailable, failed, stale, rejected, or attention
  outcomes.

The Host reads `change.md` initially and then ensures that only the exact page
named by `hostAction.reference` is available. It does not reload that page in a
continuous context, infer the profile, or skip lifecycle stages.

`resonant-code status` reports installation state. `doctor --strict` turns
blocking installation or ownership issues into a failing process result.

Project initialization owns only:

- `.resonant-code/manifest.json`;
- generated files under `.agents/skills/resonant-code/` and/or
  `.claude/skills/resonant-code/`;
- marked pointer blocks in `AGENTS.md`, `CLAUDE.md`, and `.gitignore`.

Owner-modified generated content is not overwritten unless the caller
explicitly forces the operation. Unknown or obsolete project artifacts are
reported with their exact paths and are never automatically migrated or
deleted.

## 1. Prepare

```sh
resonant-code change prepare . --input - --json
```

The host sends transient JSON on stdin. A prepare input located inside the
project worktree is rejected so protocol data cannot appear in the collected
change.

The input identifies the `semantic-delegation` protocol and supplies:

- exact developer task or decision events;
- basis-bearing values for outcome, constraints, non-goals, focus, and
  consequence;
- an explicit assurance-dimension list whose declared entries have a basis,
  material or adoption-critical criticality, and a concrete adoption
  rationale;
- optional exact repository evidence windows;
- explicit argv check definitions, or a concrete no-command rationale;
- an optional unresolved material fork.

Each check includes an ID, rationale, source, and separate paths for files that
define the command and files that define what passing means. A timeout is not
part of the Semantic Contract or frozen check identity. The CLI resolves the
top-level executable before creating a run. This preflight does not claim
nested modules, services, or other runtime prerequisites are available.

Consequence is adoption impact, not implementation complexity. The host does
not derive it or assurance dimensions from file counts, diff size, dependency
counts, or keywords. Core compiles the explicit input into an Assurance Plan:

| Profile | Prepare requirement |
|---|---|
| `routine` | `low` consequence and an empty `assuranceDimensions` array |
| `standard` | `medium` consequence with at least one dimension, or any material dimension |
| `critical` | `high` consequence with at least one adoption-critical dimension, or any adoption-critical dimension |

The compact prepare result exposes the profile and every exact requirement.
Missing medium/high requirements make the contract invalid and create no run.

Prepare compiles the Semantic Contract, captures the complete Git worktree
baseline, and freezes the selected checks. Synthetic Git objects used for
capture stay under the task run rather than modifying repository object
metadata.

Prepare can return:

| Status | Meaning | Run created |
|---|---|---|
| `prepared` | Contract and verification are runnable | Yes |
| `semantic-decision-required` | A material long-lived choice remains unresolved | No |
| `verification-required` | Neither executable checks nor an adequate no-command rationale were supplied | No |
| `authority-invalid` | Event, semantic, assurance, basis, or authority structure is invalid | No |

The compact result includes the compiled semantic values with their exact
bases, authority and repository-evidence IDs, Assurance Plan, verification
definitions, run ID, and a `hostAction`. It does not repeat Human Event content,
interpretation identities, evidence digests, or the constant authorization
text. Full canonical state is stored in the run and remains available through
`change explain --section contract`.

## 2. Implement and collect

The task authorizes the host agent to investigate, edit, test, diagnose, and
safely repair within the compiled meaning. Focus paths do not restrict
necessary adjacent changes. A newly discovered long-lived semantic choice must
be resolved before continuing.

After implementation:

```sh
resonant-code change collect . --run <run-id> --json
```

Collect executes every frozen check as an argv array without a shell, then
captures the complete baseline-to-current worktree change. The CLI owns a
300,000 ms initial timeout budget. When repository or environment evidence
establishes a different budget, the host may set it for a full collection:

```sh
resonant-code change collect . --run <run-id> --timeout-ms <milliseconds> --json
```

The budget is recorded on the resulting attempt but does not change contract
identity. The order matters: the facts describe the check attempts and
repository state from the same collection.

The resulting Fact Bundle contains:

- changed paths and add, modify, delete, or rename operations;
- before/after file kind, mode, and digest;
- a complete patch when text changes are representable;
- explicit binary or metadata-only facts otherwise;
- ordered attempts for each check, each with its timeout budget, timeout marker,
  `passed`, `failed`, or `unavailable` outcome, and exit code;
- exact argv, exit code, complete stdout/stderr digests, bounded log references,
  and truncation state;
- command-definition and acceptance-surface mutations with affected check IDs;
- one collection identity.

Persisted stdout and stderr are capped independently at 1 MiB. Their digests
cover the complete streams, and empty streams create no log file.

The collect packet contains the latest outcome and stream sizes needed for the
next decision. A passing check with one attempt omits its log paths from this
compact packet; failed or unavailable checks and any multi-attempt history keep
their relevant log paths visible. Canonical attempt facts and logs remain in
the run.

Collect writes or resets `handoff.json`. If the agent repairs the code after a
collection, it runs normal collect again; the new Fact Bundle replaces prior
attempts and reruns every check against the new worktree. The collect packet
repeats the frozen Assurance Plan so the host does not reconstruct its
obligations from the original input.

If the latest attempt actually timed out, the host may retry only that check in
the same run with a strictly larger budget:

```sh
resonant-code change collect . --run <run-id> \
  --retry-check <check-id>=<larger-milliseconds> --json
```

This is still the collect stage. It requires an unchanged worktree, appends an
attempt, preserves earlier output facts, creates a new collection identity, and
resets the handoff. Multiple `--retry-check` options may retry multiple current
timeouts. Completed failures and non-timeout unavailability cannot use this
path. Do not run the command directly outside Runtime: that result cannot
replace the collected attempt.

## 3. Write the handoff

The host reads the complete collected patch and check facts before filling
`handoff.json`. The semantic input contains:

- `systemMeaningUpdate`;
- applicable `materialClaims`;
- `residualUnknowns`;
- a consequence-directed `reviewMap`;
- optional material alternatives.

For a routine plan with no declared requirement, `materialClaims` and
`reviewMap` may both be empty. The system-meaning update and all Runtime facts
remain mandatory presentation surfaces. Every compiled assurance dimension
requires a claim with the same dimension. An adoption-critical requirement
requires an adoption-critical claim.

Claims select evidence using exact changed paths, check IDs, repository
evidence IDs, developer event IDs, or the whole patch. They do not restate
changed-file operations, check outcomes, collection identity, or other machine
facts.

Each material claim identifies one basis:

- `repository-evidence`;
- `agent-judgment`;
- `human-decision`;
- `unverified`.

A passing check can support an agent conclusion but does not change its basis
to a runtime fact.

Every adoption-critical claim based on agent judgment, repository evidence, or
an unverified premise includes a falsification result. It records a concrete
failure hypothesis, the attempt made to find that failure, supporting and
counter evidence, and one of `supported`, `contradicted`, `partial`, or
`unverified`. Every adoption-critical claim also appears in a `must-read` or
`unresolved` Review Map entry, including a supported claim added by the host
after implementation.

Residual unknowns state why they matter and provide a concrete validation or
takeover path. Material unknowns must appear in `must-read` or `unresolved`
Review Map entries.

The effective obligations are the union of the compiled plan, collected fact
conditions, and host-disclosed adoption-critical claims or unknowns. Failed or
unavailable checks, changed verifier surfaces, and unrepresentable changes can
therefore raise a routine task's review requirement. Nothing in the handoff can
downgrade those facts or the fixed authority and currency checks.

## 4. Finalize

```sh
resonant-code change finalize . --run <run-id> --json
```

Finalize first checks whether the worktree still matches the collected facts.
It returns `facts-stale` before reading or evaluating the handoff if any
post-collection edit is present.

For current facts, Core validates handoff structure, exact evidence references,
mechanical contradictions, monotonic timeout-attempt history, critical
falsification, unknown coverage, and Review Map coverage. Evaluation uses the
latest attempt while earlier timeouts remain inspectable. It does not decide
whether the agent's semantic reasoning is correct.

| Status | Meaning |
|---|---|
| `handoff-ready` | The evidence package is ready for developer review |
| `needs-attention` | Evidence, verification, or a critical conclusion still needs a stated action or direct review |
| `rejected` | A configured check failed or a critical claim is contradicted |
| `facts-stale` | The repository changed after collection and must be collected again |

Every current-fact result includes structured attention where applicable. An
attention item states the cause, adoption impact, exact references, and a
recollect, repair, evidence, direct-review, or validation action. The Review
Map remains a separate inspection order.

Completed JSON results include one CLI-rendered `presentationMarkdown`. A host
adapter relays it unchanged. Any extra investigation added by the host remains
separately labeled agent evidence, cannot be added to runtime facts, and adds
only task-requested observations absent from the rendered handoff. It does not
repeat changed paths, checks, system meaning, or the adoption notice.

A clean routine result is rendered as a short evidence-first handoff: exact
changed paths and operations, passing check IDs with their one-attempt exit
facts, an explicitly Agent-authored system-meaning update, absence of
claims/unknowns/direct-review needs, and the Human adoption notice. Collected
facts are not labeled adoption evidence. The full handoff is retained whenever
a requirement, claim, unknown, alternative, attention, Review Map entry,
changed verifier surface, non-text change, or multiple check attempt exists.
This presentation choice is derived at finalize time and is not persisted as
another mode.

`handoff-ready` never records or implies adoption.

## Explain

Canonical details remain available without expanding every normal lifecycle
packet:

```sh
resonant-code change explain . --run <run-id> --section contract --json
resonant-code change explain . --run <run-id> --section facts --json
resonant-code change explain . --run <run-id> --section handoff --json
resonant-code change explain . --run <run-id> --section evaluation --json
resonant-code change explain . --run <run-id> --section presentation --json
```

## Run storage and recovery

One runnable task uses one directory:

```text
.resonant-code/runs/<runId>/
|-- run.json
|-- handoff.json
|-- change.patch              # when a representable patch exists
`-- checks/                   # non-empty bounded streams keyed by attempt
```

The states are `prepared`, `facts-collected`, and `completed`. Only whole
completed runs are eligible for retention cleanup; prepared and facts-collected
runs remain recoverable. The current CLI retains the newest 50 completed runs.

Task runs record CLI/Core package identity, not an absolute installation path,
and are never reused as authoritative state for another task.

## Public implementation surfaces

Core exports two runtime values:

```ts
compileDelegation(input)
evaluateHandoff(input)
```

Their public TypeScript contracts live in:

- [`packages/core/src/assurance/types.ts`](../packages/core/src/assurance/types.ts)
- [`packages/core/src/delegation/types.ts`](../packages/core/src/delegation/types.ts)
- [`packages/core/src/facts/types.ts`](../packages/core/src/facts/types.ts)
- [`packages/core/src/handoff/types.ts`](../packages/core/src/handoff/types.ts)

CLI input validation lives in
[`packages/cli/src/schemas/delegation.ts`](../packages/cli/src/schemas/delegation.ts),
and the generated end-to-end authoring example lives in
[`packages/cli/src/adapters/templates.ts`](../packages/cli/src/adapters/templates.ts).
These sources, rather than duplicated full JSON schemas in prose, define exact
field shapes.
