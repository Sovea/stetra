# Change workflow

This document defines the executable schema `2` task workflow. Stetra remains
embedded in the developer's Coding Agent Host. CLI commands are the portable
transport and do not define a separate conversational product.

## Setup

```sh
stetra init . --adapter codex --adapter claude
stetra status .
```

Initialization installs compact Host Skills and bounded lifecycle Hooks. It
also writes `.stetra/config.json` with an explicit admission mode and named
verification profiles. Owner-modified generated content is never overwritten
without `--force`.

The initial configuration defaults to `ask` admission and contains no invented
verification command. A project must configure a named profile or the Agent
must supply explicit argv checks when a task begins. A concrete no-command
rationale is also accepted.

## Visible lifecycle

```text
Align -> Work -> Decide
```

The portable command surface is:

```sh
stetra task begin . --input begin.json --json
stetra task collect . --task <task-id> --json
stetra task handoff . --task <task-id> --input handoff.json --json
stetra task decide . --task <task-id> --input decision.json --json
stetra task inspect . --task <task-id> --section summary --json
```

Input may be `-` for stdin. Input files inside the project worktree are
rejected, so semantic transport cannot silently become part of the change.
There is no Draft reservation, Guide, Authoring Projection, `hostAction`, or
final-response command protocol.

Every response contains a compact task phase and one provider-neutral
directive:

```text
work | continue-work | author-handoff | await-human-decision | complete
```

The directive describes the engineering next step. Internal identities and
artifact bindings remain Runtime-owned.

## Begin

Routine input:

```json
{
  "humanEvent": {
    "content": "Implement the exact developer request."
  },
  "interpretation": {
    "desiredOutcome": "Observable outcome",
    "constraints": [],
    "nonGoals": []
  },
  "assurance": { "mode": "routine" },
  "verification": {
    "mode": "checks",
    "checks": [
      {
        "key": "test",
        "argv": ["npm", "test"],
        "verifierSelectors": []
      }
    ]
  }
}
```

The current thin adapter relays the exact Human text but cannot attest its Host
origin. Runtime labels it `unattested-input`, preserves its submitted bytes,
and shows it in the Decision Brief instead of inventing Host authority. The
Agent authors only interpretation and check intent. Runtime creates Human Event,
Contract, Verifier, Definition, step, task, and Attempt identities.
Runtime captures the complete Git worktree before publishing the task. Routine
Begin does not execute checks.

Verification may instead select one exact project profile or declare
`no-command` with a concrete rationale. Commands are argv-only and run without
a shell. Optional preparation commands establish only the named check's own
preconditions.

Consequential input adds explicit Adoption Concerns. A concern may require
named checks or direct Human review. The initial
schema does not include nested Evidence Obligations, Independent Challenge, or
Host-policy requirements.

## Work and collect

The Agent uses normal Host tools while implementing. Stetra receives no
per-tool event stream and stores no Agent transcript.

Collect:

1. observes the pre-check worktree;
2. executes every frozen check definition in order without a shell;
3. observes the post-check worktree;
4. computes the complete baseline-to-current change;
5. records check-induced changes, verifier mutations, execution inputs,
   environment, bounded logs, and full-stream digests;
6. publishes one immutable Fact Collection.

If the worktree and declared execution inputs still match an existing current
collection, Collect reuses it and writes no event. A forced refresh is not part
of the routine Agent surface.

Non-passing checks return `continue-work` with compact exact results and log
selectors. The Agent diagnoses and repairs through its ordinary coding loop;
there is no mandatory Diagnosis artifact. A later Collect preserves the prior
Fact Collection and creates a successor observation for the same Attempt.

Timeout retry is allowed only after an actual timeout, with an explicitly
larger bounded budget, and never overwrites the earlier Attempt. It is a
conditional recovery option, not the default next action.

```sh
stetra task collect . --task <task-id> \
  --retry-timeout <check-key> --timeout-ms <larger-ms> --json
```

## Handoff

Handoff is accepted only against current worktree and declared execution-input
facts. Its compact input contains:

```text
actual behavior
implementation mechanism
optional preserved invariants
optional failure and recovery behavior
optional important effects
optional material tradeoffs
optional residual unknowns
optional consequence-directed review focus
Agent recommendation
optional consequential concern findings
```

Runtime adds mechanical Attention for:

- current failed or unavailable checks;
- verifier-surface changes;
- check-induced worktree changes;
- unrepresentable changes;
- residual unknowns;
- missing evidence required by an Adoption Concern.

Runtime can reject a concern conclusion or recommendation that exceeds its
declared evidence. It does not validate the truth of natural-language behavior
or diagnosis.

The result is one compact Developer Decision Brief. Full facts, logs, patch,
Contract, Handoff, and event history remain available through bounded
`task inspect` sections.

## Human decision

The Host presents the current Decision Brief and stops. Only a later exact
developer message can authorize:

```text
accepted | correction-requested | rejected | deferred
```

Acceptance with Attention must acknowledge every current Attention item.
Decision is bound to the current Contract, Attempt, Fact Collection, and
Handoff fingerprint.

`correction-requested` starts a successor Attempt while preserving the prior
facts, Handoff, and decision. Other actions close the task. Decision never
commits, merges, publishes, deploys, or updates cross-task policy.

## Currency

Any repository edit or declared execution-input change after Collect makes the
facts stale. Handoff then returns `collect` without persisting Agent prose.
Any edit after Handoff similarly requires a new collection and Handoff before a
Human decision can be recorded.

## Host continuity

SessionStart injects only:

- admission policy when no task is bound;
- current task identity and visible phase when a task is bound;
- the smallest next engineering action.

Stop may request one continuation for one unchanged unfinished task state. A
second identical Stop allows the Host to stop and emits a visible warning. A
current Decision Brief is presented without continuation. Hooks never infer a
task from the worktree and never create Human authority.

The generated adapters are honest about their provider capabilities. A thin
Skill fallback can call the portable CLI but cannot attest native event
identity or enforcement. Relayed Human text remains visibly unattested.

## Inspection

Summary and index sections are:

```text
summary | contract | baseline | collections | handoff | decision | events
```

`collections` returns compact collection summaries. `collection` selects one
Fact Collection; `check` selects one readable Check key and optional Attempt;
`log` returns at most 65,536 trailing bytes from one selected stdout or stderr
stream. Summary never expands full logs, patches, baseline trees, or event
history.

## Persistence

Task artifacts live only beneath `.stetra/tasks/<taskId>/`. Events include only
task begin, non-duplicate fact collection, Handoff, Human decision, and a
future explicit Contract or verification amendment. Task projection is a
rebuildable cache.

Schema `1` artifacts are unsupported. The CLI does not translate, migrate, or
silently reinterpret them.
