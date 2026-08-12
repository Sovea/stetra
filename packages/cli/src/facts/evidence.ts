import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { RepositoryEvidenceInput } from '@sovea/stetra-core';

import { inputError } from '../errors.ts';
import { sha256 } from '../protocol.ts';

export interface RepositoryEvidenceWindow {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
}

export function materializeEvidenceWindows(
  projectRootInput: string,
  windows: RepositoryEvidenceWindow[],
): RepositoryEvidenceInput[] {
  const projectRoot = realpathSync(resolve(projectRootInput));
  return windows.map((window) => materializeEvidenceWindow(projectRoot, window));
}

export function materializeEvidenceWindow(
  projectRoot: string,
  window: RepositoryEvidenceWindow,
): RepositoryEvidenceInput {
  const target = repositoryPath(projectRoot, window.path);
  assertNoSymlinkTraversal(projectRoot, window.path);
  if (!existsSync(target) || !lstatSync(target).isFile()) {
    throw inputError(`Repository evidence ${window.key} requires regular file ${window.path}.`);
  }
  const bytes = readFileSync(target);
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw inputError(`Repository evidence ${window.key} cannot represent non-UTF-8 content at ${window.path}.`);
  }
  const lines = splitLinesPreservingEndings(source);
  if (!Number.isInteger(window.startLine)
    || !Number.isInteger(window.endLine)
    || window.startLine < 1
    || window.endLine < window.startLine
    || window.endLine > lines.length) {
    throw inputError(
      `Repository evidence ${window.key} line range ${window.startLine}-${window.endLine} is outside ${window.path} (${lines.length} lines).`,
    );
  }
  const text = lines.slice(window.startLine - 1, window.endLine).join('');
  return {
    key: window.key,
    path: window.path,
    startLine: window.startLine,
    endLine: window.endLine,
    text,
    digest: sha256(text),
  };
}

function splitLinesPreservingEndings(source: string): string[] {
  if (!source.length) return [];
  const lines: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) {
      lines.push(source.slice(offset));
      break;
    }
    lines.push(source.slice(offset, newline + 1));
    offset = newline + 1;
  }
  return lines;
}

function repositoryPath(projectRoot: string, relativePath: string): string {
  if (!relativePath
    || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw inputError(`Unsafe repository evidence path: ${relativePath}`);
  }
  const target = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, target);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw inputError(`Unsafe repository evidence path: ${relativePath}`);
  }
  return target;
}

function assertNoSymlinkTraversal(projectRoot: string, relativePath: string): void {
  let current = projectRoot;
  const segments = relativePath.split('/');
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw inputError(`Repository evidence may not traverse a symlink: ${relativePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw inputError(`Repository evidence path is not a file path: ${relativePath}`);
    }
  }
}
