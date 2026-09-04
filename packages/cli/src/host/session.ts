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
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

import { z } from 'zod';

import type { HostAdapter } from '../adapters/definition.ts';
import { inputError, usageError } from '../errors.ts';
import { sha256 } from '../protocol.ts';
import { parseArtifact } from '../validation.ts';

const HEX_32 = /^[a-f0-9]{32}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const BINDING_TOKEN = /^(codex|claude)\.([a-f0-9]{64})\.([a-f0-9]{32})$/;

const SessionSchema = z.strictObject({
  schemaVersion: z.literal(2),
  adapter: z.enum(['codex', 'claude']),
  sessionKeyHash: z.string().regex(HEX_64),
  bindingToken: z.string().regex(BINDING_TOKEN),
  taskId: z.uuid().optional(),
});

export type HostSession = z.infer<typeof SessionSchema>;

export function resolveInstalledProjectRoot(startInput: string): string | undefined {
  let current = resolve(startInput);
  if (!existsSync(current) || !statSync(current).isDirectory()) return undefined;
  current = realpathSync(current);
  const filesystemRoot = parse(current).root;
  while (true) {
    const manifest = join(current, '.stetra', 'manifest.json');
    if (existsSync(manifest)) {
      if (lstatSync(manifest).isSymbolicLink() || !statSync(manifest).isFile()) {
        throw usageError('The Stetra manifest must be a regular non-symbolic-link file.');
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
  const sessionKeyHash = hostSessionKey(input.adapter, input.sessionId);
  const existing = readSession(input.projectRoot, input.adapter, sessionKeyHash);
  if (existing) return existing;
  const session: HostSession = {
    schemaVersion: 2,
    adapter: input.adapter,
    sessionKeyHash,
    bindingToken: `${input.adapter}.${sessionKeyHash}.${randomBytes(16).toString('hex')}`,
  };
  writeSession(input.projectRoot, session, true);
  return readSession(input.projectRoot, input.adapter, sessionKeyHash) ?? session;
}

export function readHostSession(input: {
  projectRoot: string;
  adapter: HostAdapter;
  sessionId: string;
}): HostSession | undefined {
  return readSession(
    input.projectRoot,
    input.adapter,
    hostSessionKey(input.adapter, input.sessionId),
  );
}

export function bindHostSession(input: {
  projectRoot: string;
  bindingToken: string;
  taskId: string;
}): void {
  const match = BINDING_TOKEN.exec(input.bindingToken);
  if (!match) throw inputError('Host binding token is invalid.');
  const adapter = match[1] as HostAdapter;
  const sessionKeyHash = match[2];
  const session = readSession(input.projectRoot, adapter, sessionKeyHash);
  if (!session || session.bindingToken !== input.bindingToken) {
    throw usageError('Host binding token is missing or belongs to another session.');
  }
  if (session.taskId && session.taskId !== input.taskId) {
    throw usageError(`Host session is already bound to task ${session.taskId}.`);
  }
  writeSession(input.projectRoot, { ...session, taskId: input.taskId }, false);
}

export function claimDirective(input: {
  projectRoot: string;
  session: HostSession;
  fingerprint: string;
}): boolean {
  const digest = input.fingerprint.startsWith('sha256:')
    ? input.fingerprint.slice('sha256:'.length) : input.fingerprint;
  if (!HEX_64.test(digest)) throw inputError('Host directive fingerprint is invalid.');
  const directory = join(sessionDirectory(
    input.projectRoot,
    input.session.adapter,
    input.session.sessionKeyHash,
  ), 'delivered');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${digest}.json`);
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  writeFileSync(descriptor, `${JSON.stringify({ fingerprint: `sha256:${digest}` })}\n`);
  closeSync(descriptor);
  return true;
}

function hostSessionKey(adapter: HostAdapter, sessionId: string): string {
  if (!sessionId || sessionId.length > 1024) throw inputError('Host session ID is invalid.');
  return sha256(`host-session:${adapter}:${sessionId}`).slice('sha256:'.length);
}

function readSession(
  projectRootInput: string,
  adapter: HostAdapter,
  sessionKeyHash: string,
): HostSession | undefined {
  const projectRoot = realpathSync(resolve(projectRootInput));
  const path = sessionPath(projectRoot, adapter, sessionKeyHash);
  if (!existsSync(path)) return undefined;
  const session = parseArtifact(SessionSchema, JSON.parse(readFileSync(path, 'utf8')), 'Host session');
  if (session.adapter !== adapter || session.sessionKeyHash !== sessionKeyHash) {
    throw new Error('Host session identity does not match its storage path.');
  }
  return session;
}

function writeSession(projectRootInput: string, session: HostSession, exclusive: boolean): void {
  const projectRoot = realpathSync(resolve(projectRootInput));
  const path = sessionPath(projectRoot, session.adapter, session.sessionKeyHash);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (exclusive) {
    try {
      writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return;
  }
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  renameSync(temporary, path);
}

function sessionPath(projectRoot: string, adapter: HostAdapter, hash: string): string {
  return join(sessionDirectory(projectRoot, adapter, hash), 'binding.json');
}

function sessionDirectory(projectRoot: string, adapter: HostAdapter, hash: string): string {
  return join(projectRoot, '.stetra', 'host-sessions', adapter, hash);
}
