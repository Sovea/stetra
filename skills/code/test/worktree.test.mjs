import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureGitWorktree,
  compareGitWorktrees,
} from '../internal/worktree.mjs';

const root = mkdtempSync(join(tmpdir(), 'resonant-worktree-facts-'));
try {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'keep.ts'), 'export const keep = 1;\n', 'utf8');
  writeFileSync(join(root, 'src', 'rename-me.ts'), 'export const uniquelyNamed = true;\n', 'utf8');
  writeFileSync(join(root, 'src', 'delete-me.ts'), 'export const remove = true;\n', 'utf8');
  writeFileSync(join(root, 'src', 'duplicate-a.txt'), 'same content\n', 'utf8');
  writeFileSync(join(root, 'src', 'duplicate-b.txt'), 'same content\n', 'utf8');
  writeFileSync(join(root, 'src', 'preexisting.ts'), 'export const prior = 1;\n', 'utf8');
  symlinkSync('keep.ts', join(root, 'src', 'current-link.ts'));
  git(['init', '-q']);
  git(['config', 'user.email', 'worktree@example.invalid']);
  git(['config', 'user.name', 'Worktree Test']);
  git(['add', '.']);
  git(['commit', '-qm', 'initial']);

  writeFileSync(join(root, 'src', 'preexisting.ts'), 'export const prior = 2;\n', 'utf8');
  writeFileSync(join(root, 'src', 'preexisting-untracked.ts'), 'export const priorUntracked = true;\n', 'utf8');
  const baseline = captureGitWorktree(root);

  writeFileSync(join(root, 'src', 'keep.ts'), 'export const keep = 2;\n', 'utf8');
  chmodSync(join(root, 'src', 'keep.ts'), 0o755);
  renameSync(join(root, 'src', 'rename-me.ts'), join(root, 'src', 'renamed.ts'));
  unlinkSync(join(root, 'src', 'delete-me.ts'));
  unlinkSync(join(root, 'src', 'duplicate-a.txt'));
  unlinkSync(join(root, 'src', 'duplicate-b.txt'));
  writeFileSync(join(root, 'src', 'duplicate-new-a.txt'), 'same content\n', 'utf8');
  writeFileSync(join(root, 'src', 'duplicate-new-b.txt'), 'same content\n', 'utf8');
  writeFileSync(join(root, 'src', 'added.ts'), 'export const added = true;\n', 'utf8');
  unlinkSync(join(root, 'src', 'current-link.ts'));
  symlinkSync('added.ts', join(root, 'src', 'current-link.ts'));
  mkdirSync(join(root, '.resonant-code', 'context'), { recursive: true });
  mkdirSync(join(root, '.resonant-code', 'feedback'), { recursive: true });
  writeFileSync(join(root, '.resonant-code', 'context', 'session.json'), '{}\n', 'utf8');
  writeFileSync(join(root, '.resonant-code', 'feedback', 'events.jsonl'), '{}\n', 'utf8');

  const current = captureGitWorktree(root);
  const changes = compareGitWorktrees(baseline, current);
  assert.deepEqual(
    changes.files.map((file) => [
      file.path,
      file.status,
      file.previousPath ?? null,
    ]),
    [
      ['src/added.ts', 'added', null],
      ['src/current-link.ts', 'modified', null],
      ['src/delete-me.ts', 'deleted', null],
      ['src/duplicate-a.txt', 'deleted', null],
      ['src/duplicate-b.txt', 'deleted', null],
      ['src/duplicate-new-a.txt', 'added', null],
      ['src/duplicate-new-b.txt', 'added', null],
      ['src/keep.ts', 'modified', null],
      ['src/renamed.ts', 'renamed', 'src/rename-me.ts'],
    ],
  );
  assert.ok(!changes.files.some((file) => file.path.includes('preexisting')));
  assert.ok(!changes.files.some((file) => file.path.startsWith('.resonant-code/')));
  const expectedMode = process.platform === 'win32' ? '100644' : '100755';
  assert.equal(changes.files.find((file) => file.path === 'src/keep.ts')?.after.mode, expectedMode);
  assert.equal(changes.files.find((file) => file.path === 'src/current-link.ts')?.after.kind, 'symlink');
  assert.deepEqual(compareGitWorktrees(baseline, current), changes);

  const tampered = { ...baseline, fingerprint: 'tampered' };
  assert.throws(() => compareGitWorktrees(tampered, current), /snapshot fingerprint/);
  assert.throws(
    () => captureGitWorktree(join(root, 'src')),
    /project root to equal the Git worktree root/,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

function git(args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}
