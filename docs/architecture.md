# Architecture

`resonant-code` is a change-adoption harness for production coding agents. It
lets an agent own the local implementation loop while keeping task meaning,
collected facts, and the adoption decision separately inspectable.

The product is successful when it lowers the total cost from a developer
request to a confidently adopted change without weakening the developer's
understanding of the system or the quality of their decisions. Generation
speed and passing checks matter only as parts of that outcome.

It is not a coding agent, repository wiki, planning framework, prompt library,
or automated code approver.

## Three cores and one loop

The architecture has three task-scoped cores and one longitudinal loop:

1. **Semantic Contract** records what one change is intended and authorized to
   mean.
2. **Fact Spine** records what the workflow observed before and after the
   implementation.
3. **Cognitive Handoff** explains what the actual change means, what remains
   uncertain, and where review has the highest value.
4. **Decision Continuity** may reuse adopted decisions and observed outcomes in
   later tasks without transferring decision authority to the agent.

```text
Developer request and long-lived decisions
                  |
                  v
          Semantic Contract
                  |
                  v
   agent investigation, implementation, repair
                  |
                  v
              Fact Spine
                  |
                  v
          Cognitive Handoff
                  |
                  v
       Developer review and adoption
                  |
                  `------> Decision Continuity (future)
```

The current implementation closes one task-scoped loop across the first three
cores. Decision Continuity is a design boundary, not an implemented store.

## Responsibility and authority

The workflow keeps three kinds of authority distinct:

| Participant | Owns | Does not own |
|---|---|---|
| Developer | Desired outcome, constraints, non-goals, long-lived tradeoffs, exceptions, and adoption | Repository or check facts contradicted by observation |
| Coding agent | Investigation, interpretation, local engineering judgment, implementation, diagnosis, repair, and handoff claims | The developer's decisions or machine-observed facts |
| Runtime process | Baselines, frozen check definitions, actual changes, check outcomes, output integrity, and other collected facts | Product intent, semantic tradeoffs, or adoption |

The harness is not another authority. It binds provenance, controls lifecycle
ordering, collects or validates facts, preserves contradictions, and presents
review surfaces.

A recorded developer message or decision is represented by an exact
`HumanEvent`. A structured reading of that event remains an agent
interpretation. A source label cannot turn a paraphrase into a developer
decision, and supporting facts cannot turn an agent conclusion into a machine
fact.

A concrete task authorizes the agent to perform necessary local, reversible
inspection, edits, verification, and safe repair within the task meaning. The
agent asks for input only when a material long-lived choice remains unresolved,
the work drifts outside that meaning, an exact exception or verification
relaxation is needed, or an external or irreversible effect is proposed.

## Semantic Contract

The Semantic Contract is the smallest pre-change envelope that can affect
solution selection, execution authority, verification, or review. It contains:

- exact developer messages or decisions relevant to the task;
- basis-bearing agent interpretations for the desired outcome, constraints,
  non-goals, focus, and consequence;
- optional exact repository evidence used by a material interpretation;
- explicit verification commands, or a concrete reason no command applies;
- no unresolved material semantic fork.

It is not a generated design document, predicted implementation plan, or file
permission list. Focus paths direct investigation and review; necessary
adjacent implementation, test, type, and documentation work remains allowed
while the contract meaning is unchanged.

The runtime validates structure, event and evidence references, deterministic
identity, and verification readiness. It does not judge whether the agent's
interpretation is semantically wise or complete.

## Fact Spine

The CLI owns fact collection. It captures a complete worktree baseline before
implementation, including existing tracked changes and non-ignored untracked
files, and freezes the selected check definitions.

After implementation it records:

- added, modified, deleted, and renamed paths;
- file kinds, modes, content digests, and a complete representable patch;
- binary or otherwise unrepresentable changes explicitly;
- every frozen check's argv, status, exit code, output digests, bounded logs,
  and availability;
- changes to declared command-definition and acceptance-surface files;
- one collection identity binding the change and check facts.

The coding agent cannot submit changed-file facts, check outcomes, or the
collection identity. Passing checks establish only that those commands passed.
They do not prove the semantic correctness or adoptability of the change.

Every handoff is bound to one exact collection. If the worktree changes after
collection, finalization returns `facts-stale`; the agent must collect again
before its conclusions can be evaluated.

## Cognitive Handoff

The handoff is written only after the agent has inspected the complete
collected change. It contains:

- a compact update to the system's behavior or structure;
- only material claims about applicable behavior, invariants, ownership, data
  and control flow, compatibility, migration, recovery, security, operations,
  or maintenance consequences;
- an explicit basis for each claim;
- residual unknowns and concrete validation or takeover paths;
- attempts to disprove adoption-critical claims;
- a consequence-directed Review Map rather than one item per changed file.

Claim bases remain explicit: repository evidence, agent judgment, a recorded
developer decision, or unverified. Runtime-collected facts are presented separately from
these semantic conclusions.

An adoption-critical claim based on agent judgment, repository evidence, or an
unverified premise includes a concrete failure hypothesis and falsification
attempt. Contradicted, partial, and unverified results remain visible. The runtime
checks their references and mechanical consistency; it does not reproduce the
semantic investigation.

Attention and review order are different outputs. An attention item explains
why the evidence is insufficient, what adoption risk it creates, what exact
facts to inspect, and the next action. The Review Map explains where direct
code review is most valuable and what failure that review can prevent.

`handoff-ready` means that the handoff is structurally and factually ready for
developer review. It never means that the change has been adopted.

## Decision Continuity

The future loop may reduce repeated semantic work using recorded developer
decisions and observed outcomes such as adoption, correction, rejection,
reversion, or an incident. Activation must be scoped and inspectable.

Repeated agent choices, generated summaries, consensus, or passing checks are
not developer decisions. They may form hypotheses, but they cannot silently
expand future autonomy.

No cross-task decision store, preference learner, delegation frontier, or
adoption history exists in the current MVP. Such state belongs in the product
only when it has a concrete compile or presentation consumer and measurable
value over recovering context from the current task and repository.

## Package boundary

The dependency direction is intentionally narrow:

```text
Generated host adapter -> CLI -> Core
```

- `@sovea/resonant-code-core` provides deterministic contract compilation,
  fact binding, and handoff evaluation through `compileDelegation` and
  `evaluateHandoff`.
- `@sovea/resonant-code` provides the CLI lifecycle, Git and check collection,
  task-run IO, presentation, project initialization, and generated adapters.

Core does not read a repository, execute commands, format CLI output, know
host-specific files, or call an LLM. The CLI does not decide semantic truth or
invent machine facts. Generated adapters contain workflow instructions and
leave repository reasoning to the host agent.

The workspace has exactly these two publishable packages. A new package needs
an independent consumer, public API, version, and release boundary.

## Persistent aggregate

One `.resonant-code/runs/<runId>/` directory owns the contract, baseline,
facts, handoff, evaluation, patch, and bounded non-empty check logs for one
task. The minimum states are `prepared`, `facts-collected`, and `completed`.

Non-runnable prepare results create no run. Completed-run retention removes
only whole completed directories; incomplete runs remain recoverable. A run is
never an authoritative cache for another task.

Every new persistent field or lifecycle stage must answer three questions:

1. Which compile, collection, review, recovery, adoption, or future activation
   decision can it change?
2. Can the developer inspect that decision and its authority or evidence?
3. Can its value be tested against a simpler workflow?

If it cannot, it does not belong in the kernel.

## Invariants

1. Developer authority is tied to an inspectable event or decision.
2. Runtime-collected facts have workflow collection provenance.
3. Agent interpretation is never relabeled as developer intent or machine
   proof.
4. Handoff claims are written after and bound to the complete actual change.
5. A post-collection edit invalidates the fact-bound handoff.
6. Contradictory and insufficient evidence remains visible.
7. Passing checks do not establish semantic correctness or adoption.
8. Focus paths are not permissions or a predicted blast radius.
9. Routine local reversible work does not require per-file or per-command
   approval.
10. Persistent product state needs a decision-changing, inspectable consumer.
11. Core and CLI never call an LLM; the host agent owns semantic judgment.
12. Product effectiveness is established by adoption evidence, not protocol
    tests.

## Evidence boundary

The repository's deterministic gate establishes that the implementation is
internally consistent and distributable. Claims that the harness lowers total
adoption cost or preserves developer cognition require paired results under
[`evaluation/paired-agent/PROTOCOL.md`](../evaluation/paired-agent/PROTOCOL.md)
and an explicit scoped product-owner conclusion. Until committed evidence
meets that contract, effectiveness remains unverified.
