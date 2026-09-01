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

export interface VerificationInputEntryFact {
  path: string;
  kind: 'file' | 'symlink';
  contentDigest: string;
  mode: string;
  byteLength: number;
}

export interface VerificationInputSelectorFact {
  selector: {
    kind: 'file' | 'tree';
    path: string;
  };
  state: 'missing' | 'present';
  entries: VerificationInputEntryFact[];
  fingerprint: string;
}

export interface VerificationInputSnapshot {
  definitionId: string;
  inputs: VerificationInputSelectorFact[];
  fingerprint: string;
}

export type CheckTermination =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'signal'; signal: string }
  | { kind: 'timeout'; signal?: string }
  | { kind: 'spawn-error'; code?: string };

export interface CheckStepAttemptFact {
  stepId: string;
  role: 'preparation' | 'assertion';
  key?: string;
  argv: string[];
  durationMs: number;
  timeoutMs: number;
  status: CheckStatus;
  termination: CheckTermination;
  outcomeFingerprint: string;
  stdout: CheckStreamFact;
  stderr: CheckStreamFact;
  reason?: string;
}

export interface CheckAttemptFact {
  attempt: number;
  durationMs: number;
  timeoutMs: number;
  status: CheckStatus;
  observedPhase: 'preparation' | 'assertion';
  termination: CheckTermination;
  outcomeFingerprint: string;
  stdout: CheckStreamFact;
  stderr: CheckStreamFact;
  steps: CheckStepAttemptFact[];
  executionInputs: {
    beforePreparation: VerificationInputSnapshot;
    readyForAssertion: VerificationInputSnapshot;
    afterAssertion: VerificationInputSnapshot;
  };
  reason?: string;
}

export interface CheckFact {
  verifierId: string;
  definitionId: string;
  assertionArgv: string[];
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
  preCheck: WorktreeSummary;
  postCheck: WorktreeSummary;
  preCheckExecutionInputs: VerificationInputSnapshot[];
  postCheckExecutionInputs: VerificationInputSnapshot[];
  checkInducedChanges: ChangedFileFact[];
  checks: BaselineCheckFact[];
}

export interface CheckComparisonFact {
  definitionId: string;
  relation: CheckBaselineRelation;
}

export type EvidenceCause = 'implementation' | 'environment' | 'verification' | 'unknown';

export type CheckEvidenceConcernObservation =
  | 'current-nonpassing'
  | 'baseline-expectation-mismatch';

export interface EvidenceConcernSource {
  kind: 'check';
  definitionId: string;
  observation: CheckEvidenceConcernObservation;
}

export interface EvidenceDispositionEntry {
  source: EvidenceConcernSource;
  cause: EvidenceCause;
  diagnosis: string;
  falsificationAttempt: string;
  repositoryChangeCanAlterObservation: boolean;
  changeSurface: 'production' | 'verification-surface' | 'none';
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
    | 'repair-delivery'
    | 'revise-verification'
    | 'handoff'
    | 'ask-human';
  routeRationale: string;
  entries: EvidenceDispositionEntry[];
  route:
    | 'repair-delivery'
    | 'revise-verification'
    | 'handoff'
    | 'ask-human';
}

export interface VerifierMutation {
  verifierId: string;
  definitionId: string;
  selector: {
    kind: 'file' | 'tree';
    path: string;
    role: 'command-definition' | 'acceptance-surface';
  };
  changedFileId: string;
  changedPath: string;
  matchedBy: 'current-path' | 'previous-path';
}

export interface PatchFact {
  path: string;
  digest: string;
  byteLength: number;
}

export interface ExecutableEnvironmentFact {
  command: string;
  resolvedPath: string | null;
}

export interface ExecutionEnvironment {
  platform: string;
  architecture: string;
  executables: ExecutableEnvironmentFact[];
}

export interface FactBundle extends ProtocolEnvelope {
  factCollectionId: string;
  effectiveContractId: string;
  attemptId: string;
  baseline: WorktreeSummary;
  preCheck: WorktreeSummary;
  current: WorktreeSummary;
  preCheckExecutionInputs: VerificationInputSnapshot[];
  currentExecutionInputs: VerificationInputSnapshot[];
  baselineVerification: BaselineVerificationFact;
  changeFingerprint: string;
  changedFiles: ChangedFileFact[];
  checkInducedChanges: ChangedFileFact[];
  checks: CheckFact[];
  checkComparisons: CheckComparisonFact[];
  evidenceConcerns: Array<Extract<EvidenceConcernSource, { kind: 'check' }>>;
  verifierMutations: VerifierMutation[];
  environment: ExecutionEnvironment;
  patch?: PatchFact;
  provenance: {
    collector: 'stetra-cli';
    cliVersion: string;
    coreVersion: string;
  };
}
