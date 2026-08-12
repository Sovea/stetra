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
  assert.match(first.contract.authority.developerEvent.id, /^event:/);
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

test('every condition requires a falsifiable evidence obligation', () => {
  const input = criticalInput();
  input.conditions[0].evidenceObligations = [];
  const result = compileDelegation(input);
  assert.equal(result.status, 'authority-invalid');
  if (result.status === 'authority-invalid') {
    assert.ok(result.issues.some((item) => item.code === 'evidence-obligations-required'));
  }
});

test('adoption-critical semantics require challenge or direct Human review', () => {
  const input = criticalInput();
  input.conditions[0].evidenceObligations[0].strategies = [{
    kind: 'runtime-check', checkKeys: ['suite'], expectedObservation: 'passed',
  }];
  const result = compileDelegation(input);
  assert.equal(result.status, 'authority-invalid');
  if (result.status === 'authority-invalid') {
    assert.ok(result.issues.some((item) => item.code === 'critical-condition-review-required'));
  }
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
    evidenceDispositions: [],
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
    evidenceDispositions: [],
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
      failureHypothesis: 'The changed verifier could accept an incompatible boundary.',
      strategies: [
        { kind: 'runtime-check', checkKeys: ['suite'], expectedObservation: 'passed' },
        { kind: 'independent-challenge', policy: 'fact-triggered' },
      ],
    }],
  });
  const result = compileDelegation(input);
  assert.equal(result.status, 'delegation-compiled');
  if (result.status !== 'delegation-compiled') return;
  const contract = result.contract;
  const facts = factBundle(contract, { changedAcceptanceSurface: true });
  const handoff = handoffFor(contract, facts, []);
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], evidenceDispositions: [], hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  const obligationIds = contract.adoptionConditions
    .flatMap((condition) => condition.evidenceObligations.map((item) => item.id)).sort();
  assert.deepEqual(evaluation.requiredChallengeObligationIds, obligationIds);
  assert.equal(evaluation.attention.filter((item) => item.codes.includes('challenge-missing')).length, 2);
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
    challenges, evidenceDispositions: [], hostPolicyEvaluations: [],
    deliveryExhausted: false, verificationRevised: false, handoff,
  }), /cannot be supported while any evidence obligation/);
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
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, evidenceDispositions: [], hostPolicyEvaluations,
    deliveryExhausted: false, verificationRevised: false, handoff,
  });
  assert.ok(evaluation.attention.some((item) => item.codes.includes('host-policy-unverified')));

  assert.throws(() => evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges, evidenceDispositions: [],
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
  const dispositionProjection = {
    ...envelope,
    effectiveContractId: contract.effectiveContractId,
    attemptId: facts.attemptId,
    factCollectionId: facts.factCollectionId,
    semanticImpact: 'none' as const,
    entries: [{
      definitionId: facts.checks[0].definitionId,
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
  const evaluation = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], evidenceDispositions, hostPolicyEvaluations: [],
    deliveryExhausted: true, verificationRevised: false, handoff,
  });
  assert.equal(evaluation.status, 'needs-attention');
  assert.ok(evaluation.attention.some((item) => item.codes.includes('verification-nonpassing')));
  assert.ok(evaluation.attention.some((item) => item.codes.includes('repair-route-exhausted')));

  const decision = decisionFor(contract, facts, handoff, evaluation.attention.map((item) => item.id));
  const accepted = evaluateHandoff({
    ...envelope, contract, factBundle: facts,
    currentWorktreeFingerprint: facts.current.fingerprint,
    challenges: [], evidenceDispositions, hostPolicyEvaluations: [],
    deliveryExhausted: true, verificationRevised: false, handoff, decision,
  });
  assert.equal(accepted.adoption.status, 'accepted');
});

function criticalInput(policy: 'required' | 'fact-triggered' = 'required'): CompileDelegationInput {
  return {
    ...envelope,
    developerEvent: { content: 'Keep compatibility intact.', provider: 'test' },
    task: {
      desiredOutcome: 'Change the behavior without losing the old path.',
      constraints: ['Preserve the public contract.'],
      nonGoals: [],
      focus: ['src/feature.ts'],
    },
    conditions: [{
      key: 'compatibility',
      statement: 'Existing callers retain their behavior.',
      rationale: 'A wrong change breaks adoption.',
      criticality: 'adoption-critical',
      evidenceObligations: [{
        key: 'legacy-path',
        statement: 'The legacy call path retains its behavior.',
        failureHypothesis: 'The new branch may bypass the legacy call path.',
        strategies: [
          { kind: 'runtime-check', checkKeys: ['suite'], expectedObservation: 'passed' },
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
      commandDefinitionPaths: ['package.json'],
      acceptanceSurfacePaths: ['test/feature.test.ts'],
    }],
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
          path: 'test/feature.test.ts',
          role: 'acceptance-surface' as const,
          changedFileId: changedFile.id,
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
      exitCode: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
      timedOut: false,
      outputDigest: digest(`output:${status}`),
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
        falsificationAttempt: 'Exercised the legacy path and inspected the most plausible bypass.',
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
    failureHypothesis: obligation.failureHypothesis,
    evidence: {
      changedFiles: [],
      checks: facts.checks.map((item) => item.definitionId),
      repositoryEvidence: [],
      humanEvents: [],
      patch: false,
    },
    falsificationAttempt: 'Inspected and exercised the compatibility path independently.',
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
