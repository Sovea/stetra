import type { HostPolicyEvaluation, HostPolicyRequirement } from '@sovea/stetra-core';

import { inputError } from '../errors.ts';
import type { CliExecution } from '../presentation/output.ts';
import type { HostAttestationProvider } from '../runtime-context.ts';
import type { HostAction } from '../workflow/host-action.ts';
import { HostChallengeLifecycle, type ChallengeHostProvider } from './challenge-lifecycle.ts';
import { submitHostAction } from './submission.ts';

export interface HostChallengerSession {
  challengerContextId: string;
  sourceSnapshotFingerprint: string;
  run(prompt: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface NativeChallengeHostAdapter {
  provider: ChallengeHostProvider;
  provenance: HostAttestationProvider['provenance'];
  evaluatePolicies(input: {
    taskId: string;
    requirements: HostPolicyRequirement[];
  }): Promise<HostPolicyEvaluation[]>;
  startChallenge(input: {
    projectRoot: string;
    request: NonNullable<HostAction['challengeExecutionRequest']>;
  }): Promise<HostChallengerSession>;
}

export interface ExecuteHostChallengeOptions {
  action: HostAction;
  projectRoot: string;
  parentContextId: string;
  adapter: NativeChallengeHostAdapter;
}

/**
 * Execute and submit one Runtime-projected Challenge through a Host-owned fresh
 * context. The Host adapter owns the actual Agent and workspace controls; this
 * function binds those observations to the exact projected request, limits
 * structural repair, closes the child context, and submits only attested output.
 */
export async function executeHostChallenge(
  options: ExecuteHostChallengeOptions,
): Promise<CliExecution> {
  const request = options.action.challengeExecutionRequest;
  const packet = options.action.challengeExecutionPacket;
  if (options.action.kind !== 'perform-independent-challenge' || !request || !packet) {
    throw inputError('The selected Host Action is not an executable independent Challenge.');
  }
  if (!options.parentContextId.trim()) {
    throw inputError('parentContextId must identify the current Implementer context.');
  }

  const lifecycle = new HostChallengeLifecycle(options.adapter.provider);
  const session = await options.adapter.startChallenge({
    projectRoot: options.projectRoot,
    request,
  });
  try {
    lifecycle.observeStart({
      request,
      challengeExecutionPacket: packet,
      agentType: 'stetra-challenger',
      parentContextId: options.parentContextId,
      challengerContextId: session.challengerContextId,
      targetWorktree: 'read-only',
      executionWorkspace: 'isolated-writable',
      sourceSnapshotFingerprint: session.sourceSnapshotFingerprint,
      externalEffects: 'forbidden',
    });

    let prompt = request.dispatchPrompt;
    while (true) {
      const stopped = lifecycle.observeStop({
        requestId: request.requestId,
        agentType: 'stetra-challenger',
        challengerContextId: session.challengerContextId,
        output: await session.run(prompt),
      });
      if (stopped.status === 'completed') {
        const hostAttestations: HostAttestationProvider = {
          provenance: options.adapter.provenance,
          evaluatePolicies: (input) => options.adapter.evaluatePolicies(input),
          consumeChallengeRun: lifecycle.consumeChallengeRun,
        };
        return await submitHostAction({
          action: options.action,
          document: stopped.round,
          projectRoot: options.projectRoot,
          hostAttestations,
        });
      }
      if (!stopped.mayRetry) {
        throw inputError('The Challenger exhausted its structured-output repair budget.', stopped.issues);
      }
      prompt = challengeRepairPrompt(request.requestId, stopped.issues);
    }
  } finally {
    await session.close();
  }
}

function challengeRepairPrompt(
  requestId: string,
  issues: Array<{ path: string; message: string }>,
): string {
  return [
    `Repair the JSON structure for Challenge request ${requestId}.`,
    'Return only one complete Challenge Round JSON document.',
    'Preserve every semantically material finding, adverse outcome, counter-evidence item, and insufficient coverage already stated.',
    'Correct only the following structural or reference issues:',
    ...issues.map((issue) => `- ${issue.path || '<document>'}: ${issue.message}`),
  ].join('\n');
}
