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
  type HostPolicyEvaluation,
  type HumanDecision,
  type IndependentChallenge,
  type TaskContract,
  type VerificationDefinition,
  type VerifierRef,
  type VerifierMutation,
} from '@sovea/stetra-core';

import {
  attachProtocolInputCorrection,
  inputError,
  usageError,
} from '../errors.ts';
import {
  DEFAULT_CHECK_TIMEOUT_MS,
  runFrozenChecks,
} from '../facts/checks.ts';
import { collectExecutionEnvironment } from '../facts/environment.ts';
import { materializeEvidenceWindows } from '../facts/evidence.ts';
import {
  assertWorktreeSnapshot,
  captureGitWorktree,
  collectGitWorktreeChange,
  compareGitWorktrees,
  summarizeWorktree,
  type WorktreeSnapshot,
} from '../facts/worktree.ts';
import { resolveExecutable } from '../infrastructure/executable.ts';
import { summarizeVerifierSurfaces } from '../presentation/verifiers.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
  taskIdForPrepareRequest,
} from '../protocol.ts';
import { assertNoLegacyArtifacts } from '../project/legacy.ts';
import {
  ChallengeSubmissionSchema,
  CognitiveHandoffDocumentSchema,
  DelegationPrepareDocumentSchema,
  HumanDecisionDocumentSchema,
  HumanResolutionDocumentSchema,
  HostPolicyEvaluationSchema,
  VerificationRevisionDocumentSchema,
  EvidenceDispositionDocumentSchema,
  type ChallengeDocument,
  type CognitiveHandoffDocument,
  type EvidenceDispositionDocument,
  type HumanDecisionDocument,
  type HostChallengeRunReceipt,
  type HumanResolutionDocument,
  type VerificationRevisionDocument,
  type TaskProjection,
} from '../schemas/delegation.ts';
import type { HostAttestationProvider } from '../runtime-context.ts';
import { parseArtifact } from '../validation.ts';
import {
  adverseChallengeHostAction,
  challengeHostAction,
  collectedHostAction,
  compileProblemHostAction,
  handoffHostAction,
  preparedHostAction,
  diagnosisHostAction,
  resolutionHostAction,
  staleFactsHostAction,
  unavailableVerificationHostAction,
  type FinalResponseGuard,
} from './host-action.ts';
import {
  decisionAuthoringPacket,
  diagnosisAuthoringPacket,
  handoffAuthoringPacket,
  resolutionAuthoringPacket,
  verificationRevisionAuthoringPacket,
} from './authoring.ts';
import { challengeExecutionPacket } from './challenge-projection.ts';
import { challengeReferenceIssues } from './challenge-references.ts';
import { buildDeveloperDecisionBrief } from './decision-brief.ts';
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
  inputPath: string;
  input?: Readable;
  productVersion: string;
  hostAttestations?: HostAttestationProvider;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  assertNoLegacyArtifacts(projectRoot);
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    DelegationPrepareDocumentSchema,
    'Task Contract input',
  );
  const prepareInputFingerprint = stableFingerprint(source);
  return withWorktreeLease({ projectRoot, operation: 'prepare' }, async () => {
  const existingTask = findTaskByPrepareRequestId(projectRoot, source.prepareRequestId);
  if (existingTask) {
    if (existingTask.projection.prepareInputFingerprint !== prepareInputFingerprint) {
      throw inputError(
        `Prepare request ${source.prepareRequestId} is already bound to task ${existingTask.taskId} with different input. `
        + 'Reuse the original input for a retry or generate a new prepareRequestId for a distinct request.',
      );
    }
    return prepareReplayResult(
      existingTask,
      Boolean(options.hostAttestations?.verifyChallengeRun),
    );
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
    conditions: source.conditions,
    hostPolicyRequirements: source.hostPolicyRequirements,
    delivery: source.delivery,
    ...(source.checks ? { checks: source.checks } : {}),
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
            developerEvents: source.developerEvents,
            taskInterpretation: source.task,
            forks: compiled.forks,
          }
        : undefined),
    };
  }
  const unavailableExecutables = compiled.contract.verificationPlan.mode === 'checks'
    ? compiled.contract.verificationPlan.definitions.flatMap((check, index) => {
        const resolution = resolveExecutable(check.argv[0], projectRoot);
        return resolution.status === 'unavailable'
          ? [{ check, index, reason: resolution.error.message }]
          : [];
      })
    : [];
  if (unavailableExecutables.length) {
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'verification-required' as const,
      message: 'One or more frozen top-level check executables are unavailable; no task was created.',
      issues: unavailableExecutables.map(({ check, index, reason }) => ({
        code: 'verification-executable-unavailable',
        path: `checks[${index}].argv[0]`,
        message: `Check ${check.definitionId} cannot resolve ${JSON.stringify(check.argv[0])}: ${reason}`,
        remediation: 'Restore the executable or choose another explicit verification command.',
      })),
      taskCreated: false,
      hostAction: unavailableVerificationHostAction(),
    };
  }

  const taskId = taskIdForPrepareRequest(source.prepareRequestId);
  const hostPolicyEvaluations = await materializeHostPolicyEvaluations(
    taskId,
    compiled.contract,
    options.hostAttestations,
  );
  const unresolvedHostPolicy = compiled.contract.hostPolicyRequirements.find((requirement) =>
    requirement.enforcementRequirement === 'required'
    && hostPolicyEvaluations.find((item) => item.requirementId === requirement.id)?.mode !== 'enforced');
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
    const baselineObservations = await runFrozenChecks({
      projectRoot,
      executions: taskStartDefinitions.map((definition) => ({
        definition,
        timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      })),
      outputDirectory: join(workspace.taskDirectory, 'baseline-checks'),
      recordedOutputDirectory: join(workspace.finalTaskDirectory, 'baseline-checks'),
    });
    const baseline = await captureGitWorktree(projectRoot, {
      objectDirectory: workspace.objectDirectory,
    });
    const baselineProjection = {
      capturedAt: new Date().toISOString(),
      preCheck: summarizeWorktree(preBaselineCheck),
      postCheck: summarizeWorktree(baseline),
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
    const createdAt = new Date().toISOString();
    const attempt = {
      attemptId: 'attempt:1',
      ordinal: 1,
      parentAttemptId: null,
      effectiveContractId: compiled.contract.effectiveContractId,
      trigger: 'initial' as const,
      deliveryStatus: 'waiting-for-implementation' as const,
      createdAt,
    };
    const projection: TaskProjection = {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      taskId,
      prepareRequestId: source.prepareRequestId,
      prepareInputFingerprint,
      workflow: 'cognitive-adoption',
      projectRoot,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      contractRevision: 1,
      packageIdentity: {
        cli: { name: '@sovea/stetra', version: options.productVersion },
        core: { name: '@sovea/stetra-core', version: options.productVersion },
      },
      semanticContractId: compiled.contract.semanticContractId,
      verificationPlanId: compiled.contract.verificationPlanId,
      effectiveContractId: compiled.contract.effectiveContractId,
      planId: compiled.contract.plan.planId,
      currentAttemptId: attempt.attemptId,
      deliveryStatus: 'waiting-for-implementation',
      evidenceStatus: 'not-collected',
      decisionStatus: 'pending',
      repairCount: 0,
      attempts: [attempt],
      challengeIds: [],
      hostPolicyEvaluations,
      resolvedHostPolicyIds: [],
      verificationRevised: false,
      verificationRevisionIds: [],
      ...(unresolvedHostPolicy ? {
        pendingResolution: { kind: 'host-policy' as const, targetId: unresolvedHostPolicy.id },
      } : {}),
    };
    const loaded = initializeTask({
      projectRoot,
      taskId,
      stagingDirectory: workspace.taskDirectory,
      projection,
      artifacts: [
        { relativePath: contractPath(1), value: compiled.contract },
        { relativePath: planPath(1), value: compiled.contract.plan },
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
      task: compactTask(loaded.projection),
      taskContract: contractWorkPacket(compiled.contract),
      baseline: summarizeWorktree(baseline),
      baselineVerification: summarizeBaselineVerification(baselineVerification),
      details: {
        taskPath: loaded.taskPath,
        eventsPath: loaded.eventsPath,
        explain: { taskId, section: 'contract' as const },
      },
      taskCreated: true,
      hostAction: unresolvedHostPolicy
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
      return prepareReplayResult(
        concurrentlyPublished,
        Boolean(options.hostAttestations?.verifyChallengeRun),
      );
    }
    throw error;
  }
  });
}

export async function collectDelegationFacts(options: {
  projectRoot: string;
  taskId: string;
  productVersion: string;
  timeoutMs?: number;
  retryChecks?: CheckTimeoutRetry[];
  refresh?: boolean;
  hostAttestations?: HostAttestationProvider;
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
        if (current.fingerprint === priorFacts.current.fingerprint) {
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
      let factsBase: Omit<FactBundle, 'factCollectionId' | 'bundleFingerprint'>;
      let newArtifactRefs: string[] = [];

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
        const retryPlan = validateTimeoutRetries(retries, definitions, priorFacts.checks);
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
        factsBase = {
          ...priorFacts,
          collectedAt: new Date().toISOString(),
          checks,
          checkComparisons: compareChecksToBaseline(priorFacts.baselineVerification, checks),
          environment: collectExecutionEnvironment(task.projectRoot, definitions),
        };
        delete (factsBase as Partial<FactBundle>).factCollectionId;
        delete (factsBase as Partial<FactBundle>).bundleFingerprint;
      } else {
        const timeoutMs = options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
        const preCheck = await captureGitWorktree(task.projectRoot, {
          objectDirectory,
          alternateObjectDirectories: [durableObjectDirectory],
        });
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
          collectedAt: new Date().toISOString(),
          baseline: summarizeWorktree(baseline),
          preCheck: summarizeWorktree(preCheck),
          current: summarizeWorktree(worktree.current),
          baselineVerification,
          changeFingerprint: worktree.changeFingerprint,
          changedFiles: worktree.changedFiles,
          checkInducedChanges,
          checks,
          checkComparisons: compareChecksToBaseline(baselineVerification, checks),
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
      const withCollection = { ...factsBase, factCollectionId: collectionId };
      const facts: FactBundle = {
        ...withCollection,
        bundleFingerprint: stableFingerprint(withCollection),
      };
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
      const checksNeedJudgment = facts.checks.some((check) => latestCheckAttempt(check).status !== 'passed');
      const attempts = task.projection.attempts.map((attempt) =>
        attempt.attemptId === currentAttempt.attemptId
          ? {
              ...attempt,
              deliveryStatus: 'implementation-complete' as const,
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
          deliveryStatus: 'implementation-complete',
          evidenceStatus: checksNeedJudgment ? 'awaiting-evidence-judgment' : 'incomplete',
          decisionStatus: 'pending',
          attempts,
        },
        artifactRefs: unique(newArtifactRefs),
        stagedArtifactsDirectory,
      });
    } finally {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
  });
  if (!collectedFacts) throw new Error('Fact collection completed without a Fact Bundle.');
  const currentContract = readContract(transitioned);
  const collectedChallenges = readCurrentChallenges(transitioned);
  const requiredChallenges = requiredChallengeObligationIds(currentContract, collectedFacts);
  const pendingChallenges = pendingChallengeObligationIds(requiredChallenges, collectedChallenges);
  const challengeAttestationAvailable = Boolean(options.hostAttestations?.verifyChallengeRun);
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
    task: compactTask(transitioned.projection),
    changedFiles: collectedFacts.changedFiles.map((file) => ({
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      operation: file.operation,
      representation: file.representation,
    })),
    checkInducedChanges: collectedFacts.checkInducedChanges.map((file) => ({
      path: file.path,
      operation: file.operation,
    })),
    checks: collectedFacts.checks.map(compactCheckFact),
    checkComparisons: collectedFacts.checkComparisons,
    verifierSurfaces: summarizeVerifierSurfaces(collectedFacts.verifierMutations),
    patch: collectedFacts.patch ?? null,
    environment: collectedFacts.environment,
    details: {
      taskPath: transitioned.taskPath,
      explain: { taskId: transitioned.taskId, section: 'attempts' as const },
    },
    hostAction: collectionState.mode === 'reused-current'
      ? currentTaskHostAction(transitioned, challengeAttestationAvailable)
      : collectedHostAction({
      facts: collectedFacts,
      taskId: transitioned.taskId,
      diagnosisPacket: diagnosisAuthoringPacket({
        task: transitioned.projection, contract: currentContract, facts: collectedFacts,
      }),
      ...(pendingChallenges.length ? {
        challengePacket: challengeExecutionPacket({
          task: transitioned.projection,
          contract: currentContract,
          facts: collectedFacts,
          completedObligationIds: completedChallengeObligationIds(collectedChallenges),
          requiredObligationIds: requiredChallenges,
        }),
      } : {}),
      handoffPacket: handoffAuthoringPacket({
        task: transitioned.projection,
        contract: currentContract,
        facts: collectedFacts,
        challenges: collectedChallenges,
        requiredObligationIds: requiredChallenges,
        challengeAttestationAvailable,
      }),
      pendingChallengeObligationIds: pendingChallenges,
      }),
  };
}

export async function diagnoseCollectedEvidence(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
  hostAttestations?: HostAttestationProvider;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    EvidenceDispositionDocumentSchema,
    'Evidence disposition input',
  );
  let route: EvidenceDisposition['route'] | undefined;
  let disposition: EvidenceDisposition | undefined;
  let successorAttemptId: string | undefined;
  const transitioned = await transitionTask({
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
      if (task.projection.decisionStatus !== 'pending') {
        throw usageError('A decided task cannot record evidence diagnosis.');
      }
      const facts = readFacts(task, current.attemptId, current.factCollectionId);
      validateEvidenceDispositionInput(source, contract, facts, readCurrentChallenges(task));
      route = source.proposedRoute;
      const budgetExhausted = route === 'repair-delivery'
        && task.projection.repairCount >= contract.plan.maxRepairAttempts;
      if (budgetExhausted) route = 'handoff';
      const dispositionProjection = {
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        effectiveContractId: contract.effectiveContractId,
        attemptId: current.attemptId,
        factCollectionId: facts.factCollectionId,
        semanticImpact: source.semanticImpact,
        proposedRoute: source.proposedRoute,
        routeRationale: source.routeRationale,
        entries: source.entries,
        route,
      };
      disposition = {
        dispositionId: stableFingerprint(dispositionProjection),
        ...dispositionProjection,
      };
      const dispositionRelative = `${attemptDirectory(current.attemptId)}/evidence-disposition.json`;
      const dispositionPath = taskArtifactPath(task.taskDirectory, dispositionRelative);
      writeImmutableJson(dispositionPath, disposition);
      const currentWithDisposition = {
        ...current,
        evidenceDispositionPath: projectRelativePath(task.projectRoot, dispositionPath),
        ...(budgetExhausted ? { deliveryStatus: 'exhausted' as const } : {}),
      };
      const cleared = clearPostCollectionArtifacts(task.projection);
      if (route !== 'repair-delivery') {
        return {
          projection: {
            ...cleared,
            deliveryStatus: budgetExhausted ? 'exhausted' : 'implementation-complete',
            evidenceStatus: route === 'ask-human' || budgetExhausted
              ? 'needs-attention' : 'incomplete',
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
      const createdAt = new Date().toISOString();
      const successor = {
        attemptId: successorAttemptId,
        ordinal: current.ordinal + 1,
        parentAttemptId: current.attemptId,
        effectiveContractId: contract.effectiveContractId,
        trigger: 'delivery-repair' as const,
        deliveryStatus: 'repairing' as const,
        createdAt,
      };
      writeImmutableJson(attemptPath, successor);
      return {
        projection: {
          ...cleared,
          currentAttemptId: successorAttemptId,
          deliveryStatus: 'repairing',
          evidenceStatus: 'not-collected',
          decisionStatus: 'pending',
          repairCount: task.projection.repairCount + 1,
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
  });
  const currentContract = readContract(transitioned);
  const currentFacts = route === 'repair-delivery' ? undefined : readCurrentFacts(transitioned);
  const challenges = route === 'repair-delivery' ? [] : readCurrentChallenges(transitioned);
  const required = currentFacts
    ? requiredChallengeObligationIds(currentContract, currentFacts) : [];
  const challengeAttestationAvailable = Boolean(options.hostAttestations?.verifyChallengeRun);
  const packet = route === 'ask-human'
    ? resolutionAuthoringPacket({
        task: transitioned.projection,
        contract: currentContract,
        ...(currentFacts ? { facts: currentFacts } : {}),
      })
    : route === 'revise-verification' && currentFacts
      ? verificationRevisionAuthoringPacket({
          task: transitioned.projection,
          contract: currentContract,
          facts: currentFacts,
        })
    : route === 'challenge' && currentFacts
      ? challengeExecutionPacket({
          task: transitioned.projection, contract: currentContract, facts: currentFacts,
          completedObligationIds: completedChallengeObligationIds(challenges),
          requiredObligationIds: required,
        })
      : route === 'handoff' && currentFacts
        ? handoffAuthoringPacket({
            task: transitioned.projection, contract: currentContract, facts: currentFacts,
            challenges, requiredObligationIds: required,
            challengeAttestationAvailable,
          })
        : undefined;
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: route === 'repair-delivery'
      ? 'repair-prepared' as const
      : 'evidence-diagnosed' as const,
    taskId: transitioned.taskId,
    disposition: disposition!,
    ...(successorAttemptId ? { successorAttemptId } : {}),
    task: compactTask(transitioned.projection),
    hostAction: diagnosisHostAction(route!, transitioned.taskId, packet),
  };
}

export async function recordChallenge(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
  hostAttestations?: HostAttestationProvider;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    ChallengeSubmissionSchema,
    'Independent Challenge input',
  );
  let challenge: IndependentChallenge | undefined;
  const transitioned = await transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'challenge-recorded',
    actor: 'agent',
    async mutate(task) {
      const contract = readContract(task);
      const facts = readCurrentFacts(task);
      const stale = await currentFactsAreStale(task, facts);
      if (stale) throw usageError('Facts changed before challenge; collect the current worktree first.');
      validateChallengeReferences(source.challenge, contract, facts);
      const requestedAction = currentTaskHostAction(task, true);
      if (requestedAction?.kind !== 'perform-independent-challenge'
        || !requestedAction.challengeExecutionRequest
        || !requestedAction.challengeExecutionPacket) {
        throw usageError('The current task state does not request an Independent Challenge.');
      }
      const request = requestedAction.challengeExecutionRequest;
      const requestedDraft = requestedAction.challengeExecutionPacket.draft;
      if (stableFingerprint(requestedDraft.obligationIds)
        !== stableFingerprint(source.challenge.obligationIds)) {
        throw inputError('Challenge must answer the exact Evidence Obligation in the current Challenge Execution Request.');
      }
      if (stableFingerprint(requestedDraft.falsification)
          !== stableFingerprint(source.challenge.falsification)
        || stableFingerprint(requestedDraft.evidence)
          !== stableFingerprint(source.challenge.evidence)) {
        throw inputError('Challenge must preserve the exact frozen falsification and evidence selection in the current Challenge Execution Packet.');
      }
      if (source.requestId && source.requestId !== request.requestId) {
        throw inputError('Challenge requestId does not match the current Challenge Execution Request.');
      }
      const receipt = source.hostReceipt;
      let receiptVerified = false;
      if (receipt) {
        if (!options.hostAttestations?.verifyChallengeRun) {
          throw inputError('A Host Challenge Run Receipt requires a trusted Host integration that can verify it.');
        }
        if (receipt.requestId !== request.requestId) {
          throw inputError('Host Challenge Run Receipt is bound to a different Challenge Execution Request.');
        }
        if (receipt.outputFingerprint !== stableFingerprint(source.challenge)) {
          throw inputError('Host Challenge Run Receipt does not bind the submitted Challenge output.');
        }
        if (readChallenges(task).some((item) => item.attestationId === receipt.receiptId)) {
          throw inputError(`Host Challenge Run Receipt ${receipt.receiptId} has already been consumed.`);
        }
        receiptVerified = await options.hostAttestations.verifyChallengeRun({
          request,
          receipt,
          challenge: source.challenge,
        });
        if (!receiptVerified) {
          throw inputError('The trusted Host integration rejected the Challenge Run Receipt.');
        }
      }
      const obligationById = new Map(contract.adoptionConditions.flatMap((condition) =>
        condition.evidenceObligations.map((obligation) => [obligation.id, obligation] as const)));
      const challengeId = `challenge:${randomUUID()}`;
      challenge = {
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        ...source.challenge,
        id: challengeId,
        effectiveContractId: contract.effectiveContractId,
        attemptId: facts.attemptId,
        factCollectionId: facts.factCollectionId,
        conditionIds: unique(source.challenge.obligationIds.map((id) => obligationById.get(id)!.conditionId)),
        independence: receiptVerified ? 'host-attested' : 'unverified',
        ...(receiptVerified && receipt ? {
          attestationId: receipt.receiptId,
          implementerContextId: receipt.parentContextId,
          challengerContextId: receipt.challengerContextId,
        } : {}),
      };
      const relativePath = challengePath(challengeId);
      const path = taskArtifactPath(task.taskDirectory, relativePath);
      writeImmutableJson(path, challenge);
      const artifactRefs = [projectRelativePath(task.projectRoot, path)];
      if (receiptVerified && receipt) {
        const receiptRelativePath = hostChallengeReceiptPath(receipt.receiptId);
        const receiptPath = taskArtifactPath(task.taskDirectory, receiptRelativePath);
        writeImmutableJson(receiptPath, receipt);
        artifactRefs.push(projectRelativePath(task.projectRoot, receiptPath));
      }
      return {
        projection: {
          ...task.projection,
          challengeIds: [...task.projection.challengeIds, challengeId],
        },
        artifactRefs,
      };
    },
  });
  const transitionedContract = readContract(transitioned);
  const transitionedFacts = readCurrentFacts(transitioned);
  const challenges = readCurrentChallenges(transitioned);
  const required = requiredChallengeObligationIds(transitionedContract, transitionedFacts);
  const pending = pendingChallengeObligationIds(required, challenges);
  const challengeAttestationAvailable = Boolean(options.hostAttestations?.verifyChallengeRun);
  const adverse = challenge!.outcome !== 'supported';
  const performAnotherChallenge = !adverse && pending.length > 0;
  const nextAction = adverse
    ? adverseChallengeHostAction(transitioned.taskId, diagnosisAuthoringPacket({
        task: transitioned.projection,
        contract: transitionedContract,
        facts: transitionedFacts,
        challenges,
      }))
    : performAnotherChallenge
      ? challengeHostAction(transitioned.taskId, true, challengeExecutionPacket({
          task: transitioned.projection,
          contract: transitionedContract,
          facts: transitionedFacts,
          completedObligationIds: completedChallengeObligationIds(challenges),
          requiredObligationIds: required,
        }))
      : challengeHostAction(transitioned.taskId, false, handoffAuthoringPacket({
          task: transitioned.projection,
          contract: transitionedContract,
          facts: transitionedFacts,
          challenges,
          requiredObligationIds: required,
          challengeAttestationAvailable,
        }));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'challenge-recorded' as const,
    taskId: transitioned.taskId,
    attemptId: challenge!.attemptId,
    factCollectionId: challenge!.factCollectionId,
    challenge: challenge!,
    hostAction: nextAction,
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
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    CognitiveHandoffDocumentSchema,
    'Cognitive Handoff input',
  );
  let handoff: CognitiveHandoff | undefined;
  let evaluation: HandoffEvaluation | undefined;
  let packet: DecisionPacket | undefined;
  const transitioned = await transitionTask({
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
      const challenges = readCurrentChallenges(task);
      handoff = materializeHandoff(source, contract, currentFacts);
      try {
        evaluation = evaluateHandoff({
          protocol: DELEGATION_PROTOCOL,
          schemaVersion: DELEGATION_SCHEMA_VERSION,
          contract,
          factBundle: currentFacts,
          currentWorktreeFingerprint: currentFacts.current.fingerprint,
          challenges,
          currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
          hostPolicyEvaluations: task.projection.hostPolicyEvaluations,
          deliveryExhausted: task.projection.deliveryStatus === 'exhausted',
          verificationRevised: task.projection.verificationRevised,
          handoff,
        });
      } catch (error) {
        throw handoffInputError(error);
      }
      packet = buildDecisionPacket(
        contract,
        currentFacts,
        readEvidenceDispositions(task),
        challenges,
        handoff,
        evaluation,
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
          evidenceStatus: evaluation.status,
          currentHandoffId: handoff.handoffId,
          currentHandoffFingerprint: handoff.handoffFingerprint,
        },
        artifactRefs: [
          projectRelativePath(task.projectRoot, handoffAbsolute),
          projectRelativePath(task.projectRoot, evaluationAbsolute),
        ],
      };
    },
  });
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: evaluation!.status,
    taskId: transitioned.taskId,
    attemptId: evaluation!.attemptId,
    factCollectionId: evaluation!.factCollectionId,
    handoffId: handoff!.handoffId,
    handoffFingerprint: handoff!.handoffFingerprint,
    decisionPacket: packet!,
    hostAction: handoffHostAction(
      evaluation!.status,
      transitioned.taskId,
      buildDeveloperDecisionBrief({
        task: transitioned.projection,
        contract: readContract(transitioned),
        packet: packet!,
        evaluation: evaluation!,
      }),
      decisionAuthoringPacket({
        task: transitioned.projection,
        contract: readContract(transitioned),
        facts: readCurrentFacts(transitioned),
        challenges: readCurrentChallenges(transitioned),
        handoff: handoff!,
        evaluation: evaluation!,
      }),
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
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    HumanDecisionDocumentSchema,
    'Human Decision input',
  );
  let decision: HumanDecision | undefined;
  let evaluation: HandoffEvaluation | undefined;
  let packet: DecisionPacket | undefined;
  const transitioned = await transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'decision-recorded',
    actor: 'human',
    async mutate(task) {
      if (task.projection.decisionStatus !== 'pending') {
        throw usageError(`Task already has decision ${task.projection.decisionStatus}.`);
      }
      const contract = readContract(task);
      const currentFacts = readCurrentFacts(task);
      if (await currentFactsAreStale(task, currentFacts)) {
        throw usageError('Facts changed while the decision was being recorded; collect and review again.');
      }
      const handoff = readCurrentHandoff(task);
      const challenges = readCurrentChallenges(task);
      decision = materializeDecision(source, contract, currentFacts, handoff);
      try {
        evaluation = evaluateHandoff({
          protocol: DELEGATION_PROTOCOL,
          schemaVersion: DELEGATION_SCHEMA_VERSION,
          contract,
          factBundle: currentFacts,
          currentWorktreeFingerprint: currentFacts.current.fingerprint,
          challenges,
          currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
          hostPolicyEvaluations: task.projection.hostPolicyEvaluations,
          deliveryExhausted: task.projection.deliveryStatus === 'exhausted',
          verificationRevised: task.projection.verificationRevised,
          handoff,
          decision,
        });
      } catch (error) {
        throw handoffInputError(error);
      }
      packet = buildDecisionPacket(
        contract,
        currentFacts,
        readEvidenceDispositions(task),
        challenges,
        handoff,
        evaluation,
        decision,
      );
      const decisionRelative = decisionPath(decision.decisionId);
      const evaluationRelative = decisionEvaluationPath(decision.decisionId);
      const decisionAbsolute = taskArtifactPath(task.taskDirectory, decisionRelative);
      const evaluationAbsolute = taskArtifactPath(task.taskDirectory, evaluationRelative);
      writeImmutableJson(decisionAbsolute, decision);
      writeImmutableJson(evaluationAbsolute, evaluation);
      const terminal = decision.action === 'accepted'
        || decision.action === 'rejected'
        || decision.action === 'deferred';
      return {
        projection: {
          ...task.projection,
          evidenceStatus: evaluation.status,
          decisionStatus: decision.action,
          decisionId: decision.decisionId,
          ...(decision.action === 'correction-requested' ? {
            pendingResolution: {
              kind: 'correction' as const,
              targetId: decision.decisionId,
            },
          } : {}),
          ...(terminal ? { terminalAt: new Date().toISOString() } : {}),
        },
        artifactRefs: [
          projectRelativePath(task.projectRoot, decisionAbsolute),
          projectRelativePath(task.projectRoot, evaluationAbsolute),
        ],
      };
    },
  });
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'decision-recorded' as const,
    taskId: transitioned.taskId,
    decisionStatus: decision!.action,
    evidenceStatus: evaluation!.status,
    decisionPacket: packet!,
    externalEffects: {
      committed: false,
      merged: false,
      published: false,
      deployed: false,
      activatedForFutureTasks: false,
    },
    hostAction: decision!.action === 'correction-requested'
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
  hostAttestations?: HostAttestationProvider;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    HumanResolutionDocumentSchema,
    'Human Resolution input',
  );
  let resolution: ReturnType<typeof materializeResolution> | undefined;
  let successorAttemptId: string | undefined;
  const transitioned = await transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'human-resolution-recorded',
    actor: 'human',
    mutate(task) {
      const pending = task.projection.pendingResolution;
      if (!pending || !resolutionTargetMatches(source, pending)) {
        throw usageError('Human Resolution must target the exact currently pending decision.');
      }
      const contract = readContract(task);
      resolution = materializeResolution(source, contract);
      const resolutionRelative = resolutionPath(resolution.resolutionId);
      const resolutionAbsolute = taskArtifactPath(task.taskDirectory, resolutionRelative);
      writeImmutableJson(resolutionAbsolute, resolution);
      const artifactRefs = [projectRelativePath(task.projectRoot, resolutionAbsolute)];
      if (source.action === 'abort') {
        return {
          projection: {
            ...withoutPendingResolution(task.projection),
            decisionStatus: 'aborted' as const,
            terminalAt: new Date().toISOString(),
          },
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
          deliveryStatus: 'repairing' as const,
          createdAt: new Date().toISOString(),
        };
        const attemptRelative = `${attemptDirectory(successorAttemptId)}/attempt.json`;
        const attemptAbsolute = taskArtifactPath(task.taskDirectory, attemptRelative);
        writeImmutableJson(attemptAbsolute, successor);
        artifactRefs.push(projectRelativePath(task.projectRoot, attemptAbsolute));
        const cleared = clearPostCollectionArtifacts(withoutPendingResolution(task.projection));
        return {
          projection: {
            ...cleared,
            currentAttemptId: successorAttemptId,
            deliveryStatus: 'repairing' as const,
            evidenceStatus: 'not-collected' as const,
            decisionStatus: 'pending' as const,
            attempts: [...task.projection.attempts, successor],
          },
          artifactRefs,
        };
      }

      if (pending.kind === 'host-policy') {
        const resolvedHostPolicyIds = unique([
          ...task.projection.resolvedHostPolicyIds,
          pending.targetId,
        ]);
        const nextUnresolvedHostPolicy = contract.hostPolicyRequirements.find((requirement) =>
          requirement.enforcementRequirement === 'required'
          && task.projection.hostPolicyEvaluations.find((item) =>
            item.requirementId === requirement.id)?.mode !== 'enforced'
          && !resolvedHostPolicyIds.includes(requirement.id));
        return {
          projection: {
            ...withoutPendingResolution(task.projection),
            resolvedHostPolicyIds,
            ...(nextUnresolvedHostPolicy ? {
              pendingResolution: {
                kind: 'host-policy' as const,
                targetId: nextUnresolvedHostPolicy.id,
              },
            } : {}),
          },
          artifactRefs,
        };
      }

      return {
        projection: withoutPendingResolution(task.projection),
        artifactRefs,
      };
    },
  });

  let hostAction = null;
  if (transitioned.projection.decisionStatus !== 'aborted') {
    if (transitioned.projection.pendingResolution) {
      hostAction = resolutionHostAction(transitioned.taskId, resolutionAuthoringPacket({
        task: transitioned.projection,
        contract: readContract(transitioned),
        facts: readAttemptFactsIfPresent(
          transitioned,
          transitioned.projection.currentAttemptId,
        ),
      }));
    } else if (successorAttemptId || transitioned.projection.deliveryStatus === 'waiting-for-implementation') {
      hostAction = preparedHostAction(transitioned.taskId);
    } else {
      const contract = readContract(transitioned);
      const facts = readCurrentFacts(transitioned);
      const challenges = readCurrentChallenges(transitioned);
      const required = requiredChallengeObligationIds(contract, facts);
      const pending = pendingChallengeObligationIds(required, challenges);
      const needsChallenge = pending.length > 0;
      const challengeAttestationAvailable = Boolean(options.hostAttestations?.verifyChallengeRun);
      const performChallenge = needsChallenge;
      const packet = performChallenge
        ? challengeExecutionPacket({
            task: transitioned.projection, contract, facts,
            completedObligationIds: completedChallengeObligationIds(challenges),
            requiredObligationIds: required,
          })
        : handoffAuthoringPacket({
            task: transitioned.projection, contract, facts, challenges,
            requiredObligationIds: required,
            challengeAttestationAvailable,
          });
      hostAction = challengeHostAction(transitioned.taskId, performChallenge, packet);
    }
  }
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'human-resolution-recorded' as const,
    taskId: transitioned.taskId,
    resolution: resolution!,
    ...(successorAttemptId ? { successorAttemptId } : {}),
    task: compactTask(transitioned.projection),
    hostAction,
  };
}

export async function reviseVerificationPlan(options: {
  projectRoot: string;
  taskId: string;
  inputPath: string;
  input?: Readable;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const source = await readInputDocument(
    projectRoot,
    options.inputPath,
    options.input,
    VerificationRevisionDocumentSchema,
    'Verification Revision input',
  );
  let revisionRecord: ReturnType<typeof materializeVerificationRevision> | undefined;
  let successorAttemptId: string | undefined;
  let revisedContract: TaskContract | undefined;
  const transitioned = await transitionTask({
    projectRoot,
    taskId: options.taskId,
    type: 'verification-revised',
    actor: 'agent',
    mutate(task) {
      if (task.projection.pendingResolution) {
        throw usageError('Resolve the pending Human decision before revising verification.');
      }
      if (task.projection.decisionStatus !== 'pending') {
        throw usageError(`Task ${task.taskId} is already ${task.projection.decisionStatus}.`);
      }
      const priorContract = readContract(task);
      const compiled = compileDelegation({
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        operation: 'revise-verification',
        priorContract,
        revision: source,
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
      const unavailable = definitions.flatMap((definition) => {
        const resolution = resolveExecutable(definition.argv[0], task.projectRoot);
        return resolution.status === 'unavailable'
          ? [`${definition.definitionId}: ${resolution.error.message}`] : [];
      });
      if (unavailable.length) {
        throw inputError(`Revised top-level check executables are unavailable: ${unavailable.join('; ')}`);
      }
      const priorBaseline = readBaseline(task);
      const baselineSummary = summarizeWorktree(priorBaseline);
      const baselineProjection = {
        capturedAt: new Date().toISOString(),
        preCheck: baselineSummary,
        postCheck: baselineSummary,
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
        deliveryStatus: 'waiting-for-implementation' as const,
        createdAt: new Date().toISOString(),
      };
      const contractRevision = task.projection.contractRevision + 1;
      revisionRecord = materializeVerificationRevision(
        source,
        priorContract,
        revisedContract,
      );
      const artifacts = [
        { relativePath: contractPath(contractRevision), value: revisedContract },
        { relativePath: planPath(contractRevision), value: revisedContract.plan },
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
          deliveryStatus: 'waiting-for-implementation',
          evidenceStatus: 'not-collected',
          decisionStatus: 'pending',
          attempts: [...task.projection.attempts, successor],
          verificationRevised: true,
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
  });
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'verification-revised' as const,
    taskId: transitioned.taskId,
    revision: revisionRecord!,
    contractRevision: transitioned.projection.contractRevision,
    semanticContractId: revisedContract!.semanticContractId,
    verificationPlanId: revisedContract!.verificationPlanId,
    effectiveContractId: revisedContract!.effectiveContractId,
    successorAttemptId: successorAttemptId!,
    baseline: 'baseline-unknown-after-revision' as const,
    task: compactTask(transitioned.projection),
    hostAction: preparedHostAction(transitioned.taskId),
  };
}

export function explainDelegationTask(options: {
  projectRoot: string;
  taskId: string;
  section?: string;
  hostAttestations?: HostAttestationProvider;
}) {
  const task = loadTask(options.projectRoot, options.taskId);
  const section = options.section ?? 'index';
  const common = {
    protocol: task.projection.protocol,
    schemaVersion: task.projection.schemaVersion,
    taskId: task.taskId,
    task: compactTask(task.projection),
    section,
  };
  if (section === 'contract') {
    return { ...common, contract: readContract(task), baseline: summarizeWorktree(readBaseline(task)) };
  }
  if (section === 'baseline') {
    return {
      ...common,
      baseline: readBaseline(task),
      baselineVerification: readBaselineVerification(task),
    };
  }
  if (section === 'action') {
    return {
      ...common,
      hostAction: currentTaskHostAction(
        task,
        Boolean(options.hostAttestations?.verifyChallengeRun),
      ),
    };
  }
  if (section === 'plan') return { ...common, plan: readContract(task).plan };
  if (section === 'attempts') {
    return {
      ...common,
      attempts: task.projection.attempts.map((attempt) => ({
        ...attempt,
        facts: attempt.factCollectionId
          ? readFacts(task, attempt.attemptId, attempt.factCollectionId)
          : null,
      })),
    };
  }
  if (section === 'challenge') {
    const challenges = readChallenges(task);
    return {
      ...common,
      challenges,
      hostReceipts: readHostChallengeReceipts(task, challenges),
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
  if (section === 'decision') {
    return {
      ...common,
      decision: task.projection.decisionId
        ? readJsonArtifact(taskArtifactPath(task.taskDirectory, decisionPath(task.projection.decisionId)), 'Human Decision')
        : null,
    };
  }
  if (section === 'events') return { ...common, events: task.events };
  if (section !== 'index') {
    throw usageError('Invalid explain section; use index, action, contract, baseline, plan, attempts, challenge, revision, handoff, decision, or events.');
  }
  return {
    ...common,
    availableSections: [
      { name: 'action', available: task.projection.decisionStatus === 'pending' },
      { name: 'contract', available: true },
      { name: 'baseline', available: true },
      { name: 'plan', available: true },
      { name: 'attempts', available: true, count: task.projection.attempts.length },
      { name: 'challenge', available: task.projection.challengeIds.length > 0, count: task.projection.challengeIds.length },
      { name: 'revision', available: task.projection.verificationRevisionIds.length > 0, count: task.projection.verificationRevisionIds.length },
      { name: 'handoff', available: Boolean(task.projection.currentHandoffId) },
      { name: 'decision', available: Boolean(task.projection.decisionId) },
      { name: 'events', available: true, count: task.events.length },
    ],
    artifactIndex: {
      attempts: task.projection.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        factCollectionId: attempt.factCollectionId ?? null,
      })),
      challengeIds: task.projection.challengeIds,
      verificationRevisionIds: task.projection.verificationRevisionIds,
      handoffId: task.projection.currentHandoffId ?? null,
      decisionId: task.projection.decisionId ?? null,
    },
  };
}

export async function guardFinalResponse(options: {
  projectRoot: string;
  taskId: string;
  knownActionFingerprint?: string;
  hostAttestations?: HostAttestationProvider;
}): Promise<FinalResponseGuard> {
  const task = loadTask(options.projectRoot, options.taskId);
  const currentAttempt = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId)!;
  const facts = currentAttempt.factCollectionId
    ? readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId)
    : undefined;
  const factsCurrent = facts ? !(await currentFactsAreStale(task, facts)) : false;
  const challengeAttestationAvailable = Boolean(options.hostAttestations?.verifyChallengeRun);
  let disposition:
    | 'continue-workflow'
    | 'present-decision-brief'
    | 'human-decision-recorded';
  let hostAction = facts && !factsCurrent
    ? staleFactsHostAction(task.taskId)
    : currentTaskHostAction(task, challengeAttestationAvailable);

  if (task.projection.pendingResolution || !facts || !factsCurrent) {
    disposition = 'continue-workflow';
  } else if (task.projection.decisionStatus !== 'pending') {
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
    stateWritten: false,
  };
}

function currentTaskHostAction(task: LoadedTask, challengeAttestationAvailable = false) {
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
  if (task.projection.decisionStatus !== 'pending') return null;
  const currentAttempt = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId)!;
  if (!currentAttempt.factCollectionId) return preparedHostAction(task.taskId);
  const facts = readFacts(task, currentAttempt.attemptId, currentAttempt.factCollectionId);
  const challenges = readCurrentChallenges(task);
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
      challenges,
      handoff,
      evaluation,
    );
    return handoffHostAction(
      evaluation.status,
      task.taskId,
      buildDeveloperDecisionBrief({ task: task.projection, contract, packet, evaluation }),
      decisionAuthoringPacket({
        task: task.projection,
        contract,
        facts,
        challenges,
        handoff,
        evaluation,
      }),
    );
  }
  const disposition = currentAttempt.evidenceDispositionPath
    ? readJsonArtifact<EvidenceDisposition>(
        resolve(task.projectRoot, currentAttempt.evidenceDispositionPath),
        `Evidence disposition for ${currentAttempt.attemptId}`,
      )
    : undefined;
  const required = requiredChallengeObligationIds(contract, facts);
  const pending = pendingChallengeObligationIds(required, challenges);
  if (disposition) {
    const packet = disposition.route === 'revise-verification'
      ? verificationRevisionAuthoringPacket({ task: task.projection, contract, facts })
      : disposition.route === 'challenge'
        ? challengeExecutionPacket({
            task: task.projection, contract, facts,
            completedObligationIds: completedChallengeObligationIds(challenges),
            requiredObligationIds: required,
          })
        : disposition.route === 'handoff'
          ? handoffAuthoringPacket({
              task: task.projection, contract, facts, challenges,
              requiredObligationIds: required,
              challengeAttestationAvailable,
            })
          : undefined;
    return diagnosisHostAction(disposition.route, task.taskId, packet);
  }
  if (challenges.some((challenge) => challenge.outcome !== 'supported')) {
    return adverseChallengeHostAction(task.taskId, diagnosisAuthoringPacket({
      task: task.projection,
      contract,
      facts,
      challenges,
    }));
  }
  return collectedHostAction({
    facts,
    taskId: task.taskId,
    diagnosisPacket: diagnosisAuthoringPacket({ task: task.projection, contract, facts }),
    ...(pending.length ? {
      challengePacket: challengeExecutionPacket({
        task: task.projection, contract, facts,
        completedObligationIds: completedChallengeObligationIds(challenges),
        requiredObligationIds: required,
      }),
    } : {}),
    handoffPacket: handoffAuthoringPacket({
      task: task.projection, contract, facts, challenges,
      requiredObligationIds: required,
      challengeAttestationAvailable,
    }),
    pendingChallengeObligationIds: pending,
  });
}

export function readDelegationTask(projectRoot: string, taskId: string): LoadedTask {
  return loadTask(projectRoot, taskId);
}

function prepareReplayResult(task: LoadedTask, challengeAttestationAvailable: boolean) {
  const contract = readContract(task);
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'prepare-replayed' as const,
    taskId: task.taskId,
    task: compactTask(task.projection),
    taskContract: contractWorkPacket(contract),
    baseline: summarizeWorktree(readBaseline(task)),
    baselineVerification: summarizeBaselineVerification(readBaselineVerification(task)),
    details: {
      taskPath: task.taskPath,
      eventsPath: task.eventsPath,
      explain: { taskId: task.taskId, section: 'contract' as const },
    },
    taskCreated: false,
    replayed: true,
    hostAction: currentTaskHostAction(task, challengeAttestationAvailable),
  };
}

async function readInputDocument<Schema extends Parameters<typeof parseArtifact>[0]>(
  projectRoot: string,
  pathInput: string,
  input: Readable | undefined,
  schema: Schema,
  label: string,
): Promise<ReturnType<typeof parseArtifact<Schema>>> {
  const sourceLabel = pathInput === '-' ? 'stdin' : safeInputPath(projectRoot, pathInput, label);
  let text: string;
  try {
    text = pathInput === '-'
      ? await readUtf8Stream(input ?? process.stdin)
      : readFileSync(sourceLabel, 'utf8');
  } catch (error) {
    throw inputError(`Failed to read ${label} from ${sourceLabel}.`, error);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw inputError(`${label} from ${sourceLabel} is not valid JSON.`, error);
  }
  try {
    return parseArtifact(schema, value, label) as ReturnType<typeof parseArtifact<Schema>>;
  } catch (error) {
    throw attachProtocolInputCorrection(error, {
      label,
      source: pathInput === '-'
        ? { transport: 'stdin' }
        : { transport: 'file', path: sourceLabel },
      submittedDocument: value,
    });
  }
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

function readChallenges(task: LoadedTask): IndependentChallenge[] {
  return task.projection.challengeIds.map((id) =>
    readJsonArtifact<IndependentChallenge>(
      taskArtifactPath(task.taskDirectory, challengePath(id)),
      `Challenge ${id}`,
    ));
}

function readHostChallengeReceipts(
  task: LoadedTask,
  challenges: IndependentChallenge[],
): HostChallengeRunReceipt[] {
  return challenges.flatMap((challenge) => challenge.attestationId
    ? [readJsonArtifact<HostChallengeRunReceipt>(
        taskArtifactPath(task.taskDirectory, hostChallengeReceiptPath(challenge.attestationId)),
        `Host Challenge Run Receipt ${challenge.attestationId}`,
      )]
    : []);
}

function readVerificationRevisions(task: LoadedTask): unknown[] {
  return task.projection.verificationRevisionIds.map((id) =>
    readJsonArtifact(
      taskArtifactPath(task.taskDirectory, verificationRevisionPath(id)),
      `Verification Revision ${id}`,
    ));
}

function readEvidenceDispositions(task: LoadedTask): EvidenceDisposition[] {
  return task.projection.attempts.flatMap((attempt) => {
    if (!attempt.evidenceDispositionPath) return [];
    return [readJsonArtifact<EvidenceDisposition>(
      resolve(task.projectRoot, attempt.evidenceDispositionPath),
      `Evidence disposition for ${attempt.attemptId}`,
    )];
  });
}

function readCurrentEvidenceDisposition(task: LoadedTask): EvidenceDisposition | undefined {
  const current = task.projection.attempts.find((attempt) =>
    attempt.attemptId === task.projection.currentAttemptId);
  if (!current?.evidenceDispositionPath) return undefined;
  return readJsonArtifact<EvidenceDisposition>(
    resolve(task.projectRoot, current.evidenceDispositionPath),
    `Evidence disposition for ${current.attemptId}`,
  );
}

function readCurrentChallenges(task: LoadedTask): IndependentChallenge[] {
  const attempt = task.projection.attempts.find((item) =>
    item.attemptId === task.projection.currentAttemptId);
  if (!attempt?.factCollectionId) return [];
  return readChallenges(task).filter((challenge) =>
    challenge.effectiveContractId === task.projection.effectiveContractId
    && challenge.attemptId === attempt.attemptId
    && challenge.factCollectionId === attempt.factCollectionId);
}

function readCurrentHandoff(task: LoadedTask): CognitiveHandoff {
  if (!task.projection.currentHandoffId) throw usageError('Task has no evaluated Cognitive Handoff.');
  const handoff = readJsonArtifact<CognitiveHandoff>(
    taskArtifactPath(task.taskDirectory, handoffPath(task.projection.currentHandoffId)),
    'Cognitive Handoff',
  );
  if (handoff.handoffFingerprint !== task.projection.currentHandoffFingerprint) {
    throw new Error('Stored Cognitive Handoff fingerprint differs from the task projection.');
  }
  return handoff;
}

function materializeHandoff(
  source: CognitiveHandoffDocument,
  contract: TaskContract,
  facts: FactBundle,
): CognitiveHandoff {
  const projection = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    handoffId: `handoff:${randomUUID()}`,
    ...source,
    reviewQuestions: source.reviewQuestions.map((question) => ({
      id: `review:${randomUUID()}`,
      ...question,
    })),
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
    ...source,
    humanEvent: {
      id: generatedHumanEventId(source.humanEvent, source.action === 'correction-requested'
        ? 'correction' : 'decision'),
      kind: source.action === 'correction-requested' ? 'correction' as const : 'decision' as const,
      ...source.humanEvent,
      contentFingerprint: sha256(source.humanEvent.content),
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
  challenges: IndependentChallenge[],
  handoff: CognitiveHandoff,
  evaluation: HandoffEvaluation,
  decision?: HumanDecision,
): DecisionPacket {
  const comparisonByDefinition = new Map(facts.checkComparisons.map((item) =>
    [item.definitionId, item.relation]));
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    authority: contract.authority,
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
      ...(decision ? { humanDecision: decision } : {}),
    },
    systemMeaning: {
      summary: handoff.summary,
      importantSystemEffects: handoff.importantSystemEffects,
      residualUnknowns: handoff.residualUnknowns,
    },
    conditions: contract.adoptionConditions.map((condition) => ({
      id: condition.id,
      key: condition.key,
      statement: condition.statement,
      criticality: condition.criticality,
      conclusion: handoff.conditionConclusions.find((item) =>
        item.conditionId === condition.id)!,
      obligations: condition.evidenceObligations.map((obligation) => ({
        id: obligation.id,
        key: obligation.key,
        statement: obligation.statement,
        falsification: obligation.falsification,
        conclusion: handoff.obligationConclusions.find((item) =>
          item.obligationId === obligation.id)!,
        challengeIds: challenges
          .filter((item) => item.obligationIds.includes(obligation.id))
          .map((item) => item.id),
      })),
    })),
    attention: evaluation.attention,
    reviewQuestions: handoff.reviewQuestions,
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
        argv: check.argv,
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
      challenges: challenges.map((challenge) => ({
        id: challenge.id,
        obligationIds: challenge.obligationIds,
        conditionIds: challenge.conditionIds,
        independence: challenge.independence,
        falsification: challenge.falsification,
        falsificationAttempt: challenge.falsificationAttempt,
        observedResult: challenge.observedResult,
        supportingEvidence: challenge.supportingEvidence,
        counterEvidence: challenge.counterEvidence,
        outcome: challenge.outcome,
        conclusion: challenge.conclusion,
      })),
    },
    detailSections: ['contract', 'attempts', 'challenge', 'handoff', 'events'],
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
    challenges: [],
    currentEvidenceDisposition: readCurrentEvidenceDisposition(task),
    hostPolicyEvaluations: task.projection.hostPolicyEvaluations,
    deliveryExhausted: task.projection.deliveryStatus === 'exhausted',
    verificationRevised: task.projection.verificationRevised,
    handoff: {} as CognitiveHandoff,
  });
  return {
    ...evaluation,
    taskId: task.taskId,
    stateWritten: false,
    hostAction: staleFactsHostAction(task.taskId),
  };
}

async function currentFactsAreStale(task: LoadedTask, facts: FactBundle): Promise<boolean> {
  const current = await captureGitWorktree(task.projectRoot, {
    objectDirectory: taskArtifactPath(task.taskDirectory, WORKTREE_OBJECTS_DIRECTORY),
  });
  return current.fingerprint !== facts.current.fingerprint;
}

function validateChallengeReferences(
  source: ChallengeDocument,
  contract: TaskContract,
  facts: FactBundle,
): void {
  const obligations = contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations);
  assertReferences(source.obligationIds, obligations.map((obligation) => obligation.id), 'evidence obligation');
  const selected = source.obligationIds.map((id) =>
    obligations.find((obligation) => obligation.id === id)!);
  if (selected.some((obligation) =>
    stableFingerprint(obligation.falsification) !== stableFingerprint(source.falsification))) {
    throw inputError('Challenge must preserve the exact frozen falsification design for every selected obligation; challenge obligations with different designs separately.');
  }
  assertReferences(source.evidence.changedFiles, facts.changedFiles.map((file) => file.id), 'changed file');
  assertReferences(source.evidence.checks, facts.checks.map((check) => check.definitionId), 'check');
  assertReferences(source.evidence.repositoryEvidence, contract.repositoryEvidence.map((item) => item.id), 'repository evidence');
  assertReferences(
    source.evidence.humanEvents,
    contract.authority.developerEvents.map((item) => item.id),
    'Human Event',
  );
  if (source.evidence.patch && !facts.patch) throw inputError('Challenge selected a patch that does not exist.');
  const nestedIssues = challengeReferenceIssues(source);
  if (nestedIssues.length) {
    throw inputError(
      'Challenge evidence claims contain unavailable references.',
      undefined,
      nestedIssues.map((item) => ({
        code: 'challenge-evidence-reference-invalid',
        path: item.path,
        message: item.message,
        remediation: 'Use only exact references selected by the current Challenge Execution Packet.',
      })),
    );
  }
}

function assertReferences(selected: string[], available: string[], label: string): void {
  const set = new Set(available);
  for (const value of selected) if (!set.has(value)) throw inputError(`Unknown ${label} reference ${JSON.stringify(value)}.`);
}

function assertTaskOpenForCollection(task: LoadedTask): void {
  if (task.projection.pendingResolution) {
    throw usageError(`Task ${task.taskId} requires an exact Human resolution before collection.`);
  }
  if (task.projection.decisionStatus !== 'pending') {
    throw usageError(`Task ${task.taskId} is already ${task.projection.decisionStatus}.`);
  }
  if (task.projection.deliveryStatus === 'exhausted') {
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
    return { definition, previous, timeoutMs: retry.timeoutMs };
  });
}

function assertCheckTimeout(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw usageError(`${label} must be a positive safe integer.`);
}

function assertFactBundleIdentity(bundle: FactBundle, effectiveContractId: string, attemptId: string): void {
  if (bundle.effectiveContractId !== effectiveContractId || bundle.attemptId !== attemptId) {
    throw new Error('Fact Bundle is bound to another contract or Attempt.');
  }
  const { factCollectionId: _collection, bundleFingerprint: _bundle, ...base } = bundle;
  if (bundle.factCollectionId !== factCollectionId(base)) {
    throw new Error('Collected machine facts changed after collection.');
  }
  const { bundleFingerprint: _ignored, ...projection } = bundle;
  if (bundle.bundleFingerprint !== stableFingerprint(projection)) {
    throw new Error('Fact Bundle fingerprint does not match its content.');
  }
}

function factCollectionId(bundle: Omit<FactBundle, 'factCollectionId' | 'bundleFingerprint'>): string {
  return stableFingerprint({
    protocol: bundle.protocol,
    schemaVersion: bundle.schemaVersion,
    effectiveContractId: bundle.effectiveContractId,
    attemptId: bundle.attemptId,
    baseline: bundle.baseline,
    preCheck: bundle.preCheck,
    current: bundle.current,
    baselineVerification: bundle.baselineVerification,
    changeFingerprint: bundle.changeFingerprint,
    changedFiles: bundle.changedFiles,
    checkInducedChanges: bundle.checkInducedChanges,
    checks: bundle.checks,
    checkComparisons: bundle.checkComparisons,
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

function validateEvidenceDispositionInput(
  source: EvidenceDispositionDocument,
  contract: TaskContract,
  facts: FactBundle,
  challenges: IndependentChallenge[],
): void {
  const expected = [
    ...facts.checks
    .filter((check) => latestCheckAttempt(check).status !== 'passed')
    .map((check) => `check:${check.definitionId}`),
    ...challenges
      .filter((challenge) => challenge.outcome !== 'supported')
      .map((challenge) => `challenge:${challenge.id}`),
  ].sort();
  const selected = source.entries.map((entry) => evidenceConcernIdentity(entry.source)).sort();
  if (new Set(selected).size !== selected.length
    || selected.length !== expected.length
    || selected.some((id, index) => id !== expected[index])) {
    throw inputError('Evidence disposition must diagnose every current non-passing check and adverse Challenge exactly once.');
  }
  const availableChecks = new Set(
    contract.verificationPlan.mode === 'checks'
      ? contract.verificationPlan.definitions.map((check) => check.definitionId) : [],
  );
  const availableChallenges = new Set(challenges
    .filter((challenge) => challenge.outcome !== 'supported')
    .map((challenge) => challenge.id));
  for (const [index, entry] of source.entries.entries()) {
    if (entry.source.kind === 'check' && !availableChecks.has(entry.source.definitionId)) {
      throw inputError(`Unknown frozen check ${JSON.stringify(entry.source.definitionId)} in evidence disposition.`);
    }
    if (entry.source.kind === 'challenge' && !availableChallenges.has(entry.source.challengeId)) {
      throw inputError(`Unknown or non-adverse Challenge ${JSON.stringify(entry.source.challengeId)} in evidence disposition.`);
    }
    if (!validDispositionChange(entry)) {
      throw inputError(
        `Evidence disposition entry ${index} has an inconsistent cause, change surface, or intended repository changes.`,
      );
    }
  }
  if (source.semanticImpact === 'material') {
    if (source.proposedRoute !== 'ask-human') {
      throw inputError('Material semantic impact requires the explicit ask-human route.');
    }
    return;
  }
  const compatibleRoutes = {
    implementation: new Set(['repair-delivery', 'handoff']),
    environment: new Set(['revise-verification', 'handoff']),
    verification: new Set(['repair-delivery', 'revise-verification', 'handoff']),
    unknown: new Set(['challenge', 'handoff', 'ask-human']),
  } satisfies Record<EvidenceDispositionDocument['entries'][number]['cause'], Set<string>>;
  const hasRepositoryRepair = source.entries.some((entry) =>
    entry.repositoryChangeCanAlterObservation);
  const incompatible = source.entries.filter((entry) => {
    if (entry.source.kind === 'challenge' && source.proposedRoute === 'challenge') return true;
    if (source.proposedRoute === 'repair-delivery'
      && hasRepositoryRepair
      && entry.cause === 'environment') {
      return false;
    }
    return !compatibleRoutes[entry.cause].has(source.proposedRoute);
  });
  if (incompatible.length) {
    throw inputError(
      `Proposed route ${source.proposedRoute} is incompatible with declared cause(s): `
      + unique(incompatible.map((entry) => entry.cause)).join(', ') + '.',
    );
  }
  if (source.proposedRoute === 'repair-delivery' && !hasRepositoryRepair) {
    throw inputError('Delivery repair requires at least one explicit production or verification-surface change.');
  }
}

function validDispositionChange(
  entry: EvidenceDispositionDocument['entries'][number],
): boolean {
  const hasChanges = entry.intendedChanges.length > 0;
  if (entry.cause === 'implementation') {
    return entry.repositoryChangeCanAlterObservation
      && entry.changeSurface === 'production'
      && hasChanges;
  }
  if (entry.cause === 'verification') {
    return (entry.repositoryChangeCanAlterObservation
        && entry.changeSurface === 'verification-surface'
        && hasChanges)
      || (!entry.repositoryChangeCanAlterObservation
        && entry.changeSurface === 'none'
        && !hasChanges);
  }
  return !entry.repositoryChangeCanAlterObservation
    && entry.changeSurface === 'none'
    && !hasChanges;
}

function evidenceConcernIdentity(source: EvidenceDispositionDocument['entries'][number]['source']): string {
  return source.kind === 'check'
    ? `check:${source.definitionId}`
    : `challenge:${source.challengeId}`;
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

function pendingChallengeObligationIds(
  requiredObligationIds: string[],
  challenges: IndependentChallenge[],
): string[] {
  const covered = new Set(challenges.flatMap((challenge) => challenge.obligationIds));
  return requiredObligationIds.filter((id) => !covered.has(id));
}

function completedChallengeObligationIds(challenges: IndependentChallenge[]): string[] {
  return unique(challenges.flatMap((challenge) => challenge.obligationIds));
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

function compactCheckFact(check: CheckFact) {
  const latest = latestCheckAttempt(check);
  return {
    verifierId: check.verifierId,
    definitionId: check.definitionId,
    status: latest.status,
    termination: latest.termination,
    timeoutMs: latest.timeoutMs,
    attemptCount: check.attempts.length,
    ...(latest.reason ? { reason: latest.reason } : {}),
    stdout: { byteLength: latest.stdout.byteLength, truncated: latest.stdout.truncated, ...(latest.stdout.logPath ? { logPath: latest.stdout.logPath } : {}) },
    stderr: { byteLength: latest.stderr.byteLength, truncated: latest.stderr.truncated, ...(latest.stderr.logPath ? { logPath: latest.stderr.logPath } : {}) },
  };
}

function summarizeBaselineVerification(fact: BaselineVerificationFact) {
  return {
    fingerprint: fact.fingerprint,
    capturedAt: fact.capturedAt,
    checkInducedChanges: fact.checkInducedChanges.map((file) => ({
      path: file.path,
      operation: file.operation,
    })),
    checks: fact.checks.map((check) => ({
      definitionId: check.definitionId,
      mode: check.mode,
      observation: check.observation ? compactCheckFact(check.observation) : null,
    })),
  };
}

function contractWorkPacket(contract: TaskContract) {
  return {
    semanticContractId: contract.semanticContractId,
    verificationPlanId: contract.verificationPlanId,
    effectiveContractId: contract.effectiveContractId,
    authority: {
      developerEventIds: contract.authority.developerEvents.map((item) => item.id),
      repositoryEvidenceIds: contract.repositoryEvidence.map((evidence) => evidence.id),
    },
    understanding: {
      desiredOutcome: compactMeaning(contract.understanding.desiredOutcome),
      constraints: contract.understanding.constraints.map(compactMeaning),
      nonGoals: contract.understanding.nonGoals.map(compactMeaning),
      focus: contract.understanding.focus.map(compactMeaning),
    },
    materialDecisions: contract.materialDecisions,
    adoptionConditions: contract.adoptionConditions,
    hostPolicyRequirements: contract.hostPolicyRequirements,
    plan: contract.plan,
    verificationPlan: contract.verificationPlan,
  };
}

function compactMeaning(value: TaskContract['understanding']['desiredOutcome']) {
  return { value: value.value, basis: value.basis };
}

function compactTask(task: TaskProjection) {
  return {
    revision: task.revision,
    deliveryStatus: task.deliveryStatus,
    evidenceStatus: task.evidenceStatus,
    decisionStatus: task.decisionStatus,
    currentAttemptId: task.currentAttemptId,
    repairCount: task.repairCount,
  };
}

function clearPostCollectionArtifacts(projection: TaskProjection): TaskProjection {
  const {
    currentHandoffId: _handoff,
    currentHandoffFingerprint: _fingerprint,
    decisionId: _decision,
    terminalAt: _terminal,
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

async function materializeHostPolicyEvaluations(
  taskId: string,
  contract: TaskContract,
  provider: HostAttestationProvider | undefined,
): Promise<HostPolicyEvaluation[]> {
  if (!provider) {
    return contract.hostPolicyRequirements.map((requirement) => ({
      requirementId: requirement.id,
      mode: 'instruction-only',
      provenance: 'thin-skill',
    }));
  }
  const evaluations = await provider.evaluatePolicies({
    taskId,
    requirements: contract.hostPolicyRequirements,
  });
  const parsed = evaluations.map((evaluation) => parseArtifact(
    HostPolicyEvaluationSchema,
    evaluation,
    'Host policy enforcement attestation',
  ));
  const expected = contract.hostPolicyRequirements.map((item) => item.id).sort();
  const actual = parsed.map((item) => item.requirementId).sort();
  if (new Set(actual).size !== actual.length
    || stableFingerprint(actual) !== stableFingerprint(expected)
    || parsed.some((item) => item.provenance !== provider.provenance)) {
    throw inputError('Trusted Host policy attestations must cover every requirement exactly once with the provider provenance.');
  }
  return parsed;
}

function materializeResolution(source: HumanResolutionDocument, contract: TaskContract) {
  const kind = source.target.kind === 'correction' || source.action === 'request-correction'
    ? 'correction' as const : 'exception' as const;
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    resolutionId: `resolution:${randomUUID()}`,
    effectiveContractId: contract.effectiveContractId,
    humanEvent: {
      id: generatedHumanEventId(source.humanEvent, kind),
      kind,
      ...source.humanEvent,
      contentFingerprint: sha256(source.humanEvent.content),
    },
    target: source.target,
    action: source.action,
    reason: source.reason,
  };
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
        id: generatedHumanEventId(source.humanAuthorization, 'exception'),
        kind: 'exception' as const,
        ...source.humanAuthorization,
        contentFingerprint: sha256(source.humanAuthorization.content),
      },
    } : {}),
  };
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
  if (source.target.kind !== pending.kind) return false;
  const targetId = source.target.kind === 'semantic-impact'
    ? source.target.dispositionId
    : source.target.kind === 'correction'
      ? source.target.decisionId
      : source.target.requirementId;
  return targetId === pending.targetId;
}

function withoutPendingResolution(projection: TaskProjection): TaskProjection {
  const { pendingResolution: _pending, ...remaining } = projection;
  return remaining;
}

function assertStoredContractFingerprints(contract: TaskContract): void {
  const semanticProjection = {
    protocol: contract.protocol,
    schemaVersion: contract.schemaVersion,
    authority: contract.authority,
    understanding: contract.understanding,
    repositoryEvidence: contract.repositoryEvidence,
    materialDecisions: contract.materialDecisions,
    adoptionConditions: contract.adoptionConditions,
    hostPolicyRequirements: contract.hostPolicyRequirements,
    authorization: contract.authorization,
  };
  const { verificationPlanId: _verificationPlanId, ...verificationProjection } = contract.verificationPlan;
  if (contract.semanticContractId !== stableFingerprint(semanticProjection)
    || contract.verificationPlanId !== stableFingerprint(verificationProjection)
    || contract.verificationPlanId !== contract.verificationPlan.verificationPlanId
    || contract.effectiveContractId !== stableFingerprint({
      semanticContractId: contract.semanticContractId,
      verificationPlanId: contract.verificationPlanId,
    })) {
    throw new Error('Stored Task Contract changed after compilation.');
  }
}

function contractPath(revision: number): string {
  return `contracts/${revision}.json`;
}

function planPath(revision: number): string {
  return `contracts/${revision}.plan.json`;
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

function challengePath(id: string): string {
  return `challenges/${sha256(id).slice(-32)}.json`;
}

function hostChallengeReceiptPath(id: string): string {
  return `host-receipts/${sha256(id).slice(-32)}.json`;
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

function handoffInputError(error: unknown) {
  if (isHandoffValidationError(error)) {
    return inputError('Cognitive Adoption input cannot be evaluated; correct every reported issue.', error, error.issues);
  }
  return inputError(`Cognitive Adoption input cannot be evaluated: ${error instanceof Error ? error.message : String(error)}`, error);
}

function isHandoffValidationError(value: unknown): value is Error & { issues: HandoffValidationIssue[] } {
  const candidate = value as { name?: unknown; issues?: unknown };
  return value instanceof Error
    && candidate.name === 'HandoffValidationError'
    && Array.isArray(candidate.issues);
}
