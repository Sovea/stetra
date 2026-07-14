//#region src/types.d.ts
declare const RCCL_SCHEMA_VERSION: "1.0";
declare const RCCL_CATEGORIES: readonly ["architecture", "constraint", "compatibility", "legacy", "anti-pattern", "migration", "convention"];
declare const DECISION_DIMENSIONS: readonly ["compatibility", "api-shape", "architecture-boundary", "data-flow", "migration", "testing", "error-handling", "module-format", "review-focus"];
type RcclCategory = typeof RCCL_CATEGORIES[number];
type DecisionDimension = typeof DECISION_DIMENSIONS[number];
type SemanticConfidence = 'low' | 'medium' | 'high';
type ReviewStatus = 'generated' | 'reviewed';
type EvidenceStatus = 'current' | 'partial' | 'stale' | 'broken';
type LifecycleStatus = 'active' | 'stale' | 'superseded';
interface RcclEvidence {
  file: string;
  lineRange: [number, number];
  snippet: string;
}
interface EvidenceVerification {
  status: EvidenceStatus;
  verifiedCount: number;
  totalCount: number;
  checkedAt: string;
}
interface ObservationLifecycle {
  status: LifecycleStatus;
  contentFingerprint: string;
  firstSeenGitRef: string | null;
  lastSeenGitRef: string | null;
  lastVerifiedAt: string;
  supersededBy?: string;
}
interface RcclObservation {
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
interface RcclDocument {
  version: typeof RCCL_SCHEMA_VERSION;
  generatedAt: string;
  gitRef: string | null;
  observations: RcclObservation[];
}
interface RcclObservationProposal {
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
interface CalibrationContract {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  selectedPaths: string[];
  prompt: string;
  proposalSchema: string;
}
interface CalibrationProposal {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  observations: RcclObservationProposal[];
  replace?: boolean;
}
interface PrepareCalibrationInput {
  projectRoot: string;
  paths?: string[];
  scope?: string;
  maxFiles?: number;
}
interface PrepareCalibrationOutput {
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
interface CommitCalibrationInput extends PrepareCalibrationInput {
  proposal: CalibrationProposal | string;
  rcclPath?: string;
}
interface CalibrationDiagnostic {
  path: string;
  code: string;
  message: string;
}
interface CommitCalibrationOutput {
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
interface ValidateContextInput {
  projectRoot: string;
  rcclPath?: string;
  write?: boolean;
}
interface ValidateContextOutput {
  status: 'valid' | 'invalid' | 'missing';
  document?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
  changedObservationIds: string[];
}
//#endregion
export { CommitCalibrationOutput as a, PrepareCalibrationInput as c, RcclEvidence as d, RcclObservation as f, ValidateContextOutput as h, CommitCalibrationInput as i, PrepareCalibrationOutput as l, ValidateContextInput as m, CalibrationDiagnostic as n, DecisionDimension as o, RcclObservationProposal as p, CalibrationProposal as r, EvidenceStatus as s, CalibrationContract as t, RcclDocument as u };