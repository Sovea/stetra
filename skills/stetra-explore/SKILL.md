---
name: stetra-explore
description: Investigate implementation behavior, trace a discrepancy, or test an engineering alternative using project knowledge and the Host's tools. Use when evidence from code or execution is needed to resolve the developer's uncertainty.
---

Resolve the developer's uncertainty with an investigation they can assess in the Host conversation. Read [the shared collaboration guidance](../.stetra-shared/collaboration.md) and use [the CLI reference](../.stetra-shared/cli.md) to retrieve or maintain relevant knowledge.

Identify the disputed behavior or assumption, then use `context` with a focused query, affected paths, or known memory IDs. Inspect the implementation and its callers. Choose a focused experiment or test when reading alone cannot settle the question. Distinguish inspected facts, executed checks, and inferences; state a verification limit where it changes the conclusion.

For alternatives, show what behavior would change and which tradeoffs follow. Exploration is not adoption. Make implementation changes only within the developer's existing authorization, and proceed with explicitly authorized corrections without redundant approval. Keep reversible investigations proportional to the question.

Answer the actual question directly. When findings invalidate earlier knowledge, maintain the original project document or update the same Memory with the correction, its source, and current applicability. Withdraw or delete obsolete guidance where appropriate. Do not promote a temporary task-specific exception into a durable project rule, or preserve every experiment as a separate record.

Run this skill's `scripts/stetra.mjs` launcher through the Host's command tool, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache failures" --path src/cache.ts --instructions`. The shared CLI reference explains native session refresh, reset, and revision conflicts.
