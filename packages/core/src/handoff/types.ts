import type { HumanEvent } from '../authority/types.ts';
import type { IndependentChallenge } from '../challenge/types.ts';
import type { TaskContract } from '../delegation/types.ts';
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
  | 'challenge'
  | 'patch';

export interface HandoffEvidenceReference {
  kind: HandoffEvidenceKind;
  id?: string;
}

export interface EvidenceObligationConclusion {
  obligationId: string;
  status: ConclusionStatus;
  evidence: HandoffEvidenceReference[];
  falsificationAttempt: string;
  counterEvidence: HandoffEvidenceReference[];
  conclusion: string;
}

export interface AdoptionConditionConclusion {
  conditionId: string;
  status: ConclusionStatus;
  summary: string;
}

export interface ResidualUnknown {
  conditionIds: string[];
  obligationIds: string[];
  statement: string;
  adoptionImpact: string;
  nextAction: string;
  evidence: HandoffEvidenceReference[];
}

export interface ReviewQuestion {
  id: string;
  conditionIds: string[];
  obligationIds: string[];
  question: string;
  adoptionImpact: string;
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
  summary: string;
  obligationConclusions: EvidenceObligationConclusion[];
  conditionConclusions: AdoptionConditionConclusion[];
  importantSystemEffects: string[];
  residualUnknowns: ResidualUnknown[];
  reviewQuestions: ReviewQuestion[];
  recommendation: AgentRecommendation;
}

export interface HumanDecisionException {
  attentionId: string;
  rationale: string;
}

export interface HumanDecision extends ProtocolEnvelope {
  decisionId: string;
  humanEvent: HumanEvent;
  action: HumanDecisionAction;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  handoffId: string;
  handoffFingerprint: string;
  reason: string;
  exceptions: HumanDecisionException[];
}

export type HandoffAttentionCode =
  | 'verification-nonpassing'
  | 'baseline-observation-different'
  | 'baseline-unknown-after-revision'
  | 'verifier-surface-changed'
  | 'verification-revised'
  | 'check-induced-change'
  | 'baseline-check-induced-change'
  | 'change-unrepresentable'
  | 'obligation-not-supported'
  | 'condition-not-supported'
  | 'challenge-missing'
  | 'challenge-adverse'
  | 'challenge-independence-unverified'
  | 'direct-review-required'
  | 'residual-unknown'
  | 'host-policy-unverified'
  | 'host-policy-unsupported'
  | 'evidence-disposition-unresolved'
  | 'evidence-disposition-missing'
  | 'repair-route-exhausted';

export interface HandoffAttentionReferences {
  changedFiles?: string[];
  checks?: string[];
  conditions?: string[];
  obligations?: string[];
  challenges?: string[];
  hostPolicies?: string[];
}

export interface HandoffAttentionItem {
  id: string;
  group: 'verification' | 'change-integrity' | 'obligation' | 'condition' | 'delivery' | 'host-policy';
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
}

export interface HostPolicyEvaluation {
  requirementId: string;
  mode: 'enforced' | 'instruction-only' | 'unsupported';
  provenance: 'native-adapter' | 'thin-skill' | 'evaluation-runner';
  attestationId?: string;
}

export interface EvaluateHandoffInput extends ProtocolEnvelope {
  contract: TaskContract;
  factBundle: FactBundle;
  currentWorktreeFingerprint: string;
  challenges: IndependentChallenge[];
  evidenceDispositions: EvidenceDisposition[];
  hostPolicyEvaluations: HostPolicyEvaluation[];
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
  attention: HandoffAttentionItem[];
  adoption: {
    authority: 'human';
    status: 'pending' | HumanDecisionAction;
    decisionId?: string;
  };
}

export interface DecisionReviewLayers {
  decision: {
    desiredOutcome: string;
    recommendation: AgentRecommendation;
    conditionStatuses: Array<{ conditionId: string; status: ConclusionStatus }>;
    attentionIds: string[];
  };
  conditions: Array<{
    condition: TaskContract['adoptionConditions'][number];
    conclusion: AdoptionConditionConclusion;
    obligations: Array<{
      obligation: TaskContract['adoptionConditions'][number]['evidenceObligations'][number];
      conclusion: EvidenceObligationConclusion;
      challenges: IndependentChallenge[];
    }>;
    reviewQuestions: ReviewQuestion[];
  }>;
  facts: {
    changedFiles: FactBundle['changedFiles'];
    checks: FactBundle['checks'];
    checkComparisons: FactBundle['checkComparisons'];
    verifierMutations: FactBundle['verifierMutations'];
    checkInducedChanges: FactBundle['checkInducedChanges'];
    evidenceDispositions: EvidenceDisposition[];
  };
}

export interface DecisionPacket extends ProtocolEnvelope {
  authority: TaskContract['authority'];
  contract: TaskContract;
  facts: FactBundle;
  evidenceDispositions: EvidenceDisposition[];
  challenges: IndependentChallenge[];
  handoff: CognitiveHandoff;
  evaluation: HandoffEvaluation;
  review: DecisionReviewLayers;
  decision?: HumanDecision;
}

export class HandoffValidationError extends Error {
  readonly issues: HandoffValidationIssue[];

  constructor(issues: HandoffValidationIssue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join('; '));
    this.name = 'HandoffValidationError';
    this.issues = issues;
  }
}
