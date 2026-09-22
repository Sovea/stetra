---
name: stetra-explain
description: Explain current code, an engineering decision, or the consequences of implemented changes using direct evidence and relevant project knowledge. Use for questions about what changed, why it works this way, or how reality differs from earlier understanding.
---

Give the developer an accurate explanation that supports their next decision in the Host conversation. Read [the shared collaboration guidance](../.stetra-shared/collaboration.md) and use [the CLI reference](../.stetra-shared/cli.md) to retrieve or maintain relevant knowledge.

Inspect the implementation before claiming how it behaves. Retrieve current knowledge through `context` using a focused query, affected paths, or known memory IDs, then compare its claims with the code and available verification. Lead with the consequence the developer cares about and explain the cause in plain language. Use a before/after example, diagram, or pseudocode only when it clarifies this question.

Distinguish developer direction, Agent interpretation, proposals, actual choices, and implementation observations. An explanation request does not authorize code changes. If the explanation reveals a discrepancy, identify what differs, what supports that finding, and which earlier understanding needs correction. Cite inspected files or executed checks and label uncertainty that affects the conclusion.

Answer directly without requiring separate process records. Maintain the original project document when it owns the understanding; otherwise correct the same Memory using its latest revision. Preserve source and applicability. A temporary exception for the current work must not become permanent project guidance.

Run this skill's `scripts/stetra.mjs` launcher through the Host's command tool, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache behavior" --path src/cache.ts --instructions`. The shared CLI reference explains native session refresh, reset, and knowledge updates.
