import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { DelegationPrepareDocument } from '../src/schemas/delegation.ts';
import {
  collectDelegationFacts,
  diagnoseCollectedEvidence,
  evaluateDelegationHandoff,
  prepareDelegationTask,
  readDelegationTask,
  recordHumanDecision,
  resolveHumanChoice,
  reviseVerificationPlan,
} from '../src/workflow/delegation.ts';

test('prepare selectively captures task-start check observations and freezes their side effects into the baseline', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'task-start',
      argv: [process.execPath, '-e', "require('node:fs').writeFileSync('baseline-artifact.txt','baseline\\n')"],
    });
    const prepared = await prepare(root, document);
    assert.equal(prepared.status, 'prepared');
    assert.deepEqual(
      prepared.baselineVerification.checkInducedChanges.map((item: { path: string }) => item.path),
      ['baseline-artifact.txt'],
    );
    assert.equal(prepared.baselineVerification.checks[0].observation.attempts[0].status, 'passed');

    writeFileSync(join(root, 'source.txt'), 'after\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.deepEqual(collected.changedFiles.map((item: { path: string }) => item.path), ['source.txt']);
    assert.equal(collected.checkComparisons[0].relation, 'passed-before-passed-now');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a non-passing check requires explicit fact-bound diagnosis and environment cause routes to handoff without repair', async () => {
  const root = createRepository();
  try {
    const prepared = await prepare(root, prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(1)'],
    }));
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'diagnose-collected-evidence');
    const definitionId = collected.checks[0].definitionId;
    const diagnosed = await diagnose(root, prepared.taskId, disposition(definitionId, 'environment'));
    assert.equal(diagnosed.disposition.route, 'handoff');
    assert.equal(diagnosed.hostAction.kind, 'author-handoff');
    assert.equal(diagnosed.task.repairCount, 0);
    const stored = readDelegationTask(root, prepared.taskId);
    assert.equal(stored.projection.attempts.length, 1);
    assert.match(stored.projection.attempts[0].evidenceDispositionPath ?? '', /evidence-disposition\.json$/);
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
    assert.equal(unknown.hostAction.kind, 'perform-independent-challenge');
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
    const decided = await decide(root, prepared.taskId, {
      humanEvent: { content: 'Correct the wording without changing the current semantic contract.' },
      action: 'correction-requested',
      reason: 'The first result needs a bounded correction.',
      exceptions: [],
    });
    assert.equal(decided.decisionStatus, 'correction-requested');
    assert.equal(decided.hostAction.kind, 'resolve-evidence-decision');
    const decisionId = decided.decisionPacket.decision.decisionId;
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

test('changing an explicitly declared verifier acceptance surface triggers critical challenge', async () => {
  const root = createRepository();
  try {
    const document = prepareDocument({
      baseline: 'unknown', argv: [process.execPath, '-e', 'process.exit(0)'], critical: true,
      acceptanceSurfacePaths: ['source.txt'],
    });
    const prepared = await prepare(root, document);
    writeFileSync(join(root, 'source.txt'), 'changed verifier surface\n', 'utf8');
    const collected = await collect(root, prepared.taskId);
    assert.equal(collected.hostAction.kind, 'perform-independent-challenge');
    assert.deepEqual(collected.verifierSurfaces.map((item: { path: string }) => item.path), ['source.txt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verification revision preserves old facts and starts a new exact-definition Attempt', async () => {
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
  maxRepairAttempts?: number;
  critical?: boolean;
  acceptanceSurfacePaths?: string[];
}): DelegationPrepareDocument {
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1',
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
          { kind: 'runtime-check', checkKeys: ['test'], expectedObservation: 'passed' },
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
  return {
    semanticImpact: 'none' as 'none' | 'material',
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

async function collect(root: string, taskId: string) {
  return await collectDelegationFacts({ projectRoot: root, taskId, productVersion: '0.0.1' }) as any;
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

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
}
