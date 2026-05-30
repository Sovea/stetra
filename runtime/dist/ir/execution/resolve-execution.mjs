import { SEMANTIC_RELATION_POLICY } from "../relations/policy.mjs";
import { applyContextExecutionPolicy } from "./context-policy.mjs";
//#region src/ir/execution/resolve-execution.ts
function resolveExecutionDecisionsIR(bundle, relations) {
	const relationsByDirective = groupEffectiveRelations(relations);
	return bundle.directives.map((directive) => {
		const linkedRelations = relationsByDirective.get(directive.id) ?? [];
		const defaultDecision = deriveDirectiveDecision(directive, linkedRelations);
		const contextDecision = applyContextAdjustments(directive, linkedRelations, defaultDecision, bundle.task.context);
		const feedbackEffects = feedbackSignalsForDirective(bundle, directive, linkedRelations);
		const decision = applyFeedbackAdjustments(directive, contextDecision, feedbackEffects);
		return {
			directiveId: directive.id,
			mode: decision.mode,
			defaultMode: defaultDecision.mode,
			basis: decision.basis,
			relationIds: linkedRelations.map((relation) => relation.id),
			contextApplied: decision.contextApplied,
			contextRulesApplied: decision.contextRulesApplied,
			feedbackApplied: feedbackEffects.labels,
			reason: decision.reason
		};
	});
}
function groupEffectiveRelations(relations) {
	const grouped = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		if (relation.adjudication.status === "rejected") continue;
		if (relation.adjudication.finalRelation === "unrelated") continue;
		const current = grouped.get(relation.directiveId) ?? [];
		current.push(relation);
		grouped.set(relation.directiveId, current);
	}
	return grouped;
}
function deriveDirectiveDecision(directive, relations) {
	if (directive.kind === "anti-pattern") return {
		mode: "suppress",
		reason: "directive is classified as an anti-pattern and should suppress matching behavior",
		basis: "anti-pattern",
		contextApplied: [],
		contextRulesApplied: []
	};
	if (directive.traits.rcclImmune) return {
		mode: "enforce",
		reason: "directive is marked rccl_immune and should not be downgraded by repository observations",
		basis: "verification",
		contextApplied: [],
		contextRulesApplied: []
	};
	const hasTension = relations.some((relation) => relation.adjudication.finalRelation === "tension");
	if (relations.some((relation) => relation.adjudication.finalRelation === "suppress")) return {
		mode: "suppress",
		reason: "anti-pattern observations materially overlap this directive and should suppress matching behavior",
		basis: "anti-pattern",
		contextApplied: [],
		contextRulesApplied: []
	};
	const graphIntentDecision = resolveGraphExecutionIntent(directive, relations);
	if (graphIntentDecision) return graphIntentDecision;
	if (!hasTension) return {
		mode: directive.prescription === "must" ? "enforce" : "ambient",
		reason: "no strong repository tension matched this directive, so default execution behavior applies",
		basis: "prescription",
		contextApplied: [],
		contextRulesApplied: []
	};
	return {
		mode: directive.prescription === "must" ? "deviation-noted" : "ambient",
		reason: "repository observations materially overlap this directive, so execution is adjusted to reflect current repository reality",
		basis: "governance-graph",
		contextApplied: [],
		contextRulesApplied: []
	};
}
function resolveGraphExecutionIntent(directive, relations) {
	const candidates = relations.filter((relation) => relation.adjudication.status === "accepted" && relation.impact === "execution-mode" && relation.executionIntent != null && relation.executionIntent !== "no-change").sort((left, right) => executionIntentRank(right.executionIntent) - executionIntentRank(left.executionIntent));
	for (const selected of candidates) {
		const decision = resolveGraphExecutionIntentCandidate(directive, selected, relations);
		if (decision) return decision;
	}
	return null;
}
function resolveGraphExecutionIntentCandidate(directive, selected, relations) {
	if (!selected.executionIntent) return null;
	if (selected.executionIntent === "suppress") {
		if (selected.adjudication.finalRelation !== "suppress") return null;
		return {
			mode: "suppress",
			reason: `semantic governance graph requested suppress execution for ${directive.id}, and Runtime accepted a suppress relation`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:suppress"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "deviation-noted") {
		if (selected.adjudication.finalRelation !== "tension") return null;
		return {
			mode: "deviation-noted",
			reason: `semantic governance graph requested deviation-noted execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:deviation-noted"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "ambient") {
		if (selected.adjudication.finalRelation !== "ambient-only" && selected.adjudication.finalRelation !== "tension") return null;
		if (directive.prescription === "must" || directive.weight === "critical") {
			if (selected.adjudication.finalRelation !== "tension") return null;
			return {
				mode: "deviation-noted",
				reason: `semantic governance graph requested ambient execution for must-or-critical ${directive.id}; Runtime floors accepted tension to deviation-noted instead of silently weakening protected guidance`,
				basis: "governance-graph",
				contextApplied: ["execution_intent:ambient", "execution_intent_floor:must-deviation-noted"],
				contextRulesApplied: []
			};
		}
		return {
			mode: "ambient",
			reason: `semantic governance graph requested ambient execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:ambient"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "enforce") {
		if (selected.adjudication.finalRelation !== "reinforce") return null;
		if (relations.some((relation) => relation.adjudication.finalRelation === "tension" || relation.adjudication.finalRelation === "suppress")) return null;
		return {
			mode: "enforce",
			reason: `semantic governance graph requested enforce execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:enforce"],
			contextRulesApplied: []
		};
	}
	return null;
}
function executionIntentRank(intent) {
	switch (intent) {
		case "suppress": return 5;
		case "deviation-noted": return 4;
		case "enforce": return 3;
		case "ambient": return 2;
		case "no-change": return 1;
		default: return 0;
	}
}
function applyContextAdjustments(directive, relations, defaultDecision, context) {
	return applyContextExecutionPolicy({
		directive,
		relations,
		defaultDecision,
		context
	});
}
function applyFeedbackAdjustments(directive, decision, effects) {
	let result = {
		...decision,
		contextApplied: [...decision.contextApplied],
		contextRulesApplied: [...decision.contextRulesApplied]
	};
	if (effects.recurringTension && directive.prescription === "must") result = {
		...result,
		mode: result.mode === "suppress" ? result.mode : "deviation-noted",
		basis: "feedback",
		reason: `${result.reason} Recurring lockfile tension keeps this must-level directive reviewable as deviation-noted instead of silently treating the repository reality as unrelated.`
	};
	if (effects.frequentlyIgnored && directive.prescription === "should") result = {
		...result,
		mode: "ambient",
		basis: "feedback",
		reason: `${result.reason} Lockfile feedback shows this should-level directive is frequently ignored, so it remains ambient unless stronger verified relations require attention.`
	};
	if (effects.frequentlyIgnoredMust) result = {
		...result,
		basis: result.basis === "prescription" ? "feedback" : result.basis,
		reason: `${result.reason} Lockfile feedback shows a must-level directive was frequently ignored; execution is not weakened, but review focus should verify the outcome.`
	};
	if (effects.noisyObservation) result = {
		...result,
		reason: `${result.reason} Feedback marks one linked observation as noisy, so Runtime keeps the relation reviewable and still relies on RCCL verification before changing execution.`
	};
	return result;
}
function feedbackSignalsForDirective(bundle, directive, relations) {
	const labels = [];
	const directiveSignal = bundle.feedback.directiveSignals.find((signal) => signal.directiveId === directive.id);
	const frequentlyIgnored = directiveSignal !== void 0 && directiveSignal.ignored >= SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredMinIgnored && directiveSignal.followRate < SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredFollowRate;
	const recurringTension = relations.some((relation) => relation.basis.feedback && relation.adjudication.status !== "rejected" && relation.adjudication.finalRelation === "tension");
	const noisyObservation = relations.some((relation) => {
		const signal = bundle.feedback.observationSignals.find((item) => item.observationId === relation.observationId);
		return signal !== void 0 && signal.relationCount >= SEMANTIC_RELATION_POLICY.feedback.noisyObservationRelationCount && signal.lastDisposition === "demote-to-ambient";
	});
	if (frequentlyIgnored) labels.push("feedback:frequently-ignored");
	if (frequentlyIgnored && directive.prescription === "must") labels.push("feedback:frequently-ignored-must-review");
	if (directiveSignal?.trend === "degrading") labels.push("feedback:degrading");
	if (directiveSignal?.signalConfidence === "user-corrected") labels.push("feedback:user-corrected");
	if (recurringTension) labels.push("feedback:recurring-tension");
	if (noisyObservation) labels.push("feedback:noisy-observation");
	return {
		labels: unique(labels),
		frequentlyIgnored,
		frequentlyIgnoredMust: frequentlyIgnored && directive.prescription === "must",
		recurringTension,
		noisyObservation
	};
}
function unique(values) {
	return [...new Set(values)];
}
//#endregion
export { resolveExecutionDecisionsIR };
