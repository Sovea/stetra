import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildRepoIndex } from './indexing/build-repo-index.ts';
import { extractWindowsForFiles } from './slicing/extract-windows.ts';
import { toYaml } from './utils/yaml.ts';
import { parseCalibrationProposal, parseRcclDocument } from './parse.ts';
import { materializeVerifiedObservation, refreshObservationEvidence } from './verify.ts';
import {
  RCCL_SCHEMA_VERSION,
  type CalibrationContract,
  type CalibrationDiagnostic,
  type CommitCalibrationInput,
  type CommitCalibrationOutput,
  type PrepareCalibrationInput,
  type PrepareCalibrationOutput,
  type RcclDocument,
  type ValidateContextInput,
  type ValidateContextOutput,
} from './types.ts';

const DEFAULT_MAX_FILES = 8;
const MAX_ALLOWED_FILES = 20;

export function prepareCalibration(input: PrepareCalibrationInput): PrepareCalibrationOutput {
  const projectRoot = resolve(input.projectRoot);
  const maxFiles = Math.min(MAX_ALLOWED_FILES, Math.max(1, input.maxFiles ?? DEFAULT_MAX_FILES));
  const indexed = buildRepoIndex(projectRoot, input.scope ?? 'auto');
  const requestedPaths = uniquePaths(input.paths ?? []);
  const selectedFiles = (requestedPaths.length
    ? indexed.files.filter((file) => requestedPaths.some((path) => overlaps(path, file.path)))
    : rankFiles(indexed.files))
    .slice(0, maxFiles);
  const windows = extractWindowsForFiles(projectRoot, selectedFiles, {
    max_slices: 1,
    max_files_per_slice: maxFiles,
    max_windows_per_file: 2,
    target_coverage: {
      roots: false,
      modules: true,
      boundaries: true,
      migrations: true,
      style_clusters: false,
    },
  }).map((window) => ({
    file: window.file,
    lineRange: [window.start_line, window.end_line] as [number, number],
    purpose: window.purpose,
    snippet: window.snippet,
  }));
  const selectedPaths = selectedFiles.map((file) => file.path);
  const contextFingerprint = hash([
    RCCL_SCHEMA_VERSION,
    selectedPaths,
    windows.map((window) => [window.file, window.lineRange, window.snippet]),
  ]);
  const contract: CalibrationContract = {
    schemaVersion: RCCL_SCHEMA_VERSION,
    requestId: `rccl-calibration:${contextFingerprint}`,
    contextFingerprint,
    selectedPaths,
    prompt: buildPrompt(selectedPaths),
    proposalSchema: proposalSchema(),
  };
  return {
    status: 'ready',
    contract,
    context: { files: selectedFiles.length, windows },
  };
}

export function commitCalibration(input: CommitCalibrationInput): CommitCalibrationOutput {
  const projectRoot = resolve(input.projectRoot);
  const parsed = parseCalibrationProposal(input.proposal);
  const proposedCount = parsed.data?.observations.length ?? 0;
  if (!parsed.valid || !parsed.data) return rejected(parsed.diagnostics, proposedCount);

  const issued = prepareCalibration(input);
  const identityDiagnostics = validateIdentity(parsed.data, issued.contract);
  if (identityDiagnostics.length) return rejected(identityDiagnostics, proposedCount);

  const rcclPath = resolve(input.rcclPath ?? join(projectRoot, '.resonant-code', 'rccl.yaml'));
  const existing = loadExistingDocument(rcclPath);
  if (existing.diagnostics.length) return rejected(existing.diagnostics, proposedCount);
  const gitRef = currentGitRef(projectRoot);
  const existingById = new Map(existing.document?.observations.map((observation) => [observation.id, observation]) ?? []);
  const verified = parsed.data.observations.map((proposal) =>
    materializeVerifiedObservation(proposal, projectRoot, gitRef, existingById.get(proposal.id)));
  const verifiedById = new Map(verified.map((observation) => [observation.id, observation]));
  const observations = parsed.data.replace
    ? verified
    : [
        ...(existing.document?.observations ?? []).filter((observation) => !verifiedById.has(observation.id)),
        ...verified,
      ].sort((left, right) => left.id.localeCompare(right.id));
  const document: RcclDocument = {
    version: RCCL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    gitRef,
    observations,
  };
  writeYamlAtomic(rcclPath, document);
  return {
    status: 'committed',
    written: rcclPath,
    document,
    diagnostics: verificationDiagnostics(verified),
    summary: summarize(proposedCount, verified, 0),
  };
}

export function validateContext(input: ValidateContextInput): ValidateContextOutput {
  const projectRoot = resolve(input.projectRoot);
  const rcclPath = resolve(input.rcclPath ?? join(projectRoot, '.resonant-code', 'rccl.yaml'));
  if (!existsSync(rcclPath)) return { status: 'missing', diagnostics: [], changedObservationIds: [] };
  const parsed = parseRcclDocument(readFileSync(rcclPath, 'utf8'));
  if (!parsed.valid || !parsed.data) return { status: 'invalid', diagnostics: parsed.diagnostics, changedObservationIds: [] };
  const gitRef = currentGitRef(projectRoot);
  const observations = parsed.data.observations.map((observation) => refreshObservationEvidence(observation, projectRoot, gitRef));
  const changedObservationIds = observations
    .filter((observation, index) => observation.evidenceVerification.status !== parsed.data!.observations[index].evidenceVerification.status)
    .map((observation) => observation.id);
  const document: RcclDocument = {
    ...parsed.data,
    generatedAt: input.write ? new Date().toISOString() : parsed.data.generatedAt,
    gitRef,
    observations,
  };
  if (input.write) writeYamlAtomic(rcclPath, document);
  return {
    status: 'valid',
    document,
    diagnostics: verificationDiagnostics(observations),
    changedObservationIds,
  };
}

function validateIdentity(
  proposal: { requestId: string; contextFingerprint: string },
  contract: CalibrationContract,
): CalibrationDiagnostic[] {
  const diagnostics: CalibrationDiagnostic[] = [];
  if (proposal.requestId !== contract.requestId) diagnostics.push({ path: 'requestId', code: 'REQUEST_ID_MISMATCH', message: 'Proposal does not match the currently issued calibration request.' });
  if (proposal.contextFingerprint !== contract.contextFingerprint) diagnostics.push({ path: 'contextFingerprint', code: 'CONTEXT_FINGERPRINT_MISMATCH', message: 'Repository context changed; rerun prepare.' });
  return diagnostics;
}

function loadExistingDocument(rcclPath: string): { document?: RcclDocument; diagnostics: CalibrationDiagnostic[] } {
  if (!existsSync(rcclPath)) return { diagnostics: [] };
  const parsed = parseRcclDocument(readFileSync(rcclPath, 'utf8'));
  if (!parsed.valid) return { diagnostics: parsed.diagnostics };
  return { document: parsed.data, diagnostics: [] };
}

function verificationDiagnostics(observations: RcclDocument['observations']): CalibrationDiagnostic[] {
  return observations.flatMap((observation) => {
    if (observation.evidenceVerification.status === 'current') return [];
    return [{
      path: `observations.${observation.id}.evidence`,
      code: `EVIDENCE_${observation.evidenceVerification.status.toUpperCase()}`,
      message: `${observation.evidenceVerification.verifiedCount}/${observation.evidenceVerification.totalCount} evidence references match the current repository.`,
    }];
  });
}

function summarize(
  proposed: number,
  observations: RcclDocument['observations'],
  rejectedCount: number,
): CommitCalibrationOutput['summary'] {
  return {
    proposed,
    accepted: proposed - rejectedCount,
    rejected: rejectedCount,
    current: observations.filter((observation) => observation.evidenceVerification.status === 'current').length,
    partial: observations.filter((observation) => observation.evidenceVerification.status === 'partial').length,
    stale: observations.filter((observation) => observation.evidenceVerification.status === 'stale').length,
    broken: observations.filter((observation) => observation.evidenceVerification.status === 'broken').length,
  };
}

function rejected(diagnostics: CalibrationDiagnostic[], proposed: number): CommitCalibrationOutput {
  return {
    status: 'rejected',
    diagnostics,
    summary: { proposed, accepted: 0, rejected: proposed, current: 0, partial: 0, stale: 0, broken: 0 },
  };
}

function rankFiles<T extends { path: string; role_hints: string[]; exports_count: number; imports_count: number }>(files: T[]): T[] {
  return [...files].sort((left, right) => fileScore(right) - fileScore(left) || left.path.localeCompare(right.path));
}

function fileScore(file: { path: string; role_hints: string[]; exports_count: number; imports_count: number }): number {
  return file.exports_count * 3
    + file.imports_count
    + (file.role_hints.includes('schema-or-migration') ? 20 : 0)
    + (/index\.|runtime|public|api|boundary/.test(file.path) ? 10 : 0)
    - (file.role_hints.includes('test') ? 5 : 0)
    - (file.role_hints.includes('documentation') ? 5 : 0);
}

function overlaps(requested: string, file: string): boolean {
  const path = requested.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return file === path || file.startsWith(`${path}/`) || path.startsWith(`${file}/`);
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))];
}

function currentGitRef(projectRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function writeYamlAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, toYaml(value), 'utf8');
  renameSync(temporary, path);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function buildPrompt(paths: string[]): string {
  return [
    'Propose only repository observations that can change a code implementation or review decision.',
    'Do not summarize metadata, schemas, exports, versions, or facts that a tool can read on demand unless they establish a compatibility or architecture boundary.',
    'For every observation, explain the decision impact and cite exact evidence from the supplied windows.',
    'Prefer zero observations over weak observations.',
    `Selected paths: ${paths.join(', ') || '(none)'}`,
  ].join('\n');
}

function proposalSchema(): string {
  return [
    'schemaVersion: "1.0"',
    'requestId: "<from-contract>"',
    'contextFingerprint: "<from-contract>"',
    'replace: false',
    'observations:',
    '  - id: "obs-kebab-case"',
    '    category: "architecture|constraint|compatibility|legacy|anti-pattern|migration|convention"',
    '    scope: "path/or/glob"',
    '    statement: "observed repository fact"',
    '    affects: ["compatibility"]',
    '    decisionImpact: "how omitting this fact could worsen a code decision"',
    '    semanticConfidence: "low|medium|high"',
    '    reviewStatus: "generated|reviewed"',
    '    evidence:',
    '      - file: "relative/path"',
    '        lineRange: [1, 10]',
    '        snippet: "exact source excerpt"',
  ].join('\n');
}
