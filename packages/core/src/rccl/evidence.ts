import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import type { CalibrationEvidenceSelection } from './types.ts';

export interface EvidenceLike {
  file: string;
  lineRange: [number, number];
  snippet: string;
}

export type EvidenceMatchStatus = 'match' | 'mismatch' | 'file-not-found' | 'range-out-of-bounds' | 'path-outside-project';
export type EvidenceWindowRead =
  | { status: 'match'; snippet: string }
  | { status: Exclude<EvidenceMatchStatus, 'match'> };

export function verifyEvidence(evidence: EvidenceLike, projectRoot: string): { status: EvidenceMatchStatus } {
  const read = readEvidenceWindow(evidence, projectRoot);
  if (read.status !== 'match') return { status: read.status };
  return tokenOverlapSimilarity(read.snippet, evidence.snippet) >= 0.75
    ? { status: 'match' }
    : { status: 'mismatch' };
}

export function readEvidenceWindow(
  selection: CalibrationEvidenceSelection,
  projectRoot: string,
): EvidenceWindowRead {
  if (!safeRelativeEvidencePath(selection.file)) return { status: 'path-outside-project' };
  let root: string;
  try {
    root = realpathSync(resolve(projectRoot));
  } catch {
    return { status: 'path-outside-project' };
  }
  const fullPath = resolve(root, selection.file);
  if (!existsSync(fullPath)) return { status: 'file-not-found' };
  let realFile: string;
  try {
    realFile = realpathSync(fullPath);
  } catch {
    return { status: 'file-not-found' };
  }
  const rel = relative(root, realFile);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    return { status: 'path-outside-project' };
  }
  let content: string;
  try {
    content = readFileSync(realFile, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return { status: 'file-not-found' };
  }
  const lines = content.split('\n');
  const [start, end] = selection.lineRange;
  if (start < 1 || end < start || end > lines.length) return { status: 'range-out-of-bounds' };
  return { status: 'match', snippet: lines.slice(start - 1, end).join('\n') };
}

export function safeRelativeEvidencePath(file: string): boolean {
  if (!file || isAbsolute(file) || win32.isAbsolute(file)) return false;
  const normalized = file.replace(/\\/g, '/');
  return !normalized.split('/').some((segment) => segment === '..') && !normalized.startsWith('/');
}

function tokenOverlapSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const counts = new Map<string, number>();
  for (const token of leftTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of rightTokens) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(token, count - 1);
    }
  }
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function tokenize(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/['"`]/g, '"').replace(/\s+/g, ' ').trim()
    .match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|&&|\|\||[()[\]{}.,;:+\-*/%<>!=?]/g) ?? [];
}
