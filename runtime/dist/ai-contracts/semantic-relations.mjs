import { resolveCompileTask } from "../compile-input.mjs";
import { activatedDirectiveIdsIR, resolveActivationDecisionsIR } from "../ir/activation/resolve-activation.mjs";
import { loadCompileSources } from "../load/compile-sources.mjs";
import { SEMANTIC_RELATION_POLICY } from "../ir/relations/policy.mjs";
import { buildGovernanceIR } from "../ir/build-ir.mjs";
import { buildContractPayloadDiagnostics } from "./diagnostics.mjs";
//#region src/ai-contracts/semantic-relations.ts
const HOST_SEMANTIC_RELATION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { relations: {
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				directive_id: { type: "string" },
				observation_id: { type: "string" },
				relation: { enum: [
					"reinforce",
					"tension",
					"suppress",
					"ambient-only",
					"unrelated"
				] },
				confidence: {
					type: "number",
					minimum: 0,
					maximum: 1
				},
				reason: { type: "string" },
				conflict_class: { enum: [
					"compatibility-boundary",
					"migration-tension",
					"local-deviation",
					"legacy-interface",
					"anti-pattern",
					"scope-mismatch",
					"style-drift",
					"architecture-drift"
				] },
				impact: { enum: [
					"execution-mode",
					"review-focus",
					"ambient-context",
					"no-effect"
				] },
				review_priority: { enum: [
					"low",
					"normal",
					"high",
					"critical"
				] },
				merge_intent: { type: "string" },
				group_id: { type: "string" },
				evidence_refs: {
					type: "array",
					items: { type: "string" }
				},
				signals: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: {
							kind: { enum: [
								"semantic-key",
								"category",
								"scope",
								"verification",
								"lifecycle",
								"feedback",
								"host-proposal"
							] },
							strength: { enum: [
								"weak",
								"moderate",
								"strong"
							] },
							direction: { enum: [
								"reinforce",
								"tension",
								"suppress",
								"ambient",
								"neutral"
							] },
							reason: { type: "string" }
						},
						required: [
							"kind",
							"strength",
							"direction",
							"reason"
						]
					}
				}
			},
			required: [
				"directive_id",
				"observation_id",
				"relation",
				"confidence",
				"reason"
			]
		}
	} },
	required: ["relations"]
};
const HOST_SEMANTIC_CANDIDATE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { candidates: {
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				directive_id: { type: "string" },
				observation_id: { type: "string" },
				relation_hint: { enum: [
					"reinforce",
					"tension",
					"ambient-only",
					"unknown"
				] },
				confidence: {
					type: "number",
					minimum: 0,
					maximum: 1
				},
				reason: { type: "string" },
				impact: { enum: [
					"execution-mode",
					"review-focus",
					"ambient-context",
					"no-effect"
				] },
				review_priority: { enum: [
					"low",
					"normal",
					"high",
					"critical"
				] },
				merge_intent: { type: "string" },
				group_id: { type: "string" },
				evidence_refs: {
					type: "array",
					items: { type: "string" }
				}
			},
			required: [
				"directive_id",
				"observation_id",
				"relation_hint",
				"confidence",
				"reason"
			]
		}
	} },
	required: ["candidates"]
};
async function prepareSemanticContractContext(input) {
	const resolvedTask = resolveSemanticContractTask(input.compileInput);
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
async function prepareSemanticRelationContractBundle(input) {
	const context = await prepareSemanticContractContext(input);
	return {
		...context,
		...prepareSemanticRelationContract({
			resolvedTask: context.resolvedTask,
			directives: context.directives,
			observations: context.observations,
			artifactPath: input.artifactPath
		})
	};
}
async function prepareSemanticCandidateContractBundle(input) {
	const context = await prepareSemanticContractContext(input);
	return {
		...context,
		...prepareSemanticCandidateContract({
			resolvedTask: context.resolvedTask,
			directives: context.directives,
			observations: context.observations,
			artifactPath: input.artifactPath
		})
	};
}
function prepareSemanticRelationContract(input) {
	const prompt = buildRelationProposalPrompt(input);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write the semantic relation proposal payload to ${input.artifactPath}, then pass --host-proposal-file ${input.artifactPath} to prepare.`
	};
	return {
		proposalPrompt: prompt,
		proposalSchema: JSON.stringify(HOST_SEMANTIC_RELATION_SCHEMA, null, 2),
		proposalArtifact: artifact,
		contract: {
			contractVersion: "ai-contract/v1",
			kind: "semantic-relation",
			schemaId: "runtime.host-semantic-relation-proposal",
			schemaVersion: "1.0",
			prompt,
			schema: HOST_SEMANTIC_RELATION_SCHEMA,
			artifact,
			allowedIds: allowedIds(input),
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: semanticCacheKeyMaterial(input, "semantic-relation")
		}
	};
}
function prepareSemanticCandidateContract(input) {
	const prompt = buildSemanticCandidatePrompt(input);
	const artifact = {
		suggestedPath: input.artifactPath,
		format: "json",
		usage: `Write the semantic candidate payload to ${input.artifactPath}, then pass --semantic-proposal-file ${input.artifactPath} to prepare.`
	};
	return {
		candidatePrompt: prompt,
		candidateSchema: JSON.stringify(HOST_SEMANTIC_CANDIDATE_SCHEMA, null, 2),
		candidateArtifact: artifact,
		contract: {
			contractVersion: "ai-contract/v1",
			kind: "semantic-candidate",
			schemaId: "runtime.host-semantic-candidate-proposal",
			schemaVersion: "1.0",
			prompt,
			schema: HOST_SEMANTIC_CANDIDATE_SCHEMA,
			artifact,
			allowedIds: allowedIds(input),
			provenance: {
				owner: "runtime",
				deterministic: true
			},
			cacheKeyMaterial: semanticCacheKeyMaterial(input, "semantic-candidate")
		}
	};
}
function validateSemanticRelationProposalPayload(input) {
	const entries = [];
	const relations = proposalItems(input.raw, "relations", entries);
	const allowedDirectiveIds = input.allowedDirectiveIds ? new Set(input.allowedDirectiveIds) : null;
	const allowedObservationIds = input.allowedObservationIds ? new Set(input.allowedObservationIds) : null;
	const accepted = [];
	relations.forEach((item, index) => {
		const path = `relations[${index}]`;
		if (!isHostSemanticRelationProposal(item)) {
			entries.push(rejected(path, "malformed-payload", "Semantic relation proposal is missing required fields or has unsupported values."));
			return;
		}
		const idDiagnostic = validateAllowedIds(item.directive_id, item.observation_id, allowedDirectiveIds, allowedObservationIds, path);
		if (idDiagnostic) {
			entries.push(idDiagnostic);
			return;
		}
		if (!validConfidence(item.confidence)) {
			entries.push(rejected(path, "malformed-payload", "Semantic relation proposal confidence must be a number between 0 and 1.", item));
			return;
		}
		if (item.confidence < .5) {
			entries.push(rejected(path, "low-confidence", "Semantic relation proposal confidence is below Runtime host proposal threshold.", item));
			return;
		}
		accepted.push(item);
		entries.push(acceptedEntry(path, "Semantic relation proposal accepted for Runtime adjudication.", item));
	});
	if (!relations.length && !entries.length) entries.push(unused("relations", "No semantic relation proposals were provided."));
	return {
		proposal: buildHostProposal("semantic-relation", input.source, { relations: accepted }),
		diagnostics: buildContractPayloadDiagnostics("semantic-relation", entries, input.source)
	};
}
function validateSemanticCandidateProposalPayload(input) {
	const entries = [];
	const candidates = proposalItems(input.raw, "candidates", entries);
	const allowedDirectiveIds = input.allowedDirectiveIds ? new Set(input.allowedDirectiveIds) : null;
	const allowedObservationIds = input.allowedObservationIds ? new Set(input.allowedObservationIds) : null;
	const acceptedByDirective = /* @__PURE__ */ new Map();
	candidates.forEach((item, index) => {
		const path = `candidates[${index}]`;
		if (!isHostSemanticCandidateProposal(item)) {
			entries.push(rejected(path, "malformed-payload", "Semantic candidate proposal is missing required fields or has unsupported values."));
			return;
		}
		const idDiagnostic = validateAllowedIds(item.directive_id, item.observation_id, allowedDirectiveIds, allowedObservationIds, path);
		if (idDiagnostic) {
			entries.push(idDiagnostic);
			return;
		}
		if (!validConfidence(item.confidence)) {
			entries.push(rejected(path, "malformed-payload", "Semantic candidate proposal confidence must be a number between 0 and 1.", item));
			return;
		}
		if (item.confidence < SEMANTIC_RELATION_POLICY.hostSemantic.minConfidence) {
			entries.push(rejected(path, "low-confidence", "Semantic candidate proposal confidence is below Runtime host semantic threshold.", item));
			return;
		}
		const directiveCandidates = acceptedByDirective.get(item.directive_id) ?? [];
		directiveCandidates.push(item);
		acceptedByDirective.set(item.directive_id, directiveCandidates);
		entries.push(acceptedEntry(path, "Semantic candidate proposal accepted for Runtime adjudication.", item));
	});
	const acceptedCandidates = [...acceptedByDirective.values()].flatMap((items) => items.sort((left, right) => right.confidence - left.confidence).flatMap((item, index) => {
		if (index < SEMANTIC_RELATION_POLICY.hostSemantic.maxCandidatesPerDirective) return [item];
		entries.push({
			status: "unused",
			reason: "capped-by-policy",
			path: `candidates:${item.directive_id}`,
			message: "Semantic candidate proposal was not forwarded because the per-directive candidate cap was reached.",
			directiveId: item.directive_id,
			observationId: item.observation_id,
			confidence: item.confidence
		});
		return [];
	}));
	if (!candidates.length && !entries.length) entries.push(unused("candidates", "No semantic candidate proposals were provided."));
	return {
		proposal: buildHostProposal("semantic-candidate", input.source, { candidates: acceptedCandidates }),
		diagnostics: buildContractPayloadDiagnostics("semantic-candidate", entries, input.source)
	};
}
function loadSemanticRelationProposalPayload(raw, source) {
	return validateSemanticRelationProposalPayload({
		raw,
		source
	}).proposal;
}
function loadSemanticCandidateProposalPayload(raw, source) {
	return validateSemanticCandidateProposalPayload({
		raw,
		source
	}).proposal;
}
function proposalItems(raw, key, entries) {
	if (Array.isArray(raw)) return raw;
	if (!raw) return [];
	if (typeof raw !== "object") {
		entries.push(rejected(key, "malformed-payload", `Semantic proposal payload must be an object with a ${key} array or an array.`));
		return [];
	}
	const items = raw[key];
	if (items === void 0) return [];
	if (!Array.isArray(items)) {
		entries.push(rejected(key, "malformed-payload", `Semantic proposal ${key} field must be an array.`));
		return [];
	}
	return items;
}
function buildHostProposal(kind, source, payload) {
	return {
		irVersion: "governance-ir/v1",
		source: {
			kind: "host-proposal",
			id: source.id,
			...source.path ? { path: source.path } : {}
		},
		kind,
		payload
	};
}
function validateAllowedIds(directiveId, observationId, allowedDirectiveIds, allowedObservationIds, path) {
	if (allowedDirectiveIds && !allowedDirectiveIds.has(directiveId)) return rejected(path, "invalid-id", "Semantic proposal references a directive id outside the contract allowedIds.", {
		directive_id: directiveId,
		observation_id: observationId
	});
	if (allowedObservationIds && !allowedObservationIds.has(observationId)) return rejected(path, "invalid-id", "Semantic proposal references an observation id outside the contract allowedIds.", {
		directive_id: directiveId,
		observation_id: observationId
	});
	return null;
}
function acceptedEntry(path, message, proposal) {
	return {
		status: "accepted",
		reason: "accepted",
		path,
		message,
		directiveId: proposal.directive_id,
		observationId: proposal.observation_id,
		confidence: proposal.confidence
	};
}
function rejected(path, reason, message, proposal) {
	return {
		status: "rejected",
		reason,
		path,
		message,
		directiveId: proposal?.directive_id,
		observationId: proposal?.observation_id,
		confidence: proposal?.confidence
	};
}
function unused(path, message) {
	return {
		status: "unused",
		reason: "empty-payload",
		path,
		message
	};
}
function isHostSemanticRelationProposal(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value;
	return typeof candidate.directive_id === "string" && typeof candidate.observation_id === "string" && isRelation(candidate.relation) && validConfidence(candidate.confidence) && typeof candidate.reason === "string" && (candidate.impact === void 0 || isImpact(candidate.impact)) && (candidate.review_priority === void 0 || isReviewPriority(candidate.review_priority)) && (candidate.signals === void 0 || candidate.signals.every(isSignal));
}
function isHostSemanticCandidateProposal(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value;
	return typeof candidate.directive_id === "string" && typeof candidate.observation_id === "string" && isCandidateHint(candidate.relation_hint) && validConfidence(candidate.confidence) && typeof candidate.reason === "string" && (candidate.impact === void 0 || isImpact(candidate.impact)) && (candidate.review_priority === void 0 || isReviewPriority(candidate.review_priority));
}
function validConfidence(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function isRelation(value) {
	return value === "reinforce" || value === "tension" || value === "suppress" || value === "ambient-only" || value === "unrelated";
}
function isCandidateHint(value) {
	return value === "reinforce" || value === "tension" || value === "ambient-only" || value === "unknown";
}
function isImpact(value) {
	return value === "execution-mode" || value === "review-focus" || value === "ambient-context" || value === "no-effect";
}
function isReviewPriority(value) {
	return value === "low" || value === "normal" || value === "high" || value === "critical";
}
function isSignal(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const signal = value;
	return (signal.kind === "semantic-key" || signal.kind === "category" || signal.kind === "scope" || signal.kind === "verification" || signal.kind === "lifecycle" || signal.kind === "feedback" || signal.kind === "host-proposal") && (signal.strength === "weak" || signal.strength === "moderate" || signal.strength === "strong") && isSignalDirection(signal.direction) && typeof signal.reason === "string";
}
function isSignalDirection(value) {
	return value === "reinforce" || value === "tension" || value === "suppress" || value === "ambient" || value === "neutral";
}
function resolveSemanticContractTask(input) {
	return resolveCompileTask(input);
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
function buildRelationProposalPrompt(input) {
	return [
		"Produce a HostSemanticRelationProposalPayload JSON object for Runtime.",
		"Use only directive_id values and observation_id values listed in this prepare-relations output.",
		"Propose a relation only when the observation materially affects how the directive should execute for this task.",
		"Use relation=\"reinforce\" when repository reality supports following the directive.",
		"Use relation=\"tension\" when repository reality conflicts with the directive but new work should still account for both.",
		"Use relation=\"suppress\" only when an anti-pattern observation should suppress a directive in this task scope.",
		"Use relation=\"ambient-only\" for relevant background that should not change execution mode.",
		"Use relation=\"unrelated\" sparingly; omit weak pairs instead of listing them as unrelated.",
		"When useful, set impact to execution-mode, review-focus, ambient-context, or no-effect.",
		"When useful, set review_priority to low, normal, high, or critical based on review risk; this does not decide execution mode.",
		"When useful, include merge_intent as one short sentence explaining how Runtime should consider the relation.",
		"Use group_id only to connect closely related relations from the same task-level judgment.",
		"Do not infer relations from ids alone; base every relation on the task, directive description, observation pattern, verification, lifecycle, and evidence refs.",
		"Return only JSON matching proposalSchema.",
		`Resolved task intent: ${JSON.stringify(input.resolvedTask.task_intent)}`,
		`Resolved context profile: ${JSON.stringify(input.resolvedTask.context_profile)}`,
		`Directive count: ${input.directives.length}`,
		`Observation count: ${input.observations.length}`
	].join("\n");
}
function buildSemanticCandidatePrompt(input) {
	return [
		"Produce a HostSemanticCandidateProposalPayload JSON object for Runtime.",
		"This is a semantic proposer artifact: use host-agent semantic judgment to shortlist likely directive/observation pairs, but do not decide final execution.",
		"Runtime will validate IDs, confidence, scope, RCCL verification, lifecycle, feedback policy, and final adjudication deterministically.",
		"Use only directive_id values and observation_id values listed in this output.",
		"Use relation_hint=\"reinforce\" when the observation likely supports the directive.",
		"Use relation_hint=\"tension\" when the observation likely conflicts with the directive or requires deviation-noted handling.",
		"Use relation_hint=\"ambient-only\" when the observation is relevant background but should not change execution mode.",
		"Use relation_hint=\"unknown\" when the semantic relation is plausible but impact is not clear; Runtime will keep it ambient.",
		"Do not propose suppress here; use prepare-relations only for an explicit anti-pattern suppress proposal.",
		"Use confidence >= 0.72 only when the task, directive, observation pattern, verification/lifecycle, and evidence refs support the candidate.",
		"When useful, set impact, review_priority, merge_intent, and group_id. These are advisory fields and Runtime may ignore malformed values.",
		"Return only JSON matching candidateSchema.",
		`Resolved task intent: ${JSON.stringify(input.resolvedTask.task_intent)}`,
		`Resolved context profile: ${JSON.stringify(input.resolvedTask.context_profile)}`,
		`Directive count: ${input.directives.length}`,
		`Observation count: ${input.observations.length}`
	].join("\n");
}
function allowedIds(input) {
	return {
		directiveIds: input.directives.map((directive) => directive.id),
		observationIds: input.observations.map((observation) => observation.id)
	};
}
function semanticCacheKeyMaterial(input, kind) {
	return {
		kind,
		taskIntent: input.resolvedTask.task_intent,
		contextProfile: input.resolvedTask.context_profile,
		directiveIds: input.directives.map((directive) => directive.id),
		observationIds: input.observations.map((observation) => observation.id)
	};
}
//#endregion
export { loadSemanticCandidateProposalPayload, loadSemanticRelationProposalPayload, prepareSemanticCandidateContract, prepareSemanticCandidateContractBundle, prepareSemanticContractContext, prepareSemanticRelationContract, prepareSemanticRelationContractBundle, validateSemanticCandidateProposalPayload, validateSemanticRelationProposalPayload };
