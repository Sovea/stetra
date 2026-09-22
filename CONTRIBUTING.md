# Contributing

Use Node.js 24+ and the pnpm version in `package.json`. Install with `corepack pnpm install` and run `corepack pnpm verify` before submitting changes.

Read [AGENTS.md](AGENTS.md), the [product direction](docs/rewrite-plan.md), and [implementation notes](docs/implementation.md). Skills, model instructions, CLI descriptions, generated prompts, and source errors are English. Developer-authored project content can use any language.

## Keep the boundary small

Use one TypeScript package. The runtime handles authoritative Markdown knowledge, derived search, bounded session selections, current-version context, and revision-protected mutations. Setup handles resources and guarded installation. Adapters handle static integration declarations and supported Host events. The CLI uses Commander and an Ink initialization menu. Resolve package resources through `src/package.ts`.

The three Skills share their method and CLI reference under `skills/.stetra-shared/`. The Host performs code discovery, reasoning, implementation, verification, and conversation. Do not add a parallel task model, feedback queue, browser, result store, or acceptance workflow. Adapter declarations must not write files or inspect knowledge, and their registry must remain separate from pi's executable extension.

Markdown is the knowledge authority. The index and session cache must remain disposable. Reconcile current files before retrieval, enforce declared scope and paths, and use expected revisions for replacement and deletion. External editor races have different guarantees from cooperating runtime writers; do not overstate them.

A project's local condition belongs in explicit applicability and paths. Old task-scoped files are management-only and must not be automatically recalled or promoted. Search matches are candidates, not judgments of importance or truth. Questions, alternative exploration, and implementation authorization remain distinct in the Skills and Host conversation.

## Setup and distribution

Keep one multi-select ordered Codex, Claude Code, pi, then Agent Skills. Initial selection is interactive with no preselected Host. Recorded choices remain selected; `--yes` refreshes them and `--json` only formats output. Separate terminal interaction from installation writes.

Setup stays additive and idempotent, checks conflicts before writes, and preserves unrelated configuration even with `--force`. Retire obsolete managed artifacts only through recorded ownership. Keep `installation.json` portable and trackable alongside generated integrations. Runtime, index, and selection cache files are local derived resources. Do not delete a user's legacy task database during refresh.

Named Host options include Skills, runtime, and native integration. Generic Agent Skills include the same Skills and CLI without native hooks. Codex, pi, and generic selections share `.agents/skills/`; Claude uses `.claude/skills/`. Deduplicate resources and preserve the shared launcher dependency.

The full package includes `dist/cli.js`, `dist/pi.js`, and the dynamically loaded setup UI with its chunks. The copied project runtime omits the setup UI and works without source files, `node_modules`, or the original package. Test packed resources and paths containing spaces. Keep optional plugin packaging aligned with the package version.

## Verification

Test observable outcomes: retrieval after external edits, revision conflicts, selected-version refresh, withdrawal and deletion, path filtering, legacy-scope exclusion, bounded output, session isolation, stateless use, and actual CLI subprocesses. Removed commands must fail without creating files. Group tests under `test/runtime/`, `test/cli/`, `test/setup/`, and `test/adapters/`; package checks remain in `test/package.test.mjs`.

Use temporary projects and leave contributor Host configuration and trust settings untouched. Native integration tests must describe the actual event API they exercise. Pi must not introduce polling, browser lifecycle management, or a new model-turn trigger.

For Skill trials, use a real engineering question, inspect code and callers, execute appropriate checks, and observe whether later knowledge reads reflect corrections. Valid JSON or successful writes alone are not a useful collaboration sample. Report model-backed Host trials separately from storage and adapter checks, including their limitations.

Record contract and upgrade changes in [CHANGELOG.md](CHANGELOG.md). A passing suite establishes program behavior, not improved design quality or developer understanding.
