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
interface CalibrationEvidenceSelection {
  file: string;
  lineRange: [number, number];
}
interface CalibrationEvidenceWindow extends CalibrationEvidenceSelection {
  windowId: string;
  snippet: string;
}
interface RcclEvidence {
  file: string;
  lineRange: [number, number];
  snippet: string;
}
interface RcclEvidenceProposal {
  windowId: string;
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
interface ObservationApproval {
  approvedBy: string;
  approvedAt: string;
  contentFingerprint: string;
}
interface RcclObservationContent {
  id: string;
  category: RcclCategory;
  scope: string;
  statement: string;
  affects: DecisionDimension[];
  decisionImpact: string;
  semanticConfidence: SemanticConfidence;
  evidence: RcclEvidence[];
}
interface RcclObservation extends RcclObservationContent {
  reviewStatus: ReviewStatus;
  approval?: ObservationApproval;
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
  evidence: RcclEvidenceProposal[];
}
interface CalibrationContract {
  schemaVersion: typeof RCCL_SCHEMA_VERSION;
  requestId: string;
  contextFingerprint: string;
  evidenceWindows: CalibrationEvidenceWindow[];
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
  evidenceSelections: CalibrationEvidenceSelection[];
}
interface PrepareCalibrationReady {
  status: 'ready';
  contract: CalibrationContract;
  context: {
    files: number;
    windows: CalibrationEvidenceWindow[];
  };
  diagnostics: [];
}
interface PrepareCalibrationRejected {
  status: 'rejected';
  diagnostics: CalibrationDiagnostic[];
}
type PrepareCalibrationOutput = PrepareCalibrationReady | PrepareCalibrationRejected;
interface CommitCalibrationInput {
  projectRoot: string;
  contract: CalibrationContract;
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
interface ApproveContextInput {
  projectRoot: string;
  observationIds: string[];
  approvedBy: string;
  rcclPath?: string;
}
interface ApproveContextOutput {
  status: 'approved' | 'rejected';
  written?: string;
  document?: RcclDocument;
  diagnostics: CalibrationDiagnostic[];
  approvedObservationIds: string[];
  unchangedObservationIds: string[];
}
//#endregion
export { RcclObservation as _, CalibrationEvidenceSelection as a, ValidateContextInput as b, CommitCalibrationInput as c, EvidenceStatus as d, PrepareCalibrationInput as f, RcclEvidenceProposal as g, RcclEvidence as h, CalibrationDiagnostic as i, CommitCalibrationOutput as l, RcclDocument as m, ApproveContextOutput as n, CalibrationEvidenceWindow as o, PrepareCalibrationOutput as p, CalibrationContract as r, CalibrationProposal as s, ApproveContextInput as t, DecisionDimension as u, RcclObservationContent as v, ValidateContextOutput as x, RcclObservationProposal as y };