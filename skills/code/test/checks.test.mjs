import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadCheckPlan,
  runCheckPlan,
} from '../internal/checks.mjs';

const root = mkdtempSync(join(tmpdir(), 'resonant-check-facts-'));
try {
  const configPath = join(root, 'checks.json');
  writeFileSync(configPath, JSON.stringify({
    version: '1.0',
    checks: [
      {
        id: 'pass',
        command: [process.execPath, '-e', 'process.stdout.write("passed output")'],
        timeoutMs: 10_000,
      },
      {
        id: 'fail',
        command: [process.execPath, '-e', 'process.stderr.write("failed output"); process.exit(3)'],
        timeoutMs: 10_000,
      },
    ],
  }), 'utf8');
  const plan = loadCheckPlan(configPath, {
    commands: [
      { id: 'pass', reason: 'Exercise a passing check.' },
      { id: 'fail', reason: 'Exercise a failing check.' },
      { id: 'missing', reason: 'Exercise an unconfigured check.' },
    ],
  });
  assert.deepEqual(plan.map((item) => item.status), ['configured', 'configured', 'missing']);

  const outputDirectory = join(root, 'output');
  const results = await runCheckPlan({
    projectRoot: root,
    plan,
    outputDirectory,
  });
  assert.deepEqual(results.map((item) => item.status), ['passed', 'failed', 'skipped']);
  assert.equal(results[0].exitCode, 0);
  assert.equal(results[1].exitCode, 3);
  assert.equal(results[2].exitCode, null);
  assert.ok(results.every((item) => item.outputDigest));
  assert.equal(readFileSync(join(outputDirectory, 'pass.stdout.log'), 'utf8'), 'passed output');
  assert.equal(readFileSync(join(outputDirectory, 'fail.stderr.log'), 'utf8'), 'failed output');
  assert.ok(existsSync(join(outputDirectory, 'pass.stderr.log')));

  const tampered = plan.map((item) => ({ ...item }));
  tampered[0].command = [process.execPath, '-e', 'process.exit(9)'];
  await assert.rejects(() => runCheckPlan({
    projectRoot: root,
    plan: tampered,
    outputDirectory,
  }), /invalid or was modified/);

  writeFileSync(configPath, JSON.stringify({
    version: '1.0',
    checks: [{ id: 'invalid', command: 'npm test', timeoutMs: 10_000 }],
  }), 'utf8');
  assert.throws(
    () => loadCheckPlan(configPath, { commands: [] }),
    /command must be a non-empty string array/,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
