import { createHash } from "node:crypto";
//#region src/ai-contracts/shared.ts
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validConfidence(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function stableRefHash(value) {
	return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function isEvidenceRef(value) {
	if (!isRecord(value)) return false;
	if (!isEvidenceKind(value.kind)) return false;
	if (typeof value.ref !== "string" || !value.ref.trim()) return false;
	if (value.line_range !== void 0 && !isLineRange(value.line_range)) return false;
	if (value.file !== void 0 && typeof value.file !== "string") return false;
	if (value.snippet_hash !== void 0 && typeof value.snippet_hash !== "string") return false;
	if (value.command !== void 0 && typeof value.command !== "string") return false;
	if (value.output_hash !== void 0 && typeof value.output_hash !== "string") return false;
	return true;
}
function validEvidenceRefs(value) {
	return Array.isArray(value) && value.length > 0 && value.every(isEvidenceRef);
}
function normalizeEvidenceRefs(value) {
	if (!Array.isArray(value)) return [];
	return value.filter(isEvidenceRef).map((ref) => ({
		...ref,
		ref: ref.ref.trim()
	}));
}
function contractVersionDiagnostic(raw, expectedKind) {
	if (!isRecord(raw)) return null;
	if (!("contractVersion" in raw) && !("schemaVersion" in raw) && !("kind" in raw)) return null;
	if (raw.contractVersion !== "ai-contract/v2") return {
		status: "rejected",
		reason: "unsupported-value",
		path: "contractVersion",
		message: `Unsupported contractVersion "${String(raw.contractVersion)}"; expected ai-contract/v2 ${expectedKind} payload.`
	};
	if (raw.kind !== expectedKind) return {
		status: "rejected",
		reason: "unsupported-value",
		path: "kind",
		message: `Unsupported contract kind "${String(raw.kind)}"; expected ${expectedKind}.`
	};
	return {
		status: "rejected",
		reason: "malformed-payload",
		path: "payload",
		message: `Received a contract envelope for ${expectedKind}; provide the artifact payload body, not the contract metadata envelope.`
	};
}
function isEvidenceKind(value) {
	return value === "file" || value === "diff" || value === "command" || value === "rccl-evidence" || value === "runtime-trace" || value === "conversation";
}
function isLineRange(value) {
	return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isInteger(value[0]) && Number.isInteger(value[1]) && value[0] >= 1 && value[1] >= value[0];
}
function unique(values) {
	return [...new Set(values)];
}
//#endregion
export { contractVersionDiagnostic, isEvidenceRef, isRecord, normalizeEvidenceRefs, stableRefHash, unique, validConfidence, validEvidenceRefs };
