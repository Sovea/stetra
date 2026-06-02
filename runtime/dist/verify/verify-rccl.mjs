import { unique } from "../utils/common.mjs";
import { fileOverlapsTarget, normalizePath, scopeOverlapsPath } from "../utils/paths.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region src/verify/verify-rccl.ts
/**
* Backward-compatible wrapper that preserves stored verification; incomplete observations stay ambient downstream.
*/
async function verifyRcclDocument(rccl, projectRoot, now = /* @__PURE__ */ new Date()) {
	return (await verifyRcclDocumentWithSummary(rccl, {
		projectRoot,
		policy: "trust-existing",
		now
	})).document;
}
/**
* Verifies RCCL observations according to the Runtime task-time trust policy.
*/
async function verifyRcclDocumentWithSummary(rccl, options) {
	const checkedAt = (options.now ?? /* @__PURE__ */ new Date()).toISOString();
	const rcclModule = await loadRcclModule();
	const policy = options.policy ?? "task-relevant";
	const targets = taskTargets(options.resolvedTask);
	const records = [];
	const observations = rccl.observations.map((observation) => {
		const relevance = observationTaskRelevance(observation, targets);
		const before = verificationSnapshot(observation);
		if (!shouldReverifyObservation(observation, policy, relevance.taskRelevant)) {
			const action = policy === "task-relevant" && !relevance.taskRelevant ? "skipped-not-task-relevant" : "reused";
			records.push({
				observation_id: observation.id,
				action,
				task_relevant: relevance.taskRelevant,
				reason: action === "skipped-not-task-relevant" ? relevance.reason : reuseReason(policy, relevance.reason),
				before,
				after: before
			});
			return observation;
		}
		const verified = rcclModule.verifyObservationInduction(rcclModule.verifyObservationEvidence(observation, options.projectRoot, checkedAt));
		const after = verificationSnapshot(verified);
		records.push({
			observation_id: observation.id,
			action: dispositionWasReduced(before.disposition, after.disposition) ? "demoted" : "reverified",
			task_relevant: relevance.taskRelevant,
			reason: verificationReason(policy, relevance.reason),
			before,
			after
		});
		return verified;
	});
	const summary = summarizeVerification(policy, records);
	return {
		document: {
			...rccl,
			observations
		},
		summary
	};
}
function summarizeVerification(policy, records) {
	return {
		policy,
		reverified_count: records.filter((record) => record.action === "reverified").length,
		reused_count: records.filter((record) => record.action === "reused").length,
		demoted_count: records.filter((record) => record.action === "demoted").length,
		skipped_not_task_relevant_count: records.filter((record) => record.action === "skipped-not-task-relevant").length,
		records
	};
}
function shouldReverifyObservation(observation, policy, taskRelevant) {
	if (policy === "deep") return true;
	if (policy === "task-relevant") return taskRelevant;
	return false;
}
function taskTargets(resolvedTask) {
	if (!resolvedTask) return [];
	return unique([
		resolvedTask.task.targetFile,
		...resolvedTask.task.changedFiles ?? [],
		resolvedTask.task_intent.target_file,
		...resolvedTask.task_intent.changed_files
	].filter((value) => Boolean(value)).map(normalizePath));
}
function observationTaskRelevance(observation, targets) {
	if (targets.length === 0) return {
		taskRelevant: true,
		reason: "no task file scope was provided; observation may enter semantic relation candidates"
	};
	for (const target of targets) {
		if (scopeOverlapsPath(observation.scope, target)) return {
			taskRelevant: true,
			reason: `observation scope overlaps task target ${target}`
		};
		const evidenceHit = observation.evidence.find((evidence) => fileOverlapsTarget(evidence.file, target));
		if (evidenceHit) return {
			taskRelevant: true,
			reason: `evidence file ${evidenceHit.file} overlaps task target ${target}`
		};
	}
	return {
		taskRelevant: false,
		reason: "observation scope and evidence do not overlap current task targets"
	};
}
function verificationSnapshot(observation) {
	return {
		evidence_status: observation.verification.evidence_status,
		induction_status: observation.verification.induction_status,
		disposition: observation.verification.disposition,
		checked_at: observation.verification.checked_at
	};
}
function dispositionWasReduced(before, after) {
	return dispositionRank(after) > dispositionRank(before);
}
function dispositionRank(disposition) {
	if (disposition === "demote-to-ambient") return 2;
	if (disposition === "keep-with-reduced-confidence") return 1;
	return 0;
}
function verificationReason(policy, relevanceReason) {
	if (policy === "deep") return "deep policy reverified all RCCL observations";
	return relevanceReason;
}
function reuseReason(policy, relevanceReason) {
	if (policy === "trust-existing") return "trust-existing policy reused stored RCCL verification; incomplete verification remains ambient downstream";
	if (policy === "deep") return "deep policy should not reuse observations";
	return relevanceReason;
}
async function loadRcclModule() {
	return import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "rccl", "dist", "index.mjs")).href);
}
//#endregion
export { verifyRcclDocument, verifyRcclDocumentWithSummary };
