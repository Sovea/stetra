import { parseYaml } from "./utils/yaml.mjs";
import { RCCL_SCOPE_BASES, validateCandidateObservationRecord, validateCandidateObservationShape } from "./validate-observation.mjs";
//#region src/validate-refresh.ts
const MIN_CONFIDENCE = .3;
const RETIRE_REASON_IDS = new Set([
	"file-missing",
	"snippet-drift",
	"scope-drift",
	"superseded",
	"no-longer-material",
	"other"
]);
function validateRcclObservationRefreshPayload(yamlText, validationOptions = {}) {
	let raw;
	try {
		raw = parseYaml(yamlText);
	} catch (error) {
		return rejectedDocument(`YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(raw)) return rejectedDocument("Refresh payload must be a YAML object.");
	const options = isStringArray(validationOptions) ? validationOptions.length > 0 ? { allowedObservationIds: validationOptions } : {} : validationOptions;
	const enforceAllowedIds = options.allowedObservationIds !== void 0;
	const enforceActiveIds = options.activeObservationIds !== void 0 || enforceAllowedIds;
	const allowedIds = new Set(options.allowedObservationIds ?? []);
	const activeIds = new Set(options.activeObservationIds ?? options.allowedObservationIds ?? []);
	const entries = [];
	const version = raw.version === "1.0" || raw.version === 1 ? "1.0" : null;
	const scope = typeof raw.scope === "string" ? raw.scope : null;
	const keep = normalizeKeepList(raw.keep, hasOwn(raw, "keep"));
	const revise = normalizeCandidateList(raw.revise, "revise", hasOwn(raw, "revise"));
	const retire = normalizeRetireList(raw.retire, hasOwn(raw, "retire"));
	const newObservations = normalizeCandidateList(raw.new_observations, "new_observations", hasOwn(raw, "new_observations"));
	const semanticEquivalence = normalizeSemanticEquivalenceList(raw.semantic_equivalence, hasOwn(raw, "semantic_equivalence"));
	const counterexamples = normalizeCounterexampleList(raw.counterexamples, hasOwn(raw, "counterexamples"));
	const keepIds = keep.map((entry) => entry.id).filter(Boolean);
	const reviseObservations = revise.map((entry) => entry.observation);
	const retireEntries = retire.map((entry) => entry.entry);
	const newObservationList = newObservations.map((entry) => entry.observation);
	const occurrences = buildIdOccurrences(keepIds, reviseObservations, retireEntries, newObservationList);
	if (!version) entries.push(rejected("document.version", "unsupported-value", "version must be \"1.0\"."));
	if (!scope) entries.push(rejected("document.scope", "missing-required-field", "scope is required."));
	validateKeepList(keep, activeIds, entries, occurrences, enforceActiveIds);
	validateCandidateList(revise, "revise", entries, {
		allowedIds,
		activeIds,
		enforceAllowedIds,
		enforceActiveIds,
		occurrences
	});
	validateRetireList(retire, activeIds, entries, occurrences, enforceActiveIds);
	validateCandidateList(newObservations, "new_observations", entries, {
		allowedIds,
		activeIds,
		enforceAllowedIds,
		enforceActiveIds,
		occurrences
	});
	validateSemanticEquivalenceList(semanticEquivalence, activeIds, entries, enforceActiveIds);
	validateCounterexampleList(counterexamples, activeIds, entries, enforceActiveIds);
	if (!keep.length && !revise.length && !retire.length && !newObservations.length) entries.push({
		status: "unused",
		reason: "empty-payload",
		path: "document",
		message: "Refresh payload contains no keep, revise, retire, or new_observations entries."
	});
	const diagnostics = buildDiagnostics(entries);
	const document = version && scope ? {
		version,
		generated_at: typeof raw.generated_at === "string" ? raw.generated_at : null,
		scope,
		keep: keepIds,
		revise: reviseObservations,
		retire: retireEntries,
		new_observations: newObservationList,
		...semanticEquivalence.length ? { semantic_equivalence: semanticEquivalence.map((entry) => entry.proposal) } : {},
		...counterexamples.length ? { counterexamples: counterexamples.map((entry) => entry.proposal) } : {}
	} : null;
	return {
		valid: Boolean(document) && diagnostics.summary.accepted > 0 && diagnostics.summary.rejected === 0,
		document,
		diagnostics
	};
}
function validateKeepList(keep, activeIds, entries, occurrences, enforceActiveIds) {
	for (const entry of keep) {
		const { id, path } = entry;
		if (entry.structureErrors.length) {
			entries.push({
				status: "rejected",
				reason: classifyStructureErrors(entry.structureErrors),
				path,
				message: entry.structureErrors.join("; "),
				observationId: id || void 0
			});
			continue;
		}
		if (isDuplicate(id, occurrences)) entries.push(rejected(`keep.${id}`, "duplicate-id", `Observation id "${id}" appears in multiple refresh actions.`, id));
		else if (enforceActiveIds && !activeIds.has(id)) entries.push(rejected(`keep.${id}`, "invalid-id", `Observation id "${id}" is not in the active observation id list.`, id));
		else entries.push(accepted(`keep.${id}`, `Observation "${id}" accepted as keep proposal.`, id));
	}
}
function validateCandidateList(observations, pathPrefix, entries, options) {
	const seen = /* @__PURE__ */ new Set();
	observations.forEach((entry) => {
		const observation = entry.observation;
		const path = entry.path;
		const id = observation.provisional_id;
		const structureErrors = dedupeErrors([...entry.structureErrors, ...validateCandidateObservationShape(observation, path)]);
		if (structureErrors.length) {
			entries.push({
				status: "rejected",
				reason: classifyStructureErrors(structureErrors),
				path,
				message: structureErrors.join("; "),
				observationId: id || void 0,
				confidence: Number.isFinite(observation.confidence) ? observation.confidence : void 0
			});
			return;
		}
		if (seen.has(id)) {
			entries.push(rejected(path, "duplicate-id", `Duplicate provisional_id "${id}".`, id));
			return;
		}
		seen.add(id);
		if (isDuplicate(id, options.occurrences)) {
			entries.push(rejected(path, "duplicate-id", `Observation id "${id}" appears in multiple refresh actions.`, id));
			return;
		}
		if (pathPrefix === "revise" && options.enforceActiveIds && !options.activeIds.has(id)) {
			entries.push(rejected(path, "invalid-id", `Revise provisional_id "${id}" must match an active observation id.`, id));
			return;
		}
		if (pathPrefix === "new_observations" && options.enforceAllowedIds && options.allowedIds.has(id)) {
			entries.push(rejected(path, "invalid-id", `New observation provisional_id "${id}" already exists.`, id));
			return;
		}
		if (observation.confidence < MIN_CONFIDENCE) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Confidence ${observation.confidence} is below minimum threshold ${MIN_CONFIDENCE}.`,
				observationId: id,
				confidence: observation.confidence
			});
			return;
		}
		entries.push(accepted(path, `Candidate "${id}" accepted as ${pathPrefix} proposal.`, id, observation.confidence));
	});
}
function validateRetireList(retire, activeIds, entries, occurrences, enforceActiveIds) {
	retire.forEach((item) => {
		const { entry, path } = item;
		if (item.structureErrors.length) {
			entries.push({
				status: "rejected",
				reason: classifyStructureErrors(item.structureErrors),
				path,
				message: item.structureErrors.join("; "),
				observationId: entry.observation_id || void 0,
				confidence: Number.isFinite(entry.confidence) ? entry.confidence : void 0
			});
			return;
		}
		if (!entry.observation_id) {
			entries.push(rejected(path, "missing-required-field", "Retire entry is missing observation_id."));
			return;
		}
		if (isDuplicate(entry.observation_id, occurrences)) {
			entries.push(rejected(path, "duplicate-id", `Observation id "${entry.observation_id}" appears in multiple refresh actions.`, entry.observation_id));
			return;
		}
		if (enforceActiveIds && !activeIds.has(entry.observation_id)) {
			entries.push(rejected(path, "invalid-id", `Observation id "${entry.observation_id}" is not in the active observation id list.`, entry.observation_id));
			return;
		}
		if (!RETIRE_REASON_IDS.has(entry.reason_id)) {
			entries.push(rejected(path, "unsupported-value", `Unsupported retire reason "${entry.reason_id}".`, entry.observation_id));
			return;
		}
		if (!Number.isFinite(entry.confidence) || entry.confidence < MIN_CONFIDENCE || entry.confidence > 1) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Retire confidence must be between ${MIN_CONFIDENCE} and 1.`,
				observationId: entry.observation_id,
				confidence: entry.confidence
			});
			return;
		}
		entries.push(accepted(path, `Retire proposal for "${entry.observation_id}" accepted.`, entry.observation_id, entry.confidence));
	});
}
function validateSemanticEquivalenceList(proposals, activeIds, entries, enforceActiveIds) {
	proposals.forEach((item) => {
		const { proposal, path } = item;
		if (item.structureErrors.length) {
			entries.push(rejected(path, classifyStructureErrors(item.structureErrors), item.structureErrors.join("; ")));
			return;
		}
		if (enforceActiveIds) {
			const invalidId = proposal.observation_ids.find((id) => !activeIds.has(id));
			if (invalidId) {
				entries.push(rejected(path, "invalid-id", `Semantic equivalence references non-active observation id "${invalidId}".`, invalidId));
				return;
			}
		}
		entries.push(accepted(path, `Semantic equivalence proposal for ${proposal.observation_ids.join(", ")} accepted for RCCL adjudication.`, proposal.observation_ids[0], proposal.confidence));
	});
}
function validateCounterexampleList(proposals, activeIds, entries, enforceActiveIds) {
	proposals.forEach((item) => {
		const { proposal, path } = item;
		if (item.structureErrors.length) {
			entries.push(rejected(path, classifyStructureErrors(item.structureErrors), item.structureErrors.join("; "), proposal.observation_id));
			return;
		}
		if (enforceActiveIds && !activeIds.has(proposal.observation_id)) {
			entries.push(rejected(path, "invalid-id", `Counterexample references non-active observation id "${proposal.observation_id}".`, proposal.observation_id));
			return;
		}
		entries.push(accepted(path, `Counterexample proposal for "${proposal.observation_id}" accepted for RCCL adjudication.`, proposal.observation_id, proposal.confidence));
	});
}
function buildIdOccurrences(keep, revise, retire, newObservations) {
	const occurrences = /* @__PURE__ */ new Map();
	const add = (id) => {
		if (!id) return;
		occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
	};
	keep.forEach(add);
	revise.forEach((item) => add(item.provisional_id));
	retire.forEach((item) => add(item.observation_id));
	newObservations.forEach((item) => add(item.provisional_id));
	return occurrences;
}
function isDuplicate(id, occurrences) {
	return (occurrences.get(id) ?? 0) > 1;
}
function rejectedDocument(message) {
	return {
		valid: false,
		document: null,
		diagnostics: buildDiagnostics([rejected("document", "malformed-payload", message)])
	};
}
function normalizeKeepList(value, fieldPresent) {
	if (!fieldPresent) return [];
	if (!Array.isArray(value)) return [{
		path: "keep",
		id: "",
		structureErrors: ["keep: must be an array"]
	}];
	return value.map((item, index) => {
		const path = `keep[${index}]`;
		if (!isNonEmptyString(item)) return {
			path,
			id: "",
			structureErrors: [`${path}: must be a non-empty string observation id`]
		};
		return {
			path,
			id: item.trim(),
			structureErrors: []
		};
	});
}
function normalizeCandidateList(value, pathPrefix, fieldPresent) {
	if (!fieldPresent) return [];
	if (!Array.isArray(value)) return [{
		path: pathPrefix,
		observation: emptyCandidateObservation(),
		structureErrors: [`${pathPrefix}: must be an array`]
	}];
	return value.map((item, index) => {
		const path = `${pathPrefix}[${index}]`;
		if (!isRecord(item)) return {
			path,
			observation: emptyCandidateObservation(),
			structureErrors: [`${path}: candidate observation must be an object`]
		};
		return {
			path,
			observation: normalizeCandidateObservation(item),
			structureErrors: validateCandidateObservationRecord(item, path)
		};
	});
}
function normalizeCandidateObservation(item) {
	return {
		provisional_id: stringValue(item.provisional_id),
		semantic_key: stringValue(item.semantic_key),
		category: stringValue(item.category),
		scope_hint: stringValue(item.scope_hint),
		pattern: stringValue(item.pattern),
		confidence: numberValue(item.confidence),
		adherence_quality: stringValue(item.adherence_quality),
		evidence: Array.isArray(item.evidence) ? item.evidence.filter(isRecord).map((evidence) => ({
			file: stringValue(evidence.file),
			line_range: normalizeLineRange(evidence.line_range),
			snippet: stringValue(evidence.snippet)
		})) : [],
		evidence_refs: normalizeEvidenceRefs(item.evidence_refs),
		counterexamples: normalizeEvidenceRefs(item.counterexamples),
		source_slice_ids: normalizeStringList(item.source_slice_ids),
		support_hint: isRecord(item.support_hint) ? {
			file_count: nullableNumber(item.support_hint.file_count),
			cluster_count: nullableNumber(item.support_hint.cluster_count),
			scope_basis: isScopeBasis(item.support_hint.scope_basis) ? item.support_hint.scope_basis : null
		} : null
	};
}
function emptyCandidateObservation() {
	return {
		provisional_id: "",
		semantic_key: "",
		category: "",
		scope_hint: "",
		pattern: "",
		confidence: NaN,
		adherence_quality: "",
		evidence: [],
		source_slice_ids: [],
		support_hint: null
	};
}
function normalizeRetireList(value, fieldPresent) {
	if (!fieldPresent) return [];
	if (!Array.isArray(value)) return [{
		path: "retire",
		entry: emptyRetireEntry(),
		structureErrors: ["retire: must be an array"]
	}];
	return value.map((item, index) => {
		const path = `retire[${index}]`;
		if (!isRecord(item)) return {
			path,
			entry: emptyRetireEntry(),
			structureErrors: [`${path}: retire entry must be an object`]
		};
		return {
			path,
			entry: normalizeRetireEntry(item),
			structureErrors: validateRetireEntryRecord(item, path)
		};
	});
}
function normalizeRetireEntry(item) {
	return {
		observation_id: stringValue(item.observation_id),
		reason_id: stringValue(item.reason_id),
		confidence: numberValue(item.confidence),
		evidence_refs: normalizeEvidenceRefs(item.evidence_refs)
	};
}
function emptyRetireEntry() {
	return {
		observation_id: "",
		reason_id: "",
		confidence: NaN
	};
}
function validateRetireEntryRecord(item, path) {
	const errors = [];
	if (!isNonEmptyString(item.observation_id)) errors.push(`${path}: missing or invalid 'observation_id'`);
	if (!isNonEmptyString(item.reason_id)) errors.push(`${path}: missing or invalid 'reason_id'`);
	if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence)) errors.push(`${path}: 'confidence' must be a number`);
	return errors;
}
function normalizeSemanticEquivalenceList(value, fieldPresent) {
	if (!fieldPresent) return [];
	if (!Array.isArray(value)) return [{
		path: "semantic_equivalence",
		proposal: emptySemanticEquivalenceProposal(),
		structureErrors: ["semantic_equivalence: must be an array"]
	}];
	return value.map((item, index) => {
		const path = `semantic_equivalence[${index}]`;
		if (!isRecord(item)) return {
			path,
			proposal: emptySemanticEquivalenceProposal(),
			structureErrors: [`${path}: semantic equivalence entry must be an object`]
		};
		return {
			path,
			proposal: {
				observation_ids: normalizeStringList(item.observation_ids),
				confidence: numberValue(item.confidence),
				evidence_refs: normalizeEvidenceRefs(item.evidence_refs),
				reason: stringValue(item.reason)
			},
			structureErrors: validateSemanticEquivalenceRecord(item, path)
		};
	});
}
function normalizeCounterexampleList(value, fieldPresent) {
	if (!fieldPresent) return [];
	if (!Array.isArray(value)) return [{
		path: "counterexamples",
		proposal: emptyCounterexampleProposal(),
		structureErrors: ["counterexamples: must be an array"]
	}];
	return value.map((item, index) => {
		const path = `counterexamples[${index}]`;
		if (!isRecord(item)) return {
			path,
			proposal: emptyCounterexampleProposal(),
			structureErrors: [`${path}: counterexample entry must be an object`]
		};
		return {
			path,
			proposal: {
				observation_id: stringValue(item.observation_id),
				confidence: numberValue(item.confidence),
				evidence_refs: normalizeEvidenceRefs(item.evidence_refs),
				reason: stringValue(item.reason)
			},
			structureErrors: validateCounterexampleRecord(item, path)
		};
	});
}
function validateSemanticEquivalenceRecord(item, path) {
	const errors = [];
	if (normalizeStringList(item.observation_ids).length < 2) errors.push(`${path}: observation_ids must contain at least two ids`);
	if (!Number.isFinite(numberValue(item.confidence)) || numberValue(item.confidence) < MIN_CONFIDENCE || numberValue(item.confidence) > 1) errors.push(`${path}: confidence must be between ${MIN_CONFIDENCE} and 1`);
	if (!validEvidenceRefs(item.evidence_refs)) errors.push(`${path}: evidence_refs must contain at least one valid evidence reference`);
	if (!isNonEmptyString(item.reason)) errors.push(`${path}: missing or invalid 'reason'`);
	return errors;
}
function validateCounterexampleRecord(item, path) {
	const errors = [];
	if (!isNonEmptyString(item.observation_id)) errors.push(`${path}: missing or invalid 'observation_id'`);
	if (!Number.isFinite(numberValue(item.confidence)) || numberValue(item.confidence) < MIN_CONFIDENCE || numberValue(item.confidence) > 1) errors.push(`${path}: confidence must be between ${MIN_CONFIDENCE} and 1`);
	if (!validEvidenceRefs(item.evidence_refs)) errors.push(`${path}: evidence_refs must contain at least one valid evidence reference`);
	if (!isNonEmptyString(item.reason)) errors.push(`${path}: missing or invalid 'reason'`);
	return errors;
}
function emptySemanticEquivalenceProposal() {
	return {
		observation_ids: [],
		confidence: NaN,
		evidence_refs: [],
		reason: ""
	};
}
function emptyCounterexampleProposal() {
	return {
		observation_id: "",
		confidence: NaN,
		evidence_refs: [],
		reason: ""
	};
}
function normalizeEvidenceRefs(value) {
	if (!Array.isArray(value)) return [];
	return value.filter(isEvidenceRef).map((ref) => ({
		kind: ref.kind,
		ref: ref.ref,
		...typeof ref.file === "string" ? { file: ref.file } : {},
		...Array.isArray(ref.line_range) && typeof ref.line_range[0] === "number" && typeof ref.line_range[1] === "number" ? { line_range: [ref.line_range[0], ref.line_range[1]] } : {},
		...typeof ref.snippet_hash === "string" ? { snippet_hash: ref.snippet_hash } : {},
		...typeof ref.command === "string" ? { command: ref.command } : {},
		...typeof ref.output_hash === "string" ? { output_hash: ref.output_hash } : {}
	}));
}
function validEvidenceRefs(value) {
	return Array.isArray(value) && value.length > 0 && value.every(isEvidenceRef);
}
function isEvidenceRef(value) {
	if (!isRecord(value)) return false;
	return isEvidenceRefKind(value.kind) && isNonEmptyString(value.ref) && (value.file === void 0 || typeof value.file === "string") && (value.line_range === void 0 || Array.isArray(value.line_range) && typeof value.line_range[0] === "number" && typeof value.line_range[1] === "number") && (value.snippet_hash === void 0 || typeof value.snippet_hash === "string") && (value.command === void 0 || typeof value.command === "string") && (value.output_hash === void 0 || typeof value.output_hash === "string");
}
function isEvidenceRefKind(value) {
	return value === "file" || value === "diff" || value === "command" || value === "rccl-evidence" || value === "runtime-trace" || value === "conversation";
}
function normalizeStringList(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}
function normalizeLineRange(value) {
	return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]] : [0, 0];
}
function nullableNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function numberValue(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}
function stringValue(value) {
	return typeof value === "string" ? value.trim() : "";
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function accepted(path, message, observationId, confidence) {
	return {
		status: "accepted",
		reason: "accepted",
		path,
		message,
		observationId,
		confidence
	};
}
function rejected(path, reason, message, observationId) {
	return {
		status: "rejected",
		reason,
		path,
		message,
		observationId
	};
}
function buildDiagnostics(entries) {
	const summary = {
		total: entries.length,
		accepted: 0,
		rejected: 0,
		unused: 0
	};
	for (const entry of entries) summary[entry.status] += 1;
	return {
		kind: "rccl-observation-refresh",
		summary,
		entries
	};
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hasOwn(record, key) {
	return Object.prototype.hasOwnProperty.call(record, key);
}
function isStringArray(value) {
	return Array.isArray(value);
}
function classifyStructureErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("missing") || joined.includes("must be a non-empty")) return "missing-required-field";
	if (joined.includes("must be an array") || joined.includes("must be an object")) return "malformed-payload";
	return "unsupported-value";
}
function dedupeErrors(errors) {
	return Array.from(new Set(errors));
}
function isScopeBasis(value) {
	return RCCL_SCOPE_BASES.has(String(value));
}
//#endregion
export { validateRcclObservationRefreshPayload };
