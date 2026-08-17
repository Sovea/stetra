import type {
  DeveloperEventInput,
  FactBundle,
  HandoffStatus,
  MaterialDecisionForkInput,
  TaskMeaningInput,
} from '@sovea/stetra-core';

import type { AuthoringPacket } from './authoring.ts';
import type { DeveloperDecisionBrief } from './decision-brief.ts';
import { stableFingerprint } from '../protocol.ts';

export type HostWorkflowReference =
  | 'change'
  | 'delivery'
  | 'challenge'
  | 'handoff'
  | 'recovery';

export interface ChallengeExecutionRequest {
  requestId: string;
  role: 'independent-challenger';
  agentProfile: 'stetra-challenger';
  bindsTo: {
    taskId: string;
    effectiveContractId: string;
    attemptId: string;
    factCollectionId: string;
    authoringPacketFingerprint: string;
  };
  contextPolicy: 'fresh-required';
  mutationPolicy: 'forbidden';
  parallelism: 'single';
  outputRepairBudget: 1;
  expectedOutput: {
    serialization: 'json';
    schema: 'challenge-document';
    source: 'authoringPacket.draft';
  };
}

export interface HostAction {
  kind:
    | 'implement-and-collect'
    | 'diagnose-collected-evidence'
    | 'revise-verification'
    | 'retry-timed-out-check'
    | 'recollect-stale-facts'
    | 'perform-independent-challenge'
    | 'author-handoff'
    | 'present-handoff-and-await-human-decision'
    | 'resolve-human-choice'
    | 'configure-verification'
    | 'correct-protocol-input'
    | 'resolve-evidence-decision';
  reference: HostWorkflowReference | null;
  command?: { argv: string[] };
  inputBinding?: {
    transport: 'stdin';
    source: 'authoringPacket.draft' | 'hostChallengeSubmission';
    serialization: 'json';
    execution: 'one-shot';
  };
  authoringPacket?: AuthoringPacket;
  challengeExecutionRequest?: ChallengeExecutionRequest;
  developerDecisionBrief?: DeveloperDecisionBrief;
  presentationRequirements?: {
    leadWithDecisionState: true;
    requiredConditionIds: string[];
    requiredDecisionIssueIds: string[];
    requiredReviewQuestionIds: string[];
    prohibitImpliedAdoption: true;
  };
  decisionContinuation?: {
    requiresNewHumanEvent: true;
    command: { argv: string[] };
    inputBinding: NonNullable<HostAction['inputBinding']>;
    authoringPacket: AuthoringPacket;
  };
  clarificationBrief?: ClarificationBrief;
  clarificationContinuation?: {
    kind: 'reprepare';
    prepareRequestId: string;
    requiresNewHumanEvent: true;
  };
}

export interface ClarificationBrief {
  prepareRequestId: string;
  developerEvents: DeveloperEventInput[];
  taskInterpretation: TaskMeaningInput;
  forks: MaterialDecisionForkInput[];
}

export interface FinalResponseGuard {
  protocol: 'cognitive-adoption';
  schemaVersion: '1';
  status: 'final-response-guarded';
  taskId: string;
  revision: number;
  disposition:
    | 'continue-workflow'
    | 'present-decision-brief'
    | 'human-decision-recorded';
  factsCurrent: boolean;
  actionFingerprint: string;
  hostAction: HostAction | null;
  stateWritten: false;
}

export function compileProblemHostAction(
  status: 'semantic-decision-required' | 'verification-required' | 'authority-invalid',
  clarificationBrief?: ClarificationBrief,
): HostAction {
  if (status === 'semantic-decision-required') {
    if (!clarificationBrief) throw new Error('Semantic decision action requires a clarification brief.');
    return {
      kind: 'resolve-human-choice',
      reference: 'change',
      clarificationBrief,
      clarificationContinuation: {
        kind: 'reprepare',
        prepareRequestId: clarificationBrief.prepareRequestId,
        requiresNewHumanEvent: true,
      },
    };
  }
  if (status === 'verification-required') {
    return { kind: 'configure-verification', reference: 'change' };
  }
  return { kind: 'correct-protocol-input', reference: 'change' };
}

export function unavailableVerificationHostAction(): HostAction {
  return { kind: 'configure-verification', reference: 'recovery' };
}

export function preparedHostAction(taskId: string): HostAction {
  return {
    kind: 'implement-and-collect',
    reference: 'delivery',
    command: taskCommand('collect', taskId),
  };
}

export function collectedHostAction(input: {
  facts: FactBundle;
  taskId: string;
  diagnosisPacket: AuthoringPacket;
  challengePacket: AuthoringPacket;
  handoffPacket: AuthoringPacket;
  pendingChallengeObligationIds: string[];
}): HostAction {
  const timedOut = input.facts.checks.filter((check) =>
    latestAttempt(check).termination.kind === 'timeout');
  if (timedOut.length) {
    const argv = taskCommand('collect', input.taskId).argv;
    for (const check of timedOut) {
      const latest = latestAttempt(check);
      argv.splice(-1, 0, '--retry-check', `${check.definitionId}=<integer-greater-than-${latest.timeoutMs}>`);
    }
    return {
      kind: 'retry-timed-out-check',
      reference: 'recovery',
      command: { argv },
    };
  }
  if (input.facts.checks.some((check) => latestAttempt(check).status !== 'passed')) {
    return inputAction('diagnose-collected-evidence', 'recovery', 'diagnose', input.taskId, input.diagnosisPacket);
  }
  if (input.pendingChallengeObligationIds.length) {
    return challengeInputAction(input.taskId, input.challengePacket);
  }
  return inputAction('author-handoff', 'handoff', 'handoff', input.taskId, input.handoffPacket);
}

export function diagnosisHostAction(
  route:
    | 'repair-implementation'
    | 'revise-verification'
    | 'challenge'
    | 'handoff'
    | 'ask-human',
  taskId: string,
  packet?: AuthoringPacket,
): HostAction {
  if (route === 'repair-implementation') return preparedHostAction(taskId);
  if (route === 'revise-verification') {
    return inputAction(
      'revise-verification', 'recovery', 'revise-verification', taskId,
      requiredAuthoringPacket(packet, route),
    );
  }
  if (route === 'challenge') {
    return challengeInputAction(taskId, requiredAuthoringPacket(packet, route));
  }
  if (route === 'handoff') {
    return inputAction(
      'author-handoff', 'handoff', 'handoff', taskId,
      requiredAuthoringPacket(packet, route),
    );
  }
  return resolutionHostAction(taskId, requiredAuthoringPacket(packet, route));
}

export function challengeHostAction(
  taskId: string,
  needsAnotherChallenge: boolean,
  packet: AuthoringPacket,
): HostAction {
  return needsAnotherChallenge
    ? challengeInputAction(taskId, packet)
    : inputAction('author-handoff', 'handoff', 'handoff', taskId, packet);
}

export function adverseChallengeHostAction(
  taskId: string,
  packet: AuthoringPacket,
): HostAction {
  return inputAction(
    'diagnose-collected-evidence',
    'recovery',
    'diagnose',
    taskId,
    packet,
  );
}

export function resolutionHostAction(taskId: string, packet: AuthoringPacket): HostAction {
  return inputAction('resolve-evidence-decision', 'recovery', 'resolve', taskId, packet);
}

export function staleFactsHostAction(taskId: string): HostAction {
  return {
    kind: 'recollect-stale-facts',
    reference: 'recovery',
    command: taskCommand('collect', taskId),
  };
}

export function handoffHostAction(
  _status: HandoffStatus,
  taskId: string,
  brief: DeveloperDecisionBrief,
  packet: AuthoringPacket,
): HostAction {
  const continuation = inputAction(
    'present-handoff-and-await-human-decision', 'handoff', 'decide', taskId, packet,
  );
  return {
    kind: 'present-handoff-and-await-human-decision',
    reference: 'handoff',
    developerDecisionBrief: brief,
    presentationRequirements: {
      leadWithDecisionState: true,
      requiredConditionIds: brief.conditions.map((condition) => condition.id),
      requiredDecisionIssueIds: brief.decisionIssues.map((issue) => issue.id),
      requiredReviewQuestionIds: [...new Set(brief.decisionIssues.flatMap((issue) =>
        issue.reviewQuestions.map((question) => question.id)))].sort(),
      prohibitImpliedAdoption: true,
    },
    decisionContinuation: {
      requiresNewHumanEvent: true,
      command: continuation.command!,
      inputBinding: continuation.inputBinding!,
      authoringPacket: packet,
    },
  };
}

function taskCommand(stage: 'collect', taskId: string): { argv: string[] } {
  return { argv: ['stetra', 'change', stage, '.', '--task', taskId, '--json'] };
}

function inputAction(
  kind: HostAction['kind'],
  reference: HostWorkflowReference,
  stage:
    | 'diagnose'
    | 'revise-verification'
    | 'challenge'
    | 'handoff'
    | 'decide'
    | 'resolve',
  taskId: string,
  authoringPacket: AuthoringPacket,
): HostAction {
  return {
    kind,
    reference,
    command: {
      argv: ['stetra', 'change', stage, '.', '--task', taskId, '--input', '-', '--json'],
    },
    inputBinding: {
      transport: 'stdin',
      source: 'authoringPacket.draft',
      serialization: 'json',
      execution: 'one-shot',
    },
    authoringPacket,
  };
}

function challengeInputAction(
  taskId: string,
  authoringPacket: AuthoringPacket,
): HostAction {
  const factCollectionId = authoringPacket.bindsTo.factCollectionId;
  if (!factCollectionId) {
    throw new Error('Independent Challenge requires an Authoring Packet bound to collected facts.');
  }
  const authoringPacketFingerprint = stableFingerprint(authoringPacket);
  const requestBody = {
    role: 'independent-challenger' as const,
    agentProfile: 'stetra-challenger' as const,
    bindsTo: {
      taskId,
      effectiveContractId: authoringPacket.bindsTo.effectiveContractId,
      attemptId: authoringPacket.bindsTo.attemptId,
      factCollectionId,
      authoringPacketFingerprint,
    },
    contextPolicy: 'fresh-required' as const,
    mutationPolicy: 'forbidden' as const,
    parallelism: 'single' as const,
    outputRepairBudget: 1 as const,
    expectedOutput: {
      serialization: 'json' as const,
      schema: 'challenge-document' as const,
      source: 'authoringPacket.draft' as const,
    },
  };
  const action = inputAction(
      'perform-independent-challenge', 'challenge', 'challenge', taskId, authoringPacket,
    );
  return {
    ...action,
    inputBinding: {
      ...action.inputBinding!,
      source: 'hostChallengeSubmission',
    },
    challengeExecutionRequest: {
      requestId: stableFingerprint(requestBody),
      ...requestBody,
    },
  };
}

function requiredAuthoringPacket(
  packet: AuthoringPacket | undefined,
  route: string,
): AuthoringPacket {
  if (!packet) throw new Error(`Route ${route} requires an Authoring Packet.`);
  return packet;
}

function latestAttempt(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return latest;
}
