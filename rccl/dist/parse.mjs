import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import YAML from "yaml";
//#region src/evidence.ts
function verifyEvidence(evidence, projectRoot) {
	const read = readEvidenceWindow(evidence, projectRoot);
	if (read.status !== "match") return { status: read.status };
	return tokenOverlapSimilarity(read.snippet, evidence.snippet) >= .75 ? { status: "match" } : { status: "mismatch" };
}
function readEvidenceWindow(selection, projectRoot) {
	if (!safeRelativeEvidencePath(selection.file)) return { status: "path-outside-project" };
	let root;
	try {
		root = realpathSync(resolve(projectRoot));
	} catch {
		return { status: "path-outside-project" };
	}
	const fullPath = resolve(root, selection.file);
	if (!existsSync(fullPath)) return { status: "file-not-found" };
	let realFile;
	try {
		realFile = realpathSync(fullPath);
	} catch {
		return { status: "file-not-found" };
	}
	const rel = relative(root, realFile);
	if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) return { status: "path-outside-project" };
	let content;
	try {
		content = readFileSync(realFile, "utf8").replace(/\r\n/g, "\n");
	} catch {
		return { status: "file-not-found" };
	}
	const lines = content.split("\n");
	const [start, end] = selection.lineRange;
	if (start < 1 || end < start || end > lines.length) return { status: "range-out-of-bounds" };
	return {
		status: "match",
		snippet: lines.slice(start - 1, end).join("\n")
	};
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
//#region src/verify.ts
function materializeVerifiedObservation(content, projectRoot, gitRef, prior, now = /* @__PURE__ */ new Date()) {
	const checkedAt = now.toISOString();
	const verifiedCount = content.evidence.map((evidence) => verifyEvidence(evidence, projectRoot)).filter((result) => result.status === "match").length;
	const status = verifiedCount === content.evidence.length ? "current" : verifiedCount > 0 ? "partial" : prior?.evidenceVerification.status === "current" || prior?.evidenceVerification.status === "partial" ? "stale" : "broken";
	const lifecycleStatus = status === "stale" || status === "broken" ? "stale" : "active";
	const contentFingerprint = observationFingerprint(content);
	const approval = prior?.reviewStatus === "reviewed" && prior.approval?.contentFingerprint === contentFingerprint && prior.lifecycle.contentFingerprint === contentFingerprint ? prior.approval : void 0;
	return {
		...content,
		reviewStatus: approval ? "reviewed" : "generated",
		...approval ? { approval } : {},
		evidenceVerification: {
			status,
			verifiedCount,
			totalCount: content.evidence.length,
			checkedAt
		},
		lifecycle: {
			status: prior?.lifecycle.status === "superseded" ? "superseded" : lifecycleStatus,
			contentFingerprint,
			firstSeenGitRef: prior?.lifecycle.firstSeenGitRef ?? gitRef,
			lastSeenGitRef: gitRef,
			lastVerifiedAt: checkedAt,
			...prior?.lifecycle.supersededBy ? { supersededBy: prior.lifecycle.supersededBy } : {}
		}
	};
}
function refreshObservationEvidence(observation, projectRoot, gitRef, now = /* @__PURE__ */ new Date()) {
	return materializeVerifiedObservation(observationContent(observation), projectRoot, gitRef, observation, now);
}
function observationFingerprint(observation) {
	return createHash("sha256").update(JSON.stringify({
		id: observation.id,
		category: observation.category,
		scope: observation.scope,
		statement: observation.statement,
		affects: observation.affects,
		decisionImpact: observation.decisionImpact,
		semanticConfidence: observation.semanticConfidence,
		evidence: observation.evidence
	})).digest("hex");
}
function observationContent(observation) {
	return {
		id: observation.id,
		category: observation.category,
		scope: observation.scope,
		statement: observation.statement,
		affects: observation.affects,
		decisionImpact: observation.decisionImpact,
		semanticConfidence: observation.semanticConfidence,
		evidence: observation.evidence
	};
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
const WINDOW_ID = /^window:[a-f0-9]{64}$/;
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
function parseCalibrationContract(input) {
	if (!isRecord(input)) return {
		valid: false,
		diagnostics: [diagnostic("contract", "MALFORMED_CONTRACT", "Calibration contract must be an object.")]
	};
	const value = input;
	const diagnostics = [];
	if (value.schemaVersion !== "1.0") diagnostics.push(diagnostic("contract.schemaVersion", "UNSUPPORTED_SCHEMA_VERSION", `Expected 1.0.`));
	if (!nonEmpty(value.requestId)) diagnostics.push(diagnostic("contract.requestId", "MISSING_REQUEST_ID", "requestId is required."));
	if (!nonEmpty(value.contextFingerprint)) diagnostics.push(diagnostic("contract.contextFingerprint", "MISSING_CONTEXT_FINGERPRINT", "contextFingerprint is required."));
	if (!Array.isArray(value.evidenceWindows) || value.evidenceWindows.length === 0) diagnostics.push(diagnostic("contract.evidenceWindows", "MISSING_EVIDENCE_WINDOWS", "At least one explicit evidence window is required."));
	else {
		const ids = /* @__PURE__ */ new Set();
		value.evidenceWindows.forEach((window, index) => {
			diagnostics.push(...validateContractWindow(window, index));
			if (isRecord(window) && typeof window.windowId === "string") {
				if (ids.has(window.windowId)) diagnostics.push(diagnostic(`contract.evidenceWindows[${index}].windowId`, "DUPLICATE_WINDOW_ID", `Duplicate window id ${window.windowId}.`));
				ids.add(window.windowId);
			}
		});
	}
	if (!nonEmpty(value.prompt)) diagnostics.push(diagnostic("contract.prompt", "MISSING_PROMPT", "prompt is required."));
	if (!nonEmpty(value.proposalSchema)) diagnostics.push(diagnostic("contract.proposalSchema", "MISSING_PROPOSAL_SCHEMA", "proposalSchema is required."));
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
			evidenceWindows: value.evidenceWindows.map(normalizeContractWindow),
			prompt: String(value.prompt),
			proposalSchema: String(value.proposalSchema)
		}
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
	for (const forbidden of [
		"reviewStatus",
		"approval",
		"evidenceVerification",
		"lifecycle"
	]) if (forbidden in value) diagnostics.push(diagnostic(`${prefix}.${forbidden}`, "RUNTIME_OWNED_FIELD", `${forbidden} is RCCL-owned and cannot be proposed.`));
	if (!Array.isArray(value.evidence) || value.evidence.length === 0) diagnostics.push(diagnostic(`${prefix}.evidence`, "MISSING_EVIDENCE", "evidence must reference at least one supplied window."));
	else {
		const ids = /* @__PURE__ */ new Set();
		value.evidence.forEach((evidence, evidenceIndex) => {
			diagnostics.push(...validateEvidenceProposal(evidence, `${prefix}.evidence[${evidenceIndex}]`));
			if (isRecord(evidence) && typeof evidence.windowId === "string") {
				if (ids.has(evidence.windowId)) diagnostics.push(diagnostic(`${prefix}.evidence[${evidenceIndex}].windowId`, "DUPLICATE_EVIDENCE_WINDOW", `Duplicate evidence window ${evidence.windowId}.`));
				ids.add(evidence.windowId);
			}
		});
	}
	return diagnostics;
}
function validateFinalObservation(value, index) {
	if (!isRecord(value)) return [diagnostic(`observations[${index}]`, "MALFORMED_OBSERVATION", "Observation must be an object.")];
	const prefix = `observations[${index}]`;
	const diagnostics = validateObservationCore(value, prefix);
	if (!Array.isArray(value.evidence) || value.evidence.length === 0) diagnostics.push(diagnostic(`${prefix}.evidence`, "MISSING_EVIDENCE", "evidence must be non-empty."));
	else value.evidence.forEach((evidence, evidenceIndex) => diagnostics.push(...validateEvidence(evidence, `${prefix}.evidence[${evidenceIndex}]`)));
	if (!["generated", "reviewed"].includes(String(value.reviewStatus))) diagnostics.push(diagnostic(`${prefix}.reviewStatus`, "INVALID_REVIEW_STATUS", "reviewStatus must be generated or reviewed."));
	if (value.reviewStatus === "generated" && value.approval !== void 0) diagnostics.push(diagnostic(`${prefix}.approval`, "UNEXPECTED_APPROVAL", "Generated observations cannot carry approval provenance."));
	if (value.reviewStatus === "reviewed") diagnostics.push(...validateApproval(value.approval, `${prefix}.approval`));
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
	if (diagnostics.length === 0) {
		const normalized = normalizeFinalObservation(value);
		const expectedFingerprint = observationFingerprint(normalized);
		if (normalized.lifecycle.contentFingerprint !== expectedFingerprint) diagnostics.push(diagnostic(`${prefix}.lifecycle.contentFingerprint`, "CONTENT_FINGERPRINT_MISMATCH", "Observation content changed without regenerating its lifecycle fingerprint."));
		if (normalized.reviewStatus === "reviewed" && normalized.approval?.contentFingerprint !== expectedFingerprint) diagnostics.push(diagnostic(`${prefix}.approval.contentFingerprint`, "APPROVAL_FINGERPRINT_MISMATCH", "Approval does not apply to the current observation content."));
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
	if (!Array.isArray(value.affects) || value.affects.length === 0) diagnostics.push(diagnostic(`${prefix}.affects`, "MISSING_DECISION_DIMENSION", "affects must contain at least one decision dimension."));
	else value.affects.forEach((dimension, dimensionIndex) => {
		if (!DECISION_DIMENSIONS.includes(dimension)) diagnostics.push(diagnostic(`${prefix}.affects[${dimensionIndex}]`, "INVALID_DECISION_DIMENSION", `Unknown decision dimension ${String(dimension)}.`));
	});
	return diagnostics;
}
function validateContractWindow(value, index) {
	const prefix = `contract.evidenceWindows[${index}]`;
	if (!isRecord(value)) return [diagnostic(prefix, "MALFORMED_EVIDENCE_WINDOW", "Evidence window must be an object.")];
	const diagnostics = validateEvidence(value, prefix);
	if (typeof value.windowId !== "string" || !WINDOW_ID.test(value.windowId)) diagnostics.push(diagnostic(`${prefix}.windowId`, "INVALID_WINDOW_ID", "windowId must be a SHA-256 contract window identifier."));
	return diagnostics;
}
function validateEvidenceProposal(value, prefix) {
	if (!isRecord(value)) return [diagnostic(prefix, "MALFORMED_EVIDENCE", "Evidence must be an object containing one windowId.")];
	const diagnostics = [];
	if (typeof value.windowId !== "string" || !WINDOW_ID.test(value.windowId)) diagnostics.push(diagnostic(`${prefix}.windowId`, "INVALID_WINDOW_ID", "windowId must reference a supplied contract window."));
	for (const key of Object.keys(value)) if (key !== "windowId") diagnostics.push(diagnostic(`${prefix}.${key}`, "UNSUPPORTED_EVIDENCE_FIELD", "Proposal evidence may contain only windowId."));
	return diagnostics;
}
function validateEvidence(value, prefix) {
	if (!isRecord(value)) return [diagnostic(prefix, "MALFORMED_EVIDENCE", "Evidence must be an object.")];
	const diagnostics = [];
	if (!nonEmpty(value.file)) diagnostics.push(diagnostic(`${prefix}.file`, "INVALID_FILE", "file is required."));
	if (!validLineRange(value.lineRange)) diagnostics.push(diagnostic(`${prefix}.lineRange`, "INVALID_LINE_RANGE", "lineRange must be positive [start, end] with end >= start."));
	if (!nonEmpty(value.snippet)) diagnostics.push(diagnostic(`${prefix}.snippet`, "INVALID_SNIPPET", "snippet is required."));
	return diagnostics;
}
function validateApproval(value, prefix) {
	if (!isRecord(value)) return [diagnostic(prefix, "MISSING_APPROVAL", "Reviewed observations require approval provenance.")];
	const diagnostics = [];
	if (!nonEmpty(value.approvedBy)) diagnostics.push(diagnostic(`${prefix}.approvedBy`, "MISSING_APPROVER", "approvedBy is required."));
	if (!nonEmpty(value.approvedAt) || Number.isNaN(Date.parse(String(value.approvedAt)))) diagnostics.push(diagnostic(`${prefix}.approvedAt`, "INVALID_APPROVAL_TIME", "approvedAt must be an ISO-compatible timestamp."));
	if (!nonEmpty(value.contentFingerprint)) diagnostics.push(diagnostic(`${prefix}.contentFingerprint`, "MISSING_APPROVAL_FINGERPRINT", "contentFingerprint is required."));
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
	const content = normalizeObservationContent(value);
	const verification = value.evidenceVerification;
	const lifecycle = value.lifecycle;
	const approval = value.approval;
	return {
		...content,
		reviewStatus: value.reviewStatus,
		...approval ? { approval: {
			approvedBy: String(approval.approvedBy).trim(),
			approvedAt: String(approval.approvedAt),
			contentFingerprint: String(approval.contentFingerprint)
		} } : {},
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
function normalizeObservationContent(value) {
	return {
		id: String(value.id),
		category: value.category,
		scope: String(value.scope).replace(/\\/g, "/"),
		statement: String(value.statement).trim(),
		affects: [...new Set(value.affects.map(String))].sort(),
		decisionImpact: String(value.decisionImpact).trim(),
		semanticConfidence: value.semanticConfidence,
		evidence: value.evidence.map(normalizeEvidence)
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
		evidence: item.evidence.map(normalizeEvidenceProposal)
	};
}
function normalizeContractWindow(value) {
	const item = value;
	return {
		windowId: String(item.windowId),
		file: String(item.file).replace(/\\/g, "/"),
		lineRange: [Number(item.lineRange[0]), Number(item.lineRange[1])],
		snippet: String(item.snippet)
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
function normalizeEvidenceProposal(value) {
	return { windowId: String(value.windowId) };
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
function validLineRange(value) {
	return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger) && Number(value[0]) >= 1 && Number(value[1]) >= Number(value[0]);
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
export { refreshObservationEvidence as a, safeRelativeEvidencePath as c, materializeVerifiedObservation as i, verifyEvidence as l, parseCalibrationProposal as n, toYaml as o, parseRcclDocument as r, readEvidenceWindow as s, parseCalibrationContract as t };
