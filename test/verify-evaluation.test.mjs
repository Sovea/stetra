import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evaluationRoot = resolve(root, 'evaluation', 'paired-agent');
const expectedFiles = [
  'PROTOCOL.md',
  'preflight.template.json',
  'result.template.json',
  'task.template.json',
];

assert.deepEqual(
  readdirSync(evaluationRoot).sort(),
  expectedFiles,
  'The paired-agent directory contains only its protocol and reusable templates.',
);

const protocol = readFileSync(resolve(evaluationRoot, 'PROTOCOL.md'), 'utf8');
assert.match(protocol, /evaluator-owned workspace outside the\s+source tree/);
assert.match(protocol, /evidence bundle may be published outside\s+`paired-agent\/`/);

validateTemplates();

function validateTemplates() {
  const task = readJson(resolve(evaluationRoot, 'task.template.json'));
  assert.equal(task.protocol, 'cognitive-adoption-paired-evaluation');
  assert.equal(task.schemaVersion, '2');
  assert.equal(task.registrationFingerprint, 'sha256');
  assert.ok(isNonEmptyString(task.taskId));
  assert.ok(isNonEmptyString(task.taskPrompt));
  assert.ok(isNonEmptyString(task.controlHandoffPrompt));
  validateAcceptanceChecks(task.acceptanceChecks, 'task template acceptance checks');
  validateCoverageMatrix(
    task.coverageMatrix,
    task.acceptanceChecks,
    'task template coverage matrix',
  );

  const result = readJson(resolve(evaluationRoot, 'result.template.json'));
  assert.equal(result.protocol, 'cognitive-adoption-paired-evaluation');
  assert.equal(result.schemaVersion, '2');
  assert.equal(result.treatmentProtocol, 'cognitive-adoption');
  assert.equal(result.treatmentProtocolSchemaVersion, '2');
  assert.equal(result.status, 'completed');
  assert.ok(isSafeRelativePath(result.taskRecord));
  assert.ok(isSafeRelativePath(result.preflightRecord));
  validatePhaseDurations(result.conditions.control.phaseDurations, 'result control phases');
  validatePhaseDurations(result.conditions.treatment.phaseDurations, 'result treatment phases');
  assert.equal(result.conditions.control.lifecycle, null);
  assert.ok(result.conditions.treatment.lifecycle);

  const preflight = readJson(resolve(evaluationRoot, 'preflight.template.json'));
  validatePreflightTemplate(preflight, task.taskId);
  const preflightFixtureIds = new Set(
    preflight.fixtures.map((fixture) => fixture.acceptanceCheckId),
  );
  const sealedCheckIds = new Set(task.acceptanceChecks
    .filter((check) => check.visibility === 'evaluator-after-archive')
    .map((check) => check.id));
  assert.deepEqual(
    preflightFixtureIds,
    sealedCheckIds,
    'Preflight template covers every sealed fixture.',
  );
}

function validateAcceptanceChecks(checks, label) {
  assert.ok(Array.isArray(checks) && checks.length > 0, label);
  const ids = new Set();
  let agentVisible = 0;
  let sealed = 0;
  for (const check of checks) {
    assert.ok(isNonEmptyString(check.id), `${label} id`);
    assert.equal(ids.has(check.id), false, `${label} duplicate ${check.id}`);
    ids.add(check.id);
    assert.ok(['agent', 'evaluator-after-archive'].includes(check.visibility));
    assert.ok(Array.isArray(check.argv) && check.argv.length > 0);
    assert.ok(check.argv.every(isNonEmptyString));
    if (check.visibility === 'agent') {
      agentVisible += 1;
      assert.equal(check.fixture, undefined);
      continue;
    }
    sealed += 1;
    assert.ok(check.fixture && typeof check.fixture === 'object');
    assert.ok(isSafeRelativePath(check.fixture.injectedPath));
    assert.equal(check.fixture.contentFingerprint, 'sha256');
    assert.ok(Number.isInteger(check.fixture.baselineExpectedExitCode));
    assert.notEqual(check.fixture.baselineExpectedExitCode, 0);
    assert.equal(check.fixture.oracleExpectedExitCode, 0);
    assert.equal(
      existsSync(resolve(root, check.fixture.injectedPath)),
      false,
      'Sealed fixture content must remain outside the source repository.',
    );
  }
  assert.ok(agentVisible > 0, `${label} requires an Agent-visible check`);
  assert.ok(sealed > 0, `${label} requires a sealed check`);
}

function validateCoverageMatrix(matrix, checks, label) {
  assert.ok(matrix && typeof matrix === 'object', label);
  assert.equal(matrix.visibility, 'evaluator-only-after-both-outputs-archived');
  assert.ok(Array.isArray(matrix.requirements) && matrix.requirements.length > 0);
  assert.ok(Array.isArray(matrix.coverage));
  assert.ok(Array.isArray(matrix.negativeControls));

  const requirements = new Map();
  for (const requirement of matrix.requirements) {
    assert.ok(isNonEmptyString(requirement.id));
    assert.equal(requirements.has(requirement.id), false);
    assert.ok(['behavior', 'invariants', 'ownership', 'failureRecovery'].includes(
      requirement.dimension,
    ));
    assert.ok(['material', 'adoption-critical'].includes(requirement.importance));
    assert.ok(isNonEmptyString(requirement.statement));
    requirements.set(requirement.id, requirement);
  }

  const sealedChecks = new Set(checks
    .filter((check) => check.visibility === 'evaluator-after-archive')
    .map((check) => check.id));
  const negativeControls = new Map();
  for (const control of matrix.negativeControls) {
    assert.ok(isNonEmptyString(control.id));
    assert.equal(negativeControls.has(control.id), false);
    assert.ok(isNonEmptyString(control.description));
    assert.equal(control.materializationFingerprint, 'sha256');
    assert.equal(control.visibility, 'evaluator-only-after-both-outputs-archived');
    validateStringArray(control.expectedRejectedBy, `${label} expectedRejectedBy`);
    assert.ok(control.expectedRejectedBy.length > 0);
    for (const assertionId of control.expectedRejectedBy) {
      assert.ok(sealedChecks.has(assertionId));
    }
    negativeControls.set(control.id, control);
  }

  const coveredRequirements = new Set();
  const referencedControls = new Set();
  for (const coverage of matrix.coverage) {
    assert.ok(requirements.has(coverage.requirementId));
    assert.equal(coveredRequirements.has(coverage.requirementId), false);
    coveredRequirements.add(coverage.requirementId);
    validateStringArray(coverage.sealedAssertionIds, `${label} sealedAssertionIds`);
    validateStringArray(coverage.negativeControlIds, `${label} negativeControlIds`);
    assert.equal(typeof coverage.manualReviewRequired, 'boolean');
    assert.ok(coverage.sealedAssertionIds.length > 0 || coverage.manualReviewRequired);
    for (const assertionId of coverage.sealedAssertionIds) {
      assert.ok(sealedChecks.has(assertionId));
    }
    for (const controlId of coverage.negativeControlIds) {
      const control = negativeControls.get(controlId);
      assert.ok(control);
      referencedControls.add(controlId);
      assert.ok(control.expectedRejectedBy.some((assertionId) =>
        coverage.sealedAssertionIds.includes(assertionId)));
    }
    if (requirements.get(coverage.requirementId).importance === 'adoption-critical'
      && coverage.negativeControlIds.length === 0) {
      assert.ok(isNonEmptyString(coverage.negativeControlRationale));
    }
  }
  assert.deepEqual(coveredRequirements, new Set(requirements.keys()));
  assert.deepEqual(referencedControls, new Set(negativeControls.keys()));
}

function validatePreflightTemplate(preflight, taskId) {
  assert.equal(preflight.protocol, 'cognitive-adoption-paired-evaluation-preflight');
  assert.equal(preflight.schemaVersion, '2');
  assert.equal(preflight.taskId, taskId);
  assert.equal(preflight.stetra.protocolSchemaVersion, '2');
  assert.ok(isIsoTimestamp(preflight.recordedAt));
  assert.equal(
    preflight.repository.controlWorkspaceFingerprint,
    preflight.repository.treatmentWorkspaceFingerprint,
  );
  for (const field of [
    'toolPolicyEqual', 'dependencyIdentityEqual', 'runtimeIdentityEqual',
    'timeLimitEqual', 'sandboxEqual', 'cachePolicyEqual', 'networkStackEqual',
  ]) {
    assert.equal(preflight.configurationEquality[field], true, field);
  }
  assert.deepEqual(
    preflight.executionIsolation.controlSandboxArgv,
    preflight.executionIsolation.treatmentSandboxArgv,
  );
  assert.ok(preflight.executionIsolation.controlSandboxArgv.every(isNonEmptyString));
  assert.ok(preflight.executionIsolation.writableCachePaths.every(isAbsolute));
  assert.equal(preflight.executionIsolation.ipv6LoopbackAvailable, true);
  assert.equal(preflight.executionIsolation.concurrentSuites, false);
  assert.deepEqual(preflight.hostEnforcement.control, preflight.hostEnforcement.treatment);
  for (const side of ['control', 'treatment']) {
    for (const field of ['webSearch', 'network', 'externalMutation']) {
      assert.match(preflight.hostEnforcement[side][field], /^enforced-(disabled|enabled)$/);
    }
  }
  assert.ok(Array.isArray(preflight.executables) && preflight.executables.length > 0);
  for (const executable of preflight.executables) {
    assert.ok(isNonEmptyString(executable.argv0));
    assert.ok(isAbsolute(executable.resolvedPath));
    assert.ok(isNonEmptyString(executable.version));
    assert.ok(executable.shebangTarget === null || isAbsolute(executable.shebangTarget));
  }
  assert.ok(preflight.processIO.probeArgv.every(isNonEmptyString));
  assert.notEqual(preflight.processIO.expected.exitCode, 0);
  assert.ok(isNonEmptyString(preflight.processIO.expected.stdout));
  assert.ok(isNonEmptyString(preflight.processIO.expected.stderr));
  const [executable, ...args] = preflight.processIO.probeArgv;
  const probe = spawnSync(executable, args, { encoding: 'utf8' });
  assert.deepEqual({ exitCode: probe.status, stdout: probe.stdout, stderr: probe.stderr },
    preflight.processIO.expected, 'The reusable IO probe must produce its declared observation.');
  for (const side of ['control', 'treatment']) {
    assert.deepEqual(preflight.processIO[side], preflight.processIO.expected,
      `The ${side} sandbox must preserve nested subprocess output and termination.`);
  }
  assert.ok(Array.isArray(preflight.fixtures) && preflight.fixtures.length > 0);
  for (const fixture of preflight.fixtures) {
    assert.ok(isNonEmptyString(fixture.acceptanceCheckId));
    assert.ok(Number.isInteger(fixture.baselineActualExitCode));
    assert.notEqual(fixture.baselineActualExitCode, 0);
    assert.equal(fixture.oracleActualExitCode, 0);
    assert.ok(Array.isArray(fixture.negativeControls));
    for (const control of fixture.negativeControls) {
      assert.ok(isNonEmptyString(control.id));
      assert.ok(Number.isInteger(control.actualExitCode));
      assert.notEqual(control.actualExitCode, 0);
    }
  }
  assert.equal(preflight.status, 'passed');
  assert.deepEqual(preflight.deviations, []);
}

function validatePhaseDurations(durations, label) {
  assert.ok(durations && typeof durations === 'object', label);
  for (const field of [
    'alignmentMs', 'implementationMs', 'handoffAuthoringMs',
    'collectionCheckExecutionMs',
    'gitFactCollectionMs', 'activeReviewMs', 'clarificationMs',
    'correctionDecisionMs', 'queueOrWaitMs',
  ]) {
    assert.ok(Number.isInteger(durations[field]) && durations[field] >= 0, `${label} ${field}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateStringArray(value, label) {
  assert.ok(Array.isArray(value), label);
  assert.equal(new Set(value).size, value.length, `${label} duplicates`);
  assert.ok(value.every(isNonEmptyString), `${label} values`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && Boolean(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}
