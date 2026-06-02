import { GOVERNANCE_IR_VERSION } from "../types.mjs";
import { stableHash } from "../../utils/hash.mjs";
//#region src/ir/adapters/task.ts
function taskToIR(resolved) {
	const intent = resolved.task_intent;
	const context = resolved.context_profile;
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"task-ir",
			resolved.task.description,
			intent,
			context
		]),
		kind: intent.task_kind,
		operation: intent.operation,
		targetLayer: intent.target_layer,
		targets: buildTargets(intent.target_file, intent.changed_files),
		techStack: intent.tech_stack,
		tags: intent.tags,
		context,
		provenance: buildProvenance(resolved),
		unresolved: resolved.input_provenance.unresolved_fields,
		diagnostics: {
			clarificationRecommended: resolved.diagnostics.clarification_recommended,
			ambiguityReasons: resolved.diagnostics.ambiguity_reasons
		}
	};
}
function buildTargets(targetFile, changedFiles) {
	const targets = [];
	if (targetFile) targets.push({
		path: targetFile,
		role: "target"
	});
	for (const path of changedFiles) if (path !== targetFile) targets.push({
		path,
		role: "changed"
	});
	return targets;
}
function buildProvenance(resolved) {
	return resolved.input_provenance.resolved_fields.map((field) => ({
		field: String(field.field ?? "unknown"),
		source: String(field.source ?? "unknown"),
		confidence: typeof field.confidence === "number" ? field.confidence : 0
	}));
}
//#endregion
export { taskToIR };
