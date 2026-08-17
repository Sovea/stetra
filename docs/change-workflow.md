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
stetra change guard-final . --task <task-id> --json
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
The packet's `semanticContext` presents the exact developer events as Human
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

After a current Handoff is evaluated, `hostAction` changes role. It returns a
transient `developerDecisionBrief` containing the four separate delivery,
evidence, Agent-recommendation, and Human-adoption states; desired outcome and
actual system meaning; every condition conclusion; direct-cause decision
issues; linked review questions; and compact Runtime evidence. The accompanying
`presentationRequirements` names every condition, issue, and question that the
Host must preserve in its final cognitive handoff.

The Human decision command is not the current action at that point. It appears
under `decisionContinuation` with `requiresNewHumanEvent: true`. The Host
presents the brief, states that adoption remains pending, asks the developer
for a decision, and stops. Only a later developer message authorizes filling
the nested Human Authoring Packet and executing `change decide`.

Before any Host final response, `change guard-final` re-reads the exact task and
current worktree without writing state. It returns one disposition:

- `continue-workflow`: follow the returned current `hostAction`;
- `present-decision-brief`: present the returned current brief and stop for the
  developer's decision;
- `human-decision-recorded`: report the recorded terminal decision.

The guard also returns fact currency, task revision, and a fingerprint of the
projected action. Generated skills instruct this call but do not claim that a
Markdown file enforces a Host hook. A native Host integration may enforce the
same command at its final-response boundary. The published
`@sovea/stetra/host` subpath exposes `runCli`, `guardFinalResponse`, exact Host
projection types, and the `HostAttestationProvider` boundary for that purpose.
Importing it grants no authority by itself: only an embedding process that
actually controls tools, contexts, and the response boundary may report
enforcement or independent-context provenance.

## Prepare

```json
{
  "protocol": "cognitive-adoption",
  "schemaVersion": "1",
  "prepareRequestId": "prepare:host-generated-once",
  "developerEvents": [{
    "key": "request",
    "content": "exact developer message",
    "provider": "host"
  }],
  "repositoryEvidence": [
    { "key": "ownership", "path": "src/file.ts", "startLine": 1, "endLine": 20 }
  ],
  "task": {
    "basis": {
      "developerEventKeys": ["request"],
      "repositoryEvidenceKeys": []
    },
    "desiredOutcome": "Agent interpretation of the requested outcome",
    "constraints": [],
    "nonGoals": [],
    "focus": ["src/file.ts"]
  },
  "materialDecisionForks": [],
  "conditions": [
    {
      "key": "compatibility",
      "statement": "Existing callers retain the required behavior.",
      "rationale": "A mismatch changes adoption.",
      "criticality": "adoption-critical",
      "basis": {
        "developerEventKeys": ["request"],
        "repositoryEvidenceKeys": ["ownership"]
      },
      "evidenceObligations": [
        {
          "key": "legacy-path",
          "statement": "The legacy call path preserves its observable behavior.",
          "falsification": {
            "failureHypothesis": "The new branch may bypass the legacy path.",
            "scenario": "Exercise the legacy call through the new branch.",
            "supportingObservation": "The legacy call retains its observable behavior.",
            "contradictingObservation": "The new branch bypasses or changes the legacy call."
          },
          "strategies": [
            {
              "kind": "runtime-check",
              "checkKeys": ["compatibility-test"]
            },
            { "kind": "independent-challenge", "policy": "required" }
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
      "verifierSelectors": [
        { "kind": "file", "path": "package.json", "role": "command-definition" },
        { "kind": "tree", "path": "test", "role": "acceptance-surface" }
      ]
    }
  ]
}
```

Routine work may use no Conditions. Every declared Condition requires at least
one falsifiable Evidence Obligation. Adoption-critical Conditions require a
`required` independent Challenge or direct Human review strategy;
`fact-triggered` alone is insufficient.

Every Obligation freezes one discriminating design: the plausible failure, a
specific scenario, the observation that supports the bounded conclusion, and
the observation that contradicts it. Runtime validates completeness and later
binding; it does not decide whether those natural-language statements are
semantically adequate.

Verifier selectors are explicit `file` or `tree` boundaries with one role.
`file` matches only the exact current or previous path. `tree` matches its root
and descendants by repository path boundary. There are no globs, regular
expressions, filesystem-type guesses, or framework filename rules.

`task-start` baseline requires a decision-relevant rationale and exact
Obligation keys. Use `{ "mode": "unknown" }` when before/after comparison does
not change the decision. If no command applies, omit `checks` and provide
`noCommandRationale`.

Core generates canonical Human Event, Condition, Obligation, logical Verifier,
exact Definition, Contract, Verification Plan, and effective identities. Focus
paths guide work; they are not permissions.

`materialDecisionForks` records only choices that change task meaning, an
explicit constraint, public behavior, compatibility, ownership, a long-lived
tradeoff, an external effect, verification relaxation, or an exception. The
Agent or another planning framework discovers and explains those choices.
Runtime validates their exact basis and resolution binding; it does not infer
semantic ambiguity. An unresolved fork returns `semantic-decision-required`,
one consolidated `clarificationBrief`, and no task. The Host presents that
brief once and stops. After a new developer message, it appends the exact event,
binds the fork resolution to that event, updates the final task basis, and
re-runs Prepare. A Trellis-style Host that already completed clarification
submits the resolved fork once and remains the sole owner of developer dialogue.

The Host generates `prepareRequestId` once for one concrete submission. It may
reuse that ID while resolving a pre-task material fork because no task exists
yet, and reuses the exact ID and document after transport interruption. The first
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
stetra change collect . --task <task-id> --refresh --json
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

If the current Attempt already has a Fact Bundle and the current worktree
fingerprint still matches it, an ordinary Collect returns `facts-current` with
`collectionMode: reused-current`. It does not execute checks, append an event,
change revision, or discard a current Handoff. A changed worktree performs a
new full collection. `--refresh` explicitly reruns all frozen Definitions;
`--retry-check` remains the only append-only timeout-recovery path.

Collection returns the actual changed-file set, patch, baseline relation,
Verifier mutations, environment facts, and the next task-specific packet.

## Diagnose evidence

Use the returned diagnosis draft; it already contains every current non-passing
Check and current adverse Challenge exactly once:

```json
{
  "semanticImpact": "none",
  "proposedRoute": "repair-implementation",
  "routeRationale": "Why this route addresses every declared cause.",
  "entries": [
    {
      "source": {
        "kind": "check",
        "definitionId": "sha256:exact-definition"
      },
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

`source` is exactly a frozen Check definition or a current adverse Challenge.
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
      "verifierSelectors": [
        { "kind": "file", "path": "package.json", "role": "command-definition" },
        { "kind": "tree", "path": "test", "role": "acceptance-surface" }
      ]
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
  "falsification": {
    "failureHypothesis": "Concrete way the bounded conclusion could be wrong.",
    "scenario": "Specific boundary or counterexample to exercise.",
    "supportingObservation": "Observation supporting the bounded conclusion.",
    "contradictingObservation": "Observation contradicting the bounded conclusion."
  },
  "evidence": {
    "changedFiles": ["file:exact"],
    "checks": ["sha256:exact-definition"],
    "repositoryEvidence": [],
    "humanEvents": ["event:exact"],
    "patch": true
  },
  "falsificationAttempt": "Independent inspection or execution.",
  "observedResult": "What the independent attempt actually observed.",
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
may inject fresh-context attestation. Thin skills remain `unverified`. A
supported Challenge advances to the next required Challenge or Handoff. A
partial, contradicted, or unknown Challenge returns to the Implementer through
the existing evidence-diagnosis action. The diagnosis may choose bounded
repair, verification revision, Human resolution, or Handoff, but may not send
the same adverse Challenge to another Challenger.

Repair and recollection never erase Challenge history. Only Challenges bound
to the current effective Contract, Attempt, and Fact Collection can satisfy a
current obligation; `change explain --section challenge` retains prior adverse
findings and their lineage.

Challenge input must preserve the exact frozen falsification design for every
selected Obligation. Obligations with different designs are challenged
separately. The Agent records both the action and observed result before
choosing a bounded outcome.

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
      "falsification": {
        "attempt": "What tried to execute or inspect the frozen scenario.",
        "observedResult": "What that attempt actually observed."
      },
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
Every missing, adverse, or unverified required Challenge also requires a Review
Question bound to the exact affected Obligation; a broad Condition-only
question cannot discharge it.

Agent recommendation cannot exceed the current evidence. `accept` is rejected
when any Condition or Obligation is not supported, a residual unknown remains,
a current check is non-passing, required Challenge provenance or outcome is
unresolved, a required Host policy is unenforced, repair is exhausted, or the
change is unrepresentable. The Agent must use `request-correction`, `defer`, or
`reject`; only a later exact Human decision may accept current Attention with
explicit exceptions.

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
