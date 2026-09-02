import { z } from 'zod';

import {
  AssuranceDeclarationSchema,
  DeveloperEventInputSchema,
  EvidenceWindowSchema,
  ExecutionBudgetSchema,
  HostPolicyRequirementSchema,
  HumanEventInputSchema,
  MaterialDecisionForkSchema,
  NonEmptyStringSchema,
  PrepareVerificationDefinitionSchema,
  SafeRepositoryPathSchema,
  StableIdSchema,
  AuthoredVerificationDefinitionSchema,
  VERIFICATION_REVISION_KINDS,
} from './delegation.ts';

export const PrepareAuthoringDocumentSchema = z.strictObject({
  developerEvents: z.array(DeveloperEventInputSchema).min(1),
  task: z.strictObject({
    desiredOutcome: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    nonGoals: z.array(NonEmptyStringSchema),
    focus: z.array(SafeRepositoryPathSchema),
    repositoryEvidenceKeys: z.array(StableIdSchema),
  }),
  materialDecisionForks: z.array(MaterialDecisionForkSchema).optional(),
  repositoryEvidence: z.array(EvidenceWindowSchema).optional(),
  assurance: AssuranceDeclarationSchema,
  hostPolicyRequirements: z.array(HostPolicyRequirementSchema).optional(),
  executionBudgetOverride: ExecutionBudgetSchema.optional(),
  verification: z.discriminatedUnion('mode', [
    z.strictObject({
      mode: z.literal('checks'),
      checks: z.array(PrepareVerificationDefinitionSchema).min(1),
    }),
    z.strictObject({
      mode: z.literal('no-command'),
      rationale: NonEmptyStringSchema,
    }),
  ]),
});

export type PrepareAuthoringDocument = z.infer<typeof PrepareAuthoringDocumentSchema>;

const AuthoredVerificationExecutionSchema = AuthoredVerificationDefinitionSchema.shape.execution;

const RevisionHumanAuthorizationSchema = z.strictObject({
  humanEvent: HumanEventInputSchema,
  interpretation: NonEmptyStringSchema,
});

export const VerificationRevisionAuthoringDocumentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(VERIFICATION_REVISION_KINDS[0]),
    rationale: NonEmptyStringSchema,
    equivalenceClaim: NonEmptyStringSchema,
    rebindings: z.array(z.strictObject({
      checkKey: StableIdSchema,
      execution: AuthoredVerificationExecutionSchema,
    })).min(1),
  }),
  z.strictObject({
    kind: z.literal(VERIFICATION_REVISION_KINDS[1]),
    rationale: NonEmptyStringSchema,
    equivalenceClaim: NonEmptyStringSchema,
    plan: z.discriminatedUnion('mode', [
      z.strictObject({
        mode: z.literal('checks'),
        operations: z.array(z.discriminatedUnion('action', [
          z.strictObject({
            action: z.literal('add'),
            check: AuthoredVerificationDefinitionSchema,
          }),
          z.strictObject({
            action: z.literal('replace'),
            checkKey: StableIdSchema,
            check: AuthoredVerificationDefinitionSchema,
          }),
          z.strictObject({
            action: z.literal('remove'),
            checkKey: StableIdSchema,
          }),
        ])).min(1),
      }),
      z.strictObject({
        mode: z.literal('no-command'),
        rationale: NonEmptyStringSchema,
      }),
    ]),
    humanAuthorization: RevisionHumanAuthorizationSchema.optional(),
  }),
]);

export type VerificationRevisionAuthoringDocument = z.infer<
  typeof VerificationRevisionAuthoringDocumentSchema
>;
