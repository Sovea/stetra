import type { AgentInterpretation, InterpretationBasis } from '../authority/types.ts';
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
  sortedUnique,
  stableFingerprint,
  type ValidationIssue,
} from '../shared/protocol.ts';
import type {
  AdoptionCondition,
  AdoptionConditionInput,
  CompileDelegationInput,
  DelegationCompileResult,
  DeliveryPlan,
  EvidenceObligation,
  EvidenceObligationStrategy,
  HostPolicyRequirement,
  HostPolicyRequirementInput,
  LogicalVerifier,
  MaterialSemanticFork,
  RepositoryEvidenceInput,
  TaskContract,
  VerificationDefinition,
  VerificationPlan,
  VerificationRevisionInput,
} from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;

interface CheckDraft extends Omit<VerificationDefinition, 'definitionId' | 'baseline'> {
  baselineSource:
    | { mode: 'unknown' }
    | {
        mode: 'task-start';
        rationale: string;
        obligationKeys: Array<{ conditionKey: string; obligationKey: string }>;
      };
}

export function compileDelegation(
  input: CompileDelegationInput | VerificationRevisionInput,
): DelegationCompileResult {
  assertProtocol(input, 'compileDelegation');
  if ('operation' in input) return compileVerificationRevision(input);
  const source = input as unknown as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  rejectExtraKeys(source, [
    'protocol', 'schemaVersion', 'developerEvent', 'task', 'repositoryEvidence',
    'conditions', 'hostPolicyRequirements', 'delivery', 'checks', 'noCommandRationale',
  ], '', issues);

  const developerEvent = validateDeveloperEvent(source.developerEvent, issues);
  const evidence = validateRepositoryEvidence(source.repositoryEvidence ?? [], issues);
  const evidenceByKey = new Map(evidence.map((item) => [item.key, item]));
  const task = validateTaskMeaning(source.task, developerEvent?.id, issues);
  const checkDrafts = validateCheckDrafts(source.checks ?? [], issues);
  const checksByKey = new Map(checkDrafts.map((item) => [item.key, item]));
  const conditions = validateConditions(
    source.conditions, developerEvent?.id, evidenceByKey, checksByKey, issues,
  );
  const obligationsByKey = new Map(conditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      obligationKey(condition.key, obligation.key), obligation,
    ] as const)));
  const definitions = materializeDefinitions(checkDrafts, obligationsByKey, issues);
  const hostPolicyRequirements = validateHostPolicyRequirements(
    source.hostPolicyRequirements, developerEvent?.id, evidenceByKey, issues,
  );
  const plan = validateDelivery(source.delivery, issues);
  const noCommandRationale = source.noCommandRationale;
  if (noCommandRationale !== undefined && !isNonEmptyString(noCommandRationale)) {
    issues.push(issue(
      'no-command-rationale-invalid', 'noCommandRationale',
      'No-command rationale must be a non-empty concrete explanation.',
    ));
  }
  if (definitions.length && noCommandRationale !== undefined) {
    issues.push(issue(
      'verification-mode-conflict', '',
      'Checks and no-command rationale are mutually exclusive.',
    ));
  }

  if (issues.length || !developerEvent || !task || !plan) {
    return { ...ENVELOPE, status: 'authority-invalid', issues };
  }
  if (task.fork) {
    return {
      ...ENVELOPE,
      status: 'semantic-decision-required',
      fork: task.fork,
      message: 'A material Human-owned choice remains unresolved; no task was created.',
    };
  }
  if (!definitions.length && !isNonEmptyString(noCommandRationale)) {
    return {
      ...ENVELOPE,
      status: 'verification-required',
      message: 'Provide explicit checks or a concrete no-command rationale; no task was created.',
    };
  }

  const authorization = {
    standingAuthorization: 'Necessary local reversible inspection, edits, verification, diagnosis, and bounded repair inside the compiled task meaning.',
    escalationBoundary: [
      'A material choice changes the desired outcome, a constraint, compatibility, ownership, public behavior, or another long-lived tradeoff.',
      'An external or irreversible effect is required.',
      'An exact exception or verification relaxation is required.',
      'Collected evidence indicates material semantic drift.',
    ],
    focusPathsArePermissions: false as const,
  };
  const semanticProjection = {
    ...ENVELOPE,
    authority: {
      developerEvent,
      providerTrustBoundary: 'host-supplied-event-not-runtime-authenticated' as const,
    },
    understanding: task.understanding,
    repositoryEvidence: evidence.map(({ key: _key, ...item }) => item),
    adoptionConditions: conditions,
    hostPolicyRequirements,
    authorization,
  };
  const semanticContractId = stableFingerprint(semanticProjection);
  const verificationPlan = buildVerificationPlan(definitions, noCommandRationale);
  const effectiveContractId = stableFingerprint({
    semanticContractId,
    verificationPlanId: verificationPlan.verificationPlanId,
  });
  const contract: TaskContract = {
    ...semanticProjection,
    semanticContractId,
    verificationPlanId: verificationPlan.verificationPlanId,
    effectiveContractId,
    plan,
    verificationPlan,
  };
  return { ...ENVELOPE, status: 'delegation-compiled', contract };
}

function compileVerificationRevision(input: VerificationRevisionInput): DelegationCompileResult {
  const issues: ValidationIssue[] = [];
  const source = input as unknown as Record<string, unknown>;
  rejectExtraKeys(source, ['protocol', 'schemaVersion', 'operation', 'priorContract', 'revision'], '', issues);
  if (input.operation !== 'revise-verification') {
    issues.push(issue('verification-revision-operation-invalid', 'operation', 'Revision operation is invalid.'));
  }
  try {
    validateCompiledContract(input.priorContract);
  } catch (error) {
    issues.push(issue(
      'verification-revision-contract-invalid',
      'priorContract',
      error instanceof Error ? error.message : 'Prior contract is invalid.',
    ));
  }
  if (!isRecord(input.revision)) {
    issues.push(issue('verification-revision-invalid', 'revision', 'Verification revision must be an object.'));
    return { ...ENVELOPE, status: 'authority-invalid', issues };
  }
  rejectExtraKeys(input.revision as unknown as Record<string, unknown>, [
    'kind', 'rationale', 'equivalenceClaim', 'checks', 'noCommandRationale', 'humanAuthorization',
  ], 'revision', issues);
  const kind = ['execution-rebinding', 'verification-plan'].includes(String(input.revision.kind))
    ? input.revision.kind : undefined;
  if (!kind) {
    issues.push(issue('verification-revision-kind-invalid', 'revision.kind', 'Revision kind must be execution-rebinding or verification-plan.'));
  }
  normalized(input.revision.rationale, 'revision.rationale', issues);
  normalized(input.revision.equivalenceClaim, 'revision.equivalenceClaim', issues);
  const drafts = validateCheckDrafts(input.revision.checks ?? [], issues);
  if (drafts.length && input.revision.noCommandRationale !== undefined) {
    issues.push(issue('verification-mode-conflict', 'revision', 'Checks and no-command rationale are mutually exclusive.'));
  }
  if (!drafts.length && !isNonEmptyString(input.revision.noCommandRationale)) {
    issues.push(issue('verification-required', 'revision', 'Revision requires checks or a concrete no-command rationale.'));
  }

  const priorDefinitions = input.priorContract.verificationPlan.mode === 'checks'
    ? input.priorContract.verificationPlan.definitions : [];
  const priorByVerifier = new Map(priorDefinitions.map((definition) =>
    [definition.verifierId, definition]));
  const revisedDrafts = drafts.map((draft): CheckDraft => {
    const prior = priorByVerifier.get(draft.verifierId);
    return prior ? {
      ...draft,
      revision: prior.revision + 1,
      supersedesDefinitionId: prior.definitionId,
    } : draft;
  });
  const obligationsByKey = new Map(input.priorContract.adoptionConditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      obligationKey(condition.key, obligation.key), obligation,
    ] as const)));
  const materializedDefinitions = materializeDefinitions(revisedDrafts, obligationsByKey, issues);
  const definitions = materializedDefinitions.map((definition) => {
    const prior = priorByVerifier.get(definition.verifierId);
    return prior && stableFingerprint(verificationDefinitionContent(prior))
      === stableFingerprint(verificationDefinitionContent(definition))
      ? prior
      : definition;
  }).sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  const retainedVerifierIds = new Set(definitions.map((definition) => definition.verifierId));
  for (const obligation of obligationsByKey.values()) {
    for (const strategy of obligation.strategies) {
      if (strategy.kind === 'runtime-check') {
        for (const verifierId of strategy.verifierIds) {
          if (!retainedVerifierIds.has(verifierId)) {
            issues.push(issue(
              'obligation-verifier-removed',
              'revision.checks',
              `Revision removes verifier ${verifierId} still consumed by obligation ${obligation.id}.`,
            ));
          }
        }
      }
    }
  }
  if (kind === 'execution-rebinding') {
    validateExecutionRebinding(priorDefinitions, definitions, issues);
  }
  const requiresHumanAuthorization = verificationRelaxed(priorDefinitions, definitions);
  if (input.revision.humanAuthorization !== undefined) {
    validateRevisionHumanAuthorization(input.revision.humanAuthorization, issues);
  } else if (requiresHumanAuthorization) {
    issues.push(issue(
      'verification-relaxation-human-authorization-required',
      'revision.humanAuthorization',
      'Removing a verifier, baseline observation, or verifier surface requires an exact Human authorization.',
    ));
  }
  if (issues.length) return { ...ENVELOPE, status: 'authority-invalid', issues };

  const verificationPlan = buildVerificationPlan(definitions, input.revision.noCommandRationale);
  if (verificationPlan.verificationPlanId === input.priorContract.verificationPlanId) {
    return {
      ...ENVELOPE,
      status: 'authority-invalid',
      issues: [issue('verification-revision-noop', 'revision', 'Verification revision must change the immutable Verification Plan.')],
    };
  }
  const effectiveContractId = stableFingerprint({
    semanticContractId: input.priorContract.semanticContractId,
    verificationPlanId: verificationPlan.verificationPlanId,
  });
  return {
    ...ENVELOPE,
    status: 'delegation-compiled',
    contract: {
      ...input.priorContract,
      verificationPlanId: verificationPlan.verificationPlanId,
      effectiveContractId,
      verificationPlan,
    },
  };
}

export function validateCompiledContract(contract: TaskContract): void {
  assertProtocol(contract, 'evaluateHandoff Task Contract');
  if (!isSha256(contract.semanticContractId)
    || !isSha256(contract.verificationPlanId)
    || !isSha256(contract.effectiveContractId)) {
    throw new Error('evaluateHandoff Task Contract identity is invalid.');
  }
  const semanticProjection = {
    protocol: contract.protocol,
    schemaVersion: contract.schemaVersion,
    authority: contract.authority,
    understanding: contract.understanding,
    repositoryEvidence: contract.repositoryEvidence,
    adoptionConditions: contract.adoptionConditions,
    hostPolicyRequirements: contract.hostPolicyRequirements,
    authorization: contract.authorization,
  };
  if (contract.semanticContractId !== stableFingerprint(semanticProjection)) {
    throw new Error('evaluateHandoff Semantic Contract fingerprint does not match its content.');
  }
  const { verificationPlanId: _ignored, ...verificationProjection } = contract.verificationPlan;
  if (contract.verificationPlanId !== stableFingerprint(verificationProjection)
    || contract.verificationPlanId !== contract.verificationPlan.verificationPlanId) {
    throw new Error('evaluateHandoff Verification Plan fingerprint does not match its content.');
  }
  if (contract.effectiveContractId !== stableFingerprint({
    semanticContractId: contract.semanticContractId,
    verificationPlanId: contract.verificationPlanId,
  })) {
    throw new Error('evaluateHandoff effective contract fingerprint does not match its identities.');
  }
}

function validateDeveloperEvent(value: unknown, issues: ValidationIssue[]) {
  const path = 'developerEvent';
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('developer-event-required', path, 'One exact developer event is required.'));
    return undefined;
  }
  rejectExtraKeys(value, ['content', 'provider', 'nativeId'], path, issues);
  const content = normalized(value.content, `${path}.content`, issues);
  if (value.provider !== undefined && !isNonEmptyString(value.provider)) {
    issues.push(issue('developer-event-provider-invalid', `${path}.provider`, 'Provider must be non-empty.'));
  }
  if (value.nativeId !== undefined && !isNonEmptyString(value.nativeId)) {
    issues.push(issue('developer-event-native-id-invalid', `${path}.nativeId`, 'Native id must be non-empty.'));
  }
  if (issues.length !== before || !content) return undefined;
  const identity = {
    kind: 'task' as const,
    content,
    ...(value.provider ? { provider: String(value.provider).trim() } : {}),
    ...(value.nativeId ? { nativeId: String(value.nativeId).trim() } : {}),
  };
  return {
    id: generatedId('event', identity),
    ...identity,
    contentFingerprint: sha256(content),
  };
}

function validateRepositoryEvidence(value: unknown, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) {
    issues.push(issue('repository-evidence-invalid', 'repositoryEvidence', 'Repository evidence must be an array.'));
    return [];
  }
  const keys = new Set<string>();
  const output: Array<RepositoryEvidenceInput & { id: string }> = [];
  for (const [index, candidate] of value.entries()) {
    const path = `repositoryEvidence[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('repository-evidence-invalid', path, 'Repository evidence must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'path', 'startLine', 'endLine', 'text', 'digest'], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    if (!isSafeRepositoryPath(candidate.path)) {
      issues.push(issue('repository-evidence-path-unsafe', `${path}.path`, 'Evidence path must be repository-relative.'));
    }
    if (!Number.isInteger(candidate.startLine) || Number(candidate.startLine) < 1
      || !Number.isInteger(candidate.endLine) || Number(candidate.endLine) < Number(candidate.startLine)) {
      issues.push(issue('repository-evidence-range-invalid', path, 'Evidence line range is invalid.'));
    }
    if (typeof candidate.text !== 'string' || !isSha256(candidate.digest)
      || candidate.digest !== sha256(candidate.text)) {
      issues.push(issue('repository-evidence-digest-mismatch', `${path}.digest`, 'Evidence digest must match exact text.'));
    }
    if (issues.length !== before || !key) continue;
    output.push({
      key,
      id: generatedId('evidence', { key }),
      path: candidate.path as string,
      startLine: Number(candidate.startLine),
      endLine: Number(candidate.endLine),
      text: candidate.text as string,
      digest: candidate.digest as string,
    });
  }
  return output;
}

function validateTaskMeaning(
  value: unknown,
  eventId: string | undefined,
  issues: ValidationIssue[],
): { understanding: TaskContract['understanding']; fork?: MaterialSemanticFork } | undefined {
  const path = 'task';
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('task-meaning-invalid', path, 'Task meaning must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['desiredOutcome', 'constraints', 'nonGoals', 'focus', 'unresolvedMaterialFork'], path, issues);
  const desired = normalized(value.desiredOutcome, `${path}.desiredOutcome`, issues);
  const constraints = stringArray(value.constraints, `${path}.constraints`, issues);
  const nonGoals = stringArray(value.nonGoals, `${path}.nonGoals`, issues);
  const focus = stringArray(value.focus, `${path}.focus`, issues);
  for (const [index, focusPath] of focus.entries()) {
    if (!isSafeRepositoryPath(focusPath)) {
      issues.push(issue('focus-path-unsafe', `${path}.focus[${index}]`, 'Focus must be a repository-relative path.'));
    }
  }
  const fork = value.unresolvedMaterialFork === undefined
    ? undefined : validateFork(value.unresolvedMaterialFork, `${path}.unresolvedMaterialFork`, issues);
  if (issues.length !== before || !desired || !eventId) return undefined;
  const basis: InterpretationBasis = { humanEventIds: [eventId], repositoryEvidenceIds: [] };
  return {
    understanding: {
      desiredOutcome: interpretation('desired-outcome', 0, desired, basis),
      constraints: constraints.map((item, index) => interpretation('constraint', index, item, basis)),
      nonGoals: nonGoals.map((item, index) => interpretation('non-goal', index, item, basis)),
      focus: focus.map((item, index) => interpretation('focus-path', index, item, basis)),
    },
    ...(fork ? { fork } : {}),
  };
}

function validateCheckDrafts(value: unknown, issues: ValidationIssue[]): CheckDraft[] {
  if (!Array.isArray(value)) {
    issues.push(issue('verification-checks-invalid', 'checks', 'Checks must be an array.'));
    return [];
  }
  const keys = new Set<string>();
  const output: CheckDraft[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `checks[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('verification-check-invalid', path, 'Check must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'rationale', 'argv', 'baseline', 'commandDefinitionPaths', 'acceptanceSurfacePaths'], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const rationale = normalized(candidate.rationale, `${path}.rationale`, issues);
    if (!Array.isArray(candidate.argv) || !candidate.argv.length
      || candidate.argv.some((item) => typeof item !== 'string' || !item)) {
      issues.push(issue('verification-check-argv-invalid', `${path}.argv`, 'Check argv must contain non-empty arguments.'));
    }
    const baselineSource = validateBaseline(candidate.baseline, `${path}.baseline`, issues);
    const commandPaths = repositoryPaths(candidate.commandDefinitionPaths, `${path}.commandDefinitionPaths`, issues);
    const acceptancePaths = repositoryPaths(candidate.acceptanceSurfacePaths, `${path}.acceptanceSurfacePaths`, issues);
    if (issues.length !== before || !key || !rationale || !baselineSource || !commandPaths || !acceptancePaths) continue;
    output.push({
      verifierId: generatedId('verifier', { key }),
      revision: 1,
      key,
      rationale,
      argv: [...candidate.argv as string[]],
      baselineSource,
      verifierRefs: [
        ...commandPaths.map((item) => ({ path: item, role: 'command-definition' as const })),
        ...acceptancePaths.map((item) => ({ path: item, role: 'acceptance-surface' as const })),
      ],
    });
  }
  return output.sort((left, right) => left.verifierId.localeCompare(right.verifierId));
}

function validateBaseline(value: unknown, path: string, issues: ValidationIssue[]): CheckDraft['baselineSource'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('verification-baseline-invalid', path, 'Baseline must be an object.'));
    return undefined;
  }
  if (value.mode === 'unknown') {
    rejectExtraKeys(value, ['mode'], path, issues);
    return issues.length === before ? { mode: 'unknown' } : undefined;
  }
  if (value.mode !== 'task-start') {
    issues.push(issue('verification-baseline-invalid', `${path}.mode`, 'Baseline mode must be task-start or unknown.'));
    return undefined;
  }
  rejectExtraKeys(value, ['mode', 'rationale', 'obligationKeys'], path, issues);
  const rationale = normalized(value.rationale, `${path}.rationale`, issues);
  if (!Array.isArray(value.obligationKeys) || !value.obligationKeys.length) {
    issues.push(issue('verification-baseline-obligations-required', `${path}.obligationKeys`, 'Task-start baseline must name the obligations whose decision uses the comparison.'));
  }
  const references = Array.isArray(value.obligationKeys) ? value.obligationKeys.flatMap((item, index) => {
    const itemPath = `${path}.obligationKeys[${index}]`;
    if (!isRecord(item)) {
      issues.push(issue('verification-baseline-obligation-invalid', itemPath, 'Obligation reference must be an object.'));
      return [];
    }
    rejectExtraKeys(item, ['conditionKey', 'obligationKey'], itemPath, issues);
    if (!isStableId(item.conditionKey) || !isStableId(item.obligationKey)) {
      issues.push(issue('verification-baseline-obligation-invalid', itemPath, 'Obligation reference requires stable condition and obligation keys.'));
      return [];
    }
    return [{ conditionKey: item.conditionKey, obligationKey: item.obligationKey }];
  }) : [];
  const identities = references.map((item) => obligationKey(item.conditionKey, item.obligationKey));
  if (new Set(identities).size !== identities.length) {
    issues.push(issue('verification-baseline-obligation-duplicate', `${path}.obligationKeys`, 'Baseline obligation references must be unique.'));
  }
  return issues.length === before && rationale
    ? { mode: 'task-start', rationale, obligationKeys: references }
    : undefined;
}

function validateConditions(
  value: unknown,
  eventId: string | undefined,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  checksByKey: Map<string, CheckDraft>,
  issues: ValidationIssue[],
): AdoptionCondition[] {
  if (!Array.isArray(value)) {
    issues.push(issue('adoption-conditions-invalid', 'conditions', 'Conditions must be an array.'));
    return [];
  }
  const keys = new Set<string>();
  const output: AdoptionCondition[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `conditions[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('adoption-condition-invalid', path, 'Condition must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'statement', 'rationale', 'criticality', 'basis', 'evidenceObligations'], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const statement = normalized(candidate.statement, `${path}.statement`, issues);
    const rationale = normalized(candidate.rationale, `${path}.rationale`, issues);
    const criticality = ['material', 'adoption-critical'].includes(String(candidate.criticality))
      ? candidate.criticality as AdoptionConditionInput['criticality'] : undefined;
    if (!criticality) issues.push(issue('adoption-condition-criticality-invalid', `${path}.criticality`, 'Criticality must be material or adoption-critical.'));
    const basis = validateBasis(candidate.basis, eventId, evidenceByKey, `${path}.basis`, issues);
    const conditionId = key ? generatedId('condition', { key }) : undefined;
    const obligations = conditionId && key
      ? validateObligations(candidate.evidenceObligations, key, conditionId, evidenceByKey, checksByKey, `${path}.evidenceObligations`, issues)
      : [];
    if (criticality === 'adoption-critical' && obligations.length
      && !obligations.some((obligation) => obligation.strategies.some((strategy) =>
        strategy.kind === 'independent-challenge' || strategy.kind === 'human-review'))) {
      issues.push(issue('critical-condition-review-required', `${path}.evidenceObligations`, 'Adoption-critical conditions require an independent challenge or direct Human review strategy.'));
    }
    if (issues.length !== before || !key || !conditionId || !statement || !rationale || !criticality || !basis || !obligations.length) continue;
    output.push({
      id: conditionId,
      key,
      statement,
      adoptionRationale: rationale,
      criticality,
      basis,
      evidenceObligations: obligations,
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

function validateObligations(
  value: unknown,
  conditionKey: string,
  conditionId: string,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  checksByKey: Map<string, CheckDraft>,
  path: string,
  issues: ValidationIssue[],
): EvidenceObligation[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(issue('evidence-obligations-required', path, 'Every condition requires at least one falsifiable evidence obligation.'));
    return [];
  }
  const keys = new Set<string>();
  const output: EvidenceObligation[] = [];
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('evidence-obligation-invalid', itemPath, 'Evidence obligation must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'statement', 'failureHypothesis', 'strategies'], itemPath, issues);
    const key = uniqueKey(candidate.key, keys, `${itemPath}.key`, issues);
    const statement = normalized(candidate.statement, `${itemPath}.statement`, issues);
    const failureHypothesis = normalized(candidate.failureHypothesis, `${itemPath}.failureHypothesis`, issues);
    const strategies = validateObligationStrategies(candidate.strategies, evidenceByKey, checksByKey, `${itemPath}.strategies`, issues);
    const hasFactTriggered = strategies.some((strategy) =>
      strategy.kind === 'independent-challenge' && strategy.policy === 'fact-triggered');
    if (hasFactTriggered && !strategies.some((strategy) => strategy.kind === 'runtime-check')) {
      issues.push(issue('fact-triggered-challenge-check-required', `${itemPath}.strategies`, 'A fact-triggered challenge requires a runtime-check strategy whose acceptance surface can change.'));
    }
    if (issues.length !== before || !key || !statement || !failureHypothesis || !strategies.length) continue;
    output.push({
      id: generatedId('obligation', { conditionKey, key }),
      key,
      conditionId,
      statement,
      failureHypothesis,
      strategies,
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

function validateObligationStrategies(
  value: unknown,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  checksByKey: Map<string, CheckDraft>,
  path: string,
  issues: ValidationIssue[],
): EvidenceObligationStrategy[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(issue('evidence-strategies-required', path, 'Evidence obligation requires at least one strategy.'));
    return [];
  }
  const output: EvidenceObligationStrategy[] = [];
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('evidence-strategy-invalid', itemPath, 'Evidence strategy must be an object.'));
      continue;
    }
    if (candidate.kind === 'runtime-check') {
      rejectExtraKeys(candidate, ['kind', 'checkKeys', 'expectedObservation'], itemPath, issues);
      const keys = stableIdArray(candidate.checkKeys, `${itemPath}.checkKeys`, issues);
      if (!keys.length) issues.push(issue('runtime-check-strategy-empty', `${itemPath}.checkKeys`, 'Runtime-check strategy must select at least one check.'));
      const verifierIds = keys.flatMap((key) => {
        const check = checksByKey.get(key);
        if (!check) {
          issues.push(issue('condition-check-missing', `${itemPath}.checkKeys`, `Check key ${JSON.stringify(key)} does not exist.`));
          return [];
        }
        return [check.verifierId];
      });
      if (candidate.expectedObservation !== 'passed') {
        issues.push(issue('runtime-check-observation-invalid', `${itemPath}.expectedObservation`, 'Runtime-check expected observation must be passed.'));
      }
      if (issues.length === before) output.push({
        kind: 'runtime-check', verifierIds: sortedUnique(verifierIds), expectedObservation: 'passed',
      });
      continue;
    }
    if (candidate.kind === 'repository-inspection') {
      rejectExtraKeys(candidate, ['kind', 'repositoryEvidenceKeys'], itemPath, issues);
      const keys = stableIdArray(candidate.repositoryEvidenceKeys, `${itemPath}.repositoryEvidenceKeys`, issues);
      if (!keys.length) issues.push(issue('repository-inspection-strategy-empty', `${itemPath}.repositoryEvidenceKeys`, 'Repository-inspection strategy must select evidence.'));
      const repositoryEvidenceIds = keys.flatMap((key) => {
        const evidence = evidenceByKey.get(key);
        if (!evidence) {
          issues.push(issue('strategy-evidence-missing', `${itemPath}.repositoryEvidenceKeys`, `Repository evidence key ${JSON.stringify(key)} does not exist.`));
          return [];
        }
        return [evidence.id];
      });
      if (issues.length === before) output.push({ kind: 'repository-inspection', repositoryEvidenceIds: sortedUnique(repositoryEvidenceIds) });
      continue;
    }
    if (candidate.kind === 'independent-challenge') {
      rejectExtraKeys(candidate, ['kind', 'policy'], itemPath, issues);
      if (!['required', 'fact-triggered'].includes(String(candidate.policy))) {
        issues.push(issue('challenge-policy-invalid', `${itemPath}.policy`, 'Challenge policy must be required or fact-triggered.'));
      } else if (issues.length === before) {
        output.push({ kind: 'independent-challenge', policy: candidate.policy as 'required' | 'fact-triggered' });
      }
      continue;
    }
    if (candidate.kind === 'human-review') {
      rejectExtraKeys(candidate, ['kind'], itemPath, issues);
      if (issues.length === before) output.push({ kind: 'human-review' });
      continue;
    }
    issues.push(issue('evidence-strategy-kind-invalid', `${itemPath}.kind`, 'Evidence strategy kind is invalid.'));
  }
  const identities = output.map((item) => stableFingerprint(item));
  if (new Set(identities).size !== identities.length) {
    issues.push(issue('evidence-strategy-duplicate', path, 'Evidence strategies must not be duplicated.'));
  }
  return output;
}

function materializeDefinitions(
  drafts: CheckDraft[],
  obligationsByKey: Map<string, EvidenceObligation>,
  issues: ValidationIssue[],
): VerificationDefinition[] {
  return drafts.flatMap((draft, index) => {
    const before = issues.length;
    const baseline = draft.baselineSource.mode === 'unknown'
      ? { mode: 'unknown' as const }
      : {
          mode: 'task-start' as const,
          rationale: draft.baselineSource.rationale,
          obligationIds: draft.baselineSource.obligationKeys.flatMap((reference) => {
            const obligation = obligationsByKey.get(obligationKey(reference.conditionKey, reference.obligationKey));
            if (!obligation) {
              issues.push(issue('verification-baseline-obligation-missing', `checks[${index}].baseline.obligationKeys`, `Obligation ${reference.conditionKey}/${reference.obligationKey} does not exist.`));
              return [];
            }
            const consumesVerifier = obligation.strategies.some((strategy) =>
              strategy.kind === 'runtime-check' && strategy.verifierIds.includes(draft.verifierId));
            if (!consumesVerifier) {
              issues.push(issue('verification-baseline-obligation-unbound', `checks[${index}].baseline.obligationKeys`, `Obligation ${reference.conditionKey}/${reference.obligationKey} does not consume check ${draft.key}.`));
              return [];
            }
            return [obligation.id];
          }).sort(),
        };
    if (issues.length !== before) return [];
    const { baselineSource: _ignored, ...projection } = draft;
    const definitionProjection = { ...projection, baseline };
    return [{ ...definitionProjection, definitionId: stableFingerprint(definitionProjection) }];
  }).sort((left, right) => left.definitionId.localeCompare(right.definitionId));
}

function verificationDefinitionContent(definition: VerificationDefinition) {
  return {
    verifierId: definition.verifierId,
    key: definition.key,
    rationale: definition.rationale,
    argv: definition.argv,
    baseline: definition.baseline,
    verifierRefs: definition.verifierRefs,
  };
}

function validateExecutionRebinding(
  prior: VerificationDefinition[],
  current: VerificationDefinition[],
  issues: ValidationIssue[],
): void {
  const priorByVerifier = new Map(prior.map((definition) =>
    [definition.verifierId, definition]));
  const currentByVerifier = new Map(current.map((definition) =>
    [definition.verifierId, definition]));
  if (priorByVerifier.size !== currentByVerifier.size
    || [...priorByVerifier.keys()].some((id) => !currentByVerifier.has(id))) {
    issues.push(issue(
      'execution-rebinding-verifier-set-changed',
      'revision.checks',
      'Execution rebinding must retain the exact logical verifier set.',
    ));
    return;
  }
  let argvChanged = false;
  for (const [verifierId, before] of priorByVerifier) {
    const after = currentByVerifier.get(verifierId)!;
    if (stableFingerprint(before.argv) !== stableFingerprint(after.argv)) argvChanged = true;
    if (before.rationale !== after.rationale
      || stableFingerprint(before.baseline) !== stableFingerprint(after.baseline)
      || stableFingerprint(before.verifierRefs) !== stableFingerprint(after.verifierRefs)) {
      issues.push(issue(
        'execution-rebinding-semantic-surface-changed',
        'revision.checks',
        `Execution rebinding for ${verifierId} may change argv only; use verification-plan for other changes.`,
      ));
    }
  }
  if (!argvChanged) {
    issues.push(issue(
      'execution-rebinding-argv-unchanged',
      'revision.checks',
      'Execution rebinding must change at least one argv definition.',
    ));
  }
}

function verificationRelaxed(
  prior: VerificationDefinition[],
  current: VerificationDefinition[],
): boolean {
  const currentByVerifier = new Map(current.map((definition) =>
    [definition.verifierId, definition]));
  return prior.some((before) => {
    const after = currentByVerifier.get(before.verifierId);
    if (!after) return true;
    if (before.baseline.mode === 'task-start' && after.baseline.mode !== 'task-start') {
      return true;
    }
    return before.verifierRefs.some((reference) =>
      !after.verifierRefs.some((candidate) =>
        candidate.path === reference.path && candidate.role === reference.role));
  });
}

function validateRevisionHumanAuthorization(
  value: unknown,
  issues: ValidationIssue[],
): void {
  const path = 'revision.humanAuthorization';
  if (!isRecord(value)) {
    issues.push(issue('verification-revision-human-authorization-invalid', path, 'Human authorization must be an exact event object.'));
    return;
  }
  rejectExtraKeys(value, ['content', 'provider', 'nativeId'], path, issues);
  normalized(value.content, `${path}.content`, issues);
  if (value.provider !== undefined && !isNonEmptyString(value.provider)) {
    issues.push(issue('verification-revision-human-provider-invalid', `${path}.provider`, 'Provider must be non-empty.'));
  }
  if (value.nativeId !== undefined && !isNonEmptyString(value.nativeId)) {
    issues.push(issue('verification-revision-human-native-id-invalid', `${path}.nativeId`, 'Native id must be non-empty.'));
  }
}

function validateHostPolicyRequirements(
  value: unknown,
  eventId: string | undefined,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  issues: ValidationIssue[],
): HostPolicyRequirement[] {
  if (!Array.isArray(value)) {
    issues.push(issue('host-policy-requirements-invalid', 'hostPolicyRequirements', 'Host policy requirements must be an array.'));
    return [];
  }
  const keys = new Set<string>();
  const output: HostPolicyRequirement[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `hostPolicyRequirements[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('host-policy-requirement-invalid', path, 'Host policy requirement must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'capability', 'requiredState', 'enforcementRequirement', 'rationale', 'basis'], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const capability = ['web-search', 'network', 'external-mutation', 'fresh-context'].includes(String(candidate.capability))
      ? candidate.capability as HostPolicyRequirementInput['capability'] : undefined;
    if (!capability) issues.push(issue('host-policy-capability-invalid', `${path}.capability`, 'Host policy capability is invalid.'));
    const requiredState = ['disabled', 'enabled', 'isolated'].includes(String(candidate.requiredState))
      ? candidate.requiredState as HostPolicyRequirementInput['requiredState'] : undefined;
    if (!requiredState) issues.push(issue('host-policy-state-invalid', `${path}.requiredState`, 'Host policy state is invalid.'));
    const enforcementRequirement = ['required', 'preferred'].includes(String(candidate.enforcementRequirement))
      ? candidate.enforcementRequirement as HostPolicyRequirementInput['enforcementRequirement'] : undefined;
    if (!enforcementRequirement) issues.push(issue('host-policy-enforcement-invalid', `${path}.enforcementRequirement`, 'Host policy enforcement requirement is invalid.'));
    const rationale = normalized(candidate.rationale, `${path}.rationale`, issues);
    const basis = validateBasis(candidate.basis, eventId, evidenceByKey, `${path}.basis`, issues);
    if (issues.length !== before || !key || !capability || !requiredState || !enforcementRequirement || !rationale || !basis) continue;
    output.push({
      id: generatedId('host-policy', { key }), key, capability, requiredState,
      enforcementRequirement, rationale, basis,
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

function validateBasis(
  value: unknown,
  eventId: string | undefined,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  path: string,
  issues: ValidationIssue[],
): InterpretationBasis | undefined {
  if (value === undefined) {
    return eventId ? { humanEventIds: [eventId], repositoryEvidenceIds: [] } : undefined;
  }
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('interpretation-basis-invalid', path, 'Interpretation basis must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['developerEvent', 'repositoryEvidenceKeys'], path, issues);
  if (typeof value.developerEvent !== 'boolean') {
    issues.push(issue('interpretation-basis-event-invalid', `${path}.developerEvent`, 'Developer-event selection must be boolean.'));
  }
  const keys = stableIdArray(value.repositoryEvidenceKeys, `${path}.repositoryEvidenceKeys`, issues);
  const evidenceIds = keys.flatMap((key) => {
    const evidence = evidenceByKey.get(key);
    if (!evidence) {
      issues.push(issue('interpretation-basis-evidence-missing', `${path}.repositoryEvidenceKeys`, `Repository evidence key ${JSON.stringify(key)} does not exist.`));
      return [];
    }
    return [evidence.id];
  });
  const humanEventIds = value.developerEvent === true && eventId ? [eventId] : [];
  if (!humanEventIds.length && !evidenceIds.length) {
    issues.push(issue('interpretation-basis-empty', path, 'Interpretation basis must select the developer event or repository evidence.'));
  }
  return issues.length === before ? { humanEventIds, repositoryEvidenceIds: sortedUnique(evidenceIds) } : undefined;
}

function validateDelivery(value: unknown, issues: ValidationIssue[]): DeliveryPlan | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('delivery-invalid', 'delivery', 'Delivery settings must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['maxRepairAttempts'], 'delivery', issues);
  if (!Number.isInteger(value.maxRepairAttempts) || Number(value.maxRepairAttempts) < 0
    || Number(value.maxRepairAttempts) > 5) {
    issues.push(issue('repair-budget-invalid', 'delivery.maxRepairAttempts', 'Maximum repair attempts must be an integer from 0 through 5.'));
  }
  if (issues.length !== before) return undefined;
  const projection = {
    maxRepairAttempts: Number(value.maxRepairAttempts),
    lifecycle: ['implement', 'collect', 'judge-evidence', 'resolve', 'handoff', 'decide'] as const,
  };
  return { planId: stableFingerprint(projection), ...projection };
}

function buildVerificationPlan(
  definitions: VerificationDefinition[],
  noCommandRationale: unknown,
): VerificationPlan {
  const projection = definitions.length
    ? {
        mode: 'checks' as const,
        verifiers: definitions.map((definition): LogicalVerifier => ({
          verifierId: definition.verifierId,
          key: definition.key,
        })),
        definitions,
      }
    : { mode: 'no-command' as const, rationale: String(noCommandRationale).trim() };
  return { verificationPlanId: stableFingerprint(projection), ...projection };
}

function interpretation(
  field: AgentInterpretation['field'], index: number, value: string, basis: InterpretationBasis,
): AgentInterpretation {
  return {
    id: generatedId('meaning', { field, index, value, basis }),
    field, value, basis,
  };
}

function validateFork(value: unknown, path: string, issues: ValidationIssue[]): MaterialSemanticFork | undefined {
  if (!isRecord(value)) {
    issues.push(issue('semantic-fork-invalid', path, 'Material choice must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['question', 'alternatives', 'decisionImpact'], path, issues);
  if (!isNonEmptyString(value.question) || !Array.isArray(value.alternatives)
    || value.alternatives.length < 2 || value.alternatives.some((item) => !isNonEmptyString(item))
    || !isNonEmptyString(value.decisionImpact)) {
    issues.push(issue('semantic-fork-invalid', path, 'Material choice requires a question, alternatives, and decision impact.'));
    return undefined;
  }
  return {
    question: value.question.trim(),
    alternatives: value.alternatives.map((item) => String(item).trim()),
    decisionImpact: value.decisionImpact.trim(),
  };
}

function repositoryPaths(value: unknown, path: string, issues: ValidationIssue[]): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => !isSafeRepositoryPath(item))) {
    issues.push(issue('repository-paths-invalid', path, 'Paths must be repository-relative.'));
    return undefined;
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('repository-paths-duplicate', path, 'Paths must not contain duplicates.'));
  }
  return sortedUnique(value as string[]);
}

function stringArray(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    issues.push(issue('string-array-invalid', path, 'Values must be non-empty strings.'));
    return [];
  }
  return value.map((item) => String(item).trim());
}

function stableIdArray(value: unknown, path: string, issues: ValidationIssue[]): string[] {
  if (!Array.isArray(value) || value.some((item) => !isStableId(item))) {
    issues.push(issue('stable-key-array-invalid', path, 'Keys must be stable identifiers.'));
    return [];
  }
  if (new Set(value).size !== value.length) {
    issues.push(issue('stable-key-array-duplicate', path, 'Keys must not contain duplicates.'));
  }
  return value as string[];
}

function uniqueKey(value: unknown, seen: Set<string>, path: string, issues: ValidationIssue[]): string | undefined {
  if (!isStableId(value) || seen.has(value)) {
    issues.push(issue('key-invalid', path, 'Key must be unique and stable.'));
    return undefined;
  }
  seen.add(value);
  return value;
}

function generatedId(prefix: string, value: unknown): string {
  return `${prefix}:${stableFingerprint(value).slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function normalized(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  if (!isNonEmptyString(value)) {
    issues.push(issue('text-required', path, 'A non-empty value is required.'));
    return undefined;
  }
  return value.trim();
}

function rejectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  for (const key of hasExactKeys(value, allowed)) {
    issues.push(issue('unsupported-field', path ? `${path}.${key}` : key, `Unsupported field ${key}.`));
  }
}

function obligationKey(conditionKey: string, obligation: string): string {
  return `${conditionKey}\u0000${obligation}`;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
