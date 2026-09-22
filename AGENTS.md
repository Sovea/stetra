# Stetra

Stetra is a human–Agent collaboration plugin for coding Hosts. It helps developers understand engineering work, influence consequential choices, and retain decision authority. Design, exploration, and explanation happen in the Host's conversation through three Skills.

Keep three questions connected:

- What are we solving, and what does the developer care about?
- Why these designs? Which choices have been made, and on what grounds?
- What was actually implemented, and what differs from the earlier understanding?

These are ongoing questions, not workflow stages or required documents. Do not introduce task admission, frozen plans, feedback queues, an evidence ledger, formal acceptance records, or an independent browser interface.

## Responsibilities

The Host owns conversation, model execution, code discovery, caller and impact analysis, implementation, verification, and repair. Skills guide semantic judgment and communication. Stetra's runtime provides actual knowledge retrieval, scope filtering, current-version refresh, revision-protected replacement, withdrawal, and deletion.

The runtime does not store tasks, entries, feedback, answers, goals, or an understanding/acceptance model. Do not infer authority, semantic importance, or acceptance through keywords or scores. A request for explanation does not authorize code changes; exploring an alternative does not adopt it. Explicitly authorized corrections proceed without redundant approval. New consequential choices outside existing authority belong with the developer. Silence is not acceptance.

## Knowledge

Authoritative knowledge lives in `.stetra/memory/<uuid>.md`. SQLite is a derived search index. The bounded native-session cache stores selected knowledge IDs, versions, and paths; it is not a message store or session history. Clearing the cache requires retrieval again and loses no authoritative knowledge.

New knowledge uses project storage scope. Preserve narrow applicability, source, paths, references, and current validity. Do not promote local feedback into a general preference or persist every conversation event. Reference established project documents rather than duplicating their authority. Old task-scoped knowledge is management-only: it is not automatically recalled or promoted, and runtime updates must not silently change its scope.

Context selectors replace a session's selected collection. Without selectors, refresh only previously selected IDs; without a session, retrieval is stateless. A fresh session does not inherit another session's context. Updated or unavailable versions should stop earlier content from being supplied as current guidance. Deletion cannot erase content already delivered to a Host or retained in Git and backups.

The Agent determines semantic applicability and reconciles changed guidance with the current request and code. Program behavior cannot prove model compliance. Current developer direction takes precedence over stale stored interpretations of authority.

## Structure and integration

Keep one TypeScript package. `src/runtime/` owns knowledge operations, selection cache, storage access, and shared context. `src/setup/` owns resource loading, installation planning, conflict checks, and writes. `src/adapters/` declares integration artifacts and handles Host lifecycle protocols; declarations must not write files or inspect knowledge. Keep the static registry separate from pi's native extension. `src/cli/` owns Commander commands and terminal presentation. Resolve package resources through `src/package.ts`.

Project setup starts with one `stetra init` multi-select ordered Codex, Claude Code, pi, then Agent Skills (.agents/skills). Named agents install the Skills, runtime, and native integration together. The generic option installs the same Skills and CLI without a native hook or extension. It requires file access and Node.js 24+ command execution. Deduplicate shared resources, refresh only managed artifacts, and preserve unrelated project settings. Do not claim automatic context delivery or verified support for every generic agent.

Supported native hooks or extension events refresh selected knowledge. Pi has no browser process, feedback poller, or model-turn trigger. Ordinary commands use the copied project runtime without the original package. Existing legacy `state.sqlite` files are neither read nor automatically deleted.

## Working principles

All Skills, model instructions, command descriptions, generated prompts, and source errors are English. Developer-authored project content may use any language. See `docs/rewrite-plan.md` for direction and `docs/implementation.md` for current contracts. Earlier commands, schemas, storage models, and designs are not compatibility requirements.

Keep explanations concrete, concise, and centered on effects on existing behavior and future extension. Distinguish inspected facts, executed checks, inferences, and unresolved limits. Use diagrams and pseudocode only when they clarify the current question.

Do not add a workflow/DAG engine, model runtime, vector database, distributed memory system, or parallel implementation platform without a concrete product need. Validate program behavior through meaningful tests and assess Skill quality through real engineering work. Host protocol tests do not establish trusted native execution or model behavior; report those boundaries accurately.
