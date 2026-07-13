import type { GovernanceIRBundle, SemanticRelationIR } from '../types.ts';

export function adjudicateSemanticRelations(
  relations: SemanticRelationIR[],
  bundle: GovernanceIRBundle,
): SemanticRelationIR[] {
  const directiveById = new Map(bundle.directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(bundle.observations.map((observation) => [observation.id, observation]));

  return relations.map((relation) => {
    const directive = directiveById.get(relation.directiveId);
    const observation = observationById.get(relation.observationId);
    if (!directive) return rejectRelation(relation, 'directive is missing from the IR bundle');
    if (!observation) return rejectRelation(relation, 'observation is missing from the IR bundle');
    if (observation.lifecycle.status === 'superseded') {
      return rejectRelation(relation, 'observation lifecycle is superseded and must not influence current execution');
    }
    if (observation.lifecycle.status === 'stale') {
      return downgradeRelation(relation, 'observation lifecycle is stale, so it can only provide ambient context');
    }
    if (observation.verification.disposition === 'demote-to-ambient') {
      return downgradeRelation(relation, 'verify gate demoted the observation, so it can only provide ambient context');
    }

    switch (relation.relation) {
      case 'suppress':
        return adjudicateSuppressRelation(relation, {
          observationAntiPattern: observation.traits.antiPattern,
          observationVerified: observation.verification.evidenceStatus === 'verified',
        });
      case 'tension':
      case 'reinforce':
        return adjudicateDirectionalRelation(relation);
      case 'ambient-only':
        return acceptRelation(relation, 'ambient-only relation is valid contextual input');
      case 'unrelated':
        return rejectRelation(relation, 'proposal did not establish a semantic relation');
    }
  });
}

function adjudicateSuppressRelation(
  relation: SemanticRelationIR,
  context: {
    observationAntiPattern: boolean;
    observationVerified: boolean;
  },
): SemanticRelationIR {
  if (!relation.basis.scope) return rejectRelation(relation, 'suppression is outside the task scope');
  if (!hasSemanticBasis(relation)) {
    return rejectRelation(relation, 'suppression lacks semantic basis');
  }
  if (!context.observationAntiPattern || !context.observationVerified) {
    return rejectRelation(relation, 'suppression requires a statically verified anti-pattern observation under Runtime policy');
  }
  if (!relation.basis.evidence) {
    return downgradeRelation(relation, 'suppression lacks verified observation evidence');
  }
  return acceptRelation(relation, acceptedReason(relation, 'suppression'));
}

function adjudicateDirectionalRelation(relation: SemanticRelationIR): SemanticRelationIR {
  if (!relation.basis.scope) return rejectRelation(relation, 'directional relation is outside the task scope');
  if (!hasSemanticBasis(relation)) {
    return rejectRelation(relation, 'directional relation lacks semantic basis');
  }
  if (!relation.basis.evidence) {
    return downgradeRelation(relation, 'directional relation lacks verified observation evidence');
  }
  return acceptRelation(relation, acceptedReason(relation, relation.relation));
}

function hasSemanticBasis(relation: SemanticRelationIR): boolean {
  return relation.basis.hostReasoning
    || relation.basis.feedback
    || relation.basis.semanticKey
    || relation.basis.category
    || relation.signals.some((signal) => signal.kind === 'host-proposal' || signal.kind === 'semantic-key');
}

function acceptedReason(relation: SemanticRelationIR, label: string): string {
  const sources = relation.proposedBy === 'multi-source'
    ? 'merged semantic relation sources'
    : relation.proposedBy;
  return `${label} relation accepted from ${sources} after scope, lifecycle, and verification adjudication`;
}

function acceptRelation(relation: SemanticRelationIR, reason: string): SemanticRelationIR {
  return {
    ...relation,
    adjudication: {
      status: 'accepted',
      finalRelation: relation.relation,
      reason,
    },
  };
}

function downgradeRelation(relation: SemanticRelationIR, reason: string): SemanticRelationIR {
  return {
    ...relation,
    adjudication: {
      status: 'downgraded',
      finalRelation: 'ambient-only',
      reason,
    },
  };
}

function rejectRelation(relation: SemanticRelationIR, reason: string): SemanticRelationIR {
  return {
    ...relation,
    adjudication: {
      status: 'rejected',
      finalRelation: 'unrelated',
      reason,
    },
  };
}
