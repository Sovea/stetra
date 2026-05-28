---
name: code
description: "Skill for implementing, modifying, fixing, or refactoring code. It compiles task-time guidance through Runtime, applies the compiled EGO during implementation, and writes quality signals back to the lockfile after the task."
metadata:
  version: "0.1.0"
  author: "Sovea"
---

# Code And Modify With Runtime Guidance

Use this skill for concrete coding work:

- implement a feature
- modify existing code
- fix a bug
- refactor an area without redesigning the whole system

If the user is asking for actual code changes, this is the skill that should be used.
Its primary job is coding. Runtime integration exists to guide that coding work, not to
replace it.

This skill is a thin Runtime workflow consumer. Runtime owns task interpretation, semantic proposal schemas, prompt contracts, validation, adjudication, EGO assembly, Decision Trace, and lockfile feedback. The public skill command only orchestrates those contracts and applies the compiled result during implementation.

Do not read or merge playbook files manually.
Do not reconstruct EGO logic in the skill.
Do not use raw playbook YAML as the primary prompt input.
Do not create ad hoc host-agent schemas or prompts in this skill.

Use Runtime to emit AI contract artifacts for host Claude when semantic assistance is useful. Host Claude may fulfill those contracts by writing JSON artifacts, but Runtime remains authoritative for normalization, validation, and final deterministic decisions.

Use the Runtime to compile guidance for the current coding task, then use the
compiled `ego` while actually implementing the requested code change.

## Instructions

### Default Step 1 - Auto plan and compile task guidance

For normal coding work, start with the auto workflow:

```sh
node <this-skill-directory>/scripts/code.mjs auto <project-root> --task "<user task>" [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

`auto` asks Runtime to produce a guidance plan. Runtime may return `contracts-required`
with one or more Runtime-owned AI contracts, usually `guidance-planning` and
`task-interpretation` first. Fulfill only those listed contracts by writing the
requested JSON artifact(s), then re-run `auto` with the artifact path flags:

```sh
node <this-skill-directory>/scripts/code.mjs auto <project-root> --task "<user task>" --planning-file <path> --candidate-file <path>
```

If Runtime later requests `semantic-candidate` or `semantic-relation`, fulfill
those contract artifacts and re-run `auto` with `--semantic-proposal-file` or
`--host-proposal-file`.

Important:
- Host-agent semantic judgment enters only through Runtime-owned contracts.
- Do not replace contract fulfillment with ad hoc keyword heuristics or manual playbook parsing.
- Deterministic task parsing is fallback context and structural normalization, not the primary semantic signal when host contracts are available.
- When `auto` returns `status: "ok"`, use the compact `guidance` object for implementation. Use `explain --session <path>` only when the full Decision Trace is needed.

Useful supporting commands:

```sh
node <this-skill-directory>/scripts/code.mjs status <project-root>
node <this-skill-directory>/scripts/code.mjs explain --session <session-path>
```

### Advanced Step 1 - Compile task guidance manually

First, when the task is semantically ambiguous, run:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-interpretation <project-root> --task "<user task>" [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

This prints a Runtime-owned task-interpretation AI contract: prompt, schema, normalized task input, ambiguity hints, a suggested candidate artifact path, contract metadata, and a structured recommendation for whether AI-assisted interpretation is worth using. Use host Claude to produce a JSON candidate file when that recommendation says it is useful.

`prepare-interpretation` is the preferred first step when the task leaves room for semantic interpretation, because it gives you a standard Runtime contract and candidate path instead of ad hoc host-side guessing.

Then run:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-relations <project-root> --task "<user task>" [--candidate-file <path>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

This prints a Runtime-owned semantic-relation AI contract: resolved task context, active directive summaries, RCCL observation summaries, proposal prompt, proposal schema, allowed ids, and a suggested semantic relation artifact path. Use host Claude to write a JSON `HostSemanticRelationProposalPayload` at that path. The host proposal should use only listed directive and observation ids, and should only connect pairs whose task-level semantic relation is justified by the provided summaries.

When you want a lighter semantic shortlist before explicit relation adjudication, run:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-semantic-candidates <project-root> --task "<user task>" [--candidate-file <path>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

This prints a Runtime-owned semantic-candidate AI contract. Host Claude may write a JSON `HostSemanticCandidateProposalPayload`, and Runtime will deterministically validate, filter, downgrade, or ignore candidates during compile.

Then run:

```sh
node <this-skill-directory>/scripts/code.mjs prepare <project-root> --task "<user task>" [--candidate-file <path>] [--host-proposal-file <path>] [--semantic-proposal-file <path>] [--target-file <path>] [--changed-file <path>] [--tech <name>] [--tag <name>] [--operation <create|modify|bugfix|refactor>]
```

Pass `--changed-file` for each known changed or directly relevant file.
Pass `--tech` only when there is a strong hint not already obvious from the target file.
Pass `--candidate-file` only when host Claude produced a structured interpretation candidate from the Runtime task-interpretation contract.
Pass `--host-proposal-file` when host Claude produced a structured semantic relation proposal from `prepare-relations`.
Pass `--semantic-proposal-file` when host Claude produced a structured semantic candidate proposal from `prepare-semantic-candidates`.
If `prepare-interpretation` recommended AI assistance, use its suggested candidate path so the flow stays consistent across `prepare-interpretation`, `prepare-relations`, `prepare-semantic-candidates`, and `prepare`.
Do not infer semantic relations manually from raw YAML or recreate EGO logic in the skill; use Runtime contract outputs and pass host proposal artifacts back into Runtime.

The script prints JSON:

```json
{
  "status": "ok",
  "sessionPath": "<path>",
  "ego": { "...": "compiled guidance object" },
  "trace": { "...": "decision trace" },
  "warnings": [],
  "interpretation": {
    "mode": "assistive-ai",
    "candidateFile": "<path-or-null>",
    "summary": ["..."],
    "nextStep": "..."
  },
  "fulfillment": {
    "status": "accepted",
    "taskInterpretation": {
      "provided": true,
      "path": "<path-or-null>",
      "status": "accepted",
      "diagnostics": {
        "summary": {
          "accepted": 1,
          "rejected": 0,
          "downgraded": 0,
          "unused": 0
        }
      }
    },
    "semanticRelation": { "provided": true, "path": "<path-or-null>", "status": "accepted" },
    "semanticCandidate": { "provided": false, "path": null, "status": "absent" }
  }
}
```

Read `interpretation.summary` and `interpretation.nextStep` first when you want to understand whether the current prepare run was strong enough or whether you should generate and pass a candidate file.
Read `fulfillment` to see whether host artifacts were absent, accepted, partially accepted, rejected, or unused. Artifact diagnostics are deterministic Runtime validation summaries; use them to repair malformed, invalid-id, low-confidence, or capped proposals before implementing.

If `status` is `ok`:
- Use `ego.guidance.must_follow` as the operational constraints for implementation.
- Use `ego.guidance.avoid` to suppress bad patterns.
- Use `ego.guidance.context_tensions` to handle repository conflicts explicitly.
- Use `ego.guidance.ambient` only as background repository context.
- Treat `trace` as developer/debug output. Do not dump it to the user unless it helps explain a conflict or failure.

If `status` is `failed`:
- Stop before implementation and report the Runtime compile error briefly.
- Fix the Runtime issue or task interpretation input, then re-run prepare.
- Do not continue with generic fallback guidance or manually parse playbook YAML.

### Step 2 - Implement the task

Implement the requested code change using the compiled `ego` as the guidance layer.

Precedence while coding:
1. explicit user instructions
2. `ego.guidance.must_follow`
3. `ego.guidance.context_tensions`
4. local repository reality informed by `ego.guidance.ambient`
5. `ego.guidance.avoid`

Do not quote raw EGO sections back to the user as policy text.
Apply them in the code and in your technical decisions.

### Step 3 - Evaluate adherence (recommended)

After the implementation work is complete, evaluate which compiled directives were actually followed or ignored. First, request the adherence evaluation contract:

```sh
node <this-skill-directory>/scripts/code.mjs prepare-adherence --session <session-path>
```

This prints a Runtime-owned adherence-evaluation AI contract: a prompt listing all compiled directives, a JSON schema for the evaluation payload, and a suggested artifact path. Use host Claude to review the implementation against each directive and produce a per-directive verdict file.

Each verdict in the payload should include:
- `directive_id`: the directive being evaluated
- `verdict`: `followed`, `ignored`, or `partial`
- `confidence`: 0.0–1.0 indicating certainty of the assessment
- `reason`: brief explanation of the basis for the verdict
- `ignored_reason` (when verdict is `ignored`): one of `not-applicable`, `conflicts-with-task`, `too-broad`, `repo-reality`, `false-positive`, `user-corrected`, `other`

Then pass the evaluation artifact to `complete`:

```sh
node <this-skill-directory>/scripts/code.mjs complete --session <session-path> --adherence-file <path>
```

When an adherence artifact is provided, Runtime validates each verdict (structural checks, directive ID allowlist, confidence threshold >= 0.5), then uses the validated verdicts instead of the optimistic default to write lockfile feedback with `signal_confidence: 'explicit'`.

### Step 4 - Write lockfile feedback

If you skip the adherence evaluation step, run `complete` without `--adherence-file`:

```sh
node <this-skill-directory>/scripts/code.mjs complete --session <session-path> [--ignored <directive-id>] [--followed <directive-id>]
```

If you do not pass any directive ids, Runtime writes low-pollution task usage,
contract fulfillment, observation, and tension feedback only. It does not treat
all compiled directives as followed. Directive follow-rate and trend are updated
only from explicit directive ids or an accepted adherence evaluation artifact.

The script prints JSON:

```json
{
  "status": "updated",
  "lockfilePath": "<project-root>/.resonant-code/playbook.lock.yaml",
  "followedDirectiveIds": ["..."],
  "ignoredDirectiveIds": [],
  "adherence": {
    "provided": true,
    "status": "accepted",
    "verdictCount": 5,
    "diagnostics": { "...": "..." }
  }
}
```

The `adherence` field is included when `--adherence-file` was provided, showing validation results.

If completion is skipped because Runtime guidance was unavailable, report that briefly.
Do not manually write the lockfile.
