import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';

export interface EvidenceLike {
  file: string;
  lineRange: [number, number];
  snippet: string;
}

export type EvidenceMatchStatus = 'match' | 'mismatch' | 'file-not-found' | 'range-out-of-bounds' | 'path-outside-project';

export function verifyEvidence(evidence: EvidenceLike, projectRoot: string): { status: EvidenceMatchStatus } {
  if (!safeRelativeEvidencePath(evidence.file)) return { status: 'path-outside-project' };
  const root = realpathSync(resolve(projectRoot));
  const fullPath = resolve(root, evidence.file);
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
  const lines = readFileSync(realFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const [start, end] = evidence.lineRange;
  if (start < 1 || end < start || end > lines.length) return { status: 'range-out-of-bounds' };
  const actual = lines.slice(start - 1, end).join('\n');
  return tokenOverlapSimilarity(actual, evidence.snippet) >= 0.75 ? { status: 'match' } : { status: 'mismatch' };
}

function safeRelativeEvidencePath(file: string): boolean {
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
