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
		const missingFields = checkRequiredFields(obs, path);
		if (missingFields) {
			entries.push(missingFields);
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
function checkRequiredFields(obs, path) {
	const missing = [];
	if (!obs.provisional_id) missing.push("provisional_id");
	if (!obs.semantic_key) missing.push("semantic_key");
	if (!obs.category) missing.push("category");
	if (!obs.pattern) missing.push("pattern");
	if (!obs.scope_hint) missing.push("scope_hint");
	if (!obs.evidence || obs.evidence.length === 0) missing.push("evidence");
	if (missing.length === 0) return null;
	return {
		status: "rejected",
		reason: "missing-required-field",
		path,
		message: `Missing required fields: ${missing.join(", ")}.`,
		observationId: obs.provisional_id || void 0
	};
}
function classifyParseErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("yaml parse error") || joined.includes("must be a yaml object")) return "malformed-payload";
	if (joined.includes("missing") || joined.includes("must be")) return "missing-required-field";
	return "malformed-payload";
}
//#endregion
export { validateRcclCandidatePayload };
