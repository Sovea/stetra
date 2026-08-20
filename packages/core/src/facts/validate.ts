import type { TaskContract, VerificationDefinition } from '../delegation/types.ts';
import {
  isNonEmptyString,
  isSafeRepositoryPath,
  isSha256,
  isStableId,
  stableFingerprint,
} from '../shared/protocol.ts';
import type {
  ChangedFileFact,
  BaselineVerificationFact,
  CheckAttemptFact,
  CheckFact,
  CheckStepAttemptFact,
  ExecutionEnvironment,
  FactBundle,
  FileContentFact,
  VerifierMutation,
  VerificationInputSnapshot,
  WorktreeSummary,
} from './types.ts';

export function validateFactBundle(bundle: FactBundle, contract: TaskContract): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('evaluateHandoff factBundle must be an object.');
  }
  if (bundle.protocol !== contract.protocol || bundle.schemaVersion !== contract.schemaVersion) {
    throw new Error('evaluateHandoff Fact Bundle protocol does not match the Task Contract.');
  }
  if (bundle.effectiveContractId !== contract.effectiveContractId) {
    throw new Error('evaluateHandoff Fact Bundle is bound to another Task Contract.');
  }
  if (!isStableId(bundle.attemptId)) {
    throw new Error('evaluateHandoff Fact Bundle attempt id is invalid.');
  }
  if (!isSha256(bundle.factCollectionId)
    || !isSha256(bundle.bundleFingerprint)
    || !isSha256(bundle.changeFingerprint)) {
    throw new Error('evaluateHandoff Fact Bundle identities are invalid.');
  }
  if (!isIsoTimestamp(bundle.collectedAt)) {
    throw new Error('evaluateHandoff Fact Bundle collectedAt is invalid.');
  }
  validateWorktreeSummary(bundle.baseline, 'baseline');
  validateWorktreeSummary(bundle.preCheck, 'preCheck');
  validateWorktreeSummary(bundle.current, 'current');
  validateInputSnapshots(bundle.preCheckExecutionInputs, contract, 'preCheckExecutionInputs');
  validateInputSnapshots(bundle.currentExecutionInputs, contract, 'currentExecutionInputs');
  validateBaselineVerification(bundle.baselineVerification, contract);
  if (stableFingerprint(bundle.baseline) !== stableFingerprint(bundle.baselineVerification.postCheck)) {
    throw new Error('evaluateHandoff implementation baseline is not the post-baseline-check worktree.');
  }
  validateChangedFiles(bundle.changedFiles, 'changedFiles');
  validateChangedFiles(bundle.checkInducedChanges, 'checkInducedChanges');
  validateChecks(bundle.checks, contract);
  validateCheckComparisons(bundle, contract);
  validateVerifierMutations(bundle.verifierMutations, bundle.changedFiles, contract);
  validateEnvironment(bundle.environment);
  if (bundle.patch !== undefined) {
    if (!isSafeRepositoryPath(bundle.patch.path)
      || !isSha256(bundle.patch.digest)
      || !Number.isInteger(bundle.patch.byteLength)
      || bundle.patch.byteLength < 0) {
      throw new Error('evaluateHandoff patch fact is invalid.');
    }
  }
  if (bundle.changedFiles.some((file) => file.representation === 'text') && !bundle.patch) {
    throw new Error('evaluateHandoff text changes require an inspectable patch fact.');
  }
  if (bundle.provenance?.collector !== 'stetra-cli'
    || !isNonEmptyString(bundle.provenance.cliVersion)
    || !isNonEmptyString(bundle.provenance.coreVersion)) {
    throw new Error('evaluateHandoff Fact Bundle provenance is invalid.');
  }

  if (bundle.factCollectionId !== factCollectionId(bundle)) {
    throw new Error('evaluateHandoff Fact Bundle collection identity does not match its machine facts.');
  }
  if (bundle.bundleFingerprint !== factBundleFingerprint(bundle)) {
    throw new Error('evaluateHandoff Fact Bundle fingerprint does not match its content.');
  }
}

export function factCollectionId(
  bundle: Omit<FactBundle, 'factCollectionId' | 'bundleFingerprint'>,
): string {
  return stableFingerprint({
    protocol: bundle.protocol,
    schemaVersion: bundle.schemaVersion,
    effectiveContractId: bundle.effectiveContractId,
    attemptId: bundle.attemptId,
    baseline: bundle.baseline,
    preCheck: bundle.preCheck,
    current: bundle.current,
    preCheckExecutionInputs: bundle.preCheckExecutionInputs,
    currentExecutionInputs: bundle.currentExecutionInputs,
    baselineVerification: bundle.baselineVerification,
    changeFingerprint: bundle.changeFingerprint,
    changedFiles: bundle.changedFiles,
    checkInducedChanges: bundle.checkInducedChanges,
    checks: bundle.checks,
    checkComparisons: bundle.checkComparisons,
    verifierMutations: bundle.verifierMutations,
    environment: bundle.environment,
    patch: bundle.patch ?? null,
    provenance: bundle.provenance,
  });
}

function validateBaselineVerification(
  baseline: BaselineVerificationFact,
  contract: TaskContract,
): void {
  if (!baseline || !isSha256(baseline.fingerprint) || !isIsoTimestamp(baseline.capturedAt)) {
    throw new Error('evaluateHandoff baseline verification identity is invalid.');
  }
  validateWorktreeSummary(baseline.preCheck, 'baselineVerification.preCheck');
  validateWorktreeSummary(baseline.postCheck, 'baselineVerification.postCheck');
  validateInputSnapshots(
    baseline.preCheckExecutionInputs,
    contract,
    'baselineVerification.preCheckExecutionInputs',
  );
  validateInputSnapshots(
    baseline.postCheckExecutionInputs,
    contract,
    'baselineVerification.postCheckExecutionInputs',
  );
  validateChangedFiles(baseline.checkInducedChanges, 'baselineVerification.checkInducedChanges');
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  if (!Array.isArray(baseline.checks) || baseline.checks.length !== definitions.length) {
    throw new Error('evaluateHandoff baseline verification must cover every frozen check.');
  }
  for (const definition of definitions) {
    const fact = baseline.checks.find((item) => item.definitionId === definition.definitionId);
    if (!fact || (fact.mode !== definition.baseline.mode
      && !(definition.baseline.mode === 'task-start'
        && fact.mode === 'unknown-after-revision'))) {
      throw new Error(`evaluateHandoff baseline mode for ${definition.definitionId} is invalid.`);
    }
    if (definition.baseline.mode === 'unknown' || fact.mode === 'unknown-after-revision') {
      if (fact.observation !== null) {
        throw new Error(`evaluateHandoff unknown baseline ${definition.definitionId} cannot contain an observation.`);
      }
    } else {
      if (!fact.observation) {
        throw new Error(`evaluateHandoff observed baseline ${definition.definitionId} requires an observation.`);
      }
      validateCheckFact(fact.observation, definition);
    }
  }
  const { fingerprint: _ignored, ...projection } = baseline;
  if (baseline.fingerprint !== stableFingerprint(projection)) {
    throw new Error('evaluateHandoff baseline verification fingerprint is invalid.');
  }
}

function validateCheckComparisons(bundle: FactBundle, contract: TaskContract): void {
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  if (!Array.isArray(bundle.checkComparisons)
    || bundle.checkComparisons.length !== definitions.length) {
    throw new Error('evaluateHandoff check comparisons must cover every frozen check.');
  }
  const allowed = new Set([
    'baseline-unknown',
    'baseline-unknown-after-revision',
    'passed-before-passed-now', 'passed-before-failed-now', 'passed-before-unavailable-now',
    'failed-before-passed-now', 'failed-before-failed-now', 'failed-before-unavailable-now',
    'unavailable-before-passed-now', 'unavailable-before-failed-now',
    'unavailable-before-unavailable-now',
  ]);
  for (const definition of definitions) {
    const comparison = bundle.checkComparisons.find((item) =>
      item.definitionId === definition.definitionId);
    if (!comparison || !allowed.has(comparison.relation)) {
      throw new Error(`evaluateHandoff check comparison ${definition.definitionId} is invalid.`);
    }
    const baseline = bundle.baselineVerification.checks.find((item) =>
      item.definitionId === definition.definitionId)!;
    const current = bundle.checks.find((item) =>
      item.definitionId === definition.definitionId)!;
    const expected = baseline.mode === 'unknown-after-revision'
      ? 'baseline-unknown-after-revision'
      : baseline.mode === 'unknown' || !baseline.observation
        ? 'baseline-unknown'
      : `${latestStatus(baseline.observation)}-before-${latestStatus(current)}-now`;
    if (comparison.relation !== expected) {
      throw new Error(`evaluateHandoff check comparison ${definition.definitionId} does not match its observations.`);
    }
  }
}

function latestStatus(check: CheckFact): CheckAttemptFact['status'] {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`evaluateHandoff check ${check.definitionId} has no attempt.`);
  return latest.status;
}

export function factBundleFingerprint(
  bundle: Omit<FactBundle, 'bundleFingerprint'> | FactBundle,
): string {
  const { bundleFingerprint: _ignored, ...projection } = bundle as FactBundle;
  return stableFingerprint(projection);
}

export function checkDefinitionFingerprint(definition: VerificationDefinition): string {
  return stableFingerprint(definition);
}

function validateWorktreeSummary(summary: WorktreeSummary, name: string): void {
  if (!summary || (summary.head !== null && !isNonEmptyString(summary.head))
    || !isSha256(summary.fingerprint)
    || !Number.isInteger(summary.entryCount)
    || summary.entryCount < 0
    || !isIsoTimestamp(summary.capturedAt)) {
    throw new Error(`evaluateHandoff Fact Bundle ${name} worktree summary is invalid.`);
  }
}

function validateChangedFiles(files: ChangedFileFact[], name: string): void {
  if (!Array.isArray(files)) {
    throw new Error(`evaluateHandoff ${name} must be an array.`);
  }
  const ids = new Set<string>();
  for (const file of files) {
    if (!isStableId(file.id) || ids.has(file.id) || !isSafeRepositoryPath(file.path)
      || !['added', 'modified', 'deleted', 'renamed'].includes(file.operation)
      || !['text', 'binary', 'metadata-only', 'unrepresentable'].includes(file.representation)) {
      throw new Error(`evaluateHandoff ${name} contains an invalid changed-file fact.`);
    }
    ids.add(file.id);
    if ((file.operation === 'renamed') !== Boolean(file.previousPath)
      || (file.previousPath !== undefined && !isSafeRepositoryPath(file.previousPath))) {
      throw new Error(`evaluateHandoff ${name} rename fact is invalid.`);
    }
    if (file.before) validateFileContent(file.before, `${name} before`);
    if (file.after) validateFileContent(file.after, `${name} after`);
    if (file.patchDigest !== undefined && !isSha256(file.patchDigest)) {
      throw new Error(`evaluateHandoff ${name} patch digest is invalid.`);
    }
  }
}

function validateFileContent(content: FileContentFact, name: string): void {
  if (!['file', 'symlink', 'gitlink'].includes(content.kind)
    || !isSha256(content.contentDigest)
    || !/^[0-7]{6}$/.test(content.mode)) {
    throw new Error(`evaluateHandoff ${name} content fact is invalid.`);
  }
}

function validateChecks(checks: CheckFact[], contract: TaskContract): void {
  if (!Array.isArray(checks)) throw new Error('evaluateHandoff checks must be an array.');
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions
    : [];
  if (checks.length !== definitions.length) {
    throw new Error('evaluateHandoff Fact Bundle must contain every frozen check exactly once.');
  }
  for (const definition of definitions) {
    const fact = checks.find((item) => item.definitionId === definition.definitionId);
    if (!fact) throw new Error(`evaluateHandoff check ${definition.definitionId} is missing.`);
    validateCheckFact(fact, definition);
  }
}

function validateCheckFact(fact: CheckFact, definition: VerificationDefinition): void {
  if (fact.verifierId !== definition.verifierId
    || fact.definitionId !== definition.definitionId
    || fact.assertionArgv.length !== definition.execution.assertion.argv.length
    || fact.assertionArgv.some((arg, index) =>
      arg !== definition.execution.assertion.argv[index])
    || fact.definitionFingerprint !== checkDefinitionFingerprint(definition)
    || !fact.attempts.length) {
    throw new Error(`evaluateHandoff check ${definition.definitionId} does not match its frozen definition.`);
  }
  validateCheckAttempts(fact.attempts, definition);
}

function validateCheckAttempts(
  attempts: CheckAttemptFact[],
  definition: VerificationDefinition,
): void {
  const checkId = definition.definitionId;
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.attempt !== index + 1
      || !isIsoTimestamp(attempt.startedAt)
      || !Number.isInteger(attempt.durationMs)
      || attempt.durationMs < 0
      || !Number.isInteger(attempt.timeoutMs)
      || attempt.timeoutMs <= 0
      || !['passed', 'failed', 'unavailable'].includes(attempt.status)
      || !['preparation', 'assertion'].includes(attempt.observedPhase)
      || !validTermination(attempt.termination)
      || !validStatusForTermination(
        attempt.status,
        attempt.termination,
        attempt.observedPhase,
      )
      || !isSha256(attempt.outcomeFingerprint)) {
      throw new Error(`evaluateHandoff check ${checkId} attempt history is invalid.`);
    }
    validateStream(attempt.stdout, checkId);
    validateStream(attempt.stderr, checkId);
    validateAttemptSteps(attempt.steps, definition, attempt.timeoutMs);
    validateDefinitionInputSnapshot(
      attempt.executionInputs.beforePreparation,
      definition,
      `${checkId} beforePreparation`,
    );
    validateDefinitionInputSnapshot(
      attempt.executionInputs.readyForAssertion,
      definition,
      `${checkId} readyForAssertion`,
    );
    validateDefinitionInputSnapshot(
      attempt.executionInputs.afterAssertion,
      definition,
      `${checkId} afterAssertion`,
    );
    const terminal = attempt.steps.at(-1)!;
    if (terminal.role !== attempt.observedPhase
      || stableFingerprint(terminal.termination) !== stableFingerprint(attempt.termination)
      || stableFingerprint(terminal.stdout) !== stableFingerprint(attempt.stdout)
      || stableFingerprint(terminal.stderr) !== stableFingerprint(attempt.stderr)) {
      throw new Error(`evaluateHandoff check ${checkId} aggregate attempt does not match its terminal step.`);
    }
    if (index > 0) {
      const previous = attempts[index - 1];
      if (previous.termination.kind !== 'timeout' || attempt.timeoutMs <= previous.timeoutMs) {
        throw new Error(`evaluateHandoff check ${checkId} retry is not a monotonic timeout recovery.`);
      }
    }
  }
}

function validTermination(value: CheckAttemptFact['termination']): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'exit') return Number.isInteger(value.exitCode);
  if (value.kind === 'signal') return isNonEmptyString(value.signal);
  if (value.kind === 'timeout') {
    return value.signal === undefined || isNonEmptyString(value.signal);
  }
  return value.kind === 'spawn-error'
    && (value.code === undefined || isNonEmptyString(value.code));
}

function validStatusForTermination(
  status: CheckAttemptFact['status'],
  termination: CheckAttemptFact['termination'],
  observedPhase: CheckAttemptFact['observedPhase'],
): boolean {
  if (observedPhase === 'preparation') return status === 'unavailable';
  if (termination.kind === 'exit') {
    return termination.exitCode === 0 ? status === 'passed' : status === 'failed';
  }
  return status === 'unavailable';
}

function validateAttemptSteps(
  steps: CheckStepAttemptFact[],
  definition: VerificationDefinition,
  timeoutMs: number,
): void {
  const expected = [
    ...definition.execution.preparation.map((step) => ({
      ...step,
      role: 'preparation' as const,
    })),
    { ...definition.execution.assertion, role: 'assertion' as const },
  ];
  if (!Array.isArray(steps) || !steps.length || steps.length > expected.length) {
    throw new Error(`evaluateHandoff check ${definition.definitionId} step history is invalid.`);
  }
  for (const [index, step] of steps.entries()) {
    const frozen = expected[index];
    if (!frozen || step.stepId !== frozen.stepId || step.role !== frozen.role
      || step.key !== ('key' in frozen ? frozen.key : undefined)
      || stableFingerprint(step.argv) !== stableFingerprint(frozen.argv)
      || !isIsoTimestamp(step.startedAt)
      || !Number.isInteger(step.durationMs) || step.durationMs < 0
      || step.timeoutMs !== timeoutMs
      || !['passed', 'failed', 'unavailable'].includes(step.status)
      || !validTermination(step.termination)
      || !validStatusForTermination(step.status, step.termination, 'assertion')
      || !isSha256(step.outcomeFingerprint)) {
      throw new Error(`evaluateHandoff check ${definition.definitionId} contains an invalid execution step.`);
    }
    validateStream(step.stdout, definition.definitionId);
    validateStream(step.stderr, definition.definitionId);
    if (index < steps.length - 1 && step.status !== 'passed') {
      throw new Error(`evaluateHandoff check ${definition.definitionId} continued after a non-passing preparation step.`);
    }
  }
  const terminal = steps.at(-1)!;
  if (terminal.role === 'preparation' && terminal.status === 'passed') {
    throw new Error(`evaluateHandoff check ${definition.definitionId} omitted its assertion after successful preparation.`);
  }
}

function validateInputSnapshots(
  snapshots: VerificationInputSnapshot[],
  contract: TaskContract,
  name: string,
): void {
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  if (!Array.isArray(snapshots) || snapshots.length !== definitions.length) {
    throw new Error(`evaluateHandoff ${name} must cover every frozen check.`);
  }
  for (const definition of definitions) {
    const snapshot = snapshots.find((item) => item.definitionId === definition.definitionId);
    if (!snapshot) throw new Error(`evaluateHandoff ${name} is missing ${definition.definitionId}.`);
    validateDefinitionInputSnapshot(snapshot, definition, name);
  }
}

function validateDefinitionInputSnapshot(
  snapshot: VerificationInputSnapshot,
  definition: VerificationDefinition,
  name: string,
): void {
  if (!snapshot || snapshot.definitionId !== definition.definitionId
    || !isIsoTimestamp(snapshot.capturedAt)
    || !Array.isArray(snapshot.inputs)
    || snapshot.inputs.length !== definition.executionInputs.length
    || !isSha256(snapshot.fingerprint)) {
    throw new Error(`evaluateHandoff ${name} execution-input snapshot is invalid.`);
  }
  for (const selector of definition.executionInputs) {
    const input = snapshot.inputs.find((item) =>
      stableFingerprint(item.selector) === stableFingerprint(selector));
    if (!input || !['missing', 'present'].includes(input.state)
      || !Array.isArray(input.entries) || !isSha256(input.fingerprint)
      || (input.state === 'missing' && input.entries.length)) {
      throw new Error(`evaluateHandoff ${name} execution-input selector is invalid.`);
    }
    for (const entry of input.entries) {
      if (!isSafeRepositoryPath(entry.path)
        || !['file', 'symlink'].includes(entry.kind)
        || !isSha256(entry.contentDigest)
        || !/^[0-7]{6}$/.test(entry.mode)
        || !Number.isInteger(entry.byteLength) || entry.byteLength < 0) {
        throw new Error(`evaluateHandoff ${name} execution-input entry is invalid.`);
      }
    }
    const { fingerprint: _fingerprint, ...inputProjection } = input;
    if (input.fingerprint !== stableFingerprint(inputProjection)) {
      throw new Error(`evaluateHandoff ${name} execution-input selector fingerprint is invalid.`);
    }
  }
  const projection = {
    definitionId: snapshot.definitionId,
    inputs: snapshot.inputs,
  };
  if (snapshot.fingerprint !== stableFingerprint(projection)) {
    throw new Error(`evaluateHandoff ${name} execution-input snapshot fingerprint is invalid.`);
  }
}

function validateStream(stream: CheckAttemptFact['stdout'], checkId: string): void {
  if (!isSha256(stream.digest)
    || !Number.isInteger(stream.byteLength)
    || stream.byteLength < 0
    || !Number.isInteger(stream.persistedBytes)
    || stream.persistedBytes < 0
    || stream.persistedBytes > stream.byteLength
    || typeof stream.truncated !== 'boolean'
    || (stream.logPath !== undefined && !isSafeRepositoryPath(stream.logPath))) {
    throw new Error(`evaluateHandoff check ${checkId} stream fact is invalid.`);
  }
}

function validateVerifierMutations(
  mutations: VerifierMutation[],
  changedFiles: ChangedFileFact[],
  contract: TaskContract,
): void {
  if (!Array.isArray(mutations)) {
    throw new Error('evaluateHandoff verifier mutations must be an array.');
  }
  const filesById = new Map(changedFiles.map((file) => [file.id, file]));
  const checksById = new Map(
    contract.verificationPlan.mode === 'checks'
      ? contract.verificationPlan.definitions.map((check) => [check.definitionId, check])
      : [],
  );
  for (const mutation of mutations) {
    const check = checksById.get(mutation.definitionId);
    const file = filesById.get(mutation.changedFileId);
    const matchingRef = check?.verifierRefs.find((ref) =>
      stableFingerprint(ref) === stableFingerprint(mutation.selector));
    if (!check || mutation.verifierId !== check.verifierId || !file
      || mutation.changedPath !== file.path || !matchingRef
      || selectorMatch(matchingRef, file) !== mutation.matchedBy) {
      throw new Error('evaluateHandoff verifier mutation is not bound to a changed verifier surface.');
    }
  }
  const expected = [...checksById.values()].flatMap((check) =>
    check.verifierRefs.flatMap((reference) => {
      return changedFiles.flatMap((file) => {
        const matchedBy = selectorMatch(reference, file);
        return matchedBy ? [{
          verifierId: check.verifierId,
          definitionId: check.definitionId,
          selector: reference,
          changedFileId: file.id,
          changedPath: file.path,
          matchedBy,
        }] : [];
      });
    })).sort(mutationOrder);
  const actual = [...mutations].sort(mutationOrder);
  if (stableFingerprint(actual) !== stableFingerprint(expected)) {
    throw new Error('evaluateHandoff verifier mutations do not completely match declared changed surfaces.');
  }
}

function mutationOrder(left: VerifierMutation, right: VerifierMutation): number {
  return left.definitionId.localeCompare(right.definitionId)
    || left.selector.role.localeCompare(right.selector.role)
    || left.selector.kind.localeCompare(right.selector.kind)
    || left.selector.path.localeCompare(right.selector.path)
    || left.changedPath.localeCompare(right.changedPath)
    || left.changedFileId.localeCompare(right.changedFileId);
}

function selectorMatch(
  selector: VerificationDefinition['verifierRefs'][number],
  file: ChangedFileFact,
): VerifierMutation['matchedBy'] | undefined {
  if (pathMatchesSelector(file.path, selector)) return 'current-path';
  if (file.previousPath && pathMatchesSelector(file.previousPath, selector)) return 'previous-path';
  return undefined;
}

function pathMatchesSelector(
  path: string,
  selector: { kind: 'file' | 'tree'; path: string },
): boolean {
  return selector.kind === 'file'
    ? path === selector.path
    : path === selector.path || path.startsWith(`${selector.path}/`);
}

function validateEnvironment(environment: ExecutionEnvironment): void {
  if (!environment
    || !isNonEmptyString(environment.platform)
    || !isNonEmptyString(environment.architecture)
    || !isSha256(environment.cwdFingerprint)
    || !Array.isArray(environment.executables)
    || !Array.isArray(environment.toolchains)
    || !Array.isArray(environment.lockfiles)
    || !Array.isArray(environment.environmentVariableNames)) {
    throw new Error('evaluateHandoff execution environment is invalid.');
  }
  for (const executable of environment.executables) {
    if (!isNonEmptyString(executable.command)
      || (executable.resolvedPath !== null && !isNonEmptyString(executable.resolvedPath))
      || (executable.version !== null && !isNonEmptyString(executable.version))) {
      throw new Error('evaluateHandoff executable environment fact is invalid.');
    }
  }
  for (const toolchain of environment.toolchains) {
    if (!isNonEmptyString(toolchain.name) || !isNonEmptyString(toolchain.version)) {
      throw new Error('evaluateHandoff toolchain environment fact is invalid.');
    }
  }
  for (const lockfile of environment.lockfiles) {
    if (!isSafeRepositoryPath(lockfile.path) || !isSha256(lockfile.digest)) {
      throw new Error('evaluateHandoff lockfile environment fact is invalid.');
    }
  }
  if (environment.environmentVariableNames.some((name) =>
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw new Error('evaluateHandoff environment variable names are invalid.');
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
