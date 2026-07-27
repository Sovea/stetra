import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'resonant-core-release-'));
try {
  const packDirectory = join(temporary, 'pack');
  const consumer = join(temporary, 'consumer');
  const project = join(temporary, 'project');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  mkdirSync(join(project, '.resonant-code'), { recursive: true });
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n', 'utf8');

  const coreTarball = packPackage(
    join(workspace, 'packages', 'core'),
    packDirectory,
  );
  run(npmCommand(), [
    'install',
    coreTarball,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], consumer);
  const installedCore = join(
    consumer,
    'node_modules',
    '@sovea',
    'resonant-code-core',
  );
  const coreManifest = JSON.parse(readFileSync(join(installedCore, 'package.json'), 'utf8'));
  assert.equal(coreManifest.name, '@sovea/resonant-code-core');
  assert.equal(coreManifest.version, '0.0.1');
  assert.ok(!Object.hasOwn(coreManifest, 'private'));
  assert.ok(readFileSync(join(installedCore, 'assets', 'playbook', 'core.yaml'), 'utf8'));

  writeFileSync(join(project, 'example.ts'), 'export const answer = 42;\n', 'utf8');
  mkdirSync(join(project, '.resonant-code', 'playbook'), { recursive: true });
  const personalOverlayPath = join(project, '.resonant-code', 'playbook', 'personal-overlay.yaml');
  writeFileSync(personalOverlayPath, `version: "1.0"
meta:
  name: smoke-personal-taste
augments: []
additions:
  - id: personal-explicit-export-names-01
    type: preference
    layer: personal
    scope:
      path: "**/*.ts"
    prescription: should
    description: Prefer descriptive named exports at module boundaries.
    rationale: Named exports are easier for me to review and search.
    exceptions: []
    examples:
      - good:
          code: "export const answer = 42;"
        note: The export name communicates its role.
`, 'utf8');
  const rccl = await import(pathToFileURL(join(installedCore, 'dist', 'rccl.mjs')).href);
  const preparedRccl = rccl.prepareCalibration({
    projectRoot: project,
    evidenceSelections: [{ file: 'example.ts', lineRange: [1, 1] }],
  });
  assert.equal(preparedRccl.status, 'ready');
  const committedRccl = rccl.commitCalibration({
    projectRoot: project,
    contract: preparedRccl.contract,
    proposal: {
      schemaVersion: '1.0',
      requestId: preparedRccl.contract.requestId,
      contextFingerprint: preparedRccl.contract.contextFingerprint,
      observations: [{
        id: 'obs-export-boundary',
        category: 'architecture',
        scope: '**/*.ts',
        statement: 'Named exports define the module boundary in the selected TypeScript entrypoint.',
        affects: ['api-shape', 'architecture-boundary'],
        decisionImpact: 'A new export style would make the feature inconsistent with the existing module boundary.',
        semanticConfidence: 'high',
        evidence: [{ windowId: preparedRccl.contract.evidenceWindows[0].windowId }],
      }],
    },
  });
  assert.equal(committedRccl.status, 'committed');
  assert.equal(committedRccl.document.observations[0].reviewStatus, 'generated');
  const approvedRccl = rccl.approveContext({
    projectRoot: project,
    observationIds: ['obs-export-boundary'],
    approvedBy: 'release-smoke-reviewer',
  });
  assert.equal(approvedRccl.status, 'approved');
  assert.equal(approvedRccl.document.observations[0].reviewStatus, 'reviewed');

  const core = await import(pathToFileURL(join(installedCore, 'dist', 'index.mjs')).href);
  assert.deepEqual(Object.keys(core).sort(), ['compileChange', 'evaluateChange']);
  const compileInput = {
    builtinRoot: join(installedCore, 'assets', 'playbook'),
    personalOverlayPath,
    rcclPath: join(project, '.resonant-code', 'rccl.yaml'),
    projectRoot: project,
    task: {
      description: 'Add an exported feature',
      changeType: 'feature',
      targets: ['example.ts'],
      techStack: ['typescript'],
      risk: 'low',
      scope: 'local',
    },
    relationProposals: [{
      directiveId: 'feature-fit-existing-system-01',
      observationId: 'obs-export-boundary',
      relation: 'supports',
      rationale: 'The existing export boundary is concrete evidence for repository fit.',
      evidenceRefs: ['example.ts:1-1'],
    }],
  };
  const direct = await core.compileChange(compileInput);
  assert.equal(direct.status, 'compiled');
  assert.ok(direct.trace.delivery.deliveredBytes <= direct.trace.delivery.byteLimit);
  assert.ok(direct.trace.delivery.fullGuidanceBytes > direct.trace.delivery.deliveredBytes);
  assert.deepEqual(direct.executionGuidance.required.map((item) => item.id), direct.guidance.required.map((item) => item.id));

  const overflow = await core.compileChange({
    ...compileInput,
    guidanceByteLimit: 3_000,
  });
  assert.equal(overflow.status, 'guidance-overflow');
  assert.ok(overflow.selectableConsider.length > 3);
  assert.ok(overflow.candidateDetails.some((item) => item.id === 'rccl:obs-export-boundary'));

  const decision = await core.compileChange({
    ...compileInput,
    guidanceByteLimit: 3_000,
    deliverySelection: {
      considerIds: [
        'feature-start-from-requested-behavior-01',
        'ts-explicit-public-interfaces-01',
        'rccl:obs-export-boundary',
        'personal-explicit-export-names-01',
      ],
      rationale: 'The selected optional guidance covers requested behavior, the public TypeScript API, and the observed export boundary.',
    },
  });
  assert.equal(decision.schemaVersion, '1.0');
  assert.equal(decision.status, 'compiled');
  assert.equal(decision.task.changeType, 'feature');
  assert.ok(decision.trace.selectedLayers.includes('builtin/task-types/feature'));
  assert.deepEqual(decision.trace.relevantObservationIds, ['obs-export-boundary']);
  assert.ok(decision.trace.relationDecisions.some((item) => item.status === 'accepted' && item.relation === 'reinforce'));
  assert.deepEqual(
    decision.guidance.consider.map((item) => item.id),
    [
      'personal-explicit-export-names-01',
      'feature-start-from-requested-behavior-01',
      'ts-explicit-public-interfaces-01',
      'rccl:obs-export-boundary',
    ],
  );
  assert.equal(
    decision.guidance.consider
      .find((item) => item.id === 'personal-explicit-export-names-01')
      ?.source.kind,
    'personal-playbook',
  );
  assert.equal(decision.trace.playbookSources.personal, 'present');
  assert.ok(decision.trace.deliveredGuidanceIds.length > 0);

  const changes = machineChangeSet([
    { path: 'example.ts', status: 'modified' },
  ]);
  const checks = decision.verificationPlan.commands.map((command) => ({
    id: command.id,
    status: 'passed',
    command: ['release-smoke-check', command.id],
    exitCode: 0,
    outputDigest: stableHash([command.id, 'passed']),
    outputRefs: {
      stdout: `.resonant-code/context/${command.id}.stdout.log`,
      stderr: `.resonant-code/context/${command.id}.stderr.log`,
    },
    definitionFingerprint: stableHash([command.id, 'definition']),
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: changes.provenance.collectionId,
    },
  }));
  const evaluationInput = {
    decision,
    changes,
    checks,
    attestations: attestationsForDecision(decision),
    feedbackPath: join(project, '.resonant-code', 'feedback', 'verified-events.jsonl'),
  };
  const evaluation = core.evaluateChange(evaluationInput);
  assert.equal(evaluation.schemaVersion, '1.0');
  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.operation, 'modify');
  assert.ok(evaluation.feedback.recorded > 0);
  assert.ok(evaluation.feedback.aggregateCount > 0);
  const feedbackAggregate = JSON.parse(readFileSync(evaluation.feedback.aggregatePath, 'utf8'));
  assert.equal(feedbackAggregate.source.eventCount, evaluation.feedback.recorded);
  assert.ok(feedbackAggregate.aggregates.every((aggregate) =>
    !Object.hasOwn(aggregate, 'explanation')
    && aggregate.total === aggregate.satisfied + aggregate.violated + aggregate.excepted));
  assert.equal(core.evaluateChange(evaluationInput).feedback.recorded, 0);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function attestationsForDecision(decision) {
  const items = [
    ...decision.guidance.required.map((item) => ({ ...item, section: 'required' })),
    ...decision.guidance.consider.map((item) => ({ ...item, section: 'consider' })),
    ...decision.guidance.avoid.map((item) => ({ ...item, section: 'avoid' })),
  ];
  const attestations = items.map((item) => {
    const refs = [{ kind: 'diff', ref: 'diff:example.ts', file: 'example.ts' }];
    for (const requirement of item.verification) {
      if (requirement.kind === 'semantic') {
        refs.push({ kind: 'semantic', ref: `semantic:${item.id}`, description: `Inspected ${item.id} at the exported module boundary.` });
      }
    }
    return {
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs: refs,
      explanation: `Inspected ${item.id} against the isolated machine-collected change.`,
      attestedBy: 'release-smoke-host',
    };
  });
  for (const tension of decision.guidance.tensions) {
    attestations.push({
      guidanceId: tension.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'semantic', ref: `semantic:${tension.id}`, description: tension.resolution }],
      explanation: `Applied the compiled resolution for ${tension.id}.`,
      attestedBy: 'release-smoke-host',
    });
  }
  return attestations;
}

function machineChangeSet(inputs) {
  const files = inputs.map((input) => ({
    ...input,
    before: {
      kind: 'file',
      contentHash: stableHash([input.path, 'before']),
      mode: '100644',
    },
    after: {
      kind: 'file',
      contentHash: stableHash([input.path, 'after']),
      mode: '100644',
    },
  })).sort((left, right) => left.path.localeCompare(right.path));
  const baselineFingerprint = stableHash(['release-baseline']);
  const currentFingerprint = stableHash(['release-current']);
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
    baselineHead: null,
    currentHead: null,
    provenance: {
      source: 'resonant-code-workflow',
      collectionId,
    },
  };
}

function stableHash(parts) {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 16);
}

function packPackage(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  run(
    'corepack',
    ['pnpm', 'pack', '--pack-destination', destination],
    packageDirectory,
  );
  const created = readdirSync(destination)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `Expected one tarball from ${packageDirectory}.`);
  return join(destination, created[0]);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  assert.equal(
    result.status,
    0,
    [
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].join('\n'),
  );
  return result;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
