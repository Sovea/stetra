import assert from 'node:assert/strict';
import test from 'node:test';

import { HostChallengeLifecycle } from '../src/host/challenge-lifecycle.ts';
import type { ChallengeDocument } from '../src/schemas/delegation.ts';
import type { ChallengeExecutionRequest } from '../src/workflow/host-action.ts';

test('Host Challenge lifecycle binds start, stop, exact output, and single consumption', async () => {
  const lifecycle = new HostChallengeLifecycle('codex');
  const request = requestFixture('1');
  const challenge = challengeFixture();
  lifecycle.observeStart({
    request,
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    mutationPolicy: 'host-read-only',
  });

  const stopped = lifecycle.observeStop({
    requestId: request.requestId,
    agentType: 'stetra-challenger',
    challengerContextId: 'context:challenger',
    output: JSON.stringify(challenge),
  });
  assert.equal(stopped.status, 'completed');
  if (stopped.status !== 'completed') return;
  assert.equal(stopped.submission.hostReceipt.lifecycle, 'start-and-stop-observed');
  assert.equal(stopped.submission.hostReceipt.mutationPolicy, 'host-read-only');
  assert.deepEqual(stopped.submission.challenge, challenge);

  assert.equal(await lifecycle.verifyChallengeRun({
    request: requestFixture('2'),
    receipt: stopped.submission.hostReceipt,
    challenge,
  }), false);
  const alteredPacketRequest = structuredClone(request);
  alteredPacketRequest.bindsTo.challengeExecutionPacketFingerprint = digest('b');
  assert.equal(await lifecycle.verifyChallengeRun({
    request: alteredPacketRequest,
    receipt: stopped.submission.hostReceipt,
    challenge,
  }), false);
  assert.equal(await lifecycle.verifyChallengeRun({
    request,
    receipt: stopped.submission.hostReceipt,
    challenge,
  }), true);
  assert.equal(await lifecycle.verifyChallengeRun({
    request,
    receipt: stopped.submission.hostReceipt,
    challenge,
  }), false);
});

test('Host Challenge lifecycle allows one structured-output repair and never invents a receipt', () => {
  const lifecycle = new HostChallengeLifecycle('claude');
  const request = requestFixture('3');
  lifecycle.observeStart({
    request,
    agentType: 'stetra-challenger',
    parentContextId: 'context:implementer',
    challengerContextId: 'context:challenger',
    mutationPolicy: 'tool-restricted',
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
    output: challengeFixture(),
  }), /exhausted its output repair budget/);
});

test('Host Challenge lifecycle rejects reused requests and same-context claims', () => {
  const lifecycle = new HostChallengeLifecycle('evaluation-runner');
  const request = requestFixture('4');
  assert.throws(() => lifecycle.observeStart({
    request,
    agentType: 'stetra-challenger',
    parentContextId: 'context:same',
    challengerContextId: 'context:same',
    mutationPolicy: 'host-read-only',
  }), /context distinct/);
  lifecycle.observeStart({
    request,
    agentType: 'stetra-challenger',
    parentContextId: 'context:parent',
    challengerContextId: 'context:child',
    mutationPolicy: 'host-read-only',
  });
  assert.throws(() => lifecycle.observeStart({
    request,
    agentType: 'stetra-challenger',
    parentContextId: 'context:parent',
    challengerContextId: 'context:other-child',
    mutationPolicy: 'host-read-only',
  }), /already started/);
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
      challengeExecutionPacketFingerprint: digest('a'),
    },
    contextPolicy: 'fresh-required',
    mutationPolicy: 'forbidden',
    parallelism: 'single',
    outputRepairBudget: 1,
    expectedOutput: {
      serialization: 'json',
      schema: 'challenge-document',
      source: 'challengeExecutionPacket.draft',
    },
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
    outcome: 'supported',
    conclusion: 'The current bounded evidence supports the obligation.',
  };
}

function digest(character: string): string {
  return `sha256:${character.slice(0, 1).repeat(64)}`;
}
