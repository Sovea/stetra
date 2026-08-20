/** Explicit local verification-input capture, including ignored generated files. */
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { posix, relative, resolve } from 'node:path';

import type {
  VerificationDefinition,
  VerificationInputEntryFact,
  VerificationInputSelectorFact,
  VerificationInputSnapshot,
} from '@sovea/stetra-core';

import { sha256, stableFingerprint } from '../protocol.ts';

const MAX_CAPTURED_ENTRIES = 100_000;
const MAX_CAPTURED_BYTES = 256 * 1024 * 1024;

export function captureVerificationInputs(
  projectRootInput: string,
  definitions: VerificationDefinition[],
): VerificationInputSnapshot[] {
  const projectRoot = realpathSync(resolve(projectRootInput));
  return [...definitions]
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId))
    .map((definition) => captureDefinitionInputs(projectRoot, definition));
}

export function verificationInputSetFingerprint(
  snapshots: VerificationInputSnapshot[],
): string {
  return stableFingerprint(snapshots.map((snapshot) => ({
    definitionId: snapshot.definitionId,
    fingerprint: snapshot.fingerprint,
  })));
}

function captureDefinitionInputs(
  projectRoot: string,
  definition: VerificationDefinition,
): VerificationInputSnapshot {
  const inputs = definition.executionInputs.map((selector) =>
    captureSelector(projectRoot, selector));
  const projection = {
    definitionId: definition.definitionId,
    inputs,
  };
  return {
    ...projection,
    capturedAt: new Date().toISOString(),
    fingerprint: stableFingerprint(projection),
  };
}

function captureSelector(
  projectRoot: string,
  selector: VerificationDefinition['executionInputs'][number],
): VerificationInputSelectorFact {
  assertOutsideStetraState(selector.path);
  const absolute = resolve(projectRoot, selector.path);
  assertInsideProject(projectRoot, absolute, selector.path);
  const rootStat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!rootStat) return selectorFact(selector, 'missing', []);
  if (selector.kind === 'file') {
    if (!rootStat.isFile() && !rootStat.isSymbolicLink()) {
      throw new Error(`Verification execution input ${selector.path} must be a file or symlink.`);
    }
    return selectorFact(selector, 'present', [entryFact(projectRoot, absolute)]);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Verification execution input ${selector.path} must be a directory tree.`);
  }
  const entries: VerificationInputEntryFact[] = [];
  let observedBytes = 0;
  const pending = [absolute];
  while (pending.length) {
    const directory = pending.pop()!;
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const childPath = resolve(directory, child.name);
      if (child.isDirectory()) {
        pending.push(childPath);
        continue;
      }
      if (!child.isFile() && !child.isSymbolicLink()) {
        throw new Error(
          `Verification execution input ${selector.path} contains unsupported entry ${repositoryPath(projectRoot, childPath)}.`,
        );
      }
      const entry = entryFact(projectRoot, childPath);
      entries.push(entry);
      observedBytes += entry.byteLength;
      if (entries.length > MAX_CAPTURED_ENTRIES || observedBytes > MAX_CAPTURED_BYTES) {
        throw new Error(
          `Verification execution input ${selector.path} exceeds the explicit capture limit; narrow the selector.`,
        );
      }
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return selectorFact(selector, 'present', entries);
}

function selectorFact(
  selector: VerificationDefinition['executionInputs'][number],
  state: VerificationInputSelectorFact['state'],
  entries: VerificationInputEntryFact[],
): VerificationInputSelectorFact {
  const projection = { selector, state, entries };
  return { ...projection, fingerprint: stableFingerprint(projection) };
}

function entryFact(projectRoot: string, absolutePath: string): VerificationInputEntryFact {
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    const target = Buffer.from(readlinkSync(absolutePath));
    return {
      path: repositoryPath(projectRoot, absolutePath),
      kind: 'symlink',
      contentDigest: sha256(target),
      mode: '120000',
      byteLength: target.length,
    };
  }
  const content = readFileSync(absolutePath);
  return {
    path: repositoryPath(projectRoot, absolutePath),
    kind: 'file',
    contentDigest: sha256(content),
    mode: stat.mode & 0o111 ? '100755' : '100644',
    byteLength: content.length,
  };
}

function repositoryPath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

function assertInsideProject(projectRoot: string, absolutePath: string, source: string): void {
  const relativePath = repositoryPath(projectRoot, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')
    || posix.isAbsolute(relativePath)) {
    throw new Error(`Verification execution input ${source} escapes the project root.`);
  }
}

function assertOutsideStetraState(path: string): void {
  if (path === '.git' || path.startsWith('.git/')
    || path === '.stetra' || path.startsWith('.stetra/')) {
    throw new Error(`Verification execution input ${path} cannot select Git or Stetra state.`);
  }
}
