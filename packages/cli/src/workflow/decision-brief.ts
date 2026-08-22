import type {
  DecisionPacket,
  HandoffAttentionCode,
  HandoffAttentionItem,
  HandoffEvaluation,
  HumanDecisionAction,
  ReviewQuestion,
  TaskContract,
} from '@sovea/stetra-core';

import {
  HUMAN_DECISION_ACTIONS,
  type DerivedTaskState,
  type TaskProjection,
} from '../schemas/delegation.ts';
import { stableFingerprint } from '../protocol.ts';

export interface DeveloperDecisionPrimary {
  decisionState: {
    delivery: DerivedTaskState['deliveryStatus'];
    evidence: HandoffEvaluation['status'];
    recommendation: DecisionPacket['decision']['recommendation']['action'];
    adoption: HandoffEvaluation['adoption']['status'];
  };
  changeMeaning: {
    authority: 'agent-judgment';
    intendedOutcome: string;
    actualChange: DecisionPacket['actualChange'];
  };
  recommendation: DecisionPacket['decision']['recommendation'];
  priorHumanResolutions: Array<{
    target: DecisionPacket['decision']['resolutions'][number]['interpretation']['target']['kind'];
    action: DecisionPacket['decision']['resolutions'][number]['interpretation']['action'];
    reason: string;
  }>;
  conditions: Array<{
    statement: string;
    criticality: 'material' | 'adoption-critical';
    finding: {
      status: DecisionPacket['conditions'][number]['agentFinding']['status'];
      summary: string;
    };
    evidence: Array<{
      statement: string;
      finding: DecisionPacket['conditions'][number]['obligations'][number]['agentFinding']['status'];
      evidencePath: DecisionPacket['conditions'][number]['obligations'][number]['evidencePath']['status'];
      counterEvidenceCount: number;
    }>;
  }>;
  blockers: Array<{
    group: DeveloperDecisionIssue['group'];
    codes: HandoffAttentionCode[];
    resolutions: HandoffAttentionItem['resolution']['kind'][];
    affectedConditions: string[];
    residualUnknowns: Array<{
      statement: string;
      adoptionImpact: string;
      nextAction: string;
    }>;
    reviewQuestions: Array<{ question: string; adoptionImpact: string }>;
  }>;
  reviewFocus: Array<{
    question: string;
    adoptionImpact: string;
    affectedConditions: string[];
  }>;
  runtimeEvidence: {
    authority: 'runtime-fact';
    changedFiles: Array<{
      path: string;
      operation: DecisionPacket['runtimeFacts']['changedFiles'][number]['operation'];
      representation: DecisionPacket['runtimeFacts']['changedFiles'][number]['representation'];
    }>;
    checks: Array<{
      argv: string[];
      status: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['status'];
      termination: DecisionPacket['runtimeFacts']['checks'][number]['latestAttempt']['termination'];
      baselineRelation: DecisionPacket['runtimeFacts']['checks'][number]['baselineRelation'];
      attemptCount: number;
    }>;
  };
  requestedDecision: {
    authority: 'human-decision';
    actions: HumanDecisionAction[];
    acceptanceExceptionIssueCount: number;
  };
}

interface DeveloperDecisionDetails {
  decisionState: {
    delivery: DerivedTaskState['deliveryStatus'];
    evidence: HandoffEvaluation['status'];
    recommendation: DecisionPacket['decision']['recommendation']['action'];
    adoption: HandoffEvaluation['adoption']['status'];
  };
  changeMeaning: {
    authority: 'agent-judgment';
    intendedOutcome: string;
    actualChange: DecisionPacket['actualChange'];
  };
  recommendation: DecisionPacket['decision']['recommendation'];
  priorHumanResolutions: DecisionPacket['decision']['resolutions'];
  conditions: Array<{
    authority: 'agent-judgment';
    id: string;
    statement: string;
    criticality: 'material' | 'adoption-critical';
    status: DecisionPacket['conditions'][number]['agentFinding']['status'];
    summary: string;
    obligations: Array<{
      id: string;
      statement: string;
      status: DecisionPacket['conditions'][number]['obligations'][number]['agentFinding']['status'];
      conclusion: string;
      evidencePath: DecisionPacket['conditions'][number]['obligations'][number]['evidencePath'];
      evidenceBoundary: {
        failureHypothesis: string;
        observedResult: string;
        coverage: DecisionPacket['conditions'][number]['obligations'][number]['agentFinding']['evidenceCoverage'];
        supportingEvidenceCount: number;
        counterEvidenceCount: number;
        challengeFindings: Array<{
          id: string;
          outcome: DecisionPacket['evidenceJudgments']['challenges'][number]['outcome'];
          conclusion: string;
          counterEvidence: DecisionPacket['evidenceJudgments']['challenges'][number]['counterEvidence'];
        }>;
      };
    }>;
  }>;
  decisionIssues: DeveloperDecisionIssue[];
  reviewQuestions: ReviewQuestion[];
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
    authority: 'runtime-fact';
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
    authority: 'human-decision';
    actions: HumanDecisionAction[];
    acceptanceRequiresExceptionsFor: Array<{
      decisionIssueId: string;
      attentionIds: string[];
    }>;
  };
  detailSections: DecisionPacket['detailSections'];
}

export interface DeveloperDecisionBrief {
  primary: DeveloperDecisionPrimary;
  details: {
    command: { argv: string[] };
    sections: DecisionPacket['detailSections'];
  };
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
  residualUnknowns: DecisionPacket['residualUnknowns'];
  reviewQuestions: ReviewQuestion[];
}

export function buildDeveloperDecisionBrief(input: {
  task: TaskProjection & DerivedTaskState;
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
  const decisionIssues = aggregateDecisionAttention(input.packet.attention).map((group) => {
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
        effectiveContractId: input.contract.effectiveContractId,
        group: group.group,
        resolution: group.resolution,
      }).slice('sha256:'.length)}`,
      attentionIds: group.items.map((item) => item.id).sort(),
      codes: [...new Set(group.items.flatMap((item) => item.codes))].sort(),
      group: group.group,
      resolutions: [group.resolution],
      references: group.references,
      conditionIds: target.conditionIds,
      obligationIds: target.obligationIds,
      residualUnknowns: input.packet.residualUnknowns.filter((unknown) =>
        overlaps(unknown.conditionIds, conditionIds) || overlaps(unknown.obligationIds, obligationIds)),
      reviewQuestions: input.packet.reviewQuestions.filter((question) =>
        questionMatchesTarget(question, target)),
    } satisfies DeveloperDecisionIssue;
  });

  const details: DeveloperDecisionDetails = {
    decisionState: {
      delivery: input.task.deliveryStatus,
      evidence: input.evaluation.status,
      recommendation: input.packet.decision.recommendation.action,
      adoption: input.evaluation.adoption.status,
    },
    changeMeaning: {
      authority: 'agent-judgment',
      intendedOutcome: input.packet.semanticContract.desiredOutcome,
      actualChange: input.packet.actualChange,
    },
    recommendation: input.packet.decision.recommendation,
    priorHumanResolutions: input.packet.decision.resolutions,
    conditions: input.packet.conditions.map((condition) => ({
      authority: 'agent-judgment',
      id: condition.id,
      statement: condition.statement,
      criticality: condition.criticality,
      status: condition.agentFinding.status,
      summary: condition.agentFinding.summary,
      obligations: condition.obligations.map((obligation) => ({
        id: obligation.id,
        statement: obligation.statement,
        status: obligation.agentFinding.status,
        conclusion: obligation.agentFinding.conclusion,
        evidencePath: obligation.evidencePath,
        evidenceBoundary: {
          failureHypothesis: obligation.falsification.failureHypothesis,
          observedResult: obligation.agentFinding.falsification.observedResult,
          coverage: obligation.agentFinding.evidenceCoverage,
          supportingEvidenceCount: obligation.agentFinding.evidence.length,
          counterEvidenceCount: obligation.agentFinding.counterEvidence.length,
          challengeFindings: obligation.challengeIds.flatMap((id) => {
            const challenge = challengeById.get(id);
            return challenge ? [{
              id,
              outcome: challenge.outcome,
              conclusion: challenge.conclusion,
              counterEvidence: challenge.counterEvidence,
            }] : [];
          }),
        },
      })),
    })),
    decisionIssues,
    reviewQuestions: input.packet.reviewQuestions,
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
      authority: 'runtime-fact',
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
      authority: 'human-decision',
      actions: [...HUMAN_DECISION_ACTIONS],
      acceptanceRequiresExceptionsFor: decisionIssues.map((issue) => ({
        decisionIssueId: issue.id,
        attentionIds: issue.attentionIds,
      })),
    },
    detailSections: input.packet.detailSections,
  };
  return {
    primary: primaryBrief(details),
    details: {
      command: {
        argv: [
          'stetra', 'change', 'explain', '.', '--task', input.task.taskId,
          '--section', 'decision-packet', '--json',
        ],
      },
      sections: input.packet.detailSections,
    },
  };
}

function primaryBrief(details: DeveloperDecisionDetails): DeveloperDecisionPrimary {
  const conditionStatementById = new Map(details.conditions.map((condition) =>
    [condition.id, condition.statement]));
  return {
    decisionState: details.decisionState,
    changeMeaning: details.changeMeaning,
    recommendation: details.recommendation,
    priorHumanResolutions: details.priorHumanResolutions.map((resolution) => ({
      target: resolution.interpretation.target.kind,
      action: resolution.interpretation.action,
      reason: resolution.interpretation.reason,
    })),
    conditions: details.conditions.map((condition) => ({
      statement: condition.statement,
      criticality: condition.criticality,
      finding: { status: condition.status, summary: condition.summary },
      evidence: condition.obligations.map((obligation) => ({
        statement: obligation.statement,
        finding: obligation.status,
        evidencePath: obligation.evidencePath.status,
        counterEvidenceCount: obligation.evidenceBoundary.counterEvidenceCount,
      })),
    })),
    blockers: details.decisionIssues.map((issue) => ({
      group: issue.group,
      codes: issue.codes,
      resolutions: issue.resolutions,
      affectedConditions: issue.conditionIds.flatMap((id) => {
        const statement = conditionStatementById.get(id);
        return statement ? [statement] : [];
      }),
      residualUnknowns: issue.residualUnknowns.map((unknown) => ({
        statement: unknown.statement,
        adoptionImpact: unknown.adoptionImpact,
        nextAction: unknown.nextAction,
      })),
      reviewQuestions: issue.reviewQuestions.map((question) => ({
        question: question.question,
        adoptionImpact: question.adoptionImpact,
      })),
    })),
    reviewFocus: details.reviewQuestions.map((question) => ({
      question: question.question,
      adoptionImpact: question.adoptionImpact,
      affectedConditions: question.conditionIds.flatMap((id) => {
        const statement = conditionStatementById.get(id);
        return statement ? [statement] : [];
      }),
    })),
    runtimeEvidence: {
      authority: 'runtime-fact',
      changedFiles: details.runtimeEvidence.changedFiles,
      checks: details.runtimeEvidence.checks.map(({ definitionId: _definitionId, ...check }) => check),
    },
    requestedDecision: {
      authority: 'human-decision',
      actions: details.requestedDecision.actions,
      acceptanceExceptionIssueCount:
        details.requestedDecision.acceptanceRequiresExceptionsFor.length,
    },
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

export function aggregateDecisionAttention(items: HandoffAttentionItem[]): Array<{
  group: HandoffAttentionItem['group'];
  resolution: HandoffAttentionItem['resolution']['kind'];
  references: HandoffAttentionItem['references'];
  items: HandoffAttentionItem[];
}> {
  const grouped = new Map<string, {
    group: HandoffAttentionItem['group'];
    resolution: HandoffAttentionItem['resolution']['kind'];
    references: HandoffAttentionItem['references'];
    items: HandoffAttentionItem[];
  }>();
  for (const item of items) {
    const key = stableFingerprint({ group: item.group, resolution: item.resolution.kind });
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(item);
      existing.references = mergeReferences(existing.references, item.references);
    } else {
      grouped.set(key, {
        group: item.group,
        resolution: item.resolution.kind,
        references: normalizedReferences(item.references),
        items: [item],
      });
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.group.localeCompare(right.group) || left.resolution.localeCompare(right.resolution));
}

function mergeReferences(
  left: HandoffAttentionItem['references'],
  right: HandoffAttentionItem['references'],
): HandoffAttentionItem['references'] {
  return normalizedReferences(Object.fromEntries(
    [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [
      key,
      [
        ...(left[key as keyof HandoffAttentionItem['references']] ?? []),
        ...(right[key as keyof HandoffAttentionItem['references']] ?? []),
      ],
    ]),
  ));
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
