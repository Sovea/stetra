---
name: code
description: "Compile project-specific change guidance before implementation, then evaluate the actual diff and checks against the delivered guidance."
metadata:
  version: "0.0.1"
  author: "Sovea"
---

# Code With The Change Harness

Use this skill for concrete code implementation, bug fixing, feature work, refactoring, and migration.

Runtime owns task normalization, playbook activation, RCCL adjudication, guidance budgets, decision trace, postflight evaluation, and feedback boundaries. The skill performs filesystem IO and command orchestration only.

Do not read or merge playbook files manually. Do not recreate Runtime policy in the skill. Do not report a directive as satisfied without evidence from the actual change or its checks.

## Prepare

Before implementation run:

```sh
node <skill-directory>/scripts/code.mjs prepare <project-root> \
  --task "<task>" \
  --change-type <bugfix|feature|refactor|migration|maintenance|docs|test|unknown> \
  --target <path> \
  [--target <path>] \
  [--risk <low|medium|high>] \
  [--scope <local|module|cross-module|repository>] \
  [--mode <standard|strict>] \
  [--personal-overlay <path>] \
  [--check-config <path>] \
  [--selection-file <path>] \
  [--guidance-byte-limit <positive-integer>]
```

`auto` is an alias for `prepare`.

Optional task flags are deliberately narrow: `--tech`, `--constraint`, `--avoid`, and `--uncertainty`. Express compatibility, migration, or public-boundary requirements as concrete constraints instead of selecting from a context taxonomy that does not change Runtime behavior.

Standard mode compiles directly for ordinary tasks. Strict mode requests missing interpretation only when change type, targets, or declared uncertainties prevent a trustworthy decision. It does not require a task-model file by default.

The workflow automatically loads
`~/.resonant-code/playbook/personal-overlay.yaml` when present.
`--personal-overlay <path>` selects a different user-scoped file. Personal
guidance may add only optional preferences/conventions/architecture guidance or
examples; it cannot override, suppress, score-rank, or create hard team policy.
The repository-committed team Playbook remains authoritative.

If Runtime returns `needs-interpretation`, provide the listed task fields and rerun `prepare`.

If Runtime returns `guidance-overflow`, do not start implementation and do not
invent an item ranking. Required guidance, prohibitions, and unresolved tensions
cannot be removed. If optional guidance caused the overflow, inspect
`selectableConsider` and `candidateDetails`, choose the task-relevant optional
IDs with host semantic judgment, and write:

```json
{
  "considerIds": ["bugfix-add-supporting-validation-01"],
  "rationale": "This defect needs a regression test that captures the corrected behavior."
}
```

Then rerun `prepare` with `--selection-file <path>`. The execution packet uses
one configurable UTF-8 byte ceiling (6,000 by default); it has no fixed
required/consider/avoid item counts. A larger ceiling must be an explicit host
choice via `--guidance-byte-limit`.

Trusted completion requires a Git worktree whose root is the supplied project
root. On successful `prepare`, the workflow snapshots every tracked and
non-ignored untracked file as path, mode, kind, and content hash. Existing dirty
and untracked files become part of the baseline; they are not later
misattributed to the coding task.

Map logical verification IDs to explicit non-shell commands in
`.resonant-code/checks.json` (or pass `--check-config <path>`):

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

Runtime and the skill do not guess package scripts. If `checkPlan` reports a
missing ID, configure it and rerun `prepare` before implementation.

If semantic judgment is needed for a candidate Playbook/RCCL relationship, write a small JSON relation file:

```json
{
  "relations": [
    {
      "directiveId": "directive-id",
      "observationId": "observation-id",
      "relation": "conflicts",
      "rationale": "Why repository reality changes execution for this task.",
      "evidenceRefs": ["src/example.ts:10-24"],
      "confidence": 0.9
    }
  ]
}
```

Allowed relations are `supports`, `conflicts`, and `limits`. Resume with `--relation-file <path>`. Runtime validates active IDs, confidence, evidence presence, scope, lifecycle, and RCCL evidence status before the relation can affect execution.

## Implement

Use the compiled sections according to their actual behavior:

1. `guidance.required` — implementation constraints.
2. `guidance.tensions` — repository boundaries that require an explicit resolution.
3. `guidance.avoid` — prohibited patterns.
4. `guidance.consider` — relevant advice and repository observations that are not hard requirements.

Only these delivered items are evaluated after implementation. Optional items
excluded by an explicit selection remain visible in the Decision Trace and are
not silently evaluated.

The workflow runs the prepared command mappings during `complete`, records exit
codes and output digests, and writes stdout/stderr under ignored
`.resonant-code/context/`. Do not substitute host-declared pass/fail results.

## Complete

After implementation write an attestation JSON file. It contains semantic host
judgments and approved exceptions only; `changes`, `checks`, and legacy
`evidence` fields are rejected:

```json
{
  "attestations": [
    {
      "guidanceId": "directive-id",
      "verdict": "satisfied",
      "attestedBy": "coding-agent",
      "explanation": "The implementation preserves the existing public shape and changes only the requested branch.",
      "evidenceRefs": [
        {
          "kind": "diff",
          "ref": "diff:src/example.ts",
          "file": "src/example.ts"
        }
      ]
    }
  ],
  "exceptions": []
}
```

Then run:

```sh
node <skill-directory>/scripts/code.mjs complete \
  --session <session-path> \
  --evaluation-file <path>
```

Evidence kinds are `diff`, `file`, `check`, and `semantic`. Diff/file refs must
name a workflow-collected changed file. Check refs must name a
workflow-collected passing check. Semantic refs require a concrete description.
Every attestation requires `attestedBy` and an explanation.

During `complete`, the workflow runs the prepared checks, snapshots the current
worktree, and computes exact baseline-to-current add/modify/delete operations.
An exact unique-content move is reported as a rename; ambiguous same-content
moves remain explicit add/delete facts. If no attestation file is provided,
completion still records machine facts but reports semantic guidance as
unverified. Standard mode reports warnings; strict mode requires an exception
for unverified required guidance.

Hard violations reject the change. Approved exceptions require a non-empty reason, `status: "approved"`, and `approvedBy`.

Only evidence-backed satisfied, violated, and excepted results enter bounded feedback. Unverified results do not update quality rates.

## Inspect

```sh
node <skill-directory>/scripts/code.mjs explain --session <session-path>
node <skill-directory>/scripts/code.mjs doctor <project-root>
```

`explain` returns the full decision and evaluation. Default `prepare` output remains compact. `doctor` reports Runtime/RCCL build readiness and whether local Playbook, RCCL, and verified feedback sources exist.
