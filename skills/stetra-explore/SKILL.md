---
name: stetra-explore
description: During feature work, bug fixes, or refactoring, investigate unverified assumptions, contradictions, or unclear root causes that could change the solution. Also use for explicit investigation requests, questions about implementation behavior, and experiments with engineering alternatives.
---

Resolve uncertainty that affects the requested work and explain what the investigation established. Apply [the shared collaboration guidance](../.stetra-shared/collaboration.md), reusing it if already loaded. Consult [the CLI reference](../.stetra-shared/cli.md) when knowledge needs retrieval or maintenance.

Identify the assumption, conflicting evidence, or unexplained behavior and why resolving it could change the solution. Use applicable knowledge already available, retrieving missing context according to the shared guidance. Inspect the implementation and its callers. Choose a focused experiment or test when reading alone cannot settle the question. Distinguish inspected facts, executed checks, and inferences; state a verification limit where it changes the conclusion.

For alternatives, show what behavior would change and which tradeoffs follow. Exploration is not adoption. Make implementation changes only within the developer's existing authorization, and proceed with explicitly authorized corrections without redundant approval. Keep reversible investigations proportional to the question.

Answer the actual question directly. When findings invalidate earlier knowledge, maintain the original project document or update the same Memory with the correction, its source, and current applicability. Withdraw or delete obsolete guidance where appropriate. Do not promote a temporary task-specific exception into a durable project rule, or preserve every experiment as a separate record.

When retrieval is needed, run this skill's `scripts/stetra.mjs` launcher through the Host's command tool, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache failures" --path src/cache.ts --instructions`. Reuse current relevant knowledge from an earlier design or explanation rather than repeating the same lookup.
