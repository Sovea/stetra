import { readFileSync } from 'node:fs';
import { projectIRActivationToPublic } from './ir/activation/public-adapter.ts';
import { resolveActivationDecisionsIR, activatedDirectiveIdsIR } from './ir/activation/resolve-activation.ts';
import { toResolvedCompileInput } from './compile-input.ts';
import { buildGovernanceIR } from './ir/build-ir.ts';
import { projectIREgoToPublic } from './ir/ego/public-adapter.ts';
import { resolveExecutionDecisionsIR } from './ir/execution/resolve-execution.ts';
import { buildSemanticRelationsIR } from './ir/relations/build-relations.ts';
import { projectIRSemanticMergeToPublic } from './ir/semantic-merge/public-adapter.ts';
import { loadOrVerifyCompileSources, type CompileSources } from './load/compile-sources.ts';
import { stableHash } from './utils/hash.ts';
import type {
  ChangeDecisionPacket,
  CompileInput,
  CompileOutput,
  DecisionTrace,
  Directive,
  EffectiveGuidanceObject,
  FocusView,
  GovernancePacket,
  InterpretationPacket,
  RcclDocument,
  ResolvedCompileInput,
  ResolvedTaskOutput,
  ReviewFocusItem,
  SemanticMergeResult,
  TensionView,
  TraceStep,
} from './types.ts';
import type { SemanticRelationIR } from './ir/types.ts';

function buildInterpretationPacket(resolved: ResolvedTaskOutput): InterpretationPacket {
  return {
    task_models: resolved.task_models,
    input_provenance: resolved.input_provenance,
    diagnostics: resolved.diagnostics,
    trace: resolved.trace,
    resolved: {
      task_intent: resolved.task_intent,
      context_profile: resolved.context_profile,
    },
  };
}

function buildGovernancePacket(
  activation: DecisionTrace['activation'],
  tensions: TensionView,
  focus: FocusView,
  semantic_merge: SemanticMergeResult,
  ego: EffectiveGuidanceObject,
  trace: DecisionTrace,
): GovernancePacket {
  return { activation, tensions, focus, semantic_merge, ego, trace };
}

function compileResolvedOutput(packet: ChangeDecisionPacket, resolvedTask: ResolvedTaskOutput): CompileOutput {
  return {
    packet,
    resolvedTask,
    ego: packet.governance.ego,
    trace: packet.governance.trace,
    cache: packet.cache,
  };
}

/**
 * Runs the deterministic playbook pipeline and produces a change decision packet.
 */
export async function compile(input: CompileInput): Promise<CompileOutput> {
  const normalizedInput = toResolvedCompileInput(input);
  const resolved = normalizedInput.resolvedTask;
  const traceSteps: TraceStep[] = [];
  const intent = resolved.task_intent;
  const contextProfile = resolved.context_profile;
  const hostFulfillment = normalizedInput.hostFulfillment;

  traceSteps.push({
    stage: 'Intent Parse',
    lines: [
      `interpretation_mode: ${resolved.input_provenance.interpretation_mode}`,
      `resolved_fields: ${resolved.input_provenance.resolved_fields.length}`,
      `unresolved_fields: ${resolved.input_provenance.unresolved_fields.join(', ') || '(none)'}`,
      `operation: ${intent.operation}`,
      `target_layer: ${intent.target_layer}`,
      `tech_stack: ${intent.tech_stack.join(', ') || '(none)'}`,
      `target_file: ${intent.target_file ?? '(none)'}`,
      `optimization_target: ${contextProfile.optimization_target}`,
      `hard_constraints: ${contextProfile.hard_constraints.join(', ') || '(none)'}`,
      `allowed_tradeoffs: ${contextProfile.allowed_tradeoffs.join(', ') || '(none)'}`,
      `avoid: ${contextProfile.avoid.join(', ') || '(none)'}`,
      `project_stage: ${contextProfile.project_stage ?? '(none)'}`,
      `risk_level: ${contextProfile.risk_level}`,
      `scope_size: ${contextProfile.scope_size}`,
      `compatibility_requirement: ${contextProfile.compatibility_requirement}`,
      `interface_sensitivity: ${contextProfile.interface_sensitivity}`,
      `refactor_tolerance: ${contextProfile.refactor_tolerance}`,
      `migration_phase: ${contextProfile.migration_phase}`,
      `review_goal: ${contextProfile.review_goal}`,
    ],
  });
  traceSteps.push({
    stage: 'Context Profile Resolution',
    lines: resolved.input_provenance.context_resolution.length
      ? resolved.input_provenance.context_resolution.map((item) =>
          `${item.field}: ${formatContextValue(item.value)} source=${item.source} confidence=${item.confidence} status=${item.status} influence=${item.influence.join(', ') || '(none)'}`)
      : ['no context profile resolution records'],
  });

  const sources = await loadOrVerifyCompileSources(normalizedInput, normalizedInput.preloadedSources);
  const governanceIR = await buildGovernanceIR(normalizedInput, sources);
  traceSteps.push({
    stage: 'Governance IR',
    lines: [
      `ir_version: ${governanceIR.irVersion}`,
      `bundle_fingerprint: ${governanceIR.fingerprints.bundle}`,
      `task_fingerprint: ${governanceIR.fingerprints.task}`,
      `directives_fingerprint: ${governanceIR.fingerprints.directives}`,
      `observations_fingerprint: ${governanceIR.fingerprints.observations}`,
      `feedback_fingerprint: ${governanceIR.fingerprints.feedback}`,
      `host_proposals_fingerprint: ${governanceIR.fingerprints.hostProposals}`,
      `host_proposal_sources: ${formatRecordCounts(countSourceIds(governanceIR.hostProposals.map((proposal) => proposal.source.id)))}`,
      `selected_layers: ${governanceIR.sourceManifest.selectedLayers.join(', ') || '(none)'}`,
    ],
  });
  traceSteps.push({
    stage: 'Host Fulfillment',
    lines: summarizeHostFulfillment(hostFulfillment),
  });

  const activationDecisionsIR = resolveActivationDecisionsIR(governanceIR);
  const irActivatedDirectiveIds = activatedDirectiveIdsIR(activationDecisionsIR);
  const activatedGovernanceIR = {
    ...governanceIR,
    directives: governanceIR.directives.filter((directive) => irActivatedDirectiveIds.has(directive.id)),
  };
  const semanticRelationsIR = buildSemanticRelationsIR(activatedGovernanceIR);
  traceSteps.push({
    stage: 'IR Semantic Relations',
    lines: summarizeSemanticRelationsIR(semanticRelationsIR),
  });

  const { activationView, activeDirectives } = projectIRActivationToPublic(governanceIR, activationDecisionsIR);
  const selectedLayerIds = sources.selectedLayerIds;

  traceSteps.push({
    stage: 'Layer Filter',
    lines: [
      ...(activationView.selected_layers.length
        ? activationView.selected_layers.map((layerId) => `applied ${layerId}`)
        : ['applied builtin/core']),
      `activated: ${activationView.activated.length}`,
      `skipped: ${activationView.skipped.length}`,
    ],
  });
  const rccl = sources.rccl;
  traceSteps.push({
    stage: 'RCCL Source Evolution',
    lines: summarizeRcclSourceEvolution(rccl),
  });
  traceSteps.push({
    stage: 'RCCL Verify Gate',
    lines: rccl?.observations.length
      ? [
          ...summarizeRcclVerificationPolicy(sources.rcclVerificationSummary),
          ...rccl.observations.map((observation) => {
            const record = sources.rcclVerificationSummary?.records.find((item) => item.observation_id === observation.id);
            const evidenceStatus = observation.verification.evidence_status ?? 'pending';
            const inductionStatus = observation.verification.induction_status ?? 'pending';
            const disposition = observation.verification.disposition ?? 'pending';
            const lifecycleStatus = observation.lifecycle?.status ?? 'unknown';
            const verificationAction = record
              ? ` verification_action=${record.action} task_relevant=${record.task_relevant}`
              : '';
            return `${observation.id}: evidence=${evidenceStatus} induction=${inductionStatus} disposition=${disposition} lifecycle=${lifecycleStatus} support=${observation.support.scope_basis}/${observation.support.file_count}f/${observation.support.cluster_count}c${verificationAction}`;
          }),
        ]
      : ['no rccl loaded'],
  });

  const executionDecisionsIR = resolveExecutionDecisionsIR(activatedGovernanceIR, semanticRelationsIR);
  const semanticMergeResult = projectIRSemanticMergeToPublic(
    activeDirectives,
    rccl?.observations ?? [],
    semanticRelationsIR,
    executionDecisionsIR,
    contextProfile,
  );
  const tensions: TensionView = { records: semanticMergeResult.context_tensions };
  const focus = buildFocusView(semanticMergeResult, activeDirectives);
  traceSteps.push({
    stage: 'Semantic Merge',
    lines: [
      `activated_directives: ${semanticMergeResult.activated_directives.length}`,
      `suppressed_directives: ${semanticMergeResult.suppressed_directives.length}`,
      `relations: ${semanticMergeResult.relations.length}`,
      `accepted_relations: ${semanticMergeResult.merge_summary.accepted}`,
      `downgraded_relations: ${semanticMergeResult.merge_summary.downgraded}`,
      `rejected_relations: ${semanticMergeResult.merge_summary.rejected}`,
      `final_relations: ${formatRecordCounts(semanticMergeResult.merge_summary.final_relation_counts)}`,
      `relation_sources: ${formatRecordCounts(semanticMergeResult.merge_summary.proposed_by_counts)}`,
      `execution_mode_impacting_relations: ${semanticMergeResult.merge_summary.execution_mode_impacting}`,
      `host_graph_edges: ${semanticMergeResult.merge_summary.host_graph_edge_count}`,
      `feedback_applied: ${semanticMergeResult.merge_summary.feedback_applied_count}`,
      `semantic_relation_policy: ${formatPolicy(semanticMergeResult.merge_summary.policy)}`,
      `review_focus_by_priority: ${formatRecordCounts(semanticMergeResult.merge_summary.review_priority_counts)}`,
      `governance_graph_mode_changes: ${governanceGraphModeChanges(semanticMergeResult).join(', ') || '(none)'}`,
      `context_policy_rules: ${formatListCounts(executionDecisionsIR.flatMap((decision) => decision.contextRulesApplied))}`,
      `context_tensions: ${semanticMergeResult.context_tensions.length}`,
      `review_focus: ${focus.review_focus.length}`,
      `context_influences: ${semanticMergeResult.context_influences.length}`,
    ],
  });

  const ego = projectIREgoToPublic(activatedGovernanceIR, semanticMergeResult, intent);
  traceSteps.push({
    stage: 'EGO Assembly',
    lines: [
      `must_follow: ${ego.guidance.must_follow.length}`,
      `avoid: ${ego.guidance.avoid.length}`,
      `context_tensions: ${ego.guidance.context_tensions.length}`,
      `ambient: ${ego.guidance.ambient.length}`,
    ],
  });

  const trace: DecisionTrace = {
    task: intent,
    steps: traceSteps,
    activated_directives: semanticMergeResult.activated_directives,
    suppressed_directives: semanticMergeResult.suppressed_directives,
    activation: activationView,
    tensions,
    review_focus: focus.review_focus,
    directive_decisions: semanticMergeResult.directive_modes,
    observation_links: semanticMergeResult.observation_links,
    context_influences: semanticMergeResult.context_influences,
    ...(hostFulfillment ? { host_fulfillment: hostFulfillment } : {}),
  };

  const cache = buildCacheKeys({
    builtinRoot: normalizedInput.builtinRoot,
    localAugmentPath: normalizedInput.localAugmentPath,
    rcclPath: normalizedInput.rcclPath,
    task: resolved.task,
    builtinLayers: sources.builtinLayers,
    hostProposalsFingerprint: governanceIR.fingerprints.hostProposals,
    verificationPolicy: normalizedInput.verificationPolicy ?? 'task-relevant',
    rcclVerificationSummary: sources.rcclVerificationSummary,
  }, selectedLayerIds, rccl);

  const packet: ChangeDecisionPacket = {
    version: '1.0',
    task: {
      task_kind: resolved.taskKind,
      input: resolved.task,
    },
    interpretation: buildInterpretationPacket(resolved),
    governance: buildGovernancePacket(activationView, tensions, focus, semanticMergeResult, ego, trace),
    cache,
  };

  return compileResolvedOutput(packet, resolved);
}

function summarizeRcclSourceEvolution(rccl: RcclDocument | null): string[] {
  if (!rccl) return ['no rccl loaded'];
  const lifecycleCounts = countBy(rccl.observations, (observation) => observation.lifecycle?.status ?? 'unknown');
  const fingerprints = rccl.observations
    .filter((observation) => observation.lifecycle?.content_fingerprint)
    .map((observation) => `${observation.id}:${observation.lifecycle?.content_fingerprint.slice(0, 10)}`);
  return [
    `version: ${rccl.version}`,
    `git_ref: ${rccl.git_ref ?? '(none)'}`,
    `generated_at: ${rccl.generated_at ?? '(none)'}`,
    `observations: ${rccl.observations.length}`,
    `lifecycle_statuses: ${formatCounts(lifecycleCounts)}`,
    `fingerprints: ${fingerprints.join(', ') || '(none)'}`,
  ];
}

function summarizeSemanticRelationsIR(relations: SemanticRelationIR[]): string[] {
  const statusCounts = countBy(relations, (relation) => relation.adjudication.status);
  const finalRelationCounts = countBy(relations, (relation) => relation.adjudication.finalRelation);
  const proposedRelationCounts = countBy(relations, (relation) => relation.relation);
  const proposedByCounts = countBy(relations, (relation) => relation.proposedBy);
  return [
    `proposed: ${relations.length}`,
    `accepted: ${statusCounts.get('accepted') ?? 0}`,
    `downgraded: ${statusCounts.get('downgraded') ?? 0}`,
    `rejected: ${statusCounts.get('rejected') ?? 0}`,
    `proposed_relations: ${formatCounts(proposedRelationCounts)}`,
    `final_relations: ${formatCounts(finalRelationCounts)}`,
    `proposed_by: ${formatCounts(proposedByCounts)}`,
  ];
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return '(none)';
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
}

function buildFocusView(semanticMergeResult: SemanticMergeResult, directives: Directive[]): FocusView {
  const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
  const review_focus: ReviewFocusItem[] = semanticMergeResult.focus.review_focus.map((item) => {
    const directive = item.directive_id ? directiveById.get(item.directive_id) : undefined;
    return {
      kind: item.kind,
      title: buildFocusTitle(item.kind, directive?.description, item.directive_id, item.observation_id),
      reason: item.reason,
      directive_id: item.directive_id,
      observation_id: item.observation_id,
      priority: item.priority,
      relation_id: item.relation_id,
      group_id: item.group_id,
    };
  });
  return { review_focus };
}

function buildFocusTitle(
  kind: ReviewFocusItem['kind'],
  directiveDescription: string | undefined,
  directiveId: string | undefined,
  observationId: string | undefined,
): string {
  const directiveLabel = directiveDescription ?? directiveId ?? 'directive';
  switch (kind) {
    case 'tension':
      return `Review tension around ${directiveLabel}`;
    case 'anti-pattern':
      return `Check anti-pattern suppression for ${observationId ?? directiveLabel}`;
    case 'high-priority-directive':
      return `Confirm high-priority guidance for ${directiveLabel}`;
    case 'compatibility-boundary':
      return `Inspect compatibility boundary for ${directiveLabel}`;
  }
}

function governanceGraphModeChanges(semanticMergeResult: SemanticMergeResult): string[] {
  return semanticMergeResult.directive_modes
    .filter((item) => item.relation_ids.length > 0 && item.execution_mode !== item.default_execution_mode)
    .map((item) => `${item.directive_id}:${item.default_execution_mode}->${item.execution_mode}`);
}

function countSourceIds(sourceIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sourceId of sourceIds) counts[sourceId] = (counts[sourceId] ?? 0) + 1;
  return counts;
}

function summarizeHostFulfillment(hostFulfillment: CompileInput['hostFulfillment']): string[] {
  if (!hostFulfillment) return ['no host fulfillment summary provided'];
  return [
    `status: ${hostFulfillment.status}`,
    formatHostFulfillmentArtifact('agent_capability_profile', hostFulfillment.agentCapability),
    formatHostFulfillmentArtifact('task_model', hostFulfillment.taskModel),
    formatHostFulfillmentArtifact('semantic_governance_graph', hostFulfillment.semanticGovernanceGraph),
    ...(hostFulfillment.adherenceEvidence ? [formatHostFulfillmentArtifact('adherence_evidence', hostFulfillment.adherenceEvidence)] : []),
    `evidence_coverage: ${formatEvidenceCoverage(hostFulfillment)}`,
  ];
}

function summarizeRcclVerificationPolicy(summary: CompileSources['rcclVerificationSummary']): string[] {
  if (!summary) return ['verification_policy: none'];
  return [
    `verification_policy: ${summary.policy}`,
    `reverified_count: ${summary.reverified_count}`,
    `reused_count: ${summary.reused_count}`,
    `demoted_count: ${summary.demoted_count}`,
    `skipped_not_task_relevant_count: ${summary.skipped_not_task_relevant_count}`,
  ];
}

function formatHostFulfillmentArtifact(label: string, artifact: NonNullable<CompileInput['hostFulfillment']>['taskModel']): string {
  const diagnostics = artifact.diagnostics?.summary;
  return `${label}: provided=${artifact.provided} status=${artifact.status} accepted=${diagnostics?.accepted ?? 0} rejected=${diagnostics?.rejected ?? 0} downgraded=${diagnostics?.downgraded ?? 0} unused=${diagnostics?.unused ?? 0}`;
}

function formatEvidenceCoverage(hostFulfillment: NonNullable<CompileInput['hostFulfillment']>): string {
  const artifacts = [
    hostFulfillment.taskModel,
    hostFulfillment.semanticGovernanceGraph,
    hostFulfillment.adherenceEvidence,
  ].filter(Boolean);
  const totals = artifacts.reduce((acc, artifact) => {
    const summary = artifact.diagnostics?.summary;
    acc.total += summary?.total ?? 0;
    acc.accepted += summary?.accepted ?? 0;
    acc.rejected += summary?.rejected ?? 0;
    acc.downgraded += summary?.downgraded ?? 0;
    acc.unused += summary?.unused ?? 0;
    return acc;
  }, { total: 0, accepted: 0, rejected: 0, downgraded: 0, unused: 0 });
  if (totals.total === 0) return 'none';
  return `accepted=${totals.accepted}/${totals.total} rejected=${totals.rejected} downgraded=${totals.downgraded} unused=${totals.unused}`;
}

function formatRecordCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  return entries.length
    ? entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}=${count}`).join(', ')
    : '(none)';
}

function formatListCounts(values: string[]): string {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return formatRecordCounts(counts);
}

function formatContextValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(',') || '(none)' : value || '(none)';
}

function formatPolicy(policy: SemanticMergeResult['merge_summary']['policy']): string {
  return [
    `host_min_confidence=${policy.host_semantic.min_confidence}`,
    `host_candidate_cap=${policy.host_semantic.max_candidates_per_directive}`,
    `feedback_follow_rate=${policy.feedback.frequently_ignored_follow_rate}`,
    `feedback_min_ignored=${policy.feedback.frequently_ignored_min_ignored}`,
    `recurring_tension_seen=${policy.feedback.recurring_tension_seen_count}`,
  ].join(', ');
}

/**
 * Derives stable cache keys for layered inputs and the concrete task payload.
 */
function buildCacheKeys(
  input: Pick<ResolvedCompileInput, 'builtinRoot' | 'localAugmentPath' | 'rcclPath'> & {
    task: ResolvedTaskOutput['task'];
    builtinLayers: CompileSources['builtinLayers'];
    hostProposalsFingerprint: string;
    verificationPolicy: NonNullable<ResolvedCompileInput['verificationPolicy']>;
    rcclVerificationSummary: CompileSources['rcclVerificationSummary'];
  },
  selectedLayerIds: string[],
  rccl: RcclDocument | null,
): CompileOutput['cache'] {
  const builtinFingerprints = selectedLayerIds.map((layerId) => {
    const filePath = input.builtinLayers.get(layerId);
    return `${layerId}:${filePath ? stableHash([readFileSync(filePath, 'utf-8')]) : stableHash(['missing'])}`;
  });
  const localSource = input.localAugmentPath ? readFileSync(input.localAugmentPath, 'utf-8') : '';
  const rcclSource = input.rcclPath && rccl
    ? JSON.stringify(rccl.observations.map((item) => [item.id, item.verification.evidence_status, item.verification.disposition]))
    : '';
  const rcclVerificationKey = fingerprintRcclVerificationSummary(input.rcclVerificationSummary);
  const l1Key = stableHash(builtinFingerprints);
  const l2Key = stableHash([l1Key, localSource, rcclSource, input.verificationPolicy, rcclVerificationKey]);
  const l3Key = stableHash([l2Key, input.task, input.hostProposalsFingerprint]);
  return {
    l1Key,
    l2Key,
    l3Key,
    verificationPolicy: input.verificationPolicy,
    rcclVerificationKey,
  };
}

function fingerprintRcclVerificationSummary(summary: CompileSources['rcclVerificationSummary']): string {
  if (!summary) return stableHash(['no-rccl-verification']);
  return stableHash([
    summary.policy,
    summary.reverified_count,
    summary.reused_count,
    summary.demoted_count,
    summary.skipped_not_task_relevant_count,
    summary.records.map((record) => [
      record.observation_id,
      record.action,
      record.task_relevant,
      record.before.evidence_status,
      record.before.induction_status,
      record.before.disposition,
      record.after.evidence_status,
      record.after.induction_status,
      record.after.disposition,
    ]),
  ]);
}

export { resolveTask } from './interpret/normalize-candidate.ts';
