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
Built-in Playbook ─────┐
Team Playbook ─────────┤
Personal overlay ──────┼─> compileChange ─> compact guidance ─> implementation
RCCL (observational) ──┤          │                                  │
Task context ──────────┘          └─> Decision Trace                 │
                                                                       v
verified feedback <──────── evaluateChange <──── machine facts + attestations
```

The two public Runtime operations are:

- `compileChange` — normalize the task, activate Playbook directives, recheck relevant RCCL evidence, adjudicate optional semantic relations, and emit bounded guidance.
- `evaluateChange` — combine workflow-collected file/check facts with explicit
  host semantic attestations and approved exceptions for delivered guidance
  IDs only.

Ordinary tasks use a compact preflight decision and one postflight evaluation.
If optional guidance exceeds the byte ceiling, preflight first returns an
inspectable selection request and compiles only after the host supplies explicit
task-relevant IDs. Tasks do not require task-model, semantic-graph, adherence,
capability-profile, cache, or evolution-proposal artifacts. Strict mode asks for
interpretation only when missing task fields or declared uncertainty would make
compilation untrustworthy.

## Inputs and authority

| Input | Meaning | Authority |
|---|---|---|
| Built-in Playbook | General prescriptive guidance | Runtime validates and activates |
| Team Playbook | Repository-committed project prescription | Runtime validates and applies above built-ins |
| Personal overlay | User-scoped optional preferences and examples | Runtime permits additions/augments but forbids weakening team policy |
| RCCL | Decision-relevant repository observations | RCCL owns schema and evidence state |
| Task context | The concrete requested change | Host supplies; Runtime normalizes |
| Relation proposal | Optional semantic link between an active directive and relevant observation | Host proposes; Runtime gates |

Playbook and RCCL remain separate. A source excerpt can prove that cited evidence is current; it cannot prove that an observation is semantically universal or representative. RCCL therefore tracks evidence status, semantic confidence, and human review status separately.

## Output budgets

Preflight guidance has one configurable UTF-8 byte ceiling: 6,000 bytes by
default. It has no per-section item counts.

Runtime never silently removes required guidance, prohibitions, or unresolved
tensions. When optional considerations exceed the ceiling, compilation returns
`guidance-overflow` with every selectable ID, its compact instruction, byte
cost, and full decision detail. The host must submit a bounded selection with a
semantic rationale; Runtime records the selection in the Decision Trace and
Decision ID. If mandatory guidance alone exceeds the ceiling, the task/policy
scope or ceiling must be resolved explicitly.

Postflight evaluates only guidance that the compiled task actually received.

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

# If prepare reports guidance-overflow, choose relevant optional IDs in a
# selection JSON and rerun with --selection-file <path>.

# Implement the change. Complete will run the prepared check mappings.

node skills/code/scripts/code.mjs complete \
  --session <session-path> \
  --evaluation-file <evaluation.json>
```

For RCCL, the host first selects exact decision-relevant source windows. Save
the prepare contract, commit a generated proposal that references only its
window IDs, then approve reviewed observations separately:

```sh
node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs prepare . \
  --evidence runtime/src/index.ts:1-17 \
  > .resonant-code/context/rccl-prepare.json
node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs commit . \
  --contract .resonant-code/context/rccl-prepare.json \
  --input <proposal.yaml>
node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs approve . \
  --id <observation-id> \
  --approved-by <reviewer>
```

## Project state

Durable, reviewable project data:

- `.resonant-code/playbook/local-augment.yaml` — project prescription
- `.resonant-code/checks.json` — explicit logical-check-to-command mappings
- `.resonant-code/rccl.yaml` — evidence-current repository observations
- `.resonant-code/feedback/verified-events.jsonl` — bounded evidence-backed outcomes

Optional user-scoped data:

- `~/.resonant-code/playbook/personal-overlay.yaml` — personal `should`-level
  preferences and examples; use
  `templates/personal-overlay.template.yaml` as the schema example

Generated task sessions live under `.resonant-code/context/` and should normally remain ignored.

## Design constraints

- Runtime exposes only `compileChange` and `evaluateChange` as public value APIs.
- Team policy outranks personal taste. Personal overlays cannot override,
  suppress, score-rank, or create hard constraints/prohibitions.
- RCCL stores only observations with an explicit decision impact and non-empty evidence.
- Only current, fully matched RCCL evidence with high semantic confidence, reviewed status, and an accepted semantic relation may change directive execution.
- Scope overlap may make an RCCL observation task-relevant and ambient; only an
  explicit accepted host relation may connect it to a directive.
- Skills perform lifecycle orchestration and filesystem IO; they do not reconstruct Playbook, RCCL, budgeting, or evaluation policy.
- Successful `prepare` captures the dirty-worktree baseline. `complete` computes
  exact baseline-to-current file facts and runs only explicit non-shell check
  mappings; attestation JSON cannot supply its own changes or check results.
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
