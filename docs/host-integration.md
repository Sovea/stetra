# Host integration

All integrations use the same design, exploration, and explanation Skills and local knowledge runtime. Adapters handle resource discovery, native session identity, and context refresh through supported lifecycle events. Engineering discussion and execution remain in the Host.

## Project setup

Use Node.js 24+ and a full Stetra package containing this version. From the development checkout:

```sh
corepack pnpm install
corepack pnpm build
node /absolute/path/to/stetra/dist/cli.js init --project /absolute/path/to/project
```

A corresponding installed package provides `stetra init`. The terminal menu lists **Codex**, **Claude Code**, **pi**, and **Agent Skills (.agents/skills)**. Use Up/Down, Space, and Enter. A fresh installation starts with nothing selected; Esc or Ctrl-C cancels before writes. Recorded choices stay selected and locked when adding integrations.

Each named Host installs its Skills, runtime, and native integration together. The generic option installs the same Skills and runtime without hooks or an extension. Shared paths are deduplicated. Initialization preserves unrelated project settings and does not modify global configuration or grant trust.

| Option | Behavior |
| --- | --- |
| `--project PATH` | Select an existing project directory; direct CLI use otherwise defaults to the working directory. |
| `--yes` | Refresh an existing installation's recorded choices; it cannot choose Hosts for a new project. |
| `--json` | Format output without changing selection rules. |
| `--dry-run` | Show the installation plan without writes. |
| `--force` | Replace identified, modified Stetra-managed content while protecting unrelated files and settings. |

Noninteractive setup requires an existing installation and `--yes`. There is no adapter-selection flag or default Host. Use `init --yes --dry-run --json` to review a refresh before applying it.

## Installed resources

| Location | Purpose |
| --- | --- |
| `.stetra/runtime/cli.js` | Standalone copied runtime; pi selections also include `pi.js`. |
| `.stetra/installation.json` | Portable integration choices and ownership records. |
| `.agents/skills/stetra-design/`, `stetra-explore/`, `stetra-explain/`, `.stetra-shared/` | Skills and shared launchers for Codex, pi, and generic Agent Skills. |
| `.claude/skills/stetra-design/`, `stetra-explore/`, `stetra-explain/`, `.stetra-shared/` | The same Skills for Claude Code. |
| `.codex/hooks.json` | Supported session and prompt context hooks. |
| `.claude/settings.json` | Corresponding Claude hooks merged with existing settings. |
| `.pi/extensions/stetra.js` | Native pi knowledge context integration. |

Commit generated Skills, Host configuration, and `installation.json` together. The executable runtime, derived index, and session cache are ignored. Run initialization from the full package in each checkout and after upgrades; normal installed commands then work without the original package or its dependencies.

Setup checks conflicts before writes and refreshes only recorded managed content. Obsolete unchanged artifacts can be retired through that ownership record. Modified obsolete content causes a conflict rather than silent deletion. Existing legacy `state.sqlite` data is neither loaded nor deleted by the new runtime.

## Invoke the capabilities

Start a new Host session after setup or refresh:

| Integration | Example | Automatic context |
| --- | --- | --- |
| Codex | `$stetra-explore` | Supported SessionStart and UserPromptSubmit hooks, subject to trust and permissions. |
| Claude Code | `/stetra-explore` | Supported SessionStart and UserPromptSubmit hooks, subject to trust and permissions. |
| pi | `/skill:stetra-explore` | Native extension events using the current session identity. |
| Agent Skills | Discover or read `.agents/skills/stetra-explore/SKILL.md`. | None installed; retrieve context manually. |

The equivalent design and explanation names are `stetra-design` and `stetra-explain`. They are independent capabilities, not a required sequence. Generic format compatibility is not a claim that every agent has been tested.

Host trust and command permissions still apply. If hooks are unavailable, the Skills and CLI can be used through permitted file access and command execution. Initialization does not bypass Host approval rules.

## Retrieve knowledge

Each installed Skill's launcher selects its own project regardless of the shell's working directory:

```sh
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs context --query "cache failure" --path src/cache.ts
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs schema memory --action update
node /work/project/.agents/skills/stetra-explore/scripts/stetra.mjs call memory --input request.json
```

Claude uses the same launcher under `.claude/skills/`. Pass `--project` only when intentionally selecting another project. Raw CLI calls default to the working directory, so Host-generated raw calls should specify the project explicitly. JSON input can come from a file or stdin; never interpolate developer text into shell code.

With a native session ID, add `--host codex --session ID` or the corresponding Host name. A session's first selection needs no setup or binding call. Query, path, or explicit memory selectors replace its previous collection. Later calls without selectors refresh only the selected IDs and paths, reporting changed or unavailable versions. They do not rerun the earlier search and expand it to new matches. `--reset` requires the Host/session pair, clears its selection, and may be combined with new selectors.

Codex and Claude obtain identity from `session_id` in supported hook input; pi uses its session manager. The cache is isolated by project, Host, and native session. A fresh session does not inherit the latest selection from another one. A generic agent without a reliable identity should use stateless retrieval instead of inventing a native session.

Hooks refresh the selected knowledge on supported events. They do not extract goals from prompts, choose a task, queue messages, or start a new model turn. Pi likewise refreshes knowledge through its native lifecycle; it has no browser command or feedback polling loop. The Host decides when to search for additional knowledge and how it applies to the conversation.

Context supplies current bodies within a size budget, revision changes, unavailable selections, and an omitted count. Metadata for omitted items is included when space permits; selected IDs remain available for explicit reads. The Agent should replace earlier copies with the current versions and read omitted content before relying on it. Withdrawal or deletion stops future body delivery; it cannot erase content already in a model's conversation.

## Verification boundary

Tests can establish portable resources, configuration preservation, protocol shapes, current-version refresh, and session isolation. They cannot establish Host trust decisions or that a model follows the Skills. Report real Host discovery, trusted event execution, and useful model-backed engineering outcomes separately.

Earlier browser, feedback-delivery, and task-binding trials concern the removed architecture. They are not validation of this runtime. Keep current verification tied to knowledge retrieval in the Host conversation, without modifying global trust settings or publishing a package during ordinary tests.
