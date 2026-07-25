import type { DirectiveExample, ExecutionMode } from '../types.ts';
import type { GuidanceMode, NormalizedTaskContext, TaskContextInput } from '../task/types.ts';

export const DECISION_SCHEMA_VERSION = '1.0' as const;

export type RelationProposalKind = 'supports' | 'conflicts' | 'limits';

export interface RelationProposal {
  directiveId: string;
  observationId: string;
  relation: RelationProposalKind;
  rationale: string;
  evidenceRefs: string[];
  confidence?: number;
}

export interface CompileChangeInput {
  projectRoot: string;
  builtinRoot: string;
  localAugmentPath?: string;
  rcclPath?: string;
  task: TaskContextInput;
  mode?: GuidanceMode;
  relationProposals?: RelationProposal[];
}

export interface InterpretationRequest {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  status: 'needs-interpretation';
  task: NormalizedTaskContext;
  reasons: string[];
  requiredFields: Array<'changeType' | 'targets' | 'uncertainties'>;
}

export type VerificationKind = 'static' | 'command' | 'diff' | 'semantic';

export interface VerificationRequirement {
  kind: VerificationKind;
  description: string;
  commandId?: string;
}

export interface GuidanceSource {
  kind: 'builtin-playbook' | 'local-playbook' | 'rccl' | 'task';
  id: string;
  path?: string;
  evidenceRefs?: string[];
}

export interface GuidanceItem {
  id: string;
  instruction: string;
  rationale: string;
  exceptions: string[];
  source: GuidanceSource;
  relevance: string;
  executionMode: ExecutionMode;
  verification: VerificationRequirement[];
  examples: DirectiveExample[];
}

export interface AvoidGuidanceItem {
  id: string;
  pattern: string;
  rationale: string;
  exceptions: string[];
  source: GuidanceSource;
  verification: VerificationRequirement[];
}

export interface DecisionTension {
  id: string;
  directiveId: string;
  observationId: string;
  conflict: string;
  resolution: string;
  evidenceRefs: string[];
  proposedBy: 'host-agent' | 'runtime-structural' | 'feedback' | 'multi-source';
}

export interface EffectiveGuidance {
  required: GuidanceItem[];
  consider: GuidanceItem[];
  avoid: AvoidGuidanceItem[];
  tensions: DecisionTension[];
}

export interface VerificationPlan {
  commands: Array<{ id: string; reason: string }>;
  semanticChecks: Array<{ guidanceId: string; description: string }>;
}

export interface DecisionDiagnostic {
  code:
    | 'GUIDANCE_BUDGET_TRIMMED'
    | 'RELATION_PROPOSAL_REJECTED'
    | 'RELATION_PROPOSAL_DOWNGRADED'
    | 'RCCL_NOT_LOADED'
    | 'RCCL_NO_DECISION_IMPACT';
  message: string;
  ids?: string[];
}

export interface DecisionTrace {
  selectedLayers: string[];
  activatedDirectiveIds: string[];
  deliveredGuidanceIds: string[];
  suppressedDirectiveIds: string[];
  relevantObservationIds: string[];
  observationEvidence: Array<{
    observationId: string;
    status: string;
    disposition: string;
    verifiedCount: number;
    totalCount: number;
    action: 'reverified' | 'reused';
  }>;
  relationDecisions: Array<{
    directiveId: string;
    observationId: string;
    relation: string;
    status: 'accepted' | 'rejected' | 'downgraded';
    impact: string;
    reason: string;
    rationale: string;
    evidenceRefs: string[];
    confidence: number | null;
    proposedBy: string;
  }>;
  omissions: Array<{
    id: string;
    section: 'required' | 'consider' | 'avoid' | 'tensions';
    reason: 'section-limit' | 'character-limit' | 'suppressed';
  }>;
  diagnostics: DecisionDiagnostic[];
}

export interface ChangeDecisionPacket {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  decisionId: string;
  status: 'compiled' | 'needs-attention';
  mode: GuidanceMode;
  task: NormalizedTaskContext;
  guidance: EffectiveGuidance;
  verificationPlan: VerificationPlan;
  trace: DecisionTrace;
  fingerprints: {
    task: string;
    directives: string;
    observations: string;
    relations: string;
  };
}

export type CompileChangeOutput = ChangeDecisionPacket | InterpretationRequest;
