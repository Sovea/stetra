/** resonant-code Runtime public change-harness boundary. */
export { compileChange } from './decision/compile-change.ts';
export { evaluateChange } from './evaluation/evaluate-change.ts';

export type {
  AttestationPlan,
  ChangeDecisionPacket,
  CompileChangeInput,
  CompileChangeOutput,
  DecisionDiagnostic,
  DecisionTension,
  DirectiveActivationSummary,
  EffectiveGuidance,
  ExecutionAvoidGuidanceItem,
  ExecutionGuidance,
  ExecutionGuidanceItem,
  GuidanceDeliverySelection,
  GuidanceDetail,
  GuidanceItem,
  GuidanceOverflow,
  InterpretationRequest,
  RelationProposal,
  VerificationPlan,
  VerificationRequirement,
} from './decision/types.ts';
export type {
  ChangeEvaluation,
  ChangeException,
  ChangedFile,
  ChangeSet,
  CheckResult,
  EvaluateChangeInput,
  EvaluationActionRequired,
  EvaluationEvidenceRef,
  EvaluationInformation,
  FileFact,
  GuidanceAttestation,
  GuidanceEvaluation,
  MachineFactProvenance,
} from './evaluation/types.ts';
export type {
  GuidanceMode,
  NormalizedTaskContext,
  RiskLevel as TaskRiskLevel,
  ScopeLevel,
  TaskContextInput,
} from './task/types.ts';
