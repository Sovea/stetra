import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  autoCodeTask,
  completeCodeTask,
  createApprovedFeedbackProposal,
  explainCodeSession,
  getCodeStatus,
  inspectCodeFeedback,
} from '../internal/workflow.mjs';

const root = mkdtempSync(join(tmpdir(), 'resonant-code-workflow-'));
const pluginRoot = resolve(import.meta.dirname, '../../..');

try {
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.resonant-code', 'context'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
  writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');
  writeFileSync(join(root, 'src', 'preexisting.ts'), 'export const preexisting = 1;\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), [
    '.resonant-code/context/',
    '.resonant-code/feedback/',
    '',
  ].join('\n'), 'utf8');
  const checkConfigPath = join(root, '.resonant-code', 'checks.json');
  writeFileSync(checkConfigPath, JSON.stringify({
    version: '1.0',
    checks: [
      {
        id: 'typecheck',
        command: [process.execPath, '-e', 'process.exit(0)'],
        timeoutMs: 10_000,
      },
      {
        id: 'test',
        command: [process.execPath, '-e', 'process.exit(0)'],
        timeoutMs: 10_000,
      },
    ],
  }, null, 2), 'utf8');
  const personalOverlayPath = join(root, 'personal-overlay.yaml');
  writeFileSync(personalOverlayPath, [
    'version: "1.0"',
    'meta: { name: workflow-personal-taste }',
    'augments: []',
    'additions:',
    '  - id: personal-readable-control-flow-01',
    '    type: preference',
    '    layer: personal',
    '    scope: { path: "src/**" }',
    '    prescription: should',
    '    description: Prefer control flow that reads from validation to the main behavior.',
    '    rationale: This ordering is faster for me to review.',
    '    exceptions: []',
    '    examples:',
    '      - good: { code: "if (!input) return null;" }',
    '        note: Handle the invalid path first.',
    '',
  ].join('\n'), 'utf8');
  git(['init', '-q']);
  git(['config', 'user.email', 'workflow@example.invalid']);
  git(['config', 'user.name', 'Workflow Test']);
  git(['add', '.']);
  git(['commit', '-qm', 'initial']);

  writeFileSync(join(root, 'src', 'preexisting.ts'), 'export const preexisting = 2;\n', 'utf8');
  writeFileSync(join(root, 'src', 'preexisting-untracked.ts'), 'export const prior = true;\n', 'utf8');

  const taskOptions = {
    projectRoot: root,
    pluginRoot,
    taskDescription: 'Fix one implementation detail',
    guidanceMode: 'standard',
    changeType: 'bugfix',
    targets: ['src/example.ts'],
    risk: 'low',
    scope: 'local',
    personalOverlayPath,
    checkConfigPath,
  };
  const overflow = await autoCodeTask({
    ...taskOptions,
    guidanceByteLimit: 3_500,
  });
  assert.equal(overflow.status, 'guidance-overflow');
  assert.ok(overflow.selectableConsider.length > 3);
  assert.ok(!('sessionPath' in overflow));

  const selectionPath = join(root, '.resonant-code', 'context', 'guidance-selection.json');
  writeFileSync(selectionPath, JSON.stringify({
    considerIds: [
      'bugfix-add-supporting-validation-01',
      'ts-honest-and-precise-types-01',
      'personal-readable-control-flow-01',
    ],
    rationale: 'The defect requires a regression test and precise TypeScript boundary handling.',
  }, null, 2), 'utf8');
  const selected = await autoCodeTask({
    ...taskOptions,
    guidanceByteLimit: 3_500,
    selectionFile: selectionPath,
  });
  assert.ok(selected.status === 'compiled' || selected.status === 'needs-attention');
  assert.deepEqual(
    selected.guidance.consider.map((item) => item.id),
    [
      'personal-readable-control-flow-01',
      'bugfix-add-supporting-validation-01',
      'ts-honest-and-precise-types-01',
    ],
  );

  const prepared = await autoCodeTask(taskOptions);

  assert.ok(prepared.status === 'compiled' || prepared.status === 'needs-attention');
  assert.equal(prepared.schemaVersion, '1.0');
  assert.equal(prepared.guidanceMode, 'standard');
  assert.equal(prepared.task.changeType, 'bugfix');
  assert.ok(prepared.guidance.consider.some((item) => item.id === 'personal-readable-control-flow-01'));
  assert.ok(prepared.guidance.consider.some((item) => item.id === 'bugfix-add-supporting-validation-01'));
  assert.ok(prepared.delivery.deliveredBytes <= prepared.delivery.byteLimit);
  assert.ok(prepared.delivery.fullGuidanceBytes > prepared.delivery.deliveredBytes);
  assert.ok(!('source' in prepared.guidance.consider[0]));
  assert.ok(!('verification' in prepared.guidance.consider[0]));
  assert.ok(prepared.sessionPath);
  assert.ok(prepared.baseline.entryCount >= 6);
  assert.ok(prepared.checkPlan.every((item) => item.status === 'configured'));
  assert.ok(!('postCompileContracts' in prepared));
  assert.ok(!('agentLoop' in prepared));

  writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 2;\n', 'utf8');
  const evaluationPath = join(root, '.resonant-code', 'context', 'evaluation.json');
  const attestations = [
    ...prepared.guidance.required.map((item) => guidanceAttestation(item, prepared.verificationPlan)),
    ...prepared.guidance.consider.map((item) => guidanceAttestation(item, prepared.verificationPlan)),
    ...prepared.guidance.avoid.map((item) => ({
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:example', file: 'src/example.ts' }],
      explanation: `Inspected the machine-collected diff for prohibited pattern ${item.id}.`,
      attestedBy: 'workflow-test-host',
    })),
    ...prepared.guidance.tensions.map((item) => ({
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'semantic', ref: `semantic:${item.id}`, description: item.resolution }],
      explanation: `Applied the compiled tension resolution for ${item.id}.`,
      attestedBy: 'workflow-test-host',
    })),
  ];
  writeFileSync(evaluationPath, JSON.stringify({
    attestations,
    exceptions: [],
  }, null, 2), 'utf8');

  const forgedPath = join(root, '.resonant-code', 'context', 'forged-evaluation.json');
  writeFileSync(forgedPath, JSON.stringify({
    changes: { files: [] },
    checks: [],
    attestations: [],
  }), 'utf8');
  await assert.rejects(() => completeCodeTask({
    sessionPath: prepared.sessionPath,
    evaluationFile: forgedPath,
  }), /collects change\/check facts/);

  const completed = await completeCodeTask({
    sessionPath: prepared.sessionPath,
    evaluationFile: evaluationPath,
  });
  assert.equal(completed.status, 'accepted');
  assert.equal(completed.operation, 'modify');
  assert.deepEqual(
    completed.changes.files.map((file) => [file.path, file.status]),
    [['src/example.ts', 'modified']],
  );
  assert.ok(completed.checks.every((check) =>
    check.status === 'passed'
    && check.provenance.source === 'resonant-code-workflow'
    && check.outputDigest));
  assert.equal(completed.assurance.machineFacts.changedFileCount, 1);
  assert.equal(completed.assurance.hostAttestationCount, attestations.length);
  assert.equal(completed.summary.requiredViolated, 0);
  assert.ok(completed.feedback.recorded > 0);
  assert.ok(existsSync(completed.feedback.aggregatePath));

  const feedback = inspectCodeFeedback({ projectRoot: root });
  assert.equal(feedback.status, 'ok');
  assert.equal(feedback.source.eventCount, completed.feedback.recorded);
  assert.ok(feedback.aggregates.length > 0);
  assert.ok(feedback.aggregates.every((aggregate) =>
    aggregate.total === aggregate.satisfied + aggregate.violated + aggregate.excepted));
  const sourceAggregate = feedback.aggregates[0];
  const filteredFeedback = inspectCodeFeedback({
    projectRoot: root,
    guidanceIds: [sourceAggregate.guidanceId, 'missing-guidance'],
  });
  assert.deepEqual(filteredFeedback.aggregates.map((item) => item.guidanceId), [sourceAggregate.guidanceId]);
  assert.deepEqual(filteredFeedback.missingGuidanceIds, ['missing-guidance']);
  const cliFeedback = JSON.parse(execFileSync(process.execPath, [
    join(pluginRoot, 'skills', 'code', 'scripts', 'code.mjs'),
    'feedback',
    root,
    '--guidance-id',
    sourceAggregate.guidanceId,
  ], { encoding: 'utf8' }));
  assert.deepEqual(cliFeedback.aggregates.map((item) => item.guidanceId), [sourceAggregate.guidanceId]);

  const feedbackProposalPath = join(root, '.resonant-code', 'context', 'approved-feedback-proposal.json');
  const proposalCandidate = {
    schemaVersion: '1.0',
    guidanceId: sourceAggregate.guidanceId,
    aggregateFingerprint: sourceAggregate.aggregateFingerprint,
    target: 'team-playbook',
    change: {
      kind: 'revise',
      summary: 'Clarify the directive verification language for this repository.',
      proposedContent: {
        id: sourceAggregate.guidanceId,
        note: 'Candidate content remains a proposal and is not applied automatically.',
      },
    },
    rationale: 'The evidence-backed outcomes warrant a human-reviewed policy edit proposal.',
    approval: {
      status: 'approved',
      approvedBy: 'workflow-test-reviewer',
      reason: 'Approved for proposal creation only; policy application remains separate.',
    },
  };
  writeFileSync(feedbackProposalPath, JSON.stringify({
    ...proposalCandidate,
    approval: { ...proposalCandidate.approval, status: 'requested' },
  }), 'utf8');
  assert.throws(() => createApprovedFeedbackProposal({
    projectRoot: root,
    inputFile: feedbackProposalPath,
  }), /Approved feedback proposal must include/);
  writeFileSync(feedbackProposalPath, JSON.stringify(proposalCandidate), 'utf8');
  const proposal = createApprovedFeedbackProposal({
    projectRoot: root,
    inputFile: feedbackProposalPath,
  });
  assert.equal(proposal.status, 'approved-proposal');
  assert.equal(proposal.applyStatus, 'not-applied');
  assert.equal(proposal.written, true);
  assert.equal(existsSync(join(root, '.resonant-code', 'playbook', 'local-augment.yaml')), false);
  const persistedProposal = JSON.parse(readFileSync(proposal.proposalPath, 'utf8'));
  assert.equal(persistedProposal.approval.approvedBy, 'workflow-test-reviewer');
  assert.deepEqual(persistedProposal.sourceAggregate, sourceAggregate);
  assert.equal(persistedProposal.applyStatus, 'not-applied');
  assert.equal(createApprovedFeedbackProposal({
    projectRoot: root,
    inputFile: feedbackProposalPath,
  }).written, false);

  writeFileSync(feedbackProposalPath, JSON.stringify({
    ...proposalCandidate,
    aggregateFingerprint: '0'.repeat(16),
  }), 'utf8');
  assert.throws(() => createApprovedFeedbackProposal({
    projectRoot: root,
    inputFile: feedbackProposalPath,
  }), /changed; inspect it again/);

  const explained = explainCodeSession({ sessionPath: prepared.sessionPath });
  assert.equal(explained.status, 'ok');
  assert.equal(explained.decision.decisionId, prepared.decisionId);
  assert.equal(explained.evaluation.status, 'accepted');

  const strict = await autoCodeTask({
    projectRoot: root,
    pluginRoot,
    taskDescription: 'Change the implementation',
    guidanceMode: 'strict',
  });
  assert.equal(strict.status, 'needs-interpretation');
  assert.deepEqual(strict.requiredFields, ['changeType', 'targets']);

  const status = await getCodeStatus({
    projectRoot: root,
    pluginRoot,
    personalOverlayPath,
    checkConfigPath,
  });
  assert.equal(status.status, 'ok');
  assert.equal(status.plugin.status, 'ok');
  assert.equal(status.readiness.status, 'needs-attention');
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'local-augment-absent'));
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'rccl-absent'));
  assert.equal(status.sources.personalOverlay, 'present');
  assert.equal(status.sources.checks, 'present');
  assert.equal(status.sources.feedback, 'present');

  const incompletePluginRoot = join(root, 'incomplete-plugin');
  mkdirSync(incompletePluginRoot, { recursive: true });
  const incomplete = await getCodeStatus({ projectRoot: root, pluginRoot: incompletePluginRoot });
  assert.equal(incomplete.status, 'blocked');
  assert.equal(incomplete.plugin.status, 'incomplete');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function guidanceAttestation(item, verificationPlan) {
  const refs = [{ kind: 'diff', ref: 'diff:example', file: 'src/example.ts' }];
  if (verificationPlan.semanticChecks.some((check) => check.guidanceId === item.id)) {
    refs.push({ kind: 'semantic', ref: `semantic:${item.id}`, description: `Verified ${item.id} against the implementation.` });
  }
  return {
    guidanceId: item.id,
    verdict: 'satisfied',
    evidenceRefs: refs,
    explanation: `Inspected ${item.id} against the machine-collected change and configured checks.`,
    attestedBy: 'workflow-test-host',
  };
}

function git(args) {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}
