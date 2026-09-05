import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type FactBundle,
  type HandoffEvidenceReference,
  type HumanDecision,
  type TaskContract,
  type VerificationDefinition,
  type VerifierMutation,
} from '@sovea/stetra-core';

import { inputError, usageError } from '../errors.ts';
import { bindHostSession, cancelHostBegin, prepareHostBegin } from '../host/session.ts';
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
import { createDecisionBrief } from './decision-brief.ts';
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
  bindingToken?: string;
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
  let taskId: string = randomUUID();
  const attemptId = `attempt:${randomUUID()}`;
  let task: LoadedTask | undefined;
  let resumed = false;
  await withWorktreeLease({ projectRoot, operation: 'begin', taskId }, async () => {
    if (options.bindingToken) {
      const binding = prepareHostBegin({
        projectRoot, bindingToken: options.bindingToken, contractId: compiled.contract.contractId,
      });
      taskId = binding.taskId;
      if (binding.published) {
        task = binding.published;
        resumed = true;
        bindHostSession({ projectRoot, bindingToken: options.bindingToken, taskId });
        return;
      }
    }
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
      if (options.bindingToken) cancelHostBegin(projectRoot, options.bindingToken, taskId);
      throw error;
    }
    if (options.bindingToken) bindHostSession({ projectRoot, bindingToken: options.bindingToken, taskId });
  });
  if (!task) throw new Error('Task Begin completed without publishing a task.');
  const view = await currentTaskView(task);
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: resumed ? 'task-resumed' : 'task-begun',
    taskId,
    phase: view.phase,
    factsCurrency: view.factsCurrency,
    corrections: view.corrections,
    summary: contractSummary(compiled.contract),
    directive: view.directive,
  };
}

export async function collectTask(options: {
  projectRoot: string;
  taskId: string;
  productVersion: string;
  retryTimeout?: { checkKey: string; timeoutMs: number };
  refreshReason?: string;
}) {
  const initial = loadTask(options.projectRoot, options.taskId);
  assertTaskOpen(initial);
  const contract = readContract(initial);
  const definitions = definitionsFor(contract);
  const existing = initial.projection.currentCollectionId
    ? readFacts(initial, initial.projection.currentCollectionId) : undefined;
  const existingIsCurrent = existing
    ? await factsAreCurrent(initial, contract, existing) : false;
  if (options.retryTimeout && options.refreshReason !== undefined) {
    throw inputError('Use either timeout retry or failure refresh, not both.');
  }
  const refresh = options.refreshReason !== undefined
    ? resolveFailureRefresh(initial, existing, existingIsCurrent, options.refreshReason) : undefined;
  if (existing && existingIsCurrent && !options.retryTimeout && !refresh) {
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
      if ((retry || refresh) && existing && (preCheck.fingerprint !== existing.current.fingerprint
        || verificationInputSetFingerprint(preCheckExecutionInputs)
          !== verificationInputSetFingerprint(existing.currentExecutionInputs))) {
        throw usageError('The worktree or declared Check inputs changed before re-execution; collect current facts instead.');
      }
      const checksRelative = `${attemptRelative}/checks`;
      const checks = await collectChecks({
        projectRoot: task.projectRoot,
        definitions,
        contract,
        existing,
        retry,
        refresh: Boolean(refresh),
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
        ...(refresh ? { refresh } : {}),
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

function resolveFailureRefresh(
  task: LoadedTask,
  facts: FactBundle | undefined,
  isCurrent: boolean,
  reason: string,
): NonNullable<FactBundle['refresh']> {
  if (!reason.trim()) throw inputError('Failure refresh requires a concrete Agent-authored reason.');
  if (!facts || !isCurrent) throw usageError('Failure refresh requires current facts. Collect current facts first.');
  if (!canRefreshFailure(task, facts)) {
    throw usageError('Failure refresh requires a non-timeout failure and permits one refresh per unchanged worktree and declared inputs in this delivery Attempt.');
  }
  return { priorFactCollectionId: facts.factCollectionId, authority: 'agent-judgment', reason: reason.trim() };
}

function canRefreshFailure(task: LoadedTask, facts: FactBundle): boolean {
  const nonpassing = facts.checks.filter((check) => latestCheck(check).status !== 'passed');
  if (!nonpassing.length || nonpassing.some((check) => latestCheck(check).termination.kind === 'timeout')) return false;
  return !task.projection.collectionIds.some((id) => {
    const prior = readFacts(task, id);
    return prior.attemptId === facts.attemptId && prior.refresh
      && prior.preCheck.fingerprint === facts.current.fingerprint
      && verificationInputSetFingerprint(prior.preCheckExecutionInputs)
        === verificationInputSetFingerprint(facts.currentExecutionInputs);
  });
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
  refresh: boolean;
  outputDirectory: string;
  recordedOutputDirectory: string;
}): Promise<FactBundle['checks']> {
  if (!input.retry) {
    return runFrozenChecks({
      projectRoot: input.projectRoot,
      executions: input.definitions.map((definition) => ({
        definition,
        timeoutMs: input.refresh
          ? latestCheck(input.existing!.checks.find((check) => check.definitionId === definition.definitionId)!).timeoutMs
          : input.contract.executionPolicy.checkTimeoutMs,
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
    decisionBrief: createDecisionBrief({ contract, facts, handoff, evaluation, corrections: readCorrections(task) }),
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
    ...(correction ? { corrections: readCorrections(transitioned) } : {
      decisionBrief: createDecisionBrief({ contract, facts, handoff, evaluation, corrections: readCorrections(transitioned) }),
    }),
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
  const view = ['summary', 'handoff'].includes(options.section) ? await currentTaskView(task) : undefined;
  const base = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'task-inspected',
    taskId: task.taskId,
    phase: view?.phase ?? task.projection.phase,
    ...(view ? { factsCurrency: view.factsCurrency, corrections: view.corrections, directive: view.directive } : {}),
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
      directive: view!.directive,
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
      ...(view?.decisionBrief ? { decisionBrief: view.decisionBrief } : {}),
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

export async function taskContext(projectRoot: string, taskId: string) {
  const task = loadTask(projectRoot, taskId);
  return {
    taskId: task.taskId,
    revision: task.projection.revision,
    ...await currentTaskView(task),
  };
}

async function currentTaskView(task: LoadedTask) {
  const contract = readContract(task);
  const facts = task.projection.currentCollectionId ? readCurrentFacts(task) : undefined;
  const isCurrent = facts ? await factsAreCurrent(task, contract, facts) : false;
  const corrections = readCorrections(task);
  const stale = Boolean(facts && !isCurrent);
  const phase = stale && task.projection.phase !== 'complete' ? 'working' as const : task.projection.phase;
  const handoff = isCurrent && task.projection.currentHandoffId
    ? readHandoff(task, task.projection.currentHandoffId) : undefined;
  const decision = task.projection.currentDecisionId
    ? readDecision(task, task.projection.currentDecisionId) : undefined;
  const brief = handoff && facts ? createDecisionBrief({
    contract, facts, handoff, corrections,
    evaluation: evaluateHandoff({
      protocol: DELEGATION_PROTOCOL, schemaVersion: DELEGATION_SCHEMA_VERSION,
      contract, factBundle: facts, handoff, currentWorktreeFingerprint: facts.current.fingerprint,
      ...(decision ? { decision } : {}),
    }),
  }) : undefined;
  return {
    phase,
    factsCurrency: !facts ? 'missing' as const : isCurrent ? 'current' as const : 'stale' as const,
    corrections,
    directive: stale && phase !== 'complete'
      ? directive('continue-work', 'Facts changed after collection. Collect current facts before Handoff or a Human decision.')
      : directiveFor(task),
    ...(brief ? { decisionBrief: brief } : {}),
  };
}

function readCorrections(task: LoadedTask): HumanDecision['humanEvent'][] {
  return task.projection.decisionIds.map((id) => readDecision(task, id))
    .filter((decision) => decision.action === 'correction-requested')
    .map((decision) => decision.humanEvent);
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
    ...(canRefreshFailure(task, facts) ? {
      failureRefresh: { remaining: 1, option: '--refresh-reason', reasonAuthority: 'agent-judgment' },
    } : {}),
    ...(retryableTimeouts.length ? { retryableTimeouts } : {}),
    directive: task.projection.phase === 'awaiting-decision'
      ? directive('await-human-decision', 'The current Handoff still matches the current facts.')
      : needsWork
        ? directive('continue-work', retryableTimeouts.length
            ? 'Inspect the non-passing Check facts. A timed-out Check may be retried explicitly with its key and a larger bounded timeout; otherwise repair normally and collect again.'
            : 'Inspect the non-passing Check facts and repair normally. After external conditions change, an available --refresh-reason performs one bounded recheck. Handoff remains available for defer or reject.')
        : directive('author-handoff', 'Explain the actual current change against this Fact Collection.'),
  };
}

function factSummary(facts: FactBundle, contract: TaskContract) {
  const keys = new Map(definitionsFor(contract).map((definition) => [definition.definitionId, definition.key]));
  return {
    factCollectionId: facts.factCollectionId,
    ...(facts.refresh ? { refresh: facts.refresh } : {}),
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
    if (!concern) throw inputError(contract.assurance.mode === 'routine'
      ? 'Routine tasks have no Adoption Concerns. Omit concernFindings from this Handoff.'
      : `Handoff references unknown Adoption Concern ${finding.concernKey}. Use a concern key declared at Begin.`);
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
