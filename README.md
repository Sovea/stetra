# Stetra

Discuss better designs, investigate uncertainty, and understand what changed inside your coding Host.

Stetra provides three Skills—**design**, **explore**, and **explain**—and a local knowledge runtime. The conversation stays in the Host. The Host discovers code and callers, compares alternatives, implements authorized changes, and verifies them. Stetra helps it retrieve relevant knowledge, notice revised or withdrawn guidance, and preserve useful constraints with a clear source and scope.

The method keeps three questions connected:

- What are we solving, and what matters to the developer?
- Why these choices, and what consequences do they have?
- What was actually implemented, and what differs from the earlier understanding?

These are ongoing questions, not workflow stages. Ordinary work needs no Stetra task, feedback queue, separate browser, or approval record. A question does not authorize a code change; exploring an alternative does not adopt it.

## Set up a project

Requires Node.js 24+. These development changes have not been published as a new package release. Build this checkout first:

```sh
corepack pnpm install
corepack pnpm build
node /absolute/path/to/stetra/dist/cli.js init --project /absolute/path/to/your/project
```

The single menu lists **Codex**, **Claude Code**, **pi**, and **Agent Skills (.agents/skills)**. Use arrow keys, Space, and Enter. A new installation starts with nothing selected; Esc or Ctrl-C cancels before writes. Installed choices stay selected and locked when adding integrations.

Each named Host installs the Skills, runtime, and native integration together. The generic option installs the same Skills and CLI for agents with file access and Node.js command execution, without automatic context hooks. Shared files are copied once, unrelated project configuration is preserved, and global Host settings are unchanged.

With a package containing this version, run `stetra init` in your project. After upgrades or cloning a checkout, run initialization from the full package again. `init --yes` refreshes recorded integration choices; initial selection requires a terminal. `--json` only formats output. The copied runtime subsequently works without the original package or a global command.

## Use the Skills in the conversation

The Agent can select these Skills during an ordinary coding task when a design choice, investigation, or explanation would help. Each capability applies to the relevant part of the work; a small mechanical edit needs no additional process.

| Skill | Useful during ordinary coding |
| --- | --- |
| `stetra-design` | A feature or refactor introduces a consequential choice about APIs, responsibilities, or behavior. |
| `stetra-explore` | A bug, unexpected behavior, or uncertain assumption needs code inspection and focused checks. |
| `stetra-explain` | An implementation needs a clear account of what changed, caller impact, and effects on future extension. |

For example, “Add retries without hiding query failures” can prompt exploration of existing error handling and an explanation of the resulting caller behavior. Use design guidance if a consequential choice arises. There is no required three-step sequence.

To request a capability explicitly, invoke `$stetra-explore` in Codex, `/stetra-explore` in Claude Code, or `/skill:stetra-explore` in pi. A generic agent can read the corresponding `.agents/skills/stetra-explore/SKILL.md`. Automatic discovery and selection depend on the Host and model; installed files or a configured hook do not prove the Agent used them. See the [local checks](docs/host-integration.md#check-discovery-delivery-and-use) when Stetra appears inactive.

Ask a concrete question such as “Why does a failed query become an empty result? Explain the caller impact before changing anything.” Continue the discussion in the same Host. If you later authorize a change, the Host implements it and explains what changed. Relevant knowledge can be corrected or retained without saving the conversation as a second task system.

## Knowledge that stays current

Knowledge is editable Markdown with a stable ID, source, kind, applicability, optional project-relative paths, and active/withdrawn status. Kinds distinguish constraints, decisions, observations, and hypotheses. New items belong to the project; narrower applicability belongs in their explicit conditions and paths. A local correction must not become a universal preference.

The first relevant use in a fresh session needs a `context` call with a query, affected paths, or known memory IDs. A refresh alone has no previous selection to load. With no selection, context reports the active project knowledge count without injecting its contents; the Agent chooses what is relevant. Search returns candidates; context and recall retrieve full current bodies. Later context reads refresh the selected IDs from authoritative files, so corrections appear and withdrawn or deleted bodies stop being supplied. This cache contains no messages, goals, task history, or acceptance state. Without a session, retrieval is stateless.

The Agent remains responsible for deciding whether retrieved guidance applies. Search matches, active status, and successful loading do not establish truth, authorization, or model compliance. Existing project documents should be referenced where they already express the knowledge well.

## CLI

Installed Skills provide a launcher that selects their own project independently of the shell's working directory:

```sh
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs context --query "cache failure" --path src/cache.ts
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs schema memory --action update
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs call memory --input request.json
```

For raw CLI calls, use `node .stetra/runtime/cli.js` and specify `--project` when the working directory is not the project.

| Command | Behavior |
| --- | --- |
| `context --query TEXT` | Select relevant knowledge by search. |
| `context --path PATH`, `--memory UUID` | Select by project-relative paths or explicit IDs; both flags are repeatable. |
| `context --host HOST --session ID` | Refresh knowledge previously selected for that native Host session. No initialization or binding operation is needed. |
| `context --reset --host HOST --session ID` | Clear the session selection; new selectors may be supplied in the same call. |
| `context --instructions` | Return bounded Host instructions as JSON `{ "text": "..." }`. |
| `schema memory [--action ACTION]` | Inspect the actual request schema, optionally for one action. |
| `call memory --input FILE` | List, read, search, recall, create, update, or delete knowledge; `-` reads JSON from stdin. |

Supplying query, path, or ID selectors replaces the previous selection. Without selectors, a session refreshes only its previously selected knowledge. A fresh session does not inherit another session's selection. Use the native ID supplied by the Host; a generic agent without one can use stateless retrieval. Updates and deletion require the revision read earlier. On a conflict, reread and reconcile before retrying. See the [CLI reference](skills/.stetra-shared/cli.md).

## Files and upgrades

```text
<project>/.stetra/
  installation.json    # Portable integration ownership record
  runtime/             # Copied executable snapshot; ignored by Git
  memory/<uuid>.md     # Authoritative knowledge with YAML metadata
  index.sqlite         # Rebuildable search index; ignored
  cache/               # Disposable session knowledge selections; ignored
```

Each checkout has its own runtime, index, and cache. Commit generated Skills, Host configuration, and `installation.json` together; commit knowledge when you want to share it through Git. Clearing the index or cache loses no authoritative knowledge. Retrieve relevant knowledge again after clearing a selection cache.

The previous task database is no longer read or written. Existing `state.sqlite` files are left in place; upgrades do not delete them. Old task-scoped knowledge remains inspectable through explicit management operations but is not automatically injected or promoted to project scope. Deleting current knowledge does not erase Git history, backups, or content already present in a Host conversation.

## Development and limits

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm verify
```

Tests cover storage, retrieval, revision conflicts, session isolation, real CLI processes, installation, and adapter contracts. They do not prove design quality or that a model always follows the Skills. Real Host discovery, trust, hook execution, and useful engineering outcomes require separate verification.

See [Host integration](docs/host-integration.md), [implementation](docs/implementation.md), and the [product direction](docs/rewrite-plan.md).
