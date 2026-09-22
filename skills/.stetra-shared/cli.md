# Stetra CLI

Run `node <absolute-skill-directory>/scripts/stetra.mjs <command>` through the Host's command tool. The launcher supports packaged plugins and project installations. A packaged plugin uses its own runtime; an installed project launcher selects its own project independently of the shell cwd. Pass `--project <path>` only when intentionally choosing another project. Node.js 24+ and file access are required.

## Retrieve context

Use one command to select relevant current knowledge:

```sh
node <skill-directory>/scripts/stetra.mjs context --query "cache failure behavior" --path src/cache.ts --instructions
```

`--path` and `--memory <UUID>` can be repeated. Omit `--instructions` for structured JSON with the selected current memories and any unavailable selections or file issues. Choose queries and paths from the developer's actual concern and inspected code; a search result does not establish that its guidance is applicable.

When the Host supplies a native session ID, include `--host codex|claude|pi|agents --session <ID>`. New query, path, or memory inputs replace the previous context selection. With no new inputs, the command refreshes the previous selection's current versions. A new session starts without another session's selection. Do not invent a native session identity.

`--reset` requires a Host and session pair. It clears the old selection and can be combined with new query, path, or memory inputs when switching to unrelated work. The cache contains only a bounded knowledge selection, never the developer's goal or conversation.

Codex and Claude project hooks refresh context at session start and before user prompts. Pi uses its native session ID and context lifecycle. Generic Agent Skills have manual context retrieval; the presence of a Skill does not guarantee native lifecycle integration in every Host.

## Inspect and maintain memory

Use `schema memory --action update` (or another action) for a focused JSON Schema. `call memory --input -` reads one request from stdin; a JSON file also works. Never interpolate developer-authored text into shell code.

Supported actions are `list`, `read`, `search`, `recall`, `create`, `update`, and `delete`. For ordinary knowledge retrieval prefer `context`, which combines selection and current-body retrieval. `search` finds candidates with `query`, optional `paths`, and `limit`; `recall` retrieves optional `paths` and `ids`. `read` takes `memoryId`.

A new memory request can contain:

```json
{
  "action": "create",
  "memory": {
    "title": "Preserve cache failure behavior",
    "body": "A failed lookup must reach callers as an error. Source: the developer's project requirement. Applies to the cache read path; verified against src/cache.ts.",
    "source": "developer",
    "kind": "constraint",
    "applicability": "Cache reads that wrap fallible lookups.",
    "paths": ["src/cache.ts"],
    "references": ["docs/cache-contract.md"]
  }
}
```

New memories default to project scope. `kind` can be `constraint`, `decision`, `observation`, or `hypothesis`; `status` can be `active` or `withdrawn`. `references` are strings, and `paths` are project-relative files or directories. Do not encode temporary task state as a project constraint. Older task-scoped files remain available for explicit management through `read` or `allScopes`; they are not selected automatically for current work.

When an existing understanding changes, read its latest body and revision, then use `update` with `memoryId`, `expectedRevision`, and the complete replacement `memory`. Revisions are SHA-256 content digests. On conflict, read again and reconcile; never retry stale content with a newer revision. Prefer updating the original project document when it owns the rule. `delete` takes `memoryId` and `expectedRevision`; withdrawal uses an update with `status: "withdrawn"`.

Markdown files are authoritative and directly editable. The search index and session selection cache are disposable. References and memory IDs do not preserve historical file snapshots; inspect the current source with the Host's normal code tools when verifying a claim.
