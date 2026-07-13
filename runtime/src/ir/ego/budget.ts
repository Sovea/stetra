import type { EffectiveGuidanceObject } from '../../types.ts';

export const EGO_BUDGET = {
  totalItems: 32,
  hardItems: 24,
  ambientItems: 6,
  examplesPerDirective: 1,
  serializedCharacters: 24_000,
} as const;

export interface EgoBudgetOmission {
  id: string;
  reason: 'hard-item-limit' | 'total-item-limit' | 'ambient-limit' | 'character-limit';
  original_priority: string;
}

export function applyEgoBudget(input: EffectiveGuidanceObject): {
  ego: EffectiveGuidanceObject;
  exceeded: boolean;
  omissions: EgoBudgetOmission[];
  serializedCharacters: number;
} {
  const omissions: EgoBudgetOmission[] = [];
  const must = input.guidance.must_follow.map((item) => ({ ...item, examples: item.examples.slice(0, EGO_BUDGET.examplesPerDirective) }));
  const hardMust = must.filter((item) => item.prescription === 'must');
  const soft = must.filter((item) => item.prescription !== 'must');
  const avoid = input.guidance.avoid;
  const hard = [
    ...hardMust.map((item) => ({ kind: 'must' as const, id: item.id, value: item, priority: `must:${item.execution_mode}` })),
    ...avoid.map((item) => ({ kind: 'avoid' as const, id: item.trigger, value: item, priority: 'avoid:verified-anti-pattern' })),
  ];
  const selectedHard = hard.slice(0, EGO_BUDGET.hardItems);
  for (const item of hard.slice(EGO_BUDGET.hardItems)) omissions.push({ id: item.id, reason: 'hard-item-limit', original_priority: item.priority });

  let remaining = EGO_BUDGET.totalItems - selectedHard.length;
  const selectedSoft = soft.slice(0, Math.max(0, remaining));
  remaining -= selectedSoft.length;
  for (const item of soft.slice(selectedSoft.length)) omissions.push({ id: item.id, reason: 'total-item-limit', original_priority: `should:${item.execution_mode}` });

  const selectedTensions = input.guidance.context_tensions.slice(0, Math.max(0, remaining));
  remaining -= selectedTensions.length;
  for (const item of input.guidance.context_tensions.slice(selectedTensions.length)) omissions.push({ id: `${item.directive_id}:tension`, reason: 'total-item-limit', original_priority: `tension:${item.review_priority ?? 'normal'}` });

  const ambientLimit = Math.min(EGO_BUDGET.ambientItems, Math.max(0, remaining));
  const selectedAmbient = input.guidance.ambient.slice(0, ambientLimit);
  for (let index = ambientLimit; index < input.guidance.ambient.length; index += 1) {
    omissions.push({ id: `ambient:${index}`, reason: index >= EGO_BUDGET.ambientItems ? 'ambient-limit' : 'total-item-limit', original_priority: 'ambient' });
  }

  const ego: EffectiveGuidanceObject = {
    ...input,
    guidance: {
      must_follow: [
        ...selectedHard.filter((item) => item.kind === 'must').map((item) => item.value),
        ...selectedSoft,
      ],
      avoid: selectedHard.filter((item) => item.kind === 'avoid').map((item) => item.value),
      context_tensions: selectedTensions,
      ambient: selectedAmbient,
    },
  };

  trimToCharacterBudget(ego, omissions);
  return {
    ego,
    exceeded: hard.length > EGO_BUDGET.hardItems || hardPayloadLength(hard) > EGO_BUDGET.serializedCharacters,
    omissions,
    serializedCharacters: JSON.stringify(ego).length,
  };
}

function trimToCharacterBudget(ego: EffectiveGuidanceObject, omissions: EgoBudgetOmission[]): void {
  while (JSON.stringify(ego).length > EGO_BUDGET.serializedCharacters) {
    if (ego.guidance.ambient.length) {
      const index = ego.guidance.ambient.length - 1;
      ego.guidance.ambient.pop();
      omissions.push({ id: `ambient:${index}`, reason: 'character-limit', original_priority: 'ambient' });
      continue;
    }
    const softIndex = findLastIndex(ego.guidance.must_follow, (item) => item.prescription === 'should');
    if (softIndex >= 0) {
      const [item] = ego.guidance.must_follow.splice(softIndex, 1);
      omissions.push({ id: item.id, reason: 'character-limit', original_priority: `should:${item.execution_mode}` });
      continue;
    }
    if (ego.guidance.context_tensions.length) {
      const item = ego.guidance.context_tensions.pop()!;
      omissions.push({ id: `${item.directive_id}:tension`, reason: 'character-limit', original_priority: `tension:${item.review_priority ?? 'normal'}` });
      continue;
    }
    const item = ego.guidance.must_follow.pop();
    if (item) {
      omissions.push({ id: item.id, reason: 'character-limit', original_priority: `must:${item.execution_mode}` });
      continue;
    }
    const avoid = ego.guidance.avoid.pop();
    if (avoid) {
      omissions.push({ id: avoid.trigger, reason: 'character-limit', original_priority: 'avoid:verified-anti-pattern' });
      continue;
    }
    break;
  }
}

function hardPayloadLength(hard: Array<{ value: unknown }>): number {
  return JSON.stringify(hard.map((item) => item.value)).length;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
  return -1;
}
