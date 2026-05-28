import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseYaml, toYaml } from './utils/yaml.ts';
import type {
  EvaluateInput,
  ExecutionMode,
  FeedbackSignalConfidence,
  HostFulfillmentArtifactSummary,
  HostFulfillmentFeedbackSummary,
  IgnoredReason,
  LockfileDirectiveEntry,
  LockfileDocument,
  LockfileObservationEntry,
  LockfileTensionEntry,
} from './types.ts';

export function evaluateGuidance(input: EvaluateInput): LockfileDocument {
  const existing = loadLockfile(input.lockfilePath);
  const trackedDirectiveIds = getTrackedDirectiveIds(input);
  const adherenceResolved = resolveFromAdherencePayload(input, trackedDirectiveIds);
  const hasExplicitDirectiveSignal = Boolean(
    adherenceResolved
    || input.followedDirectiveIds?.length
    || input.ignoredDirectiveIds?.length,
  );
  const followed = adherenceResolved?.followed ?? new Set(input.followedDirectiveIds ?? []);
  const ignored = adherenceResolved?.ignored ?? new Set(input.ignoredDirectiveIds ?? []);
  const partial = adherenceResolved?.partial ?? new Set<string>();
  const ignoredReasons = adherenceResolved?.ignoredReasons ?? input.ignoredDirectiveReasons;
  const taskType = input.ego.taskIntent.operation;
  const taskProfile = taskProfileKey(input);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const modeCounts = summarizeExecutionModes(input);
  const tensionCount = input.packet.governance.semantic_merge.context_tensions.length;
  const observedRccl = getObservedRccl(input);

  existing.governance_summary.total_tasks += 1;
  existing.governance_summary.by_task_type[taskType] = (existing.governance_summary.by_task_type[taskType] ?? 0) + 1;
  existing.governance_summary.by_task_profile[taskProfile] = (existing.governance_summary.by_task_profile[taskProfile] ?? 0) + 1;
  existing.governance_summary.last_execution_modes = modeCounts;
  existing.governance_summary.last_tension_count = tensionCount;
  existing.governance_summary.last_observation_count = observedRccl.size;
  existing.governance_summary.last_host_fulfillment = summarizeHostFulfillmentFeedback(input);
  existing.governance_summary.last_updated_at = now;

  updateObservationFeedback(existing, observedRccl, input, now);
  updateTensionFeedback(existing, input, now);

  if (!hasExplicitDirectiveSignal) {
    writeFileSync(input.lockfilePath, toYaml(existing as never), 'utf-8');
    return existing;
  }

  for (const directiveId of trackedDirectiveIds) {
    const entry = existing.directives[directiveId] ?? createEntry();
    const counts = entry.quality_signal.by_task_type[taskType] ?? { followed: 0, ignored: 0, partial: 0 };
    const profileCounts = entry.quality_signal.by_task_profile[taskProfile] ?? { followed: 0, ignored: 0, partial: 0 };
    if (ignored.has(directiveId)) {
      entry.quality_signal.overall.ignored += 1;
      counts.ignored += 1;
      profileCounts.ignored += 1;
      const ignoredReason = validIgnoredReason(ignoredReasons?.[directiveId])
        ? ignoredReasons[directiveId]
        : undefined;
      if (ignoredReason) {
        entry.quality_signal.ignored_reasons[ignoredReason] = (entry.quality_signal.ignored_reasons[ignoredReason] ?? 0) + 1;
        entry.quality_signal.last_ignored_reason = ignoredReason;
      }
    } else if (partial.has(directiveId)) {
      entry.quality_signal.overall.partial += 1;
      counts.partial += 1;
      profileCounts.partial += 1;
    } else if (followed.has(directiveId)) {
      entry.quality_signal.overall.followed += 1;
      counts.followed += 1;
      profileCounts.followed += 1;
    }
    entry.quality_signal.by_task_type[taskType] = counts;
    entry.quality_signal.by_task_profile[taskProfile] = profileCounts;
    entry.quality_signal.overall.follow_rate = computeFollowRate(entry);
    entry.quality_signal.overall.trend = computeTrend(entry);
    entry.quality_signal.signal_confidence = adherenceResolved
      ? 'explicit'
      : resolveSignalConfidence(input, ignored.has(directiveId));
    entry.quality_signal.last_seen = today;
    entry.governance = {
      outcomes: {
        total_tasks: (entry.governance?.outcomes.total_tasks ?? 0) + 1,
        with_tensions: (entry.governance?.outcomes.with_tensions ?? 0) + (tensionCount > 0 ? 1 : 0),
        last_execution_modes: modeCounts,
        last_tension_count: tensionCount,
        last_updated_at: now,
      },
    };
    existing.directives[directiveId] = entry;
  }

  writeFileSync(input.lockfilePath, toYaml(existing as never), 'utf-8');
  return existing;
}

function loadLockfile(filePath: string): LockfileDocument {
  if (!existsSync(filePath)) return createDocument();
  const parsed = parseYaml(readFileSync(filePath, 'utf-8')) as unknown;
  if (!isLockfileDocument(parsed)) return createDocument();
  return {
    version: '1.0',
    directives: normalizeDirectiveEntries(parsed.directives),
    observations: normalizeObservationEntries(parsed.observations),
    tensions: normalizeTensionEntries(parsed.tensions),
    governance_summary: {
      ...parsed.governance_summary,
      by_task_profile: parsed.governance_summary.by_task_profile ?? {},
    },
  };
}

function isLockfileDocument(value: unknown): value is LockfileDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<LockfileDocument>;
  return isLockfileVersion(candidate.version)
    && isRecord(candidate.directives)
    && isRecord(candidate.observations)
    && isRecord(candidate.tensions)
    && Boolean(candidate.governance_summary)
    && typeof candidate.governance_summary === 'object';
}

function isLockfileVersion(value: unknown): boolean {
  return value === '1.0' || value === 1 || value === 1.0;
}

function isRecord(value: unknown): value is Record<string, never> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeObservationEntries(entries: Record<string, LockfileObservationEntry>): Record<string, LockfileObservationEntry> {
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
    ...createObservationEntry(),
    ...entry,
    last_content_fingerprint: entry.last_content_fingerprint ?? null,
  }]));
}

function normalizeDirectiveEntries(entries: Record<string, LockfileDirectiveEntry>): Record<string, LockfileDirectiveEntry> {
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
    const normalized = createEntry();
    return [id, {
      ...normalized,
      ...entry,
      quality_signal: {
        ...normalized.quality_signal,
        ...entry.quality_signal,
        overall: {
          ...normalized.quality_signal.overall,
          ...entry.quality_signal?.overall,
          partial: (entry.quality_signal?.overall as { partial?: number })?.partial ?? 0,
        },
        by_task_type: entry.quality_signal?.by_task_type ?? {},
        by_task_profile: entry.quality_signal?.by_task_profile ?? {},
        ignored_reasons: normalizeIgnoredReasons(entry.quality_signal?.ignored_reasons),
        ...(validIgnoredReason(entry.quality_signal?.last_ignored_reason)
          ? { last_ignored_reason: entry.quality_signal.last_ignored_reason }
          : {}),
        signal_confidence: validSignalConfidence(entry.quality_signal?.signal_confidence)
          ? entry.quality_signal.signal_confidence
          : 'implicit',
        last_seen: entry.quality_signal?.last_seen ?? '',
      },
    }];
  }));
}

function normalizeTensionEntries(entries: Record<string, LockfileTensionEntry>): Record<string, LockfileTensionEntry> {
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
    seen_count: entry.seen_count ?? 0,
    directive_id: entry.directive_id ?? '',
    observation_id: entry.observation_id ?? '',
    last_execution_mode: entry.last_execution_mode ?? 'ambient',
    last_seen: entry.last_seen ?? '',
  }]));
}

function updateObservationFeedback(existing: LockfileDocument, observations: Map<string, number>, input: EvaluateInput, now: string): void {
  const observationStates = new Map(input.packet.governance.semantic_merge.observation_states.map((state) => [state.observation_id, state]));
  for (const [observationId, relationCount] of observations) {
    const entry = existing.observations[observationId] ?? createObservationEntry();
    const state = observationStates.get(observationId);
    entry.seen_count += 1;
    entry.relation_count += relationCount;
    if (state?.lifecycle_status === 'active') entry.active_seen_count += 1;
    if (state?.lifecycle_status === 'stale') entry.stale_seen_count += 1;
    if (state?.lifecycle_status === 'superseded') entry.superseded_seen_count += 1;
    entry.last_disposition = state?.disposition ?? 'pending';
    entry.last_lifecycle_status = state?.lifecycle_status ?? 'unknown';
    entry.last_content_fingerprint = state?.content_fingerprint ?? null;
    entry.last_seen = now;
    existing.observations[observationId] = entry;
  }
}

function updateTensionFeedback(existing: LockfileDocument, input: EvaluateInput, now: string): void {
  for (const tension of input.packet.governance.semantic_merge.context_tensions) {
    if (!tension.observation_id) continue;
    const key = `${tension.directive_id}::${tension.observation_id}`;
    const entry = existing.tensions[key] ?? createTensionEntry(tension.directive_id, tension.observation_id, tension.execution_mode);
    entry.seen_count += 1;
    entry.last_execution_mode = tension.execution_mode;
    entry.last_seen = now;
    existing.tensions[key] = entry;
  }
}

function getObservedRccl(input: EvaluateInput): Map<string, number> {
  const counts = new Map<string, number>();
  for (const relation of input.packet.governance.semantic_merge.relations) {
    if (!relation.observation_id) continue;
    counts.set(relation.observation_id, (counts.get(relation.observation_id) ?? 0) + 1);
  }
  for (const link of input.packet.governance.semantic_merge.observation_links) {
    if (!counts.has(link.observation_id)) counts.set(link.observation_id, link.directive_ids.length);
  }
  return counts;
}

function summarizeHostFulfillmentFeedback(input: EvaluateInput): HostFulfillmentFeedbackSummary {
  const hasAdherence = input.adherencePayload?.length;
  const source = hasAdherence
    ? 'adherence-evaluation' as const
    : input.followedDirectiveIds?.length || input.ignoredDirectiveIds?.length
      ? 'explicit-directives' as const
      : 'no-explicit-evaluation' as const;
  const signal = hasAdherence
    ? 'explicit' as const
    : validSignalConfidence(input.signalConfidence)
      ? input.signalConfidence
      : (source === 'explicit-directives' ? 'explicit' : 'implicit');
  const fulfillment = input.hostFulfillment ?? input.packet.governance.trace.host_fulfillment;
  return {
    interpretation_mode: input.packet.interpretation.input_provenance.interpretation_mode,
    completion_signal: signal,
    completion_source: source,
    artifacts: {
      'task-interpretation': summarizeArtifactFeedback(fulfillment?.taskInterpretation),
      'semantic-relation': summarizeArtifactFeedback(fulfillment?.semanticRelation),
      'semantic-candidate': summarizeArtifactFeedback(fulfillment?.semanticCandidate),
      'adherence-evaluation': summarizeArtifactFeedback(fulfillment?.adherenceEvaluation),
    },
  };
}

function summarizeArtifactFeedback(artifact: HostFulfillmentArtifactSummary | undefined): HostFulfillmentFeedbackSummary['artifacts']['task-interpretation'] {
  const summary = artifact?.diagnostics?.summary;
  return {
    provided: artifact?.provided ?? false,
    status: artifact?.status ?? 'absent',
    accepted: summary?.accepted ?? 0,
    rejected: summary?.rejected ?? 0,
    downgraded: summary?.downgraded ?? 0,
    unused: summary?.unused ?? 0,
  };
}

function createObservationEntry(): LockfileObservationEntry {
  return {
    seen_count: 0,
    relation_count: 0,
    active_seen_count: 0,
    stale_seen_count: 0,
    superseded_seen_count: 0,
    last_disposition: 'pending',
    last_lifecycle_status: 'unknown',
    last_content_fingerprint: null,
    last_seen: '',
  };
}

function createTensionEntry(directiveId: string, observationId: string, executionMode: ExecutionMode): LockfileTensionEntry {
  return {
    seen_count: 0,
    directive_id: directiveId,
    observation_id: observationId,
    last_execution_mode: executionMode,
    last_seen: '',
  };
}

function createDocument(): LockfileDocument {
  return {
    version: '1.0',
    directives: {},
    observations: {},
    tensions: {},
    governance_summary: {
      total_tasks: 0,
      by_task_type: {},
      by_task_profile: {},
      last_execution_modes: emptyModeCounts(),
      last_tension_count: 0,
      last_observation_count: 0,
      last_updated_at: '',
    },
  };
}

function createEntry(): LockfileDirectiveEntry {
  return {
    quality_signal: {
      overall: {
        followed: 0,
        ignored: 0,
        partial: 0,
        follow_rate: 0,
        trend: 'stable',
      },
      by_task_type: {},
      by_task_profile: {},
      ignored_reasons: {},
      signal_confidence: 'implicit',
      last_seen: '',
    },
    governance: {
      outcomes: {
        total_tasks: 0,
        with_tensions: 0,
        last_execution_modes: emptyModeCounts(),
        last_tension_count: 0,
        last_updated_at: '',
      },
    },
  };
}

function emptyModeCounts(): Record<ExecutionMode, number> {
  return {
    enforce: 0,
    'deviation-noted': 0,
    ambient: 0,
    suppress: 0,
  };
}

function getTrackedDirectiveIds(input: EvaluateInput): string[] {
  return input.packet.governance.semantic_merge.directive_modes
    .filter((directive) => directive.execution_mode !== 'suppress')
    .map((directive) => directive.directive_id);
}

function summarizeExecutionModes(input: EvaluateInput): Record<ExecutionMode, number> {
  const counts = emptyModeCounts();
  for (const directive of input.packet.governance.semantic_merge.directive_modes) {
    counts[directive.execution_mode] += 1;
  }
  return counts;
}

function computeFollowRate(entry: LockfileDirectiveEntry): number {
  const { followed, ignored, partial } = entry.quality_signal.overall;
  const total = followed + ignored + partial;
  return total === 0 ? 0 : Number(((followed + partial) / total).toFixed(2));
}

function computeTrend(entry: LockfileDirectiveEntry): 'improving' | 'stable' | 'degrading' {
  const rate = entry.quality_signal.overall.follow_rate;
  if (rate >= 0.9) return 'stable';
  if (rate >= 0.75) return 'improving';
  return 'degrading';
}

function taskProfileKey(input: EvaluateInput): string {
  const context = input.packet.interpretation.resolved.context_profile;
  return [
    input.ego.taskIntent.operation,
    context.risk_level ?? 'medium',
    context.scope_size ?? 'unknown',
    context.compatibility_requirement ?? 'none',
  ].join('|');
}

function resolveSignalConfidence(input: EvaluateInput, ignored: boolean): FeedbackSignalConfidence {
  if (validSignalConfidence(input.signalConfidence)) return input.signalConfidence;
  if (ignored) return 'explicit';
  return input.followedDirectiveIds?.length || input.ignoredDirectiveIds?.length ? 'explicit' : 'implicit';
}

function normalizeIgnoredReasons(value: unknown): Partial<Record<IgnoredReason, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Partial<Record<IgnoredReason, number>> = {};
  for (const [reason, count] of Object.entries(value)) {
    if (!validIgnoredReason(reason) || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    result[reason] = count;
  }
  return result;
}

function validIgnoredReason(value: unknown): value is IgnoredReason {
  return value === 'not-applicable'
    || value === 'conflicts-with-task'
    || value === 'too-broad'
    || value === 'repo-reality'
    || value === 'false-positive'
    || value === 'user-corrected'
    || value === 'other';
}

function validSignalConfidence(value: unknown): value is FeedbackSignalConfidence {
  return value === 'implicit'
    || value === 'explicit'
    || value === 'review-confirmed'
    || value === 'user-corrected';
}

interface AdherenceResolution {
  followed: Set<string>;
  ignored: Set<string>;
  partial: Set<string>;
  ignoredReasons: Partial<Record<string, IgnoredReason>>;
}

function resolveFromAdherencePayload(
  input: EvaluateInput,
  trackedDirectiveIds: string[],
): AdherenceResolution | null {
  if (!input.adherencePayload?.length) return null;
  const followed = new Set<string>();
  const ignored = new Set<string>();
  const partial = new Set<string>();
  const ignoredReasons: Partial<Record<string, IgnoredReason>> = {};
  const trackedSet = new Set(trackedDirectiveIds);
  const evaluated = new Set<string>();

  for (const verdict of input.adherencePayload) {
    if (!trackedSet.has(verdict.directive_id)) continue;
    evaluated.add(verdict.directive_id);
    if (verdict.verdict === 'followed') {
      followed.add(verdict.directive_id);
    } else if (verdict.verdict === 'ignored') {
      ignored.add(verdict.directive_id);
      if (verdict.ignored_reason) {
        ignoredReasons[verdict.directive_id] = verdict.ignored_reason;
      }
    } else if (verdict.verdict === 'partial') {
      partial.add(verdict.directive_id);
    }
  }

  for (const id of trackedDirectiveIds) {
    if (!evaluated.has(id)) followed.add(id);
  }

  return { followed, ignored, partial, ignoredReasons };
}
