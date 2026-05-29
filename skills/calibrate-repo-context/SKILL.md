---
name: calibrate-repo-context
description: "Generate RCCL (Repository Context Calibration Layer) through a staged agent workflow, then write back statically verified calibration data."
metadata:
  version: "0.2.0"
  author: "Sovea"
---

# Calibrate Repository Context

Generate `.resonant-code/rccl.yaml` for the current repository.

RCCL is not a repo wiki or full codebase summary. It is a compact set of observational
signals that materially affect code generation, modification, and review quality.

This skill uses a multi-stage host-agent workflow:

1. Discover candidate signals from sampled repository slices.
2. Critique those signals for weak evidence, overgeneralization, duplication, and counterexamples.
3. Synthesize reviewed signals into candidate RCCL YAML.
4. Commit through deterministic parsing, consolidation, evidence verification, induction verification, and final emission.

The agent performs semantic judgment in the staged artifacts. The script owns schemas, artifact validation, and the final trust boundary.

## Instructions

## Default incremental workflow

For task-time or small follow-up calibration, prefer the incremental prepare path:

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs prepare-incremental <project-root> [--target-file <path>] [--changed-file <path>] [--scope <glob>] [--mode <task-scoped|changed-files|full>]
```

This writes RCCL-owned cache artifacts under `.resonant-code/context/cache/rccl/`
and may return an `rccl-observation-refresh` contract. Fulfill that contract with
a structured YAML refresh proposal only when Runtime/RCCL requests it. The host
agent may propose keep/revise/retire/new observations, but RCCL remains the
deterministic boundary for schema validation, evidence verification,
consolidation, lifecycle handling, and final writes.

Use the full staged workflow below when doing broad repository calibration.

### Step 1 - Prepare discovery stage

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs prepare-stage <project-root> --stage discover [--scope <glob>]
```

Where:
- `<project-root>` is the repository to calibrate, usually `.`
- `--scope` optionally narrows analysis, default `auto`

The script prints JSON with an inline `prompt`, `suggestedArtifactPath`, metadata, and optional debug artifact paths.
Use the prompt as your own input and write the discovery YAML to `suggestedArtifactPath` or another file.

Discovery artifacts must use:

```yaml
version: "1.0"
stage: discover
generated_at: <auto-filled-or-null>
scope: "<scope>"
seeds:
  - seed_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<observed-pattern>"
    decision_impact: "<why-this-affects-code-decisions>"
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    source_slice_ids: ["<slice-id>"]
    uncertainty: "<optional-limit-or-null>"
```

### Step 2 - Prepare critique stage

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs prepare-stage <project-root> --stage critique --discovery <path-to-discovery-yaml> [--scope <glob>]
```

The script validates the discovery artifact before returning a critique prompt.
Use the prompt as your own input and write the critique YAML to the returned `suggestedArtifactPath` or another file.

Critique artifacts must use:

```yaml
version: "1.0"
stage: critique
generated_at: <auto-filled-or-null>
scope: "<scope>"
reviews:
  - seed_id: "obs-<seed-id-from-discovery>"
    disposition: <keep|revise|drop>
    reasons:
      - "<reason>"
    issues:
      - "<optional-issue>"
    counter_evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    recommended_scope_hint: "<optional-narrower-scope-or-null>"
```

Review every discovery seed exactly once.
Use `drop` for weak, redundant, summary-like, or non-decision-impacting seeds.
Use `revise` when the signal is useful but needs narrower scope, clearer wording, or better evidence.

### Step 3 - Prepare synthesis stage

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs prepare-stage <project-root> --stage synthesize --discovery <path-to-discovery-yaml> --critique <path-to-critique-yaml> [--scope <glob>]
```

The script validates both staged artifacts before returning a synthesis prompt.
Use the prompt as your own input and write candidate RCCL YAML to a file.

Candidate RCCL must use:

```yaml
version: "1.0"
generated_at: <auto-filled-or-null>
git_ref: <auto-filled-or-null>
observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
```

Critical candidate constraints:
- Every observation must include real `evidence` copied from provided windows.
- Use `provisional_id`, not final `id`.
- Use `scope_hint`, not final `scope`.
- Use `source_slice_ids` and optional `support_hint`, not final `support`.
- Do not include `verification` or `lifecycle`.
- `semantic_key` is required and must be stable kebab-case semantic identity.
- `confidence` must be between `0` and `1`.
- `adherence_quality` must be `good`, `inconsistent`, or `poor`.
- `category` must be one of `style`, `architecture`, `pattern`, `constraint`, `legacy`, `anti-pattern`, `migration`.
- Prefer fewer, stronger observations; omit weak or unverifiable signals.

### Step 4 - Validate, verify, and commit

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs commit <project-root> --input <path-to-yaml-file|-> [--debug-artifacts]
```

The commit phase performs five things:
1. Parse generated YAML into candidate observations.
2. Deterministically consolidate candidates into final observations.
3. Static evidence verification against the repository.
4. Induction verification for scope/support quality.
5. Write the current verified calibration result authoritatively to `.resonant-code/rccl.yaml`.

It only emits commit-time debug artifacts under `.resonant-code/context/` for candidates and consolidation output when you pass `--debug-artifacts` or set `RESONANT_CODE_DEBUG_ARTIFACTS=1`.
When observations are demoted or kept with reduced confidence, stderr includes a compact verification summary so you can tune candidate quality instead of guessing.

Exit `0`: committed successfully. Parse stdout JSON:

```json
{
  "written": ".resonant-code/rccl.yaml",
  "stats": { "added": 5, "updated": 2, "preserved": 3 },
  "verification_summary": {
    "total_observations": 7,
    "kept_count": 5,
    "reduced_confidence_count": 1,
    "demoted_count": 1
  },
  "input": {
    "source": "stdin",
    "supportsStdin": true
  },
  "debugArtifacts": {
    "enabled": false
  }
}
```

Print a confirmation:

```text
RCCL calibration complete - .resonant-code/rccl.yaml updated.

Added:     <stats.added> observations
Updated:   <stats.updated> observations
Preserved: <stats.preserved> observations
```

Exit `1`: validation failed. Report structured errors from stderr and do not write the file manually.

## Legacy one-shot mode

For quick compatibility checks, the old one-shot prepare command remains available:

```sh
node <this-skill-directory>/scripts/calibrate-repo-context.mjs prepare <project-root> [--scope <glob>]
```

The one-shot prepare output includes the legacy prompt plus an RCCL-owned `contract` envelope and `candidateArtifact` metadata for the `rccl-observation-generation` host artifact. Host Claude may write candidate YAML to that suggested path, but `commit` remains the only deterministic parse, verification, and write boundary.

Prefer the staged workflow for real calibration because it separates semantic discovery, critique, and synthesis before the deterministic commit boundary.
