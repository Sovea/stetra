import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { inputError } from '../errors.ts';

export const OWNED_INPUT_DIRECTORY = '.stetra/inbox';
export const OWNED_INPUT_MAX_BYTES = 8 * 1024 * 1024;

const TOKEN_PATTERN = /^[a-f0-9]{32,64}$/;

export interface OwnedInputReservation {
  transport: 'owned-file';
  path: string;
  token: string;
  serialization: 'json';
  execution: 'one-shot';
  consume: 'read-and-delete';
  maxBytes: number;
  prefilled: boolean;
  guide?: {
    path: string;
    maxBytes: number;
  };
}

export interface OwnedInputClaim {
  reservation: OwnedInputReservation;
  text: string;
  guideText?: string;
}

export function reserveOwnedInput(
  projectRootInput: string,
  requestedToken?: string,
  initialDocument?: unknown,
  guide?: unknown,
): OwnedInputReservation {
  const token = requestedToken ?? randomUUID().replaceAll('-', '');
  const serialized = initialDocument === undefined
    ? undefined
    : `${JSON.stringify(initialDocument, null, 2)}\n`;
  const serializedGuide = guide === undefined
    ? undefined
    : `${JSON.stringify(guide, null, 2)}\n`;
  return writeOwnedInput(projectRootInput, token, serialized, serializedGuide);
}

export function reissueOwnedInput(
  projectRootInput: string,
  claim: OwnedInputClaim,
): OwnedInputReservation {
  return writeOwnedInput(
    projectRootInput,
    claim.reservation.token,
    claim.text,
    claim.guideText,
  );
}

function writeOwnedInput(
  projectRootInput: string,
  token: string,
  serialized: string | undefined,
  serializedGuide: string | undefined,
): OwnedInputReservation {
  const projectRoot = resolve(projectRootInput);
  requireOwnedInputToken(token);
  const directory = join(projectRoot, OWNED_INPUT_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${token}.json`);
  const guidePath = join(directory, `${token}.guide.json`);
  if (serialized !== undefined && Buffer.byteLength(serialized) > OWNED_INPUT_MAX_BYTES) {
    throw inputError(`Owned input draft exceeds ${OWNED_INPUT_MAX_BYTES} bytes.`);
  }
  if (serializedGuide !== undefined && Buffer.byteLength(serializedGuide) > OWNED_INPUT_MAX_BYTES) {
    throw inputError(`Owned input guide exceeds ${OWNED_INPUT_MAX_BYTES} bytes.`);
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
  } catch (error) {
    throw inputError(
      `Owned input ${projectRelativePath(projectRoot, path)} already exists; consume it or reserve a new token.`,
      error,
    );
  }
  try {
    if (serialized !== undefined) {
      writeFileSync(descriptor, serialized, 'utf8');
    }
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(path);
    throw inputError(`Failed to prefill owned input ${projectRelativePath(projectRoot, path)}.`, error);
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // The write failure path already closed the descriptor before removing the partial file.
    }
  }
  if (serializedGuide !== undefined) {
    let guideCreated = false;
    try {
      const guideDescriptor = openSync(
        guidePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
        0o600,
      );
      guideCreated = true;
      try {
        writeFileSync(guideDescriptor, serializedGuide, 'utf8');
      } finally {
        closeSync(guideDescriptor);
      }
    } catch (error) {
      try {
        unlinkSync(path);
      } catch {
        // The original guide write error remains authoritative.
      }
      if (guideCreated) {
        try {
          unlinkSync(guidePath);
        } catch {
          // The original guide write error remains authoritative.
        }
      }
      throw inputError(`Failed to write owned input guide ${projectRelativePath(projectRoot, guidePath)}.`, error);
    }
  }
  const reservation = ownedInputReservation(projectRoot, token);
  return {
    ...reservation,
    prefilled: serialized !== undefined,
    ...(serializedGuide === undefined ? {} : {
      guide: {
        path: reservation.path.replace(/\.json$/, '.guide.json'),
        maxBytes: OWNED_INPUT_MAX_BYTES,
      },
    }),
  };
}

export function ownedInputReservation(
  projectRootInput: string,
  token: string,
): OwnedInputReservation {
  const projectRoot = resolve(projectRootInput);
  requireOwnedInputToken(token);
  return {
    transport: 'owned-file',
    path: `${OWNED_INPUT_DIRECTORY}/${token}.json`,
    token,
    serialization: 'json',
    execution: 'one-shot',
    consume: 'read-and-delete',
    maxBytes: OWNED_INPUT_MAX_BYTES,
    prefilled: false,
  };
}

export function ownedInputToken(fingerprint: string): string {
  const token = fingerprint.startsWith('sha256:')
    ? fingerprint.slice('sha256:'.length)
    : fingerprint;
  requireOwnedInputToken(token);
  return token;
}

export function taskOwnedInputToken(taskId: string, actionFingerprint: string): string {
  const taskPrefix = tokenPart(taskId);
  const actionPart = tokenPart(actionFingerprint);
  return `${taskPrefix.slice(0, 32)}${actionPart.slice(0, 32)}`;
}

export function invalidateTaskOwnedInputs(
  projectRootInput: string,
  taskId: string,
): void {
  const projectRoot = resolve(projectRootInput);
  const directory = join(projectRoot, OWNED_INPUT_DIRECTORY);
  if (!existsSync(directory)) return;
  const prefix = tokenPart(taskId).slice(0, 32);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    if (!new RegExp(`^${prefix}[a-f0-9]{32}\\.(?:json|guide\\.json)$`).test(entry.name)) continue;
    rmSync(join(directory, entry.name), { force: true });
  }
}

export function claimOwnedInput(
  projectRootInput: string,
  input: string,
  label: string,
): OwnedInputClaim | undefined {
  const projectRoot = resolve(projectRootInput);
  const normalized = input.replaceAll('\\', '/');
  const match = /^\.stetra\/inbox\/([a-f0-9]{32,64})\.json$/.exec(normalized);
  if (!match) return undefined;
  requireOwnedInputToken(match[1]);
  const path = resolve(projectRoot, input);
  const expected = resolve(projectRoot, OWNED_INPUT_DIRECTORY, `${match[1]}.json`);
  if (path !== expected) throw inputError(`${label} owned input path is invalid.`);

  let descriptor: number | undefined;
  let opened = false;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollowFlag());
    opened = true;
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw inputError(`${label} owned input must be a regular file.`);
    if (stat.size > OWNED_INPUT_MAX_BYTES) {
      throw inputError(`${label} owned input exceeds ${OWNED_INPUT_MAX_BYTES} bytes.`);
    }
    const text = readFileSync(descriptor, 'utf8');
    const guideText = readOptionalGuide(projectRoot, match[1], label);
    const reservation = ownedInputReservation(projectRoot, match[1]);
    return {
      reservation: {
        ...reservation,
        prefilled: true,
        ...(guideText === undefined ? {} : {
          guide: {
            path: reservation.path.replace(/\.json$/, '.guide.json'),
            maxBytes: OWNED_INPUT_MAX_BYTES,
          },
        }),
      },
      text,
      ...(guideText === undefined ? {} : { guideText }),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'CliError') throw error;
    throw inputError(`Failed to read ${label} from ${normalized}.`, error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (opened) {
      try {
        unlinkSync(path);
      } catch {
        // A missing file is already consumed; the original read error remains authoritative.
      }
      try {
        unlinkSync(resolve(projectRoot, OWNED_INPUT_DIRECTORY, `${match[1]}.guide.json`));
      } catch {
        // Guides are optional and share the one-shot lifetime of their draft.
      }
    }
  }
}

function readOptionalGuide(
  projectRoot: string,
  token: string,
  label: string,
): string | undefined {
  const path = resolve(projectRoot, OWNED_INPUT_DIRECTORY, `${token}.guide.json`);
  if (!existsSync(path)) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollowFlag());
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw inputError(`${label} owned input guide must be a regular file.`);
    if (stat.size > OWNED_INPUT_MAX_BYTES) {
      throw inputError(`${label} owned input guide exceeds ${OWNED_INPUT_MAX_BYTES} bytes.`);
    }
    return readFileSync(descriptor, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.name === 'CliError') throw error;
    throw inputError(`Failed to read ${label} owned input guide.`, error);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createOwnedInputToken(): string {
  return randomUUID().replaceAll('-', '');
}

export function isOwnedInputPath(input: string): boolean {
  return /^\.stetra\/inbox\/[a-f0-9]{32,64}\.json$/.test(input.replaceAll('\\', '/'));
}

function requireOwnedInputToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) {
    throw inputError('Owned input token must contain 32 to 64 lowercase hexadecimal characters.');
  }
}

function tokenPart(value: string): string {
  const normalized = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
  if (/^[a-f0-9]{64}$/.test(normalized)) return normalized;
  return createHash('sha256').update(value).digest('hex');
}

function noFollowFlag(): number {
  return 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
}

function projectRelativePath(projectRoot: string, path: string): string {
  const rel = relative(projectRoot, path);
  return rel.split(sep).join('/');
}
