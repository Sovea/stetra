import { discoverBuiltinLayers, loadDirectiveFile, loadLocalPlaybook, resolveExtendedLayers } from "./load-playbook.mjs";
import { loadRccl } from "./load-rccl.mjs";
import { verifyRcclDocumentWithSummary } from "../verify/verify-rccl.mjs";
//#region src/load/compile-sources.ts
async function loadCompileSources(input) {
	const builtinLayers = discoverBuiltinLayers(input.builtinRoot);
	const local = loadLocalPlaybook(input.localAugmentPath);
	const selectedLayerIds = local?.meta.extends.length ? resolveExtendedLayers(local.meta.extends, builtinLayers) : ["builtin/core"];
	const builtinDirectives = selectedLayerIds.flatMap((layerId) => {
		const filePath = builtinLayers.get(layerId);
		return filePath ? loadDirectiveFile(filePath, layerId) : [];
	});
	return verifyCompileSourcesRccl(input, {
		builtinLayers,
		local,
		selectedLayerIds,
		builtinDirectives,
		allDirectives: [...builtinDirectives, ...local?.additions ?? []],
		rccl: await loadRccl(input.rcclPath)
	});
}
async function loadOrVerifyCompileSources(input, preloadedSources) {
	return preloadedSources ? verifyCompileSourcesRccl(input, preloadedSources) : loadCompileSources(input);
}
async function verifyCompileSourcesRccl(input, sources) {
	if (!sources.rccl) return {
		...sources,
		rcclVerificationSummary: void 0
	};
	const verifiedRccl = await verifyRcclDocumentWithSummary(sources.rccl, {
		projectRoot: input.projectRoot,
		resolvedTask: input.resolvedTask,
		policy: input.verificationPolicy ?? "task-relevant"
	});
	return {
		...sources,
		rccl: verifiedRccl.document,
		rcclVerificationSummary: verifiedRccl.summary
	};
}
//#endregion
export { loadCompileSources, loadOrVerifyCompileSources, verifyCompileSourcesRccl };
