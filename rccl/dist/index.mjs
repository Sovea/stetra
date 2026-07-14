import { i as toYaml, n as parseCalibrationProposal, r as parseRcclDocument, t as verifyEvidence } from "./evidence.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import ignore from "ignore";
//#region src/indexing/build-repo-index.ts
const MAX_FILES = 2e4;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
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
	[".astro", "astro"],
	[".json", "config"],
	[".yaml", "config"],
	[".yml", "config"],
	[".toml", "config"],
	[".ini", "config"],
	[".md", "documentation"],
	[".mdx", "documentation"],
	[".sql", "schema"],
	[".graphql", "schema"],
	[".proto", "schema"],
	[".tf", "infra"]
]);
const SPECIAL_FILES = new Set([
	"Dockerfile",
	"Makefile",
	"README",
	"LICENSE",
	"SECURITY",
	"CONTRIBUTING",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"Cargo.lock",
	"go.mod",
	"go.sum"
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
	"vendor",
	"target"
]);
function buildRepoIndex(projectRoot, scopeGlob = "auto") {
	const candidates = discoverFiles(projectRoot);
	const scoped = (scopeGlob === "auto" ? candidates : candidates.filter((file) => matchScope(file, scopeGlob))).sort();
	const report = {
		discovered_files: scoped.length,
		indexed_files: 0,
		read_bytes: 0,
		skipped_oversize: 0,
		skipped_unsupported: 0,
		truncated: []
	};
	const files = [];
	for (const file of scoped) {
		if (files.length >= MAX_FILES) {
			report.truncated.push("file-count-limit");
			break;
		}
		if (!isSupported(file)) {
			report.skipped_unsupported += 1;
			continue;
		}
		const full = join(projectRoot, file);
		let size = 0;
		try {
			size = statSync(full).size;
		} catch {
			continue;
		}
		if (size > MAX_FILE_BYTES) {
			report.skipped_oversize += 1;
			continue;
		}
		if (report.read_bytes + size > MAX_TOTAL_BYTES) {
			report.truncated.push("total-read-limit");
			break;
		}
		const indexed = indexFile(projectRoot, file);
		report.read_bytes += size;
		if (indexed) files.push(indexed);
	}
	report.indexed_files = files.length;
	report.truncated = [...new Set(report.truncated)];
	return {
		files,
		report
	};
}
function discoverFiles(projectRoot) {
	if (existsSync(join(projectRoot, ".git"))) try {
		return execFileSync("git", [
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z"
		], {
			cwd: projectRoot,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024
		}).split("\0").filter(Boolean).map(normalize).filter(inScopeGeneratedPolicy);
	} catch {}
	const matcher = ignore();
	const ignorePath = join(projectRoot, ".gitignore");
	if (existsSync(ignorePath)) matcher.add(readFileSync(ignorePath, "utf8"));
	return walkDir(projectRoot, projectRoot, matcher);
}
function walkDir(dir, projectRoot, matcher) {
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
		const rel = normalize(relative(projectRoot, full));
		if (matcher.ignores(rel) || !inScopeGeneratedPolicy(rel)) continue;
		if (entry.isDirectory()) results.push(...walkDir(full, projectRoot, matcher));
		else if (entry.isFile()) results.push(rel);
	}
	return results;
}
function inScopeGeneratedPolicy(file) {
	const segments = normalize(file).split("/");
	return !file.startsWith(".resonant-code/context/") && !file.startsWith(".git/") && !segments.some((segment) => IGNORE_DIRS.has(segment));
}
function isSupported(file) {
	const name = basename(file);
	return SOURCE_EXTENSIONS.has(extname(name).toLowerCase()) || SPECIAL_FILES.has(name) || /(^|\/)(README|ADR)[^/]*$/i.test(file) || /(^|\/)\.github\/workflows\//.test(file);
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
		const language = SOURCE_EXTENSIONS.get(extname(file).toLowerCase()) ?? inferSpecialRole(file);
		const imports = content.match(/\b(import|require|from)\b/g)?.length ?? 0;
		const exports = content.match(/\b(export|module\.exports|pub\s+|func\s+[A-Z]|class\s+)\b/g)?.length ?? 0;
		const symbols = content.match(/\b(function|class|interface|type|const|let|var|def|fn|struct|enum|trait)\b/g)?.length ?? 0;
		return {
			path: file,
			language,
			lines: lines.length,
			is_test: /(^|\/)(__tests__\/|test\/|tests\/)|\.(test|spec)\./.test(file),
			is_generated: /(^|\/)(generated|gen)(\/|\.)/.test(file),
			package_root: file.split("/")[0] || ".",
			imports_count: imports,
			exports_count: exports,
			symbol_density: lines.length === 0 ? 0 : Number((symbols / lines.length).toFixed(3)),
			role_hints: inferRoleHints(file)
		};
	} catch {
		return null;
	}
}
function inferSpecialRole(file) {
	if (/readme|adr|\.mdx?$/i.test(file)) return "documentation";
	if (/docker|\.tf$|infra|deploy/i.test(file)) return "infra";
	return "config";
}
function inferRoleHints(file) {
	return [
		.../(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./.test(file) ? ["test"] : [],
		.../(^|\/)(config|\.github)(\/|$)|\.(json|ya?ml|toml|ini)$/.test(file) ? ["config"] : [],
		.../readme|adr|\.mdx?$/i.test(file) ? ["documentation"] : [],
		.../schema|migration|\.sql$|\.proto$|\.graphql$/.test(file) ? ["schema-or-migration"] : [],
		.../docker|infra|deploy|\.tf$/.test(file) ? ["infra"] : []
	];
}
function normalize(value) {
	return value.replace(/\\/g, "/");
}
//#endregion
//#region src/slicing/extract-windows.ts
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
//#region src/verify.ts
function materializeVerifiedObservation(proposal, projectRoot, gitRef, prior, now = /* @__PURE__ */ new Date()) {
	const checkedAt = now.toISOString();
	const verifiedCount = proposal.evidence.map((evidence) => verifyEvidence(evidence, projectRoot)).filter((result) => result.status === "match").length;
	const status = verifiedCount === proposal.evidence.length ? "current" : verifiedCount > 0 ? "partial" : prior?.evidenceVerification.status === "current" || prior?.evidenceVerification.status === "partial" ? "stale" : "broken";
	const lifecycleStatus = status === "stale" || status === "broken" ? "stale" : "active";
	return {
		...proposal,
		reviewStatus: proposal.reviewStatus ?? "generated",
		evidenceVerification: {
			status,
			verifiedCount,
			totalCount: proposal.evidence.length,
			checkedAt
		},
		lifecycle: {
			status: prior?.lifecycle.status === "superseded" ? "superseded" : lifecycleStatus,
			contentFingerprint: observationFingerprint(proposal),
			firstSeenGitRef: prior?.lifecycle.firstSeenGitRef ?? gitRef,
			lastSeenGitRef: gitRef,
			lastVerifiedAt: checkedAt,
			...prior?.lifecycle.supersededBy ? { supersededBy: prior.lifecycle.supersededBy } : {}
		}
	};
}
function refreshObservationEvidence(observation, projectRoot, gitRef, now = /* @__PURE__ */ new Date()) {
	return materializeVerifiedObservation(observation, projectRoot, gitRef, observation, now);
}
function observationFingerprint(observation) {
	return createHash("sha256").update(JSON.stringify({
		id: observation.id,
		category: observation.category,
		scope: observation.scope,
		statement: observation.statement,
		affects: observation.affects,
		decisionImpact: observation.decisionImpact,
		evidence: observation.evidence
	})).digest("hex").slice(0, 16);
}
//#endregion
//#region src/lifecycle.ts
const DEFAULT_MAX_FILES = 8;
const MAX_ALLOWED_FILES = 20;
function prepareCalibration(input) {
	const projectRoot = resolve(input.projectRoot);
	const maxFiles = Math.min(MAX_ALLOWED_FILES, Math.max(1, input.maxFiles ?? DEFAULT_MAX_FILES));
	const indexed = buildRepoIndex(projectRoot, input.scope ?? "auto");
	const requestedPaths = uniquePaths(input.paths ?? []);
	const selectedFiles = (requestedPaths.length ? indexed.files.filter((file) => requestedPaths.some((path) => overlaps(path, file.path))) : rankFiles(indexed.files)).slice(0, maxFiles);
	const windows = extractWindowsForFiles(projectRoot, selectedFiles, {
		max_slices: 1,
		max_files_per_slice: maxFiles,
		max_windows_per_file: 2,
		target_coverage: {
			roots: false,
			modules: true,
			boundaries: true,
			migrations: true,
			style_clusters: false
		}
	}).map((window) => ({
		file: window.file,
		lineRange: [window.start_line, window.end_line],
		purpose: window.purpose,
		snippet: window.snippet
	}));
	const selectedPaths = selectedFiles.map((file) => file.path);
	const contextFingerprint = hash([
		"1.0",
		selectedPaths,
		windows.map((window) => [
			window.file,
			window.lineRange,
			window.snippet
		])
	]);
	return {
		status: "ready",
		contract: {
			schemaVersion: "1.0",
			requestId: `rccl-calibration:${contextFingerprint}`,
			contextFingerprint,
			selectedPaths,
			prompt: buildPrompt(selectedPaths),
			proposalSchema: proposalSchema()
		},
		context: {
			files: selectedFiles.length,
			windows
		}
	};
}
function commitCalibration(input) {
	const projectRoot = resolve(input.projectRoot);
	const parsed = parseCalibrationProposal(input.proposal);
	const proposedCount = parsed.data?.observations.length ?? 0;
	if (!parsed.valid || !parsed.data) return rejected(parsed.diagnostics, proposedCount);
	const issued = prepareCalibration(input);
	const identityDiagnostics = validateIdentity(parsed.data, issued.contract);
	if (identityDiagnostics.length) return rejected(identityDiagnostics, proposedCount);
	const rcclPath = resolve(input.rcclPath ?? join(projectRoot, ".resonant-code", "rccl.yaml"));
	const existing = loadExistingDocument(rcclPath);
	if (existing.diagnostics.length) return rejected(existing.diagnostics, proposedCount);
	const gitRef = currentGitRef(projectRoot);
	const existingById = new Map(existing.document?.observations.map((observation) => [observation.id, observation]) ?? []);
	const verified = parsed.data.observations.map((proposal) => materializeVerifiedObservation(proposal, projectRoot, gitRef, existingById.get(proposal.id)));
	const verifiedById = new Map(verified.map((observation) => [observation.id, observation]));
	const observations = parsed.data.replace ? verified : [...(existing.document?.observations ?? []).filter((observation) => !verifiedById.has(observation.id)), ...verified].sort((left, right) => left.id.localeCompare(right.id));
	const document = {
		version: "1.0",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		gitRef,
		observations
	};
	writeYamlAtomic(rcclPath, document);
	return {
		status: "committed",
		written: rcclPath,
		document,
		diagnostics: verificationDiagnostics(verified),
		summary: summarize(proposedCount, verified, 0)
	};
}
function validateContext(input) {
	const projectRoot = resolve(input.projectRoot);
	const rcclPath = resolve(input.rcclPath ?? join(projectRoot, ".resonant-code", "rccl.yaml"));
	if (!existsSync(rcclPath)) return {
		status: "missing",
		diagnostics: [],
		changedObservationIds: []
	};
	const parsed = parseRcclDocument(readFileSync(rcclPath, "utf8"));
	if (!parsed.valid || !parsed.data) return {
		status: "invalid",
		diagnostics: parsed.diagnostics,
		changedObservationIds: []
	};
	const gitRef = currentGitRef(projectRoot);
	const observations = parsed.data.observations.map((observation) => refreshObservationEvidence(observation, projectRoot, gitRef));
	const changedObservationIds = observations.filter((observation, index) => observation.evidenceVerification.status !== parsed.data.observations[index].evidenceVerification.status).map((observation) => observation.id);
	const document = {
		...parsed.data,
		generatedAt: input.write ? (/* @__PURE__ */ new Date()).toISOString() : parsed.data.generatedAt,
		gitRef,
		observations
	};
	if (input.write) writeYamlAtomic(rcclPath, document);
	return {
		status: "valid",
		document,
		diagnostics: verificationDiagnostics(observations),
		changedObservationIds
	};
}
function validateIdentity(proposal, contract) {
	const diagnostics = [];
	if (proposal.requestId !== contract.requestId) diagnostics.push({
		path: "requestId",
		code: "REQUEST_ID_MISMATCH",
		message: "Proposal does not match the currently issued calibration request."
	});
	if (proposal.contextFingerprint !== contract.contextFingerprint) diagnostics.push({
		path: "contextFingerprint",
		code: "CONTEXT_FINGERPRINT_MISMATCH",
		message: "Repository context changed; rerun prepare."
	});
	return diagnostics;
}
function loadExistingDocument(rcclPath) {
	if (!existsSync(rcclPath)) return { diagnostics: [] };
	const parsed = parseRcclDocument(readFileSync(rcclPath, "utf8"));
	if (!parsed.valid) return { diagnostics: parsed.diagnostics };
	return {
		document: parsed.data,
		diagnostics: []
	};
}
function verificationDiagnostics(observations) {
	return observations.flatMap((observation) => {
		if (observation.evidenceVerification.status === "current") return [];
		return [{
			path: `observations.${observation.id}.evidence`,
			code: `EVIDENCE_${observation.evidenceVerification.status.toUpperCase()}`,
			message: `${observation.evidenceVerification.verifiedCount}/${observation.evidenceVerification.totalCount} evidence references match the current repository.`
		}];
	});
}
function summarize(proposed, observations, rejectedCount) {
	return {
		proposed,
		accepted: proposed - rejectedCount,
		rejected: rejectedCount,
		current: observations.filter((observation) => observation.evidenceVerification.status === "current").length,
		partial: observations.filter((observation) => observation.evidenceVerification.status === "partial").length,
		stale: observations.filter((observation) => observation.evidenceVerification.status === "stale").length,
		broken: observations.filter((observation) => observation.evidenceVerification.status === "broken").length
	};
}
function rejected(diagnostics, proposed) {
	return {
		status: "rejected",
		diagnostics,
		summary: {
			proposed,
			accepted: 0,
			rejected: proposed,
			current: 0,
			partial: 0,
			stale: 0,
			broken: 0
		}
	};
}
function rankFiles(files) {
	return [...files].sort((left, right) => fileScore(right) - fileScore(left) || left.path.localeCompare(right.path));
}
function fileScore(file) {
	return file.exports_count * 3 + file.imports_count + (file.role_hints.includes("schema-or-migration") ? 20 : 0) + (/index\.|runtime|public|api|boundary/.test(file.path) ? 10 : 0) - (file.role_hints.includes("test") ? 5 : 0) - (file.role_hints.includes("documentation") ? 5 : 0);
}
function overlaps(requested, file) {
	const path = requested.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
	return file === path || file.startsWith(`${path}/`) || path.startsWith(`${file}/`);
}
function uniquePaths(paths) {
	return [...new Set(paths.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "").trim()).filter(Boolean))];
}
function currentGitRef(projectRoot) {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).trim() || null;
	} catch {
		return null;
	}
}
function writeYamlAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, toYaml(value), "utf8");
	renameSync(temporary, path);
}
function hash(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function buildPrompt(paths) {
	return [
		"Propose only repository observations that can change a code implementation or review decision.",
		"Do not summarize metadata, schemas, exports, versions, or facts that a tool can read on demand unless they establish a compatibility or architecture boundary.",
		"For every observation, explain the decision impact and cite exact evidence from the supplied windows.",
		"Prefer zero observations over weak observations.",
		`Selected paths: ${paths.join(", ") || "(none)"}`
	].join("\n");
}
function proposalSchema() {
	return [
		"schemaVersion: \"1.0\"",
		"requestId: \"<from-contract>\"",
		"contextFingerprint: \"<from-contract>\"",
		"replace: false",
		"observations:",
		"  - id: \"obs-kebab-case\"",
		"    category: \"architecture|constraint|compatibility|legacy|anti-pattern|migration|convention\"",
		"    scope: \"path/or/glob\"",
		"    statement: \"observed repository fact\"",
		"    affects: [\"compatibility\"]",
		"    decisionImpact: \"how omitting this fact could worsen a code decision\"",
		"    semanticConfidence: \"low|medium|high\"",
		"    reviewStatus: \"generated|reviewed\"",
		"    evidence:",
		"      - file: \"relative/path\"",
		"        lineRange: [1, 10]",
		"        snippet: \"exact source excerpt\""
	].join("\n");
}
//#endregion
export { commitCalibration, parseCalibrationProposal, parseRcclDocument, prepareCalibration, validateContext };
