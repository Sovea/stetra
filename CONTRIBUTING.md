# Contributing

Use Node.js 22 and pnpm 10.33.0:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm audit --audit-level high
```

Read [Architecture](docs/architecture.md) before changing product boundaries,
authority, persistence, public APIs, or host interaction. Read
[Change workflow](docs/change-workflow.md) before changing CLI lifecycle or
task-run behavior.

The workspace has two version-locked packages:

- Core owns deterministic Semantic Contract compilation, fact binding, and
  Cognitive Handoff evaluation.
- CLI owns workflow IO, Git and check collection, run sequencing,
  initialization, generated host workflows, and presentation.

Core exports only `compileDelegation` and `evaluateHandoff` as runtime values.
Generated adapters stay thin: they invoke the CLI protocol and leave repository
reasoning to the host agent.

Preserve unrelated changes in dirty worktrees. Keep `dist/` generated and
untracked. Changes to release behavior must pass the isolated Core archive and
paired Core/CLI archive smoke workflows.

Technical verification does not establish product effectiveness. Any claim
about adoption cost or developer cognition must follow
[`evaluation/paired-agent/PROTOCOL.md`](evaluation/paired-agent/PROTOCOL.md).
