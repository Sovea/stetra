export { compile, resolveTask } from './compile.ts';
export { evaluateGuidance } from './feedback.ts';
export { inspectCompileCache, persistCompileCache } from './cache.ts';
export { resolveContractPolicy } from './contract-policy.ts';
export { planGuidance, resolveSourceStatus } from './plan-guidance.ts';
export {
  prepareAgentCapabilityProfileContract,
  validateAgentCapabilityProfilePayload,
} from './ai-contracts/agent-capability-profile.ts';
export {
  prepareContextAcquisitionContract,
  validateContextAcquisitionPayload,
} from './ai-contracts/context-acquisition.ts';
export { verifyEvidenceRefs } from './ai-contracts/evidence.ts';
export {
  prepareTaskModelContract,
  validateTaskModelPayload,
} from './ai-contracts/task-model.ts';
export {
  prepareSemanticContractContext,
  prepareSemanticGovernanceGraphContract,
  prepareSemanticGovernanceGraphContractBundle,
  validateSemanticGovernanceGraphPayload,
  loadSemanticGovernanceGraphPayload,
} from './ai-contracts/semantic-governance-graph.ts';
export {
  prepareAdherenceEvidenceContract,
  validateAdherenceEvidencePayload,
} from './ai-contracts/adherence-evidence.ts';
export {
  prepareGovernanceEvolutionProposalContract,
  validateGovernanceEvolutionProposalPayload,
} from './ai-contracts/governance-evolution-proposal.ts';
export { resolveActivationDecisionsIR, activatedDirectiveIdsIR } from './ir/activation/resolve-activation.ts';
export { buildGovernanceIR } from './ir/build-ir.ts';
export { resolveExecutionDecisionsIR } from './ir/execution/resolve-execution.ts';
export { buildSemanticRelationsIR } from './ir/relations/build-relations.ts';
export { adjudicateSemanticRelations } from './ir/relations/adjudicate-relations.ts';
export { semanticRelationIRToPublic, semanticRelationsIRToPublic } from './ir/relations/public-mapping.ts';
export { proposeSemanticRelations } from './ir/relations/propose-relations.ts';
export { DeterministicInterpretationProvider } from './interpret/deterministic-extractor.ts';
export { resolveTaskInput } from './interpret/normalize-candidate.ts';
export {
  TASK_INPUT_ENUMS,
  TASK_INTERPRETATION_ENUMS,
  TASK_INTERPRETATION_SOURCES,
} from './intent/schema.ts';
export { GOVERNANCE_IR_VERSION } from './ir/types.ts';
export { AI_CONTRACT_VERSION } from './ai-contracts/types.ts';
export { LOCKFILE_VERSION } from './types.ts';
export type { TaskInterpretationProvider } from './interpret/provider.ts';
export type * from './ai-contracts/types.ts';
export type {
  ActivationDecisionIR,
  DirectiveFeedbackSignalIR,
  DirectiveIR,
  DirectiveLocalStateIR,
  DirectivePriorityIR,
  DirectiveTraitsIR,
  ExecutionDecisionIR,
  FeedbackIR,
  FieldProvenanceIR,
  GovernanceIRBundle,
  GovernanceIRVersion,
  HostProposalIR,
  IRFingerprintSet,
  LayerIR,
  ObservationIR,
  ObservationTraitsIR,
  ScopeIR,
  SemanticRelationIR,
  SourceManifestIR,
  SourceRefIR,
  TargetIR,
  TaskIR,
} from './ir/types.ts';
export type {
  CandidateField,
  CandidateListField,
  DiscardedInterpretationInput,
  InputProvenance,
  InterpretationConflict,
  ParsedTaskCandidate,
  ResolvedField,
  ResolvedTaskInput,
  RuntimeDiagnostics,
  TaskInterpretationTrace,
} from './interpret/types.ts';
export type {
  ChangeDecisionPacket,
  CompileInput,
  CompileOutput,
  CompileTaskInput,
  CompatibilityRequirement,
  CompleteCodeTaskResult,
  ContractPolicyDecision,
  ContractPolicyKind,
  ContractPolicySkippedContract,
  ContractPolicySkippedReason,
  ContextProfile,
  DecisionTrace,
  EffectiveGuidanceObject,
  EvaluateInput,
  FeedbackSignalConfidence,
  GuidancePlan,
  GuidancePlanArtifactPaths,
  GuidancePlanInput,
  GuidancePlanProvidedContracts,
  GuidancePlanSourceStatus,
  GovernancePacket,
  IgnoredReason,
  InterpretationPacket,
  InterfaceSensitivity,
  MigrationPhase,
  Operation,
  PrepareCodeTaskInput,
  PrepareCodeTaskResult,
  RefactorTolerance,
  PrepareInterpretationOutput,
  ResolveTaskRequest,
  ResolveTaskResult,
  ResolvedTaskOutput,
  ReviewTaskInput,
  ReviewGoal,
  RiskLevel,
  RuntimeSessionRecord,
  RuntimeContractRequest,
  ScopeSize,
  SemanticMergeResult,
  TaskIntent,
  TaskKind,
  RuntimeRcclVerificationPolicy,
  RuntimeRcclVerificationSummary,
} from './types.ts';
