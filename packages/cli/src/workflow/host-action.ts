import type {
  AssurancePlan,
  FactBundle,
  HandoffStatus,
} from '@sovea/resonant-code-core';

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
      reason: string;
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
      reason: string;
    };

export function compileProblemHostAction(
  status: 'semantic-decision-required' | 'verification-required' | 'authority-invalid',
): HostAction {
  if (status === 'semantic-decision-required') {
    return {
      kind: 'resolve-semantic-decision',
      reference: null,
      reason: 'Resolve the reported material Human decision before preparing again.',
    };
  }
  if (status === 'verification-required') {
    return {
      kind: 'configure-verification',
      reference: null,
      reason: 'Supply runnable explicit checks or a concrete no-command rationale before preparing again.',
    };
  }
  return {
    kind: 'correct-authority',
    reference: null,
    reason: 'Correct the reported event, evidence, or interpretation references before preparing again.',
  };
}

export function unavailableVerificationHostAction(): HostAction {
  return {
    kind: 'configure-verification',
    reference: 'recovery',
    reason: 'Restore each unavailable top-level executable or select a runnable explicit check before preparing again.',
  };
}

export function preparedHostAction(plan: AssurancePlan, runId: string): HostAction {
  return {
    kind: 'implement-and-collect',
    reference: plan.profile === 'routine' ? 'routine' : 'assurance',
    reason: plan.profile === 'routine'
      ? 'Implement the compiled low-consequence change, then collect Runtime facts.'
      : 'Implement against the compiled assurance requirements, then collect Runtime facts.',
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
      reason: 'Retry only the latest timed-out checks in this unchanged run with larger budgets.',
      command: { argv },
    };
  }

  if (facts.checks.some((check) => latestAttempt(check).status === 'unavailable')) {
    return {
      kind: 'restore-and-recollect',
      reference: 'recovery',
      reason: 'Restore the unavailable check environment, then recollect every frozen check.',
      command: command('collect', runId),
    };
  }

  if (facts.checks.some((check) => latestAttempt(check).status === 'failed')) {
    return {
      kind: 'repair-and-recollect',
      reference: 'recovery',
      reason: 'Repair the failed verification inside the compiled contract, then recollect fresh facts.',
      command: command('collect', runId),
    };
  }

  return {
    kind: 'author-handoff',
    reference: plan.profile === 'routine' ? 'routine' : 'assurance',
    reason: plan.profile === 'routine'
      ? 'Inspect the complete patch once and author the minimal routine handoff.'
      : 'Inspect the complete facts and author every compiled assurance obligation.',
    command: command('finalize', runId),
  };
}

export function staleFactsHostAction(runId: string): HostAction {
  return {
    kind: 'recollect-stale',
    reference: 'recovery',
    reason: 'The worktree changed after collection; collect fresh Runtime facts before relying on the handoff.',
    command: command('collect', runId),
  };
}

export function finalizedHostAction(status: HandoffStatus, runId: string): HostAction {
  if (status === 'handoff-ready') {
    return {
      kind: 'review-for-adoption',
      reference: null,
      reason: 'Review the evidence package; adoption remains a Human decision.',
    };
  }
  if (status === 'needs-attention') {
    return {
      kind: 'inspect-attention',
      reference: 'recovery',
      reason: 'Follow every Attention action and inspect its referenced review surface before adoption.',
    };
  }
  if (status === 'rejected') {
    return {
      kind: 'restart-rejected',
      reference: 'recovery',
      reason: 'Do not adopt the rejected change; repair under a newly prepared run with a fresh baseline.',
      command: prepareCommand(),
    };
  }
  return staleFactsHostAction(runId);
}

function command(stage: 'collect' | 'finalize', runId: string): { argv: string[] } {
  return {
    argv: ['resonant-code', 'change', stage, '.', '--run', runId, '--json'],
  };
}

function prepareCommand(): { argv: string[] } {
  return {
    argv: ['resonant-code', 'change', 'prepare', '.', '--input', '-', '--json'],
  };
}

function latestAttempt(check: FactBundle['checks'][number]) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.id} has no execution attempt.`);
  return latest;
}
