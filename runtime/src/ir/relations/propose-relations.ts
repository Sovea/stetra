import { stableHash } from '../../utils/hash.ts';
import { pathMatchesScope } from '../../utils/paths.ts';
import type { SemanticGovernanceGraphEdge, SemanticGovernanceGraphPayload } from '../../ai-contracts/types.ts';
import {
  GOVERNANCE_IR_VERSION,
  type DirectiveIR,
  type GovernanceIRBundle,
  type HostProposalIR,
  type ObservationIR,
  type SemanticRelationIR,
  type SemanticRelationImpactIR,
  type SemanticRelationReviewPriorityIR,
  type SemanticRelationSignalIR,
  type TaskIR,
} from '../types.ts';
import { proposeFeedbackRelations } from './propose-feedback-relations.ts';

export function proposeSemanticRelations(bundle: GovernanceIRBundle): SemanticRelationIR[] {
  return [
    ...proposeRuntimeStructuralRelations(bundle),
    ...proposeHostGovernanceGraphRelations(bundle),
    ...proposeFeedbackRelations(bundle),
  ];
}

function proposeRuntimeStructuralRelations(bundle: GovernanceIRBundle): SemanticRelationIR[] {
  return bundle.directives.flatMap((directive) => bundle.observations.flatMap((observation) => {
    const relation = proposeRuntimeStructuralRelation(directive, observation, bundle.task);
    return relation ? [relation] : [];
  }));
}

function proposeRuntimeStructuralRelation(
  directive: DirectiveIR,
  observation: ObservationIR,
  task: TaskIR,
): SemanticRelationIR | null {
  if (observation.lifecycle.status === 'superseded') return null;

  const taskScoped = scopeMatchesTask(directive.scope.path, task) && scopeMatchesTask(observation.scope.path, task);
  const semanticKey = semanticKeysOverlap(directive.semanticKey, observation.semanticKey);
  if (!semanticKey) return null;

  const evidence = hasVerifiedEvidence(observation);
  if (!taskScoped || !evidence) return null;
  const relation = 'ambient-only';

  const signals = buildRuntimeSignals(observation, taskScoped, semanticKey, relation);
  const conflictClass = inferConflictClass(directive, observation, relation);
  return {
    irVersion: GOVERNANCE_IR_VERSION,
    id: stableHash(['semantic-relation-ir', 'runtime-structural', directive.id, observation.id, relation, signals]),
    directiveId: directive.id,
    observationId: observation.id,
    proposedBy: 'runtime-structural',
    relation,
    ...(conflictClass ? { conflictClass } : {}),
    confidence: runtimeRelationConfidence(observation),
    basis: {
      scope: taskScoped,
      semanticKey,
      category: false,
      evidence,
      hostReasoning: false,
      feedback: false,
    },
    signals,
    evidenceRefs: observationEvidenceRefs(observation),
    reasoningSummary: summarizeRuntimeProposal(relation),
    impact: defaultImpact(relation),
    reviewPriority: defaultReviewPriority(directive, relation),
    adjudication: {
      status: 'accepted',
      finalRelation: relation,
      reason: 'initial runtime structural context shortlist before adjudication',
    },
  };
}

function proposeHostGovernanceGraphRelations(bundle: GovernanceIRBundle): SemanticRelationIR[] {
  const directiveIds = new Set(bundle.directives.map((directive) => directive.id));
  const observationIds = new Set(bundle.observations.map((observation) => observation.id));

  return bundle.hostProposals.flatMap((proposal) => {
    if (proposal.kind !== 'semantic-governance-graph') return [];
    return graphPayload(proposal).edges.flatMap((edge) => {
      if (!directiveIds.has(edge.directive_id) || !observationIds.has(edge.observation_id)) return [];
      if (!Number.isFinite(edge.confidence) || edge.confidence < 0.5) return [];
      return [toHostGraphRelationIR(proposal, edge, bundle)];
    });
  });
}

function graphPayload(proposal: HostProposalIR): SemanticGovernanceGraphPayload {
  const payload = proposal.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { edges: [] };
  const edges = (payload as Partial<SemanticGovernanceGraphPayload>).edges;
  if (!Array.isArray(edges)) return { edges: [] };
  return { edges: edges.filter(isGraphEdge) };
}

function isGraphEdge(value: unknown): value is SemanticGovernanceGraphEdge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const edge = value as Partial<SemanticGovernanceGraphEdge>;
  return typeof edge.directive_id === 'string'
    && typeof edge.observation_id === 'string'
    && isRelation(edge.relation)
    && typeof edge.confidence === 'number'
    && typeof edge.reason === 'string'
    && Array.isArray(edge.evidence_refs);
}

function toHostGraphRelationIR(
  proposal: HostProposalIR,
  edge: SemanticGovernanceGraphEdge,
  bundle: GovernanceIRBundle,
): SemanticRelationIR {
  const directive = requiredDirective(bundle.directives, edge.directive_id);
  const observation = requiredObservation(bundle.observations, edge.observation_id);
  const taskScoped = scopeMatchesTask(directive.scope.path, bundle.task) && scopeMatchesTask(observation.scope.path, bundle.task);
  const relation = edge.execution_intent === 'suppress' ? 'suppress' : edge.relation;
  const signals = buildHostGraphSignals(edge, observation, taskScoped, relation);
  const conflictClass = edge.conflict_class ?? inferConflictClass(directive, observation, relation);
  const impact = edge.impact ?? defaultImpact(relation);
  const reviewPriority = edge.review_priority ?? defaultReviewPriority(directive, relation);
  const evidenceRefs = edge.evidence_refs.map((ref) => ref.ref);

  return {
    irVersion: GOVERNANCE_IR_VERSION,
    id: stableHash(['semantic-relation-ir', proposal.source.id, edge.directive_id, edge.observation_id, relation, edge.reason, edge.evidence_refs, edge.execution_intent, edge.group_id]),
    directiveId: edge.directive_id,
    observationId: edge.observation_id,
    proposedBy: 'host-agent',
    relation,
    ...(conflictClass ? { conflictClass } : {}),
    confidence: clampConfidence(edge.confidence),
    basis: {
      scope: taskScoped,
      semanticKey: false,
      category: false,
      evidence: hasVerifiedEvidence(observation),
      hostReasoning: true,
      feedback: false,
    },
    signals,
    evidenceRefs,
    reasoningSummary: edge.reason.trim(),
    impact,
    reviewPriority,
    ...(edge.execution_intent ? { executionIntent: edge.execution_intent } : {}),
    ...(edge.merge_intent ? { mergeIntent: edge.merge_intent.slice(0, 360) } : {}),
    ...(edge.group_id ? { groupId: edge.group_id.slice(0, 120) } : {}),
    adjudication: {
      status: 'accepted',
      finalRelation: relation,
      reason: 'initial semantic governance graph edge before Runtime adjudication',
    },
  };
}

function requiredDirective(directives: DirectiveIR[], id: string): DirectiveIR {
  const directive = directives.find((item) => item.id === id);
  if (!directive) throw new Error(`Missing directive for semantic graph edge: ${id}`);
  return directive;
}

function requiredObservation(observations: ObservationIR[], id: string): ObservationIR {
  const observation = observations.find((item) => item.id === id);
  if (!observation) throw new Error(`Missing observation for semantic graph edge: ${id}`);
  return observation;
}

function buildHostGraphSignals(
  edge: SemanticGovernanceGraphEdge,
  observation: ObservationIR,
  taskScoped: boolean,
  relation: SemanticRelationIR['relation'],
): SemanticRelationSignalIR[] {
  return [
    {
      kind: 'host-proposal',
      strength: edge.confidence >= 0.85 ? 'strong' : 'moderate',
      direction: relationToSignalDirection(relation),
      reason: edge.reason.trim(),
    },
    {
      kind: 'scope',
      strength: taskScoped ? 'strong' : 'weak',
      direction: taskScoped ? 'neutral' : 'ambient',
      reason: taskScoped ? 'graph edge matches task-scoped directive and observation' : 'graph edge is outside the concrete task scope',
    },
    {
      kind: 'verification',
      strength: verificationStrength(observation),
      direction: observation.verification.disposition === 'demote-to-ambient' ? 'ambient' : 'neutral',
      reason: `RCCL verification disposition is ${observation.verification.disposition}`,
    },
    {
      kind: 'lifecycle',
      strength: observation.lifecycle.status === 'active' ? 'strong' : 'weak',
      direction: observation.lifecycle.status === 'superseded' || observation.lifecycle.status === 'stale' ? 'ambient' : 'neutral',
      reason: `RCCL lifecycle status is ${observation.lifecycle.status}`,
    },
  ];
}

function buildRuntimeSignals(
  observation: ObservationIR,
  taskScoped: boolean,
  semanticKey: boolean,
  relation: SemanticRelationIR['relation'],
): SemanticRelationSignalIR[] {
  return [
    {
      kind: 'scope',
      strength: taskScoped ? 'strong' : 'weak',
      direction: taskScoped ? 'neutral' : 'ambient',
      reason: taskScoped ? 'directive and observation scopes match the resolved task' : 'directive or observation is outside the resolved task scope',
    },
    {
      kind: 'verification',
      strength: verificationStrength(observation),
      direction: observation.verification.disposition === 'demote-to-ambient' ? 'ambient' : 'neutral',
      reason: `RCCL verification disposition is ${observation.verification.disposition}`,
    },
    {
      kind: 'lifecycle',
      strength: observation.lifecycle.status === 'active' ? 'strong' : 'weak',
      direction: observation.lifecycle.status === 'superseded' || observation.lifecycle.status === 'stale' ? 'ambient' : 'neutral',
      reason: `RCCL lifecycle status is ${observation.lifecycle.status}`,
    },
    ...(semanticKey ? [{
      kind: 'semantic-key' as const,
      strength: 'moderate' as const,
      direction: relationToSignalDirection(relation),
      reason: 'directive and observation semantic keys overlap',
    }] : []),
  ];
}

function isRelation(value: unknown): value is SemanticRelationIR['relation'] {
  return value === 'reinforce' || value === 'tension' || value === 'suppress' || value === 'ambient-only' || value === 'unrelated';
}

function relationToSignalDirection(relation: SemanticRelationIR['relation']): SemanticRelationSignalIR['direction'] {
  if (relation === 'ambient-only' || relation === 'unrelated') return 'ambient';
  return relation;
}

function verificationStrength(observation: ObservationIR): SemanticRelationSignalIR['strength'] {
  if (observation.verification.evidenceStatus === 'verified' || observation.verification.evidenceConfidence >= 0.8) return 'strong';
  if (observation.verification.evidenceStatus === 'partial' || observation.verification.evidenceConfidence >= 0.5) return 'moderate';
  return 'weak';
}

function hasVerifiedEvidence(observation: ObservationIR): boolean {
  return observation.verification.evidenceVerifiedCount > 0
    || observation.verification.evidenceStatus === 'verified'
    || observation.verification.evidenceStatus === 'partial';
}

function runtimeRelationConfidence(observation: ObservationIR): number {
  const verificationConfidence = Math.max(
    observation.verification.evidenceConfidence,
    observation.verification.inductionConfidence,
    observation.adherence.confidence,
  );
  const basisConfidence = 0.75;
  return Number(Math.min(1, Math.max(verificationConfidence, basisConfidence)).toFixed(2));
}

function inferConflictClass(
  directive: DirectiveIR,
  observation: ObservationIR,
  relation: SemanticRelationIR['relation'],
): SemanticRelationIR['conflictClass'] | undefined {
  if (relation === 'unrelated' || relation === 'reinforce' || relation === 'ambient-only') return undefined;
  if (directive.kind === 'anti-pattern' || observation.traits.antiPattern) return 'anti-pattern';
  if (directive.traits.migrationSensitive || observation.traits.migrationBoundary) return 'migration-tension';
  if (directive.traits.compatibilitySensitive || observation.traits.compatibilityBoundary) return 'compatibility-boundary';
  if (observation.traits.legacy) return 'legacy-interface';
  if (observation.category === 'style') return 'style-drift';
  if (observation.category === 'architecture') return 'architecture-drift';
  return 'local-deviation';
}

function summarizeRuntimeProposal(
  relation: SemanticRelationIR['relation'],
): string {
  if (relation === 'ambient-only') {
    return 'runtime structural fallback only shortlisted this verified task-scoped observation as ambient context; execution influence requires a host semantic graph or feedback signal';
  }
  return 'runtime structural fallback did not assign execution influence';
}

function defaultImpact(relation: SemanticRelationIR['relation']): SemanticRelationImpactIR {
  if (relation === 'tension' || relation === 'suppress') return 'execution-mode';
  if (relation === 'reinforce') return 'review-focus';
  if (relation === 'ambient-only') return 'ambient-context';
  return 'no-effect';
}

function defaultReviewPriority(directive: DirectiveIR, relation: SemanticRelationIR['relation']): SemanticRelationReviewPriorityIR {
  if (relation === 'suppress') return 'critical';
  if (relation === 'tension' && (directive.prescription === 'must' || directive.weight === 'critical')) return 'critical';
  if (relation === 'tension') return 'high';
  if (directive.weight === 'critical') return 'high';
  return 'normal';
}

function semanticKeysOverlap(left: string, right: string): boolean {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
}

function observationEvidenceRefs(observation: ObservationIR): string[] {
  return observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`);
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function scopeMatchesTask(scope: string, task: TaskIR): boolean {
  if (task.targets.length === 0) return true;
  return task.targets.some((target) => pathMatchesScope(target.path, scope));
}
