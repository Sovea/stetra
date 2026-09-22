---
name: stetra-design
description: During feature work, bug fixes, or refactoring, compare consequential design choices affecting behavior, interfaces, failure handling, or future extension. Also use for explicit design requests, goal clarification, and design feedback.
---

Help the developer understand an important engineering choice within the requested work. Apply [the shared collaboration guidance](../.stetra-shared/collaboration.md), reusing it if already loaded. Consult [the CLI reference](../.stetra-shared/cli.md) when knowledge needs retrieval or maintenance.

Start from the developer's concern, relevant code, existing project documents, and applicable knowledge already available. Separate explicit direction from your interpretation, proposals, and already adopted decisions. Investigate an uncertain assumption when it could change the choice. Use the shared retrieval guidance when relevant knowledge has not yet been loaded or the work changes direction.

Compare alternatives where the choice matters. Explain effects on current behavior, failure modes, cost, and future extension with concrete examples. Recommend a choice with its grounds and identify what would change the recommendation. Make choices covered by the existing coding request; ask for a decision when a consequential choice exceeds that authority. A request only to compare designs does not authorize implementing one.

Explain the result directly in the Host conversation. If the discussion changes understanding that future work relies on, update its original project document or revise the same Memory using its current revision. Preserve the distinction between a durable rule and a temporary concession for this work. Routine choices need a proportionate explanation, not extra process records.

When retrieval is needed, run this skill's `scripts/stetra.mjs` launcher through the Host's command tool, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache design" --path src/cache.ts --instructions`. Reuse the resulting current knowledge across capabilities while it remains applicable.
