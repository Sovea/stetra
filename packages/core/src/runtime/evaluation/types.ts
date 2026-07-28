import type { ChangeDecisionPacket } from '../decision/types.ts';

export const EVALUATION_SCHEMA_VERSION = '1.0' as const;

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface MachineFactProvenance {
  source: 'resonant-code-workflow';
  collectionId: string;
}

export interface FileFact {
  kind: 'file' | 'symlink';
  contentHash: string;
  mode: string;
}

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  previousPath?: string;
  before?: FileFact;
  after?: FileFact;
}

export interface ChangeSet {
  files: ChangedFile[];
  baselineFingerprint: string;
  currentFingerprint: string;
  changeFingerprint: string;
  baselineHead: string | null;
  currentHead: string | null;
  provenance: MachineFactProvenance;
}

export interface CheckResult {
  id: string;
  status: 'passed' | 'failed' | 'unavailable';
  command: string[];
  exitCode: number | null;
  outputDigest: string;
  outputRefs?: {
    stdout?: string;
    stderr?: string;
  };
  outputTruncated?: {
    stdout: boolean;
    stderr: boolean;
  };
  definitionFingerprint?: string;
  reason?: string;
  provenance: MachineFactProvenance;
}

export type EvaluationEvidenceKind = 'diff' | 'file' | 'check' | 'semantic';

export interface EvaluationEvidenceRef {
  kind: EvaluationEvidenceKind;
  ref: string;
  file?: string;
  checkId?: string;
  description?: string;
}

export interface GuidanceAttestation {
  guidanceId: string;
  verdict: 'satisfied' | 'violated' | 'partial' | 'unverified';
  evidenceRefs: EvaluationEvidenceRef[];
  explanation: string;
}

export interface ChangeException {
  guidanceId: string;
  reason: string;
  status?: 'requested' | 'approved';
  approvedBy?: string;
}

export interface EvaluateChangeInput {
  decision: ChangeDecisionPacket;
  changes: ChangeSet;
  checks?: CheckResult[];
  attestations?: GuidanceAttestation[];
  exceptions?: ChangeException[];
}

export type EvaluationVerdict = 'satisfied' | 'violated' | 'partial' | 'unverified' | 'excepted';

export interface GuidanceEvaluation {
  guidanceId: string;
  section: 'required' | 'consider' | 'avoid' | 'tension';
  verdict: EvaluationVerdict;
  reasons: string[];
  acceptedEvidence: EvaluationEvidenceRef[];
  rejectedEvidence: Array<{ ref: EvaluationEvidenceRef; reason: string }>;
  attestation?: {
    explanation: string;
  };
  exception?: ChangeException;
}

export interface EvaluationActionRequired {
  kind:
    | 'check-failure'
    | 'check-unavailable'
    | 'guidance-violation'
    | 'guidance-evidence'
    | 'exception-approval';
  id: string;
  message: string;
}

export interface EvaluationInformation {
  kind: 'optional-guidance';
  id: string;
  message: string;
}

export interface ChangeEvaluation {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  decisionId: string;
  status: 'accepted' | 'needs-attention' | 'exception-required' | 'rejected';
  operation: 'none' | 'create' | 'modify' | 'delete' | 'mixed';
  changes: ChangeSet;
  results: GuidanceEvaluation[];
  checks: CheckResult[];
  actionRequired: EvaluationActionRequired[];
  informational: EvaluationInformation[];
  assurance: {
    machineFacts: {
      changeSet: true;
      changedFileCount: number;
      collectedCheckCount: number;
    };
    hostAttestationCount: number;
  };
  summary: {
    requiredSatisfied: number;
    requiredViolated: number;
    requiredUnverified: number;
    attentionCount: number;
    informationalCount: number;
  };
}
