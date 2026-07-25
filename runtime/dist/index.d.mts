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
  description: string;
  commandId?: string;
}
interface GuidanceSource {
  kind: 'builtin-playbook' | 'local-playbook' | 'rccl' | 'task';
  id: string;
  path?: string;
  evidenceRefs?: string[];
}
interface GuidanceItem {
  id: string;
  instruction: string;
  rationale: string;
  exceptions: string[];
  source: GuidanceSource;
  relevance: string;
  executionMode: ExecutionMode;
  verification: VerificationRequirement[];
  examples: DirectiveExample[];
}
interface AvoidGuidanceItem {
  id: string;
  pattern: string;
  rationale: string;
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
  evidenceRefs: string[];
  proposedBy: 'host-agent' | 'runtime-structural' | 'feedback' | 'multi-source';
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
  code: 'GUIDANCE_BUDGET_TRIMMED' | 'RELATION_PROPOSAL_REJECTED' | 'RELATION_PROPOSAL_DOWNGRADED' | 'RCCL_NOT_LOADED' | 'RCCL_NO_DECISION_IMPACT';
  message: string;
  ids?: string[];
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
  omissions: Array<{
    id: string;
    section: 'required' | 'consider' | 'avoid' | 'tensions';
    reason: 'section-limit' | 'character-limit' | 'suppressed';
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
  };
}
type CompileChangeOutput = ChangeDecisionPacket | InterpretationRequest;
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
export { type ChangeDecisionPacket, type ChangeEvaluation, type ChangeException, type ChangeSet, type ChangedFile, type CheckResult, type CompileChangeInput, type CompileChangeOutput, type DecisionDiagnostic, type DecisionTension, type EffectiveGuidance, type EvaluateChangeInput, type EvaluationEvidenceRef, type GuidanceEvaluation, type GuidanceEvidence, type GuidanceItem, type GuidanceMode, type InterpretationRequest, type NormalizedTaskContext, type RelationProposal, type ScopeLevel, type TaskContextInput, type RiskLevel as TaskRiskLevel, type VerificationPlan, type VerificationRequirement, compileChange, evaluateChange };