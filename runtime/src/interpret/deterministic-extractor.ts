import { buildContextProfile, inferTargetLayer, parseIntent } from '../intent/parse-intent.ts';
import {
  CHANGE_TYPES,
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
  WORKFLOWS,
  hasEnumValue,
} from '../intent/schema.ts';
import type { CompileTaskInput } from '../types.ts';
import type { TaskInterpretationProvider } from './provider.ts';
import type { ParsedTaskCandidate } from './types.ts';

export class DeterministicInterpretationProvider implements TaskInterpretationProvider {
  readonly source = 'deterministic' as const;

  interpret(task: CompileTaskInput): ParsedTaskCandidate {
    const intent = parseIntent(task);
    const context = buildContextProfile(task, intent);
    const explicitWorkflow = hasEnumValue(task.workflow, WORKFLOWS);
    const explicitChangeType = hasEnumValue(task.changeType, CHANGE_TYPES);
    const explicitOperation = hasEnumValue(task.operation, OPERATIONS);
    const explicitProjectStage = hasEnumValue(task.projectStage, PROJECT_STAGES);
    const explicitOptimizationTarget = hasEnumValue(task.optimizationTarget, OPTIMIZATION_TARGETS);
    const explicitRiskLevel = hasEnumValue(task.riskLevel, RISK_LEVELS);
    const explicitScopeSize = hasEnumValue(task.scopeSize, SCOPE_SIZES);
    const explicitCompatibilityRequirement = hasEnumValue(task.compatibilityRequirement, COMPATIBILITY_REQUIREMENTS);
    const explicitInterfaceSensitivity = hasEnumValue(task.interfaceSensitivity, INTERFACE_SENSITIVITIES);
    const explicitRefactorTolerance = hasEnumValue(task.refactorTolerance, REFACTOR_TOLERANCES);
    const explicitMigrationPhase = hasEnumValue(task.migrationPhase, MIGRATION_PHASES);
    const explicitReviewGoal = hasEnumValue(task.reviewGoal, REVIEW_GOALS);

    return {
      intent: {
        workflow: toField(intent.workflow, explicitWorkflow ? 'explicit' : 'deterministic', explicitWorkflow ? 1 : 0.85, explicitWorkflow ? 'provided directly via task input' : 'default code workflow'),
        change_type: toField(intent.change_type, explicitChangeType ? 'explicit' : 'deterministic', explicitChangeType ? 1 : intent.change_type === 'unknown' ? 0.35 : 0.6, explicitChangeType ? 'provided directly via task input' : 'conservative deterministic change-type fallback'),
        operation: toField(intent.operation, explicitOperation ? 'explicit' : 'deterministic', explicitOperation ? 1 : 0.5, explicitOperation ? 'provided directly via task input' : 'neutral deterministic default applied because no explicit operation was provided'),
        target_layer: toField(intent.target_layer, task.targetFile ? 'explicit' : 'deterministic', task.targetFile ? 1 : 0.6, task.targetFile ? 'derived from explicit target file path' : 'fallback module-level layer because no target file was provided'),
        tech_stack: toListField(intent.tech_stack, task.techStack?.length ? 'explicit' : 'deterministic', task.techStack?.length ? 1 : intent.tech_stack.length ? 0.55 : 0.2, task.techStack?.length ? 'provided directly via task input' : 'derived from explicit target file extension when available'),
        target_file: intent.target_file
          ? toField(intent.target_file, task.targetFile ? 'explicit' : 'deterministic', task.targetFile ? 1 : 0.65, task.targetFile ? 'provided directly via task input' : 'derived from normalized target file input')
          : unresolvedField('deterministic', 'target file not explicitly provided'),
        changed_files: toListField(intent.changed_files, task.changedFiles?.length ? 'explicit' : 'deterministic', intent.changed_files.length ? 1 : 0.2, 'derived from explicit changed files when available'),
        tags: toListField(intent.tags, task.tags?.length ? 'explicit' : 'deterministic', task.tags?.length ? 1 : intent.tags.length ? 0.55 : 0.2, task.tags?.length ? 'provided directly via task input' : 'derived from target file and changed-file test path signals'),
      },
      context: {
        project_stage: context.project_stage
          ? toField(context.project_stage, explicitProjectStage ? 'explicit' : 'deterministic', explicitProjectStage ? 1 : 0.5, explicitProjectStage ? 'provided directly via task input' : 'not inferred strongly; carried through when available')
          : unresolvedField(explicitProjectStage ? 'explicit' : 'deterministic', 'project stage not resolved'),
        optimization_target: toField(context.optimization_target, explicitOptimizationTarget ? 'explicit' : 'deterministic', explicitOptimizationTarget ? 1 : 0.55, explicitOptimizationTarget ? 'provided directly via task input' : 'stable fallback derived from resolved operation, not free-text policy extraction'),
        hard_constraints: toListField(context.hard_constraints, task.hardConstraints?.length ? 'explicit' : 'deterministic', task.hardConstraints?.length ? 1 : 0, task.hardConstraints?.length ? 'provided directly via task input' : 'left unresolved unless explicit constraints are provided'),
        allowed_tradeoffs: toListField(context.allowed_tradeoffs, task.allowedTradeoffs?.length ? 'explicit' : 'deterministic', task.allowedTradeoffs?.length ? 1 : 0, task.allowedTradeoffs?.length ? 'provided directly via task input' : 'left unresolved unless explicit tradeoffs are provided'),
        avoid: toListField(context.avoid, task.avoid?.length ? 'explicit' : 'deterministic', task.avoid?.length ? 1 : 0, task.avoid?.length ? 'provided directly via task input' : 'left unresolved unless explicit avoid guidance is provided'),
        risk_level: toField(context.risk_level, explicitRiskLevel ? 'explicit' : 'deterministic', explicitRiskLevel ? 1 : 0.65, explicitRiskLevel ? 'provided directly via task input' : 'neutral deterministic default derived from explicit project stage, optimization target, operation, and task shape'),
        scope_size: toField(context.scope_size, explicitScopeSize ? 'explicit' : 'deterministic', explicitScopeSize ? 1 : context.scope_size === 'unknown' ? 0.35 : 0.8, explicitScopeSize ? 'provided directly via task input' : 'derived from target and changed-file spread'),
        compatibility_requirement: toField(context.compatibility_requirement, explicitCompatibilityRequirement ? 'explicit' : 'deterministic', explicitCompatibilityRequirement ? 1 : 0.5, explicitCompatibilityRequirement ? 'provided directly via task input' : 'neutral deterministic default; compatibility requirements must be explicit or supplied by task-model'),
        interface_sensitivity: toField(context.interface_sensitivity, explicitInterfaceSensitivity ? 'explicit' : 'deterministic', explicitInterfaceSensitivity ? 1 : context.interface_sensitivity === 'unknown' ? 0.35 : 0.5, explicitInterfaceSensitivity ? 'provided directly via task input' : 'neutral deterministic default; sensitive interfaces must be explicit or supplied by task-model'),
        refactor_tolerance: toField(context.refactor_tolerance, explicitRefactorTolerance ? 'explicit' : 'deterministic', explicitRefactorTolerance ? 1 : 0.55, explicitRefactorTolerance ? 'provided directly via task input' : 'neutral deterministic default derived from the resolved operation only'),
        migration_phase: toField(context.migration_phase, explicitMigrationPhase ? 'explicit' : 'deterministic', explicitMigrationPhase ? 1 : 0.45, explicitMigrationPhase ? 'provided directly via task input' : 'neutral deterministic default; migration phase must be explicit or supplied by task-model'),
        review_goal: toField(context.review_goal, explicitReviewGoal ? 'explicit' : 'deterministic', explicitReviewGoal ? 1 : 0.55, explicitReviewGoal ? 'provided directly via task input' : 'neutral deterministic default derived from the resolved operation only'),
      },
      uncertainties: [
        ...(context.project_stage ? [] : ['project_stage unresolved']),
        ...(intent.target_file ? [] : ['target_file unresolved']),
      ],
    };
  }
}

function toField<T>(value: T, source: 'explicit' | 'deterministic', confidence: number, rationale: string) {
  return { value, source, confidence, status: 'resolved' as const, rationale };
}

function unresolvedField(source: 'explicit' | 'deterministic', rationale: string) {
  return { source, confidence: 0, status: 'unresolved' as const, rationale };
}

function toListField<T>(values: T[], source: 'explicit' | 'deterministic', confidence: number, rationale: string) {
  return {
    values,
    source,
    confidence,
    status: values.length ? 'resolved' as const : 'unresolved' as const,
    rationale,
  };
}
