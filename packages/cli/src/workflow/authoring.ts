import type {
  CognitiveHandoff,
  FactBundle,
  HandoffEvaluation,
  TaskContract,
} from '@sovea/stetra-core';
import { z } from 'zod';

import {
  CONCLUSION_STATUSES,
  EVIDENCE_COVERAGE_STATUSES,
  EvidenceDispositionDocumentSchema,
  HumanDecisionDocumentSchema,
  HumanResolutionDocumentSchema,
  RECOMMENDATION_ACTIONS,
  taskSpecificCognitiveHandoffDocumentSchema,
  type TaskProjection,
  VerificationRevisionDocumentSchema,
} from '../schemas/delegation.ts';
import { stableFingerprint } from '../protocol.ts';

interface AuthoringDetailCommand {
  purpose: string;
  section: string;
  argv: string[];
}

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
  inputSchema: Record<string, unknown>;
  constraints: Record<string, unknown>;
  detailCommands: AuthoringDetailCommand[];
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
      conditionKey: string;
      key: string;
      statement: string;
      falsification: TaskContract['adoptionConditions'][number]['evidenceObligations'][number]['falsification'];
    }>;
    checks?: Array<{
      verifierId: string;
      definitionId: string;
      key: string;
      latestStatus?: string;
      baselineStatus?: string;
      baselineRelation?: string;
      latestAttempt?: number;
    }>;
    changedFiles?: Array<{
      id: string;
      path: string;
      operation: string;
    }>;
    repositoryEvidence?: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
    }>;
    attention?: Array<{ id: string }>;
  };
}

export interface AuthoringGuide {
  inputKind: AuthoringPacket['inputKind'];
  projectionFingerprint: string;
  bindsTo: AuthoringPacket['bindsTo'];
  semanticContext: AuthoringPacket['semanticContext'];
  referenceCatalog: AuthoringPacket['referenceCatalog'];
  constraints: AuthoringPacket['constraints'];
  schema: {
    included: false;
    command: { argv: string[] };
  };
  details: {
    commands: Array<{
      purpose: string;
      section: string;
      argv: string[];
    }>;
  };
}

export type AuthoringStage =
  | 'diagnose'
  | 'revise-verification'
  | 'handoff'
  | 'decide'
  | 'resolve';

const AUTHORING_STAGE_BY_INPUT_KIND: Record<
  AuthoringPacket['inputKind'],
  AuthoringStage
> = {
  diagnosis: 'diagnose',
  'verification-revision': 'revise-verification',
  handoff: 'handoff',
  decision: 'decide',
  resolution: 'resolve',
};

export function authoringStage(inputKind: AuthoringPacket['inputKind']): AuthoringStage {
  return AUTHORING_STAGE_BY_INPUT_KIND[inputKind];
}

export function authoringGuide(packet: AuthoringPacket): AuthoringGuide {
  return {
    inputKind: packet.inputKind,
    projectionFingerprint: stableFingerprint(packet),
    bindsTo: packet.bindsTo,
    semanticContext: packet.semanticContext,
    referenceCatalog: packet.referenceCatalog,
    constraints: packet.constraints,
    schema: {
      included: false,
      command: {
        argv: [
          'stetra', 'change', 'explain', '.', '--task', packet.bindsTo.taskId,
          '--section', 'action-input', '--stage', authoringStage(packet.inputKind),
          '--part', 'schema', '--json',
        ],
      },
    },
    details: {
      commands: packet.detailCommands,
    },
  };
}

export function diagnosisAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
}): AuthoringPacket {
  const concerns = input.facts.evidenceConcerns.map((concern) => ({ source: concern }));
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    [],
    ['checks'],
    {
      inputKind: 'diagnosis',
      constraints: {},
      draft: {
        contractImpact: '',
        entries: concerns.map((concern) => ({
          source: concern.source,
          cause: '',
          diagnosis: '',
          falsificationAttempt: '',
          repositoryChange: { surface: '', intendedChanges: [] },
          expectedDifferentObservation: '',
        })),
        action: { kind: '', rationale: '' },
      },
      inputSchema: jsonSchema(EvidenceDispositionDocumentSchema),
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
        execution: {
          preparation: definition.execution.preparation.map((step) => ({
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
    ['conditions', 'obligations', 'checks'],
    {
      inputKind: 'verification-revision',
      constraints: {},
      draft: {
        kind: '',
        rationale: '',
        equivalenceClaim: '',
        ...(checks ? { checks } : {
          noCommandRationale: input.contract.verificationPlan.mode === 'no-command'
            ? input.contract.verificationPlan.rationale : '',
        }),
      },
      inputSchema: jsonSchema(VerificationRevisionDocumentSchema),
    },
  );
}

export function handoffAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  requiredObligationIds: string[];
}): AuthoringPacket {
  const checkStatusByDefinition = new Map(input.facts.checks.map((check) =>
    [check.definitionId, latestStatus(check)] as const));
  const checkKeyByDefinition = new Map(input.contract.verificationPlan.mode === 'checks'
    ? input.contract.verificationPlan.definitions.map((definition) =>
        [definition.definitionId, definition.key] as const)
    : []);
  const constraints = deriveHandoffAuthoringConstraints(input);
  const prefilledReviewConditionIds = new Set(input.contract.adoptionConditions
    .filter((condition) => condition.criticality === 'adoption-critical'
      || !constraints.conclusionValuesByCondition.get(condition.id)!.includes('supported')
      || condition.evidenceObligations.some((obligation) =>
        !constraints.conclusionValuesByObligation.get(obligation.id)!.includes('supported')))
    .map((condition) => condition.id));
  const documentSchema = handoffDocumentSchema(input);
  const constraintsDocument = {
    conditions: input.contract.adoptionConditions.map((condition) => ({
      key: condition.key,
      allowedStatuses: constraints.conclusionValuesByCondition.get(condition.id)!,
      obligations: condition.evidenceObligations.map((obligation) => ({
        key: obligation.key,
        allowedStatuses: constraints.conclusionValuesByObligation.get(obligation.id)!,
      })),
    })),
    recommendationActions: constraints.recommendationActions,
    evidenceCoverageStatuses: EVIDENCE_COVERAGE_STATUSES,
  };
  return packetBase(
    input.task,
    input.contract,
    input.facts,
    [],
    ['conditions', 'obligations', 'checks', 'changedFiles', 'repositoryEvidence'],
    {
      inputKind: 'handoff',
      constraints: constraintsDocument,
      draft: {
        actualChange: {
          behavior: '',
          mechanism: [''],
          preservedInvariants: [],
          failureAndRecovery: [],
          importantEffects: [],
          materialTradeoffs: [],
        },
        conditions: input.contract.adoptionConditions.map((condition) => ({
          conditionKey: condition.key,
          status: '',
          summary: '',
          reviewDecisionKeys: prefilledReviewConditionIds.has(condition.id)
            ? [`review-${condition.key}`]
            : [],
          obligations: condition.evidenceObligations.map((obligation) => ({
            obligationKey: obligation.key,
            status: '',
            reviewDecisionKeys: prefilledReviewConditionIds.has(condition.id)
              ? [`review-${condition.key}`]
              : [],
            evidence: [
              ...currentDefinitionIds(obligation, input.contract)
                .filter((id) => checkStatusByDefinition.get(id) === 'passed')
                .map((id) => ({ kind: 'check', key: checkKeyByDefinition.get(id)! })),
              ...repositoryEvidenceIds(obligation).map((id) => ({ kind: 'repository-evidence', id })),
            ],
            evidenceCoverage: { status: '', rationale: '', gaps: [] },
            falsification: { attempt: '', observedResult: '' },
            counterEvidence: [
              ...currentDefinitionIds(obligation, input.contract)
                .filter((id) => checkStatusByDefinition.get(id) !== 'passed')
                .map((id) => ({ kind: 'check', key: checkKeyByDefinition.get(id)! })),
            ],
            conclusion: '',
          })),
        })),
        residualUnknowns: [],
        reviewDecisions: input.contract.adoptionConditions
          .filter((condition) => prefilledReviewConditionIds.has(condition.id))
          .map((condition) => ({
            key: `review-${condition.key}`,
            conditionKeys: [condition.key],
            obligationKeys: condition.evidenceObligations.map((obligation) => ({
              conditionKey: condition.key,
              obligationKey: obligation.key,
            })),
            question: '',
            adoptionImpact: condition.adoptionRationale,
            nextAction: '',
            evidence: [],
          })),
        recommendation: { action: '', rationale: '', caveats: [] },
      },
      inputSchema: jsonSchema(documentSchema),
    },
  );
}

export function decisionAuthoringPacket(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  handoff: CognitiveHandoff;
  evaluation: HandoffEvaluation;
}): AuthoringPacket {
  const base = packetBase(
    input.task, input.contract, input.facts, input.evaluation.attention,
    ['attention'],
    {
      inputKind: 'decision',
      constraints: {},
      draft: {
        humanEvent: { content: '' },
        action: '',
        reason: '',
        exceptions: input.evaluation.attention.map((item) => ({
          attentionId: item.id,
          rationale: '',
        })),
      },
      inputSchema: jsonSchema(HumanDecisionDocumentSchema),
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
    constraints: {},
    draft: {
      humanEvent: { content: '' },
      target: pending ? targetDocument(pending) : {},
      action: '',
      reason: '',
    },
    inputSchema: jsonSchema(HumanResolutionDocumentSchema),
  });
  return base;
}

function packetBase(
  task: TaskProjection,
  contract: TaskContract,
  facts: FactBundle | undefined,
  attention: HandoffEvaluation['attention'],
  catalogSelection: Array<keyof AuthoringPacket['referenceCatalog']>,
  content: Pick<
    AuthoringPacket,
    'inputKind' | 'draft' | 'inputSchema' | 'constraints'
  >,
): AuthoringPacket {
  const comparisons = new Map(facts?.checkComparisons.map((item) =>
    [item.definitionId, item.relation]) ?? []);
  const factChecks = new Map(facts?.checks.map((item) => [item.definitionId, item]) ?? []);
  const baselineChecks = new Map(facts?.baselineVerification.checks.map((item) =>
    [item.definitionId, item.observation]) ?? []);
  const referenceCatalog = selectedCatalog(catalogSelection, {
      conditions: contract.adoptionConditions.map((condition) => ({
        id: condition.id,
        key: condition.key,
        statement: condition.statement,
        criticality: condition.criticality,
        obligationIds: condition.evidenceObligations.map((item) => item.id),
      })),
      obligations: contract.adoptionConditions.flatMap((condition) =>
        condition.evidenceObligations.map((obligation) => ({
          id: obligation.id,
          conditionId: obligation.conditionId,
          conditionKey: condition.key,
          key: obligation.key,
          statement: obligation.statement,
          falsification: obligation.falsification,
        }))),
      checks: contract.verificationPlan.mode === 'checks'
        ? contract.verificationPlan.definitions.map((definition) => {
            const fact = factChecks.get(definition.definitionId);
            return {
              verifierId: definition.verifierId,
              definitionId: definition.definitionId,
              key: definition.key,
              ...(fact ? {
                latestStatus: latestStatus(fact),
                latestAttempt: fact.attempts.at(-1)?.attempt,
              } : {}),
              ...(baselineChecks.get(definition.definitionId) ? {
                baselineStatus: latestStatus(baselineChecks.get(definition.definitionId)!),
              } : {}),
              ...(comparisons.has(definition.definitionId)
                ? { baselineRelation: comparisons.get(definition.definitionId)! } : {}),
            };
          }) : [],
      changedFiles: facts?.changedFiles.map((file) => ({
        id: file.id, path: file.path, operation: file.operation,
      })) ?? [],
      repositoryEvidence: contract.repositoryEvidence.map((evidence) => ({
        id: evidence.id,
        path: evidence.path,
        startLine: evidence.startLine,
        endLine: evidence.endLine,
      })),
      attention: attention.map((item) => ({ id: item.id })),
    });
  const detailCommands = authoringDetailCommands(
    content.inputKind,
    task.taskId,
    task.currentAttemptId,
    facts,
  );
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
    referenceCatalog,
    detailCommands,
  };
}

function authoringDetailCommands(
  inputKind: AuthoringPacket['inputKind'],
  taskId: string,
  attemptId: string,
  facts: FactBundle | undefined,
): AuthoringDetailCommand[] {
  if (!facts || inputKind === 'decision' || inputKind === 'resolution') return [];
  const concerningDefinitionIds = new Set(facts.evidenceConcerns
    .filter((concern) => concern.kind === 'check')
    .map((concern) => concern.definitionId));
  const selectedChecks = inputKind === 'verification-revision'
    ? facts.checks
    : inputKind === 'diagnosis'
      ? facts.checks.filter((check) => concerningDefinitionIds.has(check.definitionId))
      : facts.checks.filter((check) => latestStatus(check) !== 'passed'
        || facts.checkComparisons.some((comparison) =>
          comparison.definitionId === check.definitionId
          && comparison.relation !== 'baseline-unknown'));
  const commands = selectedChecks.flatMap((check) => {
    const latest = check.attempts.at(-1)!;
    const base = [
      'stetra', 'change', 'explain', '.', '--task', taskId,
      '--attempt', attemptId, '--definition', check.definitionId,
    ];
    const result: AuthoringDetailCommand[] = [{
      purpose: `Inspect the exact latest Check Attempt for ${check.definitionId}.`,
      section: 'check-attempt',
      argv: [...base, '--check-attempt', String(latest.attempt), '--section', 'check-attempt', '--json'],
    }];
    for (const stream of ['stdout', 'stderr'] as const) {
      if (latest[stream].persistedBytes === 0) continue;
      result.push({
        purpose: `Inspect the bounded ${stream} tail for ${check.definitionId}.`,
        section: 'log',
        argv: [...base, '--check-attempt', String(latest.attempt), '--stream', stream,
          '--tail-bytes', '8192', '--section', 'log', '--json'],
      });
    }
    return result;
  });
  if (inputKind === 'handoff') {
    for (const check of selectedChecks) {
      const baseline = facts.baselineVerification.checks.find((item) =>
        item.definitionId === check.definitionId)?.observation;
      if (!baseline) continue;
      const latest = baseline.attempts.at(-1)!;
      const base = [
        'stetra', 'change', 'explain', '.', '--task', taskId,
        '--attempt', 'baseline', '--definition', check.definitionId,
      ];
      commands.push({
        purpose: `Inspect the Runtime-recorded baseline Check Attempt for ${check.definitionId}.`,
        section: 'check-attempt',
        argv: [...base, '--check-attempt', String(latest.attempt), '--section', 'check-attempt', '--json'],
      });
      for (const stream of ['stdout', 'stderr'] as const) {
        if (latest[stream].persistedBytes === 0) continue;
        commands.push({
          purpose: `Inspect the bounded baseline ${stream} tail for ${check.definitionId}.`,
          section: 'log',
          argv: [...base, '--check-attempt', String(latest.attempt), '--stream', stream,
            '--tail-bytes', '8192', '--section', 'log', '--json'],
        });
      }
    }
  }
  return commands;
}

function selectedCatalog(
  selection: Array<keyof AuthoringPacket['referenceCatalog']>,
  catalog: Required<AuthoringPacket['referenceCatalog']>,
): AuthoringPacket['referenceCatalog'] {
  return Object.fromEntries(selection.map((key) => [key, catalog[key]]));
}

function deriveHandoffAuthoringConstraints(input: {
  task: TaskProjection;
  contract: TaskContract;
  facts: FactBundle;
  requiredObligationIds: string[];
}) {
  const obligations = allObligations(input.contract);
  const conclusionValuesByObligation = new Map(obligations.map((obligation) => [
    obligation.id,
    supportedConclusionAllowed(
      obligation.id,
      input.requiredObligationIds,
    ) ? [...CONCLUSION_STATUSES] : CONCLUSION_STATUSES.filter((status) => status !== 'supported'),
  ] as const));
  const conclusionValuesByCondition = new Map(input.contract.adoptionConditions.map((condition) => [
    condition.id,
    condition.evidenceObligations.every((obligation) =>
      conclusionValuesByObligation.get(obligation.id)!.includes('supported'))
      ? [...CONCLUSION_STATUSES]
      : CONCLUSION_STATUSES.filter((status) => status !== 'supported'),
  ] as const));
  const acceptanceAdviceAllowed = [...conclusionValuesByCondition.values()].every((values) =>
    values.includes('supported'))
    && input.facts.checks.every((check) => latestStatus(check) === 'passed')
    && input.facts.changedFiles.every((file) => file.representation !== 'unrepresentable')
    && input.contract.hostPolicyRequirements.every((requirement) =>
      requirement.enforcementRequirement !== 'required');

  return {
    conclusionValuesByObligation,
    conclusionValuesByCondition,
    recommendationActions: acceptanceAdviceAllowed
      ? [...RECOMMENDATION_ACTIONS]
      : RECOMMENDATION_ACTIONS.filter((action) => action !== 'accept'),
  };
}

function supportedConclusionAllowed(
  obligationId: string,
  requiredObligationIds: string[],
): boolean {
  return !requiredObligationIds.includes(obligationId);
}

export function handoffDocumentSchema(input: Parameters<typeof handoffAuthoringPacket>[0]) {
  const constraints = deriveHandoffAuthoringConstraints(input);
  return taskSpecificCognitiveHandoffDocumentSchema({
    conditions: input.contract.adoptionConditions.map((condition) => ({
      key: condition.key,
      critical: condition.criticality === 'adoption-critical',
      allowedStatuses: constraints.conclusionValuesByCondition.get(condition.id)!,
      obligations: condition.evidenceObligations.map((obligation) => ({
        key: obligation.key,
        allowedStatuses: constraints.conclusionValuesByObligation.get(obligation.id)!,
      })),
    })),
    recommendationActions: constraints.recommendationActions,
  });
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { reused: 'ref' }) as Record<string, unknown>;
}

function targetDocument(pending: NonNullable<TaskProjection['pendingResolution']>) {
  if (pending.kind === 'semantic-impact') {
    return { kind: pending.kind, dispositionId: pending.targetId };
  }
  if (pending.kind === 'correction') {
    return { kind: pending.kind, decisionId: pending.targetId };
  }
  return { kind: pending.kind, requirementIds: pending.targetIds };
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
