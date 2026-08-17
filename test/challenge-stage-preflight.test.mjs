import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertChallengeStagePreflight,
} from '../evaluation/paired-agent/challenge-stage-preflight.mjs';

test('Challenge stage preflight accepts exact prepare-before-patch facts', () => {
  const record = fixture();
  assert.deepEqual(assertChallengeStagePreflight(record), record);
});

test('Challenge stage preflight rejects a candidate change present before prepare', () => {
  const record = fixture();
  record.beforePrepare.candidateChangePresent = true;
  assert.throws(
    () => assertChallengeStagePreflight(record),
    /beforePrepare\.candidateChangePresent/,
  );
});

test('Challenge stage preflight rejects missing or different collected evidence', () => {
  const noPatch = fixture();
  noPatch.afterCollect.patch.present = false;
  assert.throws(() => assertChallengeStagePreflight(noPatch), /afterCollect\.patch\.present/);

  const changedPath = fixture();
  changedPath.afterCollect.changedFiles.actual = ['lib/utils.js'];
  assert.throws(() => assertChallengeStagePreflight(changedPath), /afterCollect changed files/);

  const changedRelation = fixture();
  changedRelation.afterCollect.checkRelations[0].actual = 'passed-before-passed-now';
  assert.throws(() => assertChallengeStagePreflight(changedRelation), /checkRelations\[0\] relation/);
});

function fixture() {
  return {
    protocol: 'cognitive-adoption-challenge-stage-preflight',
    schemaVersion: '1',
    taskId: 'express-query-boundary',
    repositoryCommit: commit('a'),
    stetra: {
      commit: commit('b'),
      coreArchiveDigest: digest('c'),
      cliArchiveDigest: digest('d'),
      hostAdapterDigest: digest('e'),
    },
    beforePrepare: {
      registeredWorktreeFingerprint: digest('f'),
      observedWorktreeFingerprint: digest('f'),
      candidateChangePresent: false,
    },
    afterCollect: {
      factCollectionId: digest('1'),
      patch: {
        required: true,
        present: true,
        registeredDigest: digest('2'),
        observedDigest: digest('2'),
      },
      changedFiles: {
        expected: ['lib/utils.js', 'test/req.query.js'],
        actual: ['test/req.query.js', 'lib/utils.js'],
      },
      checkRelations: [{
        checkKey: 'visible-regression',
        expected: 'failed-before-passed-now',
        actual: 'failed-before-passed-now',
      }],
    },
    status: 'passed',
    deviations: [],
  };
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function commit(character) {
  return character.repeat(40);
}
