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
import { invalidateTaskOwnedInputs } from '../host/owned-input.ts';
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

export interface WorktreeLease {
  projectRoot: string;
  path: string;
  owner: string;
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
  if (existsSync(finalTaskDirectory)) {
    throw new Error(`Task workspace ${taskId} already exists.`);
  }
  const stagingRoot = resolveStagingDirectory(projectRoot);
  mkdirSync(stagingRoot, { recursive: true });
  const taskDirectory = mkdtempSync(join(stagingRoot, 'prepare-'));
  const objectDirectory = join(taskDirectory, 'worktree-objects');
  mkdirSync(objectDirectory, { recursive: false });
  return { projectRoot, taskDirectory, finalTaskDirectory, objectDirectory };
}

export async function withWorktreeLease<T>(input: {
  projectRoot: string;
  operation: 'prepare' | 'collect';
  taskId?: string;
}, work: (lease: WorktreeLease) => Promise<T>): Promise<T> {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const lease = acquireWorktreeLease(projectRoot, input.operation, input.taskId);
  try {
    return await work(lease);
  } finally {
    releaseOwnedFileLock(lease);
  }
}

export function createCollectionStagingDirectory(input: {
  projectRoot: string;
  taskId: string;
  revision: number;
}): string {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  requiredTaskId(input.taskId);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Collection staging revision is invalid.');
  }
  const stagingRoot = resolveStagingDirectory(projectRoot);
  mkdirSync(stagingRoot, { recursive: true });
  const path = mkdtempSync(join(stagingRoot, 'collect-'));
  mkdirSync(join(path, 'artifacts'), { recursive: false });
  mkdirSync(join(path, 'objects'), { recursive: false });
  return path;
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
  stagingDirectory: string;
  projection: TaskProjection;
  artifacts: InitialArtifact[];
}): LoadedTask {
  const taskId = requiredTaskId(input.taskId);
  const taskDirectory = input.stagingDirectory;
  const finalTaskDirectory = resolveTaskDirectory(input.projectRoot, taskId);
  assertStagingDirectory(input.projectRoot, taskDirectory);
  if (!existsSync(taskDirectory) || existsSync(join(taskDirectory, 'events.jsonl'))) {
    throw new Error(`Task workspace ${taskId} is missing or already initialized.`);
  }
  if (existsSync(finalTaskDirectory)) {
    throw new Error(`Task workspace ${taskId} is already published.`);
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
      occurredAt: new Date().toISOString(),
      priorRevision: 0,
      resultingRevision: 1,
      artifactRefs: input.artifacts.map((artifact) =>
        projectRelativePath(input.projectRoot, taskArtifactPath(finalTaskDirectory, artifact.relativePath))),
      projection,
    }, 'initial task event');
    writeFileSync(join(taskDirectory, 'events.jsonl'), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    writeJsonAtomic(join(taskDirectory, 'task.json'), projection);
    mkdirSync(dirname(finalTaskDirectory), { recursive: true });
    renameSync(taskDirectory, finalTaskDirectory);
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
  if (projection.taskId !== taskId) {
    throw new Error('Task identity does not match its storage location.');
  }
  const taskPath = join(taskDirectory, 'task.json');
  const cached = existsSync(taskPath) ? readJson(taskPath, 'task projection') : undefined;
  if (stableFingerprint(cached) !== stableFingerprint(projection)) {
    writeJsonAtomic(taskPath, projection);
  }
  return { projectRoot, taskId, taskDirectory, taskPath, eventsPath, projection, events };
}

export function findTaskByPrepareRequestId(
  projectRootInput: string,
  prepareRequestId: string,
): LoadedTask | undefined {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const tasksDirectory = resolveTasksDirectory(projectRoot);
  if (!existsSync(tasksDirectory)) return undefined;
  const matches = readdirSync(tasksDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name))
    .map((entry) => loadTask(projectRoot, entry.name))
    .filter((task) => task.projection.prepareRequestId === prepareRequestId);
  if (matches.length > 1) {
    throw new Error(`Prepare request ${prepareRequestId} is bound to multiple tasks.`);
  }
  return matches[0];
}

export async function transitionTask(input: {
  projectRoot: string;
  taskId: string;
  type: Exclude<TaskEvent['type'], 'task-prepared'>;
  actor: TaskEvent['actor'];
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
  const lock = acquireTaskLock(projectRoot, taskId);
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
    invalidateTaskOwnedInputs(projectRoot, taskId);
    appendFileSync(current.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    writeJsonAtomic(current.taskPath, projection);
    return loadTask(projectRoot, taskId);
  } finally {
    releaseLock(lock);
  }
}

export function commitStagedTaskTransition(input: {
  projectRoot: string;
  taskId: string;
  expectedRevision: number;
  type: Exclude<TaskEvent['type'], 'task-prepared'>;
  actor: TaskEvent['actor'];
  projection: TaskProjection;
  artifactRefs: string[];
  stagedArtifactsDirectory: string;
}): LoadedTask {
  const projectRoot = canonicalProjectRoot(input.projectRoot);
  const taskId = requiredTaskId(input.taskId);
  assertStagingDirectory(projectRoot, input.stagedArtifactsDirectory);
  const lock = acquireTaskLock(projectRoot, taskId);
  try {
    const current = loadTask(projectRoot, taskId);
    if (current.projection.revision !== input.expectedRevision
      || lock.expectedRevision !== input.expectedRevision) {
      throw usageError(`Task ${taskId} changed while facts were being collected; no collection was committed.`);
    }
    const occurredAt = new Date().toISOString();
    const projection = parseArtifact(TaskProjectionSchema, {
      ...input.projection,
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
      artifactRefs: input.artifactRefs,
      projection,
    }, 'task transition event');
    assertOwnedLock(lock);
    invalidateTaskOwnedInputs(projectRoot, taskId);
    publishStagedArtifacts(input.stagedArtifactsDirectory, current.taskDirectory);
    appendFileSync(current.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    writeJsonAtomic(current.taskPath, projection);
    return loadTask(projectRoot, taskId);
  } finally {
    releaseOwnedFileLock(lock);
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

interface LockOwner {
  owner: string;
  pid: number;
  processIdentity?: string;
  operation: string;
  acquiredAt: string;
  expectedRevision?: number;
  taskId?: string;
}

const activeLocks = new Map<string, { path: string; owner: string }>();
let signalHandlersInstalled = false;

function acquireTaskLock(projectRoot: string, taskId: string): TaskLock {
  const taskDirectory = resolveTaskDirectory(projectRoot, taskId);
  const path = join(taskDirectory, '.lock');
  const expectedRevision = loadTask(projectRoot, taskId).projection.revision;
  const value = newLockOwner('task-transition', { expectedRevision, taskId });
  acquireFileLock(path, value, `Task ${taskId} is being modified by another operation`);
  return { path, owner: value.owner, expectedRevision };
}

function acquireWorktreeLease(
  projectRoot: string,
  operation: 'prepare' | 'collect',
  taskId: string | undefined,
): WorktreeLease {
  const stetraDirectory = join(projectRoot, '.stetra');
  mkdirSync(stetraDirectory, { recursive: true });
  const path = join(stetraDirectory, 'worktree-operation.lock');
  const value = newLockOwner(operation, taskId ? { taskId } : {});
  acquireFileLock(
    path,
    value,
    'The project worktree is already being observed by another Stetra operation',
  );
  cleanupAbandonedStaging(projectRoot);
  return { projectRoot, path, owner: value.owner };
}

function newLockOwner(
  operation: string,
  extra: Pick<LockOwner, 'expectedRevision' | 'taskId'>,
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

function acquireFileLock(path: string, value: LockOwner, conflictMessage: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
      registerActiveLock(path, value.owner);
      return;
    } catch (error) {
      const candidate = readLock(path);
      if (attempt === 0 && candidate && isConfirmedDead(candidate)) {
        rmSync(path, { force: true });
        continue;
      }
      throw usageError(
        `${conflictMessage}${candidate ? ` (owner ${candidate.owner}, operation ${candidate.operation})` : ''}. `
        + `Inspect ${path}; Stetra only removes a lease after confirming its owning process ended.`,
      );
    }
  }
  throw new Error(`Unable to acquire lock at ${path}.`);
}

function readLock(path: string): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return typeof value.owner === 'string'
      && typeof value.pid === 'number'
      && typeof value.operation === 'string'
      && typeof value.acquiredAt === 'string'
      ? value as unknown as LockOwner
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
  releaseOwnedFileLock(lock);
}

function releaseOwnedFileLock(lock: { path: string; owner: string }): void {
  const current = readLock(lock.path);
  if (current?.owner === lock.owner) rmSync(lock.path, { force: true });
  activeLocks.delete(lock.path);
  if (activeLocks.size === 0 && signalHandlersInstalled) {
    process.removeListener('SIGINT', releaseLocksAndResignal);
    process.removeListener('SIGTERM', releaseLocksAndResignal);
    signalHandlersInstalled = false;
  }
}

function registerActiveLock(path: string, owner: string): void {
  activeLocks.set(path, { path, owner });
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  process.on('SIGINT', releaseLocksAndResignal);
  process.on('SIGTERM', releaseLocksAndResignal);
}

function releaseLocksAndResignal(signal: NodeJS.Signals): void {
  for (const lock of activeLocks.values()) releaseOwnedFileLock(lock);
  process.kill(process.pid, signal);
}

function isConfirmedDead(owner: LockOwner): boolean {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
  if (!owner.processIdentity) return false;
  const currentIdentity = readProcessIdentity(owner.pid);
  return currentIdentity !== undefined && currentIdentity !== owner.processIdentity;
}

function readProcessIdentity(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closing = stat.lastIndexOf(')');
    if (closing < 0) return undefined;
    const fields = stat.slice(closing + 1).trim().split(/\s+/);
    const startTime = fields[19];
    return startTime ? `linux-proc-start:${startTime}` : undefined;
  } catch {
    return undefined;
  }
}

function publishStagedArtifacts(stagedDirectory: string, taskDirectory: string): void {
  if (!existsSync(stagedDirectory)) return;
  for (const entry of readdirSync(stagedDirectory, { withFileTypes: true })) {
    const source = join(stagedDirectory, entry.name);
    const target = join(taskDirectory, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      publishStagedArtifacts(source, target);
      rmSync(source, { recursive: true, force: true });
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported staged artifact type at ${source}.`);
    if (existsSync(target)) throw new Error(`Task artifact already exists at ${target}.`);
    renameSync(source, target);
  }
}

function cleanupAbandonedStaging(projectRoot: string): void {
  const stagingRoot = resolveStagingDirectory(projectRoot);
  if (!existsSync(stagingRoot)) return;
  for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
    rmSync(join(stagingRoot, entry.name), { recursive: true, force: true });
  }
}

function resolveTaskDirectory(projectRoot: string, taskId: string): string {
  const relativePath = `.stetra/tasks/${taskId}`;
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function resolveTasksDirectory(projectRoot: string): string {
  const relativePath = '.stetra/tasks';
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function resolveStagingDirectory(projectRoot: string): string {
  const relativePath = '.stetra/staging';
  assertNoSymlinkTraversal(projectRoot, relativePath);
  return resolve(projectRoot, relativePath);
}

function assertStagingDirectory(projectRoot: string, path: string): void {
  const stagingRoot = resolveStagingDirectory(projectRoot);
  const output = relative(stagingRoot, resolve(path));
  if (!output || isAbsolute(output) || output === '..' || output.startsWith(`..${sep}`)) {
    throw new Error(`Staged task artifacts must remain under ${stagingRoot}.`);
  }
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
