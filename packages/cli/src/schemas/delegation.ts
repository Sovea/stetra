import { z } from 'zod';

import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION } from '../protocol.ts';

export const EVIDENCE_SEMANTIC_IMPACTS = ['none', 'material'] as const;
export const EVIDENCE_CAUSES = ['implementation', 'environment', 'verification', 'unknown'] as const;
export const EVIDENCE_ROUTES = [
  'repair-implementation',
  'revise-verification',
  'challenge',
  'handoff',
  'ask-human',
] as const;
export const CONCLUSION_STATUSES = ['supported', 'partial', 'contradicted', 'unknown'] as const;
export const RECOMMENDATION_ACTIONS = ['accept', 'request-correction', 'reject', 'defer'] as const;
export const HUMAN_DECISION_ACTIONS = ['accepted', 'correction-requested', 'rejected', 'deferred'] as const;
export const VERIFICATION_REVISION_KINDS = ['execution-rebinding', 'verification-plan'] as const;
export const HUMAN_RESOLUTION_ACTIONS = ['continue-current-contract', 'request-correction', 'abort'] as const;

export const StableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const NonEmptyStringSchema = z.string().trim().min(1);
export const SafeRepositoryPathSchema = z.string().min(1).refine((value) =>
  !value.startsWith('/')
  && !/^[A-Za-z]:[\\/]/.test(value)
  && !value.includes('\\')
  && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..'), {
  message: 'must be a safe repository-relative path',
});

const HumanEventInputSchema = z.strictObject({
  content: NonEmptyStringSchema,
  provider: NonEmptyStringSchema.optional(),
  nativeId: NonEmptyStringSchema.optional(),
});

export const HumanEventSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum(['task', 'correction', 'exception', 'decision']),
  content: NonEmptyStringSchema,
  contentFingerprint: Sha256Schema,
  provider: NonEmptyStringSchema.optional(),
  nativeId: NonEmptyStringSchema.optional(),
});

const EvidenceWindowSchema = z.strictObject({
  key: StableIdSchema,
  path: SafeRepositoryPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).refine((value) => value.endLine >= value.startLine, {
  path: ['endLine'],
  message: 'must be greater than or equal to startLine',
});

const CompactBasisSchema = z.strictObject({
  developerEvent: z.boolean(),
  repositoryEvidenceKeys: z.array(StableIdSchema),
});

const ObligationKeyReferenceSchema = z.strictObject({
  conditionKey: StableIdSchema,
  obligationKey: StableIdSchema,
});

const VerificationBaselineSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('task-start'),
    rationale: NonEmptyStringSchema,
    obligationKeys: z.array(ObligationKeyReferenceSchema).min(1),
  }),
  z.strictObject({ mode: z.literal('unknown') }),
]);

export const VerificationDefinitionSchema = z.strictObject({
  key: StableIdSchema,
  rationale: NonEmptyStringSchema,
  argv: z.array(z.string().min(1)).min(1),
  baseline: VerificationBaselineSchema,
  commandDefinitionPaths: z.array(SafeRepositoryPathSchema),
  acceptanceSurfacePaths: z.array(SafeRepositoryPathSchema),
});

const EvidenceObligationStrategySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('runtime-check'),
    checkKeys: z.array(StableIdSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('repository-inspection'),
    repositoryEvidenceKeys: z.array(StableIdSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('independent-challenge'),
    policy: z.enum(['required', 'fact-triggered']),
  }),
  z.strictObject({ kind: z.literal('human-review') }),
]);

const AdoptionConditionSchema = z.strictObject({
  key: StableIdSchema,
  statement: NonEmptyStringSchema,
  rationale: NonEmptyStringSchema,
  criticality: z.enum(['material', 'adoption-critical']),
  basis: CompactBasisSchema.optional(),
  evidenceObligations: z.array(z.strictObject({
    key: StableIdSchema,
    statement: NonEmptyStringSchema,
    failureHypothesis: NonEmptyStringSchema,
    strategies: z.array(EvidenceObligationStrategySchema).min(1),
  })).min(1),
});

const HostPolicyRequirementSchema = z.strictObject({
  key: StableIdSchema,
  capability: z.enum(['web-search', 'network', 'external-mutation', 'fresh-context']),
  requiredState: z.enum(['disabled', 'enabled', 'isolated']),
  enforcementRequirement: z.enum(['required', 'preferred']),
  rationale: NonEmptyStringSchema,
  basis: CompactBasisSchema.optional(),
});

export const DelegationPrepareDocumentSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  prepareRequestId: StableIdSchema,
  developerEvent: HumanEventInputSchema,
  task: z.strictObject({
    desiredOutcome: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    nonGoals: z.array(NonEmptyStringSchema),
    focus: z.array(SafeRepositoryPathSchema),
    unresolvedMaterialFork: z.strictObject({
      question: NonEmptyStringSchema,
      alternatives: z.array(NonEmptyStringSchema).min(2),
      decisionImpact: NonEmptyStringSchema,
    }).optional(),
  }),
  repositoryEvidence: z.array(EvidenceWindowSchema).optional(),
  conditions: z.array(AdoptionConditionSchema),
  hostPolicyRequirements: z.array(HostPolicyRequirementSchema),
  delivery: z.strictObject({
    maxRepairAttempts: z.number().int().min(0).max(5),
  }),
  checks: z.array(VerificationDefinitionSchema).optional(),
  noCommandRationale: NonEmptyStringSchema.optional(),
});

export const EvidenceDispositionDocumentSchema = z.strictObject({
  semanticImpact: z.enum(EVIDENCE_SEMANTIC_IMPACTS),
  proposedRoute: z.enum(EVIDENCE_ROUTES),
  routeRationale: NonEmptyStringSchema,
  entries: z.array(z.strictObject({
    definitionId: Sha256Schema,
    cause: z.enum(EVIDENCE_CAUSES),
    diagnosis: NonEmptyStringSchema,
    falsificationAttempt: NonEmptyStringSchema,
    codeChangeCanAlterObservation: z.boolean(),
    expectedDifferentObservation: NonEmptyStringSchema,
    intendedChanges: z.array(NonEmptyStringSchema),
  })).min(1),
});

const ChallengeEvidenceSchema = z.strictObject({
  changedFiles: z.array(StableIdSchema),
  checks: z.array(Sha256Schema),
  repositoryEvidence: z.array(StableIdSchema),
  humanEvents: z.array(StableIdSchema),
  patch: z.boolean(),
});

const HandoffEvidenceReferenceSchema = z.union([
  z.strictObject({ kind: z.literal('patch') }),
  z.strictObject({
    kind: z.enum(['changed-file', 'check', 'repository-evidence', 'human-event', 'challenge']),
    id: z.string().min(1),
  }),
]);

const ChallengeEvidenceItemSchema = z.strictObject({
  statement: NonEmptyStringSchema,
  references: z.array(HandoffEvidenceReferenceSchema).min(1),
});

export const ChallengeDocumentSchema = z.strictObject({
  obligationIds: z.array(StableIdSchema).min(1),
  failureHypothesis: NonEmptyStringSchema,
  evidence: ChallengeEvidenceSchema,
  falsificationAttempt: NonEmptyStringSchema,
  supportingEvidence: z.array(ChallengeEvidenceItemSchema),
  counterEvidence: z.array(ChallengeEvidenceItemSchema),
  outcome: z.enum(CONCLUSION_STATUSES),
  conclusion: NonEmptyStringSchema,
});

export const CognitiveHandoffDocumentSchema = z.strictObject({
  summary: NonEmptyStringSchema,
  obligationConclusions: z.array(z.strictObject({
    obligationId: StableIdSchema,
    status: z.enum(CONCLUSION_STATUSES),
    evidence: z.array(HandoffEvidenceReferenceSchema),
    falsificationAttempt: NonEmptyStringSchema,
    counterEvidence: z.array(HandoffEvidenceReferenceSchema),
    conclusion: NonEmptyStringSchema,
  })),
  conditionConclusions: z.array(z.strictObject({
    conditionId: StableIdSchema,
    status: z.enum(CONCLUSION_STATUSES),
    summary: NonEmptyStringSchema,
  })),
  importantSystemEffects: z.array(NonEmptyStringSchema),
  residualUnknowns: z.array(z.strictObject({
    conditionIds: z.array(StableIdSchema),
    obligationIds: z.array(StableIdSchema),
    statement: NonEmptyStringSchema,
    adoptionImpact: NonEmptyStringSchema,
    nextAction: NonEmptyStringSchema,
    evidence: z.array(HandoffEvidenceReferenceSchema),
  })),
  reviewQuestions: z.array(z.strictObject({
    conditionIds: z.array(StableIdSchema),
    obligationIds: z.array(StableIdSchema),
    question: NonEmptyStringSchema,
    adoptionImpact: NonEmptyStringSchema,
    evidence: z.array(HandoffEvidenceReferenceSchema),
  })),
  recommendation: z.strictObject({
    action: z.enum(RECOMMENDATION_ACTIONS),
    rationale: NonEmptyStringSchema,
    caveats: z.array(NonEmptyStringSchema),
  }),
});

export const HumanDecisionDocumentSchema = z.strictObject({
  humanEvent: HumanEventInputSchema,
  action: z.enum(HUMAN_DECISION_ACTIONS),
  reason: NonEmptyStringSchema,
  exceptions: z.array(z.strictObject({
    attentionId: StableIdSchema,
    rationale: NonEmptyStringSchema,
  })),
});

export const VerificationRevisionDocumentSchema = z.strictObject({
  kind: z.enum(VERIFICATION_REVISION_KINDS),
  rationale: NonEmptyStringSchema,
  equivalenceClaim: NonEmptyStringSchema,
  checks: z.array(VerificationDefinitionSchema).optional(),
  noCommandRationale: NonEmptyStringSchema.optional(),
  humanAuthorization: HumanEventInputSchema.optional(),
});

export const HumanResolutionDocumentSchema = z.strictObject({
  humanEvent: HumanEventInputSchema,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('semantic-impact'), dispositionId: Sha256Schema }),
    z.strictObject({ kind: z.literal('correction'), decisionId: StableIdSchema }),
    z.strictObject({ kind: z.literal('host-policy'), requirementId: StableIdSchema }),
  ]),
  action: z.enum(HUMAN_RESOLUTION_ACTIONS),
  reason: NonEmptyStringSchema,
});

const PackageIdentitySchema = z.strictObject({
  cli: z.strictObject({ name: z.literal('@sovea/stetra'), version: NonEmptyStringSchema }),
  core: z.strictObject({ name: z.literal('@sovea/stetra-core'), version: NonEmptyStringSchema }),
});

export const HostPolicyEvaluationSchema = z.strictObject({
  requirementId: StableIdSchema,
  mode: z.enum(['enforced', 'instruction-only', 'unsupported']),
  provenance: z.enum(['native-adapter', 'thin-skill', 'evaluation-runner']),
  attestationId: StableIdSchema.optional(),
});

const PendingResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('semantic-impact'), targetId: Sha256Schema }),
  z.strictObject({ kind: z.literal('correction'), targetId: StableIdSchema }),
  z.strictObject({ kind: z.literal('host-policy'), targetId: StableIdSchema }),
]);

export const AttemptProjectionSchema = z.strictObject({
  attemptId: StableIdSchema,
  ordinal: z.number().int().positive(),
  parentAttemptId: StableIdSchema.nullable(),
  effectiveContractId: Sha256Schema,
  trigger: z.enum(['initial', 'repair', 'correction', 'verification-revision']),
  deliveryStatus: z.enum([
    'waiting-for-implementation', 'implementing', 'repairing',
    'implementation-complete', 'exhausted',
  ]),
  createdAt: z.iso.datetime(),
  factCollectionId: Sha256Schema.optional(),
  evidenceDispositionPath: SafeRepositoryPathSchema.optional(),
});

export const TaskProjectionSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  prepareRequestId: StableIdSchema,
  prepareInputFingerprint: Sha256Schema,
  workflow: z.literal('cognitive-adoption'),
  projectRoot: NonEmptyStringSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revision: z.number().int().positive(),
  contractRevision: z.number().int().positive(),
  packageIdentity: PackageIdentitySchema,
  semanticContractId: Sha256Schema,
  verificationPlanId: Sha256Schema,
  effectiveContractId: Sha256Schema,
  planId: Sha256Schema,
  currentAttemptId: StableIdSchema,
  deliveryStatus: z.enum([
    'waiting-for-implementation', 'implementing', 'repairing',
    'implementation-complete', 'exhausted',
  ]),
  evidenceStatus: z.enum([
    'not-collected', 'awaiting-evidence-judgment', 'incomplete',
    'needs-attention', 'facts-stale', 'handoff-ready',
  ]),
  decisionStatus: z.enum([
    'pending', 'correction-requested', 'accepted', 'rejected', 'deferred', 'aborted',
  ]),
  repairCount: z.number().int().nonnegative(),
  attempts: z.array(AttemptProjectionSchema).min(1),
  challengeIds: z.array(StableIdSchema),
  hostPolicyEvaluations: z.array(HostPolicyEvaluationSchema),
  resolvedHostPolicyIds: z.array(StableIdSchema),
  verificationRevised: z.boolean(),
  verificationRevisionIds: z.array(StableIdSchema),
  pendingResolution: PendingResolutionSchema.optional(),
  currentHandoffId: StableIdSchema.optional(),
  currentHandoffFingerprint: Sha256Schema.optional(),
  decisionId: StableIdSchema.optional(),
  terminalAt: z.iso.datetime().optional(),
});

export const TaskEventSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  sequence: z.number().int().positive(),
  eventId: z.uuid(),
  type: z.enum([
    'task-prepared', 'facts-collected', 'timeout-retried', 'evidence-diagnosed',
    'challenge-recorded', 'handoff-evaluated', 'decision-recorded',
    'human-resolution-recorded', 'contract-revised', 'verification-revised',
  ]),
  actor: z.enum(['human', 'agent', 'runtime']),
  occurredAt: z.iso.datetime(),
  priorRevision: z.number().int().nonnegative(),
  resultingRevision: z.number().int().positive(),
  artifactRefs: z.array(SafeRepositoryPathSchema),
  projection: TaskProjectionSchema,
});

export type DelegationPrepareDocument = z.infer<typeof DelegationPrepareDocumentSchema>;
export type EvidenceDispositionDocument = z.infer<typeof EvidenceDispositionDocumentSchema>;
export type ChallengeDocument = z.infer<typeof ChallengeDocumentSchema>;
export type CognitiveHandoffDocument = z.infer<typeof CognitiveHandoffDocumentSchema>;
export type HumanDecisionDocument = z.infer<typeof HumanDecisionDocumentSchema>;
export type VerificationRevisionDocument = z.infer<typeof VerificationRevisionDocumentSchema>;
export type HumanResolutionDocument = z.infer<typeof HumanResolutionDocumentSchema>;
export type TaskProjection = z.infer<typeof TaskProjectionSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
