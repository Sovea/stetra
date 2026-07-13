import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseYaml, toYaml } from '../src/utils/yaml.ts';
import { verifyEvidence } from '../src/verify/verify-evidence.ts';
import { verifyObservationInduction } from '../src/verify/verify-induction.ts';
import { buildRepoIndex } from '../src/indexing/build-repo-index.ts';
import { commitCalibration, prepareCalibration } from '../src/lifecycle.ts';

test('standard YAML round-trips quotes, backslashes, and multiline text', () => {
  const value = { quote: 'a: "b"', windows: 'C:\\repo\\file.ts', multiline: 'line one\nline two\n', nested: [{ value: '# not a comment' }] };
  assert.deepEqual(parseYaml(toYaml(value)), value);
});

test('absolute, traversal, and symlink-escape evidence paths fail', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-paths-'));
  const outside = mkdtempSync(join(tmpdir(), 'resonant-outside-'));
  try {
    writeFileSync(join(root, 'inside.ts'), 'export const x = 1;\n', 'utf8');
    writeFileSync(join(outside, 'outside.ts'), 'export const x = 1;\n', 'utf8');
    const evidence = (file: string) => ({ file, line_range: [1, 1] as [number, number], snippet: 'export const x = 1;' });
    assert.equal(verifyEvidence(evidence(join(root, 'inside.ts')), root).status, 'path-outside-project');
    assert.equal(verifyEvidence(evidence('C:\\outside\\file.ts'), root).status, 'path-outside-project');
    assert.equal(verifyEvidence(evidence('../outside.ts'), root).status, 'path-outside-project');
    try {
      symlinkSync(join(outside, 'outside.ts'), join(root, 'escape.ts'), 'file');
      assert.equal(verifyEvidence(evidence('escape.ts'), root).status, 'path-outside-project');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') t.diagnostic('Symlink creation is unavailable on this Windows host.');
      else throw error;
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('module and repository scope with insufficient diverse evidence demote to ambient', () => {
  const module = verifyObservationInduction(observation('module-cluster', ['src/a.ts']));
  assert.equal(module.verification.disposition, 'demote-to-ambient');
  const repository = verifyObservationInduction(observation('cross-root', ['src/a.ts', 'src/b.ts', 'src/c.ts']));
  assert.equal(repository.verification.disposition, 'demote-to-ambient');
});

test('non-git index follows .gitignore and reports budgets', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-index-'));
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, '.gitignore'), 'ignored/\n', 'utf8');
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(root, 'README.md'), '# Project\n', 'utf8');
    writeFileSync(join(root, 'ignored', 'b.ts'), 'export const b = 2;\n', 'utf8');
    const index = buildRepoIndex(root);
    assert.deepEqual(index.files.map((file) => file.path), ['README.md', 'src/a.ts']);
    assert.equal(index.report.indexed_files, 2);
    assert.ok(index.report.read_bytes > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('git index still excludes dependencies, coverage, and nested build output', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-git-index-'));
  try {
    for (const directory of ['src', 'runtime/dist', 'coverage/tmp', 'node_modules/example']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(root, 'runtime', 'dist', 'index.mjs'), 'export const built = true;\n', 'utf8');
    writeFileSync(join(root, 'coverage', 'tmp', 'coverage.json'), '{}\n', 'utf8');
    writeFileSync(join(root, 'node_modules', 'example', 'index.js'), 'module.exports = {};\n', 'utf8');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    assert.deepEqual(buildRepoIndex(root).files.map((file) => file.path), ['src/a.ts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('old RCCL candidate schema is refused without writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-old-schema-'));
  try {
    const issued = prepareCalibration({ projectRoot: root, mode: 'full' });
    const result = commitCalibration({ projectRoot: root, plan: { mode: 'full', contract: issued.contract }, artifacts: { candidate: 'schema_version: 3\nkind: rccl-observation-generation\nrequest_id: old\ncontext_fingerprint: old\npayload: {}\n' } });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'unsupported-schema-version');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('commit requires a current RCCL-issued contract and rejects self-signed plans', () => {
  const root = mkdtempSync(join(tmpdir(), 'resonant-contract-binding-'));
  try {
    writeFileSync(join(root, 'README.md'), '# Contract binding\n', 'utf8');
    const missing = commitCalibration({
      projectRoot: root,
      plan: { mode: 'full' } as any,
      artifacts: { candidate: '{}\n' },
    });
    assert.equal(missing.status, 'failed');
    assert.equal(missing.reason, 'missing-calibration-contract');

    const issued = prepareCalibration({ projectRoot: root, mode: 'full' });
    const forgedFingerprint = '000000000000000000000000';
    const forgedContract = {
      ...issued.contract,
      requestId: `rccl-observation-generation:${forgedFingerprint}`,
      contextFingerprint: forgedFingerprint,
    };
    const forgedEnvelope = JSON.stringify({
      schema_version: 1,
      kind: 'rccl-observation-generation',
      request_id: forgedContract.requestId,
      context_fingerprint: forgedContract.contextFingerprint,
      payload: { version: '1.0', generated_at: null, git_ref: null, observations: [] },
    });
    const forged = commitCalibration({
      projectRoot: root,
      plan: { mode: 'full', contract: forgedContract },
      artifacts: { candidate: forgedEnvelope },
    });
    assert.equal(forged.status, 'failed');
    assert.equal(forged.reason, 'calibration-plan-stale');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function observation(scope_basis: 'module-cluster' | 'cross-root', files: string[]): any {
  return {
    id: 'obs-test', semantic_key: 'test', category: 'pattern', scope: '**/*', pattern: 'test', confidence: 0.9, adherence_quality: 'good',
    evidence: files.map((file) => ({ file, line_range: [1, 1], snippet: 'x' })),
    support: { source_slices: [], file_count: files.length, cluster_count: 1, scope_basis },
    verification: { evidence_status: 'verified', evidence_verified_count: files.length, evidence_confidence: 0.9, induction_status: null, induction_confidence: null, checked_at: null, disposition: 'keep' },
  };
}
