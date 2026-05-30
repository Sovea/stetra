import type { RcclObservation } from '../../types.ts';
import type { ObservationIR, ObservationTraitsIR } from '../types.ts';

export function observationsToIR(observations: RcclObservation[], rcclPath?: string): ObservationIR[] {
  return observations.map((observation) => ({
    irVersion: 'governance-ir/v1',
    id: observation.id,
    semanticKey: observation.semantic_key,
    source: {
      kind: 'rccl',
      id: observation.id,
      path: rcclPath,
      fingerprint: observation.lifecycle?.content_fingerprint,
    },
    category: observation.category,
    scope: { path: observation.scope },
    pattern: observation.pattern,
    adherence: {
      quality: observation.adherence_quality,
      confidence: observation.confidence,
    },
    evidence: observation.evidence,
    support: {
      sourceSlices: observation.support.source_slices,
      fileCount: observation.support.file_count,
      clusterCount: observation.support.cluster_count,
      scopeBasis: observation.support.scope_basis,
    },
    verification: {
      evidenceStatus: observation.verification.evidence_status ?? 'pending',
      evidenceVerifiedCount: observation.verification.evidence_verified_count ?? 0,
      evidenceConfidence: observation.verification.evidence_confidence ?? 0,
      inductionStatus: observation.verification.induction_status ?? 'pending',
      inductionConfidence: observation.verification.induction_confidence ?? 0,
      checkedAt: observation.verification.checked_at,
      disposition: observation.verification.disposition ?? 'demote-to-ambient',
    },
    lifecycle: {
      firstSeenGitRef: observation.lifecycle?.first_seen_git_ref ?? null,
      lastSeenGitRef: observation.lifecycle?.last_seen_git_ref ?? null,
      lastVerifiedAt: observation.lifecycle?.last_verified_at ?? null,
      contentFingerprint: observation.lifecycle?.content_fingerprint ?? null,
      status: observation.lifecycle?.status ?? 'unknown',
      supersedes: observation.lifecycle?.supersedes ?? [],
      supersededBy: observation.lifecycle?.superseded_by ?? null,
    },
    traits: buildTraits(observation),
  }));
}

function buildTraits(observation: RcclObservation): ObservationTraitsIR {
  const explicit = observation.traits ?? {};
  return {
    legacy: observation.category === 'legacy' || explicit.legacy === true,
    migrationBoundary: observation.category === 'migration' || explicit.migration_boundary === true,
    antiPattern: observation.category === 'anti-pattern' || explicit.anti_pattern === true,
    compatibilityBoundary: explicit.compatibility_boundary === true,
  };
}
