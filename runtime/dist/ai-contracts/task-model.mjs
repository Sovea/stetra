import { isRecord, validConfidence } from "../utils/common.mjs";
import { TASK_INTERPRETATION_ENUMS } from "../intent/schema.mjs";
import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
import { AI_CONTRACT_VERSION } from "./types.mjs";
import { contractVersionDiagnostic, validEvidenceRefs } from "./shared.mjs";
//#region src/ai-contracts/task-model.ts
const TASK_MODEL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		intent: { type: "object" },
		context: { type: "object" },
		uncertainties: {
			type: "array",
			items: { type: "string" }
		}
	},
	required: [
		"intent",
		"context",
		"uncertainties"
	]
};
function prepareTaskModelContract(input) {
	const prompt = buildTaskModelPrompt(input);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write a task-model JSON object or array to ${input.artifactPath}, then re-run with --task-model-file ${input.artifactPath}.`
	};
	return {
		task: input.task,
		taskModelPrompt: prompt,
		taskModelSchema: JSON.stringify(TASK_MODEL_SCHEMA, null, 2),
		ambiguityHints: buildAmbiguityHints(input.task),
		modelArtifact: artifact,
		clarificationHints: buildClarificationHints(input.task),
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "task-model",
			schemaId: "runtime.task-model",
			schemaVersion: "2.0",
			prompt,
			schema: TASK_MODEL_SCHEMA,
			artifact,
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: {
				task: input.task,
				schemaId: "runtime.task-model"
			}
		}
	};
}
function validateTaskModelPayload(raw) {
	const versionDiagnostic = contractVersionDiagnostic(raw, "task-model");
	if (versionDiagnostic) return {
		models: [],
		diagnostics: buildContractPayloadDiagnostics("task-model", [versionDiagnostic])
	};
	const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
	const entries = [];
	const models = [];
	values.forEach((value, index) => {
		const path = Array.isArray(raw) ? `models[${index}]` : "model";
		if (!isTaskModelProposal(value)) {
			entries.push({
				status: "rejected",
				reason: value == null ? "empty-payload" : "malformed-payload",
				path,
				message: "Task model must include intent, context, uncertainties, and evidence-backed fields."
			});
			return;
		}
		const fieldError = firstInvalidField(value);
		if (fieldError) {
			entries.push({
				status: "rejected",
				reason: fieldError.reason,
				path: `${path}.${fieldError.field}`,
				message: fieldError.message,
				confidence: fieldError.confidence
			});
			return;
		}
		models.push(value);
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: "Task model accepted for Runtime field-level adjudication."
		});
	});
	if (!values.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "model",
		message: "No task model payload was provided."
	});
	return {
		models,
		diagnostics: buildContractPayloadDiagnostics("task-model", entries)
	};
}
function isTaskModelProposal(value) {
	if (!isRecord(value)) return false;
	return isRecord(value.intent) && isRecord(value.context) && Array.isArray(value.uncertainties) && value.uncertainties.every((item) => typeof item === "string");
}
function firstInvalidField(model) {
	const fields = [
		[
			"intent.task_kind",
			model.intent.task_kind,
			TASK_INTERPRETATION_ENUMS.intent.task_kind,
			"scalar"
		],
		[
			"intent.operation",
			model.intent.operation,
			TASK_INTERPRETATION_ENUMS.intent.operation,
			"scalar"
		],
		[
			"intent.target_layer",
			model.intent.target_layer,
			null,
			"scalar"
		],
		[
			"intent.target_file",
			model.intent.target_file,
			null,
			"scalar"
		],
		[
			"intent.changed_files",
			model.intent.changed_files,
			null,
			"list"
		],
		[
			"intent.tech_stack",
			model.intent.tech_stack,
			null,
			"list"
		],
		[
			"intent.tags",
			model.intent.tags,
			null,
			"list"
		],
		[
			"context.project_stage",
			model.context.project_stage,
			TASK_INTERPRETATION_ENUMS.context.project_stage,
			"scalar"
		],
		[
			"context.optimization_target",
			model.context.optimization_target,
			TASK_INTERPRETATION_ENUMS.context.optimization_target,
			"scalar"
		],
		[
			"context.hard_constraints",
			model.context.hard_constraints,
			null,
			"list"
		],
		[
			"context.allowed_tradeoffs",
			model.context.allowed_tradeoffs,
			null,
			"list"
		],
		[
			"context.avoid",
			model.context.avoid,
			null,
			"list"
		],
		[
			"context.risk_level",
			model.context.risk_level,
			TASK_INTERPRETATION_ENUMS.context.risk_level,
			"scalar"
		],
		[
			"context.scope_size",
			model.context.scope_size,
			TASK_INTERPRETATION_ENUMS.context.scope_size,
			"scalar"
		],
		[
			"context.compatibility_requirement",
			model.context.compatibility_requirement,
			TASK_INTERPRETATION_ENUMS.context.compatibility_requirement,
			"scalar"
		],
		[
			"context.interface_sensitivity",
			model.context.interface_sensitivity,
			TASK_INTERPRETATION_ENUMS.context.interface_sensitivity,
			"scalar"
		],
		[
			"context.refactor_tolerance",
			model.context.refactor_tolerance,
			TASK_INTERPRETATION_ENUMS.context.refactor_tolerance,
			"scalar"
		],
		[
			"context.migration_phase",
			model.context.migration_phase,
			TASK_INTERPRETATION_ENUMS.context.migration_phase,
			"scalar"
		],
		[
			"context.review_goal",
			model.context.review_goal,
			TASK_INTERPRETATION_ENUMS.context.review_goal,
			"scalar"
		]
	];
	for (const [field, candidate, allowedValues, kind] of fields) {
		if (candidate === void 0) continue;
		if (!isRecord(candidate)) return {
			field,
			reason: "malformed-payload",
			message: "Task model field must be an object."
		};
		if (!validConfidence(candidate.confidence)) return {
			field,
			reason: "malformed-payload",
			message: "Task model field confidence must be between 0 and 1."
		};
		if (candidate.confidence < .5) return {
			field,
			reason: "low-confidence",
			message: "Task model field confidence is below threshold.",
			confidence: candidate.confidence
		};
		if (!validEvidenceRefs(candidate.evidence_refs)) return {
			field,
			reason: "missing-evidence",
			message: "Task model field must include at least one valid evidence_ref.",
			confidence: candidate.confidence
		};
		if (kind === "scalar") {
			if (typeof candidate.value !== "string") return {
				field,
				reason: "missing-required-field",
				message: "Task model scalar field must include value.",
				confidence: candidate.confidence
			};
			if (allowedValues && !allowedValues.includes(candidate.value)) return {
				field,
				reason: "unsupported-value",
				message: `Unsupported value "${candidate.value}".`,
				confidence: candidate.confidence
			};
		} else if (!Array.isArray(candidate.values) || !candidate.values.every((item) => typeof item === "string")) return {
			field,
			reason: "missing-required-field",
			message: "Task model list field must include string values.",
			confidence: candidate.confidence
		};
	}
	return null;
}
function buildTaskModelPrompt(input) {
	return [
		"Produce a task-model payload for Runtime.",
		"Resolve only fields supported by evidence from the user request, conversation, files, diff, commands, or repository context.",
		"Every resolved field must include confidence and at least one evidence_ref.",
		"Runtime will validate enums, evidence shape, confidence, and field-level precedence.",
		"Return JSON only.",
		"",
		`Task description: ${input.task.description}`,
		`Explicit operation: ${input.task.operation ?? "(none)"}`,
		`Explicit target file: ${input.task.targetFile ?? "(none)"}`,
		`Explicit changed files: ${input.task.changedFiles?.join(", ") || "(none)"}`,
		`Explicit tech stack: ${input.task.techStack?.join(", ") || "(none)"}`,
		`Allowed task enum values: ${JSON.stringify(TASK_INTERPRETATION_ENUMS)}`
	].join("\n");
}
function buildAmbiguityHints(task) {
	const hints = [];
	if (!task.operation) hints.push("operation is not explicit");
	if (!task.targetFile && !task.changedFiles?.length) hints.push("no concrete target files are specified");
	if (!task.techStack?.length) hints.push("tech stack is implicit");
	if (!task.projectStage) hints.push("project stage is not specified");
	return hints;
}
function buildClarificationHints(task) {
	return [
		...!task.operation ? ["Clarify whether this is create, modify, bugfix, refactor, or review work."] : [],
		...!task.targetFile && !task.changedFiles?.length ? ["Name the target or changed files when known."] : [],
		...!task.optimizationTarget ? ["Specify the optimization target when the tradeoff matters."] : []
	];
}
//#endregion
export { prepareTaskModelContract, validateTaskModelPayload };
