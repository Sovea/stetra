# @sovea/resonant-code

CLI-first control plane for the resonant-code AI coding change harness.

```sh
npm install --global @sovea/resonant-code
cd /path/to/project
resonant-code init .
resonant-code doctor . --strict
```

`init` generates a thin Host Adapter for Codex, Claude Code, or both. No
persistent check setup is required: the Host selects a task-scoped exact check
plan from authoritative repository sources. A team may explicitly adopt
`.resonant-code/checks.json` as shared defaults.

After setup, use the Host Agent normally:

> Fix the parser boundary and add a regression test.

The generated adapter runs `change prepare` before implementation and
`change complete` afterward. Human users do not need to manage task runs,
selection, relation, or evaluation artifacts.

Before prepare, the Host aligns only material choices about goals, public
behavior, compatibility, architectural ownership, migrations, or other
long-lived tradeoffs. Repository-discoverable details and necessary adjacent
file changes remain autonomous. No separate design artifact is created.

The Host may inspect the repository read-only before prepare. It supplies
intended file or directory scope roots and canonical technology IDs; Runtime
then reports exactly which Team Playbook guidance activated and why each
selected check belongs to the task. Every definition in the selected transient
or team-default configuration executes.
Completion asks for attestations only for required, avoid, and tension
attention items. Optional `consider` guidance may remain unverified without
creating an attention state or retry loop. Before attesting satisfaction, the Host
reviews the complete actual diff for contradictory evidence. Check stdout and
stderr logs are created only for streams that produced output.

Human-readable output is the default. Host Adapters use `--json`; JSON mode
never prompts or emits ANSI. Required readiness issues block
`doctor --strict`, while absent Team Playbook, team check defaults, and RCCL
sources remain recommended or optional.

The package exposes one binary, `resonant-code`, and pins the exact matching
`@sovea/resonant-code-core` version. Core owns Playbook, RCCL, compilation,
and evaluation decisions. CLI owns reproducible workflow IO, task-scoped run
state, machine facts, presentation, and generated adapters. Neither package
calls an LLM.

Use `resonant-code --help` for the complete advanced command surface.
