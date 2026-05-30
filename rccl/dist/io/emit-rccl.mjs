import { toYaml } from "../utils/yaml.mjs";
import { parseRccl } from "./parse-rccl.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
//#region src/io/emit-rccl.ts
function emitRccl(rccl, projectRoot) {
	const outputDir = join(projectRoot, ".resonant-code");
	const outputPath = join(outputDir, "rccl.yaml");
	if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
	const existing = loadExistingRccl(outputPath);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const gitRef = getGitRef(projectRoot);
	const existingById = new Map(existing?.observations.map((observation) => [observation.id, observation]) ?? []);
	const activeObservations = rccl.observations.map((observation) => materializeActiveLifecycle(observation, existingById.get(observation.id), gitRef, now));
	const finalObservations = materializeHistoricalObservations(activeObservations, existingById, gitRef).sort((a, b) => a.id.localeCompare(b.id));
	const stats = summarizeLifecycleStats(finalObservations, activeObservations, existingById);
	const finalDoc = {
		version: "1.0",
		generated_at: now,
		git_ref: gitRef,
		observations: finalObservations
	};
	const verificationSummary = summarizeVerification(finalDoc);
	const serialized = serializeRccl(finalDoc);
	writeFileSync(outputPath, serialized, "utf-8");
	return {
		written: ".resonant-code/rccl.yaml",
		history_written: writeRcclHistorySnapshot(projectRoot, finalDoc, serialized),
		stats,
		verification_summary: verificationSummary
	};
}
function summarizeVerification(rccl) {
	const observations = rccl.observations.map((item) => ({
		id: item.id,
		disposition: item.verification.disposition,
		evidence_status: item.verification.evidence_status,
		induction_status: item.verification.induction_status,
		evidence_verified_count: item.verification.evidence_verified_count,
		evidence_total_count: item.evidence.length,
		support: item.support
	}));
	const evidenceStatusCounts = {
		pending: 0,
		verified: 0,
		partial: 0,
		failed: 0,
		unverifiable: 0
	};
	const inductionStatusCounts = {
		pending: 0,
		"well-supported": 0,
		"narrowly-supported": 0,
		overgeneralized: 0,
		ambiguous: 0
	};
	for (const item of observations) {
		evidenceStatusCounts[item.evidence_status ?? "pending"] += 1;
		inductionStatusCounts[item.induction_status ?? "pending"] += 1;
	}
	return {
		total_observations: observations.length,
		kept_count: observations.filter((item) => item.disposition === "keep").length,
		reduced_confidence_count: observations.filter((item) => item.disposition === "keep-with-reduced-confidence").length,
		demoted_count: observations.filter((item) => item.disposition === "demote-to-ambient").length,
		evidence_status_counts: evidenceStatusCounts,
		induction_status_counts: inductionStatusCounts,
		observations
	};
}
function writeCandidateArtifact(projectRoot, candidates) {
	return writeContextArtifact(projectRoot, "rccl-candidates", "json", JSON.stringify(candidates, null, 2), {
		kind: "candidates",
		observations: candidates.observations.length,
		ids: candidates.observations.map((item) => item.provisional_id)
	});
}
function writeConsolidationArtifact(projectRoot, consolidation, finalDocument) {
	const verificationSummary = summarizeVerification(finalDocument);
	const demotions = verificationSummary.observations.filter((item) => item.disposition === "demote-to-ambient" || item.disposition === "keep-with-reduced-confidence").map((item) => ({
		...item,
		failure_reason: describeVerificationFailure(item)
	}));
	return writeContextArtifact(projectRoot, "rccl-consolidation", "json", JSON.stringify({
		...consolidation.report,
		verification_summary: verificationSummary,
		verification_demotion_summary: {
			demotion_count: demotions.filter((item) => item.disposition === "demote-to-ambient").length,
			reduced_confidence_count: demotions.filter((item) => item.disposition === "keep-with-reduced-confidence").length,
			observations: demotions
		},
		final_observations: finalDocument.observations.map((item) => ({
			id: item.id,
			scope: item.scope,
			pattern: item.pattern,
			support: item.support,
			verification: item.verification
		}))
	}, null, 2), {
		kind: "consolidation",
		groups: consolidation.report.merged_group_count,
		finals: finalDocument.observations.length,
		ids: finalDocument.observations.map((item) => item.id)
	});
}
function describeVerificationFailure(item) {
	if (item.disposition === "demote-to-ambient") {
		if (item.evidence_status === "failed") return "all evidence snippets failed static verification against current source";
		if (item.evidence_status === "unverifiable") return "evidence could not be verified statically";
		if (item.induction_status === "overgeneralized") return `scope basis ${item.support.scope_basis} is broader than the verified evidence supports`;
		return "verification demoted this observation to ambient";
	}
	if (item.disposition === "keep-with-reduced-confidence") {
		if (item.evidence_status === "partial") return `only ${item.evidence_verified_count ?? 0}/${item.evidence_total_count} evidence snippets verified statically`;
		if (item.induction_status === "narrowly-supported") return `support basis ${item.support.scope_basis} is valid but only narrowly supported by verified evidence`;
		return "verification reduced confidence for this observation";
	}
	return "verification kept this observation";
}
function serializeRccl(rccl) {
	return toYaml({
		version: rccl.version,
		generated_at: rccl.generated_at,
		git_ref: rccl.git_ref,
		observations: rccl.observations.map((observation) => ({
			id: observation.id,
			semantic_key: observation.semantic_key,
			category: observation.category,
			scope: observation.scope,
			pattern: observation.pattern,
			confidence: observation.confidence,
			adherence_quality: observation.adherence_quality,
			evidence: observation.evidence,
			support: observation.support,
			verification: {
				evidence_status: observation.verification.evidence_status,
				evidence_verified_count: observation.verification.evidence_verified_count,
				evidence_confidence: observation.verification.evidence_confidence,
				induction_status: observation.verification.induction_status,
				induction_confidence: observation.verification.induction_confidence,
				checked_at: observation.verification.checked_at,
				disposition: observation.verification.disposition
			},
			lifecycle: serializeLifecycle(observation)
		}))
	});
}
function serializeLifecycle(observation) {
	const lifecycle = observation.lifecycle;
	if (lifecycle == null) return void 0;
	return {
		first_seen_git_ref: lifecycle.first_seen_git_ref,
		last_seen_git_ref: lifecycle.last_seen_git_ref,
		last_verified_at: lifecycle.last_verified_at,
		content_fingerprint: lifecycle.content_fingerprint,
		status: lifecycle.status,
		...lifecycle.supersedes ? { supersedes: lifecycle.supersedes } : {},
		...lifecycle.superseded_by ? { superseded_by: lifecycle.superseded_by } : {},
		...lifecycle.stale_since_git_ref ? { stale_since_git_ref: lifecycle.stale_since_git_ref } : {},
		...lifecycle.superseded_at_git_ref ? { superseded_at_git_ref: lifecycle.superseded_at_git_ref } : {}
	};
}
function materializeActiveLifecycle(observation, previous, gitRef, checkedAt) {
	const contentFingerprint = fingerprintObservation(observation);
	return {
		...observation,
		lifecycle: {
			first_seen_git_ref: previous?.lifecycle?.first_seen_git_ref ?? gitRef,
			last_seen_git_ref: gitRef,
			last_verified_at: observation.verification.checked_at ?? checkedAt,
			content_fingerprint: contentFingerprint,
			status: "active",
			supersedes: observation.lifecycle?.supersedes ?? previous?.lifecycle?.supersedes,
			superseded_by: void 0,
			stale_since_git_ref: void 0,
			superseded_at_git_ref: void 0
		}
	};
}
function materializeHistoricalObservations(activeObservations, existingById, gitRef) {
	const currentIds = new Set(activeObservations.map((observation) => observation.id));
	const supersededById = /* @__PURE__ */ new Map();
	for (const observation of activeObservations) for (const supersededId of observation.lifecycle?.supersedes ?? []) if (!currentIds.has(supersededId)) supersededById.set(supersededId, observation.id);
	const historicalObservations = Array.from(existingById.values()).flatMap((previous) => {
		if (currentIds.has(previous.id)) return [];
		const supersededBy = supersededById.get(previous.id);
		if (supersededBy) return [materializeSupersededLifecycle(previous, supersededBy, gitRef)];
		if (previous.lifecycle?.status === "superseded") return [previous];
		return [materializeStaleLifecycle(previous, gitRef)];
	});
	return [...activeObservations, ...historicalObservations];
}
function materializeStaleLifecycle(observation, gitRef) {
	return {
		...observation,
		lifecycle: {
			first_seen_git_ref: observation.lifecycle?.first_seen_git_ref ?? gitRef,
			last_seen_git_ref: observation.lifecycle?.last_seen_git_ref ?? gitRef,
			last_verified_at: observation.lifecycle?.last_verified_at ?? observation.verification.checked_at,
			content_fingerprint: observation.lifecycle?.content_fingerprint || fingerprintObservation(observation),
			status: "stale",
			supersedes: observation.lifecycle?.supersedes,
			superseded_by: observation.lifecycle?.superseded_by,
			stale_since_git_ref: observation.lifecycle?.stale_since_git_ref ?? gitRef,
			superseded_at_git_ref: observation.lifecycle?.superseded_at_git_ref
		}
	};
}
function materializeSupersededLifecycle(observation, supersededBy, gitRef) {
	return {
		...observation,
		lifecycle: {
			first_seen_git_ref: observation.lifecycle?.first_seen_git_ref ?? gitRef,
			last_seen_git_ref: observation.lifecycle?.last_seen_git_ref ?? gitRef,
			last_verified_at: observation.lifecycle?.last_verified_at ?? observation.verification.checked_at,
			content_fingerprint: observation.lifecycle?.content_fingerprint || fingerprintObservation(observation),
			status: "superseded",
			supersedes: observation.lifecycle?.supersedes,
			superseded_by: supersededBy,
			stale_since_git_ref: observation.lifecycle?.stale_since_git_ref,
			superseded_at_git_ref: observation.lifecycle?.superseded_at_git_ref ?? gitRef
		}
	};
}
function summarizeLifecycleStats(observations, activeObservations, existingById) {
	let added = 0;
	let updated = 0;
	let preserved = 0;
	for (const observation of activeObservations) {
		const previous = existingById.get(observation.id);
		if (!previous) {
			added += 1;
			continue;
		}
		if ((previous.lifecycle?.content_fingerprint || fingerprintObservation(previous)) === observation.lifecycle?.content_fingerprint) preserved += 1;
		else updated += 1;
	}
	const stale = observations.filter((observation) => observation.lifecycle?.status === "stale").length;
	const superseded = observations.filter((observation) => observation.lifecycle?.status === "superseded").length;
	return {
		added,
		updated,
		preserved,
		stale,
		superseded
	};
}
function fingerprintObservation(observation) {
	const stableObservation = {
		id: observation.id,
		semantic_key: observation.semantic_key,
		category: observation.category,
		scope: observation.scope,
		pattern: observation.pattern,
		confidence: observation.confidence,
		adherence_quality: observation.adherence_quality,
		evidence: observation.evidence,
		support: observation.support
	};
	return createHash("sha1").update(stableStringify(stableObservation)).digest("hex");
}
function stableStringify(value) {
	return JSON.stringify(canonicalize(value));
}
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}
function writeRcclHistorySnapshot(projectRoot, rccl, serialized) {
	const gitRef = rccl.git_ref ?? "unknown";
	const relativePath = join(".resonant-code", "context", "rccl-history", `${(rccl.generated_at ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[-:.TZ]/g, "").slice(0, 14)}-${gitRef}-${createHash("sha1").update(serialized).digest("hex").slice(0, 10)}.yaml`);
	const absolutePath = join(projectRoot, relativePath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, serialized, "utf-8");
	return relativePath;
}
function loadExistingRccl(outputPath) {
	try {
		const parsed = parseRccl(readFileSync(outputPath, "utf-8"), { allowVerifiedFields: true });
		return parsed.valid ? parsed.data ?? null : null;
	} catch {
		return null;
	}
}
function getGitRef(projectRoot) {
	try {
		return execSync("git rev-parse --short HEAD", {
			cwd: projectRoot,
			encoding: "utf-8",
			timeout: 5e3,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim();
	} catch {
		return "unknown";
	}
}
function writeContextArtifact(projectRoot, folder, extension, content, seed) {
	const digest = createHash("sha1").update(JSON.stringify(seed)).digest("hex").slice(0, 10);
	const path = join(projectRoot, ".resonant-code", "context", folder, `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${digest}.${extension}`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
	return path;
}
//#endregion
export { emitRccl, serializeRccl, summarizeVerification, writeCandidateArtifact, writeConsolidationArtifact };
