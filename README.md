# resonant-code

`resonant-code` is a change harness for AI coding agents. It compiles project guidance and evidence-current repository context before implementation, then evaluates the actual change against only the guidance that was delivered.

The project targets the gap between code that is plausible and a change that a team would adopt and keep. It is intentionally more than a bundle of Markdown instructions, but it is also intentionally smaller than a general agent framework.

See [CLI-first architecture](docs/cli-first-architecture.md) for the Core/CLI
package boundary and generated-adapter ownership model.

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

The project publishes two lockstep packages:

- `@sovea/resonant-code-core` — Playbook, RCCL, and the deterministic Runtime
- `@sovea/resonant-code` — CLI workflow, machine facts, project initialization,
  and generated Host Adapters

The Core root keeps exactly two public value operations:

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

Preflight has one configurable UTF-8 byte ceiling: 6,000 bytes by default. It
applies to the agent-facing `executionGuidance`: IDs, instructions,
prohibitions, execution modes, applicable exceptions, examples, and tensions.
Machine-facing source, verification, evidence, and trace metadata remain in the
full decision packet and do not consume this attention budget. There are no
per-section item counts.

Runtime never silently removes required guidance, prohibitions, or unresolved
tensions. When optional considerations exceed the ceiling, compilation returns
`guidance-overflow` with every selectable ID, its compact instruction, byte
cost, and full decision detail. The host must submit a bounded selection with a
semantic rationale; Runtime records the selection in the Decision Trace and
Decision ID. If mandatory guidance alone exceeds the ceiling, the task/policy
scope or ceiling must be resolved explicitly.

The normal workflow presents `executionGuidance` as `guidance` and persists the
full decision for inspection and evaluation. Delivery diagnostics distinguish
agent-facing bytes, full structured-guidance bytes, and full packet bytes.
Postflight evaluates only guidance that the compiled task actually received.

## Installation

The registry packages are not published yet. From a source checkout:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node packages/cli/dist/index.mjs --help
```

Once published, the intended installation becomes:

```sh
npm install --global @sovea/resonant-code
```

The CLI pins and installs the exact matching
`@sovea/resonant-code-core` version automatically. Programmatic integrations
may install Core directly:

```sh
npm install @sovea/resonant-code-core
```

Then initialize project-local thin adapters. These are generated instructions,
not copies of Runtime policy. A TTY prompts for adapters; machine callers pass
them explicitly or use the documented default of both:

```sh
resonant-code init /path/to/project --adapter codex --adapter claude
resonant-code status /path/to/project
```

`init` owns only `.resonant-code/manifest.json`, generated adapter skill files,
and marked pointer/ignore blocks. It does not overwrite the Team Playbook,
RCCL, checks, sessions, or feedback. Modified generated files are preserved
unless `--force` is explicitly supplied.

## Quickstart

Prepare a change, let the host agent implement it, and then evaluate the actual
diff and configured checks:

```sh
resonant-code change prepare . \
  --task "Fix the parser boundary" \
  --change-type bugfix \
  --target packages/core/src/runtime/load/load-playbook.ts \
  --json

# If prepare reports guidance-overflow, choose relevant optional IDs in a
# selection JSON and rerun with --selection-file <path>. Human non-JSON runs
# can make the same explicit selection interactively.

# Implement the change. Complete will run the prepared check mappings.

resonant-code change complete \
  --session <session-path> \
  --evaluation-file <evaluation.json> \
  --json

# Inspect fact-only feedback; this never changes policy.
resonant-code feedback inspect . \
  --guidance-id <directive-id>
```

For RCCL, the host first selects exact decision-relevant source windows. Save
the prepare contract, commit a generated proposal that references only its
window IDs, then approve reviewed observations separately:

```sh
resonant-code context prepare . \
  --evidence packages/core/src/index.ts:1-7 \
  --json \
  > .resonant-code/context/rccl-prepare.json
resonant-code context commit . \
  --contract .resonant-code/context/rccl-prepare.json \
  --input <proposal.yaml> \
  --json
resonant-code context approve . \
  --id <observation-id> \
  --approved-by <reviewer> \
  --json
```

Project-specific Playbook layer selection remains host-assisted because it
requires semantic judgment. `bootstrap prepare` enumerates available Core
layers but does not crawl, rank, or preselect repository files. The host
inspects the repository with its native tools and supplies concrete
repository-relative evidence paths:

```sh
resonant-code bootstrap prepare . --json
resonant-code bootstrap commit . --input <candidate.json> --json
```

The candidate contains only Host-selected layer evidence:

```json
{
  "selectedLayers": ["builtin/languages/typescript"],
  "evidence": [
    {
      "layerId": "builtin/languages/typescript",
      "paths": ["package.json", "tsconfig.json"],
      "rationale": "These inspected files establish the TypeScript project boundary."
    }
  ]
}
```

## Project state

Durable, reviewable project data:

- `.resonant-code/manifest.json` — generated-adapter ownership, generator
  version, and protocol version
- `.resonant-code/playbook/local-augment.yaml` — project prescription
- `.resonant-code/checks.json` — explicit logical-check-to-command mappings
- `.resonant-code/rccl.yaml` — evidence-current repository observations
- `.resonant-code/feedback/verified-events.jsonl` — bounded evidence-backed outcomes
- `.resonant-code/feedback/aggregates.json` — Runtime-owned fact-only counts by
  guidance ID
- `.resonant-code/feedback/change-proposals/` — explicitly approved,
  inspectable policy proposals that remain unapplied

Optional user-scoped data:

- `~/.resonant-code/playbook/personal-overlay.yaml` — personal `should`-level
  preferences and examples; use
  `templates/personal-overlay.template.yaml` as the schema example

Generated task sessions live under `.resonant-code/context/` and should normally remain ignored.

Generated, replaceable host adapters live under:

- `.agents/skills/resonant-code/SKILL.md` for Codex
- `.claude/skills/resonant-code/SKILL.md` for Claude Code

`AGENTS.md`, `CLAUDE.md`, and `.gitignore` receive only explicitly marked
managed blocks; owner content outside those blocks remains untouched. Project
initialization is the sole owner of these generated blocks—Bootstrap never
rewrites `.gitignore`.

## Design constraints

- Core root exposes only `compileChange` and `evaluateChange` as public value
  APIs; RCCL lifecycle APIs use the explicit `/rccl` subpath.
- CLI depends on the exact matching Core version. Successful CLI sessions
  record both package identities instead of an absolute installation path.
- Team policy outranks personal taste. Personal overlays cannot override,
  suppress, score-rank, or create hard constraints/prohibitions.
- RCCL stores only observations with an explicit decision impact and non-empty evidence.
- Only current, fully matched RCCL evidence with high semantic confidence, reviewed status, and an accepted semantic relation may change directive execution.
- Scope overlap may make an RCCL observation task-relevant and ambient; only an
  explicit accepted host relation may connect it to a directive.
- CLI performs lifecycle orchestration and filesystem IO. Thin generated host
  adapters use host semantic judgment and never reconstruct Playbook, RCCL,
  budgeting, or evaluation policy.
- Successful `prepare` captures the dirty-worktree baseline. `complete` computes
  exact baseline-to-current file facts and runs only explicit non-shell check
  mappings; attestation JSON cannot supply its own changes or check results.
- Feedback records only evidence-backed satisfied, violated, and
  approved-exception outcomes. Runtime aggregates facts by guidance ID without
  raw explanations; no threshold changes policy automatically.
- Decision Trace is a compact explanation surface, not an event-log dump.

## Effectiveness evidence

The deterministic and lifecycle verification gates are implemented and run in
CI. The separate product-effectiveness claim is currently
**unverified**: no paired coding-agent trials have been recorded yet. The
[paired evaluation protocol](evaluation/paired-agent/PROTOCOL.md) fixes the
control/treatment boundary, blind review, correction-cost measures, and raw
reporting rules; [the ledger](evaluation/paired-agent/ledger.json) prevents a
measured-improvement claim while it remains `not-run`.

## Development

Requires Node.js 22.12 or newer and pnpm.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

The verification gate runs type checks, unit and workflow tests, coverage,
deterministic builds, an isolated Core tarball smoke test, a paired Core/CLI
tarball install and binary smoke test, and paired-evaluation ledger validation.

## License

MIT
