import { DECISION_SCHEMA_VERSION, type VerificationRequirement } from '../decision/types.ts';
import { stableHash } from '../utils/hash.ts';
import { normalizePath } from '../utils/paths.ts';
import { recordEvaluationFeedback } from '../feedback/record-evaluation.ts';
import {
  EVALUATION_SCHEMA_VERSION,
  type ChangeEvaluation,
  type ChangeException,
  type CheckResult,
  type ChangedFile,
  type EvaluateChangeInput,
  type EvaluationEvidenceRef,
  type EvaluationVerdict,
  type GuidanceEvaluation,
  type GuidanceEvidence,
} from './types.ts';

export function evaluateChange(input: EvaluateChangeInput): ChangeEvaluation {
  assertEvaluateShape(input);
  if (input.decision.schemaVersion !== DECISION_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: evaluateChange requires decision schema ${DECISION_SCHEMA_VERSION}.`);
  }

  const changes = normalizeChangedFiles(input.changes.files);
  const checks = uniqueChecks(input.checks ?? []);
  const checkById = new Map(checks.map((check) => [check.id, check]));
  const evidenceById = uniqueEvidence(input.evidence ?? []);
  const exceptionById = uniqueExceptions(input.exceptions ?? []);
  const deliveredIds = new Set(input.decision.trace.deliveredGuidanceIds);

  for (const guidanceId of [...evidenceById.keys(), ...exceptionById.keys()]) {
    if (!deliveredIds.has(guidanceId)) {
      throw new Error(`Evaluation references guidance "${guidanceId}" that was not delivered by decision ${input.decision.decisionId}.`);
    }
  }

  const results: GuidanceEvaluation[] = [];
  for (const item of input.decision.guidance.required) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'required',
      requirements: item.verification,
      evidence: evidenceById.get(item.id),
      exception: exceptionById.get(item.id),
      changes,
      checkById,
    }));
  }
  for (const item of input.decision.guidance.consider) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'consider',
      requirements: item.verification,
      evidence: evidenceById.get(item.id),
      exception: exceptionById.get(item.id),
      changes,
      checkById,
    }));
  }
  for (const item of input.decision.guidance.avoid) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'avoid',
      requirements: item.verification,
      evidence: evidenceById.get(item.id),
      exception: exceptionById.get(item.id),
      changes,
      checkById,
      invertSatisfiedMeaning: true,
    }));
  }
  for (const item of input.decision.guidance.tensions) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'tension',
      requirements: [{ kind: 'semantic', description: item.resolution }],
      evidence: evidenceById.get(item.id),
      exception: exceptionById.get(item.id),
      changes,
      checkById,
    }));
  }

  const status = resolveEvaluationStatus(results, input.decision.mode);
  const summary = {
    requiredSatisfied: results.filter((result) => result.section === 'required' && (result.verdict === 'satisfied' || result.verdict === 'excepted')).length,
    requiredViolated: results.filter((result) => result.section === 'required' && result.verdict === 'violated').length,
    requiredUnverified: results.filter((result) => result.section === 'required' && (result.verdict === 'unverified' || result.verdict === 'partial')).length,
    warningCount: countWarnings(results),
  };
  const operation = inferOperation(changes);
  const evaluation: ChangeEvaluation = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: stableHash([
      EVALUATION_SCHEMA_VERSION,
      input.decision.decisionId,
      changes,
      checks,
      results,
    ]),
    decisionId: input.decision.decisionId,
    status,
    operation,
    results,
    checks,
    summary,
  };
  if (input.feedbackPath) {
    evaluation.feedback = recordEvaluationFeedback(input.feedbackPath, evaluation);
  }
  return evaluation;
}

function assertEvaluateShape(input: EvaluateChangeInput): void {
  if (!input || typeof input !== 'object') throw new Error('evaluateChange input must be an object.');
  const decision = input.decision as unknown;
  if (!isRecord(decision)) throw new Error('evaluateChange decision must be an object.');
  const guidance = decision.guidance;
  if (!isRecord(guidance)) throw new Error('evaluateChange decision.guidance must be an object.');
  for (const section of ['required', 'consider', 'avoid', 'tensions']) {
    if (!Array.isArray(guidance[section])) throw new Error(`evaluateChange decision.guidance.${section} must be an array.`);
  }
  const required = guidance.required as unknown[];
  const consider = guidance.consider as unknown[];
  const avoid = guidance.avoid as unknown[];
  const tensions = guidance.tensions as unknown[];
  for (const item of [...required, ...consider, ...avoid]) {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.verification)) {
      throw new Error('evaluateChange delivered guidance entries require string id and verification array.');
    }
  }
  for (const item of tensions) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.resolution !== 'string') {
      throw new Error('evaluateChange tension entries require string id and resolution.');
    }
  }
  if (!isRecord(decision.trace) || !Array.isArray(decision.trace.deliveredGuidanceIds)) {
    throw new Error('evaluateChange decision.trace.deliveredGuidanceIds must be an array.');
  }
  if (!input.changes || !Array.isArray(input.changes.files)) throw new Error('evaluateChange changes.files must be an array.');
  for (const file of input.changes.files) {
    if (!file || typeof file.path !== 'string' || !['added', 'modified', 'deleted', 'renamed'].includes(file.status)) {
      throw new Error('evaluateChange changed files require path and a valid status.');
    }
  }
  if (input.checks !== undefined && !Array.isArray(input.checks)) throw new Error('evaluateChange checks must be an array.');
  for (const check of input.checks ?? []) {
    if (!check || typeof check.id !== 'string' || !['passed', 'failed', 'skipped'].includes(check.status)) {
      throw new Error('evaluateChange checks require id and a valid status.');
    }
  }
  if (input.evidence !== undefined && !Array.isArray(input.evidence)) throw new Error('evaluateChange evidence must be an array.');
  for (const evidence of input.evidence ?? []) {
    if (!evidence || typeof evidence.guidanceId !== 'string' || !['satisfied', 'violated', 'partial', 'unverified'].includes(evidence.verdict)) {
      throw new Error('evaluateChange guidance evidence requires guidanceId and a valid verdict.');
    }
    if (!Array.isArray(evidence.evidenceRefs)) throw new Error('evaluateChange guidance evidenceRefs must be an array.');
    for (const ref of evidence.evidenceRefs) {
      if (!ref || typeof ref.ref !== 'string' || !['diff', 'file', 'check', 'semantic', 'static'].includes(ref.kind)) {
        throw new Error('evaluateChange evidence refs require ref and a valid kind.');
      }
    }
  }
  if (input.exceptions !== undefined && !Array.isArray(input.exceptions)) throw new Error('evaluateChange exceptions must be an array.');
  for (const exception of input.exceptions ?? []) {
    if (!exception || typeof exception.guidanceId !== 'string' || typeof exception.reason !== 'string' || !exception.reason.trim()) {
      throw new Error('evaluateChange exceptions require guidanceId and non-empty reason.');
    }
    if (exception.status !== undefined && !['requested', 'approved'].includes(exception.status)) {
      throw new Error('evaluateChange exception status must be requested or approved.');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface EvaluateItemInput {
  guidanceId: string;
  section: GuidanceEvaluation['section'];
  requirements: VerificationRequirement[];
  evidence?: GuidanceEvidence;
  exception?: ChangeException;
  changes: ChangedFile[];
  checkById: Map<string, CheckResult>;
  invertSatisfiedMeaning?: boolean;
}

function evaluateGuidanceItem(input: EvaluateItemInput): GuidanceEvaluation {
  const acceptedEvidence: EvaluationEvidenceRef[] = [];
  const rejectedEvidence: GuidanceEvaluation['rejectedEvidence'] = [];
  const reasons: string[] = [];
  const evidence = input.evidence;
  const failedRequiredChecks = input.requirements
    .filter((requirement) => requirement.kind === 'command' && requirement.commandId)
    .flatMap((requirement) => {
      const check = input.checkById.get(requirement.commandId!);
      return check?.status === 'failed' ? [requirement.commandId!] : [];
    });

  for (const ref of evidence?.evidenceRefs ?? []) {
    const reason = invalidEvidenceReason(ref, input.changes, input.checkById);
    if (reason) rejectedEvidence.push({ ref, reason });
    else acceptedEvidence.push(ref);
  }

  let verdict: EvaluationVerdict = 'unverified';
  if (failedRequiredChecks.length) {
    for (const checkId of failedRequiredChecks) {
      const check = input.checkById.get(checkId)!;
      if (!acceptedEvidence.some((ref) => ref.kind === 'check' && ref.checkId === checkId)) {
        acceptedEvidence.push({
          kind: 'check',
          ref: check.outputRef ?? `check:${checkId}`,
          checkId,
          description: 'Runtime accepted the supplied failed required check as violation evidence.',
        });
      }
    }
    verdict = 'violated';
    reasons.push(`Required check(s) failed: ${failedRequiredChecks.join(', ')}.`);
  } else if (evidence?.verdict === 'violated') {
    verdict = acceptedEvidence.length ? 'violated' : 'unverified';
    reasons.push(acceptedEvidence.length ? 'Evidence reports a concrete violation.' : 'Violation verdict lacked valid evidence.');
  } else if (evidence?.verdict === 'partial') {
    verdict = acceptedEvidence.length ? 'partial' : 'unverified';
    reasons.push(acceptedEvidence.length ? 'Evidence only partially covers the guidance.' : 'Partial verdict lacked valid evidence.');
  } else if (evidence?.verdict === 'satisfied') {
    const uncovered = uncoveredRequirements(input.requirements, acceptedEvidence, input.checkById);
    if (uncovered.length) {
      verdict = 'partial';
      reasons.push(`Missing evidence for: ${uncovered.join(', ')}.`);
    } else {
      verdict = input.invertSatisfiedMeaning ? 'satisfied' : 'satisfied';
      reasons.push(input.invertSatisfiedMeaning
        ? 'Evidence confirms the prohibited pattern is absent.'
        : 'All declared verification requirements have valid evidence.');
    }
  } else {
    reasons.push('No evidence-backed verdict was provided.');
  }

  if (input.exception) {
    if (input.exception.status === 'approved' && input.exception.approvedBy?.trim() && input.exception.reason.trim()) {
      verdict = 'excepted';
      reasons.push(`Approved exception recorded by ${input.exception.approvedBy}.`);
    } else {
      reasons.push('Exception is requested but not approved.');
    }
  }

  return {
    guidanceId: input.guidanceId,
    section: input.section,
    verdict,
    reasons,
    acceptedEvidence,
    rejectedEvidence,
    ...(input.exception ? { exception: input.exception } : {}),
  };
}

function invalidEvidenceReason(
  ref: EvaluationEvidenceRef,
  changes: ChangedFile[],
  checkById: EvaluateItemInput['checkById'],
): string | null {
  if (!ref.ref?.trim()) return 'evidence ref is empty';
  if (ref.kind === 'diff' || ref.kind === 'file') {
    if (!ref.file) return `${ref.kind} evidence requires a file`;
    const file = normalizePath(ref.file);
    if (!changes.some((change) => change.path === file || change.previousPath === file)) {
      return `file ${file} is not in the supplied change set`;
    }
  }
  if (ref.kind === 'check') {
    if (!ref.checkId) return 'check evidence requires checkId';
    const check = checkById.get(ref.checkId);
    if (!check) return `check ${ref.checkId} was not supplied`;
    if (check.status !== 'passed') return `check ${ref.checkId} did not pass`;
  }
  if (ref.kind === 'semantic' && !ref.description?.trim()) return 'semantic evidence requires a description';
  return null;
}

function uncoveredRequirements(
  requirements: VerificationRequirement[],
  evidence: EvaluationEvidenceRef[],
  checkById: EvaluateItemInput['checkById'],
): string[] {
  const result: string[] = [];
  const kinds = new Set(evidence.map((ref) => ref.kind));
  for (const requirement of requirements) {
    if (requirement.kind === 'command') {
      if (!requirement.commandId || checkById.get(requirement.commandId)?.status !== 'passed') {
        result.push(`command:${requirement.commandId ?? 'unknown'}`);
      }
      continue;
    }
    if (requirement.kind === 'diff' && !kinds.has('diff') && !kinds.has('file')) result.push('diff');
    if (requirement.kind === 'semantic' && !kinds.has('semantic')) result.push('semantic');
    if (requirement.kind === 'static' && !kinds.has('static')) result.push('static');
  }
  return [...new Set(result)];
}

function resolveEvaluationStatus(
  results: GuidanceEvaluation[],
  mode: 'standard' | 'strict',
): ChangeEvaluation['status'] {
  const hardViolation = results.some((result) =>
    (result.section === 'required' || result.section === 'avoid')
    && result.verdict === 'violated'
    && result.exception?.status !== 'approved');
  if (hardViolation) return 'rejected';

  const pendingException = results.some((result) => result.exception && result.exception.status !== 'approved');
  const hardUnverified = results.some((result) =>
    (result.section === 'required' || result.section === 'tension')
    && (result.verdict === 'unverified' || result.verdict === 'partial'));
  if (pendingException || (mode === 'strict' && hardUnverified)) return 'exception-required';

  const warning = hardUnverified || results.some((result) =>
    (result.section === 'consider' || result.section === 'avoid')
    && result.verdict !== 'satisfied'
    && result.verdict !== 'excepted');
  return warning ? 'warning' : 'accepted';
}

function countWarnings(results: GuidanceEvaluation[]): number {
  return results.filter((result) => result.verdict === 'violated' || result.verdict === 'partial' || result.verdict === 'unverified').length;
}

function normalizeChangedFiles(files: ChangedFile[]): ChangedFile[] {
  const result: ChangedFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({
      ...file,
      path,
      ...(file.previousPath ? { previousPath: normalizePath(file.previousPath) } : {}),
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function inferOperation(files: ChangedFile[]): ChangeEvaluation['operation'] {
  if (!files.length) return 'none';
  const operations = new Set(files.map((file) => {
    if (file.status === 'added') return 'create';
    if (file.status === 'deleted') return 'delete';
    return 'modify';
  }));
  if (operations.size > 1) return 'mixed';
  return [...operations][0] as 'create' | 'modify' | 'delete';
}

function uniqueChecks(checks: NonNullable<EvaluateChangeInput['checks']>): NonNullable<EvaluateChangeInput['checks']> {
  const result = new Map<string, NonNullable<EvaluateChangeInput['checks']>[number]>();
  for (const check of checks) {
    if (!check.id?.trim()) throw new Error('Check result id must be non-empty.');
    if (result.has(check.id)) throw new Error(`Duplicate check result id: ${check.id}.`);
    result.set(check.id, { ...check, id: check.id.trim() });
  }
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueEvidence(evidence: GuidanceEvidence[]): Map<string, GuidanceEvidence> {
  const result = new Map<string, GuidanceEvidence>();
  for (const item of evidence) {
    if (result.has(item.guidanceId)) throw new Error(`Duplicate guidance evidence id: ${item.guidanceId}.`);
    result.set(item.guidanceId, item);
  }
  return result;
}

function uniqueExceptions(exceptions: ChangeException[]): Map<string, ChangeException> {
  const result = new Map<string, ChangeException>();
  for (const item of exceptions) {
    if (result.has(item.guidanceId)) throw new Error(`Duplicate exception guidance id: ${item.guidanceId}.`);
    result.set(item.guidanceId, { ...item, status: item.status ?? 'requested' });
  }
  return result;
}
