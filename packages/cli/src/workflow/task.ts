import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type DecisionPacket,
  type FactBundle,
  type HandoffEvidenceReference,
  type HumanDecision,
  type TaskContract,
  type VerificationDefinition,
  type VerifierMutation,
} from '@sovea/stetra-core';

import { inputError, usageError } from '../errors.ts';
import { captureVerificationInputs, verificationInputSetFingerprint } from '../facts/execution-inputs.ts';
import { collectExecutionEnvironment } from '../facts/environment.ts';
import { runFrozenChecks } from '../facts/checks.ts';
import {
  assertWorktreeSnapshot,
  captureGitWorktree,
  collectGitWorktreeChange,
  compareGitWorktrees,
  summarizeWorktree,
  type WorktreeSnapshot,
} from '../facts/worktree.ts';
import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION, sha256, stableFingerprint } from '../protocol.ts';
import { readProjectConfig } from '../schemas/config.ts';
import type {
  TaskBeginDocument,
  TaskDecisionDocument,
  TaskHandoffDocument,
  TaskProjection,
} from '../schemas/task.ts';
import {
  canonicalProjectRoot,
  commitCollectionTransition,
  createCollectionStagingDirectory,
  createTaskWorkspace,
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

const CONTRACT_PATH = 'contract.json';
const BASELINE_PATH = 'baseline.json';

export interface TaskDirective {
  kind: 'work' | 'continue-work' | 'author-handoff' | 'await-human-decision' | 'complete';
  message: string;
}

export async function beginTask(options: {
  projectRoot: string;
  source: TaskBeginDocument;
  productVersion: string;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const config = readProjectConfig(projectRoot);
  const verification = resolveVerification(options.source, config);
  const compiled = compileDelegation({
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    humanEvent: options.source.humanEvent,
    interpretation: options.source.interpretation,
    assurance: options.source.assurance,
    verification,
    executionPolicy: config.executionPolicy,
  });
  if (compiled.status !== 'delegation-compiled') {
    throw inputError('Task alignment is invalid.', undefined, compiled.issues);
  }
  const taskId = randomUUID();
  const attemptId = `attempt:${randomUUID()}`;
  let task: LoadedTask | undefined;
  await withWorktreeLease({ projectRoot, operation: 'begin', taskId }, async () => {
    const workspace = createTaskWorkspace(projectRoot, taskId);
    try {
      const baseline = await captureGitWorktree(projectRoot, {
        objectDirectory: workspace.objectDirectory,
      });
      const baselineId = stableFingerprint(baseline);
      const projection: TaskProjection = {
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        taskId,
        revision: 1,
        contractId: compiled.contract.contractId,
        effectiveContractId: compiled.contract.effectiveContractId,
        attemptId,
        attemptNumber: 1,
        baselineId,
        phase: 'working',
        collectionIds: [],
        handoffIds: [],
        decisionIds: [],
      };
      task = initializeTask({
        projectRoot,
        taskId,
        stagingDirectory: workspace.taskDirectory,
        projection,
        artifacts: [
          { relativePath: CONTRACT_PATH, value: compiled.contract },
          { relativePath: BASELINE_PATH, value: baseline },
        ],
      });
    } catch (error) {
      rmSync(workspace.taskDirectory, { recursive: true, force: true });
      throw error;
    }
  });
  if (!task) throw new Error('Task Begin completed without publishing a task.');
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'task-begun',
    taskId,
    phase: 'working',
    summary: contractSummary(compiled.contract),
    directive: directive('work', 'Implement the aligned change through the normal Host workflow.'),
  };
}

export async function collectTask(options: {
  projectRoot: string;
  taskId: string;
  productVersion: string;
  retryTimeout?: { checkKey: string; timeoutMs: number };
}) {
  const initial = loadTask(options.projectRoot, options.taskId);
  assertTaskOpen(initial);
  const contract = readContract(initial);
  const definitions = definitionsFor(contract);
  const existing = initial.projection.currentCollectionId
    ? readFacts(initial, initial.projection.currentCollectionId) : undefined;
  const existingIsCurrent = existing
    ? await factsAreCurrent(initial, contract, existing) : false;
  if (existing && existingIsCurrent && !options.retryTimeout) {
    return collectionOutput(initial, existing, true);
  }
  const retry = options.retryTimeout
    ? resolveTimeoutRetry(contract, existing, existingIsCurrent, options.retryTimeout)
    : undefined;

  let facts: FactBundle | undefined;
  let transitioned: LoadedTask | undefined;
  await withWorktreeLease({
    projectRoot: initial.projectRoot,
    operation: 'collect',
    taskId: initial.taskId,
  }, async () => {
    const task = loadTask(initial.projectRoot, initial.taskId);
    if (task.projection.revision !== initial.projection.revision) {
      throw usageError(`Task ${task.taskId} changed before collection began.`);
    }
    const staging = createCollectionStagingDirectory(task.projectRoot);
    const artifacts = join(staging, 'artifacts');
    const objects = join(staging, 'objects');
    const durableObjects = taskArtifactPath(task.taskDirectory, 'worktree-objects');
    const collectionOrdinal = task.projection.collectionIds.length + 1;
    const attemptRelative = `attempts/${task.projection.attemptNumber}/collection-${collectionOrdinal}`;
    try {
      const baseline = readBaseline(task);
      const preCheck = await captureGitWorktree(task.projectRoot, {
        objectDirectory: objects,
        alternateObjectDirectories: [durableObjects],
      });
      const preCheckExecutionInputs = captureVerificationInputs(task.projectRoot, definitions);
      if (retry && existing && (preCheck.fingerprint !== existing.current.fingerprint
        || verificationInputSetFingerprint(preCheckExecutionInputs)
          !== verificationInputSetFingerprint(existing.currentExecutionInputs))) {
        throw usageError('The worktree or declared Check inputs changed before timeout retry; collect current facts instead.');
      }
      const checksRelative = `${attemptRelative}/checks`;
      const checks = await collectChecks({
        projectRoot: task.projectRoot,
        definitions,
        contract,
        existing,
        retry,
        outputDirectory: taskArtifactPath(artifacts, checksRelative),
        recordedOutputDirectory: taskArtifactPath(task.taskDirectory, checksRelative),
      });
      const worktree = await collectGitWorktreeChange(task.projectRoot, baseline, {
        objectDirectory: objects,
        alternateObjectDirectories: [durableObjects],
      });
      const currentExecutionInputs = captureVerificationInputs(task.projectRoot, definitions);
      const checkInducedChanges = compareGitWorktrees(preCheck, worktree.current);
      const patchRelative = `${attemptRelative}/change.patch`;
      const publishedPatchPath = taskArtifactPath(task.taskDirectory, patchRelative);
      const patch = worktree.patch.length ? {
        path: projectRelativePath(task.projectRoot, publishedPatchPath),
        digest: sha256(worktree.patch),
        byteLength: worktree.patch.length,
      } : undefined;
      if (patch) writeImmutableBuffer(taskArtifactPath(artifacts, patchRelative), worktree.patch);
      const base: Omit<FactBundle, 'factCollectionId'> = {
        protocol: DELEGATION_PROTOCOL,
        schemaVersion: DELEGATION_SCHEMA_VERSION,
        effectiveContractId: contract.effectiveContractId,
        attemptId: task.projection.attemptId,
        baseline: summarizeWorktree(baseline),
        preCheck: summarizeWorktree(preCheck),
        current: summarizeWorktree(worktree.current),
        preCheckExecutionInputs,
        currentExecutionInputs,
        changeFingerprint: worktree.changeFingerprint,
        changedFiles: worktree.changedFiles,
        checkInducedChanges,
        checks,
        verifierMutations: collectVerifierMutations(definitions, worktree.changedFiles),
        environment: collectExecutionEnvironment(task.projectRoot, definitions),
        ...(patch ? { patch } : {}),
        provenance: {
          collector: 'stetra-cli',
          cliVersion: options.productVersion,
          coreVersion: options.productVersion,
        },
      };
      const factCollectionId = stableFingerprint(base);
      facts = { ...base, factCollectionId };
      const factsRelative = factsPath(factCollectionId);
      writeImmutableJson(taskArtifactPath(artifacts, factsRelative), facts);
      const artifactRefs = [
        projectRelativePath(task.projectRoot, taskArtifactPath(task.taskDirectory, factsRelative)),
        ...(patch ? [patch.path] : []),
        ...factLogPaths(facts),
      ];
      const passing = checks.every((check) => latestCheck(check).status === 'passed');
      transitioned = commitCollectionTransition({
        projectRoot: task.projectRoot,
        taskId: task.taskId,
        expectedRevision: task.projection.revision,
        stagedArtifactsDirectory: artifacts,
        artifactRefs: unique(artifactRefs),
        projection: {
          ...task.projection,
          phase: passing ? 'awaiting-handoff' : 'working',
          collectionIds: [...task.projection.collectionIds, factCollectionId],
          currentCollectionId: factCollectionId,
          currentHandoffId: undefined,
          currentDecisionId: undefined,
          terminalDecision: undefined,
        },
      });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
  if (!facts || !transitioned) throw new Error('Collection completed without current facts.');
  return collectionOutput(transitioned, facts, false);
}

function resolveTimeoutRetry(
  contract: TaskContract,
  existing: FactBundle | undefined,
  existingIsCurrent: boolean,
  requested: { checkKey: string; timeoutMs: number },
) {
  if (!existing || !existingIsCurrent) {
    throw usageError('Timeout retry requires one current Fact Collection. Collect current facts first.');
  }
  const definition = definitionsFor(contract).find((candidate) => candidate.key === requested.checkKey);
  if (!definition) throw inputError(`Unknown Check ${requested.checkKey}.`);
  const check = existing.checks.find((candidate) => candidate.definitionId === definition.definitionId);
  if (!check) throw new Error(`Current facts omit Check ${requested.checkKey}.`);
  const latest = latestCheck(check);
  if (latest.termination.kind !== 'timeout') {
    throw usageError(`Check ${requested.checkKey} did not time out in its current Attempt.`);
  }
  const retriesUsed = check.attempts.length - 1;
  if (retriesUsed >= contract.executionPolicy.maxTimeoutRetriesPerCheck) {
    throw usageError(`Check ${requested.checkKey} has exhausted its bounded timeout retries.`);
  }
  if (requested.timeoutMs <= latest.timeoutMs
    || requested.timeoutMs > contract.executionPolicy.maxTimeoutMs) {
    throw inputError(
      `Timeout retry for ${requested.checkKey} must exceed ${latest.timeoutMs} ms and not exceed ${contract.executionPolicy.maxTimeoutMs} ms.`,
    );
  }
  return { definition, check, timeoutMs: requested.timeoutMs };
}

async function collectChecks(input: {
  projectRoot: string;
  definitions: VerificationDefinition[];
  contract: TaskContract;
  existing: FactBundle | undefined;
  retry: ReturnType<typeof resolveTimeoutRetry> | undefined;
  outputDirectory: string;
  recordedOutputDirectory: string;
}): Promise<FactBundle['checks']> {
  if (!input.retry) {
    return runFrozenChecks({
      projectRoot: input.projectRoot,
      executions: input.definitions.map((definition) => ({
        definition,
        timeoutMs: input.contract.executionPolicy.checkTimeoutMs,
      })),
      outputDirectory: input.outputDirectory,
      recordedOutputDirectory: input.recordedOutputDirectory,
    });
  }
  const retried = (await runFrozenChecks({
    projectRoot: input.projectRoot,
    executions: [{
      definition: input.retry.definition,
      timeoutMs: input.retry.timeoutMs,
      previousAttempts: input.retry.check.attempts,
    }],
    outputDirectory: input.outputDirectory,
    recordedOutputDirectory: input.recordedOutputDirectory,
  }))[0];
  return input.definitions.map((definition) => definition.definitionId === retried.definitionId
    ? retried
    : structuredClone(input.existing!.checks.find((check) =>
        check.definitionId === definition.definitionId)!));
}

export async function handoffTask(options: {
  projectRoot: string;
  taskId: string;
  source: TaskHandoffDocument;
}) {
  const task = loadTask(options.projectRoot, options.taskId);
  assertTaskOpen(task);
  const contract = readContract(task);
  const facts = readCurrentFacts(task);
  const current = await captureCurrent(task);
  if (!factsMatchCurrent(task, contract, facts, current)) {
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'facts-stale',
      taskId: task.taskId,
      phase: 'working',
      stateWritten: false,
      directive: directive('continue-work', 'The worktree or declared check inputs changed; collect current facts before Handoff.'),
    };
  }
  const handoff = materializeHandoff(options.source, contract, facts);
  const evaluation = evaluateAuthoredHandoff(contract, facts, current.worktree.fingerprint, handoff);
  const packet = buildDecisionPacket(contract, facts, handoff, evaluation);
  const transitioned = transitionTask({
    projectRoot: task.projectRoot,
    taskId: task.taskId,
    type: 'handoff-authored',
    actor: 'agent',
    artifacts: [{ relativePath: handoffPath(handoff.handoffId), value: handoff }],
    mutate: (currentTask) => ({
      ...currentTask.projection,
      phase: 'awaiting-decision',
      handoffIds: [...currentTask.projection.handoffIds, handoff.handoffId],
      currentHandoffId: handoff.handoffId,
      currentDecisionId: undefined,
      terminalDecision: undefined,
    }),
  });
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: evaluation.status,
    taskId: transitioned.taskId,
    phase: transitioned.projection.phase,
    decisionBrief: decisionBrief(packet),
    directive: directive('await-human-decision', 'Present the Decision Brief and wait for a new developer message.'),
  };
}

function evaluateAuthoredHandoff(
  contract: TaskContract,
  facts: FactBundle,
  currentWorktreeFingerprint: string,
  handoff: CognitiveHandoff,
) {
  try {
    return evaluateHandoff({
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      contract,
      factBundle: facts,
      currentWorktreeFingerprint,
      handoff,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'HandoffValidationError'
      && Array.isArray((error as Error & { issues?: unknown }).issues)) {
      throw inputError(
        'Task Handoff is invalid for the current evidence.',
        error,
        (error as Error & { issues: Array<{ code: string; path: string; message: string; remediation?: string }> }).issues,
      );
    }
    throw error;
  }
}

export async function decideTask(options: {
  projectRoot: string;
  taskId: string;
  source: TaskDecisionDocument;
}) {
  const task = loadTask(options.projectRoot, options.taskId);
  if (task.projection.phase !== 'awaiting-decision' || !task.projection.currentHandoffId) {
    throw usageError(`Task ${task.taskId} is not awaiting a Human decision.`);
  }
  const contract = readContract(task);
  const facts = readCurrentFacts(task);
  const handoff = readHandoff(task, task.projection.currentHandoffId);
  const current = await captureCurrent(task);
  if (!factsMatchCurrent(task, contract, facts, current)) {
    throw usageError('The worktree or declared check inputs changed after Handoff; collect and author a new Handoff.');
  }
  const pending = evaluateHandoff({
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: current.worktree.fingerprint,
    handoff,
  });
  if (options.source.action === 'accepted' && pending.attention.length
    && options.source.acknowledgeAttention !== true) {
    throw inputError('Acceptance with Attention requires acknowledgeAttention: true.');
  }
  const decision = materializeDecision(options.source, contract, facts, handoff,
    options.source.acknowledgeAttention ? pending.attention.map((item) => item.id) : []);
  const evaluation = evaluateHandoff({
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: current.worktree.fingerprint,
    handoff,
    decision,
  });
  const correction = decision.action === 'correction-requested';
  const transitioned = transitionTask({
    projectRoot: task.projectRoot,
    taskId: task.taskId,
    type: correction ? 'correction-started' : 'human-decision-recorded',
    actor: 'human',
    artifacts: [{ relativePath: decisionPath(decision.decisionId), value: decision }],
    mutate: (currentTask) => correction ? {
      ...currentTask.projection,
      attemptId: `attempt:${randomUUID()}`,
      attemptNumber: currentTask.projection.attemptNumber + 1,
      phase: 'working',
      decisionIds: [...currentTask.projection.decisionIds, decision.decisionId],
      currentCollectionId: undefined,
      currentHandoffId: undefined,
      currentDecisionId: undefined,
      terminalDecision: undefined,
    } : {
      ...currentTask.projection,
      phase: 'complete',
      decisionIds: [...currentTask.projection.decisionIds, decision.decisionId],
      currentDecisionId: decision.decisionId,
      terminalDecision: decision.action as 'accepted' | 'rejected' | 'deferred',
    },
  });
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: correction ? 'correction-started' : 'human-decision-recorded',
    taskId: transitioned.taskId,
    phase: transitioned.projection.phase,
    decision: evaluation.adoption,
    directive: correction
      ? directive('work', 'Implement the exact developer correction, then collect current facts again.')
      : directive('complete', `The Human decision is ${decision.action}.`),
  };
}

export async function inspectTask(options: {
  projectRoot: string;
  taskId: string;
  section: string;
  collectionId?: string;
  checkKey?: string;
  attempt?: number;
  stream?: 'stdout' | 'stderr';
  tailBytes?: number;
}) {
  const task = loadTask(options.projectRoot, options.taskId);
  const contract = readContract(task);
  const base = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'task-inspected',
    taskId: task.taskId,
    phase: task.projection.phase,
  };
  if (options.section === 'summary') {
    const facts = task.projection.currentCollectionId
      ? readFacts(task, task.projection.currentCollectionId) : undefined;
    return {
      ...base,
      summary: {
        ...contractSummary(contract),
        attemptNumber: task.projection.attemptNumber,
        collectionCount: task.projection.collectionIds.length,
        handoffCount: task.projection.handoffIds.length,
        decisionCount: task.projection.decisionIds.length,
        ...(facts ? { facts: factSummary(facts, contract) } : {}),
        ...(task.projection.terminalDecision
          ? { humanDecision: task.projection.terminalDecision } : {}),
      },
      directive: directiveFor(task),
    };
  }
  if (options.section === 'contract') return { ...base, contract };
  if (options.section === 'baseline') return { ...base, baseline: readBaseline(task) };
  if (options.section === 'collections') {
    return {
      ...base,
      collections: task.projection.collectionIds.map((id) => {
        const facts = readFacts(task, id);
        return { ...factSummary(facts, contract), current: id === task.projection.currentCollectionId };
      }),
    };
  }
  if (options.section === 'collection') {
    const facts = selectedFacts(task, options.collectionId);
    return { ...base, collection: facts };
  }
  if (options.section === 'check' || options.section === 'log') {
    if (!options.checkKey) throw usageError(`${options.section} inspection requires --check <key>.`);
    const facts = selectedFacts(task, options.collectionId);
    const definition = definitionsFor(contract).find((candidate) => candidate.key === options.checkKey);
    if (!definition) throw usageError(`Task has no Check ${options.checkKey}.`);
    const check = facts.checks.find((candidate) => candidate.definitionId === definition.definitionId);
    if (!check) throw new Error(`Fact Collection ${facts.factCollectionId} omits Check ${options.checkKey}.`);
    const attempt = options.attempt === undefined
      ? check.attempts.at(-1)
      : check.attempts.find((candidate) => candidate.attempt === options.attempt);
    if (!attempt) throw usageError(`Check ${options.checkKey} has no Attempt ${options.attempt ?? 'latest'}.`);
    if (options.section === 'check') {
      return { ...base, factCollectionId: facts.factCollectionId, checkKey: definition.key, check, selectedAttempt: attempt };
    }
    if (!options.stream) throw usageError('log inspection requires --stream stdout or stderr.');
    const stream = attempt[options.stream];
    return {
      ...base,
      factCollectionId: facts.factCollectionId,
      checkKey: definition.key,
      attempt: attempt.attempt,
      log: readLogTail(task, stream.logPath, options.tailBytes ?? 16_384, stream),
    };
  }
  if (options.section === 'handoff') {
    return {
      ...base,
      handoff: task.projection.currentHandoffId
        ? readHandoff(task, task.projection.currentHandoffId) : null,
    };
  }
  if (options.section === 'decision') {
    return {
      ...base,
      decision: task.projection.currentDecisionId
        ? readDecision(task, task.projection.currentDecisionId) : null,
    };
  }
  if (options.section === 'events') return { ...base, events: task.events };
  throw usageError('Inspect section must be summary, contract, baseline, collections, collection, check, log, handoff, decision, or events.');
}

function selectedFacts(task: LoadedTask, requestedId: string | undefined): FactBundle {
  const id = requestedId ?? task.projection.currentCollectionId;
  if (!id) throw usageError(`Task ${task.taskId} has no Fact Collection.`);
  if (!task.projection.collectionIds.includes(id)) {
    throw usageError(`Task ${task.taskId} has no Fact Collection ${id}.`);
  }
  return readFacts(task, id);
}

function readLogTail(
  task: LoadedTask,
  logPath: string | undefined,
  tailBytes: number,
  fact: FactBundle['checks'][number]['attempts'][number]['stdout'],
) {
  if (!Number.isSafeInteger(tailBytes) || tailBytes < 1 || tailBytes > 65_536) {
    throw usageError('Log tail must contain from 1 through 65536 bytes.');
  }
  if (!logPath) {
    return { ...fact, encoding: 'utf8-lossy', content: '', returnedBytes: 0 };
  }
  const absolute = resolve(task.projectRoot, logPath);
  const rel = relative(task.taskDirectory, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('Stored Check log path escapes task storage.');
  }
  const bytes = readFileSync(absolute);
  const tail = bytes.subarray(Math.max(0, bytes.length - tailBytes));
  return {
    ...fact,
    encoding: 'utf8-lossy',
    content: tail.toString('utf8'),
    returnedBytes: tail.length,
  };
}

export function taskContext(projectRoot: string, taskId: string) {
  const task = loadTask(projectRoot, taskId);
  return {
    taskId: task.taskId,
    phase: task.projection.phase,
    directive: directiveFor(task),
  };
}

function resolveVerification(
  source: TaskBeginDocument,
  config: ReturnType<typeof readProjectConfig>,
): Exclude<Parameters<typeof compileDelegation>[0]['verification'], undefined> {
  const requested = source.verification;
  if (requested?.mode === 'checks' || requested?.mode === 'no-command') return requested;
  const profileName = requested?.mode === 'profile'
    ? requested.name : config.defaultVerificationProfile;
  if (!profileName) {
    throw inputError('Task Begin requires exact checks, a configured verification profile, or a concrete no-command rationale.');
  }
  const profile = config.verificationProfiles[profileName];
  if (!profile) throw inputError(`Unknown verification profile ${profileName}.`);
  return { mode: 'checks', checks: profile.checks };
}

function contractSummary(contract: TaskContract) {
  return {
    intendedOutcome: contract.interpretation.desiredOutcome,
    constraints: contract.interpretation.constraints,
    nonGoals: contract.interpretation.nonGoals,
    assurance: contract.assurance.mode,
    concernCount: contract.assurance.mode === 'consequential'
      ? contract.assurance.concerns.length : 0,
    checkCount: definitionsFor(contract).length,
  };
}

function collectionOutput(task: LoadedTask, facts: FactBundle, reused: boolean) {
  const contract = readContract(task);
  const nonpassing = facts.checks.filter((check) => latestCheck(check).status !== 'passed');
  const keys = new Map(definitionsFor(contract).map((definition) => [definition.definitionId, definition.key]));
  const retryableTimeouts = nonpassing.flatMap((check) => {
    const latest = latestCheck(check);
    return latest.termination.kind === 'timeout'
      && check.attempts.length - 1 < contract.executionPolicy.maxTimeoutRetriesPerCheck
      && latest.timeoutMs < contract.executionPolicy.maxTimeoutMs
      ? [{
          checkKey: keys.get(check.definitionId),
          priorTimeoutMs: latest.timeoutMs,
          maximumTimeoutMs: contract.executionPolicy.maxTimeoutMs,
          retriesRemaining: contract.executionPolicy.maxTimeoutRetriesPerCheck - (check.attempts.length - 1),
        }]
      : [];
  });
  const needsWork = nonpassing.length > 0;
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: reused ? 'facts-current' : 'facts-collected',
    taskId: task.taskId,
    phase: task.projection.phase,
    reused,
    summary: factSummary(facts, contract),
    ...(retryableTimeouts.length ? { retryableTimeouts } : {}),
    directive: task.projection.phase === 'awaiting-decision'
      ? directive('await-human-decision', 'The current Handoff still matches the current facts.')
      : needsWork
        ? directive('continue-work', retryableTimeouts.length
            ? 'Inspect the non-passing Check facts. A timed-out Check may be retried explicitly with its key and a larger bounded timeout; otherwise repair normally and collect again.'
            : 'Inspect the non-passing Check facts, repair normally, and collect again. Handoff remains available for defer or reject.')
        : directive('author-handoff', 'Explain the actual current change against this Fact Collection.'),
  };
}

function factSummary(facts: FactBundle, contract: TaskContract) {
  const keys = new Map(definitionsFor(contract).map((definition) => [definition.definitionId, definition.key]));
  return {
    factCollectionId: facts.factCollectionId,
    changedFiles: facts.changedFiles.map((file) => ({
      path: file.path,
      operation: file.operation,
      representation: file.representation,
    })),
    checks: facts.checks.map((check) => ({
      key: keys.get(check.definitionId),
      definitionId: check.definitionId,
      argv: check.assertionArgv,
      status: latestCheck(check).status,
      termination: latestCheck(check).termination,
      attemptCount: check.attempts.length,
      stdout: latestCheck(check).stdout,
      stderr: latestCheck(check).stderr,
    })),
    checkInducedChangeCount: facts.checkInducedChanges.length,
    verifierMutationCount: facts.verifierMutations.length,
    patch: facts.patch ?? null,
  };
}

function materializeHandoff(
  source: TaskHandoffDocument,
  contract: TaskContract,
  facts: FactBundle,
): CognitiveHandoff {
  const concerns = contract.assurance.mode === 'consequential'
    ? new Map(contract.assurance.concerns.map((concern) => [concern.key, concern]))
    : new Map();
  const evidence = (values: Array<
    | { kind: 'changed-file'; path: string }
    | { kind: 'check'; checkKey: string }
    | { kind: 'patch' }
  > | undefined): HandoffEvidenceReference[] => (values ?? []).map((reference) => {
    if (reference.kind === 'patch') {
      if (!facts.patch) throw inputError('Handoff references a patch, but the current facts have no patch.');
      return reference;
    }
    if (reference.kind === 'changed-file') {
      const file = facts.changedFiles.find((candidate) => candidate.path === reference.path);
      if (!file) throw inputError(`Handoff references unknown changed file ${reference.path}.`);
      return { kind: 'changed-file', id: file.id };
    }
    const definition = definitionsFor(contract).find((candidate) => candidate.key === reference.checkKey);
    if (!definition) throw inputError(`Handoff references unknown Check ${reference.checkKey}.`);
    return { kind: 'check', id: definition.definitionId };
  });
  const concernFindings = (source.concernFindings ?? []).map((finding) => {
    const concern = concerns.get(finding.concernKey);
    if (!concern) throw inputError(`Handoff references unknown Adoption Concern ${finding.concernKey}.`);
    return {
      concernId: concern.id,
      status: finding.status,
      summary: finding.summary,
      evidence: evidence(finding.evidence),
      gaps: finding.gaps,
    };
  });
  const projection = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    handoffId: `handoff:${randomUUID()}`,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    actualChange: {
      behavior: source.actualChange.behavior,
      mechanism: source.actualChange.mechanism,
      preservedInvariants: source.actualChange.preservedInvariants ?? [],
      failureAndRecovery: source.actualChange.failureAndRecovery ?? [],
      importantEffects: source.actualChange.importantEffects ?? [],
      materialTradeoffs: source.actualChange.materialTradeoffs ?? [],
    },
    concernFindings,
    residualUnknowns: (source.residualUnknowns ?? []).map((unknown) => ({
      statement: unknown.statement,
      ...(unknown.nextAction ? { nextAction: unknown.nextAction } : {}),
      evidence: evidence(unknown.evidence),
    })),
    reviewFocus: (source.reviewFocus ?? []).map((focus) => ({
      question: focus.question,
      adoptionImpact: focus.adoptionImpact,
      nextAction: focus.nextAction,
      evidence: evidence(focus.evidence),
    })),
    recommendation: {
      action: source.recommendation.action,
      rationale: source.recommendation.rationale,
      caveats: source.recommendation.caveats ?? [],
    },
  };
  return { ...projection, handoffFingerprint: stableFingerprint(projection) };
}

function materializeDecision(
  source: TaskDecisionDocument,
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  acknowledgedAttentionIds: string[],
): HumanDecision {
  const kind = source.action === 'correction-requested' ? 'correction' as const : 'decision' as const;
  const identity = {
    kind,
    content: source.humanEvent.content,
    capture: 'unattested-input' as const,
  };
  const humanEvent = {
    id: `human:${sha256(JSON.stringify(identity)).slice('sha256:'.length)}`,
    ...identity,
    contentFingerprint: sha256(source.humanEvent.content),
  };
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    decisionId: `decision:${randomUUID()}`,
    humanEvent,
    action: source.action,
    reason: source.reason,
    acknowledgedAttentionIds,
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
  handoff: CognitiveHandoff,
  evaluation: ReturnType<typeof evaluateHandoff>,
  decision?: HumanDecision,
): DecisionPacket {
  const evidenceByConcern = new Map(evaluation.concernEvidence.map((item) => [item.concernId, item]));
  const concerns = contract.assurance.mode === 'consequential' ? contract.assurance.concerns : [];
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    task: {
      contractId: contract.contractId,
      effectiveContractId: contract.effectiveContractId,
      humanEvents: contract.humanEvents,
      intendedOutcome: contract.interpretation.desiredOutcome,
      constraints: contract.interpretation.constraints,
      nonGoals: contract.interpretation.nonGoals,
    },
    state: {
      delivery: 'implemented',
      evidence: evaluation.status,
      recommendation: handoff.recommendation.action,
      adoption: evaluation.adoption,
    },
    actualChange: handoff.actualChange,
    concernFindings: concerns.map((concern) => ({
      concern,
      finding: handoff.concernFindings.find((finding) => finding.concernId === concern.id)!,
      evidenceComplete: evidenceByConcern.get(concern.id)?.complete ?? false,
    })),
    residualUnknowns: handoff.residualUnknowns,
    reviewFocus: handoff.reviewFocus,
    attention: evaluation.attention,
    recommendation: handoff.recommendation,
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
        key: definitionsFor(contract).find((definition) => definition.definitionId === check.definitionId)?.key,
        verifierId: check.verifierId,
        definitionId: check.definitionId,
        argv: check.assertionArgv,
        latestAttempt: latestCheck(check),
        attemptCount: check.attempts.length,
      })),
      verifierMutations: facts.verifierMutations,
      checkInducedChanges: facts.checkInducedChanges.map((file) => ({
        id: file.id, path: file.path, operation: file.operation,
      })),
    },
    ...(decision ? { humanDecision: decision } : {}),
    detailSections: [
      'contract', 'baseline', 'collections', 'collection', 'check', 'log',
      'handoff', 'decision', 'events',
    ],
  };
}

function decisionBrief(packet: DecisionPacket) {
  return {
    decisionState: packet.state,
    changeMeaning: {
      authority: 'agent-judgment',
      humanRequest: packet.task.humanEvents[0],
      intendedOutcome: packet.task.intendedOutcome,
      actualChange: packet.actualChange,
    },
    recommendation: packet.recommendation,
    concerns: packet.concernFindings.map((item) => ({
      statement: item.concern.statement,
      adoptionImpact: item.concern.adoptionImpact,
      status: item.finding.status,
      summary: item.finding.summary,
      evidenceComplete: item.evidenceComplete,
    })),
    unknowns: packet.residualUnknowns,
    reviewFocus: packet.reviewFocus,
    attention: packet.attention,
    runtimeEvidence: {
      authority: 'runtime-fact',
      changedFiles: packet.runtimeFacts.changedFiles,
      checks: packet.runtimeFacts.checks.map((check) => ({
        argv: check.argv,
        status: check.latestAttempt.status,
        termination: check.latestAttempt.termination,
        attemptCount: check.attemptCount,
      })),
      verifierMutationCount: packet.runtimeFacts.verifierMutations.length,
      checkInducedChangeCount: packet.runtimeFacts.checkInducedChanges.length,
    },
    requestedDecision: {
      authority: 'human-decision',
      actions: ['accepted', 'correction-requested', 'rejected', 'deferred'],
      acceptanceRequiresAttentionAcknowledgement: packet.attention.length > 0,
    },
  };
}

function collectVerifierMutations(
  definitions: VerificationDefinition[],
  changedFiles: FactBundle['changedFiles'],
): VerifierMutation[] {
  const mutations: VerifierMutation[] = [];
  for (const definition of definitions) {
    for (const selector of definition.verifierRefs) {
      for (const file of changedFiles) {
        for (const [path, matchedBy] of [
          [file.path, 'current-path'],
          [file.previousPath, 'previous-path'],
        ] as const) {
          if (!path || !selectorMatches(selector, path)) continue;
          mutations.push({
            verifierId: definition.verifierId,
            definitionId: definition.definitionId,
            selector,
            changedFileId: file.id,
            changedPath: path,
            matchedBy,
          });
        }
      }
    }
  }
  return mutations.sort((left, right) => stableFingerprint(left).localeCompare(stableFingerprint(right)));
}

function selectorMatches(selector: VerificationDefinition['verifierRefs'][number], path: string): boolean {
  return selector.kind === 'file'
    ? selector.path === path
    : path === selector.path || path.startsWith(`${selector.path}/`);
}

async function captureCurrent(task: LoadedTask) {
  const contract = readContract(task);
  return {
    worktree: await captureGitWorktree(task.projectRoot, {
      objectDirectory: taskArtifactPath(task.taskDirectory, 'worktree-objects'),
    }),
    executionInputs: captureVerificationInputs(task.projectRoot, definitionsFor(contract)),
  };
}

async function factsAreCurrent(task: LoadedTask, contract: TaskContract, facts: FactBundle): Promise<boolean> {
  const current = await captureCurrent(task);
  return factsMatchCurrent(task, contract, facts, current);
}

function factsMatchCurrent(
  _task: LoadedTask,
  _contract: TaskContract,
  facts: FactBundle,
  current: Awaited<ReturnType<typeof captureCurrent>>,
): boolean {
  return current.worktree.fingerprint === facts.current.fingerprint
    && verificationInputSetFingerprint(current.executionInputs)
      === verificationInputSetFingerprint(facts.currentExecutionInputs);
}

function assertTaskOpen(task: LoadedTask): void {
  if (task.projection.phase === 'complete') {
    throw usageError(`Task ${task.taskId} is complete with decision ${task.projection.terminalDecision}.`);
  }
}

function readContract(task: LoadedTask): TaskContract {
  const contract = readJsonArtifact<TaskContract>(taskArtifactPath(task.taskDirectory, CONTRACT_PATH), 'Task Contract');
  if (contract.protocol !== DELEGATION_PROTOCOL || contract.schemaVersion !== DELEGATION_SCHEMA_VERSION
    || contract.contractId !== task.projection.contractId
    || contract.effectiveContractId !== task.projection.effectiveContractId) {
    throw new Error('Stored Task Contract identity is invalid.');
  }
  return contract;
}

function readBaseline(task: LoadedTask): WorktreeSnapshot {
  const baseline = readJsonArtifact<WorktreeSnapshot>(taskArtifactPath(task.taskDirectory, BASELINE_PATH), 'task baseline');
  assertWorktreeSnapshot(baseline, 'task baseline');
  if (stableFingerprint(baseline) !== task.projection.baselineId) {
    throw new Error('Stored baseline identity is invalid.');
  }
  return baseline;
}

function readCurrentFacts(task: LoadedTask): FactBundle {
  if (!task.projection.currentCollectionId) throw usageError(`Task ${task.taskId} has no current facts.`);
  return readFacts(task, task.projection.currentCollectionId);
}

function readFacts(task: LoadedTask, id: string): FactBundle {
  const facts = readJsonArtifact<FactBundle>(taskArtifactPath(task.taskDirectory, factsPath(id)), `Fact Collection ${id}`);
  if (facts.factCollectionId !== id || facts.effectiveContractId !== task.projection.effectiveContractId) {
    throw new Error(`Stored Fact Collection ${id} has invalid identity.`);
  }
  return facts;
}

function readHandoff(task: LoadedTask, id: string): CognitiveHandoff {
  const handoff = readJsonArtifact<CognitiveHandoff>(taskArtifactPath(task.taskDirectory, handoffPath(id)), `Handoff ${id}`);
  if (handoff.handoffId !== id) throw new Error(`Stored Handoff ${id} has invalid identity.`);
  return handoff;
}

function readDecision(task: LoadedTask, id: string): HumanDecision {
  const decision = readJsonArtifact<HumanDecision>(taskArtifactPath(task.taskDirectory, decisionPath(id)), `Decision ${id}`);
  if (decision.decisionId !== id) throw new Error(`Stored Decision ${id} has invalid identity.`);
  return decision;
}

function definitionsFor(contract: TaskContract): VerificationDefinition[] {
  return contract.verificationPlan.mode === 'checks' ? contract.verificationPlan.definitions : [];
}

function latestCheck(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no Attempt.`);
  return latest;
}

function factsPath(id: string): string {
  return `collections/${id.slice('sha256:'.length)}.json`;
}

function handoffPath(id: string): string {
  return `handoffs/${id.slice('handoff:'.length)}.json`;
}

function decisionPath(id: string): string {
  return `decisions/${id.slice('decision:'.length)}.json`;
}

function factLogPaths(facts: FactBundle): string[] {
  return unique(facts.checks.flatMap((check) => check.attempts.flatMap((attempt) =>
    attempt.steps.flatMap((step) => [step.stdout.logPath, step.stderr.logPath].filter(Boolean) as string[]))));
}

function directiveFor(task: LoadedTask): TaskDirective {
  if (task.projection.phase === 'working') return directive('work', 'Continue normal implementation, then collect facts.');
  if (task.projection.phase === 'awaiting-handoff') return directive('author-handoff', 'Explain the current actual change.');
  if (task.projection.phase === 'awaiting-decision') return directive('await-human-decision', 'Present the Decision Brief and wait for the developer.');
  return directive('complete', `The task is complete with decision ${task.projection.terminalDecision}.`);
}

function directive(kind: TaskDirective['kind'], message: string): TaskDirective {
  return { kind, message };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
