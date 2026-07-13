import { a as PrepareRcclResult, d as RcclWorkflowDiscoveryDocument, i as PrepareIncrementalRcclResult, n as CommitRcclObservationRefreshSuccess, o as PrepareRcclWorkflowStageResult, p as VerificationSummary, s as RcclAIContractEnvelope, t as CommitRcclObservationRefreshFailure, u as RcclWorkflowCritiqueDocument } from "./types.mjs";

//#region src/validate-candidates.d.ts
type RcclDiagnosticStatus = 'accepted' | 'rejected';
type RcclDiagnosticReason = 'accepted' | 'duplicate-id' | 'low-confidence' | 'malformed-payload' | 'missing-required-field' | 'unsupported-value' | 'failed-verification';
interface RcclDiagnosticEntry {
  status: RcclDiagnosticStatus;
  reason: RcclDiagnosticReason;
  path: string;
  message: string;
  observationId?: string;
  confidence?: number;
}
interface RcclCandidatePayloadDiagnostics {
  kind: 'rccl-observation-generation';
  summary: {
    total: number;
    accepted: number;
    rejected: number;
  };
  entries: RcclDiagnosticEntry[];
}
//#endregion
//#region src/lifecycle.d.ts
interface PrepareCalibrationInput {
  projectRoot: string;
  mode: 'full' | 'incremental' | 'discover' | 'critique' | 'synthesize';
  scope?: string;
  targetFiles?: string[];
  changedFiles?: string[];
  incrementalMode?: 'task-scoped' | 'changed-files' | 'full';
  fileLimit?: number;
  windowLimit?: number;
  debugArtifacts?: boolean;
  artifacts?: {
    discovery?: string | RcclWorkflowDiscoveryDocument;
    critique?: string | RcclWorkflowCritiqueDocument;
  };
}
declare function prepareCalibration(input: PrepareCalibrationInput): PrepareRcclResult | PrepareIncrementalRcclResult | PrepareRcclWorkflowStageResult;
interface CommitCalibrationInput {
  projectRoot: string;
  plan: {
    mode: 'full' | 'refresh';
    contract: RcclAIContractEnvelope;
    scope?: string;
    targetFiles?: string[];
    changedFiles?: string[];
    incrementalMode?: 'task-scoped' | 'changed-files' | 'full';
    fileLimit?: number;
    windowLimit?: number;
    debugArtifacts?: boolean;
  };
  artifacts: {
    candidate: string;
  };
}
declare function commitCalibration(input: CommitCalibrationInput): CommitRcclObservationRefreshSuccess | CommitRcclObservationRefreshFailure | {
  status: "failed";
  reason: string;
  diagnostics: {
    code: string;
    message: string;
  };
} | {
  status: "failed";
  reason: string;
  diagnostics: RcclCandidatePayloadDiagnostics;
} | {
  diagnostics: RcclCandidatePayloadDiagnostics;
  debugArtifacts: {
    enabled: boolean;
    candidates: string;
    consolidation: string;
  } | {
    enabled: boolean;
    candidates?: undefined;
    consolidation?: undefined;
  };
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
  status: "committed";
  reason?: undefined;
};
//#endregion
export { type CommitCalibrationInput, type PrepareCalibrationInput, commitCalibration, prepareCalibration };