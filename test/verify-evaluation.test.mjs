import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evaluationRoot = resolve(root, 'evaluation', 'paired-agent');
const ledger = readJson(resolve(evaluationRoot, 'ledger.json'));

assert.equal(ledger.protocol, 'semantic-handoff-paired-evaluation');
assert.equal(ledger.schemaVersion, '1');
assert.equal(ledger.treatmentProtocol, 'semantic-delegation');
assert.equal(ledger.minimumCompletedPairs, 3);
assert.ok(['not-run', 'in-progress', 'completed'].includes(ledger.status));
assert.ok(['unverified', 'useful', 'mixed', 'not-supported'].includes(ledger.effectivenessClaim));
assert.ok(Array.isArray(ledger.resultFiles));
assert.equal(new Set(ledger.resultFiles).size, ledger.resultFiles.length);
assert.equal(typeof ledger.conclusion, 'string');
assert.ok(ledger.conclusion.trim());

if (ledger.status === 'not-run') assert.deepEqual(ledger.resultFiles, []);
if (ledger.status !== 'completed') {
  assert.equal(ledger.effectivenessClaim, 'unverified');
  assert.equal(ledger.productOwnerConclusion, null);
}
if (ledger.effectivenessClaim !== 'unverified') {
  assert.equal(ledger.status, 'completed');
}

const includedTasks = [];
const pairIds = new Set();
for (const resultFile of ledger.resultFiles) {
  const resultPath = safeEvaluationPath(resultFile);
  const result = readJson(resultPath);
  validateResult(result, resultPath);
  assert.equal(pairIds.has(result.pairId), false, `Duplicate pair id ${result.pairId}.`);
  pairIds.add(result.pairId);
  const taskPath = safeEvaluationPath(result.taskRecord);
  const task = readJson(taskPath);
  validateTask(task, taskPath, result.taskId);
  validateTaskInteractions(task, result, resultPath);
  if (result.validity.included) includedTasks.push({ task, result });
}

if (ledger.status === 'completed') {
  assert.ok(
    includedTasks.length >= ledger.minimumCompletedPairs,
    'Completed effectiveness ledger requires at least three included pairs.',
  );
  assert.ok(
    new Set(includedTasks.map(({ task }) => task.taskType)).size >= 2,
    'Completed pilot requires at least two task types.',
  );
  assert.ok(
    includedTasks.some(({ task }) => task.compatibilityOrOwnershipSensitive),
    'Completed pilot requires a compatibility- or ownership-sensitive task.',
  );
  assert.ok(
    includedTasks.some(({ task, result }) =>
      task.treatmentRepairRecollectionRequired
      && result.conditions.treatment.lifecycle.repairRecollectionOccurred),
    'Completed pilot requires a registered repair/recollection treatment.',
  );
  validateProductOwnerConclusion(ledger.productOwnerConclusion, includedTasks);
}

function validateResult(result, path) {
  assert.equal(result.protocol, 'semantic-handoff-paired-evaluation', `${path} protocol`);
  assert.equal(result.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(result.treatmentProtocol, 'semantic-delegation', `${path} treatmentProtocol`);
  assert.equal(result.status, 'completed', `${path} must retain completed pair data`);
  assert.equal(typeof result.pairId, 'string');
  assert.ok(result.pairId.trim());
  assert.equal(typeof result.taskId, 'string');
  assert.ok(result.taskId.trim());
  validateCondition(result.conditions?.control, `${path} control`, false);
  validateCondition(result.conditions?.treatment, `${path} treatment`, true);
  assert.ok(result.blindReview && typeof result.blindReview === 'object');
  assert.ok(['left', 'right', 'tie', 'reject-both'].includes(result.blindReview.preference));
  validateBlindSide(result.blindReview.left, `${path} blind left`);
  validateBlindSide(result.blindReview.right, `${path} blind right`);
  assert.ok(Array.isArray(result.blindReview.findings));
  assert.ok(result.revealedMapping && typeof result.revealedMapping === 'object');
  assert.ok(['control', 'treatment'].includes(result.revealedMapping.left));
  assert.ok(['control', 'treatment'].includes(result.revealedMapping.right));
  assert.notEqual(result.revealedMapping.left, result.revealedMapping.right);
  assert.ok(result.validity && typeof result.validity === 'object');
  assert.equal(typeof result.validity.included, 'boolean');
  assert.ok(Array.isArray(result.validity.notes));
}

function validateCondition(condition, label, treatment) {
  assert.ok(condition && typeof condition === 'object', label);
  for (const field of ['initialPatchFingerprint', 'finalPatchFingerprint']) {
    assert.equal(typeof condition[field], 'string', `${label} ${field}`);
    assert.ok(condition[field].trim(), `${label} ${field}`);
  }
  for (const field of ['initialChangedFiles', 'finalChangedFiles', 'outOfScopeFiles', 'checks', 'clarificationsDelivered', 'correctionRounds']) {
    assert.ok(Array.isArray(condition[field]), `${label} ${field}`);
  }
  for (const field of ['initialOutputDurationMs', 'totalDurationMs', 'harnessOverheadMs', 'infrastructureRetries']) {
    assert.ok(Number.isInteger(condition[field]) && condition[field] >= 0, `${label} ${field}`);
  }
  if (!treatment) {
    assert.equal(condition.lifecycle, null, `${label} control cannot claim harness lifecycle`);
    assert.equal(condition.harnessOverheadMs, 0, `${label} control harness overhead`);
    return;
  }
  assert.equal(condition.lifecycle?.prepareStatus, 'prepared');
  assert.ok(Array.isArray(condition.lifecycle?.collectionIds));
  assert.ok(condition.lifecycle.collectionIds.length >= 1);
  assert.ok(['handoff-ready', 'needs-attention', 'rejected'].includes(
    condition.lifecycle.finalizeStatus,
  ));
  assert.equal(typeof condition.lifecycle.repairRecollectionOccurred, 'boolean');
}

function validateBlindSide(side, label) {
  assert.ok(side && typeof side === 'object', label);
  assert.ok(['accept', 'needs-correction', 'reject'].includes(side.adoption));
  assert.ok(Number.isInteger(side.decisionDurationMs) && side.decisionDurationMs >= 0);
  for (const dimension of ['behavior', 'invariants', 'ownership', 'failureRecovery']) {
    validateRawFinding(side.understanding?.[dimension], `${label} ${dimension}`);
  }
  validateRawFinding(side.reviewAttention, `${label} reviewAttention`);
}

function validateRawFinding(finding, label) {
  assert.ok(finding && typeof finding === 'object', label);
  assert.ok(['correct', 'partial', 'incorrect', 'not-applicable'].includes(finding.verdict));
  assert.equal(typeof finding.explanation, 'string');
  assert.ok(finding.explanation.trim());
}

function validateTask(task, path, taskId) {
  assert.equal(task.protocol, 'semantic-handoff-paired-evaluation', `${path} protocol`);
  assert.equal(task.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(task.taskId, taskId, `${path} taskId`);
  assert.ok(['bugfix', 'feature', 'refactor', 'migration', 'maintenance', 'docs', 'test'].includes(task.taskType));
  assert.ok(task.repository && typeof task.repository.commit === 'string' && task.repository.commit.trim());
  assert.equal(typeof task.taskPrompt, 'string');
  assert.ok(task.taskPrompt.trim());
  validateInteractionPolicy(task.interactionPolicy, `${path} interactionPolicy`);
  assert.ok(task.expectedUnderstanding && typeof task.expectedUnderstanding === 'object');
  for (const field of ['behavior', 'invariants', 'ownership', 'failureRecovery']) {
    assert.ok(Array.isArray(task.expectedUnderstanding[field]), `${path} expectedUnderstanding.${field}`);
  }
  assert.equal(typeof task.compatibilityOrOwnershipSensitive, 'boolean');
  assert.equal(typeof task.treatmentRepairRecollectionRequired, 'boolean');
  assert.ok(Array.isArray(task.allowedPaths));
  assert.ok(Array.isArray(task.scopeExclusions));
  assert.ok(Array.isArray(task.acceptanceChecks));
  assert.ok(task.agent && typeof task.agent === 'object');
  assert.deepEqual([...task.conditionOrder].sort(), ['control', 'treatment']);
}

function validateInteractionPolicy(policy, label) {
  assert.ok(policy && typeof policy === 'object', label);
  assert.ok(['initial-prompt-only', 'registered-clarification'].includes(policy.mode));
  assert.ok(Array.isArray(policy.registeredClarifications));
  if (policy.mode === 'initial-prompt-only') {
    assert.deepEqual(policy.registeredClarifications, []);
    return;
  }
  assert.ok(policy.registeredClarifications.length > 0);
  for (const clarification of policy.registeredClarifications) {
    for (const field of ['id', 'deliveryRule', 'response']) {
      assert.equal(typeof clarification[field], 'string');
      assert.ok(clarification[field].trim());
    }
  }
}

function validateTaskInteractions(task, result, path) {
  const registered = new Set(
    task.interactionPolicy.registeredClarifications.map((clarification) => clarification.id),
  );
  assert.equal(
    registered.size,
    task.interactionPolicy.registeredClarifications.length,
    `${path} has duplicate registered clarification IDs`,
  );
  for (const condition of ['control', 'treatment']) {
    const delivered = result.conditions[condition].clarificationsDelivered;
    assert.equal(new Set(delivered).size, delivered.length, `${path} ${condition} duplicate clarification`);
    for (const clarificationId of delivered) {
      assert.ok(registered.has(clarificationId), `${path} delivered unregistered clarification ${clarificationId}`);
    }
  }
}

function validateProductOwnerConclusion(conclusion, includedTasks) {
  assert.ok(conclusion && typeof conclusion === 'object');
  assert.equal(typeof conclusion.accepted, 'boolean');
  for (const field of ['acceptedBy', 'decidedAt', 'scope', 'statement']) {
    assert.equal(typeof conclusion[field], 'string');
    assert.ok(conclusion[field].trim());
  }
  assert.ok(Array.isArray(conclusion.pairIds));
  assert.ok(Array.isArray(conclusion.contraryEvidence));
  const includedPairIds = new Set(includedTasks.map(({ result }) => result.pairId));
  assert.deepEqual(new Set(conclusion.pairIds), includedPairIds);
}

function safeEvaluationPath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(path.trim());
  assert.equal(isAbsolute(path), false);
  const resolved = resolve(evaluationRoot, path);
  const rel = relative(evaluationRoot, resolved);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
  assert.ok(existsSync(resolved), `Missing paired evaluation artifact ${path}`);
  return resolved;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
