import { DECISION_SCHEMA_VERSION, type VerificationRequirement } from '../decision/types.ts';
import { stableHash } from '../utils/hash.ts';
import { normalizePath } from '../utils/paths.ts';
import {
  EVALUATION_SCHEMA_VERSION,
  type ChangeEvaluation,
  type ChangeException,
  type ChangeSet,
  type CheckResult,
  type ChangedFile,
  type EvaluateChangeInput,
  type EvaluationEvidenceRef,
  type EvaluationVerdict,
  type GuidanceAttestation,
  type GuidanceEvaluation,
} from './types.ts';

export function evaluateChange(input: EvaluateChangeInput): ChangeEvaluation {
  assertEvaluateShape(input);
  if (input.decision.schemaVersion !== DECISION_SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA_VERSION: evaluateChange requires decision schema ${DECISION_SCHEMA_VERSION}.`);
  }

  const changes = normalizeChangeSet(input.changes);
  const checks = uniqueChecks(input.checks ?? []);
  const requestedCheckIds = new Set(input.decision.verificationPlan.commands.map((item) => item.id));
  for (const check of checks) {
    if (!requestedCheckIds.has(check.id)) {
      throw new Error(`evaluateChange received unrequested check "${check.id}".`);
    }
    if (check.provenance.collectionId !== changes.provenance.collectionId) {
      throw new Error(`evaluateChange check "${check.id}" was not collected with the supplied change set.`);
    }
  }
  const checkById = new Map(checks.map((check) => [check.id, check]));
  const attestationById = uniqueAttestations(input.attestations ?? []);
  const exceptionById = uniqueExceptions(input.exceptions ?? []);
  const deliveredIds = new Set(input.decision.trace.deliveredGuidanceIds);

  for (const guidanceId of [...attestationById.keys(), ...exceptionById.keys()]) {
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
      attestation: attestationById.get(item.id),
      exception: exceptionById.get(item.id),
      changes: changes.files,
      checkById,
    }));
  }
  for (const item of input.decision.guidance.consider) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'consider',
      requirements: item.verification,
      attestation: attestationById.get(item.id),
      exception: exceptionById.get(item.id),
      changes: changes.files,
      checkById,
    }));
  }
  for (const item of input.decision.guidance.avoid) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'avoid',
      requirements: item.verification,
      attestation: attestationById.get(item.id),
      exception: exceptionById.get(item.id),
      changes: changes.files,
      checkById,
      invertSatisfiedMeaning: true,
    }));
  }
  for (const item of input.decision.guidance.tensions) {
    results.push(evaluateGuidanceItem({
      guidanceId: item.id,
      section: 'tension',
      requirements: [{ kind: 'semantic', description: item.resolution }],
      attestation: attestationById.get(item.id),
      exception: exceptionById.get(item.id),
      changes: changes.files,
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
  const operation = inferOperation(changes.files);
  return {
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
    changes,
    results,
    checks,
    assurance: {
      machineFacts: {
        changeSet: true,
        changedFileCount: changes.files.length,
        collectedCheckCount: checks.length,
      },
      hostAttestationCount: attestationById.size,
    },
    summary,
  };
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
  assertMachineProvenance(input.changes.provenance, 'change set');
  for (const field of ['baselineFingerprint', 'currentFingerprint', 'changeFingerprint'] as const) {
    if (typeof input.changes[field] !== 'string' || !input.changes[field].trim()) {
      throw new Error(`evaluateChange changes.${field} must be non-empty.`);
    }
  }
  for (const field of ['baselineHead', 'currentHead'] as const) {
    if (input.changes[field] !== null && typeof input.changes[field] !== 'string') {
      throw new Error(`evaluateChange changes.${field} must be a string or null.`);
    }
  }
  for (const file of input.changes.files) {
    if (!file || typeof file.path !== 'string' || !['added', 'modified', 'deleted', 'renamed'].includes(file.status)) {
      throw new Error('evaluateChange changed files require path and a valid status.');
    }
    assertChangedFileShape(file);
  }
  if (input.checks !== undefined && !Array.isArray(input.checks)) throw new Error('evaluateChange checks must be an array.');
  for (const check of input.checks ?? []) {
    if (!check || typeof check.id !== 'string' || !['passed', 'failed', 'skipped'].includes(check.status)) {
      throw new Error('evaluateChange checks require id and a valid status.');
    }
    if (!Array.isArray(check.command) || check.command.some((part) => typeof part !== 'string' || !part)) {
      throw new Error('evaluateChange checks require a command string array.');
    }
    if (check.exitCode !== null && !Number.isInteger(check.exitCode)) {
      throw new Error('evaluateChange check exitCode must be an integer or null.');
    }
    if (typeof check.outputDigest !== 'string' || !check.outputDigest.trim()) {
      throw new Error('evaluateChange checks require outputDigest.');
    }
    if (check.outputRefs !== undefined) {
      if (!isRecord(check.outputRefs)
        || typeof check.outputRefs.stdout !== 'string'
        || typeof check.outputRefs.stderr !== 'string') {
        throw new Error('evaluateChange check outputRefs require stdout and stderr paths.');
      }
      assertSafeRelativePath(normalizePath(check.outputRefs.stdout), 'check stdout outputRef');
      assertSafeRelativePath(normalizePath(check.outputRefs.stderr), 'check stderr outputRef');
    }
    if (check.outputTruncated !== undefined
      && (!isRecord(check.outputTruncated)
        || typeof check.outputTruncated.stdout !== 'boolean'
        || typeof check.outputTruncated.stderr !== 'boolean')) {
      throw new Error('evaluateChange check outputTruncated requires stdout and stderr booleans.');
    }
    if (check.status === 'skipped' && (typeof check.reason !== 'string' || !check.reason.trim())) {
      throw new Error('evaluateChange skipped checks require a reason.');
    }
    if (check.status !== 'skipped') {
      if (!check.command.length
        || typeof check.definitionFingerprint !== 'string'
        || !check.definitionFingerprint.trim()) {
        throw new Error('evaluateChange executed checks require command and definitionFingerprint.');
      }
      if (check.status === 'passed' && check.exitCode !== 0) {
        throw new Error('evaluateChange passed checks require exitCode 0.');
      }
      if (check.status === 'failed' && check.exitCode === 0) {
        throw new Error('evaluateChange failed checks cannot have exitCode 0.');
      }
    }
    assertMachineProvenance(check.provenance, `check ${check.id}`);
  }
  if (input.attestations !== undefined && !Array.isArray(input.attestations)) {
    throw new Error('evaluateChange attestations must be an array.');
  }
  for (const attestation of input.attestations ?? []) {
    if (!attestation || typeof attestation.guidanceId !== 'string' || !['satisfied', 'violated', 'partial', 'unverified'].includes(attestation.verdict)) {
      throw new Error('evaluateChange guidance attestations require guidanceId and a valid verdict.');
    }
    if (typeof attestation.attestedBy !== 'string' || !attestation.attestedBy.trim()) {
      throw new Error('evaluateChange guidance attestations require attestedBy.');
    }
    if (typeof attestation.explanation !== 'string' || !attestation.explanation.trim()) {
      throw new Error('evaluateChange guidance attestations require a concrete explanation.');
    }
    if (!Array.isArray(attestation.evidenceRefs)) {
      throw new Error('evaluateChange guidance attestation evidenceRefs must be an array.');
    }
    for (const ref of attestation.evidenceRefs) {
      if (!ref || typeof ref.ref !== 'string' || !['diff', 'file', 'check', 'semantic'].includes(ref.kind)) {
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
  attestation?: GuidanceAttestation;
  exception?: ChangeException;
  changes: ChangedFile[];
  checkById: Map<string, CheckResult>;
  invertSatisfiedMeaning?: boolean;
}

function evaluateGuidanceItem(input: EvaluateItemInput): GuidanceEvaluation {
  const acceptedEvidence: EvaluationEvidenceRef[] = [];
  const rejectedEvidence: GuidanceEvaluation['rejectedEvidence'] = [];
  const reasons: string[] = [];
  const attestation = input.attestation;
  const failedRequiredChecks = input.requirements
    .filter((requirement) => requirement.kind === 'command' && requirement.commandId)
    .flatMap((requirement) => {
      const check = input.checkById.get(requirement.commandId!);
      return check?.status === 'failed' ? [requirement.commandId!] : [];
    });

  for (const ref of attestation?.evidenceRefs ?? []) {
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
          ref: check.outputRefs?.stderr ?? check.outputRefs?.stdout ?? `check:${checkId}`,
          checkId,
          description: 'Runtime accepted the machine-collected failed required check as violation evidence.',
        });
      }
    }
    verdict = 'violated';
    reasons.push(`Required check(s) failed: ${failedRequiredChecks.join(', ')}.`);
  } else if (attestation?.verdict === 'violated') {
    verdict = acceptedEvidence.length ? 'violated' : 'unverified';
    reasons.push(acceptedEvidence.length ? 'Evidence reports a concrete violation.' : 'Violation verdict lacked valid evidence.');
  } else if (attestation?.verdict === 'partial') {
    verdict = acceptedEvidence.length ? 'partial' : 'unverified';
    reasons.push(acceptedEvidence.length ? 'Evidence only partially covers the guidance.' : 'Partial verdict lacked valid evidence.');
  } else if (attestation?.verdict === 'satisfied') {
    const uncovered = uncoveredRequirements(input.requirements, acceptedEvidence, input.checkById);
    if (uncovered.length) {
      verdict = 'partial';
      reasons.push(`Missing evidence for: ${uncovered.join(', ')}.`);
    } else {
      verdict = 'satisfied';
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
    ...(attestation
      ? {
          attestation: {
            attestedBy: attestation.attestedBy.trim(),
            explanation: attestation.explanation.trim(),
          },
        }
      : {}),
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

function normalizeChangeSet(changes: ChangeSet): ChangeSet {
  const files = normalizeChangedFiles(changes.files);
  const expectedChangeFingerprint = stableHash([files]);
  if (changes.changeFingerprint !== expectedChangeFingerprint) {
    throw new Error('evaluateChange changeFingerprint does not match the normalized changed-file facts.');
  }
  const expectedCollectionId = stableHash([
    changes.baselineFingerprint,
    changes.currentFingerprint,
    changes.changeFingerprint,
  ]);
  if (changes.provenance.collectionId !== expectedCollectionId) {
    throw new Error('evaluateChange change-set collectionId does not match its machine facts.');
  }
  return {
    ...changes,
    files,
    provenance: {
      source: 'resonant-code-workflow',
      collectionId: expectedCollectionId,
    },
  };
}

function normalizeChangedFiles(files: ChangedFile[]): ChangedFile[] {
  const result: ChangedFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    assertSafeRelativePath(path, 'changed file');
    if (seen.has(path)) throw new Error(`Duplicate changed file path: ${path}.`);
    seen.add(path);
    const previousPath = file.previousPath ? normalizePath(file.previousPath) : undefined;
    if (previousPath) assertSafeRelativePath(previousPath, 'changed file previousPath');
    result.push({
      ...file,
      path,
      ...(previousPath ? { previousPath } : {}),
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

function uniqueAttestations(
  attestations: GuidanceAttestation[],
): Map<string, GuidanceAttestation> {
  const result = new Map<string, GuidanceAttestation>();
  for (const item of attestations) {
    if (result.has(item.guidanceId)) {
      throw new Error(`Duplicate guidance attestation id: ${item.guidanceId}.`);
    }
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

function assertMachineProvenance(value: unknown, label: string): void {
  if (!isRecord(value)
    || value.source !== 'resonant-code-workflow'
    || typeof value.collectionId !== 'string'
    || !value.collectionId.trim()) {
    throw new Error(`evaluateChange ${label} requires resonant-code workflow machine provenance.`);
  }
}

function assertChangedFileShape(file: ChangedFile): void {
  assertSafeRelativePath(normalizePath(file.path), 'changed file');
  if (file.status === 'renamed') {
    if (typeof file.previousPath !== 'string' || !file.previousPath.trim()) {
      throw new Error('evaluateChange renamed files require previousPath.');
    }
    assertSafeRelativePath(normalizePath(file.previousPath), 'changed file previousPath');
  } else if (file.previousPath !== undefined) {
    throw new Error('evaluateChange previousPath is valid only for renamed files.');
  }
  if (file.status === 'added') {
    if (file.before !== undefined || !file.after) {
      throw new Error('evaluateChange added files require only an after fact.');
    }
  } else if (file.status === 'deleted') {
    if (!file.before || file.after !== undefined) {
      throw new Error('evaluateChange deleted files require only a before fact.');
    }
  } else if (!file.before || !file.after) {
    throw new Error(`evaluateChange ${file.status} files require before and after facts.`);
  }
  for (const fact of [file.before, file.after]) {
    if (!fact) continue;
    if (!['file', 'symlink'].includes(fact.kind)
      || typeof fact.contentHash !== 'string'
      || !fact.contentHash.trim()
      || typeof fact.mode !== 'string'
      || !fact.mode.trim()) {
      throw new Error('evaluateChange file facts require kind, contentHash, and mode.');
    }
  }
}

function assertSafeRelativePath(value: string, label: string): void {
  if (!value
    || value.startsWith('/')
    || /^[A-Za-z]:\//.test(value)
    || value.split('/').some((segment) => segment === '..' || segment === '')
    || value.includes('\0')) {
    throw new Error(`evaluateChange ${label} must be a safe repository-relative path.`);
  }
}
