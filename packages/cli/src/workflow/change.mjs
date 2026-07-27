/** CLI-owned change orchestration around the Runtime hard kernel. */
import { createHash } from 'node:crypto';
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { compileChange, evaluateChange } from '@sovea/resonant-code-core';
import { validateContext } from '@sovea/resonant-code-core/rccl';
import { loadCheckPlan, runCheckPlan } from '../facts/checks.mjs';
import {
  captureGitWorktree,
  compareGitWorktrees,
  summarizeWorktreeSnapshot,
} from '../facts/worktree.mjs';

const SESSION_SCHEMA_VERSION = '1.0';

export async function prepareCodeTask(options) {
  const paths = resolvePaths(options);
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
  const output = await compileChange({
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

  const checkPlan = loadCheckPlan(paths.checkConfigPath, output.verificationPlan);
  const worktreeBaseline = captureGitWorktree(paths.projectRoot);
  const sessionPath = writeSession(paths.projectRoot, {
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
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
    evaluation: null,
  });
  return compactDecision(
    output,
    sessionPath,
    checkPlan,
    summarizeWorktreeSnapshot(worktreeBaseline),
  );
}

export async function completeCodeTask(options) {
  const sessionPath = requiredPath(options.sessionPath, 'complete requires --session <path>.');
  const session = readSession(sessionPath);
  summarizeWorktreeSnapshot(session.worktreeBaseline);
  const artifact = options.evaluationFile
    ? readJsonFile(options.evaluationFile, 'evaluation input')
    : {
        attestations: [],
        exceptions: [],
      };
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('Evaluation input must be a JSON object.');
  }
  const unsupportedFields = Object.keys(artifact)
    .filter((field) => !['attestations', 'exceptions'].includes(field));
  if (unsupportedFields.length) {
    throw new Error(
      `Evaluation input field(s) ${unsupportedFields.join(', ')} are not accepted; complete collects change/check facts and accepts only attestations and exceptions.`,
    );
  }
  if (artifact.attestations !== undefined && !Array.isArray(artifact.attestations)) {
    throw new Error('Evaluation input attestations must be an array.');
  }
  if (artifact.exceptions !== undefined && !Array.isArray(artifact.exceptions)) {
    throw new Error('Evaluation input exceptions must be an array.');
  }
  const outputDirectory = join(
    session.projectRoot,
    '.resonant-code',
    'context',
    'runtime-sessions',
    'check-output',
    session.decision.decisionId,
  );
  const collectedChecks = await runCheckPlan({
    projectRoot: session.projectRoot,
    plan: session.checkPlan,
    outputDirectory,
  });
  const currentWorktree = captureGitWorktree(session.projectRoot);
  const changes = compareGitWorktrees(session.worktreeBaseline, currentWorktree);
  const checks = collectedChecks.map((check) => ({
    ...check,
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: changes.provenance.collectionId,
    },
  }));
  const evaluation = evaluateChange({
    decision: session.decision,
    changes,
    checks,
    attestations: Array.isArray(artifact.attestations) ? artifact.attestations : [],
    exceptions: Array.isArray(artifact.exceptions) ? artifact.exceptions : [],
    feedbackPath: join(session.projectRoot, '.resonant-code', 'feedback', 'verified-events.jsonl'),
  });
  const nextSession = {
    ...session,
    completionFacts: {
      currentWorktree,
      checks,
    },
    evaluation,
    completedAt: new Date().toISOString(),
  };
  writeJsonAtomic(sessionPath, nextSession);
  return {
    status: evaluation.status,
    schemaVersion: SESSION_SCHEMA_VERSION,
    decisionId: evaluation.decisionId,
    evaluationId: evaluation.evaluationId,
    operation: evaluation.operation,
    changes: evaluation.changes,
    summary: evaluation.summary,
    assurance: evaluation.assurance,
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

export function inspectCodeFeedback(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const feedbackDirectory = join(projectRoot, '.resonant-code', 'feedback');
  const aggregatePath = join(feedbackDirectory, 'aggregates.json');
  if (!existsSync(aggregatePath)) {
    return {
      status: 'absent',
      schemaVersion: SESSION_SCHEMA_VERSION,
      aggregatePath,
      aggregates: [],
      missingGuidanceIds: unique(options.guidanceIds ?? []),
    };
  }
  const document = readFeedbackAggregate(aggregatePath);
  const requested = unique(options.guidanceIds ?? []);
  const byId = new Map(document.aggregates.map((aggregate) => [aggregate.guidanceId, aggregate]));
  return {
    status: 'ok',
    schemaVersion: SESSION_SCHEMA_VERSION,
    aggregatePath,
    source: document.source,
    aggregates: requested.length
      ? requested.flatMap((id) => byId.has(id) ? [byId.get(id)] : [])
      : document.aggregates,
    missingGuidanceIds: requested.filter((id) => !byId.has(id)),
  };
}

export function createApprovedFeedbackProposal(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
  const inputPath = requiredPath(options.inputFile, 'propose-feedback-change requires --input <approved-proposal.json>.');
  const candidate = readJsonFile(inputPath, 'approved feedback proposal');
  validateFeedbackProposalCandidate(candidate);

  const feedbackDirectory = join(projectRoot, '.resonant-code', 'feedback');
  const aggregatePath = join(feedbackDirectory, 'aggregates.json');
  if (!existsSync(aggregatePath)) {
    throw new Error('Feedback aggregates are absent; complete evidence-backed tasks before proposing a policy change.');
  }
  const aggregates = readFeedbackAggregate(aggregatePath);
  const sourceAggregate = aggregates.aggregates
    .find((aggregate) => aggregate.guidanceId === candidate.guidanceId);
  if (!sourceAggregate) {
    throw new Error(`Feedback has no aggregate for guidance ${candidate.guidanceId}.`);
  }
  if (candidate.aggregateFingerprint !== sourceAggregate.aggregateFingerprint) {
    throw new Error(`Feedback aggregate for ${candidate.guidanceId} changed; inspect it again before approving a proposal.`);
  }

  const semanticProposal = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    guidanceId: candidate.guidanceId,
    aggregateFingerprint: candidate.aggregateFingerprint,
    target: candidate.target,
    change: {
      kind: candidate.change.kind,
      summary: candidate.change.summary.trim(),
      proposedContent: candidate.change.proposedContent,
    },
    rationale: candidate.rationale.trim(),
    approval: {
      status: 'approved',
      approvedBy: candidate.approval.approvedBy.trim(),
      reason: candidate.approval.reason.trim(),
    },
  };
  const proposalId = hashJson([
    'feedback-change-proposal',
    semanticProposal,
    sourceAggregate,
  ]);
  const directory = join(feedbackDirectory, 'change-proposals');
  const proposalPath = join(directory, `${proposalId}.json`);
  if (existsSync(proposalPath)) {
    const existing = readJsonFile(proposalPath, 'existing feedback proposal');
    const existingSemantic = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? {
          schemaVersion: existing.schemaVersion,
          guidanceId: existing.guidanceId,
          aggregateFingerprint: existing.aggregateFingerprint,
          target: existing.target,
          change: existing.change,
          rationale: existing.rationale,
          approval: existing.approval && typeof existing.approval === 'object'
            ? {
                status: existing.approval.status,
                approvedBy: existing.approval.approvedBy,
                reason: existing.approval.reason,
              }
            : null,
        }
      : null;
    if (existing?.proposalId !== proposalId
      || JSON.stringify(existingSemantic) !== JSON.stringify(semanticProposal)
      || JSON.stringify(existing.sourceAggregate) !== JSON.stringify(sourceAggregate)
      || existing.applyStatus !== 'not-applied') {
      throw new Error(`Existing feedback proposal at ${proposalPath} does not match its content-derived identity.`);
    }
    return {
      status: 'approved-proposal',
      schemaVersion: SESSION_SCHEMA_VERSION,
      proposalId,
      proposalPath,
      written: false,
      applyStatus: 'not-applied',
    };
  }
  const approvedAt = new Date().toISOString();
  writeJsonAtomic(proposalPath, {
    ...semanticProposal,
    proposalId,
    createdAt: approvedAt,
    approval: {
      ...semanticProposal.approval,
      approvedAt,
    },
    sourceAggregate,
    applyStatus: 'not-applied',
  });
  return {
    status: 'approved-proposal',
    schemaVersion: SESSION_SCHEMA_VERSION,
    proposalId,
    proposalPath,
    written: true,
    applyStatus: 'not-applied',
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
  const feedbackPath = join(paths.projectRoot, '.resonant-code', 'feedback', 'verified-events.jsonl');
  const feedbackAggregatePath = join(paths.projectRoot, '.resonant-code', 'feedback', 'aggregates.json');
  const feedback = feedbackStatus(feedbackPath, feedbackAggregatePath);
  const nextActions = [];
  if (localAugment === 'absent') {
    nextActions.push({ code: 'local-augment-absent', message: 'Run bootstrap or add project-specific prescriptive guidance.' });
  }
  if (rccl === 'absent') {
    nextActions.push({ code: 'rccl-absent', message: 'Calibrate decision-relevant repository observations when local reality should affect changes.' });
  } else if (rccl !== 'present') {
    nextActions.push({ code: 'rccl-invalid', message: 'RCCL exists but cannot be parsed as a current observation document.' });
  }
  if (checks === 'absent') {
    nextActions.push({
      code: 'checks-absent',
      message: 'Add explicit command mappings in .resonant-code/checks.json before trusted completion.',
    });
  } else if (checks !== 'present') {
    nextActions.push({
      code: 'checks-invalid',
      message: 'The configured check file is not valid for the current schema.',
    });
  }
  if (feedback === 'invalid') {
    nextActions.push({
      code: 'feedback-invalid',
      message: 'Verified feedback events and Runtime-owned aggregates are inconsistent; inspect the files before recording more outcomes.',
    });
  }
  if (missingControlPlaneFiles.length) {
    nextActions.unshift({
      code: 'core-installation-incomplete',
      message: 'The Core installation is missing its built-in Playbook assets.',
    });
  }
  return {
    status: missingControlPlaneFiles.length ? 'blocked' : 'ok',
    schemaVersion: SESSION_SCHEMA_VERSION,
    readiness: {
      status: missingControlPlaneFiles.length ? 'blocked' : nextActions.length ? 'needs-attention' : 'ready',
      nextActions,
    },
    sources: {
      localAugment,
      personalOverlay,
      rccl,
      checks,
      feedback,
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
      feedbackPath,
      feedbackAggregatePath,
    },
  };
}

function readFeedbackAggregate(path) {
  const value = readJsonFile(path, 'feedback aggregate');
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== SESSION_SCHEMA_VERSION
    || !value.source || typeof value.source !== 'object' || Array.isArray(value.source)
    || typeof value.source.eventsFile !== 'string'
    || !Number.isInteger(value.source.eventCount) || value.source.eventCount < 0
    || typeof value.source.eventsFingerprint !== 'string'
    || !/^[a-f0-9]{16}$/.test(value.source.eventsFingerprint)
    || !Array.isArray(value.aggregates)) {
    throw new Error(`Feedback aggregate at ${path} is invalid or uses an unsupported schema.`);
  }
  const ids = new Set();
  for (const aggregate of value.aggregates) {
    if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)
      || typeof aggregate.guidanceId !== 'string' || !aggregate.guidanceId.trim()
      || ids.has(aggregate.guidanceId)
      || !Array.isArray(aggregate.sections)
      || !aggregate.sections.every((section) => ['required', 'consider', 'avoid', 'tension'].includes(section))
      || !Array.isArray(aggregate.evidenceKinds)
      || !aggregate.evidenceKinds.every((kind) => ['diff', 'file', 'check', 'semantic'].includes(kind))
      || !['satisfied', 'violated', 'excepted', 'total'].every((field) =>
        Number.isInteger(aggregate[field]) && aggregate[field] >= 0)
      || aggregate.total !== aggregate.satisfied + aggregate.violated + aggregate.excepted
      || typeof aggregate.aggregateFingerprint !== 'string'
      || !/^[a-f0-9]{16}$/.test(aggregate.aggregateFingerprint)) {
      throw new Error(`Feedback aggregate at ${path} contains an invalid guidance entry.`);
    }
    ids.add(aggregate.guidanceId);
  }
  return value;
}

function validateFeedbackProposalCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== SESSION_SCHEMA_VERSION
    || typeof value.guidanceId !== 'string' || !value.guidanceId.trim()
    || typeof value.aggregateFingerprint !== 'string'
    || !/^[a-f0-9]{16}$/.test(value.aggregateFingerprint)
    || !['team-playbook', 'personal-overlay'].includes(value.target)
    || !value.change || typeof value.change !== 'object' || Array.isArray(value.change)
    || !['add', 'revise', 'retire', 'add-exception'].includes(value.change.kind)
    || typeof value.change.summary !== 'string' || !value.change.summary.trim()
    || !value.change.proposedContent || typeof value.change.proposedContent !== 'object'
    || Array.isArray(value.change.proposedContent)
    || typeof value.rationale !== 'string' || !value.rationale.trim()
    || !value.approval || typeof value.approval !== 'object' || Array.isArray(value.approval)
    || value.approval.status !== 'approved'
    || typeof value.approval.approvedBy !== 'string' || !value.approval.approvedBy.trim()
    || typeof value.approval.reason !== 'string' || !value.approval.reason.trim()) {
    throw new Error(
      'Approved feedback proposal must include current guidanceId/aggregateFingerprint, target, change, rationale, and approval { status: "approved", approvedBy, reason }.',
    );
  }
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

function compactDecision(decision, sessionPath, checkPlan, baseline) {
  return {
    status: decision.status,
    schemaVersion: decision.schemaVersion,
    guidanceMode: decision.mode,
    decisionId: decision.decisionId,
    task: decision.task,
    guidance: decision.executionGuidance,
    verificationPlan: decision.verificationPlan,
    delivery: decision.trace.delivery,
    checkPlan,
    baseline,
    diagnostics: decision.trace.diagnostics,
    sessionPath,
    nextStep: checkPlan.some((item) => item.status === 'missing')
      ? 'Configure every missing check and rerun prepare before implementation; complete will collect the baseline-to-current diff and run only configured commands.'
      : 'Implement using required/consider/avoid/tensions, then complete with host attestations; complete will collect the baseline-to-current diff and run the configured commands.',
  };
}

function resolvePaths(options) {
  const projectRoot = resolve(requiredString(options.projectRoot, 'project root'));
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
      options.checkConfigPath
        ?? join(projectRoot, '.resonant-code', 'checks.json'),
    ),
  };
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
  if (typeof session.decision.decisionId !== 'string'
    || !/^[a-f0-9]{16}$/.test(session.decision.decisionId)) {
    throw new Error('Runtime session decisionId is invalid; re-run prepare.');
  }
  if (!session.worktreeBaseline || !Array.isArray(session.checkPlan)) {
    throw new Error('Runtime session predates trusted machine-fact collection; re-run prepare.');
  }
  if (typeof session.projectRoot !== 'string' || !session.projectRoot.trim()) {
    throw new Error('Runtime session projectRoot is invalid; re-run prepare.');
  }
  const expectedDirectory = resolve(
    session.projectRoot,
    '.resonant-code',
    'context',
    'runtime-sessions',
    'code',
  );
  const sessionRelativePath = relative(expectedDirectory, resolve(sessionPath));
  if (!sessionRelativePath
    || isAbsolute(sessionRelativePath)
    || sessionRelativePath === '..'
    || sessionRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Runtime session must remain in the project runtime-session directory.');
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

function rcclStatus(projectRoot, rcclPath) {
  const result = validateContext({ projectRoot, rcclPath, write: false });
  if (result.status === 'missing') return 'absent';
  return result.status === 'valid' ? 'present' : 'invalid';
}

function checkConfigStatus(path) {
  if (!existsSync(path)) return 'absent';
  try {
    loadCheckPlan(path, { commands: [] });
    return 'present';
  } catch {
    return 'invalid';
  }
}

function feedbackStatus(eventsPath, aggregatePath) {
  const events = existsSync(eventsPath);
  const aggregate = existsSync(aggregatePath);
  if (!events && !aggregate) return 'absent';
  if (!events || !aggregate) return 'invalid';
  try {
    readFeedbackAggregate(aggregatePath);
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

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

function requiredPath(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return resolve(value);
}
