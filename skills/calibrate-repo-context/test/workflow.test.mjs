import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspace = resolve(import.meta.dirname, '../../..');
const script = join(workspace, 'skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs');
const project = mkdtempSync(join(tmpdir(), 'resonant-calibrate-workflow-'));

try {
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'src/api.ts'), [
    'export interface Api {',
    '  run(): void;',
    '}',
    'export const api: Api = { run() {} };',
    '',
  ].join('\n'), 'utf8');

  const missing = run(['prepare', project], false);
  assert.equal(missing.status, 'rejected');
  assert.ok(missing.diagnostics.some((item) => item.code === 'MISSING_EVIDENCE_SELECTIONS'));

  const prepared = run(['prepare', project, '--evidence', 'src/api.ts:1-4']);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.context.windows.length, 1);
  const contractPath = join(project, 'prepare.json');
  writeFileSync(contractPath, JSON.stringify(prepared), 'utf8');

  const proposalPath = join(project, 'proposal.json');
  writeFileSync(proposalPath, JSON.stringify({
    schemaVersion: '1.0',
    requestId: prepared.contract.requestId,
    contextFingerprint: prepared.contract.contextFingerprint,
    observations: [{
      id: 'obs-api-entrypoint',
      category: 'architecture',
      scope: 'src/**',
      statement: 'The selected module exposes the API boundary.',
      affects: ['api-shape'],
      decisionImpact: 'Creating another entrypoint would split the supported API boundary.',
      semanticConfidence: 'high',
      evidence: [{ windowId: prepared.contract.evidenceWindows[0].windowId }],
    }],
  }), 'utf8');

  const committed = run([
    'commit',
    project,
    '--contract',
    contractPath,
    '--input',
    proposalPath,
  ]);
  assert.equal(committed.status, 'committed');
  assert.equal(committed.document.observations[0].reviewStatus, 'generated');

  const approved = run([
    'approve',
    project,
    '--id',
    'obs-api-entrypoint',
    '--approved-by',
    'cli-test-reviewer',
  ]);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.document.observations[0].reviewStatus, 'reviewed');
  assert.equal(approved.document.observations[0].approval.approvedBy, 'cli-test-reviewer');

  const validated = run(['validate', project]);
  assert.equal(validated.status, 'valid');
  assert.equal(validated.document.observations[0].evidenceVerification.status, 'current');

  const persisted = readFileSync(join(project, '.resonant-code', 'rccl.yaml'), 'utf8');
  assert.match(persisted, /approvedBy: cli-test-reviewer/);
} finally {
  rmSync(project, { recursive: true, force: true });
}

function run(args, expectSuccess = true) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (expectSuccess) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } else {
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
  }
  return JSON.parse(result.stdout);
}
