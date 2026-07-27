# @sovea/resonant-code

Publishable CLI-first control plane for the resonant-code change harness.

```sh
npx @sovea/resonant-code init . --adapter codex --adapter claude
resonant-code status .
resonant-code change prepare . --task "Fix the parser" --change-type bugfix --target src/parser.ts --json
```

The CLI pins the exact matching `@sovea/resonant-code-core` version. Core owns
Playbook, RCCL, compilation, evaluation, and bounded feedback decisions; CLI
owns reproducible workflow IO, machine facts, and thin Host Adapter generation.
Neither package calls an LLM. Host agents retain semantic task understanding,
repository inspection, relation proposals, implementation, and attestations.

The package exposes one binary, `resonant-code`. Bootstrap does not guess
repository technology from filenames; the host supplies inspected evidence
paths for any repository-specific Playbook layer.
