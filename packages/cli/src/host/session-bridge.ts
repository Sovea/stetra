/** Exact Host-session routing for lifecycle hooks; never task authority. */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
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
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

import { delegationPrepareDraft, delegationPrepareGuide } from '../adapters/templates.ts';
import type { HostAdapter } from '../adapters/definition.ts';
import { inputError, usageError } from '../errors.ts';
import {
  createOwnedInputToken,
  ownedInputReservation,
  reserveOwnedInput,
  type OwnedInputReservation,
} from './owned-input.ts';
import { sha256, stableFingerprint, taskIdForPrepareRequest } from '../protocol.ts';
import { parseArtifact } from '../validation.ts';

export const HOST_SESSION_DIRECTORY = '.stetra/host-sessions';

const HEX_32 = /^[a-f0-9]{32}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const BINDING_TOKEN = /^([a-f0-9]{64})\.([a-f0-9]{32})$/;

const AvailableSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapter: z.enum(['codex', 'claude']),
  sessionKeyHash: z.string().regex(HEX_64),
  bindingState: z.literal('available'),
  bindingToken: z.string().regex(BINDING_TOKEN),
});

const PreparingSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adapter: z.enum(['codex', 'claude']),
  sessionKeyHash: z.string().regex(HEX_64),
  bindingState: z.literal('task-bound'),
  prepareRequestId: z.string().min(1),
  taskId: z.uuid(),
  inputToken: z.string().regex(HEX_32),
});

const HostSessionSchema = z.discriminatedUnion('bindingState', [
  AvailableSessionSchema,
  PreparingSessionSchema,
]);

export type HostSession = z.infer<typeof HostSessionSchema>;
export type PreparingHostSession = z.infer<typeof PreparingSessionSchema>;

export interface HostPrepareReservation {
  session: PreparingHostSession;
  reservation: OwnedInputReservation;
  prepareRequestId: string;
  taskId: string;
  submit: { argv: string[] };
  resume: { argv: string[] };
}

export function resolveInstalledProjectRoot(startInput: string): string | undefined {
  let current = resolve(startInput);
  if (!existsSync(current) || !statSync(current).isDirectory()) return undefined;
  current = realpathSync(current);
  const filesystemRoot = parse(current).root;
  while (true) {
    const manifest = join(current, '.stetra', 'manifest.json');
    if (existsSync(manifest)) {
      if (lstatSync(manifest).isSymbolicLink() || !statSync(manifest).isFile()) {
        throw usageError('The Stetra project manifest must be a regular non-symbolic-link file.');
      }
      return current;
    }
    if (current === filesystemRoot) return undefined;
    current = dirname(current);
  }
}

export function ensureHostSession(input: {
  projectRoot: string;
  adapter: HostAdapter;
  sessionId: string;
}): HostSession {
  const projectRoot = canonicalRoot(input.projectRoot);
  const sessionKeyHash = hostSessionKey(input.adapter, input.sessionId);
  const existing = readSession(projectRoot, input.adapter, sessionKeyHash);
  if (existing) return existing;
  const secret = randomBytes(16).toString('hex');
  const session: HostSession = {
    schemaVersion: 1,
    adapter: input.adapter,
    sessionKeyHash,
    bindingState: 'available',
    bindingToken: `${sessionKeyHash}.${secret}`,
  };
  writeSession(projectRoot, session, true);
  return readSession(projectRoot, input.adapter, sessionKeyHash) ?? session;
}

export function readHostSession(input: {
  projectRoot: string;
  adapter: HostAdapter;
  sessionId: string;
}): HostSession | undefined {
  const projectRoot = canonicalRoot(input.projectRoot);
  return readSession(projectRoot, input.adapter, hostSessionKey(input.adapter, input.sessionId));
}

export function beginHostSession(input: {
  projectRoot: string;
  adapter: HostAdapter;
  bindingToken: string;
}): HostPrepareReservation {
  const projectRoot = canonicalRoot(input.projectRoot);
  const match = BINDING_TOKEN.exec(input.bindingToken);
  if (!match) throw inputError('Host binding token is invalid.');
  const sessionKeyHash = match[1];
  const lock = acquireBeginLock(projectRoot, input.adapter, sessionKeyHash);
  let reservedToken: string | undefined;
  try {
    const session = readSession(projectRoot, input.adapter, sessionKeyHash);
    if (!session || session.bindingState !== 'available' || session.bindingToken !== input.bindingToken) {
      throw usageError('Host binding token is missing, already consumed, or belongs to another adapter.');
    }
    const prepareRequestId = `prepare:host-${sha256(input.bindingToken).slice(7, 39)}`;
    const taskId = taskIdForPrepareRequest(prepareRequestId);
    const inputToken = createOwnedInputToken();
    const preparing: PreparingHostSession = {
      schemaVersion: 1,
      adapter: input.adapter,
      sessionKeyHash,
      bindingState: 'task-bound',
      prepareRequestId,
      taskId,
      inputToken,
    };
    const result = reservePrepare(projectRoot, preparing);
    reservedToken = inputToken;
    writeSession(projectRoot, preparing, false);
    return result;
  } catch (error) {
    if (reservedToken) removeReservation(projectRoot, reservedToken);
    throw error;
  } finally {
    rmSync(lock, { force: true });
  }
}

export function ensureHostPrepareReservation(
  projectRootInput: string,
  session: PreparingHostSession,
): HostPrepareReservation {
  const projectRoot = canonicalRoot(projectRootInput);
  const path = join(projectRoot, '.stetra', 'inbox', `${session.inputToken}.json`);
  if (existsSync(path)) {
    const reservation = ownedInputReservation(projectRoot, session.inputToken);
    return prepareReservation(session, { ...reservation, prefilled: true });
  }
  rmSync(join(projectRoot, '.stetra', 'inbox', `${session.inputToken}.guide.json`), { force: true });
  try {
    return reservePrepare(projectRoot, session);
  } catch (error) {
    if (existsSync(path)) {
      const reservation = ownedInputReservation(projectRoot, session.inputToken);
      return prepareReservation(session, { ...reservation, prefilled: true });
    }
    throw error;
  }
}

export function hostTaskExists(projectRootInput: string, taskId: string): boolean {
  const projectRoot = canonicalRoot(projectRootInput);
  const events = join(projectRoot, '.stetra', 'tasks', taskId, 'events.jsonl');
  return existsSync(events) && !lstatSync(events).isSymbolicLink() && statSync(events).isFile();
}

export function claimActionDelivery(input: {
  projectRoot: string;
  session: HostSession;
  actionFingerprint: string;
}): boolean {
  const fingerprint = input.actionFingerprint.startsWith('sha256:')
    ? input.actionFingerprint.slice(7)
    : input.actionFingerprint;
  if (!HEX_64.test(fingerprint)) throw inputError('Host Action fingerprint is invalid.');
  const directory = sessionDirectory(
    canonicalRoot(input.projectRoot),
    input.session.adapter,
    input.session.sessionKeyHash,
  );
  assertNoSymlinkTraversal(input.projectRoot, directory);
  mkdirSync(join(directory, 'delivered'), { recursive: true, mode: 0o700 });
  const path = join(directory, 'delivered', `${fingerprint}.json`);
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ actionFingerprint: `sha256:${fingerprint}` })}\n`);
  } finally {
    closeSync(descriptor);
  }
  return true;
}

export function pendingPrepareFingerprint(session: PreparingHostSession): string {
  return stableFingerprint({
    kind: 'prepare',
    prepareRequestId: session.prepareRequestId,
    taskId: session.taskId,
  });
}

export function hostSessionKey(adapter: HostAdapter, sessionId: string): string {
  if (!sessionId || sessionId.length > 1024) throw inputError('Host session ID is invalid.');
  return sha256(`host-session:${adapter}:${sessionId}`).slice(7);
}

function reservePrepare(
  projectRoot: string,
  session: PreparingHostSession,
): HostPrepareReservation {
  const document = delegationPrepareDraft();
  return prepareReservation(
    session,
    reserveOwnedInput(projectRoot, session.inputToken, document, delegationPrepareGuide()),
  );
}

function prepareReservation(
  session: PreparingHostSession,
  reservation: OwnedInputReservation,
): HostPrepareReservation {
  return {
    session,
    reservation,
    prepareRequestId: session.prepareRequestId,
    taskId: session.taskId,
    submit: {
      argv: [
        'stetra', 'change', 'prepare', '.',
        '--prepare-request', session.prepareRequestId,
        '--input', reservation.path, '--json',
      ],
    },
    resume: {
      argv: [
        'stetra', 'change', 'resume', '.',
        '--prepare-request', session.prepareRequestId, '--json',
      ],
    },
  };
}

function readSession(
  projectRoot: string,
  adapter: HostAdapter,
  sessionKeyHash: string,
): HostSession | undefined {
  if (!HEX_64.test(sessionKeyHash)) throw inputError('Host session key is invalid.');
  const path = sessionPath(projectRoot, adapter, sessionKeyHash);
  if (!existsSync(path)) return undefined;
  assertNoSymlinkTraversal(projectRoot, path);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw inputError('Failed to parse Host session routing state.', error);
  }
  const session = parseArtifact(HostSessionSchema, value, 'Host session routing state');
  if (session.adapter !== adapter || session.sessionKeyHash !== sessionKeyHash) {
    throw new Error('Host session routing identity does not match its storage path.');
  }
  return session;
}

function writeSession(projectRoot: string, session: HostSession, exclusive: boolean): void {
  const path = sessionPath(projectRoot, session.adapter, session.sessionKeyHash);
  const directory = dirname(path);
  assertNoSymlinkTraversal(projectRoot, directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (exclusive) {
    let descriptor: number;
    try {
      descriptor = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
        0o600,
      );
    } catch (error) {
      if (isAlreadyExists(error)) return;
      throw error;
    }
    try {
      writeFileSync(descriptor, `${JSON.stringify(session, null, 2)}\n`);
    } finally {
      closeSync(descriptor);
    }
    return;
  }
  assertNoSymlinkTraversal(projectRoot, path);
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  renameSync(temporary, path);
}

function sessionPath(projectRoot: string, adapter: HostAdapter, sessionKeyHash: string): string {
  return join(sessionDirectory(projectRoot, adapter, sessionKeyHash), 'binding.json');
}

function sessionDirectory(
  projectRoot: string,
  adapter: HostAdapter,
  sessionKeyHash: string,
): string {
  return join(projectRoot, HOST_SESSION_DIRECTORY, adapter, sessionKeyHash);
}

function canonicalRoot(projectRootInput: string): string {
  const projectRoot = resolve(projectRootInput);
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw usageError(`Project root is not a directory: ${projectRoot}`);
  }
  return realpathSync(projectRoot);
}

function assertNoSymlinkTraversal(projectRootInput: string, targetInput: string): void {
  const projectRoot = resolve(projectRootInput);
  const target = resolve(targetInput);
  const rel = relative(projectRoot, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw usageError('Host session state path escapes the project root.');
  }
  let current = projectRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) {
      throw usageError(`Refusing Host session state through a symbolic link: ${current}`);
    }
  }
}

function acquireBeginLock(
  projectRoot: string,
  adapter: HostAdapter,
  sessionKeyHash: string,
): string {
  const path = join(sessionDirectory(projectRoot, adapter, sessionKeyHash), 'begin.lock');
  assertNoSymlinkTraversal(projectRoot, path);
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw usageError('Host binding token consumption is already in progress.');
    }
    throw error;
  }
  closeSync(descriptor);
  return path;
}

function removeReservation(projectRoot: string, token: string): void {
  rmSync(join(projectRoot, '.stetra', 'inbox', `${token}.json`), { force: true });
  rmSync(join(projectRoot, '.stetra', 'inbox', `${token}.guide.json`), { force: true });
}

function noFollowFlag(): number {
  return 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
}

function isAlreadyExists(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error
    && (error as { code?: string }).code === 'EEXIST';
}
