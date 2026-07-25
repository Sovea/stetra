import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'resonant-code-release-'));
try {
  const plugin = join(temporary, 'plugin');
  const project = join(temporary, 'project');
  mkdirSync(plugin, { recursive: true });
  mkdirSync(join(project, '.resonant-code'), { recursive: true });
  cpSync(join(workspace, '.codex-plugin'), join(plugin, '.codex-plugin'), { recursive: true });
  cpSync(join(workspace, 'playbook'), join(plugin, 'playbook'), { recursive: true });
  cpSync(join(workspace, 'runtime', 'dist'), join(plugin, 'runtime', 'dist'), { recursive: true });
  cpSync(join(workspace, 'rccl', 'dist'), join(plugin, 'rccl', 'dist'), { recursive: true });
  cpSync(join(workspace, 'skills'), join(plugin, 'skills'), { recursive: true });

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
  writeFileSync(join(project, '.resonant-code', 'rccl.yaml'), `version: "1.0"
generatedAt: "2026-07-14T00:00:00.000Z"
gitRef: null
observations:
  - id: obs-export-boundary
    category: architecture
    scope: "**/*.ts"
    statement: Named exports define the module boundary in the sampled TypeScript entrypoint.
    affects: [api-shape, architecture-boundary]
    decisionImpact: A new export style would make the feature inconsistent with the existing module boundary.
    semanticConfidence: high
    reviewStatus: reviewed
    evidence:
      - file: example.ts
        lineRange: [1, 1]
        snippet: "export const answer = 42;"
    evidenceVerification:
      status: current
      verifiedCount: 1
      totalCount: 1
      checkedAt: "2026-07-14T00:00:00.000Z"
    lifecycle:
      status: active
      contentFingerprint: smoke-observation
      firstSeenGitRef: null
      lastSeenGitRef: null
      lastVerifiedAt: "2026-07-14T00:00:00.000Z"
`, 'utf8');

  const runtime = await import(pathToFileURL(join(plugin, 'runtime', 'dist', 'index.mjs')).href);
  assert.deepEqual(Object.keys(runtime).sort(), ['compileChange', 'evaluateChange']);
  const compileInput = {
    builtinRoot: join(plugin, 'playbook'),
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
      confidence: 0.9,
    }],
  };
  const overflow = await runtime.compileChange(compileInput);
  assert.equal(overflow.status, 'guidance-overflow');
  assert.ok(overflow.selectableConsider.length > 3);
  assert.ok(overflow.candidateDetails.some((item) => item.id === 'rccl:obs-export-boundary'));

  const decision = await runtime.compileChange({
    ...compileInput,
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

  const checks = decision.verificationPlan.commands.map((command) => ({
    id: command.id,
    status: 'passed',
    outputRef: `check:${command.id}`,
  }));
  const evaluationInput = {
    decision,
    changes: { files: [{ path: 'example.ts', status: 'modified' }] },
    checks,
    evidence: evidenceForDecision(decision),
    feedbackPath: join(project, '.resonant-code', 'feedback', 'verified-events.jsonl'),
  };
  const evaluation = runtime.evaluateChange(evaluationInput);
  assert.equal(evaluation.schemaVersion, '1.0');
  assert.equal(evaluation.status, 'accepted');
  assert.equal(evaluation.operation, 'modify');
  assert.ok(evaluation.feedback.recorded > 0);
  assert.equal(runtime.evaluateChange(evaluationInput).feedback.recorded, 0);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function evidenceForDecision(decision) {
  const items = [
    ...decision.guidance.required.map((item) => ({ ...item, section: 'required' })),
    ...decision.guidance.consider.map((item) => ({ ...item, section: 'consider' })),
    ...decision.guidance.avoid.map((item) => ({ ...item, section: 'avoid' })),
  ];
  const evidence = items.map((item) => {
    const refs = [{ kind: 'diff', ref: 'diff:example.ts', file: 'example.ts' }];
    for (const requirement of item.verification) {
      if (requirement.kind === 'semantic') {
        refs.push({ kind: 'semantic', ref: `semantic:${item.id}`, description: `Inspected ${item.id} at the exported module boundary.` });
      }
      if (requirement.kind === 'static') refs.push({ kind: 'static', ref: `static:${item.id}` });
    }
    return { guidanceId: item.id, verdict: 'satisfied', evidenceRefs: refs };
  });
  for (const tension of decision.guidance.tensions) {
    evidence.push({
      guidanceId: tension.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'semantic', ref: `semantic:${tension.id}`, description: tension.resolution }],
    });
  }
  return evidence;
}
