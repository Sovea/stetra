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
}

export interface CompileChangeInput {
  projectRoot: string;
  builtinRoot: string;
  localAugmentPath?: string;
  personalOverlayPath?: string;
  rcclPath?: string;
  task: TaskContextInput;
  mode?: GuidanceMode;
  relationProposals?: RelationProposal[];
  guidanceByteLimit?: number;
  deliverySelection?: GuidanceDeliverySelection;
}

export interface GuidanceDeliverySelection {
  considerIds: string[];
  rationale: string;
}

export interface InterpretationRequest {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  status: 'needs-interpretation';
  task: NormalizedTaskContext;
  reasons: string[];
  requiredFields: Array<'changeType' | 'targets' | 'uncertainties'>;
}

export type VerificationKind = 'command' | 'diff' | 'semantic';

export interface VerificationRequirement {
  kind: VerificationKind;
  description?: string;
  commandId?: string;
}

export interface GuidanceSource {
  kind: 'builtin-playbook' | 'local-playbook' | 'personal-playbook' | 'rccl' | 'task';
  id: string;
}

export interface GuidanceItem {
  id: string;
  instruction: string;
  exceptions: string[];
  source: GuidanceSource;
  executionMode: ExecutionMode;
  verification: VerificationRequirement[];
  example?: DirectiveExample;
  exampleSource?: GuidanceSource;
}

export interface AvoidGuidanceItem {
  id: string;
  pattern: string;
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
}

export interface EffectiveGuidance {
  required: GuidanceItem[];
  consider: GuidanceItem[];
  avoid: AvoidGuidanceItem[];
  tensions: DecisionTension[];
}

export interface ExecutionGuidanceItem {
  id: string;
  instruction: string;
  exceptions: string[];
  executionMode: ExecutionMode;
  example?: DirectiveExample;
}

export interface ExecutionAvoidGuidanceItem {
  id: string;
  pattern: string;
  exceptions: string[];
}

export interface ExecutionGuidance {
  required: ExecutionGuidanceItem[];
  consider: ExecutionGuidanceItem[];
  avoid: ExecutionAvoidGuidanceItem[];
  tensions: DecisionTension[];
}

export interface VerificationPlan {
  commands: Array<{ id: string; reason: string }>;
  semanticChecks: Array<{ guidanceId: string; description: string }>;
}

export interface DecisionDiagnostic {
  code:
    | 'GUIDANCE_SELECTION_APPLIED'
    | 'RELATION_PROPOSAL_REJECTED'
    | 'RELATION_PROPOSAL_DOWNGRADED'
    | 'RCCL_NOT_LOADED'
    | 'RCCL_NO_DECISION_IMPACT';
  message: string;
  ids?: string[];
}

export interface GuidanceDetail {
  id: string;
  section: 'required' | 'consider' | 'avoid' | 'tension';
  rationale: string;
  relevance: string;
  source: {
    kind: GuidanceSource['kind'];
    id: string;
    logicalPath?: string;
    evidenceRefs?: string[];
  };
  contributors: Array<{
    kind: GuidanceSource['kind'];
    id: string;
    logicalPath?: string;
  }>;
  examples: DirectiveExample[];
}

export interface DecisionTrace {
  selectedLayers: string[];
  playbookSources: {
    team: 'present' | 'absent';
    personal: 'present' | 'absent';
  };
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
    proposedBy: string;
  }>;
  guidanceDetails: GuidanceDetail[];
  delivery: {
    byteLimit: number;
    deliveredBytes: number;
    mandatoryBytes: number;
    fullGuidanceBytes: number;
    fullPacketBytes: number;
    selection: GuidanceDeliverySelection | null;
  };
  omissions: Array<{
    id: string;
    section: 'required' | 'consider' | 'avoid' | 'tensions';
    reason: 'host-selection' | 'suppressed';
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
  executionGuidance: ExecutionGuidance;
  verificationPlan: VerificationPlan;
  trace: DecisionTrace;
  fingerprints: {
    task: string;
    directives: string;
    observations: string;
    relations: string;
    delivery: string;
  };
}

export interface GuidanceOverflow {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  status: 'guidance-overflow';
  mode: GuidanceMode;
  task: NormalizedTaskContext;
  byteLimit: number;
  totalBytes: number;
  mandatoryBytes: number;
  fullGuidanceBytes: number;
  mandatoryGuidanceIds: string[];
  mandatoryGuidance: {
    required: ExecutionGuidanceItem[];
    avoid: ExecutionAvoidGuidanceItem[];
    tensions: DecisionTension[];
  };
  selectableConsider: Array<{
    id: string;
    instruction: string;
    exceptions: string[];
    executionMode: ExecutionMode;
    example?: DirectiveExample;
    bytes: number;
    source: GuidanceSource;
  }>;
  candidateDetails: GuidanceDetail[];
  diagnostics: DecisionDiagnostic[];
  selection: GuidanceDeliverySelection | null;
  reasons: string[];
}

export type CompileChangeOutput = ChangeDecisionPacket | InterpretationRequest | GuidanceOverflow;
