import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { applyEdits, createScanner, modify, parse, parseTree, SyntaxKind, type Node as JsonNode, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { StetraError } from '../runtime/shared.js';

import type { InstallArtifact } from './artifacts.js';

const markersSchema = z.object({ start: z.string().min(1), end: z.string().min(1) }).strict();
const baseArtifact = { path: z.string().min(1), generatedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) };
const storedArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseArtifact, kind: z.literal('file') }).strict(),
  z.object({ ...baseArtifact, kind: z.literal('block'), markers: markersSchema }).strict(),
  z.object({ ...baseArtifact, kind: z.literal('hook'), event: z.string().min(1), group: z.record(z.string(), z.unknown()), index: z.number().int().nonnegative() }).strict(),
]);
const manifestSchema = z.object({
  schemaVersion: z.literal(1), adapters: z.array(z.string().min(1)), artifacts: z.array(storedArtifactSchema),
}).strict();
export type InstallationManifest = z.infer<typeof manifestSchema>;
type StoredArtifact = InstallationManifest['artifacts'][number];
type Action = 'create' | 'upgrade' | 'remove' | 'force' | 'unchanged' | 'blocked';
type ArtifactResult = Pick<InstallArtifact, 'path' | 'kind' | 'event'> & { action: Action; reason?: string };
export interface InstallationResult {
  status: 'initialized' | 'planned' | 'blocked';
  projectRoot: string;
  manifestPath: string;
  adapters: string[];
  dryRun: boolean;
  force: boolean;
  artifacts: ArtifactResult[];
  counts: Record<Action, number>;
}

const MANIFEST = '.stetra/installation.json';
function invalid(message: string): never { throw new StetraError('invalid', message); }
function conflict(message: string): never { throw new StetraError('conflict', message); }
function sha256(content: string): string { return `sha256:${createHash('sha256').update(content).digest('hex')}`; }
function canonical(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
    return input;
  }
  return JSON.stringify(ordered(value));
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function artifactKey(value: Pick<InstallArtifact, 'path' | 'kind' | 'event'>): string { return `${value.kind}:${value.path}:${value.event ?? ''}`; }

function projectRoot(input: string): string {
  try {
    const root = realpathSync(resolve(input));
    if (!statSync(root).isDirectory()) invalid('The installation project must be an existing directory.');
    return root;
  } catch (error) {
    if (error instanceof StetraError) throw error;
    return invalid('The installation project must be an existing directory.');
  }
}

function safePath(root: string, path: string): string {
  const parts = path.split('/');
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) invalid(`Unsafe installation path: ${path}`);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let info;
    try { info = lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (info.isSymbolicLink()) invalid(`Refusing an installation path through a symbolic link: ${path}`);
    if (index < parts.length - 1 && !info.isDirectory()) invalid(`An installation parent is not a directory: ${path}`);
  }
  return current;
}

function readFile(root: string, path: string): string | null {
  const target = safePath(root, path);
  try {
    if (!lstatSync(target).isFile()) invalid(`Installation target is not a regular file: ${path}`);
    return readFileSync(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function validateMarkers(markers: { start: string; end: string }): void {
  if (!markers.start || !markers.end || markers.start === markers.end || /[\r\n]/.test(markers.start + markers.end)) invalid('Managed block markers must be distinct, nonempty single lines.');
}

function blockRange(source: string, markers: { start: string; end: string }): { start: number; end: number } | null {
  validateMarkers(markers);
  function offsets(marker: string): number[] {
    const result: number[] = [];
    let position = 0;
    while ((position = source.indexOf(marker, position)) !== -1) {
      const end = position + marker.length;
      if ((position === 0 || source[position - 1] === '\n') && (end === source.length || source[end] === '\n' || source[end] === '\r')) result.push(position);
      position = end;
    }
    return result;
  }
  const starts = offsets(markers.start);
  const ends = offsets(markers.end);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) conflict('Managed block markers are missing, duplicated, or out of order.');
  return { start: starts[0]!, end: ends[0]! + markers.end.length };
}

function parseJsonc(source: string, path: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !record(value)) invalid(`${path} must contain one valid JSON or JSONC object.`);
  function inspect(node: JsonNode | undefined) {
    if (!node) return;
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = String(property.children?.[0]?.value);
        if (keys.has(key)) invalid(`${path} contains a duplicate JSON property: ${key}`);
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) inspect(child);
  }
  inspect(parseTree(source, [], { allowTrailingComma: true }));
  return value;
}

function commands(group: unknown): string[] {
  if (!record(group) || !Array.isArray(group.hooks)) return [];
  return group.hooks.flatMap(hook => record(hook) && typeof hook.command === 'string' ? [hook.command] : []);
}

function containsComment(source: string): boolean {
  const scanner = createScanner(source);
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) return true;
  }
  return false;
}

export function readInstallation(input: string): InstallationManifest | null {
  const root = projectRoot(input);
  const raw = readFile(root, MANIFEST);
  if (raw === null) return null;
  let manifest: InstallationManifest;
  try { manifest = manifestSchema.parse(JSON.parse(raw)); }
  catch { return invalid(`${MANIFEST} must be a valid installation manifest with schemaVersion 1.`); }
  const keys = new Set<string>();
  for (const artifact of manifest.artifacts) {
    safePath(root, artifact.path);
    if (artifact.path === MANIFEST) invalid('An installation manifest cannot manage itself as an artifact.');
    const key = artifactKey(artifact);
    if (keys.has(key)) invalid(`Duplicate installation ownership: ${artifact.path}`);
    keys.add(key);
    if (artifact.kind === 'block') validateMarkers(artifact.markers);
    if (artifact.kind === 'hook' && (!commands(artifact.group).length || sha256(canonical(artifact.group)) !== artifact.generatedHash)) invalid(`Invalid hook ownership in ${MANIFEST}: ${artifact.path}`);
  }
  return manifest;
}

function planHook(source: string | null, artifact: InstallArtifact, prior: StoredArtifact | undefined, force: boolean): { content: string; action: Action; stored: StoredArtifact } {
  const group = parseJsonc(artifact.content, `${artifact.path} generated hook`);
  const desiredCommands = commands(group);
  if (!Array.isArray(group.hooks) || !group.hooks.length || desiredCommands.length !== group.hooks.length || desiredCommands.some(command => !command.trim())) invalid('A generated hook group must contain command hooks with nonempty commands.');
  const event = artifact.event!;
  const original = source ?? '{}\n';
  const document = parseJsonc(original, artifact.path);
  if ('hooks' in document && !record(document.hooks)) invalid(`${artifact.path}: hooks must be an object.`);
  const hooks = (document.hooks ?? {}) as Record<string, unknown>;
  if (event in hooks && !Array.isArray(hooks[event])) invalid(`${artifact.path}: hooks.${event} must be an array.`);
  const groups = (hooks[event] ?? []) as unknown[];
  if (groups.some(item => !record(item) || !Array.isArray(item.hooks))) invalid(`${artifact.path}: hooks.${event} contains an invalid hook group.`);
  const desiredText = canonical(group);
  const previous = prior?.kind === 'hook' ? prior : undefined;
  const exactDesired = groups.flatMap((item, index) => canonical(item) === desiredText ? [index] : []);
  const exactPrevious = previous ? groups.flatMap((item, index) => canonical(item) === canonical(previous.group) ? [index] : []) : [];
  const knownCommands = new Set(previous ? commands(previous.group) : desiredCommands);
  const matchingCommands = groups.flatMap((item, index) => commands(item).some(command => knownCommands.has(command)) ? [index] : []);
  if (exactDesired.length > 1 || exactPrevious.length > 1 || matchingCommands.length > 1) conflict(`More than one hook group could be owned by Stetra in ${artifact.path}.`);
  const matches = new Set([...exactDesired, ...exactPrevious, ...matchingCommands]);
  if (matches.size > 1) conflict(`Conflicting current and previous Stetra hooks exist in ${artifact.path}.`);
  let index = [...matches][0];
  let action: Action;
  if (index === undefined) {
    if (previous && source !== null) conflict(`The previously installed hook cannot be located in ${artifact.path}. Restore or remove its installation ownership before reinstalling; no duplicate was added.`);
    index = groups.length;
    action = 'create';
  } else if (canonical(groups[index]) === desiredText) action = 'unchanged';
  else if (previous && canonical(groups[index]) === canonical(previous.group)) action = 'upgrade';
  else if (previous && force && matchingCommands[0] === index) action = 'force';
  else conflict(`The Stetra hook in ${artifact.path} was changed. ${previous ? 'Use --force to replace the identified managed group.' : 'The existing group is not owned by this installation.'}`);
  const stored: StoredArtifact = { path: artifact.path, kind: 'hook', event, group, index, generatedHash: sha256(desiredText) };
  if (action === 'unchanged') return { content: original, action, stored };
  const edits = modify(original, ['hooks', event, action === 'create' ? -1 : index], group, {
    isArrayInsertion: action === 'create',
    formattingOptions: { insertSpaces: !/^\t/m.test(original), tabSize: 2, eol: original.includes('\r\n') ? '\r\n' : '\n' },
  });
  if (action !== 'create' && edits.some(edit => containsComment(original.slice(edit.offset, edit.offset + edit.length)))) {
    if (!previous || !force) conflict(`Upgrading the Stetra hook in ${artifact.path} would remove developer comments. Preserve or move them, or use --force to replace the identified managed group.`);
    action = 'force';
  }
  const content = applyEdits(original, edits);
  return { content: content.endsWith('\n') ? content : `${content}\n`, action, stored };
}

function writeFile(root: string, path: string, content: string): void {
  const target = safePath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.stetra-init-${randomUUID()}.tmp`);
  let mode = 0o644;
  try { mode = lstatSync(target).mode & 0o777; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    safePath(root, path);
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}

export function planInstallation(input: string, adapters: string[], artifacts: InstallArtifact[], options: { dryRun?: boolean; force?: boolean } = {}): InstallationResult {
  const root = projectRoot(input);
  const existing = readInstallation(root);
  const selected = [...new Set(adapters)].sort();
  if (!selected.length || selected.some(adapter => !adapter.trim())) invalid('At least one named integration is required.');
  if (existing?.adapters.some(adapter => !selected.includes(adapter))) invalid('Initialization is additive; include every previously installed integration.');
  const desired = [...artifacts].sort((a, b) => a.path.localeCompare(b.path) || artifactKey(a).localeCompare(artifactKey(b)));
  const keys = new Set<string>();
  const paths = new Map<string, InstallArtifact['kind']>();
  for (const artifact of desired) {
    safePath(root, artifact.path);
    if (artifact.path === MANIFEST || MANIFEST.startsWith(`${artifact.path}/`)) invalid('The installation manifest path and its parent directories are reserved.');
    if (typeof artifact.content !== 'string') invalid(`Installation content must be text: ${artifact.path}`);
    if (artifact.kind === 'hook' && (!artifact.event?.trim() || artifact.markers)) invalid(`A hook requires an event and no block markers: ${artifact.path}`);
    if (artifact.kind === 'file' && (artifact.event || artifact.markers)) invalid(`A file cannot have hook or block options: ${artifact.path}`);
    if (artifact.kind === 'block') {
      if (!artifact.markers || artifact.event) invalid(`A managed block requires markers and no event: ${artifact.path}`);
      const range = blockRange(artifact.content, artifact.markers);
      if (!range || range.start !== 0 || artifact.content.slice(range.end).trim()) invalid(`Generated block content must contain only its complete marked block: ${artifact.path}`);
    }
    const key = artifactKey(artifact);
    if ([...paths.keys()].some(path => path.startsWith(`${artifact.path}/`) || artifact.path.startsWith(`${path}/`))) invalid(`Installation files cannot also be parent directories: ${artifact.path}`);
    if (keys.has(key) || (paths.has(artifact.path) && (paths.get(artifact.path) !== 'hook' || artifact.kind !== 'hook'))) invalid(`Duplicate or overlapping installation artifacts: ${artifact.path}`);
    keys.add(key); paths.set(artifact.path, artifact.kind);
  }
  const previous = new Map(existing?.artifacts.map(artifact => [artifactKey(artifact), artifact]));
  const originals = new Map<string, string | null>([[MANIFEST, readFile(root, MANIFEST)]]);
  const next = new Map<string, string | null>();
  const planned: ArtifactResult[] = [];
  const installed: StoredArtifact[] = [];
  // Retire obsolete owned artifacts only while their generated content is intact.
  // Force applies to desired replacements, never to deleting developer edits.
  for (const artifact of existing?.artifacts ?? []) {
    if (keys.has(artifactKey(artifact))) continue;
    try {
      if (!originals.has(artifact.path)) originals.set(artifact.path, readFile(root, artifact.path));
      const source = next.has(artifact.path) ? next.get(artifact.path)! : originals.get(artifact.path)!;
      let content: string | null = source;
      if (source !== null && artifact.kind === 'file') {
        if (sha256(source) !== artifact.generatedHash) conflict(`The obsolete managed file ${artifact.path} was edited; preserve or move those edits before upgrading.`);
        content = null;
      } else if (source !== null && artifact.kind === 'block') {
        const range = blockRange(source, artifact.markers);
        if (range) {
          if (sha256(source.slice(range.start, range.end).replace(/\r\n/g, '\n')) !== artifact.generatedHash) conflict(`The obsolete managed block in ${artifact.path} was edited.`);
          content = source.slice(0, range.start) + source.slice(range.end);
        }
      } else if (source !== null && artifact.kind === 'hook') {
        const document = parseJsonc(source, artifact.path);
        const hooks = record(document.hooks) ? document.hooks : {};
        const groups = hooks[artifact.event];
        if (!Array.isArray(groups)) conflict(`The obsolete managed hook in ${artifact.path} cannot be located safely.`);
        const matches = groups.flatMap((group, index) => canonical(group) === canonical(artifact.group) ? [index] : []);
        if (matches.length !== 1) conflict(`The obsolete managed hook in ${artifact.path} was edited or cannot be located safely.`);
        const edits = modify(source, ['hooks', artifact.event, matches[0]!], undefined, {});
        if (edits.some(edit => containsComment(source.slice(edit.offset, edit.offset + edit.length)))) {
          conflict(`Retiring the obsolete hook in ${artifact.path} would remove developer comments; preserve or move them before upgrading.`);
        }
        content = applyEdits(source, edits);
      }
      next.set(artifact.path, content);
      planned.push({ path: artifact.path, kind: artifact.kind, ...(artifact.kind === 'hook' ? { event: artifact.event } : {}), action: source === null ? 'unchanged' : 'remove' });
    } catch (error) {
      if (!(error instanceof StetraError)) throw error;
      planned.push({ path: artifact.path, kind: artifact.kind, ...(artifact.kind === 'hook' ? { event: artifact.event } : {}), action: 'blocked', reason: error.message });
    }
  }
  for (const artifact of desired) {
    const prior = previous.get(artifactKey(artifact));
    try {
      if (!originals.has(artifact.path)) originals.set(artifact.path, readFile(root, artifact.path));
      const source = next.has(artifact.path) ? next.get(artifact.path)! : originals.get(artifact.path)!;
      let action: Action;
      let content: string;
      let stored: StoredArtifact;
      if (artifact.kind === 'hook') {
        ({ action, content, stored } = planHook(source, artifact, prior, Boolean(options.force)));
      } else if (artifact.kind === 'block') {
        const markers = artifact.markers!;
        if (prior?.kind === 'block' && canonical(prior.markers) !== canonical(markers)) conflict(`Managed block markers changed in ${artifact.path}; migrate them explicitly.`);
        const range = blockRange(source ?? '', markers);
        const block = artifact.content.replace(/\r\n/g, '\n').trimEnd();
        const current = range ? source!.slice(range.start, range.end).replace(/\r\n/g, '\n') : null;
        if (current === block) action = 'unchanged';
        else if (current === null) action = 'create';
        else if (prior?.generatedHash === sha256(current)) action = 'upgrade';
        else if (prior && options.force) action = 'force';
        else conflict(`The managed block in ${artifact.path} differs from the recorded installation${prior ? '; use --force to replace only that block' : ' and has no established ownership'}.`);
        const newline = source?.includes('\r\n') ? '\r\n' : '\n';
        const rendered = block.replace(/\n/g, newline);
        content = action === 'unchanged' ? source! : range ? `${source!.slice(0, range.start)}${rendered}${source!.slice(range.end)}` : `${source ?? ''}${source && !source.endsWith('\n') ? newline : ''}${rendered}${newline}`;
        stored = { path: artifact.path, kind: 'block', markers, generatedHash: sha256(block) };
      } else {
        content = artifact.content;
        if (source === content) action = 'unchanged';
        else if (source === null) action = 'create';
        else if (prior?.generatedHash === sha256(source)) action = 'upgrade';
        else if (prior && options.force) action = 'force';
        else conflict(`The file ${artifact.path} differs from the recorded installation${prior ? '; use --force to replace this managed file' : ' and is not owned by Stetra'}.`);
        stored = { path: artifact.path, kind: 'file', generatedHash: sha256(content) };
      }
      next.set(artifact.path, content);
      installed.push(stored);
      planned.push({ path: artifact.path, kind: artifact.kind, ...(artifact.event ? { event: artifact.event } : {}), action });
    } catch (error) {
      if (!(error instanceof StetraError)) throw error;
      planned.push({ path: artifact.path, kind: artifact.kind, ...(artifact.event ? { event: artifact.event } : {}), action: 'blocked', reason: error.message });
    }
  }
  const counts: Record<Action, number> = { create: 0, upgrade: 0, remove: 0, force: 0, unchanged: 0, blocked: 0 };
  for (const item of planned) counts[item.action]++;
  const result: InstallationResult = {
    status: counts.blocked ? 'blocked' : options.dryRun ? 'planned' : 'initialized', projectRoot: root,
    manifestPath: join(root, MANIFEST), adapters: selected, dryRun: Boolean(options.dryRun), force: Boolean(options.force), artifacts: planned, counts,
  };
  if (counts.blocked || options.dryRun) return result;
  const manifest: InstallationManifest = { schemaVersion: 1, adapters: selected, artifacts: installed };
  next.set(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  // Check every source again before any writes. Atomic replacement protects each file;
  // the manifest is written last, so interrupted installation can be safely retried.
  for (const [path, original] of originals) {
    if (readFile(root, path) !== original) conflict(`Installation target changed while planning: ${path}`);
  }
  for (const [path, content] of next) {
    if (originals.get(path) === content) continue;
    if (content === null) rmSync(safePath(root, path));
    else writeFile(root, path, content);
  }
  return result;
}
