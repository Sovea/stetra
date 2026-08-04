import { validateAuthority } from '../authority/validate.ts';
import type { AgentInterpretation } from '../authority/types.ts';
import {
  assertProtocol,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSafeRepositoryPath,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  stableFingerprint,
  type ValidationIssue,
} from '../shared/protocol.ts';
import type {
  CompileDelegationInput,
  ConsequenceLevel,
  DelegationCompileResult,
  MaterialSemanticFork,
  SemanticContract,
  VerificationDefinition,
  VerifierRef,
} from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;

export function compileDelegation(input: CompileDelegationInput): DelegationCompileResult {
  assertProtocol(input, 'compileDelegation');
  const source = input as unknown as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const key of hasExactKeys(source, [
    'protocol',
    'schemaVersion',
    'humanEvents',
    'interpretations',
    'repositoryEvidence',
    'semantic',
    'verification',
  ])) {
    issues.push(issue('unsupported-field', key, `Unsupported compile input field ${key}.`));
  }

  const authorityResult = validateAuthority(source);
  issues.push(...authorityResult.issues);
  const semanticResult = validateSemantic(source.semantic, authorityResult.authority?.interpretations ?? []);
  issues.push(...semanticResult.issues);
  const verificationResult = validateVerification(source.verification);
  issues.push(...verificationResult.issues);

  if (issues.length || !authorityResult.authority || !semanticResult.semantic) {
    return { ...ENVELOPE, status: 'authority-invalid', issues };
  }
  if (semanticResult.fork) {
    return {
      ...ENVELOPE,
      status: 'semantic-decision-required',
      fork: semanticResult.fork,
      message: 'A material semantic choice remains unresolved; no run may be created.',
    };
  }
  if (verificationResult.missing) {
    return {
      ...ENVELOPE,
      status: 'verification-required',
      message: 'Provide explicit checks or a concrete no-command rationale; no run may be created.',
    };
  }
  if (!verificationResult.verification) {
    return {
      ...ENVELOPE,
      status: 'authority-invalid',
      issues: [issue('verification-invalid', 'verification', 'Verification configuration is invalid.')],
    };
  }

  const authority = authorityResult.authority;
  const interpretations = authority.interpretations;
  const byId = new Map(interpretations.map((interpretation) => [interpretation.id, interpretation]));
  const selected = semanticResult.semantic;
  const contractWithoutId = {
    ...ENVELOPE,
    authority: {
      humanEvents: authority.humanEvents,
      providerTrustBoundary: 'host-supplied-events-not-runtime-authenticated' as const,
    },
    semantic: {
      desiredOutcome: byId.get(selected.desiredOutcomeId)!,
      constraints: selected.constraintIds.map((id) => byId.get(id)!),
      nonGoals: selected.nonGoalIds.map((id) => byId.get(id)!),
      focus: selected.focusIds.map((id) => byId.get(id)!),
      consequence: byId.get(selected.consequenceId)!.value as ConsequenceLevel,
      consequenceInterpretation: byId.get(selected.consequenceId)!,
    },
    repositoryEvidence: authority.repositoryEvidence,
    interpretationTrace: interpretations,
    authorization: {
      standingAuthorization: 'Necessary local, reversible inspection, edits, verification, diagnosis, and repair inside the compiled semantic contract.',
      escalationBoundary: [
        'A material choice changes the goal, public behavior, compatibility, architectural ownership, irreversible migration strategy, or another long-lived tradeoff.',
        'An external or irreversible effect is required.',
        'An exact exception or verification relaxation is required.',
      ],
      focusPathsArePermissions: false as const,
    },
    verification: verificationResult.verification,
  };
  const contract: SemanticContract = {
    ...contractWithoutId,
    contractId: stableFingerprint(contractWithoutId),
  };
  return { ...ENVELOPE, status: 'delegation-compiled', contract };
}

export function validateCompiledContract(contract: SemanticContract): void {
  assertProtocol(contract, 'evaluateHandoff Semantic Contract');
  if (!contract.contractId || typeof contract.contractId !== 'string') {
    throw new Error('evaluateHandoff Semantic Contract id is invalid.');
  }
  const { contractId: _ignored, ...projection } = contract;
  if (contract.contractId !== stableFingerprint(projection)) {
    throw new Error('evaluateHandoff Semantic Contract fingerprint does not match its content.');
  }
}

function validateSemantic(
  value: unknown,
  interpretations: AgentInterpretation[],
): {
  semantic?: {
    desiredOutcomeId: string;
    constraintIds: string[];
    nonGoalIds: string[];
    focusIds: string[];
    consequenceId: string;
  };
  fork?: MaterialSemanticFork;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      issues: [issue('semantic-envelope-invalid', 'semantic', 'Semantic envelope must be an object.')],
    };
  }
  for (const key of hasExactKeys(value, [
    'desiredOutcomeId',
    'constraintIds',
    'nonGoalIds',
    'focusIds',
    'consequenceId',
    'unresolvedMaterialFork',
  ])) {
    issues.push(issue('unsupported-field', `semantic.${key}`, `Unsupported semantic field ${key}.`));
  }
  const desiredOutcomeId = referenceId(value.desiredOutcomeId, 'semantic.desiredOutcomeId', issues);
  const constraintIds = referenceIds(value.constraintIds, 'semantic.constraintIds', issues);
  const nonGoalIds = referenceIds(value.nonGoalIds, 'semantic.nonGoalIds', issues);
  const focusIds = referenceIds(value.focusIds, 'semantic.focusIds', issues);
  const consequenceId = referenceId(value.consequenceId, 'semantic.consequenceId', issues);
  const byId = new Map(interpretations.map((interpretation) => [interpretation.id, interpretation]));
  requireField(byId, desiredOutcomeId, 'desired-outcome', 'semantic.desiredOutcomeId', issues);
  requireFields(byId, constraintIds, 'constraint', 'semantic.constraintIds', issues);
  requireFields(byId, nonGoalIds, 'non-goal', 'semantic.nonGoalIds', issues);
  requireFields(byId, focusIds, 'focus-path', 'semantic.focusIds', issues);
  requireField(byId, consequenceId, 'consequence', 'semantic.consequenceId', issues);

  const selected = new Set([
    desiredOutcomeId,
    consequenceId,
    ...constraintIds,
    ...nonGoalIds,
    ...focusIds,
  ].filter(Boolean));
  for (const interpretation of interpretations) {
    if (!selected.has(interpretation.id)) {
      issues.push(issue(
        'interpretation-unused',
        `interpretations.${interpretation.id}`,
        'Every supplied interpretation must change the compiled Semantic Contract.',
      ));
    }
  }

  const fork = value.unresolvedMaterialFork === undefined
    ? undefined
    : validateFork(value.unresolvedMaterialFork, issues);
  return {
    ...(desiredOutcomeId && consequenceId
      ? {
          semantic: {
            desiredOutcomeId,
            constraintIds,
            nonGoalIds,
            focusIds,
            consequenceId,
          },
        }
      : {}),
    ...(fork ? { fork } : {}),
    issues,
  };
}

function validateFork(value: unknown, issues: ValidationIssue[]): MaterialSemanticFork | undefined {
  if (!isRecord(value)) {
    issues.push(issue('semantic-fork-invalid', 'semantic.unresolvedMaterialFork', 'Material fork must be an object.'));
    return undefined;
  }
  for (const key of hasExactKeys(value, ['question', 'alternatives', 'decisionImpact'])) {
    issues.push(issue('unsupported-field', `semantic.unresolvedMaterialFork.${key}`, `Unsupported fork field ${key}.`));
  }
  if (!isNonEmptyString(value.question)
    || !Array.isArray(value.alternatives)
    || value.alternatives.length < 2
    || value.alternatives.some((item) => !isNonEmptyString(item))
    || !isNonEmptyString(value.decisionImpact)) {
    issues.push(issue(
      'semantic-fork-invalid',
      'semantic.unresolvedMaterialFork',
      'Material fork requires a question, at least two alternatives, and decision impact.',
    ));
    return undefined;
  }
  return {
    question: value.question.trim(),
    alternatives: value.alternatives.map((item) => String(item).trim()),
    decisionImpact: value.decisionImpact.trim(),
  };
}

function validateVerification(value: unknown): {
  verification?: SemanticContract['verification'];
  missing?: true;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { issues: [issue('verification-invalid', 'verification', 'Verification must be an object.')] };
  }
  for (const key of hasExactKeys(value, ['checks', 'noCommandRationale'])) {
    issues.push(issue('unsupported-field', `verification.${key}`, `Unsupported verification field ${key}.`));
  }
  const rawChecks = value.checks ?? [];
  if (!Array.isArray(rawChecks)) {
    issues.push(issue('verification-checks-invalid', 'verification.checks', 'Checks must be an array.'));
    return { issues };
  }
  const checks: VerificationDefinition[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of rawChecks.entries()) {
    const path = `verification.checks[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue('verification-check-invalid', path, 'Check must be an object.'));
      continue;
    }
    for (const key of hasExactKeys(candidate, ['id', 'rationale', 'argv', 'timeoutMs', 'source', 'verifierRefs'])) {
      issues.push(issue('unsupported-field', `${path}.${key}`, `Unsupported check field ${key}.`));
    }
    if (!isStableId(candidate.id) || ids.has(candidate.id)) {
      issues.push(issue('verification-check-id-invalid', `${path}.id`, 'Check id must be unique and stable.'));
      continue;
    }
    ids.add(candidate.id);
    if (!isNonEmptyString(candidate.rationale)
      || !Array.isArray(candidate.argv)
      || !candidate.argv.length
      || candidate.argv.some((item) => typeof item !== 'string' || !item)
      || !Number.isInteger(candidate.timeoutMs)
      || Number(candidate.timeoutMs) < 1
      || (candidate.source !== 'team-default' && candidate.source !== 'host-task')) {
      issues.push(issue('verification-check-invalid', path, 'Check definition is malformed.'));
      continue;
    }
    const verifierRefs = validateVerifierRefs(candidate.verifierRefs, `${path}.verifierRefs`, issues);
    if (!verifierRefs) {
      continue;
    }
    checks.push({
      id: candidate.id,
      rationale: candidate.rationale.trim(),
      argv: [...candidate.argv],
      timeoutMs: Number(candidate.timeoutMs),
      source: candidate.source,
      verifierRefs,
    });
  }
  const rationale = value.noCommandRationale;
  if (rationale !== undefined && !isNonEmptyString(rationale)) {
    issues.push(issue('no-command-rationale-invalid', 'verification.noCommandRationale', 'No-command rationale must be concrete.'));
  }
  if (checks.length && rationale !== undefined) {
    issues.push(issue('verification-mode-conflict', 'verification', 'Checks and no-command rationale are mutually exclusive.'));
  }
  if (issues.length) return { issues };
  if (checks.length) return { verification: { mode: 'checks', checks }, issues };
  if (isNonEmptyString(rationale)) {
    return { verification: { mode: 'no-command', rationale: rationale.trim() }, issues };
  }
  return { missing: true, issues };
}

function validateVerifierRefs(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): VerifierRef[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('verification-verifier-refs-invalid', path, 'Verifier refs must be an array.'));
    return undefined;
  }
  const output: VerifierRef[] = [];
  const identities = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue('verification-verifier-ref-invalid', itemPath, 'Verifier ref must be an object.'));
      continue;
    }
    for (const key of hasExactKeys(candidate, ['path', 'role'])) {
      issues.push(issue('unsupported-field', `${itemPath}.${key}`, `Unsupported verifier ref field ${key}.`));
    }
    if (!isSafeRepositoryPath(candidate.path)
      || (candidate.role !== 'command-definition' && candidate.role !== 'acceptance-surface')) {
      issues.push(issue(
        'verification-verifier-ref-invalid',
        itemPath,
        'Verifier ref requires a safe repository path and an explicit command-definition or acceptance-surface role.',
      ));
      continue;
    }
    const identity = `${candidate.role}:${candidate.path}`;
    if (identities.has(identity)) {
      issues.push(issue('verification-verifier-ref-duplicate', itemPath, 'Verifier refs must be unique by path and role.'));
      continue;
    }
    identities.add(identity);
    output.push({ path: candidate.path, role: candidate.role });
  }
  return output.length === value.length ? output : undefined;
}

function referenceId(value: unknown, path: string, issues: ValidationIssue[]): string {
  if (!isStableId(value)) {
    issues.push(issue('interpretation-reference-invalid', path, 'Interpretation reference must be a stable id.'));
    return '';
  }
  return value;
}

function referenceIds(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item))) {
    issues.push(issue('interpretation-references-invalid', path, 'Interpretation references must be stable ids.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('interpretation-references-duplicate', path, 'Interpretation references must be unique.'));
  }
  return [...value];
}

function requireField(
  byId: Map<string, AgentInterpretation>,
  id: string,
  field: AgentInterpretation['field'],
  path: string,
  issues: ValidationIssue[],
): void {
  if (!id) return;
  const interpretation = byId.get(id);
  if (!interpretation) {
    issues.push(issue('interpretation-reference-missing', path, `Interpretation ${JSON.stringify(id)} does not exist.`));
  } else if (interpretation.field !== field) {
    issues.push(issue('interpretation-field-mismatch', path, `Interpretation ${id} must have field ${field}.`));
  }
}

function requireFields(
  byId: Map<string, AgentInterpretation>,
  ids: string[],
  field: AgentInterpretation['field'],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const id of ids) requireField(byId, id, field, path, issues);
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
