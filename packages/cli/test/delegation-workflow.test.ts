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
import { stableFingerprint, taskIdForPrepareRequest } from '../src/protocol.ts';
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
    assert.equal(preparedGuard.stateWritten, false);

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
    collected = await collect(root, prepared.taskId);

    const handoffDraft = structuredClone(collected.hostAction.authoringPacket.draft);
    handoffDraft.summary = 'The routine fixture now contains the requested current implementation.';
    handoffDraft.importantSystemEffects = ['The fixture text changed.'];
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
    assert.match(stored.projection.attempts[0].evidenceDispositionPath ?? '', /evidence-disposition\.json$/);
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
      argv: [process.execPath, '-e', 'process.exit(2)'],
      baseline: { mode: 'unknown' },
      verifierSelectors: [],
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'implementation');
    input.entries.push({
      source: { kind: 'check', definitionId: collected.checks[1].definitionId },
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
  } finally {
    rmSync(materialRoot, { recursive: true, force: true });
  }
});

test('diagnosis-to-handoff preserves thin-Host direct review and places failed checks in counter-evidence', async () => {
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

    assert.equal(diagnosed.hostAction.kind, 'author-handoff');
    assert.ok(diagnosed.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
    assert.ok(!diagnosed.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'required-challenge-missing',
    ));
    const conclusion = diagnosed.hostAction.authoringPacket.draft.obligationConclusions[0];
    assert.deepEqual(conclusion.evidence, []);
    assert.deepEqual(conclusion.counterEvidence, [{
      kind: 'check', id: collected.checks[0].definitionId,
    }]);
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
    assert.equal(stored.projection.resolvedHostPolicyIds.length, 2);
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
      summary: 'The first implementation is ready for review.',
      obligationConclusions: [{
        obligationId: obligation.id,
        status: 'supported',
        evidence: [{ kind: 'check', id: collected.checks[0].definitionId }],
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
      importantSystemEffects: [], residualUnknowns: [], reviewQuestions: [],
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
    assert.deepEqual(handedOff.hostAction.developerDecisionBrief.decisionState, {
      delivery: 'implementation-complete', evidence: 'handoff-ready',
      recommendation: 'accept', adoption: 'pending',
    });
    assert.equal(
      handedOff.hostAction.developerDecisionBrief.changeMeaning.actualSystemMeaning,
      'The first implementation is ready for review.',
    );
    assert.equal(handedOff.hostAction.developerDecisionBrief.conditions[0].status, 'supported');
    assert.deepEqual(handedOff.hostAction.developerDecisionBrief.decisionIssues, []);
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
    assert.equal(stored.projection.decisionStatus, 'pending');
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
    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    challengeDraft.falsificationAttempt = 'Inspected the changed verifier in a separate but unattested context.';
    challengeDraft.observedResult = 'The selected evidence did not expose the frozen failure hypothesis.';
    challengeDraft.supportingEvidence = [{
      statement: 'The current check and patch support the bounded observation.',
      references: [{ kind: 'check', id: challengeDraft.evidence.checks[0] }],
    }];
    challengeDraft.outcome = 'supported';
    challengeDraft.conclusion = 'The separate review supports the bounded obligation, without Host attestation.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft);
    assert.equal(challenged.challenge.independence, 'unverified');
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
      ['partial', 'contradicted', 'unknown'],
    );
    assert.deepEqual(
      fieldRequirement(
        challenged.hostAction.authoringPacket,
        'draft.conditionConclusions[0].status',
      ).allowedValues,
      ['partial', 'contradicted', 'unknown'],
    );
    assert.ok(challenged.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
    assert.deepEqual(collected.verifierSurfaces.map((item: { path: string }) => item.path), ['source.txt']);
    const draft = structuredClone(challenged.hostAction.authoringPacket.draft);
    draft.summary = 'The implementation passes its changed verifier, but Host-attested independence is unavailable.';
    for (const conclusion of draft.obligationConclusions) {
      conclusion.status = 'partial';
      conclusion.falsification = {
        attempt: 'Used the separate Challenger output and inspected the changed acceptance surface.',
        observedResult: 'The check and Challenger support the boundary, but the Host lifecycle is unverified.',
      };
      conclusion.conclusion = 'The check passes, while trusted independent provenance remains unavailable.';
    }
    for (const conclusion of draft.conditionConclusions) {
      conclusion.status = 'partial';
      conclusion.summary = 'The unverified Challenge provenance prevents full support.';
    }
    for (const question of draft.reviewQuestions) {
      question.question = 'Does the changed verifier reject the stated failure hypothesis?';
      question.evidence = [{ kind: 'patch' }];
    }
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
    const issue = handedOff.hostAction.developerDecisionBrief.decisionIssues.find(
      (item: { codes: string[] }) => item.codes.includes('challenge-independence-unverified'),
    );
    assert.deepEqual(issue.codes, ['challenge-independence-unverified', 'direct-review-required']);
    assert.equal(issue.attentionIds.length, 2);
    assert.deepEqual(issue.conditionIds, [condition.id]);
    assert.deepEqual(issue.obligationIds, [obligation.id]);
    assert.equal(issue.reviewQuestions.length, 1);
    assert.ok(
      handedOff.hostAction.developerDecisionBrief.requestedDecision
        .acceptanceRequiresExceptionsFor.includes(issue.attentionIds[0]),
    );
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
      'inputKind', 'bindsTo', 'target', 'evidence', 'draft', 'output',
    ]);
    assert.equal(
      collected.hostAction.challengeExecutionPacket.target.exactDeveloperEvents.events[0].content,
      'Keep the exact developer phrase "arguments" visible.',
    );
    assert.equal(
      collected.hostAction.challengeExecutionPacket.target.condition.statement,
      prepared.taskContract.adoptionConditions[0].statement,
    );
    assert.equal(collected.hostAction.challengeExecutionPacket.target.exactDeveloperEvents.authority, 'human-event');
    assert.equal(collected.hostAction.challengeExecutionPacket.target.condition.authority, 'agent-judgment');
    assert.deepEqual(collected.hostAction.inputBinding, {
      transport: 'stdin', source: 'hostChallengeSubmission', serialization: 'json', execution: 'one-shot',
    });

    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    const changedFileIds = collected.hostAction.challengeExecutionPacket.evidence.changedFiles
      .map((item: { id: string }) => item.id);
    assert.deepEqual(challengeDraft.evidence.changedFiles, changedFileIds);
    challengeDraft.falsificationAttempt = 'Inspected the changed verifier and exercised the bounded behavior independently.';
    challengeDraft.observedResult = 'The independent exercise observed the expected bounded behavior.';
    challengeDraft.supportingEvidence = [{
      statement: 'The changed verifier and frozen check were inspected together.',
      references: [
        ...changedFileIds.map((id: string) => ({ kind: 'changed-file', id })),
        ...challengeDraft.evidence.checks.map((id: string) => ({ kind: 'check', id })),
      ],
    }];
    challengeDraft.outcome = 'supported';
    challengeDraft.conclusion = 'The bounded failure hypothesis was not observed.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft, trustedHost);
    assert.equal(challenged.status, 'challenge-recorded');
    assert.equal(challenged.challenge.independence, 'host-attested');
    assert.deepEqual(challenged.challenge.evidence.changedFiles, changedFileIds);
    assert.equal(challenged.hostAction.kind, 'author-handoff');
    const challengeHistory = explainDelegationTask({
      projectRoot: root, taskId: prepared.taskId, section: 'challenge',
    }) as any;
    assert.equal(challengeHistory.hostReceipts.length, 1);
    assert.equal(
      challengeHistory.hostReceipts[0].receiptId,
      challenged.challenge.attestationId,
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
    handoffDraft.summary = 'The changed verifier and implementation are ready for bounded review.';
    for (const conclusion of handoffDraft.obligationConclusions) {
      conclusion.status = 'supported';
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
    for (const question of handoffDraft.reviewQuestions) {
      question.question = 'Does the changed verifier still distinguish the intended behavior?';
      question.evidence = [
        ...changedFileIds.map((id: string) => ({ kind: 'changed-file', id })),
        { kind: 'challenge', id: challenged.challenge.id },
      ];
    }
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
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    draft.falsificationAttempt = 'Inspected the selected evidence in a separate context.';
    draft.observedResult = 'The selected evidence did not expose the failure hypothesis.';
    draft.supportingEvidence = [{
      statement: 'An unavailable check must not be accepted as current evidence.',
      references: [{ kind: 'check', id: `sha256:${'f'.repeat(64)}` }],
    }];
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

test('Challenge receipts require current request, exact output, trusted verification, and single use', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      critical: true,
    }));
    writeFileSync(join(root, 'source.txt'), 'challenge receipt boundary\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    draft.falsificationAttempt = 'Inspected the exact bounded behavior in a separate context.';
    draft.observedResult = 'The stated counterexample was not observed.';
    draft.outcome = 'supported';
    draft.conclusion = 'The bounded obligation is supported by the cited current evidence.';
    const alteredSelection = structuredClone(draft);
    alteredSelection.evidence.checks = [];
    await assert.rejects(
      challenge(root, prepared.taskId, alteredSelection),
      /preserve the exact frozen falsification and evidence selection/,
    );
    const submission: any = challengeSubmission(
      root,
      prepared.taskId,
      draft,
      trustedHost,
    );

    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(submission),
      }),
      /requires a trusted Host integration/,
    );

    const wrongRequest = structuredClone(submission);
    wrongRequest.requestId = stableFingerprint('different request');
    wrongRequest.hostReceipt!.requestId = wrongRequest.requestId;
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(wrongRequest),
        hostAttestations: trustedHost,
      }),
      /requestId does not match the current/,
    );

    const wrongOutput = structuredClone(submission);
    wrongOutput.hostReceipt!.outputFingerprint = stableFingerprint({ altered: true });
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(wrongOutput),
        hostAttestations: trustedHost,
      }),
      /does not bind the submitted Challenge output/,
    );

    const rejectingHost: HostAttestationProvider = {
      provenance: 'evaluation-runner',
      async evaluatePolicies() { return []; },
      async verifyChallengeRun() { return false; },
    };
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(submission),
        hostAttestations: rejectingHost,
      }),
      /rejected the Challenge Run Receipt/,
    );

    const accepted = await recordChallenge({
      projectRoot: root,
      taskId: prepared.taskId,
      inputPath: '-',
      input: jsonStream(submission),
      hostAttestations: trustedHost,
    }) as any;
    assert.equal(accepted.challenge.independence, 'host-attested');
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(submission),
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
    const draft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    draft.falsificationAttempt = 'Inspected the current collected implementation.';
    draft.observedResult = 'The current collected boundary was supported.';
    draft.outcome = 'supported';
    draft.conclusion = 'The bounded conclusion applies only to the collected worktree.';
    const submission = challengeSubmission(root, prepared.taskId, draft, trustedHost);

    writeFileSync(join(root, 'source.txt'), 'changed after challenge observation\n', 'utf8');
    await assert.rejects(
      recordChallenge({
        projectRoot: root,
        taskId: prepared.taskId,
        inputPath: '-',
        input: jsonStream(submission),
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

    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    const checkId = challengeDraft.evidence.checks[0];
    challengeDraft.falsificationAttempt = 'Exercised the declared counterexample in a fresh context.';
    challengeDraft.observedResult = 'The counterexample contradicted the bounded obligation.';
    challengeDraft.counterEvidence = [{
      statement: 'The frozen observation remains green while the counterexample fails.',
      references: [{ kind: 'check', id: checkId }],
    }];
    challengeDraft.outcome = 'contradicted';
    challengeDraft.conclusion = 'The current implementation does not satisfy the bounded obligation.';
    const challenged = await challenge(root, prepared.taskId, challengeDraft, trustedHost);
    assert.equal(challenged.hostAction.kind, 'diagnose-collected-evidence');
    assert.deepEqual(challenged.hostAction.authoringPacket.draft.entries[0].source, {
      kind: 'challenge', challengeId: challenged.challenge.id,
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
    assert.equal(history.challenges[0].id, challenged.challenge.id);

    writeFileSync(join(root, 'source.txt'), 'repaired implementation\n', 'utf8');
    const recollected = await collect(root, prepared.taskId, trustedHost);
    assert.equal(recollected.attemptId, 'attempt:2');
    assert.equal(recollected.hostAction.kind, 'perform-independent-challenge');
    assert.notEqual(
      recollected.hostAction.challengeExecutionPacket.bindsTo.factCollectionId,
      challenged.challenge.factCollectionId,
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
    const challengeDraft = structuredClone(collected.hostAction.challengeExecutionPacket.draft);
    const checkId = challengeDraft.evidence.checks[0];
    const counterStatement = 'The persistent verifier remains green without exercising the declared boundary.';
    challengeDraft.falsificationAttempt = 'Inspected whether the frozen verifier exercises the declared boundary.';
    challengeDraft.observedResult = 'The implementation path passed, but the verifier omitted the boundary.';
    challengeDraft.counterEvidence = [{
      statement: counterStatement,
      references: [{ kind: 'check', id: checkId }],
    }];
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
      kind: 'challenge', id: challenged.challenge.id,
    }]);
    handoffDraft.summary = 'The implementation behavior is partly supported, with a persistent-verification gap.';
    handoffDraft.obligationConclusions[0].status = 'partial';
    handoffDraft.obligationConclusions[0].falsification = {
      attempt: 'Reviewed the independent challenge and its omitted verifier boundary.',
      observedResult: 'The behavior probe passed while persistent coverage remained incomplete.',
    };
    handoffDraft.obligationConclusions[0].conclusion = 'The obligation remains only partially supported.';
    handoffDraft.conditionConclusions[0].status = 'partial';
    handoffDraft.conditionConclusions[0].summary = 'Persistent protection remains unresolved.';
    for (const question of handoffDraft.reviewQuestions) {
      question.question = 'Is the missing persistent boundary acceptable for adoption?';
      question.evidence = [{ kind: 'challenge', id: challenged.challenge.id }];
    }
    handoffDraft.recommendation = {
      action: 'defer',
      rationale: 'The developer should decide whether persistent protection is required before adoption.',
      caveats: ['The independent challenge recorded an unresolved verifier boundary.'],
    };
    const handedOff = await handoff(root, prepared.taskId, handoffDraft);
    const recorded = handedOff.decisionPacket.evidenceJudgments.challenges[0];
    assert.equal(recorded.outcome, 'partial');
    assert.equal(recorded.counterEvidence[0].statement, counterStatement);
    assert.deepEqual(recorded.counterEvidence[0].references, [{ kind: 'check', id: checkId }]);
    const finding = handedOff.hostAction.developerDecisionBrief
      .conditions[0].obligations[0].evidenceBoundary.challengeFindings[0];
    assert.equal(finding.id, challenged.challenge.id);
    assert.equal(finding.outcome, 'partial');
    assert.equal(finding.conclusion, challengeDraft.conclusion);
    assert.equal(finding.counterEvidence[0].statement, counterStatement);
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
    const diagnosed = await diagnose(
      root,
      prepared.taskId,
      disposition(first.checks[0].definitionId, 'verification'),
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
    draft.checks[0].argv = [process.execPath, '-e', 'process.exit(0)'];
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
    handoffDraft.summary = 'The rebound verification passed against the current implementation.';
    for (const conclusion of handoffDraft.obligationConclusions) {
      conclusion.status = 'supported';
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
    for (const question of handoffDraft.reviewQuestions) {
      question.question = 'Does the execution rebinding preserve the intended verification boundary?';
      question.evidence = [{ kind: 'check', id: second.checks[0].definitionId }];
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
    assert.equal(handedOff.hostAction.developerDecisionBrief.evidenceHistory.length, 1);
    assert.equal(
      handedOff.hostAction.developerDecisionBrief.evidenceHistory[0].resolution.actualRoute,
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
    delivery: { maxRepairAttempts: options.maxRepairAttempts ?? 2 },
    checks: [{
      key: 'test', rationale: 'Observe the fixture.', argv: options.argv,
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
      source: { kind: 'check' as const, definitionId }, cause,
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
  const submission = challengeSubmission(root, taskId, document, hostAttestations);
  return await recordChallenge({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(submission), hostAttestations,
  }) as any;
}

function challengeSubmission(
  root: string,
  taskId: string,
  document: unknown,
  hostAttestations?: HostAttestationProvider,
) {
  const current = explainDelegationTask({
    projectRoot: root,
    taskId,
    section: 'action',
    hostAttestations,
  }) as any;
  const request = current.hostAction.challengeExecutionRequest;
  if (!hostAttestations) return { challenge: document };
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
  return stopped.submission;
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
  verifyChallengeRun: testChallengeLifecycle.verifyChallengeRun,
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
