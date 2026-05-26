import { resolveTask } from "./interpret/normalize-candidate.mjs";
import { toResolvedCompileInput } from "./compile-input.mjs";
import { projectIRActivationToPublic } from "./ir/activation/public-adapter.mjs";
import { activatedDirectiveIdsIR, resolveActivationDecisionsIR } from "./ir/activation/resolve-activation.mjs";
import { loadCompileSources } from "./load/compile-sources.mjs";
import { stableHash } from "./utils/hash.mjs";
import { buildGovernanceIR } from "./ir/build-ir.mjs";
import { projectIREgoToPublic } from "./ir/ego/public-adapter.mjs";
import { resolveExecutionDecisionsIR } from "./ir/execution/resolve-execution.mjs";
import { buildSemanticRelationsIR } from "./ir/relations/build-relations.mjs";
import { projectIRSemanticMergeToPublic } from "./ir/semantic-merge/public-adapter.mjs";
import { readFileSync } from "node:fs";
//#region src/compile.ts
function buildInterpretationPacket(resolved) {
	return {
		candidates: resolved.candidates,
		input_provenance: resolved.input_provenance,
		diagnostics: resolved.diagnostics,
		trace: resolved.trace,
		resolved: {
			task_intent: resolved.task_intent,
			context_profile: resolved.context_profile
		}
	};
}
function buildGovernancePacket(activation, tensions, focus, semantic_merge, ego, trace) {
	return {
		activation,
		tensions,
		focus,
		semantic_merge,
		ego,
		trace
	};
}
function compileResolvedOutput(packet, resolvedTask) {
	return {
		packet,
		resolvedTask,
		ego: packet.governance.ego,
		trace: packet.governance.trace,
		cache: packet.cache
	};
}
/**
* Runs the deterministic playbook pipeline and produces a change decision packet.
*/
async function compile(input) {
	const normalizedInput = toResolvedCompileInput(input);
	const resolved = normalizedInput.resolvedTask;
	const traceSteps = [];
	const intent = resolved.task_intent;
	const contextProfile = resolved.context_profile;
	const hostFulfillment = normalizedInput.hostFulfillment;
	traceSteps.push({
		stage: "Intent Parse",
		lines: [
			`interpretation_mode: ${resolved.input_provenance.interpretation_mode}`,
			`resolved_fields: ${resolved.input_provenance.resolved_fields.length}`,
			`unresolved_fields: ${resolved.input_provenance.unresolved_fields.join(", ") || "(none)"}`,
			`operation: ${intent.operation}`,
			`target_layer: ${intent.target_layer}`,
			`tech_stack: ${intent.tech_stack.join(", ") || "(none)"}`,
			`target_file: ${intent.target_file ?? "(none)"}`,
			`optimization_target: ${contextProfile.optimization_target}`,
			`hard_constraints: ${contextProfile.hard_constraints.join(", ") || "(none)"}`,
			`allowed_tradeoffs: ${contextProfile.allowed_tradeoffs.join(", ") || "(none)"}`,
			`avoid: ${contextProfile.avoid.join(", ") || "(none)"}`,
			`project_stage: ${contextProfile.project_stage ?? "(none)"}`,
			`risk_level: ${contextProfile.risk_level}`,
			`scope_size: ${contextProfile.scope_size}`,
			`compatibility_requirement: ${contextProfile.compatibility_requirement}`,
			`interface_sensitivity: ${contextProfile.interface_sensitivity}`,
			`refactor_tolerance: ${contextProfile.refactor_tolerance}`,
			`migration_phase: ${contextProfile.migration_phase}`,
			`review_goal: ${contextProfile.review_goal}`
		]
	});
	traceSteps.push({
		stage: "Context Profile Resolution",
		lines: resolved.input_provenance.context_resolution.length ? resolved.input_provenance.context_resolution.map((item) => `${item.field}: ${formatContextValue(item.value)} source=${item.source} confidence=${item.confidence} status=${item.status} influence=${item.influence.join(", ") || "(none)"}`) : ["no context profile resolution records"]
	});
	const sources = normalizedInput.preloadedSources ?? await loadCompileSources(normalizedInput);
	const governanceIR = await buildGovernanceIR(normalizedInput, sources);
	traceSteps.push({
		stage: "Governance IR",
		lines: [
			`ir_version: ${governanceIR.irVersion}`,
			`bundle_fingerprint: ${governanceIR.fingerprints.bundle}`,
			`task_fingerprint: ${governanceIR.fingerprints.task}`,
			`directives_fingerprint: ${governanceIR.fingerprints.directives}`,
			`observations_fingerprint: ${governanceIR.fingerprints.observations}`,
			`feedback_fingerprint: ${governanceIR.fingerprints.feedback}`,
			`host_proposals_fingerprint: ${governanceIR.fingerprints.hostProposals}`,
			`host_proposal_sources: ${formatRecordCounts(countSourceIds(governanceIR.hostProposals.map((proposal) => proposal.source.id)))}`,
			`selected_layers: ${governanceIR.sourceManifest.selectedLayers.join(", ") || "(none)"}`
		]
	});
	traceSteps.push({
		stage: "Host Fulfillment",
		lines: summarizeHostFulfillment(hostFulfillment)
	});
	const activationDecisionsIR = resolveActivationDecisionsIR(governanceIR);
	const irActivatedDirectiveIds = activatedDirectiveIdsIR(activationDecisionsIR);
	const activatedGovernanceIR = {
		...governanceIR,
		directives: governanceIR.directives.filter((directive) => irActivatedDirectiveIds.has(directive.id))
	};
	const semanticRelationsIR = buildSemanticRelationsIR(activatedGovernanceIR);
	traceSteps.push({
		stage: "IR Semantic Relations",
		lines: summarizeSemanticRelationsIR(semanticRelationsIR)
	});
	const { activationView, activeDirectives } = projectIRActivationToPublic(governanceIR, activationDecisionsIR);
	const selectedLayerIds = sources.selectedLayerIds;
	traceSteps.push({
		stage: "Layer Filter",
		lines: [
			...activationView.selected_layers.length ? activationView.selected_layers.map((layerId) => `applied ${layerId}`) : ["applied builtin/core"],
			`activated: ${activationView.activated.length}`,
			`skipped: ${activationView.skipped.length}`
		]
	});
	const rccl = sources.rccl;
	traceSteps.push({
		stage: "RCCL Source Evolution",
		lines: summarizeRcclSourceEvolution(rccl)
	});
	traceSteps.push({
		stage: "RCCL Verify Gate",
		lines: rccl?.observations.length ? rccl.observations.map((observation) => {
			const evidenceStatus = observation.verification.evidence_status ?? "pending";
			const inductionStatus = observation.verification.induction_status ?? "pending";
			const disposition = observation.verification.disposition ?? "pending";
			const lifecycleStatus = observation.lifecycle?.status ?? "unknown";
			return `${observation.id}: evidence=${evidenceStatus} induction=${inductionStatus} disposition=${disposition} lifecycle=${lifecycleStatus} support=${observation.support.scope_basis}/${observation.support.file_count}f/${observation.support.cluster_count}c`;
		}) : ["no rccl loaded"]
	});
	const executionDecisionsIR = resolveExecutionDecisionsIR(activatedGovernanceIR, semanticRelationsIR);
	const semanticMergeResult = projectIRSemanticMergeToPublic(activeDirectives, rccl?.observations ?? [], semanticRelationsIR, executionDecisionsIR, contextProfile);
	const tensions = { records: semanticMergeResult.context_tensions };
	const focus = buildFocusView(semanticMergeResult, activeDirectives);
	traceSteps.push({
		stage: "Semantic Merge",
		lines: [
			`activated_directives: ${semanticMergeResult.activated_directives.length}`,
			`suppressed_directives: ${semanticMergeResult.suppressed_directives.length}`,
			`relations: ${semanticMergeResult.relations.length}`,
			`accepted_relations: ${semanticMergeResult.merge_summary.accepted}`,
			`downgraded_relations: ${semanticMergeResult.merge_summary.downgraded}`,
			`rejected_relations: ${semanticMergeResult.merge_summary.rejected}`,
			`final_relations: ${formatRecordCounts(semanticMergeResult.merge_summary.final_relation_counts)}`,
			`relation_sources: ${formatRecordCounts(semanticMergeResult.merge_summary.proposed_by_counts)}`,
			`execution_mode_impacting_relations: ${semanticMergeResult.merge_summary.execution_mode_impacting}`,
			`host_semantic_candidates: ${semanticMergeResult.merge_summary.host_semantic_candidate_count}`,
			`feedback_applied: ${semanticMergeResult.merge_summary.feedback_applied_count}`,
			`semantic_relation_policy: ${formatPolicy(semanticMergeResult.merge_summary.policy)}`,
			`review_focus_by_priority: ${formatRecordCounts(semanticMergeResult.merge_summary.review_priority_counts)}`,
			`semantic_relation_mode_changes: ${semanticRelationModeChanges(semanticMergeResult).join(", ") || "(none)"}`,
			`context_policy_rules: ${formatListCounts(executionDecisionsIR.flatMap((decision) => decision.contextRulesApplied))}`,
			`context_tensions: ${semanticMergeResult.context_tensions.length}`,
			`review_focus: ${focus.review_focus.length}`,
			`context_influences: ${semanticMergeResult.context_influences.length}`
		]
	});
	const ego = projectIREgoToPublic(activatedGovernanceIR, semanticMergeResult, intent);
	traceSteps.push({
		stage: "EGO Assembly",
		lines: [
			`must_follow: ${ego.guidance.must_follow.length}`,
			`avoid: ${ego.guidance.avoid.length}`,
			`context_tensions: ${ego.guidance.context_tensions.length}`,
			`ambient: ${ego.guidance.ambient.length}`
		]
	});
	const trace = {
		task: intent,
		steps: traceSteps,
		activated_directives: semanticMergeResult.activated_directives,
		suppressed_directives: semanticMergeResult.suppressed_directives,
		activation: activationView,
		tensions,
		review_focus: focus.review_focus,
		directive_decisions: semanticMergeResult.directive_modes,
		observation_links: semanticMergeResult.observation_links,
		context_influences: semanticMergeResult.context_influences,
		...hostFulfillment ? { host_fulfillment: hostFulfillment } : {}
	};
	const cache = buildCacheKeys({
		builtinRoot: normalizedInput.builtinRoot,
		localAugmentPath: normalizedInput.localAugmentPath,
		rcclPath: normalizedInput.rcclPath,
		task: resolved.task,
		builtinLayers: sources.builtinLayers,
		hostProposalsFingerprint: governanceIR.fingerprints.hostProposals
	}, selectedLayerIds, rccl);
	return compileResolvedOutput({
		version: "1.0",
		task: {
			task_kind: resolved.taskKind,
			input: resolved.task
		},
		interpretation: buildInterpretationPacket(resolved),
		governance: buildGovernancePacket(activationView, tensions, focus, semanticMergeResult, ego, trace),
		cache
	}, resolved);
}
function summarizeRcclSourceEvolution(rccl) {
	if (!rccl) return ["no rccl loaded"];
	const lifecycleCounts = countBy(rccl.observations, (observation) => observation.lifecycle?.status ?? "unknown");
	const fingerprints = rccl.observations.filter((observation) => observation.lifecycle?.content_fingerprint).map((observation) => `${observation.id}:${observation.lifecycle?.content_fingerprint.slice(0, 10)}`);
	return [
		`version: ${rccl.version}`,
		`git_ref: ${rccl.git_ref ?? "(none)"}`,
		`generated_at: ${rccl.generated_at ?? "(none)"}`,
		`observations: ${rccl.observations.length}`,
		`lifecycle_statuses: ${formatCounts(lifecycleCounts)}`,
		`fingerprints: ${fingerprints.join(", ") || "(none)"}`
	];
}
function summarizeSemanticRelationsIR(relations) {
	const statusCounts = countBy(relations, (relation) => relation.adjudication.status);
	const finalRelationCounts = countBy(relations, (relation) => relation.adjudication.finalRelation);
	const proposedRelationCounts = countBy(relations, (relation) => relation.relation);
	const proposedByCounts = countBy(relations, (relation) => relation.proposedBy);
	return [
		`proposed: ${relations.length}`,
		`accepted: ${statusCounts.get("accepted") ?? 0}`,
		`downgraded: ${statusCounts.get("downgraded") ?? 0}`,
		`rejected: ${statusCounts.get("rejected") ?? 0}`,
		`proposed_relations: ${formatCounts(proposedRelationCounts)}`,
		`final_relations: ${formatCounts(finalRelationCounts)}`,
		`proposed_by: ${formatCounts(proposedByCounts)}`
	];
}
function countBy(items, key) {
	const counts = /* @__PURE__ */ new Map();
	for (const item of items) {
		const value = key(item);
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}
function formatCounts(counts) {
	if (counts.size === 0) return "(none)";
	return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(", ");
}
function buildFocusView(semanticMergeResult, directives) {
	const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
	return { review_focus: semanticMergeResult.focus.review_focus.map((item) => {
		const directive = item.directive_id ? directiveById.get(item.directive_id) : void 0;
		return {
			kind: item.kind,
			title: buildFocusTitle(item.kind, directive?.description, item.directive_id, item.observation_id),
			reason: item.reason,
			directive_id: item.directive_id,
			observation_id: item.observation_id,
			priority: item.priority,
			relation_id: item.relation_id,
			group_id: item.group_id
		};
	}) };
}
function buildFocusTitle(kind, directiveDescription, directiveId, observationId) {
	const directiveLabel = directiveDescription ?? directiveId ?? "directive";
	switch (kind) {
		case "tension": return `Review tension around ${directiveLabel}`;
		case "anti-pattern": return `Check anti-pattern suppression for ${observationId ?? directiveLabel}`;
		case "high-priority-directive": return `Confirm high-priority guidance for ${directiveLabel}`;
		case "compatibility-boundary": return `Inspect compatibility boundary for ${directiveLabel}`;
	}
}
function semanticRelationModeChanges(semanticMergeResult) {
	return semanticMergeResult.directive_modes.filter((item) => item.relation_ids.length > 0 && item.execution_mode !== item.default_execution_mode).map((item) => `${item.directive_id}:${item.default_execution_mode}->${item.execution_mode}`);
}
function countSourceIds(sourceIds) {
	const counts = {};
	for (const sourceId of sourceIds) counts[sourceId] = (counts[sourceId] ?? 0) + 1;
	return counts;
}
function summarizeHostFulfillment(hostFulfillment) {
	if (!hostFulfillment) return ["no host fulfillment summary provided"];
	return [
		`status: ${hostFulfillment.status}`,
		formatHostFulfillmentArtifact("task_interpretation", hostFulfillment.taskInterpretation),
		formatHostFulfillmentArtifact("semantic_relation", hostFulfillment.semanticRelation),
		formatHostFulfillmentArtifact("semantic_candidate", hostFulfillment.semanticCandidate)
	];
}
function formatHostFulfillmentArtifact(label, artifact) {
	const diagnostics = artifact.diagnostics?.summary;
	return `${label}: provided=${artifact.provided} status=${artifact.status} accepted=${diagnostics?.accepted ?? 0} rejected=${diagnostics?.rejected ?? 0} downgraded=${diagnostics?.downgraded ?? 0} unused=${diagnostics?.unused ?? 0}`;
}
function formatRecordCounts(counts) {
	const entries = Object.entries(counts).filter(([, count]) => count > 0);
	return entries.length ? entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(", ") : "(none)";
}
function formatListCounts(values) {
	const counts = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return formatRecordCounts(counts);
}
function formatContextValue(value) {
	return Array.isArray(value) ? value.join(",") || "(none)" : value || "(none)";
}
function formatPolicy(policy) {
	return [
		`host_min_confidence=${policy.host_semantic.min_confidence}`,
		`host_candidate_cap=${policy.host_semantic.max_candidates_per_directive}`,
		`feedback_follow_rate=${policy.feedback.frequently_ignored_follow_rate}`,
		`feedback_min_ignored=${policy.feedback.frequently_ignored_min_ignored}`,
		`recurring_tension_seen=${policy.feedback.recurring_tension_seen_count}`
	].join(", ");
}
/**
* Derives stable cache keys for layered inputs and the concrete task payload.
*/
function buildCacheKeys(input, selectedLayerIds, rccl) {
	const builtinFingerprints = selectedLayerIds.map((layerId) => {
		const filePath = input.builtinLayers.get(layerId);
		return `${layerId}:${filePath ? stableHash([readFileSync(filePath, "utf-8")]) : stableHash(["missing"])}`;
	});
	const localSource = input.localAugmentPath ? readFileSync(input.localAugmentPath, "utf-8") : "";
	const rcclSource = input.rcclPath && rccl ? JSON.stringify(rccl.observations.map((item) => [
		item.id,
		item.verification.evidence_status,
		item.verification.disposition
	])) : "";
	const l1Key = stableHash(builtinFingerprints);
	const l2Key = stableHash([
		l1Key,
		localSource,
		rcclSource
	]);
	return {
		l1Key,
		l2Key,
		l3Key: stableHash([
			l2Key,
			input.task,
			input.hostProposalsFingerprint
		])
	};
}
//#endregion
export { compile, resolveTask };
