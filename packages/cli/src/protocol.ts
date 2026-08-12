import { createHash } from 'node:crypto';

export const DELEGATION_PROTOCOL = 'cognitive-adoption' as const;
export const DELEGATION_SCHEMA_VERSION = '1' as const;

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function stableFingerprint(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function taskIdForPrepareRequest(prepareRequestId: string): string {
  const digest = sha256(`prepare-request:${prepareRequestId}`).slice('sha256:'.length);
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [
        key,
        canonicalize((value as Record<string, unknown>)[key]),
      ]),
  );
}
