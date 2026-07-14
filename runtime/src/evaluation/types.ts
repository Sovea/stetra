import type { ChangeDecisionPacket } from '../decision/types.ts';

export const EVALUATION_SCHEMA_VERSION = '1.0' as const;

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  previousPath?: string;
}

export interface ChangeSet {
  files: ChangedFile[];
  patch?: string;
}

export interface CheckResult {
  id: string;
  status: 'passed' | 'failed' | 'skipped';
  command?: string;
  outputRef?: string;
}

export type EvaluationEvidenceKind = 'diff' | 'file' | 'check' | 'semantic' | 'static';

export interface EvaluationEvidenceRef {
  kind: EvaluationEvidenceKind;
  ref: string;
  file?: string;
  checkId?: string;
  description?: string;
}

export interface GuidanceEvidence {
  guidanceId: string;
  verdict: 'satisfied' | 'violated' | 'partial' | 'unverified';
  evidenceRefs: EvaluationEvidenceRef[];
  explanation?: string;
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
  evidence?: GuidanceEvidence[];
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
  exception?: ChangeException;
}

export interface ChangeEvaluation {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  decisionId: string;
  status: 'accepted' | 'warning' | 'exception-required' | 'rejected';
  operation: 'none' | 'create' | 'modify' | 'delete' | 'mixed';
  results: GuidanceEvaluation[];
  checks: CheckResult[];
  summary: {
    requiredSatisfied: number;
    requiredViolated: number;
    requiredUnverified: number;
    warningCount: number;
  };
  feedback?: {
    recorded: number;
    path: string;
  };
}
