import { validateAuthority } from '../authority/validate.ts';
import type {
  AgentInterpretation,
  InterpretationBasis,
  InterpretationField,
} from '../authority/types.ts';
import {
  compileAssurancePlan,
  isClaimDimension,
} from '../assurance/policy.ts';
import type {
  AssuranceCriticality,
  AssuranceRequirement,
} from '../assurance/types.ts';
import {
  assertProtocol,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSafeRepositoryPath,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  sortedUnique,
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
    'repositoryEvidence',
    'semantic',
    'verification',
  ])) {
    issues.push(issue('unsupported-field', key, `Unsupported compile input field ${key}.`));
  }

  const authorityResult = validateAuthority(source);
  issues.push(...authorityResult.issues);
  const semanticResult = validateSemantic(
    source.semantic,
    new Set(authorityResult.authority.humanEvents.map((event) => event.id)),
    new Set(authorityResult.authority.repositoryEvidence.map((evidence) => evidence.id)),
  );
  issues.push(...semanticResult.issues);
  const verificationResult = validateVerification(source.verification);
  issues.push(...verificationResult.issues);

  if (issues.length || !semanticResult.semantic) {
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
  const selected = semanticResult.semantic;
  const interpretations = [
    selected.desiredOutcome,
    ...selected.constraints,
    ...selected.nonGoals,
    ...selected.focus,
    selected.consequence,
    ...selected.assuranceDimensions,
  ];
  const assurancePlan = compileAssurancePlan(
    selected.consequence.value as ConsequenceLevel,
    selected.assuranceDimensions,
  );
  const contractWithoutId = {
    ...ENVELOPE,
    authority: {
      humanEvents: authority.humanEvents,
      providerTrustBoundary: 'host-supplied-events-not-runtime-authenticated' as const,
    },
    semantic: {
      desiredOutcome: selected.desiredOutcome,
      constraints: selected.constraints,
      nonGoals: selected.nonGoals,
      focus: selected.focus,
      consequence: selected.consequence.value as ConsequenceLevel,
      consequenceInterpretation: selected.consequence,
    },
    repositoryEvidence: authority.repositoryEvidence,
    interpretationTrace: interpretations,
    assurancePlan,
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
  eventIds: Set<string>,
  evidenceIds: Set<string>,
): {
  semantic?: {
    desiredOutcome: AgentInterpretation;
    constraints: AgentInterpretation[];
    nonGoals: AgentInterpretation[];
    focus: AgentInterpretation[];
    consequence: AgentInterpretation;
    assuranceDimensions: AssuranceRequirement[];
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
    'desiredOutcome',
    'constraints',
    'nonGoals',
    'focus',
    'consequence',
    'assuranceDimensions',
    'unresolvedMaterialFork',
  ])) {
    issues.push(issue('unsupported-field', `semantic.${key}`, `Unsupported semantic field ${key}.`));
  }
  const desiredOutcome = validateSemanticValue(
    value.desiredOutcome,
    'semantic.desiredOutcome',
    'desired-outcome',
    0,
    eventIds,
    evidenceIds,
    issues,
  );
  const constraints = validateSemanticValues(
    value.constraints,
    'semantic.constraints',
    'constraint',
    eventIds,
    evidenceIds,
    issues,
  );
  const nonGoals = validateSemanticValues(
    value.nonGoals,
    'semantic.nonGoals',
    'non-goal',
    eventIds,
    evidenceIds,
    issues,
  );
  const focus = validateSemanticValues(
    value.focus,
    'semantic.focus',
    'focus-path',
    eventIds,
    evidenceIds,
    issues,
  );
  const consequence = validateSemanticValue(
    value.consequence,
    'semantic.consequence',
    'consequence',
    0,
    eventIds,
    evidenceIds,
    issues,
  );
  const assuranceDimensions = validateAssuranceDimensions(
    value.assuranceDimensions,
    eventIds,
    evidenceIds,
    issues,
  );
  if (consequence?.value === 'medium' && !assuranceDimensions.length) {
    issues.push(issue(
      'assurance-dimension-required',
      'semantic.assuranceDimensions',
      'Medium-consequence work requires at least one explicit assurance dimension.',
    ));
  }
  if (consequence?.value === 'high'
    && !assuranceDimensions.some((item) => item.criticality === 'adoption-critical')) {
    issues.push(issue(
      'critical-assurance-dimension-required',
      'semantic.assuranceDimensions',
      'High-consequence work requires at least one adoption-critical assurance dimension.',
    ));
  }

  const fork = value.unresolvedMaterialFork === undefined
    ? undefined
    : validateFork(value.unresolvedMaterialFork, issues);
  return {
    ...(desiredOutcome && consequence
      ? {
          semantic: {
            desiredOutcome,
            constraints,
            nonGoals,
            focus,
            consequence,
            assuranceDimensions,
          },
        }
      : {}),
    ...(fork ? { fork } : {}),
    issues,
  };
}

function validateAssuranceDimensions(
  value: unknown,
  eventIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): AssuranceRequirement[] {
  const path = 'semantic.assuranceDimensions';
  if (!Array.isArray(value)) {
    issues.push(issue(
      'assurance-dimensions-invalid',
      path,
      'Assurance dimensions must be an array; use an empty array only for routine low-consequence work.',
    ));
    return [];
  }
  const output: AssuranceRequirement[] = [];
  const dimensions = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const issueCount = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue(
        'assurance-dimension-invalid',
        itemPath,
        'Assurance dimension must be an object.',
      ));
      continue;
    }
    for (const key of hasExactKeys(candidate, [
      'dimension',
      'criticality',
      'rationale',
      'basis',
    ])) {
      issues.push(issue('unsupported-field', `${itemPath}.${key}`, `Unsupported assurance dimension field ${key}.`));
    }
    const dimension = isClaimDimension(candidate.dimension)
      ? candidate.dimension
      : undefined;
    if (!dimension) {
      issues.push(issue(
        'assurance-dimension-value-invalid',
        `${itemPath}.dimension`,
        'Assurance dimension must be one documented handoff claim dimension.',
      ));
    } else if (dimensions.has(dimension)) {
      issues.push(issue(
        'assurance-dimension-duplicate',
        `${itemPath}.dimension`,
        `Assurance dimension ${dimension} is duplicated.`,
      ));
    }
    const criticality = candidate.criticality === 'material'
      || candidate.criticality === 'adoption-critical'
      ? candidate.criticality as AssuranceCriticality
      : undefined;
    if (!criticality) {
      issues.push(issue(
        'assurance-criticality-invalid',
        `${itemPath}.criticality`,
        'Assurance criticality must be material or adoption-critical.',
      ));
    }
    const rationale = isNonEmptyString(candidate.rationale)
      ? candidate.rationale.trim()
      : undefined;
    if (!rationale) {
      issues.push(issue(
        'assurance-rationale-required',
        `${itemPath}.rationale`,
        'Assurance dimension requires a concrete adoption rationale.',
      ));
    }
    const basis = validateInterpretationBasis(
      candidate.basis,
      `${itemPath}.basis`,
      eventIds,
      evidenceIds,
      issues,
    );
    if (issues.length !== issueCount || !dimension || !criticality || !rationale || !basis) {
      continue;
    }
    dimensions.add(dimension);
    output.push({
      id: `meaning:assurance-dimension:${stableFingerprint({
        field: 'assurance-dimension',
        value: dimension,
        criticality,
        rationale,
        basis,
      }).slice('sha256:'.length)}`,
      field: 'assurance-dimension',
      value: dimension,
      criticality,
      rationale,
      basis,
    });
  }
  return output.sort((left, right) => left.value.localeCompare(right.value));
}

function validateSemanticValues(
  value: unknown,
  path: string,
  field: InterpretationField,
  eventIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): AgentInterpretation[] {
  if (!Array.isArray(value)) {
    issues.push(issue('semantic-values-invalid', path, 'Semantic values must be an array.'));
    return [];
  }
  return value.flatMap((candidate, index) => {
    const interpretation = validateSemanticValue(
      candidate,
      `${path}[${index}]`,
      field,
      index,
      eventIds,
      evidenceIds,
      issues,
    );
    return interpretation ? [interpretation] : [];
  });
}

function validateSemanticValue(
  value: unknown,
  path: string,
  field: InterpretationField,
  index: number,
  eventIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): AgentInterpretation | undefined {
  const issueCount = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('semantic-value-invalid', path, 'Semantic value must contain value and basis.'));
    return undefined;
  }
  for (const key of hasExactKeys(value, ['value', 'basis'])) {
    issues.push(issue('unsupported-field', `${path}.${key}`, `Unsupported semantic value field ${key}.`));
  }
  if (!isNonEmptyString(value.value)) {
    issues.push(issue('semantic-value-empty', `${path}.value`, 'Semantic value is required.'));
  } else if (field === 'focus-path' && !isSafeRepositoryPath(value.value)) {
    issues.push(issue('focus-path-unsafe', `${path}.value`, 'Focus paths must be safe repository-relative paths.'));
  } else if (field === 'consequence' && !['low', 'medium', 'high'].includes(value.value)) {
    issues.push(issue('consequence-invalid', `${path}.value`, 'Consequence must be low, medium, or high.'));
  }
  const basis = validateInterpretationBasis(
    value.basis,
    `${path}.basis`,
    eventIds,
    evidenceIds,
    issues,
  );
  if (issues.length !== issueCount || !basis || !isNonEmptyString(value.value)) {
    return undefined;
  }
  const normalizedValue = value.value.trim();
  return {
    id: `meaning:${field}:${stableFingerprint({ field, index, value: normalizedValue, basis }).slice('sha256:'.length)}`,
    field,
    value: normalizedValue,
    basis,
  };
}

function validateInterpretationBasis(
  value: unknown,
  path: string,
  eventIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): InterpretationBasis | undefined {
  const issueCount = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('interpretation-basis-invalid', path, 'Interpretation basis must be an object.'));
    return undefined;
  }
  for (const key of hasExactKeys(value, ['humanEventIds', 'repositoryEvidenceIds'])) {
    issues.push(issue('unsupported-field', `${path}.${key}`, `Unsupported basis field ${key}.`));
  }
  const humanEventIds = validateReferenceList(
    value.humanEventIds,
    `${path}.humanEventIds`,
    'Human Event',
    eventIds,
    'human-event-reference-missing',
    issues,
  );
  const repositoryEvidenceIds = validateReferenceList(
    value.repositoryEvidenceIds,
    `${path}.repositoryEvidenceIds`,
    'Repository evidence',
    evidenceIds,
    'repository-evidence-reference-missing',
    issues,
  );
  if (!humanEventIds.length && !repositoryEvidenceIds.length) {
    issues.push(issue(
      'interpretation-basis-empty',
      path,
      'Every Agent interpretation must reference at least one Human Event or repository evidence window.',
    ));
  }
  return issues.length === issueCount
    ? { humanEventIds, repositoryEvidenceIds }
    : undefined;
}

function validateReferenceList(
  value: unknown,
  path: string,
  label: string,
  available: Set<string>,
  missingCode: string,
  issues: ValidationIssue[],
): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item))) {
    issues.push(issue('reference-list-invalid', path, 'References must be an array of stable ids.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('reference-list-duplicate', path, 'References must not contain duplicates.'));
  }
  for (const id of value) {
    if (!available.has(id)) {
      issues.push(issue(missingCode, path, `${label} ${JSON.stringify(id)} does not exist.`));
    }
  }
  return sortedUnique(value);
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
    for (const key of hasExactKeys(candidate, [
      'id',
      'rationale',
      'argv',
      'timeoutMs',
      'source',
      'commandDefinitionPaths',
      'acceptanceSurfacePaths',
    ])) {
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
    const commandDefinitionPaths = validateVerifierPaths(
      candidate.commandDefinitionPaths,
      `${path}.commandDefinitionPaths`,
      issues,
    );
    const acceptanceSurfacePaths = validateVerifierPaths(
      candidate.acceptanceSurfacePaths,
      `${path}.acceptanceSurfacePaths`,
      issues,
    );
    if (!commandDefinitionPaths || !acceptanceSurfacePaths) {
      continue;
    }
    const verifierRefs: VerifierRef[] = [
      ...commandDefinitionPaths.map((verifierPath) => ({
        path: verifierPath,
        role: 'command-definition' as const,
      })),
      ...acceptanceSurfacePaths.map((verifierPath) => ({
        path: verifierPath,
        role: 'acceptance-surface' as const,
      })),
    ];
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

function validateVerifierPaths(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] | undefined {
  if (!Array.isArray(value) || value.some((candidate) => !isSafeRepositoryPath(candidate))) {
    issues.push(issue(
      'verification-verifier-paths-invalid',
      path,
      'Verifier paths must be an array of safe repository-relative paths.',
    ));
    return undefined;
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue(
      'verification-verifier-path-duplicate',
      path,
      'Verifier paths must not contain duplicates within the same role.',
    ));
    return undefined;
  }
  return sortedUnique(value);
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
