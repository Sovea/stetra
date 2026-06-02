import { minimatch } from "./glob.mjs";
//#region src/utils/paths.ts
function normalizePath(value) {
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
	const normalizedScope = normalizePath(scope);
	const normalizedPath = normalizePath(path);
	return pathMatchesScope(normalizedPath, normalizedScope) || pathMatchesScope(normalizedScope, normalizedPath);
}
function fileOverlapsTarget(file, target) {
	const normalizedFile = normalizePath(file);
	const normalizedTarget = normalizePath(target);
	return normalizedFile === normalizedTarget || pathMatchesScope(normalizedFile, normalizedTarget) || pathMatchesScope(normalizedTarget, normalizedFile);
}
//#endregion
export { fileOverlapsTarget, normalizePath, normalizePathSeparators, pathMatchesScope, scopeOverlapsPath };
