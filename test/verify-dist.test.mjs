import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['runtime/dist/index.mjs', 'runtime/dist/index.d.mts', 'rccl/dist/index.mjs', 'rccl/dist/index.d.mts', 'rccl/dist/runtime.mjs', 'rccl/dist/runtime.d.mts'];
const before = Object.fromEntries(files.map((file) => [file, digest(resolve(root, file))]));
execFileSync('pnpm', ['-r', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const after = Object.fromEntries(files.map((file) => [file, digest(resolve(root, file))]));
assert.deepEqual(after, before, 'Runtime/RCCL dist changed across identical consecutive builds.');

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
