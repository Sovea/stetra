import { resolveTask } from "./interpret/normalize-candidate.mjs";
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
//#endregion
export { hasResolvedTask, resolveCompileTask, toResolvedCompileInput };
