import { buildContractPayloadDiagnostics } from './diagnostics.ts';
import type {
  ContractPayloadDiagnosticEntry,
  GuidancePlanningContractInput,
  GuidancePlanningContractName,
  GuidancePlanningContractOutput,
  GuidancePlanningReasonId,
  GuidancePlanningSemanticNeed,
  GuidancePlanningValidationResult,
  HostGuidancePlanningPayload,
} from './types.ts';

const GUIDANCE_PLANNING_CONTRACTS: readonly GuidancePlanningContractName[] = [
  'task-interpretation',
  'semantic-candidate',
  'semantic-relation',
  'adherence-evaluation',
];

const GUIDANCE_PLANNING_REASONS: readonly GuidancePlanningReasonId[] = [
  'task-meaning-needs-host-context',
  'repository-context-may-change-guidance',
  'directive-observation-relation-needed',
  'potential-context-tension',
  'high-risk-or-sensitive-change',
  'user-requested-governance',
  'straightforward-low-risk-change',
  'insufficient-information',
];

const GUIDANCE_PLANNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    semantic_need: { enum: ['low', 'medium', 'high'] },
    useful_contracts: {
      type: 'array',
      items: { enum: Array.from(GUIDANCE_PLANNING_CONTRACTS) },
    },
    reasons: {
      type: 'array',
      items: { enum: Array.from(GUIDANCE_PLANNING_REASONS) },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['semantic_need', 'useful_contracts', 'reasons', 'confidence'],
};

export function prepareGuidancePlanningContract(input: GuidancePlanningContractInput): GuidancePlanningContractOutput {
  const prompt = buildPlanningPrompt(input);
  const artifact = {
    suggestedPath: input.artifactPath,
    format: 'json' as const,
    usage: `Write the guidance planning payload to ${input.artifactPath}, then re-run auto with --planning-file ${input.artifactPath}.`,
  };

  return {
    planningPrompt: prompt,
    planningSchema: JSON.stringify(GUIDANCE_PLANNING_SCHEMA, null, 2),
    planningArtifact: artifact,
    contract: {
      contractVersion: 'ai-contract/v1',
      kind: 'guidance-planning',
      schemaId: 'runtime.guidance-planning',
      schemaVersion: '1.0',
      prompt,
      schema: GUIDANCE_PLANNING_SCHEMA,
      artifact,
      provenance: {
        owner: 'runtime',
        deterministic: true,
      },
      cacheKeyMaterial: {
        task: input.task,
        sourceStatus: input.sourceStatus,
        schemaId: 'runtime.guidance-planning',
      },
    },
  };
}

export function validateGuidancePlanningPayload(raw: unknown): GuidancePlanningValidationResult {
  const entries: ContractPayloadDiagnosticEntry[] = [];

  if (!isGuidancePlanningPayload(raw)) {
    entries.push({
      status: raw === undefined || raw === null ? 'unused' : 'rejected',
      reason: raw === undefined || raw === null ? 'empty-payload' : 'malformed-payload',
      path: 'planning',
      message: 'Guidance planning payload must include semantic_need, useful_contracts, reasons, and confidence.',
    });
    return {
      proposal: null,
      diagnostics: buildContractPayloadDiagnostics('guidance-planning', entries),
    };
  }

  if (raw.confidence < 0.5) {
    entries.push({
      status: 'downgraded',
      reason: 'low-confidence',
      path: 'planning.confidence',
      message: 'Guidance planning proposal was below the confidence threshold and will not drive contract selection.',
      confidence: raw.confidence,
    });
    return {
      proposal: null,
      diagnostics: buildContractPayloadDiagnostics('guidance-planning', entries),
    };
  }

  const proposal = {
    semantic_need: raw.semantic_need,
    useful_contracts: unique(raw.useful_contracts),
    reasons: unique(raw.reasons),
    confidence: raw.confidence,
  };

  entries.push({
    status: 'accepted',
    reason: 'accepted',
    path: 'planning',
    message: 'Guidance planning proposal accepted for Runtime adjudication.',
    confidence: raw.confidence,
  });

  return {
    proposal,
    diagnostics: buildContractPayloadDiagnostics('guidance-planning', entries),
  };
}

function buildPlanningPrompt(input: GuidancePlanningContractInput): string {
  return [
    'Produce a bounded guidance planning proposal for Runtime.',
    'Your output is only a proposal. Runtime will validate and adjudicate it before requesting more contracts.',
    'Do not provide free-form policy, code guidance, or repository summaries.',
    'Use semantic judgment from the user request and available conversation context to identify which Runtime contracts are useful.',
    'Prefer task-interpretation when semantic task fields need host context.',
    'Use semantic-candidate when repository observations may be semantically related to active directives.',
    'Use semantic-relation only when explicit directive-observation relation judgment is likely worth the extra artifact.',
    'Use adherence-evaluation only when post-change evidence should affect quality feedback.',
    '',
    `Task description: ${input.task.description}`,
    `Explicit operation: ${input.task.operation ?? '(none)'}`,
    `Explicit target file: ${input.task.targetFile ?? '(none)'}`,
    `Explicit changed files: ${input.task.changedFiles?.join(', ') || '(none)'}`,
    `Explicit tech stack: ${input.task.techStack?.join(', ') || '(none)'}`,
    `Explicit tags: ${input.task.tags?.join(', ') || '(none)'}`,
    `Local augment status: ${input.sourceStatus.localAugment}`,
    `RCCL status: ${input.sourceStatus.rccl}`,
    `Lockfile status: ${input.sourceStatus.lockfile}`,
    '',
    'Return JSON only, matching the provided schema.',
  ].join('\n');
}

function isGuidancePlanningPayload(value: unknown): value is HostGuidancePlanningPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<HostGuidancePlanningPayload>;
  return isSemanticNeed(candidate.semantic_need)
    && Array.isArray(candidate.useful_contracts)
    && candidate.useful_contracts.every(isContractName)
    && Array.isArray(candidate.reasons)
    && candidate.reasons.every(isReasonId)
    && typeof candidate.confidence === 'number'
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1;
}

function isSemanticNeed(value: unknown): value is GuidancePlanningSemanticNeed {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isContractName(value: unknown): value is GuidancePlanningContractName {
  return GUIDANCE_PLANNING_CONTRACTS.includes(value as GuidancePlanningContractName);
}

function isReasonId(value: unknown): value is GuidancePlanningReasonId {
  return GUIDANCE_PLANNING_REASONS.includes(value as GuidancePlanningReasonId);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
