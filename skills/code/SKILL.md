---
name: code
description: "Skill for implementing, modifying, fixing, or refactoring code. It compiles task-time guidance through Runtime, applies the compiled EGO during implementation, and writes evidence-aware quality signals back to the lockfile after the task."
metadata:
  version: "0.2.0"
  author: "Sovea"
---

# Code And Modify With Runtime Guidance

Use this skill for concrete coding work: feature implementation, modification, bug fixing, or bounded refactoring.

This skill is a thin Runtime workflow consumer. Runtime owns task-model schema, semantic governance graph schema, adherence evidence schema, validation, adjudication, EGO assembly, Decision Trace, and lockfile feedback. The skill only orchestrates contracts and applies the compiled result during implementation.

Do not read or merge playbook files manually.
Do not reconstruct EGO or semantic merge logic in the skill.
Do not use raw playbook YAML as the primary prompt input.
Do not create ad hoc host-agent schemas or prompts in this skill.

Host-agent semantic judgment enters only through `ai-contract/v2` artifacts:

- `task-model`
- `semantic-governance-graph`
- `context-acquisition`
- `adherence-evidence`

## Default Flow

Start with:

```sh
node <this-skill-directory>/scripts/code.mjs auto <project-root> --task "<user task>" [--mode <fast|standard|strict>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

`standard` is the default and should compile guidance directly for low-risk, clearly scoped work. Use `fast` to force deterministic fallback with no blocking host-agent contracts. Use `strict` for migration, public API, high-risk, cross-module, or audit-heavy work; strict preserves the full task-model, semantic-governance-graph, and adherence-evidence lifecycle.

Deterministic fallback uses neutral defaults for compatibility, migration, sensitive-interface, and similar governance semantics. Confirm those concerns through explicit CLI fields or a task-model artifact when they should affect governance.

`auto` may include an `agentLoop` field. Treat `agentLoop.pendingContracts` as the next host-agent work queue: write the artifact to `artifactPath`, repair only from Runtime/RCCL diagnostics, and resume with `resumeCommand`. The default repair limit is three attempts for the same contract and same failure reason.

If `auto` returns `status: "contracts-required"`, this is not a default stopping point. In the same turn, fulfill only the listed Runtime-owned contract artifacts and re-run with the new v2 flags or the supplied `agentLoop.pendingContracts[].resumeCommand`:

```sh
node <this-skill-directory>/scripts/code.mjs auto <project-root> --task "<user task>" --task-model-file <path> --governance-graph-file <path>
```

`--task-model-file` is used for the `task-model` artifact.
`--governance-graph-file` is used for the `semantic-governance-graph` artifact.

If RCCL is absent, `auto` may return a `context-acquisition` contract or `contextAcquisition` recommendation. Fulfill the bounded Runtime payload, then run `calibrate-repo-context prepare-incremental`. When no `.resonant-code/rccl.yaml` exists, the RCCL incremental flow must produce an `rccl-observation-generation` contract and use `commit`; when RCCL exists, it produces an `rccl-observation-refresh` contract and uses `commit-refresh`.

Mode behavior:

- `fast` skips blocking host-agent contracts and may complete with `--auto-unverified`.
- `standard` automatically fulfills Runtime-required contracts and prepares adherence evidence by default; if evidence is insufficient, write `unverified` verdicts rather than updating follow rate.
- `strict` completes the full `task-model -> semantic-governance-graph -> adherence-evidence` lifecycle. A strict task is incomplete until adherence evidence is accepted or explicitly reported as unverified with diagnostics.

Useful supporting commands:

```sh
node <this-skill-directory>/scripts/code.mjs status <project-root>
node <this-skill-directory>/scripts/code.mjs doctor <project-root>
node <this-skill-directory>/scripts/code.mjs explain --session <session-path>
```

`doctor` is an alias for `status`. It reports local augment, RCCL, lockfile, generated cache volume, gitignore lifecycle state, plugin completeness, and a low-risk single-file `standard`-mode probe that shows whether the default flow would unexpectedly block. Prefer the `readiness.status` and `readiness.nextActions` fields for user-facing guidance; detailed diagnostics remain available under `diagnostics.items`.

## Manual Contract Flow

To request task modeling:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-interpretation <project-root> --task "<user task>" [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

This prints a Runtime-owned `task-model` contract. Every modeled field must use the structure `value` or `values`, `confidence`, `evidence_refs`, `alternatives`, and `uncertainties`. Runtime validates enum values, evidence shape, confidence, and field-level precedence. Explicit CLI task fields win over host task-model fields; deterministic fields are marked as defaulted fallback.

To request semantic governance:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-relations <project-root> --task "<user task>" [--task-model-file <path>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

This prints a Runtime-owned `semantic-governance-graph` contract with allowed directive and observation ids. Host output may propose edges with relation, impact, execution intent, review priority, confidence, reason, and `evidence_refs`; Runtime still decides final relation and execution mode. Edges that affect execution mode require at least one statically verifiable evidence ref; conversation-only execution evidence is rejected or downgraded before adjudication.

To compile manually:

```sh
node <this-skill-directory>/scripts/code.mjs prepare <project-root> --task "<user task>" [--task-model-file <path>] [--governance-graph-file <path>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

Read `interpretation.summary`, `interpretation.nextStep`, and `fulfillment` before implementation. If host artifacts are rejected or partially accepted, use Runtime diagnostics to repair malformed payloads, invalid ids, missing evidence, low confidence, or duplicate graph edges.

If `status` is `ok`:

- Use `ego.guidance.must_follow` as operational constraints.
- Use `ego.guidance.avoid` to suppress bad patterns.
- Use `ego.guidance.context_tensions` to handle repository conflicts explicitly.
- Use `ego.guidance.ambient` only as background context.
- Treat `trace` as developer/debug output.

If `status` is `failed`, stop before implementation, report the Runtime compile error briefly, fix the input, and re-run prepare.

## Implement

Implement the requested change using the compiled `ego`.

Precedence while coding:

1. explicit user instructions
2. `ego.guidance.must_follow`
3. `ego.guidance.context_tensions`
4. repository reality informed by `ego.guidance.ambient`
5. `ego.guidance.avoid`

Do not quote raw EGO sections back to the user as policy text. Apply them in code and technical decisions.

## Complete With Evidence

After implementation, request the adherence evidence contract:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-adherence --session <session-path>
```

This prints a Runtime-owned `adherence-evidence` contract. Every `followed`, `ignored`, or `partial` verdict must cite evidence from diff, file snippets, command/test results, runtime trace, or implementation evidence. Use `unverified` when evidence was not inspected; unverified directives are recorded but do not update follow rate. If Runtime cannot statically verify the evidence, the validator records the verdict as `unverified`.

Then complete:

```sh
node <this-skill-directory>/scripts/code.mjs complete --session <session-path> --adherence-file <path>
```

For lightweight completion that updates only the governance summary and does not update directive follow rate:

```sh
node <this-skill-directory>/scripts/code.mjs complete --session <session-path> --auto-unverified
```

When `--adherence-file` is used, `complete` only consumes the v2 `adherence-evidence` payload. It does not accept manual followed/ignored flag shortcuts. Runtime validates directive ids, evidence, confidence, and verdict enum values, then writes evidence-aware lockfile feedback. `--auto-unverified` is summary-only and intentionally does not update directive follow rate.

Do not manually write the lockfile.
