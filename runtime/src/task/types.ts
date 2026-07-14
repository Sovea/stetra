export const CHANGE_TYPES = [
  'bugfix',
  'feature',
  'refactor',
  'migration',
  'maintenance',
  'docs',
  'test',
  'unknown',
] as const;

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const SCOPE_LEVELS = ['local', 'module', 'cross-module', 'repository'] as const;

export type ChangeType = typeof CHANGE_TYPES[number];
export type RiskLevel = typeof RISK_LEVELS[number];
export type ScopeLevel = typeof SCOPE_LEVELS[number];
export type GuidanceMode = 'standard' | 'strict';
export type TaskFieldSource = 'explicit' | 'deterministic' | 'host-provided' | 'defaulted';

export interface TaskContextInput {
  description: string;
  changeType?: ChangeType;
  targets?: string[];
  techStack?: string[];
  risk?: RiskLevel;
  scope?: ScopeLevel;
  constraints?: string[];
  avoid?: string[];
  uncertainties?: string[];
  interpretationSource?: 'explicit' | 'host-provided';
}

export interface TaskFieldProvenance {
  field: 'changeType' | 'targets' | 'techStack' | 'risk' | 'scope';
  source: TaskFieldSource;
  confidence: number;
}

export interface NormalizedTaskContext {
  description: string;
  changeType: ChangeType;
  targets: string[];
  techStack: string[];
  risk: RiskLevel;
  scope: ScopeLevel;
  constraints: string[];
  avoid: string[];
  uncertainties: string[];
  provenance: TaskFieldProvenance[];
}
