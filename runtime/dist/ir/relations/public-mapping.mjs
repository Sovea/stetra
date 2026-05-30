//#region src/ir/relations/public-mapping.ts
function semanticRelationIRToPublic(relation) {
	return {
		id: relation.id,
		directive_id: relation.directiveId,
		observation_id: relation.observationId,
		relation: publicRelationKind(relation.adjudication.finalRelation),
		confidence: relation.confidence,
		basis: publicBasis(relation),
		reason: relation.adjudication.reason,
		proposed_by: relation.proposedBy,
		adjudication_status: relation.adjudication.status,
		final_relation: publicRelationKind(relation.adjudication.finalRelation),
		signals: relation.signals.map((signal) => ({
			kind: signal.kind,
			strength: signal.strength,
			direction: signal.direction,
			reason: signal.reason
		})),
		evidence_refs: relation.evidenceRefs,
		reasoning_summary: relation.reasoningSummary,
		adjudication_reason: relation.adjudication.reason,
		...relation.conflictClass ? { conflict_class: relation.conflictClass } : {},
		...relation.impact ? { impact: relation.impact } : {},
		...relation.reviewPriority ? { review_priority: relation.reviewPriority } : {},
		...relation.executionIntent ? { execution_intent: relation.executionIntent } : {},
		...relation.mergeIntent ? { merge_intent: relation.mergeIntent } : {},
		...relation.groupId ? { group_id: relation.groupId } : {}
	};
}
function semanticRelationsIRToPublic(relations) {
	return relations.map(semanticRelationIRToPublic);
}
function publicRelationKind(relation) {
	switch (relation) {
		case "reinforce":
		case "tension":
		case "ambient-only": return relation;
		case "suppress": return "anti-pattern-suppress";
		case "unrelated": return "none";
	}
}
function publicBasis(relation) {
	const basis = [];
	if (relation.basis.scope) basis.push("scope");
	if (relation.basis.evidence) basis.push("verification");
	if (relation.basis.category || relation.basis.semanticKey) basis.push("category");
	if (relation.basis.hostReasoning || relation.basis.feedback) basis.push("context");
	return basis.length ? basis : ["context"];
}
//#endregion
export { semanticRelationIRToPublic, semanticRelationsIRToPublic };
