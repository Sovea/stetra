import type {
  DeveloperEventInput,
  FactBundle,
  HandoffStatus,
  MaterialDecisionForkInput,
  TaskMeaningInput,
} from '@sovea/stetra-core';

import type { AuthoringPacket } from './authoring.ts';
import type { ChallengeExecutionPacket } from './challenge-projection.ts';
import type { DeveloperDecisionBrief } from './decision-brief.ts';
import { stableFingerprint } from '../protocol.ts';

export type HostWorkflowReference =
  | 'change'
  | 'delivery'
  | 'challenge'
  | 'handoff'
  | 'recovery';

export interface HostExecutionRequirements {
  context: 'continuous' | 'fresh-required';
  targetWorktree: 'read-only' | 'read-write';
  stetraState: 'none' | 'read-only' | 'read-write';
  workspace: 'target' | 'isolated-writable';
  externalEffects: 'forbidden' | 'contract-policy';
}

export interface ChallengeExecutionRequest {
  requestId: string;
  role: 'independent-challenger';
  agentProfile: 'stetra-challenger';
  bindsTo: {
    taskId: string;
    effectiveContractId: string;
    attemptId: string;
    factCollectionId: string;
    worktreeFingerprint: string;
    challengeExecutionPacketFingerprint: string;
  };
  contextPolicy: 'fresh-required';
  workspacePolicy: {
    targetWorktree: 'read-only';
    executionWorkspace: 'isolated-writable';
    externalEffects: 'forbidden';
  };
  parallelism: 'single';
  outputRepairBudget: 1;
  expectedOutput: {
    serialization: 'json';
    schema: 'challenge-document';
    source: 'challengeExecutionPacket.draft';
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
  executionRequirements: HostExecutionRequirements;
  command?: { argv: string[] };
  inputBinding?: {
    transport: 'stdin';
    source: 'authoringPacket.draft' | 'hostChallengeSubmission';
    serialization: 'json';
    execution: 'one-shot';
  };
  authoringPacket?: AuthoringPacket;
  challengeExecutionPacket?: ChallengeExecutionPacket;
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
    executionRequirements: HostExecutionRequirements;
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
  actionUnchanged: boolean;
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
      executionRequirements: INSPECTION_EXECUTION,
      clarificationBrief,
      clarificationContinuation: {
        kind: 'reprepare',
        prepareRequestId: clarificationBrief.prepareRequestId,
        requiresNewHumanEvent: true,
      },
    };
  }
  if (status === 'verification-required') {
    return { kind: 'configure-verification', reference: 'change', executionRequirements: INSPECTION_EXECUTION };
  }
  return { kind: 'correct-protocol-input', reference: 'change', executionRequirements: INSPECTION_EXECUTION };
}

export function unavailableVerificationHostAction(): HostAction {
  return { kind: 'configure-verification', reference: 'recovery', executionRequirements: INSPECTION_EXECUTION };
}

export function preparedHostAction(taskId: string): HostAction {
  return {
    kind: 'implement-and-collect',
    reference: 'delivery',
    executionRequirements: DELIVERY_EXECUTION,
    command: taskCommand('collect', taskId),
  };
}

export function collectedHostAction(input: {
  facts: FactBundle;
  taskId: string;
  diagnosisPacket: AuthoringPacket;
  challengePacket?: ChallengeExecutionPacket;
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
      executionRequirements: DELIVERY_EXECUTION,
      command: { argv },
    };
  }
  if (input.facts.checks.some((check) => latestAttempt(check).status !== 'passed')) {
    return inputAction('diagnose-collected-evidence', 'recovery', 'diagnose', input.taskId, input.diagnosisPacket);
  }
  if (input.pendingChallengeObligationIds.length) {
    return challengeInputAction(
      input.taskId,
      requiredChallengeExecutionPacket(input.challengePacket, 'challenge'),
    );
  }
  return inputAction('author-handoff', 'handoff', 'handoff', input.taskId, input.handoffPacket);
}

export function diagnosisHostAction(
  route:
    | 'repair-delivery'
    | 'revise-verification'
    | 'challenge'
    | 'handoff'
    | 'ask-human',
  taskId: string,
  packet?: AuthoringPacket | ChallengeExecutionPacket,
): HostAction {
  if (route === 'repair-delivery') return preparedHostAction(taskId);
  if (route === 'revise-verification') {
    return inputAction(
      'revise-verification', 'recovery', 'revise-verification', taskId,
      requiredAuthoringPacket(packet, route),
    );
  }
  if (route === 'challenge') {
    return challengeInputAction(taskId, requiredChallengeExecutionPacket(packet, route));
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
  packet: AuthoringPacket | ChallengeExecutionPacket,
): HostAction {
  return needsAnotherChallenge
    ? challengeInputAction(taskId, requiredChallengeExecutionPacket(packet, 'challenge'))
    : inputAction(
        'author-handoff', 'handoff', 'handoff', taskId,
        requiredAuthoringPacket(packet, 'handoff'),
      );
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
    executionRequirements: DELIVERY_EXECUTION,
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
    executionRequirements: INSPECTION_EXECUTION,
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
      executionRequirements: continuation.executionRequirements,
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
    executionRequirements: AUTHORING_EXECUTION,
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
  challengeExecutionPacket: ChallengeExecutionPacket,
): HostAction {
  const factCollectionId = challengeExecutionPacket.bindsTo.factCollectionId;
  const challengeExecutionPacketFingerprint = stableFingerprint(challengeExecutionPacket);
  const requestBody = {
    role: 'independent-challenger' as const,
    agentProfile: 'stetra-challenger' as const,
    bindsTo: {
      taskId,
      effectiveContractId: challengeExecutionPacket.bindsTo.effectiveContractId,
      attemptId: challengeExecutionPacket.bindsTo.attemptId,
      factCollectionId,
      worktreeFingerprint: challengeExecutionPacket.bindsTo.worktreeFingerprint,
      challengeExecutionPacketFingerprint,
    },
    contextPolicy: 'fresh-required' as const,
    workspacePolicy: {
      targetWorktree: 'read-only' as const,
      executionWorkspace: 'isolated-writable' as const,
      externalEffects: 'forbidden' as const,
    },
    parallelism: 'single' as const,
    outputRepairBudget: 1 as const,
    expectedOutput: {
      serialization: 'json' as const,
      schema: 'challenge-document' as const,
      source: 'challengeExecutionPacket.draft' as const,
    },
  };
  return {
    kind: 'perform-independent-challenge',
    reference: 'challenge',
    executionRequirements: AUTHORING_EXECUTION,
    command: {
      argv: ['stetra', 'change', 'challenge', '.', '--task', taskId, '--input', '-', '--json'],
    },
    inputBinding: {
      transport: 'stdin',
      source: 'hostChallengeSubmission',
      serialization: 'json',
      execution: 'one-shot',
    },
    challengeExecutionPacket,
    challengeExecutionRequest: {
      requestId: stableFingerprint(requestBody),
      ...requestBody,
    },
  };
}

const INSPECTION_EXECUTION: HostExecutionRequirements = {
  context: 'continuous',
  targetWorktree: 'read-only',
  stetraState: 'read-only',
  workspace: 'target',
  externalEffects: 'forbidden',
};

const AUTHORING_EXECUTION: HostExecutionRequirements = {
  context: 'continuous',
  targetWorktree: 'read-only',
  stetraState: 'read-write',
  workspace: 'target',
  externalEffects: 'forbidden',
};

const DELIVERY_EXECUTION: HostExecutionRequirements = {
  context: 'continuous',
  targetWorktree: 'read-write',
  stetraState: 'read-write',
  workspace: 'target',
  externalEffects: 'contract-policy',
};

function requiredAuthoringPacket(
  packet: AuthoringPacket | ChallengeExecutionPacket | undefined,
  route: string,
): AuthoringPacket {
  if (!packet || packet.inputKind === 'challenge') {
    throw new Error(`Route ${route} requires an Authoring Packet.`);
  }
  return packet;
}

function requiredChallengeExecutionPacket(
  packet: AuthoringPacket | ChallengeExecutionPacket | undefined,
  route: string,
): ChallengeExecutionPacket {
  if (!packet || packet.inputKind !== 'challenge') {
    throw new Error(`Route ${route} requires a Challenge Execution Packet.`);
  }
  return packet;
}

function latestAttempt(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return latest;
}
