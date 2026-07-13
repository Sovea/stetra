import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareAgentCapabilityProfileContract, validateAgentCapabilityProfilePayload } from './ai-contracts/agent-capability-profile.ts';
import { prepareContextAcquisitionContract } from './ai-contracts/context-acquisition.ts';
import { prepareSemanticGovernanceGraphContractBundle } from './ai-contracts/semantic-governance-graph.ts';
import { prepareTaskModelContract } from './ai-contracts/task-model.ts';
import { validateTaskModelPayload } from './ai-contracts/task-model.ts';
import { buildContractPayloadDiagnostics } from './ai-contracts/diagnostics.ts';
import { unwrapHostArtifactEnvelope } from './ai-contracts/shared.ts';
import { resolveContractPolicy } from './contract-policy.ts';
import { resolveTask } from './interpret/normalize-candidate.ts';
import { loadRccl } from './load/load-rccl.ts';
import { unique, isRecord } from './utils/common.ts';
import { normalizePath, pathMatchesScope, scopeOverlapsPath, fileOverlapsTarget } from './utils/paths.ts';
import { parseYaml } from './utils/yaml.ts';
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
import type { ContractPayloadDiagnostics, TaskModelProposal } from './ai-contracts/types.ts';

export async function planGuidance(input: GuidancePlanInput): Promise<GuidancePlan> {
  const notes: string[] = [];
  const contractDiagnostics: ContractPayloadDiagnostics[] = [];
  const issuedCapabilityProfile = prepareAgentCapabilityProfileContract({
    task: input.task,
    artifactPath: input.artifactPaths.agentCapabilityProfile,
  });
  let agentCapabilityProfile = null;
  if (input.artifacts?.agentCapabilityProfile) {
    const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.agentCapabilityProfile.raw, issuedCapabilityProfile.contract);
    if (unwrapped.diagnostic) {
      contractDiagnostics.push(buildContractPayloadDiagnostics('agent-capability-profile', [unwrapped.diagnostic], {
        id: issuedCapabilityProfile.contract.requestId,
        path: input.artifacts.agentCapabilityProfile.path,
      }));
    } else {
      const validated = validateAgentCapabilityProfilePayload(unwrapped.payload);
      contractDiagnostics.push(validated.diagnostics);
      agentCapabilityProfile = validated.profile;
    }
  }
  const issuedTaskModel = prepareTaskModelContract({
    task: input.task,
    artifactPath: input.artifactPaths.taskModel,
  });
  let taskModels: TaskModelProposal[] = [];
  if (input.artifacts?.taskModel) {
    const unwrapped = unwrapHostArtifactEnvelope(input.artifacts.taskModel.raw, issuedTaskModel.contract);
    if (unwrapped.diagnostic) {
      contractDiagnostics.push(buildContractPayloadDiagnostics('task-model', [unwrapped.diagnostic], {
        id: issuedTaskModel.contract.requestId,
        path: input.artifacts.taskModel.path,
      }));
    } else {
      const validated = validateTaskModelPayload(unwrapped.payload);
      contractDiagnostics.push(validated.diagnostics);
      taskModels = validated.models;
    }
  }
  const sourceStatus = resolveSourceStatus(input, notes);
  const guidanceMode = input.mode ?? 'standard';
  const resolvedTask = resolveTask({
    task: input.task,
    taskModels,
    interpretationMode: taskModels.length ? 'host-agent' : 'deterministic-only',
  });
  const rcclRelevant = await resolveRcclRelevance(input, sourceStatus, resolvedTask, notes);
  const policy = resolveContractPolicy({
    sourceStatus,
    providedContracts: {
      ...input.providedContracts,
      agentCapability: Boolean(agentCapabilityProfile),
      taskModel: taskModels.length > 0,
      semanticGovernanceGraph: Boolean(input.artifacts?.semanticGovernanceGraph),
    },
    agentCapabilityProfile,
    task: input.task,
    resolvedTask,
    mode: guidanceMode,
    rcclRelevant,
  });
  const requiredContracts: RuntimeContractRequest[] = [];

  if (policy.required.includes('agent-capability-profile')) {
    requiredContracts.push({
      kind: 'agent-capability-profile',
      artifact: issuedCapabilityProfile.profileArtifact,
      contract: issuedCapabilityProfile.contract,
    });
    notes.push('Agent capability profile requested so Runtime can select agentic contracts from concrete host capabilities.');
  }

  if (policy.required.includes('task-model')) {
    requiredContracts.push({
      kind: 'task-model',
      artifact: issuedTaskModel.modelArtifact,
      contract: issuedTaskModel.contract,
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
      compileInput: guidancePlanCompileInput(input, taskModels),
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
    resolvedTask,
    contractDiagnostics,
  };
}

export function resolveSourceStatus(
  input: Pick<GuidancePlanInput, 'localAugmentPath' | 'rcclPath' | 'lockfilePath' | 'projectRoot'>,
  notes?: string[],
): GuidancePlanSourceStatus {
  return {
    localAugment: input.localAugmentPath && existsSync(input.localAugmentPath) ? 'present' : 'absent',
    rccl: resolveRcclSourceStatus(input.rcclPath, notes),
    lockfile: input.lockfilePath && existsSync(input.lockfilePath) ? 'present' : 'absent',
    cache: resolveCacheStatus(input.projectRoot),
  };
}

function resolveRcclSourceStatus(rcclPath: string | undefined, notes?: string[]): GuidancePlanSourceStatus['rccl'] {
  if (!rcclPath || !existsSync(rcclPath)) return 'absent';
  try {
    const parsed = parseYaml(readFileSync(rcclPath, 'utf-8'));
    if (!isRecord(parsed) || !Array.isArray(parsed.observations)) return 'unverified';
    if (parsed.version !== '1.0' && parsed.version !== 1) {
      notes?.push('UNSUPPORTED_SCHEMA_VERSION: RCCL must use schema 1; re-run calibrate-repo-context.');
      return 'unverified';
    }
    if (parsed.observations.length === 0) return 'present';
    const observations = parsed.observations.filter(isRecord);
    if (observations.length !== parsed.observations.length) return 'unverified';
    const hasUnverified = observations.some((observation) => {
      const verification = isRecord(observation.verification) ? observation.verification : null;
      if (!verification) return true;
      return !hasVerificationValue(verification, 'evidence_status')
        || !hasVerificationValue(verification, 'evidence_verified_count')
        || !hasVerificationValue(verification, 'evidence_confidence')
        || !hasVerificationValue(verification, 'induction_status')
        || !hasVerificationValue(verification, 'induction_confidence')
        || !hasVerificationValue(verification, 'checked_at')
        || !hasVerificationValue(verification, 'disposition');
    });
    if (hasUnverified) return 'unverified';
    const hasStaleLifecycle = observations.some((observation) => {
      const lifecycle = isRecord(observation.lifecycle) ? observation.lifecycle : null;
      return lifecycle?.status === 'stale' || lifecycle?.status === 'superseded';
    });
    return hasStaleLifecycle ? 'stale' : 'present';
  } catch (error) {
    notes?.push(`RCCL status check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'unverified';
  }
}

function resolveCacheStatus(projectRoot: string): GuidancePlanSourceStatus['cache'] {
  const cacheRoot = join(projectRoot, '.resonant-code', 'context', 'cache', 'runtime');
  if (!existsSync(cacheRoot)) return 'miss';
  const populatedLevels = ['l1', 'l2', 'l3'].filter((level) => hasFiles(join(cacheRoot, level))).length;
  if (populatedLevels === 3) return 'hit';
  return populatedLevels > 0 ? 'partial' : 'miss';
}

function guidancePlanCompileInput(input: GuidancePlanInput, taskModels: TaskModelProposal[]): CompileInput {
  return {
    builtinRoot: input.builtinRoot,
    localAugmentPath: input.localAugmentPath,
    rcclPath: input.rcclPath,
    projectRoot: input.projectRoot,
    lockfilePath: input.lockfilePath,
    verificationPolicy: input.verificationPolicy,
    task: input.task,
    taskModels,
  };
}

function defaultSemanticGovernanceGraphPath(projectRoot: string): string {
  return join(projectRoot, '.resonant-code', 'context', 'semantic-governance-graphs', 'semantic-governance-graph.json');
}

async function resolveRcclRelevance(
  input: GuidancePlanInput,
  sourceStatus: GuidancePlanSourceStatus,
  resolvedTask: ResolvedTaskOutput,
  notes?: string[],
): Promise<boolean | undefined> {
  if (sourceStatus.rccl === 'absent' || !input.rcclPath) return undefined;
  const targets = taskTargets(input.task, resolvedTask);
  if (targets.length === 0) return undefined;
  let rccl: RcclDocument | null = null;
  try {
    rccl = await loadRccl(input.rcclPath);
  } catch (error) {
    notes?.push(`RCCL relevance check failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (!rccl) return undefined;
  return rccl.observations.some((observation) =>
    targets.some((target) =>
      scopeOverlapsPath(observation.scope, target)
      || observation.evidence.some((evidence) => fileOverlapsTarget(evidence.file, target))));
}

function taskTargets(task: CompileTaskInput, resolvedTask: ResolvedTaskOutput): string[] {
  return unique([
    task.targetFile,
    ...(task.changedFiles ?? []),
    resolvedTask.task_intent.target_file,
    ...resolvedTask.task_intent.changed_files,
  ].filter((value): value is string => Boolean(value)).map(normalizePath));
}

function hasFiles(directory: string): boolean {
  try {
    return readdirSync(directory).some((entry) => entry.endsWith('.json'));
  } catch (_error) {
    return false;
  }
}

function hasVerificationValue(record: Record<string, unknown>, key: string): boolean {
  return record[key] !== undefined && record[key] !== null && record[key] !== '';
}
