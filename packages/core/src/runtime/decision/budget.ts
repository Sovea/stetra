import type {
  DecisionTrace,
  EffectiveGuidance,
  ExecutionAvoidGuidanceItem,
  ExecutionGuidance,
  ExecutionGuidanceItem,
  GuidanceDeliverySelection,
  GuidanceOverflow,
} from './types.ts';

export const DEFAULT_GUIDANCE_BYTE_LIMIT = 6_000;

export type GuidanceDeliveryResult =
  | {
      status: 'ready';
      guidance: EffectiveGuidance;
      executionGuidance: ExecutionGuidance;
      omissions: DecisionTrace['omissions'];
      deliveredBytes: number;
      mandatoryBytes: number;
      fullGuidanceBytes: number;
      selection: GuidanceDeliverySelection | null;
    }
  | {
      status: 'overflow';
      overflow: Omit<
        GuidanceOverflow,
        'schemaVersion' | 'task' | 'status' | 'candidateDetails' | 'diagnostics'
      >;
    };

export function applyGuidanceDelivery(
  input: EffectiveGuidance,
  byteLimit = DEFAULT_GUIDANCE_BYTE_LIMIT,
  selection?: GuidanceDeliverySelection,
): GuidanceDeliveryResult {
  assertByteLimit(byteLimit);
  const normalizedSelection = normalizeSelection(selection, input);
  const selectedIds = normalizedSelection
    ? new Set(normalizedSelection.considerIds)
    : null;
  const consider = selectedIds
    ? input.consider.filter((item) => selectedIds.has(item.id))
    : input.consider;
  const guidance: EffectiveGuidance = {
    required: input.required,
    consider,
    avoid: input.avoid,
    tensions: input.tensions,
  };
  const omissions: DecisionTrace['omissions'] = selectedIds
    ? input.consider
      .filter((item) => !selectedIds.has(item.id))
      .map((item) => ({ id: item.id, section: 'consider', reason: 'host-selection' as const }))
    : [];
  const mandatory: EffectiveGuidance = {
    required: input.required,
    consider: [],
    avoid: input.avoid,
    tensions: input.tensions,
  };
  const executionGuidance = toExecutionGuidance(guidance);
  const mandatoryExecutionGuidance = toExecutionGuidance(mandatory);
  const deliveredBytes = serializedBytes(executionGuidance);
  const mandatoryBytes = serializedBytes(mandatoryExecutionGuidance);
  const fullGuidanceBytes = serializedBytes(guidance);
  if (deliveredBytes <= byteLimit) {
    return {
      status: 'ready',
      guidance,
      executionGuidance,
      omissions,
      deliveredBytes,
      mandatoryBytes,
      fullGuidanceBytes,
      selection: normalizedSelection,
    };
  }

  return {
    status: 'overflow',
    overflow: {
      byteLimit,
      totalBytes: deliveredBytes,
      mandatoryBytes,
      fullGuidanceBytes,
      mandatoryGuidanceIds: [
        ...input.required.map((item) => item.id),
        ...input.avoid.map((item) => item.id),
        ...input.tensions.map((item) => item.id),
      ],
      mandatoryGuidance: {
        required: mandatoryExecutionGuidance.required,
        avoid: mandatoryExecutionGuidance.avoid,
        tensions: mandatoryExecutionGuidance.tensions,
      },
      selectableConsider: input.consider.map((item) => {
        const executionItem = toExecutionGuidanceItem(item);
        return {
          ...executionItem,
          bytes: serializedBytes(executionItem),
          source: item.source,
        };
      }),
      selection: normalizedSelection,
      reasons: mandatoryBytes > byteLimit
        ? ['Mandatory required, avoid, and tension guidance exceeds the configured byte limit; policy or task scope must be resolved explicitly.']
        : ['Optional consider guidance exceeds the configured byte limit; submit an explicit delivery selection with a rationale.'],
    },
  };
}

export function toExecutionGuidance(input: EffectiveGuidance): ExecutionGuidance {
  return {
    required: input.required.map(toExecutionGuidanceItem),
    consider: input.consider.map(toExecutionGuidanceItem),
    avoid: input.avoid.map(toExecutionAvoidGuidanceItem),
    tensions: input.tensions,
  };
}

export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function toExecutionGuidanceItem(
  item: EffectiveGuidance['required'][number],
): ExecutionGuidanceItem {
  return {
    id: item.id,
    instruction: item.instruction,
    exceptions: item.exceptions,
    executionMode: item.executionMode,
    ...(item.example ? { example: item.example } : {}),
  };
}

function toExecutionAvoidGuidanceItem(
  item: EffectiveGuidance['avoid'][number],
): ExecutionAvoidGuidanceItem {
  return {
    id: item.id,
    pattern: item.pattern,
    exceptions: item.exceptions,
  };
}

function assertByteLimit(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('compileChange guidanceByteLimit must be a positive integer number of UTF-8 bytes.');
  }
}

function normalizeSelection(
  selection: GuidanceDeliverySelection | undefined,
  guidance: EffectiveGuidance,
): GuidanceDeliverySelection | null {
  if (selection === undefined) return null;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new Error('compileChange deliverySelection must be an object.');
  }
  if (!Array.isArray(selection.considerIds)
    || selection.considerIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('compileChange deliverySelection.considerIds must be a string array.');
  }
  if (typeof selection.rationale !== 'string' || !selection.rationale.trim()) {
    throw new Error('compileChange deliverySelection.rationale must be non-empty.');
  }
  const requestedIds = [...new Set(selection.considerIds.map((id) => id.trim()))];
  const active = new Set(guidance.consider.map((item) => item.id));
  const unknown = requestedIds.filter((id) => !active.has(id));
  if (unknown.length) {
    throw new Error(`compileChange deliverySelection references inactive consider guidance: ${unknown.join(', ')}.`);
  }
  const requested = new Set(requestedIds);
  const considerIds = guidance.consider
    .map((item) => item.id)
    .filter((id) => requested.has(id));
  return { considerIds, rationale: selection.rationale.trim() };
}
