import "./types.mjs";
import { isRecord } from "./utils/common.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
		invalidates_on: ["selected built-in playbook layer content"],
		selected_layers: input.output.trace.activation.selected_layers
	});
	writeJson(paths.l2Path, {
		version: "1.0",
		kind: "runtime-cache-l2",
		key: input.output.cache.l2Key,
		l1Key: input.output.cache.l1Key,
		verificationPolicy: input.output.cache.verificationPolicy,
		rcclVerificationKey: input.output.cache.rcclVerificationKey,
		invalidates_on: [
			"runtime-cache-l1 key",
			"local augment content",
			"RCCL observation verification status and disposition",
			"task-time RCCL verification policy and summary"
		],
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
		verificationPolicy: input.output.cache.verificationPolicy,
		rcclVerificationKey: input.output.cache.rcclVerificationKey,
		invalidates_on: [
			"runtime-cache-l2 key",
			"resolved task input and context profile",
			"host semantic proposal fingerprint"
		],
		packet: input.output.packet
	});
	return paths;
}
function inspectCompileCache(input) {
	const paths = compileCachePaths(input.projectRoot, input.cache);
	const levels = {
		l1: inspectCacheLevel(paths.l1Path, (value) => isRecord(value) && value.version === "1.0" && value.kind === "runtime-cache-l1" && value.key === input.cache.l1Key, "runtime-cache-l1 key matched"),
		l2: inspectCacheLevel(paths.l2Path, (value) => isRecord(value) && value.version === "1.0" && value.kind === "runtime-cache-l2" && value.key === input.cache.l2Key && value.l1Key === input.cache.l1Key && value.verificationPolicy === input.cache.verificationPolicy && value.rcclVerificationKey === input.cache.rcclVerificationKey, "runtime-cache-l2 key, parent key, and RCCL verification fingerprint matched"),
		l3: inspectCacheLevel(paths.l3Path, (value) => isRecord(value) && value.version === "1.0" && value.kind === "runtime-cache-l3" && value.key === input.cache.l3Key && value.l1Key === input.cache.l1Key && value.l2Key === input.cache.l2Key && value.verificationPolicy === input.cache.verificationPolicy && value.rcclVerificationKey === input.cache.rcclVerificationKey && packetCacheMatches(value.packet, input.cache), "runtime-cache-l3 key chain, packet cache, and RCCL verification fingerprint matched")
	};
	const statuses = Object.values(levels).map((level) => level.status);
	return {
		status: statuses.every((value) => value === "hit") ? "hit" : statuses.some((value) => value === "rejected") ? "rejected" : statuses.some((value) => value === "hit") ? "partial" : "miss",
		trustBoundary: "cache-read-only",
		packetUsableForExecution: false,
		paths,
		levels,
		diagnostics: ["Cache inspection is read-only and never substitutes for Runtime compile or RCCL task-time verification.", ...Object.entries(levels).map(([level, result]) => `${level}: ${result.status} (${result.reason})`)]
	};
}
function compileCachePaths(projectRoot, cache) {
	const root = join(projectRoot, ".resonant-code", "context", "cache", "runtime");
	return {
		l1Path: join(root, "l1", `${cache.l1Key}.json`),
		l2Path: join(root, "l2", `${cache.l2Key}.json`),
		l3Path: join(root, "l3", `${cache.l3Key}.json`)
	};
}
function inspectCacheLevel(path, validate, hitReason) {
	if (!existsSync(path)) return {
		path,
		status: "miss",
		reason: "cache artifact is absent"
	};
	try {
		return validate(JSON.parse(readFileSync(path, "utf-8"))) ? {
			path,
			status: "hit",
			reason: hitReason
		} : {
			path,
			status: "rejected",
			reason: "cache artifact metadata did not match expected key chain"
		};
	} catch (error) {
		return {
			path,
			status: "rejected",
			reason: `cache artifact could not be parsed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}
function packetCacheMatches(packet, cache) {
	if (!isRecord(packet) || !isRecord(packet.cache)) return false;
	return packet.cache.l1Key === cache.l1Key && packet.cache.l2Key === cache.l2Key && packet.cache.l3Key === cache.l3Key && packet.cache.verificationPolicy === cache.verificationPolicy && packet.cache.rcclVerificationKey === cache.rcclVerificationKey;
}
function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
//#endregion
export { inspectCompileCache, persistCompileCache };
