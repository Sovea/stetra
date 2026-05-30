import { parseYaml } from "../utils/yaml.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
//#region src/load/load-playbook.ts
/**
* Discovers built-in layer ids by scanning the plugin playbook directory.
*/
function discoverBuiltinLayers(builtinRoot) {
	const layers = /* @__PURE__ */ new Map();
	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.endsWith(".yaml")) continue;
			const rel = relative(builtinRoot, full).replace(/\\/g, "/");
			const parts = rel.split("/");
			let layerId = "builtin";
			if (rel === "core.yaml") layerId = "builtin/core";
			else if (parts.at(-1) === "core.yaml") layerId = `builtin/${parts.slice(0, -1).join("/")}`;
			else layerId = `builtin/${rel.replace(/\.yaml$/, "")}`;
			layers.set(layerId, full);
		}
	}
	walk(builtinRoot);
	return layers;
}
/**
* Expands local augment extends patterns against discovered built-in layers.
*/
function resolveExtendedLayers(extendsEntries, layers) {
	const selected = [];
	for (const entry of extendsEntries) {
		if (entry.startsWith("!")) {
			const target = entry.slice(1);
			const next = selected.filter((value) => value !== target);
			selected.length = 0;
			selected.push(...next);
			continue;
		}
		if (entry.endsWith("/*")) {
			const prefix = entry.slice(0, -1);
			for (const match of [...layers.keys()].filter((layerId) => layerId.startsWith(prefix)).sort()) if (!selected.includes(match)) selected.push(match);
			continue;
		}
		if (layers.has(entry) && !selected.includes(entry)) selected.push(entry);
	}
	return selected;
}
/**
* Loads directives for one built-in layer file.
*/
function loadDirectiveFile(filePath, layerId) {
	const parsed = parseYaml(readFileSync(filePath, "utf-8"));
	if (!Array.isArray(parsed)) throw new Error(`Directive file must contain a top-level array: ${filePath}`);
	return parsed.map((item) => normalizeDirective(item, layerId, filePath, "builtin"));
}
/**
* Loads the optional local playbook and normalizes all local sections.
*/
function loadLocalPlaybook(filePath) {
	if (!filePath || !existsSync(filePath)) return null;
	const parsed = parseYaml(readFileSync(filePath, "utf-8"));
	const meta = parsed.meta ?? {};
	return {
		version: String(parsed.version ?? "1.0"),
		meta: {
			name: typeof meta.name === "string" ? meta.name : void 0,
			extends: Array.isArray(meta.extends) ? meta.extends.map(String) : []
		},
		overrides: Array.isArray(parsed.overrides) ? parsed.overrides.map((item) => item) : [],
		augments: Array.isArray(parsed.augments) ? parsed.augments.map((item) => item) : [],
		suppresses: Array.isArray(parsed.suppresses) ? parsed.suppresses.map((item) => item) : [],
		additions: Array.isArray(parsed.additions) ? parsed.additions.map((item) => normalizeDirective(item, "local", filePath, "local-addition")) : []
	};
}
function normalizeDirective(input, layerId, filePath, kind) {
	return {
		id: String(input.id),
		type: String(input.type),
		layer: typeof input.layer === "string" ? input.layer : layerId,
		scope: normalizeScope(input.scope),
		prescription: String(input.prescription),
		weight: input.weight ?? "normal",
		description: String(input.description ?? ""),
		rationale: String(input.rationale ?? ""),
		exceptions: Array.isArray(input.exceptions) ? input.exceptions.map(String) : [],
		examples: normalizeExamples(input.examples),
		rccl_immune: Boolean(input.rccl_immune),
		traits: normalizeTraits(input.traits),
		source: {
			kind,
			layerId,
			filePath
		}
	};
}
function normalizeScope(input) {
	if (typeof input === "string") return { path: input };
	if (input && typeof input === "object" && typeof input.path === "string") return { path: String(input.path) };
	return { path: "**/*" };
}
function normalizeExamples(input) {
	if (!Array.isArray(input)) return [];
	return input.map((example) => {
		const item = example;
		return {
			avoid: item.avoid && typeof item.avoid === "object" ? { code: String(item.avoid.code ?? "") } : void 0,
			good: item.good && typeof item.good === "object" ? { code: String(item.good.code ?? "") } : void 0,
			note: String(item.note ?? "")
		};
	});
}
function normalizeTraits(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return void 0;
	const value = input;
	const traits = {
		safety_critical: booleanTrait(value.safety_critical),
		broad_scope: booleanTrait(value.broad_scope),
		compatibility_sensitive: booleanTrait(value.compatibility_sensitive),
		migration_sensitive: booleanTrait(value.migration_sensitive)
	};
	return Object.values(traits).some((item) => item !== void 0) ? traits : void 0;
}
function booleanTrait(input) {
	return typeof input === "boolean" ? input : void 0;
}
//#endregion
export { discoverBuiltinLayers, loadDirectiveFile, loadLocalPlaybook, resolveExtendedLayers };
