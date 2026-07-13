import { createRequire } from "node:module";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { createHash } from "node:crypto";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
//#region src/ai-contracts/diagnostics.ts
function buildContractPayloadDiagnostics(kind, entries, source) {
	const summary = {
		total: entries.length,
		accepted: 0,
		rejected: 0,
		downgraded: 0,
		unused: 0
	};
	for (const entry of entries) summary[entry.status] += 1;
	return {
		kind,
		...source ? { source } : {},
		summary,
		entries
	};
}
//#endregion
//#region src/ai-contracts/types.ts
const AI_CONTRACT_VERSION = "ai-contract/v1";
//#endregion
//#region src/utils/common.ts
function unique(values) {
	return [...new Set(values)];
}
function uniqueCompact(values) {
	return [...new Set((values ?? []).filter((value) => value !== void 0 && value !== null))];
}
function isRecord$1(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validConfidence(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function hasConstraint(values, expected) {
	return expected.some((item) => values.includes(item));
}
//#endregion
//#region src/ai-contracts/shared.ts
function stableRefHash(value) {
	return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function artifactIdentity(kind, cacheKeyMaterial) {
	const contextFingerprint = stableRefHash({
		kind,
		cacheKeyMaterial
	});
	return {
		requestId: `${kind}:${contextFingerprint}`,
		contextFingerprint
	};
}
function unwrapHostArtifactEnvelope(raw, expected) {
	if (!isRecord$1(raw)) return {
		payload: null,
		diagnostic: {
			status: "rejected",
			reason: "malformed-payload",
			path: "artifact",
			message: "Host artifact must use the v1 envelope: schema_version, kind, request_id, context_fingerprint, payload."
		}
	};
	if (raw.schema_version !== 1) return {
		payload: null,
		diagnostic: {
			status: "rejected",
			reason: "unsupported-schema-version",
			path: "schema_version",
			message: `UNSUPPORTED_SCHEMA_VERSION: expected schema_version 1; found ${String(raw.schema_version)}. Re-run init and calibrate-repo-context. Existing data was not modified.`
		}
	};
	if (raw.kind !== expected.kind) return rejectedEnvelope("kind", `Artifact kind "${String(raw.kind)}" does not match ${expected.kind}.`);
	if (raw.request_id !== expected.requestId) return rejectedEnvelope("request_id", "Artifact request_id does not match the contract issued for this compile context.");
	if (raw.context_fingerprint !== expected.contextFingerprint) return rejectedEnvelope("context_fingerprint", "Artifact context_fingerprint does not match current task and allowed-ID context.");
	if (!("payload" in raw)) return rejectedEnvelope("payload", "Artifact envelope is missing payload.");
	return {
		payload: raw.payload,
		diagnostic: null
	};
}
function rejectedEnvelope(path, message) {
	return {
		payload: null,
		diagnostic: {
			status: "rejected",
			reason: path === "kind" ? "unsupported-value" : "invalid-id",
			path,
			message
		}
	};
}
function isEvidenceRef(value) {
	if (!isRecord$1(value)) return false;
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
	if (!isRecord$1(raw)) return null;
	if (!("contractVersion" in raw) && !("schemaVersion" in raw) && !("kind" in raw)) return null;
	if (raw.contractVersion !== "ai-contract/v1") return {
		status: "rejected",
		reason: "unsupported-value",
		path: "contractVersion",
		message: `UNSUPPORTED_SCHEMA_VERSION: unsupported contractVersion "${String(raw.contractVersion)}"; expected ${AI_CONTRACT_VERSION} ${expectedKind} payload. Re-run init and calibrate-repo-context for v1 artifacts.`
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
//#endregion
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
		usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind agent-capability-profile, the issued requestId/contextFingerprint as request_id/context_fingerprint, and the profile under payload; then pass it back through Runtime artifacts.agentCapabilityProfile.`
	};
	return {
		profilePrompt: prompt,
		profileSchema: JSON.stringify(AGENT_CAPABILITY_PROFILE_SCHEMA, null, 2),
		profileArtifact: artifact,
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "agent-capability-profile",
			...artifactIdentity("agent-capability-profile", {
				task: input.task,
				schemaId: "runtime.agent-capability-profile"
			}),
			schemaId: "runtime.agent-capability-profile",
			schemaVersion: "1.0",
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
	if (!isRecord$1(value)) return false;
	return typeof value.can_read_files === "boolean" && typeof value.can_search_files === "boolean" && typeof value.can_run_commands === "boolean" && typeof value.can_inspect_diff === "boolean" && typeof value.can_request_context === "boolean" && (value.max_context_files === void 0 || typeof value.max_context_files === "number") && (value.max_command_count === void 0 || typeof value.max_command_count === "number");
}
//#endregion
//#region src/utils/glob.ts
/**
* Lightweight glob matcher for the subset used by playbook scopes and RCCL scopes.
*/
function minimatch(filepath, pattern) {
	return globToRegex(pattern).test(filepath.replace(/\\/g, "/"));
}
function globToRegex(pattern) {
	let i = 0;
	let regex = "^";
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") if (pattern[i + 1] === "*") {
			i += 2;
			if (pattern[i] === "/") {
				i += 1;
				regex += "(?:.+/)?";
			} else regex += ".*";
		} else {
			i += 1;
			regex += "[^/]*";
		}
		else if (c === "?") {
			i += 1;
			regex += "[^/]";
		} else if (c === "{") {
			const closeIndex = pattern.indexOf("}", i + 1);
			if (closeIndex === -1) {
				regex += "\\{";
				i += 1;
				continue;
			}
			const options = pattern.slice(i + 1, closeIndex).split(",").map((option) => option.trim()).filter(Boolean).map(escapeRegex);
			regex += options.length ? `(?:${options.join("|")})` : "\\{\\}";
			i = closeIndex + 1;
		} else if (c === ".") {
			i += 1;
			regex += "\\.";
		} else {
			regex += escapeRegex(c);
			i += 1;
		}
	}
	return new RegExp(`${regex}$`);
}
function escapeRegex(value) {
	return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
//#endregion
//#region src/utils/paths.ts
function normalizePath$1(value) {
	return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizePathSeparators(value) {
	return value.replace(/\\/g, "/");
}
function pathMatchesScope(path, scope) {
	if (scope === "*" || scope === "**" || scope === "**/*") return true;
	if (scope.includes("*") || scope.includes("?") || scope.includes("{")) return minimatch(path, scope);
	const normalizedScope = scope.replace(/\/$/, "");
	return path === normalizedScope || path.startsWith(`${normalizedScope}/`);
}
function scopeOverlapsPath(scope, path) {
	const normalizedScope = normalizePath$1(scope);
	const normalizedPath = normalizePath$1(path);
	return pathMatchesScope(normalizedPath, normalizedScope) || pathMatchesScope(normalizedScope, normalizedPath);
}
function fileOverlapsTarget(file, target) {
	const normalizedFile = normalizePath$1(file);
	const normalizedTarget = normalizePath$1(target);
	return normalizedFile === normalizedTarget || pathMatchesScope(normalizedFile, normalizedTarget) || pathMatchesScope(normalizedTarget, normalizedFile);
}
//#endregion
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
		usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind context-acquisition, the issued requestId/contextFingerprint as request_id/context_fingerprint, and bounded requests under payload; use them to drive calibrate-repo-context prepare-incremental before semantic graph compilation.`
	};
	return {
		acquisitionPrompt: prompt,
		acquisitionSchema: JSON.stringify(CONTEXT_ACQUISITION_SCHEMA, null, 2),
		acquisitionArtifact: artifact,
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "context-acquisition",
			...artifactIdentity("context-acquisition", {
				task: input.task,
				schemaId: "runtime.context-acquisition"
			}),
			schemaId: "runtime.context-acquisition",
			schemaVersion: "1.0",
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
//#endregion
//#region src/intent/schema.ts
const WORKFLOWS = [
	"code",
	"review",
	"analysis"
];
const CHANGE_TYPES = [
	"feature",
	"bugfix",
	"refactor",
	"migration",
	"unknown"
];
const OPERATIONS = [
	"create",
	"modify",
	"delete",
	"mixed"
];
const PROJECT_STAGES = [
	"prototype",
	"growth",
	"stable",
	"critical"
];
const OPTIMIZATION_TARGETS = [
	"speed",
	"maintainability",
	"safety",
	"simplicity",
	"reviewability"
];
const RISK_LEVELS = [
	"low",
	"medium",
	"high",
	"critical"
];
const SCOPE_SIZES = [
	"single-file",
	"module",
	"cross-cutting",
	"unknown"
];
const COMPATIBILITY_REQUIREMENTS = [
	"none",
	"preserve-behavior",
	"preserve-api",
	"migration-compatible",
	"breaking-allowed"
];
const INTERFACE_SENSITIVITIES = [
	"internal",
	"public-api",
	"persistence",
	"external-integration",
	"auth-security",
	"unknown"
];
const REFACTOR_TOLERANCES = [
	"none",
	"local-only",
	"bounded",
	"broad"
];
const MIGRATION_PHASES = [
	"none",
	"preparation",
	"dual-run",
	"cutover",
	"cleanup"
];
const REVIEW_GOALS = [
	"correctness",
	"regression-risk",
	"architecture-fit",
	"maintainability",
	"security",
	"performance"
];
const TASK_INTERPRETATION_ENUMS = {
	intent: {
		workflow: WORKFLOWS,
		change_type: CHANGE_TYPES,
		operation: OPERATIONS
	},
	context: {
		project_stage: PROJECT_STAGES,
		optimization_target: OPTIMIZATION_TARGETS,
		risk_level: RISK_LEVELS,
		scope_size: SCOPE_SIZES,
		compatibility_requirement: COMPATIBILITY_REQUIREMENTS,
		interface_sensitivity: INTERFACE_SENSITIVITIES,
		refactor_tolerance: REFACTOR_TOLERANCES,
		migration_phase: MIGRATION_PHASES,
		review_goal: REVIEW_GOALS
	}
};
function enumValue$1(value, allowedValues) {
	return typeof value === "string" && allowedValues.includes(value) ? value : void 0;
}
function hasEnumValue(value, allowedValues) {
	return enumValue$1(value, allowedValues) !== void 0;
}
//#endregion
//#region src/intent/parse-intent.ts
const DEFAULT_OPTIMIZATION_TARGET = {
	create: "maintainability",
	modify: "maintainability",
	delete: "safety",
	mixed: "maintainability"
};
/**
* Produces a deterministic task intent from user task input without using an LLM.
*/
function parseIntent(task) {
	const targetFile = task.targetFile?.replace(/\\/g, "/");
	const changedFiles = (task.changedFiles ?? []).map((file) => file.replace(/\\/g, "/"));
	const techStack = [...new Set([...task.techStack ?? [], ...inferTechStackFromFile(targetFile)])];
	const operation = enumValue$1(task.operation, OPERATIONS) ?? "modify";
	const changeType = enumValue$1(task.changeType, CHANGE_TYPES) ?? inferChangeType(operation);
	return {
		workflow: enumValue$1(task.workflow, WORKFLOWS) ?? "code",
		change_type: changeType,
		operation,
		target_layer: inferTargetLayer(targetFile),
		tech_stack: techStack,
		target_file: targetFile,
		changed_files: changedFiles,
		tags: [...new Set(task.tags ?? inferTags(targetFile, changedFiles))]
	};
}
function inferChangeType(operation) {
	return operation === "create" ? "feature" : "unknown";
}
function inferTechStackFromFile(targetFile) {
	if (!targetFile) return [];
	if (targetFile.endsWith(".tsx")) return ["typescript"];
	if (targetFile.endsWith(".ts")) return ["typescript"];
	return [];
}
function inferTargetLayer(targetFile) {
	if (!targetFile) return "module";
	if (/(^|\/)(test|tests|spec|specs)(\/|$)|\.(test|spec)\./.test(targetFile)) return "test";
	if (/(^|\/)(api|routes)(\/|$)|\b(handler|endpoint)\b/.test(targetFile)) return "api";
	if (/(^|\/)(store|state)(\/|$)|\.slice\./.test(targetFile)) return "store";
	if (/(^|\/)(components?|views?|pages?)(\/|$)|\.tsx$/.test(targetFile)) return "component";
	if (/(^|\/)(utils?|helpers?|lib)(\/|$)/.test(targetFile)) return "util";
	return "module";
}
function inferTags(targetFile, changedFiles) {
	const inputs = [targetFile, ...changedFiles].filter(Boolean).join(" ");
	const tags = [];
	if (/(^|\/)(test|tests|spec|specs)(\/|$)|\.(test|spec)\./.test(inputs)) tags.push("test");
	return tags;
}
function inferOptimizationTarget(operation) {
	return DEFAULT_OPTIMIZATION_TARGET[operation];
}
function inferHardConstraints() {
	return [];
}
function inferAllowedTradeoffs() {
	return [];
}
function inferAvoid() {
	return [];
}
/**
* Builds the contextual priorities and constraints used alongside task intent.
*/
function buildContextProfile(task, intent) {
	return {
		project_stage: enumValue$1(task.projectStage, PROJECT_STAGES),
		optimization_target: enumValue$1(task.optimizationTarget, OPTIMIZATION_TARGETS) ?? inferOptimizationTarget(intent.operation),
		hard_constraints: [...new Set(task.hardConstraints ?? inferHardConstraints())],
		allowed_tradeoffs: [...new Set(task.allowedTradeoffs ?? inferAllowedTradeoffs())],
		avoid: [...new Set(task.avoid ?? inferAvoid())],
		risk_level: enumValue$1(task.riskLevel, RISK_LEVELS) ?? inferRiskLevel(task, intent),
		scope_size: enumValue$1(task.scopeSize, SCOPE_SIZES) ?? inferScopeSize(intent),
		compatibility_requirement: enumValue$1(task.compatibilityRequirement, COMPATIBILITY_REQUIREMENTS) ?? inferCompatibilityRequirement(task),
		interface_sensitivity: enumValue$1(task.interfaceSensitivity, INTERFACE_SENSITIVITIES) ?? inferInterfaceSensitivity(intent),
		refactor_tolerance: enumValue$1(task.refactorTolerance, REFACTOR_TOLERANCES) ?? inferRefactorTolerance(task, intent),
		migration_phase: enumValue$1(task.migrationPhase, MIGRATION_PHASES) ?? inferMigrationPhase(task),
		review_goal: enumValue$1(task.reviewGoal, REVIEW_GOALS) ?? inferReviewGoal(task, intent)
	};
}
function inferRiskLevel(task, intent) {
	if (task.projectStage === "critical") return "critical";
	if (task.optimizationTarget === "safety") return "high";
	if (intent.operation === "create" && intent.changed_files.length <= 1) return "low";
	return "medium";
}
function inferScopeSize(intent) {
	const files = [...new Set([intent.target_file, ...intent.changed_files].filter(Boolean))];
	if (!files.length) return "unknown";
	if (files.length === 1) return "single-file";
	return new Set(files.map((file) => file.split("/").slice(0, 2).join("/"))).size <= 1 ? "module" : "cross-cutting";
}
function inferCompatibilityRequirement(_task) {
	return "none";
}
function inferInterfaceSensitivity(intent) {
	return intent.target_file || intent.changed_files.length || intent.tags.length || intent.tech_stack.length ? "internal" : "unknown";
}
function inferRefactorTolerance(_task, intent) {
	if (intent.change_type === "refactor") return "bounded";
	return "local-only";
}
function inferMigrationPhase(_task) {
	return "none";
}
function inferReviewGoal(task, intent) {
	if (intent.change_type === "bugfix" || task.optimizationTarget === "safety") return "regression-risk";
	if (intent.workflow === "review") return "correctness";
	return "maintainability";
}
//#endregion
//#region src/interpret/deterministic-extractor.ts
var DeterministicInterpretationProvider = class {
	source = "deterministic";
	interpret(task) {
		const intent = parseIntent(task);
		const context = buildContextProfile(task, intent);
		const explicitWorkflow = hasEnumValue(task.workflow, WORKFLOWS);
		const explicitChangeType = hasEnumValue(task.changeType, CHANGE_TYPES);
		const explicitOperation = hasEnumValue(task.operation, OPERATIONS);
		const explicitProjectStage = hasEnumValue(task.projectStage, PROJECT_STAGES);
		const explicitOptimizationTarget = hasEnumValue(task.optimizationTarget, OPTIMIZATION_TARGETS);
		const explicitRiskLevel = hasEnumValue(task.riskLevel, RISK_LEVELS);
		const explicitScopeSize = hasEnumValue(task.scopeSize, SCOPE_SIZES);
		const explicitCompatibilityRequirement = hasEnumValue(task.compatibilityRequirement, COMPATIBILITY_REQUIREMENTS);
		const explicitInterfaceSensitivity = hasEnumValue(task.interfaceSensitivity, INTERFACE_SENSITIVITIES);
		const explicitRefactorTolerance = hasEnumValue(task.refactorTolerance, REFACTOR_TOLERANCES);
		const explicitMigrationPhase = hasEnumValue(task.migrationPhase, MIGRATION_PHASES);
		const explicitReviewGoal = hasEnumValue(task.reviewGoal, REVIEW_GOALS);
		return {
			intent: {
				workflow: toField(intent.workflow, explicitWorkflow ? "explicit" : "deterministic", explicitWorkflow ? 1 : .85, explicitWorkflow ? "provided directly via task input" : "default code workflow"),
				change_type: toField(intent.change_type, explicitChangeType ? "explicit" : "deterministic", explicitChangeType ? 1 : intent.change_type === "unknown" ? .35 : .6, explicitChangeType ? "provided directly via task input" : "conservative deterministic change-type fallback"),
				operation: toField(intent.operation, explicitOperation ? "explicit" : "deterministic", explicitOperation ? 1 : .5, explicitOperation ? "provided directly via task input" : "neutral deterministic default applied because no explicit operation was provided"),
				target_layer: toField(intent.target_layer, task.targetFile ? "explicit" : "deterministic", task.targetFile ? 1 : .6, task.targetFile ? "derived from explicit target file path" : "fallback module-level layer because no target file was provided"),
				tech_stack: toListField(intent.tech_stack, task.techStack?.length ? "explicit" : "deterministic", task.techStack?.length ? 1 : intent.tech_stack.length ? .55 : .2, task.techStack?.length ? "provided directly via task input" : "derived from explicit target file extension when available"),
				target_file: intent.target_file ? toField(intent.target_file, task.targetFile ? "explicit" : "deterministic", task.targetFile ? 1 : .65, task.targetFile ? "provided directly via task input" : "derived from normalized target file input") : unresolvedField("deterministic", "target file not explicitly provided"),
				changed_files: toListField(intent.changed_files, task.changedFiles?.length ? "explicit" : "deterministic", intent.changed_files.length ? 1 : .2, "derived from explicit changed files when available"),
				tags: toListField(intent.tags, task.tags?.length ? "explicit" : "deterministic", task.tags?.length ? 1 : intent.tags.length ? .55 : .2, task.tags?.length ? "provided directly via task input" : "derived from target file and changed-file test path signals")
			},
			context: {
				project_stage: context.project_stage ? toField(context.project_stage, explicitProjectStage ? "explicit" : "deterministic", explicitProjectStage ? 1 : .5, explicitProjectStage ? "provided directly via task input" : "not inferred strongly; carried through when available") : unresolvedField(explicitProjectStage ? "explicit" : "deterministic", "project stage not resolved"),
				optimization_target: toField(context.optimization_target, explicitOptimizationTarget ? "explicit" : "deterministic", explicitOptimizationTarget ? 1 : .55, explicitOptimizationTarget ? "provided directly via task input" : "stable fallback derived from resolved operation, not free-text policy extraction"),
				hard_constraints: toListField(context.hard_constraints, task.hardConstraints?.length ? "explicit" : "deterministic", task.hardConstraints?.length ? 1 : 0, task.hardConstraints?.length ? "provided directly via task input" : "left unresolved unless explicit constraints are provided"),
				allowed_tradeoffs: toListField(context.allowed_tradeoffs, task.allowedTradeoffs?.length ? "explicit" : "deterministic", task.allowedTradeoffs?.length ? 1 : 0, task.allowedTradeoffs?.length ? "provided directly via task input" : "left unresolved unless explicit tradeoffs are provided"),
				avoid: toListField(context.avoid, task.avoid?.length ? "explicit" : "deterministic", task.avoid?.length ? 1 : 0, task.avoid?.length ? "provided directly via task input" : "left unresolved unless explicit avoid guidance is provided"),
				risk_level: toField(context.risk_level, explicitRiskLevel ? "explicit" : "deterministic", explicitRiskLevel ? 1 : .65, explicitRiskLevel ? "provided directly via task input" : "neutral deterministic default derived from explicit project stage, optimization target, operation, and task shape"),
				scope_size: toField(context.scope_size, explicitScopeSize ? "explicit" : "deterministic", explicitScopeSize ? 1 : context.scope_size === "unknown" ? .35 : .8, explicitScopeSize ? "provided directly via task input" : "derived from target and changed-file spread"),
				compatibility_requirement: toField(context.compatibility_requirement, explicitCompatibilityRequirement ? "explicit" : "deterministic", explicitCompatibilityRequirement ? 1 : .5, explicitCompatibilityRequirement ? "provided directly via task input" : "neutral deterministic default; compatibility requirements must be explicit or supplied by task-model"),
				interface_sensitivity: toField(context.interface_sensitivity, explicitInterfaceSensitivity ? "explicit" : "deterministic", explicitInterfaceSensitivity ? 1 : context.interface_sensitivity === "unknown" ? .35 : .5, explicitInterfaceSensitivity ? "provided directly via task input" : "neutral deterministic default; sensitive interfaces must be explicit or supplied by task-model"),
				refactor_tolerance: toField(context.refactor_tolerance, explicitRefactorTolerance ? "explicit" : "deterministic", explicitRefactorTolerance ? 1 : .55, explicitRefactorTolerance ? "provided directly via task input" : "neutral deterministic default derived from the resolved operation only"),
				migration_phase: toField(context.migration_phase, explicitMigrationPhase ? "explicit" : "deterministic", explicitMigrationPhase ? 1 : .45, explicitMigrationPhase ? "provided directly via task input" : "neutral deterministic default; migration phase must be explicit or supplied by task-model"),
				review_goal: toField(context.review_goal, explicitReviewGoal ? "explicit" : "deterministic", explicitReviewGoal ? 1 : .55, explicitReviewGoal ? "provided directly via task input" : "neutral deterministic default derived from the resolved operation only")
			},
			uncertainties: [...context.project_stage ? [] : ["project_stage unresolved"], ...intent.target_file ? [] : ["target_file unresolved"]]
		};
	}
};
function toField(value, source, confidence, rationale) {
	return {
		value,
		source,
		confidence,
		status: "resolved",
		rationale
	};
}
function unresolvedField(source, rationale) {
	return {
		source,
		confidence: 0,
		status: "unresolved",
		rationale
	};
}
function toListField(values, source, confidence, rationale) {
	return {
		values,
		source,
		confidence,
		status: values.length ? "resolved" : "unresolved",
		rationale
	};
}
//#endregion
//#region src/interpret/normalize-candidate.ts
const deterministicProvider = new DeterministicInterpretationProvider();
const MIN_ASSISTIVE_CONTEXT_CONFIDENCE = .5;
const SCALAR_FIELD_SPECS = [
	{
		field: "intent.workflow",
		section: "intent",
		candidateKey: "workflow",
		explicitValue: (input) => input.task.workflow,
		fallbackValue: (det) => det.intent.workflow?.value ?? "code",
		defaultConfidence: (det) => det.intent.workflow?.confidence ?? .85,
		allowedValues: WORKFLOWS
	},
	{
		field: "intent.change_type",
		section: "intent",
		candidateKey: "change_type",
		explicitValue: (input) => input.task.changeType,
		fallbackValue: (det) => det.intent.change_type?.value ?? "unknown",
		defaultConfidence: (det) => det.intent.change_type?.confidence ?? .4,
		allowedValues: CHANGE_TYPES
	},
	{
		field: "intent.operation",
		section: "intent",
		candidateKey: "operation",
		explicitValue: (input) => input.task.operation,
		fallbackValue: (det) => det.intent.operation?.value ?? "modify",
		defaultConfidence: (det) => det.intent.operation?.confidence ?? .5,
		allowedValues: OPERATIONS
	},
	{
		field: "intent.target_file",
		section: "intent",
		candidateKey: "target_file",
		explicitValue: (input) => input.task.targetFile,
		fallbackValue: (det) => det.intent.target_file?.value,
		defaultConfidence: (det) => det.intent.target_file?.confidence ?? .65
	},
	{
		field: "context.project_stage",
		section: "context",
		candidateKey: "project_stage",
		explicitValue: (input) => input.task.projectStage,
		fallbackValue: (det) => det.context.project_stage?.value,
		defaultConfidence: (det) => det.context.project_stage?.confidence ?? .5,
		allowedValues: PROJECT_STAGES
	},
	{
		field: "context.optimization_target",
		section: "context",
		candidateKey: "optimization_target",
		explicitValue: (input) => input.task.optimizationTarget,
		fallbackValue: (det) => det.context.optimization_target?.value,
		defaultConfidence: (det) => det.context.optimization_target?.confidence ?? .55,
		allowedValues: OPTIMIZATION_TARGETS
	},
	{
		field: "context.risk_level",
		section: "context",
		candidateKey: "risk_level",
		explicitValue: (input) => input.task.riskLevel,
		fallbackValue: (det) => det.context.risk_level?.value ?? "medium",
		defaultConfidence: (det) => det.context.risk_level?.confidence ?? .65,
		allowedValues: RISK_LEVELS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.scope_size",
		section: "context",
		candidateKey: "scope_size",
		explicitValue: (input) => input.task.scopeSize,
		fallbackValue: (det) => det.context.scope_size?.value ?? "unknown",
		defaultConfidence: (det) => det.context.scope_size?.confidence ?? .35,
		allowedValues: SCOPE_SIZES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.compatibility_requirement",
		section: "context",
		candidateKey: "compatibility_requirement",
		explicitValue: (input) => input.task.compatibilityRequirement,
		fallbackValue: (det) => det.context.compatibility_requirement?.value ?? "none",
		defaultConfidence: (det) => det.context.compatibility_requirement?.confidence ?? .5,
		allowedValues: COMPATIBILITY_REQUIREMENTS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.interface_sensitivity",
		section: "context",
		candidateKey: "interface_sensitivity",
		explicitValue: (input) => input.task.interfaceSensitivity,
		fallbackValue: (det) => det.context.interface_sensitivity?.value ?? "unknown",
		defaultConfidence: (det) => det.context.interface_sensitivity?.confidence ?? .35,
		allowedValues: INTERFACE_SENSITIVITIES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.refactor_tolerance",
		section: "context",
		candidateKey: "refactor_tolerance",
		explicitValue: (input) => input.task.refactorTolerance,
		fallbackValue: (det) => det.context.refactor_tolerance?.value ?? "local-only",
		defaultConfidence: (det) => det.context.refactor_tolerance?.confidence ?? .65,
		allowedValues: REFACTOR_TOLERANCES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.migration_phase",
		section: "context",
		candidateKey: "migration_phase",
		explicitValue: (input) => input.task.migrationPhase,
		fallbackValue: (det) => det.context.migration_phase?.value ?? "none",
		defaultConfidence: (det) => det.context.migration_phase?.confidence ?? .45,
		allowedValues: MIGRATION_PHASES,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	},
	{
		field: "context.review_goal",
		section: "context",
		candidateKey: "review_goal",
		explicitValue: (input) => input.task.reviewGoal,
		fallbackValue: (det) => det.context.review_goal?.value ?? "maintainability",
		defaultConfidence: (det) => det.context.review_goal?.confidence ?? .65,
		allowedValues: REVIEW_GOALS,
		minimumCandidateConfidence: MIN_ASSISTIVE_CONTEXT_CONFIDENCE
	}
];
const LIST_FIELD_SPECS = [
	{
		field: "intent.changed_files",
		section: "intent",
		candidateKey: "changed_files",
		explicitValues: (input) => input.task.changedFiles,
		fallbackValues: (det) => det.intent.changed_files?.values ?? [],
		defaultConfidence: (det) => det.intent.changed_files?.confidence ?? .2
	},
	{
		field: "intent.tech_stack",
		section: "intent",
		candidateKey: "tech_stack",
		explicitValues: (input) => input.task.techStack,
		fallbackValues: (det) => det.intent.tech_stack?.values ?? [],
		defaultConfidence: (det) => det.intent.tech_stack?.confidence ?? .3
	},
	{
		field: "intent.tags",
		section: "intent",
		candidateKey: "tags",
		explicitValues: (input) => input.task.tags,
		fallbackValues: (det) => det.intent.tags?.values ?? [],
		defaultConfidence: (det) => det.intent.tags?.confidence ?? .3
	},
	{
		field: "context.hard_constraints",
		section: "context",
		candidateKey: "hard_constraints",
		explicitValues: (input) => input.task.hardConstraints,
		fallbackValues: (det) => det.context.hard_constraints?.values ?? [],
		defaultConfidence: (det) => det.context.hard_constraints?.confidence ?? .2
	},
	{
		field: "context.allowed_tradeoffs",
		section: "context",
		candidateKey: "allowed_tradeoffs",
		explicitValues: (input) => input.task.allowedTradeoffs,
		fallbackValues: (det) => det.context.allowed_tradeoffs?.values ?? [],
		defaultConfidence: (det) => det.context.allowed_tradeoffs?.confidence ?? .2
	},
	{
		field: "context.avoid",
		section: "context",
		candidateKey: "avoid",
		explicitValues: (input) => input.task.avoid,
		fallbackValues: (det) => det.context.avoid?.values ?? [],
		defaultConfidence: (det) => det.context.avoid?.confidence ?? .2
	}
];
function resolveTask(input) {
	const deterministicCandidate = deterministicProvider.interpret(input.task);
	const candidates = [...(input.taskModels ?? []).map(taskModelToCandidate), deterministicCandidate];
	const conflicts = [];
	const discardedInputs = [];
	const scalarResults = /* @__PURE__ */ new Map();
	for (const spec of SCALAR_FIELD_SPECS) scalarResults.set(spec.field, resolveField({
		field: spec.field,
		explicitValue: spec.explicitValue(input),
		candidates: candidates.map((candidate) => {
			return (spec.section === "intent" ? candidate.intent : candidate.context)[spec.candidateKey];
		}),
		fallbackValue: spec.fallbackValue(deterministicCandidate),
		defaultSource: "deterministic",
		defaultConfidence: spec.defaultConfidence(deterministicCandidate),
		...spec.allowedValues ? { allowedValues: spec.allowedValues } : {},
		...spec.minimumCandidateConfidence !== void 0 ? { minimumCandidateConfidence: spec.minimumCandidateConfidence } : {},
		conflicts,
		discardedInputs
	}));
	const listResults = /* @__PURE__ */ new Map();
	for (const spec of LIST_FIELD_SPECS) listResults.set(spec.field, resolveListField({
		field: spec.field,
		explicitValues: spec.explicitValues(input),
		candidates: candidates.map((candidate) => {
			return (spec.section === "intent" ? candidate.intent : candidate.context)[spec.candidateKey];
		}),
		fallbackValues: spec.fallbackValues(deterministicCandidate),
		defaultSource: "deterministic",
		defaultConfidence: spec.defaultConfidence(deterministicCandidate),
		conflicts
	}));
	const scalar = (field) => scalarResults.get(field);
	const list = (field) => listResults.get(field);
	const task = {
		description: input.task.description,
		workflow: scalar("intent.workflow").value,
		changeType: scalar("intent.change_type").value,
		operation: scalar("intent.operation").value,
		targetFile: scalar("intent.target_file").value,
		changedFiles: list("intent.changed_files").values,
		techStack: list("intent.tech_stack").values,
		tags: list("intent.tags").values,
		projectStage: scalar("context.project_stage").value,
		optimizationTarget: scalar("context.optimization_target").value,
		hardConstraints: list("context.hard_constraints").values,
		allowedTradeoffs: list("context.allowed_tradeoffs").values,
		avoid: list("context.avoid").values,
		riskLevel: scalar("context.risk_level").value,
		scopeSize: scalar("context.scope_size").value,
		compatibilityRequirement: scalar("context.compatibility_requirement").value,
		interfaceSensitivity: scalar("context.interface_sensitivity").value,
		refactorTolerance: scalar("context.refactor_tolerance").value,
		migrationPhase: scalar("context.migration_phase").value,
		reviewGoal: scalar("context.review_goal").value
	};
	const resolvedTargetFile = scalar("intent.target_file").value;
	const intent = {
		workflow: scalar("intent.workflow").value,
		change_type: scalar("intent.change_type").value,
		operation: scalar("intent.operation").value,
		target_layer: inferTargetLayer(resolvedTargetFile),
		tech_stack: uniqueCompact(list("intent.tech_stack").values),
		target_file: resolvedTargetFile,
		changed_files: uniqueCompact(list("intent.changed_files").values),
		tags: uniqueCompact(list("intent.tags").values)
	};
	const contextProfile = {
		project_stage: scalar("context.project_stage").value,
		optimization_target: scalar("context.optimization_target").value,
		hard_constraints: uniqueCompact(list("context.hard_constraints").values),
		allowed_tradeoffs: uniqueCompact(list("context.allowed_tradeoffs").values),
		avoid: uniqueCompact(list("context.avoid").values),
		risk_level: scalar("context.risk_level").value,
		scope_size: scalar("context.scope_size").value,
		compatibility_requirement: scalar("context.compatibility_requirement").value,
		interface_sensitivity: scalar("context.interface_sensitivity").value,
		refactor_tolerance: scalar("context.refactor_tolerance").value,
		migration_phase: scalar("context.migration_phase").value,
		review_goal: scalar("context.review_goal").value
	};
	const provenance = buildProvenance$1(input, {
		workflow: scalar("intent.workflow"),
		change_type: scalar("intent.change_type"),
		operation: scalar("intent.operation"),
		target_file: scalar("intent.target_file"),
		changed_files: list("intent.changed_files"),
		tech_stack: list("intent.tech_stack"),
		tags: list("intent.tags"),
		project_stage: scalar("context.project_stage"),
		optimization_target: scalar("context.optimization_target"),
		hard_constraints: list("context.hard_constraints"),
		allowed_tradeoffs: list("context.allowed_tradeoffs"),
		avoid: list("context.avoid"),
		risk_level: scalar("context.risk_level"),
		scope_size: scalar("context.scope_size"),
		compatibility_requirement: scalar("context.compatibility_requirement"),
		interface_sensitivity: scalar("context.interface_sensitivity"),
		refactor_tolerance: scalar("context.refactor_tolerance"),
		migration_phase: scalar("context.migration_phase"),
		review_goal: scalar("context.review_goal")
	}, conflicts);
	const trace = buildTrace(input, candidates, provenance, conflicts);
	const diagnostics = buildDiagnostics(input, candidates, provenance, conflicts, discardedInputs);
	return {
		task,
		workflow: scalar("intent.workflow").value,
		task_models: input.taskModels ?? [],
		task_intent: intent,
		context_profile: contextProfile,
		input_provenance: provenance,
		diagnostics,
		trace
	};
}
function resolveField({ field, explicitValue, candidates, fallbackValue, defaultSource, defaultConfidence, allowedValues, minimumCandidateConfidence = 0, conflicts, discardedInputs }) {
	const resolvedCandidates = candidates.filter((candidate) => {
		if (candidate === void 0 || candidate.status !== "resolved") return false;
		if (candidate.value === void 0) {
			recordDiscarded(discardedInputs, field, "", candidate.source, "missing-value", fallbackValue);
			return false;
		}
		if (candidate.confidence < minimumCandidateConfidence) {
			recordDiscarded(discardedInputs, field, candidate.value, candidate.source, "below-confidence-threshold", fallbackValue);
			return false;
		}
		if (allowedValues && !allowedValues.includes(candidate.value)) {
			recordDiscarded(discardedInputs, field, candidate.value, candidate.source, "invalid-enum", fallbackValue);
			return false;
		}
		return true;
	});
	if (explicitValue !== void 0) if (allowedValues && !allowedValues.includes(explicitValue)) recordDiscarded(discardedInputs, field, explicitValue, "explicit", "invalid-enum", fallbackValue);
	else {
		registerConflict(field, "explicit", resolvedCandidates.map((candidate) => candidate.source), conflicts, "explicit task input takes precedence");
		return {
			value: explicitValue,
			source: "explicit",
			confidence: 1,
			status: "resolved"
		};
	}
	if (resolvedCandidates.length > 0) {
		const ordered = resolvedCandidates.slice().sort(compareCandidateField);
		const winner = ordered[0];
		registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, "field-level evidence/confidence policy selected the strongest candidate");
		return {
			value: winner.value,
			source: winner.source,
			confidence: winner.confidence,
			status: "resolved"
		};
	}
	return {
		value: fallbackValue,
		source: defaultSource,
		confidence: defaultConfidence,
		status: "resolved"
	};
}
function resolveListField({ field, explicitValues, candidates, fallbackValues, defaultSource, defaultConfidence, conflicts }) {
	if (explicitValues?.length) {
		registerConflict(field, "explicit", candidates.filter(Boolean).map((candidate) => candidate?.source ?? "deterministic"), conflicts, "explicit task input takes precedence");
		return {
			values: uniqueCompact(explicitValues),
			source: "explicit",
			confidence: 1,
			status: "resolved"
		};
	}
	const resolvedCandidates = candidates.filter((candidate) => candidate !== void 0 && candidate.status === "resolved" && candidate.values.length > 0);
	if (resolvedCandidates.length > 0) {
		const ordered = resolvedCandidates.slice().sort(compareCandidateListField);
		const winner = ordered[0];
		registerConflict(field, winner.source, ordered.slice(1).map((candidate) => candidate.source), conflicts, "field-level evidence/confidence policy selected the strongest candidate");
		return {
			values: uniqueCompact(winner.values),
			source: winner.source,
			confidence: winner.confidence,
			status: "resolved"
		};
	}
	const fallback = uniqueCompact(fallbackValues);
	return {
		values: fallback,
		source: defaultSource,
		confidence: defaultConfidence,
		status: fallback.length ? "resolved" : "unresolved"
	};
}
function buildProvenance$1(input, resolved, conflicts) {
	const resolved_fields = [
		summarizeScalarField("intent.workflow", resolved.workflow),
		summarizeScalarField("intent.change_type", resolved.change_type),
		summarizeScalarField("intent.operation", resolved.operation),
		summarizeScalarField("intent.target_file", resolved.target_file),
		summarizeListField("intent.changed_files", resolved.changed_files),
		summarizeListField("intent.tech_stack", resolved.tech_stack),
		summarizeListField("intent.tags", resolved.tags),
		summarizeScalarField("context.project_stage", resolved.project_stage),
		summarizeScalarField("context.optimization_target", resolved.optimization_target),
		summarizeListField("context.hard_constraints", resolved.hard_constraints),
		summarizeListField("context.allowed_tradeoffs", resolved.allowed_tradeoffs),
		summarizeListField("context.avoid", resolved.avoid),
		summarizeScalarField("context.risk_level", resolved.risk_level),
		summarizeScalarField("context.scope_size", resolved.scope_size),
		summarizeScalarField("context.compatibility_requirement", resolved.compatibility_requirement),
		summarizeScalarField("context.interface_sensitivity", resolved.interface_sensitivity),
		summarizeScalarField("context.refactor_tolerance", resolved.refactor_tolerance),
		summarizeScalarField("context.migration_phase", resolved.migration_phase),
		summarizeScalarField("context.review_goal", resolved.review_goal)
	].filter((item) => Boolean(item));
	return {
		resolved_fields,
		unresolved_fields: [
			...resolved.change_type.value === "unknown" ? ["intent.change_type"] : [],
			...resolved.target_file.value ? [] : ["intent.target_file"],
			...resolved.project_stage.value ? [] : ["context.project_stage"]
		],
		context_resolution: buildContextResolution(resolved, conflicts),
		interpretation_mode: input.interpretationMode ?? (input.taskModels?.length ? "host-agent" : "deterministic-only"),
		resolution_quality: determineResolutionQuality(resolved_fields)
	};
}
function buildTrace(input, candidates, provenance, conflicts) {
	const candidate_summaries = candidates.map((candidate) => summarizeCandidate(candidate));
	return {
		mode: provenance.interpretation_mode,
		candidate_summaries,
		conflicts,
		selected_sources: provenance.resolved_fields.map((field) => ({
			field: field.field,
			source: field.source,
			confidence: field.confidence
		}))
	};
}
function buildContextResolution(resolved, conflicts) {
	return [
		contextScalar("context.project_stage", resolved.project_stage, conflicts),
		contextScalar("context.optimization_target", resolved.optimization_target, conflicts),
		contextList("context.hard_constraints", resolved.hard_constraints, conflicts),
		contextList("context.allowed_tradeoffs", resolved.allowed_tradeoffs, conflicts),
		contextList("context.avoid", resolved.avoid, conflicts),
		contextScalar("context.risk_level", resolved.risk_level, conflicts),
		contextScalar("context.scope_size", resolved.scope_size, conflicts),
		contextScalar("context.compatibility_requirement", resolved.compatibility_requirement, conflicts),
		contextScalar("context.interface_sensitivity", resolved.interface_sensitivity, conflicts),
		contextScalar("context.refactor_tolerance", resolved.refactor_tolerance, conflicts),
		contextScalar("context.migration_phase", resolved.migration_phase, conflicts),
		contextScalar("context.review_goal", resolved.review_goal, conflicts)
	];
}
function contextScalar(field, resolved, conflicts) {
	const value = resolved.value === void 0 ? "" : String(resolved.value);
	return {
		field,
		value,
		source: resolved.source,
		confidence: resolved.confidence,
		status: contextResolutionStatus(field, resolved.source, resolved.value === void 0, conflicts),
		influence: contextInfluenceHints(field, value, resolved.source)
	};
}
function contextList(field, resolved, conflicts) {
	return {
		field,
		value: resolved.values,
		source: resolved.source,
		confidence: resolved.confidence,
		status: contextResolutionStatus(field, resolved.source, resolved.values.length === 0, conflicts),
		influence: contextInfluenceHints(field, resolved.values.join(","), resolved.source)
	};
}
function contextResolutionStatus(field, source, unresolved, conflicts) {
	if (conflicts.some((conflict) => conflict.field === field)) return "conflicted";
	if (unresolved) return "unresolved";
	return source === "deterministic" || source === "repo-default" ? "defaulted" : "resolved";
}
function contextInfluenceHints(field, value, source) {
	if (source === "deterministic") return [];
	switch (field) {
		case "context.risk_level": return value === "high" || value === "critical" ? ["review-focus-priority", "must-guidance-preservation"] : [];
		case "context.scope_size": return value === "single-file" ? ["broad-guidance-ambient"] : [];
		case "context.compatibility_requirement": return value && value !== "none" && value !== "breaking-allowed" ? ["compatibility-tension"] : [];
		case "context.interface_sensitivity": return value && value !== "internal" && value !== "unknown" ? ["review-focus-priority"] : [];
		case "context.refactor_tolerance": return value === "none" || value === "local-only" ? ["broad-guidance-ambient"] : [];
		case "context.migration_phase": return value === "dual-run" || value === "cutover" ? ["migration-tension"] : [];
		case "context.review_goal": return value === "security" || value === "regression-risk" ? ["review-focus-priority"] : [];
		default: return [];
	}
}
function buildDiagnostics(input, candidates, provenance, conflicts, discardedInputs) {
	const ambiguity_reasons = [
		...candidates.flatMap((candidate) => candidate.uncertainties ?? []),
		...provenance.unresolved_fields.map((item) => `${item} unresolved`),
		...conflicts.map((conflict) => `conflicting candidates for ${conflict.field}`)
	];
	const discarded = uniqueDiscardedInputs(discardedInputs);
	return {
		warnings: [...ambiguity_reasons.map((item) => `interpretation warning: ${item}`), ...discarded.map((item) => `interpretation discarded ${item.source} ${item.field}=${item.value || "(empty)"}: ${item.reason}`)],
		fallback_usage: {
			used_deterministic_interpretation: provenance.resolved_fields.some((field) => field.source === "deterministic"),
			used_candidate_normalization: Boolean(input.taskModels?.length)
		},
		clarification_recommended: ambiguity_reasons.length > 0 && (!input.taskModels?.length || conflicts.length > 0),
		ambiguity_reasons,
		discarded_inputs: discarded
	};
}
function recordDiscarded(discardedInputs, field, value, source, reason, fallbackValue) {
	if (source === "deterministic") return;
	discardedInputs.push({
		field,
		value: value === void 0 ? "" : String(value),
		source,
		reason,
		action: "discarded",
		...fallbackValue === void 0 ? {} : { fallback: String(fallbackValue) }
	});
}
function uniqueDiscardedInputs(items) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const item of items) {
		const key = `${item.field}:${item.value}:${item.source}:${item.reason}:${item.fallback ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}
	return result;
}
function summarizeCandidate(candidate) {
	const scalarFields = [
		["intent.workflow", candidate.intent.workflow],
		["intent.change_type", candidate.intent.change_type],
		["intent.operation", candidate.intent.operation],
		["intent.target_layer", candidate.intent.target_layer],
		["intent.target_file", candidate.intent.target_file],
		["context.project_stage", candidate.context.project_stage],
		["context.optimization_target", candidate.context.optimization_target],
		["context.risk_level", candidate.context.risk_level],
		["context.scope_size", candidate.context.scope_size],
		["context.compatibility_requirement", candidate.context.compatibility_requirement],
		["context.interface_sensitivity", candidate.context.interface_sensitivity],
		["context.refactor_tolerance", candidate.context.refactor_tolerance],
		["context.migration_phase", candidate.context.migration_phase],
		["context.review_goal", candidate.context.review_goal]
	];
	const listFields = [
		["intent.tech_stack", candidate.intent.tech_stack],
		["intent.changed_files", candidate.intent.changed_files],
		["intent.tags", candidate.intent.tags],
		["context.hard_constraints", candidate.context.hard_constraints],
		["context.allowed_tradeoffs", candidate.context.allowed_tradeoffs],
		["context.avoid", candidate.context.avoid]
	];
	const resolved_fields = [...scalarFields.filter(([, field]) => field?.status === "resolved").map(([name]) => name), ...listFields.filter(([, field]) => field?.status === "resolved" && field.values.length > 0).map(([name]) => name)];
	const unresolved_fields = [...scalarFields.filter(([, field]) => !field || field.status !== "resolved").map(([name]) => name), ...listFields.filter(([, field]) => !field || field.status !== "resolved" || field.values.length === 0).map(([name]) => name)];
	const source = candidate.intent.workflow?.source ?? candidate.intent.change_type?.source ?? candidate.intent.operation?.source ?? candidate.intent.target_file?.source ?? candidate.context.optimization_target?.source ?? "deterministic";
	const confidenceValues = [
		candidate.intent.workflow?.confidence,
		candidate.intent.change_type?.confidence,
		candidate.intent.operation?.confidence,
		candidate.intent.target_layer?.confidence,
		candidate.intent.target_file?.confidence,
		candidate.intent.tech_stack?.confidence,
		candidate.intent.changed_files?.confidence,
		candidate.intent.tags?.confidence,
		candidate.context.project_stage?.confidence,
		candidate.context.optimization_target?.confidence,
		candidate.context.hard_constraints?.confidence,
		candidate.context.allowed_tradeoffs?.confidence,
		candidate.context.avoid?.confidence,
		candidate.context.risk_level?.confidence,
		candidate.context.scope_size?.confidence,
		candidate.context.compatibility_requirement?.confidence,
		candidate.context.interface_sensitivity?.confidence,
		candidate.context.refactor_tolerance?.confidence,
		candidate.context.migration_phase?.confidence,
		candidate.context.review_goal?.confidence
	].filter((value) => typeof value === "number");
	return {
		source,
		confidence: confidenceValues.length ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2)) : 0,
		resolved_fields,
		unresolved_fields
	};
}
function taskModelToCandidate(model) {
	return {
		intent: {
			workflow: scalarField(model.intent.workflow),
			change_type: scalarField(model.intent.change_type),
			operation: scalarField(model.intent.operation),
			target_layer: scalarField(model.intent.target_layer),
			target_file: scalarField(model.intent.target_file),
			changed_files: listField(model.intent.changed_files),
			tech_stack: listField(model.intent.tech_stack),
			tags: listField(model.intent.tags)
		},
		context: {
			project_stage: scalarField(model.context.project_stage),
			optimization_target: scalarField(model.context.optimization_target),
			hard_constraints: listField(model.context.hard_constraints),
			allowed_tradeoffs: listField(model.context.allowed_tradeoffs),
			avoid: listField(model.context.avoid),
			risk_level: scalarField(model.context.risk_level),
			scope_size: scalarField(model.context.scope_size),
			compatibility_requirement: scalarField(model.context.compatibility_requirement),
			interface_sensitivity: scalarField(model.context.interface_sensitivity),
			refactor_tolerance: scalarField(model.context.refactor_tolerance),
			migration_phase: scalarField(model.context.migration_phase),
			review_goal: scalarField(model.context.review_goal)
		},
		uncertainties: model.uncertainties
	};
}
function scalarField(field) {
	if (!field || field.value === void 0) return void 0;
	return {
		value: field.value,
		source: "host-agent",
		confidence: field.confidence,
		status: "resolved",
		rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(", ")}`
	};
}
function listField(field) {
	if (!field) return void 0;
	return {
		values: field.values,
		source: "host-agent",
		confidence: field.confidence,
		status: field.values.length ? "resolved" : "unresolved",
		rationale: `task-model evidence_refs=${field.evidence_refs.map((ref) => ref.ref).join(", ")}`
	};
}
function compareCandidateField(left, right) {
	return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence;
}
function compareCandidateListField(left, right) {
	return sourceRank(right.source) - sourceRank(left.source) || right.confidence - left.confidence || right.values.length - left.values.length;
}
function sourceRank(source) {
	switch (source) {
		case "explicit": return 5;
		case "host-agent":
		case "assistive-ai": return 4;
		case "derived": return 3;
		case "repo-default": return 2;
		case "deterministic": return 1;
	}
}
function summarizeScalarField(field, resolved) {
	if (resolved.value === void 0) return null;
	return {
		field,
		source: resolved.source,
		confidence: resolved.confidence
	};
}
function summarizeListField(field, resolved) {
	if (!resolved.values.length) return null;
	return {
		field,
		source: resolved.source,
		confidence: resolved.confidence
	};
}
function determineResolutionQuality(resolvedFields) {
	if (resolvedFields.every((field) => field.source === "explicit")) return "explicit";
	if (resolvedFields.some((field) => field.source === "host-agent" || field.source === "assistive-ai")) return "ai-assisted";
	if (resolvedFields.some((field) => field.source === "deterministic")) return "deterministic";
	return "degraded";
}
function registerConflict(field, winner, discarded, conflicts, rationale) {
	const uniqueDiscarded = [...new Set(discarded.filter((source) => source !== winner))];
	if (!uniqueDiscarded.length) return;
	conflicts.push({
		field,
		winner,
		discarded: uniqueDiscarded,
		rationale
	});
}
//#endregion
//#region src/ir/activation/resolve-activation.ts
function resolveActivationDecisionsIR(bundle) {
	return sortActivationDecisions(bundle.directives.map((directive) => resolveDirectiveActivation(directive, bundle.task)));
}
function activatedDirectiveIdsIR(decisions) {
	return new Set(decisions.filter((decision) => decision.status === "activated").map((decision) => decision.directiveId));
}
function resolveDirectiveActivation(directive, task) {
	if (directive.local.suppressed) return buildSkippedDecision(directive, "suppressed-by-local", directive.local.suppressionReason ? `directive suppressed by local playbook: ${directive.local.suppressionReason}` : "directive suppressed by local playbook");
	if (!layerMatchesTask(directive, task)) return buildSkippedDecision(directive, "layer-mismatch", "directive layer does not match resolved task intent");
	if (!scopeMatchesTask$2(directive.scope.path, task)) return buildSkippedDecision(directive, "scope-mismatch", "directive scope does not match target or changed files");
	return {
		directiveId: directive.id,
		layerId: directive.layer.id,
		sourcePath: directive.source.path,
		status: "activated",
		reason: "matched",
		note: buildActivationNote(directive, task),
		effectivePrescription: directive.prescription,
		effectiveWeight: directive.weight,
		priority: directive.priority,
		localState: directive.local
	};
}
function buildSkippedDecision(directive, reason, note) {
	return {
		directiveId: directive.id,
		layerId: directive.layer.id,
		sourcePath: directive.source.path,
		status: "skipped",
		reason,
		note,
		effectivePrescription: directive.prescription,
		effectiveWeight: directive.weight,
		priority: directive.priority,
		localState: directive.local
	};
}
function buildActivationNote(directive, task) {
	const reasons = [`directive matched ${task.workflow}/${task.changeType}/${task.operation} task context`];
	if (directive.source.kind === "local-playbook") reasons.push("local directive addition applied");
	if (directive.local.overrideApplied) reasons.push("local override applied");
	if (directive.local.augmentApplied) reasons.push("local examples augment applied");
	if (directive.layer.id === "builtin/core") reasons.push("core guidance always eligible");
	return reasons.join("; ");
}
function layerMatchesTask(directive, task) {
	const sourceLayer = directive.layer.id;
	if (sourceLayer === "builtin/core" || directive.source.kind === "local-playbook" || sourceLayer.startsWith("local")) return true;
	if (sourceLayer.startsWith("builtin/task-types/")) return task.changeType !== "unknown" && sourceLayer.endsWith(`/${task.changeType}`);
	if (sourceLayer.startsWith("builtin/languages/")) return task.techStack.some((tech) => sourceLayer.endsWith(`/${tech}`));
	if (sourceLayer.startsWith("builtin/frameworks/")) return task.techStack.some((tech) => sourceLayer.endsWith(`/${tech}`));
	return true;
}
function scopeMatchesTask$2(scope, task) {
	if (task.targets.length === 0) return true;
	return task.targets.some((target) => minimatch(target.path, scope));
}
function sortActivationDecisions(items) {
	return [...items].sort((a, b) => {
		if (a.status !== b.status) return a.status === "activated" ? -1 : 1;
		if (a.priority.prescriptionRank !== b.priority.prescriptionRank) return b.priority.prescriptionRank - a.priority.prescriptionRank;
		if (a.priority.layerRank !== b.priority.layerRank) return b.priority.layerRank - a.priority.layerRank;
		if (a.priority.weightRank !== b.priority.weightRank) return b.priority.weightRank - a.priority.weightRank;
		if (a.priority.localOverrideRank !== b.priority.localOverrideRank) return b.priority.localOverrideRank - a.priority.localOverrideRank;
		return a.directiveId.localeCompare(b.directiveId);
	});
}
//#endregion
//#region ../node_modules/yaml/dist/nodes/identity.js
var require_identity = /* @__PURE__ */ __commonJSMin(((exports) => {
	const ALIAS = Symbol.for("yaml.alias");
	const DOC = Symbol.for("yaml.document");
	const MAP = Symbol.for("yaml.map");
	const PAIR = Symbol.for("yaml.pair");
	const SCALAR = Symbol.for("yaml.scalar");
	const SEQ = Symbol.for("yaml.seq");
	const NODE_TYPE = Symbol.for("yaml.node.type");
	const isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
	const isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
	const isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
	const isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
	const isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
	const isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
	function isCollection(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case MAP:
			case SEQ: return true;
		}
		return false;
	}
	function isNode(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case ALIAS:
			case MAP:
			case SCALAR:
			case SEQ: return true;
		}
		return false;
	}
	const hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
	exports.ALIAS = ALIAS;
	exports.DOC = DOC;
	exports.MAP = MAP;
	exports.NODE_TYPE = NODE_TYPE;
	exports.PAIR = PAIR;
	exports.SCALAR = SCALAR;
	exports.SEQ = SEQ;
	exports.hasAnchor = hasAnchor;
	exports.isAlias = isAlias;
	exports.isCollection = isCollection;
	exports.isDocument = isDocument;
	exports.isMap = isMap;
	exports.isNode = isNode;
	exports.isPair = isPair;
	exports.isScalar = isScalar;
	exports.isSeq = isSeq;
}));
//#endregion
//#region ../node_modules/yaml/dist/visit.js
var require_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove node");
	/**
	* Apply a visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	function visit(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (visit_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else visit_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visit.SKIP = SKIP;
	/** Remove the current node */
	visit.REMOVE = REMOVE;
	function visit_(key, node, visitor, path) {
		const ctrl = callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visit_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = visit_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = visit_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = visit_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	/**
	* Apply an async visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `Promise`: Must resolve to one of the following values
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	async function visitAsync(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (await visitAsync_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else await visitAsync_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visitAsync.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visitAsync.SKIP = SKIP;
	/** Remove the current node */
	visitAsync.REMOVE = REMOVE;
	async function visitAsync_(key, node, visitor, path) {
		const ctrl = await callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visitAsync_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = await visitAsync_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = await visitAsync_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = await visitAsync_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	function initVisitor(visitor) {
		if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) return Object.assign({
			Alias: visitor.Node,
			Map: visitor.Node,
			Scalar: visitor.Node,
			Seq: visitor.Node
		}, visitor.Value && {
			Map: visitor.Value,
			Scalar: visitor.Value,
			Seq: visitor.Value
		}, visitor.Collection && {
			Map: visitor.Collection,
			Seq: visitor.Collection
		}, visitor);
		return visitor;
	}
	function callVisitor(key, node, visitor, path) {
		if (typeof visitor === "function") return visitor(key, node, path);
		if (identity.isMap(node)) return visitor.Map?.(key, node, path);
		if (identity.isSeq(node)) return visitor.Seq?.(key, node, path);
		if (identity.isPair(node)) return visitor.Pair?.(key, node, path);
		if (identity.isScalar(node)) return visitor.Scalar?.(key, node, path);
		if (identity.isAlias(node)) return visitor.Alias?.(key, node, path);
	}
	function replaceNode(key, path, node) {
		const parent = path[path.length - 1];
		if (identity.isCollection(parent)) parent.items[key] = node;
		else if (identity.isPair(parent)) if (key === "key") parent.key = node;
		else parent.value = node;
		else if (identity.isDocument(parent)) parent.contents = node;
		else {
			const pt = identity.isAlias(parent) ? "alias" : "scalar";
			throw new Error(`Cannot replace node with ${pt} parent`);
		}
	}
	exports.visit = visit;
	exports.visitAsync = visitAsync;
}));
//#endregion
//#region ../node_modules/yaml/dist/doc/directives.js
var require_directives = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	const escapeChars = {
		"!": "%21",
		",": "%2C",
		"[": "%5B",
		"]": "%5D",
		"{": "%7B",
		"}": "%7D"
	};
	const escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
	var Directives = class Directives {
		constructor(yaml, tags) {
			/**
			* The directives-end/doc-start marker `---`. If `null`, a marker may still be
			* included in the document's stringified representation.
			*/
			this.docStart = null;
			/** The doc-end marker `...`.  */
			this.docEnd = false;
			this.yaml = Object.assign({}, Directives.defaultYaml, yaml);
			this.tags = Object.assign({}, Directives.defaultTags, tags);
		}
		clone() {
			const copy = new Directives(this.yaml, this.tags);
			copy.docStart = this.docStart;
			return copy;
		}
		/**
		* During parsing, get a Directives instance for the current document and
		* update the stream state according to the current version's spec.
		*/
		atDocument() {
			const res = new Directives(this.yaml, this.tags);
			switch (this.yaml.version) {
				case "1.1":
					this.atNextDocument = true;
					break;
				case "1.2":
					this.atNextDocument = false;
					this.yaml = {
						explicit: Directives.defaultYaml.explicit,
						version: "1.2"
					};
					this.tags = Object.assign({}, Directives.defaultTags);
					break;
			}
			return res;
		}
		/**
		* @param onError - May be called even if the action was successful
		* @returns `true` on success
		*/
		add(line, onError) {
			if (this.atNextDocument) {
				this.yaml = {
					explicit: Directives.defaultYaml.explicit,
					version: "1.1"
				};
				this.tags = Object.assign({}, Directives.defaultTags);
				this.atNextDocument = false;
			}
			const parts = line.trim().split(/[ \t]+/);
			const name = parts.shift();
			switch (name) {
				case "%TAG": {
					if (parts.length !== 2) {
						onError(0, "%TAG directive should contain exactly two parts");
						if (parts.length < 2) return false;
					}
					const [handle, prefix] = parts;
					this.tags[handle] = prefix;
					return true;
				}
				case "%YAML": {
					this.yaml.explicit = true;
					if (parts.length !== 1) {
						onError(0, "%YAML directive should contain exactly one part");
						return false;
					}
					const [version] = parts;
					if (version === "1.1" || version === "1.2") {
						this.yaml.version = version;
						return true;
					} else {
						const isValid = /^\d+\.\d+$/.test(version);
						onError(6, `Unsupported YAML version ${version}`, isValid);
						return false;
					}
				}
				default:
					onError(0, `Unknown directive ${name}`, true);
					return false;
			}
		}
		/**
		* Resolves a tag, matching handles to those defined in %TAG directives.
		*
		* @returns Resolved tag, which may also be the non-specific tag `'!'` or a
		*   `'!local'` tag, or `null` if unresolvable.
		*/
		tagName(source, onError) {
			if (source === "!") return "!";
			if (source[0] !== "!") {
				onError(`Not a valid tag: ${source}`);
				return null;
			}
			if (source[1] === "<") {
				const verbatim = source.slice(2, -1);
				if (verbatim === "!" || verbatim === "!!") {
					onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
					return null;
				}
				if (source[source.length - 1] !== ">") onError("Verbatim tags must end with a >");
				return verbatim;
			}
			const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
			if (!suffix) onError(`The ${source} tag has no suffix`);
			const prefix = this.tags[handle];
			if (prefix) try {
				return prefix + decodeURIComponent(suffix);
			} catch (error) {
				onError(String(error));
				return null;
			}
			if (handle === "!") return source;
			onError(`Could not resolve tag: ${source}`);
			return null;
		}
		/**
		* Given a fully resolved tag, returns its printable string form,
		* taking into account current tag prefixes and defaults.
		*/
		tagString(tag) {
			for (const [handle, prefix] of Object.entries(this.tags)) if (tag.startsWith(prefix)) return handle + escapeTagName(tag.substring(prefix.length));
			return tag[0] === "!" ? tag : `!<${tag}>`;
		}
		toString(doc) {
			const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
			const tagEntries = Object.entries(this.tags);
			let tagNames;
			if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
				const tags = {};
				visit.visit(doc.contents, (_key, node) => {
					if (identity.isNode(node) && node.tag) tags[node.tag] = true;
				});
				tagNames = Object.keys(tags);
			} else tagNames = [];
			for (const [handle, prefix] of tagEntries) {
				if (handle === "!!" && prefix === "tag:yaml.org,2002:") continue;
				if (!doc || tagNames.some((tn) => tn.startsWith(prefix))) lines.push(`%TAG ${handle} ${prefix}`);
			}
			return lines.join("\n");
		}
	};
	Directives.defaultYaml = {
		explicit: false,
		version: "1.2"
	};
	Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
	exports.Directives = Directives;
}));
//#endregion
//#region ../node_modules/yaml/dist/doc/anchors.js
var require_anchors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	/**
	* Verify that the input string is a valid anchor.
	*
	* Will throw on errors.
	*/
	function anchorIsValid(anchor) {
		if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
			const msg = `Anchor must not contain whitespace or control characters: ${JSON.stringify(anchor)}`;
			throw new Error(msg);
		}
		return true;
	}
	function anchorNames(root) {
		const anchors = /* @__PURE__ */ new Set();
		visit.visit(root, { Value(_key, node) {
			if (node.anchor) anchors.add(node.anchor);
		} });
		return anchors;
	}
	/** Find a new anchor name with the given `prefix` and a one-indexed suffix. */
	function findNewAnchor(prefix, exclude) {
		for (let i = 1;; ++i) {
			const name = `${prefix}${i}`;
			if (!exclude.has(name)) return name;
		}
	}
	function createNodeAnchors(doc, prefix) {
		const aliasObjects = [];
		const sourceObjects = /* @__PURE__ */ new Map();
		let prevAnchors = null;
		return {
			onAnchor: (source) => {
				aliasObjects.push(source);
				prevAnchors ?? (prevAnchors = anchorNames(doc));
				const anchor = findNewAnchor(prefix, prevAnchors);
				prevAnchors.add(anchor);
				return anchor;
			},
			setAnchors: () => {
				for (const source of aliasObjects) {
					const ref = sourceObjects.get(source);
					if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) ref.node.anchor = ref.anchor;
					else {
						const error = /* @__PURE__ */ new Error("Failed to resolve repeated object (this should not happen)");
						error.source = source;
						throw error;
					}
				}
			},
			sourceObjects
		};
	}
	exports.anchorIsValid = anchorIsValid;
	exports.anchorNames = anchorNames;
	exports.createNodeAnchors = createNodeAnchors;
	exports.findNewAnchor = findNewAnchor;
}));
//#endregion
//#region ../node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Applies the JSON.parse reviver algorithm as defined in the ECMA-262 spec,
	* in section 24.5.1.1 "Runtime Semantics: InternalizeJSONProperty" of the
	* 2021 edition: https://tc39.es/ecma262/#sec-json.parse
	*
	* Includes extensions for handling Map and Set objects.
	*/
	function applyReviver(reviver, obj, key, val) {
		if (val && typeof val === "object") if (Array.isArray(val)) for (let i = 0, len = val.length; i < len; ++i) {
			const v0 = val[i];
			const v1 = applyReviver(reviver, val, String(i), v0);
			if (v1 === void 0) delete val[i];
			else if (v1 !== v0) val[i] = v1;
		}
		else if (val instanceof Map) for (const k of Array.from(val.keys())) {
			const v0 = val.get(k);
			const v1 = applyReviver(reviver, val, k, v0);
			if (v1 === void 0) val.delete(k);
			else if (v1 !== v0) val.set(k, v1);
		}
		else if (val instanceof Set) for (const v0 of Array.from(val)) {
			const v1 = applyReviver(reviver, val, v0, v0);
			if (v1 === void 0) val.delete(v0);
			else if (v1 !== v0) {
				val.delete(v0);
				val.add(v1);
			}
		}
		else for (const [k, v0] of Object.entries(val)) {
			const v1 = applyReviver(reviver, val, k, v0);
			if (v1 === void 0) delete val[k];
			else if (v1 !== v0) val[k] = v1;
		}
		return reviver.call(obj, key, val);
	}
	exports.applyReviver = applyReviver;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/toJS.js
var require_toJS = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	/**
	* Recursively convert any node or its contents to native JavaScript
	*
	* @param value - The input value
	* @param arg - If `value` defines a `toJSON()` method, use this
	*   as its first argument
	* @param ctx - Conversion context, originally set in Document#toJS(). If
	*   `{ keep: true }` is not set, output should be suitable for JSON
	*   stringification.
	*/
	function toJS(value, arg, ctx) {
		if (Array.isArray(value)) return value.map((v, i) => toJS(v, String(i), ctx));
		if (value && typeof value.toJSON === "function") {
			if (!ctx || !identity.hasAnchor(value)) return value.toJSON(arg, ctx);
			const data = {
				aliasCount: 0,
				count: 1,
				res: void 0
			};
			ctx.anchors.set(value, data);
			ctx.onCreate = (res) => {
				data.res = res;
				delete ctx.onCreate;
			};
			const res = value.toJSON(arg, ctx);
			if (ctx.onCreate) ctx.onCreate(res);
			return res;
		}
		if (typeof value === "bigint" && !ctx?.keep) return Number(value);
		return value;
	}
	exports.toJS = toJS;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/Node.js
var require_Node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var applyReviver = require_applyReviver();
	var identity = require_identity();
	var toJS = require_toJS();
	var NodeBase = class {
		constructor(type) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: type });
		}
		/** Create a copy of this node.  */
		clone() {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** A plain JavaScript representation of this node. */
		toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			if (!identity.isDocument(doc)) throw new TypeError("A document argument is required");
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc,
				keep: true,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this, "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
	};
	exports.NodeBase = NodeBase;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/Alias.js
var require_Alias = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var visit = require_visit();
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	var Alias = class extends Node.NodeBase {
		constructor(source) {
			super(identity.ALIAS);
			this.source = source;
			Object.defineProperty(this, "tag", { set() {
				throw new Error("Alias nodes cannot have tags");
			} });
		}
		/**
		* Resolve the value of this alias within `doc`, finding the last
		* instance of the `source` anchor before this node.
		*/
		resolve(doc, ctx) {
			if (ctx?.maxAliasCount === 0) throw new ReferenceError("Alias resolution is disabled");
			let nodes;
			if (ctx?.aliasResolveCache) nodes = ctx.aliasResolveCache;
			else {
				nodes = [];
				visit.visit(doc, { Node: (_key, node) => {
					if (identity.isAlias(node) || identity.hasAnchor(node)) nodes.push(node);
				} });
				if (ctx) ctx.aliasResolveCache = nodes;
			}
			let found = void 0;
			for (const node of nodes) {
				if (node === this) break;
				if (node.anchor === this.source) found = node;
			}
			return found;
		}
		toJSON(_arg, ctx) {
			if (!ctx) return { source: this.source };
			const { anchors, doc, maxAliasCount } = ctx;
			const source = this.resolve(doc, ctx);
			if (!source) {
				const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw new ReferenceError(msg);
			}
			let data = anchors.get(source);
			if (!data) {
				toJS.toJS(source, null, ctx);
				data = anchors.get(source);
			}
			/* istanbul ignore if */
			if (data?.res === void 0) throw new ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (maxAliasCount >= 0) {
				data.count += 1;
				if (data.aliasCount === 0) data.aliasCount = getAliasCount(doc, source, anchors);
				if (data.count * data.aliasCount > maxAliasCount) throw new ReferenceError("Excessive alias count indicates a resource exhaustion attack");
			}
			return data.res;
		}
		toString(ctx, _onComment, _onChompKeep) {
			const src = `*${this.source}`;
			if (ctx) {
				anchors.anchorIsValid(this.source);
				if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
					const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
					throw new Error(msg);
				}
				if (ctx.implicitKey) return `${src} `;
			}
			return src;
		}
	};
	function getAliasCount(doc, node, anchors) {
		if (identity.isAlias(node)) {
			const source = node.resolve(doc);
			const anchor = anchors && source && anchors.get(source);
			return anchor ? anchor.count * anchor.aliasCount : 0;
		} else if (identity.isCollection(node)) {
			let count = 0;
			for (const item of node.items) {
				const c = getAliasCount(doc, item, anchors);
				if (c > count) count = c;
			}
			return count;
		} else if (identity.isPair(node)) {
			const kc = getAliasCount(doc, node.key, anchors);
			const vc = getAliasCount(doc, node.value, anchors);
			return Math.max(kc, vc);
		}
		return 1;
	}
	exports.Alias = Alias;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	const isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
	var Scalar = class extends Node.NodeBase {
		constructor(value) {
			super(identity.SCALAR);
			this.value = value;
		}
		toJSON(arg, ctx) {
			return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
		}
		toString() {
			return String(this.value);
		}
	};
	Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
	Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
	Scalar.PLAIN = "PLAIN";
	Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
	Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
	exports.Scalar = Scalar;
	exports.isScalarValue = isScalarValue;
}));
//#endregion
//#region ../node_modules/yaml/dist/doc/createNode.js
var require_createNode = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var Scalar = require_Scalar();
	const defaultTagPrefix = "tag:yaml.org,2002:";
	function findTagObject(value, tagName, tags) {
		if (tagName) {
			const match = tags.filter((t) => t.tag === tagName);
			const tagObj = match.find((t) => !t.format) ?? match[0];
			if (!tagObj) throw new Error(`Tag ${tagName} not found`);
			return tagObj;
		}
		return tags.find((t) => t.identify?.(value) && !t.format);
	}
	function createNode(value, tagName, ctx) {
		if (identity.isDocument(value)) value = value.contents;
		if (identity.isNode(value)) return value;
		if (identity.isPair(value)) {
			const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
			map.items.push(value);
			return map;
		}
		if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) value = value.valueOf();
		const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
		let ref = void 0;
		if (aliasDuplicateObjects && value && typeof value === "object") {
			ref = sourceObjects.get(value);
			if (ref) {
				ref.anchor ?? (ref.anchor = onAnchor(value));
				return new Alias.Alias(ref.anchor);
			} else {
				ref = {
					anchor: null,
					node: null
				};
				sourceObjects.set(value, ref);
			}
		}
		if (tagName?.startsWith("!!")) tagName = defaultTagPrefix + tagName.slice(2);
		let tagObj = findTagObject(value, tagName, schema.tags);
		if (!tagObj) {
			if (value && typeof value.toJSON === "function") value = value.toJSON();
			if (!value || typeof value !== "object") {
				const node = new Scalar.Scalar(value);
				if (ref) ref.node = node;
				return node;
			}
			tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
		}
		if (onTagObj) {
			onTagObj(tagObj);
			delete ctx.onTagObj;
		}
		const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
		if (tagName) node.tag = tagName;
		else if (!tagObj.default) node.tag = tagObj.tag;
		if (ref) ref.node = node;
		return node;
	}
	exports.createNode = createNode;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/Collection.js
var require_Collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var identity = require_identity();
	var Node = require_Node();
	function collectionFromPath(schema, path, value) {
		let v = value;
		for (let i = path.length - 1; i >= 0; --i) {
			const k = path[i];
			if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
				const a = [];
				a[k] = v;
				v = a;
			} else v = new Map([[k, v]]);
		}
		return createNode.createNode(v, void 0, {
			aliasDuplicateObjects: false,
			keepUndefined: false,
			onAnchor: () => {
				throw new Error("This should not happen, please report a bug.");
			},
			schema,
			sourceObjects: /* @__PURE__ */ new Map()
		});
	}
	const isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
	var Collection = class extends Node.NodeBase {
		constructor(type, schema) {
			super(type);
			Object.defineProperty(this, "schema", {
				value: schema,
				configurable: true,
				enumerable: false,
				writable: true
			});
		}
		/**
		* Create a copy of this collection.
		*
		* @param schema - If defined, overwrites the original's schema
		*/
		clone(schema) {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (schema) copy.schema = schema;
			copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/**
		* Adds a value to the collection. For `!!map` and `!!omap` the value must
		* be a Pair instance or a `{ key, value }` object, which may not have a key
		* that already exists in the map.
		*/
		addIn(path, value) {
			if (isEmptyPath(path)) this.add(value);
			else {
				const [key, ...rest] = path;
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.addIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
		/**
		* Removes a value from the collection.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.delete(key);
			const node = this.get(key, true);
			if (identity.isCollection(node)) return node.deleteIn(rest);
			else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			const [key, ...rest] = path;
			const node = this.get(key, true);
			if (rest.length === 0) return !keepScalar && identity.isScalar(node) ? node.value : node;
			else return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
		}
		hasAllNullValues(allowScalar) {
			return this.items.every((node) => {
				if (!identity.isPair(node)) return false;
				const n = node.value;
				return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
			});
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*/
		hasIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.has(key);
			const node = this.get(key, true);
			return identity.isCollection(node) ? node.hasIn(rest) : false;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			const [key, ...rest] = path;
			if (rest.length === 0) this.set(key, value);
			else {
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.setIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
	};
	exports.Collection = Collection;
	exports.collectionFromPath = collectionFromPath;
	exports.isEmptyPath = isEmptyPath;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringifies a comment.
	*
	* Empty comment lines are left empty,
	* lines consisting of a single space are replaced by `#`,
	* and all other lines are prefixed with a `#`.
	*/
	const stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
	function indentComment(comment, indent) {
		if (/^\n+$/.test(comment)) return comment.substring(1);
		return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
	}
	const lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
	exports.indentComment = indentComment;
	exports.lineComment = lineComment;
	exports.stringifyComment = stringifyComment;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = /* @__PURE__ */ __commonJSMin(((exports) => {
	const FOLD_FLOW = "flow";
	const FOLD_BLOCK = "block";
	const FOLD_QUOTED = "quoted";
	/**
	* Tries to keep input at up to `lineWidth` characters, splitting only on spaces
	* not followed by newlines or spaces unless `mode` is `'quoted'`. Lines are
	* terminated with `\n` and started with `indent`.
	*/
	function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
		if (!lineWidth || lineWidth < 0) return text;
		if (lineWidth < minContentWidth) minContentWidth = 0;
		const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
		if (text.length <= endStep) return text;
		const folds = [];
		const escapedFolds = {};
		let end = lineWidth - indent.length;
		if (typeof indentAtStart === "number") if (indentAtStart > lineWidth - Math.max(2, minContentWidth)) folds.push(0);
		else end = lineWidth - indentAtStart;
		let split = void 0;
		let prev = void 0;
		let overflow = false;
		let i = -1;
		let escStart = -1;
		let escEnd = -1;
		if (mode === FOLD_BLOCK) {
			i = consumeMoreIndentedLines(text, i, indent.length);
			if (i !== -1) end = i + endStep;
		}
		for (let ch; ch = text[i += 1];) {
			if (mode === FOLD_QUOTED && ch === "\\") {
				escStart = i;
				switch (text[i + 1]) {
					case "x":
						i += 3;
						break;
					case "u":
						i += 5;
						break;
					case "U":
						i += 9;
						break;
					default: i += 1;
				}
				escEnd = i;
			}
			if (ch === "\n") {
				if (mode === FOLD_BLOCK) i = consumeMoreIndentedLines(text, i, indent.length);
				end = i + indent.length + endStep;
				split = void 0;
			} else {
				if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
					const next = text[i + 1];
					if (next && next !== " " && next !== "\n" && next !== "	") split = i;
				}
				if (i >= end) if (split) {
					folds.push(split);
					end = split + endStep;
					split = void 0;
				} else if (mode === FOLD_QUOTED) {
					while (prev === " " || prev === "	") {
						prev = ch;
						ch = text[i += 1];
						overflow = true;
					}
					const j = i > escEnd + 1 ? i - 2 : escStart - 1;
					if (escapedFolds[j]) return text;
					folds.push(j);
					escapedFolds[j] = true;
					end = j + endStep;
					split = void 0;
				} else overflow = true;
			}
			prev = ch;
		}
		if (overflow && onOverflow) onOverflow();
		if (folds.length === 0) return text;
		if (onFold) onFold();
		let res = text.slice(0, folds[0]);
		for (let i = 0; i < folds.length; ++i) {
			const fold = folds[i];
			const end = folds[i + 1] || text.length;
			if (fold === 0) res = `\n${indent}${text.slice(0, end)}`;
			else {
				if (mode === FOLD_QUOTED && escapedFolds[fold]) res += `${text[fold]}\\`;
				res += `\n${indent}${text.slice(fold + 1, end)}`;
			}
		}
		return res;
	}
	/**
	* Presumes `i + 1` is at the start of a line
	* @returns index of last newline in more-indented block
	*/
	function consumeMoreIndentedLines(text, i, indent) {
		let end = i;
		let start = i + 1;
		let ch = text[start];
		while (ch === " " || ch === "	") if (i < start + indent) ch = text[++i];
		else {
			do
				ch = text[++i];
			while (ch && ch !== "\n");
			end = i;
			start = i + 1;
			ch = text[start];
		}
		return end;
	}
	exports.FOLD_BLOCK = FOLD_BLOCK;
	exports.FOLD_FLOW = FOLD_FLOW;
	exports.FOLD_QUOTED = FOLD_QUOTED;
	exports.foldFlowLines = foldFlowLines;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var foldFlowLines = require_foldFlowLines();
	const getFoldOptions = (ctx, isBlock) => ({
		indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
		lineWidth: ctx.options.lineWidth,
		minContentWidth: ctx.options.minContentWidth
	});
	const containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
	function lineLengthOverLimit(str, lineWidth, indentLength) {
		if (!lineWidth || lineWidth < 0) return false;
		const limit = lineWidth - indentLength;
		const strLen = str.length;
		if (strLen <= limit) return false;
		for (let i = 0, start = 0; i < strLen; ++i) if (str[i] === "\n") {
			if (i - start > limit) return true;
			start = i + 1;
			if (strLen - start <= limit) return false;
		}
		return true;
	}
	function doubleQuotedString(value, ctx) {
		const json = JSON.stringify(value);
		if (ctx.options.doubleQuotedAsJSON) return json;
		const { implicitKey } = ctx;
		const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		let str = "";
		let start = 0;
		for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
			if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
				str += json.slice(start, i) + "\\ ";
				i += 1;
				start = i;
				ch = "\\";
			}
			if (ch === "\\") switch (json[i + 1]) {
				case "u":
					{
						str += json.slice(start, i);
						const code = json.substr(i + 2, 4);
						switch (code) {
							case "0000":
								str += "\\0";
								break;
							case "0007":
								str += "\\a";
								break;
							case "000b":
								str += "\\v";
								break;
							case "001b":
								str += "\\e";
								break;
							case "0085":
								str += "\\N";
								break;
							case "00a0":
								str += "\\_";
								break;
							case "2028":
								str += "\\L";
								break;
							case "2029":
								str += "\\P";
								break;
							default: if (code.substr(0, 2) === "00") str += "\\x" + code.substr(2);
							else str += json.substr(i, 6);
						}
						i += 5;
						start = i + 1;
					}
					break;
				case "n":
					if (implicitKey || json[i + 2] === "\"" || json.length < minMultiLineLength) i += 1;
					else {
						str += json.slice(start, i) + "\n\n";
						while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== "\"") {
							str += "\n";
							i += 2;
						}
						str += indent;
						if (json[i + 2] === " ") str += "\\";
						i += 1;
						start = i + 1;
					}
					break;
				default: i += 1;
			}
		}
		str = start ? str + json.slice(start) : json;
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
	}
	function singleQuotedString(value, ctx) {
		if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
		return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function quotedString(value, ctx) {
		const { singleQuote } = ctx.options;
		let qs;
		if (singleQuote === false) qs = doubleQuotedString;
		else {
			const hasDouble = value.includes("\"");
			const hasSingle = value.includes("'");
			if (hasDouble && !hasSingle) qs = singleQuotedString;
			else if (hasSingle && !hasDouble) qs = doubleQuotedString;
			else qs = singleQuote ? singleQuotedString : doubleQuotedString;
		}
		return qs(value, ctx);
	}
	let blockEndNewlines;
	try {
		blockEndNewlines = /* @__PURE__ */ new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
	} catch {
		blockEndNewlines = /\n+(?!\n|$)/g;
	}
	function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
		const { blockQuote, commentString, lineWidth } = ctx.options;
		if (!blockQuote || /\n[\t ]+$/.test(value)) return quotedString(value, ctx);
		const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
		const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
		if (!value) return literal ? "|\n" : ">\n";
		let chomp;
		let endStart;
		for (endStart = value.length; endStart > 0; --endStart) {
			const ch = value[endStart - 1];
			if (ch !== "\n" && ch !== "	" && ch !== " ") break;
		}
		let end = value.substring(endStart);
		const endNlPos = end.indexOf("\n");
		if (endNlPos === -1) chomp = "-";
		else if (value === end || endNlPos !== end.length - 1) {
			chomp = "+";
			if (onChompKeep) onChompKeep();
		} else chomp = "";
		if (end) {
			value = value.slice(0, -end.length);
			if (end[end.length - 1] === "\n") end = end.slice(0, -1);
			end = end.replace(blockEndNewlines, `$&${indent}`);
		}
		let startWithSpace = false;
		let startEnd;
		let startNlPos = -1;
		for (startEnd = 0; startEnd < value.length; ++startEnd) {
			const ch = value[startEnd];
			if (ch === " ") startWithSpace = true;
			else if (ch === "\n") startNlPos = startEnd;
			else break;
		}
		let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
		if (start) {
			value = value.substring(start.length);
			start = start.replace(/\n+/g, `$&${indent}`);
		}
		let header = (startWithSpace ? indent ? "2" : "1" : "") + chomp;
		if (comment) {
			header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
			if (onComment) onComment();
		}
		if (!literal) {
			const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
			let literalFallback = false;
			const foldOptions = getFoldOptions(ctx, true);
			if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) foldOptions.onOverflow = () => {
				literalFallback = true;
			};
			const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
			if (!literalFallback) return `>${header}\n${indent}${body}`;
		}
		value = value.replace(/\n+/g, `$&${indent}`);
		return `|${header}\n${indent}${start}${value}${end}`;
	}
	function plainString(item, ctx, onComment, onChompKeep) {
		const { type, value } = item;
		const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
		if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) return quotedString(value, ctx);
		if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
		if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) return blockString(item, ctx, onComment, onChompKeep);
		if (containsDocumentMarker(value)) {
			if (indent === "") {
				ctx.forceBlockIndent = true;
				return blockString(item, ctx, onComment, onChompKeep);
			} else if (implicitKey && indent === indentStep) return quotedString(value, ctx);
		}
		const str = value.replace(/\n+/g, `$&\n${indent}`);
		if (actualString) {
			const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
			const { compat, tags } = ctx.doc.schema;
			if (tags.some(test) || compat?.some(test)) return quotedString(value, ctx);
		}
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function stringifyString(item, ctx, onComment, onChompKeep) {
		const { implicitKey, inFlow } = ctx;
		const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
		let { type } = item;
		if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
			if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value)) type = Scalar.Scalar.QUOTE_DOUBLE;
		}
		const _stringify = (_type) => {
			switch (_type) {
				case Scalar.Scalar.BLOCK_FOLDED:
				case Scalar.Scalar.BLOCK_LITERAL: return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
				case Scalar.Scalar.QUOTE_DOUBLE: return doubleQuotedString(ss.value, ctx);
				case Scalar.Scalar.QUOTE_SINGLE: return singleQuotedString(ss.value, ctx);
				case Scalar.Scalar.PLAIN: return plainString(ss, ctx, onComment, onChompKeep);
				default: return null;
			}
		};
		let res = _stringify(type);
		if (res === null) {
			const { defaultKeyType, defaultStringType } = ctx.options;
			const t = implicitKey && defaultKeyType || defaultStringType;
			res = _stringify(t);
			if (res === null) throw new Error(`Unsupported default string type ${t}`);
		}
		return res;
	}
	exports.stringifyString = stringifyString;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringify.js
var require_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var identity = require_identity();
	var stringifyComment = require_stringifyComment();
	var stringifyString = require_stringifyString();
	function createStringifyContext(doc, options) {
		const opt = Object.assign({
			blockQuote: true,
			commentString: stringifyComment.stringifyComment,
			defaultKeyType: null,
			defaultStringType: "PLAIN",
			directives: null,
			doubleQuotedAsJSON: false,
			doubleQuotedMinMultiLineLength: 40,
			falseStr: "false",
			flowCollectionPadding: true,
			indentSeq: true,
			lineWidth: 80,
			minContentWidth: 20,
			nullStr: "null",
			simpleKeys: false,
			singleQuote: null,
			trailingComma: false,
			trueStr: "true",
			verifyAliasOrder: true
		}, doc.schema.toStringOptions, options);
		let inFlow;
		switch (opt.collectionStyle) {
			case "block":
				inFlow = false;
				break;
			case "flow":
				inFlow = true;
				break;
			default: inFlow = null;
		}
		return {
			anchors: /* @__PURE__ */ new Set(),
			doc,
			flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
			indent: "",
			indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
			inFlow,
			options: opt
		};
	}
	function getTagObject(tags, item) {
		if (item.tag) {
			const match = tags.filter((t) => t.tag === item.tag);
			if (match.length > 0) return match.find((t) => t.format === item.format) ?? match[0];
		}
		let tagObj = void 0;
		let obj;
		if (identity.isScalar(item)) {
			obj = item.value;
			let match = tags.filter((t) => t.identify?.(obj));
			if (match.length > 1) {
				const testMatch = match.filter((t) => t.test);
				if (testMatch.length > 0) match = testMatch;
			}
			tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
		} else {
			obj = item;
			tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
		}
		if (!tagObj) {
			const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
			throw new Error(`Tag not resolved for ${name} value`);
		}
		return tagObj;
	}
	function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
		if (!doc.directives) return "";
		const props = [];
		const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
		if (anchor && anchors.anchorIsValid(anchor)) {
			anchors$1.add(anchor);
			props.push(`&${anchor}`);
		}
		const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
		if (tag) props.push(doc.directives.tagString(tag));
		return props.join(" ");
	}
	function stringify(item, ctx, onComment, onChompKeep) {
		if (identity.isPair(item)) return item.toString(ctx, onComment, onChompKeep);
		if (identity.isAlias(item)) {
			if (ctx.doc.directives) return item.toString(ctx);
			if (ctx.resolvedAliases?.has(item)) throw new TypeError(`Cannot stringify circular structure without alias nodes`);
			else {
				if (ctx.resolvedAliases) ctx.resolvedAliases.add(item);
				else ctx.resolvedAliases = new Set([item]);
				item = item.resolve(ctx.doc);
			}
		}
		let tagObj = void 0;
		const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
		tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
		const props = stringifyProps(node, tagObj, ctx);
		if (props.length > 0) ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
		const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
		if (!props) return str;
		return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}\n${ctx.indent}${str}`;
	}
	exports.createStringifyContext = createStringifyContext;
	exports.stringify = stringify;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
		const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
		let keyComment = identity.isNode(key) && key.comment || null;
		if (simpleKeys) {
			if (keyComment) throw new Error("With simple keys, key nodes cannot have comments");
			if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") throw new Error("With simple keys, collection cannot be used as a key value");
		}
		let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
		ctx = Object.assign({}, ctx, {
			allNullValues: false,
			implicitKey: !explicitKey && (simpleKeys || !allNullValues),
			indent: indent + indentStep
		});
		let keyCommentDone = false;
		let chompKeep = false;
		let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
		if (!explicitKey && !ctx.inFlow && str.length > 1024) {
			if (simpleKeys) throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
			explicitKey = true;
		}
		if (ctx.inFlow) {
			if (allNullValues || value == null) {
				if (keyCommentDone && onComment) onComment();
				return str === "" ? "?" : explicitKey ? `? ${str}` : str;
			}
		} else if (allNullValues && !simpleKeys || value == null && explicitKey) {
			str = `? ${str}`;
			if (keyComment && !keyCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			else if (chompKeep && onChompKeep) onChompKeep();
			return str;
		}
		if (keyCommentDone) keyComment = null;
		if (explicitKey) {
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			str = `? ${str}\n${indent}:`;
		} else {
			str = `${str}:`;
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
		}
		let vsb, vcb, valueComment;
		if (identity.isNode(value)) {
			vsb = !!value.spaceBefore;
			vcb = value.commentBefore;
			valueComment = value.comment;
		} else {
			vsb = false;
			vcb = null;
			valueComment = null;
			if (value && typeof value === "object") value = doc.createNode(value);
		}
		ctx.implicitKey = false;
		if (!explicitKey && !keyComment && identity.isScalar(value)) ctx.indentAtStart = str.length + 1;
		chompKeep = false;
		if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) ctx.indent = ctx.indent.substring(2);
		let valueCommentDone = false;
		const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
		let ws = " ";
		if (keyComment || vsb || vcb) {
			ws = vsb ? "\n" : "";
			if (vcb) {
				const cs = commentString(vcb);
				ws += `\n${stringifyComment.indentComment(cs, ctx.indent)}`;
			}
			if (valueStr === "" && !ctx.inFlow) {
				if (ws === "\n" && valueComment) ws = "\n\n";
			} else ws += `\n${ctx.indent}`;
		} else if (!explicitKey && identity.isCollection(value)) {
			const vs0 = valueStr[0];
			const nl0 = valueStr.indexOf("\n");
			const hasNewline = nl0 !== -1;
			const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
			if (hasNewline || !flow) {
				let hasPropsLine = false;
				if (hasNewline && (vs0 === "&" || vs0 === "!")) {
					let sp0 = valueStr.indexOf(" ");
					if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") sp0 = valueStr.indexOf(" ", sp0 + 1);
					if (sp0 === -1 || nl0 < sp0) hasPropsLine = true;
				}
				if (!hasPropsLine) ws = `\n${ctx.indent}`;
			}
		} else if (valueStr === "" || valueStr[0] === "\n") ws = "";
		str += ws + valueStr;
		if (ctx.inFlow) {
			if (valueCommentDone && onComment) onComment();
		} else if (valueComment && !valueCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
		else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	exports.stringifyPair = stringifyPair;
}));
//#endregion
//#region ../node_modules/yaml/dist/log.js
var require_log = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$2 = __require("process");
	function debug(logLevel, ...messages) {
		if (logLevel === "debug") console.log(...messages);
	}
	function warn(logLevel, warning) {
		if (logLevel === "debug" || logLevel === "warn") if (typeof node_process$2.emitWarning === "function") node_process$2.emitWarning(warning);
		else console.warn(warning);
	}
	exports.debug = debug;
	exports.warn = warn;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	const MERGE_KEY = "<<";
	const merge = {
		identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
		default: "key",
		tag: "tag:yaml.org,2002:merge",
		test: /^<<$/,
		resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), { addToJSMap: addMergeToJSMap }),
		stringify: () => MERGE_KEY
	};
	const isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
	function addMergeToJSMap(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (identity.isSeq(source)) for (const it of source.items) mergeValue(ctx, map, it);
		else if (Array.isArray(source)) for (const it of source) mergeValue(ctx, map, it);
		else mergeValue(ctx, map, source);
	}
	function mergeValue(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (!identity.isMap(source)) throw new Error("Merge sources must be maps or map aliases");
		const srcMap = source.toJSON(null, ctx, Map);
		for (const [key, value] of srcMap) if (map instanceof Map) {
			if (!map.has(key)) map.set(key, value);
		} else if (map instanceof Set) map.add(key);
		else if (!Object.prototype.hasOwnProperty.call(map, key)) Object.defineProperty(map, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
		return map;
	}
	function resolveAliasValue(ctx, value) {
		return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
	}
	exports.addMergeToJSMap = addMergeToJSMap;
	exports.isMergeKey = isMergeKey;
	exports.merge = merge;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var log = require_log();
	var merge = require_merge();
	var stringify = require_stringify();
	var identity = require_identity();
	var toJS = require_toJS();
	function addPairToJSMap(ctx, map, { key, value }) {
		if (identity.isNode(key) && key.addToJSMap) key.addToJSMap(ctx, map, value);
		else if (merge.isMergeKey(ctx, key)) merge.addMergeToJSMap(ctx, map, value);
		else {
			const jsKey = toJS.toJS(key, "", ctx);
			if (map instanceof Map) map.set(jsKey, toJS.toJS(value, jsKey, ctx));
			else if (map instanceof Set) map.add(jsKey);
			else {
				const stringKey = stringifyKey(key, jsKey, ctx);
				const jsValue = toJS.toJS(value, stringKey, ctx);
				if (stringKey in map) Object.defineProperty(map, stringKey, {
					value: jsValue,
					writable: true,
					enumerable: true,
					configurable: true
				});
				else map[stringKey] = jsValue;
			}
		}
		return map;
	}
	function stringifyKey(key, jsKey, ctx) {
		if (jsKey === null) return "";
		if (typeof jsKey !== "object") return String(jsKey);
		if (identity.isNode(key) && ctx?.doc) {
			const strCtx = stringify.createStringifyContext(ctx.doc, {});
			strCtx.anchors = /* @__PURE__ */ new Set();
			for (const node of ctx.anchors.keys()) strCtx.anchors.add(node.anchor);
			strCtx.inFlow = true;
			strCtx.inStringifyKey = true;
			const strKey = key.toString(strCtx);
			if (!ctx.mapKeyWarned) {
				let jsonStr = JSON.stringify(strKey);
				if (jsonStr.length > 40) jsonStr = jsonStr.substring(0, 36) + "...\"";
				log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
				ctx.mapKeyWarned = true;
			}
			return strKey;
		}
		return JSON.stringify(jsKey);
	}
	exports.addPairToJSMap = addPairToJSMap;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/Pair.js
var require_Pair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyPair = require_stringifyPair();
	var addPairToJSMap = require_addPairToJSMap();
	var identity = require_identity();
	function createPair(key, value, ctx) {
		return new Pair(createNode.createNode(key, void 0, ctx), createNode.createNode(value, void 0, ctx));
	}
	var Pair = class Pair {
		constructor(key, value = null) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
			this.key = key;
			this.value = value;
		}
		clone(schema) {
			let { key, value } = this;
			if (identity.isNode(key)) key = key.clone(schema);
			if (identity.isNode(value)) value = value.clone(schema);
			return new Pair(key, value);
		}
		toJSON(_, ctx) {
			const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			return addPairToJSMap.addPairToJSMap(ctx, pair, this);
		}
		toString(ctx, onComment, onChompKeep) {
			return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
		}
	};
	exports.Pair = Pair;
	exports.createPair = createPair;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyCollection(collection, ctx, options) {
		return (ctx.inFlow ?? collection.flow ? stringifyFlowCollection : stringifyBlockCollection)(collection, ctx, options);
	}
	function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
		const { indent, options: { commentString } } = ctx;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			type: null
		});
		let chompKeep = false;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (!chompKeep && item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (!chompKeep && ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
				}
			}
			chompKeep = false;
			let str = stringify.stringify(item, itemCtx, () => comment = null, () => chompKeep = true);
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			if (chompKeep && comment) chompKeep = false;
			lines.push(blockItemPrefix + str);
		}
		let str;
		if (lines.length === 0) str = flowChars.start + flowChars.end;
		else {
			str = lines[0];
			for (let i = 1; i < lines.length; ++i) {
				const line = lines[i];
				str += line ? `\n${indent}${line}` : "\n";
			}
		}
		if (comment) {
			str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
			if (onComment) onComment();
		} else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
		const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
		itemIndent += indentStep;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			inFlow: true,
			type: null
		});
		let reqNewline = false;
		let linesAtValue = 0;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, false);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, false);
					if (ik.comment) reqNewline = true;
				}
				const iv = identity.isNode(item.value) ? item.value : null;
				if (iv) {
					if (iv.comment) comment = iv.comment;
					if (iv.commentBefore) reqNewline = true;
				} else if (item.value == null && ik?.comment) comment = ik.comment;
			}
			if (comment) reqNewline = true;
			let str = stringify.stringify(item, itemCtx, () => comment = null);
			reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
			if (i < items.length - 1) str += ",";
			else if (ctx.options.trailingComma) {
				if (ctx.options.lineWidth > 0) reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
				if (reqNewline) str += ",";
			}
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			lines.push(str);
			linesAtValue = lines.length;
		}
		const { start, end } = flowChars;
		if (lines.length === 0) return start + end;
		else {
			if (!reqNewline) {
				const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
				reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
			}
			if (reqNewline) {
				let str = start;
				for (const line of lines) str += line ? `\n${indentStep}${indent}${line}` : "\n";
				return `${str}\n${indent}${end}`;
			} else return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
		}
	}
	function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
		if (comment && chompKeep) comment = comment.replace(/^\n+/, "");
		if (comment) {
			const ic = stringifyComment.indentComment(commentString(comment), indent);
			lines.push(ic.trimStart());
		}
	}
	exports.stringifyCollection = stringifyCollection;
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyCollection = require_stringifyCollection();
	var addPairToJSMap = require_addPairToJSMap();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	function findPair(items, key) {
		const k = identity.isScalar(key) ? key.value : key;
		for (const it of items) if (identity.isPair(it)) {
			if (it.key === key || it.key === k) return it;
			if (identity.isScalar(it.key) && it.key.value === k) return it;
		}
	}
	var YAMLMap = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:map";
		}
		constructor(schema) {
			super(identity.MAP, schema);
			this.items = [];
		}
		/**
		* A generic collection parsing method that can be extended
		* to other node classes that inherit from YAMLMap
		*/
		static from(schema, obj, ctx) {
			const { keepUndefined, replacer } = ctx;
			const map = new this(schema);
			const add = (key, value) => {
				if (typeof replacer === "function") value = replacer.call(obj, key, value);
				else if (Array.isArray(replacer) && !replacer.includes(key)) return;
				if (value !== void 0 || keepUndefined) map.items.push(Pair.createPair(key, value, ctx));
			};
			if (obj instanceof Map) for (const [key, value] of obj) add(key, value);
			else if (obj && typeof obj === "object") for (const key of Object.keys(obj)) add(key, obj[key]);
			if (typeof schema.sortMapEntries === "function") map.items.sort(schema.sortMapEntries);
			return map;
		}
		/**
		* Adds a value to the collection.
		*
		* @param overwrite - If not set `true`, using a key that is already in the
		*   collection will throw. Otherwise, overwrites the previous value.
		*/
		add(pair, overwrite) {
			let _pair;
			if (identity.isPair(pair)) _pair = pair;
			else if (!pair || typeof pair !== "object" || !("key" in pair)) _pair = new Pair.Pair(pair, pair?.value);
			else _pair = new Pair.Pair(pair.key, pair.value);
			const prev = findPair(this.items, _pair.key);
			const sortEntries = this.schema?.sortMapEntries;
			if (prev) {
				if (!overwrite) throw new Error(`Key ${_pair.key} already set`);
				if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value)) prev.value.value = _pair.value;
				else prev.value = _pair.value;
			} else if (sortEntries) {
				const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
				if (i === -1) this.items.push(_pair);
				else this.items.splice(i, 0, _pair);
			} else this.items.push(_pair);
		}
		delete(key) {
			const it = findPair(this.items, key);
			if (!it) return false;
			return this.items.splice(this.items.indexOf(it), 1).length > 0;
		}
		get(key, keepScalar) {
			const node = findPair(this.items, key)?.value;
			return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
		}
		has(key) {
			return !!findPair(this.items, key);
		}
		set(key, value) {
			this.add(new Pair.Pair(key, value), true);
		}
		/**
		* @param ctx - Conversion context, originally set in Document#toJS()
		* @param {Class} Type - If set, forces the returned collection type
		* @returns Instance of Type, Map, or Object
		*/
		toJSON(_, ctx, Type) {
			const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const item of this.items) addPairToJSMap.addPairToJSMap(ctx, map, item);
			return map;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			for (const item of this.items) if (!identity.isPair(item)) throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
			if (!ctx.allNullValues && this.hasAllNullValues(false)) ctx = Object.assign({}, ctx, { allNullValues: true });
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "",
				flowChars: {
					start: "{",
					end: "}"
				},
				itemIndent: ctx.indent || "",
				onChompKeep,
				onComment
			});
		}
	};
	exports.YAMLMap = YAMLMap;
	exports.findPair = findPair;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/common/map.js
var require_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLMap = require_YAMLMap();
	exports.map = {
		collection: "map",
		default: true,
		nodeClass: YAMLMap.YAMLMap,
		tag: "tag:yaml.org,2002:map",
		resolve(map, onError) {
			if (!identity.isMap(map)) onError("Expected a mapping for this tag");
			return map;
		},
		createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
	};
}));
//#endregion
//#region ../node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyCollection = require_stringifyCollection();
	var Collection = require_Collection();
	var identity = require_identity();
	var Scalar = require_Scalar();
	var toJS = require_toJS();
	var YAMLSeq = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:seq";
		}
		constructor(schema) {
			super(identity.SEQ, schema);
			this.items = [];
		}
		add(value) {
			this.items.push(value);
		}
		/**
		* Removes a value from the collection.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return false;
			return this.items.splice(idx, 1).length > 0;
		}
		get(key, keepScalar) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return void 0;
			const it = this.items[idx];
			return !keepScalar && identity.isScalar(it) ? it.value : it;
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*/
		has(key) {
			const idx = asItemIndex(key);
			return typeof idx === "number" && idx < this.items.length;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*
		* If `key` does not contain a representation of an integer, this will throw.
		* It may be wrapped in a `Scalar`.
		*/
		set(key, value) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") throw new Error(`Expected a valid index, not ${key}.`);
			const prev = this.items[idx];
			if (identity.isScalar(prev) && Scalar.isScalarValue(value)) prev.value = value;
			else this.items[idx] = value;
		}
		toJSON(_, ctx) {
			const seq = [];
			if (ctx?.onCreate) ctx.onCreate(seq);
			let i = 0;
			for (const item of this.items) seq.push(toJS.toJS(item, String(i++), ctx));
			return seq;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "- ",
				flowChars: {
					start: "[",
					end: "]"
				},
				itemIndent: (ctx.indent || "") + "  ",
				onChompKeep,
				onComment
			});
		}
		static from(schema, obj, ctx) {
			const { replacer } = ctx;
			const seq = new this(schema);
			if (obj && Symbol.iterator in Object(obj)) {
				let i = 0;
				for (let it of obj) {
					if (typeof replacer === "function") {
						const key = obj instanceof Set ? it : String(i++);
						it = replacer.call(obj, key, it);
					}
					seq.items.push(createNode.createNode(it, void 0, ctx));
				}
			}
			return seq;
		}
	};
	function asItemIndex(key) {
		let idx = identity.isScalar(key) ? key.value : key;
		if (idx && typeof idx === "string") idx = Number(idx);
		return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
	}
	exports.YAMLSeq = YAMLSeq;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/common/seq.js
var require_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLSeq = require_YAMLSeq();
	exports.seq = {
		collection: "seq",
		default: true,
		nodeClass: YAMLSeq.YAMLSeq,
		tag: "tag:yaml.org,2002:seq",
		resolve(seq, onError) {
			if (!identity.isSeq(seq)) onError("Expected a sequence for this tag");
			return seq;
		},
		createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
	};
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/common/string.js
var require_string = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyString = require_stringifyString();
	exports.string = {
		identify: (value) => typeof value === "string",
		default: true,
		tag: "tag:yaml.org,2002:str",
		resolve: (str) => str,
		stringify(item, ctx, onComment, onChompKeep) {
			ctx = Object.assign({ actualString: true }, ctx);
			return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
		}
	};
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/common/null.js
var require_null = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const nullTag = {
		identify: (value) => value == null,
		createNode: () => new Scalar.Scalar(null),
		default: true,
		tag: "tag:yaml.org,2002:null",
		test: /^(?:~|[Nn]ull|NULL)?$/,
		resolve: () => new Scalar.Scalar(null),
		stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
	};
	exports.nullTag = nullTag;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/core/bool.js
var require_bool$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const boolTag = {
		identify: (value) => typeof value === "boolean",
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
		resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
		stringify({ source, value }, ctx) {
			if (source && boolTag.test.test(source)) {
				if (value === (source[0] === "t" || source[0] === "T")) return source;
			}
			return value ? ctx.options.trueStr : ctx.options.falseStr;
		}
	};
	exports.boolTag = boolTag;
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = /* @__PURE__ */ __commonJSMin(((exports) => {
	function stringifyNumber({ format, minFractionDigits, tag, value }) {
		if (typeof value === "bigint") return String(value);
		const num = typeof value === "number" ? value : Number(value);
		if (!isFinite(num)) return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
		let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
		if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
			let i = n.indexOf(".");
			if (i < 0) {
				i = n.length;
				n += ".";
			}
			let d = minFractionDigits - (n.length - i - 1);
			while (d-- > 0) n += "0";
		}
		return n;
	}
	exports.stringifyNumber = stringifyNumber;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/core/float.js
var require_float$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str));
			const dot = str.indexOf(".");
			if (dot !== -1 && str[str.length - 1] === "0") node.minFractionDigits = str.length - dot - 1;
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/core/int.js
var require_int$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	const intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value) && value >= 0) return prefix + value.toString(radix);
		return stringifyNumber.stringifyNumber(node);
	}
	const intOct = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^0o[0-7]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
		stringify: (node) => intStringify(node, 8, "0o")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^0x[0-9a-fA-F]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/core/schema.js
var require_schema$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.boolTag,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float
	];
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/json/schema.js
var require_schema$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var map = require_map();
	var seq = require_seq();
	function intIdentify(value) {
		return typeof value === "bigint" || Number.isInteger(value);
	}
	const stringifyJSON = ({ value }) => JSON.stringify(value);
	const jsonScalars = [
		{
			identify: (value) => typeof value === "string",
			default: true,
			tag: "tag:yaml.org,2002:str",
			resolve: (str) => str,
			stringify: stringifyJSON
		},
		{
			identify: (value) => value == null,
			createNode: () => new Scalar.Scalar(null),
			default: true,
			tag: "tag:yaml.org,2002:null",
			test: /^null$/,
			resolve: () => null,
			stringify: stringifyJSON
		},
		{
			identify: (value) => typeof value === "boolean",
			default: true,
			tag: "tag:yaml.org,2002:bool",
			test: /^true$|^false$/,
			resolve: (str) => str === "true",
			stringify: stringifyJSON
		},
		{
			identify: intIdentify,
			default: true,
			tag: "tag:yaml.org,2002:int",
			test: /^-?(?:0|[1-9][0-9]*)$/,
			resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
			stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
		},
		{
			identify: (value) => typeof value === "number",
			default: true,
			tag: "tag:yaml.org,2002:float",
			test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
			resolve: (str) => parseFloat(str),
			stringify: stringifyJSON
		}
	];
	exports.schema = [map.map, seq.seq].concat(jsonScalars, {
		default: true,
		tag: "",
		test: /^/,
		resolve(str, onError) {
			onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
			return str;
		}
	});
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_buffer = __require("buffer");
	var Scalar = require_Scalar();
	var stringifyString = require_stringifyString();
	exports.binary = {
		identify: (value) => value instanceof Uint8Array,
		default: false,
		tag: "tag:yaml.org,2002:binary",
		resolve(src, onError) {
			if (typeof node_buffer.Buffer === "function") return node_buffer.Buffer.from(src, "base64");
			else if (typeof atob === "function") {
				const str = atob(src.replace(/[\n\r]/g, ""));
				const buffer = new Uint8Array(str.length);
				for (let i = 0; i < str.length; ++i) buffer[i] = str.charCodeAt(i);
				return buffer;
			} else {
				onError("This environment does not support reading binary tags; either Buffer or atob is required");
				return src;
			}
		},
		stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
			if (!value) return "";
			const buf = value;
			let str;
			if (typeof node_buffer.Buffer === "function") str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
			else if (typeof btoa === "function") {
				let s = "";
				for (let i = 0; i < buf.length; ++i) s += String.fromCharCode(buf[i]);
				str = btoa(s);
			} else throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
			type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
			if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
				const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
				const n = Math.ceil(str.length / lineWidth);
				const lines = new Array(n);
				for (let i = 0, o = 0; i < n; ++i, o += lineWidth) lines[i] = str.substr(o, lineWidth);
				str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
			}
			return stringifyString.stringifyString({
				comment,
				type,
				value: str
			}, ctx, onComment, onChompKeep);
		}
	};
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLSeq = require_YAMLSeq();
	function resolvePairs(seq, onError) {
		if (identity.isSeq(seq)) for (let i = 0; i < seq.items.length; ++i) {
			let item = seq.items[i];
			if (identity.isPair(item)) continue;
			else if (identity.isMap(item)) {
				if (item.items.length > 1) onError("Each pair must have its own sequence indicator");
				const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
				if (item.commentBefore) pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}\n${pair.key.commentBefore}` : item.commentBefore;
				if (item.comment) {
					const cn = pair.value ?? pair.key;
					cn.comment = cn.comment ? `${item.comment}\n${cn.comment}` : item.comment;
				}
				item = pair;
			}
			seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
		}
		else onError("Expected a sequence for this tag");
		return seq;
	}
	function createPairs(schema, iterable, ctx) {
		const { replacer } = ctx;
		const pairs = new YAMLSeq.YAMLSeq(schema);
		pairs.tag = "tag:yaml.org,2002:pairs";
		let i = 0;
		if (iterable && Symbol.iterator in Object(iterable)) for (let it of iterable) {
			if (typeof replacer === "function") it = replacer.call(iterable, String(i++), it);
			let key, value;
			if (Array.isArray(it)) if (it.length === 2) {
				key = it[0];
				value = it[1];
			} else throw new TypeError(`Expected [key, value] tuple: ${it}`);
			else if (it && it instanceof Object) {
				const keys = Object.keys(it);
				if (keys.length === 1) {
					key = keys[0];
					value = it[key];
				} else throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
			} else key = it;
			pairs.items.push(Pair.createPair(key, value, ctx));
		}
		return pairs;
	}
	const pairs = {
		collection: "seq",
		default: false,
		tag: "tag:yaml.org,2002:pairs",
		resolve: resolvePairs,
		createNode: createPairs
	};
	exports.createPairs = createPairs;
	exports.pairs = pairs;
	exports.resolvePairs = resolvePairs;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var toJS = require_toJS();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var pairs = require_pairs();
	var YAMLOMap = class YAMLOMap extends YAMLSeq.YAMLSeq {
		constructor() {
			super();
			this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
			this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
			this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
			this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
			this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
			this.tag = YAMLOMap.tag;
		}
		/**
		* If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
		* but TypeScript won't allow widening the signature of a child method.
		*/
		toJSON(_, ctx) {
			if (!ctx) return super.toJSON(_);
			const map = /* @__PURE__ */ new Map();
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const pair of this.items) {
				let key, value;
				if (identity.isPair(pair)) {
					key = toJS.toJS(pair.key, "", ctx);
					value = toJS.toJS(pair.value, key, ctx);
				} else key = toJS.toJS(pair, "", ctx);
				if (map.has(key)) throw new Error("Ordered maps must not include duplicate keys");
				map.set(key, value);
			}
			return map;
		}
		static from(schema, iterable, ctx) {
			const pairs$1 = pairs.createPairs(schema, iterable, ctx);
			const omap = new this();
			omap.items = pairs$1.items;
			return omap;
		}
	};
	YAMLOMap.tag = "tag:yaml.org,2002:omap";
	const omap = {
		collection: "seq",
		identify: (value) => value instanceof Map,
		nodeClass: YAMLOMap,
		default: false,
		tag: "tag:yaml.org,2002:omap",
		resolve(seq, onError) {
			const pairs$1 = pairs.resolvePairs(seq, onError);
			const seenKeys = [];
			for (const { key } of pairs$1.items) if (identity.isScalar(key)) if (seenKeys.includes(key.value)) onError(`Ordered maps must not include duplicate keys: ${key.value}`);
			else seenKeys.push(key.value);
			return Object.assign(new YAMLOMap(), pairs$1);
		},
		createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
	};
	exports.YAMLOMap = YAMLOMap;
	exports.omap = omap;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function boolStringify({ value, source }, ctx) {
		if (source && (value ? trueTag : falseTag).test.test(source)) return source;
		return value ? ctx.options.trueStr : ctx.options.falseStr;
	}
	const trueTag = {
		identify: (value) => value === true,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
		resolve: () => new Scalar.Scalar(true),
		stringify: boolStringify
	};
	const falseTag = {
		identify: (value) => value === false,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
		resolve: () => new Scalar.Scalar(false),
		stringify: boolStringify
	};
	exports.falseTag = falseTag;
	exports.trueTag = trueTag;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str.replace(/_/g, "")),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
			const dot = str.indexOf(".");
			if (dot !== -1) {
				const f = str.substring(dot + 1).replace(/_/g, "");
				if (f[f.length - 1] === "0") node.minFractionDigits = f.length;
			}
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	function intResolve(str, offset, radix, { intAsBigInt }) {
		const sign = str[0];
		if (sign === "-" || sign === "+") offset += 1;
		str = str.substring(offset).replace(/_/g, "");
		if (intAsBigInt) {
			switch (radix) {
				case 2:
					str = `0b${str}`;
					break;
				case 8:
					str = `0o${str}`;
					break;
				case 16:
					str = `0x${str}`;
					break;
			}
			const n = BigInt(str);
			return sign === "-" ? BigInt(-1) * n : n;
		}
		const n = parseInt(str, radix);
		return sign === "-" ? -1 * n : n;
	}
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value)) {
			const str = value.toString(radix);
			return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
		}
		return stringifyNumber.stringifyNumber(node);
	}
	const intBin = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "BIN",
		test: /^[-+]?0b[0-1_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
		stringify: (node) => intStringify(node, 2, "0b")
	};
	const intOct = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^[-+]?0[0-7_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
		stringify: (node) => intStringify(node, 8, "0")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9][0-9_]*$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^[-+]?0x[0-9a-fA-F_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intBin = intBin;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSet = class YAMLSet extends YAMLMap.YAMLMap {
		constructor(schema) {
			super(schema);
			this.tag = YAMLSet.tag;
		}
		add(key) {
			let pair;
			if (identity.isPair(key)) pair = key;
			else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null) pair = new Pair.Pair(key.key, null);
			else pair = new Pair.Pair(key, null);
			if (!YAMLMap.findPair(this.items, pair.key)) this.items.push(pair);
		}
		/**
		* If `keepPair` is `true`, returns the Pair matching `key`.
		* Otherwise, returns the value of that Pair's key.
		*/
		get(key, keepPair) {
			const pair = YAMLMap.findPair(this.items, key);
			return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
		}
		set(key, value) {
			if (typeof value !== "boolean") throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
			const prev = YAMLMap.findPair(this.items, key);
			if (prev && !value) this.items.splice(this.items.indexOf(prev), 1);
			else if (!prev && value) this.items.push(new Pair.Pair(key));
		}
		toJSON(_, ctx) {
			return super.toJSON(_, ctx, Set);
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			if (this.hasAllNullValues(true)) return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
			else throw new Error("Set items must all have null values");
		}
		static from(schema, iterable, ctx) {
			const { replacer } = ctx;
			const set = new this(schema);
			if (iterable && Symbol.iterator in Object(iterable)) for (let value of iterable) {
				if (typeof replacer === "function") value = replacer.call(iterable, value, value);
				set.items.push(Pair.createPair(value, null, ctx));
			}
			return set;
		}
	};
	YAMLSet.tag = "tag:yaml.org,2002:set";
	const set = {
		collection: "map",
		identify: (value) => value instanceof Set,
		nodeClass: YAMLSet,
		default: false,
		tag: "tag:yaml.org,2002:set",
		createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
		resolve(map, onError) {
			if (identity.isMap(map)) if (map.hasAllNullValues(true)) return Object.assign(new YAMLSet(), map);
			else onError("Set items must all have null values");
			else onError("Expected a mapping for this tag");
			return map;
		}
	};
	exports.YAMLSet = YAMLSet;
	exports.set = set;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	/** Internal types handle bigint as number, because TS can't figure it out. */
	function parseSexagesimal(str, asBigInt) {
		const sign = str[0];
		const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
		const num = (n) => asBigInt ? BigInt(n) : Number(n);
		const res = parts.replace(/_/g, "").split(":").reduce((res, p) => res * num(60) + num(p), num(0));
		return sign === "-" ? num(-1) * res : res;
	}
	/**
	* hhhh:mm:ss.sss
	*
	* Internal types handle bigint as number, because TS can't figure it out.
	*/
	function stringifySexagesimal(node) {
		let { value } = node;
		let num = (n) => n;
		if (typeof value === "bigint") num = (n) => BigInt(n);
		else if (isNaN(value) || !isFinite(value)) return stringifyNumber.stringifyNumber(node);
		let sign = "";
		if (value < 0) {
			sign = "-";
			value *= num(-1);
		}
		const _60 = num(60);
		const parts = [value % _60];
		if (value < 60) parts.unshift(0);
		else {
			value = (value - parts[0]) / _60;
			parts.unshift(value % _60);
			if (value >= 60) {
				value = (value - parts[0]) / _60;
				parts.unshift(value);
			}
		}
		return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
	}
	const intTime = {
		identify: (value) => typeof value === "bigint" || Number.isInteger(value),
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
		resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
		stringify: stringifySexagesimal
	};
	const floatTime = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
		resolve: (str) => parseSexagesimal(str, false),
		stringify: stringifySexagesimal
	};
	const timestamp = {
		identify: (value) => value instanceof Date,
		default: true,
		tag: "tag:yaml.org,2002:timestamp",
		test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
		resolve(str) {
			const match = str.match(timestamp.test);
			if (!match) throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
			const [, year, month, day, hour, minute, second] = match.map(Number);
			const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
			let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
			const tz = match[8];
			if (tz && tz !== "Z") {
				let d = parseSexagesimal(tz, false);
				if (Math.abs(d) < 30) d *= 60;
				date -= 6e4 * d;
			}
			return new Date(date);
		},
		stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
	};
	exports.floatTime = floatTime;
	exports.intTime = intTime;
	exports.timestamp = timestamp;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var binary = require_binary();
	var bool = require_bool();
	var float = require_float();
	var int = require_int();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var set = require_set();
	var timestamp = require_timestamp();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.trueTag,
		bool.falseTag,
		int.intBin,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float,
		binary.binary,
		merge.merge,
		omap.omap,
		pairs.pairs,
		set.set,
		timestamp.intTime,
		timestamp.floatTime,
		timestamp.timestamp
	];
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/tags.js
var require_tags = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	var schema = require_schema$2();
	var schema$1 = require_schema$1();
	var binary = require_binary();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var schema$2 = require_schema();
	var set = require_set();
	var timestamp = require_timestamp();
	const schemas = new Map([
		["core", schema.schema],
		["failsafe", [
			map.map,
			seq.seq,
			string.string
		]],
		["json", schema$1.schema],
		["yaml11", schema$2.schema],
		["yaml-1.1", schema$2.schema]
	]);
	const tagsByName = {
		binary: binary.binary,
		bool: bool.boolTag,
		float: float.float,
		floatExp: float.floatExp,
		floatNaN: float.floatNaN,
		floatTime: timestamp.floatTime,
		int: int.int,
		intHex: int.intHex,
		intOct: int.intOct,
		intTime: timestamp.intTime,
		map: map.map,
		merge: merge.merge,
		null: _null.nullTag,
		omap: omap.omap,
		pairs: pairs.pairs,
		seq: seq.seq,
		set: set.set,
		timestamp: timestamp.timestamp
	};
	const coreKnownTags = {
		"tag:yaml.org,2002:binary": binary.binary,
		"tag:yaml.org,2002:merge": merge.merge,
		"tag:yaml.org,2002:omap": omap.omap,
		"tag:yaml.org,2002:pairs": pairs.pairs,
		"tag:yaml.org,2002:set": set.set,
		"tag:yaml.org,2002:timestamp": timestamp.timestamp
	};
	function getTags(customTags, schemaName, addMergeTag) {
		const schemaTags = schemas.get(schemaName);
		if (schemaTags && !customTags) return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
		let tags = schemaTags;
		if (!tags) if (Array.isArray(customTags)) tags = [];
		else {
			const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
			throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
		}
		if (Array.isArray(customTags)) for (const tag of customTags) tags = tags.concat(tag);
		else if (typeof customTags === "function") tags = customTags(tags.slice());
		if (addMergeTag) tags = tags.concat(merge.merge);
		return tags.reduce((tags, tag) => {
			const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
			if (!tagObj) {
				const tagName = JSON.stringify(tag);
				const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
				throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
			}
			if (!tags.includes(tagObj)) tags.push(tagObj);
			return tags;
		}, []);
	}
	exports.coreKnownTags = coreKnownTags;
	exports.getTags = getTags;
}));
//#endregion
//#region ../node_modules/yaml/dist/schema/Schema.js
var require_Schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var map = require_map();
	var seq = require_seq();
	var string = require_string();
	var tags = require_tags();
	const sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	exports.Schema = class Schema {
		constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
			this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
			this.name = typeof schema === "string" && schema || "core";
			this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
			this.tags = tags.getTags(customTags, this.name, merge);
			this.toStringOptions = toStringDefaults ?? null;
			Object.defineProperty(this, identity.MAP, { value: map.map });
			Object.defineProperty(this, identity.SCALAR, { value: string.string });
			Object.defineProperty(this, identity.SEQ, { value: seq.seq });
			this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
		}
		clone() {
			const copy = Object.create(Schema.prototype, Object.getOwnPropertyDescriptors(this));
			copy.tags = this.tags.slice();
			return copy;
		}
	};
}));
//#endregion
//#region ../node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyDocument(doc, options) {
		const lines = [];
		let hasDirectives = options.directives === true;
		if (options.directives !== false && doc.directives) {
			const dir = doc.directives.toString(doc);
			if (dir) {
				lines.push(dir);
				hasDirectives = true;
			} else if (doc.directives.docStart) hasDirectives = true;
		}
		if (hasDirectives) lines.push("---");
		const ctx = stringify.createStringifyContext(doc, options);
		const { commentString } = ctx.options;
		if (doc.commentBefore) {
			if (lines.length !== 1) lines.unshift("");
			const cs = commentString(doc.commentBefore);
			lines.unshift(stringifyComment.indentComment(cs, ""));
		}
		let chompKeep = false;
		let contentComment = null;
		if (doc.contents) {
			if (identity.isNode(doc.contents)) {
				if (doc.contents.spaceBefore && hasDirectives) lines.push("");
				if (doc.contents.commentBefore) {
					const cs = commentString(doc.contents.commentBefore);
					lines.push(stringifyComment.indentComment(cs, ""));
				}
				ctx.forceBlockIndent = !!doc.comment;
				contentComment = doc.contents.comment;
			}
			const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
			let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
			if (contentComment) body += stringifyComment.lineComment(body, "", commentString(contentComment));
			if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") lines[lines.length - 1] = `--- ${body}`;
			else lines.push(body);
		} else lines.push(stringify.stringify(doc.contents, ctx));
		if (doc.directives?.docEnd) if (doc.comment) {
			const cs = commentString(doc.comment);
			if (cs.includes("\n")) {
				lines.push("...");
				lines.push(stringifyComment.indentComment(cs, ""));
			} else lines.push(`... ${cs}`);
		} else lines.push("...");
		else {
			let dc = doc.comment;
			if (dc && chompKeep) dc = dc.replace(/^\n+/, "");
			if (dc) {
				if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "") lines.push("");
				lines.push(stringifyComment.indentComment(commentString(dc), ""));
			}
		}
		return lines.join("\n") + "\n";
	}
	exports.stringifyDocument = stringifyDocument;
}));
//#endregion
//#region ../node_modules/yaml/dist/doc/Document.js
var require_Document = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var toJS = require_toJS();
	var Schema = require_Schema();
	var stringifyDocument = require_stringifyDocument();
	var anchors = require_anchors();
	var applyReviver = require_applyReviver();
	var createNode = require_createNode();
	var directives = require_directives();
	var Document = class Document {
		constructor(value, replacer, options) {
			/** A comment before this Document */
			this.commentBefore = null;
			/** A comment immediately after this Document */
			this.comment = null;
			/** Errors encountered during parsing. */
			this.errors = [];
			/** Warnings encountered during parsing. */
			this.warnings = [];
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
			let _replacer = null;
			if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
			else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const opt = Object.assign({
				intAsBigInt: false,
				keepSourceTokens: false,
				logLevel: "warn",
				prettyErrors: true,
				strict: true,
				stringKeys: false,
				uniqueKeys: true,
				version: "1.2"
			}, options);
			this.options = opt;
			let { version } = opt;
			if (options?._directives) {
				this.directives = options._directives.atDocument();
				if (this.directives.yaml.explicit) version = this.directives.yaml.version;
			} else this.directives = new directives.Directives({ version });
			this.setSchema(version, options);
			this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
		}
		/**
		* Create a deep copy of this Document and its contents.
		*
		* Custom Node values that inherit from `Object` still refer to their original instances.
		*/
		clone() {
			const copy = Object.create(Document.prototype, { [identity.NODE_TYPE]: { value: identity.DOC } });
			copy.commentBefore = this.commentBefore;
			copy.comment = this.comment;
			copy.errors = this.errors.slice();
			copy.warnings = this.warnings.slice();
			copy.options = Object.assign({}, this.options);
			if (this.directives) copy.directives = this.directives.clone();
			copy.schema = this.schema.clone();
			copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** Adds a value to the document. */
		add(value) {
			if (assertCollection(this.contents)) this.contents.add(value);
		}
		/** Adds a value to the document. */
		addIn(path, value) {
			if (assertCollection(this.contents)) this.contents.addIn(path, value);
		}
		/**
		* Create a new `Alias` node, ensuring that the target `node` has the required anchor.
		*
		* If `node` already has an anchor, `name` is ignored.
		* Otherwise, the `node.anchor` value will be set to `name`,
		* or if an anchor with that name is already present in the document,
		* `name` will be used as a prefix for a new unique anchor.
		* If `name` is undefined, the generated anchor will use 'a' as a prefix.
		*/
		createAlias(node, name) {
			if (!node.anchor) {
				const prev = anchors.anchorNames(this);
				node.anchor = !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
			}
			return new Alias.Alias(node.anchor);
		}
		createNode(value, replacer, options) {
			let _replacer = void 0;
			if (typeof replacer === "function") {
				value = replacer.call({ "": value }, "", value);
				_replacer = replacer;
			} else if (Array.isArray(replacer)) {
				const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
				const asStr = replacer.filter(keyToStr).map(String);
				if (asStr.length > 0) replacer = replacer.concat(asStr);
				_replacer = replacer;
			} else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
			const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(this, anchorPrefix || "a");
			const ctx = {
				aliasDuplicateObjects: aliasDuplicateObjects ?? true,
				keepUndefined: keepUndefined ?? false,
				onAnchor,
				onTagObj,
				replacer: _replacer,
				schema: this.schema,
				sourceObjects
			};
			const node = createNode.createNode(value, tag, ctx);
			if (flow && identity.isCollection(node)) node.flow = true;
			setAnchors();
			return node;
		}
		/**
		* Convert a key and a value into a `Pair` using the current schema,
		* recursively wrapping all values as `Scalar` or `Collection` nodes.
		*/
		createPair(key, value, options = {}) {
			const k = this.createNode(key, null, options);
			const v = this.createNode(value, null, options);
			return new Pair.Pair(k, v);
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			return assertCollection(this.contents) ? this.contents.delete(key) : false;
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			if (Collection.isEmptyPath(path)) {
				if (this.contents == null) return false;
				this.contents = null;
				return true;
			}
			return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		get(key, keepScalar) {
			return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
		}
		/**
		* Returns item at `path`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			if (Collection.isEmptyPath(path)) return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
			return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
		}
		/**
		* Checks if the document includes a value with the key `key`.
		*/
		has(key) {
			return identity.isCollection(this.contents) ? this.contents.has(key) : false;
		}
		/**
		* Checks if the document includes a value at `path`.
		*/
		hasIn(path) {
			if (Collection.isEmptyPath(path)) return this.contents !== void 0;
			return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		set(key, value) {
			if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, [key], value);
			else if (assertCollection(this.contents)) this.contents.set(key, value);
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			if (Collection.isEmptyPath(path)) this.contents = value;
			else if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
			else if (assertCollection(this.contents)) this.contents.setIn(path, value);
		}
		/**
		* Change the YAML version and schema used by the document.
		* A `null` version disables support for directives, explicit tags, anchors, and aliases.
		* It also requires the `schema` option to be given as a `Schema` instance value.
		*
		* Overrides all previously set schema options.
		*/
		setSchema(version, options = {}) {
			if (typeof version === "number") version = String(version);
			let opt;
			switch (version) {
				case "1.1":
					if (this.directives) this.directives.yaml.version = "1.1";
					else this.directives = new directives.Directives({ version: "1.1" });
					opt = {
						resolveKnownTags: false,
						schema: "yaml-1.1"
					};
					break;
				case "1.2":
				case "next":
					if (this.directives) this.directives.yaml.version = version;
					else this.directives = new directives.Directives({ version });
					opt = {
						resolveKnownTags: true,
						schema: "core"
					};
					break;
				case null:
					if (this.directives) delete this.directives;
					opt = null;
					break;
				default: {
					const sv = JSON.stringify(version);
					throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
				}
			}
			if (options.schema instanceof Object) this.schema = options.schema;
			else if (opt) this.schema = new Schema.Schema(Object.assign(opt, options));
			else throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
		}
		toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc: this,
				keep: !json,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
		/**
		* A JSON representation of the document `contents`.
		*
		* @param jsonArg Used by `JSON.stringify` to indicate the array index or
		*   property name.
		*/
		toJSON(jsonArg, onAnchor) {
			return this.toJS({
				json: true,
				jsonArg,
				mapAsMap: false,
				onAnchor
			});
		}
		/** A YAML representation of the document. */
		toString(options = {}) {
			if (this.errors.length > 0) throw new Error("Document with errors cannot be stringified");
			if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
				const s = JSON.stringify(options.indent);
				throw new Error(`"indent" option must be a positive integer, not ${s}`);
			}
			return stringifyDocument.stringifyDocument(this, options);
		}
	};
	function assertCollection(contents) {
		if (identity.isCollection(contents)) return true;
		throw new Error("Expected a YAML collection as document contents");
	}
	exports.Document = Document;
}));
//#endregion
//#region ../node_modules/yaml/dist/errors.js
var require_errors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLError = class extends Error {
		constructor(name, pos, code, message) {
			super();
			this.name = name;
			this.code = code;
			this.message = message;
			this.pos = pos;
		}
	};
	var YAMLParseError = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLParseError", pos, code, message);
		}
	};
	var YAMLWarning = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLWarning", pos, code, message);
		}
	};
	const prettifyError = (src, lc) => (error) => {
		if (error.pos[0] === -1) return;
		error.linePos = error.pos.map((pos) => lc.linePos(pos));
		const { line, col } = error.linePos[0];
		error.message += ` at line ${line}, column ${col}`;
		let ci = col - 1;
		let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
		if (ci >= 60 && lineStr.length > 80) {
			const trimStart = Math.min(ci - 39, lineStr.length - 79);
			lineStr = "…" + lineStr.substring(trimStart);
			ci -= trimStart - 1;
		}
		if (lineStr.length > 80) lineStr = lineStr.substring(0, 79) + "…";
		if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
			let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
			if (prev.length > 80) prev = prev.substring(0, 79) + "…\n";
			lineStr = prev + lineStr;
		}
		if (/[^ ]/.test(lineStr)) {
			let count = 1;
			const end = error.linePos[1];
			if (end?.line === line && end.col > col) count = Math.max(1, Math.min(end.col - col, 80 - ci));
			const pointer = " ".repeat(ci) + "^".repeat(count);
			error.message += `:\n\n${lineStr}\n${pointer}\n`;
		}
	};
	exports.YAMLError = YAMLError;
	exports.YAMLParseError = YAMLParseError;
	exports.YAMLWarning = YAMLWarning;
	exports.prettifyError = prettifyError;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
		let spaceBefore = false;
		let atNewline = startOnNewline;
		let hasSpace = startOnNewline;
		let comment = "";
		let commentSep = "";
		let hasNewline = false;
		let reqSpace = false;
		let tab = null;
		let anchor = null;
		let tag = null;
		let newlineAfterProp = null;
		let comma = null;
		let found = null;
		let start = null;
		for (const token of tokens) {
			if (reqSpace) {
				if (token.type !== "space" && token.type !== "newline" && token.type !== "comma") onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
				reqSpace = false;
			}
			if (tab) {
				if (atNewline && token.type !== "comment" && token.type !== "newline") onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
				tab = null;
			}
			switch (token.type) {
				case "space":
					if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) tab = token;
					hasSpace = true;
					break;
				case "comment": {
					if (!hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					const cb = token.source.substring(1) || " ";
					if (!comment) comment = cb;
					else comment += commentSep + cb;
					commentSep = "";
					atNewline = false;
					break;
				}
				case "newline":
					if (atNewline) {
						if (comment) comment += token.source;
						else if (!found || indicator !== "seq-item-ind") spaceBefore = true;
					} else commentSep += token.source;
					atNewline = true;
					hasNewline = true;
					if (anchor || tag) newlineAfterProp = token;
					hasSpace = true;
					break;
				case "anchor":
					if (anchor) onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
					if (token.source.endsWith(":")) onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
					anchor = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case "tag":
					if (tag) onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
					tag = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case indicator:
					if (anchor || tag) onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
					if (found) onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
					found = token;
					atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
					hasSpace = false;
					break;
				case "comma": if (flow) {
					if (comma) onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
					comma = token;
					atNewline = false;
					hasSpace = false;
					break;
				}
				default:
					onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
					atNewline = false;
					hasSpace = false;
			}
		}
		const last = tokens[tokens.length - 1];
		const end = last ? last.offset + last.source.length : offset;
		if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
		if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq")) onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
		return {
			comma,
			found,
			spaceBefore,
			comment,
			hasNewline,
			anchor,
			tag,
			newlineAfterProp,
			end,
			start: start ?? end
		};
	}
	exports.resolveProps = resolveProps;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = /* @__PURE__ */ __commonJSMin(((exports) => {
	function containsNewline(key) {
		if (!key) return null;
		switch (key.type) {
			case "alias":
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				if (key.source.includes("\n")) return true;
				if (key.end) {
					for (const st of key.end) if (st.type === "newline") return true;
				}
				return false;
			case "flow-collection":
				for (const it of key.items) {
					for (const st of it.start) if (st.type === "newline") return true;
					if (it.sep) {
						for (const st of it.sep) if (st.type === "newline") return true;
					}
					if (containsNewline(it.key) || containsNewline(it.value)) return true;
				}
				return false;
			default: return true;
		}
	}
	exports.containsNewline = containsNewline;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = /* @__PURE__ */ __commonJSMin(((exports) => {
	var utilContainsNewline = require_util_contains_newline();
	function flowIndentCheck(indent, fc, onError) {
		if (fc?.type === "flow-collection") {
			const end = fc.end[0];
			if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) onError(end, "BAD_INDENT", "Flow end indicator should be more indented than parent", true);
		}
	}
	exports.flowIndentCheck = flowIndentCheck;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	function mapIncludes(ctx, items, search) {
		const { uniqueKeys } = ctx.options;
		if (uniqueKeys === false) return false;
		const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
		return items.some((pair) => isEqual(pair.key, search));
	}
	exports.mapIncludes = mapIncludes;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	var utilMapIncludes = require_util_map_includes();
	const startColMsg = "All mapping items must start at the same column";
	function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
		const map = new (tag?.nodeClass ?? YAMLMap.YAMLMap)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		let offset = bm.offset;
		let commentEnd = null;
		for (const collItem of bm.items) {
			const { start, key, sep, value } = collItem;
			const keyProps = resolveProps.resolveProps(start, {
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: bm.indent,
				startOnNewline: true
			});
			const implicitKey = !keyProps.found;
			if (implicitKey) {
				if (key) {
					if (key.type === "block-seq") onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
					else if ("indent" in key && key.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
				}
				if (!keyProps.anchor && !keyProps.tag && !sep) {
					commentEnd = keyProps.end;
					if (keyProps.comment) if (map.comment) map.comment += "\n" + keyProps.comment;
					else map.comment = keyProps.comment;
					continue;
				}
				if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
			} else if (keyProps.found?.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
			ctx.atKey = true;
			const keyStart = keyProps.end;
			const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
			ctx.atKey = false;
			if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
			const valueProps = resolveProps.resolveProps(sep ?? [], {
				indicator: "map-value-ind",
				next: value,
				offset: keyNode.range[2],
				onError,
				parentIndent: bm.indent,
				startOnNewline: !key || key.type === "block-scalar"
			});
			offset = valueProps.end;
			if (valueProps.found) {
				if (implicitKey) {
					if (value?.type === "block-map" && !valueProps.hasNewline) onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
					if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024) onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
				}
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
				if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
				offset = valueNode.range[2];
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			} else {
				if (implicitKey) onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
				if (valueProps.comment) if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
				else keyNode.comment = valueProps.comment;
				const pair = new Pair.Pair(keyNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			}
		}
		if (commentEnd && commentEnd < offset) onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
		map.range = [
			bm.offset,
			offset,
			commentEnd ?? offset
		];
		return map;
	}
	exports.resolveBlockMap = resolveBlockMap;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLSeq = require_YAMLSeq();
	var resolveProps = require_resolve_props();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
		const seq = new (tag?.nodeClass ?? YAMLSeq.YAMLSeq)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = bs.offset;
		let commentEnd = null;
		for (const { start, value } of bs.items) {
			const props = resolveProps.resolveProps(start, {
				indicator: "seq-item-ind",
				next: value,
				offset,
				onError,
				parentIndent: bs.indent,
				startOnNewline: true
			});
			if (!props.found) if (props.anchor || props.tag || value) if (value?.type === "block-seq") onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
			else onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
			else {
				commentEnd = props.end;
				if (props.comment) seq.comment = props.comment;
				continue;
			}
			const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
			offset = node.range[2];
			seq.items.push(node);
		}
		seq.range = [
			bs.offset,
			offset,
			commentEnd ?? offset
		];
		return seq;
	}
	exports.resolveBlockSeq = resolveBlockSeq;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveEnd(end, offset, reqSpace, onError) {
		let comment = "";
		if (end) {
			let hasSpace = false;
			let sep = "";
			for (const token of end) {
				const { source, type } = token;
				switch (type) {
					case "space":
						hasSpace = true;
						break;
					case "comment": {
						if (reqSpace && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
						const cb = source.substring(1) || " ";
						if (!comment) comment = cb;
						else comment += sep + cb;
						sep = "";
						break;
					}
					case "newline":
						if (comment) sep += source;
						hasSpace = true;
						break;
					default: onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
				}
				offset += source.length;
			}
		}
		return {
			comment,
			offset
		};
	}
	exports.resolveEnd = resolveEnd;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilMapIncludes = require_util_map_includes();
	const blockMsg = "Block collections are not allowed within flow collections";
	const isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
	function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
		const isMap = fc.start.source === "{";
		const fcName = isMap ? "flow map" : "flow sequence";
		const coll = new (tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq))(ctx.schema);
		coll.flow = true;
		const atRoot = ctx.atRoot;
		if (atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = fc.offset + fc.start.source.length;
		for (let i = 0; i < fc.items.length; ++i) {
			const collItem = fc.items[i];
			const { start, key, sep, value } = collItem;
			const props = resolveProps.resolveProps(start, {
				flow: fcName,
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: fc.indent,
				startOnNewline: false
			});
			if (!props.found) {
				if (!props.anchor && !props.tag && !sep && !value) {
					if (i === 0 && props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
					else if (i < fc.items.length - 1) onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
					if (props.comment) if (coll.comment) coll.comment += "\n" + props.comment;
					else coll.comment = props.comment;
					offset = props.end;
					continue;
				}
				if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key)) onError(key, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
			}
			if (i === 0) {
				if (props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
			} else {
				if (!props.comma) onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
				if (props.comment) {
					let prevItemComment = "";
					loop: for (const st of start) switch (st.type) {
						case "comma":
						case "space": break;
						case "comment":
							prevItemComment = st.source.substring(1);
							break loop;
						default: break loop;
					}
					if (prevItemComment) {
						let prev = coll.items[coll.items.length - 1];
						if (identity.isPair(prev)) prev = prev.value ?? prev.key;
						if (prev.comment) prev.comment += "\n" + prevItemComment;
						else prev.comment = prevItemComment;
						props.comment = props.comment.substring(prevItemComment.length + 1);
					}
				}
			}
			if (!isMap && !sep && !props.found) {
				const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
				coll.items.push(valueNode);
				offset = valueNode.range[2];
				if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
			} else {
				ctx.atKey = true;
				const keyStart = props.end;
				const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
				if (isBlock(key)) onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
				ctx.atKey = false;
				const valueProps = resolveProps.resolveProps(sep ?? [], {
					flow: fcName,
					indicator: "map-value-ind",
					next: value,
					offset: keyNode.range[2],
					onError,
					parentIndent: fc.indent,
					startOnNewline: false
				});
				if (valueProps.found) {
					if (!isMap && !props.found && ctx.options.strict) {
						if (sep) for (const st of sep) {
							if (st === valueProps.found) break;
							if (st.type === "newline") {
								onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
								break;
							}
						}
						if (props.start < valueProps.found.offset - 1024) onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
					}
				} else if (value) if ("source" in value && value.source?.[0] === ":") onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
				else onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
				if (valueNode) {
					if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
				} else if (valueProps.comment) if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
				else keyNode.comment = valueProps.comment;
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				if (isMap) {
					const map = coll;
					if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
					map.items.push(pair);
				} else {
					const map = new YAMLMap.YAMLMap(ctx.schema);
					map.flow = true;
					map.items.push(pair);
					const endRange = (valueNode ?? keyNode).range;
					map.range = [
						keyNode.range[0],
						endRange[1],
						endRange[2]
					];
					coll.items.push(map);
				}
				offset = valueNode ? valueNode.range[2] : valueProps.end;
			}
		}
		const expectedEnd = isMap ? "}" : "]";
		const [ce, ...ee] = fc.end;
		let cePos = offset;
		if (ce?.source === expectedEnd) cePos = ce.offset + ce.source.length;
		else {
			const name = fcName[0].toUpperCase() + fcName.substring(1);
			const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
			onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
			if (ce && ce.source.length !== 1) ee.unshift(ce);
		}
		if (ee.length > 0) {
			const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
			if (end.comment) if (coll.comment) coll.comment += "\n" + end.comment;
			else coll.comment = end.comment;
			coll.range = [
				fc.offset,
				cePos,
				end.offset
			];
		} else coll.range = [
			fc.offset,
			cePos,
			cePos
		];
		return coll;
	}
	exports.resolveFlowCollection = resolveFlowCollection;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveBlockMap = require_resolve_block_map();
	var resolveBlockSeq = require_resolve_block_seq();
	var resolveFlowCollection = require_resolve_flow_collection();
	function resolveCollection(CN, ctx, token, onError, tagName, tag) {
		const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
		const Coll = coll.constructor;
		if (tagName === "!" || tagName === Coll.tagName) {
			coll.tag = Coll.tagName;
			return coll;
		}
		if (tagName) coll.tag = tagName;
		return coll;
	}
	function composeCollection(CN, ctx, token, props, onError) {
		const tagToken = props.tag;
		const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
		if (token.type === "block-seq") {
			const { anchor, newlineAfterProp: nl } = props;
			const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
			if (lastProp && (!nl || nl.offset < lastProp.offset)) onError(lastProp, "MISSING_CHAR", "Missing newline after block sequence props");
		}
		const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
		if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") return resolveCollection(CN, ctx, token, onError, tagName);
		let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
		if (!tag) {
			const kt = ctx.schema.knownTags[tagName];
			if (kt?.collection === expType) {
				ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
				tag = kt;
			} else {
				if (kt) onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
				else onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
				return resolveCollection(CN, ctx, token, onError, tagName);
			}
		}
		const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
		const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
		const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
		node.range = coll.range;
		node.tag = tagName;
		if (tag?.format) node.format = tag.format;
		return node;
	}
	exports.composeCollection = composeCollection;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function resolveBlockScalar(ctx, scalar, onError) {
		const start = scalar.offset;
		const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
		if (!header) return {
			value: "",
			type: null,
			comment: "",
			range: [
				start,
				start,
				start
			]
		};
		const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
		const lines = scalar.source ? splitLines(scalar.source) : [];
		let chompStart = lines.length;
		for (let i = lines.length - 1; i >= 0; --i) {
			const content = lines[i][1];
			if (content === "" || content === "\r") chompStart = i;
			else break;
		}
		if (chompStart === 0) {
			const value = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
			let end = start + header.length;
			if (scalar.source) end += scalar.source.length;
			return {
				value,
				type,
				comment: header.comment,
				range: [
					start,
					end,
					end
				]
			};
		}
		let trimIndent = scalar.indent + header.indent;
		let offset = scalar.offset + header.length;
		let contentStart = 0;
		for (let i = 0; i < chompStart; ++i) {
			const [indent, content] = lines[i];
			if (content === "" || content === "\r") {
				if (header.indent === 0 && indent.length > trimIndent) trimIndent = indent.length;
			} else {
				if (indent.length < trimIndent) onError(offset + indent.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator");
				if (header.indent === 0) trimIndent = indent.length;
				contentStart = i;
				if (trimIndent === 0 && !ctx.atRoot) onError(offset, "BAD_INDENT", "Block scalar values in collections must be indented");
				break;
			}
			offset += indent.length + content.length + 1;
		}
		for (let i = lines.length - 1; i >= chompStart; --i) if (lines[i][0].length > trimIndent) chompStart = i + 1;
		let value = "";
		let sep = "";
		let prevMoreIndented = false;
		for (let i = 0; i < contentStart; ++i) value += lines[i][0].slice(trimIndent) + "\n";
		for (let i = contentStart; i < chompStart; ++i) {
			let [indent, content] = lines[i];
			offset += indent.length + content.length + 1;
			const crlf = content[content.length - 1] === "\r";
			if (crlf) content = content.slice(0, -1);
			/* istanbul ignore if already caught in lexer */
			if (content && indent.length < trimIndent) {
				const message = `Block scalar lines must not be less indented than their ${header.indent ? "explicit indentation indicator" : "first line"}`;
				onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
				indent = "";
			}
			if (type === Scalar.Scalar.BLOCK_LITERAL) {
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
			} else if (indent.length > trimIndent || content[0] === "	") {
				if (sep === " ") sep = "\n";
				else if (!prevMoreIndented && sep === "\n") sep = "\n\n";
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
				prevMoreIndented = true;
			} else if (content === "") if (sep === "\n") value += "\n";
			else sep = "\n";
			else {
				value += sep + content;
				sep = " ";
				prevMoreIndented = false;
			}
		}
		switch (header.chomp) {
			case "-": break;
			case "+":
				for (let i = chompStart; i < lines.length; ++i) value += "\n" + lines[i][0].slice(trimIndent);
				if (value[value.length - 1] !== "\n") value += "\n";
				break;
			default: value += "\n";
		}
		const end = start + header.length + scalar.source.length;
		return {
			value,
			type,
			comment: header.comment,
			range: [
				start,
				end,
				end
			]
		};
	}
	function parseBlockScalarHeader({ offset, props }, strict, onError) {
		/* istanbul ignore if should not happen */
		if (props[0].type !== "block-scalar-header") {
			onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
			return null;
		}
		const { source } = props[0];
		const mode = source[0];
		let indent = 0;
		let chomp = "";
		let error = -1;
		for (let i = 1; i < source.length; ++i) {
			const ch = source[i];
			if (!chomp && (ch === "-" || ch === "+")) chomp = ch;
			else {
				const n = Number(ch);
				if (!indent && n) indent = n;
				else if (error === -1) error = offset + i;
			}
		}
		if (error !== -1) onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
		let hasSpace = false;
		let comment = "";
		let length = source.length;
		for (let i = 1; i < props.length; ++i) {
			const token = props[i];
			switch (token.type) {
				case "space": hasSpace = true;
				case "newline":
					length += token.source.length;
					break;
				case "comment":
					if (strict && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					length += token.source.length;
					comment = token.source.substring(1);
					break;
				case "error":
					onError(token, "UNEXPECTED_TOKEN", token.message);
					length += token.source.length;
					break;
				/* istanbul ignore next should not happen */
				default: {
					onError(token, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${token.type}`);
					const ts = token.source;
					if (ts && typeof ts === "string") length += ts.length;
				}
			}
		}
		return {
			mode,
			indent,
			chomp,
			comment,
			length
		};
	}
	/** @returns Array of lines split up as `[indent, content]` */
	function splitLines(source) {
		const split = source.split(/\n( *)/);
		const first = split[0];
		const m = first.match(/^( *)/);
		const lines = [m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first]];
		for (let i = 1; i < split.length; i += 2) lines.push([split[i], split[i + 1]]);
		return lines;
	}
	exports.resolveBlockScalar = resolveBlockScalar;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var resolveEnd = require_resolve_end();
	function resolveFlowScalar(scalar, strict, onError) {
		const { offset, type, source, end } = scalar;
		let _type;
		let value;
		const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
		switch (type) {
			case "scalar":
				_type = Scalar.Scalar.PLAIN;
				value = plainValue(source, _onError);
				break;
			case "single-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_SINGLE;
				value = singleQuotedValue(source, _onError);
				break;
			case "double-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_DOUBLE;
				value = doubleQuotedValue(source, _onError);
				break;
			/* istanbul ignore next should not happen */
			default:
				onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
				return {
					value: "",
					type: null,
					comment: "",
					range: [
						offset,
						offset + source.length,
						offset + source.length
					]
				};
		}
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
		return {
			value,
			type: _type,
			comment: re.comment,
			range: [
				offset,
				valueEnd,
				re.offset
			]
		};
	}
	function plainValue(source, onError) {
		let badChar = "";
		switch (source[0]) {
			/* istanbul ignore next should not happen */
			case "	":
				badChar = "a tab character";
				break;
			case ",":
				badChar = "flow indicator character ,";
				break;
			case "%":
				badChar = "directive indicator character %";
				break;
			case "|":
			case ">":
				badChar = `block scalar indicator ${source[0]}`;
				break;
			case "@":
			case "`":
				badChar = `reserved character ${source[0]}`;
				break;
		}
		if (badChar) onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
		return foldLines(source);
	}
	function singleQuotedValue(source, onError) {
		if (source[source.length - 1] !== "'" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
		return foldLines(source.slice(1, -1)).replace(/''/g, "'");
	}
	function foldLines(source) {
		/**
		* The negative lookbehind here and in the `re` RegExp is to
		* prevent causing a polynomial search time in certain cases.
		*
		* The try-catch is for Safari, which doesn't support this yet:
		* https://caniuse.com/js-regexp-lookbehind
		*/
		let first, line;
		try {
			first = /* @__PURE__ */ new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
			line = /* @__PURE__ */ new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
		} catch {
			first = /(.*?)[ \t]*\r?\n/sy;
			line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
		}
		let match = first.exec(source);
		if (!match) return source;
		let res = match[1];
		let sep = " ";
		let pos = first.lastIndex;
		line.lastIndex = pos;
		while (match = line.exec(source)) {
			if (match[1] === "") if (sep === "\n") res += sep;
			else sep = "\n";
			else {
				res += sep + match[1];
				sep = " ";
			}
			pos = line.lastIndex;
		}
		const last = /[ \t]*(.*)/sy;
		last.lastIndex = pos;
		match = last.exec(source);
		return res + sep + (match?.[1] ?? "");
	}
	function doubleQuotedValue(source, onError) {
		let res = "";
		for (let i = 1; i < source.length - 1; ++i) {
			const ch = source[i];
			if (ch === "\r" && source[i + 1] === "\n") continue;
			if (ch === "\n") {
				const { fold, offset } = foldNewline(source, i);
				res += fold;
				i = offset;
			} else if (ch === "\\") {
				let next = source[++i];
				const cc = escapeCodes[next];
				if (cc) res += cc;
				else if (next === "\n") {
					next = source[i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "\r" && source[i + 1] === "\n") {
					next = source[++i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "x" || next === "u" || next === "U") {
					const length = next === "x" ? 2 : next === "u" ? 4 : 8;
					res += parseCharCode(source, i + 1, length, onError);
					i += length;
				} else {
					const raw = source.substr(i - 1, 2);
					onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
					res += raw;
				}
			} else if (ch === " " || ch === "	") {
				const wsStart = i;
				let next = source[i + 1];
				while (next === " " || next === "	") next = source[++i + 1];
				if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n")) res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
			} else res += ch;
		}
		if (source[source.length - 1] !== "\"" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing \"quote");
		return res;
	}
	/**
	* Fold a single newline into a space, multiple newlines to N - 1 newlines.
	* Presumes `source[offset] === '\n'`
	*/
	function foldNewline(source, offset) {
		let fold = "";
		let ch = source[offset + 1];
		while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
			if (ch === "\r" && source[offset + 2] !== "\n") break;
			if (ch === "\n") fold += "\n";
			offset += 1;
			ch = source[offset + 1];
		}
		if (!fold) fold = " ";
		return {
			fold,
			offset
		};
	}
	const escapeCodes = {
		"0": "\0",
		a: "\x07",
		b: "\b",
		e: "\x1B",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "	",
		v: "\v",
		N: "",
		_: "\xA0",
		L: "\u2028",
		P: "\u2029",
		" ": " ",
		"\"": "\"",
		"/": "/",
		"\\": "\\",
		"	": "	"
	};
	function parseCharCode(source, offset, length, onError) {
		const cc = source.substr(offset, length);
		const code = cc.length === length && /^[0-9a-fA-F]+$/.test(cc) ? parseInt(cc, 16) : NaN;
		try {
			return String.fromCodePoint(code);
		} catch {
			const raw = source.substr(offset - 2, length + 2);
			onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
			return raw;
		}
	}
	exports.resolveFlowScalar = resolveFlowScalar;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	function composeScalar(ctx, token, tagToken, onError) {
		const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
		const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
		let tag;
		if (ctx.options.stringKeys && ctx.atKey) tag = ctx.schema[identity.SCALAR];
		else if (tagName) tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
		else if (token.type === "scalar") tag = findScalarTagByTest(ctx, value, token, onError);
		else tag = ctx.schema[identity.SCALAR];
		let scalar;
		try {
			const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
			scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
			scalar = new Scalar.Scalar(value);
		}
		scalar.range = range;
		scalar.source = value;
		if (type) scalar.type = type;
		if (tagName) scalar.tag = tagName;
		if (tag.format) scalar.format = tag.format;
		if (comment) scalar.comment = comment;
		return scalar;
	}
	function findScalarTagByName(schema, value, tagName, tagToken, onError) {
		if (tagName === "!") return schema[identity.SCALAR];
		const matchWithTest = [];
		for (const tag of schema.tags) if (!tag.collection && tag.tag === tagName) if (tag.default && tag.test) matchWithTest.push(tag);
		else return tag;
		for (const tag of matchWithTest) if (tag.test?.test(value)) return tag;
		const kt = schema.knownTags[tagName];
		if (kt && !kt.collection) {
			schema.tags.push(Object.assign({}, kt, {
				default: false,
				test: void 0
			}));
			return kt;
		}
		onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
		return schema[identity.SCALAR];
	}
	function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
		const tag = schema.tags.find((tag) => (tag.default === true || atKey && tag.default === "key") && tag.test?.test(value)) || schema[identity.SCALAR];
		if (schema.compat) {
			const compat = schema.compat.find((tag) => tag.default && tag.test?.test(value)) ?? schema[identity.SCALAR];
			if (tag.tag !== compat.tag) onError(token, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${directives.tagString(tag.tag)} or ${directives.tagString(compat.tag)}`, true);
		}
		return tag;
	}
	exports.composeScalar = composeScalar;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = /* @__PURE__ */ __commonJSMin(((exports) => {
	function emptyScalarPosition(offset, before, pos) {
		if (before) {
			pos ?? (pos = before.length);
			for (let i = pos - 1; i >= 0; --i) {
				let st = before[i];
				switch (st.type) {
					case "space":
					case "comment":
					case "newline":
						offset -= st.source.length;
						continue;
				}
				st = before[++i];
				while (st?.type === "space") {
					offset += st.source.length;
					st = before[++i];
				}
				break;
			}
		}
		return offset;
	}
	exports.emptyScalarPosition = emptyScalarPosition;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var composeCollection = require_compose_collection();
	var composeScalar = require_compose_scalar();
	var resolveEnd = require_resolve_end();
	var utilEmptyScalarPosition = require_util_empty_scalar_position();
	const CN = {
		composeNode,
		composeEmptyNode
	};
	function composeNode(ctx, token, props, onError) {
		const atKey = ctx.atKey;
		const { spaceBefore, comment, anchor, tag } = props;
		let node;
		let isSrcToken = true;
		switch (token.type) {
			case "alias":
				node = composeAlias(ctx, token, onError);
				if (anchor || tag) onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
				break;
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "block-scalar":
				node = composeScalar.composeScalar(ctx, token, tag, onError);
				if (anchor) node.anchor = anchor.source.substring(1);
				break;
			case "block-map":
			case "block-seq":
			case "flow-collection":
				try {
					node = composeCollection.composeCollection(CN, ctx, token, props, onError);
					if (anchor) node.anchor = anchor.source.substring(1);
				} catch (error) {
					onError(token, "RESOURCE_EXHAUSTION", error instanceof Error ? error.message : String(error));
				}
				break;
			default:
				onError(token, "UNEXPECTED_TOKEN", token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`);
				isSrcToken = false;
		}
		node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
		if (anchor && node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) onError(tag ?? token, "NON_STRING_KEY", "With stringKeys, all keys must be strings");
		if (spaceBefore) node.spaceBefore = true;
		if (comment) if (token.type === "scalar" && token.source === "") node.comment = comment;
		else node.commentBefore = comment;
		if (ctx.options.keepSourceTokens && isSrcToken) node.srcToken = token;
		return node;
	}
	function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
		const token = {
			type: "scalar",
			offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
			indent: -1,
			source: ""
		};
		const node = composeScalar.composeScalar(ctx, token, tag, onError);
		if (anchor) {
			node.anchor = anchor.source.substring(1);
			if (node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		}
		if (spaceBefore) node.spaceBefore = true;
		if (comment) {
			node.comment = comment;
			node.range[2] = end;
		}
		return node;
	}
	function composeAlias({ options }, { offset, source, end }, onError) {
		const alias = new Alias.Alias(source.substring(1));
		if (alias.source === "") onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
		if (alias.source.endsWith(":")) onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
		alias.range = [
			offset,
			valueEnd,
			re.offset
		];
		if (re.comment) alias.comment = re.comment;
		return alias;
	}
	exports.composeEmptyNode = composeEmptyNode;
	exports.composeNode = composeNode;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Document = require_Document();
	var composeNode = require_compose_node();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	function composeDoc(options, directives, { offset, start, value, end }, onError) {
		const opts = Object.assign({ _directives: directives }, options);
		const doc = new Document.Document(void 0, opts);
		const ctx = {
			atKey: false,
			atRoot: true,
			directives: doc.directives,
			options: doc.options,
			schema: doc.schema
		};
		const props = resolveProps.resolveProps(start, {
			indicator: "doc-start",
			next: value ?? end?.[0],
			offset,
			onError,
			parentIndent: 0,
			startOnNewline: true
		});
		if (props.found) {
			doc.directives.docStart = true;
			if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline) onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
		}
		doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
		const contentEnd = doc.contents.range[2];
		const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
		if (re.comment) doc.comment = re.comment;
		doc.range = [
			offset,
			contentEnd,
			re.offset
		];
		return doc;
	}
	exports.composeDoc = composeDoc;
}));
//#endregion
//#region ../node_modules/yaml/dist/compose/composer.js
var require_composer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$1 = __require("process");
	var directives = require_directives();
	var Document = require_Document();
	var errors = require_errors();
	var identity = require_identity();
	var composeDoc = require_compose_doc();
	var resolveEnd = require_resolve_end();
	function getErrorPos(src) {
		if (typeof src === "number") return [src, src + 1];
		if (Array.isArray(src)) return src.length === 2 ? src : [src[0], src[1]];
		const { offset, source } = src;
		return [offset, offset + (typeof source === "string" ? source.length : 1)];
	}
	function parsePrelude(prelude) {
		let comment = "";
		let atComment = false;
		let afterEmptyLine = false;
		for (let i = 0; i < prelude.length; ++i) {
			const source = prelude[i];
			switch (source[0]) {
				case "#":
					comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
					atComment = true;
					afterEmptyLine = false;
					break;
				case "%":
					if (prelude[i + 1]?.[0] !== "#") i += 1;
					atComment = false;
					break;
				default:
					if (!atComment) afterEmptyLine = true;
					atComment = false;
			}
		}
		return {
			comment,
			afterEmptyLine
		};
	}
	/**
	* Compose a stream of CST nodes into a stream of YAML Documents.
	*
	* ```ts
	* import { Composer, Parser } from 'yaml'
	*
	* const src: string = ...
	* const tokens = new Parser().parse(src)
	* const docs = new Composer().compose(tokens)
	* ```
	*/
	var Composer = class {
		constructor(options = {}) {
			this.doc = null;
			this.atDirectives = false;
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
			this.onError = (source, code, message, warning) => {
				const pos = getErrorPos(source);
				if (warning) this.warnings.push(new errors.YAMLWarning(pos, code, message));
				else this.errors.push(new errors.YAMLParseError(pos, code, message));
			};
			this.directives = new directives.Directives({ version: options.version || "1.2" });
			this.options = options;
		}
		decorate(doc, afterDoc) {
			const { comment, afterEmptyLine } = parsePrelude(this.prelude);
			if (comment) {
				const dc = doc.contents;
				if (afterDoc) doc.comment = doc.comment ? `${doc.comment}\n${comment}` : comment;
				else if (afterEmptyLine || doc.directives.docStart || !dc) doc.commentBefore = comment;
				else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
					let it = dc.items[0];
					if (identity.isPair(it)) it = it.key;
					const cb = it.commentBefore;
					it.commentBefore = cb ? `${comment}\n${cb}` : comment;
				} else {
					const cb = dc.commentBefore;
					dc.commentBefore = cb ? `${comment}\n${cb}` : comment;
				}
			}
			if (afterDoc) {
				for (let i = 0; i < this.errors.length; ++i) doc.errors.push(this.errors[i]);
				for (let i = 0; i < this.warnings.length; ++i) doc.warnings.push(this.warnings[i]);
			} else {
				doc.errors = this.errors;
				doc.warnings = this.warnings;
			}
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
		}
		/**
		* Current stream status information.
		*
		* Mostly useful at the end of input for an empty stream.
		*/
		streamInfo() {
			return {
				comment: parsePrelude(this.prelude).comment,
				directives: this.directives,
				errors: this.errors,
				warnings: this.warnings
			};
		}
		/**
		* Compose tokens into documents.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*compose(tokens, forceDoc = false, endOffset = -1) {
			for (const token of tokens) yield* this.next(token);
			yield* this.end(forceDoc, endOffset);
		}
		/** Advance the composer by one CST token. */
		*next(token) {
			if (node_process$1.env.LOG_STREAM) console.dir(token, { depth: null });
			switch (token.type) {
				case "directive":
					this.directives.add(token.source, (offset, message, warning) => {
						const pos = getErrorPos(token);
						pos[0] += offset;
						this.onError(pos, "BAD_DIRECTIVE", message, warning);
					});
					this.prelude.push(token.source);
					this.atDirectives = true;
					break;
				case "document": {
					const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
					if (this.atDirectives && !doc.directives.docStart) this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
					this.decorate(doc, false);
					if (this.doc) yield this.doc;
					this.doc = doc;
					this.atDirectives = false;
					break;
				}
				case "byte-order-mark":
				case "space": break;
				case "comment":
				case "newline":
					this.prelude.push(token.source);
					break;
				case "error": {
					const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
					const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
					if (this.atDirectives || !this.doc) this.errors.push(error);
					else this.doc.errors.push(error);
					break;
				}
				case "doc-end": {
					if (!this.doc) {
						this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
						break;
					}
					this.doc.directives.docEnd = true;
					const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
					this.decorate(this.doc, true);
					if (end.comment) {
						const dc = this.doc.comment;
						this.doc.comment = dc ? `${dc}\n${end.comment}` : end.comment;
					}
					this.doc.range[2] = end.offset;
					break;
				}
				default: this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
			}
		}
		/**
		* Call at end of input to yield any remaining document.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*end(forceDoc = false, endOffset = -1) {
			if (this.doc) {
				this.decorate(this.doc, true);
				yield this.doc;
				this.doc = null;
			} else if (forceDoc) {
				const opts = Object.assign({ _directives: this.directives }, this.options);
				const doc = new Document.Document(void 0, opts);
				if (this.atDirectives) this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
				doc.range = [
					0,
					endOffset,
					endOffset
				];
				this.decorate(doc, false);
				yield doc;
			}
		}
	};
	exports.Composer = Composer;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	var errors = require_errors();
	var stringifyString = require_stringifyString();
	function resolveAsScalar(token, strict = true, onError) {
		if (token) {
			const _onError = (pos, code, message) => {
				const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
				if (onError) onError(offset, code, message);
				else throw new errors.YAMLParseError([offset, offset + 1], code, message);
			};
			switch (token.type) {
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
				case "block-scalar": return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
			}
		}
		return null;
	}
	/**
	* Create a new scalar token with `value`
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.end Comments and whitespace after the end of the value, or after the block scalar header. If undefined, a newline will be added.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.indent The indent level of the token.
	* @param context.inFlow Is this scalar within a flow collection? This may affect the resolved type of the token's value.
	* @param context.offset The offset position of the token.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function createScalarToken(value, context) {
		const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey,
			indent: indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		const end = context.end ?? [{
			type: "newline",
			offset: -1,
			indent,
			source: "\n"
		}];
		switch (source[0]) {
			case "|":
			case ">": {
				const he = source.indexOf("\n");
				const head = source.substring(0, he);
				const body = source.substring(he + 1) + "\n";
				const props = [{
					type: "block-scalar-header",
					offset,
					indent,
					source: head
				}];
				if (!addEndtoBlockProps(props, end)) props.push({
					type: "newline",
					offset: -1,
					indent,
					source: "\n"
				});
				return {
					type: "block-scalar",
					offset,
					indent,
					props,
					source: body
				};
			}
			case "\"": return {
				type: "double-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			case "'": return {
				type: "single-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			default: return {
				type: "scalar",
				offset,
				indent,
				source,
				end
			};
		}
	}
	/**
	* Set the value of `token` to the given string `value`, overwriting any previous contents and type that it may have.
	*
	* Best efforts are made to retain any comments previously associated with the `token`,
	* though all contents within a collection's `items` will be overwritten.
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param token Any token. If it does not include an `indent` value, the value will be stringified as if it were an implicit key.
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.afterKey In most cases, values after a key should have an additional level of indentation.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.inFlow Being within a flow collection may affect the resolved type of the token's value.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function setScalarValue(token, value, context = {}) {
		let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
		let indent = "indent" in token ? token.indent : null;
		if (afterKey && typeof indent === "number") indent += 2;
		if (!type) switch (token.type) {
			case "single-quoted-scalar":
				type = "QUOTE_SINGLE";
				break;
			case "double-quoted-scalar":
				type = "QUOTE_DOUBLE";
				break;
			case "block-scalar": {
				const header = token.props[0];
				if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
				type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
				break;
			}
			default: type = "PLAIN";
		}
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey: implicitKey || indent === null,
			indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		switch (source[0]) {
			case "|":
			case ">":
				setBlockScalarValue(token, source);
				break;
			case "\"":
				setFlowScalarValue(token, source, "double-quoted-scalar");
				break;
			case "'":
				setFlowScalarValue(token, source, "single-quoted-scalar");
				break;
			default: setFlowScalarValue(token, source, "scalar");
		}
	}
	function setBlockScalarValue(token, source) {
		const he = source.indexOf("\n");
		const head = source.substring(0, he);
		const body = source.substring(he + 1) + "\n";
		if (token.type === "block-scalar") {
			const header = token.props[0];
			if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
			header.source = head;
			token.source = body;
		} else {
			const { offset } = token;
			const indent = "indent" in token ? token.indent : -1;
			const props = [{
				type: "block-scalar-header",
				offset,
				indent,
				source: head
			}];
			if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0)) props.push({
				type: "newline",
				offset: -1,
				indent,
				source: "\n"
			});
			for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
			Object.assign(token, {
				type: "block-scalar",
				indent,
				props,
				source: body
			});
		}
	}
	/** @returns `true` if last token is a newline */
	function addEndtoBlockProps(props, end) {
		if (end) for (const st of end) switch (st.type) {
			case "space":
			case "comment":
				props.push(st);
				break;
			case "newline":
				props.push(st);
				return true;
		}
		return false;
	}
	function setFlowScalarValue(token, source, type) {
		switch (token.type) {
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				token.type = type;
				token.source = source;
				break;
			case "block-scalar": {
				const end = token.props.slice(1);
				let oa = source.length;
				if (token.props[0].type === "block-scalar-header") oa -= token.props[0].source.length;
				for (const tok of end) tok.offset += oa;
				delete token.props;
				Object.assign(token, {
					type,
					source,
					end
				});
				break;
			}
			case "block-map":
			case "block-seq": {
				const nl = {
					type: "newline",
					offset: token.offset + source.length,
					indent: token.indent,
					source: "\n"
				};
				delete token.items;
				Object.assign(token, {
					type,
					source,
					end: [nl]
				});
				break;
			}
			default: {
				const indent = "indent" in token ? token.indent : -1;
				const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
				for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
				Object.assign(token, {
					type,
					indent,
					source,
					end
				});
			}
		}
	}
	exports.createScalarToken = createScalarToken;
	exports.resolveAsScalar = resolveAsScalar;
	exports.setScalarValue = setScalarValue;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringify a CST document, token, or collection item
	*
	* Fair warning: This applies no validation whatsoever, and
	* simply concatenates the sources in their logical order.
	*/
	const stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
	function stringifyToken(token) {
		switch (token.type) {
			case "block-scalar": {
				let res = "";
				for (const tok of token.props) res += stringifyToken(tok);
				return res + token.source;
			}
			case "block-map":
			case "block-seq": {
				let res = "";
				for (const item of token.items) res += stringifyItem(item);
				return res;
			}
			case "flow-collection": {
				let res = token.start.source;
				for (const item of token.items) res += stringifyItem(item);
				for (const st of token.end) res += st.source;
				return res;
			}
			case "document": {
				let res = stringifyItem(token);
				if (token.end) for (const st of token.end) res += st.source;
				return res;
			}
			default: {
				let res = token.source;
				if ("end" in token && token.end) for (const st of token.end) res += st.source;
				return res;
			}
		}
	}
	function stringifyItem({ start, key, sep, value }) {
		let res = "";
		for (const st of start) res += st.source;
		if (key) res += stringifyToken(key);
		if (sep) for (const st of sep) res += st.source;
		if (value) res += stringifyToken(value);
		return res;
	}
	exports.stringify = stringify;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove item");
	/**
	* Apply a visitor to a CST document or item.
	*
	* Walks through the tree (depth-first) starting from the root, calling a
	* `visitor` function with two arguments when entering each item:
	*   - `item`: The current item, which included the following members:
	*     - `start: SourceToken[]` – Source tokens before the key or value,
	*       possibly including its anchor or tag.
	*     - `key?: Token | null` – Set for pair values. May then be `null`, if
	*       the key before the `:` separator is empty.
	*     - `sep?: SourceToken[]` – Source tokens between the key and the value,
	*       which should include the `:` map value indicator if `value` is set.
	*     - `value?: Token` – The value of a sequence item, or of a map pair.
	*   - `path`: The steps from the root to the current node, as an array of
	*     `['key' | 'value', number]` tuples.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this token, continue with
	*      next sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current item, then continue with the next one
	*   - `number`: Set the index of the next step. This is useful especially if
	*     the index of the current token has changed.
	*   - `function`: Define the next visitor for this item. After the original
	*     visitor is called on item entry, next visitors are called after handling
	*     a non-empty `key` and when exiting the item.
	*/
	function visit(cst, visitor) {
		if ("type" in cst && cst.type === "document") cst = {
			start: cst.start,
			value: cst.value
		};
		_visit(Object.freeze([]), cst, visitor);
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current item */
	visit.SKIP = SKIP;
	/** Remove the current item */
	visit.REMOVE = REMOVE;
	/** Find the item at `path` from `cst` as the root */
	visit.itemAtPath = (cst, path) => {
		let item = cst;
		for (const [field, index] of path) {
			const tok = item?.[field];
			if (tok && "items" in tok) item = tok.items[index];
			else return void 0;
		}
		return item;
	};
	/**
	* Get the immediate parent collection of the item at `path` from `cst` as the root.
	*
	* Throws an error if the collection is not found, which should never happen if the item itself exists.
	*/
	visit.parentCollection = (cst, path) => {
		const parent = visit.itemAtPath(cst, path.slice(0, -1));
		const field = path[path.length - 1][0];
		const coll = parent?.[field];
		if (coll && "items" in coll) return coll;
		throw new Error("Parent collection not found");
	};
	function _visit(path, item, visitor) {
		let ctrl = visitor(item, path);
		if (typeof ctrl === "symbol") return ctrl;
		for (const field of ["key", "value"]) {
			const token = item[field];
			if (token && "items" in token) {
				for (let i = 0; i < token.items.length; ++i) {
					const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						token.items.splice(i, 1);
						i -= 1;
					}
				}
				if (typeof ctrl === "function" && field === "key") ctrl = ctrl(item, path);
			}
		}
		return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
	}
	exports.visit = visit;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/cst.js
var require_cst = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cstScalar = require_cst_scalar();
	var cstStringify = require_cst_stringify();
	var cstVisit = require_cst_visit();
	/** The byte order mark */
	const BOM = "﻿";
	/** Start of doc-mode */
	const DOCUMENT = "";
	/** Unexpected end of flow-mode */
	const FLOW_END = "";
	/** Next token is a scalar value */
	const SCALAR = "";
	/** @returns `true` if `token` is a flow or block collection */
	const isCollection = (token) => !!token && "items" in token;
	/** @returns `true` if `token` is a flow or block scalar; not an alias */
	const isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
	/* istanbul ignore next */
	/** Get a printable representation of a lexer token */
	function prettyToken(token) {
		switch (token) {
			case BOM: return "<BOM>";
			case DOCUMENT: return "<DOC>";
			case FLOW_END: return "<FLOW_END>";
			case SCALAR: return "<SCALAR>";
			default: return JSON.stringify(token);
		}
	}
	/** Identify the type of a lexer token. May return `null` for unknown tokens. */
	function tokenType(source) {
		switch (source) {
			case BOM: return "byte-order-mark";
			case DOCUMENT: return "doc-mode";
			case FLOW_END: return "flow-error-end";
			case SCALAR: return "scalar";
			case "---": return "doc-start";
			case "...": return "doc-end";
			case "":
			case "\n":
			case "\r\n": return "newline";
			case "-": return "seq-item-ind";
			case "?": return "explicit-key-ind";
			case ":": return "map-value-ind";
			case "{": return "flow-map-start";
			case "}": return "flow-map-end";
			case "[": return "flow-seq-start";
			case "]": return "flow-seq-end";
			case ",": return "comma";
		}
		switch (source[0]) {
			case " ":
			case "	": return "space";
			case "#": return "comment";
			case "%": return "directive-line";
			case "*": return "alias";
			case "&": return "anchor";
			case "!": return "tag";
			case "'": return "single-quoted-scalar";
			case "\"": return "double-quoted-scalar";
			case "|":
			case ">": return "block-scalar-header";
		}
		return null;
	}
	exports.createScalarToken = cstScalar.createScalarToken;
	exports.resolveAsScalar = cstScalar.resolveAsScalar;
	exports.setScalarValue = cstScalar.setScalarValue;
	exports.stringify = cstStringify.stringify;
	exports.visit = cstVisit.visit;
	exports.BOM = BOM;
	exports.DOCUMENT = DOCUMENT;
	exports.FLOW_END = FLOW_END;
	exports.SCALAR = SCALAR;
	exports.isCollection = isCollection;
	exports.isScalar = isScalar;
	exports.prettyToken = prettyToken;
	exports.tokenType = tokenType;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/lexer.js
var require_lexer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cst = require_cst();
	function isEmpty(ch) {
		switch (ch) {
			case void 0:
			case " ":
			case "\n":
			case "\r":
			case "	": return true;
			default: return false;
		}
	}
	const hexDigits = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef");
	const tagChars = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
	const flowIndicatorChars = /* @__PURE__ */ new Set(",[]{}");
	const invalidAnchorChars = /* @__PURE__ */ new Set(" ,[]{}\n\r	");
	const isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
	/**
	* Splits an input string into lexical tokens, i.e. smaller strings that are
	* easily identifiable by `tokens.tokenType()`.
	*
	* Lexing starts always in a "stream" context. Incomplete input may be buffered
	* until a complete token can be emitted.
	*
	* In addition to slices of the original input, the following control characters
	* may also be emitted:
	*
	* - `\x02` (Start of Text): A document starts with the next token
	* - `\x18` (Cancel): Unexpected end of flow-mode (indicates an error)
	* - `\x1f` (Unit Separator): Next token is a scalar value
	* - `\u{FEFF}` (Byte order mark): Emitted separately outside documents
	*/
	var Lexer = class {
		constructor() {
			/**
			* Flag indicating whether the end of the current buffer marks the end of
			* all input
			*/
			this.atEnd = false;
			/**
			* Explicit indent set in block scalar header, as an offset from the current
			* minimum indent, so e.g. set to 1 from a header `|2+`. Set to -1 if not
			* explicitly set.
			*/
			this.blockScalarIndent = -1;
			/**
			* Block scalars that include a + (keep) chomping indicator in their header
			* include trailing empty lines, which are otherwise excluded from the
			* scalar's contents.
			*/
			this.blockScalarKeep = false;
			/** Current input */
			this.buffer = "";
			/**
			* Flag noting whether the map value indicator : can immediately follow this
			* node within a flow context.
			*/
			this.flowKey = false;
			/** Count of surrounding flow collection levels. */
			this.flowLevel = 0;
			/**
			* Minimum level of indentation required for next lines to be parsed as a
			* part of the current scalar value.
			*/
			this.indentNext = 0;
			/** Indentation level of the current line. */
			this.indentValue = 0;
			/** Position of the next \n character. */
			this.lineEndPos = null;
			/** Stores the state of the lexer if reaching the end of incpomplete input */
			this.next = null;
			/** A pointer to `buffer`; the current position of the lexer. */
			this.pos = 0;
		}
		/**
		* Generate YAML tokens from the `source` string. If `incomplete`,
		* a part of the last line may be left as a buffer for the next call.
		*
		* @returns A generator of lexical tokens
		*/
		*lex(source, incomplete = false) {
			if (source) {
				if (typeof source !== "string") throw TypeError("source is not a string");
				this.buffer = this.buffer ? this.buffer + source : source;
				this.lineEndPos = null;
			}
			this.atEnd = !incomplete;
			let next = this.next ?? "stream";
			while (next && (incomplete || this.hasChars(1))) next = yield* this.parseNext(next);
		}
		atLineEnd() {
			let i = this.pos;
			let ch = this.buffer[i];
			while (ch === " " || ch === "	") ch = this.buffer[++i];
			if (!ch || ch === "#" || ch === "\n") return true;
			if (ch === "\r") return this.buffer[i + 1] === "\n";
			return false;
		}
		charAt(n) {
			return this.buffer[this.pos + n];
		}
		continueScalar(offset) {
			let ch = this.buffer[offset];
			if (this.indentNext > 0) {
				let indent = 0;
				while (ch === " ") ch = this.buffer[++indent + offset];
				if (ch === "\r") {
					const next = this.buffer[indent + offset + 1];
					if (next === "\n" || !next && !this.atEnd) return offset + indent + 1;
				}
				return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
			}
			if (ch === "-" || ch === ".") {
				const dt = this.buffer.substr(offset, 3);
				if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3])) return -1;
			}
			return offset;
		}
		getLine() {
			let end = this.lineEndPos;
			if (typeof end !== "number" || end !== -1 && end < this.pos) {
				end = this.buffer.indexOf("\n", this.pos);
				this.lineEndPos = end;
			}
			if (end === -1) return this.atEnd ? this.buffer.substring(this.pos) : null;
			if (this.buffer[end - 1] === "\r") end -= 1;
			return this.buffer.substring(this.pos, end);
		}
		hasChars(n) {
			return this.pos + n <= this.buffer.length;
		}
		setNext(state) {
			this.buffer = this.buffer.substring(this.pos);
			this.pos = 0;
			this.lineEndPos = null;
			this.next = state;
			return null;
		}
		peek(n) {
			return this.buffer.substr(this.pos, n);
		}
		*parseNext(next) {
			switch (next) {
				case "stream": return yield* this.parseStream();
				case "line-start": return yield* this.parseLineStart();
				case "block-start": return yield* this.parseBlockStart();
				case "doc": return yield* this.parseDocument();
				case "flow": return yield* this.parseFlowCollection();
				case "quoted-scalar": return yield* this.parseQuotedScalar();
				case "block-scalar": return yield* this.parseBlockScalar();
				case "plain-scalar": return yield* this.parsePlainScalar();
			}
		}
		*parseStream() {
			let line = this.getLine();
			if (line === null) return this.setNext("stream");
			if (line[0] === cst.BOM) {
				yield* this.pushCount(1);
				line = line.substring(1);
			}
			if (line[0] === "%") {
				let dirEnd = line.length;
				let cs = line.indexOf("#");
				while (cs !== -1) {
					const ch = line[cs - 1];
					if (ch === " " || ch === "	") {
						dirEnd = cs - 1;
						break;
					} else cs = line.indexOf("#", cs + 1);
				}
				while (true) {
					const ch = line[dirEnd - 1];
					if (ch === " " || ch === "	") dirEnd -= 1;
					else break;
				}
				const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
				yield* this.pushCount(line.length - n);
				this.pushNewline();
				return "stream";
			}
			if (this.atLineEnd()) {
				const sp = yield* this.pushSpaces(true);
				yield* this.pushCount(line.length - sp);
				yield* this.pushNewline();
				return "stream";
			}
			yield cst.DOCUMENT;
			return yield* this.parseLineStart();
		}
		*parseLineStart() {
			const ch = this.charAt(0);
			if (!ch && !this.atEnd) return this.setNext("line-start");
			if (ch === "-" || ch === ".") {
				if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
				const s = this.peek(3);
				if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
					yield* this.pushCount(3);
					this.indentValue = 0;
					this.indentNext = 0;
					return s === "---" ? "doc" : "stream";
				}
			}
			this.indentValue = yield* this.pushSpaces(false);
			if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1))) this.indentNext = this.indentValue;
			return yield* this.parseBlockStart();
		}
		*parseBlockStart() {
			const [ch0, ch1] = this.peek(2);
			if (!ch1 && !this.atEnd) return this.setNext("block-start");
			if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
				const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
				this.indentNext = this.indentValue + 1;
				this.indentValue += n;
				return "block-start";
			}
			return "doc";
		}
		*parseDocument() {
			yield* this.pushSpaces(true);
			const line = this.getLine();
			if (line === null) return this.setNext("doc");
			let n = yield* this.pushIndicators();
			switch (line[n]) {
				case "#": yield* this.pushCount(line.length - n);
				case void 0:
					yield* this.pushNewline();
					return yield* this.parseLineStart();
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel = 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					return "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "doc";
				case "\"":
				case "'": return yield* this.parseQuotedScalar();
				case "|":
				case ">":
					n += yield* this.parseBlockScalarHeader();
					n += yield* this.pushSpaces(true);
					yield* this.pushCount(line.length - n);
					yield* this.pushNewline();
					return yield* this.parseBlockScalar();
				default: return yield* this.parsePlainScalar();
			}
		}
		*parseFlowCollection() {
			let nl, sp;
			let indent = -1;
			do {
				nl = yield* this.pushNewline();
				if (nl > 0) {
					sp = yield* this.pushSpaces(false);
					this.indentValue = indent = sp;
				} else sp = 0;
				sp += yield* this.pushSpaces(true);
			} while (nl + sp > 0);
			const line = this.getLine();
			if (line === null) return this.setNext("flow");
			if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
				if (!(indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}"))) {
					this.flowLevel = 0;
					yield cst.FLOW_END;
					return yield* this.parseLineStart();
				}
			}
			let n = 0;
			while (line[n] === ",") {
				n += yield* this.pushCount(1);
				n += yield* this.pushSpaces(true);
				this.flowKey = false;
			}
			n += yield* this.pushIndicators();
			switch (line[n]) {
				case void 0: return "flow";
				case "#":
					yield* this.pushCount(line.length - n);
					return "flow";
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel += 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					this.flowKey = true;
					this.flowLevel -= 1;
					return this.flowLevel ? "flow" : "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "flow";
				case "\"":
				case "'":
					this.flowKey = true;
					return yield* this.parseQuotedScalar();
				case ":": {
					const next = this.charAt(1);
					if (this.flowKey || isEmpty(next) || next === ",") {
						this.flowKey = false;
						yield* this.pushCount(1);
						yield* this.pushSpaces(true);
						return "flow";
					}
				}
				default:
					this.flowKey = false;
					return yield* this.parsePlainScalar();
			}
		}
		*parseQuotedScalar() {
			const quote = this.charAt(0);
			let end = this.buffer.indexOf(quote, this.pos + 1);
			if (quote === "'") while (end !== -1 && this.buffer[end + 1] === "'") end = this.buffer.indexOf("'", end + 2);
			else while (end !== -1) {
				let n = 0;
				while (this.buffer[end - 1 - n] === "\\") n += 1;
				if (n % 2 === 0) break;
				end = this.buffer.indexOf("\"", end + 1);
			}
			const qb = this.buffer.substring(0, end);
			let nl = qb.indexOf("\n", this.pos);
			if (nl !== -1) {
				while (nl !== -1) {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = qb.indexOf("\n", cs);
				}
				if (nl !== -1) end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
			}
			if (end === -1) {
				if (!this.atEnd) return this.setNext("quoted-scalar");
				end = this.buffer.length;
			}
			yield* this.pushToIndex(end + 1, false);
			return this.flowLevel ? "flow" : "doc";
		}
		*parseBlockScalarHeader() {
			this.blockScalarIndent = -1;
			this.blockScalarKeep = false;
			let i = this.pos;
			while (true) {
				const ch = this.buffer[++i];
				if (ch === "+") this.blockScalarKeep = true;
				else if (ch > "0" && ch <= "9") this.blockScalarIndent = Number(ch) - 1;
				else if (ch !== "-") break;
			}
			return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
		}
		*parseBlockScalar() {
			let nl = this.pos - 1;
			let indent = 0;
			let ch;
			loop: for (let i = this.pos; ch = this.buffer[i]; ++i) switch (ch) {
				case " ":
					indent += 1;
					break;
				case "\n":
					nl = i;
					indent = 0;
					break;
				case "\r": {
					const next = this.buffer[i + 1];
					if (!next && !this.atEnd) return this.setNext("block-scalar");
					if (next === "\n") break;
				}
				default: break loop;
			}
			if (!ch && !this.atEnd) return this.setNext("block-scalar");
			if (indent >= this.indentNext) {
				if (this.blockScalarIndent === -1) this.indentNext = indent;
				else this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
				do {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = this.buffer.indexOf("\n", cs);
				} while (nl !== -1);
				if (nl === -1) {
					if (!this.atEnd) return this.setNext("block-scalar");
					nl = this.buffer.length;
				}
			}
			let i = nl + 1;
			ch = this.buffer[i];
			while (ch === " ") ch = this.buffer[++i];
			if (ch === "	") {
				while (ch === "	" || ch === " " || ch === "\r" || ch === "\n") ch = this.buffer[++i];
				nl = i - 1;
			} else if (!this.blockScalarKeep) do {
				let i = nl - 1;
				let ch = this.buffer[i];
				if (ch === "\r") ch = this.buffer[--i];
				const lastChar = i;
				while (ch === " ") ch = this.buffer[--i];
				if (ch === "\n" && i >= this.pos && i + 1 + indent > lastChar) nl = i;
				else break;
			} while (true);
			yield cst.SCALAR;
			yield* this.pushToIndex(nl + 1, true);
			return yield* this.parseLineStart();
		}
		*parsePlainScalar() {
			const inFlow = this.flowLevel > 0;
			let end = this.pos - 1;
			let i = this.pos - 1;
			let ch;
			while (ch = this.buffer[++i]) if (ch === ":") {
				const next = this.buffer[i + 1];
				if (isEmpty(next) || inFlow && flowIndicatorChars.has(next)) break;
				end = i;
			} else if (isEmpty(ch)) {
				let next = this.buffer[i + 1];
				if (ch === "\r") if (next === "\n") {
					i += 1;
					ch = "\n";
					next = this.buffer[i + 1];
				} else end = i;
				if (next === "#" || inFlow && flowIndicatorChars.has(next)) break;
				if (ch === "\n") {
					const cs = this.continueScalar(i + 1);
					if (cs === -1) break;
					i = Math.max(i, cs - 2);
				}
			} else {
				if (inFlow && flowIndicatorChars.has(ch)) break;
				end = i;
			}
			if (!ch && !this.atEnd) return this.setNext("plain-scalar");
			yield cst.SCALAR;
			yield* this.pushToIndex(end + 1, true);
			return inFlow ? "flow" : "doc";
		}
		*pushCount(n) {
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos += n;
				return n;
			}
			return 0;
		}
		*pushToIndex(i, allowEmpty) {
			const s = this.buffer.slice(this.pos, i);
			if (s) {
				yield s;
				this.pos += s.length;
				return s.length;
			} else if (allowEmpty) yield "";
			return 0;
		}
		*pushIndicators() {
			let n = 0;
			loop: while (true) {
				switch (this.charAt(0)) {
					case "!":
						n += yield* this.pushTag();
						n += yield* this.pushSpaces(true);
						continue loop;
					case "&":
						n += yield* this.pushUntil(isNotAnchorChar);
						n += yield* this.pushSpaces(true);
						continue loop;
					case "-":
					case "?":
					case ":": {
						const inFlow = this.flowLevel > 0;
						const ch1 = this.charAt(1);
						if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
							if (!inFlow) this.indentNext = this.indentValue + 1;
							else if (this.flowKey) this.flowKey = false;
							n += yield* this.pushCount(1);
							n += yield* this.pushSpaces(true);
							continue loop;
						}
					}
				}
				break loop;
			}
			return n;
		}
		*pushTag() {
			if (this.charAt(1) === "<") {
				let i = this.pos + 2;
				let ch = this.buffer[i];
				while (!isEmpty(ch) && ch !== ">") ch = this.buffer[++i];
				return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
			} else {
				let i = this.pos + 1;
				let ch = this.buffer[i];
				while (ch) if (tagChars.has(ch)) ch = this.buffer[++i];
				else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) ch = this.buffer[i += 3];
				else break;
				return yield* this.pushToIndex(i, false);
			}
		}
		*pushNewline() {
			const ch = this.buffer[this.pos];
			if (ch === "\n") return yield* this.pushCount(1);
			else if (ch === "\r" && this.charAt(1) === "\n") return yield* this.pushCount(2);
			else return 0;
		}
		*pushSpaces(allowTabs) {
			let i = this.pos - 1;
			let ch;
			do
				ch = this.buffer[++i];
			while (ch === " " || allowTabs && ch === "	");
			const n = i - this.pos;
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos = i;
			}
			return n;
		}
		*pushUntil(test) {
			let i = this.pos;
			let ch = this.buffer[i];
			while (!test(ch)) ch = this.buffer[++i];
			return yield* this.pushToIndex(i, false);
		}
	};
	exports.Lexer = Lexer;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Tracks newlines during parsing in order to provide an efficient API for
	* determining the one-indexed `{ line, col }` position for any offset
	* within the input.
	*/
	var LineCounter = class {
		constructor() {
			this.lineStarts = [];
			/**
			* Should be called in ascending order. Otherwise, call
			* `lineCounter.lineStarts.sort()` before calling `linePos()`.
			*/
			this.addNewLine = (offset) => this.lineStarts.push(offset);
			/**
			* Performs a binary search and returns the 1-indexed { line, col }
			* position of `offset`. If `line === 0`, `addNewLine` has never been
			* called or `offset` is before the first known newline.
			*/
			this.linePos = (offset) => {
				let low = 0;
				let high = this.lineStarts.length;
				while (low < high) {
					const mid = low + high >> 1;
					if (this.lineStarts[mid] < offset) low = mid + 1;
					else high = mid;
				}
				if (this.lineStarts[low] === offset) return {
					line: low + 1,
					col: 1
				};
				if (low === 0) return {
					line: 0,
					col: offset
				};
				const start = this.lineStarts[low - 1];
				return {
					line: low,
					col: offset - start + 1
				};
			};
		}
	};
	exports.LineCounter = LineCounter;
}));
//#endregion
//#region ../node_modules/yaml/dist/parse/parser.js
var require_parser = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process = __require("process");
	var cst = require_cst();
	var lexer = require_lexer();
	function includesToken(list, type) {
		for (let i = 0; i < list.length; ++i) if (list[i].type === type) return true;
		return false;
	}
	function findNonEmptyIndex(list) {
		for (let i = 0; i < list.length; ++i) switch (list[i].type) {
			case "space":
			case "comment":
			case "newline": break;
			default: return i;
		}
		return -1;
	}
	function isFlowToken(token) {
		switch (token?.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "flow-collection": return true;
			default: return false;
		}
	}
	function getPrevProps(parent) {
		switch (parent.type) {
			case "document": return parent.start;
			case "block-map": {
				const it = parent.items[parent.items.length - 1];
				return it.sep ?? it.start;
			}
			case "block-seq": return parent.items[parent.items.length - 1].start;
			/* istanbul ignore next should not happen */
			default: return [];
		}
	}
	/** Note: May modify input array */
	function getFirstKeyStartProps(prev) {
		if (prev.length === 0) return [];
		let i = prev.length;
		loop: while (--i >= 0) switch (prev[i].type) {
			case "doc-start":
			case "explicit-key-ind":
			case "map-value-ind":
			case "seq-item-ind":
			case "newline": break loop;
		}
		while (prev[++i]?.type === "space");
		return prev.splice(i, prev.length);
	}
	function arrayPushArray(target, source) {
		if (source.length < 1e5) Array.prototype.push.apply(target, source);
		else for (let i = 0; i < source.length; ++i) target.push(source[i]);
	}
	function fixFlowSeqItems(fc) {
		if (fc.start.type === "flow-seq-start") {
			for (const it of fc.items) if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
				if (it.key) it.value = it.key;
				delete it.key;
				if (isFlowToken(it.value)) if (it.value.end) arrayPushArray(it.value.end, it.sep);
				else it.value.end = it.sep;
				else arrayPushArray(it.start, it.sep);
				delete it.sep;
			}
		}
	}
	/**
	* A YAML concrete syntax tree (CST) parser
	*
	* ```ts
	* const src: string = ...
	* for (const token of new Parser().parse(src)) {
	*   // token: Token
	* }
	* ```
	*
	* To use the parser with a user-provided lexer:
	*
	* ```ts
	* function* parse(source: string, lexer: Lexer) {
	*   const parser = new Parser()
	*   for (const lexeme of lexer.lex(source))
	*     yield* parser.next(lexeme)
	*   yield* parser.end()
	* }
	*
	* const src: string = ...
	* const lexer = new Lexer()
	* for (const token of parse(src, lexer)) {
	*   // token: Token
	* }
	* ```
	*/
	var Parser = class {
		/**
		* @param onNewLine - If defined, called separately with the start position of
		*   each new line (in `parse()`, including the start of input).
		*/
		constructor(onNewLine) {
			/** If true, space and sequence indicators count as indentation */
			this.atNewLine = true;
			/** If true, next token is a scalar value */
			this.atScalar = false;
			/** Current indentation level */
			this.indent = 0;
			/** Current offset since the start of parsing */
			this.offset = 0;
			/** On the same line with a block map key */
			this.onKeyLine = false;
			/** Top indicates the node that's currently being built */
			this.stack = [];
			/** The source of the current token, set in parse() */
			this.source = "";
			/** The type of the current token, set in parse() */
			this.type = "";
			this.lexer = new lexer.Lexer();
			this.onNewLine = onNewLine;
		}
		/**
		* Parse `source` as a YAML stream.
		* If `incomplete`, a part of the last line may be left as a buffer for the next call.
		*
		* Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
		*
		* @returns A generator of tokens representing each directive, document, and other structure.
		*/
		*parse(source, incomplete = false) {
			if (this.onNewLine && this.offset === 0) this.onNewLine(0);
			for (const lexeme of this.lexer.lex(source, incomplete)) yield* this.next(lexeme);
			if (!incomplete) yield* this.end();
		}
		/**
		* Advance the parser by the `source` of one lexical token.
		*/
		*next(source) {
			this.source = source;
			if (node_process.env.LOG_TOKENS) console.log("|", cst.prettyToken(source));
			if (this.atScalar) {
				this.atScalar = false;
				yield* this.step();
				this.offset += source.length;
				return;
			}
			const type = cst.tokenType(source);
			if (!type) {
				const message = `Not a YAML token: ${source}`;
				yield* this.pop({
					type: "error",
					offset: this.offset,
					message,
					source
				});
				this.offset += source.length;
			} else if (type === "scalar") {
				this.atNewLine = false;
				this.atScalar = true;
				this.type = "scalar";
			} else {
				this.type = type;
				yield* this.step();
				switch (type) {
					case "newline":
						this.atNewLine = true;
						this.indent = 0;
						if (this.onNewLine) this.onNewLine(this.offset + source.length);
						break;
					case "space":
						if (this.atNewLine && source[0] === " ") this.indent += source.length;
						break;
					case "explicit-key-ind":
					case "map-value-ind":
					case "seq-item-ind":
						if (this.atNewLine) this.indent += source.length;
						break;
					case "doc-mode":
					case "flow-error-end": return;
					default: this.atNewLine = false;
				}
				this.offset += source.length;
			}
		}
		/** Call at end of input to push out any remaining constructions */
		*end() {
			while (this.stack.length > 0) yield* this.pop();
		}
		get sourceToken() {
			return {
				type: this.type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		*step() {
			const top = this.peek(1);
			if (this.type === "doc-end" && top?.type !== "doc-end") {
				while (this.stack.length > 0) yield* this.pop();
				this.stack.push({
					type: "doc-end",
					offset: this.offset,
					source: this.source
				});
				return;
			}
			if (!top) return yield* this.stream();
			switch (top.type) {
				case "document": return yield* this.document(top);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(top);
				case "block-scalar": return yield* this.blockScalar(top);
				case "block-map": return yield* this.blockMap(top);
				case "block-seq": return yield* this.blockSequence(top);
				case "flow-collection": return yield* this.flowCollection(top);
				case "doc-end": return yield* this.documentEnd(top);
			}
			/* istanbul ignore next should not happen */
			yield* this.pop();
		}
		peek(n) {
			return this.stack[this.stack.length - n];
		}
		*pop(error) {
			const token = error ?? this.stack.pop();
			/* istanbul ignore if should not happen */
			if (!token) yield {
				type: "error",
				offset: this.offset,
				source: "",
				message: "Tried to pop an empty stack"
			};
			else if (this.stack.length === 0) yield token;
			else {
				const top = this.peek(1);
				if (token.type === "block-scalar") token.indent = "indent" in top ? top.indent : 0;
				else if (token.type === "flow-collection" && top.type === "document") token.indent = 0;
				if (token.type === "flow-collection") fixFlowSeqItems(token);
				switch (top.type) {
					case "document":
						top.value = token;
						break;
					case "block-scalar":
						top.props.push(token);
						break;
					case "block-map": {
						const it = top.items[top.items.length - 1];
						if (it.value) {
							top.items.push({
								start: [],
								key: token,
								sep: []
							});
							this.onKeyLine = true;
							return;
						} else if (it.sep) it.value = token;
						else {
							Object.assign(it, {
								key: token,
								sep: []
							});
							this.onKeyLine = !it.explicitKey;
							return;
						}
						break;
					}
					case "block-seq": {
						const it = top.items[top.items.length - 1];
						if (it.value) top.items.push({
							start: [],
							value: token
						});
						else it.value = token;
						break;
					}
					case "flow-collection": {
						const it = top.items[top.items.length - 1];
						if (!it || it.value) top.items.push({
							start: [],
							key: token,
							sep: []
						});
						else if (it.sep) it.value = token;
						else Object.assign(it, {
							key: token,
							sep: []
						});
						return;
					}
					/* istanbul ignore next should not happen */
					default:
						yield* this.pop();
						yield* this.pop(token);
				}
				if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
					const last = token.items[token.items.length - 1];
					if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
						if (top.type === "document") top.end = last.start;
						else top.items.push({ start: last.start });
						token.items.splice(-1, 1);
					}
				}
			}
		}
		*stream() {
			switch (this.type) {
				case "directive-line":
					yield {
						type: "directive",
						offset: this.offset,
						source: this.source
					};
					return;
				case "byte-order-mark":
				case "space":
				case "comment":
				case "newline":
					yield this.sourceToken;
					return;
				case "doc-mode":
				case "doc-start": {
					const doc = {
						type: "document",
						offset: this.offset,
						start: []
					};
					if (this.type === "doc-start") doc.start.push(this.sourceToken);
					this.stack.push(doc);
					return;
				}
			}
			yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML stream`,
				source: this.source
			};
		}
		*document(doc) {
			if (doc.value) return yield* this.lineEnd(doc);
			switch (this.type) {
				case "doc-start":
					if (findNonEmptyIndex(doc.start) !== -1) {
						yield* this.pop();
						yield* this.step();
					} else doc.start.push(this.sourceToken);
					return;
				case "anchor":
				case "tag":
				case "space":
				case "comment":
				case "newline":
					doc.start.push(this.sourceToken);
					return;
			}
			const bv = this.startBlockValue(doc);
			if (bv) this.stack.push(bv);
			else yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML document`,
				source: this.source
			};
		}
		*scalar(scalar) {
			if (this.type === "map-value-ind") {
				const start = getFirstKeyStartProps(getPrevProps(this.peek(2)));
				let sep;
				if (scalar.end) {
					sep = scalar.end;
					sep.push(this.sourceToken);
					delete scalar.end;
				} else sep = [this.sourceToken];
				const map = {
					type: "block-map",
					offset: scalar.offset,
					indent: scalar.indent,
					items: [{
						start,
						key: scalar,
						sep
					}]
				};
				this.onKeyLine = true;
				this.stack[this.stack.length - 1] = map;
			} else yield* this.lineEnd(scalar);
		}
		*blockScalar(scalar) {
			switch (this.type) {
				case "space":
				case "comment":
				case "newline":
					scalar.props.push(this.sourceToken);
					return;
				case "scalar":
					scalar.source = this.source;
					this.atNewLine = true;
					this.indent = 0;
					if (this.onNewLine) {
						let nl = this.source.indexOf("\n") + 1;
						while (nl !== 0) {
							this.onNewLine(this.offset + nl);
							nl = this.source.indexOf("\n", nl) + 1;
						}
					}
					yield* this.pop();
					break;
				/* istanbul ignore next should not happen */
				default:
					yield* this.pop();
					yield* this.step();
			}
		}
		*blockMap(map) {
			const it = map.items[map.items.length - 1];
			switch (this.type) {
				case "newline":
					this.onKeyLine = false;
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else map.items.push({ start: [this.sourceToken] });
					} else if (it.sep) it.sep.push(this.sourceToken);
					else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) map.items.push({ start: [this.sourceToken] });
					else if (it.sep) it.sep.push(this.sourceToken);
					else {
						if (this.atIndentedComment(it.start, map.indent)) {
							const end = map.items[map.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								map.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
			}
			if (this.indent >= map.indent) {
				const atMapIndent = !this.onKeyLine && this.indent === map.indent;
				const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
				let start = [];
				if (atNextItem && it.sep && !it.value) {
					const nl = [];
					for (let i = 0; i < it.sep.length; ++i) {
						const st = it.sep[i];
						switch (st.type) {
							case "newline":
								nl.push(i);
								break;
							case "space": break;
							case "comment":
								if (st.indent > map.indent) nl.length = 0;
								break;
							default: nl.length = 0;
						}
					}
					if (nl.length >= 2) start = it.sep.splice(nl[1]);
				}
				switch (this.type) {
					case "anchor":
					case "tag":
						if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({ start });
							this.onKeyLine = true;
						} else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "explicit-key-ind":
						if (!it.sep && !it.explicitKey) {
							it.start.push(this.sourceToken);
							it.explicitKey = true;
						} else if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({
								start,
								explicitKey: true
							});
						} else this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [this.sourceToken],
								explicitKey: true
							}]
						});
						this.onKeyLine = true;
						return;
					case "map-value-ind":
						if (it.explicitKey) if (!it.sep) if (includesToken(it.start, "newline")) Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						else {
							const start = getFirstKeyStartProps(it.start);
							this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key: null,
									sep: [this.sourceToken]
								}]
							});
						}
						else if (it.value) map.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
							const start = getFirstKeyStartProps(it.start);
							const key = it.key;
							const sep = it.sep;
							sep.push(this.sourceToken);
							delete it.key;
							delete it.sep;
							this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key,
									sep
								}]
							});
						} else if (start.length > 0) it.sep = it.sep.concat(start, this.sourceToken);
						else it.sep.push(this.sourceToken);
						else if (!it.sep) Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.value || atNextItem) map.items.push({
							start,
							key: null,
							sep: [this.sourceToken]
						});
						else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [],
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else it.sep.push(this.sourceToken);
						this.onKeyLine = true;
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (atNextItem || it.value) {
							map.items.push({
								start,
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						} else if (it.sep) this.stack.push(fs);
						else {
							Object.assign(it, {
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						}
						return;
					}
					default: {
						const bv = this.startBlockValue(map);
						if (bv) {
							if (bv.type === "block-seq") {
								if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
									yield* this.pop({
										type: "error",
										offset: this.offset,
										message: "Unexpected block-seq-ind on same line with key",
										source: this.source
									});
									return;
								}
							} else if (atMapIndent) map.items.push({ start });
							this.stack.push(bv);
							return;
						}
					}
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*blockSequence(seq) {
			const it = seq.items[seq.items.length - 1];
			switch (this.type) {
				case "newline":
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else seq.items.push({ start: [this.sourceToken] });
					} else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) seq.items.push({ start: [this.sourceToken] });
					else {
						if (this.atIndentedComment(it.start, seq.indent)) {
							const end = seq.items[seq.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								seq.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
				case "anchor":
				case "tag":
					if (it.value || this.indent <= seq.indent) break;
					it.start.push(this.sourceToken);
					return;
				case "seq-item-ind":
					if (this.indent !== seq.indent) break;
					if (it.value || includesToken(it.start, "seq-item-ind")) seq.items.push({ start: [this.sourceToken] });
					else it.start.push(this.sourceToken);
					return;
			}
			if (this.indent > seq.indent) {
				const bv = this.startBlockValue(seq);
				if (bv) {
					this.stack.push(bv);
					return;
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*flowCollection(fc) {
			const it = fc.items[fc.items.length - 1];
			if (this.type === "flow-error-end") {
				let top;
				do {
					yield* this.pop();
					top = this.peek(1);
				} while (top?.type === "flow-collection");
			} else if (fc.end.length === 0) {
				switch (this.type) {
					case "comma":
					case "explicit-key-ind":
						if (!it || it.sep) fc.items.push({ start: [this.sourceToken] });
						else it.start.push(this.sourceToken);
						return;
					case "map-value-ind":
						if (!it || it.value) fc.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.sep) it.sep.push(this.sourceToken);
						else Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						return;
					case "space":
					case "comment":
					case "newline":
					case "anchor":
					case "tag":
						if (!it || it.value) fc.items.push({ start: [this.sourceToken] });
						else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (!it || it.value) fc.items.push({
							start: [],
							key: fs,
							sep: []
						});
						else if (it.sep) this.stack.push(fs);
						else Object.assign(it, {
							key: fs,
							sep: []
						});
						return;
					}
					case "flow-map-end":
					case "flow-seq-end":
						fc.end.push(this.sourceToken);
						return;
				}
				const bv = this.startBlockValue(fc);
				/* istanbul ignore else should not happen */
				if (bv) this.stack.push(bv);
				else {
					yield* this.pop();
					yield* this.step();
				}
			} else {
				const parent = this.peek(2);
				if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
					yield* this.pop();
					yield* this.step();
				} else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
					const start = getFirstKeyStartProps(getPrevProps(parent));
					fixFlowSeqItems(fc);
					const sep = fc.end.splice(1, fc.end.length);
					sep.push(this.sourceToken);
					const map = {
						type: "block-map",
						offset: fc.offset,
						indent: fc.indent,
						items: [{
							start,
							key: fc,
							sep
						}]
					};
					this.onKeyLine = true;
					this.stack[this.stack.length - 1] = map;
				} else yield* this.lineEnd(fc);
			}
		}
		flowScalar(type) {
			if (this.onNewLine) {
				let nl = this.source.indexOf("\n") + 1;
				while (nl !== 0) {
					this.onNewLine(this.offset + nl);
					nl = this.source.indexOf("\n", nl) + 1;
				}
			}
			return {
				type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		startBlockValue(parent) {
			switch (this.type) {
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return this.flowScalar(this.type);
				case "block-scalar-header": return {
					type: "block-scalar",
					offset: this.offset,
					indent: this.indent,
					props: [this.sourceToken],
					source: ""
				};
				case "flow-map-start":
				case "flow-seq-start": return {
					type: "flow-collection",
					offset: this.offset,
					indent: this.indent,
					start: this.sourceToken,
					items: [],
					end: []
				};
				case "seq-item-ind": return {
					type: "block-seq",
					offset: this.offset,
					indent: this.indent,
					items: [{ start: [this.sourceToken] }]
				};
				case "explicit-key-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					start.push(this.sourceToken);
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							explicitKey: true
						}]
					};
				}
				case "map-value-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							key: null,
							sep: [this.sourceToken]
						}]
					};
				}
			}
			return null;
		}
		atIndentedComment(start, indent) {
			if (this.type !== "comment") return false;
			if (this.indent <= indent) return false;
			return start.every((st) => st.type === "newline" || st.type === "space");
		}
		*documentEnd(docEnd) {
			if (this.type !== "doc-mode") {
				if (docEnd.end) docEnd.end.push(this.sourceToken);
				else docEnd.end = [this.sourceToken];
				if (this.type === "newline") yield* this.pop();
			}
		}
		*lineEnd(token) {
			switch (this.type) {
				case "comma":
				case "doc-start":
				case "doc-end":
				case "flow-seq-end":
				case "flow-map-end":
				case "map-value-ind":
					yield* this.pop();
					yield* this.step();
					break;
				case "newline": this.onKeyLine = false;
				default:
					if (token.end) token.end.push(this.sourceToken);
					else token.end = [this.sourceToken];
					if (this.type === "newline") yield* this.pop();
			}
		}
	};
	exports.Parser = Parser;
}));
//#endregion
//#region ../node_modules/yaml/dist/public-api.js
var require_public_api = /* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var errors = require_errors();
	var log = require_log();
	var identity = require_identity();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	function parseOptions(options) {
		const prettyErrors = options.prettyErrors !== false;
		return {
			lineCounter: options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null,
			prettyErrors
		};
	}
	/**
	* Parse the input as a stream of YAML documents.
	*
	* Documents should be separated from each other by `...` or `---` marker lines.
	*
	* @returns If an empty `docs` array is returned, it will be of type
	*   EmptyStream and contain additional stream information. In
	*   TypeScript, you should use `'empty' in docs` as a type guard for it.
	*/
	function parseAllDocuments(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		const docs = Array.from(composer$1.compose(parser$1.parse(source)));
		if (prettyErrors && lineCounter) for (const doc of docs) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		if (docs.length > 0) return docs;
		return Object.assign([], { empty: true }, composer$1.streamInfo());
	}
	/** Parse an input string into a single YAML.Document */
	function parseDocument(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		let doc = null;
		for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) if (!doc) doc = _doc;
		else if (doc.options.logLevel !== "silent") {
			doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
			break;
		}
		if (prettyErrors && lineCounter) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		return doc;
	}
	function parse(src, reviver, options) {
		let _reviver = void 0;
		if (typeof reviver === "function") _reviver = reviver;
		else if (options === void 0 && reviver && typeof reviver === "object") options = reviver;
		const doc = parseDocument(src, options);
		if (!doc) return null;
		doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
		if (doc.errors.length > 0) if (doc.options.logLevel !== "silent") throw doc.errors[0];
		else doc.errors = [];
		return doc.toJS(Object.assign({ reviver: _reviver }, options));
	}
	function stringify(value, replacer, options) {
		let _replacer = null;
		if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
		else if (options === void 0 && replacer) options = replacer;
		if (typeof options === "string") options = options.length;
		if (typeof options === "number") {
			const indent = Math.round(options);
			options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
		}
		if (value === void 0) {
			const { keepUndefined } = options ?? replacer ?? {};
			if (!keepUndefined) return void 0;
		}
		if (identity.isDocument(value) && !_replacer) return value.toString(options);
		return new Document.Document(value, _replacer, options).toString(options);
	}
	exports.parse = parse;
	exports.parseAllDocuments = parseAllDocuments;
	exports.parseDocument = parseDocument;
	exports.stringify = stringify;
}));
//#endregion
//#region src/utils/yaml.ts
var import_dist = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var Schema = require_Schema();
	var errors = require_errors();
	var Alias = require_Alias();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	require_cst();
	var lexer = require_lexer();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	var publicApi = require_public_api();
	var visit = require_visit();
	exports.Composer = composer.Composer;
	exports.Document = Document.Document;
	exports.Schema = Schema.Schema;
	exports.YAMLError = errors.YAMLError;
	exports.YAMLParseError = errors.YAMLParseError;
	exports.YAMLWarning = errors.YAMLWarning;
	exports.Alias = Alias.Alias;
	exports.isAlias = identity.isAlias;
	exports.isCollection = identity.isCollection;
	exports.isDocument = identity.isDocument;
	exports.isMap = identity.isMap;
	exports.isNode = identity.isNode;
	exports.isPair = identity.isPair;
	exports.isScalar = identity.isScalar;
	exports.isSeq = identity.isSeq;
	exports.Pair = Pair.Pair;
	exports.Scalar = Scalar.Scalar;
	exports.YAMLMap = YAMLMap.YAMLMap;
	exports.YAMLSeq = YAMLSeq.YAMLSeq;
	exports.Lexer = lexer.Lexer;
	exports.LineCounter = lineCounter.LineCounter;
	exports.Parser = parser.Parser;
	exports.parse = publicApi.parse;
	exports.parseAllDocuments = publicApi.parseAllDocuments;
	exports.parseDocument = publicApi.parseDocument;
	exports.stringify = publicApi.stringify;
	exports.visit = visit.visit;
	exports.visitAsync = visit.visitAsync;
})))(), 1);
function parseYaml$1(text) {
	return import_dist.parse(text);
}
function toYaml(value) {
	return import_dist.stringify(value, { lineWidth: 0 });
}
//#endregion
//#region src/load/load-playbook.ts
/**
* Discovers built-in layer ids by scanning the plugin playbook directory.
*/
function discoverBuiltinLayers(builtinRoot) {
	const layers = /* @__PURE__ */ new Map();
	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.endsWith(".yaml")) continue;
			const rel = relative(builtinRoot, full).replace(/\\/g, "/");
			const parts = rel.split("/");
			let layerId = "builtin";
			if (rel === "core.yaml") layerId = "builtin/core";
			else if (parts.at(-1) === "core.yaml") layerId = `builtin/${parts.slice(0, -1).join("/")}`;
			else layerId = `builtin/${rel.replace(/\.yaml$/, "")}`;
			layers.set(layerId, full);
		}
	}
	walk(builtinRoot);
	return layers;
}
/**
* Expands local augment extends patterns against discovered built-in layers.
*/
function resolveExtendedLayers(extendsEntries, layers) {
	const selected = [];
	for (const entry of extendsEntries) {
		if (entry.startsWith("!")) {
			const target = entry.slice(1);
			const next = selected.filter((value) => value !== target);
			selected.length = 0;
			selected.push(...next);
			continue;
		}
		if (entry.endsWith("/*")) {
			const prefix = entry.slice(0, -1);
			for (const match of [...layers.keys()].filter((layerId) => layerId.startsWith(prefix)).sort()) if (!selected.includes(match)) selected.push(match);
			continue;
		}
		if (layers.has(entry) && !selected.includes(entry)) selected.push(entry);
	}
	return selected;
}
/**
* Loads directives for one built-in layer file.
*/
function loadDirectiveFile(filePath, layerId) {
	const parsed = parseYaml$1(readFileSync(filePath, "utf-8"));
	if (!Array.isArray(parsed)) throw new Error(`Directive file must contain a top-level array: ${filePath}`);
	return parsed.map((item, index) => normalizeDirective(assertRecord(item, `${filePath}[${index}]`), layerId, filePath, "builtin"));
}
/**
* Loads the optional local playbook and normalizes all local sections.
*/
function loadLocalPlaybook(filePath) {
	if (!filePath || !existsSync(filePath)) return null;
	const parsed = assertRecord(parseYaml$1(readFileSync(filePath, "utf-8")), filePath);
	if (parsed.version !== 1 && parsed.version !== "1.0") throw new Error(`UNSUPPORTED_SCHEMA_VERSION: ${filePath} must use local playbook schema 1. Re-run init; existing data was not modified.`);
	const meta = parsed.meta ?? {};
	return {
		version: "1.0",
		meta: {
			name: typeof meta.name === "string" ? meta.name : void 0,
			extends: Array.isArray(meta.extends) ? meta.extends.map(String) : []
		},
		overrides: arrayField(parsed.overrides, "overrides", filePath).map((item, index) => normalizeOverride(item, `${filePath}.overrides[${index}]`)),
		augments: arrayField(parsed.augments, "augments", filePath).map((item, index) => normalizeAugment(item, `${filePath}.augments[${index}]`)),
		suppresses: arrayField(parsed.suppresses, "suppresses", filePath).map((item, index) => normalizeSuppress(item, `${filePath}.suppresses[${index}]`)),
		additions: Array.isArray(parsed.additions) ? parsed.additions.map((item) => normalizeDirective(item, "local", filePath, "local-addition")) : []
	};
}
function normalizeDirective(input, layerId, filePath, kind) {
	rejectConditionalBranching(input, filePath);
	const id = nonEmptyString(input.id, "id", filePath);
	const type = enumValue(input.type, [
		"constraint",
		"preference",
		"convention",
		"architecture",
		"anti-pattern"
	], "type", filePath);
	const prescription = enumValue(input.prescription, ["must", "should"], "prescription", filePath);
	const weight = enumValue(input.weight ?? "normal", [
		"low",
		"normal",
		"high",
		"critical"
	], "weight", filePath);
	const description = nonEmptyString(input.description, "description", filePath);
	const rationale = nonEmptyString(input.rationale, "rationale", filePath);
	const examples = normalizeExamples(input.examples, filePath);
	return {
		id,
		type,
		layer: typeof input.layer === "string" ? input.layer : layerId,
		scope: normalizeScope$1(input.scope),
		prescription,
		weight,
		description,
		rationale,
		exceptions: Array.isArray(input.exceptions) ? input.exceptions.map(String) : [],
		examples,
		rccl_immune: Boolean(input.rccl_immune),
		traits: normalizeTraits$1(input.traits),
		source: {
			kind,
			layerId,
			filePath
		}
	};
}
function normalizeScope$1(input) {
	if (typeof input === "string" && input.trim()) return { path: input.trim() };
	if (input && typeof input === "object" && typeof input.path === "string") return { path: String(input.path) };
	throw new Error("Invalid playbook directive scope: expected a non-empty path string or { path }.");
}
function normalizeExamples(input, location) {
	if (!Array.isArray(input) || input.length === 0) throw new Error(`Invalid playbook directive at ${location}: examples must be a non-empty array.`);
	return input.map((example, index) => {
		const item = assertRecord(example, `${location}.examples[${index}]`);
		if (typeof item.note !== "string" || !item.note.trim()) throw new Error(`Invalid playbook directive at ${location}: every example requires a non-empty note.`);
		return {
			avoid: item.avoid && typeof item.avoid === "object" ? { code: String(item.avoid.code ?? "") } : void 0,
			good: item.good && typeof item.good === "object" ? { code: String(item.good.code ?? "") } : void 0,
			note: item.note.trim()
		};
	});
}
function assertUniqueDirectiveIds(directives) {
	const seen = /* @__PURE__ */ new Map();
	for (const directive of directives) {
		const prior = seen.get(directive.id);
		if (prior) throw new Error(`Duplicate directive id "${directive.id}" in ${prior} and ${directive.source.filePath}.`);
		seen.set(directive.id, directive.source.filePath);
	}
}
function validateLocalReferences(local, builtins) {
	if (!local) return;
	const byId = new Map(builtins.map((directive) => [directive.id, directive]));
	for (const override of local.overrides) {
		const target = byId.get(override.supersedes);
		if (!target) throw new Error(`Local override supersedes unknown directive "${override.supersedes}".`);
		if (override.scope && override.scope.path !== target.scope.path) throw new Error(`Local override scope "${override.scope.path}" is incompatible with ${override.supersedes} scope "${target.scope.path}".`);
	}
	for (const item of [...local.augments, ...local.suppresses]) if (!byId.has(item.id)) throw new Error(`Local playbook references unknown directive "${item.id}".`);
}
function normalizeOverride(value, location) {
	const item = assertRecord(value, location);
	if ("id" in item && !("supersedes" in item)) throw new Error(`Invalid local override at ${location}: use explicit supersedes instead of id.`);
	return {
		supersedes: nonEmptyString(item.supersedes, "supersedes", location),
		...item.scope !== void 0 ? { scope: normalizeScope$1(item.scope) } : {},
		...item.prescription !== void 0 ? { prescription: enumValue(item.prescription, ["must", "should"], "prescription", location) } : {},
		...item.weight !== void 0 ? { weight: enumValue(item.weight, [
			"low",
			"normal",
			"high",
			"critical"
		], "weight", location) } : {},
		...item.rationale !== void 0 ? { rationale: nonEmptyString(item.rationale, "rationale", location) } : {},
		...item.exceptions !== void 0 ? { exceptions: stringArray(item.exceptions, "exceptions", location) } : {}
	};
}
function normalizeAugment(value, location) {
	const item = assertRecord(value, location);
	return {
		id: nonEmptyString(item.id, "id", location),
		examples: normalizeExamples(item.examples, location)
	};
}
function normalizeSuppress(value, location) {
	const item = assertRecord(value, location);
	return {
		id: nonEmptyString(item.id, "id", location),
		reason: nonEmptyString(item.reason, "reason", location)
	};
}
function assertRecord(value, location) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected object at ${location}.`);
	return value;
}
function nonEmptyString(value, field, location) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field} at ${location}: expected a non-empty string.`);
	return value.trim();
}
function enumValue(value, allowed, field, location) {
	if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`Invalid ${field} at ${location}: expected one of ${allowed.join(", ")}.`);
	return value;
}
function stringArray(value, field, location) {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Invalid ${field} at ${location}: expected a string array.`);
	return value.map((item) => item.trim()).filter(Boolean);
}
function arrayField(value, field, location) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) throw new Error(`Invalid ${field} at ${location}: expected an array.`);
	return value;
}
function rejectConditionalBranching(input, location) {
	for (const key of [
		"if",
		"when",
		"condition",
		"conditions",
		"then",
		"else"
	]) if (key in input) throw new Error(`Invalid directive at ${location}: internal conditional branch "${key}" is not allowed.`);
}
function normalizeTraits$1(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return void 0;
	const value = input;
	const traits = {
		safety_critical: booleanTrait$1(value.safety_critical),
		broad_scope: booleanTrait$1(value.broad_scope),
		compatibility_sensitive: booleanTrait$1(value.compatibility_sensitive),
		migration_sensitive: booleanTrait$1(value.migration_sensitive)
	};
	return Object.values(traits).some((item) => item !== void 0) ? traits : void 0;
}
function booleanTrait$1(input) {
	return typeof input === "boolean" ? input : void 0;
}
//#endregion
//#region ../rccl/src/utils/yaml.ts
function parseYaml(text) {
	return import_dist.parse(text);
}
//#endregion
//#region ../rccl/src/validate-observation.ts
const RCCL_OBSERVATION_ID_PATTERN = /^obs-[a-z0-9-]+$/;
const RCCL_CATEGORIES = new Set([
	"style",
	"architecture",
	"pattern",
	"constraint",
	"legacy",
	"anti-pattern",
	"migration"
]);
const RCCL_ADHERENCE_QUALITIES = new Set([
	"good",
	"inconsistent",
	"poor"
]);
const RCCL_SCOPE_BASES = new Set([
	"single-file",
	"directory-cluster",
	"module-cluster",
	"cross-root"
]);
function validateEvidenceSnippet(snippet, prefix, index) {
	if (typeof snippet !== "string") return [];
	const normalized = snippet.replace(/\r\n/g, "\n").trim();
	if (!normalized) return [`${prefix}.evidence[${index}]: snippet must not be empty`];
	const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
	const tokenMatches = normalized.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
	const identifierCount = tokenMatches.filter((token) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)).length;
	const punctuationCount = tokenMatches.length - identifierCount;
	const hasDistinctiveStructure = /[{}();=>]|\b(import|export|return|const|let|var|function|class|interface|type|if|for|while|switch|case|await|async)\b/.test(normalized);
	if (lines.length >= 2 || hasDistinctiveStructure) return [];
	if (tokenMatches.length < 4) return [`${prefix}.evidence[${index}]: snippet is too short to verify reliably; include at least a distinctive statement or 2+ lines of code`];
	if (identifierCount <= 2 && punctuationCount === 0) return [`${prefix}.evidence[${index}]: snippet looks like an identifier or label, not a verifiable code fragment`];
	return [];
}
function validateTraitsRecord(value, prefix) {
	if (value == null) return [];
	const errors = [];
	if (!isRecord(value)) return [`${prefix}: must be an object when present`];
	const allowed = new Set([
		"legacy",
		"migration_boundary",
		"anti_pattern",
		"compatibility_boundary"
	]);
	for (const [key, item] of Object.entries(value)) {
		if (item === void 0) continue;
		if (!allowed.has(key)) errors.push(`${prefix}.${key}: unsupported trait`);
		else if (typeof item !== "boolean") errors.push(`${prefix}.${key}: must be boolean`);
	}
	return errors;
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//#endregion
//#region ../rccl/src/io/parse-rccl.ts
const RCCL_VERSION = "1.0";
function isRcclVersion(value) {
	return value === RCCL_VERSION || value === 1;
}
const REQUIRED_VERIFICATION_FIELDS = [
	"evidence_status",
	"evidence_verified_count",
	"evidence_confidence",
	"induction_status",
	"induction_confidence",
	"checked_at",
	"disposition"
];
function parseRccl(yamlText, options = {}) {
	const allowVerifiedFields = options.allowVerifiedFields === true;
	const parsed = parseRawRcclDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateFinalRcclDocument(parsed.doc, allowVerifiedFields);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeDocument(parsed.doc)
	};
}
function parseRawRcclDocument(yamlText) {
	let cleaned = yamlText.trim();
	if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:yaml|yml)?\s*\n?/, "").replace(/\n?```\s*$/, "");
	let doc;
	try {
		doc = parseYaml(cleaned);
	} catch (err) {
		return {
			valid: false,
			errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`]
		};
	}
	if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {
		valid: false,
		errors: ["Document must be a YAML object"]
	};
	return {
		valid: true,
		doc
	};
}
function validateFinalRcclDocument(doc, allowVerifiedFields) {
	const errors = validateDocumentEnvelope(doc);
	if (errors.length > 0) return errors;
	const observations = doc.observations;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < observations.length; i += 1) {
		const obs = observations[i];
		const rawId = String(obs.id ?? "");
		if (rawId) {
			if (ids.has(rawId)) errors.push(`Duplicate observation id: "${rawId}"`);
			ids.add(rawId);
		}
		errors.push(...validateFinalObservation(obs, i, allowVerifiedFields));
	}
	return errors;
}
function validateDocumentEnvelope(doc) {
	const errors = [];
	if (!isRcclVersion(doc.version)) errors.push(`'version' must be "${RCCL_VERSION}", got "${doc.version}"`);
	if (!Array.isArray(doc.observations) || doc.observations.length === 0) errors.push("'observations' must be a non-empty array");
	return errors;
}
function validateFinalObservation(obs, index, allowVerifiedFields) {
	const errors = validateObservationCore(obs, index, "id", "scope");
	const prefix = `observations[${index}]`;
	if ("provisional_id" in obs) errors.push(`${prefix}: final RCCL observations must use 'id', not 'provisional_id'`);
	if ("scope_hint" in obs) errors.push(`${prefix}: final RCCL observations must use 'scope', not 'scope_hint'`);
	if ("source_slice_ids" in obs) errors.push(`${prefix}: final RCCL observations must store source slices in 'support.source_slices'`);
	if ("support_hint" in obs) errors.push(`${prefix}: final RCCL observations must use 'support', not 'support_hint'`);
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
	const support = obs.support;
	if (!support || typeof support !== "object" || Array.isArray(support)) errors.push(`${prefix}: missing or invalid 'support'`);
	else errors.push(...validateSupport(support, `${prefix}.support`));
	const verification = obs.verification;
	if (!verification || typeof verification !== "object" || Array.isArray(verification)) errors.push(`${prefix}: missing or invalid 'verification'`);
	else errors.push(...validateVerification(verification, prefix, allowVerifiedFields));
	errors.push(...validateLifecycle(obs.lifecycle, prefix));
	return errors;
}
function validateObservationCore(obs, index, idField, scopeField) {
	const errors = [];
	const prefix = `observations[${index}]`;
	const id = obs[idField];
	const scope = obs[scopeField];
	if (!id || typeof id !== "string") errors.push(`${prefix}: missing or invalid '${idField}'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(String(id))) errors.push(`${prefix}: '${idField}' "${id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!RCCL_CATEGORIES.has(String(obs.category))) errors.push(`${prefix}: 'category' is invalid`);
	if (!obs.semantic_key || typeof obs.semantic_key !== "string") errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!scope || typeof scope !== "string") errors.push(`${prefix}: missing or invalid '${scopeField}'`);
	if (!obs.pattern || typeof obs.pattern !== "string") errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (typeof obs.confidence !== "number" || Number.isNaN(obs.confidence) || obs.confidence < 0 || obs.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${obs.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(String(obs.adherence_quality))) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	if (!Array.isArray(obs.evidence) || obs.evidence.length === 0) errors.push(`${prefix}: 'evidence' must be a non-empty array`);
	else for (let i = 0; i < obs.evidence.length; i += 1) {
		const evidence = obs.evidence[i];
		if (!evidence.file || typeof evidence.file !== "string") errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!Array.isArray(evidence.line_range) || evidence.line_range.length !== 2) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!evidence.snippet || typeof evidence.snippet !== "string") errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function validateSupport(support, prefix) {
	const errors = [];
	if (!Array.isArray(support.source_slices)) errors.push(`${prefix}.source_slices: must be an array`);
	if (typeof support.file_count !== "number") errors.push(`${prefix}.file_count: must be a number`);
	if (typeof support.cluster_count !== "number") errors.push(`${prefix}.cluster_count: must be a number`);
	if (!RCCL_SCOPE_BASES.has(String(support.scope_basis))) errors.push(`${prefix}.scope_basis: invalid value`);
	return errors;
}
function validateVerification(verification, prefix, allowVerifiedFields) {
	const errors = [];
	for (const field of REQUIRED_VERIFICATION_FIELDS) if (!(field in verification)) errors.push(`${prefix}.verification.${field}: missing required field`);
	if (!allowVerifiedFields) {
		for (const field of REQUIRED_VERIFICATION_FIELDS) if (verification[field] !== null && verification[field] !== void 0) errors.push(`${prefix}.verification.${field}: must be null (runtime fills this), got "${verification[field]}"`);
	}
	return errors;
}
function validateLifecycle(lifecycle, prefix) {
	if (lifecycle == null) return [];
	const errors = [];
	if (lifecycle.status != null && lifecycle.status !== "active" && lifecycle.status !== "stale" && lifecycle.status !== "superseded") errors.push(`${prefix}.lifecycle.status: invalid value`);
	if (lifecycle.content_fingerprint != null && typeof lifecycle.content_fingerprint !== "string") errors.push(`${prefix}.lifecycle.content_fingerprint: must be a string`);
	if (lifecycle.supersedes != null) {
		if (!Array.isArray(lifecycle.supersedes)) errors.push(`${prefix}.lifecycle.supersedes: must be an array`);
		else for (const id of lifecycle.supersedes) if (typeof id !== "string" || !RCCL_OBSERVATION_ID_PATTERN.test(id)) errors.push(`${prefix}.lifecycle.supersedes: contains invalid observation id`);
	}
	if (lifecycle.superseded_by != null && (typeof lifecycle.superseded_by !== "string" || !RCCL_OBSERVATION_ID_PATTERN.test(lifecycle.superseded_by))) errors.push(`${prefix}.lifecycle.superseded_by: must be a valid observation id`);
	return errors;
}
function normalizeDocument(input) {
	return {
		version: RCCL_VERSION,
		generated_at: typeof input.generated_at === "string" ? input.generated_at : null,
		git_ref: typeof input.git_ref === "string" ? input.git_ref : null,
		observations: Array.isArray(input.observations) ? input.observations.map(normalizeObservation) : []
	};
}
function normalizeObservation(input) {
	const item = input;
	return {
		id: String(item.id),
		semantic_key: normalizeSemanticKey(String(item.semantic_key)),
		category: item.category,
		scope: normalizeScope(String(item.scope)),
		pattern: String(item.pattern),
		confidence: Number(item.confidence),
		adherence_quality: item.adherence_quality,
		evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
		support: normalizeSupport(item.support),
		verification: normalizeVerification(item.verification),
		lifecycle: normalizeLifecycle(item.lifecycle),
		traits: normalizeTraits(item.traits)
	};
}
function normalizeEvidence(input) {
	const value = input;
	const lineRange = value.line_range;
	return {
		file: normalizePath(String(value.file)),
		line_range: [Number(lineRange[0]), Number(lineRange[1])],
		snippet: String(value.snippet ?? "")
	};
}
function normalizeSupport(input) {
	return {
		source_slices: Array.isArray(input.source_slices) ? Array.from(new Set(input.source_slices.map(String))).sort() : [],
		file_count: Number(input.file_count),
		cluster_count: Number(input.cluster_count),
		scope_basis: normalizeScopeBasis(String(input.scope_basis))
	};
}
function normalizeVerification(input) {
	return {
		evidence_status: input.evidence_status ?? null,
		evidence_verified_count: input.evidence_verified_count == null ? null : Number(input.evidence_verified_count),
		evidence_confidence: input.evidence_confidence == null ? null : Number(input.evidence_confidence),
		induction_status: input.induction_status ?? null,
		induction_confidence: input.induction_confidence == null ? null : Number(input.induction_confidence),
		checked_at: typeof input.checked_at === "string" ? input.checked_at : null,
		disposition: input.disposition ?? null
	};
}
function normalizeLifecycle(input) {
	if (!input) return void 0;
	const status = input.status === "stale" || input.status === "superseded" ? input.status : "active";
	return {
		first_seen_git_ref: typeof input.first_seen_git_ref === "string" ? input.first_seen_git_ref : null,
		last_seen_git_ref: typeof input.last_seen_git_ref === "string" ? input.last_seen_git_ref : null,
		last_verified_at: typeof input.last_verified_at === "string" ? input.last_verified_at : null,
		content_fingerprint: typeof input.content_fingerprint === "string" ? input.content_fingerprint : "",
		status,
		supersedes: Array.isArray(input.supersedes) ? input.supersedes.map(String).sort() : void 0,
		superseded_by: typeof input.superseded_by === "string" ? input.superseded_by : void 0,
		stale_since_git_ref: typeof input.stale_since_git_ref === "string" ? input.stale_since_git_ref : null,
		superseded_at_git_ref: typeof input.superseded_at_git_ref === "string" ? input.superseded_at_git_ref : null
	};
}
function normalizeTraits(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return void 0;
	const value = input;
	const traits = {
		legacy: booleanTrait(value.legacy),
		migration_boundary: booleanTrait(value.migration_boundary),
		anti_pattern: booleanTrait(value.anti_pattern),
		compatibility_boundary: booleanTrait(value.compatibility_boundary)
	};
	return Object.values(traits).some((item) => item !== void 0) ? traits : void 0;
}
function booleanTrait(input) {
	return typeof input === "boolean" ? input : void 0;
}
function normalizeScopeBasis(value) {
	if (value === "single-file" || value === "directory-cluster" || value === "module-cluster" || value === "cross-root") return value;
	return "module-cluster";
}
function normalizeScope(scope) {
	const trimmed = scope.trim();
	return trimmed.length > 0 ? trimmed : "**";
}
function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizeSemanticKey(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
//#endregion
//#region ../rccl/src/policies.ts
const DEFAULT_VERIFICATION_POLICY = {
	snippet_similarity_threshold: .75,
	min_evidence_for_directory_scope: 2,
	min_evidence_for_cross_root_scope: 3,
	anti_pattern_min_evidence: 2,
	migration_min_evidence: 2
};
//#endregion
//#region ../rccl/src/verify/verify-evidence.ts
function verifyObservationEvidence(observation, projectRoot, checkedAt, policy = DEFAULT_VERIFICATION_POLICY) {
	if (observation.evidence.length === 0) return applyEvidenceVerification(observation, "unverifiable", 0, 0, checkedAt, "demote-to-ambient");
	const results = observation.evidence.map((item) => verifyEvidence(item, projectRoot, policy));
	const verifiedCount = results.filter((result) => result.status === "match").length;
	const ratio = verifiedCount / results.length;
	if (verifiedCount === results.length) return applyEvidenceVerification(observation, "verified", verifiedCount, observation.confidence, checkedAt, "keep");
	if (verifiedCount > 0) {
		const confidence = Math.max(observation.confidence * ratio, .3);
		return applyEvidenceVerification(observation, "partial", verifiedCount, confidence, checkedAt, confidence < .7 ? "keep-with-reduced-confidence" : "keep");
	}
	return applyEvidenceVerification(observation, "failed", 0, 0, checkedAt, "demote-to-ambient");
}
function applyEvidenceVerification(observation, status, verifiedCount, evidenceConfidence, checkedAt, disposition) {
	return {
		...observation,
		verification: {
			...observation.verification,
			evidence_status: status,
			evidence_verified_count: verifiedCount,
			evidence_confidence: Number(evidenceConfidence.toFixed(2)),
			checked_at: checkedAt,
			disposition
		}
	};
}
function verifyEvidence(evidence, projectRoot, policy = DEFAULT_VERIFICATION_POLICY) {
	if (!safeRelativeEvidencePath(evidence.file)) return { status: "path-outside-project" };
	const root = realpathSync(resolve(projectRoot));
	const fullPath = resolve(root, evidence.file);
	if (!existsSync(fullPath)) return { status: "file-not-found" };
	let realFile;
	try {
		realFile = realpathSync(fullPath);
	} catch {
		return { status: "file-not-found" };
	}
	const rel = relative(root, realFile);
	if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) return { status: "path-outside-project" };
	const lines = readFileSync(realFile, "utf-8").replace(/\r\n/g, "\n").split("\n");
	const [start, end] = evidence.line_range;
	if (start < 1 || end < start || end > lines.length) return { status: "range-out-of-bounds" };
	return tokenOverlapSimilarity(lines.slice(start - 1, end).join("\n"), evidence.snippet) >= policy.snippet_similarity_threshold ? { status: "match" } : { status: "mismatch" };
}
function safeRelativeEvidencePath(file) {
	if (!file || isAbsolute(file) || win32.isAbsolute(file)) return false;
	const normalized = file.replace(/\\/g, "/");
	return !normalized.split("/").some((segment) => segment === "..") && !normalized.startsWith("/");
}
function tokenOverlapSimilarity(a, b) {
	const aTokens = tokenize(a);
	const bTokens = tokenize(b);
	if (aTokens.length === 0 || bTokens.length === 0) return 0;
	const counts = /* @__PURE__ */ new Map();
	for (const token of aTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	let overlap = 0;
	for (const token of bTokens) {
		const count = counts.get(token) ?? 0;
		if (count > 0) {
			overlap += 1;
			counts.set(token, count - 1);
		}
	}
	return overlap / Math.max(aTokens.length, bTokens.length);
}
function tokenize(text) {
	return text.replace(/\r\n/g, "\n").replace(/['"`]/g, "\"").replace(/\s+/g, " ").trim().match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
}
//#endregion
//#region ../rccl/src/verify/verify-induction.ts
function verifyObservationInduction(observation, policy = DEFAULT_VERIFICATION_POLICY) {
	const evidenceCount = observation.verification.evidence_verified_count ?? 0;
	const minRequired = minimumEvidence(observation, policy);
	const distinctFiles = new Set(observation.evidence.map((item) => item.file.replace(/\\/g, "/"))).size;
	const distinctRoots = new Set(observation.evidence.map((item) => item.file.replace(/\\/g, "/").split("/")[0])).size;
	let induction_status = "well-supported";
	let induction_confidence = observation.verification.evidence_confidence ?? 0;
	if (observation.support.scope_basis === "cross-root" && (evidenceCount < 3 || distinctFiles < 3 || distinctRoots < 2)) {
		induction_status = "overgeneralized";
		induction_confidence = Math.min(induction_confidence, .35);
	} else if ((observation.support.scope_basis === "directory-cluster" || observation.support.scope_basis === "module-cluster") && (evidenceCount < 2 || distinctFiles < 2)) {
		induction_status = "overgeneralized";
		induction_confidence = Math.min(induction_confidence, .35);
	} else if (evidenceCount < minRequired) {
		induction_status = "narrowly-supported";
		induction_confidence = Math.min(induction_confidence, .55);
	}
	let disposition = observation.verification.disposition ?? "keep";
	if (induction_status === "overgeneralized") disposition = "demote-to-ambient";
	else if (induction_status === "narrowly-supported" && disposition === "keep") disposition = "keep-with-reduced-confidence";
	return {
		...observation,
		verification: {
			...observation.verification,
			induction_status,
			induction_confidence: Number(induction_confidence.toFixed(2)),
			disposition
		}
	};
}
function minimumEvidence(observation, policy) {
	if (observation.category === "anti-pattern") return policy.anti_pattern_min_evidence;
	if (observation.category === "migration") return policy.migration_min_evidence;
	return 1;
}
//#endregion
//#region src/load/load-rccl.ts
/**
* Loads RCCL from disk via the RCCL package's canonical parser/normalizer.
*/
async function loadRccl(filePath) {
	if (!filePath || !existsSync(filePath)) return null;
	const parsed = parseRccl(readFileSync(filePath, "utf-8"), { allowVerifiedFields: true });
	if (!parsed.valid || !parsed.data) {
		if (parsed.errors?.some((error) => error.includes("'version' must be"))) throw new Error(`UNSUPPORTED_SCHEMA_VERSION: RCCL must use schema 1. Re-run calibrate-repo-context; ${filePath} was not modified.`);
		throw new Error(`Failed to parse RCCL document: ${parsed.errors?.join("; ") || "unknown parse error"}`);
	}
	return parsed.data;
}
//#endregion
//#region src/verify/verify-rccl.ts
/**
* Verifies RCCL observations according to the Runtime task-time trust policy.
*/
async function verifyRcclDocumentWithSummary(rccl, options) {
	const checkedAt = (options.now ?? /* @__PURE__ */ new Date()).toISOString();
	const policy = options.policy ?? "task-relevant";
	const targets = taskTargets$1(options.resolvedTask);
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
		const verified = verifyObservationInduction(verifyObservationEvidence(observation, options.projectRoot, checkedAt));
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
function taskTargets$1(resolvedTask) {
	if (!resolvedTask) return [];
	return unique([
		resolvedTask.task.targetFile,
		...resolvedTask.task.changedFiles ?? [],
		resolvedTask.task_intent.target_file,
		...resolvedTask.task_intent.changed_files
	].filter((value) => Boolean(value)).map(normalizePath$1));
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
//#endregion
//#region src/load/compile-sources.ts
async function loadCompileSources(input) {
	const builtinLayers = discoverBuiltinLayers(input.builtinRoot);
	const local = loadLocalPlaybook(input.localAugmentPath);
	const configuredLayerIds = local?.meta.extends.length ? resolveExtendedLayers(local.meta.extends, builtinLayers) : ["builtin/core"];
	const inferredLayerIds = inferTaskLayers(input.resolvedTask, builtinLayers);
	const selectedLayerIds = [...new Set([...configuredLayerIds, ...inferredLayerIds])];
	const builtinDirectives = selectedLayerIds.flatMap((layerId) => {
		const filePath = builtinLayers.get(layerId);
		return filePath ? loadDirectiveFile(filePath, layerId) : [];
	});
	const allBuiltinDirectives = [...builtinLayers.entries()].flatMap(([layerId, filePath]) => loadDirectiveFile(filePath, layerId));
	assertUniqueDirectiveIds([...allBuiltinDirectives, ...local?.additions ?? []]);
	validateLocalReferences(local, allBuiltinDirectives);
	return verifyCompileSourcesRccl(input, {
		builtinLayers,
		local,
		selectedLayerIds,
		builtinDirectives,
		allDirectives: [...builtinDirectives, ...local?.additions ?? []],
		rccl: await loadRccl(input.rcclPath)
	});
}
function inferTaskLayers(task, layers) {
	if (!task) return [];
	const result = [];
	const changeType = task.task_intent.change_type;
	if (changeType !== "unknown") {
		const taskLayer = `builtin/task-types/${changeType}`;
		if (layers.has(taskLayer)) result.push(taskLayer);
	}
	for (const tech of task.task_intent.tech_stack) for (const prefix of ["builtin/languages/", "builtin/frameworks/"]) {
		const layer = `${prefix}${tech}`;
		if (layers.has(layer)) result.push(layer);
	}
	return result.sort();
}
async function loadOrVerifyCompileSources(input, preloadedSources) {
	return preloadedSources ? verifyCompileSourcesRccl(input, preloadedSources) : loadCompileSources(input);
}
async function verifyCompileSourcesRccl(input, sources) {
	if (!sources.rccl) return {
		...sources,
		rcclVerificationSummary: void 0
	};
	const verifiedRccl = await verifyRcclDocumentWithSummary(sources.rccl, {
		projectRoot: input.projectRoot,
		resolvedTask: input.resolvedTask,
		policy: input.verificationPolicy ?? "task-relevant"
	});
	return {
		...sources,
		rccl: verifiedRccl.document,
		rcclVerificationSummary: verifiedRccl.summary
	};
}
//#endregion
//#region src/ir/types.ts
const GOVERNANCE_IR_VERSION = "governance-ir/v1";
//#endregion
//#region src/ir/relations/policy.ts
const SEMANTIC_RELATION_POLICY = {
	hostSemantic: {
		minConfidence: .72,
		maxCandidatesPerDirective: 5
	},
	feedback: {
		frequentlyIgnoredFollowRate: .5,
		frequentlyIgnoredMinIgnored: 2,
		recurringTensionSeenCount: 2,
		noisyObservationRelationCount: 3
	}
};
function semanticRelationPolicyTraceRecord() {
	return {
		host_semantic: {
			min_confidence: SEMANTIC_RELATION_POLICY.hostSemantic.minConfidence,
			max_candidates_per_directive: SEMANTIC_RELATION_POLICY.hostSemantic.maxCandidatesPerDirective
		},
		feedback: {
			frequently_ignored_follow_rate: SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredFollowRate,
			frequently_ignored_min_ignored: SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredMinIgnored,
			recurring_tension_seen_count: SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount,
			noisy_observation_relation_count: SEMANTIC_RELATION_POLICY.feedback.noisyObservationRelationCount
		}
	};
}
//#endregion
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
		usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind adherence-evidence, the issued requestId/contextFingerprint as request_id/context_fingerprint, and verdicts under payload; then pass it to complete with --adherence-file ${input.artifactPath}.`
	};
	return {
		evidencePrompt: prompt,
		evidenceSchema: JSON.stringify(ADHERENCE_EVIDENCE_SCHEMA, null, 2),
		evidenceArtifact: artifact,
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "adherence-evidence",
			...artifactIdentity("adherence-evidence", {
				directiveIds: input.directives.map((directive) => directive.id),
				schemaId: "runtime.adherence-evidence"
			}),
			schemaId: "runtime.adherence-evidence",
			schemaVersion: "1.0",
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
				directiveId: isRecord$1(item) && typeof item.directive_id === "string" ? item.directive_id : void 0
			});
			return;
		}
		if (!allowedIds.has(item.directive_id)) {
			entries.push(rejected$1(path, "invalid-id", `Directive id "${item.directive_id}" is not allowed.`, item));
			return;
		}
		if (seen.has(item.directive_id)) {
			entries.push(rejected$1(path, "duplicate-id", `Directive id "${item.directive_id}" already has a verdict.`, item));
			return;
		}
		seen.add(item.directive_id);
		if (item.confidence < MINIMUM_ADHERENCE_CONFIDENCE) {
			entries.push(rejected$1(path, "low-confidence", `Confidence ${item.confidence} is below ${MINIMUM_ADHERENCE_CONFIDENCE}.`, item));
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
	return isRecord$1(value) && Array.isArray(value.verdicts);
}
function isVerdictEntry(value) {
	if (!isRecord$1(value)) return false;
	return typeof value.directive_id === "string" && typeof value.verdict === "string" && VERDICTS.has(value.verdict) && validConfidence(value.confidence) && Array.isArray(value.evidence_refs) && typeof value.reason === "string";
}
function rejected$1(path, reason, message, item) {
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
//#region src/feedback.ts
function evaluateGuidance(input) {
	const release = acquireLock(`${input.lockfilePath}.lock`);
	try {
		const trackedDirectiveIds = getTrackedDirectiveIds(input);
		const validation = validatePublicAdherenceArtifact(input, trackedDirectiveIds);
		const lockfile = evaluateGuidanceUnlocked({
			...input,
			adherencePayload: validation.verdicts,
			followedDirectiveIds: void 0,
			ignoredDirectiveIds: void 0,
			ignoredDirectiveReasons: void 0,
			signalConfidence: void 0,
			hostFulfillment: void 0
		});
		return {
			status: validation.diagnostics.summary.rejected > 0 ? "needs-attention" : "updated",
			lockfile,
			contractDiagnostics: validation.diagnostics,
			verdictCounts: summarizeCurrentVerdicts(validation.verdicts, trackedDirectiveIds)
		};
	} finally {
		release();
	}
}
function summarizeCurrentVerdicts(verdicts, trackedDirectiveIds) {
	const counts = {
		followed: 0,
		partial: 0,
		ignored: 0,
		unverified: 0
	};
	const covered = /* @__PURE__ */ new Set();
	for (const verdict of verdicts) {
		if (covered.has(verdict.directive_id)) continue;
		covered.add(verdict.directive_id);
		counts[verdict.verdict] += 1;
	}
	counts.unverified += trackedDirectiveIds.filter((id) => !covered.has(id)).length;
	return counts;
}
function evaluateGuidanceUnlocked(input) {
	const existing = loadLockfile$1(input.lockfilePath);
	const trackedDirectiveIds = getTrackedDirectiveIds(input);
	const adherenceResolved = resolveFromAdherencePayload(input, trackedDirectiveIds);
	const followed = adherenceResolved?.followed ?? /* @__PURE__ */ new Set();
	const ignored = adherenceResolved?.ignored ?? /* @__PURE__ */ new Set();
	const partial = adherenceResolved?.partial ?? /* @__PURE__ */ new Set();
	const unverified = adherenceResolved?.unverified ?? new Set(trackedDirectiveIds);
	const ignoredReasons = adherenceResolved?.ignoredReasons;
	const taskType = input.ego.taskIntent.change_type;
	const taskProfile = taskProfileKey(input);
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const modeCounts = summarizeExecutionModes(input);
	const tensionCount = input.packet.governance.semantic_merge.context_tensions.length;
	const observedRccl = getObservedRccl(input);
	existing.governance_summary.total_tasks += 1;
	existing.governance_summary.by_task_type[taskType] = (existing.governance_summary.by_task_type[taskType] ?? 0) + 1;
	existing.governance_summary.by_task_profile[taskProfile] = (existing.governance_summary.by_task_profile[taskProfile] ?? 0) + 1;
	existing.governance_summary.last_execution_modes = modeCounts;
	existing.governance_summary.last_tension_count = tensionCount;
	existing.governance_summary.last_observation_count = observedRccl.size;
	existing.governance_summary.last_host_fulfillment = summarizeHostFulfillmentFeedback(input);
	existing.governance_summary.last_updated_at = now;
	updateObservationFeedback(existing, observedRccl, input, now);
	updateTensionFeedback(existing, input, now);
	for (const directiveId of trackedDirectiveIds) {
		const entry = existing.directives[directiveId] ?? createEntry();
		const counts = entry.quality_signal.by_task_type[taskType] ?? emptySignalCounts();
		const profileCounts = entry.quality_signal.by_task_profile[taskProfile] ?? emptySignalCounts();
		if (ignored.has(directiveId)) {
			entry.quality_signal.overall.ignored += 1;
			counts.ignored += 1;
			profileCounts.ignored += 1;
			const ignoredReason = validIgnoredReason(ignoredReasons?.[directiveId]) ? ignoredReasons[directiveId] : void 0;
			if (ignoredReason) {
				entry.quality_signal.ignored_reasons[ignoredReason] = (entry.quality_signal.ignored_reasons[ignoredReason] ?? 0) + 1;
				entry.quality_signal.last_ignored_reason = ignoredReason;
			}
		} else if (partial.has(directiveId)) {
			entry.quality_signal.overall.partial += 1;
			counts.partial += 1;
			profileCounts.partial += 1;
		} else if (followed.has(directiveId)) {
			entry.quality_signal.overall.followed += 1;
			counts.followed += 1;
			profileCounts.followed += 1;
		} else if (unverified.has(directiveId)) {
			entry.quality_signal.overall.unverified += 1;
			counts.unverified += 1;
			profileCounts.unverified += 1;
		}
		entry.quality_signal.by_task_type[taskType] = counts;
		entry.quality_signal.by_task_profile[taskProfile] = profileCounts;
		const coveredVerdict = ignored.has(directiveId) ? "ignored" : partial.has(directiveId) ? "partial" : followed.has(directiveId) ? "followed" : null;
		if (coveredVerdict) entry.quality_signal.overall.recent_verdicts = [...entry.quality_signal.overall.recent_verdicts, coveredVerdict].slice(-20);
		entry.quality_signal.overall.follow_rate = computeFollowRate(entry);
		entry.quality_signal.overall.coverage_rate = computeCoverageRate(entry);
		entry.quality_signal.overall.trend = computeTrend(entry);
		entry.quality_signal.signal_confidence = adherenceResolved ? "explicit" : resolveSignalConfidence(input, ignored.has(directiveId));
		entry.quality_signal.evidence_confidence = adherenceResolved?.evidenceConfidence.get(directiveId);
		entry.quality_signal.last_evaluation_source = adherenceResolved ? "adherence-evidence" : void 0;
		entry.quality_signal.last_seen = today;
		entry.governance = { outcomes: {
			total_tasks: (entry.governance?.outcomes.total_tasks ?? 0) + 1,
			with_tensions: (entry.governance?.outcomes.with_tensions ?? 0) + (tensionCount > 0 ? 1 : 0),
			last_execution_modes: modeCounts,
			last_tension_count: tensionCount,
			last_updated_at: now
		} };
		existing.directives[directiveId] = entry;
	}
	atomicWrite(input.lockfilePath, toYaml(existing));
	return existing;
}
function validatePublicAdherenceArtifact(input, trackedDirectiveIds) {
	const artifact = input.artifacts?.adherenceEvidence;
	if (!artifact) return {
		verdicts: [],
		diagnostics: buildContractPayloadDiagnostics("adherence-evidence", [{
			status: "unused",
			reason: "empty-payload",
			path: "artifact",
			message: "No adherence artifact was provided; tracked directives are recorded as unverified."
		}])
	};
	const request = input.packet.post_compile_contract_requests.find((item) => item.kind === "adherence-evidence");
	if (!request) return {
		verdicts: [],
		diagnostics: buildContractPayloadDiagnostics("adherence-evidence", [{
			status: "rejected",
			reason: "malformed-payload",
			path: "packet.post_compile_contract_requests",
			message: "The compiled packet does not contain the Runtime-issued adherence-evidence contract."
		}], {
			id: "missing-adherence-contract",
			path: artifact.path
		})
	};
	const unwrapped = unwrapHostArtifactEnvelope(artifact.raw, request.contract);
	if (unwrapped.diagnostic) return {
		verdicts: [],
		diagnostics: buildContractPayloadDiagnostics("adherence-evidence", [unwrapped.diagnostic], {
			id: request.contract.requestId,
			path: artifact.path
		})
	};
	const issuedDirectiveIds = request.contract.allowedIds?.directiveIds ?? [];
	const trackedSet = new Set(trackedDirectiveIds);
	return validateAdherenceEvidencePayload(unwrapped.payload, issuedDirectiveIds.filter((id) => trackedSet.has(id)), input.evidenceContext);
}
function loadLockfile$1(filePath) {
	if (!existsSync(filePath)) return createDocument();
	const parsed = parseYaml$1(readFileSync(filePath, "utf-8"));
	if (isRecord$1(parsed) && "version" in parsed && parsed.version !== "1.0") throw new Error(`UNSUPPORTED_SCHEMA_VERSION: lockfile ${filePath} must use 1.0; found ${String(parsed.version)}. Re-run init. Existing data was not modified.`);
	if (!isLockfileDocument(parsed)) throw new Error(`INVALID_LOCKFILE: ${filePath} is malformed and was not modified.`);
	return {
		version: "1.0",
		directives: normalizeDirectiveEntries(parsed.directives),
		observations: normalizeObservationEntries(parsed.observations),
		tensions: normalizeTensionEntries(parsed.tensions),
		governance_summary: {
			...parsed.governance_summary,
			by_task_profile: parsed.governance_summary.by_task_profile ?? {}
		}
	};
}
function isLockfileDocument(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value;
	return isLockfileVersion(candidate.version) && isRecord$1(candidate.directives) && isRecord$1(candidate.observations) && isRecord$1(candidate.tensions) && Boolean(candidate.governance_summary) && typeof candidate.governance_summary === "object";
}
function isLockfileVersion(value) {
	return value === "1.0" || value === 1;
}
function normalizeObservationEntries(entries) {
	return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
		...createObservationEntry(),
		...entry,
		last_content_fingerprint: entry.last_content_fingerprint ?? null
	}]));
}
function normalizeDirectiveEntries(entries) {
	return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
		const normalized = createEntry();
		return [id, {
			...normalized,
			...entry,
			quality_signal: {
				...normalized.quality_signal,
				...entry.quality_signal,
				overall: {
					...normalized.quality_signal.overall,
					...entry.quality_signal?.overall,
					partial: (entry.quality_signal?.overall)?.partial ?? 0,
					unverified: (entry.quality_signal?.overall)?.unverified ?? 0,
					coverage_rate: (entry.quality_signal?.overall)?.coverage_rate ?? 0,
					recent_verdicts: normalizeRecentVerdicts((entry.quality_signal?.overall)?.recent_verdicts)
				},
				by_task_type: normalizeSignalCountMap(entry.quality_signal?.by_task_type),
				by_task_profile: normalizeSignalCountMap(entry.quality_signal?.by_task_profile),
				ignored_reasons: normalizeIgnoredReasons(entry.quality_signal?.ignored_reasons),
				...validIgnoredReason(entry.quality_signal?.last_ignored_reason) ? { last_ignored_reason: entry.quality_signal.last_ignored_reason } : {},
				signal_confidence: validSignalConfidence$1(entry.quality_signal?.signal_confidence) ? entry.quality_signal.signal_confidence : "implicit",
				evidence_confidence: validConfidence(entry.quality_signal?.evidence_confidence) ? entry.quality_signal.evidence_confidence : void 0,
				last_evaluation_source: validEvaluationSource(entry.quality_signal?.last_evaluation_source) ? entry.quality_signal.last_evaluation_source : void 0,
				last_seen: entry.quality_signal?.last_seen ?? ""
			}
		}];
	}));
}
function normalizeTensionEntries(entries) {
	return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
		seen_count: entry.seen_count ?? 0,
		directive_id: entry.directive_id ?? "",
		observation_id: entry.observation_id ?? "",
		last_execution_mode: entry.last_execution_mode ?? "ambient",
		last_seen: entry.last_seen ?? ""
	}]));
}
function updateObservationFeedback(existing, observations, input, now) {
	const observationStates = new Map(input.packet.governance.semantic_merge.observation_states.map((state) => [state.observation_id, state]));
	for (const [observationId, relationCount] of observations) {
		const entry = existing.observations[observationId] ?? createObservationEntry();
		const state = observationStates.get(observationId);
		entry.seen_count += 1;
		entry.relation_count += relationCount;
		if (state?.lifecycle_status === "active") entry.active_seen_count += 1;
		if (state?.lifecycle_status === "stale") entry.stale_seen_count += 1;
		if (state?.lifecycle_status === "superseded") entry.superseded_seen_count += 1;
		entry.last_disposition = state?.disposition ?? "pending";
		entry.last_lifecycle_status = state?.lifecycle_status ?? "unknown";
		entry.last_content_fingerprint = state?.content_fingerprint ?? null;
		entry.last_seen = now;
		existing.observations[observationId] = entry;
	}
}
function updateTensionFeedback(existing, input, now) {
	for (const tension of input.packet.governance.semantic_merge.context_tensions) {
		if (!tension.observation_id) continue;
		const key = `${tension.directive_id}::${tension.observation_id}`;
		const entry = existing.tensions[key] ?? createTensionEntry(tension.directive_id, tension.observation_id, tension.execution_mode);
		entry.seen_count += 1;
		entry.last_execution_mode = tension.execution_mode;
		entry.last_seen = now;
		existing.tensions[key] = entry;
	}
}
function getObservedRccl(input) {
	const counts = /* @__PURE__ */ new Map();
	for (const relation of input.packet.governance.semantic_merge.relations) {
		if (!relation.observation_id) continue;
		counts.set(relation.observation_id, (counts.get(relation.observation_id) ?? 0) + 1);
	}
	for (const link of input.packet.governance.semantic_merge.observation_links) if (!counts.has(link.observation_id)) counts.set(link.observation_id, link.directive_ids.length);
	return counts;
}
function summarizeHostFulfillmentFeedback(input) {
	const hasAdherence = input.adherencePayload?.length;
	const source = hasAdherence ? "adherence-evidence" : input.followedDirectiveIds?.length || input.ignoredDirectiveIds?.length ? "explicit-directives" : "no-explicit-evaluation";
	const signal = hasAdherence ? "explicit" : validSignalConfidence$1(input.signalConfidence) ? input.signalConfidence : source === "explicit-directives" ? "explicit" : "implicit";
	const fulfillment = input.hostFulfillment ?? input.packet.governance.trace.host_fulfillment;
	return {
		interpretation_mode: input.packet.interpretation.input_provenance.interpretation_mode,
		completion_signal: signal,
		completion_source: source,
		artifacts: {
			"agent-capability-profile": summarizeArtifactFeedback(fulfillment?.agentCapability),
			"task-model": summarizeArtifactFeedback(fulfillment?.taskModel),
			"semantic-governance-graph": summarizeArtifactFeedback(fulfillment?.semanticGovernanceGraph),
			"adherence-evidence": summarizeArtifactFeedback(fulfillment?.adherenceEvidence)
		}
	};
}
function summarizeArtifactFeedback(artifact) {
	const summary = artifact?.diagnostics?.summary;
	return {
		provided: artifact?.provided ?? false,
		status: artifact?.status ?? "absent",
		accepted: summary?.accepted ?? 0,
		rejected: summary?.rejected ?? 0,
		downgraded: summary?.downgraded ?? 0,
		unused: summary?.unused ?? 0
	};
}
function createObservationEntry() {
	return {
		seen_count: 0,
		relation_count: 0,
		active_seen_count: 0,
		stale_seen_count: 0,
		superseded_seen_count: 0,
		last_disposition: "pending",
		last_lifecycle_status: "unknown",
		last_content_fingerprint: null,
		last_seen: ""
	};
}
function createTensionEntry(directiveId, observationId, executionMode) {
	return {
		seen_count: 0,
		directive_id: directiveId,
		observation_id: observationId,
		last_execution_mode: executionMode,
		last_seen: ""
	};
}
function createDocument() {
	return {
		version: "1.0",
		directives: {},
		observations: {},
		tensions: {},
		governance_summary: {
			total_tasks: 0,
			by_task_type: {},
			by_task_profile: {},
			last_execution_modes: emptyModeCounts(),
			last_tension_count: 0,
			last_observation_count: 0,
			last_updated_at: ""
		}
	};
}
function createEntry() {
	return {
		quality_signal: {
			overall: {
				followed: 0,
				ignored: 0,
				partial: 0,
				unverified: 0,
				follow_rate: 0,
				coverage_rate: 0,
				trend: "stable",
				recent_verdicts: []
			},
			by_task_type: {},
			by_task_profile: {},
			ignored_reasons: {},
			signal_confidence: "implicit",
			last_seen: ""
		},
		governance: { outcomes: {
			total_tasks: 0,
			with_tensions: 0,
			last_execution_modes: emptyModeCounts(),
			last_tension_count: 0,
			last_updated_at: ""
		} }
	};
}
function emptyModeCounts() {
	return {
		enforce: 0,
		"deviation-noted": 0,
		ambient: 0,
		suppress: 0
	};
}
function getTrackedDirectiveIds(input) {
	return input.packet.governance.semantic_merge.directive_modes.filter((directive) => directive.execution_mode !== "suppress").map((directive) => directive.directive_id);
}
function summarizeExecutionModes(input) {
	const counts = emptyModeCounts();
	for (const directive of input.packet.governance.semantic_merge.directive_modes) counts[directive.execution_mode] += 1;
	return counts;
}
function computeFollowRate(entry) {
	const { followed, ignored, partial } = entry.quality_signal.overall;
	const total = followed + ignored + partial;
	return total === 0 ? 0 : Number((followed / total).toFixed(2));
}
function computeCoverageRate(entry) {
	const { followed, ignored, partial, unverified } = entry.quality_signal.overall;
	const covered = followed + ignored + partial;
	const total = covered + unverified;
	return total === 0 ? 0 : Number((covered / total).toFixed(2));
}
function emptySignalCounts() {
	return {
		followed: 0,
		ignored: 0,
		partial: 0,
		unverified: 0
	};
}
function normalizeSignalCountMap(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).map(([key, counts]) => {
		if (!counts || typeof counts !== "object" || Array.isArray(counts)) return [key, emptySignalCounts()];
		const item = counts;
		return [key, {
			followed: validCount(item.followed) ? item.followed : 0,
			ignored: validCount(item.ignored) ? item.ignored : 0,
			partial: validCount(item.partial) ? item.partial : 0,
			unverified: validCount(item.unverified) ? item.unverified : 0
		}];
	}));
}
function validCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function validEvaluationSource(value) {
	return value === "no-explicit-evaluation" || value === "explicit-directives" || value === "adherence-evidence";
}
function computeTrend(entry) {
	const verdicts = entry.quality_signal.overall.recent_verdicts;
	if (verdicts.length < 10) return "stable";
	const difference = strictWindowRate(verdicts.slice(-5)) - strictWindowRate(verdicts.slice(-10, -5));
	if (difference >= .1) return "improving";
	if (difference <= -.1) return "declining";
	return "stable";
}
function strictWindowRate(verdicts) {
	return verdicts.filter((verdict) => verdict === "followed").length / verdicts.length;
}
function normalizeRecentVerdicts(value) {
	return Array.isArray(value) ? value.filter((item) => item === "followed" || item === "partial" || item === "ignored").slice(-20) : [];
}
function acquireLock(lockPath, timeoutMs = 5e3) {
	mkdirSync(dirname(lockPath), { recursive: true });
	const deadline = Date.now() + timeoutMs;
	let fd = null;
	while (fd === null) try {
		fd = openSync(lockPath, "wx");
		writeFileSync(fd, `${process.pid}\n${(/* @__PURE__ */ new Date()).toISOString()}\n`, "utf8");
		fsyncSync(fd);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		if (Date.now() >= deadline) throw new Error(`LOCKFILE_LOCK_TIMEOUT: could not acquire ${lockPath} within ${timeoutMs}ms.`);
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
	}
	return () => {
		if (fd !== null) closeSync(fd);
		try {
			unlinkSync(lockPath);
		} catch {}
	};
}
function atomicWrite(filePath, contents) {
	mkdirSync(dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	const fd = openSync(tempPath, "wx");
	try {
		writeFileSync(fd, contents, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tempPath, filePath);
	try {
		const directoryFd = openSync(dirname(filePath), "r");
		try {
			fsyncSync(directoryFd);
		} finally {
			closeSync(directoryFd);
		}
	} catch {}
}
function taskProfileKey(input) {
	const context = input.packet.interpretation.resolved.context_profile;
	return [
		input.ego.taskIntent.change_type,
		context.risk_level ?? "medium",
		context.scope_size ?? "unknown",
		context.compatibility_requirement ?? "none"
	].join("|");
}
function resolveSignalConfidence(input, ignored) {
	if (validSignalConfidence$1(input.signalConfidence)) return input.signalConfidence;
	if (ignored) return "explicit";
	return input.followedDirectiveIds?.length || input.ignoredDirectiveIds?.length ? "explicit" : "implicit";
}
function normalizeIgnoredReasons(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result = {};
	for (const [reason, count] of Object.entries(value)) {
		if (!validIgnoredReason(reason) || typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
		result[reason] = count;
	}
	return result;
}
function validIgnoredReason(value) {
	return value === "not-applicable" || value === "conflicts-with-task" || value === "too-broad" || value === "repo-reality" || value === "false-positive" || value === "user-corrected" || value === "other";
}
function validSignalConfidence$1(value) {
	return value === "implicit" || value === "explicit" || value === "review-confirmed" || value === "user-corrected";
}
function resolveFromAdherencePayload(input, trackedDirectiveIds) {
	if (!input.adherencePayload?.length) return null;
	const followed = /* @__PURE__ */ new Set();
	const ignored = /* @__PURE__ */ new Set();
	const partial = /* @__PURE__ */ new Set();
	const unverified = /* @__PURE__ */ new Set();
	const ignoredReasons = {};
	const evidenceConfidence = /* @__PURE__ */ new Map();
	const trackedSet = new Set(trackedDirectiveIds);
	const evaluated = /* @__PURE__ */ new Set();
	for (const verdict of input.adherencePayload) {
		if (!trackedSet.has(verdict.directive_id)) continue;
		evaluated.add(verdict.directive_id);
		evidenceConfidence.set(verdict.directive_id, verdict.confidence);
		if (verdict.verdict === "followed") followed.add(verdict.directive_id);
		else if (verdict.verdict === "ignored") {
			ignored.add(verdict.directive_id);
			if (verdict.ignored_reason) ignoredReasons[verdict.directive_id] = verdict.ignored_reason;
		} else if (verdict.verdict === "partial") partial.add(verdict.directive_id);
		else if (verdict.verdict === "unverified") unverified.add(verdict.directive_id);
	}
	for (const id of trackedDirectiveIds) if (!evaluated.has(id)) unverified.add(id);
	return {
		followed,
		ignored,
		partial,
		unverified,
		ignoredReasons,
		evidenceConfidence
	};
}
//#endregion
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
	const parsed = parseYaml$1(readFileSync(lockfilePath, "utf-8"));
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
//#region src/select/activation-plan.ts
const LAYER_RANKS = {
	core: 5,
	languages: 4,
	frameworks: 3,
	domains: 2,
	local: 1
};
function getDirectiveLayerRank(layerId) {
	if (layerId === "local" || layerId.startsWith("local")) return LAYER_RANKS.local;
	if (layerId.includes("/domains/")) return LAYER_RANKS.domains;
	if (layerId.includes("/frameworks/")) return LAYER_RANKS.frameworks;
	if (layerId.includes("/languages/")) return LAYER_RANKS.languages;
	return LAYER_RANKS.core;
}
//#endregion
//#region src/ir/adapters/playbook.ts
const WEIGHT_RANKS = {
	low: 0,
	normal: 1,
	high: 2,
	critical: 3
};
const PRESCRIPTION_RANKS = {
	should: 0,
	must: 1
};
function directivesToIR(directives, local) {
	const overrideById = new Map(local?.overrides.map((item) => [item.supersedes, item]) ?? []);
	const augmentById = new Map(local?.augments.map((item) => [item.id, item]) ?? []);
	const suppressById = new Map(local?.suppresses.map((item) => [item.id, item]) ?? []);
	return directives.map((directive) => {
		const override = overrideById.get(directive.id);
		const augment = augmentById.get(directive.id);
		const suppression = suppressById.get(directive.id);
		const prescription = override?.prescription ?? directive.prescription;
		const weight = override?.weight ?? directive.weight;
		return {
			irVersion: GOVERNANCE_IR_VERSION,
			id: directive.id,
			semanticKey: toSemanticKey(directive.id),
			source: {
				kind: directive.source.kind === "local-addition" ? "local-playbook" : "builtin-playbook",
				id: directive.source.layerId,
				path: directive.source.filePath
			},
			layer: {
				id: directive.source.layerId,
				rank: getDirectiveLayerRank(directive.source.layerId)
			},
			scope: { path: directive.scope.path },
			kind: directive.type,
			prescription,
			weight,
			priority: buildPriority(directive.source.layerId, prescription, weight, Boolean(override)),
			body: {
				description: directive.description,
				rationale: override?.rationale ?? directive.rationale,
				exceptions: override?.exceptions ?? directive.exceptions ?? [],
				examples: augment ? [...directive.examples, ...augment.examples] : directive.examples
			},
			traits: buildTraits$1(directive),
			local: {
				overrideApplied: Boolean(override),
				augmentApplied: Boolean(augment),
				suppressed: Boolean(suppression),
				suppressionReason: suppression?.reason
			}
		};
	});
}
function buildPriority(layerId, prescription, weight, overrideApplied) {
	return {
		layerRank: getDirectiveLayerRank(layerId),
		prescriptionRank: PRESCRIPTION_RANKS[prescription],
		weightRank: WEIGHT_RANKS[weight],
		localOverrideRank: overrideApplied ? 1 : 0
	};
}
function buildTraits$1(directive) {
	const explicit = directive.traits ?? {};
	return {
		rcclImmune: directive.rccl_immune === true,
		safetyCritical: explicit.safety_critical === true,
		broadScope: explicit.broad_scope === true,
		compatibilitySensitive: explicit.compatibility_sensitive === true,
		migrationSensitive: explicit.migration_sensitive === true
	};
}
function toSemanticKey(id) {
	return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
//#endregion
//#region src/ir/adapters/rccl.ts
function observationsToIR(observations, rcclPath) {
	return observations.map((observation) => ({
		irVersion: GOVERNANCE_IR_VERSION,
		id: observation.id,
		semanticKey: observation.semantic_key,
		source: {
			kind: "rccl",
			id: observation.id,
			path: rcclPath,
			fingerprint: observation.lifecycle?.content_fingerprint
		},
		category: observation.category,
		scope: { path: observation.scope },
		pattern: observation.pattern,
		adherence: {
			quality: observation.adherence_quality,
			confidence: observation.confidence
		},
		evidence: observation.evidence,
		support: {
			sourceSlices: observation.support.source_slices,
			fileCount: observation.support.file_count,
			clusterCount: observation.support.cluster_count,
			scopeBasis: observation.support.scope_basis
		},
		verification: {
			evidenceStatus: observation.verification.evidence_status ?? "pending",
			evidenceVerifiedCount: observation.verification.evidence_verified_count ?? 0,
			evidenceConfidence: observation.verification.evidence_confidence ?? 0,
			inductionStatus: observation.verification.induction_status ?? "pending",
			inductionConfidence: observation.verification.induction_confidence ?? 0,
			checkedAt: observation.verification.checked_at,
			disposition: observation.verification.disposition ?? "demote-to-ambient"
		},
		lifecycle: {
			firstSeenGitRef: observation.lifecycle?.first_seen_git_ref ?? null,
			lastSeenGitRef: observation.lifecycle?.last_seen_git_ref ?? null,
			lastVerifiedAt: observation.lifecycle?.last_verified_at ?? null,
			contentFingerprint: observation.lifecycle?.content_fingerprint ?? null,
			status: observation.lifecycle?.status ?? "unknown",
			supersedes: observation.lifecycle?.supersedes ?? [],
			supersededBy: observation.lifecycle?.superseded_by ?? null
		},
		traits: buildTraits(observation)
	}));
}
function buildTraits(observation) {
	const explicit = observation.traits ?? {};
	return {
		legacy: observation.category === "legacy" || explicit.legacy === true,
		migrationBoundary: observation.category === "migration" || explicit.migration_boundary === true,
		antiPattern: observation.category === "anti-pattern" || explicit.anti_pattern === true,
		compatibilityBoundary: explicit.compatibility_boundary === true
	};
}
//#endregion
//#region src/utils/hash.ts
function stableHash(parts) {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}
//#endregion
//#region src/ir/adapters/task.ts
function taskToIR(resolved) {
	const intent = resolved.task_intent;
	const context = resolved.context_profile;
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"task-ir",
			resolved.task.description,
			intent,
			context
		]),
		workflow: intent.workflow,
		changeType: intent.change_type,
		operation: intent.operation,
		targetLayer: intent.target_layer,
		targets: buildTargets(intent.target_file, intent.changed_files),
		techStack: intent.tech_stack,
		tags: intent.tags,
		context,
		provenance: buildProvenance(resolved),
		unresolved: resolved.input_provenance.unresolved_fields,
		diagnostics: {
			clarificationRecommended: resolved.diagnostics.clarification_recommended,
			ambiguityReasons: resolved.diagnostics.ambiguity_reasons
		}
	};
}
function buildTargets(targetFile, changedFiles) {
	const targets = [];
	if (targetFile) targets.push({
		path: targetFile,
		role: "target"
	});
	for (const path of changedFiles) if (path !== targetFile) targets.push({
		path,
		role: "changed"
	});
	return targets;
}
function buildProvenance(resolved) {
	return resolved.input_provenance.resolved_fields.map((field) => ({
		field: String(field.field ?? "unknown"),
		source: String(field.source ?? "unknown"),
		confidence: typeof field.confidence === "number" ? field.confidence : 0
	}));
}
//#endregion
//#region src/ir/fingerprint.ts
function fingerprintPart(value) {
	return stableHash([canonicalize(value)]);
}
function buildIRFingerprints(input) {
	const task = fingerprintPart(input.task);
	const directives = fingerprintPart(input.directives);
	const observations = fingerprintPart(input.observations);
	const feedback = fingerprintPart(input.feedback);
	const hostProposals = fingerprintPart(input.hostProposals);
	return {
		task,
		directives,
		observations,
		feedback,
		hostProposals,
		bundle: fingerprintPart({
			irVersion: input.irVersion,
			sourceManifest: input.sourceManifest,
			task,
			directives,
			observations,
			feedback,
			hostProposals
		})
	};
}
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}
//#endregion
//#region src/ir/build-ir.ts
async function buildGovernanceIR(input, sources) {
	const resolvedTask = resolveCompileTask(input);
	const loadedSources = sources?.rcclVerificationSummary ? sources : await loadOrVerifyCompileSources({
		...input,
		resolvedTask
	}, sources);
	const bundleWithoutFingerprints = {
		irVersion: GOVERNANCE_IR_VERSION,
		task: taskToIR(resolvedTask),
		directives: directivesToIR(loadedSources.allDirectives, loadedSources.local),
		observations: observationsToIR(loadedSources.rccl?.observations ?? [], input.rcclPath),
		feedback: feedbackToIR(input.lockfilePath),
		hostProposals: input.hostProposals ?? [],
		sourceManifest: {
			builtinRoot: input.builtinRoot,
			selectedLayers: loadedSources.selectedLayerIds,
			localAugmentPath: input.localAugmentPath,
			rcclPath: input.rcclPath,
			lockfilePath: input.lockfilePath,
			projectRoot: input.projectRoot,
			sources: [
				{
					kind: "builtin-playbook",
					id: "builtin-root",
					path: input.builtinRoot,
					fingerprint: stableHash(loadedSources.selectedLayerIds)
				},
				...input.localAugmentPath ? [{
					kind: "local-playbook",
					id: "local-augment",
					path: input.localAugmentPath
				}] : [],
				...loadedSources.rccl ? [{
					kind: "rccl",
					id: loadedSources.rccl.git_ref ?? "rccl",
					path: input.rcclPath,
					version: loadedSources.rccl.version,
					fingerprint: stableHash(loadedSources.rccl.observations.map((observation) => observation.lifecycle?.content_fingerprint ?? observation.id))
				}] : [],
				...input.lockfilePath ? [{
					kind: "lockfile",
					id: "playbook.lock",
					path: input.lockfilePath
				}] : [],
				...(input.hostProposals ?? []).map((proposal) => ({
					kind: "host-proposal",
					id: proposal.source.id,
					path: proposal.source.path,
					fingerprint: stableHash([
						proposal.kind,
						proposal.source.id,
						proposal.payload
					])
				}))
			]
		}
	};
	return {
		...bundleWithoutFingerprints,
		fingerprints: buildIRFingerprints(bundleWithoutFingerprints)
	};
}
//#endregion
//#region src/compile-input.ts
function hasResolvedTask(input) {
	return "resolvedTask" in input;
}
function resolveCompileTask(input) {
	if (hasResolvedTask(input)) return input.resolvedTask;
	return resolveTask({
		task: input.task,
		taskModels: input.taskModels ?? [],
		interpretationMode: input.interpretationMode
	});
}
function toResolvedCompileInput(input) {
	if (hasResolvedTask(input)) return input;
	const { task: _task, taskModels: _taskModels, interpretationMode: _interpretationMode, ...base } = input;
	return {
		...base,
		resolvedTask: resolveCompileTask(input)
	};
}
async function resolveActivatedGovernanceContext(input) {
	const normalizedInput = toResolvedCompileInput(input);
	const resolvedTask = normalizedInput.resolvedTask;
	const sources = await loadOrVerifyCompileSources(normalizedInput, normalizedInput.preloadedSources);
	const governanceIR = await buildGovernanceIR(normalizedInput, sources);
	const activationDecisions = resolveActivationDecisionsIR(governanceIR);
	const activatedDirectiveIds = activatedDirectiveIdsIR(activationDecisions);
	return {
		normalizedInput,
		resolvedTask,
		sources,
		governanceIR,
		activationDecisions,
		activatedDirectiveIds,
		activeDirectives: governanceIR.directives.filter((directive) => activatedDirectiveIds.has(directive.id))
	};
}
//#endregion
//#region src/ai-contracts/semantic-governance-graph.ts
const SEMANTIC_GRAPH_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		nodes: { type: "array" },
		edges: { type: "array" }
	},
	required: ["edges"]
};
async function prepareSemanticContractContext(input) {
	const ctx = await resolveActivatedGovernanceContext(input.compileInput);
	return {
		resolvedTask: ctx.resolvedTask,
		directives: ctx.activeDirectives.map(summarizeDirectiveForProposal),
		observations: ctx.governanceIR.observations.filter((observation) => !skippedObservationIds(ctx.sources).has(observation.id)).map(summarizeObservationForProposal),
		loadedSources: ctx.sources
	};
}
async function prepareSemanticGovernanceGraphContractBundle(input) {
	const context = await prepareSemanticContractContext(input);
	return {
		...context,
		...prepareSemanticGovernanceGraphContract({
			resolvedTask: context.resolvedTask,
			directives: context.directives,
			observations: context.observations,
			artifactPath: input.artifactPath
		})
	};
}
function prepareSemanticGovernanceGraphContract(input) {
	const prompt = buildGraphPrompt(input);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind semantic-governance-graph, the issued requestId/contextFingerprint as request_id/context_fingerprint, and the graph under payload; then re-run with --governance-graph-file ${input.artifactPath}.`
	};
	const cacheKeyMaterial = {
		taskIntent: input.resolvedTask.task_intent,
		contextProfile: input.resolvedTask.context_profile,
		directiveIds: input.directives.map((directive) => directive.id),
		observationIds: input.observations.map((observation) => observation.id)
	};
	return {
		graphPrompt: prompt,
		graphSchema: JSON.stringify(SEMANTIC_GRAPH_SCHEMA, null, 2),
		graphArtifact: artifact,
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "semantic-governance-graph",
			...artifactIdentity("semantic-governance-graph", cacheKeyMaterial),
			schemaId: "runtime.semantic-governance-graph",
			schemaVersion: "1.0",
			prompt,
			schema: SEMANTIC_GRAPH_SCHEMA,
			artifact,
			allowedIds: allowedIds(input),
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			context: {
				resolvedTask: {
					task_intent: input.resolvedTask.task_intent,
					context_profile: input.resolvedTask.context_profile
				},
				directives: input.directives.map(compactDirectiveForContract),
				observations: input.observations.map(compactObservationForContract),
				edgeGuidance: {
					relations: [
						"reinforce",
						"tension",
						"suppress",
						"ambient-only",
						"unrelated"
					],
					impacts: [
						"execution-mode",
						"review-focus",
						"ambient-context",
						"no-effect"
					],
					execution_intents: [
						"enforce",
						"deviation-noted",
						"ambient",
						"suppress",
						"no-change"
					],
					requirement: "Create edges only when the directive and observation meaning materially affect execution, review focus, or ambient context for this task."
				}
			},
			cacheKeyMaterial
		}
	};
}
function validateSemanticGovernanceGraphPayload(input) {
	const entries = [];
	const versionDiagnostic = contractVersionDiagnostic(input.raw, "semantic-governance-graph");
	if (versionDiagnostic) return {
		proposal: buildHostProposal(input.source, { edges: [] }),
		diagnostics: buildContractPayloadDiagnostics("semantic-governance-graph", [versionDiagnostic], input.source)
	};
	const allowedDirectiveIds = input.allowedDirectiveIds ? new Set(input.allowedDirectiveIds) : null;
	const allowedObservationIds = input.allowedObservationIds ? new Set(input.allowedObservationIds) : null;
	const edges = graphEdges(input.raw, entries);
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	edges.forEach((edge, index) => {
		const path = `edges[${index}]`;
		if (!isGraphEdge$1(edge)) {
			entries.push(rejected(path, "malformed-payload", "Graph edge is missing required fields or has unsupported values."));
			return;
		}
		if (allowedDirectiveIds && !allowedDirectiveIds.has(edge.directive_id)) {
			entries.push(rejected(path, "invalid-id", "Graph edge references a directive id outside allowedIds.", edge));
			return;
		}
		if (allowedObservationIds && !allowedObservationIds.has(edge.observation_id)) {
			entries.push(rejected(path, "invalid-id", "Graph edge references an observation id outside allowedIds.", edge));
			return;
		}
		const duplicateKey = `${edge.directive_id}::${edge.observation_id}::${edge.relation}`;
		if (seen.has(duplicateKey)) {
			entries.push(rejected(path, "duplicate-id", "Duplicate graph edge for directive, observation, and relation.", edge));
			return;
		}
		seen.add(duplicateKey);
		if (edge.confidence < SEMANTIC_RELATION_POLICY.hostSemantic.minConfidence) {
			entries.push(rejected(path, "low-confidence", "Graph edge confidence is below Runtime host semantic threshold.", edge));
			return;
		}
		if (!validEvidenceRefs(edge.evidence_refs)) {
			entries.push(rejected(path, "missing-evidence", "Graph edge must include evidence_refs.", edge));
			return;
		}
		const evidenceRefs = normalizeEvidenceRefs(edge.evidence_refs);
		const evidence = verifyEvidenceRefs(evidenceRefs, input.evidenceContext);
		if (isExecutionImpactingEdge(edge) && evidence.conversationOnly) {
			entries.push(rejected(path, "conversation-only-evidence", "Execution-impacting graph edges cannot be supported only by conversation evidence.", edge));
			return;
		}
		if (isExecutionImpactingEdge(edge) && !evidence.hasStaticEvidence) {
			entries.push(rejected(path, "insufficient-static-evidence", "Execution-impacting graph edges require at least one statically verified evidence ref.", edge));
			return;
		}
		candidates.push({
			edge: {
				...edge,
				evidence_refs: evidenceRefs
			},
			index
		});
	});
	const accepted = [];
	const byDirective = /* @__PURE__ */ new Map();
	for (const candidate of candidates) {
		const group = byDirective.get(candidate.edge.directive_id) ?? [];
		group.push(candidate);
		byDirective.set(candidate.edge.directive_id, group);
	}
	for (const directiveId of [...byDirective.keys()].sort()) byDirective.get(directiveId).sort((left, right) => compareGraphCandidates(left.edge, right.edge, input.evidenceContext)).forEach((candidate, rank) => {
		const path = `edges[${candidate.index}]`;
		if (rank >= SEMANTIC_RELATION_POLICY.hostSemantic.maxCandidatesPerDirective) {
			entries.push({
				status: "unused",
				reason: "capped-by-policy",
				path,
				message: `Candidate exceeded maxCandidatesPerDirective=${SEMANTIC_RELATION_POLICY.hostSemantic.maxCandidatesPerDirective}.`,
				directiveId: candidate.edge.directive_id,
				observationId: candidate.edge.observation_id,
				confidence: candidate.edge.confidence
			});
			return;
		}
		accepted.push(candidate.edge);
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: "Semantic governance graph edge accepted for Runtime adjudication.",
			directiveId: candidate.edge.directive_id,
			observationId: candidate.edge.observation_id,
			confidence: candidate.edge.confidence
		});
	});
	if (!edges.length && !entries.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "edges",
		message: "No semantic governance graph edges were provided."
	});
	return {
		proposal: buildHostProposal(input.source, { edges: accepted }),
		diagnostics: buildContractPayloadDiagnostics("semantic-governance-graph", entries, input.source)
	};
}
function compareGraphCandidates(left, right, context) {
	const dispositionRank = (edge) => {
		const observation = context?.observations?.find((item) => item.id === edge.observation_id);
		return observation?.verification?.disposition === "keep" ? 2 : observation?.verification?.disposition === "keep-with-reduced-confidence" ? 1 : 0;
	};
	const disposition = dispositionRank(right) - dispositionRank(left);
	if (disposition) return disposition;
	if (left.confidence !== right.confidence) return right.confidence - left.confidence;
	if (left.evidence_refs.length !== right.evidence_refs.length) return right.evidence_refs.length - left.evidence_refs.length;
	return `${left.observation_id}:${left.relation}:${left.reason}`.localeCompare(`${right.observation_id}:${right.relation}:${right.reason}`);
}
function isExecutionImpactingEdge(edge) {
	return edge.impact === "execution-mode" || edge.execution_intent !== void 0 && edge.execution_intent !== "no-change";
}
function graphEdges(raw, entries) {
	if (Array.isArray(raw)) return raw;
	if (!raw) return [];
	if (!isRecord$1(raw)) {
		entries.push(rejected("payload", "malformed-payload", "Semantic governance graph payload must be an object with an edges array."));
		return [];
	}
	if (!Array.isArray(raw.edges)) {
		entries.push(rejected("edges", "malformed-payload", "Semantic governance graph edges field must be an array."));
		return [];
	}
	return raw.edges;
}
function isGraphEdge$1(value) {
	if (!isRecord$1(value)) return false;
	return typeof value.directive_id === "string" && typeof value.observation_id === "string" && isRelation$1(value.relation) && validConfidence(value.confidence) && typeof value.reason === "string" && validEvidenceRefs(value.evidence_refs) && (value.impact === void 0 || isImpact(value.impact)) && (value.review_priority === void 0 || isReviewPriority(value.review_priority)) && (value.execution_intent === void 0 || isExecutionIntent(value.execution_intent));
}
function isRelation$1(value) {
	return value === "reinforce" || value === "tension" || value === "suppress" || value === "ambient-only" || value === "unrelated";
}
function isImpact(value) {
	return value === "execution-mode" || value === "review-focus" || value === "ambient-context" || value === "no-effect";
}
function isReviewPriority(value) {
	return value === "low" || value === "normal" || value === "high" || value === "critical";
}
function isExecutionIntent(value) {
	return value === "enforce" || value === "deviation-noted" || value === "ambient" || value === "suppress" || value === "no-change";
}
function buildHostProposal(source, payload) {
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		source: {
			kind: "host-proposal",
			id: source.id,
			...source.path ? { path: source.path } : {}
		},
		kind: "semantic-governance-graph",
		payload
	};
}
function rejected(path, reason, message, edge) {
	return {
		status: "rejected",
		reason,
		path,
		message,
		directiveId: edge?.directive_id,
		observationId: edge?.observation_id,
		confidence: edge?.confidence
	};
}
function summarizeDirectiveForProposal(directive) {
	return {
		id: directive.id,
		semanticKey: directive.semanticKey,
		kind: directive.kind,
		prescription: directive.prescription,
		weight: directive.weight,
		layer: directive.layer.id,
		scope: directive.scope.path,
		description: directive.body.description,
		rationale: directive.body.rationale,
		traits: directive.traits
	};
}
function summarizeObservationForProposal(observation) {
	return {
		id: observation.id,
		semanticKey: observation.semanticKey,
		category: observation.category,
		scope: observation.scope.path,
		pattern: observation.pattern,
		adherence: observation.adherence,
		verification: observation.verification,
		lifecycle: observation.lifecycle,
		traits: observation.traits,
		evidenceRefs: observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`),
		evidence: observation.evidence.map((evidence) => ({
			file: evidence.file,
			line_range: evidence.line_range,
			snippet: evidence.snippet
		}))
	};
}
function skippedObservationIds(sources) {
	return new Set((sources.rcclVerificationSummary?.records ?? []).filter((record) => record.action === "skipped-not-task-relevant").map((record) => record.observation_id));
}
function buildGraphPrompt(input) {
	const directives = input.directives.map(compactDirectiveForContract);
	const observations = input.observations.map(compactObservationForContract);
	return [
		"Produce a semantic-governance-graph payload for Runtime.",
		"Edges connect active directives to RCCL observations when repository reality changes how guidance should execute for this task.",
		"Every edge must include evidence_refs from task context, RCCL evidence, files, diff, commands, or runtime trace.",
		"Runtime will validate IDs, confidence, scope, verification, lifecycle, and final execution mode deterministically.",
		"Use the directive and observation summaries below; do not infer relations from IDs alone.",
		"Return JSON only.",
		"",
		`Resolved task intent: ${JSON.stringify(input.resolvedTask.task_intent)}`,
		`Resolved context profile: ${JSON.stringify(input.resolvedTask.context_profile)}`,
		`Allowed directive ids: ${input.directives.map((item) => item.id).join(", ") || "(none)"}`,
		`Allowed observation ids: ${input.observations.map((item) => item.id).join(", ") || "(none)"}`,
		"",
		"Directive summaries:",
		JSON.stringify(directives, null, 2),
		"",
		"Observation summaries:",
		JSON.stringify(observations, null, 2)
	].join("\n");
}
function allowedIds(input) {
	return {
		directiveIds: input.directives.map((directive) => directive.id),
		observationIds: input.observations.map((observation) => observation.id)
	};
}
function compactDirectiveForContract(directive) {
	return {
		id: directive.id,
		semanticKey: directive.semanticKey,
		kind: directive.kind,
		prescription: directive.prescription,
		weight: directive.weight,
		layer: directive.layer,
		scope: directive.scope,
		description: truncate(directive.description, 360),
		rationale: truncate(directive.rationale, 360),
		traits: directive.traits
	};
}
function compactObservationForContract(observation) {
	return {
		id: observation.id,
		semanticKey: observation.semanticKey,
		category: observation.category,
		scope: observation.scope,
		pattern: truncate(observation.pattern, 420),
		adherence: observation.adherence,
		verification: observation.verification,
		lifecycle: observation.lifecycle,
		traits: observation.traits,
		evidenceRefs: observation.evidenceRefs,
		evidence: observation.evidence.slice(0, 4).map((evidence) => ({
			file: evidence.file,
			line_range: evidence.line_range,
			snippet: truncate(evidence.snippet, 260)
		}))
	};
}
function truncate(value, maxLength) {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
//#endregion
//#region src/ai-contracts/task-model.ts
const TASK_MODEL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		intent: { type: "object" },
		context: { type: "object" },
		uncertainties: {
			type: "array",
			items: { type: "string" }
		}
	},
	required: [
		"intent",
		"context",
		"uncertainties"
	]
};
function prepareTaskModelContract(input) {
	const prompt = buildTaskModelPrompt(input);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write a v1 envelope to ${input.artifactPath}: schema_version 1, kind task-model, the issued requestId/contextFingerprint as request_id/context_fingerprint, and the task-model object or array under payload; then re-run with --task-model-file ${input.artifactPath}.`
	};
	return {
		task: input.task,
		taskModelPrompt: prompt,
		taskModelSchema: JSON.stringify(TASK_MODEL_SCHEMA, null, 2),
		ambiguityHints: buildAmbiguityHints(input.task),
		modelArtifact: artifact,
		clarificationHints: buildClarificationHints(input.task),
		contract: {
			contractVersion: AI_CONTRACT_VERSION,
			kind: "task-model",
			...artifactIdentity("task-model", {
				task: input.task,
				schemaId: "runtime.task-model"
			}),
			schemaId: "runtime.task-model",
			schemaVersion: "1.0",
			prompt,
			schema: TASK_MODEL_SCHEMA,
			artifact,
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: {
				task: input.task,
				schemaId: "runtime.task-model"
			}
		}
	};
}
function validateTaskModelPayload(raw) {
	const versionDiagnostic = contractVersionDiagnostic(raw, "task-model");
	if (versionDiagnostic) return {
		models: [],
		diagnostics: buildContractPayloadDiagnostics("task-model", [versionDiagnostic])
	};
	const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
	const entries = [];
	const models = [];
	values.forEach((value, index) => {
		const path = Array.isArray(raw) ? `models[${index}]` : "model";
		if (!isTaskModelProposal(value)) {
			entries.push({
				status: "rejected",
				reason: value == null ? "empty-payload" : "malformed-payload",
				path,
				message: "Task model must include intent, context, uncertainties, and evidence-backed fields."
			});
			return;
		}
		const fieldError = firstInvalidField(value);
		if (fieldError) {
			entries.push({
				status: "rejected",
				reason: fieldError.reason,
				path: `${path}.${fieldError.field}`,
				message: fieldError.message,
				confidence: fieldError.confidence
			});
			return;
		}
		models.push(value);
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: "Task model accepted for Runtime field-level adjudication."
		});
	});
	if (!values.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "model",
		message: "No task model payload was provided."
	});
	return {
		models,
		diagnostics: buildContractPayloadDiagnostics("task-model", entries)
	};
}
function isTaskModelProposal(value) {
	if (!isRecord$1(value)) return false;
	return isRecord$1(value.intent) && isRecord$1(value.context) && Array.isArray(value.uncertainties) && value.uncertainties.every((item) => typeof item === "string");
}
function firstInvalidField(model) {
	const fields = [
		[
			"intent.workflow",
			model.intent.workflow,
			TASK_INTERPRETATION_ENUMS.intent.workflow,
			"scalar"
		],
		[
			"intent.change_type",
			model.intent.change_type,
			TASK_INTERPRETATION_ENUMS.intent.change_type,
			"scalar"
		],
		[
			"intent.operation",
			model.intent.operation,
			TASK_INTERPRETATION_ENUMS.intent.operation,
			"scalar"
		],
		[
			"intent.target_layer",
			model.intent.target_layer,
			null,
			"scalar"
		],
		[
			"intent.target_file",
			model.intent.target_file,
			null,
			"scalar"
		],
		[
			"intent.changed_files",
			model.intent.changed_files,
			null,
			"list"
		],
		[
			"intent.tech_stack",
			model.intent.tech_stack,
			null,
			"list"
		],
		[
			"intent.tags",
			model.intent.tags,
			null,
			"list"
		],
		[
			"context.project_stage",
			model.context.project_stage,
			TASK_INTERPRETATION_ENUMS.context.project_stage,
			"scalar"
		],
		[
			"context.optimization_target",
			model.context.optimization_target,
			TASK_INTERPRETATION_ENUMS.context.optimization_target,
			"scalar"
		],
		[
			"context.hard_constraints",
			model.context.hard_constraints,
			null,
			"list"
		],
		[
			"context.allowed_tradeoffs",
			model.context.allowed_tradeoffs,
			null,
			"list"
		],
		[
			"context.avoid",
			model.context.avoid,
			null,
			"list"
		],
		[
			"context.risk_level",
			model.context.risk_level,
			TASK_INTERPRETATION_ENUMS.context.risk_level,
			"scalar"
		],
		[
			"context.scope_size",
			model.context.scope_size,
			TASK_INTERPRETATION_ENUMS.context.scope_size,
			"scalar"
		],
		[
			"context.compatibility_requirement",
			model.context.compatibility_requirement,
			TASK_INTERPRETATION_ENUMS.context.compatibility_requirement,
			"scalar"
		],
		[
			"context.interface_sensitivity",
			model.context.interface_sensitivity,
			TASK_INTERPRETATION_ENUMS.context.interface_sensitivity,
			"scalar"
		],
		[
			"context.refactor_tolerance",
			model.context.refactor_tolerance,
			TASK_INTERPRETATION_ENUMS.context.refactor_tolerance,
			"scalar"
		],
		[
			"context.migration_phase",
			model.context.migration_phase,
			TASK_INTERPRETATION_ENUMS.context.migration_phase,
			"scalar"
		],
		[
			"context.review_goal",
			model.context.review_goal,
			TASK_INTERPRETATION_ENUMS.context.review_goal,
			"scalar"
		]
	];
	for (const [field, candidate, allowedValues, kind] of fields) {
		if (candidate === void 0) continue;
		if (!isRecord$1(candidate)) return {
			field,
			reason: "malformed-payload",
			message: "Task model field must be an object."
		};
		if (!validConfidence(candidate.confidence)) return {
			field,
			reason: "malformed-payload",
			message: "Task model field confidence must be between 0 and 1."
		};
		if (candidate.confidence < .5) return {
			field,
			reason: "low-confidence",
			message: "Task model field confidence is below threshold.",
			confidence: candidate.confidence
		};
		if (!validEvidenceRefs(candidate.evidence_refs)) return {
			field,
			reason: "missing-evidence",
			message: "Task model field must include at least one valid evidence_ref.",
			confidence: candidate.confidence
		};
		if (kind === "scalar") {
			if (typeof candidate.value !== "string") return {
				field,
				reason: "missing-required-field",
				message: "Task model scalar field must include value.",
				confidence: candidate.confidence
			};
			if (allowedValues && !allowedValues.includes(candidate.value)) return {
				field,
				reason: "unsupported-value",
				message: `Unsupported value "${candidate.value}".`,
				confidence: candidate.confidence
			};
		} else if (!Array.isArray(candidate.values) || !candidate.values.every((item) => typeof item === "string")) return {
			field,
			reason: "missing-required-field",
			message: "Task model list field must include string values.",
			confidence: candidate.confidence
		};
	}
	return null;
}
function buildTaskModelPrompt(input) {
	return [
		"Produce a task-model payload for Runtime.",
		"Resolve only fields supported by evidence from the user request, conversation, files, diff, commands, or repository context.",
		"Every resolved field must include confidence and at least one evidence_ref.",
		"Runtime will validate enums, evidence shape, confidence, and field-level precedence.",
		"Return JSON only.",
		"",
		`Task description: ${input.task.description}`,
		`Explicit workflow: ${input.task.workflow ?? "(none)"}`,
		`Explicit change type: ${input.task.changeType ?? "(none)"}`,
		`Explicit operation: ${input.task.operation ?? "(none)"}`,
		`Explicit target file: ${input.task.targetFile ?? "(none)"}`,
		`Explicit changed files: ${input.task.changedFiles?.join(", ") || "(none)"}`,
		`Explicit tech stack: ${input.task.techStack?.join(", ") || "(none)"}`,
		`Allowed task enum values: ${JSON.stringify(TASK_INTERPRETATION_ENUMS)}`
	].join("\n");
}
function buildAmbiguityHints(task) {
	const hints = [];
	if (!task.changeType) hints.push("change type is not explicit");
	if (!task.operation) hints.push("operation is not explicit");
	if (!task.targetFile && !task.changedFiles?.length) hints.push("no concrete target files are specified");
	if (!task.techStack?.length) hints.push("tech stack is implicit");
	if (!task.projectStage) hints.push("project stage is not specified");
	return hints;
}
function buildClarificationHints(task) {
	return [
		...!task.changeType ? ["Clarify whether this is feature, bugfix, refactor, migration, or unknown work."] : [],
		...!task.operation ? ["Clarify whether files are created, modified, deleted, or mixed."] : [],
		...!task.targetFile && !task.changedFiles?.length ? ["Name the target or changed files when known."] : [],
		...!task.optimizationTarget ? ["Specify the optimization target when the tradeoff matters."] : []
	];
}
//#endregion
//#region src/contract-policy.ts
const DEFAULT_CAPABILITIES = {
	can_read_files: true,
	can_search_files: true,
	can_run_commands: false,
	can_inspect_diff: false,
	can_request_context: true,
	max_context_files: 12,
	max_command_count: 0
};
function resolveContractPolicy(input) {
	const mode = input.mode ?? "standard";
	const policyInput = {
		...input,
		resolvedTask: input.resolvedTask ?? resolvePolicyTask(input)
	};
	const provided = input.providedContracts ?? {};
	const capability = input.agentCapabilityProfile ?? DEFAULT_CAPABILITIES;
	const highRiskTask = isHighRisk$1(policyRiskLevel(policyInput));
	const taskModelRequired = shouldRequireTaskModel(policyInput, mode);
	const semanticGraphRequired = shouldRequireSemanticGraph(policyInput, mode, taskModelRequired);
	const deterministicFallbacks = collectDeterministicFallbackGovernance(policyInput);
	const required = [];
	const optional = [];
	const skipped = [];
	const reasons = [];
	skipped.push({
		kind: "agent-capability-profile",
		reason_id: provided.agentCapability ? "already-provided" : "runtime-assumption"
	});
	if (!provided.agentCapability) reasons.push("agent capability profile is a Runtime assumption for policy selection, not a host artifact.");
	if (provided.taskModel) skipped.push({
		kind: "task-model",
		reason_id: "already-provided"
	});
	else if (taskModelRequired) {
		required.push("task-model");
		reasons.push(mode === "strict" ? "strict mode requires task-model before deterministic compilation." : "task risk, compatibility, migration, or ambiguity requires task-model.");
	} else {
		optional.push("task-model");
		skipped.push({
			kind: "task-model",
			reason_id: mode === "fast" ? "mode-fast" : "deterministic-fallback-allowed"
		});
		reasons.push("deterministic task interpretation is allowed for this mode and task shape.");
	}
	const needsTaskModel = taskModelRequired && !provided.taskModel;
	if (rcclAvailable(input.sourceStatus)) if (provided.semanticGovernanceGraph) skipped.push({
		kind: "semantic-governance-graph",
		reason_id: "already-provided"
	});
	else if (!semanticGraphRequired) skipped.push({
		kind: "semantic-governance-graph",
		reason_id: mode === "fast" ? "mode-fast" : input.rcclRelevant === false ? "rccl-not-relevant" : "not-required-for-current-policy"
	});
	else if (needsTaskModel) {
		skipped.push({
			kind: "semantic-governance-graph",
			reason_id: "waiting-for-task-model"
		});
		reasons.push("semantic-governance-graph is deferred until task-model is provided.");
	} else {
		required.push("semantic-governance-graph");
		reasons.push("RCCL is relevant to this task and semantic governance should be host-assisted.");
	}
	else if (capability.can_request_context) {
		if (mode === "strict" && highRiskTask) required.push("context-acquisition");
		else optional.push("context-acquisition");
		skipped.push({
			kind: "semantic-governance-graph",
			reason_id: "missing-rccl"
		});
	} else {
		skipped.push({
			kind: "semantic-governance-graph",
			reason_id: "missing-rccl"
		});
		skipped.push({
			kind: "context-acquisition",
			reason_id: "insufficient-agent-capability"
		});
	}
	if (!provided.adherenceEvidence && (capability.can_inspect_diff || capability.can_read_files || capability.can_run_commands)) {
		if (mode === "strict") required.push("adherence-evidence");
		else optional.push("adherence-evidence");
		skipped.push({
			kind: "adherence-evidence",
			reason_id: "deferred-until-after-compile"
		});
	} else if (provided.adherenceEvidence) skipped.push({
		kind: "adherence-evidence",
		reason_id: "already-provided"
	});
	else skipped.push({
		kind: "adherence-evidence",
		reason_id: "insufficient-agent-capability"
	});
	if (input.sourceStatus.lockfile === "present") optional.push("governance-evolution-proposal");
	else skipped.push({
		kind: "governance-evolution-proposal",
		reason_id: "not-required-for-current-policy"
	});
	return {
		mode,
		required: unique(required),
		optional: unique(optional),
		skipped,
		escalation: resolveEscalation(required, optional),
		diagnostics: {
			task_model_required: taskModelRequired,
			semantic_graph_required: semanticGraphRequired,
			...input.rcclRelevant !== void 0 ? { rccl_relevant: input.rcclRelevant } : {},
			reasons,
			deterministic_fallbacks: deterministicFallbacks
		}
	};
}
function resolveEscalation(required, optional) {
	if (required.includes("task-model")) return "task-model";
	if (required.includes("semantic-governance-graph")) return "semantic-governance-graph";
	if (required.includes("adherence-evidence")) return "adherence-required";
	if (required.includes("context-acquisition")) return "context-acquisition";
	return "none";
}
function shouldRequireTaskModel(input, mode) {
	if (mode === "strict") return true;
	if (mode === "fast") return false;
	const profile = policyContextProfile(input);
	const task = policyTask(input);
	const workflow = input.resolvedTask?.task_intent.workflow ?? task?.workflow;
	const changeType = input.resolvedTask?.task_intent.change_type ?? task?.changeType;
	if (isHighRisk$1(policyRiskLevel(input)) && isPolicyAuthoritative(input, "context.risk_level", "riskLevel")) return true;
	if (profile?.scope_size === "cross-cutting") return true;
	if (profile?.compatibility_requirement && profile.compatibility_requirement !== "none" && profile.compatibility_requirement !== "breaking-allowed" && isPolicyAuthoritative(input, "context.compatibility_requirement", "compatibilityRequirement")) return true;
	if (profile?.interface_sensitivity && profile.interface_sensitivity !== "internal" && profile.interface_sensitivity !== "unknown" && isPolicyAuthoritative(input, "context.interface_sensitivity", "interfaceSensitivity")) return true;
	if (profile?.migration_phase && profile.migration_phase !== "none" && isPolicyAuthoritative(input, "context.migration_phase", "migrationPhase")) return true;
	if ((profile?.review_goal === "security" || profile?.review_goal === "regression-risk" || profile?.review_goal === "architecture-fit") && isPolicyAuthoritative(input, "context.review_goal", "reviewGoal")) return true;
	if (changeType === "migration" && isPolicyAuthoritative(input, "intent.change_type", "changeType")) return true;
	if (workflow === "review" && isPolicyAuthoritative(input, "intent.workflow", "workflow")) return true;
	return hasAmbiguousTaskResolution(input);
}
function shouldRequireSemanticGraph(input, mode, taskModelRequired) {
	if (!rcclAvailable(input.sourceStatus)) return false;
	if (mode === "fast") return false;
	if (mode === "strict") return true;
	if (input.rcclRelevant !== true) return false;
	return taskModelRequired || isHighRisk$1(policyRiskLevel(input));
}
function hasAmbiguousTaskResolution(input) {
	const resolved = input.resolvedTask;
	if (!resolved?.diagnostics.clarification_recommended) return false;
	if (Boolean(resolved.task_intent.target_file || resolved.task_intent.changed_files.length || input.task?.targetFile || input.task?.changedFiles?.length)) return false;
	const operationField = resolved.input_provenance.resolved_fields.find((field) => field.field === "intent.operation");
	return !input.task?.operation && (!operationField || operationField.source === "deterministic" && operationField.confidence <= .5);
}
function collectDeterministicFallbackGovernance(input) {
	const result = [];
	const profile = policyContextProfile(input);
	if (!profile) return result;
	addFallbackGovernance(result, input, "context.risk_level", profile.risk_level ?? "");
	addFallbackGovernance(result, input, "context.compatibility_requirement", profile.compatibility_requirement ?? "");
	addFallbackGovernance(result, input, "context.interface_sensitivity", profile.interface_sensitivity ?? "");
	addFallbackGovernance(result, input, "context.migration_phase", profile.migration_phase ?? "");
	addFallbackGovernance(result, input, "context.review_goal", profile.review_goal ?? "");
	return result;
}
function addFallbackGovernance(result, input, field, value) {
	if (!value || !isElevatedFallbackField(field, value)) return;
	const resolved = resolvedField(input, field);
	if (resolved?.source !== "deterministic") return;
	result.push({
		field,
		value,
		confidence: resolved.confidence,
		action: "ignored-for-policy",
		reason: "deterministic fallback is trace-only and does not trigger standard-mode governance contracts"
	});
}
function isElevatedFallbackField(field, value) {
	if (field === "context.risk_level") return value === "high" || value === "critical";
	if (field === "context.compatibility_requirement") return value !== "none" && value !== "breaking-allowed";
	if (field === "context.interface_sensitivity") return value !== "internal" && value !== "unknown";
	if (field === "context.migration_phase") return value !== "none";
	if (field === "context.review_goal") return value === "security" || value === "regression-risk" || value === "architecture-fit";
	return false;
}
function isPolicyAuthoritative(input, field, rawTaskField) {
	if (rawTaskField === "riskLevel" && input.taskRisk && isHighRisk$1(input.taskRisk)) return true;
	return Boolean(input.task?.[rawTaskField]) && isFieldAuthoritative(input, field);
}
function isFieldAuthoritative(input, field) {
	const source = resolvedField(input, field)?.source;
	return source === "explicit" || source === "host-agent" || source === "assistive-ai" || source === "repo-default";
}
function resolvedField(input, field) {
	return input.resolvedTask?.input_provenance.resolved_fields.find((item) => item.field === field);
}
function rcclAvailable(sourceStatus) {
	return sourceStatus.rccl === "present" || sourceStatus.rccl === "stale" || sourceStatus.rccl === "unverified";
}
function resolvePolicyTask(input) {
	if (!input.task) return void 0;
	return resolveTask({
		task: input.task,
		taskModels: input.taskModels ?? [],
		interpretationMode: input.taskModels?.length ? "host-agent" : "deterministic-only"
	});
}
function policyTask(input) {
	return input.resolvedTask?.task ?? input.task;
}
function policyContextProfile(input) {
	return input.resolvedTask?.context_profile;
}
function policyRiskLevel(input) {
	return input.resolvedTask?.context_profile.risk_level ?? input.taskRisk ?? input.task?.riskLevel;
}
function isHighRisk$1(value) {
	return value === "high" || value === "critical";
}
//#endregion
//#region src/plan-guidance.ts
async function planGuidance(input) {
	const notes = [];
	const contractDiagnostics = [];
	const issuedCapabilityProfile = prepareAgentCapabilityProfileContract({
		task: input.task,
		artifactPath: input.artifactPaths.agentCapabilityProfile
	});
	let agentCapabilityProfile = null;
	if (input.artifacts?.agentCapabilityProfile) {
		const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.agentCapabilityProfile.raw, issuedCapabilityProfile.contract);
		if (unwrapped.diagnostic) contractDiagnostics.push(buildContractPayloadDiagnostics("agent-capability-profile", [unwrapped.diagnostic], {
			id: issuedCapabilityProfile.contract.requestId,
			path: input.artifacts.agentCapabilityProfile.path
		}));
		else {
			const validated = validateAgentCapabilityProfilePayload(unwrapped.payload);
			contractDiagnostics.push(validated.diagnostics);
			agentCapabilityProfile = validated.profile;
		}
	}
	const issuedTaskModel = prepareTaskModelContract({
		task: input.task,
		artifactPath: input.artifactPaths.taskModel
	});
	let taskModels = [];
	if (input.artifacts?.taskModel) {
		const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.taskModel.raw, issuedTaskModel.contract);
		if (unwrapped.diagnostic) contractDiagnostics.push(buildContractPayloadDiagnostics("task-model", [unwrapped.diagnostic], {
			id: issuedTaskModel.contract.requestId,
			path: input.artifacts.taskModel.path
		}));
		else {
			const validated = validateTaskModelPayload(unwrapped.payload);
			contractDiagnostics.push(validated.diagnostics);
			taskModels = validated.models;
		}
	}
	const sourceStatus = resolveSourceStatus(input, notes);
	const guidanceMode = input.mode ?? "standard";
	const resolvedTask = resolveTask({
		task: input.task,
		taskModels,
		interpretationMode: taskModels.length ? "host-agent" : "deterministic-only"
	});
	const rcclRelevant = await resolveRcclRelevance(input, sourceStatus, resolvedTask, notes);
	const policy = resolveContractPolicy({
		sourceStatus,
		providedContracts: {
			...input.providedContracts,
			agentCapability: Boolean(agentCapabilityProfile),
			taskModel: taskModels.length > 0,
			semanticGovernanceGraph: Boolean(input.artifacts?.semanticGovernanceGraph)
		},
		agentCapabilityProfile,
		task: input.task,
		resolvedTask,
		mode: guidanceMode,
		rcclRelevant
	});
	const requiredContracts = [];
	if (policy.required.includes("agent-capability-profile")) {
		requiredContracts.push({
			kind: "agent-capability-profile",
			artifact: issuedCapabilityProfile.profileArtifact,
			contract: issuedCapabilityProfile.contract
		});
		notes.push("Agent capability profile requested so Runtime can select agentic contracts from concrete host capabilities.");
	}
	if (policy.required.includes("task-model")) {
		requiredContracts.push({
			kind: "task-model",
			artifact: issuedTaskModel.modelArtifact,
			contract: issuedTaskModel.contract
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
			compileInput: guidancePlanCompileInput(input, taskModels),
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
		},
		resolvedTask,
		contractDiagnostics
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
		const parsed = parseYaml$1(readFileSync(rcclPath, "utf-8"));
		if (!isRecord$1(parsed) || !Array.isArray(parsed.observations)) return "unverified";
		if (parsed.version !== "1.0" && parsed.version !== 1) {
			notes?.push("UNSUPPORTED_SCHEMA_VERSION: RCCL must use schema 1; re-run calibrate-repo-context.");
			return "unverified";
		}
		if (parsed.observations.length === 0) return "present";
		const observations = parsed.observations.filter(isRecord$1);
		if (observations.length !== parsed.observations.length) return "unverified";
		if (observations.some((observation) => {
			const verification = isRecord$1(observation.verification) ? observation.verification : null;
			if (!verification) return true;
			return !hasVerificationValue(verification, "evidence_status") || !hasVerificationValue(verification, "evidence_verified_count") || !hasVerificationValue(verification, "evidence_confidence") || !hasVerificationValue(verification, "induction_status") || !hasVerificationValue(verification, "induction_confidence") || !hasVerificationValue(verification, "checked_at") || !hasVerificationValue(verification, "disposition");
		})) return "unverified";
		return observations.some((observation) => {
			const lifecycle = isRecord$1(observation.lifecycle) ? observation.lifecycle : null;
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
function guidancePlanCompileInput(input, taskModels) {
	return {
		builtinRoot: input.builtinRoot,
		localAugmentPath: input.localAugmentPath,
		rcclPath: input.rcclPath,
		projectRoot: input.projectRoot,
		lockfilePath: input.lockfilePath,
		verificationPolicy: input.verificationPolicy,
		task: input.task,
		taskModels
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
	].filter((value) => Boolean(value)).map(normalizePath$1));
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
//#region src/ir/activation/public-adapter.ts
function projectIRActivationToPublic(bundle, decisions) {
	const directiveById = new Map(bundle.directives.map((directive) => [directive.id, directive]));
	const activatedDecisions = decisions.filter((decision) => decision.status === "activated");
	return {
		activationView: {
			selected_layers: bundle.sourceManifest.selectedLayers,
			activated: activatedDecisions.map(activationDecisionIRToPublicActivated),
			skipped: decisions.filter((decision) => decision.status === "skipped").map(activationDecisionIRToPublicSkipped)
		},
		activeDirectives: activatedDecisions.map((decision) => {
			const directive = directiveById.get(decision.directiveId);
			if (!directive) throw new Error(`Activated IR directive ${decision.directiveId} is missing from governance bundle`);
			return directiveIRToPublicDirective(directive);
		})
	};
}
function activationDecisionIRToPublicActivated(decision) {
	return {
		directive_id: decision.directiveId,
		layer_id: decision.layerId,
		source_file: decision.sourcePath ?? "",
		effective_prescription: decision.effectivePrescription,
		effective_weight: decision.effectiveWeight,
		effective_priority: {
			layer_rank: decision.priority.layerRank,
			prescription_rank: decision.priority.prescriptionRank,
			weight_rank: decision.priority.weightRank,
			context_rank: decision.priority.localOverrideRank
		},
		activation_reason: decision.note,
		override_applied: decision.localState.overrideApplied,
		augment_applied: decision.localState.augmentApplied
	};
}
function activationDecisionIRToPublicSkipped(decision) {
	return {
		directive_id: decision.directiveId,
		layer_id: decision.layerId,
		reason: toPublicSkippedReason(decision),
		note: decision.note
	};
}
function toPublicSkippedReason(decision) {
	if (decision.reason === "matched") throw new Error(`Activated IR directive ${decision.directiveId} cannot be projected as skipped`);
	return decision.reason;
}
function directiveIRToPublicDirective(directive) {
	return {
		id: directive.id,
		type: directive.kind,
		layer: directive.layer.id,
		scope: directive.scope,
		prescription: directive.prescription,
		weight: directive.weight,
		description: directive.body.description,
		rationale: directive.body.rationale,
		exceptions: directive.body.exceptions,
		examples: directive.body.examples,
		rccl_immune: directive.traits.rcclImmune,
		source: {
			kind: directive.source.kind === "local-playbook" ? "local-addition" : "builtin",
			layerId: directive.layer.id,
			filePath: directive.source.path ?? ""
		}
	};
}
//#endregion
//#region src/ir/ego/public-adapter.ts
function projectIREgoToPublic(activatedBundle, semanticMergeResult, taskIntent) {
	const modeByDirectiveId = new Map(semanticMergeResult.directive_modes.map((item) => [item.directive_id, item.execution_mode]));
	const decisionByDirectiveId = new Map(semanticMergeResult.directive_modes.map((item) => [item.directive_id, item]));
	const must_follow = activatedBundle.directives.filter((directive) => directive.kind !== "anti-pattern").sort((a, b) => compareDirectives(a, b, decisionByDirectiveId)).map((directive) => {
		const decision = decisionByDirectiveId.get(directive.id);
		const mergeContext = decision ? buildMergeContext(decision) : void 0;
		return {
			id: directive.id,
			statement: directive.body.description,
			rationale: directive.body.rationale,
			prescription: directive.prescription,
			exceptions: directive.body.exceptions,
			examples: directive.body.examples,
			execution_mode: modeByDirectiveId.get(directive.id) ?? "ambient",
			...mergeContext ? { merge_context: mergeContext } : {}
		};
	});
	const avoid = activatedBundle.observations.filter((observation) => observation.category === "anti-pattern").filter((observation) => observation.verification.disposition !== "demote-to-ambient").map((observation) => ({
		statement: observation.pattern,
		trigger: `anti-pattern:${observation.id}`
	}));
	const ambient = activatedBundle.observations.filter((observation) => observation.category !== "anti-pattern").map((observation) => {
		return `${observation.verification.disposition === "demote-to-ambient" ? "demoted" : "observed"}: ${observation.pattern}`;
	});
	return {
		taskIntent,
		guidance: {
			must_follow,
			avoid,
			context_tensions: semanticMergeResult.context_tensions,
			ambient
		}
	};
}
function buildMergeContext(decision) {
	if (!decision.relation_summaries.length) return decision.feedback_applied.length ? `feedback influenced ${decision.execution_mode}: ${decision.feedback_applied.join(", ")}` : void 0;
	const highPriority = decision.relation_summaries.find((relation) => relation.review_priority === "critical" || relation.review_priority === "high");
	if (!(decision.execution_mode !== decision.default_execution_mode) && !highPriority && !decision.feedback_applied.length) return void 0;
	const relation = highPriority ?? decision.relation_summaries[0];
	const feedback = decision.feedback_applied.length ? ` feedback=${decision.feedback_applied.join(", ")}` : "";
	return `${relation.relation} relation ${relation.relation_id} influenced ${decision.execution_mode}: ${relation.reason}${feedback}`;
}
function compareDirectives(a, b, decisionByDirectiveId) {
	const prescriptionScore = a.prescription === b.prescription ? 0 : a.prescription === "must" ? -1 : 1;
	if (prescriptionScore !== 0) return prescriptionScore;
	const layerScore = getDirectiveLayerRank(b.layer.id) - getDirectiveLayerRank(a.layer.id);
	if (layerScore !== 0) return layerScore;
	const weights = {
		low: 0,
		normal: 1,
		high: 2,
		critical: 3
	};
	const weightScore = weights[b.weight] - weights[a.weight];
	if (weightScore !== 0) return weightScore;
	const contextAppliedScore = (decisionByDirectiveId.get(b.id)?.context_applied.length ?? 0) - (decisionByDirectiveId.get(a.id)?.context_applied.length ?? 0);
	if (contextAppliedScore !== 0) return contextAppliedScore;
	return a.id.localeCompare(b.id);
}
//#endregion
//#region src/ir/ego/budget.ts
const EGO_BUDGET = {
	totalItems: 32,
	hardItems: 24,
	ambientItems: 6,
	examplesPerDirective: 1,
	serializedCharacters: 24e3
};
function applyEgoBudget(input) {
	const omissions = [];
	const must = input.guidance.must_follow.map((item) => ({
		...item,
		examples: item.examples.slice(0, EGO_BUDGET.examplesPerDirective)
	}));
	const hardMust = must.filter((item) => item.prescription === "must");
	const soft = must.filter((item) => item.prescription !== "must");
	const avoid = input.guidance.avoid;
	const hard = [...hardMust.map((item) => ({
		kind: "must",
		id: item.id,
		value: item,
		priority: `must:${item.execution_mode}`
	})), ...avoid.map((item) => ({
		kind: "avoid",
		id: item.trigger,
		value: item,
		priority: "avoid:verified-anti-pattern"
	}))];
	const selectedHard = hard.slice(0, EGO_BUDGET.hardItems);
	for (const item of hard.slice(EGO_BUDGET.hardItems)) omissions.push({
		id: item.id,
		reason: "hard-item-limit",
		original_priority: item.priority
	});
	let remaining = EGO_BUDGET.totalItems - selectedHard.length;
	const selectedSoft = soft.slice(0, Math.max(0, remaining));
	remaining -= selectedSoft.length;
	for (const item of soft.slice(selectedSoft.length)) omissions.push({
		id: item.id,
		reason: "total-item-limit",
		original_priority: `should:${item.execution_mode}`
	});
	const selectedTensions = input.guidance.context_tensions.slice(0, Math.max(0, remaining));
	remaining -= selectedTensions.length;
	for (const item of input.guidance.context_tensions.slice(selectedTensions.length)) omissions.push({
		id: `${item.directive_id}:tension`,
		reason: "total-item-limit",
		original_priority: `tension:${item.review_priority ?? "normal"}`
	});
	const ambientLimit = Math.min(EGO_BUDGET.ambientItems, Math.max(0, remaining));
	const selectedAmbient = input.guidance.ambient.slice(0, ambientLimit);
	for (let index = ambientLimit; index < input.guidance.ambient.length; index += 1) omissions.push({
		id: `ambient:${index}`,
		reason: index >= EGO_BUDGET.ambientItems ? "ambient-limit" : "total-item-limit",
		original_priority: "ambient"
	});
	const ego = {
		...input,
		guidance: {
			must_follow: [...selectedHard.filter((item) => item.kind === "must").map((item) => item.value), ...selectedSoft],
			avoid: selectedHard.filter((item) => item.kind === "avoid").map((item) => item.value),
			context_tensions: selectedTensions,
			ambient: selectedAmbient
		}
	};
	trimToCharacterBudget(ego, omissions);
	return {
		ego,
		exceeded: hard.length > EGO_BUDGET.hardItems || hardPayloadLength(hard) > EGO_BUDGET.serializedCharacters,
		omissions,
		serializedCharacters: JSON.stringify(ego).length
	};
}
function trimToCharacterBudget(ego, omissions) {
	while (JSON.stringify(ego).length > EGO_BUDGET.serializedCharacters) {
		if (ego.guidance.ambient.length) {
			const index = ego.guidance.ambient.length - 1;
			ego.guidance.ambient.pop();
			omissions.push({
				id: `ambient:${index}`,
				reason: "character-limit",
				original_priority: "ambient"
			});
			continue;
		}
		const softIndex = findLastIndex(ego.guidance.must_follow, (item) => item.prescription === "should");
		if (softIndex >= 0) {
			const [item] = ego.guidance.must_follow.splice(softIndex, 1);
			omissions.push({
				id: item.id,
				reason: "character-limit",
				original_priority: `should:${item.execution_mode}`
			});
			continue;
		}
		if (ego.guidance.context_tensions.length) {
			const item = ego.guidance.context_tensions.pop();
			omissions.push({
				id: `${item.directive_id}:tension`,
				reason: "character-limit",
				original_priority: `tension:${item.review_priority ?? "normal"}`
			});
			continue;
		}
		const item = ego.guidance.must_follow.pop();
		if (item) {
			omissions.push({
				id: item.id,
				reason: "character-limit",
				original_priority: `must:${item.execution_mode}`
			});
			continue;
		}
		const avoid = ego.guidance.avoid.pop();
		if (avoid) {
			omissions.push({
				id: avoid.trigger,
				reason: "character-limit",
				original_priority: "avoid:verified-anti-pattern"
			});
			continue;
		}
		break;
	}
}
function hardPayloadLength(hard) {
	return JSON.stringify(hard.map((item) => item.value)).length;
}
function findLastIndex(items, predicate) {
	for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
	return -1;
}
const CONSTRAINT_NARROW_SCOPE = "prefer narrow change scope";
const AVOID_BROAD_REWRITES = "broad rewrites";
const AUTHORITATIVE_CONTEXT_SOURCES = new Set([
	"explicit",
	"host-agent",
	"assistive-ai",
	"repo-default",
	"derived"
]);
function applyContextExecutionPolicy(input) {
	let decision = {
		...input.defaultDecision,
		contextApplied: [...input.defaultDecision.contextApplied],
		contextRulesApplied: [...input.defaultDecision.contextRulesApplied]
	};
	const hasTension = input.relations.some((relation) => relation.adjudication.finalRelation === "tension" && relation.impact === "execution-mode");
	for (const rule of CONTEXT_EXECUTION_RULES) {
		const ruleInput = {
			directive: input.directive,
			relations: input.relations,
			defaultDecision: input.defaultDecision,
			decision,
			context: input.context,
			provenance: input.provenance ?? [],
			hasTension
		};
		if (!rule.matches(ruleInput)) continue;
		const result = rule.apply(ruleInput);
		decision = {
			...decision,
			mode: result.mode ?? decision.mode,
			basis: result.basis ?? decision.basis,
			reason: `${decision.reason} ${result.reasonSuffix}`,
			contextApplied: unique([...decision.contextApplied, ...result.contextApplied]),
			contextRulesApplied: unique([...decision.contextRulesApplied, rule.id])
		};
	}
	return {
		...decision,
		contextApplied: unique(decision.contextApplied),
		contextRulesApplied: unique(decision.contextRulesApplied)
	};
}
function contextInfluenceEffect(context, mode) {
	if (context.startsWith("optimization_target:")) return `adjusted execution to ${mode} for the task optimization target`;
	if (context.startsWith("hard_constraints:")) return `adjusted execution to ${mode} for explicit task constraints`;
	if (context.startsWith("allowed_tradeoffs:")) return `adjusted execution to ${mode} for allowed task tradeoffs`;
	if (context.startsWith("avoid:")) return `adjusted execution to ${mode} for task avoidance guidance`;
	if (context.startsWith("risk_level:")) return `raised execution or review attention to ${mode} for task risk`;
	if (context.startsWith("scope_size:")) return `adjusted execution to ${mode} for task scope size`;
	if (context.startsWith("compatibility_requirement:")) return `adjusted execution to ${mode} for compatibility requirements`;
	if (context.startsWith("interface_sensitivity:")) return `raised review attention while resolving execution to ${mode} for sensitive interfaces`;
	if (context.startsWith("refactor_tolerance:")) return `adjusted execution to ${mode} for refactor tolerance`;
	if (context.startsWith("migration_phase:")) return `adjusted execution to ${mode} for migration phase`;
	if (context.startsWith("review_goal:")) return `raised review attention while resolving execution to ${mode} for review goal`;
	if (context.startsWith("feedback:")) return `recorded feedback influence while resolving execution to ${mode}`;
	return `adjusted execution to ${mode} for task context`;
}
function contextReviewPriorityBoost(contextApplied) {
	if (contextApplied.includes("risk_level:critical") || contextApplied.includes("interface_sensitivity:auth-security")) return "critical";
	if (contextApplied.includes("risk_level:high") || contextApplied.some((context) => context.startsWith("compatibility_requirement:") && !context.endsWith(":none")) || contextApplied.some((context) => context.startsWith("interface_sensitivity:") && !context.endsWith(":internal") && !context.endsWith(":unknown")) || contextApplied.includes("migration_phase:dual-run") || contextApplied.includes("migration_phase:cutover")) return "high";
	return null;
}
const CONTEXT_EXECUTION_RULES = [
	{
		id: "context.safety.promote-compatible-should",
		field: "optimization_target",
		effect: "mode-adjustment",
		matches: (input) => hasAuthoritativeContextField(input, "optimization_target") && input.context.optimization_target === "safety" && input.directive.prescription === "should" && input.defaultDecision.mode === "ambient" && input.hasTension && isCompatibilitySensitiveDirective(input.directive),
		apply: () => ({
			mode: "deviation-noted",
			basis: "task-context",
			reasonSuffix: "Safety-focused context promotes compatibility-sensitive guidance from ambient to deviation-noted when repository reality conflicts with it.",
			contextApplied: ["optimization_target:safety"]
		})
	},
	{
		id: "context.safety.preserve-must-deviation",
		field: "optimization_target",
		effect: "review-priority",
		matches: (input) => hasAuthoritativeContextField(input, "optimization_target") && input.context.optimization_target === "safety" && input.directive.prescription === "must" && input.defaultDecision.mode === "deviation-noted",
		apply: () => ({
			basis: "task-context",
			reasonSuffix: "Safety-focused context preserves stricter enforcement intent even though repository compatibility still requires a deviation-noted posture.",
			contextApplied: ["optimization_target:safety"]
		})
	},
	{
		id: "context.compatibility.must-with-tension",
		field: "compatibility_requirement",
		effect: "mode-adjustment",
		matches: (input) => (hasAuthoritativeConstraint(input, "hard_constraints", [
			"preserve compatibility",
			"avoid breaking changes",
			"preserve public api"
		]) || hasAuthoritativeContextField(input, "compatibility_requirement") && hasCompatibilityRequirement(input.context)) && input.directive.prescription === "must" && input.decision.mode === "enforce" && input.hasTension,
		apply: (input) => ({
			mode: "deviation-noted",
			basis: "task-context",
			reasonSuffix: "Explicit compatibility constraints shift execution to deviation-noted because legacy or migration realities must be preserved at touched interfaces.",
			contextApplied: [hasAuthoritativeContextField(input, "compatibility_requirement") && input.context.compatibility_requirement !== "none" ? `compatibility_requirement:${input.context.compatibility_requirement}` : "hard_constraints:compatibility"]
		})
	},
	{
		id: "context.scope.keep-broad-guidance-ambient",
		field: "scope_size",
		effect: "ambienting",
		matches: (input) => (hasAuthoritativeConstraint(input, "allowed_tradeoffs", ["prefer narrow change scope"]) || input.context.scope_size === "single-file" && hasAuthoritativeScopeEvidence(input) || hasAuthoritativeContextField(input, "refactor_tolerance") && (input.context.refactor_tolerance === "none" || input.context.refactor_tolerance === "local-only")) && input.directive.prescription === "should" && input.directive.traits.broadScope,
		apply: (input) => ({
			mode: "ambient",
			basis: "task-context",
			reasonSuffix: "Narrow-scope tradeoff guidance keeps broad architectural guidance ambient for this task.",
			contextApplied: [
				...hasAuthoritativeConstraint(input, "allowed_tradeoffs", ["prefer narrow change scope"]) ? [`allowed_tradeoffs:${CONSTRAINT_NARROW_SCOPE}`] : [],
				...input.context.scope_size === "single-file" && hasAuthoritativeScopeEvidence(input) ? ["scope_size:single-file"] : [],
				...hasAuthoritativeContextField(input, "refactor_tolerance") && (input.context.refactor_tolerance === "none" || input.context.refactor_tolerance === "local-only") ? [`refactor_tolerance:${input.context.refactor_tolerance}`] : []
			]
		})
	},
	{
		id: "context.avoid.keep-broad-rewrite-ambient",
		field: "avoid",
		effect: "ambienting",
		matches: (input) => hasAuthoritativeConstraint(input, "avoid", ["broad rewrites", "overengineering"]) && input.directive.prescription === "should" && input.directive.traits.broadScope,
		apply: () => ({
			mode: "ambient",
			basis: "task-context",
			reasonSuffix: "Avoiding broad rewrites or overengineering keeps expansive guidance ambient unless it is already a must-level requirement.",
			contextApplied: [`avoid:${AVOID_BROAD_REWRITES}`]
		})
	},
	{
		id: "context.compatibility.promote-compatible-should",
		field: "compatibility_requirement",
		effect: "mode-adjustment",
		matches: (input) => hasAuthoritativeContextField(input, "compatibility_requirement") && hasCompatibilityRequirement(input.context) && input.directive.prescription === "should" && input.defaultDecision.mode === "ambient" && input.hasTension && isCompatibilitySensitiveDirective(input.directive),
		apply: (input) => ({
			mode: "deviation-noted",
			basis: "task-context",
			reasonSuffix: "Compatibility requirements promote compatible should-level guidance to deviation-noted when verified repository tension exists.",
			contextApplied: [`compatibility_requirement:${input.context.compatibility_requirement}`]
		})
	},
	{
		id: "context.risk.raise-review-attention",
		field: "risk_level",
		effect: "review-priority",
		matches: (input) => hasAuthoritativeContextField(input, "risk_level") && isHighRisk(input.context) && (input.directive.prescription === "must" || input.directive.traits.safetyCritical || input.decision.mode === "deviation-noted") && input.decision.mode !== "suppress",
		apply: ({ context, decision }) => ({
			basis: decision.basis === "prescription" ? "task-context" : decision.basis,
			reasonSuffix: "High-risk context keeps this directive prominent for execution and review.",
			contextApplied: [`risk_level:${context.risk_level}`]
		})
	},
	{
		id: "context.interface.raise-review-attention",
		field: "interface_sensitivity",
		effect: "review-priority",
		matches: (input) => hasAuthoritativeContextField(input, "interface_sensitivity") && isSensitiveInterface(input.context) && (input.directive.prescription === "must" || isCompatibilitySensitiveDirective(input.directive)) && input.decision.mode !== "suppress",
		apply: ({ context, decision }) => ({
			basis: decision.basis === "prescription" ? "task-context" : decision.basis,
			reasonSuffix: "Sensitive interface context raises review attention for this directive.",
			contextApplied: [`interface_sensitivity:${context.interface_sensitivity}`]
		})
	},
	{
		id: "context.migration.keep-boundary-tension-explicit",
		field: "migration_phase",
		effect: "mode-adjustment",
		matches: (input) => hasAuthoritativeContextField(input, "migration_phase") && isMigrationExecutionPhase(input.context) && input.directive.traits.migrationSensitive && input.hasTension && input.decision.mode !== "suppress",
		apply: ({ context, directive }) => ({
			mode: directive.prescription === "must" ? "deviation-noted" : void 0,
			basis: "task-context",
			reasonSuffix: "Migration phase context keeps migration-boundary tension explicit for this task.",
			contextApplied: [`migration_phase:${context.migration_phase}`]
		})
	}
];
function hasAuthoritativeContextField(input, field) {
	return isAuthoritativeProvenance(findProvenance(input.provenance, `context.${field}`));
}
function hasAuthoritativeConstraint(input, field, expected) {
	return hasAuthoritativeContextField(input, field) && hasConstraint(input.context[field], expected);
}
function hasAuthoritativeScopeEvidence(input) {
	return hasAuthoritativeContextField(input, "scope_size") || isAuthoritativeProvenance(findProvenance(input.provenance, "intent.target_file")) || isAuthoritativeProvenance(findProvenance(input.provenance, "intent.changed_files"));
}
function findProvenance(provenance, field) {
	return provenance.find((item) => item.field === field);
}
function isAuthoritativeProvenance(provenance) {
	return provenance !== void 0 && provenance.confidence > 0 && AUTHORITATIVE_CONTEXT_SOURCES.has(provenance.source);
}
function isCompatibilitySensitiveDirective(directive) {
	return directive.traits.compatibilitySensitive || directive.traits.rcclImmune || directive.prescription === "must";
}
function hasCompatibilityRequirement(context) {
	return context.compatibility_requirement === "preserve-api" || context.compatibility_requirement === "preserve-behavior" || context.compatibility_requirement === "migration-compatible";
}
function isHighRisk(context) {
	return context.risk_level === "high" || context.risk_level === "critical";
}
function isSensitiveInterface(context) {
	return context.interface_sensitivity === "public-api" || context.interface_sensitivity === "persistence" || context.interface_sensitivity === "external-integration" || context.interface_sensitivity === "auth-security";
}
function isMigrationExecutionPhase(context) {
	return context.migration_phase === "dual-run" || context.migration_phase === "cutover";
}
//#endregion
//#region src/ir/execution/resolve-execution.ts
function resolveExecutionDecisionsIR(bundle, relations) {
	const relationsByDirective = groupEffectiveRelations(relations);
	return bundle.directives.map((directive) => {
		const linkedRelations = relationsByDirective.get(directive.id) ?? [];
		const defaultDecision = deriveDirectiveDecision(directive, linkedRelations);
		const contextDecision = applyContextAdjustments(directive, linkedRelations, defaultDecision, bundle.task.context, bundle.task.provenance);
		const feedbackEffects = feedbackSignalsForDirective(bundle, directive, linkedRelations);
		const decision = applyFeedbackAdjustments(directive, contextDecision, feedbackEffects);
		return {
			directiveId: directive.id,
			mode: decision.mode,
			defaultMode: defaultDecision.mode,
			basis: decision.basis,
			relationIds: linkedRelations.map((relation) => relation.id),
			contextApplied: decision.contextApplied,
			contextRulesApplied: decision.contextRulesApplied,
			feedbackApplied: feedbackEffects.labels,
			reason: decision.reason
		};
	});
}
function groupEffectiveRelations(relations) {
	const grouped = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		if (relation.adjudication.status === "rejected") continue;
		if (relation.adjudication.finalRelation === "unrelated") continue;
		const current = grouped.get(relation.directiveId) ?? [];
		current.push(relation);
		grouped.set(relation.directiveId, current);
	}
	return grouped;
}
function deriveDirectiveDecision(directive, relations) {
	if (directive.kind === "anti-pattern") return {
		mode: "suppress",
		reason: "directive is classified as an anti-pattern and should suppress matching behavior",
		basis: "anti-pattern",
		contextApplied: [],
		contextRulesApplied: []
	};
	if (directive.traits.rcclImmune) return {
		mode: "enforce",
		reason: "directive is marked rccl_immune and should not be downgraded by repository observations",
		basis: "verification",
		contextApplied: [],
		contextRulesApplied: []
	};
	const hasTension = relations.some((relation) => relation.adjudication.finalRelation === "tension" && relation.impact === "execution-mode");
	if (relations.some((relation) => relation.adjudication.finalRelation === "suppress")) return {
		mode: "suppress",
		reason: "anti-pattern observations materially overlap this directive and should suppress matching behavior",
		basis: "anti-pattern",
		contextApplied: [],
		contextRulesApplied: []
	};
	const graphIntentDecision = resolveGraphExecutionIntent(directive, relations);
	if (graphIntentDecision) return graphIntentDecision;
	if (!hasTension) return {
		mode: directive.prescription === "must" ? "enforce" : "ambient",
		reason: "no strong repository tension matched this directive, so default execution behavior applies",
		basis: "prescription",
		contextApplied: [],
		contextRulesApplied: []
	};
	return {
		mode: directive.prescription === "must" ? "deviation-noted" : "ambient",
		reason: "repository observations materially overlap this directive, so execution is adjusted to reflect current repository reality",
		basis: "governance-graph",
		contextApplied: [],
		contextRulesApplied: []
	};
}
function resolveGraphExecutionIntent(directive, relations) {
	const candidates = relations.filter((relation) => relation.adjudication.status === "accepted" && relation.impact === "execution-mode" && relation.executionIntent != null && relation.executionIntent !== "no-change").sort((left, right) => executionIntentRank(right.executionIntent) - executionIntentRank(left.executionIntent));
	for (const selected of candidates) {
		const decision = resolveGraphExecutionIntentCandidate(directive, selected, relations);
		if (decision) return decision;
	}
	return null;
}
function resolveGraphExecutionIntentCandidate(directive, selected, relations) {
	if (!selected.executionIntent) return null;
	if (selected.executionIntent === "suppress") {
		if (selected.adjudication.finalRelation !== "suppress") return null;
		return {
			mode: "suppress",
			reason: `semantic governance graph requested suppress execution for ${directive.id}, and Runtime accepted a suppress relation`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:suppress"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "deviation-noted") {
		if (selected.adjudication.finalRelation !== "tension") return null;
		return {
			mode: "deviation-noted",
			reason: `semantic governance graph requested deviation-noted execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:deviation-noted"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "ambient") {
		if (selected.adjudication.finalRelation !== "ambient-only" && selected.adjudication.finalRelation !== "tension") return null;
		if (directive.prescription === "must" || directive.weight === "critical") {
			if (selected.adjudication.finalRelation !== "tension") return null;
			return {
				mode: "deviation-noted",
				reason: `semantic governance graph requested ambient execution for must-or-critical ${directive.id}; Runtime floors accepted tension to deviation-noted instead of silently weakening protected guidance`,
				basis: "governance-graph",
				contextApplied: ["execution_intent:ambient", "execution_intent_floor:must-deviation-noted"],
				contextRulesApplied: []
			};
		}
		return {
			mode: "ambient",
			reason: `semantic governance graph requested ambient execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:ambient"],
			contextRulesApplied: []
		};
	}
	if (selected.executionIntent === "enforce") {
		if (selected.adjudication.finalRelation !== "reinforce") return null;
		if (relations.some((relation) => relation.adjudication.finalRelation === "tension" || relation.adjudication.finalRelation === "suppress")) return null;
		return {
			mode: "enforce",
			reason: `semantic governance graph requested enforce execution for ${directive.id}, and Runtime accepted the execution-mode relation ${selected.id}`,
			basis: "governance-graph",
			contextApplied: ["execution_intent:enforce"],
			contextRulesApplied: []
		};
	}
	return null;
}
function executionIntentRank(intent) {
	switch (intent) {
		case "suppress": return 5;
		case "deviation-noted": return 4;
		case "enforce": return 3;
		case "ambient": return 2;
		case "no-change": return 1;
		default: return 0;
	}
}
function applyContextAdjustments(directive, relations, defaultDecision, context, provenance) {
	return applyContextExecutionPolicy({
		directive,
		relations,
		defaultDecision,
		context,
		provenance
	});
}
function applyFeedbackAdjustments(directive, decision, effects) {
	let result = {
		...decision,
		contextApplied: [...decision.contextApplied],
		contextRulesApplied: [...decision.contextRulesApplied]
	};
	if (effects.recurringTension && directive.prescription === "must") result = {
		...result,
		reason: `${result.reason} Recurring lockfile tension keeps this must-level directive visible for review, but feedback alone does not alter execution mode without a host semantic graph or explicit task context.`
	};
	if (effects.frequentlyIgnored && directive.prescription === "should") result = {
		...result,
		mode: "ambient",
		basis: "feedback",
		reason: `${result.reason} Lockfile feedback shows this should-level directive is frequently ignored, so it remains ambient unless stronger verified relations require attention.`
	};
	if (effects.frequentlyIgnoredMust) result = {
		...result,
		basis: result.basis === "prescription" ? "feedback" : result.basis,
		reason: `${result.reason} Lockfile feedback shows a must-level directive was frequently ignored; execution is not weakened, but review focus should verify the outcome.`
	};
	if (effects.noisyObservation) result = {
		...result,
		reason: `${result.reason} Feedback marks one linked observation as noisy, so Runtime keeps the relation reviewable and still relies on RCCL verification before changing execution.`
	};
	return result;
}
function feedbackSignalsForDirective(bundle, directive, relations) {
	const labels = [];
	const directiveSignal = bundle.feedback.directiveSignals.find((signal) => signal.directiveId === directive.id);
	const frequentlyIgnored = directiveSignal !== void 0 && directiveSignal.ignored >= SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredMinIgnored && directiveSignal.followRate < SEMANTIC_RELATION_POLICY.feedback.frequentlyIgnoredFollowRate;
	const recurringTension = relations.some((relation) => relation.basis.feedback && relation.adjudication.status !== "rejected" && relation.adjudication.finalRelation === "tension");
	const noisyObservation = relations.some((relation) => {
		const signal = bundle.feedback.observationSignals.find((item) => item.observationId === relation.observationId);
		return signal !== void 0 && signal.relationCount >= SEMANTIC_RELATION_POLICY.feedback.noisyObservationRelationCount && signal.lastDisposition === "demote-to-ambient";
	});
	if (frequentlyIgnored) labels.push("feedback:frequently-ignored");
	if (frequentlyIgnored && directive.prescription === "must") labels.push("feedback:frequently-ignored-must-review");
	if (directiveSignal?.trend === "declining") labels.push("feedback:declining");
	if (directiveSignal?.signalConfidence === "user-corrected") labels.push("feedback:user-corrected");
	if (recurringTension) labels.push("feedback:recurring-tension");
	if (noisyObservation) labels.push("feedback:noisy-observation");
	return {
		labels: unique(labels),
		frequentlyIgnored,
		frequentlyIgnoredMust: frequentlyIgnored && directive.prescription === "must",
		recurringTension,
		noisyObservation
	};
}
//#endregion
//#region src/ir/relations/adjudicate-relations.ts
function adjudicateSemanticRelations(relations, bundle) {
	const directiveById = new Map(bundle.directives.map((directive) => [directive.id, directive]));
	const observationById = new Map(bundle.observations.map((observation) => [observation.id, observation]));
	return relations.map((relation) => {
		const directive = directiveById.get(relation.directiveId);
		const observation = observationById.get(relation.observationId);
		if (!directive) return rejectRelation(relation, "directive is missing from the IR bundle");
		if (!observation) return rejectRelation(relation, "observation is missing from the IR bundle");
		if (observation.lifecycle.status === "superseded") return rejectRelation(relation, "observation lifecycle is superseded and must not influence current execution");
		if (observation.lifecycle.status === "stale") return downgradeRelation(relation, "observation lifecycle is stale, so it can only provide ambient context");
		if (observation.verification.disposition === "demote-to-ambient") return downgradeRelation(relation, "verify gate demoted the observation, so it can only provide ambient context");
		switch (relation.relation) {
			case "suppress": return adjudicateSuppressRelation(relation, {
				observationAntiPattern: observation.traits.antiPattern,
				observationVerified: observation.verification.evidenceStatus === "verified"
			});
			case "tension":
			case "reinforce": return adjudicateDirectionalRelation(relation);
			case "ambient-only": return acceptRelation(relation, "ambient-only relation is valid contextual input");
			case "unrelated": return rejectRelation(relation, "proposal did not establish a semantic relation");
		}
	});
}
function adjudicateSuppressRelation(relation, context) {
	if (!relation.basis.scope) return rejectRelation(relation, "suppression is outside the task scope");
	if (!hasSemanticBasis(relation)) return rejectRelation(relation, "suppression lacks semantic basis");
	if (!context.observationAntiPattern || !context.observationVerified) return rejectRelation(relation, "suppression requires a statically verified anti-pattern observation under Runtime policy");
	if (!relation.basis.evidence) return downgradeRelation(relation, "suppression lacks verified observation evidence");
	return acceptRelation(relation, acceptedReason(relation, "suppression"));
}
function adjudicateDirectionalRelation(relation) {
	if (!relation.basis.scope) return rejectRelation(relation, "directional relation is outside the task scope");
	if (!hasSemanticBasis(relation)) return rejectRelation(relation, "directional relation lacks semantic basis");
	if (!relation.basis.evidence) return downgradeRelation(relation, "directional relation lacks verified observation evidence");
	return acceptRelation(relation, acceptedReason(relation, relation.relation));
}
function hasSemanticBasis(relation) {
	return relation.basis.hostReasoning || relation.basis.feedback || relation.basis.semanticKey || relation.basis.category || relation.signals.some((signal) => signal.kind === "host-proposal" || signal.kind === "semantic-key");
}
function acceptedReason(relation, label) {
	return `${label} relation accepted from ${relation.proposedBy === "multi-source" ? "merged semantic relation sources" : relation.proposedBy} after scope, lifecycle, and verification adjudication`;
}
function acceptRelation(relation, reason) {
	return {
		...relation,
		adjudication: {
			status: "accepted",
			finalRelation: relation.relation,
			reason
		}
	};
}
function downgradeRelation(relation, reason) {
	return {
		...relation,
		adjudication: {
			status: "downgraded",
			finalRelation: "ambient-only",
			reason
		}
	};
}
function rejectRelation(relation, reason) {
	return {
		...relation,
		adjudication: {
			status: "rejected",
			finalRelation: "unrelated",
			reason
		}
	};
}
//#endregion
//#region src/ir/relations/propose-feedback-relations.ts
function proposeFeedbackRelations(bundle) {
	const directiveById = new Map(bundle.directives.map((directive) => [directive.id, directive]));
	const observationById = new Map(bundle.observations.map((observation) => [observation.id, observation]));
	const observationFeedbackById = new Map(bundle.feedback.observationSignals.map((signal) => [signal.observationId, signal]));
	return bundle.feedback.tensionSignals.flatMap((signal) => {
		if (signal.seenCount < SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount) return [];
		const directive = directiveById.get(signal.directiveId);
		const observation = observationById.get(signal.observationId);
		if (!directive || !observation) return [];
		if (!observationFeedbackSupportsInfluence(observation, observationFeedbackById.get(observation.id))) return [];
		if (!hasVerifiedEvidence$1(observation)) return [];
		const taskScoped = scopeMatchesTask$1(directive.scope.path, bundle.task) && scopeMatchesTask$1(observation.scope.path, bundle.task);
		if (!taskScoped) return [];
		return [toFeedbackTensionRelation(signal, directive, observation, bundle.task, taskScoped)];
	});
}
function toFeedbackTensionRelation(signal, directive, observation, task, taskScoped) {
	const signals = buildFeedbackSignals(signal, observation, taskScoped);
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"semantic-relation-ir",
			"feedback",
			signal.tensionKey,
			signal.seenCount,
			directive.id,
			observation.id,
			signals
		]),
		directiveId: directive.id,
		observationId: observation.id,
		proposedBy: "feedback",
		relation: "tension",
		conflictClass: inferFeedbackConflictClass(observation),
		confidence: feedbackConfidence(signal.seenCount),
		basis: {
			scope: taskScoped,
			semanticKey: false,
			category: false,
			evidence: true,
			hostReasoning: false,
			feedback: true
		},
		signals,
		evidenceRefs: observationEvidenceRefs$1(observation),
		reasoningSummary: `lockfile feedback recorded recurring tension ${signal.tensionKey} across ${signal.seenCount} task(s) for ${task.operation} work`,
		impact: "review-focus",
		reviewPriority: directive.prescription === "must" ? "high" : "normal",
		mergeIntent: "Treat the recurring lockfile tension as a reviewable repository reality, without bypassing RCCL verification.",
		adjudication: {
			status: "accepted",
			finalRelation: "tension",
			reason: "initial feedback relation proposal before adjudication"
		}
	};
}
function observationFeedbackSupportsInfluence(observation, signal) {
	if (!signal) return false;
	if (signal.lastDisposition === "demote-to-ambient") return false;
	if (signal.lastLifecycleStatus !== "active") return false;
	if (observation.lifecycle.status !== "active") return false;
	const currentFingerprint = observation.lifecycle.contentFingerprint;
	if (currentFingerprint && signal.lastContentFingerprint !== currentFingerprint) return false;
	return true;
}
function buildFeedbackSignals(signal, observation, taskScoped) {
	return [
		{
			kind: "feedback",
			strength: signal.seenCount >= SEMANTIC_RELATION_POLICY.feedback.recurringTensionSeenCount + 2 ? "strong" : "moderate",
			direction: "tension",
			reason: `lockfile tension ${signal.tensionKey} has appeared ${signal.seenCount} time(s)`
		},
		{
			kind: "scope",
			strength: taskScoped ? "strong" : "weak",
			direction: taskScoped ? "neutral" : "ambient",
			reason: taskScoped ? "recurring feedback tension matches the current task scope" : "recurring feedback tension is outside the current task scope"
		},
		{
			kind: "verification",
			strength: verificationStrength$1(observation),
			direction: observation.verification.disposition === "demote-to-ambient" ? "ambient" : "neutral",
			reason: `RCCL verification disposition is ${observation.verification.disposition}`
		},
		{
			kind: "lifecycle",
			strength: observation.lifecycle.status === "active" ? "strong" : "weak",
			direction: observation.lifecycle.status === "active" ? "neutral" : "ambient",
			reason: `RCCL lifecycle status is ${observation.lifecycle.status}`
		}
	];
}
function feedbackConfidence(seenCount) {
	return Number(Math.min(.9, .62 + seenCount * .07).toFixed(2));
}
function inferFeedbackConflictClass(observation) {
	if (observation.traits.migrationBoundary) return "migration-tension";
	if (observation.traits.compatibilityBoundary || observation.traits.legacy) return "legacy-interface";
	if (observation.category === "style") return "style-drift";
	if (observation.category === "architecture") return "architecture-drift";
	return "local-deviation";
}
function hasVerifiedEvidence$1(observation) {
	return observation.verification.evidenceVerifiedCount > 0 || observation.verification.evidenceStatus === "verified" || observation.verification.evidenceStatus === "partial";
}
function verificationStrength$1(observation) {
	if (observation.verification.evidenceStatus === "verified" || observation.verification.evidenceConfidence >= .8) return "strong";
	if (observation.verification.evidenceStatus === "partial" || observation.verification.evidenceConfidence >= .5) return "moderate";
	return "weak";
}
function observationEvidenceRefs$1(observation) {
	return observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`);
}
function scopeMatchesTask$1(scope, task) {
	if (task.targets.length === 0) return true;
	return task.targets.some((target) => pathMatchesScope(target.path, scope));
}
//#endregion
//#region src/ir/relations/propose-relations.ts
function proposeSemanticRelations(bundle) {
	return [
		...proposeRuntimeStructuralRelations(bundle),
		...proposeHostGovernanceGraphRelations(bundle),
		...proposeFeedbackRelations(bundle)
	];
}
function proposeRuntimeStructuralRelations(bundle) {
	return bundle.directives.flatMap((directive) => bundle.observations.flatMap((observation) => {
		const relation = proposeRuntimeStructuralRelation(directive, observation, bundle.task);
		return relation ? [relation] : [];
	}));
}
function proposeRuntimeStructuralRelation(directive, observation, task) {
	if (observation.lifecycle.status === "superseded") return null;
	const taskScoped = scopeMatchesTask(directive.scope.path, task) && scopeMatchesTask(observation.scope.path, task);
	const semanticKey = semanticKeysOverlap(directive.semanticKey, observation.semanticKey);
	if (!semanticKey) return null;
	const evidence = hasVerifiedEvidence(observation);
	if (!taskScoped || !evidence) return null;
	const relation = "ambient-only";
	const signals = buildRuntimeSignals(observation, taskScoped, semanticKey, relation);
	const conflictClass = inferConflictClass(directive, observation, relation);
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"semantic-relation-ir",
			"runtime-structural",
			directive.id,
			observation.id,
			relation,
			signals
		]),
		directiveId: directive.id,
		observationId: observation.id,
		proposedBy: "runtime-structural",
		relation,
		...conflictClass ? { conflictClass } : {},
		confidence: runtimeRelationConfidence(observation),
		basis: {
			scope: taskScoped,
			semanticKey,
			category: false,
			evidence,
			hostReasoning: false,
			feedback: false
		},
		signals,
		evidenceRefs: observationEvidenceRefs(observation),
		reasoningSummary: summarizeRuntimeProposal(relation),
		impact: defaultImpact(relation),
		reviewPriority: defaultReviewPriority(directive, relation),
		adjudication: {
			status: "accepted",
			finalRelation: relation,
			reason: "initial runtime structural context shortlist before adjudication"
		}
	};
}
function proposeHostGovernanceGraphRelations(bundle) {
	const directiveIds = new Set(bundle.directives.map((directive) => directive.id));
	const observationIds = new Set(bundle.observations.map((observation) => observation.id));
	return bundle.hostProposals.flatMap((proposal) => {
		if (proposal.kind !== "semantic-governance-graph") return [];
		return graphPayload(proposal).edges.flatMap((edge) => {
			if (!directiveIds.has(edge.directive_id) || !observationIds.has(edge.observation_id)) return [];
			if (!Number.isFinite(edge.confidence) || edge.confidence < .5) return [];
			return [toHostGraphRelationIR(proposal, edge, bundle)];
		});
	});
}
function graphPayload(proposal) {
	const payload = proposal.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { edges: [] };
	const edges = payload.edges;
	if (!Array.isArray(edges)) return { edges: [] };
	return { edges: edges.filter(isGraphEdge) };
}
function isGraphEdge(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const edge = value;
	return typeof edge.directive_id === "string" && typeof edge.observation_id === "string" && isRelation(edge.relation) && typeof edge.confidence === "number" && typeof edge.reason === "string" && Array.isArray(edge.evidence_refs);
}
function toHostGraphRelationIR(proposal, edge, bundle) {
	const directive = requiredDirective(bundle.directives, edge.directive_id);
	const observation = requiredObservation(bundle.observations, edge.observation_id);
	const taskScoped = scopeMatchesTask(directive.scope.path, bundle.task) && scopeMatchesTask(observation.scope.path, bundle.task);
	const relation = edge.execution_intent === "suppress" ? "suppress" : edge.relation;
	const signals = buildHostGraphSignals(edge, observation, taskScoped, relation);
	const conflictClass = edge.conflict_class ?? inferConflictClass(directive, observation, relation);
	const impact = edge.impact ?? defaultImpact(relation);
	const reviewPriority = edge.review_priority ?? defaultReviewPriority(directive, relation);
	const evidenceRefs = edge.evidence_refs.map((ref) => ref.ref);
	return {
		irVersion: GOVERNANCE_IR_VERSION,
		id: stableHash([
			"semantic-relation-ir",
			proposal.source.id,
			edge.directive_id,
			edge.observation_id,
			relation,
			edge.reason,
			edge.evidence_refs,
			edge.execution_intent,
			edge.group_id
		]),
		directiveId: edge.directive_id,
		observationId: edge.observation_id,
		proposedBy: "host-agent",
		relation,
		...conflictClass ? { conflictClass } : {},
		confidence: clampConfidence(edge.confidence),
		basis: {
			scope: taskScoped,
			semanticKey: false,
			category: false,
			evidence: hasVerifiedEvidence(observation),
			hostReasoning: true,
			feedback: false
		},
		signals,
		evidenceRefs,
		reasoningSummary: edge.reason.trim(),
		impact,
		reviewPriority,
		...edge.execution_intent ? { executionIntent: edge.execution_intent } : {},
		...edge.merge_intent ? { mergeIntent: edge.merge_intent.slice(0, 360) } : {},
		...edge.group_id ? { groupId: edge.group_id.slice(0, 120) } : {},
		adjudication: {
			status: "accepted",
			finalRelation: relation,
			reason: "initial semantic governance graph edge before Runtime adjudication"
		}
	};
}
function requiredDirective(directives, id) {
	const directive = directives.find((item) => item.id === id);
	if (!directive) throw new Error(`Missing directive for semantic graph edge: ${id}`);
	return directive;
}
function requiredObservation(observations, id) {
	const observation = observations.find((item) => item.id === id);
	if (!observation) throw new Error(`Missing observation for semantic graph edge: ${id}`);
	return observation;
}
function buildHostGraphSignals(edge, observation, taskScoped, relation) {
	return [
		{
			kind: "host-proposal",
			strength: edge.confidence >= .85 ? "strong" : "moderate",
			direction: relationToSignalDirection(relation),
			reason: edge.reason.trim()
		},
		{
			kind: "scope",
			strength: taskScoped ? "strong" : "weak",
			direction: taskScoped ? "neutral" : "ambient",
			reason: taskScoped ? "graph edge matches task-scoped directive and observation" : "graph edge is outside the concrete task scope"
		},
		{
			kind: "verification",
			strength: verificationStrength(observation),
			direction: observation.verification.disposition === "demote-to-ambient" ? "ambient" : "neutral",
			reason: `RCCL verification disposition is ${observation.verification.disposition}`
		},
		{
			kind: "lifecycle",
			strength: observation.lifecycle.status === "active" ? "strong" : "weak",
			direction: observation.lifecycle.status === "superseded" || observation.lifecycle.status === "stale" ? "ambient" : "neutral",
			reason: `RCCL lifecycle status is ${observation.lifecycle.status}`
		}
	];
}
function buildRuntimeSignals(observation, taskScoped, semanticKey, relation) {
	return [
		{
			kind: "scope",
			strength: taskScoped ? "strong" : "weak",
			direction: taskScoped ? "neutral" : "ambient",
			reason: taskScoped ? "directive and observation scopes match the resolved task" : "directive or observation is outside the resolved task scope"
		},
		{
			kind: "verification",
			strength: verificationStrength(observation),
			direction: observation.verification.disposition === "demote-to-ambient" ? "ambient" : "neutral",
			reason: `RCCL verification disposition is ${observation.verification.disposition}`
		},
		{
			kind: "lifecycle",
			strength: observation.lifecycle.status === "active" ? "strong" : "weak",
			direction: observation.lifecycle.status === "superseded" || observation.lifecycle.status === "stale" ? "ambient" : "neutral",
			reason: `RCCL lifecycle status is ${observation.lifecycle.status}`
		},
		...semanticKey ? [{
			kind: "semantic-key",
			strength: "moderate",
			direction: relationToSignalDirection(relation),
			reason: "directive and observation semantic keys overlap"
		}] : []
	];
}
function isRelation(value) {
	return value === "reinforce" || value === "tension" || value === "suppress" || value === "ambient-only" || value === "unrelated";
}
function relationToSignalDirection(relation) {
	if (relation === "ambient-only" || relation === "unrelated") return "ambient";
	return relation;
}
function verificationStrength(observation) {
	if (observation.verification.evidenceStatus === "verified" || observation.verification.evidenceConfidence >= .8) return "strong";
	if (observation.verification.evidenceStatus === "partial" || observation.verification.evidenceConfidence >= .5) return "moderate";
	return "weak";
}
function hasVerifiedEvidence(observation) {
	return observation.verification.evidenceVerifiedCount > 0 || observation.verification.evidenceStatus === "verified" || observation.verification.evidenceStatus === "partial";
}
function runtimeRelationConfidence(observation) {
	const verificationConfidence = Math.max(observation.verification.evidenceConfidence, observation.verification.inductionConfidence, observation.adherence.confidence);
	return Number(Math.min(1, Math.max(verificationConfidence, .75)).toFixed(2));
}
function inferConflictClass(directive, observation, relation) {
	if (relation === "unrelated" || relation === "reinforce" || relation === "ambient-only") return void 0;
	if (directive.kind === "anti-pattern" || observation.traits.antiPattern) return "anti-pattern";
	if (directive.traits.migrationSensitive || observation.traits.migrationBoundary) return "migration-tension";
	if (directive.traits.compatibilitySensitive || observation.traits.compatibilityBoundary) return "compatibility-boundary";
	if (observation.traits.legacy) return "legacy-interface";
	if (observation.category === "style") return "style-drift";
	if (observation.category === "architecture") return "architecture-drift";
	return "local-deviation";
}
function summarizeRuntimeProposal(relation) {
	if (relation === "ambient-only") return "runtime structural fallback only shortlisted this verified task-scoped observation as ambient context; execution influence requires a host semantic graph or feedback signal";
	return "runtime structural fallback did not assign execution influence";
}
function defaultImpact(relation) {
	if (relation === "tension" || relation === "suppress") return "execution-mode";
	if (relation === "reinforce") return "review-focus";
	if (relation === "ambient-only") return "ambient-context";
	return "no-effect";
}
function defaultReviewPriority(directive, relation) {
	if (relation === "suppress") return "critical";
	if (relation === "tension" && (directive.prescription === "must" || directive.weight === "critical")) return "critical";
	if (relation === "tension") return "high";
	if (directive.weight === "critical") return "high";
	return "normal";
}
function semanticKeysOverlap(left, right) {
	const leftTokens = tokenSet(left);
	const rightTokens = tokenSet(right);
	for (const token of leftTokens) if (rightTokens.has(token)) return true;
	return false;
}
function tokenSet(value) {
	return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
}
function observationEvidenceRefs(observation) {
	return observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`);
}
function clampConfidence(value) {
	return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}
function scopeMatchesTask(scope, task) {
	if (task.targets.length === 0) return true;
	return task.targets.some((target) => pathMatchesScope(target.path, scope));
}
//#endregion
//#region src/ir/relations/build-relations.ts
function buildSemanticRelationsIR(bundle) {
	const proposals = proposeSemanticRelations(bundle);
	const agenticRelations = adjudicateSemanticRelations(mergeRelationProposals(proposals.filter(isAgenticRelationProposal)), bundle);
	const agenticPairs = effectiveRelationPairs(agenticRelations);
	const structuralFallbackRelations = adjudicateSemanticRelations(mergeRelationProposals(proposals.filter((relation) => relation.proposedBy === "runtime-structural" && !agenticPairs.has(relationPairKey(relation)))), bundle);
	return [...agenticRelations, ...structuralFallbackRelations].sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}
function mergeRelationProposals(relations) {
	const grouped = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		const key = `${relation.directiveId}::${relation.observationId}`;
		const current = grouped.get(key) ?? [];
		current.push(relation);
		grouped.set(key, current);
	}
	return [...grouped.values()].map(mergeRelationGroup).sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}
function mergeRelationGroup(group) {
	if (group.length === 1) return group[0];
	return [...group].sort(compareWholeProposals)[0];
}
function compareWholeProposals(left, right) {
	const sourceRank = {
		"host-agent": 3,
		feedback: 2,
		"runtime-structural": 1,
		"multi-source": 0
	};
	const source = sourceRank[right.proposedBy] - sourceRank[left.proposedBy];
	if (source) return source;
	if (left.confidence !== right.confidence) return right.confidence - left.confidence;
	if (left.basis.evidence !== right.basis.evidence) return left.basis.evidence ? -1 : 1;
	if (left.evidenceRefs.length !== right.evidenceRefs.length) return right.evidenceRefs.length - left.evidenceRefs.length;
	return left.id.localeCompare(right.id);
}
function isAgenticRelationProposal(relation) {
	return relation.proposedBy === "host-agent" || relation.proposedBy === "feedback";
}
function effectiveRelationPairs(relations) {
	return new Set(relations.filter((relation) => relation.adjudication.status !== "rejected" && relation.adjudication.finalRelation !== "unrelated").map(relationPairKey));
}
function relationPairKey(relation) {
	return `${relation.directiveId}::${relation.observationId}`;
}
//#endregion
//#region src/ir/relations/public-mapping.ts
function semanticRelationIRToPublic(relation) {
	return {
		id: relation.id,
		directive_id: relation.directiveId,
		observation_id: relation.observationId,
		relation: publicRelationKind$1(relation.adjudication.finalRelation),
		confidence: relation.confidence,
		basis: publicBasis(relation),
		reason: relation.adjudication.reason,
		proposed_by: relation.proposedBy,
		adjudication_status: relation.adjudication.status,
		final_relation: publicRelationKind$1(relation.adjudication.finalRelation),
		signals: relation.signals.map((signal) => ({
			kind: signal.kind,
			strength: signal.strength,
			direction: signal.direction,
			reason: signal.reason
		})),
		evidence_refs: relation.evidenceRefs,
		reasoning_summary: relation.reasoningSummary,
		adjudication_reason: relation.adjudication.reason,
		...relation.conflictClass ? { conflict_class: relation.conflictClass } : {},
		...relation.impact ? { impact: relation.impact } : {},
		...relation.reviewPriority ? { review_priority: relation.reviewPriority } : {},
		...relation.executionIntent ? { execution_intent: relation.executionIntent } : {},
		...relation.mergeIntent ? { merge_intent: relation.mergeIntent } : {},
		...relation.groupId ? { group_id: relation.groupId } : {}
	};
}
function semanticRelationsIRToPublic(relations) {
	return relations.map(semanticRelationIRToPublic);
}
function publicRelationKind$1(relation) {
	switch (relation) {
		case "reinforce":
		case "tension":
		case "ambient-only": return relation;
		case "suppress": return "anti-pattern-suppress";
		case "unrelated": return "none";
	}
}
function publicBasis(relation) {
	const basis = [];
	if (relation.basis.scope) basis.push("scope");
	if (relation.basis.evidence) basis.push("verification");
	if (relation.basis.category || relation.basis.semanticKey) basis.push("category");
	if (relation.basis.hostReasoning || relation.basis.feedback) basis.push("context");
	return basis.length ? basis : ["context"];
}
//#endregion
//#region src/ir/semantic-merge/public-adapter.ts
function projectIRSemanticMergeToPublic(directives, observations, relationsIR, executionDecisionsIR, contextProfile) {
	const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
	const observationById = new Map(observations.map((observation) => [observation.id, observation]));
	const effectiveRelations = relationsIR.filter(isEffectiveRelation);
	const relationSummaryById = new Map(relationsIR.map((relation) => [relation.id, relationSummary(relation)]));
	const observationIdsByDirective = groupObservationIdsByDirective(effectiveRelations);
	const directiveModes = executionDecisionsIR.map((decision) => projectExecutionDecision(decision, observationIdsByDirective.get(decision.directiveId) ?? [], relationSummaryById));
	const contextTensions = buildContextTensions(effectiveRelations, directiveById, observationById, contextProfile);
	const contextInfluences = buildContextInfluences(executionDecisionsIR);
	const reviewFocus = buildReviewFocus(directiveModes, effectiveRelations, directiveById, contextTensions);
	const observationStates = buildObservationStates(observations, directiveModes);
	const relations = semanticRelationsIRToPublic(relationsIR);
	return {
		activated_directives: directiveModes.filter((item) => item.execution_mode !== "suppress").map((item) => item.directive_id),
		suppressed_directives: directiveModes.filter((item) => item.execution_mode === "suppress").map((item) => item.directive_id),
		context_tensions: contextTensions,
		directive_modes: directiveModes,
		observation_links: observationStates.map((state) => ({
			observation_id: state.observation_id,
			directive_ids: state.directive_ids
		})),
		observation_states: observationStates,
		relations,
		merge_summary: buildMergeSummary(relationsIR, executionDecisionsIR),
		focus: { review_focus: uniqueFocus(reviewFocus) },
		context_influences: contextInfluences
	};
}
function isEffectiveRelation(relation) {
	return relation.adjudication.status !== "rejected" && relation.adjudication.finalRelation !== "unrelated";
}
function groupObservationIdsByDirective(relations) {
	const grouped = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		const current = grouped.get(relation.directiveId) ?? [];
		if (!current.includes(relation.observationId)) current.push(relation.observationId);
		grouped.set(relation.directiveId, current);
	}
	return grouped;
}
function projectExecutionDecision(decision, observationIds, relationSummaryById) {
	const relation_summaries = decision.relationIds.flatMap((relationId) => {
		const summary = relationSummaryById.get(relationId);
		return summary ? [summary] : [];
	});
	return {
		directive_id: decision.directiveId,
		observation_ids: observationIds,
		relation_ids: decision.relationIds,
		relation_summaries,
		execution_mode: decision.mode,
		default_execution_mode: decision.defaultMode,
		reason: decision.reason,
		decision_basis: publicDecisionBasis(decision.basis),
		context_applied: decision.contextApplied,
		context_rule_ids: decision.contextRulesApplied,
		feedback_applied: decision.feedbackApplied
	};
}
function publicDecisionBasis(basis) {
	switch (basis) {
		case "prescription": return "default";
		case "governance-graph": return "observed-conflict";
		case "verification": return "rccl-immune";
		case "task-context":
		case "feedback": return "context-adjusted";
		case "anti-pattern": return "anti-pattern";
	}
}
function buildObservationStates(observations, directiveModes) {
	return observations.map((observation) => ({
		observation_id: observation.id,
		directive_ids: directiveModes.filter((item) => item.observation_ids.includes(observation.id)).map((item) => item.directive_id),
		disposition: observation.verification.disposition ?? "pending",
		lifecycle_status: observation.lifecycle?.status ?? "unknown",
		content_fingerprint: observation.lifecycle?.content_fingerprint ?? null
	}));
}
function buildContextTensions(relations, directiveById, observationById, contextProfile) {
	return relations.flatMap((relation) => {
		if (relation.adjudication.finalRelation !== "tension") return [];
		const directive = directiveById.get(relation.directiveId);
		const observation = observationById.get(relation.observationId);
		if (!directive || !observation || directive.prescription !== "must") return [];
		return [{
			directive_id: directive.id,
			observation_id: observation.id,
			relation_id: relation.id,
			group_id: relation.groupId,
			review_priority: relation.reviewPriority,
			category: observation.category,
			execution_mode: "deviation-noted",
			conflict: `${directive.description} conflicts with observed local pattern: ${observation.pattern}`,
			resolution: buildTensionResolution(directive.id, contextProfile, observation),
			rccl_confidence: observation.verification.induction_confidence ?? observation.verification.evidence_confidence ?? relation.confidence
		}];
	});
}
function buildReviewFocus(directiveModes, relations, directiveById, contextTensions) {
	const reviewFocus = [];
	for (const decision of directiveModes) {
		const directive = directiveById.get(decision.directive_id);
		if (!directive) continue;
		if (decision.execution_mode === "deviation-noted") reviewFocus.push({
			kind: "compatibility-boundary",
			directive_id: directive.id,
			reason: decision.reason,
			priority: directiveFocusPriority(directive, decision),
			relation_id: decision.relation_summaries[0]?.relation_id,
			group_id: decision.relation_summaries[0]?.group_id
		});
		if (directive.prescription === "must" || decision.execution_mode === "deviation-noted" || directive.weight === "critical" && decision.execution_mode === "enforce") reviewFocus.push({
			kind: "high-priority-directive",
			directive_id: directive.id,
			reason: `Review whether ${directive.id} was respected under ${decision.execution_mode} execution mode.`,
			priority: directiveFocusPriority(directive, decision),
			relation_id: decision.relation_summaries[0]?.relation_id,
			group_id: decision.relation_summaries[0]?.group_id
		});
		if (decision.feedback_applied.includes("feedback:frequently-ignored-must-review")) reviewFocus.push({
			kind: "high-priority-directive",
			directive_id: directive.id,
			reason: `Review ${directive.id} because lockfile feedback shows repeated ignores; Runtime did not weaken must-level execution.`,
			priority: "high",
			relation_id: decision.relation_summaries[0]?.relation_id,
			group_id: decision.relation_summaries[0]?.group_id
		});
	}
	for (const tension of contextTensions) reviewFocus.push({
		kind: "tension",
		directive_id: tension.directive_id,
		observation_id: tension.observation_id,
		reason: tension.resolution,
		priority: tension.review_priority ?? "high",
		relation_id: tension.relation_id,
		group_id: tension.group_id
	});
	for (const relation of relations.filter((item) => item.adjudication.finalRelation === "suppress")) reviewFocus.push({
		kind: "anti-pattern",
		directive_id: relation.directiveId,
		observation_id: relation.observationId,
		reason: relation.adjudication.reason,
		priority: relation.reviewPriority ?? "critical",
		relation_id: relation.id,
		group_id: relation.groupId
	});
	for (const relation of relations.filter((item) => item.reviewPriority === "high" || item.reviewPriority === "critical")) {
		if (relation.adjudication.finalRelation === "suppress" || relation.adjudication.finalRelation === "tension") continue;
		reviewFocus.push({
			kind: "high-priority-directive",
			directive_id: relation.directiveId,
			observation_id: relation.observationId,
			reason: relation.mergeIntent ?? relation.adjudication.reason,
			priority: relation.reviewPriority,
			relation_id: relation.id,
			group_id: relation.groupId
		});
	}
	return reviewFocus;
}
function relationSummary(relation) {
	return {
		relation_id: relation.id,
		observation_id: relation.observationId,
		relation: publicRelationKind(relation.adjudication.finalRelation),
		adjudication_status: relation.adjudication.status,
		confidence: relation.confidence,
		reason: relation.mergeIntent ?? relation.adjudication.reason,
		review_priority: relation.reviewPriority,
		impact: relation.impact,
		group_id: relation.groupId
	};
}
function buildMergeSummary(relations, decisions) {
	const final_relation_counts = emptyRelationCounts();
	const proposed_by_counts = {};
	const review_priority_counts = {
		low: 0,
		normal: 0,
		high: 0,
		critical: 0
	};
	let accepted = 0;
	let downgraded = 0;
	let rejected = 0;
	let executionModeImpacting = 0;
	for (const relation of relations) {
		if (relation.adjudication.status === "accepted") accepted += 1;
		if (relation.adjudication.status === "downgraded") downgraded += 1;
		if (relation.adjudication.status === "rejected") rejected += 1;
		final_relation_counts[publicRelationKind(relation.adjudication.finalRelation)] += 1;
		proposed_by_counts[relation.proposedBy] = (proposed_by_counts[relation.proposedBy] ?? 0) + 1;
		if (relation.reviewPriority) review_priority_counts[relation.reviewPriority] += 1;
		if (relation.impact === "execution-mode" && relation.adjudication.status !== "rejected") executionModeImpacting += 1;
	}
	return {
		proposed: relations.length,
		accepted,
		downgraded,
		rejected,
		final_relation_counts,
		proposed_by_counts,
		execution_mode_impacting: executionModeImpacting,
		feedback_applied_count: decisions.reduce((count, decision) => count + decision.feedbackApplied.length, 0),
		host_graph_edge_count: relations.filter(hasHostGraphSource).length,
		review_priority_counts,
		policy: semanticRelationPolicyTraceRecord()
	};
}
function emptyRelationCounts() {
	return {
		reinforce: 0,
		tension: 0,
		"anti-pattern-suppress": 0,
		"ambient-only": 0,
		none: 0
	};
}
function publicRelationKind(relation) {
	switch (relation) {
		case "reinforce":
		case "tension":
		case "ambient-only": return relation;
		case "suppress": return "anti-pattern-suppress";
		case "unrelated": return "none";
	}
}
function directiveFocusPriority(directive, decision) {
	const executionMode = decision.execution_mode;
	const contextBoost = contextReviewPriorityBoost(decision.context_applied);
	if (contextBoost) return contextBoost;
	if (executionMode === "suppress") return "critical";
	if (executionMode === "deviation-noted") return directive.weight === "critical" || directive.prescription === "must" ? "critical" : "high";
	if (directive.weight === "critical") return "high";
	if (directive.prescription === "must") return "normal";
	return "low";
}
function hasHostGraphSource(relation) {
	return relation.proposedBy === "host-agent" || relation.signals.some((signal) => signal.kind === "host-proposal");
}
function buildContextInfluences(decisions) {
	return decisions.flatMap((decision) => {
		const contextInfluences = decision.contextApplied.map((context) => {
			const [field, value] = context.split(":");
			return {
				field: publicContextField(field),
				value: value ?? "",
				directive_id: decision.directiveId,
				effect: contextInfluenceEffect(context, decision.mode)
			};
		});
		const feedbackInfluences = decision.feedbackApplied.map((feedback) => ({
			field: "feedback",
			value: feedback,
			directive_id: decision.directiveId,
			effect: contextInfluenceEffect(feedback, decision.mode)
		}));
		return [...contextInfluences, ...feedbackInfluences];
	});
}
function publicContextField(field) {
	switch (field) {
		case "optimization_target":
		case "hard_constraints":
		case "allowed_tradeoffs":
		case "avoid":
		case "risk_level":
		case "scope_size":
		case "compatibility_requirement":
		case "interface_sensitivity":
		case "refactor_tolerance":
		case "migration_phase":
		case "review_goal":
		case "feedback": return field;
		default: return "project_stage";
	}
}
function buildTensionResolution(directiveId, contextProfile, observation) {
	if (hasConstraint(contextProfile.hard_constraints, [
		"preserve compatibility",
		"avoid breaking changes",
		"preserve public api"
	])) return `Follow ${directiveId} for new code, but preserve compatibility with the observed ${observation.category} repository pattern at touched interfaces.`;
	if (hasConstraint(contextProfile.allowed_tradeoffs, ["prefer narrow change scope"])) return `Follow ${directiveId} for the touched code, but contain the change to the local boundary instead of broad cleanup around the observed repository pattern.`;
	if (hasConstraint(contextProfile.avoid, ["broad rewrites", "overengineering"])) return `Follow ${directiveId} in the local change, but avoid turning this tension into a broad rewrite of the observed repository pattern.`;
	return `Follow ${directiveId} for new code, but preserve compatibility with the observed repository pattern where interfaces depend on it.`;
}
function uniqueFocus(items) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const item of items) {
		const key = `${item.kind}:${item.directive_id ?? ""}:${item.observation_id ?? ""}:${item.reason}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}
	return result;
}
//#endregion
//#region src/compile.ts
function buildInterpretationPacket(resolved) {
	return {
		task_models: resolved.task_models,
		input_provenance: resolved.input_provenance,
		diagnostics: resolved.diagnostics,
		trace: resolved.trace,
		resolved: {
			task_intent: resolved.task_intent,
			context_profile: resolved.context_profile
		}
	};
}
function buildGovernancePacket(activation, tensions, focus, semantic_merge, ego, trace) {
	return {
		activation,
		tensions,
		focus,
		semantic_merge,
		ego,
		trace
	};
}
function compileResolvedOutput(packet, resolvedTask, contractDiagnostics, postCompileContractRequests) {
	return {
		packet,
		resolvedTask,
		ego: packet.governance.ego,
		trace: packet.governance.trace,
		cache: packet.cache,
		contractDiagnostics,
		postCompileContractRequests
	};
}
/**
* Runs the deterministic playbook pipeline and produces a change decision packet.
*/
async function compile(input) {
	const validated = await validatePublicCompileInput(input);
	const { normalizedInput, resolvedTask: resolved, sources, governanceIR, activationDecisions: activationDecisionsIR, activeDirectives: irActiveDirectives } = await resolveActivatedGovernanceContext(validated.input);
	const traceSteps = [];
	const intent = resolved.task_intent;
	const contextProfile = resolved.context_profile;
	const hostFulfillment = normalizedInput.hostFulfillment;
	traceSteps.push({
		stage: "Intent Parse",
		lines: [
			`interpretation_mode: ${resolved.input_provenance.interpretation_mode}`,
			`resolved_fields: ${resolved.input_provenance.resolved_fields.length}`,
			`unresolved_fields: ${resolved.input_provenance.unresolved_fields.join(", ") || "(none)"}`,
			`workflow: ${intent.workflow}`,
			`change_type: ${intent.change_type}`,
			`operation: ${intent.operation}`,
			`target_layer: ${intent.target_layer}`,
			`tech_stack: ${intent.tech_stack.join(", ") || "(none)"}`,
			`target_file: ${intent.target_file ?? "(none)"}`,
			`optimization_target: ${contextProfile.optimization_target}`,
			`hard_constraints: ${contextProfile.hard_constraints.join(", ") || "(none)"}`,
			`allowed_tradeoffs: ${contextProfile.allowed_tradeoffs.join(", ") || "(none)"}`,
			`avoid: ${contextProfile.avoid.join(", ") || "(none)"}`,
			`project_stage: ${contextProfile.project_stage ?? "(none)"}`,
			`risk_level: ${contextProfile.risk_level}`,
			`scope_size: ${contextProfile.scope_size}`,
			`compatibility_requirement: ${contextProfile.compatibility_requirement}`,
			`interface_sensitivity: ${contextProfile.interface_sensitivity}`,
			`refactor_tolerance: ${contextProfile.refactor_tolerance}`,
			`migration_phase: ${contextProfile.migration_phase}`,
			`review_goal: ${contextProfile.review_goal}`
		]
	});
	traceSteps.push({
		stage: "Context Profile Resolution",
		lines: resolved.input_provenance.context_resolution.length ? resolved.input_provenance.context_resolution.map((item) => `${item.field}: ${formatContextValue(item.value)} source=${item.source} confidence=${item.confidence} status=${item.status} influence=${item.influence.join(", ") || "(none)"}`) : ["no context profile resolution records"]
	});
	traceSteps.push({
		stage: "Governance IR",
		lines: [
			`ir_version: ${governanceIR.irVersion}`,
			`bundle_fingerprint: ${governanceIR.fingerprints.bundle}`,
			`task_fingerprint: ${governanceIR.fingerprints.task}`,
			`directives_fingerprint: ${governanceIR.fingerprints.directives}`,
			`observations_fingerprint: ${governanceIR.fingerprints.observations}`,
			`feedback_fingerprint: ${governanceIR.fingerprints.feedback}`,
			`host_proposals_fingerprint: ${governanceIR.fingerprints.hostProposals}`,
			`host_proposal_sources: ${formatRecordCounts(countSourceIds(governanceIR.hostProposals.map((proposal) => proposal.source.id)))}`,
			`selected_layers: ${governanceIR.sourceManifest.selectedLayers.join(", ") || "(none)"}`
		]
	});
	traceSteps.push({
		stage: "Host Fulfillment",
		lines: summarizeHostFulfillment(hostFulfillment)
	});
	const activatedGovernanceIR = {
		...governanceIR,
		directives: irActiveDirectives
	};
	const semanticRelationsIR = buildSemanticRelationsIR(activatedGovernanceIR);
	traceSteps.push({
		stage: "IR Semantic Relations",
		lines: summarizeSemanticRelationsIR(semanticRelationsIR)
	});
	const { activationView, activeDirectives } = projectIRActivationToPublic(governanceIR, activationDecisionsIR);
	const selectedLayerIds = sources.selectedLayerIds;
	traceSteps.push({
		stage: "Layer Filter",
		lines: [
			...activationView.selected_layers.length ? activationView.selected_layers.map((layerId) => `applied ${layerId}`) : ["applied builtin/core"],
			`activated: ${activationView.activated.length}`,
			`skipped: ${activationView.skipped.length}`
		]
	});
	const rccl = sources.rccl;
	traceSteps.push({
		stage: "RCCL Source Evolution",
		lines: summarizeRcclSourceEvolution(rccl)
	});
	traceSteps.push({
		stage: "RCCL Verify Gate",
		lines: rccl?.observations.length ? [...summarizeRcclVerificationPolicy(sources.rcclVerificationSummary), ...rccl.observations.map((observation) => {
			const record = sources.rcclVerificationSummary?.records.find((item) => item.observation_id === observation.id);
			const evidenceStatus = observation.verification.evidence_status ?? "pending";
			const inductionStatus = observation.verification.induction_status ?? "pending";
			const disposition = observation.verification.disposition ?? "pending";
			const lifecycleStatus = observation.lifecycle?.status ?? "unknown";
			const verificationAction = record ? ` verification_action=${record.action} task_relevant=${record.task_relevant}` : "";
			return `${observation.id}: evidence=${evidenceStatus} induction=${inductionStatus} disposition=${disposition} lifecycle=${lifecycleStatus} support=${observation.support.scope_basis}/${observation.support.file_count}f/${observation.support.cluster_count}c${verificationAction}`;
		})] : ["no rccl loaded"]
	});
	const executionDecisionsIR = resolveExecutionDecisionsIR(activatedGovernanceIR, semanticRelationsIR);
	const semanticMergeResult = projectIRSemanticMergeToPublic(activeDirectives, rccl?.observations ?? [], semanticRelationsIR, executionDecisionsIR, contextProfile);
	const tensions = { records: semanticMergeResult.context_tensions };
	const focus = buildFocusView(semanticMergeResult, activeDirectives);
	traceSteps.push({
		stage: "Semantic Merge",
		lines: [
			`activated_directives: ${semanticMergeResult.activated_directives.length}`,
			`suppressed_directives: ${semanticMergeResult.suppressed_directives.length}`,
			`relations: ${semanticMergeResult.relations.length}`,
			`accepted_relations: ${semanticMergeResult.merge_summary.accepted}`,
			`downgraded_relations: ${semanticMergeResult.merge_summary.downgraded}`,
			`rejected_relations: ${semanticMergeResult.merge_summary.rejected}`,
			`final_relations: ${formatRecordCounts(semanticMergeResult.merge_summary.final_relation_counts)}`,
			`relation_sources: ${formatRecordCounts(semanticMergeResult.merge_summary.proposed_by_counts)}`,
			`execution_mode_impacting_relations: ${semanticMergeResult.merge_summary.execution_mode_impacting}`,
			`host_graph_edges: ${semanticMergeResult.merge_summary.host_graph_edge_count}`,
			`feedback_applied: ${semanticMergeResult.merge_summary.feedback_applied_count}`,
			`semantic_relation_policy: ${formatPolicy(semanticMergeResult.merge_summary.policy)}`,
			`review_focus_by_priority: ${formatRecordCounts(semanticMergeResult.merge_summary.review_priority_counts)}`,
			`governance_graph_mode_changes: ${governanceGraphModeChanges(semanticMergeResult).join(", ") || "(none)"}`,
			`context_policy_rules: ${formatListCounts(executionDecisionsIR.flatMap((decision) => decision.contextRulesApplied))}`,
			`context_tensions: ${semanticMergeResult.context_tensions.length}`,
			`review_focus: ${focus.review_focus.length}`,
			`context_influences: ${semanticMergeResult.context_influences.length}`
		]
	});
	const egoBudget = applyEgoBudget(projectIREgoToPublic(activatedGovernanceIR, semanticMergeResult, intent));
	const ego = egoBudget.ego;
	traceSteps.push({
		stage: "Contract Diagnostics",
		lines: validated.diagnostics.length ? validated.diagnostics.map((item) => `${item.kind}: provided=${item.summary.total} accepted=${item.summary.accepted} rejected=${item.summary.rejected} downgraded=${item.summary.downgraded} unused=${item.summary.unused}`) : ["no host artifacts provided"]
	});
	traceSteps.push({
		stage: "EGO Assembly",
		lines: [
			`must_follow: ${ego.guidance.must_follow.length}`,
			`avoid: ${ego.guidance.avoid.length}`,
			`context_tensions: ${ego.guidance.context_tensions.length}`,
			`ambient: ${ego.guidance.ambient.length}`,
			`budget_status: ${egoBudget.exceeded ? "EGO_BUDGET_EXCEEDED" : "within-budget"}`,
			`serialized_characters: ${egoBudget.serializedCharacters}/${EGO_BUDGET.serializedCharacters}`,
			`omitted: ${egoBudget.omissions.length}`
		]
	});
	const trace = {
		task: intent,
		steps: traceSteps,
		activated_directives: semanticMergeResult.activated_directives,
		suppressed_directives: semanticMergeResult.suppressed_directives,
		activation: activationView,
		tensions,
		review_focus: focus.review_focus,
		directive_decisions: semanticMergeResult.directive_modes,
		observation_links: semanticMergeResult.observation_links,
		context_influences: semanticMergeResult.context_influences,
		...hostFulfillment ? { host_fulfillment: hostFulfillment } : {},
		ego_budget: {
			limits: {
				total_items: EGO_BUDGET.totalItems,
				hard_items: EGO_BUDGET.hardItems,
				ambient_items: EGO_BUDGET.ambientItems,
				examples_per_directive: EGO_BUDGET.examplesPerDirective,
				serialized_characters: EGO_BUDGET.serializedCharacters
			},
			exceeded: egoBudget.exceeded,
			serialized_characters: egoBudget.serializedCharacters,
			omitted: egoBudget.omissions
		}
	};
	const cache = buildCacheKeys({
		builtinRoot: normalizedInput.builtinRoot,
		localAugmentPath: normalizedInput.localAugmentPath,
		rcclPath: normalizedInput.rcclPath,
		task: resolved.task,
		builtinLayers: sources.builtinLayers,
		hostProposalsFingerprint: governanceIR.fingerprints.hostProposals,
		verificationPolicy: normalizedInput.verificationPolicy ?? "task-relevant",
		rcclVerificationSummary: sources.rcclVerificationSummary
	}, selectedLayerIds, rccl);
	const packet = {
		version: "1",
		status: validated.diagnostics.some((item) => item.summary.rejected > 0) || egoBudget.exceeded ? "needs-attention" : "compiled",
		task: {
			workflow: resolved.workflow,
			change_type: intent.change_type,
			operation: intent.operation,
			input: resolved.task
		},
		interpretation: buildInterpretationPacket(resolved),
		governance: buildGovernancePacket(activationView, tensions, focus, semanticMergeResult, ego, trace),
		cache,
		fingerprints: governanceIR.fingerprints,
		contract_diagnostics: validated.diagnostics,
		post_compile_contract_requests: []
	};
	const adherence = prepareAdherenceEvidenceContract({
		directives: activeDirectives.map((directive) => ({
			id: directive.id,
			description: directive.description,
			prescription: directive.prescription,
			execution_mode: semanticMergeResult.directive_modes.find((item) => item.directive_id === directive.id)?.execution_mode ?? "ambient"
		})),
		taskDescription: resolved.task.description,
		artifactPath: join(normalizedInput.projectRoot, ".resonant-code", "context", "adherence-evidence", "code", `${adherenceArtifactName(resolved)}.json`)
	});
	const postCompileContractRequests = [{
		kind: "adherence-evidence",
		artifact: adherence.evidenceArtifact,
		contract: adherence.contract
	}];
	packet.post_compile_contract_requests = postCompileContractRequests;
	return compileResolvedOutput(packet, resolved, validated.diagnostics, postCompileContractRequests);
}
async function validatePublicCompileInput(input) {
	if (!("task" in input)) throw new Error("compile() v1 requires a raw task input; pre-resolved task objects are not accepted.");
	const diagnostics = [];
	const taskContract = prepareTaskModelContract({
		task: input.task,
		artifactPath: input.artifacts?.taskModel?.path ?? join(input.projectRoot, ".resonant-code", "context", "task-models", "code", "task-model.json")
	});
	let taskModels = [];
	if (input.artifacts?.taskModel) {
		const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.taskModel.raw, taskContract.contract);
		if (unwrapped.diagnostic) diagnostics.push(buildContractPayloadDiagnostics("task-model", [unwrapped.diagnostic], {
			id: taskContract.contract.requestId,
			path: input.artifacts.taskModel.path
		}));
		else {
			const validated = validateTaskModelPayload(unwrapped.payload);
			diagnostics.push(validated.diagnostics);
			taskModels = validated.models;
		}
	}
	const preliminary = {
		...input,
		taskModels,
		hostProposals: [],
		hostFulfillment: void 0
	};
	const graphContract = await prepareSemanticGovernanceGraphContractBundle({
		compileInput: preliminary,
		artifactPath: input.artifacts?.semanticGovernanceGraph?.path ?? join(input.projectRoot, ".resonant-code", "context", "semantic-governance-graphs", "code", "semantic-governance-graph.json")
	});
	const proposals = [];
	let graphDiagnostics = null;
	if (input.artifacts?.semanticGovernanceGraph) {
		const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.semanticGovernanceGraph.raw, graphContract.contract);
		if (unwrapped.diagnostic) graphDiagnostics = buildContractPayloadDiagnostics("semantic-governance-graph", [unwrapped.diagnostic], {
			id: graphContract.contract.requestId,
			path: input.artifacts.semanticGovernanceGraph.path
		});
		else {
			const validated = validateSemanticGovernanceGraphPayload({
				raw: unwrapped.payload,
				source: {
					id: graphContract.contract.requestId,
					path: input.artifacts.semanticGovernanceGraph.path
				},
				allowedDirectiveIds: graphContract.contract.allowedIds?.directiveIds,
				allowedObservationIds: graphContract.contract.allowedIds?.observationIds,
				evidenceContext: {
					projectRoot: input.projectRoot,
					observations: graphContract.loadedSources?.rccl?.observations
				}
			});
			graphDiagnostics = validated.diagnostics;
			if ((validated.proposal.payload.edges ?? []).length) proposals.push(validated.proposal);
		}
		diagnostics.push(graphDiagnostics);
	}
	const taskDiagnostics = diagnostics.find((item) => item.kind === "task-model") ?? null;
	return {
		input: {
			...preliminary,
			hostProposals: proposals,
			hostFulfillment: {
				status: summarizeFulfillment(taskDiagnostics, graphDiagnostics),
				agentCapability: {
					kind: "agent-capability-profile",
					provided: false,
					path: null,
					status: "absent",
					diagnostics: null
				},
				taskModel: artifactSummary("task-model", input.artifacts?.taskModel, taskDiagnostics),
				semanticGovernanceGraph: artifactSummary("semantic-governance-graph", input.artifacts?.semanticGovernanceGraph, graphDiagnostics)
			}
		},
		diagnostics
	};
}
function artifactSummary(kind, artifact, diagnostics) {
	const summary = diagnostics?.summary;
	const accepted = (summary?.accepted ?? 0) > 0;
	const rejected = (summary?.rejected ?? 0) > 0;
	return {
		kind,
		provided: Boolean(artifact),
		path: artifact?.path ?? null,
		status: !artifact ? "absent" : accepted && rejected ? "partially-accepted" : accepted ? "accepted" : rejected ? "rejected" : "unused",
		diagnostics
	};
}
function summarizeFulfillment(task, graph) {
	const summaries = [task, graph].filter(Boolean).map((item) => item.summary);
	if (!summaries.length) return "absent";
	if (summaries.some((item) => item.rejected > 0) && summaries.some((item) => item.accepted > 0)) return "partially-accepted";
	if (summaries.some((item) => item.rejected > 0)) return "rejected";
	if (summaries.some((item) => item.accepted > 0)) return "accepted";
	return "unused";
}
function adherenceArtifactName(resolved) {
	return `adherence-${stableHash([resolved.task_intent, resolved.task.description]).slice(0, 12)}`;
}
function summarizeRcclSourceEvolution(rccl) {
	if (!rccl) return ["no rccl loaded"];
	const lifecycleCounts = countBy(rccl.observations, (observation) => observation.lifecycle?.status ?? "unknown");
	const fingerprints = rccl.observations.filter((observation) => observation.lifecycle?.content_fingerprint).map((observation) => `${observation.id}:${observation.lifecycle?.content_fingerprint.slice(0, 10)}`);
	return [
		`version: ${rccl.version}`,
		`git_ref: ${rccl.git_ref ?? "(none)"}`,
		`generated_at: ${rccl.generated_at ?? "(none)"}`,
		`observations: ${rccl.observations.length}`,
		`lifecycle_statuses: ${formatCounts(lifecycleCounts)}`,
		`fingerprints: ${fingerprints.join(", ") || "(none)"}`
	];
}
function summarizeSemanticRelationsIR(relations) {
	const statusCounts = countBy(relations, (relation) => relation.adjudication.status);
	const finalRelationCounts = countBy(relations, (relation) => relation.adjudication.finalRelation);
	const proposedRelationCounts = countBy(relations, (relation) => relation.relation);
	const proposedByCounts = countBy(relations, (relation) => relation.proposedBy);
	return [
		`proposed: ${relations.length}`,
		`accepted: ${statusCounts.get("accepted") ?? 0}`,
		`downgraded: ${statusCounts.get("downgraded") ?? 0}`,
		`rejected: ${statusCounts.get("rejected") ?? 0}`,
		`proposed_relations: ${formatCounts(proposedRelationCounts)}`,
		`final_relations: ${formatCounts(finalRelationCounts)}`,
		`proposed_by: ${formatCounts(proposedByCounts)}`
	];
}
function countBy(items, key) {
	const counts = /* @__PURE__ */ new Map();
	for (const item of items) {
		const value = key(item);
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}
function formatCounts(counts) {
	if (counts.size === 0) return "(none)";
	return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(", ");
}
function buildFocusView(semanticMergeResult, directives) {
	const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
	return { review_focus: semanticMergeResult.focus.review_focus.map((item) => {
		const directive = item.directive_id ? directiveById.get(item.directive_id) : void 0;
		return {
			kind: item.kind,
			title: buildFocusTitle(item.kind, directive?.description, item.directive_id, item.observation_id),
			reason: item.reason,
			directive_id: item.directive_id,
			observation_id: item.observation_id,
			priority: item.priority,
			relation_id: item.relation_id,
			group_id: item.group_id
		};
	}) };
}
function buildFocusTitle(kind, directiveDescription, directiveId, observationId) {
	const directiveLabel = directiveDescription ?? directiveId ?? "directive";
	switch (kind) {
		case "tension": return `Review tension around ${directiveLabel}`;
		case "anti-pattern": return `Check anti-pattern suppression for ${observationId ?? directiveLabel}`;
		case "high-priority-directive": return `Confirm high-priority guidance for ${directiveLabel}`;
		case "compatibility-boundary": return `Inspect compatibility boundary for ${directiveLabel}`;
	}
}
function governanceGraphModeChanges(semanticMergeResult) {
	return semanticMergeResult.directive_modes.filter((item) => item.relation_ids.length > 0 && item.execution_mode !== item.default_execution_mode).map((item) => `${item.directive_id}:${item.default_execution_mode}->${item.execution_mode}`);
}
function countSourceIds(sourceIds) {
	const counts = {};
	for (const sourceId of sourceIds) counts[sourceId] = (counts[sourceId] ?? 0) + 1;
	return counts;
}
function summarizeHostFulfillment(hostFulfillment) {
	if (!hostFulfillment) return ["no host fulfillment summary provided"];
	return [
		`status: ${hostFulfillment.status}`,
		formatHostFulfillmentArtifact("agent_capability_profile", hostFulfillment.agentCapability),
		formatHostFulfillmentArtifact("task_model", hostFulfillment.taskModel),
		formatHostFulfillmentArtifact("semantic_governance_graph", hostFulfillment.semanticGovernanceGraph),
		...hostFulfillment.adherenceEvidence ? [formatHostFulfillmentArtifact("adherence_evidence", hostFulfillment.adherenceEvidence)] : [],
		`evidence_coverage: ${formatEvidenceCoverage(hostFulfillment)}`
	];
}
function summarizeRcclVerificationPolicy(summary) {
	if (!summary) return ["verification_policy: none"];
	return [
		`verification_policy: ${summary.policy}`,
		`reverified_count: ${summary.reverified_count}`,
		`reused_count: ${summary.reused_count}`,
		`demoted_count: ${summary.demoted_count}`,
		`skipped_not_task_relevant_count: ${summary.skipped_not_task_relevant_count}`
	];
}
function formatHostFulfillmentArtifact(label, artifact) {
	const diagnostics = artifact.diagnostics?.summary;
	return `${label}: provided=${artifact.provided} status=${artifact.status} accepted=${diagnostics?.accepted ?? 0} rejected=${diagnostics?.rejected ?? 0} downgraded=${diagnostics?.downgraded ?? 0} unused=${diagnostics?.unused ?? 0}`;
}
function formatEvidenceCoverage(hostFulfillment) {
	const totals = [
		hostFulfillment.taskModel,
		hostFulfillment.semanticGovernanceGraph,
		...hostFulfillment.adherenceEvidence ? [hostFulfillment.adherenceEvidence] : []
	].reduce((acc, artifact) => {
		const summary = artifact.diagnostics?.summary;
		acc.total += summary?.total ?? 0;
		acc.accepted += summary?.accepted ?? 0;
		acc.rejected += summary?.rejected ?? 0;
		acc.downgraded += summary?.downgraded ?? 0;
		acc.unused += summary?.unused ?? 0;
		return acc;
	}, {
		total: 0,
		accepted: 0,
		rejected: 0,
		downgraded: 0,
		unused: 0
	});
	if (totals.total === 0) return "none";
	return `accepted=${totals.accepted}/${totals.total} rejected=${totals.rejected} downgraded=${totals.downgraded} unused=${totals.unused}`;
}
function formatRecordCounts(counts) {
	const entries = Object.entries(counts).filter(([, count]) => count > 0);
	return entries.length ? entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(", ") : "(none)";
}
function formatListCounts(values) {
	const counts = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return formatRecordCounts(counts);
}
function formatContextValue(value) {
	return Array.isArray(value) ? value.join(",") || "(none)" : value || "(none)";
}
function formatPolicy(policy) {
	return [
		`host_min_confidence=${policy.host_semantic.min_confidence}`,
		`host_candidate_cap=${policy.host_semantic.max_candidates_per_directive}`,
		`feedback_follow_rate=${policy.feedback.frequently_ignored_follow_rate}`,
		`feedback_min_ignored=${policy.feedback.frequently_ignored_min_ignored}`,
		`recurring_tension_seen=${policy.feedback.recurring_tension_seen_count}`
	].join(", ");
}
/**
* Derives stable cache keys for layered inputs and the concrete task payload.
*/
function buildCacheKeys(input, selectedLayerIds, rccl) {
	const builtinFingerprints = selectedLayerIds.map((layerId) => {
		const filePath = input.builtinLayers.get(layerId);
		return `${layerId}:${filePath ? stableHash([readFileSync(filePath, "utf-8")]) : stableHash(["missing"])}`;
	});
	const localSource = input.localAugmentPath ? readFileSync(input.localAugmentPath, "utf-8") : "";
	const rcclSource = input.rcclPath && rccl ? JSON.stringify(rccl.observations.map((item) => [
		item.id,
		item.verification.evidence_status,
		item.verification.disposition
	])) : "";
	const rcclVerificationKey = fingerprintRcclVerificationSummary(input.rcclVerificationSummary);
	const l1Key = stableHash(builtinFingerprints);
	const l2Key = stableHash([
		l1Key,
		localSource,
		rcclSource,
		input.verificationPolicy,
		rcclVerificationKey
	]);
	return {
		l1Key,
		l2Key,
		l3Key: stableHash([
			l2Key,
			input.task,
			input.hostProposalsFingerprint
		]),
		verificationPolicy: input.verificationPolicy,
		rcclVerificationKey
	};
}
function fingerprintRcclVerificationSummary(summary) {
	if (!summary) return stableHash(["no-rccl-verification"]);
	return stableHash([
		summary.policy,
		summary.reverified_count,
		summary.reused_count,
		summary.demoted_count,
		summary.skipped_not_task_relevant_count,
		summary.records.map((record) => [
			record.observation_id,
			record.action,
			record.task_relevant,
			record.before.evidence_status,
			record.before.induction_status,
			record.before.disposition,
			record.after.evidence_status,
			record.after.induction_status,
			record.after.disposition
		])
	]);
}
//#endregion
export { compile, evaluateGuidance, planGuidance };
