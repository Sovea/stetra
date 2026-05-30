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
export { RCCL_ADHERENCE_QUALITIES, RCCL_CATEGORIES, RCCL_OBSERVATION_ID_PATTERN, RCCL_SCOPE_BASES, validateCandidateObservationRecord, validateCandidateObservationShape, validateEvidenceSnippet, validateTraitsRecord };
