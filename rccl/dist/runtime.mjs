import { l as verifyEvidence, r as parseRcclDocument } from "./parse.mjs";
//#region src/runtime.ts
/** Narrow integration surface consumed by the Runtime hard kernel. */
function parseRccl(text) {
	const parsed = parseRcclDocument(text);
	if (!parsed.valid || !parsed.data) return {
		valid: false,
		errors: parsed.diagnostics.map((diagnostic) => `${diagnostic.path || "document"}: ${diagnostic.code}: ${diagnostic.message}`)
	};
	return {
		valid: true,
		data: parsed.data
	};
}
function verifyObservationEvidence(observation, projectRoot, checkedAt) {
	const verifiedCount = observation.evidence.map((evidence) => verifyEvidence(evidence, projectRoot)).filter((result) => result.status === "match").length;
	const priorCurrent = observation.evidenceVerification.status === "current" || observation.evidenceVerification.status === "partial";
	const status = verifiedCount === observation.evidence.length ? "current" : verifiedCount > 0 ? "partial" : priorCurrent ? "stale" : "broken";
	return {
		...observation,
		evidenceVerification: {
			status,
			verifiedCount,
			totalCount: observation.evidence.length,
			checkedAt
		},
		lifecycle: {
			...observation.lifecycle,
			status: observation.lifecycle.status === "superseded" ? "superseded" : status === "stale" || status === "broken" ? "stale" : "active",
			lastVerifiedAt: checkedAt
		}
	};
}
//#endregion
export { parseRccl, verifyObservationEvidence };
