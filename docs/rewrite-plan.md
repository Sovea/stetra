# Product direction

Stetra is a human–Agent collaboration plugin for coding Hosts. Its purpose is to help developers understand engineering work, influence consequential choices, and retain decision authority as implementation changes.

## The problem

An Agent can produce working code while missing the developer's design concerns. Long explanations, invented terminology, and vague change reports make it difficult to assess a proposal or understand its effects on existing behavior and future extension.

The primary value is better engineering judgment and participation. Completion time and other metrics can inform evaluation, but they cannot substitute for a developer's assessment of a design or explanation.

## The method

Keep three questions connected throughout the conversation:

1. What are we trying to solve, and what does the developer care about?
2. Why these designs? Which choices have been made, and on what grounds?
3. What was actually implemented, and how does it differ from the earlier understanding?

The questions can correct one another. A new constraint may invalidate a design; investigating code may change the original interpretation; implementation may expose an unforeseen consequence. Explain the difference and act within existing authorization.

Use three independent Skills: design, explore, and explain. They guide reasoning and communication in the Host's normal conversation. They are not mandatory stages, and they do not require a task record, frozen plan, formal acceptance, or separate collaboration interface.

## Product boundary

The Host owns conversation, model execution, code discovery, impact analysis, implementation, verification, and repair. Stetra does not record a parallel task model, queue developer feedback, or persist structured answers as a second conversation history.

Stetra's runtime has a narrower job: retrieve applicable knowledge, refresh selected versions, enforce explicit storage scope and revision checks, and support correction, withdrawal, and deletion. Native adapters use supported Host lifecycle events to refresh that context. They do not start a new model turn or interpret developer authority.

A small session cache remembers selected knowledge IDs, versions, and paths. It is disposable retrieval state, not a session ledger. Without a native session identity, the same capabilities work through stateless CLI retrieval.

## Understanding and authority

Lead with the concrete consequence and explain the cause. Distinguish developer direction, Agent interpretation, proposed alternatives, adopted choices, and observed behavior. Use a diagram, pseudocode, or code excerpt only when it helps the current question.

Asking for an explanation does not authorize implementation. Exploring an alternative does not adopt it. Explicitly authorized corrections should proceed without redundant confirmation. A new consequential choice outside existing authority belongs with the developer. Silence does not establish understanding or acceptance.

The Agent must inspect relevant code and callers before making claims about behavior. Separate what was inspected, what was executed, what is inferred, and what remains unknown. Stetra's storage cannot certify these semantic judgments.

## Persistent knowledge

Preserve information that can affect later work: meaningful constraints, decisions and reasons, observations, and hypotheses. Record source, applicability, path restrictions, references, and current validity. New knowledge has project storage scope; local conditions must remain explicit rather than becoming blanket project rules.

Reference existing documents instead of creating competing authorities. Do not save every exchange or turn one correction into a permanent user preference. Refresh selected knowledge before relying on it; replace obsolete versions and stop treating withdrawn or deleted items as current guidance. Current requests take precedence over stale stored interpretations of authorization.

Markdown files are authoritative. SQLite is a derived search index, and session selection files are disposable cache. Removing either derived component does not remove the knowledge. External editing and Git remain available, with their own concurrency limits.

## Demonstrating value

Use a small real engineering problem to observe the complete experience:

- A developer asks about a consequential behavior or design.
- The Host retrieves relevant knowledge, investigates the code, and gives an understandable answer.
- A correction changes the relevant understanding; an explicit implementation instruction leads to a verified change.
- Knowledge that should remain useful is updated with narrow applicability.
- A later conversation retrieves the current version, while replaced, withdrawn, or deleted content is no longer supplied as current guidance.

The conversation and real engineering work are the sample. Creating records or producing valid JSON is not the success criterion. Deterministic tests establish retrieval, scope, revisions, and isolation; actual Host trials assess whether the method helps engineering decisions and explanations.

This direction permits removing earlier commands, storage models, interfaces, and tests. Do not rebuild a task ledger, workflow engine, model runtime, browser platform, vector database, or distributed memory system without a concrete need arising from this experience.
