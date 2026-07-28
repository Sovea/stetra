import type {
  AttestationPlan,
  EffectiveGuidance,
  VerificationRequirement,
} from './types.ts';

export function buildAttestationPlan(
  guidance: EffectiveGuidance,
): AttestationPlan {
  const attentionItems: AttestationPlan['attentionItems'] = [
    ...guidance.required.map((item) => ({
      guidanceId: item.id,
      section: 'required' as const,
      requirements: describeRequirements(item.id, item.verification),
    })),
    ...guidance.avoid.map((item) => ({
      guidanceId: item.id,
      section: 'avoid' as const,
      requirements: describeRequirements(item.id, item.verification),
    })),
    ...guidance.tensions.map((item) => ({
      guidanceId: item.id,
      section: 'tension' as const,
      requirements: [{
        kind: 'semantic' as const,
        description: item.resolution,
      }],
    })),
  ];
  return {
    attentionItems,
    optionalConsiderIds: guidance.consider.map((item) => item.id),
    optionalConsiderPolicy: 'unverified-is-informational',
    evidenceExamples: {
      diff: {
        kind: 'diff',
        ref: 'diff:<repository-path>',
        file: '<changed-file>',
      },
      file: {
        kind: 'file',
        ref: 'file:<repository-path>',
        file: '<changed-file>',
      },
      check: {
        kind: 'check',
        ref: 'check:<check-id>',
        checkId: '<passing-check-id>',
      },
      semantic: {
        kind: 'semantic',
        ref: 'semantic:<claim-id>',
        description: '<concrete semantic explanation>',
      },
    },
  };
}

function describeRequirements(
  guidanceId: string,
  requirements: VerificationRequirement[],
): VerificationRequirement[] {
  return requirements.map((requirement) => {
    if (requirement.description) return { ...requirement };
    if (requirement.kind === 'command') {
      return {
        ...requirement,
        description: `The workflow must collect a passing ${requirement.commandId ?? 'configured'} check.`,
      };
    }
    if (requirement.kind === 'semantic') {
      return {
        ...requirement,
        description: `Provide a concrete semantic explanation for ${guidanceId}.`,
      };
    }
    return {
      ...requirement,
      description: `Cite at least one file from the collected change for ${guidanceId}.`,
    };
  });
}
