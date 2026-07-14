/** Narrow integration surface consumed by the Runtime hard kernel. */
import { parseRcclDocument } from './parse.ts';
import { verifyEvidence } from './evidence.ts';
import type { RcclDocument, RcclObservation } from './types.ts';

export type {
  RcclDocument,
  RcclObservation,
} from './types.ts';

export function parseRccl(
  text: string,
): { valid: boolean; data?: RcclDocument; errors?: string[] } {
  const parsed = parseRcclDocument(text);
  if (!parsed.valid || !parsed.data) {
    return {
      valid: false,
      errors: parsed.diagnostics.map((diagnostic) =>
        `${diagnostic.path || 'document'}: ${diagnostic.code}: ${diagnostic.message}`),
    };
  }
  return { valid: true, data: parsed.data };
}

export function verifyObservationEvidence(
  observation: RcclObservation,
  projectRoot: string,
  checkedAt: string,
): RcclObservation {
  const verifiedCount = observation.evidence
    .map((evidence) => verifyEvidence(evidence, projectRoot))
    .filter((result) => result.status === 'match')
    .length;
  const priorCurrent = observation.evidenceVerification.status === 'current'
    || observation.evidenceVerification.status === 'partial';
  const status = verifiedCount === observation.evidence.length
    ? 'current'
    : verifiedCount > 0
      ? 'partial'
      : priorCurrent
        ? 'stale'
        : 'broken';
  return {
    ...observation,
    evidenceVerification: {
      status,
      verifiedCount,
      totalCount: observation.evidence.length,
      checkedAt,
    },
    lifecycle: {
      ...observation.lifecycle,
      status: observation.lifecycle.status === 'superseded'
        ? 'superseded'
        : status === 'stale' || status === 'broken'
          ? 'stale'
          : 'active',
      lastVerifiedAt: checkedAt,
    },
  };
}
