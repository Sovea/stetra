import { normalizePath } from '../utils/paths.ts';
import {
  CHANGE_TYPES,
  RISK_LEVELS,
  SCOPE_LEVELS,
  TASK_DECLARED_SOURCES,
  type NormalizedTaskContext,
  type TaskAlignmentReason,
  type TaskContextInput,
  type TaskDeclaredSource,
  type TaskFieldProvenance,
  type TaskProvenanceInput,
} from './types.ts';

interface NormalizedDeclaredProvenance {
  description?: TaskDeclaredSource;
  changeType?: TaskDeclaredSource;
  targets: Record<string, TaskDeclaredSource>;
  techStack: Record<string, TaskDeclaredSource>;
  risk?: TaskDeclaredSource;
  scope?: TaskDeclaredSource;
  constraints: Record<string, TaskDeclaredSource>;
  avoid: Record<string, TaskDeclaredSource>;
  uncertainties: Record<string, TaskDeclaredSource>;
}

export function normalizeTaskContext(input: TaskContextInput): NormalizedTaskContext {
  const description = requiredString(input.description, 'task.description');
  const changeType = requiredEnum(input.changeType, CHANGE_TYPES, 'task.changeType');
  const targets = normalizeTargets(input.targets);
  const risk = requiredEnum(input.risk, RISK_LEVELS, 'task.risk');
  const scope = requiredEnum(input.scope, SCOPE_LEVELS, 'task.scope');
  const constraints = uniqueStrings(input.constraints ?? []);
  const avoid = uniqueStrings(input.avoid ?? []);
  const uncertainties = uniqueStrings(input.uncertainties ?? []);
  const declaredProvenance = normalizeProvenanceInput(input.provenance, {
    targets,
    techStack: input.techStack ?? [],
    constraints,
    avoid,
    uncertainties,
  });
  const provenance: TaskFieldProvenance[] = [
    scalarProvenance('description', description, declaredProvenance.description),
    scalarProvenance('changeType', changeType, declaredProvenance.changeType),
    ...valueProvenance('targets', targets, declaredProvenance.targets),
  ];

  const explicitStack = uniqueStrings((input.techStack ?? []).map(normalizeTechnologyId));
  const inferredStack = inferTechStack(targets);
  const techStack = uniqueStrings([...explicitStack, ...inferredStack]);
  provenance.push(...techStack.map((technology) => ({
    field: 'techStack' as const,
    value: technology,
    source: explicitStack.includes(technology)
      ? declaredProvenance.techStack[technology] ?? 'agent-inferred'
      : 'deterministic' as const,
  })));
  provenance.push(
    scalarProvenance('risk', risk, declaredProvenance.risk),
    scalarProvenance('scope', scope, declaredProvenance.scope),
    ...valueProvenance('constraints', constraints, declaredProvenance.constraints),
    ...valueProvenance('avoid', avoid, declaredProvenance.avoid),
    ...valueProvenance('uncertainties', uncertainties, declaredProvenance.uncertainties),
  );

  return {
    description,
    changeType,
    targets,
    techStack,
    risk,
    scope,
    constraints,
    avoid,
    uncertainties,
    provenance,
  };
}

export function taskNeedsAlignment(task: NormalizedTaskContext): TaskAlignmentReason[] {
  const reasons: TaskAlignmentReason[] = [];
  if (task.changeType === 'unknown') {
    reasons.push({
      kind: 'clarification',
      field: 'changeType',
      message: 'Change type remains unknown, so task-type policy cannot be activated reliably.',
    });
  }
  for (const uncertainty of task.uncertainties) {
    reasons.push({
      kind: 'decision',
      field: 'uncertainties',
      value: uncertainty,
      message: 'A declared material semantic uncertainty requires a human decision before implementation.',
    });
  }
  return reasons;
}

function scalarProvenance(
  field: 'description' | 'changeType' | 'risk' | 'scope',
  value: string,
  source: TaskDeclaredSource | undefined,
): TaskFieldProvenance {
  return {
    field,
    value,
    source: source ?? 'agent-inferred',
  };
}

function valueProvenance(
  field: 'targets' | 'constraints' | 'avoid' | 'uncertainties',
  values: string[],
  sources: Record<string, TaskDeclaredSource>,
): TaskFieldProvenance[] {
  return values.map((value) => ({
    field,
    value,
    source: sources[value] ?? 'agent-inferred',
  }));
}

function normalizeProvenanceInput(
  input: TaskProvenanceInput | undefined,
  values: {
    targets: string[];
    techStack: string[];
    constraints: string[];
    avoid: string[];
    uncertainties: string[];
  },
): NormalizedDeclaredProvenance {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('task.provenance must be an object.');
  }
  const source = input ?? {};
  for (const key of Object.keys(source)) {
    if (![
      'description',
      'changeType',
      'targets',
      'techStack',
      'risk',
      'scope',
      'constraints',
      'avoid',
      'uncertainties',
    ].includes(key)) {
      throw new Error(`task.provenance contains unsupported field "${key}".`);
    }
  }
  return {
    description: optionalDeclaredSource(source.description, 'task.provenance.description'),
    changeType: optionalDeclaredSource(source.changeType, 'task.provenance.changeType'),
    targets: provenanceMap(source.targets, values.targets, normalizePath, 'targets'),
    techStack: provenanceMap(
      source.techStack,
      uniqueStrings(values.techStack.map(normalizeTechnologyId)),
      normalizeTechnologyId,
      'techStack',
    ),
    risk: optionalDeclaredSource(source.risk, 'task.provenance.risk'),
    scope: optionalDeclaredSource(source.scope, 'task.provenance.scope'),
    constraints: provenanceMap(source.constraints, values.constraints, trimValue, 'constraints'),
    avoid: provenanceMap(source.avoid, values.avoid, trimValue, 'avoid'),
    uncertainties: provenanceMap(
      source.uncertainties,
      values.uncertainties,
      trimValue,
      'uncertainties',
    ),
  };
}

function optionalDeclaredSource(
  value: unknown,
  field: string,
): TaskDeclaredSource | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TASK_DECLARED_SOURCES.includes(value as TaskDeclaredSource)) {
    throw new Error(`${field} must be one of: ${TASK_DECLARED_SOURCES.join(', ')}.`);
  }
  return value as TaskDeclaredSource;
}

function provenanceMap(
  input: unknown,
  allowedValues: string[],
  normalizeValue: (value: string) => string,
  field: string,
): Record<string, TaskDeclaredSource> {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`task.provenance.${field} must be an object keyed by task value.`);
  }
  const result: Record<string, TaskDeclaredSource> = {};
  const allowed = new Set(allowedValues);
  for (const [rawValue, rawSource] of Object.entries(input)) {
    const value = normalizeValue(rawValue);
    if (!allowed.has(value)) {
      throw new Error(`task.provenance.${field} references value "${rawValue}" that is not present in task.${field}.`);
    }
    const declared = optionalDeclaredSource(rawSource, `task.provenance.${field}.${rawValue}`);
    if (!declared) throw new Error(`task.provenance.${field}.${rawValue} requires a source.`);
    if (result[value] && result[value] !== declared) {
      throw new Error(`task.provenance.${field} assigns conflicting sources to "${value}".`);
    }
    result[value] = declared;
  }
  return result;
}

function trimValue(value: string): string {
  return value.trim();
}

function inferTechStack(targets: string[]): string[] {
  const result: string[] = [];
  for (const target of targets) {
    if (/\.(?:ts|tsx|mts|cts)$/.test(target)) result.push('typescript');
    else if (/\.(?:js|jsx|mjs|cjs)$/.test(target)) result.push('javascript');
    else if (/\.py$/.test(target)) result.push('python');
    else if (/\.rs$/.test(target)) result.push('rust');
    else if (/\.go$/.test(target)) result.push('go');
  }
  return uniqueStrings(result);
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function normalizeTechnologyId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTargets(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('task.targets must be an array.');
  const targets = uniqueStrings(value.map((target) => {
    if (typeof target !== 'string') throw new Error('task.targets entries must be strings.');
    return normalizePath(target);
  }));
  if (!targets.length) throw new Error('task.targets must contain at least one repository-relative path.');
  return targets;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
