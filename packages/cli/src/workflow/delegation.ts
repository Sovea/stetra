/** CLI-owned orchestration for the task-scoped Cognitive Adoption protocol. */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import {
  compileDelegation,
  evaluateHandoff,
  type CheckFact,
  type CheckBaselineRelation,
  type CognitiveHandoff,
  type CompileDelegationInput,
  type DecisionPacket,
  type FactBundle,
  type BaselineVerificationFact,
  type EvidenceDisposition,
  type HandoffEvaluation,
  type HandoffValidationIssue,
  type HumanDecision,
  type HumanResolution,
  type TaskContract,
  type VerificationDefinition,
  type VerificationRevisionInput,
  type VerifierRef,
  type VerifierMutation,
} from '@sovea/stetra-core';

import {
  attachProtocolInputCorrection,
  attachProtocolInputRetry,
  inputError,
  usageError,
} from '../errors.ts';
import {
  runFrozenChecks,
} from '../facts/checks.ts';
import { collectExecutionEnvironment } from '../facts/environment.ts';
import { materializeEvidenceWindows } from '../facts/evidence.ts';
import {
  captureVerificationInputs,
  verificationInputSetFingerprint,
} from '../facts/execution-inputs.ts';
import {
  assertWorktreeSnapshot,
  captureGitWorktree,
  collectGitWorktreeChange,
  compareGitWorktrees,
  summarizeWorktree,
  type WorktreeSnapshot,
} from '../facts/worktree.ts';
import { resolveExecutable } from '../infrastructure/executable.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
  taskIdForPrepareRequest,
} from '../protocol.ts';
import {
  HumanDecisionDocumentSchema,
  HumanResolutionDocumentSchema,
  EvidenceDispositionDocumentSchema,
  type CognitiveHandoffDocument,
  type DelegationPrepareDocument,
  type EvidenceDispositionDocument,
  type HumanDecisionDocument,
  type HumanResolutionDocument,
  type VerificationRevisionDocument,
  type DerivedTaskState,
  type TaskProjection,
} from '../schemas/delegation.ts';
import {
  PrepareAuthoringDocumentSchema,
  VerificationRevisionAuthoringDocumentSchema,
} from '../schemas/authoring.ts';
import {
  hostEnvironmentDisclosure,
} from '../runtime-context.ts';
import {
  claimOwnedInput,
  reissueOwnedInput,
  reserveOwnedInput,
  type OwnedInputClaim,
  type OwnedInputReservation,
} from '../host/owned-input.ts';
import { parseArtifact } from '../validation.ts';
import {
  collectedHostAction,
  compileProblemHostAction,
  handoffHostAction,
  preparedHostAction,
  diagnosisHostAction,
  resolutionHostAction,
  staleFactsHostAction,
  unavailableVerificationHostAction,
  type FinalResponseGuard,
  type HostAction,
  hostActionAuthoringPacket,
} from './host-action.ts';
import {
  authoringGuide,
  decisionAuthoringPacket,
  diagnosisAuthoringPacket,
  handoffAuthoringPacket,
  handoffAuthoringDocumentSchema,
  handoffDocumentSchema,
  resolutionAuthoringPacket,
  verificationRevisionAuthoringPacket,
  type AuthoringPacket,
} from './authoring.ts';
import {
  compilePrepareAuthoring,
  compileHandoffAuthoring,
  compileVerificationRevisionAuthoring,
  type HandoffAuthoringSource,
} from './authoring-compiler.ts';
import { buildDeveloperDecisionBrief } from './decision-brief.ts';
import {
  boundedExplainView,
  explainSelectorCommand,
  MAX_LOG_EXPLAIN_BYTES,
  readBoundedCheckLog,
  summarizeAttempt,
  summarizeBaselineVerification,
  summarizeCheckAttempt,
  summarizeContract,
} from './explain-view.ts';
import {
  canonicalProjectRoot,
  commitStagedTaskTransition,
  createCollectionStagingDirectory,
  createTaskWorkspace,
  findTaskByPrepareRequestId,
  initializeTask,
  loadTask,
  projectRelativePath,
  readJsonArtifact,
  taskArtifactPath,
  transitionTask,
  withWorktreeLease,
  writeImmutableBuffer,
  writeImmutableJson,
  type LoadedTask,
} from './task-store.ts';

const WORKTREE_OBJECTS_DIRECTORY = 'worktree-objects';

export interface CheckTimeoutRetry {
  checkId: string;
  timeoutMs: number;
}

export async function prepareDelegationTask(options: {
  projectRoot: string;
  prepareRequestId: string;
  inputPath: string;
  input?: Readable;
  productVersion: string;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  let prepareInputClaim: OwnedInputClaim | undefined;
  const authored = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: PrepareAuthoringDocumentSchema,
    label: 'Prepare semantic input',
    retryCommand: {
      argv: [
        'stetra', 'change', 'prepare', '.',
        '--prepare-request', options.prepareRequestId,
        '--input', options.inputPath, '--json',
      ],
    },
    onOwnedClaim: (claim) => { prepareInputClaim = claim; },
  });
  let source: DelegationPrepareDocument;
  try {
    source = compilePrepareAuthoring({
      prepareRequestId: options.prepareRequestId,
      source: authored,
    });
  } catch (error) {
    if (prepareInputClaim) {
      const retry = reissuePrepareInput(
        projectRoot,
        prepareInputClaim,
        options.prepareRequestId,
        options.inputPath,
      ).retry;
      throw attachProtocolInputRetry(error, retry);
    }
    throw error;
  }
  const prepareInputFingerprint = stableFingerprint(source);
  const preparation = withWorktreeLease({ projectRoot, operation: 'prepare' }, async () => {
  const existingTask = findTaskByPrepareRequestId(projectRoot, source.prepareRequestId);
  if (existingTask) {
    if (existingTask.projection.prepareInputFingerprint !== prepareInputFingerprint) {
      throw inputError(
        `Prepare request ${source.prepareRequestId} is already bound to task ${existingTask.taskId} with different input. `
        + 'Reuse the original input for a retry or generate a new prepareRequestId for a distinct request.',
      );
    }
    return prepareReplayResult(existingTask);
  }
  const repositoryEvidence = materializeEvidenceWindows(
    projectRoot,
    source.repositoryEvidence ?? [],
  );
  const compileInput: CompileDelegationInput = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    developerEvents: source.developerEvents,
    task: source.task,
    materialDecisionForks: source.materialDecisionForks,
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
    assurance: source.assurance,
    hostPolicyRequirements: source.hostPolicyRequirements,
    executionBudget: source.executionBudget,
    ...(source.checks ? { checks: materializePrepareChecks(source.checks, source.assurance) } : {}),
    ...(source.noCommandRationale ? { noCommandRationale: source.noCommandRationale } : {}),
  };
  const compiled = compileDelegation(compileInput);
  if (compiled.status !== 'delegation-compiled') {
    return {
      ...compiled,
      taskCreated: false,
      hostAction: compileProblemHostAction(compiled.status, compiled.status === 'semantic-decision-required'
          ? {
            prepareRequestId: source.prepareRequestId,
            forks: compiled.forks,
          }
        : undefined),
    };
  }
  const unavailableExecutables = compiled.contract.verificationPlan.mode === 'checks'
    ? compiled.contract.verificationPlan.definitions.flatMap((check, index) =>
        verificationCommands(check).flatMap(({ path, argv }) => {
          const resolution = resolveExecutable(argv[0], projectRoot);
          return resolution.status === 'unavailable'
            ? [{ check, index, path, argv, reason: resolution.error.message }]
            : [];
        }))
    : [];
  if (unavailableExecutables.length) {
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'verification-required' as const,
      message: 'One or more frozen top-level check executables are unavailable; no task was created.',
      issues: unavailableExecutables.map(({ check, index, path, argv, reason }) => ({
        code: 'verification-executable-unavailable',
        path: `checks[${index}].execution.${path}.argv[0]`,
        message: `Check ${check.definitionId} cannot resolve ${JSON.stringify(argv[0])}: ${reason}`,
        remediation: 'Restore the executable or choose another explicit verification command.',
      })),
      taskCreated: false,
      hostAction: unavailableVerificationHostAction(),
    };
  }

  const taskId = taskIdForPrepareRequest(source.prepareRequestId);
  const unresolvedHostPolicies = compiled.contract.hostPolicyRequirements.filter((requirement) =>
    requirement.enforcementRequirement === 'required');
  let workspace: ReturnType<typeof createTaskWorkspace> | undefined;
  try {
    workspace = createTaskWorkspace(projectRoot, taskId);
    const preBaselineCheck = await captureGitWorktree(projectRoot, {
      objectDirectory: workspace.objectDirectory,
    });
    const definitions = compiled.contract.verificationPlan.mode === 'checks'
      ? compiled.contract.verificationPlan.definitions : [];
    const taskStartDefinitions = definitions.filter((definition) =>
      definition.baseline.mode === 'task-start');
    const preBaselineExecutionInputs = captureVerificationInputs(
      projectRoot,
      definitions,
    );
    const baselineObservations = await runFrozenChecks({
      projectRoot,
      executions: taskStartDefinitions.map((definition) => ({
        definition,
        timeoutMs: source.executionBudget.checkTimeoutMs,
      })),
      outputDirectory: join(workspace.taskDirectory, 'baseline-checks'),
      recordedOutputDirectory: join(workspace.finalTaskDirectory, 'baseline-checks'),
    });
    const baseline = await captureGitWorktree(projectRoot, {
      objectDirectory: workspace.objectDirectory,
    });
    const postBaselineExecutionInputs = captureVerificationInputs(
      projectRoot,
      definitions,
    );
    const baselineProjection = {
      preCheck: summarizeWorktree(preBaselineCheck),
      postCheck: summarizeWorktree(baseline),
      preCheckExecutionInputs: preBaselineExecutionInputs,
      postCheckExecutionInputs: postBaselineExecutionInputs,
      checkInducedChanges: compareGitWorktrees(preBaselineCheck, baseline),
      checks: definitions.map((definition) => ({
        definitionId: definition.definitionId,
        mode: definition.baseline.mode,
        observation: baselineObservations.find((item) =>
          item.definitionId === definition.definitionId) ?? null,
      })),
    };
    const baselineVerification: BaselineVerificationFact = {
      fingerprint: stableFingerprint(baselineProjection),
      ...baselineProjection,
    };
    const attempt = {
      attemptId: 'attempt:1',
      ordinal: 1,
      parentAttemptId: null,
      effectiveContractId: compiled.contract.effectiveContractId,
      trigger: 'initial' as const,
      evidenceDispositionIds: [],
    };
    const projection: TaskProjection = {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      taskId,
      prepareRequestId: source.prepareRequestId,
      prepareInputFingerprint,
      revision: 1,
      contractRevision: 1,
      packageIdentity: {
        cli: { name: '@sovea/stetra', version: options.productVersion },
        core: { name: '@sovea/stetra-core', version: options.productVersion },
      },
      semanticContractId: compiled.contract.semanticContractId,
      verificationPlanId: compiled.contract.verificationPlanId,
      effectiveContractId: compiled.contract.effectiveContractId,
      executionBudget: compiled.executionBudget!,
      timeoutRetryUsage: [],
      currentAttemptId: attempt.attemptId,
      attempts: [attempt],
      humanResolutionIds: [],
      verificationRevisionIds: [],
      ...(unresolvedHostPolicies.length ? {
        pendingResolution: {
          kind: 'host-policy' as const,
          targetIds: unresolvedHostPolicies.map((requirement) => requirement.id),
        },
      } : {}),
    };
    const loaded = initializeTask({
      projectRoot,
      taskId,
      stagingDirectory: workspace.taskDirectory,
      projection,
      artifacts: [
        { relativePath: contractPath(1), value: compiled.contract },
        { relativePath: baselinePath(1), value: baseline },
        { relativePath: baselineVerificationPath(1), value: baselineVerification },
        { relativePath: `${attemptDirectory(attempt.attemptId)}/attempt.json`, value: attempt },
      ],
    });
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'prepared' as const,
      taskId,
      task: compactTask(loaded),
      summary: preparedTaskSummary(compiled.contract, baseline, baselineVerification),
      details: {
        index: explainCommand(taskId, 'index'),
        recommended: [
          { section: 'contract' as const, ...explainCommand(taskId, 'contract') },
        ],
      },
      taskCreated: true,
      hostAction: unresolvedHostPolicies.length
        ? resolutionHostAction(taskId, resolutionAuthoringPacket({
            task: loaded.projection,
            contract: compiled.contract,
          }))
        : preparedHostAction(taskId),
    };
  } catch (error) {
    if (workspace) rmSync(workspace.taskDirectory, { recursive: true, force: true });
    const concurrentlyPublished = findTaskByPrepareRequestId(
      projectRoot,
      source.prepareRequestId,
    );
    if (concurrentlyPublished) {
      if (concurrentlyPublished.projection.prepareInputFingerprint !== prepareInputFingerprint) {
        throw inputError(
          `Prepare request ${source.prepareRequestId} was concurrently bound to task ${concurrentlyPublished.taskId} with different input.`,
        );
      }
      return prepareReplayResult(concurrentlyPublished);
    }
    throw error;
  }
  });
  let result: Awaited<typeof preparation>;
  try {
    result = await preparation;
  } catch (error) {
    if (prepareInputClaim && !findTaskByPrepareRequestId(projectRoot, source.prepareRequestId)) {
      const retry = reissuePrepareInput(
        projectRoot,
        prepareInputClaim,
        source.prepareRequestId,
        options.inputPath,
      ).retry;
      throw attachProtocolInputRetry(error, retry);
    }
    throw error;
  }
  if (result.status === 'prepared' || result.status === 'prepare-replayed' || !prepareInputClaim) {
    return result;
  }
  const continued = reissuePrepareInput(
    projectRoot,
    prepareInputClaim,
    source.prepareRequestId,
    options.inputPath,
  );
  result.hostAction.prepareContinuation = {
    prepareRequestId: source.prepareRequestId,
    taskId: taskIdForPrepareRequest(source.prepareRequestId),
    requiresNewHumanEvent: result.status === 'semantic-decision-required',
    input: continued.reservation,
    command: continued.retry.command,
  };
  return result;
}

export function resumeDelegationTask(options: {
  projectRoot: string;
  prepareRequestId: string;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const task = findTaskByPrepareRequestId(projectRoot, options.prepareRequestId);
  if (!task) {
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'prepare-not-created' as const,
      prepareRequestId: options.prepareRequestId,
      taskCreated: false,
      hostAction: null,
    };
  }
  return prepareReplayResult(task);
}

export async function collectDelegationFacts(options: {
  projectRoot: string;
  taskId: string;
  productVersion: string;
  timeoutMs?: number;
  retryChecks?: CheckTimeoutRetry[];
  refresh?: boolean;
}) {
  let collectedFacts: FactBundle | undefined;
  const collectionState: {
    mode: 'full-collection' | 'timeout-retry' | 'reused-current';
  } = { mode: 'full-collection' };
  let repeatedObservation = false;
  const retries = options.retryChecks ?? [];
  const transitioned = await withWorktreeLease({
    projectRoot: options.projectRoot,
    operation: 'collect',
    taskId: options.taskId,
  }, async () => {
    const task = loadTask(options.projectRoot, options.taskId);
    const expectedRevision = task.projection.revision;
    const contract = readContract(task);
    const definitions = contract.verificationPlan.mode === 'checks'
      ? contract.verificationPlan.definitions
      : [];
    validateCollectionOptions(definitions, retries, options.timeoutMs, options.refresh ?? false);
    const stagingDirectory = createCollectionStagingDirectory({
      projectRoot: task.projectRoot,
      taskId: task.taskId,
      revision: expectedRevision,
    });
    const stagedArtifactsDirectory = join(stagingDirectory, 'artifacts');
    const objectDirectory = join(stagingDirectory, 'objects');
    const durableObjectDirectory = taskArtifactPath(task.taskDirectory, WORKTREE_OBJECTS_DIRECTORY);
    try {
      assertTaskOpenForCollection(task);
      const currentContract = readContract(task);
      const baseline = readBaseline(task);
      const baselineVerification = readBaselineVerification(task);
      const currentAttempt = task.projection.attempts.find((attempt) =>
        attempt.attemptId === task.projection.currentAttemptId)!;
      const priorFacts = currentAttempt.factCollectionId
        ? readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId)
        : undefined;
      if (!retries.length && !options.refresh && priorFacts) {
        assertFactBundleIdentity(
          priorFacts,
          currentContract.effectiveContractId,
          currentAttempt.attemptId,
        );
        const current = await captureGitWorktree(task.projectRoot, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
        const currentExecutionInputs = captureVerificationInputs(
          task.projectRoot,
          definitions,
        );
        if (current.fingerprint === priorFacts.current.fingerprint
          && verificationInputSetFingerprint(currentExecutionInputs)
            === verificationInputSetFingerprint(priorFacts.currentExecutionInputs)) {
          collectionState.mode = 'reused-current';
          collectedFacts = priorFacts;
          const parentFacts = currentAttempt.parentAttemptId
            ? readAttemptFactsIfPresent(task, currentAttempt.parentAttemptId)
            : undefined;
          repeatedObservation = ['repair', 'correction'].includes(currentAttempt.trigger)
            && Boolean(parentFacts)
            && attemptOutcomeFingerprint(parentFacts!) === attemptOutcomeFingerprint(priorFacts);
          return task;
        }
      }
      const checksRelative =
        `${attemptDirectory(currentAttempt.attemptId)}/checks/collection-${task.projection.revision + 1}`;
      const checksDirectory = taskArtifactPath(
        stagedArtifactsDirectory,
        checksRelative,
      );
      const publishedChecksDirectory = taskArtifactPath(
        task.taskDirectory,
        checksRelative,
      );
      let factsBase: Omit<FactBundle, 'factCollectionId'>;
      let newArtifactRefs: string[] = [];
      let retriedVerifierIds: string[] = [];

      if (retries.length) {
        collectionState.mode = 'timeout-retry';
        if (!priorFacts) {
          throw usageError('Timeout retry requires facts from the current Attempt.');
        }
        assertFactBundleIdentity(priorFacts, currentContract.effectiveContractId, currentAttempt.attemptId);
        const beforeRetry = await captureGitWorktree(task.projectRoot, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
        if (beforeRetry.fingerprint !== priorFacts.current.fingerprint) {
          throw usageError('The worktree changed after collection; run a full collect instead of retrying one check.');
        }
        const beforeRetryExecutionInputs = captureVerificationInputs(
          task.projectRoot,
          definitions,
        );
        if (verificationInputSetFingerprint(beforeRetryExecutionInputs)
          !== verificationInputSetFingerprint(priorFacts.currentExecutionInputs)) {
          throw usageError('A declared verification execution input changed after collection; run a full collect instead of retrying one check.');
        }
        const retryPlan = validateTimeoutRetries(
          retries,
          definitions,
          priorFacts.checks,
          task,
        );
        retriedVerifierIds = retryPlan.map((item) => item.definition.verifierId);
        const retried = await runFrozenChecks({
          projectRoot: task.projectRoot,
          executions: retryPlan.map(({ definition, timeoutMs, previous }) => ({
            definition,
            timeoutMs,
            previousAttempts: previous.attempts,
          })),
          outputDirectory: checksDirectory,
          recordedOutputDirectory: publishedChecksDirectory,
        });
        const retriedById = new Map(retried.map((check) => [check.definitionId, check]));
        const checks = definitions.map((definition) =>
          retriedById.get(definition.definitionId)
          ?? priorFacts.checks.find((check) =>
            check.definitionId === definition.definitionId)!);
        const afterRetry = await captureGitWorktree(task.projectRoot, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
        if (afterRetry.fingerprint !== priorFacts.current.fingerprint) {
          throw usageError('A retried check changed the worktree; run a full collect to rebind every fact.');
        }
        const afterRetryExecutionInputs = captureVerificationInputs(
          task.projectRoot,
          definitions,
        );
        factsBase = {
          ...priorFacts,
          checks,
          currentExecutionInputs: afterRetryExecutionInputs,
          checkComparisons: compareChecksToBaseline(priorFacts.baselineVerification, checks),
          evidenceConcerns: collectCheckEvidenceConcerns(
            currentContract,
            priorFacts.baselineVerification,
            checks,
          ),
          environment: collectExecutionEnvironment(task.projectRoot, definitions),
        };
        delete (factsBase as Partial<FactBundle>).factCollectionId;
      } else {
        const timeoutMs = options.timeoutMs ?? task.projection.executionBudget.checkTimeoutMs;
        const preCheck = await captureGitWorktree(task.projectRoot, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
        const preCheckExecutionInputs = captureVerificationInputs(
          task.projectRoot,
          definitions,
        );
        const checks = await runFrozenChecks({
          projectRoot: task.projectRoot,
          executions: definitions.map((definition) => ({ definition, timeoutMs })),
          outputDirectory: checksDirectory,
          recordedOutputDirectory: publishedChecksDirectory,
        });
        const worktree = await collectGitWorktreeChange(task.projectRoot, baseline, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
        const currentExecutionInputs = captureVerificationInputs(
          task.projectRoot,
          definitions,
        );
        const checkInducedChanges = compareGitWorktrees(preCheck, worktree.current);
        const patchRelative = `${attemptDirectory(currentAttempt.attemptId)}/change-${task.projection.revision + 1}.patch`;
        const patchPath = taskArtifactPath(stagedArtifactsDirectory, patchRelative);
        const publishedPatchPath = taskArtifactPath(task.taskDirectory, patchRelative);
        const patch = worktree.patch.length
          ? {
              path: projectRelativePath(task.projectRoot, publishedPatchPath),
              digest: sha256(worktree.patch),
              byteLength: worktree.patch.length,
            }
          : undefined;
        if (patch) {
          writeImmutableBuffer(patchPath, worktree.patch);
          newArtifactRefs.push(patch.path);
        }
        factsBase = {
          protocol: DELEGATION_PROTOCOL,
          schemaVersion: DELEGATION_SCHEMA_VERSION,
          effectiveContractId: currentContract.effectiveContractId,
          attemptId: currentAttempt.attemptId,
          baseline: summarizeWorktree(baseline),
          preCheck: summarizeWorktree(preCheck),
          current: summarizeWorktree(worktree.current),
          preCheckExecutionInputs,
          currentExecutionInputs,
          baselineVerification,
          changeFingerprint: worktree.changeFingerprint,
          changedFiles: worktree.changedFiles,
          checkInducedChanges,
          checks,
          checkComparisons: compareChecksToBaseline(baselineVerification, checks),
          evidenceConcerns: collectCheckEvidenceConcerns(
            currentContract,
            baselineVerification,
            checks,
          ),
          verifierMutations: collectVerifierMutations(currentContract, worktree.changedFiles),
          environment: collectExecutionEnvironment(task.projectRoot, definitions),
          ...(patch ? { patch } : {}),
          provenance: {
            collector: 'stetra-cli',
            cliVersion: options.productVersion,
            coreVersion: options.productVersion,
          },
        };
      }

      const collectionId = factCollectionId(factsBase);
      const facts: FactBundle = { ...factsBase, factCollectionId: collectionId };
      const factsRelative = factsPath(currentAttempt.attemptId, collectionId);
      const factsAbsolute = taskArtifactPath(stagedArtifactsDirectory, factsRelative);
      const publishedFactsAbsolute = taskArtifactPath(task.taskDirectory, factsRelative);
      writeImmutableJson(factsAbsolute, facts);
      newArtifactRefs.push(projectRelativePath(task.projectRoot, publishedFactsAbsolute));
      newArtifactRefs.push(...factLogPaths(facts));
      collectedFacts = facts;

      const parentFacts = currentAttempt.parentAttemptId
        ? readAttemptFactsIfPresent(task, currentAttempt.parentAttemptId)
        : undefined;
      repeatedObservation = ['repair', 'correction'].includes(currentAttempt.trigger)
        && Boolean(parentFacts)
        && attemptOutcomeFingerprint(parentFacts!) === attemptOutcomeFingerprint(facts);
      const attempts = task.projection.attempts.map((attempt) =>
        attempt.attemptId === currentAttempt.attemptId
          ? {
              ...attempt,
              factCollectionId: facts.factCollectionId,
            }
          : attempt);
      const cleared = clearPostCollectionArtifacts(task.projection);
      return commitStagedTaskTransition({
        projectRoot: task.projectRoot,
        taskId: task.taskId,
        expectedRevision,
        type: retries.length ? 'timeout-retried' : 'facts-collected',
        actor: 'runtime',
        projection: {
          ...cleared,
          attempts,
          timeoutRetryUsage: incrementTimeoutRetryUsage(
            task.projection.timeoutRetryUsage,
            retriedVerifierIds,
          ),
        },
        artifactRefs: unique(newArtifactRefs),
        stagedArtifactsDirectory,
      });
    } finally {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
  });
  if (!collectedFacts) throw new Error('Fact collection completed without a Fact Bundle.');
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: collectionState.mode === 'reused-current'
      ? 'facts-current' as const
      : 'facts-collected' as const,
    collectionMode: collectionState.mode,
    taskId: transitioned.taskId,
    attemptId: collectedFacts.attemptId,
    factCollectionId: collectedFacts.factCollectionId,
    repeatedObservation,
    task: compactTask(transitioned),
    summary: collectedFactSummary(collectedFacts),
    details: {
      index: explainCommand(transitioned.taskId, 'index'),
      recommended: [
        { section: 'attempts' as const, ...explainCommand(transitioned.taskId, 'attempts') },
      ],
    },
    hostAction: currentTaskHostAction(transitioned),
  };
}

function collectedFactSummary(facts: FactBundle) {
  return {
    changedFiles: {
      total: facts.changedFiles.length,
      operations: countBy(facts.changedFiles.map((file) => file.operation)),
    },
    checkInducedChanges: facts.checkInducedChanges.length,
    checks: {
      total: facts.checks.length,
      latestStatuses: countBy(facts.checks.map((check) => latestCheckAttempt(check).status)),
    },
    checkComparisons: countBy(facts.checkComparisons.map((comparison) => comparison.relation)),
    evidenceConcerns: facts.evidenceConcerns.length,
    verifierMutations: facts.verifierMutations.length,
    patch: facts.patch
      ? { present: true, byteLength: facts.patch.byteLength, digest: facts.patch.digest }
      : { present: false },
  };
}

function preparedTaskSummary(
  contract: TaskContract,
  baseline: WorktreeSnapshot,
  baselineVerification: BaselineVerificationFact,
) {
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions
    : [];
  const baselineStatuses = baselineVerification.checks.flatMap((check) =>
    check.observation ? [latestCheckAttempt(check.observation).status] : []);
  return {
    contract: {
      semanticContractId: contract.semanticContractId,
      verificationPlanId: contract.verificationPlanId,
      effectiveContractId: contract.effectiveContractId,
      developerEventCount: contract.humanEvents.length,
      materialDecisionCount: contract.materialDecisions.length,
      conditionCount: contract.adoptionConditions.length,
      obligationCount: contract.adoptionConditions.reduce(
        (count, condition) => count + condition.evidenceObligations.length,
        0,
      ),
      checkCount: definitions.length,
      hostPolicyRequirementCount: contract.hostPolicyRequirements.length,
    },
    baseline: {
      ...summarizeWorktree(baseline),
      baselineCheckStatusCounts: countBy(baselineStatuses),
      checkInducedChangeCount: baselineVerification.checkInducedChanges.length,
    },
  };
}

function handoffResultSummary(packet: DecisionPacket, evaluation: HandoffEvaluation) {
  return {
    attentionCount: evaluation.attention.length,
    conditionStatusCounts: countBy(packet.conditions.map((condition) =>
      condition.agentFinding.status)),
    obligationStatusCounts: countBy(packet.conditions.flatMap((condition) =>
      condition.obligations.map((obligation) => obligation.agentFinding.status))),
    pendingEvidencePathCount: packet.conditions.reduce(
      (count, condition) => count + condition.obligations.filter((obligation) =>
        obligation.evidencePath.status !== 'completed').length,
      0,
    ),
  };
}

function explainCommand(taskId: string, section: string) {
  return {
    command: {
      argv: [
        'stetra', 'change', 'explain', '.', '--task', taskId,
        '--section', section, '--json',
      ],
    },
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export async function diagnoseCollectedEvidence(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  let ownedClaim: OwnedInputClaim | undefined;
  const source = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: EvidenceDispositionDocumentSchema,
    label: 'Evidence disposition input',
    retryCommand: {
      argv: ['stetra', 'change', 'diagnose', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
    currentBinding: { taskId: options.taskId, stage: 'diagnose' },
    onOwnedClaim: (claim) => { ownedClaim = claim; },
  });
  let route: EvidenceDisposition['route'] | undefined;
  let disposition: EvidenceDisposition | undefined;
  let successorAttemptId: string | undefined;
  const transitioned = await recoverOwnedInputOnFailure({
    projectRoot,
    claim: ownedClaim,
    retryCommand: {
      argv: ['stetra', 'change', 'diagnose', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
  }, () => transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'evidence-diagnosed',
    actor: 'agent',
    mutate(task) {
      const contract = readContract(task);
      const current = task.projection.attempts.find((attempt) =>
        attempt.attemptId === task.projection.currentAttemptId)!;
      if (!current.factCollectionId) {
        throw usageError('Evidence diagnosis requires collected facts for the current Attempt.');
      }
      if (deriveTaskState(task).decisionStatus !== 'pending') {
        throw usageError('A decided task cannot record evidence diagnosis.');
      }
      const facts = readFacts(task, current.attemptId, current.factCollectionId);
      validateEvidenceDispositionInput(source, contract, facts);
      route = source.action.kind;
      const budgetExhausted = route === 'repair-delivery'
        && deriveTaskState(task).repairCount >= task.projection.executionBudget.maxDeliveryRepairs;
      if (budgetExhausted) route = 'handoff';
      const dispositionProjection = {
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        effectiveContractId: contract.effectiveContractId,
        attemptId: current.attemptId,
        factCollectionId: facts.factCollectionId,
        semanticImpact: source.contractImpact === 'material' ? 'material' as const : 'none' as const,
        proposedRoute: source.action.kind,
        routeRationale: source.action.rationale,
        entries: source.entries.map(materializeDiagnosisEntry),
        route,
      };
      disposition = {
        dispositionId: stableFingerprint(dispositionProjection),
        ...dispositionProjection,
      };
      const dispositionRelative = evidenceDispositionPath(current.attemptId, disposition.dispositionId);
      const dispositionPath = taskArtifactPath(task.taskDirectory, dispositionRelative);
      writeImmutableJson(dispositionPath, disposition);
      const currentWithDisposition = {
        ...current,
        evidenceDispositionIds: [
          ...current.evidenceDispositionIds,
          disposition.dispositionId,
        ],
      };
      const cleared = clearPostCollectionArtifacts(task.projection);
      if (route !== 'repair-delivery') {
        return {
          projection: {
            ...cleared,
            attempts: task.projection.attempts.map((attempt) =>
              attempt.attemptId === current.attemptId ? currentWithDisposition : attempt),
            ...(route === 'ask-human' ? {
              pendingResolution: {
                kind: 'semantic-impact' as const,
                targetId: disposition.dispositionId,
              },
            } : {}),
          },
          artifactRefs: [projectRelativePath(task.projectRoot, dispositionPath)],
        };
      }
      successorAttemptId = `attempt:${current.ordinal + 1}`;
      const attemptRelative = `${attemptDirectory(successorAttemptId)}/attempt.json`;
      const attemptPath = taskArtifactPath(task.taskDirectory, attemptRelative);
      const successor = {
        attemptId: successorAttemptId,
        ordinal: current.ordinal + 1,
        parentAttemptId: current.attemptId,
        effectiveContractId: contract.effectiveContractId,
        trigger: 'delivery-repair' as const,
        evidenceDispositionIds: [],
      };
      writeImmutableJson(attemptPath, successor);
      return {
        projection: {
          ...cleared,
          currentAttemptId: successorAttemptId,
          attempts: [
            ...task.projection.attempts.map((attempt) =>
              attempt.attemptId === current.attemptId ? currentWithDisposition : attempt),
            successor,
          ],
        },
        artifactRefs: [
          projectRelativePath(task.projectRoot, dispositionPath),
          projectRelativePath(task.projectRoot, attemptPath),
        ],
      };
    },
  }));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: route === 'repair-delivery'
      ? 'repair-prepared' as const
      : 'evidence-diagnosed' as const,
    taskId: transitioned.taskId,
    transition: {
      dispositionId: disposition!.dispositionId,
      route: disposition!.route,
      concernCount: disposition!.entries.length,
      semanticImpact: disposition!.semanticImpact,
    },
    ...(successorAttemptId ? { successorAttemptId } : {}),
    task: compactTask(transitioned),
    hostAction: currentTaskHostAction(transitioned),
  };
}

export async function evaluateDelegationHandoff(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const loaded = loadTask(projectRoot, options.taskId);
  const facts = readCurrentFacts(loaded);
  const current = await captureGitWorktree(projectRoot, {
    objectDirectory: taskArtifactPath(loaded.taskDirectory, WORKTREE_OBJECTS_DIRECTORY),
  });
  if (current.fingerprint !== facts.current.fingerprint) {
    return staleHandoffResult(loaded, facts, current.fingerprint);
  }
  const contract = readContract(loaded);
  let ownedClaim: OwnedInputClaim | undefined;
  const authoredSource = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: handoffAuthoringDocumentSchema({
      task: loaded.projection,
      contract,
      facts,
      requiredObligationIds: requiredChallengeObligationIds(contract, facts),
    }),
    label: 'Cognitive Handoff input',
    retryCommand: {
      argv: ['stetra', 'change', 'handoff', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
    currentBinding: { taskId: options.taskId, stage: 'handoff' },
    onOwnedClaim: (claim) => { ownedClaim = claim; },
  });
  let handoff: CognitiveHandoff | undefined;
  let evaluation: HandoffEvaluation | undefined;
  let packet: DecisionPacket | undefined;
  const transitioned = await recoverOwnedInputOnFailure({
    projectRoot,
    claim: ownedClaim,
    retryCommand: {
      argv: ['stetra', 'change', 'handoff', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
  }, () => transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'handoff-evaluated',
    actor: 'agent',
    async mutate(task) {
      const contract = readContract(task);
      const currentFacts = readCurrentFacts(task);
      if (await currentFactsAreStale(task, currentFacts)) {
        throw usageError('Facts changed while handoff was being authored; collect again.');
      }
      let source: CognitiveHandoffDocument;
      try {
        source = handoffDocumentSchema({
          task: task.projection,
          contract,
          facts: currentFacts,
          requiredObligationIds: requiredChallengeObligationIds(contract, currentFacts),
        }).parse(compileHandoffAuthoring({
          contract,
          source: authoredSource as HandoffAuthoringSource,
        }));
      } catch (error) {
        throw handoffInputError(error, contract);
      }
      handoff = materializeHandoff(source, contract, currentFacts);
      try {
        evaluation = evaluateHandoff({
          protocol: DELEGATION_PROTOCOL,
          schemaVersion: DELEGATION_SCHEMA_VERSION,
          contract,
          factBundle: currentFacts,
          currentWorktreeFingerprint: currentFacts.current.fingerprint,
          currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
          deliveryExhausted: deriveTaskState(task).deliveryStatus === 'exhausted',
          verificationRevised: task.projection.verificationRevisionIds.length > 0,
          handoff,
        });
      } catch (error) {
        throw handoffInputError(error, contract);
      }
      packet = buildDecisionPacket(
        contract,
        currentFacts,
        readEvidenceDispositions(task),
        handoff,
        evaluation,
        readHumanResolutions(task),
      );
      const handoffRelative = handoffPath(handoff.handoffId);
      const evaluationRelative = handoffEvaluationPath(handoff.handoffId);
      const handoffAbsolute = taskArtifactPath(task.taskDirectory, handoffRelative);
      const evaluationAbsolute = taskArtifactPath(task.taskDirectory, evaluationRelative);
      writeImmutableJson(handoffAbsolute, handoff);
      writeImmutableJson(evaluationAbsolute, evaluation);
      return {
        projection: {
          ...task.projection,
          currentHandoffId: handoff.handoffId,
        },
        artifactRefs: [
          projectRelativePath(task.projectRoot, handoffAbsolute),
          projectRelativePath(task.projectRoot, evaluationAbsolute),
        ],
      };
    },
  }));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: evaluation!.status,
    taskId: transitioned.taskId,
    attemptId: evaluation!.attemptId,
    factCollectionId: evaluation!.factCollectionId,
    handoffId: handoff!.handoffId,
    handoffFingerprint: handoff!.handoffFingerprint,
    summary: handoffResultSummary(packet!, evaluation!),
    details: {
      index: explainCommand(transitioned.taskId, 'index'),
      recommended: [
        { section: 'decision-packet' as const, ...explainCommand(transitioned.taskId, 'decision-packet') },
      ],
    },
    hostAction: handoffHostAction(
      evaluation!.status,
      transitioned.taskId,
      buildDeveloperDecisionBrief({
        task: taskView(transitioned),
        contract: readContract(transitioned),
        packet: packet!,
        evaluation: evaluation!,
      }),
      decisionAuthoringPacket({
        task: transitioned.projection,
        contract: readContract(transitioned),
        facts: readCurrentFacts(transitioned),
        handoff: handoff!,
        evaluation: evaluation!,
      }),
      packet!,
    ),
  };
}

export async function recordHumanDecision(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const loaded = loadTask(projectRoot, options.taskId);
  const facts = readCurrentFacts(loaded);
  const current = await captureGitWorktree(projectRoot, {
    objectDirectory: taskArtifactPath(loaded.taskDirectory, WORKTREE_OBJECTS_DIRECTORY),
  });
  if (current.fingerprint !== facts.current.fingerprint) {
    return staleHandoffResult(loaded, facts, current.fingerprint);
  }
  let ownedClaim: OwnedInputClaim | undefined;
  const source = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: HumanDecisionDocumentSchema,
    label: 'Human Decision input',
    retryCommand: {
      argv: ['stetra', 'change', 'decide', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
    currentBinding: { taskId: options.taskId, stage: 'decide' },
    onOwnedClaim: (claim) => { ownedClaim = claim; },
  });
  let decision: HumanDecision | undefined;
  let evaluation: HandoffEvaluation | undefined;
  const transitioned = await recoverOwnedInputOnFailure({
    projectRoot,
    claim: ownedClaim,
    retryCommand: {
      argv: ['stetra', 'change', 'decide', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
  }, () => transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'decision-recorded',
    actor: 'human',
    async mutate(task) {
      if (deriveTaskState(task).decisionStatus !== 'pending') {
        throw usageError(`Task already has decision ${deriveTaskState(task).decisionStatus}.`);
      }
      const contract = readContract(task);
      const currentFacts = readCurrentFacts(task);
      if (await currentFactsAreStale(task, currentFacts)) {
        throw usageError('Facts changed while the decision was being recorded; collect and review again.');
      }
      const handoff = readCurrentHandoff(task);
      decision = materializeDecision(source, contract, currentFacts, handoff);
      try {
        evaluation = evaluateHandoff({
          protocol: DELEGATION_PROTOCOL,
          schemaVersion: DELEGATION_SCHEMA_VERSION,
          contract,
          factBundle: currentFacts,
          currentWorktreeFingerprint: currentFacts.current.fingerprint,
          currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
          deliveryExhausted: deriveTaskState(task).deliveryStatus === 'exhausted',
          verificationRevised: task.projection.verificationRevisionIds.length > 0,
          handoff,
          decision,
        });
      } catch (error) {
        throw handoffInputError(error, contract);
      }
      const decisionRelative = decisionPath(decision.decisionId);
      const evaluationRelative = decisionEvaluationPath(decision.decisionId);
      const decisionAbsolute = taskArtifactPath(task.taskDirectory, decisionRelative);
      const evaluationAbsolute = taskArtifactPath(task.taskDirectory, evaluationRelative);
      writeImmutableJson(decisionAbsolute, decision);
      writeImmutableJson(evaluationAbsolute, evaluation);
      return {
        projection: {
          ...task.projection,
          decisionId: decision.decisionId,
          ...(decision.interpretation.action === 'correction-requested' ? {
            pendingResolution: {
              kind: 'correction' as const,
              targetId: decision.decisionId,
            },
          } : {}),
        },
        artifactRefs: [
          projectRelativePath(task.projectRoot, decisionAbsolute),
          projectRelativePath(task.projectRoot, evaluationAbsolute),
        ],
      };
    },
  }));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'decision-recorded' as const,
    taskId: transitioned.taskId,
    decisionId: decision!.decisionId,
    decisionStatus: decision!.interpretation.action,
    evidenceStatus: evaluation!.status,
    summary: {
      attentionCount: evaluation!.attention.length,
      exceptionCount: decision!.interpretation.exceptions.length,
    },
    details: {
      index: explainCommand(transitioned.taskId, 'index'),
      recommended: [
        { section: 'decision-packet' as const, ...explainCommand(transitioned.taskId, 'decision-packet') },
        { section: 'decision' as const, ...explainCommand(transitioned.taskId, 'decision') },
      ],
    },
    externalEffects: {
      committed: false,
      merged: false,
      published: false,
      deployed: false,
      activatedForFutureTasks: false,
    },
    hostAction: decision!.interpretation.action === 'correction-requested'
      ? resolutionHostAction(transitioned.taskId, resolutionAuthoringPacket({
          task: transitioned.projection,
          contract: readContract(transitioned),
          facts: readCurrentFacts(transitioned),
        }))
      : null,
  };
}

export async function resolveHumanChoice(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  let ownedClaim: OwnedInputClaim | undefined;
  const source = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: HumanResolutionDocumentSchema,
    label: 'Human Resolution input',
    retryCommand: {
      argv: ['stetra', 'change', 'resolve', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
    currentBinding: { taskId: options.taskId, stage: 'resolve' },
    onOwnedClaim: (claim) => { ownedClaim = claim; },
  });
  let resolution: ReturnType<typeof materializeResolution> | undefined;
  let successorAttemptId: string | undefined;
  const transitioned = await recoverOwnedInputOnFailure({
    projectRoot,
    claim: ownedClaim,
    retryCommand: {
      argv: ['stetra', 'change', 'resolve', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
  }, () => transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'human-resolution-recorded',
    actor: 'human',
    mutate(task) {
      const pending = task.projection.pendingResolution;
      const contract = readContract(task);
      if (!pending || !resolutionTargetMatches(source, pending)) {
        throw usageError('Human Resolution must target the exact currently pending decision.');
      }
      resolution = materializeResolution(source, contract);
      const resolutionRelative = resolutionPath(resolution.resolutionId);
      const resolutionAbsolute = taskArtifactPath(task.taskDirectory, resolutionRelative);
      writeImmutableJson(resolutionAbsolute, resolution);
      const artifactRefs = [projectRelativePath(task.projectRoot, resolutionAbsolute)];
      const withResolutionId = (projection: TaskProjection): TaskProjection => ({
        ...projection,
        humanResolutionIds: unique([
          ...task.projection.humanResolutionIds,
          resolution!.resolutionId,
        ]),
      });
      if (source.action === 'abort') {
        return {
          projection: withResolutionId({
            ...withoutPendingResolution(task.projection),
          }),
          artifactRefs,
        };
      }

      const requestsSuccessor = pending.kind === 'correction'
        || source.action === 'request-correction';
      if (requestsSuccessor) {
        const current = task.projection.attempts.find((attempt) =>
          attempt.attemptId === task.projection.currentAttemptId)!;
        successorAttemptId = `attempt:${current.ordinal + 1}`;
        const successor = {
          attemptId: successorAttemptId,
          ordinal: current.ordinal + 1,
          parentAttemptId: current.attemptId,
          effectiveContractId: contract.effectiveContractId,
          trigger: 'correction' as const,
          evidenceDispositionIds: [],
        };
        const attemptRelative = `${attemptDirectory(successorAttemptId)}/attempt.json`;
        const attemptAbsolute = taskArtifactPath(task.taskDirectory, attemptRelative);
        writeImmutableJson(attemptAbsolute, successor);
        artifactRefs.push(projectRelativePath(task.projectRoot, attemptAbsolute));
        const cleared = clearPostCollectionArtifacts(withoutPendingResolution(task.projection));
        return {
          projection: withResolutionId({
            ...cleared,
            currentAttemptId: successorAttemptId,
            attempts: [...task.projection.attempts, successor],
          }),
          artifactRefs,
        };
      }

      if (pending.kind === 'host-policy') {
        return {
          projection: withResolutionId({
            ...withoutPendingResolution(task.projection),
          }),
          artifactRefs,
        };
      }

      return {
        projection: withResolutionId(withoutPendingResolution(task.projection)),
        artifactRefs,
      };
    },
  }));

  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'human-resolution-recorded' as const,
    taskId: transitioned.taskId,
    transition: {
      resolutionId: resolution!.resolutionId,
      target: resolution!.interpretation.target,
      action: resolution!.interpretation.action,
    },
    ...(successorAttemptId ? { successorAttemptId } : {}),
    task: compactTask(transitioned),
    hostAction: currentTaskHostAction(transitioned),
  };
}

export async function reviseVerificationPlan(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  let ownedClaim: OwnedInputClaim | undefined;
  const authoredSource = await readInputDocument({
    projectRoot,
    pathInput: options.inputPath,
    input: options.input,
    schema: VerificationRevisionAuthoringDocumentSchema,
    label: 'Verification Revision input',
    retryCommand: {
      argv: ['stetra', 'change', 'revise-verification', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
    currentBinding: { taskId: options.taskId, stage: 'revise-verification' },
    onOwnedClaim: (claim) => { ownedClaim = claim; },
  });
  let revisionRecord: ReturnType<typeof materializeVerificationRevision> | undefined;
  let successorAttemptId: string | undefined;
  let revisedContract: TaskContract | undefined;
  const transitioned = await recoverOwnedInputOnFailure({
    projectRoot,
    claim: ownedClaim,
    retryCommand: {
      argv: ['stetra', 'change', 'revise-verification', '.', '--task', options.taskId,
        '--input', options.inputPath, '--json'],
    },
  }, () => transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'verification-revised',
    actor: 'agent',
    mutate(task) {
      if (task.projection.pendingResolution) {
        throw usageError('Resolve the pending Human decision before revising verification.');
      }
      if (deriveTaskState(task).decisionStatus !== 'pending') {
        throw usageError(`Task ${task.taskId} is already ${deriveTaskState(task).decisionStatus}.`);
      }
      const priorContract = readContract(task);
      const source = compileVerificationRevisionAuthoring({
        contract: priorContract,
        source: authoredSource,
      });
      const { checks: authoredChecks, ...revisionSource } = source;
      const revision: VerificationRevisionInput['revision'] = {
        ...revisionSource,
        ...(authoredChecks ? { checks: materializeAuthoredChecks(authoredChecks) } : {}),
      };
      const compiled = compileDelegation({
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        operation: 'revise-verification',
        priorContract,
        revision,
      });
      if (compiled.status !== 'delegation-compiled') {
        const issues = compiled.status === 'authority-invalid' ? compiled.issues : [];
        throw inputError(
          compiled.status === 'authority-invalid'
            ? 'Verification Revision is invalid.' : compiled.message,
          undefined,
          issues.map((item) => ({
            ...item,
            remediation: 'Correct the exact revision input; no existing artifact was changed.',
          })),
        );
      }
      revisedContract = compiled.contract;
      const definitions = revisedContract.verificationPlan.mode === 'checks'
        ? revisedContract.verificationPlan.definitions : [];
      const unavailable = definitions.flatMap((definition) =>
        verificationCommands(definition).flatMap(({ argv }) => {
          const resolution = resolveExecutable(argv[0], task.projectRoot);
          return resolution.status === 'unavailable'
            ? [`${definition.definitionId}: ${resolution.error.message}`] : [];
        }));
      if (unavailable.length) {
        throw inputError(`Revised top-level check executables are unavailable: ${unavailable.join('; ')}`);
      }
      const priorBaseline = readBaseline(task);
      const baselineSummary = summarizeWorktree(priorBaseline);
      const baselineProjection = {
        preCheck: baselineSummary,
        postCheck: baselineSummary,
        preCheckExecutionInputs: captureVerificationInputs(task.projectRoot, definitions),
        postCheckExecutionInputs: captureVerificationInputs(task.projectRoot, definitions),
        checkInducedChanges: [],
        checks: definitions.map((definition) => ({
          definitionId: definition.definitionId,
          mode: definition.baseline.mode === 'task-start'
            ? 'unknown-after-revision' as const : 'unknown' as const,
          observation: null,
        })),
      };
      const baselineVerification: BaselineVerificationFact = {
        fingerprint: stableFingerprint(baselineProjection),
        ...baselineProjection,
      };
      const current = task.projection.attempts.find((attempt) =>
        attempt.attemptId === task.projection.currentAttemptId)!;
      successorAttemptId = `attempt:${current.ordinal + 1}`;
      const successor = {
        attemptId: successorAttemptId,
        ordinal: current.ordinal + 1,
        parentAttemptId: current.attemptId,
        effectiveContractId: revisedContract.effectiveContractId,
        trigger: 'verification-revision' as const,
        evidenceDispositionIds: [],
      };
      const contractRevision = task.projection.contractRevision + 1;
      revisionRecord = materializeVerificationRevision(
        source,
        priorContract,
        revisedContract,
      );
      const artifacts = [
        { relativePath: contractPath(contractRevision), value: revisedContract },
        { relativePath: baselinePath(contractRevision), value: priorBaseline },
        { relativePath: baselineVerificationPath(contractRevision), value: baselineVerification },
        { relativePath: verificationRevisionPath(revisionRecord.revisionId), value: revisionRecord },
        { relativePath: `${attemptDirectory(successorAttemptId)}/attempt.json`, value: successor },
      ];
      for (const artifact of artifacts) {
        writeImmutableJson(taskArtifactPath(task.taskDirectory, artifact.relativePath), artifact.value);
      }
      const cleared = clearPostCollectionArtifacts(task.projection);
      return {
        projection: {
          ...cleared,
          contractRevision,
          semanticContractId: revisedContract.semanticContractId,
          verificationPlanId: revisedContract.verificationPlanId,
          effectiveContractId: revisedContract.effectiveContractId,
          currentAttemptId: successorAttemptId,
          attempts: [...task.projection.attempts, successor],
          verificationRevisionIds: [
            ...task.projection.verificationRevisionIds,
            revisionRecord.revisionId,
          ],
        },
        artifactRefs: artifacts.map((artifact) => projectRelativePath(
          task.projectRoot,
          taskArtifactPath(task.taskDirectory, artifact.relativePath),
        )),
      };
    },
  }));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'verification-revised' as const,
    taskId: transitioned.taskId,
    transition: {
      revisionId: revisionRecord!.revisionId,
      kind: revisionRecord!.kind,
    },
    contractRevision: transitioned.projection.contractRevision,
    semanticContractId: revisedContract!.semanticContractId,
    verificationPlanId: revisedContract!.verificationPlanId,
    effectiveContractId: revisedContract!.effectiveContractId,
    successorAttemptId: successorAttemptId!,
    baseline: 'baseline-unknown-after-revision' as const,
    task: compactTask(transitioned),
    hostAction: currentTaskHostAction(transitioned),
  };
}

export function explainDelegationTask(options: {
  projectRoot: string;
  taskId: string;
  section?: string;
  stage?: string;
  part?: string;
  attemptId?: string;
  definitionId?: string;
  dispositionId?: string;
  eventId?: string;
  humanEventId?: string;
  repositoryEvidenceId?: string;
  materialDecisionKey?: string;
  conditionKey?: string;
  repositoryPath?: string;
  checkAttempt?: number;
  stepId?: string;
  stream?: string;
  tailBytes?: number;
}) {
  const task = loadTask(options.projectRoot, options.taskId);
  const section = options.section ?? 'index';
  const common = {
    protocol: task.projection.protocol,
    schemaVersion: task.projection.schemaVersion,
    taskId: task.taskId,
    task: compactTask(task),
    section,
  };
  if (section === 'contract') {
    return boundedExplainView(section, {
      ...common,
      contract: summarizeContract(readContract(task), task.taskId),
      baseline: summarizeWorktree(readBaseline(task)),
    });
  }
  if (section === 'baseline') {
    const baseline = readBaseline(task);
    return boundedExplainView(section, {
      ...common,
      baseline: {
        ...summarizeWorktree(baseline),
        treeId: baseline.treeId,
      },
      baselineVerification: summarizeBaselineVerification(readBaselineVerification(task)),
      selectors: {
        entry: explainSelectorCommand(task.taskId, 'baseline-entry', ['--path', '<exact-repository-path>']),
        checkAttempt: explainSelectorCommand(
          task.taskId,
          'check-attempt',
          ['--attempt', 'baseline', '--definition', '<definition-id>'],
        ),
        changedFile: explainSelectorCommand(
          task.taskId,
          'changed-file',
          ['--attempt', '<attempt-id>', '--path', '<exact-repository-path>'],
        ),
        log: explainSelectorCommand(
          task.taskId,
          'log',
          [
            '--attempt', 'baseline', '--definition', '<definition-id>',
            '--stream', '<stdout-or-stderr>', '--tail-bytes', '<1-to-65536>',
          ],
        ),
      },
    });
  }
  if (section === 'baseline-entry') {
    if (!options.repositoryPath) {
      throw usageError('baseline-entry inspection requires --path <exact-repository-path>.');
    }
    const baseline = readBaseline(task);
    const entry = baseline.entries.find((candidate) => candidate.path === options.repositoryPath);
    if (!entry) {
      throw usageError(`The task baseline has no entry at ${options.repositoryPath}.`);
    }
    return { ...common, entry };
  }
  if (section === 'condition') {
    if (!options.conditionKey) {
      throw usageError('condition inspection requires --condition <key>.');
    }
    const contract = readContract(task);
    const condition = contract.adoptionConditions.find((candidate) =>
      candidate.key === options.conditionKey);
    if (!condition) {
      throw usageError(`The Task Contract has no Condition with key ${options.conditionKey}.`);
    }
    return { ...common, condition };
  }
  if (section === 'human-event') {
    if (!options.humanEventId) {
      throw usageError('human-event inspection requires --human-event <id>.');
    }
    const humanEvent = readContract(task).humanEvents.find((candidate) =>
      candidate.id === options.humanEventId);
    if (!humanEvent) {
      throw usageError(`Task Contract has no Human Event ${options.humanEventId}.`);
    }
    return { ...common, humanEvent };
  }
  if (section === 'repository-evidence') {
    if (!options.repositoryEvidenceId) {
      throw usageError('repository-evidence inspection requires --evidence <id>.');
    }
    const repositoryEvidence = readContract(task).repositoryEvidence.find((candidate) =>
      candidate.id === options.repositoryEvidenceId);
    if (!repositoryEvidence) {
      throw usageError(`Task Contract has no Repository Evidence ${options.repositoryEvidenceId}.`);
    }
    return { ...common, repositoryEvidence };
  }
  if (section === 'material-decision') {
    if (!options.materialDecisionKey) {
      throw usageError('material-decision inspection requires --material-decision <key>.');
    }
    const materialDecision = readContract(task).materialDecisions.find((candidate) =>
      candidate.key === options.materialDecisionKey);
    if (!materialDecision) {
      throw usageError(`Task Contract has no Material Decision ${options.materialDecisionKey}.`);
    }
    return { ...common, materialDecision };
  }
  if (section === 'action') {
    return {
      ...common,
      hostAction: currentTaskHostAction(task),
    };
  }
  if (section === 'action-input') {
    if (!options.stage) {
      throw usageError('action-input inspection requires --stage <name>.');
    }
    const action = currentTaskHostAction(task);
    if (!action) throw usageError('The task has no current Host Action.');
    const candidates: Array<HostAction | NonNullable<HostAction['decisionContinuation']>> = [action];
    if (action.decisionContinuation) candidates.push(action.decisionContinuation);
    const selected = candidates.find((candidate) =>
      candidate.command?.argv[2] === options.stage
      && candidate.inputBinding);
    const packet = selected ? hostActionAuthoringPacket(selected) : undefined;
    if (!selected?.inputBinding || !packet) {
      throw usageError(`The current Host Action has no ${options.stage} Authoring Projection.`);
    }
    const part = options.part ?? 'guide';
    if (!['draft', 'guide', 'schema'].includes(part)) {
      throw usageError('Invalid action-input part; use draft, guide, or schema.');
    }
    return {
      ...common,
      stage: options.stage,
      part,
      projectionFingerprint: selected.inputBinding.projectionFingerprint,
      ...(part === 'draft' ? { draft: packet.draft } : {}),
      ...(part === 'guide' ? { guide: authoringGuide(packet) } : {}),
      ...(part === 'schema' ? { inputSchema: packet.inputSchema } : {}),
    };
  }
  if (section === 'attempts') {
    return boundedExplainView(section, {
      ...common,
      attempts: task.projection.attempts.map((attempt) => summarizeAttemptForExplain(task, attempt)),
      selectors: {
        attempt: explainSelectorCommand(
          task.taskId,
          'attempt-entry',
          ['--attempt', '<attempt-id>'],
        ),
        checkAttempt: explainSelectorCommand(
          task.taskId,
          'check-attempt',
          ['--attempt', '<attempt-id>', '--definition', '<definition-id>'],
        ),
        evidenceDisposition: explainSelectorCommand(
          task.taskId,
          'evidence-disposition',
          ['--disposition', '<disposition-id>'],
        ),
        log: explainSelectorCommand(
          task.taskId,
          'log',
          [
            '--attempt', '<attempt-id>', '--definition', '<definition-id>',
            '--stream', '<stdout-or-stderr>', '--tail-bytes', '<1-to-65536>',
          ],
        ),
      },
    });
  }
  if (section === 'attempt-entry') {
    if (!options.attemptId) {
      throw usageError('attempt-entry inspection requires --attempt <attempt-id>.');
    }
    const attempt = task.projection.attempts.find((candidate) =>
      candidate.attemptId === options.attemptId);
    if (!attempt) {
      throw usageError(`Task has no Attempt ${options.attemptId}.`);
    }
    return boundedExplainView(section, {
      ...common,
      attempt: summarizeAttemptForExplain(task, attempt),
    });
  }
  if (section === 'changed-file') {
    if (!options.attemptId || !options.repositoryPath) {
      throw usageError('changed-file inspection requires --attempt <attempt-id> and --path <exact-repository-path>.');
    }
    const attempt = task.projection.attempts.find((candidate) =>
      candidate.attemptId === options.attemptId);
    if (!attempt?.factCollectionId) {
      throw usageError(`Task has no collected facts for Attempt ${options.attemptId}.`);
    }
    const changedFile = readFacts(task, attempt.attemptId, attempt.factCollectionId)
      .changedFiles.find((candidate) => candidate.path === options.repositoryPath);
    if (!changedFile) {
      throw usageError(
        `Attempt ${options.attemptId} has no changed file at ${options.repositoryPath}.`,
      );
    }
    return { ...common, attemptId: options.attemptId, changedFile };
  }
  if (section === 'check-attempt') {
    const selected = selectCheckAttempt(task, options);
    return boundedExplainView(section, {
      ...common,
      scope: selected.scope,
      attemptId: selected.attemptId,
      definitionId: selected.check.definitionId,
      checkAttempt: summarizeCheckAttempt(selected.checkAttempt),
    });
  }
  if (section === 'log') {
    if (options.stream !== 'stdout' && options.stream !== 'stderr') {
      throw usageError('log inspection requires --stream stdout or --stream stderr.');
    }
    const selected = selectCheckAttempt(task, options);
    const source = options.stepId
      ? selected.checkAttempt.steps.find((step) => step.stepId === options.stepId)
      : selected.checkAttempt;
    if (!source) {
      throw usageError(`Check Attempt has no step with id ${options.stepId}.`);
    }
    const stream = source[options.stream];
    return boundedExplainView(section, {
      ...common,
      scope: selected.scope,
      attemptId: selected.attemptId,
      definitionId: selected.check.definitionId,
      checkAttempt: selected.checkAttempt.attempt,
      stepId: options.stepId ?? null,
      stream: options.stream,
      log: readBoundedCheckLog(task, stream, options.tailBytes ?? 8_192),
    }, MAX_LOG_EXPLAIN_BYTES);
  }
  if (section === 'evidence-disposition') {
    if (!options.dispositionId) {
      throw usageError('evidence-disposition inspection requires --disposition <id>.');
    }
    const match = task.projection.attempts.find((attempt) =>
      attempt.evidenceDispositionIds.includes(options.dispositionId!));
    if (!match) {
      throw usageError(`Task has no Evidence Disposition ${options.dispositionId}.`);
    }
    return {
      ...common,
      evidenceDisposition: readJsonArtifact(
        taskArtifactPath(
          task.taskDirectory,
          evidenceDispositionPath(match.attemptId, options.dispositionId),
        ),
        `Evidence Disposition ${options.dispositionId}`,
      ),
    };
  }
  if (section === 'revision') {
    return { ...common, verificationRevisions: readVerificationRevisions(task) };
  }
  if (section === 'handoff') {
    return {
      ...common,
      handoff: task.projection.currentHandoffId ? readCurrentHandoff(task) : null,
      evaluation: task.projection.currentHandoffId
        ? readJsonArtifact(taskArtifactPath(task.taskDirectory, handoffEvaluationPath(task.projection.currentHandoffId)), 'handoff evaluation')
        : null,
    };
  }
  if (section === 'decision-packet') {
    if (!task.projection.currentHandoffId) {
      throw usageError('Decision Packet inspection requires a current Cognitive Handoff.');
    }
    const contract = readContract(task);
    const facts = readCurrentFacts(task);
    const handoff = readCurrentHandoff(task);
    const evaluation = readJsonArtifact<HandoffEvaluation>(
      taskArtifactPath(task.taskDirectory, handoffEvaluationPath(handoff.handoffId)),
      'handoff evaluation',
    );
    return {
      ...common,
      decisionPacket: buildDecisionPacket(
        contract,
        facts,
        readEvidenceDispositions(task),
        handoff,
        evaluation,
        readHumanResolutions(task),
        task.projection.decisionId
          ? readJsonArtifact<HumanDecision>(
              taskArtifactPath(task.taskDirectory, decisionPath(task.projection.decisionId)),
              'Human Decision',
            )
          : undefined,
      ),
    };
  }
  if (section === 'decision') {
    return {
      ...common,
      decision: task.projection.decisionId
        ? readJsonArtifact(taskArtifactPath(task.taskDirectory, decisionPath(task.projection.decisionId)), 'Human Decision')
        : null,
    };
  }
  if (section === 'events') {
    return boundedExplainView(section, {
      ...common,
      events: task.events.map((event) => ({
        sequence: event.sequence,
        eventId: event.eventId,
        type: event.type,
        actor: event.actor,
        occurredAt: event.occurredAt,
        priorRevision: event.priorRevision,
        resultingRevision: event.resultingRevision,
        artifactRefs: event.artifactRefs,
      })),
      selectors: {
        event: explainSelectorCommand(
          task.taskId,
          'event-entry',
          ['--event', '<event-id>'],
        ),
      },
    });
  }
  if (section === 'event-entry') {
    if (!options.eventId) {
      throw usageError('event-entry inspection requires --event <id>.');
    }
    const event = task.events.find((candidate) => candidate.eventId === options.eventId);
    if (!event) {
      throw usageError(`Task has no lifecycle Event ${options.eventId}.`);
    }
    return { ...common, event };
  }
  if (section !== 'index') {
    throw usageError('Invalid explain section; use index, action, action-input, contract, condition, human-event, repository-evidence, material-decision, baseline, baseline-entry, attempts, attempt-entry, changed-file, check-attempt, log, evidence-disposition, revision, handoff, decision-packet, decision, events, or event-entry.');
  }
  const indexAction = currentTaskHostAction(task);
  const inputStages = indexAction
    ? [
        indexAction,
        ...(indexAction.decisionContinuation ? [indexAction.decisionContinuation] : []),
      ].flatMap((action) => action.inputBinding
        && action.command?.argv[2]
        ? [action.command.argv[2]]
        : [])
    : [];
  return boundedExplainView(section, {
    ...common,
    availableSections: [
      { name: 'action', available: deriveTaskState(task).decisionStatus === 'pending' },
      { name: 'contract', available: true, shape: 'bounded-summary' },
      { name: 'condition', available: true, shape: 'exact-selector' },
      { name: 'human-event', available: true, shape: 'exact-selector' },
      { name: 'repository-evidence', available: true, shape: 'exact-selector' },
      { name: 'material-decision', available: true, shape: 'exact-selector' },
      { name: 'baseline', available: true, shape: 'bounded-summary' },
      { name: 'baseline-entry', available: true, shape: 'exact-selector' },
      {
        name: 'action-input',
        available: inputStages.length > 0,
        stages: inputStages,
      },
      {
        name: 'attempts',
        available: true,
        count: task.projection.attempts.length,
        shape: 'bounded-summary',
      },
      { name: 'check-attempt', available: true, shape: 'exact-selector' },
      { name: 'attempt-entry', available: task.projection.attempts.length > 0, shape: 'exact-selector' },
      { name: 'changed-file', available: task.projection.attempts.length > 0, shape: 'exact-selector' },
      { name: 'log', available: true, shape: 'exact-selector-bounded-tail' },
      {
        name: 'evidence-disposition',
        available: task.projection.attempts.some((attempt) =>
          attempt.evidenceDispositionIds.length > 0),
        shape: 'exact-selector',
      },
      { name: 'revision', available: task.projection.verificationRevisionIds.length > 0, count: task.projection.verificationRevisionIds.length },
      { name: 'handoff', available: Boolean(task.projection.currentHandoffId) },
      { name: 'decision-packet', available: Boolean(task.projection.currentHandoffId) },
      { name: 'decision', available: Boolean(task.projection.decisionId) },
      { name: 'events', available: true, count: task.events.length, shape: 'bounded-summary' },
      { name: 'event-entry', available: task.events.length > 0, shape: 'exact-selector' },
    ],
    artifactIndex: {
      attempts: task.projection.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        factCollectionId: attempt.factCollectionId ?? null,
      })),
      verificationRevisionIds: task.projection.verificationRevisionIds,
      handoffId: task.projection.currentHandoffId ?? null,
      decisionId: task.projection.decisionId ?? null,
    },
  });
}

function summarizeAttemptForExplain(
  task: LoadedTask,
  attempt: TaskProjection['attempts'][number],
) {
  const facts = attempt.factCollectionId
    ? readFacts(task, attempt.attemptId, attempt.factCollectionId)
    : undefined;
  const dispositions = attempt.evidenceDispositionIds.map((dispositionId) =>
    readJsonArtifact<EvidenceDisposition>(
      taskArtifactPath(
        task.taskDirectory,
        evidenceDispositionPath(attempt.attemptId, dispositionId),
      ),
      `Evidence Disposition ${dispositionId}`,
    ));
  return summarizeAttempt(attempt, facts, dispositions);
}

function selectCheckAttempt(
  task: LoadedTask,
  options: {
    attemptId?: string;
    definitionId?: string;
    checkAttempt?: number;
  },
) {
  if (!options.attemptId || !options.definitionId) {
    throw usageError(
      'check inspection requires --attempt <attempt-id-or-baseline> and --definition <id>.',
    );
  }
  let check: CheckFact | undefined;
  let scope: 'baseline' | 'attempt';
  if (options.attemptId === 'baseline') {
    scope = 'baseline';
    check = readBaselineVerification(task).checks.find((candidate) =>
      candidate.definitionId === options.definitionId)?.observation ?? undefined;
  } else {
    scope = 'attempt';
    const attempt = task.projection.attempts.find((candidate) =>
      candidate.attemptId === options.attemptId);
    if (!attempt?.factCollectionId) {
      throw usageError(`Task has no collected facts for Attempt ${options.attemptId}.`);
    }
    check = readFacts(task, attempt.attemptId, attempt.factCollectionId).checks.find((candidate) =>
      candidate.definitionId === options.definitionId);
  }
  if (!check) {
    throw usageError(
      `${options.attemptId === 'baseline' ? 'Baseline' : `Attempt ${options.attemptId}`} has no Check ${options.definitionId}.`,
    );
  }
  const checkAttempt = options.checkAttempt === undefined
    ? check.attempts.at(-1)
    : check.attempts.find((candidate) => candidate.attempt === options.checkAttempt);
  if (!checkAttempt) {
    throw usageError(
      `Check ${options.definitionId} has no execution attempt ${options.checkAttempt ?? 'latest'}.`,
    );
  }
  return {
    scope,
    attemptId: options.attemptId,
    check,
    checkAttempt,
  };
}

export async function guardFinalResponse(options: {
  projectRoot: string;
  taskId: string;
  knownActionFingerprint?: string;
}): Promise<FinalResponseGuard> {
  const task = loadTask(options.projectRoot, options.taskId);
  const currentAttempt = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId)!;
  const facts = currentAttempt.factCollectionId
    ? readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId)
    : undefined;
  const factsCurrent = facts ? !(await currentFactsAreStale(task, facts)) : false;
  let disposition:
    | 'continue-workflow'
    | 'present-decision-brief'
    | 'human-decision-recorded';
  let hostAction = facts && !factsCurrent
    ? staleFactsHostAction(task.taskId)
    : currentTaskHostAction(task);

  if (task.projection.pendingResolution || !facts || !factsCurrent) {
    disposition = 'continue-workflow';
  } else if (deriveTaskState(task).decisionStatus !== 'pending') {
    disposition = 'human-decision-recorded';
    hostAction = null;
  } else if (task.projection.currentHandoffId) {
    disposition = 'present-decision-brief';
  } else {
    disposition = 'continue-workflow';
  }

  const actionFingerprint = stableFingerprint(hostAction);
  const actionUnchanged = options.knownActionFingerprint !== undefined
    && options.knownActionFingerprint === actionFingerprint;
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'final-response-guarded' as const,
    taskId: task.taskId,
    revision: task.projection.revision,
    disposition,
    factsCurrent,
    actionFingerprint,
    actionUnchanged,
    hostAction: actionUnchanged ? null : hostAction,
    hostEnvironment: hostEnvironmentDisclosure(),
    stateWritten: false,
  };
}

export function reserveProjectedHostInput(options: {
  projectRoot: string;
  taskId: string;
  stage: 'diagnose' | 'revise-verification' | 'handoff' | 'decide' | 'resolve';
  token: string;
}): OwnedInputReservation {
  const task = loadTask(options.projectRoot, options.taskId);
  const current = currentTaskHostAction(task);
  if (!current) throw usageError('The task has no current input-bearing Host Action.');
  const candidates: Array<HostAction | NonNullable<HostAction['decisionContinuation']>> = [current];
  if (current.decisionContinuation) candidates.push(current.decisionContinuation);
  const selected = candidates.find((candidate) =>
    candidate.command?.argv[2] === options.stage);
  if (!selected?.command || !selected.inputBinding) {
    throw usageError(`The current Host Action has no ${options.stage} input binding.`);
  }
  const expectedPath = selected.inputBinding.draftPath;
  const expectedToken = /^\.stetra\/inbox\/([a-f0-9]{32,64})\.json$/.exec(expectedPath)?.[1];
  if (!expectedToken || expectedToken !== options.token) {
    throw usageError('The requested token does not match the current Host Action input binding.');
  }
  const packet = hostActionAuthoringPacket(selected);
  const document = packet?.draft;
  if (document === undefined) {
    throw new Error('The current Authoring Projection has no projected draft.');
  }
  if (packet && stableFingerprint(packet) !== selected.inputBinding.projectionFingerprint) {
    throw new Error('The current Authoring Projection does not match its projected fingerprint.');
  }
  return reserveOwnedInput(
    options.projectRoot,
    options.token,
    document,
    packet ? authoringGuide(packet) : undefined,
  );
}

function currentTaskHostAction(task: LoadedTask) {
  const contract = readContract(task);
  if (task.projection.pendingResolution) {
    const currentAttempt = task.projection.attempts.find((attempt) =>
      attempt.attemptId === task.projection.currentAttemptId)!;
    const facts = currentAttempt.factCollectionId
      ? readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId)
      : undefined;
    return resolutionHostAction(task.taskId, resolutionAuthoringPacket({
      task: task.projection,
      contract,
      ...(facts ? { facts } : {}),
    }));
  }
  if (deriveTaskState(task).decisionStatus !== 'pending') return null;
  const currentAttempt = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId)!;
  if (!currentAttempt.factCollectionId) return preparedHostAction(task.taskId);
  const facts = readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId);
  if (task.projection.currentHandoffId) {
    const handoff = readCurrentHandoff(task);
    const evaluation = readJsonArtifact<HandoffEvaluation>(
      taskArtifactPath(task.taskDirectory, handoffEvaluationPath(handoff.handoffId)),
      'handoff evaluation',
    );
    const packet = buildDecisionPacket(
      contract,
      facts,
      readEvidenceDispositions(task),
      handoff,
      evaluation,
      readHumanResolutions(task),
    );
    return handoffHostAction(
      evaluation.status,
      task.taskId,
      buildDeveloperDecisionBrief({ task: taskView(task), contract, packet, evaluation }),
      decisionAuthoringPacket({
        task: task.projection,
        contract,
        facts,
        handoff,
        evaluation,
      }),
      packet,
    );
  }
  const currentDispositionId = currentAttempt.evidenceDispositionIds.at(-1);
  const disposition = currentDispositionId
    ? readJsonArtifact<EvidenceDisposition>(
        taskArtifactPath(
          task.taskDirectory,
          evidenceDispositionPath(currentAttempt.attemptId, currentDispositionId),
        ),
        `Evidence disposition for ${currentAttempt.attemptId}`,
      )
    : undefined;
  const required = requiredChallengeObligationIds(contract, facts);
  const currentHandoffPacket = () => handoffAuthoringPacket({
    task: task.projection,
    contract,
    facts,
    requiredObligationIds: required,
  });
  if (disposition) {
    if (resolvedSemanticDispositions(task).includes(disposition.dispositionId)) {
      return diagnosisHostAction('handoff', task.taskId, currentHandoffPacket());
    }
    if (disposition.route === 'revise-verification') {
      return diagnosisHostAction(
        disposition.route,
        task.taskId,
        verificationRevisionAuthoringPacket({ task: task.projection, contract, facts }),
      );
    }
    const packet = disposition.route === 'handoff'
          ? currentHandoffPacket()
          : undefined;
    return diagnosisHostAction(disposition.route, task.taskId, packet);
  }
  return collectedHostAction({
    facts,
    taskId: task.taskId,
    diagnosisPacket: diagnosisAuthoringPacket({ task: task.projection, contract, facts }),
    handoffPacket: currentHandoffPacket(),
    timeoutRetryLimits: timeoutRetryLimits(task, facts),
  });
}

export function readDelegationTask(projectRoot: string, taskId: string): LoadedTask {
  return loadTask(projectRoot, taskId);
}

function prepareReplayResult(task: LoadedTask) {
  const contract = readContract(task);
  const baseline = readBaseline(task);
  const baselineVerification = readBaselineVerification(task);
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'prepare-replayed' as const,
    taskId: task.taskId,
    task: compactTask(task),
    summary: preparedTaskSummary(contract, baseline, baselineVerification),
    details: {
      index: explainCommand(task.taskId, 'index'),
      recommended: [
        { section: 'contract' as const, ...explainCommand(task.taskId, 'contract') },
      ],
    },
    taskCreated: false,
    replayed: true,
    hostAction: currentTaskHostAction(task),
  };
}

async function readInputDocument<Schema extends Parameters<typeof parseArtifact>[0]>(options: {
  projectRoot: string;
  pathInput: string;
  input: Readable | undefined;
  schema: Schema;
  label: string;
  retryCommand: { argv: string[] };
  currentBinding?: {
    taskId: string;
    stage: 'diagnose' | 'revise-verification' | 'handoff' | 'decide' | 'resolve';
  };
  onOwnedClaim?: (claim: OwnedInputClaim) => void;
}): Promise<ReturnType<typeof parseArtifact<Schema>>> {
  const { projectRoot, pathInput, input, schema, label } = options;
  if (options.currentBinding) {
    assertCurrentOwnedInputBinding({
      projectRoot,
      inputPath: pathInput,
      ...options.currentBinding,
    });
  }
  const ownedClaim = pathInput === '-'
    ? undefined
    : claimOwnedInput(projectRoot, pathInput, label);
  const sourceLabel = pathInput === '-'
    ? 'stdin'
    : ownedClaim === undefined
      ? safeInputPath(projectRoot, pathInput, label)
      : pathInput;
  let text: string;
  try {
    text = pathInput === '-'
      ? await readUtf8Stream(input ?? process.stdin)
      : ownedClaim?.text ?? readFileSync(sourceLabel, 'utf8');
  } catch (error) {
    throw inputError(`Failed to read ${label} from ${sourceLabel}.`, error);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const issue = {
      code: 'invalid-json',
      path: '$',
      message: `${label} is not valid JSON.`,
      remediation: 'Correct the JSON syntax without changing the projected input identity.',
    };
    throw attachProtocolInputCorrection(
      inputError(`${label} from ${sourceLabel} is not valid JSON.`, error, [issue]),
      {
        label,
        source: pathInput === '-'
          ? { transport: 'stdin' }
          : { transport: 'file', path: sourceLabel },
        submittedRawJson: text,
        ...reissueCorrectionInput(projectRoot, ownedClaim, options.retryCommand),
      },
    );
  }
  try {
    const parsed = parseArtifact(schema, value, label) as ReturnType<typeof parseArtifact<Schema>>;
    if (ownedClaim) options.onOwnedClaim?.(ownedClaim);
    return parsed;
  } catch (error) {
    throw attachProtocolInputCorrection(error, {
      label,
      source: pathInput === '-'
        ? { transport: 'stdin' }
        : { transport: 'file', path: sourceLabel },
      submittedDocument: value,
      ...reissueCorrectionInput(projectRoot, ownedClaim, options.retryCommand),
    });
  }
}

function assertCurrentOwnedInputBinding(input: {
  projectRoot: string;
  taskId: string;
  stage: 'diagnose' | 'revise-verification' | 'handoff' | 'decide' | 'resolve';
  inputPath: string;
}): void {
  if (input.inputPath === '-' || !input.inputPath.replaceAll('\\', '/').startsWith('.stetra/inbox/')) {
    return;
  }
  const task = loadTask(input.projectRoot, input.taskId);
  const current = currentTaskHostAction(task);
  if (!current) throw usageError('The task has no current input-bearing Host Action.');
  const candidates: Array<HostAction | NonNullable<HostAction['decisionContinuation']>> = [current];
  if (current.decisionContinuation) candidates.push(current.decisionContinuation);
  const selected = candidates.find((candidate) => candidate.command?.argv[2] === input.stage);
  if (!selected?.inputBinding || selected.inputBinding.draftPath !== input.inputPath) {
    throw usageError(
      `The owned input is not the current ${input.stage} Authoring Projection for task ${input.taskId}.`,
    );
  }
  const packet = hostActionAuthoringPacket(selected);
  if (!packet || stableFingerprint(packet) !== selected.inputBinding.projectionFingerprint) {
    throw new Error('The current Authoring Projection does not match its projected fingerprint.');
  }
}

async function recoverOwnedInputOnFailure<T>(
  input: {
    projectRoot: string;
    claim: OwnedInputClaim | undefined;
    retryCommand: { argv: string[] };
  },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!input.claim) throw error;
    const retry = reissueCorrectionInput(
      input.projectRoot,
      input.claim,
      input.retryCommand,
    ).retry;
    throw retry ? attachProtocolInputRetry(error, retry) : error;
  }
}

function reissueCorrectionInput(
  projectRoot: string,
  claim: OwnedInputClaim | undefined,
  command: { argv: string[] },
) {
  if (!claim) return {};
  const reservation = reissueOwnedInput(projectRoot, claim);
  return {
    retry: inputRetry(reservation, command),
  };
}

function reissuePrepareInput(
  projectRoot: string,
  claim: OwnedInputClaim,
  prepareRequestId: string,
  inputPath: string,
) {
  const reservation = reissueOwnedInput(projectRoot, claim);
  return {
    reservation,
    retry: inputRetry(reservation, {
      argv: [
        'stetra', 'change', 'prepare', '.',
        '--prepare-request', prepareRequestId,
        '--input', inputPath, '--json',
      ],
    }),
  };
}

function inputRetry(
  reservation: OwnedInputReservation,
  command: { argv: string[] },
) {
  return {
    transport: 'owned-file' as const,
    path: reservation.path,
    ...(reservation.guide ? { guidePath: reservation.guide.path } : {}),
    inputReissued: true as const,
    command,
  };
}

function safeInputPath(projectRoot: string, input: string, label: string): string {
  const path = resolve(input);
  const canonical = existsSync(path) ? realpathSync(path) : path;
  const rel = relative(projectRoot, canonical);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) {
    throw inputError(`${label} must not be stored inside the project worktree; use stdin or a file outside it.`);
  }
  return canonical;
}

async function readUtf8Stream(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

function readContract(task: LoadedTask): TaskContract {
  const contract = readJsonArtifact<TaskContract>(
    taskArtifactPath(task.taskDirectory, contractPath(task.projection.contractRevision)),
    'Task Contract',
  );
  if (contract.protocol !== DELEGATION_PROTOCOL
    || contract.schemaVersion !== DELEGATION_SCHEMA_VERSION
    || contract.semanticContractId !== task.projection.semanticContractId
    || contract.verificationPlanId !== task.projection.verificationPlanId
    || contract.effectiveContractId !== task.projection.effectiveContractId) {
    throw new Error('Stored Task Contract identity is invalid.');
  }
  assertStoredContractFingerprints(contract);
  return contract;
}

function readBaseline(task: LoadedTask): WorktreeSnapshot {
  const baseline = readJsonArtifact<WorktreeSnapshot>(
    taskArtifactPath(task.taskDirectory, baselinePath(task.projection.contractRevision)),
    'task baseline',
  );
  assertWorktreeSnapshot(baseline, 'task baseline');
  return baseline;
}

function readBaselineVerification(task: LoadedTask): BaselineVerificationFact {
  const baseline = readJsonArtifact<BaselineVerificationFact>(
    taskArtifactPath(task.taskDirectory, baselineVerificationPath(task.projection.contractRevision)),
    'baseline verification',
  );
  const { fingerprint: _ignored, ...projection } = baseline;
  if (baseline.fingerprint !== stableFingerprint(projection)) {
    throw new Error('Stored baseline verification changed after preparation.');
  }
  return baseline;
}

function readCurrentFacts(task: LoadedTask): FactBundle {
  const attempt = task.projection.attempts.find((candidate) =>
    candidate.attemptId === task.projection.currentAttemptId);
  if (!attempt?.factCollectionId) {
    throw usageError(`Task ${task.taskId} has no facts for its current Attempt.`);
  }
  const facts = readFacts(task, attempt.attemptId, attempt.factCollectionId);
  assertFactBundleIdentity(facts, attempt.effectiveContractId, attempt.attemptId);
  return facts;
}

function readFacts(task: LoadedTask, attemptId: string, collectionId: string): FactBundle {
  return readJsonArtifact<FactBundle>(
    taskArtifactPath(task.taskDirectory, factsPath(attemptId, collectionId)),
    `Fact Bundle ${collectionId}`,
  );
}

function readAttemptFactsIfPresent(task: LoadedTask, attemptId: string): FactBundle | undefined {
  const attempt = task.projection.attempts.find((candidate) => candidate.attemptId === attemptId);
  return attempt?.factCollectionId ? readFacts(task, attemptId, attempt.factCollectionId) : undefined;
}

function readVerificationRevisions(task: LoadedTask): unknown[] {
  return task.projection.verificationRevisionIds.map((id) =>
    readJsonArtifact(
      taskArtifactPath(task.taskDirectory, verificationRevisionPath(id)),
      `Verification Revision ${id}`,
    ));
}

function readEvidenceDispositions(task: LoadedTask): EvidenceDisposition[] {
  return task.projection.attempts.flatMap((attempt) =>
    attempt.evidenceDispositionIds.map((id, index) =>
      readJsonArtifact<EvidenceDisposition>(
        taskArtifactPath(task.taskDirectory, evidenceDispositionPath(attempt.attemptId, id)),
        `Evidence disposition ${index + 1} for ${attempt.attemptId}`,
      )));
}

function readCurrentEvidenceDisposition(task: LoadedTask): EvidenceDisposition | undefined {
  const current = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId);
  const currentId = current?.evidenceDispositionIds.at(-1);
  if (!current || !currentId) return undefined;
  return readJsonArtifact<EvidenceDisposition>(
    taskArtifactPath(task.taskDirectory, evidenceDispositionPath(current.attemptId, currentId)),
    `Evidence disposition for ${task.projection.currentAttemptId}`,
  );
}

function readCurrentHandoff(task: LoadedTask): CognitiveHandoff {
  if (!task.projection.currentHandoffId) throw usageError('Task has no evaluated Cognitive Handoff.');
  const handoff = readJsonArtifact<CognitiveHandoff>(
    taskArtifactPath(task.taskDirectory, handoffPath(task.projection.currentHandoffId)),
    'Cognitive Handoff',
  );
  return handoff;
}

function materializeHandoff(
  source: CognitiveHandoffDocument,
  contract: TaskContract,
  facts: FactBundle,
): CognitiveHandoff {
  const conditionByKey = new Map(contract.adoptionConditions.map((condition) =>
    [condition.key, condition] as const));
  const obligationByKey = new Map(contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      `${condition.key}\u0000${obligation.key}`,
      obligation,
    ] as const)));
  const conditionId = (key: string, path: string) => {
    const condition = conditionByKey.get(key);
    if (!condition) throw inputError(`${path} references unknown Condition key ${key}.`);
    return condition.id;
  };
  const obligationId = (conditionKey: string, obligationKey: string, path: string) => {
    const obligation = obligationByKey.get(`${conditionKey}\u0000${obligationKey}`);
    if (!obligation) {
      throw inputError(`${path} references unknown Evidence Obligation key ${conditionKey}/${obligationKey}.`);
    }
    return obligation.id;
  };
  const evidenceReference = (
    reference: CognitiveHandoffDocument['conditions'][number]['obligations'][number]['evidence'][number],
    path: string,
  ): CognitiveHandoff['obligationConclusions'][number]['evidence'][number] => {
    if (reference.kind === 'patch') return reference;
    if (reference.kind === 'changed-file') {
      const file = facts.changedFiles.find((item) => item.path === reference.path);
      if (!file) throw inputError(`${path} references unknown changed file ${reference.path}.`);
      return { kind: 'changed-file', id: file.id };
    }
    if (reference.kind === 'check') {
      if (contract.verificationPlan.mode !== 'checks') {
        throw inputError(`${path} references Check ${reference.key}, but this contract has no checks.`);
      }
      const definition = contract.verificationPlan.definitions.find((item) => item.key === reference.key);
      if (!definition) throw inputError(`${path} references unknown Check key ${reference.key}.`);
      return { kind: 'check', id: definition.definitionId };
    }
    return reference;
  };
  const evidenceReferences = (
    references: CognitiveHandoffDocument['conditions'][number]['obligations'][number]['evidence'],
    path: string,
  ) => references.map((reference, index) => evidenceReference(reference, `${path}[${index}]`));
  const reviewDecisionIdByKey = new Map<string, string>();
  const reviewDecisions: CognitiveHandoff['reviewDecisions'] = source.reviewDecisions.map(
    (decision, index) => {
      if (reviewDecisionIdByKey.has(decision.key)) {
        throw inputError(`reviewDecisions[${index}].key duplicates Review Decision key ${decision.key}.`);
      }
      const id = `review-decision:${randomUUID()}`;
      reviewDecisionIdByKey.set(decision.key, id);
      return {
        id,
        conditionIds: decision.conditionKeys.map((key) =>
          conditionId(key, `reviewDecisions[${index}].conditionKeys`)),
        obligationIds: decision.obligationKeys.map((key) => obligationId(
          key.conditionKey,
          key.obligationKey,
          `reviewDecisions[${index}].obligationKeys`,
        )),
        question: decision.question,
        adoptionImpact: decision.adoptionImpact,
        nextAction: decision.nextAction,
        evidence: evidenceReferences(decision.evidence, `reviewDecisions[${index}].evidence`),
      };
    },
  );
  const reviewDecisionIds = (keys: string[], path: string): string[] => keys.map((key) => {
    const id = reviewDecisionIdByKey.get(key);
    if (!id) throw inputError(`${path} references unknown Review Decision key ${key}.`);
    return id;
  });
  const conditionConclusions = source.conditions.map((condition, index) => ({
    conditionId: conditionId(condition.conditionKey, `conditions[${index}]`),
    status: condition.status,
    summary: condition.summary,
    reviewDecisionIds: reviewDecisionIds(
      condition.reviewDecisionKeys,
      `conditions[${index}].reviewDecisionKeys`,
    ),
  }));
  const obligationConclusions = source.conditions.flatMap((condition, conditionIndex) =>
    condition.obligations.map((finding, obligationIndex) => ({
      obligationId: obligationId(
        condition.conditionKey,
        finding.obligationKey,
        `conditions[${conditionIndex}].obligations[${obligationIndex}]`,
      ),
      status: finding.status,
      reviewDecisionIds: reviewDecisionIds(
        finding.reviewDecisionKeys,
        `conditions[${conditionIndex}].obligations[${obligationIndex}].reviewDecisionKeys`,
      ),
      evidence: evidenceReferences(
        finding.evidence,
        `conditions[${conditionIndex}].obligations[${obligationIndex}].evidence`,
      ),
      evidenceCoverage: finding.evidenceCoverage,
      falsification: finding.falsification,
      counterEvidence: evidenceReferences(
        finding.counterEvidence,
        `conditions[${conditionIndex}].obligations[${obligationIndex}].counterEvidence`,
      ),
      conclusion: finding.conclusion,
    })));
  const residualUnknowns = source.residualUnknowns.map((unknown, index) => {
    const target = unknown.target.kind === 'task'
      ? { kind: 'task' as const }
      : unknown.target.kind === 'condition'
        ? {
            kind: 'condition' as const,
            conditionId: conditionId(
              unknown.target.conditionKey,
              `residualUnknowns[${index}].target.conditionKey`,
            ),
          }
        : {
            kind: 'obligation' as const,
            conditionId: conditionId(
              unknown.target.conditionKey,
              `residualUnknowns[${index}].target.conditionKey`,
            ),
            obligationId: obligationId(
              unknown.target.conditionKey,
              unknown.target.obligationKey,
              `residualUnknowns[${index}].target.obligationKey`,
            ),
          };
    const evidence = evidenceReferences(unknown.evidence, `residualUnknowns[${index}].evidence`);
    return {
      target,
      statement: unknown.statement,
      evidence,
      reviewDecisionIds: reviewDecisionIds(
        unknown.reviewDecisionKeys,
        `residualUnknowns[${index}].reviewDecisionKeys`,
      ),
    };
  });
  const projection = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    handoffId: `handoff:${randomUUID()}`,
    actualChange: source.actualChange,
    obligationConclusions,
    conditionConclusions,
    residualUnknowns,
    reviewDecisions,
    recommendation: source.recommendation,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
  };
  return { ...projection, handoffFingerprint: stableFingerprint(projection) };
}

function materializeDecision(
  source: HumanDecisionDocument,
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
): HumanDecision {
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    decisionId: `decision:${randomUUID()}`,
    humanEvent: {
      id: generatedHumanEventId(source.humanEvent, source.action === 'correction-requested'
        ? 'correction' : 'decision'),
      kind: source.action === 'correction-requested' ? 'correction' as const : 'decision' as const,
      ...source.humanEvent,
      contentFingerprint: sha256(source.humanEvent.content),
    },
    interpretation: {
      basisHumanEventId: generatedHumanEventId(source.humanEvent, source.action === 'correction-requested'
        ? 'correction' : 'decision'),
      action: source.action,
      reason: source.reason,
      exceptions: source.exceptions,
    },
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    handoffId: handoff.handoffId,
    handoffFingerprint: handoff.handoffFingerprint,
  };
}

function buildDecisionPacket(
  contract: TaskContract,
  facts: FactBundle,
  evidenceDispositions: EvidenceDisposition[],
  handoff: CognitiveHandoff,
  evaluation: HandoffEvaluation,
  resolutions: HumanResolution[],
  decision?: HumanDecision,
): DecisionPacket {
  const comparisonByDefinition = new Map(facts.checkComparisons.map((item) =>
    [item.definitionId, item.relation]));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    humanEvents: contract.humanEvents,
    semanticContract: {
      semanticContractId: contract.semanticContractId,
      effectiveContractId: contract.effectiveContractId,
      desiredOutcome: contract.understanding.desiredOutcome.value,
      constraints: contract.understanding.constraints.map((item) => item.value),
      nonGoals: contract.understanding.nonGoals.map((item) => item.value),
      focusPaths: contract.understanding.focus.map((item) => item.value),
    },
    decision: {
      recommendation: handoff.recommendation,
      adoption: evaluation.adoption,
      resolutions,
      ...(decision ? { humanDecision: decision } : {}),
    },
    actualChange: handoff.actualChange,
    residualUnknowns: handoff.residualUnknowns,
    conditions: contract.adoptionConditions.map((condition) => ({
      id: condition.id,
      key: condition.key,
      statement: condition.statement,
      criticality: condition.criticality,
      agentFinding: handoff.conditionConclusions.find((item) =>
        item.conditionId === condition.id)!,
      obligations: condition.evidenceObligations.map((obligation) => ({
        id: obligation.id,
        key: obligation.key,
        statement: obligation.statement,
        falsification: obligation.falsification,
        agentFinding: handoff.obligationConclusions.find((item) =>
          item.obligationId === obligation.id)!,
        evidencePath: evaluation.evidencePaths.find((item) =>
          item.obligationId === obligation.id)!,
      })),
    })),
    attention: evaluation.attention,
    reviewDecisions: handoff.reviewDecisions,
    runtimeFacts: {
      attemptId: facts.attemptId,
      factCollectionId: facts.factCollectionId,
      changeFingerprint: facts.changeFingerprint,
      changedFiles: facts.changedFiles.map((file) => ({
        id: file.id,
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        operation: file.operation,
        representation: file.representation,
      })),
      checks: facts.checks.map((check) => ({
        verifierId: check.verifierId,
        definitionId: check.definitionId,
        argv: check.assertionArgv,
        latestAttempt: latestCheckAttempt(check),
        attemptCount: check.attempts.length,
        baselineRelation: comparisonByDefinition.get(check.definitionId)!,
      })),
      verifierMutations: facts.verifierMutations,
      checkInducedChanges: facts.checkInducedChanges.map((file) => ({
        id: file.id, path: file.path, operation: file.operation,
      })),
    },
    evidenceJudgments: {
      dispositions: evidenceDispositions.map((disposition) => ({
        dispositionId: disposition.dispositionId,
        attemptId: disposition.attemptId,
        semanticImpact: disposition.semanticImpact,
        proposedRoute: disposition.proposedRoute,
        routeRationale: disposition.routeRationale,
        route: disposition.route,
        entries: disposition.entries,
      })),
    },
    detailSections: ['contract', 'attempts', 'handoff', 'events'],
  };
}

async function staleHandoffResult(
  task: LoadedTask,
  facts: FactBundle,
  currentFingerprint: string,
) {
  const evaluation = evaluateHandoff({
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    contract: readContract(task),
    factBundle: facts,
    currentWorktreeFingerprint: currentFingerprint,
    currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
    deliveryExhausted: deriveTaskState(task).deliveryStatus === 'exhausted',
    verificationRevised: task.projection.verificationRevisionIds.length > 0,
    handoff: {} as CognitiveHandoff,
  });
  return {
    protocol: evaluation.protocol,
    schemaVersion: evaluation.schemaVersion,
    status: evaluation.status,
    taskId: task.taskId,
    attemptId: evaluation.attemptId,
    factCollectionId: evaluation.factCollectionId,
    summary: { attentionCount: evaluation.attention.length },
    stateWritten: false,
    hostAction: staleFactsHostAction(task.taskId),
  };
}

async function currentFactsAreStale(task: LoadedTask, facts: FactBundle): Promise<boolean> {
  const current = await captureGitWorktree(task.projectRoot, {
    objectDirectory: taskArtifactPath(task.taskDirectory, WORKTREE_OBJECTS_DIRECTORY),
  });
  if (current.fingerprint !== facts.current.fingerprint) return true;
  const contract = readContract(task);
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  const currentExecutionInputs = captureVerificationInputs(task.projectRoot, definitions);
  return verificationInputSetFingerprint(currentExecutionInputs)
    !== verificationInputSetFingerprint(facts.currentExecutionInputs);
}

function assertTaskOpenForCollection(task: LoadedTask): void {
  if (task.projection.pendingResolution) {
    throw usageError(`Task ${task.taskId} requires an exact Human resolution before collection.`);
  }
  if (deriveTaskState(task).decisionStatus !== 'pending') {
    throw usageError(`Task ${task.taskId} is already ${deriveTaskState(task).decisionStatus}.`);
  }
  if (deriveTaskState(task).deliveryStatus === 'exhausted') {
    throw usageError(`Task ${task.taskId} exhausted its repair route.`);
  }
}

function validateCollectionOptions(
  definitions: VerificationDefinition[],
  retries: CheckTimeoutRetry[],
  timeoutMs: number | undefined,
  refresh: boolean,
): void {
  if (refresh && retries.length) {
    throw usageError('Use --refresh for a full collection or --retry-check for timeout recovery, not both.');
  }
  if (retries.length && timeoutMs !== undefined) {
    throw usageError('Use --timeout-ms for full collection or --retry-check for timeout recovery, not both.');
  }
  if (timeoutMs !== undefined) assertCheckTimeout(timeoutMs, 'Collection timeout');
  if (timeoutMs !== undefined && !definitions.length) {
    throw usageError('--timeout-ms applies only when frozen checks exist.');
  }
}

function validateTimeoutRetries(
  retries: CheckTimeoutRetry[],
  definitions: Extract<TaskContract['verificationPlan'], { mode: 'checks' }>['definitions'],
  previousChecks: CheckFact[],
  task: LoadedTask,
) {
  const definitionsById = new Map(definitions.map((definition) =>
    [definition.definitionId, definition]));
  const previousById = new Map(previousChecks.map((check) =>
    [check.definitionId, check]));
  const requested = new Set<string>();
  return retries.map((retry) => {
    if (requested.has(retry.checkId)) throw usageError(`Duplicate retry for ${retry.checkId}.`);
    requested.add(retry.checkId);
    const definition = definitionsById.get(retry.checkId);
    const previous = previousById.get(retry.checkId);
    if (!definition || !previous) throw usageError(`Unknown frozen check ${retry.checkId}.`);
    assertCheckTimeout(retry.timeoutMs, `Retry timeout for ${retry.checkId}`);
    const latest = latestCheckAttempt(previous);
    if (latest.termination.kind !== 'timeout' || latest.status !== 'unavailable') {
      throw usageError(`Check ${retry.checkId} can retry only after its latest attempt timed out.`);
    }
    if (retry.timeoutMs <= latest.timeoutMs) {
      throw usageError(`Retry timeout for ${retry.checkId} must exceed ${latest.timeoutMs} ms.`);
    }
    const policy = task.projection.executionBudget.timeoutRetry;
    if (policy.mode === 'disabled') {
      throw usageError('Timeout retries are disabled by the prepared task execution budget.');
    }
    if (taskTimeoutRetryCount(task, definition.verifierId) >= policy.maxRetriesPerVerifier) {
      throw usageError(`Logical verifier ${definition.verifierId} exhausted its task-wide timeout retry budget.`);
    }
    if (retry.timeoutMs > policy.maxTimeoutMs) {
      throw usageError(
        `Retry timeout for ${retry.checkId} must not exceed the task-wide maximum ${policy.maxTimeoutMs} ms.`,
      );
    }
    return { definition, previous, timeoutMs: retry.timeoutMs };
  });
}

function timeoutRetryLimits(task: LoadedTask, facts: FactBundle): Map<string, number> {
  const policy = task.projection.executionBudget.timeoutRetry;
  if (policy.mode === 'disabled') return new Map();
  return new Map(facts.checks.flatMap((check) => {
    const latest = latestCheckAttempt(check);
    if (
      latest.termination.kind !== 'timeout'
      || latest.status !== 'unavailable'
      || latest.timeoutMs >= policy.maxTimeoutMs
      || taskTimeoutRetryCount(task, check.verifierId) >= policy.maxRetriesPerVerifier
    ) return [];
    return [[check.definitionId, policy.maxTimeoutMs] as const];
  }));
}

function taskTimeoutRetryCount(task: LoadedTask, verifierId: string): number {
  return task.projection.timeoutRetryUsage.find((item) => item.verifierId === verifierId)?.count ?? 0;
}

function incrementTimeoutRetryUsage(
  current: TaskProjection['timeoutRetryUsage'],
  verifierIds: string[],
): TaskProjection['timeoutRetryUsage'] {
  if (!verifierIds.length) return current;
  const counts = new Map(current.map((item) => [item.verifierId, item.count]));
  for (const verifierId of verifierIds) {
    counts.set(verifierId, (counts.get(verifierId) ?? 0) + 1);
  }
  return [...counts].map(([verifierId, count]) => ({ verifierId, count }))
    .sort((left, right) => left.verifierId.localeCompare(right.verifierId));
}

function assertCheckTimeout(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw usageError(`${label} must be a positive safe integer.`);
}

function assertFactBundleIdentity(bundle: FactBundle, effectiveContractId: string, attemptId: string): void {
  if (bundle.effectiveContractId !== effectiveContractId || bundle.attemptId !== attemptId) {
    throw new Error('Fact Bundle is bound to another contract or Attempt.');
  }
  const { factCollectionId: _collection, ...base } = bundle;
  if (bundle.factCollectionId !== factCollectionId(base)) {
    throw new Error('Collected machine facts changed after collection.');
  }
}

function factCollectionId(bundle: Omit<FactBundle, 'factCollectionId'>): string {
  return stableFingerprint({
    protocol: bundle.protocol,
    schemaVersion: bundle.schemaVersion,
    effectiveContractId: bundle.effectiveContractId,
    attemptId: bundle.attemptId,
    baseline: bundle.baseline,
    preCheck: bundle.preCheck,
    current: bundle.current,
    preCheckExecutionInputs: bundle.preCheckExecutionInputs,
    currentExecutionInputs: bundle.currentExecutionInputs,
    baselineVerification: bundle.baselineVerification,
    changeFingerprint: bundle.changeFingerprint,
    changedFiles: bundle.changedFiles,
    checkInducedChanges: bundle.checkInducedChanges,
    checks: bundle.checks,
    checkComparisons: bundle.checkComparisons,
    evidenceConcerns: bundle.evidenceConcerns,
    verifierMutations: bundle.verifierMutations,
    environment: bundle.environment,
    patch: bundle.patch ?? null,
    provenance: bundle.provenance,
  });
}

function collectVerifierMutations(
  contract: TaskContract,
  files: FactBundle['changedFiles'],
): VerifierMutation[] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  return contract.verificationPlan.definitions.flatMap((check) =>
    check.verifierRefs.flatMap((reference) => {
      return files.flatMap((file) => {
        const matchedBy = selectorMatch(reference, file);
        return matchedBy ? [{
          verifierId: check.verifierId,
          definitionId: check.definitionId,
          selector: reference,
          changedFileId: file.id,
          changedPath: file.path,
          matchedBy,
        }] : [];
      });
    })).sort(verifierMutationOrder);
}

function selectorMatch(
  selector: VerifierRef,
  file: FactBundle['changedFiles'][number],
): VerifierMutation['matchedBy'] | undefined {
  if (pathMatchesSelector(file.path, selector)) return 'current-path';
  if (file.previousPath && pathMatchesSelector(file.previousPath, selector)) return 'previous-path';
  return undefined;
}

function pathMatchesSelector(
  path: string,
  selector: { kind: 'file' | 'tree'; path: string },
): boolean {
  return selector.kind === 'file'
    ? path === selector.path
    : path === selector.path || path.startsWith(`${selector.path}/`);
}

function verifierMutationOrder(left: VerifierMutation, right: VerifierMutation): number {
  return left.definitionId.localeCompare(right.definitionId)
    || left.selector.role.localeCompare(right.selector.role)
    || left.selector.kind.localeCompare(right.selector.kind)
    || left.selector.path.localeCompare(right.selector.path)
    || left.changedPath.localeCompare(right.changedPath)
    || left.changedFileId.localeCompare(right.changedFileId);
}

function compareChecksToBaseline(
  baseline: BaselineVerificationFact,
  checks: CheckFact[],
): FactBundle['checkComparisons'] {
  return checks.map((check) => {
    const baselineCheck = baseline.checks.find((item) =>
      item.definitionId === check.definitionId);
    if (baselineCheck?.mode === 'unknown-after-revision') {
      return {
        definitionId: check.definitionId,
        relation: 'baseline-unknown-after-revision' as const,
      };
    }
    if (!baselineCheck || baselineCheck.mode === 'unknown' || !baselineCheck.observation) {
      return { definitionId: check.definitionId, relation: 'baseline-unknown' as const };
    }
    const before = latestCheckAttempt(baselineCheck.observation).status;
    const current = latestCheckAttempt(check).status;
    return {
      definitionId: check.definitionId,
      relation: `${before}-before-${current}-now` as CheckBaselineRelation,
    };
  });
}

function collectCheckEvidenceConcerns(
  contract: TaskContract,
  baseline: BaselineVerificationFact,
  checks: CheckFact[],
): FactBundle['evidenceConcerns'] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  return contract.verificationPlan.definitions.flatMap((definition) => {
    const concerns: FactBundle['evidenceConcerns'] = [];
    const current = checks.find((item) => item.definitionId === definition.definitionId)!;
    if (latestCheckAttempt(current).status !== 'passed') {
      concerns.push({
        kind: 'check',
        definitionId: definition.definitionId,
        observation: 'current-nonpassing',
      });
    }
    if (definition.baseline.mode === 'task-start') {
      const observedBaseline = baseline.checks.find((item) =>
        item.definitionId === definition.definitionId);
      if (observedBaseline
        && ['task-start', 'isolated-original'].includes(observedBaseline.mode)
        && observedBaseline.observation
        && (latestCheckAttempt(observedBaseline.observation).status
            !== definition.baseline.expectation.baselineStatus
          || latestCheckAttempt(current).status
            !== definition.baseline.expectation.currentStatus)) {
        concerns.push({
          kind: 'check',
          definitionId: definition.definitionId,
          observation: 'baseline-expectation-mismatch',
        });
      }
    }
    return concerns;
  });
}

function validateEvidenceDispositionInput(
  source: EvidenceDispositionDocument,
  contract: TaskContract,
  facts: FactBundle,
): void {
  const expected = facts.evidenceConcerns.map(evidenceConcernIdentity).sort();
  const selected = source.entries.map((entry) => evidenceConcernIdentity(entry.source)).sort();
  if (new Set(selected).size !== selected.length
    || selected.length !== expected.length
    || selected.some((id, index) => id !== expected[index])) {
    throw inputError('Evidence disposition must diagnose every current mechanical Check concern exactly once.');
  }
  const availableChecks = new Set(
    contract.verificationPlan.mode === 'checks'
      ? contract.verificationPlan.definitions.map((check) => check.definitionId) : [],
  );
  for (const [index, entry] of source.entries.entries()) {
    if (!availableChecks.has(entry.source.definitionId)) {
      throw inputError(`Unknown frozen check ${JSON.stringify(entry.source.definitionId)} in evidence disposition.`);
    }
    if (entry.source.observation === 'baseline-expectation-mismatch'
      && entry.cause === 'implementation') {
      throw inputError(
        'A baseline expectation mismatch cannot be classified or routed as a production implementation repair.',
      );
    }
  }
  const hasRepositoryRepair = source.entries.some((entry) =>
    entry.repositoryChange.surface !== 'none');
  if (source.action.kind === 'repair-delivery' && !hasRepositoryRepair) {
    throw inputError('Delivery repair requires at least one explicit production or verification-surface change.');
  }
}

function materializeDiagnosisEntry(
  entry: EvidenceDispositionDocument['entries'][number],
): EvidenceDisposition['entries'][number] {
  const repositoryChange = entry.repositoryChange;
  const repositoryChangeCanAlterObservation = repositoryChange.surface !== 'none';
  return {
    source: entry.source,
    cause: entry.cause,
    diagnosis: entry.diagnosis,
    falsificationAttempt: entry.falsificationAttempt,
    repositoryChangeCanAlterObservation,
    changeSurface: repositoryChange.surface,
    expectedDifferentObservation: entry.expectedDifferentObservation,
    intendedChanges: repositoryChange.surface !== 'none'
      ? repositoryChange.intendedChanges
      : [],
  };
}

function evidenceConcernIdentity(source: EvidenceDispositionDocument['entries'][number]['source']): string {
  return `check:${source.definitionId}:${source.observation}`;
}

function requiredChallengeObligationIds(contract: TaskContract, facts: FactBundle): string[] {
  const changedAcceptanceVerifiers = new Set(facts.verifierMutations
    .filter((item) => item.selector.role === 'acceptance-surface')
    .map((item) => item.verifierId));
  return unique(contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.flatMap((obligation) => {
      const challengePolicies = obligation.strategies.filter((strategy) =>
        strategy.kind === 'independent-challenge');
      if (challengePolicies.some((strategy) => strategy.policy === 'required')) {
        return [obligation.id];
      }
      const factTriggered = challengePolicies.some((strategy) =>
        strategy.policy === 'fact-triggered');
      const ownVerifierChanged = obligation.strategies.some((strategy) =>
        strategy.kind === 'runtime-check'
        && strategy.verifierIds.some((id) => changedAcceptanceVerifiers.has(id)));
      return factTriggered && ownVerifierChanged ? [obligation.id] : [];
    }))).sort();
}

function attemptOutcomeFingerprint(facts: FactBundle): string {
  return stableFingerprint({
    changeFingerprint: facts.changeFingerprint,
    checks: facts.checks.map((check) => {
      const latest = latestCheckAttempt(check);
      return {
        definitionId: check.definitionId,
        status: latest.status,
        termination: latest.termination,
        outcomeFingerprint: latest.outcomeFingerprint,
      };
    }),
  });
}

function latestCheckAttempt(check: CheckFact): CheckFact['attempts'][number] {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return latest;
}

function deriveTaskState(task: LoadedTask): DerivedTaskState {
  const attempt = task.projection.attempts.find((candidate) =>
    candidate.attemptId === task.projection.currentAttemptId)!;
  const repairCount = task.projection.attempts.filter((candidate) =>
    candidate.trigger === 'delivery-repair').length;
  const disposition = attempt.factCollectionId
    ? readCurrentEvidenceDisposition(task)
    : undefined;
  const deliveryStatus: DerivedTaskState['deliveryStatus'] = !attempt.factCollectionId
    ? attempt.trigger === 'delivery-repair' || attempt.trigger === 'correction'
      ? 'repairing'
      : 'waiting-for-implementation'
    : disposition?.proposedRoute === 'repair-delivery' && disposition.route === 'handoff'
      ? 'exhausted'
      : 'implementation-complete';
  let decisionStatus: DerivedTaskState['decisionStatus'] = 'pending';
  if (task.projection.decisionId) {
    decisionStatus = readJsonArtifact<HumanDecision>(
      taskArtifactPath(task.taskDirectory, decisionPath(task.projection.decisionId)),
      'Human Decision',
    ).interpretation.action;
  } else if (task.projection.humanResolutionIds.some((resolutionId) => {
    const resolution = readJsonArtifact<{ interpretation?: { action?: string } }>(
      taskArtifactPath(task.taskDirectory, resolutionPath(resolutionId)),
      `Human Resolution ${resolutionId}`,
    );
    return resolution.interpretation?.action === 'abort';
  })) {
    decisionStatus = 'aborted';
  }
  let evidenceStatus: DerivedTaskState['evidenceStatus'] = 'not-collected';
  if (task.projection.currentHandoffId) {
    evidenceStatus = readJsonArtifact<HandoffEvaluation>(
      taskArtifactPath(
        task.taskDirectory,
        handoffEvaluationPath(task.projection.currentHandoffId),
      ),
      'Handoff Evaluation',
    ).status;
  } else if (attempt.factCollectionId) {
    const facts = readFacts(task, attempt.attemptId, attempt.factCollectionId);
    const hasConcern = facts.evidenceConcerns.length > 0;
    evidenceStatus = hasConcern && !disposition
      ? 'awaiting-evidence-judgment'
      : 'incomplete';
  }
  return { deliveryStatus, evidenceStatus, decisionStatus, repairCount };
}

function taskView(task: LoadedTask): TaskProjection & DerivedTaskState {
  return { ...task.projection, ...deriveTaskState(task) };
}

function compactTask(task: LoadedTask) {
  const state = deriveTaskState(task);
  return {
    revision: task.projection.revision,
    ...state,
    currentAttemptId: task.projection.currentAttemptId,
  };
}

function clearPostCollectionArtifacts(projection: TaskProjection): TaskProjection {
  const {
    currentHandoffId: _handoff,
    decisionId: _decision,
    ...remaining
  } = projection;
  return remaining;
}

function factLogPaths(facts: FactBundle): string[] {
  return unique(facts.checks.flatMap((check) => check.attempts.flatMap((attempt) => [
    attempt.stdout.logPath,
    attempt.stderr.logPath,
  ].filter((path): path is string => Boolean(path)))));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function materializeResolution(
  source: HumanResolutionDocument,
  contract: TaskContract,
) {
  const kind = source.target.kind === 'correction' || source.action === 'request-correction'
    ? 'correction' as const : 'exception' as const;
  const humanEvent = {
    id: generatedHumanEventId(source.humanEvent, kind),
    kind,
    ...source.humanEvent,
    contentFingerprint: sha256(source.humanEvent.content),
  };
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    resolutionId: `resolution:${randomUUID()}`,
    effectiveContractId: contract.effectiveContractId,
    humanEvent,
    interpretation: {
      basisHumanEventId: humanEvent.id,
      target: source.target,
      action: source.action,
      reason: source.reason,
    },
  };
}

function readHumanResolutions(task: LoadedTask): HumanResolution[] {
  return task.projection.humanResolutionIds.map((resolutionId) =>
    readJsonArtifact<HumanResolution>(
      taskArtifactPath(task.taskDirectory, resolutionPath(resolutionId)),
      `Human Resolution ${resolutionId}`,
    ));
}

function resolvedSemanticDispositions(task: LoadedTask): string[] {
  return unique(task.projection.humanResolutionIds.flatMap((resolutionId) => {
    const artifact = readJsonArtifact<{
      interpretation?: {
        target?: { kind?: string; dispositionId?: string };
        action?: string;
      };
    }>(
      taskArtifactPath(task.taskDirectory, resolutionPath(resolutionId)),
      `Human Resolution ${resolutionId}`,
    );
    const target = artifact.interpretation?.target;
    return target?.kind === 'semantic-impact'
      && typeof target.dispositionId === 'string'
      && artifact.interpretation?.action !== 'abort'
      ? [target.dispositionId]
      : [];
  }));
}

function materializeVerificationRevision(
  source: VerificationRevisionDocument,
  priorContract: TaskContract,
  revisedContract: TaskContract,
) {
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    revisionId: `verification-revision:${randomUUID()}`,
    kind: source.kind,
    rationale: source.rationale,
    equivalenceClaim: source.equivalenceClaim,
    prior: {
      verificationPlanId: priorContract.verificationPlanId,
      effectiveContractId: priorContract.effectiveContractId,
    },
    current: {
      verificationPlanId: revisedContract.verificationPlanId,
      effectiveContractId: revisedContract.effectiveContractId,
    },
    ...(source.humanAuthorization ? {
      humanAuthorization: {
        humanEvent: {
          id: generatedHumanEventId(source.humanAuthorization.humanEvent, 'exception'),
          kind: 'exception' as const,
          ...source.humanAuthorization.humanEvent,
          contentFingerprint: sha256(source.humanAuthorization.humanEvent.content),
        },
        interpretation: source.humanAuthorization.interpretation,
      },
    } : {}),
  };
}

function materializeAuthoredChecks(
  checks: NonNullable<VerificationRevisionDocument['checks']>,
): NonNullable<CompileDelegationInput['checks']> {
  return checks.map((check) => ({
    ...check,
    execution: {
      preparation: check.execution.preparation.map((step, index) => ({
        key: `preparation-${index + 1}`,
        argv: step.argv,
      })),
      assertion: check.execution.assertion,
    },
  }));
}

function materializePrepareChecks(
  checks: NonNullable<DelegationPrepareDocument['checks']>,
  assurance: CompileDelegationInput['assurance'],
): NonNullable<CompileDelegationInput['checks']> {
  return checks.map((check) => ({
    ...check,
    execution: {
      preparation: check.execution.preparation.map((step, index) => ({
        key: `preparation-${index + 1}`,
        argv: step.argv,
      })),
      assertion: check.execution.assertion,
    },
    baseline: check.baseline.mode === 'task-start'
      ? {
          ...check.baseline,
          obligationKeys: assurance.kind === 'conditioned'
            ? assurance.conditions.flatMap((condition) =>
                condition.evidenceObligations
                  .filter((obligation) => obligation.strategies.some((strategy) =>
                    strategy.kind === 'runtime-check' && strategy.checkKeys.includes(check.key)))
                  .map((obligation) => ({
                    conditionKey: condition.key,
                    obligationKey: obligation.key,
                  })))
            : [],
        }
      : check.baseline,
  }));
}

function generatedHumanEventId(
  event: { content: string; provider?: string; nativeId?: string },
  kind: 'correction' | 'exception' | 'decision',
): string {
  return `event:${stableFingerprint({ kind, ...event }).slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function resolutionTargetMatches(
  source: HumanResolutionDocument,
  pending: NonNullable<TaskProjection['pendingResolution']>,
): boolean {
  if (source.target.kind === 'host-policy') {
    if (pending.kind !== 'host-policy') return false;
    return source.target.requirementIds.length === pending.targetIds.length
      && source.target.requirementIds.every((id, index) => id === pending.targetIds[index]);
  }
  if (source.target.kind === 'semantic-impact') {
    return pending.kind === 'semantic-impact'
      && source.target.dispositionId === pending.targetId;
  }
  return pending.kind === 'correction' && source.target.decisionId === pending.targetId;
}

function withoutPendingResolution(projection: TaskProjection): TaskProjection {
  const { pendingResolution: _pending, ...remaining } = projection;
  return remaining;
}

function assertStoredContractFingerprints(contract: TaskContract): void {
  const semanticProjection = {
    protocol: contract.protocol,
    schemaVersion: contract.schemaVersion,
    humanEvents: contract.humanEvents,
    understanding: contract.understanding,
    repositoryEvidence: contract.repositoryEvidence,
    materialDecisions: contract.materialDecisions,
    assurance: contract.assurance,
    adoptionConditions: contract.adoptionConditions,
    hostPolicyRequirements: contract.hostPolicyRequirements,
  };
  if (contract.semanticContractId !== stableFingerprint(semanticProjection)
    || contract.verificationPlanId !== stableFingerprint(contract.verificationPlan)
    || contract.effectiveContractId !== stableFingerprint({
      semanticContractId: contract.semanticContractId,
      verificationPlanId: contract.verificationPlanId,
    })) {
    throw new Error('Stored Task Contract changed after compilation.');
  }
}

function verificationCommands(definition: VerificationDefinition): Array<{
  path: string;
  argv: string[];
}> {
  return [
    ...definition.execution.preparation.map((step, index) => ({
      path: `preparation[${index}]`,
      argv: step.argv,
    })),
    { path: 'assertion', argv: definition.execution.assertion.argv },
  ];
}

function contractPath(revision: number): string {
  return `contracts/${revision}.json`;
}

function baselinePath(revision: number): string {
  return `contracts/${revision}.baseline.json`;
}

function baselineVerificationPath(revision: number): string {
  return `contracts/${revision}.baseline-verification.json`;
}

function attemptDirectory(attemptId: string): string {
  return `attempts/${sha256(attemptId).slice(-24)}`;
}

function factsPath(attemptId: string, collectionId: string): string {
  return `${attemptDirectory(attemptId)}/facts/${collectionId.slice('sha256:'.length)}.json`;
}

function evidenceDispositionPath(attemptId: string, dispositionId: string): string {
  return `${attemptDirectory(attemptId)}/evidence-dispositions/${dispositionId.slice('sha256:'.length)}.json`;
}

function handoffPath(id: string): string {
  return `handoffs/${sha256(id).slice(-32)}.json`;
}

function handoffEvaluationPath(id: string): string {
  return `handoffs/${sha256(id).slice(-32)}.evaluation.json`;
}

function decisionPath(id: string): string {
  return `decisions/${sha256(id).slice(-32)}.json`;
}

function decisionEvaluationPath(id: string): string {
  return `decisions/${sha256(id).slice(-32)}.evaluation.json`;
}

function resolutionPath(id: string): string {
  return `resolutions/${sha256(id).slice(-32)}.json`;
}

function verificationRevisionPath(id: string): string {
  return `verification-revisions/${sha256(id).slice(-32)}.json`;
}

function handoffInputError(
  error: unknown,
  contract: TaskContract,
) {
  if (isHandoffValidationError(error)) {
    return inputError(
      'Cognitive Adoption input cannot be evaluated; correct every reported issue.',
      error,
      exactHandoffIssuePaths(error.issues, contract),
    );
  }
  return inputError(`Cognitive Adoption input cannot be evaluated: ${error instanceof Error ? error.message : String(error)}`, error);
}

function exactHandoffIssuePaths(
  issues: ReferencedHandoffValidationIssue[],
  contract: TaskContract,
) {
  const conditionById = new Map(contract.adoptionConditions.map((condition, index) =>
    [condition.id, { condition, index }] as const));
  const obligationKeyById = new Map(contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation, obligationIndex) => [obligation.id, {
      condition,
      obligation,
      conditionIndex: contract.adoptionConditions.indexOf(condition),
      obligationIndex,
    }] as const)));
  return issues.map((issue) => {
    if (!issue.references || ![
      'review-coverage-missing',
      'challenge-review-coverage-missing',
      'review-decision-target-mismatch',
      'unknown-review-coverage-missing',
    ].includes(issue.code)) {
      return issue;
    }
    const conditionKeys = (issue.references.conditionIds ?? [])
      .map((id) => conditionById.get(id)?.condition.key)
      .filter((key): key is string => Boolean(key));
    const obligationKeys = (issue.references.obligationIds ?? [])
      .map((id) => obligationKeyById.get(id))
      .filter((key): key is NonNullable<typeof key> => Boolean(key));
    const exactTargets = [
      ...conditionKeys.map((key) => `conditionKey=${key}`),
      ...obligationKeys.map((key) =>
        `obligationKey=${key.condition.key}/${key.obligation.key}`),
    ].join(', ');
    return {
      code: issue.code,
      path: 'reviewDecisions',
      message: issue.message,
      remediation: `Create or reuse one shared reviewDecisions entry and add targets for ${exactTargets}.`,
    };
  });
}

type ReferencedHandoffValidationIssue = HandoffValidationIssue & {
  references?: {
    conditionIds?: string[];
    obligationIds?: string[];
  };
};

function isHandoffValidationError(
  value: unknown,
): value is Error & { issues: ReferencedHandoffValidationIssue[] } {
  const candidate = value as { name?: unknown; issues?: unknown };
  return value instanceof Error
    && candidate.name === 'HandoffValidationError'
    && Array.isArray(candidate.issues);
}
