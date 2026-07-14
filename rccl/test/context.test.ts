import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  commitCalibration,
  parseRcclDocument,
  prepareCalibration,
  validateContext,
} from '../src/index.ts';
import { parseRccl as parseRuntimeRccl } from '../src/runtime.ts';

test('targeted prepare issues one bounded calibration contract', () => {
  withProject((root) => {
    const prepared = prepareCalibration({ projectRoot: root, paths: ['src'], maxFiles: 2 });
    assert.equal(prepared.status, 'ready');
    assert.equal(prepared.contract.schemaVersion, '1.0');
    assert.ok(prepared.contract.selectedPaths.includes('src/service.ts'));
    assert.ok(prepared.context.files <= 2);
    assert.ok(prepared.context.windows.length > 0);
    assert.match(prepared.contract.prompt, /Prefer zero observations over weak observations/);
  });
});

test('commit verifies evidence integrity without claiming semantic truth', () => {
  withProject((root) => {
    const prepared = prepareCalibration({ projectRoot: root, paths: ['src/service.ts'] });
    const window = prepared.context.windows.find((item) => item.file === 'src/service.ts')!;
    const committed = commitCalibration({
      projectRoot: root,
      paths: ['src/service.ts'],
      proposal: {
        schemaVersion: '1.0',
        requestId: prepared.contract.requestId,
        contextFingerprint: prepared.contract.contextFingerprint,
        observations: [{
          id: 'obs-public-service-boundary',
          category: 'architecture',
          scope: 'src/**',
          statement: 'Public service construction is centralized in src/service.ts.',
          affects: ['architecture-boundary'],
          decisionImpact: 'New public services should preserve the construction boundary instead of creating a second entrypoint.',
          semanticConfidence: 'high',
          reviewStatus: 'reviewed',
          evidence: [{ file: window.file, lineRange: window.lineRange, snippet: window.snippet }],
        }],
      },
    });
    assert.equal(committed.status, 'committed');
    assert.equal(committed.summary.current, 1);
    assert.equal(committed.document?.observations[0].evidenceVerification.status, 'current');
    assert.equal(committed.document?.observations[0].semanticConfidence, 'high');
    assert.equal(committed.document?.observations[0].reviewStatus, 'reviewed');

    const runtime = parseRuntimeRccl(readFileSync(join(root, '.resonant-code', 'rccl.yaml'), 'utf8'));
    assert.equal(runtime.valid, true);
    assert.equal(runtime.data?.observations[0].evidenceVerification.status, 'current');
  });
});

test('evidence drift marks a prior current observation stale', () => {
  withProject((root) => {
    const prepared = prepareCalibration({ projectRoot: root, paths: ['src/service.ts'] });
    const window = prepared.context.windows.find((item) => item.file === 'src/service.ts')!;
    const committed = commitCalibration({
      projectRoot: root,
      paths: ['src/service.ts'],
      proposal: {
        schemaVersion: '1.0',
        requestId: prepared.contract.requestId,
        contextFingerprint: prepared.contract.contextFingerprint,
        observations: [{
          id: 'obs-service-boundary',
          category: 'constraint',
          scope: 'src/**',
          statement: 'Service exports are centralized.',
          affects: ['api-shape'],
          decisionImpact: 'Adding exports elsewhere would split the public API boundary.',
          semanticConfidence: 'medium',
          evidence: [{ file: window.file, lineRange: window.lineRange, snippet: window.snippet }],
        }],
      },
    });
    assert.equal(committed.status, 'committed');
    writeFileSync(join(root, 'src/service.ts'), 'export const replacement = 2;\n', 'utf8');
    const validated = validateContext({ projectRoot: root });
    assert.equal(validated.status, 'valid');
    assert.deepEqual(validated.changedObservationIds, ['obs-service-boundary']);
    assert.equal(validated.document?.observations[0].evidenceVerification.status, 'stale');
  });
});

test('decision impact is a hard admission gate and empty final documents are valid', () => {
  withProject((root) => {
    const prepared = prepareCalibration({ projectRoot: root, paths: ['src/service.ts'] });
    const window = prepared.context.windows[0];
    const rejected = commitCalibration({
      projectRoot: root,
      paths: ['src/service.ts'],
      proposal: {
        schemaVersion: '1.0',
        requestId: prepared.contract.requestId,
        contextFingerprint: prepared.contract.contextFingerprint,
        observations: [{
          id: 'obs-package-version',
          category: 'convention',
          scope: 'package.json',
          statement: 'The package has a version.',
          affects: ['review-focus'],
          decisionImpact: '',
          semanticConfidence: 'low',
          evidence: [{ file: window.file, lineRange: window.lineRange, snippet: window.snippet }],
        }],
      },
    });
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.diagnostics.some((item) => item.code === 'MISSING_DECISION_IMPACT'));

    const empty = parseRcclDocument('version: "1.0"\ngeneratedAt: now\ngitRef: null\nobservations: []\n');
    assert.equal(empty.valid, true);
    const unsupported = parseRcclDocument('version: "0.0"\nobservations: []\n');
    assert.equal(unsupported.valid, false);
    assert.ok(unsupported.diagnostics.some((item) => item.code === 'UNSUPPORTED_SCHEMA_VERSION'));
  });
});

function withProject(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'resonant-rccl-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/service.ts'), [
      'export interface Service {',
      '  run(): Promise<void>;',
      '}',
      '',
      'export function createService(): Service {',
      '  return { async run() {} };',
      '}',
      '',
    ].join('\n'), 'utf8');
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
