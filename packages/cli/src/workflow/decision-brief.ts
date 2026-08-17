import type {
  DecisionPacket,
  HandoffAttentionCode,
  HandoffAttentionItem,
  HandoffEvaluation,
  HumanDecisionAction,
  ReviewQuestion,
  TaskContract,
} from '@sovea/stetra-core';

import { HUMAN_DECISION_ACTIONS, type TaskProjection } from '../schemas/delegation.ts';

export interface DeveloperDecisionBrief {
  decisionState: {
    delivery: TaskProjection['deliveryStatus'];
    evidence: HandoffEvaluation['status'];
    recommendation: DecisionPacket['decision']['recommendation']['action'];
    adoption: HandoffEvaluation['adoption']['status'];
  };
  changeMeaning: {
    desiredOutcome: string;
    actualSystemMeaning: string;
    importantSystemEffects: string[];
  };
  conditions: Array<{
    id: string;
    statement: string;
    criticality: 'material' | 'adoption-critical';
    status: DecisionPacket['conditions'][number]['conclusion']['status'];
    summary: string;
    obligations: Array<{
      id: string;
      statement: string;
      status: DecisionPacket['conditions'][number]['obligations'][number]['conclusion']['status'];
      conclusion: string;
      evidenceBoundary: {
        plannedFalsification: DecisionPacket['conditions'][number]['obligations'][number]['falsification'];
        agentFalsification: DecisionPacket['conditions'][number]['obligations'][number]['conclusion']['falsification'];
        supportingEvidence: DecisionPacket['conditions'][number]['obligations'][number]['conclusion']['evidence'];
        counterEvidence: DecisionPacket['conditions'][number]['obligations'][number]['conclusion']['counterEvidence'];
        challenges: DecisionPacket['evidenceJudgments']['challenges'];
      };
    }>;
  }>;
  decisionIssues: DeveloperDecisionIssue[];
  runtimeEvidence: {
    changedFiles: Array<{
      path: string;
      operation: DecisionPacket['runtimeFacts']['changedFiles'][number]['operation'];
      representation: DecisionPacket['runtimeFacts']['changedFiles'][number]['representation'];
    }>;
    checks: Array<{
      definitionId: string;
      argv: string[];
      status: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['status'];
      termination: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['termination'];
      baselineRelation: DecisionPacket['runtimeFacts']['checks'][number]['baselineRelation'];
      attemptCount: number;
      stdout: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['stdout'];
      stderr: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['stderr'];
    }>;
  };
  requestedDecision: {
    actions: HumanDecisionAction[];
    acceptanceRequiresExceptionsFor: string[];
  };
  detailSections: DecisionPacket['detailSections'];
}

export interface DeveloperDecisionIssue {
  id: string;
  attentionId: string;
  code: HandoffAttentionCode;
  group: HandoffAttentionItem['group'];
  resolution: HandoffAttentionItem['resolution']['kind'];
  references: HandoffAttentionItem['references'];
  conditionIds: string[];
  obligationIds: string[];
  residualUnknowns: DecisionPacket['systemMeaning']['residualUnknowns'];
  reviewQuestions: ReviewQuestion[];
}

export function buildDeveloperDecisionBrief(input: {
  task: TaskProjection;
  contract: TaskContract;
  packet: DecisionPacket;
  evaluation: HandoffEvaluation;
}): DeveloperDecisionBrief {
  const obligationById = new Map(input.contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [obligation.id, obligation] as const)));
  const conditionByObligation = new Map(input.contract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [obligation.id, condition.id] as const)));
  const verifierByDefinition = new Map(
    input.contract.verificationPlan.mode === 'checks'
      ? input.contract.verificationPlan.definitions.map((definition) =>
          [definition.definitionId, definition.verifierId] as const)
      : [],
  );
  const changedFileIdByPath = new Map(input.packet.runtimeFacts.changedFiles.map((file) =>
    [file.path, file.id] as const));
  const challengeById = new Map(input.packet.evidenceJudgments.challenges.map((challenge) =>
    [challenge.id, challenge] as const));

  return {
    decisionState: {
      delivery: input.task.deliveryStatus,
      evidence: input.evaluation.status,
      recommendation: input.packet.decision.recommendation.action,
      adoption: input.evaluation.adoption.status,
    },
    changeMeaning: {
      desiredOutcome: input.packet.semanticContract.desiredOutcome,
      actualSystemMeaning: input.packet.systemMeaning.summary,
      importantSystemEffects: input.packet.systemMeaning.importantSystemEffects,
    },
    conditions: input.packet.conditions.map((condition) => ({
      id: condition.id,
      statement: condition.statement,
      criticality: condition.criticality,
      status: condition.conclusion.status,
      summary: condition.conclusion.summary,
      obligations: condition.obligations.map((obligation) => ({
        id: obligation.id,
        statement: obligation.statement,
        status: obligation.conclusion.status,
        conclusion: obligation.conclusion.conclusion,
        evidenceBoundary: {
          plannedFalsification: obligation.falsification,
          agentFalsification: obligation.conclusion.falsification,
          supportingEvidence: obligation.conclusion.evidence,
          counterEvidence: obligation.conclusion.counterEvidence,
          challenges: obligation.challengeIds.map((id) => challengeById.get(id)!),
        },
      })),
    })),
    decisionIssues: input.packet.attention.map((item) => {
      const obligationIds = new Set(item.references.obligations ?? []);
      for (const definitionId of item.references.checks ?? []) {
        const verifierId = verifierByDefinition.get(definitionId);
        if (!verifierId) continue;
        for (const [obligationId, obligation] of obligationById) {
          if (obligation.strategies.some((strategy) =>
            strategy.kind === 'runtime-check' && strategy.verifierIds.includes(verifierId))) {
            obligationIds.add(obligationId);
          }
        }
      }
      const conditionIds = new Set(item.references.conditions ?? []);
      for (const obligationId of obligationIds) {
        const conditionId = conditionByObligation.get(obligationId);
        if (conditionId) conditionIds.add(conditionId);
      }
      const target = {
        conditionIds: [...conditionIds].sort(),
        obligationIds: [...obligationIds].sort(),
        evidenceKeys: attentionEvidenceKeys(item, changedFileIdByPath),
      };
      return {
        id: `decision-issue:${item.id.slice('attention:'.length)}`,
        attentionId: item.id,
        code: item.codes[0],
        group: item.group,
        resolution: item.resolution.kind,
        references: item.references,
        conditionIds: target.conditionIds,
        obligationIds: target.obligationIds,
        residualUnknowns: input.packet.systemMeaning.residualUnknowns.filter((unknown) =>
          overlaps(unknown.conditionIds, conditionIds) || overlaps(unknown.obligationIds, obligationIds)),
        reviewQuestions: input.packet.reviewQuestions.filter((question) =>
          questionMatchesTarget(question, target)),
      };
    }),
    runtimeEvidence: {
      changedFiles: input.packet.runtimeFacts.changedFiles.map((file) => ({
        path: file.path,
        operation: file.operation,
        representation: file.representation,
      })),
      checks: input.packet.runtimeFacts.checks.map((check) => ({
        definitionId: check.definitionId,
        argv: check.argv,
        status: check.latestAttempt.status,
        termination: check.latestAttempt.termination,
        baselineRelation: check.baselineRelation,
        attemptCount: check.attemptCount,
        stdout: check.latestAttempt.stdout,
        stderr: check.latestAttempt.stderr,
      })),
    },
    requestedDecision: {
      actions: [...HUMAN_DECISION_ACTIONS],
      acceptanceRequiresExceptionsFor: input.packet.attention.map((item) => item.id),
    },
    detailSections: input.packet.detailSections,
  };
}

function attentionEvidenceKeys(
  item: HandoffAttentionItem,
  changedFileIdByPath: Map<string, string>,
): Set<string> {
  const keys = new Set<string>();
  for (const id of item.references.checks ?? []) keys.add(`check:${id}`);
  for (const id of item.references.challenges ?? []) keys.add(`challenge:${id}`);
  for (const path of item.references.changedFiles ?? []) {
    const id = changedFileIdByPath.get(path);
    if (id) keys.add(`changed-file:${id}`);
  }
  return keys;
}

function questionMatchesTarget(
  question: ReviewQuestion,
  target: { conditionIds: string[]; obligationIds: string[]; evidenceKeys: Set<string> },
): boolean {
  if (question.conditionIds.some((id) => target.conditionIds.includes(id))) return true;
  if (question.obligationIds.some((id) => target.obligationIds.includes(id))) return true;
  return question.evidence.some((evidence) =>
    evidence.kind !== 'patch' && target.evidenceKeys.has(`${evidence.kind}:${evidence.id}`));
}

function overlaps(values: string[], target: Set<string>): boolean {
  return values.some((value) => target.has(value));
}
