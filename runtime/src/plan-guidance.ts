import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGuidancePlanningContract } from './ai-contracts/guidance-planning.ts';
import { prepareTaskInterpretationContract } from './ai-contracts/task-interpretation.ts';
import { resolveContractPolicy } from './contract-policy.ts';
import type {
  GuidancePlan,
  GuidancePlanInput,
  GuidancePlanSourceStatus,
  RuntimeContractRequest,
} from './types.ts';

export function planGuidance(input: GuidancePlanInput): GuidancePlan {
  const provided = input.providedContracts ?? {};
  const sourceStatus = resolveSourceStatus(input);
  const policy = resolveContractPolicy({
    sourceStatus,
    planningProposal: input.planningProposal,
    providedContracts: input.providedContracts,
  });
  const requiredContracts: RuntimeContractRequest[] = [];
  const recommendedContracts = input.planningProposal?.useful_contracts ?? [];
  const notes: string[] = [];

  if (policy.required.includes('guidance-planning')) {
    const planning = prepareGuidancePlanningContract({
      task: input.task,
      artifactPath: input.artifactPaths.guidancePlanning,
      sourceStatus: {
        localAugment: sourceStatus.localAugment,
        rccl: sourceStatus.rccl,
        lockfile: sourceStatus.lockfile,
      },
    });
    requiredContracts.push({
      kind: 'guidance-planning',
      artifact: planning.planningArtifact,
      contract: planning.contract,
    });
    notes.push('Guidance planning contract requested so host-agent semantic judgment can decide which optional contracts are worth fulfilling.');
  }

  if (policy.required.includes('task-interpretation')) {
    const interpretation = prepareTaskInterpretationContract({
      task: input.task,
      candidatePath: input.artifactPaths.taskInterpretation,
    });
    requiredContracts.push({
      kind: 'task-interpretation',
      artifact: interpretation.candidateArtifact,
      contract: interpretation.contract,
    });
    notes.push('Task interpretation contract requested; deterministic task parsing is fallback context, not the primary semantic signal.');
  }

  if (policy.required.includes('semantic-candidate')) notes.push('Semantic candidate contract required by Runtime contract policy from accepted host planning proposal.');
  if (policy.required.includes('semantic-relation')) notes.push('Semantic relation contract required by Runtime contract policy from accepted host planning proposal.');
  if (policy.required.includes('adherence-evaluation')) notes.push('Adherence evaluation required by Runtime contract policy after compile.');
  if (policy.optional.includes('adherence-evaluation')) notes.push('Adherence evaluation is optional and deferred until after compile.');

  return {
    mode: requiredContracts.length ? 'contracts-required' : 'ready',
    requiredContracts,
    recommendedContracts,
    sourceStatus,
    outputPolicy: {
      stdout: 'compact',
      trace: 'session-only',
    },
    policy,
    diagnostics: {
      planning: input.planningProposal ? 'accepted' : provided.guidancePlanning ? 'unused' : 'absent',
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

function hasFiles(directory: string): boolean {
  try {
    return readdirSync(directory).some((entry) => entry.endsWith('.json'));
  } catch {
    return false;
  }
}
