export const RCCL_SCHEMA_VERSION = '1.0' as const;

export const RCCL_CATEGORIES = [
  'architecture',
  'constraint',
  'compatibility',
  'legacy',
  'anti-pattern',
  'migration',
  'convention',
] as const;

export const DECISION_DIMENSIONS = [
  'compatibility',
  'api-shape',
  'architecture-boundary',
  'data-flow',
  'migration',
  'testing',
  'error-handling',
  'module-format',
  'review-focus',
] as const;

export type RcclCategory = typeof RCCL_CATEGORIES[number];
export type DecisionDimension = typeof DECISION_DIMENSIONS[number];
export type SemanticConfidence = 'low' | 'medium' | 'high';
export type ReviewStatus = 'generated' | 'reviewed';
export type EvidenceStatus = 'current' | 'partial' | 'stale' | 'broken';
export type LifecycleStatus = 'active' | 'stale' | 'superseded';

export interface RcclEvidence {
  file: string;
  lineRange: [number, number];
  snippet: string;
}

export interface EvidenceVerification {
  status: EvidenceStatus;
  verifiedCount: number;
  totalCount: number;
  checkedAt: string;
}

export interface ObservationLifecycle {
  status: LifecycleStatus;
  contentFingerprint: string;
  firstSeenGitRef: string | null;
  lastSeenGitRef: string | null;
  lastVerifiedAt: string;
  supersededBy?: string;
}

export interface RcclObservation {
  id: string;
  category: RcclCategory;
  scope: string;
  statement: string;
  affects: DecisionDimension[];
  decisionImpact: string;
  semanticConfidence: SemanticConfidence;
  reviewStatus: ReviewStatus;
  evidence: RcclEvidence[];
  evidenceVerification: EvidenceVerification;
  lifecycle: ObservationLifecycle;
}

export interface RcclDocument {
  version: typeof RCCL_SCHEMA_VERSION;
  generatedAt: string;
  gitRef: string | null;
  observations: RcclObservation[];
}

export interface RcclObservationProposal {
  id: string;
  category: RcclCategory;
  scope: string;
  statement: string;
  affects: DecisionDimension[];
  decisionImpact: string;
  semanticConfidence: SemanticConfidence;
  reviewStatus?: ReviewStatus;
  evidence: RcclEvidence[];
}

export interface CalibrationContract {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  selectedPaths: string[];
  prompt: string;
  proposalSchema: string;
}

export interface CalibrationProposal {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  observations: RcclObservationProposal[];
  replace?: boolean;
}

export interface PrepareCalibrationInput {
  projectRoot: string;
  paths?: string[];
  scope?: string;
  maxFiles?: number;
}

export interface PrepareCalibrationOutput {
  status: 'ready';
  contract: CalibrationContract;
  context: {
    files: number;
    windows: Array<{
      file: string;
      lineRange: [number, number];
      purpose: string;
      snippet: string;
    }>;
  };
}

export interface CommitCalibrationInput extends PrepareCalibrationInput {
  proposal: CalibrationProposal | string;
  rcclPath?: string;
}

export interface CalibrationDiagnostic {
  path: string;
  code: string;
  message: string;
}

export interface CommitCalibrationOutput {
  status: 'committed' | 'rejected';
  written?: string;
  document?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
  summary: {
    proposed: number;
    accepted: number;
    rejected: number;
    current: number;
    partial: number;
    stale: number;
    broken: number;
  };
}

export interface ValidateContextInput {
  projectRoot: string;
  rcclPath?: string;
  write?: boolean;
}

export interface ValidateContextOutput {
  status: 'valid' | 'invalid' | 'missing';
  document?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
  changedObservationIds: string[];
}
