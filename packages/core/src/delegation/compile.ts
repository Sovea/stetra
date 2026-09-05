import type { AgentInterpretation, HumanEvent } from '../authority/types.ts';
import {
  assertProtocol,
  hasExactKeys,
  isNonEmptyString,
  isRecord,
  isSafeRepositoryPath,
  isStableId,
  SEMANTIC_DELEGATION_PROTOCOL,
  SEMANTIC_DELEGATION_SCHEMA_VERSION,
  sha256,
  stableFingerprint,
  type ValidationIssue,
} from '../shared/protocol.ts';
import type {
  AdoptionConcern,
  AdoptionConcernInput,
  Assurance,
  CheckDefinitionInput,
  CompileDelegationInput,
  DelegationCompileResult,
  ExecutionPolicy,
  TaskContract,
  VerificationDefinition,
  VerificationPlan,
} from './types.ts';

const ENVELOPE = {
  protocol: SEMANTIC_DELEGATION_PROTOCOL,
  schemaVersion: SEMANTIC_DELEGATION_SCHEMA_VERSION,
} as const;

export function compileDelegation(input: CompileDelegationInput): DelegationCompileResult {
  assertProtocol(input, 'compileDelegation');
  const issues: ValidationIssue[] = [];
  rejectExtraKeys(input as unknown as Record<string, unknown>, [
    'protocol', 'schemaVersion', 'humanEvent', 'interpretation', 'assurance',
    'verification', 'executionPolicy',
  ], '', issues);

  const humanEvent = compileHumanEvent(input.humanEvent, issues);
  const interpretation = compileInterpretation(input.interpretation, humanEvent, issues);
  const definitions = input.verification?.mode === 'checks'
    ? compileDefinitions(input.verification.checks, issues)
    : [];
  const verificationPlan = compileVerificationPlan(input.verification, definitions, issues);
  const assurance = compileAssurance(input.assurance, definitions, issues);
  const executionPolicy = compileExecutionPolicy(input.executionPolicy, issues);

  if (issues.length || !humanEvent || !interpretation || !verificationPlan
    || !assurance || !executionPolicy) {
    return { ...ENVELOPE, status: 'authority-invalid', issues };
  }

  const semanticProjection = {
    humanEvents: [humanEvent],
    interpretation,
    assurance,
  };
  const semanticContractId = stableFingerprint(semanticProjection);
  const verificationPlanId = stableFingerprint(verificationPlan);
  const effectiveContractId = stableFingerprint({ semanticContractId, verificationPlanId });
  const projection = {
    ...ENVELOPE,
    semanticContractId,
    verificationPlanId,
    effectiveContractId,
    ...semanticProjection,
    verificationPlan,
    executionPolicy,
  };
  const contract: TaskContract = {
    ...projection,
    contractId: stableFingerprint(projection),
  };
  return { ...ENVELOPE, status: 'delegation-compiled', contract };
}

function compileHumanEvent(
  value: CompileDelegationInput['humanEvent'],
  issues: ValidationIssue[],
): HumanEvent | undefined {
  if (!isRecord(value)) {
    issues.push(issue('human-event-invalid', 'humanEvent', 'Human event must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['content'], 'humanEvent', issues);
  if (!isNonEmptyString(value.content)) {
    issues.push(issue('human-event-content-invalid', 'humanEvent.content', 'Exact Human content must be non-empty.'));
    return undefined;
  }
  const content = value.content as string;
  const identity = {
    kind: 'task' as const,
    content,
    capture: 'unattested-input' as const,
  };
  return {
    id: `human:${sha256(JSON.stringify(identity)).slice('sha256:'.length)}`,
    ...identity,
    contentFingerprint: sha256(content),
  };
}

function compileInterpretation(
  value: CompileDelegationInput['interpretation'],
  humanEvent: HumanEvent | undefined,
  issues: ValidationIssue[],
): AgentInterpretation | undefined {
  if (!isRecord(value)) {
    issues.push(issue('interpretation-invalid', 'interpretation', 'Agent interpretation must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['desiredOutcome', 'constraints', 'nonGoals'], 'interpretation', issues);
  const desiredOutcome = normalized(value.desiredOutcome, 'interpretation.desiredOutcome', issues);
  const constraints = stringArray(value.constraints, 'interpretation.constraints', issues);
  const nonGoals = stringArray(value.nonGoals, 'interpretation.nonGoals', issues);
  if (!humanEvent || desiredOutcome === undefined || !constraints || !nonGoals) return undefined;
  return {
    authority: 'agent-judgment',
    basisHumanEventIds: [humanEvent.id],
    desiredOutcome,
    constraints,
    nonGoals,
  };
}

function compileDefinitions(
  values: CheckDefinitionInput[],
  issues: ValidationIssue[],
): VerificationDefinition[] {
  if (!Array.isArray(values) || values.length === 0) {
    issues.push(issue('verification-checks-empty', 'verification.checks', 'Checks mode requires at least one check.'));
    return [];
  }
  const keys = new Set<string>();
  const definitions: VerificationDefinition[] = [];
  for (const [index, value] of values.entries()) {
    const path = `verification.checks[${index}]`;
    if (!isRecord(value)) {
      issues.push(issue('check-invalid', path, 'Check must be an object.'));
      continue;
    }
    rejectExtraKeys(value, [
      'key', 'argv', 'rationale', 'preparation', 'executionInputs', 'verifierSelectors',
    ], path, issues);
    if (!isStableId(value.key)) {
      issues.push(issue('check-key-invalid', `${path}.key`, 'Check key must be a stable readable id.'));
      continue;
    }
    const key = value.key;
    if (keys.has(key)) {
      issues.push(issue('check-key-duplicate', `${path}.key`, `Check key ${key} is repeated.`));
      continue;
    }
    keys.add(key);
    const argv = commandArgv(value.argv, `${path}.argv`, issues);
    const preparation = compilePreparation(value.preparation, path, issues);
    const executionInputs = selectors(value.executionInputs, `${path}.executionInputs`, issues);
    const verifierRefs = verifierSelectors(value.verifierSelectors, path, issues);
    if (!argv || !preparation || !executionInputs || !verifierRefs) continue;
    const rationale = value.rationale === undefined
      ? `Run project check ${key}.`
      : normalized(value.rationale, `${path}.rationale`, issues);
    if (rationale === undefined) continue;
    const verifierProjection = { key, rationale, verifierRefs };
    const verifierId = stableFingerprint(verifierProjection);
    const preparationSteps = preparation.map((step) => ({
      ...step,
      stepId: stableFingerprint({ verifierId, role: 'preparation', key: step.key, argv: step.argv }),
    }));
    const assertion = {
      stepId: stableFingerprint({ verifierId, role: 'assertion', argv }),
      argv,
    };
    const definitionProjection = {
      verifierId,
      key,
      rationale,
      execution: { preparation: preparationSteps, assertion },
      executionInputs,
      verifierRefs,
    };
    definitions.push({
      ...definitionProjection,
      definitionId: stableFingerprint(definitionProjection),
    });
  }
  return definitions.sort((left, right) => left.key.localeCompare(right.key));
}

function compilePreparation(
  value: unknown,
  checkPath: string,
  issues: ValidationIssue[],
): Array<{ key: string; argv: string[] }> | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(issue('check-preparation-invalid', `${checkPath}.preparation`, 'Preparation must be an array.'));
    return undefined;
  }
  const keys = new Set<string>();
  const output: Array<{ key: string; argv: string[] }> = [];
  for (const [index, step] of value.entries()) {
    const path = `${checkPath}.preparation[${index}]`;
    if (!isRecord(step)) {
      issues.push(issue('check-preparation-step-invalid', path, 'Preparation step must be an object.'));
      continue;
    }
    rejectExtraKeys(step, ['key', 'argv'], path, issues);
    if (!isStableId(step.key) || keys.has(step.key)) {
      issues.push(issue('check-preparation-key-invalid', `${path}.key`, 'Preparation key must be unique and stable.'));
      continue;
    }
    const argv = commandArgv(step.argv, `${path}.argv`, issues);
    if (!argv) continue;
    keys.add(step.key);
    output.push({ key: step.key, argv });
  }
  return output;
}

function selectors(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Array<{ kind: 'file' | 'tree'; path: string }> | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(issue('selectors-invalid', path, 'Selectors must be an array.'));
    return undefined;
  }
  const output: Array<{ kind: 'file' | 'tree'; path: string }> = [];
  const seen = new Set<string>();
  for (const [index, selector] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(selector)) {
      issues.push(issue('selector-invalid', itemPath, 'Selector must be an object.'));
      continue;
    }
    rejectExtraKeys(selector, ['kind', 'path'], itemPath, issues);
    if (!['file', 'tree'].includes(String(selector.kind)) || !isSafeRepositoryPath(selector.path)) {
      issues.push(issue('selector-invalid', itemPath, 'Selector requires file/tree and a safe repository path.'));
      continue;
    }
    const item = { kind: selector.kind as 'file' | 'tree', path: selector.path as string };
    const key = `${item.kind}:${item.path}`;
    if (seen.has(key)) {
      issues.push(issue('selector-duplicate', itemPath, `Selector ${key} is repeated.`));
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function verifierSelectors(
  value: unknown,
  checkPath: string,
  issues: ValidationIssue[],
): VerificationDefinition['verifierRefs'] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(issue('verifier-selectors-invalid', `${checkPath}.verifierSelectors`, 'Verifier selectors must be an array.'));
    return undefined;
  }
  const output: VerificationDefinition['verifierRefs'] = [];
  const seen = new Set<string>();
  for (const [index, selector] of value.entries()) {
    const path = `${checkPath}.verifierSelectors[${index}]`;
    if (!isRecord(selector)) {
      issues.push(issue('verifier-selector-invalid', path, 'Verifier selector must be an object.'));
      continue;
    }
    rejectExtraKeys(selector, ['kind', 'path', 'role'], path, issues);
    if (!['file', 'tree'].includes(String(selector.kind))
      || !['command-definition', 'acceptance-surface'].includes(String(selector.role))
      || !isSafeRepositoryPath(selector.path)) {
      issues.push(issue('verifier-selector-invalid', path, 'Verifier selector requires kind, role, and a safe path.'));
      continue;
    }
    const item = {
      kind: selector.kind as 'file' | 'tree',
      path: selector.path as string,
      role: selector.role as 'command-definition' | 'acceptance-surface',
    };
    const key = `${item.kind}:${item.path}:${item.role}`;
    if (seen.has(key)) {
      issues.push(issue('verifier-selector-duplicate', path, `Verifier selector ${key} is repeated.`));
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function compileVerificationPlan(
  value: CompileDelegationInput['verification'],
  definitions: VerificationDefinition[],
  issues: ValidationIssue[],
): VerificationPlan | undefined {
  if (!isRecord(value)) {
    issues.push(issue('verification-invalid', 'verification', 'Verification must be an object.'));
    return undefined;
  }
  if (value.mode === 'checks') {
    rejectExtraKeys(value, ['mode', 'checks'], 'verification', issues);
    return definitions.length ? { mode: 'checks', definitions } : undefined;
  }
  if (value.mode === 'no-command') {
    rejectExtraKeys(value, ['mode', 'rationale'], 'verification', issues);
    const rationale = normalized(value.rationale, 'verification.rationale', issues);
    return rationale === undefined ? undefined : { mode: 'no-command', rationale };
  }
  issues.push(issue('verification-mode-invalid', 'verification.mode', 'Verification mode must be checks or no-command.'));
  return undefined;
}

function compileAssurance(
  value: CompileDelegationInput['assurance'],
  definitions: VerificationDefinition[],
  issues: ValidationIssue[],
): Assurance | undefined {
  if (!isRecord(value)) {
    issues.push(issue('assurance-invalid', 'assurance', 'Assurance must be an object.'));
    return undefined;
  }
  if (value.mode === 'routine') {
    rejectExtraKeys(value, ['mode'], 'assurance', issues);
    return { mode: 'routine' };
  }
  if (value.mode !== 'consequential') {
    issues.push(issue('assurance-mode-invalid', 'assurance.mode', 'Assurance mode must be routine or consequential.'));
    return undefined;
  }
  rejectExtraKeys(value, ['mode', 'concerns'], 'assurance', issues);
  if (!Array.isArray(value.concerns) || value.concerns.length === 0) {
    issues.push(issue('concerns-empty', 'assurance.concerns', 'Consequential assurance requires at least one concern.'));
    return undefined;
  }
  const checks = new Map(definitions.map((definition) => [definition.key, definition.verifierId]));
  const keys = new Set<string>();
  const concerns = value.concerns.flatMap((concern, index) => {
    const compiled = compileConcern(concern, index, checks, keys, issues);
    return compiled ? [compiled] : [];
  });
  return concerns.length ? { mode: 'consequential', concerns } : undefined;
}

function compileConcern(
  value: AdoptionConcernInput,
  index: number,
  checks: Map<string, string>,
  keys: Set<string>,
  issues: ValidationIssue[],
): AdoptionConcern | undefined {
  const path = `assurance.concerns[${index}]`;
  if (!isRecord(value)) {
    issues.push(issue('concern-invalid', path, 'Adoption concern must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['key', 'statement', 'adoptionImpact', 'evidenceRequirements', 'falsification'], path, issues);
  if (!isStableId(value.key) || keys.has(value.key)) {
    issues.push(issue('concern-key-invalid', `${path}.key`, 'Concern key must be unique and stable.'));
    return undefined;
  }
  const statement = normalized(value.statement, `${path}.statement`, issues);
  const adoptionImpact = normalized(value.adoptionImpact, `${path}.adoptionImpact`, issues);
  if (!Array.isArray(value.evidenceRequirements) || value.evidenceRequirements.length === 0) {
    issues.push(issue('concern-evidence-empty', `${path}.evidenceRequirements`, 'Concern requires at least one evidence requirement.'));
    return undefined;
  }
  const requirements: AdoptionConcern['evidenceRequirements'] = [];
  for (const [requirementIndex, requirement] of value.evidenceRequirements.entries()) {
    const requirementPath = `${path}.evidenceRequirements[${requirementIndex}]`;
    if (!isRecord(requirement)) {
      issues.push(issue('concern-evidence-invalid', requirementPath, 'Evidence requirement must be an object.'));
      continue;
    }
    if (requirement.kind === 'check') {
      rejectExtraKeys(requirement, ['kind', 'checkKey'], requirementPath, issues);
      const verifierId = checks.get(String(requirement.checkKey));
      if (!verifierId) {
        issues.push(issue('concern-check-unknown', `${requirementPath}.checkKey`, `Unknown check ${String(requirement.checkKey)}.`));
      } else {
        requirements.push({ kind: 'check', verifierId });
      }
      continue;
    }
    if (requirement.kind === 'human-review') {
      rejectExtraKeys(requirement, ['kind', 'question'], requirementPath, issues);
      const question = normalized(requirement.question, `${requirementPath}.question`, issues);
      if (question !== undefined) requirements.push({ kind: 'human-review', question });
      continue;
    }
    issues.push(issue('concern-evidence-kind-invalid', `${requirementPath}.kind`, 'Evidence kind must be check or human-review.'));
  }
  let falsification: AdoptionConcern['falsification'];
  if (value.falsification !== undefined) {
    if (!isRecord(value.falsification)) {
      issues.push(issue('concern-falsification-invalid', `${path}.falsification`, 'Falsification must be an object.'));
    } else {
      rejectExtraKeys(value.falsification, ['plausibleFailure', 'scenario'], `${path}.falsification`, issues);
      const plausibleFailure = normalized(value.falsification.plausibleFailure, `${path}.falsification.plausibleFailure`, issues);
      const scenario = normalized(value.falsification.scenario, `${path}.falsification.scenario`, issues);
      if (plausibleFailure !== undefined && scenario !== undefined) {
        falsification = { plausibleFailure, scenario };
      }
    }
  }
  if (statement === undefined || adoptionImpact === undefined || !requirements.length) return undefined;
  keys.add(value.key);
  const projection = {
    key: value.key,
    statement,
    adoptionImpact,
    evidenceRequirements: requirements,
    ...(falsification ? { falsification } : {}),
  };
  return { id: stableFingerprint(projection), ...projection };
}

function compileExecutionPolicy(
  value: ExecutionPolicy,
  issues: ValidationIssue[],
): ExecutionPolicy | undefined {
  if (!isRecord(value)) {
    issues.push(issue('execution-policy-invalid', 'executionPolicy', 'Execution policy must be an object.'));
    return undefined;
  }
  rejectExtraKeys(value, ['checkTimeoutMs', 'maxTimeoutMs', 'maxTimeoutRetriesPerCheck'], 'executionPolicy', issues);
  for (const key of ['checkTimeoutMs', 'maxTimeoutMs', 'maxTimeoutRetriesPerCheck'] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < (key === 'maxTimeoutRetriesPerCheck' ? 0 : 1)) {
      issues.push(issue('execution-policy-value-invalid', `executionPolicy.${key}`, `${key} must be a bounded integer.`));
    }
  }
  if (Number.isSafeInteger(value.checkTimeoutMs) && Number.isSafeInteger(value.maxTimeoutMs)
    && value.maxTimeoutMs < value.checkTimeoutMs) {
    issues.push(issue('execution-policy-timeout-order-invalid', 'executionPolicy.maxTimeoutMs', 'Maximum timeout must not be lower than the default timeout.'));
  }
  if (Number.isSafeInteger(value.maxTimeoutRetriesPerCheck)
    && value.maxTimeoutRetriesPerCheck > 0
    && Number.isSafeInteger(value.checkTimeoutMs)
    && Number.isSafeInteger(value.maxTimeoutMs)
    && value.maxTimeoutMs <= value.checkTimeoutMs) {
    issues.push(issue('execution-policy-retry-budget-invalid', 'executionPolicy.maxTimeoutMs', 'A timeout retry policy must allow a larger timeout.'));
  }
  return issues.some((item) => item.path.startsWith('executionPolicy')) ? undefined : {
    checkTimeoutMs: value.checkTimeoutMs,
    maxTimeoutMs: value.maxTimeoutMs,
    maxTimeoutRetriesPerCheck: value.maxTimeoutRetriesPerCheck,
  };
}

function commandArgv(value: unknown, path: string, issues: ValidationIssue[]): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0
    || !isNonEmptyString(value[0])
    || value.some((item) => typeof item !== 'string' || item.includes('\0'))) {
    issues.push(issue('argv-invalid', path, 'Command argv requires a non-empty executable and exact string arguments without NUL.'));
    return undefined;
  }
  return [...value] as string[];
}

function stringArray(value: unknown, path: string, issues: ValidationIssue[]): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    issues.push(issue('string-array-invalid', path, 'Value must be an array of non-empty strings.'));
    return undefined;
  }
  return value.map((item) => String(item).trim());
}

function normalized(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  if (!isNonEmptyString(value)) {
    issues.push(issue('text-invalid', path, 'Value must be a non-empty string.'));
    return undefined;
  }
  return value.trim();
}

function rejectExtraKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of hasExactKeys(value, allowed)) {
    issues.push(issue('field-unsupported', path ? `${path}.${key}` : key, `Unsupported field ${key}.`));
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
