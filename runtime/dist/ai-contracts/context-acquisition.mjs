import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
import { contractVersionDiagnostic, isRecord, unique, validConfidence, validEvidenceRefs } from "./shared.mjs";
//#region src/ai-contracts/context-acquisition.ts
const CONTEXT_ACQUISITION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { requests: {
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				kind: { const: "rccl-incremental" },
				mode: { enum: [
					"task-scoped",
					"changed-files",
					"full"
				] },
				target_files: {
					type: "array",
					items: { type: "string" },
					maxItems: 4
				},
				changed_files: {
					type: "array",
					items: { type: "string" },
					maxItems: 4
				},
				scope: { type: "string" },
				reason: { type: "string" },
				confidence: {
					type: "number",
					minimum: 0,
					maximum: 1
				},
				evidence_refs: { type: "array" }
			},
			required: [
				"kind",
				"mode",
				"target_files",
				"changed_files",
				"reason",
				"confidence",
				"evidence_refs"
			]
		}
	} },
	required: ["requests"]
};
const MAX_CONTEXT_FILES = 4;
const MIN_CONTEXT_CONFIDENCE = .5;
function prepareContextAcquisitionContract(input) {
	const prompt = [
		"Acquire repository context needed before semantic governance graph generation.",
		"Use this only to request bounded file windows, changed files, tests, or calibration slices that materially affect Runtime guidance.",
		"Runtime/RCCL will decide whether the requested context becomes authoritative repository observation data.",
		"Return JSON only.",
		"",
		`Task description: ${input.task.description}`,
		`Target file: ${input.task.targetFile ?? "(none)"}`,
		`Changed files: ${input.task.changedFiles?.join(", ") || "(none)"}`
	].join("\n");
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write bounded context-acquisition requests to ${input.artifactPath}; use them to drive calibrate-repo-context prepare-incremental before semantic graph compilation.`
	};
	return {
		acquisitionPrompt: prompt,
		acquisitionSchema: JSON.stringify(CONTEXT_ACQUISITION_SCHEMA, null, 2),
		acquisitionArtifact: artifact,
		contract: {
			contractVersion: "ai-contract/v2",
			kind: "context-acquisition",
			schemaId: "runtime.context-acquisition",
			schemaVersion: "2.0",
			prompt,
			schema: CONTEXT_ACQUISITION_SCHEMA,
			artifact,
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: {
				task: input.task,
				schemaId: "runtime.context-acquisition"
			}
		}
	};
}
function validateContextAcquisitionPayload(raw) {
	const entries = [];
	const requests = [];
	const versionDiagnostic = contractVersionDiagnostic(raw, "context-acquisition");
	if (versionDiagnostic) return {
		requests,
		diagnostics: buildContractPayloadDiagnostics("context-acquisition", [versionDiagnostic])
	};
	if (!isContextAcquisitionPayload(raw)) {
		entries.push({
			status: raw == null ? "unused" : "rejected",
			reason: raw == null ? "empty-payload" : "malformed-payload",
			path: "payload",
			message: raw == null ? "No context acquisition payload was provided." : "Context acquisition payload must be an object with a requests array."
		});
		return {
			requests,
			diagnostics: buildContractPayloadDiagnostics("context-acquisition", entries)
		};
	}
	raw.requests.forEach((request, index) => {
		const path = `requests[${index}]`;
		if (!isContextAcquisitionRequest(request)) {
			entries.push(rejected(path, "malformed-payload", "Request must be a bounded rccl-incremental request with mode, target_files, changed_files, reason, confidence, and evidence_refs."));
			return;
		}
		const targetFiles = unique(request.target_files.filter((file) => file.trim()).map(normalizePath));
		const changedFiles = unique(request.changed_files.filter((file) => file.trim()).map(normalizePath));
		const totalFiles = unique([...targetFiles, ...changedFiles]);
		if (request.mode !== "full" && totalFiles.length === 0) {
			entries.push(rejected(path, "missing-required-field", "Task-scoped and changed-files context acquisition requires at least one target or changed file."));
			return;
		}
		if (totalFiles.length > MAX_CONTEXT_FILES) {
			entries.push(rejected(path, "capped-by-policy", `Context acquisition is capped at ${MAX_CONTEXT_FILES} files per request.`));
			return;
		}
		if (request.confidence < MIN_CONTEXT_CONFIDENCE) {
			entries.push(rejected(path, "low-confidence", `Context acquisition confidence ${request.confidence} is below ${MIN_CONTEXT_CONFIDENCE}.`));
			return;
		}
		if (!validEvidenceRefs(request.evidence_refs)) {
			entries.push(rejected(path, "missing-evidence", "Context acquisition request must include evidence_refs explaining why this context is needed."));
			return;
		}
		requests.push({
			kind: "rccl-incremental",
			mode: request.mode,
			target_files: targetFiles,
			changed_files: changedFiles,
			...request.scope ? { scope: request.scope } : {},
			reason: request.reason.trim(),
			confidence: request.confidence,
			evidence_refs: request.evidence_refs
		});
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: "Context acquisition request accepted for RCCL workflow orchestration.",
			confidence: request.confidence
		});
	});
	if (!raw.requests.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "requests",
		message: "Context acquisition payload contains no requests."
	});
	return {
		requests,
		diagnostics: buildContractPayloadDiagnostics("context-acquisition", entries)
	};
}
function isContextAcquisitionPayload(value) {
	return isRecord(value) && Array.isArray(value.requests);
}
function isContextAcquisitionRequest(value) {
	if (!isRecord(value)) return false;
	return value.kind === "rccl-incremental" && isContextMode(value.mode) && Array.isArray(value.target_files) && value.target_files.every((item) => typeof item === "string") && Array.isArray(value.changed_files) && value.changed_files.every((item) => typeof item === "string") && (value.scope === void 0 || typeof value.scope === "string") && typeof value.reason === "string" && value.reason.trim().length > 0 && validConfidence(value.confidence) && Array.isArray(value.evidence_refs);
}
function isContextMode(value) {
	return value === "task-scoped" || value === "changed-files" || value === "full";
}
function normalizePath(value) {
	return value.replace(/\\/g, "/").trim();
}
function rejected(path, reason, message) {
	return {
		status: "rejected",
		reason,
		path,
		message
	};
}
//#endregion
export { prepareContextAcquisitionContract, validateContextAcquisitionPayload };
