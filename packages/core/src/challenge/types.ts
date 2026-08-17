import type { HandoffEvidenceReference } from '../handoff/types.ts';
import type { EvidenceObligationFalsification } from '../delegation/types.ts';
import type { ProtocolEnvelope } from '../shared/protocol.ts';

export type ChallengeOutcome = 'supported' | 'partial' | 'contradicted' | 'unknown';
export type ChallengeIndependence = 'host-attested' | 'unverified';

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
  falsification: EvidenceObligationFalsification;
  evidence: ChallengeEvidenceSelection;
  falsificationAttempt: string;
  observedResult: string;
  supportingEvidence: ChallengeEvidenceItem[];
  counterEvidence: ChallengeEvidenceItem[];
  outcome: ChallengeOutcome;
  conclusion: string;
}
