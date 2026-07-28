# @sovea/resonant-code-core

Programmatic hard kernel for the resonant-code AI coding change harness.

The root export intentionally exposes only:

```ts
import {
  compileChange,
  evaluateChange,
} from '@sovea/resonant-code-core';
```

RCCL calibration and evidence lifecycle operations are available from the
explicit subpath:

```ts
import {
  approveContext,
  commitCalibration,
  prepareCalibration,
  validateContext,
} from '@sovea/resonant-code-core/rccl';
```

Normal host-agent usage should use the `@sovea/resonant-code` CLI.

`compileChange` returns compact execution guidance together with an inspectable
activation trace, Runtime-owned verification plan, and an attention-only
attestation plan. `evaluateChange` keeps unverified optional `consider`
guidance informational while preserving hard required/avoid violations,
strict-mode evidence gates, and actual diff/check ownership.
