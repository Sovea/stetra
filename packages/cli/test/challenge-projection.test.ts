import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDelegation,
  type FactBundle,
  type TaskContract,
  type VerificationDefinition,
} from '@sovea/stetra-core';

import { sha256, stableFingerprint } from '../src/protocol.ts';
import { challengeExecutionPacket } from '../src/workflow/challenge-projection.ts';

test('Challenge projection contains one exact obligation and only its explicit evidence relations', () => {
  const contract = contractFixture();
  const targetCondition = contract.adoptionConditions.find((item) => item.key === 'target')!;
  const targetObligation = targetCondition.evidenceObligations[0];
  const otherCondition = contract.adoptionConditions.find((item) => item.key === 'other')!;
  const targetDefinition = findDefinition(contract, 'target-check');
  const otherDefinition = findDefinition(contract, 'other-check');
  const facts = factsFixture(contract, targetDefinition.definitionId, otherDefinition.definitionId);

  const packet = challengeExecutionPacket({
    task: { taskId: '00000000-0000-4000-8000-000000000001', revision: 4, currentAttemptId: 'attempt:1' },
    contract,
    facts,
    completedObligationIds: [],
    requiredObligationIds: [targetObligation.id],
  });

  assert.equal(packet.target.condition.id, targetCondition.id);
  assert.equal(packet.target.obligation.id, targetObligation.id);
  assert.deepEqual(
    packet.target.exactDeveloperEvents.events.map((item) => item.content),
    ['Exact target request.'],
  );
  assert.ok(!packet.target.exactDeveloperEvents.events.some((item) =>
    item.id === contract.authority.developerEvents.find((event) =>
      event.content === 'Unrelated developer context.')!.id));
  assert.deepEqual(packet.evidence.checks.map((item) => item.definitionId), [targetDefinition.definitionId]);
  assert.ok(!packet.evidence.checks.some((item) => item.definitionId === otherDefinition.definitionId));
  assert.deepEqual(packet.evidence.repositoryEvidence.map((item) => item.path), ['src/target.ts']);
  assert.deepEqual(packet.evidence.repositoryEvidence[0].declaredRelations, [
    'condition-basis', 'obligation-strategy',
  ]);
  assert.deepEqual(packet.evidence.verifierMutations.map((item) => item.definitionId), [
    targetDefinition.definitionId,
  ]);
  assert.equal(packet.evidence.changedFiles.length, 3);
  assert.deepEqual(
    packet.evidence.changedFiles.find((item) => item.path === 'src/target.ts')!.declaredRelations,
    {
      verifierDefinitionIds: [],
      repositoryEvidenceIds: [contract.repositoryEvidence.find((item) =>
        item.path === 'src/target.ts')!.id],
    },
  );
  assert.deepEqual(
    packet.evidence.changedFiles.find((item) => item.path === 'test/target.test.ts')!.declaredRelations,
    { verifierDefinitionIds: [targetDefinition.definitionId], repositoryEvidenceIds: [] },
  );
  assert.deepEqual(packet.draft.evidence, {
    changedFiles: facts.changedFiles.map((item) => item.id),
    checks: [targetDefinition.definitionId],
    repositoryEvidence: [contract.repositoryEvidence.find((item) =>
      item.path === 'src/target.ts')!.id],
    humanEvents: targetCondition.basis.humanEventIds,
    patch: true,
  });
  assert.equal(stableFingerprint(packet), stableFingerprint(challengeExecutionPacket({
    task: { taskId: packet.bindsTo.taskId, revision: 4, currentAttemptId: 'attempt:1' },
    contract,
    facts,
    completedObligationIds: [],
    requiredObligationIds: [targetObligation.id],
  })));
  assert.ok(!JSON.stringify(packet).includes(otherCondition.statement));
  assert.ok(!('referenceCatalog' in packet));
  assert.ok(!('shapeCatalog' in packet));
  assert.ok(!('fieldRequirements' in packet));
});

test('Challenge projection advances only through explicit completed obligation identities', () => {
  const contract = contractFixture();
  const obligations = contract.adoptionConditions.flatMap((condition) => condition.evidenceObligations);
  const facts = factsFixture(
    contract,
    findDefinition(contract, 'target-check').definitionId,
    findDefinition(contract, 'other-check').definitionId,
  );
  assert.throws(() => challengeExecutionPacket({
    task: { taskId: '00000000-0000-4000-8000-000000000001', revision: 4, currentAttemptId: 'attempt:1' },
    contract,
    facts,
    completedObligationIds: [obligations[0].id],
    requiredObligationIds: [obligations[0].id],
  }), /one outstanding Evidence Obligation/);
});

function contractFixture(): TaskContract {
  const compiled = compileDelegation({
    protocol: 'cognitive-adoption',
    schemaVersion: '1',
    developerEvents: [
      { key: 'target-request', content: 'Exact target request.' },
      { key: 'unrelated-context', content: 'Unrelated developer context.' },
    ],
    task: {
      basis: { developerEventKeys: ['target-request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change only the target behavior.',
      constraints: [],
      nonGoals: [],
      focus: ['src/target.ts'],
    },
    materialDecisionForks: [],
    repositoryEvidence: [
      evidence('target-evidence', 'src/target.ts', 'target source'),
      evidence('other-evidence', 'src/other.ts', 'other source'),
    ],
    conditions: [
      {
        key: 'target',
        statement: 'The target boundary remains correct.',
        rationale: 'It changes this adoption decision.',
        criticality: 'adoption-critical',
        basis: {
          developerEventKeys: ['target-request'],
          repositoryEvidenceKeys: ['target-evidence'],
        },
        evidenceObligations: [{
          key: 'target-obligation',
          statement: 'The target counterexample is rejected.',
          falsification: falsification('target'),
          strategies: [
            { kind: 'runtime-check', checkKeys: ['target-check'] },
            { kind: 'repository-inspection', repositoryEvidenceKeys: ['target-evidence'] },
            { kind: 'independent-challenge', policy: 'required' },
          ],
        }],
      },
      {
        key: 'other',
        statement: 'An unrelated boundary remains correct.',
        rationale: 'It is intentionally outside this Challenge target.',
        criticality: 'material',
        basis: {
          developerEventKeys: ['unrelated-context'],
          repositoryEvidenceKeys: ['other-evidence'],
        },
        evidenceObligations: [{
          key: 'other-obligation',
          statement: 'The unrelated check passes.',
          falsification: falsification('other'),
          strategies: [
            { kind: 'runtime-check', checkKeys: ['other-check'] },
            { kind: 'repository-inspection', repositoryEvidenceKeys: ['other-evidence'] },
          ],
        }],
      },
    ],
    hostPolicyRequirements: [],
    delivery: { maxRepairAttempts: 1 },
    checks: [
      check('target-check', 'test/target.test.ts'),
      check('other-check', 'test/other.test.ts'),
    ],
  });
  assert.equal(
    compiled.status,
    'delegation-compiled',
    compiled.status === 'authority-invalid'
      ? JSON.stringify(compiled.issues)
      : compiled.status === 'delegation-compiled' ? undefined : compiled.message,
  );
  if (compiled.status !== 'delegation-compiled') throw new Error('Fixture did not compile.');
  return compiled.contract;
}

function factsFixture(
  contract: TaskContract,
  targetDefinitionId: string,
  otherDefinitionId: string,
): FactBundle {
  const targetDefinition = findDefinition(contract, 'target-check');
  const otherDefinition = findDefinition(contract, 'other-check');
  const changedFiles: FactBundle['changedFiles'] = [
    changed('file:target-source', 'src/target.ts'),
    changed('file:target-test', 'test/target.test.ts'),
    changed('file:unrelated', 'src/unrelated.ts'),
  ];
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1',
    factCollectionId: digest('collection'), bundleFingerprint: digest('bundle'),
    effectiveContractId: contract.effectiveContractId, attemptId: 'attempt:1',
    collectedAt: '2026-08-17T00:00:00.000Z',
    baseline: worktree('baseline'), preCheck: worktree('pre-check'), current: worktree('current'),
    preCheckExecutionInputs: [targetDefinition, otherDefinition].map(executionInputSnapshot),
    currentExecutionInputs: [targetDefinition, otherDefinition].map(executionInputSnapshot),
    baselineVerification: {
      fingerprint: digest('baseline-verification'), capturedAt: '2026-08-17T00:00:00.000Z',
      preCheck: worktree('baseline'), postCheck: worktree('baseline'),
      preCheckExecutionInputs: [targetDefinition, otherDefinition].map(executionInputSnapshot),
      postCheckExecutionInputs: [targetDefinition, otherDefinition].map(executionInputSnapshot),
      checkInducedChanges: [],
      checks: [targetDefinitionId, otherDefinitionId].map((definitionId) => ({
        definitionId, mode: 'unknown' as const, observation: null,
      })),
    },
    changeFingerprint: digest('change'),
    changedFiles,
    checkInducedChanges: [changedFiles[1]],
    checks: [checkFact(targetDefinition), checkFact(otherDefinition)],
    checkComparisons: [targetDefinitionId, otherDefinitionId].map((definitionId) => ({
      definitionId, relation: 'baseline-unknown' as const,
    })),
    verifierMutations: [
      mutation(targetDefinition, 'file:target-test', 'test/target.test.ts'),
      mutation(otherDefinition, 'file:unrelated', 'src/unrelated.ts'),
    ],
    environment: {
      platform: 'linux', architecture: 'x64', cwdFingerprint: digest('cwd'),
      executables: [], toolchains: [], lockfiles: [], environmentVariableNames: [],
    },
    patch: { path: '.stetra/tasks/task/patch.diff', digest: digest('patch'), byteLength: 64 },
    provenance: { collector: 'stetra-cli', cliVersion: '0.0.1', coreVersion: '0.0.1' },
  };
}

function evidence(key: string, path: string, text: string) {
  return { key, path, startLine: 1, endLine: 1, text, digest: sha256(text) };
}

function falsification(label: string) {
  return {
    failureHypothesis: `The ${label} implementation may be wrong.`,
    scenario: `Exercise the ${label} boundary.`,
    supportingObservation: `The ${label} boundary holds.`,
    contradictingObservation: `The ${label} boundary fails.`,
  };
}

function check(key: string, path: string) {
  return {
    key,
    rationale: `Observe ${key}.`,
    execution: {
      preparation: [],
      assertion: { argv: ['node', '--test', path] },
    },
    executionInputs: [],
    baseline: { mode: 'unknown' as const },
    verifierSelectors: [{ kind: 'file' as const, path, role: 'acceptance-surface' as const }],
  };
}

function findDefinition(contract: TaskContract, key: string): VerificationDefinition {
  if (contract.verificationPlan.mode !== 'checks') throw new Error('Expected checks.');
  return contract.verificationPlan.definitions.find((item) => item.key === key)!;
}

function changed(id: string, path: string): FactBundle['changedFiles'][number] {
  return { id, path, operation: 'modified', representation: 'text' };
}

function checkFact(definition: VerificationDefinition): FactBundle['checks'][number] {
  return {
    verifierId: definition.verifierId,
    definitionId: definition.definitionId,
    assertionArgv: definition.execution.assertion.argv,
    definitionFingerprint: digest(`definition-${definition.key}`),
    attempts: [{
      attempt: 1, startedAt: '2026-08-17T00:00:00.000Z', durationMs: 10,
      timeoutMs: 1_000, status: 'passed', termination: { kind: 'exit', exitCode: 0 },
      observedPhase: 'assertion',
      outcomeFingerprint: digest(`outcome-${definition.key}`),
      stdout: stream(`stdout-${definition.key}`), stderr: stream(`stderr-${definition.key}`),
      steps: [{
        stepId: definition.execution.assertion.stepId,
        role: 'assertion',
        argv: definition.execution.assertion.argv,
        startedAt: '2026-08-17T00:00:00.000Z',
        durationMs: 10,
        timeoutMs: 1_000,
        status: 'passed',
        termination: { kind: 'exit', exitCode: 0 },
        outcomeFingerprint: digest(`step-${definition.key}`),
        stdout: stream(`stdout-${definition.key}`),
        stderr: stream(`stderr-${definition.key}`),
      }],
      executionInputs: {
        beforePreparation: executionInputSnapshot(definition),
        readyForAssertion: executionInputSnapshot(definition),
        afterAssertion: executionInputSnapshot(definition),
      },
    }],
  };
}

function executionInputSnapshot(definition: VerificationDefinition) {
  return {
    definitionId: definition.definitionId,
    capturedAt: '2026-08-17T00:00:00.000Z',
    inputs: [],
    fingerprint: digest(`inputs-${definition.key}`),
  };
}

function mutation(
  definition: VerificationDefinition,
  changedFileId: string,
  changedPath: string,
): FactBundle['verifierMutations'][number] {
  return {
    verifierId: definition.verifierId,
    definitionId: definition.definitionId,
    selector: definition.verifierRefs[0],
    changedFileId,
    changedPath,
    matchedBy: 'current-path',
  };
}

function worktree(label: string) {
  return {
    head: null, fingerprint: digest(label), entryCount: 3,
    capturedAt: '2026-08-17T00:00:00.000Z',
  };
}

function stream(label: string) {
  return { digest: digest(label), byteLength: 0, persistedBytes: 0, truncated: false };
}

function digest(label: string): string {
  return stableFingerprint(label);
}
