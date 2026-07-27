import { parseYaml } from './utils/yaml.ts';
import { observationFingerprint } from './verify.ts';
import {
  DECISION_DIMENSIONS,
  RCCL_CATEGORIES,
  RCCL_SCHEMA_VERSION,
  type CalibrationContract,
  type CalibrationDiagnostic,
  type CalibrationEvidenceWindow,
  type CalibrationProposal,
  type RcclDocument,
  type RcclEvidence,
  type RcclEvidenceProposal,
  type RcclObservationContent,
  type RcclObservationProposal,
  type RcclObservation,
} from './types.ts';

const OBSERVATION_ID = /^obs-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOW_ID = /^window:[a-f0-9]{64}$/;

export function parseRcclDocument(text: string): { valid: boolean; data?: RcclDocument; diagnostics: CalibrationDiagnostic[] } {
  const parsed = parseText(text);
  if (!parsed.value) return { valid: false, diagnostics: parsed.diagnostics };
  const diagnostics = validateDocument(parsed.value);
  if (diagnostics.length) return { valid: false, diagnostics };
  return { valid: true, data: normalizeDocument(parsed.value as Record<string, unknown>), diagnostics: [] };
}

export function parseCalibrationContract(
  input: unknown,
): { valid: boolean; data?: CalibrationContract; diagnostics: CalibrationDiagnostic[] } {
  if (!isRecord(input)) {
    return { valid: false, diagnostics: [diagnostic('contract', 'MALFORMED_CONTRACT', 'Calibration contract must be an object.')] };
  }
  const value = input;
  const diagnostics: CalibrationDiagnostic[] = [];
  if (value.schemaVersion !== RCCL_SCHEMA_VERSION) diagnostics.push(diagnostic('contract.schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION', `Expected ${RCCL_SCHEMA_VERSION}.`));
  if (!nonEmpty(value.requestId)) diagnostics.push(diagnostic('contract.requestId', 'MISSING_REQUEST_ID', 'requestId is required.'));
  if (!nonEmpty(value.contextFingerprint)) diagnostics.push(diagnostic('contract.contextFingerprint', 'MISSING_CONTEXT_FINGERPRINT', 'contextFingerprint is required.'));
  if (!Array.isArray(value.evidenceWindows) || value.evidenceWindows.length === 0) {
    diagnostics.push(diagnostic('contract.evidenceWindows', 'MISSING_EVIDENCE_WINDOWS', 'At least one explicit evidence window is required.'));
  } else {
    const ids = new Set<string>();
    value.evidenceWindows.forEach((window, index) => {
      diagnostics.push(...validateContractWindow(window, index));
      if (isRecord(window) && typeof window.windowId === 'string') {
        if (ids.has(window.windowId)) diagnostics.push(diagnostic(`contract.evidenceWindows[${index}].windowId`, 'DUPLICATE_WINDOW_ID', `Duplicate window id ${window.windowId}.`));
        ids.add(window.windowId);
      }
    });
  }
  if (!nonEmpty(value.prompt)) diagnostics.push(diagnostic('contract.prompt', 'MISSING_PROMPT', 'prompt is required.'));
  if (!nonEmpty(value.proposalSchema)) diagnostics.push(diagnostic('contract.proposalSchema', 'MISSING_PROPOSAL_SCHEMA', 'proposalSchema is required.'));
  if (diagnostics.length) return { valid: false, diagnostics };
  return {
    valid: true,
    diagnostics: [],
    data: {
      schemaVersion: RCCL_SCHEMA_VERSION,
      requestId: String(value.requestId),
      contextFingerprint: String(value.contextFingerprint),
      evidenceWindows: (value.evidenceWindows as unknown[]).map(normalizeContractWindow),
      prompt: String(value.prompt),
      proposalSchema: String(value.proposalSchema),
    },
  };
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
  for (const forbidden of ['reviewStatus', 'approval', 'evidenceVerification', 'lifecycle']) {
    if (forbidden in value) diagnostics.push(diagnostic(`${prefix}.${forbidden}`, 'RUNTIME_OWNED_FIELD', `${forbidden} is RCCL-owned and cannot be proposed.`));
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    diagnostics.push(diagnostic(`${prefix}.evidence`, 'MISSING_EVIDENCE', 'evidence must reference at least one supplied window.'));
  } else {
    const ids = new Set<string>();
    value.evidence.forEach((evidence, evidenceIndex) => {
      diagnostics.push(...validateEvidenceProposal(evidence, `${prefix}.evidence[${evidenceIndex}]`));
      if (isRecord(evidence) && typeof evidence.windowId === 'string') {
        if (ids.has(evidence.windowId)) diagnostics.push(diagnostic(`${prefix}.evidence[${evidenceIndex}].windowId`, 'DUPLICATE_EVIDENCE_WINDOW', `Duplicate evidence window ${evidence.windowId}.`));
        ids.add(evidence.windowId);
      }
    });
  }
  return diagnostics;
}

function validateFinalObservation(value: unknown, index: number): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(`observations[${index}]`, 'MALFORMED_OBSERVATION', 'Observation must be an object.')];
  const prefix = `observations[${index}]`;
  const diagnostics = validateObservationCore(value, prefix);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) diagnostics.push(diagnostic(`${prefix}.evidence`, 'MISSING_EVIDENCE', 'evidence must be non-empty.'));
  else value.evidence.forEach((evidence, evidenceIndex) => diagnostics.push(...validateEvidence(evidence, `${prefix}.evidence[${evidenceIndex}]`)));

  if (!['generated', 'reviewed'].includes(String(value.reviewStatus))) {
    diagnostics.push(diagnostic(`${prefix}.reviewStatus`, 'INVALID_REVIEW_STATUS', 'reviewStatus must be generated or reviewed.'));
  }
  if (value.reviewStatus === 'generated' && value.approval !== undefined) {
    diagnostics.push(diagnostic(`${prefix}.approval`, 'UNEXPECTED_APPROVAL', 'Generated observations cannot carry approval provenance.'));
  }
  if (value.reviewStatus === 'reviewed') diagnostics.push(...validateApproval(value.approval, `${prefix}.approval`));

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

  if (diagnostics.length === 0) {
    const normalized = normalizeFinalObservation(value);
    const expectedFingerprint = observationFingerprint(normalized);
    if (normalized.lifecycle.contentFingerprint !== expectedFingerprint) {
      diagnostics.push(diagnostic(`${prefix}.lifecycle.contentFingerprint`, 'CONTENT_FINGERPRINT_MISMATCH', 'Observation content changed without regenerating its lifecycle fingerprint.'));
    }
    if (normalized.reviewStatus === 'reviewed' && normalized.approval?.contentFingerprint !== expectedFingerprint) {
      diagnostics.push(diagnostic(`${prefix}.approval.contentFingerprint`, 'APPROVAL_FINGERPRINT_MISMATCH', 'Approval does not apply to the current observation content.'));
    }
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
  if (!Array.isArray(value.affects) || value.affects.length === 0) diagnostics.push(diagnostic(`${prefix}.affects`, 'MISSING_DECISION_DIMENSION', 'affects must contain at least one decision dimension.'));
  else value.affects.forEach((dimension, dimensionIndex) => {
    if (!DECISION_DIMENSIONS.includes(dimension as never)) diagnostics.push(diagnostic(`${prefix}.affects[${dimensionIndex}]`, 'INVALID_DECISION_DIMENSION', `Unknown decision dimension ${String(dimension)}.`));
  });
  return diagnostics;
}

function validateContractWindow(value: unknown, index: number): CalibrationDiagnostic[] {
  const prefix = `contract.evidenceWindows[${index}]`;
  if (!isRecord(value)) return [diagnostic(prefix, 'MALFORMED_EVIDENCE_WINDOW', 'Evidence window must be an object.')];
  const diagnostics = validateEvidence(value, prefix);
  if (typeof value.windowId !== 'string' || !WINDOW_ID.test(value.windowId)) diagnostics.push(diagnostic(`${prefix}.windowId`, 'INVALID_WINDOW_ID', 'windowId must be a SHA-256 contract window identifier.'));
  return diagnostics;
}

function validateEvidenceProposal(value: unknown, prefix: string): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(prefix, 'MALFORMED_EVIDENCE', 'Evidence must be an object containing one windowId.')];
  const diagnostics: CalibrationDiagnostic[] = [];
  if (typeof value.windowId !== 'string' || !WINDOW_ID.test(value.windowId)) diagnostics.push(diagnostic(`${prefix}.windowId`, 'INVALID_WINDOW_ID', 'windowId must reference a supplied contract window.'));
  for (const key of Object.keys(value)) {
    if (key !== 'windowId') diagnostics.push(diagnostic(`${prefix}.${key}`, 'UNSUPPORTED_EVIDENCE_FIELD', 'Proposal evidence may contain only windowId.'));
  }
  return diagnostics;
}

function validateEvidence(value: unknown, prefix: string): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(prefix, 'MALFORMED_EVIDENCE', 'Evidence must be an object.')];
  const diagnostics: CalibrationDiagnostic[] = [];
  if (!nonEmpty(value.file)) diagnostics.push(diagnostic(`${prefix}.file`, 'INVALID_FILE', 'file is required.'));
  if (!validLineRange(value.lineRange)) diagnostics.push(diagnostic(`${prefix}.lineRange`, 'INVALID_LINE_RANGE', 'lineRange must be positive [start, end] with end >= start.'));
  if (!nonEmpty(value.snippet)) diagnostics.push(diagnostic(`${prefix}.snippet`, 'INVALID_SNIPPET', 'snippet is required.'));
  return diagnostics;
}

function validateApproval(value: unknown, prefix: string): CalibrationDiagnostic[] {
  if (!isRecord(value)) return [diagnostic(prefix, 'MISSING_APPROVAL', 'Reviewed observations require approval provenance.')];
  const diagnostics: CalibrationDiagnostic[] = [];
  if (!nonEmpty(value.approvedBy)) diagnostics.push(diagnostic(`${prefix}.approvedBy`, 'MISSING_APPROVER', 'approvedBy is required.'));
  if (!nonEmpty(value.approvedAt) || Number.isNaN(Date.parse(String(value.approvedAt)))) diagnostics.push(diagnostic(`${prefix}.approvedAt`, 'INVALID_APPROVAL_TIME', 'approvedAt must be an ISO-compatible timestamp.'));
  if (!nonEmpty(value.contentFingerprint)) diagnostics.push(diagnostic(`${prefix}.contentFingerprint`, 'MISSING_APPROVAL_FINGERPRINT', 'contentFingerprint is required.'));
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
  const content = normalizeObservationContent(value);
  const verification = value.evidenceVerification as Record<string, unknown>;
  const lifecycle = value.lifecycle as Record<string, unknown>;
  const approval = value.approval as Record<string, unknown> | undefined;
  return {
    ...content,
    reviewStatus: value.reviewStatus as RcclObservation['reviewStatus'],
    ...(approval ? {
      approval: {
        approvedBy: String(approval.approvedBy).trim(),
        approvedAt: String(approval.approvedAt),
        contentFingerprint: String(approval.contentFingerprint),
      },
    } : {}),
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

function normalizeObservationContent(value: Record<string, unknown>): RcclObservationContent {
  return {
    id: String(value.id),
    category: value.category as RcclObservationContent['category'],
    scope: String(value.scope).replace(/\\/g, '/'),
    statement: String(value.statement).trim(),
    affects: [...new Set((value.affects as unknown[]).map(String))].sort() as RcclObservationContent['affects'],
    decisionImpact: String(value.decisionImpact).trim(),
    semanticConfidence: value.semanticConfidence as RcclObservationContent['semanticConfidence'],
    evidence: (value.evidence as unknown[]).map(normalizeEvidence),
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
    evidence: (item.evidence as unknown[]).map(normalizeEvidenceProposal),
  };
}

function normalizeContractWindow(value: unknown): CalibrationEvidenceWindow {
  const item = value as Record<string, unknown>;
  return {
    windowId: String(item.windowId),
    file: String(item.file).replace(/\\/g, '/'),
    lineRange: [Number((item.lineRange as unknown[])[0]), Number((item.lineRange as unknown[])[1])],
    snippet: String(item.snippet),
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

function normalizeEvidenceProposal(value: unknown): RcclEvidenceProposal {
  return { windowId: String((value as Record<string, unknown>).windowId) };
}

function parseText(text: string): { value?: unknown; diagnostics: CalibrationDiagnostic[] } {
  try {
    const cleaned = text.trim().replace(/^```(?:ya?ml|json)?\s*/i, '').replace(/```\s*$/, '');
    return { value: parseYaml(cleaned), diagnostics: [] };
  } catch (error) {
    return { diagnostics: [diagnostic('', 'PARSE_ERROR', error instanceof Error ? error.message : String(error))] };
  }
}

function validLineRange(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every(Number.isInteger)
    && Number(value[0]) >= 1
    && Number(value[1]) >= Number(value[0]);
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
