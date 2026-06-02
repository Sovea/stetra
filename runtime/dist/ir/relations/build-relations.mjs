import { GOVERNANCE_IR_VERSION } from "../types.mjs";
import { stableHash } from "../../utils/hash.mjs";
import { adjudicateSemanticRelations } from "./adjudicate-relations.mjs";
import { proposeSemanticRelations } from "./propose-relations.mjs";
//#region src/ir/relations/build-relations.ts
function buildSemanticRelationsIR(bundle) {
	const proposals = proposeSemanticRelations(bundle);
	const agenticRelations = adjudicateSemanticRelations(mergeRelationProposals(proposals.filter(isAgenticRelationProposal)), bundle);
	const agenticPairs = effectiveRelationPairs(agenticRelations);
	const structuralFallbackRelations = adjudicateSemanticRelations(mergeRelationProposals(proposals.filter((relation) => relation.proposedBy === "runtime-structural" && !agenticPairs.has(relationPairKey(relation)))), bundle);
	return [...agenticRelations, ...structuralFallbackRelations].sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}
function mergeRelationProposals(relations) {
	const grouped = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		const key = `${relation.directiveId}::${relation.observationId}`;
		const current = grouped.get(key) ?? [];
		current.push(relation);
		grouped.set(key, current);
	}
	return [...grouped.values()].map(mergeRelationGroup).sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}
function mergeRelationGroup(group) {
	if (group.length === 1) return group[0];
	const relation = chooseMergedRelation(group);
	const directiveId = group[0].directiveId;
	const observationId = group[0].observationId;
	const signals = uniqueSignals(group.flatMap((item) => item.signals));
	const evidenceRefs = uniqueStrings(group.flatMap((item) => item.evidenceRefs));
	const proposedBy = group.some((item) => item.proposedBy !== group[0].proposedBy) ? "multi-source" : group[0].proposedBy;
	const impact = chooseImpact(group, relation);
	const reviewPriority = chooseReviewPriority(group);
	const executionIntent = chooseExecutionIntent(group);
	const mergeIntent = chooseMergeIntent(group);
	const groupId = chooseGroupId(group);
	const conflictClass = chooseConflictClass(group, relation);
	const confidence = Number(Math.max(...group.map((item) => item.confidence)).toFixed(2));
	const basis = {
		scope: group.some((item) => item.basis.scope),
		semanticKey: group.some((item) => item.basis.semanticKey),
		category: group.some((item) => item.basis.category),
		evidence: group.some((item) => item.basis.evidence),
		hostReasoning: group.some((item) => item.basis.hostReasoning),
		feedback: group.some((item) => item.basis.feedback)
	};
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"semantic-relation-ir",
			"merged",
			directiveId,
			observationId,
			relation,
			proposedBy,
			signals,
			evidenceRefs,
			impact,
			reviewPriority,
			executionIntent,
			mergeIntent,
			groupId
		]),
		directiveId,
		observationId,
		proposedBy,
		relation,
		...conflictClass ? { conflictClass } : {},
		confidence,
		basis,
		signals,
		evidenceRefs,
		reasoningSummary: summarizeMergedReasoning(group, relation),
		...impact ? { impact } : {},
		...reviewPriority ? { reviewPriority } : {},
		...executionIntent ? { executionIntent } : {},
		...mergeIntent ? { mergeIntent } : {},
		...groupId ? { groupId } : {},
		adjudication: {
			status: "accepted",
			finalRelation: relation,
			reason: "merged semantic relation proposal before adjudication"
		}
	};
}
function chooseMergedRelation(group) {
	const relations = group.map((item) => item.relation);
	if (relations.includes("suppress")) return "suppress";
	if (relations.includes("tension")) return "tension";
	if (relations.includes("reinforce")) return "reinforce";
	if (relations.includes("ambient-only")) return "ambient-only";
	return "unrelated";
}
function chooseImpact(group, relation) {
	const explicit = group.find((item) => item.impact && item.relation === relation)?.impact ?? group.find((item) => item.impact)?.impact;
	if (explicit) return explicit;
	if (relation === "tension" || relation === "suppress") return "execution-mode";
	if (relation === "reinforce") return "review-focus";
	if (relation === "ambient-only") return "ambient-context";
	return "no-effect";
}
function chooseReviewPriority(group) {
	const order = {
		low: 0,
		normal: 1,
		high: 2,
		critical: 3
	};
	return group.map((item) => item.reviewPriority).filter((item) => Boolean(item)).sort((left, right) => order[right] - order[left])[0];
}
function isAgenticRelationProposal(relation) {
	return relation.proposedBy === "host-agent" || relation.proposedBy === "feedback";
}
function effectiveRelationPairs(relations) {
	return new Set(relations.filter((relation) => relation.adjudication.status !== "rejected" && relation.adjudication.finalRelation !== "unrelated").map(relationPairKey));
}
function relationPairKey(relation) {
	return `${relation.directiveId}::${relation.observationId}`;
}
function chooseExecutionIntent(group) {
	const order = {
		suppress: 5,
		"deviation-noted": 4,
		enforce: 3,
		ambient: 2,
		"no-change": 1
	};
	return group.map((item) => item.executionIntent).filter((item) => Boolean(item)).sort((left, right) => order[right] - order[left])[0];
}
function chooseMergeIntent(group) {
	return group.find((item) => item.mergeIntent)?.mergeIntent;
}
function chooseGroupId(group) {
	return group.find((item) => item.groupId)?.groupId;
}
function chooseConflictClass(group, relation) {
	return group.find((item) => item.relation === relation && item.conflictClass)?.conflictClass ?? group.find((item) => item.conflictClass)?.conflictClass;
}
function summarizeMergedReasoning(group, relation) {
	const sources = uniqueStrings(group.map((item) => item.proposedBy)).join(", ");
	const reasons = uniqueStrings(group.map((item) => item.reasoningSummary)).slice(0, 3).join(" | ");
	return `merged ${group.length} proposal(s) from ${sources}; selected ${relation}; ${reasons}`;
}
function uniqueSignals(signals) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const signal of signals) {
		const key = `${signal.kind}:${signal.strength}:${signal.direction}:${signal.reason}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(signal);
	}
	return result;
}
function uniqueStrings(values) {
	return [...new Set(values.filter(Boolean))];
}
//#endregion
export { buildSemanticRelationsIR };
