# Product vision

## The problem

Coding Agents can investigate and implement changes faster than a developer can
reconstruct what they actually did. The developer is often left with a diff,
green checks, and an Agent completion story, but not a reliable understanding
of changed behavior, ownership, invariants, failure paths, or evidence gaps.

The resulting control gap is:

```text
developer request
  -> rapid Agent implementation
  -> persuasive completion summary
  -> adoption without an equally rapid recovery of engineering understanding
```

The implementation can be correct while the developer loses the ability to
explain or maintain it. It can also pass self-modified verification, solve a
symptom instead of an invariant, or leave unsupported compatibility and
recovery claims hidden in prose.

## Product thesis

Stetra lets developers delegate implementation without delegating away
engineering understanding or adoption authority.

It binds:

```text
what the developer authorized
  -> what the Runtime observed
  -> what the Agent concludes
  -> what remains unsupported or unknown
  -> what the developer decides
```

Stetra is a task-scoped project layer embedded in existing Coding Agent Hosts.
It does not replace their conversation, planning, execution, tools, or
subagents.

## Primary job

For one admitted Agent-authored change, help the developer answer:

1. Did the implementation remain connected to my request and corrections?
2. What behavior and mechanism actually changed?
3. What verification actually ran, and did the verification surface change?
4. What is unsupported, stale, unrepresentable, or still unknown?
5. Where will direct review most affect adoption?
6. Do I accept, request correction, reject, or defer this exact result?

Everything Stetra persists or asks the Agent to author must change one of those
answers.

## Product experience

The developer continues to talk naturally to Codex, Claude Code, Pi, or another
Host. Stetra creates no state for ordinary conversation. A coding task enters
Stetra only through an explicit developer choice or project admission policy.

The visible workflow is:

```text
Align
  Confirm the outcome, constraints, and verification boundary.

Work
  The Agent implements through its normal Host. Stetra independently records
  only baseline, current change, and verification facts at task boundaries.

Decide
  The Agent explains the actual current change. Stetra combines that judgment
  with Runtime facts and presents one compact Human decision surface.
```

Routine work stays close to ordinary Agent use. Consequential assurance appears
only because of an explicit Human choice, project policy, or concrete adverse
fact. Stetra never assigns scalar trust, readiness, confidence, complexity,
risk, or quality scores.

## Durable differentiation

A strong Markdown Skill and Trellis-style finish flow are decisive simpler
baselines. Stetra has no value if it only produces better prose.

Its Runtime must justify itself by mechanically providing capabilities text
instructions cannot:

- bind an exact Human request to a pre-change Git baseline;
- freeze and execute exact argv checks without a shell;
- preserve failed, timed-out, and superseded observations;
- detect check-induced and verifier-surface changes;
- reject a Handoff built on stale facts;
- keep Runtime facts separate from Agent judgment;
- bind Human adoption to one exact current Handoff and Fact Collection.

The differentiated product is not a larger workflow. It is a lower-cost Human
control loop over probabilistic Agent work.

## Relationship to Trellis and execution harnesses

Execution harnesses may own repository context, project specs, task planning,
model selection, subagents, implementation, tests, and repair.

```text
Coding Agent / Trellis / execution Host
  investigate -> plan -> implement -> test -> repair

Stetra
  preserve authority -> observe facts -> expose evidence boundaries
  -> reconstruct system meaning -> protect Human adoption
```

Stetra must compose with those systems. It should be possible to admit a task
after another harness finishes planning and to use the Stetra Decision Brief
inside that harness's finish flow without changing Core.

## North Star

> More Agent-authored production changes confidently adopted per active
> developer hour, without degrading implementation outcomes, developer
> understanding, evidence honesty, or Human authority.

The success criteria remain separate rather than collapsing into a score:

- implementation outcome;
- task and Agent overhead;
- time to a confident adoption decision;
- correctness of behavior, invariant, ownership, and failure-path
  understanding;
- useful correction rounds;
- evidence integrity;
- explicit adoption result.

## Evidence status

Product effectiveness is unverified. Unit tests, type checks, package builds,
and black-box CLI tests establish engineering integrity and usability
prerequisites, not adoption value.

Evaluation order is:

1. packed-package black-box usability with natural task prompts;
2. paired comparison with an ordinary Agent and strong Handoff Skill;
3. paired comparison with a Trellis-style managed task;
4. composition of Trellis plus Stetra;
5. only then, explicit product-owner acceptance of a scoped claim.

If Stetra does not lower adoption cost or change a real review decision while
preserving implementation and cognition, it must become smaller rather than
defend protocol complexity.

## The product in one sentence

> Stetra keeps the engineering control loop between developer intent and the
> actual Agent-authored change intact, so the result can be understood,
> challenged, and explicitly owned by the developer.
