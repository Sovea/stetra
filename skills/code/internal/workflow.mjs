import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_AGENT_CAPABILITY_PROFILE = {
  can_read_files: true,
  can_search_files: true,
  can_run_commands: true,
  can_inspect_diff: true,
  can_request_context: true,
  max_context_files: 24,
  max_command_count: 12,
};
const GUIDANCE_MODES = new Set(['fast', 'standard', 'strict']);

export async function prepareInterpretation(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  return runtime.prepareTaskModelContract({
    task,
    artifactPath: buildTaskModelPath(paths.projectRoot, task),
  });
}

export async function autoCodeTask(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const guidanceMode = normalizeGuidanceMode(options.guidanceMode);
  const taskModelArtifact = loadTaskModelArtifact(options.taskModelFile, runtime);
  const plan = await runtime.planGuidance({
    builtinRoot: paths.builtinRoot,
    localAugmentPath: paths.localAugmentPath,
    rcclPath: paths.rcclPath,
    lockfilePath: paths.lockfilePath,
    projectRoot: paths.projectRoot,
    task,
    taskModels: taskModelArtifact.models,
    mode: guidanceMode,
    agentCapabilityProfile: DEFAULT_AGENT_CAPABILITY_PROFILE,
    providedContracts: {
      agentCapability: true,
      taskModel: taskModelArtifact.models.length > 0,
      semanticGovernanceGraph: Boolean(options.governanceGraphFile),
    },
    artifactPaths: {
      agentCapabilityProfile: buildAgentCapabilityPath(paths.projectRoot, task),
      taskModel: buildTaskModelPath(paths.projectRoot, task),
      semanticGovernanceGraph: buildGovernanceGraphPath(paths.projectRoot, task),
      contextAcquisition: buildContextAcquisitionPath(paths.projectRoot, task),
    },
  });

  if (plan.requiredContracts.length > 0) {
    return buildContractsRequiredResult({
      paths,
      plan,
      task,
      taskModelArtifact,
      contracts: plan.requiredContracts,
      guidanceMode,
    });
  }

  const semanticContracts = await prepareAutoSemanticContracts({
    runtime,
    paths,
    task,
    taskModelArtifact,
    policy: plan.policy,
    options,
  });
  if (semanticContracts.length > 0) {
    return buildContractsRequiredResult({
      paths,
      plan,
      task,
      taskModelArtifact,
      contracts: semanticContracts,
      guidanceMode,
    });
  }

  const prepared = await prepareCodeTask(options);
  if (prepared.status !== 'ok') {
    return {
      status: 'failed',
      mode: 'compile-failed',
      sessionPath: prepared.sessionPath,
      paths,
      warnings: prepared.warnings,
      error: prepared.error,
      sourceStatus: plan.sourceStatus,
      contracts: summarizeAutoContracts(taskModelArtifact, options),
    };
  }

  annotateAutoSession(prepared.sessionPath, {
    plan: {
      mode: plan.mode,
      recommendedContracts: plan.recommendedContracts,
      sourceStatus: plan.sourceStatus,
      policy: plan.policy,
      diagnostics: plan.diagnostics,
    },
    taskModel: summarizeArtifact(taskModelArtifact),
  });

  const postCompileContracts = preparePostCompileContracts(runtime, paths, task, prepared, plan.policy);
  const contextAcquisition = plan.policy.optional?.includes('context-acquisition')
    ? buildContextAcquisitionRecommendation(paths)
    : null;

  return {
    status: postCompileContracts.length ? 'post-compile-contracts-required' : 'ok',
    mode: 'compiled',
    sessionPath: prepared.sessionPath,
    paths,
    guidance: summarizeCompactGuidance(prepared.ego),
    sourceStatus: plan.sourceStatus,
    cache: prepared.cache,
    warnings: prepared.warnings,
    contracts: summarizeAutoContracts(taskModelArtifact, options),
    policy: plan.policy,
    guidanceMode,
    interpretation: summarizeAutoInterpretation(prepared),
    contextAcquisition,
    postCompileContracts,
    nextStep: postCompileContracts.length
      ? 'Fulfill prepare-adherence output with evidence, then run complete with --adherence-file.'
      : buildAutoNextStep(guidanceMode),
  };
}

export async function getCodeStatus(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const sourceStatus = runtime.resolveSourceStatus(paths);
  const gitignore = inspectResonantGitignore(paths.projectRoot);
  const plugin = inspectPluginCompleteness(paths.pluginRoot);
  const cacheVolume = inspectCacheVolume(paths.projectRoot);
  const defaultModeProbe = await buildDefaultModeProbe(runtime, paths);
  return {
    status: 'ok',
    paths,
    sourceStatus,
    lockfile: summarizeLockfile(paths.lockfilePath),
    cacheVolume,
    defaultFlow: {
      command: 'auto',
      defaultMode: 'standard',
      output: 'compact',
      trace: 'session-only',
      modes: {
        fast: 'deterministic fallback; no blocking host-agent contracts',
        standard: 'low-friction default; contracts required only for risky or ambiguous tasks',
        strict: 'full contract lifecycle',
      },
      completionContract: 'adherence-evidence is optional unless --mode strict is used',
      probe: defaultModeProbe,
    },
    diagnostics: buildStatusDiagnostics(sourceStatus, gitignore, plugin, defaultModeProbe),
    plugin,
    artifactLifecycle: {
      commit: ['.resonant-code/playbook/local-augment.yaml'],
      optionalCommit: ['.resonant-code/rccl.yaml', '.resonant-code/playbook.lock.yaml'],
      ignore: ['.resonant-code/context/'],
    },
  };
}

export async function explainCodeSession(options) {
  const sessionPath = resolve(options.sessionPath);
  const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
  return {
    status: session.status,
    sessionPath,
    taskInput: session.taskInput,
    warnings: session.warnings ?? [],
    error: session.error,
    trace: session.compileOutput?.trace ?? session.compileOutput?.packet?.governance?.trace ?? null,
    fulfillment: session.fulfillment ?? null,
    auto: session.auto ?? null,
    cache: session.compileOutput?.cache ?? null,
  };
}

export async function prepareRelations(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const taskModelArtifact = loadTaskModelArtifact(options.taskModelFile, runtime);
  const interpretationMode = taskModelArtifact.models.length ? 'host-agent' : 'deterministic-only';
  const resolvedTask = runtime.resolveTask({
    task,
    taskModels: taskModelArtifact.models,
    interpretationMode,
  });
  const compileInput = baseCompileInput(paths, { resolvedTask });
  const contractOutput = await runtime.prepareSemanticGovernanceGraphContractBundle({
    compileInput,
    artifactPath: buildGovernanceGraphPath(paths.projectRoot, task),
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
      taskModel: taskModelArtifact,
      semanticGovernanceGraph: buildAbsentArtifact('semantic-governance-graph', contractOutput.graphArtifact.suggestedPath),
    }),
    directives: contractOutput.directives,
    observations: contractOutput.observations,
    ...contractOutput,
  };
}

export async function prepareAdherenceEvaluation(options) {
  const sessionPath = resolve(options.sessionPath);
  const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
  if (session.status !== 'ok' || !session.compileOutput?.packet?.governance?.ego) {
    return {
      status: 'skipped',
      sessionPath,
      reason: 'Runtime guidance was unavailable during prepare; adherence evidence contract skipped.',
    };
  }
  const runtime = await loadRuntime(session.paths.runtimeEntry);
  const ego = session.compileOutput.packet.governance.ego;
  const directives = ego.guidance.must_follow.map((directive) => ({
    id: directive.id,
    description: directive.statement,
    prescription: directive.prescription,
    execution_mode: directive.execution_mode ?? 'enforce',
  }));
  const taskDescription = session.compileOutput.packet.task.input.description;
  const artifactPath = buildAdherenceArtifactPath(session.paths.projectRoot, session.compileOutput.packet.task.input);
  return {
    status: 'ok',
    sessionPath,
    ...runtime.prepareAdherenceEvidenceContract({
      directives,
      taskDescription,
      artifactPath,
    }),
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

  let taskModelArtifact = { ...buildAbsentArtifact('task-model'), models: [] };
  let graphArtifact = buildAbsentArtifact('semantic-governance-graph');

  try {
    taskModelArtifact = loadTaskModelArtifact(options.taskModelFile, runtime);
    const interpretationMode = taskModelArtifact.models.length ? 'host-agent' : 'deterministic-only';
    const resolvedTask = runtime.resolveTask({
      task,
      taskModels: taskModelArtifact.models,
      interpretationMode,
    });
    let preloadedSources;
    let allowedIds;
    if (options.governanceGraphFile) {
      const context = await runtime.prepareSemanticContractContext({
        compileInput: baseCompileInput(paths, { resolvedTask }),
      });
      preloadedSources = context.loadedSources;
      allowedIds = buildAllowedIds(context);
    }
    graphArtifact = loadGovernanceGraphArtifact(options.governanceGraphFile, runtime, allowedIds);
    const hostProposals = artifactProposalList(graphArtifact);
    const fulfillment = buildFulfillmentDiagnostics({
      taskModel: taskModelArtifact,
      semanticGovernanceGraph: graphArtifact,
    });
    const compileInput = baseCompileInput(paths, {
      resolvedTask,
      hostFulfillment: fulfillment,
      ...(hostProposals.length ? { hostProposals } : {}),
      ...(preloadedSources ? { preloadedSources } : {}),
    });
    const output = await runtime.compile(compileInput);
    const cacheArtifacts = persistRuntimeCache(runtime, paths, output, warnings);
    const interpretationSummary = summarizeInterpretationFlow(
      interpretationMode,
      options.taskModelFile,
      output.packet.interpretation.diagnostics,
      resolvedTask.task_models?.length ?? 0,
    );
    const suggestedTaskModelPath = buildTaskModelPath(paths.projectRoot, task);
    const session = {
      version: '1.0',
      status: 'ok',
      createdAt: new Date().toISOString(),
      paths,
      taskInput: task,
      interpretation: {
        mode: interpretationMode,
        taskModels: resolvedTask.task_models,
        provenance: output.packet.interpretation.input_provenance,
        diagnostics: output.packet.interpretation.diagnostics,
        trace: output.packet.interpretation.trace,
      },
      fulfillment,
      compileInput: {
        ...compileInput,
        ...(options.governanceGraphFile ? { governanceGraphFile: resolve(options.governanceGraphFile) } : {}),
      },
      compileOutput: output,
      cacheArtifacts,
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
      cache: output.cache,
      cacheArtifacts,
      warnings,
      interpretation: {
        mode: interpretationMode,
        taskModelFile: options.taskModelFile ? resolve(options.taskModelFile) : null,
        provenance: output.packet.interpretation.input_provenance,
        diagnostics: output.packet.interpretation.diagnostics,
        summary: interpretationSummary,
        nextStep: buildPrepareNextStep(interpretationMode, options.taskModelFile, output.packet.interpretation.diagnostics, suggestedTaskModelPath),
      },
      hostProposals: summarizeHostProposals(hostProposals),
      fulfillment,
    };
  } catch (error) {
    const message = formatError(error);
    const interpretationMode = taskModelArtifact.models.length ? 'host-agent' : 'deterministic-only';
    const suggestedTaskModelPath = buildTaskModelPath(paths.projectRoot, task);
    const taskModelContract = runtime.prepareTaskModelContract({
      task,
      artifactPath: suggestedTaskModelPath,
    });
    const failureDiagnostics = {
      clarification_recommended: !options.taskModelFile,
      ambiguity_reasons: taskModelContract.ambiguityHints,
      discarded_inputs: [],
    };
    const fulfillment = buildFulfillmentDiagnostics({
      taskModel: taskModelArtifact,
      semanticGovernanceGraph: graphArtifact,
    });
    const session = {
      version: '1.0',
      status: 'failed',
      createdAt: new Date().toISOString(),
      paths,
      taskInput: task,
      interpretation: {
        mode: interpretationMode,
        taskModels: taskModelArtifact.models,
      },
      fulfillment,
      compileInput: {
        ...baseCompileInput(paths, { task, interpretationMode }),
        ...(options.taskModelFile ? { taskModelFile: resolve(options.taskModelFile) } : {}),
        ...(options.governanceGraphFile ? { governanceGraphFile: resolve(options.governanceGraphFile) } : {}),
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
        taskModelFile: options.taskModelFile ? resolve(options.taskModelFile) : null,
        diagnostics: failureDiagnostics,
        summary: summarizeInterpretationFlow(interpretationMode, options.taskModelFile, failureDiagnostics, taskModelArtifact.models.length),
        nextStep: 'Fix the Runtime compile error and re-run prepare.',
      },
      fulfillment,
    };
  }
}

export async function completeCodeTask(options) {
  const sessionPath = resolve(options.sessionPath);
  const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
  if (session.status !== 'ok' || !session.compileOutput?.packet?.governance?.ego) {
    return {
      status: 'skipped',
      sessionPath,
      lockfilePath: session.paths?.lockfilePath ?? null,
      reason: 'Runtime guidance was unavailable during prepare; lockfile update skipped.',
    };
  }
  if (!options.adherenceFile && !options.autoUnverified) {
    return {
      status: 'skipped',
      sessionPath,
      lockfilePath: session.paths.lockfilePath,
      reason: 'complete requires --adherence-file with an ai-contract/v2 adherence-evidence payload, or --auto-unverified for summary-only completion.',
    };
  }

  try {
    const runtime = await loadRuntime(session.paths.runtimeEntry);
    const packet = session.compileOutput.packet;
    if (!options.adherenceFile && options.autoUnverified) {
      runtime.evaluateGuidance({
        ego: packet.governance.ego,
        packet,
        lockfilePath: session.paths.lockfilePath,
        hostFulfillment: session.fulfillment,
      });
      return {
        status: 'updated',
        sessionPath,
        lockfilePath: session.paths.lockfilePath,
        completion: {
          mode: 'auto-unverified',
          directiveFollowRateUpdated: false,
          reason: 'Updated governance summary only; directive follow-rate requires adherence-evidence.',
        },
      };
    }
    const adherenceArtifact = loadAdherenceArtifact(options.adherenceFile, runtime, packet);
    const fulfillment = session.fulfillment
      ? { ...session.fulfillment, adherenceEvidence: summarizeArtifact(adherenceArtifact) }
      : undefined;
    runtime.evaluateGuidance({
      ego: packet.governance.ego,
      packet,
      lockfilePath: session.paths.lockfilePath,
      hostFulfillment: fulfillment,
      adherencePayload: adherenceArtifact.verdicts,
    });
    return {
      status: 'updated',
      sessionPath,
      lockfilePath: session.paths.lockfilePath,
      adherence: {
        provided: adherenceArtifact.provided,
        status: adherenceArtifact.status,
        verdictCount: adherenceArtifact.verdicts.length,
        verdictCounts: countAdherenceVerdicts(adherenceArtifact.verdicts),
        diagnostics: adherenceArtifact.diagnostics,
      },
    };
  } catch (error) {
    return {
      status: 'skipped',
      sessionPath,
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

function normalizeGuidanceMode(value) {
  if (value === undefined) return 'standard';
  if (!GUIDANCE_MODES.has(value)) {
    throw new Error(`Invalid --mode value "${value}". Expected one of: fast, standard, strict.`);
  }
  return value;
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

function baseCompileInput(paths, extra = {}) {
  return {
    builtinRoot: paths.builtinRoot,
    localAugmentPath: paths.localAugmentPath,
    rcclPath: paths.rcclPath,
    lockfilePath: paths.lockfilePath,
    projectRoot: paths.projectRoot,
    ...extra,
  };
}

function loadTaskModelArtifact(taskModelFile, runtime) {
  if (!taskModelFile) return { ...buildAbsentArtifact('task-model'), models: [] };
  const path = resolve(taskModelFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const result = runtime.validateTaskModelPayload(payload);
  return {
    kind: 'task-model',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    models: result.models,
  };
}

async function prepareAutoSemanticContracts({ runtime, paths, task, taskModelArtifact, policy, options }) {
  const requested = policy?.required ?? [];
  if (!requested.includes('semantic-governance-graph') || options.governanceGraphFile) return [];
  if (!paths.rcclPath || taskModelArtifact.models.length === 0) return [];

  const resolvedTask = runtime.resolveTask({
    task,
    taskModels: taskModelArtifact.models,
    interpretationMode: 'host-agent',
  });
  const bundle = await runtime.prepareSemanticGovernanceGraphContractBundle({
    compileInput: baseCompileInput(paths, { resolvedTask }),
    artifactPath: buildGovernanceGraphPath(paths.projectRoot, task),
  });
  return [{
    kind: 'semantic-governance-graph',
    artifact: bundle.graphArtifact,
    contract: bundle.contract,
    context: {
      resolvedTask: bundle.resolvedTask,
      directives: bundle.directives,
      observations: bundle.observations,
    },
  }];
}

function preparePostCompileContracts(runtime, paths, task, prepared, policy) {
  if (!prepared.ego) return [];
  const requested = policy?.required?.includes('adherence-evidence');
  if (!requested) return [];
  const directives = prepared.ego.guidance.must_follow.map((directive) => ({
    id: directive.id,
    description: directive.statement,
    prescription: directive.prescription,
    execution_mode: directive.execution_mode,
  }));
  if (directives.length === 0) return [];
  const contractOutput = runtime.prepareAdherenceEvidenceContract({
    directives,
    taskDescription: task.description,
    artifactPath: buildAdherenceArtifactPath(paths.projectRoot, task),
  });
  return [{
    kind: 'adherence-evidence',
    artifact: contractOutput.evidenceArtifact,
    contract: contractOutput.contract,
  }];
}

function buildContractsRequiredResult({ paths, plan, task, taskModelArtifact, contracts, guidanceMode }) {
  return {
    status: 'contracts-required',
    mode: 'awaiting-host-artifacts',
    guidanceMode,
    paths,
    task,
    sourceStatus: plan.sourceStatus,
    contracts: contracts.map((item) => {
      const { kind, artifact, contract, ...rest } = item;
      return {
        kind,
        artifact,
        contract,
        ...rest,
      };
    }),
    fulfillment: buildFulfillmentDiagnostics({
      taskModel: taskModelArtifact,
      semanticGovernanceGraph: buildAbsentArtifact('semantic-governance-graph'),
    }),
    policy: plan.policy,
    diagnostics: plan.diagnostics,
    nextStep: 'Fulfill the listed Runtime contract artifacts with host-agent output, then re-run with the returned artifact paths.',
  };
}

function summarizeAutoInterpretation(prepared) {
  const provenance = prepared.packet?.interpretation?.input_provenance;
  const diagnostics = prepared.packet?.interpretation?.diagnostics;
  const fields = provenance?.resolved_fields ?? [];
  const averageConfidence = fields.length
    ? Number((fields.reduce((sum, field) => sum + (field.confidence ?? 0), 0) / fields.length).toFixed(2))
    : 0;
  const degradedReasons = [];
  if (provenance?.interpretation_mode === 'deterministic-only') degradedReasons.push('deterministic task interpretation used');
  if (diagnostics?.clarification_recommended) degradedReasons.push('clarification recommended by Runtime diagnostics');
  for (const warning of prepared.warnings ?? []) degradedReasons.push(warning);
  return {
    mode: provenance?.interpretation_mode ?? prepared.interpretation?.mode ?? 'unknown',
    confidence: averageConfidence,
    resolutionQuality: provenance?.resolution_quality ?? 'unknown',
    degradedReason: unique(degradedReasons),
    strictCommand: buildStrictCommand(prepared.paths.projectRoot, prepared.taskInput ?? prepared.packet?.task?.input),
  };
}

function buildStrictCommand(projectRoot, task) {
  if (!task?.description) return null;
  return `node skills/code/scripts/code.mjs auto ${JSON.stringify(projectRoot)} --mode strict --task ${JSON.stringify(task.description)}`;
}

function buildAutoNextStep(guidanceMode) {
  if (guidanceMode === 'strict') return 'Use the compact guidance for implementation, then run prepare-adherence and complete with --adherence-file.';
  return 'Use the compact guidance for implementation. Run prepare-adherence and complete when you want evidence-backed follow-rate updates; use explain --session for the full Decision Trace.';
}

function summarizeCompactGuidance(ego) {
  if (!ego) return null;
  return {
    taskIntent: ego.taskIntent,
    must_follow: ego.guidance.must_follow.map((item) => ({
      id: item.id,
      statement: item.statement,
      prescription: item.prescription,
      execution_mode: item.execution_mode,
    })),
    avoid: ego.guidance.avoid.map((item) => ({
      statement: item.statement,
      trigger: item.trigger,
    })),
    context_tensions: ego.guidance.context_tensions.map((item) => ({
      directive_id: item.directive_id,
      execution_mode: item.execution_mode,
      conflict: item.conflict,
      resolution: item.resolution,
      review_priority: item.review_priority,
    })),
    ambientCount: ego.guidance.ambient.length,
  };
}

function summarizeAutoContracts(taskModelArtifact, options) {
  return {
    agentCapability: summarizeArtifact(buildAcceptedAgentCapabilityArtifact()),
    taskModel: summarizeArtifact(taskModelArtifact),
    semanticGovernanceGraph: options.governanceGraphFile
      ? { kind: 'semantic-governance-graph', provided: true, path: resolve(options.governanceGraphFile), status: 'provided' }
      : { kind: 'semantic-governance-graph', provided: false, path: null, status: 'absent' },
  };
}

function loadGovernanceGraphArtifact(governanceGraphFile, runtime, allowedIds) {
  if (!governanceGraphFile) return buildAbsentArtifact('semantic-governance-graph');
  const path = resolve(governanceGraphFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const result = runtime.validateSemanticGovernanceGraphPayload({
    raw: payload,
    source: {
      id: 'code-skill-semantic-governance-graph',
      path,
    },
    ...allowedIds,
  });
  return {
    kind: 'semantic-governance-graph',
    provided: true,
    path,
    status: summarizeDiagnosticStatus(result.diagnostics),
    diagnostics: result.diagnostics,
    proposal: result.proposal,
  };
}

function loadAdherenceArtifact(adherenceFile, runtime, packet) {
  const path = resolve(adherenceFile);
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const allowedDirectiveIds = packet.governance.semantic_merge.directive_modes
    .filter((directive) => directive.execution_mode !== 'suppress')
    .map((directive) => directive.directive_id);
  const result = runtime.validateAdherenceEvidencePayload(payload, allowedDirectiveIds);
  return {
    kind: 'adherence-evidence',
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

function buildAcceptedAgentCapabilityArtifact() {
  return {
    kind: 'agent-capability-profile',
    provided: true,
    path: null,
    status: 'accepted',
    diagnostics: null,
  };
}

function buildFulfillmentDiagnostics({ taskModel, semanticGovernanceGraph, adherenceEvidence }) {
  const agentCapability = buildAcceptedAgentCapabilityArtifact();
  const artifacts = [
    agentCapability,
    taskModel,
    semanticGovernanceGraph,
    ...(adherenceEvidence ? [adherenceEvidence] : []),
  ];
  return {
    status: summarizeFulfillmentStatus(artifacts),
    agentCapability: summarizeArtifact(agentCapability),
    taskModel: summarizeArtifact(taskModel),
    semanticGovernanceGraph: summarizeArtifact(semanticGovernanceGraph),
    ...(adherenceEvidence ? { adherenceEvidence: summarizeArtifact(adherenceEvidence) } : {}),
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
  const edgeCount = hostProposals.reduce((count, item) => count + (Array.isArray(item.payload?.edges) ? item.payload.edges.length : 0), 0);
  return {
    provided: hostProposals.length > 0,
    file: proposal?.source?.path ?? null,
    files: hostProposals.map((item) => item.source?.path).filter(Boolean),
    proposalCount: hostProposals.length,
    edgeCount,
  };
}

function summarizeInterpretationFlow(mode, taskModelFile, diagnostics, modelCount) {
  const steps = [];
  steps.push(taskModelFile
    ? `Using task model file ${resolve(taskModelFile)} as host-agent input.`
    : 'No task model file provided; Runtime will use deterministic fallback fields marked as defaulted.');
  steps.push(`Interpretation mode: ${mode}.`);
  steps.push(`Task model count: ${modelCount}.`);
  if (diagnostics?.clarification_recommended) {
    steps.push(`Clarification recommended: ${diagnostics.ambiguity_reasons.join('; ') || 'additional ambiguity detected'}.`);
  }
  return steps;
}

function buildPrepareNextStep(mode, taskModelFile, diagnostics, recommendationPath) {
  if (taskModelFile) {
    return 'Proceed with the compiled packet and use interpretation provenance if you need to explain field-level adjudication.';
  }
  if (mode === 'deterministic-only' && diagnostics?.clarification_recommended) {
    return `Generate a host-agent task-model file at ${recommendationPath} and re-run with --task-model-file.`;
  }
  return 'Proceed with the compiled packet.';
}

function buildContextAcquisitionRecommendation(paths) {
  return {
    kind: 'context-acquisition',
    status: 'recommended',
    reason: 'RCCL is absent, so semantic governance graph coverage is limited to deterministic fallback recall.',
    nextCommand: `node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs prepare-incremental ${paths.projectRoot}`,
  };
}

function persistRuntimeCache(runtime, paths, output, warnings) {
  if (typeof runtime.persistCompileCache !== 'function') return null;
  try {
    return runtime.persistCompileCache({
      projectRoot: paths.projectRoot,
      output,
    });
  } catch (cacheError) {
    warnings.push(`Runtime cache write failed: ${formatError(cacheError)}`);
    return null;
  }
}

function countAdherenceVerdicts(verdicts) {
  const counts = { followed: 0, ignored: 0, partial: 0, unverified: 0 };
  for (const verdict of verdicts) counts[verdict.verdict] += 1;
  return counts;
}

function buildSessionPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'runtime-session', 'runtime-sessions');
}

function buildTaskModelPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'task-model', 'task-models');
}

function buildAgentCapabilityPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'agent-capability-profile', 'agent-capability-profiles');
}

function buildContextAcquisitionPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'context-acquisition', 'context-acquisition');
}

function buildGovernanceGraphPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'semantic-governance-graph', 'semantic-governance-graphs');
}

function buildAdherenceArtifactPath(projectRoot, task) {
  return buildArtifactPath(projectRoot, task, 'adherence-evidence', 'adherence-evidence');
}

function buildArtifactPath(projectRoot, task, type, directory) {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      description: task.description,
      targetFile: task.targetFile ?? '',
      changedFiles: task.changedFiles,
      techStack: task.techStack,
      operation: task.operation ?? '',
      type,
    }))
    .digest('hex')
    .slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, type === 'runtime-session' ? 17 : 14);
  return join(projectRoot, '.resonant-code', 'context', directory, 'code', `${stamp}-${digest}.json`);
}

function writeSession(sessionPath, session) {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
}

function annotateAutoSession(sessionPath, auto) {
  try {
    const absolute = resolve(sessionPath);
    const session = JSON.parse(readFileSync(absolute, 'utf-8'));
    writeSession(absolute, {
      ...session,
      auto,
    });
  } catch {
    // The compact auto result still carries plan diagnostics if session annotation fails.
  }
}

function summarizeLockfile(lockfilePath) {
  if (!existsSync(lockfilePath)) {
    return {
      status: 'absent',
      path: lockfilePath,
    };
  }
  const raw = readFileSync(lockfilePath, 'utf-8');
  const completionSourceMatch = raw.match(/completion_source:\s*"?([^"\s]+)"?/);
  const explicitSignals = (raw.match(/signal_confidence:\s*(explicit|review-confirmed|user-corrected)/g) ?? []).length;
  const implicitSignals = (raw.match(/signal_confidence:\s*implicit/g) ?? []).length;
  const unverifiedSignals = (raw.match(/unverified:\s*[1-9]/g) ?? []).length;
  return {
    status: 'present',
    path: lockfilePath,
    bytes: raw.length,
    lastCompletionSource: completionSourceMatch?.[1] ?? null,
    explicitSignals,
    implicitSignals,
    unverifiedSignals,
  };
}

function inspectResonantGitignore(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return {
      status: 'absent',
      path: gitignorePath,
      broadResonantIgnore: false,
      contextIgnored: false,
    };
  }
  const lines = readFileSync(gitignorePath, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return {
    status: 'present',
    path: gitignorePath,
    broadResonantIgnore: lines.includes('.resonant-code/') || lines.includes('.resonant-code'),
    contextIgnored: lines.includes('.resonant-code/context/') || lines.includes('.resonant-code/context'),
  };
}

function inspectPluginCompleteness(pluginRoot) {
  const required = [
    '.codex-plugin/plugin.json',
    'skills',
    'playbook',
    'runtime/dist/index.mjs',
    'rccl/dist/index.mjs',
  ];
  const requiredDirectories = ['skills', 'playbook', 'runtime/dist', 'rccl/dist'];
  const missing = required.filter((entry) => !existsSync(join(pluginRoot, entry)));
  const emptyDirectories = requiredDirectories
    .filter((entry) => existsSync(join(pluginRoot, entry)) && readdirSync(join(pluginRoot, entry)).length === 0);
  return {
    status: missing.length || emptyDirectories.length ? 'incomplete' : 'ok',
    root: pluginRoot,
    missing,
    emptyDirectories,
  };
}

function inspectCacheVolume(projectRoot) {
  const cacheRoot = join(projectRoot, '.resonant-code', 'context', 'cache');
  if (!existsSync(cacheRoot)) {
    return {
      path: cacheRoot,
      exists: false,
      files: 0,
      bytes: 0,
    };
  }
  return {
    path: cacheRoot,
    exists: true,
    ...measureDirectory(cacheRoot),
  };
}

function measureDirectory(directory) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = measureDirectory(entryPath);
      files += child.files;
      bytes += child.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(entryPath).size;
    }
  }
  return { files, bytes };
}

async function buildDefaultModeProbe(runtime, paths) {
  const task = {
    description: 'Update one implementation detail',
    operation: 'modify',
    targetFile: selectProbeTarget(paths.projectRoot),
    changedFiles: [],
    techStack: [],
    riskLevel: 'low',
    scopeSize: 'single-file',
  };
  try {
    const plan = await runtime.planGuidance({
      builtinRoot: paths.builtinRoot,
      localAugmentPath: paths.localAugmentPath,
      rcclPath: paths.rcclPath,
      lockfilePath: paths.lockfilePath,
      projectRoot: paths.projectRoot,
      task,
      mode: 'standard',
      agentCapabilityProfile: DEFAULT_AGENT_CAPABILITY_PROFILE,
      providedContracts: {
        agentCapability: true,
      },
      artifactPaths: {
        agentCapabilityProfile: buildAgentCapabilityPath(paths.projectRoot, task),
        taskModel: buildTaskModelPath(paths.projectRoot, task),
        semanticGovernanceGraph: buildGovernanceGraphPath(paths.projectRoot, task),
        contextAcquisition: buildContextAcquisitionPath(paths.projectRoot, task),
      },
    });
    return {
      status: 'ok',
      mode: 'standard',
      taskShape: 'low-risk-single-file',
      targetFile: task.targetFile ?? null,
      wouldBlock: plan.requiredContracts.length > 0,
      requiredContracts: plan.requiredContracts.map((contract) => contract.kind),
      policy: {
        required: plan.policy.required,
        optional: plan.policy.optional,
        escalation: plan.policy.escalation,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      mode: 'standard',
      taskShape: 'low-risk-single-file',
      targetFile: task.targetFile ?? null,
      error: formatError(error),
    };
  }
}

function selectProbeTarget(projectRoot) {
  const candidates = ['package.json', 'README.md', 'src/index.ts', 'index.ts'];
  return candidates.find((candidate) => existsSync(join(projectRoot, candidate))) ?? undefined;
}

function buildStatusDiagnostics(sourceStatus, gitignore, plugin, defaultModeProbe) {
  const items = [];
  if (sourceStatus.localAugment === 'absent') {
    items.push({
      severity: 'warning',
      code: 'local-augment-absent',
      message: 'Local augment is absent; Runtime will use built-in playbook layers only.',
    });
  }
  if (sourceStatus.rccl === 'absent') {
    items.push({
      severity: 'info',
      code: 'rccl-absent',
      message: 'RCCL is absent; repository observations will not influence task-time guidance.',
    });
  }
  if (gitignore.broadResonantIgnore) {
    items.push({
      severity: 'warning',
      code: 'broad-resonant-ignore',
      message: '.gitignore ignores all of .resonant-code; durable artifacts such as local-augment.yaml cannot be committed.',
    });
  }
  if (!gitignore.contextIgnored) {
    items.push({
      severity: 'info',
      code: 'context-not-ignored',
      message: '.resonant-code/context/ is generated runtime state and should normally be ignored.',
    });
  }
  if (plugin.status !== 'ok') {
    items.push({
      severity: 'warning',
      code: 'plugin-incomplete',
      message: `Plugin root is missing or has empty required runtime files: ${[...plugin.missing, ...plugin.emptyDirectories].join(', ')}`,
    });
  }
  if (defaultModeProbe.status === 'ok' && defaultModeProbe.wouldBlock) {
    items.push({
      severity: 'warning',
      code: 'standard-default-blocks',
      message: `A low-risk single-file standard-mode probe would block on: ${defaultModeProbe.requiredContracts.join(', ')}`,
    });
  }
  if (defaultModeProbe.status === 'error') {
    items.push({
      severity: 'warning',
      code: 'standard-probe-failed',
      message: `Standard-mode probe failed: ${defaultModeProbe.error}`,
    });
  }
  return {
    gitignore,
    items,
  };
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
