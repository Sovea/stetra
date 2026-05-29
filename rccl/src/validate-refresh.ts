import { parseYaml } from './utils/yaml.ts';
import type {
  CandidateObservation,
  CandidateSupportHint,
  RcclObservationRefreshDocument,
  RcclObservationRefreshRetireEntry,
} from './types.ts';

export type RcclRefreshDiagnosticStatus = 'accepted' | 'rejected' | 'unused';
export type RcclRefreshDiagnosticReason =
  | 'accepted'
  | 'duplicate-id'
  | 'empty-payload'
  | 'invalid-id'
  | 'low-confidence'
  | 'malformed-payload'
  | 'missing-required-field'
  | 'unsupported-value';

export interface RcclRefreshDiagnosticEntry {
  status: RcclRefreshDiagnosticStatus;
  reason: RcclRefreshDiagnosticReason;
  path: string;
  message: string;
  observationId?: string;
  confidence?: number;
}

export interface RcclRefreshPayloadDiagnostics {
  kind: 'rccl-observation-refresh';
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    unused: number;
  };
  entries: RcclRefreshDiagnosticEntry[];
}

export interface ValidateRcclRefreshResult {
  valid: boolean;
  document: RcclObservationRefreshDocument | null;
  diagnostics: RcclRefreshPayloadDiagnostics;
}

const MIN_CONFIDENCE = 0.3;
const RETIRE_REASON_IDS = new Set(['file-missing', 'snippet-drift', 'scope-drift', 'superseded', 'no-longer-material', 'other']);

export function validateRcclObservationRefreshPayload(
  yamlText: string,
  allowedObservationIds: readonly string[] = [],
): ValidateRcclRefreshResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    return rejectedDocument(`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(raw)) return rejectedDocument('Refresh payload must be a YAML object.');

  const allowedIds = new Set(allowedObservationIds);
  const entries: RcclRefreshDiagnosticEntry[] = [];
  const version = raw.version === '1.0' || raw.version === 1 ? '1.0' : null;
  const scope = typeof raw.scope === 'string' ? raw.scope : null;
  const keep = normalizeStringList(raw.keep);
  const revise = normalizeCandidateList(raw.revise);
  const retire = normalizeRetireList(raw.retire);
  const newObservations = normalizeCandidateList(raw.new_observations);

  if (!version) entries.push(rejected('document.version', 'unsupported-value', 'version must be "1.0".'));
  if (!scope) entries.push(rejected('document.scope', 'missing-required-field', 'scope is required.'));

  for (const id of keep) {
    if (allowedIds.size > 0 && !allowedIds.has(id)) {
      entries.push(rejected(`keep.${id}`, 'invalid-id', `Observation id "${id}" is not in the allowed id list.`, id));
    } else {
      entries.push(accepted(`keep.${id}`, `Observation "${id}" accepted as keep proposal.`, id));
    }
  }

  validateCandidateList(revise, 'revise', entries);
  validateRetireList(retire, allowedIds, entries);
  validateCandidateList(newObservations, 'new_observations', entries);

  if (!keep.length && !revise.length && !retire.length && !newObservations.length) {
    entries.push({
      status: 'unused',
      reason: 'empty-payload',
      path: 'document',
      message: 'Refresh payload contains no keep, revise, retire, or new_observations entries.',
    });
  }

  const diagnostics = buildDiagnostics(entries);
  const document = version && scope
    ? {
      version,
      generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : null,
      scope,
      keep,
      revise,
      retire,
      new_observations: newObservations,
    }
    : null;

  return {
    valid: Boolean(document) && diagnostics.summary.accepted > 0 && diagnostics.summary.rejected === 0,
    document,
    diagnostics,
  };
}

function validateCandidateList(
  observations: CandidateObservation[],
  pathPrefix: 'revise' | 'new_observations',
  entries: RcclRefreshDiagnosticEntry[],
): void {
  const seen = new Set<string>();
  observations.forEach((observation, index) => {
    const path = `${pathPrefix}[${index}]`;
    const id = observation.provisional_id;
    if (!id) {
      entries.push(rejected(path, 'missing-required-field', 'Candidate observation is missing provisional_id.'));
      return;
    }
    if (seen.has(id)) {
      entries.push(rejected(path, 'duplicate-id', `Duplicate provisional_id "${id}".`, id));
      return;
    }
    seen.add(id);
    const missing = requiredCandidateFields(observation);
    if (missing.length) {
      entries.push(rejected(path, 'missing-required-field', `Missing required fields: ${missing.join(', ')}.`, id));
      return;
    }
    if (observation.confidence < MIN_CONFIDENCE) {
      entries.push({
        status: 'rejected',
        reason: 'low-confidence',
        path,
        message: `Confidence ${observation.confidence} is below minimum threshold ${MIN_CONFIDENCE}.`,
        observationId: id,
        confidence: observation.confidence,
      });
      return;
    }
    entries.push(accepted(path, `Candidate "${id}" accepted as ${pathPrefix} proposal.`, id, observation.confidence));
  });
}

function validateRetireList(
  retire: RcclObservationRefreshRetireEntry[],
  allowedIds: Set<string>,
  entries: RcclRefreshDiagnosticEntry[],
): void {
  retire.forEach((entry, index) => {
    const path = `retire[${index}]`;
    if (!entry.observation_id) {
      entries.push(rejected(path, 'missing-required-field', 'Retire entry is missing observation_id.'));
      return;
    }
    if (allowedIds.size > 0 && !allowedIds.has(entry.observation_id)) {
      entries.push(rejected(path, 'invalid-id', `Observation id "${entry.observation_id}" is not in the allowed id list.`, entry.observation_id));
      return;
    }
    if (!RETIRE_REASON_IDS.has(entry.reason_id)) {
      entries.push(rejected(path, 'unsupported-value', `Unsupported retire reason "${entry.reason_id}".`, entry.observation_id));
      return;
    }
    if (!Number.isFinite(entry.confidence) || entry.confidence < MIN_CONFIDENCE || entry.confidence > 1) {
      entries.push({
        status: 'rejected',
        reason: 'low-confidence',
        path,
        message: `Retire confidence must be between ${MIN_CONFIDENCE} and 1.`,
        observationId: entry.observation_id,
        confidence: entry.confidence,
      });
      return;
    }
    entries.push(accepted(path, `Retire proposal for "${entry.observation_id}" accepted.`, entry.observation_id, entry.confidence));
  });
}

function rejectedDocument(message: string): ValidateRcclRefreshResult {
  return {
    valid: false,
    document: null,
    diagnostics: buildDiagnostics([rejected('document', 'malformed-payload', message)]),
  };
}

function requiredCandidateFields(observation: CandidateObservation): string[] {
  const missing: string[] = [];
  if (!observation.provisional_id) missing.push('provisional_id');
  if (!observation.semantic_key) missing.push('semantic_key');
  if (!observation.category) missing.push('category');
  if (!observation.scope_hint) missing.push('scope_hint');
  if (!observation.pattern) missing.push('pattern');
  if (!Number.isFinite(observation.confidence)) missing.push('confidence');
  if (!observation.adherence_quality) missing.push('adherence_quality');
  if (!observation.evidence?.length) missing.push('evidence');
  if (!observation.source_slice_ids?.length) missing.push('source_slice_ids');
  return missing;
}

function normalizeCandidateList(value: unknown): CandidateObservation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    provisional_id: stringValue(item.provisional_id),
    semantic_key: stringValue(item.semantic_key),
    category: stringValue(item.category) as CandidateObservation['category'],
    scope_hint: stringValue(item.scope_hint),
    pattern: stringValue(item.pattern),
    confidence: numberValue(item.confidence),
    adherence_quality: stringValue(item.adherence_quality) as CandidateObservation['adherence_quality'],
    evidence: Array.isArray(item.evidence)
      ? item.evidence.filter(isRecord).map((evidence) => ({
        file: stringValue(evidence.file),
        line_range: normalizeLineRange(evidence.line_range),
        snippet: stringValue(evidence.snippet),
      }))
      : [],
    source_slice_ids: normalizeStringList(item.source_slice_ids),
    support_hint: isRecord(item.support_hint)
      ? {
        file_count: nullableNumber(item.support_hint.file_count),
        cluster_count: nullableNumber(item.support_hint.cluster_count),
        scope_basis: isScopeBasis(item.support_hint.scope_basis) ? item.support_hint.scope_basis : null,
      }
      : null,
  }));
}

function normalizeRetireList(value: unknown): RcclObservationRefreshRetireEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    observation_id: stringValue(item.observation_id),
    reason_id: stringValue(item.reason_id) as RcclObservationRefreshRetireEntry['reason_id'],
    confidence: numberValue(item.confidence),
  }));
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function normalizeLineRange(value: unknown): [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0], value[1]]
    : [0, 0];
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function accepted(path: string, message: string, observationId?: string, confidence?: number): RcclRefreshDiagnosticEntry {
  return {
    status: 'accepted',
    reason: 'accepted',
    path,
    message,
    observationId,
    confidence,
  };
}

function rejected(path: string, reason: RcclRefreshDiagnosticReason, message: string, observationId?: string): RcclRefreshDiagnosticEntry {
  return {
    status: 'rejected',
    reason,
    path,
    message,
    observationId,
  };
}

function buildDiagnostics(entries: RcclRefreshDiagnosticEntry[]): RcclRefreshPayloadDiagnostics {
  const summary = {
    total: entries.length,
    accepted: 0,
    rejected: 0,
    unused: 0,
  };
  for (const entry of entries) summary[entry.status] += 1;
  return {
    kind: 'rccl-observation-refresh',
    summary,
    entries,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScopeBasis(value: unknown): value is NonNullable<CandidateSupportHint['scope_basis']> {
  return value === 'single-file'
    || value === 'directory-cluster'
    || value === 'module-cluster'
    || value === 'cross-root';
}
