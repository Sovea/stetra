# Contributing

Use Node.js 22 and pnpm 10.33.0. Install with `pnpm install --frozen-lockfile`, then run `pnpm verify` before submitting a change.

Runtime and RCCL own schemas, validation, adjudication, diagnostics, and authoritative writes. Skills must remain thin lifecycle adapters and must not recreate governance policy.

Changes to generated `runtime/dist` or `rccl/dist` must be produced by `pnpm build` and remain deterministic across repeated builds.
