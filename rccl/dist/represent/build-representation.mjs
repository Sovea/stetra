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
export { buildRepresentation };
