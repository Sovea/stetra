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
  validateEvidenceDispositions(input);
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
      .filter((mutation) => mutation.role === 'acceptance-surface')
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

function validateEvidenceDispositions(input: EvaluateHandoffInput): void {
  const definitionIds = new Set(input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.map((item) => item.definitionId) : []);
  const ids = new Set<string>();
  for (const disposition of input.evidenceDispositions) {
    if (!disposition || disposition.protocol !== input.protocol
      || disposition.schemaVersion !== input.schemaVersion
      || !isSha256(disposition.dispositionId) || ids.has(disposition.dispositionId)
      || disposition.effectiveContractId !== input.contract.effectiveContractId
      || !isStableId(disposition.attemptId)
      || !isSha256(disposition.factCollectionId)
      || !['none', 'material'].includes(disposition.semanticImpact)
      || !['repair-implementation', 'revise-verification', 'challenge', 'handoff', 'ask-human'].includes(disposition.route)
      || !Array.isArray(disposition.entries) || !disposition.entries.length) {
      throw new Error('evaluateHandoff evidence disposition identity is invalid.');
    }
    ids.add(disposition.dispositionId);
    const selected = new Set<string>();
    for (const entry of disposition.entries) {
      if (!definitionIds.has(entry.definitionId) || selected.has(entry.definitionId)
        || !['implementation', 'environment', 'verification', 'unknown'].includes(entry.cause)
        || !isNonEmptyString(entry.diagnosis)
        || !isNonEmptyString(entry.falsificationAttempt)
        || typeof entry.codeChangeCanAlterObservation !== 'boolean'
        || !isNonEmptyString(entry.expectedDifferentObservation)
        || !Array.isArray(entry.intendedChanges)
        || entry.intendedChanges.some((item) => !isNonEmptyString(item))) {
        throw new Error('evaluateHandoff evidence disposition entry is invalid.');
      }
      selected.add(entry.definitionId);
    }
    const { dispositionId: _ignored, ...projection } = disposition;
    if (disposition.dispositionId !== stableFingerprint(projection)) {
      throw new Error('evaluateHandoff evidence disposition fingerprint is invalid.');
    }
  }
}

function validateChallenges(input: EvaluateHandoffInput): void {
  const obligations = new Map(allObligations(input.contract).map((item) => [item.id, item]));
  const changedFiles = new Set(input.factBundle.changedFiles.map((item) => item.path));
  const definitionIds = new Set(input.factBundle.checks.map((item) => item.definitionId));
  const evidenceIds = new Set(input.contract.repositoryEvidence.map((item) => item.id));
  const eventIds = new Set([input.contract.authority.developerEvent.id]);
  const challengeIds = new Set<string>();
  for (const challenge of input.challenges) {
    const selected = challenge?.obligationIds?.map((id) => obligations.get(id));
    const expectedConditions = sortedUnique((selected ?? []).flatMap((item) => item ? [item.conditionId] : []));
    if (!challenge || challenge.protocol !== input.protocol
      || challenge.schemaVersion !== input.schemaVersion
      || !isStableId(challenge.id) || challengeIds.has(challenge.id)
      || challenge.effectiveContractId !== input.contract.effectiveContractId
      || challenge.attemptId !== input.factBundle.attemptId
      || challenge.factCollectionId !== input.factBundle.factCollectionId
      || !Array.isArray(challenge.obligationIds) || !challenge.obligationIds.length
      || new Set(challenge.obligationIds).size !== challenge.obligationIds.length
      || selected.some((item) => !item)
      || stableFingerprint(challenge.conditionIds) !== stableFingerprint(expectedConditions)
      || !['host-attested', 'host-claimed', 'unverified'].includes(challenge.independence)
      || !validIndependence(challenge)
      || !isNonEmptyString(challenge.failureHypothesis)
      || !isNonEmptyString(challenge.falsificationAttempt)
      || !['supported', 'partial', 'contradicted', 'unknown'].includes(challenge.outcome)
      || !isNonEmptyString(challenge.conclusion)
      || !challenge.evidence
      || !validUniqueRefs(challenge.evidence.changedFiles, changedFiles)
      || !validUniqueRefs(challenge.evidence.checks, definitionIds)
      || !validUniqueRefs(challenge.evidence.repositoryEvidence, evidenceIds)
      || !validUniqueRefs(challenge.evidence.humanEvents, eventIds)
      || typeof challenge.evidence.patch !== 'boolean'
      || (challenge.evidence.patch && !input.factBundle.patch)) {
      throw new Error('evaluateHandoff challenge identity or obligation binding is invalid.');
    }
    challengeIds.add(challenge.id);
  }
  for (const challenge of input.challenges) {
    validateChallengeEvidenceItems(challenge.supportingEvidence, 'supportingEvidence', input, challengeIds);
    validateChallengeEvidenceItems(challenge.counterEvidence, 'counterEvidence', input, challengeIds);
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
  if (challenge.independence === 'host-claimed') {
    return isNonEmptyString(challenge.implementerContextId)
      && isNonEmptyString(challenge.challengerContextId)
      && challenge.implementerContextId !== challenge.challengerContextId;
  }
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
    exact(raw, ['obligationId', 'status', 'evidence', 'falsificationAttempt', 'counterEvidence', 'conclusion'], path, issues);
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
    text(raw.falsificationAttempt, `${path}.falsificationAttempt`, issues);
    text(raw.conclusion, `${path}.conclusion`, issues);
    if (obligation) {
      requireStrategyEvidence(obligation, evidence, contract, `${path}.evidence`, issues);
      const obligationChallenges = challenges.filter((item) => item.obligationIds.includes(obligation.id));
      if (status === 'supported' && obligationChallenges.some((item) => item.outcome !== 'supported')) {
        issues.push(issue('challenge-obligation-conflict', `${path}.status`, 'An adverse challenge prevents a supported obligation conclusion.', 'Reflect the challenge outcome.'));
      }
      if (status === 'supported' && requiredChallengeObligationIds.includes(obligation.id)
        && obligationChallenges.length
        && !evidence.some((item) => item.kind === 'challenge'
          && obligationChallenges.some((challenge) => challenge.id === item.id))) {
        issues.push(issue('challenge-evidence-missing', `${path}.evidence`, 'A completed required challenge must be cited by the obligation conclusion.', 'Reference the exact challenge.'));
      }
    }
    if (issues.length === before && obligation && status) {
      output.push({
        obligationId,
        status,
        evidence,
        falsificationAttempt: String(raw.falsificationAttempt).trim(),
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
      const requires = obligation.strategies.some((strategy) => strategy.kind === 'human-review')
        || obligationConclusion?.status !== 'supported'
        || unknownObligations.has(obligation.id)
        || (requiredChallengeObligationIds.includes(obligation.id) && !obligationChallenges.length)
        || obligationChallenges.some((item) => item.outcome !== 'supported')
        || obligationChallenges.some((item) => item.independence !== 'host-attested');
      if (requires && !coveredObligations.has(obligation.id)
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
    'human-event': new Set([contract.authority.developerEvent.id]),
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
  const changedRelations = input.factBundle.checkComparisons.filter((item) =>
    !['baseline-unknown', 'baseline-unknown-after-revision', 'passed-before-passed-now',
      'failed-before-failed-now', 'unavailable-before-unavailable-now'].includes(item.relation));
  const unknownAfterRevision = input.factBundle.checkComparisons.filter((item) =>
    item.relation === 'baseline-unknown-after-revision');
  const verifierDefinitions = sortedUnique(input.factBundle.verifierMutations.map((item) => item.definitionId));
  const verificationCodes: HandoffAttentionCode[] = [];
  if (nonpassing.length) verificationCodes.push('verification-nonpassing');
  if (changedRelations.length) verificationCodes.push('baseline-observation-different');
  if (unknownAfterRevision.length) verificationCodes.push('baseline-unknown-after-revision');
  if (input.factBundle.verifierMutations.length) verificationCodes.push('verifier-surface-changed');
  if (input.verificationRevised) verificationCodes.push('verification-revised');
  if (input.factBundle.checkInducedChanges.length) verificationCodes.push('check-induced-change');
  if (input.factBundle.baselineVerification.checkInducedChanges.length) verificationCodes.push('baseline-check-induced-change');
  if (verificationCodes.length) {
    items.push(attention('verification', verificationCodes, {
      checks: sortedUnique([
        ...nonpassing.map((item) => item.definitionId),
        ...changedRelations.map((item) => item.definitionId),
        ...unknownAfterRevision.map((item) => item.definitionId),
        ...verifierDefinitions,
      ]),
      changedFiles: sortedUnique([
        ...input.factBundle.verifierMutations.map((item) => item.path),
        ...input.factBundle.checkInducedChanges.map((item) => item.path),
        ...input.factBundle.baselineVerification.checkInducedChanges.map((item) => item.path),
      ]),
    }, 'inspect'));
  }
  const unrepresentable = input.factBundle.changedFiles.filter((item) => item.representation === 'unrepresentable');
  if (unrepresentable.length) {
    items.push(attention('change-integrity', ['change-unrepresentable'], {
      changedFiles: unrepresentable.map((item) => item.path),
    }, 'inspect'));
  }
  for (const obligation of allObligations(input.contract)) {
    const conclusion = handoff.obligationConclusions.find((item) => item.obligationId === obligation.id)!;
    const challenges = input.challenges.filter((item) => item.obligationIds.includes(obligation.id));
    const codes: HandoffAttentionCode[] = [];
    if (conclusion.status !== 'supported') codes.push('obligation-not-supported');
    if (requiredChallengeObligationIds.includes(obligation.id) && !challenges.length) codes.push('challenge-missing');
    if (challenges.some((item) => item.outcome !== 'supported')) codes.push('challenge-adverse');
    if (challenges.some((item) => item.independence !== 'host-attested')) codes.push('challenge-independence-unverified');
    if (obligation.strategies.some((strategy) => strategy.kind === 'human-review')) codes.push('direct-review-required');
    if (handoff.residualUnknowns.some((item) => item.obligationIds.includes(obligation.id))) codes.push('residual-unknown');
    if (codes.length) {
      items.push(attention('obligation', codes, {
        conditions: [obligation.conditionId],
        obligations: [obligation.id],
        challenges: challenges.map((item) => item.id),
        checks: currentDefinitionIds(obligation, input.contract),
      }, codes.includes('challenge-missing') ? 'challenge' : 'inspect'));
    }
  }
  for (const condition of input.contract.adoptionConditions) {
    const conclusion = handoff.conditionConclusions.find((item) => item.conditionId === condition.id)!;
    const codes: HandoffAttentionCode[] = [];
    if (conclusion.status !== 'supported') codes.push('condition-not-supported');
    if (handoff.residualUnknowns.some((item) => item.conditionIds.includes(condition.id))) codes.push('residual-unknown');
    if (codes.length) {
      items.push(attention('condition', codes, { conditions: [condition.id] }, 'inspect'));
    }
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
  const unresolvedDispositions = input.evidenceDispositions.flatMap((item) =>
    item.entries.filter((entry) => entry.cause !== 'implementation'));
  const currentNonpassing = input.factBundle.checks
    .filter((check) => check.attempts.at(-1)?.status !== 'passed')
    .map((check) => check.definitionId);
  const currentDisposition = input.evidenceDispositions.find((item) =>
    item.attemptId === input.factBundle.attemptId
    && item.factCollectionId === input.factBundle.factCollectionId);
  const missingDisposition = currentNonpassing.length > 0 && !currentDisposition;
  if (unresolvedDispositions.length || input.deliveryExhausted || missingDisposition) {
    items.push(attention('delivery', [
      ...(unresolvedDispositions.length ? ['evidence-disposition-unresolved' as const] : []),
      ...(input.deliveryExhausted ? ['repair-route-exhausted' as const] : []),
      ...(missingDisposition ? ['evidence-disposition-missing' as const] : []),
    ], { checks: sortedUnique([
      ...unresolvedDispositions.map((item) => item.definitionId),
      ...(missingDisposition ? currentNonpassing : []),
    ]) }, 'decide-exception'));
  }
  return items.sort((left, right) => left.id.localeCompare(right.id));
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

function validUniqueRefs(values: unknown, available: Set<string>): values is string[] {
  return Array.isArray(values)
    && values.every((item) => typeof item === 'string' && available.has(item))
    && new Set(values).size === values.length;
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
