import { resolveCompileTask } from "../compile-input.mjs";
import { activatedDirectiveIdsIR, resolveActivationDecisionsIR } from "../ir/activation/resolve-activation.mjs";
import { loadCompileSources } from "../load/compile-sources.mjs";
import { SEMANTIC_RELATION_POLICY } from "../ir/relations/policy.mjs";
import { buildGovernanceIR } from "../ir/build-ir.mjs";
import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
import { contractVersionDiagnostic, isRecord, normalizeEvidenceRefs, validConfidence, validEvidenceRefs } from "./shared.mjs";
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
	const resolvedTask = resolveCompileTask(input.compileInput);
	const compileInput = {
		...input.compileInput,
		resolvedTask
	};
	const sources = compileInput.preloadedSources ?? await loadCompileSources(compileInput);
	const governanceIR = await buildGovernanceIR(compileInput, sources);
	const activatedDirectiveIds = activatedDirectiveIdsIR(resolveActivationDecisionsIR(governanceIR));
	return {
		resolvedTask,
		directives: governanceIR.directives.filter((directive) => activatedDirectiveIds.has(directive.id)).map(summarizeDirectiveForProposal),
		observations: governanceIR.observations.map(summarizeObservationForProposal),
		loadedSources: sources
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
		usage: `Write the semantic-governance-graph payload to ${input.artifactPath}, then re-run with --governance-graph-file ${input.artifactPath}.`
	};
	return {
		graphPrompt: prompt,
		graphSchema: JSON.stringify(SEMANTIC_GRAPH_SCHEMA, null, 2),
		graphArtifact: artifact,
		contract: {
			contractVersion: "ai-contract/v2",
			kind: "semantic-governance-graph",
			schemaId: "runtime.semantic-governance-graph",
			schemaVersion: "2.0",
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
			cacheKeyMaterial: {
				taskIntent: input.resolvedTask.task_intent,
				contextProfile: input.resolvedTask.context_profile,
				directiveIds: input.directives.map((directive) => directive.id),
				observationIds: input.observations.map((observation) => observation.id)
			}
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
	const accepted = [];
	const seen = /* @__PURE__ */ new Set();
	edges.forEach((edge, index) => {
		const path = `edges[${index}]`;
		if (!isGraphEdge(edge)) {
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
		accepted.push({
			...edge,
			evidence_refs: normalizeEvidenceRefs(edge.evidence_refs)
		});
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: "Semantic governance graph edge accepted for Runtime adjudication.",
			directiveId: edge.directive_id,
			observationId: edge.observation_id,
			confidence: edge.confidence
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
function loadSemanticGovernanceGraphPayload(raw, source) {
	return validateSemanticGovernanceGraphPayload({
		raw,
		source
	}).proposal;
}
function graphEdges(raw, entries) {
	if (Array.isArray(raw)) return raw;
	if (!raw) return [];
	if (!isRecord(raw)) {
		entries.push(rejected("payload", "malformed-payload", "Semantic governance graph payload must be an object with an edges array."));
		return [];
	}
	if (!Array.isArray(raw.edges)) {
		entries.push(rejected("edges", "malformed-payload", "Semantic governance graph edges field must be an array."));
		return [];
	}
	return raw.edges;
}
function isGraphEdge(value) {
	if (!isRecord(value)) return false;
	return typeof value.directive_id === "string" && typeof value.observation_id === "string" && isRelation(value.relation) && validConfidence(value.confidence) && typeof value.reason === "string" && validEvidenceRefs(value.evidence_refs) && (value.impact === void 0 || isImpact(value.impact)) && (value.review_priority === void 0 || isReviewPriority(value.review_priority)) && (value.execution_intent === void 0 || isExecutionIntent(value.execution_intent));
}
function isRelation(value) {
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
		irVersion: "governance-ir/v1",
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
export { loadSemanticGovernanceGraphPayload, prepareSemanticContractContext, prepareSemanticGovernanceGraphContract, prepareSemanticGovernanceGraphContractBundle, validateSemanticGovernanceGraphPayload };
