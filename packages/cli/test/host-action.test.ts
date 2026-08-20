import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactBundle, HandoffAttentionItem } from '@sovea/stetra-core';

import type { AuthoringPacket } from '../src/workflow/authoring.ts';
import type { ChallengeExecutionPacket } from '../src/workflow/challenge-projection.ts';
import {
  aggregateDecisionAttention,
  type DeveloperDecisionBrief,
} from '../src/workflow/decision-brief.ts';
import {
  adverseChallengeHostAction,
  collectedHostAction,
  compileProblemHostAction,
  diagnosisHostAction,
  handoffHostAction,
  preparedHostAction,
  resolutionHostAction,
  staleFactsHostAction,
} from '../src/workflow/host-action.ts';

test('decision attention groups only by exact group and required resolution', () => {
  const attention = [
    attentionItem('attention:one', 'obligation', 'inspect', {
      obligations: ['obligation:one'],
    }),
    attentionItem('attention:two', 'obligation', 'inspect', {
      obligations: ['obligation:two'], conditions: ['condition:two'],
    }),
    attentionItem('attention:three', 'obligation', 'repair', {
      obligations: ['obligation:one'],
    }),
  ];

  const grouped = aggregateDecisionAttention(attention);

  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0], {
    group: 'obligation', resolution: 'inspect',
    references: {
      obligations: ['obligation:one', 'obligation:two'], conditions: ['condition:two'],
    },
    items: [attention[0], attention[1]],
  });
  assert.deepEqual(grouped[1], {
    group: 'obligation', resolution: 'repair',
    references: { obligations: ['obligation:one'] },
    items: [attention[2]],
  });
});

test('host actions route the initial lifecycle with executable task argv', () => {
  assert.deepEqual(preparedHostAction('task-id'), {
    kind: 'implement-and-collect', reference: 'delivery',
    executionRequirements: {
      context: 'continuous', targetWorktree: 'read-write', stetraState: 'read-write',
      workspace: 'target', externalEffects: 'contract-policy',
    },
    command: { argv: ['stetra', 'change', 'collect', '.', '--task', 'task-id', '--json'] },
  });
  assert.equal(diagnosisHostAction('repair-delivery', 'task-id').kind, 'implement-and-collect');
  const challenge = diagnosisHostAction('challenge', 'task-id', challengePacket());
  assert.equal(challenge.kind, 'perform-independent-challenge');
  assert.equal(challenge.challengeExecutionRequest?.role, 'independent-challenger');
  assert.equal(challenge.challengeExecutionRequest?.agentProfile, 'stetra-challenger');
  assert.equal(challenge.challengeExecutionRequest?.bindsTo.taskId, 'task-id');
  assert.equal(challenge.challengeExecutionRequest?.bindsTo.effectiveContractId, digest('e'));
  assert.equal(challenge.challengeExecutionRequest?.bindsTo.attemptId, 'attempt:1');
  assert.equal(challenge.challengeExecutionRequest?.bindsTo.factCollectionId, digest('c'));
  assert.equal(challenge.challengeExecutionRequest?.bindsTo.worktreeFingerprint, digest('w'));
  assert.match(
    challenge.challengeExecutionRequest?.bindsTo.challengeExecutionPacketFingerprint ?? '',
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.match(challenge.challengeExecutionRequest?.requestId ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(challenge.challengeExecutionRequest?.workspacePolicy, {
    targetWorktree: 'read-only',
    executionWorkspace: 'isolated-writable',
    externalEffects: 'forbidden',
  });
  assert.equal(challenge.challengeExecutionRequest?.contextPolicy, 'fresh-required');
  assert.equal(challenge.challengeExecutionRequest?.outputRepairBudget, 1);
  assert.deepEqual(challenge.challengeExecutionRequest?.expectedOutput, {
    serialization: 'json', schema: 'challenge-round-document', source: 'challengeExecutionPacket.draft',
  });
  assert.equal(challenge.authoringPacket, undefined);
  assert.equal(challenge.challengeExecutionPacket?.cases[0].target.obligation.id, 'obligation:test');
  assert.equal(challenge.inputBinding?.source, 'challengeExecutionPacket.draft');
  assert.deepEqual(challenge.executionRequirements, {
    context: 'continuous', targetWorktree: 'read-only', stetraState: 'read-write',
    workspace: 'target', externalEffects: 'forbidden',
  });
  assert.equal(diagnosisHostAction(
    'revise-verification', 'task-id', packet('verification-revision'),
  ).kind, 'revise-verification');
  assert.equal(diagnosisHostAction('handoff', 'task-id', packet('handoff')).kind, 'author-handoff');
  const resolution = diagnosisHostAction('ask-human', 'task-id', packet('resolution'));
  assert.equal(resolution.kind, 'resolve-evidence-decision');
  assert.deepEqual(resolution.command?.argv.slice(0, 4), ['stetra', 'change', 'resolve', '.']);
  assert.deepEqual(resolution.inputBinding, {
    transport: 'stdin', source: 'authoringPacket.draft', serialization: 'json', execution: 'one-shot',
  });
  assert.equal(staleFactsHostAction('task-id').kind, 'recollect-stale-facts');
  const handoff = handoffHostAction('needs-attention', 'task-id', brief(), packet('decision'));
  assert.equal(handoff.kind, 'present-handoff-and-await-human-decision');
  assert.equal(handoff.command, undefined);
  assert.equal(handoff.authoringPacket, undefined);
  assert.equal(handoff.decisionContinuation?.requiresNewHumanEvent, true);
  assert.equal(handoff.executionRequirements.stetraState, 'read-only');
  assert.equal(handoff.decisionContinuation?.executionRequirements.stetraState, 'read-write');
  assert.deepEqual(handoff.decisionContinuation?.command.argv.slice(0, 4), [
    'stetra', 'change', 'decide', '.',
  ]);
  assert.deepEqual(handoff.presentationRequirements, {
    leadWithDecisionState: true,
    requiredConditionIds: ['condition:test'],
    requiredDecisionIssueIds: ['decision-issue:test'],
    requiredReviewQuestionIds: ['review:test'],
    prohibitImpliedAdoption: true,
  });
  assert.equal(resolutionHostAction('task-id', packet('resolution')).authoringPacket?.inputKind, 'resolution');
  assert.equal(
    adverseChallengeHostAction('task-id', packet('diagnosis')).kind,
    'diagnose-collected-evidence',
  );
});

test('collection routes timeout, diagnosis, required challenge, and ordinary handoff from explicit inputs', () => {
  const passed = factFixture('passed');
  const common = {
    facts: passed,
    taskId: 'task-id',
    diagnosisPacket: packet('diagnosis'),
    challengePacket: challengePacket(),
    handoffPacket: packet('handoff'),
  };
  assert.equal(collectedHostAction({
    ...common, pendingChallengeObligationIds: [],
  }).kind, 'author-handoff');
  assert.equal(collectedHostAction({
    ...common, pendingChallengeObligationIds: ['obligation:test'],
  }).kind, 'perform-independent-challenge');
  const failed = factFixture('failed');
  assert.equal(collectedHostAction({
    ...common, facts: failed, pendingChallengeObligationIds: [],
  }).kind, 'diagnose-collected-evidence');

  const timedOut = factFixture('unavailable');
  timedOut.checks[0].attempts[0].termination = { kind: 'timeout' };
  const retry = collectedHostAction({
    ...common, facts: timedOut, pendingChallengeObligationIds: [],
  });
  assert.equal(retry.kind, 'retry-timed-out-check');
  assert.match(retry.command!.argv.join(' '), /integer-greater-than-1000/);
});

test('compile problems preserve Human choice, verification, and protocol distinctions', () => {
  const clarification = compileProblemHostAction('semantic-decision-required', {
    prepareRequestId: 'prepare:test',
    developerEvents: [{ key: 'request', content: 'Choose the compatibility policy.' }],
    taskInterpretation: {
      basis: { developerEventKeys: ['request'], repositoryEvidenceKeys: [] },
      desiredOutcome: 'Apply the chosen policy.', constraints: [], nonGoals: [], focus: [],
    },
    forks: [],
  });
  assert.equal(clarification.kind, 'resolve-human-choice');
  assert.equal(clarification.clarificationContinuation?.requiresNewHumanEvent, true);
  assert.equal(compileProblemHostAction('verification-required').kind, 'configure-verification');
  assert.equal(compileProblemHostAction('authority-invalid').kind, 'correct-protocol-input');
});

function factFixture(status: 'passed' | 'failed' | 'unavailable'): FactBundle {
  const check = {
    verifierId: 'verifier:test', definitionId: digest('f'), assertionArgv: ['test'],
    definitionFingerprint: digest('d'),
    attempts: [{
      attempt: 1, startedAt: '2026-08-10T00:00:00.000Z', durationMs: 3,
      timeoutMs: 1000, status,
      observedPhase: 'assertion' as const,
      termination: status === 'passed'
        ? { kind: 'exit' as const, exitCode: 0 }
        : status === 'failed'
          ? { kind: 'exit' as const, exitCode: 1 }
          : { kind: 'spawn-error' as const, code: 'ENOENT' },
      outcomeFingerprint: digest('o'), stdout: stream('2'), stderr: stream('3'),
      steps: [{
        stepId: digest('step'), role: 'assertion' as const, argv: ['test'],
        startedAt: '2026-08-10T00:00:00.000Z', durationMs: 3,
        timeoutMs: 1000, status,
        termination: status === 'passed'
          ? { kind: 'exit' as const, exitCode: 0 }
          : status === 'failed'
            ? { kind: 'exit' as const, exitCode: 1 }
            : { kind: 'spawn-error' as const, code: 'ENOENT' },
        outcomeFingerprint: digest('step-outcome'), stdout: stream('2'), stderr: stream('3'),
      }],
      executionInputs: {
        beforePreparation: inputSnapshot(),
        readyForAssertion: inputSnapshot(),
        afterAssertion: inputSnapshot(),
      },
    }],
  };
  return {
    protocol: 'cognitive-adoption', schemaVersion: '1', factCollectionId: digest('c'),
    bundleFingerprint: digest('b'), effectiveContractId: digest('e'), attemptId: 'attempt:1',
    collectedAt: '2026-08-10T00:00:00.000Z', baseline: summary('a'),
    preCheck: summary('b'), current: summary('c'),
    preCheckExecutionInputs: [inputSnapshot()], currentExecutionInputs: [inputSnapshot()],
    baselineVerification: {
      fingerprint: digest('v'), capturedAt: '2026-08-10T00:00:00.000Z',
      preCheck: summary('a'), postCheck: summary('a'),
      preCheckExecutionInputs: [inputSnapshot()], postCheckExecutionInputs: [inputSnapshot()],
      checkInducedChanges: [],
      checks: [{ definitionId: digest('f'), mode: 'unknown', observation: null }],
    },
    changeFingerprint: digest('g'), changedFiles: [], checkInducedChanges: [], checks: [check],
    checkComparisons: [{ definitionId: digest('f'), relation: 'baseline-unknown' }],
    evidenceConcerns: status === 'passed' ? [] : [{
      kind: 'check', definitionId: digest('f'), observation: 'current-nonpassing',
    }],
    verifierMutations: [],
    environment: {
      platform: 'linux', architecture: 'x64', cwdFingerprint: digest('4'),
      executables: [], toolchains: [], lockfiles: [], environmentVariableNames: [],
    },
    provenance: { collector: 'stetra-cli', cliVersion: '1', coreVersion: '1' },
  };
}

function inputSnapshot() {
  return {
    definitionId: digest('f'),
    capturedAt: '2026-08-10T00:00:00.000Z',
    inputs: [],
    fingerprint: digest('inputs'),
  };
}

function packet(inputKind: AuthoringPacket['inputKind']): AuthoringPacket {
  return {
    inputKind,
    bindsTo: {
      taskId: 'task-id', revision: 1, effectiveContractId: digest('e'),
      attemptId: 'attempt:1', factCollectionId: digest('c'),
    },
    semanticContext: {
      exactDeveloperEvents: {
        authority: 'human-event',
        events: [{
          id: 'human:test', kind: 'task', content: 'Exact developer request.',
          contentFingerprint: digest('h'),
        }],
      },
      agentInterpretation: {
        authority: 'agent-judgment', desiredOutcome: 'Interpreted outcome.',
        constraints: [], nonGoals: [], focus: [],
      },
    },
    draft: {},
    fieldRequirements: [],
    referenceCatalog: {
      conditions: [], obligations: [], checks: [], changedFiles: [], challenges: [], attention: [],
    },
    outstandingObligations: [],
  };
}

function challengePacket(): ChallengeExecutionPacket {
  return {
    inputKind: 'challenge-round',
    bindsTo: {
      taskId: 'task-id', revision: 1, effectiveContractId: digest('e'),
      attemptId: 'attempt:1', factCollectionId: digest('c'), worktreeFingerprint: digest('w'),
    },
    sharedEvidence: { changedFiles: [], patch: null },
    cases: [{
      target: {
      condition: {
        authority: 'agent-judgment', id: 'condition:test', key: 'condition',
        statement: 'Condition.', adoptionRationale: 'Changes adoption.', criticality: 'material',
      },
      obligation: {
        authority: 'agent-judgment', id: 'obligation:test', key: 'obligation',
        conditionId: 'condition:test', statement: 'Obligation.',
        falsification: {
          failureHypothesis: 'The implementation may be wrong.',
          scenario: 'Exercise the boundary.',
          supportingObservation: 'The boundary holds.',
          contradictingObservation: 'The boundary fails.',
        },
        strategies: [{ kind: 'independent-challenge', policy: 'required' }],
      },
      exactDeveloperEvents: {
        authority: 'human-event',
        events: [{
          id: 'human:test', kind: 'task', content: 'Exact developer request.',
          contentFingerprint: digest('h'),
        }],
      },
    },
      evidence: { checks: [], repositoryEvidence: [], verifierMutations: [] },
      draft: {
      obligationIds: ['obligation:test'],
      falsification: {
        failureHypothesis: 'The implementation may be wrong.',
        scenario: 'Exercise the boundary.',
        supportingObservation: 'The boundary holds.',
        contradictingObservation: 'The boundary fails.',
      },
      evidence: {
        changedFiles: [], checks: [], repositoryEvidence: [], humanEvents: ['human:test'], patch: false,
      },
      falsificationAttempt: '', observedResult: '', supportingEvidence: [], counterEvidence: [],
      evidenceCoverage: { status: '', rationale: '', gaps: [] },
      outcome: '', conclusion: '',
      },
    }],
    draft: { results: [{
      obligationIds: ['obligation:test'],
      falsification: {
        failureHypothesis: 'The implementation may be wrong.',
        scenario: 'Exercise the boundary.',
        supportingObservation: 'The boundary holds.',
        contradictingObservation: 'The boundary fails.',
      },
      evidence: {
        changedFiles: [], checks: [], repositoryEvidence: [], humanEvents: ['human:test'], patch: false,
      },
      falsificationAttempt: '', observedResult: '', supportingEvidence: [], counterEvidence: [],
      evidenceCoverage: { status: '', rationale: '', gaps: [] },
      outcome: '', conclusion: '',
    }] },
    output: {
      authority: 'agent-judgment',
      allowedOutcomes: ['supported', 'partial', 'contradicted', 'unknown'],
      allowedCoverageStatuses: ['sufficient', 'insufficient'],
      evidenceItemShape: {
        statement: '<statement>',
        provenance: '<provenance>',
        reproduction: '<reproduction>',
        references: [{ kind: '<kind>', id: '<id>' }],
      },
      instruction: 'Fill the draft.',
    },
  };
}

function brief(): DeveloperDecisionBrief {
  const details: DeveloperDecisionBrief['details'] = {
    decisionState: {
      delivery: 'implementation-complete', evidence: 'needs-attention',
      recommendation: 'defer', adoption: 'pending',
    },
    changeMeaning: {
      authority: 'agent-judgment', intendedOutcome: 'Requested outcome.',
      actualSystemMeaning: 'Actual change.',
      importantSystemEffects: [],
    },
    recommendation: {
      action: 'defer', rationale: 'Review the unresolved verification issue.', caveats: [],
    },
    conditions: [{
      authority: 'agent-judgment',
      id: 'condition:test', statement: 'Condition.', criticality: 'material',
      status: 'partial', summary: 'Partially supported.', obligations: [],
    }],
    decisionIssues: [{
      id: 'decision-issue:test', attentionIds: ['attention:test'],
      codes: ['verification-nonpassing'], group: 'verification', resolutions: ['inspect'],
      references: {}, conditionIds: ['condition:test'], obligationIds: [],
      residualUnknowns: [], reviewQuestions: [{
        id: 'review:test', conditionIds: ['condition:test'], obligationIds: [],
        question: 'Inspect?', adoptionImpact: 'Changes adoption.', evidence: [],
      }],
    }],
    reviewQuestions: [{
      id: 'review:test', conditionIds: ['condition:test'], obligationIds: [],
      question: 'Inspect?', adoptionImpact: 'Changes adoption.', evidence: [],
    }],
    evidenceHistory: [],
    runtimeEvidence: { authority: 'runtime-fact', changedFiles: [], checks: [] },
    requestedDecision: {
      authority: 'human-decision',
      actions: ['accepted', 'correction-requested', 'rejected', 'deferred'],
      acceptanceRequiresExceptionsFor: [{
        decisionIssueId: 'decision-issue:test', attentionIds: ['attention:test'],
      }],
    },
    detailSections: ['contract'],
  };
  return {
    primary: {
      decisionState: details.decisionState,
      changeMeaning: details.changeMeaning,
      recommendation: details.recommendation,
      conditions: [{
        statement: 'Condition.', criticality: 'material',
        finding: { status: 'partial', summary: 'Partially supported.' }, obligations: [],
      }],
      blockers: [{
        group: 'verification', codes: ['verification-nonpassing'], resolutions: ['inspect'],
        affectedConditions: ['Condition.'], residualUnknowns: [],
        reviewQuestions: [{ question: 'Inspect?', adoptionImpact: 'Changes adoption.' }],
      }],
      reviewFocus: [{
        question: 'Inspect?', adoptionImpact: 'Changes adoption.',
        affectedConditions: ['Condition.'],
      }],
      runtimeEvidence: { authority: 'runtime-fact', changedFiles: [], checks: [] },
      requestedDecision: {
        authority: 'human-decision',
        actions: ['accepted', 'correction-requested', 'rejected', 'deferred'],
        acceptanceExceptionIssueCount: 1,
      },
    },
    details,
  };
}

function attentionItem(
  id: string,
  group: HandoffAttentionItem['group'],
  resolution: HandoffAttentionItem['resolution']['kind'],
  references: HandoffAttentionItem['references'],
): HandoffAttentionItem {
  return {
    id, group, resolution: { kind: resolution }, references,
    codes: ['direct-review-required'],
  };
}

function digest(character: string) {
  return `sha256:${character.slice(0, 1).repeat(64)}`;
}

function summary(character: string) {
  return {
    head: null, fingerprint: digest(character), entryCount: 0,
    capturedAt: '2026-08-10T00:00:00.000Z',
  };
}

function stream(character: string) {
  return { digest: digest(character), byteLength: 0, persistedBytes: 0, truncated: false };
}
