# resonant-code

`resonant-code` is a runtime layer for ai coding.

The project is aimed at a practical problem: AI can already generate high quality code. The harder problem is producing code changes that fit the current repository, respect engineering constraints, stay proportional to the task, and are easy for a human developer to review and trust.

resonant-code attempts to improve AI coding by constructing the following parts:

- **playbook guidance** — what the change should adhere to
- **local augment** — what are the preferences of the developers in projects
- **repository observations (RCCL)** — what are the truths and situations in the codebase now
- **runtime compilation** — how those inputs should be applied for a specific task

The outcome is a task-level packet with a structured **EGO** (Effective Guidance Object) for the agent and a **Decision Trace** for inspection and debugging.

## Installation

### Claude Code

```sh
# add marketplace
/plugin marketplace add sovea/cc-marketplace

# install plugin
/plugin install resonant-code@sovea
```

### Codex

Chat with Codex and ask it to install the plugin from the marketplace.

```sh
Fetch and follow instructions from https://raw.githubusercontent.com/Sovea/resonant-code/refs/heads/main/.codex/INSTALL.md to install resonant-code plugin.
```

## What it addresses

Code generation systems already handle syntax and local edits reasonably well. The harder part is making changes that are appropriate for the repository they are entering.

Typical failure modes are:

- changes that are technically valid but disproportionate to the task
- code that ignores local conventions or repository structure
- weak handling of legacy or compatibility boundaries
- reviews that produce generic feedback instead of repository-aware guidance
- implementation choices that are hard to explain after the diff already exists

resonant-code treats those as runtime and data-model problems, not just prompting problems.

## How it works

The runtime combines four inputs:

| Input | Role |
|---|---|
| **Built-in playbook** | Prescriptive engineering guidance |
| **Local augment** | Project-specific overrides and examples |
| **RCCL** | Verified observations about repository reality |
| **Task intent** | The current change request |

It compiles those inputs into a task-level packet whose current shape includes interpretation data, governance output, and cache metadata. The two main outputs are:

- **EGO** (Effective Guidance Object) — structured guidance the agent uses while coding
- **Decision Trace** — a record of what was activated, suppressed, or left in tension

A practical consequence of this design is that repository observations do not behave like a second pile of rules. They modify how guidance is executed in context, including cases where compatibility or legacy constraints require a `deviation-noted` posture instead of blind enforcement.

## Quickstart

```sh
# 1. Initialize local prescriptive guidance
/resonant-code:init

# 2. Analyze the repository and generate verified observational signals
/resonant-code:calibrate-repo-context

# 3. Compile task-time change guidance and code
/resonant-code:code <task description>
```

This flow currently produces these project artifacts:

- `.resonant-code/playbook/local-augment.yaml` — project-specific prescriptive guidance
- `.resonant-code/rccl.yaml` — verified repository observation signals
- `.resonant-code/playbook.lock.yaml` — lockfile feedback from completed guided tasks
- `.resonant-code/context/` — runtime sessions plus optional debug artifacts such as calibration reports and candidate files

> Suggested step: review, extend, and commit `.resonant-code/playbook/local-augment.yaml` so project-specific guidance becomes a durable repository asset.

## Current implementation

What is implemented today:

- `init` prepares a narrow strong-signal layer-selection prompt, lets the host choose only evidence-backed repo-specific playbook layers, then deterministically writes `.resonant-code/playbook/local-augment.yaml` and updates `.gitignore` for generated runtime cache artifacts.
- `calibrate-repo-context` prepares repository slices, generates RCCL candidates, verifies evidence statically, and writes authoritative output to `.resonant-code/rccl.yaml`.
- `code` is a thin runtime consumer with a default `auto` flow. Runtime plans required host-agent contracts, the host fulfills only those structured artifacts, and Runtime validates/adjudicates before compiling compact task guidance.
- The staged `prepare-interpretation` -> `prepare` -> `complete` flow remains available as an advanced/debug path.
- The runtime exports `compile`, `resolveTask`, and `evaluateGuidance` and writes lockfile feedback to `.resonant-code/playbook.lock.yaml`.
- The runtime also exports `planGuidance` and Runtime-owned guidance-planning contract helpers for low-friction contract orchestration.
- Interpretation supports both `deterministic-only` and `assistive-ai` modes.
- Task candidates and runtime sessions are written under `.resonant-code/context/`.
- Runtime compile cache artifacts are written under `.resonant-code/context/cache/runtime/`.
- Default completion without explicit adherence now writes low-pollution usage/context feedback instead of optimistically marking all directives as followed.

## Design constraints

A few constraints are central to the design:

- prescriptive guidance and repository observations stay separate in the data model
- RCCL observations are statically verified before they influence task-time guidance
- skills are runtime consumers and should not manually reconstruct policy resolution
- the generated packet should be structured and inspectable, not just prompt text
- task outcomes can be written back into a lockfile so guidance quality can be tracked over time

These constraints are intended to make the system easier to reason about, easier to review, and less dependent on ad hoc prompt behavior.

## License

MIT
