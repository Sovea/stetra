import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const entrypoint = resolve(workspace, 'packages/cli/dist/index.mjs');
const version = JSON.parse(
  readFileSync(resolve(workspace, 'packages/cli/package.json'), 'utf8'),
).version;

const versionResult = run(['--version']);
assert.equal(versionResult.status, 0);
assert.equal(versionResult.stdout.trim(), version);

const statusResult = run(['status', workspace, '--json']);
assert.equal(statusResult.status, 2);
const status = JSON.parse(statusResult.stdout);
assert.equal(status.status, 'needs-attention');
assert.equal(status.installation.status, 'absent');
assert.deepEqual(status.worktree, { status: 'supported' });
assert.deepEqual(status.issues.map((issue) => issue.code), ['host-adapter-absent']);

function run(args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: workspace,
    encoding: 'utf8',
  });
}
