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
import { stableFingerprint } from '../protocol.ts';

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
        failureHypothesis: string;
        observedResult: string;
        supportingEvidenceCount: number;
        counterEvidenceCount: number;
        challengeOutcomes: Array<{ id: string; outcome: string }>;
      };
    }>;
  }>;
  decisionIssues: DeveloperDecisionIssue[];
  evidenceHistory: Array<{
    dispositionId: string;
    attemptId: string;
    concerns: Array<{
      source: DecisionPacket['evidenceJudgments']['dispositions'][number]['entries'][number]['source'];
      cause: DecisionPacket['evidenceJudgments']['dispositions'][number]['entries'][number]['cause'];
      diagnosis: string;
    }>;
    resolution: {
      proposedRoute: DecisionPacket['evidenceJudgments']['dispositions'][number]['proposedRoute'];
      actualRoute: DecisionPacket['evidenceJudgments']['dispositions'][number]['route'];
      rationale: string;
    };
  }>;
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
  attentionIds: string[];
  codes: HandoffAttentionCode[];
  group: HandoffAttentionItem['group'];
  resolutions: HandoffAttentionItem['resolution']['kind'][];
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
          failureHypothesis: obligation.falsification.failureHypothesis,
          observedResult: obligation.conclusion.falsification.observedResult,
          supportingEvidenceCount: obligation.conclusion.evidence.length,
          counterEvidenceCount: obligation.conclusion.counterEvidence.length,
          challengeOutcomes: obligation.challengeIds.flatMap((id) => {
            const challenge = challengeById.get(id);
            return challenge ? [{ id, outcome: challenge.outcome }] : [];
          }),
        },
      })),
    })),
    decisionIssues: aggregateAttention(input.packet.attention).map((group) => {
      const obligationIds = new Set(group.references.obligations ?? []);
      for (const definitionId of group.references.checks ?? []) {
        const verifierId = verifierByDefinition.get(definitionId);
        if (!verifierId) continue;
        for (const [obligationId, obligation] of obligationById) {
          if (obligation.strategies.some((strategy) =>
            strategy.kind === 'runtime-check' && strategy.verifierIds.includes(verifierId))) {
            obligationIds.add(obligationId);
          }
        }
      }
      const conditionIds = new Set(group.references.conditions ?? []);
      for (const obligationId of obligationIds) {
        const conditionId = conditionByObligation.get(obligationId);
        if (conditionId) conditionIds.add(conditionId);
      }
      const target = {
        conditionIds: [...conditionIds].sort(),
        obligationIds: [...obligationIds].sort(),
        evidenceKeys: attentionEvidenceKeys(group.references, changedFileIdByPath),
      };
      return {
        id: `decision-issue:${stableFingerprint({
          group: group.group, references: group.references,
        }).slice('sha256:'.length)}`,
        attentionIds: group.items.map((item) => item.id).sort(),
        codes: [...new Set(group.items.flatMap((item) => item.codes))].sort(),
        group: group.group,
        resolutions: [...new Set(group.items.map((item) => item.resolution.kind))].sort(),
        references: group.references,
        conditionIds: target.conditionIds,
        obligationIds: target.obligationIds,
        residualUnknowns: input.packet.systemMeaning.residualUnknowns.filter((unknown) =>
          overlaps(unknown.conditionIds, conditionIds) || overlaps(unknown.obligationIds, obligationIds)),
        reviewQuestions: input.packet.reviewQuestions.filter((question) =>
          questionMatchesTarget(question, target)),
      };
    }),
    evidenceHistory: input.packet.evidenceJudgments.dispositions.map((disposition) => ({
      dispositionId: disposition.dispositionId,
      attemptId: disposition.attemptId,
      concerns: disposition.entries.map((entry) => ({
        source: entry.source,
        cause: entry.cause,
        diagnosis: entry.diagnosis,
      })),
      resolution: {
        proposedRoute: disposition.proposedRoute,
        actualRoute: disposition.route,
        rationale: disposition.routeRationale,
      },
    })),
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
  references: HandoffAttentionItem['references'],
  changedFileIdByPath: Map<string, string>,
): Set<string> {
  const keys = new Set<string>();
  for (const id of references.checks ?? []) keys.add(`check:${id}`);
  for (const id of references.challenges ?? []) keys.add(`challenge:${id}`);
  for (const path of references.changedFiles ?? []) {
    const id = changedFileIdByPath.get(path);
    if (id) keys.add(`changed-file:${id}`);
  }
  return keys;
}

function aggregateAttention(items: HandoffAttentionItem[]): Array<{
  group: HandoffAttentionItem['group'];
  references: HandoffAttentionItem['references'];
  items: HandoffAttentionItem[];
}> {
  const grouped = new Map<string, {
    group: HandoffAttentionItem['group'];
    references: HandoffAttentionItem['references'];
    items: HandoffAttentionItem[];
  }>();
  for (const item of items) {
    const references = normalizedReferences(item.references);
    const key = stableFingerprint({ group: item.group, references });
    const existing = grouped.get(key);
    if (existing) existing.items.push(item);
    else grouped.set(key, { group: item.group, references, items: [item] });
  }
  return [...grouped.values()].sort((left, right) =>
    left.items[0].id.localeCompare(right.items[0].id));
}

function normalizedReferences(
  references: HandoffAttentionItem['references'],
): HandoffAttentionItem['references'] {
  return Object.fromEntries(Object.entries(references)
    .filter(([, values]) => values?.length)
    .map(([key, values]) => [key, [...new Set(values)].sort()]));
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
