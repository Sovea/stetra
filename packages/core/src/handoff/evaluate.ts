import { validateCompiledContract } from '../delegation/compile.ts';
import type { EvidenceObligation, TaskContract } from '../delegation/types.ts';
import { validateFactBundle } from '../facts/validate.ts';
import type { FactBundle } from '../facts/types.ts';
import {
  assertProtocol,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSha256,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  sortedUnique,
  stableFingerprint,
  sha256,
} from '../shared/protocol.ts';
import {
  HandoffValidationError,
  type AdoptionConditionConclusion,
  type CognitiveHandoff,
  type ConclusionStatus,
  type EvaluateHandoffInput,
  type EvidenceObligationConclusion,
  type HandoffAttentionCode,
  type HandoffAttentionItem,
  type HandoffEvidenceReference,
  type HandoffEvaluation,
  type HandoffValidationIssue,
  type HostPolicyEvaluation,
  type HumanDecision,
  type ResidualUnknown,
  type ReviewQuestion,
} from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;

export function evaluateHandoff(input: EvaluateHandoffInput): HandoffEvaluation {
  assertProtocol(input, 'evaluateHandoff');
  validateCompiledContract(input.contract);
  validateFactBundle(input.factBundle, input.contract);
  if (input.currentWorktreeFingerprint !== input.factBundle.current.fingerprint) {
    return {
      ...ENVELOPE,
      status: 'facts-stale',
      effectiveContractId: input.contract.effectiveContractId,
      attemptId: input.factBundle.attemptId,
      factCollectionId: input.factBundle.factCollectionId,
      requiredChallengeObligationIds: [],
      attention: [],
      adoption: { authority: 'human', status: 'pending' },
    };
  }

  validateChallenges(input);
  validateCurrentEvidenceDisposition(input);
  validateHostPolicyEvaluations(input.contract, input.hostPolicyEvaluations);
  const requiredChallengeObligationIds = requiredChallenges(input.contract, input.factBundle);
  const handoff = validateHandoff(
    input.handoff,
    input.contract,
    input.factBundle,
    input.challenges,
    requiredChallengeObligationIds,
  );
  const attention = deriveAttention(input, handoff, requiredChallengeObligationIds);
  validateRecommendationConsistency(input, handoff, requiredChallengeObligationIds);
  const decision = input.decision
    ? validateDecision(input.decision, handoff, input.contract, input.factBundle, attention)
    : undefined;
  return {
    ...ENVELOPE,
    status: attention.length ? 'needs-attention' : 'handoff-ready',
    effectiveContractId: input.contract.effectiveContractId,
    attemptId: input.factBundle.attemptId,
    factCollectionId: input.factBundle.factCollectionId,
    requiredChallengeObligationIds,
    attention,
    adoption: decision
      ? { authority: 'human', status: decision.action, decisionId: decision.decisionId }
      : { authority: 'human', status: 'pending' },
  };
}

export function requiredChallenges(contract: TaskContract, facts: FactBundle): string[] {
  const changedVerifierIds = new Set(
    facts.verifierMutations
      .filter((mutation) => mutation.selector.role === 'acceptance-surface')
      .map((mutation) => mutation.verifierId),
  );
  return sortedUnique(allObligations(contract).flatMap((obligation) => {
    const challengeStrategies = obligation.strategies.filter((strategy) =>
      strategy.kind === 'independent-challenge');
    if (challengeStrategies.some((strategy) => strategy.policy === 'required')) {
      return [obligation.id];
    }
    const factTriggered = challengeStrategies.some((strategy) =>
      strategy.policy === 'fact-triggered');
    const changedOwnVerifier = obligation.strategies.some((strategy) =>
      strategy.kind === 'runtime-check'
      && strategy.verifierIds.some((id) => changedVerifierIds.has(id)));
    return factTriggered && changedOwnVerifier ? [obligation.id] : [];
  }));
}

function validateCurrentEvidenceDisposition(input: EvaluateHandoffInput): void {
  const disposition = input.currentEvidenceDisposition;
  if (!disposition) return;
  const definitionIds = new Set(input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.map((item) => item.definitionId) : []);
  const challengeIds = new Set(input.challenges.map((item) => item.id));
  if (disposition.protocol !== input.protocol
    || disposition.schemaVersion !== input.schemaVersion
    || !isSha256(disposition.dispositionId)
    || disposition.effectiveContractId !== input.contract.effectiveContractId
    || disposition.attemptId !== input.factBundle.attemptId
    || disposition.factCollectionId !== input.factBundle.factCollectionId
    || !['none', 'material'].includes(disposition.semanticImpact)
    || !['repair-implementation', 'revise-verification', 'challenge', 'handoff', 'ask-human'].includes(disposition.proposedRoute)
    || !isNonEmptyString(disposition.routeRationale)
    || !['repair-implementation', 'revise-verification', 'challenge', 'handoff', 'ask-human'].includes(disposition.route)
    || !Array.isArray(disposition.entries) || !disposition.entries.length) {
    throw new Error('evaluateHandoff current evidence disposition identity is invalid.');
  }
  const selected = new Set<string>();
  for (const entry of disposition.entries) {
    const sourceValid = entry.source.kind === 'check'
      ? definitionIds.has(entry.source.definitionId)
      : challengeIds.has(entry.source.challengeId);
    const sourceIdentity = entry.source.kind === 'check'
      ? `check:${entry.source.definitionId}`
      : `challenge:${entry.source.challengeId}`;
    if (!sourceValid || selected.has(sourceIdentity)
      || !['implementation', 'environment', 'verification', 'unknown'].includes(entry.cause)
      || !isNonEmptyString(entry.diagnosis)
      || !isNonEmptyString(entry.falsificationAttempt)
      || typeof entry.codeChangeCanAlterObservation !== 'boolean'
      || !isNonEmptyString(entry.expectedDifferentObservation)
      || !Array.isArray(entry.intendedChanges)
      || entry.intendedChanges.some((item) => !isNonEmptyString(item))) {
      throw new Error('evaluateHandoff current evidence disposition entry is invalid.');
    }
    selected.add(sourceIdentity);
  }
  const compatibleRoutes: Record<string, string[]> = {
    implementation: ['repair-implementation', 'handoff'],
    environment: ['revise-verification', 'handoff'],
    verification: ['revise-verification', 'handoff'],
    unknown: ['challenge', 'handoff', 'ask-human'],
  };
  const hasImplementationCause = disposition.entries.some((entry) =>
    entry.cause === 'implementation');
  const proposedRouteValid = disposition.semanticImpact === 'material'
    ? disposition.proposedRoute === 'ask-human'
    : disposition.entries.every((entry) =>
        (entry.source.kind !== 'challenge' || disposition.proposedRoute !== 'challenge')
        && (compatibleRoutes[entry.cause]?.includes(disposition.proposedRoute)
        || (disposition.proposedRoute === 'repair-implementation'
          && hasImplementationCause
          && ['environment', 'verification'].includes(entry.cause))));
  const effectiveRouteValid = disposition.route === disposition.proposedRoute
    || (input.deliveryExhausted
      && disposition.proposedRoute === 'repair-implementation'
      && disposition.route === 'handoff');
  if (!proposedRouteValid || !effectiveRouteValid) {
    throw new Error('evaluateHandoff current evidence disposition route is incompatible with its declared causes.');
  }
  const { dispositionId: _ignored, ...projection } = disposition;
  if (disposition.dispositionId !== stableFingerprint(projection)) {
    throw new Error('evaluateHandoff current evidence disposition fingerprint is invalid.');
  }
}

function validateChallenges(input: EvaluateHandoffInput): void {
  const obligations = new Map(allObligations(input.contract).map((item) => [item.id, item]));
  const changedFileIds = new Set(input.factBundle.changedFiles.map((item) => item.id));
  const definitionIds = new Set(input.factBundle.checks.map((item) => item.definitionId));
  const evidenceIds = new Set(input.contract.repositoryEvidence.map((item) => item.id));
  const eventIds = new Set(input.contract.authority.developerEvents.map((item) => item.id));
  const challengeIds = new Set<string>();
  const issues: HandoffValidationIssue[] = [];
  for (const [index, challenge] of input.challenges.entries()) {
    const path = `challenges[${index}]`;
    if (!challenge) {
      issues.push(issue('challenge-object-required', path, 'Challenge must be an object.', 'Use the current Challenge Execution Packet.'));
      continue;
    }
    const selected = challenge?.obligationIds?.map((id) => obligations.get(id));
    const expectedConditions = sortedUnique((selected ?? []).flatMap((item) => item ? [item.conditionId] : []));
    if (challenge.protocol !== input.protocol || challenge.schemaVersion !== input.schemaVersion) {
      issues.push(issue('challenge-protocol-invalid', path, 'Challenge protocol identity is invalid.', 'Use the active protocol and schema from the current Authoring Packet.'));
    }
    if (!isStableId(challenge.id) || challengeIds.has(challenge.id)) {
      issues.push(issue('challenge-id-invalid', `${path}.id`, 'Challenge id is invalid or duplicated.', 'Use the Runtime-generated challenge id exactly once.'));
    } else {
      challengeIds.add(challenge.id);
    }
    if (challenge.effectiveContractId !== input.contract.effectiveContractId
      || challenge.attemptId !== input.factBundle.attemptId
      || challenge.factCollectionId !== input.factBundle.factCollectionId) {
      issues.push(issue('challenge-binding-invalid', path, 'Challenge is not bound to the current contract, Attempt, and facts.', 'Regenerate it from the current Challenge Execution Packet.'));
    }
    if (!Array.isArray(challenge.obligationIds) || !challenge.obligationIds.length
      || new Set(challenge.obligationIds).size !== challenge.obligationIds.length
      || selected.some((item) => !item)) {
      issues.push(issue('challenge-obligation-reference-invalid', `${path}.obligationIds`, 'Challenge obligations are missing, duplicated, or not part of the current contract.', 'Use exact obligation ids from the current Challenge Execution Packet.'));
    }
    if (!Array.isArray(challenge.conditionIds)
      || stableFingerprint(challenge.conditionIds) !== stableFingerprint(expectedConditions)) {
      issues.push(issue('challenge-condition-binding-invalid', `${path}.conditionIds`, 'Challenge conditions do not match the selected obligations.', 'Use the Runtime-derived condition bindings.'));
    }
    if (!['host-attested', 'unverified'].includes(challenge.independence)
      || !validIndependence(challenge)) {
      issues.push(issue('challenge-independence-invalid', `${path}.independence`, 'Challenge independence and its attestation fields are inconsistent.', 'Use the Host-provided independence values without modification.'));
    }
    validateChallengeFalsification(challenge.falsification, selected, `${path}.falsification`, issues);
    if (!isNonEmptyString(challenge.falsificationAttempt)) {
      issues.push(issue('challenge-falsification-required', `${path}.falsificationAttempt`, 'A concrete falsification attempt is required.', 'Describe the independent attempt to expose the failure.'));
    }
    if (!isNonEmptyString(challenge.observedResult)) {
      issues.push(issue('challenge-observed-result-required', `${path}.observedResult`, 'The challenge observation is required.', 'State what the falsification attempt actually observed.'));
    }
    if (!['supported', 'partial', 'contradicted', 'unknown'].includes(challenge.outcome)) {
      issues.push(issue('challenge-outcome-invalid', `${path}.outcome`, 'Challenge outcome is invalid.', 'Use supported, partial, contradicted, or unknown.'));
    }
    if (challenge.outcome === 'supported'
      && Array.isArray(challenge.counterEvidence)
      && challenge.counterEvidence.length > 0) {
      issues.push(issue(
        'challenge-supported-with-counter-evidence',
        `${path}.counterEvidence`,
        'A supported Challenge cannot retain counter-evidence.',
        'Preserve the counter-evidence and use partial, contradicted, or unknown.',
      ));
    }
    if (!isNonEmptyString(challenge.conclusion)) {
      issues.push(issue('challenge-conclusion-required', `${path}.conclusion`, 'A concrete challenge conclusion is required.', 'Explain the bounded result of the challenge.'));
    }
    if (!challenge.evidence) {
      issues.push(issue('challenge-evidence-required', `${path}.evidence`, 'Challenge evidence selection is required.', 'Use the evidence selection from the current Challenge Execution Packet.'));
    } else {
      validateChallengeRefs(challenge.evidence.changedFiles, changedFileIds, `${path}.evidence.changedFiles`, 'changed-file', issues);
      validateChallengeRefs(challenge.evidence.checks, definitionIds, `${path}.evidence.checks`, 'check', issues);
      validateChallengeRefs(challenge.evidence.repositoryEvidence, evidenceIds, `${path}.evidence.repositoryEvidence`, 'repository-evidence', issues);
      validateChallengeRefs(challenge.evidence.humanEvents, eventIds, `${path}.evidence.humanEvents`, 'human-event', issues);
      if (typeof challenge.evidence.patch !== 'boolean'
        || (challenge.evidence.patch && !input.factBundle.patch)) {
        issues.push(issue('challenge-patch-reference-invalid', `${path}.evidence.patch`, 'Challenge patch selection does not match the current facts.', 'Select patch only when the current Fact Bundle contains one.'));
      }
    }
  }
  if (issues.length) throw new HandoffValidationError(issues);
  for (const challenge of input.challenges) {
    validateChallengeEvidenceItems(challenge.supportingEvidence, 'supportingEvidence', input, challengeIds);
    validateChallengeEvidenceItems(challenge.counterEvidence, 'counterEvidence', input, challengeIds);
  }
}

function validateChallengeFalsification(
  value: unknown,
  obligations: Array<EvidenceObligation | undefined>,
  path: string,
  issues: HandoffValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue('challenge-falsification-design-invalid', path, 'Challenge falsification design must be an object.', 'Use the frozen design from the current Challenge Execution Packet.'));
    return;
  }
  exact(value, [
    'failureHypothesis', 'scenario', 'supportingObservation', 'contradictingObservation',
  ], path, issues);
  for (const field of [
    'failureHypothesis', 'scenario', 'supportingObservation', 'contradictingObservation',
  ] as const) {
    text(value[field], `${path}.${field}`, issues);
  }
  const selected = obligations.filter((item): item is EvidenceObligation => Boolean(item));
  if (selected.some((obligation) =>
    stableFingerprint(obligation.falsification) !== stableFingerprint(value))) {
    issues.push(issue('challenge-falsification-design-mismatch', path, 'Challenge must preserve the exact frozen falsification design for every selected obligation.', 'Challenge obligations with different designs separately.'));
  }
}

function validateChallengeRefs(
  value: unknown,
  available: Set<string>,
  path: string,
  kind: string,
  issues: HandoffValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issue('challenge-evidence-references-invalid', path, `${kind} references must be an array.`, `Use exact ${kind} ids from the current Challenge Execution Packet.`));
    return;
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('challenge-evidence-reference-duplicate', path, `${kind} references must be unique.`, 'Remove duplicate references.'));
  }
  for (const [index, reference] of value.entries()) {
    if (typeof reference !== 'string' || !available.has(reference)) {
      issues.push(issue('challenge-evidence-reference-invalid', `${path}[${index}]`, `Unknown current ${kind} identity ${JSON.stringify(reference)}.`, `Use an exact ${kind} id from the current Challenge Execution Packet.`));
    }
  }
}

function validIndependence(challenge: EvaluateHandoffInput['challenges'][number]): boolean {
  if (challenge.independence === 'host-attested') {
    return isStableId(challenge.attestationId)
      && isNonEmptyString(challenge.implementerContextId)
      && isNonEmptyString(challenge.challengerContextId)
      && challenge.implementerContextId !== challenge.challengerContextId;
  }
  if (challenge.attestationId !== undefined) return false;
  return challenge.implementerContextId === undefined
    && challenge.challengerContextId === undefined;
}

function validateChallengeEvidenceItems(
  value: unknown,
  label: string,
  input: EvaluateHandoffInput,
  challengeIds: Set<string>,
): void {
  if (!Array.isArray(value)) throw new Error(`evaluateHandoff challenge ${label} must be an array.`);
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['statement', 'references'])
      || !isNonEmptyString(item.statement) || !Array.isArray(item.references)
      || !item.references.length) {
      throw new Error(`evaluateHandoff challenge ${label} item is invalid.`);
    }
    const issues: HandoffValidationIssue[] = [];
    validateEvidence(item.references, label, input.contract, input.factBundle, challengeIds, issues);
    if (issues.length) throw new Error(`evaluateHandoff challenge ${label} references are invalid.`);
  }
}

function validateHostPolicyEvaluations(
  contract: TaskContract,
  evaluations: HostPolicyEvaluation[],
): void {
  if (!Array.isArray(evaluations)
    || evaluations.length !== contract.hostPolicyRequirements.length) {
    throw new Error('evaluateHandoff host policy evaluations must cover every requirement.');
  }
  const requirementIds = new Set(contract.hostPolicyRequirements.map((item) => item.id));
  const selected = new Set<string>();
  for (const evaluation of evaluations) {
    if (!requirementIds.has(evaluation.requirementId) || selected.has(evaluation.requirementId)
      || !['enforced', 'instruction-only', 'unsupported'].includes(evaluation.mode)
      || !['native-adapter', 'thin-skill', 'evaluation-runner'].includes(evaluation.provenance)
      || (evaluation.mode === 'enforced'
        && (evaluation.provenance === 'thin-skill' || !isStableId(evaluation.attestationId)))
      || (evaluation.mode !== 'enforced' && evaluation.attestationId !== undefined)) {
      throw new Error('evaluateHandoff host policy evaluation is invalid.');
    }
    selected.add(evaluation.requirementId);
  }
}

function validateHandoff(
  value: CognitiveHandoff,
  contract: TaskContract,
  facts: FactBundle,
  challenges: EvaluateHandoffInput['challenges'],
  requiredChallengeObligationIds: string[],
): CognitiveHandoff {
  const issues: HandoffValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new HandoffValidationError([issue('handoff-object-required', '$', 'Cognitive Handoff must be an object.', 'Submit the initial handoff shape.')]);
  }
  exact(value, [
    'protocol', 'schemaVersion', 'handoffId', 'handoffFingerprint', 'effectiveContractId',
    'attemptId', 'factCollectionId', 'summary', 'obligationConclusions',
    'conditionConclusions', 'importantSystemEffects', 'residualUnknowns',
    'reviewQuestions', 'recommendation',
  ], '', issues);
  if (value.protocol !== contract.protocol || value.schemaVersion !== contract.schemaVersion) {
    issues.push(issue('handoff-protocol-invalid', '$', 'Handoff protocol identity is invalid.', 'Use the active protocol and schema.'));
  }
  if (!isStableId(value.handoffId)) issues.push(issue('handoff-id-invalid', 'handoffId', 'Handoff id is invalid.', 'Use the Runtime-generated id.'));
  if (value.effectiveContractId !== contract.effectiveContractId
    || value.attemptId !== facts.attemptId
    || value.factCollectionId !== facts.factCollectionId) {
    issues.push(issue('handoff-binding-invalid', '$', 'Handoff is not bound to the current contract, Attempt, and facts.', 'Regenerate it from the current Authoring Packet.'));
  }
  text(value.summary, 'summary', issues);
  const challengeIds = new Set(challenges.map((item) => item.id));
  const obligationConclusions = validateObligationConclusions(
    value.obligationConclusions, contract, facts, challenges,
    requiredChallengeObligationIds, issues,
  );
  const conditionConclusions = validateConditionConclusions(
    value.conditionConclusions, contract, obligationConclusions, issues,
  );
  const importantSystemEffects = texts(value.importantSystemEffects, 'importantSystemEffects', issues);
  const unknowns = validateUnknowns(value.residualUnknowns, contract, facts, challengeIds, issues);
  const reviewQuestions = validateReviewQuestions(value.reviewQuestions, contract, facts, challengeIds, issues);
  validateReviewCoverage(
    contract, obligationConclusions, conditionConclusions, unknowns,
    reviewQuestions, challenges, requiredChallengeObligationIds, issues,
  );
  const recommendation = validateRecommendation(value.recommendation, issues);
  if (!isSha256(value.handoffFingerprint)) {
    issues.push(issue('handoff-fingerprint-invalid', 'handoffFingerprint', 'Handoff fingerprint is invalid.', 'Regenerate the immutable handoff.'));
  } else {
    const { handoffFingerprint: _ignored, ...projection } = value;
    if (value.handoffFingerprint !== stableFingerprint(projection)) {
      issues.push(issue('handoff-fingerprint-mismatch', 'handoffFingerprint', 'Handoff fingerprint does not match its content.', 'Regenerate the immutable handoff.'));
    }
  }
  if (issues.length) throw new HandoffValidationError(issues);
  return {
    ...value,
    summary: value.summary.trim(),
    obligationConclusions,
    conditionConclusions,
    importantSystemEffects,
    residualUnknowns: unknowns,
    reviewQuestions,
    recommendation: recommendation!,
  };
}

function validateObligationConclusions(
  value: unknown,
  contract: TaskContract,
  facts: FactBundle,
  challenges: EvaluateHandoffInput['challenges'],
  requiredChallengeObligationIds: string[],
  issues: HandoffValidationIssue[],
): EvidenceObligationConclusion[] {
  if (!Array.isArray(value)) {
    issues.push(issue('obligation-conclusions-invalid', 'obligationConclusions', 'Obligation conclusions must be an array.', 'Conclude every evidence obligation exactly once.'));
    return [];
  }
  const obligations = new Map(allObligations(contract).map((item) => [item.id, item]));
  const seen = new Set<string>();
  const challengeIds = new Set(challenges.map((item) => item.id));
  const output: EvidenceObligationConclusion[] = [];
  for (const [index, raw] of value.entries()) {
    const path = `obligationConclusions[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('obligation-conclusion-invalid', path, 'Obligation conclusion must be an object.', 'Replace it with a conclusion.'));
      continue;
    }
    exact(raw, ['obligationId', 'status', 'evidence', 'falsification', 'counterEvidence', 'conclusion'], path, issues);
    const obligationId = typeof raw.obligationId === 'string' ? raw.obligationId : '';
    const obligation = obligations.get(obligationId);
    if (!obligation || seen.has(obligationId)) {
      issues.push(issue('obligation-reference-invalid', `${path}.obligationId`, 'Obligation reference is missing or duplicated.', 'Conclude each current obligation once.'));
    }
    seen.add(obligationId);
    const status = conclusionStatus(raw.status);
    if (!status) issues.push(issue('obligation-status-invalid', `${path}.status`, 'Obligation status is invalid.', 'Use supported, partial, contradicted, or unknown.'));
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, challengeIds, issues);
    const counterEvidence = validateEvidence(raw.counterEvidence, `${path}.counterEvidence`, contract, facts, challengeIds, issues);
    const supportingIdentities = new Set(evidence.map((item) => `${item.kind}:${item.id ?? ''}`));
    if (counterEvidence.some((item) => supportingIdentities.has(`${item.kind}:${item.id ?? ''}`))) {
      issues.push(issue(
        'evidence-polarity-conflict',
        `${path}.counterEvidence`,
        'The same reference cannot be both supporting and counter-evidence.',
        'Keep each exact reference in the array that matches its observed direction.',
      ));
    }
    const falsification = validateConclusionFalsification(
      raw.falsification,
      `${path}.falsification`,
      issues,
    );
    text(raw.conclusion, `${path}.conclusion`, issues);
    if (obligation) {
      requireStrategyEvidence(
        obligation,
        [...evidence, ...counterEvidence],
        contract,
        path,
        issues,
      );
      const obligationChallenges = challenges.filter((item) => item.obligationIds.includes(obligation.id));
      if (status === 'supported' && obligationChallenges.some((item) => item.outcome !== 'supported')) {
        issues.push(issue('challenge-obligation-conflict', `${path}.status`, 'An adverse challenge prevents a supported obligation conclusion.', 'Reflect the challenge outcome.'));
      }
      if (status === 'supported' && requiredChallengeObligationIds.includes(obligation.id)
        && !obligationChallenges.length) {
        issues.push(issue('challenge-obligation-missing', `${path}.status`, 'A required challenge is missing, so this obligation cannot be supported.', 'Use partial, contradicted, or unknown and direct the developer to the unresolved failure hypothesis.'));
      }
      if (status === 'supported' && requiredChallengeObligationIds.includes(obligation.id)
        && obligationChallenges.some((item) => item.independence !== 'host-attested')) {
        issues.push(issue('challenge-independence-unverified', `${path}.status`, 'A required challenge lacks trusted Host independence, so this obligation cannot be supported.', 'Use partial, contradicted, or unknown and direct the developer to review the unresolved failure hypothesis.'));
      }
      if (status === 'supported' && requiredChallengeObligationIds.includes(obligation.id)
        && obligationChallenges.length
        && !evidence.some((item) => item.kind === 'challenge'
          && obligationChallenges.some((challenge) => challenge.id === item.id))) {
        issues.push(issue('challenge-evidence-missing', `${path}.evidence`, 'A completed required challenge must be cited by the obligation conclusion.', 'Reference the exact challenge.'));
      }
    }
    if (issues.length === before && obligation && status && falsification) {
      output.push({
        obligationId,
        status,
        evidence,
        falsification,
        counterEvidence,
        conclusion: String(raw.conclusion).trim(),
      });
    }
  }
  for (const obligation of obligations.values()) {
    if (!seen.has(obligation.id)) {
      issues.push(issue('obligation-conclusion-missing', 'obligationConclusions', `Obligation ${obligation.id} has no conclusion.`, 'Add one conclusion.'));
    }
  }
  return output;
}

function validateConclusionFalsification(
  value: unknown,
  path: string,
  issues: HandoffValidationIssue[],
): EvidenceObligationConclusion['falsification'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('obligation-falsification-invalid', path, 'Obligation falsification result must be an object.', 'State the attempt and its observed result.'));
    return undefined;
  }
  exact(value, ['attempt', 'observedResult'], path, issues);
  text(value.attempt, `${path}.attempt`, issues);
  text(value.observedResult, `${path}.observedResult`, issues);
  return issues.length === before
    ? {
        attempt: String(value.attempt).trim(),
        observedResult: String(value.observedResult).trim(),
      }
    : undefined;
}

function requireStrategyEvidence(
  obligation: EvidenceObligation,
  evidence: HandoffEvidenceReference[],
  contract: TaskContract,
  path: string,
  issues: HandoffValidationIssue[],
): void {
  const selectedChecks = new Set(evidence.filter((item) => item.kind === 'check').map((item) => item.id));
  const selectedRepositoryEvidence = new Set(evidence.filter((item) => item.kind === 'repository-evidence').map((item) => item.id));
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  for (const strategy of obligation.strategies) {
    if (strategy.kind === 'runtime-check') {
      for (const verifierId of strategy.verifierIds) {
        const definition = definitions.find((item) => item.verifierId === verifierId);
        if (!definition || !selectedChecks.has(definition.definitionId)) {
          issues.push(issue('obligation-check-coverage-missing', path, `Obligation omits current verifier ${verifierId}.`, 'Bind the conclusion to the current exact Check Fact.'));
        }
      }
    }
    if (strategy.kind === 'repository-inspection') {
      for (const evidenceId of strategy.repositoryEvidenceIds) {
        if (!selectedRepositoryEvidence.has(evidenceId)) {
          issues.push(issue('obligation-repository-coverage-missing', path, `Obligation omits repository evidence ${evidenceId}.`, 'Bind the conclusion to the planned evidence.'));
        }
      }
    }
  }
}

function validateConditionConclusions(
  value: unknown,
  contract: TaskContract,
  obligationConclusions: EvidenceObligationConclusion[],
  issues: HandoffValidationIssue[],
): AdoptionConditionConclusion[] {
  if (!Array.isArray(value)) {
    issues.push(issue('condition-conclusions-invalid', 'conditionConclusions', 'Condition conclusions must be an array.', 'Conclude every condition exactly once.'));
    return [];
  }
  const conditions = new Map(contract.adoptionConditions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const output: AdoptionConditionConclusion[] = [];
  for (const [index, raw] of value.entries()) {
    const path = `conditionConclusions[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('condition-conclusion-invalid', path, 'Condition conclusion must be an object.', 'Replace it with a conclusion.'));
      continue;
    }
    exact(raw, ['conditionId', 'status', 'summary'], path, issues);
    const conditionId = typeof raw.conditionId === 'string' ? raw.conditionId : '';
    const condition = conditions.get(conditionId);
    if (!condition || seen.has(conditionId)) {
      issues.push(issue('condition-reference-invalid', `${path}.conditionId`, 'Condition reference is missing or duplicated.', 'Conclude each current condition once.'));
    }
    seen.add(conditionId);
    const status = conclusionStatus(raw.status);
    if (!status) issues.push(issue('condition-status-invalid', `${path}.status`, 'Condition status is invalid.', 'Use supported, partial, contradicted, or unknown.'));
    text(raw.summary, `${path}.summary`, issues);
    if (condition && status === 'supported') {
      const statuses = condition.evidenceObligations.map((obligation) =>
        obligationConclusions.find((item) => item.obligationId === obligation.id)?.status);
      if (statuses.some((item) => item !== 'supported')) {
        issues.push(issue('condition-exceeds-obligations', `${path}.status`, 'Condition cannot be supported while any evidence obligation is partial, contradicted, unknown, or missing.', 'Use a bounded non-supported condition status.'));
      }
    }
    if (issues.length === before && condition && status) {
      output.push({ conditionId, status, summary: String(raw.summary).trim() });
    }
  }
  for (const condition of conditions.values()) {
    if (!seen.has(condition.id)) {
      issues.push(issue('condition-conclusion-missing', 'conditionConclusions', `Condition ${condition.id} has no conclusion.`, 'Add one conclusion.'));
    }
  }
  return output;
}

function validateUnknowns(
  value: unknown,
  contract: TaskContract,
  facts: FactBundle,
  challengeIds: Set<string>,
  issues: HandoffValidationIssue[],
): ResidualUnknown[] {
  if (!Array.isArray(value)) {
    issues.push(issue('unknowns-invalid', 'residualUnknowns', 'Residual unknowns must be an array.', 'Supply an array.'));
    return [];
  }
  const conditionIds = new Set(contract.adoptionConditions.map((item) => item.id));
  const obligationIds = new Set(allObligations(contract).map((item) => item.id));
  return value.flatMap((raw, index) => {
    const path = `residualUnknowns[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('unknown-invalid', path, 'Residual unknown must be an object.', 'Replace it with an unknown.'));
      return [];
    }
    exact(raw, ['conditionIds', 'obligationIds', 'statement', 'adoptionImpact', 'nextAction', 'evidence'], path, issues);
    const selectedConditions = refs(raw.conditionIds, `${path}.conditionIds`, conditionIds, issues);
    const selectedObligations = refs(raw.obligationIds, `${path}.obligationIds`, obligationIds, issues);
    if (!selectedConditions.length && !selectedObligations.length) {
      issues.push(issue('unknown-unbound', path, 'Residual unknown must bind a condition or obligation.', 'Select an exact target.'));
    }
    text(raw.statement, `${path}.statement`, issues);
    text(raw.adoptionImpact, `${path}.adoptionImpact`, issues);
    text(raw.nextAction, `${path}.nextAction`, issues);
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, challengeIds, issues);
    return issues.length === before ? [{
      conditionIds: selectedConditions,
      obligationIds: selectedObligations,
      statement: String(raw.statement).trim(),
      adoptionImpact: String(raw.adoptionImpact).trim(),
      nextAction: String(raw.nextAction).trim(),
      evidence,
    }] : [];
  });
}

function validateReviewQuestions(
  value: unknown,
  contract: TaskContract,
  facts: FactBundle,
  challengeIds: Set<string>,
  issues: HandoffValidationIssue[],
): ReviewQuestion[] {
  if (!Array.isArray(value)) {
    issues.push(issue('review-questions-invalid', 'reviewQuestions', 'Review questions must be an array.', 'Supply consequence-directed questions.'));
    return [];
  }
  const conditionIds = new Set(contract.adoptionConditions.map((item) => item.id));
  const obligationIds = new Set(allObligations(contract).map((item) => item.id));
  const questionIds = new Set<string>();
  return value.flatMap((raw, index) => {
    const path = `reviewQuestions[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('review-question-invalid', path, 'Review question must be an object.', 'Replace it with a question.'));
      return [];
    }
    exact(raw, ['id', 'conditionIds', 'obligationIds', 'question', 'adoptionImpact', 'evidence'], path, issues);
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!isStableId(id) || questionIds.has(id)) {
      issues.push(issue('review-question-id-invalid', `${path}.id`, 'Review question id is invalid or duplicated.', 'Use the Runtime-generated id.'));
    }
    questionIds.add(id);
    const selectedConditions = refs(raw.conditionIds, `${path}.conditionIds`, conditionIds, issues);
    const selectedObligations = refs(raw.obligationIds, `${path}.obligationIds`, obligationIds, issues);
    text(raw.question, `${path}.question`, issues);
    text(raw.adoptionImpact, `${path}.adoptionImpact`, issues);
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, challengeIds, issues);
    if (!selectedConditions.length && !selectedObligations.length && !evidence.length) {
      issues.push(issue('review-question-unbound', path, 'Review question selects no decision surface.', 'Bind it to a condition, obligation, or evidence fact.'));
    }
    return issues.length === before ? [{
      id,
      conditionIds: selectedConditions,
      obligationIds: selectedObligations,
      question: String(raw.question).trim(),
      adoptionImpact: String(raw.adoptionImpact).trim(),
      evidence,
    }] : [];
  });
}

function validateReviewCoverage(
  contract: TaskContract,
  obligationConclusions: EvidenceObligationConclusion[],
  conditionConclusions: AdoptionConditionConclusion[],
  unknowns: ResidualUnknown[],
  questions: ReviewQuestion[],
  challenges: EvaluateHandoffInput['challenges'],
  requiredChallengeObligationIds: string[],
  issues: HandoffValidationIssue[],
): void {
  const coveredConditions = new Set(questions.flatMap((item) => item.conditionIds));
  const coveredObligations = new Set(questions.flatMap((item) => item.obligationIds));
  const unknownConditions = new Set(unknowns.flatMap((item) => item.conditionIds));
  const unknownObligations = new Set(unknowns.flatMap((item) => item.obligationIds));
  for (const condition of contract.adoptionConditions) {
    const conclusion = conditionConclusions.find((item) => item.conditionId === condition.id);
    if ((condition.criticality === 'adoption-critical'
        || conclusion?.status !== 'supported'
        || unknownConditions.has(condition.id))
      && !coveredConditions.has(condition.id)) {
      issues.push(issue('review-coverage-missing', 'reviewQuestions', `Condition ${condition.id} requires direct review coverage.`, 'Add a consequence-directed question.'));
    }
    for (const obligation of condition.evidenceObligations) {
      const obligationConclusion = obligationConclusions.find((item) => item.obligationId === obligation.id);
      const obligationChallenges = challenges.filter((item) => item.obligationIds.includes(obligation.id));
      const unresolvedChallenge = requiredChallengeObligationIds.includes(obligation.id)
        && (!obligationChallenges.length
          || obligationChallenges.some((item) => item.outcome !== 'supported')
          || obligationChallenges.some((item) => item.independence !== 'host-attested'));
      const requires = obligation.strategies.some((strategy) => strategy.kind === 'human-review')
        || obligationConclusion?.status !== 'supported'
        || unknownObligations.has(obligation.id)
        || unresolvedChallenge
        || obligationChallenges.some((item) => item.outcome !== 'supported')
        || obligationChallenges.some((item) => item.independence !== 'host-attested');
      if (unresolvedChallenge && !coveredObligations.has(obligation.id)) {
        issues.push(issue('challenge-review-coverage-missing', 'reviewQuestions', `Unresolved challenge for obligation ${obligation.id} requires a directly bound review question.`, 'Add a consequence-directed question that names this exact obligation.'));
      } else if (requires && !coveredObligations.has(obligation.id)
        && !coveredConditions.has(condition.id)) {
        issues.push(issue('review-coverage-missing', 'reviewQuestions', `Obligation ${obligation.id} requires direct review coverage.`, 'Add a consequence-directed question.'));
      }
    }
  }
}

function validateRecommendation(value: unknown, issues: HandoffValidationIssue[]) {
  const path = 'recommendation';
  if (!isRecord(value)) {
    issues.push(issue('recommendation-invalid', path, 'Recommendation must be an object.', 'Supply Agent advice distinct from Human adoption.'));
    return undefined;
  }
  exact(value, ['action', 'rationale', 'caveats'], path, issues);
  const action = ['accept', 'request-correction', 'reject', 'defer'].includes(String(value.action))
    ? value.action as CognitiveHandoff['recommendation']['action'] : undefined;
  if (!action) issues.push(issue('recommendation-action-invalid', `${path}.action`, 'Recommendation action is invalid.', 'Use accept, request-correction, reject, or defer.'));
  text(value.rationale, `${path}.rationale`, issues);
  const caveats = texts(value.caveats, `${path}.caveats`, issues);
  return action && isNonEmptyString(value.rationale)
    ? { action, rationale: value.rationale.trim(), caveats }
    : undefined;
}

function validateEvidence(
  value: unknown,
  path: string,
  contract: TaskContract,
  facts: FactBundle,
  challengeIds: Set<string>,
  issues: HandoffValidationIssue[],
): HandoffEvidenceReference[] {
  if (!Array.isArray(value)) {
    issues.push(issue('evidence-invalid', path, 'Evidence must be an array of exact references.', 'Supply an array.'));
    return [];
  }
  const available = {
    'changed-file': new Set(facts.changedFiles.map((item) => item.id)),
    check: new Set(facts.checks.map((item) => item.definitionId)),
    'repository-evidence': new Set(contract.repositoryEvidence.map((item) => item.id)),
    'human-event': new Set(contract.authority.developerEvents.map((item) => item.id)),
    challenge: challengeIds,
  };
  const output: HandoffEvidenceReference[] = [];
  const identities = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      issues.push(issue('evidence-reference-invalid', itemPath, 'Evidence reference must be an object.', 'Supply kind and exact id.'));
      continue;
    }
    exact(raw, ['kind', 'id'], itemPath, issues);
    const kind = ['changed-file', 'check', 'repository-evidence', 'human-event', 'challenge', 'patch'].includes(String(raw.kind))
      ? raw.kind as HandoffEvidenceReference['kind'] : undefined;
    if (!kind) {
      issues.push(issue('evidence-kind-invalid', `${itemPath}.kind`, 'Evidence kind is invalid.', 'Use an evidence kind from the initial protocol.'));
      continue;
    }
    if (kind === 'patch') {
      if (raw.id !== undefined || !facts.patch) {
        issues.push(issue('patch-reference-invalid', itemPath, 'Patch reference must omit id and requires a collected patch.', 'Reference an available patch.'));
        continue;
      }
    } else if (!isStableId(raw.id) || !available[kind].has(raw.id)) {
      issues.push(issue('evidence-id-invalid', `${itemPath}.id`, 'Evidence id is unavailable.', 'Use an exact current reference.'));
      continue;
    }
    const identity = `${kind}:${raw.id ?? ''}`;
    if (identities.has(identity)) {
      issues.push(issue('evidence-reference-duplicate', itemPath, 'Evidence reference is duplicated.', 'Remove the duplicate.'));
      continue;
    }
    identities.add(identity);
    output.push(kind === 'patch' ? { kind } : { kind, id: raw.id as string });
  }
  return output;
}

function deriveAttention(
  input: EvaluateHandoffInput,
  handoff: CognitiveHandoff,
  requiredChallengeObligationIds: string[],
): HandoffAttentionItem[] {
  const items: HandoffAttentionItem[] = [];
  const nonpassing = input.factBundle.checks.filter((check) => check.attempts.at(-1)?.status !== 'passed');
  const baselineExpectationMismatches = input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.filter((definition) => {
        if (definition.baseline.mode !== 'task-start') return false;
        const baseline = input.factBundle.baselineVerification.checks.find((item) =>
          item.definitionId === definition.definitionId);
        const current = input.factBundle.checks.find((item) =>
          item.definitionId === definition.definitionId);
        if (!baseline || !current
          || !['task-start', 'isolated-original'].includes(baseline.mode)
          || !baseline.observation) return false;
        return baseline.observation.attempts.at(-1)?.status
            !== definition.baseline.expectation.baselineStatus
          || current.attempts.at(-1)?.status
            !== definition.baseline.expectation.currentStatus;
      }) : [];
  const unknownAfterRevision = input.factBundle.checkComparisons.filter((item) =>
    item.relation === 'baseline-unknown-after-revision');
  const verifierDefinitions = sortedUnique(input.factBundle.verifierMutations.map((item) => item.definitionId));
  if (nonpassing.length) {
    items.push(attention('verification', ['verification-nonpassing'], {
      checks: sortedUnique(nonpassing.map((item) => item.definitionId)),
    }, 'inspect'));
  }
  if (baselineExpectationMismatches.length) {
    items.push(attention('verification', ['baseline-expectation-mismatch'], {
      checks: sortedUnique(baselineExpectationMismatches.map((item) => item.definitionId)),
    }, 'inspect'));
  }
  if (unknownAfterRevision.length) {
    items.push(attention('verification', ['baseline-unknown-after-revision'], {
      checks: sortedUnique(unknownAfterRevision.map((item) => item.definitionId)),
    }, 'inspect'));
  }
  if (input.factBundle.verifierMutations.length) {
    items.push(attention('verification', ['verifier-surface-changed'], {
      checks: verifierDefinitions,
      changedFiles: sortedUnique(input.factBundle.verifierMutations.map((item) => item.changedPath)),
    }, 'inspect'));
  }
  if (input.verificationRevised) {
    items.push(attention('verification', ['verification-revised'], {
      checks: sortedUnique(input.factBundle.checks.map((item) => item.definitionId)),
    }, 'inspect'));
  }
  if (input.factBundle.checkInducedChanges.length) {
    items.push(attention('verification', ['check-induced-change'], {
      changedFiles: sortedUnique(input.factBundle.checkInducedChanges.map((item) => item.path)),
    }, 'inspect'));
  }
  if (input.factBundle.baselineVerification.checkInducedChanges.length) {
    items.push(attention('verification', ['baseline-check-induced-change'], {
      changedFiles: sortedUnique(input.factBundle.baselineVerification.checkInducedChanges.map((item) => item.path)),
    }, 'inspect'));
  }
  const unrepresentable = input.factBundle.changedFiles.filter((item) => item.representation === 'unrepresentable');
  if (unrepresentable.length) {
    items.push(attention('change-integrity', ['change-unrepresentable'], {
      changedFiles: unrepresentable.map((item) => item.path),
    }, 'inspect'));
  }
  for (const obligation of allObligations(input.contract)) {
    const challenges = input.challenges.filter((item) => item.obligationIds.includes(obligation.id));
    const references = {
        conditions: [obligation.conditionId],
        obligations: [obligation.id],
        challenges: challenges.map((item) => item.id),
        checks: currentDefinitionIds(obligation, input.contract),
    };
    if (requiredChallengeObligationIds.includes(obligation.id) && !challenges.length) {
      items.push(attention('obligation', ['challenge-missing'], references, 'challenge'));
    }
    if (challenges.some((item) => item.outcome !== 'supported')) {
      items.push(attention('obligation', ['challenge-adverse'], references, 'inspect'));
    }
    if (challenges.some((item) => item.independence !== 'host-attested')) {
      items.push(attention('obligation', ['challenge-independence-unverified'], references, 'inspect'));
    }
    const unresolvedChallenge = requiredChallengeObligationIds.includes(obligation.id)
      && (!challenges.length
        || challenges.some((item) => item.outcome !== 'supported')
        || challenges.some((item) => item.independence !== 'host-attested'));
    if (unresolvedChallenge
      || obligation.strategies.some((strategy) => strategy.kind === 'human-review')) {
      items.push(attention('obligation', ['direct-review-required'], references, 'inspect'));
    }
  }
  const residualTargets = new Map<string, HandoffAttentionItem['references']>();
  for (const unknown of handoff.residualUnknowns) {
    const references = {
      conditions: sortedUnique(unknown.conditionIds),
      obligations: sortedUnique(unknown.obligationIds),
    };
    residualTargets.set(stableFingerprint(references), references);
  }
  for (const references of residualTargets.values()) {
    items.push(attention('condition', ['residual-unknown'], references, 'inspect'));
  }
  const policyById = new Map(input.hostPolicyEvaluations.map((item) => [item.requirementId, item]));
  for (const requirement of input.contract.hostPolicyRequirements) {
    const evaluation = policyById.get(requirement.id)!;
    if (evaluation.mode !== 'enforced') {
      items.push(attention('host-policy', [
        evaluation.mode === 'unsupported' ? 'host-policy-unsupported' : 'host-policy-unverified',
      ], { hostPolicies: [requirement.id] }, requirement.enforcementRequirement === 'required' ? 'resolve' : 'inspect'));
    }
  }
  const currentNonpassing = input.factBundle.checks
    .filter((check) => check.attempts.at(-1)?.status !== 'passed')
    .map((check) => check.definitionId);
  const missingDisposition = currentNonpassing.length > 0 && !input.currentEvidenceDisposition;
  if (missingDisposition) {
    items.push(attention('delivery', ['evidence-disposition-missing'], {
      checks: sortedUnique(currentNonpassing),
    }, 'resolve'));
  }
  if (input.deliveryExhausted) {
    items.push(attention('delivery', ['repair-route-exhausted'], {
      checks: sortedUnique(currentNonpassing),
    }, 'decide-exception'));
  }
  return items.sort((left, right) => left.id.localeCompare(right.id));
}

function validateRecommendationConsistency(
  input: EvaluateHandoffInput,
  handoff: CognitiveHandoff,
  requiredChallengeObligationIds: string[],
): void {
  if (handoff.recommendation.action !== 'accept') return;
  const blockers = new Set<string>();
  if (handoff.conditionConclusions.some((item) => item.status !== 'supported')) {
    blockers.add('condition-not-supported');
  }
  if (handoff.obligationConclusions.some((item) => item.status !== 'supported')) {
    blockers.add('obligation-not-supported');
  }
  if (handoff.residualUnknowns.length) blockers.add('residual-unknown');
  if (input.factBundle.checks.some((check) => check.attempts.at(-1)?.status !== 'passed')) {
    blockers.add('verification-nonpassing');
  }
  if (input.factBundle.changedFiles.some((item) => item.representation === 'unrepresentable')) {
    blockers.add('change-unrepresentable');
  }
  if (input.deliveryExhausted) blockers.add('repair-route-exhausted');
  if (input.challenges.some((item) => item.outcome !== 'supported')) {
    blockers.add('challenge-adverse');
  }
  for (const obligationId of requiredChallengeObligationIds) {
    const challenges = input.challenges.filter((item) =>
      item.obligationIds.includes(obligationId));
    if (!challenges.length) blockers.add('challenge-missing');
    if (challenges.some((item) => item.independence !== 'host-attested')) {
      blockers.add('challenge-independence-unverified');
    }
  }
  const policyById = new Map(input.hostPolicyEvaluations.map((item) =>
    [item.requirementId, item]));
  if (input.contract.hostPolicyRequirements.some((requirement) =>
    requirement.enforcementRequirement === 'required'
    && policyById.get(requirement.id)?.mode !== 'enforced')) {
    blockers.add('host-policy-required-unenforced');
  }
  if (!blockers.size) return;
  throw new HandoffValidationError([issue(
    'recommendation-evidence-conflict',
    'recommendation.action',
    `Agent recommendation cannot be accept while current evidence has: ${[...blockers].sort().join(', ')}.`,
    'Use request-correction, defer, or reject; only an exact later Human decision may accept current exceptions.',
  )]);
}

function validateDecision(
  decision: HumanDecision,
  handoff: CognitiveHandoff,
  contract: TaskContract,
  facts: FactBundle,
  attention: HandoffAttentionItem[],
): HumanDecision {
  if (!decision || decision.protocol !== contract.protocol || decision.schemaVersion !== contract.schemaVersion
    || !isStableId(decision.decisionId)
    || decision.effectiveContractId !== contract.effectiveContractId
    || decision.attemptId !== facts.attemptId
    || decision.factCollectionId !== facts.factCollectionId
    || decision.handoffId !== handoff.handoffId
    || decision.handoffFingerprint !== handoff.handoffFingerprint
    || !['accepted', 'correction-requested', 'rejected', 'deferred'].includes(decision.action)
    || !isNonEmptyString(decision.reason)
    || !Array.isArray(decision.exceptions)
    || !isStableId(decision.humanEvent?.id)
    || !['decision', 'correction'].includes(decision.humanEvent?.kind)
    || !isNonEmptyString(decision.humanEvent?.content)
    || decision.humanEvent.contentFingerprint !== sha256(decision.humanEvent.content)) {
    throw new HandoffValidationError([issue('decision-invalid', 'decision', 'Human Decision is invalid or stale.', 'Bind the exact decision to the current handoff.')]);
  }
  if ((decision.action === 'correction-requested') !== (decision.humanEvent.kind === 'correction')) {
    throw new HandoffValidationError([issue('decision-event-kind-invalid', 'decision.humanEvent.kind', 'Correction requests require correction events; all other decisions require decision events.', 'Preserve the exact developer event with the matching kind.')]);
  }
  const attentionIds = new Set(attention.map((item) => item.id));
  if (new Set(decision.exceptions.map((item) => item.attentionId)).size !== decision.exceptions.length
    || decision.exceptions.some((item) => !attentionIds.has(item.attentionId) || !isNonEmptyString(item.rationale))) {
    throw new HandoffValidationError([issue('decision-exception-invalid', 'decision.exceptions', 'Decision exceptions must uniquely reference current Attention.', 'Reference exact current Attention ids with rationale.')]);
  }
  if (decision.action === 'accepted'
    && stableFingerprint(decision.exceptions.map((item) => item.attentionId).sort())
      !== stableFingerprint([...attentionIds].sort())) {
    throw new HandoffValidationError([issue('decision-exception-coverage-missing', 'decision.exceptions', 'Acceptance must cover every current Attention item.', 'Name every current Attention id and exact rationale.')]);
  }
  return decision;
}

function currentDefinitionIds(obligation: EvidenceObligation, contract: TaskContract): string[] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  const verifierIds = new Set(obligation.strategies.flatMap((strategy) =>
    strategy.kind === 'runtime-check' ? strategy.verifierIds : []));
  return contract.verificationPlan.definitions
    .filter((item) => verifierIds.has(item.verifierId))
    .map((item) => item.definitionId)
    .sort();
}

function allObligations(contract: TaskContract): EvidenceObligation[] {
  return contract.adoptionConditions.flatMap((condition) => condition.evidenceObligations);
}

function conclusionStatus(value: unknown): ConclusionStatus | undefined {
  return ['supported', 'partial', 'contradicted', 'unknown'].includes(String(value))
    ? value as ConclusionStatus : undefined;
}

function attention(
  group: HandoffAttentionItem['group'],
  codes: HandoffAttentionCode[],
  references: HandoffAttentionItem['references'],
  resolution: HandoffAttentionItem['resolution']['kind'],
): HandoffAttentionItem {
  const uniqueCodes = [...new Set(codes)].sort() as HandoffAttentionCode[];
  const projection = { group, codes: uniqueCodes, references, resolution: { kind: resolution } };
  return { id: `attention:${stableFingerprint(projection).slice('sha256:'.length, 'sha256:'.length + 24)}`, ...projection };
}

function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: HandoffValidationIssue[],
): void {
  for (const key of hasExactKeys(value, allowed)) {
    issues.push(issue('unsupported-field', path ? `${path}.${key}` : key, `Unsupported field ${key}.`, 'Remove unsupported fields.'));
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return hasExactKeys(value, allowed).length === 0;
}

function text(value: unknown, path: string, issues: HandoffValidationIssue[]): void {
  if (!isNonEmptyString(value)) issues.push(issue('text-required', path, 'A non-empty value is required.', 'Supply a concrete value.'));
}

function texts(value: unknown, path: string, issues: HandoffValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    issues.push(issue('texts-invalid', path, 'Values must be an array of non-empty strings.', 'Supply concrete values or an empty array.'));
    return [];
  }
  return value.map((item) => String(item).trim());
}

function refs(
  value: unknown,
  path: string,
  available: Set<string>,
  issues: HandoffValidationIssue[],
): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item) || !available.has(item))) {
    issues.push(issue('references-invalid', path, 'References must select current exact identities.', 'Use ids from the current Authoring Packet.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('references-duplicate', path, 'References must be unique.', 'Remove duplicates.'));
  }
  return [...value].sort() as string[];
}

function issue(code: string, path: string, message: string, remediation: string): HandoffValidationIssue {
  return { code, path, message, remediation };
}
