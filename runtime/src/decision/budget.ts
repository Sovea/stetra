import type {
  DecisionTrace,
  EffectiveGuidance,
} from './types.ts';

export const GUIDANCE_BUDGET = {
  required: 3,
  consider: 3,
  avoid: 2,
  tensions: 2,
  examplesPerItem: 1,
  serializedCharacters: 6_000,
} as const;

export function applyGuidanceBudget(input: EffectiveGuidance): {
  guidance: EffectiveGuidance;
  omissions: DecisionTrace['omissions'];
} {
  const omissions: DecisionTrace['omissions'] = [];
  const guidance: EffectiveGuidance = {
    required: limitItems(input.required, 'required', GUIDANCE_BUDGET.required, omissions)
      .map((item) => ({ ...item, examples: item.examples.slice(0, GUIDANCE_BUDGET.examplesPerItem) })),
    consider: limitItems(input.consider, 'consider', GUIDANCE_BUDGET.consider, omissions)
      .map((item) => ({ ...item, examples: item.examples.slice(0, GUIDANCE_BUDGET.examplesPerItem) })),
    avoid: limitItems(input.avoid, 'avoid', GUIDANCE_BUDGET.avoid, omissions),
    tensions: limitItems(input.tensions, 'tensions', GUIDANCE_BUDGET.tensions, omissions),
  };

  trimToCharacterLimit(guidance, omissions);
  return { guidance, omissions };
}

function limitItems<T extends { id: string }>(
  items: T[],
  section: DecisionTrace['omissions'][number]['section'],
  limit: number,
  omissions: DecisionTrace['omissions'],
): T[] {
  for (const item of items.slice(limit)) omissions.push({ id: item.id, section, reason: 'section-limit' });
  return items.slice(0, limit);
}

function trimToCharacterLimit(
  guidance: EffectiveGuidance,
  omissions: DecisionTrace['omissions'],
): void {
  const exampleCandidates = [...guidance.consider, ...guidance.required].reverse();
  for (const item of exampleCandidates) {
    if (JSON.stringify(guidance).length <= GUIDANCE_BUDGET.serializedCharacters) break;
    item.examples = [];
  }
  while (JSON.stringify(guidance).length > GUIDANCE_BUDGET.serializedCharacters) {
    if (guidance.consider.length) {
      const item = guidance.consider.pop()!;
      omissions.push({ id: item.id, section: 'consider', reason: 'character-limit' });
      continue;
    }
    if (guidance.tensions.length) {
      const item = guidance.tensions.pop()!;
      omissions.push({ id: item.id, section: 'tensions', reason: 'character-limit' });
      continue;
    }
    if (guidance.required.length) {
      const item = guidance.required.pop()!;
      omissions.push({ id: item.id, section: 'required', reason: 'character-limit' });
      continue;
    }
    if (guidance.avoid.length) {
      const item = guidance.avoid.pop()!;
      omissions.push({ id: item.id, section: 'avoid', reason: 'character-limit' });
      continue;
    }
    break;
  }
}
