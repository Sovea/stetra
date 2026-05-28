import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
//#region src/cache.ts
function persistCompileCache(input) {
	const root = join(input.projectRoot, ".resonant-code", "context", "cache", "runtime");
	const paths = {
		l1Path: join(root, "l1", `${input.output.cache.l1Key}.json`),
		l2Path: join(root, "l2", `${input.output.cache.l2Key}.json`),
		l3Path: join(root, "l3", `${input.output.cache.l3Key}.json`)
	};
	writeJson(paths.l1Path, {
		version: "1.0",
		kind: "runtime-cache-l1",
		key: input.output.cache.l1Key,
		selected_layers: input.output.trace.activation.selected_layers
	});
	writeJson(paths.l2Path, {
		version: "1.0",
		kind: "runtime-cache-l2",
		key: input.output.cache.l2Key,
		l1Key: input.output.cache.l1Key,
		activated_directives: input.output.trace.activated_directives,
		suppressed_directives: input.output.trace.suppressed_directives,
		observation_links: input.output.trace.observation_links
	});
	writeJson(paths.l3Path, {
		version: "1.0",
		kind: "runtime-cache-l3",
		key: input.output.cache.l3Key,
		l1Key: input.output.cache.l1Key,
		l2Key: input.output.cache.l2Key,
		packet: input.output.packet
	});
	return paths;
}
function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
//#endregion
export { persistCompileCache };
