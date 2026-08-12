# Change workflow

This document defines the executable Host/CLI workflow for the initial version
of `cognitive-adoption`, schema `1`. As the initial persisted schema, it has no
translator, alias, dual read/write, or migration path.

## Commands and Host projection

```sh
stetra change prepare . --input - --json
stetra change collect . --task <task-id> --json
stetra change diagnose . --task <task-id> --input - --json
stetra change revise-verification . --task <task-id> --input - --json
stetra change challenge . --task <task-id> --input - --json
stetra change handoff . --task <task-id> --input - --json
stetra change decide . --task <task-id> --input - --json
stetra change resolve . --task <task-id> --input - --json
stetra change explain . --task <task-id> --section action --json
stetra change explain . --task <task-id> --section all --json
```

All authoring input uses stdin or a file outside the worktree. Every successful
stage returns a structured `hostAction` with action kind, optional exact argv,
optional generated-reference name, and—when input is required—a task-specific
`authoringPacket`.

Use the packet's binding metadata, exact reference catalog, outstanding
obligations, prefilled draft, and `fieldRequirements`. Each field requirement
names an exact draft path, its Agent/Human authority, and either accepted enum
values or object variants. It supplies structure without selecting a judgment.
The packet's `semanticContext` presents the exact developer event as Human
authority and the Host-authored task meaning as a separate Agent interpretation.
Do not silently substitute one for the other.

An input-bearing action also returns:

```json
{
  "inputBinding": {
    "transport": "stdin",
    "source": "authoringPacket.draft",
    "serialization": "json",
    "execution": "one-shot"
  }
}
```

Serialize the completed draft and attach it to the exact argv process at
creation time. Do not start an interactive process and then attempt to type the
document. A temporary fallback input must live outside the worktree.
The packet is transient projection, not persisted authority or lifecycle state.
JSON output places `hostAction` before result detail. Authoring catalogs are
stage-specific rather than a universal copy of all task facts. Use
`--section action` to regenerate the current action and exact draft without
changing task state.

## Prepare

```json
{
  "protocol": "cognitive-adoption",
  "schemaVersion": "1",
  "prepareRequestId": "prepare:host-generated-once",
  "developerEvent": {
    "content": "exact developer message",
    "provider": "host"
  },
  "repositoryEvidence": [
    { "key": "ownership", "path": "src/file.ts", "startLine": 1, "endLine": 20 }
  ],
  "task": {
    "desiredOutcome": "Agent interpretation of the requested outcome",
    "constraints": [],
    "nonGoals": [],
    "focus": ["src/file.ts"]
  },
  "conditions": [
    {
      "key": "compatibility",
      "statement": "Existing callers retain the required behavior.",
      "rationale": "A mismatch changes adoption.",
      "criticality": "adoption-critical",
      "basis": {
        "developerEvent": true,
        "repositoryEvidenceKeys": ["ownership"]
      },
      "evidenceObligations": [
        {
          "key": "legacy-path",
          "statement": "The legacy call path preserves its observable behavior.",
          "failureHypothesis": "The new branch may bypass the legacy path.",
          "strategies": [
            {
              "kind": "runtime-check",
              "checkKeys": ["compatibility-test"]
            },
            { "kind": "independent-challenge", "policy": "fact-triggered" }
          ]
        }
      ]
    }
  ],
  "hostPolicyRequirements": [
    {
      "key": "no-web",
      "capability": "web-search",
      "requiredState": "disabled",
      "enforcementRequirement": "required",
      "rationale": "The task requires a retrieval-isolated run."
    }
  ],
  "delivery": { "maxRepairAttempts": 2 },
  "checks": [
    {
      "key": "compatibility-test",
      "rationale": "Exercises the public compatibility path.",
      "argv": ["package-manager", "test"],
      "baseline": {
        "mode": "task-start",
        "rationale": "Before/after distinguishes a new regression from a prior failure.",
        "obligationKeys": [
          { "conditionKey": "compatibility", "obligationKey": "legacy-path" }
        ]
      },
      "commandDefinitionPaths": ["package.json"],
      "acceptanceSurfacePaths": ["test/compatibility.test.ts"]
    }
  ]
}
```

Routine work may use no Conditions. Every declared Condition requires at least
one falsifiable Evidence Obligation. Adoption-critical Conditions require an
independent Challenge or direct Human review strategy.

`task-start` baseline requires a decision-relevant rationale and exact
Obligation keys. Use `{ "mode": "unknown" }` when before/after comparison does
not change the decision. If no command applies, omit `checks` and provide
`noCommandRationale`.

Core generates canonical Human Event, Condition, Obligation, logical Verifier,
exact Definition, Contract, Verification Plan, and effective identities. Focus
paths guide work; they are not permissions.

The Host generates `prepareRequestId` once for one concrete submission and
reuses the exact ID and document after transport interruption. The first
successful Prepare binds the ID to the exact input fingerprint. An identical
retry returns `prepare-replayed` with the existing task and does not rerun a
task-start baseline. Different input under the same ID is rejected; a genuinely
new request uses a new ID. The task directory identity is deterministically
derived from this explicit request ID, so overlapping transport attempts cannot
publish two tasks. Runtime never deduplicates by semantic similarity.

Non-empty baseline logs are recorded against their final task-owned path before
atomic publication, so `change explain --section baseline` never returns a
staging path that becomes invalid when the task is published.

Thin Markdown adapters can only record Host policy as `instruction-only`. A
required unenforced policy returns an executable `change resolve` action before
collection. A trusted programmatic Adapter/Evaluator may inject `enforced`
attestation; Agent input cannot.

## Implement and collect

Full collection and timeout recovery:

```sh
stetra change collect . --task <task-id> --json
stetra change collect . --task <task-id> --timeout-ms 600000 --json
stetra change collect . --task <task-id> \
  --retry-check '<definition-id>=900000' --json
```

Runtime executes every exact current Definition without a shell. Each Attempt
records `startedAt`, `durationMs`, timeout budget, status, structured
termination (`exit`, `signal`, `timeout`, or `spawn-error`), an outcome
fingerprint, complete stream digests, bounded logs, and optional reason.
`outcomeFingerprint` binds status, termination, timeout budget, and both stream
digests; it is not a combined output digest. Timeout retry is allowed only after
the latest Attempt terminated as a timeout, with an unchanged worktree and
larger budget.

Collection returns the actual changed-file set, patch, baseline relation,
Verifier mutations, environment facts, and the next task-specific packet.

## Diagnose evidence

Use the returned diagnosis draft; it already contains every current non-passing
`definitionId` exactly once:

```json
{
  "semanticImpact": "none",
  "proposedRoute": "repair-implementation",
  "routeRationale": "Why this route addresses every declared cause.",
  "entries": [
    {
      "definitionId": "sha256:exact-definition",
      "cause": "implementation",
      "diagnosis": "Concrete fact-bound cause judgment.",
      "falsificationAttempt": "What was inspected or attempted.",
      "codeChangeCanAlterObservation": true,
      "expectedDifferentObservation": "What the next Runtime Attempt should observe.",
      "intendedChanges": ["Bounded intended edit."]
    }
  ]
}
```

Cause is exactly `implementation`, `environment`, `verification`, or `unknown`.
Only implementation cause may propose code edits. Runtime validates identity and
coverage and checks that every cause is compatible with the proposed route; it
never guesses cause or route from output. Implementation may repair or hand
off. Environment and verification may revise verification or hand off. Unknown
may challenge, hand off, or ask the developer. Material semantic impact must ask
the developer. Explicit routing is documented in [Architecture](architecture.md).

When one collection has both implementation and environment or verification
failures, `repair-implementation` is valid if at least one entry supplies the
bounded implementation edit. The other entries authorize no edits, remain
visible, and are rerun in the successor Attempt. An unknown cause still cannot
be repaired.

## Revise verification

A noncritical verification diagnosis returns an exact revision draft:

```json
{
  "kind": "execution-rebinding",
  "rationale": "Why the immutable command definition must change.",
  "equivalenceClaim": "Agent claim about the bounded engineering equivalence.",
  "checks": [
    {
      "key": "compatibility-test",
      "rationale": "unchanged for execution-rebinding",
      "argv": ["new-entry", "test"],
      "baseline": {
        "mode": "task-start",
        "rationale": "Before/after distinguishes a new regression from a prior failure.",
        "obligationKeys": [
          { "conditionKey": "compatibility", "obligationKey": "legacy-path" }
        ]
      },
      "commandDefinitionPaths": ["package.json"],
      "acceptanceSurfacePaths": ["test/compatibility.test.ts"]
    }
  ]
}
```

`execution-rebinding` may change argv only; all other fields in its complete
Check list must remain exact. Use `verification-plan` for broader
changes. Removing a Verifier, task-start baseline, or verifier surface requires:

```json
{
  "humanAuthorization": {
    "content": "exact developer authorization",
    "provider": "host"
  }
}
```

The revision preserves `semanticContractId`, creates new Verification Plan and
effective identities, supersedes exact Definitions, preserves old facts, and
starts a `verification-revision` successor Attempt. Original baseline is
reported as unknown after revision unless it can be honestly reconstructed;
the current MVP does not claim isolated reconstruction.

## Challenge

Use the Challenge packet. Agent input contains no ID or independence claim:

```json
{
  "obligationIds": ["obligation:exact"],
  "failureHypothesis": "Concrete way the bounded conclusion could be wrong.",
  "evidence": {
    "changedFiles": ["file:exact"],
    "checks": ["sha256:exact-definition"],
    "repositoryEvidence": [],
    "humanEvents": ["event:exact"],
    "patch": true
  },
  "falsificationAttempt": "Independent inspection or execution.",
  "supportingEvidence": [
    {
      "statement": "Bounded supporting observation.",
      "references": [{ "kind": "check", "id": "sha256:exact-definition" }]
    }
  ],
  "counterEvidence": [],
  "outcome": "supported",
  "conclusion": "Bounded conclusion."
}
```

CLI generates Challenge ID and derives Condition IDs. A trusted Host provider
may inject fresh-context attestation. Thin skills remain `unverified`. Once an
Obligation has a recorded Challenge, the next route is Handoff; adverse or
unverified results remain exact Attention and cap conclusions instead of
causing an endless Challenge loop.

Generated Markdown skills do not control a fresh Host context, so Dynamic Host
Projection does not ask them to manufacture an independent Challenge. It routes
directly to Handoff, marks the missing Challenge as a concrete direct-review
obligation, and rejects `supported` for the affected obligation. A native
Adapter or Evaluator with an attestation provider retains the executable
Challenge action. A manually submitted thin-context Challenge is still recorded
as `unverified`.

## Handoff

The packet prepopulates current IDs and evidence references. The Agent fills:

Passing Check Facts are prefilled under `evidence`; non-passing, unavailable,
or timed-out Check Facts are prefilled under `counterEvidence`. Planned
strategy coverage is validated across both arrays, so adverse evidence remains
bound to the Obligation without being mislabeled or duplicated as support.

```json
{
  "summary": "What the actual change means for adoption.",
  "obligationConclusions": [
    {
      "obligationId": "obligation:exact",
      "status": "supported",
      "evidence": [{ "kind": "check", "id": "sha256:exact-definition" }],
      "falsificationAttempt": "What tried to expose the stated failure.",
      "counterEvidence": [],
      "conclusion": "Bounded evidence conclusion."
    }
  ],
  "conditionConclusions": [
    {
      "conditionId": "condition:exact",
      "status": "supported",
      "summary": "Does not exceed Obligation results."
    }
  ],
  "importantSystemEffects": [],
  "residualUnknowns": [],
  "reviewQuestions": [
    {
      "conditionIds": ["condition:exact"],
      "obligationIds": ["obligation:exact"],
      "question": "What should the developer inspect directly?",
      "adoptionImpact": "Which wrong decision this can prevent.",
      "evidence": [{ "kind": "patch" }]
    }
  ],
  "recommendation": {
    "action": "accept",
    "rationale": "Agent recommendation, not Human adoption.",
    "caveats": []
  }
}
```

CLI generates Handoff and Review Question IDs. Every Obligation and Condition is
concluded exactly once. Runtime rejects a supported Condition when any
Obligation is partial, contradicted, unknown, or missing. It validates exact
evidence coverage but does not claim the natural-language statement is true.

Worktree edits after collection return `facts-stale` before handoff parsing.

The successful result contains one normalized `decisionPacket`: exact Human
authority, compact Semantic Contract, Agent recommendation and system meaning,
one Condition/Obligation view, full Attention once, Review Questions, current
check/log and changed-file summaries, compact evidence judgments, and named
detail sections. It does not embed full Contract, Facts, Handoff, Evaluation,
and a second review tree. Use `change explain` for those canonical details.

## Decide and correct

```json
{
  "humanEvent": {
    "content": "exact developer message",
    "provider": "host"
  },
  "action": "accepted",
  "reason": "Reason tied to the exact message.",
  "exceptions": []
}
```

CLI generates Decision and Human Event IDs. Acceptance with Attention must name
every current Attention ID and rationale. Decide never commits, merges,
publishes, deploys, or activates cross-task state.

`correction-requested` returns `change resolve`. The resolution binds the exact
Decision ID; `continue-current-contract` creates a lineage-linked correction
Attempt and preserves the prior Handoff, Decision, facts, and events.

Mid-task semantic-impact and Host-policy decisions use the same `resolve`
command with a packet-prefilled target. Actions are
`continue-current-contract`, `request-correction`, and `abort`.

## Inspect

```sh
stetra change explain . --task <task-id> --section contract --json
stetra change explain . --task <task-id> --section baseline --json
stetra change explain . --task <task-id> --section action --json
stetra change explain . --task <task-id> --section plan --json
stetra change explain . --task <task-id> --section attempts --json
stetra change explain . --task <task-id> --section challenge --json
stetra change explain . --task <task-id> --section revision --json
stetra change explain . --task <task-id> --section handoff --json
stetra change explain . --task <task-id> --section decision --json
stetra change explain . --task <task-id> --section events --json
```

Unsupported shapes fail with actionable errors and write no compatibility state.
