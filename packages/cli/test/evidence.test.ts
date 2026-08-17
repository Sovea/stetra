import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { materializeEvidenceWindow } from '../src/facts/evidence.ts';
import { sha256 } from '../src/protocol.ts';

test('whole-file repository evidence materializes an exact immutable line window', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-evidence-'));
  try {
    const text = 'first line\nsecond line\n';
    writeFileSync(join(root, 'source.ts'), text);
    assert.deepEqual(materializeEvidenceWindow(root, {
      key: 'source', path: 'source.ts', wholeFile: true,
    }), {
      key: 'source',
      path: 'source.ts',
      startLine: 1,
      endLine: 2,
      text,
      digest: sha256(text),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('whole-file repository evidence rejects an empty file instead of inventing a line', () => {
  const root = mkdtempSync(join(tmpdir(), 'stetra-evidence-'));
  try {
    writeFileSync(join(root, 'empty.ts'), '');
    assert.throws(() => materializeEvidenceWindow(root, {
      key: 'empty', path: 'empty.ts', wholeFile: true,
    }), /cannot materialize empty file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
