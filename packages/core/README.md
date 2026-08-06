# @sovea/stetra-core

Deterministic Semantic Contract and Cognitive Handoff kernel for the
task-scoped Stetra engineering loop.

```ts
import {
  compileDelegation,
  evaluateHandoff,
} from '@sovea/stetra-core';
```

`compileDelegation` validates one pre-change Semantic Contract. It keeps exact
developer events separate from agent interpretations, compiles explicit
adoption consequence and assurance dimensions into a routine, standard, or
critical Assurance Plan, validates their bases and repository evidence, and
requires explicit verification commands or a concrete no-command rationale
before returning a runnable contract.

`evaluateHandoff` binds a post-change Cognitive Handoff to one collected Fact
Bundle. It validates compiled dimension coverage, evidence references,
critical-claim falsification and direct review, residual-unknown coverage,
actionable attention, and the Review Map. A clean routine plan may use no
claims; collected fact conditions can still escalate it. Evaluation does not
turn agent judgment into a machine fact or record adoption.

The package exports these two runtime values plus their public TypeScript types.
It does not read repositories, execute commands, format CLI output, or call an
LLM. Normal coding-agent workflows should use the `@sovea/stetra` CLI,
which collects facts and supplies them to Core.
