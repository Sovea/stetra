import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AssurancePlan,
  CheckStatus,
  FactBundle,
} from '@sovea/stetra-core';

import {
  collectedHostAction,
  compileProblemHostAction,
  finalizedHostAction,
  preparedHostAction,
  staleFactsHostAction,
  unavailableVerificationHostAction,
} from '../src/workflow/host-action.ts';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ROUTINE = { profile: 'routine', requirements: [] } satisfies AssurancePlan;
const CRITICAL = { profile: 'critical', requirements: [] } satisfies AssurancePlan;

test('Host projection selects routine or assurance guidance from the compiled plan', () => {
  const routine = preparedHostAction(ROUTINE, RUN_ID);
  const critical = preparedHostAction(CRITICAL, RUN_ID);

  assert.equal(routine.kind, 'implement-and-collect');
  assert.equal(routine.reference, 'routine');
  assert.deepEqual(commandArgv(routine), [
    'stetra', 'change', 'collect', '.', '--run', RUN_ID, '--json',
  ]);
  assert.equal(critical.kind, 'implement-and-collect');
  assert.equal(critical.reference, 'assurance');
});

test('Host projection exposes only the recovery action justified by current facts', () => {
  const passed = collectedHostAction(facts('passed'), ROUTINE, RUN_ID);
  assert.equal(passed.kind, 'author-handoff');
  assert.equal(passed.reference, 'routine');

  const timedOut = collectedHostAction(facts('unavailable', true, 25), ROUTINE, RUN_ID);
  assert.equal(timedOut.kind, 'retry-timeout');
  assert.equal(timedOut.reference, 'recovery');
  assert.deepEqual(commandArgv(timedOut).slice(-3), [
    '--retry-check', 'check=<integer-greater-than-25>', '--json',
  ]);

  const unavailable = collectedHostAction(facts('unavailable'), ROUTINE, RUN_ID);
  assert.equal(unavailable.kind, 'restore-and-recollect');
  assert.equal(unavailable.reference, 'recovery');

  const failed = collectedHostAction(facts('failed'), ROUTINE, RUN_ID);
  assert.equal(failed.kind, 'repair-and-recollect');
  assert.equal(failed.reference, 'recovery');
});

test('Host projection keeps non-runnable and terminal authority boundaries explicit', () => {
  assert.equal(
    compileProblemHostAction('semantic-decision-required').kind,
    'resolve-semantic-decision',
  );
  assert.equal(
    compileProblemHostAction('verification-required').kind,
    'configure-verification',
  );
  assert.equal(compileProblemHostAction('authority-invalid').kind, 'correct-authority');
  assert.equal(unavailableVerificationHostAction().reference, 'recovery');
  assert.equal(staleFactsHostAction(RUN_ID).kind, 'recollect-stale');
  assert.equal(finalizedHostAction('handoff-ready', RUN_ID).reference, null);
  assert.equal(finalizedHostAction('needs-attention', RUN_ID).kind, 'inspect-attention');
  assert.equal(finalizedHostAction('rejected', RUN_ID).kind, 'restart-rejected');
});

test('Host projection contains protocol actions without authored explanatory prose', () => {
  const action = finalizedHostAction('handoff-ready', RUN_ID);

  assert.equal(action.kind, 'review-for-adoption');
  assert.equal(action.reference, null);
  assert.equal(Object.hasOwn(action, 'reason'), false);
});

function facts(
  status: CheckStatus,
  timedOut = false,
  timeoutMs = 1_000,
): FactBundle {
  const stream = {
    digest: 'sha256:stream',
    byteLength: 0,
    persistedBytes: 0,
    truncated: false,
  };
  return {
    checks: [{
      id: 'check',
      argv: ['check'],
      definitionFingerprint: 'sha256:definition',
      attempts: [{
        attempt: 1,
        timeoutMs,
        status,
        exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
        timedOut,
        outputDigest: 'sha256:output',
        stdout: stream,
        stderr: stream,
      }],
    }],
  } as FactBundle;
}

function commandArgv(
  value: ReturnType<typeof collectedHostAction> | ReturnType<typeof preparedHostAction>,
): string[] {
  if (!('command' in value)) assert.fail('expected a command-bearing Host action');
  return value.command.argv;
}
