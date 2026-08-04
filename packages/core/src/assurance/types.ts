import type {
  AgentInterpretation,
  InterpretationBasis,
} from '../authority/types.ts';

export type ClaimDimension =
  | 'behavior'
  | 'invariant'
  | 'state-ownership'
  | 'data-flow'
  | 'control-flow'
  | 'compatibility'
  | 'migration'
  | 'failure-recovery'
  | 'security'
  | 'operations'
  | 'maintenance'
  | 'important-non-change';

export type AssuranceCriticality = 'material' | 'adoption-critical';
export type AssuranceProfile = 'routine' | 'standard' | 'critical';

export interface AssuranceDimensionInput {
  dimension: ClaimDimension;
  criticality: AssuranceCriticality;
  rationale: string;
  basis: InterpretationBasis;
}

export interface AssuranceRequirement extends AgentInterpretation {
  field: 'assurance-dimension';
  value: ClaimDimension;
  criticality: AssuranceCriticality;
  rationale: string;
}

export interface AssurancePlan {
  profile: AssuranceProfile;
  requirements: AssuranceRequirement[];
}
