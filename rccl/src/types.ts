export type RcclSchemaVersion = '1.0';
export type RcclCategory = 'style' | 'architecture' | 'pattern' | 'constraint' | 'legacy' | 'anti-pattern' | 'migration';
export type AdherenceQuality = 'good' | 'inconsistent' | 'poor';
export type VerificationDisposition = 'keep' | 'keep-with-reduced-confidence' | 'demote-to-ambient';
export type VerificationStatus = 'verified' | 'partial' | 'failed' | 'unverifiable';
export type InductionStatus = 'well-supported' | 'narrowly-supported' | 'overgeneralized' | 'ambiguous';
export type ScopeBasis = 'single-file' | 'directory-cluster' | 'module-cluster' | 'cross-root';

export interface RcclEvidence {
  file: string;
  line_range: [number, number];
  snippet: string;
}

export type EvidenceRefKind = 'file' | 'diff' | 'command' | 'rccl-evidence' | 'runtime-trace' | 'conversation';

export interface EvidenceRef {
  kind: EvidenceRefKind;
  ref: string;
  file?: string;
  line_range?: [number, number];
  snippet_hash?: string;
  command?: string;
  output_hash?: string;
}

export interface RcclSupport {
  source_slices: string[];
  file_count: number;
  cluster_count: number;
  scope_basis: ScopeBasis;
}

export interface RcclVerification {
  evidence_status: VerificationStatus | null;
  evidence_verified_count: number | null;
  evidence_confidence: number | null;
  induction_status: InductionStatus | null;
  induction_confidence: number | null;
  checked_at: string | null;
  disposition: VerificationDisposition | null;
}

export interface RcclObservationTraits {
  legacy?: boolean;
  migration_boundary?: boolean;
  anti_pattern?: boolean;
  compatibility_boundary?: boolean;
}

export type RcclLifecycleStatus = 'active' | 'stale' | 'superseded';

export interface RcclLifecycle {
  first_seen_git_ref: string | null;
  last_seen_git_ref: string | null;
  last_verified_at: string | null;
  content_fingerprint: string;
  status: RcclLifecycleStatus;
  supersedes?: string[];
  superseded_by?: string;
  stale_since_git_ref?: string | null;
  superseded_at_git_ref?: string | null;
}

export interface RcclObservation {
  id: string;
  semantic_key: string;
  category: RcclCategory;
  scope: string;
  pattern: string;
  confidence: number;
  adherence_quality: AdherenceQuality;
  evidence: RcclEvidence[];
  support: RcclSupport;
  verification: RcclVerification;
  lifecycle?: RcclLifecycle;
  traits?: RcclObservationTraits;
}

export interface RcclDocument {
  version: RcclSchemaVersion;
  generated_at: string | null;
  git_ref: string | null;
  observations: RcclObservation[];
}

export interface ParsedRcclResult {
  valid: boolean;
  data?: RcclDocument;
  errors?: string[];
}

export interface CandidateSupportHint {
  scope_basis?: ScopeBasis | null;
  file_count?: number | null;
  cluster_count?: number | null;
}

export interface CandidateObservation {
  provisional_id: string;
  semantic_key: string;
  category: RcclCategory;
  scope_hint: string;
  pattern: string;
  confidence: number;
  adherence_quality: AdherenceQuality;
  evidence: RcclEvidence[];
  evidence_refs?: EvidenceRef[];
  counterexamples?: EvidenceRef[];
  source_slice_ids: string[];
  support_hint?: CandidateSupportHint | null;
  traits?: RcclObservationTraits;
}

export interface CandidateRcclDocument {
  version: RcclSchemaVersion;
  generated_at: string | null;
  git_ref: string | null;
  observations: CandidateObservation[];
}

export interface ParsedCandidateRcclResult {
  valid: boolean;
  data?: CandidateRcclDocument;
  errors?: string[];
}

export type RcclWorkflowStageName = 'discover' | 'critique' | 'synthesize';
export type RcclWorkflowCritiqueDisposition = 'keep' | 'revise' | 'drop';

export interface RcclWorkflowDiscoverySeed {
  seed_id: string;
  semantic_key: string;
  category: RcclCategory;
  scope_hint: string;
  pattern: string;
  decision_impact: string;
  evidence: RcclEvidence[];
  source_slice_ids: string[];
  uncertainty?: string | null;
}

export interface RcclWorkflowDiscoveryDocument {
  version: RcclSchemaVersion;
  stage: 'discover';
  generated_at: string | null;
  scope: string;
  seeds: RcclWorkflowDiscoverySeed[];
}

export interface RcclWorkflowCritiqueReview {
  seed_id: string;
  disposition: RcclWorkflowCritiqueDisposition;
  reasons: string[];
  issues?: string[];
  counter_evidence?: RcclEvidence[];
  recommended_scope_hint?: string | null;
}

export interface RcclWorkflowCritiqueDocument {
  version: RcclSchemaVersion;
  stage: 'critique';
  generated_at: string | null;
  scope: string;
  reviews: RcclWorkflowCritiqueReview[];
}

export interface ParsedRcclWorkflowDiscoveryResult {
  valid: boolean;
  data?: RcclWorkflowDiscoveryDocument;
  errors?: string[];
}

export interface ParsedRcclWorkflowCritiqueResult {
  valid: boolean;
  data?: RcclWorkflowCritiqueDocument;
  errors?: string[];
}

export interface ConsolidatedObservation {
  id: string;
  semantic_key: string;
  candidate_ids: string[];
  category: RcclCategory;
  scope_hint: string;
  pattern: string;
  confidence: number;
  adherence_quality: AdherenceQuality;
  evidence: RcclEvidence[];
  source_slice_ids: string[];
  support: RcclSupport;
  traits?: RcclObservationTraits;
}

export interface ConsolidationGroupReport {
  id: string;
  semantic_key: string;
  candidate_ids: string[];
  category: RcclCategory;
  pattern: string;
  source_slice_ids: string[];
  evidence_files: string[];
  merge_basis: string;
  support_derivation_reason: string;
  scope_derivation_reason: string;
  derived_support: RcclSupport;
  final_scope: string;
}

export interface ConsolidationResult {
  observations: ConsolidatedObservation[];
  report: {
    candidate_count: number;
    merged_group_count: number;
    final_observation_count: number;
    groups: ConsolidationGroupReport[];
  };
}

export interface VerificationSummaryObservation {
  id: string;
  disposition: VerificationDisposition | null;
  evidence_status: VerificationStatus | null;
  induction_status: InductionStatus | null;
  evidence_verified_count: number | null;
  evidence_total_count: number;
  support: RcclSupport;
}

export interface VerificationSummary {
  total_observations: number;
  kept_count: number;
  reduced_confidence_count: number;
  demoted_count: number;
  evidence_status_counts: Record<VerificationStatus | 'pending', number>;
  induction_status_counts: Record<InductionStatus | 'pending', number>;
  observations: VerificationSummaryObservation[];
}

export interface EmitRcclResult {
  written: string;
  history_written: string;
  stats: {
    added: number;
    updated: number;
    preserved: number;
    stale: number;
    superseded: number;
  };
  verification_summary: VerificationSummary;
}

export interface IndexedFile {
  path: string;
  language: string;
  lines: number;
  is_test: boolean;
  is_generated: boolean;
  package_root: string;
  imports_count: number;
  exports_count: number;
  symbol_density: number;
  role_hints: string[];
}

export interface RepoIndexReport {
  discovered_files: number;
  indexed_files: number;
  read_bytes: number;
  skipped_oversize: number;
  skipped_unsupported: number;
  truncated: Array<'file-count-limit' | 'total-read-limit'>;
}

export interface RepoRootSummary {
  root: string;
  file_count: number;
  languages: string[];
}

export interface ModuleCluster {
  id: string;
  base_path: string;
  file_paths: string[];
  dominant_language: string;
}

export interface BoundaryZone {
  id: string;
  file_paths: string[];
  reason: string;
}

export interface MigrationZone {
  id: string;
  file_paths: string[];
  reason: string;
}

export interface StyleCluster {
  id: string;
  file_paths: string[];
  reason: string;
}

export interface RepoRepresentation {
  roots: RepoRootSummary[];
  modules: ModuleCluster[];
  boundaries: BoundaryZone[];
  migrations: MigrationZone[];
  style_clusters: StyleCluster[];
}

export interface CalibrationWindow {
  file: string;
  start_line: number;
  end_line: number;
  purpose: 'header' | 'structure' | 'implementation';
  snippet: string;
}

export interface CalibrationSlice {
  id: string;
  kind: 'root' | 'module' | 'boundary' | 'migration' | 'style-cluster';
  files: string[];
  rationale: string;
  coverage_weight: number;
  windows: CalibrationWindow[];
}

export interface SamplingPolicy {
  max_slices: number;
  max_files_per_slice: number;
  max_windows_per_file: number;
  target_coverage: {
    roots: boolean;
    modules: boolean;
    boundaries: boolean;
    migrations: boolean;
    style_clusters: boolean;
  };
}

export interface VerificationPolicy {
  snippet_similarity_threshold: number;
  min_evidence_for_directory_scope: number;
  min_evidence_for_cross_root_scope: number;
  anti_pattern_min_evidence: number;
  migration_min_evidence: number;
}

export interface RcclCalibrationStats {
  total_files: number;
  indexed_files: number;
  selected_slices: number;
  windows: number;
  index_report?: RepoIndexReport;
}

export type RcclAIContractVersion = 'ai-contract/v1';
export type RcclAIContractKind =
  | 'context-acquisition'
  | 'rccl-observation-generation'
  | 'rccl-observation-refresh'
  | 'rccl-counterexample'
  | 'rccl-semantic-equivalence';
export type RcclAIContractSchemaVersion = '1.0';

export interface RcclAIContractArtifact {
  suggestedPath: string;
  format: 'yaml' | 'json';
  usage: string;
}

export interface RcclAIContractEnvelope {
  contractVersion: RcclAIContractVersion;
  kind: RcclAIContractKind;
  requestId: string;
  contextFingerprint: string;
  schemaId: string;
  schemaVersion: RcclAIContractSchemaVersion;
  prompt: string;
  schema: string;
  artifact: RcclAIContractArtifact;
  provenance: {
    owner: 'rccl';
    deterministic: true;
  };
  cacheKeyMaterial?: unknown;
}

export type RcclIncrementalMode = 'task-scoped' | 'changed-files' | 'full';
export type RcclRefreshPlanMode = 'cache-hit' | 'contracts-required' | 'verify-only' | 'full-refresh-recommended';

export interface PrepareIncrementalRcclOptions {
  scope?: string;
  targetFiles?: string[];
  changedFiles?: string[];
  mode?: RcclIncrementalMode;
  fileLimit?: number;
  windowLimit?: number;
  debugArtifacts?: boolean;
}

export interface RcclRefreshExistingObservationSummary {
  id: string;
  semantic_key: string;
  category: RcclCategory;
  scope: string;
  pattern: string;
  confidence: number;
  adherence_quality: AdherenceQuality;
  verification: RcclVerification;
  lifecycle?: RcclLifecycle;
  evidence_refs: string[];
  traits?: RcclObservationTraits;
}

export interface PrepareIncrementalRcclResult {
  mode: RcclRefreshPlanMode;
  contract?: RcclAIContractEnvelope;
  candidateArtifact?: RcclAIContractArtifact;
  refreshArtifact?: RcclAIContractArtifact;
  metadata: {
    scope: string;
    requested_mode: RcclIncrementalMode;
    focus_files: string[];
    stats: RcclCalibrationStats;
    existing_observation_count: number;
    limits: {
      file_limit: number | null;
      window_limit: number | null;
      applied: boolean;
    };
  };
  affectedObservations: string[];
  staleObservations: string[];
  cacheArtifacts: {
    repoIndexPath: string;
    slicePlanPath: string;
  };
  debugArtifacts: {
    enabled: boolean;
    promptPath?: string;
    reportPath?: string;
    slicePlanPath?: string;
  };
}

export interface RcclObservationRefreshRetireEntry {
  observation_id: string;
  reason_id: 'file-missing' | 'snippet-drift' | 'scope-drift' | 'superseded' | 'no-longer-material' | 'other';
  confidence: number;
  evidence_refs?: EvidenceRef[];
}

export interface RcclSemanticEquivalenceProposal {
  observation_ids: string[];
  confidence: number;
  evidence_refs: EvidenceRef[];
  reason: string;
}

export interface RcclCounterexampleProposal {
  observation_id: string;
  confidence: number;
  evidence_refs: EvidenceRef[];
  reason: string;
}

export interface RcclObservationRefreshDocument {
  version: RcclSchemaVersion;
  generated_at: string | null;
  scope: string;
  keep: string[];
  revise: CandidateObservation[];
  retire: RcclObservationRefreshRetireEntry[];
  new_observations: CandidateObservation[];
  semantic_equivalence?: RcclSemanticEquivalenceProposal[];
  counterexamples?: RcclCounterexampleProposal[];
}

export interface CommitRcclObservationRefreshOptions {
  debugArtifacts?: boolean;
}

export interface RcclSemanticEquivalenceCommitSummary {
  observation_ids: string[];
  canonical_id: string | null;
  superseded_ids: string[];
  confidence: number;
  status: 'applied' | 'rejected' | 'unused';
  reason: string;
}

export interface RcclCounterexampleCommitSummary {
  observation_id: string;
  confidence: number;
  status: 'applied' | 'rejected' | 'unused';
  action: 'reduced-confidence' | 'demoted-to-ambient' | 'none';
  reason: string;
}

export interface RcclObservationRefreshSummary {
  previous_observation_count: number;
  active_observation_count: number;
  kept: string[];
  carried_forward: string[];
  revised: string[];
  retired: string[];
  added: string[];
  semantic_equivalence: RcclSemanticEquivalenceCommitSummary[];
  counterexamples: RcclCounterexampleCommitSummary[];
}

export interface CommitRcclObservationRefreshSuccess {
  status: 'committed';
  diagnostics: import('./validate-refresh.ts').RcclRefreshPayloadDiagnostics;
  refresh_summary: RcclObservationRefreshSummary;
  result: EmitRcclResult;
  debugArtifacts: {
    enabled: boolean;
    candidates?: string;
    consolidation?: string;
  };
}

export interface CommitRcclObservationRefreshFailure {
  status: 'failed';
  reason: 'missing-existing-rccl' | 'invalid-existing-rccl' | 'invalid-refresh-payload';
  diagnostics?: import('./validate-refresh.ts').RcclRefreshPayloadDiagnostics;
  errors?: string[];
}

export type CommitRcclObservationRefreshResult =
  | CommitRcclObservationRefreshSuccess
  | CommitRcclObservationRefreshFailure;

export interface PrepareRcclResult {
  prompt: string;
  contract: RcclAIContractEnvelope;
  candidateArtifact: RcclAIContractArtifact;
  metadata: {
    scope: string;
    stats: RcclCalibrationStats;
  };
  debugArtifacts: {
    enabled: boolean;
    promptPath?: string;
    reportPath?: string;
    slicePlanPath?: string;
  };
}

export interface PrepareRcclWorkflowStageResult {
  stage: RcclWorkflowStageName;
  prompt: string;
  suggestedArtifactPath: string;
  metadata: {
    scope: string;
    stats: RcclCalibrationStats;
  };
  debugArtifacts: {
    enabled: boolean;
    promptPath?: string;
    reportPath?: string;
    slicePlanPath?: string;
  };
}
