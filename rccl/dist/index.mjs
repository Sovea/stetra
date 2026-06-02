import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
//#region src/indexing/build-repo-index.ts
const SOURCE_EXTENSIONS = new Map([
	[".ts", "typescript"],
	[".tsx", "typescript"],
	[".js", "javascript"],
	[".jsx", "javascript"],
	[".mjs", "javascript"],
	[".cjs", "javascript"],
	[".py", "python"],
	[".go", "go"],
	[".rs", "rust"],
	[".java", "java"],
	[".kt", "kotlin"],
	[".swift", "swift"],
	[".vue", "vue"],
	[".svelte", "svelte"],
	[".astro", "astro"]
]);
const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	"coverage",
	"__pycache__",
	".resonant-code",
	".playbook",
	"vendor",
	"target"
]);
function buildRepoIndex(projectRoot, scopeGlob = "auto") {
	const allFiles = walkDir(projectRoot, projectRoot);
	return (scopeGlob === "auto" ? autoScope(allFiles) : allFiles.filter((file) => matchScope(file, scopeGlob))).map((file) => indexFile(projectRoot, file)).filter((value) => Boolean(value));
}
function walkDir(dir, projectRoot) {
	const results = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		if (IGNORE_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walkDir(full, projectRoot));
		else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) results.push(relative(projectRoot, full).replace(/\\/g, "/"));
	}
	return results;
}
function autoScope(files) {
	return [...files].sort();
}
function matchScope(file, scopeGlob) {
	if (scopeGlob === "**" || scopeGlob === "**/*") return true;
	if (scopeGlob.endsWith("/**")) return file.startsWith(scopeGlob.slice(0, -3));
	if (scopeGlob.includes("*")) {
		const escaped = scopeGlob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
		return new RegExp(`^${escaped}$`).test(file);
	}
	return file === scopeGlob || file.startsWith(`${scopeGlob}/`);
}
function indexFile(projectRoot, file) {
	try {
		const content = readFileSync(join(projectRoot, file), "utf-8").replace(/\r\n/g, "\n");
		const lines = content.split("\n");
		const language = SOURCE_EXTENSIONS.get(extname(file)) ?? "unknown";
		const imports = content.match(/\b(import|require|from)\b/g)?.length ?? 0;
		const exports = content.match(/\b(export|module\.exports|pub\s+|func\s+[A-Z]|class\s+)\b/g)?.length ?? 0;
		const symbolMatches = content.match(/\b(function|class|interface|type|const|let|var|def|fn|struct|enum|trait)\b/g)?.length ?? 0;
		const packageRoot = inferPackageRoot(file);
		return {
			path: file,
			language,
			lines: lines.length,
			is_test: /(test|spec)\./.test(file) || file.includes("__tests__"),
			is_generated: /generated|gen\./.test(file),
			package_root: packageRoot,
			imports_count: imports,
			exports_count: exports,
			symbol_density: lines.length === 0 ? 0 : Number((symbolMatches / lines.length).toFixed(3)),
			role_hints: []
		};
	} catch {
		return null;
	}
}
function inferPackageRoot(file) {
	const [root] = file.split("/");
	return root || ".";
}
//#endregion
//#region src/utils/yaml.ts
function parseYaml(text) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	function stripQuotes(value) {
		const trimmed = value.trim();
		if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
		return trimmed;
	}
	function parseScalar(raw) {
		const value = stripQuotes(raw);
		if (value === "null") return null;
		if (value === "true") return true;
		if (value === "false") return false;
		if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
		if (value.startsWith("[") && value.endsWith("]")) {
			const inner = value.slice(1, -1).trim();
			if (inner === "") return [];
			return inner.split(",").map((part) => parseScalar(part.trim()));
		}
		return value;
	}
	function isClosedQuoted(value) {
		const trimmed = value.trim();
		if (!trimmed) return true;
		if (trimmed.startsWith("\"")) return trimmed.endsWith("\"") && trimmed.length > 1;
		if (trimmed.startsWith("'")) return trimmed.endsWith("'") && trimmed.length > 1;
		return true;
	}
	function readQuotedScalar(startValue, startIndex, parentIndent) {
		const parts = [startValue.trim()];
		let index = startIndex + 1;
		while (index < lines.length && !isClosedQuoted(parts.join("\n"))) {
			const raw = lines[index];
			const trimmed = raw.trim();
			const indent = raw.search(/\S/);
			if (trimmed && indent <= parentIndent && (trimmed.includes(":") || trimmed.startsWith("- ")) && isClosedQuoted(parts.join("\n"))) break;
			if (!trimmed.startsWith("#")) parts.push(raw);
			index += 1;
		}
		return {
			value: stripQuotes(parts.join("\n").trim()),
			nextIndex: index
		};
	}
	function skipEmpty(index) {
		let cursor = index;
		while (cursor < lines.length) {
			const trimmed = lines[cursor].trim();
			if (trimmed && !trimmed.startsWith("#")) break;
			cursor += 1;
		}
		return cursor;
	}
	function lineIndent(index) {
		return lines[index].search(/\S/);
	}
	function readBlockScalar(startIndex, parentIndent, style) {
		const content = [];
		let index = startIndex;
		let blockIndent = -1;
		while (index < lines.length) {
			const raw = lines[index];
			const trimmed = raw.trim();
			const indent = raw.search(/\S/);
			if (trimmed && indent <= parentIndent) break;
			if (blockIndent === -1 && trimmed) blockIndent = indent;
			if (!trimmed) content.push("");
			else content.push(raw.slice(Math.max(blockIndent, 0)));
			index += 1;
		}
		return {
			value: style === ">" ? content.map((line, idx) => line === "" ? "\n" : `${idx > 0 && content[idx - 1] !== "" ? " " : ""}${line}`).join("").trim() : content.join("\n").trim(),
			nextIndex: index
		};
	}
	function parseInlineMap(remainder, indent, index) {
		const colon = remainder.indexOf(":");
		const key = remainder.slice(0, colon).trim();
		const rawValue = remainder.slice(colon + 1).trim();
		const map = {};
		if (rawValue === "" || rawValue === "|" || rawValue === ">") {
			if (rawValue === "|" || rawValue === ">") {
				const block = readBlockScalar(index + 1, indent, rawValue);
				map[key] = block.value;
				return {
					value: map,
					nextIndex: block.nextIndex
				};
			}
			const child = parseNode(index + 1, indent + 2);
			map[key] = child.value;
			return {
				value: map,
				nextIndex: child.nextIndex
			};
		}
		if ((rawValue.startsWith("\"") || rawValue.startsWith("'")) && !isClosedQuoted(rawValue)) {
			const quoted = readQuotedScalar(rawValue, index, indent);
			map[key] = quoted.value;
			return {
				value: map,
				nextIndex: quoted.nextIndex
			};
		}
		map[key] = parseScalar(rawValue);
		return {
			value: map,
			nextIndex: index + 1
		};
	}
	function parseSequence(startIndex, indent) {
		const items = [];
		let index = startIndex;
		while (index < lines.length) {
			index = skipEmpty(index);
			if (index >= lines.length) break;
			const currentIndent = lineIndent(index);
			const trimmed = lines[index].trim();
			if (currentIndent < indent || !trimmed.startsWith("- ")) break;
			const remainder = trimmed.slice(2).trim();
			if (remainder === "") {
				const child = parseNode(index + 1, currentIndent + 2);
				items.push(child.value);
				index = child.nextIndex;
				continue;
			}
			if ((remainder.startsWith("\"") || remainder.startsWith("'")) && !isClosedQuoted(remainder)) {
				const quoted = readQuotedScalar(remainder, index, currentIndent);
				items.push(quoted.value);
				index = quoted.nextIndex;
				continue;
			}
			if (remainder.includes(":")) {
				const item = parseInlineMap(remainder, currentIndent, index);
				const merged = item.value;
				let cursor = item.nextIndex;
				while (true) {
					const next = skipEmpty(cursor);
					if (next >= lines.length) {
						cursor = next;
						break;
					}
					const nextIndent = lineIndent(next);
					const nextTrimmed = lines[next].trim();
					if (nextIndent <= currentIndent || nextTrimmed.startsWith("- ")) break;
					const nested = parseMap(next, currentIndent + 2);
					Object.assign(merged, nested.value);
					cursor = nested.nextIndex;
				}
				items.push(merged);
				index = cursor;
				continue;
			}
			items.push(parseScalar(remainder));
			index += 1;
		}
		return {
			value: items,
			nextIndex: index
		};
	}
	function parseMap(startIndex, indent) {
		const map = {};
		let index = startIndex;
		while (index < lines.length) {
			index = skipEmpty(index);
			if (index >= lines.length) break;
			const currentIndent = lineIndent(index);
			const trimmed = lines[index].trim();
			if (currentIndent < indent || trimmed.startsWith("- ")) break;
			const colon = trimmed.indexOf(":");
			if (colon === -1) throw new Error(`Invalid YAML line ${index + 1}: ${trimmed}`);
			const key = trimmed.slice(0, colon).trim();
			const rawValue = trimmed.slice(colon + 1).trim();
			if (rawValue === "" || rawValue === "|" || rawValue === ">") if (rawValue === "|" || rawValue === ">") {
				const block = readBlockScalar(index + 1, currentIndent, rawValue);
				map[key] = block.value;
				index = block.nextIndex;
			} else {
				const child = parseNode(index + 1, currentIndent + 2);
				map[key] = child.value;
				index = child.nextIndex;
			}
			else if ((rawValue.startsWith("\"") || rawValue.startsWith("'")) && !isClosedQuoted(rawValue)) {
				const quoted = readQuotedScalar(rawValue, index, currentIndent);
				map[key] = quoted.value;
				index = quoted.nextIndex;
			} else {
				map[key] = parseScalar(rawValue);
				index += 1;
			}
		}
		return {
			value: map,
			nextIndex: index
		};
	}
	function parseNode(startIndex, indent) {
		const index = skipEmpty(startIndex);
		if (index >= lines.length) return {
			value: {},
			nextIndex: index
		};
		const currentIndent = lineIndent(index);
		if (lines[index].trim().startsWith("- ") && currentIndent >= indent) return parseSequence(index, currentIndent);
		return parseMap(index, currentIndent);
	}
	return parseNode(0, 0).value;
}
function quoteIfNeeded(value) {
	return value === "" || /[:"'{}[\]#&*!|>%@`]/.test(value) || /^[ \t\n\r-]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"` : value;
}
function emitScalar(value) {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return quoteIfNeeded(value);
}
function toYaml(value, indent = 0) {
	const spaces = " ".repeat(indent);
	if (Array.isArray(value)) {
		if (value.length === 0) return `${spaces}[]\n`;
		return value.map((item) => {
			if (Array.isArray(item) || item && typeof item === "object") return `${spaces}- ${toYaml(item, indent + 2).trimEnd().replace(/^ */, "")}\n`;
			return `${spaces}- ${emitScalar(item)}\n`;
		}).join("");
	}
	if (value && typeof value === "object") return Object.keys(value).map((key) => {
		const child = value[key];
		if (typeof child === "string" && child.includes("\n")) return `${spaces}${key}: |\n${child.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`).join("\n")}\n`;
		if (Array.isArray(child) || child && typeof child === "object") return `${spaces}${key}:\n${toYaml(child, indent + 2)}`;
		return `${spaces}${key}: ${emitScalar(child)}\n`;
	}).join("");
	return `${spaces}${emitScalar(value)}\n`;
}
//#endregion
//#region src/validate-observation.ts
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
function validateCandidateObservationRecord(obs, prefix) {
	const errors = validateCandidateCoreRecord(obs, prefix);
	if ("id" in obs) errors.push(`${prefix}: candidate observations must use 'provisional_id', not 'id'`);
	if ("scope" in obs) errors.push(`${prefix}: candidate observations must use 'scope_hint', not 'scope'`);
	if ("support" in obs) errors.push(`${prefix}: candidate observations must use 'support_hint', not 'support'`);
	if ("verification" in obs) errors.push(`${prefix}: candidate observations must not include 'verification'`);
	if ("lifecycle" in obs) errors.push(`${prefix}: candidate observations must not include 'lifecycle'`);
	if (!Array.isArray(obs.source_slice_ids) || obs.source_slice_ids.length === 0) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
	else if (!obs.source_slice_ids.every(isNonEmptyString$1)) errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
	if (obs.support_hint != null) {
		const supportHint = obs.support_hint;
		if (typeof supportHint !== "object" || Array.isArray(supportHint)) errors.push(`${prefix}.support_hint: must be an object when present`);
		else {
			if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
			if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
			if (supportHint.scope_basis != null && !RCCL_SCOPE_BASES.has(String(supportHint.scope_basis))) errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
		}
	}
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
	return errors;
}
function validateCandidateObservationShape(observation, prefix) {
	const errors = [];
	if (!isNonEmptyString$1(observation.provisional_id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(observation.provisional_id)) errors.push(`${prefix}: 'provisional_id' "${observation.provisional_id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!isNonEmptyString$1(observation.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!RCCL_CATEGORIES.has(observation.category)) errors.push(`${prefix}: 'category' is invalid`);
	if (!isNonEmptyString$1(observation.scope_hint)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
	if (!isNonEmptyString$1(observation.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${observation.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(observation.adherence_quality)) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	if (!observation.source_slice_ids?.length) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
	else if (!observation.source_slice_ids.every(isNonEmptyString$1)) errors.push(`${prefix}: 'source_slice_ids' must contain only non-empty strings`);
	errors.push(...validateEvidenceShape(observation.evidence, prefix));
	const supportHint = observation.support_hint;
	if (supportHint != null) {
		if (supportHint.file_count != null && !isPositiveNumber(supportHint.file_count)) errors.push(`${prefix}.support_hint.file_count: must be a positive number`);
		if (supportHint.cluster_count != null && !isPositiveNumber(supportHint.cluster_count)) errors.push(`${prefix}.support_hint.cluster_count: must be a positive number`);
		if (supportHint.scope_basis != null && !isScopeBasis$1(supportHint.scope_basis)) errors.push(`${prefix}.support_hint.scope_basis: invalid value`);
	}
	errors.push(...validateTraitsRecord(observation.traits, `${prefix}.traits`));
	return errors;
}
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
function validateCandidateCoreRecord(obs, prefix) {
	const errors = [];
	const id = obs.provisional_id;
	const scope = obs.scope_hint;
	if (!isNonEmptyString$1(id)) errors.push(`${prefix}: missing or invalid 'provisional_id'`);
	else if (!RCCL_OBSERVATION_ID_PATTERN.test(id)) errors.push(`${prefix}: 'provisional_id' "${id}" does not match /^obs-[a-z0-9-]+$/`);
	if (!RCCL_CATEGORIES.has(String(obs.category))) errors.push(`${prefix}: 'category' is invalid`);
	if (!isNonEmptyString$1(obs.semantic_key)) errors.push(`${prefix}: missing or invalid 'semantic_key'`);
	if (!isNonEmptyString$1(scope)) errors.push(`${prefix}: missing or invalid 'scope_hint'`);
	if (!isNonEmptyString$1(obs.pattern)) errors.push(`${prefix}: missing or invalid 'pattern'`);
	if (typeof obs.confidence !== "number" || !Number.isFinite(obs.confidence) || obs.confidence < 0 || obs.confidence > 1) errors.push(`${prefix}: 'confidence' must be a number between 0 and 1, got ${obs.confidence}`);
	if (!RCCL_ADHERENCE_QUALITIES.has(String(obs.adherence_quality))) errors.push(`${prefix}: 'adherence_quality' is invalid`);
	errors.push(...validateEvidenceRecord(obs.evidence, prefix));
	errors.push(...validateTraitsRecord(obs.traits, `${prefix}.traits`));
	return errors;
}
function validateTraitsRecord(value, prefix) {
	if (value == null) return [];
	const errors = [];
	if (!isRecord$1(value)) return [`${prefix}: must be an object when present`];
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
function validateEvidenceRecord(value, prefix) {
	const errors = [];
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${prefix}: 'evidence' must be a non-empty array`);
		return errors;
	}
	for (let i = 0; i < value.length; i += 1) {
		const evidence = value[i];
		if (!isRecord$1(evidence)) {
			errors.push(`${prefix}.evidence[${i}]: must be an object`);
			continue;
		}
		if (!isNonEmptyString$1(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!isNonEmptyString$1(evidence.snippet)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function validateEvidenceShape(value, prefix) {
	const errors = [];
	if (!value?.length) {
		errors.push(`${prefix}: 'evidence' must be a non-empty array`);
		return errors;
	}
	for (let i = 0; i < value.length; i += 1) {
		const evidence = value[i];
		if (!isNonEmptyString$1(evidence.file)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'file'`);
		if (!isValidLineRange(evidence.line_range)) errors.push(`${prefix}.evidence[${i}]: invalid 'line_range'`);
		if (!isNonEmptyString$1(evidence.snippet)) errors.push(`${prefix}.evidence[${i}]: missing or invalid 'snippet'`);
		else errors.push(...validateEvidenceSnippet(evidence.snippet, prefix, i));
	}
	return errors;
}
function isValidLineRange(value) {
	if (!Array.isArray(value) || value.length !== 2) return false;
	const [start, end] = value;
	return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
}
function isPositiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 1;
}
function isNonEmptyString$1(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isScopeBasis$1(value) {
	return value === "single-file" || value === "directory-cluster" || value === "module-cluster" || value === "cross-root";
}
function isRecord$1(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//#endregion
//#region src/io/parse-rccl.ts
const RCCL_VERSION$1 = "1.0";
function isRcclVersion$1(value) {
	return value === RCCL_VERSION$1 || value === 1;
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
function parseRcclCandidates(yamlText) {
	const parsed = parseRawRcclDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateCandidateRcclDocument(parsed.doc);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeCandidateDocument(parsed.doc)
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
function validateCandidateRcclDocument(doc) {
	const errors = validateDocumentEnvelope(doc);
	if (errors.length > 0) return errors;
	const observations = doc.observations;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < observations.length; i += 1) {
		const obs = observations[i];
		const rawId = String(obs.provisional_id ?? "");
		if (rawId) {
			if (ids.has(rawId)) errors.push(`Duplicate candidate observation id: "${rawId}"`);
			ids.add(rawId);
		}
		errors.push(...validateCandidateObservation(obs, i));
	}
	return errors;
}
function validateDocumentEnvelope(doc) {
	const errors = [];
	if (!isRcclVersion$1(doc.version)) errors.push(`'version' must be "${RCCL_VERSION$1}", got "${doc.version}"`);
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
function validateCandidateObservation(obs, index) {
	return validateCandidateObservationRecord(obs, `observations[${index}]`);
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
function normalizeCandidateDocument(input) {
	return {
		version: RCCL_VERSION$1,
		generated_at: typeof input.generated_at === "string" ? input.generated_at : null,
		git_ref: typeof input.git_ref === "string" ? input.git_ref : null,
		observations: Array.isArray(input.observations) ? input.observations.map(normalizeCandidateObservation$1) : []
	};
}
function normalizeCandidateObservation$1(input) {
	const item = input;
	const supportHint = item.support_hint;
	return {
		provisional_id: String(item.provisional_id),
		semantic_key: normalizeSemanticKey$1(String(item.semantic_key)),
		category: item.category,
		scope_hint: normalizeScope$2(String(item.scope_hint)),
		pattern: String(item.pattern),
		confidence: Number(item.confidence),
		adherence_quality: item.adherence_quality,
		evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
		source_slice_ids: Array.isArray(item.source_slice_ids) ? Array.from(new Set(item.source_slice_ids.map(String))).sort() : [],
		support_hint: supportHint == null ? null : {
			scope_basis: supportHint.scope_basis == null ? null : normalizeScopeBasis(String(supportHint.scope_basis)),
			file_count: supportHint.file_count == null ? null : Number(supportHint.file_count),
			cluster_count: supportHint.cluster_count == null ? null : Number(supportHint.cluster_count)
		},
		traits: normalizeTraits$1(item.traits)
	};
}
function normalizeDocument(input) {
	return {
		version: RCCL_VERSION$1,
		generated_at: typeof input.generated_at === "string" ? input.generated_at : null,
		git_ref: typeof input.git_ref === "string" ? input.git_ref : null,
		observations: Array.isArray(input.observations) ? input.observations.map(normalizeObservation) : []
	};
}
function normalizeObservation(input) {
	const item = input;
	return {
		id: String(item.id),
		semantic_key: normalizeSemanticKey$1(String(item.semantic_key)),
		category: item.category,
		scope: normalizeScope$2(String(item.scope)),
		pattern: String(item.pattern),
		confidence: Number(item.confidence),
		adherence_quality: item.adherence_quality,
		evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence) : [],
		support: normalizeSupport(item.support),
		verification: normalizeVerification(item.verification),
		lifecycle: normalizeLifecycle(item.lifecycle),
		traits: normalizeTraits$1(item.traits)
	};
}
function normalizeEvidence(input) {
	const value = input;
	const lineRange = value.line_range;
	return {
		file: normalizePath$3(String(value.file)),
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
function normalizeTraits$1(input) {
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
function normalizeScope$2(scope) {
	const trimmed = scope.trim();
	return trimmed.length > 0 ? trimmed : "**";
}
function normalizePath$3(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizeSemanticKey$1(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
//#endregion
//#region src/represent/build-representation.ts
function buildRepresentation(indexedFiles) {
	return {
		roots: buildRoots(indexedFiles),
		modules: buildModules(indexedFiles),
		boundaries: [],
		migrations: [],
		style_clusters: []
	};
}
function buildRoots(indexedFiles) {
	const grouped = /* @__PURE__ */ new Map();
	for (const file of indexedFiles) {
		const list = grouped.get(file.package_root) ?? [];
		list.push(file);
		grouped.set(file.package_root, list);
	}
	return [...grouped.entries()].map(([root, files]) => ({
		root,
		file_count: files.length,
		languages: [...new Set(files.map((file) => file.language))].sort()
	})).sort((a, b) => b.file_count - a.file_count || a.root.localeCompare(b.root));
}
function buildModules(indexedFiles) {
	const grouped = /* @__PURE__ */ new Map();
	for (const file of indexedFiles) {
		const basePath = inferBasePath(file.path);
		const list = grouped.get(basePath) ?? [];
		list.push(file);
		grouped.set(basePath, list);
	}
	return [...grouped.entries()].map(([base_path, files]) => ({
		id: `module:${base_path.replace(/[^a-zA-Z0-9]+/g, "-")}`,
		base_path,
		file_paths: files.map((file) => file.path).sort(),
		dominant_language: dominant(files.map((file) => file.language))
	})).sort((a, b) => b.file_paths.length - a.file_paths.length || a.base_path.localeCompare(b.base_path));
}
function inferBasePath(filePath) {
	const segments = filePath.split("/").filter(Boolean);
	if (segments.length === 0) return filePath;
	if (segments.length === 1) return segments[0];
	return segments.slice(0, Math.min(2, segments.length)).join("/");
}
function dominant(values) {
	const counts = /* @__PURE__ */ new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "unknown";
}
//#endregion
//#region src/policies.ts
const DEFAULT_SAMPLING_POLICY = {
	max_slices: 8,
	max_files_per_slice: 4,
	max_windows_per_file: 3,
	target_coverage: {
		roots: true,
		modules: true,
		boundaries: true,
		migrations: true,
		style_clusters: true
	}
};
const DEFAULT_VERIFICATION_POLICY = {
	snippet_similarity_threshold: .75,
	min_evidence_for_directory_scope: 2,
	min_evidence_for_cross_root_scope: 3,
	anti_pattern_min_evidence: 2,
	migration_min_evidence: 2
};
//#endregion
//#region src/slicing/extract-windows.ts
function extractWindowsForFiles(projectRoot, files, policy = DEFAULT_SAMPLING_POLICY) {
	const windows = [];
	for (const file of files.slice(0, policy.max_files_per_slice)) {
		const content = readSafe(projectRoot, file.path);
		if (!content) continue;
		const lines = content.split("\n");
		const definitions = findDefinitionLines(lines);
		const descriptors = [];
		descriptors.push({
			purpose: "header",
			start: 1,
			end: Math.min(lines.length, 24)
		});
		if (definitions.length > 0) descriptors.push(windowAround(definitions[0], lines.length, "structure"));
		if (definitions.length > 1) descriptors.push(windowAround(definitions[Math.floor(definitions.length / 2)], lines.length, "implementation"));
		else descriptors.push(windowAround(Math.max(1, Math.floor(lines.length * .6)), lines.length, "implementation"));
		const unique = /* @__PURE__ */ new Map();
		for (const descriptor of descriptors.slice(0, policy.max_windows_per_file)) {
			const start = Math.max(1, descriptor.start);
			const end = Math.min(lines.length, descriptor.end);
			const key = `${descriptor.purpose}:${start}:${end}`;
			unique.set(key, {
				file: file.path,
				start_line: start,
				end_line: end,
				purpose: descriptor.purpose,
				snippet: lines.slice(start - 1, end).join("\n").trim()
			});
		}
		windows.push(...[...unique.values()].filter((window) => window.snippet.length > 0));
	}
	return windows;
}
function windowAround(line, totalLines, purpose) {
	const radius = purpose === "implementation" ? 16 : 12;
	return {
		purpose,
		start: Math.max(1, line - radius),
		end: Math.min(totalLines, line + radius)
	};
}
function findDefinitionLines(lines) {
	const result = [];
	for (let index = 0; index < lines.length; index += 1) if (/\b(function|class|interface|type|const|let|var|def|fn|struct|enum|trait)\b/.test(lines[index])) result.push(index + 1);
	return result;
}
function readSafe(projectRoot, file) {
	try {
		return readFileSync(join(projectRoot, file), "utf-8").replace(/\r\n/g, "\n");
	} catch {
		return null;
	}
}
//#endregion
//#region src/slicing/plan-slices.ts
function planSlices(projectRoot, indexedFiles, representation, policy = DEFAULT_SAMPLING_POLICY) {
	const fileMap = new Map(indexedFiles.map((file) => [file.path, file]));
	const slices = [];
	if (policy.target_coverage.roots) for (const root of representation.roots.slice(0, 2)) {
		const files = indexedFiles.filter((file) => file.package_root === root.root).slice(0, policy.max_files_per_slice);
		slices.push(makeSlice(projectRoot, `root:${root.root}`, "root", files, `Representative files from root ${root.root}`, 1, policy));
	}
	if (policy.target_coverage.modules) for (const module of representation.modules.slice(0, 3)) {
		const files = module.file_paths.map((path) => fileMap.get(path)).filter((value) => Boolean(value)).slice(0, policy.max_files_per_slice);
		slices.push(makeSlice(projectRoot, module.id, "module", files, `Representative files from module cluster ${module.base_path}`, .9, policy));
	}
	if (policy.target_coverage.boundaries) for (const boundary of representation.boundaries.slice(0, 1)) {
		const files = boundary.file_paths.map((path) => fileMap.get(path)).filter((value) => Boolean(value)).slice(0, policy.max_files_per_slice);
		slices.push(makeSlice(projectRoot, boundary.id, "boundary", files, boundary.reason, .85, policy));
	}
	if (policy.target_coverage.migrations) for (const migration of representation.migrations.slice(0, 1)) {
		const files = migration.file_paths.map((path) => fileMap.get(path)).filter((value) => Boolean(value)).slice(0, policy.max_files_per_slice);
		slices.push(makeSlice(projectRoot, migration.id, "migration", files, migration.reason, .8, policy));
	}
	if (policy.target_coverage.style_clusters) for (const cluster of representation.style_clusters.slice(0, 1)) {
		const files = cluster.file_paths.map((path) => fileMap.get(path)).filter((value) => Boolean(value)).slice(0, policy.max_files_per_slice);
		slices.push(makeSlice(projectRoot, cluster.id, "style-cluster", files, cluster.reason, .75, policy));
	}
	return slices.filter((slice) => slice.files.length > 0 && slice.windows.length > 0).slice(0, policy.max_slices);
}
function makeSlice(projectRoot, id, kind, files, rationale, coverage_weight, policy) {
	return {
		id,
		kind,
		files: files.map((file) => file.path),
		rationale,
		coverage_weight,
		windows: extractWindowsForFiles(projectRoot, files, policy)
	};
}
//#endregion
//#region src/prompt/build-slice-prompt.ts
const RCCL_CANDIDATE_SCHEMA = `
version: "1.0"
generated_at: <auto-filled>
git_ref: <auto-filled>

observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <quality>

    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    evidence_refs:
      - kind: "file"
        ref: "<relative-path>:<start>-<end>"
        file: "<relative-path>"
        line_range: [<start>, <end>]
    counterexamples: []

    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>
`.trim();
function buildSlicePrompt(input) {
	const lines = [];
	lines.push("# Repository Context Calibration");
	lines.push("");
	lines.push("You are generating candidate RCCL observations for a coding agent.");
	lines.push("Extract only local signals that materially affect code generation, modification, or review decisions.");
	lines.push("Work from the repository slices below. Prefer observations supported across multiple slices when possible.");
	lines.push("Do not write a repo summary or framework inventory.");
	lines.push("");
	lines.push("## Output schema");
	lines.push("```yaml");
	lines.push(RCCL_CANDIDATE_SCHEMA);
	lines.push("```");
	lines.push("");
	lines.push("## Hard rules");
	lines.push("1. Every observation must include non-empty evidence with exact file paths, line ranges, snippets, and matching evidence_refs from the provided windows.");
	lines.push("2. Evidence snippets are verification anchors, not labels: include the smallest self-contained code fragment that proves the observation, usually at least 2 lines or a distinctive full statement/block.");
	lines.push("3. Do not use single identifiers, isolated keywords, or paraphrased summaries as snippets unless the provided window itself is only that small.");
	lines.push("4. Candidate observations must use provisional_id, scope_hint, source_slice_ids, and optional support_hint/traits.");
	lines.push("5. Do not include final RCCL fields: id, scope, support, verification, or lifecycle.");
	lines.push("6. semantic_key is required and must stay stable across synonymous phrasings and repeated calibrations.");
	lines.push("7. pattern should stay human-readable and descriptive, but semantic_key is the primary identity.");
	lines.push("8. Scope hints should be no broader than the evidence supports.");
	lines.push("9. Use source_slice_ids to list the calibration slices that support the observation.");
	lines.push("10. Use counterexamples when nearby code contradicts or narrows the observation; RCCL will verify and adjudicate demotion or scope narrowing.");
	lines.push("11. Prefer 5 to 12 observations and skip weak or redundant signals.");
	lines.push("12. Set traits only when the evidence directly supports them; Runtime will not infer compatibility, migration, legacy, or anti-pattern semantics from prose.");
	lines.push("13. If you cannot supply a verifiable snippet for an observation, omit that observation instead of guessing.");
	lines.push("");
	if (input.contextMeta?.raw) {
		lines.push("## Repository context");
		lines.push("```yaml");
		lines.push(input.contextMeta.raw);
		lines.push("```");
		lines.push("");
	}
	lines.push(`## Scope: \`${input.scope}\``);
	lines.push(`Indexed files: ${input.stats.indexed_files}/${input.stats.total_files} | Selected slices: ${input.stats.selected_slices} | Windows: ${input.stats.windows}`);
	lines.push("");
	lines.push("## Calibration slices");
	lines.push("");
	for (const slice of input.slices) {
		lines.push(`### ${slice.id} (${slice.kind})`);
		lines.push(`Rationale: ${slice.rationale}`);
		lines.push(`Files: ${slice.files.join(", ")}`);
		for (const window of slice.windows) {
			lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
			lines.push("```");
			lines.push(window.snippet);
			lines.push("```");
		}
		lines.push("");
	}
	lines.push("Return only the RCCL YAML. Do not add explanation before or after it.");
	return lines.join("\n");
}
//#endregion
//#region src/prompt/build-discovery-prompt.ts
const DISCOVERY_SCHEMA = `
version: "1.0"
stage: discover
generated_at: <auto-filled-or-null>
scope: "<scope>"

seeds:
  - seed_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-observed-pattern>"
    decision_impact: "<how-this-would-change-code-generation-or-review>"

    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"

    source_slice_ids: ["<slice-id>"]
    uncertainty: "<optional-limit-or-null>"
`.trim();
function buildDiscoveryPrompt(input) {
	const lines = [];
	lines.push("# RCCL Calibration Workflow - Discover");
	lines.push("");
	lines.push("You are performing the discovery stage for repository context calibration.");
	lines.push("Find only observational signals that would materially affect future code generation, modification, or review decisions.");
	lines.push("Do not write final RCCL observations. Produce discovery seeds only.");
	lines.push("Prefer fewer, stronger seeds over broad repository summaries.");
	lines.push("");
	lines.push("## Output schema");
	lines.push("```yaml");
	lines.push(DISCOVERY_SCHEMA);
	lines.push("```");
	lines.push("");
	lines.push("## Hard rules");
	lines.push("1. Every seed must include non-empty evidence copied from the provided windows.");
	lines.push("2. Evidence snippets must be the smallest self-contained code fragment that proves the seed.");
	lines.push("3. Do not use single identifiers, isolated keywords, or paraphrases as evidence snippets.");
	lines.push("4. scope_hint must be no broader than the cited evidence supports.");
	lines.push("5. decision_impact must explain why this signal would matter to a coding agent.");
	lines.push("6. Record uncertainty instead of inflating confidence or generalizing beyond evidence.");
	lines.push("7. Return 5 to 12 seeds unless the provided windows support fewer.");
	lines.push("8. Return only the YAML document. Do not add explanation before or after it.");
	lines.push("");
	appendContext$2(lines, input.contextMeta);
	appendSlices$2(lines, input.scope, input.stats, input.slices);
	return lines.join("\n");
}
function appendContext$2(lines, contextMeta) {
	if (!contextMeta?.raw) return;
	lines.push("## Repository context");
	lines.push("```yaml");
	lines.push(contextMeta.raw);
	lines.push("```");
	lines.push("");
}
function appendSlices$2(lines, scope, stats, slices) {
	lines.push(`## Scope: \`${scope}\``);
	lines.push(`Indexed files: ${stats.indexed_files}/${stats.total_files} | Selected slices: ${stats.selected_slices} | Windows: ${stats.windows}`);
	lines.push("");
	lines.push("## Calibration slices");
	lines.push("");
	for (const slice of slices) {
		lines.push(`### ${slice.id} (${slice.kind})`);
		lines.push(`Rationale: ${slice.rationale}`);
		lines.push(`Files: ${slice.files.join(", ")}`);
		for (const window of slice.windows) {
			lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
			lines.push("```");
			lines.push(window.snippet);
			lines.push("```");
		}
		lines.push("");
	}
}
//#endregion
//#region src/prompt/build-critique-prompt.ts
const CRITIQUE_SCHEMA = `
version: "1.0"
stage: critique
generated_at: <auto-filled-or-null>
scope: "<scope>"

reviews:
  - seed_id: "obs-<seed-id-from-discovery>"
    disposition: <keep|revise|drop>
    reasons:
      - "<reason>"
    issues:
      - "<optional-issue>"
    counter_evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    recommended_scope_hint: "<optional-narrower-scope-or-null>"
`.trim();
function buildCritiquePrompt(input) {
	const lines = [];
	lines.push("# RCCL Calibration Workflow - Critique");
	lines.push("");
	lines.push("You are reviewing discovery-stage calibration seeds before synthesis.");
	lines.push("Your job is to find weak evidence, overgeneralization, duplicate meanings, missing counterexamples, and unclear decision impact.");
	lines.push("Do not write final RCCL observations or candidate RCCL YAML. Produce critique reviews only.");
	lines.push("");
	lines.push("## Output schema");
	lines.push("```yaml");
	lines.push(CRITIQUE_SCHEMA);
	lines.push("```");
	lines.push("");
	lines.push("## Hard rules");
	lines.push("1. Review every discovery seed exactly once using its seed_id.");
	lines.push("2. Use disposition keep only when evidence, scope, and decision impact are all strong.");
	lines.push("3. Use revise when the signal is useful but scope, wording, evidence, or duplication needs correction.");
	lines.push("4. Use drop when evidence is weak, redundant, summary-like, or not decision-impacting.");
	lines.push("5. Include counter_evidence only when you can cite a concrete provided window.");
	lines.push("6. Prefer narrowing scope over preserving broad claims.");
	lines.push("7. Return only the YAML document. Do not add explanation before or after it.");
	lines.push("");
	appendContext$1(lines, input.contextMeta);
	lines.push("## Discovery artifact");
	lines.push("```yaml");
	lines.push(serializeDiscovery(input.discovery));
	lines.push("```");
	lines.push("");
	appendSlices$1(lines, input.scope, input.stats, input.slices);
	return lines.join("\n");
}
function appendContext$1(lines, contextMeta) {
	if (!contextMeta?.raw) return;
	lines.push("## Repository context");
	lines.push("```yaml");
	lines.push(contextMeta.raw);
	lines.push("```");
	lines.push("");
}
function appendSlices$1(lines, scope, stats, slices) {
	lines.push(`## Scope: \`${scope}\``);
	lines.push(`Indexed files: ${stats.indexed_files}/${stats.total_files} | Selected slices: ${stats.selected_slices} | Windows: ${stats.windows}`);
	lines.push("");
	lines.push("## Calibration slices");
	lines.push("");
	for (const slice of slices) {
		lines.push(`### ${slice.id} (${slice.kind})`);
		lines.push(`Rationale: ${slice.rationale}`);
		lines.push(`Files: ${slice.files.join(", ")}`);
		for (const window of slice.windows) {
			lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
			lines.push("```");
			lines.push(window.snippet);
			lines.push("```");
		}
		lines.push("");
	}
}
function serializeDiscovery(discovery) {
	return JSON.stringify(discovery, null, 2);
}
//#endregion
//#region src/prompt/build-synthesis-prompt.ts
const CANDIDATE_RCCL_SCHEMA = `
version: "1.0"
generated_at: <auto-filled-or-null>
git_ref: <auto-filled-or-null>

observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>

    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"

    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>
`.trim();
function buildSynthesisPrompt(input) {
	const lines = [];
	lines.push("# RCCL Calibration Workflow - Synthesize");
	lines.push("");
	lines.push("You are synthesizing reviewed discovery seeds into candidate RCCL observations.");
	lines.push("Use discovery for candidate material and critique for quality control.");
	lines.push("Produce only candidate RCCL YAML that the deterministic commit step can validate.");
	lines.push("");
	lines.push("## Output schema");
	lines.push("```yaml");
	lines.push(CANDIDATE_RCCL_SCHEMA);
	lines.push("```");
	lines.push("");
	lines.push("## Hard rules");
	lines.push("1. Return only candidate RCCL YAML. Do not add explanation before or after it.");
	lines.push("2. Include only observations that survived critique as keep or can be safely revised from critique feedback.");
	lines.push("3. Drop seeds with disposition drop unless there is a concrete critique reason that permits a narrower replacement.");
	lines.push("4. Every observation must include non-empty evidence copied from the provided windows.");
	lines.push("5. Evidence snippets must be verification anchors, not labels or paraphrases.");
	lines.push("6. Use provisional_id, scope_hint, source_slice_ids, and optional support_hint/traits.");
	lines.push("7. Do not include final RCCL fields: id, scope, support, verification, or lifecycle.");
	lines.push("8. semantic_key must stay stable across synonymous phrasings and repeated calibrations.");
	lines.push("9. Prefer 5 to 12 observations and skip weak or redundant signals.");
	lines.push("10. Set traits only when the reviewed evidence directly supports them; Runtime does not infer compatibility, migration, legacy, or anti-pattern semantics from prose.");
	lines.push("11. If the reviewed artifacts do not justify a verifiable observation, omit it instead of guessing.");
	lines.push("");
	appendContext(lines, input.contextMeta);
	lines.push("## Discovery artifact");
	lines.push("```yaml");
	lines.push(serializeArtifact(input.discovery));
	lines.push("```");
	lines.push("");
	lines.push("## Critique artifact");
	lines.push("```yaml");
	lines.push(serializeArtifact(input.critique));
	lines.push("```");
	lines.push("");
	appendSlices(lines, input.scope, input.stats, input.slices);
	return lines.join("\n");
}
function appendContext(lines, contextMeta) {
	if (!contextMeta?.raw) return;
	lines.push("## Repository context");
	lines.push("```yaml");
	lines.push(contextMeta.raw);
	lines.push("```");
	lines.push("");
}
function appendSlices(lines, scope, stats, slices) {
	lines.push(`## Scope: \`${scope}\``);
	lines.push(`Indexed files: ${stats.indexed_files}/${stats.total_files} | Selected slices: ${stats.selected_slices} | Windows: ${stats.windows}`);
	lines.push("");
	lines.push("## Calibration slices");
	lines.push("");
	for (const slice of slices) {
		lines.push(`### ${slice.id} (${slice.kind})`);
		lines.push(`Rationale: ${slice.rationale}`);
		lines.push(`Files: ${slice.files.join(", ")}`);
		for (const window of slice.windows) {
			lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
			lines.push("```");
			lines.push(window.snippet);
			lines.push("```");
		}
		lines.push("");
	}
}
function serializeArtifact(value) {
	return JSON.stringify(value, null, 2);
}
//#endregion
//#region src/prepare.ts
const FALSEY_FLAG_VALUES = new Set([
	"0",
	"false",
	"no",
	"off"
]);
const RCCL_REFRESH_SCHEMA = `
version: "1.0"
generated_at: <auto-filled-or-null>
scope: "<scope>"

keep:
  - "obs-active-existing-id"

revise:
  - provisional_id: "obs-active-existing-id"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    evidence_refs:
      - kind: "file"
        ref: "<relative-path>:<start>-<end>"
        file: "<relative-path>"
        line_range: [<start>, <end>]
    counterexamples: []
    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>

retire:
  - observation_id: "obs-active-existing-id"
    reason_id: <file-missing|snippet-drift|scope-drift|superseded|no-longer-material|other>
    confidence: <0.0-1.0>
    evidence_refs: []

new_observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    evidence_refs:
      - kind: "file"
        ref: "<relative-path>:<start>-<end>"
        file: "<relative-path>"
        line_range: [<start>, <end>]
    counterexamples: []
    source_slice_ids: ["<slice-id>"]
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>

semantic_equivalence:
  - observation_ids: ["obs-a", "obs-b"]
    confidence: <0.0-1.0>
    evidence_refs: []
    reason: "<why these should consolidate>"

counterexamples:
  - observation_id: "obs-active-existing-id"
    confidence: <0.0-1.0>
    evidence_refs: []
    reason: "<why this contradicts or narrows the observation>"
`.trim();
function prepareRccl(projectRootInput, options = {}) {
	const context = buildPreparationContext(projectRootInput, options.scope);
	const prompt = buildSlicePrompt({
		scope: context.scope,
		slices: context.slices,
		contextMeta: context.contextMeta,
		stats: context.stats
	});
	const candidateArtifact = buildObservationGenerationArtifact(context.projectRoot, context.scope);
	const contract = buildObservationGenerationContract(context, prompt, candidateArtifact);
	const debugArtifacts = buildDebugArtifacts(context, prompt, "calibration-prompts", options.debugArtifacts);
	return {
		prompt,
		contract,
		candidateArtifact,
		metadata: {
			scope: context.scope,
			stats: context.stats
		},
		debugArtifacts
	};
}
function prepareRcclWorkflowStage(projectRootInput, options) {
	const context = buildPreparationContext(projectRootInput, options.scope);
	const prompt = buildWorkflowPrompt(context, options);
	const debugArtifacts = buildDebugArtifacts(context, prompt, "rccl-workflow-prompts", options.debugArtifacts, { stage: options.stage });
	return {
		stage: options.stage,
		prompt,
		suggestedArtifactPath: suggestedWorkflowArtifactPath(context.projectRoot, options.stage, context.scope),
		metadata: {
			scope: context.scope,
			stats: context.stats
		},
		debugArtifacts
	};
}
function prepareIncrementalRccl(projectRootInput, options = {}) {
	const context = buildPreparationContext(projectRootInput, options.scope);
	const requestedMode = options.mode ?? (options.changedFiles?.length ? "changed-files" : "task-scoped");
	const focusFiles = normalizeFocusFiles(context.projectRoot, [...options.targetFiles ?? [], ...options.changedFiles ?? []]);
	const limits = resolveIncrementalLimits(requestedMode, options);
	const candidateSlices = selectFocusedSlices(context.slices, focusFiles);
	const selectedSlices = limitCalibrationSlices(candidateSlices.length > 0 ? candidateSlices : buildFocusedFileSlices(context.projectRoot, context.indexedFiles, focusFiles, limits.fileLimit), limits);
	const stats = statsFor(context.indexedFiles.length, selectedSlices);
	const existingRccl = loadExistingRccl$1(context.projectRoot);
	const affectedObservations = existingRccl ? findAffectedObservations(existingRccl, focusFiles, requestedMode) : [];
	const staleObservations = existingRccl ? findStaleObservations(existingRccl, context.projectRoot) : [];
	const cacheArtifacts = writeIncrementalCacheArtifacts(context.projectRoot, {
		scope: context.scope,
		requestedMode,
		focusFiles,
		indexedFiles: context.indexedFiles,
		slices: selectedSlices,
		affectedObservations,
		staleObservations
	});
	if (selectedSlices.length > 0 && !existingRccl) {
		const generationContext = {
			...context,
			slices: selectedSlices,
			stats
		};
		const generationPrompt = buildSlicePrompt({
			scope: context.scope,
			slices: selectedSlices,
			contextMeta: context.contextMeta,
			stats
		});
		const candidateArtifact = buildObservationGenerationArtifact(context.projectRoot, context.scope);
		const generationContract = buildObservationGenerationContract(generationContext, generationPrompt, candidateArtifact);
		const debugArtifacts = buildDebugArtifacts(generationContext, generationPrompt, "rccl-incremental-generation-prompts", options.debugArtifacts, {
			mode: requestedMode,
			focusFiles
		});
		return {
			mode: "contracts-required",
			contract: generationContract,
			candidateArtifact,
			metadata: {
				scope: context.scope,
				requested_mode: requestedMode,
				focus_files: focusFiles,
				stats,
				existing_observation_count: 0,
				limits: {
					file_limit: Number.isFinite(limits.fileLimit) ? limits.fileLimit : null,
					window_limit: Number.isFinite(limits.windowLimit) ? limits.windowLimit : null,
					applied: limits.applied
				}
			},
			affectedObservations,
			staleObservations,
			cacheArtifacts,
			debugArtifacts
		};
	}
	const prompt = buildRefreshPrompt({
		scope: context.scope,
		requestedMode,
		focusFiles,
		slices: selectedSlices,
		contextMeta: context.contextMeta,
		stats,
		observations: summarizeExistingObservations(existingRccl, affectedObservations),
		staleObservations
	});
	const refreshArtifact = buildObservationRefreshArtifact(context.projectRoot, context.scope, requestedMode, focusFiles);
	const contract = buildObservationRefreshContract({
		context,
		slices: selectedSlices,
		prompt,
		artifact: refreshArtifact,
		focusFiles,
		affectedObservations,
		staleObservations,
		existingRccl
	});
	const debugArtifacts = buildDebugArtifacts({
		...context,
		slices: selectedSlices,
		stats
	}, prompt, "rccl-refresh-prompts", options.debugArtifacts, {
		mode: requestedMode,
		focusFiles
	});
	return {
		mode: selectedSlices.length > 0 ? "contracts-required" : existingRccl ? "verify-only" : "full-refresh-recommended",
		contract: selectedSlices.length > 0 ? contract : void 0,
		refreshArtifact: selectedSlices.length > 0 ? refreshArtifact : void 0,
		metadata: {
			scope: context.scope,
			requested_mode: requestedMode,
			focus_files: focusFiles,
			stats,
			existing_observation_count: existingRccl?.observations.length ?? 0,
			limits: {
				file_limit: Number.isFinite(limits.fileLimit) ? limits.fileLimit : null,
				window_limit: Number.isFinite(limits.windowLimit) ? limits.windowLimit : null,
				applied: limits.applied
			}
		},
		affectedObservations,
		staleObservations,
		cacheArtifacts,
		debugArtifacts
	};
}
function buildPreparationContext(projectRootInput, scopeInput) {
	const projectRoot = resolve(projectRootInput);
	const scope = scopeInput || "auto";
	const indexedFiles = buildRepoIndex(projectRoot, scope);
	const representation = buildRepresentation(indexedFiles);
	const slices = planSlices(projectRoot, indexedFiles, representation);
	const windows = slices.flatMap((slice) => slice.windows);
	return {
		projectRoot,
		scope,
		indexedFiles,
		representation,
		slices,
		contextMeta: loadContextMeta(projectRoot),
		stats: {
			total_files: indexedFiles.length,
			indexed_files: indexedFiles.length,
			selected_slices: slices.length,
			windows: windows.length
		}
	};
}
function buildWorkflowPrompt(context, options) {
	if (options.stage === "discover") return buildDiscoveryPrompt({
		scope: context.scope,
		slices: context.slices,
		contextMeta: context.contextMeta,
		stats: context.stats
	});
	if (options.stage === "critique") {
		if (!options.discovery) throw new Error("prepare-stage critique requires a parsed discovery artifact");
		return buildCritiquePrompt({
			scope: context.scope,
			discovery: options.discovery,
			slices: context.slices,
			contextMeta: context.contextMeta,
			stats: context.stats
		});
	}
	if (!options.discovery) throw new Error("prepare-stage synthesize requires a parsed discovery artifact");
	if (!options.critique) throw new Error("prepare-stage synthesize requires a parsed critique artifact");
	return buildSynthesisPrompt({
		scope: context.scope,
		discovery: options.discovery,
		critique: options.critique,
		slices: context.slices,
		contextMeta: context.contextMeta,
		stats: context.stats
	});
}
function buildDebugArtifacts(context, prompt, promptFolder, debugArtifacts, seed = {}) {
	return shouldEmitDebugArtifacts(debugArtifacts) ? {
		enabled: true,
		promptPath: writeArtifact(context.projectRoot, promptFolder, "md", prompt, {
			scope: context.scope,
			promptLength: prompt.length,
			...seed
		}),
		slicePlanPath: writeArtifact(context.projectRoot, "rccl-slice-plans", "json", JSON.stringify({
			scope: context.scope,
			representation: context.representation,
			slices: context.slices
		}, null, 2), {
			scope: context.scope,
			slices: context.slices.length,
			...seed
		}),
		reportPath: writeArtifact(context.projectRoot, "rccl-reports", "json", JSON.stringify({
			scope: context.scope,
			stage: seed.stage,
			stats: context.stats,
			roots: context.representation.roots,
			modules: context.representation.modules.slice(0, 5),
			boundaries: context.representation.boundaries,
			migrations: context.representation.migrations,
			style_clusters: context.representation.style_clusters
		}, null, 2), {
			scope: context.scope,
			report: "summary",
			...seed
		})
	} : { enabled: false };
}
function buildObservationGenerationArtifact(projectRoot, scope) {
	return {
		suggestedPath: suggestedObservationCandidatePath(projectRoot, scope),
		format: "yaml",
		usage: "Write candidate RCCL observations to this YAML path, then pass it to calibrate-repo-context commit with --input."
	};
}
function buildObservationGenerationContract(context, prompt, artifact) {
	return {
		contractVersion: "ai-contract/v2",
		kind: "rccl-observation-generation",
		schemaId: "rccl.observation-generation-candidate",
		schemaVersion: "2.0",
		prompt,
		schema: RCCL_CANDIDATE_SCHEMA,
		artifact,
		provenance: {
			owner: "rccl",
			deterministic: true
		},
		cacheKeyMaterial: {
			scope: context.scope,
			stats: context.stats,
			slices: context.slices.map((slice) => ({
				id: slice.id,
				files: slice.files,
				windows: slice.windows.map((window) => ({
					file: window.file,
					start_line: window.start_line,
					end_line: window.end_line,
					purpose: window.purpose
				}))
			}))
		}
	};
}
function buildObservationRefreshArtifact(projectRoot, scope, mode, focusFiles) {
	return {
		suggestedPath: suggestedObservationRefreshPath(projectRoot, scope, mode, focusFiles),
		format: "yaml",
		usage: "Write the RCCL observation refresh proposal to this YAML path, then pass it to calibrate-repo-context commit-refresh with --input."
	};
}
function buildObservationRefreshContract(input) {
	return {
		contractVersion: "ai-contract/v2",
		kind: "rccl-observation-refresh",
		schemaId: "rccl.observation-refresh",
		schemaVersion: "2.0",
		prompt: input.prompt,
		schema: RCCL_REFRESH_SCHEMA,
		artifact: input.artifact,
		provenance: {
			owner: "rccl",
			deterministic: true
		},
		cacheKeyMaterial: {
			scope: input.context.scope,
			focusFiles: input.focusFiles,
			affectedObservations: input.affectedObservations,
			staleObservations: input.staleObservations,
			existingObservationFingerprints: (input.existingRccl?.observations ?? []).map((observation) => ({
				id: observation.id,
				fingerprint: observation.lifecycle?.content_fingerprint ?? null,
				verification: observation.verification.disposition
			})),
			slices: input.slices.map((slice) => ({
				id: slice.id,
				files: slice.files,
				windows: slice.windows.map((window) => ({
					file: window.file,
					start_line: window.start_line,
					end_line: window.end_line,
					purpose: window.purpose
				}))
			}))
		}
	};
}
function suggestedObservationCandidatePath(projectRoot, scope) {
	return join(projectRoot, ".resonant-code", "context", "rccl-candidates", `${createHash("sha1").update(JSON.stringify({
		kind: "rccl-observation-generation",
		scope
	})).digest("hex").slice(0, 10)}.yaml`);
}
function suggestedObservationRefreshPath(projectRoot, scope, mode, focusFiles) {
	return join(projectRoot, ".resonant-code", "context", "rccl-refresh", `${createHash("sha1").update(JSON.stringify({
		kind: "rccl-observation-refresh",
		scope,
		mode,
		focusFiles
	})).digest("hex").slice(0, 10)}.yaml`);
}
function suggestedWorkflowArtifactPath(projectRoot, stage, scope) {
	return join(projectRoot, ".resonant-code", "context", "rccl-workflow", `${stage}-${createHash("sha1").update(JSON.stringify({
		stage,
		scope
	})).digest("hex").slice(0, 10)}.yaml`);
}
function shouldEmitDebugArtifacts(explicit) {
	if (explicit !== void 0) return explicit;
	const value = process.env.RESONANT_CODE_DEBUG_ARTIFACTS;
	if (!value) return false;
	return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}
function writeArtifact(projectRoot, folder, extension, content, seed) {
	const digest = createHash("sha1").update(JSON.stringify(seed)).digest("hex").slice(0, 10);
	const path = join(projectRoot, ".resonant-code", "context", folder, `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${digest}.${extension}`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
	return path;
}
function writeIncrementalCacheArtifacts(projectRoot, value) {
	const indexKey = createHash("sha1").update(JSON.stringify({
		scope: value.scope,
		files: value.indexedFiles.map((file) => [
			file.path,
			file.lines,
			file.imports_count,
			file.exports_count,
			file.role_hints
		])
	})).digest("hex").slice(0, 16);
	const sliceKey = createHash("sha1").update(JSON.stringify({
		scope: value.scope,
		requestedMode: value.requestedMode,
		focusFiles: value.focusFiles,
		slices: value.slices.map((slice) => [
			slice.id,
			slice.files,
			slice.windows.map((window) => [
				window.file,
				window.start_line,
				window.end_line
			])
		])
	})).digest("hex").slice(0, 16);
	return {
		repoIndexPath: writeCacheArtifact(projectRoot, "repo-index", indexKey, {
			version: "1.0",
			kind: "rccl-repo-index",
			scope: value.scope,
			indexedFiles: value.indexedFiles
		}),
		slicePlanPath: writeCacheArtifact(projectRoot, "slice-plan", sliceKey, {
			version: "1.0",
			kind: "rccl-slice-plan",
			scope: value.scope,
			requestedMode: value.requestedMode,
			focusFiles: value.focusFiles,
			affectedObservations: value.affectedObservations,
			staleObservations: value.staleObservations,
			slices: value.slices
		})
	};
}
function writeCacheArtifact(projectRoot, folder, key, value) {
	const path = join(projectRoot, ".resonant-code", "context", "cache", "rccl", folder, `${key}.json`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	return path;
}
function resolveIncrementalLimits(requestedMode, options) {
	const defaultLimited = requestedMode !== "full";
	const fileLimit = positiveInteger(options.fileLimit) ?? (defaultLimited ? 4 : Number.POSITIVE_INFINITY);
	const windowLimit = positiveInteger(options.windowLimit) ?? (defaultLimited ? 24 : Number.POSITIVE_INFINITY);
	return {
		fileLimit,
		windowLimit,
		applied: Number.isFinite(fileLimit) || Number.isFinite(windowLimit)
	};
}
function positiveInteger(value) {
	if (value === void 0) return void 0;
	if (!Number.isInteger(value) || value <= 0) throw new Error("RCCL incremental limits must be positive integers.");
	return value;
}
function buildRefreshPrompt(input) {
	const lines = [];
	lines.push("# Incremental RCCL Observation Refresh");
	lines.push("");
	lines.push("Produce a bounded RCCL observation refresh proposal for the provided repository slices.");
	lines.push("Your output is assistive only. RCCL will validate ids, schema, evidence, snippets, scope support, and final write policy.");
	lines.push("Do not summarize the repository. Do not create authoritative final observation ids, verification, or lifecycle fields.");
	lines.push("");
	lines.push("## Output schema");
	lines.push("```yaml");
	lines.push(RCCL_REFRESH_SCHEMA);
	lines.push("```");
	lines.push("");
	lines.push("## Hard rules");
	lines.push("1. Keep existing observations only when the provided slices and existing summary still support them.");
	lines.push("2. Revise uses provisional_id equal to an existing active observation id; v2 still keeps final merge, rename, and lifecycle authority inside RCCL.");
	lines.push("3. Revise or create observations only with exact evidence copied from the provided windows plus matching evidence_refs.");
	lines.push("4. Retire means the observation should become stale unless RCCL verification proves a stronger disposition.");
	lines.push("5. Use only listed existing active observation ids in keep, revise, or retire.");
	lines.push("6. Omitted active observations are carried forward unchanged; omission is non-destructive.");
	lines.push("7. Use the exact action schemas; do not emit shorthand retire entries or malformed action items.");
	lines.push("8. Include counterexamples and semantic_equivalence proposals when they would narrow scope, merge duplicates, or demote noisy observations.");
	lines.push("9. Set traits only when the provided evidence directly supports them; RCCL/Runtime do not infer compatibility, migration, legacy, or anti-pattern semantics from prose.");
	lines.push("10. Prefer fewer, stronger refresh proposals over broad summaries.");
	lines.push("");
	lines.push(`Scope: ${input.scope}`);
	lines.push(`Requested mode: ${input.requestedMode}`);
	lines.push(`Focus files: ${input.focusFiles.join(", ") || "(none)"}`);
	lines.push(`Indexed files: ${input.stats.indexed_files}/${input.stats.total_files} | Selected slices: ${input.stats.selected_slices} | Windows: ${input.stats.windows}`);
	lines.push(`Static stale observation candidates: ${input.staleObservations.join(", ") || "(none)"}`);
	lines.push("");
	if (input.contextMeta?.raw) {
		lines.push("## Repository context");
		lines.push("```yaml");
		lines.push(input.contextMeta.raw);
		lines.push("```");
		lines.push("");
	}
	lines.push("## Existing observation summaries");
	if (input.observations.length === 0) lines.push("- (none in selected scope)");
	else for (const observation of input.observations) {
		lines.push(`- ${observation.id} (${observation.category}, ${observation.scope})`);
		lines.push(`  semantic_key: ${observation.semantic_key}`);
		lines.push(`  pattern: ${observation.pattern}`);
		lines.push(`  confidence: ${observation.confidence}`);
		lines.push(`  adherence_quality: ${observation.adherence_quality}`);
		lines.push(`  evidence_refs: ${observation.evidence_refs.join(", ") || "(none)"}`);
		if (observation.traits) lines.push(`  traits: ${formatTraits(observation.traits)}`);
		lines.push(`  lifecycle: ${observation.lifecycle?.status ?? "unknown"}`);
		lines.push(`  disposition: ${observation.verification.disposition ?? "pending"}`);
	}
	lines.push("");
	lines.push("## Refresh slices");
	for (const slice of input.slices) {
		lines.push(`### ${slice.id} (${slice.kind})`);
		lines.push(`Rationale: ${slice.rationale}`);
		lines.push(`Files: ${slice.files.join(", ")}`);
		for (const window of slice.windows) {
			lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
			lines.push("```");
			lines.push(window.snippet);
			lines.push("```");
		}
	}
	return lines.join("\n");
}
function statsFor(totalFiles, slices) {
	return {
		total_files: totalFiles,
		indexed_files: totalFiles,
		selected_slices: slices.length,
		windows: slices.flatMap((slice) => slice.windows).length
	};
}
function normalizeFocusFiles(projectRoot, files) {
	return [...new Set(files.map((file) => normalizeFocusFile(projectRoot, file)).filter(Boolean))].sort();
}
function normalizeFocusFile(projectRoot, file) {
	const trimmed = file.trim();
	if (!trimmed) return "";
	const rel = relative(projectRoot, isAbsolute(trimmed) ? trimmed : resolve(projectRoot, trimmed)).replace(/\\/g, "/");
	if (!rel || rel === ".") return "";
	if (rel.startsWith("../") || rel === ".." || isAbsolute(rel)) return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
	return rel.replace(/^\.\//, "");
}
function selectFocusedSlices(slices, focusFiles) {
	if (focusFiles.length === 0) return slices;
	const focusSet = new Set(focusFiles);
	return slices.filter((slice) => slice.files.some((file) => focusSet.has(file)) || slice.windows.some((window) => focusSet.has(window.file)));
}
function buildFocusedFileSlices(projectRoot, indexedFiles, focusFiles, fileLimit) {
	if (focusFiles.length === 0) return [];
	const indexedByPath = new Map(indexedFiles.map((file) => [file.path, file]));
	const files = focusFiles.map((file) => indexedByPath.get(file)).filter((file) => Boolean(file)).slice(0, Number.isFinite(fileLimit) ? fileLimit : void 0);
	if (files.length === 0) return [];
	return [{
		id: "focus:changed-files",
		kind: "module",
		files: files.map((file) => file.path),
		rationale: "Direct task focus files selected for incremental RCCL refresh",
		coverage_weight: 1,
		windows: extractWindowsForFiles(projectRoot, files)
	}];
}
function limitCalibrationSlices(slices, limits) {
	if (!Number.isFinite(limits.fileLimit) && !Number.isFinite(limits.windowLimit)) return slices;
	const selectedFiles = /* @__PURE__ */ new Set();
	let windowCount = 0;
	const result = [];
	for (const slice of slices) {
		if (Number.isFinite(limits.windowLimit) && windowCount >= limits.windowLimit) break;
		const files = slice.files.filter((file) => {
			if (selectedFiles.has(file)) return true;
			if (Number.isFinite(limits.fileLimit) && selectedFiles.size >= limits.fileLimit) return false;
			selectedFiles.add(file);
			return true;
		});
		const fileSet = new Set(files);
		const windows = [];
		for (const window of slice.windows) {
			if (!fileSet.has(window.file)) continue;
			if (Number.isFinite(limits.windowLimit) && windowCount >= limits.windowLimit) break;
			windows.push(window);
			windowCount += 1;
		}
		if (files.length > 0 && windows.length > 0) result.push({
			...slice,
			files,
			windows
		});
	}
	return result;
}
function loadExistingRccl$1(projectRoot) {
	const rcclPath = join(projectRoot, ".resonant-code", "rccl.yaml");
	if (!existsSync(rcclPath)) return null;
	try {
		const parsed = parseRccl(readFileSync(rcclPath, "utf-8"), { allowVerifiedFields: true });
		return parsed.valid && parsed.data ? parsed.data : null;
	} catch {
		return null;
	}
}
function findAffectedObservations(document, focusFiles, mode) {
	if (mode === "full") return document.observations.map((observation) => observation.id);
	if (focusFiles.length === 0) return [];
	return document.observations.filter((observation) => focusFiles.some((file) => scopeMatchesFile(observation.scope, file)) || observation.evidence.some((evidence) => focusFiles.includes(evidence.file))).map((observation) => observation.id);
}
function findStaleObservations(document, projectRoot) {
	return document.observations.filter((observation) => observation.lifecycle?.status === "stale" || observation.evidence.some((evidence) => !existsSync(join(projectRoot, evidence.file)))).map((observation) => observation.id);
}
function summarizeExistingObservations(document, affectedObservationIds) {
	if (!document) return [];
	const affected = new Set(affectedObservationIds);
	return (affected.size > 0 ? document.observations.filter((observation) => affected.has(observation.id)) : document.observations.slice(0, 12)).map((observation) => ({
		id: observation.id,
		semantic_key: observation.semantic_key,
		category: observation.category,
		scope: observation.scope,
		pattern: observation.pattern,
		confidence: observation.confidence,
		adherence_quality: observation.adherence_quality,
		verification: observation.verification,
		lifecycle: observation.lifecycle,
		evidence_refs: observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`),
		traits: observation.traits
	}));
}
function formatTraits(traits) {
	return Object.entries(traits).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}=${value}`).join(", ") || "(none)";
}
function scopeMatchesFile(scope, file) {
	if (scope === "**" || scope === "**/*") return true;
	if (scope.endsWith("/**")) return file.startsWith(scope.slice(0, -3));
	if (scope.includes("*")) {
		const escaped = scope.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
		return new RegExp(`^${escaped}$`).test(file);
	}
	return file === scope || file.startsWith(`${scope.replace(/\/$/, "")}/`);
}
function loadContextMeta(projectRoot) {
	try {
		return { raw: readFileSync(join(projectRoot, ".resonant-code", "context", "global.yaml"), "utf-8").slice(0, 1200) };
	} catch {
		return null;
	}
}
//#endregion
//#region src/consolidate/derive-support.ts
function deriveSupport(candidate, evidence) {
	const evidenceFiles = Array.from(new Set(evidence.map((item) => normalizePath$2(item.file)).filter(Boolean))).sort();
	const rootCount = new Set(evidenceFiles.map(rootFromPath).filter(Boolean)).size;
	const directoryCount = new Set(evidenceFiles.map(directoryFromPath).filter(Boolean)).size;
	const hintedFileCount = candidate.support_hint?.file_count ?? null;
	const hintedClusterCount = candidate.support_hint?.cluster_count ?? null;
	const file_count = hintedFileCount == null ? Math.max(1, evidenceFiles.length) : Math.max(1, hintedFileCount);
	const scope_basis = candidate.support_hint?.scope_basis ?? inferScopeBasis(candidate.scope_hint, file_count, rootCount, directoryCount);
	const cluster_count = hintedClusterCount == null ? inferClusterCount(scope_basis, rootCount, directoryCount) : Math.max(1, hintedClusterCount);
	return {
		source_slices: Array.from(new Set(candidate.source_slice_ids)).sort(),
		file_count,
		cluster_count,
		scope_basis
	};
}
function deriveScope(scopeHint, support, evidence) {
	const normalizedHint = normalizeScope$1(scopeHint);
	if (support.scope_basis === "cross-root") return "**";
	if (normalizedHint !== "**" && !normalizedHint.includes("*")) return normalizedHint;
	const evidenceFiles = Array.from(new Set(evidence.map((item) => normalizePath$2(item.file)).filter(Boolean))).sort();
	if (support.scope_basis === "single-file" && evidenceFiles.length > 0) return evidenceFiles[0];
	const directories = Array.from(new Set(evidenceFiles.map(directoryFromPath).filter(Boolean)));
	if (support.scope_basis === "directory-cluster" && directories.length === 1) return `${directories[0]}/**`;
	const roots = Array.from(new Set(evidenceFiles.map(rootFromPath).filter(Boolean)));
	if (support.scope_basis === "module-cluster" && roots.length === 1) return `${roots[0]}/**`;
	return normalizedHint;
}
function inferScopeBasis(scopeHint, fileCount, rootCount, directoryCount) {
	if (rootCount > 1 || normalizeScope$1(scopeHint) === "**") return "cross-root";
	if (fileCount <= 1) return "single-file";
	if (directoryCount <= 1) return "directory-cluster";
	return "module-cluster";
}
function inferClusterCount(scopeBasis, rootCount, directoryCount) {
	if (scopeBasis === "cross-root") return Math.max(2, rootCount);
	if (scopeBasis === "directory-cluster") return 1;
	if (scopeBasis === "single-file") return 1;
	return Math.max(1, directoryCount);
}
function normalizeScope$1(scope) {
	const trimmed = scope.trim();
	return trimmed.length > 0 ? trimmed : "**";
}
function normalizePath$2(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
function rootFromPath(filePath) {
	const normalized = normalizePath$2(filePath);
	const [root] = normalized.split("/");
	return root || normalized;
}
function directoryFromPath(filePath) {
	const normalized = normalizePath$2(filePath);
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length <= 1) return normalized;
	return segments.slice(0, -1).join("/");
}
//#endregion
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
		const mergedEvidence = dedupeEvidence$1(groupCandidates.flatMap((item) => item.evidence));
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
	const aFiles = new Set(a.evidence.map((item) => normalizePath$1(item.file)).filter(Boolean));
	const bFiles = new Set(b.evidence.map((item) => normalizePath$1(item.file)).filter(Boolean));
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
	const evidenceFiles = Array.from(new Set(group.flatMap((item) => item.evidence.map((evidence) => normalizePath$1(evidence.file))).filter(Boolean))).sort();
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
function dedupeEvidence$1(evidence) {
	const unique = /* @__PURE__ */ new Map();
	for (const item of evidence) {
		const normalized = {
			file: normalizePath$1(item.file),
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
	const evidenceFiles = Array.from(new Set(group.flatMap((item) => item.evidence.map((evidence) => normalizePath$1(evidence.file))).filter(Boolean))).sort();
	const sourceSlices = Array.from(new Set(group.flatMap((item) => item.source_slice_ids))).sort();
	return `merged ${group.length} candidates by matching category + semantic_key with overlapping evidence files or source slices; semantic_key=${group[0]?.semantic_key ?? "(unknown)"}; evidence_files=${evidenceFiles.join(", ") || "(none)"}; source_slices=${sourceSlices.join(", ") || "(none)"}`;
}
function describeSupportDerivation(support, evidence) {
	return `derived from ${Array.from(new Set(evidence.map((item) => normalizePath$1(item.file)).filter(Boolean))).sort().length} evidence files and ${support.source_slices.length} source slices; scope_basis=${support.scope_basis}; file_count=${support.file_count}; cluster_count=${support.cluster_count}`;
}
function describeScopeDerivation(scopeHint, support, finalScope) {
	return `started from scope_hint=${scopeHint || "**"}; derived final scope ${finalScope} from scope_basis=${support.scope_basis}`;
}
function normalizePattern(pattern) {
	return pattern.replace(/\s+/g, " ").trim();
}
function normalizePath$1(filePath) {
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
			...observation.traits ? { traits: serializeTraits(observation) } : {},
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
function serializeTraits(observation) {
	const traits = observation.traits;
	if (traits == null) return void 0;
	const serialized = {
		...traits.legacy !== void 0 ? { legacy: traits.legacy } : {},
		...traits.migration_boundary !== void 0 ? { migration_boundary: traits.migration_boundary } : {},
		...traits.anti_pattern !== void 0 ? { anti_pattern: traits.anti_pattern } : {},
		...traits.compatibility_boundary !== void 0 ? { compatibility_boundary: traits.compatibility_boundary } : {}
	};
	return Object.keys(serialized).length ? serialized : void 0;
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
		traits: observation.traits,
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
//#region src/validate-refresh.ts
const MIN_CONFIDENCE$1 = .3;
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
				reason: classifyStructureErrors$1(entry.structureErrors),
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
				reason: classifyStructureErrors$1(structureErrors),
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
		if (observation.confidence < MIN_CONFIDENCE$1) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Confidence ${observation.confidence} is below minimum threshold ${MIN_CONFIDENCE$1}.`,
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
				reason: classifyStructureErrors$1(item.structureErrors),
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
		if (!Number.isFinite(entry.confidence) || entry.confidence < MIN_CONFIDENCE$1 || entry.confidence > 1) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Retire confidence must be between ${MIN_CONFIDENCE$1} and 1.`,
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
			entries.push(rejected(path, classifyStructureErrors$1(item.structureErrors), item.structureErrors.join("; ")));
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
			entries.push(rejected(path, classifyStructureErrors$1(item.structureErrors), item.structureErrors.join("; "), proposal.observation_id));
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
		} : null,
		traits: normalizeTraits(item.traits)
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
	if (!Number.isFinite(numberValue(item.confidence)) || numberValue(item.confidence) < MIN_CONFIDENCE$1 || numberValue(item.confidence) > 1) errors.push(`${path}: confidence must be between ${MIN_CONFIDENCE$1} and 1`);
	if (!validEvidenceRefs(item.evidence_refs)) errors.push(`${path}: evidence_refs must contain at least one valid evidence reference`);
	if (!isNonEmptyString(item.reason)) errors.push(`${path}: missing or invalid 'reason'`);
	return errors;
}
function validateCounterexampleRecord(item, path) {
	const errors = [];
	if (!isNonEmptyString(item.observation_id)) errors.push(`${path}: missing or invalid 'observation_id'`);
	if (!Number.isFinite(numberValue(item.confidence)) || numberValue(item.confidence) < MIN_CONFIDENCE$1 || numberValue(item.confidence) > 1) errors.push(`${path}: confidence must be between ${MIN_CONFIDENCE$1} and 1`);
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
function normalizeTraits(value) {
	if (!isRecord(value)) return void 0;
	const traits = {
		legacy: booleanValue(value.legacy),
		migration_boundary: booleanValue(value.migration_boundary),
		anti_pattern: booleanValue(value.anti_pattern),
		compatibility_boundary: booleanValue(value.compatibility_boundary)
	};
	return Object.values(traits).some((item) => item !== void 0) ? traits : void 0;
}
function booleanValue(value) {
	return typeof value === "boolean" ? value : void 0;
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
function classifyStructureErrors$1(errors) {
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
//#region src/verify/verify-evidence.ts
function verifyEvidenceForDocument(rccl, projectRoot, now = /* @__PURE__ */ new Date(), policy = DEFAULT_VERIFICATION_POLICY) {
	return {
		...rccl,
		observations: rccl.observations.map((observation) => verifyObservationEvidence(observation, projectRoot, now.toISOString(), policy))
	};
}
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
	const fullPath = join(projectRoot, evidence.file);
	if (!existsSync(fullPath)) return { status: "file-not-found" };
	const lines = readFileSync(fullPath, "utf-8").replace(/\r\n/g, "\n").split("\n");
	const [start, end] = evidence.line_range;
	if (start < 1 || end < start || end > lines.length) return { status: "range-out-of-bounds" };
	return tokenOverlapSimilarity(lines.slice(start - 1, end).join("\n"), evidence.snippet) >= policy.snippet_similarity_threshold ? { status: "match" } : { status: "mismatch" };
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
//#region src/verify/verify-induction.ts
function verifyInductionForDocument(rccl, policy = DEFAULT_VERIFICATION_POLICY) {
	return {
		...rccl,
		observations: rccl.observations.map((observation) => verifyObservationInduction(observation, policy))
	};
}
function verifyObservationInduction(observation, policy = DEFAULT_VERIFICATION_POLICY) {
	const evidenceCount = observation.verification.evidence_verified_count ?? 0;
	const minRequired = minimumEvidence(observation, policy);
	let induction_status = "well-supported";
	let induction_confidence = observation.verification.evidence_confidence ?? 0;
	if (observation.support.scope_basis === "cross-root" && evidenceCount < policy.min_evidence_for_cross_root_scope) {
		induction_status = "overgeneralized";
		induction_confidence = Math.min(induction_confidence, .35);
	} else if (observation.support.scope_basis === "directory-cluster" && evidenceCount < policy.min_evidence_for_directory_scope) {
		induction_status = "narrowly-supported";
		induction_confidence = Math.min(induction_confidence, .5);
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
//#region src/commit-refresh.ts
const MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE = .7;
const MIN_COUNTEREXAMPLE_CONFIDENCE = .7;
function commitRcclObservationRefresh(projectRootInput, yamlText, options = {}) {
	const projectRoot = resolve(projectRootInput);
	const existingPath = join(projectRoot, ".resonant-code", "rccl.yaml");
	if (!existsSync(existingPath)) return {
		status: "failed",
		reason: "missing-existing-rccl",
		errors: ["Existing .resonant-code/rccl.yaml is required before committing an incremental refresh."]
	};
	const parsedExisting = parseRccl(readFileSync(existingPath, "utf-8"), { allowVerifiedFields: true });
	if (!parsedExisting.valid || !parsedExisting.data) return {
		status: "failed",
		reason: "invalid-existing-rccl",
		errors: parsedExisting.errors ?? ["Existing .resonant-code/rccl.yaml could not be parsed."]
	};
	const existing = parsedExisting.data;
	const activeExisting = existing.observations.filter(isActiveObservation);
	const validation = validateRcclObservationRefreshPayload(yamlText, {
		allowedObservationIds: existing.observations.map((observation) => observation.id),
		activeObservationIds: activeExisting.map((observation) => observation.id)
	});
	if (!validation.valid || !validation.document) return {
		status: "failed",
		reason: "invalid-refresh-payload",
		diagnostics: validation.diagnostics
	};
	const materialized = materializeRefresh(existing, validation.document, projectRoot);
	const counterexampleAdjudication = applyCounterexamples(verifyInductionForDocument(verifyEvidenceForDocument({
		version: "1.0",
		generated_at: validation.document.generated_at,
		git_ref: existing.git_ref,
		observations: materialized.activeObservations
	}, projectRoot)), validation.document.counterexamples ?? [], projectRoot);
	const result = emitRccl(counterexampleAdjudication.document, projectRoot);
	const debugArtifacts = options.debugArtifacts ? {
		enabled: true,
		candidates: writeCandidateArtifact(projectRoot, materialized.candidateDocument),
		consolidation: writeConsolidationArtifact(projectRoot, materialized.consolidation, counterexampleAdjudication.document)
	} : { enabled: false };
	return {
		status: "committed",
		diagnostics: validation.diagnostics,
		refresh_summary: {
			...materialized.summary,
			counterexamples: counterexampleAdjudication.summary
		},
		result,
		debugArtifacts
	};
}
function materializeRefresh(existing, refresh, projectRoot) {
	const revisedCandidates = refresh.revise;
	const newCandidates = refresh.new_observations;
	const changedCandidates = [...revisedCandidates, ...newCandidates];
	const revisedById = new Map(revisedCandidates.map((candidate) => [candidate.provisional_id, materializeCandidate(candidate)]));
	const newObservations = newCandidates.map(materializeCandidate);
	const retiredIds = new Set(refresh.retire.map((entry) => entry.observation_id));
	const usedRevisions = /* @__PURE__ */ new Set();
	const carriedForward = [];
	const activeObservations = [];
	for (const observation of existing.observations.filter(isActiveObservation)) {
		if (retiredIds.has(observation.id)) continue;
		const revised = revisedById.get(observation.id);
		if (revised) {
			activeObservations.push(revised);
			usedRevisions.add(observation.id);
			continue;
		}
		activeObservations.push(stripLifecycle(observation));
		if (!refresh.keep.includes(observation.id)) carriedForward.push(observation.id);
	}
	for (const id of revisedById.keys()) if (!usedRevisions.has(id)) throw new Error(`Refresh revise "${id}" did not match an active observation.`);
	activeObservations.push(...newObservations);
	const equivalenceAdjudication = applySemanticEquivalence(activeObservations, refresh.semantic_equivalence ?? [], projectRoot);
	const candidateDocument = {
		version: "1.0",
		generated_at: refresh.generated_at,
		git_ref: existing.git_ref,
		observations: changedCandidates
	};
	const consolidation = consolidateObservations(changedCandidates);
	return {
		activeObservations: equivalenceAdjudication.observations.sort((a, b) => a.id.localeCompare(b.id)),
		candidateDocument,
		consolidation,
		summary: {
			previous_observation_count: existing.observations.length,
			active_observation_count: equivalenceAdjudication.observations.length,
			kept: refresh.keep.slice().sort(),
			carried_forward: carriedForward.sort(),
			revised: revisedCandidates.map((candidate) => candidate.provisional_id).sort(),
			retired: refresh.retire.map((entry) => entry.observation_id).sort(),
			added: newCandidates.map((candidate) => candidate.provisional_id).sort(),
			semantic_equivalence: equivalenceAdjudication.summary,
			counterexamples: []
		}
	};
}
function materializeCandidate(candidate) {
	const [observation] = materializeRcclObservations(consolidateObservations([candidate]).observations);
	if (!observation) throw new Error(`Refresh candidate "${candidate.provisional_id}" could not be materialized.`);
	return observation;
}
function isActiveObservation(observation) {
	return observation.lifecycle?.status == null || observation.lifecycle.status === "active";
}
function stripLifecycle(observation) {
	const { lifecycle: _lifecycle, ...rest } = observation;
	return rest;
}
function applySemanticEquivalence(observations, proposals, projectRoot) {
	let current = observations.slice();
	const summary = [];
	for (const proposal of proposals) {
		const byId = new Map(current.map((observation) => [observation.id, observation]));
		const group = uniqueStrings(proposal.observation_ids).map((id) => byId.get(id)).filter((observation) => Boolean(observation));
		if (group.length < 2) {
			summary.push({
				observation_ids: proposal.observation_ids.slice().sort(),
				canonical_id: group[0]?.id ?? null,
				superseded_ids: [],
				confidence: proposal.confidence,
				status: "unused",
				reason: "semantic equivalence proposal did not reference at least two active observations after refresh actions"
			});
			continue;
		}
		const adjudication = adjudicateSemanticEquivalenceProposal(group, proposal, projectRoot);
		if (!adjudication.accepted) {
			summary.push({
				observation_ids: proposal.observation_ids.slice().sort(),
				canonical_id: null,
				superseded_ids: [],
				confidence: proposal.confidence,
				status: "rejected",
				reason: adjudication.reason
			});
			continue;
		}
		const canonical = chooseCanonicalObservation(group);
		const supersededIds = group.map((observation) => observation.id).filter((id) => id !== canonical.id).sort();
		const merged = mergeEquivalentObservations(canonical, group, supersededIds, proposal);
		current = current.filter((observation) => !supersededIds.includes(observation.id)).map((observation) => observation.id === canonical.id ? merged : observation);
		summary.push({
			observation_ids: proposal.observation_ids.slice().sort(),
			canonical_id: canonical.id,
			superseded_ids: supersededIds,
			confidence: proposal.confidence,
			status: "applied",
			reason: proposal.reason
		});
	}
	return {
		observations: current,
		summary
	};
}
function applyCounterexamples(document, proposals, projectRoot) {
	if (!proposals.length) return {
		document,
		summary: []
	};
	const proposalsByObservation = /* @__PURE__ */ new Map();
	for (const proposal of proposals) {
		const current = proposalsByObservation.get(proposal.observation_id) ?? [];
		current.push(proposal);
		proposalsByObservation.set(proposal.observation_id, current);
	}
	const summary = [];
	const handled = /* @__PURE__ */ new Set();
	const observations = document.observations.map((observation) => {
		const candidates = (proposalsByObservation.get(observation.id) ?? []).slice().sort((left, right) => right.confidence - left.confidence);
		for (const proposal of candidates) {
			handled.add(proposal);
			const adjudication = adjudicateCounterexampleProposal(observation, proposal, projectRoot);
			if (!adjudication.accepted) {
				summary.push({
					observation_id: observation.id,
					confidence: proposal.confidence,
					status: "rejected",
					action: "none",
					reason: adjudication.reason
				});
				continue;
			}
			const action = resolveCounterexampleAction(observation, proposal);
			summary.push({
				observation_id: observation.id,
				confidence: proposal.confidence,
				status: "applied",
				action,
				reason: adjudication.reason
			});
			return applyCounterexampleToObservation(observation, proposal, action);
		}
		return observation;
	});
	for (const proposal of proposals) {
		if (handled.has(proposal)) continue;
		summary.push({
			observation_id: proposal.observation_id,
			confidence: proposal.confidence,
			status: "unused",
			action: "none",
			reason: "counterexample proposal did not reference an active observation after refresh materialization"
		});
	}
	return {
		document: {
			...document,
			observations
		},
		summary: summary.sort((a, b) => a.observation_id.localeCompare(b.observation_id))
	};
}
function adjudicateSemanticEquivalenceProposal(group, proposal, projectRoot) {
	if (proposal.confidence < MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE) return rejectedAdjudication(`semantic equivalence confidence ${proposal.confidence} is below commit threshold ${MIN_SEMANTIC_EQUIVALENCE_CONFIDENCE}`);
	if (!sameCategory(group)) return rejectedAdjudication("semantic equivalence rejected because observations are in different RCCL categories");
	if (!semanticallyCompatibleObservations(group)) return rejectedAdjudication("semantic equivalence rejected because semantic_key and pattern similarity are not deterministically compatible");
	if (!hasObservationSupportOverlap(group)) return rejectedAdjudication("semantic equivalence rejected because observations have no overlapping scope or evidence files");
	const evidence = verifyProposalEvidenceRefs(proposal.evidence_refs, projectRoot, group);
	if (!evidence.verified) return rejectedAdjudication(`semantic equivalence rejected because proposal evidence_refs failed static verification: ${evidence.reason}`);
	return acceptedAdjudication(`semantic equivalence accepted after category, semantic-key/pattern, support-overlap, and evidence verification gates; ${proposal.reason}`);
}
function adjudicateCounterexampleProposal(observation, proposal, projectRoot) {
	if (proposal.confidence < MIN_COUNTEREXAMPLE_CONFIDENCE) return rejectedAdjudication(`counterexample confidence ${proposal.confidence} is below commit threshold ${MIN_COUNTEREXAMPLE_CONFIDENCE}`);
	const evidence = verifyProposalEvidenceRefs(proposal.evidence_refs, projectRoot, [observation]);
	if (!evidence.verified) return rejectedAdjudication(`counterexample rejected because evidence_refs failed static verification: ${evidence.reason}`);
	if (!counterexampleTouchesObservationScope(evidence.verifiedRefs, observation)) return rejectedAdjudication("counterexample rejected because verified evidence is outside the observation scope and evidence files");
	if (!counterexampleAddsIndependentEvidence(evidence.verifiedRefs, observation)) return rejectedAdjudication("counterexample rejected because verified evidence only restates the observation evidence instead of adding independent counterevidence");
	return acceptedAdjudication(`counterexample accepted after static evidence verification and scope adjudication; ${proposal.reason}`);
}
function acceptedAdjudication(reason) {
	return {
		accepted: true,
		reason
	};
}
function rejectedAdjudication(reason) {
	return {
		accepted: false,
		reason
	};
}
function applyCounterexampleToObservation(observation, proposal, action) {
	const confidenceCeiling = action === "demoted-to-ambient" ? .4 : .6;
	const evidenceConfidence = Math.min(observation.verification.evidence_confidence ?? observation.confidence, confidenceCeiling);
	const inductionConfidence = Math.min(observation.verification.induction_confidence ?? evidenceConfidence, confidenceCeiling);
	return {
		...observation,
		confidence: Number(Math.min(observation.confidence, Math.max(.2, 1 - proposal.confidence), confidenceCeiling).toFixed(2)),
		verification: {
			...observation.verification,
			evidence_confidence: Number(evidenceConfidence.toFixed(2)),
			induction_status: action === "demoted-to-ambient" ? "ambiguous" : observation.verification.induction_status,
			induction_confidence: Number(inductionConfidence.toFixed(2)),
			disposition: action === "demoted-to-ambient" ? "demote-to-ambient" : downgradeDisposition(observation.verification.disposition)
		}
	};
}
function resolveCounterexampleAction(observation, proposal) {
	const broadScope = observation.support.scope_basis !== "single-file" || observation.scope.includes("*") || observation.scope.endsWith("/") || !observation.evidence.some((evidence) => normalizePath(evidence.file) === normalizePath(observation.scope));
	const alreadyWeak = observation.verification.disposition !== "keep" || observation.verification.induction_status === "overgeneralized" || observation.verification.induction_status === "ambiguous";
	if (proposal.confidence >= .85 && (broadScope || alreadyWeak)) return "demoted-to-ambient";
	return "reduced-confidence";
}
function downgradeDisposition(disposition) {
	if (disposition === "demote-to-ambient") return disposition;
	return "keep-with-reduced-confidence";
}
function chooseCanonicalObservation(group) {
	return group.slice().sort((left, right) => {
		const confidence = right.confidence - left.confidence;
		if (confidence !== 0) return confidence;
		const evidenceCount = right.evidence.length - left.evidence.length;
		if (evidenceCount !== 0) return evidenceCount;
		return left.id.localeCompare(right.id);
	})[0];
}
function mergeEquivalentObservations(canonical, group, supersededIds, proposal) {
	const evidence = dedupeEvidence(group.flatMap((observation) => observation.evidence));
	const sourceSlices = uniqueStrings(group.flatMap((observation) => observation.support.source_slices));
	const supersedes = uniqueStrings([...canonical.lifecycle?.supersedes ?? [], ...supersededIds]).sort();
	return {
		...canonical,
		confidence: Number(Math.min(Math.max(...group.map((observation) => observation.confidence)), proposal.confidence).toFixed(2)),
		traits: mergeObservationTraits(group),
		evidence,
		support: {
			source_slices: sourceSlices,
			file_count: Math.max(uniqueStrings(evidence.map((item) => normalizePath(item.file))).length, canonical.support.file_count),
			cluster_count: Math.max(...group.map((observation) => observation.support.cluster_count)),
			scope_basis: canonical.support.scope_basis
		},
		verification: {
			evidence_status: null,
			evidence_verified_count: null,
			evidence_confidence: null,
			induction_status: null,
			induction_confidence: null,
			checked_at: null,
			disposition: null
		},
		lifecycle: {
			first_seen_git_ref: canonical.lifecycle?.first_seen_git_ref ?? null,
			last_seen_git_ref: canonical.lifecycle?.last_seen_git_ref ?? null,
			last_verified_at: canonical.lifecycle?.last_verified_at ?? null,
			content_fingerprint: canonical.lifecycle?.content_fingerprint ?? "semantic-equivalence-merge",
			status: "active",
			supersedes
		}
	};
}
function mergeObservationTraits(observations) {
	const traits = {
		legacy: observations.some((item) => item.traits?.legacy === true) || void 0,
		migration_boundary: observations.some((item) => item.traits?.migration_boundary === true) || void 0,
		anti_pattern: observations.some((item) => item.traits?.anti_pattern === true) || void 0,
		compatibility_boundary: observations.some((item) => item.traits?.compatibility_boundary === true) || void 0
	};
	return Object.values(traits).some((value) => value !== void 0) ? traits : void 0;
}
function dedupeEvidence(evidence) {
	const byKey = /* @__PURE__ */ new Map();
	for (const item of evidence) {
		const normalized = {
			file: normalizePath(item.file),
			line_range: [item.line_range[0], item.line_range[1]],
			snippet: item.snippet
		};
		const key = `${normalized.file}:${normalized.line_range[0]}-${normalized.line_range[1]}:${normalized.snippet}`;
		if (!byKey.has(key)) byKey.set(key, normalized);
	}
	return Array.from(byKey.values()).sort((left, right) => {
		const file = left.file.localeCompare(right.file);
		if (file !== 0) return file;
		if (left.line_range[0] !== right.line_range[0]) return left.line_range[0] - right.line_range[0];
		return left.line_range[1] - right.line_range[1];
	});
}
function sameCategory(observations) {
	return new Set(observations.map((observation) => observation.category)).size === 1;
}
function semanticallyCompatibleObservations(observations) {
	if (new Set(observations.map((observation) => observation.semantic_key)).size === 1) return true;
	for (let index = 0; index < observations.length; index += 1) for (let next = index + 1; next < observations.length; next += 1) if (textSimilarity(semanticText(observations[index]), semanticText(observations[next])) < .72) return false;
	return true;
}
function semanticText(observation) {
	return `${observation.semantic_key} ${observation.category} ${observation.pattern}`;
}
function hasObservationSupportOverlap(observations) {
	return observations.every((observation) => observations.some((other) => other.id !== observation.id && observationsOverlap(observation, other)));
}
function observationsOverlap(left, right) {
	return scopesOverlap(left.scope, right.scope) || evidenceFilesOverlap(left, right) || sourceSlicesOverlap(left, right);
}
function sourceSlicesOverlap(left, right) {
	const rightSlices = new Set(right.support.source_slices);
	return left.support.source_slices.some((slice) => rightSlices.has(slice));
}
function evidenceFilesOverlap(left, right) {
	const rightFiles = new Set(right.evidence.map((evidence) => normalizePath(evidence.file)));
	return left.evidence.some((evidence) => rightFiles.has(normalizePath(evidence.file)));
}
function scopesOverlap(left, right) {
	const normalizedLeft = normalizeScope(left);
	const normalizedRight = normalizeScope(right);
	if (normalizedLeft === "*" || normalizedLeft === "**" || normalizedLeft === "**/*") return true;
	if (normalizedRight === "*" || normalizedRight === "**" || normalizedRight === "**/*") return true;
	if (normalizedLeft === normalizedRight) return true;
	if (normalizedLeft.includes("*") || normalizedRight.includes("*")) {
		const leftPrefix = normalizedLeft.split("*")[0].replace(/\/$/, "");
		const rightPrefix = normalizedRight.split("*")[0].replace(/\/$/, "");
		return Boolean(leftPrefix && rightPrefix && (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)));
	}
	return normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
}
function normalizeScope(scope) {
	return normalizePath(scope).replace(/\/+$/, "");
}
function counterexampleTouchesObservationScope(refs, observation) {
	return refs.some((ref) => {
		if (ref.kind === "rccl-evidence") return rcclEvidenceRefMatchesObservation(ref, observation);
		if (!ref.file) return false;
		const file = normalizePath(ref.file);
		return fileMatchesScope(file, observation.scope) || observation.evidence.some((evidence) => normalizePath(evidence.file) === file);
	});
}
function counterexampleAddsIndependentEvidence(refs, observation) {
	return refs.some((ref) => {
		if (ref.kind === "rccl-evidence") return false;
		if (!ref.file || !ref.line_range) return false;
		return !observation.evidence.some((evidence) => normalizePath(evidence.file) === normalizePath(ref.file ?? "") && evidence.line_range[0] === ref.line_range?.[0] && evidence.line_range[1] === ref.line_range?.[1]);
	});
}
function fileMatchesScope(file, scope) {
	const normalizedScope = normalizeScope(scope);
	if (normalizedScope === "*" || normalizedScope === "**" || normalizedScope === "**/*") return true;
	if (normalizedScope.includes("*")) {
		const prefix = normalizedScope.split("*")[0].replace(/\/$/, "");
		return prefix ? file.startsWith(prefix) : true;
	}
	return file === normalizedScope || file.startsWith(`${normalizedScope}/`);
}
function verifyProposalEvidenceRefs(refs, projectRoot, observations) {
	let verifiedCount = 0;
	let strongCount = 0;
	const verifiedRefs = [];
	const failures = [];
	for (const ref of refs) {
		const result = verifyProposalEvidenceRef(ref, projectRoot, observations);
		if (result.verified) {
			verifiedCount += 1;
			if (result.strong) strongCount += 1;
			verifiedRefs.push(ref);
		} else failures.push(result.reason);
	}
	return {
		verified: verifiedCount > 0,
		verifiedCount,
		strongCount,
		verifiedRefs,
		reason: verifiedCount > 0 ? `${verifiedCount}/${refs.length} evidence ref(s) statically verified` : failures.slice(0, 3).join("; ") || "no statically verifiable evidence refs"
	};
}
function verifyProposalEvidenceRef(ref, projectRoot, observations) {
	if (ref.kind === "rccl-evidence") return rcclEvidenceRefMatchesAnyObservation(ref, observations) ? {
		verified: true,
		strong: true,
		reason: "rccl-evidence ref matches existing observation evidence"
	} : {
		verified: false,
		strong: false,
		reason: `rccl-evidence ref ${ref.ref} does not match observation evidence`
	};
	if (ref.kind !== "file" && ref.kind !== "diff") return {
		verified: false,
		strong: false,
		reason: `${ref.kind} evidence is not statically verifiable by RCCL commit`
	};
	if (!ref.file || !ref.line_range) return {
		verified: false,
		strong: false,
		reason: `${ref.ref} is missing file or line_range`
	};
	const fullPath = join(projectRoot, ref.file);
	if (!existsSync(fullPath)) return {
		verified: false,
		strong: false,
		reason: `${ref.file} does not exist`
	};
	const lines = readFileSync(fullPath, "utf-8").replace(/\r\n/g, "\n").split("\n");
	const [start, end] = ref.line_range;
	if (start < 1 || end < start || end > lines.length) return {
		verified: false,
		strong: false,
		reason: `${ref.file}:${start}-${end} is outside file bounds`
	};
	if (ref.snippet_hash) {
		if (!snippetHashMatches(lines.slice(start - 1, end).join("\n"), ref.snippet_hash)) return {
			verified: false,
			strong: false,
			reason: `${ref.file}:${start}-${end} snippet_hash does not match current source`
		};
		return {
			verified: true,
			strong: true,
			reason: `${ref.file}:${start}-${end} hash verified`
		};
	}
	return {
		verified: true,
		strong: false,
		reason: `${ref.file}:${start}-${end} range verified`
	};
}
function rcclEvidenceRefMatchesAnyObservation(ref, observations) {
	return observations.some((observation) => rcclEvidenceRefMatchesObservation(ref, observation));
}
function rcclEvidenceRefMatchesObservation(ref, observation) {
	return observation.evidence.some((evidence) => evidenceRefMatchesEvidence(ref, evidence.file, evidence.line_range));
}
function evidenceRefMatchesEvidence(ref, file, lineRange) {
	const normalizedFile = normalizePath(file);
	const expected = `${normalizedFile}:${lineRange[0]}-${lineRange[1]}`;
	if (normalizePath(ref.ref) === expected) return true;
	if (!ref.file || !ref.line_range) return false;
	return normalizePath(ref.file) === normalizedFile && ref.line_range[0] === lineRange[0] && ref.line_range[1] === lineRange[1];
}
function snippetHashMatches(snippet, expectedHash) {
	const expected = expectedHash.replace(/^sha(?:1|256):/i, "").toLowerCase();
	const normalized = snippet.replace(/\r\n/g, "\n");
	const sha1 = createHash("sha1").update(normalized).digest("hex");
	const sha256 = createHash("sha256").update(normalized).digest("hex");
	return expected === sha1 || expected === sha256;
}
function textSimilarity(left, right) {
	const leftTokens = tokenSet(left);
	const rightTokens = tokenSet(right);
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
	return overlap / Math.max(leftTokens.size, rightTokens.size);
}
function tokenSet(value) {
	return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}
function uniqueStrings(values) {
	return [...new Set(values.filter(Boolean))];
}
function normalizePath(filePath) {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
//#endregion
//#region src/validate-candidates.ts
const MIN_CONFIDENCE = .3;
function validateRcclCandidatePayload(yamlText) {
	const parsed = parseRcclCandidates(yamlText);
	if (!parsed.valid || !parsed.data) return {
		valid: false,
		observations: [],
		document: null,
		diagnostics: {
			kind: "rccl-observation-generation",
			summary: {
				total: 0,
				accepted: 0,
				rejected: 1
			},
			entries: [{
				status: "rejected",
				reason: classifyParseErrors(parsed.errors ?? []),
				path: "document",
				message: (parsed.errors ?? []).join("; ") || "Failed to parse candidate YAML"
			}]
		}
	};
	return validateCandidateDocument(parsed.data);
}
function validateCandidateDocument(doc) {
	const entries = [];
	const accepted = [];
	const seenIds = /* @__PURE__ */ new Set();
	for (let i = 0; i < doc.observations.length; i += 1) {
		const obs = doc.observations[i];
		const path = `observations[${i}]`;
		const id = obs.provisional_id;
		if (seenIds.has(id)) {
			entries.push({
				status: "rejected",
				reason: "duplicate-id",
				path,
				message: `Duplicate provisional_id "${id}"; only the first occurrence is accepted.`,
				observationId: id
			});
			continue;
		}
		seenIds.add(id);
		const structureErrors = validateCandidateObservationShape(obs, path);
		if (structureErrors.length) {
			entries.push({
				status: "rejected",
				reason: classifyStructureErrors(structureErrors),
				path,
				message: structureErrors.join("; "),
				observationId: id || void 0,
				confidence: Number.isFinite(obs.confidence) ? obs.confidence : void 0
			});
			continue;
		}
		if (obs.confidence < MIN_CONFIDENCE) {
			entries.push({
				status: "rejected",
				reason: "low-confidence",
				path,
				message: `Confidence ${obs.confidence} is below minimum threshold ${MIN_CONFIDENCE}.`,
				observationId: id,
				confidence: obs.confidence
			});
			continue;
		}
		entries.push({
			status: "accepted",
			reason: "accepted",
			path,
			message: `Candidate "${id}" accepted.`,
			observationId: id,
			confidence: obs.confidence
		});
		accepted.push(obs);
	}
	const summary = {
		total: doc.observations.length,
		accepted: accepted.length,
		rejected: doc.observations.length - accepted.length
	};
	return {
		valid: accepted.length > 0,
		observations: accepted,
		document: {
			version: doc.version,
			generated_at: doc.generated_at,
			git_ref: doc.git_ref
		},
		diagnostics: {
			kind: "rccl-observation-generation",
			summary,
			entries
		}
	};
}
function classifyParseErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("yaml parse error") || joined.includes("must be a yaml object")) return "malformed-payload";
	if (joined.includes("missing") || joined.includes("must be")) return "missing-required-field";
	return "malformed-payload";
}
function classifyStructureErrors(errors) {
	const joined = errors.join(" ").toLowerCase();
	if (joined.includes("missing") || joined.includes("must be a non-empty")) return "missing-required-field";
	return "unsupported-value";
}
//#endregion
//#region src/io/parse-rccl-workflow.ts
const RCCL_VERSION = "1.0";
const ID_PATTERN = /^obs-[a-z0-9-]+$/;
function isRcclVersion(value) {
	return value === RCCL_VERSION || value === 1;
}
const VALID_CATEGORIES = new Set([
	"style",
	"architecture",
	"pattern",
	"constraint",
	"legacy",
	"anti-pattern",
	"migration"
]);
const VALID_CRITIQUE_DISPOSITIONS = new Set([
	"keep",
	"revise",
	"drop"
]);
function parseRcclDiscoveryArtifact(yamlText) {
	const parsed = parseRawWorkflowDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateDiscoveryDocument(parsed.doc);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeDiscoveryDocument(parsed.doc)
	};
}
function parseRcclCritiqueArtifact(yamlText) {
	const parsed = parseRawWorkflowDocument(yamlText);
	if (!parsed.valid || !parsed.doc) return {
		valid: false,
		errors: parsed.errors
	};
	const errors = validateCritiqueDocument(parsed.doc);
	if (errors.length > 0) return {
		valid: false,
		errors
	};
	return {
		valid: true,
		data: normalizeCritiqueDocument(parsed.doc)
	};
}
function parseRawWorkflowDocument(yamlText) {
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
function validateEnvelope(doc, stage, collectionField) {
	const errors = [];
	if (!isRcclVersion(doc.version)) errors.push(`'version' must be "${RCCL_VERSION}", got "${doc.version}"`);
	if (doc.stage !== stage) errors.push(`'stage' must be "${stage}", got "${doc.stage}"`);
	if (doc.generated_at !== null && typeof doc.generated_at !== "string") errors.push("'generated_at' must be null or a string");
	if (!doc.scope || typeof doc.scope !== "string") errors.push("missing or invalid 'scope'");
	if (!Array.isArray(doc[collectionField]) || doc[collectionField].length === 0) errors.push(`'${collectionField}' must be a non-empty array`);
	return errors;
}
function validateDiscoveryDocument(doc) {
	const errors = validateEnvelope(doc, "discover", "seeds");
	if (errors.length > 0) return errors;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < doc.seeds.length; i += 1) {
		const seed = doc.seeds[i];
		const prefix = `seeds[${i}]`;
		const seedId = String(seed.seed_id ?? "");
		if (!seedId || typeof seed.seed_id !== "string") errors.push(`${prefix}: missing or invalid 'seed_id'`);
		else if (!ID_PATTERN.test(seedId)) errors.push(`${prefix}: 'seed_id' "${seedId}" does not match /^obs-[a-z0-9-]+$/`);
		else if (ids.has(seedId)) errors.push(`Duplicate discovery seed id: "${seedId}"`);
		ids.add(seedId);
		if (!seed.semantic_key || typeof seed.semantic_key !== "string") errors.push(`${prefix}: missing or invalid 'semantic_key'`);
		if (!VALID_CATEGORIES.has(String(seed.category))) errors.push(`${prefix}: 'category' is invalid`);
		if (!seed.scope_hint || typeof seed.scope_hint !== "string") errors.push(`${prefix}: missing or invalid 'scope_hint'`);
		if (!seed.pattern || typeof seed.pattern !== "string") errors.push(`${prefix}: missing or invalid 'pattern'`);
		if (!seed.decision_impact || typeof seed.decision_impact !== "string") errors.push(`${prefix}: missing or invalid 'decision_impact'`);
		if (!Array.isArray(seed.source_slice_ids) || seed.source_slice_ids.length === 0) errors.push(`${prefix}: missing or invalid 'source_slice_ids'`);
		errors.push(...validateEvidenceList(seed.evidence, `${prefix}.evidence`));
		if (seed.uncertainty != null && typeof seed.uncertainty !== "string") errors.push(`${prefix}.uncertainty: must be null or a string`);
	}
	return errors;
}
function validateCritiqueDocument(doc) {
	const errors = validateEnvelope(doc, "critique", "reviews");
	if (errors.length > 0) return errors;
	const ids = /* @__PURE__ */ new Set();
	for (let i = 0; i < doc.reviews.length; i += 1) {
		const review = doc.reviews[i];
		const prefix = `reviews[${i}]`;
		const seedId = String(review.seed_id ?? "");
		if (!seedId || typeof review.seed_id !== "string") errors.push(`${prefix}: missing or invalid 'seed_id'`);
		else if (!ID_PATTERN.test(seedId)) errors.push(`${prefix}: 'seed_id' "${seedId}" does not match /^obs-[a-z0-9-]+$/`);
		else if (ids.has(seedId)) errors.push(`Duplicate critique seed id: "${seedId}"`);
		ids.add(seedId);
		if (!VALID_CRITIQUE_DISPOSITIONS.has(review.disposition)) errors.push(`${prefix}: 'disposition' is invalid`);
		if (!Array.isArray(review.reasons) || review.reasons.length === 0) errors.push(`${prefix}: missing or invalid 'reasons'`);
		if (review.issues != null && !Array.isArray(review.issues)) errors.push(`${prefix}.issues: must be an array when present`);
		if (review.counter_evidence != null) errors.push(...validateEvidenceList(review.counter_evidence, `${prefix}.counter_evidence`));
		if (review.recommended_scope_hint != null && typeof review.recommended_scope_hint !== "string") errors.push(`${prefix}.recommended_scope_hint: must be null or a string`);
	}
	return errors;
}
function validateEvidenceList(value, prefix) {
	const errors = [];
	if (!Array.isArray(value) || value.length === 0) return [`${prefix}: must be a non-empty array`];
	for (let i = 0; i < value.length; i += 1) {
		const evidence = value[i];
		if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
			errors.push(`${prefix}[${i}]: must be an object`);
			continue;
		}
		if (!evidence.file || typeof evidence.file !== "string") errors.push(`${prefix}[${i}]: missing or invalid 'file'`);
		if (!Array.isArray(evidence.line_range) || evidence.line_range.length !== 2) errors.push(`${prefix}[${i}]: invalid 'line_range'`);
		if (!evidence.snippet || typeof evidence.snippet !== "string") errors.push(`${prefix}[${i}]: missing or invalid 'snippet'`);
	}
	return errors;
}
function normalizeEvidenceList(value) {
	return value.map((evidence) => ({
		file: String(evidence.file),
		line_range: [Number(evidence.line_range[0]), Number(evidence.line_range[1])],
		snippet: String(evidence.snippet)
	}));
}
function normalizeDiscoveryDocument(doc) {
	return {
		version: RCCL_VERSION,
		stage: "discover",
		generated_at: doc.generated_at == null ? null : String(doc.generated_at),
		scope: String(doc.scope),
		seeds: doc.seeds.map((seed) => ({
			seed_id: String(seed.seed_id),
			semantic_key: String(seed.semantic_key),
			category: seed.category,
			scope_hint: String(seed.scope_hint),
			pattern: String(seed.pattern),
			decision_impact: String(seed.decision_impact),
			evidence: normalizeEvidenceList(seed.evidence),
			source_slice_ids: seed.source_slice_ids.map(String),
			uncertainty: seed.uncertainty == null ? null : String(seed.uncertainty)
		}))
	};
}
function normalizeCritiqueDocument(doc) {
	return {
		version: RCCL_VERSION,
		stage: "critique",
		generated_at: doc.generated_at == null ? null : String(doc.generated_at),
		scope: String(doc.scope),
		reviews: doc.reviews.map((review) => ({
			seed_id: String(review.seed_id),
			disposition: review.disposition,
			reasons: review.reasons.map(String),
			issues: review.issues == null ? void 0 : review.issues.map(String),
			counter_evidence: review.counter_evidence == null ? void 0 : normalizeEvidenceList(review.counter_evidence),
			recommended_scope_hint: review.recommended_scope_hint == null ? null : String(review.recommended_scope_hint)
		}))
	};
}
//#endregion
export { DEFAULT_SAMPLING_POLICY, DEFAULT_VERIFICATION_POLICY, commitRcclObservationRefresh, consolidateObservations, deriveScope, deriveSupport, emitRccl, materializeRcclObservations, normalizeDocument, normalizeObservation, parseRccl, parseRcclCandidates, parseRcclCritiqueArtifact, parseRcclDiscoveryArtifact, prepareIncrementalRccl, prepareRccl, prepareRcclWorkflowStage, serializeRccl, validateRcclCandidatePayload, validateRcclObservationRefreshPayload, verifyEvidence, verifyEvidenceForDocument, verifyInductionForDocument, verifyObservationEvidence, verifyObservationInduction, writeCandidateArtifact, writeConsolidationArtifact };
