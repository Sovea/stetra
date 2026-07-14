import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChangeEvaluation } from '../evaluation/types.ts';
import { stableHash } from '../utils/hash.ts';

const FEEDBACK_SCHEMA_VERSION = '1.0';

export function recordEvaluationFeedback(
  feedbackPath: string,
  evaluation: ChangeEvaluation,
): { recorded: number; path: string } {
  const events = evaluation.results.flatMap((result) => {
    const evidenceBackedSatisfied = result.verdict === 'satisfied' && result.acceptedEvidence.length > 0;
    const evidenceBackedViolation = result.verdict === 'violated' && result.acceptedEvidence.length > 0;
    if (!evidenceBackedSatisfied && !evidenceBackedViolation && result.verdict !== 'excepted') return [];
    const event = {
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      eventId: stableHash([
        evaluation.evaluationId,
        result.guidanceId,
        result.section,
        result.verdict,
        result.acceptedEvidence.map((ref) => [ref.kind, ref.ref]),
      ]),
      recordedAt: new Date().toISOString(),
      decisionId: evaluation.decisionId,
      evaluationId: evaluation.evaluationId,
      guidanceId: result.guidanceId,
      section: result.section,
      verdict: result.verdict,
      evidenceKinds: [...new Set(result.acceptedEvidence.map((ref) => ref.kind))].sort(),
      excepted: result.verdict === 'excepted',
    };
    return [event];
  });
  if (!events.length) return { recorded: 0, path: feedbackPath };

  mkdirSync(dirname(feedbackPath), { recursive: true });
  return withFileLock(feedbackPath, () => {
    const prior = existsSync(feedbackPath) ? readFileSync(feedbackPath, 'utf8') : '';
    const existingIds = new Set(prior
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as { eventId?: unknown };
          return typeof value.eventId === 'string' ? [value.eventId] : [];
        } catch {
          return [];
        }
      }));
    const next = events.filter((event) => !existingIds.has(event.eventId));
    if (next.length) {
      appendFileSync(feedbackPath, `${next.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    }
    return { recorded: next.length, path: feedbackPath };
  });
}

function withFileLock<T>(feedbackPath: string, action: () => T): T {
  const lockPath = `${feedbackPath}.lock`;
  let handle: number | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      handle = openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (handle === null) throw new Error(`Timed out waiting for feedback lock: ${lockPath}`);
  try {
    return action();
  } finally {
    closeSync(handle);
    rmSync(lockPath, { force: true });
  }
}
