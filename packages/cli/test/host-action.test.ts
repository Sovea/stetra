import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactBundle } from '@sovea/stetra-core';

import type { AuthoringPacket } from '../src/workflow/authoring.ts';
import {
  collectedHostAction,
  compileProblemHostAction,
  diagnosisHostAction,
  handoffHostAction,
  preparedHostAction,
  resolutionHostAction,
  staleFactsHostAction,
} from '../src/workflow/host-action.ts';

test('host actions route the initial lifecycle with executable task argv', () => {
  assert.deepEqual(preparedHostAction('task-id'), {
    kind: 'implement-and-collect', reference: 'delivery',
    command: { argv: ['stetra', 'change', 'collect', '.', '--task', 'task-id', '--json'] },
  });
  assert.equal(diagnosisHostAction('repair-implementation', 'task-id').kind, 'implement-and-collect');
  assert.equal(diagnosisHostAction('challenge', 'task-id', packet('challenge')).kind, 'perform-independent-challenge');
  assert.equal(diagnosisHostAction(
    'revise-verification', 'task-id', packet('verification-revision'),
  ).kind, 'revise-verification');
  assert.equal(diagnosisHostAction('handoff', 'task-id', packet('handoff')).kind, 'author-handoff');
  const resolution = diagnosisHostAction('ask-human', 'task-id', packet('resolution'));
  assert.equal(resolution.kind, 'resolve-evidence-decision');
  assert.deepEqual(resolution.command?.argv.slice(0, 4), ['stetra', 'change', 'resolve', '.']);
  assert.equal(staleFactsHostAction('task-id').kind, 'recollect-stale-facts');
  assert.equal(handoffHostAction('needs-attention', 'task-id', packet('decision')).kind, 'review-and-decide');
  assert.equal(resolutionHostAction('task-id', packet('resolution')).authoringPacket?.inputKind, 'resolution');
});

test('collection routes timeout, diagnosis, required challenge, and ordinary handoff from explicit inputs', () => {
  const passed = factFixture('passed');
  const common = {
    facts: passed,
    taskId: 'task-id',
    diagnosisPacket: packet('diagnosis'),
    challengePacket: packet('challenge'),
    handoffPacket: packet('handoff'),
  };
  assert.equal(collectedHostAction({
    ...common, requiredChallengeObligationIds: [],
  }).kind, 'author-handoff');
  assert.equal(collectedHostAction({
    ...common, requiredChallengeObligationIds: ['obligation:test'],
  }).kind, 'perform-independent-challenge');

  const failed = factFixture('failed');
  assert.equal(collectedHostAction({
    ...common, facts: failed, requiredChallengeObligationIds: [],
  }).kind, 'diagnose-collected-evidence');

  const timedOut = factFixture('unavailable');
  timedOut.checks[0].attempts[0].timedOut = true;
  const retry = collectedHostAction({
    ...common, facts: timedOut, requiredChallengeObligationIds: [],
  });
  assert.equal(retry.kind, 'retry-timed-out-check');
  assert.match(retry.command!.argv.join(' '), /integer-greater-than-1000/);
});

test('compile problems preserve Human choice, verification, and protocol distinctions', () => {
  assert.equal(compileProblemHostAction('semantic-decision-required').kind, 'resolve-human-choice');
  assert.equal(compileProblemHostAction('verification-required').kind, 'configure-verification');
  assert.equal(compileProblemHostAction('authority-invalid').kind, 'correct-protocol-input');
});

function factFixture(status: 'passed' | 'failed' | 'unavailable'): FactBundle {
  const check = {
    verifierId: 'verifier:test', definitionId: digest('f'), argv: ['test'],
    definitionFingerprint: digest('d'),
    attempts: [{
      attempt: 1, startedAt: '2026-08-10T00:00:00.000Z', durationMs: 3,
      timeoutMs: 1000, status,
      exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
      timedOut: false, outputDigest: digest('o'), stdout: stream('2'), stderr: stream('3'),
    }],
  };
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1', factCollectionId: digest('c'),
    bundleFingerprint: digest('b'), effectiveContractId: digest('e'), attemptId: 'attempt:1',
    collectedAt: '2026-08-10T00:00:00.000Z', baseline: summary('a'),
    preCheck: summary('b'), current: summary('c'),
    baselineVerification: {
      fingerprint: digest('v'), capturedAt: '2026-08-10T00:00:00.000Z',
      preCheck: summary('a'), postCheck: summary('a'), checkInducedChanges: [],
      checks: [{ definitionId: digest('f'), mode: 'unknown', observation: null }],
    },
    changeFingerprint: digest('g'), changedFiles: [], checkInducedChanges: [], checks: [check],
    checkComparisons: [{ definitionId: digest('f'), relation: 'baseline-unknown' }],
    verifierMutations: [],
    environment: {
      platform: 'linux', architecture: 'x64', cwdFingerprint: digest('4'),
      executables: [], toolchains: [], lockfiles: [], environmentVariableNames: [],
    },
    provenance: { collector: 'stetra-cli', cliVersion: '1', coreVersion: '1' },
  };
}

function packet(inputKind: AuthoringPacket['inputKind']): AuthoringPacket {
  return {
    inputKind,
    bindsTo: {
      taskId: 'task-id', revision: 1, effectiveContractId: digest('e'),
      attemptId: 'attempt:1',
    },
    draft: {},
    referenceCatalog: {
      conditions: [], obligations: [], checks: [], changedFiles: [], challenges: [], attention: [],
    },
    outstandingObligations: [],
  };
}

function digest(character: string) {
  return `sha256:${character.slice(0, 1).repeat(64)}`;
}

function summary(character: string) {
  return {
    head: null, fingerprint: digest(character), entryCount: 0,
    capturedAt: '2026-08-10T00:00:00.000Z',
  };
}

function stream(character: string) {
  return { digest: digest(character), byteLength: 0, persistedBytes: 0, truncated: false };
}
