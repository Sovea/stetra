import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import ignore from 'ignore';
import type { IndexedFile, RepoIndexReport } from '../types.ts';

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Map([
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.py', 'python'], ['.go', 'go'], ['.rs', 'rust'], ['.java', 'java'], ['.kt', 'kotlin'], ['.swift', 'swift'], ['.vue', 'vue'], ['.svelte', 'svelte'], ['.astro', 'astro'],
  ['.json', 'config'], ['.yaml', 'config'], ['.yml', 'config'], ['.toml', 'config'], ['.ini', 'config'], ['.md', 'documentation'], ['.mdx', 'documentation'], ['.sql', 'schema'], ['.graphql', 'schema'], ['.proto', 'schema'], ['.tf', 'infra'],
]);
const SPECIAL_FILES = new Set(['Dockerfile', 'Makefile', 'README', 'LICENSE', 'SECURITY', 'CONTRIBUTING', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'go.mod', 'go.sum']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '__pycache__', 'vendor', 'target']);

export function buildRepoIndex(projectRoot: string, scopeGlob = 'auto'): { files: IndexedFile[]; report: RepoIndexReport } {
  const candidates = discoverFiles(projectRoot);
  const scoped = (scopeGlob === 'auto' ? candidates : candidates.filter((file) => matchScope(file, scopeGlob))).sort();
  const report: RepoIndexReport = { discovered_files: scoped.length, indexed_files: 0, read_bytes: 0, skipped_oversize: 0, skipped_unsupported: 0, truncated: [] };
  const files: IndexedFile[] = [];
  for (const file of scoped) {
    if (files.length >= MAX_FILES) {
      report.truncated.push('file-count-limit');
      break;
    }
    if (!isSupported(file)) {
      report.skipped_unsupported += 1;
      continue;
    }
    const full = join(projectRoot, file);
    let size = 0;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) {
      report.skipped_oversize += 1;
      continue;
    }
    if (report.read_bytes + size > MAX_TOTAL_BYTES) {
      report.truncated.push('total-read-limit');
      break;
    }
    const indexed = indexFile(projectRoot, file);
    report.read_bytes += size;
    if (indexed) files.push(indexed);
  }
  report.indexed_files = files.length;
  report.truncated = [...new Set(report.truncated)];
  return { files, report };
}

function discoverFiles(projectRoot: string): string[] {
  if (existsSync(join(projectRoot, '.git'))) {
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return output.split('\0').filter(Boolean).map(normalize).filter(inScopeGeneratedPolicy);
    } catch { /* fall through to non-git walker */ }
  }
  const matcher = ignore();
  const ignorePath = join(projectRoot, '.gitignore');
  if (existsSync(ignorePath)) matcher.add(readFileSync(ignorePath, 'utf8'));
  return walkDir(projectRoot, projectRoot, matcher);
}

function walkDir(dir: string, projectRoot: string, matcher: ReturnType<typeof ignore>): string[] {
  const results: string[] = [];
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = normalize(relative(projectRoot, full));
    if (matcher.ignores(rel) || !inScopeGeneratedPolicy(rel)) continue;
    if (entry.isDirectory()) results.push(...walkDir(full, projectRoot, matcher));
    else if (entry.isFile()) results.push(rel);
  }
  return results;
}

function inScopeGeneratedPolicy(file: string): boolean {
  const segments = normalize(file).split('/');
  return !file.startsWith('.resonant-code/context/')
    && !file.startsWith('.git/')
    && !segments.some((segment) => IGNORE_DIRS.has(segment));
}

function isSupported(file: string): boolean {
  const name = basename(file);
  return SOURCE_EXTENSIONS.has(extname(name).toLowerCase()) || SPECIAL_FILES.has(name) || /(^|\/)(README|ADR)[^/]*$/i.test(file) || /(^|\/)\.github\/workflows\//.test(file);
}

function matchScope(file: string, scopeGlob: string): boolean {
  if (scopeGlob === '**' || scopeGlob === '**/*') return true;
  if (scopeGlob.endsWith('/**')) return file.startsWith(scopeGlob.slice(0, -3));
  if (scopeGlob.includes('*')) {
    const escaped = scopeGlob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return file === scopeGlob || file.startsWith(`${scopeGlob}/`);
}

function indexFile(projectRoot: string, file: string): IndexedFile | null {
  try {
    const content = readFileSync(join(projectRoot, file), 'utf-8').replace(/\r\n/g, '\n');
    const lines = content.split('\n');
    const language = SOURCE_EXTENSIONS.get(extname(file).toLowerCase()) ?? inferSpecialRole(file);
    const imports = content.match(/\b(import|require|from)\b/g)?.length ?? 0;
    const exports = content.match(/\b(export|module\.exports|pub\s+|func\s+[A-Z]|class\s+)\b/g)?.length ?? 0;
    const symbols = content.match(/\b(function|class|interface|type|const|let|var|def|fn|struct|enum|trait)\b/g)?.length ?? 0;
    return {
      path: file,
      language,
      lines: lines.length,
      is_test: /(^|\/)(__tests__\/|test\/|tests\/)|\.(test|spec)\./.test(file),
      is_generated: /(^|\/)(generated|gen)(\/|\.)/.test(file),
      package_root: file.split('/')[0] || '.',
      imports_count: imports,
      exports_count: exports,
      symbol_density: lines.length === 0 ? 0 : Number((symbols / lines.length).toFixed(3)),
      role_hints: inferRoleHints(file),
    };
  } catch { return null; }
}

function inferSpecialRole(file: string): string {
  if (/readme|adr|\.mdx?$/i.test(file)) return 'documentation';
  if (/docker|\.tf$|infra|deploy/i.test(file)) return 'infra';
  return 'config';
}

function inferRoleHints(file: string): string[] {
  return [
    ...(/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./.test(file) ? ['test'] : []),
    ...(/(^|\/)(config|\.github)(\/|$)|\.(json|ya?ml|toml|ini)$/.test(file) ? ['config'] : []),
    ...(/readme|adr|\.mdx?$/i.test(file) ? ['documentation'] : []),
    ...(/schema|migration|\.sql$|\.proto$|\.graphql$/.test(file) ? ['schema-or-migration'] : []),
    ...(/docker|infra|deploy|\.tf$/.test(file) ? ['infra'] : []),
  ];
}

function normalize(value: string): string { return value.replace(/\\/g, '/'); }
