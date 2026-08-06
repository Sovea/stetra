# Stetra

**Let the agent implement. Keep the thread and the final say.**

Stetra is an engineering harness for coding agents, designed to keep
the engineering thread intact when implementation is delegated.

It connects developer intent, Runtime-collected repository and verification
facts, Agent execution and explanation, and the Human adoption decision in an
inspectable engineering loop.

Its objective is to reduce the total cost from a developer request to a
confident adoption decision without weakening the developer's system
understanding or engineering judgment.

## Why it exists

A coding task is not finished when an agent produces a plausible patch. The
developer still needs to know:

- what behavior or invariant actually changed;
- whether the implementation fits the repository and the requested tradeoffs;
- what the checks established and what they did not;
- which conclusions are observed facts and which are agent judgment;
- what remains uncertain and where direct review is worth the time.

Ordinary agent transcripts make that reconstruction expensive. Stetra
wraps a coding task with a small deterministic protocol so the implementation
and its handoff are tied to the same task meaning and actual change.

## Workflow

```text
Developer request and material decisions
                  |
                  v
          Semantic Contract
                  |
                  v
 agent investigation, implementation, repair
                  |
                  v
              Fact Spine
                  |
                  v
          Cognitive Handoff
                  |
                  v
    Developer review and adoption decision
```

The generated host workflow runs three commands around a normal coding change:

```sh
stetra change prepare . --input - --json
stetra change collect . --run <run-id> --json
stetra change finalize . --run <run-id> --json
```

- `prepare` compiles the task's Semantic Contract and proportional Assurance
  Plan, freezes checks, and captures the pre-change worktree.
- `collect` runs those checks and records the complete actual change plus every
  ordered check attempt. Execution timeout is a collect-time budget, not part
  of task meaning; a timed-out check can retry with a larger budget in the same
  run without hiding the first attempt.
- `finalize` binds the agent's explanation, counterevidence search, unknowns,
  and Review Map to the collected facts.

The successful status is `handoff-ready`: ready for developer review, never
automatically adopted. Failed checks, stale facts, contradictions, and missing
evidence remain visible and actionable.

Exact contract, fact, handoff, evaluation, and review-packet data is available
on demand through `stetra change explain`.

Finalize returns a structured `handoffPacket` that keeps the Semantic
Contract, Runtime facts, Agent-authored handoff, and evaluation separate. The
Host renders that source data in the current conversation language. Paths,
IDs, statuses, commands, numeric facts, quoted evidence, and collected output
remain exact. Runtime therefore does not need a locale field or one hard-coded
translation table per supported language.

## Dynamic Host projection

Runtime keeps the same deterministic `prepare -> collect -> finalize` kernel,
but the generated Host workflow no longer loads one fixed instruction bundle.
Each stage returns a structured `hostAction` with the next argv command and at
most one reference: routine, assurance, or recovery. The Host progressively
loads only that page.

This removes fixed protocol reading from routine work without delegating path
selection to the agent. The Assurance Plan and actual facts select the
projection. Any requirement, failed or unavailable check, retry history,
verifier change, non-text file, unknown, critical claim, or attention
condition expands the path again. A clean routine completion may collapse
empty review sections, while canonical detail remains inspectable in the task
run.

## Proportional assurance

The lifecycle stays fixed, but handoff cost follows adoption consequence.
Low-consequence routine work can finish with a concise system-meaning update
and Runtime facts. Standard work must cover each declared material dimension.
Critical work adds adoption-critical claims, applicable falsification, and
direct-review surfaces. Failed or unavailable checks, verifier changes,
unrepresentable changes, unknowns, and newly discovered critical claims can
only raise those requirements.

The plan is compiled from explicit, basis-bearing consequence and dimension
interpretations. It is not inferred from diff size, file count, keywords, or a
numeric complexity score.

## Architecture

The long-term design is three task cores and one loop:

1. **Semantic Contract** — what this change is intended and authorized to mean.
2. **Fact Spine** — what the workflow observed before and after implementation.
3. **Cognitive Handoff** — what the actual change means, what remains unknown,
   and where review has the highest value.
4. **Decision Continuity** — how adopted decisions and observed outcomes may
   reduce repeated semantic work in later tasks.

The current implementation closes one task-scoped loop across the first three
cores and applies Proportional Assurance between them. It does not yet store
adoption outcomes, cross-task decisions, learned preferences, or a delegation
frontier.

The workspace contains two lockstep packages:

- `@sovea/stetra-core` — deterministic contract compilation, fact
  binding, and handoff evaluation;
- `@sovea/stetra` — CLI lifecycle, Git and check collection, run IO,
  review-packet assembly, initialization, and generated Codex/Claude
  workflows.

```text
Generated host adapter -> CLI -> Core
```

Neither package calls an LLM. The coding agent keeps responsibility for
repository investigation and semantic judgment; the runtime owns only facts it
collects.

See [Architecture](docs/architecture.md) for the product kernel and
[Change workflow](docs/change-workflow.md) for the executable protocol.

## Current state

The repository implements the complete technical workflow and verifies it
through unit, lifecycle, archive, and isolated-installation tests. The protocol
is still a `0.0.1` prototype: unsupported shapes are rejected, and obsolete
owner data is never automatically translated or deleted.

Technical verification is not evidence that the product lowers adoption cost.
That claim remains unverified until committed paired-agent evidence satisfies
[`evaluation/paired-agent/PROTOCOL.md`](evaluation/paired-agent/PROTOCOL.md)
and supports a scoped developer decision.

To run the current source checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node packages/cli/dist/index.mjs --help
```

## Development

Use Node.js 22 and pnpm 10.33.0:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing public behavior. Core
and CLI versions move together from a committed stable baseline; prerelease
suffixes are tag-driven at publish time. Generated `dist/` files are not
committed. Maintainer releases follow the
[trusted publishing process](docs/releasing.md).
