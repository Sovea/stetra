import type { HumanEvent } from '../authority/types.ts';
import type { EvidenceObligation, TaskContract } from '../delegation/types.ts';
import type { EvidenceDisposition, FactBundle } from '../facts/types.ts';
import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type ConclusionStatus = 'supported' | 'partial' | 'contradicted' | 'unknown';
export type RecommendationAction = 'accept' | 'request-correction' | 'reject' | 'defer';
export type HumanDecisionAction = 'accepted' | 'correction-requested' | 'rejected' | 'deferred';
export type HandoffStatus = 'handoff-ready' | 'needs-attention' | 'facts-stale';

export type HandoffEvidenceKind =
  | 'changed-file'
  | 'check'
  | 'repository-evidence'
  | 'human-event'
  | 'patch';

export interface HandoffEvidenceReference {
  kind: HandoffEvidenceKind;
  id?: string;
}

export interface EvidenceCoverageAssessment {
  status: 'sufficient' | 'insufficient';
  rationale: string;
  gaps: string[];
}

export interface EvidenceObligationConclusion {
  obligationId: string;
  status: ConclusionStatus;
  reviewDecisionIds: string[];
  evidence: HandoffEvidenceReference[];
  evidenceCoverage: EvidenceCoverageAssessment;
  falsification: {
    attempt: string;
    observedResult: string;
  };
  counterEvidence: HandoffEvidenceReference[];
  conclusion: string;
}

export interface AdoptionConditionConclusion {
  conditionId: string;
  status: ConclusionStatus;
  summary: string;
  reviewDecisionIds: string[];
}

export interface ResidualUnknown {
  target:
    | { kind: 'task' }
    | { kind: 'condition'; conditionId: string }
    | { kind: 'obligation'; conditionId: string; obligationId: string };
  statement: string;
  evidence: HandoffEvidenceReference[];
  reviewDecisionIds: string[];
}

export interface ReviewDecision {
  id: string;
  conditionIds: string[];
  obligationIds: string[];
  question: string;
  adoptionImpact: string;
  nextAction: string;
  evidence: HandoffEvidenceReference[];
}

export interface AgentRecommendation {
  action: RecommendationAction;
  rationale: string;
  caveats: string[];
}

export interface CognitiveHandoff extends ProtocolEnvelope {
  handoffId: string;
  handoffFingerprint: string;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  actualChange: {
    behavior: string;
    mechanism: string[];
    preservedInvariants: string[];
    failureAndRecovery: string[];
    importantEffects: string[];
    materialTradeoffs: string[];
  };
  obligationConclusions: EvidenceObligationConclusion[];
  conditionConclusions: AdoptionConditionConclusion[];
  residualUnknowns: ResidualUnknown[];
  reviewDecisions: ReviewDecision[];
  recommendation: AgentRecommendation;
}

export interface HumanDecisionException {
  attentionId: string;
  rationale: string;
}

export interface HumanDecision extends ProtocolEnvelope {
  decisionId: string;
  humanEvent: HumanEvent;
  interpretation: {
    basisHumanEventId: string;
    action: HumanDecisionAction;
    reason: string;
    exceptions: HumanDecisionException[];
  };
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  handoffId: string;
  handoffFingerprint: string;
}

export interface HumanResolution extends ProtocolEnvelope {
  resolutionId: string;
  effectiveContractId: string;
  humanEvent: HumanEvent;
  interpretation: {
    basisHumanEventId: string;
    target:
      | { kind: 'semantic-impact'; dispositionId: string }
      | { kind: 'correction'; decisionId: string }
      | { kind: 'host-policy'; requirementIds: string[] };
    action: 'continue-current-contract' | 'request-correction' | 'abort';
    reason: string;
  };
}

export type HandoffAttentionCode =
  | 'verification-nonpassing'
  | 'baseline-expectation-mismatch'
  | 'baseline-unknown-after-revision'
  | 'verifier-surface-changed'
  | 'verification-revised'
  | 'check-induced-change'
  | 'baseline-check-induced-change'
  | 'change-unrepresentable'
  | 'challenge-missing'
  | 'evidence-coverage-insufficient'
  | 'residual-unknown'
  | 'host-policy-unverified'
  | 'evidence-disposition-missing'
  | 'repair-route-exhausted';

export interface HandoffAttentionReferences {
  changedFiles?: string[];
  checks?: string[];
  conditions?: string[];
  obligations?: string[];
  hostPolicies?: string[];
}

export interface HandoffAttentionItem {
  id: string;
  group: 'verification' | 'change-integrity' | 'challenge' | 'obligation' | 'condition' | 'delivery' | 'host-policy';
  codes: HandoffAttentionCode[];
  references: HandoffAttentionReferences;
  resolution: {
    kind: 'inspect' | 'repair' | 'challenge' | 'resolve' | 'decide-exception';
  };
}

export interface HandoffValidationIssue {
  code: string;
  path: string;
  message: string;
  remediation: string;
  references?: {
    conditionIds?: string[];
    obligationIds?: string[];
  };
}

export type EvidencePathStatus =
  | 'completed'
  | 'unavailable'
  | 'not-triggered';

export interface EvidencePathState {
  strategyIndex: number;
  kind: EvidenceObligation['strategies'][number]['kind'];
  status: EvidencePathStatus;
  reason:
    | 'current-check-observed'
    | 'check-unavailable'
    | 'repository-evidence-cited'
    | 'challenge-not-triggered'
    | 'challenge-unavailable';
  references: HandoffEvidenceReference[];
}

export interface ObligationEvidencePaths {
  obligationId: string;
  status: 'completed' | 'unavailable';
  strategies: EvidencePathState[];
}

export interface EvaluateHandoffInput extends ProtocolEnvelope {
  contract: TaskContract;
  factBundle: FactBundle;
  currentWorktreeFingerprint: string;
  currentEvidenceDisposition?: EvidenceDisposition;
  deliveryExhausted: boolean;
  verificationRevised: boolean;
  handoff: CognitiveHandoff;
  decision?: HumanDecision;
}

export interface HandoffEvaluation extends ProtocolEnvelope {
  status: HandoffStatus;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  requiredChallengeObligationIds: string[];
  evidencePaths: ObligationEvidencePaths[];
  attention: HandoffAttentionItem[];
  adoption: {
    authority: 'human';
    status: 'pending' | HumanDecisionAction;
    decisionId?: string;
  };
}

export interface DecisionPacket extends ProtocolEnvelope {
  humanEvents: TaskContract['humanEvents'];
  semanticContract: {
    semanticContractId: string;
    effectiveContractId: string;
    desiredOutcome: string;
    constraints: string[];
    nonGoals: string[];
    focusPaths: string[];
  };
  decision: {
    recommendation: AgentRecommendation;
    adoption: HandoffEvaluation['adoption'];
    humanDecision?: HumanDecision;
    resolutions: HumanResolution[];
  };
  actualChange: CognitiveHandoff['actualChange'];
  residualUnknowns: ResidualUnknown[];
  conditions: Array<{
    id: string;
    key: string;
    statement: string;
    criticality: 'material' | 'adoption-critical';
    agentFinding: AdoptionConditionConclusion;
    obligations: Array<{
      id: string;
      key: string;
      statement: string;
      falsification: EvidenceObligation['falsification'];
      agentFinding: EvidenceObligationConclusion;
      evidencePath: ObligationEvidencePaths;
    }>;
  }>;
  attention: HandoffAttentionItem[];
  reviewDecisions: ReviewDecision[];
  runtimeFacts: {
    attemptId: string;
    factCollectionId: string;
    changeFingerprint: string;
    changedFiles: Array<Pick<FactBundle['changedFiles'][number], 'id' | 'path' | 'previousPath' | 'operation' | 'representation'>>;
    checks: Array<{
      verifierId: string;
      definitionId: string;
      argv: string[];
      latestAttempt: FactBundle['checks'][number]['attempts'][number];
      attemptCount: number;
      baselineRelation: FactBundle['checkComparisons'][number]['relation'];
    }>;
    verifierMutations: FactBundle['verifierMutations'];
    checkInducedChanges: Array<Pick<FactBundle['checkInducedChanges'][number], 'id' | 'path' | 'operation'>>;
  };
  evidenceJudgments: {
    dispositions: Array<Pick<EvidenceDisposition,
      'dispositionId' | 'attemptId' | 'semanticImpact' | 'proposedRoute' | 'routeRationale' | 'route' | 'entries'>>;
  };
  detailSections: Array<'contract' | 'attempts' | 'handoff' | 'events'>;
}

export class HandoffValidationError extends Error {
  readonly issues: HandoffValidationIssue[];

  constructor(issues: HandoffValidationIssue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join('; '));
    this.name = 'HandoffValidationError';
    this.issues = issues;
  }
}
