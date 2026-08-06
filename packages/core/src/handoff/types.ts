import type { RepositoryEvidence } from '../authority/types.ts';
import type { ClaimDimension } from '../assurance/types.ts';
import type { SemanticContract, VerifierRefRole } from '../delegation/types.ts';
import type { FactBundle } from '../facts/types.ts';
import type { ProtocolEnvelope, ValidationIssue } from '../shared/protocol.ts';

export type { ClaimDimension } from '../assurance/types.ts';

export type ClaimBasis =
  | 'repository-evidence'
  | 'agent-judgment'
  | 'human-decision'
  | 'unverified';

export interface HandoffEvidenceSelection {
  changedFiles?: string[];
  checks?: string[];
  repositoryEvidence?: string[];
  humanEvents?: string[];
  patch?: boolean;
}

export type FalsificationStatus = 'supported' | 'contradicted' | 'partial' | 'unverified';

export interface ClaimFalsification {
  failureHypothesis: string;
  attempt: string;
  status: FalsificationStatus;
  supportingEvidence: HandoffEvidenceSelection;
  counterEvidence: HandoffEvidenceSelection;
  conclusion: string;
}

export interface MaterialClaim {
  id: string;
  dimension: ClaimDimension;
  statement: string;
  adoptionConsequence: string;
  adoptionCritical: boolean;
  basis: ClaimBasis;
  evidence: HandoffEvidenceSelection;
  falsification?: ClaimFalsification;
}

export interface ResidualUnknown {
  id: string;
  statement: string;
  adoptionImpact: string;
  validationPath: string;
  references: {
    claims: string[];
    changedFiles: string[];
  };
}

export type ReviewPriority =
  | 'must-read'
  | 'useful-to-sample'
  | 'mechanically-covered'
  | 'unresolved';

export interface ReviewMapEntry {
  id: string;
  priority: ReviewPriority;
  changedFiles: string[];
  checkIds: string[];
  claimIds: string[];
  unknownIds: string[];
  rationale: string;
  prevents: string;
}

export interface MaterialAlternative {
  id: string;
  description: string;
  tradeoff: string;
  reasonNotChosen: string;
  humanEventIds: string[];
}

export interface CognitiveHandoff extends ProtocolEnvelope {
  systemMeaningUpdate: string;
  materialClaims: MaterialClaim[];
  residualUnknowns: ResidualUnknown[];
  reviewMap: ReviewMapEntry[];
  materialAlternatives?: MaterialAlternative[];
  repositoryEvidence?: RepositoryEvidence[];
}

export interface EvaluateHandoffInput extends ProtocolEnvelope {
  contract: SemanticContract;
  factBundle: FactBundle;
  currentWorktreeFingerprint: string;
  handoff: CognitiveHandoff;
}

export type HandoffStatus = 'handoff-ready' | 'needs-attention' | 'rejected' | 'facts-stale';

export type AttentionResolutionKind =
  | 'recollect'
  | 'repair-or-revise'
  | 'supply-evidence'
  | 'direct-review'
  | 'execute-validation';

export type HandoffAttentionCode =
  | 'facts-stale'
  | 'check-failed'
  | 'check-unavailable'
  | 'verifier-surface-changed'
  | 'change-unrepresentable'
  | 'critical-claim-contradicted'
  | 'critical-claim-partial'
  | 'critical-claim-unverified'
  | 'residual-unknown';

export interface HandoffAttentionReferences {
  changedFiles?: string[];
  checks?: string[];
  claims?: string[];
  unknowns?: string[];
  repositoryEvidence?: string[];
  humanEvents?: string[];
  patch?: boolean;
}

interface HandoffAttentionBase {
  references: HandoffAttentionReferences;
  resolution: {
    kind: AttentionResolutionKind;
  };
}

export type HandoffAttentionItem = HandoffAttentionBase & (
  | { code: 'facts-stale' }
  | {
      code: 'check-failed';
      checkId: string;
    }
  | {
      code: 'check-unavailable';
      checkId: string;
      reason?: string;
    }
  | {
      code: 'verifier-surface-changed';
      path: string;
      role: VerifierRefRole;
      checkIds: string[];
    }
  | {
      code: 'change-unrepresentable';
      path: string;
    }
  | {
      code: 'critical-claim-contradicted';
      claimId: string;
      falsification: 'contradicted';
    }
  | {
      code: 'critical-claim-partial';
      claimId: string;
      falsification: 'partial';
    }
  | {
      code: 'critical-claim-unverified';
      claimId: string;
      falsification: 'unverified';
    }
  | {
      code: 'residual-unknown';
      unknownId: string;
    }
);

export interface HandoffEvaluation extends ProtocolEnvelope {
  status: HandoffStatus;
  contractId: string;
  factCollectionId: string;
  handoffFingerprint?: string;
  systemMeaningUpdate?: string;
  claimConclusions?: Array<{
    claimId: string;
    basis: ClaimBasis;
    adoptionCritical: boolean;
    falsification: FalsificationStatus | 'not-required';
  }>;
  attention: HandoffAttentionItem[];
  reviewMap?: ReviewMapEntry[];
  adoption: {
    authority: 'human';
    decisionRecorded: false;
  };
}

export interface HandoffValidationIssue extends ValidationIssue {
  remediation: string;
}

export class HandoffValidationError extends Error {
  readonly issues: HandoffValidationIssue[];

  constructor(issues: HandoffValidationIssue[]) {
    super(`Cognitive Handoff is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'HandoffValidationError';
    this.issues = issues;
  }
}
