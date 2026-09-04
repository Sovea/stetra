import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { VerificationDefinition } from '@sovea/stetra-core';

import {
  MAX_CHECK_LOG_BYTES,
  runFrozenChecks,
} from '../src/facts/checks.ts';

const hangingDescendantFixture = fileURLToPath(
  new URL('./fixtures/hanging-descendant.mjs', import.meta.url),
);
const NON_TIMEOUT_CHECK_BUDGET_MS = 300_000;

test('check facts preserve stdout, stderr, exact exit termination, and an outcome fingerprint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-facts-'));
  try {
    const check = await run(root, [
      process.execPath,
      '-e',
      "process.stdout.write('out\\n');process.stderr.write('err\\n')",
    ], NON_TIMEOUT_CHECK_BUDGET_MS);
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

test('check facts preserve package-manager lifecycle output from a failed script', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-package-manager-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        verify: `${JSON.stringify(process.execPath)} -e "process.stdout.write('script-out\\n');process.stderr.write('script-err\\n');process.exit(2)"`,
      },
    }));
    const check = await run(
      root,
      ['pnpm', 'run', 'verify'],
      NON_TIMEOUT_CHECK_BUDGET_MS,
      'package-manager-output',
    );
    const attempt = check.attempts[0];
    assert.equal(attempt.status, 'failed');
    assert.deepEqual(attempt.termination, { kind: 'exit', exitCode: 2 });
    assert.match(readFileSync(join(root, attempt.stdout.logPath!), 'utf8'), /script-out/);
    assert.match(readFileSync(join(root, attempt.stderr.logPath!), 'utf8'), /script-err/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check facts distinguish outputless failure, timeout, platform termination, and spawn failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-termination-'));
  try {
    const failed = await run(
      root,
      [process.execPath, '-e', 'process.exit(7)'],
      NON_TIMEOUT_CHECK_BUDGET_MS,
    );
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
      NON_TIMEOUT_CHECK_BUDGET_MS,
      'signal',
    );
    assert.deepEqual(
      signaled.attempts[0].termination,
      process.platform === 'win32'
        ? { kind: 'exit', exitCode: 1 }
        : { kind: 'signal', signal: 'SIGTERM' },
    );

    const unavailable = await run(
      root,
      ['stetra-command-that-does-not-exist'],
      NON_TIMEOUT_CHECK_BUDGET_MS,
      'spawn',
    );
    assert.equal(unavailable.attempts[0].termination.kind, 'spawn-error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out check terminates its launcher and descendants that retain output pipes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-descendant-timeout-'));
  const pidPath = join(root, 'descendant.pid');
  try {
    const timedOut = await run(
      root,
      [process.execPath, hangingDescendantFixture, pidPath],
      500,
      'descendant-timeout',
    );
    const attempt = timedOut.attempts[0];
    assert.equal(attempt.status, 'unavailable');
    assert.equal(attempt.termination.kind, 'timeout');

    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    assert.ok(Number.isSafeInteger(descendantPid));
    await waitForProcessExit(descendantPid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a POSIX process group remains terminable after the launcher exits', {
  skip: process.platform === 'win32' ? 'Windows task trees require a live root PID.' : false,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-exited-launcher-'));
  const pidPath = join(root, 'descendant.pid');
  try {
    const timedOut = await run(
      root,
      [process.execPath, hangingDescendantFixture, pidPath, 'launcher-exits'],
      500,
      'exited-launcher',
    );
    assert.equal(timedOut.attempts[0].termination.kind, 'timeout');
    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    await waitForProcessExit(descendantPid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out check forcefully terminates a descendant that ignores graceful termination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-descendant-force-'));
  const pidPath = join(root, 'descendant.pid');
  try {
    const timedOut = await run(
      root,
      [process.execPath, hangingDescendantFixture, pidPath, 'ignore-term'],
      500,
      'descendant-force',
    );
    assert.equal(timedOut.attempts[0].termination.kind, 'timeout');

    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    await waitForProcessExit(descendantPid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a timed-out check forcefully terminates a silent descendant that outlives the launcher', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-silent-descendant-force-'));
  const pidPath = join(root, 'descendant.pid');
  try {
    const timedOut = await run(
      root,
      [process.execPath, hangingDescendantFixture, pidPath, 'ignore-term-no-output'],
      500,
      'silent-descendant-force',
    );
    assert.equal(timedOut.attempts[0].termination.kind, 'timeout');

    const descendantPid = Number(readFileSync(pidPath, 'utf8').trim());
    await waitForProcessExit(descendantPid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POSIX reaping lag after force termination still produces a timeout fact', {
  skip: process.platform === 'win32' ? 'Windows does not expose POSIX process groups.' : false,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-check-reaping-lag-'));
  const originalKill = process.kill;
  t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
    // kill(-pgid, 0) also observes unreaped zombies. Simulate that kernel-visible
    // state outliving successful group-directed termination, as it can in a PID
    // namespace whose init process has not reaped the group yet.
    if (pid < 0 && signal === 0) return true;
    return originalKill(pid, signal);
  });
  try {
    const timedOut = await run(
      root,
      [process.execPath, '-e', 'setInterval(() => {}, 10_000)'],
      50,
      'reaping-lag',
    );
    assert.equal(timedOut.attempts[0].status, 'unavailable');
    assert.equal(timedOut.attempts[0].termination.kind, 'timeout');
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
    ], NON_TIMEOUT_CHECK_BUDGET_MS);
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
      NON_TIMEOUT_CHECK_BUDGET_MS,
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
  timeoutMs: number,
  key = 'check',
  preparation: Array<{ key: string; argv: string[] }> = [],
  executionInputs: VerificationDefinition['executionInputs'] = [],
) {
  const definition: VerificationDefinition = {
    verifierId: `verifier:${key}`,
    definitionId: digest(`${key}:definition`),
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

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`Descendant process ${pid} remained alive.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
