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
attestation plan. Its task contract preserves whether each semantic value came
from a human statement or confirmation, Agent inference, repository evidence,
or deterministic normalization. `evaluateChange` keeps unverified optional
`consider` guidance informational while preserving hard required/avoid
violations, actual diff/check ownership, explicit conclusion basis, and
`ready-for-adoption` semantics that leave adoption to the human.
