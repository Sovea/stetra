import { randomUUID } from 'node:crypto';

import {
  ChallengeRoundDocumentSchema,
  type ChallengeDocument,
  type ChallengeRoundDocument,
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
      round: ChallengeRoundDocument;
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
  counterEvidenceRepairConstraints: Map<number, ChallengeDocument['counterEvidence']>;
  evidenceCoverageRepairConstraints: Map<number, ChallengeDocument['evidenceCoverage']>;
  completed?: {
    round: ChallengeRoundDocument;
    receipt: HostChallengeRunReceipt;
    consumed: boolean;
  };
}

/**
 * Binds one Host-observed challenger lifecycle to one Runtime-derived Round.
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
      counterEvidenceRepairConstraints: new Map(),
      evidenceCoverageRepairConstraints: new Map(),
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
      ? ChallengeRoundDocumentSchema.safeParse(parsedJson.value)
      : undefined;
    if (!parsed?.success) {
      if (parsedJson.ok) {
        preserveRepairConstraints(
          parsedJson.value,
          parsed!.error.issues,
          run.counterEvidenceRepairConstraints,
          run.evidenceCoverageRepairConstraints,
        );
      }
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
    const round = parsed.data;
    if (round.results.length !== run.challengeExecutionPacket.cases.length) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: [{ path: 'results', message: 'must answer every exact Challenge case once' }],
      };
    }
    const referenceIssues = round.results.flatMap((challenge, index) =>
      challengeReferenceIssues(
        challenge,
        run.challengeExecutionPacket.cases[index]!.draft.evidence,
      ).map((issue) => ({ ...issue, path: `results.${index}.${issue.path}` })));
    if (referenceIssues.length) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: referenceIssues,
      };
    }
    const counterEvidenceChanged = [...run.counterEvidenceRepairConstraints].find(([index, constraint]) =>
      stableFingerprint(round.results[index]?.counterEvidence) !== stableFingerprint(constraint));
    if (counterEvidenceChanged) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: [{
          path: `results.${counterEvidenceChanged[0]}.counterEvidence`,
          message: 'must preserve the counter-evidence authored before structural repair',
        }],
      };
    }
    const coverageChanged = [...run.evidenceCoverageRepairConstraints].find(([index, constraint]) =>
      stableFingerprint(round.results[index]?.evidenceCoverage) !== stableFingerprint(constraint));
    if (coverageChanged) {
      run.invalidOutputCount += 1;
      return {
        status: 'invalid-output',
        requestId: input.requestId,
        mayRetry: run.invalidOutputCount <= run.request.outputRepairBudget,
        issues: [{
          path: `results.${coverageChanged[0]}.evidenceCoverage`,
          message: 'must preserve the declared coverage gaps authored before structural repair',
        }],
      };
    }
    const outputFingerprint = stableFingerprint(round);
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
    run.completed = { round, receipt, consumed: false };
    return {
      status: 'completed',
      requestId: input.requestId,
      round,
      receipt,
    };
  }

  readonly consumeChallengeRun = async (input: {
    request: ChallengeExecutionRequest;
    round: ChallengeRoundDocument;
  }): Promise<HostChallengeRunReceipt | undefined> => {
    const run = this.#runs.get(input.request.requestId);
    if (!run?.completed || run.completed.consumed) return undefined;
    if (run.requestFingerprint !== stableFingerprint(input.request)
      || stableFingerprint(run.completed.round) !== stableFingerprint(input.round)) {
      return undefined;
    }
    run.completed.consumed = true;
    return structuredClone(run.completed.receipt);
  };
}

function preserveRepairConstraints(
  value: unknown,
  issues: Array<{ path: PropertyKey[]; message: string }>,
  counterEvidence: Map<number, ChallengeDocument['counterEvidence']>,
  coverage: Map<number, ChallengeDocument['evidenceCoverage']>,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return;
  for (const issue of issues) {
    const [root, rawIndex, field, nested] = issue.path;
    if (root !== 'results' || typeof rawIndex !== 'number') continue;
    const result = results[rawIndex];
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
    if (field === 'counterEvidence'
      && issue.message.includes('outcome changed')) {
      const candidate = (result as { counterEvidence?: unknown }).counterEvidence;
      if (Array.isArray(candidate) && candidate.length) {
        counterEvidence.set(
          rawIndex,
          structuredClone(candidate) as ChallengeDocument['counterEvidence'],
        );
      }
    }
    if (field === 'evidenceCoverage' && nested === 'status'
      && issue.message.includes('must be sufficient')) {
      const candidate = (result as { evidenceCoverage?: unknown }).evidenceCoverage;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const assessment = candidate as Record<string, unknown>;
      if (assessment.status === 'insufficient'
        && typeof assessment.rationale === 'string'
        && Array.isArray(assessment.gaps)
        && assessment.gaps.every((item) => typeof item === 'string')) {
        coverage.set(
          rawIndex,
          structuredClone(candidate) as ChallengeDocument['evidenceCoverage'],
        );
      }
    }
  }
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
