import { createHash } from 'node:crypto';
import { AI_CONTRACT_VERSION, type AIContractKind, type ContractPayloadDiagnosticEntry, type EvidenceRef } from './types.ts';
import { isRecord, unique, validConfidence } from '../utils/common.ts';

export { isRecord, unique, validConfidence };

export function stableRefHash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (!isRecord(value)) return false;
  if (!isEvidenceKind(value.kind)) return false;
  if (typeof value.ref !== 'string' || !value.ref.trim()) return false;
  if (value.line_range !== undefined && !isLineRange(value.line_range)) return false;
  if (value.file !== undefined && typeof value.file !== 'string') return false;
  if (value.snippet_hash !== undefined && typeof value.snippet_hash !== 'string') return false;
  if (value.command !== undefined && typeof value.command !== 'string') return false;
  if (value.output_hash !== undefined && typeof value.output_hash !== 'string') return false;
  return true;
}

export function validEvidenceRefs(value: unknown): value is EvidenceRef[] {
  return Array.isArray(value) && value.length > 0 && value.every(isEvidenceRef);
}

export function normalizeEvidenceRefs(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEvidenceRef).map((ref) => ({ ...ref, ref: ref.ref.trim() }));
}

export function contractVersionDiagnostic(raw: unknown, expectedKind: AIContractKind): ContractPayloadDiagnosticEntry | null {
  if (!isRecord(raw)) return null;
  if (!('contractVersion' in raw) && !('schemaVersion' in raw) && !('kind' in raw)) return null;
  if (raw.contractVersion !== AI_CONTRACT_VERSION) {
    return {
      status: 'rejected',
      reason: 'unsupported-value',
      path: 'contractVersion',
      message: `Unsupported contractVersion "${String(raw.contractVersion)}"; expected ai-contract/v2 ${expectedKind} payload.`,
    };
  }
  if (raw.kind !== expectedKind) {
    return {
      status: 'rejected',
      reason: 'unsupported-value',
      path: 'kind',
      message: `Unsupported contract kind "${String(raw.kind)}"; expected ${expectedKind}.`,
    };
  }
  return {
    status: 'rejected',
    reason: 'malformed-payload',
    path: 'payload',
    message: `Received a contract envelope for ${expectedKind}; provide the artifact payload body, not the contract metadata envelope.`,
  };
}

function isEvidenceKind(value: unknown): boolean {
  return value === 'file'
    || value === 'diff'
    || value === 'command'
    || value === 'rccl-evidence'
    || value === 'runtime-trace'
    || value === 'conversation';
}

function isLineRange(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
    && Number.isInteger(value[0])
    && Number.isInteger(value[1])
    && value[0] >= 1
    && value[1] >= value[0];
}

