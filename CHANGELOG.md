# Changelog

## Unreleased

- Introduces the initial `cognitive-adoption` schema with exact Human events,
  falsifiable Evidence Obligations, immutable verification definitions, and
  separate semantic, verification, and effective identities.
- Adds a task-scoped append-only ledger, crash-recoverable publication and fact
  collection, selective task-start baselines, ordered check attempts, bounded
  logs, and exact baseline/current relations.
- Requires fact-bound diagnosis before acting on non-passing evidence and
  provides executable repair, verification-revision, challenge, Human
  resolution, handoff, correction, and adoption paths.
- Constrains Condition conclusions by Obligation results, preserves adverse and
  unverified evidence, and triggers review when declared verifier surfaces
  change without inferring meaning from repository heuristics.
- Projects task-specific Authoring Packets, exact stdin commands, compact
  decision views, and honest Host capability provenance without persisting a
  second workflow layer.
- Defines paired-evaluation preflight, coverage, negative-control, timing, and
  black-box usability gates. The retained historical pilot remains
  inconclusive and product effectiveness remains `unverified`.

## 0.0.1

- Renames the product to Stetra, the CLI package to `@sovea/stetra`, the Core
  package to `@sovea/stetra-core`, and the executable to `stetra`.
- Moves task state and generated Host adapters to the `.stetra/`,
  `.agents/skills/stetra/`, and `.claude/skills/stetra/` namespaces without
  adding aliases or automatic migration for the previous product identity.
- Preserves the `semantic-delegation` protocol, three-core architecture,
  lifecycle, authority model, and schema versions; this is a product-identity
  cutover rather than a protocol redesign.
- Moves release metadata and Trusted Publisher configuration to
  `Sovea/stetra`, `@sovea/stetra-core`, and `@sovea/stetra`.

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
