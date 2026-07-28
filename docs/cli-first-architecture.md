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
   |  one router skill + task-specific references
   |  `resonant-code ... --json`
   v
@sovea/resonant-code (CLI)
   |-- commands and presentation
   |-- prepare/complete workflow and task-scoped runs
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
invent evaluation facts.

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

The generated Host Adapter remains one logical skill. Its root `SKILL.md`
contains only triggering, workflow routing, shared safety boundaries, and the
human-escalation contract. Detailed procedures are loaded on demand:

```text
resonant-code/
├── SKILL.md
└── references/
    ├── change.md
    ├── setup.md
    └── context.md
```

This progressive-disclosure boundary avoids loading setup or calibration
protocols into every coding task. A workflow reference is generated only after
its CLI behavior exists; the current release therefore does not advertise or
generate a standalone review workflow.

Human-readable output is the default. Commander owns command syntax and help;
command-specific presenters use picocolors. Interactive prompts are enabled
only for a real TTY and can be disabled with `--no-interactive`.

Human output is a decision surface, not a lossy echo of JSON. Completion
summarizes changed-file operations, check outcomes, guidance verdicts,
exceptions, required actions, and optional information separately. Prepare
shows normalized targets and technology, active policy contributors,
scope-inactive local policy, and each selected check's source and rationale.
Bootstrap exposes a bounded
layer-selection contract; RCCL output shows the persistent evidence and content
fingerprints needed for a meaningful review.

Host adapters use `--json`. JSON mode never prompts, never emits ANSI, and
writes only the machine-readable result to stdout. Actionable business states
such as `needs-alignment` and `guidance-overflow` are successful machine
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

Missing router references and outdated generated content count as installation
drift even when the generator package version is unchanged.

Initialization plans every write before changing the project. Missing files
are created; unmodified generated files can be upgraded; owner-modified files
and managed blocks stop the operation unless `--force` is explicit.

The CLI never claims ownership of:

- `.resonant-code/playbook/local-augment.yaml`
- `.resonant-code/checks.json`
- `.resonant-code/rccl.yaml`
- content outside marked blocks in `AGENTS.md`, `CLAUDE.md`, or `.gitignore`

The CLI owns ignored task runtime state under
`.resonant-code/runs/<runId>/`. A successful prepare writes one `run.json` and
one empty `evaluation.json`; completion writes check logs inside that run and
adds the evaluation to `run.json`. Results that still need semantic alignment,
guidance selection, or missing verification definitions create no run.
Completed-run cleanup removes whole run directories, while prepared runs are
retained.
Persisted stdout and stderr are capped independently while their digests cover
the complete streams. There is no global feedback ledger or aggregate store in
the initial release.

Project initialization is the only workflow allowed to create or update those
managed blocks. Bootstrap owns only Team Playbook generation and never edits
`.gitignore`. Bootstrap prepare returns its prompt and schema without writing
debug or candidate artifacts into the project.

Adapter installation is additive. Omitting `--adapter` on an initialized
project retains the installed adapter set. On a new interactive project, the
CLI asks which adapters to install. New non-interactive and `--json` runs use
the documented default of both adapters; `--yes` accepts the same default
explicitly.

Readiness is consequence-based:

- required issues cover Core/Adapter integrity and invalid configured sources;
  `doctor --strict` fails on these
- recommended items cover repository-specific Team Playbook guidance
- optional items cover absent team check defaults, RCCL, and personal
  preferences

The Host may resolve repository-discoverable task details, choose optional
guidance, use reviewed RCCL, implement within scope, run checks, and attest
evidence without interrupting the user. It must pause before changing
the persistent Team Playbook or team verification defaults, approving observations or
exceptions, resolving materially different goals, public behavior,
compatibility, architectural ownership, irreversible migration strategies, or
accepting unresolved failures and design tradeoffs.

Before prepare, the Host performs a transient semantic alignment. It asks one
consolidated question only when a top-level choice is material; otherwise it
resolves repository details and proceeds. The result is encoded in the
existing task, constraint, avoid, target, and uncertainty inputs rather than a
new persisted planning artifact.

Before prepare, the Host may use ordinary read-only repository inspection.
Targets are explicit intended scope roots: directory roots include descendants,
while final changed-file facts remain workflow-collected after implementation.
The Host explicitly supplies change type, risk, scope, and targets; Runtime
does not infer semantic task fields from prose keywords or path counts.
Technology identifiers are canonical lowercase IDs and exact file extensions
may add mechanical language context. Runtime owns scope overlap, layer
selection, verification activation, and the attention-only attestation plan;
the adapter does not reproduce those decisions.

Targets are not file write permissions. The Host may change directly coupled
implementation, tests, types, and documentation while preserving the aligned
semantic contract, and re-aligns only when discovered work changes that
contract.

Before prepare, the Host selects the smallest task-relevant check
configuration from authoritative repository scripts, CI, and documentation.
Every selected definition becomes a bounded verification proposal with an ID,
rationale, and `host-task` or `team-default` source. Runtime merges those
proposals with delivered-guidance requirements; the CLI freezes and executes
every selected definition. Missing policy-required IDs return
`verification-required` without creating a run. No filename, dependency, or
configured-but-unused heuristic activates checks.

Transient task configuration is autonomous Host execution planning.
Creating or changing `.resonant-code/checks.json` is an optional persistent
team-standard decision and requires semantic confirmation. Optional `consider`
guidance may be attested, but an unverified optional item is informational and
cannot by itself change completion status.

Before creating attestations, the Host performs a contradiction review over
the complete actual diff. It attempts to falsify every required, avoid, and
tension claim and reports a non-satisfied verdict when the diff contradicts
the claim or does not establish it. This keeps semantic judgment in the Host
while Runtime continues to validate only narrow evidence bindings.

When optional guidance overflows the byte ceiling, an interactive human may
select IDs and supply a rationale in-place. The CLI sends that exact bounded
selection back through `compileChange`; it does not rank candidates or choose
defaults. Host adapters continue to consume the `guidance-overflow` JSON and
provide their own explicit selection file.

Bootstrap enumerates available Core layers but does not scan, rank, cap, or
guess repository evidence. The host inspects the repository using native
tools and submits exact repository-relative evidence paths; the CLI validates
path containment and existence without adjudicating their semantic meaning.

RCCL approval additionally requires the caller to supply each reviewed
observation's current content fingerprint. The CLI rejects missing, extra, or
stale fingerprint bindings before Core records approval provenance.

## Future workflow expansion

New task families remain CLI modules and conditional references under the same
logical Host skill while their triggers and collaboration contract overlap. A
future review workflow should collect an explicit worktree, staged, or ref-range
changeset and remain read-only by default. “Review and fix” must transition
from review into a separately authorized change run; review must not
silently acquire write authority.

Split a workflow into a separate top-level skill only when forward tests show
that independent triggering, permissions, or context cannot be routed
reliably. Do not add task families merely to turn resonant-code into a general
agent framework.

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
7. runs init, bootstrap, RCCL prepare/commit/fingerprint-bound approval,
   change prepare/complete, and status
8. verifies runs contain package identities and no source-checkout paths

The CLI transition changes distribution and orchestration, not the product
effectiveness claim. That claim remains governed by
`evaluation/paired-agent/PROTOCOL.md` and its ledger.
