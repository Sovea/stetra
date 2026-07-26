import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evaluationRoot = resolve(root, 'evaluation', 'paired-agent');
const ledgerPath = resolve(evaluationRoot, 'ledger.json');
const ledger = readJson(ledgerPath);

assert.equal(ledger.schemaVersion, '1.0');
assert.equal(ledger.protocolVersion, '1.0');
assert.ok(['not-run', 'in-progress', 'completed'].includes(ledger.status));
assert.ok(['unverified', 'supported', 'mixed', 'not-supported'].includes(ledger.effectivenessClaim));
assert.ok(Array.isArray(ledger.resultFiles));
assert.equal(new Set(ledger.resultFiles).size, ledger.resultFiles.length);
assert.equal(typeof ledger.conclusion, 'string');
assert.ok(ledger.conclusion.trim());

if (ledger.status === 'not-run') {
  assert.equal(ledger.effectivenessClaim, 'unverified');
  assert.deepEqual(ledger.resultFiles, []);
}
if (ledger.status !== 'completed') {
  assert.equal(
    ledger.effectivenessClaim,
    'unverified',
    'Effectiveness claims require a completed paired evaluation ledger.',
  );
}
if (ledger.effectivenessClaim !== 'unverified') {
  assert.equal(ledger.status, 'completed');
  assert.ok(ledger.resultFiles.length > 0);
}

for (const resultFile of ledger.resultFiles) {
  const resultPath = safeLedgerPath(resultFile);
  const result = readJson(resultPath);
  validateResult(result, resultPath);
  const taskPath = safeLedgerPath(result.taskRecord);
  validateTask(readJson(taskPath), taskPath, result.taskId);
}

function validateResult(result, path) {
  assert.equal(result.schemaVersion, '1.0', `${path} schemaVersion`);
  assert.equal(result.protocolVersion, '1.0', `${path} protocolVersion`);
  assert.equal(result.status, 'completed', `${path} must retain completed pair data; exclusions belong in validity`);
  assert.equal(typeof result.pairId, 'string');
  assert.ok(result.pairId.trim());
  assert.equal(typeof result.taskId, 'string');
  assert.ok(result.taskId.trim());
  assert.ok(result.conditions && typeof result.conditions === 'object');
  validateCondition(result.conditions.control, `${path} control`);
  validateCondition(result.conditions.treatment, `${path} treatment`);
  assert.ok(result.blindReview && typeof result.blindReview === 'object');
  assert.ok(['left', 'right', 'tie', 'reject-both'].includes(result.blindReview.preference));
  assert.ok(['accept', 'needs-correction', 'reject'].includes(result.blindReview.leftAdoption));
  assert.ok(['accept', 'needs-correction', 'reject'].includes(result.blindReview.rightAdoption));
  assert.ok(Array.isArray(result.blindReview.findings));
  assert.ok(result.revealedMapping && typeof result.revealedMapping === 'object');
  assert.ok(['control', 'treatment'].includes(result.revealedMapping.left));
  assert.ok(['control', 'treatment'].includes(result.revealedMapping.right));
  assert.notEqual(result.revealedMapping.left, result.revealedMapping.right);
  assert.ok(result.validity && typeof result.validity === 'object');
  assert.equal(typeof result.validity.included, 'boolean');
  assert.ok(Array.isArray(result.validity.notes));
}

function validateCondition(condition, label) {
  assert.ok(condition && typeof condition === 'object', label);
  for (const field of ['initialPatchFingerprint', 'finalPatchFingerprint']) {
    assert.equal(typeof condition[field], 'string', `${label} ${field}`);
    assert.ok(condition[field].trim(), `${label} ${field}`);
  }
  for (const field of ['initialChangedFiles', 'finalChangedFiles', 'outOfScopeFiles', 'checks', 'correctionRounds']) {
    assert.ok(Array.isArray(condition[field]), `${label} ${field}`);
  }
  for (const field of ['initialOutputDurationMs', 'totalDurationMs', 'harnessOverheadMs', 'infrastructureRetries']) {
    assert.ok(Number.isInteger(condition[field]) && condition[field] >= 0, `${label} ${field}`);
  }
}

function validateTask(task, path, taskId) {
  assert.equal(task.schemaVersion, '1.0', `${path} schemaVersion`);
  assert.equal(task.taskId, taskId, `${path} taskId`);
  assert.ok(task.repository && typeof task.repository.commit === 'string' && task.repository.commit.trim());
  assert.equal(typeof task.taskPrompt, 'string');
  assert.ok(task.taskPrompt.trim());
  assert.ok(Array.isArray(task.allowedPaths));
  assert.ok(Array.isArray(task.scopeExclusions));
  assert.ok(Array.isArray(task.acceptanceChecks));
  assert.ok(task.agent && typeof task.agent === 'object');
  assert.deepEqual(
    [...task.conditionOrder].sort(),
    ['control', 'treatment'],
    `${path} conditionOrder`,
  );
}

function safeLedgerPath(path) {
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
