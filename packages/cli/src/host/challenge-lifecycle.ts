import { randomUUID } from 'node:crypto';

import {
  ChallengeDocumentSchema,
  type ChallengeDocument,
  type HostChallengeRunReceipt,
} from '../schemas/delegation.ts';
import { stableFingerprint } from '../protocol.ts';
import type { ChallengeExecutionPacket } from '../workflow/challenge-projection.ts';
import { challengeReferenceIssues } from '../workflow/challenge-references.ts';
import type { ChallengeExecutionRequest } from '../workflow/host-action.ts';

export type ChallengeHostProvider = 'codex' | 'claude' | 'evaluation-runner';

export interface ChallengeRunStartObservation {
  request: ChallengeExecutionRequest;
  challengeExecutionPacket: ChallengeExecutionPacket;
  agentType: 'stetra-challenger';
  parentContextId: string;
  challengerContextId: string;
  targetWorktree: 'read-only';
  executionWorkspace: 'isolated-writable';
  sourceSnapshotFingerprint: string;
  externalEffects: 'forbidden';
}

export type ChallengeRunStopObservation =
  | {
      status: 'invalid-output';
      requestId: string;
      mayRetry: boolean;
      issues: Array<{ path: string; message: string }>;
    }
  | {
      status: 'completed';
      requestId: string;
      challenge: ChallengeDocument;
      receipt: HostChallengeRunReceipt;
    };

interface StartedRun {
  request: ChallengeExecutionRequest;
  challengeExecutionPacket: ChallengeExecutionPacket;
  requestFingerprint: string;
  parentContextId: string;
  challengerContextId: string;
  targetWorktree: 'read-only';
  executionWorkspace: 'isolated-writable';
  sourceSnapshotFingerprint: string;
  externalEffects: 'forbidden';
  invalidOutputCount: number;
  counterEvidenceRepairConstraint?: ChallengeDocument['counterEvidence'];
  completed?: {
    challenge: ChallengeDocument;
    receipt: HostChallengeRunReceipt;
    consumed: boolean;
  };
}

/**
 * Binds one Host-observed challenger lifecycle to one Runtime-derived request.
 * The embedding Host still owns starting the actual subagent and enforcing its
 * tool policy; this registry owns no scheduler, process, or persisted state.
 */
export class HostChallengeLifecycle {
  readonly provider: ChallengeHostProvider;
  readonly #runs = new Map<string, StartedRun>();

  constructor(provider: ChallengeHostProvider) {
    this.provider = provider;
  }

  observeStart(input: ChallengeRunStartObservation): void {
    if (input.agentType !== input.request.agentProfile) {
      throw new Error('Challenge lifecycle agent type does not match the execution request.');
    }
    if (input.parentContextId.trim() === '' || input.challengerContextId.trim() === '') {
      throw new Error('Challenge lifecycle requires non-empty Host context identities.');
    }
    if (input.parentContextId === input.challengerContextId) {
      throw new Error('Independent Challenge requires a context distinct from the implementer.');
    }
    if (input.request.contextPolicy !== 'fresh-required'
      || input.request.workspacePolicy.targetWorktree !== input.targetWorktree
      || input.request.workspacePolicy.executionWorkspace !== input.executionWorkspace
      || input.request.workspacePolicy.externalEffects !== input.externalEffects) {
      throw new Error('Unsupported Challenge execution policy.');
    }
    if (input.request.bindsTo.challengeExecutionPacketFingerprint
      !== stableFingerprint(input.challengeExecutionPacket)) {
      throw new Error('Challenge execution packet does not match the Host request binding.');
    }
    if (input.sourceSnapshotFingerprint !== input.request.bindsTo.worktreeFingerprint
      || input.sourceSnapshotFingerprint !== input.challengeExecutionPacket.bindsTo.worktreeFingerprint) {
      throw new Error('Challenge execution workspace does not match the current worktree snapshot.');
    }
    if (this.#runs.has(input.request.requestId)) {
      throw new Error(`Challenge execution request ${input.request.requestId} already started.`);
    }
    this.#runs.set(input.request.requestId, {
      request: structuredClone(input.request),
      challengeExecutionPacket: structuredClone(input.challengeExecutionPacket),
      requestFingerprint: stableFingerprint(input.request),
      parentContextId: input.parentContextId,
      challengerContextId: input.challengerContextId,
      targetWorktree: input.targetWorktree,
      executionWorkspace: input.executionWorkspace,
      sourceSnapshotFingerprint: input.sourceSnapshotFingerprint,
      externalEffects: input.externalEffects,
      invalidOutputCount: 0,
    });
  }

  observeStop(input: {
    requestId: string;
    agentType: 'stetra-challenger';
    challengerContextId: string;
    output: unknown;
  }): ChallengeRunStopObservation {
    const run = this.#runs.get(input.requestId);
    if (!run) throw new Error(`Challenge execution request ${input.requestId} did not start.`);
    if (run.completed) throw new Error(`Challenge execution request ${input.requestId} already completed.`);
    if (input.agentType !== run.request.agentProfile
      || input.challengerContextId !== run.challengerContextId) {
      throw new Error('Challenge stop observation does not match its Host-observed start.');
    }

    const parsedJson = parseJsonOutput(input.output);
    const parsed = parsedJson.ok
      ? ChallengeDocumentSchema.safeParse(parsedJson.value)
      : undefined;
    if (!parsed?.success) {
      const constraint = parsedJson.ok
        ? supportedCounterEvidenceConstraint(parsedJson.value, parsed!.error.issues)
        : undefined;
      if (constraint) run.counterEvidenceRepairConstraint = constraint;
      run.invalidOutputCount += 1;
      const mayRetry = run.invalidOutputCount <= run.request.outputRepairBudget;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry,
        issues: parsedJson.ok
          ? parsed!.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            }))
          : [{ path: '', message: parsedJson.message }],
      };
    }

    if (run.invalidOutputCount > run.request.outputRepairBudget) {
      throw new Error(`Challenge execution request ${input.requestId} exhausted its output repair budget.`);
    }
    const challenge = parsed.data;
    const referenceIssues = challengeReferenceIssues(
      challenge,
      run.challengeExecutionPacket.draft.evidence,
    );
    if (referenceIssues.length) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: referenceIssues,
      };
    }
    if (run.counterEvidenceRepairConstraint
      && stableFingerprint(challenge.counterEvidence)
        !== stableFingerprint(run.counterEvidenceRepairConstraint)) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: [{
          path: 'counterEvidence',
          message: 'must preserve the counter-evidence authored before structural repair',
        }],
      };
    }
    const outputFingerprint = stableFingerprint(challenge);
    const receipt: HostChallengeRunReceipt = {
      receiptId: `receipt:${randomUUID()}`,
      requestId: input.requestId,
      provider: this.provider,
      agentType: 'stetra-challenger',
      parentContextId: run.parentContextId,
      challengerContextId: run.challengerContextId,
      lifecycle: 'start-and-stop-observed',
      contextFingerprint: stableFingerprint({
        requestFingerprint: run.requestFingerprint,
        provider: this.provider,
        parentContextId: run.parentContextId,
        challengerContextId: run.challengerContextId,
        targetWorktree: run.targetWorktree,
        executionWorkspace: run.executionWorkspace,
        sourceSnapshotFingerprint: run.sourceSnapshotFingerprint,
        externalEffects: run.externalEffects,
      }),
      outputFingerprint,
      targetWorktree: run.targetWorktree,
      executionWorkspace: run.executionWorkspace,
      sourceSnapshotFingerprint: run.sourceSnapshotFingerprint,
      externalEffects: run.externalEffects,
    };
    run.completed = { challenge, receipt, consumed: false };
    return {
      status: 'completed',
      requestId: input.requestId,
      challenge,
      receipt,
    };
  }

  readonly consumeChallengeRun = async (input: {
    request: ChallengeExecutionRequest;
    challenge: ChallengeDocument;
  }): Promise<HostChallengeRunReceipt | undefined> => {
    const run = this.#runs.get(input.request.requestId);
    if (!run?.completed || run.completed.consumed) return undefined;
    if (run.requestFingerprint !== stableFingerprint(input.request)
      || stableFingerprint(run.completed.challenge) !== stableFingerprint(input.challenge)) {
      return undefined;
    }
    run.completed.consumed = true;
    return structuredClone(run.completed.receipt);
  };
}

function supportedCounterEvidenceConstraint(
  value: unknown,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): ChallengeDocument['counterEvidence'] | undefined {
  if (issues.length !== 1
    || issues[0].path.join('.') !== 'counterEvidence'
    || !issues[0].message.includes('outcome changed')) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const counterEvidence = (value as { counterEvidence?: unknown }).counterEvidence;
  return Array.isArray(counterEvidence) && counterEvidence.length
    ? structuredClone(counterEvidence) as ChallengeDocument['counterEvidence']
    : undefined;
}

function parseJsonOutput(input: unknown):
  | { ok: true; value: unknown }
  | { ok: false; message: string } {
  if (typeof input !== 'string') return { ok: true, value: input };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false, message: 'Challenger output must be one JSON document without Markdown.' };
  }
}
