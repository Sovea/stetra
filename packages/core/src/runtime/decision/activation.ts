import type { NormalizedTaskContext } from '../task/types.ts';
import type {
  Directive,
  LocalPlaybook,
  PersonalPlaybook,
} from '../types.ts';
import { scopeOverlapsPath } from '../utils/paths.ts';
import type { DirectiveActivationSummary } from './types.ts';

interface ActivationDirective extends Directive {
  overrideApplied: boolean;
  augmentApplied: boolean;
  personalAugmentApplied: boolean;
}

export function directiveMatchesTask(
  directive: Directive,
  task: NormalizedTaskContext,
): boolean {
  if (!directiveLayerMatchesTask(directive, task)) return false;
  if (!task.targets.length) return true;
  return task.targets.some((target) =>
    scopeOverlapsPath(directive.scope.path, target));
}

export function buildActivationSummary(input: {
  task: NormalizedTaskContext;
  activeDirectives: ActivationDirective[];
  candidateDirectives: ActivationDirective[];
  local: LocalPlaybook | null;
  personal: PersonalPlaybook | null;
}): DirectiveActivationSummary {
  const activeBySource: DirectiveActivationSummary['activeBySource'] = {
    builtin: [],
    team: [],
    personal: [],
  };
  for (const directive of input.activeDirectives) {
    for (const source of directiveContributorSources(directive)) {
      activeBySource[source].push(directive.id);
    }
  }

  const inactive = input.task.targets.length
    ? input.candidateDirectives.flatMap((directive) => {
        if (!directiveLayerMatchesTask(directive, input.task)
          || input.task.targets.some((target) =>
            scopeOverlapsPath(directive.scope.path, target))) {
          return [];
        }
        const sources = directiveContributorSources(directive)
          .filter((source): source is 'team' | 'personal' => source !== 'builtin');
        return sources.length
          ? [{
              id: directive.id,
              scope: directive.scope.path,
              sources,
              reason: 'scope-no-overlap' as const,
            }]
          : [];
      })
    : [];

  return {
    targets: [...input.task.targets],
    techStack: [...input.task.techStack],
    techStackSource: input.task.provenance
      .find((item) => item.field === 'techStack')?.source ?? 'defaulted',
    activeBySource: {
      builtin: sortedUnique(activeBySource.builtin),
      team: sortedUnique(activeBySource.team),
      personal: sortedUnique(activeBySource.personal),
    },
    configuredBySource: {
      team: sortedUnique([
        ...(input.local?.additions.map((item) => item.id) ?? []),
        ...(input.local?.overrides.map((item) => item.supersedes) ?? []),
        ...(input.local?.augments.map((item) => item.id) ?? []),
      ]),
      personal: sortedUnique([
        ...(input.personal?.additions.map((item) => item.id) ?? []),
        ...(input.personal?.augments.map((item) => item.id) ?? []),
      ]),
    },
    inactive: inactive.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function directiveLayerMatchesTask(
  directive: Directive,
  task: NormalizedTaskContext,
): boolean {
  const layer = directive.source.layerId;
  if (layer.startsWith('builtin/task-types/')
    && !layer.endsWith(`/${task.changeType}`)) {
    return false;
  }
  if (layer.startsWith('builtin/languages/')
    && !task.techStack.some((tech) => layer.endsWith(`/${tech}`))) {
    return false;
  }
  if (layer.startsWith('builtin/frameworks/')
    && !task.techStack.some((tech) => layer.endsWith(`/${tech}`))) {
    return false;
  }
  return true;
}

function directiveContributorSources(
  directive: ActivationDirective,
): Array<'builtin' | 'team' | 'personal'> {
  const result: Array<'builtin' | 'team' | 'personal'> = [];
  if (directive.source.kind === 'builtin') result.push('builtin');
  if (directive.source.kind === 'local-addition'
    || directive.overrideApplied
    || directive.augmentApplied) {
    result.push('team');
  }
  if (directive.source.kind === 'personal-addition'
    || directive.personalAugmentApplied) {
    result.push('personal');
  }
  return result;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
