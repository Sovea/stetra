import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  compileChange,
  evaluateChange,
  type ChangeDecisionPacket,
  type ChangeSet,
  type CheckResult,
} from '../src/index.ts';
import { serializedBytes } from '../src/decision/budget.ts';
import { normalizeTaskContext } from '../src/task/normalize.ts';
import { stableHash } from '../src/utils/hash.ts';

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

test('standard compile reports overflow, then applies an explicit optional-guidance selection', async () => {
  const input = {
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
  } as const;
  const overflow = await compileChange(input);
  assert.equal(overflow.status, 'guidance-overflow');
  if (overflow.status !== 'guidance-overflow') return;
  assert.ok(overflow.totalBytes > overflow.byteLimit);
  assert.ok(overflow.mandatoryBytes <= overflow.byteLimit);
  assert.ok(overflow.mandatoryGuidanceIds.includes('local-runtime-compile-evaluate-boundary-01'));
  assert.ok(overflow.selectableConsider.length > 3);

  const selectedConsiderIds = [
    'bugfix-add-supporting-validation-01',
    'ts-honest-and-precise-types-01',
    'rccl:obs-runtime-public-harness-boundary',
  ];
  const output = await compileChange({
    ...input,
    deliverySelection: {
      considerIds: selectedConsiderIds,
      rationale: 'These optional items directly address the defect, its TypeScript boundary, and the repository API boundary.',
    },
  });
  assert.equal(output.status, 'compiled');
  if (output.status !== 'compiled') return;
  assert.ok(output.trace.selectedLayers.includes('builtin/task-types/bugfix'));
  assert.ok(output.guidance.required.some((item) => item.id === 'local-runtime-compile-evaluate-boundary-01'));
  assert.deepEqual(output.guidance.consider.map((item) => item.id), selectedConsiderIds);
  assert.ok(output.guidance.required.every((item) => item.executionMode === 'enforce' || item.executionMode === 'deviation-noted'));
  assert.ok(output.guidance.consider.every((item) => item.executionMode === 'ambient'));
  assert.ok(serializedBytes(output.guidance) <= 6_000);
  assert.equal(output.trace.delivery.deliveredBytes, serializedBytes(output.guidance));
  assert.equal(output.trace.delivery.selection?.rationale, 'These optional items directly address the defect, its TypeScript boundary, and the repository API boundary.');
  assert.ok(output.trace.omissions.every((item) => item.reason === 'host-selection'));
  assert.ok(output.trace.guidanceDetails.length > output.trace.deliveredGuidanceIds.length);
  assert.deepEqual(
    new Set(output.trace.deliveredGuidanceIds),
    new Set([
      ...output.guidance.required.map((item) => item.id),
      ...output.guidance.consider.map((item) => item.id),
      ...output.guidance.avoid.map((item) => item.id),
      ...output.guidance.tensions.map((item) => item.id),
    ]),
  );

  const reordered = await compileChange({
    ...input,
    deliverySelection: {
      considerIds: [...selectedConsiderIds].reverse(),
      rationale: 'These optional items directly address the defect, its TypeScript boundary, and the repository API boundary.',
    },
  });
  assert.equal(reordered.status, 'compiled');
  if (reordered.status !== 'compiled') return;
  assert.equal(reordered.decisionId, output.decisionId);
  assert.deepEqual(reordered.trace.delivery.selection, output.trace.delivery.selection);
});

test('a larger total byte ceiling delivers every eligible item without per-section caps', async () => {
  const output = await compileChange({
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    guidanceByteLimit: 100_000,
    task: {
      description: 'Fix a cache inspection bug',
      changeType: 'bugfix',
      targets: ['runtime/src/decision/compile-change.ts'],
      risk: 'low',
      scope: 'local',
    },
  });
  assert.equal(output.status, 'compiled');
  if (output.status !== 'compiled') return;
  assert.ok(output.guidance.consider.length > 3);
  assert.deepEqual(output.trace.omissions, []);
  assert.equal(output.trace.delivery.deliveredBytes, serializedBytes(output.guidance));
});

test('mandatory guidance cannot be selected away when the byte ceiling is too small', async () => {
  const output = await compileChange({
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    guidanceByteLimit: 1,
    deliverySelection: {
      considerIds: [],
      rationale: 'Exclude every optional item to isolate the mandatory packet.',
    },
    task: {
      description: 'Refactor the Runtime public boundary',
      changeType: 'refactor',
      targets: ['runtime/src/index.ts'],
      risk: 'medium',
      scope: 'module',
    },
  });
  assert.equal(output.status, 'guidance-overflow');
  if (output.status !== 'guidance-overflow') return;
  assert.ok(output.mandatoryBytes > output.byteLimit);
  assert.ok(output.mandatoryGuidanceIds.includes('refactor-preserve-intended-behavior-01'));
  assert.match(output.reasons[0], /Mandatory/);
});

test('guidance size uses UTF-8 bytes rather than JavaScript character count', () => {
  const value = { instruction: '保持接口清晰' };
  assert.equal(serializedBytes(value), Buffer.byteLength(JSON.stringify(value), 'utf8'));
  assert.ok(serializedBytes(value) > JSON.stringify(value).length);
});

test('directive delivery order follows explicit authority groups, not weight scores', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-order-'));
  const localPath = join(directory, 'local-augment.yaml');
  try {
    writeFileSync(localPath, [
      'version: "1.0"',
      'meta:',
      '  name: explicit-authority-order',
      '  extends: [builtin/core]',
      'overrides:',
      '  - supersedes: core-abstraction-follows-real-pressure-01',
      '    weight: low',
      '  - supersedes: core-clarity-and-legibility-01',
      '    weight: critical',
      'augments: []',
      'suppresses: []',
      'additions: []',
      '',
    ].join('\n'), 'utf8');
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: localPath,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Clarify the README',
        changeType: 'docs',
        targets: ['README.md'],
        risk: 'low',
        scope: 'local',
      },
    });
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
    assert.deepEqual(
      output.guidance.consider
        .filter((item) => [
          'core-abstraction-follows-real-pressure-01',
          'core-clarity-and-legibility-01',
        ].includes(item.id))
        .map((item) => item.id),
      [
        'core-abstraction-follows-real-pressure-01',
        'core-clarity-and-legibility-01',
      ],
    );
    assert.ok(output.guidance.consider
      .filter((item) => item.id.startsWith('core-'))
      .slice(0, 2)
      .every((item) => item.source.kind === 'local-playbook'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('personal overlay adds optional taste and examples without weakening team policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-personal-'));
  const teamPath = join(directory, 'team.yaml');
  const personalPath = join(directory, 'personal.yaml');
  try {
    writeFileSync(teamPath, [
      'version: "1.0"',
      'meta:',
      '  name: team-baseline',
      '  extends: [builtin/core]',
      'overrides: []',
      'augments: []',
      'suppresses: []',
      'additions:',
      '  - id: local-runtime-public-boundary-01',
      '    type: architecture',
      '    layer: local',
      '    scope: { path: "runtime/src/**" }',
      '    prescription: must',
      '    weight: critical',
      '    description: Keep the Runtime public boundary narrow.',
      '    rationale: The team supports exactly two Runtime operations.',
      '    exceptions: []',
      '    examples:',
      '      - good: { code: "compileChange(); evaluateChange();" }',
      '        note: The shared boundary remains narrow.',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(personalPath, [
      'version: "1.0"',
      'meta:',
      '  name: personal-taste',
      'augments:',
      '  - id: core-clarity-and-legibility-01',
      '    examples:',
      '      - good: { code: "const result = explain(value);" }',
      '        note: Prefer an explicit intermediate value when it clarifies intent.',
      'additions:',
      '  - id: personal-prefer-early-returns-01',
      '    type: preference',
      '    layer: personal',
      '    scope: { path: "runtime/src/**" }',
      '    prescription: should',
      '    description: Prefer early returns when they make failure paths obvious.',
      '    rationale: Flat control flow is easier for me to review.',
      '    exceptions: []',
      '    examples:',
      '      - good: { code: "if (!value) return null;" }',
      '        note: Exit an invalid path before the main behavior.',
      '',
    ].join('\n'), 'utf8');

    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: teamPath,
      personalOverlayPath: personalPath,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Refactor Runtime control flow',
        changeType: 'refactor',
        targets: ['runtime/src/index.ts'],
        risk: 'low',
        scope: 'local',
      },
    });
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
    assert.deepEqual(output.trace.playbookSources, {
      team: 'present',
      personal: 'present',
    });
    assert.equal(
      output.guidance.required.find((item) => item.id === 'local-runtime-public-boundary-01')?.executionMode,
      'enforce',
    );
    const personal = output.guidance.consider.find((item) => item.id === 'personal-prefer-early-returns-01');
    assert.equal(personal?.source.kind, 'personal-playbook');
    assert.match(personal?.example?.note ?? '', /invalid path/);
    const augmented = output.guidance.consider.find((item) => item.id === 'core-clarity-and-legibility-01');
    assert.equal(augmented?.source.kind, 'builtin-playbook');
    assert.equal(augmented?.exampleSource?.kind, 'personal-playbook');
    assert.match(augmented?.example?.note ?? '', /intermediate value/);
    assert.deepEqual(
      output.trace.guidanceDetails
        .find((item) => item.id === 'core-clarity-and-legibility-01')
        ?.contributors.map((item) => item.kind),
      ['builtin-playbook', 'personal-playbook'],
    );
    const personalIndex = output.guidance.consider.findIndex((item) => item.id === 'personal-prefer-early-returns-01');
    const builtinIndex = output.guidance.consider.findIndex((item) => item.id === 'core-abstraction-follows-real-pressure-01');
    assert.ok(personalIndex >= 0 && builtinIndex > personalIndex);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('personal overlay cannot override, suppress, score-rank, or create hard policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-invalid-personal-'));
  const personalPath = join(directory, 'personal.yaml');
  const input = {
    projectRoot,
    builtinRoot,
    personalOverlayPath: personalPath,
    task: {
      description: 'Clarify the README',
      changeType: 'docs' as const,
      targets: ['README.md'],
      risk: 'low' as const,
      scope: 'local' as const,
    },
  };
  try {
    writeFileSync(personalPath, [
      'version: "1.0"',
      'meta: { name: invalid-override }',
      'overrides: []',
      'augments: []',
      'additions: []',
      '',
    ].join('\n'), 'utf8');
    await assert.rejects(() => compileChange(input), /unsupported field.*overrides/);

    writeFileSync(personalPath, personalDirectiveYaml({
      prescription: 'must',
    }), 'utf8');
    await assert.rejects(() => compileChange(input), /prescription must be should/);

    writeFileSync(personalPath, personalDirectiveYaml({
      weight: 'critical',
    }), 'utf8');
    await assert.rejects(() => compileChange(input), /weight is not accepted/);

    writeFileSync(personalPath, personalDirectiveYaml({
      type: 'anti-pattern',
    }), 'utf8');
    await assert.rejects(() => compileChange(input), /type must be preference, convention, or architecture/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a personal augment cannot revive a directive suppressed by the team', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-personal-suppressed-'));
  const teamPath = join(directory, 'team.yaml');
  const personalPath = join(directory, 'personal.yaml');
  try {
    writeFileSync(teamPath, [
      'version: "1.0"',
      'meta:',
      '  name: team-suppression',
      '  extends: [builtin/core]',
      'overrides: []',
      'augments: []',
      'suppresses:',
      '  - id: core-clarity-and-legibility-01',
      '    reason: Generated output owns this representation.',
      'additions: []',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(personalPath, [
      'version: "1.0"',
      'meta: { name: cannot-revive }',
      'augments:',
      '  - id: core-clarity-and-legibility-01',
      '    examples:',
      '      - good: { code: "makeItClear();" }',
      '        note: Personal clarity example.',
      'additions: []',
      '',
    ].join('\n'), 'utf8');
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: teamPath,
      personalOverlayPath: personalPath,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Clarify generated documentation',
        changeType: 'docs',
        targets: ['README.md'],
        risk: 'low',
        scope: 'local',
      },
    });
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
    assert.ok(output.trace.suppressedDirectiveIds.includes('core-clarity-and-legibility-01'));
    assert.ok(!output.trace.activatedDirectiveIds.includes('core-clarity-and-legibility-01'));
    assert.ok(!output.trace.deliveredGuidanceIds.includes('core-clarity-and-legibility-01'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('personal overlay identity depends on content, not its absolute installation path', async () => {
  const firstDirectory = mkdtempSync(join(tmpdir(), 'resonant-personal-path-a-'));
  const secondDirectory = mkdtempSync(join(tmpdir(), 'resonant-personal-path-b-'));
  const firstPath = join(firstDirectory, 'personal.yaml');
  const secondPath = join(secondDirectory, 'personal.yaml');
  const content = personalDirectiveYaml({});
  try {
    writeFileSync(firstPath, content, 'utf8');
    writeFileSync(secondPath, content, 'utf8');
    const input = {
      projectRoot,
      builtinRoot,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Clarify the README',
        changeType: 'docs' as const,
        targets: ['README.md'],
        risk: 'low' as const,
        scope: 'local' as const,
      },
    };
    const first = await compileChange({ ...input, personalOverlayPath: firstPath });
    const second = await compileChange({ ...input, personalOverlayPath: secondPath });
    assert.equal(first.status, 'compiled');
    assert.equal(second.status, 'compiled');
    if (first.status !== 'compiled' || second.status !== 'compiled') return;
    assert.equal(first.decisionId, second.decisionId);
    assert.deepEqual(first.fingerprints, second.fingerprints);
    assert.deepEqual(first.trace.guidanceDetails, second.trace.guidanceDetails);
  } finally {
    rmSync(firstDirectory, { recursive: true, force: true });
    rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test('decision identity is stable across evidence re-verification timestamps', async () => {
  const first = await compileRuntimeRefactor();
  const second = await compileRuntimeRefactor();
  assert.equal(first.status, 'compiled');
  assert.equal(second.status, 'compiled');
  if (first.status !== 'compiled' || second.status !== 'compiled') return;
  assert.equal(first.decisionId, second.decisionId);
  assert.deepEqual(first.fingerprints, second.fingerprints);
  assert.deepEqual(first.guidance, second.guidance);
});

test('local suppressions remain visible in Decision Trace', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-suppress-'));
  const localPath = join(directory, 'local-augment.yaml');
  try {
    writeFileSync(localPath, [
      'version: "1.0"',
      'meta:',
      '  name: trace-suppression',
      '  extends: [builtin/core]',
      'overrides: []',
      'augments: []',
      'suppresses:',
      '  - id: core-clarity-and-legibility-01',
      '    reason: The project uses a generated representation for this target.',
      'additions: []',
      '',
    ].join('\n'), 'utf8');
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: localPath,
      task: {
        description: 'Clarify one generated document',
        changeType: 'docs',
        targets: ['README.md'],
        risk: 'low',
        scope: 'local',
      },
    });
    assert.notEqual(output.status, 'needs-interpretation');
    if (output.status === 'needs-interpretation') return;
    assert.ok(output.trace.suppressedDirectiveIds.includes('core-clarity-and-legibility-01'));
    assert.ok(!output.trace.activatedDirectiveIds.includes('core-clarity-and-legibility-01'));
    assert.ok(!output.trace.deliveredGuidanceIds.includes('core-clarity-and-legibility-01'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unreviewed RCCL anti-pattern remains ambient and cannot become a hard avoid item', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-ambient-antipattern-'));
  const rcclPath = join(directory, 'rccl.json');
  try {
    writeRcclFixture(rcclPath, {
      id: 'obs-generated-antipattern',
      category: 'anti-pattern',
      scope: 'runtime/src/**',
      statement: 'The generated host claims this public boundary is an anti-pattern.',
      affects: ['review-focus'],
      decisionImpact: 'If true, a reviewer might choose a different public boundary.',
      semanticConfidence: 'low',
      evidence: [{
        file: 'runtime/src/index.ts',
        lineRange: [1, 1],
        snippet: '/** resonant-code Runtime public change-harness boundary. */',
      }],
    });
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      rcclPath,
      deliverySelection: {
        considerIds: ['rccl:obs-generated-antipattern'],
        rationale: 'The test must inspect the generated RCCL item while excluding unrelated optional guidance.',
      },
      task: {
        description: 'Refactor the Runtime public boundary',
        changeType: 'refactor',
        targets: ['runtime/src/index.ts'],
        risk: 'medium',
        scope: 'module',
      },
    });
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
    assert.ok(output.guidance.consider.some((item) => item.id === 'rccl:obs-generated-antipattern'));
    assert.ok(!output.guidance.avoid.some((item) => item.id === 'rccl:obs-generated-antipattern'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('current RCCL context changes execution only after independent approval and an accepted relation', async () => {
  const base = await compileRuntimeRefactor();
  assert.equal(base.status, 'compiled');
  if (base.status !== 'compiled') return;
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
  assert.equal(related.status, 'compiled');
  if (related.status !== 'compiled') return;
  assert.equal(
    related.guidance.required.find((item) => item.id === 'local-runtime-compile-evaluate-boundary-01')?.executionMode,
    'enforce',
  );
  assert.equal(related.guidance.tensions.length, 0);
  assert.ok(related.trace.relationDecisions.some((item) => item.status === 'downgraded'));

  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-approved-'));
  const rcclPath = join(directory, 'rccl.json');
  try {
    writeRcclFixture(rcclPath, runtimeBoundaryObservation(), { reviewed: true });
    const approved = await compileRuntimeRefactor([{
      directiveId: 'local-runtime-compile-evaluate-boundary-01',
      observationId: 'obs-runtime-public-harness-boundary',
      relation: 'limits',
      rationale: 'The narrow public API limits how the local hard boundary can be extended.',
      evidenceRefs: ['runtime/src/index.ts:1-17'],
      confidence: 0.9,
    }], rcclPath);
    assert.equal(approved.status, 'compiled');
    if (approved.status !== 'compiled') return;
    const directive = approved.guidance.required.find((item) => item.id === 'local-runtime-compile-evaluate-boundary-01');
    assert.equal(directive?.executionMode, 'deviation-noted');
    assert.equal(approved.guidance.tensions.length, 1);
    assert.ok(approved.trace.relationDecisions.some((item) =>
      item.status === 'accepted' && item.impact === 'execution-mode'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  assert.notEqual(invalid.status, 'guidance-overflow');
  assert.notEqual(invalid.status, 'needs-interpretation');
  if (invalid.status === 'guidance-overflow' || invalid.status === 'needs-interpretation') return;
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
  assert.notEqual(immune.status, 'guidance-overflow');
  assert.notEqual(immune.status, 'needs-interpretation');
  if (immune.status === 'guidance-overflow' || immune.status === 'needs-interpretation') return;
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
    writeRcclFixture(rcclPath, {
      id: 'obs-stale-runtime-boundary',
      category: 'architecture',
      scope: 'runtime/src/**',
      statement: 'The Runtime has a narrow public boundary.',
      affects: ['api-shape'],
      decisionImpact: 'Adding unrelated public helpers would expand the supported API.',
      semanticConfidence: 'high',
      evidence: [{
        file: 'runtime/src/index.ts',
        lineRange: [1, 1],
        snippet: 'source that no longer exists',
      }],
    }, { reviewed: true });
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
      rcclPath,
      deliverySelection: {
        considerIds: ['rccl:obs-stale-runtime-boundary'],
        rationale: 'Deliver the stale observation so the test can verify that it remains ambient.',
      },
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
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
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
    writeRcclFixture(rcclPath, runtimeBoundaryObservation({ semanticConfidence: 'low' }));
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
      rcclPath,
      deliverySelection: {
        considerIds: ['rccl:obs-runtime-public-harness-boundary'],
        rationale: 'Deliver the unreviewed observation so its assurance gates remain inspectable.',
      },
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
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
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
  const changes = machineChangeSet([
    { path: 'runtime/src/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'failed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:index', file: 'runtime/src/index.ts' }],
      explanation: 'The entrypoint diff preserves the narrow public surface.',
      attestedBy: 'test-host',
    }],
  });
  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.operation, 'modify');
  assert.equal(evaluation.results[0].verdict, 'violated');
  assert.equal(evaluation.assurance.machineFacts.changedFileCount, 1);
});

test('a missing configured command cannot produce an accepted result', () => {
  const decision = minimalDecision('standard');
  const changes = machineChangeSet([
    { path: 'runtime/src/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [{
      id: 'typecheck',
      status: 'skipped',
      command: [],
      exitCode: null,
      outputDigest: stableHash(['typecheck', 'not-configured']),
      reason: 'No explicit command is configured for verification check "typecheck".',
      provenance: {
        source: 'resonant-code-workflow',
        collectionId: changes.provenance.collectionId,
      },
    }],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:index', file: 'runtime/src/index.ts' }],
      explanation: 'The entrypoint diff looks correct, but the command fact is unavailable.',
      attestedBy: 'test-host',
    }],
  });
  assert.equal(evaluation.status, 'warning');
  assert.equal(evaluation.results[0].verdict, 'partial');
  assert.match(evaluation.results[0].reasons[0], /command:typecheck/);
});

test('postflight evaluation combines machine facts with attestations only for delivered guidance', () => {
  const decision = minimalDecision('standard');
  const changes = machineChangeSet([
    { path: 'runtime/src/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'passed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        { kind: 'diff', ref: 'diff:index', file: 'runtime/src/index.ts' },
        { kind: 'check', ref: 'check:typecheck', checkId: 'typecheck' },
      ],
      explanation: 'The changed entrypoint still exports only the intended Runtime operations.',
      attestedBy: 'test-host',
    }],
  });
  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.results[0].verdict, 'satisfied');
  assert.equal(evaluation.summary.requiredSatisfied, 1);
  assert.equal(evaluation.assurance.hostAttestationCount, 1);
  assert.deepEqual(evaluation.changes.files, changes.files);

  assert.throws(() => evaluateChange({
    decision,
    changes: machineChangeSet([]),
    attestations: [{
      guidanceId: 'not-delivered',
      verdict: 'satisfied',
      evidenceRefs: [],
      explanation: 'This ID was not part of the decision.',
      attestedBy: 'test-host',
    }],
  }), /was not delivered/);
});

test('fact-backed attestation feedback is idempotent and unverified guidance is not recorded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'resonant-feedback-'));
  const feedbackPath = join(directory, 'verified-events.jsonl');
  try {
    const changes = machineChangeSet([
      { path: 'runtime/src/index.ts', status: 'modified' },
    ]);
    const input = {
      decision: minimalDecision('standard'),
      changes,
      checks: [machineCheck(changes, 'typecheck', 'passed')],
      attestations: [{
        guidanceId: 'required-1',
        verdict: 'satisfied' as const,
        evidenceRefs: [
          { kind: 'diff' as const, ref: 'diff:index', file: 'runtime/src/index.ts' },
          { kind: 'check' as const, ref: 'check:typecheck', checkId: 'typecheck' },
        ],
        explanation: 'The machine-collected diff and check support the narrow boundary.',
        attestedBy: 'test-host',
      }],
      feedbackPath,
    };
    assert.equal(evaluateChange(input).feedback?.recorded, 1);
    assert.equal(evaluateChange(input).feedback?.recorded, 0);
    assert.equal(readFileSync(feedbackPath, 'utf8').trim().split('\n').length, 1);

    const unverifiedPath = join(directory, 'unverified.jsonl');
    const unverified = evaluateChange({
      decision: minimalDecision('standard'),
      changes: machineChangeSet([]),
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
    changes: machineChangeSet([
      { path: 'runtime/src/index.ts', status: 'modified' },
    ]),
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

  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    task: {
      description: 'Fix one bug',
      changeType: 'bugfix',
      targets: ['runtime/src/index.ts'],
    },
    deliverySelection: {
      considerIds: ['not-active'],
      rationale: 'Exercise delivery selection validation.',
    },
  }), /inactive consider guidance/);

  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    guidanceByteLimit: 0,
    task: {
      description: 'Fix one bug',
      changeType: 'bugfix',
      targets: ['runtime/src/index.ts'],
    },
  }), /positive integer/);

  assert.throws(() => evaluateChange({
    decision: minimalDecision('standard'),
    changes: machineChangeSet([]),
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: {} as never,
      explanation: 'Malformed evidence reference collection.',
      attestedBy: 'test-host',
    }],
  }), /attestation evidenceRefs must be an array/);

  assert.throws(() => evaluateChange({
    decision: minimalDecision('standard'),
    changes: { files: [] } as never,
  }), /workflow machine provenance/);

  const inconsistent = machineChangeSet([]);
  inconsistent.changeFingerprint = 'host-declared-clean';
  assert.throws(() => evaluateChange({
    decision: minimalDecision('standard'),
    changes: inconsistent,
  }), /changeFingerprint does not match/);
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
        exceptions: [],
        source: { kind: 'builtin-playbook', id: 'test' },
        executionMode: 'enforce',
        verification: [
          { kind: 'diff', description: 'Inspect the entrypoint diff.' },
          { kind: 'command', commandId: 'typecheck', description: 'Run typecheck.' },
        ],
      }],
      consider: [],
      avoid: [],
      tensions: [],
    },
    verificationPlan: { commands: [{ id: 'typecheck', reason: 'Run typecheck.' }], semanticChecks: [] },
    trace: {
      selectedLayers: ['builtin/core'],
      playbookSources: { team: 'absent', personal: 'absent' },
      activatedDirectiveIds: ['required-1'],
      deliveredGuidanceIds: ['required-1'],
      suppressedDirectiveIds: [],
      relevantObservationIds: [],
      observationEvidence: [],
      relationDecisions: [],
      guidanceDetails: [{
        id: 'required-1',
        section: 'required',
        rationale: 'Callers should depend on a stable boundary.',
        relevance: 'The entrypoint is being changed.',
        source: { kind: 'builtin-playbook', id: 'test', logicalPath: 'test' },
        contributors: [{ kind: 'builtin-playbook', id: 'test', logicalPath: 'test' }],
        examples: [],
      }],
      delivery: {
        byteLimit: 6_000,
        deliveredBytes: 1,
        mandatoryBytes: 1,
        selection: null,
      },
      omissions: [],
      diagnostics: [],
    },
    fingerprints: {
      task: 'task',
      directives: 'directives',
      observations: 'observations',
      relations: 'relations',
      delivery: 'delivery',
    },
  };
}

type RcclFixtureContent = {
  id: string;
  category: 'architecture' | 'constraint' | 'compatibility' | 'legacy' | 'anti-pattern' | 'migration' | 'convention';
  scope: string;
  statement: string;
  affects: Array<'compatibility' | 'api-shape' | 'architecture-boundary' | 'data-flow' | 'migration' | 'testing' | 'error-handling' | 'module-format' | 'review-focus'>;
  decisionImpact: string;
  semanticConfidence: 'low' | 'medium' | 'high';
  evidence: Array<{ file: string; lineRange: [number, number]; snippet: string }>;
};

function runtimeBoundaryObservation(
  overrides: Partial<RcclFixtureContent> = {},
): RcclFixtureContent {
  return {
    id: 'obs-runtime-public-harness-boundary',
    category: 'architecture',
    scope: 'runtime/src/**',
    statement: 'The Runtime public value API is limited to compileChange and evaluateChange.',
    affects: ['api-shape', 'architecture-boundary'],
    decisionImpact: 'Adding workflow-specific helpers would expand the supported Runtime API boundary.',
    semanticConfidence: 'high',
    evidence: [{
      file: 'runtime/src/index.ts',
      lineRange: [1, 17],
      snippet: exactSourceWindow('runtime/src/index.ts', 1, 17),
    }],
    ...overrides,
  };
}

function writeRcclFixture(
  path: string,
  content: RcclFixtureContent,
  options: { reviewed?: boolean } = {},
): void {
  const normalized = {
    ...content,
    scope: content.scope.replace(/\\/g, '/'),
    statement: content.statement.trim(),
    affects: [...new Set(content.affects)].sort(),
    decisionImpact: content.decisionImpact.trim(),
    evidence: content.evidence.map((evidence) => ({
      ...evidence,
      file: evidence.file.replace(/\\/g, '/'),
    })),
  };
  const contentFingerprint = createHash('sha256').update(JSON.stringify({
    id: normalized.id,
    category: normalized.category,
    scope: normalized.scope,
    statement: normalized.statement,
    affects: normalized.affects,
    decisionImpact: normalized.decisionImpact,
    semanticConfidence: normalized.semanticConfidence,
    evidence: normalized.evidence,
  })).digest('hex');
  const reviewed = options.reviewed === true;
  const timestamp = '2026-07-25T00:00:00.000Z';
  writeFileSync(path, JSON.stringify({
    version: '1.0',
    generatedAt: timestamp,
    gitRef: null,
    observations: [{
      ...normalized,
      reviewStatus: reviewed ? 'reviewed' : 'generated',
      ...(reviewed ? {
        approval: {
          approvedBy: 'runtime-test-reviewer',
          approvedAt: timestamp,
          contentFingerprint,
        },
      } : {}),
      evidenceVerification: {
        status: 'current',
        verifiedCount: normalized.evidence.length,
        totalCount: normalized.evidence.length,
        checkedAt: timestamp,
      },
      lifecycle: {
        status: 'active',
        contentFingerprint,
        firstSeenGitRef: null,
        lastSeenGitRef: null,
        lastVerifiedAt: timestamp,
      },
    }],
  }), 'utf8');
}

function exactSourceWindow(file: string, start: number, end: number): string {
  return readFileSync(resolve(projectRoot, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(start - 1, end)
    .join('\n');
}

function compileRuntimeRefactor(
  relationProposals: Parameters<typeof compileChange>[0]['relationProposals'] = [],
  rcclPath = resolve(projectRoot, '.resonant-code/rccl.yaml'),
) {
  return compileChange({
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
    relationProposals,
    deliverySelection: {
      considerIds: [
        'refactor-keep-verifiable-01',
        'ts-explicit-public-interfaces-01',
        'rccl:obs-runtime-public-harness-boundary',
      ],
      rationale: 'These optional items cover verifiability, the public TypeScript contract, and the observed Runtime boundary.',
    },
  });
}

function machineChangeSet(
  inputs: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    previousPath?: string;
  }>,
): ChangeSet {
  const files = inputs.map((input) => {
    const before = {
      kind: 'file' as const,
      contentHash: stableHash([input.previousPath ?? input.path, 'before']),
      mode: '100644',
    };
    const after = {
      kind: 'file' as const,
      contentHash: stableHash([input.path, 'after']),
      mode: '100644',
    };
    if (input.status === 'added') return { ...input, after };
    if (input.status === 'deleted') return { ...input, before };
    return { ...input, before, after };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const baselineFingerprint = stableHash(['test-baseline', files.map((item) => item.before)]);
  const currentFingerprint = stableHash(['test-current', files.map((item) => item.after)]);
  const changeFingerprint = stableHash([files]);
  const collectionId = stableHash([
    baselineFingerprint,
    currentFingerprint,
    changeFingerprint,
  ]);
  return {
    files,
    baselineFingerprint,
    currentFingerprint,
    changeFingerprint,
    baselineHead: 'baseline-head',
    currentHead: 'current-head',
    provenance: {
      source: 'resonant-code-workflow',
      collectionId,
    },
  };
}

function machineCheck(
  changes: ChangeSet,
  id: string,
  status: 'passed' | 'failed',
): CheckResult {
  return {
    id,
    status,
    command: ['test-check', id],
    exitCode: status === 'passed' ? 0 : 1,
    outputDigest: stableHash([id, status]),
    outputRefs: {
      stdout: `check-output/${id}.stdout.log`,
      stderr: `check-output/${id}.stderr.log`,
    },
    definitionFingerprint: stableHash([id, 'definition']),
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: changes.provenance.collectionId,
    },
  };
}

function personalDirectiveYaml(options: {
  prescription?: string;
  type?: string;
  weight?: string;
}): string {
  return [
    'version: "1.0"',
    'meta: { name: personal-test }',
    'augments: []',
    'additions:',
    '  - id: personal-readable-docs-01',
    `    type: ${options.type ?? 'preference'}`,
    '    layer: personal',
    '    scope: { path: "README.md" }',
    `    prescription: ${options.prescription ?? 'should'}`,
    ...(options.weight ? [`    weight: ${options.weight}`] : []),
    '    description: Prefer short paragraphs in user-facing documentation.',
    '    rationale: Short paragraphs are easier for me to scan.',
    '    exceptions: []',
    '    examples:',
    '      - good: { code: "One idea per paragraph." }',
    '        note: Keep each paragraph focused.',
    '',
  ].join('\n');
}
