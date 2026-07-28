import { normalizePath } from '../utils/paths.ts';
import {
  CHANGE_TYPES,
  RISK_LEVELS,
  SCOPE_LEVELS,
  type NormalizedTaskContext,
  type TaskContextInput,
  type TaskFieldProvenance,
} from './types.ts';

export function normalizeTaskContext(input: TaskContextInput): NormalizedTaskContext {
  const description = requiredString(input.description, 'task.description');
  const changeType = requiredEnum(input.changeType, CHANGE_TYPES, 'task.changeType');
  const targets = normalizeTargets(input.targets);
  const risk = requiredEnum(input.risk, RISK_LEVELS, 'task.risk');
  const scope = requiredEnum(input.scope, SCOPE_LEVELS, 'task.scope');
  const provenance: TaskFieldProvenance[] = [];

  provenance.push({
    field: 'changeType',
    source: 'host-provided',
  });
  provenance.push({
    field: 'targets',
    source: 'host-provided',
  });

  const explicitStack = uniqueStrings((input.techStack ?? []).map(normalizeTechnologyId));
  const inferredStack = inferTechStack(targets);
  const techStack = uniqueStrings([...explicitStack, ...inferredStack]);
  provenance.push({
    field: 'techStack',
    source: explicitStack.length ? 'host-provided' : 'deterministic',
  });

  provenance.push({
    field: 'risk',
    source: 'host-provided',
  });
  provenance.push({
    field: 'scope',
    source: 'host-provided',
  });

  return {
    description,
    changeType,
    targets,
    techStack,
    risk,
    scope,
    constraints: uniqueStrings(input.constraints ?? []),
    avoid: uniqueStrings(input.avoid ?? []),
    uncertainties: uniqueStrings(input.uncertainties ?? []),
    provenance,
  };
}

export function taskNeedsAlignment(task: NormalizedTaskContext): string[] {
  const reasons: string[] = [];
  if (task.changeType === 'unknown') {
    reasons.push('change type remains unknown, so task-type policy cannot be activated reliably');
  }
  if (task.uncertainties.length) {
    reasons.push('declared semantic uncertainties require a human decision before implementation');
  }
  return reasons;
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
