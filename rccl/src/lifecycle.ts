import { parseRcclCritiqueArtifact, parseRcclDiscoveryArtifact } from './io/parse-rccl-workflow.ts';
import { prepareIncrementalRccl, prepareRccl, prepareRcclWorkflowStage } from './prepare.ts';
import { validateRcclCandidatePayload } from './validate-candidates.ts';
import { consolidateObservations, materializeRcclObservations } from './consolidate/consolidate-observations.ts';
import { verifyEvidenceForDocument } from './verify/verify-evidence.ts';
import { verifyInductionForDocument } from './verify/verify-induction.ts';
import { emitRccl, writeCandidateArtifact, writeConsolidationArtifact } from './io/emit-rccl.ts';
import { commitRcclObservationRefresh } from './commit-refresh.ts';
import type { CandidateRcclDocument, RcclWorkflowCritiqueDocument, RcclWorkflowDiscoveryDocument } from './types.ts';
import type { RcclAIContractEnvelope } from './types.ts';
import { parseYaml, toYaml } from './utils/yaml.ts';

export interface PrepareCalibrationInput {
  projectRoot: string;
  mode: 'full' | 'incremental' | 'discover' | 'critique' | 'synthesize';
  scope?: string;
  targetFiles?: string[];
  changedFiles?: string[];
  incrementalMode?: 'task-scoped' | 'changed-files' | 'full';
  fileLimit?: number;
  windowLimit?: number;
  debugArtifacts?: boolean;
  artifacts?: { discovery?: string | RcclWorkflowDiscoveryDocument; critique?: string | RcclWorkflowCritiqueDocument };
}

export function prepareCalibration(input: PrepareCalibrationInput) {
  if (input.mode === 'full') return prepareRccl(input.projectRoot, { scope: input.scope, debugArtifacts: input.debugArtifacts });
  if (input.mode === 'incremental') {
    return prepareIncrementalRccl(input.projectRoot, {
      scope: input.scope,
      targetFiles: input.targetFiles,
      changedFiles: input.changedFiles,
      mode: input.incrementalMode,
      fileLimit: input.fileLimit,
      windowLimit: input.windowLimit,
      debugArtifacts: input.debugArtifacts,
    });
  }
  return prepareRcclWorkflowStage(input.projectRoot, {
    stage: input.mode,
    scope: input.scope,
    discovery: parseDiscovery(input.artifacts?.discovery),
    critique: parseCritique(input.artifacts?.critique),
    debugArtifacts: input.debugArtifacts,
  });
}

export interface CommitCalibrationInput {
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
  artifacts: { candidate: string };
}

export function commitCalibration(input: CommitCalibrationInput) {
  const expectedKind = input.plan.mode === 'refresh' ? 'rccl-observation-refresh' : 'rccl-observation-generation';
  const issuedContract = reissueCalibrationContract(input);
  if (!issuedContract.valid) return { status: 'failed' as const, reason: issuedContract.reason, diagnostics: issuedContract.diagnostics };
  const artifact = unwrapArtifact(input.artifacts.candidate, expectedKind, issuedContract.contract);
  if (!artifact.valid) return { status: 'failed' as const, reason: artifact.reason, diagnostics: artifact.diagnostics };
  const candidateYaml = toYaml(artifact.payload);
  if (input.plan.mode === 'refresh') {
    return commitRcclObservationRefresh(input.projectRoot, candidateYaml, { debugArtifacts: input.plan.debugArtifacts });
  }
  const validated = validateRcclCandidatePayload(candidateYaml);
  if (!validated.valid) return { status: 'failed' as const, reason: 'invalid-candidate-payload', diagnostics: validated.diagnostics };
  const candidateDocument: CandidateRcclDocument = {
    version: '1.0',
    generated_at: validated.document?.generated_at ?? null,
    git_ref: validated.document?.git_ref ?? null,
    observations: validated.observations,
  };
  const consolidation = consolidateObservations(candidateDocument.observations);
  const draft = {
    version: '1.0' as const,
    generated_at: candidateDocument.generated_at,
    git_ref: candidateDocument.git_ref,
    observations: materializeRcclObservations(consolidation.observations),
  };
  const verified = verifyInductionForDocument(verifyEvidenceForDocument(draft, input.projectRoot));
  const result = emitRccl(verified, input.projectRoot);
  return {
    status: 'committed' as const,
    ...result,
    diagnostics: validated.diagnostics,
    debugArtifacts: input.plan.debugArtifacts
      ? { enabled: true, candidates: writeCandidateArtifact(input.projectRoot, candidateDocument), consolidation: writeConsolidationArtifact(input.projectRoot, consolidation, verified) }
      : { enabled: false },
  };
}

function reissueCalibrationContract(input: CommitCalibrationInput):
  | { valid: true; contract: RcclAIContractEnvelope }
  | { valid: false; reason: string; diagnostics: { code: string; message: string } } {
  if (!input.plan?.contract) {
    return {
      valid: false,
      reason: 'missing-calibration-contract',
      diagnostics: { code: 'MISSING_CALIBRATION_CONTRACT', message: 'commitCalibration requires the contract issued by prepareCalibration.' },
    };
  }

  const currentPlan = input.plan.mode === 'full'
    ? prepareRccl(input.projectRoot, { scope: input.plan.scope })
    : prepareIncrementalRccl(input.projectRoot, {
      scope: input.plan.scope,
      targetFiles: input.plan.targetFiles,
      changedFiles: input.plan.changedFiles,
      mode: input.plan.incrementalMode,
      fileLimit: input.plan.fileLimit,
      windowLimit: input.plan.windowLimit,
    });
  const expected = currentPlan.contract;
  if (!expected || expected.kind !== (input.plan.mode === 'full' ? 'rccl-observation-generation' : 'rccl-observation-refresh')) {
    return {
      valid: false,
      reason: 'calibration-contract-unavailable',
      diagnostics: { code: 'CALIBRATION_CONTRACT_UNAVAILABLE', message: 'The current repository state does not issue the requested calibration contract. Re-run prepareCalibration.' },
    };
  }
  if (
    input.plan.contract.requestId !== expected.requestId
    || input.plan.contract.contextFingerprint !== expected.contextFingerprint
    || input.plan.contract.kind !== expected.kind
    || input.plan.contract.schemaId !== expected.schemaId
    || input.plan.contract.schemaVersion !== expected.schemaVersion
  ) {
    return {
      valid: false,
      reason: 'calibration-plan-stale',
      diagnostics: { code: 'CALIBRATION_PLAN_STALE', message: 'The supplied plan is not the contract currently issued for this repository state. Re-run prepareCalibration.' },
    };
  }
  return { valid: true, contract: expected };
}

function unwrapArtifact(text: string, expectedKind: string, contract: RcclAIContractEnvelope):
  | { valid: true; payload: unknown }
  | { valid: false; reason: string; diagnostics: { code: string; message: string } } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return { valid: false, reason: 'malformed-yaml', diagnostics: { code: 'MALFORMED_YAML', message: error instanceof Error ? error.message : String(error) } };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'invalid-artifact-envelope', diagnostics: { code: 'MALFORMED_ARTIFACT', message: 'RCCL artifact must use the v1 envelope.' } };
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.schema_version !== 1) {
    return { valid: false, reason: 'unsupported-schema-version', diagnostics: { code: 'UNSUPPORTED_SCHEMA_VERSION', message: `Expected schema_version 1; found ${String(envelope.schema_version)}. Re-run calibrate-repo-context prepare. Existing files were not modified.` } };
  }
  if (envelope.kind !== expectedKind) {
    return { valid: false, reason: 'artifact-kind-mismatch', diagnostics: { code: 'ARTIFACT_KIND_MISMATCH', message: `Expected ${expectedKind}; found ${String(envelope.kind)}.` } };
  }
  if (typeof envelope.context_fingerprint !== 'string' || typeof envelope.request_id !== 'string') {
    return { valid: false, reason: 'missing-artifact-identity', diagnostics: { code: 'MISSING_ARTIFACT_IDENTITY', message: 'request_id and context_fingerprint are required.' } };
  }
  if (envelope.request_id !== `${expectedKind}:${envelope.context_fingerprint}`) {
    return { valid: false, reason: 'request-id-mismatch', diagnostics: { code: 'REQUEST_ID_MISMATCH', message: 'request_id is not bound to the supplied context_fingerprint.' } };
  }
  if (envelope.request_id !== contract.requestId || envelope.context_fingerprint !== contract.contextFingerprint) {
    return { valid: false, reason: 'context-fingerprint-mismatch', diagnostics: { code: 'CONTEXT_FINGERPRINT_MISMATCH', message: 'Artifact identity does not match the issued calibration plan.' } };
  }
  if (!('payload' in envelope)) {
    return { valid: false, reason: 'missing-payload', diagnostics: { code: 'MISSING_PAYLOAD', message: 'Artifact envelope is missing payload.' } };
  }
  return { valid: true, payload: envelope.payload };
}

function parseDiscovery(value: string | RcclWorkflowDiscoveryDocument | undefined): RcclWorkflowDiscoveryDocument | undefined {
  if (!value) return undefined;
  if (typeof value !== 'string') return value;
  const parsed = parseRcclDiscoveryArtifact(value);
  if (!parsed.valid || !parsed.data) throw new Error(`Invalid RCCL discovery artifact: ${(parsed.errors ?? []).join('; ')}`);
  return parsed.data;
}

function parseCritique(value: string | RcclWorkflowCritiqueDocument | undefined): RcclWorkflowCritiqueDocument | undefined {
  if (!value) return undefined;
  if (typeof value !== 'string') return value;
  const parsed = parseRcclCritiqueArtifact(value);
  if (!parsed.valid || !parsed.data) throw new Error(`Invalid RCCL critique artifact: ${(parsed.errors ?? []).join('; ')}`);
  return parsed.data;
}
