import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type FileKind = 'file' | 'symlink' | 'gitlink';
export type FileOperation = 'added' | 'modified' | 'deleted' | 'renamed';
export type ChangeRepresentation = 'text' | 'binary' | 'metadata-only' | 'unrepresentable';
export type CheckStatus = 'passed' | 'failed' | 'unavailable';
export type CheckBaselineRelation =
  | 'baseline-unknown'
  | 'baseline-unknown-after-revision'
  | 'passed-before-passed-now'
  | 'passed-before-failed-now'
  | 'passed-before-unavailable-now'
  | 'failed-before-passed-now'
  | 'failed-before-failed-now'
  | 'failed-before-unavailable-now'
  | 'unavailable-before-passed-now'
  | 'unavailable-before-failed-now'
  | 'unavailable-before-unavailable-now';

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

export type CheckTermination =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'signal'; signal: string }
  | { kind: 'timeout'; signal?: string }
  | { kind: 'spawn-error'; code?: string };

export interface CheckAttemptFact {
  attempt: number;
  startedAt: string;
  durationMs: number;
  timeoutMs: number;
  status: CheckStatus;
  termination: CheckTermination;
  outcomeFingerprint: string;
  stdout: CheckStreamFact;
  stderr: CheckStreamFact;
  reason?: string;
}

export interface CheckFact {
  verifierId: string;
  definitionId: string;
  argv: string[];
  definitionFingerprint: string;
  attempts: CheckAttemptFact[];
}

export interface BaselineCheckFact {
  definitionId: string;
  mode: 'task-start' | 'unknown' | 'unknown-after-revision' | 'isolated-original';
  observation: CheckFact | null;
}

export interface BaselineVerificationFact {
  fingerprint: string;
  capturedAt: string;
  preCheck: WorktreeSummary;
  postCheck: WorktreeSummary;
  checkInducedChanges: ChangedFileFact[];
  checks: BaselineCheckFact[];
}

export interface CheckComparisonFact {
  definitionId: string;
  relation: CheckBaselineRelation;
}

export type EvidenceCause = 'implementation' | 'environment' | 'verification' | 'unknown';

export interface EvidenceDispositionEntry {
  definitionId: string;
  cause: EvidenceCause;
  diagnosis: string;
  falsificationAttempt: string;
  codeChangeCanAlterObservation: boolean;
  expectedDifferentObservation: string;
  intendedChanges: string[];
}

export interface EvidenceDisposition extends ProtocolEnvelope {
  dispositionId: string;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  semanticImpact: 'none' | 'material';
  proposedRoute:
    | 'repair-implementation'
    | 'revise-verification'
    | 'challenge'
    | 'handoff'
    | 'ask-human';
  routeRationale: string;
  entries: EvidenceDispositionEntry[];
  route:
    | 'repair-implementation'
    | 'revise-verification'
    | 'challenge'
    | 'handoff'
    | 'ask-human';
}

export interface VerifierMutation {
  verifierId: string;
  definitionId: string;
  path: string;
  role: 'command-definition' | 'acceptance-surface';
  changedFileId: string;
}

export interface PatchFact {
  path: string;
  digest: string;
  byteLength: number;
}

export interface ExecutableEnvironmentFact {
  command: string;
  resolvedPath: string | null;
  version: string | null;
}

export interface ToolchainEnvironmentFact {
  name: string;
  version: string;
}

export interface LockfileEnvironmentFact {
  path: string;
  digest: string;
}

export interface ExecutionEnvironment {
  platform: string;
  architecture: string;
  cwdFingerprint: string;
  executables: ExecutableEnvironmentFact[];
  toolchains: ToolchainEnvironmentFact[];
  lockfiles: LockfileEnvironmentFact[];
  environmentVariableNames: string[];
}

export interface FactBundle extends ProtocolEnvelope {
  factCollectionId: string;
  bundleFingerprint: string;
  effectiveContractId: string;
  attemptId: string;
  collectedAt: string;
  baseline: WorktreeSummary;
  preCheck: WorktreeSummary;
  current: WorktreeSummary;
  baselineVerification: BaselineVerificationFact;
  changeFingerprint: string;
  changedFiles: ChangedFileFact[];
  checkInducedChanges: ChangedFileFact[];
  checks: CheckFact[];
  checkComparisons: CheckComparisonFact[];
  verifierMutations: VerifierMutation[];
  environment: ExecutionEnvironment;
  patch?: PatchFact;
  provenance: {
    collector: 'stetra-cli';
    cliVersion: string;
    coreVersion: string;
  };
}
