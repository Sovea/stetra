import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type FileKind = 'file' | 'symlink' | 'gitlink';
export type FileOperation = 'added' | 'modified' | 'deleted' | 'renamed';
export type ChangeRepresentation = 'text' | 'binary' | 'metadata-only' | 'unrepresentable';
export type CheckStatus = 'passed' | 'failed' | 'unavailable';

export interface WorktreeSummary {
  head: string | null;
  fingerprint: string;
  entryCount: number;
  capturedAt: string;
}

export interface FileContentFact {
  kind: FileKind;
  contentDigest: string;
  mode: string;
}

export interface ChangedFileFact {
  id: string;
  path: string;
  operation: FileOperation;
  previousPath?: string;
  before?: FileContentFact;
  after?: FileContentFact;
  representation: ChangeRepresentation;
  patchDigest?: string;
}

export interface CheckStreamFact {
  digest: string;
  byteLength: number;
  persistedBytes: number;
  truncated: boolean;
  logPath?: string;
}

export interface CheckFact {
  id: string;
  status: CheckStatus;
  argv: string[];
  exitCode: number | null;
  definitionFingerprint: string;
  outputDigest: string;
  stdout: CheckStreamFact;
  stderr: CheckStreamFact;
  reason?: string;
}

export interface VerifierMutation {
  checkId: string;
  path: string;
  role: 'command-definition' | 'acceptance-surface';
  changedFileId: string;
}

export interface PatchFact {
  path: string;
  digest: string;
  byteLength: number;
}

export interface FactBundle extends ProtocolEnvelope {
  factCollectionId: string;
  bundleFingerprint: string;
  contractId: string;
  collectedAt: string;
  baseline: WorktreeSummary;
  current: WorktreeSummary;
  changeFingerprint: string;
  changedFiles: ChangedFileFact[];
  checks: CheckFact[];
  verifierMutations: VerifierMutation[];
  patch?: PatchFact;
  provenance: {
    collector: 'resonant-code-cli';
    cliVersion: string;
    coreVersion: string;
  };
}
