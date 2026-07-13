import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateAdherenceEvidencePayload } from './ai-contracts/adherence-evidence.ts';
import { buildContractPayloadDiagnostics } from './ai-contracts/diagnostics.ts';
import { unwrapHostArtifactEnvelope } from './ai-contracts/shared.ts';
import { isRecord, validConfidence } from './utils/common.ts';
import { parseYaml, toYaml } from './utils/yaml.ts';
import {
  LOCKFILE_VERSION,
  type EvaluateInput,
  type EvaluateOutput,
  type ExecutionMode,
  type FeedbackSignalConfidence,
  type HostFulfillmentArtifactSummary,
  type HostFulfillmentFeedbackSummary,
  type IgnoredReason,
  type LockfileDirectiveEntry,
  type LockfileDocument,
  type LockfileObservationEntry,
  type PublicEvaluateInput,
  type LockfileTensionEntry,
} from './types.ts';

export function evaluateGuidance(input: PublicEvaluateInput): EvaluateOutput {
  const release = acquireLock(`${input.lockfilePath}.lock`);
  try {
    const trackedDirectiveIds = getTrackedDirectiveIds(input);
    const validation = validatePublicAdherenceArtifact(input, trackedDirectiveIds);
    const lockfile = evaluateGuidanceUnlocked({
      ...input,
      adherencePayload: validation.verdicts,
      followedDirectiveIds: undefined,
      ignoredDirectiveIds: undefined,
      ignoredDirectiveReasons: undefined,
      signalConfidence: undefined,
      hostFulfillment: undefined,
    });
    return {
      status: validation.diagnostics.summary.rejected > 0 ? 'needs-attention' : 'updated',
      lockfile,
      contractDiagnostics: validation.diagnostics,
      verdictCounts: summarizeCurrentVerdicts(validation.verdicts, trackedDirectiveIds),
    };
  } finally {
    release();
  }
}

function summarizeCurrentVerdicts(
  verdicts: import('./ai-contracts/types.ts').ValidatedAdherenceEvidenceVerdict[],
  trackedDirectiveIds: string[],
): EvaluateOutput['verdictCounts'] {
  const counts = { followed: 0, partial: 0, ignored: 0, unverified: 0 };
  const covered = new Set<string>();
  for (const verdict of verdicts) {
    if (covered.has(verdict.directive_id)) continue;
    covered.add(verdict.directive_id);
    counts[verdict.verdict] += 1;
  }
  counts.unverified += trackedDirectiveIds.filter((id) => !covered.has(id)).length;
  return counts;
}

function evaluateGuidanceUnlocked(input: EvaluateInput): LockfileDocument {
  const existing = loadLockfile(input.lockfilePath);
  const trackedDirectiveIds = getTrackedDirectiveIds(input);
  const adherenceResolved = resolveFromAdherencePayload(input, trackedDirectiveIds);
  const followed = adherenceResolved?.followed ?? new Set<string>();
  const ignored = adherenceResolved?.ignored ?? new Set<string>();
  const partial = adherenceResolved?.partial ?? new Set<string>();
  const unverified = adherenceResolved?.unverified ?? new Set(trackedDirectiveIds);
  const ignoredReasons = adherenceResolved?.ignoredReasons;
  const taskType = input.ego.taskIntent.change_type;
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

  for (const directiveId of trackedDirectiveIds) {
    const entry = existing.directives[directiveId] ?? createEntry();
    const counts = entry.quality_signal.by_task_type[taskType] ?? emptySignalCounts();
    const profileCounts = entry.quality_signal.by_task_profile[taskProfile] ?? emptySignalCounts();
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
    } else if (unverified.has(directiveId)) {
      entry.quality_signal.overall.unverified += 1;
      counts.unverified += 1;
      profileCounts.unverified += 1;
    }
    entry.quality_signal.by_task_type[taskType] = counts;
    entry.quality_signal.by_task_profile[taskProfile] = profileCounts;
    const coveredVerdict: 'ignored' | 'partial' | 'followed' | null = ignored.has(directiveId) ? 'ignored' : partial.has(directiveId) ? 'partial' : followed.has(directiveId) ? 'followed' : null;
    if (coveredVerdict) entry.quality_signal.overall.recent_verdicts = [...entry.quality_signal.overall.recent_verdicts, coveredVerdict].slice(-20);
    entry.quality_signal.overall.follow_rate = computeFollowRate(entry);
    entry.quality_signal.overall.coverage_rate = computeCoverageRate(entry);
    entry.quality_signal.overall.trend = computeTrend(entry);
    entry.quality_signal.signal_confidence = adherenceResolved
      ? 'explicit'
      : resolveSignalConfidence(input, ignored.has(directiveId));
    entry.quality_signal.evidence_confidence = adherenceResolved?.evidenceConfidence.get(directiveId);
    entry.quality_signal.last_evaluation_source = adherenceResolved ? 'adherence-evidence' : undefined;
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

  atomicWrite(input.lockfilePath, toYaml(existing));
  return existing;
}

function validatePublicAdherenceArtifact(
  input: PublicEvaluateInput,
  trackedDirectiveIds: string[],
): import('./ai-contracts/types.ts').AdherenceEvidenceValidationResult {
  const artifact = input.artifacts?.adherenceEvidence;
  if (!artifact) return {
    verdicts: [],
    diagnostics: buildContractPayloadDiagnostics('adherence-evidence', [{
      status: 'unused', reason: 'empty-payload', path: 'artifact', message: 'No adherence artifact was provided; tracked directives are recorded as unverified.',
    }]),
  };
  const request = input.packet.post_compile_contract_requests.find((item) => item.kind === 'adherence-evidence');
  if (!request) return {
    verdicts: [],
    diagnostics: buildContractPayloadDiagnostics('adherence-evidence', [{
      status: 'rejected',
      reason: 'malformed-payload',
      path: 'packet.post_compile_contract_requests',
      message: 'The compiled packet does not contain the Runtime-issued adherence-evidence contract.',
    }], { id: 'missing-adherence-contract', path: artifact.path }),
  };
  const unwrapped = unwrapHostArtifactEnvelope(artifact.raw, request.contract);
  if (unwrapped.diagnostic) return {
    verdicts: [],
    diagnostics: buildContractPayloadDiagnostics('adherence-evidence', [unwrapped.diagnostic], { id: request.contract.requestId, path: artifact.path }),
  };
  const issuedDirectiveIds = request.contract.allowedIds?.directiveIds ?? [];
  const trackedSet = new Set(trackedDirectiveIds);
  return validateAdherenceEvidencePayload(
    unwrapped.payload,
    issuedDirectiveIds.filter((id) => trackedSet.has(id)),
    input.evidenceContext,
  );
}

function loadLockfile(filePath: string): LockfileDocument {
  if (!existsSync(filePath)) return createDocument();
  const parsed = parseYaml(readFileSync(filePath, 'utf-8')) as unknown;
  if (isRecord(parsed) && 'version' in parsed && parsed.version !== LOCKFILE_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: lockfile ${filePath} must use ${LOCKFILE_VERSION}; found ${String(parsed.version)}. Re-run init. Existing data was not modified.`);
  }
  if (!isLockfileDocument(parsed)) throw new Error(`INVALID_LOCKFILE: ${filePath} is malformed and was not modified.`);
  return {
    version: LOCKFILE_VERSION,
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
  return value === LOCKFILE_VERSION || value === 1;
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
          unverified: (entry.quality_signal?.overall as { unverified?: number })?.unverified ?? 0,
          coverage_rate: (entry.quality_signal?.overall as { coverage_rate?: number })?.coverage_rate ?? 0,
          recent_verdicts: normalizeRecentVerdicts((entry.quality_signal?.overall as { recent_verdicts?: unknown })?.recent_verdicts),
        },
        by_task_type: normalizeSignalCountMap(entry.quality_signal?.by_task_type),
        by_task_profile: normalizeSignalCountMap(entry.quality_signal?.by_task_profile),
        ignored_reasons: normalizeIgnoredReasons(entry.quality_signal?.ignored_reasons),
        ...(validIgnoredReason(entry.quality_signal?.last_ignored_reason)
          ? { last_ignored_reason: entry.quality_signal.last_ignored_reason }
          : {}),
        signal_confidence: validSignalConfidence(entry.quality_signal?.signal_confidence)
          ? entry.quality_signal.signal_confidence
          : 'implicit',
        evidence_confidence: validConfidence(entry.quality_signal?.evidence_confidence)
          ? entry.quality_signal.evidence_confidence
          : undefined,
        last_evaluation_source: validEvaluationSource(entry.quality_signal?.last_evaluation_source)
          ? entry.quality_signal.last_evaluation_source
          : undefined,
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
    ? 'adherence-evidence' as const
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
      'agent-capability-profile': summarizeArtifactFeedback(fulfillment?.agentCapability),
      'task-model': summarizeArtifactFeedback(fulfillment?.taskModel),
      'semantic-governance-graph': summarizeArtifactFeedback(fulfillment?.semanticGovernanceGraph),
      'adherence-evidence': summarizeArtifactFeedback(fulfillment?.adherenceEvidence),
    },
  };
}

function summarizeArtifactFeedback(artifact: HostFulfillmentArtifactSummary | undefined): HostFulfillmentFeedbackSummary['artifacts']['task-model'] {
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
    version: LOCKFILE_VERSION,
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
        unverified: 0,
        follow_rate: 0,
        coverage_rate: 0,
        trend: 'stable',
        recent_verdicts: [],
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
  return total === 0 ? 0 : Number((followed / total).toFixed(2));
}

function computeCoverageRate(entry: LockfileDirectiveEntry): number {
  const { followed, ignored, partial, unverified } = entry.quality_signal.overall;
  const covered = followed + ignored + partial;
  const total = covered + unverified;
  return total === 0 ? 0 : Number((covered / total).toFixed(2));
}

function emptySignalCounts(): { followed: number; ignored: number; partial: number; unverified: number } {
  return { followed: 0, ignored: 0, partial: 0, unverified: 0 };
}

function normalizeSignalCountMap(
  value: unknown,
): Record<string, { followed: number; ignored: number; partial: number; unverified: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, counts]) => {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return [key, emptySignalCounts()];
    const item = counts as Partial<ReturnType<typeof emptySignalCounts>>;
    return [key, {
      followed: validCount(item.followed) ? item.followed : 0,
      ignored: validCount(item.ignored) ? item.ignored : 0,
      partial: validCount(item.partial) ? item.partial : 0,
      unverified: validCount(item.unverified) ? item.unverified : 0,
    }];
  }));
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validEvaluationSource(value: unknown): value is HostFulfillmentFeedbackSummary['completion_source'] {
  return value === 'no-explicit-evaluation'
    || value === 'explicit-directives'
    || value === 'adherence-evidence';
}

function computeTrend(entry: LockfileDirectiveEntry): 'improving' | 'stable' | 'declining' {
  const verdicts = entry.quality_signal.overall.recent_verdicts;
  if (verdicts.length < 10) return 'stable';
  const recent = strictWindowRate(verdicts.slice(-5));
  const previous = strictWindowRate(verdicts.slice(-10, -5));
  const difference = recent - previous;
  if (difference >= 0.1) return 'improving';
  if (difference <= -0.1) return 'declining';
  return 'stable';
}

function strictWindowRate(verdicts: Array<'followed' | 'partial' | 'ignored'>): number {
  return verdicts.filter((verdict) => verdict === 'followed').length / verdicts.length;
}

function normalizeRecentVerdicts(value: unknown): Array<'followed' | 'partial' | 'ignored'> {
  return Array.isArray(value)
    ? value.filter((item): item is 'followed' | 'partial' | 'ignored' => item === 'followed' || item === 'partial' || item === 'ignored').slice(-20)
    : [];
}

function acquireLock(lockPath: string, timeoutMs = 5_000): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      fsyncSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`LOCKFILE_LOCK_TIMEOUT: could not acquire ${lockPath} within ${timeoutMs}ms.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return () => {
    if (fd !== null) closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* lock cleanup is best effort after the update completed */ }
  };
}

function atomicWrite(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tempPath, 'wx');
  try {
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
  try {
    const directoryFd = openSync(dirname(filePath), 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  } catch { /* Windows may not allow directory fsync; atomic rename has already completed. */ }
}

function taskProfileKey(input: EvaluateInput): string {
  const context = input.packet.interpretation.resolved.context_profile;
  return [
    input.ego.taskIntent.change_type,
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

export function normalizeIgnoredReasons(value: unknown): Partial<Record<IgnoredReason, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Partial<Record<IgnoredReason, number>> = {};
  for (const [reason, count] of Object.entries(value)) {
    if (!validIgnoredReason(reason) || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    result[reason] = count;
  }
  return result;
}

export function validIgnoredReason(value: unknown): value is IgnoredReason {
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
  unverified: Set<string>;
  ignoredReasons: Partial<Record<string, IgnoredReason>>;
  evidenceConfidence: Map<string, number>;
}

function resolveFromAdherencePayload(
  input: EvaluateInput,
  trackedDirectiveIds: string[],
): AdherenceResolution | null {
  if (!input.adherencePayload?.length) return null;
  const followed = new Set<string>();
  const ignored = new Set<string>();
  const partial = new Set<string>();
  const unverified = new Set<string>();
  const ignoredReasons: Partial<Record<string, IgnoredReason>> = {};
  const evidenceConfidence = new Map<string, number>();
  const trackedSet = new Set(trackedDirectiveIds);
  const evaluated = new Set<string>();

  for (const verdict of input.adherencePayload) {
    if (!trackedSet.has(verdict.directive_id)) continue;
    evaluated.add(verdict.directive_id);
    evidenceConfidence.set(verdict.directive_id, verdict.confidence);
    if (verdict.verdict === 'followed') {
      followed.add(verdict.directive_id);
    } else if (verdict.verdict === 'ignored') {
      ignored.add(verdict.directive_id);
      if (verdict.ignored_reason) {
        ignoredReasons[verdict.directive_id] = verdict.ignored_reason;
      }
    } else if (verdict.verdict === 'partial') {
      partial.add(verdict.directive_id);
    } else if (verdict.verdict === 'unverified') {
      unverified.add(verdict.directive_id);
    }
  }

  for (const id of trackedDirectiveIds) {
    if (!evaluated.has(id)) unverified.add(id);
  }

  return { followed, ignored, partial, unverified, ignoredReasons, evidenceConfidence };
}
