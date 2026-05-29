import { consolidateObservations, materializeRcclObservations } from "./consolidate/consolidate-observations.mjs";
import { parseRccl } from "./io/parse-rccl.mjs";
import { emitRccl, writeCandidateArtifact, writeConsolidationArtifact } from "./io/emit-rccl.mjs";
import { validateRcclObservationRefreshPayload } from "./validate-refresh.mjs";
import { verifyEvidenceForDocument } from "./verify/verify-evidence.mjs";
import { verifyInductionForDocument } from "./verify/verify-induction.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
//#region src/commit-refresh.ts
function commitRcclObservationRefresh(projectRootInput, yamlText, options = {}) {
	const projectRoot = resolve(projectRootInput);
	const existingPath = join(projectRoot, ".resonant-code", "rccl.yaml");
	if (!existsSync(existingPath)) return {
		status: "failed",
		reason: "missing-existing-rccl",
		errors: ["Existing .resonant-code/rccl.yaml is required before committing an incremental refresh."]
	};
	const parsedExisting = parseRccl(readFileSync(existingPath, "utf-8"), { allowVerifiedFields: true });
	if (!parsedExisting.valid || !parsedExisting.data) return {
		status: "failed",
		reason: "invalid-existing-rccl",
		errors: parsedExisting.errors ?? ["Existing .resonant-code/rccl.yaml could not be parsed."]
	};
	const existing = parsedExisting.data;
	const activeExisting = existing.observations.filter(isActiveObservation);
	const validation = validateRcclObservationRefreshPayload(yamlText, {
		allowedObservationIds: existing.observations.map((observation) => observation.id),
		activeObservationIds: activeExisting.map((observation) => observation.id)
	});
	if (!validation.valid || !validation.document) return {
		status: "failed",
		reason: "invalid-refresh-payload",
		diagnostics: validation.diagnostics
	};
	const materialized = materializeRefresh(existing, validation.document);
	const verified = verifyInductionForDocument(verifyEvidenceForDocument({
		version: "1.0",
		generated_at: validation.document.generated_at,
		git_ref: existing.git_ref,
		observations: materialized.activeObservations
	}, projectRoot));
	const result = emitRccl(verified, projectRoot);
	const debugArtifacts = options.debugArtifacts ? {
		enabled: true,
		candidates: writeCandidateArtifact(projectRoot, materialized.candidateDocument),
		consolidation: writeConsolidationArtifact(projectRoot, materialized.consolidation, verified)
	} : { enabled: false };
	return {
		status: "committed",
		diagnostics: validation.diagnostics,
		refresh_summary: materialized.summary,
		result,
		debugArtifacts
	};
}
function materializeRefresh(existing, refresh) {
	const revisedCandidates = refresh.revise;
	const newCandidates = refresh.new_observations;
	const changedCandidates = [...revisedCandidates, ...newCandidates];
	const revisedById = new Map(revisedCandidates.map((candidate) => [candidate.provisional_id, materializeCandidate(candidate)]));
	const newObservations = newCandidates.map(materializeCandidate);
	const retiredIds = new Set(refresh.retire.map((entry) => entry.observation_id));
	const usedRevisions = /* @__PURE__ */ new Set();
	const carriedForward = [];
	const activeObservations = [];
	for (const observation of existing.observations.filter(isActiveObservation)) {
		if (retiredIds.has(observation.id)) continue;
		const revised = revisedById.get(observation.id);
		if (revised) {
			activeObservations.push(revised);
			usedRevisions.add(observation.id);
			continue;
		}
		activeObservations.push(stripLifecycle(observation));
		if (!refresh.keep.includes(observation.id)) carriedForward.push(observation.id);
	}
	for (const id of revisedById.keys()) if (!usedRevisions.has(id)) throw new Error(`Refresh revise "${id}" did not match an active observation.`);
	activeObservations.push(...newObservations);
	const candidateDocument = {
		version: "1.0",
		generated_at: refresh.generated_at,
		git_ref: existing.git_ref,
		observations: changedCandidates
	};
	const consolidation = consolidateObservations(changedCandidates);
	return {
		activeObservations: activeObservations.sort((a, b) => a.id.localeCompare(b.id)),
		candidateDocument,
		consolidation,
		summary: {
			previous_observation_count: existing.observations.length,
			active_observation_count: activeObservations.length,
			kept: refresh.keep.slice().sort(),
			carried_forward: carriedForward.sort(),
			revised: revisedCandidates.map((candidate) => candidate.provisional_id).sort(),
			retired: refresh.retire.map((entry) => entry.observation_id).sort(),
			added: newCandidates.map((candidate) => candidate.provisional_id).sort()
		}
	};
}
function materializeCandidate(candidate) {
	const [observation] = materializeRcclObservations(consolidateObservations([candidate]).observations);
	if (!observation) throw new Error(`Refresh candidate "${candidate.provisional_id}" could not be materialized.`);
	return observation;
}
function isActiveObservation(observation) {
	return observation.lifecycle?.status == null || observation.lifecycle.status === "active";
}
function stripLifecycle(observation) {
	const { lifecycle: _lifecycle, ...rest } = observation;
	return rest;
}
//#endregion
export { commitRcclObservationRefresh };
