import type { AgentInterpretation, HumanEvent, InterpretationBasis } from '../authority/types.ts';
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
  ExecutionBudget,
  EvidenceObligation,
  EvidenceObligationStrategy,
  HostPolicyRequirement,
  HostPolicyRequirementInput,
  MaterialDecisionFork,
  MaterialDecisionForkInput,
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
        expectation: {
          baselineStatus: 'passed' | 'failed' | 'unavailable';
          currentStatus: 'passed' | 'failed' | 'unavailable';
        };
      };
}

interface KeyedDeveloperEvent {
  key: string;
  index: number;
  event: HumanEvent;
}

interface MaterialDecisionValidation {
  resolved: MaterialDecisionFork[];
  unresolved: MaterialDecisionForkInput[];
}

export function compileDelegation(
  input: CompileDelegationInput | VerificationRevisionInput,
): DelegationCompileResult {
  assertProtocol(input, 'compileDelegation');
  if ('operation' in input) return compileVerificationRevision(input);
  const source = input as unknown as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  rejectExtraKeys(source, [
    'protocol', 'schemaVersion', 'developerEvents', 'task', 'materialDecisionForks', 'repositoryEvidence',
    'conditions', 'hostPolicyRequirements', 'executionBudget', 'checks', 'noCommandRationale',
  ], '', issues);

  const developerEvents = validateDeveloperEvents(source.developerEvents, issues);
  const eventsByKey = new Map(developerEvents.map((item) => [item.key, item]));
  const evidence = validateRepositoryEvidence(source.repositoryEvidence ?? [], issues);
  const evidenceByKey = new Map(evidence.map((item) => [item.key, item]));
  const task = validateTaskMeaning(source.task, eventsByKey, evidenceByKey, issues);
  const materialDecisions = validateMaterialDecisionForks(
    source.materialDecisionForks,
    eventsByKey,
    evidenceByKey,
    task?.understanding.desiredOutcome.basis,
    issues,
  );
  const checkDrafts = validateCheckDrafts(source.checks ?? [], issues);
  const checksByKey = new Map(checkDrafts.map((item) => [item.key, item]));
  const conditions = validateConditions(
    source.conditions,
    eventsByKey,
    evidenceByKey,
    checksByKey,
    task?.understanding.desiredOutcome.basis,
    issues,
  );
  const obligationsByKey = new Map(conditions.flatMap((condition) =>
    condition.evidenceObligations.map((obligation) => [
      obligationKey(condition.key, obligation.key), obligation,
    ] as const)));
  const definitions = materializeDefinitions(checkDrafts, obligationsByKey, issues);
  const hostPolicyRequirements = validateHostPolicyRequirements(
    source.hostPolicyRequirements,
    eventsByKey,
    evidenceByKey,
    task?.understanding.desiredOutcome.basis,
    issues,
  );
  const executionBudget = validateExecutionBudget(source.executionBudget, issues);
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

  if (issues.length || !developerEvents.length || !task || !materialDecisions || !executionBudget) {
    return { ...ENVELOPE, status: 'authority-invalid', issues };
  }
  if (materialDecisions.unresolved.length) {
    return {
      ...ENVELOPE,
      status: 'semantic-decision-required',
      forks: materialDecisions.unresolved,
      message: 'One or more material Human-owned choices remain unresolved; no task was created.',
    };
  }
  if (!definitions.length && !isNonEmptyString(noCommandRationale)) {
    return {
      ...ENVELOPE,
      status: 'verification-required',
      message: 'Provide explicit checks or a concrete no-command rationale; no task was created.',
    };
  }

  const semanticProjection = {
    ...ENVELOPE,
    humanEvents: developerEvents.map((item) => item.event),
    understanding: task.understanding,
    repositoryEvidence: evidence.map(({ key: _key, ...item }) => item),
    materialDecisions: materialDecisions.resolved,
    adoptionConditions: conditions,
    hostPolicyRequirements,
  };
  const semanticContractId = stableFingerprint(semanticProjection);
  const verificationPlan = buildVerificationPlan(definitions, noCommandRationale);
  const verificationPlanId = stableFingerprint(verificationPlan);
  const effectiveContractId = stableFingerprint({
    semanticContractId,
    verificationPlanId,
  });
  const contract: TaskContract = {
    ...semanticProjection,
    semanticContractId,
    verificationPlanId,
    effectiveContractId,
    verificationPlan,
  };
  return { ...ENVELOPE, status: 'delegation-compiled', contract, executionBudget };
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
  const verificationPlanId = stableFingerprint(verificationPlan);
  if (verificationPlanId === input.priorContract.verificationPlanId) {
    return {
      ...ENVELOPE,
      status: 'authority-invalid',
      issues: [issue('verification-revision-noop', 'revision', 'Verification revision must change the immutable Verification Plan.')],
    };
  }
  const effectiveContractId = stableFingerprint({
    semanticContractId: input.priorContract.semanticContractId,
    verificationPlanId,
  });
  return {
    ...ENVELOPE,
    status: 'delegation-compiled',
    contract: {
      ...input.priorContract,
      verificationPlanId,
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
    humanEvents: contract.humanEvents,
    understanding: contract.understanding,
    repositoryEvidence: contract.repositoryEvidence,
    materialDecisions: contract.materialDecisions,
    adoptionConditions: contract.adoptionConditions,
    hostPolicyRequirements: contract.hostPolicyRequirements,
  };
  if (contract.semanticContractId !== stableFingerprint(semanticProjection)) {
    throw new Error('evaluateHandoff Semantic Contract fingerprint does not match its content.');
  }
  if (contract.verificationPlanId !== stableFingerprint(contract.verificationPlan)) {
    throw new Error('evaluateHandoff Verification Plan fingerprint does not match its content.');
  }
  if (contract.effectiveContractId !== stableFingerprint({
    semanticContractId: contract.semanticContractId,
    verificationPlanId: contract.verificationPlanId,
  })) {
    throw new Error('evaluateHandoff effective contract fingerprint does not match its identities.');
  }
}

function validateDeveloperEvents(value: unknown, issues: ValidationIssue[]): KeyedDeveloperEvent[] {
  if (!Array.isArray(value) || !value.length) {
    issues.push(issue('developer-events-required', 'developerEvents', 'At least one exact developer event is required.'));
    return [];
  }
  const keys = new Set<string>();
  const output: KeyedDeveloperEvent[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `developerEvents[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('developer-event-invalid', path, 'Developer event must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, ['key', 'content', 'provider', 'nativeId'], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const content = normalized(candidate.content, `${path}.content`, issues);
    if (candidate.provider !== undefined && !isNonEmptyString(candidate.provider)) {
      issues.push(issue('developer-event-provider-invalid', `${path}.provider`, 'Provider must be non-empty.'));
    }
    if (candidate.nativeId !== undefined && !isNonEmptyString(candidate.nativeId)) {
      issues.push(issue('developer-event-native-id-invalid', `${path}.nativeId`, 'Native id must be non-empty.'));
    }
    if (issues.length !== before || !key || !content) continue;
    const identity = {
      kind: 'task' as const,
      content,
      ...(candidate.provider ? { provider: String(candidate.provider).trim() } : {}),
      ...(candidate.nativeId ? { nativeId: String(candidate.nativeId).trim() } : {}),
    };
    output.push({
      key,
      index,
      event: {
        id: generatedId('event', { key, ...identity }),
        ...identity,
        contentFingerprint: sha256(content),
      },
    });
  }
  return output;
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
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  issues: ValidationIssue[],
): { understanding: TaskContract['understanding'] } | undefined {
  const path = 'task';
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('task-meaning-invalid', path, 'Task meaning must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['basis', 'desiredOutcome', 'constraints', 'nonGoals', 'focus'], path, issues);
  const basis = validateBasis(value.basis, eventsByKey, evidenceByKey, `${path}.basis`, issues);
  const desired = normalized(value.desiredOutcome, `${path}.desiredOutcome`, issues);
  const constraints = stringArray(value.constraints, `${path}.constraints`, issues);
  const nonGoals = stringArray(value.nonGoals, `${path}.nonGoals`, issues);
  const focus = stringArray(value.focus, `${path}.focus`, issues);
  for (const [index, focusPath] of focus.entries()) {
    if (!isSafeRepositoryPath(focusPath)) {
      issues.push(issue('focus-path-unsafe', `${path}.focus[${index}]`, 'Focus must be a repository-relative path.'));
    }
  }
  if (issues.length !== before || !desired || !basis) return undefined;
  return {
    understanding: {
      desiredOutcome: interpretation('desired-outcome', 0, desired, basis),
      constraints: constraints.map((item, index) => interpretation('constraint', index, item, basis)),
      nonGoals: nonGoals.map((item, index) => interpretation('non-goal', index, item, basis)),
      focus: focus.map((item, index) => interpretation('focus-path', index, item, basis)),
    },
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
    rejectExtraKeys(candidate, [
      'key', 'rationale', 'execution', 'executionInputs', 'baseline', 'verifierSelectors',
    ], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const rationale = normalized(candidate.rationale, `${path}.rationale`, issues);
    const execution = validateCheckExecution(candidate.execution, `${path}.execution`, issues);
    const executionInputs = repositoryPathSelectors(
      candidate.executionInputs,
      `${path}.executionInputs`,
      issues,
    );
    const baselineSource = validateBaseline(candidate.baseline, `${path}.baseline`, issues);
    const verifierRefs = repositorySelectors(candidate.verifierSelectors, `${path}.verifierSelectors`, issues);
    if (issues.length !== before || !key || !rationale || !execution
      || !executionInputs || !baselineSource || !verifierRefs) continue;
    output.push({
      verifierId: generatedId('verifier', { key }),
      revision: 1,
      key,
      rationale,
      execution,
      executionInputs: executionInputs.map(({ kind, path }) => ({ kind, path })),
      baselineSource,
      verifierRefs,
    });
  }
  return output.sort((left, right) => left.verifierId.localeCompare(right.verifierId));
}

function repositoryPathSelectors(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): VerificationDefinition['executionInputs'] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue(
      'execution-inputs-invalid', path,
      'Execution inputs must be an array; use an empty array when no generated or ignored input is relevant.',
    ));
    return undefined;
  }
  const output: VerificationDefinition['executionInputs'] = value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issues.push(issue('execution-input-invalid', itemPath, 'Execution input must be an object.'));
      return [];
    }
    rejectExtraKeys(item, ['kind', 'path'], itemPath, issues);
    const kind: VerificationDefinition['executionInputs'][number]['kind'] | undefined =
      item.kind === 'file' || item.kind === 'tree' ? item.kind : undefined;
    if (!kind) {
      issues.push(issue('execution-input-kind-invalid', `${itemPath}.kind`, 'Execution input kind must be file or tree.'));
    }
    if (!isSafeRepositoryPath(item.path)) {
      issues.push(issue('execution-input-path-invalid', `${itemPath}.path`, 'Execution input path must be repository-relative.'));
    }
    return kind && isSafeRepositoryPath(item.path)
      ? [{ kind, path: item.path as string }]
      : [];
  });
  const identities = output.map((item) => stableFingerprint(item));
  if (new Set(identities).size !== identities.length) {
    issues.push(issue('execution-inputs-duplicate', path, 'Execution inputs must not contain duplicates.'));
  }
  return output.sort((left, right) => left.kind.localeCompare(right.kind)
    || left.path.localeCompare(right.path));
}

function validateCheckExecution(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CheckDraft['execution'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('verification-execution-invalid', path, 'Check execution must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['preparation', 'assertion'], path, issues);
  const preparation: CheckDraft['execution']['preparation'] = [];
  const preparationKeys = new Set<string>();
  if (!Array.isArray(value.preparation)) {
    issues.push(issue(
      'verification-preparation-invalid', `${path}.preparation`,
      'Check preparation must be an array; use an empty array when none is required.',
    ));
  } else {
    for (const [index, raw] of value.preparation.entries()) {
      const stepPath = `${path}.preparation[${index}]`;
      const stepBefore = issues.length;
      if (!isRecord(raw)) {
        issues.push(issue('verification-preparation-step-invalid', stepPath, 'Preparation step must be an object.'));
        continue;
      }
      rejectExtraKeys(raw, ['key', 'argv'], stepPath, issues);
      const stepKey = uniqueKey(raw.key, preparationKeys, `${stepPath}.key`, issues);
      const argv = commandArgv(raw.argv, `${stepPath}.argv`, issues);
      if (issues.length === stepBefore && stepKey && argv) {
        const projection = { role: 'preparation' as const, key: stepKey, argv };
        preparation.push({
          stepId: stableFingerprint(projection),
          key: stepKey,
          argv,
        });
      }
    }
  }
  let assertion: CheckDraft['execution']['assertion'] | undefined;
  if (!isRecord(value.assertion)) {
    issues.push(issue('verification-assertion-invalid', `${path}.assertion`, 'Check assertion must be an object.'));
  } else {
    rejectExtraKeys(value.assertion, ['argv'], `${path}.assertion`, issues);
    const argv = commandArgv(value.assertion.argv, `${path}.assertion.argv`, issues);
    if (argv) {
      assertion = {
        stepId: stableFingerprint({ role: 'assertion', argv }),
        argv,
      };
    }
  }
  return issues.length === before && assertion ? { preparation, assertion } : undefined;
}

function commandArgv(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] | undefined {
  if (!Array.isArray(value) || !value.length
    || value.some((item) => typeof item !== 'string' || !item)) {
    issues.push(issue(
      'verification-command-argv-invalid', path,
      'Verification command argv must contain non-empty arguments.',
    ));
    return undefined;
  }
  return [...value] as string[];
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
  rejectExtraKeys(value, ['mode', 'rationale', 'obligationKeys', 'expectation'], path, issues);
  const rationale = normalized(value.rationale, `${path}.rationale`, issues);
  const allowedStatuses = ['passed', 'failed', 'unavailable'];
  let expectation: {
    baselineStatus: 'passed' | 'failed' | 'unavailable';
    currentStatus: 'passed' | 'failed' | 'unavailable';
  } | undefined;
  if (!isRecord(value.expectation)) {
    issues.push(issue(
      'verification-baseline-expectation-required', `${path}.expectation`,
      'Task-start baseline must state the expected baseline and current check statuses.',
    ));
  } else {
    rejectExtraKeys(value.expectation, ['baselineStatus', 'currentStatus'], `${path}.expectation`, issues);
    if (!allowedStatuses.includes(String(value.expectation.baselineStatus))
      || !allowedStatuses.includes(String(value.expectation.currentStatus))) {
      issues.push(issue(
        'verification-baseline-expectation-invalid', `${path}.expectation`,
        'Expected baseline and current statuses must be passed, failed, or unavailable.',
      ));
    } else {
      expectation = {
        baselineStatus: value.expectation.baselineStatus as 'passed' | 'failed' | 'unavailable',
        currentStatus: value.expectation.currentStatus as 'passed' | 'failed' | 'unavailable',
      };
    }
  }
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
  return issues.length === before && rationale && expectation
    ? { mode: 'task-start', rationale, obligationKeys: references, expectation }
    : undefined;
}

function validateConditions(
  value: unknown,
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  checksByKey: Map<string, CheckDraft>,
  defaultBasis: InterpretationBasis | undefined,
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
    const basis = validateBasis(
      candidate.basis,
      eventsByKey,
      evidenceByKey,
      `${path}.basis`,
      issues,
      defaultBasis,
    );
    const conditionId = key ? generatedId('condition', { key }) : undefined;
    const obligations = conditionId && key
      ? validateObligations(candidate.evidenceObligations, key, conditionId, evidenceByKey, checksByKey, `${path}.evidenceObligations`, issues)
      : [];
    if (criticality === 'adoption-critical' && obligations.length
      && !obligations.some((obligation) => obligation.strategies.some((strategy) =>
        strategy.kind === 'independent-challenge' && strategy.policy === 'required'))) {
      issues.push(issue('critical-condition-challenge-required', `${path}.evidenceObligations`, 'Adoption-critical conditions require a required independent challenge.'));
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
    rejectExtraKeys(candidate, ['key', 'statement', 'falsification', 'strategies'], itemPath, issues);
    const key = uniqueKey(candidate.key, keys, `${itemPath}.key`, issues);
    const statement = normalized(candidate.statement, `${itemPath}.statement`, issues);
    const falsification = validateFalsificationDesign(
      candidate.falsification,
      `${itemPath}.falsification`,
      issues,
    );
    const strategies = validateObligationStrategies(candidate.strategies, evidenceByKey, checksByKey, `${itemPath}.strategies`, issues);
    const hasFactTriggered = strategies.some((strategy) =>
      strategy.kind === 'independent-challenge' && strategy.policy === 'fact-triggered');
    if (hasFactTriggered && !strategies.some((strategy) => strategy.kind === 'runtime-check')) {
      issues.push(issue('fact-triggered-challenge-check-required', `${itemPath}.strategies`, 'A fact-triggered challenge requires a runtime-check strategy whose acceptance surface can change.'));
    }
    if (issues.length !== before || !key || !statement || !falsification || !strategies.length) continue;
    output.push({
      id: generatedId('obligation', { conditionKey, key }),
      key,
      conditionId,
      statement,
      falsification,
      strategies,
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

function validateFalsificationDesign(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): EvidenceObligation['falsification'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('falsification-design-invalid', path, 'Falsification design must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, [
    'failureHypothesis', 'scenario', 'supportingObservation', 'contradictingObservation',
  ], path, issues);
  const failureHypothesis = normalized(value.failureHypothesis, `${path}.failureHypothesis`, issues);
  const scenario = normalized(value.scenario, `${path}.scenario`, issues);
  const supportingObservation = normalized(
    value.supportingObservation, `${path}.supportingObservation`, issues,
  );
  const contradictingObservation = normalized(
    value.contradictingObservation, `${path}.contradictingObservation`, issues,
  );
  return issues.length === before
    && failureHypothesis && scenario && supportingObservation && contradictingObservation
    ? { failureHypothesis, scenario, supportingObservation, contradictingObservation }
    : undefined;
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
      rejectExtraKeys(candidate, ['kind', 'checkKeys'], itemPath, issues);
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
      if (issues.length === before) output.push({
        kind: 'runtime-check', verifierIds: sortedUnique(verifierIds),
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
          expectation: draft.baselineSource.expectation,
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
    execution: definition.execution,
    executionInputs: definition.executionInputs,
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
  let executionChanged = false;
  for (const [verifierId, before] of priorByVerifier) {
    const after = currentByVerifier.get(verifierId)!;
    if (stableFingerprint(before.execution) !== stableFingerprint(after.execution)) executionChanged = true;
    if (before.rationale !== after.rationale
      || stableFingerprint(before.baseline) !== stableFingerprint(after.baseline)
      || stableFingerprint(before.executionInputs) !== stableFingerprint(after.executionInputs)
      || stableFingerprint(before.verifierRefs) !== stableFingerprint(after.verifierRefs)) {
      issues.push(issue(
        'execution-rebinding-semantic-surface-changed',
        'revision.checks',
        `Execution rebinding for ${verifierId} may change execution commands only; use verification-plan for other changes.`,
      ));
    }
  }
  if (!executionChanged) {
    issues.push(issue(
      'execution-rebinding-execution-unchanged',
      'revision.checks',
      'Execution rebinding must change at least one execution command.',
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
        candidate.kind === reference.kind
        && candidate.path === reference.path
        && candidate.role === reference.role));
  });
}

function validateRevisionHumanAuthorization(
  value: unknown,
  issues: ValidationIssue[],
): void {
  const path = 'revision.humanAuthorization';
  if (!isRecord(value)) {
    issues.push(issue('verification-revision-human-authorization-invalid', path, 'Human authorization must bind an exact event to an explicit interpretation.'));
    return;
  }
  rejectExtraKeys(value, ['humanEvent', 'interpretation'], path, issues);
  normalized(value.interpretation, `${path}.interpretation`, issues);
  if (!isRecord(value.humanEvent)) {
    issues.push(issue('verification-revision-human-event-invalid', `${path}.humanEvent`, 'Human event must be an exact event object.'));
    return;
  }
  rejectExtraKeys(value.humanEvent, ['content', 'provider', 'nativeId'], `${path}.humanEvent`, issues);
  normalized(value.humanEvent.content, `${path}.humanEvent.content`, issues);
  if (value.humanEvent.provider !== undefined && !isNonEmptyString(value.humanEvent.provider)) {
    issues.push(issue('verification-revision-human-provider-invalid', `${path}.humanEvent.provider`, 'Provider must be non-empty.'));
  }
  if (value.humanEvent.nativeId !== undefined && !isNonEmptyString(value.humanEvent.nativeId)) {
    issues.push(issue('verification-revision-human-native-id-invalid', `${path}.humanEvent.nativeId`, 'Native id must be non-empty.'));
  }
}

function validateHostPolicyRequirements(
  value: unknown,
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  defaultBasis: InterpretationBasis | undefined,
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
    const basis = validateBasis(
      candidate.basis,
      eventsByKey,
      evidenceByKey,
      `${path}.basis`,
      issues,
      defaultBasis,
    );
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
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  path: string,
  issues: ValidationIssue[],
  defaultBasis?: InterpretationBasis,
): InterpretationBasis | undefined {
  if (value === undefined) {
    return defaultBasis;
  }
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('interpretation-basis-invalid', path, 'Interpretation basis must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['developerEventKeys', 'repositoryEvidenceKeys'], path, issues);
  const eventKeys = stableIdArray(value.developerEventKeys, `${path}.developerEventKeys`, issues);
  const evidenceKeys = stableIdArray(value.repositoryEvidenceKeys, `${path}.repositoryEvidenceKeys`, issues);
  const humanEventIds = eventKeys.flatMap((key) => {
    const event = eventsByKey.get(key);
    if (!event) {
      issues.push(issue('interpretation-basis-event-missing', `${path}.developerEventKeys`, `Developer event key ${JSON.stringify(key)} does not exist.`));
      return [];
    }
    return [event.event.id];
  });
  const evidenceIds = evidenceKeys.flatMap((key) => {
    const evidence = evidenceByKey.get(key);
    if (!evidence) {
      issues.push(issue('interpretation-basis-evidence-missing', `${path}.repositoryEvidenceKeys`, `Repository evidence key ${JSON.stringify(key)} does not exist.`));
      return [];
    }
    return [evidence.id];
  });
  if (!humanEventIds.length && !evidenceIds.length) {
    issues.push(issue('interpretation-basis-empty', path, 'Interpretation basis must select a developer event or repository evidence.'));
  }
  return issues.length === before ? {
    humanEventIds: sortedUnique(humanEventIds),
    repositoryEvidenceIds: sortedUnique(evidenceIds),
  } : undefined;
}

function validateExecutionBudget(value: unknown, issues: ValidationIssue[]): ExecutionBudget | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('execution-budget-invalid', 'executionBudget', 'Execution budget must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['checkTimeoutMs', 'maxDeliveryRepairs'], 'executionBudget', issues);
  if (!Number.isInteger(value.checkTimeoutMs) || Number(value.checkTimeoutMs) < 1_000
    || Number(value.checkTimeoutMs) > 3_600_000) {
    issues.push(issue('check-timeout-budget-invalid', 'executionBudget.checkTimeoutMs', 'Check timeout must be an integer from 1000 through 3600000 milliseconds.'));
  }
  if (!Number.isInteger(value.maxDeliveryRepairs) || Number(value.maxDeliveryRepairs) < 0
    || Number(value.maxDeliveryRepairs) > 5) {
    issues.push(issue('repair-budget-invalid', 'executionBudget.maxDeliveryRepairs', 'Maximum delivery repairs must be an integer from 0 through 5.'));
  }
  if (issues.length !== before) return undefined;
  return {
    checkTimeoutMs: Number(value.checkTimeoutMs),
    maxDeliveryRepairs: Number(value.maxDeliveryRepairs),
  };
}

function buildVerificationPlan(
  definitions: VerificationDefinition[],
  noCommandRationale: unknown,
): VerificationPlan {
  return definitions.length
    ? {
        mode: 'checks' as const,
        definitions,
      }
    : { mode: 'no-command' as const, rationale: String(noCommandRationale).trim() };
}

function interpretation(
  field: AgentInterpretation['field'], index: number, value: string, basis: InterpretationBasis,
): AgentInterpretation {
  return {
    id: generatedId('meaning', { field, index, value, basis }),
    field, value, basis,
  };
}

function validateMaterialDecisionForks(
  value: unknown,
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  evidenceByKey: Map<string, RepositoryEvidenceInput & { id: string }>,
  taskBasis: InterpretationBasis | undefined,
  issues: ValidationIssue[],
): MaterialDecisionValidation | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('material-decision-forks-invalid', 'materialDecisionForks', 'Material decision forks must be an array.'));
    return undefined;
  }
  const keys = new Set<string>();
  const resolved: MaterialDecisionFork[] = [];
  const unresolved: MaterialDecisionForkInput[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `materialDecisionForks[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('material-decision-fork-invalid', path, 'Material decision fork must be an object.'));
      continue;
    }
    rejectExtraKeys(candidate, [
      'key', 'basis', 'question', 'alternatives', 'recommendation', 'resolution',
    ], path, issues);
    const key = uniqueKey(candidate.key, keys, `${path}.key`, issues);
    const basis = validateBasis(candidate.basis, eventsByKey, evidenceByKey, `${path}.basis`, issues);
    const question = normalized(candidate.question, `${path}.question`, issues);
    const alternatives = validateMaterialDecisionAlternatives(
      candidate.alternatives,
      `${path}.alternatives`,
      issues,
    );
    const alternativeKeys = new Set(alternatives.map((item) => item.key));
    const recommendation = validateMaterialDecisionRecommendation(
      candidate.recommendation,
      alternativeKeys,
      `${path}.recommendation`,
      issues,
    );
    const normalizedBasis: MaterialDecisionForkInput['basis'] | undefined = isRecord(candidate.basis)
      ? {
          developerEventKeys: stableIdArray(
            candidate.basis.developerEventKeys,
            `${path}.basis.developerEventKeys`,
            [],
          ),
          repositoryEvidenceKeys: stableIdArray(
            candidate.basis.repositoryEvidenceKeys,
            `${path}.basis.repositoryEvidenceKeys`,
            [],
          ),
        }
      : undefined;
    if (issues.length !== before || !key || !basis || !question || alternatives.length < 2
      || !normalizedBasis) continue;
    const common = {
      key,
      basis: normalizedBasis,
      question,
      alternatives,
      ...(recommendation ? { recommendation } : {}),
    };
    if (candidate.resolution === undefined) {
      unresolved.push(common);
      continue;
    }
    const resolution = validateMaterialDecisionResolution(
      candidate.resolution,
      common,
      eventsByKey,
      taskBasis,
      index,
      `${path}.resolution`,
      issues,
    );
    if (!resolution) continue;
    resolved.push({
      id: generatedId('material-decision', { key }),
      key,
      basis,
      question,
      alternatives,
      ...(recommendation ? { recommendation } : {}),
      resolution,
    });
  }
  return { resolved, unresolved };
}

function validateMaterialDecisionAlternatives(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): MaterialDecisionForkInput['alternatives'] {
  if (!Array.isArray(value) || value.length < 2) {
    issues.push(issue('material-decision-alternatives-invalid', path, 'Material decision fork requires at least two alternatives.'));
    return [];
  }
  const keys = new Set<string>();
  return value.flatMap((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    const before = issues.length;
    if (!isRecord(candidate)) {
      issues.push(issue('material-decision-alternative-invalid', itemPath, 'Material decision alternative must be an object.'));
      return [];
    }
    rejectExtraKeys(candidate, ['key', 'statement', 'impact'], itemPath, issues);
    const key = uniqueKey(candidate.key, keys, `${itemPath}.key`, issues);
    const statement = normalized(candidate.statement, `${itemPath}.statement`, issues);
    const impact = normalized(candidate.impact, `${itemPath}.impact`, issues);
    return issues.length === before && key && statement && impact
      ? [{ key, statement, impact }]
      : [];
  });
}

function validateMaterialDecisionRecommendation(
  value: unknown,
  alternativeKeys: Set<string>,
  path: string,
  issues: ValidationIssue[],
): MaterialDecisionForkInput['recommendation'] | undefined {
  if (value === undefined) return undefined;
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('material-decision-recommendation-invalid', path, 'Material decision recommendation must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['alternativeKey', 'rationale'], path, issues);
  const alternativeKey = isStableId(value.alternativeKey) ? String(value.alternativeKey) : undefined;
  if (!alternativeKey || !alternativeKeys.has(alternativeKey)) {
    issues.push(issue('material-decision-recommendation-alternative-invalid', `${path}.alternativeKey`, 'Recommendation must reference a declared alternative.'));
  }
  const rationale = normalized(value.rationale, `${path}.rationale`, issues);
  return issues.length === before && alternativeKey && rationale
    ? { alternativeKey, rationale }
    : undefined;
}

function validateMaterialDecisionResolution(
  value: unknown,
  fork: Pick<MaterialDecisionForkInput, 'key' | 'basis' | 'alternatives'>,
  eventsByKey: Map<string, KeyedDeveloperEvent>,
  taskBasis: InterpretationBasis | undefined,
  index: number,
  path: string,
  issues: ValidationIssue[],
): MaterialDecisionFork['resolution'] | undefined {
  const before = issues.length;
  if (!isRecord(value)) {
    issues.push(issue('material-decision-resolution-invalid', path, 'Material decision resolution must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['humanEventKey', 'selectedAlternativeKey', 'decisionInterpretation'], path, issues);
  const humanEventKey = isStableId(value.humanEventKey) ? String(value.humanEventKey) : undefined;
  const selected = humanEventKey ? eventsByKey.get(humanEventKey) : undefined;
  if (!selected) {
    issues.push(issue('material-decision-resolution-event-missing', `${path}.humanEventKey`, 'Resolution must reference an existing developer event.'));
  }
  const basisIndexes = fork.basis.developerEventKeys.flatMap((key) => {
    const item = eventsByKey.get(key);
    return item ? [item.index] : [];
  });
  if (selected && basisIndexes.some((basisIndex) => selected.index <= basisIndex)) {
    issues.push(issue('material-decision-resolution-event-order-invalid', `${path}.humanEventKey`, 'Resolution event must follow every developer event used to frame the decision.'));
  }
  const selectedAlternativeKey = value.selectedAlternativeKey === undefined
    ? undefined
    : isStableId(value.selectedAlternativeKey) ? String(value.selectedAlternativeKey) : undefined;
  if (value.selectedAlternativeKey !== undefined
    && (!selectedAlternativeKey || !fork.alternatives.some((item) => item.key === selectedAlternativeKey))) {
    issues.push(issue('material-decision-resolution-alternative-invalid', `${path}.selectedAlternativeKey`, 'Resolution alternative must reference a declared alternative.'));
  }
  const decisionInterpretation = normalized(
    value.decisionInterpretation,
    `${path}.decisionInterpretation`,
    issues,
  );
  if (selected && !taskBasis?.humanEventIds.includes(selected.event.id)) {
    issues.push(issue('material-decision-resolution-unconsumed', path, 'The final task interpretation must cite the developer event that resolves this material decision.'));
  }
  if (issues.length !== before || !selected || !decisionInterpretation) return undefined;
  const resolutionBasis: InterpretationBasis = {
    humanEventIds: [selected.event.id],
    repositoryEvidenceIds: [],
  };
  return {
    humanEventId: selected.event.id,
    ...(selectedAlternativeKey ? { selectedAlternativeKey } : {}),
    decisionInterpretation: interpretation(
      'material-decision',
      index,
      decisionInterpretation,
      resolutionBasis,
    ),
  };
}

function repositorySelectors(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CheckDraft['verifierRefs'] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue('repository-selectors-invalid', path, 'Verifier selectors must be an array.'));
    return undefined;
  }
  const output = value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issues.push(issue('repository-selector-invalid', itemPath, 'Verifier selector must be an object.'));
      return [];
    }
    rejectExtraKeys(item, ['kind', 'path', 'role'], itemPath, issues);
    if (!['file', 'tree'].includes(String(item.kind))) {
      issues.push(issue('repository-selector-kind-invalid', `${itemPath}.kind`, 'Selector kind must be file or tree.'));
    }
    if (!isSafeRepositoryPath(item.path)) {
      issues.push(issue('repository-selector-path-invalid', `${itemPath}.path`, 'Selector path must be repository-relative.'));
    }
    if (!['command-definition', 'acceptance-surface'].includes(String(item.role))) {
      issues.push(issue('repository-selector-role-invalid', `${itemPath}.role`, 'Selector role must be command-definition or acceptance-surface.'));
    }
    return ['file', 'tree'].includes(String(item.kind))
      && isSafeRepositoryPath(item.path)
      && ['command-definition', 'acceptance-surface'].includes(String(item.role))
      ? [{
          kind: item.kind as 'file' | 'tree',
          path: item.path as string,
          role: item.role as 'command-definition' | 'acceptance-surface',
        }]
      : [];
  });
  const identities = output.map((item) => stableFingerprint(item));
  if (new Set(identities).size !== identities.length) {
    issues.push(issue('repository-selectors-duplicate', path, 'Verifier selectors must not contain duplicates.'));
  }
  return output.sort((left, right) => left.role.localeCompare(right.role)
    || left.kind.localeCompare(right.kind)
    || left.path.localeCompare(right.path));
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
