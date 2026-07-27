import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_OUTPUT_PREFIXES = [
  '.resonant-code/context/',
  '.resonant-code/feedback/',
];
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

export function captureGitWorktree(projectRoot) {
  const root = realpathSync(resolve(projectRoot));
  const gitPrefix = runGitText(root, ['rev-parse', '--show-prefix']);
  if (gitPrefix !== '') {
    const gitRoot = runGitText(root, ['rev-parse', '--show-toplevel']);
    throw new Error(
      `Trusted change collection requires project root to equal the Git worktree root. Expected ${gitRoot}, received ${root}.`,
    );
  }

  const listed = runGitBuffer(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const paths = parseNullSeparatedPaths(listed)
    .filter((path) => !WORKFLOW_OUTPUT_PREFIXES.some((prefix) =>
      path === prefix.slice(0, -1) || path.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right));
  const entries = [];
  for (const path of paths) {
    const absolutePath = resolve(root, path);
    const stat = lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      throw new Error(
        `Trusted change collection does not support Git submodule/gitlink path "${path}" in the MVP.`,
      );
    }
    if (stat.isSymbolicLink()) {
      entries.push({
        path,
        kind: 'symlink',
        contentHash: hashBuffer(Buffer.from(readlinkSync(absolutePath))),
        mode: '120000',
      });
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Trusted change collection supports only files and symlinks: ${path}.`);
    }
    entries.push({
      path,
      kind: 'file',
      contentHash: hashBuffer(readFileSync(absolutePath)),
      mode: stat.mode & 0o111 ? '100755' : '100644',
    });
  }
  const head = readHead(root);
  return {
    schemaVersion: '1.0',
    source: 'git-worktree',
    capturedAt: new Date().toISOString(),
    head,
    entries,
    fingerprint: stableHash([head, entries]),
  };
}

export function compareGitWorktrees(baseline, current) {
  assertSnapshot(baseline, 'baseline');
  assertSnapshot(current, 'current');
  const beforeByPath = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  const deleted = [];
  const added = [];
  const modified = [];

  for (const [path, before] of beforeByPath) {
    const after = afterByPath.get(path);
    if (!after) {
      deleted.push({ path, fact: fileFact(before) });
      continue;
    }
    if (!sameFact(before, after)) {
      modified.push({
        path,
        status: 'modified',
        before: fileFact(before),
        after: fileFact(after),
      });
    }
  }
  for (const [path, after] of afterByPath) {
    if (!beforeByPath.has(path)) added.push({ path, fact: fileFact(after) });
  }

  const deletedByContent = groupByContent(deleted);
  const addedByContent = groupByContent(added);
  const renamedDeleted = new Set();
  const renamedAdded = new Set();
  const renamed = [];
  for (const [key, deletedMatches] of deletedByContent) {
    const addedMatches = addedByContent.get(key) ?? [];
    if (deletedMatches.length !== 1 || addedMatches.length !== 1) continue;
    const prior = deletedMatches[0];
    const next = addedMatches[0];
    renamedDeleted.add(prior.path);
    renamedAdded.add(next.path);
    renamed.push({
      path: next.path,
      status: 'renamed',
      previousPath: prior.path,
      before: prior.fact,
      after: next.fact,
    });
  }

  const files = [
    ...modified,
    ...renamed,
    ...deleted
      .filter((item) => !renamedDeleted.has(item.path))
      .map((item) => ({
        path: item.path,
        status: 'deleted',
        before: item.fact,
      })),
    ...added
      .filter((item) => !renamedAdded.has(item.path))
      .map((item) => ({
        path: item.path,
        status: 'added',
        after: item.fact,
      })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const changeFingerprint = stableHash([files]);
  const collectionId = stableHash([
    baseline.fingerprint,
    current.fingerprint,
    changeFingerprint,
  ]);
  return {
    files,
    baselineFingerprint: baseline.fingerprint,
    currentFingerprint: current.fingerprint,
    changeFingerprint,
    baselineHead: baseline.head,
    currentHead: current.head,
    provenance: {
      source: 'resonant-code-workflow',
      collectionId,
    },
  };
}

export function summarizeWorktreeSnapshot(snapshot) {
  assertSnapshot(snapshot, 'worktree');
  return {
    source: snapshot.source,
    head: snapshot.head,
    fingerprint: snapshot.fingerprint,
    entryCount: snapshot.entries.length,
    capturedAt: snapshot.capturedAt,
  };
}

export function stableFactHash(parts) {
  return stableHash(parts);
}

function assertSnapshot(value, label) {
  if (!value
    || value.schemaVersion !== '1.0'
    || value.source !== 'git-worktree'
    || !Array.isArray(value.entries)
    || (value.head !== null && typeof value.head !== 'string')) {
    throw new Error(`Invalid ${label} Git worktree snapshot; rerun prepare.`);
  }
  const entries = [...value.entries].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(entries) !== JSON.stringify(value.entries)) {
    throw new Error(`Invalid ${label} Git worktree snapshot ordering; rerun prepare.`);
  }
  if (value.fingerprint !== stableHash([value.head, value.entries])) {
    throw new Error(`Invalid ${label} Git worktree snapshot fingerprint; rerun prepare.`);
  }
}

function parseNullSeparatedPaths(value) {
  const paths = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) continue;
    const bytes = value.subarray(start, index);
    start = index + 1;
    if (!bytes.length) continue;
    const path = bytes.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(bytes)) {
      throw new Error('Trusted change collection cannot represent a non-UTF-8 Git path.');
    }
    assertSafeGitPath(path);
    paths.push(path);
  }
  if (start !== value.length) throw new Error('Git returned a malformed NUL-separated path list.');
  return [...new Set(paths)];
}

function assertSafeGitPath(path) {
  if (!path
    || path.startsWith('/')
    || /^[A-Za-z]:\//.test(path)
    || path.split('/').some((segment) => !segment || segment === '..')
    || path.includes('\0')) {
    throw new Error(`Git returned an unsafe repository-relative path: ${JSON.stringify(path)}.`);
  }
}

function groupByContent(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([
      item.fact.kind,
      item.fact.contentHash,
      item.fact.mode,
    ]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function fileFact(entry) {
  return {
    kind: entry.kind,
    contentHash: entry.contentHash,
    mode: entry.mode,
  };
}

function sameFact(left, right) {
  return left.kind === right.kind
    && left.contentHash === right.contentHash
    && left.mode === right.mode;
}

function readHead(root) {
  try {
    return runGitText(root, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    return null;
  }
}

function runGitText(root, args) {
  return runGitBuffer(root, args).toString('utf8').trim();
}

function runGitBuffer(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'buffer',
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to collect Git worktree facts (${args.join(' ')}): ${message}`);
  }
}

function stableHash(parts) {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 16);
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex');
}
