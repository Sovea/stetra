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

Run the commands listed in `verificationPlan.commands`. A command ID is logical; select the repository's canonical command for that check.

## Complete

After implementation write an evaluation JSON file:

```json
{
  "changes": {
    "files": [
      { "path": "src/example.ts", "status": "modified" }
    ]
  },
  "checks": [
    {
      "id": "typecheck",
      "status": "passed",
      "command": "pnpm typecheck",
      "outputRef": "terminal:typecheck"
    }
  ],
  "evidence": [
    {
      "guidanceId": "directive-id",
      "verdict": "satisfied",
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

Evidence kinds are `diff`, `file`, `check`, `semantic`, and `static`. Diff/file evidence must name a file in the supplied change set. Check evidence must reference a supplied passing check. Semantic evidence requires a concrete description.

If no evaluation file is provided, completion records an unverified result. Standard mode reports warnings; strict mode requires an exception for unverified required guidance.

Hard violations reject the change. Approved exceptions require a non-empty reason, `status: "approved"`, and `approvedBy`.

Only evidence-backed satisfied, violated, and excepted results enter bounded feedback. Unverified results do not update quality rates.

## Inspect

```sh
node <skill-directory>/scripts/code.mjs explain --session <session-path>
node <skill-directory>/scripts/code.mjs doctor <project-root>
```

`explain` returns the full decision and evaluation. Default `prepare` output remains compact. `doctor` reports Runtime/RCCL build readiness and whether local Playbook, RCCL, and verified feedback sources exist.
