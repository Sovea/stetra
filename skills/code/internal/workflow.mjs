import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function prepareInterpretation(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const candidatePath = buildCandidatePath(paths.projectRoot, task);
  return runtime.prepareTaskInterpretationContract({ task, candidatePath });
}

function buildCandidatePath(projectRoot, task) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
      type: 'candidate',
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'task-candidates', 'code', `${stamp}-${digest}.json`);
}

function summarizeInterpretationFlow(mode, candidateFile, diagnostics, candidateCount) {
  const steps = [];
  steps.push(candidateFile
    ? `Using candidate file ${resolve(candidateFile)} as host-agent input.`
    : 'No candidate file provided; Runtime will rely on deterministic interpretation only.');
  steps.push(`Interpretation mode: ${mode}.`);
  steps.push(`Candidate count: ${candidateCount}.`);
  if (diagnostics?.clarification_recommended) {
    steps.push(`Clarification recommended: ${diagnostics.ambiguity_reasons.join('; ') || 'additional ambiguity detected'}.`);
  }
  return steps;
}

function buildPrepareNextStep(mode, candidateFile, diagnostics, recommendationPath) {
  if (candidateFile) {
    return 'Proceed with the compiled packet and use interpretation provenance if you need to explain how fields were resolved.';
  }
  if (mode === 'deterministic-only' && diagnostics?.clarification_recommended) {
    return `If the deterministic interpretation looks too weak, generate a host-agent candidate file at ${recommendationPath} and re-run prepare with --candidate-file.`;
  }
  return 'Proceed with the compiled packet.';
}

export async function prepareRelations(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const candidateArtifact = loadCandidateArtifact(options.candidateFile, runtime);
  const interpretationMode = candidateArtifact.candidates.length ? 'host-agent' : 'deterministic-only';
  const resolvedTask = runtime.resolveTask({
    task,
    candidates: candidateArtifact.candidates,
    interpretationMode,
  });
  const artifactPath = buildRelationProposalPath(paths.projectRoot, task);
  const compileInput = {
    builtinRoot: paths.builtinRoot,
    localAugmentPath: paths.localAugmentPath,
    rcclPath: paths.rcclPath,
    lockfilePath: paths.lockfilePath,
    projectRoot: paths.projectRoot,
    resolvedTask,
  };
  const contractOutput = await runtime.prepareSemanticRelationContractBundle({
    compileInput,
    artifactPath,
  });

  return {
    task: {
      input: task,
      resolved: {
        task_intent: resolvedTask.task_intent,
        context_profile: resolvedTask.context_profile,
      },
      interpretation: {
        mode: interpretationMode,
        diagnostics: resolvedTask.diagnostics,
      },
    },
    fulfillment: buildFulfillmentDiagnostics({
      candidate: candidateArtifact,
      relation: buildAbsentArtifact('semantic-relation', artifactPath),
      semanticCandidate: buildAbsentArtifact('semantic-candidate'),
    }),
    directives: contractOutput.directives,
    observations: contractOutput.observations,
    ...contractOutput,
  };
}

export async function prepareSemanticCandidates(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const candidateArtifact = loadCandidateArtifact(options.candidateFile, runtime);
  const interpretationMode = candidateArtifact.candidates.length ? 'host-agent' : 'deterministic-only';
  const resolvedTask = runtime.resolveTask({
    task,
    candidates: candidateArtifact.candidates,
    interpretationMode,
  });
  const artifactPath = buildSemanticCandidatePath(paths.projectRoot, task);
  const compileInput = {
    builtinRoot: paths.builtinRoot,
    localAugmentPath: paths.localAugmentPath,
    rcclPath: paths.rcclPath,
    lockfilePath: paths.lockfilePath,
    projectRoot: paths.projectRoot,
    resolvedTask,
  };
  const contractOutput = await runtime.prepareSemanticCandidateContractBundle({
    compileInput,
    artifactPath,
  });

  return {
    task: {
      input: task,
      resolved: {
        task_intent: resolvedTask.task_intent,
        context_profile: resolvedTask.context_profile,
      },
      interpretation: {
        mode: interpretationMode,
        diagnostics: resolvedTask.diagnostics,
      },
    },
    fulfillment: buildFulfillmentDiagnostics({
      candidate: candidateArtifact,
      relation: buildAbsentArtifact('semantic-relation'),
      semanticCandidate: buildAbsentArtifact('semantic-candidate', artifactPath),
    }),
    directives: contractOutput.directives,
    observations: contractOutput.observations,
    ...contractOutput,
  };
}

export async function prepareAdherenceEvaluation(options) {
  const session = JSON.parse(readFileSync(resolve(options.sessionPath), 'utf-8'));
  if (session.status !== 'ok' || !session.compileOutput?.packet?.governance?.ego) {
    return {
      status: 'skipped',
      sessionPath: resolve(options.sessionPath),
      reason: 'Runtime guidance was unavailable during prepare; adherence evaluation contract skipped.',
    };
  }
  const runtime = await loadRuntime(session.paths.runtimeEntry);
  const ego = session.compileOutput.packet.governance.ego;
  const directives = ego.guidance.must_follow.map((d) => ({
    id: d.id,
    description: d.description,
    prescription: d.prescription,
    execution_mode: d.execution_mode ?? 'enforce',
  }));
  const taskDescription = session.compileOutput.packet.task.input.description;
  const artifactPath = buildAdherenceArtifactPath(session.paths.projectRoot, session.compileOutput.packet.task.input);
  const contractOutput = runtime.prepareAdherenceEvaluationContract({
    directives,
    taskDescription,
    artifactPath,
  });
  return {
    status: 'ok',
    sessionPath: resolve(options.sessionPath),
    ...contractOutput,
  };
}

export async function prepareCodeTask(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const sessionPath = buildSessionPath(paths.projectRoot, task);
  const warnings = [];

  if (!paths.localAugmentPath) warnings.push('Local augment not found; using built-in playbook layers only.');
  if (!paths.rcclPath) warnings.push('RCCL not found; proceeding without repository calibration signals.');

  let candidateArtifact = {
    ...buildAbsentArtifact('task-interpretation'),
    candidates: [],
  };
  let relationArtifact = buildAbsentArtifact('semantic-relation');
  let semanticCandidateArtifact = buildAbsentArtifact('semantic-candidate');

  try {
    candidateArtifact = loadCandidateArtifact(options.candidateFile, runtime);
    const interpretationMode = candidateArtifact.candidates.length ? 'host-agent' : 'deterministic-only';
    const resolvedTask = runtime.resolveTask({
      task,
      candidates: candidateArtifact.candidates,
      interpretationMode,
    });
    const hasSemanticArtifacts = Boolean(options.hostProposalFile || options.semanticProposalFile);
    const allowedIds = hasSemanticArtifacts
      ? buildAllowedIds(await runtime.prepareSemanticContractContext({
          compileInput: {
            builtinRoot: paths.builtinRoot,
            localAugmentPath: paths.localAugmentPath,
            rcclPath: paths.rcclPath,
            lockfilePath: paths.lockfilePath,
            projectRoot: paths.projectRoot,
            resolvedTask,
          },
        }))
      : undefined;
    relationArtifact = loadHostProposalArtifact(options.hostProposalFile, 'code-skill-semantic-relations', runtime, allowedIds);
    semanticCandidateArtifact = loadHostSemanticCandidateArtifact(options.semanticProposalFile, 'code-skill-semantic-candidates', runtime, allowedIds);
    const hostProposals = [
      ...artifactProposalList(relationArtifact),
      ...artifactProposalList(semanticCandidateArtifact),
    ];
    const fulfillment = buildFulfillmentDiagnostics({
      candidate: candidateArtifact,
      relation: relationArtifact,
      semanticCandidate: semanticCandidateArtifact,
    });
    const compileInput = {
      builtinRoot: paths.builtinRoot,
      localAugmentPath: paths.localAugmentPath,
      rcclPath: paths.rcclPath,
      lockfilePath: paths.lockfilePath,
      projectRoot: paths.projectRoot,
      resolvedTask,
      hostFulfillment: fulfillment,
      ...(hostProposals.length ? { hostProposals } : {}),
    };
    const output = await runtime.compile(compileInput);
    const interpretationSummary = summarizeInterpretationFlow(
      interpretationMode,
      options.candidateFile,
      output.packet.interpretation.diagnostics,
      resolvedTask.candidates?.length ?? 0,
    );
    const suggestedCandidatePath = buildCandidatePath(paths.projectRoot, task);
    const session = {
      version: '1.0',
      status: 'ok',
      createdAt: new Date().toISOString(),
      paths,
      taskInput: task,
      interpretation: {
        mode: interpretationMode,
        candidates: resolvedTask.candidates,
        provenance: output.packet.interpretation.input_provenance,
        diagnostics: output.packet.interpretation.diagnostics,
        trace: output.packet.interpretation.trace,
      },
      fulfillment,
      compileInput,
      compileOutput: output,
      warnings,
    };
    writeSession(sessionPath, session);
    return {
      status: 'ok',
      sessionPath,
      paths,
      packet: output.packet,
      ego: output.ego,
      trace: output.trace,
      warnings,
      interpretation: {
        mode: interpretationMode,
        candidateFile: options.candidateFile ? resolve(options.candidateFile) : null,
        provenance: output.packet.interpretation.input_provenance,
        diagnostics: output.packet.interpretation.diagnostics,
        summary: interpretationSummary,
        nextStep: buildPrepareNextStep(interpretationMode, options.candidateFile, output.packet.interpretation.diagnostics, suggestedCandidatePath),
      },
      hostProposals: summarizeHostProposals(hostProposals),
      fulfillment,
    };
  } catch (error) {
    const message = formatError(error);
    const candidateSnapshot = candidateArtifact;
    const relationSnapshot = relationArtifact;
    const semanticCandidateSnapshot = semanticCandidateArtifact;
    const interpretationMode = candidateSnapshot.candidates.length ? 'host-agent' : 'deterministic-only';
    const suggestedCandidatePath = buildCandidatePath(paths.projectRoot, task);
    const interpretationContract = runtime.prepareTaskInterpretationContract({
      task,
      candidatePath: suggestedCandidatePath,
    });
    const failureDiagnostics = {
      clarification_recommended: !options.candidateFile,
      ambiguity_reasons: interpretationContract.ambiguityHints,
      discarded_inputs: [],
    };
    const session = {
      version: '1.0',
      status: 'failed',
      createdAt: new Date().toISOString(),
      paths,
      taskInput: task,
      interpretation: {
        mode: interpretationMode,
        candidates: candidateSnapshot.candidates,
      },
      fulfillment: buildFulfillmentDiagnostics({
        candidate: candidateSnapshot,
        relation: relationSnapshot,
        semanticCandidate: semanticCandidateSnapshot,
      }),
      compileInput: {
        builtinRoot: paths.builtinRoot,
        localAugmentPath: paths.localAugmentPath,
        rcclPath: paths.rcclPath,
        lockfilePath: paths.lockfilePath,
        projectRoot: paths.projectRoot,
        task,
        interpretationMode,
        ...(options.hostProposalFile ? { hostProposalFile: resolve(options.hostProposalFile) } : {}),
        ...(options.semanticProposalFile ? { semanticProposalFile: resolve(options.semanticProposalFile) } : {}),
      },
      compileOutput: null,
      warnings: [...warnings, `Runtime compile failed: ${message}`],
      error: message,
    };
    writeSession(sessionPath, session);
    return {
      status: 'failed',
      sessionPath,
      paths,
      ego: null,
      trace: null,
      warnings: session.warnings,
      error: message,
      interpretation: {
        mode: interpretationMode,
        candidateFile: options.candidateFile ? resolve(options.candidateFile) : null,
        diagnostics: failureDiagnostics,
        summary: summarizeInterpretationFlow(interpretationMode, options.candidateFile, failureDiagnostics, candidateSnapshot.candidates.length),
        nextStep: 'Fix the Runtime compile error and re-run prepare.',
      },
      fulfillment: buildFulfillmentDiagnostics({
        candidate: candidateSnapshot,
        relation: relationSnapshot,
        semanticCandidate: semanticCandidateSnapshot,
      }),
    };
  }
}

export async function completeCodeTask(options) {
  const session = JSON.parse(readFileSync(resolve(options.sessionPath), 'utf-8'));
  if (session.status !== 'ok' || !session.compileOutput?.packet?.governance?.ego) {
    return {
      status: 'skipped',
      sessionPath: resolve(options.sessionPath),
      lockfilePath: session.paths?.lockfilePath ?? null,
      reason: 'Runtime guidance was unavailable during prepare; lockfile update skipped.',
    };
  }

  try {
    const runtime = await loadRuntime(session.paths.runtimeEntry);
    const packet = session.compileOutput.packet;
    const adherenceArtifact = loadAdherenceArtifact(options.adherenceFile, runtime, packet);
    const followedDirectiveIds = options.followedDirectiveIds?.length
      ? unique(options.followedDirectiveIds)
      : packet.governance.semantic_merge.directive_modes
          .filter((directive) => directive.execution_mode !== 'suppress')
          .map((directive) => directive.directive_id);
    const ignoredDirectiveIds = unique(options.ignoredDirectiveIds ?? []);
    const fulfillment = session.fulfillment
      ? { ...session.fulfillment, adherenceEvaluation: summarizeArtifact(adherenceArtifact) }
      : undefined;
    runtime.evaluateGuidance({
      ego: packet.governance.ego,
      packet,
      lockfilePath: session.paths.lockfilePath,
      followedDirectiveIds,
      ignoredDirectiveIds,
      ignoredDirectiveReasons: options.ignoredDirectiveReasons,
      signalConfidence: options.signalConfidence,
      hostFulfillment: fulfillment,
      adherencePayload: adherenceArtifact.verdicts.length ? adherenceArtifact.verdicts : undefined,
    });
    return {
      status: 'updated',
      sessionPath: resolve(options.sessionPath),
      lockfilePath: session.paths.lockfilePath,
      followedDirectiveIds,
      ignoredDirectiveIds,
      ignoredDirectiveReasons: options.ignoredDirectiveReasons,
      signalConfidence: options.signalConfidence,
      adherence: {
        provided: adherenceArtifact.provided,
        status: adherenceArtifact.status,
        verdictCount: adherenceArtifact.verdicts.length,
        diagnostics: adherenceArtifact.diagnostics,
      },
    };
  } catch (error) {
    return {
      status: 'skipped',
      sessionPath: resolve(options.sessionPath),
      lockfilePath: session.paths.lockfilePath,
      reason: `Lockfile update failed: ${formatError(error)}`,
    };
  }
}

async function loadRuntime(runtimeEntry) {
  return import(pathToFileURL(runtimeEntry).href);
}

export function resolveRuntimePaths(projectRoot, pluginRoot) {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedPluginRoot = pluginRoot
    ? resolve(pluginRoot)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const builtinRoot = join(resolvedPluginRoot, 'playbook');
  const runtimeEntry = join(resolvedPluginRoot, 'runtime', 'dist', 'index.mjs');
  const localAugmentPath = resolveOptionalFile(resolvedProjectRoot, '.resonant-code', 'playbook', 'local-augment.yaml');
  const rcclPath = resolveOptionalFile(resolvedProjectRoot, '.resonant-code', 'rccl.yaml');
  return {
    projectRoot: resolvedProjectRoot,
    pluginRoot: resolvedPluginRoot,
    builtinRoot,
    runtimeEntry,
    localAugmentPath,
    rcclPath,
    lockfilePath: join(resolvedProjectRoot, '.resonant-code', 'playbook.lock.yaml'),
  };
}

function resolveOptionalFile(root, ...parts) {
  const filePath = join(root, ...parts);
  return existsSync(filePath) ? filePath : undefined;
}

function normalizeTaskInput(options, projectRoot, runtime) {
  const changedFiles = unique((options.changedFiles ?? []).map((file) => normalizeProjectFile(file, projectRoot)).filter(Boolean));
  const targetFile = options.targetFile ? normalizeProjectFile(options.targetFile, projectRoot) : undefined;
  const task = {
    description: options.taskDescription,
    operation: options.operation,
    targetFile,
    changedFiles,
    techStack: unique(options.techStack ?? []),
    tags: unique(options.tags ?? []),
    projectStage: options.projectStage,
    optimizationTarget: options.optimizationTarget,
    hardConstraints: unique(options.hardConstraints ?? []),
    allowedTradeoffs: unique(options.allowedTradeoffs ?? []),
    avoid: unique(options.avoid ?? []),
    riskLevel: options.riskLevel,
    scopeSize: options.scopeSize,
    compatibilityRequirement: options.compatibilityRequirement,
    interfaceSensitivity: options.interfaceSensitivity,
    refactorTolerance: options.refactorTolerance,
    migrationPhase: options.migrationPhase,
    reviewGoal: options.reviewGoal,
  };
  validateTaskInputEnums(task, runtime?.TASK_INPUT_ENUMS);
  return task;
}

function validateTaskInputEnums(task, enumSchema) {
  if (!enumSchema) return;
  const fields = [
    ['operation', 'operation'],
    ['taskKind', 'task-kind'],
    ['projectStage', 'project-stage'],
    ['optimizationTarget', 'optimization-target'],
    ['riskLevel', 'risk-level'],
    ['scopeSize', 'scope-size'],
    ['compatibilityRequirement', 'compatibility-requirement'],
    ['interfaceSensitivity', 'interface-sensitivity'],
    ['refactorTolerance', 'refactor-tolerance'],
    ['migrationPhase', 'migration-phase'],
    ['reviewGoal', 'review-goal'],
  ];
  for (const [field, flag] of fields) {
    const value = task[field];
    if (value === undefined) continue;
    const allowed = Array.from(enumSchema[field] ?? []);
    if (!allowed.includes(value)) {
      throw new Error(`Invalid --${flag} value "${value}". Expected one of: ${allowed.join(', ')}.`);
    }
  }
}

function normalizeProjectFile(filePath, projectRoot) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  const rel = relative(projectRoot, absolute).replace(/\\/g, '/');
  if (!rel || rel === '.') return '';
  return rel.startsWith('..') ? filePath.replace(/\\/g, '/') : rel;
}

function loadCandidateArtifact(candidateFile, runtime) {
  if (!candidateFile) {
    return {
      ...buildAbsentArtifact('task-interpretation'),
      candidates: [],
    };
  }
  const path = resolve(candidateFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const result = runtime.parseTaskInterpretationCandidatePayloadWithDiagnostics(payload);
  return {
    kind: 'task-interpretation',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    candidates: result.candidates,
  };
}

function loadHostProposalArtifact(hostProposalFile, sourceId, runtime, allowedIds) {
  if (!hostProposalFile) return buildAbsentArtifact('semantic-relation');
  const path = resolve(hostProposalFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const result = runtime.validateSemanticRelationProposalPayload({
    raw: payload,
    source: {
      id: sourceId,
      path,
    },
    ...allowedIds,
  });
  return {
    kind: 'semantic-relation',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    proposal: result.proposal,
  };
}

function loadHostSemanticCandidateArtifact(semanticProposalFile, sourceId, runtime, allowedIds) {
  if (!semanticProposalFile) return buildAbsentArtifact('semantic-candidate');
  const path = resolve(semanticProposalFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const result = runtime.validateSemanticCandidateProposalPayload({
    raw: payload,
    source: {
      id: sourceId,
      path,
    },
    ...allowedIds,
  });
  return {
    kind: 'semantic-candidate',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    proposal: result.proposal,
  };
}

function loadAdherenceArtifact(adherenceFile, runtime, packet) {
  if (!adherenceFile) return { ...buildAbsentArtifact('adherence-evaluation'), verdicts: [] };
  const path = resolve(adherenceFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const allowedDirectiveIds = packet.governance.semantic_merge.directive_modes
    .filter((d) => d.execution_mode !== 'suppress')
    .map((d) => d.directive_id);
  const result = runtime.validateAdherenceEvaluationPayload(payload, allowedDirectiveIds);
  return {
    kind: 'adherence-evaluation',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    verdicts: result.verdicts,
  };
}

function artifactProposalList(artifact) {
  return artifact.proposal ? [artifact.proposal] : [];
}

function buildAllowedIds(contractContext) {
  return {
    allowedDirectiveIds: contractContext.directives.map((directive) => directive.id),
    allowedObservationIds: contractContext.observations.map((observation) => observation.id),
  };
}

function buildAbsentArtifact(kind, recommendedPath) {
  return {
    kind,
    provided: false,
    path: null,
    recommendedPath: recommendedPath ?? null,
    status: 'absent',
    diagnostics: null,
  };
}

function buildFulfillmentDiagnostics({ candidate, relation, semanticCandidate }) {
  return {
    status: summarizeFulfillmentStatus([candidate, relation, semanticCandidate]),
    taskInterpretation: summarizeArtifact(candidate),
    semanticRelation: summarizeArtifact(relation),
    semanticCandidate: summarizeArtifact(semanticCandidate),
  };
}

function summarizeArtifact(artifact) {
  return {
    kind: artifact.kind,
    provided: artifact.provided,
    path: artifact.path,
    ...(artifact.recommendedPath ? { recommendedPath: artifact.recommendedPath } : {}),
    status: artifact.status,
    diagnostics: artifact.diagnostics,
  };
}

function summarizeDiagnosticStatus(diagnostics) {
  if (!diagnostics) return 'absent';
  if (diagnostics.summary.accepted > 0 && diagnostics.summary.rejected === 0 && diagnostics.summary.unused === 0) return 'accepted';
  if (diagnostics.summary.accepted > 0) return 'partially-accepted';
  if (diagnostics.summary.rejected > 0) return 'rejected';
  return 'unused';
}

function summarizeFulfillmentStatus(artifacts) {
  const provided = artifacts.filter((artifact) => artifact.provided);
  if (!provided.length) return 'absent';
  if (provided.some((artifact) => artifact.status === 'partially-accepted')) return 'partially-accepted';
  if (provided.some((artifact) => artifact.status === 'accepted')) return 'accepted';
  if (provided.some((artifact) => artifact.status === 'rejected')) return 'rejected';
  return 'unused';
}

function summarizeHostProposals(hostProposals) {
  const proposal = hostProposals[0];
  const relationCount = hostProposals.reduce((count, item) => count + (Array.isArray(item.payload?.relations) ? item.payload.relations.length : 0), 0);
  const candidateCount = hostProposals.reduce((count, item) => count + (Array.isArray(item.payload?.candidates) ? item.payload.candidates.length : 0), 0);
  return {
    provided: hostProposals.length > 0,
    file: proposal?.source?.path ?? null,
    files: hostProposals.map((item) => item.source?.path).filter(Boolean),
    proposalCount: hostProposals.length,
    relationCount,
    candidateCount,
  };
}

function buildSessionPath(projectRoot, task) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return join(projectRoot, '.resonant-code', 'context', 'runtime-sessions', 'code', `${stamp}-${digest}.json`);
}

function buildRelationProposalPath(projectRoot, task) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
      type: 'semantic-relations',
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'semantic-relations', 'code', `${stamp}-${digest}.json`);
}

function buildSemanticCandidatePath(projectRoot, task) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
      type: 'semantic-candidates',
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'semantic-candidates', 'code', `${stamp}-${digest}.json`);
}

function buildAdherenceArtifactPath(projectRoot, task) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
      type: 'adherence-evaluation',
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return join(projectRoot, '.resonant-code', 'context', 'adherence-evaluations', 'code', `${stamp}-${digest}.json`);
}

function writeSession(sessionPath, session) {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
