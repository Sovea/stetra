import { isRecord, validConfidence } from "../utils/common.mjs";
import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
import { AI_CONTRACT_VERSION } from "./types.mjs";
import { contractVersionDiagnostic, normalizeEvidenceRefs, validEvidenceRefs } from "./shared.mjs";
import { verifyEvidenceRefs } from "./evidence.mjs";
//#region src/ai-contracts/adherence-evidence.ts
const MINIMUM_ADHERENCE_CONFIDENCE = .5;
const VERDICTS = new Set([
	"followed",
	"ignored",
	"partial",
	"unverified"
]);
const IGNORED_REASONS = new Set([
	"not-applicable",
	"conflicts-with-task",
	"too-broad",
	"repo-reality",
	"false-positive",
	"user-corrected",
	"other"
]);
const ADHERENCE_EVIDENCE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { verdicts: { type: "array" } },
	required: ["verdicts"]
};
function prepareAdherenceEvidenceContract(input) {
	const prompt = buildEvidencePrompt(input.directives, input.taskDescription);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write adherence-evidence JSON to ${input.artifactPath}, then pass it to complete with --adherence-file ${input.artifactPath}.`
	};
	return {
		evidencePrompt: prompt,
		evidenceSchema: JSON.stringify(ADHERENCE_EVIDENCE_SCHEMA, null, 2),
		evidenceArtifact: artifact,
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "adherence-evidence",
			schemaId: "runtime.adherence-evidence",
			schemaVersion: "2.0",
			prompt,
			schema: ADHERENCE_EVIDENCE_SCHEMA,
			artifact,
			allowedIds: { directiveIds: input.directives.map((directive) => directive.id) },
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: {
				directiveIds: input.directives.map((directive) => directive.id),
				schemaId: "runtime.adherence-evidence"
			}
		}
	};
}
function validateAdherenceEvidencePayload(raw, allowedDirectiveIds, evidenceContext) {
	const entries = [];
	const verdicts = [];
	const allowedIds = new Set(allowedDirectiveIds);
	const versionDiagnostic = contractVersionDiagnostic(raw, "adherence-evidence");
	if (versionDiagnostic) return {
		verdicts,
		diagnostics: buildContractPayloadDiagnostics("adherence-evidence", [versionDiagnostic])
	};
	if (!isAdherencePayload(raw)) {
		entries.push({
			status: raw == null ? "unused" : "rejected",
			reason: raw == null ? "empty-payload" : "malformed-payload",
			path: "payload",
			message: raw == null ? "No adherence evidence payload was provided." : "Adherence evidence payload must be an object with a verdicts array."
		});
		return {
			verdicts,
			diagnostics: buildContractPayloadDiagnostics("adherence-evidence", entries)
		};
	}
	const seen = /* @__PURE__ */ new Set();
	raw.verdicts.forEach((item, index) => {
		const path = `verdicts[${index}]`;
		if (!isVerdictEntry(item)) {
			entries.push({
				status: "rejected",
				reason: "malformed-payload",
				path,
				message: "Verdict must include directive_id, verdict, confidence, evidence_refs, and reason.",
				directiveId: isRecord(item) && typeof item.directive_id === "string" ? item.directive_id : void 0
			});
			return;
		}
		if (!allowedIds.has(item.directive_id)) {
			entries.push(rejected(path, "invalid-id", `Directive id "${item.directive_id}" is not allowed.`, item));
			return;
		}
		if (seen.has(item.directive_id)) {
			entries.push(rejected(path, "duplicate-id", `Directive id "${item.directive_id}" already has a verdict.`, item));
			return;
		}
		seen.add(item.directive_id);
		if (item.confidence < MINIMUM_ADHERENCE_CONFIDENCE) {
			entries.push(rejected(path, "low-confidence", `Confidence ${item.confidence} is below ${MINIMUM_ADHERENCE_CONFIDENCE}.`, item));
			return;
		}
		const nonUnverified = item.verdict !== "unverified";
		const evidenceRefs = validEvidenceRefs(item.evidence_refs) ? normalizeEvidenceRefs(item.evidence_refs) : [];
		if (nonUnverified && !evidenceRefs.length) {
			verdicts.push(toUnverified(item, evidenceRefs));
			entries.push(downgraded(path, "missing-evidence", "Non-unverified adherence verdict lacks evidence_refs; recorded as unverified and excluded from follow rate.", item));
			return;
		}
		if (nonUnverified && evidenceRefs.length) {
			const evidence = verifyEvidenceRefs(evidenceRefs, evidenceContext);
			if (evidence.conversationOnly) {
				verdicts.push(toUnverified(item, evidenceRefs));
				entries.push(downgraded(path, "conversation-only-evidence", `Conversation-only adherence evidence cannot update follow rate; recorded as unverified. Evidence verification: ${summarizeEvidenceVerification(evidence)}.`, item));
				return;
			}
			if (!evidence.hasStaticEvidence) {
				verdicts.push(toUnverified(item, evidenceRefs));
				entries.push(downgraded(path, "insufficient-static-evidence", `Adherence verdict lacks statically verified file, diff, command, or runtime trace evidence; recorded as unverified. Evidence verification: ${summarizeEvidenceVerification(evidence)}.`, item));
				return;
			}
		}
		const ignoredReason = item.verdict === "ignored" && item.ignored_reason && IGNORED_REASONS.has(item.ignored_reason) ? item.ignored_reason : void 0;
		verdicts.push({
			directive_id: item.directive_id,
			verdict: item.verdict,
			confidence: item.confidence,
			evidence_refs: evidenceRefs,
			reason: item.reason,
			...ignoredReason ? { ignored_reason: ignoredReason } : {}
		});
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: `Adherence evidence verdict accepted: ${item.verdict}.`,
			directiveId: item.directive_id,
			confidence: item.confidence
		});
	});
	if (!raw.verdicts.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "verdicts",
		message: "Adherence evidence payload contains no verdicts."
	});
	return {
		verdicts,
		diagnostics: buildContractPayloadDiagnostics("adherence-evidence", entries)
	};
}
function toUnverified(item, evidenceRefs) {
	return {
		directive_id: item.directive_id,
		verdict: "unverified",
		confidence: item.confidence,
		evidence_refs: evidenceRefs,
		reason: item.reason
	};
}
function summarizeEvidenceVerification(evidence) {
	return evidence.entries.map((entry) => `${entry.ref.kind}:${entry.status}:${entry.reason}`).join("; ") || "none";
}
function isAdherencePayload(value) {
	return isRecord(value) && Array.isArray(value.verdicts);
}
function isVerdictEntry(value) {
	if (!isRecord(value)) return false;
	return typeof value.directive_id === "string" && typeof value.verdict === "string" && VERDICTS.has(value.verdict) && validConfidence(value.confidence) && Array.isArray(value.evidence_refs) && typeof value.reason === "string";
}
function rejected(path, reason, message, item) {
	return {
		status: "rejected",
		reason,
		path,
		message,
		directiveId: item.directive_id,
		confidence: item.confidence
	};
}
function downgraded(path, reason, message, item) {
	return {
		status: "downgraded",
		reason,
		path,
		message,
		directiveId: item.directive_id,
		confidence: item.confidence
	};
}
function buildEvidencePrompt(directives, taskDescription) {
	return [
		"Evaluate adherence to compiled directives after implementation.",
		"Every followed, ignored, or partial verdict must cite evidence_refs from diff, file snippets, test/command output, or implementation evidence.",
		"Use \"unverified\" when you did not inspect enough evidence. Unverified directives do not update follow rate.",
		"Return JSON only.",
		"",
		`Task description: ${taskDescription}`,
		"",
		"Compiled directives:",
		...directives.map((directive) => `- ${directive.id}: [${directive.prescription}] ${directive.description} (execution_mode: ${directive.execution_mode})`)
	].join("\n");
}
//#endregion
export { prepareAdherenceEvidenceContract, validateAdherenceEvidencePayload };
