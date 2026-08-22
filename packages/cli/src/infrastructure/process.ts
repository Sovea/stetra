import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { execa } from 'execa';

import { resolveExecutable } from './executable.ts';
import {
  forwardTerminationSignals,
  ownedProcessGroupExists,
  ownsDetachedProcessGroup,
  PROCESS_OUTPUT_DRAIN_MS,
  PROCESS_TERMINATION_GRACE_MS,
  signalOwnedProcessTree,
} from './process-supervisor.ts';

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
    detached: ownsDetachedProcessGroup(),
    env: input.env,
    reject: false,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
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
  const pid = subprocess.pid;
  if (pid === undefined) {
    const result = await subprocess;
    await outputFinished;
    return normalizeCommandResult(result, executionError);
  }
  const removeSignalForwarding = forwardTerminationSignals(pid);
  let timedOut = false;
  let outputDrainForced = false;
  let forceTimer: NodeJS.Timeout | undefined;
  let drainTimer: NodeJS.Timeout | undefined;
  let forceCompleted: Promise<void> | undefined;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    signalOwnedProcessTree(pid, 'SIGTERM');
    forceCompleted = new Promise((resolve) => {
      forceTimer = setTimeout(() => {
        signalOwnedProcessTree(pid, 'SIGKILL');
        resolve();
        drainTimer = setTimeout(() => {
          outputDrainForced = true;
          subprocess.stdout?.unpipe(input.stdout);
          subprocess.stderr?.unpipe(input.stderr);
          subprocess.stdout?.destroy();
          subprocess.stderr?.destroy();
          if (!input.stdout.writableEnded) input.stdout.end();
          if (!input.stderr.writableEnded) input.stderr.end();
        }, PROCESS_OUTPUT_DRAIN_MS);
      }, PROCESS_TERMINATION_GRACE_MS);
    });
  }, input.timeoutMs);

  try {
    const result = await subprocess;
    await outputFinished;
    if (timedOut && ownedProcessGroupExists(pid) !== false) {
      await forceCompleted;
      await waitForOwnedProcessGroupExit(pid);
    }
    if (outputDrainForced) {
      throw new Error(
        `Command process group ${pid} did not close its output after forced termination.`,
      );
    }
    return normalizeCommandResult(result, executionError, timedOut);
  } finally {
    clearTimeout(timeoutTimer);
    if (forceTimer) clearTimeout(forceTimer);
    if (drainTimer) clearTimeout(drainTimer);
    removeSignalForwarding();
  }
}

async function waitForOwnedProcessGroupExit(pid: number): Promise<void> {
  if (process.platform === 'win32') return;
  const deadline = Date.now() + PROCESS_OUTPUT_DRAIN_MS;
  while (ownedProcessGroupExists(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`Command process group ${pid} remained alive after forced termination.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
}, executionError: NodeJS.ErrnoException | undefined, timedOut = result.timedOut): CommandResult {
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
    timedOut,
  };
}
