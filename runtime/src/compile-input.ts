import { resolveTask } from './interpret/normalize-candidate.ts';
import { resolveActivationDecisionsIR, activatedDirectiveIdsIR } from './ir/activation/resolve-activation.ts';
import { buildGovernanceIR } from './ir/build-ir.ts';
import type { ActivationDecisionIR, DirectiveIR, GovernanceIRBundle } from './ir/types.ts';
import { loadOrVerifyCompileSources, type CompileSources } from './load/compile-sources.ts';
import type { CompileInput, ResolvedCompileInput, ResolvedTaskOutput } from './types.ts';

export interface ActivatedGovernanceContext {
  normalizedInput: ResolvedCompileInput;
  resolvedTask: ResolvedTaskOutput;
  sources: CompileSources;
  governanceIR: GovernanceIRBundle;
  activationDecisions: ActivationDecisionIR[];
  activatedDirectiveIds: Set<string>;
  activeDirectives: DirectiveIR[];
}

export function hasResolvedTask(input: CompileInput): input is ResolvedCompileInput {
  return 'resolvedTask' in input;
}

export function resolveCompileTask(input: CompileInput): ResolvedTaskOutput {
  if (hasResolvedTask(input)) return input.resolvedTask;
  return resolveTask({
    task: input.task,
    taskModels: input.taskModels ?? [],
    interpretationMode: input.interpretationMode,
  });
}

export function toResolvedCompileInput(input: CompileInput): ResolvedCompileInput {
  if (hasResolvedTask(input)) return input;
  const { task: _task, taskModels: _taskModels, interpretationMode: _interpretationMode, ...base } = input;
  return {
    ...base,
    resolvedTask: resolveCompileTask(input),
  };
}

export async function resolveActivatedGovernanceContext(input: CompileInput): Promise<ActivatedGovernanceContext> {
  const normalizedInput = toResolvedCompileInput(input);
  const resolvedTask = normalizedInput.resolvedTask;
  const sources = await loadOrVerifyCompileSources(normalizedInput, normalizedInput.preloadedSources);
  const governanceIR = await buildGovernanceIR(normalizedInput, sources);
  const activationDecisions = resolveActivationDecisionsIR(governanceIR);
  const activatedDirectiveIds = activatedDirectiveIdsIR(activationDecisions);
  const activeDirectives = governanceIR.directives.filter((directive) => activatedDirectiveIds.has(directive.id));
  return { normalizedInput, resolvedTask, sources, governanceIR, activationDecisions, activatedDirectiveIds, activeDirectives };
}
