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
import { pathToFileURL } from 'node:url';

const SESSION_SCHEMA_VERSION = '1.0';
const DEFAULT_PLUGIN_ROOT = resolve(import.meta.dirname, '../../..');

export async function autoCodeTask(options) {
  return prepareCodeTask(options);
}

export async function prepareCodeTask(options) {
  const paths = resolvePaths(options);
  const runtime = await loadRuntime(paths.pluginRoot);
  const relationProposals = options.relationFile
    ? readRelationProposals(options.relationFile)
    : [];
  const deliverySelection = options.selectionFile
    ? readDeliverySelection(options.selectionFile)
    : options.deliverySelection;
  const guidanceByteLimit = normalizePositiveInteger(
    options.guidanceByteLimit,
    'guidance byte limit',
  );
  const output = await runtime.compileChange({
    projectRoot: paths.projectRoot,
    builtinRoot: paths.builtinRoot,
    ...(existsSync(paths.localAugmentPath) ? { localAugmentPath: paths.localAugmentPath } : {}),
    ...(existsSync(paths.personalOverlayPath) ? { personalOverlayPath: paths.personalOverlayPath } : {}),
    ...(existsSync(paths.rcclPath) ? { rcclPath: paths.rcclPath } : {}),
    mode: normalizeEnum(options.guidanceMode, ['standard', 'strict'], 'mode') ?? 'standard',
    task: buildTaskInput(options),
    ...(relationProposals.length ? { relationProposals } : {}),
    ...(guidanceByteLimit ? { guidanceByteLimit } : {}),
    ...(deliverySelection ? { deliverySelection } : {}),
  });

  if (output.status === 'needs-interpretation') {
    return {
      status: 'needs-interpretation',
      schemaVersion: SESSION_SCHEMA_VERSION,
      task: output.task,
      reasons: output.reasons,
      requiredFields: output.requiredFields,
      nextStep: 'Provide the missing task fields and run prepare again. No task-model artifact is required.',
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

  const sessionPath = writeSession(paths.projectRoot, {
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    projectRoot: paths.projectRoot,
    pluginRoot: paths.pluginRoot,
    decision: output,
    evaluation: null,
  });
  return compactDecision(output, sessionPath);
}

export async function completeCodeTask(options) {
  const sessionPath = requiredPath(options.sessionPath, 'complete requires --session <path>.');
  const session = readSession(sessionPath);
  const runtime = await loadRuntime(session.pluginRoot ?? DEFAULT_PLUGIN_ROOT);
  const artifact = options.evaluationFile
    ? readJsonFile(options.evaluationFile, 'evaluation input')
    : {
        changes: { files: detectChangedFiles(session.projectRoot) },
        checks: [],
        evidence: [],
        exceptions: [],
      };
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('Evaluation input must be a JSON object.');
  }
  const evaluation = runtime.evaluateChange({
    decision: session.decision,
    changes: normalizeChanges(artifact.changes, session.projectRoot),
    checks: Array.isArray(artifact.checks) ? artifact.checks : [],
    evidence: Array.isArray(artifact.evidence) ? artifact.evidence : [],
    exceptions: Array.isArray(artifact.exceptions) ? artifact.exceptions : [],
    feedbackPath: join(session.projectRoot, '.resonant-code', 'feedback', 'verified-events.jsonl'),
  });
  const nextSession = { ...session, evaluation, completedAt: new Date().toISOString() };
  writeJsonAtomic(sessionPath, nextSession);
  return {
    status: evaluation.status,
    schemaVersion: SESSION_SCHEMA_VERSION,
    decisionId: evaluation.decisionId,
    evaluationId: evaluation.evaluationId,
    operation: evaluation.operation,
    summary: evaluation.summary,
    results: evaluation.results,
    checks: evaluation.checks,
    feedback: evaluation.feedback ?? { recorded: 0, path: null },
    sessionPath,
  };
}

export function explainCodeSession(options) {
  const sessionPath = requiredPath(options.sessionPath, 'explain requires --session <path>.');
  const session = readSession(sessionPath);
  return {
    status: 'ok',
    schemaVersion: session.schemaVersion,
    sessionPath,
    decision: session.decision,
    evaluation: session.evaluation ?? null,
  };
}

export async function getCodeStatus(options) {
  const paths = resolvePaths(options);
  const requiredPluginFiles = [
    paths.builtinRoot,
    join(paths.pluginRoot, 'runtime', 'dist', 'index.mjs'),
    join(paths.pluginRoot, 'rccl', 'dist', 'index.mjs'),
  ];
  const missingPluginFiles = requiredPluginFiles.filter((path) => !existsSync(path));
  const localAugment = existsSync(paths.localAugmentPath) ? 'present' : 'absent';
  const personalOverlay = existsSync(paths.personalOverlayPath) ? 'present' : 'absent';
  const rccl = sourceFileStatus(paths.rcclPath, 'observations');
  const feedbackPath = join(paths.projectRoot, '.resonant-code', 'feedback', 'verified-events.jsonl');
  const nextActions = [];
  if (localAugment === 'absent') {
    nextActions.push({ code: 'local-augment-absent', message: 'Run init or add project-specific prescriptive guidance.' });
  }
  if (rccl === 'absent') {
    nextActions.push({ code: 'rccl-absent', message: 'Calibrate decision-relevant repository observations when local reality should affect changes.' });
  } else if (rccl !== 'present') {
    nextActions.push({ code: 'rccl-invalid', message: 'RCCL exists but cannot be parsed as a current observation document.' });
  }
  if (missingPluginFiles.length) {
    nextActions.unshift({ code: 'plugin-incomplete', message: 'Build Runtime and RCCL before using the code workflow.' });
  }
  return {
    status: missingPluginFiles.length ? 'blocked' : 'ok',
    schemaVersion: SESSION_SCHEMA_VERSION,
    readiness: {
      status: missingPluginFiles.length ? 'blocked' : nextActions.length ? 'needs-attention' : 'ready',
      nextActions,
    },
    sources: {
      localAugment,
      personalOverlay,
      rccl,
      feedback: existsSync(feedbackPath) ? 'present' : 'absent',
    },
    plugin: {
      status: missingPluginFiles.length ? 'incomplete' : 'ok',
      missing: missingPluginFiles,
    },
    paths: {
      projectRoot: paths.projectRoot,
      pluginRoot: paths.pluginRoot,
      localAugmentPath: paths.localAugmentPath,
      personalOverlayPath: paths.personalOverlayPath,
      rcclPath: paths.rcclPath,
      feedbackPath,
    },
  };
}

function buildTaskInput(options) {
  const targets = unique([
    ...(options.targets ?? []),
    ...(options.targetFile ? [options.targetFile] : []),
    ...(options.changedFiles ?? []),
  ]);
  return {
    description: requiredString(options.taskDescription, 'task description'),
    changeType: normalizeEnum(options.changeType, [
      'bugfix', 'feature', 'refactor', 'migration', 'maintenance', 'docs', 'test', 'unknown',
    ], 'change-type'),
    targets,
    techStack: unique(options.techStack ?? []),
    risk: normalizeEnum(options.risk, ['low', 'medium', 'high'], 'risk'),
    scope: normalizeEnum(options.scope, ['local', 'module', 'cross-module', 'repository'], 'scope'),
    constraints: unique(options.constraints ?? []),
    avoid: unique(options.avoid ?? []),
    uncertainties: unique(options.uncertainties ?? []),
  };
}

function compactDecision(decision, sessionPath) {
  return {
    status: decision.status,
    schemaVersion: decision.schemaVersion,
    guidanceMode: decision.mode,
    decisionId: decision.decisionId,
    task: decision.task,
    guidance: decision.guidance,
    verificationPlan: decision.verificationPlan,
    diagnostics: decision.trace.diagnostics,
    sessionPath,
    nextStep: 'Implement using required/consider/avoid/tensions, run the verification plan, then complete with evidence from the diff and checks.',
  };
}

function resolvePaths(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const pluginRoot = resolve(options.pluginRoot ?? DEFAULT_PLUGIN_ROOT);
  return {
    projectRoot,
    pluginRoot,
    builtinRoot: join(pluginRoot, 'playbook'),
    localAugmentPath: join(projectRoot, '.resonant-code', 'playbook', 'local-augment.yaml'),
    personalOverlayPath: resolve(
      options.personalOverlayPath
        ?? join(homedir(), '.resonant-code', 'playbook', 'personal-overlay.yaml'),
    ),
    rcclPath: join(projectRoot, '.resonant-code', 'rccl.yaml'),
  };
}

async function loadRuntime(pluginRoot) {
  const runtimePath = join(pluginRoot, 'runtime', 'dist', 'index.mjs');
  if (!existsSync(runtimePath)) throw new Error(`Runtime dist is missing: ${runtimePath}. Run pnpm build.`);
  const runtime = await import(`${pathToFileURL(runtimePath).href}?current`);
  if (typeof runtime.compileChange !== 'function' || typeof runtime.evaluateChange !== 'function') {
    throw new Error(`Runtime dist at ${runtimePath} does not expose compileChange/evaluateChange.`);
  }
  return runtime;
}

function readRelationProposals(filePath) {
  const value = readJsonFile(filePath, 'relation proposals');
  const proposals = Array.isArray(value) ? value : value?.relations;
  if (!Array.isArray(proposals)) throw new Error('Relation proposal file must be a JSON array or { "relations": [] }.');
  return proposals;
}

function readDeliverySelection(filePath) {
  const value = readJsonFile(filePath, 'guidance delivery selection');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Guidance selection file must contain { "considerIds": [], "rationale": "..." }.');
  }
  return value;
}

function normalizeChanges(value, projectRoot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { files: detectChangedFiles(projectRoot) };
  }
  return {
    files: Array.isArray(value.files) ? value.files : detectChangedFiles(projectRoot),
    ...(typeof value.patch === 'string' ? { patch: value.patch } : {}),
  };
}

function detectChangedFiles(projectRoot) {
  const gitPath = join(projectRoot, '.git');
  if (!existsSync(gitPath)) return [];
  // Keep workflow IO deterministic and bounded. Git execution is deliberately
  // left to the host; completion accepts an explicit evaluation file.
  return [];
}

function writeSession(projectRoot, session) {
  const directory = join(projectRoot, '.resonant-code', 'context', 'runtime-sessions', 'code');
  mkdirSync(directory, { recursive: true });
  cleanupSessions(directory);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionPath = join(directory, `${stamp}-${session.decision.decisionId}.json`);
  writeJsonAtomic(sessionPath, session);
  return sessionPath;
}

function readSession(sessionPath) {
  const session = readJsonFile(sessionPath, 'runtime session');
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error('Runtime session must be a JSON object.');
  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: session must use ${SESSION_SCHEMA_VERSION}; re-run prepare.`);
  }
  if (!session.decision || session.decision.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: session decision must use ${SESSION_SCHEMA_VERSION}; re-run prepare.`);
  }
  return session;
}

function cleanupSessions(directory) {
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtime: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  for (const entry of entries.slice(50)) rmSync(join(directory, entry.name), { force: true });
}

function sourceFileStatus(path, expectedArrayKey) {
  if (!existsSync(path)) return 'absent';
  try {
    const text = readFileSync(path, 'utf8');
    const schemaPattern = SESSION_SCHEMA_VERSION.replace('.', '\\.');
    const currentVersion = new RegExp(`^version:\\s*["']?${schemaPattern}["']?\\s*$`, 'm').test(text);
    return currentVersion && new RegExp(`^${expectedArrayKey}:`, 'm').test(text) ? 'present' : 'invalid';
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
    throw new Error(`Failed to read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeEnum(value, allowed, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}: expected one of ${allowed.join(', ')}.`);
  return value;
}

function normalizePositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid ${label}: expected a positive integer.`);
  }
  return number;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

function requiredPath(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return resolve(value);
}
