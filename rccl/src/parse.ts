import { parseYaml } from './utils/yaml.ts';
import {
  DECISION_DIMENSIONS,
  RCCL_CATEGORIES,
  RCCL_SCHEMA_VERSION,
  type CalibrationDiagnostic,
  type CalibrationProposal,
  type RcclDocument,
  type RcclEvidence,
  type RcclObservationProposal,
  type RcclObservation,
} from './types.ts';

const OBSERVATION_ID = /^obs-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseRcclDocument(text: string): { valid: boolean; data?: RcclDocument; diagnostics: CalibrationDiagnostic[] } {
  const parsed = parseText(text);
  if (!parsed.value) return { valid: false, diagnostics: parsed.diagnostics };
  const diagnostics = validateDocument(parsed.value);
  if (diagnostics.length) return { valid: false, diagnostics };
  return { valid: true, data: normalizeDocument(parsed.value as Record<string, unknown>), diagnostics: [] };
}

export function parseCalibrationProposal(
  input: CalibrationProposal | string,
): { valid: boolean; data?: CalibrationProposal; diagnostics: CalibrationDiagnostic[] } {
  const parsed = typeof input === 'string' ? parseText(input) : { value: input as unknown, diagnostics: [] };
  if (!parsed.value) return { valid: false, diagnostics: parsed.diagnostics };
  if (!isRecord(parsed.value)) {
    return { valid: false, diagnostics: [diagnostic('', 'MALFORMED_PROPOSAL', 'Proposal must be an object.')] };
  }
  const value = parsed.value;
  const diagnostics: CalibrationDiagnostic[] = [];
  if (value.schemaVersion !== RCCL_SCHEMA_VERSION) diagnostics.push(diagnostic('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION', `Expected ${RCCL_SCHEMA_VERSION}.`));
  if (!nonEmpty(value.requestId)) diagnostics.push(diagnostic('requestId', 'MISSING_REQUEST_ID', 'requestId is required.'));
  if (!nonEmpty(value.contextFingerprint)) diagnostics.push(diagnostic('contextFingerprint', 'MISSING_CONTEXT_FINGERPRINT', 'contextFingerprint is required.'));
  if (!Array.isArray(value.observations)) diagnostics.push(diagnostic('observations', 'INVALID_OBSERVATIONS', 'observations must be an array.'));
  const observations = Array.isArray(value.observations) ? value.observations : [];
  const ids = new Set<string>();
  observations.forEach((observation, index) => {
    diagnostics.push(...validateProposalObservation(observation, index));
    if (isRecord(observation) && typeof observation.id === 'string') {
      if (ids.has(observation.id)) diagnostics.push(diagnostic(`observations[${index}].id`, 'DUPLICATE_ID', `Duplicate observation id ${observation.id}.`));
      ids.add(observation.id);
    }
  });
  if (diagnostics.length) return { valid: false, diagnostics };
  return {
    valid: true,
    diagnostics: [],
    data: {
      schemaVersion: RCCL_SCHEMA_VERSION,
      requestId: String(value.requestId),
      contextFingerprint: String(value.contextFingerprint),
      observations: observations.map(normalizeProposalObservation),
      ...(value.replace === true ? { replace: true } : {}),
    },
  };
}

function validateDocument(value: unknown): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic('', 'MALFORMED_DOCUMENT', 'RCCL must be an object.')];
  const diagnostics: CalibrationDiagnostic[] = [];
  if (value.version !== RCCL_SCHEMA_VERSION) diagnostics.push(diagnostic('version', 'UNSUPPORTED_SCHEMA_VERSION', `Expected RCCL ${RCCL_SCHEMA_VERSION}.`));
  if (!Array.isArray(value.observations)) diagnostics.push(diagnostic('observations', 'INVALID_OBSERVATIONS', 'observations must be an array.'));
  const ids = new Set<string>();
  for (const [index, item] of (Array.isArray(value.observations) ? value.observations : []).entries()) {
    diagnostics.push(...validateFinalObservation(item, index));
    if (isRecord(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) diagnostics.push(diagnostic(`observations[${index}].id`, 'DUPLICATE_ID', `Duplicate observation id ${item.id}.`));
      ids.add(item.id);
    }
  }
  return diagnostics;
}

function validateProposalObservation(value: unknown, index: number): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(`observations[${index}]`, 'MALFORMED_OBSERVATION', 'Observation must be an object.')];
  const prefix = `observations[${index}]`;
  const diagnostics = validateObservationCore(value, prefix);
  for (const forbidden of ['evidenceVerification', 'lifecycle']) {
    if (forbidden in value) diagnostics.push(diagnostic(`${prefix}.${forbidden}`, 'RUNTIME_OWNED_FIELD', `${forbidden} is RCCL-owned and cannot be proposed.`));
  }
  return diagnostics;
}

function validateFinalObservation(value: unknown, index: number): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(`observations[${index}]`, 'MALFORMED_OBSERVATION', 'Observation must be an object.')];
  const prefix = `observations[${index}]`;
  const diagnostics = validateObservationCore(value, prefix);
  if (!isRecord(value.evidenceVerification)) diagnostics.push(diagnostic(`${prefix}.evidenceVerification`, 'MISSING_EVIDENCE_STATUS', 'evidenceVerification is required.'));
  else {
    const verification = value.evidenceVerification;
    if (!['current', 'partial', 'stale', 'broken'].includes(String(verification.status))) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.status`, 'INVALID_EVIDENCE_STATUS', 'Invalid evidence status.'));
    if (!Number.isInteger(verification.verifiedCount) || Number(verification.verifiedCount) < 0) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.verifiedCount`, 'INVALID_COUNT', 'verifiedCount must be a non-negative integer.'));
    if (!Number.isInteger(verification.totalCount) || Number(verification.totalCount) < 0) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.totalCount`, 'INVALID_COUNT', 'totalCount must be a non-negative integer.'));
    if (!nonEmpty(verification.checkedAt)) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.checkedAt`, 'MISSING_CHECKED_AT', 'checkedAt is required.'));
  }
  if (!isRecord(value.lifecycle)) diagnostics.push(diagnostic(`${prefix}.lifecycle`, 'MISSING_LIFECYCLE', 'lifecycle is required.'));
  else {
    if (!['active', 'stale', 'superseded'].includes(String(value.lifecycle.status))) diagnostics.push(diagnostic(`${prefix}.lifecycle.status`, 'INVALID_LIFECYCLE', 'Invalid lifecycle status.'));
    if (!nonEmpty(value.lifecycle.contentFingerprint)) diagnostics.push(diagnostic(`${prefix}.lifecycle.contentFingerprint`, 'MISSING_FINGERPRINT', 'contentFingerprint is required.'));
  }
  return diagnostics;
}

function validateObservationCore(value: Record<string, unknown>, prefix: string): CalibrationDiagnostic[] {
  const diagnostics: CalibrationDiagnostic[] = [];
  if ('traits' in value) diagnostics.push(diagnostic(`${prefix}.traits`, 'UNSUPPORTED_FIELD', 'RCCL uses category and affects directly; traits are not supported.'));
  if (typeof value.id !== 'string' || !OBSERVATION_ID.test(value.id)) diagnostics.push(diagnostic(`${prefix}.id`, 'INVALID_ID', 'id must match obs-<kebab-case>.'));
  if (!RCCL_CATEGORIES.includes(value.category as never)) diagnostics.push(diagnostic(`${prefix}.category`, 'INVALID_CATEGORY', `category must be one of ${RCCL_CATEGORIES.join(', ')}.`));
  if (!nonEmpty(value.scope)) diagnostics.push(diagnostic(`${prefix}.scope`, 'INVALID_SCOPE', 'scope is required.'));
  if (!nonEmpty(value.statement)) diagnostics.push(diagnostic(`${prefix}.statement`, 'INVALID_STATEMENT', 'statement is required.'));
  if (!nonEmpty(value.decisionImpact)) diagnostics.push(diagnostic(`${prefix}.decisionImpact`, 'MISSING_DECISION_IMPACT', 'Explain how removing this observation could worsen a code decision.'));
  if (!['low', 'medium', 'high'].includes(String(value.semanticConfidence))) diagnostics.push(diagnostic(`${prefix}.semanticConfidence`, 'INVALID_SEMANTIC_CONFIDENCE', 'semanticConfidence must be low, medium, or high.'));
  if (value.reviewStatus !== undefined && !['generated', 'reviewed'].includes(String(value.reviewStatus))) diagnostics.push(diagnostic(`${prefix}.reviewStatus`, 'INVALID_REVIEW_STATUS', 'reviewStatus must be generated or reviewed.'));
  if (!Array.isArray(value.affects) || value.affects.length === 0) diagnostics.push(diagnostic(`${prefix}.affects`, 'MISSING_DECISION_DIMENSION', 'affects must contain at least one decision dimension.'));
  else value.affects.forEach((dimension, index) => {
    if (!DECISION_DIMENSIONS.includes(dimension as never)) diagnostics.push(diagnostic(`${prefix}.affects[${index}]`, 'INVALID_DECISION_DIMENSION', `Unknown decision dimension ${String(dimension)}.`));
  });
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) diagnostics.push(diagnostic(`${prefix}.evidence`, 'MISSING_EVIDENCE', 'evidence must be non-empty.'));
  else value.evidence.forEach((evidence, index) => diagnostics.push(...validateEvidence(evidence, `${prefix}.evidence[${index}]`)));
  return diagnostics;
}

function validateEvidence(value: unknown, prefix: string): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(prefix, 'MALFORMED_EVIDENCE', 'Evidence must be an object.')];
  const diagnostics: CalibrationDiagnostic[] = [];
  if (!nonEmpty(value.file)) diagnostics.push(diagnostic(`${prefix}.file`, 'INVALID_FILE', 'file is required.'));
  if (!Array.isArray(value.lineRange) || value.lineRange.length !== 2 || !value.lineRange.every(Number.isInteger)) diagnostics.push(diagnostic(`${prefix}.lineRange`, 'INVALID_LINE_RANGE', 'lineRange must be [start, end].'));
  if (!nonEmpty(value.snippet)) diagnostics.push(diagnostic(`${prefix}.snippet`, 'INVALID_SNIPPET', 'snippet is required.'));
  return diagnostics;
}

function normalizeDocument(value: Record<string, unknown>): RcclDocument {
  return {
    version: RCCL_SCHEMA_VERSION,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    gitRef: typeof value.gitRef === 'string' ? value.gitRef : null,
    observations: (value.observations as unknown[]).map((item) => normalizeFinalObservation(item as Record<string, unknown>)),
  };
}

function normalizeFinalObservation(value: Record<string, unknown>): RcclObservation {
  const proposal = normalizeProposalObservation(value);
  const verification = value.evidenceVerification as Record<string, unknown>;
  const lifecycle = value.lifecycle as Record<string, unknown>;
  return {
    ...proposal,
    reviewStatus: proposal.reviewStatus ?? 'generated',
    evidenceVerification: {
      status: verification.status as RcclObservation['evidenceVerification']['status'],
      verifiedCount: Number(verification.verifiedCount),
      totalCount: Number(verification.totalCount),
      checkedAt: String(verification.checkedAt),
    },
    lifecycle: {
      status: lifecycle.status as RcclObservation['lifecycle']['status'],
      contentFingerprint: String(lifecycle.contentFingerprint),
      firstSeenGitRef: typeof lifecycle.firstSeenGitRef === 'string' ? lifecycle.firstSeenGitRef : null,
      lastSeenGitRef: typeof lifecycle.lastSeenGitRef === 'string' ? lifecycle.lastSeenGitRef : null,
      lastVerifiedAt: String(lifecycle.lastVerifiedAt ?? verification.checkedAt),
      ...(typeof lifecycle.supersededBy === 'string' ? { supersededBy: lifecycle.supersededBy } : {}),
    },
  };
}

function normalizeProposalObservation(value: unknown): RcclObservationProposal {
  const item = value as Record<string, unknown>;
  return {
    id: String(item.id),
    category: item.category as RcclObservationProposal['category'],
    scope: String(item.scope).replace(/\\/g, '/'),
    statement: String(item.statement).trim(),
    affects: [...new Set((item.affects as unknown[]).map(String))].sort() as RcclObservationProposal['affects'],
    decisionImpact: String(item.decisionImpact).trim(),
    semanticConfidence: item.semanticConfidence as RcclObservationProposal['semanticConfidence'],
    reviewStatus: (item.reviewStatus ?? 'generated') as RcclObservationProposal['reviewStatus'],
    evidence: (item.evidence as unknown[]).map(normalizeEvidence),
  };
}

function normalizeEvidence(value: unknown): RcclEvidence {
  const item = value as Record<string, unknown>;
  return {
    file: String(item.file).replace(/\\/g, '/'),
    lineRange: [Number((item.lineRange as unknown[])[0]), Number((item.lineRange as unknown[])[1])],
    snippet: String(item.snippet),
  };
}

function parseText(text: string): { value?: unknown; diagnostics: CalibrationDiagnostic[] } {
  try {
    const cleaned = text.trim().replace(/^```(?:ya?ml|json)?\s*/i, '').replace(/```\s*$/, '');
    return { value: parseYaml(cleaned), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [diagnostic('', 'PARSE_ERROR', error instanceof Error ? error.message : String(error))] };
  }
}

function diagnostic(path: string, code: string, message: string): CalibrationDiagnostic {
  return { path, code, message };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
