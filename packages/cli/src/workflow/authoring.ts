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
  shapeRef?: AuthoringShapeName;
  instruction: string;
}

export type AuthoringShapeName =
  | 'verification-baseline'
  | 'handoff-evidence-reference'
  | 'residual-unknown'
  | 'review-question';

export interface AuthoringPacket {
  inputKind:
    | 'diagnosis'
    | 'verification-revision'
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
    exactDeveloperEvents: {
      authority: 'human-event';
      events: TaskContract['humanEvents'];
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
  shapeCatalog?: Partial<Record<AuthoringShapeName, unknown[]>>;
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
      falsification: TaskContract['adoptionConditions'][number]['evidenceObligations'][number]['falsification'];
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
      conclusion: string;
      counterEvidence: IndependentChallenge['counterEvidence'];
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
  challenges?: IndependentChallenge[];
}): AuthoringPacket {
  const adverseChallenges = (input.challenges ?? []).filter((challenge) =>
    challenge.outcome !== 'supported');
  const concerns = [
    ...input.facts.evidenceConcerns.map((concern) => ({
      source: concern,
      code: concern.observation === 'current-nonpassing'
        ? 'diagnose-nonpassing-check'
        : 'diagnose-baseline-expectation-mismatch',
      targetId: concern.definitionId,
      action: concern.observation === 'current-nonpassing'
        ? 'Classify the observed current check cause and state how that diagnosis was challenged.'
        : 'Explain why the declared baseline/current expectation did not match observation; do not treat this observation alone as a production-code defect.',
    })),
    ...adverseChallenges.map((challenge) => ({
      source: { kind: 'challenge' as const, challengeId: challenge.id, observation: 'adverse' as const },
      code: 'diagnose-adverse-challenge',
      targetId: challenge.id,
      action: 'Classify the adverse Challenge without asking another Challenger to choose the engineering route.',
    })),
  ];
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    input.challenges ?? [],
    [],
    adverseChallenges.length ? ['checks', 'challenges'] : ['checks'],
    {
    inputKind: 'diagnosis',
    draft: {
      semanticImpact: '',
      proposedRoute: '',
      routeRationale: '',
      entries: concerns.map((concern) => ({
        source: concern.source,
        cause: '',
        diagnosis: '',
        falsificationAttempt: '',
        repositoryChangeCanAlterObservation: false,
        changeSurface: '',
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
      textRequirement(
        'draft.routeRationale', 'agent-judgment',
        'Explain why the selected route follows from the diagnosed evidence without changing the compiled task meaning implicitly.',
      ),
      ...concerns.flatMap((_, index) => [
        choiceRequirement(
          `draft.entries[${index}].cause`, 'agent-judgment', EVIDENCE_CAUSES,
          'Classify the observed cause from current evidence; Runtime does not infer it.',
        ),
        choiceRequirement(
          `draft.entries[${index}].changeSurface`, 'agent-judgment',
          ['production', 'verification-surface', 'none'],
          'Declare whether the next observation can change through production code, a repository verifier surface, or no repository edit.',
        ),
        textRequirement(
          `draft.entries[${index}].diagnosis`, 'agent-judgment',
          'State the bounded diagnosis supported by the current observation.',
        ),
        textRequirement(
          `draft.entries[${index}].falsificationAttempt`, 'agent-judgment',
          'Describe the concrete attempt made to disprove this diagnosis.',
        ),
        textRequirement(
          `draft.entries[${index}].expectedDifferentObservation`, 'agent-judgment',
          'State the observable result that would distinguish the proposed cause or route from the current one.',
        ),
      ]),
    ],
    outstandingObligations: concerns.map((concern) => ({
      code: concern.code,
      targetId: concern.targetId,
      requiredAction: concern.action,
    })),
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
        execution: {
          preparation: definition.execution.preparation.map((step) => ({
            key: step.key,
            argv: step.argv,
          })),
          assertion: { argv: definition.execution.assertion.argv },
        },
        executionInputs: definition.executionInputs,
        baseline: definition.baseline.mode === 'task-start'
          ? {
              mode: 'task-start',
              rationale: definition.baseline.rationale,
              expectation: definition.baseline.expectation,
              obligationKeys: definition.baseline.obligationIds.map((id) =>
                obligationKeys.get(id)!),
            }
          : { mode: 'unknown' },
        verifierSelectors: definition.verifierRefs,
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
      textRequirement(
        'draft.rationale', 'agent-judgment',
        'Explain why the revision is required and what observation it is intended to restore.',
      ),
      textRequirement(
        'draft.equivalenceClaim', 'agent-judgment',
        'State the bounded engineering-equivalence claim; Runtime records but does not prove it.',
      ),
      ...(checks ?? []).map((_, index) => shapeRequirement(
        `draft.checks[${index}].baseline`, 'agent-judgment', 'verification-baseline',
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
  const conclusionValuesByObligation = new Map(obligations.map((obligation) => [
    obligation.id,
    supportedConclusionAllowed(
      obligation.id,
      input.requiredObligationIds,
      input.challenges,
    ) ? [...CONCLUSION_STATUSES] : CONCLUSION_STATUSES.filter((status) => status !== 'supported'),
  ] as const));
  const conclusionValuesByCondition = new Map(input.contract.adoptionConditions.map((condition) => [
    condition.id,
    condition.evidenceObligations.every((obligation) =>
      conclusionValuesByObligation.get(obligation.id)!.includes('supported'))
      ? [...CONCLUSION_STATUSES]
      : CONCLUSION_STATUSES.filter((status) => status !== 'supported'),
  ] as const));
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
        evidenceCoverage: {
          status: '',
          rationale: '',
          gaps: [],
        },
        falsification: {
          attempt: '',
          observedResult: '',
        },
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
      reviewQuestions: [],
      recommendation: { action: '', rationale: '', caveats: [] },
    },
    fieldRequirements: [
      textRequirement(
        'draft.summary', 'agent-judgment',
        'Summarize what the actual collected change means for the system.',
      ),
      ...obligations.flatMap((obligation, index) => [
        choiceRequirement(
        `draft.obligationConclusions[${index}].status`, 'agent-judgment',
        conclusionValuesByObligation.get(obligation.id)!,
        'Conclude the bounded obligation without exceeding its cited evidence and challenge outcome.',
        ),
        choiceRequirement(
          `draft.obligationConclusions[${index}].evidenceCoverage.status`,
          'agent-judgment',
          ['sufficient', 'insufficient'],
          'Assess whether the cited evidence covers this bounded conclusion. Runtime does not infer semantic adequacy.',
        ),
        textRequirement(
          `draft.obligationConclusions[${index}].evidenceCoverage.rationale`,
          'agent-judgment',
          'Explain why the cited evidence is sufficient or identify why it cannot support the whole bounded conclusion.',
        ),
        textRequirement(
          `draft.obligationConclusions[${index}].evidenceCoverage.gaps[]`,
          'agent-judgment',
          'When coverage is insufficient, name every concrete part of the bounded conclusion that current evidence does not cover; otherwise keep the array empty.',
        ),
        textRequirement(
          `draft.obligationConclusions[${index}].falsification.attempt`, 'agent-judgment',
          'Describe how the frozen falsification scenario was executed or inspected.',
        ),
        textRequirement(
          `draft.obligationConclusions[${index}].falsification.observedResult`, 'agent-judgment',
          'State the actual observed result without converting it into a Runtime fact.',
        ),
        textRequirement(
          `draft.obligationConclusions[${index}].conclusion`, 'agent-judgment',
          'State the bounded evidence conclusion and preserve adverse or missing evidence.',
        ),
        shapeRequirement(
          `draft.obligationConclusions[${index}].evidence[]`, 'agent-judgment',
          'handoff-evidence-reference',
          'Use a direct exact evidence reference; this array does not accept a statement/references wrapper.',
        ),
        shapeRequirement(
          `draft.obligationConclusions[${index}].counterEvidence[]`, 'agent-judgment',
          'handoff-evidence-reference',
          'Use direct exact references for adverse evidence; leave the array empty only when none was found.',
        ),
      ]),
      ...input.contract.adoptionConditions.flatMap((condition, index) => [
        choiceRequirement(
        `draft.conditionConclusions[${index}].status`, 'agent-judgment',
        conclusionValuesByCondition.get(condition.id)!,
        'Conclude the condition without exceeding any of its obligation conclusions.',
        ),
        textRequirement(
          `draft.conditionConclusions[${index}].summary`, 'agent-judgment',
          'Explain how the obligation conclusions bound this condition conclusion.',
        ),
      ]),
      shapeRequirement(
        'draft.residualUnknowns[]', 'agent-judgment', 'residual-unknown',
        'Add one item for each adoption-relevant unknown; keep the array empty only when none remains.',
      ),
      shapeRequirement(
        'draft.reviewQuestions[]', 'agent-judgment', 'review-question',
        'Keep this array empty unless direct inspection can change adoption judgment. When required, consolidate related obligations into the fewest consequence-directed questions and use exact current references.',
      ),
      choiceRequirement(
        'draft.recommendation.action', 'agent-judgment', RECOMMENDATION_ACTIONS,
        'Give Agent advice only; accept is valid only when every conclusion is supported, required Challenges are trusted and favorable, checks pass, and no adoption-changing unknown or integrity blocker remains.',
      ),
      textRequirement(
        'draft.recommendation.rationale', 'agent-judgment',
        'Explain the recommendation in terms of the current conditions, evidence, and remaining attention.',
      ),
    ],
    outstandingObligations: [
      ...obligations.map((obligation) => ({
        code: 'conclude-evidence-obligation',
        targetId: obligation.id,
        requiredAction: 'State the bounded conclusion, explicit evidence-coverage assessment, falsification attempt, supporting evidence, and counter-evidence.',
      })),
      ...input.contract.adoptionConditions.map((condition) => ({
        code: 'conclude-adoption-condition',
        targetId: condition.id,
        requiredAction: 'Conclude the condition without exceeding its obligation conclusions.',
      })),
      ...input.contract.adoptionConditions
        .filter((condition) => condition.criticality === 'adoption-critical')
        .map((condition) => ({
          code: 'adoption-critical-review-required',
          targetId: condition.id,
          requiredAction: 'Add consequence-directed Review Map coverage for this condition. One question may cover multiple related conditions or obligations when its exact targets and adoption impact are explicit.',
        })),
      ...input.requiredObligationIds.filter((id) =>
        !challengeByObligation.has(id)).map((id) => ({
        code: input.challengeAttestationAvailable === false
          ? 'direct-human-review-required'
          : 'required-challenge-missing',
        targetId: id,
        requiredAction: input.challengeAttestationAvailable === false
          ? 'The current Host cannot attest a fresh challenger context. Keep the conclusion below supported and give the developer a concrete direct-review question.'
          : 'Complete and record the required challenge before claiming support.',
      })),
      ...input.requiredObligationIds.filter((id) => {
        const challenge = challengeByObligation.get(id);
        return challenge && challenge.independence !== 'host-attested';
      }).map((id) => ({
        code: 'direct-human-review-required',
        targetId: id,
        requiredAction: 'The recorded Challenger output has no verified Host lifecycle receipt. Keep the conclusion below supported and direct the developer to inspect the unresolved failure hypothesis.',
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
      ), textRequirement(
        'draft.humanEvent.content', 'human-decision',
        'Preserve the developer\'s exact new decision message.',
      ), textRequirement(
        'draft.reason', 'human-decision',
        'State why the exact Human decision follows from the reviewed packet.',
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
  const pendingResolutionActions = HUMAN_RESOLUTION_ACTIONS;
  const base = packetBase(input.task, input.contract, input.facts, [], [], [], {
    inputKind: 'resolution',
    draft: {
      humanEvent: { content: '' },
      target: pending ? targetDocument(pending) : {},
      action: '',
      reason: '',
    },
    fieldRequirements: [choiceRequirement(
      'draft.action', 'human-decision', pendingResolutionActions,
      'Normalize the developer\'s exact mid-task resolution without altering the prefilled target.',
    ), textRequirement(
      'draft.humanEvent.content', 'human-decision',
      'Preserve the developer\'s exact new resolution message.',
    ), textRequirement(
      'draft.reason', 'human-decision',
      'State why this resolution should control the pending target.',
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
  const shapeNames = [...new Set(content.fieldRequirements.flatMap((requirement) =>
    requirement.shapeRef ? [requirement.shapeRef] : []))];
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
      exactDeveloperEvents: {
        authority: 'human-event',
        events: contract.humanEvents,
      },
      agentInterpretation: {
        authority: 'agent-judgment',
        desiredOutcome: contract.understanding.desiredOutcome.value,
        constraints: contract.understanding.constraints.map((item) => item.value),
        nonGoals: contract.understanding.nonGoals.map((item) => item.value),
        focus: contract.understanding.focus.map((item) => item.value),
      },
    },
    ...(shapeNames.length ? {
      shapeCatalog: Object.fromEntries(shapeNames.map((name) => [name, AUTHORING_SHAPES[name]])),
    } : {}),
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
        falsification: obligation.falsification,
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
        conclusion: challenge.conclusion,
        counterEvidence: challenge.counterEvidence,
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
  shapeRef: AuthoringShapeName,
  instruction: string,
): AuthoringFieldRequirement {
  return { path, authority, shapeRef, instruction };
}

function textRequirement(
  path: string,
  authority: AuthoringFieldRequirement['authority'],
  instruction: string,
): AuthoringFieldRequirement {
  return { path, authority, instruction };
}

function supportedConclusionAllowed(
  obligationId: string,
  requiredObligationIds: string[],
  challenges: IndependentChallenge[],
): boolean {
  const relevant = challenges.filter((challenge) => challenge.obligationIds.includes(obligationId));
  return relevant.every((challenge) => challenge.outcome === 'supported');
}

function baselineShapes(): unknown[] {
  return [
    { mode: 'unknown' },
    {
      mode: 'task-start',
      rationale: '<non-empty reason why before/after changes this decision>',
      expectation: {
        baselineStatus: '<passed | failed | unavailable>',
        currentStatus: '<passed | failed | unavailable>',
      },
      obligationKeys: [{
        conditionKey: '<referenceCatalog condition key>',
        obligationKey: '<referenceCatalog obligation key>',
      }],
    },
  ];
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

const AUTHORING_SHAPES: Record<AuthoringShapeName, unknown[]> = {
  'verification-baseline': baselineShapes(),
  'handoff-evidence-reference': handoffEvidenceReferenceShapes(),
  'residual-unknown': [residualUnknownShape()],
  'review-question': [reviewQuestionShape()],
};

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
