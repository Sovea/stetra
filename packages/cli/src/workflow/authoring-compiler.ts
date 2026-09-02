import type { TaskContract, VerificationDefinition } from '@sovea/stetra-core';
import type { z } from 'zod';

import { inputError } from '../errors.ts';
import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION } from '../protocol.ts';
import type {
  PrepareAuthoringDocument,
  VerificationRevisionAuthoringDocument,
} from '../schemas/authoring.ts';
import {
  DelegationPrepareDocumentSchema,
  VerificationRevisionDocumentSchema,
  type CognitiveHandoffDocument,
  type DelegationPrepareDocument,
  type VerificationRevisionDocument,
} from '../schemas/delegation.ts';

export interface HandoffAuthoringSource {
  actualChange: CognitiveHandoffDocument['actualChange'];
  conditions: Record<string, {
    status: CognitiveHandoffDocument['conditions'][number]['status'];
    summary: string;
    obligations: Record<string, Omit<
      CognitiveHandoffDocument['conditions'][number]['obligations'][number],
      'obligationKey' | 'reviewDecisionKeys'
    >>;
  }>;
  residualUnknowns: CognitiveHandoffDocument['residualUnknowns'];
  reviewDecisions: Array<{
    key: string;
    targets: Array<
      | { kind: 'condition'; conditionKey: string }
      | { kind: 'obligation'; conditionKey: string; obligationKey: string }
    >;
    question: string;
    adoptionImpact: string;
    nextAction: string;
    evidence: CognitiveHandoffDocument['reviewDecisions'][number]['evidence'];
  }>;
  recommendation: CognitiveHandoffDocument['recommendation'];
}

export const DEFAULT_EXECUTION_BUDGET = {
  checkTimeoutMs: 300_000,
  maxDeliveryRepairs: 2,
  timeoutRetry: {
    mode: 'bounded',
    maxRetriesPerVerifier: 1,
    maxTimeoutMs: 900_000,
  },
} as const;

export function compilePrepareAuthoring(input: {
  prepareRequestId: string;
  source: PrepareAuthoringDocument;
}): z.infer<typeof DelegationPrepareDocumentSchema> {
  const source = input.source;
  const document: DelegationPrepareDocument = {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    prepareRequestId: input.prepareRequestId,
    developerEvents: source.developerEvents,
    task: {
      basis: {
        developerEventKeys: source.developerEvents.map((event) => event.key),
        repositoryEvidenceKeys: source.task.repositoryEvidenceKeys,
      },
      desiredOutcome: source.task.desiredOutcome,
      constraints: source.task.constraints,
      nonGoals: source.task.nonGoals,
      focus: source.task.focus,
    },
    materialDecisionForks: source.materialDecisionForks ?? [],
    ...(source.repositoryEvidence ? { repositoryEvidence: source.repositoryEvidence } : {}),
    assurance: source.assurance,
    hostPolicyRequirements: source.hostPolicyRequirements ?? [],
    executionBudget: source.executionBudgetOverride ?? DEFAULT_EXECUTION_BUDGET,
    ...(source.verification.mode === 'checks'
      ? { checks: source.verification.checks }
      : { noCommandRationale: source.verification.rationale }),
  };
  return DelegationPrepareDocumentSchema.parse(document);
}

export function compileVerificationRevisionAuthoring(input: {
  contract: TaskContract;
  source: VerificationRevisionAuthoringDocument;
}): VerificationRevisionDocument {
  const source = input.source;
  const current = input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.map((definition) =>
        authoredCheck(input.contract, definition))
    : [];
  if (source.kind === 'execution-rebinding') {
    const seen = new Set<string>();
    const rebindings = new Map(source.rebindings.map((rebind) => {
      if (seen.has(rebind.checkKey)) {
        throw inputError(`Execution rebinding repeats check key ${rebind.checkKey}.`);
      }
      seen.add(rebind.checkKey);
      return [rebind.checkKey, rebind.execution] as const;
    }));
    for (const key of rebindings.keys()) {
      if (!current.some((check) => check.key === key)) {
        throw inputError(`Execution rebinding references unknown check key ${key}.`);
      }
    }
    return VerificationRevisionDocumentSchema.parse({
      kind: source.kind,
      rationale: source.rationale,
      equivalenceClaim: source.equivalenceClaim,
      checks: current.map((check) => ({
        ...check,
        execution: rebindings.get(check.key) ?? check.execution,
      })),
    });
  }

  if (source.plan.mode === 'no-command') {
    return VerificationRevisionDocumentSchema.parse({
      kind: source.kind,
      rationale: source.rationale,
      equivalenceClaim: source.equivalenceClaim,
      noCommandRationale: source.plan.rationale,
      ...(source.humanAuthorization ? { humanAuthorization: source.humanAuthorization } : {}),
    });
  }

  const checks = [...current];
  const operated = new Set<string>();
  for (const operation of source.plan.operations) {
    const targetKey = operation.action === 'add' ? operation.check.key : operation.checkKey;
    if (operated.has(targetKey)) {
      throw inputError(`Verification revision repeats check key ${targetKey}.`);
    }
    operated.add(targetKey);
    const index = checks.findIndex((check) => check.key === targetKey);
    if (operation.action === 'add') {
      if (index >= 0) throw inputError(`Verification revision adds existing check key ${targetKey}.`);
      checks.push(operation.check);
      continue;
    }
    if (index < 0) {
      throw inputError(`Verification revision ${operation.action} references unknown check key ${targetKey}.`);
    }
    if (operation.action === 'remove') {
      checks.splice(index, 1);
      continue;
    }
    if (operation.check.key !== targetKey) {
      throw inputError(
        `Verification replacement for ${targetKey} must preserve the same logical check key.`,
      );
    }
    checks[index] = operation.check;
  }
  if (!checks.length) {
    throw inputError('Use plan.mode no-command when a verification revision removes every check.');
  }
  return VerificationRevisionDocumentSchema.parse({
    kind: source.kind,
    rationale: source.rationale,
    equivalenceClaim: source.equivalenceClaim,
    checks,
    ...(source.humanAuthorization ? { humanAuthorization: source.humanAuthorization } : {}),
  });
}

function authoredCheck(
  contract: TaskContract,
  definition: VerificationDefinition,
): VerificationRevisionDocument['checks'] extends Array<infer Check> | undefined ? Check : never {
  const obligationKeys = new Map(contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      obligation.id,
      { conditionKey: condition.key, obligationKey: obligation.key },
    ] as const)));
  return {
    key: definition.key,
    rationale: definition.rationale,
    execution: {
      preparation: definition.execution.preparation.map((step) => ({ argv: step.argv })),
      assertion: { argv: definition.execution.assertion.argv },
    },
    executionInputs: definition.executionInputs,
    baseline: definition.baseline.mode === 'task-start'
      ? {
          mode: 'task-start',
          rationale: definition.baseline.rationale,
          expectation: definition.baseline.expectation,
          obligationKeys: definition.baseline.obligationIds.map((id) => {
            const key = obligationKeys.get(id);
            if (!key) throw new Error(`Verification baseline references unknown obligation ${id}.`);
            return key;
          }),
        }
      : { mode: 'unknown' },
    verifierSelectors: definition.verifierRefs,
  };
}

export function compileHandoffAuthoring(input: {
  contract: TaskContract;
  source: HandoffAuthoringSource;
}): CognitiveHandoffDocument {
  const conditionKeys = new Set(input.contract.adoptionConditions.map((condition) => condition.key));
  const obligationKeys = new Set(input.contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) =>
      `${condition.key}\u0000${obligation.key}`)));
  const conditionReviews = new Map<string, string[]>();
  const obligationReviews = new Map<string, string[]>();
  const reviewKeys = new Set<string>();
  const reviewDecisions = input.source.reviewDecisions.map((decision, decisionIndex) => {
    if (reviewKeys.has(decision.key)) {
      throw inputError(`reviewDecisions[${decisionIndex}].key duplicates ${decision.key}.`);
    }
    reviewKeys.add(decision.key);
    const targetKeys = new Set<string>();
    const conditionTargets: string[] = [];
    const obligationTargets: Array<{ conditionKey: string; obligationKey: string }> = [];
    for (const target of decision.targets) {
      const targetKey = target.kind === 'condition'
        ? `condition\u0000${target.conditionKey}`
        : `obligation\u0000${target.conditionKey}\u0000${target.obligationKey}`;
      if (targetKeys.has(targetKey)) {
        throw inputError(`Review Decision ${decision.key} repeats one target.`);
      }
      targetKeys.add(targetKey);
      if (target.kind === 'condition') {
        if (!conditionKeys.has(target.conditionKey)) {
          throw inputError(`Review Decision ${decision.key} targets unknown Condition ${target.conditionKey}.`);
        }
        conditionTargets.push(target.conditionKey);
        appendReview(conditionReviews, target.conditionKey, decision.key);
      } else {
        const composite = `${target.conditionKey}\u0000${target.obligationKey}`;
        if (!obligationKeys.has(composite)) {
          throw inputError(
            `Review Decision ${decision.key} targets unknown Evidence Obligation `
            + `${target.conditionKey}/${target.obligationKey}.`,
          );
        }
        obligationTargets.push({
          conditionKey: target.conditionKey,
          obligationKey: target.obligationKey,
        });
        appendReview(obligationReviews, composite, decision.key);
      }
    }
    return {
      key: decision.key,
      conditionKeys: conditionTargets,
      obligationKeys: obligationTargets,
      question: decision.question,
      adoptionImpact: decision.adoptionImpact,
      nextAction: decision.nextAction,
      evidence: decision.evidence,
    };
  });

  return {
    actualChange: input.source.actualChange,
    conditions: input.contract.adoptionConditions.map((condition) => {
      const finding = input.source.conditions[condition.key];
      if (!finding) throw inputError(`Handoff omits Condition ${condition.key}.`);
      return {
        conditionKey: condition.key,
        status: finding.status,
        summary: finding.summary,
        reviewDecisionKeys: conditionReviews.get(condition.key) ?? [],
        obligations: condition.evidenceObligations.map((obligation) => {
          const authored = finding.obligations[obligation.key];
          if (!authored) {
            throw inputError(`Handoff omits Evidence Obligation ${condition.key}/${obligation.key}.`);
          }
          return {
            obligationKey: obligation.key,
            ...authored,
            reviewDecisionKeys: obligationReviews.get(
              `${condition.key}\u0000${obligation.key}`,
            ) ?? [],
          };
        }),
      };
    }),
    residualUnknowns: input.source.residualUnknowns,
    reviewDecisions,
    recommendation: input.source.recommendation,
  } as CognitiveHandoffDocument;
}

function appendReview(map: Map<string, string[]>, target: string, reviewKey: string): void {
  map.set(target, [...(map.get(target) ?? []), reviewKey]);
}
