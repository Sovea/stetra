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
import {
  applyGuidanceDelivery,
  serializedBytes,
  toExecutionGuidance,
} from '../src/runtime/decision/budget.ts';
import { normalizeTaskContext } from '../src/runtime/task/normalize.ts';
import { stableHash } from '../src/runtime/utils/hash.ts';
import { scopeOverlapsPath } from '../src/runtime/utils/paths.ts';

const projectRoot = resolve(import.meta.dirname, '../../..');
const builtinRoot = resolve(import.meta.dirname, '../assets/playbook');

test('canonical task context preserves semantic authority and infers only mechanical context', () => {
  const task = normalizeTaskContext({
    description: 'Fix a cache inspection bug',
    changeType: 'bugfix',
    targets: ['packages/core/src/runtime/decision/compile-change.ts'],
    risk: 'medium',
    scope: 'module',
    constraints: ['Preserve the public API.'],
    provenance: {
      description: 'human-stated',
      changeType: 'agent-inferred',
      targets: {
        'packages/core/src/runtime/decision/compile-change.ts': 'repository-derived',
      },
      risk: 'agent-inferred',
      scope: 'agent-inferred',
      constraints: {
        'Preserve the public API.': 'human-confirmed',
      },
    },
  });
  assert.equal(task.changeType, 'bugfix');
  assert.equal(task.scope, 'module');
  assert.equal(task.risk, 'medium');
  assert.deepEqual(task.techStack, ['typescript']);
  assert.equal(
    task.provenance.find((item) => item.field === 'description')?.source,
    'human-stated',
  );
  assert.equal(
    task.provenance.find((item) => item.field === 'changeType')?.source,
    'agent-inferred',
  );
  assert.equal(
    task.provenance.find((item) => item.field === 'targets')?.source,
    'repository-derived',
  );
  assert.equal(
    task.provenance.find((item) => item.field === 'constraints')?.source,
    'human-confirmed',
  );
  assert.equal(
    task.provenance.find((item) => item.field === 'techStack')?.source,
    'deterministic',
  );
  assert.equal('operation' in task, false);
  assert.ok(task.provenance.every((item) => !('confidence' in item)));
  assert.throws(() => normalizeTaskContext({
    description: 'Fix a cache inspection bug',
    changeType: 'bugfix',
    targets: ['packages/core/src/runtime/decision/compile-change.ts'],
    risk: 'medium',
    scope: 'module',
    provenance: {
      changeType: 'deterministic',
    },
  } as never), /task\.provenance\.changeType/);
  assert.throws(() => normalizeTaskContext({
    description: 'Fix a cache inspection bug',
    targets: ['packages/core/src/runtime/decision/compile-change.ts'],
    risk: 'medium',
    scope: 'module',
  } as never), /task\.changeType/);
});

test('canonical technology IDs and symmetric scope overlap activate directory policy deterministically', async () => {
  const task = normalizeTaskContext({
    description: 'Add a nested TypeScript feature',
    changeType: 'feature',
    targets: ['src\\nested'],
    techStack: [' TypeScript ', 'typescript'],
    risk: 'low',
    scope: 'module',
  });
  assert.deepEqual(task.targets, ['src/nested']);
  assert.deepEqual(task.techStack, ['typescript']);
  assert.equal(scopeOverlapsPath('src/**', 'src'), true);
  assert.equal(scopeOverlapsPath('src/nested/example.ts', 'src\\nested'), true);
  assert.equal(scopeOverlapsPath('**/*.{ts,tsx}', 'src/nested'), true);
  assert.equal(scopeOverlapsPath('src/*/example.ts', 'src/deep/nested'), false);
  assert.equal(scopeOverlapsPath('src/**', 'test/example.ts'), false);

  const directory = mkdtempSync(join(tmpdir(), 'resonant-runtime-scope-overlap-'));
  const localPath = join(directory, 'local-augment.yaml');
  try {
    writeFileSync(localPath, [
      'version: "1.0"',
      'meta:',
      '  name: scope-overlap',
      '  extends: [builtin/core]',
      'overrides: []',
      'augments: []',
      'suppresses: []',
      'additions:',
      '  - id: local-nested-glob-01',
      '    type: constraint',
      '    layer: local',
      '    scope: { path: "src/**" }',
      '    prescription: must',
      '    weight: critical',
      '    description: Preserve the nested source boundary.',
      '    rationale: The source tree has an explicit ownership boundary.',
      '    exceptions: []',
      '    examples:',
      '      - good: { code: "src/nested/example.ts" }',
      '        note: Keep the change inside the nested source tree.',
      '  - id: local-exact-descendant-01',
      '    type: architecture',
      '    layer: local',
      '    scope: { path: "src/nested/example.ts" }',
      '    prescription: must',
      '    weight: critical',
      '    description: Preserve the exact nested module contract.',
      '    rationale: This module owns the relevant public boundary.',
      '    exceptions: []',
      '    examples:',
      '      - good: { code: "updateNestedContract();" }',
      '        note: Keep the contract change at its owner.',
      '  - id: local-unrelated-sibling-01',
      '    type: constraint',
      '    layer: local',
      '    scope: { path: "test/**" }',
      '    prescription: must',
      '    weight: critical',
      '    description: Preserve the test fixture boundary.',
      '    rationale: Test fixtures have separate ownership.',
      '    exceptions: []',
      '    examples:',
      '      - good: { code: "test/example.ts" }',
      '        note: Apply only to test fixtures.',
      '',
    ].join('\n'), 'utf8');

    const output = await compileChange({
      projectRoot: directory,
      builtinRoot,
      localAugmentPath: localPath,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Add a nested TypeScript feature',
        changeType: 'feature',
        targets: ['src\\nested'],
        techStack: ['TypeScript'],
        risk: 'low',
        scope: 'module',
        avoid: ['Do not modify unrelated test fixtures.'],
      },
    });
    assert.equal(output.status, 'compiled');
    if (output.status !== 'compiled') return;
    assert.deepEqual(output.task.techStack, ['typescript']);
    assert.ok(output.trace.activatedDirectiveIds.includes('local-nested-glob-01'));
    assert.ok(output.trace.activatedDirectiveIds.includes('local-exact-descendant-01'));
    assert.ok(!output.trace.activatedDirectiveIds.includes('local-unrelated-sibling-01'));
    assert.deepEqual(
      output.trace.activation.inactive.map((item) => item.id),
      ['local-unrelated-sibling-01'],
    );
    assert.ok(output.trace.activation.activeBySource.team.includes('local-nested-glob-01'));
    assert.ok(output.trace.activation.activeBySource.builtin.some((id) => id.startsWith('ts-')));
    assert.ok(output.verificationPlan.commands.some((item) => item.id === 'typecheck'));
    assert.ok(output.attestationPlan.attentionItems.some((item) =>
      item.guidanceId === 'local-exact-descendant-01'
      && item.section === 'required'
      && item.requirements.some((requirement) => requirement.kind === 'semantic')));
    assert.ok(output.attestationPlan.attentionItems.some((item) => item.section === 'avoid'));
    assert.deepEqual(
      output.attestationPlan.optionalConsiderIds,
      output.guidance.consider.map((item) => item.id),
    );
    assert.equal(
      output.attestationPlan.evidenceExamples.semantic.description,
      '<concrete semantic explanation>',
    );

    const unrelated = await compileChange({
      projectRoot: directory,
      builtinRoot,
      localAugmentPath: localPath,
      guidanceByteLimit: 100_000,
      task: {
        description: 'Clarify an unrelated document',
        changeType: 'docs',
        targets: ['docs'],
        risk: 'low',
        scope: 'local',
      },
    });
    assert.equal(unrelated.status, 'compiled');
    if (unrelated.status === 'compiled') {
      assert.deepEqual(unrelated.trace.activation.activeBySource.team, []);
      assert.ok(unrelated.trace.diagnostics.some((item) =>
        item.code === 'TEAM_PLAYBOOK_NO_ACTIVE_DIRECTIVES'));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('compile directly delivers compact agent-facing guidance', async () => {
  const input = {
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    task: {
      description: 'Fix a cache inspection bug',
      changeType: 'bugfix',
      targets: ['packages/core/src/runtime/decision/compile-change.ts'],
      risk: 'low',
      scope: 'local',
    },
  } as const;
  const output = await compileChange(input);
  assert.equal(output.status, 'compiled');
  if (output.status !== 'compiled') return;
  assert.ok(output.trace.selectedLayers.includes('builtin/task-types/bugfix'));
  assert.ok(output.guidance.required.some((item) => item.id === 'local-runtime-compile-evaluate-boundary-01'));
  assert.ok(output.guidance.consider.some((item) => item.id === 'bugfix-add-supporting-validation-01'));
  assert.deepEqual(output.executionGuidance, toExecutionGuidance(output.guidance));
  assert.ok(output.trace.delivery.deliveredBytes <= output.trace.delivery.byteLimit);
  assert.equal(output.trace.delivery.deliveredBytes, serializedBytes(output.executionGuidance));
  assert.equal(output.trace.delivery.fullGuidanceBytes, serializedBytes(output.guidance));
  assert.ok(output.trace.delivery.fullGuidanceBytes > output.trace.delivery.deliveredBytes);
  assert.equal(output.trace.delivery.fullPacketBytes, serializedBytes(output));
  assert.equal(output.trace.delivery.selection, null);
  assert.deepEqual(output.trace.omissions, []);
  assert.ok(!('source' in output.executionGuidance.consider[0]));
  assert.ok(!('verification' in output.executionGuidance.consider[0]));
});

test('explicit verification proposals merge with policy requirements deterministically', async () => {
  const input = {
    projectRoot,
    builtinRoot,
    task: {
      description: 'Fix a TypeScript boundary',
      changeType: 'bugfix' as const,
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'medium' as const,
      scope: 'module' as const,
    },
    verificationProposals: [
      {
        id: 'smoke',
        rationale: 'Exercise the public package entrypoint.',
        source: 'team-default' as const,
      },
      {
        id: 'typecheck',
        rationale: 'Validate the changed public TypeScript contract.',
        source: 'host-task' as const,
      },
    ],
  };
  const first = await compileChange(input);
  assert.equal(first.status, 'compiled');
  if (first.status !== 'compiled') return;
  const typecheck = first.verificationPlan.commands.find((item) =>
    item.id === 'typecheck');
  assert.deepEqual(typecheck?.sources, ['delivered-guidance', 'host-task']);
  assert.ok(typecheck?.reasons.includes(
    'Validate the changed public TypeScript contract.',
  ));
  assert.deepEqual(
    first.verificationPlan.commands.find((item) => item.id === 'smoke'),
    {
      id: 'smoke',
      reasons: ['Exercise the public package entrypoint.'],
      sources: ['team-default'],
    },
  );

  const reordered = await compileChange({
    ...input,
    verificationProposals: [...input.verificationProposals].reverse(),
  });
  assert.equal(reordered.status, 'compiled');
  if (reordered.status !== 'compiled') return;
  assert.equal(reordered.decisionId, first.decisionId);
  assert.equal(
    reordered.fingerprints.verification,
    first.fingerprints.verification,
  );
});

test('ordinary TypeScript change types compile directly under the default ceiling', async () => {
  const cases = [
    {
      description: 'Add a decision trace field',
      changeType: 'feature' as const,
      target: 'packages/core/src/runtime/decision/types.ts',
      risk: 'low' as const,
    },
    {
      description: 'Refactor the Runtime public boundary',
      changeType: 'refactor' as const,
      target: 'packages/core/src/runtime/index.ts',
      risk: 'medium' as const,
    },
    {
      description: 'Migrate the Runtime decision schema',
      changeType: 'migration' as const,
      target: 'packages/core/src/runtime/decision/types.ts',
      risk: 'high' as const,
    },
    {
      description: 'Add coverage for compact guidance',
      changeType: 'test' as const,
      target: 'packages/core/test/harness.test.ts',
      risk: 'low' as const,
    },
  ];

  for (const item of cases) {
    const output = await compileChange({
      projectRoot,
      builtinRoot,
      localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
      rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
      task: {
        description: item.description,
        changeType: item.changeType,
        targets: [item.target],
        risk: item.risk,
        scope: 'local',
      },
    });
    assert.equal(output.status, 'compiled', `${item.changeType} should compile without a selection round trip`);
    if (output.status !== 'compiled') continue;
    assert.ok(output.trace.delivery.deliveredBytes <= output.trace.delivery.byteLimit);
    assert.equal(output.trace.delivery.selection, null);
  }
});

test('an intentionally smaller ceiling requests explicit optional-guidance selection', async () => {
  const input = {
    projectRoot,
    builtinRoot,
    localAugmentPath: resolve(projectRoot, '.resonant-code/playbook/local-augment.yaml'),
    rcclPath: resolve(projectRoot, '.resonant-code/rccl.yaml'),
    guidanceByteLimit: 3_500,
    task: {
      description: 'Fix a cache inspection bug',
      changeType: 'bugfix',
      targets: ['packages/core/src/runtime/decision/compile-change.ts'],
      risk: 'low',
      scope: 'local',
    },
  } as const;
  const overflow = await compileChange(input);
  assert.equal(overflow.status, 'guidance-overflow');
  if (overflow.status !== 'guidance-overflow') return;
  assert.ok(overflow.totalBytes > overflow.byteLimit);
  assert.ok(overflow.mandatoryBytes <= overflow.byteLimit);
  assert.ok(overflow.fullGuidanceBytes > overflow.totalBytes);
  assert.ok(overflow.mandatoryGuidanceIds.includes('local-runtime-compile-evaluate-boundary-01'));
  assert.ok(overflow.selectableConsider.length > 3);
  assert.ok(overflow.selectableConsider.every((item) => !('verification' in item)));

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
  assert.ok(serializedBytes(output.executionGuidance) <= 3_500);
  assert.equal(output.trace.delivery.deliveredBytes, serializedBytes(output.executionGuidance));
  assert.equal(output.trace.delivery.fullGuidanceBytes, serializedBytes(output.guidance));
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
      targets: ['packages/core/src/runtime/decision/compile-change.ts'],
      risk: 'low',
      scope: 'local',
    },
  });
  assert.equal(output.status, 'compiled');
  if (output.status !== 'compiled') return;
  assert.ok(output.guidance.consider.length > 3);
  assert.deepEqual(output.trace.omissions, []);
  assert.equal(output.trace.delivery.deliveredBytes, serializedBytes(output.executionGuidance));
  assert.equal(output.trace.delivery.fullGuidanceBytes, serializedBytes(output.guidance));
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
      targets: ['packages/core/src/runtime/index.ts'],
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

test('delivery budget uses UTF-8 agent-visible content and ignores machine metadata growth', () => {
  const guidance = {
    required: [{
      id: 'required-cn',
      instruction: '保持接口清晰',
      exceptions: [],
      source: { kind: 'builtin-playbook' as const, id: 'test' },
      executionMode: 'enforce' as const,
      verification: [{ kind: 'diff' as const }],
    }],
    consider: [],
    avoid: [],
    tensions: [],
  };
  const executionGuidance = toExecutionGuidance(guidance);
  assert.ok(serializedBytes(executionGuidance) > JSON.stringify(executionGuidance).length);

  const byteLimit = serializedBytes(executionGuidance);
  const base = applyGuidanceDelivery(guidance, byteLimit);
  assert.equal(base.status, 'ready');

  const metadataHeavy = {
    ...guidance,
    required: [{
      ...guidance.required[0],
      source: { kind: 'builtin-playbook' as const, id: 'x'.repeat(10_000) },
      verification: [{ kind: 'semantic' as const, description: 'x'.repeat(10_000) }],
    }],
  };
  const metadataResult = applyGuidanceDelivery(metadataHeavy, byteLimit);
  assert.equal(metadataResult.status, 'ready');
  assert.deepEqual(toExecutionGuidance(metadataHeavy), executionGuidance);

  const instructionHeavy = {
    ...guidance,
    required: [{
      ...guidance.required[0],
      instruction: `${guidance.required[0].instruction}${'界'.repeat(10)}`,
    }],
  };
  assert.equal(applyGuidanceDelivery(instructionHeavy, byteLimit).status, 'overflow');
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
      '  - supersedes: core-clarity-and-legibility-01',
      '    weight: low',
      '  - supersedes: core-preserve-local-consistency-01',
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
          'core-clarity-and-legibility-01',
          'core-preserve-local-consistency-01',
        ].includes(item.id))
        .map((item) => item.id),
      [
        'core-clarity-and-legibility-01',
        'core-preserve-local-consistency-01',
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
      '    scope: { path: "packages/core/src/runtime/**" }',
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
      '    scope: { path: "packages/core/src/runtime/**" }',
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
        targets: ['packages/core/src/runtime/index.ts'],
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
    const builtinIndex = output.guidance.consider.findIndex((item) => item.id === 'core-preserve-local-consistency-01');
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
    assert.notEqual(output.status, 'needs-alignment');
    if (output.status === 'needs-alignment') return;
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
      scope: 'packages/core/src/runtime/**',
      statement: 'The generated host claims this public boundary is an anti-pattern.',
      affects: ['review-focus'],
      decisionImpact: 'If true, a reviewer might choose a different public boundary.',
      semanticConfidence: 'low',
      evidence: [{
        file: 'packages/core/src/runtime/index.ts',
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
        targets: ['packages/core/src/runtime/index.ts'],
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
    evidenceRefs: ['packages/core/src/index.ts:1-7'],
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
      evidenceRefs: ['packages/core/src/index.ts:1-7'],
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
  const scored = await compileRuntimeRefactor([{
    directiveId: 'local-runtime-compile-evaluate-boundary-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'limits',
    rationale: 'A numeric self-rating must not substitute for semantic evidence.',
    evidenceRefs: ['packages/core/src/index.ts:1-7'],
    confidence: 0.99,
  } as never]);
  assert.equal(scored.status, 'needs-attention');
  if (scored.status === 'needs-attention') {
    assert.ok(scored.trace.diagnostics.some((item) => item.message.includes('numeric confidence is unsupported')));
  }

  const invalid = await compileRuntimeRefactor([{
    directiveId: 'local-runtime-compile-evaluate-boundary-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'conflicts',
    rationale: 'Claimed conflict without cited observation evidence.',
    evidenceRefs: ['README.md:1-1'],
  }]);
  assert.notEqual(invalid.status, 'guidance-overflow');
  assert.notEqual(invalid.status, 'needs-alignment');
  if (invalid.status === 'guidance-overflow' || invalid.status === 'needs-alignment') return;
  assert.equal(invalid.status, 'needs-attention');
  assert.equal(invalid.guidance.tensions.length, 0);
  assert.ok(invalid.trace.diagnostics.some((item) => item.code === 'RELATION_PROPOSAL_REJECTED'));

  const immune = await compileRuntimeRefactor([{
    directiveId: 'refactor-preserve-intended-behavior-01',
    observationId: 'obs-runtime-public-harness-boundary',
    relation: 'limits',
    rationale: 'A repository boundary must not soften behavior preservation.',
    evidenceRefs: ['packages/core/src/index.ts:1-7'],
  }]);
  assert.notEqual(immune.status, 'guidance-overflow');
  assert.notEqual(immune.status, 'needs-alignment');
  if (immune.status === 'guidance-overflow' || immune.status === 'needs-alignment') return;
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
  assert.notEqual(irrelevant.status, 'needs-alignment');
  if (irrelevant.status === 'needs-alignment') return;
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
      scope: 'packages/core/src/runtime/**',
      statement: 'The Runtime has a narrow public boundary.',
      affects: ['api-shape'],
      decisionImpact: 'Adding unrelated public helpers would expand the supported API.',
      semanticConfidence: 'high',
      evidence: [{
        file: 'packages/core/src/runtime/index.ts',
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
        targets: ['packages/core/src/runtime/index.ts'],
        risk: 'medium',
        scope: 'module',
      },
      relationProposals: [{
        directiveId: 'local-runtime-compile-evaluate-boundary-01',
        observationId: 'obs-stale-runtime-boundary',
        relation: 'conflicts',
        rationale: 'This would matter if the cited evidence were still current.',
        evidenceRefs: ['packages/core/src/runtime/index.ts:1-1'],
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
        targets: ['packages/core/src/runtime/index.ts'],
        risk: 'medium',
        scope: 'module',
      },
      relationProposals: [{
        directiveId: 'local-runtime-compile-evaluate-boundary-01',
        observationId: 'obs-runtime-public-harness-boundary',
        relation: 'limits',
        rationale: 'The claim is plausible but has not met the semantic assurance gate.',
        evidenceRefs: ['packages/core/src/index.ts:1-7'],
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

test('unresolved host semantics request alignment without a mode switch', async () => {
  const output = await compileChange({
    projectRoot,
    builtinRoot,
    task: {
      description: 'Change the implementation',
      changeType: 'unknown',
      targets: ['packages/core/src/runtime'],
      risk: 'medium',
      scope: 'module',
      uncertainties: ['Whether the public Runtime boundary should change.'],
    },
  });
  assert.equal(output.status, 'needs-alignment');
  if (output.status !== 'needs-alignment') return;
  assert.deepEqual(output.requiredFields, ['changeType', 'uncertainties']);
  assert.deepEqual(
    output.reasons.map((reason) => [reason.kind, reason.field]),
    [
      ['clarification', 'changeType'],
      ['decision', 'uncertainties'],
    ],
  );
  assert.equal(
    output.task.provenance.find((item) => item.field === 'description')?.source,
    'agent-inferred',
  );
});

test('postflight evaluation rejects a failed required command', () => {
  const decision = minimalDecision();
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'failed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:index', file: 'packages/core/src/runtime/index.ts' }],
      explanation: 'The entrypoint diff preserves the narrow public surface.',
    }],
  });
  assert.equal(evaluation.status, 'rejected');
  assert.equal(evaluation.operation, 'modify');
  assert.equal(evaluation.results[0].verdict, 'violated');
  assert.equal(evaluation.results[0].basis, 'runtime-fact');
  assert.equal(evaluation.assurance.machineFacts.changedFileCount, 1);
  assert.equal(evaluation.assurance.authority.runtimeFactResults, 1);
});

test('an unavailable configured command cannot produce a ready-for-adoption result', () => {
  const decision = minimalDecision();
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [{
      id: 'typecheck',
      status: 'unavailable',
      command: ['corepack', 'pnpm', 'typecheck'],
      exitCode: null,
      outputDigest: stableHash(['typecheck', 'unavailable']),
      definitionFingerprint: stableHash(['typecheck', 'definition']),
      reason: 'The configured typecheck command could not start.',
      provenance: {
        source: 'resonant-code-workflow',
        collectionId: changes.provenance.collectionId,
      },
    }],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:index', file: 'packages/core/src/runtime/index.ts' }],
      explanation: 'The entrypoint diff looks correct, but the command fact is unavailable.',
    }],
  });
  assert.equal(evaluation.status, 'needs-attention');
  assert.equal(evaluation.results[0].verdict, 'partial');
  assert.match(evaluation.results[0].reasons[0], /command:typecheck/);
  assert.ok(evaluation.actionRequired.some((item) =>
    item.kind === 'check-unavailable' && item.id === 'typecheck'));
});

test('postflight evaluation accepts opaque Git link facts and rejects mismatched modes', () => {
  const decision = minimalDecision();
  const changes = machineChangeSet([
    { path: 'vendor/dependency', status: 'modified' },
  ]);
  changes.files[0].before = {
    kind: 'gitlink',
    contentHash: '1'.repeat(40),
    mode: '160000',
  };
  changes.files[0].after = {
    kind: 'gitlink',
    contentHash: '2'.repeat(40),
    mode: '160000',
  };
  refreshMachineChangeSetIdentity(changes);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'passed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [{
        kind: 'diff',
        ref: 'diff:vendor/dependency',
        file: 'vendor/dependency',
      }],
      explanation: 'The dependency pointer is represented as an opaque Git link fact.',
    }],
  });
  assert.equal(evaluation.status, 'ready-for-adoption');
  assert.equal(evaluation.changes.files[0].after?.kind, 'gitlink');

  const malformed = structuredClone(changes);
  if (!malformed.files[0].after) throw new Error('Expected an after fact.');
  malformed.files[0].after.mode = '100644';
  refreshMachineChangeSetIdentity(malformed);
  assert.throws(() => evaluateChange({
    decision,
    changes: malformed,
  }), /Git link facts require kind gitlink and mode 160000 together/);
});

test('postflight evaluation combines machine facts with attestations only for delivered guidance', () => {
  const decision = minimalDecision();
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const stdoutOnlyCheck = machineCheck(changes, 'typecheck', 'passed');
  stdoutOnlyCheck.outputRefs = {
    stdout: 'check-output/typecheck.stdout.log',
  };
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [stdoutOnlyCheck],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        { kind: 'diff', ref: 'diff:index', file: 'packages/core/src/runtime/index.ts' },
        { kind: 'check', ref: 'check:typecheck', checkId: 'typecheck' },
      ],
      explanation: 'The changed entrypoint still exports only the intended Runtime operations.',
    }],
  });
  assert.equal(evaluation.status, 'ready-for-adoption');
  assert.equal(evaluation.results[0].verdict, 'satisfied');
  assert.equal(evaluation.results[0].basis, 'agent-attested');
  assert.equal(evaluation.summary.requiredSatisfied, 1);
  assert.equal(evaluation.assurance.agentAttestationCount, 1);
  assert.equal(evaluation.assurance.authority.agentAttestedResults, 1);
  assert.deepEqual(evaluation.changes.files, changes.files);

  const emptyOutputRefs = machineCheck(changes, 'typecheck', 'passed');
  emptyOutputRefs.outputRefs = {};
  assert.throws(() => evaluateChange({
    decision,
    changes,
    checks: [emptyOutputRefs],
  }), /require at least one stdout or stderr path/);

  assert.throws(() => evaluateChange({
    decision,
    changes: machineChangeSet([]),
    attestations: [{
      guidanceId: 'not-delivered',
      verdict: 'satisfied',
      evidenceRefs: [],
      explanation: 'This ID was not part of the decision.',
    }],
  }), /was not delivered/);
});

test('task targets activate policy without becoming changed-file permissions', () => {
  const decision = minimalDecision();
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
    { path: 'packages/core/test/public-boundary.test.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'passed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        {
          kind: 'diff',
          ref: 'diff:runtime-entrypoint',
          file: 'packages/core/src/runtime/index.ts',
        },
        {
          kind: 'diff',
          ref: 'diff:adjacent-test',
          file: 'packages/core/test/public-boundary.test.ts',
        },
      ],
      explanation: 'The owner entrypoint remains narrow and the adjacent test verifies that contract.',
    }],
  });
  assert.equal(evaluation.status, 'ready-for-adoption');
  assert.equal(evaluation.changes.files.length, 2);
  assert.deepEqual(evaluation.scopeDelta.withinTarget, [
    'packages/core/src/runtime/index.ts',
  ]);
  assert.deepEqual(evaluation.scopeDelta.outsideTarget, [
    'packages/core/test/public-boundary.test.ts',
  ]);
  assert.deepEqual(evaluation.actionRequired, []);
});

test('unverified optional consider guidance remains informational', () => {
  const decision = minimalDecision();
  decision.guidance.consider.push({
    id: 'consider-1',
    instruction: 'Prefer a direct implementation when it remains clear.',
    exceptions: [],
    source: { kind: 'builtin-playbook', id: 'test' },
    executionMode: 'ambient',
    verification: [{ kind: 'diff' }],
  });
  decision.executionGuidance = toExecutionGuidance(decision.guidance);
  decision.trace.activatedDirectiveIds.push('consider-1');
  decision.trace.deliveredGuidanceIds.push('consider-1');
  decision.attestationPlan.optionalConsiderIds.push('consider-1');
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'passed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        { kind: 'diff', ref: 'diff:index', file: 'packages/core/src/runtime/index.ts' },
      ],
      explanation: 'The entrypoint still exposes the same narrow boundary.',
    }],
  });
  assert.equal(evaluation.status, 'ready-for-adoption');
  assert.equal(evaluation.summary.attentionCount, 0);
  assert.equal(evaluation.summary.informationalCount, 1);
  assert.deepEqual(evaluation.actionRequired, []);
  assert.deepEqual(
    evaluation.informational.map((item) => item.id),
    ['consider-1'],
  );
});

test('a failed Runtime-requested check remains actionable when its guidance is optional', () => {
  const decision = minimalDecision();
  decision.guidance.required[0].verification = [{ kind: 'diff' }];
  decision.guidance.consider.push({
    id: 'consider-checked',
    instruction: 'Keep the implementation type-safe.',
    exceptions: [],
    source: { kind: 'builtin-playbook', id: 'test' },
    executionMode: 'ambient',
    verification: [{ kind: 'command', commandId: 'typecheck' }],
  });
  decision.executionGuidance = toExecutionGuidance(decision.guidance);
  decision.trace.activatedDirectiveIds.push('consider-checked');
  decision.trace.deliveredGuidanceIds.push('consider-checked');
  decision.attestationPlan.optionalConsiderIds.push('consider-checked');
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision,
    changes,
    checks: [machineCheck(changes, 'typecheck', 'failed')],
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: [
        { kind: 'diff', ref: 'diff:index', file: 'packages/core/src/runtime/index.ts' },
      ],
      explanation: 'The required entrypoint boundary is preserved.',
    }],
  });
  assert.equal(evaluation.status, 'rejected');
  assert.deepEqual(
    evaluation.actionRequired.map((item) => item.kind),
    ['check-failure'],
  );
  assert.deepEqual(
    evaluation.informational.map((item) => item.id),
    ['consider-checked'],
  );
});

test('unverified required guidance needs attention until an exception is requested', () => {
  const changes = machineChangeSet([
    { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
  ]);
  const evaluation = evaluateChange({
    decision: minimalDecision(),
    changes,
  });
  assert.equal(evaluation.status, 'needs-attention');
  assert.equal(evaluation.results[0].verdict, 'unverified');
  assert.equal(evaluation.results[0].basis, 'unverified');

  const pendingException = evaluateChange({
    decision: minimalDecision(),
    changes,
    exceptions: [{
      guidanceId: 'required-1',
      reason: 'The required check is temporarily unavailable.',
    }],
  });
  assert.equal(pendingException.status, 'exception-required');
  assert.equal(pendingException.results[0].verdict, 'unverified');

  const approvedException = evaluateChange({
    decision: minimalDecision(),
    changes,
    exceptions: [{
      guidanceId: 'required-1',
      reason: 'The user accepts the exact temporary verification gap.',
      status: 'approved',
      approvedBy: 'maintainer',
    }],
  });
  assert.equal(approvedException.status, 'ready-for-adoption');
  assert.equal(approvedException.results[0].verdict, 'excepted');
  assert.equal(approvedException.results[0].basis, 'human-approved');
  assert.equal(approvedException.assurance.authority.humanApprovedResults, 1);
});

test('public boundaries reject malformed host artifacts without type errors', async () => {
  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    task: {
      description: 'Fix one bug',
      changeType: 'bugfix',
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'low',
      scope: 'local',
    },
    relationProposals: 'not-an-array' as never,
  }), /relationProposals must be an array/);

  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    task: {
      description: 'Fix one bug',
      changeType: 'bugfix',
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'low',
      scope: 'local',
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
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'low',
      scope: 'local',
    },
  }), /positive integer/);

  await assert.rejects(() => compileChange({
    projectRoot,
    builtinRoot,
    task: {
      description: 'Fix one bug',
      changeType: 'bugfix',
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'low',
      scope: 'local',
    },
    verificationProposals: [{
      id: 'test',
      rationale: '',
      source: 'host-task',
    }],
  }), /requires a rationale/);

  assert.throws(() => evaluateChange({
    decision: minimalDecision(),
    changes: machineChangeSet([
      { path: 'packages/core/src/runtime/index.ts', status: 'modified' },
    ]),
    attestations: [{
      guidanceId: 'required-1',
      verdict: 'satisfied',
      evidenceRefs: {} as never,
      explanation: 'Malformed evidence reference collection.',
    }],
  }), /attestation evidenceRefs must be an array/);

  assert.throws(() => evaluateChange({
    decision: minimalDecision(),
    changes: { files: [] } as never,
  }), /workflow machine provenance/);

  const inconsistent = machineChangeSet([]);
  inconsistent.changeFingerprint = 'host-declared-clean';
  assert.throws(() => evaluateChange({
    decision: minimalDecision(),
    changes: inconsistent,
  }), /changeFingerprint does not match/);
});

function minimalDecision(): ChangeDecisionPacket {
  const guidance: ChangeDecisionPacket['guidance'] = {
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
  };
  return {
    schemaVersion: '1.0',
    decisionId: 'decision-test',
    status: 'compiled',
    task: normalizeTaskContext({
      description: 'Modify the Runtime entrypoint',
      changeType: 'refactor',
      targets: ['packages/core/src/runtime/index.ts'],
      risk: 'low',
      scope: 'local',
    }),
    guidance,
    executionGuidance: toExecutionGuidance(guidance),
    verificationPlan: {
      commands: [{
        id: 'typecheck',
        reasons: ['Run typecheck.'],
        sources: ['delivered-guidance'],
      }],
      semanticChecks: [],
    },
    attestationPlan: {
      attentionItems: [{
        guidanceId: 'required-1',
        section: 'required',
        requirements: guidance.required[0].verification,
      }],
      optionalConsiderIds: [],
      optionalConsiderPolicy: 'unverified-is-informational',
      evidenceExamples: {
        diff: { kind: 'diff', ref: 'diff:<repository-path>', file: '<changed-file>' },
        file: { kind: 'file', ref: 'file:<repository-path>', file: '<changed-file>' },
        check: { kind: 'check', ref: 'check:<check-id>', checkId: '<passing-check-id>' },
        semantic: {
          kind: 'semantic',
          ref: 'semantic:<claim-id>',
          description: '<concrete semantic explanation>',
        },
      },
    },
    trace: {
      selectedLayers: ['builtin/core'],
      playbookSources: { team: 'absent', personal: 'absent' },
      activation: {
        targets: ['packages/core/src/runtime/index.ts'],
        techStack: ['typescript'],
        techStackProvenance: [{
          technology: 'typescript',
          source: 'deterministic',
        }],
        activeBySource: {
          builtin: ['required-1'],
          team: [],
          personal: [],
        },
        configuredBySource: {
          team: [],
          personal: [],
        },
        inactive: [],
      },
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
        fullGuidanceBytes: 1,
        fullPacketBytes: 1,
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
      verification: 'verification',
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
    scope: 'packages/core/src/**',
    statement: 'The Core root public value API is limited to compileChange and evaluateChange.',
    affects: ['api-shape', 'architecture-boundary'],
    decisionImpact: 'Adding workflow-specific helpers would expand the supported Runtime API boundary.',
    semanticConfidence: 'high',
    evidence: [{
      file: 'packages/core/src/index.ts',
      lineRange: [1, 7],
      snippet: exactSourceWindow('packages/core/src/index.ts', 1, 7),
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
      targets: ['packages/core/src/runtime/index.ts'],
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

function refreshMachineChangeSetIdentity(changes: ChangeSet): void {
  changes.changeFingerprint = stableHash([changes.files]);
  changes.provenance.collectionId = stableHash([
    changes.baselineFingerprint,
    changes.currentFingerprint,
    changes.changeFingerprint,
  ]);
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
