import type {
  AgentCapabilityProfile,
  TaskModelProposal,
} from './ai-contracts/types.ts';
import { resolveTask } from './interpret/normalize-candidate.ts';
import type {
  ContractPolicyDecision,
  ContractPolicyKind,
  CompileTaskInput,
  ContextProfile,
  GuidanceExecutionMode,
  GuidancePlanProvidedContracts,
  GuidancePlanSourceStatus,
  ResolvedTaskOutput,
  RiskLevel,
} from './types.ts';
import { unique } from './utils/common.ts';

export interface ContractPolicyInput {
  sourceStatus: GuidancePlanSourceStatus;
  providedContracts?: GuidancePlanProvidedContracts;
  agentCapabilityProfile?: AgentCapabilityProfile | null;
  taskRisk?: RiskLevel;
  task?: CompileTaskInput;
  taskModels?: TaskModelProposal[];
  resolvedTask?: ResolvedTaskOutput;
  mode?: GuidanceExecutionMode;
  rcclRelevant?: boolean;
}

const DEFAULT_CAPABILITIES: AgentCapabilityProfile = {
  can_read_files: true,
  can_search_files: true,
  can_run_commands: false,
  can_inspect_diff: false,
  can_request_context: true,
  max_context_files: 12,
  max_command_count: 0,
};

export function resolveContractPolicy(input: ContractPolicyInput): ContractPolicyDecision {
  const mode = input.mode ?? 'standard';
  const policyInput = {
    ...input,
    resolvedTask: input.resolvedTask ?? resolvePolicyTask(input),
  };
  const provided = input.providedContracts ?? {};
  const capability = input.agentCapabilityProfile ?? DEFAULT_CAPABILITIES;
  const highRiskTask = isHighRisk(policyRiskLevel(policyInput));
  const taskModelRequired = shouldRequireTaskModel(policyInput, mode);
  const semanticGraphRequired = shouldRequireSemanticGraph(policyInput, mode, taskModelRequired);
  const deterministicFallbacks = collectDeterministicFallbackGovernance(policyInput);
  const required: ContractPolicyKind[] = [];
  const optional: ContractPolicyKind[] = [];
  const skipped: ContractPolicyDecision['skipped'] = [];
  const reasons: string[] = [];

  skipped.push({
    kind: 'agent-capability-profile',
    reason_id: provided.agentCapability ? 'already-provided' : 'runtime-assumption',
  });
  if (!provided.agentCapability) {
    reasons.push('agent capability profile is a Runtime assumption for policy selection, not a host artifact.');
  }

  if (provided.taskModel) {
    skipped.push({ kind: 'task-model', reason_id: 'already-provided' });
  } else if (taskModelRequired) {
    required.push('task-model');
    reasons.push(mode === 'strict'
      ? 'strict mode requires task-model before deterministic compilation.'
      : 'task risk, compatibility, migration, or ambiguity requires task-model.');
  } else {
    optional.push('task-model');
    skipped.push({ kind: 'task-model', reason_id: mode === 'fast' ? 'mode-fast' : 'deterministic-fallback-allowed' });
    reasons.push('deterministic task interpretation is allowed for this mode and task shape.');
  }

  const needsTaskModel = taskModelRequired && !provided.taskModel;

  if (rcclAvailable(input.sourceStatus)) {
    if (provided.semanticGovernanceGraph) {
      skipped.push({ kind: 'semantic-governance-graph', reason_id: 'already-provided' });
    } else if (!semanticGraphRequired) {
      skipped.push({
        kind: 'semantic-governance-graph',
        reason_id: mode === 'fast'
          ? 'mode-fast'
          : input.rcclRelevant === false
            ? 'rccl-not-relevant'
            : 'not-required-for-current-policy',
      });
    } else if (needsTaskModel) {
      skipped.push({ kind: 'semantic-governance-graph', reason_id: 'waiting-for-task-model' });
      reasons.push('semantic-governance-graph is deferred until task-model is provided.');
    } else {
      required.push('semantic-governance-graph');
      reasons.push('RCCL is relevant to this task and semantic governance should be host-assisted.');
    }
  } else if (capability.can_request_context) {
    if (mode === 'strict' && highRiskTask) required.push('context-acquisition');
    else optional.push('context-acquisition');
    skipped.push({ kind: 'semantic-governance-graph', reason_id: 'missing-rccl' });
  } else {
    skipped.push({ kind: 'semantic-governance-graph', reason_id: 'missing-rccl' });
    skipped.push({ kind: 'context-acquisition', reason_id: 'insufficient-agent-capability' });
  }

  if (!provided.adherenceEvidence && (capability.can_inspect_diff || capability.can_read_files || capability.can_run_commands)) {
    if (mode === 'strict') required.push('adherence-evidence');
    else optional.push('adherence-evidence');
    skipped.push({ kind: 'adherence-evidence', reason_id: 'deferred-until-after-compile' });
  } else if (provided.adherenceEvidence) {
    skipped.push({ kind: 'adherence-evidence', reason_id: 'already-provided' });
  } else {
    skipped.push({ kind: 'adherence-evidence', reason_id: 'insufficient-agent-capability' });
  }

  if (input.sourceStatus.lockfile === 'present') {
    optional.push('governance-evolution-proposal');
  } else {
    skipped.push({ kind: 'governance-evolution-proposal', reason_id: 'not-required-for-current-policy' });
  }

  return {
    mode,
    required: unique(required),
    optional: unique(optional),
    skipped,
    escalation: resolveEscalation(required, optional),
    diagnostics: {
      task_model_required: taskModelRequired,
      semantic_graph_required: semanticGraphRequired,
      ...(input.rcclRelevant !== undefined ? { rccl_relevant: input.rcclRelevant } : {}),
      reasons,
      deterministic_fallbacks: deterministicFallbacks,
    },
  };
}

function resolveEscalation(required: ContractPolicyKind[], optional: ContractPolicyKind[]): ContractPolicyDecision['escalation'] {
  if (required.includes('task-model')) return 'task-model';
  if (required.includes('semantic-governance-graph')) return 'semantic-governance-graph';
  if (required.includes('adherence-evidence')) return 'adherence-required';
  if (required.includes('context-acquisition')) return 'context-acquisition';
  return 'none';
}

function shouldRequireTaskModel(input: ContractPolicyInput, mode: GuidanceExecutionMode): boolean {
  if (mode === 'strict') return true;
  if (mode === 'fast') return false;
  const profile = policyContextProfile(input);
  const task = policyTask(input);
  const operation = input.resolvedTask?.task_intent.operation ?? task?.operation;
  const taskKind = input.resolvedTask?.taskKind ?? task?.taskKind;
  if (isHighRisk(policyRiskLevel(input)) && isPolicyAuthoritative(input, 'context.risk_level', 'riskLevel')) return true;
  if (profile?.scope_size === 'cross-cutting') return true;
  if (profile?.compatibility_requirement && profile.compatibility_requirement !== 'none' && profile.compatibility_requirement !== 'breaking-allowed'
    && isPolicyAuthoritative(input, 'context.compatibility_requirement', 'compatibilityRequirement')) return true;
  if (profile?.interface_sensitivity && profile.interface_sensitivity !== 'internal' && profile.interface_sensitivity !== 'unknown'
    && isPolicyAuthoritative(input, 'context.interface_sensitivity', 'interfaceSensitivity')) return true;
  if (profile?.migration_phase && profile.migration_phase !== 'none'
    && isPolicyAuthoritative(input, 'context.migration_phase', 'migrationPhase')) return true;
  if ((profile?.review_goal === 'security' || profile?.review_goal === 'regression-risk' || profile?.review_goal === 'architecture-fit')
    && isPolicyAuthoritative(input, 'context.review_goal', 'reviewGoal')) return true;
  if (taskKind === 'migration' && isPolicyAuthoritative(input, 'intent.task_kind', 'taskKind')) return true;
  if (operation === 'review' && isPolicyAuthoritative(input, 'intent.operation', 'operation')) return true;
  return hasAmbiguousTaskResolution(input);
}

function shouldRequireSemanticGraph(
  input: ContractPolicyInput,
  mode: GuidanceExecutionMode,
  taskModelRequired: boolean,
): boolean {
  if (!rcclAvailable(input.sourceStatus)) return false;
  if (mode === 'fast') return false;
  if (mode === 'strict') return true;
  if (input.rcclRelevant !== true) return false;
  return taskModelRequired || isHighRisk(policyRiskLevel(input));
}

function hasAmbiguousTaskResolution(input: ContractPolicyInput): boolean {
  const resolved = input.resolvedTask;
  if (!resolved?.diagnostics.clarification_recommended) return false;
  const hasTarget = Boolean(
    resolved.task_intent.target_file
    || resolved.task_intent.changed_files.length
    || input.task?.targetFile
    || input.task?.changedFiles?.length,
  );
  if (hasTarget) return false;
  const operationField = resolved.input_provenance.resolved_fields.find((field) => field.field === 'intent.operation');
  return !input.task?.operation
    && (!operationField || (operationField.source === 'deterministic' && operationField.confidence <= 0.5));
}

function collectDeterministicFallbackGovernance(
  input: ContractPolicyInput,
): ContractPolicyDecision['diagnostics']['deterministic_fallbacks'] {
  const result: ContractPolicyDecision['diagnostics']['deterministic_fallbacks'] = [];
  const profile = policyContextProfile(input);
  if (!profile) return result;
  addFallbackGovernance(result, input, 'context.risk_level', profile.risk_level ?? '');
  addFallbackGovernance(result, input, 'context.compatibility_requirement', profile.compatibility_requirement ?? '');
  addFallbackGovernance(result, input, 'context.interface_sensitivity', profile.interface_sensitivity ?? '');
  addFallbackGovernance(result, input, 'context.migration_phase', profile.migration_phase ?? '');
  addFallbackGovernance(result, input, 'context.review_goal', profile.review_goal ?? '');
  return result;
}

function addFallbackGovernance(
  result: ContractPolicyDecision['diagnostics']['deterministic_fallbacks'],
  input: ContractPolicyInput,
  field: string,
  value: string,
): void {
  if (!value || !isElevatedFallbackField(field, value)) return;
  const resolved = resolvedField(input, field);
  if (resolved?.source !== 'deterministic') return;
  result.push({
    field,
    value,
    confidence: resolved.confidence,
    action: 'ignored-for-policy',
    reason: 'deterministic fallback is trace-only and does not trigger standard-mode governance contracts',
  });
}

function isElevatedFallbackField(field: string, value: string): boolean {
  if (field === 'context.risk_level') return value === 'high' || value === 'critical';
  if (field === 'context.compatibility_requirement') return value !== 'none' && value !== 'breaking-allowed';
  if (field === 'context.interface_sensitivity') return value !== 'internal' && value !== 'unknown';
  if (field === 'context.migration_phase') return value !== 'none';
  if (field === 'context.review_goal') return value === 'security' || value === 'regression-risk' || value === 'architecture-fit';
  return false;
}

function isPolicyAuthoritative(
  input: ContractPolicyInput,
  field: string,
  rawTaskField: keyof CompileTaskInput,
): boolean {
  if (rawTaskField === 'riskLevel' && input.taskRisk && isHighRisk(input.taskRisk)) return true;
  return Boolean(input.task?.[rawTaskField]) && isFieldAuthoritative(input, field);
}

function isFieldAuthoritative(input: ContractPolicyInput, field: string): boolean {
  const source = resolvedField(input, field)?.source;
  return source === 'explicit' || source === 'host-agent' || source === 'assistive-ai' || source === 'repo-default';
}

function resolvedField(input: ContractPolicyInput, field: string): ResolvedTaskOutput['input_provenance']['resolved_fields'][number] | undefined {
  return input.resolvedTask?.input_provenance.resolved_fields.find((item) => item.field === field);
}

function rcclAvailable(sourceStatus: GuidancePlanSourceStatus): boolean {
  return sourceStatus.rccl === 'present' || sourceStatus.rccl === 'stale' || sourceStatus.rccl === 'unverified';
}

function resolvePolicyTask(input: ContractPolicyInput): ResolvedTaskOutput | undefined {
  if (!input.task) return undefined;
  return resolveTask({
    task: input.task,
    taskModels: input.taskModels ?? [],
    interpretationMode: input.taskModels?.length ? 'host-agent' : 'deterministic-only',
  });
}

function policyTask(input: ContractPolicyInput): CompileTaskInput | undefined {
  return input.resolvedTask?.task ?? input.task;
}

function policyContextProfile(input: ContractPolicyInput): ContextProfile | undefined {
  return input.resolvedTask?.context_profile;
}

function policyRiskLevel(input: ContractPolicyInput): RiskLevel | undefined {
  return input.resolvedTask?.context_profile.risk_level ?? input.taskRisk ?? input.task?.riskLevel;
}

function isHighRisk(value: RiskLevel | undefined): boolean {
  return value === 'high' || value === 'critical';
}
