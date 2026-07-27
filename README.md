# resonant-code

`resonant-code` is a change harness for AI coding agents. It gives Codex,
Claude Code, and future hosts a small deterministic control plane around the
parts that should not depend on model improvisation: project policy, current
repository evidence, delivered-guidance budgets, actual diff/check facts, and
bounded feedback.

The normal user experience is still a natural-language coding request. The
generated Host Adapter runs the lifecycle in the background.

## Quickstart

The registry packages are not published yet. Once published:

```sh
npm install --global @sovea/resonant-code
cd /path/to/project
resonant-code init .
```

`init` asks which Host Adapters to install and generates one logical
`resonant-code` skill for each selected host. It does not overwrite project
policy or trusted check configuration.

For trusted completion, ask the newly configured Host Agent:

> Set up resonant-code checks for this repository. Inspect the project-owned
> scripts and CI, show me the exact command argv and timeouts, and wait for my
> approval before writing the configuration.

The Host writes the approved commands to `.resonant-code/checks.json`. Confirm
installation and configured-source readiness:

```sh
resonant-code doctor . --strict
```

Each later `change prepare` also reports any task-specific logical check ID
that is not mapped by the approved configuration.

Then use the coding agent normally:

> Fix the parser boundary and add a regression test.

You do not need to run `change prepare`, create session files, or write
evaluation JSON yourself. Those are Host-to-CLI protocol details.

## What happens during a change

```text
Developer request
      |
      v
Host Agent + generated resonant-code skill
      |
      +--> change prepare --json
      |      Runtime activates policy, verifies relevant RCCL evidence,
      |      budgets delivered guidance, and snapshots the worktree
      |
      +--> Host implements the requested change
      |
      `--> change complete --json
             CLI collects the actual diff and runs approved checks
             Runtime evaluates only delivered guidance
             Host reports a human-readable result
```

Ordinary repository-discoverable decisions stay with the Host Agent. The user
is interrupted only when a decision changes intent, persistent team authority,
trusted commands, policy exceptions, or acceptance of an unresolved risk.

The Host may automatically:

- fill task fields supported by the request and repository
- select task-relevant optional guidance when it exceeds the attention budget
- use already-reviewed RCCL observations
- implement and repair work inside the requested scope
- run configured checks and provide evidence-backed semantic attestations

The Host must pause before:

- changing Team Playbook, RCCL, or trusted check configuration
- approving an RCCL observation or policy exception
- resolving a user-intent ambiguity or unresolved policy tension
- expanding scope
- accepting a failed check, hard violation, or high-risk unverified outcome

## Readiness levels

`status` and `doctor` separate setup by consequence:

- **Required** — Core/Adapter integrity, valid checks, and valid configured
  sources. `doctor --strict` fails while any required item is unresolved.
- **Recommended** — repository-specific Team Playbook guidance.
- **Optional** — RCCL, personal preferences, and feedback history.

Built-in guidance works without a Team Playbook or RCCL. Their absence is not a
blocker.

Trusted checks use explicit non-shell argv:

```json
{
  "version": "1.0",
  "checks": [
    {
      "id": "typecheck",
      "command": ["corepack", "pnpm", "typecheck"],
      "timeoutMs": 120000
    }
  ]
}
```

The CLI never guesses commands from filenames or dependencies. The Host
inspects project-owned sources, the user approves the commands, and the CLI
validates and executes the exact definitions.

## Optional team capabilities

These workflows are not part of the everyday Quickstart.

| Need | Command family |
|---|---|
| Inspect installation and readiness | `status`, `doctor` |
| Add repository-specific Playbook layers | `bootstrap prepare/commit` |
| Inspect a prepared or completed session | `change explain` |
| Calibrate durable repository observations | `context prepare/commit/approve` |
| Validate or refresh RCCL evidence | `context validate/refresh-stale` |
| Inspect bounded outcome aggregates | `feedback inspect` |
| Persist an approved, unapplied policy proposal | `feedback propose` |

### Team Playbook

The Team Playbook is shared prescriptive policy. `bootstrap prepare` gives the
Host a bounded layer-selection contract. The Host inspects the repository and
must show the user its selected layers, exact evidence paths, and rationale
before `bootstrap commit` writes
`.resonant-code/playbook/local-augment.yaml`.

### Repository context

RCCL is optional observational context, not a repository summary. Calibrate it
only for durable facts such as compatibility, public API, architecture,
data-flow, migration, or module-format boundaries whose omission could cause a
different and worse future decision.

The Host selects exact evidence windows. RCCL verifies their currency and
stores generated observations separately from human review. Approval requires
the exact current content fingerprint; changing the observation invalidates
the approval. Existing reviewed RCCL is loaded and reverified automatically
during relevant changes.

### Feedback

Feedback records only evidence-backed satisfied, violated, and approved
exception outcomes for guidance the agent actually received. It never changes
policy automatically. An approved feedback proposal remains inspectable and
unapplied until a separate policy edit.

## Architecture

The project publishes two lockstep packages:

- `@sovea/resonant-code` — CLI, machine facts, lifecycle IO, presentation, and
  generated Host Adapters
- `@sovea/resonant-code-core` — Playbook, RCCL, deterministic compilation, and
  evaluation

The dependency direction is:

```text
Host Adapter -> CLI -> Core
```

Core exposes exactly two root value operations:

- `compileChange(input)`
- `evaluateChange(input)`

RCCL lifecycle operations use the explicit
`@sovea/resonant-code-core/rccl` subpath. Neither package calls an LLM.

The generated adapter is one logical skill with progressive workflow
references:

```text
resonant-code/
├── SKILL.md
└── references/
    ├── change.md
    ├── setup.md
    └── context.md
```

This leaves room for a future review workflow without loading review
instructions into ordinary coding tasks or creating competing top-level
skills. Standalone review is not claimed by the current release.

See [CLI-first architecture](docs/cli-first-architecture.md) and the
[trustworthy MVP contract](docs/trustworthy-mvp-contract.md) for the detailed
boundaries.

## Generated and durable project state

CLI-owned generated artifacts:

- `.resonant-code/manifest.json`
- `.agents/skills/resonant-code/` for Codex
- `.claude/skills/resonant-code/` for Claude Code
- marked pointer blocks in `AGENTS.md`, `CLAUDE.md`, and `.gitignore`

Durable team-owned state:

- `.resonant-code/playbook/local-augment.yaml`
- `.resonant-code/checks.json`
- `.resonant-code/rccl.yaml`
- `.resonant-code/feedback/`

Generated sessions live under `.resonant-code/context/` and are ignored.
Owner content outside marked blocks is preserved. Modified generated files are
not replaced unless `--force` is explicit.

## Effectiveness evidence

Deterministic and lifecycle verification gates run in CI. The separate product
effectiveness claim remains **unverified** until paired coding-agent trials are
recorded. The [paired evaluation protocol](evaluation/paired-agent/PROTOCOL.md)
defines the control/treatment boundary and correction-cost measures; the
[ledger](evaluation/paired-agent/ledger.json) prevents a measured-improvement
claim while it remains `not-run`.

## Development

Requires Node.js 22.12 or newer and pnpm:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
node packages/cli/dist/index.mjs --help
corepack pnpm verify
```

The full gate covers types, tests, coverage, deterministic builds, isolated
package installation, binary workflows, and evaluation-ledger consistency.

## License

MIT
