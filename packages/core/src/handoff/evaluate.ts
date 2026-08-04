import { validateCompiledContract } from '../delegation/compile.ts';
import { validateFactBundle } from '../facts/validate.ts';
import type { ChangedFileFact, CheckFact, FactBundle } from '../facts/types.ts';
import {
  assertProtocol,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSafeRepositoryPath,
  isSha256,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
} from '../shared/protocol.ts';
import type { RepositoryEvidence } from '../authority/types.ts';
import {
  HandoffValidationError,
  type ClaimBasis,
  type ClaimFalsification,
  type CognitiveHandoff,
  type EvaluateHandoffInput,
  type HandoffAttentionItem,
  type HandoffAttentionReferences,
  type HandoffEvaluation,
  type HandoffEvidenceSelection,
  type HandoffValidationIssue,
  type MaterialAlternative,
  type MaterialClaim,
  type ResidualUnknown,
  type ReviewMapEntry,
} from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;
const HUMAN_AUTHORITY_NOTICE = 'This handoff is ready for human review only. Runtime and Host conclusions do not record adoption.';
const CLAIM_DIMENSIONS = new Set([
  'behavior',
  'invariant',
  'state-ownership',
  'data-flow',
  'control-flow',
  'compatibility',
  'migration',
  'failure-recovery',
  'security',
  'operations',
  'maintenance',
  'important-non-change',
]);
const CLAIM_BASES = new Set<ClaimBasis>([
  'repository-evidence',
  'agent-judgment',
  'human-decision',
  'unverified',
]);
const FALSIFICATION_STATUSES = new Set([
  'supported',
  'contradicted',
  'partial',
  'unverified',
]);
const REVIEW_PRIORITIES = new Set([
  'must-read',
  'useful-to-sample',
  'mechanically-covered',
  'unresolved',
]);

export function evaluateHandoff(input: EvaluateHandoffInput): HandoffEvaluation {
  assertProtocol(input, 'evaluateHandoff');
  validateCompiledContract(input.contract);
  validateFactBundle(input.factBundle, input.contract);
  if (!isSha256(input.currentWorktreeFingerprint)) {
    throw new Error('evaluateHandoff current worktree fingerprint is invalid.');
  }
  if (input.currentWorktreeFingerprint !== input.factBundle.current.fingerprint) {
    return {
      ...ENVELOPE,
      status: 'facts-stale',
      contractId: input.contract.contractId,
      factCollectionId: input.factBundle.factCollectionId,
      attention: [{
        code: 'facts-stale',
        summary: 'The worktree changed after fact collection.',
        adoptionImpact: 'The collected patch and checks no longer describe the repository being handed off.',
        references: {},
        resolution: {
          kind: 'recollect',
          action: 'Run collect again before evaluating or presenting any semantic conclusion.',
        },
      }],
      humanAuthorityNotice: HUMAN_AUTHORITY_NOTICE,
    };
  }

  const handoff = validateHandoff(input.handoff, input.contract, input.factBundle);
  const attention = buildAttention(input.factBundle, handoff);
  validateAttentionReviewCoverage(attention, handoff.reviewMap);
  const status = attention.some((item) =>
    item.code === 'check-failed' || item.code === 'critical-claim-contradicted')
    ? 'rejected'
    : attention.length
      ? 'needs-attention'
      : 'handoff-ready';
  return {
    ...ENVELOPE,
    status,
    contractId: input.contract.contractId,
    factCollectionId: input.factBundle.factCollectionId,
    handoffFingerprint: stableFingerprint({
      factCollectionId: input.factBundle.factCollectionId,
      handoff,
    }),
    systemMeaningUpdate: handoff.systemMeaningUpdate,
    claimConclusions: handoff.materialClaims.map((claim) => ({
      claimId: claim.id,
      basis: claim.basis,
      adoptionCritical: claim.adoptionCritical,
      falsification: claim.falsification?.status ?? 'not-required',
    })),
    attention,
    reviewMap: handoff.reviewMap,
    humanAuthorityNotice: HUMAN_AUTHORITY_NOTICE,
  };
}

function buildAttention(
  facts: FactBundle,
  handoff: CognitiveHandoff,
): HandoffAttentionItem[] {
  const output: HandoffAttentionItem[] = [];
  for (const check of facts.checks) {
    if (check.status === 'failed') {
      output.push({
        code: 'check-failed',
        summary: `Configured check ${check.id} failed.`,
        adoptionImpact: 'The selected verification boundary contradicts readiness of the current implementation.',
        references: { checks: [check.id] },
        resolution: {
          kind: 'repair-or-revise',
          action: 'Inspect the exact check output, repair inside the Semantic Contract, and collect again; realign if the repair changes long-lived meaning.',
        },
      });
    } else if (check.status === 'unavailable') {
      output.push({
        code: 'check-unavailable',
        summary: `Configured check ${check.id} was unavailable${check.reason ? `: ${check.reason}` : '.'}`,
        adoptionImpact: 'A selected verification boundary produced no completed outcome, so its intended evidence is missing.',
        references: { checks: [check.id] },
        resolution: {
          kind: 'supply-evidence',
          action: 'Restore the configured command environment and collect again, or directly review the disclosed evidence gap before adoption.',
        },
      });
    }
  }
  const changedById = new Map(facts.changedFiles.map((file) => [file.id, file]));
  const verifierGroups = new Map<string, {
    path: string;
    role: FactBundle['verifierMutations'][number]['role'];
    changedPath: string;
    checkIds: Set<string>;
  }>();
  for (const mutation of facts.verifierMutations) {
    const changed = changedById.get(mutation.changedFileId)!;
    const key = `${mutation.path}\0${mutation.role}`;
    const group = verifierGroups.get(key) ?? {
      path: mutation.path,
      role: mutation.role,
      changedPath: changed.path,
      checkIds: new Set<string>(),
    };
    group.checkIds.add(mutation.checkId);
    verifierGroups.set(key, group);
  }
  for (const group of [...verifierGroups.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.role.localeCompare(right.role))) {
    const checkIds = [...group.checkIds].sort((left, right) => left.localeCompare(right));
    output.push({
      code: 'verifier-surface-changed',
      summary: `Verification ${group.role} ${group.path} changed for ${checkIds.length === 1 ? 'check' : 'checks'} ${checkIds.join(', ')}.`,
      adoptionImpact: group.role === 'command-definition'
        ? 'The executed check definition changed with the implementation, so the result is not independent of that change.'
        : 'The acceptance surface changed with the implementation, so a passing result may reflect revised expectations rather than preserved behavior.',
      references: { changedFiles: [group.changedPath], checks: checkIds },
      resolution: {
        kind: 'direct-review',
        action: 'Review the changed verifier surface directly and add independent evidence when it could mask a regression.',
      },
    });
  }
  for (const file of facts.changedFiles) {
    if (file.representation !== 'unrepresentable') continue;
    output.push({
      code: 'change-unrepresentable',
      summary: `Change details for ${file.path} are not representable in the collected patch.`,
      adoptionImpact: 'The normal text patch cannot show the complete changed content for direct inspection.',
      references: { changedFiles: [file.path] },
      resolution: {
        kind: 'direct-review',
        action: 'Inspect the exact file or metadata change with an appropriate repository-native tool before adoption.',
      },
    });
  }
  for (const claim of handoff.materialClaims) {
    if (!requiresFalsification(claim)) continue;
    const falsification = claim.falsification!;
    if (falsification.status === 'contradicted') {
      output.push({
        code: 'critical-claim-contradicted',
        summary: `Adoption-critical claim ${claim.id} is contradicted: ${falsification.conclusion}`,
        adoptionImpact: claim.adoptionConsequence,
        references: mergeAttentionReferences(
          { claims: [claim.id] },
          evidenceAttentionReferences(claim.evidence),
          evidenceAttentionReferences(falsification.counterEvidence),
        ),
        resolution: {
          kind: 'repair-or-revise',
          action: 'Do not adopt this conclusion; repair the implementation or revise the claim and collect fresh evidence.',
        },
      });
    } else if (falsification.status === 'partial' || falsification.status === 'unverified') {
      output.push({
        code: `critical-claim-${falsification.status}`,
        summary: `Adoption-critical claim ${claim.id} is ${falsification.status}: ${falsification.conclusion}`,
        adoptionImpact: claim.adoptionConsequence,
        references: mergeAttentionReferences(
          { claims: [claim.id] },
          evidenceAttentionReferences(claim.evidence),
          evidenceAttentionReferences(falsification.supportingEvidence),
          evidenceAttentionReferences(falsification.counterEvidence),
        ),
        resolution: {
          kind: 'supply-evidence',
          action: 'Execute the missing validation, narrow the claim, or review the unresolved boundary directly before adoption.',
        },
      });
    }
  }
  for (const unknown of handoff.residualUnknowns) {
    output.push({
      code: 'residual-unknown',
      summary: unknown.statement,
      adoptionImpact: unknown.adoptionImpact,
      references: {
        ...(unknown.references.changedFiles.length
          ? { changedFiles: unknown.references.changedFiles }
          : {}),
        ...(unknown.references.claims.length ? { claims: unknown.references.claims } : {}),
        unknowns: [unknown.id],
      },
      resolution: {
        kind: 'execute-validation',
        action: unknown.validationPath,
      },
    });
  }
  return output;
}

function validateAttentionReviewCoverage(
  attention: HandoffAttentionItem[],
  reviewMap: ReviewMapEntry[],
): void {
  const urgent = reviewMap.filter((entry) =>
    entry.priority === 'must-read' || entry.priority === 'unresolved');
  const issues: HandoffValidationIssue[] = [];
  for (const item of attention) {
    const references = item.references;
    if (item.code === 'verifier-surface-changed') {
      const changedFiles = references.changedFiles ?? [];
      const checks = references.checks ?? [];
      const matching = urgent.filter((entry) =>
        changedFiles.some((path) => entry.changedFiles.includes(path)));
      const coveredFiles = changedFiles.every((path) =>
        matching.some((entry) => entry.changedFiles.includes(path)));
      const coveredChecks = checks.every((id) =>
        matching.some((entry) => entry.checkIds.includes(id)));
      if (coveredFiles && coveredChecks) continue;
      issues.push(handoffIssue(
        'attention-review-required',
        'reviewMap',
        `Attention item ${item.code} requires must-read or unresolved Review Map coverage.`,
        'Add one Review Map entry for the changed verifier path and every affected check.',
      ));
      continue;
    }
    const covered = urgent.some((entry) => {
      if (references.unknowns?.length) {
        return references.unknowns.some((id) => entry.unknownIds.includes(id));
      }
      if (references.claims?.length) {
        return references.claims.some((id) => entry.claimIds.includes(id));
      }
      if (references.changedFiles?.length && references.checks?.length) {
        return references.changedFiles.some((path) => entry.changedFiles.includes(path))
          && references.checks.some((id) => entry.checkIds.includes(id));
      }
      if (references.checks?.length) {
        return references.checks.some((id) => entry.checkIds.includes(id));
      }
      if (references.changedFiles?.length) {
        return references.changedFiles.some((path) => entry.changedFiles.includes(path));
      }
      return true;
    });
    if (!covered) {
      issues.push(handoffIssue(
        'attention-review-required',
        'reviewMap',
        `Attention item ${item.code} requires must-read or unresolved Review Map coverage.`,
        'Add a Review Map entry that selects the exact check, changed path, claim, or unknown named by the attention item.',
      ));
    }
  }
  throwHandoffIssues(issues);
}

function evidenceAttentionReferences(
  evidence: HandoffEvidenceSelection,
): HandoffAttentionReferences {
  return {
    ...(evidence.changedFiles?.length ? { changedFiles: evidence.changedFiles } : {}),
    ...(evidence.checks?.length ? { checks: evidence.checks } : {}),
    ...(evidence.repositoryEvidence?.length
      ? { repositoryEvidence: evidence.repositoryEvidence }
      : {}),
    ...(evidence.humanEvents?.length ? { humanEvents: evidence.humanEvents } : {}),
    ...(evidence.patch ? { patch: true } : {}),
  };
}

function mergeAttentionReferences(
  ...values: HandoffAttentionReferences[]
): HandoffAttentionReferences {
  const changedFiles = unique(values.flatMap((value) => value.changedFiles ?? []));
  const checks = unique(values.flatMap((value) => value.checks ?? []));
  const claims = unique(values.flatMap((value) => value.claims ?? []));
  const unknowns = unique(values.flatMap((value) => value.unknowns ?? []));
  const repositoryEvidence = unique(values.flatMap((value) => value.repositoryEvidence ?? []));
  const humanEvents = unique(values.flatMap((value) => value.humanEvents ?? []));
  return {
    ...(changedFiles.length ? { changedFiles } : {}),
    ...(checks.length ? { checks } : {}),
    ...(claims.length ? { claims } : {}),
    ...(unknowns.length ? { unknowns } : {}),
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
    ...(humanEvents.length ? { humanEvents } : {}),
    ...(values.some((value) => value.patch) ? { patch: true } : {}),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function validateHandoff(
  value: unknown,
  contract: EvaluateHandoffInput['contract'],
  facts: FactBundle,
): CognitiveHandoff {
  const issues: HandoffValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new HandoffValidationError([handoffIssue(
      'handoff-object-required',
      '$',
      'Cognitive Handoff must be an object.',
      'Replace the handoff file with the generated object shape from collect.',
    )]);
  }
  for (const key of hasExactKeys(value, [
    'protocol',
    'schemaVersion',
    'systemMeaningUpdate',
    'materialClaims',
    'residualUnknowns',
    'reviewMap',
    'materialAlternatives',
    'repositoryEvidence',
  ])) {
    issues.push(handoffIssue(
      'unsupported-field',
      key,
      `Unsupported handoff field ${key}.`,
      'Remove the field; Runtime facts and collection identity are supplied by the active run.',
    ));
  }
  if (value.protocol !== SEMANTIC_DELEGATION_PROTOCOL) {
    issues.push(handoffIssue(
      'protocol-invalid',
      'protocol',
      `Protocol must be ${SEMANTIC_DELEGATION_PROTOCOL}.`,
      'Use the protocol value generated by collect.',
    ));
  }
  if (value.schemaVersion !== SEMANTIC_DELEGATION_SCHEMA_VERSION) {
    issues.push(handoffIssue(
      'schema-version-invalid',
      'schemaVersion',
      `Schema version must be ${SEMANTIC_DELEGATION_SCHEMA_VERSION}.`,
      'Use the schema value generated by collect.',
    ));
  }
  const systemMeaningUpdate = requiredString(
    value.systemMeaningUpdate,
    'systemMeaningUpdate',
    'A concrete implemented system-meaning update is required.',
    issues,
  );
  const repositoryEvidence = validateRepositoryEvidence(value.repositoryEvidence ?? [], issues);
  const references = referenceContext(facts, contract, repositoryEvidence);
  const claims = validateClaims(value.materialClaims, references, issues);
  if (!facts.changedFiles.length
    && !claims.some((claim) => claim.dimension === 'important-non-change')) {
    issues.push(handoffIssue(
      'important-non-change-required',
      'materialClaims',
      'A no-change run requires an important-non-change claim.',
      'Explain why no repository change was produced and bind the conclusion to available checks or evidence.',
    ));
  }
  const unknowns = validateUnknowns(value.residualUnknowns, claims, references, issues);
  const reviewMap = validateReviewMap(value.reviewMap, claims, unknowns, references, issues);
  const alternatives = validateAlternatives(value.materialAlternatives ?? [], references, issues);
  throwHandoffIssues(issues);
  return {
    ...ENVELOPE,
    systemMeaningUpdate,
    materialClaims: claims,
    residualUnknowns: unknowns,
    reviewMap,
    ...(alternatives.length ? { materialAlternatives: alternatives } : {}),
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
  };
}

interface ReferenceContext {
  changedFiles: Map<string, ChangedFileFact>;
  checks: Map<string, CheckFact>;
  repositoryEvidence: Map<string, RepositoryEvidence>;
  humanEvents: Map<string, { id: string; kind: 'task' | 'decision' }>;
  hasPatch: boolean;
}

function referenceContext(
  facts: FactBundle,
  contract: EvaluateHandoffInput['contract'],
  evidence: RepositoryEvidence[],
): ReferenceContext {
  const changedFiles = new Map<string, ChangedFileFact>();
  for (const file of facts.changedFiles) {
    changedFiles.set(file.path, file);
    if (file.previousPath) changedFiles.set(file.previousPath, file);
  }
  return {
    changedFiles,
    checks: new Map(facts.checks.map((check) => [check.id, check])),
    repositoryEvidence: new Map(evidence.map((item) => [item.id, item])),
    humanEvents: new Map(contract.authority.humanEvents.map((event) => [event.id, event])),
    hasPatch: Boolean(facts.patch),
  };
}

function validateClaims(
  value: unknown,
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
): MaterialClaim[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(handoffIssue(
      'material-claims-required',
      'materialClaims',
      'Material claims must be a non-empty array.',
      'Add only adoption-relevant conclusions about the actual collected change.',
    ));
    return [];
  }
  const output: MaterialClaim[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `materialClaims[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(handoffIssue('claim-object-required', path, 'Claim must be an object.', 'Replace it with a claim object.'));
      continue;
    }
    rejectExtraKeys(candidate, [
      'id',
      'dimension',
      'statement',
      'adoptionConsequence',
      'adoptionCritical',
      'basis',
      'evidence',
      'falsification',
    ], path, issues);
    const id = stableUniqueId(candidate.id, `${path}.id`, ids, issues);
    const dimension = typeof candidate.dimension === 'string' && CLAIM_DIMENSIONS.has(candidate.dimension)
      ? candidate.dimension as MaterialClaim['dimension']
      : undefined;
    if (!dimension) {
      issues.push(handoffIssue(
        'claim-dimension-invalid',
        `${path}.dimension`,
        'Claim dimension is unsupported.',
        'Use one documented behavior, invariant, ownership, flow, compatibility, recovery, operational, or non-change dimension.',
      ));
    }
    const statement = requiredString(candidate.statement, `${path}.statement`, 'Claim statement is required.', issues);
    const adoptionConsequence = requiredString(
      candidate.adoptionConsequence,
      `${path}.adoptionConsequence`,
      'Claim adoption consequence is required.',
      issues,
    );
    const adoptionCritical = typeof candidate.adoptionCritical === 'boolean'
      ? candidate.adoptionCritical
      : undefined;
    if (adoptionCritical === undefined) {
      issues.push(handoffIssue(
        'claim-criticality-invalid',
        `${path}.adoptionCritical`,
        'Claim adoptionCritical must be boolean.',
        'State whether an incorrect conclusion could materially change adoption.',
      ));
    }
    const basis = typeof candidate.basis === 'string' && CLAIM_BASES.has(candidate.basis as ClaimBasis)
      ? candidate.basis as ClaimBasis
      : undefined;
    if (!basis) {
      issues.push(handoffIssue(
        'claim-basis-invalid',
        `${path}.basis`,
        'Claim basis is unsupported.',
        'Use repository-evidence, agent-judgment, human-decision, or unverified; Runtime facts are generated separately.',
      ));
    }
    const evidence = validateEvidenceSelection(candidate.evidence, `${path}.evidence`, references, issues);
    const requiresChallenge = Boolean(adoptionCritical && basis && requiresFalsificationBasis(basis));
    const falsification = validateFalsification(
      candidate.falsification,
      `${path}.falsification`,
      references,
      requiresChallenge,
      basis,
      issues,
    );
    if (basis) validateClaimBasis(basis, Boolean(adoptionCritical), evidence, references, path, issues);
    if (id && dimension && statement && adoptionConsequence
      && adoptionCritical !== undefined && basis) {
      output.push({
        id,
        dimension,
        statement,
        adoptionConsequence,
        adoptionCritical,
        basis,
        evidence,
        ...(falsification ? { falsification } : {}),
      });
    }
  }
  return output;
}

function validateClaimBasis(
  basis: ClaimBasis,
  adoptionCritical: boolean,
  evidence: HandoffEvidenceSelection,
  references: ReferenceContext,
  path: string,
  issues: HandoffValidationIssue[],
): void {
  if (basis === 'repository-evidence' && !evidence.repositoryEvidence?.length) {
    issues.push(handoffIssue(
      'repository-evidence-required',
      `${path}.evidence.repositoryEvidence`,
      'A repository-evidence claim requires repository evidence.',
      'Add an exact repository evidence window and select its ID.',
    ));
  }
  if (basis === 'human-decision') {
    const ids = evidence.humanEvents ?? [];
    if (!ids.length || ids.some((id) => references.humanEvents.get(id)?.kind !== 'decision')) {
      issues.push(handoffIssue(
        'human-decision-required',
        `${path}.evidence.humanEvents`,
        'A human-decision claim requires an exact decision Human Event.',
        'Reference at least one decision event from the Semantic Contract.',
      ));
    }
  }
  if (basis === 'agent-judgment' && adoptionCritical && !hasEvidence(evidence)) {
    issues.push(handoffIssue(
      'agent-evidence-required',
      `${path}.evidence`,
      'An adoption-critical Agent judgment requires an explicit evidence boundary.',
      'Select the exact changed paths, checks, repository evidence, Human Events, or collected patch inspected.',
    ));
  }
  if (basis === 'unverified' && hasEvidence(evidence)) {
    issues.push(handoffIssue(
      'unverified-evidence-forbidden',
      `${path}.evidence`,
      'An unverified claim cannot present evidence as its established basis.',
      'Remove the basis evidence; attempted evidence may remain inside falsification.',
    ));
  }
}

function validateFalsification(
  value: unknown,
  path: string,
  references: ReferenceContext,
  required: boolean,
  basis: ClaimBasis | undefined,
  issues: HandoffValidationIssue[],
): ClaimFalsification | undefined {
  if (value === undefined) {
    if (required) {
      issues.push(handoffIssue(
        'falsification-required',
        path,
        'This adoption-critical semantic claim requires falsification.',
        'State a concrete failure hypothesis, how it was challenged, and the bounded result.',
      ));
    }
    return undefined;
  }
  if (!required) {
    issues.push(handoffIssue(
      'falsification-not-applicable',
      path,
      'Falsification is accepted only for adoption-critical Agent, repository-evidence, or unverified claims.',
      'Remove this falsification or mark the applicable semantic claim adoption-critical.',
    ));
  }
  if (!isRecord(value)) {
    issues.push(handoffIssue('falsification-object-required', path, 'Falsification must be an object.', 'Replace it with the documented falsification object.'));
    return undefined;
  }
  rejectExtraKeys(value, [
    'failureHypothesis',
    'attempt',
    'status',
    'supportingEvidence',
    'counterEvidence',
    'conclusion',
  ], path, issues);
  const failureHypothesis = requiredString(
    value.failureHypothesis,
    `${path}.failureHypothesis`,
    'A concrete failure hypothesis is required.',
    issues,
  );
  const attempt = requiredString(value.attempt, `${path}.attempt`, 'A concrete challenge attempt is required.', issues);
  const status = typeof value.status === 'string' && FALSIFICATION_STATUSES.has(value.status)
    ? value.status as ClaimFalsification['status']
    : undefined;
  if (!status) {
    issues.push(handoffIssue(
      'falsification-status-invalid',
      `${path}.status`,
      'Falsification status is unsupported.',
      'Use supported, contradicted, partial, or unverified.',
    ));
  }
  const supportingEvidence = validateEvidenceSelection(
    value.supportingEvidence,
    `${path}.supportingEvidence`,
    references,
    issues,
  );
  const counterEvidence = validateEvidenceSelection(
    value.counterEvidence,
    `${path}.counterEvidence`,
    references,
    issues,
  );
  const conclusion = requiredString(value.conclusion, `${path}.conclusion`, 'A bounded falsification conclusion is required.', issues);
  if (status === 'supported' && !hasEvidence(supportingEvidence)) {
    issues.push(handoffIssue(
      'supported-evidence-required',
      `${path}.supportingEvidence`,
      'A supported falsification requires supporting evidence.',
      'Select the exact evidence that survived the stated challenge.',
    ));
  }
  if ((status === 'contradicted' || status === 'partial') && !hasEvidence(counterEvidence)) {
    issues.push(handoffIssue(
      'counterevidence-required',
      `${path}.counterEvidence`,
      `${status} falsification requires counterevidence.`,
      'Select the exact changed path, check, repository evidence, Human Event, or patch that limits the claim.',
    ));
  }
  if (status === 'supported' && hasEvidence(counterEvidence)) {
    issues.push(handoffIssue(
      'supported-counterevidence-forbidden',
      `${path}.counterEvidence`,
      'A supported falsification cannot hide counterevidence.',
      'Use partial or contradicted, or remove evidence that is not actually counterevidence.',
    ));
  }
  if (basis === 'unverified' && status === 'supported') {
    issues.push(handoffIssue(
      'unverified-supported-forbidden',
      `${path}.status`,
      'An unverified claim cannot have a supported falsification result.',
      'Use unverified or change the claim basis only if the evidence establishes it.',
    ));
  }
  return failureHypothesis && attempt && status && conclusion
    ? {
        failureHypothesis,
        attempt,
        status,
        supportingEvidence,
        counterEvidence,
        conclusion,
      }
    : undefined;
}

function validateUnknowns(
  value: unknown,
  claims: MaterialClaim[],
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
): ResidualUnknown[] {
  if (!Array.isArray(value)) {
    issues.push(handoffIssue('unknowns-array-required', 'residualUnknowns', 'Residual unknowns must be an array.', 'Use an empty array when no material unknown remains.'));
    return [];
  }
  const claimIds = new Map(claims.map((claim) => [claim.id, claim]));
  const output: ResidualUnknown[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `residualUnknowns[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(handoffIssue('unknown-object-required', path, 'Residual unknown must be an object.', 'Replace it with the documented unknown object.'));
      continue;
    }
    rejectExtraKeys(candidate, [
      'id',
      'statement',
      'adoptionImpact',
      'validationPath',
      'references',
    ], path, issues);
    const id = stableUniqueId(candidate.id, `${path}.id`, ids, issues);
    const statement = requiredString(candidate.statement, `${path}.statement`, 'Unknown statement is required.', issues);
    const adoptionImpact = requiredString(candidate.adoptionImpact, `${path}.adoptionImpact`, 'Unknown adoption impact is required.', issues);
    const validationPath = requiredString(candidate.validationPath, `${path}.validationPath`, 'Unknown validation path is required.', issues);
    let relatedClaims: string[] = [];
    let changedFiles: string[] = [];
    if (!isRecord(candidate.references)) {
      issues.push(handoffIssue(
        'unknown-references-required',
        `${path}.references`,
        'Residual unknown references must be an object.',
        'Provide claims and changedFiles arrays under references.',
      ));
    } else {
      rejectExtraKeys(candidate.references, ['claims', 'changedFiles'], `${path}.references`, issues);
      relatedClaims = validateKnownIds(
        candidate.references.claims,
        claimIds,
        `${path}.references.claims`,
        'claim',
        issues,
      );
      changedFiles = validateChangedPaths(
        candidate.references.changedFiles,
        `${path}.references.changedFiles`,
        references,
        issues,
      );
    }
    if (!relatedClaims.length && !changedFiles.length) {
      issues.push(handoffIssue(
        'unknown-reference-required',
        path,
        'Residual unknown requires a related claim or changed path.',
        'Bind the unknown to the exact conclusion or implementation surface it affects.',
      ));
    }
    if (id && statement && adoptionImpact && validationPath) {
      output.push({
        id,
        statement,
        adoptionImpact,
        validationPath,
        references: { claims: relatedClaims, changedFiles },
      });
    }
  }
  return output;
}

function validateReviewMap(
  value: unknown,
  claims: MaterialClaim[],
  unknowns: ResidualUnknown[],
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
): ReviewMapEntry[] {
  if (!Array.isArray(value)) {
    issues.push(handoffIssue('review-map-array-required', 'reviewMap', 'Review Map must be an array.', 'Use an empty array only when no direct review surface is material.'));
    return [];
  }
  const claimIds = new Map(claims.map((claim) => [claim.id, claim]));
  const unknownIds = new Map(unknowns.map((unknown) => [unknown.id, unknown]));
  const output: ReviewMapEntry[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `reviewMap[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(handoffIssue('review-entry-object-required', path, 'Review Map entry must be an object.', 'Replace it with the documented review object.'));
      continue;
    }
    rejectExtraKeys(candidate, [
      'id',
      'priority',
      'changedFiles',
      'checkIds',
      'claimIds',
      'unknownIds',
      'rationale',
      'prevents',
    ], path, issues);
    const id = stableUniqueId(candidate.id, `${path}.id`, ids, issues);
    const priority = typeof candidate.priority === 'string' && REVIEW_PRIORITIES.has(candidate.priority)
      ? candidate.priority as ReviewMapEntry['priority']
      : undefined;
    if (!priority) {
      issues.push(handoffIssue(
        'review-priority-invalid',
        `${path}.priority`,
        'Review priority is unsupported.',
        'Use must-read, useful-to-sample, mechanically-covered, or unresolved.',
      ));
    }
    const changedFiles = validateChangedPaths(candidate.changedFiles, `${path}.changedFiles`, references, issues);
    const checkIds = validateKnownIds(candidate.checkIds, references.checks, `${path}.checkIds`, 'check', issues);
    const selectedClaimIds = validateKnownIds(candidate.claimIds, claimIds, `${path}.claimIds`, 'claim', issues);
    const selectedUnknownIds = validateKnownIds(candidate.unknownIds, unknownIds, `${path}.unknownIds`, 'unknown', issues);
    const rationale = requiredString(candidate.rationale, `${path}.rationale`, 'Review rationale is required.', issues);
    const prevents = requiredString(candidate.prevents, `${path}.prevents`, 'Review prevention consequence is required.', issues);
    if (!changedFiles.length && !checkIds.length && !selectedClaimIds.length && !selectedUnknownIds.length) {
      issues.push(handoffIssue(
        'review-reference-required',
        path,
        'Review Map entry must direct attention to concrete content.',
        'Select an exact changed path, check, claim, or residual unknown.',
      ));
    }
    if (id && priority && rationale && prevents) {
      output.push({
        id,
        priority,
        changedFiles,
        checkIds,
        claimIds: selectedClaimIds,
        unknownIds: selectedUnknownIds,
        rationale,
        prevents,
      });
    }
  }
  const urgentClaims = claims
    .filter((claim) => requiresFalsification(claim) && claim.falsification?.status !== 'supported')
    .map((claim) => claim.id);
  const urgentEntries = output.filter((entry) => entry.priority === 'must-read' || entry.priority === 'unresolved');
  const coveredClaims = new Set(urgentEntries.flatMap((entry) => entry.claimIds));
  for (const claimId of urgentClaims) {
    if (!coveredClaims.has(claimId)) {
      issues.push(handoffIssue(
        'urgent-claim-review-required',
        'reviewMap',
        `Unresolved critical claim ${claimId} requires must-read or unresolved review coverage.`,
        'Add a Review Map entry that points to this claim and its concrete implementation surface.',
      ));
    }
  }
  const coveredUnknowns = new Set(urgentEntries.flatMap((entry) => entry.unknownIds));
  for (const unknown of unknowns) {
    if (!coveredUnknowns.has(unknown.id)) {
      issues.push(handoffIssue(
        'residual-unknown-review-required',
        'reviewMap',
        `Residual unknown ${unknown.id} requires must-read or unresolved review coverage.`,
        'Add a Review Map entry that points to this unknown and its validation surface.',
      ));
    }
  }
  return output;
}

function validateAlternatives(
  value: unknown,
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
): MaterialAlternative[] {
  if (!Array.isArray(value)) {
    issues.push(handoffIssue('alternatives-array-required', 'materialAlternatives', 'Material alternatives must be an array.', 'Remove the field or provide an array.'));
    return [];
  }
  const ids = new Set<string>();
  const output: MaterialAlternative[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `materialAlternatives[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(handoffIssue('alternative-object-required', path, 'Material alternative must be an object.', 'Replace it with the documented alternative object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['id', 'description', 'tradeoff', 'reasonNotChosen', 'humanEventIds'], path, issues);
    const id = stableUniqueId(candidate.id, `${path}.id`, ids, issues);
    const description = requiredString(candidate.description, `${path}.description`, 'Alternative description is required.', issues);
    const tradeoff = requiredString(candidate.tradeoff, `${path}.tradeoff`, 'Alternative tradeoff is required.', issues);
    const reasonNotChosen = requiredString(candidate.reasonNotChosen, `${path}.reasonNotChosen`, 'Alternative rejection reason is required.', issues);
    const humanEventIds = validateKnownIds(
      candidate.humanEventIds,
      references.humanEvents,
      `${path}.humanEventIds`,
      'Human Event',
      issues,
    );
    if (id && description && tradeoff && reasonNotChosen) {
      output.push({ id, description, tradeoff, reasonNotChosen, humanEventIds });
    }
  }
  return output;
}

function validateRepositoryEvidence(
  value: unknown,
  issues: HandoffValidationIssue[],
): RepositoryEvidence[] {
  if (!Array.isArray(value)) {
    issues.push(handoffIssue('repository-evidence-array-required', 'repositoryEvidence', 'Repository evidence must be an array.', 'Remove the field or provide exact materialized evidence windows.'));
    return [];
  }
  const ids = new Set<string>();
  const output: RepositoryEvidence[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `repositoryEvidence[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(handoffIssue('repository-evidence-object-required', path, 'Repository evidence must be an object.', 'Replace it with an exact evidence window.'));
      continue;
    }
    rejectExtraKeys(candidate, ['id', 'path', 'startLine', 'endLine', 'text', 'digest'], path, issues);
    const id = stableUniqueId(candidate.id, `${path}.id`, ids, issues);
    const valid = id
      && isSafeRepositoryPath(candidate.path)
      && Number.isInteger(candidate.startLine)
      && Number(candidate.startLine) >= 1
      && Number.isInteger(candidate.endLine)
      && Number(candidate.endLine) >= Number(candidate.startLine)
      && typeof candidate.text === 'string'
      && candidate.digest === sha256(candidate.text);
    if (!valid) {
      issues.push(handoffIssue(
        'repository-evidence-invalid',
        path,
        'Repository evidence is malformed or stale.',
        'Re-select the exact current repository path and line window before finalizing.',
      ));
      continue;
    }
    output.push({
      id,
      path: candidate.path as string,
      startLine: Number(candidate.startLine),
      endLine: Number(candidate.endLine),
      text: candidate.text as string,
      digest: candidate.digest as string,
    });
  }
  return output;
}

function validateEvidenceSelection(
  value: unknown,
  path: string,
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
): HandoffEvidenceSelection {
  if (!isRecord(value)) {
    issues.push(handoffIssue(
      'evidence-selection-required',
      path,
      'Evidence selection must be an object.',
      'Use an empty object when intentionally unverified, or select exact changed paths, checks, evidence, Human Events, or patch.',
    ));
    return {};
  }
  rejectExtraKeys(value, [
    'changedFiles',
    'checks',
    'repositoryEvidence',
    'humanEvents',
    'patch',
  ], path, issues);
  const changedFiles = validateChangedPaths(value.changedFiles, `${path}.changedFiles`, references, issues, true);
  const checks = validateKnownIds(value.checks, references.checks, `${path}.checks`, 'check', issues, true);
  const repositoryEvidence = validateKnownIds(
    value.repositoryEvidence,
    references.repositoryEvidence,
    `${path}.repositoryEvidence`,
    'repository evidence',
    issues,
    true,
  );
  const humanEvents = validateKnownIds(
    value.humanEvents,
    references.humanEvents,
    `${path}.humanEvents`,
    'Human Event',
    issues,
    true,
  );
  let patch: true | undefined;
  if (value.patch !== undefined) {
    if (value.patch !== true) {
      issues.push(handoffIssue(
        'patch-selection-invalid',
        `${path}.patch`,
        'Patch selection must be true when present.',
        'Remove the field or set it to true to select the collected patch.',
      ));
    } else if (!references.hasPatch) {
      issues.push(handoffIssue(
        'patch-unavailable',
        `${path}.patch`,
        'This Fact Bundle has no representable collected patch.',
        'Select exact changed paths or other available evidence instead.',
      ));
    } else {
      patch = true;
    }
  }
  return {
    ...(changedFiles.length ? { changedFiles } : {}),
    ...(checks.length ? { checks } : {}),
    ...(repositoryEvidence.length ? { repositoryEvidence } : {}),
    ...(humanEvents.length ? { humanEvents } : {}),
    ...(patch ? { patch } : {}),
  };
}

function validateChangedPaths(
  value: unknown,
  path: string,
  references: ReferenceContext,
  issues: HandoffValidationIssue[],
  optional = false,
): string[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) {
    issues.push(handoffIssue('changed-paths-array-required', path, 'Changed paths must be an array.', 'Use exact repository-relative paths returned by collect.'));
    return [];
  }
  const output: string[] = [];
  const selectedFacts = new Set<string>();
  for (const [index, selector] of value.entries()) {
    if (!isSafeRepositoryPath(selector) || !references.changedFiles.has(selector)) {
      issues.push(handoffIssue(
        'changed-path-unknown',
        `${path}[${index}]`,
        `Unknown changed path ${String(selector)}.`,
        'Use an exact current or previous path from collect.changedFiles.',
      ));
      continue;
    }
    const fact = references.changedFiles.get(selector)!;
    if (selectedFacts.has(fact.id)) {
      issues.push(handoffIssue(
        'changed-path-duplicate',
        `${path}[${index}]`,
        `Changed path ${selector} selects a duplicate changed-file fact.`,
        'Keep only one current or previous path for the same change.',
      ));
      continue;
    }
    selectedFacts.add(fact.id);
    output.push(fact.path);
  }
  return output;
}

function validateKnownIds<T>(
  value: unknown,
  known: Map<string, T>,
  path: string,
  label: string,
  issues: HandoffValidationIssue[],
  optional = false,
): string[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) {
    issues.push(handoffIssue(`${label.toLowerCase().replaceAll(' ', '-')}-ids-array-required`, path, `${label} IDs must be an array.`, `Use exact ${label} IDs exposed by the active run.`));
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const [index, id] of value.entries()) {
    if (!isStableId(id) || !known.has(id)) {
      issues.push(handoffIssue(
        `${label.toLowerCase().replaceAll(' ', '-')}-id-unknown`,
        `${path}[${index}]`,
        `Unknown ${label} ID ${String(id)}.`,
        `Use an exact ${label} ID exposed by the active run.`,
      ));
      continue;
    }
    if (seen.has(id)) {
      issues.push(handoffIssue(
        `${label.toLowerCase().replaceAll(' ', '-')}-id-duplicate`,
        `${path}[${index}]`,
        `Duplicate ${label} ID ${id}.`,
        'Remove the duplicate selector.',
      ));
      continue;
    }
    seen.add(id);
    output.push(id);
  }
  return output;
}

function rejectExtraKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: HandoffValidationIssue[],
): void {
  for (const key of hasExactKeys(value, allowed)) {
    issues.push(handoffIssue(
      'unsupported-field',
      `${path}.${key}`,
      `Unsupported field ${key}.`,
      'Remove the field and use only the generated handoff contract.',
    ));
  }
}

function stableUniqueId(
  value: unknown,
  path: string,
  ids: Set<string>,
  issues: HandoffValidationIssue[],
): string | undefined {
  if (!isStableId(value)) {
    issues.push(handoffIssue('stable-id-invalid', path, 'ID must be a stable non-empty identifier.', 'Use letters, numbers, dot, underscore, colon, or hyphen.'));
    return undefined;
  }
  if (ids.has(value)) {
    issues.push(handoffIssue('stable-id-duplicate', path, `Duplicate ID ${value}.`, 'Use a unique semantic identifier.'));
    return undefined;
  }
  ids.add(value);
  return value;
}

function requiredString(
  value: unknown,
  path: string,
  message: string,
  issues: HandoffValidationIssue[],
): string {
  if (!isNonEmptyString(value)) {
    issues.push(handoffIssue('non-empty-string-required', path, message, 'Provide a concrete non-empty statement.'));
    return '';
  }
  return value.trim();
}

function hasEvidence(value: HandoffEvidenceSelection): boolean {
  return Boolean(
    value.patch
    || value.changedFiles?.length
    || value.checks?.length
    || value.repositoryEvidence?.length
    || value.humanEvents?.length,
  );
}

function requiresFalsificationBasis(basis: ClaimBasis): boolean {
  return basis === 'agent-judgment' || basis === 'repository-evidence' || basis === 'unverified';
}

function requiresFalsification(claim: MaterialClaim): boolean {
  return claim.adoptionCritical && requiresFalsificationBasis(claim.basis);
}

function handoffIssue(
  code: string,
  path: string,
  message: string,
  remediation: string,
): HandoffValidationIssue {
  return { code, path, message, remediation };
}

function throwHandoffIssues(issues: HandoffValidationIssue[]): void {
  if (!issues.length) return;
  throw new HandoffValidationError([...issues].sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code)));
}
