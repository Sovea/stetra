#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const required = [
  '.codex-plugin/plugin.json',
  'skills',
  'playbook',
  'runtime/dist',
  'runtime/dist/index.mjs',
  'rccl/dist',
  'rccl/dist/index.mjs',
];

const missing = required.filter((entry) => !existsSync(join(root, entry)));
const emptyDirectories = ['skills', 'playbook', 'runtime/dist', 'rccl/dist']
  .filter((entry) => existsSync(join(root, entry)) && readdirSync(join(root, entry)).length === 0);

if (missing.length || emptyDirectories.length) {
  process.stdout.write(JSON.stringify({
    status: 'failed',
    root,
    missing,
    emptyDirectories,
  }, null, 2) + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    status: 'ok',
    root,
    checked: required,
  }, null, 2) + '\n');
}
