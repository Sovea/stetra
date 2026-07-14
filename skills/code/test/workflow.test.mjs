import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  autoCodeTask,
  completeCodeTask,
  explainCodeSession,
  getCodeStatus,
} from '../internal/workflow.mjs';

const root = mkdtempSync(join(tmpdir(), 'resonant-code-workflow-'));
const pluginRoot = resolve(import.meta.dirname, '../../..');

try {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
  writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');

  const prepared = await autoCodeTask({
    projectRoot: root,
    pluginRoot,
    taskDescription: 'Fix one implementation detail',
    guidanceMode: 'standard',
    changeType: 'bugfix',
    targets: ['src/example.ts'],
    risk: 'low',
    scope: 'local',
  });

  assert.ok(prepared.status === 'compiled' || prepared.status === 'needs-attention');
  assert.equal(prepared.schemaVersion, '1.0');
  assert.equal(prepared.guidanceMode, 'standard');
  assert.equal(prepared.task.changeType, 'bugfix');
  assert.ok(prepared.guidance.required.length <= 3);
  assert.ok(prepared.guidance.consider.length <= 3);
  assert.ok(prepared.sessionPath);
  assert.ok(!('postCompileContracts' in prepared));
  assert.ok(!('agentLoop' in prepared));

  const evaluationPath = join(root, 'evaluation.json');
  const checks = prepared.verificationPlan.commands.map((command) => ({
    id: command.id,
    status: 'passed',
    outputRef: `check:${command.id}`,
  }));
  const evidence = [
    ...prepared.guidance.required.map(guidanceEvidence),
    ...prepared.guidance.consider.map(guidanceEvidence),
    ...prepared.guidance.avoid.map((item) => ({
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'diff', ref: 'diff:example', file: 'src/example.ts' }],
    })),
    ...prepared.guidance.tensions.map((item) => ({
      guidanceId: item.id,
      verdict: 'satisfied',
      evidenceRefs: [{ kind: 'semantic', ref: `semantic:${item.id}`, description: item.resolution }],
    })),
  ];
  writeFileSync(evaluationPath, JSON.stringify({
    changes: { files: [{ path: 'src/example.ts', status: 'modified' }] },
    checks,
    evidence,
  }, null, 2), 'utf8');

  const completed = await completeCodeTask({
    sessionPath: prepared.sessionPath,
    evaluationFile: evaluationPath,
  });
  assert.equal(completed.status, 'accepted');
  assert.equal(completed.operation, 'modify');
  assert.equal(completed.summary.requiredViolated, 0);
  assert.ok(completed.feedback.recorded > 0);

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

  const status = await getCodeStatus({ projectRoot: root, pluginRoot });
  assert.equal(status.status, 'ok');
  assert.equal(status.plugin.status, 'ok');
  assert.equal(status.readiness.status, 'needs-attention');
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'local-augment-absent'));
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'rccl-absent'));
  assert.equal(status.sources.feedback, 'present');

  const incompletePluginRoot = join(root, 'incomplete-plugin');
  mkdirSync(incompletePluginRoot, { recursive: true });
  const incomplete = await getCodeStatus({ projectRoot: root, pluginRoot: incompletePluginRoot });
  assert.equal(incomplete.status, 'blocked');
  assert.equal(incomplete.plugin.status, 'incomplete');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function guidanceEvidence(item) {
  const refs = [{ kind: 'diff', ref: 'diff:example', file: 'src/example.ts' }];
  if (item.verification.some((requirement) => requirement.kind === 'semantic')) {
    refs.push({ kind: 'semantic', ref: `semantic:${item.id}`, description: `Verified ${item.id} against the implementation.` });
  }
  return {
    guidanceId: item.id,
    verdict: 'satisfied',
    evidenceRefs: refs,
  };
}
