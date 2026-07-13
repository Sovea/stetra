import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUIDANCE_MODES = new Set(['fast', 'standard', 'strict']);
const VERIFICATION_POLICIES = new Set(['task-relevant', 'deep', 'trust-existing']);
const AGENT_LOOP_MAX_ATTEMPTS = 3;

export async function prepareInterpretation(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const plan = await runtime.planGuidance(buildPlanInput(paths, task, options, 'strict'));
  return plan.requiredContracts.find((item) => item.kind === 'task-model')
    ?? { status: 'skipped', reason: 'Runtime did not request a task-model contract.' };
}

export async function autoCodeTask(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const guidanceMode = normalizeGuidanceMode(options.guidanceMode);
  const verificationPolicy = normalizeVerificationPolicy(options.verificationPolicy);
  const taskModelArtifact = loadRawArtifact(options.taskModelFile, 'task-model');
  const plan = await runtime.planGuidance(buildPlanInput(paths, task, options, guidanceMode));

  if (plan.requiredContracts.length > 0) {
    return buildContractsRequiredResult({
      paths,
      plan,
      task,
      taskModelArtifact,
      contracts: plan.requiredContracts,
      guidanceMode,
      verificationPolicy,
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

  const postCompileContracts = (prepared.postCompileContractRequests ?? []).map((contract) => ({
    ...contract,
    required: plan.policy?.required?.includes(contract.kind) ?? false,
  }));
  const postCompileRequired = postCompileContracts.some((contract) => contract.required);
  const contextAcquisition = plan.policy.optional?.includes('context-acquisition')
    ? buildContextAcquisitionRecommendation(paths, task)
    : null;
  const agentLoop = buildAgentLoopPlan({
    phase: postCompileContracts.length ? 'post-compile' : 'ready',
    paths,
    task,
    guidanceMode,
    contracts: postCompileContracts,
    taskModelFile: taskModelArtifact.path,
    governanceGraphFile: options.governanceGraphFile,
    sessionPath: prepared.sessionPath,
    contextAcquisition,
    verificationPolicy,
  });

  return {
    status: postCompileRequired ? 'post-compile-contracts-required' : 'ok',
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
    agentLoop,
    nextStep: postCompileRequired
      ? 'Fulfill prepare-adherence output with evidence, then run complete with --adherence-file.'
      : buildAutoNextStep(guidanceMode),
  };
}

export async function getCodeStatus(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const gitignore = inspectResonantGitignore(paths.projectRoot);
  const plugin = inspectPluginCompleteness(paths.pluginRoot);
  const cacheVolume = inspectCacheVolume(paths.projectRoot);
  let defaultModeProbe;
  if (!existsSync(paths.runtimeEntry)) {
    defaultModeProbe = {
      status: 'error',
      mode: 'standard',
      taskShape: 'low-risk-single-file',
      targetFile: null,
      error: `Runtime dist entry is missing: ${paths.runtimeEntry}`,
    };
  } else {
    try {
      defaultModeProbe = await buildDefaultModeProbe(await loadRuntime(paths.runtimeEntry), paths);
    } catch (error) {
      defaultModeProbe = {
        status: 'error',
        mode: 'standard',
        taskShape: 'low-risk-single-file',
        targetFile: null,
        error: `Runtime dist entry is not loadable: ${formatError(error)}`,
      };
    }
  }
  const sourceStatus = defaultModeProbe.sourceStatus ?? inspectSourceStatus(paths);
  const diagnostics = buildStatusDiagnostics(sourceStatus, gitignore, plugin, defaultModeProbe, paths);
  return {
    status: 'ok',
    paths,
    sourceStatus,
    lockfile: summarizeLockfile(paths.lockfilePath),
    cacheVolume,
    cacheRead: {
      status: 'inspection-only',
      trustBoundary: 'cache-read-only',
      packetUsableForExecution: false,
    },
    readiness: buildReadinessSummary(diagnostics.items),
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
    diagnostics,
    plugin,
    artifactLifecycle: {
      commit: [
        '.resonant-code/playbook/local-augment.yaml',
        '.resonant-code/rccl.yaml',
        '.resonant-code/playbook.lock.yaml',
      ],
      optionalCommit: [],
      localOnly: [],
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
    contractReports: session.contractReports ?? [],
    cacheInspection: session.cacheInspection ?? null,
    auto: session.auto ?? null,
    cache: session.compileOutput?.cache ?? null,
  };
}

export async function prepareRelations(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const plan = await runtime.planGuidance(buildPlanInput(paths, task, options, 'strict'));
  const contract = plan.requiredContracts.find((item) => item.kind === 'semantic-governance-graph');
  return contract
    ? { status: 'ok', task: { input: task, resolved: plan.resolvedTask }, ...contract }
    : { status: 'skipped', task: { input: task, resolved: plan.resolvedTask }, reason: 'Runtime did not request a semantic-governance-graph contract.' };
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
  const contract = session.compileOutput.postCompileContractRequests?.find((item) => item.kind === 'adherence-evidence');
  return {
    status: contract ? 'ok' : 'skipped',
    sessionPath,
    evidenceContext: buildAdherenceEvidenceAvailability(session, sessionPath),
    ...(contract ?? { reason: 'Compile output did not request adherence evidence.' }),
  };
}

export async function prepareGovernanceEvolution(options) {
  return {
    status: 'unsupported',
    mode: 'review-only',
    authoritativeWrite: false,
    reason: 'Governance evolution proposals are intentionally outside the 0.0.1 foundation lifecycle.',
  };
}

export async function reportContextAcquisition(options) {
  return { status: 'unsupported', mode: 'report-only', kind: 'context-acquisition', authoritativeWrite: false, reason: 'Use calibrate-repo-context prepareCalibration/commitCalibration in 0.0.1.' };
}

export async function reportGovernanceEvolution(options) {
  return { status: 'unsupported', mode: 'review-only', kind: 'governance-evolution-proposal', authoritativeWrite: false, reason: 'Governance evolution remains review-only and is not a 0.0.1 lifecycle entrypoint.' };
}

function withOptionalContractReportSession(report, sessionPath) {
  if (!sessionPath) {
    return {
      ...report,
      sessionUpdate: {
        requested: false,
        updated: false,
      },
    };
  }
  const absoluteSessionPath = resolve(sessionPath);
  const session = JSON.parse(readFileSync(absoluteSessionPath, 'utf-8'));
  const entry = buildContractReportSessionEntry(report);
  writeSession(absoluteSessionPath, {
    ...session,
    contractReports: [
      ...(Array.isArray(session.contractReports) ? session.contractReports : []),
      entry,
    ],
  });
  return {
    ...report,
    sessionUpdate: {
      requested: true,
      updated: true,
      sessionPath: absoluteSessionPath,
      recordedEntry: entry,
    },
  };
}

function buildContractReportSessionEntry(report) {
  return {
    kind: report.kind,
    mode: report.mode,
    recordedAt: new Date().toISOString(),
    artifact: report.artifact,
    authoritativeWrite: false,
    diagnostics: report.diagnostics,
    summary: summarizeContractReportForSession(report),
  };
}

function summarizeContractReportForSession(report) {
  if (report.kind === 'context-acquisition') {
    return {
      acceptedRequests: report.acceptedRequests?.length ?? 0,
      diagnosticSummary: report.diagnostics?.summary ?? null,
      workflows: (report.acceptedRequests ?? []).map((item) => ({
        index: item.index,
        mode: item.request.mode,
        targetFileCount: item.request.target_files?.length ?? 0,
        changedFileCount: item.request.changed_files?.length ?? 0,
        commitMode: item.lifecycle.commitMode,
      })),
    };
  }
  if (report.kind === 'governance-evolution-proposal') {
    return {
      acceptedProposals: report.proposalSummary?.accepted ?? 0,
      byKind: report.proposalSummary?.byKind ?? {},
      proposalGroups: report.proposalGroups ?? {},
      diagnosticSummary: report.diagnostics?.summary ?? null,
    };
  }
  return {
    diagnosticSummary: report.diagnostics?.summary ?? null,
  };
}

function groupGovernanceEvolutionProposals(proposals, diagnostics) {
  const playbookKinds = new Set(['local-override', 'local-suppress', 'local-addition']);
  const playbookCandidates = proposals.filter((proposal) => playbookKinds.has(proposal.kind));
  const rcclCandidates = proposals.filter((proposal) => proposal.kind === 'rccl-refresh');
  return {
    playbookCandidate: {
      count: playbookCandidates.length,
      targetIds: playbookCandidates.map((proposal) => proposal.target_id).filter(Boolean),
      reviewOnly: true,
      authoritativeWrite: false,
    },
    rcclCandidate: {
      count: rcclCandidates.length,
      targetIds: rcclCandidates.map((proposal) => proposal.target_id).filter(Boolean),
      reviewOnly: true,
      authoritativeWrite: false,
    },
    noAction: {
      recommended: proposals.length === 0,
      reason: proposals.length === 0
        ? 'No accepted governance evolution proposal was produced.'
        : 'Accepted proposals require human review; Runtime will not write authoritative governance state.',
      rejectedOrDowngraded: (diagnostics?.summary?.rejected ?? 0) + (diagnostics?.summary?.downgraded ?? 0),
    },
  };
}

export async function prepareCodeTask(options) {
  const paths = resolveRuntimePaths(options.projectRoot, options.pluginRoot);
  const runtime = await loadRuntime(paths.runtimeEntry);
  const task = normalizeTaskInput(options, paths.projectRoot, runtime);
  const verificationPolicy = normalizeVerificationPolicy(options.verificationPolicy);
  const sessionPath = buildSessionPath(paths.projectRoot, task);
  const warnings = [];

  if (!paths.localAugmentPath) warnings.push('Local augment not found; using built-in playbook layers only.');
  if (!paths.rcclPath) warnings.push('RCCL not found; proceeding without repository calibration signals.');

  let taskModelArtifact = buildAbsentArtifact('task-model');
  let graphArtifact = buildAbsentArtifact('semantic-governance-graph');

  try {
    taskModelArtifact = loadRawArtifact(options.taskModelFile, 'task-model');
    graphArtifact = loadRawArtifact(options.governanceGraphFile, 'semantic-governance-graph');
    const compileInput = baseCompileInput(paths, {
      task,
      verificationPolicy,
      artifacts: buildRuntimeArtifacts(taskModelArtifact, graphArtifact),
    });
    const output = await runtime.compile(compileInput);
    if (output.packet.status === 'needs-attention') {
      throw new Error(output.trace.ego_budget?.exceeded
        ? 'EGO_BUDGET_EXCEEDED: Runtime stopped the code workflow because hard guidance exceeded the deterministic budget.'
        : 'Runtime rejected or downgraded a required host artifact; inspect contractDiagnostics.');
    }
    const interpretationMode = output.packet.interpretation.input_provenance.interpretation_mode;
    const interpretationSummary = summarizeInterpretationFlow(
      interpretationMode,
      options.taskModelFile,
      output.packet.interpretation.diagnostics,
      output.resolvedTask.task_models?.length ?? 0,
    );
    const suggestedTaskModelPath = buildTaskModelPath(paths.projectRoot, task);
    const fulfillment = output.trace.host_fulfillment ?? null;
    const session = {
      version: '1.0',
      status: 'ok',
      createdAt: new Date().toISOString(),
      paths,
      taskInput: task,
      interpretation: {
        mode: interpretationMode,
        taskModels: output.resolvedTask.task_models,
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
      warnings,
      interpretation: {
        mode: interpretationMode,
        taskModelFile: options.taskModelFile ? resolve(options.taskModelFile) : null,
        provenance: output.packet.interpretation.input_provenance,
        diagnostics: output.packet.interpretation.diagnostics,
        summary: interpretationSummary,
        nextStep: buildPrepareNextStep(interpretationMode, options.taskModelFile, output.packet.interpretation.diagnostics, suggestedTaskModelPath),
      },
      postCompileContractRequests: output.postCompileContractRequests,
      contractDiagnostics: output.contractDiagnostics,
      fulfillment,
    };
  } catch (error) {
    const message = formatError(error);
    const interpretationMode = options.taskModelFile ? 'host-agent' : 'deterministic-only';
    const suggestedTaskModelPath = buildTaskModelPath(paths.projectRoot, task);
    const failurePlan = await runtime.planGuidance(buildPlanInput(paths, task, options, 'strict'));
    const failureDiagnostics = {
      clarification_recommended: !options.taskModelFile,
      ambiguity_reasons: failurePlan.resolvedTask.diagnostics.ambiguity_reasons,
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
        taskModels: [],
      },
      fulfillment,
      compileInput: {
        ...baseCompileInput(paths, { task, interpretationMode, verificationPolicy }),
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
        summary: summarizeInterpretationFlow(interpretationMode, options.taskModelFile, failureDiagnostics, 0),
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
      reason: 'complete requires --adherence-file with a v1 adherence-evidence envelope, or --auto-unverified.',
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
    const adherenceArtifact = loadRawArtifact(options.adherenceFile, 'adherence-evidence');
    const evaluation = runtime.evaluateGuidance({
      ego: packet.governance.ego,
      packet,
      lockfilePath: session.paths.lockfilePath,
      artifacts: { adherenceEvidence: { raw: adherenceArtifact.raw, path: adherenceArtifact.path } },
      evidenceContext: buildAdherenceEvidenceContext(session, sessionPath),
    });
    return {
      status: 'updated',
      sessionPath,
      lockfilePath: session.paths.lockfilePath,
      adherence: {
        provided: adherenceArtifact.provided,
        status: evaluation.status,
        verdictCounts: evaluation.verdictCounts,
        diagnostics: evaluation.contractDiagnostics,
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

function normalizeVerificationPolicy(value) {
  if (value === undefined) return 'task-relevant';
  if (!VERIFICATION_POLICIES.has(value)) {
    throw new Error(`Invalid --verification-policy value "${value}". Expected one of: task-relevant, deep, trust-existing.`);
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

function buildPlanInput(paths, task, options, mode) {
  return baseCompileInput(paths, {
    task,
    mode,
    verificationPolicy: normalizeVerificationPolicy(options.verificationPolicy),
    artifacts: buildRuntimeArtifacts(
      loadRawArtifact(options.taskModelFile, 'task-model'),
      loadRawArtifact(options.governanceGraphFile, 'semantic-governance-graph'),
    ),
    artifactPaths: {
      agentCapabilityProfile: buildAgentCapabilityPath(paths.projectRoot, task),
      taskModel: buildTaskModelPath(paths.projectRoot, task),
      semanticGovernanceGraph: buildGovernanceGraphPath(paths.projectRoot, task),
      contextAcquisition: buildContextAcquisitionPath(paths.projectRoot, task),
    },
  });
}

function loadRawArtifact(file, kind) {
  if (!file) return buildAbsentArtifact(kind);
  const path = resolve(file);
  return {
    kind,
    provided: true,
    path,
    raw: JSON.parse(readFileSync(path, 'utf-8')),
    status: 'submitted-for-runtime-validation',
  };
}

function buildRuntimeArtifacts(taskModel, semanticGovernanceGraph) {
  return {
    ...(taskModel?.provided ? { taskModel: { raw: taskModel.raw, path: taskModel.path } } : {}),
    ...(semanticGovernanceGraph?.provided
      ? { semanticGovernanceGraph: { raw: semanticGovernanceGraph.raw, path: semanticGovernanceGraph.path } }
      : {}),
  };
}

function inspectSourceStatus(paths) {
  return {
    localAugment: paths.localAugmentPath ? 'present' : 'absent',
    rccl: paths.rcclPath ? 'unverified' : 'absent',
    lockfile: existsSync(paths.lockfilePath) ? 'present' : 'absent',
    cache: 'miss',
  };
}

function buildContractsRequiredResult({ paths, plan, task, taskModelArtifact, contracts, guidanceMode, verificationPolicy }) {
  const agentLoop = buildAgentLoopPlan({
    phase: 'pre-compile',
    paths,
    task,
    guidanceMode,
    verificationPolicy,
    contracts,
    taskModelFile: taskModelArtifact.path,
  });
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
    agentLoop,
    nextStep: 'Fulfill the listed Runtime contract artifacts with host-agent output, then re-run with the returned artifact paths.',
  };
}

function buildAgentLoopPlan({
  phase,
  paths,
  task,
  guidanceMode,
  verificationPolicy,
  contracts,
  taskModelFile,
  governanceGraphFile,
  sessionPath,
  contextAcquisition,
}) {
  const inferredContextAcquisition = contextAcquisition
    ?? (contracts.some((item) => item.kind === 'context-acquisition') ? buildContextAcquisitionRecommendation(paths, task) : null);
  return {
    phase,
    pendingContracts: contracts.map((item) => {
      const artifactPath = item.artifact?.suggestedPath ?? item.contract?.artifact?.suggestedPath ?? null;
      return {
        kind: item.kind,
        required: item.required ?? phase !== 'ready',
        artifactPath,
        artifactFormat: item.artifact?.format ?? item.contract?.artifact?.format ?? 'json',
        resumeCommand: buildAgentLoopResumeCommand({
          kind: item.kind,
          artifactPath,
          paths,
          task,
          guidanceMode,
          verificationPolicy,
          taskModelFile,
          governanceGraphFile,
          sessionPath,
        }),
        ...(item.kind === 'context-acquisition' && inferredContextAcquisition
          ? { lifecycle: inferredContextAcquisition.lifecycle }
          : {}),
      };
    }),
    ...(inferredContextAcquisition ? { contextAcquisition: inferredContextAcquisition } : {}),
    maxAttempts: AGENT_LOOP_MAX_ATTEMPTS,
    repairPolicy: {
      source: 'runtime-diagnostics-only',
      rule: 'Repair artifacts only from Runtime/RCCL diagnostics; stop after three consecutive same-contract failures with the same reason.',
    },
    stopReasons: [
      'missing-required-context',
      'persistent-validation-failure',
      'user-task-scope-conflict',
      'unrecoverable-command-failure',
    ],
  };
}

function buildAgentLoopResumeCommand({
  kind,
  artifactPath,
  paths,
  task,
  guidanceMode,
  verificationPolicy,
  taskModelFile,
  governanceGraphFile,
  sessionPath,
}) {
  if (kind === 'adherence-evidence' && sessionPath && artifactPath) {
    return `node skills/code/scripts/code.mjs complete --session ${shellArg(sessionPath)} --adherence-file ${shellArg(artifactPath)}`;
  }
  if (kind === 'context-acquisition') {
    return buildContextAcquisitionCommand(paths.projectRoot, task);
  }
  const args = [
    'node',
    'skills/code/scripts/code.mjs',
    'auto',
    shellArg(paths.projectRoot),
    '--mode',
    shellArg(guidanceMode),
    '--verification-policy',
    shellArg(verificationPolicy ?? 'task-relevant'),
    '--task',
    shellArg(task.description),
    ...taskFlagArgs(task),
  ];
  const taskModel = kind === 'task-model' ? artifactPath : taskModelFile;
  const graph = kind === 'semantic-governance-graph' ? artifactPath : governanceGraphFile;
  if (taskModel) args.push('--task-model-file', shellArg(taskModel));
  if (graph) args.push('--governance-graph-file', shellArg(graph));
  return args.join(' ');
}

function buildContextAcquisitionCommand(projectRoot, task) {
  const args = [
    'node',
    'skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs',
    'prepare-incremental',
    shellArg(projectRoot),
  ];
  if (task.targetFile) args.push('--target-file', shellArg(task.targetFile));
  for (const file of task.changedFiles ?? []) args.push('--changed-file', shellArg(file));
  args.push('--mode', shellArg(task.changedFiles?.length ? 'changed-files' : 'task-scoped'));
  return args.join(' ');
}

function taskFlagArgs(task) {
  const args = [];
  if (task.targetFile) args.push('--target-file', shellArg(task.targetFile));
  for (const file of task.changedFiles ?? []) args.push('--changed-file', shellArg(file));
  for (const tech of task.techStack ?? []) args.push('--tech', shellArg(tech));
  for (const tag of task.tags ?? []) args.push('--tag', shellArg(tag));
  const scalarFlags = [
    ['operation', 'operation'],
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
  for (const [field, flag] of scalarFlags) {
    if (task[field]) args.push(`--${flag}`, shellArg(task[field]));
  }
  for (const value of task.hardConstraints ?? []) args.push('--hard-constraint', shellArg(value));
  for (const value of task.allowedTradeoffs ?? []) args.push('--allowed-tradeoff', shellArg(value));
  for (const value of task.avoid ?? []) args.push('--avoid', shellArg(value));
  return args;
}

function shellArg(value) {
  return JSON.stringify(String(value));
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
    agentCapability: summarizeArtifact(buildAssumedAgentCapabilityArtifact()),
    taskModel: summarizeArtifact(taskModelArtifact),
    semanticGovernanceGraph: options.governanceGraphFile
      ? { kind: 'semantic-governance-graph', provided: true, path: resolve(options.governanceGraphFile), status: 'provided-unvalidated' }
      : { kind: 'semantic-governance-graph', provided: false, path: null, status: 'absent' },
  };
}

function buildAdherenceEvidenceContext(session, sessionPath) {
  const projectRoot = session.paths?.projectRoot;
  const observations = [
    ...(session.compileInput?.preloadedSources?.rccl?.observations ?? []),
    ...buildRcclEvidenceObservationsFromPacket(session.compileOutput?.packet),
  ];
  return {
    ...(projectRoot ? { projectRoot } : {}),
    ...(observations.length ? { observations } : {}),
    runtimeTraceRefs: [
      sessionPath,
      resolve(sessionPath),
      session.compileOutput?.trace?.trace_id,
      session.compileOutput?.packet?.governance?.trace?.trace_id,
    ].filter(Boolean),
  };
}

function buildAdherenceEvidenceAvailability(session, sessionPath) {
  const evidenceContext = buildAdherenceEvidenceContext(session, sessionPath);
  const packet = session.compileOutput?.packet;
  const taskInput = packet?.task?.input ?? session.taskInput ?? {};
  const runtimeTraceRefs = evidenceContext.runtimeTraceRefs ?? [];
  const changedFiles = taskInput.changedFiles ?? [];
  const targetFile = taskInput.targetFile ?? null;
  const implementationFiles = unique([
    ...(targetFile ? [targetFile] : []),
    ...changedFiles,
  ]);
  const rcclEvidenceRefs = unique((evidenceContext.observations ?? [])
    .flatMap((observation) => observation.evidence.map((evidence) => `${observation.id}:${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`)));
  return {
    sessionPath,
    runtimeTraceRefs,
    changedFiles,
    targetFile,
    rcclEvidenceRefs,
    evidenceCandidates: {
      file: implementationFiles.map((file) => ({
        file,
        refTemplate: `${file}:<start-line>-<end-line>`,
        supportsFollowRate: true,
        requirement: 'Use exact current line ranges that show the implemented behavior.',
      })),
      runtimeTrace: runtimeTraceRefs.map((ref) => ({
        ref,
        supportsFollowRate: false,
        requirement: 'Runtime trace evidence can prove workflow provenance, but not implementation adherence by itself.',
      })),
      rccl: rcclEvidenceRefs.map((ref) => ({
        ref,
        supportsFollowRate: true,
        requirement: 'RCCL evidence must resolve to a concrete verified observation file range.',
      })),
    },
    unavailable: {
      diffSnapshotHashes: {
        status: 'unavailable',
        reason: 'not captured by current code workflow',
        effect: 'diff-hash evidence will be downgraded unless a future workflow records it',
      },
      commandOutputHashes: {
        status: 'unavailable',
        reason: 'not captured by current code workflow',
        effect: 'command-hash evidence will be downgraded unless a future workflow records it',
      },
    },
  };
}

function buildRcclEvidenceObservationsFromPacket(packet) {
  const byObservation = new Map();
  for (const relation of packet?.governance?.semantic_merge?.relations ?? []) {
    if (!relation.observation_id) continue;
    const current = byObservation.get(relation.observation_id) ?? [];
    for (const ref of relation.evidence_refs ?? []) {
      const parsed = parseEvidenceLocation(ref, relation.observation_id);
      if (parsed) current.push({ ...parsed, snippet: '' });
    }
    if (current.length) byObservation.set(relation.observation_id, current);
  }
  return [...byObservation.entries()].map(([id, evidence]) => ({
    id,
    evidence: uniqueEvidence(evidence),
    verification: packetObservationVerification(packet, id),
  }));
}

function packetObservationVerification(packet, observationId) {
  const state = (packet?.governance?.semantic_merge?.observation_states ?? [])
    .find((item) => item.observation_id === observationId);
  return {
    evidence_status: null,
    disposition: state?.disposition ?? null,
  };
}

function parseEvidenceLocation(ref, observationId) {
  const raw = String(ref);
  const normalized = observationId && raw.startsWith(`${observationId}:`) ? raw.slice(observationId.length + 1) : raw;
  const match = /^(.*):(\d+)-(\d+)$/.exec(normalized);
  if (!match) return null;
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  return {
    file: match[1],
    line_range: [start, end],
  };
}

function uniqueEvidence(evidence) {
  const seen = new Set();
  const result = [];
  for (const item of evidence) {
    const key = `${item.file}:${item.line_range[0]}-${item.line_range[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
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

function buildAssumedAgentCapabilityArtifact() {
  return {
    kind: 'agent-capability-profile',
    provided: false,
    path: null,
    status: 'assumed',
    diagnostics: null,
  };
}

function buildFulfillmentDiagnostics({ taskModel, semanticGovernanceGraph, adherenceEvidence }) {
  const agentCapability = buildAssumedAgentCapabilityArtifact();
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

function summarizeFulfillmentStatus(artifacts) {
  const provided = artifacts.filter((artifact) => artifact.provided);
  if (provided.some((artifact) => artifact.status === 'rejected')) {
    return 'rejected';
  }
  if (provided.some((artifact) => artifact.status === 'partially-accepted')) return 'partially-accepted';
  if (provided.some((artifact) => artifact.status === 'accepted')) return 'accepted';
  if (!provided.length && artifacts.some((artifact) => artifact.status === 'assumed')) return 'assumed';
  if (!provided.length) return 'absent';
  return 'unused';
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

function buildContextAcquisitionRecommendation(paths, task = {}) {
  const lifecycle = buildContextAcquisitionLifecycle(paths, {
    mode: task.changedFiles?.length ? 'changed-files' : 'task-scoped',
    target_files: task.targetFile ? [task.targetFile] : [],
    changed_files: task.changedFiles ?? [],
  });
  return {
    kind: 'context-acquisition',
    status: 'recommended',
    reason: 'RCCL is absent, so semantic governance graph coverage is limited to deterministic fallback recall.',
    nextCommand: lifecycle.prepareCommand,
    lifecycle,
  };
}

function buildContextAcquisitionLifecycle(paths, request = {}) {
  const prepareCommand = buildContextAcquisitionCommandFromRequest(paths.projectRoot, request);
  const commitMode = paths.rcclPath ? 'commit-refresh' : 'commit';
  return {
    prepareCommand,
    commitMode,
    commitCommandTemplate: `node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs ${commitMode} ${shellArg(paths.projectRoot)} --input <artifact-yaml>`,
    commitCommandReason: paths.rcclPath
      ? 'Existing RCCL is present; commit the accepted refresh proposal through commit-refresh.'
      : 'No RCCL is present; commit accepted candidate observations through commit.',
    resumeAfterCommit: 'Re-run code auto with the same task once RCCL commit or commit-refresh succeeds.',
  };
}

function buildContextAcquisitionCommandFromRequest(projectRoot, request = {}) {
  const args = [
    'node',
    'skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs',
    'prepare-incremental',
    shellArg(projectRoot),
  ];
  for (const file of request.target_files ?? []) args.push('--target-file', shellArg(file));
  for (const file of request.changed_files ?? []) args.push('--changed-file', shellArg(file));
  if (request.scope) args.push('--scope', shellArg(request.scope));
  args.push('--mode', shellArg(request.mode ?? ((request.changed_files ?? []).length ? 'changed-files' : 'task-scoped')));
  return args.join(' ');
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
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
  applyContextRetention(session.paths?.projectRoot, sessionPath);
}

function applyContextRetention(projectRoot, currentSessionPath) {
  if (!projectRoot) return;
  const contextRoot = resolve(projectRoot, '.resonant-code', 'context');
  if (!existsSync(contextRoot)) return;
  const now = Date.now();
  const maxAge = 90 * 24 * 60 * 60 * 1000;
  for (const directory of ['runtime-sessions', 'task-models', 'semantic-governance-graphs', 'adherence-evidence', 'context-acquisition']) {
    const root = join(contextRoot, directory);
    const files = listFiles(root).filter((file) => resolve(file) !== resolve(currentSessionPath));
    const retained = files.filter((file) => {
      if (now - statSync(file).mtimeMs <= maxAge) return true;
      safeRemoveContextFile(file, contextRoot);
      return false;
    }).sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    for (const file of retained.slice(100)) safeRemoveContextFile(file, contextRoot);
  }

  const cacheRoot = join(contextRoot, 'cache');
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000;
  let cacheFiles = listFiles(cacheRoot).filter((file) => {
    if (now - statSync(file).mtimeMs <= cacheMaxAge) return true;
    safeRemoveContextFile(file, contextRoot);
    return false;
  }).sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  let bytes = cacheFiles.reduce((total, file) => total + statSync(file).size, 0);
  while (bytes > 64 * 1024 * 1024 && cacheFiles.length) {
    const file = cacheFiles.pop();
    bytes -= statSync(file).size;
    safeRemoveContextFile(file, contextRoot);
  }
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function safeRemoveContextFile(file, contextRoot) {
  const absolute = resolve(file);
  const root = `${resolve(contextRoot)}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!absolute.startsWith(root)) throw new Error(`Retention refused to remove a file outside context root: ${absolute}`);
  rmSync(absolute, { force: true });
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
    const lifecycleInput = {
      builtinRoot: paths.builtinRoot,
      localAugmentPath: paths.localAugmentPath,
      rcclPath: paths.rcclPath,
      lockfilePath: paths.lockfilePath,
      projectRoot: paths.projectRoot,
      task,
      verificationPolicy: 'deep',
    };
    const plan = await runtime.planGuidance({
      ...lifecycleInput,
      mode: 'standard',
      providedContracts: {
        agentCapability: false,
      },
      artifactPaths: {
        agentCapabilityProfile: buildAgentCapabilityPath(paths.projectRoot, task),
        taskModel: buildTaskModelPath(paths.projectRoot, task),
        semanticGovernanceGraph: buildGovernanceGraphPath(paths.projectRoot, task),
        contextAcquisition: buildContextAcquisitionPath(paths.projectRoot, task),
      },
    });
    const compiled = plan.requiredContracts.length === 0
      ? await runtime.compile(lifecycleInput)
      : null;
    const sourceStatus = compiled
      ? { ...plan.sourceStatus, rccl: resolveProbeRcclStatus(paths, compiled) }
      : plan.sourceStatus;
    return {
      status: 'ok',
      mode: 'standard',
      taskShape: 'low-risk-single-file',
      targetFile: task.targetFile ?? null,
      sourceStatus,
      compileStatus: compiled?.packet?.status ?? 'not-run',
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

function resolveProbeRcclStatus(paths, compiled) {
  if (!paths.rcclPath) return 'absent';
  const states = compiled.packet?.governance?.semantic_merge?.observation_states ?? [];
  if (states.some((state) => state.lifecycle_status === 'stale' || state.lifecycle_status === 'superseded')) return 'stale';
  if (states.some((state) => state.disposition === 'demote-to-ambient')) return 'unverified';
  return 'present';
}

function selectProbeTarget(projectRoot) {
  const candidates = ['package.json', 'README.md', 'src/index.ts', 'index.ts'];
  return candidates.find((candidate) => existsSync(join(projectRoot, candidate))) ?? undefined;
}

function buildStatusDiagnostics(sourceStatus, gitignore, plugin, defaultModeProbe, paths) {
  const items = [];
  if (sourceStatus.localAugment === 'absent') {
    items.push({
      severity: 'warning',
      code: 'local-augment-absent',
      message: 'Local augment is absent; Runtime will use built-in playbook layers only.',
      action: 'Run init prepare/commit only when project-specific local guidance is worth maintaining as local runtime state.',
      command: `node skills/init/scripts/init.mjs prepare ${JSON.stringify(paths.projectRoot)}`,
    });
  }
  if (sourceStatus.rccl === 'absent') {
    items.push({
      severity: 'warning',
      code: 'rccl-absent',
      message: 'RCCL is absent; repository observations will not influence task-time guidance.',
      action: 'Run incremental calibration for target-scoped repository observations when a task needs local context.',
      command: `node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs prepare-incremental ${JSON.stringify(paths.projectRoot)}`,
    });
  }
  if (sourceStatus.rccl === 'unverified') {
    items.push({
      severity: 'warning',
      code: 'rccl-unverified',
      message: 'RCCL exists but has incomplete verification metadata; Runtime will reverify task-relevant observations at compile time.',
      action: 'Use task-scoped compile normally, or call Runtime with verificationPolicy: "deep" for a full verification pass.',
    });
  }
  if (sourceStatus.rccl === 'stale') {
    items.push({
      severity: 'warning',
      code: 'rccl-stale',
      message: 'RCCL contains stale or superseded lifecycle records; Runtime will keep stale signals ambient after adjudication.',
      action: 'Run incremental calibration refresh when stale observations are relevant to the task.',
      command: `node skills/calibrate-repo-context/scripts/calibrate-repo-context.mjs prepare-incremental ${JSON.stringify(paths.projectRoot)}`,
    });
  }
  if (gitignore.broadResonantIgnore) {
    items.push({
      severity: 'info',
      code: 'resonant-local-only',
      message: '.gitignore ignores all of .resonant-code; Runtime artifacts are treated as local-only state.',
      action: 'No repository commit action is required unless the project intentionally changes its artifact lifecycle policy.',
    });
  }
  if (!gitignore.broadResonantIgnore && !gitignore.contextIgnored) {
    items.push({
      severity: 'info',
      code: 'context-not-ignored',
      message: '.resonant-code/context/ is generated runtime state and should normally be ignored.',
      action: 'Add .resonant-code/context/ to .gitignore.',
    });
  }
  if (plugin.status !== 'ok') {
    items.push({
      severity: 'error',
      code: 'plugin-incomplete',
      message: `Plugin root is missing or has empty required runtime files: ${[...plugin.missing, ...plugin.emptyDirectories].join(', ')}`,
      action: 'Run pnpm -r build and verify the plugin package before installing or publishing.',
      command: 'pnpm -r build',
    });
  }
  if (defaultModeProbe.status === 'ok' && defaultModeProbe.wouldBlock) {
    items.push({
      severity: 'warning',
      code: 'standard-default-blocks',
      message: `A low-risk single-file standard-mode probe would block on: ${defaultModeProbe.requiredContracts.join(', ')}`,
      action: 'Inspect resolveContractPolicy before using this plugin as a low-friction default.',
    });
  }
  if (defaultModeProbe.status === 'error') {
    items.push({
      severity: 'error',
      code: 'standard-probe-failed',
      message: `Standard-mode probe failed: ${defaultModeProbe.error}`,
      action: 'Fix Runtime loading or build output before using code auto.',
      command: 'pnpm -r build',
    });
  }
  return {
    gitignore,
    items,
  };
}

function buildReadinessSummary(items) {
  const errors = items.filter((item) => item.severity === 'error');
  const warnings = items.filter((item) => item.severity === 'warning');
  const infos = items.filter((item) => item.severity === 'info');
  return {
    status: errors.length ? 'blocked' : warnings.length ? 'needs-attention' : 'ready',
    counts: {
      error: errors.length,
      warning: warnings.length,
      info: infos.length,
    },
    nextActions: [...errors, ...warnings, ...infos]
      .slice(0, 5)
      .map((item) => ({
        code: item.code,
        action: item.action,
        ...(item.command ? { command: item.command } : {}),
      })),
  };
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
