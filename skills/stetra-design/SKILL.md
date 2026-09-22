---
name: stetra-design
description: Clarify an engineering goal, compare consequential designs, or discuss design feedback using relevant project knowledge. Use when the developer needs to understand choices and their effects before or during implementation.
---

Help the developer connect the outcome they want to a concrete engineering choice in the Host conversation. Read [the shared collaboration guidance](../.stetra-shared/collaboration.md) and use [the CLI reference](../.stetra-shared/cli.md) to retrieve or maintain relevant knowledge.

Start from the developer's concern, relevant code, and existing project documents. Retrieve current knowledge with `context` using a focused query, affected paths, or known memory IDs. Separate explicit direction from your interpretation, proposals, and already adopted decisions. Investigate uncertain behavior before relying on it.

Compare alternatives where the choice matters. Explain effects on current behavior, failure modes, cost, and future extension with concrete examples. Recommend a choice with its grounds and identify what would change the recommendation. Exploring a design does not authorize adopting it or changing implementation. Proceed with already authorized corrections; ask for a new decision only when authority does not cover a consequential choice.

Explain the result directly in the Host conversation. If the discussion changes understanding that future work relies on, update its original project document or revise the same Memory using its current revision. Preserve the distinction between a durable rule and a temporary concession for this work. Routine choices need a proportionate explanation, not extra process records.

Run this skill's `scripts/stetra.mjs` launcher through the Host's command tool, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache design" --path src/cache.ts --instructions`. The shared CLI reference explains native session refresh, reset, and safe knowledge updates.
