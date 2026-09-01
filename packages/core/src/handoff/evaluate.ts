import { validateCompiledContract } from '../delegation/compile.ts';
import type { EvidenceObligation, TaskContract } from '../delegation/types.ts';
import { validateFactBundle } from '../facts/validate.ts';
import type { EvidenceDisposition, FactBundle } from '../facts/types.ts';
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
  type EvidenceCoverageAssessment,
  type HandoffAttentionCode,
  type HandoffAttentionItem,
  type HandoffEvidenceReference,
  type HandoffEvaluation,
  type HandoffValidationIssue,
  type HumanDecision,
  type ResidualUnknown,
  type ReviewDecision,
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
      evidencePaths: [],
      attention: [],
      adoption: { authority: 'human', status: 'pending' },
    };
  }

  validateCurrentEvidenceDisposition(input);
  const requiredChallengeObligationIds = requiredChallenges(input.contract, input.factBundle);
  const handoff = validateHandoff(
    input.handoff,
    input.contract,
    input.factBundle,
    requiredChallengeObligationIds,
  );
  const attention = deriveAttention(input, handoff, requiredChallengeObligationIds);
  const evidencePaths = deriveEvidencePaths(
    input,
    handoff,
    requiredChallengeObligationIds,
  );
  validateRecommendationConsistency(
    input,
    handoff,
    requiredChallengeObligationIds,
    evidencePaths,
  );
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
    evidencePaths,
    attention,
    adoption: decision
      ? { authority: 'human', status: decision.interpretation.action, decisionId: decision.decisionId }
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
  const expectedSources = new Set(
    input.factBundle.evidenceConcerns.map((item) => evidenceConcernIdentity(item)),
  );
  if (disposition.protocol !== input.protocol
    || disposition.schemaVersion !== input.schemaVersion
    || !isSha256(disposition.dispositionId)
    || disposition.effectiveContractId !== input.contract.effectiveContractId
    || disposition.attemptId !== input.factBundle.attemptId
    || disposition.factCollectionId !== input.factBundle.factCollectionId
    || !['none', 'material'].includes(disposition.semanticImpact)
    || !['repair-delivery', 'revise-verification', 'handoff', 'ask-human'].includes(disposition.proposedRoute)
    || !isNonEmptyString(disposition.routeRationale)
    || !['repair-delivery', 'revise-verification', 'handoff', 'ask-human'].includes(disposition.route)
    || !Array.isArray(disposition.entries) || !disposition.entries.length) {
    throw new Error('evaluateHandoff current evidence disposition identity is invalid.');
  }
  const selected = new Set<string>();
  for (const entry of disposition.entries) {
    const sourceValid = definitionIds.has(entry.source.definitionId)
      && input.factBundle.evidenceConcerns.some((item) =>
        evidenceConcernIdentity(item) === evidenceConcernIdentity(entry.source));
    const sourceIdentity = evidenceConcernIdentity(entry.source);
    if (!sourceValid || selected.has(sourceIdentity)
      || !['implementation', 'environment', 'verification', 'unknown'].includes(entry.cause)
      || !isNonEmptyString(entry.diagnosis)
      || !isNonEmptyString(entry.falsificationAttempt)
      || typeof entry.repositoryChangeCanAlterObservation !== 'boolean'
      || !['production', 'verification-surface', 'none'].includes(entry.changeSurface)
      || !isNonEmptyString(entry.expectedDifferentObservation)
      || !Array.isArray(entry.intendedChanges)
      || entry.intendedChanges.some((item) => !isNonEmptyString(item))
      || (entry.source.observation === 'baseline-expectation-mismatch'
        && (entry.cause === 'implementation'
          || entry.changeSurface === 'production'))
      || !validDispositionChange(entry)) {
      throw new Error('evaluateHandoff current evidence disposition entry is invalid.');
    }
    selected.add(sourceIdentity);
  }
  if (selected.size !== expectedSources.size
    || [...selected].some((identity) => !expectedSources.has(identity))) {
    throw new Error('evaluateHandoff current evidence disposition must cover every current evidence concern exactly once.');
  }
  const hasRepositoryRepair = disposition.entries.some((entry) =>
    entry.repositoryChangeCanAlterObservation);
  const proposedRouteValid = disposition.semanticImpact === 'material'
    ? disposition.proposedRoute === 'ask-human'
    : disposition.proposedRoute !== 'ask-human'
      && (disposition.proposedRoute !== 'repair-delivery' || hasRepositoryRepair);
  const effectiveRouteValid = disposition.route === disposition.proposedRoute
    || (input.deliveryExhausted
      && disposition.proposedRoute === 'repair-delivery'
      && disposition.route === 'handoff');
  if (!proposedRouteValid || !effectiveRouteValid) {
    throw new Error('evaluateHandoff current evidence disposition route is structurally invalid.');
  }
  const { dispositionId: _ignored, ...projection } = disposition;
  if (disposition.dispositionId !== stableFingerprint(projection)) {
    throw new Error('evaluateHandoff current evidence disposition fingerprint is invalid.');
  }
}

function evidenceConcernIdentity(source: EvidenceDisposition['entries'][number]['source']): string {
  return `check:${source.definitionId}:${source.observation}`;
}

function validDispositionChange(entry: EvidenceDisposition['entries'][number]): boolean {
  const hasChanges = entry.intendedChanges.length > 0;
  if (entry.cause === 'implementation') {
    return entry.repositoryChangeCanAlterObservation
      && entry.changeSurface === 'production'
      && hasChanges;
  }
  if (entry.cause === 'verification') {
    return (entry.repositoryChangeCanAlterObservation
        && entry.changeSurface === 'verification-surface'
        && hasChanges)
      || (!entry.repositoryChangeCanAlterObservation
        && entry.changeSurface === 'none'
        && !hasChanges);
  }
  return !entry.repositoryChangeCanAlterObservation
    && entry.changeSurface === 'none'
    && !hasChanges;
}


function validateHandoff(
  value: CognitiveHandoff,
  contract: TaskContract,
  facts: FactBundle,
  requiredChallengeObligationIds: string[],
): CognitiveHandoff {
  const issues: HandoffValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new HandoffValidationError([issue('handoff-object-required', '$', 'Cognitive Handoff must be an object.', 'Submit the initial handoff shape.')]);
  }
  exact(value, [
    'protocol', 'schemaVersion', 'handoffId', 'handoffFingerprint', 'effectiveContractId',
    'attemptId', 'factCollectionId', 'actualChange', 'obligationConclusions',
    'conditionConclusions', 'residualUnknowns',
    'reviewDecisions', 'recommendation',
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
  const actualChange = validateActualChange(value.actualChange, issues);
  const obligationConclusions = validateObligationConclusions(
    value.obligationConclusions, contract, facts,
    requiredChallengeObligationIds, issues,
  );
  const conditionConclusions = validateConditionConclusions(
    value.conditionConclusions, contract, obligationConclusions, issues,
  );
  const unknowns = validateUnknowns(value.residualUnknowns, contract, facts, issues);
  const reviewDecisions = validateReviewDecisions(value.reviewDecisions, contract, facts, issues);
  validateReviewCoverage(
    contract, obligationConclusions, conditionConclusions, unknowns,
    reviewDecisions, requiredChallengeObligationIds, issues,
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
    actualChange: actualChange!,
    obligationConclusions,
    conditionConclusions,
    residualUnknowns: unknowns,
    reviewDecisions,
    recommendation: recommendation!,
  };
}

function validateActualChange(
  value: unknown,
  issues: HandoffValidationIssue[],
): CognitiveHandoff['actualChange'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('actual-change-invalid', 'actualChange', 'Actual change must be an object.', 'Describe the implemented system behavior and mechanism.'));
    return undefined;
  }
  exact(value, [
    'behavior', 'mechanism', 'preservedInvariants', 'failureAndRecovery',
    'importantEffects', 'materialTradeoffs',
  ], 'actualChange', issues);
  text(value.behavior, 'actualChange.behavior', issues);
  const mechanism = texts(value.mechanism, 'actualChange.mechanism', issues);
  if (!mechanism.length) {
    issues.push(issue('actual-change-mechanism-required', 'actualChange.mechanism', 'Actual change requires at least one implementation mechanism.', 'Name the code path or design mechanism that produces the behavior.'));
  }
  const preservedInvariants = texts(value.preservedInvariants, 'actualChange.preservedInvariants', issues);
  const failureAndRecovery = texts(value.failureAndRecovery, 'actualChange.failureAndRecovery', issues);
  const importantEffects = texts(value.importantEffects, 'actualChange.importantEffects', issues);
  const materialTradeoffs = texts(value.materialTradeoffs, 'actualChange.materialTradeoffs', issues);
  return issues.length === before ? {
    behavior: String(value.behavior).trim(),
    mechanism,
    preservedInvariants,
    failureAndRecovery,
    importantEffects,
    materialTradeoffs,
  } : undefined;
}

function validateObligationConclusions(
  value: unknown,
  contract: TaskContract,
  facts: FactBundle,
  requiredChallengeObligationIds: string[],
  issues: HandoffValidationIssue[],
): EvidenceObligationConclusion[] {
  if (!Array.isArray(value)) {
    issues.push(issue('obligation-conclusions-invalid', 'obligationConclusions', 'Obligation conclusions must be an array.', 'Conclude every evidence obligation exactly once.'));
    return [];
  }
  const obligations = new Map(allObligations(contract).map((item) => [item.id, item]));
  const seen = new Set<string>();
  const output: EvidenceObligationConclusion[] = [];
  for (const [index, raw] of value.entries()) {
    const path = `obligationConclusions[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('obligation-conclusion-invalid', path, 'Obligation conclusion must be an object.', 'Replace it with a conclusion.'));
      continue;
    }
    exact(raw, [
      'obligationId', 'status', 'reviewDecisionIds', 'evidence', 'evidenceCoverage', 'falsification',
      'counterEvidence', 'conclusion',
    ], path, issues);
    const obligationId = typeof raw.obligationId === 'string' ? raw.obligationId : '';
    const obligation = obligations.get(obligationId);
    if (!obligation || seen.has(obligationId)) {
      issues.push(issue('obligation-reference-invalid', `${path}.obligationId`, 'Obligation reference is missing or duplicated.', 'Conclude each current obligation once.'));
    }
    seen.add(obligationId);
    const status = conclusionStatus(raw.status);
    if (!status) issues.push(issue('obligation-status-invalid', `${path}.status`, 'Obligation status is invalid.', 'Use supported, partial, contradicted, or unknown.'));
    const reviewDecisionIds = stableRefs(
      raw.reviewDecisionIds,
      `${path}.reviewDecisionIds`,
      issues,
    );
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, issues);
    const evidenceCoverage = validateEvidenceCoverage(
      raw.evidenceCoverage,
      `${path}.evidenceCoverage`,
      issues,
    );
    const counterEvidence = validateEvidence(raw.counterEvidence, `${path}.counterEvidence`, contract, facts, issues);
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
    if (status === 'supported' && evidenceCoverage?.status !== 'sufficient') {
      issues.push(issue(
        'obligation-supported-with-insufficient-coverage',
        `${path}.evidenceCoverage.status`,
        'A supported obligation requires an explicit sufficient evidence-coverage assessment.',
        'Keep every uncovered aspect visible and use partial, contradicted, or unknown.',
      ));
    }
    if (obligation) {
      requireStrategyEvidence(
        obligation,
        [...evidence, ...counterEvidence],
        contract,
        path,
        issues,
      );
      if (status === 'supported' && requiredChallengeObligationIds.includes(obligation.id)) {
        issues.push(issue('challenge-obligation-unavailable', `${path}.status`, 'A required independent Challenge is unavailable through the current thin Host boundary.', 'Use partial, contradicted, or unknown and bind direct review to this obligation.'));
      }
    }
    if (issues.length === before && obligation && status && evidenceCoverage && falsification) {
      output.push({
        obligationId,
        status,
        reviewDecisionIds,
        evidence,
        evidenceCoverage,
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

function validateEvidenceCoverage(
  value: unknown,
  path: string,
  issues: HandoffValidationIssue[],
): EvidenceCoverageAssessment | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue(
      'evidence-coverage-invalid',
      path,
      'Evidence coverage must be an explicit assessment.',
      'State whether the declared evidence is sufficient and list every uncovered aspect.',
    ));
    return undefined;
  }
  exact(value, ['status', 'rationale', 'gaps'], path, issues);
  const status = value.status === 'sufficient' || value.status === 'insufficient'
    ? value.status
    : undefined;
  if (!status) {
    issues.push(issue(
      'evidence-coverage-status-invalid',
      `${path}.status`,
      'Evidence coverage status is invalid.',
      'Use sufficient or insufficient.',
    ));
  }
  text(value.rationale, `${path}.rationale`, issues);
  const gaps = texts(value.gaps, `${path}.gaps`, issues);
  if (status === 'sufficient' && gaps.length) {
    issues.push(issue(
      'evidence-coverage-conflict',
      `${path}.gaps`,
      'Sufficient evidence coverage cannot retain uncovered aspects.',
      'Use insufficient while any gap remains.',
    ));
  }
  if (status === 'insufficient' && !gaps.length) {
    issues.push(issue(
      'evidence-coverage-gap-required',
      `${path}.gaps`,
      'Insufficient evidence coverage requires at least one concrete uncovered aspect.',
      'Name the exact conclusion boundary that current evidence does not cover.',
    ));
  }
  return issues.length === before && status
    ? { status, rationale: String(value.rationale).trim(), gaps }
    : undefined;
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
    exact(raw, ['conditionId', 'status', 'summary', 'reviewDecisionIds'], path, issues);
    const conditionId = typeof raw.conditionId === 'string' ? raw.conditionId : '';
    const condition = conditions.get(conditionId);
    if (!condition || seen.has(conditionId)) {
      issues.push(issue('condition-reference-invalid', `${path}.conditionId`, 'Condition reference is missing or duplicated.', 'Conclude each current condition once.'));
    }
    seen.add(conditionId);
    const status = conclusionStatus(raw.status);
    if (!status) issues.push(issue('condition-status-invalid', `${path}.status`, 'Condition status is invalid.', 'Use supported, partial, contradicted, or unknown.'));
    const reviewDecisionIds = stableRefs(
      raw.reviewDecisionIds,
      `${path}.reviewDecisionIds`,
      issues,
    );
    text(raw.summary, `${path}.summary`, issues);
    if (condition && status === 'supported') {
      const statuses = condition.evidenceObligations.map((obligation) =>
        obligationConclusions.find((item) => item.obligationId === obligation.id)?.status);
      if (statuses.some((item) => item !== 'supported')) {
        issues.push(issue('condition-exceeds-obligations', `${path}.status`, 'Condition cannot be supported while any evidence obligation is partial, contradicted, unknown, or missing.', 'Use a bounded non-supported condition status.'));
      }
    }
    if (issues.length === before && condition && status) {
      output.push({
        conditionId,
        status,
        summary: String(raw.summary).trim(),
        reviewDecisionIds,
      });
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
    exact(raw, ['target', 'statement', 'evidence', 'reviewDecisionIds'], path, issues);
    let target: ResidualUnknown['target'] | undefined;
    if (!isRecord(raw.target)) {
      issues.push(issue('unknown-target-invalid', `${path}.target`, 'Residual unknown target must be an object.', 'Select task, condition, or obligation.'));
    } else if (raw.target.kind === 'task') {
      exact(raw.target, ['kind'], `${path}.target`, issues);
      target = { kind: 'task' };
    } else if (raw.target.kind === 'condition') {
      exact(raw.target, ['kind', 'conditionId'], `${path}.target`, issues);
      const selected = refs([raw.target.conditionId], `${path}.target.conditionId`, conditionIds, issues);
      if (selected[0]) target = { kind: 'condition', conditionId: selected[0] };
    } else if (raw.target.kind === 'obligation') {
      exact(raw.target, ['kind', 'conditionId', 'obligationId'], `${path}.target`, issues);
      const selectedCondition = refs([raw.target.conditionId], `${path}.target.conditionId`, conditionIds, issues)[0];
      const selectedObligation = refs([raw.target.obligationId], `${path}.target.obligationId`, obligationIds, issues)[0];
      const obligation = allObligations(contract).find((item) => item.id === selectedObligation);
      if (selectedCondition && selectedObligation && obligation?.conditionId !== selectedCondition) {
        issues.push(issue('unknown-target-mismatch', `${path}.target`, 'Residual unknown obligation does not belong to its selected Condition.', 'Use the exact parent Condition.'));
      } else if (selectedCondition && selectedObligation) {
        target = { kind: 'obligation', conditionId: selectedCondition, obligationId: selectedObligation };
      }
    } else {
      issues.push(issue('unknown-target-invalid', `${path}.target.kind`, 'Residual unknown target kind must be task, condition, or obligation.', 'Select an exact target kind.'));
    }
    text(raw.statement, `${path}.statement`, issues);
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, issues);
    const reviewDecisionIds = stableRefs(
      raw.reviewDecisionIds,
      `${path}.reviewDecisionIds`,
      issues,
    );
    return issues.length === before && target ? [{
      target,
      statement: String(raw.statement).trim(),
      evidence,
      reviewDecisionIds,
    }] : [];
  });
}

function validateReviewDecisions(
  value: unknown,
  contract: TaskContract,
  facts: FactBundle,
  issues: HandoffValidationIssue[],
): ReviewDecision[] {
  if (!Array.isArray(value)) {
    issues.push(issue('review-decisions-invalid', 'reviewDecisions', 'Review Decisions must be an array.', 'Supply consequence-directed decisions.'));
    return [];
  }
  const conditionIds = new Set(contract.adoptionConditions.map((item) => item.id));
  const obligationIds = new Set(allObligations(contract).map((item) => item.id));
  const decisionIds = new Set<string>();
  return value.flatMap((raw, index) => {
    const path = `reviewDecisions[${index}]`;
    const before = issues.length;
    if (!isRecord(raw)) {
      issues.push(issue('review-decision-invalid', path, 'Review Decision must be an object.', 'Replace it with a decision.'));
      return [];
    }
    exact(raw, [
      'id', 'conditionIds', 'obligationIds', 'question', 'adoptionImpact', 'nextAction', 'evidence',
    ], path, issues);
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!isStableId(id) || decisionIds.has(id)) {
      issues.push(issue('review-decision-id-invalid', `${path}.id`, 'Review Decision id is invalid or duplicated.', 'Use the Runtime-generated id.'));
    }
    decisionIds.add(id);
    const selectedConditions = refs(raw.conditionIds, `${path}.conditionIds`, conditionIds, issues);
    const selectedObligations = refs(raw.obligationIds, `${path}.obligationIds`, obligationIds, issues);
    text(raw.question, `${path}.question`, issues);
    text(raw.adoptionImpact, `${path}.adoptionImpact`, issues);
    text(raw.nextAction, `${path}.nextAction`, issues);
    const evidence = validateEvidence(raw.evidence, `${path}.evidence`, contract, facts, issues);
    return issues.length === before ? [{
      id,
      conditionIds: selectedConditions,
      obligationIds: selectedObligations,
      question: String(raw.question).trim(),
      adoptionImpact: String(raw.adoptionImpact).trim(),
      nextAction: String(raw.nextAction).trim(),
      evidence,
    }] : [];
  });
}

function validateReviewCoverage(
  contract: TaskContract,
  obligationConclusions: EvidenceObligationConclusion[],
  conditionConclusions: AdoptionConditionConclusion[],
  unknowns: ResidualUnknown[],
  decisions: ReviewDecision[],
  requiredChallengeObligationIds: string[],
  issues: HandoffValidationIssue[],
): void {
  const decisionById = new Map(decisions.map((item) => [item.id, item] as const));
  const conditionByObligation = new Map(contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [obligation.id, condition.id] as const)));
  const selectedDecisions = (
    ids: string[],
    path: string,
  ): ReviewDecision[] => ids.flatMap((id) => {
    const decision = decisionById.get(id);
    if (!decision) {
      issues.push(issue(
        'review-decision-reference-invalid',
        path,
        `Review Decision ${id} is not part of the current handoff.`,
        'Use a Review Decision id from the same handoff.',
      ));
      return [];
    }
    return [decision];
  });
  for (const condition of contract.adoptionConditions) {
    const conclusion = conditionConclusions.find((item) => item.conditionId === condition.id);
    const conditionDecisions = selectedDecisions(
      conclusion?.reviewDecisionIds ?? [],
      `conditionConclusions.${condition.id}.reviewDecisionIds`,
    );
    if (conditionDecisions.some((decision) => !decision.conditionIds.includes(condition.id))) {
      issues.push(issue(
        'review-decision-target-mismatch',
        `conditionConclusions.${condition.id}.reviewDecisionIds`,
        `A referenced Review Decision does not cover Condition ${condition.id}.`,
        'Bind the decision to this exact Condition or remove the reference.',
        { conditionIds: [condition.id] },
      ));
    }
    if ((condition.criticality === 'adoption-critical' || conclusion?.status !== 'supported')
      && !conditionDecisions.some((decision) => decision.conditionIds.includes(condition.id))) {
      issues.push(issue(
        'review-coverage-missing',
        `conditionConclusions.${condition.id}.reviewDecisionIds`,
        `Condition ${condition.id} requires direct review coverage.`,
        'Reference a shared Review Decision bound to this Condition.',
        { conditionIds: [condition.id] },
      ));
    }
    for (const obligation of condition.evidenceObligations) {
      const obligationConclusion = obligationConclusions.find((item) => item.obligationId === obligation.id);
      const unresolvedChallenge = requiredChallengeObligationIds.includes(obligation.id);
      const requires = obligationConclusion?.status !== 'supported'
        || unresolvedChallenge;
      const obligationDecisions = selectedDecisions(
        obligationConclusion?.reviewDecisionIds ?? [],
        `obligationConclusions.${obligation.id}.reviewDecisionIds`,
      );
      const coversObligation = (decision: ReviewDecision) =>
        decision.obligationIds.includes(obligation.id)
        || decision.conditionIds.includes(condition.id);
      if (obligationDecisions.some((decision) => !coversObligation(decision))) {
        issues.push(issue(
          'review-decision-target-mismatch',
          `obligationConclusions.${obligation.id}.reviewDecisionIds`,
          `A referenced Review Decision does not cover Obligation ${obligation.id} or its Condition.`,
          'Bind the decision to this exact Obligation or its parent Condition.',
          { conditionIds: [condition.id], obligationIds: [obligation.id] },
        ));
      }
      if (unresolvedChallenge
        && !obligationDecisions.some((decision) => decision.obligationIds.includes(obligation.id))) {
        issues.push(issue(
          'challenge-review-coverage-missing',
          `obligationConclusions.${obligation.id}.reviewDecisionIds`,
          `Unresolved challenge for obligation ${obligation.id} requires a directly bound review decision.`,
          'Reference a shared Review Decision that names this exact Obligation.',
          { conditionIds: [condition.id], obligationIds: [obligation.id] },
        ));
      } else if (requires && !obligationDecisions.some(coversObligation)) {
        issues.push(issue(
          'review-coverage-missing',
          `obligationConclusions.${obligation.id}.reviewDecisionIds`,
          `Obligation ${obligation.id} requires direct review coverage.`,
          'Reference a shared Review Decision bound to this Obligation or its Condition.',
          { conditionIds: [condition.id], obligationIds: [obligation.id] },
        ));
      }
    }
  }
  for (const [index, unknown] of unknowns.entries()) {
    const unknownDecisions = selectedDecisions(
      unknown.reviewDecisionIds,
      `residualUnknowns[${index}].reviewDecisionIds`,
    );
    const targetConditionIds = unknown.target.kind === 'task' ? [] : [unknown.target.conditionId];
    const targetObligationIds = unknown.target.kind === 'obligation'
      ? [unknown.target.obligationId] : [];
    const missingConditions = targetConditionIds.filter((id) =>
      !unknownDecisions.some((decision) => decision.conditionIds.includes(id)));
    const missingObligations = targetObligationIds.filter((id) => {
      const parentConditionId = conditionByObligation.get(id);
      return !unknownDecisions.some((decision) =>
        decision.obligationIds.includes(id)
        || (parentConditionId ? decision.conditionIds.includes(parentConditionId) : false));
    });
    const taskWideWithoutDecision = unknown.target.kind === 'task' && !unknownDecisions.length;
    if (missingConditions.length || missingObligations.length || taskWideWithoutDecision) {
      issues.push(issue(
        'unknown-review-coverage-missing',
        `residualUnknowns[${index}].reviewDecisionIds`,
        'Residual unknown is not fully covered by its referenced Review Decisions.',
        'Reference shared decisions covering every exact Condition and Obligation target.',
        { conditionIds: missingConditions, obligationIds: missingObligations },
      ));
    }
  }
  const referencedTaskWideDecisionIds = new Set(unknowns
    .filter((unknown) => unknown.target.kind === 'task')
    .flatMap((unknown) => unknown.reviewDecisionIds));
  for (const [index, decision] of decisions.entries()) {
    if (!decision.conditionIds.length
      && !decision.obligationIds.length
      && !decision.evidence.length
      && !referencedTaskWideDecisionIds.has(decision.id)) {
      issues.push(issue(
        'review-decision-unbound',
        `reviewDecisions[${index}]`,
        'Review Decision selects no condition, obligation, evidence, or task-wide residual unknown.',
        'Bind it to an exact decision surface or remove it.',
      ));
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
    'human-event': new Set(contract.humanEvents.map((item) => item.id)),
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
    const kind = ['changed-file', 'check', 'repository-evidence', 'human-event', 'patch'].includes(String(raw.kind))
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
  const nonpassing = input.factBundle.evidenceConcerns.filter((item) =>
    item.observation === 'current-nonpassing');
  const baselineExpectationMismatches = input.factBundle.evidenceConcerns.filter((item) =>
    item.observation === 'baseline-expectation-mismatch');
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
  const missingChallengeReferences: HandoffAttentionItem['references'] = {};
  for (const obligation of allObligations(input.contract)) {
    const references = {
        conditions: [obligation.conditionId],
        obligations: [obligation.id],
        checks: currentDefinitionIds(obligation, input.contract),
    };
    if (requiredChallengeObligationIds.includes(obligation.id)) {
      mergeAttentionReferences(missingChallengeReferences, references);
    }
    const conclusion = handoff.obligationConclusions.find((item) =>
      item.obligationId === obligation.id);
    if (conclusion?.evidenceCoverage.status === 'insufficient') {
      items.push(attention('obligation', ['evidence-coverage-insufficient'], references, 'inspect'));
    }
  }
  if (missingChallengeReferences.obligations?.length) {
    items.push(attention('challenge', ['challenge-missing'], missingChallengeReferences, 'inspect'));
  }
  const residualTargets = new Map<string, HandoffAttentionItem['references']>();
  for (const unknown of handoff.residualUnknowns) {
    const references = unknown.target.kind === 'task'
      ? {}
      : unknown.target.kind === 'condition'
        ? { conditions: [unknown.target.conditionId] }
        : {
            conditions: [unknown.target.conditionId],
            obligations: [unknown.target.obligationId],
          };
    residualTargets.set(stableFingerprint(references), references);
  }
  for (const references of residualTargets.values()) {
    items.push(attention('condition', ['residual-unknown'], references, 'inspect'));
  }
  for (const requirement of input.contract.hostPolicyRequirements) {
    items.push(attention('host-policy', ['host-policy-unverified'], {
      hostPolicies: [requirement.id],
    }, requirement.enforcementRequirement === 'required' ? 'resolve' : 'inspect'));
  }
  const evidenceConcernChecks = input.factBundle.evidenceConcerns.map((item) => item.definitionId);
  const missingDisposition = input.factBundle.evidenceConcerns.length > 0
    && !input.currentEvidenceDisposition;
  if (missingDisposition) {
    items.push(attention('delivery', ['evidence-disposition-missing'], {
      checks: sortedUnique(evidenceConcernChecks),
    }, 'resolve'));
  }
  if (input.deliveryExhausted) {
    items.push(attention('delivery', ['repair-route-exhausted'], {
      checks: sortedUnique(evidenceConcernChecks),
    }, 'decide-exception'));
  }
  return items.sort((left, right) => left.id.localeCompare(right.id));
}

function validateRecommendationConsistency(
  input: EvaluateHandoffInput,
  handoff: CognitiveHandoff,
  requiredChallengeObligationIds: string[],
  evidencePaths: HandoffEvaluation['evidencePaths'],
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
  if (evidencePaths.some((item) => item.status !== 'completed')) {
    blockers.add('evidence-path-incomplete');
  }
  if (requiredChallengeObligationIds.length) blockers.add('challenge-missing');
  if (input.contract.hostPolicyRequirements.some((requirement) =>
    requirement.enforcementRequirement === 'required')) {
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

function deriveEvidencePaths(
  input: EvaluateHandoffInput,
  handoff: CognitiveHandoff,
  requiredChallengeObligationIds: string[],
): HandoffEvaluation['evidencePaths'] {
  const requiredChallenges = new Set(requiredChallengeObligationIds);
  const definitions = input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions : [];
  return allObligations(input.contract).map((obligation) => {
    const finding = handoff.obligationConclusions.find((item) =>
      item.obligationId === obligation.id)!;
    const strategies = obligation.strategies.map((strategy, strategyIndex) => {
      if (strategy.kind === 'runtime-check') {
        const selected = definitions.filter((definition) =>
          strategy.verifierIds.includes(definition.verifierId));
        const references = selected.map((definition) => ({
          kind: 'check' as const,
          id: definition.definitionId,
        }));
        const unavailable = selected.some((definition) =>
          input.factBundle.checks.find((check) =>
            check.definitionId === definition.definitionId)?.attempts.at(-1)?.status === 'unavailable');
        return {
          strategyIndex,
          kind: strategy.kind,
          status: unavailable ? 'unavailable' as const : 'completed' as const,
          reason: unavailable ? 'check-unavailable' as const : 'current-check-observed' as const,
          references,
        };
      }
      if (strategy.kind === 'repository-inspection') {
        return {
          strategyIndex,
          kind: strategy.kind,
          status: 'completed' as const,
          reason: 'repository-evidence-cited' as const,
          references: [...finding.evidence, ...finding.counterEvidence]
            .filter((item) => item.kind === 'repository-evidence'
              && strategy.repositoryEvidenceIds.includes(item.id!)),
        };
      }
      if (strategy.kind === 'independent-challenge') {
        if (!requiredChallenges.has(obligation.id)) {
          return {
            strategyIndex,
            kind: strategy.kind,
            status: 'not-triggered' as const,
            reason: 'challenge-not-triggered' as const,
            references: [],
          };
        }
        return {
          strategyIndex,
          kind: strategy.kind,
          status: 'unavailable' as const,
          reason: 'challenge-unavailable' as const,
          references: [],
        };
      }
      throw new Error('Unsupported evidence strategy.');
    });
    const status = strategies.some((item) => item.status === 'unavailable')
      ? 'unavailable' as const
      : 'completed' as const;
    return { obligationId: obligation.id, status, strategies };
  });
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
    || decision.interpretation?.basisHumanEventId !== decision.humanEvent?.id
    || !['accepted', 'correction-requested', 'rejected', 'deferred'].includes(decision.interpretation?.action)
    || !isNonEmptyString(decision.interpretation?.reason)
    || !Array.isArray(decision.interpretation?.exceptions)
    || !isStableId(decision.humanEvent?.id)
    || !['decision', 'correction'].includes(decision.humanEvent?.kind)
    || !isNonEmptyString(decision.humanEvent?.content)
    || decision.humanEvent.contentFingerprint !== sha256(decision.humanEvent.content)) {
    throw new HandoffValidationError([issue('decision-invalid', 'decision', 'Human Decision is invalid or stale.', 'Bind the exact decision to the current handoff.')]);
  }
  if ((decision.interpretation.action === 'correction-requested') !== (decision.humanEvent.kind === 'correction')) {
    throw new HandoffValidationError([issue('decision-event-kind-invalid', 'decision.humanEvent.kind', 'Correction requests require correction events; all other decisions require decision events.', 'Preserve the exact developer event with the matching kind.')]);
  }
  const attentionIds = new Set(attention.map((item) => item.id));
  if (new Set(decision.interpretation.exceptions.map((item) => item.attentionId)).size !== decision.interpretation.exceptions.length
    || decision.interpretation.exceptions.some((item) => !attentionIds.has(item.attentionId) || !isNonEmptyString(item.rationale))) {
    throw new HandoffValidationError([issue('decision-exception-invalid', 'decision.interpretation.exceptions', 'Decision exceptions must uniquely reference current Attention.', 'Reference exact current Attention ids with rationale.')]);
  }
  if (decision.interpretation.action === 'accepted'
    && stableFingerprint(decision.interpretation.exceptions.map((item) => item.attentionId).sort())
      !== stableFingerprint([...attentionIds].sort())) {
    throw new HandoffValidationError([issue('decision-exception-coverage-missing', 'decision.interpretation.exceptions', 'Acceptance must cover every current Attention item.', 'Name every current Attention id and exact rationale.')]);
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

function mergeAttentionReferences(
  target: HandoffAttentionItem['references'],
  source: HandoffAttentionItem['references'],
): void {
  for (const key of [
    'changedFiles', 'checks', 'conditions', 'obligations', 'hostPolicies',
  ] as const) {
    const values = source[key];
    if (values?.length) target[key] = sortedUnique([...(target[key] ?? []), ...values]);
  }
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

function stableRefs(
  value: unknown,
  path: string,
  issues: HandoffValidationIssue[],
): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item))) {
    issues.push(issue('references-invalid', path, 'References must be exact stable identities.', 'Use ids from the current Authoring Packet.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('references-duplicate', path, 'References must be unique.', 'Remove duplicates.'));
  }
  return [...value].sort() as string[];
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

function issue(
  code: string,
  path: string,
  message: string,
  remediation: string,
  references?: HandoffValidationIssue['references'],
): HandoffValidationIssue {
  return { code, path, message, remediation, ...(references ? { references } : {}) };
}
