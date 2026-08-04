import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(resolve(root, 'packages/core/package.json'), 'utf8'));
const cli = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'));

assert.equal(core.name, '@sovea/resonant-code-core');
assert.equal(cli.name, '@sovea/resonant-code');
assert.equal(core.version, cli.version, 'Core and CLI versions must move together.');
assert.equal(core.version, '0.0.1');
assert.equal(core.private, undefined);
assert.equal(cli.private, undefined);
assert.equal(core.publishConfig?.access, 'public');
assert.equal(cli.publishConfig?.access, 'public');
assert.equal(cli.dependencies?.[core.name], 'workspace:*');
assert.deepEqual(cli.bin, { 'resonant-code': './dist/index.mjs' });
assert.deepEqual(Object.keys(core.exports).sort(), ['.', './package.json']);
assert.deepEqual(core.files, ['dist', 'LICENSE', 'README.md']);

const versionSource = readFileSync(resolve(root, 'packages/cli/src/version.ts'), 'utf8');
assert.equal(
  versionSource.match(/PRODUCT_VERSION\s*=\s*'([^']+)'/)?.[1],
  cli.version,
  'CLI source version must match both package versions.',
);

for (const file of [
  'packages/core/dist/index.mjs',
  'packages/core/dist/index.d.mts',
  'packages/cli/dist/index.mjs',
]) {
  assert.ok(existsSync(resolve(root, file)), `Missing release file ${file}.`);
}
for (const file of [
  'packages/core/dist/rccl.mjs',
  'packages/core/dist/rccl.d.mts',
  'packages/core/assets/playbook/core.yaml',
  'packages/cli/src/workflow/change.mjs',
  'packages/cli/src/workflow/bootstrap.mjs',
  'packages/cli/src/commands/context.ts',
  'packages/cli/src/commands/bootstrap.ts',
]) {
  assert.equal(existsSync(resolve(root, file)), false, `Legacy release path remains: ${file}.`);
}

const coreModule = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.mjs')).href);
assert.deepEqual(
  Object.keys(coreModule).sort(),
  ['compileDelegation', 'evaluateHandoff'],
  'Core root must expose exactly the two Semantic Handoff operations.',
);

for (const path of ['.claude-plugin', '.codex-plugin', '.codex', 'skills']) {
  assert.equal(existsSync(resolve(root, path)), false, `Repository-native Host path still exists: ${path}.`);
}

const trackedDist = execFileSync(
  'git',
  ['ls-files', '--', ':(glob)**/dist/**'],
  { cwd: root, encoding: 'utf8' },
).trim().split(/\r?\n/).filter(Boolean);
const presentTrackedDist = trackedDist.filter((path) => existsSync(resolve(root, path)));
assert.deepEqual(presentTrackedDist, [], 'Generated dist files must not remain tracked by Git.');
assert.match(readFileSync(resolve(root, '.gitignore'), 'utf8'), /^\*\*\/dist\/$/m);

for (const file of [
  'docs/architecture.md',
  'docs/change-workflow.md',
  'evaluation/paired-agent/PROTOCOL.md',
  'evaluation/paired-agent/ledger.json',
]) {
  assert.ok(existsSync(resolve(root, file)), `Missing project artifact ${file}.`);
}
