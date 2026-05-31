import type {
  CompatibilityRequirement,
  CompileTaskInput,
  ContextProfile,
  ExecutionMode,
  IgnoredReason,
  InterfaceSensitivity,
  MigrationPhase,
  Operation,
  RefactorTolerance,
  ReviewGoal,
  RiskLevel,
  ScopeSize,
  TaskKind,
} from '../types.ts';
import type {
  SemanticRelationImpactIR,
  SemanticRelationKindIR,
  SemanticRelationReviewPriorityIR,
} from '../ir/types.ts';

export type AIContractVersion = 'ai-contract/v2';
export type AIContractSchemaVersion = '2.0';
export type AIContractKind =
  | 'agent-capability-profile'
  | 'task-model'
  | 'semantic-governance-graph'
  | 'adherence-evidence'
  | 'governance-evolution-proposal'
  | 'context-acquisition'
  | 'rccl-observation-generation'
  | 'rccl-observation-refresh'
  | 'rccl-counterexample';

export interface AIContractArtifact {
  suggestedPath: string;
  format: 'json' | 'yaml';
  usage: string;
}

export interface AIContractEnvelope<TSchema = unknown> {
  contractVersion: AIContractVersion;
  kind: AIContractKind;
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

export type EvidenceRefKind = 'file' | 'diff' | 'command' | 'rccl-evidence' | 'runtime-trace' | 'conversation';

export interface EvidenceRef {
  kind: EvidenceRefKind;
  ref: string;
  file?: string;
  line_range?: [number, number];
  snippet_hash?: string;
  command?: string;
  output_hash?: string;
}

export interface HostProposalSourceInput {
  id: string;
  path?: string;
}

export type ContractPayloadDiagnosticStatus = 'accepted' | 'rejected' | 'downgraded' | 'unused';
export type ContractPayloadDiagnosticReason =
  | 'accepted'
  | 'duplicate-id'
  | 'empty-payload'
  | 'invalid-id'
  | 'low-confidence'
  | 'malformed-payload'
  | 'missing-evidence'
  | 'missing-required-field'
  | 'unsupported-value'
  | 'capped-by-policy'
  | 'unverified-evidence'
  | 'insufficient-static-evidence'
  | 'conversation-only-evidence';

export interface ContractPayloadDiagnosticEntry {
  status: ContractPayloadDiagnosticStatus;
  reason: ContractPayloadDiagnosticReason;
  path: string;
  message: string;
  directiveId?: string;
  observationId?: string;
  confidence?: number;
}

export interface ContractPayloadDiagnostics {
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

export interface EvidenceRefVerificationEntry {
  ref: EvidenceRef;
  status: 'verified' | 'unverified';
  static: boolean;
  reason: string;
}

export interface EvidenceRefVerificationContext {
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

export interface EvidenceRefVerificationResult {
  total: number;
  verified: number;
  staticVerified: number;
  conversationOnly: boolean;
  hasStaticEvidence: boolean;
  entries: EvidenceRefVerificationEntry[];
}

// --- Agent Capability Profile ---

export interface AgentCapabilityProfile {
  can_read_files: boolean;
  can_search_files: boolean;
  can_run_commands: boolean;
  can_inspect_diff: boolean;
  can_request_context: boolean;
  max_context_files?: number;
  max_command_count?: number;
}

export interface AgentCapabilityProfileContractInput {
  task: CompileTaskInput;
  artifactPath: string;
}

export interface AgentCapabilityProfileContractOutput {
  profilePrompt: string;
  profileSchema: string;
  profileArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface AgentCapabilityProfileValidationResult {
  profile: AgentCapabilityProfile | null;
  diagnostics: ContractPayloadDiagnostics;
}

// --- Context Acquisition ---

export interface ContextAcquisitionContractInput {
  task: CompileTaskInput;
  artifactPath: string;
}

export interface ContextAcquisitionContractOutput {
  acquisitionPrompt: string;
  acquisitionSchema: string;
  acquisitionArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export type ContextAcquisitionMode = 'task-scoped' | 'changed-files' | 'full';

export interface ContextAcquisitionRequest {
  kind: 'rccl-incremental';
  mode: ContextAcquisitionMode;
  target_files: string[];
  changed_files: string[];
  scope?: string;
  reason: string;
  confidence: number;
  evidence_refs: EvidenceRef[];
}

export interface ContextAcquisitionPayload {
  requests: ContextAcquisitionRequest[];
}

export interface ContextAcquisitionValidationResult {
  requests: ContextAcquisitionRequest[];
  diagnostics: ContractPayloadDiagnostics;
}

// --- Task Model ---

export interface TaskModelScalarField<T extends string = string> {
  value?: T;
  confidence: number;
  evidence_refs: EvidenceRef[];
  alternatives?: T[];
  uncertainties?: string[];
}

export interface TaskModelListField<T extends string = string> {
  values: T[];
  confidence: number;
  evidence_refs: EvidenceRef[];
  alternatives?: T[][];
  uncertainties?: string[];
}

export interface TaskModelProposal {
  intent: {
    task_kind?: TaskModelScalarField<TaskKind>;
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

export interface TaskModelContractInput {
  task: CompileTaskInput;
  artifactPath: string;
}

export interface TaskModelContractOutput {
  task: CompileTaskInput;
  taskModelPrompt: string;
  taskModelSchema: string;
  ambiguityHints: string[];
  modelArtifact: AIContractArtifact;
  clarificationHints: string[];
  contract: AIContractEnvelope;
}

export interface TaskModelValidationResult {
  models: TaskModelProposal[];
  diagnostics: ContractPayloadDiagnostics;
}

// --- Semantic Governance Graph ---

export type SemanticGovernanceNodeKind = 'directive' | 'observation' | 'task-context' | 'feedback';
export type SemanticGovernanceExecutionIntent = ExecutionMode | 'no-change';

export interface SemanticGovernanceGraphNode {
  id: string;
  kind: SemanticGovernanceNodeKind;
}

export interface SemanticGovernanceGraphEdge {
  directive_id: string;
  observation_id: string;
  relation: SemanticRelationKindIR;
  confidence: number;
  reason: string;
  evidence_refs: EvidenceRef[];
  execution_intent?: SemanticGovernanceExecutionIntent;
  impact?: SemanticRelationImpactIR;
  review_priority?: SemanticRelationReviewPriorityIR;
  conflict_class?: 'compatibility-boundary' | 'migration-tension' | 'local-deviation' | 'legacy-interface' | 'anti-pattern' | 'scope-mismatch' | 'style-drift' | 'architecture-drift';
  merge_intent?: string;
  group_id?: string;
}

export interface SemanticGovernanceGraphPayload {
  nodes?: SemanticGovernanceGraphNode[];
  edges: SemanticGovernanceGraphEdge[];
}

export interface SemanticProposalDirectiveSummary {
  id: string;
  semanticKey: string;
  kind: string;
  prescription: string;
  weight: string;
  layer: string;
  scope: string;
  description: string;
  rationale: string;
  traits: unknown;
}

export interface SemanticProposalObservationSummary {
  id: string;
  semanticKey: string;
  category: string;
  scope: string;
  pattern: string;
  adherence: unknown;
  verification: unknown;
  lifecycle: unknown;
  traits: unknown;
  evidenceRefs: string[];
  evidence: Array<{
    file: string;
    line_range: [number, number];
    snippet: string;
  }>;
}

export interface SemanticGovernanceGraphContractInput {
  resolvedTask: import('../types.ts').ResolvedTaskOutput;
  directives: SemanticProposalDirectiveSummary[];
  observations: SemanticProposalObservationSummary[];
  artifactPath: string;
}

export interface SemanticContractContextInput {
  compileInput: import('../types.ts').CompileInput;
}

export interface SemanticContractContextOutput {
  resolvedTask: import('../types.ts').ResolvedTaskOutput;
  directives: SemanticProposalDirectiveSummary[];
  observations: SemanticProposalObservationSummary[];
  loadedSources?: import('../load/compile-sources.ts').CompileSources;
}

export interface SemanticGovernanceGraphContractBundleInput extends SemanticContractContextInput {
  artifactPath: string;
}

export interface SemanticGovernanceGraphContractOutput {
  graphPrompt: string;
  graphSchema: string;
  graphArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface SemanticGovernanceGraphContractBundleOutput extends SemanticContractContextOutput, SemanticGovernanceGraphContractOutput {}

export interface SemanticGovernanceGraphValidationInput {
  raw: unknown;
  source: HostProposalSourceInput;
  allowedDirectiveIds?: readonly string[];
  allowedObservationIds?: readonly string[];
  evidenceContext?: EvidenceRefVerificationContext;
}

export interface SemanticGovernanceGraphValidationResult {
  proposal: import('../ir/types.ts').HostProposalIR;
  diagnostics: ContractPayloadDiagnostics;
}

// --- Adherence Evidence ---

export type AdherenceEvidenceVerdict = 'followed' | 'ignored' | 'partial' | 'unverified';

export interface AdherenceEvidenceDirectiveSummary {
  id: string;
  description: string;
  prescription: string;
  execution_mode: string;
}

export interface AdherenceEvidenceContractInput {
  directives: AdherenceEvidenceDirectiveSummary[];
  taskDescription: string;
  artifactPath: string;
}

export interface AdherenceEvidenceContractOutput {
  evidencePrompt: string;
  evidenceSchema: string;
  evidenceArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface HostAdherenceEvidenceEntry {
  directive_id: string;
  verdict: AdherenceEvidenceVerdict;
  confidence: number;
  evidence_refs: EvidenceRef[];
  reason: string;
  ignored_reason?: IgnoredReason;
}

export interface HostAdherenceEvidencePayload {
  verdicts: HostAdherenceEvidenceEntry[];
}

export interface ValidatedAdherenceEvidenceVerdict extends HostAdherenceEvidenceEntry {}

export interface AdherenceEvidenceValidationResult {
  verdicts: ValidatedAdherenceEvidenceVerdict[];
  diagnostics: ContractPayloadDiagnostics;
}

// --- Governance Evolution ---

export interface GovernanceEvolutionProposal {
  proposals: Array<{
    kind: 'local-override' | 'local-suppress' | 'local-addition' | 'rccl-refresh';
    target_id?: string;
    reason: string;
    evidence_refs: EvidenceRef[];
    confidence: number;
  }>;
}

export interface GovernanceEvolutionProposalContractInput {
  lockfilePath?: string;
  lockfileSummary?: unknown;
  artifactPath?: string;
}

export interface GovernanceEvolutionProposalContractOutput {
  proposalPrompt: string;
  proposalSchema: string;
  proposalArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
  lockfileSummary: unknown;
  reviewGroups: Array<{
    group: 'playbook-candidate' | 'rccl-candidate' | 'no-action';
    proposalKinds: GovernanceEvolutionProposal['proposals'][number]['kind'][];
    reviewRule: string;
  }>;
}
