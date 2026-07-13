import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

test('two concurrent feedback operations do not lose updates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-concurrent-'));
  try {
    const lockfile = join(root, 'playbook.lock.yaml');
    const worker = resolve(import.meta.dirname, 'feedback-worker.ts');
    await Promise.all([runWorker(worker, lockfile), runWorker(worker, lockfile)]);
    const document = YAML.parse(readFileSync(lockfile, 'utf8'));
    assert.equal(document.governance_summary.total_tasks, 2);
    assert.equal(document.directives.d1.quality_signal.overall.unverified, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function runWorker(worker: string, lockfile: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, lockfile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`feedback worker exited ${code}: ${stderr}`)));
  });
}
