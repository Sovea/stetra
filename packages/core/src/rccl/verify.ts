import { createHash } from 'node:crypto';
import { verifyEvidence } from './evidence.ts';
import type {
  RcclObservationContent,
  RcclObservation,
} from './types.ts';

export function materializeVerifiedObservation(
  content: RcclObservationContent,
  projectRoot: string,
  gitRef: string | null,
  prior?: RcclObservation,
  now = new Date(),
): RcclObservation {
  const checkedAt = now.toISOString();
  const results = content.evidence.map((evidence) => verifyEvidence(evidence, projectRoot));
  const verifiedCount = results.filter((result) => result.status === 'match').length;
  const status = verifiedCount === content.evidence.length
    ? 'current'
    : verifiedCount > 0
      ? 'partial'
      : prior?.evidenceVerification.status === 'current' || prior?.evidenceVerification.status === 'partial'
        ? 'stale'
        : 'broken';
  const lifecycleStatus = status === 'stale' || status === 'broken' ? 'stale' : 'active';
  const contentFingerprint = observationFingerprint(content);
  const approval = prior?.reviewStatus === 'reviewed'
    && prior.approval?.contentFingerprint === contentFingerprint
    && prior.lifecycle.contentFingerprint === contentFingerprint
    ? prior.approval
    : undefined;
  return {
    ...content,
    reviewStatus: approval ? 'reviewed' : 'generated',
    ...(approval ? { approval } : {}),
    evidenceVerification: {
      status,
      verifiedCount,
      totalCount: content.evidence.length,
      checkedAt,
    },
    lifecycle: {
      status: prior?.lifecycle.status === 'superseded' ? 'superseded' : lifecycleStatus,
      contentFingerprint,
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
  return materializeVerifiedObservation(observationContent(observation), projectRoot, gitRef, observation, now);
}

export function observationFingerprint(observation: RcclObservationContent): string {
  return createHash('sha256').update(JSON.stringify({
    id: observation.id,
    category: observation.category,
    scope: observation.scope,
    statement: observation.statement,
    affects: observation.affects,
    decisionImpact: observation.decisionImpact,
    semanticConfidence: observation.semanticConfidence,
    evidence: observation.evidence,
  })).digest('hex');
}

export function observationContent(observation: RcclObservation): RcclObservationContent {
  return {
    id: observation.id,
    category: observation.category,
    scope: observation.scope,
    statement: observation.statement,
    affects: observation.affects,
    decisionImpact: observation.decisionImpact,
    semanticConfidence: observation.semanticConfidence,
    evidence: observation.evidence,
  };
}
