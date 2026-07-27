# Contributing

Use Node.js 22 and pnpm 10.33.0. Install with `pnpm install --frozen-lockfile`, then run `pnpm verify` before submitting a change.

Core owns Playbook/RCCL schemas, validation, adjudication, diagnostics, and
authoritative policy decisions. CLI owns workflow IO, project-adapter
generation, lifecycle sequencing, and machine-fact collection. Generated Host
Adapters must remain thin and must not recreate governance policy.

Core and CLI versions move together. Every `dist/` is generated, ignored by
Git, and must remain deterministic across repeated builds. Release changes
must pass both the isolated Core tarball smoke and the paired Core/CLI tarball
installation smoke.
