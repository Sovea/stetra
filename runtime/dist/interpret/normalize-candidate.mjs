import { COMPATIBILITY_REQUIREMENTS, INTERFACE_SENSITIVITIES, MIGRATION_PHASES, OPERATIONS, OPTIMIZATION_TARGETS, PROJECT_STAGES, REFACTOR_TOLERANCES, REVIEW_GOALS, RISK_LEVELS, SCOPE_SIZES, TASK_KINDS } from "../intent/schema.mjs";
import { inferTargetLayer } from "../intent/parse-intent.mjs";
import { DeterministicInterpretationProvider } from "./deterministic-extractor.mjs";
//#region src/interpret/normalize-candidate.ts
const deterministicProvider = new DeterministicInterpretationProvider();
const MIN_ASSISTIVE_CONTEXT_CONFIDENCE = .5;
function resolveTask(input) {
	const deterministicCandidate = deterministicProvider.interpret(input.task);
	const candidates = [...(input.taskModels ?? []).map(taskModelToCandidate), deterministicCandidate];
	const conflicts = [];
	const discardedInputs = [];
	const taskKindResolution = resolveField({
		field: "intent.task_kind",
		explicitValue: input.taskKind ?? input.task.taskKind,
		candidates: candidates.map((candidate) => candidate.intent.task_kind),
		fallbackValue: deterministicCandidate.intent.task_kind?.value ?? "code",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.task_kind?.confidence ?? .85,
		allowedValues: TASK_KINDS,
		conflicts,
		discardedInputs
	});
	const operationResolution = resolveField({
		field: "intent.operation",
		explicitValue: input.task.operation,
		candidates: candidates.map((candidate) => candidate.intent.operation),
		fallbackValue: deterministicCandidate.intent.operation?.value ?? "modify",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.operation?.confidence ?? .5,
		allowedValues: OPERATIONS,
		conflicts,
		discardedInputs
	});
	const targetFileResolution = resolveField({
		field: "intent.target_file",
		explicitValue: input.task.targetFile,
		candidates: candidates.map((candidate) => candidate.intent.target_file),
		fallbackValue: deterministicCandidate.intent.target_file?.value,
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.target_file?.confidence ?? .65,
		conflicts,
		discardedInputs
	});
	const changedFilesResolution = resolveListField({
		field: "intent.changed_files",
		explicitValues: input.task.changedFiles,
		candidates: candidates.map((candidate) => candidate.intent.changed_files),
		fallbackValues: deterministicCandidate.intent.changed_files?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.changed_files?.confidence ?? .2,
		conflicts
	});
	const techStackResolution = resolveListField({
		field: "intent.tech_stack",
		explicitValues: input.task.techStack,
		candidates: candidates.map((candidate) => candidate.intent.tech_stack),
		fallbackValues: deterministicCandidate.intent.tech_stack?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.tech_stack?.confidence ?? .3,
		conflicts
	});
	const tagsResolution = resolveListField({
		field: "intent.tags",
		explicitValues: input.task.tags,
		candidates: candidates.map((candidate) => candidate.intent.tags),
		fallbackValues: deterministicCandidate.intent.tags?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.intent.tags?.confidence ?? .3,
		conflicts
	});
	const projectStageResolution = resolveField({
		field: "context.project_stage",
		explicitValue: input.task.projectStage,
		candidates: candidates.map((candidate) => candidate.context.project_stage),
		fallbackValue: deterministicCandidate.context.project_stage?.value,
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.project_stage?.confidence ?? .5,
		allowedValues: PROJECT_STAGES,
		conflicts,
		discardedInputs
	});
	const optimizationTargetResolution = resolveField({
		field: "context.optimization_target",
		explicitValue: input.task.optimizationTarget,
		candidates: candidates.map((candidate) => candidate.context.optimization_target),
		fallbackValue: deterministicCandidate.context.optimization_target?.value,
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.optimization_target?.confidence ?? .55,
		allowedValues: OPTIMIZATION_TARGETS,
		conflicts,
		discardedInputs
	});
	const hardConstraintsResolution = resolveListField({
		field: "context.hard_constraints",
		explicitValues: input.task.hardConstraints,
		candidates: candidates.map((candidate) => candidate.context.hard_constraints),
		fallbackValues: deterministicCandidate.context.hard_constraints?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.hard_constraints?.confidence ?? .2,
		conflicts
	});
	const allowedTradeoffsResolution = resolveListField({
		field: "context.allowed_tradeoffs",
		explicitValues: input.task.allowedTradeoffs,
		candidates: candidates.map((candidate) => candidate.context.allowed_tradeoffs),
		fallbackValues: deterministicCandidate.context.allowed_tradeoffs?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.allowed_tradeoffs?.confidence ?? .2,
		conflicts
	});
	const avoidResolution = resolveListField({
		field: "context.avoid",
		explicitValues: input.task.avoid,
		candidates: candidates.map((candidate) => candidate.context.avoid),
		fallbackValues: deterministicCandidate.context.avoid?.values ?? [],
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.avoid?.confidence ?? .2,
		conflicts
	});
	const riskLevelResolution = resolveField({
		field: "context.risk_level",
		explicitValue: input.task.riskLevel,
		candidates: candidates.map((candidate) => candidate.context.risk_level),
		fallbackValue: deterministicCandidate.context.risk_level?.value ?? "medium",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.risk_level?.confidence ?? .65,
		allowedValues: RISK_LEVELS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const scopeSizeResolution = resolveField({
		field: "context.scope_size",
		explicitValue: input.task.scopeSize,
		candidates: candidates.map((candidate) => candidate.context.scope_size),
		fallbackValue: deterministicCandidate.context.scope_size?.value ?? "unknown",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.scope_size?.confidence ?? .35,
		allowedValues: SCOPE_SIZES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const compatibilityRequirementResolution = resolveField({
		field: "context.compatibility_requirement",
		explicitValue: input.task.compatibilityRequirement,
		candidates: candidates.map((candidate) => candidate.context.compatibility_requirement),
		fallbackValue: deterministicCandidate.context.compatibility_requirement?.value ?? "none",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.compatibility_requirement?.confidence ?? .5,
		allowedValues: COMPATIBILITY_REQUIREMENTS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const interfaceSensitivityResolution = resolveField({
		field: "context.interface_sensitivity",
		explicitValue: input.task.interfaceSensitivity,
		candidates: candidates.map((candidate) => candidate.context.interface_sensitivity),
		fallbackValue: deterministicCandidate.context.interface_sensitivity?.value ?? "unknown",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.interface_sensitivity?.confidence ?? .35,
		allowedValues: INTERFACE_SENSITIVITIES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const refactorToleranceResolution = resolveField({
		field: "context.refactor_tolerance",
		explicitValue: input.task.refactorTolerance,
		candidates: candidates.map((candidate) => candidate.context.refactor_tolerance),
		fallbackValue: deterministicCandidate.context.refactor_tolerance?.value ?? "local-only",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.refactor_tolerance?.confidence ?? .65,
		allowedValues: REFACTOR_TOLERANCES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const migrationPhaseResolution = resolveField({
		field: "context.migration_phase",
		explicitValue: input.task.migrationPhase,
		candidates: candidates.map((candidate) => candidate.context.migration_phase),
		fallbackValue: deterministicCandidate.context.migration_phase?.value ?? "none",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.migration_phase?.confidence ?? .45,
		allowedValues: MIGRATION_PHASES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const reviewGoalResolution = resolveField({
		field: "context.review_goal",
		explicitValue: input.task.reviewGoal,
		candidates: candidates.map((candidate) => candidate.context.review_goal),
		fallbackValue: deterministicCandidate.context.review_goal?.value ?? "maintainability",
		defaultSource: "deterministic",
		defaultConfidence: deterministicCandidate.context.review_goal?.confidence ?? .65,
		allowedValues: REVIEW_GOALS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE,
		conflicts,
		discardedInputs
	});
	const task = {
		description: input.task.description,
		taskKind: taskKindResolution.value,
		operation: operationResolution.value,
		targetFile: targetFileResolution.value,
		changedFiles: changedFilesResolution.values,
		techStack: techStackResolution.values,
		tags: tagsResolution.values,
		projectStage: projectStageResolution.value,
		optimizationTarget: optimizationTargetResolution.value,
		hardConstraints: hardConstraintsResolution.values,
		allowedTradeoffs: allowedTradeoffsResolution.values,
		avoid: avoidResolution.values,
		riskLevel: riskLevelResolution.value,
		scopeSize: scopeSizeResolution.value,
		compatibilityRequirement: compatibilityRequirementResolution.value,
		interfaceSensitivity: interfaceSensitivityResolution.value,
		refactorTolerance: refactorToleranceResolution.value,
		migrationPhase: migrationPhaseResolution.value,
		reviewGoal: reviewGoalResolution.value
	};
	const resolvedTargetFile = targetFileResolution.value;
	const intent = {
		task_kind: taskKindResolution.value,
		operation: operationResolution.value,
		target_layer: inferTargetLayer(resolvedTargetFile),
		tech_stack: unique(techStackResolution.values),
		target_file: resolvedTargetFile,
		changed_files: unique(changedFilesResolution.values),
		tags: unique(tagsResolution.values)
	};
	const contextProfile = {
		project_stage: projectStageResolution.value,
		change_type: operationResolution.value,
		optimization_target: optimizationTargetResolution.value,
		hard_constraints: unique(hardConstraintsResolution.values),
		allowed_tradeoffs: unique(allowedTradeoffsResolution.values),
		avoid: unique(avoidResolution.values),
		risk_level: riskLevelResolution.value,
		scope_size: scopeSizeResolution.value,
		compatibility_requirement: compatibilityRequirementResolution.value,
		interface_sensitivity: interfaceSensitivityResolution.value,
		refactor_tolerance: refactorToleranceResolution.value,
		migration_phase: migrationPhaseResolution.value,
		review_goal: reviewGoalResolution.value
	};
	const provenance = buildProvenance(input, {
		task_kind: taskKindResolution,
		operation: operationResolution,
		target_file: targetFileResolution,
		changed_files: changedFilesResolution,
		tech_stack: techStackResolution,
		tags: tagsResolution,
		project_stage: projectStageResolution,
		optimization_target: optimizationTargetResolution,
		hard_constraints: hardConstraintsResolution,
		allowed_tradeoffs: allowedTradeoffsResolution,
		avoid: avoidResolution,
		risk_level: riskLevelResolution,
		scope_size: scopeSizeResolution,
		compatibility_requirement: compatibilityRequirementResolution,
		interface_sensitivity: interfaceSensitivityResolution,
		refactor_tolerance: refactorToleranceResolution,
		migration_phase: migrationPhaseResolution,
		review_goal: reviewGoalResolution
	}, conflicts);
	const trace = buildTrace(input, candidates, provenance, conflicts);
	const diagnostics = buildDiagnostics(input, candidates, provenance, conflicts, discardedInputs);
	return {
		task,
		taskKind: taskKindResolution.value,
		task_models: input.taskModels ?? [],
		task_intent: intent,
		context_profile: contextProfile,
		input_provenance: provenance,
		diagnostics,
		trace
	};
}
const resolveTaskInput = resolveTask;
function resolveField({ field, explicitValue, candidates, fallbackValue, defaultSource, defaultConfidence, allowedValues, minimumCandidateConfidence = 0, conflicts, discardedInputs }) {
	const resolvedCandidates = candidates.filter((candidate) => {
		if (candidate === void 0 || candidate.status !== "resolved") return false;
		if (candidate.value === void 0) {
			recordDiscarded(discardedInputs, field, "", candidate.source, "missing-value", fallbackValue);
			return false;
		}
		if (candidate.confidence < minimumCandidateConfidence) {
			recordDiscarded(discardedInputs, field, candidate.value, candidate.source, "below-confidence-threshold", fallbackValue);
			return false;
		}
		if (allowedValues && !allowedValues.includes(candidate.value)) {
			recordDiscarded(discardedInputs, field, candidate.value, candidate.source, "invalid-enum", fallbackValue);
			return false;
		}
		return true;
	});
	if (explicitValue !== void 0) if (allowedValues && !allowedValues.includes(explicitValue)) recordDiscarded(discardedInputs, field, explicitValue, "explicit", "invalid-enum", fallbackValue);
	else {
		registerConflict(field, "explicit", resolvedCandidates.map((candidate) => candidate.source), conflicts, "explicit task input takes precedence");
		return {
			value: explicitValue,
			source: "explicit",
			confidence: 1,
			status: "resolved"
		};
	}
	if (resolvedCandidates.length > 0) {
		const ordered = resolvedCandidates.slice().sort(compareCandidateField);
		const winner = ordered[0];
		registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, "field-level evidence/confidence policy selected the strongest candidate");
		return {
			value: winner.value,
			source: winner.source,
			confidence: winner.confidence,
			status: "resolved"
		};
	}
	return {
		value: fallbackValue,
		source: defaultSource,
		confidence: defaultConfidence,
		status: "resolved"
	};
}
function resolveListField({ field, explicitValues, candidates, fallbackValues, defaultSource, defaultConfidence, conflicts }) {
	if (explicitValues?.length) {
		registerConflict(field, "explicit", candidates.filter(Boolean).map((candidate) => candidate?.source ?? "deterministic"), conflicts, "explicit task input takes precedence");
		return {
			values: unique(explicitValues),
			source: "explicit",
			confidence: 1,
			status: "resolved"
		};
	}
	const resolvedCandidates = candidates.filter((candidate) => candidate !== void 0 && candidate.status === "resolved" && candidate.values.length > 0);
	if (resolvedCandidates.length > 0) {
		const ordered = resolvedCandidates.slice().sort(compareCandidateListField);
		const winner = ordered[0];
		registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, "field-level evidence/confidence policy selected the strongest candidate");
		return {
			values: unique(winner.values),
			source: winner.source,
			confidence: winner.confidence,
			status: "resolved"
		};
	}
	const fallback = unique(fallbackValues);
	return {
		values: fallback,
		source: defaultSource,
		confidence: defaultConfidence,
		status: fallback.length ? "resolved" : "unresolved"
	};
}
function buildProvenance(input, resolved, conflicts) {
	const resolved_fields = [
		summarizeScalarField("intent.task_kind", resolved.task_kind),
		summarizeScalarField("intent.operation", resolved.operation),
		summarizeScalarField("intent.target_file", resolved.target_file),
		summarizeListField("intent.changed_files", resolved.changed_files),
		summarizeListField("intent.tech_stack", resolved.tech_stack),
		summarizeListField("intent.tags", resolved.tags),
		summarizeScalarField("context.project_stage", resolved.project_stage),
		summarizeScalarField("context.optimization_target", resolved.optimization_target),
		summarizeListField("context.hard_constraints", resolved.hard_constraints),
		summarizeListField("context.allowed_tradeoffs", resolved.allowed_tradeoffs),
		summarizeListField("context.avoid", resolved.avoid),
		summarizeScalarField("context.risk_level", resolved.risk_level),
		summarizeScalarField("context.scope_size", resolved.scope_size),
		summarizeScalarField("context.compatibility_requirement", resolved.compatibility_requirement),
		summarizeScalarField("context.interface_sensitivity", resolved.interface_sensitivity),
		summarizeScalarField("context.refactor_tolerance", resolved.refactor_tolerance),
		summarizeScalarField("context.migration_phase", resolved.migration_phase),
		summarizeScalarField("context.review_goal", resolved.review_goal)
	].filter((item) => Boolean(item));
	return {
		resolved_fields,
		unresolved_fields: [...resolved.target_file.value ? [] : ["intent.target_file"], ...resolved.project_stage.value ? [] : ["context.project_stage"]],
		context_resolution: buildContextResolution(resolved, conflicts),
		interpretation_mode: input.interpretationMode ?? (input.taskModels?.length ? "host-agent" : "deterministic-only"),
		resolution_quality: determineResolutionQuality(resolved_fields)
	};
}
function buildTrace(input, candidates, provenance, conflicts) {
	const candidate_summaries = candidates.map((candidate) => summarizeCandidate(candidate));
	return {
		mode: provenance.interpretation_mode,
		candidate_summaries,
		conflicts,
		selected_sources: provenance.resolved_fields.map((field) => ({
			field: field.field,
			source: field.source,
			confidence: field.confidence
		}))
	};
}
function buildContextResolution(resolved, conflicts) {
	return [
		contextScalar("context.project_stage", resolved.project_stage, conflicts),
		contextScalar("context.optimization_target", resolved.optimization_target, conflicts),
		contextList("context.hard_constraints", resolved.hard_constraints, conflicts),
		contextList("context.allowed_tradeoffs", resolved.allowed_tradeoffs, conflicts),
		contextList("context.avoid", resolved.avoid, conflicts),
		contextScalar("context.risk_level", resolved.risk_level, conflicts),
		contextScalar("context.scope_size", resolved.scope_size, conflicts),
		contextScalar("context.compatibility_requirement", resolved.compatibility_requirement, conflicts),
		contextScalar("context.interface_sensitivity", resolved.interface_sensitivity, conflicts),
		contextScalar("context.refactor_tolerance", resolved.refactor_tolerance, conflicts),
		contextScalar("context.migration_phase", resolved.migration_phase, conflicts),
		contextScalar("context.review_goal", resolved.review_goal, conflicts)
	];
}
function contextScalar(field, resolved, conflicts) {
	const value = resolved.value === void 0 ? "" : String(resolved.value);
	return {
		field,
		value,
		source: resolved.source,
		confidence: resolved.confidence,
		status: contextResolutionStatus(field, resolved.source, resolved.value === void 0, conflicts),
		influence: contextInfluenceHints(field, value)
	};
}
function contextList(field, resolved, conflicts) {
	return {
		field,
		value: resolved.values,
		source: resolved.source,
		confidence: resolved.confidence,
		status: contextResolutionStatus(field, resolved.source, resolved.values.length === 0, conflicts),
		influence: contextInfluenceHints(field, resolved.values.join(","))
	};
}
function contextResolutionStatus(field, source, unresolved, conflicts) {
	if (conflicts.some((conflict) => conflict.field === field)) return "conflicted";
	if (unresolved) return "unresolved";
	return source === "deterministic" || source === "repo-default" ? "defaulted" : "resolved";
}
function contextInfluenceHints(field, value) {
	switch (field) {
		case "context.risk_level": return value === "high" || value === "critical" ? ["review-focus-priority", "must-guidance-preservation"] : [];
		case "context.scope_size": return value === "single-file" ? ["broad-guidance-ambient"] : [];
		case "context.compatibility_requirement": return value && value !== "none" && value !== "breaking-allowed" ? ["compatibility-tension"] : [];
		case "context.interface_sensitivity": return value && value !== "internal" && value !== "unknown" ? ["review-focus-priority"] : [];
		case "context.refactor_tolerance": return value === "none" || value === "local-only" ? ["broad-guidance-ambient"] : [];
		case "context.migration_phase": return value === "dual-run" || value === "cutover" ? ["migration-tension"] : [];
		case "context.review_goal": return value === "security" || value === "regression-risk" ? ["review-focus-priority"] : [];
		default: return [];
	}
}
function buildDiagnostics(input, candidates, provenance, conflicts, discardedInputs) {
	const ambiguity_reasons = [
		...candidates.flatMap((candidate) => candidate.uncertainties ?? []),
		...provenance.unresolved_fields.map((item) => `${item} unresolved`),
		...conflicts.map((conflict) => `conflicting candidates for ${conflict.field}`)
	];
	const discarded = uniqueDiscardedInputs(discardedInputs);
	return {
		warnings: [...ambiguity_reasons.map((item) => `interpretation warning: ${item}`), ...discarded.map((item) => `interpretation discarded ${item.source} ${item.field}=${item.value || "(empty)"}: ${item.reason}`)],
		fallback_usage: {
			used_deterministic_interpretation: provenance.resolved_fields.some((field) => field.source === "deterministic"),
			used_candidate_normalization: Boolean(input.taskModels?.length)
		},
		clarification_recommended: ambiguity_reasons.length > 0 && (!input.taskModels?.length || conflicts.length > 0),
		ambiguity_reasons,
		discarded_inputs: discarded
	};
}
function recordDiscarded(discardedInputs, field, value, source, reason, fallbackValue) {
	if (source === "deterministic") return;
	discardedInputs.push({
		field,
		value: value === void 0 ? "" : String(value),
		source,
		reason,
		action: "discarded",
		...fallbackValue === void 0 ? {} : { fallback: String(fallbackValue) }
	});
}
function uniqueDiscardedInputs(items) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const item of items) {
		const key = `${item.field}:${item.value}:${item.source}:${item.reason}:${item.fallback ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}
	return result;
}
function summarizeCandidate(candidate) {
	const scalarFields = [
		["intent.task_kind", candidate.intent.task_kind],
		["intent.operation", candidate.intent.operation],
		["intent.target_layer", candidate.intent.target_layer],
		["intent.target_file", candidate.intent.target_file],
		["context.project_stage", candidate.context.project_stage],
		["context.change_type", candidate.context.change_type],
		["context.optimization_target", candidate.context.optimization_target],
		["context.risk_level", candidate.context.risk_level],
		["context.scope_size", candidate.context.scope_size],
		["context.compatibility_requirement", candidate.context.compatibility_requirement],
		["context.interface_sensitivity", candidate.context.interface_sensitivity],
		["context.refactor_tolerance", candidate.context.refactor_tolerance],
		["context.migration_phase", candidate.context.migration_phase],
		["context.review_goal", candidate.context.review_goal]
	];
	const listFields = [
		["intent.tech_stack", candidate.intent.tech_stack],
		["intent.changed_files", candidate.intent.changed_files],
		["intent.tags", candidate.intent.tags],
		["context.hard_constraints", candidate.context.hard_constraints],
		["context.allowed_tradeoffs", candidate.context.allowed_tradeoffs],
		["context.avoid", candidate.context.avoid]
	];
	const resolved_fields = [...scalarFields.filter(([, field]) => field?.status === "resolved").map(([name]) => name), ...listFields.filter(([, field]) => field?.status === "resolved" && field.values.length > 0).map(([name]) => name)];
	const unresolved_fields = [...scalarFields.filter(([, field]) => !field || field.status !== "resolved").map(([name]) => name), ...listFields.filter(([, field]) => !field || field.status !== "resolved" || field.values.length === 0).map(([name]) => name)];
	const source = candidate.intent.task_kind?.source ?? candidate.intent.operation?.source ?? candidate.intent.target_file?.source ?? candidate.context.optimization_target?.source ?? "deterministic";
	const confidenceValues = [
		candidate.intent.task_kind?.confidence,
		candidate.intent.operation?.confidence,
		candidate.intent.target_layer?.confidence,
		candidate.intent.target_file?.confidence,
		candidate.intent.tech_stack?.confidence,
		candidate.intent.changed_files?.confidence,
		candidate.intent.tags?.confidence,
		candidate.context.project_stage?.confidence,
		candidate.context.change_type?.confidence,
		candidate.context.optimization_target?.confidence,
		candidate.context.hard_constraints?.confidence,
		candidate.context.allowed_tradeoffs?.confidence,
		candidate.context.avoid?.confidence,
		candidate.context.risk_level?.confidence,
		candidate.context.scope_size?.confidence,
		candidate.context.compatibility_requirement?.confidence,
		candidate.context.interface_sensitivity?.confidence,
		candidate.context.refactor_tolerance?.confidence,
		candidate.context.migration_phase?.confidence,
		candidate.context.review_goal?.confidence
	].filter((value) => typeof value === "number");
	return {
		source,
		confidence: confidenceValues.length ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2)) : 0,
		resolved_fields,
		unresolved_fields
	};
}
function taskModelToCandidate(model) {
	return {
		intent: {
			task_kind: scalarField(model.intent.task_kind),
			operation: scalarField(model.intent.operation),
			target_layer: scalarField(model.intent.target_layer),
			target_file: scalarField(model.intent.target_file),
			changed_files: listField(model.intent.changed_files),
			tech_stack: listField(model.intent.tech_stack),
			tags: listField(model.intent.tags)
		},
		context: {
			project_stage: scalarField(model.context.project_stage),
			change_type: void 0,
			optimization_target: scalarField(model.context.optimization_target),
			hard_constraints: listField(model.context.hard_constraints),
			allowed_tradeoffs: listField(model.context.allowed_tradeoffs),
			avoid: listField(model.context.avoid),
			risk_level: scalarField(model.context.risk_level),
			scope_size: scalarField(model.context.scope_size),
			compatibility_requirement: scalarField(model.context.compatibility_requirement),
			interface_sensitivity: scalarField(model.context.interface_sensitivity),
			refactor_tolerance: scalarField(model.context.refactor_tolerance),
			migration_phase: scalarField(model.context.migration_phase),
			review_goal: scalarField(model.context.review_goal)
		},
		uncertainties: model.uncertainties
	};
}
function scalarField(field) {
	if (!field || field.value === void 0) return void 0;
	return {
		value: field.value,
		source: "host-agent",
		confidence: field.confidence,
		status: "resolved",
		rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(", ")}`
	};
}
function listField(field) {
	if (!field) return void 0;
	return {
		values: field.values,
		source: "host-agent",
		confidence: field.confidence,
		status: field.values.length ? "resolved" : "unresolved",
		rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(", ")}`
	};
}
function compareCandidateField(left, right) {
	return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence;
}
function compareCandidateListField(left, right) {
	return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence || right.values.length - left.values.length;
}
function sourceRank(source) {
	switch (source) {
		case "explicit": return 5;
		case "host-agent":
		case "assistive-ai": return 4;
		case "derived": return 3;
		case "repo-default": return 2;
		case "deterministic": return 1;
	}
}
function summarizeScalarField(field, resolved) {
	if (resolved.value === void 0) return null;
	return {
		field,
		source: resolved.source,
		confidence: resolved.confidence
	};
}
function summarizeListField(field, resolved) {
	if (!resolved.values.length) return null;
	return {
		field,
		source: resolved.source,
		confidence: resolved.confidence
	};
}
function determineResolutionQuality(resolvedFields) {
	if (resolvedFields.every((field) => field.source === "explicit")) return "explicit";
	if (resolvedFields.some((field) => field.source === "host-agent" || field.source === "assistive-ai")) return "ai-assisted";
	if (resolvedFields.some((field) => field.source === "deterministic")) return "deterministic";
	return "degraded";
}
function registerConflict(field, winner, discarded, conflicts, rationale) {
	const uniqueDiscarded = [...new Set(discarded.filter((source) => source !== winner))];
	if (!uniqueDiscarded.length) return;
	conflicts.push({
		field,
		winner,
		discarded: uniqueDiscarded,
		rationale
	});
}
function unique(values) {
	return [...new Set((values ?? []).filter((value) => value !== void 0 && value !== null))];
}
//#endregion
export { resolveTask, resolveTaskInput };
