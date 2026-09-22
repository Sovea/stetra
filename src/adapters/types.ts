import type { InstallArtifact } from '../setup/artifacts.js';

export interface HostAdapter {
  readonly id: string;
  readonly label: string;
  readonly skillDirectory: string;
  readonly runtimeFiles?: readonly string[];
  readonly setupHints?: readonly string[];
  artifacts?(): readonly InstallArtifact[];
}
