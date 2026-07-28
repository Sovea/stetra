# Changelog

## 0.0.1

- Adds the separately publishable, version-locked
  `@sovea/resonant-code-core` SDK and `@sovea/resonant-code` CLI.
- Exposes a single `resonant-code` binary, with no legacy command alias.
- Keeps Playbook, RCCL, and Runtime as explicit Core source modules while the
  Core root exposes only `compileChange` and `evaluateChange`; RCCL lifecycle
  operations use the `/rccl` subpath.
- Adds safe project initialization with a generated-artifact manifest,
  Codex/Claude thin adapters, managed blocks, drift detection, dry-run, and
  explicitly scoped force replacement; initialization is the sole owner of
  generated `.gitignore` content.
- Keeps Playbook bootstrap semantic: the host selects inspected repository
  evidence while the CLI validates exact paths instead of maintaining a
  framework filename heuristic.
- Moves prepare/complete orchestration behind the CLI control plane, records
  CLI/Core package identity in task runs, and removes repository-native plugin
  distribution and compatibility entrypoints.
- Stops tracking all generated `dist/` files and verifies deterministic rebuilds.
- Verifies the real Core and CLI npm tarballs through isolated API and
  binary-driven bootstrap, RCCL, status, and complete-change flows.
- Provides the current two-operation change harness: `compileChange` and `evaluateChange`.
- Makes ordinary coding tasks a compact preflight and evidence-backed postflight; Host-owned semantics expose only material unresolved alignment.
- Defines decision-relevant RCCL observations with separate evidence currency, semantic confidence, and human review signals.
- Bounds guidance with one configurable UTF-8 byte ceiling, requires an
  explicit host selection when optional items overflow, never silently removes
  mandatory guidance, and evaluates only delivered IDs.
- Layers a user-scoped personal preference/example overlay beneath the
  repository-committed team Playbook, with structural guards against weakening
  shared policy.
- Captures an exact Git worktree baseline at prepare, derives actual task
  add/modify/delete/unique-rename facts at complete, runs explicit check
  commands, and separates those machine facts from host semantic attestations.
- Isolates runtime state under `.resonant-code/runs/<runId>/`, creates no run
  until task verification is executable, bounds persisted check streams, and
  avoids a repository-global feedback ledger without a demonstrated
  initial-release consumer.
- Keeps task understanding and semantic relations as bounded host inputs rather than mandatory multi-stage artifacts.
