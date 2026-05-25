import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import type { IgnoredReason } from '../types.ts';
import type {
  AdherenceEvaluationContractInput,
  AdherenceEvaluationContractOutput,
  AdherenceEvaluationValidationResult,
  ContractPayloadDiagnosticEntry,
  HostAdherenceEvaluationPayload,
  HostAdherenceVerdictEntry,
  ValidatedAdherenceVerdict,
} from './types.ts';

const MINIMUM_ADHERENCE_CONFIDENCE = 0.5;

const VALID_VERDICTS = new Set(['followed', 'ignored', 'partial']);

const VALID_IGNORED_REASONS: ReadonlySet<string> = new Set([
  'not-applicable', 'conflicts-with-task', 'too-broad',
  'repo-reality', 'false-positive', 'user-corrected', 'other',
]);

export function prepareAdherenceEvaluationContract(input: AdherenceEvaluationContractInput): AdherenceEvaluationContractOutput {
  const { directives, taskDescription, artifactPath } = input;
  const schema = buildAdherenceEvaluationSchema();
  const prompt = buildEvaluationPrompt(directives, taskDescription);
  const evaluationArtifact = {
    suggestedPath: artifactPath,
    format: 'json' as const,
    usage: `Write an adherence evaluation payload to ${artifactPath}, then pass --adherence-file ${artifactPath} to complete.`,
  };

  return {
    evaluationPrompt: prompt,
    evaluationSchema: JSON.stringify(schema, null, 2),
    evaluationArtifact,
    contract: {
      contractVersion: 'ai-contract/v1',
      kind: 'adherence-evaluation',
      schemaId: 'runtime.adherence-evaluation-payload',
      schemaVersion: '1.0',
      prompt,
      schema,
      artifact: evaluationArtifact,
      allowedIds: {
        directiveIds: directives.map((d) => d.id),
      },
      provenance: {
        owner: 'runtime',
        deterministic: true,
      },
      cacheKeyMaterial: {
        directiveIds: directives.map((d) => d.id),
        schemaId: 'runtime.adherence-evaluation-payload',
      },
    },
  };
}

export function validateAdherenceEvaluationPayload(
  raw: unknown,
  allowedDirectiveIds: readonly string[],
): AdherenceEvaluationValidationResult {
  const entries: ContractPayloadDiagnosticEntry[] = [];
  const verdicts: ValidatedAdherenceVerdict[] = [];
  const allowedIds = new Set(allowedDirectiveIds);

  if (!isAdherencePayload(raw)) {
    entries.push({
      status: raw === undefined || raw === null ? 'unused' : 'rejected',
      reason: raw === undefined || raw === null ? 'empty-payload' : 'malformed-payload',
      path: 'payload',
      message: raw === undefined || raw === null
        ? 'No adherence evaluation payload was provided.'
        : 'Adherence evaluation payload must be an object with a verdicts array.',
    });
    return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evaluation', entries) };
  }

  if (!raw.verdicts.length) {
    entries.push({
      status: 'unused',
      reason: 'empty-payload',
      path: 'verdicts',
      message: 'Adherence evaluation payload contains an empty verdicts array.',
    });
    return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evaluation', entries) };
  }

  for (let i = 0; i < raw.verdicts.length; i++) {
    const item = raw.verdicts[i];
    const path = `verdicts[${i}]`;

    if (!isVerdictEntry(item)) {
      entries.push({
        status: 'rejected',
        reason: 'malformed-payload',
        path,
        message: 'Verdict entry must include directive_id (string), verdict (followed|ignored|partial), confidence (number), and reason (string).',
        directiveId: typeof item === 'object' && item !== null ? (item as Record<string, unknown>).directive_id as string : undefined,
      });
      continue;
    }

    if (!allowedIds.has(item.directive_id)) {
      entries.push({
        status: 'rejected',
        reason: 'invalid-id',
        path,
        message: `Directive ID "${item.directive_id}" is not in the allowed set.`,
        directiveId: item.directive_id,
        confidence: item.confidence,
      });
      continue;
    }

    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      entries.push({
        status: 'rejected',
        reason: 'malformed-payload',
        path,
        message: `Confidence must be a finite number between 0 and 1, got ${item.confidence}.`,
        directiveId: item.directive_id,
        confidence: item.confidence,
      });
      continue;
    }

    if (item.confidence < MINIMUM_ADHERENCE_CONFIDENCE) {
      entries.push({
        status: 'rejected',
        reason: 'low-confidence',
        path,
        message: `Confidence ${item.confidence} is below the minimum threshold ${MINIMUM_ADHERENCE_CONFIDENCE}.`,
        directiveId: item.directive_id,
        confidence: item.confidence,
      });
      continue;
    }

    const ignoredReason = item.verdict === 'ignored' && item.ignored_reason && VALID_IGNORED_REASONS.has(item.ignored_reason)
      ? item.ignored_reason as IgnoredReason
      : undefined;

    verdicts.push({
      directive_id: item.directive_id,
      verdict: item.verdict,
      confidence: item.confidence,
      reason: item.reason,
      ...(ignoredReason ? { ignored_reason: ignoredReason } : {}),
    });

    entries.push({
      status: 'accepted',
      reason: 'accepted',
      path,
      message: `Adherence verdict accepted: ${item.verdict} (confidence ${item.confidence}).`,
      directiveId: item.directive_id,
      confidence: item.confidence,
    });
  }

  return { verdicts, diagnostics: buildContractPayloadDiagnostics('adherence-evaluation', entries) };
}

function isAdherencePayload(value: unknown): value is HostAdherenceEvaluationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<HostAdherenceEvaluationPayload>;
  return Array.isArray(candidate.verdicts);
}

function isVerdictEntry(value: unknown): value is HostAdherenceVerdictEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<HostAdherenceVerdictEntry>;
  return typeof entry.directive_id === 'string'
    && typeof entry.verdict === 'string'
    && VALID_VERDICTS.has(entry.verdict)
    && typeof entry.confidence === 'number'
    && typeof entry.reason === 'string';
}

function buildAdherenceEvaluationSchema(): unknown {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            directive_id: { type: 'string' },
            verdict: { enum: ['followed', 'ignored', 'partial'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
            ignored_reason: {
              enum: ['not-applicable', 'conflicts-with-task', 'too-broad', 'repo-reality', 'false-positive', 'user-corrected', 'other'],
            },
          },
          required: ['directive_id', 'verdict', 'confidence', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  };
}

function buildEvaluationPrompt(
  directives: AdherenceEvaluationContractInput['directives'],
  taskDescription: string,
): string {
  const directiveLines = directives.map((d) =>
    `- ${d.id}: [${d.prescription}] ${d.description} (execution_mode: ${d.execution_mode})`
  );

  return [
    'Evaluate adherence to the compiled directives after implementation.',
    'For each directive that was part of the compiled EGO, produce a verdict:',
    '  - "followed": the implementation clearly follows this directive',
    '  - "ignored": the implementation clearly does not follow this directive',
    '  - "partial": the implementation partially follows this directive',
    '',
    'For ignored directives, provide an ignored_reason from the allowed set.',
    'Set confidence to reflect how certain you are about the verdict (0.0–1.0).',
    'Provide a brief reason explaining the basis for each verdict.',
    '',
    `Task description: ${taskDescription}`,
    '',
    'Compiled directives:',
    ...directiveLines,
  ].join('\n');
}
