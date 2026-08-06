import type {
  AssurancePlan,
  FactBundle,
  HandoffStatus,
} from '@sovea/stetra-core';

export type HostWorkflowReference = 'routine' | 'assurance' | 'recovery';

export type HostAction =
  | {
      kind:
        | 'implement-and-collect'
        | 'author-handoff'
        | 'retry-timeout'
        | 'restore-and-recollect'
        | 'repair-and-recollect'
        | 'recollect-stale'
        | 'restart-rejected';
      reference: HostWorkflowReference;
      command: { argv: string[] };
    }
  | {
      kind:
        | 'resolve-semantic-decision'
        | 'configure-verification'
        | 'correct-authority'
        | 'review-for-adoption'
        | 'inspect-attention';
      reference: HostWorkflowReference | null;
    };

export function compileProblemHostAction(
  status: 'semantic-decision-required' | 'verification-required' | 'authority-invalid',
): HostAction {
  if (status === 'semantic-decision-required') {
    return { kind: 'resolve-semantic-decision', reference: null };
  }
  if (status === 'verification-required') {
    return { kind: 'configure-verification', reference: null };
  }
  return { kind: 'correct-authority', reference: null };
}

export function unavailableVerificationHostAction(): HostAction {
  return { kind: 'configure-verification', reference: 'recovery' };
}

export function preparedHostAction(plan: AssurancePlan, runId: string): HostAction {
  return {
    kind: 'implement-and-collect',
    reference: plan.profile === 'routine' ? 'routine' : 'assurance',
    command: command('collect', runId),
  };
}

export function collectedHostAction(
  facts: FactBundle,
  plan: AssurancePlan,
  runId: string,
): HostAction {
  const timedOut = facts.checks.filter((check) => latestAttempt(check).timedOut);
  if (timedOut.length) {
    const argv = command('collect', runId).argv;
    for (const check of timedOut) {
      const latest = latestAttempt(check);
      argv.splice(-1, 0, '--retry-check', `${check.id}=<integer-greater-than-${latest.timeoutMs}>`);
    }
    return {
      kind: 'retry-timeout',
      reference: 'recovery',
      command: { argv },
    };
  }

  if (facts.checks.some((check) => latestAttempt(check).status === 'unavailable')) {
    return {
      kind: 'restore-and-recollect',
      reference: 'recovery',
      command: command('collect', runId),
    };
  }

  if (facts.checks.some((check) => latestAttempt(check).status === 'failed')) {
    return {
      kind: 'repair-and-recollect',
      reference: 'recovery',
      command: command('collect', runId),
    };
  }

  return {
    kind: 'author-handoff',
    reference: plan.profile === 'routine' ? 'routine' : 'assurance',
    command: command('finalize', runId),
  };
}

export function staleFactsHostAction(runId: string): HostAction {
  return {
    kind: 'recollect-stale',
    reference: 'recovery',
    command: command('collect', runId),
  };
}

export function finalizedHostAction(status: HandoffStatus, runId: string): HostAction {
  if (status === 'handoff-ready') {
    return { kind: 'review-for-adoption', reference: null };
  }
  if (status === 'needs-attention') {
    return { kind: 'inspect-attention', reference: 'recovery' };
  }
  if (status === 'rejected') {
    return {
      kind: 'restart-rejected',
      reference: 'recovery',
      command: prepareCommand(),
    };
  }
  return staleFactsHostAction(runId);
}

function command(stage: 'collect' | 'finalize', runId: string): { argv: string[] } {
  return {
    argv: ['stetra', 'change', stage, '.', '--run', runId, '--json'],
  };
}

function prepareCommand(): { argv: string[] } {
  return {
    argv: ['stetra', 'change', 'prepare', '.', '--input', '-', '--json'],
  };
}

function latestAttempt(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.id} has no execution attempt.`);
  return latest;
}
