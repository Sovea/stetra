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
export const TASK_FIELD_SOURCES = [
  'human-stated',
  'human-confirmed',
  'agent-inferred',
  'repository-derived',
  'deterministic',
] as const;
export const TASK_DECLARED_SOURCES = TASK_FIELD_SOURCES.filter(
  (source): source is Exclude<TaskFieldSource, 'deterministic'> =>
    source !== 'deterministic',
);

export type TaskFieldSource = typeof TASK_FIELD_SOURCES[number];
export type TaskDeclaredSource = Exclude<TaskFieldSource, 'deterministic'>;
export type TaskField =
  | 'description'
  | 'changeType'
  | 'targets'
  | 'techStack'
  | 'risk'
  | 'scope'
  | 'constraints'
  | 'avoid'
  | 'uncertainties';

export interface TaskProvenanceInput {
  description?: TaskDeclaredSource;
  changeType?: TaskDeclaredSource;
  targets?: Record<string, TaskDeclaredSource>;
  techStack?: Record<string, TaskDeclaredSource>;
  risk?: TaskDeclaredSource;
  scope?: TaskDeclaredSource;
  constraints?: Record<string, TaskDeclaredSource>;
  avoid?: Record<string, TaskDeclaredSource>;
  uncertainties?: Record<string, TaskDeclaredSource>;
}

export interface TaskContextInput {
  description: string;
  changeType: ChangeType;
  targets: string[];
  techStack?: string[];
  risk: RiskLevel;
  scope: ScopeLevel;
  constraints?: string[];
  avoid?: string[];
  uncertainties?: string[];
  provenance?: TaskProvenanceInput;
}

export interface TaskFieldProvenance {
  field: TaskField;
  value: string;
  source: TaskFieldSource;
}

export interface TaskAlignmentReason {
  kind: 'clarification' | 'decision';
  field: 'changeType' | 'uncertainties';
  value?: string;
  message: string;
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
