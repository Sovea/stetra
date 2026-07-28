import { z } from 'zod';

const FingerprintSchema = z.string().regex(/^[a-f0-9]{16}$/);
const NonEmptyStringSchema = z.string().trim().min(1);
const RunIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

export const GuidanceDeliverySelectionSchema = z.strictObject({
  considerIds: z.array(NonEmptyStringSchema),
  rationale: NonEmptyStringSchema,
});

export const RelationProposalDocumentSchema = z.union([
  z.array(z.unknown()),
  z.strictObject({
    relations: z.array(z.unknown()),
  }).transform((value) => value.relations),
]);

const EvaluationEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('diff'),
    ref: NonEmptyStringSchema,
    file: NonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal('file'),
    ref: NonEmptyStringSchema,
    file: NonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal('check'),
    ref: NonEmptyStringSchema,
    checkId: NonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal('semantic'),
    ref: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
  }),
]);

const GuidanceAttestationSchema = z.strictObject({
  guidanceId: NonEmptyStringSchema,
  verdict: z.enum(['satisfied', 'violated', 'partial', 'unverified']),
  evidenceRefs: z.array(EvaluationEvidenceSchema),
  explanation: NonEmptyStringSchema,
});

const ChangeExceptionSchema = z.strictObject({
  guidanceId: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
  status: z.enum(['requested', 'approved']).optional(),
  approvedBy: NonEmptyStringSchema.optional(),
}).superRefine((exception, context) => {
  if (exception.status === 'approved' && !exception.approvedBy) {
    context.addIssue({
      code: 'custom',
      path: ['approvedBy'],
      message: 'is required when status is approved',
    });
  }
});

export const EvaluationInputSchema = z.strictObject({
  attestations: z.array(GuidanceAttestationSchema).default([]),
  exceptions: z.array(ChangeExceptionSchema).default([]),
});

export const RuntimeRunSchema = z.looseObject({
  schemaVersion: z.string(),
  runId: RunIdSchema,
  workflow: z.literal('change'),
  state: z.enum(['prepared', 'completed']),
  projectRoot: NonEmptyStringSchema,
  decision: z.looseObject({
    schemaVersion: z.string(),
    decisionId: FingerprintSchema,
  }),
  worktreeBaseline: z.unknown(),
  checkPlan: z.array(z.unknown()),
  completion: z.looseObject({
    completedAt: NonEmptyStringSchema,
    evaluation: z.unknown(),
  }).optional(),
}).superRefine((run, context) => {
  if (run.state === 'completed' && !run.completion) {
    context.addIssue({
      code: 'custom',
      path: ['completion'],
      message: 'is required when state is completed',
    });
  }
  if (run.state === 'prepared' && run.completion) {
    context.addIssue({
      code: 'custom',
      path: ['completion'],
      message: 'must be absent when state is prepared',
    });
  }
});
