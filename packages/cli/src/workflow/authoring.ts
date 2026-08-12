import type {
  CognitiveHandoff,
  FactBundle,
  HandoffEvaluation,
  IndependentChallenge,
  TaskContract,
} from '@sovea/stetra-core';

import {
  CONCLUSION_STATUSES,
  EVIDENCE_CAUSES,
  EVIDENCE_ROUTES,
  EVIDENCE_SEMANTIC_IMPACTS,
  HUMAN_DECISION_ACTIONS,
  HUMAN_RESOLUTION_ACTIONS,
  RECOMMENDATION_ACTIONS,
  type TaskProjection,
  VERIFICATION_REVISION_KINDS,
} from '../schemas/delegation.ts';

export interface AuthoringFieldRequirement {
  path: string;
  authority: 'agent-judgment' | 'human-decision';
  allowedValues?: string[];
  acceptedShapes?: unknown[];
  instruction: string;
}

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
  semanticContext: {
    exactDeveloperEvent: {
      authority: 'human-event';
      event: TaskContract['authority']['developerEvent'];
    };
    agentInterpretation: {
      authority: 'agent-judgment';
      desiredOutcome: string;
      constraints: string[];
      nonGoals: string[];
      focus: string[];
    };
  };
  draft: unknown;
  fieldRequirements: AuthoringFieldRequirement[];
  referenceCatalog: {
    conditions?: Array<{
      id: string;
      key: string;
      statement: string;
      criticality: string;
      obligationIds: string[];
    }>;
    obligations?: Array<{
      id: string;
      conditionId: string;
      statement: string;
      failureHypothesis: string;
    }>;
    checks?: Array<{
      verifierId: string;
      definitionId: string;
      key: string;
      latestStatus?: string;
      baselineRelation?: string;
      logPaths: string[];
    }>;
    changedFiles?: Array<{
      id: string;
      path: string;
      operation: string;
    }>;
    challenges?: Array<{
      id: string;
      obligationIds: string[];
      outcome: string;
    }>;
    repositoryEvidence?: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
    }>;
    attention?: Array<{ id: string }>;
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
  return packetBase(input.task, input.contract, input.facts, [], [], ['checks'], {
    inputKind: 'diagnosis',
    draft: {
      semanticImpact: '',
      proposedRoute: '',
      routeRationale: '',
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
    fieldRequirements: [
      choiceRequirement(
        'draft.semanticImpact', 'agent-judgment', EVIDENCE_SEMANTIC_IMPACTS,
        'Choose whether the diagnosed evidence gap changes the compiled task meaning.',
      ),
      choiceRequirement(
        'draft.proposedRoute', 'agent-judgment', EVIDENCE_ROUTES,
        'Choose the next lifecycle route explicitly. A bounded implementation repair may coexist with environment or verification entries, which remain visible and are rerun; unknown cause cannot be repaired.',
      ),
      ...nonpassing.map((_, index) => choiceRequirement(
        `draft.entries[${index}].cause`, 'agent-judgment', EVIDENCE_CAUSES,
        'Classify the observed cause from current evidence; Runtime does not infer it.',
      )),
    ],
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
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    input.challenges,
    [],
    ['conditions', 'obligations', 'checks', 'changedFiles', 'challenges', 'repositoryEvidence'],
    {
    inputKind: 'challenge',
    draft,
    fieldRequirements: obligation ? [
      choiceRequirement(
        'draft.outcome', 'agent-judgment', CONCLUSION_STATUSES,
        'Choose the bounded outcome after performing the stated falsification attempt.',
      ),
      shapeRequirement(
        'draft.supportingEvidence[]', 'agent-judgment', [challengeEvidenceItemShape()],
        'Each support claim must cite one or more exact current evidence references.',
      ),
      shapeRequirement(
        'draft.counterEvidence[]', 'agent-judgment', [challengeEvidenceItemShape()],
        'Use exact references for adverse evidence; leave the array empty only when none was found.',
      ),
    ] : [],
    outstandingObligations: targetId ? [{
      code: 'perform-independent-challenge',
      targetId,
      requiredAction: 'Use a genuinely separate context when the Host can attest it, then test the stated failure hypothesis against exact evidence.',
    }] : [],
    },
  );
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
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    [],
    [],
    ['conditions', 'obligations', 'checks'],
    {
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
    fieldRequirements: [
      choiceRequirement(
        'draft.kind', 'agent-judgment', VERIFICATION_REVISION_KINDS,
        'Choose execution-rebinding only for a claimed equivalent execution binding; verification-plan changes the evidence plan.',
      ),
      ...(checks ?? []).map((_, index) => shapeRequirement(
        `draft.checks[${index}].baseline`, 'agent-judgment', baselineShapes(),
        'Use exactly one baseline variant. For execution-rebinding, preserve this prefilled object and its array ordering exactly; only argv may change. Unknown has no rationale or obligationKeys fields.',
      )),
    ],
    outstandingObligations: input.facts.checks
      .filter((check) => latestStatus(check) !== 'passed')
      .map((check) => ({
        code: 'revise-invalid-verification-definition',
        targetId: check.definitionId,
        requiredAction: 'State the bounded definition change and why its engineering semantics are claimed equivalent; Human authority is required for mechanical relaxation.',
      })),
    },
  );
}

export function handoffAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  challenges: IndependentChallenge[];
  requiredObligationIds: string[];
  challengeAttestationAvailable?: boolean;
}): AuthoringPacket {
  const challengeByObligation = new Map(input.challenges.flatMap((challenge) =>
    challenge.obligationIds.map((id) => [id, challenge] as const)));
  const checkStatusByDefinition = new Map(input.facts.checks.map((check) =>
    [check.definitionId, latestStatus(check)] as const));
  const obligations = allObligations(input.contract);
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    input.challenges,
    [],
    ['conditions', 'obligations', 'checks', 'changedFiles', 'challenges', 'repositoryEvidence'],
    {
    inputKind: 'handoff',
    draft: {
      summary: '',
      obligationConclusions: obligations.map((obligation) => ({
        obligationId: obligation.id,
        status: '',
        evidence: [
          ...currentDefinitionIds(obligation, input.contract)
            .filter((id) => checkStatusByDefinition.get(id) === 'passed')
            .map((id) => ({ kind: 'check', id })),
          ...repositoryEvidenceIds(obligation).map((id) => ({ kind: 'repository-evidence', id })),
          ...(challengeByObligation.get(obligation.id)?.outcome === 'supported'
            ? [{ kind: 'challenge', id: challengeByObligation.get(obligation.id)!.id }] : []),
        ],
        falsificationAttempt: '',
        counterEvidence: [
          ...currentDefinitionIds(obligation, input.contract)
            .filter((id) => checkStatusByDefinition.get(id) !== 'passed')
            .map((id) => ({ kind: 'check', id })),
          ...(challengeByObligation.has(obligation.id)
            && challengeByObligation.get(obligation.id)!.outcome !== 'supported'
            ? [{ kind: 'challenge', id: challengeByObligation.get(obligation.id)!.id }] : []),
        ],
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
    fieldRequirements: [
      ...obligations.map((_, index) => choiceRequirement(
        `draft.obligationConclusions[${index}].status`, 'agent-judgment', CONCLUSION_STATUSES,
        'Conclude the bounded obligation without exceeding its cited evidence and challenge outcome.',
      )),
      ...obligations.flatMap((_, index) => [
        shapeRequirement(
          `draft.obligationConclusions[${index}].evidence[]`, 'agent-judgment',
          handoffEvidenceReferenceShapes(),
          'Use a direct exact evidence reference; this array does not accept a statement/references wrapper.',
        ),
        shapeRequirement(
          `draft.obligationConclusions[${index}].counterEvidence[]`, 'agent-judgment',
          handoffEvidenceReferenceShapes(),
          'Use direct exact references for adverse evidence; leave the array empty only when none was found.',
        ),
      ]),
      ...input.contract.adoptionConditions.map((_, index) => choiceRequirement(
        `draft.conditionConclusions[${index}].status`, 'agent-judgment', CONCLUSION_STATUSES,
        'Conclude the condition without exceeding any of its obligation conclusions.',
      )),
      shapeRequirement(
        'draft.residualUnknowns[]', 'agent-judgment', [residualUnknownShape()],
        'Add one item for each adoption-relevant unknown; keep the array empty only when none remains.',
      ),
      shapeRequirement(
        'draft.reviewQuestions[]', 'agent-judgment', [reviewQuestionShape()],
        'Review questions use exact current condition, obligation, and evidence references.',
      ),
      choiceRequirement(
        'draft.recommendation.action', 'agent-judgment', RECOMMENDATION_ACTIONS,
        'Give Agent advice only; this value never records Human adoption.',
      ),
    ],
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
        code: input.challengeAttestationAvailable === false
          ? 'direct-human-review-required'
          : 'required-challenge-missing',
        targetId: id,
        requiredAction: input.challengeAttestationAvailable === false
          ? 'The current Host cannot attest a fresh challenger context. Keep the conclusion below supported and give the developer a concrete direct-review question.'
          : 'Complete and record the required challenge before claiming support.',
      })),
    ],
    },
  );
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
    ['attention'],
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
      fieldRequirements: [choiceRequirement(
        'draft.action', 'human-decision', HUMAN_DECISION_ACTIONS,
        'Normalize the developer\'s exact decision message to one supported action.',
      )],
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
  const base = packetBase(input.task, input.contract, input.facts, [], [], [], {
    inputKind: 'resolution',
    draft: {
      humanEvent: { content: '' },
      target: pending ? targetDocument(pending) : {},
      action: '',
      reason: '',
    },
    fieldRequirements: [choiceRequirement(
      'draft.action', 'human-decision', HUMAN_RESOLUTION_ACTIONS,
      'Normalize the developer\'s exact mid-task resolution without altering the prefilled target.',
    )],
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
  catalogSelection: Array<keyof AuthoringPacket['referenceCatalog']>,
  content: Pick<AuthoringPacket, 'inputKind' | 'draft' | 'fieldRequirements' | 'outstandingObligations'>,
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
    semanticContext: {
      exactDeveloperEvent: {
        authority: 'human-event',
        event: contract.authority.developerEvent,
      },
      agentInterpretation: {
        authority: 'agent-judgment',
        desiredOutcome: contract.understanding.desiredOutcome.value,
        constraints: contract.understanding.constraints.map((item) => item.value),
        nonGoals: contract.understanding.nonGoals.map((item) => item.value),
        focus: contract.understanding.focus.map((item) => item.value),
      },
    },
    referenceCatalog: selectedCatalog(catalogSelection, {
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
      repositoryEvidence: contract.repositoryEvidence.map((evidence) => ({
        id: evidence.id,
        path: evidence.path,
        startLine: evidence.startLine,
        endLine: evidence.endLine,
      })),
      attention: attention.map((item) => ({ id: item.id })),
    }),
  };
}

function selectedCatalog(
  selection: Array<keyof AuthoringPacket['referenceCatalog']>,
  catalog: Required<AuthoringPacket['referenceCatalog']>,
): AuthoringPacket['referenceCatalog'] {
  return Object.fromEntries(selection.map((key) => [key, catalog[key]]));
}

function choiceRequirement(
  path: string,
  authority: AuthoringFieldRequirement['authority'],
  allowedValues: readonly string[],
  instruction: string,
): AuthoringFieldRequirement {
  return { path, authority, allowedValues: [...allowedValues], instruction };
}

function shapeRequirement(
  path: string,
  authority: AuthoringFieldRequirement['authority'],
  acceptedShapes: unknown[],
  instruction: string,
): AuthoringFieldRequirement {
  return { path, authority, acceptedShapes, instruction };
}

function baselineShapes(): unknown[] {
  return [
    { mode: 'unknown' },
    {
      mode: 'task-start',
      rationale: '<non-empty reason why before/after changes this decision>',
      obligationKeys: [{
        conditionKey: '<referenceCatalog condition key>',
        obligationKey: '<referenceCatalog obligation key>',
      }],
    },
  ];
}

function challengeEvidenceItemShape() {
  return {
    statement: '<bounded evidence statement>',
    references: [{ kind: '<evidence kind>', id: '<exact referenceCatalog id>' }],
  };
}

function handoffEvidenceReferenceShapes(): unknown[] {
  return [
    { kind: 'changed-file', id: '<exact changed-file id>' },
    { kind: 'check', id: '<exact definition id>' },
    { kind: 'repository-evidence', id: '<exact repository-evidence id>' },
    { kind: 'human-event', id: '<exact human-event id>' },
    { kind: 'challenge', id: '<exact challenge id>' },
    { kind: 'patch' },
  ];
}

function residualUnknownShape() {
  return {
    conditionIds: ['<exact condition id>'],
    obligationIds: ['<exact obligation id>'],
    statement: '<what remains unknown>',
    adoptionImpact: '<how the unknown changes adoption>',
    nextAction: '<specific next investigation or decision>',
    evidence: [{ kind: '<evidence kind>', id: '<exact referenceCatalog id>' }],
  };
}

function reviewQuestionShape() {
  return {
    conditionIds: ['<exact condition id>'],
    obligationIds: ['<exact obligation id>'],
    question: '<consequence-directed review question>',
    adoptionImpact: '<why the answer changes adoption>',
    evidence: [{ kind: '<evidence kind>', id: '<exact referenceCatalog id>' }],
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
