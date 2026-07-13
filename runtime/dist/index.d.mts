//#region src/ir/types.d.ts
interface IRFingerprintSet {
  task: string;
  directives: string;
  observations: string;
  feedback: string;
  hostProposals: string;
  bundle: string;
}
//#endregion
//#region src/ai-contracts/types.d.ts
type AIContractVersion = 'ai-contract/v1';
type AIContractSchemaVersion = '1.0';
type AIContractKind = 'agent-capability-profile' | 'task-model' | 'semantic-governance-graph' | 'adherence-evidence' | 'governance-evolution-proposal' | 'context-acquisition' | 'rccl-observation-generation' | 'rccl-observation-refresh' | 'rccl-counterexample';
interface AIContractArtifact {
  suggestedPath: string;
  format: 'json' | 'yaml';
  usage: string;
}
interface AIContractEnvelope<TSchema = unknown> {
  contractVersion: AIContractVersion;
  kind: AIContractKind;
  requestId: string;
  contextFingerprint: string;
  schemaId: string;
  schemaVersion: AIContractSchemaVersion;
  prompt: string;
  schema: TSchema;
  artifact: AIContractArtifact;
  allowedIds?: {
    directiveIds?: string[];
    observationIds?: string[];
  };
  provenance: {
    owner: 'runtime' | 'rccl';
    deterministic: true;
  };
  context?: unknown;
  cacheKeyMaterial?: unknown;
}
interface HostArtifactInput {
  raw: unknown;
  path?: string;
}
type EvidenceRefKind = 'file' | 'diff' | 'command' | 'rccl-evidence' | 'runtime-trace' | 'conversation';
interface EvidenceRef {
  kind: EvidenceRefKind;
  ref: string;
  file?: string;
  line_range?: [number, number];
  snippet_hash?: string;
  command?: string;
  output_hash?: string;
}
interface HostProposalSourceInput {
  id: string;
  path?: string;
}
type ContractPayloadDiagnosticStatus = 'accepted' | 'rejected' | 'downgraded' | 'unused';
type ContractPayloadDiagnosticReason = 'accepted' | 'duplicate-id' | 'empty-payload' | 'invalid-id' | 'low-confidence' | 'malformed-payload' | 'missing-evidence' | 'missing-required-field' | 'unsupported-schema-version' | 'unsupported-value' | 'capped-by-policy' | 'unverified-evidence' | 'insufficient-static-evidence' | 'conversation-only-evidence';
interface ContractPayloadDiagnosticEntry {
  status: ContractPayloadDiagnosticStatus;
  reason: ContractPayloadDiagnosticReason;
  path: string;
  message: string;
  directiveId?: string;
  observationId?: string;
  confidence?: number;
}
interface ContractPayloadDiagnostics {
  kind: AIContractKind;
  source?: HostProposalSourceInput;
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    downgraded: number;
    unused: number;
  };
  entries: ContractPayloadDiagnosticEntry[];
}
interface EvidenceRefVerificationContext {
  projectRoot?: string;
  observations?: Array<{
    id: string;
    evidence: Array<{
      file: string;
      line_range: [number, number];
      snippet: string;
    }>;
    verification?: {
      evidence_status?: string | null;
      disposition?: string | null;
    };
  }>;
  runtimeTraceRefs?: readonly string[];
  commandOutputHashes?: readonly string[];
  diffSnapshotHashes?: readonly string[];
}
interface TaskModelScalarField<T extends string = string> {
  value?: T;
  confidence: number;
  evidence_refs: EvidenceRef[];
  alternatives?: T[];
  uncertainties?: string[];
}
interface TaskModelListField<T extends string = string> {
  values: T[];
  confidence: number;
  evidence_refs: EvidenceRef[];
  alternatives?: T[][];
  uncertainties?: string[];
}
interface TaskModelProposal {
  intent: {
    workflow?: TaskModelScalarField<Workflow>;
    change_type?: TaskModelScalarField<ChangeType>;
    operation?: TaskModelScalarField<Operation>;
    target_layer?: TaskModelScalarField<string>;
    target_file?: TaskModelScalarField<string>;
    changed_files?: TaskModelListField<string>;
    tech_stack?: TaskModelListField<string>;
    tags?: TaskModelListField<string>;
  };
  context: {
    project_stage?: TaskModelScalarField<NonNullable<ContextProfile['project_stage']>>;
    optimization_target?: TaskModelScalarField<ContextProfile['optimization_target']>;
    hard_constraints?: TaskModelListField<string>;
    allowed_tradeoffs?: TaskModelListField<string>;
    avoid?: TaskModelListField<string>;
    risk_level?: TaskModelScalarField<RiskLevel>;
    scope_size?: TaskModelScalarField<ScopeSize>;
    compatibility_requirement?: TaskModelScalarField<CompatibilityRequirement>;
    interface_sensitivity?: TaskModelScalarField<InterfaceSensitivity>;
    refactor_tolerance?: TaskModelScalarField<RefactorTolerance>;
    migration_phase?: TaskModelScalarField<MigrationPhase>;
    review_goal?: TaskModelScalarField<ReviewGoal>;
  };
  uncertainties: string[];
}
//#endregion
//#region src/interpret/types.d.ts
type InterpretationSource = 'explicit' | 'deterministic' | 'host-agent' | 'assistive-ai' | 'repo-default' | 'derived';
type InterpretationMode = 'explicit-only' | 'deterministic-only' | 'host-agent' | 'assistive-ai' | 'clarified-retry';
type ResolutionQuality = 'explicit' | 'ai-assisted' | 'deterministic' | 'degraded';
interface InterpretationConflict {
  field: string;
  winner: InterpretationSource;
  discarded: InterpretationSource[];
  rationale: string;
}
interface InputProvenance {
  resolved_fields: Array<{
    field: string;
    source: InterpretationSource;
    confidence: number;
  }>;
  unresolved_fields: string[];
  context_resolution: ContextDecisionInput[];
  interpretation_mode: InterpretationMode;
  resolution_quality: ResolutionQuality;
}
interface ContextDecisionInput {
  field: string;
  value: string | string[];
  source: InterpretationSource;
  confidence: number;
  status: 'resolved' | 'defaulted' | 'unresolved' | 'conflicted';
  influence: string[];
}
interface RuntimeDiagnostics {
  warnings: string[];
  fallback_usage: {
    used_deterministic_interpretation: boolean;
    used_candidate_normalization: boolean;
  };
  clarification_recommended: boolean;
  ambiguity_reasons: string[];
  discarded_inputs: DiscardedInterpretationInput[];
}
interface DiscardedInterpretationInput {
  field: string;
  value: string;
  source: InterpretationSource;
  reason: 'invalid-enum' | 'below-confidence-threshold' | 'missing-value';
  action: 'discarded';
  fallback?: string;
}
interface CandidateSummary {
  source: InterpretationSource;
  confidence: number;
  resolved_fields: string[];
  unresolved_fields: string[];
}
interface TaskInterpretationTrace {
  mode: InterpretationMode;
  candidate_summaries: CandidateSummary[];
  conflicts: InterpretationConflict[];
  selected_sources: Array<{
    field: string;
    source: InterpretationSource;
    confidence: number;
  }>;
}
//#endregion
//#region src/types.d.ts
type Workflow = 'code' | 'review' | 'analysis';
type ChangeType = 'feature' | 'bugfix' | 'refactor' | 'migration' | 'unknown';
type Operation = 'create' | 'modify' | 'delete' | 'mixed';
type Prescription = 'must' | 'should';
type Weight = 'low' | 'normal' | 'high' | 'critical';
type AdherenceQuality = 'good' | 'inconsistent' | 'poor';
type VerificationStatus = 'pending' | 'verified' | 'partial' | 'failed' | 'unverifiable';
type VerificationDisposition = 'keep' | 'keep-with-reduced-confidence' | 'demote-to-ambient';
type RuntimeRcclVerificationPolicy = 'task-relevant' | 'deep' | 'trust-existing';
type InductionStatus = 'well-supported' | 'narrowly-supported' | 'overgeneralized' | 'ambiguous';
type ScopeBasis = 'single-file' | 'directory-cluster' | 'module-cluster' | 'cross-root';
type RcclLifecycleStatus = 'active' | 'stale' | 'superseded';
type ExecutionMode = 'enforce' | 'deviation-noted' | 'ambient' | 'suppress';
type IgnoredReason = 'not-applicable' | 'conflicts-with-task' | 'too-broad' | 'repo-reality' | 'false-positive' | 'user-corrected' | 'other';
type FeedbackSignalConfidence = 'implicit' | 'explicit' | 'review-confirmed' | 'user-corrected';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ScopeSize = 'single-file' | 'module' | 'cross-cutting' | 'unknown';
type CompatibilityRequirement = 'none' | 'preserve-behavior' | 'preserve-api' | 'migration-compatible' | 'breaking-allowed';
type InterfaceSensitivity = 'internal' | 'public-api' | 'persistence' | 'external-integration' | 'auth-security' | 'unknown';
type RefactorTolerance = 'none' | 'local-only' | 'bounded' | 'broad';
type MigrationPhase = 'none' | 'preparation' | 'dual-run' | 'cutover' | 'cleanup';
type ReviewGoal = 'correctness' | 'regression-risk' | 'architecture-fit' | 'maintainability' | 'security' | 'performance';
type GuidanceExecutionMode = 'fast' | 'standard' | 'strict';
interface DirectiveExampleSide {
  code: string;
}
interface DirectiveExample {
  avoid?: DirectiveExampleSide;
  good?: DirectiveExampleSide;
  note: string;
}
interface RcclLifecycle {
  first_seen_git_ref: string | null;
  last_seen_git_ref: string | null;
  last_verified_at: string | null;
  content_fingerprint: string;
  status: RcclLifecycleStatus;
  supersedes?: string[];
  superseded_by?: string;
  stale_since_git_ref?: string | null;
  superseded_at_git_ref?: string | null;
}
interface RcclObservation {
  id: string;
  semantic_key: string;
  category: 'style' | 'architecture' | 'pattern' | 'constraint' | 'legacy' | 'anti-pattern' | 'migration';
  scope: string;
  pattern: string;
  confidence: number;
  adherence_quality: AdherenceQuality;
  evidence: RcclEvidence[];
  support: RcclSupport;
  verification: RcclVerification;
  lifecycle?: RcclLifecycle;
  traits?: RcclObservationTraits;
}
interface RcclObservationTraits {
  legacy?: boolean;
  migration_boundary?: boolean;
  anti_pattern?: boolean;
  compatibility_boundary?: boolean;
}
interface TaskIntent {
  workflow: Workflow;
  change_type: ChangeType;
  operation: Operation;
  target_layer: string;
  tech_stack: string[];
  target_file?: string;
  changed_files: string[];
  tags: string[];
}
interface ContextProfile {
  project_stage?: 'prototype' | 'growth' | 'stable' | 'critical';
  optimization_target: 'speed' | 'maintainability' | 'safety' | 'simplicity' | 'reviewability';
  hard_constraints: string[];
  allowed_tradeoffs: string[];
  avoid: string[];
  risk_level: RiskLevel;
  scope_size: ScopeSize;
  compatibility_requirement: CompatibilityRequirement;
  interface_sensitivity: InterfaceSensitivity;
  refactor_tolerance: RefactorTolerance;
  migration_phase: MigrationPhase;
  review_goal: ReviewGoal;
}
interface RcclEvidence {
  file: string;
  line_range: [number, number];
  snippet: string;
}
interface RcclSupport {
  source_slices: string[];
  file_count: number;
  cluster_count: number;
  scope_basis: ScopeBasis;
}
interface RcclVerification {
  evidence_status: VerificationStatus | null;
  evidence_verified_count: number | null;
  evidence_confidence: number | null;
  induction_status: InductionStatus | null;
  induction_confidence: number | null;
  checked_at: string | null;
  disposition: VerificationDisposition | null;
}
interface BaseTaskInput {
  description: string;
  workflow?: Workflow;
  changeType?: ChangeType;
  tags?: string[];
  projectStage?: ContextProfile['project_stage'];
  optimizationTarget?: ContextProfile['optimization_target'];
  hardConstraints?: string[];
  allowedTradeoffs?: string[];
  avoid?: string[];
  riskLevel?: RiskLevel;
  scopeSize?: ScopeSize;
  compatibilityRequirement?: CompatibilityRequirement;
  interfaceSensitivity?: InterfaceSensitivity;
  refactorTolerance?: RefactorTolerance;
  migrationPhase?: MigrationPhase;
  reviewGoal?: ReviewGoal;
}
interface CompileTaskInput extends BaseTaskInput {
  operation?: Operation;
  targetFile?: string;
  changedFiles?: string[];
  techStack?: string[];
}
type HostFulfillmentStatus = 'absent' | 'accepted' | 'partially-accepted' | 'rejected' | 'unused' | 'assumed';
interface HostFulfillmentArtifactSummary {
  kind: 'agent-capability-profile' | 'task-model' | 'semantic-governance-graph' | 'adherence-evidence';
  provided: boolean;
  path: string | null;
  recommendedPath?: string | null;
  status: HostFulfillmentStatus;
  diagnostics: ContractPayloadDiagnostics | null;
}
interface HostFulfillmentSummary {
  status: HostFulfillmentStatus;
  agentCapability: HostFulfillmentArtifactSummary;
  taskModel: HostFulfillmentArtifactSummary;
  semanticGovernanceGraph: HostFulfillmentArtifactSummary;
  adherenceEvidence?: HostFulfillmentArtifactSummary;
}
interface HostFulfillmentFeedbackSummary {
  interpretation_mode: InputProvenance['interpretation_mode'];
  completion_signal: FeedbackSignalConfidence;
  completion_source: 'no-explicit-evaluation' | 'explicit-directives' | 'adherence-evidence';
  artifacts: Record<'agent-capability-profile' | 'task-model' | 'semantic-governance-graph' | 'adherence-evidence', {
    provided: boolean;
    status: HostFulfillmentStatus;
    accepted: number;
    rejected: number;
    downgraded: number;
    unused: number;
  }>;
}
interface RuntimeHostArtifacts {
  agentCapabilityProfile?: HostArtifactInput;
  taskModel?: HostArtifactInput;
  semanticGovernanceGraph?: HostArtifactInput;
  adherenceEvidence?: HostArtifactInput;
}
interface PublicLifecycleInputBase {
  builtinRoot: string;
  localAugmentPath?: string;
  rcclPath?: string;
  projectRoot: string;
  lockfilePath?: string;
  verificationPolicy?: RuntimeRcclVerificationPolicy;
  artifacts?: RuntimeHostArtifacts;
}
interface PublicCompileInput extends PublicLifecycleInputBase {
  task: CompileTaskInput;
}
interface GuidancePlanSourceStatus {
  localAugment: 'present' | 'absent';
  rccl: 'present' | 'absent' | 'stale' | 'unverified';
  lockfile: 'present' | 'absent';
  cache: 'hit' | 'miss' | 'partial';
}
interface GuidancePlanProvidedContracts {
  agentCapability?: boolean;
  taskModel?: boolean;
  semanticGovernanceGraph?: boolean;
  adherenceEvidence?: boolean;
}
interface GuidancePlanArtifactPaths {
  agentCapabilityProfile: string;
  taskModel: string;
  semanticGovernanceGraph?: string;
  contextAcquisition?: string;
}
interface GuidancePlanInput extends PublicLifecycleInputBase {
  task: CompileTaskInput;
  mode?: GuidanceExecutionMode;
  providedContracts?: GuidancePlanProvidedContracts;
  artifactPaths: GuidancePlanArtifactPaths;
}
interface RuntimeContractRequest {
  kind: ContractPolicyKind;
  artifact: AIContractArtifact;
  contract: AIContractEnvelope;
  context?: unknown;
}
type ContractPolicyKind = 'agent-capability-profile' | 'task-model' | 'semantic-governance-graph' | 'adherence-evidence' | 'governance-evolution-proposal' | 'context-acquisition';
type ContractPolicySkippedReason = 'already-provided' | 'insufficient-agent-capability' | 'missing-rccl' | 'mode-fast' | 'rccl-not-relevant' | 'waiting-for-task-model' | 'deferred-until-after-compile' | 'deterministic-fallback-allowed' | 'runtime-assumption' | 'not-required-for-current-policy';
interface ContractPolicySkippedContract {
  kind: ContractPolicyKind;
  reason_id: ContractPolicySkippedReason;
}
interface ContractPolicyDecision {
  mode: GuidanceExecutionMode;
  required: ContractPolicyKind[];
  optional: ContractPolicyKind[];
  skipped: ContractPolicySkippedContract[];
  escalation: 'none' | 'task-model' | 'semantic-governance-graph' | 'adherence-required' | 'context-acquisition';
  diagnostics: {
    task_model_required: boolean;
    semantic_graph_required: boolean;
    rccl_relevant?: boolean;
    reasons: string[];
    deterministic_fallbacks: Array<{
      field: string;
      value: string;
      confidence: number;
      action: 'ignored-for-policy';
      reason: string;
    }>;
  };
}
interface GuidancePlan {
  mode: 'ready' | 'contracts-required' | 'degraded';
  guidanceMode: GuidanceExecutionMode;
  requiredContracts: RuntimeContractRequest[];
  recommendedContracts: AIContractKind[];
  sourceStatus: GuidancePlanSourceStatus;
  outputPolicy: {
    stdout: 'compact';
    trace: 'session-only';
  };
  policy: ContractPolicyDecision;
  diagnostics: {
    policy: 'ready' | 'contracts-required' | 'degraded';
    notes: string[];
  };
  resolvedTask: ResolvedTaskOutput;
  contractDiagnostics: ContractPayloadDiagnostics[];
}
interface InterpretationPacket {
  task_models?: TaskModelProposal[];
  input_provenance: InputProvenance;
  diagnostics: RuntimeDiagnostics;
  trace: TaskInterpretationTrace;
  resolved: {
    task_intent: TaskIntent;
    context_profile: ContextProfile;
  };
}
interface GovernancePacket {
  activation: ActivationView;
  tensions: TensionView;
  focus: FocusView;
  semantic_merge: SemanticMergeResult;
  ego: EffectiveGuidanceObject;
  trace: DecisionTrace;
}
interface DirectivePriorityRecord {
  layer_rank: number;
  prescription_rank: number;
  weight_rank: number;
  context_rank: number;
}
interface ActivatedDirective {
  directive_id: string;
  layer_id: string;
  source_file: string;
  effective_prescription: Prescription;
  effective_weight: Weight;
  effective_priority: DirectivePriorityRecord;
  activation_reason: string;
  override_applied: boolean;
  augment_applied: boolean;
}
interface SkippedDirective {
  directive_id: string;
  layer_id: string;
  reason: 'suppressed-by-local' | 'layer-mismatch' | 'scope-mismatch';
  note: string;
}
interface ActivationView {
  selected_layers: string[];
  activated: ActivatedDirective[];
  skipped: SkippedDirective[];
}
interface TensionRecord extends ContextTension {
  observation_id?: string;
  category?: RcclObservation['category'];
}
interface TensionView {
  records: TensionRecord[];
}
interface ReviewFocusItem {
  kind: 'tension' | 'anti-pattern' | 'high-priority-directive' | 'compatibility-boundary';
  title: string;
  reason: string;
  directive_id?: string;
  observation_id?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  relation_id?: string;
  group_id?: string;
}
interface FocusView {
  review_focus: ReviewFocusItem[];
}
interface GuidanceDirective {
  id: string;
  statement: string;
  rationale: string;
  prescription: Prescription;
  exceptions: string[];
  examples: DirectiveExample[];
  execution_mode: ExecutionMode;
  merge_context?: string;
}
interface AvoidEntry {
  statement: string;
  trigger: string;
}
interface ContextTension {
  directive_id: string;
  execution_mode: ExecutionMode;
  conflict: string;
  resolution: string;
  rccl_confidence: number;
  relation_id?: string;
  group_id?: string;
  review_priority?: 'low' | 'normal' | 'high' | 'critical';
}
interface EffectiveGuidanceObject {
  taskIntent: TaskIntent;
  guidance: {
    must_follow: GuidanceDirective[];
    avoid: AvoidEntry[];
    context_tensions: ContextTension[];
    ambient: string[];
  };
}
interface TraceStep {
  stage: string;
  lines: string[];
}
interface DecisionTrace {
  task: TaskIntent;
  steps: TraceStep[];
  activated_directives: string[];
  suppressed_directives: string[];
  activation: ActivationView;
  tensions: TensionView;
  review_focus: ReviewFocusItem[];
  directive_decisions: SemanticMergeDirectiveLink[];
  observation_links: Array<{
    observation_id: string;
    directive_ids: string[];
  }>;
  context_influences: ContextInfluenceRecord[];
  host_fulfillment?: HostFulfillmentSummary;
  ego_budget?: {
    limits: {
      total_items: number;
      hard_items: number;
      ambient_items: number;
      examples_per_directive: number;
      serialized_characters: number;
    };
    exceeded: boolean;
    serialized_characters: number;
    omitted: Array<{
      id: string;
      reason: string;
      original_priority: string;
    }>;
  };
}
type RelationKind = 'reinforce' | 'tension' | 'anti-pattern-suppress' | 'ambient-only' | 'none';
interface DirectiveObservationRelation {
  id: string;
  directive_id: string;
  observation_id: string;
  relation: RelationKind;
  confidence: number;
  basis: Array<'scope' | 'verification' | 'category' | 'context'>;
  reason: string;
  proposed_by: 'runtime-structural' | 'host-agent' | 'feedback' | 'multi-source';
  adjudication_status: 'accepted' | 'rejected' | 'downgraded';
  final_relation: RelationKind;
  conflict_class?: string;
  signals: Array<{
    kind: string;
    strength: string;
    direction: string;
    reason: string;
  }>;
  evidence_refs: string[];
  reasoning_summary: string;
  adjudication_reason: string;
  impact?: 'execution-mode' | 'review-focus' | 'ambient-context' | 'no-effect';
  review_priority?: 'low' | 'normal' | 'high' | 'critical';
  execution_intent?: ExecutionMode | 'no-change';
  merge_intent?: string;
  group_id?: string;
}
interface ReviewFocusSeed {
  kind: ReviewFocusItem['kind'];
  directive_id?: string;
  observation_id?: string;
  reason: string;
  priority?: ReviewFocusItem['priority'];
  relation_id?: string;
  group_id?: string;
}
interface SemanticMergeContextFocus {
  review_focus: ReviewFocusSeed[];
}
interface SemanticMergeTensionRecord extends TensionRecord {}
interface ContextInfluenceRecord {
  field: 'optimization_target' | 'hard_constraints' | 'allowed_tradeoffs' | 'avoid' | 'project_stage' | 'risk_level' | 'scope_size' | 'compatibility_requirement' | 'interface_sensitivity' | 'refactor_tolerance' | 'migration_phase' | 'review_goal' | 'feedback';
  value: string;
  directive_id?: string;
  effect: string;
}
interface SemanticMergeDirectiveLink {
  directive_id: string;
  observation_ids: string[];
  relation_ids: string[];
  relation_summaries: SemanticMergeRelationSummary[];
  execution_mode: ExecutionMode;
  default_execution_mode: ExecutionMode;
  reason: string;
  decision_basis: 'default' | 'observed-conflict' | 'anti-pattern' | 'rccl-immune' | 'context-adjusted';
  context_applied: string[];
  context_rule_ids: string[];
  feedback_applied: string[];
}
interface SemanticMergeRelationSummary {
  relation_id: string;
  observation_id: string;
  relation: RelationKind;
  adjudication_status: 'accepted' | 'rejected' | 'downgraded';
  confidence: number;
  reason: string;
  review_priority?: 'low' | 'normal' | 'high' | 'critical';
  impact?: 'execution-mode' | 'review-focus' | 'ambient-context' | 'no-effect';
  group_id?: string;
}
interface SemanticMergeObservationLink {
  observation_id: string;
  directive_ids: string[];
}
interface SemanticMergeObservationState extends SemanticMergeObservationLink {
  disposition: VerificationDisposition | 'pending';
  lifecycle_status: RcclLifecycleStatus | 'unknown';
  content_fingerprint: string | null;
}
interface SemanticMergeResult {
  activated_directives: string[];
  suppressed_directives: string[];
  context_tensions: SemanticMergeTensionRecord[];
  directive_modes: SemanticMergeDirectiveLink[];
  observation_links: SemanticMergeObservationLink[];
  observation_states: SemanticMergeObservationState[];
  relations: DirectiveObservationRelation[];
  merge_summary: {
    proposed: number;
    accepted: number;
    downgraded: number;
    rejected: number;
    final_relation_counts: Record<RelationKind, number>;
    proposed_by_counts: Record<string, number>;
    execution_mode_impacting: number;
    feedback_applied_count: number;
    host_graph_edge_count: number;
    review_priority_counts: Record<'low' | 'normal' | 'high' | 'critical', number>;
    policy: {
      host_semantic: {
        min_confidence: number;
        max_candidates_per_directive: number;
      };
      feedback: {
        frequently_ignored_follow_rate: number;
        frequently_ignored_min_ignored: number;
        recurring_tension_seen_count: number;
        noisy_observation_relation_count: number;
      };
    };
  };
  focus: SemanticMergeContextFocus;
  context_influences: ContextInfluenceRecord[];
}
interface ResolvedTaskOutput {
  task: CompileTaskInput;
  workflow: Workflow;
  task_models?: TaskModelProposal[];
  task_intent: TaskIntent;
  context_profile: ContextProfile;
  input_provenance: InputProvenance;
  diagnostics: RuntimeDiagnostics;
  trace: TaskInterpretationTrace;
}
interface RuntimeCacheKeys {
  l1Key: string;
  l2Key: string;
  l3Key: string;
  verificationPolicy: RuntimeRcclVerificationPolicy;
  rcclVerificationKey: string;
}
interface ChangeDecisionPacket {
  version: '1';
  status: 'compiled' | 'needs-attention';
  task: {
    workflow: Workflow;
    change_type: ChangeType;
    operation: Operation;
    input: CompileTaskInput;
  };
  interpretation: InterpretationPacket;
  governance: GovernancePacket;
  cache: RuntimeCacheKeys;
  fingerprints: IRFingerprintSet;
  contract_diagnostics: ContractPayloadDiagnostics[];
  post_compile_contract_requests: RuntimeContractRequest[];
}
interface CompileOutput {
  packet: ChangeDecisionPacket;
  resolvedTask: ResolvedTaskOutput;
  ego: EffectiveGuidanceObject;
  trace: DecisionTrace;
  cache: RuntimeCacheKeys;
  contractDiagnostics: ContractPayloadDiagnostics[];
  postCompileContractRequests: RuntimeContractRequest[];
}
interface PublicEvaluateInput {
  ego: EffectiveGuidanceObject;
  packet: ChangeDecisionPacket;
  lockfilePath: string;
  artifacts?: Pick<RuntimeHostArtifacts, 'adherenceEvidence'>;
  evidenceContext?: EvidenceRefVerificationContext;
}
interface EvaluateOutput {
  status: 'updated' | 'needs-attention';
  lockfile: LockfileDocument;
  contractDiagnostics: ContractPayloadDiagnostics;
  verdictCounts: {
    followed: number;
    partial: number;
    ignored: number;
    unverified: number;
  };
}
interface LockfileSignal {
  followed: number;
  ignored: number;
  partial: number;
  unverified: number;
  follow_rate: number;
  coverage_rate: number;
  trend: 'improving' | 'stable' | 'declining';
  recent_verdicts: Array<'followed' | 'partial' | 'ignored'>;
}
interface LockfileTaskOutcome {
  total_tasks: number;
  with_tensions: number;
  last_execution_modes: Record<ExecutionMode, number>;
  last_tension_count: number;
  last_updated_at: string;
}
interface LockfileObservationEntry {
  seen_count: number;
  relation_count: number;
  active_seen_count: number;
  stale_seen_count: number;
  superseded_seen_count: number;
  last_disposition: VerificationDisposition | 'pending';
  last_lifecycle_status: RcclLifecycleStatus | 'unknown';
  last_content_fingerprint: string | null;
  last_seen: string;
}
interface LockfileTensionEntry {
  seen_count: number;
  directive_id: string;
  observation_id: string;
  last_execution_mode: ExecutionMode;
  last_seen: string;
}
interface LockfileDirectiveEntry {
  quality_signal: {
    overall: LockfileSignal;
    by_task_type: Record<string, {
      followed: number;
      ignored: number;
      partial: number;
      unverified: number;
    }>;
    by_task_profile: Record<string, {
      followed: number;
      ignored: number;
      partial: number;
      unverified: number;
    }>;
    ignored_reasons: Partial<Record<IgnoredReason, number>>;
    last_ignored_reason?: IgnoredReason;
    signal_confidence: FeedbackSignalConfidence;
    evidence_confidence?: number;
    last_evaluation_source?: HostFulfillmentFeedbackSummary['completion_source'];
    last_seen: string;
  };
  governance?: {
    outcomes: LockfileTaskOutcome;
  };
}
interface LockfileDocument {
  version: '1.0';
  directives: Record<string, LockfileDirectiveEntry>;
  observations: Record<string, LockfileObservationEntry>;
  tensions: Record<string, LockfileTensionEntry>;
  governance_summary: {
    total_tasks: number;
    by_task_type: Record<string, number>;
    by_task_profile: Record<string, number>;
    last_execution_modes: Record<ExecutionMode, number>;
    last_tension_count: number;
    last_observation_count: number;
    last_host_fulfillment?: HostFulfillmentFeedbackSummary;
    last_updated_at: string;
  };
}
//#endregion
//#region src/plan-guidance.d.ts
declare function planGuidance(input: GuidancePlanInput): Promise<GuidancePlan>;
//#endregion
//#region src/compile.d.ts
/**
 * Runs the deterministic playbook pipeline and produces a change decision packet.
 */
declare function compile(input: PublicCompileInput): Promise<CompileOutput>;
//#endregion
//#region src/feedback.d.ts
declare function evaluateGuidance(input: PublicEvaluateInput): EvaluateOutput;
//#endregion
export { type PublicCompileInput as CompileInput, type CompileOutput, type PublicEvaluateInput as EvaluateInput, type EvaluateOutput, type GuidancePlan, type GuidancePlanInput, compile, evaluateGuidance, planGuidance };