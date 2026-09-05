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
  CheckAttemptFact,
  CheckFact,
  CheckStepAttemptFact,
  ExecutionEnvironment,
  FactBundle,
  FileContentFact,
  VerificationInputSnapshot,
  WorktreeSummary,
} from './types.ts';

export function validateFactBundle(bundle: FactBundle, contract: TaskContract): void {
  if (!bundle || typeof bundle !== 'object') throw new Error('Fact Bundle must be an object.');
  if (bundle.protocol !== contract.protocol || bundle.schemaVersion !== contract.schemaVersion) {
    throw new Error('Fact Bundle protocol does not match the Task Contract.');
  }
  if (bundle.effectiveContractId !== contract.effectiveContractId
    || !isStableId(bundle.attemptId)
    || !isSha256(bundle.factCollectionId)
    || !isSha256(bundle.changeFingerprint)) {
    throw new Error('Fact Bundle identity is invalid.');
  }
  validateWorktree(bundle.baseline, 'baseline');
  validateWorktree(bundle.preCheck, 'preCheck');
  validateWorktree(bundle.current, 'current');
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  validateSnapshots(bundle.preCheckExecutionInputs, definitions, 'preCheckExecutionInputs');
  validateSnapshots(bundle.currentExecutionInputs, definitions, 'currentExecutionInputs');
  validateChangedFiles(bundle.changedFiles, 'changedFiles');
  validateChangedFiles(bundle.checkInducedChanges, 'checkInducedChanges');
  validateChecks(bundle.checks, definitions);
  validateVerifierMutations(bundle, definitions);
  validateEnvironment(bundle.environment);
  if (bundle.refresh !== undefined && (
    !isSha256(bundle.refresh.priorFactCollectionId)
    || bundle.refresh.priorFactCollectionId === bundle.factCollectionId
    || bundle.refresh.authority !== 'agent-judgment'
    || !isNonEmptyString(bundle.refresh.reason)
  )) {
    throw new Error('Fact refresh requires a prior collection and an Agent-authored reason.');
  }
  if (bundle.patch !== undefined) {
    if (!isSafeRepositoryPath(bundle.patch.path) || !isSha256(bundle.patch.digest)
      || !Number.isSafeInteger(bundle.patch.byteLength) || bundle.patch.byteLength < 0) {
      throw new Error('Fact Bundle patch is invalid.');
    }
  }
  if (bundle.changedFiles.some((file) => file.representation === 'text') && !bundle.patch) {
    throw new Error('Text changes require an inspectable patch.');
  }
  if (bundle.provenance?.collector !== 'stetra-cli'
    || !isNonEmptyString(bundle.provenance.cliVersion)
    || !isNonEmptyString(bundle.provenance.coreVersion)) {
    throw new Error('Fact Bundle provenance is invalid.');
  }
  if (bundle.factCollectionId !== factCollectionId(bundle)) {
    throw new Error('Fact Bundle identity does not match its machine facts.');
  }
}

export function factCollectionId(bundle: Omit<FactBundle, 'factCollectionId'> | FactBundle): string {
  const { factCollectionId: _ignored, ...projection } = bundle as FactBundle;
  return stableFingerprint(projection);
}

export function checkDefinitionFingerprint(definition: VerificationDefinition): string {
  return stableFingerprint(definition);
}

function validateWorktree(value: WorktreeSummary, label: string): void {
  if (!value || (value.head !== null && !isNonEmptyString(value.head))
    || !isSha256(value.fingerprint)
    || !Number.isSafeInteger(value.entryCount) || value.entryCount < 0) {
    throw new Error(`Fact Bundle ${label} worktree is invalid.`);
  }
}

function validateSnapshots(
  values: VerificationInputSnapshot[],
  definitions: VerificationDefinition[],
  label: string,
): void {
  if (!Array.isArray(values) || values.length !== definitions.length) {
    throw new Error(`Fact Bundle ${label} must cover every Check.`);
  }
  for (const definition of definitions) {
    const snapshot = values.find((item) => item.definitionId === definition.definitionId);
    if (!snapshot || !isSha256(snapshot.fingerprint)
      || snapshot.fingerprint !== stableFingerprint({
        definitionId: snapshot.definitionId,
        inputs: snapshot.inputs,
      })) {
      throw new Error(`Fact Bundle ${label} for ${definition.key} is invalid.`);
    }
    if (snapshot.inputs.length !== definition.executionInputs.length) {
      throw new Error(`Fact Bundle ${label} for ${definition.key} omits execution inputs.`);
    }
    for (const selector of snapshot.inputs) {
      if (!['missing', 'present'].includes(selector.state)
        || !['file', 'tree'].includes(selector.selector.kind)
        || !isSafeRepositoryPath(selector.selector.path)
        || !isSha256(selector.fingerprint)) {
        throw new Error(`Fact Bundle ${label} contains an invalid input selector.`);
      }
    }
  }
}

function validateChangedFiles(values: ChangedFileFact[], label: string): void {
  if (!Array.isArray(values)) throw new Error(`Fact Bundle ${label} must be an array.`);
  const ids = new Set<string>();
  for (const file of values) {
    if (!isStableId(file.id) || ids.has(file.id) || !isSafeRepositoryPath(file.path)
      || !['added', 'modified', 'deleted', 'renamed'].includes(file.operation)
      || !['text', 'binary', 'metadata-only', 'unrepresentable'].includes(file.representation)) {
      throw new Error(`Fact Bundle ${label} contains an invalid changed file.`);
    }
    ids.add(file.id);
    if ((file.operation === 'renamed') !== Boolean(file.previousPath)
      || (file.previousPath !== undefined && !isSafeRepositoryPath(file.previousPath))) {
      throw new Error(`Fact Bundle ${label} contains an invalid rename.`);
    }
    if (file.before) validateFileContent(file.before);
    if (file.after) validateFileContent(file.after);
    if (file.patchDigest !== undefined && !isSha256(file.patchDigest)) {
      throw new Error(`Fact Bundle ${label} contains an invalid patch digest.`);
    }
  }
}

function validateFileContent(value: FileContentFact): void {
  if (!['file', 'symlink', 'gitlink'].includes(value.kind)
    || !isSha256(value.contentDigest) || !/^[0-7]{6}$/.test(value.mode)) {
    throw new Error('Fact Bundle file content is invalid.');
  }
}

function validateChecks(values: CheckFact[], definitions: VerificationDefinition[]): void {
  if (!Array.isArray(values) || values.length !== definitions.length) {
    throw new Error('Fact Bundle must contain every frozen Check exactly once.');
  }
  for (const definition of definitions) {
    const fact = values.find((item) => item.definitionId === definition.definitionId);
    if (!fact || fact.verifierId !== definition.verifierId
      || fact.definitionFingerprint !== checkDefinitionFingerprint(definition)
      || stableFingerprint(fact.assertionArgv) !== stableFingerprint(definition.execution.assertion.argv)
      || !fact.attempts.length) {
      throw new Error(`Fact Bundle Check ${definition.key} does not match its definition.`);
    }
    for (const [index, attempt] of fact.attempts.entries()) validateAttempt(attempt, definition, index);
  }
}

function validateAttempt(
  attempt: CheckAttemptFact,
  definition: VerificationDefinition,
  index: number,
): void {
  if (attempt.attempt !== index + 1 || !Number.isSafeInteger(attempt.durationMs)
    || attempt.durationMs < 0 || !Number.isSafeInteger(attempt.timeoutMs)
    || attempt.timeoutMs < 1 || !['passed', 'failed', 'unavailable'].includes(attempt.status)
    || !['preparation', 'assertion'].includes(attempt.observedPhase)
    || !isSha256(attempt.outcomeFingerprint) || !attempt.steps.length) {
    throw new Error(`Fact Bundle Check ${definition.key} has an invalid Attempt.`);
  }
  const expectedSteps = [...definition.execution.preparation, definition.execution.assertion];
  for (const [stepIndex, step] of attempt.steps.entries()) {
    validateStep(step, expectedSteps[stepIndex]);
  }
  if (attempt.steps.length > expectedSteps.length) {
    throw new Error(`Fact Bundle Check ${definition.key} has extra execution steps.`);
  }
  for (const snapshot of Object.values(attempt.executionInputs)) {
    if (snapshot.definitionId !== definition.definitionId) {
      throw new Error(`Fact Bundle Check ${definition.key} has mismatched execution inputs.`);
    }
  }
}

function validateStep(
  step: CheckStepAttemptFact,
  expected: VerificationDefinition['execution']['preparation'][number]
    | VerificationDefinition['execution']['assertion']
    | undefined,
): void {
  if (!expected || step.stepId !== expected.stepId
    || stableFingerprint(step.argv) !== stableFingerprint(expected.argv)
    || !['preparation', 'assertion'].includes(step.role)
    || !['passed', 'failed', 'unavailable'].includes(step.status)
    || !Number.isSafeInteger(step.durationMs) || step.durationMs < 0
    || !Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 1
    || !isSha256(step.outcomeFingerprint)) {
    throw new Error('Fact Bundle contains an invalid Check step.');
  }
  validateStream(step.stdout);
  validateStream(step.stderr);
}

function validateStream(value: CheckStepAttemptFact['stdout']): void {
  if (!isSha256(value.digest) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0
    || !Number.isSafeInteger(value.persistedBytes) || value.persistedBytes < 0
    || value.persistedBytes > value.byteLength || value.truncated !== (value.persistedBytes < value.byteLength)
    || (value.logPath !== undefined && !isSafeRepositoryPath(value.logPath))) {
    throw new Error('Fact Bundle contains an invalid Check stream.');
  }
}

function validateVerifierMutations(
  bundle: FactBundle,
  definitions: VerificationDefinition[],
): void {
  const fileIds = new Set(bundle.changedFiles.map((file) => file.id));
  for (const mutation of bundle.verifierMutations) {
    const definition = definitions.find((item) => item.definitionId === mutation.definitionId);
    if (!definition || definition.verifierId !== mutation.verifierId
      || !fileIds.has(mutation.changedFileId) || !isSafeRepositoryPath(mutation.changedPath)
      || !['current-path', 'previous-path'].includes(mutation.matchedBy)
      || !definition.verifierRefs.some((ref) => stableFingerprint(ref) === stableFingerprint(mutation.selector))) {
      throw new Error('Fact Bundle contains an invalid verifier mutation.');
    }
  }
}

function validateEnvironment(value: ExecutionEnvironment): void {
  if (!value || !isNonEmptyString(value.platform) || !isNonEmptyString(value.architecture)
    || !Array.isArray(value.executables)) {
    throw new Error('Fact Bundle environment is invalid.');
  }
  for (const executable of value.executables) {
    if (!isNonEmptyString(executable.command)
      || (executable.resolvedPath !== null && !isNonEmptyString(executable.resolvedPath))) {
      throw new Error('Fact Bundle executable environment is invalid.');
    }
  }
}
