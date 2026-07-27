/**
 * Public resonant-code hard-kernel boundary.
 *
 * RCCL lifecycle operations are intentionally available only from
 * `@sovea/resonant-code-core/rccl`.
 */
export { compileChange, evaluateChange } from './runtime/index.ts';

export type {
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
  EffectiveGuidance,
  EvaluateChangeInput,
  EvaluationEvidenceRef,
  ExecutionAvoidGuidanceItem,
  ExecutionGuidance,
  ExecutionGuidanceItem,
  FileFact,
  GuidanceAttestation,
  GuidanceDeliverySelection,
  GuidanceDetail,
  GuidanceEvaluation,
  GuidanceItem,
  GuidanceMode,
  GuidanceOverflow,
  InterpretationRequest,
  MachineFactProvenance,
  NormalizedTaskContext,
  RelationProposal,
  ScopeLevel,
  TaskContextInput,
  TaskRiskLevel,
  VerificationPlan,
  VerificationRequirement,
} from './runtime/index.ts';
