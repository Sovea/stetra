import type { CandidateObservation, CandidateRcclDocument } from './types.ts';
import { parseRcclCandidates } from './io/parse-rccl.ts';
import { validateCandidateObservationShape } from './validate-observation.ts';

export type RcclDiagnosticStatus = 'accepted' | 'rejected';
export type RcclDiagnosticReason =
  | 'accepted'
  | 'duplicate-id'
  | 'low-confidence'
  | 'malformed-payload'
  | 'missing-required-field'
  | 'unsupported-value'
  | 'failed-verification';

export interface RcclDiagnosticEntry {
  status: RcclDiagnosticStatus;
  reason: RcclDiagnosticReason;
  path: string;
  message: string;
  observationId?: string;
  confidence?: number;
}

export interface RcclCandidatePayloadDiagnostics {
  kind: 'rccl-observation-generation';
  summary: {
    total: number;
    accepted: number;
    rejected: number;
  };
  entries: RcclDiagnosticEntry[];
}

export interface ValidateRcclCandidateResult {
  valid: boolean;
  observations: CandidateObservation[];
  document: { version: string; generated_at: string | null; git_ref: string | null } | null;
  diagnostics: RcclCandidatePayloadDiagnostics;
}

const MIN_CONFIDENCE = 0.3;

export function validateRcclCandidatePayload(yamlText: string): ValidateRcclCandidateResult {
  const parsed = parseRcclCandidates(yamlText);

  if (!parsed.valid || !parsed.data) {
    const reason = classifyParseErrors(parsed.errors ?? []);
    return {
      valid: false,
      observations: [],
      document: null,
      diagnostics: {
        kind: 'rccl-observation-generation',
        summary: { total: 0, accepted: 0, rejected: 1 },
        entries: [{
          status: 'rejected',
          reason,
          path: 'document',
          message: (parsed.errors ?? []).join('; ') || 'Failed to parse candidate YAML',
        }],
      },
    };
  }

  return validateCandidateDocument(parsed.data);
}

function validateCandidateDocument(doc: CandidateRcclDocument): ValidateRcclCandidateResult {
  const entries: RcclDiagnosticEntry[] = [];
  const accepted: CandidateObservation[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < doc.observations.length; i += 1) {
    const obs = doc.observations[i];
    const path = `observations[${i}]`;
    const id = obs.provisional_id;

    if (seenIds.has(id)) {
      entries.push({
        status: 'rejected',
        reason: 'duplicate-id',
        path,
        message: `Duplicate provisional_id "${id}"; only the first occurrence is accepted.`,
        observationId: id,
      });
      continue;
    }
    seenIds.add(id);

    const structureErrors = validateCandidateObservationShape(obs, path);
    if (structureErrors.length) {
      entries.push({
        status: 'rejected',
        reason: classifyStructureErrors(structureErrors),
        path,
        message: structureErrors.join('; '),
        observationId: id || undefined,
        confidence: Number.isFinite(obs.confidence) ? obs.confidence : undefined,
      });
      continue;
    }

    if (obs.confidence < MIN_CONFIDENCE) {
      entries.push({
        status: 'rejected',
        reason: 'low-confidence',
        path,
        message: `Confidence ${obs.confidence} is below minimum threshold ${MIN_CONFIDENCE}.`,
        observationId: id,
        confidence: obs.confidence,
      });
      continue;
    }

    entries.push({
      status: 'accepted',
      reason: 'accepted',
      path,
      message: `Candidate "${id}" accepted.`,
      observationId: id,
      confidence: obs.confidence,
    });
    accepted.push(obs);
  }

  const summary = {
    total: doc.observations.length,
    accepted: accepted.length,
    rejected: doc.observations.length - accepted.length,
  };

  return {
    valid: accepted.length > 0,
    observations: accepted,
    document: { version: doc.version, generated_at: doc.generated_at, git_ref: doc.git_ref },
    diagnostics: { kind: 'rccl-observation-generation', summary, entries },
  };
}

function classifyParseErrors(errors: string[]): RcclDiagnosticReason {
  const joined = errors.join(' ').toLowerCase();
  if (joined.includes('yaml parse error') || joined.includes('must be a yaml object')) return 'malformed-payload';
  if (joined.includes('missing') || joined.includes("must be")) return 'missing-required-field';
  return 'malformed-payload';
}

function classifyStructureErrors(errors: string[]): RcclDiagnosticReason {
  const joined = errors.join(' ').toLowerCase();
  if (joined.includes('missing') || joined.includes('must be a non-empty')) return 'missing-required-field';
  return 'unsupported-value';
}
