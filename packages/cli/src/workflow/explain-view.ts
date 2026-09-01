import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  BaselineVerificationFact,
  CheckFact,
  EvidenceDisposition,
  FactBundle,
  TaskContract,
} from '@sovea/stetra-core';

import { usageError } from '../errors.ts';
import type { TaskProjection } from '../schemas/delegation.ts';

export const MAX_LOG_EXPLAIN_BYTES = 512 * 1024;
const MAX_SUMMARY_EXPLAIN_BYTES = 64 * 1024;

export function boundedExplainView<T>(
  section: string,
  value: T,
  maximumBytes = MAX_SUMMARY_EXPLAIN_BYTES,
): T {
  const byteLength = Buffer.byteLength(JSON.stringify(value));
  if (byteLength > maximumBytes) {
    throw usageError(
      `Bounded ${section} view is ${byteLength} bytes; narrow the request with an exact selector instead of expanding the aggregate Artifact.`,
    );
  }
  return value;
}

export function summarizeContract(contract: TaskContract, taskId: string) {
  return {
    protocol: contract.protocol,
    schemaVersion: contract.schemaVersion,
    semanticContractId: contract.semanticContractId,
    verificationPlanId: contract.verificationPlanId,
    effectiveContractId: contract.effectiveContractId,
    humanEvents: contract.humanEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      provider: event.provider,
      nativeId: event.nativeId,
      contentFingerprint: event.contentFingerprint,
    })),
    understanding: {
      basis: contract.understanding.desiredOutcome.basis,
      desiredOutcomeId: contract.understanding.desiredOutcome.id,
      desiredOutcome: contract.understanding.desiredOutcome.value,
      constraintIds: contract.understanding.constraints.map((item) => item.id),
      constraints: contract.understanding.constraints.map((item) => item.value),
      nonGoalIds: contract.understanding.nonGoals.map((item) => item.id),
      nonGoals: contract.understanding.nonGoals.map((item) => item.value),
      focusIds: contract.understanding.focus.map((item) => item.id),
      focus: contract.understanding.focus.map((item) => item.value),
    },
    repositoryEvidence: contract.repositoryEvidence.map((item) => ({
      id: item.id,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      digest: item.digest,
    })),
    materialDecisions: contract.materialDecisions.map((item) => ({
      id: item.id,
      key: item.key,
      question: item.question,
      selectedAlternativeKey: item.resolution.selectedAlternativeKey,
    })),
    assurance: contract.assurance,
    adoptionConditions: contract.adoptionConditions.map((condition) => ({
      id: condition.id,
      key: condition.key,
      statement: condition.statement,
      adoptionRationale: condition.adoptionRationale,
      criticality: condition.criticality,
      obligationCount: condition.evidenceObligations.length,
    })),
    hostPolicyRequirements: contract.hostPolicyRequirements,
    verificationPlan: contract.verificationPlan.mode === 'checks'
      ? {
          mode: 'checks' as const,
          definitions: contract.verificationPlan.definitions.map((definition) => ({
            verifierId: definition.verifierId,
            definitionId: definition.definitionId,
            key: definition.key,
            rationale: definition.rationale,
            execution: definition.execution,
            baseline: definition.baseline,
            verifierRefs: definition.verifierRefs,
          })),
        }
      : contract.verificationPlan,
    selectors: {
      condition: explainSelectorCommand(
        taskId,
        'condition',
        ['--condition', '<condition-key>'],
      ),
      humanEvent: explainSelectorCommand(
        taskId,
        'human-event',
        ['--human-event', '<human-event-id>'],
      ),
      repositoryEvidence: explainSelectorCommand(
        taskId,
        'repository-evidence',
        ['--evidence', '<repository-evidence-id>'],
      ),
      materialDecision: explainSelectorCommand(
        taskId,
        'material-decision',
        ['--material-decision', '<material-decision-key>'],
      ),
    },
  };
}

export function summarizeBaselineVerification(baseline: BaselineVerificationFact) {
  return {
    fingerprint: baseline.fingerprint,
    preCheck: baseline.preCheck,
    postCheck: baseline.postCheck,
    preCheckExecutionInputs: baseline.preCheckExecutionInputs.map(summarizeExecutionInputs),
    postCheckExecutionInputs: baseline.postCheckExecutionInputs.map(summarizeExecutionInputs),
    checkInducedChanges: summarizeChangedFiles(baseline.checkInducedChanges),
    checks: baseline.checks.map((check) => ({
      definitionId: check.definitionId,
      mode: check.mode,
      observation: check.observation ? summarizeCheck(check.observation) : null,
    })),
  };
}

export function summarizeAttempt(
  attempt: TaskProjection['attempts'][number],
  facts: FactBundle | undefined,
  dispositions: EvidenceDisposition[],
) {
  return {
    ...attempt,
    facts: facts ? summarizeFacts(facts) : null,
    evidenceDispositions: dispositions.map((disposition) => ({
      dispositionId: disposition.dispositionId,
      semanticImpact: disposition.semanticImpact,
      proposedRoute: disposition.proposedRoute,
      route: disposition.route,
      entryCount: disposition.entries.length,
      causes: countBy(disposition.entries.map((entry) => entry.cause)),
    })),
  };
}

function summarizeFacts(facts: FactBundle) {
  return {
    factCollectionId: facts.factCollectionId,
    effectiveContractId: facts.effectiveContractId,
    attemptId: facts.attemptId,
    baseline: facts.baseline,
    preCheck: facts.preCheck,
    current: facts.current,
    changeFingerprint: facts.changeFingerprint,
    changedFiles: summarizeChangedFiles(facts.changedFiles),
    checkInducedChanges: summarizeChangedFiles(facts.checkInducedChanges),
    checks: facts.checks.map(summarizeCheck),
    checkComparisons: facts.checkComparisons,
    evidenceConcerns: facts.evidenceConcerns,
    verifierMutations: {
      total: facts.verifierMutations.length,
      definitionIds: unique(facts.verifierMutations.map((item) => item.definitionId)),
    },
    environment: facts.environment,
    patch: facts.patch ?? null,
    provenance: facts.provenance,
  };
}

function summarizeChangedFiles(files: FactBundle['changedFiles']) {
  return {
    total: files.length,
    operations: countBy(files.map((file) => file.operation)),
    representations: countBy(files.map((file) => file.representation)),
  };
}

function summarizeCheck(check: CheckFact) {
  const latest = check.attempts.at(-1);
  if (!latest) throw new Error(`Check ${check.definitionId} has no execution attempt.`);
  return {
    verifierId: check.verifierId,
    definitionId: check.definitionId,
    assertionArgv: check.assertionArgv,
    definitionFingerprint: check.definitionFingerprint,
    attemptCount: check.attempts.length,
    latestAttempt: summarizeCheckAttempt(latest),
  };
}

export function summarizeCheckAttempt(attempt: CheckFact['attempts'][number]) {
  return {
    attempt: attempt.attempt,
    durationMs: attempt.durationMs,
    timeoutMs: attempt.timeoutMs,
    status: attempt.status,
    observedPhase: attempt.observedPhase,
    termination: attempt.termination,
    outcomeFingerprint: attempt.outcomeFingerprint,
    stdout: attempt.stdout,
    stderr: attempt.stderr,
    steps: attempt.steps.map((step) => ({
      stepId: step.stepId,
      role: step.role,
      ...(step.key ? { key: step.key } : {}),
      argv: step.argv,
      durationMs: step.durationMs,
      timeoutMs: step.timeoutMs,
      status: step.status,
      termination: step.termination,
      outcomeFingerprint: step.outcomeFingerprint,
      stdout: step.stdout,
      stderr: step.stderr,
      ...(step.reason ? { reason: step.reason } : {}),
    })),
    executionInputs: {
      beforePreparation: summarizeExecutionInputs(attempt.executionInputs.beforePreparation),
      readyForAssertion: summarizeExecutionInputs(attempt.executionInputs.readyForAssertion),
      afterAssertion: summarizeExecutionInputs(attempt.executionInputs.afterAssertion),
    },
    ...(attempt.reason ? { reason: attempt.reason } : {}),
  };
}

function summarizeExecutionInputs(
  snapshot: CheckFact['attempts'][number]['executionInputs']['beforePreparation'],
) {
  return {
    definitionId: snapshot.definitionId,
    fingerprint: snapshot.fingerprint,
    inputs: snapshot.inputs.map((input) => ({
      selector: input.selector,
      state: input.state,
      entryCount: input.entries.length,
      fingerprint: input.fingerprint,
    })),
  };
}

export function readBoundedCheckLog(
  task: { projectRoot: string; taskDirectory: string },
  stream: CheckFact['attempts'][number]['stdout'],
  tailBytes: number,
) {
  if (!Number.isSafeInteger(tailBytes) || tailBytes < 1 || tailBytes > 65_536) {
    throw usageError('log tailBytes must be an integer from 1 through 65536.');
  }
  if (!stream.logPath) {
    return {
      ...stream,
      returnedBytes: 0,
      omittedPersistedBytes: 0,
      content: '',
    };
  }
  const absolute = resolve(task.projectRoot, stream.logPath);
  const insideTask = relative(task.taskDirectory, absolute);
  if (isAbsolute(insideTask) || insideTask === '..' || insideTask.startsWith(`..${sep}`)) {
    throw new Error(`Stored Check log escapes its task directory: ${stream.logPath}`);
  }
  const persisted = readFileSync(absolute);
  const start = Math.max(0, persisted.length - tailBytes);
  const slice = persisted.subarray(start);
  return {
    ...stream,
    returnedBytes: slice.length,
    omittedPersistedBytes: start,
    content: slice.toString('utf8'),
  };
}

export function explainSelectorCommand(taskId: string, section: string, tail: string[]) {
  return {
    argv: [
      'stetra', 'change', 'explain', '.', '--task', taskId,
      '--section', section, ...tail, '--json',
    ],
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
