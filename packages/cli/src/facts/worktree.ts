/** Git-backed baseline and actual-change collection for the Semantic Handoff protocol. */
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import type {
  ChangedFileFact,
  FileContentFact,
  WorktreeSummary,
} from '@sovea/stetra-core';

import { runBufferedCommand } from '../infrastructure/process.ts';
import { sha256, stableFingerprint } from '../protocol.ts';

const WORKFLOW_OUTPUT_PREFIX = '.stetra/runs/';
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;
const GITLINK_MODE = '160000';
const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface WorktreeEntry {
  path: string;
  kind: 'file' | 'symlink' | 'gitlink';
  contentDigest: string;
  mode: string;
}

export interface WorktreeSnapshot {
  source: 'git-worktree-tree';
  capturedAt: string;
  head: string | null;
  treeId: string;
  entries: WorktreeEntry[];
  fingerprint: string;
}

export interface CollectedWorktreeChange {
  current: WorktreeSnapshot;
  changedFiles: ChangedFileFact[];
  changeFingerprint: string;
  patch: Buffer;
}

export interface WorktreeCaptureOptions {
  objectDirectory?: string;
}

export async function captureGitWorktree(
  projectRootInput: string,
  options: WorktreeCaptureOptions = {},
): Promise<WorktreeSnapshot> {
  const projectRoot = realpathSync(resolve(projectRootInput));
  await assertGitRoot(projectRoot);
  const ephemeralRoot = options.objectDirectory
    ? undefined
    : mkdtempSync(join(tmpdir(), 'stetra-objects-'));
  const objectDirectory = realpathOrResolved(options.objectDirectory ?? ephemeralRoot!);
  mkdirSync(objectDirectory, { recursive: true });
  try {
    const objectEnv = await gitObjectEnvironment(projectRoot, objectDirectory);
    const head = await readHead(projectRoot);
    const treeId = await createWorktreeTree(projectRoot, head, objectEnv);
    const [listed, staged] = await Promise.all([
      runGitBuffer(projectRoot, [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ]),
      runGitBuffer(projectRoot, ['ls-files', '-z', '--stage']),
    ]);
    const indexEntries = parseIndexEntries(staged);
    const paths = parseNullSeparatedPaths(listed)
      .filter((path) => path !== WORKFLOW_OUTPUT_PREFIX.slice(0, -1)
        && !path.startsWith(WORKFLOW_OUTPUT_PREFIX))
      .sort((left, right) => left.localeCompare(right));
    const entries: WorktreeEntry[] = [];
    for (const path of paths) {
      const indexEntry = indexEntries.get(path);
      if (indexEntry?.mode === GITLINK_MODE) {
        const objectId = await readGitlinkObjectId(
          projectRoot,
          path,
          indexEntry.objectId,
        );
        entries.push({
          path,
          kind: 'gitlink',
          contentDigest: sha256(objectId),
          mode: GITLINK_MODE,
        });
        continue;
      }
      const absolutePath = resolve(projectRoot, path);
      const stat = lstatSync(absolutePath, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) {
        throw new Error(`Worktree collection encountered a non-Git-link directory at ${path}.`);
      }
      if (stat.isSymbolicLink()) {
        entries.push({
          path,
          kind: 'symlink',
          contentDigest: sha256(Buffer.from(readlinkSync(absolutePath))),
          mode: '120000',
        });
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Worktree collection supports only files, symlinks, and Git links: ${path}.`);
      }
      entries.push({
        path,
        kind: 'file',
        contentDigest: sha256(readFileSync(absolutePath)),
        mode: stat.mode & 0o111 ? '100755' : '100644',
      });
    }
    const projection = { head, treeId, entries };
    return {
      source: 'git-worktree-tree',
      capturedAt: new Date().toISOString(),
      ...projection,
      fingerprint: stableFingerprint(projection),
    };
  } finally {
    if (ephemeralRoot) rmSync(ephemeralRoot, { recursive: true, force: true });
  }
}

export async function collectGitWorktreeChange(
  projectRoot: string,
  baseline: WorktreeSnapshot,
  options: { objectDirectory: string },
): Promise<CollectedWorktreeChange> {
  assertWorktreeSnapshot(baseline, 'prepared baseline');
  const current = await captureGitWorktree(projectRoot, options);
  const objectEnv = await gitObjectEnvironment(projectRoot, options.objectDirectory);
  const binaryPaths = await collectBinaryPaths(
    projectRoot,
    baseline.treeId,
    current.treeId,
    objectEnv,
  );
  const changedFiles = compareGitWorktrees(baseline, current, binaryPaths);
  const patch = await collectPatch(projectRoot, baseline.treeId, current.treeId, objectEnv);
  return {
    current,
    changedFiles,
    changeFingerprint: stableFingerprint(changedFiles),
    patch,
  };
}

export function compareGitWorktrees(
  baseline: WorktreeSnapshot,
  current: WorktreeSnapshot,
  binaryPaths: Set<string> = new Set(),
): ChangedFileFact[] {
  assertWorktreeSnapshot(baseline, 'baseline');
  assertWorktreeSnapshot(current, 'current');
  const beforeByPath = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  const deleted: Array<{ path: string; fact: FileContentFact }> = [];
  const added: Array<{ path: string; fact: FileContentFact }> = [];
  const modified: ChangedFileFact[] = [];

  for (const [path, before] of beforeByPath) {
    const after = afterByPath.get(path);
    if (!after) {
      deleted.push({ path, fact: fileFact(before) });
    } else if (!sameFact(before, after)) {
      modified.push(changedFile({
        path,
        operation: 'modified',
        before: fileFact(before),
        after: fileFact(after),
        representation: representation(before, after, binaryPaths.has(path)),
      }));
    }
  }
  for (const [path, after] of afterByPath) {
    if (!beforeByPath.has(path)) added.push({ path, fact: fileFact(after) });
  }

  const deletedByContent = groupByContent(deleted);
  const addedByContent = groupByContent(added);
  const renamedDeleted = new Set<string>();
  const renamedAdded = new Set<string>();
  const renamed: ChangedFileFact[] = [];
  for (const [key, deletedMatches] of deletedByContent) {
    const addedMatches = addedByContent.get(key) ?? [];
    if (deletedMatches.length !== 1 || addedMatches.length !== 1) continue;
    const prior = deletedMatches[0];
    const next = addedMatches[0];
    renamedDeleted.add(prior.path);
    renamedAdded.add(next.path);
    renamed.push(changedFile({
      path: next.path,
      operation: 'renamed',
      previousPath: prior.path,
      before: prior.fact,
      after: next.fact,
      representation: representation(
        prior.fact,
        next.fact,
        binaryPaths.has(prior.path) || binaryPaths.has(next.path),
      ),
    }));
  }

  return [
    ...modified,
    ...renamed,
    ...deleted
      .filter((item) => !renamedDeleted.has(item.path))
      .map((item) => changedFile({
        path: item.path,
        operation: 'deleted',
        before: item.fact,
        representation: representation(item.fact, undefined, binaryPaths.has(item.path)),
      })),
    ...added
      .filter((item) => !renamedAdded.has(item.path))
      .map((item) => changedFile({
        path: item.path,
        operation: 'added',
        after: item.fact,
        representation: representation(undefined, item.fact, binaryPaths.has(item.path)),
      })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function summarizeWorktree(snapshot: WorktreeSnapshot): WorktreeSummary {
  assertWorktreeSnapshot(snapshot, 'worktree');
  return {
    head: snapshot.head,
    fingerprint: snapshot.fingerprint,
    entryCount: snapshot.entries.length,
    capturedAt: snapshot.capturedAt,
  };
}

export function assertWorktreeSnapshot(value: unknown, label: string): asserts value is WorktreeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} worktree snapshot; rerun prepare.`);
  }
  const snapshot = value as WorktreeSnapshot;
  if (snapshot.source !== 'git-worktree-tree'
    || (snapshot.head !== null && typeof snapshot.head !== 'string')
    || !GIT_OBJECT_ID_PATTERN.test(snapshot.treeId)
    || !Array.isArray(snapshot.entries)
    || typeof snapshot.capturedAt !== 'string') {
    throw new Error(`Invalid ${label} worktree snapshot; rerun prepare.`);
  }
  const ordered = [...snapshot.entries].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(ordered) !== JSON.stringify(snapshot.entries)
    || snapshot.fingerprint !== stableFingerprint({
      head: snapshot.head,
      treeId: snapshot.treeId,
      entries: snapshot.entries,
    })) {
    throw new Error(`Invalid ${label} worktree snapshot fingerprint; rerun prepare.`);
  }
}

async function createWorktreeTree(
  projectRoot: string,
  head: string | null,
  objectEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'stetra-index-'));
  const indexPath = join(temporaryRoot, 'index');
  const env = { ...objectEnv, GIT_INDEX_FILE: indexPath };
  try {
    await runGitBuffer(projectRoot, head ? ['read-tree', head] : ['read-tree', '--empty'], env);
    await runGitBuffer(projectRoot, ['add', '-A', '--', '.'], env);
    await runGitBuffer(projectRoot, [
      'rm',
      '-r',
      '--cached',
      '--ignore-unmatch',
      '--',
      '.stetra/runs',
    ], env);
    const treeId = (await runGitBuffer(projectRoot, ['write-tree'], env)).toString('ascii').trim();
    if (!GIT_OBJECT_ID_PATTERN.test(treeId)) {
      throw new Error('Git returned an invalid worktree tree identity.');
    }
    return treeId;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function collectPatch(
  projectRoot: string,
  beforeTree: string,
  afterTree: string,
  env: NodeJS.ProcessEnv,
): Promise<Buffer> {
  return runGitBuffer(projectRoot, [
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    '--no-renames',
    beforeTree,
    afterTree,
    '--',
  ], env);
}

async function collectBinaryPaths(
  projectRoot: string,
  beforeTree: string,
  afterTree: string,
  env: NodeJS.ProcessEnv,
): Promise<Set<string>> {
  const output = await runGitBuffer(projectRoot, [
    'diff',
    '--numstat',
    '-z',
    '--no-renames',
    beforeTree,
    afterTree,
    '--',
  ], env);
  const binaryPaths = new Set<string>();
  for (const record of splitNullRecords(output)) {
    const firstTab = record.indexOf(9);
    const secondTab = firstTab < 0 ? -1 : record.indexOf(9, firstTab + 1);
    if (firstTab < 0 || secondTab < 0) throw new Error('Git returned malformed binary change metadata.');
    const added = record.subarray(0, firstTab).toString('ascii');
    const deleted = record.subarray(firstTab + 1, secondTab).toString('ascii');
    const pathBytes = record.subarray(secondTab + 1);
    const path = utf8GitPath(pathBytes);
    if (added === '-' && deleted === '-') binaryPaths.add(path);
  }
  return binaryPaths;
}

async function gitObjectEnvironment(
  projectRoot: string,
  objectDirectoryInput: string,
): Promise<NodeJS.ProcessEnv> {
  const objectDirectory = realpathOrResolved(objectDirectoryInput);
  mkdirSync(objectDirectory, { recursive: true });
  const commonDirectoryValue = (await runGitBuffer(
    projectRoot,
    ['rev-parse', '--git-common-dir'],
    repositoryGitEnvironment(),
  )).toString('utf8').trim();
  if (!commonDirectoryValue) {
    throw new Error('Git did not return a common metadata directory.');
  }
  const commonDirectory = isAbsolute(commonDirectoryValue)
    ? commonDirectoryValue
    : resolve(projectRoot, commonDirectoryValue);
  const repositoryObjects = resolve(commonDirectory, 'objects');
  const inheritedAlternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return {
    ...process.env,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [repositoryObjects, inheritedAlternates]
      .filter((value): value is string => Boolean(value))
      .join(delimiter),
  };
}

function repositoryGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  return env;
}

function realpathOrResolved(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

async function assertGitRoot(projectRoot: string): Promise<void> {
  const prefix = (await runGitBuffer(projectRoot, ['rev-parse', '--show-prefix'])).toString('utf8').trim();
  if (!prefix) return;
  const expected = (await runGitBuffer(projectRoot, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  throw new Error(`Project root must equal the Git worktree root. Expected ${expected}, received ${projectRoot}.`);
}

async function readHead(projectRoot: string): Promise<string | null> {
  const result = await runBufferedCommand({
    file: 'git',
    args: ['-C', projectRoot, 'rev-parse', '--verify', 'HEAD'],
    cwd: projectRoot,
    maxBuffer: 1024,
  });
  if (result.failed) return null;
  const head = result.stdout.toString('ascii').trim();
  return GIT_OBJECT_ID_PATTERN.test(head) ? head : null;
}

async function readGitlinkObjectId(
  projectRoot: string,
  path: string,
  indexObjectId: string,
): Promise<string> {
  const absolutePath = resolve(projectRoot, path);
  const stat = lstatSync(absolutePath, { throwIfNoEntry: false });
  const gitDirectory = lstatSync(resolve(absolutePath, '.git'), { throwIfNoEntry: false });
  if (!stat?.isDirectory() || !gitDirectory) return indexObjectId;
  const result = await runBufferedCommand({
    file: 'git',
    args: ['-C', absolutePath, 'rev-parse', '--verify', 'HEAD^{commit}'],
    cwd: projectRoot,
    maxBuffer: 1024,
  });
  if (result.failed) return indexObjectId;
  const objectId = result.stdout.toString('ascii').trim();
  return GIT_OBJECT_ID_PATTERN.test(objectId) ? objectId : indexObjectId;
}

async function runGitBuffer(
  projectRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<Buffer> {
  const result = await runBufferedCommand({
    file: 'git',
    args: ['-C', projectRoot, ...args],
    cwd: projectRoot,
    env,
    maxBuffer: GIT_OUTPUT_LIMIT,
  });
  if (result.failed) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(
      `Failed to collect Git worktree facts (${args.join(' ')}): `
      + `${stderr || result.message || result.exitCode || result.signal || 'unknown failure'}`,
    );
  }
  return result.stdout;
}

function parseNullSeparatedPaths(value: Buffer): string[] {
  return [...new Set(splitNullRecords(value).map(utf8GitPath))];
}

function splitNullRecords(value: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) continue;
    if (index > start) records.push(value.subarray(start, index));
    start = index + 1;
  }
  if (start !== value.length) throw new Error('Git returned malformed NUL-separated output.');
  return records;
}

function parseIndexEntries(value: Buffer): Map<string, { mode: string; objectId: string }> {
  const entries = new Map<string, { mode: string; objectId: string }>();
  for (const record of splitNullRecords(value)) {
    const separator = record.indexOf(9);
    if (separator < 0) throw new Error('Git returned a malformed stage entry.');
    const header = record.subarray(0, separator).toString('ascii');
    const match = /^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-3])$/.exec(header);
    if (!match) throw new Error('Git returned a malformed stage entry header.');
    if (match[3] !== '0') continue;
    const path = utf8GitPath(record.subarray(separator + 1));
    entries.set(path, { mode: match[1], objectId: match[2] });
  }
  return entries;
}

function utf8GitPath(bytes: Buffer): string {
  const path = bytes.toString('utf8');
  if (!Buffer.from(path, 'utf8').equals(bytes)
    || !path
    || path.startsWith('/')
    || /^[A-Za-z]:\//.test(path)
    || path.split('/').some((segment) => !segment || segment === '..')
    || path.includes('\0')) {
    throw new Error(`Git returned an unsafe or non-UTF-8 repository path: ${JSON.stringify(path)}.`);
  }
  return path;
}

function groupByContent(
  items: Array<{ path: string; fact: FileContentFact }>,
): Map<string, Array<{ path: string; fact: FileContentFact }>> {
  const groups = new Map<string, Array<{ path: string; fact: FileContentFact }>>();
  for (const item of items) {
    const key = JSON.stringify([item.fact.kind, item.fact.contentDigest, item.fact.mode]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function fileFact(entry: WorktreeEntry): FileContentFact {
  return {
    kind: entry.kind,
    contentDigest: entry.contentDigest,
    mode: entry.mode,
  };
}

function sameFact(left: WorktreeEntry, right: WorktreeEntry): boolean {
  return left.kind === right.kind
    && left.contentDigest === right.contentDigest
    && left.mode === right.mode;
}

function representation(
  before: FileContentFact | undefined,
  after: FileContentFact | undefined,
  binary: boolean,
): ChangedFileFact['representation'] {
  if (binary) return 'binary';
  const kind = after?.kind ?? before?.kind;
  if (kind !== 'file') return 'metadata-only';
  if (before && after && before.contentDigest === after.contentDigest) return 'metadata-only';
  return 'text';
}

function changedFile(
  value: Omit<ChangedFileFact, 'id'>,
): ChangedFileFact {
  const identity = stableFingerprint([
    value.operation,
    value.previousPath ?? null,
    value.path,
  ]).slice('sha256:'.length);
  return { id: `file:${identity}`, ...value };
}
