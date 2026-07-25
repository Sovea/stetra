//#region src/types.d.ts
type ExecutionMode = 'enforce' | 'deviation-noted' | 'ambient' | 'suppress';
interface DirectiveExampleSide {
  code: string;
}
interface DirectiveExample {
  avoid?: DirectiveExampleSide;
  good?: DirectiveExampleSide;
  note: string;
}
//#endregion
//#region src/task/types.d.ts
declare const CHANGE_TYPES: readonly ["bugfix", "feature", "refactor", "migration", "maintenance", "docs", "test", "unknown"];
declare const RISK_LEVELS: readonly ["low", "medium", "high"];
declare const SCOPE_LEVELS: readonly ["local", "module", "cross-module", "repository"];
type ChangeType = typeof CHANGE_TYPES[number];
type RiskLevel = typeof RISK_LEVELS[number];
type ScopeLevel = typeof SCOPE_LEVELS[number];
type GuidanceMode = 'standard' | 'strict';
type TaskFieldSource = 'explicit' | 'deterministic' | 'host-provided' | 'defaulted';
interface TaskContextInput {
  description: string;
  changeType?: ChangeType;
  targets?: string[];
  techStack?: string[];
  risk?: RiskLevel;
  scope?: ScopeLevel;
  constraints?: string[];
  avoid?: string[];
  uncertainties?: string[];
  interpretationSource?: 'explicit' | 'host-provided';
}
interface TaskFieldProvenance {
  field: 'changeType' | 'targets' | 'techStack' | 'risk' | 'scope';
  source: TaskFieldSource;
  confidence: number;
}
interface NormalizedTaskContext {
  description: string;
  changeType: ChangeType;
  targets: string[];
  techStack: string[];
  risk: RiskLevel;
  scope: ScopeLevel;
  constraints: string[];
  avoid: string[];
  uncertainties: string[];
  provenance: TaskFieldProvenance[];
}
//#endregion
//#region src/decision/types.d.ts
declare const DECISION_SCHEMA_VERSION: "1.0";
type RelationProposalKind = 'supports' | 'conflicts' | 'limits';
interface RelationProposal {
  directiveId: string;
  observationId: string;
  relation: RelationProposalKind;
  rationale: string;
  evidenceRefs: string[];
  confidence?: number;
}
interface CompileChangeInput {
  projectRoot: string;
  builtinRoot: string;
  localAugmentPath?: string;
  rcclPath?: string;
  task: TaskContextInput;
  mode?: GuidanceMode;
  relationProposals?: RelationProposal[];
  guidanceByteLimit?: number;
  deliverySelection?: GuidanceDeliverySelection;
}
interface GuidanceDeliverySelection {
  considerIds: string[];
  rationale: string;
}
interface InterpretationRequest {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  status: 'needs-interpretation';
  task: NormalizedTaskContext;
  reasons: string[];
  requiredFields: Array<'changeType' | 'targets' | 'uncertainties'>;
}
type VerificationKind = 'static' | 'command' | 'diff' | 'semantic';
interface VerificationRequirement {
  kind: VerificationKind;
  description?: string;
  commandId?: string;
}
interface GuidanceSource {
  kind: 'builtin-playbook' | 'local-playbook' | 'rccl' | 'task';
  id: string;
}
interface GuidanceItem {
  id: string;
  instruction: string;
  exceptions: string[];
  source: GuidanceSource;
  executionMode: ExecutionMode;
  verification: VerificationRequirement[];
  example?: DirectiveExample;
}
interface AvoidGuidanceItem {
  id: string;
  pattern: string;
  exceptions: string[];
  source: GuidanceSource;
  verification: VerificationRequirement[];
}
interface DecisionTension {
  id: string;
  directiveId: string;
  observationId: string;
  conflict: string;
  resolution: string;
}
interface EffectiveGuidance {
  required: GuidanceItem[];
  consider: GuidanceItem[];
  avoid: AvoidGuidanceItem[];
  tensions: DecisionTension[];
}
interface VerificationPlan {
  commands: Array<{
    id: string;
    reason: string;
  }>;
  semanticChecks: Array<{
    guidanceId: string;
    description: string;
  }>;
}
interface DecisionDiagnostic {
  code: 'GUIDANCE_SELECTION_APPLIED' | 'RELATION_PROPOSAL_REJECTED' | 'RELATION_PROPOSAL_DOWNGRADED' | 'RCCL_NOT_LOADED' | 'RCCL_NO_DECISION_IMPACT';
  message: string;
  ids?: string[];
}
interface GuidanceDetail {
  id: string;
  section: 'required' | 'consider' | 'avoid' | 'tension';
  rationale: string;
  relevance: string;
  source: {
    kind: GuidanceSource['kind'];
    id: string;
    logicalPath?: string;
    evidenceRefs?: string[];
  };
  examples: DirectiveExample[];
}
interface DecisionTrace {
  selectedLayers: string[];
  activatedDirectiveIds: string[];
  deliveredGuidanceIds: string[];
  suppressedDirectiveIds: string[];
  relevantObservationIds: string[];
  observationEvidence: Array<{
    observationId: string;
    status: string;
    disposition: string;
    verifiedCount: number;
    totalCount: number;
    action: 'reverified' | 'reused';
  }>;
  relationDecisions: Array<{
    directiveId: string;
    observationId: string;
    relation: string;
    status: 'accepted' | 'rejected' | 'downgraded';
    impact: string;
    reason: string;
    rationale: string;
    evidenceRefs: string[];
    confidence: number | null;
    proposedBy: string;
  }>;
  guidanceDetails: GuidanceDetail[];
  delivery: {
    byteLimit: number;
    deliveredBytes: number;
    mandatoryBytes: number;
    selection: GuidanceDeliverySelection | null;
  };
  omissions: Array<{
    id: string;
    section: 'required' | 'consider' | 'avoid' | 'tensions';
    reason: 'host-selection' | 'suppressed';
  }>;
  diagnostics: DecisionDiagnostic[];
}
interface ChangeDecisionPacket {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  decisionId: string;
  status: 'compiled' | 'needs-attention';
  mode: GuidanceMode;
  task: NormalizedTaskContext;
  guidance: EffectiveGuidance;
  verificationPlan: VerificationPlan;
  trace: DecisionTrace;
  fingerprints: {
    task: string;
    directives: string;
    observations: string;
    relations: string;
    delivery: string;
  };
}
interface GuidanceOverflow {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  status: 'guidance-overflow';
  mode: GuidanceMode;
  task: NormalizedTaskContext;
  byteLimit: number;
  totalBytes: number;
  mandatoryBytes: number;
  mandatoryGuidanceIds: string[];
  mandatoryGuidance: {
    required: GuidanceItem[];
    avoid: AvoidGuidanceItem[];
    tensions: DecisionTension[];
  };
  selectableConsider: Array<{
    id: string;
    instruction: string;
    bytes: number;
    source: GuidanceSource;
  }>;
  candidateDetails: GuidanceDetail[];
  diagnostics: DecisionDiagnostic[];
  selection: GuidanceDeliverySelection | null;
  reasons: string[];
}
type CompileChangeOutput = ChangeDecisionPacket | InterpretationRequest | GuidanceOverflow;
//#endregion
//#region src/decision/compile-change.d.ts
declare function compileChange(input: CompileChangeInput): Promise<CompileChangeOutput>;
//#endregion
//#region src/evaluation/types.d.ts
declare const EVALUATION_SCHEMA_VERSION: "1.0";
type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  previousPath?: string;
}
interface ChangeSet {
  files: ChangedFile[];
  patch?: string;
}
interface CheckResult {
  id: string;
  status: 'passed' | 'failed' | 'skipped';
  command?: string;
  outputRef?: string;
}
type EvaluationEvidenceKind = 'diff' | 'file' | 'check' | 'semantic' | 'static';
interface EvaluationEvidenceRef {
  kind: EvaluationEvidenceKind;
  ref: string;
  file?: string;
  checkId?: string;
  description?: string;
}
interface GuidanceEvidence {
  guidanceId: string;
  verdict: 'satisfied' | 'violated' | 'partial' | 'unverified';
  evidenceRefs: EvaluationEvidenceRef[];
  explanation?: string;
}
interface ChangeException {
  guidanceId: string;
  reason: string;
  status?: 'requested' | 'approved';
  approvedBy?: string;
}
interface EvaluateChangeInput {
  decision: ChangeDecisionPacket;
  changes: ChangeSet;
  checks?: CheckResult[];
  evidence?: GuidanceEvidence[];
  exceptions?: ChangeException[];
  feedbackPath?: string;
}
type EvaluationVerdict = 'satisfied' | 'violated' | 'partial' | 'unverified' | 'excepted';
interface GuidanceEvaluation {
  guidanceId: string;
  section: 'required' | 'consider' | 'avoid' | 'tension';
  verdict: EvaluationVerdict;
  reasons: string[];
  acceptedEvidence: EvaluationEvidenceRef[];
  rejectedEvidence: Array<{
    ref: EvaluationEvidenceRef;
    reason: string;
  }>;
  exception?: ChangeException;
}
interface ChangeEvaluation {
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
//#endregion
//#region src/evaluation/evaluate-change.d.ts
declare function evaluateChange(input: EvaluateChangeInput): ChangeEvaluation;
//#endregion
export { type ChangeDecisionPacket, type ChangeEvaluation, type ChangeException, type ChangeSet, type ChangedFile, type CheckResult, type CompileChangeInput, type CompileChangeOutput, type DecisionDiagnostic, type DecisionTension, type EffectiveGuidance, type EvaluateChangeInput, type EvaluationEvidenceRef, type GuidanceDeliverySelection, type GuidanceDetail, type GuidanceEvaluation, type GuidanceEvidence, type GuidanceItem, type GuidanceMode, type GuidanceOverflow, type InterpretationRequest, type NormalizedTaskContext, type RelationProposal, type ScopeLevel, type TaskContextInput, type RiskLevel as TaskRiskLevel, type VerificationPlan, type VerificationRequirement, compileChange, evaluateChange };