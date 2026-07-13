# Changelog

## 0.0.1

- Introduces Runtime, RCCL, and host artifact schema v1.
- Establishes the `init → calibrate-repo-context → code → feedback` lifecycle.
- Narrows Runtime and RCCL public APIs to their lifecycle entrypoints.
- Adds deterministic playbook validation, RCCL verification, EGO budgets, and atomic feedback writes.
- This release is intentionally incompatible with older `.resonant-code` data. Re-run `init` and `calibrate-repo-context`; no automatic migration or deletion is performed.
