import { type GovernanceIRBundle, type SemanticRelationIR } from '../types.ts';
import { adjudicateSemanticRelations } from './adjudicate-relations.ts';
import { proposeSemanticRelations } from './propose-relations.ts';

export function buildSemanticRelationsIR(bundle: GovernanceIRBundle): SemanticRelationIR[] {
  const proposals = proposeSemanticRelations(bundle);
  const agenticRelations = adjudicateSemanticRelations(
    mergeRelationProposals(proposals.filter(isAgenticRelationProposal)),
    bundle,
  );
  const agenticPairs = effectiveRelationPairs(agenticRelations);
  const structuralFallbackRelations = adjudicateSemanticRelations(
    mergeRelationProposals(proposals.filter((relation) =>
      relation.proposedBy === 'runtime-structural'
      && !agenticPairs.has(relationPairKey(relation)))),
    bundle,
  );
  return [...agenticRelations, ...structuralFallbackRelations]
    .sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}

function mergeRelationProposals(relations: SemanticRelationIR[]): SemanticRelationIR[] {
  const grouped = new Map<string, SemanticRelationIR[]>();
  for (const relation of relations) {
    const key = `${relation.directiveId}::${relation.observationId}`;
    const current = grouped.get(key) ?? [];
    current.push(relation);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map(mergeRelationGroup)
    .sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}

function mergeRelationGroup(group: SemanticRelationIR[]): SemanticRelationIR {
  if (group.length === 1) return group[0];
  return [...group].sort(compareWholeProposals)[0];
}

function compareWholeProposals(left: SemanticRelationIR, right: SemanticRelationIR): number {
  const sourceRank = { 'host-agent': 3, feedback: 2, 'runtime-structural': 1, 'multi-source': 0 } as const;
  const source = sourceRank[right.proposedBy] - sourceRank[left.proposedBy];
  if (source) return source;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  if (left.basis.evidence !== right.basis.evidence) return left.basis.evidence ? -1 : 1;
  if (left.evidenceRefs.length !== right.evidenceRefs.length) return right.evidenceRefs.length - left.evidenceRefs.length;
  return left.id.localeCompare(right.id);
}

function chooseMergedRelation(group: SemanticRelationIR[]): SemanticRelationIR['relation'] {
  const relations = group.map((item) => item.relation);
  if (relations.includes('suppress')) return 'suppress';
  if (relations.includes('tension')) return 'tension';
  if (relations.includes('reinforce')) return 'reinforce';
  if (relations.includes('ambient-only')) return 'ambient-only';
  return 'unrelated';
}

function chooseImpact(group: SemanticRelationIR[], relation: SemanticRelationIR['relation']): SemanticRelationIR['impact'] {
  const explicit = group.find((item) => item.impact && item.relation === relation)?.impact
    ?? group.find((item) => item.impact)?.impact;
  if (explicit) return explicit;
  if (relation === 'tension' || relation === 'suppress') return 'execution-mode';
  if (relation === 'reinforce') return 'review-focus';
  if (relation === 'ambient-only') return 'ambient-context';
  return 'no-effect';
}

function chooseReviewPriority(group: SemanticRelationIR[]): SemanticRelationIR['reviewPriority'] {
  const order = { low: 0, normal: 1, high: 2, critical: 3 } as const;
  return group
    .map((item) => item.reviewPriority)
    .filter((item): item is NonNullable<SemanticRelationIR['reviewPriority']> => Boolean(item))
    .sort((left, right) => order[right] - order[left])[0];
}

function isAgenticRelationProposal(relation: SemanticRelationIR): boolean {
  return relation.proposedBy === 'host-agent' || relation.proposedBy === 'feedback';
}

function effectiveRelationPairs(relations: SemanticRelationIR[]): Set<string> {
  return new Set(relations
    .filter((relation) => relation.adjudication.status !== 'rejected' && relation.adjudication.finalRelation !== 'unrelated')
    .map(relationPairKey));
}

function relationPairKey(relation: Pick<SemanticRelationIR, 'directiveId' | 'observationId'>): string {
  return `${relation.directiveId}::${relation.observationId}`;
}

function chooseExecutionIntent(group: SemanticRelationIR[]): SemanticRelationIR['executionIntent'] {
  const order = {
    suppress: 5,
    'deviation-noted': 4,
    enforce: 3,
    ambient: 2,
    'no-change': 1,
  } as const;
  return group
    .map((item) => item.executionIntent)
    .filter((item): item is NonNullable<SemanticRelationIR['executionIntent']> => Boolean(item))
    .sort((left, right) => order[right] - order[left])[0];
}

function chooseMergeIntent(group: SemanticRelationIR[]): string | undefined {
  return group.find((item) => item.mergeIntent)?.mergeIntent;
}

function chooseGroupId(group: SemanticRelationIR[]): string | undefined {
  return group.find((item) => item.groupId)?.groupId;
}

function chooseConflictClass(
  group: SemanticRelationIR[],
  relation: SemanticRelationIR['relation'],
): SemanticRelationIR['conflictClass'] | undefined {
  return group.find((item) => item.relation === relation && item.conflictClass)?.conflictClass
    ?? group.find((item) => item.conflictClass)?.conflictClass;
}

function summarizeMergedReasoning(group: SemanticRelationIR[], relation: SemanticRelationIR['relation']): string {
  const sources = uniqueStrings(group.map((item) => item.proposedBy)).join(', ');
  const reasons = uniqueStrings(group.map((item) => item.reasoningSummary)).slice(0, 3).join(' | ');
  return `merged ${group.length} proposal(s) from ${sources}; selected ${relation}; ${reasons}`;
}

function uniqueSignals(signals: SemanticRelationIR['signals']): SemanticRelationIR['signals'] {
  const seen = new Set<string>();
  const result: SemanticRelationIR['signals'] = [];
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.strength}:${signal.direction}:${signal.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(signal);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
