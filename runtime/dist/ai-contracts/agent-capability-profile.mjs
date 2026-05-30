import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
import { contractVersionDiagnostic, isRecord } from "./shared.mjs";
//#region src/ai-contracts/agent-capability-profile.ts
const AGENT_CAPABILITY_PROFILE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		can_read_files: { type: "boolean" },
		can_search_files: { type: "boolean" },
		can_run_commands: { type: "boolean" },
		can_inspect_diff: { type: "boolean" },
		can_request_context: { type: "boolean" },
		max_context_files: { type: "number" },
		max_command_count: { type: "number" }
	},
	required: [
		"can_read_files",
		"can_search_files",
		"can_run_commands",
		"can_inspect_diff",
		"can_request_context"
	]
};
function prepareAgentCapabilityProfileContract(input) {
	const prompt = [
		"Produce an AgentCapabilityProfile for this host environment.",
		"This profile is used by Runtime to decide which semantic contracts are safe and useful.",
		"Return JSON only. Do not include free-form guidance.",
		"",
		`Task description: ${input.task.description}`
	].join("\n");
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write the agent capability profile to ${input.artifactPath}; workflow adapters may pass it to Runtime contract policy as agentCapabilityProfile.`
	};
	return {
		profilePrompt: prompt,
		profileSchema: JSON.stringify(AGENT_CAPABILITY_PROFILE_SCHEMA, null, 2),
		profileArtifact: artifact,
		contract: {
			contractVersion: "ai-contract/v2",
			kind: "agent-capability-profile",
			schemaId: "runtime.agent-capability-profile",
			schemaVersion: "2.0",
			prompt,
			schema: AGENT_CAPABILITY_PROFILE_SCHEMA,
			artifact,
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: {
				task: input.task,
				schemaId: "runtime.agent-capability-profile"
			}
		}
	};
}
function validateAgentCapabilityProfilePayload(raw) {
	const entries = [];
	const versionDiagnostic = contractVersionDiagnostic(raw, "agent-capability-profile");
	if (versionDiagnostic) return {
		profile: null,
		diagnostics: buildContractPayloadDiagnostics("agent-capability-profile", [versionDiagnostic])
	};
	if (!isCapabilityProfile(raw)) {
		entries.push({
			status: raw == null ? "unused" : "rejected",
			reason: raw == null ? "empty-payload" : "malformed-payload",
			path: "profile",
			message: "Agent capability profile must include boolean capability fields."
		});
		return {
			profile: null,
			diagnostics: buildContractPayloadDiagnostics("agent-capability-profile", entries)
		};
	}
	entries.push({
		status: "accepted",
		reason: "accepted",
		path: "profile",
		message: "Agent capability profile accepted for Runtime contract policy."
	});
	return {
		profile: raw,
		diagnostics: buildContractPayloadDiagnostics("agent-capability-profile", entries)
	};
}
function isCapabilityProfile(value) {
	if (!isRecord(value)) return false;
	return typeof value.can_read_files === "boolean" && typeof value.can_search_files === "boolean" && typeof value.can_run_commands === "boolean" && typeof value.can_inspect_diff === "boolean" && typeof value.can_request_context === "boolean" && (value.max_context_files === void 0 || typeof value.max_context_files === "number") && (value.max_command_count === void 0 || typeof value.max_command_count === "number");
}
//#endregion
export { prepareAgentCapabilityProfileContract, validateAgentCapabilityProfilePayload };
