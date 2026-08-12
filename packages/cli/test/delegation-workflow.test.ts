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

import type { DelegationPrepareDocument } from '../src/schemas/delegation.ts';
import type { HostAttestationProvider } from '../src/runtime-context.ts';
import { taskIdForPrepareRequest } from '../src/protocol.ts';
import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  explainDelegationTask,
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
      ['repair-implementation', 'revise-verification', 'challenge', 'handoff', 'ask-human'],
    );
    assert.deepEqual(
      fieldRequirement(collected.hostAction.authoringPacket, 'draft.entries[0].cause').allowedValues,
      ['implementation', 'environment', 'verification', 'unknown'],
    );
    const definitionId = collected.checks[0].definitionId;
    const incompatible = disposition(definitionId, 'environment');
    incompatible.proposedRoute = 'repair-implementation';
    await assert.rejects(
      diagnose(root, prepared.taskId, incompatible),
      /Proposed route repair-implementation is incompatible with declared cause\(s\): environment/,
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

test('mixed implementation and environment failures may repair the bounded implementation cause', async () => {
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
      commandDefinitionPaths: [],
      acceptanceSurfacePaths: [],
    });
    const prepared = await prepare(root, document);
    const collected = await collect(root, prepared.taskId);
    const input = disposition(collected.checks[0].definitionId, 'implementation');
    input.entries.push({
      definitionId: collected.checks[1].definitionId,
      cause: 'environment',
      diagnosis: 'The second command is unavailable for an environment-specific reason.',
      falsificationAttempt: 'Inspected the independent second command and its exact Runtime exit.',
      codeChangeCanAlterObservation: false,
      expectedDifferentObservation: 'The environment failure remains visible after repair.',
      intendedChanges: [],
    });
    input.routeRationale = 'Repair the bounded implementation defect and recollect every check while retaining the environment failure.';
    const diagnosed = await diagnose(root, prepared.taskId, input);
    assert.equal(diagnosed.disposition.route, 'repair-implementation');
    assert.equal(diagnosed.successorAttemptId, 'attempt:2');
    assert.equal(diagnosed.hostAction.kind, 'implement-and-collect');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only implementation diagnosis creates a successor and exhausted budget returns to handoff with lineage intact', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'], maxRepairAttempts: 1,
    }));
    const firstCollection = await collect(root, prepared.taskId);
    const firstDiagnosis = await diagnose(
      root, prepared.taskId, disposition(firstCollection.checks[0].definitionId, 'implementation'),
    );
    assert.equal(firstDiagnosis.disposition.route, 'repair-implementation');
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
    assert.equal(unknown.hostAction.kind, 'author-handoff');
    assert.ok(unknown.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
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
      acceptanceSurfacePaths: ['source.txt'],
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
        falsificationAttempt: 'Inspected whether the command bypasses the intended behavior.',
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
    assert.deepEqual(Object.keys(handedOff.hostAction.authoringPacket.referenceCatalog), ['attention']);
    assert.deepEqual(
      fieldRequirement(handedOff.hostAction.authoringPacket, 'draft.action').allowedValues,
      ['accepted', 'correction-requested', 'rejected', 'deferred'],
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
    assert.equal(stored.projection.decisionStatus, 'pending');
    assert.equal(stored.projection.attempts[1].trigger, 'correction');
    assert.equal(stored.projection.attempts[1].parentAttemptId, 'attempt:1');
    assert.equal(stored.projection.decisionId, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a thin Host routes a required verifier challenge to explicit direct review', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfacePaths: ['source.txt'],
    });
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'author-handoff');
    assert.deepEqual(
      fieldRequirement(
        collected.hostAction.authoringPacket,
        'draft.obligationConclusions[0].status',
      ).allowedValues,
      ['supported', 'partial', 'contradicted', 'unknown'],
    );
    assert.ok(collected.hostAction.authoringPacket.outstandingObligations.some(
      (item: { code: string }) => item.code === 'direct-human-review-required',
    ));
    assert.deepEqual(collected.verifierSurfaces.map((item: { path: string }) => item.path), ['source.txt']);
    const draft = structuredClone(collected.hostAction.authoringPacket.draft);
    draft.summary = 'The implementation passes its changed verifier, but independent evidence is unavailable.';
    for (const conclusion of draft.obligationConclusions) {
      conclusion.status = 'partial';
      conclusion.falsificationAttempt = 'Inspected the changed acceptance surface in the current context.';
      conclusion.conclusion = 'The check passes, while independent falsification remains unavailable.';
    }
    for (const conclusion of draft.conditionConclusions) {
      conclusion.status = 'partial';
      conclusion.summary = 'The missing independent challenge prevents full support.';
    }
    for (const question of draft.reviewQuestions) {
      question.question = 'Does the changed verifier reject the stated failure hypothesis?';
      question.evidence = [{ kind: 'patch' }];
    }
    draft.recommendation = {
      action: 'defer',
      rationale: 'Direct developer review must replace unavailable independent challenge.',
      caveats: ['The current Host cannot attest a separate context.'],
    };
    const handedOff = await handoff(root, prepared.taskId, draft);
    assert.equal(handedOff.status, 'needs-attention');
    assert.ok(handedOff.decisionPacket.attention.some((item: { codes: string[] }) =>
      item.codes.includes('challenge-missing')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a canonical Challenge Authoring Packet completes the persisted challenge-to-handoff path', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfacePaths: ['source.txt'],
    });
    document.developerEvent.content = 'Keep the exact developer phrase "arguments" visible.';
    document.task.desiredOutcome = 'Preserve the requested public wording.';
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId, trustedHost);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.deepEqual(
      Object.keys(collected.hostAction.authoringPacket.referenceCatalog),
      ['conditions', 'obligations', 'checks', 'changedFiles', 'challenges', 'repositoryEvidence'],
    );
    assert.equal(
      collected.hostAction.authoringPacket.semanticContext.exactDeveloperEvent.event.content,
      'Keep the exact developer phrase "arguments" visible.',
    );
    assert.equal(
      collected.hostAction.authoringPacket.semanticContext.agentInterpretation.desiredOutcome,
      'Preserve the requested public wording.',
    );
    assert.equal(collected.hostAction.authoringPacket.semanticContext.exactDeveloperEvent.authority, 'human-event');
    assert.equal(collected.hostAction.authoringPacket.semanticContext.agentInterpretation.authority, 'agent-judgment');
    assert.deepEqual(collected.hostAction.inputBinding, {
      transport: 'stdin', source: 'authoringPacket.draft', serialization: 'json', execution: 'one-shot',
    });

    const challengeDraft = structuredClone(collected.hostAction.authoringPacket.draft);
    const changedFileIds = collected.hostAction.authoringPacket.referenceCatalog.changedFiles
      .map((item: { id: string }) => item.id);
    assert.deepEqual(challengeDraft.evidence.changedFiles, changedFileIds);
    challengeDraft.falsificationAttempt = 'Inspected the changed verifier and exercised the bounded behavior independently.';
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
    assert.ok(
      fieldRequirement(
        challenged.hostAction.authoringPacket, 'draft.residualUnknowns[]',
      ).acceptedShapes?.length,
    );

    const handoffDraft = structuredClone(challenged.hostAction.authoringPacket.draft);
    handoffDraft.summary = 'The changed verifier and implementation are ready for bounded review.';
    for (const conclusion of handoffDraft.obligationConclusions) {
      conclusion.status = 'supported';
      conclusion.falsificationAttempt = 'Inspected the changed verifier and exercised its failure hypothesis.';
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
    assert.deepEqual(
      fieldRequirement(
        diagnosed.hostAction.authoringPacket, 'draft.checks[0].baseline',
      ).acceptedShapes?.[0],
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
      conclusion.falsificationAttempt = 'Ran the current immutable definition and inspected its bounded result.';
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
  acceptanceSurfacePaths?: string[];
}): DelegationPrepareDocument {
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1',
    prepareRequestId: options.prepareRequestId ?? `prepare:${randomUUID()}`,
    developerEvent: { content: 'Change the workflow fixture.' },
    task: { desiredOutcome: 'Change the workflow fixture.', constraints: [], nonGoals: [], focus: ['source.txt'] },
    repositoryEvidence: [],
    conditions: [{
      key: 'behavior', statement: 'The selected observation supports adoption.',
      rationale: 'This condition controls adoption.',
      criticality: options.critical ? 'adoption-critical' : 'material',
      evidenceObligations: [{
        key: 'observation',
        statement: 'The selected observation distinguishes the expected behavior.',
        failureHypothesis: 'The command may pass or fail without exercising the intended behavior.',
        strategies: [
          { kind: 'runtime-check', checkKeys: ['test'] },
          ...(options.critical
            ? [{ kind: 'independent-challenge' as const, policy: 'fact-triggered' as const }]
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
        obligationKeys: [{ conditionKey: 'behavior', obligationKey: 'observation' }],
      } : { mode: 'unknown' },
      commandDefinitionPaths: [],
      acceptanceSurfacePaths: options.acceptanceSurfacePaths ?? [],
    }],
  };
}

function disposition(definitionId: string, cause: 'implementation' | 'environment' | 'verification' | 'unknown') {
  const proposedRoute = cause === 'implementation'
    ? 'repair-implementation' as const
    : cause === 'environment' || cause === 'verification'
      ? 'revise-verification' as const
      : 'challenge' as const;
  return {
    semanticImpact: 'none' as 'none' | 'material',
    proposedRoute: proposedRoute as
      | 'repair-implementation' | 'revise-verification' | 'challenge' | 'handoff' | 'ask-human',
    routeRationale: `The declared ${cause} cause requires the selected explicit next step.`,
    entries: [{
      definitionId, cause,
      diagnosis: `The observed cause is ${cause}.`,
      falsificationAttempt: 'Inspected the command, environment, and changed implementation.',
      codeChangeCanAlterObservation: cause === 'implementation',
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
  return await recordChallenge({
    projectRoot: root, taskId, inputPath: '-', input: jsonStream(document), hostAttestations,
  }) as any;
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

const trustedHost: HostAttestationProvider = {
  provenance: 'evaluation-runner',
  async evaluatePolicies() {
    return [];
  },
  async attestChallenge() {
    return {
      attestationId: 'attestation:test-host',
      implementerContextId: 'context:implementer',
      challengerContextId: 'context:challenger',
    };
  },
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
