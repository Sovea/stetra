import { stableHash } from '../../utils/hash.ts';
import { pathMatchesScope } from '../../utils/paths.ts';
import {
  GOVERNANCE_IR_VERSION,
  type DirectiveIR,
  type GovernanceIRBundle,
  type ObservationIR,
  type ObservationFeedbackSignalIR,
  type SemanticRelationIR,
  type SemanticRelationSignalIR,
  type TaskIR,
} from '../types.ts';
import { SEMANTIC_RELATION_POLICY } from './policy.ts';

export function proposeFeedbackRelations(bundle: GovernanceIRBundle): SemanticRelationIR[] {
  const directiveById = new Map(bundle.directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(bundle.observations.map((observation) => [observation.id, observation]));
  const observationFeedbackById = new Map(bundle.feedback.observationSignals.map((signal) => [signal.observationId, signal]));

  return bundle.feedback.tensionSignals.flatMap((signal) => {
    if (signal.seenCount < SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount) return [];
    const directive = directiveById.get(signal.directiveId);
    const observation = observationById.get(signal.observationId);
    if (!directive || !observation) return [];
    const observationFeedback = observationFeedbackById.get(observation.id);
    if (!observationFeedbackSupportsInfluence(observation, observationFeedback)) return [];
    if (!hasVerifiedEvidence(observation)) return [];
    const taskScoped = scopeMatchesTask(directive.scope.path, bundle.task) && scopeMatchesTask(observation.scope.path, bundle.task);
    if (!taskScoped) return [];
    return [toFeedbackTensionRelation(signal, directive, observation, bundle.task, taskScoped)];
  });
}

function toFeedbackTensionRelation(
  signal: GovernanceIRBundle['feedback']['tensionSignals'][number],
  directive: DirectiveIR,
  observation: ObservationIR,
  task: TaskIR,
  taskScoped: boolean,
): SemanticRelationIR {
  const signals = buildFeedbackSignals(signal, observation, taskScoped);
  return {
    irVersion: GOVERNANCE_IR_VERSION,
    id: stableHash(['semantic-relation-ir', 'feedback', signal.tensionKey, signal.seenCount, directive.id, observation.id, signals]),
    directiveId: directive.id,
    observationId: observation.id,
    proposedBy: 'feedback',
    relation: 'tension',
    conflictClass: inferFeedbackConflictClass(observation),
    confidence: feedbackConfidence(signal.seenCount),
    basis: {
      scope: taskScoped,
      semanticKey: false,
      category: false,
      evidence: true,
      hostReasoning: false,
      feedback: true,
    },
    signals,
    evidenceRefs: observationEvidenceRefs(observation),
    reasoningSummary: `lockfile feedback recorded recurring tension ${signal.tensionKey} across ${signal.seenCount} task(s) for ${task.operation} work`,
    impact: 'review-focus',
    reviewPriority: directive.prescription === 'must' ? 'high' : 'normal',
    mergeIntent: 'Treat the recurring lockfile tension as a reviewable repository reality, without bypassing RCCL verification.',
    adjudication: {
      status: 'accepted',
      finalRelation: 'tension',
      reason: 'initial feedback relation proposal before adjudication',
    },
  };
}

function observationFeedbackSupportsInfluence(
  observation: ObservationIR,
  signal: ObservationFeedbackSignalIR | undefined,
): boolean {
  if (!signal) return false;
  if (signal.lastDisposition === 'demote-to-ambient') return false;
  if (signal.lastLifecycleStatus !== 'active') return false;
  if (observation.lifecycle.status !== 'active') return false;
  const currentFingerprint = observation.lifecycle.contentFingerprint;
  if (currentFingerprint && signal.lastContentFingerprint !== currentFingerprint) return false;
  return true;
}

function buildFeedbackSignals(
  signal: GovernanceIRBundle['feedback']['tensionSignals'][number],
  observation: ObservationIR,
  taskScoped: boolean,
): SemanticRelationSignalIR[] {
  return [
    {
      kind: 'feedback',
      strength: signal.seenCount >= SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount + 2 ? 'strong' : 'moderate',
      direction: 'tension',
      reason: `lockfile tension ${signal.tensionKey} has appeared ${signal.seenCount} time(s)`,
    },
    {
      kind: 'scope',
      strength: taskScoped ? 'strong' : 'weak',
      direction: taskScoped ? 'neutral' : 'ambient',
      reason: taskScoped ? 'recurring feedback tension matches the current task scope' : 'recurring feedback tension is outside the current task scope',
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
      direction: observation.lifecycle.status === 'active' ? 'neutral' : 'ambient',
      reason: `RCCL lifecycle status is ${observation.lifecycle.status}`,
    },
  ];
}

function feedbackConfidence(seenCount: number): number {
  return Number(Math.min(0.9, 0.62 + seenCount * 0.07).toFixed(2));
}

function inferFeedbackConflictClass(observation: ObservationIR): SemanticRelationIR['conflictClass'] {
  if (observation.traits.migrationBoundary) return 'migration-tension';
  if (observation.traits.compatibilityBoundary || observation.traits.legacy) return 'legacy-interface';
  if (observation.category === 'style') return 'style-drift';
  if (observation.category === 'architecture') return 'architecture-drift';
  return 'local-deviation';
}

function hasVerifiedEvidence(observation: ObservationIR): boolean {
  return observation.verification.evidenceVerifiedCount > 0
    || observation.verification.evidenceStatus === 'verified'
    || observation.verification.evidenceStatus === 'partial';
}

function verificationStrength(observation: ObservationIR): SemanticRelationSignalIR['strength'] {
  if (observation.verification.evidenceStatus === 'verified' || observation.verification.evidenceConfidence >= 0.8) return 'strong';
  if (observation.verification.evidenceStatus === 'partial' || observation.verification.evidenceConfidence >= 0.5) return 'moderate';
  return 'weak';
}

function observationEvidenceRefs(observation: ObservationIR): string[] {
  return observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`);
}

function scopeMatchesTask(scope: string, task: TaskIR): boolean {
  if (task.targets.length === 0) return true;
  return task.targets.some((target) => pathMatchesScope(target.path, scope));
}
