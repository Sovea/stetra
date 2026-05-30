import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
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
export { buildRepoIndex };
