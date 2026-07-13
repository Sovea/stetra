import { minimatch } from '../../utils/glob.ts';
import type { ActivationDecisionIR, DirectiveIR, GovernanceIRBundle, TaskIR } from '../types.ts';

export function resolveActivationDecisionsIR(bundle: GovernanceIRBundle): ActivationDecisionIR[] {
  return sortActivationDecisions(bundle.directives.map((directive) => resolveDirectiveActivation(directive, bundle.task)));
}

export function activatedDirectiveIdsIR(decisions: ActivationDecisionIR[]): Set<string> {
  return new Set(decisions.filter((decision) => decision.status === 'activated').map((decision) => decision.directiveId));
}

function resolveDirectiveActivation(directive: DirectiveIR, task: TaskIR): ActivationDecisionIR {
  if (directive.local.suppressed) {
    return buildSkippedDecision(
      directive,
      'suppressed-by-local',
      directive.local.suppressionReason ? `directive suppressed by local playbook: ${directive.local.suppressionReason}` : 'directive suppressed by local playbook',
    );
  }

  if (!layerMatchesTask(directive, task)) {
    return buildSkippedDecision(directive, 'layer-mismatch', 'directive layer does not match resolved task intent');
  }

  if (!scopeMatchesTask(directive.scope.path, task)) {
    return buildSkippedDecision(directive, 'scope-mismatch', 'directive scope does not match target or changed files');
  }

  return {
    directiveId: directive.id,
    layerId: directive.layer.id,
    sourcePath: directive.source.path,
    status: 'activated',
    reason: 'matched',
    note: buildActivationNote(directive, task),
    effectivePrescription: directive.prescription,
    effectiveWeight: directive.weight,
    priority: directive.priority,
    localState: directive.local,
  };
}

function buildSkippedDecision(
  directive: DirectiveIR,
  reason: Exclude<ActivationDecisionIR['reason'], 'matched'>,
  note: string,
): ActivationDecisionIR {
  return {
    directiveId: directive.id,
    layerId: directive.layer.id,
    sourcePath: directive.source.path,
    status: 'skipped',
    reason,
    note,
    effectivePrescription: directive.prescription,
    effectiveWeight: directive.weight,
    priority: directive.priority,
    localState: directive.local,
  };
}

function buildActivationNote(directive: DirectiveIR, task: TaskIR): string {
  const reasons = [`directive matched ${task.workflow}/${task.changeType}/${task.operation} task context`];
  if (directive.source.kind === 'local-playbook') reasons.push('local directive addition applied');
  if (directive.local.overrideApplied) reasons.push('local override applied');
  if (directive.local.augmentApplied) reasons.push('local examples augment applied');
  if (directive.layer.id === 'builtin/core') reasons.push('core guidance always eligible');
  return reasons.join('; ');
}

function layerMatchesTask(directive: DirectiveIR, task: TaskIR): boolean {
  const sourceLayer = directive.layer.id;
  if (sourceLayer === 'builtin/core' || directive.source.kind === 'local-playbook' || sourceLayer.startsWith('local')) return true;
  if (sourceLayer.startsWith('builtin/task-types/')) {
    return task.changeType !== 'unknown' && sourceLayer.endsWith(`/${task.changeType}`);
  }
  if (sourceLayer.startsWith('builtin/languages/')) return task.techStack.some((tech) => sourceLayer.endsWith(`/${tech}`));
  if (sourceLayer.startsWith('builtin/frameworks/')) return task.techStack.some((tech) => sourceLayer.endsWith(`/${tech}`));
  return true;
}

function scopeMatchesTask(scope: string, task: TaskIR): boolean {
  if (task.targets.length === 0) return true;
  return task.targets.some((target) => minimatch(target.path, scope));
}

function sortActivationDecisions(items: ActivationDecisionIR[]): ActivationDecisionIR[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'activated' ? -1 : 1;
    if (a.priority.prescriptionRank !== b.priority.prescriptionRank) return b.priority.prescriptionRank - a.priority.prescriptionRank;
    if (a.priority.layerRank !== b.priority.layerRank) return b.priority.layerRank - a.priority.layerRank;
    if (a.priority.weightRank !== b.priority.weightRank) return b.priority.weightRank - a.priority.weightRank;
    if (a.priority.localOverrideRank !== b.priority.localOverrideRank) return b.priority.localOverrideRank - a.priority.localOverrideRank;
    return a.directiveId.localeCompare(b.directiveId);
  });
}
