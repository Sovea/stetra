import { createHash } from 'node:crypto';
import {
  AI_CONTRACT_VERSION,
  type AIContractEnvelope,
  type AIContractKind,
  type ContractPayloadDiagnosticEntry,
  type EvidenceRef,
  type HostArtifactEnvelopeV1,
} from './types.ts';
import { isRecord, unique, validConfidence } from '../utils/common.ts';

export { isRecord, unique, validConfidence };

export function stableRefHash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function artifactIdentity(kind: AIContractKind, cacheKeyMaterial: unknown): Pick<AIContractEnvelope, 'requestId' | 'contextFingerprint'> {
  const contextFingerprint = stableRefHash({ kind, cacheKeyMaterial });
  return {
    requestId: `${kind}:${contextFingerprint}`,
    contextFingerprint,
  };
}

export function unwrapHostArtifactEnvelope(
  raw: unknown,
  expected: Pick<AIContractEnvelope, 'kind' | 'requestId' | 'contextFingerprint'>,
): { payload: unknown | null; diagnostic: ContractPayloadDiagnosticEntry | null } {
  if (!isRecord(raw)) {
    return {
      payload: null,
      diagnostic: {
        status: 'rejected',
        reason: 'malformed-payload',
        path: 'artifact',
        message: 'Host artifact must use the v1 envelope: schema_version, kind, request_id, context_fingerprint, payload.',
      },
    };
  }
  if (raw.schema_version !== 1) {
    return {
      payload: null,
      diagnostic: {
        status: 'rejected',
        reason: 'unsupported-schema-version',
        path: 'schema_version',
        message: `UNSUPPORTED_SCHEMA_VERSION: expected schema_version 1; found ${String(raw.schema_version)}. Re-run init and calibrate-repo-context. Existing data was not modified.`,
      },
    };
  }
  if (raw.kind !== expected.kind) {
    return rejectedEnvelope('kind', `Artifact kind "${String(raw.kind)}" does not match ${expected.kind}.`);
  }
  if (raw.request_id !== expected.requestId) {
    return rejectedEnvelope('request_id', 'Artifact request_id does not match the contract issued for this compile context.');
  }
  if (raw.context_fingerprint !== expected.contextFingerprint) {
    return rejectedEnvelope('context_fingerprint', 'Artifact context_fingerprint does not match current task and allowed-ID context.');
  }
  if (!('payload' in raw)) {
    return rejectedEnvelope('payload', 'Artifact envelope is missing payload.');
  }
  return { payload: raw.payload, diagnostic: null };
}

export function hostArtifactEnvelope<TPayload>(
  contract: Pick<AIContractEnvelope, 'kind' | 'requestId' | 'contextFingerprint'>,
  payload: TPayload,
): HostArtifactEnvelopeV1<TPayload> {
  return {
    schema_version: 1,
    kind: contract.kind,
    request_id: contract.requestId,
    context_fingerprint: contract.contextFingerprint,
    payload,
  };
}

function rejectedEnvelope(path: string, message: string): { payload: null; diagnostic: ContractPayloadDiagnosticEntry } {
  return {
    payload: null,
    diagnostic: {
      status: 'rejected',
      reason: path === 'kind' ? 'unsupported-value' : 'invalid-id',
      path,
      message,
    },
  };
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
      message: `UNSUPPORTED_SCHEMA_VERSION: unsupported contractVersion "${String(raw.contractVersion)}"; expected ${AI_CONTRACT_VERSION} ${expectedKind} payload. Re-run init and calibrate-repo-context for v1 artifacts.`,
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

