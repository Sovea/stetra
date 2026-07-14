---
name: calibrate-repo-context
description: "Create or refresh a small set of evidence-current repository observations that materially affect code decisions."
metadata:
  version: "0.0.1"
  author: "Sovea"
---

# Calibrate Decision-Relevant Repository Context

RCCL is not a repository summary. Store an observation only when removing it could cause an agent to make a different and worse implementation or review decision.

Good observations describe compatibility boundaries, public API shape, transaction or data-flow boundaries, migration phases, module-format constraints, legacy interfaces, or concrete anti-patterns.

Do not store package versions, schema existence, exported symbol lists, generic style descriptions, or facts that tools can read on demand unless they establish a durable decision boundary.

## Prepare

Prefer targeted calibration:

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs prepare <project-root> \
  --path <file-or-directory> \
  [--path <file-or-directory>] \
  [--max-files <n>]
```

If no path is supplied, RCCL chooses a bounded set of likely architecture and migration boundary files. The returned contract contains selected paths, evidence windows, a context fingerprint, and the proposal schema.

The host writes one YAML or JSON proposal using the exact `requestId` and `contextFingerprint`:

```yaml
schemaVersion: "1.0"
requestId: "<from-prepare>"
contextFingerprint: "<from-prepare>"
replace: false
observations:
  - id: "obs-public-api-boundary"
    category: "architecture"
    scope: "src/api/**"
    statement: "Public API construction is centralized in src/api/index.ts."
    affects: ["api-shape", "architecture-boundary"]
    decisionImpact: "Adding a second entrypoint would split the supported public API."
    semanticConfidence: "high"
    reviewStatus: "reviewed"
    evidence:
      - file: "src/api/index.ts"
        lineRange: [1, 24]
        snippet: "<exact excerpt from a supplied window>"
```

Categories are `architecture`, `constraint`, `compatibility`, `legacy`, `anti-pattern`, `migration`, and `convention`.

Decision dimensions are `compatibility`, `api-shape`, `architecture-boundary`, `data-flow`, `migration`, `testing`, `error-handling`, `module-format`, and `review-focus`.

Prefer zero observations over weak observations.

## Commit

Use the same path selectors as prepare:

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs commit <project-root> \
  --input <proposal.yaml|proposal.json|-> \
  --path <file-or-directory>
```

RCCL reissues the current contract. A stale request ID or context fingerprint is rejected without modifying `.resonant-code/rccl.yaml`.

RCCL validates schema, unique IDs, decision impact, decision dimensions, and exact evidence integrity. It owns `evidenceVerification` and `lifecycle`; proposals cannot set those fields.

Evidence verification proves only that cited source excerpts still exist. It does not prove that the observation's semantic statement is universally true. Semantic confidence and human review status remain separate fields.

## Validate And Refresh

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs validate <project-root>
node <skill-directory>/scripts/calibrate-repo-context.mjs refresh-stale <project-root>
```

`validate` checks current evidence without writing. `refresh-stale` writes current evidence states back to RCCL. Evidence states are `current`, `partial`, `stale`, and `broken`.

Stale or broken observations can provide ambient context but cannot change directive execution until refreshed with current evidence.
