import { a as refreshObservationEvidence, c as safeRelativeEvidencePath, i as materializeVerifiedObservation, n as parseCalibrationProposal, o as toYaml, r as parseRcclDocument, s as readEvidenceWindow, t as parseCalibrationContract } from "./parse.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
//#region src/lifecycle.ts
const MAX_EVIDENCE_WINDOWS = 20;
const MAX_LINES_PER_WINDOW = 200;
const MAX_TOTAL_EVIDENCE_BYTES = 128 * 1024;
function prepareCalibration(input) {
	const projectRoot = resolve(input.projectRoot);
	const selected = normalizeSelections(input.evidenceSelections);
	if (selected.diagnostics.length) return {
		status: "rejected",
		diagnostics: selected.diagnostics
	};
	const diagnostics = [];
	const windows = [];
	let totalBytes = 0;
	for (const [index, selection] of selected.selections.entries()) {
		const read = readEvidenceWindow(selection, projectRoot);
		if (read.status !== "match") {
			diagnostics.push({
				path: `evidenceSelections[${index}]`,
				code: `EVIDENCE_${read.status.toUpperCase().replace(/-/g, "_")}`,
				message: `${selection.file}:${selection.lineRange[0]}-${selection.lineRange[1]} could not be read as an in-project source window.`
			});
			continue;
		}
		if (!read.snippet.trim() || read.snippet.includes("\0")) {
			diagnostics.push({
				path: `evidenceSelections[${index}]`,
				code: "UNSUPPORTED_EVIDENCE_CONTENT",
				message: "Evidence windows must contain non-empty text without NUL bytes."
			});
			continue;
		}
		totalBytes += Buffer.byteLength(read.snippet, "utf8");
		windows.push({
			...selection,
			windowId: windowId(selection, read.snippet),
			snippet: read.snippet
		});
	}
	if (totalBytes > MAX_TOTAL_EVIDENCE_BYTES) diagnostics.push({
		path: "evidenceSelections",
		code: "EVIDENCE_BYTES_EXCEEDED",
		message: `Selected evidence is ${totalBytes} bytes; the operational limit is ${MAX_TOTAL_EVIDENCE_BYTES} bytes.`
	});
	if (diagnostics.length) return {
		status: "rejected",
		diagnostics
	};
	const prompt = buildPrompt(windows);
	const schema = proposalSchema();
	const contextFingerprint = contractFingerprint(windows, prompt, schema);
	return {
		status: "ready",
		contract: {
			schemaVersion: "1.0",
			requestId: `rccl-calibration:${contextFingerprint}`,
			contextFingerprint,
			evidenceWindows: windows,
			prompt,
			proposalSchema: schema
		},
		context: {
			files: new Set(windows.map((window) => window.file)).size,
			windows
		},
		diagnostics: []
	};
}
function commitCalibration(input) {
	const projectRoot = resolve(input.projectRoot);
	const parsedContract = parseCalibrationContract(input.contract);
	if (!parsedContract.valid || !parsedContract.data) return rejected(parsedContract.diagnostics, proposalCount(input.proposal));
	const contractDiagnostics = verifyContract(parsedContract.data, projectRoot);
	if (contractDiagnostics.length) return rejected(contractDiagnostics, proposalCount(input.proposal));
	const parsed = parseCalibrationProposal(input.proposal);
	const proposedCount = parsed.data?.observations.length ?? proposalCount(input.proposal);
	if (!parsed.valid || !parsed.data) return rejected(parsed.diagnostics, proposedCount);
	const identityDiagnostics = validateIdentity(parsed.data, parsedContract.data);
	if (identityDiagnostics.length) return rejected(identityDiagnostics, proposedCount);
	const resolved = resolveProposalEvidence(parsed.data.observations, parsedContract.data);
	if (resolved.diagnostics.length) return rejected(resolved.diagnostics, proposedCount);
	const rcclPath = resolve(input.rcclPath ?? join(projectRoot, ".resonant-code", "rccl.yaml"));
	const existing = loadExistingDocument(rcclPath);
	if (existing.diagnostics.length) return rejected(existing.diagnostics, proposedCount);
	const gitRef = currentGitRef(projectRoot);
	const existingById = new Map(existing.document?.observations.map((observation) => [observation.id, observation]) ?? []);
	const verified = resolved.observations.map((content) => materializeVerifiedObservation(content, projectRoot, gitRef, existingById.get(content.id)));
	const verifiedById = new Map(verified.map((observation) => [observation.id, observation]));
	const observations = parsed.data.replace ? verified : [...(existing.document?.observations ?? []).filter((observation) => !verifiedById.has(observation.id)), ...verified].sort((left, right) => left.id.localeCompare(right.id));
	const document = {
		version: "1.0",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		gitRef,
		observations
	};
	writeYamlAtomic(rcclPath, document);
	return {
		status: "committed",
		written: rcclPath,
		document,
		diagnostics: verificationDiagnostics(verified),
		summary: summarize(proposedCount, verified, 0)
	};
}
function approveContext(input) {
	const projectRoot = resolve(input.projectRoot);
	const rcclPath = resolve(input.rcclPath ?? join(projectRoot, ".resonant-code", "rccl.yaml"));
	const approvedBy = input.approvedBy?.trim();
	const observationIds = [...new Set(input.observationIds ?? [])].sort();
	const inputDiagnostics = [];
	if (!approvedBy) inputDiagnostics.push({
		path: "approvedBy",
		code: "MISSING_APPROVER",
		message: "approvedBy is required."
	});
	if (observationIds.length === 0) inputDiagnostics.push({
		path: "observationIds",
		code: "MISSING_OBSERVATION_IDS",
		message: "At least one observation ID is required."
	});
	if (!existsSync(rcclPath)) inputDiagnostics.push({
		path: "rcclPath",
		code: "RCCL_NOT_FOUND",
		message: `RCCL document does not exist at ${rcclPath}.`
	});
	if (inputDiagnostics.length) return approvalRejected(inputDiagnostics);
	const parsed = parseRcclDocument(readFileSync(rcclPath, "utf8"));
	if (!parsed.valid || !parsed.data) return approvalRejected(parsed.diagnostics);
	const byId = new Map(parsed.data.observations.map((observation) => [observation.id, observation]));
	const diagnostics = [];
	for (const id of observationIds) {
		const observation = byId.get(id);
		if (!observation) diagnostics.push({
			path: `observationIds.${id}`,
			code: "OBSERVATION_NOT_FOUND",
			message: `Observation ${id} does not exist.`
		});
		else if (observation.lifecycle.status === "superseded") diagnostics.push({
			path: `observations.${id}.lifecycle`,
			code: "OBSERVATION_SUPERSEDED",
			message: `Observation ${id} is superseded and cannot be approved.`
		});
	}
	if (diagnostics.length) return approvalRejected(diagnostics);
	const unchangedObservationIds = observationIds.filter((id) => byId.get(id)?.reviewStatus === "reviewed");
	const pendingIds = observationIds.filter((id) => byId.get(id)?.reviewStatus !== "reviewed");
	if (pendingIds.length === 0) return {
		status: "approved",
		document: parsed.data,
		diagnostics: [],
		approvedObservationIds: [],
		unchangedObservationIds
	};
	const now = /* @__PURE__ */ new Date();
	const gitRef = currentGitRef(projectRoot);
	const refreshedById = new Map(pendingIds.map((id) => {
		return [id, refreshObservationEvidence(byId.get(id), projectRoot, gitRef, now)];
	}));
	for (const [id, observation] of refreshedById) if (observation.evidenceVerification.status !== "current" || observation.lifecycle.status !== "active") diagnostics.push({
		path: `observations.${id}.evidence`,
		code: "APPROVAL_REQUIRES_CURRENT_EVIDENCE",
		message: `Observation ${id} must have fully current evidence before approval.`
	});
	if (diagnostics.length) return approvalRejected(diagnostics);
	const approvedAt = now.toISOString();
	const observations = parsed.data.observations.map((observation) => {
		const refreshed = refreshedById.get(observation.id);
		if (!refreshed) return observation;
		return {
			...refreshed,
			reviewStatus: "reviewed",
			approval: {
				approvedBy,
				approvedAt,
				contentFingerprint: refreshed.lifecycle.contentFingerprint
			}
		};
	});
	const document = {
		...parsed.data,
		generatedAt: approvedAt,
		gitRef,
		observations
	};
	writeYamlAtomic(rcclPath, document);
	return {
		status: "approved",
		written: rcclPath,
		document,
		diagnostics: [],
		approvedObservationIds: pendingIds,
		unchangedObservationIds
	};
}
function validateContext(input) {
	const projectRoot = resolve(input.projectRoot);
	const rcclPath = resolve(input.rcclPath ?? join(projectRoot, ".resonant-code", "rccl.yaml"));
	if (!existsSync(rcclPath)) return {
		status: "missing",
		diagnostics: [],
		changedObservationIds: []
	};
	const parsed = parseRcclDocument(readFileSync(rcclPath, "utf8"));
	if (!parsed.valid || !parsed.data) return {
		status: "invalid",
		diagnostics: parsed.diagnostics,
		changedObservationIds: []
	};
	const gitRef = currentGitRef(projectRoot);
	const observations = parsed.data.observations.map((observation) => refreshObservationEvidence(observation, projectRoot, gitRef));
	const changedObservationIds = observations.filter((observation, index) => observation.evidenceVerification.status !== parsed.data.observations[index].evidenceVerification.status).map((observation) => observation.id);
	const document = {
		...parsed.data,
		generatedAt: input.write ? (/* @__PURE__ */ new Date()).toISOString() : parsed.data.generatedAt,
		gitRef,
		observations
	};
	if (input.write) writeYamlAtomic(rcclPath, document);
	return {
		status: "valid",
		document,
		diagnostics: verificationDiagnostics(observations),
		changedObservationIds
	};
}
function normalizeSelections(input) {
	if (!Array.isArray(input) || input.length === 0) return {
		selections: [],
		diagnostics: [{
			path: "evidenceSelections",
			code: "MISSING_EVIDENCE_SELECTIONS",
			message: "Select at least one exact repository evidence window; RCCL does not choose files or ranges."
		}]
	};
	if (input.length > MAX_EVIDENCE_WINDOWS) return {
		selections: [],
		diagnostics: [{
			path: "evidenceSelections",
			code: "TOO_MANY_EVIDENCE_WINDOWS",
			message: `Select at most ${MAX_EVIDENCE_WINDOWS} evidence windows per calibration request.`
		}]
	};
	const diagnostics = [];
	const selections = [];
	const keys = /* @__PURE__ */ new Set();
	for (const [index, raw] of input.entries()) {
		if (!raw || typeof raw !== "object") {
			diagnostics.push({
				path: `evidenceSelections[${index}]`,
				code: "MALFORMED_EVIDENCE_SELECTION",
				message: "Evidence selection must contain file and lineRange."
			});
			continue;
		}
		const file = typeof raw.file === "string" ? raw.file.trim().replace(/\\/g, "/").replace(/^\.\//, "") : "";
		const lineRange = raw.lineRange;
		if (!safeRelativeEvidencePath(file)) diagnostics.push({
			path: `evidenceSelections[${index}].file`,
			code: "INVALID_EVIDENCE_PATH",
			message: "Evidence file must be a safe repository-relative path."
		});
		if (!Array.isArray(lineRange) || lineRange.length !== 2 || !lineRange.every(Number.isInteger) || lineRange[0] < 1 || lineRange[1] < lineRange[0]) {
			diagnostics.push({
				path: `evidenceSelections[${index}].lineRange`,
				code: "INVALID_LINE_RANGE",
				message: "lineRange must be positive [start, end] with end >= start."
			});
			continue;
		}
		if (lineRange[1] - lineRange[0] + 1 > MAX_LINES_PER_WINDOW) diagnostics.push({
			path: `evidenceSelections[${index}].lineRange`,
			code: "EVIDENCE_WINDOW_TOO_LARGE",
			message: `One evidence window may contain at most ${MAX_LINES_PER_WINDOW} lines.`
		});
		const key = `${file}:${lineRange[0]}-${lineRange[1]}`;
		if (keys.has(key)) diagnostics.push({
			path: `evidenceSelections[${index}]`,
			code: "DUPLICATE_EVIDENCE_SELECTION",
			message: `Duplicate evidence selection ${key}.`
		});
		keys.add(key);
		selections.push({
			file,
			lineRange: [lineRange[0], lineRange[1]]
		});
	}
	selections.sort((left, right) => left.file.localeCompare(right.file) || left.lineRange[0] - right.lineRange[0] || left.lineRange[1] - right.lineRange[1]);
	return {
		selections,
		diagnostics
	};
}
function verifyContract(contract, projectRoot) {
	const diagnostics = [];
	for (const [index, window] of contract.evidenceWindows.entries()) {
		const expectedWindowId = windowId(window, window.snippet);
		if (window.windowId !== expectedWindowId) diagnostics.push({
			path: `contract.evidenceWindows[${index}].windowId`,
			code: "WINDOW_ID_MISMATCH",
			message: "Evidence window content does not match its identifier."
		});
		const current = readEvidenceWindow(window, projectRoot);
		if (current.status !== "match" || current.snippet !== window.snippet) diagnostics.push({
			path: `contract.evidenceWindows[${index}]`,
			code: "CONTEXT_WINDOW_STALE",
			message: `${window.file}:${window.lineRange[0]}-${window.lineRange[1]} changed after prepare; issue a new contract.`
		});
	}
	const expectedFingerprint = contractFingerprint(contract.evidenceWindows, contract.prompt, contract.proposalSchema);
	if (contract.contextFingerprint !== expectedFingerprint) diagnostics.push({
		path: "contract.contextFingerprint",
		code: "CONTRACT_FINGERPRINT_MISMATCH",
		message: "Contract fields do not match contextFingerprint."
	});
	if (contract.requestId !== `rccl-calibration:${expectedFingerprint}`) diagnostics.push({
		path: "contract.requestId",
		code: "CONTRACT_REQUEST_ID_MISMATCH",
		message: "Contract requestId does not match its content."
	});
	return diagnostics;
}
function validateIdentity(proposal, contract) {
	const diagnostics = [];
	if (proposal.requestId !== contract.requestId) diagnostics.push({
		path: "requestId",
		code: "REQUEST_ID_MISMATCH",
		message: "Proposal does not match the supplied calibration request."
	});
	if (proposal.contextFingerprint !== contract.contextFingerprint) diagnostics.push({
		path: "contextFingerprint",
		code: "CONTEXT_FINGERPRINT_MISMATCH",
		message: "Proposal does not match the supplied repository context."
	});
	return diagnostics;
}
function resolveProposalEvidence(proposals, contract) {
	const byId = new Map(contract.evidenceWindows.map((window) => [window.windowId, window]));
	const diagnostics = [];
	return {
		observations: proposals.map((proposal, observationIndex) => {
			const evidence = proposal.evidence.flatMap((reference, evidenceIndex) => {
				const window = byId.get(reference.windowId);
				if (!window) {
					diagnostics.push({
						path: `observations[${observationIndex}].evidence[${evidenceIndex}].windowId`,
						code: "EVIDENCE_WINDOW_NOT_IN_CONTRACT",
						message: `Evidence window ${reference.windowId} was not supplied by prepare.`
					});
					return [];
				}
				return [{
					file: window.file,
					lineRange: window.lineRange,
					snippet: window.snippet
				}];
			});
			return {
				id: proposal.id,
				category: proposal.category,
				scope: proposal.scope,
				statement: proposal.statement,
				affects: proposal.affects,
				decisionImpact: proposal.decisionImpact,
				semanticConfidence: proposal.semanticConfidence,
				evidence
			};
		}),
		diagnostics
	};
}
function loadExistingDocument(rcclPath) {
	if (!existsSync(rcclPath)) return { diagnostics: [] };
	const parsed = parseRcclDocument(readFileSync(rcclPath, "utf8"));
	if (!parsed.valid) return { diagnostics: parsed.diagnostics };
	return {
		document: parsed.data,
		diagnostics: []
	};
}
function verificationDiagnostics(observations) {
	return observations.flatMap((observation) => {
		if (observation.evidenceVerification.status === "current") return [];
		return [{
			path: `observations.${observation.id}.evidence`,
			code: `EVIDENCE_${observation.evidenceVerification.status.toUpperCase()}`,
			message: `${observation.evidenceVerification.verifiedCount}/${observation.evidenceVerification.totalCount} evidence references match the current repository.`
		}];
	});
}
function summarize(proposed, observations, rejectedCount) {
	return {
		proposed,
		accepted: proposed - rejectedCount,
		rejected: rejectedCount,
		current: observations.filter((observation) => observation.evidenceVerification.status === "current").length,
		partial: observations.filter((observation) => observation.evidenceVerification.status === "partial").length,
		stale: observations.filter((observation) => observation.evidenceVerification.status === "stale").length,
		broken: observations.filter((observation) => observation.evidenceVerification.status === "broken").length
	};
}
function rejected(diagnostics, proposed) {
	return {
		status: "rejected",
		diagnostics,
		summary: {
			proposed,
			accepted: 0,
			rejected: proposed,
			current: 0,
			partial: 0,
			stale: 0,
			broken: 0
		}
	};
}
function approvalRejected(diagnostics) {
	return {
		status: "rejected",
		diagnostics,
		approvedObservationIds: [],
		unchangedObservationIds: []
	};
}
function proposalCount(proposal) {
	if (typeof proposal === "string") return 0;
	return Array.isArray(proposal?.observations) ? proposal.observations.length : 0;
}
function currentGitRef(projectRoot) {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim() || null;
	} catch {
		return null;
	}
}
function writeYamlAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, toYaml(value), "utf8");
	renameSync(temporary, path);
}
function sha256(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function windowId(selection, snippet) {
	return `window:${sha256([
		selection.file,
		selection.lineRange,
		snippet
	])}`;
}
function contractFingerprint(windows, prompt, schema) {
	return sha256([
		"1.0",
		windows.map((window) => [
			window.windowId,
			window.file,
			window.lineRange,
			window.snippet
		]),
		prompt,
		schema
	]);
}
function buildPrompt(windows) {
	return [
		"Propose only repository observations that can change a code implementation or review decision.",
		"Do not summarize metadata, schemas, exports, versions, or facts that a tool can read on demand unless they establish a compatibility or architecture boundary.",
		"For every observation, explain the decision impact and cite one or more supplied windowId values.",
		"The supplied windows are host-selected evidence, not proof that any semantic claim is true or representative.",
		"Do not set review status; proposals are generated and require a separate approval action.",
		"Prefer zero observations over weak observations.",
		"Evidence windows:",
		...windows.map((window) => `- ${window.windowId} ${window.file}:${window.lineRange[0]}-${window.lineRange[1]}`)
	].join("\n");
}
function proposalSchema() {
	return [
		"schemaVersion: \"1.0\"",
		"requestId: \"<from-contract>\"",
		"contextFingerprint: \"<from-contract>\"",
		"replace: false",
		"observations:",
		"  - id: \"obs-kebab-case\"",
		"    category: \"architecture|constraint|compatibility|legacy|anti-pattern|migration|convention\"",
		"    scope: \"path/or/glob\"",
		"    statement: \"observed repository fact\"",
		"    affects: [\"compatibility\"]",
		"    decisionImpact: \"how omitting this fact could worsen a code decision\"",
		"    semanticConfidence: \"low|medium|high\"",
		"    evidence:",
		"      - windowId: \"window:<from-contract>\""
	].join("\n");
}
//#endregion
export { approveContext, commitCalibration, parseCalibrationContract, parseCalibrationProposal, parseRcclDocument, prepareCalibration, validateContext };
