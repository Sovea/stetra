import { deriveScope, deriveSupport } from "./derive-support.mjs";
//#region src/consolidate/consolidate-observations.ts
function consolidateObservations(candidates) {
	const groups = [];
	for (const candidate of candidates) {
		const matchedGroup = groups.find((group) => candidatesOverlap(group, candidate));
		if (matchedGroup) matchedGroup.push(candidate);
		else groups.push([candidate]);
	}
	const observations = [];
	const reportGroups = [];
	const orderedGroups = groups.slice().sort((a, b) => buildStableGroupKey(a).localeCompare(buildStableGroupKey(b)));
	for (const groupCandidates of orderedGroups) {
		const mergedEvidence = dedupeEvidence(groupCandidates.flatMap((item) => item.evidence));
		const source_slice_ids = Array.from(new Set(groupCandidates.flatMap((item) => item.source_slice_ids))).sort();
		const scopeHint = preferScopeHint(groupCandidates);
		const support = deriveSupport({
			scope_hint: scopeHint,
			source_slice_ids,
			support_hint: mergeSupportHints(groupCandidates)
		}, mergedEvidence);
		const final_scope = deriveScope(scopeHint, support, mergedEvidence);
		const confidence = Number(groupCandidates.reduce((max, item) => Math.max(max, item.confidence), 0).toFixed(2));
		const adherence_quality = reduceAdherence(groupCandidates.map((item) => item.adherence_quality));
		const representative = pickRepresentative(groupCandidates);
		const id = normalizeConsolidatedId(representative.provisional_id, representative.semantic_key, representative.category, observations.length);
		const traits = mergeTraits(groupCandidates);
		observations.push({
			id,
			semantic_key: representative.semantic_key,
			candidate_ids: groupCandidates.map((item) => item.provisional_id).sort(),
			category: representative.category,
			scope_hint: scopeHint,
			pattern: normalizePattern(representative.pattern),
			confidence,
			adherence_quality,
			evidence: mergedEvidence,
			source_slice_ids,
			support,
			...traits ? { traits } : {}
		});
		reportGroups.push({
			id,
			semantic_key: representative.semantic_key,
			candidate_ids: groupCandidates.map((item) => item.provisional_id).sort(),
			category: representative.category,
			pattern: normalizePattern(representative.pattern),
			source_slice_ids,
			evidence_files: Array.from(new Set(mergedEvidence.map((item) => item.file))).sort(),
			merge_basis: describeMergeBasis(groupCandidates),
			support_derivation_reason: describeSupportDerivation(support, mergedEvidence),
			scope_derivation_reason: describeScopeDerivation(scopeHint, support, final_scope),
			derived_support: support,
			final_scope
		});
	}
	return {
		observations,
		report: {
			candidate_count: candidates.length,
			merged_group_count: orderedGroups.length,
			final_observation_count: observations.length,
			groups: reportGroups
		}
	};
}
function materializeRcclObservations(consolidated) {
	return consolidated.map((item) => ({
		id: item.id,
		semantic_key: item.semantic_key,
		category: item.category,
		scope: deriveScope(item.scope_hint, item.support, item.evidence),
		pattern: item.pattern,
		confidence: item.confidence,
		adherence_quality: item.adherence_quality,
		evidence: item.evidence,
		support: item.support,
		...item.traits ? { traits: item.traits } : {},
		verification: {
			evidence_status: null,
			evidence_verified_count: null,
			evidence_confidence: null,
			induction_status: null,
			induction_confidence: null,
			checked_at: null,
			disposition: null
		}
	}));
}
function candidatesOverlap(group, candidate) {
	return group.some((existing) => candidatePairMatches(existing, candidate));
}
function candidatePairMatches(a, b) {
	if (a.category !== b.category) return false;
	if (a.semantic_key !== b.semantic_key) return false;
	const aFiles = new Set(a.evidence.map((item) => normalizePath(item.file)).filter(Boolean));
	const bFiles = new Set(b.evidence.map((item) => normalizePath(item.file)).filter(Boolean));
	const aSlices = new Set(a.source_slice_ids);
	const bSlices = new Set(b.source_slice_ids);
	return hasSetOverlap(aFiles, bFiles) || hasSetOverlap(aSlices, bSlices);
}
function hasSetOverlap(a, b) {
	for (const item of a) if (b.has(item)) return true;
	return false;
}
function buildStableGroupKey(group) {
	const representative = pickRepresentative(group);
	const evidenceFiles = Array.from(new Set(group.flatMap((item) => item.evidence.map((evidence) => normalizePath(evidence.file))).filter(Boolean))).sort();
	const sourceSlices = Array.from(new Set(group.flatMap((item) => item.source_slice_ids))).sort();
	return [
		representative.category,
		representative.semantic_key,
		normalizePattern(representative.pattern),
		evidenceFiles.join(","),
		sourceSlices.join(",")
	].join("::");
}
function pickRepresentative(group) {
	return group.slice().sort((a, b) => {
		const semanticCompare = a.semantic_key.localeCompare(b.semantic_key);
		if (semanticCompare !== 0) return semanticCompare;
		const patternCompare = normalizePattern(a.pattern).localeCompare(normalizePattern(b.pattern));
		if (patternCompare !== 0) return patternCompare;
		return a.provisional_id.localeCompare(b.provisional_id);
	})[0];
}
function dedupeEvidence(evidence) {
	const unique = /* @__PURE__ */ new Map();
	for (const item of evidence) {
		const normalized = {
			file: normalizePath(item.file),
			line_range: [item.line_range[0], item.line_range[1]],
			snippet: item.snippet
		};
		const key = `${normalized.file}:${normalized.line_range[0]}-${normalized.line_range[1]}:${normalized.snippet}`;
		if (!unique.has(key)) unique.set(key, normalized);
	}
	return Array.from(unique.values()).sort((a, b) => {
		const fileCompare = a.file.localeCompare(b.file);
		if (fileCompare !== 0) return fileCompare;
		if (a.line_range[0] !== b.line_range[0]) return a.line_range[0] - b.line_range[0];
		return a.line_range[1] - b.line_range[1];
	});
}
function preferScopeHint(candidates) {
	return candidates.map((item) => item.scope_hint.trim()).filter(Boolean).sort((a, b) => scoreScopeHint(b) - scoreScopeHint(a) || a.localeCompare(b))[0] ?? "**";
}
function scoreScopeHint(scope) {
	if (scope === "**") return 0;
	if (scope.includes("*")) return 1;
	return 2;
}
function mergeSupportHints(candidates) {
	let scope_basis = null;
	let file_count = null;
	let cluster_count = null;
	for (const candidate of candidates) {
		if (candidate.support_hint?.scope_basis != null) scope_basis = candidate.support_hint.scope_basis;
		if (candidate.support_hint?.file_count != null) file_count = Math.max(file_count ?? 0, candidate.support_hint.file_count);
		if (candidate.support_hint?.cluster_count != null) cluster_count = Math.max(cluster_count ?? 0, candidate.support_hint.cluster_count);
	}
	if (scope_basis == null && file_count == null && cluster_count == null) return null;
	return {
		scope_basis: scope_basis ?? null,
		file_count,
		cluster_count
	};
}
function reduceAdherence(values) {
	if (values.includes("poor")) return "poor";
	if (values.includes("inconsistent")) return "inconsistent";
	return "good";
}
function mergeTraits(candidates) {
	const traits = {
		legacy: candidates.some((item) => item.traits?.legacy === true) || void 0,
		migration_boundary: candidates.some((item) => item.traits?.migration_boundary === true) || void 0,
		anti_pattern: candidates.some((item) => item.traits?.anti_pattern === true) || void 0,
		compatibility_boundary: candidates.some((item) => item.traits?.compatibility_boundary === true) || void 0
	};
	return Object.values(traits).some((value) => value !== void 0) ? traits : void 0;
}
function describeMergeBasis(group) {
	if (group.length === 1) return "single candidate group; no merge needed";
	const evidenceFiles = Array.from(new Set(group.flatMap((item) => item.evidence.map((evidence) => normalizePath(evidence.file))).filter(Boolean))).sort();
	const sourceSlices = Array.from(new Set(group.flatMap((item) => item.source_slice_ids))).sort();
	return `merged ${group.length} candidates by matching category + semantic_key with overlapping evidence files or source slices; semantic_key=${group[0]?.semantic_key ?? "(unknown)"}; evidence_files=${evidenceFiles.join(", ") || "(none)"}; source_slices=${sourceSlices.join(", ") || "(none)"}`;
}
function describeSupportDerivation(support, evidence) {
	return `derived from ${Array.from(new Set(evidence.map((item) => normalizePath(item.file)).filter(Boolean))).sort().length} evidence files and ${support.source_slices.length} source slices; scope_basis=${support.scope_basis}; file_count=${support.file_count}; cluster_count=${support.cluster_count}`;
}
function describeScopeDerivation(scopeHint, support, finalScope) {
	return `started from scope_hint=${scopeHint || "**"}; derived final scope ${finalScope} from scope_basis=${support.scope_basis}`;
}
function normalizePattern(pattern) {
	return pattern.replace(/\s+/g, " ").trim();
}
function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizeSemanticKey(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function normalizeConsolidatedId(id, semanticKey, category, index) {
	if (/^obs-[a-z0-9-]+$/.test(id)) return id;
	return `obs-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pattern"}-${normalizeSemanticKey(semanticKey).slice(0, 48) || `candidate-${index + 1}`}`;
}
//#endregion
export { consolidateObservations, materializeRcclObservations };
