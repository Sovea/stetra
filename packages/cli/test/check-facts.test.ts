import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { VerificationDefinition } from '@sovea/stetra-core';

import {
  MAX_CHECK_LOG_BYTES,
  runFrozenChecks,
} from '../src/facts/checks.ts';

test('check facts preserve stdout, stderr, exact exit termination, and an outcome fingerprint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-facts-'));
  try {
    const check = await run(root, [
      process.execPath,
      '-e',
      "process.stdout.write('out\\n');process.stderr.write('err\\n')",
    ]);
    const attempt = check.attempts[0];
    assert.equal(attempt.status, 'passed');
    assert.deepEqual(attempt.termination, { kind: 'exit', exitCode: 0 });
    assert.match(attempt.outcomeFingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(readFileSync(join(root, attempt.stdout.logPath!), 'utf8'), 'out\n');
    assert.equal(readFileSync(join(root, attempt.stderr.logPath!), 'utf8'), 'err\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check facts distinguish outputless failure, timeout, platform termination, and spawn failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-termination-'));
  try {
    const failed = await run(root, [process.execPath, '-e', 'process.exit(7)']);
    assert.equal(failed.attempts[0].status, 'failed');
    assert.deepEqual(failed.attempts[0].termination, { kind: 'exit', exitCode: 7 });
    assert.equal(failed.attempts[0].stdout.byteLength, 0);
    assert.equal(failed.attempts[0].stderr.byteLength, 0);

    const timedOut = await run(
      root,
      [process.execPath, '-e', 'setTimeout(() => {}, 10_000)'],
      50,
      'timeout',
    );
    assert.equal(timedOut.attempts[0].status, 'unavailable');
    assert.equal(timedOut.attempts[0].termination.kind, 'timeout');

    const signaled = await run(
      root,
      [process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"],
      1_000,
      'signal',
    );
    assert.deepEqual(
      signaled.attempts[0].termination,
      process.platform === 'win32'
        ? { kind: 'exit', exitCode: 1 }
        : { kind: 'signal', signal: 'SIGTERM' },
    );

    const unavailable = await run(root, ['stetra-command-that-does-not-exist'], 1_000, 'spawn');
    assert.equal(unavailable.attempts[0].termination.kind, 'spawn-error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounded logs keep complete-stream digests while persisting only the byte limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-bounded-'));
  try {
    const observedBytes = MAX_CHECK_LOG_BYTES + 257;
    const check = await run(root, [
      process.execPath,
      '-e',
      `process.stdout.write(Buffer.alloc(${observedBytes}, 120))`,
    ]);
    const stdout = check.attempts[0].stdout;
    assert.equal(stdout.byteLength, observedBytes);
    assert.equal(stdout.persistedBytes, MAX_CHECK_LOG_BYTES);
    assert.equal(stdout.truncated, true);
    assert.equal(
      stdout.digest,
      `sha256:${createHash('sha256').update(Buffer.alloc(observedBytes, 120)).digest('hex')}`,
    );
    assert.equal(readFileSync(join(root, stdout.logPath!)).length, MAX_CHECK_LOG_BYTES);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check facts separate preparation from assertion and capture declared ignored inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-inputs-'));
  try {
    const generated = join(root, 'generated');
    const check = await run(
      root,
      [process.execPath, '-e', "process.exit(require('node:fs').existsSync('generated/input.txt') ? 0 : 1)"],
      1_000,
      'prepared-check',
      [{
        key: 'generate-input',
        argv: [process.execPath, '-e', "require('node:fs').mkdirSync('generated',{recursive:true});require('node:fs').writeFileSync('generated/input.txt','ready')"],
      }],
      [{ kind: 'tree', path: 'generated' }],
    );
    const attempt = check.attempts[0];
    assert.equal(attempt.status, 'passed');
    assert.deepEqual(attempt.steps.map((step) => step.role), ['preparation', 'assertion']);
    assert.equal(attempt.executionInputs.beforePreparation.inputs[0].state, 'missing');
    assert.equal(attempt.executionInputs.readyForAssertion.inputs[0].state, 'present');
    assert.equal(attempt.executionInputs.readyForAssertion.inputs[0].entries[0].path, 'generated/input.txt');
    assert.equal(readFileSync(join(generated, 'input.txt'), 'utf8'), 'ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function run(
  root: string,
  argv: string[],
  timeoutMs = 1_000,
  key = 'check',
  preparation: Array<{ key: string; argv: string[] }> = [],
  executionInputs: VerificationDefinition['executionInputs'] = [],
) {
  const definition: VerificationDefinition = {
    verifierId: `verifier:${key}`,
    definitionId: digest(`${key}:definition`),
    revision: 1,
    key,
    rationale: 'Exercise streaming check facts.',
    execution: {
      preparation: preparation.map((step) => ({
        ...step,
        stepId: digest(`${key}:preparation:${step.key}:${JSON.stringify(step.argv)}`),
      })),
      assertion: {
        stepId: digest(`${key}:assertion`),
        argv,
      },
    },
    executionInputs,
    baseline: { mode: 'unknown' },
    verifierRefs: [],
  };
  const checks = await runFrozenChecks({
    projectRoot: root,
    executions: [{ definition, timeoutMs }],
    outputDirectory: join(root, 'logs', key),
  });
  return checks[0];
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
