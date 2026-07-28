import { verifyObservationEvidence } from '../../rccl/runtime.ts';
import type { RcclDocument, RcclObservation } from '../../rccl/runtime.ts';
import {
  assertUniqueDirectiveIds,
  discoverBuiltinLayers,
  loadDirectiveFile,
  loadLocalPlaybook,
  loadPersonalPlaybook,
  resolveExtendedLayers,
  validateLocalReferences,
  validatePersonalReferences,
} from '../load/load-playbook.ts';
import { loadRccl } from '../load/load-rccl.ts';
import { normalizeTaskContext, taskNeedsInterpretation } from '../task/normalize.ts';
import type { NormalizedTaskContext } from '../task/types.ts';
import type {
  Directive,
  DirectiveExample,
  ExecutionMode,
  LocalPlaybook,
  PersonalPlaybook,
} from '../types.ts';
import { stableHash } from '../utils/hash.ts';
import { scopeOverlapsPath } from '../utils/paths.ts';
import {
  applyGuidanceDelivery,
  DEFAULT_GUIDANCE_BYTE_LIMIT,
  serializedBytes,
} from './budget.ts';
import {
  DECISION_SCHEMA_VERSION,
  type AvoidGuidanceItem,
  type ChangeDecisionPacket,
  type CompileChangeInput,
  type CompileChangeOutput,
  type DecisionDiagnostic,
  type DecisionTension,
  type DecisionTrace,
  type DirectiveActivationSummary,
  type EffectiveGuidance,
  type GuidanceItem,
  type RelationProposal,
  type VerificationPlan,
  type VerificationRequirement,
} from './types.ts';
import {
  buildActivationSummary,
  directiveMatchesTask,
} from './activation.ts';
import { buildAttestationPlan } from './attestation.ts';

interface EffectiveDirective extends Directive {
  effectivePrescription: Directive['prescription'];
  effectiveWeight: Directive['weight'];
  effectiveRationale: string;
  effectiveExceptions: string[];
  effectiveExamples: DirectiveExample[];
  executionExample?: DirectiveExample;
  executionExampleAuthority?: 'team' | 'personal';
  overrideApplied: boolean;
  augmentApplied: boolean;
  personalAugmentApplied: boolean;
  authority: 'team' | 'personal' | 'builtin';
}

interface RelationDecision {
  directiveId: string;
  observationId: string;
  relation: 'reinforce' | 'tension' | 'ambient-only';
  status: 'accepted' | 'rejected' | 'downgraded';
  impact: 'execution-mode' | 'review-focus' | 'ambient-context' | 'no-effect';
  reason: string;
  proposedBy: 'host-agent';
  evidenceRefs: string[];
  rationale: string;
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
  if (loaded.activation.configuredBySource.team.length
    && !loaded.activation.activeBySource.team.length) {
    diagnostics.push({
      code: 'TEAM_PLAYBOOK_NO_ACTIVE_DIRECTIVES',
      message: 'The Team Playbook is present, but no team-authored directive is active for the normalized task targets and selected layers.',
      ids: loaded.activation.configuredBySource.team,
    });
  }
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
  const builtGuidance = buildEffectiveGuidance(
    loaded.directives,
    loaded.relevantObservations,
    executionModes,
    relationDecisions,
    task,
  );
  const guidanceByteLimit = input.guidanceByteLimit ?? DEFAULT_GUIDANCE_BYTE_LIMIT;
  const delivery = applyGuidanceDelivery(
    builtGuidance.guidance,
    guidanceByteLimit,
    input.deliverySelection,
  );
  if (delivery.status === 'overflow') {
    return {
      schemaVersion: DECISION_SCHEMA_VERSION,
      status: 'guidance-overflow',
      mode,
      task,
      ...delivery.overflow,
      candidateDetails: builtGuidance.details.filter((item) => item.section === 'consider'),
      diagnostics,
    };
  }
  if (delivery.selection) {
    diagnostics.push({
      code: 'GUIDANCE_SELECTION_APPLIED',
      message: `Explicit delivery selection included ${delivery.guidance.consider.length} of ${builtGuidance.guidance.consider.length} optional consider item(s).`,
      ids: delivery.guidance.consider.map((item) => item.id),
    });
  }

  const deliveredGuidanceIds = guidanceIds(delivery.guidance);
  const verificationPlan = buildVerificationPlan(delivery.guidance);
  const attestationPlan = buildAttestationPlan(delivery.guidance);
  const relationTrace = relationDecisions.map((relation) => ({
    directiveId: relation.directiveId,
    observationId: relation.observationId,
    relation: relation.relation,
    status: relation.status,
    impact: relation.impact,
    reason: relation.reason,
    rationale: relation.rationale,
    evidenceRefs: relation.evidenceRefs,
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
    delivery: stableHash([
      guidanceByteLimit,
      delivery.selection,
      delivery.guidance,
      delivery.executionGuidance,
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
    guidance: delivery.guidance,
    executionGuidance: delivery.executionGuidance,
    verificationPlan,
    attestationPlan,
    trace: {
      selectedLayers: loaded.selectedLayers,
      playbookSources: loaded.playbookSources,
      activation: loaded.activation,
      activatedDirectiveIds: loaded.directives.map((directive) => directive.id),
      deliveredGuidanceIds,
      suppressedDirectiveIds: loaded.suppressedDirectiveIds,
      relevantObservationIds: loaded.relevantObservations.map((observation) => observation.id),
      observationEvidence: loaded.observationVerification,
      relationDecisions: relationTrace,
      guidanceDetails: builtGuidance.details,
      delivery: {
        byteLimit: guidanceByteLimit,
        deliveredBytes: delivery.deliveredBytes,
        mandatoryBytes: delivery.mandatoryBytes,
        fullGuidanceBytes: delivery.fullGuidanceBytes,
        fullPacketBytes: 0,
        selection: delivery.selection,
      },
      omissions: delivery.omissions,
      diagnostics,
    },
    fingerprints,
  };
  stabilizeFullPacketBytes(packet);
  return packet;
}

function stabilizeFullPacketBytes(packet: ChangeDecisionPacket): void {
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const actualBytes = serializedBytes(packet);
    if (packet.trace.delivery.fullPacketBytes === actualBytes) return;
    packet.trace.delivery.fullPacketBytes = actualBytes;
  }
  throw new Error('Unable to stabilize compileChange full packet byte diagnostics.');
}

async function loadGovernanceSources(input: CompileChangeInput, task: NormalizedTaskContext): Promise<{
  selectedLayers: string[];
  playbookSources: {
    team: 'present' | 'absent';
    personal: 'present' | 'absent';
  };
  directives: EffectiveDirective[];
  activation: DirectiveActivationSummary;
  rccl: RcclDocument | null;
  relevantObservations: RcclObservation[];
  observationVerification: ObservationVerificationRecord[];
  suppressedDirectiveIds: string[];
}> {
  const builtinLayers = discoverBuiltinLayers(input.builtinRoot);
  const local = loadLocalPlaybook(input.localAugmentPath);
  const personal = loadPersonalPlaybook(input.personalOverlayPath);
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
  assertUniqueDirectiveIds([
    ...allBuiltins,
    ...(local?.additions ?? []),
    ...(personal?.additions ?? []),
  ]);
  validateLocalReferences(local, allBuiltins);
  validatePersonalReferences(personal, [...allBuiltins, ...(local?.additions ?? [])]);
  const suppressedDirectiveIds = selectedBuiltins
    .filter((directive) => local?.suppresses.some((item) => item.id === directive.id))
    .filter((directive) => directiveMatchesTask(directive, task))
    .map((directive) => directive.id)
    .sort();
  const teamDirectives = applyTeamPlaybook(
    [...selectedBuiltins, ...(local?.additions ?? [])],
    local,
  );
  const personalDirectives = (personal?.additions ?? []).map(personalDirective);
  const candidateDirectives = applyPersonalPlaybook(
    [...teamDirectives, ...personalDirectives],
    personal,
  );
  const directives = candidateDirectives
    .filter((directive) => directiveMatchesTask(directive, task))
    .sort(compareDirectives);
  const activation = buildActivationSummary({
    task,
    activeDirectives: directives,
    candidateDirectives,
    local,
    personal,
  });

  const loadedRccl = await loadRccl(input.rcclPath);
  if (!loadedRccl) {
    return {
      selectedLayers,
      playbookSources: {
        team: local ? 'present' : 'absent',
        personal: personal ? 'present' : 'absent',
      },
      directives,
      activation,
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
    playbookSources: {
      team: local ? 'present' : 'absent',
      personal: personal ? 'present' : 'absent',
    },
    directives,
    activation,
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

function applyTeamPlaybook(directives: Directive[], local: LocalPlaybook | null): EffectiveDirective[] {
  const overrideById = new Map(local?.overrides.map((item) => [item.supersedes, item]) ?? []);
  const augmentById = new Map(local?.augments.map((item) => [item.id, item]) ?? []);
  const suppressed = new Set(local?.suppresses.map((item) => item.id) ?? []);
  return directives.flatMap((directive) => {
    if (suppressed.has(directive.id)) return [];
    const override = overrideById.get(directive.id);
    const augment = augmentById.get(directive.id);
    const teamAuthored = directive.source.kind === 'local-addition'
      || Boolean(override)
      || Boolean(augment);
    return [{
      ...directive,
      effectivePrescription: override?.prescription ?? directive.prescription,
      effectiveWeight: override?.weight ?? directive.weight,
      effectiveRationale: override?.rationale ?? directive.rationale,
      effectiveExceptions: override?.exceptions ?? directive.exceptions ?? [],
      effectiveExamples: augment ? [...directive.examples, ...augment.examples] : directive.examples,
      executionExample: augment?.examples[0]
        ?? (directive.source.kind === 'local-addition' ? directive.examples[0] : undefined),
      executionExampleAuthority: augment
        ? 'team'
        : directive.source.kind === 'local-addition'
          ? 'team'
          : undefined,
      overrideApplied: Boolean(override),
      augmentApplied: Boolean(augment),
      personalAugmentApplied: false,
      authority: teamAuthored ? 'team' : 'builtin',
    }];
  });
}

function personalDirective(directive: Directive): EffectiveDirective {
  return {
    ...directive,
    effectivePrescription: directive.prescription,
    effectiveWeight: directive.weight,
    effectiveRationale: directive.rationale,
    effectiveExceptions: directive.exceptions ?? [],
    effectiveExamples: directive.examples,
    executionExample: directive.examples[0],
    executionExampleAuthority: 'personal',
    overrideApplied: false,
    augmentApplied: false,
    personalAugmentApplied: false,
    authority: 'personal',
  };
}

function applyPersonalPlaybook(
  directives: EffectiveDirective[],
  personal: PersonalPlaybook | null,
): EffectiveDirective[] {
  const augmentById = new Map(personal?.augments.map((item) => [item.id, item]) ?? []);
  return directives.map((directive) => {
    const augment = augmentById.get(directive.id);
    if (!augment) return directive;
    return {
      ...directive,
      effectiveExamples: [...directive.effectiveExamples, ...augment.examples],
      executionExample: directive.executionExample ?? augment.examples[0],
      executionExampleAuthority: directive.executionExampleAuthority ?? 'personal',
      personalAugmentApplied: true,
    };
  });
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
    if ('confidence' in proposal) errors.push('numeric confidence is unsupported; provide a concrete rationale and exact evidence references');
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
        : `Host-proposed ${proposal.relation} relation accepted after ID, scope, evidence, semantic-confidence, and review gates.`,
      proposedBy: 'host-agent',
      evidenceRefs,
      rationale: proposal.rationale.trim(),
      proposalKind: proposal.relation,
    });
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
): {
  guidance: EffectiveGuidance;
  details: DecisionTrace['guidanceDetails'];
} {
  const required: GuidanceItem[] = [];
  const consider: GuidanceItem[] = [];
  const avoid: AvoidGuidanceItem[] = [];
  const details: DecisionTrace['guidanceDetails'] = [];

  for (const constraint of task.constraints) {
    const item = taskConstraintGuidance(constraint);
    required.push(item);
    details.push({
      id: item.id,
      section: 'required',
      rationale: 'Explicit task constraint supplied by the user or host.',
      relevance: 'Explicit task constraints apply directly to this change.',
      source: { ...item.source },
      contributors: [{ kind: 'task', id: 'task-context' }],
      examples: [],
    });
  }
  for (const pattern of task.avoid) {
    const item = taskAvoidGuidance(pattern);
    avoid.push(item);
    details.push({
      id: item.id,
      section: 'avoid',
      rationale: 'Explicit behavior to avoid for this task.',
      relevance: 'Explicit task exclusions apply directly to this change.',
      source: { ...item.source },
      contributors: [{ kind: 'task', id: 'task-context' }],
      examples: [],
    });
  }

  for (const directive of directives) {
    const mode = executionModes.get(directive.id) ?? 'ambient';
    const relevance = directiveRelevance(directive, mode, relations);
    if (directive.type === 'anti-pattern') {
      const item = directiveAvoidItem(directive);
      avoid.push(item);
      details.push(directiveGuidanceDetail(directive, 'avoid', relevance));
      continue;
    }
    const section = mode === 'enforce' || mode === 'deviation-noted'
      ? 'required'
      : 'consider';
    const item = directiveGuidanceItem(directive, mode, task);
    if (section === 'required') required.push(item);
    else consider.push(item);
    details.push(directiveGuidanceDetail(directive, section, relevance));
  }

  // RCCL is observational. Even an evidence-current anti-pattern remains
  // ambient until a Playbook directive and accepted host relation make a
  // prescriptive consequence explicit.
  for (const observation of observations) {
    const item = observationGuidanceItem(observation);
    consider.push(item);
    details.push(observationGuidanceDetail(observation, item));
  }

  const tensionResult = buildTensions(relations, directives, observations);
  details.push(...tensionResult.details);
  return {
    guidance: {
      required: uniqueById(required),
      consider: uniqueById(consider),
      avoid: uniqueById(avoid),
      tensions: tensionResult.tensions,
    },
    details: uniqueById(details),
  };
}

function taskConstraintGuidance(constraint: string): GuidanceItem {
  const id = `task-constraint:${stableHash([constraint])}`;
  return {
    id,
    instruction: constraint,
    exceptions: [],
    source: { kind: 'task', id: 'task-context' },
    executionMode: 'enforce',
    verification: [
      { kind: 'diff' },
      { kind: 'semantic' },
    ],
  };
}

function taskAvoidGuidance(pattern: string): AvoidGuidanceItem {
  return {
    id: `task-avoid:${stableHash([pattern])}`,
    pattern,
    exceptions: [],
    source: { kind: 'task', id: 'task-context' },
    verification: [{ kind: 'diff' }],
  };
}

function directiveGuidanceItem(
  directive: EffectiveDirective,
  mode: ExecutionMode,
  task: NormalizedTaskContext,
): GuidanceItem {
  const source = directiveGuidanceSource(directive);
  const exampleSource = directive.executionExampleAuthority === 'team'
    ? { kind: 'local-playbook' as const, id: 'team-overlay' }
    : directive.executionExampleAuthority === 'personal'
      ? { kind: 'personal-playbook' as const, id: 'personal-overlay' }
      : null;
  return {
    id: directive.id,
    instruction: directive.description,
    exceptions: directive.effectiveExceptions,
    source,
    executionMode: mode,
    verification: verificationForDirective(directive, task),
    ...(directive.executionExample ? { example: directive.executionExample } : {}),
    ...(exampleSource && exampleSource.kind !== source.kind ? { exampleSource } : {}),
  };
}

function directiveAvoidItem(directive: EffectiveDirective): AvoidGuidanceItem {
  return {
    id: directive.id,
    pattern: directive.description,
    exceptions: directive.effectiveExceptions,
    source: directiveGuidanceSource(directive),
    verification: [{ kind: 'diff' }],
  };
}

function observationGuidanceItem(observation: RcclObservation): GuidanceItem {
  return {
    id: `rccl:${observation.id}`,
    instruction: observation.statement,
    exceptions: [],
    source: { kind: 'rccl', id: observation.id },
    executionMode: 'ambient',
    verification: [{ kind: 'diff' }],
  };
}

function directiveGuidanceSource(directive: EffectiveDirective): GuidanceItem['source'] {
  if (directive.authority === 'team') {
    return { kind: 'local-playbook', id: 'team-overlay' };
  }
  if (directive.authority === 'personal') {
    return { kind: 'personal-playbook', id: 'personal-overlay' };
  }
  return {
    kind: 'builtin-playbook',
    id: directive.source.layerId,
  };
}

function directiveGuidanceDetail(
  directive: EffectiveDirective,
  section: 'required' | 'consider' | 'avoid',
  relevance: string,
): DecisionTrace['guidanceDetails'][number] {
  const source = directiveGuidanceSource(directive);
  return {
    id: directive.id,
    section,
    rationale: directive.effectiveRationale,
    relevance,
    source: {
      ...source,
      logicalPath: directive.authority === 'team'
        ? 'team-playbook'
        : directive.authority === 'personal'
          ? 'personal-playbook'
          : directive.source.layerId,
    },
    contributors: directiveContributors(directive),
    examples: directive.effectiveExamples,
  };
}

function directiveContributors(
  directive: EffectiveDirective,
): DecisionTrace['guidanceDetails'][number]['contributors'] {
  const base = directive.source.kind === 'local-addition'
    ? { kind: 'local-playbook' as const, id: 'team-overlay', logicalPath: 'team-playbook' }
    : directive.source.kind === 'personal-addition'
      ? { kind: 'personal-playbook' as const, id: 'personal-overlay', logicalPath: 'personal-playbook' }
      : { kind: 'builtin-playbook' as const, id: directive.source.layerId, logicalPath: directive.source.layerId };
  const contributors = [base];
  if ((directive.overrideApplied || directive.augmentApplied)
    && !contributors.some((item) => item.kind === 'local-playbook')) {
    contributors.push({
      kind: 'local-playbook',
      id: 'team-overlay',
      logicalPath: 'team-playbook',
    });
  }
  if (directive.personalAugmentApplied
    && !contributors.some((item) => item.kind === 'personal-playbook')) {
    contributors.push({
      kind: 'personal-playbook',
      id: 'personal-overlay',
      logicalPath: 'personal-playbook',
    });
  }
  return contributors;
}

function observationGuidanceDetail(
  observation: RcclObservation,
  item: GuidanceItem,
): DecisionTrace['guidanceDetails'][number] {
  return {
    id: item.id,
    section: 'consider',
    rationale: `${observation.decisionImpact} Affects: ${observation.affects.join(', ')}. Evidence status is ${observation.evidenceVerification.status}; semantic confidence is ${observation.semanticConfidence}; review status is ${observation.reviewStatus}.`,
    relevance: 'The observation scope or evidence overlaps the current task.',
    source: {
      ...item.source,
      logicalPath: observation.scope,
      evidenceRefs: observationEvidenceRefs(observation),
    },
    contributors: [{
      kind: 'rccl',
      id: observation.id,
      logicalPath: observation.scope,
    }],
    examples: [],
  };
}

function buildTensions(
  relations: RelationDecision[],
  directives: EffectiveDirective[],
  observations: RcclObservation[],
): {
  tensions: DecisionTension[];
  details: DecisionTrace['guidanceDetails'];
} {
  const directiveById = new Map(directives.map((directive) => [directive.id, directive]));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const tensions: DecisionTension[] = [];
  const details: DecisionTrace['guidanceDetails'] = [];
  for (const relation of relations) {
    if (relation.status !== 'accepted' || relation.relation !== 'tension') continue;
    const directive = directiveById.get(relation.directiveId);
    const observation = observationById.get(relation.observationId);
    if (!directive || !observation) continue;
    const tension: DecisionTension = {
      id: `tension:${stableHash([relation.directiveId, relation.observationId, relation.proposalKind])}`,
      directiveId: directive.id,
      observationId: observation.id,
      conflict: `${directive.description} is limited by repository reality: ${observation.statement}`,
      resolution: relation.proposalKind === 'limits'
        ? 'Apply the directive within the observed boundary and preserve the existing interface where the boundary still applies.'
        : 'Follow the directive for new work while preserving compatibility at the observed boundary; record an exception if the boundary must be crossed.',
    };
    tensions.push(tension);
    details.push({
      id: tension.id,
      section: 'tension',
      rationale: relation.rationale,
      relevance: relation.reason,
      source: {
        kind: 'rccl',
        id: observation.id,
        logicalPath: observation.scope,
        evidenceRefs: relation.evidenceRefs,
      },
      contributors: [
        ...directiveContributors(directive),
        { kind: 'rccl', id: observation.id, logicalPath: observation.scope },
      ],
      examples: [],
    });
  }
  return {
    tensions: uniqueById(tensions),
    details: uniqueById(details),
  };
}

function verificationForDirective(directive: EffectiveDirective, task: NormalizedTaskContext): VerificationRequirement[] {
  const result: VerificationRequirement[] = [{ kind: 'diff' }];
  if (directive.type === 'architecture' || directive.traits?.compatibility_sensitive || directive.traits?.migration_sensitive) {
    result.push({ kind: 'semantic' });
  }
  if (task.techStack.includes('typescript') || task.techStack.includes('javascript')) {
    result.push({ kind: 'command', commandId: 'typecheck' });
  }
  if ((directive.traits?.safety_critical || task.changeType === 'bugfix' || task.changeType === 'feature' || task.changeType === 'migration' || task.risk === 'high')
    && !result.some((item) => item.kind === 'command' && item.commandId === 'test')) {
    result.push({ kind: 'command', commandId: 'test' });
  }
  if (directive.traits?.broad_scope && (task.scope === 'cross-module' || task.scope === 'repository') && !result.some((item) => item.kind === 'semantic')) {
    result.push({ kind: 'semantic' });
  }
  return result;
}

function buildVerificationPlan(guidance: EffectiveGuidance): VerificationPlan {
  const commands = new Map<string, string>();
  const semanticChecks: VerificationPlan['semanticChecks'] = [];
  for (const item of [...guidance.required, ...guidance.consider]) {
    for (const requirement of item.verification) {
      if (requirement.kind === 'command' && requirement.commandId) {
        commands.set(
          requirement.commandId,
          requirement.description ?? `Run ${requirement.commandId} for delivered guidance.`,
        );
      }
      if (requirement.kind === 'semantic') {
        semanticChecks.push({
          guidanceId: item.id,
          description: requirement.description ?? `Explain how the implementation satisfies ${item.id}.`,
        });
      }
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

function compareDirectives(left: EffectiveDirective, right: EffectiveDirective): number {
  const authority = directiveDeliveryGroup(left) - directiveDeliveryGroup(right);
  if (authority) return authority;
  return left.id.localeCompare(right.id);
}

function directiveDeliveryGroup(directive: EffectiveDirective): number {
  if (directive.authority === 'team') return 0;
  if (directive.authority === 'personal') return 1;
  if (directive.source.layerId.startsWith('builtin/task-types/')) return 2;
  if ([
    'builtin/languages/',
    'builtin/frameworks/',
    'builtin/domains/',
  ].some((prefix) => directive.source.layerId.startsWith(prefix))) return 3;
  if (directive.source.layerId === 'builtin/core') return 4;
  return 5;
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
    personalAugmentApplied: directive.personalAugmentApplied,
    authority: directive.authority,
    executionExampleAuthority: directive.executionExampleAuthority ?? null,
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
    hasUnsupportedConfidence: 'confidence' in proposal,
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
