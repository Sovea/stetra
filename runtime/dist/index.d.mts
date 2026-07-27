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
}
interface CompileChangeInput {
  projectRoot: string;
  builtinRoot: string;
  localAugmentPath?: string;
  personalOverlayPath?: string;
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
type VerificationKind = 'command' | 'diff' | 'semantic';
interface VerificationRequirement {
  kind: VerificationKind;
  description?: string;
  commandId?: string;
}
interface GuidanceSource {
  kind: 'builtin-playbook' | 'local-playbook' | 'personal-playbook' | 'rccl' | 'task';
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
  exampleSource?: GuidanceSource;
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
interface ExecutionGuidanceItem {
  id: string;
  instruction: string;
  exceptions: string[];
  executionMode: ExecutionMode;
  example?: DirectiveExample;
}
interface ExecutionAvoidGuidanceItem {
  id: string;
  pattern: string;
  exceptions: string[];
}
interface ExecutionGuidance {
  required: ExecutionGuidanceItem[];
  consider: ExecutionGuidanceItem[];
  avoid: ExecutionAvoidGuidanceItem[];
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
  contributors: Array<{
    kind: GuidanceSource['kind'];
    id: string;
    logicalPath?: string;
  }>;
  examples: DirectiveExample[];
}
interface DecisionTrace {
  selectedLayers: string[];
  playbookSources: {
    team: 'present' | 'absent';
    personal: 'present' | 'absent';
  };
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
    proposedBy: string;
  }>;
  guidanceDetails: GuidanceDetail[];
  delivery: {
    byteLimit: number;
    deliveredBytes: number;
    mandatoryBytes: number;
    fullGuidanceBytes: number;
    fullPacketBytes: number;
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
  executionGuidance: ExecutionGuidance;
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
  fullGuidanceBytes: number;
  mandatoryGuidanceIds: string[];
  mandatoryGuidance: {
    required: ExecutionGuidanceItem[];
    avoid: ExecutionAvoidGuidanceItem[];
    tensions: DecisionTension[];
  };
  selectableConsider: Array<{
    id: string;
    instruction: string;
    exceptions: string[];
    executionMode: ExecutionMode;
    example?: DirectiveExample;
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
interface MachineFactProvenance {
  source: 'resonant-code-workflow';
  collectionId: string;
}
interface FileFact {
  kind: 'file' | 'symlink';
  contentHash: string;
  mode: string;
}
interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  previousPath?: string;
  before?: FileFact;
  after?: FileFact;
}
interface ChangeSet {
  files: ChangedFile[];
  baselineFingerprint: string;
  currentFingerprint: string;
  changeFingerprint: string;
  baselineHead: string | null;
  currentHead: string | null;
  provenance: MachineFactProvenance;
}
interface CheckResult {
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
type EvaluationEvidenceKind = 'diff' | 'file' | 'check' | 'semantic';
interface EvaluationEvidenceRef {
  kind: EvaluationEvidenceKind;
  ref: string;
  file?: string;
  checkId?: string;
  description?: string;
}
interface GuidanceAttestation {
  guidanceId: string;
  verdict: 'satisfied' | 'violated' | 'partial' | 'unverified';
  evidenceRefs: EvaluationEvidenceRef[];
  explanation: string;
  attestedBy: string;
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
  attestations?: GuidanceAttestation[];
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
  attestation?: {
    attestedBy: string;
    explanation: string;
  };
  exception?: ChangeException;
}
interface ChangeEvaluation {
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
//#endregion
//#region src/evaluation/evaluate-change.d.ts
declare function evaluateChange(input: EvaluateChangeInput): ChangeEvaluation;
//#endregion
export { type ChangeDecisionPacket, type ChangeEvaluation, type ChangeException, type ChangeSet, type ChangedFile, type CheckResult, type CompileChangeInput, type CompileChangeOutput, type DecisionDiagnostic, type DecisionTension, type EffectiveGuidance, type EvaluateChangeInput, type EvaluationEvidenceRef, type ExecutionAvoidGuidanceItem, type ExecutionGuidance, type ExecutionGuidanceItem, type FileFact, type GuidanceAttestation, type GuidanceDeliverySelection, type GuidanceDetail, type GuidanceEvaluation, type GuidanceItem, type GuidanceMode, type GuidanceOverflow, type InterpretationRequest, type MachineFactProvenance, type NormalizedTaskContext, type RelationProposal, type ScopeLevel, type TaskContextInput, type RiskLevel as TaskRiskLevel, type VerificationPlan, type VerificationRequirement, compileChange, evaluateChange };