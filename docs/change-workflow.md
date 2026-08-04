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

## Project setup

`resonant-code init` generates a thin workflow for Codex, Claude Code, or both.
The generated files invoke the JSON CLI protocol and instruct the host agent;
they do not contain a second policy or evaluation engine.

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
- optional exact repository evidence windows;
- explicit argv check definitions, or a concrete no-command rationale;
- an optional unresolved material fork.

Each check includes an ID, rationale, timeout, source, and separate paths for
files that define the command and files that define what passing means. The
CLI resolves the top-level executable before creating a run. This preflight
does not claim nested modules, services, or other runtime prerequisites are
available.

Prepare compiles the Semantic Contract, captures the complete Git worktree
baseline, and freezes the selected checks. Synthetic Git objects used for
capture stay under the task run rather than modifying repository object
metadata.

Prepare can return:

| Status | Meaning | Run created |
|---|---|---|
| `delegation-compiled` | Contract and verification are runnable | Yes |
| `semantic-decision-required` | A material long-lived choice remains unresolved | No |
| `verification-required` | Neither executable checks nor an adequate no-command rationale were supplied | No |
| `authority-invalid` | Event, basis, or authority references are invalid | No |

The compact result includes the compiled contract decision surface and the run
ID. Full canonical state is stored in the run.

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
captures the complete baseline-to-current worktree change. The order matters:
the facts describe the check results and repository state from the same
collection.

The resulting Fact Bundle contains:

- changed paths and add, modify, delete, or rename operations;
- before/after file kind, mode, and digest;
- a complete patch when text changes are representable;
- explicit binary or metadata-only facts otherwise;
- `passed`, `failed`, or `unavailable` check outcomes;
- exact argv, exit code, complete stdout/stderr digests, bounded log references,
  and truncation state;
- command-definition and acceptance-surface mutations with affected check IDs;
- one collection identity.

Persisted stdout and stderr are capped independently at 1 MiB. Their digests
cover the complete streams, and empty streams create no log file.

Collect writes or resets `handoff.json`. If the agent repairs the code after a
collection, it runs collect again; the new Fact Bundle replaces the prior one
for that run.

## 3. Write the handoff

The host reads the complete collected patch and check facts before filling
`handoff.json`. The semantic input contains:

- `systemMeaningUpdate`;
- applicable `materialClaims`;
- `residualUnknowns`;
- a consequence-directed `reviewMap`;
- optional material alternatives.

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
`unverified`.

Residual unknowns state why they matter and provide a concrete validation or
takeover path. Contradicted, partial, or unverified critical claims and material
unknowns must appear in `must-read` or `unresolved` Review Map entries.

## 4. Finalize

```sh
resonant-code change finalize . --run <run-id> --json
```

Finalize first checks whether the worktree still matches the collected facts.
It returns `facts-stale` before reading or evaluating the handoff if any
post-collection edit is present.

For current facts, Core validates handoff structure, exact evidence references,
mechanical contradictions, critical falsification, unknown coverage, and
Review Map coverage. It does not decide whether the agent's semantic reasoning
is correct.

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
separately labeled agent evidence and cannot be added to runtime facts.

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
`-- checks/                   # non-empty bounded streams only
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

- [`packages/core/src/delegation/types.ts`](../packages/core/src/delegation/types.ts)
- [`packages/core/src/facts/types.ts`](../packages/core/src/facts/types.ts)
- [`packages/core/src/handoff/types.ts`](../packages/core/src/handoff/types.ts)

CLI input validation lives in
[`packages/cli/src/schemas/delegation.ts`](../packages/cli/src/schemas/delegation.ts),
and the generated end-to-end authoring example lives in
[`packages/cli/src/adapters/templates.ts`](../packages/cli/src/adapters/templates.ts).
These sources, rather than duplicated full JSON schemas in prose, define exact
field shapes.
