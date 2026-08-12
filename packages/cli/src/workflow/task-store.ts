import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { inputError, usageError } from '../errors.ts';
import {
  DELEGATION_PROTOCOL,
  DELEGATION_SCHEMA_VERSION,
  stableFingerprint,
} from '../protocol.ts';
import {
  TaskEventSchema,
  TaskProjectionSchema,
  type TaskEvent,
  type TaskProjection,
} from '../schemas/delegation.ts';
import { parseArtifact } from '../validation.ts';

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;

export interface LoadedTask {
  projectRoot: string;
  taskId: string;
  taskDirectory: string;
  taskPath: string;
  eventsPath: string;
  projection: TaskProjection;
  events: TaskEvent[];
}

export interface InitialArtifact {
  relativePath: string;
  value: unknown;
}

export function createTaskWorkspace(projectRootInput: string, taskIdInput: string): {
  projectRoot: string;
  taskDirectory: string;
  objectDirectory: string;
} {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const taskId = requiredTaskId(taskIdInput);
  const taskDirectory = resolveTaskDirectory(projectRoot, taskId);
  mkdirSync(dirname(taskDirectory), { recursive: true });
  mkdirSync(taskDirectory, { recursive: false });
  const objectDirectory = join(taskDirectory, 'worktree-objects');
  mkdirSync(objectDirectory, { recursive: false });
  return { projectRoot, taskDirectory, objectDirectory };
}

export function canonicalProjectRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw usageError(`Project root is not a directory: ${root}`);
  }
  return realpathSync(root);
}

export function initializeTask(input: {
  projectRoot: string;
  taskId: string;
  projection: TaskProjection;
  artifacts: InitialArtifact[];
}): LoadedTask {
  const taskId = requiredTaskId(input.taskId);
  const taskDirectory = resolveTaskDirectory(input.projectRoot, taskId);
  if (!existsSync(taskDirectory) || existsSync(join(taskDirectory, 'events.jsonl'))) {
    throw new Error(`Task workspace ${taskId} is missing or already initialized.`);
  }
  try {
    for (const artifact of input.artifacts) {
      writeImmutableJson(taskArtifactPath(taskDirectory, artifact.relativePath), artifact.value);
    }
    const projection = parseArtifact(
      TaskProjectionSchema,
      input.projection,
      'task projection',
    );
    const event = parseArtifact(TaskEventSchema, {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      taskId,
      sequence: 1,
      eventId: randomUUID(),
      type: 'task-prepared',
      actor: 'runtime',
      occurredAt: projection.createdAt,
      priorRevision: 0,
      resultingRevision: 1,
      artifactRefs: input.artifacts.map((artifact) =>
        projectRelativePath(input.projectRoot, taskArtifactPath(taskDirectory, artifact.relativePath))),
      projection,
    }, 'initial task event');
    writeFileSync(join(taskDirectory, 'events.jsonl'), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    writeJsonAtomic(join(taskDirectory, 'task.json'), projection);
    return loadTask(input.projectRoot, taskId);
  } catch (error) {
    rmSync(taskDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function loadTask(projectRootInput: string, taskIdInput: string): LoadedTask {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const taskId = requiredTaskId(taskIdInput);
  const taskDirectory = resolveTaskDirectory(projectRoot, taskId);
  const eventsPath = join(taskDirectory, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    throw usageError(`Task ${taskId} does not exist at ${taskDirectory}.`);
  }
  const events = readEvents(eventsPath, taskId);
  const projection = events.at(-1)!.projection;
  if (projection.projectRoot !== projectRoot || projection.taskId !== taskId) {
    throw new Error('Task identity or project root does not match its storage location.');
  }
  const taskPath = join(taskDirectory, 'task.json');
  const cached = existsSync(taskPath) ? readJson(taskPath, 'task projection') : undefined;
  if (stableFingerprint(cached) !== stableFingerprint(projection)) {
    writeJsonAtomic(taskPath, projection);
  }
  return { projectRoot, taskId, taskDirectory, taskPath, eventsPath, projection, events };
}

export async function transitionTask(input: {
  projectRoot: string;
  taskId: string;
  type: Exclude<TaskEvent['type'], 'task-prepared'>;
  actor: TaskEvent['actor'];
  lockTtlMs?: number;
  mutate: (task: LoadedTask) => Promise<{
    projection: TaskProjection;
    artifactRefs: string[];
  }> | {
    projection: TaskProjection;
    artifactRefs: string[];
  };
}): Promise<LoadedTask> {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const taskId = requiredTaskId(input.taskId);
  const lock = acquireLock(projectRoot, taskId, input.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);
  try {
    const loaded = loadTask(projectRoot, taskId);
    if (loaded.projection.revision !== lock.expectedRevision) {
      throw usageError(`Task ${taskId} advanced before this writer acquired its expected revision.`);
    }
    const mutation = await input.mutate(loaded);
    assertOwnedLock(lock);
    const current = loadTask(projectRoot, taskId);
    if (current.projection.revision !== lock.expectedRevision) {
      throw usageError(`Task ${taskId} changed while this operation was running; no projection was overwritten.`);
    }
    const occurredAt = new Date().toISOString();
    const projection = parseArtifact(TaskProjectionSchema, {
      ...mutation.projection,
      updatedAt: occurredAt,
      revision: current.projection.revision + 1,
    }, 'resulting task projection');
    const event = parseArtifact(TaskEventSchema, {
      protocol: DELEGATION_PROTOCOL,
      schemaVersion: DELEGATION_SCHEMA_VERSION,
      taskId,
      sequence: current.events.length + 1,
      eventId: randomUUID(),
      type: input.type,
      actor: input.actor,
      occurredAt,
      priorRevision: current.projection.revision,
      resultingRevision: projection.revision,
      artifactRefs: mutation.artifactRefs,
      projection,
    }, 'task transition event');
    appendFileSync(current.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    writeJsonAtomic(current.taskPath, projection);
    return loadTask(projectRoot, taskId);
  } finally {
    releaseLock(lock);
  }
}

export function taskArtifactPath(taskDirectory: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe task artifact path: ${relativePath}`);
  }
  const path = resolve(taskDirectory, relativePath);
  const rel = relative(taskDirectory, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Task artifact escapes task storage: ${relativePath}`);
  }
  return path;
}

export function writeImmutableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, 'wx');
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function writeImmutableBuffer(path: string, value: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, 'wx');
  try {
    writeFileSync(descriptor, value);
  } finally {
    closeSync(descriptor);
  }
}

export function readJsonArtifact<T>(path: string, label: string): T {
  if (!existsSync(path)) throw usageError(`${label} does not exist at ${path}.`);
  return readJson(path, label) as T;
}

export function projectRelativePath(projectRoot: string, path: string): string {
  const output = relative(projectRoot, path).replace(/\\/g, '/');
  if (!output || output.startsWith('../') || isAbsolute(output)) {
    throw new Error(`Path is outside the project: ${path}`);
  }
  return output;
}

function readEvents(path: string, taskId: string): TaskEvent[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw inputError(`Failed to read task events at ${path}.`, error);
  }
  const lines = text.split('\n').filter((line) => line.trim());
  if (!lines.length) throw new Error(`Task ${taskId} has no source events.`);
  const events = lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw inputError(`Task event ${index + 1} is not valid JSON.`, error);
    }
    return parseArtifact(TaskEventSchema, value, `task event ${index + 1}`);
  });
  for (const [index, event] of events.entries()) {
    const priorRevision = index === 0 ? 0 : events[index - 1].resultingRevision;
    if (event.taskId !== taskId
      || event.sequence !== index + 1
      || event.priorRevision !== priorRevision
      || event.resultingRevision !== priorRevision + 1
      || event.projection.revision !== event.resultingRevision
      || event.projection.taskId !== taskId) {
      throw new Error(`Task ${taskId} event chain is inconsistent at sequence ${index + 1}.`);
    }
  }
  return events;
}

interface TaskLock {
  path: string;
  owner: string;
  expectedRevision: number;
}

function acquireLock(projectRoot: string, taskId: string, ttlMs: number): TaskLock {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error('Task lock TTL is invalid.');
  const taskDirectory = resolveTaskDirectory(projectRoot, taskId);
  const path = join(taskDirectory, '.lock');
  const expectedRevision = loadTask(projectRoot, taskId).projection.revision;
  const owner = `${process.pid}:${randomUUID()}`;
  const now = Date.now();
  const value = {
    owner,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    expectedRevision,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
      return { path, owner, expectedRevision };
    } catch (error) {
      const candidate = readLock(path);
      if (attempt === 0 && candidate && Date.parse(candidate.expiresAt) <= now) {
        rmSync(path, { force: true });
        continue;
      }
      throw usageError(
        `Task ${taskId} is being modified by another operation${candidate ? ` owned by ${candidate.owner}` : ''}.`,
      );
    }
  }
  throw new Error(`Unable to acquire task lock for ${taskId}.`);
}

function readLock(path: string): { owner: string; expiresAt: string } | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return typeof value.owner === 'string' && typeof value.expiresAt === 'string'
      ? { owner: value.owner, expiresAt: value.expiresAt }
      : undefined;
  } catch {
    return undefined;
  }
}

function assertOwnedLock(lock: TaskLock): void {
  const current = readLock(lock.path);
  if (!current || current.owner !== lock.owner) {
    throw usageError('Task mutation lock was lost; no event or projection was written.');
  }
}

function releaseLock(lock: TaskLock): void {
  const current = readLock(lock.path);
  if (current?.owner === lock.owner) rmSync(lock.path, { force: true });
}

function resolveTaskDirectory(projectRoot: string, taskId: string): string {
  const relativePath = `.stetra/tasks/${taskId}`;
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function requiredTaskId(value: string): string {
  if (!TASK_ID_PATTERN.test(value)) {
    throw usageError('Invalid task ID: expected the UUID returned by change prepare.');
  }
  return value;
}

function assertNoSymlinkTraversal(projectRoot: string, relativePath: string): void {
  let current = projectRoot;
  const segments = relativePath.split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing task storage through a symlink: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Invalid task storage path: ${relativePath}`);
    }
  }
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((segment) => Boolean(segment) && segment !== '.' && segment !== '..');
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError(`Failed to read ${label} at ${path}.`, error);
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
