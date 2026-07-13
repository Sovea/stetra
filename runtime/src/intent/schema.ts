import type { ChangeType, ContextProfile, Operation, Workflow } from '../types.ts';

export const WORKFLOWS = ['code', 'review', 'analysis'] as const satisfies readonly Workflow[];
export const CHANGE_TYPES = ['feature', 'bugfix', 'refactor', 'migration', 'unknown'] as const satisfies readonly ChangeType[];
export const OPERATIONS = ['create', 'modify', 'delete', 'mixed'] as const satisfies readonly Operation[];
export const PROJECT_STAGES = ['prototype', 'growth', 'stable', 'critical'] as const satisfies readonly NonNullable<ContextProfile['project_stage']>[];
export const OPTIMIZATION_TARGETS = ['speed', 'maintainability', 'safety', 'simplicity', 'reviewability'] as const satisfies readonly ContextProfile['optimization_target'][];
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const satisfies readonly ContextProfile['risk_level'][];
export const SCOPE_SIZES = ['single-file', 'module', 'cross-cutting', 'unknown'] as const satisfies readonly ContextProfile['scope_size'][];
export const COMPATIBILITY_REQUIREMENTS = ['none', 'preserve-behavior', 'preserve-api', 'migration-compatible', 'breaking-allowed'] as const satisfies readonly ContextProfile['compatibility_requirement'][];
export const INTERFACE_SENSITIVITIES = ['internal', 'public-api', 'persistence', 'external-integration', 'auth-security', 'unknown'] as const satisfies readonly ContextProfile['interface_sensitivity'][];
export const REFACTOR_TOLERANCES = ['none', 'local-only', 'bounded', 'broad'] as const satisfies readonly ContextProfile['refactor_tolerance'][];
export const MIGRATION_PHASES = ['none', 'preparation', 'dual-run', 'cutover', 'cleanup'] as const satisfies readonly ContextProfile['migration_phase'][];
export const REVIEW_GOALS = ['correctness', 'regression-risk', 'architecture-fit', 'maintainability', 'security', 'performance'] as const satisfies readonly ContextProfile['review_goal'][];
export const TASK_INTERPRETATION_SOURCES = ['host-agent', 'assistive-ai'] as const;

export const TASK_INTERPRETATION_ENUMS = {
  intent: {
    workflow: WORKFLOWS,
    change_type: CHANGE_TYPES,
    operation: OPERATIONS,
  },
  context: {
    project_stage: PROJECT_STAGES,
    optimization_target: OPTIMIZATION_TARGETS,
    risk_level: RISK_LEVELS,
    scope_size: SCOPE_SIZES,
    compatibility_requirement: COMPATIBILITY_REQUIREMENTS,
    interface_sensitivity: INTERFACE_SENSITIVITIES,
    refactor_tolerance: REFACTOR_TOLERANCES,
    migration_phase: MIGRATION_PHASES,
    review_goal: REVIEW_GOALS,
  },
} as const;

export const TASK_INPUT_ENUMS = {
  operation: OPERATIONS,
  workflow: WORKFLOWS,
  changeType: CHANGE_TYPES,
  projectStage: PROJECT_STAGES,
  optimizationTarget: OPTIMIZATION_TARGETS,
  riskLevel: RISK_LEVELS,
  scopeSize: SCOPE_SIZES,
  compatibilityRequirement: COMPATIBILITY_REQUIREMENTS,
  interfaceSensitivity: INTERFACE_SENSITIVITIES,
  refactorTolerance: REFACTOR_TOLERANCES,
  migrationPhase: MIGRATION_PHASES,
  reviewGoal: REVIEW_GOALS,
} as const;

export const TASK_KINDS = WORKFLOWS;

export function enumValue<T extends string>(value: unknown, allowedValues: readonly T[]): T | undefined {
  return typeof value === 'string' && allowedValues.includes(value as T) ? value as T : undefined;
}

export function hasEnumValue<T extends string>(value: unknown, allowedValues: readonly T[]): boolean {
  return enumValue(value, allowedValues) !== undefined;
}
