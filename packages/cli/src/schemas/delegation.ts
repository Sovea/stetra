import { z } from 'zod';

import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION } from '../protocol.ts';

export const EVIDENCE_CAUSES = ['implementation', 'environment', 'verification', 'unknown'] as const;
export const CONCLUSION_STATUSES = ['supported', 'partial', 'contradicted', 'unknown'] as const;
export const EVIDENCE_COVERAGE_STATUSES = ['sufficient', 'insufficient'] as const;
export const EVIDENCE_CONTRACT_IMPACTS = ['unchanged', 'material'] as const;
export const WITHIN_CONTRACT_ACTIONS = [
  'repair-delivery', 'revise-verification', 'handoff',
] as const;
export const RECOMMENDATION_ACTIONS = ['accept', 'request-correction', 'reject', 'defer'] as const;
export const HUMAN_DECISION_ACTIONS = ['accepted', 'correction-requested', 'rejected', 'deferred'] as const;
export const VERIFICATION_REVISION_KINDS = ['execution-rebinding', 'verification-plan'] as const;
export const HUMAN_RESOLUTION_ACTIONS = [
  'continue-current-contract',
  'request-correction',
  'abort',
] as const;

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

const DeveloperEventInputSchema = z.strictObject({
  key: StableIdSchema,
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

const EvidenceRangeSchema = z.strictObject({
  key: StableIdSchema,
  path: SafeRepositoryPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).refine((value) => value.endLine >= value.startLine, {
  path: ['endLine'],
  message: 'must be greater than or equal to startLine',
});

const WholeFileEvidenceSchema = z.strictObject({
  key: StableIdSchema,
  path: SafeRepositoryPathSchema,
  wholeFile: z.literal(true),
});

const EvidenceWindowSchema = z.union([EvidenceRangeSchema, WholeFileEvidenceSchema]);

const CompactBasisSchema = z.strictObject({
  developerEventKeys: z.array(StableIdSchema),
  repositoryEvidenceKeys: z.array(StableIdSchema),
});

const MaterialDecisionForkSchema = z.strictObject({
  key: StableIdSchema,
  basis: CompactBasisSchema,
  question: NonEmptyStringSchema,
  alternatives: z.array(z.strictObject({
    key: StableIdSchema,
    statement: NonEmptyStringSchema,
    impact: NonEmptyStringSchema,
  })).min(2),
  recommendation: z.strictObject({
    alternativeKey: StableIdSchema,
    rationale: NonEmptyStringSchema,
  }).optional(),
  resolution: z.strictObject({
    humanEventKey: StableIdSchema,
    selectedAlternativeKey: StableIdSchema.optional(),
    decisionInterpretation: NonEmptyStringSchema,
  }).optional(),
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
    expectation: z.strictObject({
      baselineStatus: z.enum(['passed', 'failed', 'unavailable']),
      currentStatus: z.enum(['passed', 'failed', 'unavailable']),
    }),
  }),
  z.strictObject({ mode: z.literal('unknown') }),
]);

const AuthoredVerificationBaselineSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('task-start'),
    rationale: NonEmptyStringSchema,
    expectation: z.strictObject({
      baselineStatus: z.enum(['passed', 'failed', 'unavailable']),
      currentStatus: z.enum(['passed', 'failed', 'unavailable']),
    }),
  }),
  z.strictObject({ mode: z.literal('unknown') }),
]);

export const VerificationDefinitionSchema = z.strictObject({
  key: StableIdSchema,
  rationale: NonEmptyStringSchema,
  execution: z.strictObject({
    preparation: z.array(z.strictObject({
      key: StableIdSchema,
      argv: z.array(z.string().min(1)).min(1),
    })),
    assertion: z.strictObject({
      argv: z.array(z.string().min(1)).min(1),
    }),
  }),
  executionInputs: z.array(z.strictObject({
    kind: z.enum(['file', 'tree']),
    path: SafeRepositoryPathSchema,
  })),
  baseline: VerificationBaselineSchema,
  verifierSelectors: z.array(z.strictObject({
    kind: z.enum(['file', 'tree']),
    path: SafeRepositoryPathSchema,
    role: z.enum(['command-definition', 'acceptance-surface']),
  })),
});

export const AuthoredVerificationDefinitionSchema = VerificationDefinitionSchema.extend({
  execution: z.strictObject({
    preparation: z.array(z.strictObject({
      argv: z.array(z.string().min(1)).min(1),
    })),
    assertion: z.strictObject({
      argv: z.array(z.string().min(1)).min(1),
    }),
  }),
});

const PrepareVerificationDefinitionSchema = AuthoredVerificationDefinitionSchema.extend({
  baseline: AuthoredVerificationBaselineSchema,
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
]);

const FalsificationDesignSchema = z.strictObject({
  failureHypothesis: NonEmptyStringSchema,
  scenario: NonEmptyStringSchema,
  supportingObservation: NonEmptyStringSchema,
  contradictingObservation: NonEmptyStringSchema,
});

const AdoptionConditionSchema = z.strictObject({
  key: StableIdSchema,
  statement: NonEmptyStringSchema,
  rationale: NonEmptyStringSchema,
  criticality: z.enum(['material', 'adoption-critical']),
  basis: CompactBasisSchema.optional(),
  evidenceObligations: z.array(z.strictObject({
    key: StableIdSchema,
    statement: NonEmptyStringSchema,
    falsification: FalsificationDesignSchema,
    strategies: z.array(EvidenceObligationStrategySchema).min(1),
  })).min(1),
});

const AssuranceDeclarationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('routine'),
    rationale: NonEmptyStringSchema,
    basis: CompactBasisSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('conditioned'),
    conditions: z.array(AdoptionConditionSchema).min(1),
  }),
]);

const HostPolicyRequirementSchema = z.strictObject({
  key: StableIdSchema,
  capability: z.enum(['web-search', 'network', 'external-mutation', 'fresh-context']),
  requiredState: z.enum(['disabled', 'enabled', 'isolated']),
  enforcementRequirement: z.enum(['required', 'preferred']),
  rationale: NonEmptyStringSchema,
  basis: CompactBasisSchema.optional(),
});

const TimeoutRetryBudgetSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('disabled') }),
  z.strictObject({
    mode: z.literal('bounded'),
    maxRetriesPerVerifier: z.number().int().min(1).max(5),
    maxTimeoutMs: z.number().int().min(1_000).max(3_600_000),
  }),
]);

const ExecutionBudgetSchema = z.strictObject({
  checkTimeoutMs: z.number().int().min(1_000).max(3_600_000),
  maxDeliveryRepairs: z.number().int().min(0).max(5),
  timeoutRetry: TimeoutRetryBudgetSchema,
}).superRefine((budget, context) => {
  if (budget.timeoutRetry.mode === 'bounded'
    && budget.timeoutRetry.maxTimeoutMs <= budget.checkTimeoutMs) {
    context.addIssue({
      code: 'custom',
      path: ['timeoutRetry', 'maxTimeoutMs'],
      message: 'Bounded timeout retry must allow more time than the initial check attempt.',
    });
  }
});

export const DelegationPrepareDocumentSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  prepareRequestId: StableIdSchema,
  developerEvents: z.array(DeveloperEventInputSchema).min(1),
  task: z.strictObject({
    basis: CompactBasisSchema,
    desiredOutcome: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    nonGoals: z.array(NonEmptyStringSchema),
    focus: z.array(SafeRepositoryPathSchema),
  }),
  materialDecisionForks: z.array(MaterialDecisionForkSchema),
  repositoryEvidence: z.array(EvidenceWindowSchema).optional(),
  assurance: AssuranceDeclarationSchema,
  hostPolicyRequirements: z.array(HostPolicyRequirementSchema),
  executionBudget: ExecutionBudgetSchema,
  checks: z.array(PrepareVerificationDefinitionSchema).optional(),
  noCommandRationale: NonEmptyStringSchema.optional(),
});

const EvidenceConcernSourceSchema = z.strictObject({
  kind: z.literal('check'),
  definitionId: Sha256Schema,
  observation: z.enum(['current-nonpassing', 'baseline-expectation-mismatch']),
});

const DiagnosisEntryBase = {
  source: EvidenceConcernSourceSchema,
  diagnosis: NonEmptyStringSchema,
  falsificationAttempt: NonEmptyStringSchema,
  expectedDifferentObservation: NonEmptyStringSchema,
};

const DiagnosisEntrySchema = z.strictObject({
  ...DiagnosisEntryBase,
  cause: z.enum(EVIDENCE_CAUSES),
  repositoryChange: z.strictObject({
    surface: z.enum(['production', 'verification-surface', 'none']),
    intendedChanges: z.array(NonEmptyStringSchema),
  }),
}).superRefine((value, context) => {
  const surfaceAllowed = value.cause === 'implementation'
    ? value.repositoryChange.surface === 'production'
    : value.cause === 'verification'
      ? ['verification-surface', 'none'].includes(value.repositoryChange.surface)
      : value.repositoryChange.surface === 'none';
  if (!surfaceAllowed) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryChange', 'surface'],
      message: `must match the declared ${value.cause} cause`,
    });
  }
  if (value.repositoryChange.surface === 'none' && value.repositoryChange.intendedChanges.length) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryChange', 'intendedChanges'],
      message: 'must be empty when repositoryChange.surface is none',
    });
  }
  if (value.repositoryChange.surface !== 'none' && !value.repositoryChange.intendedChanges.length) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryChange', 'intendedChanges'],
      message: 'must name at least one intended change when a repository surface is selected',
    });
  }
});

const WithinContractActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('repair-delivery'), rationale: NonEmptyStringSchema }),
  z.strictObject({ kind: z.literal('revise-verification'), rationale: NonEmptyStringSchema }),
  z.strictObject({ kind: z.literal('handoff'), rationale: NonEmptyStringSchema }),
]);

export const EvidenceDispositionDocumentSchema = z.discriminatedUnion('contractImpact', [
  z.strictObject({
    contractImpact: z.literal('unchanged'),
    entries: z.array(DiagnosisEntrySchema).min(1),
    action: WithinContractActionSchema,
  }),
  z.strictObject({
    contractImpact: z.literal('material'),
    impact: NonEmptyStringSchema,
    entries: z.array(DiagnosisEntrySchema).min(1),
    action: z.strictObject({ kind: z.literal('ask-human'), rationale: NonEmptyStringSchema }),
  }),
]);

const HandoffEvidenceReferenceSchema = z.union([
  z.strictObject({ kind: z.literal('patch') }),
  z.strictObject({
    kind: z.literal('changed-file'),
    path: SafeRepositoryPathSchema,
  }),
  z.strictObject({
    kind: z.literal('check'),
    key: StableIdSchema,
  }),
  z.strictObject({
    kind: z.enum(['repository-evidence', 'human-event']),
    id: StableIdSchema,
  }),
]);

export const EvidenceCoverageAssessmentSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('sufficient'),
    rationale: NonEmptyStringSchema,
    gaps: z.array(z.never()).length(0),
  }),
  z.strictObject({
    status: z.literal('insufficient'),
    rationale: NonEmptyStringSchema,
    gaps: z.array(NonEmptyStringSchema).min(1),
  }),
]);

const HandoffFindingBase = {
  obligationKey: StableIdSchema,
  reviewDecisionKeys: z.array(StableIdSchema),
  evidence: z.array(HandoffEvidenceReferenceSchema),
  falsification: z.strictObject({
    attempt: NonEmptyStringSchema,
    observedResult: NonEmptyStringSchema,
  }),
  counterEvidence: z.array(HandoffEvidenceReferenceSchema),
  conclusion: NonEmptyStringSchema,
};

const HandoffObligationFindingSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...HandoffFindingBase,
    status: z.literal('supported'),
    evidenceCoverage: z.strictObject({
      status: z.literal('sufficient'),
      rationale: NonEmptyStringSchema,
      gaps: z.array(z.never()).length(0),
    }),
  }),
  ...(['partial', 'contradicted', 'unknown'] as const).map((status) => z.strictObject({
    ...HandoffFindingBase,
    status: z.literal(status),
    evidenceCoverage: EvidenceCoverageAssessmentSchema,
    reviewDecisionKeys: z.array(StableIdSchema).min(1),
  })),
]);

const HandoffConditionFindingSchema = z.discriminatedUnion('status', [
  z.strictObject({
    conditionKey: StableIdSchema,
    status: z.literal('supported'),
    summary: NonEmptyStringSchema,
    obligations: z.array(HandoffObligationFindingSchema).min(1),
    reviewDecisionKeys: z.array(StableIdSchema),
  }),
  ...(['partial', 'contradicted', 'unknown'] as const).map((status) => z.strictObject({
    conditionKey: StableIdSchema,
    status: z.literal(status),
    summary: NonEmptyStringSchema,
    obligations: z.array(HandoffObligationFindingSchema).min(1),
    reviewDecisionKeys: z.array(StableIdSchema).min(1),
  })),
]);

const HandoffReviewDecisionSchema = z.strictObject({
  key: StableIdSchema,
  conditionKeys: z.array(StableIdSchema),
  obligationKeys: z.array(z.strictObject({
    conditionKey: StableIdSchema,
    obligationKey: StableIdSchema,
  })),
  question: NonEmptyStringSchema,
  adoptionImpact: NonEmptyStringSchema,
  nextAction: NonEmptyStringSchema,
  evidence: z.array(HandoffEvidenceReferenceSchema),
});

export const CognitiveHandoffDocumentSchema = z.strictObject({
  actualChange: z.strictObject({
    behavior: NonEmptyStringSchema,
    mechanism: z.array(NonEmptyStringSchema).min(1),
    preservedInvariants: z.array(NonEmptyStringSchema),
    failureAndRecovery: z.array(NonEmptyStringSchema),
    importantEffects: z.array(NonEmptyStringSchema),
    materialTradeoffs: z.array(NonEmptyStringSchema),
  }),
  conditions: z.array(HandoffConditionFindingSchema),
  residualUnknowns: z.array(z.strictObject({
    target: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('task') }),
      z.strictObject({
        kind: z.literal('condition'),
        conditionKey: StableIdSchema,
      }),
      z.strictObject({
        kind: z.literal('obligation'),
        conditionKey: StableIdSchema,
        obligationKey: StableIdSchema,
      }),
    ]),
    statement: NonEmptyStringSchema,
    evidence: z.array(HandoffEvidenceReferenceSchema),
    reviewDecisionKeys: z.array(StableIdSchema).min(1),
  })),
  reviewDecisions: z.array(HandoffReviewDecisionSchema),
  recommendation: z.strictObject({
    action: z.enum(RECOMMENDATION_ACTIONS),
    rationale: NonEmptyStringSchema,
    caveats: z.array(NonEmptyStringSchema),
  }),
});

export interface TaskSpecificHandoffCondition {
  key: string;
  critical: boolean;
  allowedStatuses: readonly (typeof CONCLUSION_STATUSES)[number][];
  obligations: Array<{
    key: string;
    allowedStatuses: readonly (typeof CONCLUSION_STATUSES)[number][];
  }>;
}

export function taskSpecificCognitiveHandoffDocumentSchema(input: {
  conditions: TaskSpecificHandoffCondition[];
  recommendationActions: readonly (typeof RECOMMENDATION_ACTIONS)[number][];
}): z.ZodType<CognitiveHandoffDocument> {
  const conditionSchemas = input.conditions.map((condition) => {
    const obligationSchemas = condition.obligations.map((obligation) =>
      obligationFindingSchema(obligation.key, obligation.allowedStatuses));
    const obligations = z.tuple(obligationSchemas as []);
    const variants = condition.allowedStatuses.map((status) => {
      return z.strictObject({
        conditionKey: z.literal(condition.key),
        status: z.literal(status),
        summary: NonEmptyStringSchema,
        reviewDecisionKeys: status === 'supported' && !condition.critical
          ? z.array(StableIdSchema)
          : z.array(StableIdSchema).min(1),
        obligations,
      });
    });
    return z.discriminatedUnion(
      'status',
      variants as unknown as Parameters<typeof z.discriminatedUnion>[1],
    );
  });
  return z.strictObject({
    actualChange: CognitiveHandoffDocumentSchema.shape.actualChange,
    conditions: z.tuple(conditionSchemas as []),
    residualUnknowns: CognitiveHandoffDocumentSchema.shape.residualUnknowns,
    reviewDecisions: CognitiveHandoffDocumentSchema.shape.reviewDecisions,
    recommendation: z.strictObject({
      action: z.enum(input.recommendationActions as [string, ...string[]]),
      rationale: NonEmptyStringSchema,
      caveats: z.array(NonEmptyStringSchema),
    }),
  }) as z.ZodType<CognitiveHandoffDocument>;
}

function obligationFindingSchema(
  obligationKey: string,
  allowedStatuses: readonly (typeof CONCLUSION_STATUSES)[number][],
): z.ZodType {
  const variants = allowedStatuses.map((status) => status === 'supported'
    ? z.strictObject({
        ...HandoffFindingBase,
        obligationKey: z.literal(obligationKey),
        status: z.literal(status),
        reviewDecisionKeys: z.array(StableIdSchema),
        evidenceCoverage: z.strictObject({
          status: z.literal('sufficient'),
          rationale: NonEmptyStringSchema,
          gaps: z.array(z.never()).length(0),
        }),
      })
    : z.strictObject({
        ...HandoffFindingBase,
        obligationKey: z.literal(obligationKey),
        status: z.literal(status),
        evidenceCoverage: EvidenceCoverageAssessmentSchema,
        reviewDecisionKeys: z.array(StableIdSchema).min(1),
      }));
  return z.discriminatedUnion(
    'status',
    variants as unknown as Parameters<typeof z.discriminatedUnion>[1],
  );
}

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
  checks: z.array(AuthoredVerificationDefinitionSchema).optional(),
  noCommandRationale: NonEmptyStringSchema.optional(),
  humanAuthorization: z.strictObject({
    humanEvent: HumanEventInputSchema,
    interpretation: NonEmptyStringSchema,
  }).optional(),
});

export const HumanResolutionDocumentSchema = z.strictObject({
  humanEvent: HumanEventInputSchema,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('semantic-impact'), dispositionId: Sha256Schema }),
    z.strictObject({ kind: z.literal('correction'), decisionId: StableIdSchema }),
    z.strictObject({ kind: z.literal('host-policy'), requirementIds: z.array(StableIdSchema).min(1) }),
  ]),
  action: z.enum(HUMAN_RESOLUTION_ACTIONS),
  reason: NonEmptyStringSchema,
});

const PackageIdentitySchema = z.strictObject({
  cli: z.strictObject({ name: z.literal('@sovea/stetra'), version: NonEmptyStringSchema }),
  core: z.strictObject({ name: z.literal('@sovea/stetra-core'), version: NonEmptyStringSchema }),
});

const PendingResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('semantic-impact'), targetId: Sha256Schema }),
  z.strictObject({ kind: z.literal('correction'), targetId: StableIdSchema }),
  z.strictObject({ kind: z.literal('host-policy'), targetIds: z.array(StableIdSchema).min(1) }),
]);

export const AttemptProjectionSchema = z.strictObject({
  attemptId: StableIdSchema,
  ordinal: z.number().int().positive(),
  parentAttemptId: StableIdSchema.nullable(),
  effectiveContractId: Sha256Schema,
  trigger: z.enum(['initial', 'delivery-repair', 'correction', 'verification-revision']),
  factCollectionId: Sha256Schema.optional(),
  evidenceDispositionIds: z.array(Sha256Schema),
});

export const TaskProjectionSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  prepareRequestId: StableIdSchema,
  prepareInputFingerprint: Sha256Schema,
  revision: z.number().int().positive(),
  contractRevision: z.number().int().positive(),
  packageIdentity: PackageIdentitySchema,
  semanticContractId: Sha256Schema,
  verificationPlanId: Sha256Schema,
  effectiveContractId: Sha256Schema,
  executionBudget: ExecutionBudgetSchema,
  timeoutRetryUsage: z.array(z.strictObject({
    verifierId: StableIdSchema,
    count: z.number().int().positive(),
  })),
  currentAttemptId: StableIdSchema,
  attempts: z.array(AttemptProjectionSchema).min(1),
  humanResolutionIds: z.array(StableIdSchema),
  verificationRevisionIds: z.array(StableIdSchema),
  pendingResolution: PendingResolutionSchema.optional(),
  currentHandoffId: StableIdSchema.optional(),
  decisionId: StableIdSchema.optional(),
});

export const TaskEventSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  sequence: z.number().int().positive(),
  eventId: z.uuid(),
  type: z.enum([
    'task-prepared', 'facts-collected', 'timeout-retried', 'evidence-diagnosed',
    'handoff-evaluated', 'decision-recorded',
    'human-resolution-recorded', 'verification-revised',
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
export type CognitiveHandoffDocument = z.infer<typeof CognitiveHandoffDocumentSchema>;
export type HumanDecisionDocument = z.infer<typeof HumanDecisionDocumentSchema>;
export type VerificationRevisionDocument = z.infer<typeof VerificationRevisionDocumentSchema>;
export type HumanResolutionDocument = z.infer<typeof HumanResolutionDocumentSchema>;
export type TaskProjection = z.infer<typeof TaskProjectionSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;

export interface DerivedTaskState {
  deliveryStatus: 'waiting-for-implementation' | 'repairing' | 'implementation-complete' | 'exhausted';
  evidenceStatus: 'not-collected' | 'awaiting-evidence-judgment' | 'incomplete' | 'needs-attention' | 'handoff-ready' | 'facts-stale';
  decisionStatus: 'pending' | 'correction-requested' | 'accepted' | 'rejected' | 'deferred' | 'aborted';
  repairCount: number;
}
