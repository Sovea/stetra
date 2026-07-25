import { verifyObservationEvidence } from '@resonant-code/rccl/runtime';
import type { RcclDocument, RcclObservation } from '@resonant-code/rccl/runtime';
import {
  assertUniqueDirectiveIds,
  discoverBuiltinLayers,
  loadDirectiveFile,
  loadLocalPlaybook,
  resolveExtendedLayers,
  validateLocalReferences,
} from '../load/load-playbook.ts';
import { loadRccl } from '../load/load-rccl.ts';
import { getDirectiveLayerRank } from '../select/activation-plan.ts';
import { normalizeTaskContext, taskNeedsInterpretation } from '../task/normalize.ts';
import type { NormalizedTaskContext } from '../task/types.ts';
import type {
  Directive,
  DirectiveExample,
  ExecutionMode,
  LocalPlaybook,
} from '../types.ts';
import { stableHash } from '../utils/hash.ts';
import { pathMatchesScope, scopeOverlapsPath } from '../utils/paths.ts';
import { applyGuidanceBudget } from './budget.ts';
import {
  DECISION_SCHEMA_VERSION,
  type AvoidGuidanceItem,
  type ChangeDecisionPacket,
  type CompileChangeInput,
  type CompileChangeOutput,
  type DecisionDiagnostic,
  type DecisionTension,
  type EffectiveGuidance,
  type GuidanceItem,
  type RelationProposal,
  type VerificationPlan,
  type VerificationRequirement,
} from './types.ts';

const RELATION_MIN_CONFIDENCE = 0.72;
const WEIGHT_RANK = { low: 0, normal: 1, high: 2, critical: 3 } as const;

interface EffectiveDirective extends Directive {
  effectivePrescription: Directive['prescription'];
  effectiveWeight: Directive['weight'];
  effectiveRationale: string;
  effectiveExceptions: string[];
  effectiveExamples: DirectiveExample[];
  overrideApplied: boolean;
  augmentApplied: boolean;
}

interface RelationDecision {
  directiveId: string;
  observationId: string;
  relation: 'reinforce' | 'tension' | 'ambient-only';
  status: 'accepted' | 'rejected' | 'downgraded';
  impact: 'execution-mode' | 'review-focus' | 'ambient-context' | 'no-effect';
  reason: string;
  proposedBy: 'host-agent' | 'runtime-structural';
  evidenceRefs: string[];
  rationale: string;
  confidence: number | null;
  proposalKind?: RelationProposal['relation'];
}

interface ObservationVerificationRecord {
  observationId: string;
  status: string;
  disposition: string;
  verifiedCount: number;
  totalCount: number;
  action: 'reverified' | 'reused';
}

export async function compileChange(input: CompileChangeInput): Promise<CompileChangeOutput> {
  if (!input || typeof input !== 'object') throw new Error('compileChange input must be an object.');
  if (typeof input.projectRoot !== 'string' || !input.projectRoot.trim()) throw new Error('compileChange projectRoot must be non-empty.');
  if (typeof input.builtinRoot !== 'string' || !input.builtinRoot.trim()) throw new Error('compileChange builtinRoot must be non-empty.');
  if (!input.task || typeof input.task !== 'object') throw new Error('compileChange task must be an object.');
  const mode = input.mode ?? 'standard';
  if (mode !== 'standard' && mode !== 'strict') throw new Error('compileChange mode must be standard or strict.');
  const relationProposals = validateRelationProposals(input.relationProposals);
  const task = normalizeTaskContext(input.task);
  const interpretationReasons = taskNeedsInterpretation(task, mode);
  if (interpretationReasons.length) {
    return {
      schemaVersion: DECISION_SCHEMA_VERSION,
      status: 'needs-interpretation',
      task,
      reasons: interpretationReasons,
      requiredFields: requiredInterpretationFields(task),
    };
  }

  const loaded = await loadGovernanceSources(input, task);
  const diagnostics: DecisionDiagnostic[] = [];
  if (!loaded.rccl) diagnostics.push({ code: 'RCCL_NOT_LOADED', message: 'No RCCL source was supplied for this task.' });
  const relationDecisions = buildRelationDecisions(
    loaded.directives,
    loaded.relevantObservations,
    relationProposals,
    diagnostics,
  );
  if (loaded.relevantObservations.length && !relationDecisions.some((relation) => relation.impact === 'execution-mode' && relation.status === 'accepted')) {
    diagnostics.push({
      code: 'RCCL_NO_DECISION_IMPACT',
      message: 'Task-relevant RCCL observations were delivered as context but did not change directive execution.',
      ids: loaded.relevantObservations.map((observation) => observation.id),
    });
  }

  const executionModes = resolveExecutionModes(loaded.directives, relationDecisions);
  const rawGuidance = buildEffectiveGuidance(
    loaded.directives,
    loaded.relevantObservations,
    executionModes,
    relationDecisions,
    task,
  );
  const budgeted = applyGuidanceBudget(rawGuidance);
  if (budgeted.omissions.length) {
    diagnostics.push({
      code: 'GUIDANCE_BUDGET_TRIMMED',
      message: `Guidance budget omitted ${budgeted.omissions.length} lower-priority item(s).`,
      ids: budgeted.omissions.map((item) => item.id),
    });
  }

  const deliveredGuidanceIds = guidanceIds(budgeted.guidance);
  const verificationPlan = buildVerificationPlan(budgeted.guidance);
  const relationTrace = relationDecisions.map((relation) => ({
    directiveId: relation.directiveId,
    observationId: relation.observationId,
    relation: relation.relation,
    status: relation.status,
    impact: relation.impact,
    reason: relation.reason,
    rationale: relation.rationale,
    evidenceRefs: relation.evidenceRefs,
    confidence: relation.confidence,
    proposedBy: relation.proposedBy,
  }));
  const fingerprints = {
    task: stableHash([task]),
    directives: stableHash(loaded.directives.map(directiveFingerprintInput)),
    observations: stableHash(loaded.relevantObservations.map(observationFingerprintInput)),
    relations: stableHash([
      relationDecisions.map(relationFingerprintInput),
      relationProposals.map(relationProposalFingerprintInput),
    ]),
  };
  const decisionId = stableHash([
    DECISION_SCHEMA_VERSION,
    mode,
    task,
    deliveredGuidanceIds,
    fingerprints,
  ]);
  const rejectedProposal = diagnostics.some((item) => item.code === 'RELATION_PROPOSAL_REJECTED');

  const packet: ChangeDecisionPacket = {
    schemaVersion: DECISION_SCHEMA_VERSION,
    decisionId,
    status: rejectedProposal ? 'needs-attention' : 'compiled',
    mode,
    task,
    guidance: budgeted.guidance,
    verificationPlan,
    trace: {
      selectedLayers: loaded.selectedLayers,
      activatedDirectiveIds: loaded.directives.map((directive) => directive.id),
      deliveredGuidanceIds,
      suppressedDirectiveIds: loaded.suppressedDirectiveIds,
      relevantObservationIds: loaded.relevantObservations.map((observation) => observation.id),
      observationEvidence: loaded.observationVerification,
      relationDecisions: relationTrace,
      omissions: budgeted.omissions,
      diagnostics,
    },
    fingerprints,
  };
  return packet;
}

async function loadGovernanceSources(input: CompileChangeInput, task: NormalizedTaskContext): Promise<{
  selectedLayers: string[];
  directives: EffectiveDirective[];
  rccl: RcclDocument | null;
  relevantObservations: RcclObservation[];
  observationVerification: ObservationVerificationRecord[];
  suppressedDirectiveIds: string[];
}> {
  const builtinLayers = discoverBuiltinLayers(input.builtinRoot);
  const local = loadLocalPlaybook(input.localAugmentPath);
  const configuredLayers = local?.meta.extends.length
    ? resolveExtendedLayers(local.meta.extends, builtinLayers)
    : ['builtin/core'];
  const inferredLayers = inferTaskLayers(task, builtinLayers);
  const selectedLayers = [...new Set([...configuredLayers, ...inferredLayers])];
  const selectedBuiltins = selectedLayers.flatMap((layerId) => {
    const path = builtinLayers.get(layerId);
    return path ? loadDirectiveFile(path, layerId) : [];
  });
  const allBuiltins = [...builtinLayers.entries()].flatMap(([layerId, path]) => loadDirectiveFile(path, layerId));
  assertUniqueDirectiveIds([...allBuiltins, ...(local?.additions ?? [])]);
  validateLocalReferences(local, allBuiltins);
  const suppressedDirectiveIds = selectedBuiltins
    .filter((directive) => local?.suppresses.some((item) => item.id === directive.id))
    .filter((directive) => directiveMatchesTask(directive, task))
    .map((directive) => directive.id)
    .sort();
  const directives = applyLocalPlaybook([...selectedBuiltins, ...(local?.additions ?? [])], local)
    .filter((directive) => directiveMatchesTask(directive, task))
    .sort(compareDirectives);

  const loadedRccl = await loadRccl(input.rcclPath);
  if (!loadedRccl) {
    return {
      selectedLayers,
      directives,
      rccl: null,
      relevantObservations: [],
      observationVerification: [],
      suppressedDirectiveIds,
    };
  }
  const observationVerification: ObservationVerificationRecord[] = [];
  const observations = loadedRccl.observations.map((observation) => {
    const relevant = observationMatchesTask(observation, task);
    const verified = relevant
      ? verifyObservationEvidence(observation, input.projectRoot, new Date().toISOString())
      : observation;
    if (relevant) {
      observationVerification.push({
        observationId: verified.id,
        status: verified.evidenceVerification.status,
        disposition: observationDisposition(verified),
        verifiedCount: verified.evidenceVerification.verifiedCount,
        totalCount: verified.evidence.length,
        action: 'reverified',
      });
    }
    return verified;
  });
  const rccl = { ...loadedRccl, observations };
  const relevantObservations = observations
    .filter((observation) => observation.lifecycle.status !== 'superseded')
    .filter((observation) => observationMatchesTask(observation, task))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    selectedLayers,
    directives,
    rccl,
    relevantObservations,
    observationVerification,
    suppressedDirectiveIds,
  };
}

function inferTaskLayers(task: NormalizedTaskContext, layers: Map<string, string>): string[] {
  const result: string[] = [];
  const taskLayer = `builtin/task-types/${task.changeType}`;
  if (layers.has(taskLayer)) result.push(taskLayer);
  for (const tech of task.techStack) {
    for (const prefix of ['builtin/languages/', 'builtin/frameworks/']) {
      const layer = `${prefix}${tech}`;
      if (layers.has(layer)) result.push(layer);
    }
  }
  return result.sort();
}

function applyLocalPlaybook(directives: Directive[], local: LocalPlaybook | null): EffectiveDirective[] {
  const overrideById = new Map(local?.overrides.map((item) => [item.supersedes, item]) ?? []);
  const augmentById = new Map(local?.augments.map((item) => [item.id, item]) ?? []);
  const suppressed = new Set(local?.suppresses.map((item) => item.id) ?? []);
  return directives.flatMap((directive) => {
    if (suppressed.has(directive.id)) return [];
    const override = overrideById.get(directive.id);
    const augment = augmentById.get(directive.id);
    return [{
      ...directive,
      effectivePrescription: override?.prescription ?? directive.prescription,
      effectiveWeight: override?.weight ?? directive.weight,
      effectiveRationale: override?.rationale ?? directive.rationale,
      effectiveExceptions: override?.exceptions ?? directive.exceptions ?? [],
      effectiveExamples: augment ? [...directive.examples, ...augment.examples] : directive.examples,
      overrideApplied: Boolean(override),
      augmentApplied: Boolean(augment),
    }];
  });
}

function directiveMatchesTask(directive: Directive, task: NormalizedTaskContext): boolean {
  const layer = directive.source.layerId;
  if (layer.startsWith('builtin/task-types/') && !layer.endsWith(`/${task.changeType}`)) return false;
  if (layer.startsWith('builtin/languages/') && !task.techStack.some((tech) => layer.endsWith(`/${tech}`))) return false;
  if (layer.startsWith('builtin/frameworks/') && !task.techStack.some((tech) => layer.endsWith(`/${tech}`))) return false;
  if (!task.targets.length) return true;
  return task.targets.some((target) => pathMatchesScope(target, directive.scope.path));
}

function observationMatchesTask(observation: RcclObservation, task: NormalizedTaskContext): boolean {
  if (!task.targets.length) return false;
  return task.targets.some((target) =>
    scopeOverlapsPath(observation.scope, target)
    || observation.evidence.some((evidence) => scopeOverlapsPath(evidence.file, target)));
}

function buildRelationDecisions(
  directives: EffectiveDirective[],
  observations: RcclObservation[],
  proposals: RelationProposal[],
  diagnostics: DecisionDiagnostic[],
): RelationDecision[] {
  const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const decisions: RelationDecision[] = [];
  const proposalPairs = new Set<string>();

  for (const proposal of proposals) {
    const key = `${proposal.directiveId}::${proposal.observationId}`;
    const directive = directiveById.get(proposal.directiveId);
    const observation = observationById.get(proposal.observationId);
    const confidence = proposal.confidence ?? 0.85;
    const evidenceRefs = Array.isArray(proposal.evidenceRefs)
      && proposal.evidenceRefs.every((ref) => typeof ref === 'string' && ref.trim())
      ? proposal.evidenceRefs
      : [];
    const errors: string[] = [];
    if (proposalPairs.has(key)) errors.push('duplicate directive/observation pair');
    if (!directive) errors.push('directive is not active for this task');
    if (!observation) errors.push('observation is not relevant to this task');
    if (typeof proposal.rationale !== 'string' || !proposal.rationale.trim()) errors.push('rationale is empty');
    if (!['supports', 'conflicts', 'limits'].includes(proposal.relation)) errors.push('relation must be supports, conflicts, or limits');
    if (!evidenceRefs.length) errors.push('evidenceRefs must be a non-empty string array');
    if (!Number.isFinite(confidence) || confidence < RELATION_MIN_CONFIDENCE || confidence > 1) errors.push(`confidence must be between ${RELATION_MIN_CONFIDENCE} and 1`);
    if (observation && evidenceRefs.length && !proposalEvidenceMatchesObservation(evidenceRefs, observation)) errors.push('evidenceRefs do not cite the linked observation evidence');
    if (directive?.rccl_immune && proposal.relation !== 'supports') errors.push('directive is RCCL-immune and cannot be limited or conflicted by repository observation');
    if (errors.length) {
      diagnostics.push({
        code: 'RELATION_PROPOSAL_REJECTED',
        message: `${key} rejected: ${errors.join('; ')}.`,
        ids: [proposal.directiveId, proposal.observationId],
      });
      continue;
    }
    proposalPairs.add(key);
    const current = observation!.evidenceVerification.status === 'current'
      && observation!.lifecycle.status === 'active';
    const semanticallyQualified = observation!.semanticConfidence === 'high'
      && observation!.reviewStatus === 'reviewed';
    const status = current && semanticallyQualified ? 'accepted' : 'downgraded';
    if (status === 'downgraded') {
      diagnostics.push({
        code: 'RELATION_PROPOSAL_DOWNGRADED',
        message: `${key} is ambient because execution-changing relations require current evidence, high semantic confidence, and reviewed status.`,
        ids: [proposal.directiveId, proposal.observationId],
      });
    }
    decisions.push({
      directiveId: proposal.directiveId,
      observationId: proposal.observationId,
      relation: status === 'downgraded' ? 'ambient-only' : proposal.relation === 'supports' ? 'reinforce' : 'tension',
      status,
      impact: status === 'downgraded' ? 'ambient-context' : proposal.relation === 'supports' ? 'review-focus' : 'execution-mode',
      reason: status === 'downgraded'
        ? 'Host relation was structurally valid but the RCCL evidence, semantic-confidence, or review gate did not qualify it to change execution.'
        : `Host-proposed ${proposal.relation} relation accepted after ID, scope, proposal-confidence, evidence, semantic-confidence, and review gates.`,
      proposedBy: 'host-agent',
      evidenceRefs,
      rationale: proposal.rationale.trim(),
      confidence,
      proposalKind: proposal.relation,
    });
  }

  for (const directive of directives) {
    for (const observation of observations) {
      const key = `${directive.id}::${observation.id}`;
      if (proposalPairs.has(key) || !semanticKeysOverlap(directive.id, observation.id)) continue;
      if (observationDisposition(observation) === 'demote-to-ambient') continue;
      decisions.push({
        directiveId: directive.id,
        observationId: observation.id,
        relation: 'ambient-only',
        status: 'accepted',
        impact: 'ambient-context',
        reason: 'Deterministic semantic-key overlap shortlisted this verified observation as context; it cannot change execution without a host proposal.',
        proposedBy: 'runtime-structural',
        evidenceRefs: observationEvidenceRefs(observation),
        rationale: 'Structural ID overlap recalled this observation as ambient context.',
        confidence: null,
      });
    }
  }
  return decisions.sort((left, right) => left.directiveId.localeCompare(right.directiveId) || left.observationId.localeCompare(right.observationId));
}

function resolveExecutionModes(
  directives: EffectiveDirective[],
  relations: RelationDecision[],
): Map<string, ExecutionMode> {
  const result = new Map<string, ExecutionMode>();
  for (const directive of directives) {
    const tension = relations.some((relation) =>
      relation.directiveId === directive.id
      && relation.status === 'accepted'
      && relation.relation === 'tension'
      && relation.impact === 'execution-mode');
    if (tension && directive.effectivePrescription === 'must') result.set(directive.id, 'deviation-noted');
    else result.set(directive.id, directive.effectivePrescription === 'must' ? 'enforce' : 'ambient');
  }
  return result;
}

function buildEffectiveGuidance(
  directives: EffectiveDirective[],
  observations: RcclObservation[],
  executionModes: Map<string, ExecutionMode>,
  relations: RelationDecision[],
  task: NormalizedTaskContext,
): EffectiveGuidance {
  const required: GuidanceItem[] = task.constraints.map(taskConstraintGuidance);
  const consider: GuidanceItem[] = [];
  const avoid: AvoidGuidanceItem[] = task.avoid.map(taskAvoidGuidance);

  // RCCL is observational. Even an evidence-current anti-pattern remains
  // ambient until a Playbook directive and accepted host relation make a
  // prescriptive consequence explicit.
  for (const observation of observations) {
    consider.push(observationGuidanceItem(observation));
  }
  for (const directive of directives) {
    const mode = executionModes.get(directive.id) ?? 'ambient';
    if (directive.type === 'anti-pattern') {
      avoid.push(directiveAvoidItem(directive));
      continue;
    }
    if (mode === 'suppress') continue;
    const item = directiveGuidanceItem(directive, mode, directiveRelevance(directive, mode, relations), task);
    if (mode === 'enforce' || mode === 'deviation-noted') required.push(item);
    else consider.push(item);
  }
  return {
    required: uniqueById(required),
    consider: uniqueById(consider),
    avoid: uniqueById(avoid),
    tensions: buildTensions(relations, directives, observations),
  };
}

function taskConstraintGuidance(constraint: string): GuidanceItem {
  const id = `task-constraint:${stableHash([constraint])}`;
  return {
    id,
    instruction: constraint,
    rationale: 'Explicit task constraint supplied by the user or host.',
    exceptions: [],
    source: { kind: 'task', id: 'task-context' },
    relevance: 'Explicit constraints have precedence for this task.',
    executionMode: 'enforce',
    verification: [
      { kind: 'diff', description: `Inspect the final diff for compliance with ${id}.` },
      { kind: 'semantic', description: `Explain how the implementation satisfies the explicit constraint: ${constraint}` },
    ],
    examples: [],
  };
}

function taskAvoidGuidance(pattern: string): AvoidGuidanceItem {
  return {
    id: `task-avoid:${stableHash([pattern])}`,
    pattern,
    rationale: 'Explicit behavior to avoid for this task.',
    exceptions: [],
    source: { kind: 'task', id: 'task-context' },
    verification: [{ kind: 'diff', description: 'Inspect the final diff for the explicitly avoided behavior.' }],
  };
}

function directiveGuidanceItem(
  directive: EffectiveDirective,
  mode: ExecutionMode,
  relevance: string,
  task: NormalizedTaskContext,
): GuidanceItem {
  return {
    id: directive.id,
    instruction: directive.description,
    rationale: directive.effectiveRationale,
    exceptions: directive.effectiveExceptions,
    source: {
      kind: directive.source.kind === 'local-addition' ? 'local-playbook' : 'builtin-playbook',
      id: directive.source.layerId,
      path: directive.source.filePath,
    },
    relevance,
    executionMode: mode,
    verification: verificationForDirective(directive, task),
    examples: directive.effectiveExamples,
  };
}

function directiveAvoidItem(directive: EffectiveDirective): AvoidGuidanceItem {
  return {
    id: directive.id,
    pattern: directive.description,
    rationale: directive.effectiveRationale,
    exceptions: directive.effectiveExceptions,
    source: {
      kind: directive.source.kind === 'local-addition' ? 'local-playbook' : 'builtin-playbook',
      id: directive.source.layerId,
      path: directive.source.filePath,
    },
    verification: [{ kind: 'diff', description: `Inspect the change for the prohibited pattern described by ${directive.id}.` }],
  };
}

function observationGuidanceItem(observation: RcclObservation): GuidanceItem {
  const current = observation.evidenceVerification.status === 'current';
  return {
    id: `rccl:${observation.id}`,
    instruction: observation.statement,
    rationale: `${observation.decisionImpact} Affects: ${observation.affects.join(', ')}. Evidence status is ${observation.evidenceVerification.status}; semantic confidence is ${observation.semanticConfidence}; review status is ${observation.reviewStatus}.`,
    exceptions: [],
    source: { kind: 'rccl', id: observation.id, evidenceRefs: observationEvidenceRefs(observation) },
    relevance: 'The observation scope or evidence overlaps the current task.',
    executionMode: 'ambient',
    verification: [{
      kind: 'diff',
      description: current
        ? 'Check whether the change crosses or depends on this evidence-current repository boundary.'
        : 'Treat this as ambient only; do not use it to justify execution changes until evidence is refreshed.',
    }],
    examples: [],
  };
}

function buildTensions(
  relations: RelationDecision[],
  directives: EffectiveDirective[],
  observations: RcclObservation[],
): DecisionTension[] {
  const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  return relations.flatMap((relation) => {
    if (relation.status !== 'accepted' || relation.relation !== 'tension') return [];
    const directive = directiveById.get(relation.directiveId);
    const observation = observationById.get(relation.observationId);
    if (!directive || !observation) return [];
    return [{
      id: `tension:${stableHash([relation.directiveId, relation.observationId, relation.proposalKind])}`,
      directiveId: directive.id,
      observationId: observation.id,
      conflict: `${directive.description} is limited by repository reality: ${observation.statement}`,
      resolution: relation.proposalKind === 'limits'
        ? 'Apply the directive within the observed boundary and preserve the existing interface where the boundary still applies.'
        : 'Follow the directive for new work while preserving compatibility at the observed boundary; record an exception if the boundary must be crossed.',
      evidenceRefs: relation.evidenceRefs,
      proposedBy: relation.proposedBy,
    }];
  });
}

function verificationForDirective(directive: EffectiveDirective, task: NormalizedTaskContext): VerificationRequirement[] {
  const result: VerificationRequirement[] = [{ kind: 'diff', description: `Inspect the final diff for evidence that ${directive.id} was applied.` }];
  if (directive.type === 'architecture' || directive.traits?.compatibility_sensitive || directive.traits?.migration_sensitive) {
    result.push({ kind: 'semantic', description: `Explain how the implementation satisfies ${directive.id} at affected boundaries.` });
  }
  if (task.techStack.includes('typescript') || task.techStack.includes('javascript')) result.push({ kind: 'command', commandId: 'typecheck', description: 'Run the project typecheck command.' });
  if ((directive.traits?.safety_critical || task.changeType === 'bugfix' || task.changeType === 'feature' || task.changeType === 'migration' || task.risk === 'high')
    && !result.some((item) => item.kind === 'command' && item.commandId === 'test')) {
    result.push({ kind: 'command', commandId: 'test', description: 'Run the relevant automated tests.' });
  }
  if (directive.traits?.broad_scope && (task.scope === 'cross-module' || task.scope === 'repository') && !result.some((item) => item.kind === 'semantic')) {
    result.push({ kind: 'semantic', description: `Explain how ${directive.id} remains valid across the declared ${task.scope} change scope.` });
  }
  return result;
}

function buildVerificationPlan(guidance: EffectiveGuidance): VerificationPlan {
  const commands = new Map<string, string>();
  const semanticChecks: VerificationPlan['semanticChecks'] = [];
  for (const item of [...guidance.required, ...guidance.consider]) {
    for (const requirement of item.verification) {
      if (requirement.kind === 'command' && requirement.commandId) commands.set(requirement.commandId, requirement.description);
      if (requirement.kind === 'semantic') semanticChecks.push({ guidanceId: item.id, description: requirement.description });
    }
  }
  return { commands: [...commands.entries()].map(([id, reason]) => ({ id, reason })), semanticChecks };
}

function directiveRelevance(directive: EffectiveDirective, mode: ExecutionMode, relations: RelationDecision[]): string {
  const relation = relations.find((item) => item.directiveId === directive.id && item.status !== 'rejected');
  if (relation) return `${relation.reason} Final execution mode: ${mode}.`;
  return `${directive.source.layerId} and ${directive.scope.path} match the current task. Final execution mode: ${mode}.`;
}

function proposalEvidenceMatchesObservation(evidenceRefs: string[], observation: RcclObservation): boolean {
  const known = new Set(observation.evidence.flatMap((evidence) => [
    evidence.file,
    `${evidence.file}:${evidence.lineRange[0]}-${evidence.lineRange[1]}`,
  ]));
  return evidenceRefs.every((ref) => known.has(ref));
}

function semanticKeysOverlap(left: string, right: string): boolean {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return [...leftTokens].some((token) => rightTokens.has(token));
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
}

function compareDirectives(left: EffectiveDirective, right: EffectiveDirective): number {
  if (left.effectivePrescription !== right.effectivePrescription) return left.effectivePrescription === 'must' ? -1 : 1;
  const layer = getDirectiveLayerRank(right.source.layerId) - getDirectiveLayerRank(left.source.layerId);
  if (layer) return layer;
  const weight = WEIGHT_RANK[right.effectiveWeight] - WEIGHT_RANK[left.effectiveWeight];
  if (weight) return weight;
  if (left.overrideApplied !== right.overrideApplied) return left.overrideApplied ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function requiredInterpretationFields(task: NormalizedTaskContext): Array<'changeType' | 'targets' | 'uncertainties'> {
  const result: Array<'changeType' | 'targets' | 'uncertainties'> = [];
  if (task.changeType === 'unknown') result.push('changeType');
  if (!task.targets.length) result.push('targets');
  if (task.uncertainties.length) result.push('uncertainties');
  return result;
}

function guidanceIds(guidance: EffectiveGuidance): string[] {
  return [
    ...guidance.required.map((item) => item.id),
    ...guidance.consider.map((item) => item.id),
    ...guidance.avoid.map((item) => item.id),
    ...guidance.tensions.map((item) => item.id),
  ];
}

function observationEvidenceRefs(observation: RcclObservation): string[] {
  return observation.evidence.map((evidence) => `${evidence.file}:${evidence.lineRange[0]}-${evidence.lineRange[1]}`);
}

function directiveFingerprintInput(directive: EffectiveDirective): unknown {
  return {
    id: directive.id,
    type: directive.type,
    declaredLayer: directive.layer,
    sourceKind: directive.source.kind,
    sourceLayerId: directive.source.layerId,
    scope: directive.scope.path,
    prescription: directive.effectivePrescription,
    weight: directive.effectiveWeight,
    instruction: directive.description,
    rationale: directive.effectiveRationale,
    exceptions: directive.effectiveExceptions,
    examples: directive.effectiveExamples,
    rcclImmune: Boolean(directive.rccl_immune),
    traits: directive.traits ?? {},
    overrideApplied: directive.overrideApplied,
    augmentApplied: directive.augmentApplied,
  };
}

function observationFingerprintInput(observation: RcclObservation): unknown {
  return {
    id: observation.id,
    category: observation.category,
    scope: observation.scope,
    statement: observation.statement,
    affects: observation.affects,
    decisionImpact: observation.decisionImpact,
    semanticConfidence: observation.semanticConfidence,
    reviewStatus: observation.reviewStatus,
    evidence: observation.evidence,
    evidenceStatus: observation.evidenceVerification.status,
    verifiedCount: observation.evidenceVerification.verifiedCount,
    totalCount: observation.evidenceVerification.totalCount,
    lifecycleStatus: observation.lifecycle.status,
    supersededBy: observation.lifecycle.supersededBy ?? null,
  };
}

function relationFingerprintInput(relation: RelationDecision): unknown {
  return {
    directiveId: relation.directiveId,
    observationId: relation.observationId,
    relation: relation.relation,
    proposalKind: relation.proposalKind ?? null,
    status: relation.status,
    impact: relation.impact,
    reason: relation.reason,
    rationale: relation.rationale,
    evidenceRefs: relation.evidenceRefs,
    confidence: relation.confidence,
    proposedBy: relation.proposedBy,
  };
}

function relationProposalFingerprintInput(proposal: RelationProposal): unknown {
  return {
    directiveId: proposal.directiveId,
    observationId: proposal.observationId,
    relation: proposal.relation,
    rationale: typeof proposal.rationale === 'string' ? proposal.rationale.trim() : '',
    evidenceRefs: Array.isArray(proposal.evidenceRefs) ? proposal.evidenceRefs.map(String) : [],
    confidence: proposal.confidence ?? 0.85,
  };
}

function observationDisposition(observation: RcclObservation): 'keep' | 'keep-with-reduced-confidence' | 'demote-to-ambient' {
  if (observation.evidenceVerification.status === 'current') return 'keep';
  if (observation.evidenceVerification.status === 'partial') return 'keep-with-reduced-confidence';
  return 'demote-to-ambient';
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function validateRelationProposals(value: unknown): RelationProposal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('compileChange relationProposals must be an array.');
  if (value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('compileChange relationProposals entries must be objects.');
  }
  return value as RelationProposal[];
}
