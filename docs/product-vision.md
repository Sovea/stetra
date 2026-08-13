# Product vision

This document describes the product Stetra should become, the problem it is
intended to solve, and the observable picture of success. It is a long-term
product intent, not a claim that every capability described here is implemented
or effective today.

The authoritative system boundaries and target design live in
[Architecture](architecture.md). Current executable behavior lives in
[Change workflow](change-workflow.md). Product effectiveness remains unverified
until measured against a strong simpler baseline.

## The problem

Coding Agents can investigate, design, and generate code much faster than a
developer can reconstruct and evaluate their work. The implementation process
also produces a growing volume of transient material: specifications, plans,
analysis, review prose, repair notes, test summaries, and final explanations.
Reading all of it is unrealistic, yet skipping it can leave the developer with
only the Agent's conclusion that the task is complete.

This creates an engineering-thread gap:

```text
developer intent
  -> rapidly generated plans and implementation
  -> rapidly generated explanation
  -> developer sees the conclusion but loses the system change
```

The gap matters because a substantial share of AI-generated code is plausible
or locally usable without yet being a change for which a demanding developer or
community can responsibly take ownership. It may compile and pass self-authored
tests while still:

- solving a symptom instead of the relevant invariant;
- silently changing an existing behavior or ownership boundary;
- redefining acceptance through a modified test;
- omitting failure, concurrency, compatibility, or recovery paths;
- depending on evidence that is stale, incomplete, or produced by the same
  assumptions as the implementation;
- being difficult for the developer to explain or maintain after the Agent
  context disappears.

The failure is not simply low code quality. It is the loss of a closed control
loop between developer intent, engineering reality, evidence, understanding,
and adoption.

## Product thesis

Stetra should let developers delegate implementation without delegating away
their understanding or engineering authority.

It is an engineering harness around Coding Agents. The Agent investigates,
designs, implements, diagnoses, and recommends. Stetra keeps the engineering
thread intact by binding:

```text
what the developer authorized
  -> what the workflow actually observed
  -> what the Agent concludes from that evidence
  -> what remains unsupported or unknown
  -> what the developer finally decides
```

Stetra should become the developer's engineering cockpit for delegated change:

- the developer sets direction and long-lived constraints;
- the Agent chooses local implementation strategy;
- the Runtime exposes what actually happened rather than trusting a summary;
- weak evidence and adverse facts produce targeted challenge, repair, or Human
  review instead of being hidden by task completion;
- the developer receives a compact model of the actual system change and the
  few questions that can change adoption;
- the final decision remains explicit Human authority.

The product is successful when the Agent can do more of the implementation work
while the developer remains the person who can explain, steer, and responsibly
adopt the resulting system change.

## The durable value proposition

Stetra should not compete on making a model intrinsically smarter or on making
its first implementation pass more benchmarks. Model and Host improvements will
continue to change that frontier.

Its durable value is to make delegated changes:

1. **Easier to understand.** The developer can recover the actual behavior,
   mechanism, invariants, ownership, failure paths, and important tradeoffs
   without replaying the Agent's full process.
2. **Harder to overclaim.** Runtime facts, counterevidence, missing challenges,
   and stale observations constrain how strongly the Agent may present a
   conclusion.
3. **Able to converge.** A plausible but weak implementation can receive
   specific falsification, bounded repair, and new facts rather than merely a
   generic review or another unconstrained attempt.
4. **Explicitly adoptable.** Implementation completion, evidence sufficiency,
   Agent recommendation, and Human adoption remain separate states.
5. **Inspectable later.** The accepted result remains bound to the exact task
   meaning, implementation Attempt, evidence, unknowns, exceptions, and Human
   decision that authorized it.

This is not a guarantee of correct code. It is a better control surface for
moving AI-generated work from a plausible implementation to an engineering
outcome a developer can understand and own.

## Role in implementation and technical quality

Implementation and technical design quality are too important to abandon, but
too broad for Stetra to own as a code-generation promise.

The useful boundary is:

```text
better first-draft generation
  -> model, Coding Agent, execution Host, and implementation harness

quality convergence of the adopted change
  -> Stetra can provide the evidence and control loop
```

Stetra can improve the quality distribution of adopted changes through three
mechanisms.

### Selection

A weak implementation should not gain the status of an adequately supported
change merely because its author says it is complete or its self-authored tests
pass. Unsupported work may still be useful, but it stays visibly partial,
contradicted, unknown, or deferred.

### Feedback

Review should target explicit claims and plausible failure modes rather than
produce generic commentary. A useful challenge asks whether the implementation
actually preserves a named invariant, whether a changed test has redefined the
behavior, or whether a local mechanism leaves a concrete completion or failure
path inconsistent.

### Iteration

Adverse evidence should be able to create a bounded successor Attempt when the
repair remains within the authorized task meaning. The repair receives the
specific failure hypothesis and evidence, and all relevant facts are collected
again. If the repair changes semantics, relaxes verification, or introduces a
long-lived tradeoff, control returns to the developer.

Stetra therefore does not promise to make the Agent write better code on its
first try. It should make weak drafts easier to expose, concrete defects easier
to route into correction, and insufficiently supported changes harder to adopt.

## The actual change must replace the process transcript

Stetra should not become another store for every specification, plan, chain of
thought, or review message. Most intermediate material is transient Agent
strategy and becomes stale as implementation changes.

Only information with a concrete effect on alignment, implementation,
verification, challenge, review, adoption, or later authorized continuity
belongs in the durable engineering thread.

After implementation, the developer needs a compact model of the actual
solution, reconstructed from the current change and current facts rather than
copied from a pre-implementation plan. It should answer:

- **Behavior:** What will a caller, user, operator, or adjacent subsystem now
  observe differently?
- **Mechanism:** Which state transitions, ownership boundaries, data flows, or
  control paths implement that behavior?
- **Invariants:** What important behavior is intended to remain unchanged?
- **Failure behavior:** What happens on error, interruption, retry, rollback,
  or partial completion?
- **System effects:** What changed in interfaces, persistence, concurrency,
  performance, security, or operations?
- **Tradeoffs:** Which materially different alternative was rejected, and why
  does that choice matter for future maintenance?
- **Unknowns:** What cannot be concluded from current evidence?

These answers remain Agent judgment and must expose their evidence boundaries.
They do not become Runtime facts because they are well structured or well
written.

## What the developer experience should feel like

The developer should not have to watch every Agent step. Stetra should reduce
interruptions while returning control at the moments where Human authority or
understanding is irreplaceable.

### 1. Set the direction

Before implementation, the developer can see whether the Agent's structured
interpretation still matches the requested outcome, constraints, non-goals,
and adoption conditions. Repository-discoverable questions remain Agent work;
material product meaning and long-lived tradeoffs remain Human decisions.

The developer confirms what the change must mean, not a brittle sequence of
implementation steps.

### 2. Delegate execution

The Agent investigates and implements using its Host's normal capabilities.
Stetra records the task boundary, frozen verification definitions, Attempts,
and Runtime-observed repository facts without becoming another coding loop.

Routine work should stay close to ordinary Agent use. Additional ceremony is
justified only by a specific consequence, evidence obligation, observed fact,
or Host limitation.

### 3. Return control at a real fork

Stetra should interrupt the developer when continuing would require a Human-
owned choice, such as changing task meaning, relaxing verification, accepting
an unresolved exception, choosing a materially different long-term design, or
authorizing an external or irreversible effect.

The interruption should explain:

```text
what was discovered
why the current direction cannot continue unchanged
which choices are available
what each choice changes
what the Agent recommends and why
```

It should not be a raw error or a list of questions the Agent could have
answered from the repository.

### 4. Converge through evidence

Checks, repository facts, and targeted challenges should expose concrete gaps.
When a local, reversible repair is authorized, the Agent may correct it in a
bounded successor Attempt. Earlier failures and superseded evidence remain
visible.

The target is not an endless reviewer loop or green tests at any cost. It is an
implementation whose important adoption claims have been challenged to the
degree justified by the task.

### 5. Receive a decision surface, not a completion story

The final handoff should lead with:

```text
implementation state
evidence state
Agent recommendation
Human decision state
```

It should then communicate the actual solution, one bounded conclusion per
adoption condition, the small number of unresolved issues that can change the
decision, and the most valuable direct-review questions. File lists, raw logs,
IDs, and complete histories stay available for drill-down.

The result should make the difference between these statements unmistakable:

```text
the Agent finished implementing
the available evidence supports the change
the Agent recommends adoption
the developer accepted the change
```

### 6. Make the decision

The developer accepts, requests correction, rejects, or defers the exact
Handoff and facts. Acceptance with unresolved Attention names the exceptions
being accepted. The decision cannot erase contradictory evidence.

The desired experience is not more approval prompts. It is fewer, better
decisions with enough understanding to take responsibility for them.

## A concrete success picture

For a consequential Agent-authored change, a successful Stetra session should
look like this:

```text
Direction
  The developer can confirm the intended behavior, constraints, and adoption
  conditions before implementation diverges silently.

Execution
  The Agent works without continuous supervision. The workflow captures the
  actual diff, exact checks, Attempts, verifier changes, and fact freshness.

Convergence
  A plausible wrong implementation is challenged in a task-specific way. A
  concrete adverse finding either drives bounded repair or returns a material
  choice to the developer. New conclusions bind to newly collected facts.

Understanding
  The developer can explain the resulting behavior, core mechanism, important
  invariants, ownership, and failure entry points without reading the complete
  transcript or every intermediate document.

Adoption
  The developer sees what is supported, partial, contradicted, and unknown;
  inspects the few surfaces most likely to change the decision; and explicitly
  accepts, corrects, rejects, or defers the exact result.
```

The final surface should feel materially different from a normal Agent summary.
A normal summary says what the Agent did and which tests it ran. Stetra should
show what changed in the system, why the current evidence is or is not enough,
where direct engineering judgment still matters, and what decision remains with
the developer.

## Relationship to Coding Agents and execution harnesses

Coding Agents and execution harnesses may own repository context, planning,
task decomposition, model selection, tool use, subagents, worktrees, and the
implementation loop. Stetra should compose with them rather than reproduce
their capabilities.

In a combined workflow, the responsibility boundary is:

```text
Coding Agent / Trellis / GSD / other execution harness
  -> produce and revise the implementation

Stetra
  -> preserve intent, bind observed facts, direct evidence-based convergence,
     construct the cognitive handoff, and protect the Human adoption boundary
```

Once Stetra produces the adoption decision surface, it should own the final
cognitive handoff. An implementation framework's ordinary completion summary
may provide detail, but it must not replace or precede the evidence and decision
state in a way that implies unsupported success.

## Why this is more than a Markdown Skill

A strong Markdown Skill is the correct simpler baseline. It can ask an Agent to
state goals, disclose unknowns, challenge its assumptions, and use an excellent
final format. Stetra has no differentiated value if it only produces a more
consistent version of that prose.

The Runtime must justify itself through capabilities a text instruction cannot
mechanically provide:

- freeze the task and verification boundary used by one Attempt;
- observe the actual baseline-to-current change independently of Agent prose;
- execute and preserve exact check outcomes, budgets, and logs;
- detect modified verifier surfaces and stale post-check facts;
- retain adverse evidence and superseded Attempts rather than letting a later
  summary overwrite them;
- reject conclusions that exceed declared evidence coverage;
- bind correction and Human adoption to an exact Handoff and fact collection.

These mechanisms still do not prove semantic truth, and an Agent may bypass a
thin integration. The value is narrower: when the workflow is used, facts,
conclusions, and authority cannot be collapsed merely because the Agent writes
a persuasive explanation.

## Product boundaries

To remain focused, Stetra should not become:

- a Coding Agent, model router, generic planner, or universal workflow engine;
- a replacement for Trellis, GSD, repository tools, or provider-native Agent
  orchestration;
- a generic code-review bot or a collection of universal reviewer prompts;
- an architecture generator that claims to select the best design;
- a repository wiki, transcript archive, specification warehouse, or broad
  project-memory system;
- a heuristic quality system based on filenames, dependency counts, diff size,
  token overlap, or generic risk keywords;
- a scalar trust, readiness, confidence, cognition, or code-quality score;
- an automated approver that converts passing checks or Agent consensus into a
  Human decision;
- an unbounded repair or multi-Agent debate loop.

Stetra may specify what an adoptable change must explain, bind, falsify, and
preserve. It must not claim to know the best implementation or the developer's
preferred tradeoff.

## North Star and success conditions

A useful North Star is:

> More production changes confidently adopted per active developer hour,
> without degrading implementation outcomes, developer understanding, evidence
> honesty, or Human authority.

Success is conjunctive. Stetra is not successful if it produces a rigorous
packet while increasing total work without changing a decision, or if it speeds
review by allowing worse implementations through.

Evaluation should retain separate raw measures for:

- **Implementation outcome:** acceptance behavior, escaped defects, reviewer
  findings, correction, revert, and incident;
- **Convergence:** whether a targeted challenge found a real defect and whether
  bounded repair corrected the relevant cause without semantic drift;
- **Adoption quality:** unsupported implementations recommended or accepted,
  adverse facts omitted, and exceptions explicitly understood;
- **Cognition:** whether the developer can correctly explain changed behavior,
  mechanism, invariants, ownership, and failure entry points;
- **Human cost:** active review time, interruptions, clarification, and amount
  of process material that must be reread;
- **Agent cost:** wall time, tokens, calls, checks, and protocol overhead;
- **Authority:** whether the final decision is exact, Human-owned, and bound to
  the current facts.

The decisive baseline is not an unprompted Agent. It is a strong Markdown Skill
that requests the same reasoning discipline and final presentation. Stetra must
demonstrate that its independent facts, evidence ceilings, lineage, challenge,
and decision binding reduce wrong adoption or cognitive recovery enough to
justify their additional cost.

## Evolution priorities

The long-term vision should be approached in a strict order.

### First: make the current task loop deliver its value

- preserve complete and inspectable Runtime evidence;
- project a concise developer decision brief from the canonical packet;
- prevent Host final responses from hiding evidence or adoption state;
- remove duplicated Attention and avoid authoring ceremony that cannot change a
  decision;
- pass black-box use without reading Stetra source or tests.

### Next: prove minimal quality convergence

- reconstruct the actual solution model after implementation;
- support trusted, task-specific independent Challenge where the Host can
  attest a fresh context;
- route concrete adverse findings into bounded repair and recollection;
- preserve the Human boundary when repair would change semantics, verification,
  or a long-lived tradeoff.

### Later: preserve decision continuity

Only after the task-scoped loop proves useful should Stetra connect explicit
Human decisions to later merge, revert, incident, correction, and outcome
observations. Prior decisions may be proposed as context for a new task, but
never silently activated as policy.

Each step must prove value against the preceding simpler workflow. Planned
capabilities are hypotheses, not a feature checklist.

## The product in one sentence

> Stetra keeps the control loop between developer intent and engineering reality
> intact, so AI-generated changes can converge from plausible implementations
> into outcomes the developer can understand, challenge, and explicitly own.
