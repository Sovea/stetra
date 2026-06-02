import { normalizePathSeparators } from "../utils/paths.mjs";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
//#region src/ai-contracts/evidence.ts
function verifyEvidenceRefs(refs, context = {}) {
	const entries = refs.map((ref) => verifyEvidenceRef(ref, context));
	const verified = entries.filter((entry) => entry.status === "verified").length;
	const staticVerified = entries.filter((entry) => entry.status === "verified" && entry.static).length;
	const conversationCount = entries.filter((entry) => entry.ref.kind === "conversation").length;
	return {
		total: entries.length,
		verified,
		staticVerified,
		conversationOnly: entries.length > 0 && conversationCount === entries.length,
		hasStaticEvidence: staticVerified > 0,
		entries
	};
}
function verifyEvidenceRef(ref, context) {
	if (ref.kind === "conversation") return {
		ref,
		status: "verified",
		static: false,
		reason: "conversation evidence is contextual only"
	};
	if (ref.kind === "file") return verifyFileEvidence(ref, context);
	if (ref.kind === "rccl-evidence") return verifyRcclEvidence(ref, context);
	if (ref.kind === "runtime-trace") return verifyListedRef(ref, context.runtimeTraceRefs, "runtime trace reference", false);
	if (ref.kind === "command") return verifyHashEvidence(ref, context.commandOutputHashes, "command output hash");
	if (ref.kind === "diff") return verifyHashEvidence(ref, context.diffSnapshotHashes, "diff snapshot hash");
	return {
		ref,
		status: "unverified",
		static: false,
		reason: "unsupported evidence kind"
	};
}
function verifyFileEvidence(ref, context) {
	if (!context.projectRoot) return {
		ref,
		status: "unverified",
		static: false,
		reason: "projectRoot is required for file evidence verification"
	};
	const parsed = parseRefLocation(ref.ref);
	const file = ref.file ?? parsed.file;
	const lineRange = ref.line_range ?? parsed.line_range;
	if (!file) return {
		ref,
		status: "unverified",
		static: false,
		reason: "file evidence must include file or parseable ref"
	};
	const filePath = isAbsolute(file) ? file : resolve(context.projectRoot, file);
	if (!existsSync(filePath)) return {
		ref,
		status: "unverified",
		static: false,
		reason: `file evidence target does not exist: ${file}`
	};
	if (!lineRange) return {
		ref,
		status: "unverified",
		static: false,
		reason: "file evidence must include line_range"
	};
	const lines = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n").split("\n");
	if (lineRange[0] < 1 || lineRange[1] < lineRange[0] || lineRange[1] > lines.length) return {
		ref,
		status: "unverified",
		static: false,
		reason: `line_range ${lineRange[0]}-${lineRange[1]} is outside ${file}`
	};
	if (ref.snippet_hash && !matchesSnippetHash(lines.slice(lineRange[0] - 1, lineRange[1]).join("\n"), ref.snippet_hash)) return {
		ref,
		status: "unverified",
		static: false,
		reason: "snippet_hash does not match file line range"
	};
	return {
		ref,
		status: "verified",
		static: true,
		reason: "file and line range verified"
	};
}
function verifyRcclEvidence(ref, context) {
	const observations = context.observations ?? [];
	if (!observations.length) return {
		ref,
		status: "unverified",
		static: false,
		reason: "RCCL observations are required for rccl-evidence verification"
	};
	const parsed = parseRefLocation(ref.ref);
	const file = ref.file ?? parsed.file;
	const lineRange = ref.line_range ?? parsed.line_range;
	if (!file || !lineRange) return {
		ref,
		status: "unverified",
		static: false,
		reason: "rccl-evidence must reference a concrete evidence file and line range"
	};
	if (!observations.some((observation) => observationCanSupportRcclEvidence(observation) && observation.evidence.some((evidence) => {
		const evidenceRef = `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`;
		const sameRef = ref.ref === evidenceRef || ref.ref === `${observation.id}:${evidenceRef}`;
		const sameLocation = normalizePathSeparators(file) === normalizePathSeparators(evidence.file) && lineRange[0] === evidence.line_range[0] && lineRange[1] === evidence.line_range[1];
		return sameRef || sameLocation;
	}))) return {
		ref,
		status: "unverified",
		static: false,
		reason: "rccl-evidence ref does not match loaded observation evidence"
	};
	return {
		ref,
		status: "verified",
		static: true,
		reason: "rccl-evidence matches loaded observation evidence"
	};
}
function verifyListedRef(ref, refs, label, isStatic = true) {
	if (refs?.includes(ref.ref)) return {
		ref,
		status: "verified",
		static: isStatic,
		reason: `${label} verified`
	};
	if (!refs) return {
		ref,
		status: "unverified",
		static: false,
		reason: `${label} is unavailable in the current workflow`
	};
	return {
		ref,
		status: "unverified",
		static: false,
		reason: `${label} was not captured by workflow`
	};
}
function verifyHashEvidence(ref, hashes, label) {
	if (ref.output_hash && hashes?.includes(ref.output_hash)) return {
		ref,
		status: "verified",
		static: true,
		reason: `${label} verified`
	};
	if (!ref.output_hash) return {
		ref,
		status: "unverified",
		static: false,
		reason: `${label} missing output_hash`
	};
	if (!hashes) return {
		ref,
		status: "unverified",
		static: false,
		reason: `${label} is unavailable in the current workflow`
	};
	return {
		ref,
		status: "unverified",
		static: false,
		reason: `${label} was not captured by workflow`
	};
}
function parseRefLocation(ref) {
	const match = /^(.*):(\d+)-(\d+)$/.exec(ref);
	if (!match) return {};
	const start = Number(match[2]);
	const end = Number(match[3]);
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return { file: match[1] };
	return {
		file: match[1],
		line_range: [start, end]
	};
}
function matchesSnippetHash(snippet, expected) {
	const normalizedExpected = expected.replace(/^sha(1|256):/, "");
	return hash("sha1", snippet) === normalizedExpected || hash("sha256", snippet) === normalizedExpected;
}
function hash(algorithm, value) {
	return createHash(algorithm).update(value).digest("hex");
}
function observationCanSupportRcclEvidence(observation) {
	const verification = observation.verification;
	if (!verification) return true;
	if (verification.disposition === "demote-to-ambient") return false;
	return verification.evidence_status !== "failed" && verification.evidence_status !== "unverifiable";
}
//#endregion
export { verifyEvidenceRefs };
