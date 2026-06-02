import { inferTargetLayer } from '../intent/parse-intent.ts';
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
} from '../intent/schema.ts';
import type { CompileTaskInput, ContextProfile, Operation, ResolveTaskRequest, ResolvedTaskOutput, TaskIntent, TaskKind } from '../types.ts';
import type { TaskModelListField, TaskModelProposal, TaskModelScalarField } from '../ai-contracts/types.ts';
import { DeterministicInterpretationProvider } from './deterministic-extractor.ts';
import { uniqueCompact } from '../utils/common.ts';
import type {
  CandidateField,
  CandidateListField,
  CandidateSummary,
  ContextDecisionInput,
  DiscardedInterpretationInput,
  InputProvenance,
  InterpretationConflict,
  ParsedTaskCandidate,
  ResolveTaskInput,
  RuntimeDiagnostics,
  TaskInterpretationTrace,
} from './types.ts';

const deterministicProvider = new DeterministicInterpretationProvider();
const MIN_ASSISTIVE_CONTEXT_CONFIDENCE = 0.5;

interface ScalarFieldSpec {
  field: string;
  section: 'intent' | 'context';
  candidateKey: string;
  explicitValue: (input: ResolveTaskRequest) => unknown;
  fallbackValue: (det: ParsedTaskCandidate) => unknown;
  defaultConfidence: (det: ParsedTaskCandidate) => number;
  allowedValues?: readonly unknown[];
  minimumCandidateConfidence?: number;
}

interface ListFieldSpec {
  field: string;
  section: 'intent' | 'context';
  candidateKey: string;
  explicitValues: (input: ResolveTaskRequest) => unknown[] | undefined;
  fallbackValues: (det: ParsedTaskCandidate) => unknown[];
  defaultConfidence: (det: ParsedTaskCandidate) => number;
}

const SCALAR_FIELD_SPECS: ScalarFieldSpec[] = [
  {
    field: 'intent.task_kind',
    section: 'intent',
    candidateKey: 'task_kind',
    explicitValue: (input) => input.taskKind ?? input.task.taskKind,
    fallbackValue: (det) => det.intent.task_kind?.value ?? 'code',
    defaultConfidence: (det) => det.intent.task_kind?.confidence ?? 0.85,
    allowedValues: TASK_KINDS,
  },
  {
    field: 'intent.operation',
    section: 'intent',
    candidateKey: 'operation',
    explicitValue: (input) => input.task.operation,
    fallbackValue: (det) => det.intent.operation?.value ?? 'modify',
    defaultConfidence: (det) => det.intent.operation?.confidence ?? 0.5,
    allowedValues: OPERATIONS,
  },
  {
    field: 'intent.target_file',
    section: 'intent',
    candidateKey: 'target_file',
    explicitValue: (input) => input.task.targetFile,
    fallbackValue: (det) => det.intent.target_file?.value,
    defaultConfidence: (det) => det.intent.target_file?.confidence ?? 0.65,
  },
  {
    field: 'context.project_stage',
    section: 'context',
    candidateKey: 'project_stage',
    explicitValue: (input) => input.task.projectStage,
    fallbackValue: (det) => det.context.project_stage?.value,
    defaultConfidence: (det) => det.context.project_stage?.confidence ?? 0.5,
    allowedValues: PROJECT_STAGES,
  },
  {
    field: 'context.optimization_target',
    section: 'context',
    candidateKey: 'optimization_target',
    explicitValue: (input) => input.task.optimizationTarget,
    fallbackValue: (det) => det.context.optimization_target?.value,
    defaultConfidence: (det) => det.context.optimization_target?.confidence ?? 0.55,
    allowedValues: OPTIMIZATION_TARGETS,
  },
  {
    field: 'context.risk_level',
    section: 'context',
    candidateKey: 'risk_level',
    explicitValue: (input) => input.task.riskLevel,
    fallbackValue: (det) => det.context.risk_level?.value ?? 'medium',
    defaultConfidence: (det) => det.context.risk_level?.confidence ?? 0.65,
    allowedValues: RISK_LEVELS,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.scope_size',
    section: 'context',
    candidateKey: 'scope_size',
    explicitValue: (input) => input.task.scopeSize,
    fallbackValue: (det) => det.context.scope_size?.value ?? 'unknown',
    defaultConfidence: (det) => det.context.scope_size?.confidence ?? 0.35,
    allowedValues: SCOPE_SIZES,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.compatibility_requirement',
    section: 'context',
    candidateKey: 'compatibility_requirement',
    explicitValue: (input) => input.task.compatibilityRequirement,
    fallbackValue: (det) => det.context.compatibility_requirement?.value ?? 'none',
    defaultConfidence: (det) => det.context.compatibility_requirement?.confidence ?? 0.5,
    allowedValues: COMPATIBILITY_REQUIREMENTS,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.interface_sensitivity',
    section: 'context',
    candidateKey: 'interface_sensitivity',
    explicitValue: (input) => input.task.interfaceSensitivity,
    fallbackValue: (det) => det.context.interface_sensitivity?.value ?? 'unknown',
    defaultConfidence: (det) => det.context.interface_sensitivity?.confidence ?? 0.35,
    allowedValues: INTERFACE_SENSITIVITIES,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.refactor_tolerance',
    section: 'context',
    candidateKey: 'refactor_tolerance',
    explicitValue: (input) => input.task.refactorTolerance,
    fallbackValue: (det) => det.context.refactor_tolerance?.value ?? 'local-only',
    defaultConfidence: (det) => det.context.refactor_tolerance?.confidence ?? 0.65,
    allowedValues: REFACTOR_TOLERANCES,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.migration_phase',
    section: 'context',
    candidateKey: 'migration_phase',
    explicitValue: (input) => input.task.migrationPhase,
    fallbackValue: (det) => det.context.migration_phase?.value ?? 'none',
    defaultConfidence: (det) => det.context.migration_phase?.confidence ?? 0.45,
    allowedValues: MIGRATION_PHASES,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
  {
    field: 'context.review_goal',
    section: 'context',
    candidateKey: 'review_goal',
    explicitValue: (input) => input.task.reviewGoal,
    fallbackValue: (det) => det.context.review_goal?.value ?? 'maintainability',
    defaultConfidence: (det) => det.context.review_goal?.confidence ?? 0.65,
    allowedValues: REVIEW_GOALS,
    minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
  },
];

const LIST_FIELD_SPECS: ListFieldSpec[] = [
  {
    field: 'intent.changed_files',
    section: 'intent',
    candidateKey: 'changed_files',
    explicitValues: (input) => input.task.changedFiles,
    fallbackValues: (det) => det.intent.changed_files?.values ?? [],
    defaultConfidence: (det) => det.intent.changed_files?.confidence ?? 0.2,
  },
  {
    field: 'intent.tech_stack',
    section: 'intent',
    candidateKey: 'tech_stack',
    explicitValues: (input) => input.task.techStack,
    fallbackValues: (det) => det.intent.tech_stack?.values ?? [],
    defaultConfidence: (det) => det.intent.tech_stack?.confidence ?? 0.3,
  },
  {
    field: 'intent.tags',
    section: 'intent',
    candidateKey: 'tags',
    explicitValues: (input) => input.task.tags,
    fallbackValues: (det) => det.intent.tags?.values ?? [],
    defaultConfidence: (det) => det.intent.tags?.confidence ?? 0.3,
  },
  {
    field: 'context.hard_constraints',
    section: 'context',
    candidateKey: 'hard_constraints',
    explicitValues: (input) => input.task.hardConstraints,
    fallbackValues: (det) => det.context.hard_constraints?.values ?? [],
    defaultConfidence: (det) => det.context.hard_constraints?.confidence ?? 0.2,
  },
  {
    field: 'context.allowed_tradeoffs',
    section: 'context',
    candidateKey: 'allowed_tradeoffs',
    explicitValues: (input) => input.task.allowedTradeoffs,
    fallbackValues: (det) => det.context.allowed_tradeoffs?.values ?? [],
    defaultConfidence: (det) => det.context.allowed_tradeoffs?.confidence ?? 0.2,
  },
  {
    field: 'context.avoid',
    section: 'context',
    candidateKey: 'avoid',
    explicitValues: (input) => input.task.avoid,
    fallbackValues: (det) => det.context.avoid?.values ?? [],
    defaultConfidence: (det) => det.context.avoid?.confidence ?? 0.2,
  },
];

export function resolveTask(input: ResolveTaskRequest): ResolvedTaskOutput {
  const deterministicCandidate = deterministicProvider.interpret(input.task);
  const modelCandidates = (input.taskModels ?? []).map(taskModelToCandidate);
  const candidates = [...modelCandidates, deterministicCandidate];
  const conflicts: InterpretationConflict[] = [];
  const discardedInputs: DiscardedInterpretationInput[] = [];

  const scalarResults = new Map<string, ScalarResolution<unknown>>();
  for (const spec of SCALAR_FIELD_SPECS) {
    scalarResults.set(spec.field, resolveField({
      field: spec.field,
      explicitValue: spec.explicitValue(input),
      candidates: candidates.map((candidate) => {
        const section = spec.section === 'intent' ? candidate.intent : candidate.context;
        return (section as Record<string, CandidateField<unknown> | undefined>)[spec.candidateKey];
      }),
      fallbackValue: spec.fallbackValue(deterministicCandidate),
      defaultSource: 'deterministic',
      defaultConfidence: spec.defaultConfidence(deterministicCandidate),
      ...(spec.allowedValues ? { allowedValues: spec.allowedValues } : {}),
      ...(spec.minimumCandidateConfidence !== undefined ? { minimumCandidateConfidence: spec.minimumCandidateConfidence } : {}),
      conflicts,
      discardedInputs,
    }));
  }

  const listResults = new Map<string, ListResolution<unknown>>();
  for (const spec of LIST_FIELD_SPECS) {
    listResults.set(spec.field, resolveListField({
      field: spec.field,
      explicitValues: spec.explicitValues(input),
      candidates: candidates.map((candidate) => {
        const section = spec.section === 'intent' ? candidate.intent : candidate.context;
        return (section as Record<string, CandidateListField<unknown> | undefined>)[spec.candidateKey];
      }),
      fallbackValues: spec.fallbackValues(deterministicCandidate),
      defaultSource: 'deterministic',
      defaultConfidence: spec.defaultConfidence(deterministicCandidate),
      conflicts,
    }));
  }

  const scalar = <T>(field: string) => scalarResults.get(field)! as ScalarResolution<T>;
  const list = (field: string) => listResults.get(field)! as ListResolution<string>;

  const task: CompileTaskInput = {
    description: input.task.description,
    taskKind: scalar<TaskKind>('intent.task_kind').value,
    operation: scalar<Operation>('intent.operation').value,
    targetFile: scalar<string | undefined>('intent.target_file').value,
    changedFiles: list('intent.changed_files').values,
    techStack: list('intent.tech_stack').values,
    tags: list('intent.tags').values,
    projectStage: scalar<ContextProfile['project_stage']>('context.project_stage').value,
    optimizationTarget: scalar<ContextProfile['optimization_target']>('context.optimization_target').value,
    hardConstraints: list('context.hard_constraints').values,
    allowedTradeoffs: list('context.allowed_tradeoffs').values,
    avoid: list('context.avoid').values,
    riskLevel: scalar<ContextProfile['risk_level']>('context.risk_level').value,
    scopeSize: scalar<ContextProfile['scope_size']>('context.scope_size').value,
    compatibilityRequirement: scalar<ContextProfile['compatibility_requirement']>('context.compatibility_requirement').value,
    interfaceSensitivity: scalar<ContextProfile['interface_sensitivity']>('context.interface_sensitivity').value,
    refactorTolerance: scalar<ContextProfile['refactor_tolerance']>('context.refactor_tolerance').value,
    migrationPhase: scalar<ContextProfile['migration_phase']>('context.migration_phase').value,
    reviewGoal: scalar<ContextProfile['review_goal']>('context.review_goal').value,
  };

  const resolvedTargetFile = scalar<string | undefined>('intent.target_file').value;
  const intent: TaskIntent = {
    task_kind: scalar<TaskKind>('intent.task_kind').value,
    operation: scalar<Operation>('intent.operation').value,
    target_layer: inferTargetLayer(resolvedTargetFile),
    tech_stack: uniqueCompact(list('intent.tech_stack').values),
    target_file: resolvedTargetFile,
    changed_files: uniqueCompact(list('intent.changed_files').values),
    tags: uniqueCompact(list('intent.tags').values),
  };

  const contextProfile: ContextProfile = {
    project_stage: scalar<ContextProfile['project_stage']>('context.project_stage').value,
    change_type: scalar<Operation>('intent.operation').value,
    optimization_target: scalar<ContextProfile['optimization_target']>('context.optimization_target').value,
    hard_constraints: uniqueCompact(list('context.hard_constraints').values),
    allowed_tradeoffs: uniqueCompact(list('context.allowed_tradeoffs').values),
    avoid: uniqueCompact(list('context.avoid').values),
    risk_level: scalar<ContextProfile['risk_level']>('context.risk_level').value,
    scope_size: scalar<ContextProfile['scope_size']>('context.scope_size').value,
    compatibility_requirement: scalar<ContextProfile['compatibility_requirement']>('context.compatibility_requirement').value,
    interface_sensitivity: scalar<ContextProfile['interface_sensitivity']>('context.interface_sensitivity').value,
    refactor_tolerance: scalar<ContextProfile['refactor_tolerance']>('context.refactor_tolerance').value,
    migration_phase: scalar<ContextProfile['migration_phase']>('context.migration_phase').value,
    review_goal: scalar<ContextProfile['review_goal']>('context.review_goal').value,
  };

  const provenance = buildProvenance(input, {
    task_kind: scalar<TaskKind>('intent.task_kind'),
    operation: scalar<Operation>('intent.operation'),
    target_file: scalar<string | undefined>('intent.target_file'),
    changed_files: list('intent.changed_files'),
    tech_stack: list('intent.tech_stack'),
    tags: list('intent.tags'),
    project_stage: scalar<ContextProfile['project_stage']>('context.project_stage'),
    optimization_target: scalar<ContextProfile['optimization_target']>('context.optimization_target'),
    hard_constraints: list('context.hard_constraints'),
    allowed_tradeoffs: list('context.allowed_tradeoffs'),
    avoid: list('context.avoid'),
    risk_level: scalar<ContextProfile['risk_level']>('context.risk_level'),
    scope_size: scalar<ContextProfile['scope_size']>('context.scope_size'),
    compatibility_requirement: scalar<ContextProfile['compatibility_requirement']>('context.compatibility_requirement'),
    interface_sensitivity: scalar<ContextProfile['interface_sensitivity']>('context.interface_sensitivity'),
    refactor_tolerance: scalar<ContextProfile['refactor_tolerance']>('context.refactor_tolerance'),
    migration_phase: scalar<ContextProfile['migration_phase']>('context.migration_phase'),
    review_goal: scalar<ContextProfile['review_goal']>('context.review_goal'),
  }, conflicts);
  const trace = buildTrace(input, candidates, provenance, conflicts);
  const diagnostics = buildDiagnostics(input, candidates, provenance, conflicts, discardedInputs);

  return {
    task,
    taskKind: scalar<TaskKind>('intent.task_kind').value,
    task_models: input.taskModels ?? [],
    task_intent: intent,
    context_profile: contextProfile,
    input_provenance: provenance,
    diagnostics,
    trace,
  };
}

export const resolveTaskInput = resolveTask;

type ScalarResolution<T> = {
  value: T;
  source: CandidateField<T>['source'];
  confidence: number;
  status: 'resolved';
};

type ListResolution<T> = {
  values: T[];
  source: CandidateListField<T>['source'];
  confidence: number;
  status: 'resolved' | 'unresolved';
};

function resolveField<T>({
  field,
  explicitValue,
  candidates,
  fallbackValue,
  defaultSource,
  defaultConfidence,
  allowedValues,
  minimumCandidateConfidence = 0,
  conflicts,
  discardedInputs,
}: {
  field: string;
  explicitValue: T | undefined;
  candidates: Array<CandidateField<T> | undefined>;
  fallbackValue: T | undefined;
  defaultSource: CandidateField<T>['source'];
  defaultConfidence: number;
  allowedValues?: readonly T[];
  minimumCandidateConfidence?: number;
  conflicts: InterpretationConflict[];
  discardedInputs: DiscardedInterpretationInput[];
}): ScalarResolution<T> {
  const resolvedCandidates = candidates.filter((candidate): candidate is CandidateField<T> => {
    if (candidate === undefined || candidate.status !== 'resolved') return false;
    if (candidate.value === undefined) {
      recordDiscarded(discardedInputs, field, '', candidate.source, 'missing-value', fallbackValue);
      return false;
    }
    if (candidate.confidence < minimumCandidateConfidence) {
      recordDiscarded(discardedInputs, field, candidate.value, candidate.source, 'below-confidence-threshold', fallbackValue);
      return false;
    }
    if (allowedValues && !allowedValues.includes(candidate.value)) {
      recordDiscarded(discardedInputs, field, candidate.value, candidate.source, 'invalid-enum', fallbackValue);
      return false;
    }
    return true;
  });
  if (explicitValue !== undefined) {
    if (allowedValues && !allowedValues.includes(explicitValue)) {
      recordDiscarded(discardedInputs, field, explicitValue, 'explicit', 'invalid-enum', fallbackValue);
    } else {
      registerConflict(field, 'explicit', resolvedCandidates.map((candidate) => candidate.source), conflicts, 'explicit task input takes precedence');
      return { value: explicitValue, source: 'explicit', confidence: 1, status: 'resolved' };
    }
  }
  if (resolvedCandidates.length > 0) {
    const ordered = resolvedCandidates.slice().sort(compareCandidateField);
    const winner = ordered[0];
    registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, 'field-level evidence/confidence policy selected the strongest candidate');
    return { value: winner.value as T, source: winner.source, confidence: winner.confidence, status: 'resolved' };
  }
  return { value: fallbackValue as T, source: defaultSource, confidence: defaultConfidence, status: 'resolved' };
}

function resolveListField<T>({
  field,
  explicitValues,
  candidates,
  fallbackValues,
  defaultSource,
  defaultConfidence,
  conflicts,
}: {
  field: string;
  explicitValues: T[] | undefined;
  candidates: Array<CandidateListField<T> | undefined>;
  fallbackValues: T[];
  defaultSource: CandidateListField<T>['source'];
  defaultConfidence: number;
  conflicts: InterpretationConflict[];
}): ListResolution<T> {
  if (explicitValues?.length) {
    registerConflict(field, 'explicit', candidates.filter(Boolean).map((candidate) => candidate?.source ?? 'deterministic'), conflicts, 'explicit task input takes precedence');
    return { values: uniqueCompact(explicitValues), source: 'explicit', confidence: 1, status: 'resolved' };
  }
  const resolvedCandidates = candidates.filter((candidate): candidate is CandidateListField<T> => candidate !== undefined && candidate.status === 'resolved' && candidate.values.length > 0);
  if (resolvedCandidates.length > 0) {
    const ordered = resolvedCandidates.slice().sort(compareCandidateListField);
    const winner = ordered[0];
    registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, 'field-level evidence/confidence policy selected the strongest candidate');
    return { values: uniqueCompact(winner.values), source: winner.source, confidence: winner.confidence, status: 'resolved' };
  }
  const fallback = uniqueCompact(fallbackValues);
  return {
    values: fallback,
    source: defaultSource,
    confidence: defaultConfidence,
    status: fallback.length ? 'resolved' : 'unresolved',
  };
}

function buildProvenance(
  input: ResolveTaskInput,
  resolved: {
    task_kind: ScalarResolution<TaskKind>;
    operation: ScalarResolution<Operation>;
    target_file: ScalarResolution<string | undefined>;
    changed_files: ListResolution<string>;
    tech_stack: ListResolution<string>;
    tags: ListResolution<string>;
    project_stage: ScalarResolution<ContextProfile['project_stage'] | undefined>;
    optimization_target: ScalarResolution<ContextProfile['optimization_target']>;
    hard_constraints: ListResolution<string>;
    allowed_tradeoffs: ListResolution<string>;
    avoid: ListResolution<string>;
    risk_level: ScalarResolution<ContextProfile['risk_level']>;
    scope_size: ScalarResolution<ContextProfile['scope_size']>;
    compatibility_requirement: ScalarResolution<ContextProfile['compatibility_requirement']>;
    interface_sensitivity: ScalarResolution<ContextProfile['interface_sensitivity']>;
    refactor_tolerance: ScalarResolution<ContextProfile['refactor_tolerance']>;
    migration_phase: ScalarResolution<ContextProfile['migration_phase']>;
    review_goal: ScalarResolution<ContextProfile['review_goal']>;
  },
  conflicts: InterpretationConflict[],
): InputProvenance {
  const resolved_fields = [
    summarizeScalarField('intent.task_kind', resolved.task_kind),
    summarizeScalarField('intent.operation', resolved.operation),
    summarizeScalarField('intent.target_file', resolved.target_file),
    summarizeListField('intent.changed_files', resolved.changed_files),
    summarizeListField('intent.tech_stack', resolved.tech_stack),
    summarizeListField('intent.tags', resolved.tags),
    summarizeScalarField('context.project_stage', resolved.project_stage),
    summarizeScalarField('context.optimization_target', resolved.optimization_target),
    summarizeListField('context.hard_constraints', resolved.hard_constraints),
    summarizeListField('context.allowed_tradeoffs', resolved.allowed_tradeoffs),
    summarizeListField('context.avoid', resolved.avoid),
    summarizeScalarField('context.risk_level', resolved.risk_level),
    summarizeScalarField('context.scope_size', resolved.scope_size),
    summarizeScalarField('context.compatibility_requirement', resolved.compatibility_requirement),
    summarizeScalarField('context.interface_sensitivity', resolved.interface_sensitivity),
    summarizeScalarField('context.refactor_tolerance', resolved.refactor_tolerance),
    summarizeScalarField('context.migration_phase', resolved.migration_phase),
    summarizeScalarField('context.review_goal', resolved.review_goal),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const unresolved_fields = [
    ...(resolved.target_file.value ? [] : ['intent.target_file']),
    ...(resolved.project_stage.value ? [] : ['context.project_stage']),
  ];

  return {
    resolved_fields,
    unresolved_fields,
    context_resolution: buildContextResolution(resolved, conflicts),
    interpretation_mode: input.interpretationMode ?? (input.taskModels?.length ? 'host-agent' : 'deterministic-only'),
    resolution_quality: determineResolutionQuality(resolved_fields),
  };
}

function buildTrace(
  input: ResolveTaskInput,
  candidates: ParsedTaskCandidate[],
  provenance: InputProvenance,
  conflicts: InterpretationConflict[],
): TaskInterpretationTrace {
  const candidate_summaries: CandidateSummary[] = candidates.map((candidate) => summarizeCandidate(candidate));
  return {
    mode: provenance.interpretation_mode,
    candidate_summaries,
    conflicts,
    selected_sources: provenance.resolved_fields.map((field) => ({
      field: field.field,
      source: field.source,
      confidence: field.confidence,
    })),
  };
}

function buildContextResolution(
  resolved: {
    project_stage: ScalarResolution<ContextProfile['project_stage'] | undefined>;
    optimization_target: ScalarResolution<ContextProfile['optimization_target']>;
    hard_constraints: ListResolution<string>;
    allowed_tradeoffs: ListResolution<string>;
    avoid: ListResolution<string>;
    risk_level: ScalarResolution<ContextProfile['risk_level']>;
    scope_size: ScalarResolution<ContextProfile['scope_size']>;
    compatibility_requirement: ScalarResolution<ContextProfile['compatibility_requirement']>;
    interface_sensitivity: ScalarResolution<ContextProfile['interface_sensitivity']>;
    refactor_tolerance: ScalarResolution<ContextProfile['refactor_tolerance']>;
    migration_phase: ScalarResolution<ContextProfile['migration_phase']>;
    review_goal: ScalarResolution<ContextProfile['review_goal']>;
  },
  conflicts: InterpretationConflict[],
): ContextDecisionInput[] {
  return [
    contextScalar('context.project_stage', resolved.project_stage, conflicts),
    contextScalar('context.optimization_target', resolved.optimization_target, conflicts),
    contextList('context.hard_constraints', resolved.hard_constraints, conflicts),
    contextList('context.allowed_tradeoffs', resolved.allowed_tradeoffs, conflicts),
    contextList('context.avoid', resolved.avoid, conflicts),
    contextScalar('context.risk_level', resolved.risk_level, conflicts),
    contextScalar('context.scope_size', resolved.scope_size, conflicts),
    contextScalar('context.compatibility_requirement', resolved.compatibility_requirement, conflicts),
    contextScalar('context.interface_sensitivity', resolved.interface_sensitivity, conflicts),
    contextScalar('context.refactor_tolerance', resolved.refactor_tolerance, conflicts),
    contextScalar('context.migration_phase', resolved.migration_phase, conflicts),
    contextScalar('context.review_goal', resolved.review_goal, conflicts),
  ];
}

function contextScalar<T>(
  field: string,
  resolved: ScalarResolution<T | undefined>,
  conflicts: InterpretationConflict[],
): ContextDecisionInput {
  const value = resolved.value === undefined ? '' : String(resolved.value);
  return {
    field,
    value,
    source: resolved.source,
    confidence: resolved.confidence,
    status: contextResolutionStatus(field, resolved.source, resolved.value === undefined, conflicts),
    influence: contextInfluenceHints(field, value, resolved.source),
  };
}

function contextList(
  field: string,
  resolved: ListResolution<string>,
  conflicts: InterpretationConflict[],
): ContextDecisionInput {
  return {
    field,
    value: resolved.values,
    source: resolved.source,
    confidence: resolved.confidence,
    status: contextResolutionStatus(field, resolved.source, resolved.values.length === 0, conflicts),
    influence: contextInfluenceHints(field, resolved.values.join(','), resolved.source),
  };
}

function contextResolutionStatus(
  field: string,
  source: CandidateField<unknown>['source'],
  unresolved: boolean,
  conflicts: InterpretationConflict[],
): ContextDecisionInput['status'] {
  if (conflicts.some((conflict) => conflict.field === field)) return 'conflicted';
  if (unresolved) return 'unresolved';
  return source === 'deterministic' || source === 'repo-default' ? 'defaulted' : 'resolved';
}

function contextInfluenceHints(field: string, value: string, source: CandidateField<unknown>['source']): string[] {
  if (source === 'deterministic') return [];
  switch (field) {
    case 'context.risk_level':
      return value === 'high' || value === 'critical' ? ['review-focus-priority', 'must-guidance-preservation'] : [];
    case 'context.scope_size':
      return value === 'single-file' ? ['broad-guidance-ambient'] : [];
    case 'context.compatibility_requirement':
      return value && value !== 'none' && value !== 'breaking-allowed' ? ['compatibility-tension'] : [];
    case 'context.interface_sensitivity':
      return value && value !== 'internal' && value !== 'unknown' ? ['review-focus-priority'] : [];
    case 'context.refactor_tolerance':
      return value === 'none' || value === 'local-only' ? ['broad-guidance-ambient'] : [];
    case 'context.migration_phase':
      return value === 'dual-run' || value === 'cutover' ? ['migration-tension'] : [];
    case 'context.review_goal':
      return value === 'security' || value === 'regression-risk' ? ['review-focus-priority'] : [];
    default:
      return [];
  }
}

function buildDiagnostics(
  input: ResolveTaskInput,
  candidates: ParsedTaskCandidate[],
  provenance: InputProvenance,
  conflicts: InterpretationConflict[],
  discardedInputs: DiscardedInterpretationInput[],
): RuntimeDiagnostics {
  const ambiguity_reasons = [
    ...candidates.flatMap((candidate) => candidate.uncertainties ?? []),
    ...provenance.unresolved_fields.map((item) => `${item} unresolved`),
    ...conflicts.map((conflict) => `conflicting candidates for ${conflict.field}`),
  ];
  const discarded = uniqueDiscardedInputs(discardedInputs);

  return {
    warnings: [
      ...ambiguity_reasons.map((item) => `interpretation warning: ${item}`),
      ...discarded.map((item) => `interpretation discarded ${item.source} ${item.field}=${item.value || '(empty)'}: ${item.reason}`),
    ],
    fallback_usage: {
      used_deterministic_interpretation: provenance.resolved_fields.some((field) => field.source === 'deterministic'),
      used_candidate_normalization: Boolean(input.taskModels?.length),
    },
    clarification_recommended: ambiguity_reasons.length > 0 && (!input.taskModels?.length || conflicts.length > 0),
    ambiguity_reasons,
    discarded_inputs: discarded,
  };
}

function recordDiscarded(
  discardedInputs: DiscardedInterpretationInput[],
  field: string,
  value: unknown,
  source: DiscardedInterpretationInput['source'],
  reason: DiscardedInterpretationInput['reason'],
  fallbackValue: unknown,
): void {
  if (source === 'deterministic') return;
  discardedInputs.push({
    field,
    value: value === undefined ? '' : String(value),
    source,
    reason,
    action: 'discarded',
    ...(fallbackValue === undefined ? {} : { fallback: String(fallbackValue) }),
  });
}

function uniqueDiscardedInputs(items: DiscardedInterpretationInput[]): DiscardedInterpretationInput[] {
  const seen = new Set<string>();
  const result: DiscardedInterpretationInput[] = [];
  for (const item of items) {
    const key = `${item.field}:${item.value}:${item.source}:${item.reason}:${item.fallback ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function summarizeCandidate(candidate: ParsedTaskCandidate): CandidateSummary {
  const scalarFields = [
    ['intent.task_kind', candidate.intent.task_kind],
    ['intent.operation', candidate.intent.operation],
    ['intent.target_layer', candidate.intent.target_layer],
    ['intent.target_file', candidate.intent.target_file],
    ['context.project_stage', candidate.context.project_stage],
    ['context.change_type', candidate.context.change_type],
    ['context.optimization_target', candidate.context.optimization_target],
    ['context.risk_level', candidate.context.risk_level],
    ['context.scope_size', candidate.context.scope_size],
    ['context.compatibility_requirement', candidate.context.compatibility_requirement],
    ['context.interface_sensitivity', candidate.context.interface_sensitivity],
    ['context.refactor_tolerance', candidate.context.refactor_tolerance],
    ['context.migration_phase', candidate.context.migration_phase],
    ['context.review_goal', candidate.context.review_goal],
  ] as const;
  const listFields = [
    ['intent.tech_stack', candidate.intent.tech_stack],
    ['intent.changed_files', candidate.intent.changed_files],
    ['intent.tags', candidate.intent.tags],
    ['context.hard_constraints', candidate.context.hard_constraints],
    ['context.allowed_tradeoffs', candidate.context.allowed_tradeoffs],
    ['context.avoid', candidate.context.avoid],
  ] as const;

  const resolved_fields = [
    ...scalarFields.filter(([, field]) => field?.status === 'resolved').map(([name]) => name),
    ...listFields.filter(([, field]) => field?.status === 'resolved' && field.values.length > 0).map(([name]) => name),
  ];
  const unresolved_fields = [
    ...scalarFields.filter(([, field]) => !field || field.status !== 'resolved').map(([name]) => name),
    ...listFields.filter(([, field]) => !field || field.status !== 'resolved' || field.values.length === 0).map(([name]) => name),
  ];
  const source = candidate.intent.task_kind?.source
    ?? candidate.intent.operation?.source
    ?? candidate.intent.target_file?.source
    ?? candidate.context.optimization_target?.source
    ?? 'deterministic';
  const confidenceValues = [
    candidate.intent.task_kind?.confidence,
    candidate.intent.operation?.confidence,
    candidate.intent.target_layer?.confidence,
    candidate.intent.target_file?.confidence,
    candidate.intent.tech_stack?.confidence,
    candidate.intent.changed_files?.confidence,
    candidate.intent.tags?.confidence,
    candidate.context.project_stage?.confidence,
    candidate.context.change_type?.confidence,
    candidate.context.optimization_target?.confidence,
    candidate.context.hard_constraints?.confidence,
    candidate.context.allowed_tradeoffs?.confidence,
    candidate.context.avoid?.confidence,
    candidate.context.risk_level?.confidence,
    candidate.context.scope_size?.confidence,
    candidate.context.compatibility_requirement?.confidence,
    candidate.context.interface_sensitivity?.confidence,
    candidate.context.refactor_tolerance?.confidence,
    candidate.context.migration_phase?.confidence,
    candidate.context.review_goal?.confidence,
  ].filter((value): value is number => typeof value === 'number');
  const confidence = confidenceValues.length
    ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2))
    : 0;

  return {
    source,
    confidence,
    resolved_fields,
    unresolved_fields,
  };
}

function taskModelToCandidate(model: TaskModelProposal): ParsedTaskCandidate {
  return {
    intent: {
      task_kind: scalarField(model.intent.task_kind),
      operation: scalarField(model.intent.operation),
      target_layer: scalarField(model.intent.target_layer),
      target_file: scalarField(model.intent.target_file),
      changed_files: listField(model.intent.changed_files),
      tech_stack: listField(model.intent.tech_stack),
      tags: listField(model.intent.tags),
    },
    context: {
      project_stage: scalarField(model.context.project_stage),
      change_type: undefined,
      optimization_target: scalarField(model.context.optimization_target),
      hard_constraints: listField(model.context.hard_constraints),
      allowed_tradeoffs: listField(model.context.allowed_tradeoffs),
      avoid: listField(model.context.avoid),
      risk_level: scalarField(model.context.risk_level),
      scope_size: scalarField(model.context.scope_size),
      compatibility_requirement: scalarField(model.context.compatibility_requirement),
      interface_sensitivity: scalarField(model.context.interface_sensitivity),
      refactor_tolerance: scalarField(model.context.refactor_tolerance),
      migration_phase: scalarField(model.context.migration_phase),
      review_goal: scalarField(model.context.review_goal),
    },
    uncertainties: model.uncertainties,
  };
}

function scalarField<T extends string>(field: TaskModelScalarField<T> | undefined): CandidateField<T> | undefined {
  if (!field || field.value === undefined) return undefined;
  return {
    value: field.value,
    source: 'host-agent',
    confidence: field.confidence,
    status: 'resolved',
    rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(', ')}`,
  };
}

function listField<T extends string>(field: TaskModelListField<T> | undefined): CandidateListField<T> | undefined {
  if (!field) return undefined;
  return {
    values: field.values,
    source: 'host-agent',
    confidence: field.confidence,
    status: field.values.length ? 'resolved' : 'unresolved',
    rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(', ')}`,
  };
}

function compareCandidateField<T>(left: CandidateField<T>, right: CandidateField<T>): number {
  return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence;
}

function compareCandidateListField<T>(left: CandidateListField<T>, right: CandidateListField<T>): number {
  return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence || right.values.length - left.values.length;
}

function sourceRank(source: CandidateField<unknown>['source']): number {
  switch (source) {
    case 'explicit':
      return 5;
    case 'host-agent':
    case 'assistive-ai':
      return 4;
    case 'derived':
      return 3;
    case 'repo-default':
      return 2;
    case 'deterministic':
      return 1;
  }
}

function summarizeScalarField<T>(field: string, resolved: ScalarResolution<T | undefined>) {
  if (resolved.value === undefined) return null;
  return { field, source: resolved.source, confidence: resolved.confidence };
}

function summarizeListField<T>(field: string, resolved: ListResolution<T>) {
  if (!resolved.values.length) return null;
  return { field, source: resolved.source, confidence: resolved.confidence };
}

function determineResolutionQuality(resolvedFields: InputProvenance['resolved_fields']): InputProvenance['resolution_quality'] {
  if (resolvedFields.every((field) => field.source === 'explicit')) return 'explicit';
  if (resolvedFields.some((field) => field.source === 'host-agent' || field.source === 'assistive-ai')) return 'ai-assisted';
  if (resolvedFields.some((field) => field.source === 'deterministic')) return 'deterministic';
  return 'degraded';
}

function registerConflict(
  field: string,
  winner: CandidateField<unknown>['source'] | CandidateListField<unknown>['source'],
  discarded: Array<CandidateField<unknown>['source'] | CandidateListField<unknown>['source']>,
  conflicts: InterpretationConflict[],
  rationale: string,
) {
  const uniqueDiscarded = [...new Set(discarded.filter((source) => source !== winner))];
  if (!uniqueDiscarded.length) return;
  conflicts.push({ field, winner, discarded: uniqueDiscarded, rationale });
}
