# resonant-code

`resonant-code` is a change harness for AI coding agents. It compiles project guidance and evidence-current repository context before implementation, then evaluates the actual change against only the guidance that was delivered.

The project targets the gap between code that is plausible and a change that a team would adopt and keep. It is intentionally more than a bundle of Markdown instructions, but it is also intentionally smaller than a general agent framework.

## Why a harness

Text-only coding workflows are good at teaching an agent a method. They are weaker when a team needs stable answers to questions such as:

- Which project rules actually applied to this task?
- Did repository reality reinforce or limit a rule?
- Was that repository claim still supported by the cited source?
- Which guidance did the agent receive, and what evidence shows the final change followed it?
- Can repeated outcomes be aggregated without treating agent prose as truth?

resonant-code makes those boundaries executable and inspectable. Host agents still provide semantic judgment where it is useful; Runtime and RCCL validate the bounded inputs that can affect a decision.

## The change loop

```text
Playbook (prescriptive) ─┐
Local augment ──────────┼─> compileChange ─> compact guidance ─> implementation
RCCL (observational) ───┤          │                                  │
Task context ───────────┘          └─> Decision Trace                 │
                                                                       v
verified feedback <──────── evaluateChange <──── diff + checks + evidence
```

The two public Runtime operations are:

- `compileChange` — normalize the task, activate Playbook directives, recheck relevant RCCL evidence, adjudicate optional semantic relations, and emit bounded guidance.
- `evaluateChange` — evaluate the actual changed files, checks, evidence, and approved exceptions against only the delivered guidance IDs.

Ordinary tasks require one preflight call and one postflight call. They do not require task-model, semantic-graph, adherence, capability-profile, cache, or evolution-proposal artifacts. Strict mode asks for interpretation only when missing task fields or declared uncertainty would make compilation untrustworthy.

## Inputs and authority

| Input | Meaning | Authority |
|---|---|---|
| Built-in Playbook | General prescriptive guidance | Runtime validates and activates |
| Local augment | Project-specific prescription and taste | Runtime validates and applies |
| RCCL | Decision-relevant repository observations | RCCL owns schema and evidence state |
| Task context | The concrete requested change | Host supplies; Runtime normalizes |
| Relation proposal | Optional semantic link between an active directive and relevant observation | Host proposes; Runtime gates |

Playbook and RCCL remain separate. A source excerpt can prove that cited evidence is current; it cannot prove that an observation is semantically universal or representative. RCCL therefore tracks evidence status, semantic confidence, and human review status separately.

## Output budgets

Preflight guidance is deliberately small:

- up to 3 required items
- up to 3 considerations
- up to 2 avoid items
- up to 2 repository tensions
- up to 1 example per item
- no more than 6 KB of guidance JSON; examples are trimmed before guidance items

Lower-priority activated items can appear as trace omissions, but postflight never evaluates guidance that the task did not receive.

## Installation

### Claude Code

```sh
/plugin marketplace add sovea/cc-marketplace
/plugin install resonant-code@sovea
```

### Codex

Ask Codex to fetch and follow:

```text
https://raw.githubusercontent.com/Sovea/resonant-code/refs/heads/main/.codex/INSTALL.md
```

## Quickstart

Initialize the local Playbook, calibrate only repository context that could change a coding decision, then use the change harness:

```sh
/resonant-code:init
/resonant-code:calibrate-repo-context
/resonant-code:code <task description>
```

The underlying `code` workflow is:

```sh
node skills/code/scripts/code.mjs prepare . \
  --task "Fix the parser boundary" \
  --change-type bugfix \
  --target runtime/src/load/load-playbook.ts

# Implement the change and run the returned verification plan.

node skills/code/scripts/code.mjs complete \
  --session <session-path> \
  --evaluation-file <evaluation.json>
```

For RCCL, use a prepare/commit contract so proposed observations cite the exact sampled repository state:

```sh
node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs prepare . \
  --path runtime/src
node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs commit . \
  --path runtime/src \
  --input <proposal.yaml>
```

## Project state

Durable, reviewable project data:

- `.resonant-code/playbook/local-augment.yaml` — project prescription
- `.resonant-code/rccl.yaml` — evidence-current repository observations
- `.resonant-code/feedback/verified-events.jsonl` — bounded evidence-backed outcomes

Generated task sessions live under `.resonant-code/context/` and should normally remain ignored.

## Design constraints

- Runtime exposes only `compileChange` and `evaluateChange` as public value APIs.
- RCCL stores only observations with an explicit decision impact and non-empty evidence.
- Only current, fully matched RCCL evidence with high semantic confidence, reviewed status, and an accepted semantic relation may change directive execution.
- Structural token matching may recall ambient context; it may not create an execution-changing semantic claim.
- Skills perform lifecycle orchestration and filesystem IO; they do not reconstruct Playbook, RCCL, budgeting, or evaluation policy.
- Feedback records only evidence-backed satisfied, violated, and approved-exception outcomes. Unverified output does not improve a score.
- Decision Trace is a compact explanation surface, not an event-log dump.

## Development

Requires Node.js 22 and pnpm.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

The verification gate runs type checks, unit and workflow tests, coverage, deterministic builds, an isolated release smoke test, and plugin readiness checks.

## License

MIT
