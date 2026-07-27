import { z } from 'zod';

const FingerprintSchema = z.string().regex(/^[a-f0-9]{16}$/);
const NonEmptyStringSchema = z.string().trim().min(1);

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

export const EvaluationInputSchema = z.strictObject({
  attestations: z.array(z.unknown()).default([]),
  exceptions: z.array(z.unknown()).default([]),
});

const FeedbackAggregateEntrySchema = z.strictObject({
  guidanceId: NonEmptyStringSchema,
  sections: z.array(z.enum(['required', 'consider', 'avoid', 'tension'])),
  satisfied: z.number().int().nonnegative(),
  violated: z.number().int().nonnegative(),
  excepted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  evidenceKinds: z.array(z.enum(['diff', 'file', 'check', 'semantic'])),
  firstRecordedAt: NonEmptyStringSchema,
  lastRecordedAt: NonEmptyStringSchema,
  aggregateFingerprint: FingerprintSchema,
}).superRefine((aggregate, context) => {
  if (
    aggregate.total
    !== aggregate.satisfied + aggregate.violated + aggregate.excepted
  ) {
    context.addIssue({
      code: 'custom',
      path: ['total'],
      message: 'must equal satisfied + violated + excepted',
    });
  }
});

export const FeedbackAggregateSchema = z.strictObject({
  schemaVersion: z.string(),
  generatedAt: NonEmptyStringSchema,
  source: z.strictObject({
    eventsFile: NonEmptyStringSchema,
    eventCount: z.number().int().nonnegative(),
    eventsFingerprint: FingerprintSchema,
  }),
  aggregates: z.array(FeedbackAggregateEntrySchema),
}).superRefine((document, context) => {
  const ids = new Set<string>();
  for (const [index, aggregate] of document.aggregates.entries()) {
    if (ids.has(aggregate.guidanceId)) {
      context.addIssue({
        code: 'custom',
        path: ['aggregates', index, 'guidanceId'],
        message: `duplicate guidance aggregate ${aggregate.guidanceId}`,
      });
    }
    ids.add(aggregate.guidanceId);
  }
});

export const FeedbackProposalCandidateSchema = z.strictObject({
  schemaVersion: z.string(),
  guidanceId: NonEmptyStringSchema,
  aggregateFingerprint: FingerprintSchema,
  target: z.enum(['team-playbook', 'personal-overlay']),
  change: z.strictObject({
    kind: z.enum(['add', 'revise', 'retire', 'add-exception']),
    summary: NonEmptyStringSchema,
    proposedContent: z.record(z.string(), z.unknown()),
  }),
  rationale: NonEmptyStringSchema,
  approval: z.strictObject({
    status: z.literal('approved'),
    approvedBy: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
  }),
});

export const RuntimeSessionSchema = z.looseObject({
  schemaVersion: z.string(),
  projectRoot: NonEmptyStringSchema,
  decision: z.looseObject({
    schemaVersion: z.string(),
    decisionId: FingerprintSchema,
  }),
  worktreeBaseline: z.unknown(),
  checkPlan: z.array(z.unknown()),
});
