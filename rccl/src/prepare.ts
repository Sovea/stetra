import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { buildRepoIndex } from './indexing/build-repo-index.ts';
import { parseRccl } from './io/parse-rccl.ts';
import { buildRepresentation } from './represent/build-representation.ts';
import { planSlices } from './slicing/plan-slices.ts';
import { extractWindowsForFiles } from './slicing/extract-windows.ts';
import { RCCL_CANDIDATE_SCHEMA, buildSlicePrompt } from './prompt/build-slice-prompt.ts';
import { buildDiscoveryPrompt } from './prompt/build-discovery-prompt.ts';
import { buildCritiquePrompt } from './prompt/build-critique-prompt.ts';
import { buildSynthesisPrompt } from './prompt/build-synthesis-prompt.ts';
import type {
  CalibrationSlice,
  IndexedFile,
  RcclAIContractArtifact,
  RcclAIContractEnvelope,
  PrepareIncrementalRcclOptions,
  PrepareIncrementalRcclResult,
  PrepareRcclResult,
  PrepareRcclWorkflowStageResult,
  RcclCalibrationStats,
  RcclDocument,
  RcclRefreshExistingObservationSummary,
  RcclWorkflowCritiqueDocument,
  RcclWorkflowDiscoveryDocument,
  RcclWorkflowStageName,
  RepoRepresentation,
} from './types.ts';

const FALSEY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);

interface PreparationContext {
  projectRoot: string;
  scope: string;
  indexedFiles: IndexedFile[];
  representation: RepoRepresentation;
  slices: CalibrationSlice[];
  contextMeta: { raw: string } | null;
  stats: RcclCalibrationStats;
}

export const RCCL_REFRESH_SCHEMA = `
version: "1.0"
generated_at: <auto-filled-or-null>
scope: "<scope>"

keep:
  - "obs-active-existing-id"

revise:
  - provisional_id: "obs-active-existing-id"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    evidence_refs:
      - kind: "file"
        ref: "<relative-path>:<start>-<end>"
        file: "<relative-path>"
        line_range: [<start>, <end>]
    counterexamples: []
    source_slice_ids: ["<slice-id>"]
    support_hint:
      file_count: <number-or-null>
      cluster_count: <number-or-null>
      scope_basis: <single-file|directory-cluster|module-cluster|cross-root|null>
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>

retire:
  - observation_id: "obs-active-existing-id"
    reason_id: <file-missing|snippet-drift|scope-drift|superseded|no-longer-material|other>
    confidence: <0.0-1.0>
    evidence_refs: []

new_observations:
  - provisional_id: "obs-<kebab-case-name>"
    semantic_key: "<stable-kebab-case-semantic-identity>"
    category: <category>
    scope_hint: "<glob>"
    pattern: "<human-readable-description>"
    confidence: <0.0-1.0>
    adherence_quality: <good|inconsistent|poor>
    evidence:
      - file: "<relative-path>"
        line_range: [<start>, <end>]
        snippet: "<code>"
    evidence_refs:
      - kind: "file"
        ref: "<relative-path>:<start>-<end>"
        file: "<relative-path>"
        line_range: [<start>, <end>]
    counterexamples: []
    source_slice_ids: ["<slice-id>"]
    traits:
      legacy: <true|false>
      migration_boundary: <true|false>
      anti_pattern: <true|false>
      compatibility_boundary: <true|false>

semantic_equivalence:
  - observation_ids: ["obs-a", "obs-b"]
    confidence: <0.0-1.0>
    evidence_refs: []
    reason: "<why these should consolidate>"

counterexamples:
  - observation_id: "obs-active-existing-id"
    confidence: <0.0-1.0>
    evidence_refs: []
    reason: "<why this contradicts or narrows the observation>"
`.trim();

export function prepareRccl(projectRootInput: string, options: { scope?: string; debugArtifacts?: boolean } = {}): PrepareRcclResult {
  const context = buildPreparationContext(projectRootInput, options.scope);
  const prompt = buildSlicePrompt({
    scope: context.scope,
    slices: context.slices,
    contextMeta: context.contextMeta,
    stats: context.stats,
  });

  const candidateArtifact = buildObservationGenerationArtifact(context.projectRoot, context.scope);
  const contract = buildObservationGenerationContract(context, prompt, candidateArtifact);
  const debugArtifacts = buildDebugArtifacts(context, prompt, 'calibration-prompts', options.debugArtifacts);

  return {
    prompt,
    contract,
    candidateArtifact,
    metadata: {
      scope: context.scope,
      stats: context.stats,
    },
    debugArtifacts,
  };
}

export function prepareRcclWorkflowStage(projectRootInput: string, options: {
  stage: RcclWorkflowStageName;
  scope?: string;
  discovery?: RcclWorkflowDiscoveryDocument;
  critique?: RcclWorkflowCritiqueDocument;
  debugArtifacts?: boolean;
}): PrepareRcclWorkflowStageResult {
  const context = buildPreparationContext(projectRootInput, options.scope);
  const prompt = buildWorkflowPrompt(context, options);
  const debugArtifacts = buildDebugArtifacts(context, prompt, 'rccl-workflow-prompts', options.debugArtifacts, { stage: options.stage });

  return {
    stage: options.stage,
    prompt,
    suggestedArtifactPath: suggestedWorkflowArtifactPath(context.projectRoot, options.stage, context.scope),
    metadata: {
      scope: context.scope,
      stats: context.stats,
    },
    debugArtifacts,
  };
}

export function prepareIncrementalRccl(
  projectRootInput: string,
  options: PrepareIncrementalRcclOptions = {},
): PrepareIncrementalRcclResult {
  const context = buildPreparationContext(projectRootInput, options.scope);
  const requestedMode = options.mode ?? (options.changedFiles?.length ? 'changed-files' : 'task-scoped');
  const focusFiles = normalizeFocusFiles(context.projectRoot, [...(options.targetFiles ?? []), ...(options.changedFiles ?? [])]);
  const limits = resolveIncrementalLimits(requestedMode, options);
  const candidateSlices = selectFocusedSlices(context.slices, focusFiles);
  const focusedFileSlices = candidateSlices.length > 0
    ? candidateSlices
    : buildFocusedFileSlices(context.projectRoot, context.indexedFiles, focusFiles, limits.fileLimit);
  const selectedSlices = limitCalibrationSlices(focusedFileSlices, limits);
  const stats = statsFor(context.indexedFiles.length, selectedSlices);
  const existingRccl = loadExistingRccl(context.projectRoot);
  const affectedObservations = existingRccl
    ? findAffectedObservations(existingRccl, focusFiles, requestedMode)
    : [];
  const staleObservations = existingRccl ? findStaleObservations(existingRccl, context.projectRoot) : [];
  const cacheArtifacts = writeIncrementalCacheArtifacts(context.projectRoot, {
    scope: context.scope,
    requestedMode,
    focusFiles,
    indexedFiles: context.indexedFiles,
    slices: selectedSlices,
    affectedObservations,
    staleObservations,
  });
  const prompt = buildRefreshPrompt({
    scope: context.scope,
    requestedMode,
    focusFiles,
    slices: selectedSlices,
    contextMeta: context.contextMeta,
    stats,
    observations: summarizeExistingObservations(existingRccl, affectedObservations),
    staleObservations,
  });
  const refreshArtifact = buildObservationRefreshArtifact(context.projectRoot, context.scope, requestedMode, focusFiles);
  const contract = buildObservationRefreshContract({
    context,
    slices: selectedSlices,
    prompt,
    artifact: refreshArtifact,
    focusFiles,
    affectedObservations,
    staleObservations,
    existingRccl,
  });
  const debugArtifacts = buildDebugArtifacts(
    { ...context, slices: selectedSlices, stats },
    prompt,
    'rccl-refresh-prompts',
    options.debugArtifacts,
    { mode: requestedMode, focusFiles },
  );

  return {
    mode: selectedSlices.length > 0 ? 'contracts-required' : existingRccl ? 'verify-only' : 'full-refresh-recommended',
    contract: selectedSlices.length > 0 ? contract : undefined,
    refreshArtifact: selectedSlices.length > 0 ? refreshArtifact : undefined,
    metadata: {
      scope: context.scope,
      requested_mode: requestedMode,
      focus_files: focusFiles,
      stats,
      existing_observation_count: existingRccl?.observations.length ?? 0,
      limits: {
        file_limit: Number.isFinite(limits.fileLimit) ? limits.fileLimit : null,
        window_limit: Number.isFinite(limits.windowLimit) ? limits.windowLimit : null,
        applied: limits.applied,
      },
    },
    affectedObservations,
    staleObservations,
    cacheArtifacts,
    debugArtifacts,
  };
}

function buildPreparationContext(projectRootInput: string, scopeInput?: string): PreparationContext {
  const projectRoot = resolve(projectRootInput);
  const scope = scopeInput || 'auto';
  const indexedFiles = buildRepoIndex(projectRoot, scope);
  const representation = buildRepresentation(indexedFiles);
  const slices = planSlices(projectRoot, indexedFiles, representation);
  const windows = slices.flatMap((slice) => slice.windows);
  const contextMeta = loadContextMeta(projectRoot);
  const stats = {
    total_files: indexedFiles.length,
    indexed_files: indexedFiles.length,
    selected_slices: slices.length,
    windows: windows.length,
  };
  return { projectRoot, scope, indexedFiles, representation, slices, contextMeta, stats };
}

function buildWorkflowPrompt(context: PreparationContext, options: {
  stage: RcclWorkflowStageName;
  discovery?: RcclWorkflowDiscoveryDocument;
  critique?: RcclWorkflowCritiqueDocument;
}): string {
  if (options.stage === 'discover') {
    return buildDiscoveryPrompt({
      scope: context.scope,
      slices: context.slices,
      contextMeta: context.contextMeta,
      stats: context.stats,
    });
  }

  if (options.stage === 'critique') {
    if (!options.discovery) throw new Error('prepare-stage critique requires a parsed discovery artifact');
    return buildCritiquePrompt({
      scope: context.scope,
      discovery: options.discovery,
      slices: context.slices,
      contextMeta: context.contextMeta,
      stats: context.stats,
    });
  }

  if (!options.discovery) throw new Error('prepare-stage synthesize requires a parsed discovery artifact');
  if (!options.critique) throw new Error('prepare-stage synthesize requires a parsed critique artifact');
  return buildSynthesisPrompt({
    scope: context.scope,
    discovery: options.discovery,
    critique: options.critique,
    slices: context.slices,
    contextMeta: context.contextMeta,
    stats: context.stats,
  });
}

function buildDebugArtifacts(
  context: PreparationContext,
  prompt: string,
  promptFolder: string,
  debugArtifacts?: boolean,
  seed: Record<string, unknown> = {},
): PrepareRcclResult['debugArtifacts'] {
  const debugArtifactsEnabled = shouldEmitDebugArtifacts(debugArtifacts);
  return debugArtifactsEnabled
    ? {
      enabled: true,
      promptPath: writeArtifact(context.projectRoot, promptFolder, 'md', prompt, { scope: context.scope, promptLength: prompt.length, ...seed }),
      slicePlanPath: writeArtifact(context.projectRoot, 'rccl-slice-plans', 'json', JSON.stringify({ scope: context.scope, representation: context.representation, slices: context.slices }, null, 2), { scope: context.scope, slices: context.slices.length, ...seed }),
      reportPath: writeArtifact(context.projectRoot, 'rccl-reports', 'json', JSON.stringify({
        scope: context.scope,
        stage: seed.stage,
        stats: context.stats,
        roots: context.representation.roots,
        modules: context.representation.modules.slice(0, 5),
        boundaries: context.representation.boundaries,
        migrations: context.representation.migrations,
        style_clusters: context.representation.style_clusters,
      }, null, 2), { scope: context.scope, report: 'summary', ...seed }),
    }
    : { enabled: false };
}

function buildObservationGenerationArtifact(projectRoot: string, scope: string): RcclAIContractArtifact {
  return {
    suggestedPath: suggestedObservationCandidatePath(projectRoot, scope),
    format: 'yaml' as const,
    usage: 'Write candidate RCCL observations to this YAML path, then pass it to calibrate-repo-context commit with --input.',
  };
}

function buildObservationGenerationContract(
  context: PreparationContext,
  prompt: string,
  artifact: ReturnType<typeof buildObservationGenerationArtifact>,
): RcclAIContractEnvelope {
  return {
    contractVersion: 'ai-contract/v2' as const,
    kind: 'rccl-observation-generation' as const,
    schemaId: 'rccl.observation-generation-candidate',
    schemaVersion: '2.0' as const,
    prompt,
    schema: RCCL_CANDIDATE_SCHEMA,
    artifact,
    provenance: {
      owner: 'rccl' as const,
      deterministic: true as const,
    },
    cacheKeyMaterial: {
      scope: context.scope,
      stats: context.stats,
      slices: context.slices.map((slice) => ({
        id: slice.id,
        files: slice.files,
        windows: slice.windows.map((window) => ({
          file: window.file,
          start_line: window.start_line,
          end_line: window.end_line,
          purpose: window.purpose,
        })),
      })),
    },
  };
}

function buildObservationRefreshArtifact(projectRoot: string, scope: string, mode: string, focusFiles: string[]): RcclAIContractArtifact {
  return {
    suggestedPath: suggestedObservationRefreshPath(projectRoot, scope, mode, focusFiles),
    format: 'yaml' as const,
    usage: 'Write the RCCL observation refresh proposal to this YAML path, then pass it to calibrate-repo-context commit-refresh with --input.',
  };
}

function buildObservationRefreshContract(input: {
  context: PreparationContext;
  slices: CalibrationSlice[];
  prompt: string;
  artifact: ReturnType<typeof buildObservationRefreshArtifact>;
  focusFiles: string[];
  affectedObservations: string[];
  staleObservations: string[];
  existingRccl: RcclDocument | null;
}): RcclAIContractEnvelope {
  return {
    contractVersion: 'ai-contract/v2' as const,
    kind: 'rccl-observation-refresh' as const,
    schemaId: 'rccl.observation-refresh',
    schemaVersion: '2.0' as const,
    prompt: input.prompt,
    schema: RCCL_REFRESH_SCHEMA,
    artifact: input.artifact,
    provenance: {
      owner: 'rccl' as const,
      deterministic: true as const,
    },
    cacheKeyMaterial: {
      scope: input.context.scope,
      focusFiles: input.focusFiles,
      affectedObservations: input.affectedObservations,
      staleObservations: input.staleObservations,
      existingObservationFingerprints: (input.existingRccl?.observations ?? []).map((observation) => ({
        id: observation.id,
        fingerprint: observation.lifecycle?.content_fingerprint ?? null,
        verification: observation.verification.disposition,
      })),
      slices: input.slices.map((slice) => ({
        id: slice.id,
        files: slice.files,
        windows: slice.windows.map((window) => ({
          file: window.file,
          start_line: window.start_line,
          end_line: window.end_line,
          purpose: window.purpose,
        })),
      })),
    },
  };
}

function suggestedObservationCandidatePath(projectRoot: string, scope: string): string {
  const digest = createHash('sha1').update(JSON.stringify({ kind: 'rccl-observation-generation', scope })).digest('hex').slice(0, 10);
  return join(projectRoot, '.resonant-code', 'context', 'rccl-candidates', `${digest}.yaml`);
}

function suggestedObservationRefreshPath(projectRoot: string, scope: string, mode: string, focusFiles: string[]): string {
  const digest = createHash('sha1').update(JSON.stringify({ kind: 'rccl-observation-refresh', scope, mode, focusFiles })).digest('hex').slice(0, 10);
  return join(projectRoot, '.resonant-code', 'context', 'rccl-refresh', `${digest}.yaml`);
}

function suggestedWorkflowArtifactPath(projectRoot: string, stage: RcclWorkflowStageName, scope: string): string {
  const digest = createHash('sha1').update(JSON.stringify({ stage, scope })).digest('hex').slice(0, 10);
  return join(projectRoot, '.resonant-code', 'context', 'rccl-workflow', `${stage}-${digest}.yaml`);
}

function shouldEmitDebugArtifacts(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const value = process.env.RESONANT_CODE_DEBUG_ARTIFACTS;
  if (!value) return false;
  return !FALSEY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function writeArtifact(projectRoot: string, folder: string, extension: string, content: string, seed: Record<string, unknown>): string {
  const digest = createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const path = join(projectRoot, '.resonant-code', 'context', folder, `${stamp}-${digest}.${extension}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
  return path;
}

function writeIncrementalCacheArtifacts(projectRoot: string, value: {
  scope: string;
  requestedMode: string;
  focusFiles: string[];
  indexedFiles: IndexedFile[];
  slices: CalibrationSlice[];
  affectedObservations: string[];
  staleObservations: string[];
}): PrepareIncrementalRcclResult['cacheArtifacts'] {
  const indexKey = createHash('sha1').update(JSON.stringify({
    scope: value.scope,
    files: value.indexedFiles.map((file) => [file.path, file.lines, file.imports_count, file.exports_count, file.role_hints]),
  })).digest('hex').slice(0, 16);
  const sliceKey = createHash('sha1').update(JSON.stringify({
    scope: value.scope,
    requestedMode: value.requestedMode,
    focusFiles: value.focusFiles,
    slices: value.slices.map((slice) => [slice.id, slice.files, slice.windows.map((window) => [window.file, window.start_line, window.end_line])]),
  })).digest('hex').slice(0, 16);
  return {
    repoIndexPath: writeCacheArtifact(projectRoot, 'repo-index', indexKey, {
      version: '1.0',
      kind: 'rccl-repo-index',
      scope: value.scope,
      indexedFiles: value.indexedFiles,
    }),
    slicePlanPath: writeCacheArtifact(projectRoot, 'slice-plan', sliceKey, {
      version: '1.0',
      kind: 'rccl-slice-plan',
      scope: value.scope,
      requestedMode: value.requestedMode,
      focusFiles: value.focusFiles,
      affectedObservations: value.affectedObservations,
      staleObservations: value.staleObservations,
      slices: value.slices,
    }),
  };
}

function writeCacheArtifact(projectRoot: string, folder: string, key: string, value: unknown): string {
  const path = join(projectRoot, '.resonant-code', 'context', 'cache', 'rccl', folder, `${key}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  return path;
}

function resolveIncrementalLimits(
  requestedMode: PrepareIncrementalRcclOptions['mode'],
  options: PrepareIncrementalRcclOptions,
): { fileLimit: number; windowLimit: number; applied: boolean } {
  const defaultLimited = requestedMode !== 'full';
  const fileLimit = positiveInteger(options.fileLimit) ?? (defaultLimited ? 4 : Number.POSITIVE_INFINITY);
  const windowLimit = positiveInteger(options.windowLimit) ?? (defaultLimited ? 24 : Number.POSITIVE_INFINITY);
  return {
    fileLimit,
    windowLimit,
    applied: Number.isFinite(fileLimit) || Number.isFinite(windowLimit),
  };
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) throw new Error('RCCL incremental limits must be positive integers.');
  return value;
}

function buildRefreshPrompt(input: {
  scope: string;
  requestedMode: string;
  focusFiles: string[];
  slices: CalibrationSlice[];
  contextMeta?: { raw: string } | null;
  stats: RcclCalibrationStats;
  observations: RcclRefreshExistingObservationSummary[];
  staleObservations: string[];
}): string {
  const lines: string[] = [];
  lines.push('# Incremental RCCL Observation Refresh');
  lines.push('');
  lines.push('Produce a bounded RCCL observation refresh proposal for the provided repository slices.');
  lines.push('Your output is assistive only. RCCL will validate ids, schema, evidence, snippets, scope support, and final write policy.');
  lines.push('Do not summarize the repository. Do not create authoritative final observation ids, verification, or lifecycle fields.');
  lines.push('');
  lines.push('## Output schema');
  lines.push('```yaml');
  lines.push(RCCL_REFRESH_SCHEMA);
  lines.push('```');
  lines.push('');
  lines.push('## Hard rules');
  lines.push('1. Keep existing observations only when the provided slices and existing summary still support them.');
  lines.push('2. Revise uses provisional_id equal to an existing active observation id; v2 still keeps final merge, rename, and lifecycle authority inside RCCL.');
  lines.push('3. Revise or create observations only with exact evidence copied from the provided windows plus matching evidence_refs.');
  lines.push('4. Retire means the observation should become stale unless RCCL verification proves a stronger disposition.');
  lines.push('5. Use only listed existing active observation ids in keep, revise, or retire.');
  lines.push('6. Omitted active observations are carried forward unchanged; omission is non-destructive.');
  lines.push('7. Use the exact action schemas; do not emit shorthand retire entries or malformed action items.');
  lines.push('8. Include counterexamples and semantic_equivalence proposals when they would narrow scope, merge duplicates, or demote noisy observations.');
  lines.push('9. Set traits only when the provided evidence directly supports them; RCCL/Runtime do not infer compatibility, migration, legacy, or anti-pattern semantics from prose.');
  lines.push('10. Prefer fewer, stronger refresh proposals over broad summaries.');
  lines.push('');
  lines.push(`Scope: ${input.scope}`);
  lines.push(`Requested mode: ${input.requestedMode}`);
  lines.push(`Focus files: ${input.focusFiles.join(', ') || '(none)'}`);
  lines.push(`Indexed files: ${input.stats.indexed_files}/${input.stats.total_files} | Selected slices: ${input.stats.selected_slices} | Windows: ${input.stats.windows}`);
  lines.push(`Static stale observation candidates: ${input.staleObservations.join(', ') || '(none)'}`);
  lines.push('');
  if (input.contextMeta?.raw) {
    lines.push('## Repository context');
    lines.push('```yaml');
    lines.push(input.contextMeta.raw);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Existing observation summaries');
  if (input.observations.length === 0) {
    lines.push('- (none in selected scope)');
  } else {
    for (const observation of input.observations) {
      lines.push(`- ${observation.id} (${observation.category}, ${observation.scope})`);
      lines.push(`  semantic_key: ${observation.semantic_key}`);
      lines.push(`  pattern: ${observation.pattern}`);
      lines.push(`  confidence: ${observation.confidence}`);
      lines.push(`  adherence_quality: ${observation.adherence_quality}`);
      lines.push(`  evidence_refs: ${observation.evidence_refs.join(', ') || '(none)'}`);
      if (observation.traits) lines.push(`  traits: ${formatTraits(observation.traits)}`);
      lines.push(`  lifecycle: ${observation.lifecycle?.status ?? 'unknown'}`);
      lines.push(`  disposition: ${observation.verification.disposition ?? 'pending'}`);
    }
  }
  lines.push('');
  lines.push('## Refresh slices');
  for (const slice of input.slices) {
    lines.push(`### ${slice.id} (${slice.kind})`);
    lines.push(`Rationale: ${slice.rationale}`);
    lines.push(`Files: ${slice.files.join(', ')}`);
    for (const window of slice.windows) {
      lines.push(`#### ${window.file}:${window.start_line}-${window.end_line} [${window.purpose}]`);
      lines.push('```');
      lines.push(window.snippet);
      lines.push('```');
    }
  }
  return lines.join('\n');
}

function statsFor(totalFiles: number, slices: CalibrationSlice[]): RcclCalibrationStats {
  return {
    total_files: totalFiles,
    indexed_files: totalFiles,
    selected_slices: slices.length,
    windows: slices.flatMap((slice) => slice.windows).length,
  };
}

function normalizeFocusFiles(projectRoot: string, files: string[]): string[] {
  return [...new Set(files.map((file) => normalizeFocusFile(projectRoot, file)).filter(Boolean))].sort();
}

function normalizeFocusFile(projectRoot: string, file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return '';
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(projectRoot, trimmed);
  const rel = relative(projectRoot, absolute).replace(/\\/g, '/');
  if (!rel || rel === '.') return '';
  if (rel.startsWith('../') || rel === '..' || isAbsolute(rel)) {
    return trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  }
  return rel.replace(/^\.\//, '');
}

function selectFocusedSlices(slices: CalibrationSlice[], focusFiles: string[]): CalibrationSlice[] {
  if (focusFiles.length === 0) return slices;
  const focusSet = new Set(focusFiles);
  return slices.filter((slice) =>
    slice.files.some((file) => focusSet.has(file))
    || slice.windows.some((window) => focusSet.has(window.file)));
}

function buildFocusedFileSlices(
  projectRoot: string,
  indexedFiles: IndexedFile[],
  focusFiles: string[],
  fileLimit: number,
): CalibrationSlice[] {
  if (focusFiles.length === 0) return [];
  const indexedByPath = new Map(indexedFiles.map((file) => [file.path, file]));
  const files = focusFiles
    .map((file) => indexedByPath.get(file))
    .filter((file): file is IndexedFile => Boolean(file))
    .slice(0, Number.isFinite(fileLimit) ? fileLimit : undefined);
  if (files.length === 0) return [];
  return [{
    id: 'focus:changed-files',
    kind: 'module',
    files: files.map((file) => file.path),
    rationale: 'Direct task focus files selected for incremental RCCL refresh',
    coverage_weight: 1,
    windows: extractWindowsForFiles(projectRoot, files),
  }];
}

function limitCalibrationSlices(
  slices: CalibrationSlice[],
  limits: { fileLimit: number; windowLimit: number },
): CalibrationSlice[] {
  if (!Number.isFinite(limits.fileLimit) && !Number.isFinite(limits.windowLimit)) return slices;
  const selectedFiles = new Set<string>();
  let windowCount = 0;
  const result: CalibrationSlice[] = [];

  for (const slice of slices) {
    if (Number.isFinite(limits.windowLimit) && windowCount >= limits.windowLimit) break;
    const files = slice.files.filter((file) => {
      if (selectedFiles.has(file)) return true;
      if (Number.isFinite(limits.fileLimit) && selectedFiles.size >= limits.fileLimit) return false;
      selectedFiles.add(file);
      return true;
    });
    const fileSet = new Set(files);
    const windows: CalibrationSlice['windows'] = [];
    for (const window of slice.windows) {
      if (!fileSet.has(window.file)) continue;
      if (Number.isFinite(limits.windowLimit) && windowCount >= limits.windowLimit) break;
      windows.push(window);
      windowCount += 1;
    }
    if (files.length > 0 && windows.length > 0) {
      result.push({ ...slice, files, windows });
    }
  }

  return result;
}

function loadExistingRccl(projectRoot: string): RcclDocument | null {
  const rcclPath = join(projectRoot, '.resonant-code', 'rccl.yaml');
  if (!existsSync(rcclPath)) return null;
  try {
    const parsed = parseRccl(readFileSync(rcclPath, 'utf-8'), { allowVerifiedFields: true });
    return parsed.valid && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

function findAffectedObservations(document: RcclDocument, focusFiles: string[], mode: string): string[] {
  if (mode === 'full') return document.observations.map((observation) => observation.id);
  if (focusFiles.length === 0) return [];
  return document.observations
    .filter((observation) =>
      focusFiles.some((file) => scopeMatchesFile(observation.scope, file))
      || observation.evidence.some((evidence) => focusFiles.includes(evidence.file)))
    .map((observation) => observation.id);
}

function findStaleObservations(document: RcclDocument, projectRoot: string): string[] {
  return document.observations
    .filter((observation) =>
      observation.lifecycle?.status === 'stale'
      || observation.evidence.some((evidence) => !existsSync(join(projectRoot, evidence.file))))
    .map((observation) => observation.id);
}

function summarizeExistingObservations(
  document: RcclDocument | null,
  affectedObservationIds: string[],
): RcclRefreshExistingObservationSummary[] {
  if (!document) return [];
  const affected = new Set(affectedObservationIds);
  const candidates = affected.size > 0
    ? document.observations.filter((observation) => affected.has(observation.id))
    : document.observations.slice(0, 12);
  return candidates.map((observation) => ({
    id: observation.id,
    semantic_key: observation.semantic_key,
    category: observation.category,
    scope: observation.scope,
    pattern: observation.pattern,
    confidence: observation.confidence,
    adherence_quality: observation.adherence_quality,
    verification: observation.verification,
    lifecycle: observation.lifecycle,
    evidence_refs: observation.evidence.map((evidence) => `${evidence.file}:${evidence.line_range[0]}-${evidence.line_range[1]}`),
    traits: observation.traits,
  }));
}

function formatTraits(traits: NonNullable<RcclRefreshExistingObservationSummary['traits']>): string {
  return Object.entries(traits)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || '(none)';
}

function scopeMatchesFile(scope: string, file: string): boolean {
  if (scope === '**' || scope === '**/*') return true;
  if (scope.endsWith('/**')) return file.startsWith(scope.slice(0, -3));
  if (scope.includes('*')) {
    const escaped = scope.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return file === scope || file.startsWith(`${scope.replace(/\/$/, '')}/`);
}

function loadContextMeta(projectRoot: string): { raw: string } | null {
  try {
    const raw = readFileSync(join(projectRoot, '.resonant-code', 'context', 'global.yaml'), 'utf-8');
    return { raw: raw.slice(0, 1200) };
  } catch {
    return null;
  }
}
