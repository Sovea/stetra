import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evaluationRoot = resolve(root, 'evaluation', 'paired-agent');
const ledger = readJson(resolve(evaluationRoot, 'ledger.json'));

validateCurrentTemplates();

assert.equal(ledger.protocol, 'cognitive-adoption-paired-evaluation');
assert.equal(ledger.schemaVersion, '1');
assert.equal(ledger.treatmentProtocol, 'cognitive-adoption');
assert.equal(ledger.minimumCompletedPairs, 3);
assert.ok(['not-run', 'in-progress', 'inconclusive', 'completed'].includes(ledger.status));
assert.ok(['unverified', 'useful', 'mixed', 'not-supported'].includes(ledger.effectivenessClaim));
assert.ok(Array.isArray(ledger.resultFiles));
assert.equal(new Set(ledger.resultFiles).size, ledger.resultFiles.length);
assert.ok(Array.isArray(ledger.observationFiles));
assert.equal(new Set(ledger.observationFiles).size, ledger.observationFiles.length);
assert.ok(Array.isArray(ledger.taskFiles));
assert.equal(new Set(ledger.taskFiles).size, ledger.taskFiles.length);
assert.equal(typeof ledger.conclusion, 'string');
assert.ok(ledger.conclusion.trim());

if (ledger.status === 'not-run') {
  assert.deepEqual(ledger.taskFiles, []);
  assert.deepEqual(ledger.resultFiles, []);
  assert.deepEqual(ledger.observationFiles, []);
}
if (ledger.status === 'in-progress') assert.ok(ledger.taskFiles.length > 0);
if (ledger.status === 'inconclusive') assert.ok(ledger.observationFiles.length > 0);
if (ledger.status !== 'completed') {
  assert.equal(ledger.effectivenessClaim, 'unverified');
  assert.equal(ledger.productOwnerConclusion, null);
}
if (ledger.effectivenessClaim !== 'unverified') {
  assert.equal(ledger.status, 'completed');
}

for (const name of ['sources', 'worktrees', 'sealed', 'raw', 'logs', 'transcripts']) {
  assert.equal(
    existsSync(resolve(evaluationRoot, name)),
    false,
    `Raw evaluation directory ${name} must remain outside the source tree.`,
  );
}

const registeredTasks = new Map();
for (const taskFile of ledger.taskFiles) {
  const taskPath = safeEvaluationPath(taskFile);
  const task = readJson(taskPath);
  validateTask(task, taskPath);
  assert.equal(registeredTasks.has(task.taskId), false, `Duplicate task id ${task.taskId}.`);
  registeredTasks.set(task.taskId, { task, taskFile });
}

const includedTasks = [];
const pairIds = new Set();
for (const resultFile of ledger.resultFiles) {
  const resultPath = safeEvaluationPath(resultFile);
  const result = readJson(resultPath);
  validateResult(result, resultPath);
  assert.equal(pairIds.has(result.pairId), false, `Duplicate pair id ${result.pairId}.`);
  pairIds.add(result.pairId);
  const registration = registeredTasks.get(result.taskId);
  assert.ok(registration, `${resultPath} references unregistered task ${result.taskId}.`);
  assert.equal(result.taskRecord, registration.taskFile, `${resultPath} taskRecord`);
  const task = registration.task;
  validateTaskInteractions(task, result, resultPath);
  if (result.validity.included) includedTasks.push({ task, result });
}

for (const observationFile of ledger.observationFiles) {
  const observationPath = safeEvaluationPath(observationFile);
  validateObservation(readJson(observationPath), observationPath, registeredTasks);
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
  assert.equal(result.protocol, 'cognitive-adoption-paired-evaluation', `${path} protocol`);
  assert.equal(result.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(result.treatmentProtocol, 'cognitive-adoption', `${path} treatmentProtocol`);
  assert.equal(result.status, 'completed', `${path} must retain completed pair data`);
  assert.equal(typeof result.pairId, 'string');
  assert.ok(result.pairId.trim());
  assert.equal(typeof result.taskId, 'string');
  assert.ok(result.taskId.trim());
  const preflightPath = safeEvaluationPath(result.preflightRecord);
  validatePreflight(readJson(preflightPath), preflightPath, result.taskId);
  validateCondition(result.conditions?.control, `${path} control`, false, true);
  validateCondition(result.conditions?.treatment, `${path} treatment`, true, true);
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

function validateObservation(observation, path, registeredTasks) {
  assert.equal(observation.protocol, 'cognitive-adoption-paired-evaluation', `${path} protocol`);
  assert.equal(observation.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(observation.observationKind, 'inconclusive-pilot', `${path} observationKind`);
  assert.equal(observation.treatmentProtocol, 'cognitive-adoption', `${path} treatmentProtocol`);
  assert.ok(isIsoTimestamp(observation.observedAt), `${path} observedAt`);
  assert.match(observation.sourceRegistrationCommit, /^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(observation.pairs) && observation.pairs.length > 0);
  assert.equal(new Set(observation.pairs.map(({ taskId }) => taskId)).size, observation.pairs.length);
  for (const pair of observation.pairs) {
    assert.ok(registeredTasks.has(pair.taskId), `${path} unregistered task ${pair.taskId}`);
    assert.ok(['left', 'right'].includes(pair.mapping?.control));
    assert.ok(['left', 'right'].includes(pair.mapping?.treatment));
    assert.notEqual(pair.mapping.control, pair.mapping.treatment);
    assert.ok(isSha256(pair.patchFingerprints?.control));
    assert.ok(isSha256(pair.patchFingerprints?.treatment));
    assert.ok(['control', 'treatment', 'tie', 'reject-both'].includes(pair.proxyReview?.preference));
    assert.ok(isNonEmptyString(pair.proxyReview?.finding));
    assert.ok(Number.isInteger(pair.treatmentLifecycle?.repairAttempts));
    assert.ok(pair.treatmentLifecycle.repairAttempts >= 0);
    assert.ok(isNonEmptyString(pair.treatmentLifecycle?.observation));
  }
  validateStringArray(observation.crossPairFindings, `${path} crossPairFindings`, isNonEmptyString);
  assert.equal(observation.validity?.includedAsCompletedResults, false);
  assert.equal(observation.validity?.humanBlindReviewWaived, true);
  assert.equal(observation.validity?.proxyReviewOnly, true);
  assert.equal(observation.validity?.timingDataCaptured, false);
  assert.equal(observation.validity?.repairRecollectionPairPreregistered, false);
  assert.equal(observation.validity?.rawArtifactsTracked, false);
  assert.equal(observation.validity?.effectivenessClaim, 'unverified');
}

function validateCondition(condition, label, treatment, phaseTimingRequired) {
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
  if (phaseTimingRequired) {
    assert.ok(condition.phaseDurations, `${label} phaseDurations required`);
  }
  if (condition.phaseDurations !== undefined) {
    validatePhaseDurations(condition.phaseDurations, `${label} phaseDurations`);
  }
  if (!treatment) {
    assert.equal(condition.lifecycle, null, `${label} control cannot claim harness lifecycle`);
    assert.equal(condition.harnessOverheadMs, 0, `${label} control harness overhead`);
    return;
  }
  assert.equal(condition.lifecycle?.prepareStatus, 'prepared');
  assert.ok(Array.isArray(condition.lifecycle?.collectionIds));
  assert.ok(condition.lifecycle.collectionIds.length >= 1);
  assert.ok(['handoff-ready', 'needs-attention'].includes(
    condition.lifecycle.handoffStatus,
  ));
  assert.ok(['accepted', 'correction-requested', 'rejected', 'deferred'].includes(
    condition.lifecycle.decisionStatus,
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

function validateTask(task, path) {
  assert.equal(task.protocol, 'cognitive-adoption-paired-evaluation', `${path} protocol`);
  assert.equal(task.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(task.registrationFingerprint, registrationFingerprint(task), `${path} registrationFingerprint`);
  assert.equal(typeof task.taskId, 'string', `${path} taskId`);
  assert.ok(task.taskId.trim(), `${path} taskId`);
  assert.ok(['bugfix', 'feature', 'refactor', 'migration', 'maintenance', 'docs', 'test'].includes(task.taskType));
  assert.ok(isIsoTimestamp(task.registeredAt), `${path} registeredAt`);
  assert.ok(isNonEmptyString(task.registeredBy), `${path} registeredBy`);
  validateRepository(task.repository, `${path} repository`);
  validateHistoricalReplay(task.historicalReplay, task.repository, `${path} historicalReplay`);
  assert.equal(typeof task.taskPrompt, 'string');
  assert.ok(task.taskPrompt.trim());
  assert.equal(task.taskPrompt.includes(task.historicalReplay.sealedOracleCommit), false);
  assert.equal(task.taskPrompt.includes(task.historicalReplay.sealedOracleUrl), false);
  validateInteractionPolicy(task.interactionPolicy, `${path} interactionPolicy`);
  assert.ok(task.expectedUnderstanding && typeof task.expectedUnderstanding === 'object');
  for (const field of ['behavior', 'invariants', 'ownership', 'failureRecovery']) {
    assert.ok(Array.isArray(task.expectedUnderstanding[field]), `${path} expectedUnderstanding.${field}`);
    assert.ok(task.expectedUnderstanding[field].length > 0, `${path} expectedUnderstanding.${field}`);
    assert.ok(task.expectedUnderstanding[field].every(isNonEmptyString));
  }
  assert.equal(typeof task.compatibilityOrOwnershipSensitive, 'boolean');
  assert.equal(typeof task.treatmentRepairRecollectionRequired, 'boolean');
  validateStringArray(task.allowedPaths, `${path} allowedPaths`, isSafeRelativePath);
  validateStringArray(task.scopeExclusions, `${path} scopeExclusions`, isNonEmptyString);
  validateAcceptanceChecks(task.acceptanceChecks, `${path} acceptanceChecks`);
  if (task.coverageMatrix !== undefined) {
    validateCoverageMatrix(task.coverageMatrix, task.acceptanceChecks, `${path} coverageMatrix`);
  }
  validateEnvironment(task.environment, `${path} environment`);
  validateAgent(task.agent, `${path} agent`);
  assert.deepEqual([...task.conditionOrder].sort(), ['control', 'treatment']);
  assert.ok(isNonEmptyString(task.assignmentSeed), `${path} assignmentSeed`);
  assert.ok(task.review && typeof task.review === 'object', `${path} review`);
  assert.ok(isNonEmptyString(task.review.reviewerId), `${path} review.reviewerId`);
  assert.ok(isNonEmptyString(task.review.rubricVersion), `${path} review.rubricVersion`);
}

function validateRepository(repository, label) {
  assert.ok(repository && typeof repository === 'object', label);
  assert.match(repository.url, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/);
  assert.match(repository.commit, /^[a-f0-9]{40}$/);
  assert.ok(repository.submodulesFingerprint === null || isSha256(repository.submodulesFingerprint));
}

function validateHistoricalReplay(replay, repository, label) {
  assert.ok(replay && typeof replay === 'object', label);
  assert.match(replay.issueUrl, /^https:\/\/github\.com\/.+\/issues\/\d+$/);
  assert.match(replay.sealedOracleCommit, /^[a-f0-9]{40}$/);
  assert.notEqual(replay.sealedOracleCommit, repository.commit);
  assert.match(replay.sealedOracleUrl, /^https:\/\/github\.com\/.+\/commit\/[a-f0-9]{40}$/);
  assert.ok(replay.sealedOracleUrl.endsWith(replay.sealedOracleCommit));
  assert.equal(replay.oracleAccess, 'evaluator-only-after-both-outputs-archived');
  assert.ok(['low', 'medium', 'high'].includes(replay.publicSolutionMemoryRisk?.level));
  assert.ok(isNonEmptyString(replay.publicSolutionMemoryRisk?.rationale));
  validateStringArray(replay.leakageControls, `${label}.leakageControls`, isNonEmptyString);
  assert.ok(replay.leakageControls.length > 0);
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
    assert.ok(['agent', 'evaluator-after-archive'].includes(check.visibility), `${label} visibility`);
    assert.ok(Array.isArray(check.argv) && check.argv.length > 0, `${label} argv`);
    assert.ok(check.argv.every(isNonEmptyString), `${label} argv values`);
    if (check.visibility === 'agent') {
      agentVisible += 1;
      assert.equal(check.fixture, undefined, `${label} Agent-visible check cannot claim a sealed fixture`);
      continue;
    }
    sealed += 1;
    assert.ok(check.fixture && typeof check.fixture === 'object', `${label} sealed fixture`);
    assert.ok(isSafeRelativePath(check.fixture.injectedPath), `${label} fixture path`);
    assert.ok(isSha256(check.fixture.contentFingerprint), `${label} fixture fingerprint`);
    assert.ok(Number.isInteger(check.fixture.baselineExpectedExitCode));
    assert.notEqual(check.fixture.baselineExpectedExitCode, 0);
    assert.equal(check.fixture.oracleExpectedExitCode, 0);
    assert.equal(
      existsSync(resolve(root, check.fixture.injectedPath)),
      false,
      `${label} sealed fixture content must not be tracked in the source repository`,
    );
  }
  assert.ok(agentVisible > 0, `${label} requires an Agent-visible repository check`);
  assert.ok(sealed > 0, `${label} requires a post-archive sealed check`);
}

function validateCoverageMatrix(matrix, checks, label, template = false) {
  assert.ok(matrix && typeof matrix === 'object', label);
  assert.equal(matrix.visibility, 'evaluator-only-after-both-outputs-archived');
  assert.ok(Array.isArray(matrix.requirements) && matrix.requirements.length > 0, `${label} requirements`);
  assert.ok(Array.isArray(matrix.coverage), `${label} coverage`);
  assert.ok(Array.isArray(matrix.negativeControls), `${label} negativeControls`);

  const requirements = new Map();
  for (const requirement of matrix.requirements) {
    assert.ok(isNonEmptyString(requirement.id), `${label} requirement id`);
    assert.equal(requirements.has(requirement.id), false, `${label} duplicate requirement ${requirement.id}`);
    assert.ok(['behavior', 'invariants', 'ownership', 'failureRecovery'].includes(requirement.dimension));
    assert.ok(['material', 'adoption-critical'].includes(requirement.importance));
    assert.ok(isNonEmptyString(requirement.statement));
    requirements.set(requirement.id, requirement);
  }

  const sealedChecks = new Set(checks
    .filter((check) => check.visibility === 'evaluator-after-archive')
    .map((check) => check.id));
  const negativeControls = new Map();
  for (const control of matrix.negativeControls) {
    assert.ok(isNonEmptyString(control.id), `${label} negative control id`);
    assert.equal(negativeControls.has(control.id), false, `${label} duplicate negative control ${control.id}`);
    assert.ok(isNonEmptyString(control.description));
    assert.ok(template || isSha256(control.materializationFingerprint));
    assert.equal(control.visibility, 'evaluator-only-after-both-outputs-archived');
    validateStringArray(control.expectedRejectedBy, `${label} ${control.id} expectedRejectedBy`, isNonEmptyString);
    assert.ok(control.expectedRejectedBy.length > 0);
    for (const assertionId of control.expectedRejectedBy) {
      assert.ok(sealedChecks.has(assertionId), `${label} unknown sealed assertion ${assertionId}`);
    }
    negativeControls.set(control.id, control);
  }

  const coveredRequirements = new Set();
  const referencedControls = new Set();
  for (const coverage of matrix.coverage) {
    assert.ok(requirements.has(coverage.requirementId), `${label} unknown requirement ${coverage.requirementId}`);
    assert.equal(coveredRequirements.has(coverage.requirementId), false, `${label} duplicate coverage ${coverage.requirementId}`);
    coveredRequirements.add(coverage.requirementId);
    validateStringArray(coverage.sealedAssertionIds, `${label} sealedAssertionIds`, isNonEmptyString);
    validateStringArray(coverage.negativeControlIds, `${label} negativeControlIds`, isNonEmptyString);
    assert.equal(typeof coverage.manualReviewRequired, 'boolean');
    assert.ok(
      coverage.sealedAssertionIds.length > 0 || coverage.manualReviewRequired,
      `${label} ${coverage.requirementId} needs a sealed assertion or manual review`,
    );
    for (const assertionId of coverage.sealedAssertionIds) {
      assert.ok(sealedChecks.has(assertionId), `${label} unknown sealed assertion ${assertionId}`);
    }
    for (const controlId of coverage.negativeControlIds) {
      assert.ok(negativeControls.has(controlId), `${label} unknown negative control ${controlId}`);
      referencedControls.add(controlId);
      assert.ok(
        negativeControls.get(controlId).expectedRejectedBy.some((assertionId) =>
          coverage.sealedAssertionIds.includes(assertionId)),
        `${label} negative control ${controlId} must be rejected by this requirement's sealed assertions`,
      );
    }
    if (requirements.get(coverage.requirementId).importance === 'adoption-critical'
      && coverage.negativeControlIds.length === 0) {
      assert.ok(
        isNonEmptyString(coverage.negativeControlRationale),
        `${label} ${coverage.requirementId} needs a negative control or concrete rationale`,
      );
    }
  }
  assert.deepEqual(coveredRequirements, new Set(requirements.keys()), `${label} must cover every requirement`);
  assert.deepEqual(referencedControls, new Set(negativeControls.keys()), `${label} must map every negative control`);
}

function validatePhaseDurations(durations, label) {
  assert.ok(durations && typeof durations === 'object', label);
  for (const field of [
    'investigationAndImplementationMs', 'protocolAuthoringMs', 'schemaCorrectionMs',
    'challengeMs', 'baselineCheckExecutionMs', 'collectionCheckExecutionMs',
    'gitFactCollectionMs', 'activeReviewMs', 'clarificationMs',
    'correctionDecisionMs', 'queueOrWaitMs',
  ]) {
    assert.ok(Number.isInteger(durations[field]) && durations[field] >= 0, `${label} ${field}`);
  }
}

function validatePreflight(preflight, path, taskId, template = false) {
  assert.equal(preflight.protocol, 'cognitive-adoption-paired-evaluation-preflight', `${path} protocol`);
  assert.equal(preflight.schemaVersion, '1', `${path} schemaVersion`);
  assert.equal(preflight.taskId, taskId, `${path} taskId`);
  assert.ok(isIsoTimestamp(preflight.recordedAt), `${path} recordedAt`);
  assert.ok(template || /^[a-f0-9]{40}$/.test(preflight.repository?.commit));
  assert.ok(
    preflight.repository?.submodulesFingerprint === null
      || template
      || isSha256(preflight.repository.submodulesFingerprint),
    `${path} submodulesFingerprint`,
  );
  for (const field of ['controlWorkspaceFingerprint', 'treatmentWorkspaceFingerprint']) {
    assert.ok(template || isSha256(preflight.repository?.[field]), `${path} repository ${field}`);
  }
  assert.equal(
    preflight.repository?.controlWorkspaceFingerprint,
    preflight.repository?.treatmentWorkspaceFingerprint,
    `${path} starting workspaces`,
  );
  assert.ok(template || /^[a-f0-9]{40}$/.test(preflight.stetra?.commit));
  for (const field of ['coreArchiveDigest', 'cliArchiveDigest', 'hostAdapterDigest']) {
    assert.ok(template || isSha256(preflight.stetra?.[field]), `${path} Stetra ${field}`);
  }
  assert.ok(isNonEmptyString(preflight.agent?.model));
  assert.equal(preflight.agent?.modelAvailable, true, `${path} model availability`);
  assert.ok(isNonEmptyString(preflight.agent?.surface));
  assert.ok(isNonEmptyString(preflight.agent?.surfaceVersion));
  for (const field of [
    'toolPolicyEqual', 'dependencyIdentityEqual', 'runtimeIdentityEqual',
    'timeLimitEqual', 'sandboxEqual', 'cachePolicyEqual', 'networkStackEqual',
  ]) {
    assert.equal(preflight.configurationEquality?.[field], true, `${path} ${field}`);
  }
  assert.deepEqual(
    preflight.executionIsolation?.controlSandboxArgv,
    preflight.executionIsolation?.treatmentSandboxArgv,
    `${path} sandbox argv`,
  );
  assert.ok(Array.isArray(preflight.executionIsolation?.controlSandboxArgv));
  assert.ok(preflight.executionIsolation.controlSandboxArgv.length > 0);
  assert.ok(preflight.executionIsolation.controlSandboxArgv.every(isNonEmptyString));
  assert.ok(template || isSha256(preflight.executionIsolation?.sandboxPolicyFingerprint));
  assert.ok(Array.isArray(preflight.executionIsolation?.writableCachePaths));
  assert.ok(preflight.executionIsolation.writableCachePaths.length > 0);
  assert.ok(preflight.executionIsolation.writableCachePaths.every(isAbsolute));
  assert.equal(preflight.executionIsolation?.ipv6LoopbackAvailable, true, `${path} IPv6 loopback`);
  assert.equal(preflight.executionIsolation?.concurrentSuites, false, `${path} concurrent suites`);
  assert.deepEqual(preflight.hostEnforcement?.control, preflight.hostEnforcement?.treatment);
  for (const side of ['control', 'treatment']) {
    for (const field of ['webSearch', 'network', 'externalMutation']) {
      assert.match(preflight.hostEnforcement?.[side]?.[field] ?? '', /^enforced-(disabled|enabled)$/);
    }
  }
  assert.ok(template || isSha256(preflight.hostEnforcement?.attestationFingerprint));
  assert.ok(Array.isArray(preflight.executables) && preflight.executables.length > 0);
  for (const executable of preflight.executables) {
    assert.ok(isNonEmptyString(executable.argv0));
    assert.ok(isAbsolute(executable.resolvedPath));
    assert.ok(isNonEmptyString(executable.version));
    assert.ok(executable.shebangTarget === null || isAbsolute(executable.shebangTarget));
  }
  assert.ok(Array.isArray(preflight.fixtures) && preflight.fixtures.length > 0);
  for (const fixture of preflight.fixtures) {
    assert.ok(isNonEmptyString(fixture.acceptanceCheckId));
    assert.ok(template || isSha256(fixture.contentFingerprint));
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

function validateCurrentTemplates() {
  const task = readJson(resolve(evaluationRoot, 'task.template.json'));
  assert.equal(task.schemaVersion, '1');
  validateCoverageMatrix(task.coverageMatrix, task.acceptanceChecks, 'task template coverage', true);

  const result = readJson(resolve(evaluationRoot, 'result.template.json'));
  assert.equal(result.schemaVersion, '1');
  assert.ok(isSafeRelativePath(result.preflightRecord));
  validatePhaseDurations(result.conditions.control.phaseDurations, 'result template control phases');
  validatePhaseDurations(result.conditions.treatment.phaseDurations, 'result template treatment phases');

  const preflight = readJson(resolve(evaluationRoot, 'preflight.template.json'));
  validatePreflight(preflight, 'preflight template', task.taskId, true);
  const fixtureIds = new Set(preflight.fixtures.map((fixture) => fixture.acceptanceCheckId));
  const sealedIds = task.acceptanceChecks
    .filter((check) => check.visibility === 'evaluator-after-archive')
    .map((check) => check.id);
  assert.deepEqual(fixtureIds, new Set(sealedIds), 'preflight template covers every sealed fixture');
}

function validateEnvironment(environment, label) {
  assert.ok(environment && typeof environment === 'object', label);
  assert.ok(isNonEmptyString(environment.platform), `${label} platform`);
  assert.ok(isNonEmptyString(environment.architecture), `${label} architecture`);
  assert.ok(Array.isArray(environment.runtimes) && environment.runtimes.length > 0);
  assert.equal(new Set(environment.runtimes.map(({ name }) => name)).size, environment.runtimes.length);
  for (const runtime of environment.runtimes) {
    assert.ok(isNonEmptyString(runtime.name));
    assert.ok(isNonEmptyString(runtime.version));
  }
  const provisioning = environment.dependencyProvisioning;
  assert.ok(provisioning && typeof provisioning === 'object');
  assert.ok(['locked', 'single-materialization-copy'].includes(provisioning.mode));
  assert.ok(Array.isArray(provisioning.setupArgv) && provisioning.setupArgv.length > 0);
  for (const argv of provisioning.setupArgv) {
    assert.ok(Array.isArray(argv) && argv.length > 0 && argv.every(isNonEmptyString));
  }
  validateStringArray(provisioning.identityFiles, `${label} identityFiles`, isSafeRelativePath);
  assert.ok(provisioning.identityFiles.length > 0);
  assert.ok(isSha256(provisioning.identityFingerprint));
  assert.equal(provisioning.copyIdenticallyBetweenConditions, true);
}

function validateAgent(agent, label) {
  assert.ok(agent && typeof agent === 'object', label);
  for (const field of ['provider', 'surface', 'surfaceVersion', 'model', 'toolPolicy']) {
    assert.ok(isNonEmptyString(agent[field]), `${label} ${field}`);
  }
  assert.ok(agent.settings && typeof agent.settings === 'object' && !Array.isArray(agent.settings));
  assert.ok(Number.isInteger(agent.timeLimitSeconds) && agent.timeLimitSeconds > 0);
  assert.ok(Number.isInteger(agent.correctionRoundLimit) && agent.correctionRoundLimit >= 0);
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
  assert.equal(result.schemaVersion, task.schemaVersion, `${path} task/result schemaVersion`);
  assert.ok(task.coverageMatrix, `${path} included result requires a Coverage Matrix`);
  const preflightPath = safeEvaluationPath(result.preflightRecord);
  validatePreflightCoverage(task, readJson(preflightPath), `${path} preflight`);
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

function validatePreflightCoverage(task, preflight, label) {
  assert.equal(preflight.agent.model, task.agent.model, `${label} exact requested model`);
  const checks = new Map(task.acceptanceChecks.map((check) => [check.id, check]));
  const controls = new Map(task.coverageMatrix.negativeControls.map((control) => [control.id, control]));
  const fixtures = new Map(preflight.fixtures.map((fixture) => [fixture.acceptanceCheckId, fixture]));
  for (const check of task.acceptanceChecks.filter((item) =>
    item.visibility === 'evaluator-after-archive')) {
    const fixture = fixtures.get(check.id);
    assert.ok(fixture, `${label} missing fixture ${check.id}`);
    assert.equal(fixture.contentFingerprint, check.fixture.contentFingerprint);
    assert.equal(fixture.baselineActualExitCode, check.fixture.baselineExpectedExitCode);
    assert.equal(fixture.oracleActualExitCode, check.fixture.oracleExpectedExitCode);
  }
  for (const fixture of preflight.fixtures) {
    assert.equal(checks.get(fixture.acceptanceCheckId)?.visibility, 'evaluator-after-archive');
    for (const observed of fixture.negativeControls) {
      const registered = controls.get(observed.id);
      assert.ok(registered, `${label} unknown negative control ${observed.id}`);
      assert.ok(
        registered.expectedRejectedBy.includes(fixture.acceptanceCheckId),
        `${label} negative control ${observed.id} is not bound to ${fixture.acceptanceCheckId}`,
      );
    }
  }
  for (const control of controls.values()) {
    for (const assertionId of control.expectedRejectedBy) {
      assert.ok(
        fixtures.get(assertionId)?.negativeControls.some((observed) => observed.id === control.id),
        `${label} missing observed negative control ${control.id} for ${assertionId}`,
      );
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

function registrationFingerprint(task) {
  const { registrationFingerprint: _ignored, ...registration } = task;
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(registration))).digest('hex')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function validateStringArray(value, label, predicate) {
  assert.ok(Array.isArray(value), label);
  assert.equal(new Set(value).size, value.length, `${label} duplicates`);
  assert.ok(value.every(predicate), `${label} values`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
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
