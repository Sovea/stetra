import { parseYaml } from "../../utils/yaml.mjs";
import { GOVERNANCE_IR_VERSION } from "../types.mjs";
import { SEMANTIC_RELATION_POLICY } from "../relations/policy.mjs";
import { normalizeIgnoredReasons, validIgnoredReason } from "../../feedback.mjs";
import { existsSync, readFileSync } from "node:fs";
//#region src/ir/adapters/feedback.ts
function feedbackToIR(lockfilePath) {
	const parsed = loadLockfile(lockfilePath);
	const directiveSignals = Object.entries(parsed.directives ?? {}).map(([directiveId, entry]) => directiveSignalToIR(directiveId, entry));
	const observationSignals = Object.entries(parsed.observations ?? {}).map(([observationId, entry]) => observationSignalToIR(observationId, entry));
	const tensionSignals = Object.entries(parsed.tensions ?? {}).map(([tensionKey, entry]) => tensionSignalToIR(tensionKey, entry));
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		source: {
			kind: "lockfile",
			id: "playbook.lock",
			path: lockfilePath
		},
		directiveSignals,
		observationSignals,
		tensionSignals,
		globalSummary: {
			totalTasks: parsed.governance_summary?.total_tasks ?? 0,
			byTaskType: parsed.governance_summary?.by_task_type ?? {},
			noisyDirectiveIds: [],
			frequentlyIgnoredDirectiveIds: directiveSignals.filter((signal) => signal.ignored >= SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredMinIgnored && signal.followRate < SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredFollowRate).map((signal) => signal.directiveId),
			recurringTensionKeys: tensionSignals.filter((signal) => signal.seenCount >= SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount).map((signal) => signal.tensionKey)
		}
	};
}
function loadLockfile(lockfilePath) {
	if (!lockfilePath || !existsSync(lockfilePath)) return {};
	const parsed = parseYaml(readFileSync(lockfilePath, "utf-8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	if ("directives" in parsed || "governance_summary" in parsed) return parsed;
	const directives = {};
	for (const [id, entry] of Object.entries(parsed)) if (isDirectiveEntry(entry)) directives[id] = entry;
	return { directives };
}
function isDirectiveEntry(value) {
	return value != null && typeof value === "object" && !Array.isArray(value) && "quality_signal" in value;
}
function directiveSignalToIR(directiveId, entry) {
	const overall = entry.quality_signal?.overall;
	return {
		directiveId,
		followed: overall?.followed ?? 0,
		ignored: overall?.ignored ?? 0,
		followRate: overall?.follow_rate ?? 0,
		trend: overall?.trend ?? "stable",
		signalConfidence: validSignalConfidence(entry.quality_signal?.signal_confidence) ? entry.quality_signal.signal_confidence : "implicit",
		ignoredReasons: normalizeIgnoredReasons(entry.quality_signal?.ignored_reasons),
		...validIgnoredReason(entry.quality_signal?.last_ignored_reason) ? { lastIgnoredReason: entry.quality_signal.last_ignored_reason } : {},
		lastSeen: entry.quality_signal?.last_seen ?? ""
	};
}
function validSignalConfidence(value) {
	return value === "implicit" || value === "explicit" || value === "review-confirmed" || value === "user-corrected";
}
function observationSignalToIR(observationId, entry) {
	return {
		observationId,
		seenCount: entry.seen_count ?? 0,
		relationCount: entry.relation_count ?? 0,
		activeSeenCount: entry.active_seen_count ?? 0,
		staleSeenCount: entry.stale_seen_count ?? 0,
		supersededSeenCount: entry.superseded_seen_count ?? 0,
		lastDisposition: entry.last_disposition ?? "pending",
		lastLifecycleStatus: entry.last_lifecycle_status ?? "unknown",
		lastContentFingerprint: entry.last_content_fingerprint ?? null,
		lastSeen: entry.last_seen ?? ""
	};
}
function tensionSignalToIR(tensionKey, entry) {
	return {
		tensionKey,
		seenCount: entry.seen_count ?? 0,
		directiveId: entry.directive_id ?? "",
		observationId: entry.observation_id ?? "",
		lastExecutionMode: entry.last_execution_mode ?? "ambient",
		lastSeen: entry.last_seen ?? ""
	};
}
//#endregion
export { feedbackToIR };
