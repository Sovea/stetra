import { globCanMatchDescendant, minimatch } from './glob.ts';

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

export function pathMatchesScope(path: string, scope: string): boolean {
  if (scope === '*' || scope === '**' || scope === '**/*') return true;
  if (scope.includes('*') || scope.includes('?') || scope.includes('{')) return minimatch(path, scope);
  const normalizedScope = scope.replace(/\/$/, '');
  return path === normalizedScope || path.startsWith(`${normalizedScope}/`);
}

export function scopeOverlapsPath(scope: string, path: string): boolean {
  const normalizedScope = normalizePath(scope);
  const normalizedPath = normalizePath(path);
  return pathMatchesScope(normalizedPath, normalizedScope)
    || pathMatchesScope(normalizedScope, normalizedPath)
    || (hasGlobSyntax(normalizedScope)
      && globCanMatchDescendant(normalizedScope, normalizedPath));
}

export function fileOverlapsTarget(file: string, target: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedTarget = normalizePath(target);
  return normalizedFile === normalizedTarget
    || pathMatchesScope(normalizedFile, normalizedTarget)
    || pathMatchesScope(normalizedTarget, normalizedFile);
}

function hasGlobSyntax(value: string): boolean {
  return value.includes('*') || value.includes('?') || value.includes('{');
}
