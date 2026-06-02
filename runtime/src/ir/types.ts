import type {
  AdherenceQuality,
  ContextProfile,
  DirectiveExample,
  DirectiveType,
  ExecutionMode,
  FeedbackSignalConfidence,
  IgnoredReason,
  Operation,
  Prescription,
  RcclEvidence,
  RcclLifecycleStatus,
  RcclObservation,
  ScopeBasis,
  TaskKind,
  VerificationDisposition,
  VerificationStatus,
  Weight,
} from '../types.ts';

export type GovernanceIRVersion = 'governance-ir/v1';
export const GOVERNANCE_IR_VERSION: GovernanceIRVersion = 'governance-ir/v1';

export interface SourceRefIR {
  kind: 'builtin-playbook' | 'local-playbook' | 'rccl' | 'task-input' | 'lockfile' | 'host-proposal' | 'runtime';
  id: string;
  path?: string;
  version?: string;
  fingerprint?: string;
}

export interface SourceManifestIR {
  builtinRoot: string;
  selectedLayers: string[];
  localAugmentPath?: string;
  rcclPath?: string;
  lockfilePath?: string;
  projectRoot: string;
  sources: SourceRefIR[];
}

export interface IRFingerprintSet {
  task: string;
  directives: string;
  observations: string;
  feedback: string;
  hostProposals: string;
  bundle: string;
}

export interface ScopeIR {
  path: string;
}

export interface LayerIR {
  id: string;
  rank: number;
}

export interface DirectivePriorityIR {
  layerRank: number;
  prescriptionRank: number;
  weightRank: number;
  localOverrideRank: number;
}

export interface DirectiveTraitsIR {
  rcclImmune: boolean;
  safetyCritical: boolean;
  broadScope: boolean;
  compatibilitySensitive: boolean;
  migrationSensitive: boolean;
}

export interface DirectiveLocalStateIR {
  overrideApplied: boolean;
  augmentApplied: boolean;
  suppressed: boolean;
  suppressionReason?: string;
}

export interface DirectiveIR {
  irVersion: GovernanceIRVersion;
  id: string;
  semanticKey: string;
  source: SourceRefIR;
  layer: LayerIR;
  scope: ScopeIR;
  kind: DirectiveType;
  prescription: Prescription;
  weight: Weight;
  priority: DirectivePriorityIR;
  body: {
    description: string;
    rationale: string;
    exceptions: string[];
    examples: DirectiveExample[];
  };
  traits: DirectiveTraitsIR;
  local: DirectiveLocalStateIR;
}

export interface EvidenceIR extends RcclEvidence {}

export interface ObservationTraitsIR {
  legacy: boolean;
  migrationBoundary: boolean;
  antiPattern: boolean;
  compatibilityBoundary: boolean;
}

export interface ObservationIR {
  irVersion: GovernanceIRVersion;
  id: string;
  semanticKey: string;
  source: SourceRefIR;
  category: RcclObservation['category'];
  scope: ScopeIR;
  pattern: string;
  adherence: {
    quality: AdherenceQuality;
    confidence: number;
  };
  evidence: EvidenceIR[];
  support: {
    sourceSlices: string[];
    fileCount: number;
    clusterCount: number;
    scopeBasis: ScopeBasis;
  };
  verification: {
    evidenceStatus: VerificationStatus | 'pending';
    evidenceVerifiedCount: number;
    evidenceConfidence: number;
    inductionStatus: NonNullable<RcclObservation['verification']['induction_status']> | 'pending';
    inductionConfidence: number;
    checkedAt: string | null;
    disposition: VerificationDisposition;
  };
  lifecycle: {
    firstSeenGitRef: string | null;
    lastSeenGitRef: string | null;
    lastVerifiedAt: string | null;
    contentFingerprint: string | null;
    status: RcclLifecycleStatus | 'unknown';
    supersedes: string[];
    supersededBy: string | null;
  };
  traits: ObservationTraitsIR;
}

export interface TargetIR {
  path: string;
  role: 'target' | 'changed';
}

export interface FieldProvenanceIR {
  field: string;
  source: string;
  confidence: number;
}

export interface TaskIR {
  irVersion: GovernanceIRVersion;
  id: string;
  kind: TaskKind;
  operation: Operation;
  targetLayer: string;
  targets: TargetIR[];
  techStack: string[];
  tags: string[];
  context: ContextProfile;
  provenance: FieldProvenanceIR[];
  unresolved: string[];
  diagnostics: {
    clarificationRecommended: boolean;
    ambiguityReasons: string[];
  };
}

export interface DirectiveFeedbackSignalIR {
  directiveId: string;
  followed: number;
  ignored: number;
  followRate: number;
  trend: 'improving' | 'stable' | 'degrading';
  signalConfidence: FeedbackSignalConfidence;
  ignoredReasons: Partial<Record<IgnoredReason, number>>;
  lastIgnoredReason?: IgnoredReason;
  lastSeen: string;
}

export interface ObservationFeedbackSignalIR {
  observationId: string;
  seenCount: number;
  relationCount: number;
  activeSeenCount: number;
  staleSeenCount: number;
  supersededSeenCount: number;
  lastDisposition: VerificationDisposition | 'pending';
  lastLifecycleStatus: RcclLifecycleStatus | 'unknown';
  lastContentFingerprint: string | null;
  lastSeen: string;
}

export interface TensionFeedbackSignalIR {
  tensionKey: string;
  seenCount: number;
  directiveId: string;
  observationId: string;
  lastExecutionMode: ExecutionMode;
  lastSeen: string;
}

export interface FeedbackIR {
  irVersion: GovernanceIRVersion;
  source: SourceRefIR;
  directiveSignals: DirectiveFeedbackSignalIR[];
  observationSignals: ObservationFeedbackSignalIR[];
  tensionSignals: TensionFeedbackSignalIR[];
  globalSummary: {
    totalTasks: number;
    byTaskType: Record<string, number>;
    noisyDirectiveIds: string[];
    frequentlyIgnoredDirectiveIds: string[];
    recurringTensionKeys: string[];
  };
}

export type SemanticRelationKindIR = 'reinforce' | 'tension' | 'suppress' | 'ambient-only' | 'unrelated';
export type SemanticRelationSignalDirectionIR = 'reinforce' | 'tension' | 'suppress' | 'ambient' | 'neutral';
export type SemanticRelationImpactIR = 'execution-mode' | 'review-focus' | 'ambient-context' | 'no-effect';
export type SemanticRelationReviewPriorityIR = 'low' | 'normal' | 'high' | 'critical';
export type SemanticRelationProposedByIR = 'runtime-structural' | 'host-agent' | 'feedback' | 'multi-source';
export type SemanticRelationExecutionIntentIR = ExecutionMode | 'no-change';

export interface SemanticRelationSignalIR {
  kind: 'semantic-key' | 'category' | 'scope' | 'verification' | 'lifecycle' | 'feedback' | 'host-proposal';
  strength: 'weak' | 'moderate' | 'strong';
  direction: SemanticRelationSignalDirectionIR;
  reason: string;
}

export interface HostSemanticRelationProposal {
  directive_id: string;
  observation_id: string;
  relation: SemanticRelationKindIR;
  confidence: number;
  reason: string;
  conflict_class?: 'compatibility-boundary' | 'migration-tension' | 'local-deviation' | 'legacy-interface' | 'anti-pattern' | 'scope-mismatch' | 'style-drift' | 'architecture-drift';
  evidence_refs?: string[];
  signals?: SemanticRelationSignalIR[];
  impact?: SemanticRelationImpactIR;
  review_priority?: SemanticRelationReviewPriorityIR;
  merge_intent?: string;
  group_id?: string;
}

export interface HostSemanticRelationProposalPayload {
  relations: HostSemanticRelationProposal[];
}

export type HostSemanticCandidateHintIR = 'reinforce' | 'tension' | 'ambient-only' | 'unknown';

export interface HostSemanticCandidateProposal {
  directive_id: string;
  observation_id: string;
  relation_hint: HostSemanticCandidateHintIR;
  confidence: number;
  reason: string;
  evidence_refs?: string[];
  impact?: SemanticRelationImpactIR;
  review_priority?: SemanticRelationReviewPriorityIR;
  merge_intent?: string;
  group_id?: string;
}

export interface HostSemanticCandidateProposalPayload {
  candidates: HostSemanticCandidateProposal[];
}

export interface SemanticRelationIR {
  irVersion: GovernanceIRVersion;
  id: string;
  directiveId: string;
  observationId: string;
  proposedBy: SemanticRelationProposedByIR;
  relation: SemanticRelationKindIR;
  conflictClass?: HostSemanticRelationProposal['conflict_class'];
  confidence: number;
  basis: {
    scope: boolean;
    semanticKey: boolean;
    category: boolean;
    evidence: boolean;
    hostReasoning: boolean;
    feedback: boolean;
  };
  signals: SemanticRelationSignalIR[];
  evidenceRefs: string[];
  reasoningSummary: string;
  impact?: SemanticRelationImpactIR;
  reviewPriority?: SemanticRelationReviewPriorityIR;
  executionIntent?: SemanticRelationExecutionIntentIR;
  mergeIntent?: string;
  groupId?: string;
  adjudication: {
    status: 'accepted' | 'rejected' | 'downgraded';
    finalRelation: SemanticRelationIR['relation'];
    reason: string;
  };
}

export interface ActivationDecisionIR {
  directiveId: string;
  layerId: string;
  sourcePath?: string;
  status: 'activated' | 'skipped';
  reason: 'matched' | 'suppressed-by-local' | 'layer-mismatch' | 'scope-mismatch';
  note: string;
  effectivePrescription: Prescription;
  effectiveWeight: Weight;
  priority: DirectivePriorityIR;
  localState: DirectiveLocalStateIR;
}

export interface HostProposalIR {
  irVersion: GovernanceIRVersion;
  source: SourceRefIR;
  kind: 'semantic-governance-graph' | 'review-outcome' | 'governance-evolution-proposal';
  payload: unknown;
}

export interface GovernanceIRBundle {
  irVersion: GovernanceIRVersion;
  task: TaskIR;
  directives: DirectiveIR[];
  observations: ObservationIR[];
  feedback: FeedbackIR;
  hostProposals: HostProposalIR[];
  sourceManifest: SourceManifestIR;
  fingerprints: IRFingerprintSet;
}

export interface ExecutionDecisionIR {
  directiveId: string;
  mode: ExecutionMode;
  defaultMode: ExecutionMode;
  basis: 'prescription' | 'governance-graph' | 'verification' | 'task-context' | 'feedback' | 'anti-pattern';
  relationIds: string[];
  contextApplied: string[];
  contextRulesApplied: string[];
  feedbackApplied: string[];
  reason: string;
}
