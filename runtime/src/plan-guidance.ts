import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareAgentCapabilityProfileContract } from './ai-contracts/agent-capability-profile.ts';
import { prepareContextAcquisitionContract } from './ai-contracts/context-acquisition.ts';
import { prepareSemanticGovernanceGraphContractBundle } from './ai-contracts/semantic-governance-graph.ts';
import { prepareTaskModelContract } from './ai-contracts/task-model.ts';
import { resolveContractPolicy } from './contract-policy.ts';
import { resolveTask } from './interpret/normalize-candidate.ts';
import { loadRccl } from './load/load-rccl.ts';
import { minimatch } from './utils/glob.ts';
import type {
  CompileInput,
  CompileTaskInput,
  GuidancePlan,
  GuidancePlanInput,
  GuidancePlanSourceStatus,
  RcclDocument,
  ResolvedTaskOutput,
  RuntimeContractRequest,
} from './types.ts';

export async function planGuidance(input: GuidancePlanInput): Promise<GuidancePlan> {
  const sourceStatus = resolveSourceStatus(input);
  const guidanceMode = input.mode ?? 'standard';
  const resolvedTask = resolveTask({
    task: input.task,
    taskModels: input.taskModels ?? [],
    interpretationMode: input.taskModels?.length ? 'host-agent' : 'deterministic-only',
  });
  const rcclRelevant = await resolveRcclRelevance(input, sourceStatus, resolvedTask);
  const policy = resolveContractPolicy({
    sourceStatus,
    providedContracts: input.providedContracts,
    agentCapabilityProfile: input.agentCapabilityProfile,
    task: input.task,
    resolvedTask,
    mode: guidanceMode,
    rcclRelevant,
  });
  const requiredContracts: RuntimeContractRequest[] = [];
  const notes: string[] = [];

  if (policy.required.includes('agent-capability-profile')) {
    const profile = prepareAgentCapabilityProfileContract({
      task: input.task,
      artifactPath: input.artifactPaths.agentCapabilityProfile,
    });
    requiredContracts.push({
      kind: 'agent-capability-profile',
      artifact: profile.profileArtifact,
      contract: profile.contract,
    });
    notes.push('Agent capability profile requested so Runtime can select agentic contracts from concrete host capabilities.');
  }

  if (policy.required.includes('task-model')) {
    const taskModel = prepareTaskModelContract({
      task: input.task,
      artifactPath: input.artifactPaths.taskModel,
    });
    requiredContracts.push({
      kind: 'task-model',
      artifact: taskModel.modelArtifact,
      contract: taskModel.contract,
    });
    notes.push('Task model contract requested; deterministic interpretation is fallback only.');
  }

  if (policy.required.includes('context-acquisition')) {
    const acquisition = prepareContextAcquisitionContract({
      task: input.task,
      artifactPath: input.artifactPaths.contextAcquisition ?? input.artifactPaths.taskModel,
    });
    requiredContracts.push({
      kind: 'context-acquisition',
      artifact: acquisition.acquisitionArtifact,
      contract: acquisition.contract,
    });
    notes.push('Context acquisition is required because task risk is high and RCCL is absent.');
  }

  if (policy.required.includes('semantic-governance-graph')) {
    const graph = await prepareSemanticGovernanceGraphContractBundle({
      compileInput: guidancePlanCompileInput(input),
      artifactPath: input.artifactPaths.semanticGovernanceGraph ?? defaultSemanticGovernanceGraphPath(input.projectRoot),
    });
    requiredContracts.push({
      kind: 'semantic-governance-graph',
      artifact: graph.graphArtifact,
      contract: graph.contract,
      context: {
        resolvedTask: graph.resolvedTask,
        directives: graph.directives,
        observations: graph.observations,
      },
    });
    notes.push('Semantic governance graph is required because RCCL is available and host semantic evidence should drive merge relations.');
  }
  if (policy.required.includes('adherence-evidence')) {
    notes.push('Adherence evidence is required by strict mode after implementation; it is prepared after guidance compilation.');
  }
  if (policy.optional.includes('context-acquisition')) {
    notes.push('RCCL is absent; context acquisition or repository calibration is recommended before semantic graph compilation.');
  }
  if (policy.optional.includes('adherence-evidence')) {
    notes.push('Adherence evidence is optional in this mode; use prepare-adherence and complete when you want directive follow-rate updates.');
  }
  if (policy.optional.includes('governance-evolution-proposal')) {
    notes.push('Governance evolution proposal is available from lockfile signals, but it is review-only and never writes automatically.');
  }
  notes.push(...policy.diagnostics.reasons);

  return {
    mode: requiredContracts.length ? 'contracts-required' : 'ready',
    guidanceMode,
    requiredContracts,
    recommendedContracts: unique([
      ...policy.required,
      ...policy.optional,
    ]),
    sourceStatus,
    outputPolicy: {
      stdout: 'compact',
      trace: 'session-only',
    },
    policy,
    diagnostics: {
      policy: requiredContracts.length ? 'contracts-required' : 'ready',
      notes,
    },
  };
}

export function resolveSourceStatus(input: Pick<GuidancePlanInput, 'localAugmentPath' | 'rcclPath' | 'lockfilePath' | 'projectRoot'>): GuidancePlanSourceStatus {
  return {
    localAugment: input.localAugmentPath && existsSync(input.localAugmentPath) ? 'present' : 'absent',
    rccl: input.rcclPath && existsSync(input.rcclPath) ? 'present' : 'absent',
    lockfile: input.lockfilePath && existsSync(input.lockfilePath) ? 'present' : 'absent',
    cache: resolveCacheStatus(input.projectRoot),
  };
}

function resolveCacheStatus(projectRoot: string): GuidancePlanSourceStatus['cache'] {
  const cacheRoot = join(projectRoot, '.resonant-code', 'context', 'cache', 'runtime');
  if (!existsSync(cacheRoot)) return 'miss';
  const populatedLevels = ['l1', 'l2', 'l3'].filter((level) => hasFiles(join(cacheRoot, level))).length;
  if (populatedLevels === 3) return 'hit';
  return populatedLevels > 0 ? 'partial' : 'miss';
}

function guidancePlanCompileInput(input: GuidancePlanInput): CompileInput {
  return {
    builtinRoot: input.builtinRoot,
    localAugmentPath: input.localAugmentPath,
    rcclPath: input.rcclPath,
    projectRoot: input.projectRoot,
    lockfilePath: input.lockfilePath,
    hostProposals: input.hostProposals,
    hostFulfillment: input.hostFulfillment,
    agentCapabilityProfile: input.agentCapabilityProfile,
    preloadedSources: input.preloadedSources,
    task: input.task,
    taskModels: input.taskModels,
  };
}

function defaultSemanticGovernanceGraphPath(projectRoot: string): string {
  return join(projectRoot, '.resonant-code', 'context', 'semantic-governance-graphs', 'semantic-governance-graph.json');
}

async function resolveRcclRelevance(
  input: GuidancePlanInput,
  sourceStatus: GuidancePlanSourceStatus,
  resolvedTask: ResolvedTaskOutput,
): Promise<boolean | undefined> {
  if (sourceStatus.rccl === 'absent' || !input.rcclPath) return undefined;
  const targets = taskTargets(input.task, resolvedTask);
  if (targets.length === 0) return undefined;
  let rccl: RcclDocument | null = null;
  try {
    rccl = await loadRccl(input.rcclPath);
  } catch {
    return undefined;
  }
  if (!rccl) return undefined;
  return rccl.observations.some((observation) =>
    targets.some((target) =>
      pathMatchesScope(target, observation.scope)
      || observation.evidence.some((evidence) => evidence.file === target)));
}

function taskTargets(task: CompileTaskInput, resolvedTask: ResolvedTaskOutput): string[] {
  return unique([
    task.targetFile,
    ...(task.changedFiles ?? []),
    resolvedTask.task_intent.target_file,
    ...resolvedTask.task_intent.changed_files,
  ].filter((value): value is string => Boolean(value)));
}

function pathMatchesScope(path: string, scope: string): boolean {
  if (scope === '*' || scope === '**' || scope === '**/*') return true;
  if (scope.includes('*') || scope.includes('?') || scope.includes('{')) return minimatch(path, scope);
  return path === scope || path.startsWith(`${scope.replace(/\/$/, '')}/`);
}

function hasFiles(directory: string): boolean {
  try {
    return readdirSync(directory).some((entry) => entry.endsWith('.json'));
  } catch {
    return false;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
