import { z } from 'zod';

import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION } from '../protocol.ts';

export const StableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const NonEmptyStringSchema = z.string().trim().min(1);
export const SafeRepositoryPathSchema = z.string().min(1).refine((value) =>
  !value.startsWith('/')
  && !/^[A-Za-z]:[\\/]/.test(value)
  && !value.includes('\\')
  && !value.includes('\0')
  && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..'),
{ message: 'must be a safe repository-relative path' });

export const ExactHumanEventInputSchema = z.strictObject({
  content: NonEmptyStringSchema,
});

const RepositorySelectorSchema = z.strictObject({
  kind: z.enum(['file', 'tree']),
  path: SafeRepositoryPathSchema,
});

export const CheckDefinitionInputSchema = z.strictObject({
  key: StableIdSchema,
  argv: z.array(NonEmptyStringSchema).min(1),
  rationale: NonEmptyStringSchema.optional(),
  preparation: z.array(z.strictObject({
    key: StableIdSchema,
    argv: z.array(NonEmptyStringSchema).min(1),
  })).optional(),
  executionInputs: z.array(RepositorySelectorSchema).optional(),
  verifierSelectors: z.array(RepositorySelectorSchema.extend({
    role: z.enum(['command-definition', 'acceptance-surface']),
  })).optional(),
});

const VerificationSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('checks'),
    checks: z.array(CheckDefinitionInputSchema).min(1),
  }),
  z.strictObject({
    mode: z.literal('profile'),
    name: StableIdSchema,
  }),
  z.strictObject({
    mode: z.literal('no-command'),
    rationale: NonEmptyStringSchema,
  }),
]);

const EvidenceRequirementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('check'), checkKey: StableIdSchema }),
  z.strictObject({ kind: z.literal('human-review'), question: NonEmptyStringSchema }),
]);

const AdoptionConcernInputSchema = z.strictObject({
  key: StableIdSchema,
  statement: NonEmptyStringSchema,
  adoptionImpact: NonEmptyStringSchema,
  evidenceRequirements: z.array(EvidenceRequirementSchema).min(1),
  falsification: z.strictObject({
    plausibleFailure: NonEmptyStringSchema,
    scenario: NonEmptyStringSchema,
  }).optional(),
});

const AssuranceSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('routine') }),
  z.strictObject({
    mode: z.literal('consequential'),
    concerns: z.array(AdoptionConcernInputSchema).min(1),
  }),
]);

export const TaskBeginDocumentSchema = z.strictObject({
  humanEvent: ExactHumanEventInputSchema,
  interpretation: z.strictObject({
    desiredOutcome: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    nonGoals: z.array(NonEmptyStringSchema),
  }),
  assurance: AssuranceSchema.default({ mode: 'routine' }),
  verification: VerificationSchema.optional(),
});

const AuthoredEvidenceReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('changed-file'), path: SafeRepositoryPathSchema }),
  z.strictObject({ kind: z.literal('check'), checkKey: StableIdSchema }),
  z.strictObject({ kind: z.literal('patch') }),
]);

export const TaskHandoffDocumentSchema = z.strictObject({
  actualChange: z.strictObject({
    behavior: NonEmptyStringSchema,
    mechanism: z.array(NonEmptyStringSchema).min(1),
    preservedInvariants: z.array(NonEmptyStringSchema).optional(),
    failureAndRecovery: z.array(NonEmptyStringSchema).optional(),
    importantEffects: z.array(NonEmptyStringSchema).optional(),
    materialTradeoffs: z.array(NonEmptyStringSchema).optional(),
  }),
  concernFindings: z.array(z.strictObject({
    concernKey: StableIdSchema,
    status: z.enum(['supported', 'partial', 'contradicted', 'unknown']),
    summary: NonEmptyStringSchema,
    evidence: z.array(AuthoredEvidenceReferenceSchema),
    gaps: z.array(NonEmptyStringSchema),
  })).optional(),
  residualUnknowns: z.array(z.strictObject({
    statement: NonEmptyStringSchema,
    nextAction: NonEmptyStringSchema.optional(),
    evidence: z.array(AuthoredEvidenceReferenceSchema).optional(),
  })).optional(),
  reviewFocus: z.array(z.strictObject({
    question: NonEmptyStringSchema,
    adoptionImpact: NonEmptyStringSchema,
    nextAction: NonEmptyStringSchema,
    evidence: z.array(AuthoredEvidenceReferenceSchema).optional(),
  })).optional(),
  recommendation: z.strictObject({
    action: z.enum(['accept', 'request-correction', 'reject', 'defer']),
    rationale: NonEmptyStringSchema,
    caveats: z.array(NonEmptyStringSchema).optional(),
  }),
});

export const TaskDecisionDocumentSchema = z.strictObject({
  humanEvent: ExactHumanEventInputSchema,
  action: z.enum(['accepted', 'correction-requested', 'rejected', 'deferred']),
  reason: NonEmptyStringSchema,
  acknowledgeAttention: z.literal(true).optional(),
});

export const TaskProjectionSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  revision: z.number().int().positive(),
  contractId: Sha256Schema,
  effectiveContractId: Sha256Schema,
  attemptId: StableIdSchema,
  attemptNumber: z.number().int().positive(),
  baselineId: Sha256Schema,
  phase: z.enum(['working', 'awaiting-handoff', 'awaiting-decision', 'complete']),
  collectionIds: z.array(Sha256Schema),
  currentCollectionId: Sha256Schema.optional(),
  handoffIds: z.array(StableIdSchema),
  currentHandoffId: StableIdSchema.optional(),
  decisionIds: z.array(StableIdSchema),
  currentDecisionId: StableIdSchema.optional(),
  terminalDecision: z.enum(['accepted', 'rejected', 'deferred']).optional(),
});

export const TaskEventSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  taskId: z.uuid(),
  sequence: z.number().int().positive(),
  eventId: z.uuid(),
  type: z.enum([
    'task-began',
    'facts-collected',
    'handoff-authored',
    'human-decision-recorded',
    'correction-started',
  ]),
  actor: z.enum(['runtime', 'agent', 'human']),
  occurredAt: z.iso.datetime(),
  priorRevision: z.number().int().nonnegative(),
  resultingRevision: z.number().int().positive(),
  artifactRefs: z.array(SafeRepositoryPathSchema),
  projection: TaskProjectionSchema,
});

export type TaskBeginDocument = z.infer<typeof TaskBeginDocumentSchema>;
export type TaskHandoffDocument = z.infer<typeof TaskHandoffDocumentSchema>;
export type TaskDecisionDocument = z.infer<typeof TaskDecisionDocumentSchema>;
export type TaskProjection = z.infer<typeof TaskProjectionSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
