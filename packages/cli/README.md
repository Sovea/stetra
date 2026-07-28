# @sovea/resonant-code

CLI-first control plane for the resonant-code AI coding change harness.

```sh
npm install --global @sovea/resonant-code
cd /path/to/project
resonant-code init .
resonant-code doctor . --strict
```

`init` generates a thin Host Adapter for Codex, Claude Code, or both. Ask the
configured Host Agent to inspect the repository and propose explicit trusted
checks; it must show the exact command argv and timeouts before writing
`.resonant-code/checks.json`.

After setup, use the Host Agent normally:

> Fix the parser boundary and add a regression test.

The generated adapter runs `change prepare` before implementation and
`change complete` afterward. Human users do not need to manage task runs,
selection, relation, or evaluation artifacts.

The Host may inspect the repository read-only before prepare. It supplies
intended file or directory scope roots and canonical technology IDs; Runtime
then reports exactly which Team Playbook guidance and checks activated.
Completion asks for attestations only for required, avoid, and tension
attention items. Optional `consider` guidance may remain unverified without
creating a warning or retry loop. Before attesting satisfaction, the Host
reviews the complete actual diff for contradictory evidence. Check stdout and
stderr logs are created only for streams that produced output.

Human-readable output is the default. Host Adapters use `--json`; JSON mode
never prompts or emits ANSI. Required readiness issues block
`doctor --strict`, while absent Team Playbook and RCCL sources remain
recommended or optional.

The package exposes one binary, `resonant-code`, and pins the exact matching
`@sovea/resonant-code-core` version. Core owns Playbook, RCCL, compilation,
and evaluation decisions. CLI owns reproducible workflow IO, task-scoped run
state, machine facts, presentation, and generated adapters. Neither package
calls an LLM.

Use `resonant-code --help` for the complete advanced command surface.
