/**
 * Public resonant-code hard-kernel boundary.
 *
 * RCCL lifecycle operations are intentionally available only from
 * `@sovea/resonant-code-core/rccl`.
 */
export { compileChange, evaluateChange } from './runtime/index.ts';

export type {
  AlignmentRequest,
  AttestationPlan,
  ChangeDecisionPacket,
  ChangeEvaluation,
  ChangeException,
  ChangeSet,
  ChangedFile,
  CheckResult,
  CompileChangeInput,
  CompileChangeOutput,
  DecisionDiagnostic,
  DecisionTension,
  DirectiveActivationSummary,
  EffectiveGuidance,
  EvaluateChangeInput,
  EvaluationActionRequired,
  EvaluationEvidenceRef,
  EvaluationInformation,
  ExecutionAvoidGuidanceItem,
  ExecutionGuidance,
  ExecutionGuidanceItem,
  FileFact,
  GuidanceAttestation,
  GuidanceDeliverySelection,
  GuidanceDetail,
  GuidanceEvaluation,
  GuidanceItem,
  GuidanceOverflow,
  MachineFactProvenance,
  NormalizedTaskContext,
  RelationProposal,
  ScopeLevel,
  TaskContextInput,
  TaskRiskLevel,
  VerificationPlan,
  VerificationRequirement,
} from './runtime/index.ts';
