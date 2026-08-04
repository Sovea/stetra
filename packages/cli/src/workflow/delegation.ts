/** CLI-owned prepare/collect orchestration for the Semantic Handoff protocol. */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type CompileDelegationInput,
  type FactBundle,
  type HandoffEvaluation,
  type HandoffValidationIssue,
  type SemanticContract,
  type VerifierMutation,
} from '@sovea/resonant-code-core';

import { inputError, usageError } from '../errors.ts';
import { runFrozenChecks } from '../facts/checks.ts';
import { materializeEvidenceWindows } from '../facts/evidence.ts';
import {
  assertWorktreeSnapshot,
  captureGitWorktree,
  collectGitWorktreeChange,
  summarizeWorktree,
  type WorktreeSnapshot,
} from '../facts/worktree.ts';
import { resolveExecutable } from '../infrastructure/executable.ts';
import { renderCognitiveHandoffMarkdown } from '../presentation/handoff.ts';
import { summarizeVerifierSurfaces } from '../presentation/verifiers.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
} from '../protocol.ts';
import { assertNoLegacyArtifacts } from '../project/legacy.ts';
import {
  CognitiveHandoffDocumentSchema,
  DelegationPrepareDocumentSchema,
  DelegationRunSchema,
  type DelegationPrepareDocument,
} from '../schemas/delegation.ts';
import { parseArtifact } from '../validation.ts';

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_COMPLETED_RUNS = 50;
const WORKTREE_OBJECTS_DIRECTORY = 'worktree-objects';

export interface DelegationRun {
  protocol: typeof DELEGATION_PROTOCOL;
  schemaVersion: typeof DELEGATION_SCHEMA_VERSION;
  runId: string;
  workflow: 'semantic-handoff';
  state: 'prepared' | 'facts-collected' | 'completed';
  projectRoot: string;
  createdAt: string;
  packageIdentity: {
    cli: { name: '@sovea/resonant-code'; version: string };
    core: { name: '@sovea/resonant-code-core'; version: string };
  };
  contract: SemanticContract;
  worktreeBaseline: WorktreeSnapshot;
  factBundle?: FactBundle;
  handoffFile?: 'handoff.json';
  completion?: {
    completedAt: string;
    handoffFingerprint: string;
    evaluation: unknown;
  };
}

export async function prepareDelegationTask(options: {
  projectRoot: string;
  inputPath: string;
  input?: Readable;
  productVersion: string;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  assertNoLegacyArtifacts(projectRoot);
  const source = await readPrepareDocument(projectRoot, options.inputPath, options.input);
  const repositoryEvidence = materializeEvidenceWindows(
    projectRoot,
    source.repositoryEvidence ?? [],
  );
  const compileInput: CompileDelegationInput = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    humanEvents: source.humanEvents.map((event) => ({
      ...event,
      contentFingerprint: event.contentFingerprint ?? sha256(event.content),
    })),
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
    semantic: source.semantic,
    verification: source.verification,
  };
  const compiled = compileDelegation(compileInput);
  if (compiled.status !== 'delegation-compiled') {
    return {
      ...compiled,
      runCreated: false,
      nextStep: compileNextStep(compiled.status),
    };
  }
  const unavailableExecutables = compiled.contract.verification.mode === 'checks'
    ? compiled.contract.verification.checks.flatMap((check, index) => {
        const resolution = resolveExecutable(check.argv[0], projectRoot);
        return resolution.status === 'unavailable'
          ? [{ check, index, reason: resolution.error.message }]
          : [];
      })
    : [];
  if (unavailableExecutables.length) {
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'verification-required' as const,
      message: 'One or more configured top-level check executables are unavailable; no run may be created.',
      issues: unavailableExecutables.map(({ check, index, reason }) => ({
        code: 'verification-executable-unavailable',
        path: `verification.checks[${index}].argv[0]`,
        message: `Check ${check.id} cannot resolve executable ${JSON.stringify(check.argv[0])}: ${reason}`,
        remediation: 'Restore the executable in the configured command environment or select a different explicit verification command.',
      })),
      runCreated: false,
      nextStep: 'Restore each exact top-level executable or select a runnable explicit check, then prepare again.',
    };
  }

  const runId = randomUUID();
  const runDirectory = resolveRunDirectory(projectRoot, runId);
  try {
    mkdirSync(dirname(runDirectory), { recursive: true });
    mkdirSync(runDirectory, { recursive: false });
    const worktreeBaseline = await captureGitWorktree(projectRoot, {
      objectDirectory: worktreeObjectDirectory(runDirectory),
    });
    const run: DelegationRun = {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      runId,
      workflow: 'semantic-handoff',
      state: 'prepared',
      projectRoot,
      createdAt: new Date().toISOString(),
      packageIdentity: {
        cli: { name: '@sovea/resonant-code', version: options.productVersion },
        core: { name: '@sovea/resonant-code-core', version: options.productVersion },
      },
      contract: compiled.contract,
      worktreeBaseline,
    };
    writeJsonAtomic(join(runDirectory, 'run.json'), run);
    return {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      status: 'prepared',
      runId,
      semanticContract: contractWorkPacket(compiled.contract),
      baseline: summarizeWorktree(worktreeBaseline),
      details: {
        runPath: join(runDirectory, 'run.json'),
        explain: { runId, section: 'contract' as const },
      },
      runCreated: true,
      nextStep: `Implement inside the Semantic Contract, then run change collect --run ${runId}.`,
    };
  } catch (error) {
    rmSync(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function collectDelegationFacts(options: {
  projectRoot: string;
  runId: string;
  productVersion: string;
}) {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const runId = requiredRunId(options.runId);
  const runDirectory = resolveRunDirectory(projectRoot, runId);
  const runPath = join(runDirectory, 'run.json');
  const run = readRun(runPath);
  assertRunProject(run, projectRoot, runId);
  if (run.state === 'completed') {
    throw usageError(`Run ${runId} is already completed and cannot collect new facts.`);
  }
  validateFrozenContract(run.contract);
  assertWorktreeSnapshot(run.worktreeBaseline, 'run baseline');
  assertWorktreeObjectStore(runDirectory, runId);

  const checksDirectory = join(runDirectory, 'checks');
  rmSync(checksDirectory, { recursive: true, force: true });
  const definitions = run.contract.verification.mode === 'checks'
    ? run.contract.verification.checks
    : [];
  const checks = await runFrozenChecks({
    projectRoot,
    definitions,
    outputDirectory: checksDirectory,
  });
  const worktree = await collectGitWorktreeChange(projectRoot, run.worktreeBaseline, {
    objectDirectory: worktreeObjectDirectory(runDirectory),
  });
  const verifierMutations = collectVerifierMutations(
    run.contract,
    worktree.changedFiles,
  );
  const patchPath = join(runDirectory, 'change.patch');
  const patchFact = worktree.patch.length
    ? {
        path: projectRelativePath(projectRoot, patchPath),
        digest: sha256(worktree.patch),
        byteLength: worktree.patch.length,
      }
    : undefined;
  if (patchFact) {
    writeBufferAtomic(patchPath, worktree.patch);
  } else {
    rmSync(patchPath, { force: true });
  }
  const collectedAt = new Date().toISOString();
  const bundleBase = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    contractId: run.contract.contractId,
    collectedAt,
    baseline: summarizeWorktree(run.worktreeBaseline),
    current: summarizeWorktree(worktree.current),
    changeFingerprint: worktree.changeFingerprint,
    changedFiles: worktree.changedFiles,
    checks,
    verifierMutations,
    ...(patchFact ? { patch: patchFact } : {}),
    provenance: {
      collector: 'resonant-code-cli' as const,
      cliVersion: options.productVersion,
      coreVersion: options.productVersion,
    },
  };
  const factCollectionId = stableFingerprint({
    contractId: bundleBase.contractId,
    baselineFingerprint: bundleBase.baseline.fingerprint,
    currentFingerprint: bundleBase.current.fingerprint,
    changeFingerprint: bundleBase.changeFingerprint,
    changedFiles: bundleBase.changedFiles,
    checks: bundleBase.checks,
    verifierMutations: bundleBase.verifierMutations,
    patch: bundleBase.patch ?? null,
  });
  const bundleWithCollection = { ...bundleBase, factCollectionId };
  const factBundle: FactBundle = {
    ...bundleWithCollection,
    bundleFingerprint: stableFingerprint(bundleWithCollection),
  };
  const handoffPath = join(runDirectory, 'handoff.json');
  writeJsonAtomic(handoffPath, emptyHandoff());
  const collectedRun: DelegationRun = {
    ...run,
    state: 'facts-collected',
    factBundle,
    handoffFile: 'handoff.json',
  };
  delete collectedRun.completion;
  writeJsonAtomic(runPath, collectedRun);
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: 'facts-collected',
    runId,
    factCollectionId,
    changedFiles: factBundle.changedFiles.map((file) => ({
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      operation: file.operation,
      representation: file.representation,
    })),
    checks: factBundle.checks.map((check) => ({
      id: check.id,
      status: check.status,
      exitCode: check.exitCode,
      ...(check.reason ? { reason: check.reason } : {}),
      stdout: compactCheckStream(check.stdout),
      stderr: compactCheckStream(check.stderr),
    })),
    verifierSurfaces: summarizeVerifierSurfaces(verifierMutations),
    patch: factBundle.patch
      ? {
          ...factBundle.patch,
        }
      : null,
    handoffPath,
    details: {
      runPath,
      explain: { runId, section: 'facts' as const },
    },
    nextStep: `Inspect the complete facts and patch, fill ${handoffPath}, then run change finalize --run ${runId}.`,
  };
}

export function readDelegationRun(projectRootInput: string, runIdInput: string): {
  run: DelegationRun;
  runDirectory: string;
  runPath: string;
} {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const runId = requiredRunId(runIdInput);
  const runDirectory = resolveRunDirectory(projectRoot, runId);
  const runPath = join(runDirectory, 'run.json');
  const run = readRun(runPath);
  assertRunProject(run, projectRoot, runId);
  return { run, runDirectory, runPath };
}

export async function finalizeDelegationHandoff(options: {
  projectRoot: string;
  runId: string;
}) {
  const loaded = readDelegationRun(options.projectRoot, options.runId);
  const { run, runDirectory, runPath } = loaded;
  if (run.state === 'prepared') {
    throw usageError(`Run ${run.runId} has no Fact Bundle; run change collect first.`);
  }
  if (run.state === 'completed') {
    throw usageError(`Run ${run.runId} is already completed.`);
  }
  if (!run.factBundle || run.handoffFile !== 'handoff.json') {
    throw new Error(`Run ${run.runId} has an invalid facts-collected state.`);
  }
  validateFrozenContract(run.contract);
  assertWorktreeObjectStore(runDirectory, run.runId);
  const current = await captureGitWorktree(run.projectRoot, {
    objectDirectory: worktreeObjectDirectory(runDirectory),
  });
  if (current.fingerprint !== run.factBundle.current.fingerprint) {
    const stale = evaluateHandoff({
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      contract: run.contract,
      factBundle: run.factBundle,
      currentWorktreeFingerprint: current.fingerprint,
      handoff: emptyHandoff() as CognitiveHandoff,
    });
    return {
      ...stale,
      runId: run.runId,
      state: run.state,
      nextStep: `Repository facts changed after collect. Run change collect --run ${run.runId} again before finalizing.`,
    };
  }

  const handoffPath = join(runDirectory, run.handoffFile);
  const source = readHandoffDocument(handoffPath);
  const repositoryEvidence = materializeEvidenceWindows(
    run.projectRoot,
    source.repositoryEvidence ?? [],
  );
  const handoff: CognitiveHandoff = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    systemMeaningUpdate: source.systemMeaningUpdate,
    materialClaims: source.materialClaims,
    residualUnknowns: source.residualUnknowns,
    reviewMap: source.reviewMap,
    ...(source.materialAlternatives
      ? { materialAlternatives: source.materialAlternatives }
      : {}),
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
  };
  let evaluation;
  try {
    evaluation = evaluateHandoff({
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      contract: run.contract,
      factBundle: run.factBundle,
      currentWorktreeFingerprint: current.fingerprint,
      handoff,
    });
  } catch (error) {
    if (isHandoffValidationError(error)) {
      throw inputError(
        'Cognitive Handoff cannot be evaluated; correct all reported issues and finalize again.',
        error,
        error.issues,
      );
    }
    throw inputError(
      `Cognitive Handoff cannot be evaluated: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (evaluation.status === 'facts-stale' || !evaluation.handoffFingerprint) {
    throw new Error('Fresh fact validation unexpectedly returned a stale or unbound evaluation.');
  }
  const presentationMarkdown = renderCognitiveHandoffMarkdown({
    evaluation,
    facts: run.factBundle,
    handoff,
  });
  const completedRun: DelegationRun = {
    ...run,
    state: 'completed',
    completion: {
      completedAt: new Date().toISOString(),
      handoffFingerprint: evaluation.handoffFingerprint,
      evaluation,
    },
  };
  writeJsonAtomic(handoffPath, handoff);
  writeJsonAtomic(runPath, completedRun);
  rmSync(worktreeObjectDirectory(runDirectory), { recursive: true, force: true });
  const removedCompletedRunIds = cleanupCompletedRuns(run.projectRoot, run.runId);
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    status: evaluation.status,
    runId: run.runId,
    state: 'completed',
    factCollectionId: run.factBundle.factCollectionId,
    handoffFingerprint: evaluation.handoffFingerprint,
    attention: evaluation.attention,
    humanAuthorityNotice: evaluation.humanAuthorityNotice,
    presentationMarkdown,
    details: {
      runPath,
      handoffPath,
      patchPath: run.factBundle.patch?.path ?? null,
      checkLogs: run.factBundle.checks.flatMap((check) => {
        const logs = {
          ...(check.stdout.logPath ? { stdout: check.stdout.logPath } : {}),
          ...(check.stderr.logPath ? { stderr: check.stderr.logPath } : {}),
        };
        return Object.keys(logs).length ? [{ checkId: check.id, ...logs }] : [];
      }),
      explain: {
        runId: run.runId,
        sections: ['contract', 'facts', 'handoff', 'evaluation', 'presentation'] as const,
      },
    },
    retention: { removedCompletedRunIds },
    nextStep: finalizeNextStep(evaluation.status),
  };
}

function isHandoffValidationError(
  value: unknown,
): value is Error & { issues: HandoffValidationIssue[] } {
  const candidate = value as { name?: unknown; issues?: unknown };
  return value instanceof Error
    && candidate.name === 'HandoffValidationError'
    && Array.isArray(candidate.issues)
    && candidate.issues.every((issue) =>
      Boolean(issue)
      && typeof issue === 'object'
      && typeof (issue as { code?: unknown }).code === 'string'
      && typeof (issue as { path?: unknown }).path === 'string'
      && typeof (issue as { message?: unknown }).message === 'string'
      && typeof (issue as { remediation?: unknown }).remediation === 'string');
}

function worktreeObjectDirectory(runDirectory: string): string {
  return join(runDirectory, WORKTREE_OBJECTS_DIRECTORY);
}

function assertWorktreeObjectStore(runDirectory: string, runId: string): void {
  if (!existsSync(worktreeObjectDirectory(runDirectory))) {
    throw usageError(
      `Run ${runId} is missing its task-owned worktree object store; prepare a new run.`,
    );
  }
}

export function explainDelegationRun(options: {
  projectRoot: string;
  runId: string;
  section?: string;
}): {
  protocol: typeof DELEGATION_PROTOCOL;
  schemaVersion: typeof DELEGATION_SCHEMA_VERSION;
  runId: string;
  state: DelegationRun['state'];
  packageIdentity: DelegationRun['packageIdentity'];
  section: string;
  contract?: SemanticContract;
  baseline?: ReturnType<typeof summarizeWorktree>;
  factBundle?: FactBundle | null;
  handoff?: unknown;
  evaluation?: unknown;
  presentationMarkdown?: string | null;
  issue?: string;
} {
  const { run, runDirectory } = readDelegationRun(options.projectRoot, options.runId);
  const handoffPath = join(runDirectory, 'handoff.json');
  const handoff = existsSync(handoffPath)
    ? readJsonValue(handoffPath, 'Cognitive Handoff')
    : null;
  const common = {
    protocol: run.protocol,
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    state: run.state,
    packageIdentity: run.packageIdentity,
  };
  const section = options.section ?? 'all';
  if (section === 'contract') {
    return {
      ...common,
      section,
      contract: run.contract,
      baseline: summarizeWorktree(run.worktreeBaseline),
    };
  }
  if (section === 'facts') {
    return { ...common, section, factBundle: run.factBundle ?? null };
  }
  if (section === 'handoff') {
    return { ...common, section, handoff };
  }
  if (section === 'evaluation') {
    return { ...common, section, evaluation: run.completion?.evaluation ?? null };
  }
  if (section === 'presentation') {
    if (!run.factBundle || !handoff || !run.completion) {
      return {
        ...common,
        section,
        presentationMarkdown: null,
        issue: 'The run has no completed Cognitive Handoff presentation.',
      };
    }
    const currentHandoffFingerprint = stableFingerprint({
      factCollectionId: run.factBundle.factCollectionId,
      handoff,
    });
    if (currentHandoffFingerprint !== run.completion.handoffFingerprint) {
      return {
        ...common,
        section,
        presentationMarkdown: null,
        issue: 'The persisted handoff changed after completion; exact presentation recovery is unavailable.',
      };
    }
    return {
      ...common,
      section,
      presentationMarkdown: renderCognitiveHandoffMarkdown({
        evaluation: run.completion.evaluation as HandoffEvaluation,
        facts: run.factBundle,
        handoff: handoff as CognitiveHandoff,
      }),
    };
  }
  if (section !== 'all') {
    throw usageError(
      `Invalid explain section ${JSON.stringify(section)}; use contract, facts, handoff, evaluation, presentation, or all.`,
    );
  }
  return {
    ...common,
    section,
    contract: run.contract,
    baseline: summarizeWorktree(run.worktreeBaseline),
    factBundle: run.factBundle ?? null,
    handoff,
    evaluation: run.completion?.evaluation ?? null,
  };
}

export function writeDelegationRun(path: string, run: DelegationRun): void {
  writeJsonAtomic(path, run);
}

async function readPrepareDocument(
  projectRoot: string,
  pathInput: string,
  input: Readable = process.stdin,
): Promise<DelegationPrepareDocument> {
  const sourceLabel = pathInput === '-' ? 'stdin' : safePrepareInputPath(projectRoot, pathInput);
  let textValue: string;
  try {
    textValue = pathInput === '-'
      ? await readUtf8Stream(input)
      : readFileSync(sourceLabel, 'utf8');
  } catch (error) {
    throw inputError(
      `Failed to read Semantic Contract input from ${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(textValue);
  } catch (error) {
    throw inputError(
      `Semantic Contract input from ${sourceLabel} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return parseArtifact(
    DelegationPrepareDocumentSchema,
    value,
    'Semantic Contract input',
  );
}

function safePrepareInputPath(projectRoot: string, pathInput: string): string {
  const path = resolve(pathInput);
  const canonical = existsSync(path) ? realpathSync(path) : path;
  const rel = relative(projectRoot, canonical);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) {
    throw inputError(
      `Semantic Contract input must not be stored inside the project worktree: ${canonical}`,
      undefined,
      [{
        code: 'prepare-input-inside-project',
        path: 'input',
        message: 'A task input inside the worktree can pollute the collected change.',
        remediation: 'Pass the JSON on stdin with --input -, or use a file outside the project root.',
      }],
    );
  }
  return canonical;
}

async function readUtf8Stream(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readHandoffDocument(path: string) {
  return parseArtifact(
    CognitiveHandoffDocumentSchema,
    readJsonValue(path, 'Cognitive Handoff'),
    'Cognitive Handoff',
  );
}

function readJsonValue(path: string, label: string): unknown {
  if (!existsSync(path)) throw usageError(`${label} does not exist at ${path}.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError(`Failed to read ${label} at ${path}.`, error);
  }
}

function readRun(path: string): DelegationRun {
  if (!existsSync(path)) throw usageError(`Run does not exist at ${path}.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError(`Failed to read run at ${path}.`, error);
  }
  const parsed = parseArtifact(DelegationRunSchema, value, 'Semantic Handoff run');
  return parsed as DelegationRun;
}

function validateFrozenContract(contract: SemanticContract): void {
  if (contract.protocol !== DELEGATION_PROTOCOL
    || contract.schemaVersion !== DELEGATION_SCHEMA_VERSION
    || !/^sha256:[a-f0-9]{64}$/.test(contract.contractId)) {
    throw new Error('Prepared Semantic Contract has an unsupported protocol or invalid identity.');
  }
  const { contractId: _ignored, ...projection } = contract;
  if (contract.contractId !== stableFingerprint(projection)) {
    throw new Error('Prepared Semantic Contract was modified after compilation; prepare a new run.');
  }
  if (contract.verification.mode === 'checks') {
    for (const definition of contract.verification.checks) {
      if (!definition.argv.length
        || definition.argv.some((item) => typeof item !== 'string' || !item)
        || !Number.isInteger(definition.timeoutMs)
        || definition.timeoutMs < 1
        || !Array.isArray(definition.verifierRefs)
        || definition.verifierRefs.some((item) =>
          !item
          || !projectRelativePathIsSafe(item.path)
          || (item.role !== 'command-definition' && item.role !== 'acceptance-surface'))) {
        throw new Error(`Prepared check ${definition.id} is invalid; prepare a new run.`);
      }
    }
  }
}

function projectRelativePathIsSafe(value: unknown): value is string {
  return typeof value === 'string'
    && Boolean(value)
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

function collectVerifierMutations(
  contract: SemanticContract,
  files: FactBundle['changedFiles'],
): VerifierMutation[] {
  if (contract.verification.mode !== 'checks') return [];
  const changedByPath = new Map<string, FactBundle['changedFiles'][number]>();
  for (const file of files) {
    changedByPath.set(file.path, file);
    if (file.previousPath) changedByPath.set(file.previousPath, file);
  }
  return contract.verification.checks.flatMap((check) =>
    check.verifierRefs.flatMap((verifierRef) => {
      const changed = changedByPath.get(verifierRef.path);
      return changed
        ? [{
            checkId: check.id,
            path: verifierRef.path,
            role: verifierRef.role,
            changedFileId: changed.id,
          }]
        : [];
    }));
}

function contractWorkPacket(contract: SemanticContract) {
  return {
    contractId: contract.contractId,
    humanEvents: contract.authority.humanEvents,
    interpretations: contract.interpretationTrace,
    semantic: {
      desiredOutcome: contract.semantic.desiredOutcome.value,
      constraints: contract.semantic.constraints.map((item) => item.value),
      nonGoals: contract.semantic.nonGoals.map((item) => item.value),
      focus: contract.semantic.focus.map((item) => item.value),
      consequence: contract.semantic.consequence,
    },
    repositoryEvidence: contract.repositoryEvidence.map((evidence) => ({
      id: evidence.id,
      path: evidence.path,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      digest: evidence.digest,
    })),
    authorization: contract.authorization,
    verification: contract.verification.mode === 'no-command'
      ? contract.verification
      : {
          mode: 'checks' as const,
          checks: contract.verification.checks.map((check) => ({
            id: check.id,
            rationale: check.rationale,
            argv: check.argv,
            timeoutMs: check.timeoutMs,
            source: check.source,
            commandDefinitionPaths: check.verifierRefs
              .filter((reference) => reference.role === 'command-definition')
              .map((reference) => reference.path),
            acceptanceSurfacePaths: check.verifierRefs
              .filter((reference) => reference.role === 'acceptance-surface')
              .map((reference) => reference.path),
          })),
        },
  };
}

function compactCheckStream(stream: FactBundle['checks'][number]['stdout']) {
  return {
    byteLength: stream.byteLength,
    truncated: stream.truncated,
    ...(stream.logPath ? { logPath: stream.logPath } : {}),
  };
}

function cleanupCompletedRuns(projectRoot: string, currentRunId: string): string[] {
  const runsRoot = join(projectRoot, '.resonant-code', 'runs');
  if (!existsSync(runsRoot)) return [];
  const completed = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .flatMap((entry) => {
      const runPath = join(runsRoot, entry.name, 'run.json');
      if (!existsSync(runPath)) return [];
      try {
        const parsed = DelegationRunSchema.safeParse(
          JSON.parse(readFileSync(runPath, 'utf8')),
        );
        if (!parsed.success
          || parsed.data.projectRoot !== projectRoot
          || parsed.data.runId !== entry.name
          || parsed.data.state !== 'completed'
          || !parsed.data.completion
          || parsed.data.handoffFile !== 'handoff.json'
          || !existsSync(join(runsRoot, entry.name, parsed.data.handoffFile))) {
          return [];
        }
        return [{ runId: entry.name, completedAt: parsed.data.completion.completedAt }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt)
      || left.runId.localeCompare(right.runId));
  if (completed.length <= MAX_COMPLETED_RUNS) return [];
  const retained = new Set<string>([currentRunId]);
  for (const candidate of completed) {
    if (retained.size >= MAX_COMPLETED_RUNS) break;
    retained.add(candidate.runId);
  }
  const removed = completed
    .filter((candidate) => !retained.has(candidate.runId))
    .map((candidate) => candidate.runId)
    .sort((left, right) => left.localeCompare(right));
  for (const runId of removed) {
    rmSync(join(runsRoot, runId), { recursive: true, force: true });
  }
  return removed;
}

function emptyHandoff() {
  return {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    systemMeaningUpdate: '',
    materialClaims: [],
    residualUnknowns: [],
    reviewMap: [],
  };
}

function compileNextStep(status: string): string {
  if (status === 'semantic-decision-required') {
    return 'Resolve the material semantic fork with the human, update the input, and prepare again.';
  }
  if (status === 'verification-required') {
    return 'Add explicit checks or a concrete no-command rationale, then prepare again.';
  }
  return 'Correct the authority/event references and prepare again.';
}

function finalizeNextStep(status: string): string {
  if (status === 'handoff-ready') {
    return 'Review the Runtime facts, bounded claims, and Review Map; adoption remains a human decision.';
  }
  if (status === 'rejected') {
    return 'Do not adopt this change. Prepare a new run before repairing or revising the rejected boundary, then collect fresh facts.';
  }
  if (status === 'needs-attention') {
    return 'Follow every Attention action and directly inspect its Review Map surface before deciding whether the disclosed gap is acceptable.';
  }
  return 'Collect fresh Runtime facts before relying on this handoff.';
}

function canonicalProjectRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw usageError(`Project root is not a directory: ${root}`);
  }
  return realpathSync(root);
}

function resolveRunDirectory(projectRoot: string, runId: string): string {
  const relativePath = `.resonant-code/runs/${runId}`;
  assertNoSymlinkTraversal(projectRoot, relativePath);
  const path = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe run path for ${runId}.`);
  }
  return path;
}

function requiredRunId(value: string): string {
  if (!RUN_ID_PATTERN.test(value)) {
    throw usageError('Invalid run ID: expected the UUID returned by change prepare.');
  }
  return value;
}

function assertRunProject(run: DelegationRun, projectRoot: string, runId: string): void {
  if (run.projectRoot !== projectRoot || run.runId !== runId) {
    throw new Error('Run identity or project root does not match its storage location.');
  }
}

function projectRelativePath(projectRoot: string, path: string): string {
  const output = relative(projectRoot, path).replace(/\\/g, '/');
  if (!output || output.startsWith('../') || isAbsolute(output)) {
    throw new Error(`Path is outside the project: ${path}`);
  }
  return output;
}

function assertNoSymlinkTraversal(projectRoot: string, relativePath: string): void {
  let current = projectRoot;
  for (const [index, segment] of relativePath.split('/').entries()) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to use run storage through a symlink: ${relativePath}`);
    if (index < relativePath.split('/').length - 1 && !stat.isDirectory()) {
      throw new Error(`Invalid run storage path: ${relativePath}`);
    }
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  writeBufferAtomic(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

function writeBufferAtomic(path: string, value: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
