import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { runCli } from '../src/cli.ts';
import { CliError } from '../src/errors.ts';

test('CLI exposes the compact task surface and removes schema 1 commands', async () => {
  const help = await runCli([]);
  assert.match(String(help.output), /task\s+Manage one admitted coding change/);
  assert.match(String(help.output), /host\s+Bridge a native Host lifecycle event/);
  assert.doesNotMatch(String(help.output), /\n  (?:change|input)(?: |\n)/);
  await assert.rejects(() => runCli(['change']), (error: unknown) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, 'USAGE_ERROR');
    return true;
  });
});

test('CLI reads compact task semantics from stdin and reports deterministic JSON', async () => {
  const root = repository();
  try {
    await runCli(['--json', 'init', root, '--adapter', 'codex']);
    const begin = await runCli([
      '--json', 'task', 'begin', root, '--input', '-',
    ], {
      input: Readable.from([JSON.stringify({
        humanEvent: { content: 'Update app.txt.' },
        interpretation: { desiredOutcome: 'Use the new text.', constraints: [], nonGoals: [] },
        assurance: { mode: 'routine' },
        verification: { mode: 'no-command', rationale: 'No executable behavior.' },
      })]),
      interactive: false,
      color: false,
    });
    assert.equal(begin.json, true);
    assert.equal(begin.command, 'task begin');
    assert.equal((begin.output as { status: string }).status, 'task-begun');
    assert.match((begin.output as { taskId: string }).taskId, /^[a-f0-9-]{36}$/);

    const status = await runCli(['--json', 'status', root]);
    assert.equal((status.output as { schemaVersion: string }).schemaVersion, '2');
    assert.equal((status.output as { status: string }).status, 'ready');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI refuses semantic input files inside the observed project', async () => {
  const root = repository();
  try {
    await runCli(['--json', 'init', root, '--adapter', 'codex']);
    const inputPath = join(root, 'begin.json');
    writeFileSync(inputPath, '{}\n', 'utf8');
    await assert.rejects(() => runCli([
      '--json', 'task', 'begin', root, '--input', inputPath,
    ]), (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /stdin or a file outside/);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'stetra-cli-'));
  execFileSync('git', ['-C', root, 'init', '--quiet']);
  writeFileSync(join(root, 'app.txt'), 'old\n', 'utf8');
  return root;
}
