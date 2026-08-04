import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { execa } from 'execa';

import { resolveExecutable } from './executable.ts';

export interface CommandResult {
  code?: string;
  executionError: boolean;
  exitCode: number | null;
  failed: boolean;
  message?: string;
  signal: string | null;
  timedOut: boolean;
}

export interface BufferedCommandResult extends CommandResult {
  stderr: Buffer;
  stdout: Buffer;
}

export async function runBufferedCommand(input: {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  file: string;
  maxBuffer: number;
}): Promise<BufferedCommandResult> {
  const resolution = resolveExecutable(input.file, input.cwd);
  if (resolution.status === 'unavailable') {
    return {
      ...unavailableCommandResult(resolution.error),
      stderr: Buffer.alloc(0),
      stdout: Buffer.alloc(0),
    };
  }
  const subprocess = execa(resolution.path, input.args, {
    cwd: input.cwd,
    encoding: 'buffer',
    env: input.env,
    maxBuffer: input.maxBuffer,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
  });
  let executionError: NodeJS.ErrnoException | undefined;
  subprocess.once('error', (error: NodeJS.ErrnoException) => {
    executionError = error;
  });
  const result = await subprocess;
  return {
    ...normalizeCommandResult(result, executionError),
    stdout: Buffer.from(result.stdout ?? []),
    stderr: Buffer.from(result.stderr ?? []),
  };
}

export async function runStreamingCommand(input: {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  file: string;
  onStderr?: (chunk: Buffer) => void;
  onStdout?: (chunk: Buffer) => void;
  stderr: Writable;
  stdout: Writable;
  timeoutMs: number;
}): Promise<CommandResult> {
  const outputFinished = Promise.all([
    finished(input.stdout),
    finished(input.stderr),
  ]);
  const resolution = resolveExecutable(input.file, input.cwd);
  if (resolution.status === 'unavailable') {
    input.stdout.end();
    input.stderr.end();
    await outputFinished;
    return unavailableCommandResult(resolution.error);
  }
  const subprocess = execa(resolution.path, input.args, {
    buffer: false,
    cwd: input.cwd,
    env: input.env,
    forceKillAfterDelay: 1_000,
    reject: false,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
    timeout: input.timeoutMs,
  });
  let executionError: NodeJS.ErrnoException | undefined;
  subprocess.once('error', (error: NodeJS.ErrnoException) => {
    executionError = error;
  });
  if (!subprocess.stdout || !subprocess.stderr) {
    throw new Error('Command runner failed to create stdout/stderr pipes.');
  }
  subprocess.stdout.on('data', (chunk: Buffer) => input.onStdout?.(chunk));
  subprocess.stderr.on('data', (chunk: Buffer) => input.onStderr?.(chunk));
  subprocess.stdout.pipe(input.stdout);
  subprocess.stderr.pipe(input.stderr);
  const result = await subprocess;
  await outputFinished;
  return normalizeCommandResult(result, executionError);
}

function unavailableCommandResult(
  error: NodeJS.ErrnoException,
): CommandResult {
  return {
    ...(error.code === undefined ? {} : { code: error.code }),
    executionError: true,
    exitCode: null,
    failed: true,
    message: error.message,
    signal: null,
    timedOut: false,
  };
}

function normalizeCommandResult(result: {
  code?: string;
  exitCode?: number;
  failed: boolean;
  message?: string;
  shortMessage?: string;
  signal?: string;
  timedOut: boolean;
}, executionError: NodeJS.ErrnoException | undefined): CommandResult {
  const code = executionError?.code ?? result.code;
  const hasExecutionError = executionError !== undefined || code !== undefined;
  return {
    ...(code === undefined ? {} : { code }),
    executionError: hasExecutionError,
    // Some Windows spawn paths surface a synthetic numeric exit code alongside
    // the ChildProcess error event. That code was not produced by the requested
    // executable and therefore is not a meaningful command outcome.
    exitCode: hasExecutionError ? null : result.exitCode ?? null,
    failed: result.failed,
    message: result.shortMessage ?? result.message ?? executionError?.message,
    signal: result.signal ?? null,
    timedOut: result.timedOut,
  };
}
