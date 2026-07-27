import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  approveContext,
  commitCalibration,
  parseRcclDocument,
  prepareCalibration,
  validateContext,
  type CalibrationContract,
  type CalibrationProposal,
} from '../src/rccl.ts';
import { parseRccl as parseRuntimeRccl } from '../src/rccl/runtime.ts';

test('prepare uses only explicit exact evidence selections', () => {
  withProject((root) => {
    const rejected = prepareCalibration({ projectRoot: root, evidenceSelections: [] });
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.diagnostics.some((item) => item.code === 'MISSING_EVIDENCE_SELECTIONS'));

    const prepared = ready(root);
    assert.equal(prepared.contract.schemaVersion, '1.0');
    assert.equal(prepared.context.files, 1);
    assert.equal(prepared.context.windows.length, 1);
    assert.deepEqual(prepared.context.windows[0].lineRange, [1, 7]);
    assert.match(prepared.context.windows[0].windowId, /^window:[a-f0-9]{64}$/);
    assert.match(prepared.contract.prompt, /host-selected evidence/);
    assert.doesNotMatch(prepared.contract.prompt, /likely architecture/);
  });
});

test('commit resolves contract window references and always generates new observations', () => {
  withProject((root) => {
    const prepared = ready(root);
    const committed = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract, {
        id: 'obs-public-service-boundary',
        statement: 'Public service construction is centralized in src/service.ts.',
      }),
    });
    assert.equal(committed.status, 'committed');
    assert.equal(committed.summary.current, 1);
    const observation = committed.document?.observations[0];
    assert.equal(observation?.evidenceVerification.status, 'current');
    assert.equal(observation?.semanticConfidence, 'high');
    assert.equal(observation?.reviewStatus, 'generated');
    assert.equal(observation?.approval, undefined);
    assert.deepEqual(observation?.evidence, [{
      file: 'src/service.ts',
      lineRange: [1, 7],
      snippet: prepared.context.windows[0].snippet,
    }]);

    const runtime = parseRuntimeRccl(readFileSync(join(root, '.resonant-code', 'rccl.yaml'), 'utf8'));
    assert.equal(runtime.valid, true);
    assert.equal(runtime.data?.observations[0].reviewStatus, 'generated');
  });
});

test('proposal cannot self-review or supply arbitrary evidence', () => {
  withProject((root) => {
    const prepared = ready(root);
    const selfReviewed = proposal(prepared.contract) as unknown as Record<string, any>;
    selfReviewed.observations[0].reviewStatus = 'reviewed';
    const rejectedReview = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: selfReviewed as CalibrationProposal,
    });
    assert.equal(rejectedReview.status, 'rejected');
    assert.ok(rejectedReview.diagnostics.some((item) =>
      item.code === 'RUNTIME_OWNED_FIELD' && item.path.endsWith('reviewStatus')));

    const arbitrary = proposal(prepared.contract) as unknown as Record<string, any>;
    arbitrary.observations[0].evidence[0].file = 'src/service.ts';
    const rejectedEvidence = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: arbitrary as CalibrationProposal,
    });
    assert.equal(rejectedEvidence.status, 'rejected');
    assert.ok(rejectedEvidence.diagnostics.some((item) => item.code === 'UNSUPPORTED_EVIDENCE_FIELD'));
  });
});

test('commit rejects evidence outside the issued contract and a contract whose source drifted', () => {
  withProject((root) => {
    const prepared = ready(root);
    const unknown = proposal(prepared.contract) as unknown as Record<string, any>;
    unknown.observations[0].evidence[0].windowId = `window:${'0'.repeat(64)}`;
    const rejectedUnknown = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: unknown as CalibrationProposal,
    });
    assert.equal(rejectedUnknown.status, 'rejected');
    assert.ok(rejectedUnknown.diagnostics.some((item) => item.code === 'EVIDENCE_WINDOW_NOT_IN_CONTRACT'));

    writeFileSync(join(root, 'src/service.ts'), 'export const replacement = 2;\n', 'utf8');
    const rejectedStale = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    });
    assert.equal(rejectedStale.status, 'rejected');
    assert.ok(rejectedStale.diagnostics.some((item) => item.code === 'CONTEXT_WINDOW_STALE'));
    assert.equal(existsSync(join(root, '.resonant-code', 'rccl.yaml')), false);
  });
});

test('approval is a separate provenance-bearing action and is idempotent', () => {
  withProject((root) => {
    const prepared = ready(root);
    const committed = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    });
    assert.equal(committed.status, 'committed');

    const approved = approveContext({
      projectRoot: root,
      observationIds: ['obs-service-boundary'],
      approvedBy: 'test-reviewer',
    });
    assert.equal(approved.status, 'approved');
    assert.deepEqual(approved.approvedObservationIds, ['obs-service-boundary']);
    const observation = approved.document?.observations[0];
    assert.equal(observation?.reviewStatus, 'reviewed');
    assert.equal(observation?.approval?.approvedBy, 'test-reviewer');
    assert.equal(observation?.approval?.contentFingerprint, observation?.lifecycle.contentFingerprint);

    const repeated = approveContext({
      projectRoot: root,
      observationIds: ['obs-service-boundary'],
      approvedBy: 'another-reviewer',
    });
    assert.equal(repeated.status, 'approved');
    assert.deepEqual(repeated.approvedObservationIds, []);
    assert.deepEqual(repeated.unchangedObservationIds, ['obs-service-boundary']);
    assert.equal(repeated.written, undefined);
    assert.equal(repeated.document?.observations[0].approval?.approvedBy, 'test-reviewer');
  });
});

test('content changes invalidate approval while identical recommits preserve it', () => {
  withProject((root) => {
    const prepared = ready(root);
    assert.equal(commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    }).status, 'committed');
    assert.equal(approveContext({
      projectRoot: root,
      observationIds: ['obs-service-boundary'],
      approvedBy: 'test-reviewer',
    }).status, 'approved');

    const identical = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    });
    assert.equal(identical.status, 'committed');
    assert.equal(identical.document?.observations[0].reviewStatus, 'reviewed');
    assert.equal(identical.document?.observations[0].approval?.approvedBy, 'test-reviewer');

    const changed = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract, {
        statement: 'Service construction remains in the same module but the semantic claim changed.',
      }),
    });
    assert.equal(changed.status, 'committed');
    assert.equal(changed.document?.observations[0].reviewStatus, 'generated');
    assert.equal(changed.document?.observations[0].approval, undefined);
    assert.notEqual(
      changed.document?.observations[0].lifecycle.contentFingerprint,
      identical.document?.observations[0].lifecycle.contentFingerprint,
    );
  });
});

test('approval requires current evidence and later drift remains separately visible', () => {
  withProject((root) => {
    const prepared = ready(root);
    assert.equal(commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    }).status, 'committed');
    writeFileSync(join(root, 'src/service.ts'), 'export const replacement = 2;\n', 'utf8');

    const rejected = approveContext({
      projectRoot: root,
      observationIds: ['obs-service-boundary'],
      approvedBy: 'test-reviewer',
    });
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.diagnostics.some((item) => item.code === 'APPROVAL_REQUIRES_CURRENT_EVIDENCE'));

    writeFileSync(join(root, 'src/service.ts'), source(), 'utf8');
    assert.equal(approveContext({
      projectRoot: root,
      observationIds: ['obs-service-boundary'],
      approvedBy: 'test-reviewer',
    }).status, 'approved');
    writeFileSync(join(root, 'src/service.ts'), 'export const replacement = 2;\n', 'utf8');
    const validated = validateContext({ projectRoot: root });
    assert.equal(validated.status, 'valid');
    assert.deepEqual(validated.changedObservationIds, ['obs-service-boundary']);
    assert.equal(validated.document?.observations[0].evidenceVerification.status, 'stale');
    assert.equal(validated.document?.observations[0].reviewStatus, 'reviewed');
  });
});

test('reviewed documents require approval bound to the actual content fingerprint', () => {
  withProject((root) => {
    const prepared = ready(root);
    const committed = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract),
    });
    assert.equal(committed.status, 'committed');
    const raw = committed.document!;
    raw.observations[0].reviewStatus = 'reviewed';
    const missing = parseRcclDocument(JSON.stringify(raw));
    assert.equal(missing.valid, false);
    assert.ok(missing.diagnostics.some((item) => item.code === 'MISSING_APPROVAL'));

    raw.observations[0].approval = {
      approvedBy: 'test-reviewer',
      approvedAt: new Date().toISOString(),
      contentFingerprint: 'not-the-current-content',
    };
    const mismatched = parseRcclDocument(JSON.stringify(raw));
    assert.equal(mismatched.valid, false);
    assert.ok(mismatched.diagnostics.some((item) => item.code === 'APPROVAL_FINGERPRINT_MISMATCH'));
  });
});

test('decision impact remains a hard admission gate and empty final documents are valid', () => {
  withProject((root) => {
    const prepared = ready(root);
    const rejected = commitCalibration({
      projectRoot: root,
      contract: prepared.contract,
      proposal: proposal(prepared.contract, { decisionImpact: '' }),
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

function ready(root: string) {
  const result = prepareCalibration({
    projectRoot: root,
    evidenceSelections: [{ file: 'src/service.ts', lineRange: [1, 7] }],
  });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw new Error('Expected calibration contract.');
  return result;
}

function proposal(
  contract: CalibrationContract,
  overrides: Partial<CalibrationProposal['observations'][number]> = {},
): CalibrationProposal {
  return {
    schemaVersion: '1.0',
    requestId: contract.requestId,
    contextFingerprint: contract.contextFingerprint,
    observations: [{
      id: 'obs-service-boundary',
      category: 'architecture',
      scope: 'src/**',
      statement: 'Public service construction is centralized.',
      affects: ['architecture-boundary'],
      decisionImpact: 'New public services should preserve the construction boundary instead of creating a second entrypoint.',
      semanticConfidence: 'high',
      evidence: [{ windowId: contract.evidenceWindows[0].windowId }],
      ...overrides,
    }],
  };
}

function source(): string {
  return [
    'export interface Service {',
    '  run(): Promise<void>;',
    '}',
    '',
    'export function createService(): Service {',
    '  return { async run() {} };',
    '}',
    '',
  ].join('\n');
}

function withProject(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'resonant-rccl-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/service.ts'), source(), 'utf8');
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
