import { resolveCompileTask } from "../compile-input.mjs";
import { loadOrVerifyCompileSources } from "../load/compile-sources.mjs";
import { feedbackToIR } from "./adapters/feedback.mjs";
import { directivesToIR } from "./adapters/playbook.mjs";
import { observationsToIR } from "./adapters/rccl.mjs";
import { stableHash } from "../utils/hash.mjs";
import { taskToIR } from "./adapters/task.mjs";
import { buildIRFingerprints } from "./fingerprint.mjs";
//#region src/ir/build-ir.ts
async function buildGovernanceIR(input, sources) {
	const resolvedTask = resolveCompileTask(input);
	const loadedSources = sources?.rcclVerificationSummary ? sources : await loadOrVerifyCompileSources({
		...input,
		resolvedTask
	}, sources);
	const bundleWithoutFingerprints = {
		irVersion: "governance-ir/v1",
		task: taskToIR(resolvedTask),
		directives: directivesToIR(loadedSources.allDirectives, loadedSources.local),
		observations: observationsToIR(loadedSources.rccl?.observations ?? [], input.rcclPath),
		feedback: feedbackToIR(input.lockfilePath),
		hostProposals: input.hostProposals ?? [],
		sourceManifest: {
			builtinRoot: input.builtinRoot,
			selectedLayers: loadedSources.selectedLayerIds,
			localAugmentPath: input.localAugmentPath,
			rcclPath: input.rcclPath,
			lockfilePath: input.lockfilePath,
			projectRoot: input.projectRoot,
			sources: [
				{
					kind: "builtin-playbook",
					id: "builtin-root",
					path: input.builtinRoot,
					fingerprint: stableHash(loadedSources.selectedLayerIds)
				},
				...input.localAugmentPath ? [{
					kind: "local-playbook",
					id: "local-augment",
					path: input.localAugmentPath
				}] : [],
				...loadedSources.rccl ? [{
					kind: "rccl",
					id: loadedSources.rccl.git_ref ?? "rccl",
					path: input.rcclPath,
					version: loadedSources.rccl.version,
					fingerprint: stableHash(loadedSources.rccl.observations.map((observation) => observation.lifecycle?.content_fingerprint ?? observation.id))
				}] : [],
				...input.lockfilePath ? [{
					kind: "lockfile",
					id: "playbook.lock",
					path: input.lockfilePath
				}] : [],
				...(input.hostProposals ?? []).map((proposal) => ({
					kind: "host-proposal",
					id: proposal.source.id,
					path: proposal.source.path,
					fingerprint: stableHash([
						proposal.kind,
						proposal.source.id,
						proposal.payload
					])
				}))
			]
		}
	};
	return {
		...bundleWithoutFingerprints,
		fingerprints: buildIRFingerprints(bundleWithoutFingerprints)
	};
}
//#endregion
export { buildGovernanceIR };
