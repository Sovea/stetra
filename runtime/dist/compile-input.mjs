import { resolveTask } from "./interpret/normalize-candidate.mjs";
import { activatedDirectiveIdsIR, resolveActivationDecisionsIR } from "./ir/activation/resolve-activation.mjs";
import { loadOrVerifyCompileSources } from "./load/compile-sources.mjs";
import { buildGovernanceIR } from "./ir/build-ir.mjs";
//#region src/compile-input.ts
function hasResolvedTask(input) {
	return "resolvedTask" in input;
}
function resolveCompileTask(input) {
	if (hasResolvedTask(input)) return input.resolvedTask;
	return resolveTask({
		task: input.task,
		taskModels: input.taskModels ?? [],
		interpretationMode: input.interpretationMode
	});
}
function toResolvedCompileInput(input) {
	if (hasResolvedTask(input)) return input;
	const { task: _task, taskModels: _taskModels, interpretationMode: _interpretationMode, ...base } = input;
	return {
		...base,
		resolvedTask: resolveCompileTask(input)
	};
}
async function resolveActivatedGovernanceContext(input) {
	const normalizedInput = toResolvedCompileInput(input);
	const resolvedTask = normalizedInput.resolvedTask;
	const sources = await loadOrVerifyCompileSources(normalizedInput, normalizedInput.preloadedSources);
	const governanceIR = await buildGovernanceIR(normalizedInput, sources);
	const activationDecisions = resolveActivationDecisionsIR(governanceIR);
	const activatedDirectiveIds = activatedDirectiveIdsIR(activationDecisions);
	return {
		normalizedInput,
		resolvedTask,
		sources,
		governanceIR,
		activationDecisions,
		activatedDirectiveIds,
		activeDirectives: governanceIR.directives.filter((directive) => activatedDirectiveIds.has(directive.id))
	};
}
//#endregion
export { hasResolvedTask, resolveActivatedGovernanceContext, resolveCompileTask, toResolvedCompileInput };
