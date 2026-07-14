import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import YAML from "yaml";
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
//#region src/types.ts
const RCCL_CATEGORIES = [
	"architecture",
	"constraint",
	"compatibility",
	"legacy",
	"anti-pattern",
	"migration",
	"convention"
];
const DECISION_DIMENSIONS = [
	"compatibility",
	"api-shape",
	"architecture-boundary",
	"data-flow",
	"migration",
	"testing",
	"error-handling",
	"module-format",
	"review-focus"
];
//#endregion
//#region src/parse.ts
const OBSERVATION_ID = /^obs-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function parseRcclDocument(text) {
	const parsed = parseText(text);
	if (!parsed.value) return {
		valid: false,
		diagnostics: parsed.diagnostics
	};
	const diagnostics = validateDocument(parsed.value);
	if (diagnostics.length) return {
		valid: false,
		diagnostics
	};
	return {
		valid: true,
		data: normalizeDocument(parsed.value),
		diagnostics: []
	};
}
function parseCalibrationProposal(input) {
	const parsed = typeof input === "string" ? parseText(input) : {
		value: input,
		diagnostics: []
	};
	if (!parsed.value) return {
		valid: false,
		diagnostics: parsed.diagnostics
	};
	if (!isRecord(parsed.value)) return {
		valid: false,
		diagnostics: [diagnostic("", "MALFORMED_PROPOSAL", "Proposal must be an object.")]
	};
	const value = parsed.value;
	const diagnostics = [];
	if (value.schemaVersion !== "1.0") diagnostics.push(diagnostic("schemaVersion", "UNSUPPORTED_SCHEMA_VERSION", `Expected 1.0.`));
	if (!nonEmpty(value.requestId)) diagnostics.push(diagnostic("requestId", "MISSING_REQUEST_ID", "requestId is required."));
	if (!nonEmpty(value.contextFingerprint)) diagnostics.push(diagnostic("contextFingerprint", "MISSING_CONTEXT_FINGERPRINT", "contextFingerprint is required."));
	if (!Array.isArray(value.observations)) diagnostics.push(diagnostic("observations", "INVALID_OBSERVATIONS", "observations must be an array."));
	const observations = Array.isArray(value.observations) ? value.observations : [];
	const ids = /* @__PURE__ */ new Set();
	observations.forEach((observation, index) => {
		diagnostics.push(...validateProposalObservation(observation, index));
		if (isRecord(observation) && typeof observation.id === "string") {
			if (ids.has(observation.id)) diagnostics.push(diagnostic(`observations[${index}].id`, "DUPLICATE_ID", `Duplicate observation id ${observation.id}.`));
			ids.add(observation.id);
		}
	});
	if (diagnostics.length) return {
		valid: false,
		diagnostics
	};
	return {
		valid: true,
		diagnostics: [],
		data: {
			schemaVersion: "1.0",
			requestId: String(value.requestId),
			contextFingerprint: String(value.contextFingerprint),
			observations: observations.map(normalizeProposalObservation),
			...value.replace === true ? { replace: true } : {}
		}
	};
}
function validateDocument(value) {
	if (!isRecord(value)) return [diagnostic("", "MALFORMED_DOCUMENT", "RCCL must be an object.")];
	const diagnostics = [];
	if (value.version !== "1.0") diagnostics.push(diagnostic("version", "UNSUPPORTED_SCHEMA_VERSION", `Expected RCCL 1.0.`));
	if (!Array.isArray(value.observations)) diagnostics.push(diagnostic("observations", "INVALID_OBSERVATIONS", "observations must be an array."));
	const ids = /* @__PURE__ */ new Set();
	for (const [index, item] of (Array.isArray(value.observations) ? value.observations : []).entries()) {
		diagnostics.push(...validateFinalObservation(item, index));
		if (isRecord(item) && typeof item.id === "string") {
			if (ids.has(item.id)) diagnostics.push(diagnostic(`observations[${index}].id`, "DUPLICATE_ID", `Duplicate observation id ${item.id}.`));
			ids.add(item.id);
		}
	}
	return diagnostics;
}
function validateProposalObservation(value, index) {
	if (!isRecord(value)) return [diagnostic(`observations[${index}]`, "MALFORMED_OBSERVATION", "Observation must be an object.")];
	const prefix = `observations[${index}]`;
	const diagnostics = validateObservationCore(value, prefix);
	for (const forbidden of ["evidenceVerification", "lifecycle"]) if (forbidden in value) diagnostics.push(diagnostic(`${prefix}.${forbidden}`, "RUNTIME_OWNED_FIELD", `${forbidden} is RCCL-owned and cannot be proposed.`));
	return diagnostics;
}
function validateFinalObservation(value, index) {
	if (!isRecord(value)) return [diagnostic(`observations[${index}]`, "MALFORMED_OBSERVATION", "Observation must be an object.")];
	const prefix = `observations[${index}]`;
	const diagnostics = validateObservationCore(value, prefix);
	if (!isRecord(value.evidenceVerification)) diagnostics.push(diagnostic(`${prefix}.evidenceVerification`, "MISSING_EVIDENCE_STATUS", "evidenceVerification is required."));
	else {
		const verification = value.evidenceVerification;
		if (![
			"current",
			"partial",
			"stale",
			"broken"
		].includes(String(verification.status))) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.status`, "INVALID_EVIDENCE_STATUS", "Invalid evidence status."));
		if (!Number.isInteger(verification.verifiedCount) || Number(verification.verifiedCount) < 0) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.verifiedCount`, "INVALID_COUNT", "verifiedCount must be a non-negative integer."));
		if (!Number.isInteger(verification.totalCount) || Number(verification.totalCount) < 0) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.totalCount`, "INVALID_COUNT", "totalCount must be a non-negative integer."));
		if (!nonEmpty(verification.checkedAt)) diagnostics.push(diagnostic(`${prefix}.evidenceVerification.checkedAt`, "MISSING_CHECKED_AT", "checkedAt is required."));
	}
	if (!isRecord(value.lifecycle)) diagnostics.push(diagnostic(`${prefix}.lifecycle`, "MISSING_LIFECYCLE", "lifecycle is required."));
	else {
		if (![
			"active",
			"stale",
			"superseded"
		].includes(String(value.lifecycle.status))) diagnostics.push(diagnostic(`${prefix}.lifecycle.status`, "INVALID_LIFECYCLE", "Invalid lifecycle status."));
		if (!nonEmpty(value.lifecycle.contentFingerprint)) diagnostics.push(diagnostic(`${prefix}.lifecycle.contentFingerprint`, "MISSING_FINGERPRINT", "contentFingerprint is required."));
	}
	return diagnostics;
}
function validateObservationCore(value, prefix) {
	const diagnostics = [];
	if ("traits" in value) diagnostics.push(diagnostic(`${prefix}.traits`, "UNSUPPORTED_FIELD", "RCCL uses category and affects directly; traits are not supported."));
	if (typeof value.id !== "string" || !OBSERVATION_ID.test(value.id)) diagnostics.push(diagnostic(`${prefix}.id`, "INVALID_ID", "id must match obs-<kebab-case>."));
	if (!RCCL_CATEGORIES.includes(value.category)) diagnostics.push(diagnostic(`${prefix}.category`, "INVALID_CATEGORY", `category must be one of ${RCCL_CATEGORIES.join(", ")}.`));
	if (!nonEmpty(value.scope)) diagnostics.push(diagnostic(`${prefix}.scope`, "INVALID_SCOPE", "scope is required."));
	if (!nonEmpty(value.statement)) diagnostics.push(diagnostic(`${prefix}.statement`, "INVALID_STATEMENT", "statement is required."));
	if (!nonEmpty(value.decisionImpact)) diagnostics.push(diagnostic(`${prefix}.decisionImpact`, "MISSING_DECISION_IMPACT", "Explain how removing this observation could worsen a code decision."));
	if (![
		"low",
		"medium",
		"high"
	].includes(String(value.semanticConfidence))) diagnostics.push(diagnostic(`${prefix}.semanticConfidence`, "INVALID_SEMANTIC_CONFIDENCE", "semanticConfidence must be low, medium, or high."));
	if (value.reviewStatus !== void 0 && !["generated", "reviewed"].includes(String(value.reviewStatus))) diagnostics.push(diagnostic(`${prefix}.reviewStatus`, "INVALID_REVIEW_STATUS", "reviewStatus must be generated or reviewed."));
	if (!Array.isArray(value.affects) || value.affects.length === 0) diagnostics.push(diagnostic(`${prefix}.affects`, "MISSING_DECISION_DIMENSION", "affects must contain at least one decision dimension."));
	else value.affects.forEach((dimension, index) => {
		if (!DECISION_DIMENSIONS.includes(dimension)) diagnostics.push(diagnostic(`${prefix}.affects[${index}]`, "INVALID_DECISION_DIMENSION", `Unknown decision dimension ${String(dimension)}.`));
	});
	if (!Array.isArray(value.evidence) || value.evidence.length === 0) diagnostics.push(diagnostic(`${prefix}.evidence`, "MISSING_EVIDENCE", "evidence must be non-empty."));
	else value.evidence.forEach((evidence, index) => diagnostics.push(...validateEvidence(evidence, `${prefix}.evidence[${index}]`)));
	return diagnostics;
}
function validateEvidence(value, prefix) {
	if (!isRecord(value)) return [diagnostic(prefix, "MALFORMED_EVIDENCE", "Evidence must be an object.")];
	const diagnostics = [];
	if (!nonEmpty(value.file)) diagnostics.push(diagnostic(`${prefix}.file`, "INVALID_FILE", "file is required."));
	if (!Array.isArray(value.lineRange) || value.lineRange.length !== 2 || !value.lineRange.every(Number.isInteger)) diagnostics.push(diagnostic(`${prefix}.lineRange`, "INVALID_LINE_RANGE", "lineRange must be [start, end]."));
	if (!nonEmpty(value.snippet)) diagnostics.push(diagnostic(`${prefix}.snippet`, "INVALID_SNIPPET", "snippet is required."));
	return diagnostics;
}
function normalizeDocument(value) {
	return {
		version: "1.0",
		generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
		gitRef: typeof value.gitRef === "string" ? value.gitRef : null,
		observations: value.observations.map((item) => normalizeFinalObservation(item))
	};
}
function normalizeFinalObservation(value) {
	const proposal = normalizeProposalObservation(value);
	const verification = value.evidenceVerification;
	const lifecycle = value.lifecycle;
	return {
		...proposal,
		reviewStatus: proposal.reviewStatus ?? "generated",
		evidenceVerification: {
			status: verification.status,
			verifiedCount: Number(verification.verifiedCount),
			totalCount: Number(verification.totalCount),
			checkedAt: String(verification.checkedAt)
		},
		lifecycle: {
			status: lifecycle.status,
			contentFingerprint: String(lifecycle.contentFingerprint),
			firstSeenGitRef: typeof lifecycle.firstSeenGitRef === "string" ? lifecycle.firstSeenGitRef : null,
			lastSeenGitRef: typeof lifecycle.lastSeenGitRef === "string" ? lifecycle.lastSeenGitRef : null,
			lastVerifiedAt: String(lifecycle.lastVerifiedAt ?? verification.checkedAt),
			...typeof lifecycle.supersededBy === "string" ? { supersededBy: lifecycle.supersededBy } : {}
		}
	};
}
function normalizeProposalObservation(value) {
	const item = value;
	return {
		id: String(item.id),
		category: item.category,
		scope: String(item.scope).replace(/\\/g, "/"),
		statement: String(item.statement).trim(),
		affects: [...new Set(item.affects.map(String))].sort(),
		decisionImpact: String(item.decisionImpact).trim(),
		semanticConfidence: item.semanticConfidence,
		reviewStatus: item.reviewStatus ?? "generated",
		evidence: item.evidence.map(normalizeEvidence)
	};
}
function normalizeEvidence(value) {
	const item = value;
	return {
		file: String(item.file).replace(/\\/g, "/"),
		lineRange: [Number(item.lineRange[0]), Number(item.lineRange[1])],
		snippet: String(item.snippet)
	};
}
function parseText(text) {
	try {
		return {
			value: parseYaml(text.trim().replace(/^```(?:ya?ml|json)?\s*/i, "").replace(/```\s*$/, "")),
			diagnostics: []
		};
	} catch (error) {
		return { diagnostics: [diagnostic("", "PARSE_ERROR", error instanceof Error ? error.message : String(error))] };
	}
}
function diagnostic(path, code, message) {
	return {
		path,
		code,
		message
	};
}
function nonEmpty(value) {
	return typeof value === "string" && Boolean(value.trim());
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//#endregion
//#region src/evidence.ts
function verifyEvidence(evidence, projectRoot) {
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
	const lines = readFileSync(realFile, "utf8").replace(/\r\n/g, "\n").split("\n");
	const [start, end] = evidence.lineRange;
	if (start < 1 || end < start || end > lines.length) return { status: "range-out-of-bounds" };
	return tokenOverlapSimilarity(lines.slice(start - 1, end).join("\n"), evidence.snippet) >= .75 ? { status: "match" } : { status: "mismatch" };
}
function safeRelativeEvidencePath(file) {
	if (!file || isAbsolute(file) || win32.isAbsolute(file)) return false;
	const normalized = file.replace(/\\/g, "/");
	return !normalized.split("/").some((segment) => segment === "..") && !normalized.startsWith("/");
}
function tokenOverlapSimilarity(left, right) {
	const leftTokens = tokenize(left);
	const rightTokens = tokenize(right);
	if (!leftTokens.length || !rightTokens.length) return 0;
	const counts = /* @__PURE__ */ new Map();
	for (const token of leftTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	let overlap = 0;
	for (const token of rightTokens) {
		const count = counts.get(token) ?? 0;
		if (count > 0) {
			overlap += 1;
			counts.set(token, count - 1);
		}
	}
	return overlap / Math.max(leftTokens.length, rightTokens.length);
}
function tokenize(text) {
	return text.replace(/\r\n/g, "\n").replace(/['"`]/g, "\"").replace(/\s+/g, " ").trim().match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
}
//#endregion
export { toYaml as i, parseCalibrationProposal as n, parseRcclDocument as r, verifyEvidence as t };
