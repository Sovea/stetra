import type {
  CognitiveHandoff,
  FactBundle,
  HandoffEvaluation,
  IndependentChallenge,
  TaskContract,
} from '@sovea/stetra-core';

import type { TaskProjection } from '../schemas/delegation.ts';

export interface AuthoringPacket {
  inputKind:
    | 'diagnosis'
    | 'verification-revision'
    | 'challenge'
    | 'handoff'
    | 'decision'
    | 'resolution';
  bindsTo: {
    taskId: string;
    revision: number;
    effectiveContractId: string;
    attemptId: string;
    factCollectionId?: string;
    handoffFingerprint?: string;
  };
  draft: unknown;
  referenceCatalog: {
    conditions: Array<{
      id: string;
      key: string;
      statement: string;
      criticality: string;
      obligationIds: string[];
    }>;
    obligations: Array<{
      id: string;
      conditionId: string;
      statement: string;
      failureHypothesis: string;
    }>;
    checks: Array<{
      verifierId: string;
      definitionId: string;
      key: string;
      latestStatus?: string;
      baselineRelation?: string;
      logPaths: string[];
    }>;
    changedFiles: Array<{
      id: string;
      path: string;
      operation: string;
    }>;
    challenges: Array<{
      id: string;
      obligationIds: string[];
      outcome: string;
    }>;
    attention: HandoffEvaluation['attention'];
  };
  outstandingObligations: Array<{
    code: string;
    targetId: string;
    requiredAction: string;
  }>;
}

export function diagnosisAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
}): AuthoringPacket {
  const nonpassing = input.facts.checks.filter((check) => latestStatus(check) !== 'passed');
  return packetBase(input.task, input.contract, input.facts, [], [], {
    inputKind: 'diagnosis',
    draft: {
      semanticImpact: '',
      entries: nonpassing.map((check) => ({
        definitionId: check.definitionId,
        cause: '',
        diagnosis: '',
        falsificationAttempt: '',
        codeChangeCanAlterObservation: false,
        expectedDifferentObservation: '',
        intendedChanges: [],
      })),
    },
    outstandingObligations: nonpassing.map((check) => ({
      code: 'diagnose-nonpassing-check',
      targetId: check.definitionId,
      requiredAction: 'Classify the observed cause and state how that diagnosis was challenged.',
    })),
  });
}

export function challengeAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  challenges: IndependentChallenge[];
  requiredObligationIds: string[];
}): AuthoringPacket {
  const completed = new Set(input.challenges.flatMap((item) => item.obligationIds));
  const targetId = input.requiredObligationIds.find((id) => !completed.has(id));
  const obligation = allObligations(input.contract).find((item) => item.id === targetId);
  const draft = obligation ? {
    obligationIds: [obligation.id],
    failureHypothesis: obligation.failureHypothesis,
    evidence: {
      changedFiles: input.facts.changedFiles.map((item) => item.id),
      checks: currentDefinitionIds(obligation, input.contract),
      repositoryEvidence: repositoryEvidenceIds(obligation),
      humanEvents: [input.contract.authority.developerEvent.id],
      patch: Boolean(input.facts.patch),
    },
    falsificationAttempt: '',
    supportingEvidence: [],
    counterEvidence: [],
    outcome: '',
    conclusion: '',
  } : {};
  return packetBase(input.task, input.contract, input.facts, input.challenges, [], {
    inputKind: 'challenge',
    draft,
    outstandingObligations: targetId ? [{
      code: 'perform-independent-challenge',
      targetId,
      requiredAction: 'Use a genuinely separate context when the Host can attest it, then test the stated failure hypothesis against exact evidence.',
    }] : [],
  });
}

export function verificationRevisionAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
}): AuthoringPacket {
  const obligationKeys = new Map(input.contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      obligation.id,
      { conditionKey: condition.key, obligationKey: obligation.key },
    ] as const)));
  const checks = input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.map((definition) => ({
        key: definition.key,
        rationale: definition.rationale,
        argv: definition.argv,
        baseline: definition.baseline.mode === 'task-start'
          ? {
              mode: 'task-start',
              rationale: definition.baseline.rationale,
              obligationKeys: definition.baseline.obligationIds.map((id) =>
                obligationKeys.get(id)!),
            }
          : { mode: 'unknown' },
        commandDefinitionPaths: definition.verifierRefs
          .filter((item) => item.role === 'command-definition').map((item) => item.path),
        acceptanceSurfacePaths: definition.verifierRefs
          .filter((item) => item.role === 'acceptance-surface').map((item) => item.path),
      })) : undefined;
  return packetBase(input.task, input.contract, input.facts, [], [], {
    inputKind: 'verification-revision',
    draft: {
      kind: '',
      rationale: '',
      equivalenceClaim: '',
      ...(checks ? { checks } : {
        noCommandRationale: input.contract.verificationPlan.mode === 'no-command'
          ? input.contract.verificationPlan.rationale : '',
      }),
    },
    outstandingObligations: input.facts.checks
      .filter((check) => latestStatus(check) !== 'passed')
      .map((check) => ({
        code: 'revise-invalid-verification-definition',
        targetId: check.definitionId,
        requiredAction: 'State the bounded definition change and why its engineering semantics are claimed equivalent; Human authority is required for mechanical relaxation.',
      })),
  });
}

export function handoffAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  challenges: IndependentChallenge[];
  requiredObligationIds: string[];
}): AuthoringPacket {
  const challengeByObligation = new Map(input.challenges.flatMap((challenge) =>
    challenge.obligationIds.map((id) => [id, challenge] as const)));
  const obligations = allObligations(input.contract);
  return packetBase(input.task, input.contract, input.facts, input.challenges, [], {
    inputKind: 'handoff',
    draft: {
      summary: '',
      obligationConclusions: obligations.map((obligation) => ({
        obligationId: obligation.id,
        status: '',
        evidence: [
          ...currentDefinitionIds(obligation, input.contract).map((id) => ({ kind: 'check', id })),
          ...repositoryEvidenceIds(obligation).map((id) => ({ kind: 'repository-evidence', id })),
          ...(challengeByObligation.has(obligation.id)
            ? [{ kind: 'challenge', id: challengeByObligation.get(obligation.id)!.id }] : []),
        ],
        falsificationAttempt: '',
        counterEvidence: [],
        conclusion: '',
      })),
      conditionConclusions: input.contract.adoptionConditions.map((condition) => ({
        conditionId: condition.id,
        status: '',
        summary: '',
      })),
      importantSystemEffects: [],
      residualUnknowns: [],
      reviewQuestions: input.contract.adoptionConditions.map((condition) => ({
        conditionIds: [condition.id],
        obligationIds: condition.evidenceObligations.map((item) => item.id),
        question: '',
        adoptionImpact: condition.adoptionRationale,
        evidence: [],
      })),
      recommendation: { action: '', rationale: '', caveats: [] },
    },
    outstandingObligations: [
      ...obligations.map((obligation) => ({
        code: 'conclude-evidence-obligation',
        targetId: obligation.id,
        requiredAction: 'State the bounded conclusion, falsification attempt, supporting evidence, and counter-evidence.',
      })),
      ...input.contract.adoptionConditions.map((condition) => ({
        code: 'conclude-adoption-condition',
        targetId: condition.id,
        requiredAction: 'Conclude the condition without exceeding its obligation conclusions.',
      })),
      ...input.requiredObligationIds.filter((id) => !challengeByObligation.has(id)).map((id) => ({
        code: 'required-challenge-missing',
        targetId: id,
        requiredAction: 'Complete and record the required challenge before claiming support.',
      })),
    ],
  });
}

export function decisionAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  challenges: IndependentChallenge[];
  handoff: CognitiveHandoff;
  evaluation: HandoffEvaluation;
}): AuthoringPacket {
  const base = packetBase(
    input.task, input.contract, input.facts, input.challenges, input.evaluation.attention,
    {
      inputKind: 'decision',
      draft: {
        humanEvent: { content: '' },
        action: '',
        reason: '',
        exceptions: input.evaluation.attention.map((item) => ({
          attentionId: item.id,
          rationale: '',
        })),
      },
      outstandingObligations: input.evaluation.attention.map((item) => ({
        code: 'resolve-attention-in-decision',
        targetId: item.id,
        requiredAction: 'Inspect the exact references and either resolve the gap or name an explicit adoption exception.',
      })),
    },
  );
  base.bindsTo.handoffFingerprint = input.handoff.handoffFingerprint;
  return base;
}

export function resolutionAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts?: FactBundle;
}): AuthoringPacket {
  const pending = input.task.pendingResolution;
  const base = packetBase(input.task, input.contract, input.facts, [], [], {
    inputKind: 'resolution',
    draft: {
      humanEvent: { content: '' },
      target: pending ? targetDocument(pending) : {},
      action: '',
      reason: '',
    },
    outstandingObligations: pending ? [{
      code: 'human-resolution-required',
      targetId: pending.targetId,
      requiredAction: 'Record the exact Human choice before the workflow continues.',
    }] : [],
  });
  return base;
}

function packetBase(
  task: TaskProjection,
  contract: TaskContract,
  facts: FactBundle | undefined,
  challenges: IndependentChallenge[],
  attention: HandoffEvaluation['attention'],
  content: Pick<AuthoringPacket, 'inputKind' | 'draft' | 'outstandingObligations'>,
): AuthoringPacket {
  const comparisons = new Map(facts?.checkComparisons.map((item) =>
    [item.definitionId, item.relation]) ?? []);
  const factChecks = new Map(facts?.checks.map((item) => [item.definitionId, item]) ?? []);
  return {
    ...content,
    bindsTo: {
      taskId: task.taskId,
      revision: task.revision,
      effectiveContractId: contract.effectiveContractId,
      attemptId: task.currentAttemptId,
      ...(facts ? { factCollectionId: facts.factCollectionId } : {}),
    },
    referenceCatalog: {
      conditions: contract.adoptionConditions.map((condition) => ({
        id: condition.id,
        key: condition.key,
        statement: condition.statement,
        criticality: condition.criticality,
        obligationIds: condition.evidenceObligations.map((item) => item.id),
      })),
      obligations: allObligations(contract).map((obligation) => ({
        id: obligation.id,
        conditionId: obligation.conditionId,
        statement: obligation.statement,
        failureHypothesis: obligation.failureHypothesis,
      })),
      checks: contract.verificationPlan.mode === 'checks'
        ? contract.verificationPlan.definitions.map((definition) => {
            const fact = factChecks.get(definition.definitionId);
            return {
              verifierId: definition.verifierId,
              definitionId: definition.definitionId,
              key: definition.key,
              ...(fact ? { latestStatus: latestStatus(fact) } : {}),
              ...(comparisons.has(definition.definitionId)
                ? { baselineRelation: comparisons.get(definition.definitionId)! } : {}),
              logPaths: fact ? fact.attempts.flatMap((attempt) =>
                [attempt.stdout.logPath, attempt.stderr.logPath]
                  .filter((path): path is string => Boolean(path))) : [],
            };
          }) : [],
      changedFiles: facts?.changedFiles.map((file) => ({
        id: file.id, path: file.path, operation: file.operation,
      })) ?? [],
      challenges: challenges.map((challenge) => ({
        id: challenge.id,
        obligationIds: challenge.obligationIds,
        outcome: challenge.outcome,
      })),
      attention,
    },
  };
}

function targetDocument(pending: NonNullable<TaskProjection['pendingResolution']>) {
  if (pending.kind === 'semantic-impact') {
    return { kind: pending.kind, dispositionId: pending.targetId };
  }
  if (pending.kind === 'correction') {
    return { kind: pending.kind, decisionId: pending.targetId };
  }
  return { kind: pending.kind, requirementId: pending.targetId };
}

function allObligations(contract: TaskContract) {
  return contract.adoptionConditions.flatMap((condition) => condition.evidenceObligations);
}

function currentDefinitionIds(
  obligation: ReturnType<typeof allObligations>[number],
  contract: TaskContract,
): string[] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  const verifierIds = new Set(obligation.strategies.flatMap((strategy) =>
    strategy.kind === 'runtime-check' ? strategy.verifierIds : []));
  return contract.verificationPlan.definitions
    .filter((definition) => verifierIds.has(definition.verifierId))
    .map((definition) => definition.definitionId);
}

function repositoryEvidenceIds(obligation: ReturnType<typeof allObligations>[number]): string[] {
  return obligation.strategies.flatMap((strategy) =>
    strategy.kind === 'repository-inspection' ? strategy.repositoryEvidenceIds : []);
}

function latestStatus(check: FactBundle['checks'][number]): string {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return latest.status;
}
