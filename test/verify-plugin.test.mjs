import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const product = JSON.parse(readFileSync(resolve(root, '.codex-plugin/plugin.json'), 'utf8')).version;
assert.equal(product, '0.0.1');
for (const file of ['runtime/package.json', 'rccl/package.json', '.claude-plugin/plugin.json']) {
  assert.equal(JSON.parse(readFileSync(resolve(root, file), 'utf8')).version, product, `${file} version differs from product version.`);
}
for (const file of ['skills/init/SKILL.md', 'skills/code/SKILL.md', 'skills/calibrate-repo-context/SKILL.md']) {
  const version = readFileSync(resolve(root, file), 'utf8').match(/\bversion:\s*"([^"]+)"/)?.[1];
  assert.equal(version, product, `${file} version differs from product version.`);
}
for (const file of ['runtime/dist/index.mjs', 'runtime/dist/index.d.mts', 'rccl/dist/index.mjs', 'rccl/dist/index.d.mts']) {
  assert.ok(existsSync(resolve(root, file)), `Missing release file ${file}.`);
}
