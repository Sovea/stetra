import { parseYaml } from './utils/yaml.ts';
import type {
  CandidateObservation,
  RcclObservationRefreshDocument,
  RcclObservationRefreshRetireEntry,
  RcclSchemaVersion,
  ScopeBasis,
} from './types.ts';
import { RCCL_SCOPE_BASES, validateCandidateObservationRecord, validateCandidateObservationShape } from './validate-observation.ts';

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

export interface ValidateRcclRefreshOptions {
  allowedObservationIds?: readonly string[];
  activeObservationIds?: readonly string[];
}

interface RefreshCandidateEntry {
  path: string;
  observation: CandidateObservation;
  structureErrors: string[];
}

interface RefreshKeepEntry {
  path: string;
  id: string;
  structureErrors: string[];
}

interface RefreshRetireEntry {
  path: string;
  entry: RcclObservationRefreshRetireEntry;
  structureErrors: string[];
}

const MIN_CONFIDENCE = 0.3;
const RETIRE_REASON_IDS = new Set(['file-missing', 'snippet-drift', 'scope-drift', 'superseded', 'no-longer-material', 'other']);

export function validateRcclObservationRefreshPayload(
  yamlText: string,
  validationOptions: readonly string[] | ValidateRcclRefreshOptions = {},
): ValidateRcclRefreshResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    return rejectedDocument(`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(raw)) return rejectedDocument('Refresh payload must be a YAML object.');

  const options: ValidateRcclRefreshOptions = isStringArray(validationOptions)
    ? validationOptions.length > 0
      ? { allowedObservationIds: validationOptions }
      : {}
    : validationOptions;
  const enforceAllowedIds = options.allowedObservationIds !== undefined;
  const enforceActiveIds = options.activeObservationIds !== undefined || enforceAllowedIds;
  const allowedIds = new Set<string>(options.allowedObservationIds ?? []);
  const activeIds = new Set<string>(options.activeObservationIds ?? options.allowedObservationIds ?? []);
  const entries: RcclRefreshDiagnosticEntry[] = [];
  const version: RcclSchemaVersion | null = raw.version === '1.0' || raw.version === 1 ? '1.0' : null;
  const scope = typeof raw.scope === 'string' ? raw.scope : null;
  const keep = normalizeKeepList(raw.keep, hasOwn(raw, 'keep'));
  const revise = normalizeCandidateList(raw.revise, 'revise', hasOwn(raw, 'revise'));
  const retire = normalizeRetireList(raw.retire, hasOwn(raw, 'retire'));
  const newObservations = normalizeCandidateList(raw.new_observations, 'new_observations', hasOwn(raw, 'new_observations'));
  const keepIds = keep.map((entry) => entry.id).filter(Boolean);
  const reviseObservations = revise.map((entry) => entry.observation);
  const retireEntries = retire.map((entry) => entry.entry);
  const newObservationList = newObservations.map((entry) => entry.observation);
  const occurrences = buildIdOccurrences(keepIds, reviseObservations, retireEntries, newObservationList);

  if (!version) entries.push(rejected('document.version', 'unsupported-value', 'version must be "1.0".'));
  if (!scope) entries.push(rejected('document.scope', 'missing-required-field', 'scope is required.'));

  validateKeepList(keep, activeIds, entries, occurrences, enforceActiveIds);

  validateCandidateList(revise, 'revise', entries, {
    allowedIds,
    activeIds,
    enforceAllowedIds,
    enforceActiveIds,
    occurrences,
  });
  validateRetireList(retire, activeIds, entries, occurrences, enforceActiveIds);
  validateCandidateList(newObservations, 'new_observations', entries, {
    allowedIds,
    activeIds,
    enforceAllowedIds,
    enforceActiveIds,
    occurrences,
  });

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
      keep: keepIds,
      revise: reviseObservations,
      retire: retireEntries,
      new_observations: newObservationList,
    }
    : null;

  return {
    valid: Boolean(document) && diagnostics.summary.accepted > 0 && diagnostics.summary.rejected === 0,
    document,
    diagnostics,
  };
}

function validateKeepList(
  keep: RefreshKeepEntry[],
  activeIds: Set<string>,
  entries: RcclRefreshDiagnosticEntry[],
  occurrences: Map<string, number>,
  enforceActiveIds: boolean,
): void {
  for (const entry of keep) {
    const { id, path } = entry;
    if (entry.structureErrors.length) {
      entries.push({
        status: 'rejected',
        reason: classifyStructureErrors(entry.structureErrors),
        path,
        message: entry.structureErrors.join('; '),
        observationId: id || undefined,
      });
      continue;
    }
    if (isDuplicate(id, occurrences)) {
      entries.push(rejected(`keep.${id}`, 'duplicate-id', `Observation id "${id}" appears in multiple refresh actions.`, id));
    } else if (enforceActiveIds && !activeIds.has(id)) {
      entries.push(rejected(`keep.${id}`, 'invalid-id', `Observation id "${id}" is not in the active observation id list.`, id));
    } else {
      entries.push(accepted(`keep.${id}`, `Observation "${id}" accepted as keep proposal.`, id));
    }
  }
}

function validateCandidateList(
  observations: RefreshCandidateEntry[],
  pathPrefix: 'revise' | 'new_observations',
  entries: RcclRefreshDiagnosticEntry[],
  options: {
    allowedIds: Set<string>;
    activeIds: Set<string>;
    enforceAllowedIds: boolean;
    enforceActiveIds: boolean;
    occurrences: Map<string, number>;
  },
): void {
  const seen = new Set<string>();
  observations.forEach((entry) => {
    const observation = entry.observation;
    const path = entry.path;
    const id = observation.provisional_id;
    const structureErrors = dedupeErrors([
      ...entry.structureErrors,
      ...validateCandidateObservationShape(observation, path),
    ]);
    if (structureErrors.length) {
      entries.push({
        status: 'rejected',
        reason: classifyStructureErrors(structureErrors),
        path,
        message: structureErrors.join('; '),
        observationId: id || undefined,
        confidence: Number.isFinite(observation.confidence) ? observation.confidence : undefined,
      });
      return;
    }
    if (seen.has(id)) {
      entries.push(rejected(path, 'duplicate-id', `Duplicate provisional_id "${id}".`, id));
      return;
    }
    seen.add(id);
    if (isDuplicate(id, options.occurrences)) {
      entries.push(rejected(path, 'duplicate-id', `Observation id "${id}" appears in multiple refresh actions.`, id));
      return;
    }
    if (pathPrefix === 'revise' && options.enforceActiveIds && !options.activeIds.has(id)) {
      entries.push(rejected(path, 'invalid-id', `Revise provisional_id "${id}" must match an active observation id.`, id));
      return;
    }
    if (pathPrefix === 'new_observations' && options.enforceAllowedIds && options.allowedIds.has(id)) {
      entries.push(rejected(path, 'invalid-id', `New observation provisional_id "${id}" already exists.`, id));
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
  retire: RefreshRetireEntry[],
  activeIds: Set<string>,
  entries: RcclRefreshDiagnosticEntry[],
  occurrences: Map<string, number>,
  enforceActiveIds: boolean,
): void {
  retire.forEach((item) => {
    const { entry, path } = item;
    if (item.structureErrors.length) {
      entries.push({
        status: 'rejected',
        reason: classifyStructureErrors(item.structureErrors),
        path,
        message: item.structureErrors.join('; '),
        observationId: entry.observation_id || undefined,
        confidence: Number.isFinite(entry.confidence) ? entry.confidence : undefined,
      });
      return;
    }
    if (!entry.observation_id) {
      entries.push(rejected(path, 'missing-required-field', 'Retire entry is missing observation_id.'));
      return;
    }
    if (isDuplicate(entry.observation_id, occurrences)) {
      entries.push(rejected(path, 'duplicate-id', `Observation id "${entry.observation_id}" appears in multiple refresh actions.`, entry.observation_id));
      return;
    }
    if (enforceActiveIds && !activeIds.has(entry.observation_id)) {
      entries.push(rejected(path, 'invalid-id', `Observation id "${entry.observation_id}" is not in the active observation id list.`, entry.observation_id));
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

function buildIdOccurrences(
  keep: string[],
  revise: CandidateObservation[],
  retire: RcclObservationRefreshRetireEntry[],
  newObservations: CandidateObservation[],
): Map<string, number> {
  const occurrences = new Map<string, number>();
  const add = (id: string): void => {
    if (!id) return;
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  };
  keep.forEach(add);
  revise.forEach((item) => add(item.provisional_id));
  retire.forEach((item) => add(item.observation_id));
  newObservations.forEach((item) => add(item.provisional_id));
  return occurrences;
}

function isDuplicate(id: string, occurrences: Map<string, number>): boolean {
  return (occurrences.get(id) ?? 0) > 1;
}

function rejectedDocument(message: string): ValidateRcclRefreshResult {
  return {
    valid: false,
    document: null,
    diagnostics: buildDiagnostics([rejected('document', 'malformed-payload', message)]),
  };
}

function normalizeKeepList(value: unknown, fieldPresent: boolean): RefreshKeepEntry[] {
  if (!fieldPresent) return [];
  if (!Array.isArray(value)) {
    return [{ path: 'keep', id: '', structureErrors: ['keep: must be an array'] }];
  }
  return value.map((item, index) => {
    const path = `keep[${index}]`;
    if (!isNonEmptyString(item)) {
      return {
        path,
        id: '',
        structureErrors: [`${path}: must be a non-empty string observation id`],
      };
    }
    return { path, id: item.trim(), structureErrors: [] };
  });
}

function normalizeCandidateList(value: unknown, pathPrefix: 'revise' | 'new_observations', fieldPresent: boolean): RefreshCandidateEntry[] {
  if (!fieldPresent) return [];
  if (!Array.isArray(value)) {
    return [{
      path: pathPrefix,
      observation: emptyCandidateObservation(),
      structureErrors: [`${pathPrefix}: must be an array`],
    }];
  }
  return value.map((item, index) => {
    const path = `${pathPrefix}[${index}]`;
    if (!isRecord(item)) {
      return {
        path,
        observation: emptyCandidateObservation(),
        structureErrors: [`${path}: candidate observation must be an object`],
      };
    }
    return {
      path,
      observation: normalizeCandidateObservation(item),
      structureErrors: validateCandidateObservationRecord(item, path),
    };
  });
}

function normalizeCandidateObservation(item: Record<string, unknown>): CandidateObservation {
  return {
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
  };
}

function emptyCandidateObservation(): CandidateObservation {
  return {
    provisional_id: '',
    semantic_key: '',
    category: '' as CandidateObservation['category'],
    scope_hint: '',
    pattern: '',
    confidence: Number.NaN,
    adherence_quality: '' as CandidateObservation['adherence_quality'],
    evidence: [],
    source_slice_ids: [],
    support_hint: null,
  };
}

function normalizeRetireList(value: unknown, fieldPresent: boolean): RefreshRetireEntry[] {
  if (!fieldPresent) return [];
  if (!Array.isArray(value)) {
    return [{ path: 'retire', entry: emptyRetireEntry(), structureErrors: ['retire: must be an array'] }];
  }
  return value.map((item, index) => {
    const path = `retire[${index}]`;
    if (!isRecord(item)) {
      return {
        path,
        entry: emptyRetireEntry(),
        structureErrors: [`${path}: retire entry must be an object`],
      };
    }
    return {
      path,
      entry: normalizeRetireEntry(item),
      structureErrors: validateRetireEntryRecord(item, path),
    };
  });
}

function normalizeRetireEntry(item: Record<string, unknown>): RcclObservationRefreshRetireEntry {
  return {
    observation_id: stringValue(item.observation_id),
    reason_id: stringValue(item.reason_id) as RcclObservationRefreshRetireEntry['reason_id'],
    confidence: numberValue(item.confidence),
  };
}

function emptyRetireEntry(): RcclObservationRefreshRetireEntry {
  return {
    observation_id: '',
    reason_id: '' as RcclObservationRefreshRetireEntry['reason_id'],
    confidence: Number.NaN,
  };
}

function validateRetireEntryRecord(item: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(item.observation_id)) errors.push(`${path}: missing or invalid 'observation_id'`);
  if (!isNonEmptyString(item.reason_id)) errors.push(`${path}: missing or invalid 'reason_id'`);
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) {
    errors.push(`${path}: 'confidence' must be a number`);
  }
  return errors;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isStringArray(value: readonly string[] | ValidateRcclRefreshOptions): value is readonly string[] {
  return Array.isArray(value);
}

function classifyStructureErrors(errors: string[]): RcclRefreshDiagnosticReason {
  const joined = errors.join(' ').toLowerCase();
  if (joined.includes('missing') || joined.includes('must be a non-empty')) return 'missing-required-field';
  if (joined.includes('must be an array') || joined.includes('must be an object')) return 'malformed-payload';
  return 'unsupported-value';
}

function dedupeErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

function isScopeBasis(value: unknown): value is ScopeBasis {
  return RCCL_SCOPE_BASES.has(String(value));
}
