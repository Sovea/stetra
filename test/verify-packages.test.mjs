import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const corePath = resolve(root, 'packages/core/package.json');
const cliPath = resolve(root, 'packages/cli/package.json');
const core = JSON.parse(readFileSync(corePath, 'utf8'));
const cli = JSON.parse(readFileSync(cliPath, 'utf8'));

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
assert.deepEqual(Object.keys(core.exports).sort(), ['.', './package.json', './rccl']);

const versionSource = readFileSync(resolve(root, 'packages/cli/src/version.ts'), 'utf8');
assert.equal(
  versionSource.match(/PRODUCT_VERSION\s*=\s*'([^']+)'/)?.[1],
  cli.version,
  'CLI source version must match both package versions.',
);

for (const file of [
  'packages/core/dist/index.mjs',
  'packages/core/dist/index.d.mts',
  'packages/core/dist/rccl.mjs',
  'packages/core/dist/rccl.d.mts',
  'packages/core/assets/playbook/core.yaml',
  'packages/cli/dist/index.mjs',
]) {
  assert.ok(existsSync(resolve(root, file)), `Missing release file ${file}.`);
}

const coreModule = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.mjs')).href);
assert.deepEqual(
  Object.keys(coreModule).sort(),
  ['compileChange', 'evaluateChange'],
  'Core root must expose exactly the two hard-kernel value operations.',
);

for (const path of [
  '.claude-plugin',
  '.codex-plugin',
  '.codex',
  'skills',
  'runtime',
  'rccl',
]) {
  assert.equal(existsSync(resolve(root, path)), false, `Legacy path still exists: ${path}.`);
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
  'templates/checks.template.json',
  'templates/personal-overlay.template.yaml',
  'templates/feedback-change-proposal.template.json',
  'evaluation/paired-agent/PROTOCOL.md',
  'evaluation/paired-agent/ledger.json',
]) {
  assert.ok(existsSync(resolve(root, file)), `Missing MVP artifact ${file}.`);
}
