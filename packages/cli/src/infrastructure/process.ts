import type { Readable, Writable } from 'node:stream';
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
  stdin?: Buffer | string;
  onStderr?: (chunk: Buffer) => void;
  onStdout?: (chunk: Buffer) => void;
  stderr: Writable;
  stdout: Writable;
  timeoutMs: number;
}): Promise<CommandResult> {
  const resolution = resolveExecutable(input.file, input.cwd);
  if (resolution.status === 'unavailable') {
    await Promise.all([endWritable(input.stdout), endWritable(input.stderr)]);
    return unavailableCommandResult(resolution.error);
  }
  const subprocess = execa(resolution.path, input.args, {
    buffer: false,
    cwd: input.cwd,
    detached: ownsDetachedProcessGroup(),
    env: input.env,
    reject: false,
    stderr: 'pipe',
    stdin: input.stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
  });
  let executionError: NodeJS.ErrnoException | undefined;
  subprocess.once('error', (error: NodeJS.ErrnoException) => {
    executionError = error;
  });
  if (!subprocess.stdout || !subprocess.stderr) {
    throw new Error('Command runner failed to create stdout/stderr pipes.');
  }
  if (input.stdin !== undefined) subprocess.stdin?.end(input.stdin);
  const outputFinished = Promise.all([
    pumpOutput(subprocess.stdout, input.stdout, input.onStdout),
    pumpOutput(subprocess.stderr, input.stderr, input.onStderr),
  ]);
  // The subprocess is awaited first so timeout supervision can act on it. Mark
  // an early sink failure as observed until the exact failure is rethrown below.
  void outputFinished.catch(() => undefined);
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
          subprocess.stdout?.destroy();
          subprocess.stderr?.destroy();
        }, PROCESS_OUTPUT_DRAIN_MS);
      }, PROCESS_TERMINATION_GRACE_MS);
    });
  }, input.timeoutMs);

  try {
    const result = await subprocess;
    await outputFinished;
    if (timedOut && ownedProcessGroupExists(pid) !== false) {
      await forceCompleted;
      // After group-directed SIGKILL is issued, kill(-pgid, 0) can continue to
      // observe unreaped zombies. In a nested PID namespace, reaping may depend
      // on this command returning. Bound output closure separately instead of
      // turning kernel reaping lag into an unavailable Runtime observation.
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

async function pumpOutput(
  source: Readable,
  destination: Writable,
  observe: ((chunk: Buffer) => void) | undefined,
): Promise<void> {
  try {
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      observe?.(chunk);
      await new Promise<void>((resolve, reject) => {
        destination.write(chunk, (error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await endWritable(destination);
  }
}

async function endWritable(destination: Writable): Promise<void> {
  if (!destination.writableEnded) destination.end();
  await finished(destination);
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
