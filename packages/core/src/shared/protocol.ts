import { createHash } from 'node:crypto';

export const SEMANTIC_DELEGATION_PROTOCOL = 'cognitive-adoption' as const;
export const SEMANTIC_DELEGATION_SCHEMA_VERSION = '1' as const;

export type SemanticDelegationProtocol = typeof SEMANTIC_DELEGATION_PROTOCOL;
export type SemanticDelegationSchemaVersion = typeof SEMANTIC_DELEGATION_SCHEMA_VERSION;

export interface ProtocolEnvelope {
  protocol: SemanticDelegationProtocol;
  schemaVersion: SemanticDelegationSchemaVersion;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export function assertProtocol(value: unknown, operation: string): asserts value is ProtocolEnvelope {
  if (!isRecord(value)) {
    throw new Error(`${operation} input must be an object.`);
  }
  if (value.protocol !== SEMANTIC_DELEGATION_PROTOCOL) {
    throw new Error(
      `UNSUPPORTED_PROTOCOL: ${operation} requires protocol ${SEMANTIC_DELEGATION_PROTOCOL}.`,
    );
  }
  if (value.schemaVersion !== SEMANTIC_DELEGATION_SCHEMA_VERSION) {
    throw new Error(
      `UNSUPPORTED_SCHEMA_VERSION: ${operation} requires schema ${SEMANTIC_DELEGATION_SCHEMA_VERSION}.`,
    );
  }
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function stableFingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const accepted = new Set(allowed);
  return Object.keys(value).filter((key) => !accepted.has(key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

export function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function isSafeRepositoryPath(value: unknown): value is string {
  return typeof value === 'string'
    && Boolean(value)
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
