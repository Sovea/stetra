import { parseYaml } from "../utils/yaml.mjs";
import { RCCL_ADHERENCE_QUALITIES, RCCL_CATEGORIES, RCCL_OBSERVATION_ID_PATTERN, RCCL_SCOPE_BASES, validateCandidateObservationRecord, validateEvidenceSnippet } from "../validate-observation.mjs";
//#region src/io/parse-rccl.ts
const RCCL_VERSION = "1.0";
function isRcclVersion(value) {
	return value === RCCL_VERSION || value === 1;
}
const REQUIRED_VERIFICATION_FIELDS = [
	"evidence_status",
	"evidence_verified_count",
	"evidence_confidence",
	"induction_status",
	"induction_confidence",
	"checked_at",
	"disposition"
];
function parseRccl(yamlText, options = {}) {
	const allowVerifiedFields = options.allowVerifiedFields === true;
	const parsed = parseRawRcclDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateFinalRcclDocument(parsed.doc, allowVerifiedFields);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeDocument(parsed.doc)
	};
}
function parseRcclCandidates(yamlText) {
	const parsed = parseRawRcclDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateCandidateRcclDocument(parsed.doc);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeCandidateDocument(parsed.doc)
	};
}
function parseRawRcclDocument(yamlText) {
	let cleaned = yamlText.trim();
	if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:yaml|yml)?\s*\n?/, "").replace(/\n?```\s*$/, "");
	let doc;
	try {
		doc = parseYaml(cleaned);
	} catch (err) {
		return {
			valid: false,
			errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`]
		};
	}
	if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {
		valid: false,
		errors: ["Document must be a YAML object"]
	};
	return {
		valid: true,
		doc
	};
}
function validateFinalRcclDocument(doc, allowVerifiedFields) {
	const errors = validateDocumentEnvelope(doc);
	if (errors.length > 0) return errors;
	const observations = doc.observations;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < observations.length; i += 1) {
		const obs = observations[i];
		const rawId = String(obs.id ?? "");
		if (rawId) {
			if (ids.has(rawId)) errors.push(`Duplicate observation id: "${rawId}"`);
			ids.add(rawId);
		}
		errors.push(...validateFinalObservation(obs, i, allowVerifiedFields));
	}
	return errors;
}
function validateCandidateRcclDocument(doc) {
	const errors = validateDocumentEnvelope(doc);
	if (errors.length > 0) return errors;
	const observations = doc.observations;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < observations.length; i += 1) {
		const obs = observations[i];
		const rawId = String(obs.provisional_id ?? "");
		if (rawId) {
			if (ids.has(rawId)) errors.push(`Duplicate candidate observation id: "${rawId}"`);
			ids.add(rawId);
		}
		errors.push(...validateCandidateObservation(obs, i));
	}
	return errors;
}
function validateDocumentEnvelope(doc) {
	const errors = [];
	if (!isRcclVersion(doc.version)) errors.push(`'version' must be "${RCCL_VERSION}", got "${doc.version}"`);
	if (!Array.isArray(doc.observations) || doc.observations.length === 0) errors.push("'observations' must be a non-empty array");
	return errors;
}
function validateFinalObservation(obs, index, allowVerifiedFields) {
	const errors = validateObservationCore(obs, index, "id", "scope");
	const prefix = `observations[${index}]`;
	if ("provisional_id" in obs) errors.push(`${prefix}: final RCCL observations must use 'id', not 'provisional_id'`);
	if ("scope_hint" in obs) errors.push(`${prefix}: final RCCL observations must use 'scope', not 'scope_hint'`);
	if ("source_slice_ids" in obs) errors.push(`${prefix}: final RCCL observations must store source slices in 'support.source_slices'`);
	if ("support_hint" in obs) errors.push(`${prefix}: final RCCL observations must use 'support', not 'support_hint'`);
	const support = obs.support;
	if (!support || typeof support !== "object" || Array.isArray(support)) errors.push(`${prefix}: missing or invalid 'support'`);
	else errors.push(...validateSupport(support, `${prefix}.support`));
	const verification = obs.verification;
	if (!verification || typeof verification !== "object" || Array.isArray(verification)) errors.push(`${prefix}: missing or invalid 'verification'`);
	else errors.push(...validateVerification(verification, prefix, allowVerifiedFields));
	errors.push(...validateLifecycle(obs.lifecycle, prefix));
	return errors;
}
function validateCandidateObservation(obs, index) {
	return validateCandidateObservationRecord(obs, `observations[${index}]`);
}
function validateObservationCore(obs, index, idField, scopeField) {
	const errors = [];
	const prefix = `observations[${index}]`;
	const id = obs[idField];
	const scope = obs[scopeField];
	if (!id || typeof id !== "string") errors.push(`${prefix}: missing or invalid '${idField}'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(String(id))) errors.push(`${prefix}: '${idField}' "${id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!RCCL_CATEGORIES.has(String(obs.category))) errors.push(`${prefix}: 'category' is invalid`);
	if (!obs.semantic_key || typeof obs.semantic_key !== "string") errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!scope || typeof scope !== "string") errors.push(`${prefix}: missing or invalid '${scopeField}'`);
	if (!obs.pattern || typeof obs.pattern !== "string") errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (typeof obs.confidence !== "number" || Number.isNaN(obs.confidence) || obs.confidence < 0 || obs.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${obs.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(String(obs.adherence_quality))) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	if (!Array.isArray(obs.evidence) || obs.evidence.length === 0) errors.push(`${prefix}: 'evidence' must be a non-empty array`);
	else for (let i = 0; i < obs.evidence.length; i += 1) {
		const evidence = obs.evidence[i];
		if (!evidence.file || typeof evidence.file !== "string") errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!Array.isArray(evidence.line_range) || evidence.line_range.length !== 2) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!evidence.snippet || typeof evidence.snippet !== "string") errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function validateSupport(support, prefix) {
	const errors = [];
	if (!Array.isArray(support.source_slices)) errors.push(`${prefix}.source_slices: must be an array`);
	if (typeof support.file_count !== "number") errors.push(`${prefix}.file_count: must be a number`);
	if (typeof support.cluster_count !== "number") errors.push(`${prefix}.cluster_count: must be a number`);
	if (!RCCL_SCOPE_BASES.has(String(support.scope_basis))) errors.push(`${prefix}.scope_basis: invalid value`);
	return errors;
}
function validateVerification(verification, prefix, allowVerifiedFields) {
	const errors = [];
	for (const field of REQUIRED_VERIFICATION_FIELDS) if (!(field in verification)) errors.push(`${prefix}.verification.${field}: missing required field`);
	if (!allowVerifiedFields) {
		for (const field of REQUIRED_VERIFICATION_FIELDS) if (verification[field] !== null && verification[field] !== void 0) errors.push(`${prefix}.verification.${field}: must be null (runtime fills this), got "${verification[field]}"`);
	}
	return errors;
}
function validateLifecycle(lifecycle, prefix) {
	if (lifecycle == null) return [];
	const errors = [];
	if (lifecycle.status != null && lifecycle.status !== "active" && lifecycle.status !== "stale" && lifecycle.status !== "superseded") errors.push(`${prefix}.lifecycle.status: invalid value`);
	if (lifecycle.content_fingerprint != null && typeof lifecycle.content_fingerprint !== "string") errors.push(`${prefix}.lifecycle.content_fingerprint: must be a string`);
	if (lifecycle.supersedes != null) {
		if (!Array.isArray(lifecycle.supersedes)) errors.push(`${prefix}.lifecycle.supersedes: must be an array`);
		else for (const id of lifecycle.supersedes) if (typeof id !== "string" || !RCCL_OBSERVATION_ID_PATTERN.test(id)) errors.push(`${prefix}.lifecycle.supersedes: contains invalid observation id`);
	}
	if (lifecycle.superseded_by != null && (typeof lifecycle.superseded_by !== "string" || !RCCL_OBSERVATION_ID_PATTERN.test(lifecycle.superseded_by))) errors.push(`${prefix}.lifecycle.superseded_by: must be a valid observation id`);
	return errors;
}
function normalizeCandidateDocument(input) {
	return {
		version: RCCL_VERSION,
		generated_at: typeof input.generated_at === "string" ? input.generated_at : null,
		git_ref: typeof input.git_ref === "string" ? input.git_ref : null,
		observations: Array.isArray(input.observations) ? input.observations.map(normalizeCandidateObservation) : []
	};
}
function normalizeCandidateObservation(input) {
	const item = input;
	const supportHint = item.support_hint;
	return {
		provisional_id: String(item.provisional_id),
		semantic_key: normalizeSemanticKey(String(item.semantic_key)),
		category: item.category,
		scope_hint: normalizeScope(String(item.scope_hint)),
		pattern: String(item.pattern),
		confidence: Number(item.confidence),
		adherence_quality: item.adherence_quality,
		evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
		source_slice_ids: Array.isArray(item.source_slice_ids) ? Array.from(new Set(item.source_slice_ids.map(String))).sort() : [],
		support_hint: supportHint == null ? null : {
			scope_basis: supportHint.scope_basis == null ? null : normalizeScopeBasis(String(supportHint.scope_basis)),
			file_count: supportHint.file_count == null ? null : Number(supportHint.file_count),
			cluster_count: supportHint.cluster_count == null ? null : Number(supportHint.cluster_count)
		}
	};
}
function normalizeDocument(input) {
	return {
		version: RCCL_VERSION,
		generated_at: typeof input.generated_at === "string" ? input.generated_at : null,
		git_ref: typeof input.git_ref === "string" ? input.git_ref : null,
		observations: Array.isArray(input.observations) ? input.observations.map(normalizeObservation) : []
	};
}
function normalizeObservation(input) {
	const item = input;
	return {
		id: String(item.id),
		semantic_key: normalizeSemanticKey(String(item.semantic_key)),
		category: item.category,
		scope: normalizeScope(String(item.scope)),
		pattern: String(item.pattern),
		confidence: Number(item.confidence),
		adherence_quality: item.adherence_quality,
		evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
		support: normalizeSupport(item.support),
		verification: normalizeVerification(item.verification),
		lifecycle: normalizeLifecycle(item.lifecycle)
	};
}
function normalizeEvidence(input) {
	const value = input;
	const lineRange = value.line_range;
	return {
		file: normalizePath(String(value.file)),
		line_range: [Number(lineRange[0]), Number(lineRange[1])],
		snippet: String(value.snippet ?? "")
	};
}
function normalizeSupport(input) {
	return {
		source_slices: Array.isArray(input.source_slices) ? Array.from(new Set(input.source_slices.map(String))).sort() : [],
		file_count: Number(input.file_count),
		cluster_count: Number(input.cluster_count),
		scope_basis: normalizeScopeBasis(String(input.scope_basis))
	};
}
function normalizeVerification(input) {
	return {
		evidence_status: input.evidence_status ?? null,
		evidence_verified_count: input.evidence_verified_count == null ? null : Number(input.evidence_verified_count),
		evidence_confidence: input.evidence_confidence == null ? null : Number(input.evidence_confidence),
		induction_status: input.induction_status ?? null,
		induction_confidence: input.induction_confidence == null ? null : Number(input.induction_confidence),
		checked_at: typeof input.checked_at === "string" ? input.checked_at : null,
		disposition: input.disposition ?? null
	};
}
function normalizeLifecycle(input) {
	if (!input) return void 0;
	const status = input.status === "stale" || input.status === "superseded" ? input.status : "active";
	return {
		first_seen_git_ref: typeof input.first_seen_git_ref === "string" ? input.first_seen_git_ref : null,
		last_seen_git_ref: typeof input.last_seen_git_ref === "string" ? input.last_seen_git_ref : null,
		last_verified_at: typeof input.last_verified_at === "string" ? input.last_verified_at : null,
		content_fingerprint: typeof input.content_fingerprint === "string" ? input.content_fingerprint : "",
		status,
		supersedes: Array.isArray(input.supersedes) ? input.supersedes.map(String).sort() : void 0,
		superseded_by: typeof input.superseded_by === "string" ? input.superseded_by : void 0,
		stale_since_git_ref: typeof input.stale_since_git_ref === "string" ? input.stale_since_git_ref : null,
		superseded_at_git_ref: typeof input.superseded_at_git_ref === "string" ? input.superseded_at_git_ref : null
	};
}
function normalizeScopeBasis(value) {
	if (value === "single-file" || value === "directory-cluster" || value === "module-cluster" || value === "cross-root") return value;
	return "module-cluster";
}
function normalizeScope(scope) {
	const trimmed = scope.trim();
	return trimmed.length > 0 ? trimmed : "**";
}
function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizeSemanticKey(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
//#endregion
export { normalizeDocument, normalizeObservation, parseRccl, parseRcclCandidates };
