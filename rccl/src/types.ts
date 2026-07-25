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

export interface CalibrationEvidenceSelection {
  file: string;
  lineRange: [number, number];
}

export interface CalibrationEvidenceWindow extends CalibrationEvidenceSelection {
  windowId: string;
  snippet: string;
}

export interface RcclEvidence {
  file: string;
  lineRange: [number, number];
  snippet: string;
}

export interface RcclEvidenceProposal {
  windowId: string;
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

export interface ObservationApproval {
  approvedBy: string;
  approvedAt: string;
  contentFingerprint: string;
}

export interface RcclObservationContent {
  id: string;
  category: RcclCategory;
  scope: string;
  statement: string;
  affects: DecisionDimension[];
  decisionImpact: string;
  semanticConfidence: SemanticConfidence;
  evidence: RcclEvidence[];
}

export interface RcclObservation extends RcclObservationContent {
  reviewStatus: ReviewStatus;
  approval?: ObservationApproval;
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
  evidence: RcclEvidenceProposal[];
}

export interface CalibrationContract {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  evidenceWindows: CalibrationEvidenceWindow[];
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
  evidenceSelections: CalibrationEvidenceSelection[];
}

export interface PrepareCalibrationReady {
  status: 'ready';
  contract: CalibrationContract;
  context: {
    files: number;
    windows: CalibrationEvidenceWindow[];
  };
  diagnostics: [];
}

export interface PrepareCalibrationRejected {
  status: 'rejected';
  diagnostics: CalibrationDiagnostic[];
}

export type PrepareCalibrationOutput = PrepareCalibrationReady | PrepareCalibrationRejected;

export interface CommitCalibrationInput {
  projectRoot: string;
  contract: CalibrationContract;
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

export interface ApproveContextInput {
  projectRoot: string;
  observationIds: string[];
  approvedBy: string;
  rcclPath?: string;
}

export interface ApproveContextOutput {
  status: 'approved' | 'rejected';
  written?: string;
  document?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
  approvedObservationIds: string[];
  unchangedObservationIds: string[];
}
