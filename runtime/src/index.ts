/** resonant-code Runtime public change-harness boundary. */
export { compileChange } from './decision/compile-change.ts';
export { evaluateChange } from './evaluation/evaluate-change.ts';

export type {
  ChangeDecisionPacket,
  CompileChangeInput,
  CompileChangeOutput,
  DecisionDiagnostic,
  DecisionTension,
  EffectiveGuidance,
  GuidanceItem,
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
  EvaluationEvidenceRef,
  GuidanceEvidence,
  GuidanceEvaluation,
} from './evaluation/types.ts';
export type {
  GuidanceMode,
  NormalizedTaskContext,
  RiskLevel as TaskRiskLevel,
  ScopeLevel,
  TaskContextInput,
} from './task/types.ts';
