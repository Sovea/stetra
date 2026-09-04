import type { HumanEvent } from '../authority/types.ts';
import type { AdoptionConcern, TaskContract } from '../delegation/types.ts';
import type { FactBundle } from '../facts/types.ts';
import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type ConclusionStatus = 'supported' | 'partial' | 'contradicted' | 'unknown';
export type RecommendationAction = 'accept' | 'request-correction' | 'reject' | 'defer';
export type HumanDecisionAction = 'accepted' | 'correction-requested' | 'rejected' | 'deferred';
export type HandoffStatus = 'handoff-ready' | 'needs-attention' | 'facts-stale';

export type HandoffEvidenceReference =
  | { kind: 'changed-file'; id: string }
  | { kind: 'check'; id: string }
  | { kind: 'patch' };

export interface ConcernFinding {
  concernId: string;
  status: ConclusionStatus;
  summary: string;
  evidence: HandoffEvidenceReference[];
  gaps: string[];
}

export interface ResidualUnknown {
  statement: string;
  nextAction?: string;
  evidence: HandoffEvidenceReference[];
}

export interface ReviewFocus {
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
  concernFindings: ConcernFinding[];
  residualUnknowns: ResidualUnknown[];
  reviewFocus: ReviewFocus[];
  recommendation: AgentRecommendation;
}

export type HandoffAttentionCode =
  | 'verification-nonpassing'
  | 'verifier-surface-changed'
  | 'check-induced-change'
  | 'change-unrepresentable'
  | 'residual-unknown'
  | 'concern-evidence-missing'
  | 'concern-not-supported';

export interface HandoffAttentionItem {
  id: string;
  code: HandoffAttentionCode;
  message: string;
  blockingRecommendation: boolean;
  references: {
    changedFileIds?: string[];
    definitionIds?: string[];
    concernIds?: string[];
  };
  resolution: 'repair' | 'inspect' | 'human-review' | 'acknowledge';
}

export interface HumanDecision extends ProtocolEnvelope {
  decisionId: string;
  humanEvent: HumanEvent;
  action: HumanDecisionAction;
  reason: string;
  acknowledgedAttentionIds: string[];
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  handoffId: string;
  handoffFingerprint: string;
}

export interface EvaluateHandoffInput extends ProtocolEnvelope {
  contract: TaskContract;
  factBundle: FactBundle;
  currentWorktreeFingerprint: string;
  handoff: CognitiveHandoff;
  decision?: HumanDecision;
}

export interface HandoffEvaluation extends ProtocolEnvelope {
  status: HandoffStatus;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  attention: HandoffAttentionItem[];
  concernEvidence: Array<{
    concernId: string;
    complete: boolean;
    missing: AdoptionConcern['evidenceRequirements'];
  }>;
  adoption: {
    authority: 'human';
    status: 'pending' | HumanDecisionAction;
    decisionId?: string;
  };
}

export interface DecisionPacket extends ProtocolEnvelope {
  task: {
    contractId: string;
    effectiveContractId: string;
    humanEvents: TaskContract['humanEvents'];
    intendedOutcome: string;
    constraints: string[];
    nonGoals: string[];
  };
  state: {
    delivery: 'implemented';
    evidence: HandoffStatus;
    recommendation: RecommendationAction;
    adoption: HandoffEvaluation['adoption'];
  };
  actualChange: CognitiveHandoff['actualChange'];
  concernFindings: Array<{
    concern: AdoptionConcern;
    finding: ConcernFinding;
    evidenceComplete: boolean;
  }>;
  residualUnknowns: ResidualUnknown[];
  reviewFocus: ReviewFocus[];
  attention: HandoffAttentionItem[];
  recommendation: AgentRecommendation;
  runtimeFacts: {
    attemptId: string;
    factCollectionId: string;
    changeFingerprint: string;
    changedFiles: Array<Pick<FactBundle['changedFiles'][number],
      'id' | 'path' | 'previousPath' | 'operation' | 'representation'>>;
    checks: Array<{
      verifierId: string;
      definitionId: string;
      argv: string[];
      latestAttempt: FactBundle['checks'][number]['attempts'][number];
      attemptCount: number;
    }>;
    verifierMutations: FactBundle['verifierMutations'];
    checkInducedChanges: Array<Pick<FactBundle['checkInducedChanges'][number],
      'id' | 'path' | 'operation'>>;
  };
  humanDecision?: HumanDecision;
  detailSections: Array<
    'contract' | 'baseline' | 'collections' | 'collection' | 'check' | 'log'
    | 'handoff' | 'decision' | 'events'
  >;
}

export interface HandoffValidationIssue {
  code: string;
  path: string;
  message: string;
  remediation: string;
}

export class HandoffValidationError extends Error {
  readonly issues: HandoffValidationIssue[];

  constructor(issues: HandoffValidationIssue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join('; '));
    this.name = 'HandoffValidationError';
    this.issues = issues;
  }
}
