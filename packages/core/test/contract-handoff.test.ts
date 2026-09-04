import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type FactBundle,
  type HumanDecision,
  type TaskContract,
  type VerificationDefinition,
} from '../src/index.ts';
import { sha256, stableFingerprint } from '../src/shared/protocol.ts';

const envelope = {
  protocol: 'cognitive-adoption' as const,
  schemaVersion: '2' as const,
};
const executionPolicy = {
  checkTimeoutMs: 1_000,
  maxTimeoutMs: 5_000,
  maxTimeoutRetriesPerCheck: 1,
};

test('routine compilation is deterministic and keeps Human authority separate', () => {
  const input = {
    ...envelope,
    humanEvent: { content: 'Add a health endpoint.' },
    interpretation: {
      desiredOutcome: 'Expose a health endpoint.',
      constraints: ['Keep the existing server API.'],
      nonGoals: [],
    },
    assurance: { mode: 'routine' as const },
    verification: { mode: 'no-command' as const, rationale: 'Documentation-only fixture.' },
    executionPolicy,
  };
  const first = compileDelegation(input);
  const second = compileDelegation(input);
  assert.equal(first.status, 'delegation-compiled');
  assert.equal(second.status, 'delegation-compiled');
  if (first.status !== 'delegation-compiled' || second.status !== 'delegation-compiled') return;
  assert.deepEqual(first.contract, second.contract);
  assert.equal(first.contract.humanEvents[0].content, 'Add a health endpoint.');
  assert.equal(first.contract.humanEvents[0].kind, 'task');
  assert.equal(first.contract.humanEvents[0].capture, 'unattested-input');
  assert.equal(first.contract.interpretation.authority, 'agent-judgment');
  assert.equal(first.contract.assurance.mode, 'routine');
  assert.equal(first.contract.verificationPlan.mode, 'no-command');
  assert.notEqual(first.contract.semanticContractId, first.contract.verificationPlanId);
});

test('compilation rejects unknown fields, unsafe checks, and unresolved concern evidence', () => {
  const compiled = compileDelegation({
    ...envelope,
    humanEvent: { content: 'Change authentication.' },
    interpretation: { desiredOutcome: 'Change authentication.', constraints: [], nonGoals: [] },
    assurance: {
      mode: 'consequential',
      concerns: [{
        key: 'rollback',
        statement: 'Sessions can be rolled back.',
        adoptionImpact: 'A failure could lock out users.',
        evidenceRequirements: [{ kind: 'check', checkKey: 'missing' }],
      }],
    },
    verification: {
      mode: 'checks',
      checks: [{ key: 'verify', argv: ['node', '-e', 'process.exit(0)'], executionInputs: [{ kind: 'file', path: '../escape' }] }],
    },
    executionPolicy,
    unsupported: true,
  } as never);
  assert.equal(compiled.status, 'authority-invalid');
  if (compiled.status !== 'authority-invalid') return;
  assert.ok(compiled.issues.some((issue) => issue.code === 'field-unsupported'));
  assert.ok(compiled.issues.some((issue) => issue.code === 'selector-invalid'));
  assert.ok(compiled.issues.some((issue) => issue.code === 'concern-check-unknown'));
});

test('consequential compilation resolves readable check keys into frozen evidence identities', () => {
  const contract = checkedContract();
  assert.equal(contract.verificationPlan.mode, 'checks');
  assert.equal(contract.assurance.mode, 'consequential');
  if (contract.verificationPlan.mode !== 'checks' || contract.assurance.mode !== 'consequential') return;
  const definition = contract.verificationPlan.definitions[0];
  const concern = contract.assurance.concerns[0];
  assert.equal(definition.key, 'unit');
  assert.match(definition.definitionId, /^sha256:/);
  assert.deepEqual(concern.evidenceRequirements, [{ kind: 'check', verifierId: definition.verifierId }]);
});

test('a clean routine Handoff is ready while adoption remains pending until a Human decision', () => {
  const contract = routineContract();
  const facts = factBundle(contract);
  const handoff = handoffFor(contract, facts, { recommendation: 'accept' });
  const pending = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  });
  assert.equal(pending.status, 'handoff-ready');
  assert.deepEqual(pending.attention, []);
  assert.deepEqual(pending.adoption, { authority: 'human', status: 'pending' });

  const decision = decisionFor(contract, facts, handoff, 'accepted', []);
  const accepted = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
    decision,
  });
  assert.deepEqual(accepted.adoption, {
    authority: 'human',
    status: 'accepted',
    decisionId: decision.decisionId,
  });
});

test('stale facts stop semantic Handoff validation', () => {
  const contract = routineContract();
  const facts = factBundle(contract);
  const malformed = { ...handoffFor(contract, facts), actualChange: { behavior: '', mechanism: [] } } as CognitiveHandoff;
  const evaluation = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: sha256('new worktree'),
    handoff: malformed,
  });
  assert.equal(evaluation.status, 'facts-stale');
  assert.deepEqual(evaluation.attention, []);
});

test('blocking Check evidence caps Agent advice and Human acceptance requires Attention acknowledgement', () => {
  const contract = checkedContract();
  const facts = factBundle(contract, 'failed');
  const accept = handoffFor(contract, facts, {
    recommendation: 'accept',
    concernStatus: 'contradicted',
  });
  assert.throws(() => evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff: accept,
  }), /cannot exceed current blocking evidence/);

  const deferred = handoffFor(contract, facts, {
    recommendation: 'defer',
    concernStatus: 'contradicted',
  });
  const pending = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff: deferred,
  });
  assert.equal(pending.status, 'needs-attention');
  assert.deepEqual(
    pending.attention.map((item) => item.code),
    ['concern-evidence-missing', 'concern-not-supported', 'verification-nonpassing'],
  );
  const unacknowledged = decisionFor(contract, facts, deferred, 'accepted', []);
  assert.throws(() => evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff: deferred,
    decision: unacknowledged,
  }), /acknowledge every current Attention/);
  const acknowledged = {
    ...unacknowledged,
    acknowledgedAttentionIds: pending.attention.map((item) => item.id),
  };
  assert.equal(evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff: deferred,
    decision: acknowledged,
  }).adoption.status, 'accepted');
});

test('passing declared Check evidence can support a consequential concern', () => {
  const contract = checkedContract();
  const facts = factBundle(contract, 'passed');
  const handoff = handoffFor(contract, facts, {
    recommendation: 'accept',
    concernStatus: 'supported',
  });
  const evaluation = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  });
  assert.equal(evaluation.status, 'handoff-ready');
  assert.equal(evaluation.concernEvidence[0].complete, true);
});

test('mechanical Attention exposes verifier mutation, check-induced changes, unrepresentable changes, and unknowns', () => {
  const contract = checkedContract();
  assert.equal(contract.verificationPlan.mode, 'checks');
  if (contract.verificationPlan.mode !== 'checks') return;
  const definition = contract.verificationPlan.definitions[0];
  const changed = {
    id: 'file:changed',
    path: 'test.js',
    operation: 'modified' as const,
    representation: 'unrepresentable' as const,
  };
  const facts = factBundle(contract, 'passed', {
    changedFiles: [changed],
    checkInducedChanges: [{ ...changed, id: 'file:induced' }],
    verifierMutations: [{
      verifierId: definition.verifierId,
      definitionId: definition.definitionId,
      selector: definition.verifierRefs[0],
      changedFileId: changed.id,
      changedPath: changed.path,
      matchedBy: 'current-path',
    }],
  });
  const handoff = handoffFor(contract, facts, {
    recommendation: 'accept',
    concernStatus: 'supported',
    residualUnknowns: [{ statement: 'Runtime behavior on Windows remains unobserved.', evidence: [] }],
  });
  const evaluation = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  });
  assert.deepEqual(evaluation.attention.map((item) => item.code), [
    'change-unrepresentable',
    'check-induced-change',
    'residual-unknown',
    'verifier-surface-changed',
  ]);
  assert.ok(evaluation.attention.every((item) => item.blockingRecommendation === false));
});

test('Fact and Handoff identities are enforced', () => {
  const contract = routineContract();
  const facts = factBundle(contract);
  const handoff = handoffFor(contract, facts);
  assert.throws(() => evaluateHandoff({
    ...envelope,
    contract,
    factBundle: { ...facts, changeFingerprint: sha256('tampered') },
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff,
  }), /identity does not match/);
  assert.throws(() => evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    handoff: { ...handoff, handoffFingerprint: sha256('tampered') },
  }), /fingerprint is invalid/);
});

function routineContract(): TaskContract {
  const result = compileDelegation({
    ...envelope,
    humanEvent: { content: 'Update the greeting.' },
    interpretation: { desiredOutcome: 'Return the new greeting.', constraints: [], nonGoals: [] },
    assurance: { mode: 'routine' },
    verification: { mode: 'no-command', rationale: 'No executable check in this unit fixture.' },
    executionPolicy,
  });
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') throw new Error('fixture compilation failed');
  return result.contract;
}

function checkedContract(): TaskContract {
  const result = compileDelegation({
    ...envelope,
    humanEvent: { content: 'Preserve authentication while changing session parsing.' },
    interpretation: {
      desiredOutcome: 'Parse sessions without changing authentication outcomes.',
      constraints: ['Preserve invalid-session rejection.'],
      nonGoals: ['Do not redesign authorization.'],
    },
    assurance: {
      mode: 'consequential',
      concerns: [{
        key: 'auth-outcome',
        statement: 'Valid and invalid sessions retain their outcomes.',
        adoptionImpact: 'A regression changes access control.',
        evidenceRequirements: [{ kind: 'check', checkKey: 'unit' }],
        falsification: { plausibleFailure: 'Invalid sessions are accepted.', scenario: 'Use an expired token.' },
      }],
    },
    verification: {
      mode: 'checks',
      checks: [{
        key: 'unit',
        argv: ['node', '--test'],
        rationale: 'Exercise session outcomes.',
        verifierSelectors: [{ kind: 'file', path: 'test.js', role: 'acceptance-surface' }],
      }],
    },
    executionPolicy,
  });
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') throw new Error('fixture compilation failed');
  return result.contract;
}

function factBundle(
  contract: TaskContract,
  checkStatus: 'passed' | 'failed' = 'passed',
  overrides: Partial<Omit<FactBundle, 'factCollectionId'>> = {},
): FactBundle {
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  const snapshots = definitions.map(snapshotFor);
  const checks = definitions.map((definition) => checkFor(definition, checkStatus));
  const worktree = { head: null, fingerprint: sha256('worktree'), entryCount: 0 };
  const base: Omit<FactBundle, 'factCollectionId'> = {
    ...envelope,
    effectiveContractId: contract.effectiveContractId,
    attemptId: 'attempt:1',
    baseline: worktree,
    preCheck: worktree,
    current: worktree,
    preCheckExecutionInputs: snapshots,
    currentExecutionInputs: snapshots,
    changeFingerprint: sha256('change'),
    changedFiles: [],
    checkInducedChanges: [],
    checks,
    verifierMutations: [],
    environment: {
      platform: 'test',
      architecture: 'test',
      executables: definitions.map((definition) => ({
        command: definition.execution.assertion.argv[0],
        resolvedPath: '/test/bin/node',
      })),
    },
    provenance: { collector: 'stetra-cli', cliVersion: '0.0.1', coreVersion: '0.0.1' },
    ...overrides,
  };
  return { ...base, factCollectionId: stableFingerprint(base) };
}

function snapshotFor(definition: VerificationDefinition) {
  const projection = { definitionId: definition.definitionId, inputs: [] };
  return { ...projection, fingerprint: stableFingerprint(projection) };
}

function checkFor(definition: VerificationDefinition, status: 'passed' | 'failed') {
  const stream = {
    digest: sha256(''),
    byteLength: 0,
    persistedBytes: 0,
    truncated: false,
  };
  const termination = { kind: 'exit' as const, exitCode: status === 'passed' ? 0 : 1 };
  const step = {
    stepId: definition.execution.assertion.stepId,
    role: 'assertion' as const,
    argv: definition.execution.assertion.argv,
    durationMs: 1,
    timeoutMs: 1_000,
    status,
    termination,
    outcomeFingerprint: sha256(`step:${status}`),
    stdout: stream,
    stderr: stream,
  };
  const snapshot = snapshotFor(definition);
  return {
    verifierId: definition.verifierId,
    definitionId: definition.definitionId,
    assertionArgv: definition.execution.assertion.argv,
    definitionFingerprint: stableFingerprint(definition),
    attempts: [{
      attempt: 1,
      durationMs: 1,
      timeoutMs: 1_000,
      status,
      observedPhase: 'assertion' as const,
      termination,
      outcomeFingerprint: sha256(`attempt:${status}`),
      stdout: stream,
      stderr: stream,
      steps: [step],
      executionInputs: {
        beforePreparation: snapshot,
        readyForAssertion: snapshot,
        afterAssertion: snapshot,
      },
    }],
  };
}

function handoffFor(
  contract: TaskContract,
  facts: FactBundle,
  options: {
    recommendation?: 'accept' | 'defer';
    concernStatus?: 'supported' | 'contradicted';
    residualUnknowns?: CognitiveHandoff['residualUnknowns'];
  } = {},
): CognitiveHandoff {
  const concernFindings = contract.assurance.mode === 'consequential'
    ? contract.assurance.concerns.map((concern) => ({
        concernId: concern.id,
        status: options.concernStatus ?? 'supported',
        summary: options.concernStatus === 'contradicted' ? 'The Check failed.' : 'The Check passed.',
        evidence: facts.checks.length
          ? [{ kind: 'check' as const, id: facts.checks[0].definitionId }] : [],
        gaps: options.concernStatus === 'contradicted' ? ['Repair is required.'] : [],
      }))
    : [];
  const projection = {
    ...envelope,
    handoffId: 'handoff:1',
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    actualChange: {
      behavior: 'The requested behavior is implemented.',
      mechanism: ['The implementation changes the bounded code path.'],
      preservedInvariants: [],
      failureAndRecovery: [],
      importantEffects: [],
      materialTradeoffs: [],
    },
    concernFindings,
    residualUnknowns: options.residualUnknowns ?? [],
    reviewFocus: [],
    recommendation: {
      action: options.recommendation ?? 'defer',
      rationale: 'The recommendation follows the current evidence.',
      caveats: [],
    },
  };
  return { ...projection, handoffFingerprint: stableFingerprint(projection) };
}

function decisionFor(
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  action: HumanDecision['action'],
  acknowledgedAttentionIds: string[],
): HumanDecision {
  const content = action === 'accepted' ? 'Accept this change.' : 'Do not accept this change.';
  const humanEvent = {
    kind: action === 'correction-requested' ? 'correction' as const : 'decision' as const,
    content,
    capture: 'unattested-input' as const,
  };
  return {
    ...envelope,
    decisionId: 'decision:1',
    humanEvent: {
      id: `human:${sha256(JSON.stringify(humanEvent)).slice('sha256:'.length)}`,
      ...humanEvent,
      contentFingerprint: sha256(content),
    },
    action,
    reason: 'This is my explicit decision.',
    acknowledgedAttentionIds,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    handoffId: handoff.handoffId,
    handoffFingerprint: handoff.handoffFingerprint,
  };
}
