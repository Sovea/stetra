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
  status: 'passed' | 'failed' | 'skipped';
  command: string[];
  exitCode: number | null;
  outputDigest: string;
  outputRefs?: {
    stdout: string;
    stderr: string;
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
  attestedBy: string;
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
  feedbackPath?: string;
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
    attestedBy: string;
    explanation: string;
  };
  exception?: ChangeException;
}

export interface ChangeEvaluation {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  decisionId: string;
  status: 'accepted' | 'warning' | 'exception-required' | 'rejected';
  operation: 'none' | 'create' | 'modify' | 'delete' | 'mixed';
  changes: ChangeSet;
  results: GuidanceEvaluation[];
  checks: CheckResult[];
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
    warningCount: number;
  };
  feedback?: {
    recorded: number;
    path: string;
    aggregatePath: string;
    aggregateCount: number;
    eventsFingerprint: string | null;
  };
}
