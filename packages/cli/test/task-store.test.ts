import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import {
  createCollectionStagingDirectory,
  createTaskWorkspace,
} from '../src/workflow/task-store.ts';

test('ephemeral staging directories stay short and unique without carrying task identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-task-store-'));
  try {
    const firstPrepare = createTaskWorkspace(root, randomUUID()).taskDirectory;
    const secondPrepare = createTaskWorkspace(root, randomUUID()).taskDirectory;
    const taskId = randomUUID();
    const firstCollect = createCollectionStagingDirectory({
      projectRoot: root,
      taskId,
      revision: 1,
    });
    const secondCollect = createCollectionStagingDirectory({
      projectRoot: root,
      taskId,
      revision: 1,
    });

    const prepareNames = [basename(firstPrepare), basename(secondPrepare)];
    const collectNames = [basename(firstCollect), basename(secondCollect)];
    assert.equal(new Set(prepareNames).size, prepareNames.length);
    assert.equal(new Set(collectNames).size, collectNames.length);
    for (const name of prepareNames) {
      assert.match(name, /^prepare-/);
      assert.ok(name.length <= 14, `prepare staging name is unexpectedly long: ${name}`);
    }
    for (const name of collectNames) {
      assert.match(name, /^collect-/);
      assert.ok(name.length <= 14, `collection staging name is unexpectedly long: ${name}`);
    }
    assert.ok(existsSync(join(firstPrepare, 'worktree-objects')));
    assert.ok(existsSync(join(firstCollect, 'artifacts')));
    assert.ok(existsSync(join(firstCollect, 'objects')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
