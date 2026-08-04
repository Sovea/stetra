# @sovea/resonant-code-core

Deterministic kernel for the `resonant-code` change-adoption protocol.

```ts
import {
  compileDelegation,
  evaluateHandoff,
} from '@sovea/resonant-code-core';
```

`compileDelegation` validates one pre-change Semantic Contract. It keeps exact
developer events separate from agent interpretations, validates their bases and
repository evidence, and requires explicit verification commands or a concrete
no-command rationale before returning a runnable contract.

`evaluateHandoff` binds a post-change Cognitive Handoff to one collected Fact
Bundle. It validates evidence references, critical-claim falsification,
residual-unknown coverage, actionable attention, and the Review Map. It does
not turn agent judgment into a machine fact or record adoption.

The package exports these two runtime values plus their public TypeScript types.
It does not read repositories, execute commands, format CLI output, or call an
LLM. Normal coding-agent workflows should use the `@sovea/resonant-code` CLI,
which collects facts and supplies them to Core.
