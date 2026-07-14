import { createHash } from 'node:crypto';
import { verifyEvidence } from './evidence.ts';
import type {
  RcclObservationProposal,
  RcclObservation,
} from './types.ts';

export function materializeVerifiedObservation(
  proposal: RcclObservationProposal,
  projectRoot: string,
  gitRef: string | null,
  prior?: RcclObservation,
  now = new Date(),
): RcclObservation {
  const checkedAt = now.toISOString();
  const results = proposal.evidence.map((evidence) => verifyEvidence(evidence, projectRoot));
  const verifiedCount = results.filter((result) => result.status === 'match').length;
  const status = verifiedCount === proposal.evidence.length
    ? 'current'
    : verifiedCount > 0
      ? 'partial'
      : prior?.evidenceVerification.status === 'current' || prior?.evidenceVerification.status === 'partial'
        ? 'stale'
        : 'broken';
  const lifecycleStatus = status === 'stale' || status === 'broken' ? 'stale' : 'active';
  return {
    ...proposal,
    reviewStatus: proposal.reviewStatus ?? 'generated',
    evidenceVerification: {
      status,
      verifiedCount,
      totalCount: proposal.evidence.length,
      checkedAt,
    },
    lifecycle: {
      status: prior?.lifecycle.status === 'superseded' ? 'superseded' : lifecycleStatus,
      contentFingerprint: observationFingerprint(proposal),
      firstSeenGitRef: prior?.lifecycle.firstSeenGitRef ?? gitRef,
      lastSeenGitRef: gitRef,
      lastVerifiedAt: checkedAt,
      ...(prior?.lifecycle.supersededBy ? { supersededBy: prior.lifecycle.supersededBy } : {}),
    },
  };
}

export function refreshObservationEvidence(
  observation: RcclObservation,
  projectRoot: string,
  gitRef: string | null,
  now = new Date(),
): RcclObservation {
  return materializeVerifiedObservation(observation, projectRoot, gitRef, observation, now);
}

export function observationFingerprint(observation: RcclObservationProposal): string {
  return createHash('sha256').update(JSON.stringify({
    id: observation.id,
    category: observation.category,
    scope: observation.scope,
    statement: observation.statement,
    affects: observation.affects,
    decisionImpact: observation.decisionImpact,
    evidence: observation.evidence,
  })).digest('hex').slice(0, 16);
}
