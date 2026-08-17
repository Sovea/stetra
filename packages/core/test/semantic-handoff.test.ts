import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  compileDelegation,
  evaluateHandoff,
  type CognitiveHandoff,
  type CompileDelegationInput,
  type ConclusionStatus,
  type FactBundle,
  type HostPolicyEvaluation,
  type HumanDecision,
  type IndependentChallenge,
  type TaskContract,
  type VerificationRevisionInput,
} from '../src/index.ts';
import {
  checkDefinitionFingerprint,
  factBundleFingerprint,
  factCollectionId as collectionFingerprint,
} from '../src/facts/validate.ts';

const envelope = { protocol: 'cognitive-adoption' as const, schemaVersion: '1' as const };

test('prepare separates semantic, verification, and effective identities', () => {
  const first = compileDelegation(criticalInput());
  const second = compileDelegation(criticalInput());
  assert.equal(first.status, 'delegation-compiled');
  assert.equal(second.status, 'delegation-compiled');
  if (first.status !== 'delegation-compiled' || second.status !== 'delegation-compiled') return;

  assert.equal(first.contract.semanticContractId, second.contract.semanticContractId);
  assert.equal(first.contract.verificationPlanId, second.contract.verificationPlanId);
  assert.equal(first.contract.effectiveContractId, second.contract.effectiveContractId);
  assert.match(first.contract.authority.developerEvents[0].id, /^event:/);
  assert.deepEqual(first.contract.plan.lifecycle, [
    'implement', 'collect', 'judge-evidence', 'resolve', 'handoff', 'decide',
  ]);
  assert.match(first.contract.adoptionConditions[0].id, /^condition:/);
  assert.match(first.contract.adoptionConditions[0].evidenceObligations[0].id, /^obligation:/);
  if (first.contract.verificationPlan.mode !== 'checks') return;
  assert.match(first.contract.verificationPlan.verifiers[0].verifierId, /^verifier:/);
  assert.match(first.contract.verificationPlan.definitions[0].definitionId, /^sha256:/);
});

test('routine work may omit conditions but still requires an explicit verification rationale', () => {
  const input = criticalInput();
  input.conditions = [];
  input.checks = undefined;
  input.noCommandRationale = 'Documentation wording has no executable behavior.';
  const result = compileDelegation(input);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  assert.deepEqual(result.contract.adoptionConditions, []);
  assert.equal(result.contract.verificationPlan.mode, 'no-command');

  const missing = compileDelegation({ ...input, noCommandRationale: undefined });
  assert.equal(missing.status, 'verification-required');
});

test('unresolved material decisions block compilation without weakening the task contract', () => {
  const input = criticalInput();
  input.materialDecisionForks = [materialDecisionFork()];
  const result = compileDelegation(input);
  assert.equal(result.status, 'semantic-decision-required');
  if (result.status !== 'semantic-decision-required') return;
  assert.equal(result.forks.length, 1);
  assert.equal(result.forks[0].key, 'compatibility-policy');
  assert.equal(result.forks[0].resolution, undefined);
});

test('resolved material decisions bind the exact later Human event to final task meaning', () => {
  const input = criticalInput();
  input.developerEvents.push({
    key: 'compatibility-choice',
    content: 'Preserve strict compatibility.',
    provider: 'test',
  });
  input.task.basis.developerEventKeys.push('compatibility-choice');
  input.materialDecisionForks = [{
    ...materialDecisionFork(),
    resolution: {
      humanEventKey: 'compatibility-choice',
      selectedAlternativeKey: 'strict',
      decisionInterpretation: 'Strict compatibility is required.',
    },
  }];
  const result = compileDelegation(input);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  assert.equal(result.contract.authority.developerEvents.length, 2);
  assert.equal(result.contract.materialDecisions[0].resolution.selectedAlternativeKey, 'strict');
  assert.equal(
    result.contract.materialDecisions[0].resolution.humanEventId,
    result.contract.authority.developerEvents[1].id,
  );

  input.task.basis.developerEventKeys = ['request'];
  const unconsumed = compileDelegation(input);
  assert.equal(unconsumed.status, 'authority-invalid');
  if (unconsumed.status !== 'authority-invalid') return;
  assert.ok(unconsumed.issues.some((item) =>
    item.code === 'material-decision-resolution-unconsumed'));
});

test('every condition requires a falsifiable evidence obligation', () => {
  const input = criticalInput();
  input.conditions[0].evidenceObligations = [];
  const result = compileDelegation(input);
  assert.equal(result.status, 'authority-invalid');
  if (result.status === 'authority-invalid') {
    assert.ok(result.issues.some((item) => item.code === 'evidence-obligations-required'));
  }
});

test('an evidence obligation freezes a complete discriminating falsification design', () => {
  const input = criticalInput();
  input.conditions[0].evidenceObligations[0].falsification.scenario = '';
  const result = compileDelegation(input);
  assert.equal(result.status, 'authority-invalid');
  if (result.status !== 'authority-invalid') return;
  assert.ok(result.issues.some((item) =>
    item.path === 'conditions[0].evidenceObligations[0].falsification.scenario'));
});

test('adoption-critical semantics require challenge or direct Human review', () => {
  const input = criticalInput();
  input.conditions[0].evidenceObligations[0].strategies = [{
    kind: 'runtime-check', checkKeys: ['suite'],
  }];
  const result = compileDelegation(input);
  assert.equal(result.status, 'authority-invalid');
  if (result.status === 'authority-invalid') {
    assert.ok(result.issues.some((item) => item.code === 'critical-condition-review-required'));
  }

  const factTriggeredOnly = criticalInput();
  factTriggeredOnly.conditions[0].evidenceObligations[0].strategies = [
    { kind: 'runtime-check', checkKeys: ['suite'] },
    { kind: 'independent-challenge', policy: 'fact-triggered' },
  ];
  const factTriggeredResult = compileDelegation(factTriggeredOnly);
  assert.equal(factTriggeredResult.status, 'authority-invalid');
  if (factTriggeredResult.status !== 'authority-invalid') return;
  assert.ok(factTriggeredResult.issues.some((item) =>
    item.code === 'critical-condition-review-required'));
});

test('unsupported schema versions are rejected without a migration path', () => {
  assert.throws(() => compileDelegation({
    ...criticalInput(),
    schemaVersion: 'unsupported',
  } as unknown as CompileDelegationInput), /UNSUPPORTED_SCHEMA_VERSION/);
});

test('verification rebinding preserves semantic identity and supersedes exact definitions', () => {
  const prior = compiledContract();
  const source = criticalInput().checks![0];
  const result = compileDelegation({
    ...envelope,
    operation: 'revise-verification',
    priorContract: prior,
    revision: {
      kind: 'execution-rebinding',
      rationale: 'The original executable entry is unavailable in this workspace.',
      equivalenceClaim: 'The new argv invokes the same test runner and target.',
      checks: [{ ...source, argv: ['node', '--test', 'test/feature.test.ts'] }],
    },
  } satisfies VerificationRevisionInput);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  assert.equal(result.contract.semanticContractId, prior.semanticContractId);
  assert.notEqual(result.contract.verificationPlanId, prior.verificationPlanId);
  assert.notEqual(result.contract.effectiveContractId, prior.effectiveContractId);
  if (prior.verificationPlan.mode !== 'checks'
    || result.contract.verificationPlan.mode !== 'checks') return;
  const before = prior.verificationPlan.definitions[0];
  const after = result.contract.verificationPlan.definitions[0];
  assert.equal(after.verifierId, before.verifierId);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.supersedesDefinitionId, before.definitionId);
});

test('verification revision preserves the identity of unchanged definitions', () => {
  const input = criticalInput();
  input.checks!.push({
    ...input.checks![0],
    key: 'unchanged-suite',
    baseline: { mode: 'unknown' },
  });
  const compiled = compileDelegation(input);
  assert.equal(compiled.status, 'delegation-compiled');
  if (compiled.status !== 'delegation-compiled'
    || compiled.contract.verificationPlan.mode !== 'checks') return;

  const result = compileDelegation({
    ...envelope,
    operation: 'revise-verification',
    priorContract: compiled.contract,
    revision: {
      kind: 'execution-rebinding',
      rationale: 'Only one executable binding has changed.',
      equivalenceClaim: 'The changed argv invokes the same bounded verifier.',
      checks: input.checks!.map((check) => check.key === 'suite'
        ? { ...check, argv: ['node', '--test', 'test/feature.test.ts'] }
        : check),
    },
  } satisfies VerificationRevisionInput);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled'
    || result.contract.verificationPlan.mode !== 'checks') return;

  const before = compiled.contract.verificationPlan.definitions.find((definition) =>
    definition.key === 'unchanged-suite')!;
  const after = result.contract.verificationPlan.definitions.find((definition) =>
    definition.key === 'unchanged-suite')!;
  assert.deepEqual(after, before);
});

test('verification relaxation requires exact Human authority', () => {
  const prior = compiledContract();
  const source = criticalInput().checks![0];
  const revision = {
    ...envelope,
    operation: 'revise-verification' as const,
    priorContract: prior,
    revision: {
      kind: 'verification-plan' as const,
      rationale: 'The original baseline cannot be recreated.',
      equivalenceClaim: 'Current execution still observes the intended public behavior.',
      checks: [{ ...source, baseline: { mode: 'unknown' as const } }],
    },
  };
  const rejected = compileDelegation(revision);
  assert.equal(rejected.status, 'authority-invalid');
  if (rejected.status === 'authority-invalid') {
    assert.ok(rejected.issues.some((item) =>
      item.code === 'verification-relaxation-human-authorization-required'));
  }
  const authorized = compileDelegation({
    ...revision,
    revision: {
      ...revision.revision,
      humanAuthorization: { content: 'Proceed without reconstructing the original baseline.' },
    },
  });
  assert.equal(authorized.status, 'delegation-compiled');
});

test('clean handoff keeps Runtime facts, Agent recommendation, and Human adoption separate', () => {
  const contract = compiledContract();
  const facts = factBundle(contract);
  const challenges = supportedChallenges(contract, facts);
  const handoff = handoffFor(contract, facts, challenges);
  const evaluation = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges,
    currentEvidenceDisposition: undefined,
    hostPolicyEvaluations: [],
    deliveryExhausted: false,
    verificationRevised: false,
    handoff,
  });
  assert.equal(evaluation.status, 'handoff-ready');
  assert.equal(evaluation.adoption.status, 'pending');
  assert.equal(handoff.recommendation.action, 'accept');
});

test('facts-stale takes priority over malformed Agent handoff', () => {
  const contract = compiledContract();
  const facts = factBundle(contract);
  const evaluation = evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: digest('different'),
    challenges: [],
    currentEvidenceDisposition: undefined,
    hostPolicyEvaluations: [],
    deliveryExhausted: false,
    verificationRevised: false,
    handoff: {} as CognitiveHandoff,
  });
  assert.equal(evaluation.status, 'facts-stale');
});

test('changed acceptance surface triggers every related fact-triggered obligation', () => {
  const input = criticalInput('fact-triggered');
  input.conditions.push({
    key: 'shared-material',
    statement: 'The shared behavior remains understandable.',
    rationale: 'A second adoption decision consumes the same verifier.',
    criticality: 'material',
    evidenceObligations: [{
      key: 'shared-boundary',
      statement: 'The shared boundary remains stable.',
      falsification: {
        failureHypothesis: 'The changed verifier could accept an incompatible boundary.',
        scenario: 'Exercise the incompatible boundary against the changed verifier.',
        supportingObservation: 'The verifier rejects the incompatible boundary.',
        contradictingObservation: 'The verifier accepts the incompatible boundary.',
      },
      strategies: [
        { kind: 'runtime-check', checkKeys: ['suite'] },
        { kind: 'independent-challenge', policy: 'fact-triggered' },
      ],
    }],
  });
  const result = compileDelegation(input);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  const contract = result.contract;
  const facts = factBundle(contract, { changedAcceptanceSurface: true });
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false,
    handoff: handoffFor(contract, facts, []),
  }), /required challenge is missing/);
  const handoff = handoffFor(contract, facts, [], 'partial');
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  const obligationIds = contract.adoptionConditions
    .flatMap((condition) => condition.evidenceObligations.map((item) => item.id)).sort();
  assert.deepEqual(evaluation.requiredChallengeObligationIds, obligationIds);
  assert.equal(evaluation.attention.filter((item) => item.codes.includes('challenge-missing')).length, 2);
  assert.ok(evaluation.attention.every((item) => item.codes.length === 1));
});

test('challenge changed-file evidence uses the canonical Runtime fact identity', () => {
  const contract = compiledContract('fact-triggered');
  const facts = factBundle(contract, { changedAcceptanceSurface: true });
  const obligation = contract.adoptionConditions[0].evidenceObligations[0];
  const challenge: IndependentChallenge = {
    ...envelope,
    id: 'challenge:changed-verifier',
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    obligationIds: [obligation.id],
    conditionIds: [obligation.conditionId],
    independence: 'host-attested',
    implementerContextId: 'context:implementer',
    challengerContextId: 'context:changed-verifier',
    attestationId: 'attestation:changed-verifier',
    falsification: obligation.falsification,
    evidence: {
      changedFiles: [facts.changedFiles[0].id],
      checks: facts.checks.map((item) => item.definitionId),
      repositoryEvidence: [],
      humanEvents: [],
      patch: false,
    },
    falsificationAttempt: 'Inspected the changed verifier and exercised the bounded behavior independently.',
    observedResult: 'The incompatible boundary was rejected as required.',
    supportingEvidence: [{
      statement: 'The exact changed verifier and frozen check were inspected together.',
      references: [
        { kind: 'changed-file', id: facts.changedFiles[0].id },
        ...facts.checks.map((item) => ({ kind: 'check' as const, id: item.definitionId })),
      ],
    }],
    counterEvidence: [],
    outcome: 'supported',
    conclusion: 'The bounded failure hypothesis was not observed.',
  };
  const handoff = handoffFor(contract, facts, [challenge]);
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [challenge], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  assert.equal(evaluation.requiredChallengeObligationIds[0], obligation.id);

  const pathReference = {
    ...challenge,
    evidence: { ...challenge.evidence, changedFiles: [facts.changedFiles[0].path] },
  };
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [pathReference], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), (error: unknown) => {
    const candidate = error as { issues?: Array<{ code: string; path: string }> };
    assert.ok(candidate.issues?.some((item) =>
      item.code === 'challenge-evidence-reference-invalid'
      && item.path === 'challenges[0].evidence.changedFiles[0]'));
    return true;
  });
});

test('a challenge cannot rewrite the frozen falsification design', () => {
  const contract = compiledContract();
  const facts = factBundle(contract);
  const challenges = supportedChallenges(contract, facts);
  challenges[0].falsification = {
    ...challenges[0].falsification,
    scenario: 'A different scenario selected after implementation.',
  };
  const handoff = handoffFor(contract, facts, challenges);
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /falsification design/);
});

test('a condition cannot claim support beyond its obligation conclusions', () => {
  const contract = compiledContract();
  const facts = factBundle(contract);
  const challenges = supportedChallenges(contract, facts);
  const handoff = handoffFor(contract, facts, challenges, 'partial');
  handoff.conditionConclusions[0].status = 'supported';
  handoff.handoffFingerprint = fingerprint(withoutFingerprint(handoff));
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /cannot be supported while any evidence obligation/);
});

test('Agent accept recommendation cannot exceed unresolved conclusions and unknowns', () => {
  const contract = compiledContract('fact-triggered');
  const facts = factBundle(contract);
  const handoff = handoffFor(contract, facts, [], 'partial');
  handoff.recommendation = {
    action: 'accept',
    rationale: 'The Agent attempts to accept unresolved evidence.',
    caveats: [],
  };
  handoff.handoffFingerprint = fingerprint(withoutFingerprint(handoff));
  assert.throws(() => evaluateHandoff({
    ...envelope,
    contract,
    factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [],
    currentEvidenceDisposition: undefined,
    hostPolicyEvaluations: [],
    deliveryExhausted: false,
    verificationRevised: false,
    handoff,
  }), (error: unknown) => Boolean(error && typeof error === 'object'
    && 'issues' in error
    && Array.isArray(error.issues)
    && error.issues.some((item: { code?: string }) =>
      item.code === 'recommendation-evidence-conflict')));
});

test('an unverified required challenge cannot support its obligation', () => {
  const contract = compiledContract();
  const facts = factBundle(contract);
  const [attested] = supportedChallenges(contract, facts);
  const {
    implementerContextId: _implementerContextId,
    challengerContextId: _challengerContextId,
    attestationId: _attestationId,
    ...challengeProjection
  } = attested;
  const challenge: IndependentChallenge = {
    ...challengeProjection,
    independence: 'unverified',
  };
  const handoff = handoffFor(contract, facts, [challenge]);
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [challenge], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /lacks trusted Host independence/);
});

test('an unresolved required challenge needs an obligation-specific review question', () => {
  const contract = compiledContract('fact-triggered');
  const facts = factBundle(contract, { changedAcceptanceSurface: true });
  const handoff = handoffFor(contract, facts, [], 'partial');
  handoff.reviewQuestions[0].obligationIds = [];
  handoff.handoffFingerprint = fingerprint(withoutFingerprint(handoff));

  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: undefined, hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /directly bound review question/);
});

test('thin Host policy claims remain visible and cannot impersonate enforcement', () => {
  const input = criticalInput();
  input.hostPolicyRequirements = [{
    key: 'no-web', capability: 'web-search', requiredState: 'disabled',
    enforcementRequirement: 'required', rationale: 'The paired task forbids Web access.',
  }];
  const result = compileDelegation(input);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  const contract = result.contract;
  const facts = factBundle(contract);
  const challenges = supportedChallenges(contract, facts);
  const handoff = handoffFor(contract, facts, challenges);
  const hostPolicyEvaluations: HostPolicyEvaluation[] = [{
    requirementId: contract.hostPolicyRequirements[0].id,
    mode: 'instruction-only', provenance: 'thin-skill',
  }];
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, currentEvidenceDisposition: undefined, hostPolicyEvaluations,
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /host-policy-required-unenforced/);
  handoff.recommendation.action = 'defer';
  handoff.handoffFingerprint = fingerprint(withoutFingerprint(handoff));
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, currentEvidenceDisposition: undefined, hostPolicyEvaluations,
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  assert.ok(evaluation.attention.some((item) => item.codes.includes('host-policy-unverified')));

  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, currentEvidenceDisposition: undefined,
    hostPolicyEvaluations: [{
      requirementId: contract.hostPolicyRequirements[0].id,
      mode: 'enforced', provenance: 'thin-skill', attestationId: 'attestation:fake',
    }],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /host policy evaluation is invalid/);
});

test('non-passing facts remain inspectable and explicit Human exceptions preserve authority', () => {
  const contract = compiledContract('fact-triggered');
  const facts = factBundle(contract, { currentStatus: 'failed', baselineStatus: 'passed' });
  const handoff = handoffFor(contract, facts, [], 'unknown');
  for (const conclusion of handoff.obligationConclusions) {
    const adverseChecks = conclusion.evidence.filter((item) => item.kind === 'check');
    conclusion.evidence = conclusion.evidence.filter((item) => item.kind !== 'check');
    conclusion.counterEvidence = adverseChecks;
  }
  handoff.handoffFingerprint = fingerprint(withoutFingerprint(handoff));
  const dispositionProjection = {
    ...envelope,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    semanticImpact: 'none' as const,
    proposedRoute: 'handoff' as const,
    routeRationale: 'Carry the environment limitation into Human adoption review.',
    entries: [{
      source: { kind: 'check' as const, definitionId: facts.checks[0].definitionId },
      cause: 'environment' as const,
      diagnosis: 'The runner dependency was unavailable.',
      falsificationAttempt: 'Checked whether implementation edits can restore the runner.',
      codeChangeCanAlterObservation: false,
      expectedDifferentObservation: 'The frozen command starts when the runner is available.',
      intendedChanges: [],
    }],
    route: 'handoff' as const,
  };
  const evidenceDispositions = [{
    dispositionId: fingerprint(dispositionProjection), ...dispositionProjection,
  }];
  const ambiguousHandoff = structuredClone(handoff);
  ambiguousHandoff.obligationConclusions[0].evidence.push(
    ambiguousHandoff.obligationConclusions[0].counterEvidence[0],
  );
  ambiguousHandoff.handoffFingerprint = fingerprint(withoutFingerprint(ambiguousHandoff));
  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: evidenceDispositions[0], hostPolicyEvaluations: [],
    deliveryExhausted: true, verificationRevised: false, handoff: ambiguousHandoff,
  }), /same reference cannot be both supporting and counter-evidence/i);
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: evidenceDispositions[0], hostPolicyEvaluations: [],
    deliveryExhausted: true, verificationRevised: false, handoff,
  });
  assert.equal(evaluation.status, 'needs-attention');
  assert.ok(evaluation.attention.some((item) => item.codes.includes('verification-nonpassing')));
  assert.ok(evaluation.attention.some((item) => item.codes.includes('repair-route-exhausted')));
  assert.deepEqual(
    evaluation.attention.filter((item) => item.group === 'delivery').map((item) => item.codes),
    [['repair-route-exhausted']],
  );

  const decision = decisionFor(contract, facts, handoff, evaluation.attention.map((item) => item.id));
  const accepted = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], currentEvidenceDisposition: evidenceDispositions[0], hostPolicyEvaluations: [],
    deliveryExhausted: true, verificationRevised: false, handoff, decision,
  });
  assert.equal(accepted.adoption.status, 'accepted');
});

function criticalInput(policy: 'required' | 'fact-triggered' = 'required'): CompileDelegationInput {
  return {
    ...envelope,
    developerEvents: [{ key: 'request', content: 'Keep compatibility intact.', provider: 'test' }],
    task: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Change the behavior without losing the old path.',
      constraints: ['Preserve the public contract.'],
      nonGoals: [],
      focus: ['src/feature.ts'],
    },
    materialDecisionForks: [],
    conditions: [{
      key: 'compatibility',
      statement: 'Existing callers retain their behavior.',
      rationale: 'A wrong change breaks adoption.',
      criticality: policy === 'required' ? 'adoption-critical' : 'material',
      evidenceObligations: [{
        key: 'legacy-path',
        statement: 'The legacy call path retains its behavior.',
        falsification: {
          failureHypothesis: 'The new branch may bypass the legacy call path.',
          scenario: 'Exercise the legacy call path through the new branch.',
          supportingObservation: 'The legacy path retains its prior behavior.',
          contradictingObservation: 'The new branch bypasses or changes the legacy path.',
        },
        strategies: [
          { kind: 'runtime-check', checkKeys: ['suite'] },
          { kind: 'independent-challenge', policy },
        ],
      }],
    }],
    hostPolicyRequirements: [],
    delivery: { maxRepairAttempts: 2 },
    checks: [{
      key: 'suite',
      rationale: 'Exercises the public behavior.',
      argv: ['node', '--test'],
      baseline: {
        mode: 'task-start',
        rationale: 'The before/after result distinguishes a regression from a pre-existing failure.',
        obligationKeys: [{ conditionKey: 'compatibility', obligationKey: 'legacy-path' }],
      },
      verifierSelectors: [
        { kind: 'file', path: 'package.json', role: 'command-definition' },
        { kind: 'file', path: 'test/feature.test.ts', role: 'acceptance-surface' },
      ],
    }],
  };
}

function materialDecisionFork(): CompileDelegationInput['materialDecisionForks'][number] {
  return {
    key: 'compatibility-policy',
    basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
    question: 'Which compatibility policy should govern the public behavior?',
    alternatives: [
      {
        key: 'strict',
        statement: 'Preserve strict compatibility.',
        impact: 'Existing callers retain the exact public behavior.',
      },
      {
        key: 'intentional-break',
        statement: 'Allow an intentional breaking change.',
        impact: 'Existing callers must adapt to the new public behavior.',
      },
    ],
    recommendation: {
      alternativeKey: 'strict',
      rationale: 'The original request explicitly requires compatibility.',
    },
  };
}

function compiledContract(policy: 'required' | 'fact-triggered' = 'required'): TaskContract {
  const result = compileDelegation(criticalInput(policy));
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') throw new Error('fixture did not compile');
  return result.contract;
}

function factBundle(
  contract: TaskContract,
  options: {
    currentStatus?: 'passed' | 'failed' | 'unavailable';
    baselineStatus?: 'passed' | 'failed' | 'unavailable';
    changedAcceptanceSurface?: boolean;
  } = {},
): FactBundle {
  if (contract.verificationPlan.mode !== 'checks') throw new Error('fixture requires checks');
  const currentStatus = options.currentStatus ?? 'passed';
  const baselineStatus = options.baselineStatus ?? 'passed';
  const implementationBaseline = worktree('baseline-post');
  const baselineWithoutFingerprint = {
    capturedAt: '2026-08-11T00:00:00.000Z',
    preCheck: worktree('baseline-pre'),
    postCheck: implementationBaseline,
    checkInducedChanges: [],
    checks: contract.verificationPlan.definitions.map((definition) => ({
      definitionId: definition.definitionId,
      mode: definition.baseline.mode,
      observation: definition.baseline.mode === 'task-start'
        ? checkFact(definition, baselineStatus) : null,
    })),
  };
  const changedFile = {
    id: 'file:verifier', path: 'test/feature.test.ts', operation: 'modified' as const,
    representation: 'metadata-only' as const,
  };
  const checks = contract.verificationPlan.definitions.map((definition) =>
    checkFact(definition, currentStatus));
  const base = {
    ...envelope,
    effectiveContractId: contract.effectiveContractId,
    attemptId: 'attempt:1',
    collectedAt: '2026-08-11T00:01:00.000Z',
    baseline: implementationBaseline,
    preCheck: worktree('current-pre'),
    current: worktree('current-post'),
    baselineVerification: {
      fingerprint: fingerprint(baselineWithoutFingerprint), ...baselineWithoutFingerprint,
    },
    changeFingerprint: digest('change'),
    changedFiles: options.changedAcceptanceSurface ? [changedFile] : [],
    checkInducedChanges: [],
    checks,
    checkComparisons: checks.map((check) => ({
      definitionId: check.definitionId,
      relation: `${baselineStatus}-before-${currentStatus}-now` as FactBundle['checkComparisons'][number]['relation'],
    })),
    verifierMutations: options.changedAcceptanceSurface
      ? contract.verificationPlan.definitions.map((definition) => ({
          verifierId: definition.verifierId,
          definitionId: definition.definitionId,
          selector: {
            kind: 'file' as const,
            path: 'test/feature.test.ts',
            role: 'acceptance-surface' as const,
          },
          changedFileId: changedFile.id,
          changedPath: changedFile.path,
          matchedBy: 'current-path' as const,
        })) : [],
    environment: {
      platform: 'linux', architecture: 'x64', cwdFingerprint: digest('cwd'),
      executables: [], toolchains: [], lockfiles: [], environmentVariableNames: [],
    },
    provenance: { collector: 'stetra-cli' as const, cliVersion: '0.0.1', coreVersion: '0.0.1' },
  };
  const factCollectionId = collectionFingerprint(base);
  const withCollection = { ...base, factCollectionId };
  return { ...withCollection, bundleFingerprint: factBundleFingerprint(withCollection) };
}

function checkFact(
  definition: Extract<TaskContract['verificationPlan'], { mode: 'checks' }>['definitions'][number],
  status: 'passed' | 'failed' | 'unavailable',
) {
  const stream = { digest: digest(''), byteLength: 0, persistedBytes: 0, truncated: false };
  return {
    verifierId: definition.verifierId,
    definitionId: definition.definitionId,
    argv: [...definition.argv],
    definitionFingerprint: checkDefinitionFingerprint(definition),
    attempts: [{
      attempt: 1,
      startedAt: '2026-08-11T00:00:30.000Z',
      durationMs: 12,
      timeoutMs: 1000,
      status,
      termination: status === 'passed'
        ? { kind: 'exit' as const, exitCode: 0 }
        : status === 'failed'
          ? { kind: 'exit' as const, exitCode: 1 }
          : { kind: 'spawn-error' as const, code: 'ENOENT' },
      outcomeFingerprint: digest(`output:${status}`),
      stdout: stream,
      stderr: stream,
    }],
  };
}

function handoffFor(
  contract: TaskContract,
  facts: FactBundle,
  challenges: IndependentChallenge[],
  status: ConclusionStatus = 'supported',
): CognitiveHandoff {
  const challengeByObligation = new Map(challenges.flatMap((challenge) =>
    challenge.obligationIds.map((id) => [id, challenge] as const)));
  const obligations = contract.adoptionConditions.flatMap((condition) => condition.evidenceObligations);
  const projection = {
    ...envelope,
    handoffId: 'handoff:1',
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    summary: 'The implementation updates the requested behavior.',
    obligationConclusions: obligations.map((obligation) => {
      const challenge = challengeByObligation.get(obligation.id);
      return {
        obligationId: obligation.id,
        status,
        evidence: [
          ...facts.checks.map((check) => ({ kind: 'check' as const, id: check.definitionId })),
          ...(challenge ? [{ kind: 'challenge' as const, id: challenge.id }] : []),
        ],
        falsification: {
          attempt: 'Exercised the legacy path and inspected the most plausible bypass.',
          observedResult: 'The legacy path retained the expected behavior.',
        },
        counterEvidence: [],
        conclusion: status === 'supported'
          ? 'The bounded obligation is supported.' : 'The bounded obligation remains unresolved.',
      };
    }),
    conditionConclusions: contract.adoptionConditions.map((condition) => ({
      conditionId: condition.id,
      status,
      summary: status === 'supported'
        ? 'All declared evidence obligations are supported.' : 'Evidence remains unresolved.',
    })),
    importantSystemEffects: ['Public behavior changes only at the requested boundary.'],
    residualUnknowns: status === 'supported' ? [] : [{
      conditionIds: contract.adoptionConditions.map((item) => item.id),
      obligationIds: obligations.map((item) => item.id),
      statement: 'The environment prevented a conclusive observation.',
      adoptionImpact: 'Compatibility is not established.',
      nextAction: 'Review the failure and rerun in a working environment.',
      evidence: facts.checks.map((check) => ({ kind: 'check' as const, id: check.definitionId })),
    }],
    reviewQuestions: contract.adoptionConditions.map((condition) => ({
      id: `review:${condition.key}`,
      conditionIds: [condition.id],
      obligationIds: condition.evidenceObligations.map((item) => item.id),
      question: 'Does the changed path preserve the required behavior?',
      adoptionImpact: 'A mismatch breaks compatibility.',
      evidence: facts.checks.map((check) => ({ kind: 'check' as const, id: check.definitionId })),
    })),
    recommendation: {
      action: status === 'supported' ? 'accept' as const : 'defer' as const,
      rationale: status === 'supported' ? 'The bounded claims are supported.' : 'Evidence is incomplete.',
      caveats: [],
    },
  };
  return { ...projection, handoffFingerprint: fingerprint(projection) };
}

function supportedChallenges(contract: TaskContract, facts: FactBundle): IndependentChallenge[] {
  const obligations = contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.filter((obligation) => obligation.strategies.some((strategy) =>
      strategy.kind === 'independent-challenge' && strategy.policy === 'required')));
  return obligations.map((obligation, index) => ({
    ...envelope,
    id: `challenge:${index + 1}`,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    obligationIds: [obligation.id],
    conditionIds: [obligation.conditionId],
    independence: 'host-attested',
    implementerContextId: 'context:implementer',
    challengerContextId: `context:challenger-${index + 1}`,
    attestationId: `attestation:${index + 1}`,
    falsification: obligation.falsification,
    evidence: {
      changedFiles: [],
      checks: facts.checks.map((item) => item.definitionId),
      repositoryEvidence: [],
      humanEvents: [],
      patch: false,
    },
    falsificationAttempt: 'Inspected and exercised the compatibility path independently.',
    observedResult: 'The compatibility path retained the expected behavior.',
    supportingEvidence: [{
      statement: 'The frozen check exercises the compatibility path.',
      references: facts.checks.map((item) => ({ kind: 'check' as const, id: item.definitionId })),
    }],
    counterEvidence: [],
    outcome: 'supported',
    conclusion: 'The failure hypothesis was not observed.',
  }));
}

function decisionFor(
  contract: TaskContract,
  facts: FactBundle,
  handoff: CognitiveHandoff,
  attentionIds: string[],
): HumanDecision {
  const content = 'Accept with the recorded evidence exceptions.';
  return {
    ...envelope,
    decisionId: 'decision:1',
    humanEvent: {
      id: 'event:decision', kind: 'decision', content, contentFingerprint: digest(content),
    },
    action: 'accepted',
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    handoffId: handoff.handoffId,
    handoffFingerprint: handoff.handoffFingerprint,
    reason: content,
    exceptions: attentionIds.map((attentionId) => ({
      attentionId, rationale: 'Accepted knowingly.',
    })),
  };
}

function withoutFingerprint(handoff: CognitiveHandoff) {
  const { handoffFingerprint: _ignored, ...projection } = handoff;
  return projection;
}

function worktree(seed: string) {
  return {
    head: null,
    fingerprint: digest(seed),
    entryCount: 0,
    capturedAt: '2026-08-11T00:00:00.000Z',
  };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fingerprint(value: unknown): string {
  return digest(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}
