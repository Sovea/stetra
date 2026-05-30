import { minimatch } from "../../utils/glob.mjs";
import { stableHash } from "../../utils/hash.mjs";
import { proposeFeedbackRelations } from "./propose-feedback-relations.mjs";
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
	const category = categoryRelated(directive, observation);
	if (!semanticKey && !category) return null;
	const evidence = hasVerifiedEvidence(observation);
	const relation = inferRuntimeRelation(directive, observation, {
		taskScoped,
		semanticKey,
		category,
		evidence,
		ambientOnly: observation.lifecycle.status === "stale" || observation.verification.disposition === "demote-to-ambient"
	});
	if (!relation) return null;
	const signals = buildRuntimeSignals(directive, observation, taskScoped, semanticKey, category, relation);
	const conflictClass = inferConflictClass(directive, observation, relation);
	return {
		irVersion: "governance-ir/v1",
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
		confidence: runtimeRelationConfidence(observation, semanticKey, category, relation),
		basis: {
			scope: taskScoped,
			semanticKey,
			category,
			evidence,
			hostReasoning: false,
			feedback: false
		},
		signals,
		evidenceRefs: observationEvidenceRefs(observation),
		reasoningSummary: summarizeRuntimeProposal(directive, observation, relation, {
			semanticKey,
			category
		}),
		impact: defaultImpact(relation),
		reviewPriority: defaultReviewPriority(directive, relation),
		adjudication: {
			status: "accepted",
			finalRelation: relation,
			reason: "initial runtime structural fallback relation proposal before adjudication"
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
		irVersion: "governance-ir/v1",
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
function inferRuntimeRelation(directive, observation, basis) {
	if (basis.ambientOnly) return "ambient-only";
	if (!basis.taskScoped || !basis.evidence) return null;
	if (isAntiPatternRelationCandidate(directive, observation, basis)) return "suppress";
	if (isCompatibilityTensionCandidate(directive, observation)) return "tension";
	if (basis.semanticKey || basis.category) return observation.adherence.quality === "good" ? "reinforce" : "tension";
	return null;
}
function isAntiPatternRelationCandidate(directive, observation, basis) {
	if (!observation.traits.antiPattern && directive.kind !== "anti-pattern") return false;
	return basis.semanticKey || basis.category || observation.traits.antiPattern;
}
function isCompatibilityTensionCandidate(directive, observation) {
	return (directive.traits.compatibilitySensitive || directive.traits.migrationSensitive) && (observation.traits.compatibilityBoundary || observation.traits.legacy || observation.traits.migrationBoundary);
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
function buildRuntimeSignals(directive, observation, taskScoped, semanticKey, category, relation) {
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
		}] : [],
		...category ? [{
			kind: "category",
			strength: "weak",
			direction: relationToSignalDirection(relation),
			reason: `directive traits match observation category or traits for ${directive.id}/${observation.id}`
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
function runtimeRelationConfidence(observation, semanticKey, category, relation) {
	const verificationConfidence = Math.max(observation.verification.evidenceConfidence, observation.verification.inductionConfidence, observation.adherence.confidence);
	return Number(Math.min(1, Math.max(verificationConfidence, relation === "suppress" ? .8 : semanticKey ? .75 : category ? .65 : .35)).toFixed(2));
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
function summarizeRuntimeProposal(directive, observation, relation, basis) {
	if (relation === "ambient-only") return "runtime structural fallback kept this observation ambient because lifecycle or verification prevents execution influence";
	return `${relation} fallback proposed by deterministic structural signals from ${[basis.semanticKey ? "semantic-key overlap" : "", basis.category ? "category/trait match" : ""].filter(Boolean).join(" and ") || "verified repository context"} between ${directive.id} and ${observation.id}`;
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
function categoryRelated(directive, observation) {
	if (directive.traits.compatibilitySensitive && observation.traits.compatibilityBoundary) return true;
	if (directive.traits.migrationSensitive && (observation.traits.migrationBoundary || observation.traits.legacy)) return true;
	if (directive.traits.safetyCritical && observation.category === "constraint") return true;
	if (directive.traits.broadScope && (observation.category === "architecture" || observation.category === "pattern")) return true;
	if (directive.kind === "anti-pattern" && observation.traits.antiPattern) return true;
	if (directive.kind === "architecture" && observation.category === "architecture") return true;
	if (directive.kind === "constraint" && observation.category === "constraint") return true;
	if ((directive.kind === "convention" || directive.kind === "preference") && (observation.category === "style" || observation.category === "pattern")) return true;
	return false;
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
function pathMatchesScope(path, scope) {
	if (scope === "*" || scope === "**/*") return true;
	if (scope.includes("*") || scope.includes("?") || scope.includes("{")) return minimatch(path, scope);
	return path === scope || path.startsWith(`${scope}/`);
}
//#endregion
export { proposeSemanticRelations };
