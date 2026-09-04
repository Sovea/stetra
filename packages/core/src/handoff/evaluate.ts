import type { AdoptionConcern, TaskContract } from '../delegation/types.ts';
import { validateFactBundle } from '../facts/validate.ts';
import type { CheckFact, FactBundle } from '../facts/types.ts';
import {
  assertProtocol,
  isNonEmptyString,
  isSha256,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
} from '../shared/protocol.ts';
import type {
  CognitiveHandoff,
  ConcernFinding,
  EvaluateHandoffInput,
  HandoffAttentionItem,
  HandoffEvaluation,
  HandoffEvidenceReference,
  HandoffValidationIssue,
  HumanDecision,
} from './types.ts';
import { HandoffValidationError } from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;

export function evaluateHandoff(input: EvaluateHandoffInput): HandoffEvaluation {
  assertProtocol(input, 'evaluateHandoff');
  validateContract(input.contract);
  validateFactBundle(input.factBundle, input.contract);
  const facts = input.factBundle;
  if (input.currentWorktreeFingerprint !== facts.current.fingerprint) {
    return {
      ...ENVELOPE,
      status: 'facts-stale',
      effectiveContractId: input.contract.effectiveContractId,
      attemptId: facts.attemptId,
      factCollectionId: facts.factCollectionId,
      attention: [],
      concernEvidence: [],
      adoption: { authority: 'human', status: 'pending' },
    };
  }

  const issues: HandoffValidationIssue[] = [];
  validateHandoff(input.handoff, input.contract, facts, issues);
  const concernEvidence = evaluateConcernEvidence(input.contract, facts, input.handoff, issues);
  const attention = buildAttention(input.contract, facts, input.handoff, concernEvidence);
  if (input.handoff.recommendation.action === 'accept'
    && attention.some((item) => item.blockingRecommendation)) {
    issues.push(issue(
      'accept-recommendation-exceeds-evidence',
      'handoff.recommendation.action',
      'Agent acceptance advice cannot exceed current blocking evidence.',
      'Use request-correction, reject, or defer until blocking evidence changes.',
    ));
  }
  if (issues.length) throw new HandoffValidationError(issues);

  const adoption = input.decision
    ? validateDecision(input.decision, input.contract, facts, input.handoff, attention)
    : { authority: 'human' as const, status: 'pending' as const };
  return {
    ...ENVELOPE,
    status: attention.length ? 'needs-attention' : 'handoff-ready',
    effectiveContractId: input.contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    attention,
    concernEvidence,
    adoption,
  };
}

function validateContract(contract: TaskContract): void {
  assertProtocol(contract, 'evaluateHandoff Task Contract');
  if (!isSha256(contract.contractId) || !isSha256(contract.semanticContractId)
    || !isSha256(contract.verificationPlanId) || !isSha256(contract.effectiveContractId)) {
    throw new Error('Task Contract identities are invalid.');
  }
  const { contractId: _ignored, ...projection } = contract;
  const semanticProjection = {
    humanEvents: contract.humanEvents,
    interpretation: contract.interpretation,
    assurance: contract.assurance,
  };
  const humanEvent = contract.humanEvents?.[0];
  const humanIdentity = humanEvent ? {
    kind: humanEvent.kind,
    content: humanEvent.content,
    capture: humanEvent.capture,
  } : undefined;
  if (contract.contractId !== stableFingerprint(projection)
    || contract.semanticContractId !== stableFingerprint(semanticProjection)
    || contract.effectiveContractId !== stableFingerprint({
      semanticContractId: contract.semanticContractId,
      verificationPlanId: contract.verificationPlanId,
    })
    || contract.verificationPlanId !== stableFingerprint(contract.verificationPlan)
    || contract.humanEvents.length !== 1
    || !humanEvent
    || humanEvent.kind !== 'task'
    || humanEvent.capture !== 'unattested-input'
    || !isNonEmptyString(humanEvent.content)
    || humanEvent.contentFingerprint !== sha256(humanEvent.content)
    || humanEvent.id !== `human:${sha256(JSON.stringify(humanIdentity)).slice('sha256:'.length)}`
    || contract.interpretation.authority !== 'agent-judgment'
    || stableFingerprint(contract.interpretation.basisHumanEventIds)
      !== stableFingerprint([humanEvent.id])) {
    throw new Error('Task Contract fingerprints are invalid.');
  }
}

function validateHandoff(
  handoff: CognitiveHandoff,
  contract: TaskContract,
  facts: FactBundle,
  issues: HandoffValidationIssue[],
): void {
  if (!handoff || typeof handoff !== 'object') {
    issues.push(issue('handoff-invalid', 'handoff', 'Handoff must be an object.', 'Author the compact current-fact Handoff.'));
    return;
  }
  if (handoff.protocol !== contract.protocol || handoff.schemaVersion !== contract.schemaVersion
    || handoff.effectiveContractId !== contract.effectiveContractId
    || handoff.attemptId !== facts.attemptId
    || handoff.factCollectionId !== facts.factCollectionId
    || !isStableId(handoff.handoffId)
    || !isSha256(handoff.handoffFingerprint)) {
    issues.push(issue('handoff-binding-invalid', 'handoff', 'Handoff is not bound to the current Contract and facts.', 'Re-author the Handoff from current facts.'));
    return;
  }
  const { handoffFingerprint: _ignored, ...projection } = handoff;
  if (handoff.handoffFingerprint !== stableFingerprint(projection)) {
    issues.push(issue('handoff-fingerprint-invalid', 'handoff.handoffFingerprint', 'Handoff fingerprint is invalid.', 'Do not edit a materialized Handoff.'));
  }
  if (!isNonEmptyString(handoff.actualChange?.behavior)
    || !nonEmptyStrings(handoff.actualChange?.mechanism, true)
    || !nonEmptyStrings(handoff.actualChange?.preservedInvariants)
    || !nonEmptyStrings(handoff.actualChange?.failureAndRecovery)
    || !nonEmptyStrings(handoff.actualChange?.importantEffects)
    || !nonEmptyStrings(handoff.actualChange?.materialTradeoffs)) {
    issues.push(issue('actual-change-invalid', 'handoff.actualChange', 'Actual change requires behavior and at least one mechanism; optional fields must contain non-empty text.', 'Explain only material current behavior and mechanism.'));
  }
  if (!Array.isArray(handoff.concernFindings)
    || !Array.isArray(handoff.residualUnknowns)
    || !Array.isArray(handoff.reviewFocus)) {
    issues.push(issue('handoff-sections-invalid', 'handoff', 'Handoff collections must be arrays.', 'Use the compact Handoff schema.'));
    return;
  }
  for (const [index, unknown] of handoff.residualUnknowns.entries()) {
    if (!isNonEmptyString(unknown.statement)
      || (unknown.nextAction !== undefined && !isNonEmptyString(unknown.nextAction))) {
      issues.push(issue('unknown-invalid', `handoff.residualUnknowns[${index}]`, 'Unknown requires a statement and optional concrete next action.', 'Remove empty unknown fields.'));
    }
    validateEvidence(unknown.evidence, facts, `handoff.residualUnknowns[${index}].evidence`, issues);
  }
  for (const [index, focus] of handoff.reviewFocus.entries()) {
    if (!isNonEmptyString(focus.question) || !isNonEmptyString(focus.adoptionImpact)
      || !isNonEmptyString(focus.nextAction)) {
      issues.push(issue('review-focus-invalid', `handoff.reviewFocus[${index}]`, 'Review focus requires question, adoption impact, and next action.', 'Keep only consequence-directed review items.'));
    }
    validateEvidence(focus.evidence, facts, `handoff.reviewFocus[${index}].evidence`, issues);
  }
  if (!['accept', 'request-correction', 'reject', 'defer'].includes(handoff.recommendation?.action)
    || !isNonEmptyString(handoff.recommendation?.rationale)
    || !nonEmptyStrings(handoff.recommendation?.caveats)) {
    issues.push(issue('recommendation-invalid', 'handoff.recommendation', 'Recommendation requires an action, rationale, and non-empty caveats.', 'Provide one evidence-bounded recommendation.'));
  }
}

function evaluateConcernEvidence(
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  issues: HandoffValidationIssue[],
): HandoffEvaluation['concernEvidence'] {
  const concerns = contract.assurance.mode === 'consequential'
    ? contract.assurance.concerns : [];
  const findings = new Map<string, ConcernFinding>();
  for (const [index, finding] of handoff.concernFindings.entries()) {
    if (!isStableId(finding.concernId) || findings.has(finding.concernId)
      || !['supported', 'partial', 'contradicted', 'unknown'].includes(finding.status)
      || !isNonEmptyString(finding.summary) || !nonEmptyStrings(finding.gaps)) {
      issues.push(issue('concern-finding-invalid', `handoff.concernFindings[${index}]`, 'Concern finding is invalid or duplicated.', 'Conclude each declared concern exactly once.'));
      continue;
    }
    validateEvidence(finding.evidence, facts, `handoff.concernFindings[${index}].evidence`, issues);
    findings.set(finding.concernId, finding);
  }
  if (!concerns.length && handoff.concernFindings.length) {
    issues.push(issue('routine-concern-findings-forbidden', 'handoff.concernFindings', 'Routine tasks cannot add undeclared concern findings.', 'Remove concern findings from this routine Handoff.'));
  }
  const concernEvidence = concerns.map((concern) => {
    const finding = findings.get(concern.id);
    if (!finding) {
      issues.push(issue('concern-finding-missing', 'handoff.concernFindings', `Handoff omits concern ${concern.key}.`, 'Conclude the declared concern.'));
    }
    const missing = concern.evidenceRequirements.filter((requirement) =>
      !requirementSatisfied(requirement, finding, facts));
    if (finding?.status === 'supported' && missing.length) {
      issues.push(issue(
        'concern-support-exceeds-evidence',
        `handoff.concernFindings.${concern.key}`,
        `Concern ${concern.key} is supported but its declared evidence path is incomplete.`,
        'Use partial or unknown, cite the passing Check, or complete the required Human review.',
      ));
    }
    return { concernId: concern.id, complete: missing.length === 0, missing };
  });
  for (const finding of handoff.concernFindings) {
    if (!concerns.some((concern) => concern.id === finding.concernId)) {
      issues.push(issue('concern-finding-unknown', 'handoff.concernFindings', `Unknown concern ${finding.concernId}.`, 'Use only declared concerns.'));
    }
  }
  return concernEvidence;
}

function requirementSatisfied(
  requirement: AdoptionConcern['evidenceRequirements'][number],
  finding: ConcernFinding | undefined,
  facts: FactBundle,
): boolean {
  if (!finding) return false;
  if (requirement.kind === 'human-review') return false;
  const check = facts.checks.find((item) => item.verifierId === requirement.verifierId);
  return latestCheck(check)?.status === 'passed'
    && finding.evidence.some((reference) =>
      reference.kind === 'check' && reference.id === check?.definitionId);
}

function buildAttention(
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  concernEvidence: HandoffEvaluation['concernEvidence'],
): HandoffAttentionItem[] {
  const attention: HandoffAttentionItem[] = [];
  const nonpassing = facts.checks.filter((check) => latestCheck(check)?.status !== 'passed');
  if (nonpassing.length) attention.push(attentionItem({
    code: 'verification-nonpassing',
    message: `${nonpassing.length} frozen Check(s) are not passing.`,
    blockingRecommendation: true,
    references: { definitionIds: nonpassing.map((check) => check.definitionId).sort() },
    resolution: 'repair',
  }));
  if (facts.verifierMutations.length) attention.push(attentionItem({
    code: 'verifier-surface-changed',
    message: `${facts.verifierMutations.length} declared verifier surface match(es) changed.`,
    blockingRecommendation: false,
    references: {
      changedFileIds: unique(facts.verifierMutations.map((item) => item.changedFileId)),
      definitionIds: unique(facts.verifierMutations.map((item) => item.definitionId)),
    },
    resolution: 'inspect',
  }));
  if (facts.checkInducedChanges.length) attention.push(attentionItem({
    code: 'check-induced-change',
    message: `${facts.checkInducedChanges.length} worktree change(s) were induced while checks ran.`,
    blockingRecommendation: false,
    references: { changedFileIds: facts.checkInducedChanges.map((file) => file.id).sort() },
    resolution: 'inspect',
  }));
  const unrepresentable = facts.changedFiles.filter((file) => file.representation === 'unrepresentable');
  if (unrepresentable.length) attention.push(attentionItem({
    code: 'change-unrepresentable',
    message: `${unrepresentable.length} change(s) cannot be represented as an inspectable text patch.`,
    blockingRecommendation: false,
    references: { changedFileIds: unrepresentable.map((file) => file.id).sort() },
    resolution: 'inspect',
  }));
  if (handoff.residualUnknowns.length) attention.push(attentionItem({
    code: 'residual-unknown',
    message: `${handoff.residualUnknowns.length} residual unknown(s) remain.`,
    blockingRecommendation: false,
    references: {},
    resolution: 'acknowledge',
  }));
  const incomplete = concernEvidence.filter((item) => !item.complete);
  if (incomplete.length) attention.push(attentionItem({
    code: 'concern-evidence-missing',
    message: `${incomplete.length} Adoption Concern evidence path(s) are incomplete.`,
    blockingRecommendation: false,
    references: { concernIds: incomplete.map((item) => item.concernId).sort() },
    resolution: 'human-review',
  }));
  const unsupported = contract.assurance.mode === 'consequential'
    ? handoff.concernFindings.filter((finding) => finding.status !== 'supported') : [];
  if (unsupported.length) attention.push(attentionItem({
    code: 'concern-not-supported',
    message: `${unsupported.length} Adoption Concern finding(s) are not supported.`,
    blockingRecommendation: true,
    references: { concernIds: unsupported.map((item) => item.concernId).sort() },
    resolution: 'repair',
  }));
  return attention.sort((left, right) => left.code.localeCompare(right.code));
}

function validateDecision(
  decision: HumanDecision,
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  attention: HandoffAttentionItem[],
): HandoffEvaluation['adoption'] {
  assertProtocol(decision, 'evaluateHandoff Human Decision');
  if (!isStableId(decision.decisionId)
    || decision.effectiveContractId !== contract.effectiveContractId
    || decision.attemptId !== facts.attemptId
    || decision.factCollectionId !== facts.factCollectionId
    || decision.handoffId !== handoff.handoffId
    || decision.handoffFingerprint !== handoff.handoffFingerprint
    || !['accepted', 'correction-requested', 'rejected', 'deferred'].includes(decision.action)
    || !isNonEmptyString(decision.reason)
    || !Array.isArray(decision.acknowledgedAttentionIds)) {
    throw new Error('Human Decision is not valid for the current Handoff.');
  }
  if (!isStableId(decision.humanEvent?.id)
    || decision.humanEvent.kind !== (decision.action === 'correction-requested' ? 'correction' : 'decision')
    || decision.humanEvent.capture !== 'unattested-input'
    || !isNonEmptyString(decision.humanEvent.content)
    || decision.humanEvent.contentFingerprint !== sha256(decision.humanEvent.content)
    || decision.humanEvent.id !== humanEventId(decision.humanEvent)) {
    throw new Error('Human Decision event is invalid.');
  }
  const attentionIds = new Set(attention.map((item) => item.id));
  const acknowledged = new Set(decision.acknowledgedAttentionIds);
  if (acknowledged.size !== decision.acknowledgedAttentionIds.length
    || decision.acknowledgedAttentionIds.some((id) => !attentionIds.has(id))) {
    throw new Error('Human Decision acknowledges an unknown or repeated Attention item.');
  }
  if (decision.action === 'accepted') {
    const missing = attention.filter((item) => !acknowledged.has(item.id));
    if (missing.length) {
      throw new Error('Accepted Human Decision must acknowledge every current Attention item.');
    }
  }
  return { authority: 'human', status: decision.action, decisionId: decision.decisionId };
}

function humanEventId(event: HumanDecision['humanEvent']): string {
  const identity = {
    kind: event.kind,
    content: event.content,
    capture: event.capture,
  };
  return `human:${sha256(JSON.stringify(identity)).slice('sha256:'.length)}`;
}

function validateEvidence(
  evidence: HandoffEvidenceReference[],
  facts: FactBundle,
  path: string,
  issues: HandoffValidationIssue[],
): void {
  if (!Array.isArray(evidence)) {
    issues.push(issue('evidence-invalid', path, 'Evidence must be an array.', 'Use current changed-file, Check, or patch references.'));
    return;
  }
  const seen = new Set<string>();
  for (const [index, reference] of evidence.entries()) {
    const key = reference?.kind === 'patch' ? 'patch' : `${reference?.kind}:${reference?.id}`;
    const valid = reference?.kind === 'patch'
      ? Boolean(facts.patch)
      : reference?.kind === 'changed-file'
        ? facts.changedFiles.some((file) => file.id === reference.id)
        : reference?.kind === 'check'
          ? facts.checks.some((check) => check.definitionId === reference.id)
          : false;
    if (!valid || seen.has(key)) {
      issues.push(issue('evidence-reference-invalid', `${path}[${index}]`, 'Evidence reference is unknown or repeated.', 'Use a unique reference from the current Fact Collection.'));
    }
    seen.add(key);
  }
}

function latestCheck(check: CheckFact | undefined): CheckFact['attempts'][number] | undefined {
  return check?.attempts.at(-1);
}

function attentionItem(
  source: Omit<HandoffAttentionItem, 'id'>,
): HandoffAttentionItem {
  return { id: `attention:${stableFingerprint(source).slice('sha256:'.length)}`, ...source };
}

function nonEmptyStrings(value: unknown, requireOne = false): value is string[] {
  return Array.isArray(value) && (!requireOne || value.length > 0)
    && value.every((item) => isNonEmptyString(item));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function issue(
  code: string,
  path: string,
  message: string,
  remediation: string,
): HandoffValidationIssue {
  return { code, path, message, remediation };
}
