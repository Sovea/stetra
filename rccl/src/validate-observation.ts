import type { CandidateObservation, ScopeBasis } from './types.ts';

export const RCCL_OBSERVATION_ID_PATTERN = /^obs-[a-z0-9-]+$/;
export const RCCL_CATEGORIES = new Set(['style', 'architecture', 'pattern', 'constraint', 'legacy', 'anti-pattern', 'migration']);
export const RCCL_ADHERENCE_QUALITIES = new Set(['good', 'inconsistent', 'poor']);
export const RCCL_SCOPE_BASES = new Set(['single-file', 'directory-cluster', 'module-cluster', 'cross-root']);

export function validateCandidateObservationRecord(obs: Record<string, unknown>, prefix: string): string[] {
  const errors = validateCandidateCoreRecord(obs, prefix);

  if ('id' in obs) errors.push(`${prefix}: candidate observations must use 'provisional_id', not 'id'`);
  if ('scope' in obs) errors.push(`${prefix}: candidate observations must use 'scope_hint', not 'scope'`);
  if ('support' in obs) errors.push(`${prefix}: candidate observations must use 'support_hint', not 'support'`);
  if ('verification' in obs) errors.push(`${prefix}: candidate observations must not include 'verification'`);
  if ('lifecycle' in obs) errors.push(`${prefix}: candidate observations must not include 'lifecycle'`);

  if (!Array.isArray(obs.source_slice_ids) || obs.source_slice_ids.length === 0) {
    errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
  } else if (!obs.source_slice_ids.every(isNonEmptyString)) {
    errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
  }

  if (obs.support_hint != null) {
    const supportHint = obs.support_hint as Record<string, unknown>;
    if (typeof supportHint !== 'object' || Array.isArray(supportHint)) {
      errors.push(`${prefix}.support_hint: must be an object when present`);
    } else {
      if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
      if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
      if (supportHint.scope_basis != null && !RCCL_SCOPE_BASES.has(String(supportHint.scope_basis))) {
        errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
      }
    }
  }
  errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));

  return errors;
}

export function validateCandidateObservationShape(observation: CandidateObservation, prefix: string): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(observation.provisional_id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
  else if (!RCCL_OBSERVATION_ID_PATTERN.test(observation.provisional_id)) {
    errors.push(`${prefix}: 'provisional_id' "${observation.provisional_id}" does not match /^obs-[a-z0-9-]+$/`);
  }

  if (!isNonEmptyString(observation.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
  if (!RCCL_CATEGORIES.has(observation.category)) errors.push(`${prefix}: 'category' is invalid`);
  if (!isNonEmptyString(observation.scope_hint)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
  if (!isNonEmptyString(observation.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
  if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
    errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${observation.confidence}`);
  }
  if (!RCCL_ADHERENCE_QUALITIES.has(observation.adherence_quality)) errors.push(`${prefix}: 'adherence_quality' is invalid`);
  if (!observation.source_slice_ids?.length) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
  else if (!observation.source_slice_ids.every(isNonEmptyString)) {
    errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
  }
  errors.push(...validateEvidenceShape(observation.evidence, prefix));

  const supportHint = observation.support_hint;
  if (supportHint != null) {
    if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
    if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
    if (supportHint.scope_basis != null && !isScopeBasis(supportHint.scope_basis)) errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
  }
  errors.push(...validateTraitsRecord(observation.traits, `${prefix}.traits`));

  return errors;
}

export function validateEvidenceSnippet(snippet: unknown, prefix: string, index: number): string[] {
  if (typeof snippet !== 'string') return [];
  const normalized = snippet.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [`${prefix}.evidence[${index}]: snippet must not be empty`];

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const tokenMatches = normalized.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
  const identifierCount = tokenMatches.filter((token) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)).length;
  const punctuationCount = tokenMatches.length - identifierCount;
  const hasDistinctiveStructure = /[{}();=>]|\b(import|export|return|const|let|var|function|class|interface|type|if|for|while|switch|case|await|async)\b/.test(normalized);

  if (lines.length >= 2 || hasDistinctiveStructure) return [];
  if (tokenMatches.length < 4) {
    return [`${prefix}.evidence[${index}]: snippet is too short to verify reliably; include at least a distinctive statement or 2+ lines of code`];
  }
  if (identifierCount <= 2 && punctuationCount === 0) {
    return [`${prefix}.evidence[${index}]: snippet looks like an identifier or label, not a verifiable code fragment`];
  }
  return [];
}

function validateCandidateCoreRecord(obs: Record<string, unknown>, prefix: string): string[] {
  const errors: string[] = [];
  const id = obs.provisional_id;
  const scope = obs.scope_hint;

  if (!isNonEmptyString(id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
  else if (!RCCL_OBSERVATION_ID_PATTERN.test(id)) errors.push(`${prefix}: 'provisional_id' "${id}" does not match /^obs-[a-z0-9-]+$/`);

  if (!RCCL_CATEGORIES.has(String(obs.category))) errors.push(`${prefix}: 'category' is invalid`);
  if (!isNonEmptyString(obs.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
  if (!isNonEmptyString(scope)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
  if (!isNonEmptyString(obs.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
  if (typeof obs.confidence !== 'number' || !Number.isFinite(obs.confidence) || obs.confidence < 0 || obs.confidence > 1) {
    errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${obs.confidence}`);
  }
  if (!RCCL_ADHERENCE_QUALITIES.has(String(obs.adherence_quality))) errors.push(`${prefix}: 'adherence_quality' is invalid`);
  errors.push(...validateEvidenceRecord(obs.evidence, prefix));
  errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));

  return errors;
}

export function validateTraitsRecord(value: unknown, prefix: string): string[] {
  if (value == null) return [];
  const errors: string[] = [];
  if (!isRecord(value)) return [`${prefix}: must be an object when present`];
  const allowed = new Set(['legacy', 'migration_boundary', 'anti_pattern', 'compatibility_boundary']);
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (!allowed.has(key)) errors.push(`${prefix}.${key}: unsupported trait`);
    else if (typeof item !== 'boolean') errors.push(`${prefix}.${key}: must be boolean`);
  }
  return errors;
}

function validateEvidenceRecord(value: unknown, prefix: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${prefix}: 'evidence' must be a non-empty array`);
    return errors;
  }
  for (let i = 0; i < value.length; i += 1) {
    const evidence = value[i];
    if (!isRecord(evidence)) {
      errors.push(`${prefix}.evidence[${i}]: must be an object`);
      continue;
    }
    if (!isNonEmptyString(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
    if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
    if (!isNonEmptyString(evidence.snippet)) {
      errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
    } else {
      errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
    }
  }
  return errors;
}

function validateEvidenceShape(value: CandidateObservation['evidence'], prefix: string): string[] {
  const errors: string[] = [];
  if (!value?.length) {
    errors.push(`${prefix}: 'evidence' must be a non-empty array`);
    return errors;
  }
  for (let i = 0; i < value.length; i += 1) {
    const evidence = value[i];
    if (!isNonEmptyString(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
    if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
    if (!isNonEmptyString(evidence.snippet)) {
      errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
    } else {
      errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
    }
  }
  return errors;
}

function isValidLineRange(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [start, end] = value;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isScopeBasis(value: unknown): value is ScopeBasis {
  return value === 'single-file'
    || value === 'directory-cluster'
    || value === 'module-cluster'
    || value === 'cross-root';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
