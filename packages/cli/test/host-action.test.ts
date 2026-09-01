import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactBundle, HandoffAttentionItem } from '@sovea/stetra-core';

import {
  authoringGuide,
  authoringStage,
  type AuthoringPacket,
} from '../src/workflow/authoring.ts';
import { hostEnvironmentDisclosure } from '../src/runtime-context.ts';
import {
  aggregateDecisionAttention,
  type DeveloperDecisionBrief,
} from '../src/workflow/decision-brief.ts';
import {
  collectedHostAction,
  compileProblemHostAction,
  diagnosisHostAction,
  handoffHostAction,
  hostActionAuthoringPacket,
  preparedHostAction,
  resolutionHostAction,
  staleFactsHostAction,
} from '../src/workflow/host-action.ts';

test('Host environment disclosure states the thin adapter boundary honestly', () => {
  const disclosure = hostEnvironmentDisclosure();
  assert.equal(disclosure.surface, 'thin-skill');
  assert.deepEqual(disclosure.independentChallenge, {
    availability: 'unavailable',
    unavailableBehavior: 'author-handoff-preserving-gap',
  });
  assert.deepEqual(disclosure.verificationExecution, {
    authoritativeCollector: 'stetra-runtime',
    trigger: 'change-collect',
    processModel: 'frozen-argv-without-shell',
    preparePreflightScope: 'top-level-executable-only',
    directHostExecution: 'agent-evidence-only',
  });
});

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

test('host actions route the lifecycle with compact executable bindings', () => {
  assert.deepEqual(preparedHostAction('task-id'), {
    kind: 'implement-and-collect', reference: null,
    command: { argv: ['stetra', 'change', 'collect', '.', '--task', 'task-id', '--json'] },
    finalResponseGuard: {
      argv: ['stetra', 'change', 'guard-final', '.', '--task', 'task-id', '--json'],
    },
  });
  assert.equal(diagnosisHostAction('repair-delivery', 'task-id').kind, 'implement-and-collect');
  assert.equal(diagnosisHostAction(
    'revise-verification', 'task-id', packet('verification-revision'),
  ).kind, 'revise-verification');
  assert.equal(diagnosisHostAction('handoff', 'task-id', packet('handoff')).kind, 'author-handoff');
  const resolution = diagnosisHostAction('ask-human', 'task-id', packet('resolution'));
  assert.equal(resolution.kind, 'resolve-evidence-decision');
  assert.deepEqual(resolution.command?.argv.slice(0, 4), ['stetra', 'change', 'resolve', '.']);
  assert.match(resolution.inputBinding?.draftPath ?? '', /^\.stetra\/inbox\/[a-f0-9]{64}\.json$/);
  assert.match(resolution.inputBinding?.guidePath ?? '', /^\.stetra\/inbox\/[a-f0-9]{64}\.guide\.json$/);
  assert.match(resolution.inputBinding?.projectionFingerprint ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(resolution.command?.argv.slice(6, 8), [
    '--input', resolution.inputBinding?.draftPath,
  ]);
  assert.equal(staleFactsHostAction('task-id').kind, 'recollect-stale-facts');
  assert.doesNotMatch(JSON.stringify(resolution), /authoringPacket|inputSchema|semanticContext/);
  const handoff = handoffHostAction('needs-attention', 'task-id', brief(), packet('decision'));
  assert.equal(handoff.kind, 'present-handoff-and-await-human-decision');
  assert.equal(handoff.command, undefined);
  assert.deepEqual(handoff.finalResponseGuard?.argv, [
    'stetra', 'change', 'guard-final', '.', '--task', 'task-id', '--json',
  ]);
  assert.equal(hostActionAuthoringPacket(handoff), undefined);
  assert.equal(handoff.decisionContinuation?.requiresNewHumanEvent, true);
  assert.deepEqual(handoff.decisionContinuation?.command.argv.slice(0, 4), [
    'stetra', 'change', 'decide', '.',
  ]);
  assert.deepEqual(handoff.presentationRequirements, {
    leadWithDecisionState: true,
    requiredConditionIds: [],
    requiredAttentionIds: [],
    requiredReviewDecisionIds: [],
    prohibitImpliedAdoption: true,
  });
  assert.equal(
    hostActionAuthoringPacket(resolutionHostAction('task-id', packet('resolution')))?.inputKind,
    'resolution',
  );
});

test('every semantic authoring kind uses one exact CLI action in its Guide and Host Action', () => {
  const expectedStages: Array<[AuthoringPacket['inputKind'], string]> = [
    ['diagnosis', 'diagnose'],
    ['verification-revision', 'revise-verification'],
    ['handoff', 'handoff'],
    ['decision', 'decide'],
    ['resolution', 'resolve'],
  ];
  for (const [inputKind, expectedStage] of expectedStages) {
    const guide = authoringGuide(packet(inputKind));
    const stageIndex = guide.schema.command.argv.indexOf('--stage');
    assert.equal(authoringStage(inputKind), expectedStage);
    assert.equal(guide.schema.command.argv[stageIndex + 1], expectedStage);
  }

  const diagnosis = collectedHostAction({
    facts: factFixture('failed'),
    taskId: 'task-id',
    diagnosisPacket: packet('diagnosis'),
    handoffPacket: packet('handoff'),
    timeoutRetryLimits: new Map(),
  });
  const revision = diagnosisHostAction(
    'revise-verification', 'task-id', packet('verification-revision'),
  );
  const handoff = diagnosisHostAction('handoff', 'task-id', packet('handoff'));
  const resolution = resolutionHostAction('task-id', packet('resolution'));
  const decision = handoffHostAction(
    'needs-attention', 'task-id', brief(), packet('decision'),
  ).decisionContinuation!;
  assert.deepEqual([
    diagnosis.command?.argv[2],
    revision.command?.argv[2],
    handoff.command?.argv[2],
    decision.command.argv[2],
    resolution.command?.argv[2],
  ], expectedStages.map(([, stage]) => stage));
});

test('collection routes timeout, diagnosis, and ordinary handoff from explicit facts', () => {
  const passed = factFixture('passed');
  const common = {
    facts: passed,
    taskId: 'task-id',
    diagnosisPacket: packet('diagnosis'),
    handoffPacket: packet('handoff'),
    timeoutRetryLimits: new Map<string, number>(),
  };
  assert.equal(collectedHostAction(common).kind, 'author-handoff');
  const failed = factFixture('failed');
  assert.equal(collectedHostAction({
    ...common, facts: failed,
  }).kind, 'diagnose-collected-evidence');

  const timedOut = factFixture('unavailable');
  timedOut.checks[0].attempts[0].termination = { kind: 'timeout' };
  const retry = collectedHostAction({
    ...common,
    facts: timedOut,
    timeoutRetryLimits: new Map([[timedOut.checks[0].definitionId, 9_000]]),
  });
  assert.equal(retry.kind, 'retry-timed-out-check');
  assert.match(retry.command!.argv.join(' '), /integer-greater-than-1000/);
});

test('compile problems preserve Human choice, verification, and protocol distinctions', () => {
  const clarification = compileProblemHostAction('semantic-decision-required', {
    prepareRequestId: 'prepare:test',
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
      attempt: 1, durationMs: 3,
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
        durationMs: 3,
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
    effectiveContractId: digest('e'), attemptId: 'attempt:1', baseline: summary('a'),
    preCheck: summary('b'), current: summary('c'),
    preCheckExecutionInputs: [inputSnapshot()], currentExecutionInputs: [inputSnapshot()],
    baselineVerification: {
      fingerprint: digest('v'),
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
      platform: 'linux', architecture: 'x64', executables: [],
    },
    provenance: { collector: 'stetra-cli', cliVersion: '1', coreVersion: '1' },
  };
}

function inputSnapshot() {
  return {
    definitionId: digest('f'),
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
    inputSchema: {},
    constraints: {},
    detailCommands: [],
    referenceCatalog: {
      conditions: [], obligations: [], checks: [], changedFiles: [], attention: [],
    },
  };
}

function brief(): DeveloperDecisionBrief {
  return {
    primary: {
      decisionState: {
        delivery: 'implementation-complete', evidence: 'needs-attention',
        recommendation: 'defer', adoption: 'pending',
      },
      changeMeaning: {
        authority: 'agent-judgment', intendedOutcome: 'Requested outcome.',
        actualChange: {
          behavior: 'Actual change.', mechanism: ['Mechanism.'], preservedInvariants: [],
          failureAndRecovery: [], importantEffects: [], materialTradeoffs: [],
        },
      },
      recommendation: {
        action: 'defer', rationale: 'Review the unresolved verification issue.', caveats: [],
      },
      priorHumanResolutions: [],
      conditions: [{
        statement: 'Condition.', criticality: 'material',
        finding: { status: 'partial', summary: 'Partially supported.' }, evidence: [],
      }],
      blockers: [{
        group: 'verification', codes: ['verification-nonpassing'], resolutions: ['inspect'],
        affectedConditions: ['Condition.'], residualUnknowns: [],
        reviewDecisions: [{
          question: 'Inspect?', adoptionImpact: 'Changes adoption.', nextAction: 'Inspect evidence.',
        }],
      }],
      reviewFocus: [{
        question: 'Inspect?', adoptionImpact: 'Changes adoption.', nextAction: 'Inspect evidence.',
        affectedConditions: ['Condition.'],
      }],
      runtimeEvidence: { authority: 'runtime-fact', changedFiles: [], checks: [] },
      requestedDecision: {
        authority: 'human-decision',
        actions: ['accepted', 'correction-requested', 'rejected', 'deferred'],
        acceptanceExceptionIssueCount: 1,
      },
    },
    details: {
      command: {
        argv: ['stetra', 'change', 'explain', '.', '--task', 'task:test', '--section', 'decision-packet', '--json'],
      },
      sections: ['contract', 'attempts', 'handoff', 'events'],
    },
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
    codes: ['challenge-missing'],
  };
}

function digest(character: string) {
  return `sha256:${character.slice(0, 1).repeat(64)}`;
}

function summary(character: string) {
  return {
    head: null, fingerprint: digest(character), entryCount: 0,
  };
}

function stream(character: string) {
  return { digest: digest(character), byteLength: 0, persistedBytes: 0, truncated: false };
}
