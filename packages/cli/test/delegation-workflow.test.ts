import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

import type {
  DelegationPrepareDocument,
  EvidenceDispositionDocument,
} from '../src/schemas/delegation.ts';
import { HostChallengeLifecycle } from '../src/host/challenge-lifecycle.ts';
import type { HostAttestationProvider } from '../src/runtime-context.ts';
import { taskIdForPrepareRequest } from '../src/protocol.ts';
import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  explainDelegationTask,
  guardFinalResponse,
  prepareDelegationTask,
  readDelegationTask,
  recordChallenge,
  recordHumanDecision,
  resolveHumanChoice,
  reviseVerificationPlan,
} from '../src/workflow/delegation.ts';

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
    assert.equal(prepared.taskContract.authority.developerEventIds.length, 2);
    assert.equal(prepared.taskContract.materialDecisions.length, 1);
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
    document.conditions = [];
    const prepared = await prepare(root, document);
    const preparedGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(preparedGuard.disposition, 'continue-workflow');
    assert.equal(preparedGuard.hostAction?.kind, 'implement-and-collect');
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

    writeFileSync(join(root, 'source.txt'), 'current implementation\n', 'utf8');
    const staleGuard = await guardFinalResponse({
      projectRoot: root, taskId: prepared.taskId,
    });
    assert.equal(staleGuard.disposition, 'continue-workflow');
    assert.equal(staleGuard.factsCurrent, false);
    assert.equal(staleGuard.hostAction?.kind, 'recollect-stale-facts');
    assert.equal(staleGuard.actionUnchanged, false);
    collected = await collect(root, prepared.taskId);

    const handoffDraft = structuredClone(collected.hostAction.authoringPacket.draft);
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
      handedOff.hostAction.decisionContinuation.authoringPacket.draft,
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
    assert.equal(prepared.baselineVerification.checks[0].observation.status, 'passed');
    assert.equal(prepared.baselineVerification.checks[0].observation.attempts, undefined);
    const baselineDetail = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'baseline',
    }) as any;
    assert.equal(
      baselineDetail.baselineVerification.checks[0].observation.attempts[0].status,
      'passed',
    );
    const baselineLog = baselineDetail.baselineVerification.checks[0]
      .observation.attempts[0].stderr.logPath;
    assert.match(baselineLog, new RegExp(`^\\.stetra/tasks/${prepared.taskId}/baseline-checks/`));
    assert.equal(readFileSync(join(root, baselineLog), 'utf8'), 'baseline warning\n');

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.deepEqual(collected.changedFiles.map((item: { path: string }) => item.path), ['source.txt']);
    assert.equal(collected.checkComparisons[0].relation, 'passed-before-passed-now');
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
      collected.hostAction.authoringPacket.draft.entries[0].source.observation,
      'baseline-expectation-mismatch',
    );

    const invalid = collected.hostAction.authoringPacket.draft;
    invalid.semanticImpact = 'none';
    invalid.proposedRoute = 'repair-delivery';
    invalid.routeRationale = 'Treat the baseline mismatch as an implementation defect.';
    invalid.entries[0] = {
      ...invalid.entries[0],
      cause: 'implementation',
      diagnosis: 'The implementation caused the mismatch.',
      falsificationAttempt: 'Inspected the current implementation.',
      repositoryChangeCanAlterObservation: true,
      changeSurface: 'production',
      expectedDifferentObservation: 'The baseline would pass after changing production code.',
      intendedChanges: ['Change source.txt.'],
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
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(Object.keys(collected.hostAction.authoringPacket.referenceCatalog), ['checks']);
    const regenerated = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'action',
    }) as any;
    assert.equal(regenerated.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(regenerated.hostAction.authoringPacket.draft, collected.hostAction.authoringPacket.draft);
    assert.deepEqual(
      fieldRequirement(collected.hostAction.authoringPacket, 'draft.semanticImpact').allowedValues,
      ['none', 'material'],
    );
    assert.deepEqual(
      fieldRequirement(collected.hostAction.authoringPacket, 'draft.proposedRoute').allowedValues,
      ['repair-delivery', 'revise-verification', 'challenge', 'handoff', 'ask-human'],
    );
    assert.deepEqual(
      fieldRequirement(collected.hostAction.authoringPacket, 'draft.entries[0].cause').allowedValues,
      ['implementation', 'environment', 'verification', 'unknown'],
    );
    const definitionId = collected.checks[0].definitionId;
    const incompatible = disposition(definitionId, 'environment');
    incompatible.proposedRoute = 'repair-delivery';
    await assert.rejects(
      diagnose(root, prepared.taskId, incompatible),
      /Proposed route repair-delivery is incompatible with declared cause\(s\): environment/,
    );
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
      repositoryChangeCanAlterObservation: false,
      changeSurface: 'none',
      expectedDifferentObservation: 'The environment failure remains visible after repair.',
      intendedChanges: [],
    });
    input.routeRationale = 'Repair the bounded implementation defect and recollect every check while retaining the environment failure.';
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
    input.proposedRoute = 'repair-delivery';
    input.routeRationale = 'Add the missing repository assertion without changing the frozen command definition.';
    input.entries[0].repositoryChangeCanAlterObservation = true;
    input.entries[0].changeSurface = 'verification-surface';
    input.entries[0].intendedChanges = ['Add the missing counterexample to the existing test surface.'];

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

test('material diagnosis and critical unknowns route from explicit semantics rather than error text', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', "console.error('same output');process.exit(1)"],
      critical: true,
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const unknown = await diagnose(root, prepared.taskId, disposition(collected.checks[0].definitionId, 'unknown'));
    assert.equal(unknown.disposition.route, 'challenge');
    assert.equal(unknown.hostAction.kind, 'perform-independent-challenge');
    assert.deepEqual(unknown.hostAction.challengeExecutionRequest.workspacePolicy, {
      targetWorktree: 'read-only',
      executionWorkspace: 'isolated-writable',
      externalEffects: 'forbidden',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const materialRoot = createRepository();
  try {
    const prepared = await prepare(materialRoot, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(materialRoot, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'environment');
    input.semanticImpact = 'material';
    input.proposedRoute = 'ask-human';
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

test('required Challenge remains preferred after evidence diagnosis', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(1)'],
      critical: true,
      acceptanceSurfaceSelectors: [{ kind: 'file', path: 'source.txt' }],
    }));
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'environment');
    input.proposedRoute = 'handoff';
    input.routeRationale = 'Keep the non-passing environment observation visible in direct Human review.';
    const diagnosed = await diagnose(root, prepared.taskId, input);

    assert.equal(diagnosed.hostAction.kind, 'perform-independent-challenge');
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    const prematureHandoff = {
      actualChange: {
        behavior: 'The failed observation remains unresolved.',
        mechanism: ['The implementation changes the selected verifier surface.'],
        preservedInvariants: [], failureAndRecovery: [], importantEffects: [], materialTradeoffs: [],
      },
      obligationConclusions: [{
        obligationId: obligation.id,
        status: 'unknown',
        evidence: [],
        evidenceCoverage: {
          status: 'insufficient',
          rationale: 'The current check is non-passing.',
          gaps: ['Independent challenge remains pending.'],
        },
        falsification: {
          attempt: 'Inspected the current non-passing check.',
          observedResult: 'The check did not establish the intended behavior.',
        },
        counterEvidence: [{ kind: 'check', id: collected.checks[0].definitionId }],
        conclusion: 'The obligation remains unresolved.',
      }],
      conditionConclusions: [{
        conditionId: condition.id,
        status: 'unknown',
        summary: 'The adoption condition remains unresolved.',
      }],
      residualUnknowns: [],
      reviewQuestions: [{
        conditionIds: [condition.id],
        obligationIds: [obligation.id],
        question: 'Does the changed behavior satisfy the intended boundary?',
        adoptionImpact: condition.adoptionRationale,
        evidence: [{ kind: 'check', id: collected.checks[0].definitionId }],
      }],
      recommendation: {
        action: 'defer',
        rationale: 'The required independent challenge remains pending.',
        caveats: ['The current check is non-passing.'],
      },
    };
    assert.equal(diagnosed.hostAction.kind, 'perform-independent-challenge');

    const challengeDraft = structuredClone(
      diagnosed.hostAction.challengeExecutionPacket.draft.results[0],
    );
    challengeDraft.falsificationAttempt = 'Inspected the failed observation in a separate but unattested context.';
    challengeDraft.observedResult = 'The current frozen check remains non-passing.';
    challengeDraft.counterEvidence = [{
      statement: 'The current frozen check does not support the bounded adoption condition.',
      provenance: 'runtime-fact',
      reproduction: 'runtime-recorded',
      references: [{ kind: 'check', id: collected.checks[0].definitionId }],
    }];
    challengeDraft.evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The non-passing observation cannot establish the expected behavior.',
      gaps: ['A supporting current observation remains unavailable.'],
    };
    challengeDraft.outcome = 'unknown';
    challengeDraft.conclusion = 'The bounded obligation remains unresolved.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft);
    assert.equal(challenged.hostAction.kind, 'diagnose-collected-evidence');

    const adverseDiagnosis = structuredClone(challenged.hostAction.authoringPacket.draft);
    adverseDiagnosis.semanticImpact = 'none';
    adverseDiagnosis.proposedRoute = 'handoff';
    adverseDiagnosis.routeRationale = 'Keep the non-passing observations visible for direct review.';
    for (const entry of adverseDiagnosis.entries) {
      const challengeEntry = entry.source.kind === 'challenge';
      Object.assign(entry, {
        cause: challengeEntry ? 'unknown' : 'environment',
        diagnosis: challengeEntry
          ? 'The challenge did not resolve the bounded condition.'
          : 'The current environment observation remains non-passing.',
        falsificationAttempt: 'Reviewed the exact observation and its evidence coverage.',
        repositoryChangeCanAlterObservation: false,
        changeSurface: 'none',
        expectedDifferentObservation: 'A supporting current observation would resolve the gap.',
        intendedChanges: [],
      });
    }
    const readyForHandoff = await diagnose(root, prepared.taskId, adverseDiagnosis);
    assert.equal(readyForHandoff.hostAction.kind, 'author-handoff');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts[0].evidenceDispositionIds.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('required Host policies pause prepare until every explicit requirement is resolved', async () => {
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
    assert.deepEqual(
      fieldRequirement(prepared.hostAction.authoringPacket, 'draft.action').allowedValues,
      ['continue-current-contract', 'request-correction', 'abort'],
    );
    const firstTarget = prepared.hostAction.authoringPacket.draft.target;
    const first = await resolve(root, prepared.taskId, {
      humanEvent: { content: 'Continue while retaining the first policy gap for adoption review.' },
      target: firstTarget,
      action: 'continue-current-contract',
      reason: 'The first limitation is understood and remains visible.',
    });
    assert.equal(first.hostAction.kind, 'resolve-evidence-decision');
    const secondTarget = first.hostAction.authoringPacket.draft.target;
    assert.notDeepEqual(secondTarget, firstTarget);

    const second = await resolve(root, prepared.taskId, {
      humanEvent: { content: 'Continue while retaining the second policy gap for adoption review.' },
      target: secondTarget,
      action: 'continue-current-contract',
      reason: 'The second limitation is understood and remains visible.',
    });
    assert.equal(second.hostAction.kind, 'implement-and-collect');
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.humanResolutionIds.length, 2);
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
    const handedOff = await handoff(root, prepared.taskId, {
      actualChange: {
        behavior: 'The first implementation is ready for review.',
        mechanism: ['The fixture source is updated directly.'],
        preservedInvariants: [], failureAndRecovery: [], importantEffects: [], materialTradeoffs: [],
      },
      obligationConclusions: [{
        obligationId: obligation.id,
        status: 'supported',
        evidence: [{ kind: 'check', id: collected.checks[0].definitionId }],
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
      conditionConclusions: [{
        conditionId: condition.id, status: 'supported', summary: 'The obligation is supported.',
      }],
      residualUnknowns: [], reviewQuestions: [],
      recommendation: { action: 'accept', rationale: 'The bounded evidence is current.', caveats: [] },
    });
    assert.equal(handedOff.status, 'handoff-ready');
    assert.equal(handedOff.hostAction.kind, 'present-handoff-and-await-human-decision');
    assert.equal(handedOff.hostAction.command, undefined);
    assert.deepEqual(
      Object.keys(handedOff.hostAction.decisionContinuation.authoringPacket.referenceCatalog),
      ['attention'],
    );
    assert.deepEqual(
      fieldRequirement(
        handedOff.hostAction.decisionContinuation.authoringPacket,
        'draft.action',
      ).allowedValues,
      ['accepted', 'correction-requested', 'rejected', 'deferred'],
    );
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

test('a thin Host runs the bounded Challenger but preserves unverified direct review', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfaceSelectors: [{ kind: 'file', path: 'source.txt' }],
    });
    const prepared = await prepare(root, document);
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.equal(
      collected.hostAction.challengeExecutionRequest.agentProfile,
      'stetra-challenger',
    );
    const guardedChallenge = await guardFinalResponse({
      projectRoot: root,
      taskId: prepared.taskId,
    });
    assert.equal(guardedChallenge.disposition, 'continue-workflow');
    assert.equal(guardedChallenge.hostAction?.kind, 'perform-independent-challenge');
    assert.equal(
      guardedChallenge.hostAction?.challengeExecutionRequest?.requestId,
      collected.hostAction.challengeExecutionRequest.requestId,
    );
    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    challengeDraft.falsificationAttempt = 'Inspected the changed verifier in a separate but unattested context.';
    challengeDraft.observedResult = 'The selected evidence did not expose the frozen failure hypothesis.';
    challengeDraft.supportingEvidence = [{
      statement: 'The current check and patch support the bounded observation.',
      provenance: 'runtime-fact',
      reproduction: 'runtime-recorded',
      references: [{ kind: 'check', id: challengeDraft.evidence.checks[0] }],
    }];
    markCoverageSufficient(challengeDraft);
    challengeDraft.outcome = 'supported';
    challengeDraft.conclusion = 'The separate review supports the bounded obligation, without Host attestation.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft);
    assert.equal(challenged.challenges[0].independence, 'unverified');
    assert.equal(challenged.hostAction.kind, 'author-handoff');
    const guardedHandoff = await guardFinalResponse({
      projectRoot: root,
      taskId: prepared.taskId,
    });
    assert.equal(guardedHandoff.hostAction?.kind, 'author-handoff');
    assert.deepEqual(
      fieldRequirement(
        challenged.hostAction.authoringPacket,
        'draft.obligationConclusions[0].status',
      ).allowedValues,
      ['supported', 'partial', 'contradicted', 'unknown'],
    );
    assert.deepEqual(
      fieldRequirement(
        challenged.hostAction.authoringPacket,
        'draft.conditionConclusions[0].status',
      ).allowedValues,
      ['supported', 'partial', 'contradicted', 'unknown'],
    );
    assert.ok(challenged.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
    assert.deepEqual(collected.verifierSurfaces.map((item: { path: string }) => item.path), ['source.txt']);
    const draft = structuredClone(challenged.hostAction.authoringPacket.draft);
    draft.actualChange.behavior = 'The implementation passes its changed verifier, but Host-attested independence is unavailable.';
    draft.actualChange.mechanism = ['The implementation and verifier surface change together.'];
    for (const conclusion of draft.obligationConclusions) {
      conclusion.status = 'supported';
      conclusion.evidenceCoverage = {
        status: 'sufficient',
        rationale: 'The selected evidence covers the bounded behavior, while Host provenance remains unresolved.',
        gaps: [],
      };
      conclusion.falsification = {
        attempt: 'Used the separate Challenger output and inspected the changed acceptance surface.',
        observedResult: 'The check and Challenger support the boundary, but the Host lifecycle is unverified.',
      };
      conclusion.conclusion = 'The cited evidence supports the bounded behavior finding.';
    }
    for (const conclusion of draft.conditionConclusions) {
      conclusion.status = 'supported';
      conclusion.summary = 'The Agent finds the bounded condition supported by the cited evidence.';
    }
    draft.reviewQuestions.push({
      conditionIds: [condition.id], obligationIds: [obligation.id],
      question: 'Does the changed verifier reject the stated failure hypothesis?',
      adoptionImpact: condition.adoptionRationale,
      evidence: [{ kind: 'patch' }],
    });
    draft.recommendation = {
      action: 'accept',
      rationale: 'The changed verifier passed.',
      caveats: [],
    };
    await assert.rejects(
      handoff(root, prepared.taskId, draft),
      (error: unknown) => {
        const issues = (error as { issues?: Array<{ code?: string; path: string }> }).issues;
        return Boolean(issues?.some((issue) =>
          issue.code === 'recommendation-evidence-conflict'
          && issue.path === 'recommendation.action'));
      },
    );
    draft.recommendation = {
      action: 'defer',
      rationale: 'Direct developer review must resolve the unverified Challenge provenance.',
      caveats: ['The current Host cannot attest the separate context lifecycle.'],
    };
    const handedOff = await handoff(root, prepared.taskId, draft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.ok(handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('challenge-independence-unverified')));
    assert.equal(handedOff.decisionPacket.conditions[0].agentFinding.status, 'supported');
    assert.equal(handedOff.decisionPacket.conditions[0].obligations[0].agentFinding.status, 'supported');
    assert.equal(handedOff.decisionPacket.conditions[0].obligations[0].evidencePath.status, 'unverified');
    assert.equal(handedOff.hostAction.developerDecisionBrief.primary.conditions[0].obligations[0].evidencePath.status, 'unverified');
    const issue = handedOff.hostAction.developerDecisionBrief.primary.blockers.find(
      (item: { codes: string[] }) => item.codes.includes('challenge-independence-unverified'),
    );
    assert.deepEqual(issue.codes, ['challenge-independence-unverified', 'direct-review-required']);
    assert.deepEqual(issue.affectedConditions, [condition.statement]);
    assert.equal(issue.reviewQuestions.length, 1);
    assert.deepEqual(
      handedOff.hostAction.presentationRequirements.requiredAttentionIds.sort(),
      handedOff.decisionPacket.attention.map((item: { id: string }) => item.id).sort(),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unavailable fresh-context execution can degrade to an honest limited handoff', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.equal(collected.hostAction.limitedHandoff.preservesChallengeGap, true);
    const explained = explainDelegationTask({
      projectRoot: root,
      taskId: prepared.taskId,
      section: 'handoff-draft',
    }) as any;
    assert.ok(explained.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
    const handoffDraft = structuredClone(explained.authoringPacket.draft);
    const condition = prepared.taskContract.adoptionConditions[0];
    const obligation = condition.evidenceObligations[0];
    handoffDraft.actualChange.behavior = 'Runtime facts are current, while the independent Challenge remains unavailable.';
    handoffDraft.actualChange.mechanism = ['The implementation follows the changed fixture path.'];
    handoffDraft.obligationConclusions[0].status = 'unknown';
    handoffDraft.obligationConclusions[0].evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The current check does not replace the frozen independent falsification attempt.',
      gaps: ['The developer must inspect the failure hypothesis directly.'],
    };
    handoffDraft.obligationConclusions[0].falsification = {
      attempt: 'Preserved the unexecuted independent Challenge boundary for direct review.',
      observedResult: 'No Host-attested independent observation is available.',
    };
    handoffDraft.obligationConclusions[0].conclusion = 'The independent evidence path remains unknown.';
    handoffDraft.conditionConclusions[0].status = 'unknown';
    handoffDraft.conditionConclusions[0].summary = 'The adoption condition requires direct Human inspection.';
    handoffDraft.reviewQuestions = [{
      conditionIds: [condition.id],
      obligationIds: [obligation.id],
      question: 'Does the implementation survive the frozen failure hypothesis?',
      adoptionImpact: condition.adoptionRationale,
      evidence: [{ kind: 'check', id: collected.checks[0].definitionId }],
    }];
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

test('a tree verifier selector detects a changed descendant and triggers challenge', async () => {
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
    const collected = await collect(root, prepared.taskId, trustedHost);

    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.deepEqual(collected.verifierSurfaces, [{
      path: 'test/surface.txt',
      role: 'acceptance-surface',
      definitionIds: [collected.checks[0].definitionId],
    }]);
    const explained = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'attempts',
    }) as unknown as { attempts: Array<{ facts: { verifierMutations: Array<Record<string, unknown>> } }> };
    const stored = explained.attempts[0].facts;
    assert.deepEqual(stored.verifierMutations[0].selector, {
      kind: 'tree', path: 'test', role: 'acceptance-surface',
    });
    assert.equal(stored.verifierMutations[0].matchedBy, 'current-path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bounded Challenge Execution Packet completes the persisted challenge-to-handoff path', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfaceSelectors: [{ kind: 'file', path: 'source.txt' }],
    });
    document.developerEvents[0].content = 'Keep the exact developer phrase "arguments" visible.';
    document.task.desiredOutcome = 'Preserve the requested public wording.';
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.equal(collected.hostAction.authoringPacket, undefined);
    assert.deepEqual(Object.keys(collected.hostAction.challengeExecutionPacket), [
      'inputKind', 'bindsTo', 'sharedEvidence', 'cases', 'draft', 'output',
    ]);
    assert.equal(
      collected.hostAction.challengeExecutionPacket.cases[0].target.exactDeveloperEvents.events[0].content,
      'Keep the exact developer phrase "arguments" visible.',
    );
    assert.equal(
      collected.hostAction.challengeExecutionPacket.cases[0].target.condition.statement,
      prepared.taskContract.adoptionConditions[0].statement,
    );
    assert.equal(collected.hostAction.challengeExecutionPacket.cases[0].target.exactDeveloperEvents.authority, 'human-event');
    assert.equal(collected.hostAction.challengeExecutionPacket.cases[0].target.condition.authority, 'agent-judgment');
    assert.deepEqual(collected.hostAction.inputBinding, {
      transport: 'stdin', source: 'challengeExecutionPacket.draft', serialization: 'json', execution: 'one-shot',
    });

    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    const changedFileIds = collected.hostAction.challengeExecutionPacket.sharedEvidence.changedFiles
      .map((item: { id: string }) => item.id);
    assert.deepEqual(challengeDraft.evidence.changedFiles, changedFileIds);
    challengeDraft.falsificationAttempt = 'Inspected the changed verifier and exercised the bounded behavior independently.';
    challengeDraft.observedResult = 'The independent exercise observed the expected bounded behavior.';
    challengeDraft.supportingEvidence = [{
      statement: 'The changed verifier and frozen check were inspected together.',
      provenance: 'runtime-fact',
      reproduction: 'runtime-recorded',
      references: [
        ...changedFileIds.map((id: string) => ({ kind: 'changed-file', id })),
        ...challengeDraft.evidence.checks.map((id: string) => ({ kind: 'check', id })),
      ],
    }];
    markCoverageSufficient(challengeDraft);
    challengeDraft.outcome = 'supported';
    challengeDraft.conclusion = 'The bounded failure hypothesis was not observed.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft, trustedHost);
    assert.equal(challenged.status, 'challenge-recorded');
    assert.equal(challenged.challenges[0].independence, 'host-attested');
    assert.deepEqual(challenged.challenges[0].evidence.changedFiles, changedFileIds);
    assert.equal(challenged.hostAction.kind, 'author-handoff');
    const challengeHistory = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'challenge',
    }) as any;
    assert.equal(challengeHistory.hostReceipts.length, 1);
    assert.equal(
      challengeHistory.hostReceipts[0].receiptId,
      challenged.challenges[0].attestationId,
    );
    assert.equal(challengeHistory.hostReceipts[0].lifecycle, 'start-and-stop-observed');
    const regenerated = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'action',
    }) as any;
    assert.equal(regenerated.hostAction.kind, 'author-handoff');
    assert.deepEqual(
      regenerated.hostAction.authoringPacket.draft,
      challenged.hostAction.authoringPacket.draft,
    );
    assert.deepEqual(
      fieldRequirement(
        challenged.hostAction.authoringPacket, 'draft.recommendation.action',
      ).allowedValues,
      ['accept', 'request-correction', 'reject', 'defer'],
    );
    const unknownRequirement = fieldRequirement(
      challenged.hostAction.authoringPacket, 'draft.residualUnknowns[]',
    );
    assert.equal(unknownRequirement.shapeRef, 'residual-unknown');
    assert.ok(challenged.hostAction.authoringPacket.shapeCatalog['residual-unknown'].length);

    const handoffDraft = structuredClone(challenged.hostAction.authoringPacket.draft);
    handoffDraft.actualChange.behavior = 'The changed verifier and implementation are ready for bounded review.';
    handoffDraft.actualChange.mechanism = ['The implementation follows the changed verifier path.'];
    for (const conclusion of handoffDraft.obligationConclusions) {
      conclusion.status = 'supported';
      conclusion.evidenceCoverage = {
        status: 'sufficient',
        rationale: 'The current check and independent challenge cover the bounded conclusion.',
        gaps: [],
      };
      conclusion.falsification = {
        attempt: 'Inspected the changed verifier and exercised its failure hypothesis.',
        observedResult: 'The independent challenge and current check observed the expected boundary.',
      };
      conclusion.conclusion = 'The exact collected evidence supports this bounded obligation.';
    }
    for (const conclusion of handoffDraft.conditionConclusions) {
      conclusion.status = 'supported';
      conclusion.summary = 'Every declared evidence obligation is supported.';
    }
    const condition = prepared.taskContract.adoptionConditions[0];
    handoffDraft.reviewQuestions.push({
      conditionIds: [condition.id],
      obligationIds: condition.evidenceObligations.map((item: { id: string }) => item.id),
      question: 'Does the changed verifier still distinguish the intended behavior?',
      adoptionImpact: condition.adoptionRationale,
      evidence: [
        ...changedFileIds.map((id: string) => ({ kind: 'changed-file', id })),
        { kind: 'challenge', id: challenged.challenges[0].id },
      ],
    });
    handoffDraft.recommendation = {
      action: 'defer',
      rationale: 'The bounded evidence is current, while the changed verifier still needs developer review.',
      caveats: ['The acceptance surface changed in this task.'],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.ok(!handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('challenge-independence-unverified')));
    assert.ok(readDelegationTask(root, prepared.taskId).projection.currentHandoffId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one Challenge Round evaluates every outstanding obligation in one Host context', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    });
    document.conditions.push({
      ...structuredClone(document.conditions[0]),
      key: 'durability',
      statement: 'The changed behavior remains protected by durable evidence.',
      evidenceObligations: [{
        ...structuredClone(document.conditions[0].evidenceObligations[0]),
        key: 'durable-observation',
        statement: 'The same collected facts distinguish the durable behavior boundary.',
      }],
    });
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'round implementation\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    const packet = collected.hostAction.challengeExecutionPacket;
    assert.equal(packet.cases.length, 2);
    assert.equal(packet.draft.results.length, 2);

    const round = structuredClone(packet.draft);
    for (const result of round.results) {
      result.falsificationAttempt = 'Exercised this exact obligation in the shared fresh context.';
      result.observedResult = 'The bounded counterexample was not observed.';
      markCoverageSufficient(result);
      result.outcome = 'supported';
      result.conclusion = 'This bounded obligation is supported by the selected current evidence.';
    }
    const receipt = observeTrustedChallenge(root, prepared.taskId, round);
    const recorded = await recordChallenge({
      projectRoot: root,
      taskId: prepared.taskId,
      inputPath: '-',
      input: jsonStream(round),
      hostAttestations: trustedHost,
    }) as any;
    assert.equal(recorded.challenges.length, 2);
    assert.equal(new Set(recorded.challenges.map((item: any) => item.roundId)).size, 1);
    assert.deepEqual(
      new Set(recorded.challenges.map((item: any) => item.attestationId)),
      new Set([receipt.receiptId]),
    );
    assert.equal(new Set(recorded.challenges.map((item: any) => item.challengerContextId)).size, 1);
    assert.equal(recorded.hostAction.kind, 'author-handoff');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unavailable nested Challenge evidence cannot mutate task state', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfaceSelectors: [{ kind: 'file', path: 'source.txt' }],
    });
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    draft.falsificationAttempt = 'Inspected the selected evidence in a separate context.';
    draft.observedResult = 'The selected evidence did not expose the failure hypothesis.';
    draft.supportingEvidence = [{
      statement: 'An unavailable check must not be accepted as current evidence.',
      provenance: 'runtime-fact',
      reproduction: 'runtime-recorded',
      references: [{ kind: 'check', id: `sha256:${'f'.repeat(64)}` }],
    }];
    markCoverageSufficient(draft);
    draft.outcome = 'supported';
    draft.conclusion = 'This structurally valid but unavailable reference must be rejected.';
    const before = await guardFinalResponse({ projectRoot: root, taskId: prepared.taskId });

    await assert.rejects(() => challenge(root, prepared.taskId, draft), (error: unknown) => {
      const candidate = error as { issues?: Array<{ path: string; code?: string }> };
      assert.ok(candidate.issues?.some((issue) =>
        issue.code === 'challenge-evidence-reference-invalid'
        && issue.path === 'supportingEvidence[0].references[0].id'));
      return true;
    });

    const after = await guardFinalResponse({ projectRoot: root, taskId: prepared.taskId });
    assert.equal(after.revision, before.revision);
    assert.equal(after.actionFingerprint, before.actionFingerprint);
    assert.equal(after.hostAction?.kind, 'perform-independent-challenge');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Challenge receipts remain Host-owned, bind exact output, and are consumed once', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    writeFileSync(join(root, 'source.txt'), 'challenge receipt boundary\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    draft.falsificationAttempt = 'Inspected the exact bounded behavior in a separate context.';
    draft.observedResult = 'The stated counterexample was not observed.';
    markCoverageSufficient(draft);
    draft.outcome = 'supported';
    draft.conclusion = 'The bounded obligation is supported by the cited current evidence.';
    const alteredSelection = structuredClone(draft);
    alteredSelection.evidence.checks = [];
    await assert.rejects(
      challenge(root, prepared.taskId, alteredSelection),
      /preserve its frozen falsification and evidence selection/,
    );
    const round = { results: [draft] };
    const receipt = observeTrustedChallenge(
      root,
      prepared.taskId,
      round,
    );

    const wrongRequestHost: HostAttestationProvider = {
      provenance: 'evaluation-runner',
      async evaluatePolicies() { return []; },
      async consumeChallengeRun() {
        return { ...receipt, requestId: `sha256:${'0'.repeat(64)}` };
      },
    };
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(round),
        hostAttestations: wrongRequestHost,
      }),
      /bound to a different Challenge Execution Request/,
    );

    const wrongOutputHost: HostAttestationProvider = {
      provenance: 'evaluation-runner',
      async evaluatePolicies() { return []; },
      async consumeChallengeRun() {
        return { ...receipt, outputFingerprint: `sha256:${'1'.repeat(64)}` };
      },
    };
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(round),
        hostAttestations: wrongOutputHost,
      }),
      /does not bind the submitted Challenge Round output/,
    );

    const rejectingHost: HostAttestationProvider = {
      provenance: 'evaluation-runner',
      async evaluatePolicies() { return []; },
      async consumeChallengeRun() { return undefined; },
    };
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(round),
        hostAttestations: rejectingHost,
      }),
      /rejected or could not match the Challenge run/,
    );

    const accepted = await recordChallenge({
      projectRoot: root,
      taskId: prepared.taskId,
      inputPath: '-',
      input: jsonStream(round),
      hostAttestations: trustedHost,
    }) as any;
    assert.equal(accepted.challenges[0].independence, 'host-attested');
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(round),
        hostAttestations: trustedHost,
      }),
      /does not request an Independent Challenge|already been consumed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Challenge receipt cannot outlive the collected worktree facts', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    writeFileSync(join(root, 'source.txt'), 'collected implementation\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    draft.falsificationAttempt = 'Inspected the current collected implementation.';
    draft.observedResult = 'The current collected boundary was supported.';
    markCoverageSufficient(draft);
    draft.outcome = 'supported';
    draft.conclusion = 'The bounded conclusion applies only to the collected worktree.';
    const round = { results: [draft] };
    observeTrustedChallenge(root, prepared.taskId, round);

    writeFileSync(join(root, 'source.txt'), 'changed after challenge observation\n', 'utf8');
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(round),
        hostAttestations: trustedHost,
      }),
      /Facts changed before challenge/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an adverse Challenge returns to bounded diagnosis and a successor Attempt requires fresh Challenge evidence', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    writeFileSync(join(root, 'source.txt'), 'first implementation\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');

    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    const checkId = challengeDraft.evidence.checks[0];
    challengeDraft.falsificationAttempt = 'Exercised the declared counterexample in a fresh context.';
    challengeDraft.observedResult = 'The counterexample contradicted the bounded obligation.';
    challengeDraft.counterEvidence = [{
      statement: 'The frozen observation remains green while the counterexample fails.',
      provenance: 'challenger-execution',
      reproduction: 'agent-reported',
      references: [{ kind: 'check', id: checkId }],
    }];
    markCoverageSufficient(challengeDraft);
    challengeDraft.outcome = 'contradicted';
    challengeDraft.conclusion = 'The current implementation does not satisfy the bounded obligation.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft, trustedHost);
    assert.equal(challenged.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(challenged.hostAction.authoringPacket.draft.entries[0].source, {
      kind: 'challenge', challengeId: challenged.challenges[0].id, observation: 'adverse',
    });

    const diagnosis = structuredClone(challenged.hostAction.authoringPacket.draft);
    diagnosis.semanticImpact = 'none';
    diagnosis.proposedRoute = 'repair-delivery';
    diagnosis.routeRationale = 'The counterexample identifies a bounded implementation defect inside the current contract.';
    diagnosis.entries[0] = {
      ...diagnosis.entries[0],
      cause: 'implementation',
      diagnosis: 'The implementation omits the counterexample path.',
      falsificationAttempt: 'Inspected whether verification or environment state explains the adverse observation.',
      repositoryChangeCanAlterObservation: true,
      changeSurface: 'production',
      expectedDifferentObservation: 'The same fresh counterexample is supported after repair.',
      intendedChanges: ['Repair the bounded source path without changing task meaning.'],
    };
    const diagnosed = await diagnose(root, prepared.taskId, diagnosis);
    assert.equal(diagnosed.status, 'repair-prepared');
    assert.equal(diagnosed.hostAction.kind, 'implement-and-collect');

    const history = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'challenge',
    }) as any;
    assert.equal(history.challenges.length, 1);
    assert.equal(history.challenges[0].id, challenged.challenges[0].id);

    writeFileSync(join(root, 'source.txt'), 'repaired implementation\n', 'utf8');
    const recollected = await collect(root, prepared.taskId, trustedHost);
    assert.equal(recollected.attemptId, 'attempt:2');
    assert.equal(recollected.hostAction.kind, 'perform-independent-challenge');
    assert.notEqual(
      recollected.hostAction.challengeExecutionPacket.bindsTo.factCollectionId,
      challenged.challenges[0].factCollectionId,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an adverse Challenge preserves its exact counter-evidence through Handoff and the developer brief', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    writeFileSync(join(root, 'source.txt'), 'implementation with an unresolved boundary\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft.results[0]);
    const checkId = challengeDraft.evidence.checks[0];
    const counterStatement = 'The persistent verifier remains green without exercising the declared boundary.';
    challengeDraft.falsificationAttempt = 'Inspected whether the frozen verifier exercises the declared boundary.';
    challengeDraft.observedResult = 'The implementation path passed, but the verifier omitted the boundary.';
    challengeDraft.counterEvidence = [{
      statement: counterStatement,
      provenance: 'repository-inspection',
      reproduction: 'agent-reported',
      references: [{ kind: 'check', id: checkId }],
    }];
    challengeDraft.evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The verifier does not cover the complete declared boundary.',
      gaps: ['Persistent verification for the omitted boundary is missing.'],
    };
    challengeDraft.outcome = 'partial';
    challengeDraft.conclusion = 'Current behavior has some support, while persistent protection remains incomplete.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft, trustedHost);
    assert.equal(challenged.hostAction.kind, 'diagnose-collected-evidence');

    const diagnosis = structuredClone(challenged.hostAction.authoringPacket.draft);
    diagnosis.semanticImpact = 'none';
    diagnosis.proposedRoute = 'handoff';
    diagnosis.routeRationale = 'Keep the unresolved persistent-verification boundary visible for developer review.';
    diagnosis.entries[0] = {
      ...diagnosis.entries[0],
      cause: 'verification',
      diagnosis: 'The current verifier does not protect the complete declared boundary.',
      falsificationAttempt: 'Compared the verifier surface with the frozen failure hypothesis.',
      repositoryChangeCanAlterObservation: false,
      changeSurface: 'none',
      expectedDifferentObservation: 'No different observation is claimed without expanding persistent verification.',
      intendedChanges: [],
    };
    const diagnosed = await diagnose(root, prepared.taskId, diagnosis);
    assert.equal(diagnosed.hostAction.kind, 'author-handoff');
    const handoffDraft = structuredClone(diagnosed.hostAction.authoringPacket.draft);
    assert.deepEqual(handoffDraft.obligationConclusions[0].counterEvidence, [{
      kind: 'challenge', id: challenged.challenges[0].id,
    }]);
    handoffDraft.actualChange.behavior = 'The implementation behavior is partly supported, with a persistent-verification gap.';
    handoffDraft.actualChange.mechanism = ['The implementation updates the fixture while generated verification remains stale.'];
    handoffDraft.obligationConclusions[0].status = 'partial';
    handoffDraft.obligationConclusions[0].evidenceCoverage = {
      status: 'insufficient',
      rationale: 'The behavior probe passes, but persistent verifier coverage remains incomplete.',
      gaps: ['The persistent verifier does not cover the complete declared boundary.'],
    };
    handoffDraft.obligationConclusions[0].falsification = {
      attempt: 'Reviewed the independent challenge and its omitted verifier boundary.',
      observedResult: 'The behavior probe passed while persistent coverage remained incomplete.',
    };
    handoffDraft.obligationConclusions[0].conclusion = 'The obligation remains only partially supported.';
    handoffDraft.conditionConclusions[0].status = 'partial';
    handoffDraft.conditionConclusions[0].summary = 'Persistent protection remains unresolved.';
    const condition = prepared.taskContract.adoptionConditions[0];
    handoffDraft.reviewQuestions.push({
      conditionIds: [condition.id],
      obligationIds: condition.evidenceObligations.map((item: { id: string }) => item.id),
      question: 'Is the missing persistent boundary acceptable for adoption?',
      adoptionImpact: condition.adoptionRationale,
      evidence: [{ kind: 'challenge', id: challenged.challenges[0].id }],
    });
    handoffDraft.recommendation = {
      action: 'defer',
      rationale: 'The developer should decide whether persistent protection is required before adoption.',
      caveats: ['The independent challenge recorded an unresolved verifier boundary.'],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    const recorded = handedOff.decisionPacket.evidenceJudgments.challenges[0];
    assert.equal(recorded.outcome, 'partial');
    assert.equal(recorded.counterEvidence[0].statement, counterStatement);
    assert.equal(recorded.counterEvidence[0].provenance, 'repository-inspection');
    assert.equal(recorded.counterEvidence[0].reproduction, 'agent-reported');
    assert.deepEqual(recorded.counterEvidence[0].references, [{ kind: 'check', id: checkId }]);
    const finding = handedOff.hostAction.developerDecisionBrief.primary
      .conditions[0].obligations[0].evidenceBoundary.challengeFindings[0];
    assert.equal(finding.outcome, 'partial');
    assert.equal(finding.conclusion, challengeDraft.conclusion);
    assert.equal(finding.counterEvidence[0].statement, counterStatement);
    assert.equal(finding.counterEvidence[0].provenance, 'repository-inspection');
    assert.equal(finding.counterEvidence[0].reproduction, 'agent-reported');
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
    const firstDiagnosis = structuredClone(first.hostAction.authoringPacket.draft);
    firstDiagnosis.semanticImpact = 'none';
    firstDiagnosis.proposedRoute = 'revise-verification';
    firstDiagnosis.routeRationale = 'The frozen assertion definition cannot produce the declared observation.';
    firstDiagnosis.entries = firstDiagnosis.entries.map((entry: any) => ({
      ...entry,
      cause: 'verification',
      diagnosis: 'The frozen assertion exits unsuccessfully by construction.',
      falsificationAttempt: 'Inspected the exact assertion argv and both Runtime observations.',
      repositoryChangeCanAlterObservation: false,
      changeSurface: 'none',
      expectedDifferentObservation: 'A corrected immutable definition records the intended assertion result.',
      intendedChanges: [],
    }));
    const diagnosed = await diagnose(
      root,
      prepared.taskId,
      firstDiagnosis,
    );
    assert.equal(diagnosed.disposition.route, 'revise-verification');
    assert.equal(diagnosed.hostAction.kind, 'revise-verification');
    assert.deepEqual(
      fieldRequirement(diagnosed.hostAction.authoringPacket, 'draft.kind').allowedValues,
      ['execution-rebinding', 'verification-plan'],
    );
    const baselineRequirement = fieldRequirement(
      diagnosed.hostAction.authoringPacket, 'draft.checks[0].baseline',
    );
    assert.equal(baselineRequirement.shapeRef, 'verification-baseline');
    assert.deepEqual(
      diagnosed.hostAction.authoringPacket.shapeCatalog['verification-baseline'][0],
      { mode: 'unknown' },
    );
    const draft = diagnosed.hostAction.authoringPacket.draft;
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

    const handoffDraft = structuredClone(second.hostAction.authoringPacket.draft);
    handoffDraft.actualChange.behavior = 'The rebound verification passed against the current implementation.';
    handoffDraft.actualChange.mechanism = ['The revised command executes the same bounded fixture assertion.'];
    for (const conclusion of handoffDraft.obligationConclusions) {
      conclusion.status = 'supported';
      conclusion.evidenceCoverage = {
        status: 'sufficient',
        rationale: 'The current immutable definition covers the bounded conclusion.',
        gaps: [],
      };
      conclusion.falsification = {
        attempt: 'Ran the current immutable definition and inspected its bounded result.',
        observedResult: 'The current definition passed and exercised the bounded behavior.',
      };
      conclusion.conclusion = 'The current passing observation supports this bounded obligation.';
    }
    for (const conclusion of handoffDraft.conditionConclusions) {
      conclusion.status = 'supported';
      conclusion.summary = 'Every current evidence obligation is supported.';
    }
    const condition = prepared.taskContract.adoptionConditions[0];
    handoffDraft.reviewQuestions.push({
      conditionIds: [condition.id],
      obligationIds: condition.evidenceObligations.map((item: { id: string }) => item.id),
      question: 'Does the execution rebinding preserve the intended verification boundary?',
      adoptionImpact: condition.adoptionRationale,
      evidence: [{ kind: 'check', id: second.checks[0].definitionId }],
    });
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
    conditions: [{
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
    }],
    hostPolicyRequirements: [],
    executionBudget: {
      checkTimeoutMs: 300_000,
      maxDeliveryRepairs: options.maxRepairAttempts ?? 2,
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
        obligationKeys: [{ conditionKey: 'behavior', obligationKey: 'observation' }],
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
  const proposedRoute = cause === 'implementation'
    ? 'repair-delivery' as const
    : cause === 'environment' || cause === 'verification'
      ? 'revise-verification' as const
      : 'challenge' as const;
  return {
    semanticImpact: 'none',
    proposedRoute,
    routeRationale: `The declared ${cause} cause requires the selected explicit next step.`,
    entries: [{
      source: { kind: 'check' as const, definitionId, observation: 'current-nonpassing' as const }, cause,
      diagnosis: `The observed cause is ${cause}.`,
      falsificationAttempt: 'Inspected the command, environment, and changed implementation.',
      repositoryChangeCanAlterObservation: cause === 'implementation',
      changeSurface: cause === 'implementation' ? 'production' as const : 'none' as const,
      expectedDifferentObservation: 'A subsequent Runtime attempt records the expected status.',
      intendedChanges: cause === 'implementation' ? ['Change source.txt within the contract.'] : [],
    }],
  };
}

async function prepare(root: string, document: ReturnType<typeof prepareDocument>) {
  return await prepareDelegationTask({
    projectRoot: root, inputPath: '-', input: jsonStream(document), productVersion: '0.0.1',
  }) as any;
}

async function collect(
  root: string,
  taskId: string,
  hostAttestations?: HostAttestationProvider,
) {
  return await collectDelegationFacts({
    projectRoot: root, taskId, productVersion: '0.0.1', hostAttestations,
  }) as any;
}

async function diagnose(root: string, taskId: string, document: ReturnType<typeof disposition>) {
  return await diagnoseCollectedEvidence({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
}

async function handoff(root: string, taskId: string, document: unknown) {
  return await evaluateDelegationHandoff({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
}

async function challenge(
  root: string,
  taskId: string,
  document: unknown,
  hostAttestations?: HostAttestationProvider,
) {
  const round = { results: [document] };
  if (hostAttestations?.consumeChallengeRun === trustedHost.consumeChallengeRun) {
    observeTrustedChallenge(root, taskId, round);
  }
  return await recordChallenge({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(round), hostAttestations,
  }) as any;
}

function observeTrustedChallenge(
  root: string,
  taskId: string,
  document: unknown,
) {
  const current = explainDelegationTask({
    projectRoot: root,
    taskId,
    section: 'action',
    hostAttestations: trustedHost,
  }) as any;
  const request = current.hostAction.challengeExecutionRequest;
  testChallengeLifecycle.observeStart({
    request,
    challengeExecutionPacket: current.hostAction.challengeExecutionPacket,
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: `context:challenger:${request.requestId.slice(-8)}`,
    targetWorktree: 'read-only',
    executionWorkspace: 'isolated-writable',
    sourceSnapshotFingerprint: request.bindsTo.worktreeFingerprint,
    externalEffects: 'forbidden',
  });
  const stopped = testChallengeLifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: `context:challenger:${request.requestId.slice(-8)}`,
    output: document,
  });
  if (stopped.status !== 'completed') {
    throw new Error('Test Challenger output must be schema-valid.');
  }
  return stopped.receipt;
}

async function decide(root: string, taskId: string, document: unknown) {
  return await recordHumanDecision({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document),
  }) as any;
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

function fieldRequirement(packet: any, path: string): any {
  const requirement = packet.fieldRequirements.find((item: { path: string }) => item.path === path);
  assert.ok(requirement, `Missing Authoring Packet field requirement ${path}.`);
  return requirement;
}

const testChallengeLifecycle = new HostChallengeLifecycle('evaluation-runner');

const trustedHost: HostAttestationProvider = {
  provenance: 'evaluation-runner',
  async evaluatePolicies() {
    return [];
  },
  consumeChallengeRun: testChallengeLifecycle.consumeChallengeRun,
};

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for workflow state.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
