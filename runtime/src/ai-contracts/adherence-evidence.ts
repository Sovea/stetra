import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import { verifyEvidenceRefs } from './evidence.ts';
import { artifactIdentity, contractVersionDiagnostic, isRecord, normalizeEvidenceRefs, validConfidence, validEvidenceRefs } from './shared.ts';
import {
  AI_CONTRACT_VERSION,
  type AdherenceEvidenceContractInput,
  type AdherenceEvidenceContractOutput,
  type AdherenceEvidenceValidationResult,
  type ContractPayloadDiagnosticEntry,
  type EvidenceRefVerificationContext,
  type HostAdherenceEvidenceEntry,
  type ValidatedAdherenceEvidenceVerdict,
} from './types.ts';
import type { IgnoredReason } from '../types.ts';

const MINIMUM_ADHERENCE_CONFIDENCE = 0.5;
const VERDICTS = new Set(['followed', 'ignored', 'partial', 'unverified']);
const IGNORED_REASONS = new Set(['not-applicable', 'conflicts-with-task', 'too-broad', 'repo-reality', 'false-positive', 'user-corrected', 'other']);

const ADHERENCE_EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: { type: 'array' },
  },
  required: ['verdicts'],
};

export function prepareAdherenceEvidenceContract(input: AdherenceEvidenceContractInput): AdherenceEvidenceContractOutput {
  const prompt = buildEvidencePrompt(input.directives, input.taskDescription);
  const artifact = {
    suggestedPath: input.artifactPath,
    format: 'json' as const,
    usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind adherence-evidence, the issued requestId/contextFingerprint as request_id/context_fingerprint, and verdicts under payload; then pass it to complete with --adherence-file ${input.artifactPath}.`,
  };
  return {
    evidencePrompt: prompt,
    evidenceSchema: JSON.stringify(ADHERENCE_EVIDENCE_SCHEMA, null, 2),
    evidenceArtifact: artifact,
    contract: {
      contractVersion: AI_CONTRACT_VERSION,
      kind: 'adherence-evidence',
      ...artifactIdentity('adherence-evidence', { directiveIds: input.directives.map((directive) => directive.id), schemaId: 'runtime.adherence-evidence' }),
      schemaId: 'runtime.adherence-evidence',
      schemaVersion: '1.0',
      prompt,
      schema: ADHERENCE_EVIDENCE_SCHEMA,
      artifact,
      allowedIds: { directiveIds: input.directives.map((directive) => directive.id) },
      provenance: { owner: 'runtime', deterministic: true },
      cacheKeyMaterial: { directiveIds: input.directives.map((directive) => directive.id), schemaId: 'runtime.adherence-evidence' },
    },
  };
}

export function validateAdherenceEvidencePayload(
  raw: unknown,
  allowedDirectiveIds: readonly string[],
  evidenceContext?: EvidenceRefVerificationContext,
): AdherenceEvidenceValidationResult {
  const entries: ContractPayloadDiagnosticEntry[] = [];
  const verdicts: ValidatedAdherenceEvidenceVerdict[] = [];
  const allowedIds = new Set(allowedDirectiveIds);
  const versionDiagnostic = contractVersionDiagnostic(raw, 'adherence-evidence');
  if (versionDiagnostic) {
    return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evidence', [versionDiagnostic]) };
  }

  if (!isAdherencePayload(raw)) {
    entries.push({
      status: raw == null ? 'unused' : 'rejected',
      reason: raw == null ? 'empty-payload' : 'malformed-payload',
      path: 'payload',
      message: raw == null ? 'No adherence evidence payload was provided.' : 'Adherence evidence payload must be an object with a verdicts array.',
    });
    return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evidence', entries) };
  }

  const seen = new Set<string>();
  raw.verdicts.forEach((item, index) => {
    const path = `verdicts[${index}]`;
    if (!isVerdictEntry(item)) {
      entries.push({
        status: 'rejected',
        reason: 'malformed-payload',
        path,
        message: 'Verdict must include directive_id, verdict, confidence, evidence_refs, and reason.',
        directiveId: isRecord(item) && typeof item.directive_id === 'string' ? item.directive_id : undefined,
      });
      return;
    }
    if (!allowedIds.has(item.directive_id)) {
      entries.push(rejected(path, 'invalid-id', `Directive id "${item.directive_id}" is not allowed.`, item));
      return;
    }
    if (seen.has(item.directive_id)) {
      entries.push(rejected(path, 'duplicate-id', `Directive id "${item.directive_id}" already has a verdict.`, item));
      return;
    }
    seen.add(item.directive_id);
    if (item.confidence < MINIMUM_ADHERENCE_CONFIDENCE) {
      entries.push(rejected(path, 'low-confidence', `Confidence ${item.confidence} is below ${MINIMUM_ADHERENCE_CONFIDENCE}.`, item));
      return;
    }
    const nonUnverified = item.verdict !== 'unverified';
    const evidenceRefs = validEvidenceRefs(item.evidence_refs) ? normalizeEvidenceRefs(item.evidence_refs) : [];
    if (nonUnverified && !evidenceRefs.length) {
      verdicts.push(toUnverified(item, evidenceRefs));
      entries.push(downgraded(path, 'missing-evidence', 'Non-unverified adherence verdict lacks evidence_refs; recorded as unverified and excluded from follow rate.', item));
      return;
    }
    if (nonUnverified && evidenceRefs.length) {
      const evidence = verifyEvidenceRefs(evidenceRefs, evidenceContext);
      if (evidence.conversationOnly) {
        verdicts.push(toUnverified(item, evidenceRefs));
        entries.push(downgraded(
          path,
          'conversation-only-evidence',
          `Conversation-only adherence evidence cannot update follow rate; recorded as unverified. Evidence verification: ${summarizeEvidenceVerification(evidence)}.`,
          item,
        ));
        return;
      }
      if (!evidence.hasStaticEvidence) {
        verdicts.push(toUnverified(item, evidenceRefs));
        entries.push(downgraded(
          path,
          'insufficient-static-evidence',
          `Adherence verdict lacks statically verified file, diff, command, or runtime trace evidence; recorded as unverified. Evidence verification: ${summarizeEvidenceVerification(evidence)}.`,
          item,
        ));
        return;
      }
    }
    const ignoredReason = item.verdict === 'ignored' && item.ignored_reason && IGNORED_REASONS.has(item.ignored_reason)
      ? item.ignored_reason as IgnoredReason
      : undefined;
    verdicts.push({
      directive_id: item.directive_id,
      verdict: item.verdict,
      confidence: item.confidence,
      evidence_refs: evidenceRefs,
      reason: item.reason,
      ...(ignoredReason ? { ignored_reason: ignoredReason } : {}),
    });
    entries.push({
      status: 'accepted',
      reason: 'accepted',
      path,
      message: `Adherence evidence verdict accepted: ${item.verdict}.`,
      directiveId: item.directive_id,
      confidence: item.confidence,
    });
  });

  if (!raw.verdicts.length) {
    entries.push({ status: 'unused', reason: 'empty-payload', path: 'verdicts', message: 'Adherence evidence payload contains no verdicts.' });
  }

  return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evidence', entries) };
}

function toUnverified(
  item: HostAdherenceEvidenceEntry,
  evidenceRefs: HostAdherenceEvidenceEntry['evidence_refs'],
): ValidatedAdherenceEvidenceVerdict {
  return {
    directive_id: item.directive_id,
    verdict: 'unverified',
    confidence: item.confidence,
    evidence_refs: evidenceRefs,
    reason: item.reason,
  };
}

function summarizeEvidenceVerification(evidence: ReturnType<typeof verifyEvidenceRefs>): string {
  return evidence.entries.map((entry) => `${entry.ref.kind}:${entry.status}:${entry.reason}`).join('; ') || 'none';
}

function isAdherencePayload(value: unknown): value is { verdicts: unknown[] } {
  return isRecord(value) && Array.isArray(value.verdicts);
}

function isVerdictEntry(value: unknown): value is HostAdherenceEvidenceEntry {
  if (!isRecord(value)) return false;
  return typeof value.directive_id === 'string'
    && typeof value.verdict === 'string'
    && VERDICTS.has(value.verdict)
    && validConfidence(value.confidence)
    && Array.isArray(value.evidence_refs)
    && typeof value.reason === 'string';
}

function rejected(
  path: string,
  reason: ContractPayloadDiagnosticEntry['reason'],
  message: string,
  item: Partial<HostAdherenceEvidenceEntry>,
): ContractPayloadDiagnosticEntry {
  return {
    status: 'rejected',
    reason,
    path,
    message,
    directiveId: item.directive_id,
    confidence: item.confidence,
  };
}

function downgraded(
  path: string,
  reason: ContractPayloadDiagnosticEntry['reason'],
  message: string,
  item: Partial<HostAdherenceEvidenceEntry>,
): ContractPayloadDiagnosticEntry {
  return {
    status: 'downgraded',
    reason,
    path,
    message,
    directiveId: item.directive_id,
    confidence: item.confidence,
  };
}

function buildEvidencePrompt(
  directives: AdherenceEvidenceContractInput['directives'],
  taskDescription: string,
): string {
  return [
    'Evaluate adherence to compiled directives after implementation.',
    'Every followed, ignored, or partial verdict must cite evidence_refs from diff, file snippets, test/command output, or implementation evidence.',
    'Use "unverified" when you did not inspect enough evidence. Unverified directives do not update follow rate.',
    'Return JSON only.',
    '',
    `Task description: ${taskDescription}`,
    '',
    'Compiled directives:',
    ...directives.map((directive) => `- ${directive.id}: [${directive.prescription}] ${directive.description} (execution_mode: ${directive.execution_mode})`),
  ].join('\n');
}
