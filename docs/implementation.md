# Implementation

Stetra combines three conversation Skills with a project-local knowledge runtime. The Host performs semantic judgment, discovers code and callers, implements authorized changes, and verifies them. The runtime retrieves and refreshes knowledge and protects its updates. It does not store tasks, current-understanding entries, developer feedback, structured answers, or acceptance state.

## Module boundaries

| Location | Responsibility |
| --- | --- |
| `src/runtime/` | Validate memory operations, select and refresh knowledge, manage disposable session cache, and compose bounded Host context. |
| `src/runtime/knowledge/` | Read authoritative Markdown, enforce scope and revisions, reconcile a derived search index, and retrieve full content. |
| `src/setup/` | Load package resources, plan installation, detect conflicts, and apply guarded writes. |
| `src/adapters/` | Declare integrations and translate supported Host lifecycle events into knowledge refresh. |
| `src/cli/` | Define Commander commands and the Ink setup selector. |
| `src/package.ts` | Resolve source and built package resources. |
| `skills/stetra-design/`, `stetra-explore/`, `stetra-explain/`, `.stetra-shared/` | Share reasoning guidance, the CLI contract, and launchers. |

Keep one package. Adapter declarations do not write files or inspect knowledge; the static registry does not import pi's executable extension. The full package includes the dynamically loaded initialization UI and chunks. An installed project needs the copied CLI and pi runtime when selected. There are no browser assets or server.

## Authoritative knowledge

`.stetra/memory/<uuid>.md` contains YAML metadata and a Markdown body:

| Field | Meaning |
| --- | --- |
| `title`, `source` | Description and supplied developer/Agent attribution. |
| `kind` | Constraint, decision, observation, or hypothesis; defaults to observation. |
| `scope` | New writes use project scope, which is also the default. |
| `applicability` | Explicit human-readable conditions under which the item applies. |
| `paths` | Optional project-relative files or directories. |
| `status` | Active or withdrawn. |
| `references` | Supporting material, including existing project documents. |

Project storage scope does not make a local condition a rule for the entire project. The Agent must state narrow applicability and paths where appropriate. Runtime scope and path checks cannot determine whether a claim is semantically correct or newly authorized.

Revisions are hashes of the complete current file. Updates replace the complete input and require the revision previously read; deletion requires it too. Conflicts require rereading and reconciliation. An update never recreates a missing ID. Withdrawal is an ordinary revision-protected update that retains all other metadata.

Runtime writers and retrieval coordinate with a filesystem lock; replacement uses a temporary file and atomic rename. External editors and Git do not participate in that lock. Their earlier edits are detected through file revisions, but arbitrary simultaneous external writing is not coordinated. Malformed or oversized individual files are reported as issues while valid knowledge remains usable. Storage path protections reject unsafe symlinks.

## Search and recall

`list` returns summaries. `search` finds candidates with snippets through SQLite FTS5 token matching, supplemented by Unicode substring matching. The index is reconciled against current Markdown before retrieval; it is derived, disposable data rather than another writable authority.

`recall` returns full active project-scoped content for supplied IDs or relevant path scopes. Empty selection does not inject all project knowledge. Path restrictions respect directory boundaries rather than sibling string prefixes. Explicit IDs do not override conflicting paths, withdrawn status, or legacy scope exclusions. `read` is an explicit management operation and can inspect a withdrawn or otherwise ineligible item.

Old task-scoped files remain readable and visible through `allScopes` management. They are excluded from active recall, even by explicit ID, and cannot be updated into project scope through the runtime. An Agent must not silently promote them. If their content should become project knowledge, that is a separate explicit creation or deliberate manual maintenance decision.

## Context and session cache

The `context` command accepts optional query, repeatable path and memory selectors, a Host/session pair, and reset:

- A query with paths searches inside the eligible path scope, then merges explicit IDs subject to the same restrictions.
- Paths without a query select applicable knowledge for those paths, together with eligible explicit IDs.
- Any supplied selector replaces the prior selected collection.
- Without selectors, a session refreshes only its existing selected IDs; it does not rerun an earlier query or expand the set.
- Reset requires a Host/session pair, clears the selected collection, and can accompany a fresh selection.
- Without a Host/session pair, selection is stateless. A fresh session without selectors returns no knowledge bodies.

The cache is isolated by project, Host, and native session. It stores bounded knowledge IDs, path selectors, and previously supplied versions under `.stetra/cache/`. It stores no query text, messages, task goals, answers, or interaction history. There is no session initialization or binding operation. Clearing the cache loses only retrieval state; the Host can search again.

Context returns `projectRoot`, an optional session key, `knowledge` with full current `memories`, `unavailable`, and `issues`, plus `selection`, `changes`, `omitted`, and `omittedCount`. A memory's current revision is in the supplied item. Changes identify `updated`, `unavailable`, or `unselected` items with their prior revision; they describe retrieval changes, not proof that a model obeyed them.

Returned bodies have an overall size budget. Metadata for omitted items includes IDs, titles, and revisions when space permits; `omittedCount` also counts items whose metadata does not fit. Selected IDs remain available in `selection` for explicit `call memory read` requests. Only a body actually returned by context advances its cached supplied revision; omitted metadata does not acknowledge that version. A newer omitted version therefore continues to be reported as changed relative to the earlier supplied body.

`context --instructions` wraps guidance as JSON `{ "text": "..." }`, with its complete text limited to 16,000 bytes including project and CLI paths. Knowledge bodies are omitted whole rather than truncated. The Host must treat attributed knowledge as context, replace obsolete copies, and read omitted detail before relying on it. Absence from a bounded excerpt is not a semantic judgment.

## Removed state

The runtime has no task, entry, feedback, session-binding, source-preview, or view operations. Source discovery and engineering explanations belong to the Host. Existing `state.sqlite` files are not read, migrated, or automatically deleted. Their presence must not influence new context.

Markdown is the only persistent knowledge authority. `index.sqlite` is a rebuildable index and `cache/` is disposable selection state. Neither is a conversation database. Deleting current knowledge does not erase Git history, backups, or already-delivered model context.

## Verification

Use real CLI processes to exercise a natural sequence: select relevant knowledge, correct its file, refresh the same session, stop delivering withdrawn or deleted content, and keep other sessions isolated. Check stateless generic retrieval and ensure removed commands fail without writing files.

Storage and adapter tests establish program behavior. Useful designs, clear explanations, correct interpretation of authorization, and appropriate knowledge maintenance require separate Host trials. No runtime score or successful operation establishes developer understanding or acceptance.
