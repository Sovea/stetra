# Product vision

This document defines the product Stetra should become, the developer problem
it exists to solve, and the observable picture of success. It is a long-term
direction, not a claim that every capability described here is implemented or
effective today.

The authoritative system boundaries and target design live in
[Architecture](architecture.md). Current executable behavior lives in
[Change workflow](change-workflow.md). Product effectiveness remains
unverified until measured against a strong simpler baseline.

## The problem

Coding Agents can investigate, design, and generate changes much faster than a
developer can reconstruct and evaluate them. Their work also produces a large
volume of transient plans, analysis, repair notes, review prose, and completion
summaries. Reading all of it is unrealistic. Skipping it can leave the
developer with only the Agent's conclusion that the task is complete.

This creates an engineering-control gap:

```text
developer intent
  -> rapidly generated investigation and implementation
  -> rapidly generated explanation
  -> developer sees the conclusion but loses the actual system change
```

The implementation may compile and pass self-authored tests while still:

- solving a symptom instead of the intended invariant;
- silently changing compatibility, ownership, or failure behavior;
- redefining acceptance through a modified verifier;
- omitting concurrency, recovery, or operational paths;
- relying on stale or incomplete evidence;
- leaving the developer unable to explain or maintain the change after the
  Agent context disappears.

The failure is not simply low code quality. It is the loss of the control loop
between developer intent, engineering reality, evidence, understanding, and
adoption.

## Product thesis

Stetra should let developers delegate implementation without delegating away
their understanding or engineering authority.

It is an engineering control harness around Coding Agents. The Agent
investigates, designs, implements, diagnoses, and recommends. Stetra keeps the
engineering thread intact by binding:

```text
what the developer authorized
  -> what the workflow actually observed
  -> what the Agent concludes from that evidence
  -> what remains unsupported or unknown
  -> what the developer finally decides
```

Stetra should protect five first-class developer rights throughout a delegated
change:

1. **Direction.** The developer owns desired outcomes, constraints, non-goals,
   and long-lived tradeoffs.
2. **Visibility.** The developer can inspect what actually changed and which
   checks actually ran, independently of Agent prose.
3. **Intervention.** Control returns when continuing requires a semantic
   change, verification relaxation, exception, irreversible effect, or
   material long-lived choice.
4. **Understanding.** The developer can recover the behavior, mechanism,
   invariants, ownership, failure paths, and important effects of the actual
   result without replaying the full Agent process.
5. **Adoption.** Implementation completion, evidence sufficiency, Agent
   recommendation, and Human acceptance remain different states.

The product is successful when the Agent can do more execution work while the
developer remains the person who can explain, steer, challenge, and responsibly
adopt the resulting system change.

## The durable value proposition

Stetra should not compete on making a model intrinsically smarter or improving
its first-draft benchmark score. Model and Host improvements will keep moving
that frontier.

Its durable value is a lower-cost engineering control loop for delegated
changes:

- **Semantic steering before implementation.** The Agent's bounded
  interpretation remains connected to exact developer authority.
- **Independent visibility during delivery.** Actual changes, verification,
  Attempts, and fact freshness come from the workflow rather than a completion
  story.
- **Evidence-directed convergence.** Concrete adverse facts and bounded
  evidence gaps route to investigation, local correction, recollection, or a
  Human-owned decision.
- **Cognitive reconstruction after implementation.** The final surface models
  the actual system change instead of preserving a stale plan or transcript.
- **Explicit ownership.** The developer accepts, requests correction, rejects,
  or defers the exact current result.

This is not a guarantee of correct code. It is a control surface for moving an
Agent-authored implementation into an engineering outcome a developer can
understand and own.

## Role in implementation quality

Implementation and technical design quality are too important to abandon, but
too broad for Stetra to own as a code-generation promise.

```text
investigation, planning, first-draft generation, local implementation repair
  -> model, Coding Agent, execution Host, and implementation harness

quality convergence of the result considered for adoption
  -> Stetra supplies semantic boundaries, facts, evidence feedback,
     decision forks, and recollection
```

Stetra can influence the quality distribution of adopted changes through:

- **Selection:** unsupported work does not acquire the status of a sufficiently
  supported change merely because its author says it is complete.
- **Feedback:** review and correction target an explicit claim, fact, or
  plausible failure rather than generic commentary.
- **Iteration:** a local reversible defect can drive a bounded successor
  Attempt and new facts; semantic drift or verification relaxation returns to
  the developer.

Stetra does not choose the best implementation or operate the Agent's coding
loop. It makes concrete weaknesses easier to expose and route, and makes it
harder for a persuasive explanation to collapse facts, judgment, and authority.

## The product control loop

### 1. Set direction

Before implementation, the Agent records a compact interpretation of the
desired outcome, constraints, non-goals, and any adoption-changing conditions.
Repository-discoverable questions remain Agent work. Only unresolved product
meaning, long-lived tradeoffs, exceptions, or external effects interrupt the
developer.

The developer confirms what the change must mean, not a brittle implementation
plan.

### 2. Delegate execution

The Agent uses its Host's normal repository, shell, session, and optional
subagent capabilities. Stetra does not replace that execution loop. It freezes
the task and verification boundary needed for later evidence and captures
ordered Attempts.

Routine work should remain close to ordinary Agent use. Additional ceremony is
justified only by an explicit semantic requirement, observed fact, evidence
gap, Host limitation, or Human-owned choice.

### 3. Observe engineering reality

The Runtime collects the complete baseline-to-current change, exact verifier
definitions and attempts, verifier-surface changes, bounded logs, and fact
currency. A passing command is one observation, not a semantic conclusion.

The developer need not watch every edit. Stetra must make the state of the
actual change inspectable when it matters.

### 4. Converge through evidence

A concrete non-passing fact, changed verifier surface, failed falsification, or
bounded unknown can route to:

```text
Agent investigation
local reversible correction and recollection
verification revision with preserved history
direct Human review
exact Human resolution
```

Stetra structures the gap and preserves provenance. The Agent still owns the
engineering diagnosis and repair. Runtime does not infer semantic cause from
filenames, dependencies, diff size, keywords, or test output.

### 5. Reconstruct the actual system change

After implementation, the Agent reconstructs a compact model from the current
change and current facts rather than copying a pre-implementation plan. It
answers:

- **Behavior:** what a caller, user, operator, or adjacent subsystem observes
  differently;
- **Mechanism:** which state transitions, ownership boundaries, data flows, or
  control paths implement that behavior;
- **Invariants:** what important behavior is intended to remain unchanged;
- **Failure behavior:** what happens on error, interruption, retry, rollback,
  or partial completion;
- **System effects:** what changed in interfaces, persistence, concurrency,
  performance, security, or operations;
- **Tradeoffs:** which materially different alternative was rejected and why;
- **Unknowns:** what current evidence cannot establish.

These remain evidence-bounded Agent judgments. Structure does not promote them
into Runtime facts.

### 6. Return the decision

The developer receives a compact decision surface that leads with:

```text
implementation state
evidence state
Agent recommendation
Human decision state
```

It explains the actual solution, the mechanical verification change, the few
unknowns that can change adoption, and the direct inspections or decisions with
the highest consequence. Raw logs, IDs, and complete history remain available
for drill-down.

The developer then accepts, requests correction, rejects, or defers the exact
Handoff and facts. Acceptance cannot erase contradictory evidence.

## Relationship to Coding Agents and execution harnesses

Coding Agents, Trellis, GSD, and provider-native harnesses may own repository
context, planning, task decomposition, model selection, tool use, subagents,
worktrees, and implementation repair.

```text
Coding Agent / execution harness
  investigate -> design -> implement -> test -> repair

Stetra
  preserve intent -> bind facts -> expose evidence gaps and material forks
  -> reconstruct system meaning -> protect Human adoption
```

Stetra may influence the execution loop through a concrete evidence gap or
Human decision, but it does not reproduce or schedule that loop. Once the
decision surface exists, an ordinary completion summary must not replace or
precede it in a way that implies unsupported success.

## Why this is more than a Markdown Skill

A strong Markdown Skill is the decisive simpler baseline. It can request goals,
unknowns, falsification, and an excellent final format. Stetra has no
differentiated value if it only standardizes that prose.

The Runtime must justify itself through capabilities text instructions cannot
mechanically provide:

- freeze the task and verification boundary used by one Attempt;
- observe the actual baseline-to-current change independently of Agent prose;
- execute and preserve exact check outcomes, budgets, and logs;
- detect verifier-surface changes and stale post-check facts;
- retain adverse evidence and superseded Attempts;
- prevent conclusions from exceeding declared evidence coverage;
- bind correction and Human adoption to an exact Handoff and fact collection.

These mechanisms do not prove natural-language truth. Their narrower value is
that, when the workflow is used, facts, judgments, unknowns, and authority
cannot be collapsed merely because the Agent writes a persuasive explanation.

## Product boundaries

Stetra should own:

- exact task semantics and material-fork handling;
- Runtime-observed repository and verification facts;
- evidence coverage, contradiction ceilings, and bounded correction lineage;
- the actual-change model, cognitive handoff, and Human adoption boundary;
- thin, honest integration with execution Hosts.

Stetra should not become:

- a Coding Agent, model router, generic planner, or execution scheduler;
- an Adaptive Delivery Plane or another implementation harness;
- a replacement for Trellis, GSD, repository tools, or provider-native
  orchestration;
- a generic code-review bot or library of universal reviewer prompts;
- a repository wiki, transcript archive, specification warehouse, or broad
  project-memory system;
- a heuristic quality system based on filenames, dependencies, diff size,
  token overlap, or generic risk keywords;
- a scalar trust, readiness, confidence, cognition, or code-quality score;
- an automated approver or unbounded multi-Agent debate loop.

Independent Challenge is an optional evidence strategy backed only by a Host
that can attest a genuinely separate context. It is not a Stetra-owned Agent
role or mandatory lifecycle stage.

## A concrete success picture

For a consequential Agent-authored change:

```text
Direction
  The developer can confirm the intended behavior and constraints before the
  implementation silently diverges.

Execution
  The Agent works without continuous supervision through its normal Host.

Reality
  The workflow captures the actual diff, checks, Attempts, verifier changes,
  and fact freshness independently of Agent prose.

Convergence
  A concrete adverse fact or plausible failure drives bounded investigation,
  correction, new facts, or a material Human choice.

Understanding
  The developer can explain the resulting behavior, mechanism, invariants,
  ownership, and failure entry points without replaying the transcript.

Adoption
  The developer sees what is supported, partial, contradicted, and unknown;
  inspects the few surfaces that can change the decision; and explicitly owns
  the result.
```

## North Star and evidence

The directional North Star is:

> More production changes confidently adopted per active developer hour,
> without degrading implementation outcomes, developer understanding, evidence
> honesty, or Human authority.

Success is conjunctive. Faster review with a worse implementation is failure.
Correct code that leaves the developer unable to understand the change is
failure. A rigorous packet that increases total work without changing a real
decision is also failure.

Evaluation retains separate observations for implementation outcome,
convergence, cognition, Human cost, Agent cost, evidence integrity, and
adoption. It never collapses them into one score.

The decisive baseline is a strong Markdown Skill requesting the same reasoning
discipline and final presentation. Stetra must demonstrate that independent
facts, evidence ceilings, lineage, and decision binding improve a real adoption
or reduce cognitive recovery enough to justify their cost.

## Evolution order

1. **Prove the task-scoped control loop.** Make the current path black-box
   usable with compact semantic authoring and a decision surface materially
   different from an ordinary completion summary.
2. **Prove evidence-directed convergence.** Show that at least one concrete
   adverse finding or gap drives a useful correction, new fact, or Human choice
   without creating an open-ended reviewer loop.
3. **Add a narrow Host capability only for a proven consumer.** Fresh-context
   Challenge, stronger enforcement, or isolation enters through an honest
   provider-neutral boundary, never a simulated attestation.
4. **Consider longitudinal continuity last.** Cross-task decisions and observed
   outcomes require separate evidence that they improve later decisions.

Planned capabilities are hypotheses, not a feature checklist. If a strong
Markdown Skill reaches the same adoption quality and developer understanding at
substantially lower cost, Stetra must become smaller rather than defend its
existing complexity.

## The product in one sentence

> Stetra keeps the engineering control loop between developer intent and the
> actual system change intact, so delegated code can be understood, challenged,
> and explicitly owned by the developer.
