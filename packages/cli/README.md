# @sovea/resonant-code

Publishable CLI-first control plane for the resonant-code change harness.

```sh
npx @sovea/resonant-code init .
resonant-code status .
resonant-code change prepare . --task "Fix the parser" --change-type bugfix --target src/parser.ts --json
```

Interactive terminals receive adapter selection and, when optional guidance
overflows the delivery budget, an explicit selection prompt. `--json` and
`--no-interactive` never prompt. Machine callers should always use `--json`;
its stdout is a single JSON document without ANSI formatting.

The CLI pins the exact matching `@sovea/resonant-code-core` version. Core owns
Playbook, RCCL, compilation, evaluation, and bounded feedback decisions; CLI
owns reproducible workflow IO, machine facts, and thin Host Adapter generation.
Neither package calls an LLM. Host agents retain semantic task understanding,
repository inspection, relation proposals, implementation, and attestations.

The package exposes one binary, `resonant-code`. Bootstrap does not guess
repository technology from filenames; the host supplies inspected evidence
paths for any repository-specific Playbook layer.

Commander owns command syntax and help; Zod validates untrusted CLI artifacts;
Execa collects Git and check-process facts; Inquirer and picocolors are confined
to the human-facing adapter. None of these dependencies makes Playbook, RCCL,
relation, delivery, or evaluation decisions.
