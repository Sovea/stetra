import { normalizePath } from '../utils/paths.ts';
import {
  CHANGE_TYPES,
  RISK_LEVELS,
  SCOPE_LEVELS,
  type ChangeType,
  type NormalizedTaskContext,
  type RiskLevel,
  type ScopeLevel,
  type TaskContextInput,
  type TaskFieldProvenance,
} from './types.ts';

export function normalizeTaskContext(input: TaskContextInput): NormalizedTaskContext {
  const description = requiredString(input.description, 'task.description');
  const targets = uniqueStrings(input.targets?.map(normalizePath) ?? []);
  const explicitSource = input.interpretationSource === 'host-provided' ? 'host-provided' : 'explicit';
  const provenance: TaskFieldProvenance[] = [];

  const explicitChangeType = enumValue(input.changeType, CHANGE_TYPES);
  const inferredChangeType = inferChangeType(description);
  const changeType = explicitChangeType ?? inferredChangeType ?? 'unknown';
  provenance.push({
    field: 'changeType',
    source: explicitChangeType ? explicitSource : inferredChangeType ? 'deterministic' : 'defaulted',
  });

  provenance.push({
    field: 'targets',
    source: targets.length ? explicitSource : 'defaulted',
  });

  const explicitStack = uniqueStrings(input.techStack ?? []);
  const inferredStack = inferTechStack(targets);
  const techStack = uniqueStrings([...explicitStack, ...inferredStack]);
  provenance.push({
    field: 'techStack',
    source: explicitStack.length ? explicitSource : inferredStack.length ? 'deterministic' : 'defaulted',
  });

  const explicitRisk = enumValue(input.risk, RISK_LEVELS);
  const risk = explicitRisk ?? inferRisk(changeType, targets, description);
  provenance.push({
    field: 'risk',
    source: explicitRisk ? explicitSource : 'deterministic',
  });

  const explicitScope = enumValue(input.scope, SCOPE_LEVELS);
  const scope = explicitScope ?? inferScope(targets);
  provenance.push({
    field: 'scope',
    source: explicitScope ? explicitSource : targets.length ? 'deterministic' : 'defaulted',
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

export function taskNeedsInterpretation(task: NormalizedTaskContext, mode: 'standard' | 'strict'): string[] {
  const reasons: string[] = [];
  if (task.changeType === 'unknown' && (mode === 'strict' || task.risk === 'high')) {
    reasons.push('change type is unknown for a strict or high-risk task');
  }
  if (task.targets.length === 0 && (mode === 'strict' || task.risk === 'high')) {
    reasons.push('no target path was supplied for a strict or high-risk task');
  }
  if (task.uncertainties.length && mode === 'strict') {
    reasons.push('strict mode requires explicit resolution of declared uncertainties');
  }
  return reasons;
}

function inferChangeType(description: string): Exclude<ChangeType, 'unknown'> | undefined {
  const value = description.toLowerCase();
  if (/\b(fix|bug|defect|regression|repair)\b|修复|缺陷|回归/.test(value)) return 'bugfix';
  if (/\b(refactor|restructure|cleanup)\b|重构|整理/.test(value)) return 'refactor';
  if (/\b(migrate|migration|cutover)\b|迁移|切换/.test(value)) return 'migration';
  if (/\b(document|docs?|readme)\b|文档/.test(value)) return 'docs';
  if (/\b(test|spec|coverage)\b|测试|覆盖率/.test(value)) return 'test';
  if (/\b(add|create|implement|feature)\b|新增|实现|功能/.test(value)) return 'feature';
  if (/\b(maintain|upgrade|update|chore)\b|维护|升级|更新/.test(value)) return 'maintenance';
  return undefined;
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

function inferRisk(changeType: ChangeType, targets: string[], description: string): RiskLevel {
  if (changeType === 'migration' || /security|auth|payment|database|安全|认证|支付|数据库/i.test(description)) return 'high';
  if (changeType === 'docs' || changeType === 'test') return 'low';
  if (targets.length === 1) return 'low';
  return 'medium';
}

function inferScope(targets: string[]): ScopeLevel {
  if (targets.length <= 1) return targets.length ? 'local' : 'module';
  const roots = new Set(targets.map((target) => target.split('/').slice(0, 2).join('/')));
  if (roots.size === 1) return 'module';
  return roots.size <= 3 ? 'cross-module' : 'repository';
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
