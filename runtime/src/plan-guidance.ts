import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareGuidancePlanningContract } from './ai-contracts/guidance-planning.ts';
import { prepareTaskInterpretationContract } from './ai-contracts/task-interpretation.ts';
import type {
  GuidancePlan,
  GuidancePlanInput,
  GuidancePlanSourceStatus,
  RuntimeContractRequest,
} from './types.ts';
import type { GuidancePlanningContractName } from './ai-contracts/types.ts';

export function planGuidance(input: GuidancePlanInput): GuidancePlan {
  const provided = input.providedContracts ?? {};
  const sourceStatus = resolveSourceStatus(input);
  const requiredContracts: RuntimeContractRequest[] = [];
  const recommendedContracts = input.planningProposal?.useful_contracts ?? [];
  const notes: string[] = [];

  if (!provided.guidancePlanning && !input.planningProposal) {
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

  if (!provided.taskInterpretation) {
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

  if (input.planningProposal) {
    if (shouldRequireSemantic('semantic-candidate', recommendedContracts, sourceStatus, provided.semanticCandidate)) {
      notes.push('Semantic candidate contract recommended by accepted host planning proposal.');
    }
    if (shouldRequireSemantic('semantic-relation', recommendedContracts, sourceStatus, provided.semanticRelation)) {
      notes.push('Semantic relation contract recommended by accepted host planning proposal.');
    }
    if (recommendedContracts.includes('adherence-evaluation')) {
      notes.push('Adherence evaluation was recommended for post-change feedback; Runtime can issue that contract after compile.');
    }
  }

  return {
    mode: requiredContracts.length ? 'contracts-required' : 'ready',
    requiredContracts,
    recommendedContracts,
    sourceStatus,
    outputPolicy: {
      stdout: 'compact',
      trace: 'session-only',
    },
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

function shouldRequireSemantic(
  contract: Extract<GuidancePlanningContractName, 'semantic-candidate' | 'semantic-relation'>,
  recommendedContracts: GuidancePlanningContractName[],
  sourceStatus: GuidancePlanSourceStatus,
  provided?: boolean,
): boolean {
  return recommendedContracts.includes(contract) && sourceStatus.rccl === 'present' && !provided;
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
