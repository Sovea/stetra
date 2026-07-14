import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['runtime/dist', 'rccl/dist']
  .flatMap((directory) => readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${directory}/${entry.parentPath ? entry.parentPath.replace(resolve(root, directory), '').replace(/^\//, '') + '/' : ''}${entry.name}`.replace(/\/+/g, '/')))
  .sort();
const before = Object.fromEntries(files.map((file) => [file, digest(resolve(root, file))]));
execFileSync('corepack', ['pnpm', '-r', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const rebuiltFiles = ['runtime/dist', 'rccl/dist']
  .flatMap((directory) => readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${directory}/${entry.parentPath ? entry.parentPath.replace(resolve(root, directory), '').replace(/^\//, '') + '/' : ''}${entry.name}`.replace(/\/+/g, '/')))
  .sort();
assert.deepEqual(rebuiltFiles, files, 'Runtime/RCCL dist file set changed across identical consecutive builds.');
const after = Object.fromEntries(files.map((file) => [file, digest(resolve(root, file))]));
assert.deepEqual(after, before, 'Runtime/RCCL dist changed across identical consecutive builds.');

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
