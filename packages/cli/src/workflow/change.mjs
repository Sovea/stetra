/** CLI-owned change orchestration around the Runtime hard kernel. */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { compileChange, evaluateChange } from '@sovea/resonant-code-core';
import { validateContext } from '@sovea/resonant-code-core/rccl';
import { inputError, usageError } from '../errors.ts';
import {
  buildCheckPlan,
  loadCheckConfiguration,
  runCheckPlan,
} from '../facts/checks.mjs';
import {
  captureGitWorktree,
  compareGitWorktrees,
  summarizeWorktreeSnapshot,
} from '../facts/worktree.mjs';
import {
  EvaluationInputSchema,
  GuidanceDeliverySelectionSchema,
  RelationProposalDocumentSchema,
  RuntimeRunSchema,
  TaskProvenanceDocumentSchema,
} from '../schemas/change.ts';
import { parseArtifact } from '../validation.ts';

const RUN_SCHEMA_VERSION = '1.0';
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_COMPLETED_RUNS = 50;

export async function prepareCodeTask(options) {
  const paths = resolvePaths(options);
  const checkDefinitions = loadCheckConfiguration(paths.checkConfigPath, {
    required: paths.checkConfigSource === 'host-task',
  });
  const verificationProposals = checkDefinitions.map((definition) => ({
    id: definition.id,
    rationale: definition.rationale,
    source: paths.checkConfigSource,
  }));
  const relationProposals = options.relationFile
    ? readRelationProposals(options.relationFile)
    : [];
  const deliverySelection = options.selectionFile
    ? readDeliverySelection(options.selectionFile)
    : options.deliverySelection;
  const taskProvenance = options.provenanceFile
    ? readTaskProvenance(options.provenanceFile)
    : undefined;
  const guidanceByteLimit = normalizePositiveInteger(
    options.guidanceByteLimit,
    'guidance byte limit',
  );
  const output = await compileChange({
    projectRoot: paths.projectRoot,
    builtinRoot: paths.builtinRoot,
    ...(existsSync(paths.localAugmentPath) ? { localAugmentPath: paths.localAugmentPath } : {}),
    ...(existsSync(paths.personalOverlayPath) ? { personalOverlayPath: paths.personalOverlayPath } : {}),
    ...(existsSync(paths.rcclPath) ? { rcclPath: paths.rcclPath } : {}),
    task: buildTaskInput(options, taskProvenance),
    ...(relationProposals.length ? { relationProposals } : {}),
    ...(verificationProposals.length ? { verificationProposals } : {}),
    ...(guidanceByteLimit ? { guidanceByteLimit } : {}),
    ...(deliverySelection ? { deliverySelection } : {}),
  });

  if (output.status === 'needs-alignment') {
    return {
      status: 'needs-alignment',
      schemaVersion: RUN_SCHEMA_VERSION,
      task: output.task,
      reasons: output.reasons,
      requiredFields: output.requiredFields,
      nextStep: 'Resolve the material semantic decision with the user, update the task contract, and run prepare again. No separate design artifact is required.',
    };
  }
  if (output.status === 'guidance-overflow') {
    return {
      ...output,
      nextStep: output.mandatoryBytes > output.byteLimit
        ? 'Resolve the mandatory policy/task scope or rerun prepare with an explicitly chosen larger byte ceiling.'
        : 'Choose task-relevant IDs from selectableConsider, write { "considerIds": [...], "rationale": "..." }, and rerun prepare with --selection-file.',
    };
  }

  const checkPlan = buildCheckPlan(checkDefinitions, output.verificationPlan);
  if (checkPlan.some((item) => item.status === 'missing')) {
    return {
      status: 'verification-required',
      schemaVersion: RUN_SCHEMA_VERSION,
      decisionStatus: output.status,
      decisionId: output.decisionId,
      task: output.task,
      guidance: output.executionGuidance,
      verificationPlan: output.verificationPlan,
      attestationPlan: output.attestationPlan,
      activation: output.trace.activation,
      delivery: output.trace.delivery,
      checkPlan,
      diagnostics: output.trace.diagnostics,
      nextStep: 'Add every missing check to a task-specific --check-config and rerun prepare. No run or worktree baseline was created.',
    };
  }

  const worktreeBaseline = await captureGitWorktree(paths.projectRoot);
  const run = createRun(paths.projectRoot, {
    schemaVersion: RUN_SCHEMA_VERSION,
    workflow: 'change',
    state: 'prepared',
    preparedAt: new Date().toISOString(),
    projectRoot: paths.projectRoot,
    controlPlane: {
      kind: 'cli',
      package: '@sovea/resonant-code',
      version: options.productVersion ?? null,
      corePackage: '@sovea/resonant-code-core',
      coreVersion: options.productVersion ?? null,
    },
    decision: output,
    worktreeBaseline,
    checkPlan,
  });
  return compactDecision(
    output,
    run,
    checkPlan,
    summarizeWorktreeSnapshot(worktreeBaseline),
  );
}

export async function completeCodeTask(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const loaded = readRun(projectRoot, requiredRunId(options.runId));
  const { run, runDirectory, runPath, evaluationInputPath } = loaded;
  summarizeWorktreeSnapshot(run.worktreeBaseline);
  const artifact = readJsonFile(evaluationInputPath, 'evaluation input');
  const evaluationInput = parseArtifact(
    EvaluationInputSchema,
    artifact,
    'evaluation input',
  );
  const collectedChecks = await runCheckPlan({
    projectRoot,
    plan: run.checkPlan,
    outputDirectory: join(runDirectory, 'checks'),
  });
  const currentWorktree = await captureGitWorktree(projectRoot);
  const changes = compareGitWorktrees(run.worktreeBaseline, currentWorktree);
  const checks = collectedChecks.map((check) => ({
    ...check,
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: changes.provenance.collectionId,
    },
  }));
  const evaluation = evaluateChange({
    decision: run.decision,
    changes,
    checks,
    attestations: evaluationInput.attestations,
    exceptions: evaluationInput.exceptions,
  });
  writeJsonAtomic(runPath, {
    ...run,
    state: 'completed',
    completion: {
      completedAt: new Date().toISOString(),
      evaluation,
    },
  });
  cleanupCompletedRuns(projectRoot);
  return {
    status: evaluation.status,
    schemaVersion: RUN_SCHEMA_VERSION,
    decisionId: evaluation.decisionId,
    evaluationId: evaluation.evaluationId,
    operation: evaluation.operation,
    changes: evaluation.changes,
    scopeDelta: evaluation.scopeDelta,
    summary: evaluation.summary,
    assurance: evaluation.assurance,
    results: evaluation.results,
    checks: evaluation.checks,
    actionRequired: evaluation.actionRequired,
    informational: evaluation.informational,
    runId: run.runId,
    runPath,
    evaluationInputPath,
  };
}

export function explainCodeRun(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const { run, runPath, evaluationInputPath } = readRun(
    projectRoot,
    requiredRunId(options.runId),
  );
  return {
    status: 'ok',
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    runPath,
    evaluationInputPath,
    state: run.state,
    decision: run.decision,
    evaluation: run.completion?.evaluation ?? null,
  };
}

export async function getCodeStatus(options) {
  const paths = resolvePaths(options);
  const requiredControlPlaneFiles = [paths.builtinRoot];
  const missingControlPlaneFiles = requiredControlPlaneFiles.filter((path) => !existsSync(path));
  const localAugment = existsSync(paths.localAugmentPath) ? 'present' : 'absent';
  const personalOverlay = existsSync(paths.personalOverlayPath) ? 'present' : 'absent';
  const checks = checkConfigStatus(paths.checkConfigPath);
  const rccl = rcclStatus(paths.projectRoot, paths.rcclPath);
  const required = [];
  const recommended = [];
  const optional = [];
  if (localAugment === 'absent') {
    recommended.push({
      code: 'local-augment-absent',
      message: 'Bootstrap a Team Playbook only when repository-specific prescriptive guidance is needed.',
    });
  }
  if (rccl === 'absent') {
    optional.push({
      code: 'rccl-absent',
      message: 'RCCL is optional; calibrate only durable repository observations that can change a future implementation or review decision.',
    });
  } else if (rccl !== 'present') {
    required.push({
      code: 'rccl-invalid',
      message: 'RCCL exists but cannot be parsed as a current observation document; repair or remove the invalid source before trusted operation.',
    });
  }
  if (checks === 'absent') {
    if (paths.checkConfigSource === 'host-task') {
      required.push({
        code: 'task-check-config-absent',
        message: 'The explicitly selected --check-config path does not exist.',
      });
    } else {
      optional.push({
        code: 'team-checks-absent',
        message: 'Persistent team check defaults are optional; the Host can provide a task-specific verification plan with --check-config.',
      });
    }
  } else if (checks !== 'present') {
    required.push({
      code: 'checks-invalid',
      message: 'The configured check file is not valid for the current schema.',
    });
  }
  if (missingControlPlaneFiles.length) {
    required.unshift({
      code: 'core-installation-incomplete',
      message: 'The Core installation is missing its built-in Playbook assets.',
    });
  }
  return {
    status: missingControlPlaneFiles.length ? 'blocked' : 'ok',
    schemaVersion: RUN_SCHEMA_VERSION,
    readiness: {
      status: missingControlPlaneFiles.length
        ? 'blocked'
        : required.length
          ? 'needs-attention'
          : 'ready',
      required,
      recommended,
      optional,
    },
    sources: {
      localAugment,
      personalOverlay,
      rccl,
      checks,
    },
    controlPlane: {
      kind: 'cli',
      version: options.productVersion ?? null,
      corePackage: '@sovea/resonant-code-core',
      coreVersion: options.productVersion ?? null,
      status: missingControlPlaneFiles.length ? 'incomplete' : 'ok',
      missing: missingControlPlaneFiles,
    },
    paths: {
      projectRoot: paths.projectRoot,
      localAugmentPath: paths.localAugmentPath,
      personalOverlayPath: paths.personalOverlayPath,
      rcclPath: paths.rcclPath,
      checkConfigPath: paths.checkConfigPath,
    },
  };
}

function buildTaskInput(options, provenance) {
  const targets = unique([
    ...(options.targets ?? []),
    ...(options.targetFile ? [options.targetFile] : []),
    ...(options.changedFiles ?? []),
  ]);
  if (!targets.length) throw usageError('Missing task target.');
  return {
    description: requiredString(options.taskDescription, 'task description'),
    changeType: requiredEnum(options.changeType, [
      'bugfix', 'feature', 'refactor', 'migration', 'maintenance', 'docs', 'test', 'unknown',
    ], 'change-type'),
    targets,
    techStack: unique(options.techStack ?? []),
    risk: requiredEnum(options.risk, ['low', 'medium', 'high'], 'risk'),
    scope: requiredEnum(options.scope, ['local', 'module', 'cross-module', 'repository'], 'scope'),
    constraints: unique(options.constraints ?? []),
    avoid: unique(options.avoid ?? []),
    uncertainties: unique(options.uncertainties ?? []),
    ...(provenance ? { provenance } : {}),
  };
}

function readTaskProvenance(filePath) {
  const value = readJsonFile(filePath, 'task provenance');
  return parseArtifact(
    TaskProvenanceDocumentSchema,
    value,
    'task provenance file',
  );
}

function compactDecision(decision, run, checkPlan, baseline) {
  return {
    status: decision.status,
    schemaVersion: decision.schemaVersion,
    decisionId: decision.decisionId,
    task: decision.task,
    guidance: decision.executionGuidance,
    verificationPlan: decision.verificationPlan,
    attestationPlan: decision.attestationPlan,
    activation: decision.trace.activation,
    delivery: decision.trace.delivery,
    checkPlan,
    baseline,
    diagnostics: decision.trace.diagnostics,
    runId: run.runId,
    runPath: run.runPath,
    evaluationInputPath: run.evaluationInputPath,
    nextStep: `The compiled task contract and worktree baseline are established. Implement the aligned change, inspect the complete actual diff and try to falsify each attentionItem before attesting in ${run.evaluationInputPath}, then run change complete with --run ${run.runId}. Optional consider items may remain unverified.`,
  };
}

function resolvePaths(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const explicitCheckConfig = typeof options.checkConfigPath === 'string'
    && Boolean(options.checkConfigPath.trim());
  return {
    projectRoot,
    builtinRoot: resolve(requiredString(options.builtinRoot, 'built-in Playbook root')),
    localAugmentPath: join(projectRoot, '.resonant-code', 'playbook', 'local-augment.yaml'),
    personalOverlayPath: resolve(
      options.personalOverlayPath
        ?? join(homedir(), '.resonant-code', 'playbook', 'personal-overlay.yaml'),
    ),
    rcclPath: join(projectRoot, '.resonant-code', 'rccl.yaml'),
    checkConfigPath: resolve(
      explicitCheckConfig
        ? options.checkConfigPath
        : join(projectRoot, '.resonant-code', 'checks.json'),
    ),
    checkConfigSource: explicitCheckConfig ? 'host-task' : 'team-default',
  };
}

function readRelationProposals(filePath) {
  const value = readJsonFile(filePath, 'relation proposals');
  return parseArtifact(
    RelationProposalDocumentSchema,
    value,
    'relation proposal file',
  );
}

function readDeliverySelection(filePath) {
  const value = readJsonFile(filePath, 'guidance delivery selection');
  return parseArtifact(
    GuidanceDeliverySelectionSchema,
    value,
    'guidance selection file',
  );
}

function createRun(projectRoot, value) {
  const runId = randomUUID();
  const runsDirectory = join(projectRoot, '.resonant-code', 'runs');
  const runDirectory = join(runsDirectory, runId);
  const runPath = join(runDirectory, 'run.json');
  const evaluationInputPath = join(runDirectory, 'evaluation.json');
  mkdirSync(runsDirectory, { recursive: true });
  mkdirSync(runDirectory);
  writeJsonAtomic(runPath, {
    ...value,
    runId,
  });
  writeJsonAtomic(evaluationInputPath, {
    attestations: [],
    exceptions: [],
  });
  return {
    runId,
    runPath,
    evaluationInputPath,
  };
}

function readRun(projectRoot, runId) {
  const runDirectory = join(projectRoot, '.resonant-code', 'runs', runId);
  const runPath = join(runDirectory, 'run.json');
  const evaluationInputPath = join(runDirectory, 'evaluation.json');
  const run = parseArtifact(
    RuntimeRunSchema,
    readJsonFile(runPath, 'runtime run'),
    'runtime run',
  );
  if (run.schemaVersion !== RUN_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: run must use ${RUN_SCHEMA_VERSION}; re-run prepare.`);
  }
  if (run.runId !== runId) {
    throw new Error(`Runtime run identity does not match ${runId}; re-run prepare.`);
  }
  if (resolve(run.projectRoot) !== projectRoot) {
    throw new Error('Runtime run belongs to a different project root.');
  }
  if (!run.decision || run.decision.schemaVersion !== RUN_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: run decision must use ${RUN_SCHEMA_VERSION}; re-run prepare.`);
  }
  if (!run.worktreeBaseline) {
    throw new Error('Runtime run is missing its trusted worktree baseline; re-run prepare.');
  }
  return {
    run,
    runDirectory,
    runPath,
    evaluationInputPath,
  };
}

function cleanupCompletedRuns(projectRoot) {
  const directory = join(projectRoot, '.resonant-code', 'runs');
  if (!existsSync(directory)) return;
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .flatMap((entry) => {
      const runDirectory = join(directory, entry.name);
      try {
        const runPath = join(runDirectory, 'run.json');
        const run = JSON.parse(readFileSync(runPath, 'utf8'));
        return run?.state === 'completed'
          ? [{ path: runDirectory, mtime: statSync(runPath).mtimeMs }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.mtime - left.mtime);
  for (const entry of entries.slice(MAX_COMPLETED_RUNS)) {
    rmSync(entry.path, { recursive: true, force: true });
  }
}

function rcclStatus(projectRoot, rcclPath) {
  const result = validateContext({ projectRoot, rcclPath, write: false });
  if (result.status === 'missing') return 'absent';
  return result.status === 'valid' ? 'present' : 'invalid';
}

function checkConfigStatus(path) {
  if (!existsSync(path)) return 'absent';
  try {
    loadCheckConfiguration(path);
    return 'present';
  } catch {
    return 'invalid';
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw inputError(
      `Failed to read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

function normalizeEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!allowed.includes(value)) {
    throw usageError(`Invalid ${label}: expected one of ${allowed.join(', ')}.`);
  }
  return value;
}

function requiredEnum(value, allowed, label) {
  const normalized = normalizeEnum(value, allowed, label);
  if (normalized === undefined) throw usageError(`Missing ${label}.`);
  return normalized;
}

function normalizePositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw usageError(`Invalid ${label}: expected a positive integer.`);
  }
  return number;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw usageError(`Missing ${label}.`);
  }
  return value.trim();
}

function requiredRunId(value) {
  const runId = requiredString(value, 'run ID');
  if (!RUN_ID_PATTERN.test(runId)) {
    throw usageError('Invalid run ID: expected the UUID returned by change prepare.');
  }
  return runId;
}
