import type { CompileTaskInput, ContextProfile, Operation, TaskIntent } from '../types.ts';
import {
  COMPATIBILITY_REQUIREMENTS,
  INTERFACE_SENSITIVITIES,
  MIGRATION_PHASES,
  OPERATIONS,
  OPTIMIZATION_TARGETS,
  PROJECT_STAGES,
  REFACTOR_TOLERANCES,
  REVIEW_GOALS,
  RISK_LEVELS,
  SCOPE_SIZES,
  TASK_KINDS,
  enumValue,
} from './schema.ts';

const DEFAULT_OPTIMIZATION_TARGET: Record<Operation, ContextProfile['optimization_target']> = {
  create: 'maintainability',
  modify: 'maintainability',
  review: 'reviewability',
  refactor: 'maintainability',
  bugfix: 'safety',
};

/**
 * Produces a deterministic task intent from user task input without using an LLM.
 */
export function parseIntent(task: CompileTaskInput): TaskIntent {
  const targetFile = task.targetFile?.replace(/\\/g, '/');
  const changedFiles = (task.changedFiles ?? []).map((file) => file.replace(/\\/g, '/'));
  const techStack = [...new Set([
    ...(task.techStack ?? []),
    ...inferTechStackFromFile(targetFile),
  ])];

  const operation = enumValue(task.operation, OPERATIONS) ?? 'modify';
  return {
    task_kind: enumValue(task.taskKind, TASK_KINDS) ?? 'code',
    operation,
    target_layer: inferTargetLayer(targetFile),
    tech_stack: techStack,
    target_file: targetFile,
    changed_files: changedFiles,
    tags: [...new Set(task.tags ?? inferTags(targetFile, changedFiles))],
  };
}

function inferTechStackFromFile(targetFile: string | undefined): string[] {
  if (!targetFile) return [];
  if (targetFile.endsWith('.tsx')) return ['typescript'];
  if (targetFile.endsWith('.ts')) return ['typescript'];
  return [];
}

export function inferTargetLayer(targetFile: string | undefined): string {
  if (!targetFile) return 'module';
  if (/(^|\/)(test|tests|spec|specs)(\/|$)|\.(test|spec)\./.test(targetFile)) return 'test';
  if (/(^|\/)(api|routes)(\/|$)|\b(handler|endpoint)\b/.test(targetFile)) return 'api';
  if (/(^|\/)(store|state)(\/|$)|\.slice\./.test(targetFile)) return 'store';
  if (/(^|\/)(components?|views?|pages?)(\/|$)|\.tsx$/.test(targetFile)) return 'component';
  if (/(^|\/)(utils?|helpers?|lib)(\/|$)/.test(targetFile)) return 'util';
  return 'module';
}

function inferTags(targetFile: string | undefined, changedFiles: string[]): string[] {
  const inputs = [targetFile, ...changedFiles].filter(Boolean).join(' ');
  const tags: string[] = [];
  if (/(^|\/)(test|tests|spec|specs)(\/|$)|\.(test|spec)\./.test(inputs)) tags.push('test');
  return tags;
}

function inferOptimizationTarget(operation: Operation): ContextProfile['optimization_target'] {
  return DEFAULT_OPTIMIZATION_TARGET[operation];
}

function inferHardConstraints(): string[] {
  return [];
}

function inferAllowedTradeoffs(): string[] {
  return [];
}

function inferAvoid(): string[] {
  return [];
}

/**
 * Builds the contextual priorities and constraints used alongside task intent.
 */
export function buildContextProfile(task: CompileTaskInput, intent: TaskIntent): ContextProfile {
  return {
    project_stage: enumValue(task.projectStage, PROJECT_STAGES),
    change_type: intent.operation,
    optimization_target: enumValue(task.optimizationTarget, OPTIMIZATION_TARGETS) ?? inferOptimizationTarget(intent.operation),
    hard_constraints: [...new Set(task.hardConstraints ?? inferHardConstraints())],
    allowed_tradeoffs: [...new Set(task.allowedTradeoffs ?? inferAllowedTradeoffs())],
    avoid: [...new Set(task.avoid ?? inferAvoid())],
    risk_level: enumValue(task.riskLevel, RISK_LEVELS) ?? inferRiskLevel(task, intent),
    scope_size: enumValue(task.scopeSize, SCOPE_SIZES) ?? inferScopeSize(intent),
    compatibility_requirement: enumValue(task.compatibilityRequirement, COMPATIBILITY_REQUIREMENTS) ?? inferCompatibilityRequirement(task),
    interface_sensitivity: enumValue(task.interfaceSensitivity, INTERFACE_SENSITIVITIES) ?? inferInterfaceSensitivity(intent),
    refactor_tolerance: enumValue(task.refactorTolerance, REFACTOR_TOLERANCES) ?? inferRefactorTolerance(task, intent),
    migration_phase: enumValue(task.migrationPhase, MIGRATION_PHASES) ?? inferMigrationPhase(task),
    review_goal: enumValue(task.reviewGoal, REVIEW_GOALS) ?? inferReviewGoal(task, intent),
  };
}

function inferRiskLevel(task: CompileTaskInput, intent: TaskIntent): ContextProfile['risk_level'] {
  if (task.projectStage === 'critical') return 'critical';
  if (task.optimizationTarget === 'safety') return 'high';
  if (intent.operation === 'create' && intent.changed_files.length <= 1) return 'low';
  return 'medium';
}

function inferScopeSize(intent: TaskIntent): ContextProfile['scope_size'] {
  const files = [...new Set([intent.target_file, ...intent.changed_files].filter(Boolean) as string[])];
  if (!files.length) return 'unknown';
  if (files.length === 1) return 'single-file';
  const roots = new Set(files.map((file) => file.split('/').slice(0, 2).join('/')));
  return roots.size <= 1 ? 'module' : 'cross-cutting';
}

function inferCompatibilityRequirement(_task: CompileTaskInput): ContextProfile['compatibility_requirement'] {
  return 'none';
}

function inferInterfaceSensitivity(intent: TaskIntent): ContextProfile['interface_sensitivity'] {
  return intent.target_file || intent.changed_files.length || intent.tags.length || intent.tech_stack.length ? 'internal' : 'unknown';
}

function inferRefactorTolerance(_task: CompileTaskInput, intent: TaskIntent): ContextProfile['refactor_tolerance'] {
  if (intent.operation === 'refactor') return 'bounded';
  return 'local-only';
}

function inferMigrationPhase(_task: CompileTaskInput): ContextProfile['migration_phase'] {
  return 'none';
}

function inferReviewGoal(task: CompileTaskInput, intent: TaskIntent): ContextProfile['review_goal'] {
  if (intent.operation === 'bugfix' || task.optimizationTarget === 'safety') return 'regression-risk';
  if (intent.operation === 'review') return 'correctness';
  return 'maintainability';
}
