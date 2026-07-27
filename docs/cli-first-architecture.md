# CLI-first architecture

## Decision

`resonant-code` uses a CLI-first control plane with generated host-native
adapters. It does not invoke an LLM and it does not become a general agent
framework.

The host agent remains responsible for semantic work: understanding the
request, inspecting the repository, selecting exact evidence, proposing
relations, implementing the change, and explaining outcomes. Resonant owns the
deterministic boundaries that should not vary by host.

```text
Developer
   |
   v
Host agent (Codex / Claude / future host)
   |  task semantics, evidence windows, relations, code, attestations
   v
Generated thin adapter
   |  `resonant-code ... --json`
   v
@sovea/resonant-code (CLI)
   |-- commands and presentation
   |-- prepare/complete workflow and sessions
   |-- Git worktree and check facts
   |-- project manifest and Host Adapter generation
   |
   v exact same-version dependency
@sovea/resonant-code-core
   |-- Runtime: compileChange / evaluateChange
   |-- RCCL: evidence, calibration, approval, lifecycle
   `-- built-in Playbook assets
```

## Package boundary

The workspace intentionally has two packages:

```text
packages/
├── core/   @sovea/resonant-code-core
└── cli/    @sovea/resonant-code
```

Core uses internal source modules rather than separately versioned packages:

```text
packages/core/
├── assets/playbook/
└── src/
    ├── runtime/
    ├── rccl/
    └── index.ts
```

CLI uses internal modules for application concerns:

```text
packages/cli/src/
├── adapters/
├── commands/
├── facts/
├── infrastructure/
├── presentation/
├── project/
├── schemas/
├── workflow/
├── main.ts
├── program.ts
└── index.ts
```

A new package is justified only by an independent consumer, public API,
version, and release need. Directory/module boundaries are sufficient for
workflow, facts, project initialization, and Host Adapter templates.

## API and dependency direction

The only dependency direction is:

```text
Host Adapter -> CLI -> Core
```

Core does not know about CLI commands, output formatting, Codex, Claude,
generated files, or process exit codes. CLI and generated adapters do not
parse Playbook policy, rank directives, adjudicate semantic relations, or
determine feedback eligibility.

The Core root exposes exactly:

```ts
compileChange(input)
evaluateChange(input)
```

RCCL lifecycle operations use the explicit
`@sovea/resonant-code-core/rccl` subpath. Helpers and internal policy modules
are not package exports.

## Command surface

| Concern | Command |
|---|---|
| Install/update project adapters | `resonant-code init` |
| Readiness and adapter drift | `resonant-code status`, `resonant-code doctor` |
| Host-assisted Team Playbook setup | `resonant-code bootstrap prepare/commit` |
| Change lifecycle | `resonant-code change prepare/complete/explain` |
| RCCL lifecycle | `resonant-code context prepare/commit/approve/validate/refresh-stale` |
| Bounded feedback | `resonant-code feedback inspect/propose` |

Human-readable output is the default. Commander owns command syntax and help;
command-specific presenters use picocolors. Interactive prompts are enabled
only for a real TTY and can be disabled with `--no-interactive`.

Host adapters use `--json`. JSON mode never prompts, never emits ANSI, and
writes only the machine-readable result to stdout. Actionable business states
such as `needs-interpretation` and `guidance-overflow` are successful machine
responses. Invalid input, infrastructure failures, changed generated artifacts
during init, and strict doctor failures use non-zero exit codes.

Zod validates external artifact shape and emits stable issue paths. It does not
adjudicate Playbook authority, semantic relations, evidence truth, delivery, or
evaluation. Execa is behind the CLI process adapter for Git and configured
checks; commands remain argv arrays and never opt into a shell.

## Project initialization and ownership

`.resonant-code/manifest.json` records:

- manifest and adapter protocol schema versions
- generator/product version
- installed Host Adapters
- exact generated paths, artifact kinds, template revisions, and SHA-256 hashes

Initialization plans every write before changing the project. Missing files
are created; unmodified generated files can be upgraded; owner-modified files
and managed blocks stop the operation unless `--force` is explicit.

The CLI never claims ownership of:

- `.resonant-code/playbook/local-augment.yaml`
- `.resonant-code/checks.json`
- `.resonant-code/rccl.yaml`
- sessions, feedback events, aggregates, or policy proposals
- content outside marked blocks in `AGENTS.md`, `CLAUDE.md`, or `.gitignore`

Project initialization is the only workflow allowed to create or update those
managed blocks. Bootstrap owns only Team Playbook generation and never edits
`.gitignore`.

Adapter installation is additive. Omitting `--adapter` on an initialized
project retains the installed adapter set. On a new interactive project, the
CLI asks which adapters to install. New non-interactive and `--json` runs use
the documented default of both adapters; `--yes` accepts the same default
explicitly.

When optional guidance overflows the byte ceiling, an interactive human may
select IDs and supply a rationale in-place. The CLI sends that exact bounded
selection back through `compileChange`; it does not rank candidates or choose
defaults. Host adapters continue to consume the `guidance-overflow` JSON and
provide their own explicit selection file.

Bootstrap enumerates available Core layers but does not scan, rank, cap, or
guess repository evidence. The host inspects the repository using native
tools and submits exact repository-relative evidence paths; the CLI validates
path containment and existence without adjudicating their semantic meaning.

## Distribution boundary

Both packages are public and version-locked:

```text
@sovea/resonant-code-core@X.Y.Z
@sovea/resonant-code@X.Y.Z
```

The CLI source manifest uses `workspace:*`; `pnpm pack` must rewrite it to the
exact matching Core version. Release order is Core first, then CLI.

Every `dist/` directory is generated and ignored by Git. The Core npm archive
contains Core `dist/` and Playbook assets. The CLI npm archive contains CLI
`dist/`, the `resonant-code` binary, and an exact Core dependency.

Release verification:

1. builds twice and compares generated file sets and hashes
2. packs and installs the real Core archive in isolation
3. exercises Core root and RCCL subpath behavior
4. packs Core and CLI together
5. verifies the packed CLI pins the exact Core version
6. installs both archives in an isolated consumer
7. runs init, bootstrap, RCCL prepare, change prepare/complete, and status
8. verifies sessions contain package identities and no source-checkout paths

The CLI transition changes distribution and orchestration, not the product
effectiveness claim. That claim remains governed by
`evaluation/paired-agent/PROTOCOL.md` and its ledger.
