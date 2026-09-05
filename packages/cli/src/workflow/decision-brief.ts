/** Rebuildable developer view. Canonical facts and Agent prose retain their authority. */
import type {
  CognitiveHandoff,
  FactBundle,
  HandoffEvaluation,
  HandoffEvidenceReference,
  HumanDecision,
  TaskContract,
} from '@sovea/stetra-core';

export function createDecisionBrief(input: {
  contract: TaskContract;
  facts: FactBundle;
  handoff: CognitiveHandoff;
  evaluation: HandoffEvaluation;
  corrections: HumanDecision['humanEvent'][];
}) {
  const { contract, facts, handoff, evaluation, corrections } = input;
  const definitions = contract.verificationPlan.mode === 'checks'
    ? contract.verificationPlan.definitions : [];
  const resolveEvidence = (evidence: HandoffEvidenceReference[]) => evidence.map((reference) => {
    if (reference.kind === 'patch') return { kind: 'patch' as const, path: facts.patch?.path };
    if (reference.kind === 'changed-file') return {
      kind: 'changed-file' as const,
      path: facts.changedFiles.find((file) => file.id === reference.id)?.path,
    };
    return { kind: 'check' as const, checkKey: definitions.find((check) => check.definitionId === reference.id)?.key };
  });
  return {
    decisionState: {
      delivery: 'implemented',
      evidence: evaluation.status,
      recommendation: handoff.recommendation.action,
      adoption: evaluation.adoption,
    },
    changeMeaning: {
      authority: 'agent-judgment',
      humanRequest: contract.humanEvents[0],
      humanCorrections: corrections,
      intendedOutcome: contract.interpretation.desiredOutcome,
      constraints: contract.interpretation.constraints,
      nonGoals: contract.interpretation.nonGoals,
      actualChange: handoff.actualChange,
    },
    recommendation: handoff.recommendation,
    concerns: (contract.assurance.mode === 'consequential' ? contract.assurance.concerns : []).map((concern) => {
      const finding = handoff.concernFindings.find((item) => item.concernId === concern.id)!;
      return {
        authority: 'agent-judgment',
        statement: concern.statement,
        adoptionImpact: concern.adoptionImpact,
        status: finding.status,
        summary: finding.summary,
        evidence: resolveEvidence(finding.evidence),
        gaps: finding.gaps,
        evidenceComplete: evaluation.concernEvidence.find((item) => item.concernId === concern.id)?.complete ?? false,
      };
    }),
    unknowns: handoff.residualUnknowns.map((item) => ({ ...item, evidence: resolveEvidence(item.evidence) })),
    reviewFocus: handoff.reviewFocus.map((item) => ({ ...item, evidence: resolveEvidence(item.evidence) })),
    attention: evaluation.attention.map((item) => ({
      ...item,
      evidence: resolveEvidence([
        ...(item.references.changedFileIds ?? []).map((id) => ({ kind: 'changed-file' as const, id })),
        ...(item.references.definitionIds ?? []).map((id) => ({ kind: 'check' as const, id })),
      ]),
    })),
    runtimeEvidence: {
      authority: 'runtime-fact',
      changedFiles: facts.changedFiles.map((file) => ({
        path: file.path, previousPath: file.previousPath,
        operation: file.operation, representation: file.representation,
      })),
      checks: facts.checks.map((check) => ({
        key: definitions.find((definition) => definition.definitionId === check.definitionId)?.key,
        argv: check.assertionArgv,
        status: check.attempts.at(-1)!.status,
        termination: check.attempts.at(-1)!.termination,
        attemptCount: check.attempts.length,
      })),
      verificationBoundary: {
        mode: contract.verificationPlan.mode,
        ...(contract.verificationPlan.mode === 'no-command'
          ? { rationale: contract.verificationPlan.rationale } : {}),
        baselineChecksExecuted: false,
        verifierCoverage: 'declared-selectors-only',
        verifierSelectors: definitions.flatMap((check) => check.verifierRefs.map((selector) => ({ checkKey: check.key, ...selector }))),
        semanticSupport: 'agent-judgment',
      },
      verifierMutationCount: facts.verifierMutations.length,
      checkInducedChangeCount: facts.checkInducedChanges.length,
      ...(facts.refresh ? { refresh: facts.refresh } : {}),
    },
    requestedDecision: {
      authority: 'human-decision',
      actions: evaluation.adoption.status === 'pending'
        ? ['accepted', 'correction-requested', 'rejected', 'deferred'] : [],
      acceptanceRequiresAttentionAcknowledgement: evaluation.attention.length > 0,
    },
  };
}

export type DeveloperDecisionBrief = ReturnType<typeof createDecisionBrief>;
