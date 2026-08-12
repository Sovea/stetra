import type { HandoffEvidenceReference } from '../handoff/types.ts';
import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type ChallengeOutcome = 'supported' | 'partial' | 'contradicted' | 'unknown';
export type ChallengeIndependence = 'host-attested' | 'host-claimed' | 'unverified';

export interface ChallengeEvidenceSelection {
  changedFiles: string[];
  checks: string[];
  repositoryEvidence: string[];
  humanEvents: string[];
  patch: boolean;
}

export interface ChallengeEvidenceItem {
  statement: string;
  references: HandoffEvidenceReference[];
}

export interface IndependentChallenge extends ProtocolEnvelope {
  id: string;
  effectiveContractId: string;
  attemptId: string;
  factCollectionId: string;
  obligationIds: string[];
  conditionIds: string[];
  independence: ChallengeIndependence;
  implementerContextId?: string;
  challengerContextId?: string;
  attestationId?: string;
  failureHypothesis: string;
  evidence: ChallengeEvidenceSelection;
  falsificationAttempt: string;
  supportingEvidence: ChallengeEvidenceItem[];
  counterEvidence: ChallengeEvidenceItem[];
  outcome: ChallengeOutcome;
  conclusion: string;
}
