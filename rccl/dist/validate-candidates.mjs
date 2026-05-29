import { validateCandidateObservationShape } from "./validate-observation.mjs";
import { parseRcclCandidates } from "./io/parse-rccl.mjs";
//#region src/validate-candidates.ts
const MIN_CONFIDENCE = .3;
function validateRcclCandidatePayload(yamlText) {
	const parsed = parseRcclCandidates(yamlText);
	if (!parsed.valid || !parsed.data) return {
		valid: false,
		observations: [],
		document: null,
		diagnostics: {
			kind: "rccl-observation-generation",
			summary: {
				total: 0,
				accepted: 0,
				rejected: 1
			},
			entries: [{
				status: "rejected",
				reason: classifyParseErrors(parsed.errors ?? []),
				path: "document",
				message: (parsed.errors ?? []).join("; ") || "Failed to parse candidate YAML"
			}]
		}
	};
	return validateCandidateDocument(parsed.data);
}
function validateCandidateDocument(doc) {
	const entries = [];
	const accepted = [];
	const seenIds = /* @__PURE__ */ new Set();
	for (let i = 0; i < doc.observations.length; i += 1) {
		const obs = doc.observations[i];
		const path = `observations[${i}]`;
		const id = obs.provisional_id;
		if (seenIds.has(id)) {
			entries.push({
				status: "rejected",
				reason: "duplicate-id",
				path,
				message: `Duplicate provisional_id "${id}"; only the first occurrence is accepted.`,
				observationId: id
			});
			continue;
		}
		seenIds.add(id);
		const structureErrors = validateCandidateObservationShape(obs, path);
		if (structureErrors.length) {
			entries.push({
				status: "rejected",
				reason: classifyStructureErrors(structureErrors),
				path,
				message: structureErrors.join("; "),
				observationId: id || void 0,
				confidence: Number.isFinite(obs.confidence) ? obs.confidence : void 0
			});
			continue;
		}
		if (obs.confidence < MIN_CONFIDENCE) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Confidence ${obs.confidence} is below minimum threshold ${MIN_CONFIDENCE}.`,
				observationId: id,
				confidence: obs.confidence
			});
			continue;
		}
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: `Candidate "${id}" accepted.`,
			observationId: id,
			confidence: obs.confidence
		});
		accepted.push(obs);
	}
	const summary = {
		total: doc.observations.length,
		accepted: accepted.length,
		rejected: doc.observations.length - accepted.length
	};
	return {
		valid: accepted.length > 0,
		observations: accepted,
		document: {
			version: doc.version,
			generated_at: doc.generated_at,
			git_ref: doc.git_ref
		},
		diagnostics: {
			kind: "rccl-observation-generation",
			summary,
			entries
		}
	};
}
function classifyParseErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("yaml parse error") || joined.includes("must be a yaml object")) return "malformed-payload";
	if (joined.includes("missing") || joined.includes("must be")) return "missing-required-field";
	return "malformed-payload";
}
function classifyStructureErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("missing") || joined.includes("must be a non-empty")) return "missing-required-field";
	return "unsupported-value";
}
//#endregion
export { validateRcclCandidatePayload };
