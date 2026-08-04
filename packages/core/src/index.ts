/** Public deterministic Semantic Handoff kernel. */
export { compileDelegation } from './delegation/compile.ts';
export { evaluateHandoff } from './handoff/evaluate.ts';

export type {
  AgentInterpretation,
  HumanEvent,
  HumanEventKind,
  InterpretationBasis,
  InterpretationField,
  RepositoryEvidence,
} from './authority/types.ts';
export type {
  CompileDelegationInput,
  ConsequenceLevel,
  DelegationCompileResult,
  MaterialSemanticFork,
  SemanticContract,
  SemanticEnvelopeInput,
  VerificationDefinition,
  VerificationInput,
  VerificationSource,
  VerifierRef,
  VerifierRefRole,
} from './delegation/types.ts';
export type {
  ChangedFileFact,
  ChangeRepresentation,
  CheckFact,
  CheckStatus,
  CheckStreamFact,
  FactBundle,
  FileContentFact,
  FileKind,
  FileOperation,
  PatchFact,
  VerifierMutation,
  WorktreeSummary,
} from './facts/types.ts';
export type {
  AttentionResolutionKind,
  ClaimBasis,
  ClaimFalsification,
  ClaimDimension,
  CognitiveHandoff,
  EvaluateHandoffInput,
  FalsificationStatus,
  HandoffAttentionItem,
  HandoffAttentionReferences,
  HandoffEvaluation,
  HandoffEvidenceSelection,
  HandoffStatus,
  HandoffValidationIssue,
  MaterialAlternative,
  MaterialClaim,
  ResidualUnknown,
  ReviewMapEntry,
  ReviewPriority,
} from './handoff/types.ts';
