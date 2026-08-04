import { z } from 'zod';

import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
} from '../protocol.ts';

const StableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const NonEmptyStringSchema = z.string().trim().min(1);
const SafeRepositoryPathSchema = z.string().min(1).refine((value) =>
  !value.startsWith('/')
  && !/^[A-Za-z]:[\\/]/.test(value)
  && !value.includes('\\')
  && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..'), {
  message: 'must be a safe repository-relative path',
});

const HumanEventSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.enum(['task', 'decision']),
  content: NonEmptyStringSchema,
  contentFingerprint: Sha256Schema.optional(),
  provider: NonEmptyStringSchema.optional(),
  nativeId: NonEmptyStringSchema.optional(),
});

const InterpretationBasisSchema = z.strictObject({
  humanEventIds: z.array(StableIdSchema),
  repositoryEvidenceIds: z.array(StableIdSchema),
});

const SemanticValueSchema = z.strictObject({
  value: NonEmptyStringSchema,
  basis: InterpretationBasisSchema,
});

const ConsequenceValueSchema = SemanticValueSchema.extend({
  value: z.enum(['low', 'medium', 'high']),
});

const EvidenceWindowSchema = z.strictObject({
  id: StableIdSchema,
  path: SafeRepositoryPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).refine((value) => value.endLine >= value.startLine, {
  path: ['endLine'],
  message: 'must be greater than or equal to startLine',
});

const HandoffEvidenceSelectionSchema = z.strictObject({
  changedFiles: z.array(SafeRepositoryPathSchema).optional(),
  checks: z.array(StableIdSchema).optional(),
  repositoryEvidence: z.array(StableIdSchema).optional(),
  humanEvents: z.array(StableIdSchema).optional(),
  patch: z.literal(true).optional(),
});

const ClaimFalsificationSchema = z.strictObject({
  failureHypothesis: NonEmptyStringSchema,
  attempt: NonEmptyStringSchema,
  status: z.enum(['supported', 'contradicted', 'partial', 'unverified']),
  supportingEvidence: HandoffEvidenceSelectionSchema,
  counterEvidence: HandoffEvidenceSelectionSchema,
  conclusion: NonEmptyStringSchema,
});

const MaterialClaimSchema = z.strictObject({
  id: StableIdSchema,
  dimension: z.enum([
    'behavior',
    'invariant',
    'state-ownership',
    'data-flow',
    'control-flow',
    'compatibility',
    'migration',
    'failure-recovery',
    'security',
    'operations',
    'maintenance',
    'important-non-change',
  ]),
  statement: NonEmptyStringSchema,
  adoptionConsequence: NonEmptyStringSchema,
  adoptionCritical: z.boolean(),
  basis: z.enum([
    'repository-evidence',
    'agent-judgment',
    'human-decision',
    'unverified',
  ]),
  evidence: HandoffEvidenceSelectionSchema,
  falsification: ClaimFalsificationSchema.optional(),
});

const ResidualUnknownSchema = z.strictObject({
  id: StableIdSchema,
  statement: NonEmptyStringSchema,
  adoptionImpact: NonEmptyStringSchema,
  validationPath: NonEmptyStringSchema,
  references: z.strictObject({
    claims: z.array(StableIdSchema),
    changedFiles: z.array(SafeRepositoryPathSchema),
  }),
});

const ReviewMapEntrySchema = z.strictObject({
  id: StableIdSchema,
  priority: z.enum([
    'must-read',
    'useful-to-sample',
    'mechanically-covered',
    'unresolved',
  ]),
  changedFiles: z.array(SafeRepositoryPathSchema),
  checkIds: z.array(StableIdSchema),
  claimIds: z.array(StableIdSchema),
  unknownIds: z.array(StableIdSchema),
  rationale: NonEmptyStringSchema,
  prevents: NonEmptyStringSchema,
});

const MaterialAlternativeSchema = z.strictObject({
  id: StableIdSchema,
  description: NonEmptyStringSchema,
  tradeoff: NonEmptyStringSchema,
  reasonNotChosen: NonEmptyStringSchema,
  humanEventIds: z.array(StableIdSchema),
});

export const VerificationDefinitionSchema = z.strictObject({
  id: StableIdSchema,
  rationale: NonEmptyStringSchema,
  argv: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().positive(),
  source: z.enum(['team-default', 'host-task']),
  commandDefinitionPaths: z.array(SafeRepositoryPathSchema),
  acceptanceSurfacePaths: z.array(SafeRepositoryPathSchema),
});

export const DelegationPrepareDocumentSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  humanEvents: z.array(HumanEventSchema).min(1),
  repositoryEvidence: z.array(EvidenceWindowSchema).optional(),
  semantic: z.strictObject({
    desiredOutcome: SemanticValueSchema,
    constraints: z.array(SemanticValueSchema),
    nonGoals: z.array(SemanticValueSchema),
    focus: z.array(SemanticValueSchema.extend({ value: SafeRepositoryPathSchema })),
    consequence: ConsequenceValueSchema,
    unresolvedMaterialFork: z.strictObject({
      question: NonEmptyStringSchema,
      alternatives: z.array(NonEmptyStringSchema).min(2),
      decisionImpact: NonEmptyStringSchema,
    }).optional(),
  }),
  verification: z.strictObject({
    checks: z.array(VerificationDefinitionSchema).optional(),
    noCommandRationale: NonEmptyStringSchema.optional(),
  }),
});

export const CognitiveHandoffDocumentSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  systemMeaningUpdate: NonEmptyStringSchema,
  materialClaims: z.array(MaterialClaimSchema).min(1),
  residualUnknowns: z.array(ResidualUnknownSchema),
  reviewMap: z.array(ReviewMapEntrySchema),
  materialAlternatives: z.array(MaterialAlternativeSchema).optional(),
  repositoryEvidence: z.array(EvidenceWindowSchema).optional(),
});

export const DelegationRunSchema = z.strictObject({
  protocol: z.literal(DELEGATION_PROTOCOL),
  schemaVersion: z.literal(DELEGATION_SCHEMA_VERSION),
  runId: z.uuid(),
  workflow: z.literal('semantic-handoff'),
  state: z.enum(['prepared', 'facts-collected', 'completed']),
  projectRoot: NonEmptyStringSchema,
  createdAt: z.iso.datetime(),
  packageIdentity: z.strictObject({
    cli: z.strictObject({ name: z.literal('@sovea/resonant-code'), version: NonEmptyStringSchema }),
    core: z.strictObject({ name: z.literal('@sovea/resonant-code-core'), version: NonEmptyStringSchema }),
  }),
  contract: z.unknown(),
  worktreeBaseline: z.unknown(),
  factBundle: z.unknown().optional(),
  handoffFile: z.literal('handoff.json').optional(),
  completion: z.strictObject({
    completedAt: z.iso.datetime(),
    handoffFingerprint: Sha256Schema,
    evaluation: z.unknown(),
  }).optional(),
}).superRefine((run, context) => {
  if (run.state === 'prepared' && (run.factBundle || run.handoffFile || run.completion)) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'prepared runs cannot contain collected facts, handoff, or completion',
    });
  }
  if (run.state === 'facts-collected' && (!run.factBundle || !run.handoffFile || run.completion)) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'facts-collected runs require facts and handoff without completion',
    });
  }
  if (run.state === 'completed' && (!run.factBundle || !run.handoffFile || !run.completion)) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'completed runs require facts, handoff, and completion',
    });
  }
});

export type DelegationPrepareDocument = z.infer<typeof DelegationPrepareDocumentSchema>;
export type CognitiveHandoffDocument = z.infer<typeof CognitiveHandoffDocumentSchema>;
