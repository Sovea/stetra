import type {
  AssurancePlan,
  AssuranceRequirement,
  ClaimDimension,
} from './types.ts';
import type { ConsequenceLevel } from '../delegation/types.ts';

export const CLAIM_DIMENSIONS = [
  'behavior',
  'invariant',
  'state-ownership',
  'data-flow',
  'control-flow',
  'compatibility',
  'migration',
  'failure-recovery',
  'security',
  'operations',
  'maintenance',
  'important-non-change',
] as const satisfies readonly ClaimDimension[];

const CLAIM_DIMENSION_SET = new Set<string>(CLAIM_DIMENSIONS);

export function isClaimDimension(value: unknown): value is ClaimDimension {
  return typeof value === 'string' && CLAIM_DIMENSION_SET.has(value);
}

export function compileAssurancePlan(
  consequence: ConsequenceLevel,
  requirements: AssuranceRequirement[],
): AssurancePlan {
  const hasCriticalRequirement = requirements.some((item) =>
    item.criticality === 'adoption-critical');
  const profile = consequence === 'high' || hasCriticalRequirement
    ? 'critical'
    : consequence === 'medium' || requirements.length
      ? 'standard'
      : 'routine';
  return { profile, requirements };
}
