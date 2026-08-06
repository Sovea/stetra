import type { SemanticContract, VerificationDefinition } from '../delegation/types.ts';
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
  FactBundle,
  FileContentFact,
  VerifierMutation,
  WorktreeSummary,
} from './types.ts';

export function validateFactBundle(bundle: FactBundle, contract: SemanticContract): void {
  if (!bundle || typeof bundle !== 'object') throw new Error('evaluateHandoff factBundle must be an object.');
  if (bundle.protocol !== contract.protocol || bundle.schemaVersion !== contract.schemaVersion) {
    throw new Error('evaluateHandoff Fact Bundle protocol does not match the Semantic Contract.');
  }
  if (bundle.contractId !== contract.contractId) {
    throw new Error('evaluateHandoff Fact Bundle is bound to another Semantic Contract.');
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
  validateWorktreeSummary(bundle.current, 'current');
  validateChangedFiles(bundle.changedFiles);
  validateChecks(bundle.checks, contract);
  validateVerifierMutations(bundle.verifierMutations, bundle.changedFiles, contract);
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

  const expectedCollectionId = factCollectionId(bundle);
  if (bundle.factCollectionId !== expectedCollectionId) {
    throw new Error('evaluateHandoff Fact Bundle collection identity does not match its machine facts.');
  }
  const expectedBundleFingerprint = factBundleFingerprint(bundle);
  if (bundle.bundleFingerprint !== expectedBundleFingerprint) {
    throw new Error('evaluateHandoff Fact Bundle fingerprint does not match its content.');
  }
}

export function factCollectionId(bundle: Omit<FactBundle, 'factCollectionId' | 'bundleFingerprint'>): string {
  return stableFingerprint({
    contractId: bundle.contractId,
    baselineFingerprint: bundle.baseline.fingerprint,
    currentFingerprint: bundle.current.fingerprint,
    changeFingerprint: bundle.changeFingerprint,
    changedFiles: bundle.changedFiles,
    checks: bundle.checks,
    verifierMutations: bundle.verifierMutations,
    patch: bundle.patch ?? null,
  });
}

export function factBundleFingerprint(bundle: Omit<FactBundle, 'bundleFingerprint'>): string {
  const { bundleFingerprint: _ignored, ...projection } = bundle as FactBundle;
  return stableFingerprint(projection);
}

export function checkDefinitionFingerprint(definition: VerificationDefinition): string {
  return stableFingerprint(definition);
}

export function changedFileMechanicalStatement(file: ChangedFileFact): string {
  if (file.operation === 'renamed') {
    return `File ${file.previousPath} was renamed to ${file.path}.`;
  }
  return `File ${file.path} was ${file.operation}.`;
}

export function checkMechanicalStatement(check: CheckFact): string {
  const latest = check.attempts.at(-1);
  return `Check ${check.id} was ${latest?.status ?? 'unavailable'} after ${check.attempts.length} attempt${check.attempts.length === 1 ? '' : 's'}.`;
}

function validateWorktreeSummary(value: WorktreeSummary, label: string): void {
  if (!value
    || (value.head !== null && !isNonEmptyString(value.head))
    || !isSha256(value.fingerprint)
    || !Number.isInteger(value.entryCount)
    || value.entryCount < 0
    || !isIsoTimestamp(value.capturedAt)) {
    throw new Error(`evaluateHandoff ${label} worktree summary is invalid.`);
  }
}

function validateChangedFiles(files: ChangedFileFact[]): void {
  if (!Array.isArray(files)) throw new Error('evaluateHandoff changedFiles must be an array.');
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const file of files) {
    if (!isStableId(file?.id) || ids.has(file.id)) {
      throw new Error('evaluateHandoff changed-file ids must be unique and stable.');
    }
    ids.add(file.id);
    if (!isSafeRepositoryPath(file.path) || paths.has(file.path)) {
      throw new Error('evaluateHandoff changed-file paths must be unique and repository-relative.');
    }
    paths.add(file.path);
    if (!['added', 'modified', 'deleted', 'renamed'].includes(file.operation)
      || !['text', 'binary', 'metadata-only', 'unrepresentable'].includes(file.representation)) {
      throw new Error(`evaluateHandoff changed-file ${file.id} has an invalid operation or representation.`);
    }
    if (file.patchDigest !== undefined && !isSha256(file.patchDigest)) {
      throw new Error(`evaluateHandoff changed-file ${file.id} patch digest is invalid.`);
    }
    if (file.operation === 'renamed') {
      if (!isSafeRepositoryPath(file.previousPath)) {
        throw new Error(`evaluateHandoff renamed file ${file.id} requires previousPath.`);
      }
    } else if (file.previousPath !== undefined) {
      throw new Error(`evaluateHandoff previousPath is valid only for renamed files.`);
    }
    if (file.operation === 'added') {
      if (file.before !== undefined || !file.after) throw new Error(`evaluateHandoff added file ${file.id} facts are invalid.`);
    } else if (file.operation === 'deleted') {
      if (!file.before || file.after !== undefined) throw new Error(`evaluateHandoff deleted file ${file.id} facts are invalid.`);
    } else if (!file.before || !file.after) {
      throw new Error(`evaluateHandoff ${file.operation} file ${file.id} requires before and after facts.`);
    }
    if (file.before) validateFileContent(file.before, `${file.id}.before`);
    if (file.after) validateFileContent(file.after, `${file.id}.after`);
  }
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(ordered) !== JSON.stringify(files)) {
    throw new Error('evaluateHandoff changed files must use canonical path ordering.');
  }
}

function validateFileContent(value: FileContentFact, label: string): void {
  if (!['file', 'symlink', 'gitlink'].includes(value.kind)
    || !isSha256(value.contentDigest)
    || !/^[0-7]{6}$/.test(value.mode)) {
    throw new Error(`evaluateHandoff file fact ${label} is invalid.`);
  }
  if ((value.kind === 'gitlink') !== (value.mode === '160000')) {
    throw new Error(`evaluateHandoff Git link fact ${label} has an invalid mode.`);
  }
}

function validateChecks(checks: CheckFact[], contract: SemanticContract): void {
  if (!Array.isArray(checks)) throw new Error('evaluateHandoff checks must be an array.');
  const expected = contract.verification.mode === 'checks'
    ? contract.verification.checks
    : [];
  if (checks.length !== expected.length) {
    throw new Error('evaluateHandoff checks do not match the frozen verification definitions.');
  }
  const expectedById = new Map(expected.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  for (const check of checks) {
    const definition = expectedById.get(check?.id);
    if (!definition || seen.has(check.id)) {
      throw new Error(`evaluateHandoff received an unknown or duplicate check ${JSON.stringify(check?.id)}.`);
    }
    seen.add(check.id);
    if (JSON.stringify(check.argv) !== JSON.stringify(definition.argv)
      || check.definitionFingerprint !== checkDefinitionFingerprint(definition)
      || !Array.isArray(check.attempts)
      || !check.attempts.length) {
      throw new Error(`evaluateHandoff check ${check.id} is not bound to its frozen definition.`);
    }
    for (const [index, attempt] of check.attempts.entries()) {
      validateCheckAttempt(attempt, check.id, index);
      if (index > 0 && attempt.timeoutMs <= check.attempts[index - 1].timeoutMs) {
        throw new Error(`evaluateHandoff check ${check.id} retry timeouts must increase monotonically.`);
      }
      if (index < check.attempts.length - 1
        && (!attempt.timedOut || attempt.status !== 'unavailable')) {
        throw new Error(`evaluateHandoff check ${check.id} may retry only a timed-out attempt.`);
      }
    }
  }
}

function validateCheckAttempt(
  attempt: CheckAttemptFact,
  checkId: string,
  index: number,
): void {
  if (!attempt
    || attempt.attempt !== index + 1
    || !Number.isSafeInteger(attempt.timeoutMs)
    || attempt.timeoutMs < 1
    || !['passed', 'failed', 'unavailable'].includes(attempt.status)
    || typeof attempt.timedOut !== 'boolean'
    || !isSha256(attempt.outputDigest)) {
    throw new Error(`evaluateHandoff check ${checkId} attempt ${index + 1} is invalid.`);
  }
  if (attempt.status === 'passed' && (attempt.exitCode !== 0 || attempt.timedOut)) {
    throw new Error(`evaluateHandoff passing check ${checkId} attempt requires exit code 0.`);
  }
  if (attempt.status === 'failed'
    && (!Number.isInteger(attempt.exitCode) || attempt.exitCode === 0 || attempt.timedOut)) {
    throw new Error(`evaluateHandoff failed check ${checkId} attempt requires a non-zero exit code.`);
  }
  if (attempt.status === 'unavailable'
    && (attempt.exitCode !== null || !isNonEmptyString(attempt.reason))) {
    throw new Error(`evaluateHandoff unavailable check ${checkId} attempt requires a reason and no exit code.`);
  }
  if (attempt.timedOut && attempt.status !== 'unavailable') {
    throw new Error(`evaluateHandoff timed-out check ${checkId} attempt must be unavailable.`);
  }
  validateStream(attempt.stdout, `${checkId}.attempts[${index}].stdout`);
  validateStream(attempt.stderr, `${checkId}.attempts[${index}].stderr`);
}

function validateStream(stream: CheckAttemptFact['stdout'], label: string): void {
  if (!stream
    || !isSha256(stream.digest)
    || !Number.isInteger(stream.byteLength)
    || stream.byteLength < 0
    || !Number.isInteger(stream.persistedBytes)
    || stream.persistedBytes < 0
    || stream.persistedBytes > stream.byteLength
    || typeof stream.truncated !== 'boolean'
    || (stream.truncated !== (stream.persistedBytes < stream.byteLength))
    || (stream.byteLength === 0 && stream.logPath !== undefined)
    || (stream.logPath !== undefined && !isSafeRepositoryPath(stream.logPath))) {
    throw new Error(`evaluateHandoff check stream ${label} is invalid.`);
  }
}

function validateVerifierMutations(
  mutations: VerifierMutation[],
  files: ChangedFileFact[],
  contract: SemanticContract,
): void {
  if (!Array.isArray(mutations)) throw new Error('evaluateHandoff verifierMutations must be an array.');
  const changedByPath = new Map<string, ChangedFileFact>();
  for (const file of files) {
    changedByPath.set(file.path, file);
    if (file.previousPath) changedByPath.set(file.previousPath, file);
  }
  const expected: VerifierMutation[] = contract.verification.mode === 'checks'
    ? contract.verification.checks.flatMap((check) =>
        check.verifierRefs.flatMap((verifierRef) => {
          const file = changedByPath.get(verifierRef.path);
          return file
            ? [{
                checkId: check.id,
                path: verifierRef.path,
                role: verifierRef.role,
                changedFileId: file.id,
              }]
            : [];
        }))
    : [];
  const sort = (items: VerifierMutation[]) => [...items].sort((left, right) =>
    left.checkId.localeCompare(right.checkId)
      || left.path.localeCompare(right.path)
      || left.role.localeCompare(right.role)
      || left.changedFileId.localeCompare(right.changedFileId));
  if (JSON.stringify(sort(mutations)) !== JSON.stringify(sort(expected))) {
    throw new Error('evaluateHandoff verifier mutations do not match changed verifier refs.');
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}
