# Cognitive-Synchronized Semantic Delegation

- **Status:** Accepted target direction
- **Accepted:** 2026-08-03
- **Authority:** Human-confirmed product direction
- **Applies to:** Product architecture, change lifecycle, persistence,
  evaluation, Host interaction, and upgrade decisions
- **Current implementation contract:**
  [`trustworthy-mvp-contract.md`](./trustworthy-mvp-contract.md)
- **Active migration plan:**
  [`semantic-delegation-upgrade-plan.md`](./semantic-delegation-upgrade-plan.md)

## Purpose

`resonant-code` should become a cognitive-synchronized semantic delegation
harness for production coding work.

The target experience is not merely an Agent that can produce a plausible
patch. The Agent should own the local investigation, solution search,
implementation, verification, and repair loop while the developer retains:

- an evolving predictive and causal model of the system;
- semantic authority over goals and long-lived tradeoffs;
- the ability to distinguish observed fact from Agent judgment;
- the ability to challenge, redirect, adopt, or take over the change.

Every delegated change therefore updates two states:

1. the repository and its observed behavior;
2. the developer's understanding of what the system now means and why.

A change that updates only the first state may increase short-term throughput
while creating cognitive debt. That is not the product outcome.

## Product outcome

The product succeeds when a demanding developer can delegate a production
change, leave the implementation loop, and return to an evidence-backed model
update that makes the change efficient to inspect, understand, challenge, and
adopt.

The successful handoff should let the developer answer, without reconstructing
the Agent transcript:

- What externally observable behavior or invariant changed?
- Why was this solution chosen over a materially different alternative?
- Where do state, control, data, and architectural ownership now live?
- What compatibility, migration, failure, and operational consequences remain?
- Which conclusions are Runtime facts, repository evidence, Agent judgment,
  human decisions, or unresolved unknowns?
- Which few parts of the implementation deserve direct human inspection?
- Where should a developer begin if the change later fails?

The optimization target is total cost to a confidently adopted and
maintainable change, not generation speed, autonomous run duration, number of
artifacts, or checks passed in isolation.

## First principles

### Production work changes a socio-technical system

Code is only one part of the result. Adoption also depends on behavioral fit,
compatibility, architecture, maintainability, operational consequences,
reviewability, and the team's willingness to own the result.

### There is no model-independent best solution

The Agent searches candidate solutions. Repository and Runtime facts constrain
the feasible set. Humans determine how long-lived product and engineering
tradeoffs are ordered. Runtime observes outcomes. Humans decide adoption.

An Agent may recommend a solution, but its recommendation remains Agent
judgment. Runtime may disprove a factual premise, but it may not choose a
product goal or maintenance preference. A human decision may establish
normative meaning, but it may not erase contradictory collected facts.

### Autonomy and human understanding are not opposites

Humans do not need to approve every file, command, or reversible implementation
choice. They must participate when the work exposes a genuinely unresolved
choice about long-lived system meaning or an external irreversible effect.

The Harness should reduce operational interruptions while increasing the
quality of semantic decisions and post-change understanding.

### Trust is not model confidence

Safe delegation comes from bounded semantic authority, reversibility,
independently collected facts, visible contradictions, falsifiable claims,
efficient takeover, and observed adoption outcomes. It must not be compressed
into a decorative confidence number or a single opaque trust score.

### Persistence must add an independent source of value

Information that a capable Host Agent can reliably recover from the current
task and repository should normally remain transient. A persistent concept or
lifecycle stage is justified only when it carries something the Agent cannot
self-authoritatively recreate and changes a real delegation, inspection, or
adoption decision.

## Authority contract

The existing three-authority model remains foundational:

- **Humans own semantic authority.** They decide goals, constraints,
  long-lived tradeoffs, scoped team decisions, exceptions, and adoption.
- **Runtime owns factual authority only for facts it actually collects.** It
  reports the baseline, actual change, checks, and other reproducible
  observations without deciding product meaning.
- **Host Agents own investigation, interpretation, recommendation, judgment,
  implementation, and repair.** They must not present their inference as a
  human decision or a Runtime fact.

The Harness is not a fourth authority. It routes authority, binds provenance,
preserves evidence, detects contradictions, and presents decision surfaces.

Human authority must be bound to an actual human event. A Host-provided label
alone cannot make a value `human-stated` or `human-confirmed`. Structured Agent
interpretation of a human statement remains identifiable as interpretation
unless the human confirms the exact material meaning.

In team use, a human decision also has an actor and an authority scope. A task
requester, API owner, platform owner, security owner, and final adopter need not
own the same decisions. The first implementation may be single-owner, but the
data model must not assume that any human confirmation has universal scope.

## Delegation classification

The Harness routes work according to semantic consequence rather than command
or file count.

1. **Repository- or Runtime-recoverable fact** — the Agent investigates and
   presents evidence; it does not ask the human to supply the fact.
2. **Existing scoped human decision** — the Agent may reuse it with an exact
   activation receipt and may not present it as repository truth.
3. **Local reversible engineering judgment** — the Agent decides, implements,
   verifies, and discloses the choice in the handoff when material.
4. **New long-lived semantic fork** — the human chooses after investigation
   has exposed the evidence, viable alternatives, consequences, and unknowns.
5. **External or irreversible effect** — explicit authorization is required
   before execution.

Fact conflicts and material residual uncertainty also return attention to the
human. Routine local inspection, edits, checks, and safe repairs remain covered
by the concrete task as standing authorization.

## Accepted target capabilities

These capabilities are accepted product direction. Their observable behavior
is binding; exact schemas, APIs, storage layouts, and command names remain open
implementation choices until separately decided.

### Authority-bound semantic envelope

A change begins with the smallest useful semantic envelope: desired outcome,
explicit constraints and non-goals, existing human decisions, and any material
uncertainty that still changes the solution.

It is not a mandatory comprehensive design specification. Human statements,
human confirmations, Agent interpretations, repository evidence, deterministic
normalization, and unresolved unknowns remain distinguishable and traceable.

### Independent fact spine

The normal workflow independently captures the pre-change baseline, complete
actual change, exact verification definitions, check outcomes, output
integrity, and other reproducible observations used by the handoff.

Verification remains endogenous when the same Agent can change both the
implementation and its acceptance surface. The Harness must expose changes to
verification and support stronger independent invariant, integration, hidden,
or operational checks when consequence justifies them. Another Agent's opinion
is additional judgment, not a machine fact.

### Investigation-first solution search

The Host investigates before asking the user to choose. It uses repository
facts and existing human decisions to eliminate infeasible or dominated
solutions. It does not persist alternative artifacts merely because they can
be generated.

When one solution is justified inside the known semantic envelope, the Agent
proceeds. When multiple viable solutions remain and differ on a human-owned
long-lived value, the Host surfaces a semantic fork.

### Late-bound semantic fork

A semantic fork contains only the material unresolved decision:

- relevant facts and contradictions;
- materially distinct options;
- consequences for behavior, compatibility, ownership, migration,
  reliability, security, operations, reversibility, and maintenance where
  applicable;
- the Agent recommendation, explicitly labeled as judgment;
- remaining unknowns and available validation.

The human decides the meaning, not the Agent's operational plan. Questions are
consolidated and asked at the latest safe point rather than front-loading
approval of predicted files or commands.

### Autonomous execution with semantic drift detection

Inside the aligned semantic envelope, the Host owns the complete local loop:
investigation, necessary adjacent edits, tests, types, documentation,
verification, diagnosis, and safe repair.

Drift is defined by a change in semantic consequence, not merely a difference
from predicted paths or implementation steps. Public behavior, compatibility,
architectural ownership, irreversible migration, security, privacy,
reliability, operational burden, and another long-lived tradeoff may require
realignment. Necessary adjacent files do not require permission by themselves.

### Semantic delta and review map

After implementation, the Host derives a semantic delta from the complete
actual change and collected facts rather than restating the original plan.

The delta reports material changes to behavior, invariants, state ownership,
data and control flow, compatibility, migration, failure and recovery paths,
operational consequences, rejected material alternatives, maintenance burden,
and residual uncertainty. It also makes important non-changes explicit when
they are relevant to adoption.

Every conclusion identifies its basis as Runtime fact, repository evidence,
Agent judgment, human decision, or unverified. The developer can trace from an
intent or decision to implementation and verification, and from a changed
implementation surface back to its reason and authority.

Presentation uses progressive disclosure:

1. a compact system-meaning update;
2. causal detail, tradeoffs, and a risk-directed review map;
3. exact diff, checks, logs, and supporting evidence.

The review map concentrates human attention on code that changes system
meaning, depends heavily on judgment, or remains weakly verified. It does not
generate generic review noise for every changed file.

### Falsification and adoption boundary

Before handoff, the Host attempts to falsify the claims most material to
adoption against the actual diff and available checks. Challenge depth is
risk-directed rather than a mandatory blanket attestation ceremony.

Contradictory or insufficient evidence remains violated, partial, or
unverified. Runtime may validate references and collected facts without
turning Agent semantic judgment into machine proof.

Evidence readiness and human adoption are separate states. Neither Runtime nor
the Agent accepts a change for the developer. Adoption, correction, rejection,
reversion, and later incident outcomes are explicit events.

### Decision continuity and delegation frontier

Longitudinal learning is grounded in human decisions and observed outcomes,
not generated repository summaries.

A durable decision records the semantic fork, alternatives, selected meaning,
scope, rationale, evidence, authority, supersession, and later adoption or
correction outcome. Future activation is exact and inspectable. A delivery
receipt shows which prior decisions the Host actually received and used.

Repeated human choices may create a preference hypothesis, but they do not
become human authority until confirmed. Conflicting, stale, corrected, or
superseded decisions narrow future autonomy.

The delegation frontier is an inspectable set of decision classes and scopes
where existing human decisions, reversibility, verification, and observed
outcomes justify fewer interruptions. It is not a scalar trust score. It grows
by shrinking unresolved semantic surface, not by transferring semantic
authority to the Agent.

## Explicit non-goals

The accepted direction does not make `resonant-code`:

- a repository wiki, generic generated memory system, or transcript archive;
- another comprehensive spec-first development workflow;
- a general Agent framework, planner, context manager, or multi-Agent
  orchestrator;
- a prompt concatenator or skill-local semantic policy engine;
- a file- or command-approval system for normal local reversible work;
- a system that treats path scope as permission or predicted files as a
  binding blast radius;
- a system that promotes Agent consensus, prose explanation, or a matching
  snippet into machine fact;
- a system that treats passing checks as proof of product correctness or human
  adoption;
- a generic trust score, confidence score, or automatic preference authority;
- a persistent lifecycle in which every generated proposal, relation,
  observation, or review receives durable state.

Playbook guidance, repository observations, additional reviewers, formal
specifications, and host-native workflows may remain useful inputs or optional
tools. They are not the differentiating kernel unless they change an
inspectable delegation or adoption decision with independent value that the
Host cannot self-authoritatively recreate.

## Product boundary and ecosystem position

`resonant-code` should remain model- and Host-neutral. It may run beneath or
alongside native coding agents, skills, Trellis, OpenSpec, GSD, and other
planning or workflow systems.

Those systems may own task orchestration, context management, specification,
and Agent execution. `resonant-code` owns the narrower protocol that answers:

- Under whose authority does a semantic value exist?
- What facts were independently observed?
- Does the Agent still have standing authorization to continue?
- Which unresolved fork genuinely requires human judgment?
- What did the actual change do to the developer's system model?
- What evidence and uncertainty should govern adoption?
- Which adopted decisions can safely reduce future interruptions?

The differentiating primitives are late-bound semantic forks, non-launderable
authority provenance, actual-diff-derived cognitive synchronization, and an
outcome-calibrated delegation frontier.

## Relationship to the current implementation

During migration,
[`trustworthy-mvp-contract.md`](./trustworthy-mvp-contract.md) remains the
contract for behavior the repository currently implements. This target
direction must not be presented as an existing Runtime fact.

The migration should preserve the strongest current assets:

- the three-authority model;
- standing authorization for local reversible work;
- task-scoped Runtime fact collection and frozen checks;
- evidence currency being distinct from semantic truth;
- explicit Runtime, Agent, human, and unverified evaluation bases;
- accountability only for guidance actually delivered;
- inspectable decisions.

The migration may narrow, demote, replace, or remove current Playbook, RCCL,
relation, budgeting, challenge, and attestation mechanics when they do not
produce distinct user benefit over a capable Host Agent working from the task
and repository. No current mechanism is retained solely because its schema or
lifecycle is architecturally novel.

Individual current boundaries are superseded only when a concrete migration
change provides observable replacement behavior and proportional tests. Target
direction alone does not make the current implementation nonconforming.

## Decision filter for upgrade work

Every proposed persistent field, artifact, lifecycle stage, or control-plane
mechanism must answer all applicable questions:

1. What delegation, inspection, or adoption decision can it change?
2. What independent authority or evidence does it add beyond Host inference?
3. Can the developer inspect the decision it changed?
4. What user-visible behavior justifies its cost?

If these questions have no concrete answer, the mechanism does not belong in
the kernel.

## Amendment protocol

This direction is revision-controlled, not immutable. Repository facts,
production outcomes, and operational evidence may challenge it. An Agent must
not silently reinterpret or edit an accepted principle.

An amendment to an accepted principle or target capability must identify:

1. the exact decision being challenged;
2. the contradictory evidence or new product requirement;
3. why the current direction cannot accommodate it;
4. viable alternatives and their long-lived consequences;
5. the Agent recommendation, explicitly labeled as judgment;
6. the resulting human decision and its scope;
7. the text or prior decision being superseded, narrowed, or retained.

New evidence may update the migration plan without automatically changing a
long-lived product principle. Only a material semantic conflict returns the
principle itself for human decision.
