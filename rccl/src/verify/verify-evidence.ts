import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import type { RcclDocument, RcclEvidence, RcclObservation, VerificationDisposition, VerificationStatus, VerificationPolicy } from '../types.ts';
import { DEFAULT_VERIFICATION_POLICY } from '../policies.ts';

export function verifyEvidenceForDocument(
  rccl: RcclDocument,
  projectRoot: string,
  now = new Date(),
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): RcclDocument {
  return {
    ...rccl,
    observations: rccl.observations.map((observation) => verifyObservationEvidence(observation, projectRoot, now.toISOString(), policy)),
  };
}

export function verifyObservationEvidence(
  observation: RcclObservation,
  projectRoot: string,
  checkedAt: string,
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): RcclObservation {
  if (observation.evidence.length === 0) {
    return applyEvidenceVerification(observation, 'unverifiable', 0, 0, checkedAt, 'demote-to-ambient');
  }
  const results = observation.evidence.map((item) => verifyEvidence(item, projectRoot, policy));
  const verifiedCount = results.filter((result) => result.status === 'match').length;
  const ratio = verifiedCount / results.length;
  if (verifiedCount === results.length) {
    return applyEvidenceVerification(observation, 'verified', verifiedCount, observation.confidence, checkedAt, 'keep');
  }
  if (verifiedCount > 0) {
    const confidence = Math.max(observation.confidence * ratio, 0.3);
    const disposition: VerificationDisposition = confidence < 0.7 ? 'keep-with-reduced-confidence' : 'keep';
    return applyEvidenceVerification(observation, 'partial', verifiedCount, confidence, checkedAt, disposition);
  }
  return applyEvidenceVerification(observation, 'failed', 0, 0, checkedAt, 'demote-to-ambient');
}

function applyEvidenceVerification(
  observation: RcclObservation,
  status: VerificationStatus,
  verifiedCount: number,
  evidenceConfidence: number,
  checkedAt: string,
  disposition: VerificationDisposition,
): RcclObservation {
  return {
    ...observation,
    verification: {
      ...observation.verification,
      evidence_status: status,
      evidence_verified_count: verifiedCount,
      evidence_confidence: Number(evidenceConfidence.toFixed(2)),
      checked_at: checkedAt,
      disposition,
    },
  };
}

export function verifyEvidence(
  evidence: RcclEvidence,
  projectRoot: string,
  policy: VerificationPolicy = DEFAULT_VERIFICATION_POLICY,
): { status: 'match' | 'mismatch' | 'file-not-found' | 'range-out-of-bounds' | 'path-outside-project' } {
  if (!safeRelativeEvidencePath(evidence.file)) return { status: 'path-outside-project' };
  const root = realpathSync(resolve(projectRoot));
  const fullPath = resolve(root, evidence.file);
  if (!existsSync(fullPath)) return { status: 'file-not-found' };
  let realFile: string;
  try { realFile = realpathSync(fullPath); } catch { return { status: 'file-not-found' }; }
  const rel = relative(root, realFile);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    return { status: 'path-outside-project' };
  }
  const lines = readFileSync(realFile, 'utf-8').replace(/\r\n/g, '\n').split('\n');
  const [start, end] = evidence.line_range;
  if (start < 1 || end < start || end > lines.length) return { status: 'range-out-of-bounds' };
  const actual = lines.slice(start - 1, end).join('\n');
  return tokenOverlapSimilarity(actual, evidence.snippet) >= policy.snippet_similarity_threshold ? { status: 'match' } : { status: 'mismatch' };
}

function safeRelativeEvidencePath(file: string): boolean {
  if (!file || isAbsolute(file) || win32.isAbsolute(file)) return false;
  const normalized = file.replace(/\\/g, '/');
  return !normalized.split('/').some((segment) => segment === '..') && !normalized.startsWith('/');
}

function tokenOverlapSimilarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of aTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of bTokens) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(token, count - 1);
    }
  }
  return overlap / Math.max(aTokens.length, bTokens.length);
}

function tokenize(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/['"`]/g, '"').replace(/\s+/g, ' ').trim()
    .match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
}
