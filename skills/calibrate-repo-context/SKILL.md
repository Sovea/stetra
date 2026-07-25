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

Inspect the repository with normal host tools, then select the exact source
windows that could support a decision-relevant observation. RCCL does not
choose or rank files, and it does not infer meaningful ranges from syntax.

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs prepare <project-root> \
  --evidence <repository-file>:<start>-<end> \
  [--evidence <repository-file>:<start>-<end>] \
  > <prepare-output.json>
```

At least one explicit window is required. A request accepts at most 20 windows,
each at most 200 lines, and at most 128 KiB of source in total. These are
operational bounds, not semantic selection rules.

The returned JSON contains a contract with the exact evidence text, stable
window IDs, a context fingerprint, and the proposal schema. Keep the complete
prepare output for commit.

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
    evidence:
      - windowId: "window:<from-contract>"
```

Categories are `architecture`, `constraint`, `compatibility`, `legacy`, `anti-pattern`, `migration`, and `convention`.

Decision dimensions are `compatibility`, `api-shape`, `architecture-boundary`, `data-flow`, `migration`, `testing`, `error-handling`, `module-format`, and `review-focus`.

Prefer zero observations over weak observations.

## Commit

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs commit <project-root> \
  --contract <prepare-output.json> \
  --input <proposal.yaml|proposal.json|-> \
  [--rccl-path <path>]
```

RCCL verifies the contract fingerprint and checks every exact source window
again. A changed window, mismatched request, or evidence reference outside the
contract is rejected without modifying `.resonant-code/rccl.yaml`.

RCCL validates schema, unique IDs, decision impact, decision dimensions, and
exact evidence integrity. It owns `reviewStatus`, `approval`,
`evidenceVerification`, and `lifecycle`; proposals cannot set those fields.
New or changed proposals are always stored as `generated`. Recommitting
identical content preserves an existing valid approval.

Evidence verification proves only that cited source excerpts still exist. It does not prove that the observation's semantic statement is universally true. Semantic confidence and human review status remain separate fields.

## Approve

Review the stored statement, decision impact, confidence, scope, and evidence.
Approval is a separate explicit action:

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs approve <project-root> \
  --id <observation-id> \
  [--id <observation-id>] \
  --approved-by <reviewer>
```

Approval requires fully current evidence and records reviewer attribution,
timestamp, and the exact observation content fingerprint. Changing semantic
content, confidence, scope, or evidence invalidates it. `approvedBy` is an
auditable attribution supplied by the host; it is not an authentication
mechanism.

## Validate And Refresh

```sh
node <skill-directory>/scripts/calibrate-repo-context.mjs validate <project-root>
node <skill-directory>/scripts/calibrate-repo-context.mjs refresh-stale <project-root>
```

`validate` checks current evidence without writing. `refresh-stale` writes current evidence states back to RCCL. Evidence states are `current`, `partial`, `stale`, and `broken`.

Stale or broken observations can provide ambient context but cannot change
directive execution. Restoring evidence currency does not create semantic
approval; generated observations still require the separate approve action.
