import type {
  InputProvenance,
  ParsedTaskCandidate,
  ResolveTaskInput as RuntimeResolveTaskInput,
  RuntimeDiagnostics,
  TaskInterpretationTrace,
} from './interpret/types.ts';
import type { ContractPayloadDiagnostics } from './ai-contracts/types.ts';

export type TaskKind = 'code' | 'review' | 'analysis' | 'migration';
export type Operation = 'create' | 'modify' | 'review' | 'refactor' | 'bugfix';
export type Prescription = 'must' | 'should';
export type Weight = 'low' | 'normal' | 'high' | 'critical';
export type DirectiveType = 'constraint' | 'preference' | 'convention' | 'architecture' | 'anti-pattern';
export type AdherenceQuality = 'good' | 'inconsistent' | 'poor';
export type VerificationStatus = 'pending' | 'verified' | 'partial' | 'failed' | 'unverifiable';
export type VerificationDisposition = 'keep' | 'keep-with-reduced-confidence' | 'demote-to-ambient';
export type InductionStatus = 'well-supported' | 'narrowly-supported' | 'overgeneralized' | 'ambiguous';
export type ScopeBasis = 'single-file' | 'directory-cluster' | 'module-cluster' | 'cross-root';
export type RcclSchemaVersion = '1.0';
export type RcclLifecycleStatus = 'active' | 'stale' | 'superseded';
export type ExecutionMode = 'enforce' | 'deviation-noted' | 'ambient' | 'suppress';
export type IgnoredReason = 'not-applicable' | 'conflicts-with-task' | 'too-broad' | 'repo-reality' | 'false-positive' | 'user-corrected' | 'other';
export type FeedbackSignalConfidence = 'implicit' | 'explicit' | 'review-confirmed' | 'user-corrected';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ScopeSize = 'single-file' | 'module' | 'cross-cutting' | 'unknown';
export type CompatibilityRequirement = 'none' | 'preserve-behavior' | 'preserve-api' | 'migration-compatible' | 'breaking-allowed';
export type InterfaceSensitivity = 'internal' | 'public-api' | 'persistence' | 'external-integration' | 'auth-security' | 'unknown';
export type RefactorTolerance = 'none' | 'local-only' | 'bounded' | 'broad';
export type MigrationPhase = 'none' | 'preparation' | 'dual-run' | 'cutover' | 'cleanup';
export type ReviewGoal = 'correctness' | 'regression-risk' | 'architecture-fit' | 'maintainability' | 'security' | 'performance';

export interface DirectiveExampleSide {
  code: string;
}

export interface DirectiveExample {
  avoid?: DirectiveExampleSide;
  good?: DirectiveExampleSide;
  note: string;
}

export interface DirectiveScope {
  path: string;
}

export interface Directive {
  id: string;
  type: DirectiveType;
  layer: string;
  scope: DirectiveScope;
  prescription: Prescription;
  weight: Weight;
  description: string;
  rationale: string;
  exceptions?: string[];
  examples: DirectiveExample[];
  rccl_immune?: boolean;
  source: {
    kind: 'builtin' | 'local-addition';
    layerId: string;
    filePath: string;
  };
}

export interface RcclLifecycle {
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

export interface RcclObservation {
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
}

export interface RcclDocument {
  version: RcclSchemaVersion;
  generated_at: string | null;
  git_ref: string | null;
  observations: RcclObservation[];
}

export interface TaskIntent {
  task_kind: TaskKind;
  operation: Operation;
  target_layer: string;
  tech_stack: string[];
  target_file?: string;
  changed_files: string[];
  tags: string[];
}

export interface ContextProfile {
  project_stage?: 'prototype' | 'growth' | 'stable' | 'critical';
  change_type: Operation;
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

export interface LocalOverride {
  id: string;
  prescription?: Prescription;
  weight?: Weight;
  rationale?: string;
  exceptions?: string[];
}

export interface LocalAugment {
  id: string;
  examples: DirectiveExample[];
}

export interface LocalSuppress {
  id: string;
  reason: string;
}

export interface LocalPlaybook {
  version: string;
  meta: {
    name?: string;
    extends: string[];
  };
  overrides: LocalOverride[];
  augments: LocalAugment[];
  suppresses: LocalSuppress[];
  additions: Directive[];
}

export interface RcclEvidence {
  file: string;
  line_range: [number, number];
  snippet: string;
}

export interface RcclSupport {
  source_slices: string[];
  file_count: number;
  cluster_count: number;
  scope_basis: ScopeBasis;
}

export interface RcclVerification {
  evidence_status: VerificationStatus | null;
  evidence_verified_count: number | null;
  evidence_confidence: number | null;
  induction_status: InductionStatus | null;
  induction_confidence: number | null;
  checked_at: string | null;
  disposition: VerificationDisposition | null;
}

export interface BaseTaskInput {
  description: string;
  taskKind?: TaskKind;
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

export interface CompileTaskInput extends BaseTaskInput {
  operation?: Operation;
  targetFile?: string;
  changedFiles?: string[];
  techStack?: string[];
}

export interface ReviewTaskInput extends BaseTaskInput {
  reviewScope?: string;
  diffPaths?: string[];
  focusAreas?: string[];
  riskProfile?: 'low' | 'medium' | 'high';
}

export interface ResolveTaskInput extends RuntimeResolveTaskInput {}

export type HostFulfillmentStatus = 'absent' | 'accepted' | 'partially-accepted' | 'rejected' | 'unused';

export interface HostFulfillmentArtifactSummary {
  kind: 'task-interpretation' | 'semantic-relation' | 'semantic-candidate' | 'adherence-evaluation';
  provided: boolean;
  path: string | null;
  recommendedPath?: string | null;
  status: HostFulfillmentStatus;
  diagnostics: ContractPayloadDiagnostics | null;
}

export interface HostFulfillmentSummary {
  status: HostFulfillmentStatus;
  taskInterpretation: HostFulfillmentArtifactSummary;
  semanticRelation: HostFulfillmentArtifactSummary;
  semanticCandidate: HostFulfillmentArtifactSummary;
  adherenceEvaluation?: HostFulfillmentArtifactSummary;
}

export interface HostFulfillmentFeedbackSummary {
  interpretation_mode: InputProvenance['interpretation_mode'];
  completion_signal: FeedbackSignalConfidence;
  completion_source: 'default-approximation' | 'explicit-directives' | 'adherence-evaluation';
  artifacts: Record<'task-interpretation' | 'semantic-relation' | 'semantic-candidate' | 'adherence-evaluation', {
    provided: boolean;
    status: HostFulfillmentStatus;
    accepted: number;
    rejected: number;
    downgraded: number;
    unused: number;
  }>;
}

export interface CompileInputBase {
  builtinRoot: string;
  localAugmentPath?: string;
  rcclPath?: string;
  projectRoot: string;
  lockfilePath?: string;
  hostProposals?: import('./ir/types.ts').HostProposalIR[];
  hostFulfillment?: HostFulfillmentSummary;
}

export interface RawCompileInput extends CompileInputBase {
  task: CompileTaskInput;
  parsedTaskCandidate?: ParsedTaskCandidate;
  interpretationMode?: InputProvenance['interpretation_mode'];
}

export interface ResolveTaskRequest {
  task: CompileTaskInput;
  taskKind?: TaskKind;
  candidates?: ParsedTaskCandidate[];
  interpretationMode?: InputProvenance['interpretation_mode'];
}

export interface ResolvedCompileInput extends CompileInputBase {
  resolvedTask: ResolvedTaskOutput;
}

export type CompileInput = RawCompileInput | ResolvedCompileInput;

export interface InterpretationPacket {
  candidates?: ParsedTaskCandidate[];
  input_provenance: InputProvenance;
  diagnostics: RuntimeDiagnostics;
  trace: TaskInterpretationTrace;
  resolved: {
    task_intent: TaskIntent;
    context_profile: ContextProfile;
  };
}

export interface GovernancePacket {
  activation: ActivationView;
  tensions: TensionView;
  focus: FocusView;
  semantic_merge: SemanticMergeResult;
  ego: EffectiveGuidanceObject;
  trace: DecisionTrace;
}

export interface DirectivePriorityRecord {
  layer_rank: number;
  prescription_rank: number;
  weight_rank: number;
  context_rank: number;
}

export interface ActivatedDirective {
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

export interface SkippedDirective {
  directive_id: string;
  layer_id: string;
  reason: 'suppressed-by-local' | 'layer-mismatch' | 'scope-mismatch';
  note: string;
}

export interface ActivationView {
  selected_layers: string[];
  activated: ActivatedDirective[];
  skipped: SkippedDirective[];
}

export interface TensionRecord extends ContextTension {
  observation_id?: string;
  category?: RcclObservation['category'];
}

export interface TensionView {
  records: TensionRecord[];
}

export interface ReviewFocusItem {
  kind: 'tension' | 'anti-pattern' | 'high-priority-directive' | 'compatibility-boundary';
  title: string;
  reason: string;
  directive_id?: string;
  observation_id?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  relation_id?: string;
  group_id?: string;
}

export interface FocusView {
  review_focus: ReviewFocusItem[];
}

export interface GuidanceDirective {
  id: string;
  statement: string;
  rationale: string;
  prescription: Prescription;
  exceptions: string[];
  examples: DirectiveExample[];
  execution_mode: ExecutionMode;
  merge_context?: string;
}

export interface AvoidEntry {
  statement: string;
  trigger: string;
}

export interface ContextTension {
  directive_id: string;
  execution_mode: ExecutionMode;
  conflict: string;
  resolution: string;
  rccl_confidence: number;
  relation_id?: string;
  group_id?: string;
  review_priority?: 'low' | 'normal' | 'high' | 'critical';
}

export interface EffectiveGuidanceObject {
  taskIntent: TaskIntent;
  guidance: {
    must_follow: GuidanceDirective[];
    avoid: AvoidEntry[];
    context_tensions: ContextTension[];
    ambient: string[];
  };
}

export interface TraceStep {
  stage: string;
  lines: string[];
}

export interface DecisionTrace {
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
}

export type RelationKind = 'reinforce' | 'tension' | 'anti-pattern-suppress' | 'ambient-only' | 'none';

export interface DirectiveObservationRelation {
  id: string;
  directive_id: string;
  observation_id: string;
  relation: RelationKind;
  confidence: number;
  basis: Array<'scope' | 'verification' | 'category' | 'context'>;
  reason: string;
  proposed_by: 'runtime-structural' | 'host-agent' | 'host-semantic-candidate' | 'feedback' | 'multi-source';
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
  merge_intent?: string;
  group_id?: string;
}

export interface ReviewFocusSeed {
  kind: ReviewFocusItem['kind'];
  directive_id?: string;
  observation_id?: string;
  reason: string;
  priority?: ReviewFocusItem['priority'];
  relation_id?: string;
  group_id?: string;
}

export interface SemanticMergeContextFocus {
  review_focus: ReviewFocusSeed[];
}

export interface SemanticMergeTensionRecord extends TensionRecord {}

export interface ContextInfluenceRecord {
  field: 'optimization_target' | 'hard_constraints' | 'allowed_tradeoffs' | 'avoid' | 'project_stage' | 'risk_level' | 'scope_size' | 'compatibility_requirement' | 'interface_sensitivity' | 'refactor_tolerance' | 'migration_phase' | 'review_goal' | 'feedback';
  value: string;
  directive_id?: string;
  effect: string;
}

export interface SemanticMergeDirectiveLink {
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

export interface SemanticMergeRelationSummary {
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

export interface SemanticMergeObservationLink {
  observation_id: string;
  directive_ids: string[];
}

export interface SemanticMergeObservationState extends SemanticMergeObservationLink {
  disposition: VerificationDisposition | 'pending';
  lifecycle_status: RcclLifecycleStatus | 'unknown';
  content_fingerprint: string | null;
}

export interface SemanticMergeResult {
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
    host_semantic_candidate_count: number;
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

export interface ResolvedTaskOutput {
  task: CompileTaskInput;
  taskKind: TaskKind;
  candidates?: ParsedTaskCandidate[];
  task_intent: TaskIntent;
  context_profile: ContextProfile;
  input_provenance: InputProvenance;
  diagnostics: RuntimeDiagnostics;
  trace: TaskInterpretationTrace;
}

export interface ChangeDecisionPacket {
  version: '1.0';
  task: {
    task_kind: TaskKind;
    input: CompileTaskInput;
  };
  interpretation: InterpretationPacket;
  governance: GovernancePacket;
  cache: {
    l1Key: string;
    l2Key: string;
    l3Key: string;
  };
}

export interface PrepareInterpretationOutput {
  task: CompileTaskInput;
  interpretationPrompt: string;
  taskSchema: string;
  ambiguityHints: string[];
  recommendation: {
    shouldUseHostCandidate: boolean;
    reason: string;
    nextStep: string;
  };
  candidateArtifact: {
    suggestedPath: string;
    format: 'json' | 'yaml';
    usage: string;
  };
  clarificationHints: string[];
  contract: {
    contractVersion: 'ai-contract/v1';
    kind: 'task-interpretation';
    schemaId: string;
    schemaVersion: '1.0';
    prompt: string;
    schema: unknown;
    artifact: {
      suggestedPath: string;
      format: 'json' | 'yaml';
      usage: string;
    };
    provenance: {
      owner: 'runtime';
      deterministic: true;
    };
    cacheKeyMaterial?: unknown;
  };
}

export interface RuntimeSessionRecord {
  version: '1.0';
  status: 'ok' | 'failed';
  createdAt: string;
  paths: {
    projectRoot: string;
    pluginRoot: string;
    builtinRoot: string;
    runtimeEntry: string;
    localAugmentPath?: string;
    rcclPath?: string;
    lockfilePath: string;
  };
  taskInput: CompileTaskInput;
  interpretation: {
    mode: InputProvenance['interpretation_mode'];
    candidates?: ParsedTaskCandidate[];
    provenance?: InputProvenance;
    diagnostics?: RuntimeDiagnostics;
    trace?: TaskInterpretationTrace;
  };
  compileInput: {
    builtinRoot: string;
    localAugmentPath?: string;
    rcclPath?: string;
    lockfilePath?: string;
    projectRoot: string;
    resolvedTask?: ResolvedTaskOutput;
    task?: CompileTaskInput;
    parsedTaskCandidate?: ParsedTaskCandidate;
    interpretationMode?: InputProvenance['interpretation_mode'];
    hostProposals?: import('./ir/types.ts').HostProposalIR[];
    hostFulfillment?: HostFulfillmentSummary;
    hostProposalFile?: string;
    semanticProposalFile?: string;
  };
  compileOutput: CompileOutput | null;
  warnings: string[];
  error?: string;
}

export interface PrepareCodeTaskResult {
  status: 'ok' | 'failed';
  sessionPath: string;
  paths: RuntimeSessionRecord['paths'];
  packet?: ChangeDecisionPacket;
  ego: EffectiveGuidanceObject | null;
  trace: DecisionTrace | null;
  warnings: string[];
  error?: string;
}

export interface CompleteCodeTaskResult {
  status: 'updated' | 'skipped';
  sessionPath: string;
  lockfilePath: string | null;
  followedDirectiveIds?: string[];
  ignoredDirectiveIds?: string[];
  ignoredDirectiveReasons?: Partial<Record<string, IgnoredReason>>;
  signalConfidence?: FeedbackSignalConfidence;
  reason?: string;
}

export interface ResolveTaskResult extends ResolvedTaskOutput {}

export interface PrepareCodeTaskInput extends CompileTaskInput {
  projectRoot: string;
  pluginRoot?: string;
  taskDescription: string;
  candidateFile?: string;
}

export interface CompileOutput {
  packet: ChangeDecisionPacket;
  resolvedTask: ResolvedTaskOutput;
  ego: EffectiveGuidanceObject;
  trace: DecisionTrace;
  cache: {
    l1Key: string;
    l2Key: string;
    l3Key: string;
  };
}

export interface EvaluateInput {
  ego: EffectiveGuidanceObject;
  packet: ChangeDecisionPacket;
  lockfilePath: string;
  followedDirectiveIds?: string[];
  ignoredDirectiveIds?: string[];
  ignoredDirectiveReasons?: Partial<Record<string, IgnoredReason>>;
  signalConfidence?: FeedbackSignalConfidence;
  hostFulfillment?: HostFulfillmentSummary;
  adherencePayload?: import('./ai-contracts/types.ts').ValidatedAdherenceVerdict[];
}

export interface LockfileSignal {
  followed: number;
  ignored: number;
  follow_rate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface LockfileTaskOutcome {
  total_tasks: number;
  with_tensions: number;
  last_execution_modes: Record<ExecutionMode, number>;
  last_tension_count: number;
  last_updated_at: string;
}

export interface LockfileObservationEntry {
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

export interface LockfileTensionEntry {
  seen_count: number;
  directive_id: string;
  observation_id: string;
  last_execution_mode: ExecutionMode;
  last_seen: string;
}

export interface LockfileDirectiveEntry {
  quality_signal: {
    overall: LockfileSignal;
    by_task_type: Record<string, { followed: number; ignored: number }>;
    by_task_profile: Record<string, { followed: number; ignored: number }>;
    ignored_reasons: Partial<Record<IgnoredReason, number>>;
    last_ignored_reason?: IgnoredReason;
    signal_confidence: FeedbackSignalConfidence;
    last_seen: string;
  };
  governance?: {
    outcomes: LockfileTaskOutcome;
  };
}

export interface LockfileDocument {
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
