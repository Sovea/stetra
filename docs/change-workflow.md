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
stetra change explain . --task <task-id> --section index --json
```

All authoring input uses stdin or a file outside the worktree. Every successful
stage returns a structured `hostAction` with action kind, optional exact argv,
optional generated-reference name, and—when Agent or Human authoring is
required—a task-specific `authoringPacket`. Independent Challenge instead uses
the smaller `challengeExecutionPacket` described below.
Every action also declares `executionRequirements`: continuous or fresh
context, target-worktree access, Stetra-state access, target or isolated
workspace, and the external-effect boundary. These requirements do not attest
their own enforcement; a trusted Host must apply the controls it claims.

Use the packet's binding metadata, exact reference catalog, outstanding
obligations, prefilled draft, and `fieldRequirements`. Each field requirement
names an exact draft path, its Agent/Human authority, and either accepted enum
values or a `shapeRef`. Reusable object variants are defined once in the
packet's `shapeCatalog`, avoiding a repeated schema copy for every Obligation.
It supplies structure without selecting a judgment.
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
Challenge uses the smaller `challengeExecutionPacket`, but its input binding
still names that packet's exact `draft`. The fresh-context Agent and the action
command exchange only the completed Challenge Document. A trusted controlling
Host keeps the request and receipt outside Agent-authored input and exposes a
single-use receipt only through its programmatic attestation provider.
The packet is transient projection, not persisted authority or lifecycle state.
JSON output places `hostAction` before result detail. Authoring catalogs are
stage-specific rather than a universal copy of all task facts. Use
`--section action` to regenerate the current action and exact draft without
changing task state.

After a current Handoff is evaluated, `hostAction` changes role. It returns a
transient `developerDecisionBrief` containing the four separate delivery,
evidence, Agent-recommendation, and Human-adoption states; the Agent's
interpretation of intended outcome and actual system meaning; every Agent
condition conclusion; direct-cause decision issues; linked review questions;
explicitly labelled Runtime observations; and diagnosis and recovery routes
from earlier Attempts. Decision issues with the same exact protocol group and
required resolution are projected once while retaining the union of every
underlying Attention ID, code, and reference. This is structural aggregation,
not a judgment based on paths, keywords, commands, or repository content.
Detailed evidence references, logs, and
immutable artifacts remain available through `change explain`; they are not
copied into the primary brief. The accompanying `presentationRequirements`
names every condition, aggregated issue, and question that the Host must
preserve in its final cognitive handoff.

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
projected action. A Host that still holds the exact preceding action may pass
that fingerprint as `--known-action-fingerprint`; when it still matches, the
guard returns `actionUnchanged: true` and omits the duplicate action Packet by
returning `hostAction: null`. The Host may reuse only the exact Action bound to
that fingerprint. A missing or stale fingerprint returns the complete current
Action. The brief appears only inside `hostAction`, avoiding a second copy in
the same JSON response. Generated skills instruct this call but do not claim that a
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
    { "key": "ownership", "path": "src/file.ts", "wholeFile": true }
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
        },
        {
          "key": "persistent-protection",
          "statement": "Persistent verification rejects a plausible compatibility regression.",
          "falsification": {
            "failureHypothesis": "The verifier may pass without observing the legacy path.",
            "scenario": "Inspect or exercise whether the verifier rejects that regression.",
            "supportingObservation": "The verifier rejects the plausible regression.",
            "contradictingObservation": "The verifier passes without observing the changed behavior."
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
      "execution": {
        "preparation": [],
        "assertion": { "argv": ["package-manager", "test"] }
      },
      "executionInputs": [],
      "baseline": {
        "mode": "task-start",
        "rationale": "Before/after distinguishes a new regression from a prior failure.",
        "expectation": { "baselineStatus": "passed", "currentStatus": "passed" },
        "obligationKeys": [
          { "conditionKey": "compatibility", "obligationKey": "legacy-path" },
          { "conditionKey": "compatibility", "obligationKey": "persistent-protection" }
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

Each Evidence Obligation must be independently concludable. If the same
observation can support one part while another adoption-relevant part remains
unknown, split them into separate Obligations. Current implementation behavior
and persistent verifier protection are separate Obligations when either can
change adoption. The Host Agent declares this split explicitly; Runtime does
not infer it from repository text or verification filenames.

Every Obligation freezes one discriminating design: the plausible failure, a
specific scenario, the observation that supports the bounded conclusion, and
the observation that contradicts it. Runtime validates completeness and later
binding; it does not decide whether those natural-language statements are
semantically adequate.

Verifier selectors are explicit `file` or `tree` boundaries with one role.
`file` matches only the exact current or previous path. `tree` matches its root
and descendants by repository path boundary. There are no globs, regular
expressions, filesystem-type guesses, or framework filename rules.

Each Check freezes zero or more ordered `execution.preparation` commands and
one `execution.assertion` command. Preparation establishes an explicit local
precondition but never counts as passing evidence; only the assertion produces
the Check status. `executionInputs` names exact file or tree inputs whose state
may otherwise be hidden by Git ignore rules. Runtime records those inputs
before preparation, at the assertion boundary, after assertion, and when facts
are checked for currency. It does not discover or infer undeclared inputs.

Repository Evidence uses either an exact `startLine`/`endLine` range or
`wholeFile: true`. The latter is not a persisted shortcut: CLI deterministically
materializes the current UTF-8 file into an exact line range, text, and digest
before Core compiles the Contract. Empty files are rejected rather than given
an invented line number. Prefer the smallest exact line range sufficient for
the declared decision; use the whole file only when all of it is relevant.

`task-start` baseline requires a decision-relevant rationale and exact
Obligation keys. It also freezes explicit expected baseline and current statuses
(`passed`, `failed`, or `unavailable`). Runtime always records the actual
mechanical relation, but raises baseline Attention only when an observed status
violates that expectation. Use `{ "mode": "unknown" }` when before/after
comparison does not change the decision. If no command applies, omit `checks`
and provide `noCommandRationale`.

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
  "proposedRoute": "repair-delivery",
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
      "repositoryChangeCanAlterObservation": true,
      "changeSurface": "production",
      "expectedDifferentObservation": "What the next Runtime Attempt should observe.",
      "intendedChanges": ["Bounded intended edit."]
    }
  ]
}
```

`source` is exactly a frozen Check definition or a current adverse Challenge.
Cause is exactly `implementation`, `environment`, `verification`, or `unknown`.
Implementation may declare a `production` edit. Verification may declare a
`verification-surface` repository edit, or `none` when the frozen definition
itself must be revised. Environment and unknown causes declare `none`. Runtime
validates identity, coverage, these explicit change declarations, and route
compatibility; it never guesses cause or route from output. Implementation and
repository verifier gaps may use delivery repair. Environment and frozen
verification-definition gaps may revise verification. Unknown may challenge,
hand off, or ask the developer. Material semantic impact must ask the developer.
Explicit routing is documented in [Architecture](architecture.md).

`repair-delivery` creates a successor Attempt under the unchanged Semantic
Contract and Verification Plan. It applies when at least one entry supplies a
bounded production or repository verifier-surface edit. Other environment or
verification entries may remain visible and are rerun in that Attempt. An
unknown cause still cannot be repaired. `revise-verification` is reserved for
changes to frozen execution commands, declared execution inputs, baseline
policy, selectors, or Obligation bindings; a
test-content edit alone does not require a Verification Revision.

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
      "execution": {
        "preparation": [],
        "assertion": { "argv": ["new-entry", "test"] }
      },
      "executionInputs": [],
      "baseline": {
        "mode": "task-start",
        "rationale": "Before/after distinguishes a new regression from a prior failure.",
        "expectation": { "baselineStatus": "passed", "currentStatus": "passed" },
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

`execution-rebinding` may change preparation or assertion commands only; all
other fields in its complete Check list must remain exact. Use
`verification-plan` for broader
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

When a trusted Host integration is available, the action contains a bounded
`challengeExecutionRequest`. It binds one `stetra-challenger` run to the exact
task, effective Contract, Attempt, Fact Collection, and Challenge Execution
Packet fingerprint and current worktree fingerprint. It requires one fresh
context, keeps the target worktree read-only, requires an isolated writable
execution workspace, forbids external effects and fan-out, and allows one
structured-output repair. The isolated workspace permits repository tests to
write their normal fixtures and caches without modifying the target. Generated
thin profiles remain read-only fallbacks and cannot attest this isolation.

The transient `challengeExecutionPacket` is a deterministic projection for one
Evidence Obligation. It contains:

- that Obligation and its owning Condition;
- only the exact Human Events in the Condition basis;
- only Check definitions named by the Obligation's Runtime-check strategies;
- only Repository Evidence named by the Condition basis or Obligation strategy;
- only Verifier mutations for those Check definitions;
- a compact inventory of every changed file, with declared relations derived
  only from exact evidence paths and Runtime-recorded selector matches;
- one Patch path, digest, and byte length when a Patch exists;
- one prefilled Challenge draft and its bounded output choices.

It does not contain other Conditions, other Obligations, unrelated Checks,
generic reference catalogs, reusable authoring shapes, or the general Stetra
workflow. It uses no filename, token, dependency, diff-size, or keyword
relevance heuristic. The generated Challenger profile treats this packet as
complete and does not reload the general Stetra skill or reference pages.

The Challenger fills `challengeExecutionPacket.draft` and returns only this
Agent-owned document. It preserves the prefilled Obligation IDs,
falsification design, and evidence selection exactly. It contains no request,
context, receipt, or independence claim:

Supporting and counter-evidence may cite only patch, changed-file, Check,
Repository Evidence, or Human Event references selected by this packet. An ad
hoc tool observation belongs in `observedResult`; it cannot be promoted into a
fact or another Challenge identity.

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
  "evidenceCoverage": {
    "status": "sufficient",
    "rationale": "The selected evidence exercises the whole bounded conclusion.",
    "gaps": []
  },
  "outcome": "supported",
  "conclusion": "Bounded conclusion."
}
```

After observing both lifecycle boundaries, the Host retains this attestation
outside Agent-authored command input:

```json
{
  "requestId": "sha256:current-request",
  "hostReceipt": {
    "receiptId": "receipt:host-generated",
    "requestId": "sha256:current-request",
    "provider": "codex",
    "agentType": "stetra-challenger",
    "parentContextId": "host-parent-context",
    "challengerContextId": "host-child-context",
    "lifecycle": "start-and-stop-observed",
    "contextFingerprint": "sha256:host-context-binding",
    "outputFingerprint": "sha256:exact-challenge-document",
    "targetWorktree": "read-only",
    "executionWorkspace": "isolated-writable",
    "sourceSnapshotFingerprint": "sha256:current-worktree",
    "externalEffects": "forbidden"
  },
  "challenge": { "...": "the exact Challenger document above" }
}
```

The CLI command still receives only the bare Challenge Document. It generates
the Challenge ID and derives Condition IDs. It accepts
`host-attested` only when the trusted provider verifies the current request,
distinct contexts, exact source snapshot, target protection, isolated writable
execution workspace, lifecycle receipt, and exact output. Receipts are
single-use, persisted beside the Challenge, and inspectable through
`change explain --section challenge`. Thin skills remain `unverified`. A
supported Challenge advances to the next required Challenge or Handoff. A
partial, contradicted, or unknown Challenge returns to the Implementer through
the existing evidence-diagnosis action. The diagnosis may choose bounded
repair, verification revision, Human resolution, or Handoff, but may not send
the same adverse Challenge to another Challenger.

`supported` is structurally incompatible with non-empty `counterEvidence`.
While any counter-evidence remains, the Challenger must use `partial`,
`contradicted`, or `unknown`. CLI rejects the inconsistent document early and
Core independently rejects the same combination if it bypasses CLI parsing.
The same ceiling applies when `evidenceCoverage` is `insufficient`. The
Challenger names concrete uncovered aspects; structural-output repair cannot
erase those authored gaps. Runtime validates this declaration and its effect on
the outcome, but does not decide whether the natural-language assessment is
correct.

Repair and recollection never erase Challenge history. Only Challenges bound
to the current effective Contract, Attempt, and Fact Collection can satisfy a
current obligation; `change explain --section challenge` retains prior adverse
findings and their lineage.

Challenge input must preserve the exact frozen falsification design for every
selected Obligation. Obligations with different designs are challenged
separately. The Agent records both the action and observed result before
choosing a bounded outcome.

Generated Markdown skills do not control or attest a fresh Host context, but
the generated Codex and Claude profiles can still perform the bounded Challenge
in a separate context. Without a trusted provider, the Host submits the same
bare Challenge Document without a Receipt. Runtime records that result as
`unverified`, rejects `supported` for the affected required obligation, and
adds a concrete direct-review obligation. A native Adapter or Evaluator that
observes both lifecycle boundaries may instead submit the verified Receipt.

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
      "evidenceCoverage": {
        "status": "sufficient",
        "rationale": "The cited evidence covers this bounded conclusion.",
        "gaps": []
      },
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
Every Obligation conclusion also declares whether its cited evidence covers the
whole bounded statement. `insufficient` requires concrete gaps and prevents a
supported conclusion; Runtime never discovers those gaps from filenames,
commands, dependencies, or repository text.
Every missing, adverse, or unverified required Challenge also requires a Review
Question bound to the exact affected Obligation; a broad Condition-only
question cannot discharge it.

The final Developer Decision Brief preserves each related Challenge conclusion
and its exact counter-evidence under the affected Obligation. A Challenge is not
reduced to an outcome label before the developer makes the adoption decision.

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
stetra change explain . --task <task-id> --section index --json
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

`index` is the default. It lists section availability, counts, and artifact IDs
without expanding the Contract, Facts, Handoff, Decision, or Event Ledger.
Call one exact detail section only when it is needed for a current judgment.

Unsupported shapes fail with actionable errors and write no compatibility
state. A schema-invalid JSON document returns a transient `inputCorrection`
with the submitted-input fingerprint, a bounded structural preview, exact issue
paths, bounded issue-value and parent previews, and `stateWritten: false`; the
Host repairs the draft it already holds and retries the same lifecycle command.
The correction never echoes the full submitted document. Invalid JSON that
cannot be parsed has no structured input to preview.
