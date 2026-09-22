---
name: stetra-explain
description: When handing off feature work, a bug fix, or a refactor with meaningful effects, explain changes to behavior, existing callers, or future extension. Also use for explicit requests to explain code, an engineering decision, or differences from earlier understanding.
---

Make the result and its consequences understandable when reporting completed work or answering an explanation request. Apply [the shared collaboration guidance](../.stetra-shared/collaboration.md), reusing it if already loaded. Consult [the CLI reference](../.stetra-shared/cli.md) when knowledge needs retrieval or maintenance.

Use the implementation and verification already inspected during the work, checking anything still uncertain before claiming how it behaves. Compare the result with the developer's concern, earlier choices, and current applicable knowledge. Lead with the behavior or consequence that matters, then explain why it changed and what it means for existing callers and future extension. Use a before/after example, diagram, or pseudocode only when it clarifies this question.

Distinguish developer direction, Agent interpretation, proposals, actual choices, and implementation observations. An explanation request does not authorize code changes. If the explanation reveals a discrepancy, identify what differs, what supports that finding, and which earlier understanding needs correction. Cite inspected files or executed checks and label uncertainty that affects the conclusion.

Answer directly without requiring separate process records. Maintain the original project document when it owns the understanding; otherwise correct the same Memory using its latest revision. Preserve source and applicability. A temporary exception for the current work must not become permanent project guidance.

Reuse the relevant current knowledge from implementation. If the explanation raises a new concern or depends on knowledge not yet retrieved, run this skill's `scripts/stetra.mjs` launcher, for example `node <absolute-skill-path>/scripts/stetra.mjs context --query "cache behavior" --path src/cache.ts --instructions`.
