import assert from 'node:assert/strict';
import test from 'node:test';

import { HostChallengeLifecycle } from '../src/host/challenge-lifecycle.ts';
import { stableFingerprint } from '../src/protocol.ts';
import type { ChallengeDocument, ChallengeRoundDocument } from '../src/schemas/delegation.ts';
import type { ChallengeExecutionPacket } from '../src/workflow/challenge-projection.ts';
import type { ChallengeExecutionRequest } from '../src/workflow/host-action.ts';

test('Host Challenge lifecycle binds start, stop, exact output, and single consumption', async () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('1');
  const challenge = challengeFixture();
  const round = roundFixture(challenge);
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });

  const stopped = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: JSON.stringify(round),
  });
  assert.equal(stopped.status, 'completed');
  if (stopped.status !== 'completed') return;
  assert.equal(stopped.receipt.lifecycle, 'start-and-stop-observed');
  assert.equal(stopped.receipt.targetWorktree, 'read-only');
  assert.equal(stopped.receipt.executionWorkspace, 'isolated-writable');
  assert.equal(stopped.receipt.sourceSnapshotFingerprint, digest('w'));
  assert.deepEqual(stopped.round, round);

  assert.equal(await lifecycle.consumeChallengeRun({
    request: requestFixture('2'),
    round,
  }), undefined);
  const alteredPacketRequest = structuredClone(request);
  alteredPacketRequest.bindsTo.challengeExecutionPacketFingerprint = digest('b');
  assert.equal(await lifecycle.consumeChallengeRun({
    request: alteredPacketRequest,
    round,
  }), undefined);
  assert.deepEqual(await lifecycle.consumeChallengeRun({
    request,
    round,
  }), stopped.receipt);
  assert.equal(await lifecycle.consumeChallengeRun({
    request,
    round,
  }), undefined);
});

test('Host Challenge lifecycle allows one structured-output repair and never invents a receipt', () => {
  const lifecycle = new HostChallengeLifecycle('claude');
  const request = requestFixture('3');
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });

  const first = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: 'not json',
  });
  assert.deepEqual(first, {
    status: 'invalid-output',
    requestId: request.requestId,
    mayRetry: true,
    issues: [{ path: '', message: 'Challenger output must be one JSON document without Markdown.' }],
  });
  const second = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: {},
  });
  assert.equal(second.status, 'invalid-output');
  if (second.status !== 'invalid-output') return;
  assert.equal(second.mayRetry, false);
  assert.throws(() => lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(),
  }), /exhausted its output repair budget/);
});

test('Host Challenge lifecycle repairs unavailable nested evidence before issuing a receipt', () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('7');
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });

  const invalid = challengeFixture();
  invalid.supportingEvidence[0].references = [{ kind: 'check', id: digest('d') }];
  const rejected = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(invalid),
  });
  assert.deepEqual(rejected, {
    status: 'invalid-output',
    requestId: request.requestId,
    mayRetry: true,
    issues: [{
      path: 'results.0.supportingEvidence[0].references[0].id',
      message: `references unavailable check identity ${JSON.stringify(digest('d'))}`,
    }],
  });

  invalid.supportingEvidence[0].references = [{ kind: 'check', id: digest('c') }];
  const completed = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(invalid),
  });
  assert.equal(completed.status, 'completed');
});

test('Host Challenge lifecycle requires repair when a supported result retains counter-evidence', () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('5');
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });

  const inconsistent = challengeFixture();
  inconsistent.counterEvidence = [{
    statement: 'The persistent verifier does not cover the declared boundary.',
    references: [{ kind: 'check', id: digest('c') }],
  }];
  const first = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(inconsistent),
  });
  assert.equal(first.status, 'invalid-output');
  if (first.status !== 'invalid-output') return;
  assert.equal(first.mayRetry, true);
  assert.deepEqual(first.issues, [{
    path: 'results.0.counterEvidence',
    message: 'must be preserved and outcome changed to partial, contradicted, or unknown while counter-evidence remains',
  }]);

  inconsistent.outcome = 'partial';
  const repaired = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(inconsistent),
  });
  assert.equal(repaired.status, 'completed');
});

test('Host Challenge lifecycle requires a non-supported outcome for declared coverage gaps', () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('9');
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });
  const incomplete = challengeFixture();
  incomplete.evidenceCoverage = {
    status: 'insufficient',
    rationale: 'The current evidence omits one declared boundary.',
    gaps: ['The alternate failure path remains unobserved.'],
  };
  const first = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(incomplete),
  });
  assert.equal(first.status, 'invalid-output');
  if (first.status !== 'invalid-output') return;
  assert.deepEqual(first.issues, [{
    path: 'results.0.evidenceCoverage.status',
    message: 'must be sufficient before the Challenge outcome can be supported',
  }]);

  incomplete.outcome = 'partial';
  const repaired = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(incomplete),
  });
  assert.equal(repaired.status, 'completed');
});

test('Host Challenge lifecycle does not let output repair erase authored counter-evidence', () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('6');
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    ...workspaceObservation(),
  });
  const inconsistent = challengeFixture();
  inconsistent.counterEvidence = [{
    statement: 'The persistent verifier omits the declared boundary.',
    references: [{ kind: 'check', id: digest('c') }],
  }];
  const first = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(inconsistent),
  });
  assert.equal(first.status, 'invalid-output');

  inconsistent.counterEvidence = [];
  const erased = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: roundFixture(inconsistent),
  });
  assert.deepEqual(erased, {
    status: 'invalid-output',
    requestId: request.requestId,
    mayRetry: false,
    issues: [{
      path: 'results.0.counterEvidence',
      message: 'must preserve the counter-evidence authored before structural repair',
    }],
  });
});

test('Host Challenge lifecycle rejects reused requests and same-context claims', () => {
  const lifecycle = new HostChallengeLifecycle('evaluation-runner');
  const request = requestFixture('4');
  assert.throws(() => lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:same',
    challengerContextId: 'context:same',
    ...workspaceObservation(),
  }), /context distinct/);
  lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:parent',
    challengerContextId: 'context:child',
    ...workspaceObservation(),
  });
  assert.throws(() => lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:parent',
    challengerContextId: 'context:other-child',
    ...workspaceObservation(),
  }), /already started/);
});

test('Host Challenge lifecycle requires an exact isolated workspace snapshot', () => {
  const lifecycle = new HostChallengeLifecycle('evaluation-runner');
  const request = requestFixture('8');
  assert.throws(() => lifecycle.observeStart({
    request,
    challengeExecutionPacket: packetFixture(),
    agentType: 'stetra-challenger',
    parentContextId: 'context:parent',
    challengerContextId: 'context:child',
    ...workspaceObservation(),
    sourceSnapshotFingerprint: digest('x'),
  }), /does not match the current worktree snapshot/);
});

function requestFixture(character: string): ChallengeExecutionRequest {
  return {
    requestId: digest(character),
    role: 'independent-challenger',
    agentProfile: 'stetra-challenger',
    bindsTo: {
      taskId: 'task:test',
      effectiveContractId: digest('e'),
      attemptId: 'attempt:1',
      factCollectionId: digest('f'),
      worktreeFingerprint: digest('w'),
      challengeExecutionPacketFingerprint: stableFingerprint(packetFixture()),
    },
    contextPolicy: 'fresh-required',
    workspacePolicy: {
      targetWorktree: 'read-only',
      executionWorkspace: 'isolated-writable',
      externalEffects: 'forbidden',
    },
    parallelism: 'single',
    outputRepairBudget: 1,
    expectedOutput: {
      serialization: 'json',
      schema: 'challenge-round-document',
      source: 'challengeExecutionPacket.draft',
    },
  };
}

function packetFixture(): ChallengeExecutionPacket {
  return {
    bindsTo: { worktreeFingerprint: digest('w') },
    cases: [{ draft: { evidence: challengeFixture().evidence } }],
  } as unknown as ChallengeExecutionPacket;
}

function workspaceObservation() {
  return {
    targetWorktree: 'read-only' as const,
    executionWorkspace: 'isolated-writable' as const,
    sourceSnapshotFingerprint: digest('w'),
    externalEffects: 'forbidden' as const,
  };
}

function challengeFixture(): ChallengeDocument {
  return {
    obligationIds: ['obligation:test'],
    falsification: {
      failureHypothesis: 'The bounded implementation may be wrong.',
      scenario: 'Inspect the declared boundary independently.',
      supportingObservation: 'The boundary remains intact.',
      contradictingObservation: 'The boundary is violated.',
    },
    evidence: {
      changedFiles: ['changed-file:test'],
      checks: [digest('c')],
      repositoryEvidence: [],
      humanEvents: ['human:test'],
      patch: true,
    },
    falsificationAttempt: 'Inspected the exact changed path and declared boundary.',
    observedResult: 'The bounded counterexample was not observed.',
    supportingEvidence: [{
      statement: 'The current evidence supports the bounded conclusion.',
      references: [{ kind: 'check', id: digest('c') }],
    }],
    counterEvidence: [],
    evidenceCoverage: {
      status: 'sufficient',
      rationale: 'The selected evidence directly exercises the bounded conclusion.',
      gaps: [],
    },
    outcome: 'supported',
    conclusion: 'The current bounded evidence supports the obligation.',
  };
}

function roundFixture(result: ChallengeDocument = challengeFixture()): ChallengeRoundDocument {
  return { results: [result] };
}

function digest(character: string): string {
  return `sha256:${character.slice(0, 1).repeat(64)}`;
}
