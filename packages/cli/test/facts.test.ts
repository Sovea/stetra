import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CliError } from '../src/errors.ts';
import {
  loadCheckPlan,
  runCheckPlan,
} from '../src/facts/checks.mjs';

test('Execa-backed checks preserve success, failure, timeout, and spawn facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-check-runner-'));
  try {
    const configPath = join(root, 'checks.json');
    writeFileSync(configPath, `${JSON.stringify({
      version: '1.0',
      checks: [
        {
          id: 'success',
          command: [process.execPath, '-e', 'process.stdout.write("ok")'],
          timeoutMs: 2_000,
        },
        {
          id: 'failure',
          command: [process.execPath, '-e', 'process.stderr.write("bad"); process.exit(3)'],
          timeoutMs: 2_000,
        },
        {
          id: 'timeout',
          command: [process.execPath, '-e', 'setTimeout(() => {}, 10_000)'],
          timeoutMs: 50,
        },
        {
          id: 'missing-command',
          command: ['resonant-code-definitely-missing-executable'],
          timeoutMs: 2_000,
        },
        {
          id: 'large-output',
          command: [process.execPath, '-e', 'process.stdout.write("x".repeat(1100000))'],
          timeoutMs: 2_000,
        },
      ],
    }, null, 2)}\n`, 'utf8');
    const plan = loadCheckPlan(configPath, {
      commands: [
        { id: 'success', reason: 'fixture' },
        { id: 'failure', reason: 'fixture' },
        { id: 'timeout', reason: 'fixture' },
        { id: 'missing-command', reason: 'fixture' },
        { id: 'large-output', reason: 'fixture' },
      ],
    });
    const outputDirectory = join(root, 'check-output');
    const results = await runCheckPlan({
      projectRoot: root,
      plan,
      outputDirectory,
    });

    assert.equal(results[0].status, 'passed');
    assert.equal(results[0].exitCode, 0);
    assert.equal(
      readFileSync(join(outputDirectory, 'success.stdout.log'), 'utf8'),
      'ok',
    );
    assert.equal(results[1].status, 'failed');
    assert.equal(results[1].exitCode, 3);
    assert.match(results[1].reason ?? '', /exited with 3/);
    assert.equal(results[2].status, 'failed');
    assert.match(results[2].reason ?? '', /timed out/);
    assert.equal(results[3].status, 'failed');
    assert.notEqual(results[3].exitCode, 0);
    assert.match(results[3].reason ?? '', /could not start|exited with/i);
    assert.equal(results[4].status, 'passed');
    assert.ok('outputTruncated' in results[4]);
    assert.deepEqual(results[4].outputTruncated, {
      stdout: true,
      stderr: false,
    });
    const largeOutputPath = join(outputDirectory, 'large-output.stdout.log');
    assert.ok(statSync(largeOutputPath).size <= 1024 * 1024);
    assert.match(readFileSync(largeOutputPath, 'utf8'), /persisted check output truncated/);

    const spawnFailure = await runCheckPlan({
      projectRoot: join(root, 'missing-working-directory'),
      plan: [plan[0]],
      outputDirectory: join(root, 'spawn-failure-output'),
    });
    assert.equal(spawnFailure[0].status, 'failed');
    assert.equal(spawnFailure[0].exitCode, null);
    assert.match(spawnFailure[0].reason ?? '', /could not start/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Zod rejects unsupported check fields and duplicate IDs with paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-check-schema-'));
  try {
    const configPath = join(root, 'checks.json');
    writeFileSync(configPath, JSON.stringify({
      version: '1.0',
      checks: [{
        id: 'test',
        command: [process.execPath, '--version'],
        timeoutMs: 1_000,
        shell: true,
      }],
    }), 'utf8');
    assert.throws(
      () => loadCheckPlan(configPath, { commands: [] }),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'INVALID_INPUT');
        assert.match(error.message, /checks\[0\]/);
        return true;
      },
    );

    writeFileSync(configPath, JSON.stringify({
      version: '1.0',
      checks: [
        { id: 'test', command: [process.execPath], timeoutMs: 1_000 },
        { id: 'test', command: [process.execPath], timeoutMs: 1_000 },
      ],
    }), 'utf8');
    assert.throws(
      () => loadCheckPlan(configPath, { commands: [] }),
      /duplicate check id test/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
