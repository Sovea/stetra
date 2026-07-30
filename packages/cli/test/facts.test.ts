import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
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
  buildCheckPlan,
  loadCheckConfiguration,
  runCheckPlan,
} from '../src/facts/checks.mjs';
import {
  captureGitWorktree,
  compareGitWorktrees,
} from '../src/facts/worktree.mjs';
import { runBufferedCommand } from '../src/infrastructure/process.ts';

test('Execa-backed checks preserve success, failure, timeout, and spawn facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-check-runner-'));
  try {
    const configPath = join(root, 'checks.json');
    writeFileSync(configPath, `${JSON.stringify({
      version: '1.0',
      checks: [
        {
          id: 'success',
          rationale: 'Exercise successful command collection.',
          command: [process.execPath, '-e', 'process.stdout.write("ok")'],
          timeoutMs: 2_000,
        },
        {
          id: 'failure',
          rationale: 'Exercise non-zero exit collection.',
          command: [process.execPath, '-e', 'process.stderr.write("bad"); process.exit(3)'],
          timeoutMs: 2_000,
        },
        {
          id: 'timeout',
          rationale: 'Exercise timeout collection.',
          command: [process.execPath, '-e', 'setTimeout(() => {}, 10_000)'],
          timeoutMs: 50,
        },
        {
          id: 'missing-command',
          rationale: 'Exercise spawn failure collection.',
          command: ['resonant-code-definitely-missing-executable'],
          timeoutMs: 2_000,
        },
        {
          id: 'large-output',
          rationale: 'Exercise bounded output collection.',
          command: [process.execPath, '-e', 'process.stdout.write("x".repeat(1100000))'],
          timeoutMs: 2_000,
        },
      ],
    }, null, 2)}\n`, 'utf8');
    const definitions = loadCheckConfiguration(configPath, { required: true });
    const plan = buildCheckPlan(definitions, {
      commands: [
        'success',
        'failure',
        'timeout',
        'missing-command',
        'large-output',
      ].map((id) => ({
        id,
        reasons: ['Exercise the check runner fixture.'],
        sources: ['host-task'],
      })),
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
    assert.deepEqual(results[0].outputRefs, {
      stdout: 'check-output/success.stdout.log',
    });
    assert.equal(
      existsSync(join(outputDirectory, 'success.stderr.log')),
      false,
    );
    assert.equal(results[1].status, 'failed');
    assert.equal(results[1].exitCode, 3);
    assert.match(results[1].reason ?? '', /exited with 3/);
    assert.deepEqual(results[1].outputRefs, {
      stderr: 'check-output/failure.stderr.log',
    });
    assert.equal(
      existsSync(join(outputDirectory, 'failure.stdout.log')),
      false,
    );
    assert.equal(results[2].status, 'unavailable');
    assert.match(results[2].reason ?? '', /timed out/);
    assert.equal(results[3].status, 'unavailable');
    assert.equal(results[3].exitCode, null);
    assert.match(results[3].reason ?? '', /could not start/i);
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
    assert.equal(spawnFailure[0].status, 'unavailable');
    assert.equal(spawnFailure[0].exitCode, null);
    assert.match(spawnFailure[0].reason ?? '', /could not start/i);

    const bufferedSpawnFailure = await runBufferedCommand({
      file: 'resonant-code-definitely-missing-executable',
      args: [],
      cwd: root,
      maxBuffer: 1_024,
    });
    assert.equal(bufferedSpawnFailure.executionError, true);
    assert.equal(bufferedSpawnFailure.exitCode, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Zod rejects unsupported check fields and duplicate IDs with paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-check-schema-'));
  try {
    const configPath = join(root, 'checks.json');
    assert.deepEqual(loadCheckConfiguration(configPath), []);
    assert.throws(
      () => loadCheckConfiguration(configPath, { required: true }),
      /does not exist/,
    );
    writeFileSync(configPath, JSON.stringify({
      version: '1.0',
      checks: [{
        id: 'test',
        rationale: 'Run the test fixture.',
        command: [process.execPath, '--version'],
        timeoutMs: 1_000,
        shell: true,
      }],
    }), 'utf8');
    assert.throws(
      () => loadCheckConfiguration(configPath),
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
        {
          id: 'test',
          rationale: 'Run the first test fixture.',
          command: [process.execPath],
          timeoutMs: 1_000,
        },
        {
          id: 'test',
          rationale: 'Run the duplicate test fixture.',
          command: [process.execPath],
          timeoutMs: 1_000,
        },
      ],
    }), 'utf8');
    assert.throws(
      () => loadCheckConfiguration(configPath),
      /duplicate check id test/,
    );

    writeFileSync(configPath, JSON.stringify({
      version: '1.0',
      checks: [{
        id: 'test',
        command: [process.execPath],
        timeoutMs: 1_000,
      }],
    }), 'utf8');
    assert.throws(
      () => loadCheckConfiguration(configPath),
      /checks\[0\]\.rationale/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selected check definitions cannot be silently omitted and all execute', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-check-activation-'));
  try {
    const configPath = join(root, 'checks.json');
    writeFileSync(configPath, JSON.stringify({
      version: '1.0',
      checks: [
        {
          id: 'typecheck',
          rationale: 'Validate the TypeScript contract.',
          command: [process.execPath, '-e', 'process.exit(0)'],
          timeoutMs: 2_000,
        },
        {
          id: 'smoke',
          rationale: 'Exercise the public entrypoint.',
          command: [process.execPath, '-e', 'process.exit(9)'],
          timeoutMs: 2_000,
        },
      ],
    }), 'utf8');
    const definitions = loadCheckConfiguration(configPath, { required: true });
    assert.throws(() => buildCheckPlan(definitions, {
      commands: [{
        id: 'typecheck',
        reasons: ['TypeScript guidance requires it.'],
        sources: ['delivered-guidance'],
      }],
    }), /omitted selected check definition.*smoke/);

    const plan = buildCheckPlan(definitions, {
      commands: [
        {
          id: 'typecheck',
          reasons: ['TypeScript guidance requires it.'],
          sources: ['delivered-guidance', 'host-task'],
        },
        {
          id: 'smoke',
          reasons: ['Exercise the changed public entrypoint.'],
          sources: ['host-task'],
        },
      ],
    });
    assert.deepEqual(
      plan.map((item: { id: string; status: string }) => ({
        id: item.id,
        status: item.status,
      })),
      [
        { id: 'typecheck', status: 'configured' },
        { id: 'smoke', status: 'configured' },
      ],
    );

    const outputDirectory = join(root, 'check-output');
    const results = await runCheckPlan({
      projectRoot: root,
      plan,
      outputDirectory,
    });
    assert.deepEqual(results.map((item) => item.id), ['typecheck', 'smoke']);
    assert.equal(results[0].status, 'passed');
    assert.equal(results[1].status, 'failed');
    assert.equal('outputRefs' in results[0], false);
    assert.equal(existsSync(outputDirectory), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worktree facts treat initialized and uninitialized Git links as opaque object IDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-gitlink-root-'));
  const dependency = mkdtempSync(join(tmpdir(), 'resonant-gitlink-source-'));
  try {
    initializeRepository(dependency, 'dependency@example.invalid');
    writeFileSync(join(dependency, 'value.txt'), 'one\n', 'utf8');
    git(dependency, ['add', '.']);
    git(dependency, ['commit', '-qm', 'initial dependency']);
    const firstDependencyHead = gitOutput(dependency, ['rev-parse', 'HEAD']);

    initializeRepository(root, 'root@example.invalid');
    writeFileSync(join(root, 'root.txt'), 'root\n', 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'initial root']);
    git(root, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '-q',
      dependency,
      'vendor/dependency',
    ]);
    git(root, ['commit', '-qam', 'add dependency']);

    const initialized = await captureGitWorktree(root);
    const initializedEntry = initialized.entries.find(
      (entry: { path: string }) => entry.path === 'vendor/dependency',
    );
    assert.deepEqual(initializedEntry, {
      path: 'vendor/dependency',
      kind: 'gitlink',
      contentHash: firstDependencyHead,
      mode: '160000',
    });

    git(root, ['submodule', 'deinit', '-f', '--', 'vendor/dependency']);
    const uninitialized = await captureGitWorktree(root);
    const uninitializedEntry = uninitialized.entries.find(
      (entry: { path: string }) => entry.path === 'vendor/dependency',
    );
    assert.deepEqual(uninitializedEntry, initializedEntry);
    assert.equal(uninitialized.fingerprint, initialized.fingerprint);

    writeFileSync(join(dependency, 'value.txt'), 'two\n', 'utf8');
    git(dependency, ['commit', '-qam', 'update dependency']);
    const secondDependencyHead = gitOutput(dependency, ['rev-parse', 'HEAD']);
    git(root, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'update',
      '--init',
      '-q',
      'vendor/dependency',
    ]);
    const checkout = join(root, 'vendor', 'dependency');
    git(checkout, ['-c', 'protocol.file.allow=always', 'fetch', '-q', 'origin']);
    git(checkout, ['checkout', '-q', secondDependencyHead]);

    const changed = await captureGitWorktree(root);
    const changes = compareGitWorktrees(uninitialized, changed);
    assert.deepEqual(changes.files, [{
      path: 'vendor/dependency',
      status: 'modified',
      before: {
        kind: 'gitlink',
        contentHash: firstDependencyHead,
        mode: '160000',
      },
      after: {
        kind: 'gitlink',
        contentHash: secondDependencyHead,
        mode: '160000',
      },
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dependency, { recursive: true, force: true });
  }
});

function initializeRepository(root: string, email: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', email]);
  git(root, ['config', 'user.name', 'Fact Test']);
}

function git(root: string, args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

function gitOutput(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}
