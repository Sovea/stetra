import { resolveTask } from "./interpret/normalize-candidate.mjs";
import { minimatch } from "./utils/glob.mjs";
import { loadRccl } from "./load/load-rccl.mjs";
import { resolveContractPolicy } from "./contract-policy.mjs";
import { prepareAgentCapabilityProfileContract } from "./ai-contracts/agent-capability-profile.mjs";
import { prepareContextAcquisitionContract } from "./ai-contracts/context-acquisition.mjs";
import { prepareSemanticGovernanceGraphContractBundle } from "./ai-contracts/semantic-governance-graph.mjs";
import { prepareTaskModelContract } from "./ai-contracts/task-model.mjs";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
//#region src/plan-guidance.ts
async function planGuidance(input) {
	const sourceStatus = resolveSourceStatus(input);
	const guidanceMode = input.mode ?? "standard";
	const resolvedTask = resolveTask({
		task: input.task,
		taskModels: input.taskModels ?? [],
		interpretationMode: input.taskModels?.length ? "host-agent" : "deterministic-only"
	});
	const rcclRelevant = await resolveRcclRelevance(input, sourceStatus, resolvedTask);
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
	const notes = [];
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
function resolveSourceStatus(input) {
	return {
		localAugment: input.localAugmentPath && existsSync(input.localAugmentPath) ? "present" : "absent",
		rccl: input.rcclPath && existsSync(input.rcclPath) ? "present" : "absent",
		lockfile: input.lockfilePath && existsSync(input.lockfilePath) ? "present" : "absent",
		cache: resolveCacheStatus(input.projectRoot)
	};
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
async function resolveRcclRelevance(input, sourceStatus, resolvedTask) {
	if (sourceStatus.rccl === "absent" || !input.rcclPath) return void 0;
	const targets = taskTargets(input.task, resolvedTask);
	if (targets.length === 0) return void 0;
	let rccl = null;
	try {
		rccl = await loadRccl(input.rcclPath);
	} catch {
		return;
	}
	if (!rccl) return void 0;
	return rccl.observations.some((observation) => targets.some((target) => pathMatchesScope(target, observation.scope) || observation.evidence.some((evidence) => evidence.file === target)));
}
function taskTargets(task, resolvedTask) {
	return unique([
		task.targetFile,
		...task.changedFiles ?? [],
		resolvedTask.task_intent.target_file,
		...resolvedTask.task_intent.changed_files
	].filter((value) => Boolean(value)));
}
function pathMatchesScope(path, scope) {
	if (scope === "*" || scope === "**" || scope === "**/*") return true;
	if (scope.includes("*") || scope.includes("?") || scope.includes("{")) return minimatch(path, scope);
	return path === scope || path.startsWith(`${scope.replace(/\/$/, "")}/`);
}
function hasFiles(directory) {
	try {
		return readdirSync(directory).some((entry) => entry.endsWith(".json"));
	} catch {
		return false;
	}
}
function unique(values) {
	return [...new Set(values)];
}
//#endregion
export { planGuidance, resolveSourceStatus };
