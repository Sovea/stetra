import type {
  ContextInfluenceRecord,
  ContextProfile,
  Directive,
  ExecutionMode,
  RcclObservation,
  ReviewFocusSeed,
  SemanticMergeDirectiveLink,
  SemanticMergeRelationSummary,
  SemanticMergeResult,
  SemanticMergeTensionRecord,
} from '../../types.ts';
import type { ExecutionDecisionIR, SemanticRelationIR } from '../types.ts';
import { semanticRelationsIRToPublic } from '../relations/public-mapping.ts';
import { semanticRelationPolicyTraceRecord } from '../relations/policy.ts';
import { contextInfluenceEffect, contextReviewPriorityBoost } from '../execution/context-policy.ts';

export function projectIRSemanticMergeToPublic(
  directives: Directive[],
  observations: RcclObservation[],
  relationsIR: SemanticRelationIR[],
  executionDecisionsIR: ExecutionDecisionIR[],
  contextProfile: ContextProfile,
): SemanticMergeResult {
  const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const effectiveRelations = relationsIR.filter(isEffectiveRelation);
  const relationSummaryById = new Map(relationsIR.map((relation) => [relation.id, relationSummary(relation)]));
  const observationIdsByDirective = groupObservationIdsByDirective(effectiveRelations);
  const directiveModes = executionDecisionsIR.map((decision) => projectExecutionDecision(
    decision,
    observationIdsByDirective.get(decision.directiveId) ?? [],
    relationSummaryById,
  ));
  const contextTensions = buildContextTensions(effectiveRelations, directiveById, observationById, contextProfile);
  const contextInfluences = buildContextInfluences(executionDecisionsIR);
  const reviewFocus = buildReviewFocus(directiveModes, effectiveRelations, directiveById, contextTensions);
  const observationStates = buildObservationStates(observations, directiveModes);
  const relations = semanticRelationsIRToPublic(relationsIR);

  return {
    activated_directives: directiveModes
      .filter((item) => item.execution_mode !== 'suppress')
      .map((item) => item.directive_id),
    suppressed_directives: directiveModes
      .filter((item) => item.execution_mode === 'suppress')
      .map((item) => item.directive_id),
    context_tensions: contextTensions,
    directive_modes: directiveModes,
    observation_links: observationStates.map((state) => ({
      observation_id: state.observation_id,
      directive_ids: state.directive_ids,
    })),
    observation_states: observationStates,
    relations,
    merge_summary: buildMergeSummary(relationsIR, executionDecisionsIR),
    focus: {
      review_focus: uniqueFocus(reviewFocus),
    },
    context_influences: contextInfluences,
  };
}

function isEffectiveRelation(relation: SemanticRelationIR): boolean {
  return relation.adjudication.status !== 'rejected' && relation.adjudication.finalRelation !== 'unrelated';
}

function groupObservationIdsByDirective(relations: SemanticRelationIR[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const relation of relations) {
    const current = grouped.get(relation.directiveId) ?? [];
    if (!current.includes(relation.observationId)) current.push(relation.observationId);
    grouped.set(relation.directiveId, current);
  }
  return grouped;
}

function projectExecutionDecision(
  decision: ExecutionDecisionIR,
  observationIds: string[],
  relationSummaryById: Map<string, SemanticMergeRelationSummary>,
): SemanticMergeDirectiveLink {
  const relation_summaries = decision.relationIds.flatMap((relationId) => {
    const summary = relationSummaryById.get(relationId);
    return summary ? [summary] : [];
  });
  return {
    directive_id: decision.directiveId,
    observation_ids: observationIds,
    relation_ids: decision.relationIds,
    relation_summaries,
    execution_mode: decision.mode,
    default_execution_mode: decision.defaultMode,
    reason: decision.reason,
    decision_basis: publicDecisionBasis(decision.basis),
    context_applied: decision.contextApplied,
    context_rule_ids: decision.contextRulesApplied,
    feedback_applied: decision.feedbackApplied,
  };
}

function publicDecisionBasis(basis: ExecutionDecisionIR['basis']): SemanticMergeDirectiveLink['decision_basis'] {
  switch (basis) {
    case 'prescription':
      return 'default';
    case 'governance-graph':
      return 'observed-conflict';
    case 'verification':
      return 'rccl-immune';
    case 'task-context':
    case 'feedback':
      return 'context-adjusted';
    case 'anti-pattern':
      return 'anti-pattern';
  }
}

function buildObservationStates(observations: RcclObservation[], directiveModes: SemanticMergeDirectiveLink[]): SemanticMergeResult['observation_states'] {
  return observations.map((observation) => ({
    observation_id: observation.id,
    directive_ids: directiveModes
      .filter((item) => item.observation_ids.includes(observation.id))
      .map((item) => item.directive_id),
    disposition: observation.verification.disposition ?? 'pending',
    lifecycle_status: observation.lifecycle?.status ?? 'unknown',
    content_fingerprint: observation.lifecycle?.content_fingerprint ?? null,
  }));
}

function buildContextTensions(
  relations: SemanticRelationIR[],
  directiveById: Map<string, Directive>,
  observationById: Map<string, RcclObservation>,
  contextProfile: ContextProfile,
): SemanticMergeTensionRecord[] {
  return relations.flatMap((relation) => {
    if (relation.adjudication.finalRelation !== 'tension') return [];
    const directive = directiveById.get(relation.directiveId);
    const observation = observationById.get(relation.observationId);
    if (!directive || !observation || directive.prescription !== 'must') return [];
    return [{
      directive_id: directive.id,
      observation_id: observation.id,
      relation_id: relation.id,
      group_id: relation.groupId,
      review_priority: relation.reviewPriority,
      category: observation.category,
      execution_mode: 'deviation-noted' as ExecutionMode,
      conflict: `${directive.description} conflicts with observed local pattern: ${observation.pattern}`,
      resolution: buildTensionResolution(directive.id, contextProfile, observation),
      rccl_confidence: observation.verification.induction_confidence ?? observation.verification.evidence_confidence ?? relation.confidence,
    }];
  });
}

function buildReviewFocus(
  directiveModes: SemanticMergeDirectiveLink[],
  relations: SemanticRelationIR[],
  directiveById: Map<string, Directive>,
  contextTensions: SemanticMergeTensionRecord[],
): ReviewFocusSeed[] {
  const reviewFocus: ReviewFocusSeed[] = [];

  for (const decision of directiveModes) {
    const directive = directiveById.get(decision.directive_id);
    if (!directive) continue;
    if (decision.execution_mode === 'deviation-noted') {
      reviewFocus.push({
        kind: 'compatibility-boundary',
        directive_id: directive.id,
        reason: decision.reason,
        priority: directiveFocusPriority(directive, decision),
        relation_id: decision.relation_summaries[0]?.relation_id,
        group_id: decision.relation_summaries[0]?.group_id,
      });
    }
    if (
      directive.prescription === 'must'
      || decision.execution_mode === 'deviation-noted'
      || (directive.weight === 'critical' && decision.execution_mode === 'enforce')
    ) {
      reviewFocus.push({
        kind: 'high-priority-directive',
        directive_id: directive.id,
        reason: `Review whether ${directive.id} was respected under ${decision.execution_mode} execution mode.`,
        priority: directiveFocusPriority(directive, decision),
        relation_id: decision.relation_summaries[0]?.relation_id,
        group_id: decision.relation_summaries[0]?.group_id,
      });
    }
    if (decision.feedback_applied.includes('feedback:frequently-ignored-must-review')) {
      reviewFocus.push({
        kind: 'high-priority-directive',
        directive_id: directive.id,
        reason: `Review ${directive.id} because lockfile feedback shows repeated ignores; Runtime did not weaken must-level execution.`,
        priority: 'high',
        relation_id: decision.relation_summaries[0]?.relation_id,
        group_id: decision.relation_summaries[0]?.group_id,
      });
    }
  }

  for (const tension of contextTensions) {
    reviewFocus.push({
      kind: 'tension',
      directive_id: tension.directive_id,
      observation_id: tension.observation_id,
      reason: tension.resolution,
      priority: tension.review_priority ?? 'high',
      relation_id: tension.relation_id,
      group_id: tension.group_id,
    });
  }

  for (const relation of relations.filter((item) => item.adjudication.finalRelation === 'suppress')) {
    reviewFocus.push({
      kind: 'anti-pattern',
      directive_id: relation.directiveId,
      observation_id: relation.observationId,
      reason: relation.adjudication.reason,
      priority: relation.reviewPriority ?? 'critical',
      relation_id: relation.id,
      group_id: relation.groupId,
    });
  }

  for (const relation of relations.filter((item) => item.reviewPriority === 'high' || item.reviewPriority === 'critical')) {
    if (relation.adjudication.finalRelation === 'suppress' || relation.adjudication.finalRelation === 'tension') continue;
    reviewFocus.push({
      kind: 'high-priority-directive',
      directive_id: relation.directiveId,
      observation_id: relation.observationId,
      reason: relation.mergeIntent ?? relation.adjudication.reason,
      priority: relation.reviewPriority,
      relation_id: relation.id,
      group_id: relation.groupId,
    });
  }

  return reviewFocus;
}

function relationSummary(relation: SemanticRelationIR): SemanticMergeRelationSummary {
  return {
    relation_id: relation.id,
    observation_id: relation.observationId,
    relation: publicRelationKind(relation.adjudication.finalRelation),
    adjudication_status: relation.adjudication.status,
    confidence: relation.confidence,
    reason: relation.mergeIntent ?? relation.adjudication.reason,
    review_priority: relation.reviewPriority,
    impact: relation.impact,
    group_id: relation.groupId,
  };
}

function buildMergeSummary(relations: SemanticRelationIR[], decisions: ExecutionDecisionIR[]): SemanticMergeResult['merge_summary'] {
  const final_relation_counts = emptyRelationCounts();
  const proposed_by_counts: Record<string, number> = {};
  const review_priority_counts = { low: 0, normal: 0, high: 0, critical: 0 };
  let accepted = 0;
  let downgraded = 0;
  let rejected = 0;
  let executionModeImpacting = 0;

  for (const relation of relations) {
    if (relation.adjudication.status === 'accepted') accepted += 1;
    if (relation.adjudication.status === 'downgraded') downgraded += 1;
    if (relation.adjudication.status === 'rejected') rejected += 1;
    final_relation_counts[publicRelationKind(relation.adjudication.finalRelation)] += 1;
    proposed_by_counts[relation.proposedBy] = (proposed_by_counts[relation.proposedBy] ?? 0) + 1;
    if (relation.reviewPriority) review_priority_counts[relation.reviewPriority] += 1;
    if (relation.impact === 'execution-mode' && relation.adjudication.status !== 'rejected') executionModeImpacting += 1;
  }

  return {
    proposed: relations.length,
    accepted,
    downgraded,
    rejected,
    final_relation_counts,
    proposed_by_counts,
    execution_mode_impacting: executionModeImpacting,
    feedback_applied_count: decisions.reduce((count, decision) => count + decision.feedbackApplied.length, 0),
    host_graph_edge_count: relations.filter(hasHostGraphSource).length,
    review_priority_counts,
    policy: semanticRelationPolicyTraceRecord(),
  };
}

function emptyRelationCounts(): SemanticMergeResult['merge_summary']['final_relation_counts'] {
  return {
    reinforce: 0,
    tension: 0,
    'anti-pattern-suppress': 0,
    'ambient-only': 0,
    none: 0,
  };
}

function publicRelationKind(relation: SemanticRelationIR['adjudication']['finalRelation']): SemanticMergeRelationSummary['relation'] {
  switch (relation) {
    case 'reinforce':
    case 'tension':
    case 'ambient-only':
      return relation;
    case 'suppress':
      return 'anti-pattern-suppress';
    case 'unrelated':
      return 'none';
  }
}

function directiveFocusPriority(
  directive: Directive,
  decision: SemanticMergeDirectiveLink,
): ReviewFocusSeed['priority'] {
  const executionMode = decision.execution_mode;
  const contextBoost = contextReviewPriorityBoost(decision.context_applied);
  if (contextBoost) return contextBoost;
  if (executionMode === 'suppress') return 'critical';
  if (executionMode === 'deviation-noted') return directive.weight === 'critical' || directive.prescription === 'must' ? 'critical' : 'high';
  if (directive.weight === 'critical') return 'high';
  if (directive.prescription === 'must') return 'normal';
  return 'low';
}

function hasHostGraphSource(relation: SemanticRelationIR): boolean {
  return relation.proposedBy === 'host-agent'
    || relation.signals.some((signal) => signal.kind === 'host-proposal');
}

function buildContextInfluences(decisions: ExecutionDecisionIR[]): ContextInfluenceRecord[] {
  return decisions.flatMap((decision) => {
    const contextInfluences = decision.contextApplied.map((context) => {
      const [field, value] = context.split(':');
      return {
        field: publicContextField(field),
        value: value ?? '',
        directive_id: decision.directiveId,
        effect: contextInfluenceEffect(context, decision.mode),
      };
    });
    const feedbackInfluences = decision.feedbackApplied.map((feedback) => ({
      field: 'feedback' as const,
      value: feedback,
      directive_id: decision.directiveId,
      effect: contextInfluenceEffect(feedback, decision.mode),
    }));
    return [...contextInfluences, ...feedbackInfluences];
  });
}

function publicContextField(field: string): ContextInfluenceRecord['field'] {
  switch (field) {
    case 'optimization_target':
    case 'hard_constraints':
    case 'allowed_tradeoffs':
    case 'avoid':
    case 'risk_level':
    case 'scope_size':
    case 'compatibility_requirement':
    case 'interface_sensitivity':
    case 'refactor_tolerance':
    case 'migration_phase':
    case 'review_goal':
    case 'feedback':
      return field;
    default:
      return 'project_stage';
  }
}

function buildTensionResolution(
  directiveId: string,
  contextProfile: ContextProfile,
  observation: RcclObservation,
): string {
  if (hasConstraint(contextProfile.hard_constraints, ['preserve compatibility', 'avoid breaking changes', 'preserve public api'])) {
    return `Follow ${directiveId} for new code, but preserve compatibility with the observed ${observation.category} repository pattern at touched interfaces.`;
  }
  if (hasConstraint(contextProfile.allowed_tradeoffs, ['prefer narrow change scope'])) {
    return `Follow ${directiveId} for the touched code, but contain the change to the local boundary instead of broad cleanup around the observed repository pattern.`;
  }
  if (hasConstraint(contextProfile.avoid, ['broad rewrites', 'overengineering'])) {
    return `Follow ${directiveId} in the local change, but avoid turning this tension into a broad rewrite of the observed repository pattern.`;
  }
  return `Follow ${directiveId} for new code, but preserve compatibility with the observed repository pattern where interfaces depend on it.`;
}

function hasConstraint(values: string[], expected: string[]): boolean {
  return expected.some((item) => values.includes(item));
}

function uniqueFocus(items: ReviewFocusSeed[]): ReviewFocusSeed[] {
  const seen = new Set<string>();
  const result: ReviewFocusSeed[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.directive_id ?? ''}:${item.observation_id ?? ''}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
