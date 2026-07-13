import {
  verifyObservationEvidence,
  verifyObservationInduction,
  type RcclObservation as RcclSourceObservation,
} from '@resonant-code/rccl/runtime';
import { unique } from '../utils/common.ts';
import { normalizePath, pathMatchesScope, scopeOverlapsPath, fileOverlapsTarget } from '../utils/paths.ts';
import type {
  RcclDocument,
  RcclObservation,
  ResolvedTaskOutput,
  RuntimeRcclVerificationPolicy,
  RuntimeRcclVerificationRecord,
  RuntimeRcclVerificationSummary,
} from '../types.ts';

export interface VerifyRcclDocumentOptions {
  projectRoot: string;
  policy?: RuntimeRcclVerificationPolicy;
  resolvedTask?: ResolvedTaskOutput;
  now?: Date;
}

export interface VerifyRcclDocumentResult {
  document: RcclDocument;
  summary: RuntimeRcclVerificationSummary;
}

/**
 * Backward-compatible wrapper that preserves stored verification; incomplete observations stay ambient downstream.
 */
export async function verifyRcclDocument(rccl: RcclDocument, projectRoot: string, now = new Date()): Promise<RcclDocument> {
  const result = await verifyRcclDocumentWithSummary(rccl, {
    projectRoot,
    policy: 'trust-existing',
    now,
  });
  return result.document;
}

/**
 * Verifies RCCL observations according to the Runtime task-time trust policy.
 */
export async function verifyRcclDocumentWithSummary(
  rccl: RcclDocument,
  options: VerifyRcclDocumentOptions,
): Promise<VerifyRcclDocumentResult> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const policy = options.policy ?? 'task-relevant';
  const targets = taskTargets(options.resolvedTask);
  const records: RuntimeRcclVerificationRecord[] = [];
  const observations = rccl.observations.map((observation) => {
    const relevance = observationTaskRelevance(observation, targets);
    const before = verificationSnapshot(observation);
    const shouldReverify = shouldReverifyObservation(observation, policy, relevance.taskRelevant);

    if (!shouldReverify) {
      const action = policy === 'task-relevant' && !relevance.taskRelevant
        ? 'skipped-not-task-relevant'
        : 'reused';
      records.push({
        observation_id: observation.id,
        action,
        task_relevant: relevance.taskRelevant,
        reason: action === 'skipped-not-task-relevant'
          ? relevance.reason
          : reuseReason(policy, relevance.reason),
        before,
        after: before,
      });
      return observation;
    }

    const verified = verifyObservationInduction(
      verifyObservationEvidence(observation as unknown as RcclSourceObservation, options.projectRoot, checkedAt),
    ) as unknown as RcclObservation;
    const after = verificationSnapshot(verified);
    records.push({
      observation_id: observation.id,
      action: dispositionWasReduced(before.disposition, after.disposition) ? 'demoted' : 'reverified',
      task_relevant: relevance.taskRelevant,
      reason: verificationReason(policy, relevance.reason),
      before,
      after,
    });
    return verified;
  });

  const summary = summarizeVerification(policy, records);
  return {
    document: {
      ...rccl,
      observations,
    },
    summary,
  };
}

function summarizeVerification(
  policy: RuntimeRcclVerificationPolicy,
  records: RuntimeRcclVerificationRecord[],
): RuntimeRcclVerificationSummary {
  return {
    policy,
    reverified_count: records.filter((record) => record.action === 'reverified').length,
    reused_count: records.filter((record) => record.action === 'reused').length,
    demoted_count: records.filter((record) => record.action === 'demoted').length,
    skipped_not_task_relevant_count: records.filter((record) => record.action === 'skipped-not-task-relevant').length,
    records,
  };
}

function shouldReverifyObservation(
  observation: RcclObservation,
  policy: RuntimeRcclVerificationPolicy,
  taskRelevant: boolean,
): boolean {
  if (policy === 'deep') return true;
  if (policy === 'task-relevant') return taskRelevant;
  return false;
}

function taskTargets(resolvedTask: ResolvedTaskOutput | undefined): string[] {
  if (!resolvedTask) return [];
  return unique([
    resolvedTask.task.targetFile,
    ...(resolvedTask.task.changedFiles ?? []),
    resolvedTask.task_intent.target_file,
    ...resolvedTask.task_intent.changed_files,
  ].filter((value): value is string => Boolean(value)).map(normalizePath));
}

function observationTaskRelevance(
  observation: RcclObservation,
  targets: string[],
): { taskRelevant: boolean; reason: string } {
  if (targets.length === 0) {
    return {
      taskRelevant: true,
      reason: 'no task file scope was provided; observation may enter semantic relation candidates',
    };
  }
  for (const target of targets) {
    if (scopeOverlapsPath(observation.scope, target)) {
      return { taskRelevant: true, reason: `observation scope overlaps task target ${target}` };
    }
    const evidenceHit = observation.evidence.find((evidence) => fileOverlapsTarget(evidence.file, target));
    if (evidenceHit) {
      return { taskRelevant: true, reason: `evidence file ${evidenceHit.file} overlaps task target ${target}` };
    }
  }
  return { taskRelevant: false, reason: 'observation scope and evidence do not overlap current task targets' };
}

function verificationSnapshot(observation: RcclObservation): RuntimeRcclVerificationRecord['before'] {
  return {
    evidence_status: observation.verification.evidence_status,
    induction_status: observation.verification.induction_status,
    disposition: observation.verification.disposition,
    checked_at: observation.verification.checked_at,
  };
}

function dispositionWasReduced(
  before: RcclObservation['verification']['disposition'],
  after: RcclObservation['verification']['disposition'],
): boolean {
  return dispositionRank(after) > dispositionRank(before);
}

function dispositionRank(disposition: RcclObservation['verification']['disposition']): number {
  if (disposition === 'demote-to-ambient') return 2;
  if (disposition === 'keep-with-reduced-confidence') return 1;
  return 0;
}

function verificationReason(policy: RuntimeRcclVerificationPolicy, relevanceReason: string): string {
  if (policy === 'deep') return 'deep policy reverified all RCCL observations';
  return relevanceReason;
}

function reuseReason(policy: RuntimeRcclVerificationPolicy, relevanceReason: string): string {
  if (policy === 'trust-existing') return 'trust-existing policy reused stored RCCL verification; incomplete verification remains ambient downstream';
  if (policy === 'deep') return 'deep policy should not reuse observations';
  return relevanceReason;
}
