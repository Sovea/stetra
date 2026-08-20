import type {
  AdoptionCondition,
  CheckAttemptFact,
  CheckBaselineRelation,
  EvidenceObligation,
  FactBundle,
  HumanEvent,
  RepositoryEvidence,
  TaskContract,
  VerificationDefinition,
  VerifierMutation,
} from '@sovea/stetra-core';

import { CONCLUSION_STATUSES, type ChallengeDocument, type TaskProjection } from '../schemas/delegation.ts';

type ChallengeTaskBinding = Pick<TaskProjection, 'taskId' | 'revision' | 'currentAttemptId'>;

export interface ChallengeExecutionPacket {
  inputKind: 'challenge-round';
  bindsTo: {
    taskId: string;
    revision: number;
    effectiveContractId: string;
    attemptId: string;
    factCollectionId: string;
    worktreeFingerprint: string;
  };
  sharedEvidence: {
    changedFiles: ChallengeChangedFile[];
    patch: FactBundle['patch'] | null;
  };
  cases: ChallengeCase[];
  draft: ChallengeRoundDocumentDraft;
  output: {
    authority: 'agent-judgment';
    allowedOutcomes: readonly ['supported', 'partial', 'contradicted', 'unknown'];
    allowedCoverageStatuses: readonly ['sufficient', 'insufficient'];
    evidenceItemShape: {
      statement: string;
      provenance: string;
      reproduction: string;
      references: Array<{ kind: string; id?: string }>;
    };
    instruction: string;
  };
}

export interface ChallengeCase {
  target: {
    condition: Pick<
      AdoptionCondition,
      'id' | 'key' | 'statement' | 'adoptionRationale' | 'criticality'
    > & { authority: 'agent-judgment' };
    obligation: Pick<
      EvidenceObligation,
      'id' | 'key' | 'conditionId' | 'statement' | 'falsification' | 'strategies'
    > & { authority: 'agent-judgment' };
    exactDeveloperEvents: {
      authority: 'human-event';
      events: HumanEvent[];
    };
  };
  evidence: {
    checks: ChallengeCheck[];
    repositoryEvidence: ChallengeRepositoryEvidence[];
    verifierMutations: VerifierMutation[];
  };
  draft: ChallengeDocumentDraft;
}

export interface ChallengeRoundDocumentDraft {
  results: ChallengeDocumentDraft[];
}

export type ChallengeDocumentDraft = Omit<ChallengeDocument, 'evidenceCoverage' | 'outcome'> & {
  evidenceCoverage: {
    status: ChallengeDocument['evidenceCoverage']['status'] | '';
    rationale: string;
    gaps: string[];
  };
  outcome: ChallengeDocument['outcome'] | '';
};

export interface ChallengeChangedFile {
  id: string;
  path: string;
  previousPath?: string;
  operation: FactBundle['changedFiles'][number]['operation'];
  representation: FactBundle['changedFiles'][number]['representation'];
  checkInduced: boolean;
  declaredRelations: {
    verifierDefinitionIds: string[];
    repositoryEvidenceIds: string[];
  };
}

export interface ChallengeCheck {
  verifierId: string;
  definitionId: string;
  key: string;
  rationale: string;
  execution: VerificationDefinition['execution'];
  executionInputs: VerificationDefinition['executionInputs'];
  baseline: VerificationDefinition['baseline'];
  verifierSelectors: Array<{
    kind: 'file' | 'tree';
    path: string;
    role: 'command-definition' | 'acceptance-surface';
  }>;
  latestAttempt: Pick<
    CheckAttemptFact,
    'attempt' | 'durationMs' | 'timeoutMs' | 'status' | 'termination' | 'stdout' | 'stderr' | 'reason'
  >;
  baselineRelation: CheckBaselineRelation;
}

export interface ChallengeRepositoryEvidence extends RepositoryEvidence {
  declaredRelations: Array<'condition-basis' | 'obligation-strategy'>;
}

export function challengeExecutionPacket(input: {
  task: ChallengeTaskBinding;
  contract: TaskContract;
  facts: FactBundle;
  completedObligationIds: string[];
  requiredObligationIds: string[];
}): ChallengeExecutionPacket {
  const completed = new Set(input.completedObligationIds);
  const targets = input.contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => ({ condition, obligation })))
    .filter(({ obligation }) =>
      input.requiredObligationIds.includes(obligation.id) && !completed.has(obligation.id));
  if (!targets.length) {
    throw new Error('Independent Challenge projection requires at least one outstanding Evidence Obligation.');
  }

  const repositoryEvidenceByPath = new Map<string, string[]>();
  const mutationDefinitionIdsByChangedFile = new Map<string, string[]>();
  const cases = targets.map(({ condition, obligation }) => {
    const definitionIds = currentDefinitionIds(obligation, input.contract);
    const definitionIdSet = new Set(definitionIds);
    const relevantMutations = input.facts.verifierMutations.filter((mutation) =>
      definitionIdSet.has(mutation.definitionId));
    const conditionEvidenceIds = new Set(condition.basis.repositoryEvidenceIds);
    const obligationEvidenceIds = new Set(repositoryEvidenceIds(obligation));
    const relevantEvidenceIds = new Set([...conditionEvidenceIds, ...obligationEvidenceIds]);
    const repositoryEvidence = input.contract.repositoryEvidence
      .filter((item) => relevantEvidenceIds.has(item.id))
      .map((item) => ({
        ...item,
        declaredRelations: [
          ...(conditionEvidenceIds.has(item.id) ? ['condition-basis' as const] : []),
          ...(obligationEvidenceIds.has(item.id) ? ['obligation-strategy' as const] : []),
        ],
      }));
    for (const item of repositoryEvidence) {
      repositoryEvidenceByPath.set(item.path, unique([
        ...(repositoryEvidenceByPath.get(item.path) ?? []),
        item.id,
      ]));
    }
    for (const mutation of relevantMutations) {
      mutationDefinitionIdsByChangedFile.set(mutation.changedFileId, unique([
        ...(mutationDefinitionIdsByChangedFile.get(mutation.changedFileId) ?? []),
        mutation.definitionId,
      ]));
    }
    const exactDeveloperEventIds = new Set(condition.basis.humanEventIds);
    return {
      target: {
        condition: {
          authority: 'agent-judgment' as const,
          id: condition.id,
          key: condition.key,
          statement: condition.statement,
          adoptionRationale: condition.adoptionRationale,
          criticality: condition.criticality,
        },
        obligation: {
          authority: 'agent-judgment' as const,
          id: obligation.id,
          key: obligation.key,
          conditionId: obligation.conditionId,
          statement: obligation.statement,
          falsification: obligation.falsification,
          strategies: obligation.strategies,
        },
        exactDeveloperEvents: {
          authority: 'human-event' as const,
          events: input.contract.authority.developerEvents.filter((event) =>
            exactDeveloperEventIds.has(event.id)),
        },
      },
      evidence: {
        checks: relevantChecks(definitionIds, input.contract, input.facts),
        repositoryEvidence,
        verifierMutations: relevantMutations,
      },
      draft: challengeDraft(condition, obligation, definitionIds, obligationEvidenceIds, input.facts),
    };
  });
  const checkInducedIds = new Set(input.facts.checkInducedChanges.map((item) => item.id));

  return {
    inputKind: 'challenge-round',
    bindsTo: {
      taskId: input.task.taskId,
      revision: input.task.revision,
      effectiveContractId: input.contract.effectiveContractId,
      attemptId: input.task.currentAttemptId,
      factCollectionId: input.facts.factCollectionId,
      worktreeFingerprint: input.facts.current.fingerprint,
    },
    sharedEvidence: {
      changedFiles: input.facts.changedFiles.map((file) => ({
        id: file.id,
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        operation: file.operation,
        representation: file.representation,
        checkInduced: checkInducedIds.has(file.id),
        declaredRelations: {
          verifierDefinitionIds: unique(mutationDefinitionIdsByChangedFile.get(file.id) ?? []),
          repositoryEvidenceIds: unique([
            ...(repositoryEvidenceByPath.get(file.path) ?? []),
            ...(file.previousPath ? repositoryEvidenceByPath.get(file.previousPath) ?? [] : []),
          ]),
        },
      })),
      patch: input.facts.patch ?? null,
    },
    cases,
    draft: { results: cases.map((item) => item.draft) },
    output: {
      authority: 'agent-judgment',
      allowedOutcomes: CONCLUSION_STATUSES,
      allowedCoverageStatuses: ['sufficient', 'insufficient'],
      evidenceItemShape: {
        statement: '<bounded evidence statement>',
        provenance: '<runtime-fact, repository-inspection, challenger-execution, or reasoned-counterexample>',
        reproduction: '<runtime-recorded, agent-reported, or not-executed>',
        references: [{
          kind: '<patch, changed-file, check, repository-evidence, or human-event>',
          id: '<omit id only for patch>',
        }],
      },
      instruction: 'Fill only the open judgment fields in every draft result, label each evidence item with honest provenance and reproduction, explicitly assess whether each selected evidence set covers its bounded conclusion, cite only evidence selected by that case, and return the exact Challenge Round JSON object without Markdown.',
    },
  };
}

function challengeDraft(
  condition: AdoptionCondition,
  obligation: EvidenceObligation,
  definitionIds: string[],
  obligationEvidenceIds: Set<string>,
  facts: FactBundle,
): ChallengeDocumentDraft {
  return {
    obligationIds: [obligation.id],
    falsification: obligation.falsification,
    evidence: {
      changedFiles: facts.changedFiles.map((item) => item.id),
      checks: definitionIds,
      repositoryEvidence: [...obligationEvidenceIds],
      humanEvents: condition.basis.humanEventIds,
      patch: Boolean(facts.patch),
    },
    falsificationAttempt: '',
    observedResult: '',
    supportingEvidence: [],
    counterEvidence: [],
    evidenceCoverage: { status: '', rationale: '', gaps: [] },
    outcome: '',
    conclusion: '',
  };
}

function relevantChecks(
  definitionIds: string[],
  contract: TaskContract,
  facts: FactBundle,
): ChallengeCheck[] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  const definitions = new Map(contract.verificationPlan.definitions.map((item) =>
    [item.definitionId, item]));
  const factByDefinition = new Map(facts.checks.map((item) => [item.definitionId, item]));
  const relationByDefinition = new Map(facts.checkComparisons.map((item) =>
    [item.definitionId, item.relation]));
  return definitionIds.map((definitionId) => {
    const definition = definitions.get(definitionId);
    const fact = factByDefinition.get(definitionId);
    const latestAttempt = fact?.attempts.at(-1);
    const baselineRelation = relationByDefinition.get(definitionId);
    if (!definition || !latestAttempt || !baselineRelation) {
      throw new Error(`Challenge projection is missing current facts for ${definitionId}.`);
    }
    return {
      verifierId: definition.verifierId,
      definitionId,
      key: definition.key,
      rationale: definition.rationale,
      execution: definition.execution,
      executionInputs: definition.executionInputs,
      baseline: definition.baseline,
      verifierSelectors: definition.verifierRefs,
      latestAttempt: {
        attempt: latestAttempt.attempt,
        durationMs: latestAttempt.durationMs,
        timeoutMs: latestAttempt.timeoutMs,
        status: latestAttempt.status,
        termination: latestAttempt.termination,
        stdout: latestAttempt.stdout,
        stderr: latestAttempt.stderr,
        ...(latestAttempt.reason ? { reason: latestAttempt.reason } : {}),
      },
      baselineRelation,
    };
  });
}

function currentDefinitionIds(obligation: EvidenceObligation, contract: TaskContract): string[] {
  if (contract.verificationPlan.mode !== 'checks') return [];
  const verifierIds = new Set(obligation.strategies.flatMap((strategy) =>
    strategy.kind === 'runtime-check' ? strategy.verifierIds : []));
  return contract.verificationPlan.definitions
    .filter((definition) => verifierIds.has(definition.verifierId))
    .map((definition) => definition.definitionId);
}

function repositoryEvidenceIds(obligation: EvidenceObligation): string[] {
  return unique(obligation.strategies.flatMap((strategy) =>
    strategy.kind === 'repository-inspection' ? strategy.repositoryEvidenceIds : []));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
