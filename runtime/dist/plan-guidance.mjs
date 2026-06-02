import { isRecord, unique } from "./utils/common.mjs";
import { resolveTask } from "./interpret/normalize-candidate.mjs";
import { parseYaml } from "./utils/yaml.mjs";
import { loadRccl } from "./load/load-rccl.mjs";
import { fileOverlapsTarget, normalizePath, scopeOverlapsPath } from "./utils/paths.mjs";
import { resolveContractPolicy } from "./contract-policy.mjs";
import { prepareAgentCapabilityProfileContract } from "./ai-contracts/agent-capability-profile.mjs";
import { prepareContextAcquisitionContract } from "./ai-contracts/context-acquisition.mjs";
import { prepareSemanticGovernanceGraphContractBundle } from "./ai-contracts/semantic-governance-graph.mjs";
import { prepareTaskModelContract } from "./ai-contracts/task-model.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
//#region src/plan-guidance.ts
async function planGuidance(input) {
	const notes = [];
	const sourceStatus = resolveSourceStatus(input, notes);
	const guidanceMode = input.mode ?? "standard";
	const resolvedTask = resolveTask({
		task: input.task,
		taskModels: input.taskModels ?? [],
		interpretationMode: input.taskModels?.length ? "host-agent" : "deterministic-only"
	});
	const rcclRelevant = await resolveRcclRelevance(input, sourceStatus, resolvedTask, notes);
	const policy = resolveContractPolicy({
		sourceStatus,
		providedContracts: input.providedContracts,
		agentCapabilityProfile: input.agentCapabilityProfile,
		task: input.task,
		resolvedTask,
		mode: guidanceMode,
		rcclRelevant
	});
	const requiredContracts = [];
	if (policy.required.includes("agent-capability-profile")) {
		const profile = prepareAgentCapabilityProfileContract({
			task: input.task,
			artifactPath: input.artifactPaths.agentCapabilityProfile
		});
		requiredContracts.push({
			kind: "agent-capability-profile",
			artifact: profile.profileArtifact,
			contract: profile.contract
		});
		notes.push("Agent capability profile requested so Runtime can select agentic contracts from concrete host capabilities.");
	}
	if (policy.required.includes("task-model")) {
		const taskModel = prepareTaskModelContract({
			task: input.task,
			artifactPath: input.artifactPaths.taskModel
		});
		requiredContracts.push({
			kind: "task-model",
			artifact: taskModel.modelArtifact,
			contract: taskModel.contract
		});
		notes.push("Task model contract requested; deterministic interpretation is fallback only.");
	}
	if (policy.required.includes("context-acquisition")) {
		const acquisition = prepareContextAcquisitionContract({
			task: input.task,
			artifactPath: input.artifactPaths.contextAcquisition ?? input.artifactPaths.taskModel
		});
		requiredContracts.push({
			kind: "context-acquisition",
			artifact: acquisition.acquisitionArtifact,
			contract: acquisition.contract
		});
		notes.push("Context acquisition is required because task risk is high and RCCL is absent.");
	}
	if (policy.required.includes("semantic-governance-graph")) {
		const graph = await prepareSemanticGovernanceGraphContractBundle({
			compileInput: guidancePlanCompileInput(input),
			artifactPath: input.artifactPaths.semanticGovernanceGraph ?? defaultSemanticGovernanceGraphPath(input.projectRoot)
		});
		requiredContracts.push({
			kind: "semantic-governance-graph",
			artifact: graph.graphArtifact,
			contract: graph.contract,
			context: {
				resolvedTask: graph.resolvedTask,
				directives: graph.directives,
				observations: graph.observations
			}
		});
		notes.push("Semantic governance graph is required because RCCL is available and host semantic evidence should drive merge relations.");
	}
	if (policy.required.includes("adherence-evidence")) notes.push("Adherence evidence is required by strict mode after implementation; it is prepared after guidance compilation.");
	if (policy.optional.includes("context-acquisition")) notes.push("RCCL is absent; context acquisition or repository calibration is recommended before semantic graph compilation.");
	if (policy.optional.includes("adherence-evidence")) notes.push("Adherence evidence is optional in this mode; use prepare-adherence and complete when you want directive follow-rate updates.");
	if (policy.optional.includes("governance-evolution-proposal")) notes.push("Governance evolution proposal is available from lockfile signals, but it is review-only and never writes automatically.");
	notes.push(...policy.diagnostics.reasons);
	return {
		mode: requiredContracts.length ? "contracts-required" : "ready",
		guidanceMode,
		requiredContracts,
		recommendedContracts: unique([...policy.required, ...policy.optional]),
		sourceStatus,
		outputPolicy: {
			stdout: "compact",
			trace: "session-only"
		},
		policy,
		diagnostics: {
			policy: requiredContracts.length ? "contracts-required" : "ready",
			notes
		}
	};
}
function resolveSourceStatus(input, notes) {
	return {
		localAugment: input.localAugmentPath && existsSync(input.localAugmentPath) ? "present" : "absent",
		rccl: resolveRcclSourceStatus(input.rcclPath, notes),
		lockfile: input.lockfilePath && existsSync(input.lockfilePath) ? "present" : "absent",
		cache: resolveCacheStatus(input.projectRoot)
	};
}
function resolveRcclSourceStatus(rcclPath, notes) {
	if (!rcclPath || !existsSync(rcclPath)) return "absent";
	try {
		const parsed = parseYaml(readFileSync(rcclPath, "utf-8"));
		if (!isRecord(parsed) || !Array.isArray(parsed.observations)) return "unverified";
		if (parsed.observations.length === 0) return "present";
		const observations = parsed.observations.filter(isRecord);
		if (observations.length !== parsed.observations.length) return "unverified";
		if (observations.some((observation) => {
			const verification = isRecord(observation.verification) ? observation.verification : null;
			if (!verification) return true;
			return !hasVerificationValue(verification, "evidence_status") || !hasVerificationValue(verification, "evidence_verified_count") || !hasVerificationValue(verification, "evidence_confidence") || !hasVerificationValue(verification, "induction_status") || !hasVerificationValue(verification, "induction_confidence") || !hasVerificationValue(verification, "checked_at") || !hasVerificationValue(verification, "disposition");
		})) return "unverified";
		return observations.some((observation) => {
			const lifecycle = isRecord(observation.lifecycle) ? observation.lifecycle : null;
			return lifecycle?.status === "stale" || lifecycle?.status === "superseded";
		}) ? "stale" : "present";
	} catch (error) {
		notes?.push(`RCCL status check failed: ${error instanceof Error ? error.message : String(error)}`);
		return "unverified";
	}
}
function resolveCacheStatus(projectRoot) {
	const cacheRoot = join(projectRoot, ".resonant-code", "context", "cache", "runtime");
	if (!existsSync(cacheRoot)) return "miss";
	const populatedLevels = [
		"l1",
		"l2",
		"l3"
	].filter((level) => hasFiles(join(cacheRoot, level))).length;
	if (populatedLevels === 3) return "hit";
	return populatedLevels > 0 ? "partial" : "miss";
}
function guidancePlanCompileInput(input) {
	return {
		builtinRoot: input.builtinRoot,
		localAugmentPath: input.localAugmentPath,
		rcclPath: input.rcclPath,
		projectRoot: input.projectRoot,
		lockfilePath: input.lockfilePath,
		hostProposals: input.hostProposals,
		hostFulfillment: input.hostFulfillment,
		agentCapabilityProfile: input.agentCapabilityProfile,
		preloadedSources: input.preloadedSources,
		task: input.task,
		taskModels: input.taskModels
	};
}
function defaultSemanticGovernanceGraphPath(projectRoot) {
	return join(projectRoot, ".resonant-code", "context", "semantic-governance-graphs", "semantic-governance-graph.json");
}
async function resolveRcclRelevance(input, sourceStatus, resolvedTask, notes) {
	if (sourceStatus.rccl === "absent" || !input.rcclPath) return void 0;
	const targets = taskTargets(input.task, resolvedTask);
	if (targets.length === 0) return void 0;
	let rccl = null;
	try {
		rccl = await loadRccl(input.rcclPath);
	} catch (error) {
		notes?.push(`RCCL relevance check failed: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (!rccl) return void 0;
	return rccl.observations.some((observation) => targets.some((target) => scopeOverlapsPath(observation.scope, target) || observation.evidence.some((evidence) => fileOverlapsTarget(evidence.file, target))));
}
function taskTargets(task, resolvedTask) {
	return unique([
		task.targetFile,
		...task.changedFiles ?? [],
		resolvedTask.task_intent.target_file,
		...resolvedTask.task_intent.changed_files
	].filter((value) => Boolean(value)).map(normalizePath));
}
function hasFiles(directory) {
	try {
		return readdirSync(directory).some((entry) => entry.endsWith(".json"));
	} catch (_error) {
		return false;
	}
}
function hasVerificationValue(record, key) {
	return record[key] !== void 0 && record[key] !== null && record[key] !== "";
}
//#endregion
export { planGuidance, resolveSourceStatus };
