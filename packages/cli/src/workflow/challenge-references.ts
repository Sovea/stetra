import type { ChallengeDocument } from '../schemas/delegation.ts';

export interface ChallengeReferenceIssue {
  path: string;
  message: string;
}

type EvidenceSelection = ChallengeDocument['evidence'];

/**
 * Validates the Agent-authored evidence claims against the exact evidence
 * selection frozen into one Challenge Execution Packet. This is deliberately
 * narrower than Handoff evidence: one Challenge cannot cite another Challenge.
 */
export function challengeReferenceIssues(
  challenge: ChallengeDocument,
  selection: EvidenceSelection = challenge.evidence,
): ChallengeReferenceIssue[] {
  const available = {
    'changed-file': new Set(selection.changedFiles),
    check: new Set(selection.checks),
    'repository-evidence': new Set(selection.repositoryEvidence),
    'human-event': new Set(selection.humanEvents),
  } as const;
  const issues: ChallengeReferenceIssue[] = [];

  for (const [collectionName, items] of [
    ['supportingEvidence', challenge.supportingEvidence],
    ['counterEvidence', challenge.counterEvidence],
  ] as const) {
    for (const [itemIndex, item] of items.entries()) {
      const seen = new Set<string>();
      for (const [referenceIndex, reference] of item.references.entries()) {
        const path = `${collectionName}[${itemIndex}].references[${referenceIndex}]`;
        const identity = reference.kind === 'patch'
          ? 'patch'
          : `${reference.kind}:${reference.id}`;
        if (seen.has(identity)) {
          issues.push({ path, message: 'duplicates an evidence reference in the same item' });
          continue;
        }
        seen.add(identity);
        if (reference.kind === 'patch') {
          if (!selection.patch) {
            issues.push({ path, message: 'references a patch not selected by the Challenge Execution Packet' });
          }
          continue;
        }
        if (!available[reference.kind].has(reference.id)) {
          issues.push({
            path: `${path}.id`,
            message: `references unavailable ${reference.kind} identity ${JSON.stringify(reference.id)}`,
          });
        }
      }
    }
  }
  return issues;
}
