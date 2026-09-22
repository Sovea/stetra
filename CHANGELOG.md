# Changelog

## Unreleased

- Keep design, exploration, and explanation in the coding Host's conversation through `stetra-design`, `stetra-explore`, and `stetra-explain`.
- Remove the independent browser, task and entry model, feedback queue, stored results, and session bindings. The runtime no longer reads or writes `state.sqlite`; existing files are left in place.
- **CLI change:** remove `view` and `call task`, `entry`, `feedback`, `session`, and `source`. Keep `call memory` and add `schema memory --action ACTION` for focused schema inspection.
- Replace task-bound context with query, path, and explicit knowledge selection. Native sessions cache selected IDs, paths, and supplied revisions; calls without selectors refresh the existing collection. `--reset` clears it, and calls without a session are stateless.
- Supply corrected current knowledge and report unavailable or unselected versions. Withdrawn and deleted bodies stop being supplied on future context reads; already-delivered conversation content is outside that guarantee.
- Keep Markdown as authoritative knowledge, SQLite as a rebuildable search index, and session files as disposable cache. No messages, goals, query text, or interaction history are cached.
- New knowledge writes use project scope, with explicit applicability and optional paths for local conditions. Legacy task-scoped items remain available through management operations but are excluded from active recall and runtime updates.
- Refresh selected knowledge through supported Codex/Claude hooks and pi lifecycle events. Remove pi browser commands, feedback polling, and model-turn triggers.
- Preserve the four-choice project-local initialization menu, portable copied runtime, and managed-artifact upgrade protections. Preview an existing installation's refresh with `init --yes --dry-run`.

These changes are on the development branch and are not a new published package release. Earlier browser and feedback-delivery trials do not validate the new conversation-and-knowledge boundary.

## Earlier rewrite foundation

Earlier development versions introduced the three capability Skills, shared project launchers, local installation, Markdown knowledge, and derived search. They also experimented with a task database and browser feedback interface. Those interaction and state models have been removed rather than retained as compatibility requirements. Existing user data is not automatically deleted.
