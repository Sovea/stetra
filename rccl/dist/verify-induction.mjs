import YAML from "yaml";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
//#region src/utils/yaml.ts
function parseYaml(text) {
	return YAML.parse(text);
}
function toYaml(value) {
	return YAML.stringify(value, {
		lineWidth: 0,
		keepUndefined: false
	});
}
//#endregion
//#region src/validate-observation.ts
const RCCL_OBSERVATION_ID_PATTERN = /^obs-[a-z0-9-]+$/;
const RCCL_CATEGORIES = new Set([
	"style",
	"architecture",
	"pattern",
	"constraint",
	"legacy",
	"anti-pattern",
	"migration"
]);
const RCCL_ADHERENCE_QUALITIES = new Set([
	"good",
	"inconsistent",
	"poor"
]);
const RCCL_SCOPE_BASES = new Set([
	"single-file",
	"directory-cluster",
	"module-cluster",
	"cross-root"
]);
function validateCandidateObservationRecord(obs, prefix) {
	const errors = validateCandidateCoreRecord(obs, prefix);
	if ("id" in obs) errors.push(`${prefix}: candidate observations must use 'provisional_id', not 'id'`);
	if ("scope" in obs) errors.push(`${prefix}: candidate observations must use 'scope_hint', not 'scope'`);
	if ("support" in obs) errors.push(`${prefix}: candidate observations must use 'support_hint', not 'support'`);
	if ("verification" in obs) errors.push(`${prefix}: candidate observations must not include 'verification'`);
	if ("lifecycle" in obs) errors.push(`${prefix}: candidate observations must not include 'lifecycle'`);
	if (!Array.isArray(obs.source_slice_ids) || obs.source_slice_ids.length === 0) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
	else if (!obs.source_slice_ids.every(isNonEmptyString)) errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
	if (obs.support_hint != null) {
		const supportHint = obs.support_hint;
		if (typeof supportHint !== "object" || Array.isArray(supportHint)) errors.push(`${prefix}.support_hint: must be an object when present`);
		else {
			if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
			if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
			if (supportHint.scope_basis != null && !RCCL_SCOPE_BASES.has(String(supportHint.scope_basis))) errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
		}
	}
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
	return errors;
}
function validateCandidateObservationShape(observation, prefix) {
	const errors = [];
	if (!isNonEmptyString(observation.provisional_id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(observation.provisional_id)) errors.push(`${prefix}: 'provisional_id' "${observation.provisional_id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!isNonEmptyString(observation.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!RCCL_CATEGORIES.has(observation.category)) errors.push(`${prefix}: 'category' is invalid`);
	if (!isNonEmptyString(observation.scope_hint)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
	if (!isNonEmptyString(observation.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${observation.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(observation.adherence_quality)) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	if (!observation.source_slice_ids?.length) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
	else if (!observation.source_slice_ids.every(isNonEmptyString)) errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
	errors.push(...validateEvidenceShape(observation.evidence, prefix));
	const supportHint = observation.support_hint;
	if (supportHint != null) {
		if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
		if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
		if (supportHint.scope_basis != null && !isScopeBasis(supportHint.scope_basis)) errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
	}
	errors.push(...validateTraitsRecord(observation.traits, `${prefix}.traits`));
	return errors;
}
function validateEvidenceSnippet(snippet, prefix, index) {
	if (typeof snippet !== "string") return [];
	const normalized = snippet.replace(/\r\n/g, "\n").trim();
	if (!normalized) return [`${prefix}.evidence[${index}]: snippet must not be empty`];
	const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
	const tokenMatches = normalized.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
	const identifierCount = tokenMatches.filter((token) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)).length;
	const punctuationCount = tokenMatches.length - identifierCount;
	const hasDistinctiveStructure = /[{}();=>]|\b(import|export|return|const|let|var|function|class|interface|type|if|for|while|switch|case|await|async)\b/.test(normalized);
	if (lines.length >= 2 || hasDistinctiveStructure) return [];
	if (tokenMatches.length < 4) return [`${prefix}.evidence[${index}]: snippet is too short to verify reliably; include at least a distinctive statement or 2+ lines of code`];
	if (identifierCount <= 2 && punctuationCount === 0) return [`${prefix}.evidence[${index}]: snippet looks like an identifier or label, not a verifiable code fragment`];
	return [];
}
function validateCandidateCoreRecord(obs, prefix) {
	const errors = [];
	const id = obs.provisional_id;
	const scope = obs.scope_hint;
	if (!isNonEmptyString(id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(id)) errors.push(`${prefix}: 'provisional_id' "${id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!RCCL_CATEGORIES.has(String(obs.category))) errors.push(`${prefix}: 'category' is invalid`);
	if (!isNonEmptyString(obs.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!isNonEmptyString(scope)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
	if (!isNonEmptyString(obs.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (typeof obs.confidence !== "number" || !Number.isFinite(obs.confidence) || obs.confidence < 0 || obs.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${obs.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(String(obs.adherence_quality))) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	errors.push(...validateEvidenceRecord(obs.evidence, prefix));
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
	return errors;
}
function validateTraitsRecord(value, prefix) {
	if (value == null) return [];
	const errors = [];
	if (!isRecord(value)) return [`${prefix}: must be an object when present`];
	const allowed = new Set([
		"legacy",
		"migration_boundary",
		"anti_pattern",
		"compatibility_boundary"
	]);
	for (const [key, item] of Object.entries(value)) {
		if (item === void 0) continue;
		if (!allowed.has(key)) errors.push(`${prefix}.${key}: unsupported trait`);
		else if (typeof item !== "boolean") errors.push(`${prefix}.${key}: must be boolean`);
	}
	return errors;
}
function validateEvidenceRecord(value, prefix) {
	const errors = [];
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${prefix}: 'evidence' must be a non-empty array`);
		return errors;
	}
	for (let i = 0; i < value.length; i += 1) {
		const evidence = value[i];
		if (!isRecord(evidence)) {
			errors.push(`${prefix}.evidence[${i}]: must be an object`);
			continue;
		}
		if (!isNonEmptyString(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!isNonEmptyString(evidence.snippet)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function validateEvidenceShape(value, prefix) {
	const errors = [];
	if (!value?.length) {
		errors.push(`${prefix}: 'evidence' must be a non-empty array`);
		return errors;
	}
	for (let i = 0; i < value.length; i += 1) {
		const evidence = value[i];
		if (!isNonEmptyString(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!isNonEmptyString(evidence.snippet)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function isValidLineRange(value) {
	if (!Array.isArray(value) || value.length !== 2) return false;
	const [start, end] = value;
	return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}
function isPositiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 1;
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isScopeBasis(value) {
	return value === "single-file" || value === "directory-cluster" || value === "module-cluster" || value === "cross-root";
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//#endregion
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
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
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
		},
		traits: normalizeTraits(item.traits)
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
		lifecycle: normalizeLifecycle(item.lifecycle),
		traits: normalizeTraits(item.traits)
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
function normalizeTraits(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return void 0;
	const value = input;
	const traits = {
		legacy: booleanTrait(value.legacy),
		migration_boundary: booleanTrait(value.migration_boundary),
		anti_pattern: booleanTrait(value.anti_pattern),
		compatibility_boundary: booleanTrait(value.compatibility_boundary)
	};
	return Object.values(traits).some((item) => item !== void 0) ? traits : void 0;
}
function booleanTrait(input) {
	return typeof input === "boolean" ? input : void 0;
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
//#region src/policies.ts
const DEFAULT_SAMPLING_POLICY = {
	max_slices: 8,
	max_files_per_slice: 4,
	max_windows_per_file: 3,
	target_coverage: {
		roots: true,
		modules: true,
		boundaries: true,
		migrations: true,
		style_clusters: true
	}
};
const DEFAULT_VERIFICATION_POLICY = {
	snippet_similarity_threshold: .75,
	min_evidence_for_directory_scope: 2,
	min_evidence_for_cross_root_scope: 3,
	anti_pattern_min_evidence: 2,
	migration_min_evidence: 2
};
//#endregion
//#region src/verify/verify-evidence.ts
function verifyEvidenceForDocument(rccl, projectRoot, now = /* @__PURE__ */ new Date(), policy = DEFAULT_VERIFICATION_POLICY) {
	return {
		...rccl,
		observations: rccl.observations.map((observation) => verifyObservationEvidence(observation, projectRoot, now.toISOString(), policy))
	};
}
function verifyObservationEvidence(observation, projectRoot, checkedAt, policy = DEFAULT_VERIFICATION_POLICY) {
	if (observation.evidence.length === 0) return applyEvidenceVerification(observation, "unverifiable", 0, 0, checkedAt, "demote-to-ambient");
	const results = observation.evidence.map((item) => verifyEvidence(item, projectRoot, policy));
	const verifiedCount = results.filter((result) => result.status === "match").length;
	const ratio = verifiedCount / results.length;
	if (verifiedCount === results.length) return applyEvidenceVerification(observation, "verified", verifiedCount, observation.confidence, checkedAt, "keep");
	if (verifiedCount > 0) {
		const confidence = Math.max(observation.confidence * ratio, .3);
		return applyEvidenceVerification(observation, "partial", verifiedCount, confidence, checkedAt, confidence < .7 ? "keep-with-reduced-confidence" : "keep");
	}
	return applyEvidenceVerification(observation, "failed", 0, 0, checkedAt, "demote-to-ambient");
}
function applyEvidenceVerification(observation, status, verifiedCount, evidenceConfidence, checkedAt, disposition) {
	return {
		...observation,
		verification: {
			...observation.verification,
			evidence_status: status,
			evidence_verified_count: verifiedCount,
			evidence_confidence: Number(evidenceConfidence.toFixed(2)),
			checked_at: checkedAt,
			disposition
		}
	};
}
function verifyEvidence(evidence, projectRoot, policy = DEFAULT_VERIFICATION_POLICY) {
	if (!safeRelativeEvidencePath(evidence.file)) return { status: "path-outside-project" };
	const root = realpathSync(resolve(projectRoot));
	const fullPath = resolve(root, evidence.file);
	if (!existsSync(fullPath)) return { status: "file-not-found" };
	let realFile;
	try {
		realFile = realpathSync(fullPath);
	} catch {
		return { status: "file-not-found" };
	}
	const rel = relative(root, realFile);
	if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) return { status: "path-outside-project" };
	const lines = readFileSync(realFile, "utf-8").replace(/\r\n/g, "\n").split("\n");
	const [start, end] = evidence.line_range;
	if (start < 1 || end < start || end > lines.length) return { status: "range-out-of-bounds" };
	return tokenOverlapSimilarity(lines.slice(start - 1, end).join("\n"), evidence.snippet) >= policy.snippet_similarity_threshold ? { status: "match" } : { status: "mismatch" };
}
function safeRelativeEvidencePath(file) {
	if (!file || isAbsolute(file) || win32.isAbsolute(file)) return false;
	const normalized = file.replace(/\\/g, "/");
	return !normalized.split("/").some((segment) => segment === "..") && !normalized.startsWith("/");
}
function tokenOverlapSimilarity(a, b) {
	const aTokens = tokenize(a);
	const bTokens = tokenize(b);
	if (aTokens.length === 0 || bTokens.length === 0) return 0;
	const counts = /* @__PURE__ */ new Map();
	for (const token of aTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	let overlap = 0;
	for (const token of bTokens) {
		const count = counts.get(token) ?? 0;
		if (count > 0) {
			overlap += 1;
			counts.set(token, count - 1);
		}
	}
	return overlap / Math.max(aTokens.length, bTokens.length);
}
function tokenize(text) {
	return text.replace(/\r\n/g, "\n").replace(/['"`]/g, "\"").replace(/\s+/g, " ").trim().match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
}
//#endregion
//#region src/verify/verify-induction.ts
function verifyInductionForDocument(rccl, policy = DEFAULT_VERIFICATION_POLICY) {
	return {
		...rccl,
		observations: rccl.observations.map((observation) => verifyObservationInduction(observation, policy))
	};
}
function verifyObservationInduction(observation, policy = DEFAULT_VERIFICATION_POLICY) {
	const evidenceCount = observation.verification.evidence_verified_count ?? 0;
	const minRequired = minimumEvidence(observation, policy);
	const distinctFiles = new Set(observation.evidence.map((item) => item.file.replace(/\\/g, "/"))).size;
	const distinctRoots = new Set(observation.evidence.map((item) => item.file.replace(/\\/g, "/").split("/")[0])).size;
	let induction_status = "well-supported";
	let induction_confidence = observation.verification.evidence_confidence ?? 0;
	if (observation.support.scope_basis === "cross-root" && (evidenceCount < 3 || distinctFiles < 3 || distinctRoots < 2)) {
		induction_status = "overgeneralized";
		induction_confidence = Math.min(induction_confidence, .35);
	} else if ((observation.support.scope_basis === "directory-cluster" || observation.support.scope_basis === "module-cluster") && (evidenceCount < 2 || distinctFiles < 2)) {
		induction_status = "overgeneralized";
		induction_confidence = Math.min(induction_confidence, .35);
	} else if (evidenceCount < minRequired) {
		induction_status = "narrowly-supported";
		induction_confidence = Math.min(induction_confidence, .55);
	}
	let disposition = observation.verification.disposition ?? "keep";
	if (induction_status === "overgeneralized") disposition = "demote-to-ambient";
	else if (induction_status === "narrowly-supported" && disposition === "keep") disposition = "keep-with-reduced-confidence";
	return {
		...observation,
		verification: {
			...observation.verification,
			induction_status,
			induction_confidence: Number(induction_confidence.toFixed(2)),
			disposition
		}
	};
}
function minimumEvidence(observation, policy) {
	if (observation.category === "anti-pattern") return policy.anti_pattern_min_evidence;
	if (observation.category === "migration") return policy.migration_min_evidence;
	return 1;
}
//#endregion
export { DEFAULT_SAMPLING_POLICY as a, RCCL_SCOPE_BASES as c, parseYaml as d, toYaml as f, verifyObservationEvidence as i, validateCandidateObservationRecord as l, verifyObservationInduction as n, parseRccl as o, verifyEvidenceForDocument as r, parseRcclCandidates as s, verifyInductionForDocument as t, validateCandidateObservationShape as u };
