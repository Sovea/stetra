import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  autoCodeTask,
  completeCodeTask,
  getCodeStatus,
} from '../internal/workflow.mjs';

const root = mkdtempSync(join(tmpdir(), 'resonant-code-workflow-'));

try {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf-8');
  writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 1;\n', 'utf-8');
  writeFileSync(join(root, '.gitignore'), '.resonant-code/context/\n', 'utf-8');

  const standard = await autoCodeTask({
    projectRoot: root,
    taskDescription: 'Update one implementation detail',
    guidanceMode: 'standard',
    targetFile: 'src/example.ts',
    operation: 'modify',
    riskLevel: 'low',
    scopeSize: 'single-file',
  });

  assert.equal(standard.status, 'ok');
  assert.equal(standard.guidanceMode, 'standard');
  assert.equal(standard.postCompileContracts.length, 1);
  assert.equal(standard.postCompileContracts[0].kind, 'adherence-evidence');
  assert.equal(standard.postCompileContracts[0].required, false);
  assert.equal(standard.agentLoop.pendingContracts.length, 1);
  assert.equal(standard.agentLoop.pendingContracts[0].kind, 'adherence-evidence');
  assert.equal(standard.policy.required.includes('task-model'), false);
  assert.equal(standard.policy.required.includes('semantic-governance-graph'), false);
  assert.equal(standard.policy.optional.includes('adherence-evidence'), true);
  assert.ok(standard.interpretation.mode);
  assert.ok(existsSync(standard.sessionPath));

  const directiveId = standard.guidance.must_follow[0]?.id;
  assert.ok(directiveId);
  const adherencePath = join(root, 'adherence.json');
  const adherenceContract = standard.postCompileContracts[0].contract;
  writeFileSync(adherencePath, JSON.stringify({
    schema_version: 1,
    kind: adherenceContract.kind,
    request_id: adherenceContract.requestId,
    context_fingerprint: adherenceContract.contextFingerprint,
    payload: {
      verdicts: [{
        directive_id: directiveId,
        verdict: 'followed',
        confidence: 0.9,
        evidence_refs: [{ kind: 'conversation', ref: 'test-only' }],
        reason: 'conversation-only evidence should not update follow rate',
      }],
    },
  }, null, 2), 'utf-8');
  const adherenceCompletion = await completeCodeTask({
    sessionPath: standard.sessionPath,
    adherenceFile: adherencePath,
  });

  assert.equal(adherenceCompletion.status, 'updated');
  assert.equal(adherenceCompletion.adherence.verdictCounts.unverified > 0, true);
  assert.equal(adherenceCompletion.adherence.diagnostics.summary.downgraded, 1);
  assert.ok(readFileSync(adherenceCompletion.lockfilePath, 'utf-8').includes('unverified: 1'));

  const strict = await autoCodeTask({
    projectRoot: root,
    taskDescription: 'Update one implementation detail',
    guidanceMode: 'strict',
    targetFile: 'src/example.ts',
    operation: 'modify',
  });

  assert.equal(strict.status, 'contracts-required');
  assert.equal(strict.guidanceMode, 'strict');
  assert.ok(strict.contracts.some((contract) => contract.kind === 'task-model'));
  assert.ok(strict.agentLoop.pendingContracts.some((contract) => contract.kind === 'task-model'));

  const completion = await completeCodeTask({
    sessionPath: standard.sessionPath,
    autoUnverified: true,
  });

  assert.equal(completion.status, 'updated');
  assert.equal(completion.completion.directiveFollowRateUpdated, false);
  assert.ok(readFileSync(completion.lockfilePath, 'utf-8').includes('total_tasks: 2'));

  const status = await getCodeStatus({ projectRoot: root });

  assert.equal(status.status, 'ok');
  assert.equal(status.defaultFlow.defaultMode, 'standard');
  assert.equal(status.defaultFlow.probe.status, 'ok');
  assert.equal(status.defaultFlow.probe.wouldBlock, false);
  assert.equal(status.readiness.status, 'needs-attention');
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'local-augment-absent'));
  assert.ok(status.readiness.nextActions.some((item) => item.code === 'rccl-absent'));
  assert.equal(status.plugin.status, 'ok');
  assert.equal(status.cacheVolume.exists, false);
  assert.equal(status.diagnostics.gitignore.contextIgnored, true);

  mkdirSync(join(root, '.resonant-code'), { recursive: true });
  writeFileSync(join(root, '.resonant-code', 'rccl.yaml'), 'version: [broken\n', 'utf-8');
  const damagedRcclStatus = await getCodeStatus({ projectRoot: root });
  assert.equal(damagedRcclStatus.readiness.status, 'blocked');
  assert.notEqual(damagedRcclStatus.sourceStatus.rccl, 'present');

  const incompletePluginRoot = join(root, 'incomplete-plugin');
  mkdirSync(incompletePluginRoot, { recursive: true });
  const missingDistStatus = await getCodeStatus({ projectRoot: root, pluginRoot: incompletePluginRoot });
  assert.notEqual(missingDistStatus.readiness.status, 'ready');
  assert.equal(missingDistStatus.plugin.status, 'incomplete');
  assert.equal(missingDistStatus.defaultFlow.probe.status, 'error');
} finally {
  rmSync(root, { recursive: true, force: true });
}
