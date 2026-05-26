import type { CompileInput, CompileTaskInput, ResolvedTaskOutput } from '../types.ts';
import type { HostProposalIR } from '../ir/types.ts';

export type AIContractVersion = 'ai-contract/v1';
export type AIContractKind = 'task-interpretation' | 'semantic-relation' | 'semantic-candidate' | 'rccl-observation-generation' | 'adherence-evaluation';
export type AIContractSchemaVersion = '1.0';

export interface AIContractArtifact {
  suggestedPath: string;
  format: 'json' | 'yaml';
  usage: string;
}

export interface AIContractEnvelope<TSchema = unknown> {
  contractVersion: AIContractVersion;
  kind: AIContractKind;
  schemaId: string;
  schemaVersion: AIContractSchemaVersion;
  prompt: string;
  schema: TSchema;
  artifact: AIContractArtifact;
  allowedIds?: {
    directiveIds?: string[];
    observationIds?: string[];
  };
  provenance: {
    owner: 'runtime';
    deterministic: true;
  };
  cacheKeyMaterial?: unknown;
}

export interface TaskInterpretationContractInput {
  task: CompileTaskInput;
  candidatePath: string;
}

export interface TaskInterpretationRecommendation {
  shouldUseHostCandidate: boolean;
  reason: string;
  nextStep: string;
}

export interface TaskInterpretationContractOutput {
  task: CompileTaskInput;
  interpretationPrompt: string;
  taskSchema: string;
  ambiguityHints: string[];
  recommendation: TaskInterpretationRecommendation;
  candidateArtifact: AIContractArtifact;
  clarificationHints: string[];
  contract: AIContractEnvelope;
}

export interface SemanticProposalDirectiveSummary {
  id: string;
  semanticKey: string;
  kind: string;
  prescription: string;
  weight: string;
  layer: string;
  scope: string;
  description: string;
  rationale: string;
  traits: unknown;
}

export interface SemanticProposalObservationSummary {
  id: string;
  semanticKey: string;
  category: string;
  scope: string;
  pattern: string;
  adherence: unknown;
  verification: unknown;
  lifecycle: unknown;
  traits: unknown;
  evidenceRefs: string[];
  evidence: Array<{
    file: string;
    line_range: [number, number];
    snippet: string;
  }>;
}

export interface SemanticContractInput {
  resolvedTask: ResolvedTaskOutput;
  directives: SemanticProposalDirectiveSummary[];
  observations: SemanticProposalObservationSummary[];
  artifactPath: string;
}

export interface SemanticContractContextInput {
  compileInput: CompileInput;
}

export interface SemanticContractContextOutput {
  resolvedTask: ResolvedTaskOutput;
  directives: SemanticProposalDirectiveSummary[];
  observations: SemanticProposalObservationSummary[];
  loadedSources?: import('../load/compile-sources.ts').CompileSources;
}

export interface SemanticContractBundleInput extends SemanticContractContextInput {
  artifactPath: string;
}

export interface SemanticRelationContractOutput {
  proposalPrompt: string;
  proposalSchema: string;
  proposalArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface SemanticCandidateContractOutput {
  candidatePrompt: string;
  candidateSchema: string;
  candidateArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface SemanticRelationContractBundleOutput extends SemanticContractContextOutput, SemanticRelationContractOutput {}

export interface SemanticCandidateContractBundleOutput extends SemanticContractContextOutput, SemanticCandidateContractOutput {}

export interface HostProposalSourceInput {
  id: string;
  path?: string;
}

export type ContractPayloadDiagnosticStatus = 'accepted' | 'rejected' | 'downgraded' | 'unused';
export type ContractPayloadDiagnosticReason =
  | 'accepted'
  | 'duplicate-id'
  | 'empty-payload'
  | 'invalid-id'
  | 'low-confidence'
  | 'malformed-payload'
  | 'missing-required-field'
  | 'unsupported-value'
  | 'capped-by-policy';

export interface ContractPayloadDiagnosticEntry {
  status: ContractPayloadDiagnosticStatus;
  reason: ContractPayloadDiagnosticReason;
  path: string;
  message: string;
  directiveId?: string;
  observationId?: string;
  confidence?: number;
}

export interface ContractPayloadDiagnostics {
  kind: 'task-interpretation' | 'semantic-relation' | 'semantic-candidate' | 'adherence-evaluation';
  source?: HostProposalSourceInput;
  summary: {
    total: number;
    accepted: number;
    rejected: number;
    downgraded: number;
    unused: number;
  };
  entries: ContractPayloadDiagnosticEntry[];
}

export interface TaskInterpretationCandidateParseResult {
  candidates: import('../interpret/types.ts').ParsedTaskCandidate[];
  diagnostics: ContractPayloadDiagnostics;
}

export interface SemanticProposalValidationInput {
  raw: unknown;
  source: HostProposalSourceInput;
  allowedDirectiveIds?: readonly string[];
  allowedObservationIds?: readonly string[];
}

export interface SemanticProposalValidationResult {
  proposal: HostProposalIR;
  diagnostics: ContractPayloadDiagnostics;
}

export type HostProposalNormalizer = (raw: unknown, source: HostProposalSourceInput) => HostProposalIR;

// --- Adherence Evaluation Contract ---

export type AdherenceVerdict = 'followed' | 'ignored' | 'partial';

export interface AdherenceEvaluationDirectiveSummary {
  id: string;
  description: string;
  prescription: string;
  execution_mode: string;
}

export interface AdherenceEvaluationContractInput {
  directives: AdherenceEvaluationDirectiveSummary[];
  taskDescription: string;
  artifactPath: string;
}

export interface AdherenceEvaluationContractOutput {
  evaluationPrompt: string;
  evaluationSchema: string;
  evaluationArtifact: AIContractArtifact;
  contract: AIContractEnvelope;
}

export interface HostAdherenceVerdictEntry {
  directive_id: string;
  verdict: AdherenceVerdict;
  confidence: number;
  reason: string;
  ignored_reason?: import('../types.ts').IgnoredReason;
}

export interface HostAdherenceEvaluationPayload {
  verdicts: HostAdherenceVerdictEntry[];
}

export interface ValidatedAdherenceVerdict {
  directive_id: string;
  verdict: AdherenceVerdict;
  confidence: number;
  reason: string;
  ignored_reason?: import('../types.ts').IgnoredReason;
}

export interface AdherenceEvaluationValidationResult {
  verdicts: ValidatedAdherenceVerdict[];
  diagnostics: ContractPayloadDiagnostics;
}
