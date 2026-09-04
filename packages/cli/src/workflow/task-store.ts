import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { inputError, usageError } from '../errors.ts';
import { DELEGATION_PROTOCOL, DELEGATION_SCHEMA_VERSION, stableFingerprint } from '../protocol.ts';
import {
  TaskEventSchema,
  TaskProjectionSchema,
  type TaskEvent,
  type TaskProjection,
} from '../schemas/task.ts';
import { parseArtifact } from '../validation.ts';

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface LoadedTask {
  projectRoot: string;
  taskId: string;
  taskDirectory: string;
  taskPath: string;
  eventsPath: string;
  projection: TaskProjection;
  events: TaskEvent[];
}

export interface StoredArtifact {
  relativePath: string;
  value: unknown;
}

export interface WorktreeLease {
  projectRoot: string;
  path: string;
  owner: string;
}

export function canonicalProjectRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw usageError(`Project root is not a directory: ${root}`);
  }
  return realpathSync(root);
}

export function createTaskWorkspace(projectRootInput: string, taskIdInput: string): {
  projectRoot: string;
  taskDirectory: string;
  finalTaskDirectory: string;
  objectDirectory: string;
} {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const taskId = requiredTaskId(taskIdInput);
  const finalTaskDirectory = resolveTaskDirectory(projectRoot, taskId);
  if (existsSync(finalTaskDirectory)) throw new Error(`Task ${taskId} already exists.`);
  const stagingRoot = resolveStagingDirectory(projectRoot);
  mkdirSync(stagingRoot, { recursive: true });
  const taskDirectory = mkdtempSync(join(stagingRoot, 'begin-'));
  const objectDirectory = join(taskDirectory, 'worktree-objects');
  mkdirSync(objectDirectory, { recursive: false });
  return { projectRoot, taskDirectory, finalTaskDirectory, objectDirectory };
}

export function createCollectionStagingDirectory(projectRootInput: string): string {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const stagingRoot = resolveStagingDirectory(projectRoot);
  mkdirSync(stagingRoot, { recursive: true });
  const directory = mkdtempSync(join(stagingRoot, 'collect-'));
  mkdirSync(join(directory, 'artifacts'), { recursive: false });
  mkdirSync(join(directory, 'objects'), { recursive: false });
  return directory;
}

export async function withWorktreeLease<T>(
  input: { projectRoot: string; operation: 'begin' | 'collect'; taskId?: string },
  work: (lease: WorktreeLease) => Promise<T>,
): Promise<T> {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const lease = acquireWorktreeLease(projectRoot, input.operation, input.taskId);
  try {
    return await work(lease);
  } finally {
    releaseOwnedLock(lease);
  }
}

export function initializeTask(input: {
  projectRoot: string;
  taskId: string;
  stagingDirectory: string;
  projection: TaskProjection;
  artifacts: StoredArtifact[];
}): LoadedTask {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const taskId = requiredTaskId(input.taskId);
  const finalDirectory = resolveTaskDirectory(projectRoot, taskId);
  assertStagingDirectory(projectRoot, input.stagingDirectory);
  if (existsSync(finalDirectory)) throw new Error(`Task ${taskId} is already published.`);
  try {
    for (const artifact of input.artifacts) {
      writeImmutableJson(taskArtifactPath(input.stagingDirectory, artifact.relativePath), artifact.value);
    }
    const projection = parseArtifact(TaskProjectionSchema, input.projection, 'task projection');
    const event = taskEvent({
      taskId,
      sequence: 1,
      type: 'task-began',
      actor: 'runtime',
      priorRevision: 0,
      projection,
      artifactRefs: input.artifacts.map((artifact) =>
        projectRelativePath(projectRoot, taskArtifactPath(finalDirectory, artifact.relativePath))),
    });
    writeFileSync(join(input.stagingDirectory, 'events.jsonl'), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8', flag: 'wx',
    });
    writeJsonAtomic(join(input.stagingDirectory, 'task.json'), projection);
    mkdirSync(dirname(finalDirectory), { recursive: true });
    renameSync(input.stagingDirectory, finalDirectory);
    return loadTask(projectRoot, taskId);
  } catch (error) {
    rmSync(input.stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function loadTask(projectRootInput: string, taskIdInput: string): LoadedTask {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const taskId = requiredTaskId(taskIdInput);
  const taskDirectory = resolveTaskDirectory(projectRoot, taskId);
  const eventsPath = join(taskDirectory, 'events.jsonl');
  if (!existsSync(eventsPath)) throw usageError(`Task ${taskId} does not exist.`);
  const events = readEvents(eventsPath, taskId);
  const projection = events.at(-1)!.projection;
  const taskPath = join(taskDirectory, 'task.json');
  const cached = existsSync(taskPath) ? readJson(taskPath, 'task projection') : undefined;
  if (stableFingerprint(cached) !== stableFingerprint(projection)) writeJsonAtomic(taskPath, projection);
  return { projectRoot, taskId, taskDirectory, taskPath, eventsPath, projection, events };
}

export function transitionTask(input: {
  projectRoot: string;
  taskId: string;
  type: Exclude<TaskEvent['type'], 'task-began' | 'facts-collected'>;
  actor: TaskEvent['actor'];
  artifacts: StoredArtifact[];
  mutate: (task: LoadedTask) => TaskProjection;
}): LoadedTask {
  const lock = acquireTaskLock(input.projectRoot, input.taskId);
  try {
    const current = loadTask(input.projectRoot, input.taskId);
    if (current.projection.revision !== lock.expectedRevision) {
      throw usageError(`Task ${input.taskId} advanced before this transition.`);
    }
    for (const artifact of input.artifacts) {
      writeImmutableJson(taskArtifactPath(current.taskDirectory, artifact.relativePath), artifact.value);
    }
    const projection = parseArtifact(TaskProjectionSchema, {
      ...input.mutate(current),
      revision: current.projection.revision + 1,
    }, 'resulting task projection');
    assertOwnedLock(lock);
    const event = taskEvent({
      taskId: current.taskId,
      sequence: current.events.length + 1,
      type: input.type,
      actor: input.actor,
      priorRevision: current.projection.revision,
      projection,
      artifactRefs: input.artifacts.map((artifact) => projectRelativePath(
        current.projectRoot,
        taskArtifactPath(current.taskDirectory, artifact.relativePath),
      )),
    });
    appendFileSync(current.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    writeJsonAtomic(current.taskPath, projection);
    return loadTask(current.projectRoot, current.taskId);
  } finally {
    releaseOwnedLock(lock);
  }
}

export function commitCollectionTransition(input: {
  projectRoot: string;
  taskId: string;
  expectedRevision: number;
  stagedArtifactsDirectory: string;
  artifactRefs: string[];
  projection: TaskProjection;
}): LoadedTask {
  assertStagingDirectory(input.projectRoot, dirname(input.stagedArtifactsDirectory));
  const lock = acquireTaskLock(input.projectRoot, input.taskId);
  try {
    const current = loadTask(input.projectRoot, input.taskId);
    if (current.projection.revision !== input.expectedRevision
      || lock.expectedRevision !== input.expectedRevision) {
      throw usageError(`Task ${input.taskId} changed while facts were collected.`);
    }
    const projection = parseArtifact(TaskProjectionSchema, {
      ...input.projection,
      revision: current.projection.revision + 1,
    }, 'resulting task projection');
    assertOwnedLock(lock);
    publishStagedArtifacts(input.stagedArtifactsDirectory, current.taskDirectory);
    const event = taskEvent({
      taskId: current.taskId,
      sequence: current.events.length + 1,
      type: 'facts-collected',
      actor: 'runtime',
      priorRevision: current.projection.revision,
      projection,
      artifactRefs: input.artifactRefs,
    });
    appendFileSync(current.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    writeJsonAtomic(current.taskPath, projection);
    return loadTask(current.projectRoot, current.taskId);
  } finally {
    releaseOwnedLock(lock);
  }
}

export function taskArtifactPath(taskDirectory: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) throw new Error(`Unsafe task artifact path: ${relativePath}`);
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
  const value = relative(projectRoot, path).replace(/\\/g, '/');
  if (!value || value.startsWith('../') || isAbsolute(value)) {
    throw new Error(`Path is outside the project: ${path}`);
  }
  return value;
}

function taskEvent(input: {
  taskId: string;
  sequence: number;
  type: TaskEvent['type'];
  actor: TaskEvent['actor'];
  priorRevision: number;
  projection: TaskProjection;
  artifactRefs: string[];
}): TaskEvent {
  return parseArtifact(TaskEventSchema, {
    protocol: DELEGATION_PROTOCOL,
    schemaVersion: DELEGATION_SCHEMA_VERSION,
    taskId: input.taskId,
    sequence: input.sequence,
    eventId: randomUUID(),
    type: input.type,
    actor: input.actor,
    occurredAt: new Date().toISOString(),
    priorRevision: input.priorRevision,
    resultingRevision: input.projection.revision,
    artifactRefs: input.artifactRefs,
    projection: input.projection,
  }, 'task event');
}

function readEvents(path: string, taskId: string): TaskEvent[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw inputError(`Failed to read task events at ${path}.`, error);
  }
  const events = text.split('\n').filter((line) => line.trim()).map((line, index) => {
    try {
      return parseArtifact(TaskEventSchema, JSON.parse(line), `task event ${index + 1}`);
    } catch (error) {
      throw inputError(`Task event ${index + 1} is invalid.`, error);
    }
  });
  if (!events.length) throw new Error(`Task ${taskId} has no source events.`);
  for (const [index, event] of events.entries()) {
    const priorRevision = index === 0 ? 0 : events[index - 1].resultingRevision;
    if (event.taskId !== taskId || event.sequence !== index + 1
      || event.priorRevision !== priorRevision || event.resultingRevision !== priorRevision + 1
      || event.projection.revision !== event.resultingRevision
      || event.projection.taskId !== taskId) {
      throw new Error(`Task ${taskId} event chain is inconsistent at sequence ${index + 1}.`);
    }
  }
  return events;
}

interface OwnedLock {
  path: string;
  owner: string;
}

interface TaskLock extends OwnedLock {
  expectedRevision: number;
}

interface LockOwner {
  owner: string;
  pid: number;
  processIdentity?: string;
  operation: string;
  acquiredAt: string;
  expectedRevision?: number;
  taskId?: string;
}

function acquireTaskLock(projectRootInput: string, taskIdInput: string): TaskLock {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const taskId = requiredTaskId(taskIdInput);
  const expectedRevision = loadTask(projectRoot, taskId).projection.revision;
  const path = join(resolveTaskDirectory(projectRoot, taskId), '.lock');
  const value = newLockOwner('task-transition', { taskId, expectedRevision });
  acquireFileLock(path, value, `Task ${taskId} is being modified`);
  return { path, owner: value.owner, expectedRevision };
}

function acquireWorktreeLease(
  projectRoot: string,
  operation: 'begin' | 'collect',
  taskId?: string,
): WorktreeLease {
  const directory = join(projectRoot, '.stetra');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'worktree-operation.lock');
  const value = newLockOwner(operation, taskId ? { taskId } : {});
  acquireFileLock(path, value, 'The worktree is already being observed by Stetra');
  cleanupAbandonedStaging(projectRoot);
  return { projectRoot, path, owner: value.owner };
}

function newLockOwner(
  operation: string,
  extra: Pick<LockOwner, 'taskId' | 'expectedRevision'>,
): LockOwner {
  const processIdentity = readProcessIdentity(process.pid);
  return {
    owner: `${process.pid}:${randomUUID()}`,
    pid: process.pid,
    ...(processIdentity ? { processIdentity } : {}),
    operation,
    acquiredAt: new Date().toISOString(),
    ...extra,
  };
}

function acquireFileLock(path: string, value: LockOwner, conflict: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch {
      const current = readLock(path);
      if (attempt === 0 && current && isConfirmedDead(current)) {
        rmSync(path, { force: true });
        continue;
      }
      throw usageError(`${conflict}${current ? ` (owner ${current.owner})` : ''}.`);
    }
  }
}

function readLock(path: string): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as LockOwner;
    return isNonEmptyLock(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isNonEmptyLock(value: LockOwner): boolean {
  return typeof value?.owner === 'string' && typeof value.pid === 'number'
    && typeof value.operation === 'string' && typeof value.acquiredAt === 'string';
}

function assertOwnedLock(lock: OwnedLock): void {
  if (readLock(lock.path)?.owner !== lock.owner) {
    throw usageError('Task mutation lock was lost; no event was written.');
  }
}

function releaseOwnedLock(lock: OwnedLock): void {
  if (readLock(lock.path)?.owner === lock.owner) rmSync(lock.path, { force: true });
}

function isConfirmedDead(owner: LockOwner): boolean {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
  if (!owner.processIdentity) return false;
  const identity = readProcessIdentity(owner.pid);
  return identity !== undefined && identity !== owner.processIdentity;
}

function readProcessIdentity(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closing = stat.lastIndexOf(')');
    const fields = closing >= 0 ? stat.slice(closing + 1).trim().split(/\s+/) : [];
    return fields[19] ? `linux-proc-start:${fields[19]}` : undefined;
  } catch {
    return undefined;
  }
}

function publishStagedArtifacts(sourceDirectory: string, taskDirectory: string): void {
  if (!existsSync(sourceDirectory)) return;
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const source = join(sourceDirectory, entry.name);
    const target = join(taskDirectory, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      publishStagedArtifacts(source, target);
      rmSync(source, { recursive: true, force: true });
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported staged artifact at ${source}.`);
    if (existsSync(target)) throw new Error(`Task artifact already exists at ${target}.`);
    renameSync(source, target);
  }
}

function cleanupAbandonedStaging(projectRoot: string): void {
  const staging = resolveStagingDirectory(projectRoot);
  if (!existsSync(staging)) return;
  for (const entry of readdirSync(staging, { withFileTypes: true })) {
    rmSync(join(staging, entry.name), { recursive: true, force: true });
  }
}

function resolveTaskDirectory(projectRoot: string, taskId: string): string {
  const relativePath = `.stetra/tasks/${taskId}`;
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function resolveStagingDirectory(projectRoot: string): string {
  const relativePath = '.stetra/staging';
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function assertStagingDirectory(projectRootInput: string, path: string): void {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const stagingRoot = resolveStagingDirectory(projectRoot);
  const value = relative(stagingRoot, resolve(path));
  if (!value || isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error(`Staged artifacts must remain under ${stagingRoot}.`);
  }
}

function requiredTaskId(value: string): string {
  if (!TASK_ID_PATTERN.test(value)) throw usageError('Invalid task ID: expected a Stetra task UUID.');
  return value;
}

function assertNoSymlinkTraversal(projectRoot: string, relativePath: string): void {
  let current = projectRoot;
  for (const [index, segment] of relativePath.split('/').entries()) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing Stetra storage through a symlink: ${relativePath}`);
    if (index < relativePath.split('/').length - 1 && !stat.isDirectory()) {
      throw new Error(`Invalid Stetra storage path: ${relativePath}`);
    }
  }
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value) && !value.startsWith('/') && !value.includes('\\')
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
