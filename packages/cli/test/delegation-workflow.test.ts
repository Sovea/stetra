import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type {
  DelegationPrepareDocument,
  EvidenceDispositionDocument,
} from '../src/schemas/delegation.ts';
import { sha256, taskIdForPrepareRequest } from '../src/protocol.ts';
import { hostActionAuthoringPacket } from '../src/workflow/host-action.ts';
import { summarizeVerifierSurfaces } from '../src/presentation/verifiers.ts';
import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  explainDelegationTask,
  guardFinalResponse,
  prepareDelegationTask,
  readDelegationTask,
  recordHumanDecision,
  reserveProjectedHostInput,
  resolveHumanChoice,
  reviseVerificationPlan,
} from '../src/workflow/delegation.ts';

const hangingDescendantFixture = fileURLToPath(
  new URL('./fixtures/hanging-descendant.mjs', import.meta.url),
);
const cliEntrypoint = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));

function projectedPacket(action: Parameters<typeof hostActionAuthoringPacket>[0]) {
  const packet = hostActionAuthoringPacket(action);
  assert.ok(packet, 'expected an internal Authoring Projection for the input action');
  return packet as typeof packet & { draft: any };
}

test('prepare publishes no task until baseline observation and immutable artifacts are complete', async () => {
  const root = createRepository();
  try {
    const preparing = prepare(root, prepareDocument({
      baseline: 'task-start',
      argv: [process.execPath, '-e', 'setTimeout(() => process.exit(0), 400)'],
    }));
    await waitFor(() => existsSync(join(root, '.stetra', 'worktree-operation.lock')));
    const tasksDirectory = join(root, '.stetra', 'tasks');
    assert.equal(existsSync(tasksDirectory) ? readdirSync(tasksDirectory).length : 0, 0);
    assert.ok(readdirSync(join(root, '.stetra', 'staging')).some((name) => name.startsWith('prepare-')));

    const prepared = await preparing;
    assert.equal(prepared.status, 'prepared');
    assert.deepEqual(readdirSync(tasksDirectory), [prepared.taskId]);
    assert.equal(readdirSync(join(root, '.stetra', 'staging')).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare consolidates material decisions and recompiles exact Human clarification without a duplicate task', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      prepareRequestId: 'prepare:material-decision',
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
    });
    document.materialDecisionForks = [{
      key: 'compatibility-policy',
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      question: 'Which compatibility policy should govern the public behavior?',
      alternatives: [
        {
          key: 'strict', statement: 'Preserve strict compatibility.',
          impact: 'Existing callers retain the exact public behavior.',
        },
        {
          key: 'intentional-break', statement: 'Allow an intentional breaking change.',
          impact: 'Existing callers must adapt.',
        },
      ],
      recommendation: {
        alternativeKey: 'strict',
        rationale: 'The current request does not authorize a breaking change.',
      },
    }];

    const blocked = await prepare(root, document);
    assert.equal(blocked.status, 'semantic-decision-required');
    assert.equal(blocked.taskCreated, false);
    assert.equal(blocked.hostAction.kind, 'resolve-human-choice');
    assert.equal(blocked.hostAction.clarificationBrief.forks.length, 1);
    assert.equal(blocked.hostAction.clarificationContinuation.requiresNewHumanEvent, true);
    const tasksDirectory = join(root, '.stetra', 'tasks');
    assert.equal(existsSync(tasksDirectory) ? readdirSync(tasksDirectory).length : 0, 0);

    document.developerEvents.push({
      key: 'compatibility-choice',
      content: 'Preserve strict compatibility.',
    });
    document.task.basis.developerEventKeys.push('compatibility-choice');
    document.materialDecisionForks[0].resolution = {
      humanEventKey: 'compatibility-choice',
      selectedAlternativeKey: 'strict',
      decisionInterpretation: 'Strict compatibility remains required.',
    };
    const prepared = await prepare(root, document);
    assert.equal(prepared.status, 'prepared');
    assert.deepEqual(readdirSync(tasksDirectory), [prepared.taskId]);
    assert.equal(prepared.summary.contract.developerEventCount, 2);
    assert.equal(prepared.summary.contract.materialDecisionCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare replays an explicit request without rerunning baseline checks', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      prepareRequestId: 'prepare:replay-once',
      baseline: 'task-start',
      argv: [
        process.execPath,
        '-e',
        "require('node:fs').appendFileSync('prepare-count.txt','x')",
      ],
    });
    const prepared = await prepare(root, document);
    const replayed = await prepare(root, document);

    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.taskId, taskIdForPrepareRequest('prepare:replay-once'));
    assert.equal(replayed.status, 'prepare-replayed');
    assert.equal(replayed.taskCreated, false);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.taskId, prepared.taskId);
    assert.equal(readFileSync(join(root, 'prepare-count.txt'), 'utf8'), 'x');
    assert.equal(readDelegationTask(root, prepared.taskId).events.length, 1);
    assert.deepEqual(readdirSync(join(root, '.stetra', 'tasks')), [prepared.taskId]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare request identity rejects changed input and does not deduplicate distinct requests', async () => {
  const root = createRepository();
  try {
    const firstDocument = prepareDocument({
      prepareRequestId: 'prepare:first-explicit-request',
      baseline: 'task-start',
      argv: [
        process.execPath,
        '-e',
        "require('node:fs').appendFileSync('prepare-count.txt','x')",
      ],
    });
    const first = await prepare(root, firstDocument);
    await assert.rejects(
      prepare(root, {
        ...firstDocument,
        task: { ...firstDocument.task, desiredOutcome: 'A different requested outcome.' },
      }),
      /already bound to task .* with different input/,
    );
    assert.equal(readFileSync(join(root, 'prepare-count.txt'), 'utf8'), 'x');

    const second = await prepare(root, {
      ...firstDocument,
      prepareRequestId: 'prepare:second-explicit-request',
    });
    assert.equal(second.status, 'prepared');
    assert.notEqual(second.taskId, first.taskId);
    assert.equal(readFileSync(join(root, 'prepare-count.txt'), 'utf8'), 'xx');
    assert.equal(readdirSync(join(root, '.stetra', 'tasks')).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect holds the worktree lease while external checks run but does not hold the task commit lock', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'setTimeout(() => process.exit(0), 400)'],
    }));
    const collecting = collect(root, prepared.taskId);
    await waitFor(() => existsSync(join(root, '.stetra', 'worktree-operation.lock')));
    assert.equal(existsSync(join(root, '.stetra', 'tasks', prepared.taskId, '.lock')), false);

    const collected = await collecting;
    assert.equal(collected.status, 'facts-collected');
    assert.equal(existsSync(join(root, '.stetra', 'worktree-operation.lock')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect publishes timeout facts, continues later checks, and releases its lease after terminating descendants', async () => {
  const root = createRepository();
  const pidPath = join(tmpdir(), `stetra-collect-descendant-${randomUUID()}.pid`);
  try {
    const document = prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, hangingDescendantFixture, pidPath],
    });
    document.executionBudget.checkTimeoutMs = 1_000;
    document.checks!.push({
      key: 'after-timeout',
      rationale: 'Prove that collection continues after recording a timeout.',
      execution: {
        preparation: [],
        assertion: { argv: [process.execPath, '-e', 'process.exit(0)'] },
      },
      executionInputs: [],
      baseline: { mode: 'unknown' },
      verifierSelectors: [],
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);

    assert.equal(collected.status, 'facts-collected');
    const timeoutCheck = collected.checks.find(
      (check: { termination: { kind: string } }) => check.termination.kind === 'timeout',
    );
    const passedCheck = collected.checks.find(
      (check: { status: string }) => check.status === 'passed',
    );
    assert.equal(timeoutCheck?.status, 'unavailable');
    assert.deepEqual(passedCheck?.termination, { kind: 'exit', exitCode: 0 });
    assert.equal(collected.checks.length, 2);
    assert.ok(collected.runtimeCollectionDurationMs < 4_000);
    assert.equal(existsSync(join(root, '.stetra', 'worktree-operation.lock')), false);
    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    await waitFor(() => !processExists(descendantPid));

    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts[0].factCollectionId, collected.factCollectionId);
    assert.equal(collected.hostAction.kind, 'retry-timed-out-check');

    const retriedResult = await collectDelegationFacts({
      projectRoot: root,
      taskId: prepared.taskId,
      productVersion: '0.0.1',
      retryChecks: [{
        checkId: timeoutCheck.definitionId,
        timeoutMs: 1_500,
      }],
    }) as any;
    const retried = collectedResultWithFacts(root, prepared.taskId, retriedResult);
    const retriedTimeout = retried.checks.find(
      (check: { definitionId: string }) => check.definitionId === timeoutCheck.definitionId,
    );
    const retainedPass = retried.checks.find(
      (check: { definitionId: string }) => check.definitionId === passedCheck.definitionId,
    );
    assert.equal(retried.collectionMode, 'timeout-retry');
    assert.equal(retriedTimeout.termination.kind, 'timeout');
    assert.equal(retriedTimeout.attemptCount, 2);
    assert.equal(retainedPass.status, 'passed');
    assert.equal(retainedPass.attemptCount, 1);
    assert.equal(retried.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(readDelegationTask(root, prepared.taskId).projection.timeoutRetryUsage, [{
      verifierId: retriedTimeout.verifierId,
      count: 1,
    }]);
    assert.equal(existsSync(join(root, '.stetra', 'worktree-operation.lock')), false);
    const retryDescendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    await waitFor(() => !processExists(retryDescendantPid));

    const diagnosed = await diagnose(
      root,
      prepared.taskId,
      disposition(timeoutCheck.definitionId, 'implementation'),
    );
    assert.equal(diagnosed.successorAttemptId, 'attempt:2');
    const recollected = await collect(root, prepared.taskId);
    assert.equal(
      recollected.checks.find((check: { definitionId: string }) =>
        check.definitionId === timeoutCheck.definitionId).termination.kind,
      'timeout',
    );
    assert.equal(
      recollected.hostAction.kind,
      'diagnose-collected-evidence',
      'a delivery repair must not reset the task-wide logical-verifier retry budget',
    );
    assert.equal(
      readDelegationTask(root, prepared.taskId).projection.timeoutRetryUsage[0].count,
      1,
    );
  } finally {
    rmSync(pidPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('SIGTERM stops the active frozen-check process tree and releases the collection lease', {
  skip: process.platform === 'win32' ? 'POSIX signal forwarding behavior.' : false,
}, async () => {
  const root = createRepository();
  const pidPath = join(tmpdir(), `stetra-signal-descendant-${randomUUID()}.pid`);
  let collecting: ReturnType<typeof spawn> | undefined;
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, hangingDescendantFixture, pidPath],
    }));
    collecting = spawn(process.execPath, [
      '--import', 'tsx', cliEntrypoint,
      'change', 'collect', root,
      '--task', prepared.taskId,
      '--json',
    ], {
      cwd: workspaceRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    collecting.stderr?.setEncoding('utf8');
    collecting.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    await waitFor(() =>
      existsSync(pidPath)
      && existsSync(join(root, '.stetra', 'worktree-operation.lock')), 5_000);
    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    assert.equal(collecting.kill('SIGTERM'), true);
    const [exitCode, signal] = await waitForChildExit(collecting, stderr);

    assert.equal(exitCode, null);
    assert.equal(signal, 'SIGTERM');
    await waitFor(() => !processExists(descendantPid));
    assert.equal(existsSync(join(root, '.stetra', 'worktree-operation.lock')), false);
    assert.equal(readDelegationTask(root, prepared.taskId).projection.attempts[0].factCollectionId, undefined);
  } finally {
    if (collecting?.exitCode === null && collecting.signalCode === null) collecting.kill('SIGKILL');
    rmSync(pidPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect reuses current facts without rerunning checks and refresh is explicit', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [
        process.execPath,
        '-e',
        "require('node:fs').appendFileSync('check-runs.txt', 'run\\n')",
      ],
    }));
    const first = await collect(root, prepared.taskId);
    const afterFirst = readDelegationTask(root, prepared.taskId);

    const reused = await collect(root, prepared.taskId);
    const afterReuse = readDelegationTask(root, prepared.taskId);

    assert.equal(reused.status, 'facts-current');
    assert.equal(reused.collectionMode, 'reused-current');
    assert.equal(reused.factCollectionId, first.factCollectionId);
    assert.equal(readFileSync(join(root, 'check-runs.txt'), 'utf8'), 'run\n');
    assert.equal(afterReuse.projection.revision, afterFirst.projection.revision);
    assert.equal(afterReuse.events.length, afterFirst.events.length);

    const refreshed = await collectDelegationFacts({
      projectRoot: root,
      taskId: prepared.taskId,
      productVersion: '0.0.1',
      refresh: true,
    });
    assert.equal(refreshed.status, 'facts-collected');
    assert.equal(refreshed.collectionMode, 'full-collection');
    assert.notEqual(refreshed.factCollectionId, first.factCollectionId);
    assert.equal(readFileSync(join(root, 'check-runs.txt'), 'utf8'), 'run\nrun\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('declared ignored execution inputs participate in fact currency', async () => {
  const root = createRepository();
  try {
    writeFileSync(join(root, '.gitignore'), '.stetra/\ngenerated-input.txt\n', 'utf8');
    git(root, ['add', '.gitignore']);
    git(root, ['commit', '-qm', 'ignore generated verification input']);
    const document = prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
    });
    document.checks![0].executionInputs = [{ kind: 'file', path: 'generated-input.txt' }];
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'generated-input.txt'), 'first\n', 'utf8');
    const first = await collect(root, prepared.taskId);

    writeFileSync(join(root, 'generated-input.txt'), 'second\n', 'utf8');
    const recollected = await collect(root, prepared.taskId);

    assert.equal(recollected.status, 'facts-collected');
    assert.equal(recollected.collectionMode, 'full-collection');
    assert.notEqual(recollected.factCollectionId, first.factCollectionId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('final-response guard exposes the current workflow action without writing state', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
    });
    document.assurance = {
      kind: 'routine',
      rationale: 'No material adoption condition is needed for this guard fixture.',
    };
    const prepared = await prepare(root, document);
    const preparedGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(preparedGuard.disposition, 'continue-workflow');
    assert.equal(preparedGuard.hostAction?.kind, 'implement-and-collect');
    assert.equal(preparedGuard.hostEnvironment.surface, 'thin-skill');
    assert.equal(preparedGuard.hostEnvironment.independentChallenge.availability, 'unavailable');
    assert.equal(preparedGuard.actionUnchanged, false);
    assert.equal(preparedGuard.stateWritten, false);

    const repeatedPreparedGuard = await guardFinalResponse({
      projectRoot: root,
      taskId: prepared.taskId,
      knownActionFingerprint: preparedGuard.actionFingerprint,
    });
    assert.equal(repeatedPreparedGuard.disposition, 'continue-workflow');
    assert.equal(repeatedPreparedGuard.actionUnchanged, true);
    assert.equal(repeatedPreparedGuard.hostAction, null);
    assert.equal(repeatedPreparedGuard.actionFingerprint, preparedGuard.actionFingerprint);

    writeFileSync(join(root, 'source.txt'), 'first implementation\n', 'utf8');
    let collected = await collect(root, prepared.taskId);
    const collectedGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(collectedGuard.disposition, 'continue-workflow');
    assert.equal(collectedGuard.factsCurrent, true);
    assert.equal(collectedGuard.hostAction?.kind, 'author-handoff');
    const handoffAction = collectedGuard.hostAction!;
    const inputPath = handoffAction.inputBinding!.draftPath;
    const token = inputPath.match(/([a-f0-9]{64})\.json$/)![1];
    const reservation = reserveProjectedHostInput({
      projectRoot: root,
      taskId: prepared.taskId,
      stage: 'handoff',
      token,
    });
    assert.equal(reservation.prefilled, true);
    assert.equal(reservation.guide?.path, handoffAction.inputBinding!.guidePath);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, inputPath), 'utf8')),
      projectedPacket(handoffAction).draft,
    );
    const guide = JSON.parse(readFileSync(join(root, reservation.guide!.path), 'utf8'));
    assert.equal(guide.projectionFingerprint, handoffAction.inputBinding!.projectionFingerprint);
    assert.equal(guide.schema.included, false);
    assert.match(guide.schema.command.argv.join(' '), /--part schema/);
    assert.equal(Object.hasOwn(guide, 'inputSchema'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(guide)) < 16 * 1024);

    writeFileSync(join(root, 'source.txt'), 'current implementation\n', 'utf8');
    const staleGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(staleGuard.disposition, 'continue-workflow');
    assert.equal(staleGuard.factsCurrent, false);
    assert.equal(staleGuard.hostAction?.kind, 'recollect-stale-facts');
    assert.equal(staleGuard.actionUnchanged, false);
    collected = await collect(root, prepared.taskId);
    assert.equal(existsSync(join(root, inputPath)), false);
    assert.equal(existsSync(join(root, reservation.guide!.path)), false);

    const handoffDraft = structuredClone(projectedPacket(collected.hostAction).draft);
    handoffDraft.actualChange.behavior = 'The routine fixture now contains the requested current implementation.';
    handoffDraft.actualChange.mechanism = ['The fixture text is replaced directly.'];
    handoffDraft.actualChange.importantEffects = ['The fixture text changed.'];
    handoffDraft.recommendation = {
      action: 'accept', rationale: 'The exact current facts match the routine change.', caveats: [],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    const handoffGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(handoffGuard.disposition, 'present-decision-brief');
    assert.equal(handoffGuard.hostAction?.kind, 'present-handoff-and-await-human-decision');
    assert.ok(handoffGuard.hostAction.developerDecisionBrief);
    assert.equal(Object.hasOwn(handoffGuard, 'developerDecisionBrief'), false);

    const decisionDraft = structuredClone(
      projectedPacket(handedOff.hostAction.decisionContinuation).draft,
    );
    decisionDraft.humanEvent.content = 'Accept the current implementation.';
    decisionDraft.action = 'accepted';
    decisionDraft.reason = 'The reviewed current facts support adoption.';
    await decide(root, prepared.taskId, decisionDraft);
    const decidedGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(decidedGuard.disposition, 'human-decision-recorded');
    assert.equal(decidedGuard.hostAction, null);
    assert.equal(decidedGuard.factsCurrent, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a confirmed-dead worktree owner is recovered without age guessing and abandoned staging is removed', async () => {
  const root = createRepository();
  try {
    const stetraDirectory = join(root, '.stetra');
    const abandoned = join(stetraDirectory, 'staging', 'collect-abandoned', 'artifacts');
    mkdirSync(abandoned, { recursive: true });
    writeFileSync(join(abandoned, 'partial.json'), '{}\n', 'utf8');
    writeFileSync(join(stetraDirectory, 'worktree-operation.lock'), JSON.stringify({
      owner: '2147483647:dead',
      pid: 2147483647,
      operation: 'collect',
      acquiredAt: new Date().toISOString(),
    }), 'utf8');

    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
    }));
    assert.equal(prepared.status, 'prepared');
    assert.equal(existsSync(join(stetraDirectory, 'worktree-operation.lock')), false);
    assert.equal(readdirSync(join(stetraDirectory, 'staging')).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a live or unverifiable worktree owner is never evicted by elapsed time', async () => {
  const root = createRepository();
  try {
    const stetraDirectory = join(root, '.stetra');
    mkdirSync(stetraDirectory, { recursive: true });
    writeFileSync(join(stetraDirectory, 'worktree-operation.lock'), JSON.stringify({
      owner: `${process.pid}:live`,
      pid: process.pid,
      operation: 'collect',
      acquiredAt: '1970-01-01T00:00:00.000Z',
    }), 'utf8');

    await assert.rejects(
      prepare(root, prepareDocument({
        baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
      })),
      /already being observed.*only removes a lease after confirming its owning process ended/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare selectively captures task-start check observations and freezes their side effects into the baseline', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'task-start',
      argv: [process.execPath, '-e', "require('node:fs').writeFileSync('baseline-artifact.txt','baseline\\n');process.stderr.write('baseline warning\\n')"],
    });
    const prepared = await prepare(root, document);
    assert.equal(prepared.status, 'prepared');
    assert.deepEqual(
      prepared.baselineVerification.checkInducedChanges.map((item: { path: string }) => item.path),
      ['baseline-artifact.txt'],
    );
    assert.equal(prepared.baselineVerification.checks[0].observation.attempts[0].status, 'passed');
    const baselineDetail = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'baseline',
    }) as any;
    assert.equal(
      baselineDetail.baselineVerification.checks[0].observation.latestAttempt.status,
      'passed',
    );
    const definitionId = baselineDetail.baselineVerification.checks[0].definitionId;
    const exactAttempt = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'check-attempt',
      attemptId: 'baseline',
      definitionId,
    }) as any;
    const baselineLog = exactAttempt.checkAttempt.stderr.logPath;
    assert.match(baselineLog, new RegExp(`^\\.stetra/tasks/${prepared.taskId}/baseline-checks/`));
    const log = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'log',
      attemptId: 'baseline',
      definitionId,
      stream: 'stderr',
      tailBytes: 8,
    }) as any;
    assert.equal(log.log.content, 'warning\n');
    assert.equal(log.log.omittedPersistedBytes > 0, true);

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.deepEqual(collected.changedFiles.map((item: { path: string }) => item.path), ['source.txt']);
    assert.equal(collected.checkComparisons[0].relation, 'passed-before-passed-now');
    const handoffPacket = projectedPacket(collected.hostAction);
    assert.equal(handoffPacket.referenceCatalog.checks?.[0].baselineStatus, 'passed');
    assert.equal(handoffPacket.referenceCatalog.checks?.[0].latestStatus, 'passed');
    assert.ok(handoffPacket.detailCommands.some((command) =>
      command.argv.includes('baseline') && command.section === 'check-attempt'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a baseline expectation mismatch is diagnosed even when the current assertion passes', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'task-start',
      argv: [
        process.execPath,
        '-e',
        "process.exit(require('node:fs').readFileSync('source.txt','utf8').trim()==='after'?0:1)",
      ],
    }));
    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.checks[0].status, 'passed');
    assert.deepEqual(collected.evidenceConcerns, [{
      kind: 'check',
      definitionId: collected.checks[0].definitionId,
      observation: 'baseline-expectation-mismatch',
    }]);
    assert.equal(collected.hostAction.kind, 'diagnose-collected-evidence');
    assert.equal(
      (projectedPacket(collected.hostAction).draft as any).entries[0].source.observation,
      'baseline-expectation-mismatch',
    );

    const invalid = projectedPacket(collected.hostAction).draft as any;
    invalid.contractImpact = 'unchanged';
    invalid.action = {
      kind: 'repair-delivery',
      rationale: 'Treat the baseline mismatch as an implementation defect.',
    };
    invalid.entries[0] = {
      ...invalid.entries[0],
      cause: 'implementation',
      diagnosis: 'The implementation caused the mismatch.',
      falsificationAttempt: 'Inspected the current implementation.',
      repositoryChange: {
        surface: 'production',
        intendedChanges: ['Change source.txt.'],
      },
      expectedDifferentObservation: 'The baseline would pass after changing production code.',
    };
    await assert.rejects(
      diagnose(root, prepared.taskId, invalid),
      /baseline expectation mismatch cannot be classified or routed as a production implementation repair/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a non-passing check requires an explicit fact-bound route and environment rebinding can revise verification', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [
        process.execPath, '-e', 'console.error("expected failure"); process.exit(1)',
      ],
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(Object.keys(projectedPacket(collected.hostAction).referenceCatalog), ['checks']);
    const regenerated = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'action',
    }) as any;
    assert.equal(regenerated.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(projectedPacket(regenerated.hostAction).draft, projectedPacket(collected.hostAction).draft);
    assert.equal((projectedPacket(collected.hostAction).draft as any).contractImpact, '');
    assert.deepEqual((projectedPacket(collected.hostAction).draft as any).action, { kind: '', rationale: '' });
    assert.ok(Object.keys(projectedPacket(collected.hostAction).inputSchema).length > 0);
    assert.equal('fieldRules' in projectedPacket(collected.hostAction), false);
    assert.deepEqual(
      projectedPacket(collected.hostAction).detailCommands.map((command) => command.section),
      ['check-attempt', 'log'],
    );
    assert.match(
      projectedPacket(collected.hostAction).detailCommands[0].argv.join(' '),
      new RegExp(`--attempt ${collected.attemptId} .*--definition ${collected.checks[0].definitionId}`),
    );
    const diagnosisInputSchema = JSON.stringify(projectedPacket(collected.hostAction).inputSchema);
    for (const cause of ['implementation', 'environment', 'verification', 'unknown']) {
      assert.match(diagnosisInputSchema, new RegExp(cause));
    }
    const definitionId = collected.checks[0].definitionId;
    const diagnosed = await diagnose(root, prepared.taskId, disposition(definitionId, 'environment'));
    assert.equal(diagnosed.disposition.route, 'revise-verification');
    assert.equal(diagnosed.hostAction.kind, 'revise-verification');
    assert.equal(diagnosed.task.repairCount, 0);
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts.length, 1);
    assert.equal(stored.projection.attempts[0].evidenceDispositionIds.length, 1);
    assert.match(
      stored.projection.attempts[0].evidenceDispositionIds[0] ?? '',
      /^sha256:[a-f0-9]{64}$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('owned diagnosis input is reissued after task-bound validation rejects it', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'diagnose-collected-evidence');
    const binding = collected.hostAction.inputBinding;
    const token = binding.draftPath.match(/[a-f0-9]{64}/)![0];
    const reservation = reserveProjectedHostInput({
      projectRoot: root,
      taskId: prepared.taskId,
      stage: 'diagnose',
      token,
    });
    const path = join(root, reservation.path);
    const draft = JSON.parse(readFileSync(path, 'utf8')) as any;
    const expectedSource = structuredClone(draft.entries[0].source);
    draft.contractImpact = 'unchanged';
    draft.entries[0] = {
      ...draft.entries[0],
      source: { ...draft.entries[0].source, definitionId: `sha256:${'0'.repeat(64)}` },
      cause: 'environment',
      diagnosis: 'The frozen command does not describe an available environment observation.',
      falsificationAttempt: 'Compared the exact frozen command with the current execution surface.',
      repositoryChange: { surface: 'none', intendedChanges: [] },
      expectedDifferentObservation: 'A valid environment binding would produce a completed attempt.',
    };
    draft.action = { kind: 'handoff', rationale: 'Preserve the unresolved environment fact.' };
    writeFileSync(path, `${JSON.stringify(draft)}\n`, 'utf8');

    await assert.rejects(
      diagnoseCollectedEvidence({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: reservation.path,
      }),
      (error: unknown) => {
        const retry = (error as { inputRetry?: { inputReissued?: boolean; path?: string } }).inputRetry;
        assert.equal(retry?.inputReissued, true);
        assert.equal(retry?.path, reservation.path);
        return true;
      },
    );
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(join(root, reservation.guide!.path)), true);

    const corrected = JSON.parse(readFileSync(path, 'utf8')) as any;
    corrected.entries[0].source = expectedSource;
    writeFileSync(path, `${JSON.stringify(corrected)}\n`, 'utf8');
    const diagnosed = await diagnoseCollectedEvidence({
      projectRoot: root,
      taskId: prepared.taskId,
      inputPath: reservation.path,
    });
    assert.equal(diagnosed.status, 'evidence-diagnosed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mixed implementation and environment failures may repair the bounded delivery cause', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    });
    document.checks!.push({
      key: 'environment-check',
      rationale: 'Keep an unrelated environment failure visible during repair.',
      execution: {
        preparation: [],
        assertion: { argv: [process.execPath, '-e', 'process.exit(2)'] },
      },
      executionInputs: [],
      baseline: { mode: 'unknown' },
      verifierSelectors: [],
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'implementation');
    input.entries.push({
      source: {
        kind: 'check',
        definitionId: collected.checks[1].definitionId,
        observation: 'current-nonpassing',
      },
      cause: 'environment',
      diagnosis: 'The second command is unavailable for an environment-specific reason.',
      falsificationAttempt: 'Inspected the independent second command and its exact Runtime exit.',
      repositoryChange: { surface: 'none', intendedChanges: [] },
      expectedDifferentObservation: 'The environment failure remains visible after repair.',
    });
    input.action = {
      kind: 'repair-delivery',
      rationale: 'Repair the bounded implementation defect and recollect every check while retaining the environment failure.',
    };
    const diagnosed = await diagnose(root, prepared.taskId, input);
    assert.equal(diagnosed.disposition.route, 'repair-delivery');
    assert.equal(diagnosed.successorAttemptId, 'attempt:2');
    assert.equal(diagnosed.hostAction.kind, 'implement-and-collect');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a repository verifier gap uses delivery repair without revising its frozen definition', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(root, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'verification');
    input.action = {
      kind: 'repair-delivery',
      rationale: 'Add the missing repository assertion without changing the frozen command definition.',
    };
    input.entries[0] = {
      ...input.entries[0],
      cause: 'verification',
      repositoryChange: {
        surface: 'verification-surface',
        intendedChanges: ['Add the missing counterexample to the existing test surface.'],
      },
    };

    const diagnosed = await diagnose(root, prepared.taskId, input);
    assert.equal(diagnosed.status, 'repair-prepared');
    assert.equal(diagnosed.disposition.route, 'repair-delivery');
    assert.equal(diagnosed.successorAttemptId, 'attempt:2');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.effectiveContractId, prepared.taskContract.effectiveContractId);
    assert.equal(stored.projection.verificationPlanId, prepared.taskContract.verificationPlanId);
    assert.deepEqual(stored.projection.verificationRevisionIds, []);
    assert.equal(stored.projection.attempts[1].trigger, 'delivery-repair');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit delivery repair creates a successor and exhausted budget returns to handoff with lineage intact', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'], maxRepairAttempts: 1,
    }));
    const firstCollection = await collect(root, prepared.taskId);
    const firstDiagnosis = await diagnose(
      root, prepared.taskId, disposition(firstCollection.checks[0].definitionId, 'implementation'),
    );
    assert.equal(firstDiagnosis.disposition.route, 'repair-delivery');
    assert.equal(firstDiagnosis.successorAttemptId, 'attempt:2');
    assert.equal(firstDiagnosis.hostAction.kind, 'implement-and-collect');

    writeFileSync(join(root, 'source.txt'), 'repair attempt\n', 'utf8');
    const secondCollection = await collect(root, prepared.taskId);
    assert.equal(secondCollection.repeatedObservation, false);
    const exhausted = await diagnose(
      root, prepared.taskId, disposition(secondCollection.checks[0].definitionId, 'implementation'),
    );
    assert.equal(exhausted.disposition.route, 'handoff');
    assert.equal(exhausted.task.deliveryStatus, 'exhausted');
    assert.equal(exhausted.hostAction.kind, 'author-handoff');
    const task = readDelegationTask(root, prepared.taskId);
    assert.equal(task.projection.attempts.length, 2);
    assert.ok(task.projection.attempts.every((attempt) => attempt.factCollectionId));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('environment diagnosis may hand off uncertainty without hiding the failed Check', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', "console.error('same output');process.exit(1)"],
      critical: true,
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const challengeDiagnosis = disposition(collected.checks[0].definitionId, 'environment');
    challengeDiagnosis.action = {
      kind: 'handoff',
      rationale: 'Expose the environment limitation and failed Check for direct review.',
    };
    const challenged = await diagnose(root, prepared.taskId, challengeDiagnosis);
    assert.equal(challenged.disposition.route, 'handoff');
    assert.equal(challenged.hostAction.kind, 'author-handoff');
    assert.equal(collected.checks[0].status, 'failed');
    assert.ok((projectedPacket(challenged.hostAction).draft as any).conditions[0].reviewDecisionKeys.length);
    assert.ok((projectedPacket(challenged.hostAction).draft as any).conditions[0].obligations[0].reviewDecisionKeys.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const materialRoot = createRepository();
  try {
    const prepared = await prepare(materialRoot, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(materialRoot, prepared.taskId);
    const current = disposition(collected.checks[0].definitionId, 'environment');
    const input: EvidenceDispositionDocument = {
      contractImpact: 'material',
      impact: 'The evidence gap may require changing the compiled task meaning.',
      entries: current.entries,
      action: {
        kind: 'ask-human',
        rationale: 'The developer must decide whether the current contract remains authoritative.',
      },
    };
    const diagnosed = await diagnose(materialRoot, prepared.taskId, input);
    assert.equal(diagnosed.disposition.route, 'ask-human');
    assert.equal(diagnosed.hostAction.kind, 'resolve-evidence-decision');
    assert.deepEqual(diagnosed.hostAction.command.argv.slice(0, 4), [
      'stetra', 'change', 'resolve', '.',
    ]);
    const resolved = await resolve(materialRoot, prepared.taskId, {
      humanEvent: { content: 'Continue with the current contract and expose the evidence gap.' },
      target: { kind: 'semantic-impact', dispositionId: diagnosed.disposition.dispositionId },
      action: 'continue-current-contract',
      reason: 'The current contract remains the intended adoption boundary.',
    });
    assert.equal(resolved.hostAction.kind, 'author-handoff');
    assert.equal(readDelegationTask(materialRoot, prepared.taskId).projection.pendingResolution, undefined);
    const guarded = await guardFinalResponse({
      projectRoot: materialRoot,
      taskId: prepared.taskId,
    });
    assert.equal(guarded.hostAction?.kind, 'author-handoff');
  } finally {
    rmSync(materialRoot, { recursive: true, force: true });
  }
});

test('required Host policies share one exact Human resolution surface', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
    });
    document.hostPolicyRequirements = [
      {
        key: 'no-web', capability: 'web-search', requiredState: 'disabled',
        enforcementRequirement: 'required',
        rationale: 'The task must not use upstream solution material.',
      },
      {
        key: 'no-mutation', capability: 'external-mutation', requiredState: 'disabled',
        enforcementRequirement: 'required',
        rationale: 'The task is limited to the local worktree.',
      },
    ];
    const prepared = await prepare(root, document);
    assert.equal(prepared.hostAction.kind, 'resolve-evidence-decision');
    const resolutionGuide = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'action-input',
      stage: 'resolve',
      part: 'guide',
    }) as any;
    assert.match(
      resolutionGuide.guide.schema.command.argv.join(' '),
      /--stage resolve --part schema/,
    );
    const resolutionSchema = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'action-input',
      stage: 'resolve',
      part: 'schema',
    }) as any;
    assert.ok(Object.keys(resolutionSchema.inputSchema).length > 0);
    const resolutionInputSchema = JSON.stringify(projectedPacket(prepared.hostAction).inputSchema);
    for (const action of ['continue-current-contract', 'request-correction', 'abort']) {
      assert.match(resolutionInputSchema, new RegExp(action));
    }
    const target = (projectedPacket(prepared.hostAction).draft as any).target;
    assert.equal(target.kind, 'host-policy');
    assert.equal(target.requirementIds.length, 2);
    const resolved = await resolve(root, prepared.taskId, {
      humanEvent: { content: 'Continue while retaining both policy gaps for adoption review.' },
      target,
      action: 'continue-current-contract',
      reason: 'Both Host limitations are understood and remain visible.',
    });
    assert.equal(resolved.hostAction.kind, 'implement-and-collect');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.humanResolutionIds.length, 1);
    assert.equal(stored.projection.pendingResolution, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a Human correction creates a successor Attempt and preserves the prior decision', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
    }));
    const collected = await collect(root, prepared.taskId);
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    const handoffInput = {
      actualChange: {
        behavior: 'The first implementation is ready for review.',
        mechanism: ['The fixture source is updated directly.'],
        preservedInvariants: [], failureAndRecovery: [], importantEffects: [], materialTradeoffs: [],
      },
      conditions: [{
        conditionKey: condition.key,
        status: 'supported',
        summary: 'The obligation is supported.',
        reviewDecisionKeys: [],
        obligations: [{
          obligationKey: obligation.key,
          status: 'supported',
          reviewDecisionKeys: [],
          evidence: [{ kind: 'check', key: 'test' }],
          evidenceCoverage: {
            status: 'sufficient',
            rationale: 'The exact current check covers the bounded conclusion.',
            gaps: [],
          },
          falsification: {
            attempt: 'Inspected whether the command bypasses the intended behavior.',
            observedResult: 'The current command exercised the intended path.',
          },
          counterEvidence: [],
          conclusion: 'The bounded observation supports this obligation.',
        }],
      }],
      residualUnknowns: [],
      reviewDecisions: [],
      recommendation: { action: 'accept', rationale: 'The bounded evidence is current.', caveats: [] },
    };
    const unknownKeyInput = structuredClone(handoffInput);
    unknownKeyInput.conditions[0].conditionKey = 'unknown-condition';
    await assert.rejects(
      handoff(root, prepared.taskId, unknownKeyInput),
      /Cognitive Handoff input is invalid: conditions\[0\]/,
    );
    const handedOff = await handoff(root, prepared.taskId, handoffInput);
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal(handedOff.hostAction.kind, 'present-handoff-and-await-human-decision');
    assert.equal(handedOff.hostAction.command, undefined);
    const decisionGuide = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'action-input',
      stage: 'decide',
      part: 'guide',
    }) as any;
    assert.match(
      decisionGuide.guide.schema.command.argv.join(' '),
      /--stage decide --part schema/,
    );
    assert.deepEqual(
      Object.keys(projectedPacket(handedOff.hostAction.decisionContinuation).referenceCatalog),
      ['attention'],
    );
    const decisionInputSchema = JSON.stringify(
      projectedPacket(handedOff.hostAction.decisionContinuation).inputSchema,
    );
    for (const action of ['accepted', 'correction-requested', 'rejected', 'deferred']) {
      assert.match(decisionInputSchema, new RegExp(action));
    }
    assert.deepEqual(handedOff.hostAction.developerDecisionBrief.primary.decisionState, {
      delivery: 'implementation-complete', evidence: 'handoff-ready',
      recommendation: 'accept', adoption: 'pending',
    });
    assert.equal(
      handedOff.hostAction.developerDecisionBrief.primary.changeMeaning.actualChange.behavior,
      'The first implementation is ready for review.',
    );
    assert.equal(
      handedOff.hostAction.developerDecisionBrief.primary.changeMeaning.authority,
      'agent-judgment',
    );
    assert.equal(handedOff.hostAction.developerDecisionBrief.primary.runtimeEvidence.authority, 'runtime-fact');
    assert.equal(handedOff.hostAction.developerDecisionBrief.primary.requestedDecision.authority, 'human-decision');
    assert.equal(handedOff.hostAction.developerDecisionBrief.primary.conditions[0].finding.status, 'supported');
    assert.deepEqual(handedOff.hostAction.developerDecisionBrief.primary.blockers, []);
    assert.deepEqual(handedOff.hostAction.developerDecisionBrief.details.command.argv, [
      'stetra', 'change', 'explain', '.', '--task', prepared.taskId,
      '--section', 'decision-packet', '--json',
    ]);
    const detailedPacket = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'decision-packet',
    }) as any;
    assert.equal(
      detailedPacket.decisionPacket.conditions[0].id,
      condition.id,
    );
    const decided = await decide(root, prepared.taskId, {
      humanEvent: { content: 'Correct the wording without changing the current semantic contract.' },
      action: 'correction-requested',
      reason: 'The first result needs a bounded correction.',
      exceptions: [],
    });
    assert.equal(decided.decisionStatus, 'correction-requested');
    assert.equal(decided.hostAction.kind, 'resolve-evidence-decision');
    const decisionId = decided.decisionPacket.decision.humanDecision.decisionId;
    const resolved = await resolve(root, prepared.taskId, {
      humanEvent: { content: 'Proceed with that correction under the current contract.' },
      target: { kind: 'correction', decisionId },
      action: 'continue-current-contract',
      reason: 'No semantic or verification revision is required.',
    });
    assert.equal(resolved.successorAttemptId, 'attempt:2');
    assert.equal(resolved.hostAction.kind, 'implement-and-collect');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts[1].trigger, 'correction');
    assert.equal(stored.projection.attempts[1].parentAttemptId, 'attempt:1');
    assert.equal(stored.projection.decisionId, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('routine handoff can disclose a task-wide residual unknown without a fake Condition', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'],
    });
    document.assurance = {
      kind: 'routine',
      rationale: 'No bounded semantic Condition changes adoption for this fixture.',
    };
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const draft = structuredClone(projectedPacket(collected.hostAction).draft) as any;
    draft.actualChange = {
      behavior: 'The routine fixture remains executable.',
      mechanism: ['The fixture uses the existing execution path.'],
      preservedInvariants: [],
      failureAndRecovery: [],
      importantEffects: [],
      materialTradeoffs: [],
    };
    draft.residualUnknowns = [{
      target: { kind: 'task' },
      statement: 'The downstream consumer environment was not observed in this task.',
      evidence: [],
      reviewDecisionKeys: ['review-task-environment'],
    }];
    draft.reviewDecisions = [{
      key: 'review-task-environment',
      conditionKeys: [],
      obligationKeys: [],
      question: 'Is the unobserved downstream environment acceptable for adoption?',
      adoptionImpact: 'The change may behave differently outside the observed repository environment.',
      nextAction: 'Inspect or defer adoption until the environment is observed.',
      evidence: [],
    }];
    draft.recommendation = {
      action: 'defer',
      rationale: 'A task-wide environment unknown remains.',
      caveats: ['The downstream environment was not observed.'],
    };
    const handedOff = await handoff(root, prepared.taskId, draft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.equal(handedOff.summary.attentionCount, 1);
    assert.equal(
      handedOff.hostAction.developerDecisionBrief.primary.blockers[0].residualUnknowns[0].statement,
      'The downstream consumer environment was not observed in this task.',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a thin Host bypasses Challenge execution and receives a direct bounded Handoff', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
      acceptanceSurfaceSelectors: [{ kind: 'file', path: 'source.txt' }],
    });
    const prepared = await prepare(root, document);
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');

    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'author-handoff');
    assert.equal(projectedPacket(collected.hostAction).inputKind, 'handoff');
    assert.match(collected.hostAction.inputBinding.draftPath, /^\.stetra\/inbox\/[a-f0-9]{64}\.json$/);
    assert.ok(projectedPacket(collected.hostAction).inputSchema);
    assert.deepEqual(
      (projectedPacket(collected.hostAction).constraints as any).recommendationActions,
      ['request-correction', 'reject', 'defer'],
    );
    assert.deepEqual(projectedPacket(collected.hostAction).detailCommands, []);
    assert.deepEqual((projectedPacket(collected.hostAction).draft as any).conditions[0], {
      conditionKey: condition.key,
      status: '',
      summary: '',
      reviewDecisionKeys: [`review-${condition.key}`],
      obligations: [{
        obligationKey: obligation.key,
        status: '',
        reviewDecisionKeys: [`review-${condition.key}`],
        evidence: [{ kind: 'check', key: 'test' }],
        evidenceCoverage: { status: '', rationale: '', gaps: [] },
        falsification: { attempt: '', observedResult: '' },
        counterEvidence: [],
        conclusion: '',
      }],
    });
    assert.deepEqual((projectedPacket(collected.hostAction).draft as any).reviewDecisions, [{
      key: `review-${condition.key}`,
      conditionKeys: [condition.key],
      obligationKeys: [{ conditionKey: condition.key, obligationKey: obligation.key }],
      question: '',
      adoptionImpact: condition.adoptionRationale,
      nextAction: '',
      evidence: [],
    }]);
    assert.ok(!JSON.stringify(projectedPacket(collected.hostAction).inputSchema)
      .includes('"accept"'));
    assert.deepEqual(collected.verifierSurfaces.map(
      (item: { path: string }) => item.path,
    ), ['source.txt']);

    const guarded = await guardFinalResponse({
      projectRoot: root,
      taskId: prepared.taskId,
    });
    assert.equal(guarded.hostAction?.kind, 'author-handoff');

    const draft = structuredClone(projectedPacket(collected.hostAction).draft);
    draft.actualChange.behavior =
      'The implementation passes its changed verifier, while independent Challenge is unavailable.';
    draft.actualChange.mechanism = ['The implementation and verifier surface change together.'];
    const conditionFinding = draft.conditions[0];
    const obligationFinding = conditionFinding.obligations[0];
    obligationFinding.status = 'unknown';
    obligationFinding.evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The current check cannot replace the required independent falsification.',
      gaps: ['The frozen failure hypothesis still needs direct review.'],
    };
    obligationFinding.falsification = {
      attempt: 'Preserved the unexecuted independent Challenge boundary.',
      observedResult: 'No trusted fresh-context observation is available.',
    };
    obligationFinding.conclusion =
      'The bounded obligation remains unknown without the required Challenge.';
    conditionFinding.status = 'unknown';
    conditionFinding.summary =
      'The condition cannot be supported from the current evidence path.';
    draft.reviewDecisions[0].question =
      'Does direct inspection resolve the adoption-critical behavior boundary?';
    draft.reviewDecisions[0].nextAction = 'Inspect the changed verifier and missing Challenge boundary.';
    draft.recommendation = {
      action: 'defer',
      rationale: 'Direct review must resolve the missing independent Challenge.',
      caveats: ['The current Host has no trusted Challenger lifecycle integration.'],
    };

    const missingReview = structuredClone(draft);
    missingReview.conditions[0].obligations[0].reviewDecisionKeys = [];
    await assert.rejects(
      handoff(root, prepared.taskId, missingReview),
      /Cognitive Handoff input is invalid: conditions\[0\]/,
    );

    const handedOff = await handoff(root, prepared.taskId, draft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.ok(handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('challenge-missing')));
    assert.equal(
      handedOff.decisionPacket.conditions[0].obligations[0].evidencePath.status,
      'unavailable',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Handoff projection prebinds shared Review Decisions to exact findings in Contract order', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    });
    if (document.assurance.kind !== 'conditioned') throw new Error('Expected conditioned fixture.');
    document.assurance.conditions[0].evidenceObligations.push({
      key: 'second-observation',
      statement: 'A second bounded observation distinguishes another failure mode.',
      falsification: {
        failureHypothesis: 'The second failure mode may remain hidden.',
        scenario: 'Inspect the second explicit behavior boundary.',
        supportingObservation: 'The second failure mode is rejected.',
        contradictingObservation: 'The second failure mode remains possible.',
      },
      strategies: [
        { kind: 'runtime-check', checkKeys: ['test'] },
        { kind: 'independent-challenge', policy: 'required' },
      ],
    });
    document.assurance.conditions.push({
      key: 'compatibility',
      statement: 'The changed behavior preserves the declared compatibility boundary.',
      rationale: 'A compatibility regression prevents adoption.',
      criticality: 'adoption-critical',
      evidenceObligations: [{
        key: 'compatibility-observation',
        statement: 'The compatibility boundary rejects its explicit failure mode.',
        falsification: {
          failureHypothesis: 'The change may bypass the compatibility boundary.',
          scenario: 'Inspect the explicit compatibility path.',
          supportingObservation: 'The compatibility path remains protected.',
          contradictingObservation: 'The compatibility path can be bypassed.',
        },
        strategies: [
          { kind: 'runtime-check', checkKeys: ['test'] },
          { kind: 'independent-challenge', policy: 'required' },
        ],
      }],
    });

    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const packet = projectedPacket(collected.hostAction);

    assert.deepEqual(
      packet.draft.conditions.map((finding: any) => finding.conditionKey),
      prepared.taskContract.adoptionConditions.map((condition: any) => condition.key),
    );
    for (const finding of packet.draft.conditions) {
      assert.deepEqual(finding.reviewDecisionKeys, [`review-${finding.conditionKey}`]);
      assert.ok(finding.obligations.every((obligation: any) =>
        obligation.reviewDecisionKeys[0] === `review-${finding.conditionKey}`));
    }
    assert.equal(packet.draft.reviewDecisions.length, packet.draft.conditions.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a material Condition with missing required Challenge can share one Review Decision', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      challengePolicy: 'required',
    }));
    const collected = await collect(root, prepared.taskId);
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];

    const finding = (projectedPacket(collected.hostAction).draft as any).conditions[0];
    assert.equal(finding.conditionKey, condition.key);
    assert.deepEqual(finding.reviewDecisionKeys, [`review-${condition.key}`]);
    assert.deepEqual(finding.obligations[0].reviewDecisionKeys, [`review-${condition.key}`]);
    assert.equal(finding.obligations[0].obligationKey, obligation.key);
    assert.equal((projectedPacket(collected.hostAction).draft as any).reviewDecisions.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing independent execution remains explicit in a direct bounded handoff', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'author-handoff');
    const fallbackDraft = projectedPacket(collected.hostAction).draft as any;
    assert.ok(fallbackDraft.conditions[0].reviewDecisionKeys.length);
    assert.ok(fallbackDraft.conditions[0].obligations[0].reviewDecisionKeys.length);
    const handoffDraft = structuredClone(fallbackDraft) as any;
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    handoffDraft.actualChange.behavior = 'Runtime facts are current, while the independent Challenge remains unavailable.';
    handoffDraft.actualChange.mechanism = ['The implementation follows the changed fixture path.'];
    const conditionFinding = handoffDraft.conditions[0];
    const obligationFinding = conditionFinding.obligations[0];
    obligationFinding.status = 'unknown';
    obligationFinding.evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The current check does not replace the frozen independent falsification attempt.',
      gaps: ['The developer must inspect the failure hypothesis directly.'],
    };
    obligationFinding.falsification = {
      attempt: 'Preserved the unexecuted independent Challenge boundary for direct review.',
      observedResult: 'No Host-attested independent observation is available.',
    };
    obligationFinding.conclusion = 'The independent evidence path remains unknown.';
    conditionFinding.status = 'unknown';
    conditionFinding.summary = 'The adoption condition requires direct Human inspection.';
    handoffDraft.reviewDecisions[0].question = 'Is the adoption-critical behavior safe to accept?';
    handoffDraft.reviewDecisions[0].nextAction = 'Inspect the missing Challenge boundary.';
    handoffDraft.recommendation = {
      action: 'defer',
      rationale: 'The missing independent evidence path requires direct review.',
      caveats: ['No fresh-context Challenge result exists.'],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.ok(handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('challenge-missing')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a tree verifier selector preserves a changed descendant as an adoption concern', async () => {
  const root = createRepository();
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test', 'surface.txt'), 'before\n', 'utf8');
    git(root, ['add', 'test/surface.txt']);
    git(root, ['commit', '-qm', 'add verifier surface']);
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      challengePolicy: 'fact-triggered',
      acceptanceSurfaceSelectors: [{ kind: 'tree', path: 'test' }],
    }));

    writeFileSync(join(root, 'test', 'surface.txt'), 'after\n', 'utf8');
    const collected = await collect(root, prepared.taskId);

    assert.equal(collected.hostAction.kind, 'author-handoff');
    assert.deepEqual(collected.verifierSurfaces, [{
      path: 'test/surface.txt',
      role: 'acceptance-surface',
      definitionIds: [collected.checks[0].definitionId],
    }]);
    const stored = storedAttemptFacts(root, prepared.taskId, collected.attemptId);
    assert.deepEqual(stored.verifierMutations[0].selector, {
      kind: 'tree', path: 'test', role: 'acceptance-surface',
    });
    assert.equal(stored.verifierMutations[0].matchedBy, 'current-path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verification revision preserves history and completes handoff against current evidence', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'task-start', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const semanticContractId = prepared.taskContract.semanticContractId;
    const first = await collect(root, prepared.taskId);
    const firstDiagnosis = structuredClone(projectedPacket(first.hostAction).draft);
    firstDiagnosis.contractImpact = 'unchanged';
    firstDiagnosis.action = {
      kind: 'revise-verification',
      rationale: 'The frozen assertion definition cannot produce the declared observation.',
    };
    firstDiagnosis.entries = firstDiagnosis.entries.map((entry: any) => ({
      ...entry,
      cause: 'verification',
      diagnosis: 'The frozen assertion exits unsuccessfully by construction.',
      falsificationAttempt: 'Inspected the exact assertion argv and both Runtime observations.',
      repositoryChange: { surface: 'none', intendedChanges: [] },
      expectedDifferentObservation: 'A corrected immutable definition records the intended assertion result.',
    }));
    const diagnosed = await diagnose(
      root,
      prepared.taskId,
      firstDiagnosis,
    );
    assert.equal(diagnosed.disposition.route, 'revise-verification');
    assert.equal(diagnosed.hostAction.kind, 'revise-verification');
    const revisionInputSchema = JSON.stringify(projectedPacket(diagnosed.hostAction).inputSchema);
    assert.match(revisionInputSchema, /execution-rebinding/);
    assert.match(revisionInputSchema, /verification-plan/);
    const draft = projectedPacket(diagnosed.hostAction).draft as any;
    draft.kind = 'execution-rebinding';
    draft.rationale = 'The original command selected the wrong executable behavior.';
    draft.equivalenceClaim = 'The rebound argv uses the same Node executable and intended fixture boundary.';
    draft.checks[0].execution.assertion.argv = [process.execPath, '-e', 'process.exit(0)'];
    const revised = await reviseVerification(root, prepared.taskId, draft);
    assert.equal(revised.status, 'verification-revised');
    assert.equal(revised.semanticContractId, semanticContractId);
    assert.notEqual(revised.verificationPlanId, prepared.taskContract.verificationPlanId);
    assert.notEqual(revised.effectiveContractId, prepared.taskContract.effectiveContractId);
    assert.equal(revised.successorAttemptId, 'attempt:2');
    assert.equal(revised.baseline, 'baseline-unknown-after-revision');

    const second = await collect(root, prepared.taskId);
    assert.equal(second.checks[0].status, 'passed');
    assert.equal(second.checkComparisons[0].relation, 'baseline-unknown-after-revision');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts.length, 2);
    assert.ok(stored.projection.attempts[0].factCollectionId);
    assert.ok(stored.projection.attempts[1].factCollectionId);
    assert.equal(stored.projection.verificationRevisionIds.length, 1);

    const handoffDraft = structuredClone(projectedPacket(second.hostAction).draft);
    handoffDraft.actualChange.behavior = 'The rebound verification passed against the current implementation.';
    handoffDraft.actualChange.mechanism = ['The revised command executes the same bounded fixture assertion.'];
    for (const conditionFinding of handoffDraft.conditions) {
      conditionFinding.status = 'supported';
      conditionFinding.summary = 'Every current evidence obligation is supported.';
      for (const obligationFinding of conditionFinding.obligations) {
        obligationFinding.status = 'supported';
        obligationFinding.evidenceCoverage = {
          status: 'sufficient',
          rationale: 'The current immutable definition covers the bounded conclusion.',
          gaps: [],
        };
        obligationFinding.falsification = {
          attempt: 'Ran the current immutable definition and inspected its bounded result.',
          observedResult: 'The current definition passed and exercised the bounded behavior.',
        };
        obligationFinding.conclusion = 'The current passing observation supports this bounded obligation.';
      }
    }
    handoffDraft.recommendation = {
      action: 'defer',
      rationale: 'The implementation evidence is current and the verification revision remains visible.',
      caveats: ['The revised definition has no recreated task-start observation.'],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.equal(handedOff.decisionPacket.runtimeFacts.attemptId, 'attempt:2');
    assert.equal(handedOff.decisionPacket.evidenceJudgments.dispositions.length, 1);
    assert.equal(handedOff.decisionPacket.evidenceJudgments.dispositions[0].attemptId, 'attempt:1');
    assert.equal(handedOff.decisionPacket.evidenceJudgments.dispositions.length, 1);
    assert.equal(
      handedOff.decisionPacket.evidenceJudgments.dispositions[0].route,
      'revise-verification',
    );
    assert.ok(handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('verification-revised')));

    const decided = await decide(root, prepared.taskId, {
      humanEvent: { content: 'Defer adoption while retaining the verification-revision evidence.' },
      action: 'deferred',
      reason: 'The revised verification boundary needs direct review.',
      exceptions: [],
    });
    assert.equal(decided.decisionStatus, 'deferred');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-workflow-initial-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  writeFileSync(join(root, '.gitignore'), '.stetra/\n', 'utf8');
  writeFileSync(join(root, 'source.txt'), 'before\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'initial']);
  return root;
}

function prepareDocument(options: {
  baseline: 'task-start' | 'unknown';
  argv: string[];
  prepareRequestId?: string;
  maxRepairAttempts?: number;
  timeoutRetry?: DelegationPrepareDocument['executionBudget']['timeoutRetry'];
  critical?: boolean;
  challengePolicy?: 'required' | 'fact-triggered';
  acceptanceSurfaceSelectors?: Array<{ kind: 'file' | 'tree'; path: string }>;
}): DelegationPrepareDocument {
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1',
    prepareRequestId: options.prepareRequestId ?? `prepare:${randomUUID()}`,
    developerEvents: [{ key: 'request', content: 'Change the workflow fixture.' }],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change the workflow fixture.', constraints: [], nonGoals: [], focus: ['source.txt'],
    },
    materialDecisionForks: [],
    repositoryEvidence: [],
    assurance: { kind: 'conditioned', conditions: [{
      key: 'behavior', statement: 'The selected observation supports adoption.',
      rationale: 'This condition controls adoption.',
      criticality: options.critical ? 'adoption-critical' : 'material',
      evidenceObligations: [{
        key: 'observation',
        statement: 'The selected observation distinguishes the expected behavior.',
        falsification: {
          failureHypothesis: 'The command may pass or fail without exercising the intended behavior.',
          scenario: 'Run the frozen command against the changed fixture boundary.',
          supportingObservation: 'The command exercises the changed behavior and reports the expected result.',
          contradictingObservation: 'The command result does not depend on the changed behavior.',
        },
        strategies: [
          { kind: 'runtime-check', checkKeys: ['test'] },
          ...(options.critical || options.challengePolicy
            ? [{
                kind: 'independent-challenge' as const,
                policy: options.challengePolicy ?? 'required',
              }]
            : []),
        ],
      }],
    }] },
    hostPolicyRequirements: [],
    executionBudget: {
      checkTimeoutMs: 300_000,
      maxDeliveryRepairs: options.maxRepairAttempts ?? 2,
      timeoutRetry: options.timeoutRetry ?? {
        mode: 'bounded',
        maxRetriesPerVerifier: 1,
        maxTimeoutMs: 900_000,
      },
    },
    checks: [{
      key: 'test', rationale: 'Observe the fixture.',
      execution: {
        preparation: [],
        assertion: { argv: options.argv },
      },
      executionInputs: [],
      baseline: options.baseline === 'task-start' ? {
        mode: 'task-start',
        rationale: 'The before/after observation distinguishes a regression.',
        expectation: { baselineStatus: 'passed', currentStatus: 'passed' },
      } : { mode: 'unknown' },
      verifierSelectors: (options.acceptanceSurfaceSelectors ?? []).map((selector) => ({
        ...selector,
        role: 'acceptance-surface' as const,
      })),
    }],
  };
}

function disposition(
  definitionId: string,
  cause: 'implementation' | 'environment' | 'verification' | 'unknown',
): EvidenceDispositionDocument {
  const action = cause === 'implementation'
    ? { kind: 'repair-delivery' as const, rationale: 'Repair the bounded implementation cause.' }
    : cause === 'environment' || cause === 'verification'
      ? { kind: 'revise-verification' as const, rationale: 'Revise the invalid execution or verification binding.' }
      : {
          kind: 'handoff' as const,
          rationale: 'Expose the unresolved bounded semantics for direct review.',
        };
  const common = {
    source: { kind: 'check' as const, definitionId, observation: 'current-nonpassing' as const },
    diagnosis: `The observed cause is ${cause}.`,
    falsificationAttempt: 'Inspected the command, environment, and changed implementation.',
    expectedDifferentObservation: 'A subsequent Runtime attempt records the expected status.',
  };
  const entry = cause === 'implementation'
    ? {
        ...common,
        cause: 'implementation' as const,
        repositoryChange: {
          surface: 'production' as const,
          intendedChanges: ['Change source.txt within the contract.'],
        },
      }
    : cause === 'verification'
      ? { ...common, cause: 'verification' as const, repositoryChange: { surface: 'none' as const, intendedChanges: [] } }
      : cause === 'environment'
        ? { ...common, cause: 'environment' as const, repositoryChange: { surface: 'none' as const, intendedChanges: [] } }
        : { ...common, cause: 'unknown' as const, repositoryChange: { surface: 'none' as const, intendedChanges: [] } };
  return {
    contractImpact: 'unchanged',
    action,
    entries: [entry],
  };
}

async function prepare(root: string, document: ReturnType<typeof prepareDocument>) {
  const result = await prepareDelegationTask({
    projectRoot: root, inputPath: '-', input: jsonStream(document), productVersion: '0.0.1',
  }) as any;
  if (!result.taskId || !['prepared', 'prepare-replayed'].includes(result.status)) return result;
  const projection = readDelegationTask(root, result.taskId).projection;
  return {
    ...result,
    taskContract: storedJson(
      root,
      result.taskId,
      `contracts/${projection.contractRevision}.json`,
    ),
    baselineVerification: storedJson(
      root,
      result.taskId,
      `contracts/${projection.contractRevision}.baseline-verification.json`,
    ),
  };
}

async function collect(
  root: string,
  taskId: string,
) {
  const startedAt = performance.now();
  const result = await collectDelegationFacts({
    projectRoot: root, taskId, productVersion: '0.0.1',
  }) as any;
  const runtimeCollectionDurationMs = performance.now() - startedAt;
  return {
    ...collectedResultWithFacts(root, taskId, result),
    runtimeCollectionDurationMs,
  };
}

function collectedResultWithFacts(root: string, taskId: string, result: any) {
  const facts = storedAttemptFacts(root, taskId, result.attemptId);
  return {
    ...result,
    ...facts,
    checks: facts.checks.map((check: any) => ({
      ...check,
      ...check.attempts.at(-1),
      attemptCount: check.attempts.length,
    })),
    verifierSurfaces: summarizeVerifierSurfaces(facts.verifierMutations),
  };
}

async function diagnose(
  root: string,
  taskId: string,
  document: ReturnType<typeof disposition>,
) {
  const result = await diagnoseCollectedEvidence({
    projectRoot: root,
    taskId,
    inputPath: '-',
    input: jsonStream(document),
  }) as any;
  const projection = readDelegationTask(root, taskId).projection;
  const attempt = projection.attempts.find((item) =>
    item.evidenceDispositionIds.includes(result.transition.dispositionId));
  assert.ok(attempt);
  const disposition = storedJson(
    root,
    taskId,
    `${attemptDirectory(attempt.attemptId)}/evidence-dispositions/`
      + `${result.transition.dispositionId.slice('sha256:'.length)}.json`,
  );
  return { ...result, disposition };
}

function storedAttemptFacts(root: string, taskId: string, attemptId: string): any {
  const projection = readDelegationTask(root, taskId).projection;
  const attempt = projection.attempts.find((item) => item.attemptId === attemptId);
  assert.ok(attempt?.factCollectionId);
  return storedJson(
    root,
    taskId,
    `${attemptDirectory(attemptId)}/facts/`
      + `${attempt.factCollectionId.slice('sha256:'.length)}.json`,
  );
}

function attemptDirectory(attemptId: string): string {
  return `attempts/${sha256(attemptId).slice(-24)}`;
}

function storedJson(root: string, taskId: string, relativePath: string): any {
  return JSON.parse(readFileSync(
    join(root, '.stetra', 'tasks', taskId, relativePath),
    'utf8',
  ));
}

async function handoff(root: string, taskId: string, document: unknown) {
  const result = await evaluateDelegationHandoff({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
  const detail = explainDelegationTask({ projectRoot: root, taskId, section: 'decision-packet' }) as any;
  return { ...result, decisionPacket: detail.decisionPacket };
}

async function decide(root: string, taskId: string, document: unknown) {
  const result = await recordHumanDecision({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
  const detail = explainDelegationTask({ projectRoot: root, taskId, section: 'decision-packet' }) as any;
  return { ...result, decisionPacket: detail.decisionPacket };
}

async function resolve(root: string, taskId: string, document: unknown) {
  return await resolveHumanChoice({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
}

async function reviseVerification(root: string, taskId: string, document: unknown) {
  return await reviseVerificationPlan({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
}

function jsonStream(value: unknown): Readable {
  return Readable.from([JSON.stringify(value)]);
}

function markCoverageSufficient(document: any): void {
  document.evidenceCoverage = {
    status: 'sufficient',
    rationale: 'The selected evidence covers the bounded conclusion exercised by this fixture.',
    gaps: [],
  };
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for workflow state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function waitForChildExit(
  child: ReturnType<typeof spawn>,
  stderr: string,
): Promise<[number | null, NodeJS.Signals | null]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`Collect did not stop after SIGTERM. ${stderr}`));
    }, 5_000);
    const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve([exitCode, signal]);
    };
    child.once('exit', onExit);
  });
}
