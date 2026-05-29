//#region src/contract-policy.ts
function resolveContractPolicy(input) {
	const provided = input.providedContracts ?? {};
	const required = [];
	const optional = [];
	const skipped = [];
	const proposed = new Set(input.planningProposal?.useful_contracts ?? []);
	if (!provided.guidancePlanning && !input.planningProposal) required.push("guidance-planning");
	else skipped.push({
		kind: "guidance-planning",
		reason_id: "already-provided"
	});
	if (!provided.taskInterpretation) required.push("task-interpretation");
	else skipped.push({
		kind: "task-interpretation",
		reason_id: "already-provided"
	});
	resolveSemanticContract("semantic-candidate", input.sourceStatus, proposed, provided.semanticCandidate, required, skipped);
	resolveSemanticContract("semantic-relation", input.sourceStatus, proposed, provided.semanticRelation, required, skipped);
	if (proposed.has("adherence-evaluation")) {
		const highSignal = input.planningProposal?.reasons.some((reason) => reason === "high-risk-or-sensitive-change" || reason === "user-requested-governance" || reason === "potential-context-tension") ?? false;
		if (provided.adherenceEvaluation) skipped.push({
			kind: "adherence-evaluation",
			reason_id: "already-provided"
		});
		else if (highSignal) required.push("adherence-evaluation");
		else {
			optional.push("adherence-evaluation");
			skipped.push({
				kind: "adherence-evaluation",
				reason_id: "deferred-until-after-compile"
			});
		}
	} else skipped.push({
		kind: "adherence-evaluation",
		reason_id: "not-proposed-by-host"
	});
	return {
		required: unique(required),
		optional: unique(optional),
		skipped,
		escalation: resolveEscalation(required)
	};
}
function resolveSemanticContract(kind, sourceStatus, proposed, provided, required, skipped) {
	if (provided) {
		skipped.push({
			kind,
			reason_id: "already-provided"
		});
		return;
	}
	if (!proposed.has(kind)) {
		skipped.push({
			kind,
			reason_id: "not-proposed-by-host"
		});
		return;
	}
	if (sourceStatus.rccl !== "present" && sourceStatus.rccl !== "stale" && sourceStatus.rccl !== "unverified") {
		skipped.push({
			kind,
			reason_id: "missing-rccl"
		});
		return;
	}
	required.push(kind);
}
function resolveEscalation(required) {
	if (required.includes("adherence-evaluation")) return "adherence-required";
	if (required.includes("semantic-relation")) return "semantic-relation";
	if (required.includes("semantic-candidate")) return "semantic-candidate";
	return "none";
}
function unique(values) {
	return [...new Set(values)];
}
//#endregion
export { resolveContractPolicy };
