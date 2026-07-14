import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  compileChange,
  evaluateChange,
  type ChangeDecisionPacket,
} from '../src/index.ts';
import { normalizeTaskContext } from '../src/task/normalize.ts';

const projectRoot = resolve(import.meta.dirname, '../..');
const builtinRoot = resolve(projectRoot, 'playbook');

test('canonical task context treats bugfix as change type and infers mechanical context separately', () => {
  const task = normalizeTaskContext({
    description: 'Fix a cache inspection bug',
    changeType: 'bugfix',
    targets: ['runtime/src/decision/compile-change.ts'],
  });
  assert.equal(task.changeType, 'bugfix');
  assert.equal(task.scope, 'local');
  assert.equal(task.risk, 'low');
  assert.deepEqual(task.techStack, ['typescript']);
  assert.equal('operation' in task, false);
});

test('standard compile activates task layer and emits bounded behavioral guidance', async () => {
  const output = await compileChange({
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    task: {
      description: 'Fix a cache inspection bug',
      changeType: 'bugfix',
      targets: ['runtime/src/decision/compile-change.ts'],
      risk: 'low',
      scope: 'local',
    },
  });
  assert.notEqual(output.status, 'needs-interpretation');
  if (output.status === 'needs-interpretation') return;
  assert.equal(output.status, 'compiled');
  assert.ok(output.trace.selectedLayers.includes('builtin/task-types/bugfix'));
  assert.ok(output.guidance.required.some((item) => item.id === 'local-runtime-compile-evaluate-boundary-01'));
  assert.ok(output.guidance.required.length <= 3);
  assert.ok(output.guidance.consider.length <= 3);
  assert.ok(output.guidance.avoid.length <= 2);
  assert.ok(output.guidance.tensions.length <= 2);
  assert.ok(output.guidance.required.every((item) => item.executionMode === 'enforce' || item.executionMode === 'deviation-noted'));
  assert.ok(output.guidance.consider.every((item) => item.executionMode === 'ambient'));
  assert.ok(JSON.stringify(output.guidance).length <= 6_000);
  assert.deepEqual(
    new Set(output.trace.deliveredGuidanceIds),
    new Set([
      ...output.guidance.required.map((item) => item.id),
      ...output.guidance.consider.map((item) => item.id),
      ...output.guidance.avoid.map((item) => item.id),
      ...output.guidance.tensions.map((item) => item.id),
    ]),
  );
});

test('current RCCL context is ambient until an evidence-backed semantic relation changes execution', async () => {
  const base = await compileRuntimeRefactor();
  assert.notEqual(base.status, 'needs-interpretation');
  if (base.status === 'needs-interpretation') return;
  assert.deepEqual(base.trace.relevantObservationIds, ['obs-runtime-public-harness-boundary']);
  assert.ok(base.guidance.consider.some((item) => item.id === 'rccl:obs-runtime-public-harness-boundary'));
  assert.equal(base.guidance.tensions.length, 0);
  assert.ok(base.trace.diagnostics.some((item) => item.code === 'RCCL_NO_DECISION_IMPACT'));

  const related = await compileRuntimeRefactor([{
    directiveId: 'local-runtime-compile-evaluate-boundary-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'limits',
    rationale: 'The narrow public API limits how the local hard boundary can be extended.',
    evidenceRefs: ['runtime/src/index.ts:1-17'],
    confidence: 0.9,
  }]);
  assert.notEqual(related.status, 'needs-interpretation');
  if (related.status === 'needs-interpretation') return;
  const directive = related.guidance.required.find((item) => item.id === 'local-runtime-compile-evaluate-boundary-01');
  assert.equal(directive?.executionMode, 'deviation-noted');
  assert.equal(related.guidance.tensions.length, 1);
  assert.ok(related.trace.relationDecisions.some((item) => item.status === 'accepted' && item.impact === 'execution-mode'));
});

test('invalid and irrelevant relation proposals cannot affect execution', async () => {
  const invalid = await compileRuntimeRefactor([{
    directiveId: 'local-runtime-compile-evaluate-boundary-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'conflicts',
    rationale: 'Claimed conflict without cited observation evidence.',
    evidenceRefs: ['README.md:1-1'],
    confidence: 0.9,
  }]);
  assert.notEqual(invalid.status, 'needs-interpretation');
  if (invalid.status === 'needs-interpretation') return;
  assert.equal(invalid.status, 'needs-attention');
  assert.equal(invalid.guidance.tensions.length, 0);
  assert.ok(invalid.trace.diagnostics.some((item) => item.code === 'RELATION_PROPOSAL_REJECTED'));

  const immune = await compileRuntimeRefactor([{
    directiveId: 'refactor-preserve-intended-behavior-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'limits',
    rationale: 'A repository boundary must not soften behavior preservation.',
    evidenceRefs: ['runtime/src/index.ts:1-17'],
    confidence: 0.9,
  }]);
  assert.notEqual(immune.status, 'needs-interpretation');
  if (immune.status === 'needs-interpretation') return;
  assert.equal(immune.status, 'needs-attention');
  assert.ok(immune.trace.diagnostics.some((item) => item.message.includes('RCCL-immune')));

  const irrelevant = await compileChange({
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    task: {
      description: 'Clarify the public README',
      changeType: 'docs',
      targets: ['README.md'],
      risk: 'low',
      scope: 'local',
    },
  });
  assert.notEqual(irrelevant.status, 'needs-interpretation');
  if (irrelevant.status === 'needs-interpretation') return;
  assert.deepEqual(irrelevant.trace.relevantObservationIds, []);
  assert.deepEqual(irrelevant.trace.observationEvidence, []);
});

test('evidence drift downgrades a valid semantic relation to ambient context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-stale-'));
  const rcclPath = join(directory, 'rccl.json');
  try {
    writeFileSync(rcclPath, JSON.stringify({
      version: '1.0',
      generatedAt: '2026-07-14T00:00:00.000Z',
      gitRef: null,
      observations: [{
        id: 'obs-stale-runtime-boundary',
        category: 'architecture',
        scope: 'runtime/src/**',
        statement: 'The Runtime has a narrow public boundary.',
        affects: ['api-shape'],
        decisionImpact: 'Adding unrelated public helpers would expand the supported API.',
        semanticConfidence: 'high',
        reviewStatus: 'reviewed',
        evidence: [{ file: 'runtime/src/index.ts', lineRange: [1, 1], snippet: 'source that no longer exists' }],
        evidenceVerification: { status: 'current', verifiedCount: 1, totalCount: 1, checkedAt: '2026-07-14T00:00:00.000Z' },
        lifecycle: {
          status: 'active',
          contentFingerprint: 'stale-test',
          firstSeenGitRef: null,
          lastSeenGitRef: null,
          lastVerifiedAt: '2026-07-14T00:00:00.000Z',
        },
      }],
    }), 'utf8');
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
      rcclPath,
      task: {
        description: 'Refactor the Runtime public boundary',
        changeType: 'refactor',
        targets: ['runtime/src/index.ts'],
        risk: 'medium',
        scope: 'module',
      },
      relationProposals: [{
        directiveId: 'local-runtime-compile-evaluate-boundary-01',
        observationId: 'obs-stale-runtime-boundary',
        relation: 'conflicts',
        rationale: 'This would matter if the cited evidence were still current.',
        evidenceRefs: ['runtime/src/index.ts:1-1'],
        confidence: 0.9,
      }],
    });
    assert.notEqual(output.status, 'needs-interpretation');
    if (output.status === 'needs-interpretation') return;
    assert.equal(output.trace.observationEvidence[0].status, 'stale');
    assert.equal(output.trace.relationDecisions[0].status, 'downgraded');
    assert.equal(output.guidance.tensions.length, 0);
    assert.equal(
      output.guidance.required.find((item) => item.id === 'local-runtime-compile-evaluate-boundary-01')?.executionMode,
      'enforce',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('current evidence does not turn an unreviewed low-confidence observation into policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-unreviewed-'));
  const rcclPath = join(directory, 'rccl.yaml');
  try {
    const unreviewed = readFileSync(resolve(projectRoot, '.resonant-code/rccl.yaml'), 'utf8')
      .replace('semanticConfidence: high', 'semanticConfidence: low')
      .replace('reviewStatus: reviewed', 'reviewStatus: generated');
    writeFileSync(rcclPath, unreviewed, 'utf8');
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
      rcclPath,
      task: {
        description: 'Refactor the Runtime public boundary',
        changeType: 'refactor',
        targets: ['runtime/src/index.ts'],
        risk: 'medium',
        scope: 'module',
      },
      relationProposals: [{
        directiveId: 'local-runtime-compile-evaluate-boundary-01',
        observationId: 'obs-runtime-public-harness-boundary',
        relation: 'limits',
        rationale: 'The claim is plausible but has not met the semantic assurance gate.',
        evidenceRefs: ['runtime/src/index.ts:1-17'],
        confidence: 0.9,
      }],
    });
    assert.notEqual(output.status, 'needs-interpretation');
    if (output.status === 'needs-interpretation') return;
    assert.equal(output.trace.observationEvidence[0].status, 'current');
    assert.equal(output.trace.relationDecisions[0].status, 'downgraded');
    assert.equal(output.guidance.tensions.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('strict ambiguous tasks request only the missing interpretation fields', async () => {
  const output = await compileChange({
    projectRoot,
    builtinRoot,
    mode: 'strict',
    task: { description: 'Change the implementation' },
  });
  assert.equal(output.status, 'needs-interpretation');
  if (output.status !== 'needs-interpretation') return;
  assert.deepEqual(output.requiredFields, ['changeType', 'targets']);
});

test('postflight evaluation rejects a failed required command', () => {
  const decision = minimalDecision('standard');
  const evaluation = evaluateChange({
    decision,
    changes: { files: [{ path: 'runtime/src/index.ts', status: 'modified' }] },
    checks: [{ id: 'typecheck', status: 'failed', outputRef: 'check:typecheck' }],
    evidence: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:index', file: 'runtime/src/index.ts' }],
    }],
  });
  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.operation, 'modify');
  assert.equal(evaluation.results[0].verdict, 'violated');
});

test('postflight evaluation accepts evidence only for delivered guidance', () => {
  const decision = minimalDecision('standard');
  const evaluation = evaluateChange({
    decision,
    changes: { files: [{ path: 'runtime/src/index.ts', status: 'modified' }] },
    checks: [{ id: 'typecheck', status: 'passed', outputRef: 'check:typecheck' }],
    evidence: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        { kind: 'diff', ref: 'diff:index', file: 'runtime/src/index.ts' },
        { kind: 'check', ref: 'check:typecheck', checkId: 'typecheck' },
      ],
    }],
  });
  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.results[0].verdict, 'satisfied');
  assert.equal(evaluation.summary.requiredSatisfied, 1);

  assert.throws(() => evaluateChange({
    decision,
    changes: { files: [] },
    evidence: [{ guidanceId: 'not-delivered', verdict: 'satisfied', evidenceRefs: [] }],
  }), /was not delivered/);
});

test('evidence-backed feedback is idempotent and unverified guidance is not recorded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-feedback-'));
  const feedbackPath = join(directory, 'verified-events.jsonl');
  try {
    const input = {
      decision: minimalDecision('standard'),
      changes: { files: [{ path: 'runtime/src/index.ts', status: 'modified' as const }] },
      checks: [{ id: 'typecheck', status: 'passed' as const, outputRef: 'check:typecheck' }],
      evidence: [{
        guidanceId: 'required-1',
        verdict: 'satisfied' as const,
        evidenceRefs: [
          { kind: 'diff' as const, ref: 'diff:index', file: 'runtime/src/index.ts' },
          { kind: 'check' as const, ref: 'check:typecheck', checkId: 'typecheck' },
        ],
      }],
      feedbackPath,
    };
    assert.equal(evaluateChange(input).feedback?.recorded, 1);
    assert.equal(evaluateChange(input).feedback?.recorded, 0);
    assert.equal(readFileSync(feedbackPath, 'utf8').trim().split('\n').length, 1);

    const unverifiedPath = join(directory, 'unverified.jsonl');
    const unverified = evaluateChange({
      decision: minimalDecision('standard'),
      changes: { files: [] },
      feedbackPath: unverifiedPath,
    });
    assert.equal(unverified.feedback?.recorded, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('strict mode requires an exception for unverified required guidance', () => {
  const evaluation = evaluateChange({
    decision: minimalDecision('strict'),
    changes: { files: [{ path: 'runtime/src/index.ts', status: 'modified' }] },
  });
  assert.equal(evaluation.status, 'exception-required');
  assert.equal(evaluation.results[0].verdict, 'unverified');
});

test('public boundaries reject malformed host artifacts without type errors', async () => {
  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    task: { description: 'Fix one bug', changeType: 'bugfix', targets: ['runtime/src/index.ts'] },
    relationProposals: 'not-an-array' as never,
  }), /relationProposals must be an array/);

  assert.throws(() => evaluateChange({
    decision: minimalDecision('standard'),
    changes: { files: [] },
    evidence: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: {} as never,
    }],
  }), /evidenceRefs must be an array/);
});

function minimalDecision(mode: 'standard' | 'strict'): ChangeDecisionPacket {
  return {
    schemaVersion: '1.0',
    decisionId: `decision-${mode}`,
    status: 'compiled',
    mode,
    task: normalizeTaskContext({
      description: 'Modify the Runtime entrypoint',
      changeType: 'refactor',
      targets: ['runtime/src/index.ts'],
      risk: 'low',
      scope: 'local',
    }),
    guidance: {
      required: [{
        id: 'required-1',
        instruction: 'Keep the public entrypoint narrow.',
        rationale: 'Callers should depend on a stable boundary.',
        exceptions: [],
        source: { kind: 'builtin-playbook', id: 'test' },
        relevance: 'The entrypoint is being changed.',
        executionMode: 'enforce',
        verification: [
          { kind: 'diff', description: 'Inspect the entrypoint diff.' },
          { kind: 'command', commandId: 'typecheck', description: 'Run typecheck.' },
        ],
        examples: [],
      }],
      consider: [],
      avoid: [],
      tensions: [],
    },
    verificationPlan: { commands: [{ id: 'typecheck', reason: 'Run typecheck.' }], semanticChecks: [] },
    trace: {
      selectedLayers: ['builtin/core'],
      activatedDirectiveIds: ['required-1'],
      deliveredGuidanceIds: ['required-1'],
      suppressedDirectiveIds: [],
      relevantObservationIds: [],
      observationEvidence: [],
      relationDecisions: [],
      omissions: [],
      diagnostics: [],
    },
    fingerprints: { task: 'task', directives: 'directives', observations: 'observations', relations: 'relations' },
  };
}

function compileRuntimeRefactor(relationProposals: Parameters<typeof compileChange>[0]['relationProposals'] = []) {
  return compileChange({
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    task: {
      description: 'Refactor the Runtime public boundary',
      changeType: 'refactor',
      targets: ['runtime/src/index.ts'],
      risk: 'medium',
      scope: 'module',
    },
    relationProposals,
  });
}
