import type { FactBundle, HandoffStatus } from '@sovea/stetra-core';

import type { AuthoringPacket } from './authoring.ts';

export type HostWorkflowReference =
  | 'change'
  | 'delivery'
  | 'challenge'
  | 'handoff'
  | 'recovery';

export interface HostAction {
  kind:
    | 'implement-and-collect'
    | 'diagnose-collected-evidence'
    | 'revise-verification'
    | 'retry-timed-out-check'
    | 'recollect-stale-facts'
    | 'perform-independent-challenge'
    | 'author-handoff'
    | 'review-and-decide'
    | 'resolve-human-choice'
    | 'configure-verification'
    | 'correct-protocol-input'
    | 'resolve-evidence-decision';
  reference: HostWorkflowReference | null;
  command?: { argv: string[] };
  inputBinding?: {
    transport: 'stdin';
    source: 'authoringPacket.draft';
    serialization: 'json';
    execution: 'one-shot';
  };
  authoringPacket?: AuthoringPacket;
}

export function compileProblemHostAction(
  status: 'semantic-decision-required' | 'verification-required' | 'authority-invalid',
): HostAction {
  if (status === 'semantic-decision-required') {
    return { kind: 'resolve-human-choice', reference: 'change' };
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
  challengeAttestationAvailable: boolean;
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
    return input.challengeAttestationAvailable
      ? inputAction('perform-independent-challenge', 'challenge', 'challenge', input.taskId, input.challengePacket)
      : inputAction('author-handoff', 'handoff', 'handoff', input.taskId, input.handoffPacket);
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
  challengeAttestationAvailable = true,
): HostAction {
  if (route === 'repair-implementation') return preparedHostAction(taskId);
  if (route === 'revise-verification') {
    return inputAction(
      'revise-verification', 'recovery', 'revise-verification', taskId,
      requiredAuthoringPacket(packet, route),
    );
  }
  if (route === 'challenge') {
    return challengeAttestationAvailable
      ? inputAction(
          'perform-independent-challenge', 'challenge', 'challenge', taskId,
          requiredAuthoringPacket(packet, route),
        )
      : inputAction(
          'author-handoff', 'handoff', 'handoff', taskId,
          requiredAuthoringPacket(packet, route),
        );
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
    ? inputAction('perform-independent-challenge', 'challenge', 'challenge', taskId, packet)
    : inputAction('author-handoff', 'handoff', 'handoff', taskId, packet);
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
  packet: AuthoringPacket,
): HostAction {
  return inputAction('review-and-decide', 'handoff', 'decide', taskId, packet);
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
