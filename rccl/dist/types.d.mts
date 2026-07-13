//#region src/validate-refresh.d.ts
type RcclRefreshDiagnosticStatus = 'accepted' | 'rejected' | 'unused';
type RcclRefreshDiagnosticReason = 'accepted' | 'duplicate-id' | 'empty-payload' | 'invalid-id' | 'low-confidence' | 'malformed-payload' | 'missing-required-field' | 'unsupported-value';
interface RcclRefreshDiagnosticEntry {
  status: RcclRefreshDiagnosticStatus;
  reason: RcclRefreshDiagnosticReason;
  path: string;
  message: string;
  observationId?: string;
  confidence?: number;
}
interface RcclRefreshPayloadDiagnostics {
  kind: 'rccl-observation-refresh';
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    unused: number;
  };
  entries: RcclRefreshDiagnosticEntry[];
}
//#endregion
//#region src/types.d.ts
type RcclSchemaVersion = '1.0';
type RcclCategory = 'style' | 'architecture' | 'pattern' | 'constraint' | 'legacy' | 'anti-pattern' | 'migration';
type AdherenceQuality = 'good' | 'inconsistent' | 'poor';
type VerificationDisposition = 'keep' | 'keep-with-reduced-confidence' | 'demote-to-ambient';
type VerificationStatus = 'verified' | 'partial' | 'failed' | 'unverifiable';
type InductionStatus = 'well-supported' | 'narrowly-supported' | 'overgeneralized' | 'ambiguous';
type ScopeBasis = 'single-file' | 'directory-cluster' | 'module-cluster' | 'cross-root';
interface RcclEvidence {
  file: string;
  line_range: [number, number];
  snippet: string;
}
interface RcclSupport {
  source_slices: string[];
  file_count: number;
  cluster_count: number;
  scope_basis: ScopeBasis;
}
interface RcclVerification {
  evidence_status: VerificationStatus | null;
  evidence_verified_count: number | null;
  evidence_confidence: number | null;
  induction_status: InductionStatus | null;
  induction_confidence: number | null;
  checked_at: string | null;
  disposition: VerificationDisposition | null;
}
interface RcclObservationTraits {
  legacy?: boolean;
  migration_boundary?: boolean;
  anti_pattern?: boolean;
  compatibility_boundary?: boolean;
}
type RcclLifecycleStatus = 'active' | 'stale' | 'superseded';
interface RcclLifecycle {
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
interface RcclObservation {
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
interface RcclDocument {
  version: RcclSchemaVersion;
  generated_at: string | null;
  git_ref: string | null;
  observations: RcclObservation[];
}
interface ParsedRcclResult {
  valid: boolean;
  data?: RcclDocument;
  errors?: string[];
}
type RcclWorkflowStageName = 'discover' | 'critique' | 'synthesize';
type RcclWorkflowCritiqueDisposition = 'keep' | 'revise' | 'drop';
interface RcclWorkflowDiscoverySeed {
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
interface RcclWorkflowDiscoveryDocument {
  version: RcclSchemaVersion;
  stage: 'discover';
  generated_at: string | null;
  scope: string;
  seeds: RcclWorkflowDiscoverySeed[];
}
interface RcclWorkflowCritiqueReview {
  seed_id: string;
  disposition: RcclWorkflowCritiqueDisposition;
  reasons: string[];
  issues?: string[];
  counter_evidence?: RcclEvidence[];
  recommended_scope_hint?: string | null;
}
interface RcclWorkflowCritiqueDocument {
  version: RcclSchemaVersion;
  stage: 'critique';
  generated_at: string | null;
  scope: string;
  reviews: RcclWorkflowCritiqueReview[];
}
interface VerificationSummaryObservation {
  id: string;
  disposition: VerificationDisposition | null;
  evidence_status: VerificationStatus | null;
  induction_status: InductionStatus | null;
  evidence_verified_count: number | null;
  evidence_total_count: number;
  support: RcclSupport;
}
interface VerificationSummary {
  total_observations: number;
  kept_count: number;
  reduced_confidence_count: number;
  demoted_count: number;
  evidence_status_counts: Record<VerificationStatus | 'pending', number>;
  induction_status_counts: Record<InductionStatus | 'pending', number>;
  observations: VerificationSummaryObservation[];
}
interface EmitRcclResult {
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
interface RepoIndexReport {
  discovered_files: number;
  indexed_files: number;
  read_bytes: number;
  skipped_oversize: number;
  skipped_unsupported: number;
  truncated: Array<'file-count-limit' | 'total-read-limit'>;
}
interface VerificationPolicy {
  snippet_similarity_threshold: number;
  min_evidence_for_directory_scope: number;
  min_evidence_for_cross_root_scope: number;
  anti_pattern_min_evidence: number;
  migration_min_evidence: number;
}
interface RcclCalibrationStats {
  total_files: number;
  indexed_files: number;
  selected_slices: number;
  windows: number;
  index_report?: RepoIndexReport;
}
type RcclAIContractVersion = 'ai-contract/v1';
type RcclAIContractKind = 'context-acquisition' | 'rccl-observation-generation' | 'rccl-observation-refresh' | 'rccl-counterexample' | 'rccl-semantic-equivalence';
type RcclAIContractSchemaVersion = '1.0';
interface RcclAIContractArtifact {
  suggestedPath: string;
  format: 'yaml' | 'json';
  usage: string;
}
interface RcclAIContractEnvelope {
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
type RcclIncrementalMode = 'task-scoped' | 'changed-files' | 'full';
type RcclRefreshPlanMode = 'cache-hit' | 'contracts-required' | 'verify-only' | 'full-refresh-recommended';
interface PrepareIncrementalRcclResult {
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
interface RcclSemanticEquivalenceCommitSummary {
  observation_ids: string[];
  canonical_id: string | null;
  superseded_ids: string[];
  confidence: number;
  status: 'applied' | 'rejected' | 'unused';
  reason: string;
}
interface RcclCounterexampleCommitSummary {
  observation_id: string;
  confidence: number;
  status: 'applied' | 'rejected' | 'unused';
  action: 'reduced-confidence' | 'demoted-to-ambient' | 'none';
  reason: string;
}
interface RcclObservationRefreshSummary {
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
interface CommitRcclObservationRefreshSuccess {
  status: 'committed';
  diagnostics: RcclRefreshPayloadDiagnostics;
  refresh_summary: RcclObservationRefreshSummary;
  result: EmitRcclResult;
  debugArtifacts: {
    enabled: boolean;
    candidates?: string;
    consolidation?: string;
  };
}
interface CommitRcclObservationRefreshFailure {
  status: 'failed';
  reason: 'missing-existing-rccl' | 'invalid-existing-rccl' | 'invalid-refresh-payload';
  diagnostics?: RcclRefreshPayloadDiagnostics;
  errors?: string[];
}
interface PrepareRcclResult {
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
interface PrepareRcclWorkflowStageResult {
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
//#endregion
export { PrepareRcclResult as a, RcclDocument as c, RcclWorkflowDiscoveryDocument as d, VerificationPolicy as f, PrepareIncrementalRcclResult as i, RcclObservation as l, CommitRcclObservationRefreshSuccess as n, PrepareRcclWorkflowStageResult as o, VerificationSummary as p, ParsedRcclResult as r, RcclAIContractEnvelope as s, CommitRcclObservationRefreshFailure as t, RcclWorkflowCritiqueDocument as u };