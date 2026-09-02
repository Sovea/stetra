import type {
  FactBundle,
  HandoffStatus,
  MaterialDecisionForkInput,
  DecisionPacket,
} from '@sovea/stetra-core';

import { authoringStage, type AuthoringPacket } from './authoring.ts';
import type { DeveloperDecisionBrief } from './decision-brief.ts';
import type { HostEnvironmentDisclosure } from '../runtime-context.ts';
import { stableFingerprint } from '../protocol.ts';
import {
  ownedInputReservation,
  taskOwnedInputToken,
  type OwnedInputReservation,
} from '../host/owned-input.ts';

export type HostWorkflowReference =
  | 'recovery';

export interface HostAction {
  kind:
    | 'implement-and-collect'
    | 'diagnose-collected-evidence'
    | 'revise-verification'
    | 'retry-timed-out-check'
    | 'recollect-stale-facts'
    | 'author-handoff'
    | 'present-handoff-and-await-human-decision'
    | 'resolve-human-choice'
    | 'configure-verification'
    | 'correct-protocol-input'
    | 'resolve-evidence-decision';
  reference: HostWorkflowReference | null;
  command?: { argv: string[] };
  finalResponseGuard?: { argv: string[] };
  inputBinding?: {
    format: 'semantic-authoring';
    inputKind: AuthoringPacket['inputKind'];
    projectionFingerprint: string;
    bindsTo: AuthoringPacket['bindsTo'];
    draftPath: string;
    guidePath: string;
    reserve: { argv: string[] };
  };
  developerDecisionBrief?: DeveloperDecisionBrief;
  presentationRequirements?: {
    leadWithDecisionState: true;
    requiredConditionIds: string[];
    requiredAttentionIds: string[];
    requiredReviewDecisionIds: string[];
    prohibitImpliedAdoption: true;
  };
  decisionContinuation?: {
    requiresNewHumanEvent: true;
    command: { argv: string[] };
    inputBinding: NonNullable<HostAction['inputBinding']>;
  };
  clarificationBrief?: ClarificationBrief;
  clarificationContinuation?: {
    kind: 'reprepare';
    prepareRequestId: string;
    requiresNewHumanEvent: true;
  };
  prepareContinuation?: {
    prepareRequestId: string;
    taskId: string;
    requiresNewHumanEvent: boolean;
    input: OwnedInputReservation;
    command: { argv: string[] };
  };
}

const authoringPackets = new WeakMap<object, AuthoringPacket>();

export function hostActionAuthoringPacket(
  action: HostAction | NonNullable<HostAction['decisionContinuation']>,
): AuthoringPacket | undefined {
  return authoringPackets.get(action);
}

export interface ClarificationBrief {
  prepareRequestId: string;
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
  hostEnvironment: HostEnvironmentDisclosure;
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
      reference: null,
      clarificationBrief,
      clarificationContinuation: {
        kind: 'reprepare',
        prepareRequestId: clarificationBrief.prepareRequestId,
        requiresNewHumanEvent: true,
      },
    };
  }
  if (status === 'verification-required') {
    return { kind: 'configure-verification', reference: null };
  }
  return { kind: 'correct-protocol-input', reference: null };
}

export function unavailableVerificationHostAction(): HostAction {
  return { kind: 'configure-verification', reference: 'recovery' };
}

export function preparedHostAction(taskId: string): HostAction {
  return {
    kind: 'implement-and-collect',
    reference: null,
    command: taskCommand('collect', taskId),
    finalResponseGuard: guardCommand(taskId),
  };
}

export function collectedHostAction(input: {
  facts: FactBundle;
  taskId: string;
  diagnosisPacket: AuthoringPacket;
  handoffPacket: AuthoringPacket;
  timeoutRetryLimits: Map<string, number>;
}): HostAction {
  const timedOut = input.facts.checks.filter((check) =>
    latestAttempt(check).termination.kind === 'timeout'
    && input.timeoutRetryLimits.has(check.definitionId));
  if (timedOut.length) {
    const argv = taskCommand('collect', input.taskId).argv;
    for (const check of timedOut) {
      const latest = latestAttempt(check);
      const maximum = input.timeoutRetryLimits.get(check.definitionId)!;
      argv.splice(
        -1,
        0,
        '--retry-check',
        `${check.definitionId}=<integer-greater-than-${latest.timeoutMs}-and-at-most-${maximum}>`,
      );
    }
    return {
      kind: 'retry-timed-out-check',
      reference: 'recovery',
      command: { argv },
      finalResponseGuard: guardCommand(input.taskId),
    };
  }
  if (input.facts.evidenceConcerns.length) {
    return inputAction(
      'diagnose-collected-evidence', 'recovery', input.taskId, input.diagnosisPacket,
    );
  }
  return inputAction('author-handoff', null, input.taskId, input.handoffPacket);
}

export function diagnosisHostAction(
  route:
    | 'repair-delivery'
    | 'revise-verification'
    | 'handoff'
    | 'ask-human',
  taskId: string,
  packet?: AuthoringPacket,
): HostAction {
  if (route === 'repair-delivery') return preparedHostAction(taskId);
  if (route === 'revise-verification') {
    return inputAction(
      'revise-verification', 'recovery', taskId, requiredAuthoringPacket(packet, route),
    );
  }
  if (route === 'handoff') {
    return inputAction(
      'author-handoff', null, taskId, requiredAuthoringPacket(packet, route),
    );
  }
  return resolutionHostAction(taskId, requiredAuthoringPacket(packet, route));
}

export function resolutionHostAction(taskId: string, packet: AuthoringPacket): HostAction {
  return inputAction('resolve-evidence-decision', 'recovery', taskId, packet);
}

export function staleFactsHostAction(taskId: string): HostAction {
  return {
    kind: 'recollect-stale-facts',
    reference: 'recovery',
    command: taskCommand('collect', taskId),
    finalResponseGuard: guardCommand(taskId),
  };
}

export function handoffHostAction(
  _status: HandoffStatus,
  taskId: string,
  brief: DeveloperDecisionBrief,
  packet: AuthoringPacket,
  decisionPacket?: DecisionPacket,
): HostAction {
  const continuation = inputAction(
    'present-handoff-and-await-human-decision', null, taskId, packet,
  );
  const decisionContinuation = {
    requiresNewHumanEvent: true as const,
    command: continuation.command!,
    inputBinding: continuation.inputBinding!,
  };
  authoringPackets.set(decisionContinuation, packet);
  return {
    kind: 'present-handoff-and-await-human-decision',
    reference: null,
    finalResponseGuard: guardCommand(taskId),
    developerDecisionBrief: brief,
    presentationRequirements: {
      leadWithDecisionState: true,
      requiredConditionIds: decisionPacket?.conditions.map((condition) => condition.id) ?? [],
      requiredAttentionIds: decisionPacket?.attention.map((item) => item.id) ?? [],
      requiredReviewDecisionIds: decisionPacket?.reviewDecisions.map((question) => question.id) ?? [],
      prohibitImpliedAdoption: true,
    },
    decisionContinuation,
  };
}

function taskCommand(stage: 'collect', taskId: string): { argv: string[] } {
  return { argv: ['stetra', 'change', stage, '.', '--task', taskId, '--json'] };
}

function guardCommand(taskId: string): { argv: string[] } {
  return { argv: ['stetra', 'change', 'guard-final', '.', '--task', taskId, '--json'] };
}

function inputAction(
  kind: HostAction['kind'],
  reference: HostWorkflowReference | null,
  taskId: string,
  authoringPacket: AuthoringPacket,
): HostAction {
  const stage = authoringStage(authoringPacket.inputKind);
  const binding = inputBinding(
    stage,
    taskId,
    authoringPacket.inputKind,
    authoringPacket.bindsTo,
    stableFingerprint(authoringPacket),
  );
  const action: HostAction = {
    kind,
    reference,
    command: {
      argv: ['stetra', 'change', stage, '.', '--task', taskId, '--input', binding.draftPath, '--json'],
    },
    finalResponseGuard: guardCommand(taskId),
    inputBinding: binding,
  };
  authoringPackets.set(action, authoringPacket);
  return action;
}

function inputBinding(
  stage: 'diagnose' | 'revise-verification' | 'handoff' | 'decide' | 'resolve',
  taskId: string,
  inputKind: NonNullable<HostAction['inputBinding']>['inputKind'],
  bindsTo: NonNullable<HostAction['inputBinding']>['bindsTo'],
  projectionFingerprint: string,
): NonNullable<HostAction['inputBinding']> {
  const token = taskOwnedInputToken(taskId, stableFingerprint({
    taskId,
    stage,
    inputKind,
    projectionFingerprint,
  }));
  const reservation = ownedInputReservation('.', token);
  return {
    format: 'semantic-authoring',
    inputKind,
    projectionFingerprint,
    bindsTo,
    draftPath: reservation.path,
    guidePath: reservation.path.replace(/\.json$/, '.guide.json'),
    reserve: {
      argv: [
        'stetra', 'input', 'reserve', '.', '--token', token,
        '--task', taskId, '--stage', stage, '--json',
      ],
    },
  };
}

function requiredAuthoringPacket(
  packet: AuthoringPacket | undefined,
  route: string,
): AuthoringPacket {
  if (!packet) {
    throw new Error(`Route ${route} requires an Authoring Projection.`);
  }
  return packet;
}

function latestAttempt(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return latest;
}
