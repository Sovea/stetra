# @sovea/stetra-core

Deterministic Semantic Contract, Fact Spine, and Cognitive Handoff kernel for
the task-scoped Stetra engineering loop.

```ts
import {
  compileDelegation,
  evaluateHandoff,
} from '@sovea/stetra-core';
```

`compileDelegation` validates one pre-change Task Contract or immutable
Verification Revision. It keeps exact developer events separate from Agent
interpretations, requires a falsifiable Evidence Obligation for every declared
Condition, separates semantic/verification/effective identities, and requires
explicit checks or a concrete no-command rationale.

`evaluateHandoff` binds Obligation and Condition conclusions, independent
Challenges, and an optional exact Human Decision to one Attempt and Fact
Bundle. It keeps Runtime facts, Agent conclusions, actionable Attention,
recommendation, and Human adoption authority separate. Stale facts stop
evaluation first, and acceptance with Attention requires an exact exception for
every item.

The package exports these two runtime values plus their public TypeScript types.
It does not read repositories, execute commands, format CLI output, or call an
LLM. Normal coding-agent workflows should use the `@sovea/stetra` CLI,
which collects facts and supplies them to Core.
