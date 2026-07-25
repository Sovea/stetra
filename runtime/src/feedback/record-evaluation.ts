import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ChangeEvaluation, EvaluationEvidenceKind } from '../evaluation/types.ts';
import { stableHash } from '../utils/hash.ts';

const FEEDBACK_SCHEMA_VERSION = '1.0';
const AGGREGATE_FILE = 'aggregates.json';

interface FeedbackEvent {
  schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  eventId: string;
  recordedAt: string;
  decisionId: string;
  evaluationId: string;
  guidanceId: string;
  section: 'required' | 'consider' | 'avoid' | 'tension';
  verdict: 'satisfied' | 'violated' | 'excepted';
  evidenceKinds: EvaluationEvidenceKind[];
  excepted: boolean;
  exceptionApprovedBy?: string;
}

interface GuidanceFeedbackAggregate {
  guidanceId: string;
  sections: FeedbackEvent['section'][];
  satisfied: number;
  violated: number;
  excepted: number;
  total: number;
  evidenceKinds: EvaluationEvidenceKind[];
  firstRecordedAt: string;
  lastRecordedAt: string;
  aggregateFingerprint: string;
}

interface FeedbackAggregateDocument {
  schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    eventsFile: string;
    eventCount: number;
    eventsFingerprint: string;
  };
  aggregates: GuidanceFeedbackAggregate[];
}

export function recordEvaluationFeedback(
  feedbackPath: string,
  evaluation: ChangeEvaluation,
): {
  recorded: number;
  path: string;
  aggregatePath: string;
  aggregateCount: number;
  eventsFingerprint: string | null;
} {
  const aggregatePath = join(dirname(feedbackPath), AGGREGATE_FILE);
  const events = feedbackEvents(evaluation);
  if (!events.length && !existsSync(feedbackPath)) {
    return {
      recorded: 0,
      path: feedbackPath,
      aggregatePath,
      aggregateCount: 0,
      eventsFingerprint: null,
    };
  }

  mkdirSync(dirname(feedbackPath), { recursive: true });
  return withFileLock(feedbackPath, () => {
    const priorText = existsSync(feedbackPath) ? readFileSync(feedbackPath, 'utf8') : '';
    const priorEvents = parseFeedbackEvents(priorText, feedbackPath);
    const existingIds = new Set(priorEvents.map((event) => event.eventId));
    const next = events.filter((event) => !existingIds.has(event.eventId));
    if (next.length) {
      appendFileSync(feedbackPath, `${next.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    }
    const allEvents = [...priorEvents, ...next];
    const aggregate = aggregateFeedback(allEvents, basename(feedbackPath));
    writeJsonAtomic(aggregatePath, aggregate);
    return {
      recorded: next.length,
      path: feedbackPath,
      aggregatePath,
      aggregateCount: aggregate.aggregates.length,
      eventsFingerprint: aggregate.source.eventsFingerprint,
    };
  });
}

function feedbackEvents(evaluation: ChangeEvaluation): FeedbackEvent[] {
  return evaluation.results.flatMap((result) => {
    const evidenceBackedSatisfied = result.verdict === 'satisfied' && result.acceptedEvidence.length > 0;
    const evidenceBackedViolation = result.verdict === 'violated' && result.acceptedEvidence.length > 0;
    const approvedException = result.verdict === 'excepted'
      && result.exception?.status === 'approved'
      && Boolean(result.exception.approvedBy?.trim());
    if (!evidenceBackedSatisfied && !evidenceBackedViolation && !approvedException) return [];
    const verdict = result.verdict as FeedbackEvent['verdict'];
    return [{
      schemaVersion: FEEDBACK_SCHEMA_VERSION,
      eventId: stableHash([
        evaluation.evaluationId,
        result.guidanceId,
        result.section,
        verdict,
        result.acceptedEvidence.map((ref) => [ref.kind, ref.ref]),
        result.exception?.approvedBy?.trim() ?? null,
      ]),
      recordedAt: new Date().toISOString(),
      decisionId: evaluation.decisionId,
      evaluationId: evaluation.evaluationId,
      guidanceId: result.guidanceId,
      section: result.section,
      verdict,
      evidenceKinds: [...new Set(result.acceptedEvidence.map((ref) => ref.kind))].sort(),
      excepted: verdict === 'excepted',
      ...(approvedException ? { exceptionApprovedBy: result.exception!.approvedBy!.trim() } : {}),
    }];
  });
}

function parseFeedbackEvents(text: string, feedbackPath: string): FeedbackEvent[] {
  const events: FeedbackEvent[] = [];
  const ids = new Set<string>();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid feedback event at ${feedbackPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isFeedbackEvent(value)) {
      throw new Error(`Invalid or unsupported feedback event at ${feedbackPath}:${index + 1}.`);
    }
    if (ids.has(value.eventId)) {
      throw new Error(`Duplicate feedback eventId ${value.eventId} at ${feedbackPath}:${index + 1}.`);
    }
    ids.add(value.eventId);
    events.push(value);
  }
  return events;
}

function aggregateFeedback(
  events: FeedbackEvent[],
  eventsFile: string,
): FeedbackAggregateDocument {
  const byGuidance = new Map<string, FeedbackEvent[]>();
  for (const event of events) {
    const values = byGuidance.get(event.guidanceId) ?? [];
    values.push(event);
    byGuidance.set(event.guidanceId, values);
  }
  const aggregates = [...byGuidance.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([guidanceId, values]) => {
      const ordered = [...values].sort((left, right) =>
        left.recordedAt.localeCompare(right.recordedAt)
        || left.eventId.localeCompare(right.eventId));
      return {
        guidanceId,
        sections: [...new Set(values.map((event) => event.section))].sort(),
        satisfied: values.filter((event) => event.verdict === 'satisfied').length,
        violated: values.filter((event) => event.verdict === 'violated').length,
        excepted: values.filter((event) => event.verdict === 'excepted').length,
        total: values.length,
        evidenceKinds: [...new Set(values.flatMap((event) => event.evidenceKinds))].sort(),
        firstRecordedAt: ordered[0].recordedAt,
        lastRecordedAt: ordered.at(-1)!.recordedAt,
        aggregateFingerprint: stableHash([
          guidanceId,
          values.map((event) => event.eventId).sort(),
        ]),
      };
    });
  const orderedEvents = [...events].sort((left, right) => left.eventId.localeCompare(right.eventId));
  return {
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    generatedAt: events.length
      ? [...events].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)).at(-1)!.recordedAt
      : new Date(0).toISOString(),
    source: {
      eventsFile,
      eventCount: events.length,
      eventsFingerprint: stableHash(orderedEvents.map((event) => [
        event.eventId,
        event.guidanceId,
        event.verdict,
      ])),
    },
    aggregates,
  };
}

function isFeedbackEvent(value: unknown): value is FeedbackEvent {
  if (!isRecord(value)
    || value.schemaVersion !== FEEDBACK_SCHEMA_VERSION
    || !nonEmpty(value.eventId)
    || !nonEmpty(value.recordedAt)
    || Number.isNaN(Date.parse(value.recordedAt))
    || !nonEmpty(value.decisionId)
    || !nonEmpty(value.evaluationId)
    || !nonEmpty(value.guidanceId)
    || !['required', 'consider', 'avoid', 'tension'].includes(String(value.section))
    || !['satisfied', 'violated', 'excepted'].includes(String(value.verdict))
    || !Array.isArray(value.evidenceKinds)
    || !value.evidenceKinds.every((kind) => ['diff', 'file', 'check', 'semantic'].includes(String(kind)))
    || typeof value.excepted !== 'boolean'
    || value.excepted !== (value.verdict === 'excepted')) {
    return false;
  }
  return value.verdict !== 'excepted' || nonEmpty(value.exceptionApprovedBy);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
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

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
